// In-memory stand-in for web/js/data.js, used only by the browser smoke test.
// It mimics the database's status rules closely enough to drive every screen.
import { SERVICES } from './mock-services.js';

const today = () => new Date().toLocaleString('en-CA', { timeZone: 'Asia/Manila' }).slice(0, 10);
const addDays = (n) => { const d = new Date(today() + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// Works on older phones too (no crypto.randomUUID / Array.at before iOS 15.4).
const uid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2));
const last = (a) => a[a.length - 1];
const days = (iso) => Math.round((new Date(iso + 'T00:00:00Z') - new Date(today() + 'T00:00:00Z')) / 86400000);

const user = { id: 'u1', email: 'sadie@test.ph' };
const org = { id: 'o1', name: 'Aligned Solutions', plan_id: 'free', plan_expires_at: null, deleted_at: null, role: 'owner' };
const plans = [
  { id: 'free', name: 'Free', available: true, price_php_monthly: 0, max_members: null, max_locations_per_business: null, paid_channels: false, features: ['Unlimited businesses'] },
  { id: 'business', name: 'Business', price_php_monthly: null, max_members: 5, max_locations_per_business: 1, paid_channels: true, features: ['More'] },
  { id: 'business_plus', name: 'Business Plus', price_php_monthly: null, max_members: 20, max_locations_per_business: null, paid_channels: true, features: ['Branches'] },
];
const types = [
  { code: 'mayors_permit', name: "Mayor's / Business Permit", subject: 'business', expires: true, due_rule: 'jan20', per_location: true, help_text: 'Renew by Jan 20.' },
  { code: 'bir_cor', name: 'BIR Certificate of Registration (Form 2303)', subject: 'business', expires: false, due_rule: 'manual', per_location: true, help_text: 'Does not expire.' },
  { code: 'fsic', name: 'Fire Safety Inspection Certificate (FSIC)', subject: 'business', expires: true, due_rule: 'annual', per_location: true },
  { code: 'lto_registration', name: 'LTO Registration (OR/CR)', subject: 'vehicle', expires: true, due_rule: 'lto_plate', per_location: false },
  { code: 'ctpl', name: 'CTPL Insurance', subject: 'vehicle', expires: true, due_rule: 'lto_plate', per_location: false },
  { code: 'emission_test', name: 'Emission Test', subject: 'vehicle', expires: true, due_rule: 'lto_plate', per_location: false, help_text: 'Needed before LTO renewal.' },
  { code: 'mvir', name: 'Motor Vehicle Inspection Report (MVIR)', subject: 'vehicle', expires: true, due_rule: 'lto_plate', per_location: false },
  { code: 'drivers_license', name: "Driver's License", subject: 'person', expires: true, due_rule: 'manual', per_location: false, auto_add: false },
  { code: 'health_certificate', name: 'Health Certificate', subject: 'person', expires: true, due_rule: 'annual', per_location: false, auto_add: false },
  { code: 'nbi_clearance', name: 'NBI Clearance', subject: 'person', expires: true, due_rule: 'annual', per_location: false, auto_add: false },
];
const db = { people: [], events: [], shares: [], referrals: [], partners: [], businesses: [], locations: [], vehicles: [], requirements: [], cycles: [], documents: [], requests: [], notifications: [], audit: [] };
let seq = 0;
const log = (summary, extra = {}) => db.audit.unshift({ id: ++seq, summary, action: 'created', actor_id: user.id, created_at: new Date().toISOString(), ...extra });

