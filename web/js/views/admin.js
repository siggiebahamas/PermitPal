// PermitPal staff console: done-for-you orders (quote, payment, progress, finished permit) and their
// prices, workspaces and plans (team tools revenue), listed professionals and the quote requests
// (leads) sent to them, payment details, the email log and browser errors.
// Only accounts with profiles.is_platform_admin can load any of this (enforced in the database).
import { html, fmtDate, fmtDateTime, timeAgo, toast, toastError, when, peso, todayPH, openModal, plural, confirmDialog } from '../util.js';
import { S, on, rerender, empty, has, IN_PERSON, offered } from '../core.js';
import { PARTNER_CATEGORIES } from './extras.js';
import { ORDER_STATUS, PAYMENT_STATUS, KIND_LABEL } from './services.js';
import { ICON } from '../components.js';
import * as db from 'pp/data';
import { moneyTab } from './admin-money.js';
import { careTab } from './admin-care.js';
import { partnersTab as partnersTab2, billingTab } from './admin-partners.js';
import { plusTab } from './admin-plus.js';
import { loadTab } from './admin-load.js';
import { planTotal } from '../prices.js';

let tab = null; // Money first once the revenue features are on, else the Inbox
const KIND_NAMES = { business: 'Business', head_office: 'Head office', firm: 'Accounting firm', property: 'Property', fleet: 'Fleet' };

export async function admin(el) {
  if (!S.profile?.is_platform_admin) { el.innerHTML = String(empty('Staff only', 'This page is for the PermitPal team.')); return; }
  el.innerHTML = String(html`<div class="loading">Loading…</div>`);
  const rev = has('revenue');
  tab ||= rev ? 'money' : 'inbox';
  if (tab === 'care' && !IN_PERSON) tab = 'money';
  const tabBtn = (k, l) => html`<button class="tab ${tab === k ? 'active' : ''}" data-act="admin-tab" data-tab="${k}">${l}</button>`;
  let body = '';
  try {
    if (tab === 'money' && rev) body = await moneyTab((t) => { tab = t; openOrder = null; rerender(); });
    else if (tab === 'care' && rev && IN_PERSON) body = await careTab();
    else if (tab === 'billing' && rev) body = await billingTab();
    else if (tab === 'plus' && has('plus')) body = await plusTab();
    else if (tab === 'load' && has('load')) body = await loadTab();
    else if (tab === 'partners' && rev) body = await partnersTab2();
    else if (tab === 'orders' && has('services')) body = await ordersTab();
    else if (tab === 'services' && has('services')) body = servicesTab(await db.adminServices());
    else if (tab === 'orgs') { const [list, kinds] = await Promise.all([db.adminOrgs(), db.adminOrgKinds()]); body = orgsTab(list, kinds); }
    else if (tab === 'partners') body = partnersTab(await db.adminPartners());
    else if (tab === 'referrals') body = referralsTab(await db.adminReferrals());
    else if (tab === 'payments') body = settingsTab(await db.adminSettings());
    else if (tab === 'inbox') body = inboxTab(await db.adminSupportMessages());
    else if (tab === 'errors' && has('errors')) body = errorsTab(await db.adminErrors(errorsOpen), errorsOpen);
    else body = outboxTab(await db.adminOutbox(), await db.channelStatus().catch(() => ({})));
  } catch (e) { toastError(e); }
  el.innerHTML = String(html`
    <div class="page-head"><div><h1>PermitPal admin</h1><p class="muted">Staff tools. Customers never see this page.</p></div></div>
    <div class="tabs">${rev ? tabBtn('money', 'Money') : ''}${tabBtn('inbox', 'Inbox')}${has('services') ? html`${tabBtn('orders', 'Orders')}${rev && IN_PERSON ? tabBtn('care', 'Care') : ''}${tabBtn('services', 'Services & prices')}` : ''}${has('plus') ? tabBtn('plus', 'Plus & staff') : ''}${has('load') ? tabBtn('load', 'Load') : ''}${tabBtn('orgs', 'Workspaces & plans')}${tabBtn('partners', 'Professionals')}${rev ? tabBtn('billing', 'Partner billing') : tabBtn('referrals', 'Quote requests')}
      ${tabBtn('payments', 'Payment details')}${tabBtn('outbox', 'Messages')}${has('errors') ? tabBtn('errors', 'Errors') : ''}</div>
    ${body}`);
  wire(el);
}
on('admin-tab', (ds) => { tab = ds.tab; openOrder = null; rerender(); });

