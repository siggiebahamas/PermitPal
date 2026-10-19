// Admin > Care: Year-round care plans, their bills, guarantee claims, and covered permits that still
// need an expiry date. Every action here tells the customer (the database sends the notice).
import { html, fmtDate, peso, toast, toastError, openModal, confirmDialog, plural, when, todayPH, formObject } from '../util.js';
import { on, rerender, empty } from '../core.js';
import { PLAN_STATUS } from './care.js';
import * as db from 'pp/data';

let cache = { plans: [], invoices: [], claims: [], tiers: [] };
const due = (i) => i.status === 'due' && i.due_on < todayPH();
const monthlyOf = (p) => (p.billing === 'yearly' ? Number(p.price_php) / 12 : Number(p.price_php));

export async function careTab() {
  const [plans, invoices, claims, gaps, tiers] = await Promise.all([db.adminCarePlans(), db.adminCareInvoices(), db.adminClaims(), db.adminCareGaps(), db.adminCareTiers()]);
  cache = { plans, invoices, claims, tiers };
  const live = plans.filter((p) => p.status !== 'cancelled');
  const active = live.filter((p) => p.status === 'active' && p.paid_through >= todayPH());
  const mrr = active.filter((p) => !p.cancel_at).reduce((t, p) => t + monthlyOf(p), 0);
  const check = invoices.filter((i) => i.status === 'pending_verification');
  const open = invoices.filter((i) => i.status === 'due');
  const toDecide = claims.filter((c) => c.status === 'submitted');
  const toPay = claims.filter((c) => c.status === 'approved');
  const org = (x) => x.orgs?.name || '—';
  const tierName = (code) => tiers.find((t) => t.code === code)?.name || code;
  return html`
    <div class="stats four">
      <div class="stat ok"><div class="stat-n">${peso(Math.round(mrr))}</div><div class="stat-l">Care each month</div></div>
      <div class="stat progress"><div class="stat-n">${active.length}</div><div class="stat-l">Active plans</div></div>
      <div class="stat"><div class="stat-n">${live.filter((p) => p.status === 'pending').length}</div><div class="stat-l">Waiting for first payment</div></div>
      <div class="stat overdue"><div class="stat-n">${live.filter((p) => p.status === 'paused').length}</div><div class="stat-l">Paused (unpaid)</div></div>
    </div>
    ${when(check.length, html`<section class="card"><div class="card-head"><h2>Payments to confirm</h2><span class="muted small">${check.length}</span></div>
      ${check.map((i) => html`<div class="row"><div class="row-main"><div class="row-title">${org(i)} · bill ${i.number} · ${peso(i.amount_php)}</div>
        <div class="row-sub">${i.pay_method ? i.pay_method.replace('_', ' ') : ''}${i.pay_ref ? ' · ref ' + i.pay_ref : ''} · ${(i.lines || []).map((l) => l.label).join(', ')}${i.first ? ' · sign-up bill' : ''}</div>
        ${i.proof_path ? html`<button class="linklike small" data-act="staff-file" data-path="${i.proof_path}" data-name="${i.proof_name || 'payment'}">Open the screenshot</button>` : ''}</div>
        <div class="row-side"><button class="btn btn-sm btn-primary" data-act="care-confirm" data-id="${i.id}">Payment received</button>
          <button class="btn btn-sm btn-ghost danger" data-act="care-nomatch" data-id="${i.id}">Can't find it</button></div></div>`)}</section>`)}
    ${when(toDecide.length || toPay.length, html`<section class="card"><div class="card-head"><h2>Guarantee claims</h2></div>
      ${[...toDecide, ...toPay].map((c) => html`<div class="row"><div class="row-main"><div class="row-title">${org(c)} · ${c.requirement_name}</div>
        <div class="row-sub">Expired ${fmtDate(c.lapsed_on)} · penalty ${peso(c.penalty_php)}${c.approved_php != null ? ' · approved ' + peso(c.approved_php) : ''}${c.note ? ' · "' + c.note + '"' : ''}</div>
        <div class="row-sub">Check: was it our miss (we had the documents and fees in time)? If the customer was late sending what we asked for, decline and say so.</div>
        <button class="linklike small" data-act="staff-file" data-path="${c.receipt_path}" data-name="${c.receipt_name || 'receipt'}">Open the receipt</button></div>
        <div class="row-side">${c.status === 'submitted'
          ? html`<button class="btn btn-sm btn-primary" data-act="claim-approve" data-id="${c.id}">Approve</button><button class="btn btn-sm btn-ghost" data-act="claim-decline" data-id="${c.id}">Decline</button>`
          : html`<button class="btn btn-sm btn-primary" data-act="claim-paid" data-id="${c.id}">Mark paid</button>`}</div></div>`)}</section>`)}
    ${when(open.length, html`<section class="card"><div class="card-head"><h2>Bills not paid yet</h2><span class="muted small">${open.filter(due).length} overdue</span></div>
      ${open.map((i) => html`<div class="row"><div class="row-main"><div class="row-title">${org(i)} · bill ${i.number} · ${peso(i.amount_php)}</div>
        <div class="row-sub">${due(i) ? html`<span class="due overdue">Overdue since ${fmtDate(i.due_on)}</span>` : `Due ${fmtDate(i.due_on)}`} · ${(i.lines || []).map((l) => l.label).join(', ')}</div></div>
        <div class="row-side"><button class="btn btn-sm btn-soft" data-act="care-confirm" data-id="${i.id}">Paid another way</button>
          <button class="btn btn-sm btn-ghost danger" data-act="care-void" data-id="${i.id}">Cancel bill</button></div></div>`)}</section>`)}
    ${when(gaps.length, html`<section class="card"><div class="card-head"><div><h2>Covered permits without an expiry date</h2>
      <p class="card-sub">Care can't start these renewals until the date is known. Ask the customer to add it (or a photo of the permit).</p></div></div>
      ${gaps.map((g) => html`<div class="line"><span class="line-main"><b>${g.requirement_name}</b><small>${g.org_name} · ${g.plan_label}</small></span></div>`)}</section>`)}
    <section class="card"><div class="card-head"><h2>All plans</h2><span class="muted small">${plural(live.length, 'live plan')}</span></div>
      ${plans.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Workspace</th><th>Branch or vehicle</th><th>Plan</th><th>Price</th><th>Status</th><th>Paid until</th><th><span class="sr-only">Action</span></th></tr></thead><tbody>
        ${plans.map((p) => { const [l, cls] = PLAN_STATUS[p.status] || [p.status, '']; return html`<tr class="${p.status === 'cancelled' ? 'muted' : ''}"><td>${org(p)}</td><td>${p.label}</td><td>${tierName(p.tier)}</td>
          <td>${peso(p.price_php)}/${p.billing === 'yearly' ? 'yr' : 'mo'}</td><td><span class="chip ${cls}">${l}</span>${p.cancel_at && p.status !== 'cancelled' ? html`<div class="muted small">ends ${fmtDate(p.cancel_at)}</div>` : ''}</td>
          <td>${p.paid_through ? fmtDate(p.paid_through) : '—'}</td>
          <td>${p.status !== 'cancelled' ? html`<button class="btn btn-sm btn-ghost" data-act="care-set" data-id="${p.id}">Change</button>` : ''}</td></tr>`; })}
      </tbody></table></div>` : empty('No care plans yet', 'Customers start them from Year-round care. New sign-ups also arrive by email.')}
    </section>
    <section class="card"><h2>Prices</h2><p class="muted small">New sign-ups pay these. Existing plans keep the price they started with.</p>
      ${tiers.map((t) => html`<form class="admin-tier grid2" data-code="${t.code}">
        <label class="field"><span>${t.subject === 'branch' ? 'Branch' : 'Vehicle'}: ${t.name}, per month (₱)</span><input name="monthly" type="number" min="0" step="1" value="${t.monthly_php}" required></label>
        <label class="field"><span>Per year (₱)</span><input name="yearly" type="number" min="0" step="1" value="${t.yearly_php}" required></label>
        ${t.guarantee ? html`<label class="field"><span>Guarantee limit per permit (₱)</span><input name="cap" type="number" min="0" step="100" value="${t.guarantee_cap_php}"></label>` : ''}
        <label class="check"><input type="checkbox" name="active" ${t.active ? 'checked' : ''}> <span>Offered</span></label>
        <div><button class="btn btn-sm btn-soft">Save</button></div></form>`)}
    </section>`;
}

const inv = (id) => cache.invoices.find((x) => x.id === id);
on('care-confirm', (ds) => {
  const i = inv(ds.id);
  if (!i) return;
  openModal(`Payment received: ${i.number}`, html`<p>${i.orgs?.name} · <b>${peso(i.amount_php)}</b>${i.pay_ref ? ' · ref ' + i.pay_ref : ''}</p>
    <p class="muted small">Only confirm once you see the money in your GCash or bank app. ${i.first ? 'Coverage starts today.' : ''}</p>
    <label class="field"><span>BIR invoice number <small>(you can add it later in Money)</small></span><input name="no" maxlength="60"></label>`, {
    submitLabel: 'Confirm payment',
    onSubmit: async (fd) => { await db.adminConfirmCarePayment(i.id, true, null, String(fd.get('no') || '').trim()); toast('Confirmed. The customer was told.'); rerender(); },
  });
});
on('care-nomatch', async (ds) => {
  if (!(await confirmDialog("Can't find this payment?", 'The customer is asked to check the reference and send it again.', { confirmLabel: 'Tell them', danger: false }))) return;
  try { await db.adminConfirmCarePayment(ds.id, false, null); toast('The customer was asked to check it.'); rerender(); } catch (e) { toastError(e); }
});
on('care-void', (ds) => openModal('Cancel this bill?', html`<p class="muted small">The customer sees the reason. A sign-up bill also cancels the plans on it.</p>
  <label class="field"><span>Reason</span><input name="note" required minlength="5" maxlength="500" placeholder="e.g. We can't serve this city yet."></label>`, {
  submitLabel: 'Cancel bill', danger: true,
  onSubmit: async (fd) => { await db.adminVoidCareInvoice(ds.id, String(fd.get('note')).trim()); toast('Bill cancelled.'); rerender(); },
}));
on('care-set', (ds) => {
  const p = cache.plans.find((x) => x.id === ds.id);
  if (!p) return;
  openModal(`Change ${p.label}`, html`<label class="field"><span>New status</span><select name="status">
      ${p.status !== 'active' ? html`<option value="active">Active (only if paid up)</option>` : ''}${p.status !== 'paused' ? html`<option value="paused">Paused</option>` : ''}<option value="cancelled">End the plan now</option></select></label>
    <label class="field"><span>Reason <small>(the customer sees it)</small></span><input name="note" required minlength="5" maxlength="500"></label>
    <p class="muted small">Refunds for a plan you end are sent outside PermitPal (GCash or bank).</p>`, {
    submitLabel: 'Save',
    onSubmit: async (fd) => { await db.adminSetCarePlan(p.id, fd.get('status'), String(fd.get('note')).trim()); toast('Saved. The customer was told.'); rerender(); },
  });
});
on('claim-approve', (ds) => {
  const c = cache.claims.find((x) => x.id === ds.id);
  const plan = cache.plans.find((p) => p.id === c?.plan_id);
  const cap = Number(cache.tiers.find((t) => t.code === plan?.tier)?.guarantee_cap_php || c?.penalty_php);
  openModal('Approve the claim', html`<p>${c.orgs?.name} · ${c.requirement_name} · penalty ${peso(c.penalty_php)}</p>
    <label class="field"><span>Amount to pay back (₱) <small>(limit ${peso(cap)})</small></span><input name="amount" type="number" min="1" step="0.01" max="${Math.min(cap, c.penalty_php)}" value="${Math.min(cap, c.penalty_php)}" required></label>
    <label class="field"><span>Note to the customer <small>(optional)</small></span><input name="note" maxlength="500"></label>`, {
    submitLabel: 'Approve',
    onSubmit: async (fd) => { await db.adminDecideClaim(c.id, true, Number(fd.get('amount')), String(fd.get('note') || '').trim()); toast('Approved. Send the money, then mark it paid.'); rerender(); },
  });
});
on('claim-decline', (ds) => openModal('Decline the claim', html`<p class="muted small">Explain plainly why (for example: the documents we asked for arrived after the deadline).</p>
  <label class="field"><span>Reason</span><textarea name="note" required minlength="10" maxlength="1000" rows="3"></textarea></label>`, {
  submitLabel: 'Decline', danger: true,
  onSubmit: async (fd) => { await db.adminDecideClaim(ds.id, false, null, String(fd.get('note')).trim()); toast('Declined. The customer was told why.'); rerender(); },
}));
on('claim-paid', (ds) => openModal('Mark the claim paid', html`<div class="grid2">
  <label class="field"><span>Sent by</span><input name="method" maxlength="60" placeholder="GCash / BPI" required></label>
  <label class="field"><span>Reference no.</span><input name="ref" maxlength="120"></label></div>`, {
  submitLabel: 'Mark paid',
  onSubmit: async (fd) => { const f = formObject(fd); await db.adminClaimPaid(ds.id, f.method, f.ref); toast('Marked paid. The customer was told.'); rerender(); },
}));
document.addEventListener('submit', async (e) => {
  const f = e.target;
  if (!f.matches?.('.admin-tier')) return;
  e.preventDefault();
  const fd = new FormData(f);
  const monthly = Number(fd.get('monthly')), yearly = Number(fd.get('yearly'));
  if (!(monthly >= 0) || !(yearly >= 0)) return toast('Enter prices of ₱0 or more.', 'error');
  try {
    await db.adminSaveCareTier(f.dataset.code, { monthly_php: monthly, yearly_php: yearly, active: fd.get('active') === 'on',
      ...(fd.has('cap') ? { guarantee_cap_php: Number(fd.get('cap')) || 0 } : {}) });
    toast('Saved. New sign-ups see the new price.');
  } catch (err) { toastError(err); }
});
