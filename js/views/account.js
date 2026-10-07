// Notifications, History, Trash, Team, Settings (profile, reminders, workspace, billing, data).
import {
  html, fmtDate, fmtDateTime, timeAgo, peso, plural, toast, toastError, confirmDialog, openModal, formObject, when,
  normalizePhone, todayPH,
} from '../util.js';
import {
  S, on, reload, rerender, canEdit, isOrgAdmin, isOwner, memberName, empty, effectivePlan, ROLES, business, vehicle, person,
} from '../core.js';
import { avatar } from '../components.js';
import { KINDS, teamAccess, connectionsCard } from './network.js';
import * as db from 'pp/data';

// ================================================================ history
// One plain drop-down; each choice covers the record types people think of together.
const HIST_SHOW = [
  ['', 'Everything', null, 'changes'],
  ['permits', 'Permits & renewals', ['requirements', 'requirement_cycles'], 'permit changes'],
  ['files', 'Files', ['documents'], 'file changes'],
  ['businesses', 'Businesses & branches', ['businesses', 'business_locations'], 'business changes'],
  ['vehicles', 'Vehicles', ['vehicles'], 'vehicle changes'],
  ['people', 'Staff', ['people'], 'staff changes'],
  ['team', 'Team & workspace', ['org_members', 'orgs'], 'team changes'],
];
const HIST_PAGE = 100;
let histShow = '';
let histItems = [];
let histMore = false;
const phDay = (ts) => new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
const phTime = (ts) => new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });
function dayLabel(day) {
  const today = todayPH();
  const y = new Date(today + 'T00:00:00Z'); y.setUTCDate(y.getUTCDate() - 1);
  if (day === today) return 'Today';
  if (day === y.toISOString().slice(0, 10)) return 'Yesterday';
  return new Date(day + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: day.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric', timeZone: 'UTC' });
}
async function loadHistory(append = false) {
  const show = HIST_SHOW.find(([k]) => k === histShow) || HIST_SHOW[0];
  const before = append && histItems.length ? histItems[histItems.length - 1].id : null;
  const rows = await db.history(S.org.id, { entities: show[2], before, limit: HIST_PAGE });
  histItems = append ? [...histItems, ...rows] : rows;
  histMore = rows.length === HIST_PAGE;
}
export async function historyPage(el, { keep = false } = {}) {
  if (!keep) {
    el.innerHTML = String(html`<div class="loading">Loading…</div>`);
    try { await loadHistory(); } catch (e) { toastError(e); histItems = []; histMore = false; }
  }
  const show = HIST_SHOW.find(([k]) => k === histShow) || HIST_SHOW[0];
  const days = [];
  for (const a of histItems) {
    const d = phDay(a.created_at);
    if (!days.length || days[days.length - 1].day !== d) days.push({ day: d, items: [] });
    days[days.length - 1].items.push(a);
  }
  el.innerHTML = String(html`
    <div class="page-head"><div><h1>History</h1><p class="muted">Every change anyone on your team made, including deletions. Kept permanently.</p></div></div>
    <div class="hist-bar">
      <label for="hist-show">Show</label>
      <select id="hist-show">${HIST_SHOW.map(([k, label]) => html`<option value="${k}" ${k === histShow ? 'selected' : ''}>${label}</option>`)}</select>
      <span class="muted">${histItems.length}${histMore ? '+' : ''} ${histItems.length === 1 ? show[3].replace(/s$/, '') : show[3]}</span>
    </div>
    ${histItems.length ? html`<section class="card hist-card">
      ${days.map((g) => html`<div class="band hist-day"><span>${dayLabel(g.day)}</span><span>${g.items.length}</span></div>
        ${g.items.map((a) => html`<div class="line hist-line"><span class="line-main">${linkFor(a)}<small>${memberName(a.actor_id)} · ${phTime(a.created_at)}</small></span></div>`)}`)}
      <div class="sheet-foot">Deleted something by mistake? <a href="#/trash">Restore it from Trash.</a></div>
    </section>
    ${when(histMore, html`<button class="btn btn-ghost" data-act="hist-more">Show older changes</button>`)}`
      : html`<section class="card">${empty(histShow ? `No ${show[3]} yet` : 'No history yet', histShow ? 'Pick "Everything" to see all changes.' : 'Changes will show up here.')}</section>`}`);
  el.querySelector('#hist-show').addEventListener('change', (e) => { histShow = e.target.value; historyPage(el); });
}
on('hist-more', async (ds, btn) => {
  btn.disabled = true; btn.textContent = 'Loading…';
  try { await loadHistory(true); } catch (e) { toastError(e); }
  historyPage(document.getElementById('main'), { keep: true });
});
function linkFor(a) {
  const href = a.requirement_id && S.data.reqs.some((r) => r.id === a.requirement_id) ? `#/requirement/${a.requirement_id}`
    : a.business_id && business(a.business_id) ? `#/businesses/${a.business_id}`
    : a.vehicle_id && vehicle(a.vehicle_id) ? `#/vehicles/${a.vehicle_id}` : null;
  return href ? html`<a href="${href}">${a.summary}</a>` : html`<span>${a.summary}</span>`;
}

// ================================================================ trash
export async function trashPage(el) {
  el.innerHTML = String(html`<div class="loading">Loading…</div>`);
  let t;
  try { t = await db.trash(S.org.id); } catch (e) { toastError(e); return; }
  const section = (title, table, rows, label) => rows.length ? html`<section class="card"><h2>${title}</h2>
    ${rows.map((x) => html`<div class="row"><div class="row-main"><div class="row-title">${label(x)}</div><div class="row-sub">Deleted ${fmtDateTime(x.deleted_at)}</div></div>
      ${when(canEdit(), html`<div class="row-side"><button class="btn btn-sm btn-soft" data-act="restore" data-table="${table}" data-id="${x.id}">Restore</button></div>`)}</div>`)}</section>` : '';
  const bizName = (id) => business(id)?.name || 'a deleted business';
  const any = Object.values(t).some((a) => a.length);
  el.innerHTML = String(html`
    <div class="page-head"><div><h1>Trash</h1><p class="muted">Nothing is ever lost: deleted items stay here and can be restored. They are only erased if the whole workspace is deleted.</p></div></div>
    ${any ? '' : empty('Trash is empty', 'Deleted businesses, vehicles, permits and files will appear here.')}
    ${section('Businesses', 'businesses', t.businesses, (x) => x.name)}
    ${section('Branches', 'business_locations', t.locations, (x) => `${x.name} (${bizName(x.business_id)})`)}
    ${section('Vehicles', 'vehicles', t.vehicles, (x) => `${x.make_model}${x.plate_no ? ' · ' + x.plate_no : ''}`)}
    ${section('People', 'people', t.people || [], (x) => `${x.full_name}${x.role ? ' · ' + x.role : ''}`)}
    ${section('Permits', 'requirements', t.requirements, (x) => `${x.name} — ${x.business_id ? bizName(x.business_id) : x.vehicle_id ? vehicle(x.vehicle_id)?.make_model || 'a deleted vehicle' : person(x.person_id)?.full_name || 'a deleted person'}`)}
    ${section('Records', 'requirement_cycles', t.cycles, (x) => `${x.reference_no || 'Record'}${x.expires_on ? ' · expires ' + fmtDate(x.expires_on) : ''}`)}
    ${section('Files', 'documents', t.documents, (x) => x.file_name)}`);
}
on('restore', async (ds) => {
  try { await db.restore(ds.table, ds.id); await reload(); toast('Restored.'); } catch (e) { toastError(e); }
});

// ================================================================ team
export async function team(el) {
  el.innerHTML = String(html`<div class="loading">Loading…</div>`);
  let pending = [];
  if (isOrgAdmin()) { try { pending = await db.invites(S.org.id); } catch (e) { toastError(e); } }
  const plan = effectivePlan();
  const members = S.data.members;
  const seatsLeft = plan?.max_members == null ? null : plan.max_members - members.length - pending.length;
  const roleOptions = (cur, allowOwner) => Object.keys(ROLES).filter((r) => allowOwner || r !== 'owner')
    .map((r) => html`<option value="${r}" ${r === cur ? 'selected' : ''}>${r[0].toUpperCase() + r.slice(1)}</option>`);

  el.innerHTML = String(html`
    <div class="page-head"><div><h1>Team</h1><p class="muted">People who can see and manage ${S.org.name}.</p></div></div>
    <section class="card"><h2>Members</h2>
      ${members.map((m) => {
        const p = m.profile;
        const name = [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email;
        const me = m.user_id === S.user.id;
        const canChange = isOrgAdmin() && !me && (m.role !== 'owner' || isOwner());
        return html`<div class="row"><div class="row-main member">${avatar(name, null, 34)}<div><div class="row-title">${name}${me ? ' (you)' : ''}</div>
          <div class="row-sub">${p.email}${p.role_title ? ' · ' + p.role_title : ''}</div></div></div>
          <div class="row-side">${canChange
            ? html`<select data-member-role="${m.user_id}">${roleOptions(m.role, isOwner())}</select>
                   <button class="btn btn-sm btn-ghost danger" data-act="member-remove" data-id="${m.user_id}" data-name="${name}">Remove</button>`
            : html`<span class="tag">${m.role}</span>${me && members.length > 1 ? html`<button class="btn btn-sm btn-ghost" data-act="member-leave">Leave</button>` : ''}`}</div></div>`;
      })}
      <div class="muted small">${Object.entries(ROLES).map(([k, v]) => html`<div>${v}</div>`)}</div>
    </section>
    ${when(isOrgAdmin(), html`<section class="card"><h2>Invite someone</h2>
      ${seatsLeft !== null && seatsLeft <= 0
        ? html`<p class="muted">Your ${plan.name} plan includes ${plural(plan.max_members, 'person', 'people')}. <a href="#/settings/billing">Upgrade</a> to invite more.</p>`
        : html`<form id="invite-form" class="inline-form">
            <input type="email" name="email" required placeholder="name@company.ph">
            <select name="role">${roleOptions('member', false)}</select>
            <button class="btn btn-primary">Send invite</button></form>
          <p class="muted small">They get an email with a link. ${seatsLeft !== null ? `${plural(seatsLeft, 'seat')} left on your plan.` : ''}</p>`}
      ${when(pending.length, html`<h4>Pending invites</h4>${pending.map((i) => html`<div class="row"><div class="row-main"><div class="row-title">${i.email}</div>
        <div class="row-sub">${i.role} · expires ${fmtDate(i.expires_at)}</div></div>
        <div class="row-side"><button class="btn btn-sm btn-ghost" data-act="invite-copy" data-token="${i.token}">Copy link</button>
        <button class="btn btn-sm btn-ghost danger" data-act="invite-revoke" data-id="${i.id}">Revoke</button></div></div>`)}`)}
    </section>`)}`);

  el.querySelectorAll('[data-member-role]').forEach((s) => s.addEventListener('change', async () => {
    try { await db.setMemberRole(S.org.id, s.dataset.memberRole, s.value); await reload(); toast('Role updated.'); } catch (e) { toastError(e); rerender(); }
  }));
  const form = el.querySelector('#invite-form');
  if (form) form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = formObject(new FormData(form));
    try { await db.invite(S.org.id, f.email.toLowerCase(), f.role); toast(`Invite sent to ${f.email}.`); team(el); } catch (err) { toastError(err); }
  });
}
on('invite-copy', async (ds) => {
  const url = location.origin + location.pathname + '#/invite/' + ds.token;
  try { await navigator.clipboard.writeText(url); toast('Invite link copied.'); } catch { openModal('Invite link', html`<input class="copy" readonly value="${url}">`); }
});
on('invite-revoke', async (ds) => { try { await db.revokeInvite(ds.id); rerender(); toast('Invite revoked.'); } catch (e) { toastError(e); } });
on('member-remove', async (ds) => {
  if (!(await confirmDialog(`Remove ${ds.name}?`, 'They lose access to this workspace immediately. Their past changes stay in History.', { confirmLabel: 'Remove' }))) return;
  try { await db.removeMember(S.org.id, ds.id); await reload(); toast('Removed.'); } catch (e) { toastError(e); }
});
on('member-leave', async () => {
  if (!(await confirmDialog(`Leave ${S.org.name}?`, "You'll lose access until someone invites you again.", { confirmLabel: 'Leave' }))) return;
  try { await db.removeMember(S.org.id, S.user.id); location.hash = '#/'; location.reload(); } catch (e) { toastError(e); }
});

