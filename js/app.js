// Boot, sign-in state, the page shell (sidebar, which is a slide-in menu on phones) and the router.
import { html, toast, toastError, fmtDate, closeModal, friendlyError } from './util.js';
import { S, actions, hooks, on, isStaff, has, IN_PERSON } from './core.js';
import { ICON } from './components.js';
import { initErrorReporting, reportError } from './errors.js';
import * as db from 'pp/data';
import { authPage, invitePage, onboarding, sessionStorageTake, sessionStorageSet } from './views/auth.js';
import { dashboard, compliance, documents } from './views/overview.js';
import { businessList, businessDetail, vehicleList, vehicleDetail, personList, personDetail } from './views/entities.js';
import { render as requirementPage, forget as forgetRequirement } from './views/requirement.js';
import { network, connectPage, KINDS } from './views/network.js';
import { contactPage } from './views/contact.js';
import { partners, costs, shares } from './views/extras.js';
import './views/import.js';
import { landing, pricingPage } from './views/landing.js';
import { historyPage, trashPage, team, settings } from './views/account.js';
import { notifications } from './views/notifications.js';
import { admin } from './views/admin.js';
import { services, order } from './views/services.js';
import { care, careStart } from './views/care.js';
import { partnerApplyPage } from './views/partner-apply.js';
import { leadPage } from './views/lead.js';
import { filings, forgetFilings } from './views/filings.js';
import { mfaChallenge, mfaRequired } from './views/mfa.js';
import { checkPage } from './views/check.js';
import { templatesPage } from './views/templates.js';
import { loadPage } from './views/load.js';
import { workerPage } from './views/worker.js';
import { applyBrand, sideBrand, poweredBy, connectBrand } from './views/brand.js';
import { loadCityDates } from './views/citydates.js';

// Never run inside another website's frame (a trick to make people click hidden buttons). GitHub Pages
// cannot send the header that blocks this, so the page checks for itself; our own frames are fine.
try { if (window.top !== window.self && window.top.location.origin !== location.origin) throw new Error(); }
catch { document.documentElement.innerHTML = ''; throw new Error('Pinoy Permit cannot be shown inside another website.'); }

const app = document.getElementById('app');
let recovery = false;
let mfaSkipped = false; // "Not now" on the two-step login set-up screen, for this visit
let lastLoad = 0;
let unsubscribe = null;

const T = {
  en: { dashboard: 'Dashboard', businesses: 'Businesses', vehicles: 'Vehicles', people: 'People', compliance: 'Compliance', documents: 'Documents',
        filings: 'Taxes & contributions', pros: 'Find a professional', services: 'Done for you', care: 'Year-round care', team_tools: 'Team tools', costs: 'Costs & budget', sharing: 'Share proof',
        check: 'Permit check', templates: 'Templates', load: 'Load',
        notifications: 'Notifications', history: 'History', trash: 'Trash', team: 'Team', settings: 'Settings', admin: 'Admin', signout: 'Sign out', more: 'More', contact: 'Contact Pinoy Permit', tools: 'Tools', account: 'Account' },
  tl: { dashboard: 'Dashboard', businesses: 'Mga Negosyo', vehicles: 'Mga Sasakyan', people: 'Mga Tao', compliance: 'Compliance', documents: 'Mga Dokumento',
        filings: 'Buwis at kontribusyon', pros: 'Maghanap ng Propesyonal', services: 'Ipaasikaso sa amin', care: 'Alaga buong taon', team_tools: 'Team tools', costs: 'Gastos', sharing: 'Ibahagi ang Patunay',
        check: 'Pagsusuri ng permit', templates: 'Mga template', load: 'Load',
        notifications: 'Mga Abiso', history: 'Kasaysayan', trash: 'Basurahan', team: 'Team', settings: 'Mga Setting', admin: 'Admin', signout: 'Mag-sign out', more: 'Iba pa', contact: 'Kontakin ang Pinoy Permit', tools: 'Mga Tool', account: 'Account' },
};
const t = (k) => (T[S.profile?.lang] || T.en)[k] || T.en[k] || k;

