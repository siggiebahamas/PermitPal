// Every call to the backend lives here. Views never talk to Supabase directly.
// Errors are thrown as-is; the UI turns them into plain-language messages (friendlyError).
import { SUPABASE_URL, SUPABASE_KEY, MAX_UPLOAD_BYTES, ALLOWED_TYPES } from './config.js';

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const ok = ({ data, error }) => { if (error) throw error; return data; };
const appUrl = () => location.origin + location.pathname;

// ---------------------------------------------------------------- auth
export const auth = {
  session: async () => ok(await sb.auth.getSession()).session,
  onChange: (cb) => sb.auth.onAuthStateChange((event, session) => cb(event, session)),
  signIn: async (email, password) => ok(await sb.auth.signInWithPassword({ email, password })),
  signUp: async (email, password, firstName, lastName) => ok(await sb.auth.signUp({
    email, password,
    options: { data: { first_name: firstName, last_name: lastName }, emailRedirectTo: appUrl() },
  })),
  google: async () => ok(await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: appUrl() } })),
  signOut: async () => { await sb.auth.signOut(); },
  sendReset: async (email) => ok(await sb.auth.resetPasswordForEmail(email, { redirectTo: appUrl() })),
  setPassword: async (password) => ok(await sb.auth.updateUser({ password })),
};

// ---------------------------------------------------------------- account & workspace
export async function loadMe(userId) {
  const [profile, memberships, plans, prefs] = await Promise.all([
    sb.from('profiles').select('*').eq('id', userId).single().then(ok),
    sb.from('org_members').select('role, orgs(*)').eq('user_id', userId).then(ok),
    sb.from('plans').select('*').order('sort').then(ok),
    sb.from('notification_prefs').select('*').eq('user_id', userId).maybeSingle().then(ok),
  ]);
  const orgs = memberships.filter((m) => m.orgs).map((m) => ({ ...m.orgs, role: m.role }));
  orgs.sort((a, b) => a.name.localeCompare(b.name));
  return { profile, orgs, plans, prefs };
}

export const createOrg = async (name) => ok(await sb.rpc('create_org', { p_name: name }));
export const setCurrentOrg = async (userId, orgId) =>
  ok(await sb.from('profiles').update({ current_org_id: orgId }).eq('id', userId));
export const renameOrg = async (orgId, name) => ok(await sb.from('orgs').update({ name }).eq('id', orgId));
export const requestOrgDeletion = async (orgId) => ok(await sb.rpc('request_org_deletion', { p_org: orgId }));
export const cancelOrgDeletion = async (orgId) => ok(await sb.rpc('cancel_org_deletion', { p_org: orgId }));

export const updateProfile = async (userId, patch) => ok(await sb.from('profiles').update(patch).eq('id', userId));
export const updatePrefs = async (userId, patch) => ok(await sb.from('notification_prefs').update(patch).eq('user_id', userId));
export const channelStatus = async () => ok(await sb.rpc('channel_status'));

export async function uploadAvatar(userId, file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Please choose a JPG, PNG or WebP photo.');
  if (file.size > 2 * 1024 * 1024) throw new Error('Photos must be 2 MB or smaller.');
  const path = `${userId}/avatar-${Date.now()}.${file.type.split('/')[1]}`;
  ok(await sb.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type }));
  await updateProfile(userId, { avatar_path: path });
  return path;
}
export async function avatarUrl(path) {
  if (!path) return null;
  const { data } = await sb.storage.from('avatars').createSignedUrl(path, 3600);
  return data?.signedUrl || null;
}

// ---------------------------------------------------------------- workspace data
let typesCache = null;
let servicesCache = null;
export async function loadOrgData(orgId, { revenue = false, plus = false } = {}) {
  if (!typesCache) typesCache = ok(await sb.from('requirement_types').select('*').order('sort'));
  if (!servicesCache) servicesCache = ok(await sb.from('services').select('*').eq('active', true).order('sort'));
  const [businesses, locations, vehicles, people, reqs, requests, members, care, plusData] = await Promise.all([
    sb.from('businesses').select('*').eq('org_id', orgId).is('deleted_at', null).order('name').then(ok),
    sb.from('business_locations').select('*').eq('org_id', orgId).is('deleted_at', null).order('is_main', { ascending: false }).order('name').then(ok),
    sb.from('vehicles').select('*').eq('org_id', orgId).is('deleted_at', null).order('make_model').then(ok),
    sb.from('people').select('*').eq('org_id', orgId).is('deleted_at', null).order('full_name').then(ok),
    sb.from('requirement_status').select('*').eq('org_id', orgId).then(ok),
    sb.from('assistance_requests').select('*').eq('org_id', orgId).order('created_at', { ascending: false }).then(ok),
    loadMembers(orgId),
    revenue ? loadCare(orgId) : { plans: [], invoices: [], coverage: [], claims: [], tiers: [], staff: [] },
    plus ? loadPlus(orgId) : { addons: [], invoices: [], roles: [], submissions: [], stopping: {} },
  ]);
  return { types: typesCache, services: servicesCache, businesses, locations, vehicles, people, reqs, requests, members, care, plus: plusData };
}

// The team, with each teammate's profile (org_members points at auth.users, so profiles come separately).
export async function loadMembers(orgId) {
  const members = ok(await sb.from('org_members').select('user_id, role, created_at').eq('org_id', orgId));
  const profiles = members.length
    ? ok(await sb.from('profiles').select('id, first_name, last_name, email, avatar_path, role_title').in('id', members.map((m) => m.user_id)))
    : [];
  for (const m of members) m.profile = profiles.find((p) => p.id === m.user_id) || {};
  return members;
}
// Year-round care: the plans, bills, which permit each plan covers, claims, prices, and any temporary
// PermitPal access (small lists, used on many pages; refreshed when the care or team page opens).
export async function loadCare(orgId) {
  const [plans, invoices, coverage, claims, tiers, staff] = await Promise.all([
    sb.from('care_plans').select('*').eq('org_id', orgId).order('created_at').then(ok),
    sb.from('care_invoices').select('*').eq('org_id', orgId).order('created_at', { ascending: false }).limit(60).then(ok),
    sb.rpc('care_coverage', { p_org: orgId }).then(ok),
    sb.from('guarantee_claims').select('*').eq('org_id', orgId).order('created_at', { ascending: false }).then(ok),
    sb.from('care_tiers').select('*').eq('active', true).order('sort').then(ok),
    sb.rpc('my_staff_access', { p_org: orgId }).then(ok),
  ]);
  return { plans, invoices, coverage, claims, tiers, staff };
}

// ---------------------------------------------------------------- businesses, branches, vehicles
export const createBusiness = async (orgId, f) => ok(await sb.rpc('create_business', {
  p_org: orgId, p_name: f.name, p_structure: f.structure, p_activity: f.activity, p_city: f.city || '', p_address: f.address || '',
}));
export const updateBusiness = async (id, patch) => ok(await sb.from('businesses').update(patch).eq('id', id));
export const addLocation = async (businessId, f) => ok(await sb.rpc('add_location', {
  p_business: businessId, p_name: f.name, p_city: f.city || '', p_address: f.address || '',
}));
export const updateLocation = async (id, patch) => ok(await sb.from('business_locations').update(patch).eq('id', id));

export const createVehicle = async (orgId, f) => ok(await sb.rpc('create_vehicle', {
  p_org: orgId, p_make_model: f.make_model, p_plate_no: f.plate_no, p_vehicle_type: f.vehicle_type, p_cr_no: f.cr_no || '',
  p_business: f.business_id || null, p_or_no: f.or_no || null, p_registration_expires: f.registration_expires || null,
  p_ctpl_provider: f.ctpl_provider || null, p_ctpl_policy_no: f.ctpl_policy_no || null, p_ctpl_expires: f.ctpl_expires || null,
}));
export const updateVehicle = async (id, patch) => ok(await sb.from('vehicles').update(patch).eq('id', id));