function addReq(subject, parent, loc, t, cycle) {
  const r = { id: uid(), org_id: org.id, subject, business_id: subject === 'business' ? parent : null, vehicle_id: subject === 'vehicle' ? parent : null, person_id: subject === 'person' ? parent : null,
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
  db.documents.push({ id: uid(), requirement_id: f.id, cycle_id: last(db.cycles).id, file_name: 'fsic.pdf', storage_path: 'o1/x/fsic.pdf', mime_type: 'application/pdf', size_bytes: 120000, created_at: new Date().toISOString(), deleted_at: null });
  const v = { id: 'v1', org_id: org.id, make_model: 'Isuzu Elf', plate_no: 'NGV 5588', vehicle_type: 'Van', cr_no: 'CR1', mv_file_no: '', business_id: null, deleted_at: null };
  db.vehicles.push(v);
  addReq('vehicle', v.id, null, types[3], { reference_no: 'OR-1', expires_on: addDays(10) });
  addReq('vehicle', v.id, null, types[4]);
  db.notifications.push({ id: 'n1', user_id: user.id, kind: 'overdue', title: `${mp.name} is 4 days overdue`, body: b.name, link: `#/requirement/${mp.id}`, read_at: null, created_at: new Date().toISOString() });
  log('Added business "Corner <Bakery> & Co"', { business_id: b.id });
}
seed();
if (globalThis.PP_DEMO) {
  // Richer sample data for the design preview (web/demo.html).
  const b = { id: 'b2', org_id: org.id, name: 'Visayas Sari-Sari Distribution Co.', activity: 'retail', structure: 'Sole Proprietorship', tin: null, deleted_at: null };
  db.businesses.push(b);
  db.locations.push({ id: 'l2', business_id: 'b2', name: 'Main branch', city: 'Cebu City', address: 'Mabolo', is_main: true, deleted_at: null });
  db.locations.push({ id: 'l3', business_id: 'b2', name: 'Mandaue warehouse', city: 'Mandaue City', address: '', is_main: false, deleted_at: null });
  const mp = addReq('business', 'b2', 'l2', types[0], { reference_no: 'MP-2026-0810', expires_on: addDays(22) });
  addReq('business', 'b2', 'l2', types[1], { reference_no: 'COR-551204' });
  db.documents.push({ id: uid(), requirement_id: last(db.requirements).id, cycle_id: last(db.cycles).id, file_name: 'BIR_2303.pdf', storage_path: 'x', mime_type: 'application/pdf', size_bytes: 90000, created_at: new Date().toISOString(), deleted_at: null });
  addReq('business', 'b2', 'l3', types[0], { reference_no: 'MP-2026-0911', expires_on: addDays(-12) });
  addReq('business', 'b2', 'l3', types[2]);
  db.requirements.forEach((r) => { if (r.business_id === 'b2') r.confidence = 'confirmed'; });
  const v2 = { id: 'v2', org_id: org.id, make_model: 'Toyota Hilux', plate_no: 'NBC 4417', vehicle_type: 'Pickup', cr_no: 'CR-2', mv_file_no: '', business_id: 'b2', deleted_at: null };
  const v3 = { id: 'v3', org_id: org.id, make_model: 'Honda Click 125i', plate_no: '123 ABC', vehicle_type: 'Motorcycle', cr_no: '', mv_file_no: '', business_id: null, deleted_at: null };
  db.vehicles.push(v2, v3);
  addReq('vehicle', 'v2', null, types[3], { reference_no: 'OR-5521', expires_on: addDays(160) });
  db.documents.push({ id: uid(), requirement_id: last(db.requirements).id, cycle_id: last(db.cycles).id, file_name: 'Hilux_OR.jpg', storage_path: 'x', mime_type: 'image/jpeg', size_bytes: 240000, created_at: new Date().toISOString(), deleted_at: null });
  addReq('vehicle', 'v2', null, types[4], { reference_no: 'CTPL-88', issuer: 'Malayan Insurance', expires_on: addDays(160) });
  addReq('vehicle', 'v3', null, types[3], { reference_no: 'OR-77', expires_on: addDays(5) });
  // A fuller year for the calendar strip.
  addReq('business', 'b2', 'l2', types[2], { reference_no: 'FSIC-C-221', expires_on: addDays(130) });
  db.documents.push({ id: uid(), requirement_id: last(db.requirements).id, cycle_id: last(db.cycles).id, file_name: 'FSIC_Cebu.pdf', storage_path: 'x', mime_type: 'application/pdf', size_bytes: 80000, created_at: new Date().toISOString(), deleted_at: null });
  addReq('business', 'b1', 'l1', { code: 'sanitary_permit', name: 'Sanitary Permit', expires: true }, { reference_no: 'SP-88', expires_on: addDays(250) });
  db.documents.push({ id: uid(), requirement_id: last(db.requirements).id, cycle_id: last(db.cycles).id, file_name: 'sanitary.pdf', storage_path: 'x', mime_type: 'application/pdf', size_bytes: 60000, created_at: new Date().toISOString(), deleted_at: null });
  for (const [loc, biz] of [['l1', 'b1'], ['l2', 'b2'], ['l3', 'b2']]) addReq('business', biz, loc, { code: 'barangay_clearance', name: 'Barangay Business Clearance', expires: true }, { reference_no: 'BC-' + loc, expires_on: addDays(112) });
  addReq('vehicle', 'v3', null, types[4], { reference_no: 'CTPL-31', expires_on: addDays(5) });
  db.notifications.push({ id: 'n2', user_id: user.id, kind: 'due_soon', title: `${mp.name} expires in 22 days`, body: b.name, link: `#/requirement/${mp.id}`, read_at: null, created_at: new Date().toISOString() });
}

function statusRows() {
  const live = db.requirements.filter((r) => !r.deleted_at
    && !(r.business_id && db.businesses.find((b) => b.id === r.business_id)?.deleted_at)
    && !(r.vehicle_id && db.vehicles.find((v) => v.id === r.vehicle_id)?.deleted_at)
    && !(r.person_id && db.people.find((x) => x.id === r.person_id)?.deleted_at));
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
    const pp = db.people.find((x) => x.id === r.person_id);
    return { ...r, subject_name: b?.name || v?.make_model || pp?.full_name, person_role: pp?.role_title || null, amount_paid: c?.amount_paid ?? null, plate_no: v?.plate_no || null, location_name: l?.name, location_city: l?.city, location_is_main: l?.is_main,
      cycle_id: c?.id || null, reference_no: c?.reference_no || null, issuer: c?.issuer || null, issued_on: c?.issued_on || null, expires_on: c?.expires_on || null,
      document_count: n, open_request_id: open?.id || null, days_left: dl, base_status: base, status: prog ? 'in_progress' : base,
      is_overdue: dl !== null && dl < 0,
      next_action: prog ? 'record_renewal' : ['action_required', 'renew_soon'].includes(base) ? 'renew' : base === 'needs_information' ? ((r.expires && !c?.expires_on) || !c ? 'add_details' : 'upload') : null };
  });
}

