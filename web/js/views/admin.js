// PermitPal staff console: workspaces and plans (team tools revenue), listed professionals and the
// quote requests (leads) sent to them, payment details for plans, and the email log.
// Only accounts with profiles.is_platform_admin can load any of this (enforced in the database).
import { html, fmtDate, fmtDateTime, timeAgo, toast, toastError, when, peso } from '../util.js';
import { S, on, rerender, empty } from '../core.js';
import { PARTNER_CATEGORIES } from './extras.js';
import * as db from 'pp/data';

let tab = 'inbox';
const KIND_NAMES = { business: 'Business', head_office: 'Head office', firm: 'Accounting firm', property: 'Property', fleet: 'Fleet' };

export async function admin(el) {
  if (!S.profile?.is_platform_admin) { el.innerHTML = String(empty('Staff only', 'This page is for the PermitPal team.')); return; }
  el.innerHTML = String(html`<div class="loading">Loading…</div>`);
  const tabBtn = (k, l) => html`<button class="tab ${tab === k ? 'active' : ''}" data-act="admin-tab" data-tab="${k}">${l}</button>`;
  let body = '';
  try {
    if (tab === 'orgs') { const [list, kinds] = await Promise.all([db.adminOrgs(), db.adminOrgKinds()]); body = orgsTab(list, kinds); }
    else if (tab === 'partners') body = partnersTab(await db.adminPartners());
    else if (tab === 'referrals') body = referralsTab(await db.adminReferrals());
    else if (tab === 'payments') body = settingsTab(await db.adminSettings());
    else if (tab === 'inbox') body = inboxTab(await db.adminSupportMessages());
    else body = outboxTab(await db.adminOutbox(), await db.channelStatus().catch(() => ({})));
  } catch (e) { toastError(e); }
  el.innerHTML = String(html`
    <div class="page-head"><div><h1>PermitPal admin</h1><p class="muted">Staff tools. Customers never see this page.</p></div></div>
    <div class="tabs">${tabBtn('inbox', 'Inbox')}${tabBtn('orgs', 'Workspaces & plans')}${tabBtn('partners', 'Professionals')}${tabBtn('referrals', 'Quote requests')}
      ${tabBtn('payments', 'Payment details')}${tabBtn('outbox', 'Messages')}</div>
    ${body}`);
  wire(el);
}
on('admin-tab', (ds) => { tab = ds.tab; rerender(); });

function orgsTab(list, kinds) {
  const k = Object.fromEntries((kinds || []).map((o) => [o.id, o]));
  const now = new Date().toISOString();
  const price = (id) => Number(S.plans.find((p) => p.id === id)?.price_php_monthly || 0);
  const paying = list.filter((o) => !o.deleted_at && price(o.plan_id) > 0 && (!o.plan_expires_at || o.plan_expires_at > now));
  const trials = list.filter((o) => k[o.id]?.trial_ends_at > now && !paying.includes(o));
  return html`<div class="stats four">
      <div class="stat ok"><div class="stat-n">${peso(paying.reduce((t, o) => t + price(o.plan_id), 0))}</div><div class="stat-l">Monthly revenue</div></div>
      <div class="stat progress"><div class="stat-n">${paying.length}</div><div class="stat-l">Paying workspaces</div></div>
      <div class="stat soon"><div class="stat-n">${trials.length}</div><div class="stat-l">On free trial</div></div>
      <div class="stat"><div class="stat-n">${list.filter((o) => !o.deleted_at).length}</div><div class="stat-l">All workspaces</div></div></div>
    <section class="card"><p class="muted small">After a customer pays for a plan, set it here (leave "until" blank for no end date).</p>
    <div class="table-wrap"><table class="table"><thead><tr><th>Workspace</th><th>Type</th><th>Owner</th><th>Size</th><th>Trial</th><th>Plan</th></tr></thead><tbody>
    ${list.map((o) => html`<tr class="${o.deleted_at ? 'muted' : ''}"><td>${o.name}${o.deleted_at ? ' (deleting)' : ''}</td>
      <td>${KIND_NAMES[k[o.id]?.kind || 'business']}</td>
      <td>${o.owner_email || '—'}</td><td>${o.businesses} biz · ${o.vehicles} veh · ${o.members} ppl</td>
      <td>${k[o.id]?.trial_ends_at ? (k[o.id].trial_ends_at > now ? 'until ' + fmtDate(k[o.id].trial_ends_at.slice(0, 10)) : 'ended') : '—'}</td>
      <td><form class="inline-form plan-form" data-id="${o.id}"><select name="plan">${S.plans.filter((p) => p.available !== false || p.id === o.plan_id).map((p) => html`<option value="${p.id}" ${p.id === o.plan_id ? 'selected' : ''}>${p.name}</option>`)}</select>
        <input type="date" name="until" value="${o.plan_expires_at ? o.plan_expires_at.slice(0, 10) : ''}" title="Until"><button class="btn btn-sm btn-soft">Set</button></form></td></tr>`)}
    </tbody></table></div></section>`;
}