export const createPerson = async (orgId, f) => ok(await sb.rpc('create_person', {
  p_org: orgId, p_full_name: f.full_name, p_role: f.role_title || '', p_business: f.business_id || null, p_types: f.types || [],
}));
export const updatePerson = async (id, patch) => ok(await sb.from('people').update(patch).eq('id', id));

// Soft delete / restore for any table that has deleted_at.
export const softDelete = async (table, id) => ok(await sb.from(table).update({ deleted_at: new Date().toISOString() }).eq('id', id));
export const restore = async (table, id) => ok(await sb.from(table).update({ deleted_at: null }).eq('id', id));

// ---------------------------------------------------------------- requirements, records, documents
export const addRequirement = async (f) => ok(await sb.rpc('add_requirement', {
  p_subject: f.subject, p_subject_id: f.subject_id, p_location: f.location_id || null, p_type_code: f.type_code || null,
  p_name: f.name || null, p_expires: f.expires ?? null,
  p_reference_no: f.reference_no || null, p_issuer: f.issuer || null, p_issued_on: f.issued_on || null, p_expires_on: f.expires_on || null,
}));
export const updateRequirement = async (id, patch) => ok(await sb.from('requirements').update(patch).eq('id', id));

export async function requirementDetail(reqId, { checklist = false } = {}) {
  const [cycles, documents, activity, ticks] = await Promise.all([
    sb.from('requirement_cycles').select('*').eq('requirement_id', reqId).is('deleted_at', null).order('seq', { ascending: false }).then(ok),
    sb.from('documents').select('*').eq('requirement_id', reqId).is('deleted_at', null).order('created_at', { ascending: false }).then(ok),
    sb.from('audit_log').select('id, summary, action, actor_id, created_at').eq('requirement_id', reqId).order('created_at', { ascending: false }).limit(30).then(ok),
    checklist ? sb.from('checklist_progress').select('round, item, done_by, done_at').eq('requirement_id', reqId).then(ok) : [],
  ]);
  return { cycles, documents, activity, ticks };
}
// Tick or untick a renewal checklist item; returns the permit period it was saved against.
export const setChecklistItem = async (reqId, item, done) => ok(await sb.rpc('set_checklist_item', { p_req: reqId, p_item: item, p_done: !!done }));

// Record a new permit period (renewal / first record) or correct the current one.
export async function saveCycle({ cycleId, orgId, requirementId, reference_no, issuer, issued_on, expires_on, amount_paid }) {
  const row = {
    reference_no: reference_no || null, issuer: issuer || null,
    issued_on: issued_on || null, expires_on: expires_on || null,
    amount_paid: amount_paid === '' || amount_paid == null ? null : Number(amount_paid),
  };
  if (cycleId) {
    ok(await sb.from('requirement_cycles').update(row).eq('id', cycleId));
    return cycleId;
  }
  return ok(await sb.from('requirement_cycles').insert({ ...row, org_id: orgId, requirement_id: requirementId }).select('id').single()).id;
}

export function checkFile(file) {
  if (!file || !file.size) return 'Please choose a file.';
  if (file.size > MAX_UPLOAD_BYTES) return 'Files must be 10 MB or smaller.';
  const type = file.type || '';
  const extOk = /\.(pdf|jpe?g|png|webp|heic|heif)$/i.test(file.name);
  if (!ALLOWED_TYPES.includes(type) && !extOk) return 'Please upload a PDF or a photo (JPG, PNG, WebP, HEIC).';
  return null;
}

export async function uploadDocument({ orgId, requirementId, cycleId, file }) {
  const problem = checkFile(file);
  if (problem) throw new Error(problem);
  const safe = file.name.normalize('NFKD').replace(/[^\w.\-]+/g, '_').slice(-100) || 'file';
  const path = `${orgId}/${requirementId}/${globalThis.crypto?.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)}-${safe}`;
  const contentType = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : 'image/jpeg');
  ok(await sb.storage.from('documents').upload(path, file, { contentType, upsert: false }));
  return ok(await sb.from('documents').insert({
    org_id: orgId, requirement_id: requirementId, cycle_id: cycleId, storage_path: path,
    file_name: file.name.slice(0, 255), mime_type: contentType, size_bytes: file.size,
  }).select('*').single());
}

// A file's contents (for the .zip packs and reading photos), straight from private storage.
export async function fileBlob(path) {
  const { data, error } = await sb.storage.from('documents').download(path);
  if (error) throw error;
  return data;
}
export async function fileUrl(path, downloadName) {
  const { data, error } = await sb.storage.from('documents').createSignedUrl(path, 300, downloadName ? { download: downloadName } : undefined);
  if (error) throw error;
  return data.signedUrl;
}

export const orgDocuments = async (orgId) =>
  ok(await sb.from('documents').select('id, requirement_id, cycle_id, file_name, mime_type, size_bytes, storage_path, created_at')
    .eq('org_id', orgId).is('deleted_at', null).order('created_at', { ascending: false }));

export const allCycles = async (orgId) =>
  ok(await sb.from('requirement_cycles').select('requirement_id, reference_no, issuer, issued_on, expires_on, amount_paid, seq, created_at')
    .eq('org_id', orgId).is('deleted_at', null).order('seq'));

// ---------------------------------------------------------------- done-for-you services (orders)
const safeName = (name) => name.normalize('NFKD').replace(/[^\w.\-]+/g, '_').slice(-100) || 'file';
const rand = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export const listPlans = async () => ok(await sb.from('plans').select('*').order('sort'));
export const listServices = async () => ok(await sb.from('services').select('*').eq('active', true).order('sort'));
export const requestService = async (f) => ok(await sb.rpc('request_service', {
  p_org: f.org_id, p_service: f.service_code, p_requirement: f.requirement_id || null, p_business: f.business_id || null,
  p_vehicle: f.vehicle_id || null, p_person: f.person_id || null, p_notes: f.notes || null, p_rush: !!f.rush,
  p_contact_method: f.contact_method || 'email', p_contact_value: f.contact_value || null, p_docs_status: f.docs_status || 'not_sure',
  p_kind: f.kind || 'renew', p_consent: !!f.consent,
}));
export const cancelHelpRequest = async (id) => ok(await sb.from('assistance_requests').update({ status: 'cancelled' }).eq('id', id));
export const orderRefunds = async (reqId) =>
  ok(await sb.from('order_refunds').select('id, amount_php, kind, reason, method, reference, created_at').eq('request_id', reqId).order('created_at'));
export const staffAccessLog = async (orgId) =>
  ok(await sb.from('staff_file_access').select('id, staff_name, file_name, reason, created_at').eq('org_id', orgId).order('created_at', { ascending: false }).limit(200));
export const getRequest = async (id) => ok(await sb.from('assistance_requests').select('*').eq('id', id).maybeSingle());
export const orderEvents = async (reqId) =>
  ok(await sb.from('request_events').select('*').eq('request_id', reqId).order('id'));
export const acceptQuote = async (reqId, access = false) => ok(await sb.rpc('accept_quote', access ? { p_req: reqId, p_access: true } : { p_req: reqId }));

