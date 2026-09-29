// In-memory stand-in for web/js/data.js, used only by the browser smoke test.
// It mimics the database's status rules closely enough to drive every screen.
const today = () => new Date().toLocaleString('en-CA', { timeZone: 'Asia/Manila' }).slice(0, 10);
const addDays = (n) => { const d = new Date(today() + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const uid = () => crypto.randomUUID();
const days = (iso) => Math.round((new Date(iso + 'T00:00:00Z') - new Date(today() + 'T00:00:00Z')) / 86400000);

const user = { id: 'u1', email: 'sadie@test.ph' };
const org = { id: 'o1', name: 'Aligned Solutions', plan_id: 'business_plus', plan_expires_at: null, deleted_at: null, role: 'owner' };
const plans = [
  { id: 'free', name: 'Free', price_php_monthly: 0, max_members: 1, max_locations_per_business: 1, paid_channels: false, features: ['1 business'] },
  { id: 'business', name: 'Business', price_php_monthly: null, max_members: 5, max_locations_per_business: 1, paid_channels: true, features: ['More'] },
  { id: 'business_plus', name: 'Business Plus', price_php_monthly: null, max_members: 20, max_locations_per_business: null, paid_channels: true, features: ['Branches'] },
];
const types = [
  { code: 'mayors_permit', name: "Mayor's / Business Permit", subject: 'business', expires: true, due_rule: 'jan20', per_location: true, help_text: 'Renew by Jan 20.' },
  { code: 'bir_cor', name: 'BIR Certificate of Registration (Form 2303)', subject: 'business', expires: false, due_rule: 'manual', per_location: true, help_text: 'Does not expire.' },
  { code: 'fsic', name: 'Fire Safety Inspection Certificate (FSIC)', subject: 'business', expires: true, due_rule: 'annual', per_location: true },
  { code: 'lto_registration', name: 'LTO Registration (OR/CR)', subject: 'vehicle', expires: true, due_rule: 'lto_plate', per_location: false },
  { code: 'ctpl', name: 'CTPL Insurance', subject: 'vehicle', expires: true, due_rule: 'lto_plate', per_location: false },
];
const db = { businesses: [], locations: [], vehicles: [], requirements: [], cycles: [], documents: [], requests: [], notifications: [], audit: [] };
let seq = 0;
const log = (summary, extra = {}) => db.audit.unshift({ id: ++seq, summary, action: 'created', actor_id: user.id, created_at: new Date().toISOString(), ...extra });

function addReq(subject, parent, loc, t, cycle) {
  const r = { id: uid(), org_id: org.id, subject, business_id: subject === 'business' ? parent : null, vehicle_id: subject === 'vehicle' ? parent : null,
    location_id: loc, type_code: t.code, name: t.name, expires: t.expires, confidence: 'likely', notes: null, renewal_started_at: null, deleted_at: null };
  db.requirements.push(r);
  if (cycle) db.cycles.push({ id: uid(), requirement_id: r.id, seq: ++seq, created_at: new Date().toISOString(), ...cycle });
  return r;
}
function seed() {
  const b = { id: 'b1', org_id: org.id, name: 'Corner <Bakery> & Co', activity: 'restaurant', structure: 'Corporation', tin: null, deleted_at: null };
  db.businesses.push(b);
  const l = { id: 'l1', business_id: b.id, name: 'Main branch', city: 'Makati City', address: '', is_main: true, deleted_at: null };
  db.locations.push(l);
  const mp = addReq('business', b.id, l.id, types[0], { reference_no: 'MP-1', expires_on: addDays(-4) });
  addReq('business', b.id, l.id, types[1]);
  const f = addReq('business', b.id, l.id, types[2], { reference_no: 'F-1', expires_on: addDays(200) });
  db.documents.push({ id: uid(), requirement_id: f.id, cycle_id: db.cycles.at(-1).id, file_name: 'fsic.pdf', storage_path: 'o1/x/fsic.pdf', mime_type: 'application/pdf', size_bytes: 120000, created_at: new Date().toISOString(), deleted_at: null });
  const v = { id: 'v1', org_id: org.id, make_model: 'Isuzu Elf', plate_no: 'NGV 5588', vehicle_type: 'Van', cr_no: 'CR1', mv_file_no: '', business_id: null, deleted_at: null };
  db.vehicles.push(v);
  addReq('vehicle', v.id, null, types[3], { reference_no: 'OR-1', expires_on: addDays(10) });
  addReq('vehicle', v.id, null, types[4]);
  db.notifications.push({ id: 'n1', user_id: user.id, kind: 'overdue', title: `${mp.name} is 4 days overdue`, body: b.name, link: `#/requirement/${mp.id}`, read_at: null, created_at: new Date().toISOString() });
  log('Added business "Corner <Bakery> & Co"', { business_id: b.id });
}
seed();

function statusRows() {
  const live = db.requirements.filter((r) => !r.deleted_at
    && !(r.business_id && db.businesses.find((b) => b.id === r.business_id)?.deleted_at)
    && !(r.vehicle_id && db.vehicles.find((v) => v.id === r.vehicle_id)?.deleted_at));
  return live.map((r) => {
    const c = db.cycles.filter((x) => x.requirement_id === r.id && !x.deleted_at).sort((a, b) => b.seq - a.seq)[0];
    const n = c ? db.documents.filter((d) => d.cycle_id === c.id && !d.deleted_at).length : 0;
    const open = db.requests.find((a) => a.requirement_id === r.id && !['completed', 'cancelled'].includes(a.status));
    const dl = c?.expires_on ? days(c.expires_on) : null;
    const base = !c ? 'needs_information' : !r.expires ? (n ? 'compliant' : 'needs_information') : !c.expires_on ? 'needs_information'
      : dl < 0 ? 'action_required' : dl <= 30 ? 'renew_soon' : n ? 'compliant' : 'needs_information';
    const prog = !!(open || r.renewal_started_at);
    const b = db.businesses.find((x) => x.id === r.business_id);
    const v = db.vehicles.find((x) => x.id === r.vehicle_id);
    const l = db.locations.find((x) => x.id === r.location_id);
    return { ...r, subject_name: b?.name || v?.make_model, plate_no: v?.plate_no || null, location_name: l?.name, location_city: l?.city, location_is_main: l?.is_main,
      cycle_id: c?.id || null, reference_no: c?.reference_no || null, issuer: c?.issuer || null, issued_on: c?.issued_on || null, expires_on: c?.expires_on || null,
      document_count: n, open_request_id: open?.id || null, days_left: dl, base_status: base, status: prog ? 'in_progress' : base,
      is_overdue: dl !== null && dl < 0,
      next_action: prog ? 'record_renewal' : ['action_required', 'renew_soon'].includes(base) ? 'renew' : base === 'needs_information' ? ((r.expires && !c?.expires_on) || !c ? 'add_details' : 'upload') : null };
  });
}

let authCb = () => {};
export const sb = {};
export const auth = {
  session: async () => ({ user }),
  onChange: (cb) => { authCb = cb; },
  signIn: async () => ({}), signUp: async () => ({}), signOut: async () => {}, sendReset: async () => ({}), setPassword: async () => ({}), google: async () => ({}),
};
export async function loadMe() {
  return { profile: { id: user.id, email: user.email, first_name: 'Sadie', last_name: 'Luna', role_title: '', phone: null, lang: 'en', current_org_id: org.id, is_platform_admin: true },
    orgs: [org], plans, prefs: { email_enabled: true, sms_enabled: false, whatsapp_enabled: false, business_alerts: true, vehicle_alerts: true, remind_30: true, remind_7: true, remind_1: true, weekly_digest: true } };
}
export async function loadOrgData() {
  return {
    types, businesses: db.businesses.filter((b) => !b.deleted_at), locations: db.locations.filter((l) => !l.deleted_at),
    vehicles: db.vehicles.filter((v) => !v.deleted_at), reqs: statusRows(), requests: [...db.requests],
    members: [{ user_id: user.id, role: 'owner', profile: { first_name: 'Sadie', last_name: 'Luna', email: user.email } }],
  };
}
export const setCurrentOrg = async () => {};
export const unreadCount = async () => db.notifications.filter((n) => !n.read_at).length;
export const onNewNotification = () => () => {};
export async function createBusiness(orgId, f) {
  const id = uid();
  db.businesses.push({ id, org_id: orgId, name: f.name, activity: f.activity, structure: f.structure, tin: null, deleted_at: null });
  const lid = uid();
  db.locations.push({ id: lid, business_id: id, name: 'Main branch', city: f.city, address: f.address, is_main: true, deleted_at: null });
  types.filter((t) => t.subject === 'business').forEach((t) => addReq('business', id, t.per_location ? lid : null, t));
  log(`Added business "${f.name}"`, { business_id: id });
  return id;
}
export const updateBusiness = async (id, patch) => Object.assign(db.businesses.find((b) => b.id === id), patch);
export async function addLocation(bizId, f) {
  const id = uid();
  db.locations.push({ id, business_id: bizId, name: f.name, city: f.city, address: f.address, is_main: false, deleted_at: null });
  types.filter((t) => t.subject === 'business' && t.per_location).forEach((t) => addReq('business', bizId, id, t));
  return id;
}
export const updateLocation = async (id, patch) => Object.assign(db.locations.find((l) => l.id === id), patch);
export async function createVehicle(orgId, f) {
  const id = uid();
  db.vehicles.push({ id, org_id: orgId, make_model: f.make_model, plate_no: (f.plate_no || '').toUpperCase(), vehicle_type: f.vehicle_type, cr_no: f.cr_no || '', mv_file_no: '', business_id: null, deleted_at: null });
  const reg = addReq('vehicle', id, null, types[3], f.registration_expires ? { reference_no: f.or_no, expires_on: f.registration_expires } : null);
  const ctpl = addReq('vehicle', id, null, types[4]);
  return { vehicle_id: id, registration: { requirement_id: reg.id, cycle_id: db.cycles.find((c) => c.requirement_id === reg.id)?.id || null }, ctpl: { requirement_id: ctpl.id, cycle_id: null } };
}
export const updateVehicle = async (id, patch) => Object.assign(db.vehicles.find((v) => v.id === id), patch);
const tableOf = { businesses: 'businesses', business_locations: 'locations', vehicles: 'vehicles', requirements: 'requirements', requirement_cycles: 'cycles', documents: 'documents' };
export const softDelete = async (t, id) => { db[tableOf[t]].find((x) => x.id === id).deleted_at = new Date().toISOString(); };
export const restore = async (t, id) => { db[tableOf[t]].find((x) => x.id === id).deleted_at = null; };
export async function addRequirement(f) {
  const t = types.find((x) => x.code === f.type_code) || { code: null, name: f.name, expires: f.expires ?? true };
  const r = addReq(f.subject, f.subject_id, f.location_id, t);
  r.confidence = 'confirmed';
  return { requirement_id: r.id, cycle_id: null };
}
export const updateRequirement = async (id, patch) => Object.assign(db.requirements.find((r) => r.id === id), patch);
export async function requirementDetail(id) {
  return { cycles: db.cycles.filter((c) => c.requirement_id === id && !c.deleted_at).sort((a, b) => b.seq - a.seq),
    documents: db.documents.filter((d) => d.requirement_id === id && !d.deleted_at), activity: db.audit.filter((a) => a.requirement_id === id) };
}
export async function saveCycle({ cycleId, requirementId, ...f }) {
  if (cycleId) { Object.assign(db.cycles.find((c) => c.id === cycleId), f); return cycleId; }
  const id = uid();
  db.cycles.push({ id, requirement_id: requirementId, seq: ++seq, created_at: new Date().toISOString(), reference_no: f.reference_no, issuer: f.issuer, issued_on: f.issued_on, expires_on: f.expires_on });
  const r = db.requirements.find((x) => x.id === requirementId);
  r.renewal_started_at = null; r.confidence = 'confirmed';
  log(`Recorded "${r.name}"`, { requirement_id: requirementId });
  return id;
}
export const checkFile = (file) => (!file || !file.size ? 'Please choose a file.' : null);
export async function uploadDocument({ requirementId, cycleId, file }) {
  const d = { id: uid(), requirement_id: requirementId, cycle_id: cycleId, file_name: file.name, storage_path: 'o1/' + file.name, mime_type: file.type, size_bytes: file.size, created_at: new Date().toISOString(), deleted_at: null };
  db.documents.push(d);
  return d;
}
export const fileUrl = async () => 'data:application/pdf;base64,JVBERi0=';
export const orgDocuments = async () => db.documents.filter((d) => !d.deleted_at);
export const allCycles = async () => db.cycles;
export async function createHelpRequest(f) {
  const r = statusRows().find((x) => x.id === f.requirement_id);
  const a = { id: uid(), ...f, requirement_name: r.name, subject_label: r.subject_name, status: 'submitted', created_at: new Date().toISOString(), due_on: r.expires_on };
  db.requests.unshift(a);
  return a;
}
export const cancelHelpRequest = async (id) => { db.requests.find((a) => a.id === id).status = 'cancelled'; };
export const listNotifications = async () => db.notifications;
export const markRead = async (ids) => ids.forEach((id) => { const n = db.notifications.find((x) => x.id === id); if (n) n.read_at = 'now'; });
export const markAllRead = async () => db.notifications.forEach((n) => { n.read_at = 'now'; });
export const deleteNotification = async (id) => { db.notifications = db.notifications.filter((n) => n.id !== id); };
export const clearNotifications = async () => { db.notifications = []; };
export const myDeliveryLog = async () => [{ id: 1, channel: 'email', subject: 'PermitPal: 2 items need attention', body_text: '', status: 'sent', created_at: new Date().toISOString() }];
export const history = async () => db.audit;
export const entityHistory = async () => db.audit;
export async function trash() {
  const d = (a) => a.filter((x) => x.deleted_at);
  return { businesses: d(db.businesses), locations: d(db.locations), vehicles: d(db.vehicles), requirements: d(db.requirements), cycles: d(db.cycles), documents: d(db.documents) };
}
export const invites = async () => [];
export const invite = async () => ({});
export const channelStatus = async () => ({ email: false, sms: false, whatsapp: false });
export const payments = async () => [];
export const updatePrefs = async () => {};
export const updateProfile = async () => {};
export const adminOrgs = async () => [{ id: org.id, name: org.name, plan_id: org.plan_id, created_at: new Date().toISOString(), owner_email: user.email, members: 1, businesses: 1, vehicles: 1, open_requests: db.requests.length }];
export const adminRequests = async () => db.requests.map((a) => ({ ...a, orgs: { name: org.name } }));
export const adminUpdateRequest = async (id, patch) => Object.assign(db.requests.find((a) => a.id === id), patch);
export const adminOutbox = async () => [];
export const adminRequestDocs = async () => [];
