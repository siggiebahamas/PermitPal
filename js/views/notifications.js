// Notifications: a full page grouped by business, vehicle or person, where each item is a task
// with its button, and the bell drop-down at the top right for a quick look from any page.
import { html, timeAgo, toastError, confirmDialog, when } from '../util.js';
import { S, on, hooks, canEdit, reqById, business, vehicle, person } from '../core.js';
import { ICON, NEXT_ACTION } from '../components.js';
import * as db from 'pp/data';

// Which business, vehicle or person a notification is about.
function entityOf(n) {
  let r = n.requirement_id ? reqById(n.requirement_id) : null;
  const m = /^#\/requirement\/([\w-]+)/.exec(n.link || '');
  if (!r && m) r = reqById(m[1]);
  const order = null; // done-for-you orders were retired
  const src = r || order;
  if (src?.business_id && business(src.business_id)) { const b = business(src.business_id); return { key: 'b:' + b.id, name: b.name, icon: ICON.building, href: '#/businesses/' + b.id, r, order }; }
  if (src?.vehicle_id && vehicle(src.vehicle_id)) { const v = vehicle(src.vehicle_id); return { key: 'v:' + v.id, name: v.make_model + (v.plate_no ? ' · ' + v.plate_no : ''), icon: ICON.car, href: '#/vehicles/' + v.id, r, order }; }
  if (src?.person_id && person(src.person_id)) { const p = person(src.person_id); return { key: 'p:' + p.id, name: p.full_name, icon: ICON.person, href: '#/people/' + p.id, r, order }; }
  if (order) return { key: 'orders', name: 'Service requests', icon: ICON.briefcase, href: '#/services', r, order };
  if (n.org_id && n.org_id !== S.org.id) return { key: 'other', name: 'Other workspaces', icon: ICON.grid, href: null, r: null, order: null };
  return { key: 'ws', name: S.org.name, icon: ICON.home, href: null, r: null, order: null };
}

// The one thing to do about it, as a button.
function actionFor(n, e) {
  if (!canEdit()) return n.link ? html`<a class="btn btn-sm nb2" href="${n.link}" data-act="notif-open" data-id="${n.id}">Open</a>` : '';
  if (e.r?.next_action) {
    return html`<button class="btn btn-sm ${e.r.next_action === 'renew' ? 'nb1' : 'nb2'}" data-act="req-next" data-id="${e.r.id}" data-notif="${n.id}">${NEXT_ACTION[e.r.next_action]}</button>`;
  }
  if (e.order) {
    const a = e.order;
    const label = a.status === 'quoted' ? 'Review quote' : a.payment_status === 'awaiting_payment' ? 'Pay' : 'Open request';
    return html`<a class="btn btn-sm ${label === 'Open request' ? 'nb2' : 'nb1'}" href="#/services/orders/${a.id}" data-act="notif-open" data-id="${n.id}">${label}</a>`;
  }
  return n.link ? html`<a class="btn btn-sm nb2" href="${n.link}" data-act="notif-open" data-id="${n.id}">Open</a>` : '';
}

function groups(list) {
  const map = new Map();
  for (const n of list) {
    const e = entityOf(n);
    if (!map.has(e.key)) map.set(e.key, { ...e, items: [] });
    map.get(e.key).items.push({ n, e });
  }
  // Groups with something new first, then the most recent.
  return [...map.values()].sort((a, b) => (b.items.some((x) => !x.n.read_at) - a.items.some((x) => !x.n.read_at))
    || (b.items[0].n.created_at > a.items[0].n.created_at ? 1 : -1));
}