// Files attached to an order (payment proof, messages) live in the workspace folder.
export async function uploadRequestFile(orgId, reqId, file) {
  const problem = checkFile(file);
  if (problem) throw new Error(problem);
  const path = `${orgId}/requests/${reqId}/${rand()}-${safeName(file.name)}`;
  const contentType = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : 'image/jpeg');
  ok(await sb.storage.from('documents').upload(path, file, { contentType, upsert: false }));
  return { path, name: file.name.slice(0, 255), type: contentType, size: file.size };
}
export async function submitPayment(a, { method, ref, file }) {
  const up = file && file.size ? await uploadRequestFile(a.org_id, a.id, file) : null;
  return ok(await sb.rpc('submit_payment', { p_req: a.id, p_method: method, p_ref: ref || null, p_proof_path: up?.path || null, p_proof_name: up?.name || null }));
}
export async function addOrderMessage(a, message, file) {
  const up = file && file.size ? await uploadRequestFile(a.org_id, a.id, file) : null;
  return ok(await sb.rpc('add_order_message', { p_req: a.id, p_message: message || null, p_file_path: up?.path || null, p_file_name: up?.name || null }));
}
export async function startOrderCheckout(reqId) {
  const { data, error } = await sb.functions.invoke('create-checkout', { body: { request_id: reqId } });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  return data.checkout_url;
}
export async function appSettings() {
  const rows = ok(await sb.from('app_settings').select('key, value'));
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

// ---------------------------------------------------------------- partners & referrals
export const listPartners = async () => ok(await sb.rpc('list_professionals'));
export const requestReferral = async (f) => ok(await sb.rpc('request_referral', {
  p_org: f.org_id, p_partner: f.partner_id, p_requirement: f.requirement_id || null, p_note: f.note || null,
  p_contact_method: f.contact_method || 'email', p_contact_value: f.contact_value || null,
  ...(f.placement_id ? { p_placement: f.placement_id } : {}),
}));
export const myReferrals = async (orgId) =>
  ok(await sb.from('referrals').select('id, partner_id, requirement_id, note, status, created_at').eq('org_id', orgId).order('created_at', { ascending: false }));

// ---------------------------------------------------------------- sharing
export const createShare = async (f) => ok(await sb.from('compliance_shares').insert({
  org_id: f.org_id, scope: f.scope, subject_id: f.subject_id || null, label: f.label || '', show_refs: f.show_refs !== false,
  expires_at: new Date(Date.now() + Number(f.days || 30) * 864e5).toISOString(),
}).select('*').single());
export const listShares = async (orgId) =>
  ok(await sb.from('compliance_shares').select('*').eq('org_id', orgId).order('created_at', { ascending: false }));
export const revokeShare = async (id) => ok(await sb.from('compliance_shares').update({ revoked_at: new Date().toISOString() }).eq('id', id));
export const getSharedCompliance = async (token) => ok(await sb.rpc('get_shared_compliance', { p_token: token }));

// ---------------------------------------------------------------- notifications & delivery log
export const listNotifications = async (limit = 100) =>
  ok(await sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(limit));
export const unreadCount = async () =>
  (await sb.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null)).count || 0;
export const markRead = async (ids) => ok(await sb.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids));
export const markAllRead = async () => ok(await sb.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null));
export const deleteNotification = async (id) => ok(await sb.from('notifications').delete().eq('id', id));
export const clearNotifications = async (userId) => ok(await sb.from('notifications').delete().eq('user_id', userId));
export function onNewNotification(userId, cb) {
  const ch = sb.channel('notif-' + userId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, (p) => cb(p.new))
    .subscribe();
  return () => sb.removeChannel(ch);
}
export const myDeliveryLog = async (userId) =>
  ok(await sb.from('message_outbox').select('id, channel, to_address, subject, body_text, status, last_error, created_at, sent_at')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(30));

// ---------------------------------------------------------------- history & trash
export async function history(orgId, { before = null, entities = null, limit = 50 } = {}) {
  let q = sb.from('audit_log').select('id, entity, entity_id, action, summary, actor_id, business_id, vehicle_id, requirement_id, created_at')
    .eq('org_id', orgId).order('id', { ascending: false }).limit(limit);
  if (before) q = q.lt('id', before);
  if (entities?.length) q = q.in('entity', entities);
  return ok(await q);
}
export const entityHistory = async (column, id) =>
  ok(await sb.from('audit_log').select('id, summary, action, actor_id, created_at').eq(column, id).order('id', { ascending: false }).limit(40));

export async function trash(orgId) {
  const q = (t, cols) => sb.from(t).select(cols).eq('org_id', orgId).not('deleted_at', 'is', null).order('deleted_at', { ascending: false }).limit(200).then(ok);
  const [businesses, locations, vehicles, people, requirements, cycles, documents] = await Promise.all([
    q('businesses', 'id, name, deleted_at'),
    q('business_locations', 'id, name, business_id, deleted_at'),
    q('vehicles', 'id, make_model, plate_no, deleted_at'),
    q('people', 'id, full_name, role_title, deleted_at'),
    q('requirements', 'id, name, business_id, vehicle_id, person_id, deleted_at'),
    q('requirement_cycles', 'id, requirement_id, reference_no, expires_on, deleted_at'),
    q('documents', 'id, file_name, requirement_id, deleted_at'),
  ]);
  return { businesses, locations, vehicles, people, requirements, cycles, documents };
}

// ---------------------------------------------------------------- team
export const invites = async (orgId) =>
  ok(await sb.from('org_invites').select('*').eq('org_id', orgId).is('accepted_at', null).is('revoked_at', null).order('created_at', { ascending: false }));
export const invite = async (orgId, email, role) => ok(await sb.from('org_invites').insert({ org_id: orgId, email, role }).select('*').single());
export const revokeInvite = async (id) => ok(await sb.from('org_invites').update({ revoked_at: new Date().toISOString() }).eq('id', id));
export const setMemberRole = async (orgId, userId, role) => ok(await sb.rpc('set_member_role', { p_org: orgId, p_user: userId, p_role: role }));
export const removeMember = async (orgId, userId) => ok(await sb.rpc('remove_member', { p_org: orgId, p_user: userId }));
export const invitePreview = async (token) => ok(await sb.rpc('invite_preview', { p_token: token }));
export const acceptInvite = async (token) => ok(await sb.rpc('accept_invite', { p_token: token }));

// ---------------------------------------------------------------- billing
export const payments = async (orgId) =>
  ok(await sb.from('payments').select('*').eq('org_id', orgId).order('created_at', { ascending: false }).limit(24));
export async function startCheckout(orgId, planId, months) {
  const { data, error } = await sb.functions.invoke('create-checkout', { body: { org_id: orgId, plan_id: planId, months } });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  return data.checkout_url;
}

// ---------------------------------------------------------------- PermitPal staff console
export const adminOrgs = async () => ok(await sb.rpc('admin_orgs'));
export const adminOrgKinds = async () => ok(await sb.from('orgs').select('id, kind, trial_ends_at'));
export const adminSetPlan = async (orgId, plan, expires) => ok(await sb.rpc('admin_set_plan', { p_org: orgId, p_plan: plan, p_expires: expires }));
export const adminRequests = async (care = false) =>
  ok(await sb.from('assistance_requests').select(care ? '*, orgs(name, care_gov_preapproval_php), care_plans(billing)' : '*, orgs(name)').order('created_at', { ascending: false }).limit(300));
export const adminOutbox = async () =>
  ok(await sb.from('message_outbox').select('id, channel, to_address, subject, status, attempts, last_error, created_at, sent_at')
    .order('id', { ascending: false }).limit(100));
export const adminRequestDocs = async (reqId) =>
  ok(await sb.from('documents').select('id, file_name, storage_path, created_at').eq('requirement_id', reqId).is('deleted_at', null));
export const adminQuote = async (reqId, fee, gov, note, rush = 0) => ok(await sb.rpc('admin_quote_request', {
  p_req: reqId, p_service_fee: fee, p_gov_fees: gov, p_note: note || null, ...(rush ? { p_rush_fee: rush } : {}) }));