function route() {
  const [path, query] = location.hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  return { parts, params: new URLSearchParams(query || '') };
}

// ---------------------------------------------------------------- start / sign-in state
// Newer features switch on only when the database has them (see app_features in the migrations).
let featuresLoaded = null;
const loadFeatures = () => (featuresLoaded ||= db.features().catch(() => ({})).then((f) => { S.features = f || {}; }));

async function start() {
  await loadFeatures();
  const session = await db.auth.session().catch(() => null);
  S.session = session;
  S.user = session?.user || null;
  const { parts } = route();

  if (!S.user) {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (parts[0] === 'invite' && parts[1]) return invitePage(app, parts[1], false);
    // Invited to connect (franchisor, accountant, mall): remember it through sign-up / log-in.
    if (parts[0] === 'connect' && parts[1]) {
      sessionStorageSet('pp-connect', parts[1]);
      authPage(app, 'signup', { connect: true });
      if (has('brand')) connectBrand(parts[1]);
      return;
    }
    const kindParam = new URLSearchParams(location.hash.split('?')[1] || '').get('type');
    if (kindParam && KINDS[kindParam]) sessionStorageSet('pp-kind', kindParam);
    // Invited by another business (#/signup?ref=CODE): remembered through sign-up, claimed once the workspace exists.
    const refParam = new URLSearchParams(location.hash.split('?')[1] || '').get('ref');
    if (refParam && /^[A-Za-z0-9]{8}$/.test(refParam)) sessionStorageSet('pp-ref', refParam.toUpperCase());
    if (!parts[0] || parts[0] === 'welcome') return landing(app);
    if (parts[0] === 'pricing') return pricingPage(app);
    if (parts[0] === 'contact') return contactPage(app, { signedIn: false });
    if (parts[0] === 'list-your-firm' && has('revenue')) return partnerApplyPage(app, { signedIn: false });
    if (parts[0] === 'lead' && has('leads')) return leadPage(app, parts[1], { signedIn: false });
    if (parts[0] === 'w' && has('plus')) return workerPage(app, parts[1], { signedIn: false });
    const mode = ['signup', 'forgot'].includes(parts[0]) ? parts[0] : 'login';
    return authPage(app, mode);
  }
  if (recovery || parts[0] === 'reset') return authPage(app, 'reset');
  // Two-step login: a password alone isn't enough once it's on.
  if (has('mfa')) {
    const a = await db.mfa.aal().catch(() => null);
    if (a?.nextLevel === 'aal2' && a.currentLevel !== 'aal2') return mfaChallenge(app, start);
  }

  try {
    // Accept a pending invitation (from the link, or remembered through sign-up).
    const token = parts[0] === 'invite' ? parts[1] : sessionStorageTake('pp-invite');
    if (token) {
      try { await db.acceptInvite(token); toast('You joined the team.'); } catch (e) { toastError(e); }
      history.replaceState(null, '', '#/');
    }
    Object.assign(S, await db.loadMe(S.user.id));
    // A workspace that requires two-step login stays closed until it's set up (it can't be bypassed: the database enforces it).
    if (has('mfa') && !mfaSkipped) {
      const locked = await db.lockedOrgs().catch(() => []);
      if (locked.length) return mfaRequired(app, locked, { onDone: start, onSkip: S.orgs.length ? () => { mfaSkipped = true; start(); } : null });
    }
    if (!S.orgs.length) return onboarding(app, S.profile, start);
    S.org = S.orgs.find((o) => o.id === S.profile.current_org_id) || S.orgs[0];
    if (S.org.id !== S.profile.current_org_id) db.setCurrentOrg(S.user.id, S.org.id).catch(() => {});
    // Signed up from a team plan on the landing page: set the workspace type (starts the trial).
    const kind = sessionStorageTake('pp-kind');
    if (kind && KINDS[kind] && S.org.kind === 'business' && S.org.role === 'owner') {
      try { await db.setOrgProfile(S.org.id, { kind }); Object.assign(S, await db.loadMe(S.user.id)); S.org = S.orgs.find((o) => o.id === S.org.id) || S.orgs[0]; } catch { /* stays a business */ }
    }
    // Joined with another business's invitation link: say so (it only counts for a new workspace's owner).
    const ref = sessionStorageTake('pp-ref');
    if (ref && has('load') && S.org.role === 'owner') {
      db.claimInvite(S.org.id, ref).then((yes) => { if (yes) toast('Welcome! Add 3 permits with their dates and you and the business that invited you both get a month of Pinoy Permit Plus.'); }).catch(() => {});
    }
    const connect = parts[0] === 'connect' ? null : sessionStorageTake('pp-connect');
    if (connect) history.replaceState(null, '', '#/connect/' + connect);
    await loadData();
    S.unread = await db.unreadCount().catch(() => 0);
    if (!unsubscribe) unsubscribe = db.onNewNotification(S.user.id, (n) => { S.unread++; paintBadges(); toast(n.title, 'info'); });
    renderShell();
  } catch (e) {
    reportError(e); // a lost connection is ignored by the reporter; anything else is a bug worth knowing about
    app.innerHTML = String(html`<main class="auth"><div class="auth-card"><h1 class="auth-title">Couldn't load Pinoy Permit</h1><p class="tagline">${friendlyError(e)}</p>
      <button class="btn btn-primary btn-block" data-act="reload">Try again</button>
      <button class="btn btn-ghost btn-block" data-act="sign-out">Sign out</button></div></main>`);
  }
}

