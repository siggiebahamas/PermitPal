// Every payment this workspace made to Pinoy Permit, in one list (Settings > Plan): the team plan, Plus and staff
// licenses, wallet top-ups. Each one says what it was for, how it was paid and whether we've confirmed it. A
// confirmed payment has an acknowledgment the customer can print or save as a PDF.
// Paying for a team plan: the customer tells us how they paid (reference and/or screenshot) and sees it at once.
import { html, openModal, toast, peso, fmtDate } from '../util.js?v=199b984';
import { S, on, has, isOrgAdmin, plusOf, rerender } from '../core.js?v=199b984';
import { ICON } from '../components.js?v=199b984';
import { printSheet } from '../print.js?v=199b984';
import { loadStateNow } from './load.js?v=199b984';
import { payDetails, paySettings } from './services.js?v=199b984';
import { planTotal } from '../prices.js?v=199b984';
import * as db from 'pp/data';

const METHOD = { gcash: 'GCash', maya: 'Maya', bank_transfer: 'Bank transfer', other: 'Other' };
const STATUS = { paid: ['ok', 'Confirmed'], pending: ['progress', "We're checking it"], pending_verification: ['progress', "We're checking it"], due: ['soon', 'Waiting for your payment'] };
const day = (t) => (t ? fmtDate(String(t).slice(0, 10)) : '');
let rows = [];

// One shape for every kind of payment.
async function gather() {
  if (!isOrgAdmin()) return [];
  const out = [];
  const plans = await db.payments(S.org.id).catch(() => []);
  for (const p of plans) {
    if (p.addon_invoice_id || p.load_topup_id || p.request_id) continue; // listed below with their own bill
    if (!(p.status === 'paid' || (p.status === 'pending' && p.provider === 'manual'))) continue;
    const name = S.plans.find((x) => x.id === p.plan_id)?.name || 'Team plan';
    out.push({ key: 'p' + p.id, no: 'PP-' + String(p.id).slice(0, 8).toUpperCase(), what: `${name} plan · ${p.months === 12 ? '12 months (2 months free)' : p.months + (p.months === 1 ? ' month' : ' months')}`,
      amount: Number(p.amount_php), status: p.status, sent: p.reported_at || p.created_at, paid: p.paid_at, method: p.method, ref: p.reference, proof: !!p.proof_path });
  }
  for (const i of plusOf().invoices || []) {
    if (!['paid', 'pending_verification', 'due'].includes(i.status)) continue;
    out.push({ key: 'a' + i.id, no: i.number, what: `${i.kind === 'staff' ? 'Staff licenses' : 'Pinoy Permit Plus'} · ${i.months === 12 ? '12 months' : '1 month'}`, amount: Number(i.amount_php),
      status: i.status, sent: i.reported_at || i.created_at, paid: i.paid_at, method: i.pay_method, ref: i.pay_ref, proof: !!i.proof_path });
  }
  for (const t of loadStateNow()?.topups || []) {
    if (!['paid', 'pending_verification'].includes(t.status)) continue;
    out.push({ key: 'l' + t.id, no: t.number, what: 'Wallet top-up', amount: Number(t.amount_php), status: t.status, sent: t.reported_at || t.created_at, paid: t.paid_at,
      method: t.pay_method, ref: t.pay_ref, proof: !!t.proof_path });
  }
  return out.sort((a, b) => String(b.paid || b.sent || '').localeCompare(String(a.paid || a.sent || '')));
}

export async function paymentsCard() {
  if (!has('payproof') || !isOrgAdmin()) return '';
  rows = await gather();
  return html`<section class="card pay-hist" id="payments"><div class="card-head"><div><h2>Your payments</h2>
      <p class="card-sub">Everything you paid Pinoy Permit, and whether we've confirmed it. Tap a confirmed payment for your acknowledgment.</p></div></div>
    ${rows.length ? html`<ul class="ph-list">${rows.map((r) => html`<li>
      <button type="button" class="ph-row" data-act="pay-ack" data-key="${r.key}" aria-label="${r.what}, ${peso(r.amount)}, ${STATUS[r.status][1]}">
        <span class="ph-ic ${STATUS[r.status][0]}" aria-hidden="true">${r.status === 'paid' ? ICON.check : ICON.calendar}</span>
        <span class="ph-main"><b>${r.what}</b><small>${r.status === 'paid' ? `Confirmed ${day(r.paid)}` : `Sent ${day(r.sent)}`}${r.method ? ` · ${METHOD[r.method] || r.method}` : ''}${r.ref ? ` · Ref ${r.ref}` : ''}${r.proof ? ' · Screenshot sent' : ''}</small></span>
        <span class="ph-amt"><b>${peso(r.amount)}</b><span class="chip ${STATUS[r.status][0]}">${STATUS[r.status][1]}</span></span></button></li>`)}</ul>`
      : html`<p class="muted">No payments yet. When you pay for a plan, Plus or a wallet top-up, it shows here with its status.</p>`}
  </section>`;
}

