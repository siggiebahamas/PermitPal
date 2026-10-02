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
export async function loadOrgData(orgId) {
  if (!typesCache) typesCache = ok(await sb.from('requirement_types').select('*').order('sort'));
  if (!servicesCache) servicesCache = ok(await sb.from('services').select('*').eq('active', true).order('sort'));
  const [businesses, locations, vehicles, people, reqs, requests, members] = await Promise.all([
    sb.from('businesses').select('*').eq('org_id', orgId).is('deleted_at', null).order('name').then(ok),
    sb.from('business_locations').select('*').eq('org_id', orgId).is('deleted_at', null).order('is_main', { ascending: false }).order('name').then(ok),
    sb.from('vehicles').select('*').eq('org_id', orgId).is('deleted_at', null).order('make_model').then(ok),
    sb.from('people').select('*').eq('org_id', orgId).is('deleted_at', null).order('full_name').then(ok),
    sb.from('requirement_status').select('*').eq('org_id', orgId).then(ok),
    sb.from('assistance_requests').select('*').eq('org_id', orgId).order('created_at', { ascending: false }).then(ok),
    sb.from('org_members').select('user_id, role, created_at').eq('org_id', orgId).then(ok),
  ]);
  // org_members points at auth.users, so fetch teammates' profiles separately.
  const profiles = members.length
    ? ok(await sb.from('profiles').select('id, first_name, last_name, email, avatar_path, role_title').in('id', members.map((m) => m.user_id)))
    : [];
  for (const m of members) m.profile = profiles.find((p) => p.id === m.user_id) || {};
  return { types: typesCache, services: servicesCache, businesses, locations, vehicles, people, reqs, requests, members };
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

export async function requirementDetail(reqId) {
  const [cycles, documents, activity] = await Promise.all([
    sb.from('requirement_cycles').select('*').eq('requirement_id', reqId).is('deleted_at', null).order('seq', { ascending: false }).then(ok),
    sb.from('documents').select('*').eq('requirement_id', reqId).is('deleted_at', null).order('created_at', { ascending: false }).then(ok),
    sb.from('audit_log').select('id, summary, action, actor_id, created_at').eq('requirement_id', reqId).order('created_at', { ascending: false }).limit(30).then(ok),
  ]);
  return { cycles, documents, activity };
}

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

export const listServices = async () => ok(await sb.from('services').select('*').eq('active', true).order('sort'));
export const requestService = async (f) => ok(await sb.rpc('request_service', {
  p_org: f.org_id, p_service: f.service_code, p_requirement: f.requirement_id || null, p_business: f.business_id || null,
  p_vehicle: f.vehicle_id || null, p_person: f.person_id || null, p_notes: f.notes || null, p_rush: !!f.rush,
  p_contact_method: f.contact_method || 'email', p_contact_value: f.contact_value || null, p_docs_status: f.docs_status || 'not_sure',
}));
export const cancelHelpRequest = async (id) => ok(await sb.from('assistance_requests').update({ status: 'cancelled' }).eq('id', id));
export const orderRefunds = async (reqId) =>
  ok(await sb.from('order_refunds').select('id, amount_php, kind, reason, method, reference, created_at').eq('request_id', reqId).order('created_at'));
export const staffAccessLog = async (orgId) =>
  ok(await sb.from('staff_file_access').select('id, staff_name, file_name, reason, created_at').eq('org_id', orgId).order('created_at', { ascending: false }).limit(200));
export const getRequest = async (id) => ok(await sb.from('assistance_requests').select('*').eq('id', id).maybeSingle());
export const orderEvents = async (reqId) =>
  ok(await sb.from('request_events').select('*').eq('request_id', reqId).order('id'));
export const acceptQuote = async (reqId) => ok(await sb.rpc('accept_quote', { p_req: reqId }));

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
export const listPartners = async () => ok(await sb.rpc('list_partners'));
export const requestReferral = async (f) => ok(await sb.rpc('request_referral', {
  p_org: f.org_id, p_partner: f.partner_id, p_requirement: f.requirement_id || null, p_note: f.note || null,
  p_contact_method: f.contact_method || 'email', p_contact_value: f.contact_value || null,
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
export async function history(orgId, { before = null, entity = null, limit = 50 } = {}) {
  let q = sb.from('audit_log').select('id, entity, entity_id, action, summary, actor_id, business_id, vehicle_id, requirement_id, created_at')
    .eq('org_id', orgId).order('id', { ascending: false }).limit(limit);
  if (before) q = q.lt('id', before);
  if (entity) q = q.eq('entity', entity);
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
export const adminSetPlan = async (orgId, plan, expires) => ok(await sb.rpc('admin_set_plan', { p_org: orgId, p_plan: plan, p_expires: expires }));
export const adminRequests = async () =>
  ok(await sb.from('assistance_requests').select('*, orgs(name)').order('created_at', { ascending: false }).limit(300));
export const adminOutbox = async () =>
  ok(await sb.from('message_outbox').select('id, channel, to_address, subject, status, attempts, last_error, created_at, sent_at')
    .order('id', { ascending: false }).limit(100));
export const adminRequestDocs = async (reqId) =>
  ok(await sb.from('documents').select('id, file_name, storage_path, created_at').eq('requirement_id', reqId).is('deleted_at', null));
export const adminQuote = async (reqId, fee, gov, note) => ok(await sb.rpc('admin_quote_request', { p_req: reqId, p_service_fee: fee, p_gov_fees: gov, p_note: note || null }));
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