async function loadData() {
  [S.data] = await Promise.all([db.loadOrgData(S.org.id, { revenue: has('revenue'), plus: has('plus') }), loadCityDates()]);
  // A client of an accounting firm with White-label sees the firm's logo and color (Powered by Pinoy Permit).
  const prev = JSON.stringify(S.brand);
  S.brand = has('brand') && S.org.kind === 'business' ? await db.clientBrand(S.org.id).catch(() => null) : null;
  applyBrand(S.brand);
  if (prev !== JSON.stringify(S.brand) && document.querySelector('.shell')) paintBrand();
  lastLoad = Date.now();
}

hooks.reload = async () => {
  try {
    const me = await db.loadMe(S.user.id);
    const prevKind = S.org?.kind;
    Object.assign(S, { profile: me.profile, orgs: me.orgs, plans: me.plans, prefs: me.prefs });
    forgetFilings(); // businesses may have changed (added, renamed, deleted)
    S.org = S.orgs.find((o) => o.id === S.org.id) || S.orgs[0];
    await loadData();
    // Workspace type changed: the menu changes too.
    if (prevKind !== S.org.kind) { forgetRequirement(); renderShell(); return; }
  } catch (e) { toastError(e); }
  forgetRequirement();
  renderPage();
};
hooks.render = () => renderPage();