export async function notifications(el) {
  el.innerHTML = String(html`<div class="loading">Loading…</div>`);
  let list = [];
  try { list = await db.listNotifications(); } catch (e) { toastError(e); }
  const todo = list.filter((n) => !n.read_at).length;
  el.innerHTML = String(html`
    <div class="page-head"><div><h1>Notifications</h1><p class="muted">${list.length ? `${todo} to do · ${list.length - todo} done` : 'Reminders and updates. Emails and texts follow your settings.'}</p></div>
      ${when(list.length, html`<div class="btn-row"><button class="btn btn-ghost btn-sm" data-act="notif-all-read">Mark all done</button>
      <button class="btn btn-ghost btn-sm" data-act="notif-clear">Clear all</button></div>`)}</div>
    ${list.length ? groups(list).map((g) => {
      const fresh = g.items.filter((x) => !x.n.read_at).length;
      return html`<section class="ngroup">
        <div class="ng-head"><span class="ng-ic">${g.icon}</span>${g.href ? html`<a href="${g.href}">${g.name}</a>` : html`<span>${g.name}</span>`}
          <span class="ng-count ${fresh ? '' : 'none'}">${fresh ? `${fresh} new` : 'all done'}</span></div>
        ${g.items.map(({ n, e }) => html`<div class="ng-row ${n.read_at ? 'done' : 'new'}">
          ${n.read_at ? html`<span class="ng-check on" title="Done">${ICON.check}</span>`
            : html`<button class="ng-check" data-act="notif-done" data-id="${n.id}" title="Mark as done" aria-label="Mark as done"></button>`}
          <a class="ng-main" href="${n.link || '#/notifications'}" data-act="notif-open" data-id="${n.id}">
            <b>${n.title}</b><small>${n.body && n.body !== g.name ? n.body + ' · ' : ''}${timeAgo(n.created_at)}</small></a>
          ${when(!n.read_at, html`<i class="ng-dot" aria-label="New"></i>`)}
          ${when(!n.read_at, html`<span class="ng-act">${actionFor(n, e)}</span>`)}
          <button class="icon-btn ng-x" data-act="notif-delete" data-id="${n.id}" aria-label="Delete">✕</button>
        </div>`)}
      </section>`;
    }) : html`<section class="ngroup ng-empty"><div class="ng-head"><span class="ng-ic">${ICON.check}</span><span>You're all caught up</span></div>
      <p class="muted">We'll let you know here, and by email, when something needs attention.</p></section>`}`);
}

async function markRead(id) {
  try { await db.markRead([id]); S.unread = Math.max(0, S.unread - 1); hooks.paintBadges?.(); } catch { /* not critical */ }
}
on('notif-open', (ds) => { markRead(ds.id); closeBell(); });
on('notif-done', async (ds) => { await markRead(ds.id); if (location.hash.startsWith('#/notifications')) notifications(document.getElementById('main')); });
on('notif-delete', async (ds) => {
  try { await db.deleteNotification(ds.id); S.unread = await db.unreadCount().catch(() => S.unread); hooks.paintBadges?.(); notifications(document.getElementById('main')); } catch (e) { toastError(e); }
});
on('notif-all-read', async () => {
  try { await db.markAllRead(); S.unread = 0; hooks.paintBadges?.(); closeBell(); if (location.hash.startsWith('#/notifications')) notifications(document.getElementById('main')); } catch (e) { toastError(e); }
});
on('notif-clear', async () => {
  if (!(await confirmDialog('Clear all notifications?', 'This only clears the list here. Your records are not affected.', { confirmLabel: 'Clear' }))) return;
  try { await db.clearNotifications(S.user.id); S.unread = 0; hooks.paintBadges?.(); notifications(document.getElementById('main')); } catch (e) { toastError(e); }
});
// Doing the task from a notification also ticks it off.
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act=req-next][data-notif]');
  if (b) { markRead(b.dataset.notif); closeBell(); }
}, true);

// ---------------------------------------------------------------- bell drop-down
let bellEl = null;
function closeBell() {
  if (!bellEl) return;
  bellEl.remove(); bellEl = null;
  document.removeEventListener('mousedown', outside, true);
  document.removeEventListener('keydown', esc);
}
const outside = (e) => { if (bellEl && !bellEl.contains(e.target) && !e.target.closest('[data-act=bell-open]')) closeBell(); };
const esc = (e) => { if (e.key === 'Escape') closeBell(); };
window.addEventListener('hashchange', closeBell);

on('bell-open', async () => {
  if (bellEl) return closeBell();
  bellEl = document.createElement('div');
  bellEl.className = 'bell-drop';
  bellEl.setAttribute('role', 'dialog');
  bellEl.setAttribute('aria-label', 'Notifications');
  bellEl.innerHTML = String(html`<div class="bd-head"><b>Notifications</b></div><div class="loading small">Loading…</div>`);
  document.body.appendChild(bellEl);
  document.addEventListener('mousedown', outside, true);
  document.addEventListener('keydown', esc);
  let list = [];
  try { list = await db.listNotifications(8); } catch (e) { toastError(e); }
  if (!bellEl) return;
  const fresh = list.filter((n) => !n.read_at).length;
  bellEl.innerHTML = String(html`
    <div class="bd-head"><b>Notifications</b>${fresh ? html`<span class="bd-count">${fresh} new</span>` : ''}
      ${when(fresh, html`<button class="bd-pill" data-act="notif-all-read">Mark all read</button>`)}</div>
    ${list.length ? list.map((n) => {
      const e = entityOf(n);
      return html`<a class="bd-item ${n.read_at ? '' : 'new'}" href="${n.link || '#/notifications'}" data-act="notif-open" data-id="${n.id}">
        <span class="bd-ic">${e.icon}</span><span class="bd-main"><b>${n.title}</b><small>${e.name} · ${timeAgo(n.created_at)}</small></span>
        ${when(!n.read_at, html`<i class="bd-dot"></i>`)}</a>`;
    }) : html`<p class="bd-empty">You're all caught up.</p>`}
    <a class="bd-all" href="#/notifications">See all notifications</a>`);
});
export { closeBell };