export const adminConfirmPayment = async (reqId, okPaid, note) => ok(await sb.rpc('admin_confirm_payment', { p_req: reqId, p_ok: okPaid, p_note: note || null }));
export async function adminUpdateOrder(a, { status, message, file, govActual, provider }) {
  const up = file && file.size ? await uploadRequestFile(a.org_id, a.id, file) : null;
  return ok(await sb.rpc('admin_update_order', {
    p_req: a.id, p_status: status || null, p_message: message || null, p_file_path: up?.path || null, p_file_name: up?.name || null,
    p_gov_fees_actual: govActual === '' || govActual == null ? null : Number(govActual), p_provider: provider || null,
  }));
}
export async function adminRecordRenewal(a, f, file) {
  let up = null;
  if (file && file.size) {
    const problem = checkFile(file);
    if (problem) throw new Error(problem);
    const path = `${a.org_id}/${a.requirement_id}/${rand()}-${safeName(file.name)}`;
    const type = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : 'image/jpeg');
    ok(await sb.storage.from('documents').upload(path, file, { contentType: type, upsert: false }));
    up = { path, name: file.name.slice(0, 255), type, size: file.size };
  }
  return ok(await sb.rpc('admin_record_renewal', {
    p_req: a.id, p_reference: f.reference_no || null, p_issuer: f.issuer || null, p_issued: f.issued_on || null, p_expires: f.expires_on || null,
    p_amount: f.amount_paid === '' || f.amount_paid == null ? null : Number(f.amount_paid),
    p_file_path: up?.path || null, p_file_name: up?.name || null, p_mime: up?.type || null, p_size: up?.size || null,
  }));
}
export const adminServices = async () => ok(await sb.from('services').select('*').order('sort'));
export const adminSaveService = async (code, patch) => ok(await sb.from('services').update(patch).eq('code', code));
export const adminPartners = async () => ok(await sb.from('partners').select('*').order('sort').order('name'));
export const adminSavePartner = async (id, row) => ok(id
  ? await sb.from('partners').update(row).eq('id', id)
  : await sb.from('partners').insert(row));
export const adminReferrals = async () =>
  ok(await sb.from('referrals').select('*, orgs(name), partners(name, category), referral_commissions(*)').order('created_at', { ascending: false }).limit(300));
export const adminSaveReferral = async (id, status) => ok(await sb.from('referrals').update({ status }).eq('id', id));
export const adminSaveCommission = async (id, patch) => ok(await sb.from('referral_commissions').update(patch).eq('referral_id', id));
export const adminSettings = appSettings;
export const adminRefund = async (reqId, f) => ok(await sb.rpc('admin_refund_order', {
  p_req: reqId, p_amount: Number(f.amount), p_kind: f.kind, p_reason: f.reason, p_method: f.method || null, p_reference: f.reference || null,
}));
export const adminTestEmail = async () => ok(await sb.rpc('admin_test_email'));
// Staff open customer files through the staff-file function, which logs every open.
export async function staffFileUrl(path, download) {
  const { data, error } = await sb.functions.invoke('staff-file', { body: { path, download: download || null } });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  return data.url;
}
export const adminSaveSetting = async (key, value) => ok(await sb.from('app_settings').update({ value, updated_at: new Date().toISOString() }).eq('key', key));

// ---------------------------------------------------------------- team tools (head office, firm, property, fleet)
export const setOrgProfile = async (orgId, patch) => ok(await sb.from('orgs').update(patch).eq('id', orgId));
export const networkBoard = async (orgId) => ok(await sb.rpc('network_board', { p_owner: orgId }));
export const linkInvite = async (orgId, relation, email, label) => ok(await sb.rpc('link_invite', { p_owner: orgId, p_relation: relation, p_email: email, p_label: label || '' }));
export const linkPreview = async (token) => ok(await sb.rpc('link_preview', { p_token: token }));
export const linkAccept = async (token, memberOrg, share) => ok(await sb.rpc('link_accept', { p_token: token, p_member_org: memberOrg, p_share_files: !!share }));
export const linkDecline = async (token) => ok(await sb.rpc('link_decline', { p_token: token }));
export const linkEnd = async (id) => ok(await sb.rpc('link_end', { p_link: id }));
export const linkSetSharing = async (id, share) => ok(await sb.rpc('link_set_sharing', { p_link: id, p_share: !!share }));
export const linkSetLabel = async (id, label) => ok(await sb.rpc('link_set_label', { p_link: id, p_label: label }));
export const linkToken = async (id) => ok(await sb.from('org_links').select('token').eq('id', id).single()).token;
export const myConnections = async (orgId) => ok(await sb.rpc('my_connections', { p_org: orgId }));
export const networkDocuments = async (owner, member) => ok(await sb.rpc('network_documents', { p_owner: owner, p_member: member }));
export const networkNudge = async (owner, links, orgs, message) => ok(await sb.rpc('network_nudge', { p_owner: owner, p_links: links || [], p_orgs: orgs || [], p_message: message || null }));
export const requestPlan = async (orgId, plan, note) => ok(await sb.rpc('request_plan', { p_org: orgId, p_plan: plan, p_note: note || null }));

// ---------------------------------------------------------------- contact PermitPal (works signed in or out)
export const contactSupport = async ({ topic, message, name, email, orgId }) => ok(await sb.rpc('contact_support', {
  p_topic: topic, p_message: message, p_name: name || null, p_email: email || null, p_org: orgId || null,
}));
export const adminSupportMessages = async () =>
  ok(await sb.from('support_messages').select('*, orgs(name)').order('created_at', { ascending: false }).limit(300));
export const adminSetSupportStatus = async (id, status) => ok(await sb.from('support_messages').update({ status }).eq('id', id));

// ---------------------------------------------------------------- newer features (switched on per database)
// Which newer features the database supports. An older database has no app_features(): nothing new shows.
export async function features() {
  const { data, error } = await sb.rpc('app_features');
  if (error) return {};
  return data || {};
}

// ---------------------------------------------------------------- error reports
export const logClientError = async (r) => ok(await sb.rpc('log_client_error', {
  p_message: r.message, p_stack: r.stack || null, p_route: r.route || null, p_version: r.version || null, p_agent: r.agent || null, p_org: r.orgId || null,
}));
export const adminErrors = async (open = true) => {
  let q = sb.from('client_errors').select('*').order('last_seen', { ascending: false }).limit(200);
  q = open ? q.is('resolved_at', null) : q.not('resolved_at', 'is', null);
  return ok(await q);
};
export const adminResolveError = async (id, resolved, note) => ok(await sb.rpc('admin_resolve_error', { p_id: id, p_resolved: resolved, p_note: note || null }));

// ---------------------------------------------------------------- who's handling it
export const assignRequirements = async (ids, userId) => ok(await sb.rpc('assign_requirements', { p_ids: ids, p_assignee: userId || null }));
export const setEscalation = async (orgId, days) => ok(await sb.rpc('set_escalation', { p_org: orgId, p_days: days || null }));

// ---------------------------------------------------------------- tax and contribution deadlines
let filingTypesCache = null;
export const filingTypes = async () => (filingTypesCache ||= ok(await sb.from('filing_types').select('*').order('sort')));
export const filingSetups = async (orgId) => ok(await sb.from('filing_setup').select('*').eq('org_id', orgId));
export const filingCalendar = async (orgId, from, to) => ok(await sb.rpc('filing_calendar', { p_org: orgId, p_from: from, p_to: to }));
export const saveFilingSetup = async (businessId, f) => ok(await sb.rpc('save_filing_setup', {
  p_business: businessId, p_has_employees: !!f.has_employees, p_withholds: !!f.withholds, p_tax_type: f.tax_type,
  p_philhealth_digit: f.philhealth_digit ?? null, p_pagibig_group: f.pagibig_group || null, p_annual_meeting: f.annual_meeting || null, p_paused: f.paused || [],
}));
export const removeFilingSetup = async (businessId) => ok(await sb.rpc('remove_filing_setup', { p_business: businessId }));
export const markFiling = async (f) => ok(await sb.rpc('mark_filing', {
  p_business: f.business_id, p_code: f.code, p_period: f.period_start, p_filed_on: f.filed_on,
  p_reference: f.reference || null, p_amount: f.amount ?? null, p_note: f.note || null,
}));
export const unmarkFiling = async (id) => ok(await sb.rpc('unmark_filing', { p_id: id }));

// ---------------------------------------------------------------- text messages (verified numbers only)
export const startPhoneVerification = async (phone) => ok(await sb.rpc('start_phone_verification', { p_phone: phone }));
export const confirmPhoneCode = async (code) => ok(await sb.rpc('confirm_phone_code', { p_code: code }));
export const removePhone = async () => ok(await sb.rpc('remove_phone'));

