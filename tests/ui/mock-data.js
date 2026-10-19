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
const org = { id: 'o1', name: 'Aligned Solutions', plan_id: 'free', plan_expires_at: null, deleted_at: null, role: 'owner', kind: 'business', trial_ends_at: null, required_types: [], contact_name: null, contact_email: null };
const plans = [
  { id: 'free', name: 'Free', available: true, price_php_monthly: 0, max_members: null, max_locations_per_business: null, paid_channels: false, features: ['Unlimited businesses'] },
  { id: 'business', name: 'Business', price_php_monthly: null, max_members: 5, max_locations_per_business: 1, paid_channels: true, features: ['More'] },
  { id: 'business_plus', name: 'Business Plus', price_php_monthly: null, max_members: 20, max_locations_per_business: null, paid_channels: true, features: ['Branches'], available: false },
  { id: 'fleet', name: 'Fleet', available: true, paid_channels: true, price_php_monthly: 1490, features: ['Fleet board: every vehicle\'s registration, CTPL, emission and inspection', 'Import vehicles from a spreadsheet', 'Export for your records', 'Everything in Free'] },
  { id: 'firm', name: 'Accounting firm', available: true, price_php_monthly: 1990, features: ['Client board: every client\'s permits on one screen', 'One-click reminders to clients', 'Everything in Free'] },
  { id: 'head_office', name: 'Head office', available: true, price_php_monthly: 4990, features: ['Branch board: every branch and franchisee on one screen', 'One-click reminders to branches', 'Everything in Free'] },
  { id: 'property', name: 'Property', available: true, price_php_monthly: 9990, features: ['Tenant board: every tenant\'s permits on one screen', 'Download tenants\' shared copies', 'Everything in Free'] },
];
const types = [
  { code: 'mayors_permit', name: "Mayor's / Business Permit", subject: 'business', expires: true, due_rule: 'jan20', per_location: true, help_text: 'Renew by Jan 20.' },
  { code: 'bir_cor', name: 'BIR Certificate of Registration (Form 2303)', subject: 'business', expires: false, due_rule: 'manual', per_location: true, help_text: 'Does not expire.' },
  { code: 'fsic', name: 'Fire Safety Inspection Certificate (FSIC)', subject: 'business', expires: true, due_rule: 'annual', per_location: true },
  { code: 'lto_registration', name: 'LTO Registration (OR/CR)', subject: 'vehicle', expires: true, due_rule: 'lto_plate', per_location: false },
  { code: 'ctpl', name: 'CTPL Insurance', subject: 'vehicle', expires: true, due_rule: 'lto_plate', per_location: false },
  { code: 'emission_test', name: 'Emission Test', subject: 'vehicle', expires: true, due_rule: 'lto_plate', per_location: false, help_text: 'Needed before LTO renewal.' },
  { code: 'mvir', name: 'Motor Vehicle Inspection Report (MVIR)', subject: 'vehicle', expires: true, due_rule: 'lto_plate', per_location: false },
  { code: 'drivers_license', name: "Driver's License", subject: 'person', agency: 'LTO', expires: true, due_rule: 'manual', per_location: false, auto_add: false },
  { code: 'health_certificate', name: 'Health Certificate', subject: 'person', agency: 'City or municipal health office', expires: true, due_rule: 'annual', per_location: false, auto_add: false },
  { code: 'nbi_clearance', name: 'NBI Clearance', subject: 'person', agency: 'NBI', expires: true, due_rule: 'annual', per_location: false, auto_add: false },
];
const db = { people: [], events: [], shares: [], referrals: [], partners: [], businesses: [], locations: [], vehicles: [], requirements: [], cycles: [], documents: [], requests: [], notifications: [], audit: [] };
db.members = [{ user_id: 'u1', role: 'owner', profile: { first_name: 'Sadie', last_name: 'Luna', email: 'sadie@test.ph' } }];
let seq = 0;
// Mirrors the database's audit triggers: every change gets a type (entity), an action and a plain summary.
let auditSeq = 1000;
const log = (summary, extra = {}) => db.audit.unshift({ id: ++auditSeq, summary, action: 'created', entity: 'businesses', actor_id: user.id, created_at: new Date().toISOString(), ...extra });
const reqLabel = (r) => {
  const who = r.business_id ? db.businesses.find((b) => b.id === r.business_id)?.name : r.vehicle_id ? db.vehicles.find((v) => v.id === r.vehicle_id)?.make_model : db.people.find((p) => p.id === r.person_id)?.full_name;
  return `${r.name}${who ? ' for ' + who : ''}`;
};
const ids = (r) => ({ business_id: r?.business_id || null, vehicle_id: r?.vehicle_id || null, requirement_id: r?.id || null });

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
  log('Added business "Corner <Bakery> & Co"', { entity: 'businesses', business_id: b.id });
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
  db.documents.push({ id: uid(), requirement_id: last(db.requirements).id, cycle_id: last(db.cycles).id, file_name: 'BIR_2303.pdf', storage_path: 'o1/demo/BIR_2303.pdf', mime_type: 'application/pdf', size_bytes: 90000, created_at: new Date().toISOString(), deleted_at: null });
  addReq('business', 'b2', 'l3', types[0], { reference_no: 'MP-2026-0911', expires_on: addDays(-12) });
  addReq('business', 'b2', 'l3', types[2]);
  db.requirements.forEach((r) => { if (r.business_id === 'b2') r.confidence = 'confirmed'; });
  const v2 = { id: 'v2', org_id: org.id, make_model: 'Toyota Hilux', plate_no: 'NBC 4417', vehicle_type: 'Pickup', cr_no: 'CR-2', mv_file_no: '', business_id: 'b2', deleted_at: null };
  const v3 = { id: 'v3', org_id: org.id, make_model: 'Honda Click 125i', plate_no: '123 ABC', vehicle_type: 'Motorcycle', cr_no: '', mv_file_no: '', business_id: null, deleted_at: null };
  db.vehicles.push(v2, v3);
  addReq('vehicle', 'v2', null, types[3], { reference_no: 'OR-5521', expires_on: addDays(160) });
  db.documents.push({ id: uid(), requirement_id: last(db.requirements).id, cycle_id: last(db.cycles).id, file_name: 'Hilux_OR.jpg', storage_path: 'o1/demo/Hilux_OR.jpg', mime_type: 'image/jpeg', size_bytes: 240000, created_at: new Date().toISOString(), deleted_at: null });
  addReq('vehicle', 'v2', null, types[4], { reference_no: 'CTPL-88', issuer: 'Malayan Insurance', expires_on: addDays(160) });
  addReq('vehicle', 'v3', null, types[3], { reference_no: 'OR-77', expires_on: addDays(5) });
  // A fuller year for the calendar strip.
  addReq('business', 'b2', 'l2', types[2], { reference_no: 'FSIC-C-221', expires_on: addDays(130) });
  db.documents.push({ id: uid(), requirement_id: last(db.requirements).id, cycle_id: last(db.cycles).id, file_name: 'FSIC_Cebu.pdf', storage_path: 'o1/demo/FSIC_Cebu.pdf', mime_type: 'application/pdf', size_bytes: 80000, created_at: new Date().toISOString(), deleted_at: null });
  addReq('business', 'b1', 'l1', { code: 'sanitary_permit', name: 'Sanitary Permit', expires: true }, { reference_no: 'SP-88', expires_on: addDays(250) });
  db.documents.push({ id: uid(), requirement_id: last(db.requirements).id, cycle_id: last(db.cycles).id, file_name: 'sanitary.pdf', storage_path: 'o1/demo/sanitary.pdf', mime_type: 'application/pdf', size_bytes: 60000, created_at: new Date().toISOString(), deleted_at: null });
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
      assignee_id: r.assignee_id || null, assigned_at: r.assigned_at || null,
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
const me = { id: user.id, email: user.email, first_name: 'Sadie', last_name: 'Luna', role_title: '', phone: null, phone_verified_at: null, lang: 'en', current_org_id: org.id, is_platform_admin: true };
const myPrefs = { email_enabled: true, sms_enabled: false, whatsapp_enabled: false, business_alerts: true, vehicle_alerts: true, remind_30: true, remind_7: true, remind_1: true, weekly_digest: true };
export async function loadMe() {
  return { profile: { ...me }, orgs: [org], plans, prefs: { ...myPrefs } };
}
export async function loadOrgData() {
  return {
    types, businesses: db.businesses.filter((b) => !b.deleted_at), locations: db.locations.filter((l) => !l.deleted_at),
    vehicles: db.vehicles.filter((v) => !v.deleted_at), people: db.people.filter((x) => !x.deleted_at), services: SERVICES,
    reqs: statusRows(), requests: db.requests.map((a) => ({ ...a })),
    members: db.members.map((m) => ({ ...m, profile: { ...m.profile } })),
    care: careData(),
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
  types.filter((t) => t.subject === 'business' && t.auto_add !== false).forEach((t) => addReq('business', id, t.per_location ? lid : null, t));
  log(`Added business "${f.name}"`, { entity: 'businesses', business_id: id });
  return id;
}
export const updateBusiness = async (id, patch) => { const b = Object.assign(db.businesses.find((x) => x.id === id), patch); log(`Updated details for business "${b.name}"`, { entity: 'businesses', action: 'updated', business_id: id }); return b; };
export async function addLocation(bizId, f) {
  const id = uid();
  db.locations.push({ id, business_id: bizId, name: f.name, city: f.city, address: f.address, is_main: false, deleted_at: null });
  types.filter((t) => t.subject === 'business' && t.per_location && t.auto_add !== false).forEach((t) => addReq('business', bizId, id, t));
  log(`Added branch "${f.name}" to ${db.businesses.find((b) => b.id === bizId)?.name || 'a business'}`, { entity: 'business_locations', business_id: bizId });
  return id;
}
export const updateLocation = async (id, patch) => Object.assign(db.locations.find((l) => l.id === id), patch);
export async function createVehicle(orgId, f) {
  const id = uid();
  db.vehicles.push({ id, org_id: orgId, make_model: f.make_model, plate_no: (f.plate_no || '').toUpperCase(), vehicle_type: f.vehicle_type, cr_no: f.cr_no || '', mv_file_no: '', business_id: null, deleted_at: null });
  const reg = addReq('vehicle', id, null, types[3], f.registration_expires ? { reference_no: f.or_no, expires_on: f.registration_expires } : null);
  const ctpl = addReq('vehicle', id, null, types[4], f.ctpl_expires ? { reference_no: f.ctpl_policy_no, issuer: f.ctpl_provider, expires_on: f.ctpl_expires } : null);
  log(`Added vehicle ${f.make_model}${f.plate_no ? ' (' + String(f.plate_no).toUpperCase() + ')' : ''}`, { entity: 'vehicles', vehicle_id: id });
  return { vehicle_id: id, registration: { requirement_id: reg.id, cycle_id: db.cycles.find((c) => c.requirement_id === reg.id)?.id || null }, ctpl: { requirement_id: ctpl.id, cycle_id: db.cycles.find((c) => c.requirement_id === ctpl.id)?.id || null } };
}
export const updateVehicle = async (id, patch) => { const v = Object.assign(db.vehicles.find((x) => x.id === id), patch); log(`Updated details for vehicle ${v.make_model}`, { entity: 'vehicles', action: 'updated', vehicle_id: id }); return v; };
const tableOf = { people: 'people', businesses: 'businesses', business_locations: 'locations', vehicles: 'vehicles', requirements: 'requirements', requirement_cycles: 'cycles', documents: 'documents' };
function describe(t, x) {
  if (t === 'businesses') return [`business "${x.name}"`, { business_id: x.id }];
  if (t === 'business_locations') return [`branch "${x.name}"`, { business_id: x.business_id }];
  if (t === 'vehicles') return [`vehicle ${x.make_model}`, { vehicle_id: x.id }];
  if (t === 'people') return [x.full_name, {}];
  if (t === 'requirements') return [reqLabel(x), ids(x)];
  const r = db.requirements.find((q) => q.id === x.requirement_id);
  if (t === 'requirement_cycles') return [`a past record of ${r ? reqLabel(r) : 'a permit'}`, ids(r)];
  return [`file "${x.file_name}"${r ? ' from ' + reqLabel(r) : ''}`, ids(r)];
}
export const softDelete = async (t, id) => { const x = db[tableOf[t]].find((y) => y.id === id); x.deleted_at = new Date().toISOString(); const [d, e] = describe(t, x); log(`Deleted ${d}`, { entity: t, action: 'deleted', ...e }); };
export const restore = async (t, id) => { const x = db[tableOf[t]].find((y) => y.id === id); x.deleted_at = null; const [d, e] = describe(t, x); log(`Restored ${d}`, { entity: t, action: 'restored', ...e }); };
export async function addRequirement(f) {
  const t = types.find((x) => x.code === f.type_code) || { code: null, name: f.name, expires: f.expires ?? true };
  const hasRecord = f.reference_no || f.issuer || f.issued_on || f.expires_on;
  const r = addReq(f.subject, f.subject_id, f.location_id || null, t, hasRecord ? { reference_no: f.reference_no || null, issuer: f.issuer || null, issued_on: f.issued_on || null, expires_on: f.expires_on || null } : null);
  r.confidence = 'confirmed';
  log(`Added ${reqLabel(r)}`, { entity: 'requirements', ...ids(r) });
  return { requirement_id: r.id, cycle_id: hasRecord ? last(db.cycles).id : null };
}
export const updateRequirement = async (id, patch) => {
  const r = db.requirements.find((x) => x.id === id); const started = !r.renewal_started_at && patch.renewal_started_at;
  Object.assign(r, patch);
  log(started ? `Started renewing ${reqLabel(r)}` : `Updated ${reqLabel(r)}`, { entity: 'requirements', action: 'updated', ...ids(r) });
  return r;
};
export async function requirementDetail(id) {
  return { cycles: db.cycles.filter((c) => c.requirement_id === id && !c.deleted_at).sort((a, b) => b.seq - a.seq),
    documents: db.documents.filter((d) => d.requirement_id === id && !d.deleted_at), activity: db.audit.filter((a) => a.requirement_id === id),
    ticks: (db.ticks || []).filter((t) => t.requirement_id === id).map((t) => ({ ...t })) };
}
export async function saveCycle({ cycleId, requirementId, ...f }) {
  if (cycleId) {
    Object.assign(db.cycles.find((c) => c.id === cycleId), f);
    const r0 = db.requirements.find((x) => x.id === requirementId);
    log(`Updated the record for ${reqLabel(r0)}`, { entity: 'requirement_cycles', action: 'updated', ...ids(r0) });
    return cycleId;
  }
  const prior = db.cycles.filter((c) => c.requirement_id === requirementId && !c.deleted_at).length;
  const id = uid();
  db.cycles.push({ id, requirement_id: requirementId, seq: ++seq, created_at: new Date().toISOString(), reference_no: f.reference_no, issuer: f.issuer, issued_on: f.issued_on, expires_on: f.expires_on, amount_paid: f.amount_paid ?? null });
  const r = db.requirements.find((x) => x.id === requirementId);
  r.renewal_started_at = null; r.confidence = 'confirmed';
  log(`${prior ? 'Renewed' : 'Recorded'} ${reqLabel(r)}${f.expires_on ? ' - expires ' + new Date(f.expires_on + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : ''}`,
    { entity: 'requirement_cycles', action: prior ? 'renewed' : 'recorded', ...ids(r) });
  return id;
}
export const checkFile = (file) => (!file || !file.size ? 'Please choose a file.' : null);
export async function uploadDocument({ requirementId, cycleId, file }) {
  const d = { id: uid(), requirement_id: requirementId, cycle_id: cycleId, file_name: file.name, storage_path: 'o1/' + file.name, mime_type: file.type, size_bytes: file.size, created_at: new Date().toISOString(), deleted_at: null };
  db.documents.push(d);
  const r = db.requirements.find((x) => x.id === requirementId);
  log(`Uploaded "${file.name}" for ${r ? reqLabel(r) : 'a permit'}`, { entity: 'documents', action: 'uploaded', ...ids(r) });
  return d;
}
// Demo files: a real one-page PDF (or a picture for image files) so View, Download and the inspection pack work.
function samplePdf(title) {
  const text = `BT /F1 22 Tf 72 720 Td (${title.replace(/[()\\]/g, '')}) Tj 0 -34 Td /F1 13 Tf (PermitPal demo - sample document, nothing real is stored.) Tj ET`;
  const objs = ['<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    `<</Length ${text.length}>>stream\n${text}\nendstream`, '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'];
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj${o}endobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([out], { type: 'application/pdf' });
}
async function sampleImage(title) {
  const c = document.createElement('canvas'); c.width = 900; c.height = 560;
  const g = c.getContext('2d'); g.fillStyle = '#FFFEF9'; g.fillRect(0, 0, 900, 560); g.strokeStyle = '#1F2A44'; g.lineWidth = 6; g.strokeRect(20, 20, 860, 520);
  g.fillStyle = '#1F2A44'; g.font = 'bold 40px sans-serif'; g.fillText(title.slice(0, 34), 60, 140);
  g.font = '24px sans-serif'; g.fillStyle = '#4B5568'; g.fillText('PermitPal demo - sample document', 60, 200);
  return new Promise((res) => c.toBlob(res, 'image/png'));
}
export async function fileUrl(path) {
  const name = String(path || 'document.pdf').split('/').pop();
  const blob = /\.(jpe?g|png|webp)$/i.test(name) ? await sampleImage(name) : samplePdf(name);
  return URL.createObjectURL(blob);
}
export const orgDocuments = async () => db.documents.filter((d) => !d.deleted_at);
export const allCycles = async () => db.cycles;
export const cancelHelpRequest = async (id) => { const a = db.requests.find((x) => x.id === id); a.status = 'cancelled'; event(a, 'cancelled', 'You cancelled this request.'); };
export const listNotifications = async (limit = 100) => [...db.notifications].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, limit);
export const markRead = async (ids) => ids.forEach((id) => { const n = db.notifications.find((x) => x.id === id); if (n) n.read_at = 'now'; });
export const markAllRead = async () => db.notifications.forEach((n) => { n.read_at = 'now'; });
export const deleteNotification = async (id) => { db.notifications = db.notifications.filter((n) => n.id !== id); };
export const clearNotifications = async () => { db.notifications = []; };
export const myDeliveryLog = async () => [{ id: 1, channel: 'email', subject: 'PermitPal: 2 items need attention', body_text: '', status: 'sent', created_at: new Date().toISOString() }];
export const history = async (orgId, { before = null, entities = null, limit = 50 } = {}) => db.audit
  .filter((a) => (!entities || entities.includes(a.entity)) && (!before || a.id < before))
  .sort((a, b) => b.id - a.id).slice(0, limit);
// Like the real query: only this business's (or vehicle's) own changes.
export const entityHistory = async (column, id) => db.audit.filter((a) => a[column] === id);
export async function trash() {
  const d = (a) => a.filter((x) => x.deleted_at);
  return { people: d(db.people), businesses: d(db.businesses), locations: d(db.locations), vehicles: d(db.vehicles), requirements: d(db.requirements), cycles: d(db.cycles), documents: d(db.documents) };
}
export const invites = async () => [];
export const invite = async () => ({});
export const channelStatus = async () => ({ email: false, sms: !!globalThis.PP_SMS, whatsapp: false });
export const payments = async () => [];
export const updatePrefs = async (userId, patch) => { Object.assign(myPrefs, patch); };
export const updateProfile = async (userId, patch) => { if ('phone' in patch && patch.phone !== me.phone) me.phone_verified_at = null; Object.assign(me, patch); };
export const adminOrgs = async () => [{ id: org.id, name: org.name, plan_id: org.plan_id, created_at: new Date().toISOString(), owner_email: user.email, members: 1, businesses: 1, vehicles: 1, open_requests: db.requests.length }];
export const adminRequests = async () => db.requests.map((a) => ({ ...a, orgs: { name: org.name, care_gov_preapproval_php: org.care_gov_preapproval_php || 0 },
  care_plans: a.care_plan_id ? { billing: db.care.plans.find((p) => p.id === a.care_plan_id)?.billing || 'monthly' } : null }));
export const adminOutbox = async () => [];
export const adminRequestDocs = async () => [];

// Remaining actions: accepted in the demo so every button works.
export const invitePreview = async () => ({ org_name: org.name, email: 'teammate@test.ph', role: 'member', invited_by: 'Sadie Luna', status: 'pending' });
export const acceptInvite = async () => org.id;
db.managed = [];
export async function createOrg(name) {
  const o = { id: uid(), name, kind: 'business', contact_name: null, contact_email: null, last_nudged_at: null, created_at: new Date().toISOString() };
  db.managed.push(o);
  return o.id;
}
export const renameOrg = async (id, name) => { org.name = name; };
// Leaving the team (or becoming a viewer) hands their permits back to nobody, like the database does.
const unassign = (userId) => db.requirements.forEach((r) => { if (r.assignee_id === userId) { r.assignee_id = null; r.assigned_at = null; } });
export const setMemberRole = async (orgId, userId, role) => { const m = db.members.find((x) => x.user_id === userId); if (m) { m.role = role; if (role === 'viewer') unassign(userId); } };
export const removeMember = async (orgId, userId) => { db.members = db.members.filter((x) => x.user_id !== userId); unassign(userId); };
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
  log(`Added ${x.full_name}`, { entity: 'people' });
  return x.id;
}
export const updatePerson = async (id, patch) => { const p = Object.assign(db.people.find((x) => x.id === id), patch); log(`Updated details for ${p.full_name}`, { entity: 'people', action: 'updated' }); return p; };