const ackHtml = (r) => html`<article class="ack">
  <header class="ack-head"><b>Pinoy Permit</b><span>Acknowledgment of payment</span></header>
  <dl class="ack-dl">
    <div><dt>Acknowledgment no.</dt><dd>${r.no}</dd></div>
    <div><dt>Received from</dt><dd>${S.org.name}</dd></div>
    <div><dt>For</dt><dd>${r.what}</dd></div>
    <div><dt>Amount</dt><dd class="ack-amt">${peso(r.amount)}</dd></div>
    <div><dt>Paid by</dt><dd>${METHOD[r.method] || r.method || '—'}${r.ref ? ` · Ref ${r.ref}` : ''}</dd></div>
    <div><dt>Payment sent</dt><dd>${day(r.sent) || '—'}</dd></div>
    <div><dt>Confirmed</dt><dd>${day(r.paid)}</dd></div>
  </dl>
  <p class="ack-note">This confirms that Pinoy Permit received the payment above. It is an acknowledgment, not an official receipt.</p>
</article>`;

on('pay-ack', (ds) => {
  const r = rows.find((x) => x.key === ds.key);
  if (!r) return;
  if (r.status !== 'paid') {
    openModal(r.status === 'due' ? 'Waiting for your payment' : "We're checking your payment", html`<p><b>${r.what}</b>: ${peso(r.amount)}.</p>
      ${r.status === 'due' ? html`<p>Pay it from the bill, then tell us how you paid.</p>` : html`<p>You sent it on ${day(r.sent)}${r.method ? ` by ${METHOD[r.method] || r.method}` : ''}${r.ref ? `, reference ${r.ref}` : ''}${r.proof ? ', with a screenshot' : ''}.</p>
      <p>We match it within 1 business day. When it's confirmed you get a notification and an email, and your acknowledgment appears here.</p>`}`, { cancelLabel: 'OK' });
    return;
  }
  openModal('Acknowledgment of payment', html`${ackHtml(r)}<div class="btn-row"><button type="button" class="btn btn-primary" data-ack-print="${r.key}">${ICON.download} Print or save as PDF</button></div>`, { cancelLabel: 'Close' });
});
document.addEventListener('click', (e) => {
  const b = e.target.closest?.('[data-ack-print]');
  if (!b) return;
  const r = rows.find((x) => x.key === b.dataset.ackPrint);
  if (r) printSheet(String(ackHtml(r)), { cls: 'ack-print' });
});

// "I've paid": what it was for, how, and the reference or a screenshot.
export async function openPlanPay(planId) {
  const p = S.plans.find((x) => x.id === planId);
  if (!p) return;
  const m = Number(p.price_php_monthly), y = planTotal(m, 12);
  const st = await paySettings().catch(() => ({}));
  openModal(`Pay for ${p.name}`, html`
    <p>What did you pay for?</p>
    <div class="radio-cards">
      <label class="radio-card on"><input type="radio" name="months" value="12" checked><span><b>12 months: ${peso(y)}</b><small>2 months free</small></span></label>
      <label class="radio-card"><input type="radio" name="months" value="1"><span><b>1 month: ${peso(m)}</b></span></label></div>
    ${payDetails(st)}
    <div class="grid2">
      <label class="field"><span>Paid with</span><select name="method"><option value="gcash">GCash</option><option value="maya">Maya</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option></select></label>
      <label class="field"><span>Reference number</span><input name="ref" maxlength="120" placeholder="e.g. 1009 234 567890"></label>
    </div>
    ${has('payproof') ? html`<label class="field"><span>Screenshot of the payment <small>(optional if you entered the reference)</small></span><input type="file" name="file" accept="image/*,.pdf"></label>` : ''}
    <p class="muted small">We match your payment and turn the plan on within 1 business day. You'll see it under "Your payments" right away.</p>`, {
    submitLabel: "I've paid", danger: false,
    onSubmit: async (fd) => {
      const ref = String(fd.get('ref') || '').trim();
      const file = fd.get('file');
      if (!ref && !(file && file.size)) throw new Error('Add the reference number or a screenshot of the payment, so we can find it.');
      const months = Number(fd.get('months'));
      if (!has('payproof')) { // the database part isn't on yet: send it the old way, as a message to staff
        await db.requestPlan(S.org.id, planId, `Paid for ${months === 12 ? `12 months (${peso(y)})` : `1 month (${peso(m)})`} by ${fd.get('method')}${ref ? `, ref ${ref}` : ''}`);
        toast("Thanks! We'll confirm and turn your plan on within 1 business day."); return;
      }
      await db.planPaymentReport(S.org.id, { plan: planId, months, method: fd.get('method'), ref, file });
      toast("Thanks! We'll confirm it within 1 business day. You can see it under Your payments.");
      setTimeout(() => { rerender(); setTimeout(() => document.getElementById('payments')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300); }, 50);
    },
  });
  document.querySelectorAll('#modal-root .radio-card input').forEach((i) => i.addEventListener('change', () => document.querySelectorAll('#modal-root .radio-card').forEach((c) => c.classList.toggle('on', c.contains(document.querySelector('#modal-root .radio-card input:checked'))))));
}