// ---------------------------------------------------------------- two-step login (Supabase Auth TOTP)
export const mfa = {
  aal: async () => ok(await sb.auth.mfa.getAuthenticatorAssuranceLevel()),
  factors: async () => ok(await sb.auth.mfa.listFactors()),
  enroll: async (name) => ok(await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: name })),
  verify: async (factorId, code) => ok(await sb.auth.mfa.challengeAndVerify({ factorId, code })),
  unenroll: async (factorId) => ok(await sb.auth.mfa.unenroll({ factorId })),
};
export const lockedOrgs = async () => ok(await sb.rpc('my_locked_orgs'));
export const setRequireMfa = async (orgId, on) => ok(await sb.rpc('set_require_mfa', { p_org: orgId, p_on: !!on }));
export const adminResetMfa = async (email, reason) => ok(await sb.rpc('admin_reset_mfa', { p_email: email, p_reason: reason }));

// ---------------------------------------------------------------- one-time jobs: several at once, set-up, steps
export const requestServicesBulk = async (f) => ok(await sb.rpc('request_services_bulk', {
  p_org: f.org_id, p_reqs: f.requirement_ids, p_rush: !!f.rush, p_contact_method: f.contact_method || 'email',
  p_contact_value: f.contact_value || null, p_notes: f.notes || null, p_consent: !!f.consent,
}));
export const adminOrderStep = async (reqId, done) => ok(await sb.rpc('admin_order_step', { p_req: reqId, p_done: done }));
export const adminJoinWorkspace = async (reqId) => ok(await sb.rpc('admin_join_workspace', { p_req: reqId }));

// ---------------------------------------------------------------- year-round care
async function uploadCareFile(orgId, folder, file) {
  const problem = checkFile(file);
  if (problem) throw new Error(problem);
  const path = `${orgId}/care/${folder}/${rand()}-${safeName(file.name)}`;
  const contentType = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : 'image/jpeg');
  ok(await sb.storage.from('documents').upload(path, file, { contentType, upsert: false }));
  return { path, name: file.name.slice(0, 255) };
}
export const careTiers = async () => ok(await sb.from('care_tiers').select('*').eq('active', true).order('sort'));
export const startCare = async (orgId, items, billing) => ok(await sb.rpc('start_care', { p_org: orgId, p_items: items, p_billing: billing, p_consent: true }));
export const cancelCare = async (planId, reason) => ok(await sb.rpc('cancel_care', { p_plan: planId, p_reason: reason || null }));
export const resumeCare = async (planId) => ok(await sb.rpc('resume_care', { p_plan: planId }));
export const setCarePreapproval = async (orgId, amount) => ok(await sb.rpc('set_care_preapproval', { p_org: orgId, p_amount: amount }));
export async function payCareInvoice(inv, { method, ref, file }) {
  const up = file && file.size ? await uploadCareFile(inv.org_id, inv.id, file) : null;
  return ok(await sb.rpc('pay_care_invoice', { p_invoice: inv.id, p_method: method, p_ref: ref || null, p_proof_path: up?.path || null, p_proof_name: up?.name || null }));
}
export async function fileGuaranteeClaim(orgId, { plan_id, requirement_id, penalty, note, file }) {
  const up = file && file.size ? await uploadCareFile(orgId, 'claims', file) : null;
  return ok(await sb.rpc('file_guarantee_claim', { p_plan: plan_id, p_requirement: requirement_id, p_penalty: penalty, p_note: note || null,
    p_receipt_path: up?.path || null, p_receipt_name: up?.name || null }));
}

// ---------------------------------------------------------------- firms: checklist lines, applications
export const listPlacements = async () => ok(await sb.rpc('list_placements'));
export const logPlacement = async (ids, kind) => ok(await sb.rpc('log_placement', { p_ids: ids, p_kind: kind }));
export const applyAsPartner = async (f) => ok(await sb.rpc('apply_as_partner', {
  p_name: f.name, p_category: f.category, p_cities: f.cities || '', p_contact_name: f.contact_name, p_email: f.email, p_phone: f.phone || '',
  p_licence: f.licence || '', p_services: f.services || '', p_website: f.website || '', p_message: f.message || '', p_trap: f.trap || null,
  ...(f.attested === undefined ? {} : { p_attested: !!f.attested }), // the firm vouches for itself (databases with the Small property file)
}));

// ---------------------------------------------------------------- staff: money, care, firms
export const adminMoney = async (from, to) => ok(await sb.rpc('admin_money', { p_from: from, p_to: to }));
export const adminMoneySummary = async () => ok(await sb.rpc('admin_money_summary'));
export const adminSetMoneySetting = async (key, value) => ok(await sb.rpc('admin_set_money_setting', { p_key: key, p_value: value }));
export const adminSetInvoiceNo = async (kind, id, no) => ok(await sb.rpc('admin_set_invoice_no', { p_kind: kind, p_id: id, p_no: no || null }));
export const adminRecordPlanPayment = async (f) => ok(await sb.rpc('admin_record_plan_payment', {
  p_org: f.org_id, p_plan: f.plan, p_months: f.months, p_amount: f.amount, p_method: f.method || null, p_ref: f.ref || null, p_invoice_no: f.invoice_no || null,
}));
export const adminCarePlans = async () => ok(await sb.from('care_plans').select('*, orgs(name)').order('created_at', { ascending: false }).limit(500));
export const adminCareInvoices = async () => ok(await sb.from('care_invoices').select('*, orgs(name)').order('created_at', { ascending: false }).limit(300));
export const adminClaims = async () => ok(await sb.from('guarantee_claims').select('*, orgs(name)').order('created_at', { ascending: false }).limit(200));
export const adminCareGaps = async () => ok(await sb.rpc('admin_care_gaps'));
export const adminCareTiers = async () => ok(await sb.from('care_tiers').select('*').order('sort'));
export const adminSaveCareTier = async (code, patch) => ok(await sb.from('care_tiers').update(patch).eq('code', code));
export const adminConfirmCarePayment = async (id, okPaid, note, invoiceNo) => ok(await sb.rpc('admin_confirm_care_payment', {
  p_invoice: id, p_ok: !!okPaid, p_note: note || null, p_invoice_no: invoiceNo || null }));
export const adminVoidCareInvoice = async (id, note) => ok(await sb.rpc('admin_void_care_invoice', { p_invoice: id, p_note: note }));
export const adminSetCarePlan = async (id, status, note) => ok(await sb.rpc('admin_set_care_plan', { p_plan: id, p_status: status, p_note: note }));
export const adminDecideClaim = async (id, approve, amount, note) => ok(await sb.rpc('admin_decide_claim', { p_claim: id, p_approve: !!approve, p_amount: amount ?? null, p_note: note || null }));
export const adminClaimPaid = async (id, method, ref) => ok(await sb.rpc('admin_claim_paid', { p_claim: id, p_method: method || null, p_ref: ref || null }));
export const adminPlacements = async () => ok(await sb.from('partner_placements').select('*').order('starts_on', { ascending: false }));
export const adminSavePlacement = async (id, row) => ok(id
  ? await sb.from('partner_placements').update(row).eq('id', id)
  : await sb.from('partner_placements').insert(row));