let authCb = () => {};
export const sb = {};
export const auth = {
  session: async () => (globalThis.PP_LOGGED_OUT ? null : { user }),
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
    vehicles: db.vehicles.filter((v) => !v.deleted_at), people: db.people.filter((x) => !x.deleted_at), services: SERVICES,
    reqs: statusRows(), requests: db.requests.map((a) => ({ ...a })),
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
  const ctpl = addReq('vehicle', id, null, types[4], f.ctpl_expires ? { reference_no: f.ctpl_policy_no, issuer: f.ctpl_provider, expires_on: f.ctpl_expires } : null);
  return { vehicle_id: id, registration: { requirement_id: reg.id, cycle_id: db.cycles.find((c) => c.requirement_id === reg.id)?.id || null }, ctpl: { requirement_id: ctpl.id, cycle_id: db.cycles.find((c) => c.requirement_id === ctpl.id)?.id || null } };
}
export const updateVehicle = async (id, patch) => Object.assign(db.vehicles.find((v) => v.id === id), patch);
const tableOf = { people: 'people', businesses: 'businesses', business_locations: 'locations', vehicles: 'vehicles', requirements: 'requirements', requirement_cycles: 'cycles', documents: 'documents' };
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
  db.cycles.push({ id, requirement_id: requirementId, seq: ++seq, created_at: new Date().toISOString(), reference_no: f.reference_no, issuer: f.issuer, issued_on: f.issued_on, expires_on: f.expires_on, amount_paid: f.amount_paid ?? null });
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
export const cancelHelpRequest = async (id) => { const a = db.requests.find((x) => x.id === id); a.status = 'cancelled'; event(a, 'cancelled', 'You cancelled this request.'); };
export const listNotifications = async (limit = 100) => [...db.notifications].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, limit);
export const markRead = async (ids) => ids.forEach((id) => { const n = db.notifications.find((x) => x.id === id); if (n) n.read_at = 'now'; });
export const markAllRead = async () => db.notifications.forEach((n) => { n.read_at = 'now'; });
export const deleteNotification = async (id) => { db.notifications = db.notifications.filter((n) => n.id !== id); };
export const clearNotifications = async () => { db.notifications = []; };
export const myDeliveryLog = async () => [{ id: 1, channel: 'email', subject: 'PermitPal: 2 items need attention', body_text: '', status: 'sent', created_at: new Date().toISOString() }];
export const history = async () => db.audit;
export const entityHistory = async () => db.audit;
export async function trash() {
  const d = (a) => a.filter((x) => x.deleted_at);
  return { people: d(db.people), businesses: d(db.businesses), locations: d(db.locations), vehicles: d(db.vehicles), requirements: d(db.requirements), cycles: d(db.cycles), documents: d(db.documents) };
}
export const invites = async () => [];
export const invite = async () => ({});
export const channelStatus = async () => ({ email: false, sms: false, whatsapp: false });
export const payments = async () => [];
export const updatePrefs = async () => {};
export const updateProfile = async () => {};
export const adminOrgs = async () => [{ id: org.id, name: org.name, plan_id: org.plan_id, created_at: new Date().toISOString(), owner_email: user.email, members: 1, businesses: 1, vehicles: 1, open_requests: db.requests.length }];
export const adminRequests = async () => db.requests.map((a) => ({ ...a, orgs: { name: org.name } }));
export const adminOutbox = async () => [];
export const adminRequestDocs = async () => [];

