// "Who's handling it": pick the teammate responsible for a permit (or several at once). That person gets
// its reminders; owners and admins are alerted if it isn't started in time. Written so nobody can be
// confused about who is doing what: every permit says plainly who handles it, or that nobody does yet.
import { html, openModal, toast, toastError, plural, when } from '../util.js?v=fd3a394';
import { S, on, reload, rerender, canEdit, has, reqById, memberName, isOrgAdmin } from '../core.js?v=fd3a394';
import { ICON } from '../components.js?v=fd3a394';
import * as db from 'pp/data';

// Teammates who can be given permits: anyone who can edit (viewers can only look). You first.
export function assignable() {
  return (S.data?.members || []).filter((m) => m.role !== 'viewer')
    .sort((a, b) => (a.user_id === S.user?.id ? -1 : b.user_id === S.user?.id ? 1 : memberName(a.user_id).localeCompare(memberName(b.user_id))));
}
const fullName = (userId) => {
  const p = S.data?.members.find((m) => m.user_id === userId)?.profile;
  return p ? [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email || 'Teammate' : 'Teammate';
};
// "You" for yourself, the full name for others; null when nobody is handling it.
export const handlerName = (r) => (r?.assignee_id ? (r.assignee_id === S.user?.id ? 'You' : fullName(r.assignee_id)) : null);

// The small "handled by" pill used in lists.
export const whoPill = (r) => (has('assign') && r.assignee_id
  ? html`<span class="who" title="${r.assignee_id === S.user?.id ? 'You are handling this' : fullName(r.assignee_id) + ' is handling this'}">${ICON.person}${r.assignee_id === S.user?.id ? 'You' : fullName(r.assignee_id).split(' ')[0]}</span>`
  : '');

// The line on a permit's own page.
export function handledByLine(r) {
  if (!has('assign')) return '';
  const who = handlerName(r);
  return html`<p class="handled">${ICON.person}
    ${who ? html`<span>Handled by <b>${who === 'You' ? 'you' : who}</b></span>` : html`<span>Nobody is handling this yet, so everyone on the team gets its reminders.</span>`}
    ${when(canEdit(), html`<button class="linklike" data-act="req-assign" data-id="${r.id}">${who ? 'Change' : 'Choose someone'}</button>`)}</p>`;
}

// Pick a person for one or many permits.
export function openAssign(ids, { onDone } = {}) {
  const reqs = ids.map(reqById).filter(Boolean);
  if (!reqs.length) return;
  const people = assignable();
  const current = reqs.length === 1 ? reqs[0].assignee_id || '' : (reqs.every((r) => r.assignee_id === reqs[0].assignee_id) ? reqs[0].assignee_id || '' : null);
  const days = S.org?.escalate_days;
  openModal(reqs.length === 1 ? `Who's handling "${reqs[0].name}"?` : `Who's handling these ${reqs.length} permits?`, html`
    <p class="muted small">The person you pick gets the reminders${reqs.length === 1 ? ' for it' : ''}. ${days
      ? html`Owners and admins are told if it isn't started ${plural(days, 'day')} before it's due, and every week if it becomes overdue.`
      : html`Owners and admins are told every week if it becomes overdue.`}</p>
    <div class="pick-list" role="radiogroup" aria-label="Handled by">
      ${people.map((m) => html`<label class="pick"><input type="radio" name="who" value="${m.user_id}" ${current === m.user_id ? 'checked' : ''}>
        <span class="pick-main"><b>${m.user_id === S.user?.id ? `${fullName(m.user_id)} (you)` : fullName(m.user_id)}</b>
        <small>${{ owner: 'Owner', admin: 'Admin', member: 'Member' }[m.role] || m.role}</small></span></label>`)}
      <label class="pick"><input type="radio" name="who" value="" ${current === '' ? 'checked' : ''}>
        <span class="pick-main"><b>Nobody</b><small>Everyone who can edit gets the reminders</small></span></label>
    </div>
    ${when(people.length <= 1, html`<p class="muted small">Only you are on this team so far. ${isOrgAdmin() ? html`<a href="#/team">Invite a teammate</a> to share the work.` : ''}</p>`)}`, {
    submitLabel: 'Save',
    onSubmit: async (fd) => {
      if (!fd.has('who')) throw new Error('Choose a person, or Nobody.');
      const who = fd.get('who') || null;
      const n = await db.assignRequirements(reqs.map((r) => r.id), who);
      onDone?.(); // before the redraw, so the page comes back out of "choosing" mode
      await reload();
      const name = who ? (who === S.user?.id ? 'you' : fullName(who)) : null;
      toast(n === 0 ? 'Nothing changed.' : who
        ? `${reqs.length === 1 ? 'Now handled by' : plural(n, 'permit') + ' now handled by'} ${name}.${who !== S.user?.id ? ' We let them know.' : ''}`
        : `${reqs.length === 1 ? 'Nobody is handling it now' : plural(n, 'permit') + ' now have nobody handling them'}. Everyone gets the reminders.`);
    },
  });
}
on('req-assign', (ds) => openAssign([ds.id]));

// ---------------------------------------------------------------- choosing several at once (Compliance list)
export const bulk = { on: false, ids: new Set() };
export function bulkBar(visibleIds) {
  if (!bulk.on) return '';
  const n = bulk.ids.size;
  return html`<div class="bulk-bar" role="region" aria-label="Selected permits">
    <span><b>${n}</b> selected</span>
    <button class="btn btn-sm btn-ghost" data-act="bulk-all" data-ids="${visibleIds.join(',')}">${visibleIds.length && visibleIds.every((id) => bulk.ids.has(id)) ? 'Select none' : 'Select all shown'}</button>
    <span class="spacer"></span>
    <button class="btn btn-sm btn-ghost" data-act="bulk-cancel">Cancel</button>
    <button class="btn btn-sm btn-primary" data-act="bulk-assign" ${n ? '' : 'disabled'}>Assign to…</button></div>`;
}
export const selectBox = (r) => (bulk.on ? html`<label class="row-pick" title="Select"><input type="checkbox" data-pick="${r.id}" ${bulk.ids.has(r.id) ? 'checked' : ''} aria-label="Select ${r.name}"></label>` : '');
on('bulk-toggle', () => { bulk.on = !bulk.on; bulk.ids.clear(); reloadView(); });
on('bulk-cancel', () => { bulk.on = false; bulk.ids.clear(); reloadView(); });
on('bulk-all', (ds) => {
  const ids = (ds.ids || '').split(',').filter(Boolean);
  const all = ids.every((id) => bulk.ids.has(id));
  ids.forEach((id) => (all ? bulk.ids.delete(id) : bulk.ids.add(id)));
  reloadView();
});
on('bulk-assign', () => { if (bulk.ids.size) openAssign([...bulk.ids], { onDone: () => { bulk.on = false; bulk.ids.clear(); } }); });
// Ticking a box only updates the bar (no full redraw, so the list doesn't jump).
document.addEventListener('change', (e) => {
  const id = e.target?.dataset?.pick;
  if (!id) return;
  if (e.target.checked) bulk.ids.add(id); else bulk.ids.delete(id);
  const bar = document.querySelector('.bulk-bar');
  if (bar) {
    bar.querySelector('b').textContent = bulk.ids.size;
    bar.querySelector('[data-act=bulk-assign]').disabled = !bulk.ids.size;
  }
});
const reloadView = () => rerender();
// Leaving the Compliance page ends "choose several".
window.addEventListener('hashchange', () => { if (!location.hash.startsWith('#/compliance')) { bulk.on = false; bulk.ids.clear(); } });

// How many permits a teammate handles (for the Team page warning before removing them).
export const handledCount = (userId) => (S.data?.reqs || []).filter((r) => r.assignee_id === userId).length;
