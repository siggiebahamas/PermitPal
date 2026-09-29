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
  data: null,      // { types, businesses, locations, vehicles, reqs, requests, members }
  unread: 0,
};

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
export const location_ = (id) => S.data?.locations.find((l) => l.id === id);
export const reqById = (id) => S.data?.reqs.find((r) => r.id === id);
export const typeOf = (code) => S.data?.types.find((t) => t.code === code);
export const locationsOf = (bizId) => S.data.locations.filter((l) => l.business_id === bizId);
export const reqsOf = (subject, id) =>
  S.data.reqs.filter((r) => (subject === 'business' ? r.business_id === id : r.vehicle_id === id));
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
export const VEHICLE_TYPES = ['Sedan', 'SUV', 'Van', 'Pickup', 'Truck', 'Motorcycle', 'Tricycle', 'Bus', 'Other'];
export const ROLES = {
  owner: 'Owner — everything, including billing',
  admin: 'Admin — everything except billing',
  member: 'Member — add and update records',
  viewer: 'Viewer — can look, cannot change',
};

// Plain-language names for a few table names shown in History / Trash.
export const ENTITY_LABELS = {
  businesses: 'Business', business_locations: 'Branch', vehicles: 'Vehicle', requirements: 'Requirement',
  requirement_cycles: 'Record', documents: 'Document', assistance_requests: 'Help request', org_members: 'Team', orgs: 'Workspace',
};

export const empty = (title, text, action = '') => html`
  <div class="empty"><div class="empty-title">${title}</div><p>${text}</p>${action}</div>`;