// Remaining actions: accepted in the demo so every button works.
export const invitePreview = async () => ({ org_name: org.name, email: 'teammate@test.ph', role: 'member', invited_by: 'Sadie Luna', status: 'pending' });
export const acceptInvite = async () => org.id;
export const createOrg = async () => org.id;
export const renameOrg = async (id, name) => { org.name = name; };
export const setMemberRole = async () => {};
export const removeMember = async () => {};
export const revokeInvite = async () => {};
export const uploadAvatar = async () => null;
export const avatarUrl = async () => null;
export const requestOrgDeletion = async () => { org.deleted_at = new Date().toISOString(); org.purge_after = new Date(Date.now() + 30 * 864e5).toISOString(); };
export const cancelOrgDeletion = async () => { org.deleted_at = null; org.purge_after = null; };
export const adminSetPlan = async () => {};
export const startCheckout = async () => { throw new Error('Payments are off in free mode.'); };

// ---------------------------------------------------------------- people
export async function createPerson(orgId, f) {
  const x = { id: uid(), org_id: orgId, full_name: f.full_name, role_title: f.role_title || '', business_id: f.business_id || null, deleted_at: null };
  db.people.push(x);
  for (const code of f.types || []) addReq('person', x.id, null, types.find((t) => t.code === code));
  log(`Added ${x.full_name}`);
  return x.id;
}
export const updatePerson = async (id, patch) => Object.assign(db.people.find((x) => x.id === id), patch);