// ---------------------------------------------------------------- shell
const BASE_NAV = [
  ['', 'dashboard', ICON.home], ['businesses', 'businesses', ICON.building], ['vehicles', 'vehicles', ICON.car],
  ['compliance', 'compliance', ICON.list], ['people', 'people', ICON.person], ['documents', 'documents', ICON.file],
];
// Team workspaces (head office, firm, property, fleet) get their board right after the dashboard.
let NAV = BASE_NAV;
let MORE = [];
let TOOLS = [];
let ACCOUNT = [];
function buildNav() {
  const k = KINDS[S.org?.kind || 'business'];
  const base = has('filings') ? [...BASE_NAV.slice(0, 4), ['filings', 'filings', ICON.calendar], ...BASE_NAV.slice(4)] : BASE_NAV;
  NAV = k?.nav ? [base[0], ['network', k.nav, k.icon], ...base.slice(1)] : base;
  // Below Notifications the menu has two color-coded groups: Tools (pine) and Account (navy).
  TOOLS = [...(has('plus') ? [['check', 'check']] : []), ...(has('services') ? [['services', 'services']] : []), ...(has('revenue') && IN_PERSON ? [['care', 'care']] : []), ['pros', 'pros'], ['costs', 'costs'], ['sharing', 'sharing'],
    ...(has('plus') || has('load') ? [['templates', 'templates']] : []), ...(k?.nav ? [] : [['network', 'team_tools']])];
  ACCOUNT = [['history', 'history'], ['trash', 'trash'], ['team', 'team'], ...(has('load') ? [['load', 'load']] : []), ['settings', 'settings'], ['contact', 'contact']];
  MORE = [['notifications', 'notifications'], ...TOOLS, ...ACCOUNT];
}

function renderShell() {
  buildNav();
  const name = [S.profile.first_name, S.profile.last_name].filter(Boolean).join(' ') || S.profile.email;
  app.innerHTML = String(html`
    <div class="shell">
      <button class="skip-link" data-act="skip-main">Skip to content</button>
      <aside class="sidebar" id="side-menu" aria-label="Menu">
        <div class="side-top"><span data-brand-slot="side">${S.brand ? sideBrand(S.brand) : ppBrand()}</span>
          <button class="icon-btn menu-close" data-act="menu-close" aria-label="Close menu">${ICON.close}</button></div>
        <span data-brand-slot="powered">${S.brand ? poweredBy() : ''}</span>
        ${S.orgs.length > 1 ? html`<select class="org-switch" id="org-switch">${S.orgs.map((o) => html`<option value="${o.id}" ${o.id === S.org.id ? 'selected' : ''}>${o.name}</option>`)}</select>`
          : html`<div class="org-name">${S.org.name}</div>`}
        <nav aria-label="Main">${NAV.map(([p, k, ic]) => html`<a class="nav" href="#/${p}" data-nav="${p}">${ic}<span>${t(k)}</span></a>`)}</nav>
        <nav class="nav-secondary" aria-label="Notifications, tools and account">
          <a class="nav" href="#/notifications" data-nav="notifications">${ICON.bell}<span>${t('notifications')}</span><b class="badge" data-badge></b></a>
          <div class="nav-group tools">${t('tools')}</div>
          ${TOOLS.map(([p, k]) => html`<a class="nav small" href="#/${p}" data-nav="${p}"><span>${t(k)}</span></a>`)}
          <div class="nav-group account">${t('account')}</div>
          ${ACCOUNT.map(([p, k]) => html`<a class="nav small" href="#/${p}" data-nav="${p}"><span>${t(k)}</span></a>`)}
          ${isStaff() ? html`<a class="nav small" href="#/admin" data-nav="admin"><span>${t('admin')}</span></a>` : ''}
        </nav>
        <div class="me"><div class="me-name">${name}</div><div class="muted small">${S.org.role}</div>
          <button class="linklike small" data-act="sign-out">${t('signout')}</button></div>
      </aside>
      <div class="menu-backdrop" data-act="menu-close"></div>
      <div class="main-col">
        <header class="topbar">
          <button class="icon-btn menu-btn" data-act="menu-open" aria-label="Open menu" aria-controls="side-menu" aria-expanded="false">${ICON.menu}</button>
          <span class="mobile-only" data-brand-slot="top">${S.brand ? sideBrand(S.brand) : ppBrand()}</span>
          <div class="spacer"></div>
          <button class="icon-btn bell" data-act="bell-open" aria-label="Notifications" aria-haspopup="dialog">${ICON.bell}<b class="badge" data-badge></b></button>
        </header>
        <div id="banner"></div>
        <main id="main" tabindex="-1"></main>
      </div>
    </div>`);
  document.getElementById('org-switch')?.addEventListener('change', async (e) => {
    try { await db.setCurrentOrg(S.user.id, e.target.value); location.hash = '#/'; location.reload(); } catch (err) { toastError(err); }
  });
  renderPage();
}