// ---------------------------------------------------------------- professionals
function partnerForm(p = {}) {
  return html`<form class="admin-partner" data-id="${p.id || ''}"><div class="grid2">
    <label class="field"><span>Name</span><input name="name" required maxlength="160" value="${p.name || ''}"></label>
    <label class="field"><span>Category</span><select name="category">${Object.entries(PARTNER_CATEGORIES).map(([k, v]) => html`<option value="${k}" ${k === p.category ? 'selected' : ''}>${v}</option>`)}</select></label>
    <label class="field"><span>Licence / accreditation <small>(shown)</small></span><input name="licence" maxlength="200" value="${p.licence || ''}" placeholder="e.g. CPA, PRC no. 0123456"></label>
    <label class="field"><span>Cities served <small>(comma separated, shown)</small></span><input name="cities" value="${(p.cities || []).join(', ')}" placeholder="Makati City, Taguig City"></label>
    <label class="field"><span>Fee per quote request (₱) <small>(internal)</small></span><input name="lead_fee_php" type="number" min="0" step="1" value="${p.lead_fee_php ?? ''}"></label>
    <label class="field"><span>Website</span><input name="website" maxlength="300" value="${p.website || ''}" placeholder="https://"></label>
    <label class="field"><span>Shown on permits <small>(type codes, comma separated)</small></span><input name="type_codes" value="${(p.type_codes || []).join(', ')}" placeholder="ctpl, emission_test"></label>
    <label class="field"><span>Contact person <small>(internal)</small></span><input name="contact_name" maxlength="120" value="${p.contact_name || ''}"></label>
    <label class="field"><span>Phone <small>(internal)</small></span><input name="contact_phone" maxlength="60" value="${p.contact_phone || ''}"></label>
    <label class="field"><span>Email <small>(internal)</small></span><input name="contact_email" maxlength="160" value="${p.contact_email || ''}"></label>
    <label class="field"><span>Agreement notes <small>(internal, never shown)</small></span><input name="commission_terms" maxlength="500" value="${p.commission_terms || ''}" placeholder="e.g. ₱500 per lead, billed monthly"></label></div>
    <label class="field"><span>What they handle <small>(shown)</small></span><input name="services" maxlength="600" value="${p.services || ''}" placeholder="Mayor's Permit renewal, barangay clearance, FSIC filing"></label>
    <label class="field"><span>Description</span><textarea name="description" rows="2" maxlength="600">${p.description || ''}</textarea></label>
    <div class="btn-row"><label class="check"><input type="checkbox" name="published" ${p.published ? 'checked' : ''}> Show to customers</label>
      <label class="check"><input type="checkbox" name="verified" ${p.verified ? 'checked' : ''}> Licence checked <small class="muted">(only after seeing their permit and licence)</small></label>
      <button class="btn btn-sm btn-primary">${p.id ? 'Save' : 'Add professional'}</button></div></form>`;
}
function partnersTab(list) {
  return html`<section class="card"><h2>Add a professional</h2><p class="muted small">List only registered firms. Tick "Licence checked" after you've seen their business permit and, for accountants, their PRC licence. Quote requests are emailed to their email below.</p>${partnerForm()}</section>
    ${list.map((p) => html`<section class="card"><div class="card-head"><h2>${p.name}</h2><span class="chip ${p.published ? 'ok' : 'needinfo'}">${p.published ? 'Live' : 'Hidden'}</span></div>${partnerForm(p)}</section>`)}`;
}