// ---------------------------------------------------------------- done-for-you orders
const now = () => new Date().toISOString();
function event(a, kind, message, byStaff = false, file = null) {
  db.events.push({ id: ++seq, request_id: a.id, org_id: a.org_id, by_staff: byStaff, kind, message, file_path: file, file_name: file, created_at: now() });
}
const settings = { gcash_name: 'PermitPal Services', gcash_number: '0917 000 0000', bank_name: 'BPI', bank_account_name: 'PermitPal Services', bank_account_number: '0000 0000 00', payment_note: 'Send the exact amount, then enter the reference number below.', online_payments: 'off', support_phone: '', support_email: '' };
export const listServices = async () => SERVICES;
export async function requestService(f) {
  const s = SERVICES.find((x) => x.code === f.service_code);
  const r = f.requirement_id ? statusRows().find((x) => x.id === f.requirement_id) : null;
  const subj = r?.subject_name || db.businesses.find((b) => b.id === f.business_id)?.name || db.vehicles.find((v) => v.id === f.vehicle_id)?.make_model
    || db.people.find((x) => x.id === f.person_id)?.full_name || org.name;
  const a = { id: uid(), org_id: f.org_id, created_by: user.id, service_code: s.code, requirement_id: f.requirement_id || null,
    business_id: f.business_id || r?.business_id || null, vehicle_id: f.vehicle_id || r?.vehicle_id || null, person_id: f.person_id || r?.person_id || null,
    requirement_name: r?.name || s.name, subject_label: subj, notes: f.notes || null, rush: !!f.rush, contact_method: f.contact_method || 'email',
    contact_value: f.contact_value || null, docs_status: f.docs_status || 'not_sure', status: 'submitted', payment_status: 'unpaid',
    due_on: r?.expires_on || null, created_at: now(), updated_at: now() };
  db.requests.unshift(a);
  event(a, 'created', a.notes || 'Request sent');
  return a.id;
}
export const orderRefunds = async (id) => db.refunds.filter((r) => r.request_id === id);
export const staffAccessLog = async () => db.access;
export const getRequest = async (id) => { const a = db.requests.find((x) => x.id === id); return a ? { ...a } : null; };
export const orderEvents = async (id) => db.events.filter((e) => e.request_id === id);
export async function acceptQuote(id) {
  const a = db.requests.find((x) => x.id === id);
  if (a.status !== 'quoted') throw new Error('There is no quote to accept.');
  Object.assign(a, { accepted_at: now(), payment_status: a.quote_php ? 'awaiting_payment' : 'waived', status: a.quote_php ? 'awaiting_customer' : 'in_progress' });
  event(a, 'accepted', 'Quote accepted');
}
export async function submitPayment(a0, { method, ref, file }) {
  const a = db.requests.find((x) => x.id === a0.id);
  if (!ref && !(file && file.size)) throw new Error('Add the reference number or a screenshot of the payment.');
  Object.assign(a, { payment_status: 'pending_verification', payment_method: method, payment_ref: ref || null });
  event(a, 'payment', `Payment sent by ${method}${ref ? ', ref ' + ref : ''}`, false, file?.name || null);
}
export async function addOrderMessage(a, message, file) { event(a, file ? 'file' : 'message', message || '', false, file?.name || null); }
export const uploadRequestFile = async (orgId, reqId, file) => ({ path: `${orgId}/requests/${reqId}/${file.name}`, name: file.name });
export const startOrderCheckout = async () => { throw new Error('Online card/GCash checkout is not switched on yet. Please use the GCash or bank transfer details shown instead.'); };
export const appSettings = async () => ({ ...settings });

// ---------------------------------------------------------------- partners, referrals, sharing, workspaces
export const listPartners = async () => db.partners.filter((p) => p.published);
export async function requestReferral(f) {
  const r = { id: uid(), org_id: f.org_id, partner_id: f.partner_id, requirement_id: f.requirement_id || null, note: f.note || null, status: 'new', created_at: now(), commission: null };
  db.referrals.unshift(r);
  return r.id;
}
export const myReferrals = async () => db.referrals.map(({ commission, ...r }) => r);
export async function createShare(f) {
  const x = { id: uid(), org_id: f.org_id, scope: f.scope, subject_id: f.subject_id || null, label: f.label || '', show_refs: f.show_refs !== false,
    token: 'demo' + uid().replace(/-/g, '').slice(0, 20), view_count: 0, last_viewed_at: null, revoked_at: null,
    expires_at: new Date(Date.now() + Number(f.days || 30) * 864e5).toISOString(), created_at: now() };
  db.shares.unshift(x);
  return x;
}
export const listShares = async () => db.shares;
export const revokeShare = async (id) => { db.shares.find((x) => x.id === id).revoked_at = now(); };
export async function getSharedCompliance() {
  return { org_name: org.name, label: '', as_of: today(), generated_at: now(), expires_at: addDays(30), items: statusRows().map((r) => ({ ...r, on_file: r.document_count > 0 })) };
}