const ppBrand = () => html`<a class="brand" href="#/"><img src="img/logo.png" alt=""><span class="wordmark"><span class="w1">Pinoy</span> <span class="w2">Permit</span></span></a>`;
// The firm's look switched on or off while the app was open (it comes and goes with the add-on).
function paintBrand() {
  const set = (slot, v) => { const el = document.querySelector(`[data-brand-slot="${slot}"]`); if (el) el.innerHTML = String(v); };
  set('side', S.brand ? sideBrand(S.brand) : ppBrand());
  set('top', S.brand ? sideBrand(S.brand) : ppBrand());
  set('powered', S.brand ? poweredBy() : '');
}

hooks.paintBadges = () => paintBadges();
function paintBadges() {
  document.querySelectorAll('[data-badge]').forEach((b) => { b.textContent = S.unread > 99 ? '99+' : S.unread || ''; b.hidden = !S.unread; });
}

function banner() {
  const el = document.getElementById('banner');
  if (!el) return;
  const o = S.org;
  el.innerHTML = String(o.deleted_at
    ? html`<div class="banner danger"><div>This workspace is scheduled for permanent deletion on ${fmtDate(o.purge_after.slice(0, 10))}.</div><a class="btn btn-sm btn-ghost" href="#/settings/workspace">Review</a></div>`
    : '');
}

// ---------------------------------------------------------------- router
async function renderPage() {
  const main = document.getElementById('main');
  if (!main || !S.data) return;
  const { parts, params } = route();
  const [a, b] = parts;
  const navKey = a === 'services' && has('services') ? 'services' : ['partners', 'services', 'help'].includes(a) ? 'pros' : a || '';
  document.querySelectorAll('[data-nav]').forEach((n) => n.classList.toggle('active', (n.dataset.nav || '') === navKey));
  paintBadges();
  banner();
  try {
    if (!a) dashboard(main);
    else if (a === 'businesses') b ? businessDetail(main, b) : businessList(main, params);
    else if (a === 'vehicles') b ? vehicleDetail(main, b) : vehicleList(main, params);
    else if (a === 'people') b ? personDetail(main, b) : personList(main, params);
    else if (a === 'requirement') await requirementPage(main, b);
    else if (a === 'compliance') compliance(main, params);
    else if (a === 'filings' && has('filings')) await filings(main);
    else if (a === 'documents') await documents(main);
    else if (a === 'network') await network(main);
    else if (a === 'connect') await connectPage(main, b);
    else if (a === 'services' && has('services')) b === 'orders' && parts[2] ? await order(main, parts[2]) : services(main, params);
    else if (a === 'care' && has('revenue') && IN_PERSON) b === 'start' ? careStart(main, params) : await care(main, params);
    else if (a === 'care') { location.hash = '#/services'; return; }
    else if (a === 'pricing') { location.hash = '#/settings/billing'; return; } // the website's prices page; signed in, prices live under Settings
    else if (a === 'list-your-firm' && has('revenue')) partnerApplyPage(main, { signedIn: true });
    else if (a === 'lead' && has('leads')) await leadPage(main, b, { signedIn: true });
    else if (a === 'w' && has('plus')) await workerPage(main, b, { signedIn: true });
    else if (a === 'check' && has('plus')) await checkPage(main);
    else if (a === 'templates' && (has('plus') || has('load'))) await templatesPage(main);
    else if (a === 'load' && has('load')) await loadPage(main);
    else if (['pros', 'partners', 'services', 'help'].includes(a)) await partners(main, params);
    else if (a === 'contact') contactPage(main, { signedIn: true });
    else if (a === 'costs') await costs(main);
    else if (a === 'sharing') await shares(main);
    else if (a === 'notifications') await notifications(main);
    else if (a === 'history') await historyPage(main);
    else if (a === 'trash') await trashPage(main);
    else if (a === 'team') await team(main);
    else if (a === 'settings') await settings(main, b);
    else if (a === 'admin') await admin(main);
    else dashboard(main);
  } catch (e) {
    console.error(e);
    reportError(e); // Pinoy Permit staff see this in Admin > Errors
    main.innerHTML = String(html`<div class="empty"><div class="empty-title">Something went wrong on this page</div>
      <p>${friendlyError(e)}</p><p class="muted small">We've been told about it automatically. Try again, or go back to the dashboard.</p>
      <div class="btn-row"><button class="btn btn-primary" data-act="reload">Try again</button><a class="btn btn-ghost" href="#/">Dashboard</a></div></div>`);
  }
}

