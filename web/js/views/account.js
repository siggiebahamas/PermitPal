// Notifications, History, Trash, Team, Settings (profile, reminders, workspace, billing, data).
import {
  html, fmtDate, fmtDateTime, timeAgo, peso, plural, toast, toastError, confirmDialog, openModal, formObject, when,
  normalizePhone, todayPH,
} from '../util.js';
import {
  S, on, reload, rerender, canEdit, isOrgAdmin, isOwner, memberName, empty, effectivePlan, ROLES, business, vehicle, person, has,
} from '../core.js';
import { handledCount } from './assign.js';
import { avatar, ICON } from '../components.js';
import { KINDS, teamAccess, connectionsCard } from './network.js';
import { mfaSection, requireCard } from './mfa.js';
import { addonSection, wireAddons, showBrandCard } from './plus.js';
import { brandPage, brandTabShown } from './brand.js';
import { billToggle, freeCard, planCard, plansShown, PLANS, compareTable } from './pricing.js';
import { planTotal } from '../prices.js';
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
      <select id="hist-show" aria-label="Show">${HIST_SHOW.map(([k, label]) => html`<option value="${k}" ${k === histShow ? 'selected' : ''}>${label}</option>`)}</select>
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
  // Who is on the team right now (someone may have joined or left since the app loaded, including PermitPal for a set-up job).
  try {
    const [members, care] = await Promise.all([db.loadMembers(S.org.id), has('revenue') ? db.loadCare(S.org.id) : null]);
    S.data.members = members;
    if (care) S.data.care = care;
  } catch { /* show what we have */ }
  if (!location.hash.startsWith('#/team')) return;
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
        const staff = has('revenue') ? (S.data.care?.staff || []).find((x) => x.user_id === m.user_id) : null;
        return html`<div class="row"><div class="row-main member">${avatar(name, null, 34)}<div><div class="row-title">${name}${me ? ' (you)' : ''}${staff ? html` <span class="tag staff-tag">PermitPal</span>` : ''}</div>
          ${staff ? html`<div class="row-sub">Temporary access for "<a href="#/services/orders/${staff.request_id}">${staff.requirement_name}</a>". Ends automatically when that job is done.</div>` : ''}
          <div class="row-sub">${p.email}${p.role_title ? ' · ' + p.role_title : ''}${has('assign') && handledCount(m.user_id)
            ? html` · <a href="#/compliance?who=${m.user_id === S.user.id ? 'me' : m.user_id}">handles ${plural(handledCount(m.user_id), 'permit')}</a>` : ''}</div></div></div>
          <div class="row-side">${canChange
            ? html`<select data-member-role="${m.user_id}" aria-label="Role">${roleOptions(m.role, isOwner())}</select>
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
            <select name="role" aria-label="Role">${roleOptions('member', false)}</select>
            <button class="btn btn-primary">Send invite</button></form>
          <p class="muted small">They get an email with a link. ${seatsLeft !== null ? `${plural(seatsLeft, 'seat')} left on your plan.` : ''}</p>`}
      ${when(pending.length, html`<h3 class="h4">Pending invites</h3>${pending.map((i) => html`<div class="row"><div class="row-main"><div class="row-title">${i.email}</div>
        <div class="row-sub">${i.role} · expires ${fmtDate(i.expires_at)}</div></div>
        <div class="row-side"><button class="btn btn-sm btn-ghost" data-act="invite-copy" data-token="${i.token}">Copy link</button>
        <button class="btn btn-sm btn-ghost danger" data-act="invite-revoke" data-id="${i.id}">Revoke</button></div></div>`)}`)}
    </section>`)}`);

  el.querySelectorAll('[data-member-role]').forEach((s) => s.addEventListener('change', async () => {
    // A viewer can't handle permits: say what happens to theirs before changing anything.
    const n = has('assign') ? handledCount(s.dataset.memberRole) : 0;
    if (s.value === 'viewer' && n && !(await confirmDialog('Make them a viewer?',
      `They handle ${plural(n, 'permit')}. Viewers can only look, so ${n === 1 ? 'it goes' : 'those go'} back to "Nobody" and everyone on the team gets ${n === 1 ? 'its' : 'their'} reminders until you choose someone else.`,
      { confirmLabel: 'Make viewer', danger: false }))) { rerender(); return; }
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
  const n = has('assign') ? handledCount(ds.id) : 0;
  if (!(await confirmDialog(`Remove ${ds.name}?`, `They lose access to this workspace immediately. Their past changes stay in History.${n
    ? ` They handle ${plural(n, 'permit')}: ${n === 1 ? 'it goes' : 'those go'} back to "Nobody", and everyone on the team gets ${n === 1 ? 'its' : 'their'} reminders until you choose someone else.` : ''}`, { confirmLabel: 'Remove' }))) return;
  try { await db.removeMember(S.org.id, ds.id); await reload(); toast('Removed.'); } catch (e) { toastError(e); }
});
on('member-leave', async () => {
  if (!(await confirmDialog(`Leave ${S.org.name}?`, "You'll lose access until someone invites you again.", { confirmLabel: 'Leave' }))) return;
  try { await db.removeMember(S.org.id, S.user.id); location.hash = '#/'; location.reload(); } catch (e) { toastError(e); }
});

// ================================================================ settings
const settingsNav = () => html`<nav class="subnav"><a href="#/settings">Profile & reminders</a><a href="#/settings/billing">Plan</a>${brandTabShown() ? html`<a href="#/settings/brand">Your brand</a>` : ''}<a href="#/settings/workspace">Workspace & data</a></nav>`;
const markNav = (el) => el.querySelectorAll('.subnav a').forEach((a) => { if (a.getAttribute('href') === location.hash.split('?')[0]) a.classList.add('active'); });

export async function settings(el, section) {
  if (section === 'brand' && brandTabShown()) return brandPage(el, settingsNav());
  const p = S.profile;
  const prefs = S.prefs || {};
  let channels = {};
  let log = [];
  let conn = '';
  let pay = {};
  let access = [];
  try {
    [channels, log, conn, pay, access] = await Promise.all([
      db.channelStatus().catch(() => ({})),
      db.myDeliveryLog(S.user.id).catch(() => []),
      section === 'workspace' ? connectionsCard() : '',
      section === 'billing' ? db.appSettings().catch(() => ({})) : {},
      section === 'workspace' && has('services') ? db.staffAccessLog(S.org.id).catch(() => []) : [],
    ]);
  } catch { /* shown as empty */ }
  const toggle = (k, label, sub = '', disabled = false) => html`<label class="toggle ${disabled ? 'disabled' : ''}"><div><div>${label}</div>${when(sub, html`<div class="muted small">${sub}</div>`)}</div>
    <input type="checkbox" data-pref="${k}" ${prefs[k] ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span class="switch"></span></label>`;
  const org = S.org;

  el.innerHTML = String(html`
    <div class="page-head"><div><h1>Settings</h1></div></div>
    ${settingsNav()}

    ${when(!section, html`
    <section class="card"><h2>Profile</h2>
      <form id="profile-form">
        <div class="grid2">
          <label class="field"><span>First name</span><input name="first_name" maxlength="80" value="${p.first_name}"></label>
          <label class="field"><span>Last name</span><input name="last_name" maxlength="80" value="${p.last_name}"></label>
          <label class="field"><span>Role / title <small>(optional)</small></span><input name="role_title" maxlength="80" value="${p.role_title}" placeholder="e.g. Fleet head"></label>
          ${when(!has('sms'), html`<label class="field"><span>Mobile number <small>(for SMS / WhatsApp)</small></span><input name="phone" value="${p.phone || ''}" placeholder="0917 123 4567"></label>`)}
        </div>
        <label class="field"><span>Photo <small>(optional)</small></span><input type="file" name="avatar" accept="image/jpeg,image/png,image/webp"></label>
        <p class="muted small">Email: ${p.email}</p>
        <div class="btn-row"><button class="btn btn-primary">Save profile</button><button type="button" class="btn btn-ghost" data-act="change-password">Change password</button></div>
      </form>
    </section>

    <section class="card"><h2>Reminders</h2>
      <p class="muted small">We remind you 30 days, 7 days and 1 day before something expires, then weekly while it's overdue. Times are Philippine time (about 7am).</p>
      ${toggle('email_enabled', 'Email', channels.email === false ? 'Email sending is being set up — reminders show here in the app meanwhile.' : p.email)}
      <h3 class="h4">What to remind me about</h3>
      ${toggle('business_alerts', 'Business permits')}
      ${toggle('vehicle_alerts', 'Vehicle registration and insurance')}
      ${toggle('remind_30', '30 days before')}${toggle('remind_7', '7 days before')}${toggle('remind_1', '1 day before')}
      ${toggle('weekly_digest', 'Monday summary email')}
    </section>
    ${when(has('revenue'), html`<section class="card"><h2>Suggestions</h2>
      <label class="toggle"><div><div>Show partner firms on renewal checklists</div><div class="muted small">At most one partner firm on a checklist step, labelled "Partner". Firms pay PermitPal to be listed there.</div></div>
        <input type="checkbox" data-profile-pref="show_partner_offers" ${p.show_partner_offers !== false ? 'checked' : ''}><span class="switch"></span></label></section>`)}
    ${when(has('sms'), smsSection(channels))}
    ${when(has('mfa'), html`<section class="card" id="mfa-section"><h2>Two-step login</h2><p class="muted">Loading…</p></section>`)}

    <section class="card"><h2>Delivery log</h2>
      <p class="muted small">Proof of every reminder we sent you (or tried to).</p>
      ${log.length ? html`<div class="table-wrap"><table class="table log-table"><thead><tr><th>When</th><th>Channel</th><th>Message</th><th>Status</th></tr></thead><tbody>
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
    ${requireCard()}
    <section class="card"><h2>Workspace</h2>
      <form id="org-form" class="inline-form"><input name="name" aria-label="Workspace name" maxlength="120" value="${org.name}" ${isOrgAdmin() ? '' : 'disabled'}>
        ${when(isOrgAdmin(), html`<button class="btn btn-primary">Rename</button>`)}</form>
      ${when(S.orgs.length > 1, html`<h3 class="h4">Switch workspace</h3>${S.orgs.map((o) => html`<div class="row"><div class="row-main"><div class="row-title">${o.name}</div><div class="row-sub">${o.role}</div></div>
        <div class="row-side">${o.id === org.id ? html`<span class="tag">Current</span>` : html`<button class="btn btn-sm btn-soft" data-act="switch-org" data-id="${o.id}">Switch</button>`}</div></div>`)}`)}
      <p><button class="btn btn-ghost" data-act="new-org">+ Create another workspace</button>
        <span class="muted small">Useful if you manage permits for several separate companies or clients.</span></p>
    </section>

    ${when(has('assign'), html`<section class="card"><h2>Alerts about permits other people handle</h2>
      <p class="muted small">When you give a permit to a teammate, they get its reminders. Owners and admins also get an alert if they haven't started it in time,
        and every week once it's overdue.</p>
      <form id="esc-form" class="inline-form"><label class="sr-only" for="esc-days">Alert owners and admins</label>
        <select id="esc-days" name="days" ${isOrgAdmin() ? '' : 'disabled'}>
          ${[[3, '3 days before it is due'], [7, '7 days before it is due'], [14, '14 days before it is due'], [30, '30 days before it is due'], ['', 'Only once it is overdue']]
            .map(([v, l]) => html`<option value="${v}" ${String(org.escalate_days ?? '') === String(v) ? 'selected' : ''}>${l}</option>`)}</select>
        ${when(isOrgAdmin(), html`<button class="btn btn-primary">Save</button>`)}</form>
      ${when(!isOrgAdmin(), html`<p class="muted small">Only owners and admins can change this.</p>`)}
    </section>`)}

    <section class="card"><div class="card-head"><div><h2>What this workspace is for</h2><p class="card-sub">Team types add a board for everything you're responsible for. 30-day free trial.</p></div></div>
      <form id="kind-form">${Object.entries(KINDS).filter(([k, v]) => !v.hidden || org.kind === k).map(([k, v]) => html`<label class="radio-card ${org.kind === k ? 'on' : ''}"><input type="radio" name="kind" value="${k}" ${org.kind === k ? 'checked' : ''} ${isOrgAdmin() ? '' : 'disabled'}>
        <span><b>${v.title}</b><small>${k === 'business' ? 'Free. Track your own permits, vehicles and staff licenses.' : v.pitch}</small></span></label>`)}
        ${when(isOrgAdmin(), html`<button class="btn btn-primary">Save</button>`)}</form>
    </section>

    ${conn}

    <section class="card"><h2>Language</h2>
      <div class="btn-row"><button class="btn ${p.lang === 'en' ? 'btn-primary' : 'btn-ghost'}" data-act="lang" data-lang="en">English</button>
      <button class="btn ${p.lang === 'tl' ? 'btn-primary' : 'btn-ghost'}" data-act="lang" data-lang="tl">Tagalog</button></div>
      <p class="muted small">Tagalog covers the menus for now; more screens will follow.</p>
    </section>

    ${when(has('services'), html`<section class="card" id="staff-access"><div class="card-head"><div><h2>Who at PermitPal opened your files</h2>
      <p class="card-sub">PermitPal staff can only open a permit's files while you have an open done-for-you request for it, and every open is listed here. It can't be edited or erased.</p></div></div>
      ${access.length ? access.map((x) => html`<div class="line"><span class="line-main"><b>${x.file_name}</b>
        <small>${x.staff_name} · ${fmtDateTime(x.created_at)} · ${x.reason}</small></span></div>`)
        : html`<p class="muted">No one at PermitPal has opened your files.</p>`}
    </section>`)}

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

  markNav(el);
  mfaSection(el.querySelector('#mfa-section'));
  el.querySelectorAll('[data-profile-pref]').forEach((i) => i.addEventListener('change', async () => {
    try { await db.updateProfile(S.user.id, { [i.dataset.profilePref]: i.checked }); S.profile[i.dataset.profilePref] = i.checked; toast('Saved.'); } catch (e) { i.checked = !i.checked; toastError(e); }
  }));
  el.querySelectorAll('[data-pref]').forEach((i) => i.addEventListener('change', async () => {
    try { await db.updatePrefs(S.user.id, { [i.dataset.pref]: i.checked }); S.prefs[i.dataset.pref] = i.checked; toast('Saved.'); } catch (e) { i.checked = !i.checked; toastError(e); }
  }));
  if (section === 'billing') { wireAddons(el); showBrandCard(el); }
  const pf = el.querySelector('#profile-form');
  if (pf) pf.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(pf);
    const f = formObject(fd);
    const hasPhone = fd.has('phone'); // with text messages on, the number is managed (and verified) in its own section
    const phone = f.phone ? normalizePhone(f.phone) : null;
    if (f.phone && !phone) return toast('Please enter a valid mobile number, e.g. 0917 123 4567.', 'error');
    try {
      const file = fd.get('avatar');
      if (file && file.size) await db.uploadAvatar(S.user.id, file);
      const patch = { first_name: f.first_name, last_name: f.last_name, role_title: f.role_title, ...(hasPhone ? { phone: phone || null } : {}) };
      await db.updateProfile(S.user.id, patch);
      Object.assign(S.profile, patch);
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
  el.querySelector('#esc-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const days = Number(new FormData(e.target).get('days')) || null;
    try {
      await db.setEscalation(org.id, days);
      S.org.escalate_days = days;
      toast(days ? `Owners and admins are alerted ${plural(days, 'day')} before, if it isn't started.` : 'Owners and admins are alerted only once something is overdue.');
    } catch (err) { toastError(err); }
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
  // A property workspace is on Small property (up to 20 tenants) or Mall & property.
  const planId = org.kind === 'property' && org.plan_id === 'property_s' ? 'property_s' : k?.plan;
  const plan = S.plans.find((p) => p.id === planId);
  const price = (id) => Number(S.plans.find((p) => p.id === id)?.price_php_monthly || 0);
  const choices = org.kind === 'property' ? ['property_s', 'property'] : [k?.plan];
  const status = org.kind === 'business' ? html`<p>This workspace is a <b>single business</b>: PermitPal is <b>free</b>, with no limits on businesses, vehicles or team members.</p>`
    : acc.why === 'plan' ? html`<p>You're on the <b>${plan?.name}</b> plan${org.plan_expires_at ? html`, paid until <b>${fmtDate(org.plan_expires_at.slice(0, 10))}</b>` : ''}.</p>`
    : acc.why === 'trial' ? html`<p>You're on a <b>free trial</b> of ${org.kind === 'property' ? 'the property plans' : plan?.name}: ${plural(acc.days, 'day')} left. Choose how to pay below to keep your board after the trial.</p>`
    : acc.why === 'staff' ? html`<p>Staff access: team tools are on.</p>`
    : html`<p>Your free trial has ended. Your data is safe; pay below to open your board again.</p>`;
  const cta = (id) => {
    if (acc.why === 'plan' && id === planId) return html`<span class="chip ok">Your plan</span>`;
    if (PLANS[id].kind === org.kind) return html`<span class="chip progress">${acc.why === 'trial' ? 'In your free trial' : 'Pay for it above'}</span>`;
    if (!isOrgAdmin()) return '';
    return html`<button class="btn btn-primary btn-block" data-act="nb-set-kind" data-kind="${PLANS[id].kind}">Try free for 30 days</button>`;
  };
  return html`<section class="card"><h2>Your plan</h2>${status}
      ${org.kind !== 'business' && plan && acc.why !== 'plan' && acc.why !== 'staff'
        ? choices.map((id) => S.plans.find((p) => p.id === id)).filter(Boolean).map((p) => html`${choices.length > 1 ? html`<h3 class="h4 pay-for">${p.name}: ${PLANS[p.id]?.who.split(': ')[1] || ''}</h3>` : ''}${payBox(p, pay)}`) : ''}</section>
    <h3 class="section-label">Plans</h3>
    <p class="pp-lead">Free for your own business, forever. Team plans are for people who look after many businesses, vehicles or tenants.</p>
    ${billToggle('How often to pay for a team plan')}
    <div class="pp-grid four">${freeCard(org.kind === 'business' ? html`<span class="chip ok">Your plan</span>` : '')}
      ${plansShown(S.plans).map((id) => planCard(id, price(id), cta(id), { current: acc.why === 'plan' ? id === planId : PLANS[id].kind === org.kind, trialLine: PLANS[id].kind !== org.kind }))}</div>
    ${compareTable(plansShown(S.plans))}
    <p class="fineprint">Single businesses stay free. Nothing is charged by itself, and you can stop anytime: your data is never locked or deleted, and you can always export it.</p>
    ${addonSection(pay)}`;
}
// Paying for the team plan: a month, or a year with 2 months free.
function payBox(p, pay) {
  const m = Number(p.price_php_monthly);
  const y = planTotal(m, 12);
  const online = pay.online_payments === 'on' && isOwner();
  return html`<div class="plan-pay">
    <div class="pay-choice">
      <div class="pay-opt"><span class="pay-opt-t">1 month</span><b>${peso(m)}</b><small>less than ${peso(Math.floor((m * 12) / 365) + 1)} a day</small></div>
      <div class="pay-opt best"><span class="pp-ribbon">2 months FREE</span><span class="pay-opt-t">12 months</span><b>${peso(y)}</b><small><s>${peso(m * 12)}</s> · you save ${peso(m * 2)}</small></div>
    </div>
    ${online ? html`<div class="btn-row">
        ${has('yearly') ? html`<button class="btn btn-primary" data-act="plan-checkout" data-plan="${p.id}" data-months="12">Pay ${peso(y)} for 12 months</button>` : ''}
        <button class="btn ${has('yearly') ? 'btn-soft' : 'btn-primary'}" data-act="plan-checkout" data-plan="${p.id}" data-months="1">Pay ${peso(m)} for 1 month</button></div>
        <p class="muted small">GCash, Maya or card.</p>`
      : html`${when(pay.gcash_number || pay.bank_account_number, html`<div class="paywiths">
          ${when(pay.gcash_number, html`<div class="paywith"><b>GCash</b><span>${pay.gcash_number}${pay.gcash_name ? ' · ' + pay.gcash_name : ''}</span></div>`)}
          ${when(pay.bank_account_number, html`<div class="paywith"><b>${pay.bank_name || 'Bank transfer'}</b><span>${pay.bank_account_number}${pay.bank_account_name ? ' · ' + pay.bank_account_name : ''}</span></div>`)}</div>`)}
        <p class="muted small">${pay.payment_note || `Send ${peso(m)} for a month or ${peso(y)} for a year, then press the button. We turn your plan on within 1 business day.`}</p>
        ${when(isOrgAdmin(), html`<button class="btn btn-primary" data-act="plan-request" data-plan="${p.id}">I've paid: turn on ${p.name}</button>`)}`}
  </div>`;
}
on('plan-request', (ds) => {
  const p = S.plans.find((x) => x.id === ds.plan);
  const m = Number(p.price_php_monthly);
  const y = planTotal(m, 12);
  openModal(`Turn on ${p.name}`, html`<p>What did you pay for?</p>
    <div class="radio-cards">
      <label class="radio-card on"><input type="radio" name="months" value="12" checked><span><b>12 months: ${peso(y)}</b><small>2 months free</small></span></label>
      <label class="radio-card"><input type="radio" name="months" value="1"><span><b>1 month: ${peso(m)}</b></span></label></div>
    <p class="muted small">We match your payment and turn the plan on within 1 business day. You get a notification when it's on.</p>`, {
    submitLabel: 'Send', danger: false,
    onSubmit: async (fd) => {
      const months = Number(fd.get('months'));
      await db.requestPlan(S.org.id, ds.plan, months === 12 ? `Paid for 12 months (${peso(y)}, 2 months free)` : `Paid for 1 month (${peso(m)})`);
      toast("Thanks! We'll confirm and turn your plan on within 1 business day.");
    },
  });
});
on('plan-checkout', async (ds) => {
  try { location.href = await db.startCheckout(S.org.id, ds.plan, Number(ds.months || 1)); } catch (e) { toastError(e); }
});

// ---------------------------------------------------------------- text messages
// A number gets texts only after the person types back the code we text to it, so reminders never go to
// a mistyped or someone else's number. Texts cost money, so they come with team plans and are capped.
const fmtPhone = (p) => (p ? String(p).replace(/^\+63(\d{3})(\d{3})(\d{4})$/, '0$1 $2 $3') : '');
let smsStep = null; // { phone } while waiting for the code
let smsChanging = false; // "Change number" pressed: the old number keeps working until the new one is verified
window.addEventListener('hashchange', () => { smsChanging = false; });
function smsSection(channels) {
  const p = S.profile;
  const plan = effectivePlan();
  const verified = p.phone && p.phone_verified_at;
  const on = !!S.prefs?.sms_enabled;
  let body;
  if (channels.sms === false) body = html`<p class="muted">Text reminders are being set up. Email and in-app reminders work meanwhile.</p>`;
  else if (!plan?.paid_channels) {
    body = html`<p class="muted">Text reminders come with team plans (Accounting firm, Fleet, Property). On ${plan?.name || 'your'} plan you get email and in-app reminders.</p>
      ${when(isOwner(), html`<a class="btn btn-sm btn-soft" href="#/settings/billing">See plans</a>`)}`;
  } else if (smsStep) {
    body = html`<form id="sms-code" class="sms-form">
      <p>We texted a 6-digit code to <b>${fmtPhone(smsStep.phone)}</b>. It works for 10 minutes.</p>
      <label class="field"><span>Code</span><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" pattern="[0-9 ]*" required placeholder="123456"></label>
      <div class="btn-row"><button class="btn btn-primary">Verify</button>
        <button type="button" class="btn btn-ghost" data-act="sms-resend" ${smsStep.wait ? 'disabled' : ''}>${smsStep.wait ? `Send again in ${smsStep.wait}s` : 'Send the code again'}</button>
        <button type="button" class="linklike" data-act="sms-change">Wrong number?</button></div>
      <p class="muted small">No text after a few minutes? Check the number, and that the phone has signal.</p></form>`;
  } else if (verified && !smsChanging) {
    body = html`<p class="sms-verified">${ICON.check} Texts go to <b>${fmtPhone(p.phone)}</b> <span class="chip ok">Verified</span></p>
      <label class="toggle"><div><div>Send me reminders by text</div><div class="muted small">At most one text a day per workspace (about 7am), listing what's due. Never more than 3 a day.</div></div>
        <input type="checkbox" data-pref="sms_enabled" ${on ? 'checked' : ''}></label>
      <div class="btn-row"><button type="button" class="btn btn-sm btn-ghost" data-act="sms-change">Change number</button>
        <button type="button" class="btn btn-sm btn-ghost danger" data-act="sms-remove">Remove number</button></div>`;
  } else {
    body = html`<form id="sms-start" class="sms-form">
      <p class="muted small">We'll text you a code to make sure the number is yours. Reminders only go to a number that's been checked this way.</p>
      <label class="field"><span>Your mobile number</span><input name="phone" inputmode="tel" autocomplete="tel" required value="${smsChanging ? '' : fmtPhone(p.phone)}" placeholder="0917 123 4567"></label>
      <div class="btn-row"><button class="btn btn-primary">Text me a code</button>
        ${when(verified, html`<button type="button" class="btn btn-ghost" data-act="sms-cancel">Cancel: keep ${fmtPhone(p.phone)}</button>`)}</div></form>`;
  }
  return html`<section class="card" id="sms"><h2>Text messages (SMS)</h2>${body}</section>`;
}
let smsTimer = null;
function countdown() {
  clearInterval(smsTimer);
  smsStep.wait = 60;
  smsTimer = setInterval(() => {
    if (!smsStep) return clearInterval(smsTimer);
    smsStep.wait = Math.max(0, smsStep.wait - 1);
    const b = document.querySelector('[data-act=sms-resend]');
    if (b) { b.disabled = smsStep.wait > 0; b.textContent = smsStep.wait ? `Send again in ${smsStep.wait}s` : 'Send the code again'; }
    if (!smsStep.wait) clearInterval(smsTimer);
  }, 1000);
}
async function sendCode(phone) {
  const res = await db.startPhoneVerification(phone);
  smsStep = { phone: res.phone };
  countdown();
  rerender();
  toast('Code sent. Check your text messages.');
}
document.addEventListener('submit', async (e) => {
  const f = e.target;
  if (f.id !== 'sms-start' && f.id !== 'sms-code') return;
  e.preventDefault();
  const btn = f.querySelector('button:not([type=button])');
  btn.disabled = true;
  try {
    if (f.id === 'sms-start') {
      const phone = normalizePhone(new FormData(f).get('phone'));
      if (!phone || !/^\+639\d{9}$/.test(phone)) throw new Error('Enter a Philippine mobile number, like 0917 123 4567.');
      await sendCode(phone);
    } else {
      const code = String(new FormData(f).get('code') || '').replace(/\D/g, '');
      if (code.length !== 6) throw new Error('The code has 6 digits.');
      const phone = await db.confirmPhoneCode(code);
      smsStep = null; smsChanging = false; clearInterval(smsTimer);
      Object.assign(S.profile, { phone, phone_verified_at: new Date().toISOString() });
      S.prefs.sms_enabled = true;
      await reload();
      toast('Number verified. Reminders will also come by text.');
    }
  } catch (err) { toastError(err); btn.disabled = false; }
});
on('sms-resend', async () => { try { await sendCode(smsStep.phone); } catch (e) { toastError(e); } });
on('sms-change', () => { smsStep = null; clearInterval(smsTimer); smsChanging = true; rerender(); });
on('sms-cancel', () => { smsChanging = false; rerender(); });
on('sms-remove', async () => {
  if (!(await confirmDialog('Remove your mobile number?', 'Text reminders stop. Email and in-app reminders carry on.', { confirmLabel: 'Remove number' }))) return;
  try { await db.removePhone(); Object.assign(S.profile, { phone: null, phone_verified_at: null }); S.prefs.sms_enabled = false; rerender(); toast('Number removed. No more texts.'); } catch (e) { toastError(e); }
});
