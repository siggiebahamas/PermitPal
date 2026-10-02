// Boot, sign-in state, the page shell (sidebar + mobile tab bar) and the router.
import { html, toast, toastError, fmtDate } from './util.js';
import { S, actions, hooks, on, isStaff } from './core.js';
import { ICON } from './components.js';
import * as db from 'pp/data';
import { authPage, invitePage, onboarding, sessionStorageTake } from './views/auth.js';
import { dashboard, compliance, documents } from './views/overview.js';
import { businessList, businessDetail, vehicleList, vehicleDetail, personList, personDetail } from './views/entities.js';
import { render as requirementPage, forget as forgetRequirement } from './views/requirement.js';
import { services, order } from './views/services.js';
import { partners, costs, shares } from './views/extras.js';
import './views/import.js';
import { landing } from './views/landing.js';
import { notifications, historyPage, trashPage, team, settings } from './views/account.js';
import { admin } from './views/admin.js';

const app = document.getElementById('app');
let recovery = false;
let lastLoad = 0;
let unsubscribe = null;

const T = {
  en: { dashboard: 'Dashboard', businesses: 'Businesses', vehicles: 'Vehicles', people: 'People', compliance: 'Compliance', documents: 'Documents',
        services: 'Services', partners: 'Partners', costs: 'Costs & budget', sharing: 'Share proof',
        notifications: 'Notifications', history: 'History', trash: 'Trash', team: 'Team', settings: 'Settings', admin: 'Admin', signout: 'Sign out', more: 'More' },
  tl: { dashboard: 'Dashboard', businesses: 'Mga Negosyo', vehicles: 'Mga Sasakyan', people: 'Mga Tao', compliance: 'Compliance', documents: 'Mga Dokumento',
        services: 'Mga Serbisyo', partners: 'Mga Partner', costs: 'Gastos', sharing: 'Ibahagi ang Patunay',
        notifications: 'Mga Abiso', history: 'Kasaysayan', trash: 'Basurahan', team: 'Team', settings: 'Mga Setting', admin: 'Admin', signout: 'Mag-sign out', more: 'Iba pa' },
};
const t = (k) => (T[S.profile?.lang] || T.en)[k] || T.en[k];

function route() {
  const [path, query] = location.hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  return { parts, params: new URLSearchParams(query || '') };
}

// ---------------------------------------------------------------- start / sign-in state
async function start() {
  const session = await db.auth.session().catch(() => null);
  S.session = session;
  S.user = session?.user || null;
  const { parts } = route();

  if (!S.user) {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (parts[0] === 'invite' && parts[1]) return invitePage(app, parts[1], false);
    if (!parts[0] || parts[0] === 'welcome') return landing(app);
    const mode = ['signup', 'forgot'].includes(parts[0]) ? parts[0] : 'login';
    return authPage(app, mode);
  }
  if (recovery || parts[0] === 'reset') return authPage(app, 'reset');

  try {
    // Accept a pending invitation (from the link, or remembered through sign-up).
    const token = parts[0] === 'invite' ? parts[1] : sessionStorageTake('pp-invite');
    if (token) {
      try { await db.acceptInvite(token); toast('You joined the team.'); } catch (e) { toastError(e); }
      history.replaceState(null, '', '#/');
    }
    Object.assign(S, await db.loadMe(S.user.id));
    if (!S.orgs.length) return onboarding(app, S.profile, start);
    S.org = S.orgs.find((o) => o.id === S.profile.current_org_id) || S.orgs[0];
    if (S.org.id !== S.profile.current_org_id) db.setCurrentOrg(S.user.id, S.org.id).catch(() => {});
    await loadData();
    S.unread = await db.unreadCount().catch(() => 0);
    if (!unsubscribe) unsubscribe = db.onNewNotification(S.user.id, (n) => { S.unread++; paintBadges(); toast(n.title, 'info'); });
    renderShell();
  } catch (e) {
    app.innerHTML = String(html`<div class="auth"><div class="auth-card"><h2>Couldn't load PermitPal</h2><p class="tagline">${e.message}</p>
      <button class="btn btn-primary btn-block" data-act="reload">Try again</button>
      <button class="btn btn-ghost btn-block" data-act="sign-out">Sign out</button></div></div>`);
  }
}

async function loadData() {
  S.data = await db.loadOrgData(S.org.id);
  lastLoad = Date.now();
}

hooks.reload = async () => {
  try {
    const me = await db.loadMe(S.user.id);
    Object.assign(S, { profile: me.profile, orgs: me.orgs, plans: me.plans, prefs: me.prefs });
    S.org = S.orgs.find((o) => o.id === S.org.id) || S.orgs[0];
    await loadData();
  } catch (e) { toastError(e); }
  forgetRequirement();
  renderPage();
};
hooks.render = () => renderPage();

