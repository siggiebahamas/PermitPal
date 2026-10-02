// Notifications, History, Trash, Team, Settings (profile, reminders, workspace, billing, data).
import {
  html, fmtDate, fmtDateTime, timeAgo, peso, plural, toast, toastError, confirmDialog, openModal, formObject, when,
  normalizePhone,
} from '../util.js';
import {
  S, on, reload, rerender, canEdit, isOrgAdmin, isOwner, memberName, empty, effectivePlan, ROLES, ENTITY_LABELS, business, vehicle, person,
} from '../core.js';
import { avatar } from '../components.js';
import * as db from 'pp/data';

// ================================================================ notifications
export async function notifications(el) {
  el.innerHTML = String(html`<div class="loading">Loading…</div>`);
  let list = [];
  try { list = await db.listNotifications(); } catch (e) { toastError(e); }
  el.innerHTML = String(html`
    <div class="page-head"><div><h1>Notifications</h1><p class="muted">Reminders and updates. Emails and texts follow your settings.</p></div>
      <div class="btn-row"><button class="btn btn-ghost btn-sm" data-act="notif-all-read">Mark all read</button>
      <button class="btn btn-ghost btn-sm" data-act="notif-clear">Clear all</button></div></div>
    ${list.length ? html`<div class="list">${list.map((n) => html`
      <div class="notif ${n.read_at ? '' : 'unread'} ${n.kind}">
        <a class="row-main" href="${n.link || '#/'}" data-act="notif-open" data-id="${n.id}">
          <div class="row-title">${n.title}</div><div class="row-sub">${n.body || ''}</div><div class="muted small">${timeAgo(n.created_at)}</div></a>
        <button class="icon-btn" data-act="notif-delete" data-id="${n.id}" aria-label="Delete">✕</button>
      </div>`)}</div>` : empty("You're all caught up", "We'll let you know here, and by email, when something needs attention.")}`);
}
on('notif-open', async (ds) => { try { await db.markRead([ds.id]); S.unread = Math.max(0, S.unread - 1); } catch { /* not critical */ } });
on('notif-delete', async (ds) => { try { await db.deleteNotification(ds.id); rerender(); } catch (e) { toastError(e); } });
on('notif-all-read', async () => { try { await db.markAllRead(); S.unread = 0; rerender(); } catch (e) { toastError(e); } });
on('notif-clear', async () => {
  if (!(await confirmDialog('Clear all notifications?', 'This only clears the list here. Your records are not affected.', { confirmLabel: 'Clear' }))) return;
  try { await db.clearNotifications(S.user.id); S.unread = 0; rerender(); } catch (e) { toastError(e); }
});