// ---------------------------------------------------------------- done-for-you orders
const now = () => new Date().toISOString();
function event(a, kind, message, byStaff = false, file = null) {
  db.events.push({ id: ++seq, request_id: a.id, org_id: a.org_id, by_staff: byStaff, kind, message, file_path: file, file_name: file, created_at: now() });
}
const settings = { gcash_name: 'PermitPal Services', gcash_number: '0917 000 0000', bank_name: 'BPI', bank_account_name: 'PermitPal Services', bank_account_number: '0000 0000 00', payment_note: 'Send the exact amount, then enter the reference number below.', online_payments: 'off', support_phone: '', support_email: '' };
export const listServices = async () => SERVICES;
export async function requestService(f) {
  // Same rules as the database: authorization ticked, one open request per permit, no flooding.
  if (!f.consent) throw new Error('Please tick the box to confirm PermitPal may act for you on this request.');
  if (f.requirement_id && db.requests.some((a) => a.requirement_id === f.requirement_id && !['completed', 'cancelled'].includes(a.status))) {
    throw new Error('You already have an open request for this requirement.');
  }
  if (db.requests.filter((a) => !['completed', 'cancelled'].includes(a.status)).length >= 25) throw new Error('You have 25 open requests. Wait for some to finish, or cancel ones you no longer need.');
  const s = SERVICES.find((x) => x.code === f.service_code);
  const r = f.requirement_id ? statusRows().find((x) => x.id === f.requirement_id) : null;
  const subj = r?.subject_name || db.businesses.find((b) => b.id === f.business_id)?.name || db.vehicles.find((v) => v.id === f.vehicle_id)?.make_model
    || db.people.find((x) => x.id === f.person_id)?.full_name || org.name;
  const a = { id: uid(), org_id: f.org_id, created_by: user.id, service_code: s.code, requirement_id: f.requirement_id || null,
    business_id: f.business_id || r?.business_id || null, vehicle_id: f.vehicle_id || r?.vehicle_id || null, person_id: f.person_id || r?.person_id || null,
    requirement_name: r?.name || s.name, subject_label: subj, notes: f.notes || null, rush: !!f.rush, contact_method: f.contact_method || 'email',
    contact_value: f.contact_value || null, docs_status: f.docs_status || 'not_sure', status: 'submitted', payment_status: 'unpaid',
    due_on: r?.expires_on || null, created_at: now(), updated_at: now(), kind: f.kind || 'renew', consented_at: now(), quote_rush_fee: 0, steps_done: 0 };
  // A walk-through for a Care Plus branch is included once a year.
  if (s.visit && r && db.care) {
    const plan = db.care.plans.find((p) => p.status === 'active' && p.location_id === r.location_id && p.tier === 'branch_plus');
    if (plan && !db.requests.some((x) => x.care_plan_id === plan.id && SERVICES.find((y) => y.code === x.service_code)?.visit && x.status !== 'cancelled')) a.care_plan_id = plan.id;
  }
  db.requests.unshift(a);
  event(a, 'created', a.notes || 'Request sent');
  return a.id;
}
export const orderRefunds = async (id) => db.refunds.filter((r) => r.request_id === id);
export const staffAccessLog = async () => db.access;
export const getRequest = async (id) => { const a = db.requests.find((x) => x.id === id); return a ? { ...a } : null; };
export const orderEvents = async (id) => db.events.filter((e) => e.request_id === id);
export async function acceptQuote(id, access = false) {
  const a = db.requests.find((x) => x.id === id);
  if (a.status !== 'quoted') throw new Error('There is no quote to accept.');
  if (SERVICES.find((x) => x.code === a.service_code)?.needs_access && !access) throw new Error('Tick the box to give PermitPal temporary access, so we can set things up for you.');
  if (access) a.staff_access = true;
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
// Like the database: a firm paid per quote request shows only while its credit covers one more.
const LEADS = !!(globalThis.PP_FEATURES !== 'none');
const perLead = (p) => (p.fee_model || 'per_lead') === 'per_lead' && Number(p.lead_fee_php) > 0;
const partnerLive = (p) => !!p.published && (!LEADS || !perLead(p) || Number(p.credit_php || 0) >= Number(p.lead_fee_php));
db.credits = []; db.disputes = [];
export const listPartners = async () => db.partners.filter(partnerLive).map(({ website, contact_email, contact_phone, billing_email, credit_php, lead_fee_php, ...p }) => (LEADS ? p : { ...p, website }));
export async function requestReferral(f) {
  const p = db.partners.find((x) => x.id === f.partner_id);
  if (!p || !partnerLive(p)) throw new Error("That professional isn't taking new requests right now. Please choose another.");
  if (db.referrals.some((x) => x.org_id === f.org_id && x.partner_id === f.partner_id && (x.requirement_id || '') === (f.requirement_id || '') && Date.now() - Date.parse(x.created_at) < 7 * 864e5)) {
    throw new Error('You already sent this request this week. They will contact you soon.');
  }
  const r = { id: uid(), org_id: f.org_id, partner_id: f.partner_id, requirement_id: f.requirement_id || null, note: f.note || null, status: 'requested', created_at: now(), commission: null, placement_id: f.placement_id || null, token: uid() };
  db.referrals.unshift(r);
  if (perLead(p) && LEADS) {
    p.credit_php = Number(p.credit_php) - Number(p.lead_fee_php);
    db.credits.unshift({ id: uid(), partner_id: p.id, kind: 'lead', amount_php: -Number(p.lead_fee_php), balance_php: p.credit_php, referral_id: r.id, note: 'Quote request from ' + org.name, created_at: now() });
    r.commission = { amount_php: Number(p.lead_fee_php), status: 'paid' };
  } else if (perLead(p)) {
    db.charges.unshift({ id: uid(), partner_id: p.id, kind: 'lead', description: 'Quote request from ' + org.name, amount_php: Number(p.lead_fee_php), occurred_on: today(), referral_id: r.id, status: 'unbilled', statement_id: null });
  }
  if (f.placement_id) { const st = placementStat(f.placement_id); st.leads++; }
  return r.id;
}
export async function answerReferral(id, hired) {
  const r = db.referrals.find((x) => x.id === id);
  if (!r) throw new Error('Quote request not found.');
  Object.assign(r, { status: hired ? 'converted' : 'not_converted', outcome_at: now() });
}
// The firm's page from the link in the lead email.
export const demoLeadToken = () => [...db.referrals].sort((a, b) => b.created_at.localeCompare(a.created_at)).find((r) => r.token && !db.disputes.some((d) => d.referral_id === r.id))?.token;
export async function leadForFirm(token) {
  const r = db.referrals.find((x) => x.token === token);
  if (!r) return null;
  const d = db.disputes.find((x) => x.referral_id === r.id);
  const req = db.requirements.find((x) => x.id === r.requirement_id);
  const fee = -db.credits.filter((c) => c.referral_id === r.id && c.kind === 'lead').reduce((t, c) => t + c.amount_php, 0);
  const until = new Date(Date.parse(r.created_at) + 7 * 864e5).toISOString();
  return { firm: db.partners.find((p) => p.id === r.partner_id)?.name, business: r.org_name || org.name, permit: req?.name || null, sent_at: r.created_at, fee, report_until: until,
    can_report: !d && Date.now() < Date.parse(until), dispute: d ? { reason: d.reason, status: d.status, note: d.decision_note, credited: d.credited_php } : null };
}
export async function reportLead(token, reason, note) {
  const r = db.referrals.find((x) => x.token === token);
  if (!r) throw new Error("This link isn't valid.");
  if (!['spam', 'duplicate', 'unreachable', 'not_our_service'].includes(reason)) throw new Error('Choose a reason.');
  if (Date.now() - Date.parse(r.created_at) > 7 * 864e5) throw new Error('Reports are taken within 7 days of the request.');
  if (db.disputes.some((d) => d.referral_id === r.id)) throw new Error("You already reported this request. We'll email you our decision.");
  db.disputes.unshift({ id: uid(), referral_id: r.id, partner_id: r.partner_id, reason, note: note || null, status: 'open', credited_php: 0, decision_note: null, created_at: now() });
}
export const adminCredits = async () => db.credits.map((c) => ({ ...c }));
export const adminDisputes = async () => db.disputes.map((d) => {
  const r = db.referrals.find((x) => x.id === d.referral_id);
  return { ...d, partners: { name: db.partners.find((p) => p.id === d.partner_id)?.name }, referrals: r ? { created_at: r.created_at, note: r.note, orgs: { name: r.org_name || org.name } } : null };
});
export async function adminAddCredit(id, amount, method, ref, no) {
  const p = db.partners.find((x) => x.id === id);
  if (!perLead(p)) throw new Error('Credit is for firms that pay per quote request. Set their fee first.');
  if (!(amount > 0)) throw new Error('Enter the amount they paid, from ₱1 to ₱1,000,000.');
  if (!String(method || '').trim()) throw new Error('Say how they paid (GCash, bank transfer).');
  p.credit_php = Number(p.credit_php || 0) + amount;
  db.credits.unshift({ id: uid(), partner_id: id, kind: 'topup', amount_php: amount, balance_php: p.credit_php, note: 'Prepaid credit', paid_method: method, paid_ref: ref || null, bir_invoice_no: no || null, created_at: now() });
  return p.credit_php;
}
export async function adminAdjustCredit(id, amount, note) {
  const p = db.partners.find((x) => x.id === id);
  if (!amount) throw new Error('Enter the change in pesos (minus to take off).');
  if (String(note || '').trim().length < 5) throw new Error("Say why (kept with the firm's credit history).");
  if (Number(p.credit_php || 0) + amount < 0) throw new Error(`They only have ₱${Number(p.credit_php || 0).toLocaleString()} in credit.`);
  p.credit_php = Number(p.credit_php || 0) + amount;
  db.credits.unshift({ id: uid(), partner_id: id, kind: 'adjust', amount_php: amount, balance_php: p.credit_php, note, created_at: now() });
  return p.credit_php;
}
export async function adminDecideDispute(id, accept, note) {
  const d = db.disputes.find((x) => x.id === id);
  if (d.status !== 'open') throw new Error('This report was already decided.');
  if (!accept && String(note || '').trim().length < 5) throw new Error('Say why, in a sentence the firm will read.');
  let fee = 0;
  if (accept) {
    fee = -db.credits.filter((c) => c.referral_id === d.referral_id && c.kind === 'lead').reduce((t, c) => t + c.amount_php, 0);
    if (fee > 0) {
      const p = db.partners.find((x) => x.id === d.partner_id);
      p.credit_php = Number(p.credit_php || 0) + fee;
      db.credits.unshift({ id: uid(), partner_id: p.id, kind: 'refund', amount_php: fee, balance_php: p.credit_php, referral_id: d.referral_id, note: 'Credit back: reported lead accepted', created_at: now() });
    }
  }
  Object.assign(d, { status: accept ? 'accepted' : 'declined', credited_php: fee, decision_note: note || null, decided_at: now() });
}
export const myReferrals = async () => db.referrals.filter((r) => r.org_id === org.id).map(({ commission, token, ...r }) => r);
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
export async function adminQuote(id, fee, gov, note, rush = 0) {
  const a = db.requests.find((x) => x.id === id);
  if (Number(rush) > 0 && !a.rush) throw new Error("The customer didn't ask for this to be rushed. Leave the rush fee at 0.");
  const total = Number(fee) + Number(gov) + Number(rush || 0);
  const auto = a.care_plan_id && !a.created_by && !Number(fee) && !Number(rush) && Number(gov) <= Number(org.care_gov_preapproval_php || 0);
  Object.assign(a, { quote_service_fee: Number(fee), quote_rush_fee: Number(rush || 0), quote_gov_fees: Number(gov), quote_php: total, quote_note: note || null, quoted_at: now(),
    status: auto ? (total ? 'awaiting_customer' : 'in_progress') : 'quoted', accepted_at: auto ? now() : null, payment_status: auto ? (total ? 'awaiting_payment' : 'waived') : 'unpaid',
    admin_note: auto && total ? `Government fees ₱${Number(gov).toLocaleString()}, within the amount you pre-approved. Pay to start.` : null });
  event(a, 'quote', `Quote sent: ₱${a.quote_php}`, true);
  if (auto) event(a, 'accepted', 'Accepted for you: within the government fees you pre-approved.', true);
}
export async function adminConfirmPayment(id, okPaid, note) {
  const a = db.requests.find((x) => x.id === id);
  Object.assign(a, okPaid ? { payment_status: 'paid', paid_at: now(), status: 'in_progress' } : { payment_status: 'awaiting_payment' });
  event(a, 'payment', okPaid ? 'Payment confirmed' : note || 'We could not find this payment. Please check the reference.', true);
}
export async function adminUpdateOrder(a0, { status, message, file, govActual, provider }) {
  const a = db.requests.find((x) => x.id === a0.id);
  if (status) a.status = status;
  if (['completed', 'cancelled'].includes(status)) {
    // PermitPal's temporary access ends with the job
    for (const x of (db.staffAccess || []).filter((y) => y.request_id === a.id && !y.ended_at)) { x.ended_at = now(); db.members = db.members.filter((m) => m.user_id !== x.user_id); }
  }
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
export const adminReferrals = async () => db.referrals.map(({ token, ...r }) => ({ ...r, orgs: { name: r.org_name || org.name }, partners: db.partners.find((p) => p.id === r.partner_id), referral_commissions: r.commission || { amount_php: null, status: 'pending' } }));
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
  { id: 'p1', category: 'liaison', name: 'Sample Liaison Services', description: 'Business permit renewals and new registrations for Metro Manila LGUs.', services: "Mayor's Permit renewal, barangay clearance, FSIC filing",
    licence: 'DTI-registered liaison firm', cities: ['Makati City', 'Taguig City', 'Pasig City'], coverage: 'Metro Manila', website: '', type_codes: ['mayors_permit', 'barangay_clearance', 'fsic'], published: true, verified: true, sort: 10, lead_fee_php: 500, credit_php: 5000, contact_email: 'leads@sample-liaison.ph' },
  { id: 'p2', category: 'bookkeeping', name: 'Sample Bookkeeping Co.', description: 'Monthly bookkeeping, BIR filings and registration updates.', services: 'BIR registration updates, books of accounts',
    licence: 'CPA, PRC-licensed', cities: ['Cebu City', 'Mandaue City'], coverage: 'Cebu', website: '', type_codes: ['bir_cor'], published: true, verified: false, sort: 20, lead_fee_php: 400, credit_php: 1200 },
  // out of credit: paused, so customers don't see it (staff do)
  { id: 'p4', category: 'liaison', name: 'Sample Permit Desk', description: 'Permit filing for Quezon City.', services: "Mayor's Permit renewal", licence: 'DTI-registered', cities: ['Quezon City'], coverage: 'Quezon City', website: 'https://example.ph', type_codes: ['mayors_permit'], published: true, verified: true, sort: 30, lead_fee_php: 500, credit_php: 200, contact_email: 'desk@example.ph' },
);
if (globalThis.PP_DEMO) {
  db.people.push({ id: 'pp1', org_id: org.id, full_name: 'Jun Reyes', role_title: 'Delivery driver', business_id: 'b2', deleted_at: null });
  addReq('person', 'pp1', null, types.find((t) => t.code === 'drivers_license'), { reference_no: 'N01-23-456789', expires_on: addDays(48) });
  addReq('person', 'pp1', null, types.find((t) => t.code === 'health_certificate'), { reference_no: 'HC-2291', expires_on: addDays(-3) });
  const fsic = db.requirements.find((r) => r.business_id === 'b2' && r.type_code === 'fsic' && r.location_id === 'l3');
  // The demo's sample order: an FSIC renewal when in-person work is on, otherwise the online set-up job.
  const a = globalThis.PP_IN_PERSON ? { id: 'ord1', org_id: org.id, created_by: user.id, service_code: 'renew_fsic', requirement_id: fsic.id, business_id: 'b2', vehicle_id: null, person_id: null,
    requirement_name: fsic.name, subject_label: 'Visayas Sari-Sari Distribution Co. · Mandaue warehouse', notes: 'Inspection usually takes a week here.', rush: false,
    contact_method: 'email', contact_value: null, docs_status: 'have', status: 'quoted', payment_status: 'unpaid', quote_service_fee: 1500, quote_gov_fees: 1800,
    quote_php: 3300, quote_note: 'Government fee is based on last year\'s assessment. If it ends up lower, we refund the difference.', quoted_at: now(), due_on: null, created_at: now(), updated_at: now() }
    : { id: 'ord1', org_id: org.id, created_by: user.id, service_code: 'setup_from_paper', requirement_id: null, business_id: 'b2', vehicle_id: null, person_id: null,
      requirement_name: 'Set up my account for me', subject_label: 'Visayas Sari-Sari Distribution Co.', notes: 'About 40 permits, photos in a shared folder.', rush: false, kind: 'other',
      contact_method: 'email', contact_value: null, docs_status: 'have', status: 'quoted', payment_status: 'unpaid', quote_service_fee: 3000, quote_gov_fees: 0,
      quote_php: 3000, quote_note: 'Up to 60 permits typed in from your photos, with expiry dates and files.', quoted_at: now(), due_on: null, created_at: now(), updated_at: now() };
  db.requests.unshift(a);
  event(a, 'created', a.notes);
  event(a, 'quote', 'Quote sent: ₱3,300', true);
  db.notifications.push(
    { id: 'n3', user_id: user.id, org_id: org.id, kind: 'system', title: 'Your weekly summary: 3 overdue, 4 due within 30 days', body: 'Start with the Mayor\'s Permit for Visayas Sari-Sari Distribution Co.', link: '#/compliance', read_at: null, created_at: new Date(Date.now() - 2 * 3600e3).toISOString() },
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

// ---------------------------------------------------------------- team tools
db.links = [];
export const listPlans = async () => plans;
export async function setOrgProfile(id, patch) {
  const target = id === org.id ? org : db.managed.find((o) => o.id === id);
  Object.assign(target, patch);
  if (target === org && org.kind !== 'business' && !org.trial_ends_at) org.trial_ends_at = new Date(Date.now() + 30 * 864e5).toISOString();
}
const sampleItems = (spec) => spec.map(([code, status, days, city]) => ({ id: uid(), type_code: code, name: types.find((t) => t.code === code)?.name || ({ barangay_clearance: 'Barangay Business Clearance', sanitary_permit: 'Sanitary Permit' })[code] || code,
  subject: 'business', subject_name: null, location: 'Main branch', city, status, expires_on: days == null ? null : addDays(days), days_left: days, on_file: status === 'compliant' }));
export async function networkBoard() {
  if (org.kind === 'business') return { locked: true };
  const rel = org.kind === 'firm' ? 'client' : org.kind === 'property' ? 'tenant' : 'franchisee';
  const members = db.links.filter((l) => ['pending', 'active'].includes(l.status)).map((l) => ({ ...l, relation: rel, via: 'linked' }));
  if (org.kind === 'firm') {
    for (const o of db.managed) members.push({ link_id: null, org_id: o.id, relation: 'client', label: '', status: 'active', share_files: true, invited_email: o.contact_email, via: 'managed',
      created_at: o.created_at, accepted_at: o.created_at, last_nudged_at: o.last_nudged_at, name: o.name, contact_name: o.contact_name, contact_email: o.contact_email, items: o.items || [] });
  }
  return { locked: false, kind: org.kind, members };
}
export async function linkInvite(owner, relation, email, label) {
  const l = { link_id: uid(), org_id: null, relation, label: label || '', status: 'pending', share_files: false, invited_email: email, token: 'tok' + uid().slice(0, 8),
    created_at: new Date().toISOString(), accepted_at: null, last_nudged_at: null, name: null, items: [] };
  db.links.push(l);
  return l.link_id;
}
export const linkToken = async (id) => db.links.find((l) => l.link_id === id).token;
export const linkPreview = async (token) => { const l = db.links.find((x) => x.token === token); return l ? { owner_name: 'Sample Franchisor Inc.', owner_kind: 'head_office', relation: l.relation, label: l.label, status: l.status, required_types: [] } : null; };
export async function linkAccept(token) { const l = db.links.find((x) => x.token === token); Object.assign(l, { status: 'active', accepted_at: new Date().toISOString() }); return l.link_id; }
export async function linkDecline(token) { db.links.find((x) => x.token === token).status = 'declined'; }
export async function linkEnd(id) {
  const l = db.links.find((x) => x.link_id === id); if (l) l.status = l.status === 'pending' ? 'declined' : 'ended';
  const c = db.myConns.find((x) => x.id === id); if (c) c.status = 'ended';
}
export async function linkSetSharing(id, share) { const l = db.links.find((x) => x.link_id === id) || db.myConns.find((x) => x.id === id); if (!l) throw new Error('Connection not found.'); l.share_files = share; }
export async function linkSetLabel(id, label) { db.links.find((x) => x.link_id === id).label = label; }
// Companies this workspace is connected to (its franchisor, accountant, mall).
db.myConns = globalThis.PP_DEMO ? [{ id: 'c1', owner_name: 'Ayala Malls (sample)', owner_kind: 'property', relation: 'tenant', label: 'G/F Unit 12', share_files: true, accepted_at: addDays(-40), status: 'active' }] : [];
export const myConnections = async () => db.myConns.filter((c) => c.status === 'active').map(({ status, ...c }) => c);
export const networkDocuments = async () => [{ path: 'o1/demo/mayors-permit-2026.pdf', file_name: 'mayors-permit-2026.pdf', requirement: "Mayor's / Business Permit", subject_name: null, expires_on: addDays(80) }];
export async function networkNudge(owner, links, orgs) {
  let n = 0;
  for (const id of links) { const l = db.links.find((x) => x.link_id === id); if (l) { l.last_nudged_at = new Date().toISOString(); n++; } }
  for (const id of orgs) { const o = db.managed.find((x) => x.id === id); if (o) { o.last_nudged_at = new Date().toISOString(); n++; } }
  return n;
}
export const requestPlan = async () => {};
db.support = [];
export async function contactSupport({ topic, message, name, email }) {
  if (!String(message || '').trim()) throw new Error('Please write a message.');
  if (globalThis.PP_LOGGED_OUT && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email || '')) throw new Error('Please enter a valid email address so we can reply.');
  const row = { id: uid(), user_id: globalThis.PP_LOGGED_OUT ? null : user.id, topic, message, name: name || 'Sadie Luna', email: email || 'sadie@test.ph', status: 'open', created_at: new Date().toISOString(), orgs: { name: org.name } };
  db.support.unshift(row); return row.id;
}
export const adminSupportMessages = async () => db.support;
export async function adminSetSupportStatus(id, status) { db.support.find((x) => x.id === id).status = status; }
export const adminOrgKinds = async () => [{ id: org.id, kind: org.kind, trial_ends_at: org.trial_ends_at }];
if (globalThis.PP_DEMO) {
  // The demo shows the head-office board: company branches plus connected franchisees.
  // (demo workspace is a regular business; the sample connections below are only used by test hooks)
  const mk = (name, label, spec, extra = {}) => db.links.push({ link_id: uid(), org_id: uid(), relation: 'franchisee', label, status: 'active', share_files: !!extra.share,
    invited_email: 'owner@' + name.toLowerCase().replace(/[^a-z]/g, '') + '.ph', token: 'tok' + uid().slice(0, 8), created_at: addDays(-60), accepted_at: addDays(-55), last_nudged_at: null, name, items: sampleItems(spec) });
  mk('Kape Uno – SM North', 'QC-014', [['mayors_permit', 'action_required', -6, 'Quezon City'], ['barangay_clearance', 'compliant', 110, 'Quezon City'], ['fsic', 'renew_soon', 18, 'Quezon City'], ['sanitary_permit', 'compliant', 200, 'Quezon City'], ['bir_cor', 'compliant', null, 'Quezon City']], { share: true });
  mk('Kape Uno – Ortigas', 'PSG-003', [['mayors_permit', 'compliant', 105, 'Pasig City'], ['barangay_clearance', 'compliant', 105, 'Pasig City'], ['fsic', 'compliant', 160, 'Pasig City'], ['sanitary_permit', 'needs_information', null, 'Pasig City'], ['bir_cor', 'compliant', null, 'Pasig City']]);
  mk('Kape Uno – Alabang', 'MNL-021', [['mayors_permit', 'renew_soon', 24, 'Muntinlupa City'], ['barangay_clearance', 'renew_soon', 24, 'Muntinlupa City'], ['fsic', 'compliant', 90, 'Muntinlupa City'], ['sanitary_permit', 'compliant', 140, 'Muntinlupa City']]);
  mk('Kape Uno – IT Park Cebu', 'CEB-002', [['mayors_permit', 'compliant', 104, 'Cebu City'], ['barangay_clearance', 'compliant', 104, 'Cebu City'], ['fsic', 'in_progress', 4, 'Cebu City'], ['sanitary_permit', 'compliant', 180, 'Cebu City'], ['bir_cor', 'compliant', null, 'Cebu City']], { share: true });
  db.links.push({ link_id: uid(), org_id: null, relation: 'franchisee', label: 'DVO-001', status: 'pending', share_files: false, invited_email: 'owner@kapeuno-davao.ph', token: 'tokdavao', created_at: addDays(-2), name: null, items: [] });
}
// Test hook: load the app as a given workspace type (business, head_office, firm, property, fleet).
if (globalThis.PP_KIND) Object.assign(org, { kind: globalThis.PP_KIND, trial_ends_at: globalThis.PP_KIND === 'business' ? null : new Date(Date.now() + 21 * 864e5).toISOString() });

// Demo: a few weeks of realistic history so the History page and its filter have something to show.
if (globalThis.PP_DEMO) {
  const ago = (d, h = 10) => new Date(Date.now() - d * 864e5 - h * 3600e3).toISOString();
  const req = (pred) => db.requirements.find(pred) || {};
  const ctpl = req((r) => r.vehicle_id === 'v2' && r.type_code === 'ctpl');
  const fsic = req((r) => r.business_id === 'b1' && r.type_code === 'fsic');
  const mp2 = req((r) => r.business_id === 'b2' && r.type_code === 'mayors_permit');
  const reg3 = req((r) => r.vehicle_id === 'v3' && r.type_code === 'lto_registration');
  const past = [
    [0, 2, 'documents', 'uploaded', `Uploaded "Hilux_OR.jpg" for ${reqLabel(req((r) => r.vehicle_id === 'v2' && r.type_code === 'lto_registration'))}`, ids(req((r) => r.vehicle_id === 'v2' && r.type_code === 'lto_registration'))],
    [1, 4, 'requirement_cycles', 'renewed', `Renewed ${reqLabel(ctpl)} - expires Mar 16, 2027`, ids(ctpl)],
    [1, 6, 'requirements', 'updated', `Started renewing ${reqLabel(req((r) => r.business_id === 'b2' && r.type_code === 'fsic'))}`, ids(req((r) => r.business_id === 'b2' && r.type_code === 'fsic'))],
    [3, 1, 'documents', 'uploaded', `Uploaded "fsic.pdf" for ${reqLabel(fsic)}`, ids(fsic)],
    [3, 3, 'requirement_cycles', 'recorded', `Recorded ${reqLabel(fsic)}`, ids(fsic)],
    [5, 2, 'vehicles', 'created', 'Added vehicle Honda Click 125i (123 ABC)', { vehicle_id: 'v3' }],
    [5, 3, 'requirement_cycles', 'recorded', `Recorded ${reqLabel(reg3)}`, ids(reg3)],
    [8, 5, 'people', 'created', 'Added Jun Reyes', {}],
    [9, 2, 'business_locations', 'created', 'Added branch "Mandaue warehouse" to Visayas Sari-Sari Distribution Co.', { business_id: 'b2' }],
    [12, 4, 'documents', 'deleted', `Removed file "old-permit.pdf" from ${reqLabel(mp2)}`, ids(mp2)],
    [12, 6, 'org_members', 'created', 'Mark Dela Cruz joined the team as member', {}],
    [15, 3, 'businesses', 'created', 'Added business "Visayas Sari-Sari Distribution Co."', { business_id: 'b2' }],
    [20, 2, 'orgs', 'updated', 'Renamed the workspace to "Aligned Solutions"', {}],
  ];
  const old = db.audit.splice(0).reverse(); // set-up entries: the oldest history
  let n = 100;
  old.forEach((a, i) => db.audit.push({ ...a, id: ++n, created_at: ago(26, 8 - i) }));
  for (const [d, h, entity, action, summary, extra] of past.reverse()) db.audit.push({ id: ++n, entity, action, summary, actor_id: user.id, created_at: ago(d, h), ...extra });
  db.audit.sort((a, b) => b.id - a.id);
}
// Test hook for layout previews: several more businesses with mixed statuses.
if (globalThis.PP_EXTRA_BIZ) {
  const bizTypes = types.filter((t) => t.subject === 'business');
  [['Lola Nena Bakeshop', 'restaurant', 'Quezon City', [-12, 15, 200, null]], ['Bright Smile Dental', 'clinic', 'Pasig City', [120, 210, 300, 90]],
   ['Kuya Jun Hardware', 'retail', 'Davao City', [25, 40, null, 180]], ['Sunrise Laundry Hub', 'services', 'Makati City', [300, 280, 260, 250]],
   ['Mabuhay Printing', 'services', 'Cebu City', [-3, -1, 12, null]]].forEach(([name, activity, city, offs], i) => {
    const id = 'bx' + i;
    db.businesses.push({ id, org_id: org.id, name, activity, structure: 'Sole Proprietorship', tin: null, deleted_at: null });
    db.locations.push({ id: 'lx' + i, business_id: id, name: 'Main branch', city, address: '', is_main: true, deleted_at: null });
    bizTypes.forEach((t, k) => {
      const off = offs[k % offs.length];
      const r = addReq('business', id, t.per_location ? 'lx' + i : null, t, off == null ? null : { reference_no: 'R-' + i + k, expires_on: addDays(off) });
      if (off != null && off > 0) db.documents.push({ id: uid(), requirement_id: r.id, cycle_id: last(db.cycles).id, file_name: 'permit.pdf', storage_path: 'o1/demo/permit.pdf', mime_type: 'application/pdf', size_bytes: 50000, created_at: new Date().toISOString(), deleted_at: null });
    });
  });
}
// Test hook (hostile-text check): every name a customer can type becomes HTML/script, Filipino letters, emoji,
// quotes and one very long unbroken word, to prove it is shown as plain text and never breaks the layout.
if (globalThis.PP_HOSTILE) {
  const H = (s) => `<img src=x onerror="window.__xss=1">${s || ''} Ñiño 😀 "q" & <b>b</b> ${'W'.repeat(60)}`;
  org.name = H('Org');
  db.businesses.forEach((b) => { b.name = H(b.name); });
  db.locations.forEach((l) => { l.name = H(l.name); l.city = H(l.city); l.address = H('addr'); });
  db.vehicles.forEach((v) => { v.make_model = H(v.make_model); });
  db.people.forEach((p) => { p.full_name = H(p.full_name); p.role_title = H(p.role_title); });
  db.requirements.forEach((r) => { r.notes = H('note'); if (!types.some((t) => t.code === r.type_code)) r.name = H(r.name); });
  db.cycles.forEach((c) => { c.reference_no = H(c.reference_no); c.issuer = H('issuer'); });
  db.documents.forEach((d) => { d.file_name = H('file') + '.pdf'; });
  db.notifications.forEach((n) => { n.title = H(n.title); n.body = H(n.body); });
  db.audit.forEach((a) => { a.summary = H(a.summary); });
}
// Test hook (scale check): a 100-vehicle fleet, 25 businesses with 5 branches each and 50 staff: about 1,000 permits.
if (globalThis.PP_SCALE) {
  const of = (s) => types.filter((t) => t.subject === s);
  const off = (i) => ((i * 37) % 420) - 60; // spread from 60 days overdue to a year ahead
  for (let i = 0; i < 100; i++) {
    const id = 'vs' + i;
    db.vehicles.push({ id, org_id: org.id, make_model: ['Toyota Vios', 'Isuzu Traviz', 'Mitsubishi L300', 'Honda TMX'][i % 4] + ' #' + (i + 1), plate_no: 'NAB ' + (1000 + i),
      vehicle_type: i % 4 === 3 ? 'Motorcycle' : 'Van', cr_no: 'CR' + i, mv_file_no: '', business_id: null, deleted_at: null });
    of('vehicle').forEach((t, k) => addReq('vehicle', id, null, t, i % 9 === 0 && k ? null : { reference_no: 'S' + i + k, expires_on: addDays(off(i + k * 7)) }));
  }
  for (let i = 0; i < 25; i++) {
    const id = 'bs' + i;
    db.businesses.push({ id, org_id: org.id, name: 'Scale Store ' + (i + 1), activity: 'retail', structure: 'Corporation', tin: null, deleted_at: null });
    for (let j = 0; j < 5; j++) {
      const lid = `ls${i}_${j}`;
      db.locations.push({ id: lid, business_id: id, name: j ? 'Branch ' + j : 'Main branch', city: ['Makati City', 'Cebu City', 'Davao City', 'Pasig City', 'Iloilo City'][j], address: '', is_main: !j, deleted_at: null });
      of('business').forEach((t, k) => addReq('business', id, lid, t, (i + j + k) % 6 === 0 ? null : { reference_no: `B${i}-${j}-${k}`, expires_on: addDays(off(i * 5 + j + k * 3)) }));
    }
  }
  for (let i = 0; i < 50; i++) {
    const id = 'ps' + i;
    db.people.push({ id, org_id: org.id, full_name: ['Ana', 'Ben', 'Carla', 'Dante', 'Ella'][i % 5] + ' Santos ' + (i + 1), role_title: 'Driver', business_id: null, deleted_at: null });
    of('person').forEach((t, k) => addReq('person', id, null, t, { reference_no: 'P' + i + k, expires_on: addDays(off(i * 3 + k)) }));
  }
}

// ---------------------------------------------------------------- newer features (all switched on in the mock;
// PP_FEATURES = 'none' simulates a database without the new migrations, to prove nothing breaks)
const ALL_FEATURES = ['errors', 'assign', 'library2', 'services', 'import2', 'filings', 'sms', 'mfa', 'revenue', 'autorenew', 'leads'];
export const features = async () => (globalThis.PP_FEATURES === 'none' ? {} : Object.fromEntries(ALL_FEATURES.map((f) => [f, true])));

db.clientErrors = [];
let errSeq = 0;
export async function logClientError(r) {
  const fp = (r.message || '').replace(/\d+/g, '#') + '|' + (r.route || '');
  const open = db.clientErrors.find((e) => e.fp === fp && !e.resolved_at);
  if (open) { open.count++; open.last_seen = new Date().toISOString(); return; }
  db.clientErrors.unshift({ id: ++errSeq, fp, message: r.message, stack: r.stack, route: r.route, app_version: r.version, user_agent: r.agent,
    count: 1, users_affected: 1, first_seen: new Date().toISOString(), last_seen: new Date().toISOString(), resolved_at: null, note: null });
}
if (globalThis.PP_DEMO) db.clientErrors.push({ id: ++errSeq, fp: 'demo', message: "TypeError: Cannot read properties of undefined (reading 'plate_no')", stack: 'at vehicleDetail (entities.js:412:20)',
  route: '#/vehicles/:id', app_version: 'a1b2c3d', user_agent: 'Mozilla/5.0 (Linux; Android 14) Chrome/129.0', count: 7, users_affected: 3,
  first_seen: new Date(Date.now() - 3 * 864e5).toISOString(), last_seen: new Date(Date.now() - 2 * 36e5).toISOString(), resolved_at: null, note: null });
globalThis.__ppMockErrors = db.clientErrors; // lets the browser tests read what was reported
export const adminErrors = async (open = true) => db.clientErrors.filter((e) => (open ? !e.resolved_at : !!e.resolved_at));
export async function adminResolveError(id, resolved, note) {
  const e = db.clientErrors.find((x) => x.id === id);
  if (!e) return;
  if (resolved) { e.resolved_at = new Date().toISOString(); e.note = note || null; }
  else if (!db.clientErrors.some((x) => x.fp === e.fp && !x.resolved_at)) { e.resolved_at = null; }
}

// ---------------------------------------------------------------- who's handling it
org.escalate_days = 7;
if (globalThis.PP_DEMO || globalThis.PP_TEAM) {
  db.members.push({ user_id: 'u2', role: 'member', profile: { first_name: 'Marco', last_name: 'Santos', email: 'marco@test.ph' } },
    { user_id: 'u3', role: 'viewer', profile: { first_name: 'Liza', last_name: 'Reyes', email: 'liza@test.ph' } });
  const pick = (code, biz) => db.requirements.find((r) => r.type_code === code && (!biz || r.business_id === biz));
  for (const [r, who] of [[pick('mayors_permit', 'b2') || pick('mayors_permit', 'b1'), 'u2'], [pick('lto_registration'), 'u1'], [pick('fsic', 'b1'), 'u2']]) if (r) { r.assignee_id = who; r.assigned_at = new Date().toISOString(); }
}
export async function assignRequirements(ids, userId) {
  if (userId && !db.members.some((m) => m.user_id === userId && m.role !== 'viewer')) throw new Error("That person isn't on this workspace's team, or can only view.");
  let n = 0;
  for (const id of ids) {
    const r = db.requirements.find((x) => x.id === id && !x.deleted_at);
    if (r && (r.assignee_id || null) !== (userId || null)) { r.assignee_id = userId || null; r.assigned_at = userId ? new Date().toISOString() : null; n++; }
  }
  return n;
}
export async function setEscalation(orgId, days) {
  if (days != null && (days < 1 || days > 60)) throw new Error('Choose between 1 and 60 days.');
  org.escalate_days = days ?? null;
}


// ---------------------------------------------------------------- fuller permit library + renewal checklists
const T = (code) => types.find((t) => t.code === code);
Object.assign(T('mayors_permit'), { category: 'local', depends_on: ['barangay_clearance'],
  where_to_file: "Your city or municipal hall's Business Permits and Licensing Office (BPLO), or its online portal.",
  validity_note: 'Valid for the calendar year. Most cities want it renewed by January 20.',
  checklist: [{ k: 'brgy', t: 'Barangay Business Clearance for this year', dep: 'barangay_clearance' }, { k: 'prev', t: "Last year's Mayor's Permit and its official receipt" },
    { k: 'sales', t: "Last year's gross sales or receipts", d: 'Usually copies of your BIR returns, or a sworn declaration of gross sales.' },
    { k: 'ctc', t: 'Community Tax Certificate (cedula) for the business' }, { k: 'fire', t: 'Fire safety inspection (FSIC)', dep: 'fsic' },
    { k: 'pay', t: 'Pay the assessed taxes and fees' }] });
Object.assign(T('bir_cor'), { category: 'national', where_to_file: 'Your BIR Revenue District Office (RDO), or online through ORUS.',
  online_url: 'https://orus.bir.gov.ph/', online_label: 'BIR ORUS (online registration and updates)', validity_note: 'Does not expire.',
  checklist: [{ k: 'display', t: 'Display the COR (Form 2303) where customers can see it' }, { k: 'update', t: 'Moved or changed your name? File the update with BIR', u: 'https://orus.bir.gov.ph/' }] });
Object.assign(T('fsic'), { category: 'safety', where_to_file: 'The Bureau of Fire Protection station for your city.', validity_note: 'Valid for one year from the date issued.',
  checklist: [{ k: 'prev', t: "Last year's FSIC" }, { k: 'ready', t: 'Fire extinguishers refilled and tagged; exits clear and marked' }, { k: 'pay', t: 'Pay the fire code fee' }] });
Object.assign(T('lto_registration'), { category: 'registration', where_to_file: 'Any LTO district office, or online in LTMS for plain renewals.', depends_on: ['ctpl', 'emission_test'],
  online_url: 'https://portal.lto.gov.ph/', online_label: 'LTO LTMS portal', validity_note: 'Renew every year in the week set by your plate number.',
  checklist: [{ k: 'ctpl', t: 'CTPL insurance for the coming year', dep: 'ctpl' }, { k: 'emission', t: 'Passed emission test', dep: 'emission_test' },
    { k: 'orcr', t: 'Current OR/CR' }, { k: 'pay', t: 'Pay the registration fee', u: 'https://portal.lto.gov.ph/' }] });
Object.assign(T('ctpl'), { category: 'registration', checklist: [{ k: 'buy', t: 'Buy CTPL for the next registration year' }] });
Object.assign(T('emission_test'), { category: 'registration' });
Object.assign(T('mvir'), { category: 'registration' });
Object.assign(T('drivers_license'), { category: 'licence', online_url: 'https://portal.lto.gov.ph/', online_label: 'LTO LTMS portal',
  validity_note: 'Valid for 5 years, or 10 years for drivers with no traffic violations.', checklist: [{ k: 'medical', t: 'Medical certificate from an LTO-accredited clinic' }, { k: 'pay', t: 'Pay the renewal fee' }] });
Object.assign(T('health_certificate'), { category: 'clearance' });
Object.assign(T('nbi_clearance'), { category: 'clearance', online_url: 'https://clearance.nbi.gov.ph/', online_label: 'NBI Clearance online' });
types.push(
  { code: 'barangay_clearance', name: 'Barangay Business Clearance', subject: 'business', expires: true, due_rule: 'jan20', per_location: true, auto_add: false, category: 'local',
    checklist: [{ k: 'prev', t: "Last year's barangay clearance" }, { k: 'pay', t: 'Pay the barangay fee' }] },
  { code: 'sanitary_permit', name: 'Sanitary Permit', subject: 'business', expires: true, due_rule: 'annual', per_location: true, auto_add: false, category: 'safety',
    activities: ['restaurant', 'healthcare', 'school', 'manufacturing'], help_text: 'Required for businesses that handle food or health services.' },
  { code: 'liquor_license', name: 'Liquor License', subject: 'business', expires: true, due_rule: 'jan20', per_location: true, auto_add: false, category: 'local',
    activities: ['restaurant', 'retail'], help_text: 'If you sell or serve alcoholic drinks.' },
  { code: 'dole_registration', name: 'DOLE Establishment Registration (Rule 1020)', subject: 'business', expires: false, due_rule: 'manual', per_location: true, auto_add: false, category: 'employer',
    help_text: 'One-time registration for every business with at least one employee. Free.', online_url: 'https://reports.dole.gov.ph/', online_label: 'DOLE Establishment Report System',
    checklist: [{ k: 'file', t: 'Register online', u: 'https://reports.dole.gov.ph/' }] },
  { code: 'bmbe_certificate', name: 'BMBE Certificate of Authority', subject: 'business', expires: true, due_rule: 'years2', per_location: false, auto_add: false, category: 'national',
    help_text: 'For micro businesses with assets up to ₱3 million: no income tax on the business while it is valid.' },
  { code: 'police_clearance', name: 'National Police Clearance', subject: 'person', agency: 'PNP', expires: true, due_rule: 'months6', per_location: false, auto_add: false, category: 'clearance',
    online_url: 'https://pnpclearance.ph/', online_label: 'PNP National Police Clearance System' },
);
db.ticks = [];
export async function setChecklistItem(reqId, item, done) {
  const r = statusRows().find((x) => x.id === reqId);
  if (!r) throw new Error('Not allowed.');
  if (!(T(r.type_code)?.checklist || []).some((i) => i.k === item)) throw new Error('That checklist item no longer exists. Refresh the page.');
  const round = r.cycle_id ? String(r.cycle_id) : 'first';
  db.ticks = db.ticks.filter((t) => !(t.requirement_id === reqId && t.round === round && t.item === item));
  if (done) db.ticks.push({ requirement_id: reqId, round, item, done_by: user.id, done_at: now() });
  return round;
}

// ---------------------------------------------------------------- taxes & contributions (same rules as the database)
const FILING_TYPES = [
  ['bir_1601c', 'BIR', '1601-C', "Tax withheld from employees' pay", 'monthly', 'employer', 'next10_dec15', null, null],
  ['bir_0619e', 'BIR', '0619-E', 'Tax withheld from rent and suppliers (monthly)', 'monthly', 'withholding', 'next10', [1, 2, 4, 5, 7, 8, 10, 11], null],
  ['bir_1601eq', 'BIR', '1601-EQ', 'Tax withheld from rent and suppliers (quarterly return)', 'quarterly', 'withholding', 'q_next_last', null, null],
  ['bir_2550q', 'BIR', '2550Q', 'Quarterly VAT return', 'quarterly', 'vat', 'q_25', null, null],
  ['bir_2551q', 'BIR', '2551Q', 'Quarterly percentage tax', 'quarterly', 'percentage', 'q_25', null, null],
  ['bir_1701q', 'BIR', '1701Q', 'Quarterly income tax (sole proprietor)', 'quarterly', 'individual', 'q_1701', null, [1, 2, 3]],
  ['bir_1701', 'BIR', '1701 / 1701A', 'Yearly income tax (sole proprietor)', 'annual', 'individual', 'a_apr15', null, null],
  ['bir_1702q', 'BIR', '1702Q', 'Quarterly income tax (corporation or partnership)', 'quarterly', 'corp', 'q_60', null, [1, 2, 3]],
  ['bir_1702', 'BIR', '1702', 'Yearly income tax (corporation or partnership)', 'annual', 'corp', 'a_apr15', null, null],
  ['bir_1604c', 'BIR', '1604-C', "Yearly summary of tax withheld from employees", 'annual', 'employer', 'a_jan31', null, null],
  ['bir_1604e', 'BIR', '1604-E', 'Yearly summary of tax withheld from rent and suppliers', 'annual', 'withholding', 'a_mar1', null, null],
  ['sss_contrib', 'SSS', 'Contributions', 'SSS contributions', 'monthly', 'employer', 'm_sss', null, null],
  ['philhealth_contrib', 'PhilHealth', 'Premium', 'PhilHealth premium', 'monthly', 'employer', 'm_philhealth', null, null],
  ['pagibig_contrib', 'Pag-IBIG', 'Contributions', 'Pag-IBIG contributions', 'monthly', 'employer', 'm_pagibig', null, null],
  ['sec_afs', 'SEC', 'AFS', 'Audited financial statements', 'annual', 'corp', 'a_apr30', null, null],
  ['sec_gis', 'SEC', 'GIS', 'General Information Sheet', 'annual', 'sec_gis', 'gis', null, null],
].map(([code, agency, form, name, frequency, applies, rule, months, quarters], i) => ({ code, agency, form, name, frequency, applies, rule, months, quarters,
  help_text: '', online_url: agency === 'SEC' ? 'https://efast.sec.gov.ph/' : agency === 'BIR' ? 'https://www.bir.gov.ph/' : null, online_label: agency + ' website', sort: i }));
const iso = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10); // rolls over like Postgres date maths
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const pgGroup = (name) => { const l = String(name || '').replace(/[^A-Za-z0-9]/g, '').charAt(0).toUpperCase(); return l >= 'A' && l <= 'D' ? 'A-D' : l >= 'E' && l <= 'L' ? 'E-L' : l >= 'M' && l <= 'Q' ? 'M-Q' : 'R-Z'; };
function filingDue(rule, y, m, s, name) {
  switch (rule) {
    case 'next10': return iso(y, m + 1, 10);
    case 'next10_dec15': return m === 12 ? iso(y + 1, 1, 15) : iso(y, m + 1, 10);
    case 'q_next_last': return iso(y, m + 4, 0);
    case 'q_25': return iso(y, m + 3, 25);
    case 'q_1701': return iso(y, m + 4, 15);
    case 'q_60': return iso(y, m + 3, 60);
    case 'a_apr15': return iso(y + 1, 4, 15);
    case 'a_jan31': return iso(y + 1, 1, 31);
    case 'a_mar1': return iso(y + 1, 3, 1);
    case 'a_apr30': return iso(y + 1, 4, 30);
    case 'm_sss': return iso(y, m + 2, 0);
    case 'm_philhealth': return iso(y, m + 1, s.philhealth_digit >= 5 ? 20 : 15);
    case 'm_pagibig': { const g = s.pagibig_group || pgGroup(name); return g === 'A-D' ? iso(y, m + 1, 14) : g === 'E-L' ? iso(y, m + 1, 19) : g === 'M-Q' ? iso(y, m + 1, 24) : iso(y, m + 2, 0); }
    case 'gis': { if (!s.annual_meeting) return null; const [, mm, dd] = s.annual_meeting.split('-').map(Number); const d = new Date(Date.UTC(y, mm - 1, Math.min(dd, lastDay(y, mm)))); d.setUTCDate(d.getUTCDate() + 30); return d.toISOString().slice(0, 10); }
    default: return null;
  }
}
const fApplies = (t, s, b) => (t.applies === 'employer' && s.has_employees) || (t.applies === 'withholding' && s.withholds) || (t.applies === 'vat' && s.tax_type === 'vat')
  || (t.applies === 'percentage' && s.tax_type === 'percentage') || (t.applies === 'individual' && b.structure === 'Sole Proprietorship')
  || (t.applies === 'corp' && ['Corporation', 'Partnership'].includes(b.structure)) || (t.applies === 'sec_gis' && b.structure === 'Corporation' && !!s.annual_meeting);
const periodLabel = (t, y, m) => (t.code === 'sec_gis' ? `${y} meeting` : t.frequency === 'monthly' ? `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]} ${y}`
  : t.frequency === 'quarterly' ? `Q${(m + 2) / 3} ${y}` : String(y));
db.filingSetups = []; db.filingRecords = [];
function obligations(from, to) {
  const out = [];
  for (const s of db.filingSetups) {
    const b = db.businesses.find((x) => x.id === s.business_id && !x.deleted_at);
    if (!b) continue;
    const [fy, fm] = from.split('-').map(Number);
    const [ty, tm] = to.split('-').map(Number);
    for (const t of FILING_TYPES) {
      if (!fApplies(t, s, b) || s.paused_codes.includes(t.code)) continue;
      // every month from 16 months before the window to its end, like the database
      for (let k = fy * 12 + fm - 1 - 16; k <= ty * 12 + tm - 1; k++) {
        const y = Math.floor(k / 12); const m = (k % 12) + 1;
        if (t.frequency === 'monthly' && t.months && !t.months.includes(m)) continue;
        if (t.frequency === 'quarterly' && (![1, 4, 7, 10].includes(m) || (t.quarters && !t.quarters.includes((m + 2) / 3)))) continue;
        if (t.frequency === 'annual' && m !== 1) continue;
        const due = filingDue(t.rule, y, m, s, b.name);
        if (!due || due < from || due > to) continue;
        out.push({ org_id: org.id, business_id: b.id, business_name: b.name, code: t.code, period_start: iso(y, m, 1), period_label: periodLabel(t, y, m), due_on: due, tracking_from: s.tracking_from });
      }
    }
  }
  return out;
}
export const filingTypes = async () => FILING_TYPES.map((t) => ({ ...t }));
export const filingSetups = async () => db.filingSetups.map((s) => ({ ...s }));
export async function filingCalendar(orgId, from, to) {
  return obligations(from, to).map((o) => {
    const r = db.filingRecords.find((x) => x.business_id === o.business_id && x.code === o.code && x.period_start === o.period_start);
    return { ...o, record_id: r?.id || null, filed_on: r?.filed_on || null, reference: r?.reference || null, amount: r?.amount ?? null, note: r?.note || null, filed_by: r?.filed_by || null };
  }).filter((o) => o.due_on >= o.tracking_from || o.record_id).sort((a, b) => (a.due_on < b.due_on ? -1 : a.due_on > b.due_on ? 1 : 0));
}
export async function saveFilingSetup(bizId, f) {
  if (!['vat', 'percentage', 'eight_percent', 'unsure'].includes(f.tax_type)) throw new Error('Choose how the business pays business tax.');
  const old = db.filingSetups.find((s) => s.business_id === bizId);
  const row = { business_id: bizId, org_id: org.id, has_employees: !!f.has_employees, withholds: !!f.withholds, tax_type: f.tax_type, philhealth_digit: f.philhealth_digit ?? null,
    pagibig_group: f.pagibig_group || null, annual_meeting: f.annual_meeting || null, paused_codes: f.paused || [] };
  if (old) Object.assign(old, row); else db.filingSetups.push({ ...row, tracking_from: addDays(-31), created_at: now() });
}
export async function removeFilingSetup(bizId) { db.filingSetups = db.filingSetups.filter((s) => s.business_id !== bizId); }
export async function markFiling(f) {
  if (f.filed_on > today()) throw new Error("The filing date can't be in the future.");
  if (f.filed_on < f.period_start) throw new Error('The filing date is before the period it covers. Check the date.');
  const ob = obligations(f.period_start, addDays(400)).find((o) => o.business_id === f.business_id && o.code === f.code && o.period_start === f.period_start);
  if (!ob) throw new Error("That filing is not on this business's list. Refresh the page.");
  let r = db.filingRecords.find((x) => x.business_id === f.business_id && x.code === f.code && x.period_start === f.period_start);
  if (!r) db.filingRecords.push(r = { id: uid(), business_id: f.business_id, code: f.code, period_start: f.period_start });
  Object.assign(r, { filed_on: f.filed_on, reference: (f.reference || '').trim() || null, amount: f.amount ?? null, note: f.note || null, filed_by: user.id });
  const t = FILING_TYPES.find((x) => x.code === f.code);
  log(`Filed ${['BIR', 'SEC'].includes(t.agency) ? t.agency + ' ' + t.form : t.name} for ${ob.period_label} (${ob.business_name})`, { entity: 'filing_records', action: 'recorded', business_id: f.business_id });
  return r.id;
}
export async function unmarkFiling(id) { db.filingRecords = db.filingRecords.filter((r) => r.id !== id); }
globalThis.__ppFilingDue = filingDue; // lets the browser tests compare dates


// ---------------------------------------------------------------- text messages (the test's code is always 123456)
let smsPending = null;
export async function startPhoneVerification(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  const phone = /^09\d{9}$/.test(d) ? '+63' + d.slice(1) : /^639\d{9}$/.test(d) ? '+' + d : null;
  if (!phone) throw new Error('Enter a Philippine mobile number, like 0917 123 4567.');
  if (smsPending && Date.now() - smsPending.at < 60000 && smsPending.phone === phone && smsPending.sent > 1) throw new Error('Please wait a minute before asking for another code.');
  smsPending = { phone, at: Date.now(), tries: 0, sent: (smsPending?.sent || 0) + 1 };
  return { phone };
}
export async function confirmPhoneCode(code) {
  if (!smsPending) throw new Error('That code has expired. Ask for a new one.');
  if (smsPending.tries >= 5) throw new Error('Too many wrong tries. Ask for a new code.');
  if (String(code).replace(/\D/g, '') !== '123456') { smsPending.tries++; throw new Error(`That code is not right. Check the text message and try again (${5 - smsPending.tries} tries left).`); }
  Object.assign(me, { phone: smsPending.phone, phone_verified_at: new Date().toISOString() });
  myPrefs.sms_enabled = true;
  const p = smsPending.phone; smsPending = null;
  return p;
}
export async function removePhone() { Object.assign(me, { phone: null, phone_verified_at: null }); myPrefs.sms_enabled = false; }

if (globalThis.PP_PLAN) org.plan_id = globalThis.PP_PLAN; // test hook: a workspace on a paid plan

// ---------------------------------------------------------------- two-step login (the test's code is always 123456)
org.require_mfa = false;
const mfaState = { aal: 'aal1', factors: globalThis.PP_MFA_ON ? [{ id: 'f-old', friendly_name: 'Phone (Jan 5, 2026)', factor_type: 'totp', status: 'verified', created_at: '2026-01-05T00:00:00Z' }] : [] };
const QR = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#fff"/><rect x="1" y="1" width="3" height="3"/><rect x="6" y="1" width="3" height="3"/><rect x="1" y="6" width="3" height="3"/></svg>');
export const mfa = {
  aal: async () => ({ currentLevel: mfaState.aal, nextLevel: mfaState.factors.some((f) => f.status === 'verified') ? 'aal2' : 'aal1' }),
  factors: async () => ({ all: mfaState.factors.map((f) => ({ ...f })), totp: mfaState.factors.filter((f) => f.status === 'verified').map((f) => ({ ...f })) }),
  async enroll(name) {
    if (mfaState.factors.some((f) => f.friendly_name === name)) throw new Error(`A factor with the friendly name "${name}" for this user already exists`);
    const f = { id: uid(), friendly_name: name, factor_type: 'totp', status: 'unverified', created_at: new Date().toISOString() };
    mfaState.factors.push(f);
    return { id: f.id, type: 'totp', totp: { qr_code: QR, secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', uri: 'otpauth://totp/PermitPal' } };
  },
  async verify(factorId, code) {
    const f = mfaState.factors.find((x) => x.id === factorId);
    if (!f || String(code) !== '123456') throw new Error('Invalid TOTP code entered');
    f.status = 'verified'; mfaState.aal = 'aal2';
    return {};
  },
  async unenroll(factorId) {
    const f = mfaState.factors.find((x) => x.id === factorId);
    if (f?.status === 'verified' && mfaState.aal !== 'aal2') throw new Error('AAL2 required to unenroll verified factor');
    mfaState.factors = mfaState.factors.filter((x) => x.id !== factorId);
    if (!mfaState.factors.some((x) => x.status === 'verified')) mfaState.aal = 'aal1';
  },
};
export const lockedOrgs = async () => (globalThis.PP_LOCKED && mfaState.aal !== 'aal2' ? [{ id: 'o2', name: 'Secure Co' }] : []);
export async function setRequireMfa(orgId, on) {
  if (on && mfaState.aal !== 'aal2') throw new Error('Turn on two-step login for yourself first (Settings → Two-step login), then try again.');
  org.require_mfa = !!on;
}
export const adminResetMfa = async () => 1;

// ---------------------------------------------------------------- revenue: one-time jobs, Year-round care, fees from firms, money
// Same rules as supabase/migrations/20261019002200_revenue.sql, in memory.
const REV = globalThis.PP_FEATURES !== 'none';
if (REV) {
  const S_ = (code) => SERVICES.find((x) => x.code === code);
  const rush = { renew_mayors_permit: 2000, renew_barangay_clearance: 500, renew_fsic: 1000, renew_sanitary_permit: 800, renew_lto_registration: 800, renew_dti_business_name: 500, renew_philgeps: 800, renew_other: 1000, pkg_new_business: 5000, pkg_new_branch: 3000, pkg_amendment: 2000, doc_replacement: 500, doc_bir_update: 1000, apply_dole_registration: 500 };
  // the same price changes as the migration: [old default, new price]
  const price = { renew_mayors_permit: [2500, 6000], renew_barangay_clearance: [1000, 1500], renew_fsic: [1500, 3000], renew_sanitary_permit: [1200, 2500], renew_lto_registration: [800, 2000],
    renew_ctpl: [300, 500], renew_dti_business_name: [500, 1500], renew_philgeps: [2000, 2500], pkg_new_business: [15000, 25000], pkg_new_branch: [8000, 12000], pkg_amendment: [5000, 8000],
    pkg_closure: [8000, 15000], apply_dole_registration: [1500, 2000], apply_bmbe: [1500, 2000] };
  for (const x of SERVICES) {
    Object.assign(x, { rush_fee: rush[x.code] ?? null, steps: x.steps || [], visit: false, needs_access: false });
    if (price[x.code] && Number(x.price_from) === price[x.code][0]) x.price_from = price[x.code][1];
  }
  if (S_('renew_lto_registration')) S_('renew_lto_registration').price_unit = 'per vehicle (emission test and inspection included)';
  if (S_('renew_other') && S_('renew_other').price_from == null) S_('renew_other').price_unit = 'quoted per permit, from ₱1,500';
  Object.assign(S_('pkg_new_business'), { steps: ['Business name or company registered (DTI, SEC or CDA)', 'Barangay clearance', "Mayor's Permit", 'BIR registration (COR)', 'Books and invoices registered with BIR', 'Everything saved to your account'] });
  Object.assign(S_('pkg_new_branch'), { steps: ['Barangay clearance', "Mayor's Permit", 'Fire safety inspection (FSIC)', 'BIR branch registration', 'Everything saved to your account'] });
  Object.assign(S_('adv_fire_preinspection'), { name: 'Pre-inspection walk-through (fire or sanitary)', visit: true, price_unit: 'per site visit', type_codes: ['fsic', 'sanitary_permit'],
    summary: 'We visit before the fire or sanitary inspector does and give you a written list of what to fix first, so you pass the first time.' });
  SERVICES.push({ code: 'setup_from_paper', name: 'Set up my account for me', category: 'package', active: true, sort: 200,
    summary: "Send us photos or scans of your permits, registrations and OR/CRs. We enter everything into PermitPal with the right dates, attach each file, switch on your reminders, and list what's missing or about to expire.",
    includes: ['Every permit entered with its dates and file', "What's missing or expiring, listed for you", 'Reminders checked and switched on', 'Temporary access that ends when we finish'],
    price_from: 1500, price_unit: 'up to 20 documents, then ₱50 each', turnaround: '2-5 working days', applies_to: 'any', type_codes: [], rush_fee: 1000, visit: false, needs_access: true,
    steps: ['Photos or scans received', 'Businesses, branches and vehicles added', 'Permits entered with dates and files', "What's missing or expiring, listed for you", 'Reminders checked and on'] });
  SERVICES.sort((a, b) => a.sort - b.sort);
  for (const code of ['plan_branch_care', 'plan_vehicle_care']) { const i = SERVICES.findIndex((x) => x.code === code); if (i >= 0) SERVICES.splice(i, 1); }
  if (!T('fsic').checklist.some((i) => i.k === 'inspect')) T('fsic').checklist.push({ k: 'inspect', t: 'Have someone at the site for the inspection' });
}
org.care_gov_preapproval_php = 0;
db.charges = []; db.statements = []; db.placements = []; db.placementStats = []; db.apps = []; db.planPayments = []; db.staffAccess = [];
db.care = { plans: [], invoices: [], claims: [] };
db.history = []; // other customers' money, so the staff Money views have something to show in the demo
const BRANCH_SCOPE = ['mayors_permit', 'barangay_clearance', 'fsic', 'sanitary_permit', 'annual_building_inspection', 'signage_permit', 'liquor_license', 'dti_business_name', 'bmbe_certificate'];
const VEHICLE_SCOPE = ['lto_registration', 'ctpl', 'emission_test', 'mvir'];
const tiers = [
  { code: 'branch_care', subject: 'branch', name: 'Pay per renewal', monthly_php: 0, yearly_php: 0, guarantee: false, guarantee_cap_php: 0, walkthroughs: 0, active: true, sort: 10, covers: BRANCH_SCOPE,
    includes: ['No monthly fee', "We start every covered renewal about 2 months before it's due, on our own", "You pay each renewal's fixed fee only when we do it", 'Government fees at cost, with official receipts'] },
  { code: 'branch_plus', subject: 'branch', name: 'All-in plan', monthly_php: 1200, yearly_php: 12000, guarantee: true, guarantee_cap_php: 10000, walkthroughs: 1, active: true, sort: 20, covers: BRANCH_SCOPE,
    includes: ['Every covered renewal included: no per-renewal fees', 'On-time guarantee: if we miss a deadline, we pay the late penalty (up to ₱10,000 per permit)', 'One fire or sanitary pre-inspection visit a year', "One fixed amount, so January doesn't hit you all at once"] },
  { code: 'vehicle_care', subject: 'vehicle', name: 'Pay per renewal', monthly_php: 0, yearly_php: 0, guarantee: false, guarantee_cap_php: 0, walkthroughs: 0, active: true, sort: 30, covers: VEHICLE_SCOPE,
    includes: ['No monthly fee', 'Registration, CTPL, emission test and inspection started on time', "You pay each renewal's fixed fee only when we do it", 'The new OR/CR saved for you'] },
  { code: 'vehicle_plus', subject: 'vehicle', name: 'All-in plan', monthly_php: 250, yearly_php: 2500, guarantee: true, guarantee_cap_php: 3000, walkthroughs: 0, active: true, sort: 40, covers: VEHICLE_SCOPE,
    includes: ['Every covered renewal included: no per-renewal fees', 'On-time guarantee: if we miss the deadline, we pay the late penalty (up to ₱3,000)', 'One fixed amount a month'] },
];
let billSeq = 0;
const billNo = (p) => `${p}-${today().slice(0, 4)}-${String(++billSeq).padStart(5, '0')}`;
const endOf = (start, billing) => { const d = new Date(start + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + (billing === 'yearly' ? 12 : 1)); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
function covered(p) {
  const l = db.locations.find((x) => x.id === p.location_id);
  const scope = tiers.find((t) => t.code === p.tier)?.covers || [];
  return statusRows().filter((r) => r.subject !== 'person' && scope.includes(r.type_code) && (p.vehicle_id ? r.vehicle_id === p.vehicle_id : r.business_id === l?.business_id && (r.location_id === p.location_id || (!r.location_id && l?.is_main))));
}
function careData() {
  if (!REV) return { plans: [], invoices: [], coverage: [], claims: [], tiers: [], staff: [] };
  const live = db.care.plans.filter((p) => p.status !== 'cancelled');
  return { plans: db.care.plans.map((p) => ({ ...p })), invoices: db.care.invoices.map((i) => ({ ...i })), claims: db.care.claims.map((c) => ({ ...c })), tiers: tiers.map((t) => ({ ...t })),
    coverage: live.flatMap((p) => covered(p).map((r) => ({ requirement_id: r.id, plan_id: p.id, tier: p.tier, status: p.status, paid_through: p.paid_through }))),
    staff: db.staffAccess.filter((x) => !x.ended_at).map((x) => ({ ...x })) };
}
export const careTiers = async () => tiers.map((t) => ({ ...t }));
export const loadCare = async () => careData();
export const loadMembers = async () => db.members.map((m) => ({ ...m, profile: { ...m.profile } }));
export async function startCare(orgId, items, billing) {
  if (org.role !== 'owner') throw new Error('Only the workspace owner can start a paid plan.');
  if (!items.length) throw new Error('Choose at least one branch or vehicle.');
  if (!['monthly', 'yearly', 'per_renewal'].includes(billing)) throw new Error('Choose how you want to pay.');
  const lines = [];
  for (const it of items) {
    const t = tiers.find((x) => x.code === it.tier);
    if (!t || (it.kind === 'location') !== (t.subject === 'branch')) throw new Error("That plan doesn't match what you chose.");
    if (billing === 'per_renewal' && (t.monthly_php > 0 || t.guarantee)) throw new Error(`${t.name} has a monthly fee. Choose monthly or yearly for it.`);
    if (billing !== 'per_renewal' && !(t.monthly_php > 0)) throw new Error(`${t.name} has no monthly fee. Choose "Pay per renewal" for it.`);
    const l = it.kind === 'location' ? db.locations.find((x) => x.id === it.id) : null;
    const v = it.kind === 'vehicle' ? db.vehicles.find((x) => x.id === it.id) : null;
    const b = l ? db.businesses.find((x) => x.id === l.business_id) : null;
    const label = l ? `${b.name} · ${l.name}${l.city ? ' (' + l.city + ')' : ''}` : `${v.make_model}${v.plate_no ? ' · ' + v.plate_no : ''}`;
    if (db.care.plans.some((p) => p.status !== 'cancelled' && (l ? p.location_id === l.id : p.vehicle_id === v.id))) throw new Error(`${label} already has a care plan.`);
    const price = billing === 'yearly' ? t.yearly_php : billing === 'monthly' ? t.monthly_php : 0;
    const auto = billing === 'per_renewal';
    const p = { id: uid(), org_id: org.id, tier: t.code, location_id: l?.id || null, vehicle_id: v?.id || null, business_id: l?.business_id || v?.business_id || null, label, billing, price_php: price,
      status: auto ? 'active' : 'pending', started_on: auto ? today() : null, paid_through: null, cancel_at: null, ended_reason: null, consented_at: now(), created_at: now() };
    db.care.plans.push(p);
    lines.push({ plan_id: p.id, label, tier: t.name, amount: price });
  }
  if (billing === 'per_renewal') return null;
  const inv = { id: uid(), org_id: org.id, number: billNo('C'), first: true, period_start: today(), period_end: endOf(today(), billing), lines, amount_php: lines.reduce((t, x) => t + x.amount, 0),
    status: 'due', due_on: addDays(3), created_at: now() };
  db.care.invoices.unshift(inv);
  return inv.id;
}
export async function cancelCare(id) {
  const p = db.care.plans.find((x) => x.id === id);
  if (p.status === 'pending' || !p.paid_through || p.paid_through < today()) { Object.assign(p, { status: 'cancelled', cancel_at: today() }); dropFromUnpaid(id); return today(); }
  p.cancel_at = p.paid_through; dropFromUnpaid(id); return p.paid_through;
}
function dropFromUnpaid(planId) {
  for (const i of db.care.invoices.filter((x) => x.status === 'due' && x.lines.some((l) => l.plan_id === planId))) {
    i.lines = i.lines.filter((l) => l.plan_id !== planId);
    i.amount_php = i.lines.reduce((t, l) => t + l.amount, 0);
    if (!i.lines.length) Object.assign(i, { status: 'void', note: 'Cancelled: nothing left on this bill.' });
  }
}
export async function resumeCare(id) { const p = db.care.plans.find((x) => x.id === id); if (!p.cancel_at) throw new Error("This plan isn't set to end."); p.cancel_at = null; }
export async function setCarePreapproval(orgId, amount) { if (!['owner', 'admin'].includes(org.role)) throw new Error('Only owners and admins can change this.'); org.care_gov_preapproval_php = amount; }
export async function payCareInvoice(inv, { method, ref, file }) {
  const i = db.care.invoices.find((x) => x.id === inv.id);
  if (!['due', 'pending_verification'].includes(i.status)) throw new Error('This bill is already paid or was cancelled.');
  if (!ref && !(file && file.size)) throw new Error('Add the reference number or a screenshot of the payment.');
  Object.assign(i, { status: 'pending_verification', pay_method: method, pay_ref: ref || null, proof_path: file?.size ? `${org.id}/care/${i.id}/${file.name}` : null, proof_name: file?.name || null, reported_at: now() });
}
export async function fileGuaranteeClaim(orgId, { plan_id, requirement_id, penalty, note, file }) {
  const p = db.care.plans.find((x) => x.id === plan_id);
  if (!tiers.find((t) => t.code === p.tier)?.guarantee) throw new Error('The on-time guarantee comes with the All-in plan.');
  if (!(file && file.size)) throw new Error('Attach the official receipt that shows the penalty.');
  const r = statusRows().find((x) => x.id === requirement_id);
  if (!r?.expires_on || r.expires_on >= today()) throw new Error("This permit hasn't lapsed: there's no past expiry date on file for it.");
  const c = { id: uid(), org_id: org.id, plan_id, requirement_id, requirement_name: r.name, lapsed_on: r.expires_on, penalty_php: penalty, note: note || null, receipt_path: `${org.id}/care/claims/${file.name}`, receipt_name: file.name,
    status: 'submitted', approved_php: null, decision_note: null, created_at: now() };
  db.care.claims.unshift(c);
  return c.id;
}
export async function requestServicesBulk(f) {
  if (!f.consent) throw new Error('Please tick the box to confirm PermitPal may act for you on these permits.');
  if (!f.requirement_ids.length) throw new Error('Choose at least one permit.');
  if (f.requirement_ids.length > 25) throw new Error('Choose up to 25 permits at a time.');
  const batch = uid();
  const rows = statusRows();
  for (const id of f.requirement_ids) {
    const r = rows.find((x) => x.id === id);
    if (!r) throw new Error('One of those permits was not found. Refresh the page and try again.');
    if (db.requests.some((a) => a.requirement_id === id && !['completed', 'cancelled'].includes(a.status))) throw new Error(`${r.name} (${r.subject_name}) already has an open request.`);
  }
  for (const id of f.requirement_ids) {
    const r = rows.find((x) => x.id === id);
    const s = SERVICES.find((x) => x.category === 'renewal' && x.type_codes.includes(r.type_code)) || SERVICES.find((x) => x.code === 'renew_other');
    const aid = await requestService({ org_id: org.id, service_code: s.code, requirement_id: id, notes: f.notes, rush: f.rush, contact_method: f.contact_method, contact_value: f.contact_value, consent: true, kind: r.cycle_id ? 'renew' : 'apply' });
    db.requests.find((a) => a.id === aid).batch_id = batch;
  }
  return batch;
}
export async function adminOrderStep(id, done) {
  const a = db.requests.find((x) => x.id === id);
  const steps = SERVICES.find((x) => x.code === a.service_code)?.steps || [];
  if (!steps.length) throw new Error('This service has no steps.');
  if (done < 0 || done > steps.length) throw new Error(`Choose a step between 0 and ${steps.length}.`);
  const before = a.steps_done || 0;
  a.steps_done = done;
  event(a, 'status', done > before ? `Step ${done} of ${steps.length} done: ${steps[done - 1]}` : `Progress updated: ${done} of ${steps.length} steps done`, true);
}
export async function adminJoinWorkspace(id) {
  const a = db.requests.find((x) => x.id === id);
  if (!a.staff_access) throw new Error("The customer hasn't given PermitPal access for this order.");
  if (!['paid', 'waived'].includes(a.payment_status)) throw new Error('Wait until the order is paid, then join.');
  db.staffAccess.push({ user_id: 'u9', request_id: id, requirement_name: a.requirement_name, joined_at: now(), ended_at: null });
  if (!db.members.some((m) => m.user_id === 'u9')) db.members.push({ user_id: 'u9', role: 'member', profile: { first_name: 'Fe', last_name: 'Staff', email: 'fe@permitpal.ph' } });
  event(a, 'status', 'PermitPal joined your workspace to do the set-up.', true);
  return org.id;
}

// ---------------------------------------------------------------- firms
function placementStat(id) {
  let st = db.placementStats.find((x) => x.placement_id === id);
  if (!st) db.placementStats.push(st = { placement_id: id, views: 0, clicks: 0, leads: 0, seen: new Set() });
  return st;
}
export const listPlacements = async () => (REV ? db.placements.filter((x) => x.active && x.starts_on <= today() && x.ends_on >= today()).map((x) => {
  const p = db.partners.find((y) => y.id === x.partner_id);
  return p?.published ? { id: x.id, partner_id: p.id, partner_name: p.name, category: p.category, verified: !!p.verified, type_code: x.type_code, item_key: x.item_key, cities: x.cities, headline: x.headline } : null;
}).filter(Boolean) : []);
export async function logPlacement(ids, kind) {
  for (const id of new Set(ids)) { const st = placementStat(id); const k = kind + ':' + today(); if (!st.seen.has(k)) { st.seen.add(k); if (kind === 'view') st.views++; else st.clicks++; } }
}
export async function applyAsPartner(f) {
  if (f.trap) return;
  if (db.apps.some((a) => a.email === f.email.toLowerCase() && Date.now() - Date.parse(a.created_at) < 864e5)) throw new Error("We already have your application. We'll reply within 3 business days.");
  db.apps.unshift({ id: uid(), ...f, email: f.email.toLowerCase(), status: 'new', created_at: now() });
}
export const adminApplications = async () => db.apps.map((a) => ({ ...a }));
export async function adminApplicationToPartner(id) {
  const a = db.apps.find((x) => x.id === id);
  const p = { id: uid(), category: a.category, name: a.name, description: '', licence: a.licence || '', services: a.services || '', website: a.website || '', contact_name: a.contact_name, contact_phone: a.phone || '',
    contact_email: a.email, cities: String(a.cities || '').split(',').map((x) => x.trim()).filter(Boolean), published: false, verified: false, fee_model: a.category === 'insurance' ? 'none' : 'per_lead', type_codes: [], sort: 100 };
  db.partners.push(p);
  Object.assign(a, { status: 'listed', partner_id: p.id });
  return p.id;
}
export async function adminSetApplication(id, patch) { Object.assign(db.apps.find((x) => x.id === id), patch); }
export const adminPlacements = async () => db.placements.map((x) => ({ ...x }));
export async function adminSavePlacement(id, row) {
  if (id) return Object.assign(db.placements.find((x) => x.id === id), row);
  if (db.placements.some((o) => o.active && o.type_code === row.type_code && (o.item_key || '') === (row.item_key || '') && o.starts_on <= row.ends_on && o.ends_on >= row.starts_on
    && (!o.cities.length || !row.cities.length || o.cities.some((c) => row.cities.includes(c))))) throw new Error('Another firm already has this step for these dates and cities. One firm per step keeps it from looking like an ad.');
  db.placements.push({ id: uid(), active: true, created_at: now(), ...row });
}
export const adminPlacementStats = async () => db.placementStats.map(({ seen, ...x }) => ({ ...x }));
export const adminCharges = async () => db.charges.map((c) => ({ ...c }));
export const adminStatements = async () => db.statements.map((x) => ({ ...x }));
export async function adminRecordSale(refId, sale) {
  const r = db.referrals.find((x) => x.id === refId); const p = db.partners.find((x) => x.id === r.partner_id);
  const fee = p.fee_model === 'per_sale_flat' ? Number(p.sale_fee_php || 0) : p.fee_model === 'per_sale_percent' ? Math.round(sale * Number(p.sale_pct || 0)) / 100 : 0;
  Object.assign(r, { status: 'converted', sale_php: sale });
  const old = db.charges.find((c) => c.referral_id === refId && c.kind === 'sale');
  if (old) old.amount_php = fee; else if (fee > 0) db.charges.unshift({ id: uid(), partner_id: p.id, kind: 'sale', description: `Sale to ${org.name}: ₱${sale.toLocaleString()}`, amount_php: fee, occurred_on: today(), referral_id: refId, status: 'unbilled' });
  return fee;
}
export async function adminAddCharge(partnerId, description, amount, on) { db.charges.unshift({ id: uid(), partner_id: partnerId, kind: 'other', description, amount_php: amount, occurred_on: on || today(), status: 'unbilled' }); }
export async function adminWaiveCharge(id) { db.charges.find((c) => c.id === id).status = 'waived'; }
export async function adminCreateStatement(partnerId, through) {
  const list = db.charges.filter((c) => c.partner_id === partnerId && c.status === 'unbilled' && c.occurred_on <= through);
  if (!list.length) throw new Error('Nothing to bill for this firm up to that date.');
  const s = { id: uid(), partner_id: partnerId, number: billNo('P'), period_end: through, total_php: list.reduce((t, c) => t + c.amount_php, 0), status: 'sent', sent_at: now(), due_on: addDays(15), created_at: now() };
  db.statements.unshift(s);
  list.forEach((c) => Object.assign(c, { status: 'billed', statement_id: s.id }));
  return s.id;
}
export async function adminStatementPaid(id, method, ref, no) {
  const s = db.statements.find((x) => x.id === id);
  Object.assign(s, { status: 'paid', paid_at: now(), paid_method: method, paid_ref: ref, bir_invoice_no: no || s.bir_invoice_no || null });
  db.charges.filter((c) => c.statement_id === id).forEach((c) => { c.status = 'paid'; });
}
export async function adminStatementVoid(id, note) {
  Object.assign(db.statements.find((x) => x.id === id), { status: 'void', note });
  db.charges.filter((c) => c.statement_id === id).forEach((c) => Object.assign(c, { status: 'unbilled', statement_id: null }));
}

// ---------------------------------------------------------------- staff: care
const withOrg = (x) => ({ ...x, orgs: { name: x.org_name || org.name } });
export const adminCarePlans = async () => [...db.care.plans, ...db.history.filter((h) => h.type === 'plan')].map(withOrg);
export const adminCareInvoices = async () => db.care.invoices.map(withOrg);
export const adminClaims = async () => db.care.claims.map(withOrg);
export const adminCareGaps = async () => db.care.plans.filter((p) => p.status === 'active').flatMap((p) => covered(p).filter((r) => r.expires && !r.expires_on)
  .map((r) => ({ plan_id: p.id, org_name: org.name, plan_label: p.label, requirement_id: r.id, requirement_name: r.name })));
export const adminCareTiers = async () => tiers.map((t) => ({ ...t }));
export async function adminSaveCareTier(code, patch) { Object.assign(tiers.find((t) => t.code === code), patch); }
export async function adminConfirmCarePayment(id, okPaid, note, no) {
  const i = db.care.invoices.find((x) => x.id === id);
  if (!okPaid) { Object.assign(i, { status: 'due', note: 'We could not find this payment. Please check the reference number and send it again.' }); return; }
  const billing = db.care.plans.find((p) => p.id === i.lines[0]?.plan_id)?.billing || 'monthly';
  if (i.first || i.period_start < addDays(-7)) Object.assign(i, { period_start: today(), period_end: endOf(today(), billing) });
  Object.assign(i, { status: 'paid', paid_at: now(), bir_invoice_no: no || null });
  for (const l of i.lines) { const p = db.care.plans.find((x) => x.id === l.plan_id); if (p && p.status !== 'cancelled') Object.assign(p, { status: 'active', started_on: p.started_on || i.period_start, paid_through: i.period_end }); }
}
export async function adminVoidCareInvoice(id, note) {
  const i = db.care.invoices.find((x) => x.id === id);
  Object.assign(i, { status: 'void', note });
  if (i.first) i.lines.forEach((l) => { const p = db.care.plans.find((x) => x.id === l.plan_id); if (p?.status === 'pending') Object.assign(p, { status: 'cancelled', cancel_at: today(), ended_reason: note }); });
}
export async function adminSetCarePlan(id, status, note) {
  const p = [...db.care.plans, ...db.history].find((x) => x.id === id);
  if (status === 'active' && (!p.paid_through || p.paid_through < today())) throw new Error("Confirm a payment first: the plan isn't paid up.");
  Object.assign(p, { status, ...(status === 'cancelled' ? { cancel_at: today(), ended_reason: note } : {}) });
}
export async function adminDecideClaim(id, approve, amount, note) {
  const c = db.care.claims.find((x) => x.id === id);
  if (!approve && String(note || '').trim().length < 10) throw new Error("Explain why it's declined (the customer sees it).");
  const cap = tiers.find((t) => t.code === db.care.plans.find((p) => p.id === c.plan_id)?.tier)?.guarantee_cap_php || 0;
  Object.assign(c, approve ? { status: 'approved', approved_php: Math.min(amount ?? c.penalty_php, c.penalty_php, cap), decision_note: note || null, decided_at: now() } : { status: 'declined', decision_note: note, decided_at: now() });
}
export async function adminClaimPaid(id, method, ref) { Object.assign(db.care.claims.find((x) => x.id === id), { status: 'paid', paid_at: now(), paid_method: method, paid_ref: ref }); }
export async function adminRecordPlanPayment(f) {
  const pl = plans.find((p) => p.id === f.plan);
  db.planPayments.unshift({ id: uid(), org_name: org.name, plan_id: f.plan, plan_name: pl?.name, months: f.months, amount_php: f.amount, paid_at: now(), bir_invoice_no: f.invoice_no || null });
  org.plan_id = f.plan;
}

// ---------------------------------------------------------------- staff: money (mirrors admin_money)
const dayOf = (ts) => new Date(ts).toLocaleString('en-CA', { timeZone: 'Asia/Manila' }).slice(0, 10);
const moneySettings = { goal: null, ic: '' };
function moneyLines() {
  const L = [];
  const orders = [...db.requests.map((a) => ({ ...a, who: org.name })), ...db.history.filter((h) => h.type === 'order')];
  for (const a of orders) {
    const fee = Number(a.quote_service_fee || 0) + Number(a.quote_rush_fee || 0);
    const base = { label: a.requirement_name, who: a.who || a.org_name, ref_kind: 'order', ref_id: a.id, stream: 'jobs' };
    if (a.paid_at && ['paid', 'refunded'].includes(a.payment_status)) {
      if (fee > 0) L.push({ ...base, day: dayOf(a.paid_at), kind: 'service_fee', state: 'collected', amount: fee, invoice_no: a.bir_invoice_no || null, rush: Number(a.quote_rush_fee || 0) });
      if (Number(a.quote_gov_fees) > 0) L.push({ ...base, day: dayOf(a.paid_at), kind: 'gov_fees_in', state: 'held', amount: Number(a.quote_gov_fees), invoice_no: a.bir_invoice_no || null, rush: 0 });
      if (Number(a.gov_fees_actual) > 0) L.push({ ...base, day: dayOf(a.updated_at || a.paid_at), kind: 'gov_fees_out', state: 'held', amount: -Number(a.gov_fees_actual), invoice_no: null, rush: 0 });
    } else if (['awaiting_payment', 'pending_verification'].includes(a.payment_status) && a.status !== 'cancelled' && fee > 0) {
      L.push({ ...base, day: dayOf(a.accepted_at || a.quoted_at || a.created_at), kind: 'service_fee', state: 'to_collect', amount: fee, invoice_no: null, rush: Number(a.quote_rush_fee || 0) });
    } else if (a.status === 'quoted' && fee > 0) L.push({ ...base, day: dayOf(a.quoted_at), kind: 'service_fee', state: 'pipeline', amount: fee, invoice_no: null, rush: Number(a.quote_rush_fee || 0) });
  }
  for (const r of db.refunds) { const a = db.requests.find((x) => x.id === r.request_id); L.push({ day: dayOf(r.created_at), stream: 'jobs', kind: 'refund', state: r.kind === 'fee_difference' ? 'held' : 'collected', amount: -r.amount_php, label: a?.requirement_name, who: org.name, ref_kind: 'order', ref_id: r.request_id, invoice_no: null, rush: 0 }); }
  const invs = [...db.care.invoices.map((i) => ({ ...i, who: org.name })), ...db.history.filter((h) => h.type === 'care')];
  for (const i of invs) {
    if (i.status === 'paid') L.push({ day: dayOf(i.paid_at), stream: 'care', kind: 'care_fee', state: 'collected', amount: i.amount_php, label: 'Year-round care, bill ' + i.number, who: i.who, ref_kind: 'care', ref_id: i.id, invoice_no: i.bir_invoice_no || null, rush: 0 });
    else if (['due', 'pending_verification'].includes(i.status)) L.push({ day: i.due_on, stream: 'care', kind: 'care_fee', state: 'to_collect', amount: i.amount_php, label: 'Year-round care, bill ' + i.number, who: i.who, ref_kind: 'care', ref_id: i.id, invoice_no: null, rush: 0 });
  }
  for (const c of db.care.claims) {
    if (c.status === 'paid') L.push({ day: dayOf(c.paid_at), stream: 'care', kind: 'guarantee', state: 'cost', amount: -c.approved_php, label: 'On-time guarantee: ' + c.requirement_name, who: org.name, ref_kind: 'claim', ref_id: c.id, invoice_no: null, rush: 0 });
    if (c.status === 'approved') L.push({ day: dayOf(c.decided_at), stream: 'care', kind: 'guarantee', state: 'to_pay', amount: -c.approved_php, label: 'On-time guarantee: ' + c.requirement_name, who: org.name, ref_kind: 'claim', ref_id: c.id, invoice_no: null, rush: 0 });
  }
  for (const c of db.charges.filter((x) => x.status !== 'waived')) {
    const s = db.statements.find((x) => x.id === c.statement_id);
    L.push({ day: c.status === 'paid' && s?.paid_at ? dayOf(s.paid_at) : c.occurred_on, stream: 'partners', kind: c.kind, state: { paid: 'collected', billed: 'to_collect' }[c.status] || 'unbilled', amount: c.amount_php,
      label: c.description, who: db.partners.find((p) => p.id === c.partner_id)?.name || 'Firm', ref_kind: s ? 'statement' : 'partner', ref_id: s?.id || c.partner_id, invoice_no: s?.bir_invoice_no || null, rush: 0 });
  }
  for (const c of db.credits.filter((x) => x.kind === 'topup')) L.push({ day: dayOf(c.created_at), stream: 'partners', kind: 'credit_topup', state: 'collected', amount: c.amount_php, label: 'Prepaid credit for quote requests',
    who: db.partners.find((p) => p.id === c.partner_id)?.name || 'Firm', ref_kind: 'credit', ref_id: c.id, invoice_no: c.bir_invoice_no || null, rush: 0 });
  for (const pm of db.planPayments) L.push({ day: dayOf(pm.paid_at), stream: 'plans', kind: 'team_plan', state: 'collected', amount: pm.amount_php, label: `${pm.plan_name} plan, ${pm.months} month${pm.months > 1 ? 's' : ''}`, who: pm.org_name, ref_kind: 'plan', ref_id: pm.id, invoice_no: pm.bir_invoice_no || null, rush: 0 });
  return L.sort((a, b) => String(b.day).localeCompare(String(a.day)));
}
export const adminMoney = async (from, to) => moneyLines().filter((l) => (l.day >= from && l.day <= to) || ['to_collect', 'pipeline', 'unbilled', 'to_pay'].includes(l.state));
export async function adminMoneySummary() {
  const L = moneyLines();
  const live = [...db.care.plans, ...db.history.filter((h) => h.type === 'plan')];
  const active = live.filter((p) => p.status === 'active' && p.paid_through >= today());
  const miss = new Set(L.filter((l) => !l.invoice_no && ((l.state === 'collected' && l.amount > 0 && l.ref_kind !== 'claim') || l.kind === 'gov_fees_in')).map((l) => l.ref_kind + l.ref_id));
  return {
    today: today(), goal: moneySettings.goal, ic_licence_no: moneySettings.ic,
    mrr_care: active.filter((p) => !p.cancel_at).reduce((t, p) => t + (p.billing === 'yearly' ? p.price_php / 12 : p.price_php), 0),
    care_active: active.length, care_autorenew: live.filter((p) => p.status === 'active' && p.billing === 'per_renewal').length, care_pending: live.filter((p) => p.status === 'pending').length, care_paused: live.filter((p) => p.status === 'paused').length,
    care_ending: live.filter((p) => p.cancel_at && p.status !== 'cancelled').length,
    mrr_plans: globalThis.PP_DEMO ? 6470 : 0, plans_paying: globalThis.PP_DEMO ? 3 : 0,
    held_gov: L.filter((l) => l.state === 'held').reduce((t, l) => t + l.amount, 0),
    gov_unrecorded: db.requests.filter((a) => a.status === 'completed' && a.paid_at && Number(a.quote_gov_fees) > 0 && a.gov_fees_actual == null).length,
    quotes_to_send: db.requests.filter((a) => a.status === 'submitted').length, care_to_quote: db.requests.filter((a) => a.status === 'submitted' && a.care_plan_id).length,
    order_payments_to_check: db.requests.filter((a) => a.payment_status === 'pending_verification').length,
    care_payments_to_check: db.care.invoices.filter((i) => i.status === 'pending_verification').length,
    care_overdue: db.care.invoices.filter((i) => i.status === 'due' && i.due_on < today()).length,
    claims_to_decide: db.care.claims.filter((c) => c.status === 'submitted').length, claims_to_pay: db.care.claims.filter((c) => c.status === 'approved').length,
    partners_to_bill: new Set(db.charges.filter((c) => c.status === 'unbilled' && c.occurred_on < today().slice(0, 8) + '01').map((c) => c.partner_id)).size,
    statements_overdue: db.statements.filter((s) => s.status === 'sent' && s.due_on < today()).length,
    applications_new: db.apps.filter((a) => a.status === 'new').length,
    disputes_open: db.disputes.filter((d) => d.status === 'open').length, firms_paused: db.partners.filter((p) => p.published && !partnerLive(p)).length,
    credit_held: db.partners.reduce((t, p) => t + Number(p.credit_php || 0), 0), staff_access_open: db.staffAccess.filter((x) => !x.ended_at).length,
    covered_missing_dates: (await adminCareGaps()).length, missing_invoice: miss.size,
  };
}
export async function adminSetMoneySetting(key, value) {
  if (key === 'money_goal') { if (value && !/^\d{0,9}(\.\d{1,2})?$/.test(value)) throw new Error('Enter the goal in pesos, e.g. 100000.'); moneySettings.goal = value ? Number(value) : null; }
  else moneySettings.ic = value;
}
export async function adminSetInvoiceNo(kind, id, no) {
  const target = kind === 'order' ? [...db.requests, ...db.history].find((x) => x.id === id) : kind === 'care' ? [...db.care.invoices, ...db.history].find((x) => x.id === id)
    : kind === 'statement' ? db.statements.find((x) => x.id === id) : kind === 'credit' ? db.credits.find((x) => x.id === id) : db.planPayments.find((x) => x.id === id);
  if (!target) throw new Error('Payment not found.');
  target.bir_invoice_no = no || null;
}

// ---------------------------------------------------------------- demo: a year of money, a care plan, a checklist line, an application
if (REV) {
  db.partners.push({ id: 'p3', category: 'fire_safety', name: 'Metro Fire Safety Supply (sample)', description: 'Extinguisher refills, tagging and fire-safety signs.', services: 'Extinguisher refill and tagging',
    licence: 'BFP-accredited', cities: [], coverage: 'Metro Manila and Cebu', website: '', type_codes: ['fsic'], published: true, verified: true, sort: 30, fee_model: 'monthly', monthly_fee_php: 2500, contact_email: 'hello@metrofire.ph' });
  db.placements.push({ id: 'pl1', partner_id: 'p3', type_code: 'fsic', item_key: 'ready', cities: [], headline: 'Extinguishers refilled and tagged within the week', starts_on: addDays(-40), ends_on: addDays(140), monthly_fee_php: 2500, active: true, created_at: now() });
}
if (REV && globalThis.PP_DEMO) {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const daysAgo = (d) => new Date(Date.now() - d * 864e5).toISOString();
  const custs = ['Lola Nena Bakeshop', 'Bright Smile Dental', 'Kuya Jun Hardware', 'Mabuhay Printing', 'Sunrise Laundry Hub', 'Kape Uno Ortigas', 'Isla Water Station', 'Golden Wok Eatery'];
  const jobs = globalThis.PP_IN_PERSON
    ? [["Mayor's / Business Permit renewal", 6000, 2000], ['Barangay Business Clearance', 1500, 500], ['Fire Safety Inspection Certificate (FSIC)', 3000, 1000], ['LTO vehicle registration renewal', 2000, 800], ['New business registration', 25000, 5000], ['Set up my account for me', 1500, 0]]
    : [['Set up my account for me', 1500, 0], ['Set up my account for me', 3000, 0], ['DTI business name renewal', 1500, 500], ['PhilGEPS Platinum renewal', 2500, 800], ['DOLE establishment registration', 2000, 0]];
  for (let d = 360; d > 2; d -= 4 + Math.floor(rnd() * 5)) {
    const growth = 1 + (360 - d) / 200; // the business grows over the year
    const n = rnd() < 0.35 * growth ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const [name, fee, rushFee] = jobs[Math.floor(rnd() * (d > 200 ? 4 : jobs.length))];
      const isRush = rnd() < 0.2 && rushFee > 0;
      db.history.push({ type: 'order', id: uid(), org_name: custs[Math.floor(rnd() * custs.length)], requirement_name: name, quote_service_fee: fee, quote_rush_fee: isRush ? rushFee : 0, quote_gov_fees: Math.round(rnd() * 6000),
        gov_fees_actual: null, paid_at: daysAgo(d), payment_status: 'paid', status: 'completed', bir_invoice_no: d > 20 ? 'INV-' + (1000 + Math.round(d)) : null });
      const h = db.history[db.history.length - 1];
      if (d > 12) h.gov_fees_actual = h.quote_gov_fees; // paid to the agency; the newest ones are still being filed
    }
  }
  // care customers (only when in-person work is on), starting a few months ago and growing
  if (globalThis.PP_IN_PERSON) [['Bright Smile Dental', 'Main branch (Pasig City)', 'branch_plus', 1200, 150], ['Kape Uno Ortigas', 'Main branch (Pasig City)', 'branch_plus', 1200, 120], ['Golden Wok Eatery', 'Main branch (Quezon City)', 'branch_plus', 1200, 75],
   ['Isla Water Station', 'Delivery van · NCF 2201', 'vehicle_plus', 250, 60], ['Isla Water Station', 'Delivery van · NCF 2202', 'vehicle_plus', 250, 60], ['Lola Nena Bakeshop', 'Main branch (Quezon City)', 'branch_plus', 1200, 40]]
    .forEach(([who, label, tier, price, since]) => {
      const id = uid();
      db.history.push({ type: 'plan', id, org_name: who, label: `${who} · ${label}`, tier, billing: 'monthly', price_php: price, status: 'active', started_on: addDays(-since), paid_through: addDays(30 - (since % 30)), cancel_at: null });
      for (let d = since; d > 0; d -= 30) db.history.push({ type: 'care', id: uid(), org_name: who, who, number: billNo('C'), amount_php: price, status: 'paid', paid_at: daysAgo(d), due_on: addDays(-d), bir_invoice_no: d > 25 ? 'INV-C' + d : null });
    });
  // fees from firms: leads and a listing over the past months, billed and paid monthly
  const firmFees = [['p1', 'lead', 500, 'Quote request'], ['p2', 'lead', 400, 'Quote request'], ['p3', 'placement', 2500, 'Featured on the "Fire Safety Inspection Certificate (FSIC)" checklist']];
  for (let m = 5; m >= 1; m--) {
    for (const [pid, kind, amt, desc] of firmFees) {
      const count = kind === 'lead' ? 2 + Math.floor(rnd() * 4) : 1;
      if (pid === 'p3' && m > 2) continue;
      const day = addDays(-30 * m - 5);
      const stmt = { id: uid(), partner_id: pid, number: billNo('P'), period_end: addDays(-30 * m), total_php: amt * count, status: 'paid', sent_at: daysAgo(30 * m - 2), due_on: addDays(-30 * m + 13), paid_at: daysAgo(30 * m - 10), paid_method: 'Bank transfer', bir_invoice_no: m > 1 ? 'INV-P' + m + pid : null, created_at: daysAgo(30 * m - 2) };
      db.statements.push(stmt);
      for (let i = 0; i < count; i++) db.charges.push({ id: uid(), partner_id: pid, kind, description: `${desc}${kind === 'lead' ? ' from ' + custs[i % custs.length] : ''}`, amount_php: amt, occurred_on: day, status: 'paid', statement_id: stmt.id });
    }
  }
  db.charges.unshift({ id: uid(), partner_id: 'p1', kind: 'lead', description: 'Quote request from Mabuhay Printing', amount_php: 500, occurred_on: addDays(-35), status: 'unbilled' },
    { id: uid(), partner_id: 'p3', kind: 'placement', description: 'Featured on the "Fire Safety Inspection Certificate (FSIC)" checklist, this month', amount_php: 2500, occurred_on: today().slice(0, 8) + '01', status: 'unbilled' });
  for (let m = 6; m >= 0; m--) db.planPayments.push({ id: uid(), org_name: ['Pacific Fleet Rentals', 'Reyes & Co. CPAs', 'Kape Uno Head Office'][m % 3], plan_id: ['fleet', 'firm', 'head_office'][m % 3], plan_name: ['Fleet', 'Accounting firm', 'Head office'][m % 3],
    months: 1, amount_php: [1490, 1990, 4990][m % 3], paid_at: daysAgo(30 * m + 3), bir_invoice_no: m ? 'INV-T' + m : null });
  // a licence Care doesn't renew (quoted per job), on the branch with the All-in plan
  addReq('business', 'b2', 'l2', { code: null, name: 'FDA License to Operate', expires: true }, { reference_no: 'FDA-LTO-3301', expires_on: addDays(140) });
  // this workspace: the All-in plan on the Cebu main branch (paid), a pickup on pay per renewal, a renewal the plan started
  if (globalThis.PP_IN_PERSON) {
  const l2 = db.locations.find((l) => l.id === 'l2');
  const cp = { id: 'cp1', org_id: org.id, tier: 'branch_plus', location_id: 'l2', vehicle_id: null, business_id: 'b2', label: `Visayas Sari-Sari Distribution Co. · Main branch (${l2.city})`, billing: 'monthly', price_php: 1200,
    status: 'active', started_on: addDays(-70), paid_through: addDays(20), cancel_at: null, consented_at: daysAgo(70), created_at: daysAgo(70) };
  const vp = { id: 'cp2', org_id: org.id, tier: 'vehicle_care', location_id: null, vehicle_id: 'v2', business_id: 'b2', label: 'Toyota Hilux · NBC 4417', billing: 'per_renewal', price_php: 0,
    status: 'active', started_on: addDays(-30), paid_through: null, cancel_at: null, consented_at: daysAgo(30), created_at: daysAgo(30) };
  db.care.plans.push(cp, vp);
  db.care.invoices.push({ id: uid(), org_id: org.id, number: billNo('C'), first: false, period_start: addDays(-40), period_end: addDays(-11), lines: [{ plan_id: 'cp1', label: cp.label, tier: 'All-in plan', amount: 1200 }], amount_php: 1200, status: 'paid', due_on: addDays(-41), paid_at: daysAgo(41), bir_invoice_no: 'INV-C77', created_at: daysAgo(47) },
    { id: uid(), org_id: org.id, number: billNo('C'), first: true, period_start: addDays(-70), period_end: addDays(-41), lines: [{ plan_id: 'cp1', label: cp.label, tier: 'All-in plan', amount: 1200 }], amount_php: 1200, status: 'paid', due_on: addDays(-67), paid_at: daysAgo(70), bir_invoice_no: 'INV-C51', created_at: daysAgo(70) });
  // the paid-up period after the two paid bills
  db.care.invoices.find((i) => i.number && i.amount_php === 1200 && !i.first).period_end = addDays(20);
  const mp2 = db.requirements.find((r) => r.business_id === 'b2' && r.location_id === 'l2' && r.type_code === 'mayors_permit');
  const ca = { id: 'ord2', org_id: org.id, created_by: null, service_code: 'renew_mayors_permit', requirement_id: mp2.id, business_id: 'b2', vehicle_id: null, person_id: null, care_plan_id: 'cp1',
    requirement_name: mp2.name, subject_label: 'Visayas Sari-Sari Distribution Co.', notes: 'Started by your Year-round care plan.', rush: false, contact_method: 'email', contact_value: 'sadie@test.ph', docs_status: 'not_sure',
    status: 'quoted', payment_status: 'unpaid', quote_service_fee: 0, quote_rush_fee: 0, quote_gov_fees: 8200, quote_php: 8200, quote_note: "Based on last year's assessment of the City Treasurer.", quoted_at: daysAgo(1), due_on: addDays(22), created_at: daysAgo(3), updated_at: now(), kind: 'renew', consented_at: daysAgo(70) };
  db.requests.unshift(ca);
  event(ca, 'created', 'Started automatically by your Year-round care plan.', true);
  event(ca, 'quote', 'Quote: ₱8,200 (service fee ₱0, government fees ₱8,200)', true);
  }
  db.apps.push({ id: uid(), name: 'Cebu Pest Busters', category: 'pest_control', cities: 'Cebu City, Mandaue City', contact_name: 'Rhea Lim', email: 'rhea@pestbusters.ph', phone: '+639171112222', licence: 'FDA LTO for pest control', services: 'Pest control and certificates', website: '', message: 'We serve restaurants and warehouses.', status: 'new', created_at: daysAgo(1) });
  const st = placementStat('pl1'); st.views = 41; st.clicks = 6; st.leads = 2;
  // prepaid credit: two top-ups, quote requests from other customers, one the firm reported
  const p1 = db.partners.find((p) => p.id === 'p1');
  let bal = 0;
  for (const [d, amt, ref] of [[60, 5000, 'GC-55120'], [20, 5000, 'BPI-88201']]) {
    bal += amt; db.credits.push({ id: uid(), partner_id: 'p1', kind: 'topup', amount_php: amt, balance_php: bal, note: 'Prepaid credit', paid_method: d > 30 ? 'GCash' : 'Bank transfer', paid_ref: ref, bir_invoice_no: d > 30 ? 'INV-CR1' : null, created_at: daysAgo(d) });
  }
  const leadsFrom = [['Kuya Jun Hardware', 50, 'converted'], ['Mabuhay Printing', 41, 'converted'], ['Sunrise Laundry Hub', 33, 'not_converted'], ['Golden Wok Eatery', 18, 'converted'], ['Lola Nena Bakeshop', 9, 'requested'], ['Bright Smile Dental', 3, 'requested'], ['Isla Water Station', 1, 'requested']];
  for (const [who, d, status] of leadsFrom) {
    const r = { id: uid(), org_id: 'other', org_name: who, partner_id: 'p1', requirement_id: null, note: "Mayor's Permit renewal", status, created_at: daysAgo(d), commission: { amount_php: 500, status: 'paid' }, placement_id: null, token: uid() };
    db.referrals.push(r);
    bal -= 500; db.credits.push({ id: uid(), partner_id: 'p1', kind: 'lead', amount_php: -500, balance_php: bal, referral_id: r.id, note: 'Quote request from ' + who, created_at: daysAgo(d) });
    if (d === 3) db.disputes.push({ id: uid(), referral_id: r.id, partner_id: 'p1', reason: 'duplicate', note: 'They called us directly the day before.', status: 'open', credited_php: 0, decision_note: null, created_at: daysAgo(1) });
  }
  db.credits.sort((a, b) => b.created_at.localeCompare(a.created_at));
  p1.credit_php = bal;
  moneySettings.goal = 60000;
}