// ---------------------------------------------------------------- admin console
export async function adminQuote(id, fee, gov, note) {
  const a = db.requests.find((x) => x.id === id);
  Object.assign(a, { quote_service_fee: Number(fee), quote_gov_fees: Number(gov), quote_php: Number(fee) + Number(gov), quote_note: note || null, quoted_at: now(), status: 'quoted' });
  event(a, 'quote', `Quote sent: ₱${a.quote_php}`, true);
}
export async function adminConfirmPayment(id, okPaid, note) {
  const a = db.requests.find((x) => x.id === id);
  Object.assign(a, okPaid ? { payment_status: 'paid', paid_at: now(), status: 'in_progress' } : { payment_status: 'awaiting_payment' });
  event(a, 'payment', okPaid ? 'Payment confirmed' : note || 'We could not find this payment. Please check the reference.', true);
}
export async function adminUpdateOrder(a0, { status, message, file, govActual, provider }) {
  const a = db.requests.find((x) => x.id === a0.id);
  if (status) a.status = status;
  if (provider) a.provider_name = provider;
  if (govActual !== '' && govActual != null) a.gov_fees_actual = Number(govActual);
  event(a, file ? 'file' : status ? 'status' : 'message', message || (status ? `Status: ${status}` : ''), true, file?.name || null);
}
export async function adminRecordRenewal(a0, f, file) {
  const a = db.requests.find((x) => x.id === a0.id);
  const cyc = await saveCycle({ requirementId: a.requirement_id, ...f, amount_paid: f.amount_paid === '' ? null : Number(f.amount_paid) });
  if (file && file.size) await uploadDocument({ requirementId: a.requirement_id, cycleId: cyc, file });
  a.status = 'completed';
  event(a, 'completed', 'New permit recorded and saved to your account', true);
}
export const adminServices = async () => SERVICES;
export const adminSaveService = async (code, patch) => Object.assign(SERVICES.find((x) => x.code === code), patch);
export const adminPartners = async () => db.partners;
export async function adminSavePartner(id, row) { if (id) Object.assign(db.partners.find((p) => p.id === id), row); else db.partners.push({ id: uid(), published: true, sort: 100, ...row }); }
export const adminReferrals = async () => db.referrals.map((r) => ({ ...r, orgs: { name: org.name }, partners: db.partners.find((p) => p.id === r.partner_id), referral_commissions: r.commission || { amount_php: null, status: 'pending' } }));
export const adminSaveReferral = async (id, status) => { db.referrals.find((r) => r.id === id).status = status; };
export const adminSaveCommission = async (id, patch) => { const r = db.referrals.find((x) => x.id === id); r.commission = { ...(r.commission || {}), ...patch }; };
export const adminSettings = appSettings;
db.refunds = []; db.access = [];
export async function adminRefund(id, f) {
  const a = db.requests.find((x) => x.id === id);
  if (!['paid', 'refunded'].includes(a.payment_status)) throw new Error('Nothing was paid on this order.');
  db.refunds.push({ id: uid(), request_id: id, amount_php: Number(f.amount), kind: f.kind, reason: f.reason, method: f.method, reference: f.reference, created_at: now() });
  if (f.kind === 'full') Object.assign(a, { payment_status: 'refunded', status: a.status === 'completed' ? a.status : 'cancelled' });
  event(a, 'payment', `Refund sent: ₱${f.amount}. ${f.reason}`, true);
}
export const adminTestEmail = async () => { throw new Error('Email is not connected yet. Add RESEND_API_KEY and EMAIL_FROM first.'); };
export async function staffFileUrl(path) {
  const d = db.documents.find((x) => x.storage_path === path);
  db.access.unshift({ id: uid(), staff_name: 'Sadie Luna', file_name: d?.file_name || path.split('/').pop(), reason: 'Request: sample', created_at: now() });
  return 'data:application/pdf;base64,JVBERi0=';
}
export const adminSaveSetting = async (key, value) => { settings[key] = value; };

