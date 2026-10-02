// PermitPal staff console: service orders (quote, payment, progress, finished permit), the service
// catalog and prices, partners and referral commissions, payment details, workspaces and messages.
// Only accounts with profiles.is_platform_admin can load any of this (enforced in the database).
import { html, fmtDate, fmtDateTime, timeAgo, toast, toastError, when, peso, plural, todayPH, confirmDialog } from '../util.js';
import { S, on, rerender, empty } from '../core.js';
import { ORDER_STATUS, PAYMENT_STATUS } from './services.js';
import { PARTNER_CATEGORIES } from './extras.js';
import { ICON } from '../components.js';
import * as db from 'pp/data';

let tab = 'orders';
let openOrder = null;
const STAGES = [
  ['new', 'New: send a quote', (a) => a.status === 'submitted'],
  ['quoted', 'Quoted: waiting for the customer', (a) => a.status === 'quoted'],
  ['pay', 'Payment to check', (a) => a.payment_status === 'pending_verification'],
  ['awaiting', 'Accepted: waiting for payment', (a) => a.payment_status === 'awaiting_payment'],
  ['work', 'In progress', (a) => !['submitted', 'quoted', 'completed', 'cancelled'].includes(a.status)],
];

export async function admin(el) {
  if (!S.profile?.is_platform_admin) { el.innerHTML = String(empty('Staff only', 'This page is for the PermitPal team.')); return; }
  el.innerHTML = String(html`<div class="loading">Loading…</div>`);
  const tabBtn = (k, l) => html`<button class="tab ${tab === k ? 'active' : ''}" data-act="admin-tab" data-tab="${k}">${l}</button>`;
  let body = '';
  try {
    if (tab === 'orders') body = await ordersTab();
    else if (tab === 'services') body = servicesTab(await db.adminServices());
    else if (tab === 'partners') body = partnersTab(await db.adminPartners());
    else if (tab === 'referrals') body = referralsTab(await db.adminReferrals());
    else if (tab === 'payments') body = settingsTab(await db.adminSettings());
    else if (tab === 'orgs') body = orgsTab(await db.adminOrgs());
    else body = outboxTab(await db.adminOutbox(), await db.channelStatus().catch(() => ({})));
  } catch (e) { toastError(e); }
  el.innerHTML = String(html`
    <div class="page-head"><div><h1>PermitPal admin</h1><p class="muted">Staff tools. Customers never see this page.</p></div></div>
    <div class="tabs">${tabBtn('orders', 'Orders')}${tabBtn('services', 'Services & prices')}${tabBtn('partners', 'Partners')}${tabBtn('referrals', 'Referrals')}
      ${tabBtn('payments', 'Payment details')}${tabBtn('orgs', 'Workspaces')}${tabBtn('outbox', 'Messages')}</div>
    ${body}`);
  wire(el);
}
on('admin-tab', (ds) => { tab = ds.tab; openOrder = null; rerender(); });

// ---------------------------------------------------------------- orders
let ordersCache = [];
async function ordersTab() {
  ordersCache = await db.adminRequests();
  const list = ordersCache;
  if (openOrder) {
    const a = list.find((x) => x.id === openOrder);
    if (a) return orderDetail(a, await db.orderEvents(a.id));
  }
  const open = list.filter((a) => !['completed', 'cancelled'].includes(a.status));
  const closed = list.filter((a) => ['completed', 'cancelled'].includes(a.status));
  const revenue = closed.filter((a) => a.status === 'completed' && ['paid', 'waived'].includes(a.payment_status)).reduce((t, a) => t + Number(a.quote_service_fee || 0), 0);
  const line = (a) => html`<button class="line" data-act="admin-order" data-id="${a.id}"><span class="line-main"><b>${a.requirement_name} — ${a.subject_label}</b>
    <small>${a.orgs?.name || ''} · ${timeAgo(a.created_at)}${a.rush ? ' · RUSH' : ''}${a.due_on ? ' · due ' + fmtDate(a.due_on) : ''}${a.quote_php != null ? ' · ' + peso(a.quote_php) : ''}</small></span>
    <span class="chip ${ORDER_STATUS[a.status]?.[1]}">${ORDER_STATUS[a.status]?.[0]}</span></button>`;
  const used = new Set();
  return html`
    <div class="stats four">
      <div class="stat soon"><div class="stat-n">${open.length}</div><div class="stat-l">Open orders</div></div>
      <div class="stat overdue"><div class="stat-n">${open.filter((a) => a.status === 'submitted').length}</div><div class="stat-l">Need a quote</div></div>
      <div class="stat progress"><div class="stat-n">${open.filter((a) => a.payment_status === 'pending_verification').length}</div><div class="stat-l">Payments to check</div></div>
      <div class="stat ok"><div class="stat-n">${peso(revenue)}</div><div class="stat-l">Service fees earned (done)</div></div>
    </div>
    ${STAGES.map(([, title, test]) => {
      const items = open.filter((a) => !used.has(a.id) && test(a));
      items.forEach((a) => used.add(a.id));
      return items.length ? html`<section class="card"><div class="card-head"><h2>${title}</h2><span class="muted small">${items.length}</span></div>${items.map(line)}</section>` : '';
    })}
    ${when(!open.length, empty('No open orders', 'New requests also arrive by email.'))}
    ${when(closed.length, html`<details class="folder"><summary>${plural(closed.length, 'closed order')}</summary>${closed.map(line)}</details>`)}`;
}
on('admin-order', (ds) => { openOrder = ds.id; rerender(); });
on('admin-back', () => { openOrder = null; rerender(); });