// ---------------------------------------------------------------- done-for-you orders
let openOrder = null;
let ordersCache = [];
const STAGES = [
  ['New: send a quote', (a) => a.status === 'submitted'],
  ['Payment to check', (a) => a.payment_status === 'pending_verification'],
  ['Quoted: waiting for the customer', (a) => a.status === 'quoted'],
  ['Accepted: waiting for payment', (a) => a.payment_status === 'awaiting_payment'],
  ['In progress', (a) => !['submitted', 'quoted', 'completed', 'cancelled'].includes(a.status)],
];
async function ordersTab() {
  ordersCache = (await db.adminRequests(has('revenue'))).filter((a) => a.service_code || a.care_plan_id);
  const list = ordersCache;
  if (openOrder) {
    const a = list.find((x) => x.id === openOrder);
    if (a) return orderDetail(a, await db.orderEvents(a.id));
  }
  const open = list.filter((a) => !['completed', 'cancelled'].includes(a.status));
  const closed = list.filter((a) => ['completed', 'cancelled'].includes(a.status));
  const earned = closed.filter((a) => a.status === 'completed' && ['paid', 'waived'].includes(a.payment_status)).reduce((t, a) => t + Number(a.quote_service_fee || 0), 0);
  const line = (a) => html`<button class="line" data-act="admin-order" data-id="${a.id}"><span class="line-main"><b>${KIND_LABEL[a.kind] || 'Request'}: ${a.requirement_name} — ${a.subject_label}</b>
    <small>${a.orgs?.name || ''} · ${timeAgo(a.created_at)}${a.rush ? ' · URGENT' : ''}${a.care_plan_id ? (a.created_by ? ' · CARE (walk-through included)' : a.care_plans?.billing === 'per_renewal' ? ' · CARE (pay per renewal)' : ' · CARE') : ''}${a.batch_id ? ' · several at once' : ''}${a.due_on ? ' · due ' + fmtDate(a.due_on) : ''}${a.quote_php != null ? ' · ' + peso(a.quote_php) : ''}</small></span>
    <span class="chip ${ORDER_STATUS[a.status]?.[1]}">${ORDER_STATUS[a.status]?.[0]}</span></button>`;
  const used = new Set();
  return html`
    <div class="stats four">
      <div class="stat soon"><div class="stat-n">${open.length}</div><div class="stat-l">Open orders</div></div>
      <div class="stat overdue"><div class="stat-n">${open.filter((a) => a.status === 'submitted').length}</div><div class="stat-l">Need a quote</div></div>
      <div class="stat progress"><div class="stat-n">${open.filter((a) => a.payment_status === 'pending_verification').length}</div><div class="stat-l">Payments to check</div></div>
      <div class="stat ok"><div class="stat-n">${peso(earned)}</div><div class="stat-l">Service fees earned (done)</div></div>
    </div>
    ${STAGES.map(([title, test]) => {
      const items = open.filter((a) => !used.has(a.id) && test(a));
      items.forEach((a) => used.add(a.id));
      return items.length ? html`<section class="card"><div class="card-head"><h2>${title}</h2><span class="muted small">${items.length}</span></div>${items.map(line)}</section>` : '';
    })}
    ${when(!open.length, empty('No open orders', 'New requests also arrive by email.'))}
    ${when(closed.length, html`<details class="folder card"><summary>${plural(closed.length, 'closed order')}</summary>${closed.map(line)}</details>`)}`;
}
on('admin-order', (ds) => { openOrder = ds.id; rerender(); });
on('admin-back', () => { openOrder = null; rerender(); });