// ---------------------------------------------------------------- sample partners and orders
db.partners.push(
  { id: 'p1', category: 'insurance', name: 'Sample Insurance Agency', description: 'Accredited CTPL and comprehensive car insurance.', offer: 'Free CTPL delivery', coverage: 'Metro Manila', website: '', type_codes: ['ctpl', 'comprehensive_insurance'], published: true, sort: 10, commission_terms: '10% of premium' },
  { id: 'p2', category: 'pest_control', name: 'Sample Pest Control', description: 'Pest control certificates for sanitary permits.', offer: '', coverage: 'Cebu', website: '', type_codes: ['sanitary_permit'], published: true, sort: 20, commission_terms: '₱500 per job' },
);
if (globalThis.PP_DEMO) {
  db.people.push({ id: 'pp1', org_id: org.id, full_name: 'Jun Reyes', role_title: 'Delivery driver', business_id: 'b2', deleted_at: null });
  addReq('person', 'pp1', null, types.find((t) => t.code === 'drivers_license'), { reference_no: 'N01-23-456789', expires_on: addDays(48) });
  addReq('person', 'pp1', null, types.find((t) => t.code === 'health_certificate'), { reference_no: 'HC-2291', expires_on: addDays(-3) });
  const fsic = db.requirements.find((r) => r.business_id === 'b2' && r.type_code === 'fsic' && r.location_id === 'l3');
  const a = { id: 'ord1', org_id: org.id, created_by: user.id, service_code: 'renew_fsic', requirement_id: fsic.id, business_id: 'b2', vehicle_id: null, person_id: null,
    requirement_name: fsic.name, subject_label: 'Visayas Sari-Sari Distribution Co. · Mandaue warehouse', notes: 'Inspection usually takes a week here.', rush: false,
    contact_method: 'email', contact_value: null, docs_status: 'have', status: 'quoted', payment_status: 'unpaid', quote_service_fee: 1500, quote_gov_fees: 1800,
    quote_php: 3300, quote_note: 'Government fee is based on last year\'s assessment. If it ends up lower, we refund the difference.', quoted_at: now(), due_on: null, created_at: now(), updated_at: now() };
  db.requests.unshift(a);
  event(a, 'created', a.notes);
  event(a, 'quote', 'Quote sent: ₱3,300', true);
  db.notifications.push(
    { id: 'n3', user_id: user.id, org_id: org.id, kind: 'help', title: 'Your FSIC quote is ready: ₱3,300', body: 'Mandaue warehouse', link: '#/services/orders/ord1', read_at: null, created_at: new Date(Date.now() - 2 * 3600e3).toISOString() },
    { id: 'n4', user_id: user.id, org_id: org.id, kind: 'system', title: 'CTPL Insurance renewed', body: 'Toyota Hilux', link: `#/requirement/${db.requirements.find((r) => r.vehicle_id === 'v2' && r.type_code === 'ctpl').id}`, read_at: 'now', created_at: new Date(Date.now() - 3 * 864e5).toISOString() });
}
if (globalThis.PP_DEMO) {
  // Sample amounts paid so Costs & budget has something to show.
  const fee = { mayors_permit: 8500, barangay_clearance: 1000, fsic: 1800, sanitary_permit: 600, lto_registration: 1600, ctpl: 610, drivers_license: 585 };
  for (const c of db.cycles) {
    const r = db.requirements.find((x) => x.id === c.requirement_id);
    if (fee[r?.type_code] && c.expires_on) c.amount_paid = fee[r.type_code];
  }
}