export const adminPlacementStats = async (from, to) => ok(await sb.rpc('admin_placement_stats', { p_from: from, p_to: to }));
export const adminCharges = async () => ok(await sb.from('partner_charges').select('*').order('occurred_on', { ascending: false }).limit(1000));
export const adminStatements = async () => ok(await sb.from('partner_statements').select('*').order('created_at', { ascending: false }).limit(300));
export const adminRecordSale = async (refId, sale, note) => ok(await sb.rpc('admin_record_sale', { p_referral: refId, p_sale_php: sale, p_note: note || null }));
// Prepaid credit for firms paid per quote request, their reports on bad leads, and the customer's answer.
export const adminCredits = async () => ok(await sb.from('partner_credits').select('*').order('created_at', { ascending: false }).limit(1000));
export const adminAddCredit = async (id, amount, method, ref, no) => ok(await sb.rpc('admin_add_credit', { p_partner: id, p_amount: amount, p_method: method, p_ref: ref || null, p_invoice_no: no || null }));
export const adminAdjustCredit = async (id, amount, note) => ok(await sb.rpc('admin_adjust_credit', { p_partner: id, p_amount: amount, p_note: note }));
export const adminDisputes = async () => ok(await sb.from('lead_disputes').select('*, partners(name), referrals(created_at, note, orgs(name))').order('created_at', { ascending: false }).limit(300));
export const adminDecideDispute = async (id, accept, note) => ok(await sb.rpc('admin_decide_dispute', { p_dispute: id, p_accept: accept, p_note: note || null }));
export const leadForFirm = async (token) => ok(await sb.rpc('lead_for_firm', { p_token: token }));
export const reportLead = async (token, reason, note) => ok(await sb.rpc('report_lead', { p_token: token, p_reason: reason, p_note: note || null }));
export const answerReferral = async (id, hired) => ok(await sb.rpc('answer_referral', { p_referral: id, p_hired: hired }));
export const adminAddCharge = async (partnerId, description, amount, on) => ok(await sb.rpc('admin_add_partner_charge', { p_partner: partnerId, p_description: description, p_amount: amount, p_on: on || null }));
export const adminWaiveCharge = async (id) => ok(await sb.rpc('admin_waive_charge', { p_charge: id }));
export const adminCreateStatement = async (partnerId, through, email) => ok(await sb.rpc('admin_create_statement', { p_partner: partnerId, p_through: through, p_email: !!email }));
export const adminStatementPaid = async (id, method, ref, invoiceNo) => ok(await sb.rpc('admin_statement_paid', { p_statement: id, p_method: method || null, p_ref: ref || null, p_invoice_no: invoiceNo || null }));
export const adminStatementVoid = async (id, note) => ok(await sb.rpc('admin_statement_void', { p_statement: id, p_note: note }));
export const adminApplications = async () => ok(await sb.from('partner_applications').select('*').order('created_at', { ascending: false }).limit(200));
export const adminApplicationToPartner = async (id) => ok(await sb.rpc('admin_application_to_partner', { p_app: id }));
export const adminSetApplication = async (id, patch) => ok(await sb.from('partner_applications').update(patch).eq('id', id));

// ---------------------------------------------------------------- PermitPal Plus and staff licenses
// Plans you add on, their bills, licenses by role and photos workers sent (small lists, loaded with the workspace).
export async function loadPlus(orgId) {
  const [addons, invoices, roles, submissions, stopping] = await Promise.all([
    sb.from('addons').select('*').eq('org_id', orgId).then(ok),
    sb.from('addon_invoices').select('*').eq('org_id', orgId).order('created_at', { ascending: false }).limit(24).then(ok),
    sb.from('staff_roles').select('*').eq('org_id', orgId).order('name').then(ok),
    sb.from('worker_submissions').select('*').eq('org_id', orgId).eq('status', 'pending').order('created_at').then(ok),
    sb.rpc('addon_stopping', { p_org: orgId }).then(ok),
  ]);
  return { addons, invoices, roles, submissions, stopping: stopping || {} };
}
export const addonPreview = async (orgId, kind, people, billing) => ok(await sb.rpc('addon_preview', { p_org: orgId, p_kind: kind, p_people: people ?? null, p_billing: billing }));
export const addonCheckout = async (orgId, kind, people, billing) => ok(await sb.rpc('addon_checkout', { p_org: orgId, p_kind: kind, p_people: people ?? null, p_billing: billing }));
export const addonCancelInvoice = async (id) => ok(await sb.rpc('addon_cancel_invoice', { p_invoice: id }));
export const addonStop = async (orgId, kind) => ok(await sb.rpc('addon_stop', { p_org: orgId, p_kind: kind }));
export const addonResume = async (orgId, kind) => ok(await sb.rpc('addon_resume', { p_org: orgId, p_kind: kind }));
export const startPlusTrial = async (orgId) => ok(await sb.rpc('start_plus_trial', { p_org: orgId }));
export async function addonReportPayment(inv, { method, ref, file }) {
  let proof = null;
  if (file && file.size) {
    const problem = checkFile(file);
    if (problem) throw new Error(problem);
    proof = { path: `${inv.org_id}/billing/${inv.id}/${rand()}-${safeName(file.name)}`, name: file.name.slice(0, 255) };
    ok(await sb.storage.from('documents').upload(proof.path, file, { contentType: file.type || 'image/jpeg', upsert: false }));
  }
  return ok(await sb.rpc('addon_report_payment', { p_invoice: inv.id, p_method: method, p_ref: ref || null, p_proof_path: proof?.path || null, p_proof_name: proof?.name || null }));
}
// Online checkout (GCash, Maya, card) for a bill: the same checkout as team plans, with the bill as the "plan".
export async function startAddonCheckout(inv) {
  const { data, error } = await sb.functions.invoke('create-checkout', { body: { org_id: inv.org_id, plan_id: `addon:${inv.id}`, months: inv.months } });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  return data.checkout_url;
}

// Staff: contact details, the worker's upload link, photos they sent, licenses by role.
export const updatePersonContact = async (id, f) => ok(await sb.from('people').update({ email: f.email || null, mobile: f.mobile || null, remind_worker: f.remind_worker !== false }).eq('id', id));
export const workerLink = async (reqId) => ok(await sb.rpc('worker_link', { p_requirement: reqId }));
export const workerDecide = async (id, approve, f = {}) => ok(await sb.rpc('worker_decide', {
  p_submission: id, p_approve: !!approve, p_expires: f.expires_on || null, p_issued: f.issued_on || null, p_ref: f.reference_no || null, p_note: f.note || null,
}));
export const saveStaffRole = async (orgId, name, types) => ok(await sb.rpc('save_staff_role', { p_org: orgId, p_name: name, p_types: types || [] }));
export const deleteStaffRole = async (id) => ok(await sb.rpc('delete_staff_role', { p_id: id }));
export const applyStaffRole = async (id) => ok(await sb.rpc('apply_staff_role', { p_id: id }));
// The worker's page (no account): what to send, the upload, and sending it.
export const workerPage = async (token) => ok(await sb.rpc('worker_page', { p_token: token }));
export async function workerSend(page, token, { file, expires_on, issued_on, reference_no, note }) {
  const problem = checkFile(file);
  if (problem) throw new Error(problem);
  const path = `${page.folder}/${rand()}-${safeName(file.name)}`;
  const contentType = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : 'image/jpeg');
  ok(await sb.storage.from('documents').upload(path, file, { contentType, upsert: false }));
  return ok(await sb.rpc('worker_submit', {
    p_token: token, p_path: path, p_file_name: file.name.slice(0, 255), p_mime: contentType, p_size: file.size,
    p_expires: expires_on || null, p_issued: issued_on || null, p_ref: reference_no || null, p_note: note || null,
  }));
}

// The public permit page, who gets the updates, and who looked.
export const trustPages = async (orgId) => ok(await sb.from('trust_pages').select('*').eq('org_id', orgId).order('created_at'));
export const trustPageSave = async (orgId, f) => ok(await sb.rpc('trust_page_save', {
  p_org: orgId, p_business: f.business_id || null, p_title: f.title, p_intro: f.intro || null, p_show_vehicles: !!f.show_vehicles,
  p_show_staff: !!f.show_staff, p_show_refs: !!f.show_refs, p_files: f.files || 'off', p_hidden: f.hidden || [], p_live: f.live !== false,
}));
export const trustNewCode = async (id) => ok(await sb.rpc('trust_page_new_code', { p_page: id }));
export const trustDelete = async (id) => ok(await sb.rpc('trust_page_delete', { p_page: id }));
export const trustRecipients = async (pageId) => ok(await sb.from('trust_recipients').select('*').eq('page_id', pageId).order('created_at', { ascending: false }));
export const trustAddRecipient = async (pageId, f) => ok(await sb.rpc('trust_add_recipient', { p_page: pageId, p_name: f.name, p_company: f.company || null, p_email: f.email }));
export const trustRemoveRecipient = async (id) => ok(await sb.rpc('trust_remove_recipient', { p_id: id }));
export const trustDecide = async (id, yes) => ok(await sb.rpc('trust_decide_request', { p_id: id, p_ok: !!yes }));
export const trustViews = async (pageId, sinceIso) => ok(await sb.from('trust_page_views').select('viewed_at, source, recipient_id').eq('page_id', pageId)
  .gte('viewed_at', sinceIso).order('viewed_at', { ascending: false }).limit(5000));

