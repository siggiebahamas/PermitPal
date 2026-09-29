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
export async function loadOrgData(orgId) {
  if (!typesCache) typesCache = ok(await sb.from('requirement_types').select('*').order('sort'));
  const [businesses, locations, vehicles, reqs, requests, members] = await Promise.all([
    sb.from('businesses').select('*').eq('org_id', orgId).is('deleted_at', null).order('name').then(ok),
    sb.from('business_locations').select('*').eq('org_id', orgId).is('deleted_at', null).order('is_main', { ascending: false }).order('name').then(ok),
    sb.from('vehicles').select('*').eq('org_id', orgId).is('deleted_at', null).order('make_model').then(ok),
    sb.from('requirement_status').select('*').eq('org_id', orgId).then(ok),
    sb.from('assistance_requests').select('*').eq('org_id', orgId).order('created_at', { ascending: false }).then(ok),
    sb.from('org_members').select('user_id, role, created_at').eq('org_id', orgId).then(ok),
  ]);
  // org_members points at auth.users, so fetch teammates' profiles separately.
  const profiles = members.length
    ? ok(await sb.from('profiles').select('id, first_name, last_name, email, avatar_path, role_title').in('id', members.map((m) => m.user_id)))
    : [];
  for (const m of members) m.profile = profiles.find((p) => p.id === m.user_id) || {};
  return { types: typesCache, businesses, locations, vehicles, reqs, requests, members };
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
export async function saveCycle({ cycleId, orgId, requirementId, reference_no, issuer, issued_on, expires_on }) {
  const row = {
    reference_no: reference_no || null, issuer: issuer || null,
    issued_on: issued_on || null, expires_on: expires_on || null,
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
  const path = `${orgId}/${requirementId}/${crypto.randomUUID()}-${safe}`;
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
  ok(await sb.from('requirement_cycles').select('requirement_id, reference_no, issuer, issued_on, expires_on, seq, created_at')
    .eq('org_id', orgId).is('deleted_at', null).order('seq'));

// ---------------------------------------------------------------- help requests
export const createHelpRequest = async (f) => ok(await sb.from('assistance_requests').insert({
  org_id: f.org_id, requirement_id: f.requirement_id, docs_status: f.docs_status, contact_method: f.contact_method,
  contact_value: f.contact_value || null, notes: f.notes || null,
  requirement_name: '-', subject_label: '-', // filled in by the database from the requirement
}).select('*').single());
export const cancelHelpRequest = async (id) => ok(await sb.from('assistance_requests').update({ status: 'cancelled' }).eq('id', id));

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
  const [businesses, locations, vehicles, requirements, cycles, documents] = await Promise.all([
    q('businesses', 'id, name, deleted_at'),
    q('business_locations', 'id, name, business_id, deleted_at'),
    q('vehicles', 'id, make_model, plate_no, deleted_at'),
    q('requirements', 'id, name, business_id, vehicle_id, deleted_at'),
    q('requirement_cycles', 'id, requirement_id, reference_no, expires_on, deleted_at'),
    q('documents', 'id, file_name, requirement_id, deleted_at'),
  ]);
  return { businesses, locations, vehicles, requirements, cycles, documents };
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
  ok(await sb.from('assistance_requests').select('*, orgs(name)').order('created_at', { ascending: false }).limit(200));
export const adminUpdateRequest = async (id, patch) => ok(await sb.from('assistance_requests').update(patch).eq('id', id));
export const adminOutbox = async () =>
  ok(await sb.from('message_outbox').select('id, channel, to_address, subject, status, attempts, last_error, created_at, sent_at')
    .order('id', { ascending: false }).limit(100));
export const adminRequestDocs = async (reqId) =>
  ok(await sb.from('documents').select('id, file_name, storage_path, created_at').eq('requirement_id', reqId).is('deleted_at', null));