function orderDetail(a, events) {
  const closed = ['completed', 'cancelled'].includes(a.status);
  const rev = has('revenue');
  const svc = (S.data?.services || []).find((x) => x.code === a.service_code);
  const care = rev && a.care_plan_id;
  // Pay per renewal: quote our usual price; the All-in plan (or an included walk-through): ₱0.
  const payPer = care && !a.created_by && a.care_plans?.billing === 'per_renewal';
  const steps = rev ? svc?.steps || [] : [];
  const paid = ['paid', 'waived'].includes(a.payment_status);
  return html`
    <button class="back linklike" data-act="admin-back">← All orders</button>
    <section class="card">
      <div class="card-head"><div><h2>${KIND_LABEL[a.kind] || 'Request'}: ${a.requirement_name} — ${a.subject_label}</h2><p class="card-sub">${a.orgs?.name} · ${a.service_code}${a.rush ? ' · URGENT' : ''}</p></div>
        <span class="chip ${ORDER_STATUS[a.status]?.[1]}">${ORDER_STATUS[a.status]?.[0]}</span></div>
      <dl class="kv">
        <dt>Location</dt><dd>${a.location_label || '—'}</dd>
        <dt>Deadline</dt><dd>${a.due_on ? fmtDate(a.due_on) : '—'}</dd>
        <dt>Documents</dt><dd>${{ have: 'Uploaded in PermitPal', need: 'Customer needs to get them', not_sure: 'Not sure' }[a.docs_status] || '—'}</dd>
        <dt>Contact</dt><dd>${a.contact_method}${a.contact_value ? ': ' + a.contact_value : ''}</dd>
        <dt>Authorized</dt><dd>${a.consented_at ? fmtDateTime(a.consented_at) + ' (ticked in the app; get the signed letter before filing)' : 'No — ask for written authorization before doing anything'}</dd>
        <dt>Notes</dt><dd class="pre">${a.notes || '—'}</dd>
        <dt>Quote</dt><dd>${a.quote_php != null ? html`${peso(a.quote_php)} (fee ${peso(a.quote_service_fee)} + gov ${peso(a.quote_gov_fees)})` : '—'}</dd>
        <dt>Payment</dt><dd>${PAYMENT_STATUS[a.payment_status]}${a.payment_method ? ' · ' + a.payment_method : ''}${a.payment_ref ? ' · ref ' + a.payment_ref : ''}</dd>
        <dt>Received</dt><dd>${fmtDateTime(a.created_at)}</dd>
        ${when(care, html`<dt>Care</dt><dd>${a.created_by ? 'Walk-through included in their care plan: quote ₱0 service fee.'
          : payPer ? `Started by Year-round care, pay per renewal: quote our usual fee${svc?.price_from != null ? ` (${peso(svc.price_from)})` : ''} plus the government fees. Within their pre-approval and at or below the usual fee, it's accepted for them.${a.requirement_id ? ' If this job also covers another open one for the same vehicle (LTO includes the emission test and inspection), quote that one ₱0.' : ''}`
          : 'Started by Year-round care: our fee is covered. Quote the government fees only (₱0 service fee).'}</dd>`)}
        ${when(rev && paid, html`<dt>BIR invoice no.</dt><dd><form class="inline-form inv-form" data-kind="order" data-id="${a.id}"><input name="no" maxlength="60" value="${a.bir_invoice_no || ''}" aria-label="BIR invoice number" placeholder="Add after you issue it"><button class="btn btn-sm btn-ghost">Save</button></form></dd>`)}
      </dl>
      ${when(!closed && a.requirement_id, html`<button class="btn btn-sm btn-ghost" data-act="admin-docs" data-id="${a.requirement_id}">Show customer's files</button>
        <span class="muted small">Every file you open is shown to the customer.</span><div class="admin-docs" data-for="${a.requirement_id}"></div>`)}
    </section>

    ${when(['submitted', 'quoted', 'awaiting_customer'].includes(a.status) && !['paid', 'waived', 'pending_verification'].includes(a.payment_status), html`<section class="card"><h2>${a.quote_php != null ? 'Change the quote' : 'Send the quote'}</h2>
      <form class="admin-quote" data-id="${a.id}"><div class="grid2">
        <label class="field"><span>Service fee (₱)</span><input name="fee" type="number" min="0" step="0.01" required value="${a.quote_service_fee ?? (payPer ? svc?.price_from ?? '' : care ? 0 : '')}"></label>
        ${when(rev && a.rush, html`<label class="field"><span>Rush fee (₱) <small>(they asked for it urgent)</small></span><input name="rush" type="number" min="0" step="0.01" value="${Number(a.quote_rush_fee) || (svc?.rush_fee ?? '')}"></label>`)}
        <label class="field"><span>Government fees, estimate (₱)</span><input name="gov" type="number" min="0" step="0.01" value="${a.quote_gov_fees ?? ''}"></label></div>
        ${when(care && !a.created_by, html`<p class="muted small">If the government fees are within the ${peso(a.orgs?.care_gov_preapproval_php || 0)} they pre-approved, the quote is accepted for them automatically.</p>`)}
        <label class="field"><span>Note to the customer</span><textarea name="note" rows="2" maxlength="2000" placeholder="What's included, documents we need, how long it takes">${a.quote_note || ''}</textarea></label>
        <button class="btn btn-primary">Send quote</button></form></section>`)}

    ${when(a.payment_status === 'pending_verification', html`<section class="card"><h2>Check the payment</h2>
      <p>Customer says they paid <b>${peso(a.quote_php)}</b> by ${a.payment_method}${a.payment_ref ? html`, reference <b>${a.payment_ref}</b>` : ''}. Find it in your GCash or bank app first.</p>
      <div class="btn-row"><button class="btn btn-primary" data-act="admin-pay" data-id="${a.id}" data-ok="1">Payment received</button>
        <button class="btn btn-ghost danger" data-act="admin-pay" data-id="${a.id}" data-ok="">Can't find it</button></div></section>`)}

    ${when(steps.length && !closed, html`<section class="card"><h2>Steps</h2><p class="muted small">Tick off steps as you finish them: the customer sees each one.</p>
      <form class="admin-steps" data-id="${a.id}"><ol class="job-steps">${steps.map((t, i) => html`<li class="${i < (a.steps_done || 0) ? 'done' : ''}"><label class="check"><input type="radio" name="done" value="${i + 1}" ${a.steps_done === i + 1 ? 'checked' : ''}><span>${t}</span></label></li>`)}</ol>
        <label class="check"><input type="radio" name="done" value="0" ${!a.steps_done ? 'checked' : ''}><span>None done yet</span></label>
        <button class="btn btn-sm btn-soft">Save progress</button></form></section>`)}
    ${when(rev && svc?.needs_access && !closed, html`<section class="card"><h2>Their workspace</h2>
      ${a.staff_access ? html`<p class="muted small">The customer agreed to give you temporary access. You join as a plain member; it ends automatically when you mark this order completed.</p>
        <button class="btn btn-sm ${paid ? 'btn-primary' : 'btn-soft'}" data-act="admin-join" data-id="${a.id}" ${paid ? '' : 'disabled'}>${paid ? 'Join their workspace' : 'Join (after payment)'}</button>`
      : html`<p class="muted small">They haven't agreed to access yet (they do it when accepting the quote).</p>`}</section>`)}
    ${when(!closed, html`<section class="card"><h2>Update the customer</h2>
      <form class="admin-update" data-id="${a.id}"><div class="grid2">
        <label class="field"><span>Status</span><select name="status"><option value="">Keep: ${ORDER_STATUS[a.status]?.[0]}</option>
          ${['awaiting_customer', 'in_progress', 'completed', 'cancelled'].map((k) => html`<option value="${k}">${ORDER_STATUS[k][0]}</option>`)}</select></label>
        <label class="field"><span>Who is filing <small>(internal)</small></span><input name="provider" maxlength="160" value="${a.provider_name || ''}"></label>
        <label class="field"><span>Government fees actually paid (₱)</span><input name="gov" type="number" min="0" step="0.01" value="${a.gov_fees_actual ?? ''}"></label>
        <label class="field"><span>Attach a file <small>(official receipt, photo)</small></span><input type="file" name="file" accept=".pdf,image/*"></label></div>
        <label class="field"><span>Message</span><textarea name="message" rows="2" maxlength="2000" placeholder="e.g. Filed at Taguig BPLO today. Release expected Friday."></textarea></label>
        <button class="btn btn-soft">Send update</button></form></section>`)}

    ${when(!closed && a.requirement_id, html`<section class="card"><h2>Done: save the new permit to their account</h2>
      <p class="muted small">This records the new permit on the customer's permit, attaches the file, and closes the order.</p>
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
on('admin-docs', async (ds) => {
  const box = document.querySelector(`.admin-docs[data-for="${ds.id}"]`);
  try {
    const docs = await db.adminRequestDocs(ds.id);
    box.innerHTML = String(docs.length ? html`<div class="files">${docs.map((d) => html`<div class="file"><div class="file-main">${d.file_name}</div>
      <button class="btn btn-sm btn-soft" data-act="staff-file" data-path="${d.storage_path}" data-name="${d.file_name}">Download</button></div>`)}</div>`
      : html`<p class="muted small">No files uploaded for this permit.</p>`);
  } catch (e) { toastError(e); }
});
on('staff-file', async (ds) => {
  const w = window.open('about:blank', '_blank'); // open now so pop-up blockers allow it
  try { const url = await db.staffFileUrl(ds.path, ds.name); if (w) w.location.href = url; else location.href = url; } catch (e) { w?.close(); toastError(e); }
});

// ---------------------------------------------------------------- services & prices
function servicesTab(list) {
  return html`<p class="muted small">These are the starting prices customers see. Every order still gets an exact quote from you.${IN_PERSON ? '' : ' Services that need someone at city hall, the LTO or an inspection are switched off for now: customers don\'t see them, whatever "Offered" says.'}</p>
    ${list.map((s) => html`<section class="card"><form class="admin-svc" data-code="${s.code}">
      <div class="card-head"><h2>${s.name}${offered(s) ? '' : html` <span class="chip needinfo">In person: hidden</span>`}</h2><label class="check"><input type="checkbox" name="active" ${s.active ? 'checked' : ''}> Offered</label></div>
      <div class="grid2">
        <label class="field"><span>Name</span><input name="name" maxlength="120" value="${s.name}" required></label>
        <label class="field"><span>Starting price (₱) <small>blank = quoted</small></span><input name="price_from" type="number" min="0" step="1" value="${s.price_from ?? ''}"></label>
        <label class="field"><span>Price unit</span><input name="price_unit" maxlength="60" value="${s.price_unit}"></label>
        <label class="field"><span>Usual turnaround</span><input name="turnaround" maxlength="80" value="${s.turnaround}"></label></div>
      <label class="field"><span>Summary</span><textarea name="summary" rows="2" maxlength="600">${s.summary}</textarea></label>
      <label class="field"><span>What's included <small>(one per line)</small></span><textarea name="includes" rows="3">${(s.includes || []).join('\n')}</textarea></label>
      <button class="btn btn-sm btn-soft">Save</button></form></section>`)}`;
}

// ---------------------------------------------------------------- errors customers hit (from their browsers)
let errorsOpen = true;
const browserOf = (ua) => (!ua ? 'Unknown browser' : /iPhone|iPad/.test(ua) ? 'iPhone / iPad' : /Android/.test(ua) ? 'Android' : /Mac OS/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Other')
  + (/Edg\//.test(ua || '') ? ' · Edge' : /Chrome\//.test(ua || '') ? ' · Chrome' : /Safari\//.test(ua || '') ? ' · Safari' : /Firefox\//.test(ua || '') ? ' · Firefox' : '');
function errorsTab(list, open) {
  return html`<section class="card">
    <div class="card-head"><div><h2>${open ? 'Errors to look at' : 'Fixed errors'}</h2>
      <p class="card-sub">Problems people hit in their browsers, grouped by kind. Personal details are removed before they are sent.</p></div>
      <div class="btn-row"><button class="btn btn-sm ${open ? 'btn-primary' : 'btn-ghost'}" data-act="err-filter" data-v="open">Open</button>
        <button class="btn btn-sm ${open ? 'btn-ghost' : 'btn-primary'}" data-act="err-filter" data-v="fixed">Fixed</button></div></div>
    ${list.length ? list.map((e) => html`<div class="row err-row">
      <div class="row-main"><div class="row-title">${e.message}</div>
        <div class="row-sub">${e.route || 'unknown page'} · ${browserOf(e.user_agent)} · version ${e.app_version || '?'}</div>
        <div class="row-sub">${e.count}× · ${e.users_affected} ${e.users_affected === 1 ? 'person' : 'people'} · first ${timeAgo(e.first_seen)} · last ${timeAgo(e.last_seen)}
          ${e.resolved_at ? html` · fixed ${fmtDate(e.resolved_at.slice(0, 10))}${e.note ? ' — ' + e.note : ''}` : ''}</div>
        ${when(e.stack, html`<details class="err-stack"><summary>Technical details</summary><pre>${e.stack}</pre></details>`)}</div>
      <div class="row-side">${open
        ? html`<button class="btn btn-sm btn-primary" data-act="err-resolve" data-id="${e.id}">Mark fixed</button>`
        : html`<button class="btn btn-sm btn-ghost" data-act="err-reopen" data-id="${e.id}">Reopen</button>`}</div>
    </div>`) : html`<p class="muted">${open ? 'No open errors. 🎉' : 'Nothing marked fixed yet.'}</p>`}
  </section>`;
}
on('err-filter', (ds) => { errorsOpen = ds.v === 'open'; rerender(); });
on('err-resolve', (ds) => openModal('Mark this error fixed', html`<p class="muted small">If it happens again after this, it shows up here as new.</p>
  <label class="field"><span>Note <small>(optional, e.g. what was fixed)</small></span><input name="note" maxlength="500"></label>`, {
  submitLabel: 'Mark fixed',
  onSubmit: async (fd) => { await db.adminResolveError(Number(ds.id), true, fd.get('note')); toast('Marked fixed.'); rerender(); },
}));
on('err-reopen', async (ds) => { try { await db.adminResolveError(Number(ds.id), false); toast('Reopened.'); rerender(); } catch (e) { toastError(e); } });

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
    <section class="card"><p class="muted small">${has('revenue') ? 'When a customer pays for a plan, use "Record a payment": it extends the plan and counts in Money. "Set" changes the plan without recording money (for trials and fixes).' : 'After a customer pays for a plan, set it here (leave "until" blank for no end date).'}</p>
    <div class="table-wrap"><table class="table"><thead><tr><th>Workspace</th><th>Type</th><th>Owner</th><th>Size</th><th>Trial</th><th>Plan</th></tr></thead><tbody>
    ${list.map((o) => html`<tr class="${o.deleted_at ? 'muted' : ''}"><td>${o.name}${o.deleted_at ? ' (deleting)' : ''}</td>
      <td>${KIND_NAMES[k[o.id]?.kind || 'business']}</td>
      <td>${o.owner_email || '—'}</td><td>${o.businesses} biz · ${o.vehicles} veh · ${o.members} ppl</td>
      <td>${k[o.id]?.trial_ends_at ? (k[o.id].trial_ends_at > now ? 'until ' + fmtDate(k[o.id].trial_ends_at.slice(0, 10)) : 'ended') : '—'}</td>
      <td><form class="inline-form plan-form" data-id="${o.id}"><select name="plan" aria-label="Plan for ${o.name}">${S.plans.filter((p) => p.available !== false || p.id === o.plan_id).map((p) => html`<option value="${p.id}" ${p.id === o.plan_id ? 'selected' : ''}>${p.name}</option>`)}</select>
        <input type="date" name="until" value="${o.plan_expires_at ? o.plan_expires_at.slice(0, 10) : ''}" title="Until" aria-label="Plan until"><button class="btn btn-sm btn-soft">Set</button></form>
        ${when(has('revenue') && !o.deleted_at, html`<button class="linklike small" data-act="plan-pay" data-id="${o.id}" data-name="${o.name}">Record a payment</button>`)}</td></tr>`)}
    </tbody></table></div></section>`;
}

// ---------------------------------------------------------------- professionals
function partnerForm(p = {}) {
  return html`<form class="admin-partner" data-id="${p.id || ''}"><div class="grid2">
    <label class="field"><span>Name</span><input name="name" required maxlength="160" value="${p.name || ''}"></label>
    <label class="field"><span>Category</span><select name="category">${Object.entries(PARTNER_CATEGORIES).map(([k, v]) => html`<option value="${k}" ${k === p.category ? 'selected' : ''}>${v}</option>`)}</select></label>
    <label class="field"><span>License / accreditation <small>(shown)</small></span><input name="licence" maxlength="200" value="${p.licence || ''}" placeholder="e.g. CPA, PRC no. 0123456"></label>
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
      <label class="check"><input type="checkbox" name="verified" ${p.verified ? 'checked' : ''}> <span>The firm confirmed it is registered and licensed <small class="muted">(you don't check papers)</small></span></label>
      <button class="btn btn-sm btn-primary">${p.id ? 'Save' : 'Add professional'}</button></div></form>`;
}
function partnersTab(list) {
  return html`<section class="card"><h2>Add a professional</h2><p class="muted small">List only registered firms. Tick "License checked" after you've seen their business permit and, for accountants, their PRC license. Quote requests are emailed to their email below.</p>${partnerForm()}</section>
    ${list.map((p) => html`<section class="card"><div class="card-head"><h2>${p.name}</h2><span class="chip ${p.published ? 'ok' : 'needinfo'}">${p.published ? 'Live' : 'Hidden'}</span></div>${partnerForm(p)}</section>`)}`;
}

// ---------------------------------------------------------------- quote requests (leads) and fees
function referralsTab(list) {
  const c = (r) => (Array.isArray(r.referral_commissions) ? r.referral_commissions[0] : r.referral_commissions) || {};
  const sum = (st) => list.filter((r) => c(r).status === st).reduce((t, r) => t + Number(c(r).amount_php || 0), 0);
  const month = todayPH().slice(0, 7);
  const phMonth = (ts) => new Date(ts).toLocaleString('en-CA', { timeZone: 'Asia/Manila' }).slice(0, 7);
  return html`<div class="stats four">
      <div class="stat progress"><div class="stat-n">${list.filter((r) => phMonth(r.created_at) === month).length}</div><div class="stat-l">Requests this month</div></div>
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
    ${when(has('sms'), html`<label class="field"><span>Most text messages per month, all customers together <small>(each costs about ₱0.50–1)</small></span>
      <input name="sms_monthly_cap" type="number" min="0" max="100000" step="1" value="${st.sms_monthly_cap || '1000'}"></label>`)}
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
    ${list.length ? list.map(row) : html`<p class="muted">No messages yet.</p>`}</section>
  ${when(has('mfa'), html`<section class="card"><h2>Lost phone: turn off someone's two-step login</h2>
    <p class="muted small">Only after you have confirmed it's really them (for example a video call where they show an ID matching their profile, or a reply from the email they sign in with). They are told by email straight away, and every reset is logged.</p>
    <form class="admin-mfa"><div class="grid2">
      <label class="field"><span>Their sign-in email</span><input name="email" type="email" required maxlength="200"></label>
      <label class="field"><span>How you confirmed who they are</span><input name="reason" required minlength="10" maxlength="500" placeholder="e.g. Video call, ID matched profile name"></label></div>
      <label class="check"><input type="checkbox" name="sure" required> <span>I confirmed this request came from the account owner</span></label>
      <button class="btn btn-ghost danger">Turn off their two-step login</button></form></section>`)}`;
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
  const order = (f) => ordersCache.find((a) => a.id === f.dataset.id);
  submit('.admin-quote', async (f, fd) => {
    const fee = Number(fd.get('fee'));
    const gov = Number(fd.get('gov') || 0);
    const rush = Number(fd.get('rush') || 0);
    if (!(fee >= 0) || !(gov >= 0) || !(rush >= 0)) throw new Error('Enter amounts of zero or more.');
    await db.adminQuote(f.dataset.id, fee, gov, String(fd.get('note')).trim(), rush);
    toast('Quote sent to the customer.'); rerender();
  });
  submit('.admin-update', async (f, fd) => {
    const message = String(fd.get('message')).trim();
    if (!fd.get('status') && !message && !fd.get('file')?.size && fd.get('gov') === '' && !String(fd.get('provider')).trim()) throw new Error('Nothing to send: choose a status, write a message or attach a file.');
    if (fd.get('status') === 'cancelled' && !(await confirmDialog('Cancel this order?', 'The customer is told it was cancelled. Refund anything they paid separately.', { confirmLabel: 'Cancel order' }))) return;
    await db.adminUpdateOrder(order(f), { status: fd.get('status'), message, file: fd.get('file'), govActual: fd.get('gov'), provider: String(fd.get('provider')).trim() });
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
    if (!(await confirmDialog('Save the permit and complete the order?', `Reference ${v.reference_no}${v.expires_on ? ', valid until ' + fmtDate(v.expires_on) : ', no expiry date'}. The customer's permit is updated straight away.`, { confirmLabel: 'Save and complete', danger: false }))) return;
    await db.adminRecordRenewal(order(f), v, fd.get('file'));
    toast("Saved to the customer's account. Order completed."); openOrder = null; rerender();
  });
  submit('.admin-svc', async (f, fd) => {
    const price = fd.get('price_from');
    const name = String(fd.get('name')).trim();
    if (!name) throw new Error('The service needs a name.');
    await db.adminSaveService(f.dataset.code, {
      name, price_from: price === '' ? null : Number(price), price_unit: String(fd.get('price_unit')).trim(), turnaround: String(fd.get('turnaround')).trim(),
      summary: String(fd.get('summary')).trim(), includes: String(fd.get('includes')).split('\n').map((x) => x.trim()).filter(Boolean), active: fd.get('active') === 'on',
    });
    toast('Saved. Customers see the new price on their next visit.');
  });
  submit('.admin-mfa', async (f, fd) => {
    const email = String(fd.get('email') || '').trim(), reason = String(fd.get('reason') || '').trim();
    if (!fd.get('sure')) throw new Error('Tick the box once you have confirmed who they are.');
    if (!(await confirmDialog(`Turn off two-step login for ${email}?`, 'They can then sign in with just their password until they set it up again.', { confirmLabel: 'Turn it off' }))) return;
    const n = await db.adminResetMfa(email, reason);
    f.reset();
    toast(n ? `Removed ${plural(n, 'device')}. They have been told by email.` : 'They had no two-step login set up. Nothing changed.');
  });
  submit('.admin-steps', async (f, fd) => {
    await db.adminOrderStep(f.dataset.id, Number(fd.get('done') || 0));
    toast('Progress saved. The customer can see it.'); rerender();
  });
  if (!has('revenue')) submit('.admin-partner', async (f, fd) => {
    const row = Object.fromEntries(['name', 'category', 'licence', 'website', 'contact_name', 'contact_phone', 'contact_email', 'commission_terms', 'description', 'services'].map((k) => [k, String(fd.get(k) || '').trim()]));
    if (!row.name) throw new Error('Enter the firm name.');
    if (row.website && !/^https:\/\//.test(row.website)) throw new Error('The website must start with https://');
    if (row.contact_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.contact_email)) throw new Error('Enter a valid email: quote requests are sent there.');
    row.type_codes = String(fd.get('type_codes') || '').split(',').map((x) => x.trim()).filter(Boolean);
    row.cities = String(fd.get('cities') || '').split(',').map((x) => x.trim()).filter(Boolean);
    const fee = fd.get('lead_fee_php');
    row.lead_fee_php = fee === '' || fee == null ? 0 : Number(fee); // blank = no fee (a blank fee used to break quote requests)
    row.published = fd.get('published') === 'on';
    row.verified = fd.get('verified') === 'on';
    await db.adminSavePartner(f.dataset.id || null, row);
    toast('Saved.'); rerender();
  });
  if (!has('revenue')) submit('.admin-ref', async (f, fd) => {
    await db.adminSaveReferral(f.dataset.id, fd.get('status'));
    const cs = fd.get('cstatus');
    await db.adminSaveCommission(f.dataset.id, { amount_php: Number(fd.get('amount') || 0), status: cs, paid_at: cs === 'paid' ? new Date().toISOString() : null });
    toast('Saved.');
  });
  submit('.admin-settings', async (f, fd) => {
    for (const k of ['gcash_name', 'gcash_number', 'bank_name', 'bank_account_name', 'bank_account_number', 'support_phone', 'support_email', 'payment_note']) await db.adminSaveSetting(k, String(fd.get(k) || '').trim());
    await db.adminSaveSetting('online_payments', fd.get('online_payments') === 'on' ? 'on' : 'off');
    if (fd.has('sms_monthly_cap')) {
      const cap = Number(fd.get('sms_monthly_cap'));
      if (!Number.isInteger(cap) || cap < 0) throw new Error('The text limit must be a whole number, 0 or more.');
      await db.adminSaveSetting('sms_monthly_cap', String(cap));
    }
    toast('Saved. Customers see these on their next visit.');
  });
  el.querySelectorAll('.plan-form').forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const until = fd.get('until');
    try { await db.adminSetPlan(f.dataset.id, fd.get('plan'), until ? new Date(until + 'T23:59:59+08:00').toISOString() : null); toast('Plan updated.'); } catch (err) { toastError(err); }
  }));
}

on('admin-join', async (ds) => {
  if (!(await confirmDialog('Join their workspace?', 'You become a team member there until this order is completed. The owner is told, and every change you make shows in their History.', { confirmLabel: 'Join', danger: false }))) return;
  try { await db.adminJoinWorkspace(ds.id); toast('Joined. Switch to their workspace from the menu (reload the page first).'); rerender(); } catch (e) { toastError(e); }
});
on('plan-pay', (ds) => openModal(`Record a team plan payment: ${ds.name}`, html`<p class="muted small">After the customer pays by GCash or bank transfer. This records the payment (for Money) and extends their plan.</p>
  <div class="grid2"><label class="field"><span>Plan</span><select name="plan">${S.plans.filter((p) => Number(p.price_php_monthly) > 0 && p.available !== false).map((p) => html`<option value="${p.id}" data-price="${p.price_php_monthly}">${p.name} (${peso(p.price_php_monthly)}/month)</option>`)}</select></label>
  <label class="field"><span>Months paid <small>(12 = a year, priced as 10)</small></span><input name="months" type="number" min="1" max="12" value="1" required></label>
  <label class="field"><span>Amount received (₱)</span><input name="amount" type="number" min="1" step="0.01" required></label>
  <label class="field"><span>Paid by</span><input name="method" maxlength="60" placeholder="GCash / BPI"></label>
  <label class="field"><span>Reference no.</span><input name="ref" maxlength="120"></label>
  <label class="field"><span>BIR invoice number</span><input name="invoice_no" maxlength="60"></label></div>`, {
  submitLabel: 'Record payment',
  onOpen: (form) => {
    const fill = () => { const o = form.plan.selectedOptions[0]; if (o) form.amount.value = planTotal(o.dataset.price, form.months.value || 1); };
    form.plan.addEventListener('change', fill); form.months.addEventListener('input', fill); fill();
  },
  onSubmit: async (fd) => {
    const v = Object.fromEntries(fd.entries());
    await db.adminRecordPlanPayment({ org_id: ds.id, plan: v.plan, months: Number(v.months), amount: Number(v.amount), method: v.method, ref: v.ref, invoice_no: v.invoice_no });
    toast('Payment recorded and plan extended. The owner was told.'); rerender();
  },
}));

on('admin-test-email', async () => {
  try { await db.adminTestEmail(); toast('Test email queued. Check your inbox, then the list below for its status.'); rerender(); } catch (e) { toastError(e); }
});