// The automatic permit check.
export const runPermitCheck = async (orgId) => ok(await sb.rpc('run_permit_check', { p_org: orgId }));
export const findings = async (orgId) => ok(await sb.from('audit_findings').select('*').eq('org_id', orgId).in('status', ['open', 'dismissed'])
  .order('first_seen_at', { ascending: false }).limit(500));
export const dismissFinding = async (id, note) => ok(await sb.rpc('dismiss_finding', { p_id: id, p_note: note || null }));
export const reopenFinding = async (id) => ok(await sb.rpc('reopen_finding', { p_id: id }));
export const saveDocumentReading = async (docId, reading) => ok(await sb.rpc('save_document_reading', { p_doc: docId, p_reading: reading }));
export const unreadPhotos = async (orgId) => ok(await sb.from('documents').select('id, requirement_id, cycle_id, storage_path, file_name, mime_type')
  .eq('org_id', orgId).is('deleted_at', null).is('read_at', null).like('mime_type', 'image/%').order('created_at', { ascending: false }).limit(200));

// Templates.
export const listTemplates = async () => ok(await sb.rpc('list_templates'));
export const getTemplate = async (orgId, code) => ok(await sb.rpc('get_template', { p_org: orgId, p_code: code }));

// White-label (accounting firms): the firm's look, its logo file, and the look a client workspace shows.
export const brandSettings = async (orgId) => ok(await sb.from('org_brands').select('*').eq('org_id', orgId).maybeSingle());
export const brandSave = async (orgId, f) => ok(await sb.rpc('brand_save', {
  p_org: orgId, p_name: f.display_name, p_logo_path: f.logo_path || null, p_color: f.color, p_reply_to: f.reply_to || null, p_phone: f.phone || null,
  p_tagline: f.tagline || null, p_client_report: f.client_report !== false }));
export const startBrandTrial = async (orgId) => ok(await sb.rpc('start_brand_trial', { p_org: orgId }));
export const clientBrand = async (orgId) => ok(await sb.rpc('client_brand', { p_org: orgId }));
export const linkBrand = async (token) => ok(await sb.rpc('link_brand', { p_token: token }));
export const LOGO_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg' }; // what email apps (Outlook too) can show
export const LOGO_MAX_BYTES = 512 * 1024;
export async function uploadBrandLogo(orgId, file) {
  if (!LOGO_TYPES[file.type]) throw new Error('Use a PNG or JPG image for the logo.');
  if (file.size > LOGO_MAX_BYTES) throw new Error('That logo is over 512 KB. Save it smaller (about 400 pixels wide is plenty) and try again.');
  const path = `${orgId}/logo-${rand()}.${LOGO_TYPES[file.type]}`;
  ok(await sb.storage.from('brand').upload(path, file, { contentType: file.type, upsert: false, cacheControl: '31536000' }));
  return path;
}
export const removeBrandLogo = async (path) => { if (path) await sb.storage.from('brand').remove([path]); };
export const brandLogoUrl = (path) => (path ? sb.storage.from('brand').getPublicUrl(path).data.publicUrl : null);

// Staff (PermitPal): bills to confirm, plans, giving time.
export const adminAddonInvoices = async () => ok(await sb.from('addon_invoices').select('*, orgs(name)').order('created_at', { ascending: false }).limit(300));
export const adminAddons = async () => ok(await sb.from('addons').select('*, orgs(name)').order('updated_at', { ascending: false }).limit(1000));
export const adminConfirmAddonPayment = async (id, okPaid, note, invoiceNo) => ok(await sb.rpc('admin_confirm_addon_payment', {
  p_invoice: id, p_ok: !!okPaid, p_note: note || null, p_invoice_no: invoiceNo || null }));
export const adminVoidAddonInvoice = async (id, note) => ok(await sb.rpc('admin_void_addon_invoice', { p_invoice: id, p_note: note }));
export const adminSetAddon = async (orgId, kind, people, until, note) => ok(await sb.rpc('admin_set_addon', { p_org: orgId, p_kind: kind, p_people: people ?? null, p_until: until, p_note: note || null }));

// ---------------------------------------------------------------- PermitPal load
// A prepaid balance per workspace: top-ups (by transfer or online), text packs, single templates, papers checks,
// the renewal season pass and invitations. Every price and rule is checked again by the database.
export const loadSummary = async (orgId) => ok(await sb.rpc('load_summary', { p_org: orgId }));
export const loadProducts = async () => ok(await sb.from('load_products').select('*').order('sort'));
export const loadEntries = async (orgId, limit = 60) => ok(await sb.from('load_entries').select('*').eq('org_id', orgId).order('created_at', { ascending: false }).limit(limit));
export const loadTopups = async (orgId) => ok(await sb.from('load_topups').select('*').eq('org_id', orgId).order('created_at', { ascending: false }).limit(20));
export const seasonPasses = async (orgId) => ok(await sb.from('season_passes').select('*').eq('org_id', orgId).order('season', { ascending: false }));
export async function topupStart(orgId, amount) {
  const id = ok(await sb.rpc('load_topup_start', { p_org: orgId, p_amount: amount }));
  return ok(await sb.from('load_topups').select('*').eq('id', id).single());
}
export async function topupReport(t, { method, ref, file }) {
  let proof = null;
  if (file && file.size) {
    const problem = checkFile(file);
    if (problem) throw new Error(problem);
    proof = { path: `${t.org_id}/load/${t.id}/${rand()}-${safeName(file.name)}`, name: file.name.slice(0, 255) };
    ok(await sb.storage.from('documents').upload(proof.path, file, { contentType: file.type || 'image/jpeg', upsert: false }));
  }
  return ok(await sb.rpc('load_topup_report', { p_topup: t.id, p_method: method, p_ref: ref || null, p_proof_path: proof?.path || null, p_proof_name: proof?.name || null }));
}
export const topupCancel = async (id) => ok(await sb.rpc('load_topup_cancel', { p_topup: id }));
export async function startTopupCheckout(t) {
  const { data, error } = await sb.functions.invoke('create-checkout', { body: { org_id: t.org_id, plan_id: `load:${t.id}`, months: 1 } });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  return data.checkout_url;
}
export const buyTexts = async (orgId, pack) => ok(await sb.rpc('buy_texts', { p_org: orgId, p_pack: pack }));
export const buySeasonPass = async (orgId) => ok(await sb.rpc('buy_season_pass', { p_org: orgId }));
export const templateUnlocks = async (orgId) => ok(await sb.from('template_unlocks').select('code, unlocked_at').eq('org_id', orgId));
export const unlockTemplate = async (orgId, code) => ok(await sb.rpc('unlock_template', { p_org: orgId, p_code: code }));
// Papers checks: the photos go in the check's own folder, so they never count as the permit's document.
export const papersChecks = async (reqId) => ok(await sb.from('papers_checks').select('*').eq('requirement_id', reqId).order('created_at', { ascending: false }).limit(10));
export const papersCheckFiles = async (checkId) => ok(await sb.from('papers_check_files').select('*').eq('check_id', checkId).order('id'));
export const requestPapersCheck = async (orgId, reqId, note) => ok(await sb.rpc('request_papers_check', { p_org: orgId, p_requirement: reqId, p_note: note || null }));
export async function addPapersCheckFile(c, file) {
  const problem = checkFile(file);
  if (problem) throw new Error(problem);
  const path = `${c.org_id}/papers/${c.id}/${rand()}-${safeName(file.name)}`;
  ok(await sb.storage.from('documents').upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false }));
  return ok(await sb.rpc('add_papers_check_file', { p_check: c.id, p_path: path, p_name: file.name.slice(0, 255), p_mime: file.type || null }));
}
export const cancelPapersCheck = async (id) => ok(await sb.rpc('cancel_papers_check', { p_check: id }));
export const inviteCode = async (orgId) => ok(await sb.rpc('invite_code', { p_org: orgId }));
export const claimInvite = async (orgId, code) => ok(await sb.rpc('claim_invite', { p_org: orgId, p_code: code }));
export const myInvites = async (orgId) => ok(await sb.rpc('my_invites', { p_org: orgId }));
// Staff: top-ups to confirm, papers checks to answer, prices, gifts and paying load back.
export const adminTopups = async () => ok(await sb.from('load_topups').select('*, orgs(name)').order('created_at', { ascending: false }).limit(300));
export const adminConfirmTopup = async (id, okPaid, note, invoiceNo) => ok(await sb.rpc('admin_confirm_topup', {
  p_topup: id, p_ok: !!okPaid, p_note: note || null, p_invoice_no: invoiceNo || null }));