function orderDetail(a, events) {
  const closed = ['completed', 'cancelled'].includes(a.status);
  return html`
    <button class="back linklike" data-act="admin-back">← All orders</button>
    <section class="card">
      <div class="card-head"><div><h2>${a.requirement_name} — ${a.subject_label}</h2><p class="card-sub">${a.orgs?.name} · ${a.service_code || 'help request'}${a.rush ? ' · RUSH' : ''}</p></div>
        <span class="chip ${ORDER_STATUS[a.status]?.[1]}">${ORDER_STATUS[a.status]?.[0]}</span></div>
      <dl class="kv">
        <dt>Location</dt><dd>${a.location_label || '—'}</dd>
        <dt>Deadline</dt><dd>${a.due_on ? fmtDate(a.due_on) : '—'}</dd>
        <dt>Documents</dt><dd>${{ have: 'Uploaded in PermitPal', need: 'Customer needs to get them', not_sure: 'Not sure' }[a.docs_status]}</dd>
        <dt>Contact</dt><dd>${a.contact_method}${a.contact_value ? ': ' + a.contact_value : ''}</dd>
        <dt>Notes</dt><dd class="pre">${a.notes || '—'}</dd>
        <dt>Quote</dt><dd>${a.quote_php != null ? html`${peso(a.quote_php)} (fee ${peso(a.quote_service_fee)} + gov ${peso(a.quote_gov_fees)})` : '—'}</dd>
        <dt>Payment</dt><dd>${PAYMENT_STATUS[a.payment_status]}${a.payment_method ? ' · ' + a.payment_method : ''}${a.payment_ref ? ' · ref ' + a.payment_ref : ''}</dd>
        <dt>Received</dt><dd>${fmtDateTime(a.created_at)}</dd>
      </dl>
      ${when(!closed && a.requirement_id, html`<button class="btn btn-sm btn-ghost" data-act="admin-docs" data-id="${a.requirement_id}">Show customer's files</button><div class="admin-docs" data-for="${a.requirement_id}"></div>`)}
    </section>

    ${when(['submitted', 'quoted', 'awaiting_customer'].includes(a.status) && !['paid', 'waived'].includes(a.payment_status), html`<section class="card"><h2>${a.quote_php != null ? 'Change the quote' : 'Send the quote'}</h2>
      <form class="admin-quote" data-id="${a.id}"><div class="grid2">
        <label class="field"><span>Service fee (₱)</span><input name="fee" type="number" min="0" step="0.01" required value="${a.quote_service_fee ?? ''}"></label>
        <label class="field"><span>Government fees, estimate (₱)</span><input name="gov" type="number" min="0" step="0.01" value="${a.quote_gov_fees ?? ''}"></label></div>
        <label class="field"><span>Note to the customer</span><textarea name="note" rows="2" maxlength="2000" placeholder="What's included, documents we need, how long it takes">${a.quote_note || ''}</textarea></label>
        <button class="btn btn-primary">Send quote</button></form></section>`)}

    ${when(a.payment_status === 'pending_verification', html`<section class="card"><h2>Check the payment</h2>
      <p>Customer says they paid <b>${peso(a.quote_php)}</b> by ${a.payment_method}${a.payment_ref ? html`, reference <b>${a.payment_ref}</b>` : ''}. Match it in your GCash / bank app first.</p>
      <div class="btn-row"><button class="btn btn-primary" data-act="admin-pay" data-id="${a.id}" data-ok="1">Payment received</button>
        <button class="btn btn-ghost danger" data-act="admin-pay" data-id="${a.id}" data-ok="">Can't find it</button></div></section>`)}

    ${when(!closed, html`<section class="card"><h2>Update the customer</h2>
      <form class="admin-update" data-id="${a.id}"><div class="grid2">
        <label class="field"><span>Status</span><select name="status"><option value="">Keep: ${ORDER_STATUS[a.status]?.[0]}</option>
          ${['matching', 'provider_contacted', 'awaiting_customer', 'in_progress', 'completed', 'cancelled'].map((k) => html`<option value="${k}">${ORDER_STATUS[k][0]}</option>`)}</select></label>
        <label class="field"><span>Agent / provider <small>(internal)</small></span><input name="provider" maxlength="160" value="${a.provider_name || ''}"></label>
        <label class="field"><span>Government fees actually paid (₱)</span><input name="gov" type="number" min="0" step="0.01" value="${a.gov_fees_actual ?? ''}"></label>
        <label class="field"><span>Attach a file <small>(official receipt, photo)</small></span><input type="file" name="file" accept=".pdf,image/*"></label></div>
        <label class="field"><span>Message</span><textarea name="message" rows="2" maxlength="2000" placeholder="e.g. Filed at Taguig BPLO today. Release expected Friday."></textarea></label>
        <button class="btn btn-soft">Send update</button></form></section>`)}

    ${when(!closed && a.requirement_id, html`<section class="card"><h2>Done: save the new permit to their account</h2>
      <p class="muted small">This records the new permit on the customer's requirement, attaches the file, and closes the order.</p>
      <form class="admin-renewal" data-id="${a.id}"><div class="grid2">
        <label class="field"><span>Reference / permit no.</span><input name="reference_no" maxlength="100" required></label>
        <label class="field"><span>Issued by</span><input name="issuer" maxlength="120"></label>
        <label class="field"><span>Issued on</span><input type="date" name="issued_on" max="${todayPH()}"></label>
        <label class="field"><span>Expires on</span><input type="date" name="expires_on"></label>
        <label class="field"><span>Government fees paid (₱)</span><input name="amount_paid" type="number" min="0" step="0.01"></label>
        <label class="field"><span>The new permit (PDF or photo)</span><input type="file" name="file" accept=".pdf,image/*"></label></div>
        <button class="btn btn-primary">Save permit & complete order</button></form></section>`)}

    ${when(['paid', 'refunded'].includes(a.payment_status), html`<section class="card"><h2>Refund</h2>
      <p class="muted small">Send the money back first (GCash or bank), then record it here. The customer sees it in their order.
        Our promise: if we can't deliver, the service fee is refunded in full; if government fees were lower than quoted, refund the difference.</p>
      <form class="admin-refund" data-id="${a.id}"><div class="grid2">
        <label class="field"><span>Type</span><select name="kind"><option value="fee_difference">Government fees were lower</option><option value="partial">Partial refund</option><option value="full">Full refund (cancels the order)</option></select></label>
        <label class="field"><span>Amount refunded (₱)</span><input name="amount" type="number" min="0.01" step="0.01" required></label>
        <label class="field"><span>Sent by</span><input name="method" maxlength="60" placeholder="GCash / BPI"></label>
        <label class="field"><span>Reference no.</span><input name="reference" maxlength="120"></label></div>
        <label class="field"><span>Reason the customer will see</span><input name="reason" maxlength="500" required placeholder="e.g. The city's fee was ₱700 lower than our estimate."></label>
        <button class="btn btn-soft">Record refund</button></form></section>`)}

    <section class="card"><h2>Timeline</h2><ol class="timeline">${events.map((e) => html`<li class="${e.by_staff ? 'staff' : ''}"><div class="tl-dot"></div><div class="tl-body">
      <div class="tl-head"><b>${e.by_staff ? 'PermitPal' : 'Customer'}</b><span class="muted small">${fmtDateTime(e.created_at)}</span></div>
      ${when(e.message, html`<div class="pre">${e.message}</div>`)}
      ${when(e.file_path, html`<button class="linklike doc-file" data-act="staff-file" data-path="${e.file_path}" data-name="${e.file_name || 'file'}">${ICON.file}${e.file_name || 'file'}</button>`)}</div></li>`)}</ol></section>`;
}
on('admin-pay', async (ds) => {
  try {
    await db.adminConfirmPayment(ds.id, !!ds.ok, ds.ok ? null : 'We could not find this payment. Please check the reference number and send it again.');
    toast(ds.ok ? 'Payment confirmed. The customer was told work has started.' : 'Customer asked to check the payment.');
    rerender();
  } catch (e) { toastError(e); }
});

// ---------------------------------------------------------------- services & prices
function servicesTab(list) {
  return html`<p class="muted small">These are the starting prices customers see. Every order still gets an exact quote from you.</p>
    ${list.map((s) => html`<section class="card"><form class="admin-svc" data-code="${s.code}">
      <div class="card-head"><h2>${s.name}</h2><label class="check"><input type="checkbox" name="active" ${s.active ? 'checked' : ''}> Offered</label></div>
      <div class="grid2">
        <label class="field"><span>Name</span><input name="name" maxlength="120" value="${s.name}"></label>
        <label class="field"><span>Starting price (₱) <small>blank = quoted</small></span><input name="price_from" type="number" min="0" step="1" value="${s.price_from ?? ''}"></label>
        <label class="field"><span>Price unit</span><input name="price_unit" maxlength="60" value="${s.price_unit}"></label>
        <label class="field"><span>Usual turnaround</span><input name="turnaround" maxlength="80" value="${s.turnaround}"></label></div>
      <label class="field"><span>Summary</span><textarea name="summary" rows="2" maxlength="600">${s.summary}</textarea></label>
      <label class="field"><span>What's included <small>(one per line)</small></span><textarea name="includes" rows="3">${s.includes.join('\n')}</textarea></label>
      <button class="btn btn-sm btn-soft">Save</button></form></section>`)}`;
}

// ---------------------------------------------------------------- partners
function partnerForm(p = {}) {
  return html`<form class="admin-partner" data-id="${p.id || ''}"><div class="grid2">
    <label class="field"><span>Name</span><input name="name" required maxlength="160" value="${p.name || ''}"></label>
    <label class="field"><span>Category</span><select name="category">${Object.entries(PARTNER_CATEGORIES).map(([k, v]) => html`<option value="${k}" ${k === p.category ? 'selected' : ''}>${v}</option>`)}</select></label>
    <label class="field"><span>Offer for PermitPal customers</span><input name="offer" maxlength="200" value="${p.offer || ''}" placeholder="e.g. 10% off CTPL"></label>
    <label class="field"><span>Areas served</span><input name="coverage" maxlength="200" value="${p.coverage || ''}" placeholder="e.g. Metro Manila"></label>
    <label class="field"><span>Website</span><input name="website" maxlength="300" value="${p.website || ''}" placeholder="https://"></label>
    <label class="field"><span>Shown on permits <small>(type codes, comma separated)</small></span><input name="type_codes" value="${(p.type_codes || []).join(', ')}" placeholder="ctpl, emission_test"></label>
    <label class="field"><span>Contact person <small>(internal)</small></span><input name="contact_name" maxlength="120" value="${p.contact_name || ''}"></label>
    <label class="field"><span>Phone <small>(internal)</small></span><input name="contact_phone" maxlength="60" value="${p.contact_phone || ''}"></label>
    <label class="field"><span>Email <small>(internal)</small></span><input name="contact_email" maxlength="160" value="${p.contact_email || ''}"></label>
    <label class="field"><span>Commission terms <small>(internal, never shown)</small></span><input name="commission_terms" maxlength="500" value="${p.commission_terms || ''}" placeholder="e.g. 15% of first premium"></label></div>
    <label class="field"><span>Description</span><textarea name="description" rows="2" maxlength="600">${p.description || ''}</textarea></label>
    <div class="btn-row"><label class="check"><input type="checkbox" name="published" ${p.published ? 'checked' : ''}> Show to customers</label>
      <button class="btn btn-sm btn-primary">${p.id ? 'Save' : 'Add partner'}</button></div></form>`;
}
function partnersTab(list) {
  return html`<section class="card"><h2>Add a partner</h2>${partnerForm()}</section>
    ${list.map((p) => html`<section class="card"><div class="card-head"><h2>${p.name}</h2><span class="chip ${p.published ? 'ok' : 'needinfo'}">${p.published ? 'Live' : 'Hidden'}</span></div>${partnerForm(p)}</section>`)}`;
}

// ---------------------------------------------------------------- referrals & commissions
function referralsTab(list) {
  const c = (r) => (Array.isArray(r.referral_commissions) ? r.referral_commissions[0] : r.referral_commissions) || {};
  const sum = (st) => list.filter((r) => c(r).status === st).reduce((t, r) => t + Number(c(r).amount_php || 0), 0);
  return html`<div class="stats four">
      <div class="stat soon"><div class="stat-n">${list.filter((r) => r.status === 'requested').length}</div><div class="stat-l">To introduce</div></div>
      <div class="stat progress"><div class="stat-n">${peso(sum('expected'))}</div><div class="stat-l">Expected</div></div>
      <div class="stat ok"><div class="stat-n">${peso(sum('earned'))}</div><div class="stat-l">Earned, not paid</div></div>
      <div class="stat ok"><div class="stat-n">${peso(sum('paid'))}</div><div class="stat-l">Commission received</div></div></div>
    ${list.length ? html`<section class="card">${list.map((r) => html`<form class="admin-ref line-form" data-id="${r.id}">
      <div class="line-main"><b>${r.partners?.name} ← ${r.orgs?.name}</b><small>${r.contact_method}${r.contact_value ? ': ' + r.contact_value : ''} · ${timeAgo(r.created_at)}${r.note ? ' · ' + r.note : ''}</small></div>
      <select name="status">${['requested', 'introduced', 'converted', 'not_converted'].map((k) => html`<option value="${k}" ${k === r.status ? 'selected' : ''}>${{ requested: 'To introduce', introduced: 'Introduced', converted: 'Became a sale', not_converted: 'No sale' }[k]}</option>`)}</select>
      <input name="amount" type="number" min="0" step="0.01" value="${c(r).amount_php ?? 0}" title="Commission ₱">
      <select name="cstatus">${['expected', 'earned', 'paid', 'none'].map((k) => html`<option value="${k}" ${k === c(r).status ? 'selected' : ''}>${{ expected: 'Expected', earned: 'Earned', paid: 'Paid to us', none: 'None' }[k]}</option>`)}</select>
      <button class="btn btn-sm btn-soft">Save</button></form>`)}</section>` : empty('No referrals yet', 'Introduction requests from customers appear here.')}`;
}

// ---------------------------------------------------------------- payment details
function settingsTab(st) {
  const f = (k, label, ph = '') => html`<label class="field"><span>${label}</span><input name="${k}" value="${st[k] || ''}" maxlength="500" placeholder="${ph}"></label>`;
  return html`<section class="card"><h2>How customers pay you</h2><form class="admin-settings">
    <div class="grid2">${f('gcash_name', 'GCash account name')}${f('gcash_number', 'GCash number', '0917 123 4567')}
      ${f('bank_name', 'Bank', 'e.g. BPI')}${f('bank_account_name', 'Account name')}${f('bank_account_number', 'Account number')}
      ${f('support_phone', 'Support phone')}${f('support_email', 'Support email')}</div>
    ${f('payment_note', 'Note shown under the payment details')}
    <label class="check"><input type="checkbox" name="online_payments" ${st.online_payments === 'on' ? 'checked' : ''}> Show "Pay online" (only after PayMongo keys are added to Supabase)</label>
    <button class="btn btn-primary">Save</button></form></section>`;
}

function orgsTab(list) {
  return html`<section class="card"><p class="muted small">Give pilot customers a plan here (leave "until" blank for no end date).</p>
    <div class="table-wrap"><table class="table"><thead><tr><th>Workspace</th><th>Owner</th><th>Size</th><th>Created</th><th>Plan</th></tr></thead><tbody>
    ${list.map((o) => html`<tr class="${o.deleted_at ? 'muted' : ''}"><td>${o.name}${o.deleted_at ? ' (deleting)' : ''}${o.open_requests ? html` <span class="tag red">${o.open_requests} open</span>` : ''}</td>
      <td>${o.owner_email || '—'}</td><td>${o.businesses} biz · ${o.vehicles} veh · ${o.members} ppl</td><td>${fmtDate(o.created_at.slice(0, 10))}</td>
      <td><form class="inline-form plan-form" data-id="${o.id}"><select name="plan">${S.plans.map((p) => html`<option value="${p.id}" ${p.id === o.plan_id ? 'selected' : ''}>${p.name}</option>`)}</select>
        <input type="date" name="until" value="${o.plan_expires_at ? o.plan_expires_at.slice(0, 10) : ''}" title="Until"><button class="btn btn-sm btn-soft">Set</button></form></td></tr>`)}
    </tbody></table></div></section>`;
}

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
  const order = (f) => ordersCache.find((a) => a.id === f.dataset.id);
  submit('.admin-quote', async (f, fd) => {
    await db.adminQuote(f.dataset.id, Number(fd.get('fee')), Number(fd.get('gov') || 0), String(fd.get('note')).trim());
    toast('Quote sent to the customer.'); rerender();
  });
  submit('.admin-update', async (f, fd) => {
    await db.adminUpdateOrder(order(f), { status: fd.get('status'), message: String(fd.get('message')).trim(), file: fd.get('file'), govActual: fd.get('gov'), provider: String(fd.get('provider')).trim() });
    toast('Update sent.'); rerender();
  });
  submit('.admin-refund', async (f, fd) => {
    const v = Object.fromEntries(fd.entries());
    if (v.kind === 'full' && !(await confirmDialog('Record a full refund?', 'This also cancels the order.', { confirmLabel: 'Record full refund' }))) return;
    await db.adminRefund(f.dataset.id, v);
    toast('Refund recorded. The customer can see it in their order.'); rerender();
  });
  submit('.admin-renewal', async (f, fd) => {
    const v = Object.fromEntries(fd.entries());
    if (v.expires_on && v.issued_on && v.expires_on < v.issued_on) throw new Error('The expiry date is before the issue date.');
    await db.adminRecordRenewal(order(f), v, fd.get('file'));
    toast("Saved to the customer's account. Order completed."); openOrder = null; rerender();
  });
  submit('.admin-svc', async (f, fd) => {
    const price = fd.get('price_from');
    await db.adminSaveService(f.dataset.code, {
      name: String(fd.get('name')).trim(), price_from: price === '' ? null : Number(price), price_unit: String(fd.get('price_unit')).trim(), turnaround: String(fd.get('turnaround')).trim(),
      summary: String(fd.get('summary')).trim(), includes: String(fd.get('includes')).split('\n').map((x) => x.trim()).filter(Boolean), active: fd.get('active') === 'on',
    });
    toast('Saved.');
  });
  submit('.admin-partner', async (f, fd) => {
    const row = Object.fromEntries(['name', 'category', 'offer', 'coverage', 'website', 'contact_name', 'contact_phone', 'contact_email', 'commission_terms', 'description'].map((k) => [k, String(fd.get(k) || '').trim()]));
    if (!row.name) throw new Error('Enter the partner name.');
    if (row.website && !/^https:\/\//.test(row.website)) throw new Error('The website must start with https://');
    row.type_codes = String(fd.get('type_codes') || '').split(',').map((x) => x.trim()).filter(Boolean);
    row.published = fd.get('published') === 'on';
    await db.adminSavePartner(f.dataset.id || null, row);
    toast('Partner saved.'); rerender();
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

on('admin-docs', async (ds) => {
  const box = document.querySelector(`.admin-docs[data-for="${ds.id}"]`);
  try {
    const docs = await db.adminRequestDocs(ds.id);
    box.innerHTML = String(docs.length ? html`<div class="files">${docs.map((d) => html`<div class="file"><div class="file-main">${d.file_name}</div>
      <button class="btn btn-sm btn-soft" data-act="staff-file" data-path="${d.storage_path}" data-name="${d.file_name}">Download</button></div>`)}</div>`
      : html`<p class="muted small">No files uploaded for this requirement.</p>`);
  } catch (e) { toastError(e); }
});

on('staff-file', async (ds) => {
  const w = window.open('about:blank', '_blank'); // open now so pop-up blockers allow it
  try { const url = await db.staffFileUrl(ds.path, ds.name); if (w) w.location.href = url; else location.href = url; } catch (e) { w?.close(); toastError(e); }
});
on('admin-test-email', async () => {
  try { await db.adminTestEmail(); toast('Test email queued. Check your inbox, then the list below for its status.'); rerender(); } catch (e) { toastError(e); }
});
