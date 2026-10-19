// App-wide state, the click-action registry, and small lookups shared by every view.
import { html } from './util.js';

export const S = {
  session: null,
  user: null,
  profile: null,
  prefs: null,
  orgs: [],
  org: null,       // current workspace (includes .role)
  plans: [],
  data: null,      // { types, services, businesses, locations, vehicles, people, reqs, requests, members }
  unread: 0,
  features: {},   // newer features this database supports: { errors, assign, filings, ... }
};
// Is a newer feature switched on for this database?
export const has = (name) => !!S.features?.[name];

// Views register handlers for data-act="name" buttons/links; app.js dispatches clicks.
export const actions = {};
export const on = (name, fn) => { actions[name] = fn; };

// Set by app.js: re-render the current page, or reload workspace data then re-render.
export const hooks = { render: () => {}, reload: async () => {} };
export const rerender = () => hooks.render();
export const reload = () => hooks.reload();
export const go = (hash) => { if (location.hash === hash) hooks.render(); else location.hash = hash; };

// ---------------------------------------------------------------- permissions & plan
export const role = () => S.org?.role;
export const canEdit = () => ['owner', 'admin', 'member'].includes(role());
export const isOrgAdmin = () => ['owner', 'admin'].includes(role());
export const isOwner = () => role() === 'owner';
export const isStaff = () => !!S.profile?.is_platform_admin;
export function effectivePlan() {
  const o = S.org;
  if (!o) return null;
  const lapsed = o.plan_expires_at && new Date(o.plan_expires_at) < new Date();
  return S.plans.find((p) => p.id === (lapsed ? 'free' : o.plan_id)) || S.plans[0];
}

// ---------------------------------------------------------------- lookups
export const business = (id) => S.data?.businesses.find((b) => b.id === id);
export const vehicle = (id) => S.data?.vehicles.find((v) => v.id === id);
export const person = (id) => S.data?.people?.find((p) => p.id === id);
export const location_ = (id) => S.data?.locations.find((l) => l.id === id);
export const reqById = (id) => S.data?.reqs.find((r) => r.id === id);
export const typeOf = (code) => S.data?.types.find((t) => t.code === code);
export const locationsOf = (bizId) => S.data.locations.filter((l) => l.business_id === bizId);
export const reqsOf = (subject, id) =>
  S.data.reqs.filter((r) => (subject === 'business' ? r.business_id === id : subject === 'person' ? r.person_id === id : r.vehicle_id === id));
export const service = (code) => S.data?.services?.find((x) => x.code === code);
// PermitPal only sells work it can do online for now: no lining up at city hall or the LTO, no
// inspections or visits (local rules and fees vary too much to quote them well). Those services,
// Year-round care, rush fees on them and "renew several" stay in the code: set IN_PERSON to bring
// them back. The tests switch it on to keep checking them.
export const IN_PERSON = !!globalThis.PP_IN_PERSON;
const ONLINE_SERVICES = new Set(['setup_from_paper', 'renew_dti_business_name', 'renew_philgeps', 'adv_philgeps', 'apply_dole_registration']);
export const offered = (s) => !!s && (IN_PERSON || ONLINE_SERVICES.has(s.code));
// The done-for-you service that handles a given permit type, if we offer one.
export const serviceFor = (r) => {
  const s = S.data?.services?.find((x) => x.category === 'renewal' && x.type_codes.includes(r.type_code))
    || (r.subject !== 'person' ? S.data?.services?.find((x) => x.code === 'renew_other') : null);
  return offered(s) ? s : null;
};
// Year-round care: the plan (not cancelled) on a branch or vehicle, and the plan covering a permit.
export const careOf = () => S.data?.care || { plans: [], invoices: [], coverage: [], claims: [], tiers: [], staff: [] };
export const planFor = (kind, id) => careOf().plans.find((p) => p.status !== 'cancelled' && (kind === 'location' ? p.location_id === id : p.vehicle_id === id));
export const coverOf = (r) => {
  const c = careOf().coverage.find((x) => x.requirement_id === r.id && x.status !== 'cancelled');
  return c ? careOf().plans.find((p) => p.id === c.plan_id) || null : null;
};
export const tierOf = (code) => careOf().tiers.find((t) => t.code === code);
export const subjectHref = (r) => (r.subject === 'business' ? `#/businesses/${r.business_id}` : r.subject === 'person' ? `#/people/${r.person_id}` : `#/vehicles/${r.vehicle_id}`);
export function memberName(userId) {
  if (!userId) return 'PermitPal';
  if (userId === S.user?.id) return 'You';
  const m = S.data?.members.find((x) => x.user_id === userId);
  const p = m?.profile;
  if (!p) return 'PermitPal team';
  return [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email || 'Team member';
}

export const ACTIVITIES = {
  restaurant: 'Restaurant / food', retail: 'Retail / store', professional_services: 'Professional services',
  manufacturing: 'Manufacturing', construction: 'Construction', healthcare: 'Healthcare / clinic',
  school: 'School / training', logistics: 'Logistics / delivery', other: 'Other',
};
export const STRUCTURES = ['Sole Proprietorship', 'Partnership', 'Corporation', 'Cooperative', 'Other'];
// How the permit library is grouped when people browse it.
export const CATEGORY_NAMES = {
  local: 'City and barangay', national: 'National registrations', safety: 'Safety and health', employer: 'Employer registrations',
  industry: 'Industry licences', registration: 'Registration and insurance', for_hire: 'For-hire vehicles',
  licence: 'IDs and licences', clearance: 'Clearances and health', other: 'Other',
};
export const VEHICLE_TYPES = ['Sedan', 'SUV', 'Van', 'Pickup', 'Truck', 'Motorcycle', 'Tricycle', 'Bus', 'Other'];
export const ROLES = {
  owner: 'Owner — everything, including billing',
  admin: 'Admin — everything except billing',
  member: 'Member — add and update records',
  viewer: 'Viewer — can look, cannot change',
};

// Plain-language names for a few table names shown in History / Trash.
export const ENTITY_LABELS = {
  businesses: 'Business', business_locations: 'Branch', vehicles: 'Vehicle', people: 'Person', requirements: 'Permit',
  requirement_cycles: 'Record', documents: 'Document', assistance_requests: 'Service request', org_members: 'Team', orgs: 'Workspace',
};

export const empty = (title, text, action = '') => html`
  <div class="empty"><div class="empty-title">${title}</div><p>${text}</p>${action}</div>`;