let lastPath = '';
window.addEventListener('hashchange', () => {
  setMenu(false);
  closeModal();
  const { parts } = route();
  if (!S.user || !S.data || ['login', 'signup', 'forgot', 'invite', 'reset', 'welcome'].includes(parts[0])) return start();
  const path = location.hash.split('?')[0];
  if (path !== lastPath) window.scrollTo(0, 0);
  lastPath = path;
  renderPage();
});

// ---------------------------------------------------------------- clicks
document.addEventListener('click', (e) => {
  const actEl = e.target.closest('[data-act]');
  if (actEl && actions[actEl.dataset.act]) {
    if (actEl.tagName !== 'A' || actEl.dataset.act !== 'notif-open') e.preventDefault();
    e.stopPropagation();
    actions[actEl.dataset.act](actEl.dataset, actEl, e);
    return;
  }
  const row = e.target.closest('[data-href]');
  if (row && !e.target.closest('a,button,input,select,label,textarea')) location.hash = row.dataset.href;
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches?.('[data-href]')) location.hash = e.target.dataset.href;
});

on('reload', () => location.reload());
on('sign-out', async () => { await db.auth.signOut(); S.data = null; location.hash = '#/login'; start(); });
// Phones: the side menu is a drawer, closed by default so the page gets the whole screen.
function setMenu(open) {
  const shell = document.querySelector('.shell');
  if (!shell) return;
  shell.classList.toggle('menu-open', open);
  document.body.classList.toggle('menu-lock', open);
  document.querySelector('[data-act=menu-open]')?.setAttribute('aria-expanded', String(open));
  if (open) setTimeout(() => document.querySelector('.sidebar .nav.active, .sidebar .nav')?.focus({ preventScroll: true }), 60);
}
on('menu-open', () => setMenu(true));
on('skip-main', () => document.getElementById('main')?.focus());
on('menu-close', () => setMenu(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.querySelector('.shell.menu-open')) setMenu(false); });
// Tapping any link in the menu closes it, including the page you are already on.
document.addEventListener('click', (e) => { if (e.target.closest('.sidebar a')) setMenu(false); }, true);
matchMedia('(min-width: 900px)').addEventListener?.('change', (m) => { if (m.matches) setMenu(false); });

// Keep data fresh when people come back to the tab (another teammate may have changed things).
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && S.data && Date.now() - lastLoad > 60000) {
    await loadData().catch(() => {});
    S.unread = await db.unreadCount().catch(() => S.unread);
    if (!document.querySelector('.modal')) renderPage();
  }
});

db.auth.onChange((event) => {
  if (event === 'PASSWORD_RECOVERY') { recovery = true; location.hash = '#/reset'; start(); }
  else if (event === 'SIGNED_IN' && !S.data) start();
  else if (event === 'SIGNED_OUT') { S.data = null; start(); }
});
window.addEventListener('pp-password-updated', () => { recovery = false; });

// Errors in people's browsers are reported to Pinoy Permit staff (scrubbed of personal details).
initErrorReporting((r) => (S.features?.errors ? db.logClientError(r) : Promise.resolve()), () => ({ orgId: S.org?.id }));
start();