// ---------------------------------------------------------------- quote requests (leads) and fees
function referralsTab(list) {
  const c = (r) => (Array.isArray(r.referral_commissions) ? r.referral_commissions[0] : r.referral_commissions) || {};
  const sum = (st) => list.filter((r) => c(r).status === st).reduce((t, r) => t + Number(c(r).amount_php || 0), 0);
  const month = new Date().toISOString().slice(0, 7);
  return html`<div class="stats four">
      <div class="stat progress"><div class="stat-n">${list.filter((r) => r.created_at.slice(0, 7) === month).length}</div><div class="stat-l">Requests this month</div></div>
      <div class="stat soon"><div class="stat-n">${peso(sum('expected'))}</div><div class="stat-l">To bill</div></div>
      <div class="stat ok"><div class="stat-n">${peso(sum('earned'))}</div><div class="stat-l">Billed, not paid</div></div>
      <div class="stat ok"><div class="stat-n">${peso(sum('paid'))}</div><div class="stat-l">Received</div></div></div>
    <p class="muted small">Each request is emailed straight to the firm. Bill each firm monthly for its requests.</p>
    ${list.length ? html`<section class="card">${list.map((r) => html`<form class="admin-ref line-form" data-id="${r.id}">
      <div class="line-main"><b>${r.partners?.name} ← ${r.orgs?.name}</b><small>${r.contact_method}${r.contact_value ? ': ' + r.contact_value : ''} · ${timeAgo(r.created_at)}${r.note ? ' · ' + r.note : ''}</small></div>
      <select name="status">${['requested', 'introduced', 'converted', 'not_converted'].map((k) => html`<option value="${k}" ${k === r.status ? 'selected' : ''}>${{ requested: 'Sent', introduced: 'Firm replied', converted: 'Hired', not_converted: 'Closed' }[k]}</option>`)}</select>
      <input name="amount" type="number" min="0" step="0.01" value="${c(r).amount_php ?? 0}" title="Fee ₱">
      <select name="cstatus">${['expected', 'earned', 'paid', 'none'].map((k) => html`<option value="${k}" ${k === c(r).status ? 'selected' : ''}>${{ expected: 'To bill', earned: 'Billed', paid: 'Paid', none: 'No fee' }[k]}</option>`)}</select>
      <button class="btn btn-sm btn-soft">Save</button></form>`)}</section>` : empty('No quote requests yet', 'Requests customers send to listed professionals appear here.')}`;
}

// ---------------------------------------------------------------- payment details
function settingsTab(st) {
  const f = (k, label, ph = '') => html`<label class="field"><span>${label}</span><input name="${k}" value="${st[k] || ''}" maxlength="500" placeholder="${ph}"></label>`;
  return html`<section class="card"><h2>How customers pay for team plans</h2><p class="muted small">Shown when someone chooses a plan and online payment is off. After they pay, set their plan under Workspaces.</p><form class="admin-settings">
    <div class="grid2">${f('gcash_name', 'GCash account name')}${f('gcash_number', 'GCash number', '0917 123 4567')}
      ${f('bank_name', 'Bank', 'e.g. BPI')}${f('bank_account_name', 'Account name')}${f('bank_account_number', 'Account number')}
      ${f('support_phone', 'Support phone')}${f('support_email', 'Support email')}</div>
    ${f('payment_note', 'Note shown under the payment details')}
    <label class="check"><input type="checkbox" name="online_payments" ${st.online_payments === 'on' ? 'checked' : ''}> Show "Pay online" (only after PayMongo keys are added to Supabase)</label>
    <button class="btn btn-primary">Save</button></form></section>`;
}

const TOPIC_NAMES = { question: 'Question', problem: 'Something is not working', billing: 'Plans & payment', privacy: 'Privacy / my data', other: 'Other' };
function inboxTab(list) {
  const open = list.filter((m) => m.status === 'open');
  const row = (m) => html`<div class="inbox-item ${m.status}">
    <div class="inbox-top"><b>${TOPIC_NAMES[m.topic] || m.topic}</b>${when(m.topic === 'privacy', html`<span class="chip progress">Privacy request</span>`)}
      <span class="muted small">${timeAgo(m.created_at)}</span></div>
    <div class="muted small">${m.name ? m.name + ' · ' : ''}<a href="mailto:${m.email}">${m.email}</a>${m.orgs?.name ? ' · ' + m.orgs.name : ''}${m.user_id ? '' : ' · no account'}</div>
    <p class="inbox-msg">${m.message}</p>
    <div class="btn-row"><a class="btn btn-sm btn-primary" href="mailto:${m.email}?subject=${encodeURIComponent('Re: your message to PermitPal')}">Reply by email</a>
      <button class="btn btn-sm btn-ghost" data-act="admin-support-status" data-id="${m.id}" data-status="${m.status === 'open' ? 'closed' : 'open'}">${m.status === 'open' ? 'Mark done' : 'Reopen'}</button></div></div>`;
  return html`<section class="card"><div class="card-head"><div><h2>Inbox</h2><p class="card-sub">Messages from the Contact PermitPal form. Each one is also emailed to you. Reply to privacy requests first.</p></div>
      <span class="chip ${open.length ? 'progress' : 'ok'}">${open.length} open</span></div>
    ${list.length ? list.map(row) : html`<p class="muted">No messages yet.</p>`}</section>`;
}
on('admin-support-status', async (ds) => {
  try { await db.adminSetSupportStatus(ds.id, ds.status); toast(ds.status === 'closed' ? 'Marked done.' : 'Reopened.'); rerender(); } catch (e) { toastError(e); }
});