export const adminPapersChecks = async () => ok(await sb.from('papers_checks').select('*, orgs(name)').order('created_at', { ascending: false }).limit(300));
export async function adminPapersCheckDetail(c) {
  const [files, docs, req] = await Promise.all([
    sb.from('papers_check_files').select('*').eq('check_id', c.id).order('id').then(ok),
    sb.from('documents').select('id, file_name, storage_path, cycle_id, created_at').eq('requirement_id', c.requirement_id).is('deleted_at', null).order('created_at', { ascending: false }).then(ok),
    sb.from('requirements').select('id, type_code, name').eq('id', c.requirement_id).maybeSingle().then(ok),
  ]);
  return { files, docs, req };
}
export const adminAnswerPapersCheck = async (id, verdict, items, summary) => ok(await sb.rpc('admin_answer_papers_check', { p_check: id, p_verdict: verdict, p_items: items, p_summary: summary }));
export const adminRefundPapersCheck = async (id, note) => ok(await sb.rpc('admin_refund_papers_check', { p_check: id, p_note: note }));
export const adminSaveLoadProduct = async (code, price, active) => ok(await sb.rpc('admin_save_load_product', { p_code: code, p_price: price, p_active: !!active }));
export const adminWallets = async () => ok(await sb.from('load_wallets').select('*, orgs(name)').order('updated_at', { ascending: false }).limit(500));
export const adminLoadGift = async (orgId, amount, texts, note) => ok(await sb.rpc('admin_load_gift', { p_org: orgId, p_amount: amount || 0, p_texts: texts || 0, p_note: note }));
export const adminLoadCashout = async (orgId, amount, method, ref, note) => ok(await sb.rpc('admin_load_cashout', { p_org: orgId, p_amount: amount, p_method: method, p_ref: ref || null, p_note: note || null }));

// ---------------------------------------------------------------- the processing clock and city bills
// The clock counts an office's legal processing time after you file; bills are the office's tax bills and statements,
// kept on the permit, or paid by PermitPal on request. Every rule is checked again by the database.
export const filings = async (reqId) => ok(await sb.from('office_filings').select('*').eq('requirement_id', reqId).order('created_at', { ascending: false }).limit(10));
export const holidays = async (from, to) => ok(await sb.from('ph_holidays').select('day, name, kind').gte('day', from).lte('day', to).order('day'));
export const filingSave = async (f) => ok(await sb.rpc('filing_save', {
  p_id: f.id || null, p_requirement: f.requirement_id || null, p_office: f.office, p_reference: f.reference_no || null, p_filed_on: f.filed_on,
  p_kind: f.kind, p_days: f.days ? Number(f.days) : null, p_fees: f.fees, p_fees_paid_on: f.fees_paid_on || null,
  p_extended: !!f.extended, p_extension_note: f.extension_note || null, p_closed_days: Number(f.closed_days || 0) }));
export const filingClose = async (id, status, on) => ok(await sb.rpc('filing_close', { p_id: id, p_status: status, p_on: on || null }));
export const filingLetter = async (id, kind, ref) => ok(await sb.rpc('filing_letter', { p_id: id, p_kind: kind, p_ref: ref || null }));
export const bills = async (reqId) => ok(await sb.from('gov_bills').select('*').eq('requirement_id', reqId).order('created_at', { ascending: false }).limit(20));
async function uploadBillFile(orgId, folder, file) {
  const problem = checkFile(file);
  if (problem) throw new Error(problem);
  const path = `${orgId}/bills/${folder}/${rand()}-${safeName(file.name)}`;
  ok(await sb.storage.from('documents').upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false }));
  return { path, name: file.name.slice(0, 255) };
}
export async function billAdd(orgId, reqId, f, file) {
  const up = file && file.size ? await uploadBillFile(orgId, rand(), file) : null;
  return ok(await sb.rpc('bill_add', { p_org: orgId, p_requirement: reqId, p_office: f.office, p_ref: f.bill_ref || null, p_amount: Number(f.amount),
    p_pay_by: f.pay_by || null, p_mode: f.mode, p_bill_path: up?.path || null, p_bill_name: up?.name || null }));
}
export async function billReport(b, { method, ref, file }) {
  const up = file && file.size ? await uploadBillFile(b.org_id, b.id, file) : null;
  return ok(await sb.rpc('bill_report', { p_bill: b.id, p_method: method, p_ref: ref || null, p_proof_path: up?.path || null, p_proof_name: up?.name || null }));
}
export const billCancel = async (id) => ok(await sb.rpc('bill_cancel', { p_bill: id }));
export async function billPaidSelf(b, { or_no, or_date, file }) {
  const up = file && file.size ? await uploadBillFile(b.org_id, b.id, file) : null;
  return ok(await sb.rpc('bill_paid_self', { p_bill: b.id, p_or_no: or_no || null, p_or_date: or_date, p_or_path: up?.path || null, p_or_name: up?.name || null }));
}
// Staff: bills to confirm and pay, refunds, offices running late, the holiday calendar.
export const adminBills = async () => ok(await sb.from('gov_bills').select('*, orgs(name)').order('created_at', { ascending: false }).limit(300));
export const adminBillReceived = async (id, okPaid, note, invoiceNo) => ok(await sb.rpc('admin_bill_received', { p_bill: id, p_ok: !!okPaid, p_note: note || null, p_invoice_no: invoiceNo || null }));
export async function adminBillPaid(b, { or_no, or_date, file }) {
  const up = await uploadBillFile(b.org_id, b.id, file);
  return ok(await sb.rpc('admin_bill_paid', { p_bill: b.id, p_or_no: or_no, p_or_date: or_date, p_or_path: up.path, p_or_name: up.name }));
}
export const adminBillRefund = async (id, note, method, ref) => ok(await sb.rpc('admin_bill_refund', { p_bill: id, p_note: note, p_method: method || null, p_ref: ref || null }));
export const adminFilings = async () => ok(await sb.rpc('admin_filings'));
export const adminStartFiling = async (requestId, f) => ok(await sb.rpc('admin_start_filing', { p_request: requestId, p_office: f.office, p_reference: f.reference_no || null,
  p_filed_on: f.filed_on, p_kind: f.kind, p_days: f.days ? Number(f.days) : null }));
export const adminCloseFiling = async (id, status) => ok(await sb.rpc('filing_close', { p_id: id, p_status: status, p_on: null }));
export const adminSetHoliday = async (day, name, kind, remove) => ok(await sb.rpc('admin_set_holiday', { p_day: day, p_name: name || null, p_kind: kind || 'special', p_remove: !!remove }));