// ---------------------------------------------------------------- shell
const NAV = [
  ['', 'dashboard', ICON.home], ['businesses', 'businesses', ICON.building], ['vehicles', 'vehicles', ICON.car],
  ['compliance', 'compliance', ICON.list], ['people', 'people', ICON.person], ['documents', 'documents', ICON.file], ['services', 'services', ICON.briefcase],
];
const MORE = [['notifications', 'notifications'], ['partners', 'partners'], ['costs', 'costs'], ['sharing', 'sharing'],
  ['history', 'history'], ['trash', 'trash'], ['team', 'team'], ['settings', 'settings']];

function renderShell() {
  const name = [S.profile.first_name, S.profile.last_name].filter(Boolean).join(' ') || S.profile.email;
  app.innerHTML = String(html`
    <div class="shell">
      <aside class="sidebar">
        <a class="brand" href="#/"><img src="img/logo.png" alt=""><span class="wordmark"><span class="w1">Permit</span><span class="w2">Pal</span></span></a>
        ${S.orgs.length > 1 ? html`<select class="org-switch" id="org-switch">${S.orgs.map((o) => html`<option value="${o.id}" ${o.id === S.org.id ? 'selected' : ''}>${o.name}</option>`)}</select>`
          : html`<div class="org-name">${S.org.name}</div>`}
        <nav>${NAV.map(([p, k, ic]) => html`<a class="nav" href="#/${p}" data-nav="${p}">${ic}<span>${t(k)}</span></a>`)}</nav>
        <nav class="nav-secondary">
          <a class="nav" href="#/notifications" data-nav="notifications">${ICON.bell}<span>${t('notifications')}</span><b class="badge" data-badge></b></a>
          ${MORE.slice(1).map(([p, k]) => html`<a class="nav small" href="#/${p}" data-nav="${p}"><span>${t(k)}</span></a>`)}
          ${isStaff() ? html`<a class="nav small" href="#/admin" data-nav="admin"><span>${t('admin')}</span></a>` : ''}
        </nav>
        <div class="me"><div class="me-name">${name}</div><div class="muted small">${S.org.role}</div>
          <button class="linklike small" data-act="sign-out">${t('signout')}</button></div>
      </aside>
      <div class="main-col">
        <header class="topbar">
          <a class="brand mobile-only" href="#/"><img src="img/logo.png" alt=""><span class="wordmark"><span class="w1">Permit</span><span class="w2">Pal</span></span></a>
          <div class="spacer"></div>
          <a class="icon-btn bell" href="#/notifications" aria-label="Notifications">${ICON.bell}<b class="badge" data-badge></b></a>
        </header>
        <div id="banner"></div>
        <main id="main" tabindex="-1"></main>
      </div>
      <nav class="tabbar">
        ${NAV.slice(0, 4).map(([p, k, ic]) => html`<a href="#/${p}" data-nav="${p}">${ic}<span>${t(k)}</span></a>`)}
        <button data-act="more-menu">${ICON.more}<span>${t('more')}</span><b class="badge" data-badge></b></button>
      </nav>
    </div>`);
  document.getElementById('org-switch')?.addEventListener('change', async (e) => {
    try { await db.setCurrentOrg(S.user.id, e.target.value); location.hash = '#/'; location.reload(); } catch (err) { toastError(err); }
  });
  renderPage();
}

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
  document.querySelectorAll('[data-nav]').forEach((n) => n.classList.toggle('active', (n.dataset.nav || '') === (a === 'help' ? 'services' : a || '')));
  paintBadges();
  banner();
  try {
    if (!a) dashboard(main);
    else if (a === 'businesses') b ? businessDetail(main, b) : businessList(main, params);
    else if (a === 'vehicles') b ? vehicleDetail(main, b) : vehicleList(main, params);
    else if (a === 'people') b ? personDetail(main, b) : personList(main, params);
    else if (a === 'requirement') await requirementPage(main, b);
    else if (a === 'compliance') compliance(main, params);
    else if (a === 'documents') await documents(main);
    else if (a === 'services' || a === 'help') (b === 'orders' && parts[2]) ? await order(main, parts[2]) : services(main, b && a === 'help' ? new URLSearchParams('req=' + b) : params);
    else if (a === 'partners') await partners(main);
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
    main.innerHTML = String(html`<div class="empty"><div class="empty-title">Something went wrong on this page</div><p>${e.message}</p></div>`);
  }
}

let lastPath = '';
window.addEventListener('hashchange', () => {
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
on('more-menu', () => {
  import('./util.js').then(({ openModal }) => openModal(t('more'), html`<div class="more-menu">
    ${NAV.slice(4).map(([p, k, ic]) => html`<a href="#/${p}" data-close>${ic}<span>${t(k)}</span></a>`)}
    ${MORE.map(([p, k]) => html`<a href="#/${p}" data-close><span>${t(k)}</span>${p === 'notifications' && S.unread ? html`<b class="badge">${S.unread}</b>` : ''}</a>`)}
    ${isStaff() ? html`<a href="#/admin" data-close><span>${t('admin')}</span></a>` : ''}
    <button class="linklike" data-act="sign-out">${t('signout')}</button></div>`, {
    onOpen: (form) => form.querySelectorAll('[data-close]').forEach((l) => l.addEventListener('click', () => { document.getElementById('modal-root').innerHTML = ''; })),
  }));
});

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

start();