function outboxTab(list, channels = {}) {
  return html`<section class="card"><div class="card-head"><div><h2>Email reminders</h2>
      <p class="card-sub">${channels.email ? 'Connected: reminders are going out.' : 'Not connected: customers only see reminders inside the app.'}</p></div>
      <span class="chip ${channels.email ? 'ok' : 'overdue'}">${channels.email ? 'On' : 'Off'}</span></div>
    ${when(!channels.email, html`<ol class="small setup-steps">
      <li>Create a free account at resend.com (3,000 emails a month) and verify your domain.</li>
      <li>Supabase → Edge Functions → Secrets: add <b>RESEND_API_KEY</b> and <b>EMAIL_FROM</b> (e.g. PermitPal &lt;reminders@yourdomain.ph&gt;).</li>
      <li>Supabase → Authentication → Emails → SMTP: use the same Resend details so sign-up emails arrive too.</li>
      <li>Press the button below. You should get an email within a minute.</li></ol>`)}
    <button class="btn btn-soft btn-sm" data-act="admin-test-email">Send me a test email</button></section>
  <section class="card"><p class="muted small">Latest 100 messages. "Skipped" means that channel isn't connected yet.</p>
    <div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Channel</th><th>To</th><th>Subject</th><th>Status</th><th>Error</th></tr></thead><tbody>
    ${list.map((m) => html`<tr><td>${fmtDateTime(m.created_at)}</td><td>${m.channel}</td><td>${m.to_address}</td><td>${m.subject || ''}</td>
      <td><span class="tag ${m.status === 'sent' ? 'green' : m.status === 'failed' ? 'red' : ''}">${m.status}${m.attempts > 1 ? ` ×${m.attempts}` : ''}</span></td><td class="small">${m.last_error || ''}</td></tr>`)}
    </tbody></table></div></section>`;
}

function wire(el) {
  const submit = (sel, fn) => el.querySelectorAll(sel).forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = f.querySelector('button:not([type=button])');
    if (btn) btn.disabled = true;
    try { await fn(f, new FormData(f)); } catch (err) { toastError(err); }
    if (btn) btn.disabled = false;
  }));
  submit('.admin-partner', async (f, fd) => {
    const row = Object.fromEntries(['name', 'category', 'licence', 'website', 'contact_name', 'contact_phone', 'contact_email', 'commission_terms', 'description', 'services'].map((k) => [k, String(fd.get(k) || '').trim()]));
    if (!row.name) throw new Error('Enter the firm name.');
    if (row.website && !/^https:\/\//.test(row.website)) throw new Error('The website must start with https://');
    if (row.contact_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.contact_email)) throw new Error('Enter a valid email: quote requests are sent there.');
    row.type_codes = String(fd.get('type_codes') || '').split(',').map((x) => x.trim()).filter(Boolean);
    row.cities = String(fd.get('cities') || '').split(',').map((x) => x.trim()).filter(Boolean);
    const fee = fd.get('lead_fee_php');
    row.lead_fee_php = fee === '' || fee == null ? null : Number(fee);
    row.published = fd.get('published') === 'on';
    row.verified = fd.get('verified') === 'on';
    await db.adminSavePartner(f.dataset.id || null, row);
    toast('Saved.'); rerender();
  });
  submit('.admin-ref', async (f, fd) => {
    await db.adminSaveReferral(f.dataset.id, fd.get('status'));
    const cs = fd.get('cstatus');
    await db.adminSaveCommission(f.dataset.id, { amount_php: Number(fd.get('amount') || 0), status: cs, paid_at: cs === 'paid' ? new Date().toISOString() : null });
    toast('Saved.');
  });
  submit('.admin-settings', async (f, fd) => {
    for (const k of ['gcash_name', 'gcash_number', 'bank_name', 'bank_account_name', 'bank_account_number', 'support_phone', 'support_email', 'payment_note']) await db.adminSaveSetting(k, String(fd.get(k) || '').trim());
    await db.adminSaveSetting('online_payments', fd.get('online_payments') === 'on' ? 'on' : 'off');
    toast('Saved. Customers see these on their next visit.');
  });
  el.querySelectorAll('.plan-form').forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const until = fd.get('until');
    try { await db.adminSetPlan(f.dataset.id, fd.get('plan'), until ? new Date(until + 'T23:59:59+08:00').toISOString() : null); toast('Plan updated.'); } catch (err) { toastError(err); }
  }));
}

on('admin-test-email', async () => {
  try { await db.adminTestEmail(); toast('Test email queued. Check your inbox, then the list below for its status.'); rerender(); } catch (e) { toastError(e); }
});