// ================================================================ settings
export async function settings(el, section) {
  const p = S.profile;
  const prefs = S.prefs || {};
  let channels = {};
  let log = [];
  let conn = '';
  let pay = {};
  try {
    [channels, log, conn, pay] = await Promise.all([
      db.channelStatus().catch(() => ({})),
      db.myDeliveryLog(S.user.id).catch(() => []),
      section === 'workspace' ? connectionsCard() : '',
      section === 'billing' ? db.appSettings().catch(() => ({})) : {},
    ]);
  } catch { /* shown as empty */ }
  const toggle = (k, label, sub = '', disabled = false) => html`<label class="toggle ${disabled ? 'disabled' : ''}"><div><div>${label}</div>${when(sub, html`<div class="muted small">${sub}</div>`)}</div>
    <input type="checkbox" data-pref="${k}" ${prefs[k] ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span class="switch"></span></label>`;
  const org = S.org;

  el.innerHTML = String(html`
    <div class="page-head"><div><h1>Settings</h1></div></div>
    <nav class="subnav"><a href="#/settings">Profile & reminders</a><a href="#/settings/billing">Plan</a><a href="#/settings/workspace">Workspace & data</a></nav>

    ${when(!section, html`
    <section class="card"><h2>Profile</h2>
      <form id="profile-form">
        <div class="grid2">
          <label class="field"><span>First name</span><input name="first_name" maxlength="80" value="${p.first_name}"></label>
          <label class="field"><span>Last name</span><input name="last_name" maxlength="80" value="${p.last_name}"></label>
          <label class="field"><span>Role / title <small>(optional)</small></span><input name="role_title" maxlength="80" value="${p.role_title}" placeholder="e.g. Fleet head"></label>
          <label class="field"><span>Mobile number <small>(for SMS / WhatsApp)</small></span><input name="phone" value="${p.phone || ''}" placeholder="0917 123 4567"></label>
        </div>
        <label class="field"><span>Photo <small>(optional)</small></span><input type="file" name="avatar" accept="image/jpeg,image/png,image/webp"></label>
        <p class="muted small">Email: ${p.email}</p>
        <div class="btn-row"><button class="btn btn-primary">Save profile</button><button type="button" class="btn btn-ghost" data-act="change-password">Change password</button></div>
      </form>
    </section>

    <section class="card"><h2>Reminders</h2>
      <p class="muted small">We remind you 30 days, 7 days and 1 day before something expires, then weekly while it's overdue. Times are Philippine time (about 7am).</p>
      ${toggle('email_enabled', 'Email', channels.email === false ? 'Email sending is being set up — reminders show here in the app meanwhile.' : p.email)}
      <h4>What to remind me about</h4>
      ${toggle('business_alerts', 'Business permits')}
      ${toggle('vehicle_alerts', 'Vehicle registration and insurance')}
      ${toggle('remind_30', '30 days before')}${toggle('remind_7', '7 days before')}${toggle('remind_1', '1 day before')}
      ${toggle('weekly_digest', 'Monday summary email')}
    </section>

    <section class="card"><h2>Delivery log</h2>
      <p class="muted small">Proof of every reminder we sent you (or tried to).</p>
      ${log.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Channel</th><th>Message</th><th>Status</th></tr></thead><tbody>
        ${log.map((m) => html`<tr><td>${fmtDateTime(m.created_at)}</td><td>${m.channel}</td><td>${m.subject || m.body_text.slice(0, 80)}</td>
          <td><span class="tag ${m.status === 'sent' ? 'green' : m.status === 'failed' ? 'red' : ''}" title="${m.last_error || ''}">${m.status}</span></td></tr>`)}
      </tbody></table></div>` : html`<p class="muted">Nothing sent yet.</p>`}
    </section>
    <section class="card" id="install"><h2>Put PermitPal on your phone</h2>
      <p class="muted small">It opens like an app, full screen, with no app store needed.</p>
      <div class="grid2">
        <div><b>iPhone (Safari)</b><ol class="small"><li>Open PermitPal in Safari.</li><li>Tap the Share button (square with an arrow).</li><li>Tap <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol></div>
        <div><b>Android (Chrome)</b><ol class="small"><li>Open PermitPal in Chrome.</li><li>Tap the ⋮ menu at the top right.</li><li>Tap <b>Add to Home screen</b> or <b>Install app</b>.</li></ol></div>
      </div>
    </section>`)}

    ${when(section === 'billing', html`
    ${billingSection(pay)}`)}

    ${when(section === 'workspace', html`
    <section class="card"><h2>Workspace</h2>
      <form id="org-form" class="inline-form"><input name="name" maxlength="120" value="${org.name}" ${isOrgAdmin() ? '' : 'disabled'}>
        ${when(isOrgAdmin(), html`<button class="btn btn-primary">Rename</button>`)}</form>
      ${when(S.orgs.length > 1, html`<h4>Switch workspace</h4>${S.orgs.map((o) => html`<div class="row"><div class="row-main"><div class="row-title">${o.name}</div><div class="row-sub">${o.role}</div></div>
        <div class="row-side">${o.id === org.id ? html`<span class="tag">Current</span>` : html`<button class="btn btn-sm btn-soft" data-act="switch-org" data-id="${o.id}">Switch</button>`}</div></div>`)}`)}
      <p><button class="btn btn-ghost" data-act="new-org">+ Create another workspace</button>
        <span class="muted small">Useful if you manage permits for several separate companies or clients.</span></p>
    </section>

    <section class="card"><div class="card-head"><div><h2>What this workspace is for</h2><p class="card-sub">Team types add a board for everything you're responsible for. 30-day free trial.</p></div></div>
      <form id="kind-form">${Object.entries(KINDS).filter(([k, v]) => !v.hidden || org.kind === k).map(([k, v]) => html`<label class="radio-card ${org.kind === k ? 'on' : ''}"><input type="radio" name="kind" value="${k}" ${org.kind === k ? 'checked' : ''} ${isOrgAdmin() ? '' : 'disabled'}>
        <span><b>${v.title}</b><small>${k === 'business' ? 'Free. Track your own permits, vehicles and staff licences.' : v.pitch}</small></span></label>`)}
        ${when(isOrgAdmin(), html`<button class="btn btn-primary">Save</button>`)}</form>
    </section>

    ${conn}

    <section class="card"><h2>Language</h2>
      <div class="btn-row"><button class="btn ${p.lang === 'en' ? 'btn-primary' : 'btn-ghost'}" data-act="lang" data-lang="en">English</button>
      <button class="btn ${p.lang === 'tl' ? 'btn-primary' : 'btn-ghost'}" data-act="lang" data-lang="tl">Tagalog</button></div>
      <p class="muted small">Tagalog covers the menus for now; more screens will follow.</p>
    </section>

    <section class="card"><h2>Your data</h2>
      <p class="muted small">Download everything you track as a spreadsheet, anytime. PermitPal backs up the database and every uploaded file every night, encrypted, and keeps past permit periods forever.</p>
      <button class="btn btn-soft" data-act="export-csv">Download CSV</button>
    </section>

    ${when(isOwner(), html`<section class="card danger-card"><h2>Delete workspace</h2>
      ${org.deleted_at
        ? html`<p>This workspace is scheduled to be permanently erased on <b>${fmtDate(org.purge_after.slice(0, 10))}</b>.</p><button class="btn btn-primary" data-act="org-undelete">Cancel deletion</button>`
        : html`<p class="muted small">Erases every business, vehicle, record and file in ${org.name} after a 30-day grace period (Data Privacy Act). Everyone on the team is notified.</p>
               <button class="btn btn-danger" data-act="org-delete">Delete workspace</button>`}</section>`)}`)}
  `);

  el.querySelectorAll('.subnav a').forEach((a) => { if (a.getAttribute('href') === location.hash.split('?')[0]) a.classList.add('active'); });
  el.querySelectorAll('[data-pref]').forEach((i) => i.addEventListener('change', async () => {
    try { await db.updatePrefs(S.user.id, { [i.dataset.pref]: i.checked }); S.prefs[i.dataset.pref] = i.checked; toast('Saved.'); } catch (e) { i.checked = !i.checked; toastError(e); }
  }));
  const pf = el.querySelector('#profile-form');
  if (pf) pf.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(pf);
    const f = formObject(fd);
    const phone = f.phone ? normalizePhone(f.phone) : null;
    if (f.phone && !phone) return toast('Please enter a valid mobile number, e.g. 0917 123 4567.', 'error');
    try {
      const file = fd.get('avatar');
      if (file && file.size) await db.uploadAvatar(S.user.id, file);
      await db.updateProfile(S.user.id, { first_name: f.first_name, last_name: f.last_name, role_title: f.role_title, phone: phone || null });
      Object.assign(S.profile, { first_name: f.first_name, last_name: f.last_name, role_title: f.role_title, phone: phone || null });
      await reload();
      toast('Profile saved.');
    } catch (err) { toastError(err); }
  });
  const of = el.querySelector('#org-form');
  if (of) of.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = new FormData(of).get('name').trim();
    if (!name) return;
    try { await db.renameOrg(org.id, name); S.org.name = name; await reload(); toast('Renamed.'); } catch (err) { toastError(err); }
  });
  el.querySelector('#kind-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const kind = new FormData(e.target).get('kind');
    if (!kind || kind === org.kind) return;
    try {
      await db.setOrgProfile(org.id, { kind });
      await reload();
      toast(kind === 'business' ? 'Back to a single business. Your data is unchanged.' : `${KINDS[kind].nav} is on. Find it in the menu.`);
    } catch (err) { toastError(err); }
  });
}

on('change-password', () => openModal('Change password', html`
  <label class="field"><span>New password</span><input type="password" name="password" minlength="8" required autocomplete="new-password"></label>`, {
  onSubmit: async (fd) => {
    const pw = fd.get('password');
    if (pw.length < 8) throw new Error('Use at least 8 characters.');
    await db.auth.setPassword(pw);
    toast('Password changed.');
  },
}));
on('lang', async (ds) => { try { await db.updateProfile(S.user.id, { lang: ds.lang }); S.profile.lang = ds.lang; location.reload(); } catch (e) { toastError(e); } });
on('switch-org', async (ds) => { try { await db.setCurrentOrg(S.user.id, ds.id); location.hash = '#/'; location.reload(); } catch (e) { toastError(e); } });
on('new-org', () => openModal('Create a workspace', html`<label class="field"><span>Workspace name</span><input name="name" required maxlength="120" placeholder="e.g. company or client name"></label>`, {
  submitLabel: 'Create',
  onSubmit: async (fd) => { const n = fd.get('name').trim(); if (!n) throw new Error('Please enter a name.'); await db.createOrg(n); location.hash = '#/'; location.reload(); },
}));
on('org-delete', async () => {
  if (!(await confirmDialog(`Delete ${S.org.name}?`, 'Everything in this workspace will be permanently erased in 30 days. You can cancel until then. Download your data first if you want a copy.', { confirmLabel: 'Schedule deletion' }))) return;
  try { await db.requestOrgDeletion(S.org.id); await reload(); rerender(); toast('Deletion scheduled. You can cancel within 30 days.'); } catch (e) { toastError(e); }
});
on('org-undelete', async () => { try { await db.cancelOrgDeletion(S.org.id); await reload(); rerender(); toast('Deletion cancelled.'); } catch (e) { toastError(e); } });


// ---------------------------------------------------------------- plans
function billingSection(pay) {
  const org = S.org;
  const acc = teamAccess();
  const k = KINDS[org.kind || 'business'];
  const plan = S.plans.find((p) => p.id === k?.plan);
  const teamPlans = ['fleet', 'firm', 'property'].map((id) => S.plans.find((p) => p.id === id)).filter(Boolean);
  const status = org.kind === 'business' ? html`<p>This workspace is a <b>single business</b>: PermitPal is <b>free</b>, with no limits on businesses, vehicles or team members.</p>`
    : acc.why === 'plan' ? html`<p>You're on the <b>${plan?.name}</b> plan${org.plan_expires_at ? html`, paid until <b>${fmtDate(org.plan_expires_at.slice(0, 10))}</b>` : ''}.</p>`
    : acc.why === 'trial' ? html`<p>You're on a <b>free trial</b> of ${plan?.name}: ${plural(acc.days, 'day')} left. Choose the plan below to keep your board after the trial.</p>`
    : acc.why === 'staff' ? html`<p>Staff access: team tools are on.</p>`
    : html`<p>Your free trial of ${plan?.name} has ended. Your data is safe; choose the plan below to open your board again.</p>`;
  const payBox = (p) => html`<div class="plan-pay">
      ${pay.online_payments === 'on' && isOwner() ? html`<div class="btn-row"><select name="months" data-months="${p.id}"><option value="1">1 month</option><option value="3">3 months</option><option value="12">12 months</option></select>
        <button class="btn btn-primary btn-sm" data-act="plan-checkout" data-plan="${p.id}">Pay online (GCash, Maya, card)</button></div>`
      : html`${when(pay.gcash_number || pay.bank_account_number, html`<div class="paywiths">
          ${when(pay.gcash_number, html`<div class="paywith"><b>GCash</b><span>${pay.gcash_number}${pay.gcash_name ? ' · ' + pay.gcash_name : ''}</span></div>`)}
          ${when(pay.bank_account_number, html`<div class="paywith"><b>${pay.bank_name || 'Bank transfer'}</b><span>${pay.bank_account_number}${pay.bank_account_name ? ' · ' + pay.bank_account_name : ''}</span></div>`)}</div>`)}
        <p class="muted small">${pay.payment_note || 'Pay the monthly amount, then press the button so we can activate your plan within 1 business day.'}</p>
        ${when(isOrgAdmin(), html`<button class="btn btn-primary btn-sm" data-act="plan-request" data-plan="${p.id}">I've paid / activate ${p.name}</button>`)}`}
    </div>`;
  return html`<section class="card"><h2>Your plan</h2>${status}
      ${org.kind !== 'business' && plan && acc.why !== 'plan' && acc.why !== 'staff' ? payBox(plan) : ''}</section>
    <h3 class="section-label">Team plans</h3>
    <div class="svc-grid">${teamPlans.map((p) => html`<section class="card svc ${p.id === k?.plan ? 'plan-current' : ''}">
      <div class="svc-top"><h2>${p.name}</h2><div class="svc-price"><b>₱${Number(p.price_php_monthly).toLocaleString()}</b><small>per month</small></div></div>
      <ul class="svc-inc">${p.features.map((f) => html`<li>${f}</li>`)}</ul>
      <div class="svc-foot"><span class="muted small">30-day free trial</span>
        ${p.id === k?.plan ? html`<span class="chip ok">Your plan</span>` : when(isOrgAdmin(), html`<button class="btn btn-sm btn-soft" data-act="nb-set-kind" data-kind="${p.id}">Start free trial</button>`)}</div>
    </section>`)}</div>
    <p class="fineprint">Single businesses stay free. Cancel anytime: your data is never locked or deleted, and you can always export it.</p>`;
}
on('plan-request', async (ds) => {
  const p = S.plans.find((x) => x.id === ds.plan);
  if (!(await confirmDialog(`Activate ${p.name}?`, "We'll match your payment and turn the plan on within 1 business day. You'll get a notification when it's active.", { confirmLabel: 'Send', danger: false }))) return;
  try { await db.requestPlan(S.org.id, ds.plan); toast("Thanks! We'll confirm and activate your plan within 1 business day."); } catch (e) { toastError(e); }
});
on('plan-checkout', async (ds) => {
  const months = Number(document.querySelector(`[data-months="${ds.plan}"]`)?.value || 1);
  try { location.href = await db.startCheckout(S.org.id, ds.plan, months); } catch (e) { toastError(e); }
});