// ================================================================ history
let histEntity = '';
export async function historyPage(el) {
  el.innerHTML = String(html`<div class="loading">Loading…</div>`);
  let items = [];
  try { items = await db.history(S.org.id, { entity: histEntity || null, limit: 100 }); } catch (e) { toastError(e); }
  el.innerHTML = String(html`
    <div class="page-head"><div><h1>History</h1><p class="muted">Every change by anyone on the team, including deletions. Kept permanently.</p></div>
      <select id="hist-filter"><option value="">Everything</option>${Object.entries(ENTITY_LABELS).map(([k, v]) => html`<option value="${k}" ${k === histEntity ? 'selected' : ''}>${v}</option>`)}</select></div>
    ${items.length ? html`<div class="list">${items.map((a) => html`
      <div class="hist"><span class="tag ${a.action === 'deleted' || a.action === 'removed' ? 'red' : a.action === 'restored' ? 'green' : ''}">${a.action}</span>
        <div>${linkFor(a)}<div class="muted small">${memberName(a.actor_id)} · ${fmtDateTime(a.created_at)}</div></div></div>`)}</div>
      <p class="muted small">Deleted something by mistake? <a href="#/trash">Restore it from Trash.</a></p>`
      : empty('No history yet', 'Changes will show up here.')}`);
  el.querySelector('#hist-filter').addEventListener('change', (e) => { histEntity = e.target.value; historyPage(el); });
}
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
    ${any ? '' : empty('Trash is empty', 'Deleted businesses, vehicles, requirements and files will appear here.')}
    ${section('Businesses', 'businesses', t.businesses, (x) => x.name)}
    ${section('Branches', 'business_locations', t.locations, (x) => `${x.name} (${bizName(x.business_id)})`)}
    ${section('Vehicles', 'vehicles', t.vehicles, (x) => `${x.make_model}${x.plate_no ? ' · ' + x.plate_no : ''}`)}
    ${section('People', 'people', t.people || [], (x) => `${x.full_name}${x.role ? ' · ' + x.role : ''}`)}
    ${section('Requirements', 'requirements', t.requirements, (x) => `${x.name} — ${x.business_id ? bizName(x.business_id) : x.vehicle_id ? vehicle(x.vehicle_id)?.make_model || 'a deleted vehicle' : person(x.person_id)?.full_name || 'a deleted person'}`)}
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
  let access = [];
  try {
    [channels, log, access] = await Promise.all([
      db.channelStatus().catch(() => ({})),
      db.myDeliveryLog(S.user.id).catch(() => []),
      section === 'workspace' ? db.staffAccessLog(S.org.id).catch(() => []) : [],
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
    <section class="card"><h2>Your plan</h2>
      <p>PermitPal is <b>free</b> right now: no limits and no card needed.</p>
      <ul>${(S.plans.find((pl) => pl.id === 'free')?.features || []).map((f) => html`<li>${f}</li>`)}</ul>
      <p class="muted small">If paid plans are introduced later, you'll get plenty of notice and your data will never be locked or deleted.</p>
    </section>`)}

    ${when(section === 'workspace', html`
    <section class="card"><h2>Workspace</h2>
      <form id="org-form" class="inline-form"><input name="name" maxlength="120" value="${org.name}" ${isOrgAdmin() ? '' : 'disabled'}>
        ${when(isOrgAdmin(), html`<button class="btn btn-primary">Rename</button>`)}</form>
      ${when(S.orgs.length > 1, html`<h4>Switch workspace</h4>${S.orgs.map((o) => html`<div class="row"><div class="row-main"><div class="row-title">${o.name}</div><div class="row-sub">${o.role}</div></div>
        <div class="row-side">${o.id === org.id ? html`<span class="tag">Current</span>` : html`<button class="btn btn-sm btn-soft" data-act="switch-org" data-id="${o.id}">Switch</button>`}</div></div>`)}`)}
      <p><button class="btn btn-ghost" data-act="new-org">+ Create another workspace</button>
        <span class="muted small">Useful if you manage permits for several separate companies or clients.</span></p>
    </section>

    <section class="card"><h2>Language</h2>
      <div class="btn-row"><button class="btn ${p.lang === 'en' ? 'btn-primary' : 'btn-ghost'}" data-act="lang" data-lang="en">English</button>
      <button class="btn ${p.lang === 'tl' ? 'btn-primary' : 'btn-ghost'}" data-act="lang" data-lang="tl">Tagalog</button></div>
      <p class="muted small">Tagalog covers the menus for now; more screens will follow.</p>
    </section>

    <section class="card" id="staff-access"><div class="card-head"><div><h2>Who at PermitPal opened your files</h2>
      <p class="card-sub">PermitPal staff can only open a file while you have an open service request for it, and every open is listed here. It can't be edited or erased.</p></div></div>
      ${access.length ? access.map((x) => html`<div class="line"><span class="line-main"><b>${x.file_name}</b>
        <small>${x.staff_name} · ${fmtDateTime(x.created_at)} · ${x.reason}</small></span></div>`)
        : html`<p class="muted">No one at PermitPal has opened your files.</p>`}
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

