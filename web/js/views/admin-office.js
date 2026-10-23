// Admin > Bills & clock: city bills customers asked PermitPal to pay (confirm their payment, pay the office by the
// promised time, add the official receipt, or send everything back), offices running past their legal deadline,
// the national holiday calendar the clock counts with, and the bill-paying settings.
// Every rule is enforced by the database; this page only asks it.
import { html, fmtDate, fmtDateTime, toast, toastError, when, peso, plural, openModal, todayPH } from '../util.js';
import { S, on, rerender, has } from '../core.js';
import { paySettings } from './services.js';
import * as db from 'pp/data';

let cache = { bills: [], filings: [], holidays: [], settings: {} };
const dueWhen = (iso) => new Date(iso).toLocaleString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });
const total = (b) => Number(b.amount_php) + Number(b.fee_php);
const shift = (n) => { const d = new Date(todayPH() + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export async function officeTab() {
  const [bills, filings, holidays, settings] = await Promise.all([
    has('billpay') ? db.adminBills() : [], has('clock') ? db.adminFilings() : [], has('clock') ? db.holidays(todayPH(), shift(400)) : [], paySettings()]);
  cache = { bills, filings, holidays, settings };
  const pp = bills.filter((b) => b.mode === 'permitpal');
  const toCheck = pp.filter((b) => b.status === 'pending_verification');
  const toPay = pp.filter((b) => b.status === 'processing').sort((a, b) => a.pay_deadline.localeCompare(b.pay_deadline));
  const lateBills = toPay.filter((b) => new Date(b.pay_deadline) < new Date());
  const done = pp.filter((b) => ['paid', 'refunded'].includes(b.status)).slice(0, 20);
  const lateFilings = filings.filter((f) => f.workdays_late > 0);
  return html`
    <div class="stats four">
      <div class="stat ${toCheck.length ? 'soon' : 'ok'}"><div class="stat-n">${toCheck.length}</div><div class="stat-l">Bill payments to confirm</div></div>
      <div class="stat ${lateBills.length ? 'overdue' : toPay.length ? 'soon' : 'ok'}"><div class="stat-n">${toPay.length}</div><div class="stat-l">Bills to pay${lateBills.length ? ` (${lateBills.length} late)` : ''}</div></div>
      <div class="stat"><div class="stat-n">${peso(toPay.reduce((t, b) => t + Number(b.amount_php), 0))}</div><div class="stat-l">Customers' money to pay out</div></div>
      <div class="stat ${lateFilings.length ? 'overdue' : 'ok'}"><div class="stat-n">${lateFilings.length}</div><div class="stat-l">Offices past their deadline</div></div>
    </div>
    ${when(has('billpay'), html`
    <section class="card"><div class="card-head"><div><h2>Bills to pay</h2>
      <p class="card-sub">Pay the office (its online payment, or at its window), then add the official receipt. We promised each customer the time shown.</p></div></div>
      ${toPay.length ? toPay.map((b) => html`<div class="line"><div class="line-main"><b>${b.office}: ${peso(b.amount_php)}</b>
          <small>${b.orgs?.name || ''} · ${b.number}${b.bill_ref ? ` · bill no. ${b.bill_ref}` : ''}${b.pay_by ? ` · office's due date ${fmtDate(b.pay_by)}` : ''} · ${b.label}</small></div>
        <div class="btn-row"><span class="chip ${new Date(b.pay_deadline) < new Date() ? 'overdue' : 'soon'}">By ${dueWhen(b.pay_deadline)}</span>
          ${when(b.bill_path, html`<button class="btn btn-sm btn-ghost" data-act="staff-file" data-path="${b.bill_path}" data-name="${b.bill_name || 'bill'}">The bill</button>`)}
          <button class="btn btn-sm btn-primary" data-act="adm-bill-paid" data-id="${b.id}">Paid: add receipt</button>
          <button class="btn btn-sm btn-ghost" data-act="adm-bill-refund" data-id="${b.id}">Can't pay</button></div></div>`)
        : html`<p class="muted">Nothing to pay.</p>`}
    </section>
    <section class="card"><div class="card-head"><div><h2>Bill payments to confirm</h2>
      <p class="card-sub">Find each one in your GCash or bank app. Once confirmed, the customer is told when we'll pay the office.</p></div></div>
      ${toCheck.length ? toCheck.map((b) => html`<div class="line"><div class="line-main"><b>${b.orgs?.name || 'Workspace'}: ${peso(total(b))}</b>
          <small>${b.number} · ${b.office} ${peso(b.amount_php)} + fee ${peso(b.fee_php)} · ${String(b.pay_method || '').replace('_', ' ')}${b.pay_ref ? ` · ref ${b.pay_ref}` : ''} · ${fmtDateTime(b.reported_at)}</small></div>
        <div class="btn-row">${when(b.proof_path, html`<button class="btn btn-sm btn-ghost" data-act="staff-file" data-path="${b.proof_path}" data-name="${b.proof_name || 'proof'}">Screenshot</button>`)}
          <button class="btn btn-sm btn-primary" data-act="adm-bill-ok" data-id="${b.id}">Found it</button>
          <button class="btn btn-sm btn-ghost" data-act="adm-bill-no" data-id="${b.id}">Not found</button></div></div>`)
        : html`<p class="muted">Nothing to confirm.</p>`}
    </section>
    ${when(done.length, html`<details class="card"><summary><b>Recently paid or sent back</b> <span class="muted small">${plural(done.length, 'bill')}</span></summary>
      ${done.map((b) => html`<div class="line"><div class="line-main"><b>${b.office}: ${peso(b.amount_php)}</b>
        <small>${b.orgs?.name || ''} · ${b.number} · ${b.status === 'paid' ? `paid ${fmtDateTime(b.paid_at)}, OR ${b.or_no}` : `sent back ${fmtDateTime(b.refunded_at)}`}</small></div>
        <span class="chip ${b.status === 'paid' ? 'ok' : 'needinfo'}">${b.status === 'paid' ? 'Paid' : 'Sent back'}</span></div>`)}</details>`)}
    <section class="card"><div class="card-head"><div><h2>Paying bills: settings</h2><p class="card-sub">Customers see these at once. Bills already added keep their fee.</p></div></div>
      <form class="adm-bill-settings"><div class="grid2">
        <label class="field"><span>Our fee per bill (₱)</span><input name="fee" type="number" min="0" max="5000" step="1" value="${settings.billpay_fee ?? 499}"></label>
        <label class="field"><span>Biggest bill we pay (₱)</span><input name="max" type="number" min="100" max="1000000" step="100" value="${settings.billpay_max ?? 50000}"></label></div>
        <label class="check"><input type="checkbox" name="open" ${(settings.billpay_open ?? 'on') === 'on' ? 'checked' : ''}> Take new bills to pay (untick to pause; bills already sent are still paid)</label>
        <button type="button" class="btn btn-sm btn-soft" data-act="adm-bill-settings">Save</button></form>
    </section>`)}
    ${when(has('clock'), html`
    <section class="card"><div class="card-head"><div><h2>Offices on the clock</h2>
      <p class="card-sub">Every filing still waiting, nearest deadline first. Orders we filed are ours to chase; customers chase their own, with the letters in the app.</p></div></div>
      ${filings.length ? filings.map((f) => html`<div class="line"><div class="line-main"><b>${f.office}</b>
          <small>${f.org_name} · ${f.label} · filed ${fmtDate(f.filed_on)}${f.reference_no ? ` · ref ${f.reference_no}` : ''}${f.request_id ? ' · our order' : ''}${f.followup_at ? ' · follow-up sent' : ''}${f.complaint_at ? ' · ARTA complaint' : ''}</small></div>
        <div class="btn-row"><span class="chip ${f.workdays_late ? 'overdue' : f.due_on === todayPH() ? 'soon' : 'progress'}">${f.workdays_late ? `Late by ${plural(f.workdays_late, 'working day')}` : `Until ${fmtDate(f.due_on)}`}</span>
          ${when(f.request_id, html`<button class="btn btn-sm btn-ghost" data-act="admin-open-order" data-id="${f.request_id}">Order</button>
            <button class="btn btn-sm btn-soft" data-act="adm-clock-done" data-id="${f.id}">Released</button>`)}</div></div>`)
        : html`<p class="muted">No filings waiting.</p>`}
    </section>
    <section class="card"><div class="card-head"><div><h2>Days offices are closed</h2>
      <p class="card-sub">National holidays the clock skips. Add Eid'l Fitr and Eid'l Adha when they're declared, and any day off announced for all offices. Running deadlines move by themselves.</p></div>
      <button class="btn btn-sm btn-soft" data-act="adm-holiday-add">Add a day</button></div>
      <div class="hol-list">${holidays.slice(0, 6).map(holRow)}</div>
      ${when(holidays.length > 6, html`<details class="hol-more"><summary>All ${holidays.length} days in the next 13 months</summary><div class="hol-list">${holidays.slice(6).map(holRow)}</div></details>`)}
    </section>`)}`;
}

const holRow = (h) => html`<div class="hol-row"><span><b>${fmtDate(h.day)}</b> ${h.name} <small class="muted">${h.kind}</small></span>
  <button class="btn btn-sm btn-ghost" data-act="adm-holiday-remove" data-day="${h.day}" aria-label="Remove ${h.name}">Remove</button></div>`;
const reload = async () => { try { await rerender(); } catch (e) { toastError(e); } };
const billOf = (id) => cache.bills.find((b) => b.id === id);
on('adm-bill-ok', (ds) => {
  const b = billOf(ds.id); if (!b) return;
  openModal(`Confirm ${peso(total(b))} from ${b.orgs?.name || 'the customer'}`, html`<p>${b.number}: ${String(b.pay_method || '').replace('_', ' ')}${b.pay_ref ? `, ref ${b.pay_ref}` : ''}.
    Once confirmed, the customer is told we'll pay ${b.office} by 6 pm the next business day.</p>
    <label class="field"><span>BIR invoice no. for our ${peso(b.fee_php)} fee <small>(optional; add it later in Money)</small></span><input name="inv" maxlength="60"></label>`, {
    submitLabel: 'Confirm',
    onSubmit: async (fd) => { await db.adminBillReceived(b.id, true, null, String(fd.get('inv') || '').trim()); toast('Confirmed. Pay the office before the time shown.'); reload(); },
  });
});
on('adm-bill-no', (ds) => {
  const b = billOf(ds.id); if (!b) return;
  openModal("Couldn't find the payment", html`<label class="field"><span>What to tell the customer</span><textarea name="note" rows="2" maxlength="500">We could not find this payment. Please check the reference number and send it again.</textarea></label>`, {
    submitLabel: 'Send back to the customer',
    onSubmit: async (fd) => { await db.adminBillReceived(b.id, false, String(fd.get('note') || '').trim()); toast('Sent back to the customer.'); reload(); },
  });
});
on('adm-bill-paid', (ds) => {
  const b = billOf(ds.id); if (!b) return;
  openModal(`Paid ${b.office}: ${peso(b.amount_php)}`, html`<p class="muted small">The receipt goes on the customer's permit, and they're told it's paid.</p>
    <div class="grid2"><label class="field"><span>Official receipt no.</span><input name="or_no" maxlength="60" required></label>
      <label class="field"><span>Date on the receipt</span><input type="date" name="or_date" required max="${todayPH()}" value="${todayPH()}"></label></div>
    <label class="field"><span>Photo or PDF of the official receipt</span><input type="file" name="file" accept="image/*,.pdf" required></label>`, {
    submitLabel: 'Save: paid',
    onSubmit: async (fd) => {
      const file = fd.get('file');
      if (!(file && file.size)) throw new Error('Add the official receipt.');
      await db.adminBillPaid(b, { or_no: String(fd.get('or_no')).trim(), or_date: fd.get('or_date'), file });
      toast('Paid. The customer has the receipt.'); reload();
    },
  });
});
on('adm-bill-refund', (ds) => {
  const b = billOf(ds.id); if (!b) return;
  openModal(`Send back ${peso(total(b))}`, html`<p class="muted small">Send the money back first (the way they paid), then record it. They get all of it: the bill's amount and our fee.</p>
    <label class="field"><span>Why we couldn't pay it <small>(the customer reads this)</small></span><textarea name="note" rows="2" maxlength="400" required placeholder="e.g. The office only takes payment at its own window."></textarea></label>
    <div class="grid2"><label class="field"><span>Sent back by</span><select name="method"><option value="gcash">GCash</option><option value="maya">Maya</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option></select></label>
      <label class="field"><span>Reference no.</span><input name="ref" maxlength="120"></label></div>`, {
    submitLabel: 'Record the refund', danger: true,
    onSubmit: async (fd) => { await db.adminBillRefund(b.id, String(fd.get('note')).trim(), fd.get('method'), String(fd.get('ref') || '').trim()); toast('Recorded. The customer is told.'); reload(); },
  });
});
on('adm-bill-settings', async (ds, btn) => {
  const form = btn.closest('form');
  const fee = Number(form.fee.value); const max = Number(form.max.value);
  if (!(fee >= 0 && fee <= 5000)) return toast('The fee is ₱0 to ₱5,000.', 'error');
  if (!(max >= 100 && max <= 1000000)) return toast('The biggest bill is ₱100 to ₱1,000,000.', 'error');
  try {
    await db.adminSaveSetting('billpay_fee', String(Math.round(fee)));
    await db.adminSaveSetting('billpay_max', String(Math.round(max)));
    await db.adminSaveSetting('billpay_open', form.open.checked ? 'on' : 'off');
    toast('Saved.'); reload();
  } catch (e) { toastError(e); }
});
on('adm-clock-done', async (ds) => { try { await db.adminCloseFiling(ds.id, 'released'); toast('Marked released.'); reload(); } catch (e) { toastError(e); } });
on('adm-holiday-add', () => {
  openModal('A day offices are closed', html`<div class="grid2"><label class="field"><span>Day</span><input type="date" name="day" required min="${shift(-365)}"></label>
    <label class="field"><span>Kind</span><select name="kind"><option value="regular">Regular holiday</option><option value="special" selected>Special (non-working) day</option></select></label></div>
    <label class="field"><span>Name</span><input name="name" maxlength="80" required placeholder="e.g. Eid'l Fitr"></label>`, {
    submitLabel: 'Add',
    onSubmit: async (fd) => { await db.adminSetHoliday(fd.get('day'), String(fd.get('name')).trim(), fd.get('kind'), false); toast('Added. Running deadlines moved.'); reload(); },
  });
});
on('adm-holiday-remove', async (ds) => { try { await db.adminSetHoliday(ds.day, null, null, true); toast('Removed.'); reload(); } catch (e) { toastError(e); } });

// On an order we filed (Admin > Orders): start the customer's processing clock.
export const clockStartButton = (a) => (has('clock') && a.requirement_id && !['completed', 'cancelled'].includes(a.status)
  ? html`<section class="card"><h2>Filed with the office?</h2><p class="muted small">Start the processing clock. The customer sees the office's legal deadline on the order and the permit, and you're told the morning it runs late.</p>
    <button class="btn btn-sm btn-soft" data-act="adm-clock-start" data-id="${a.id}" data-office="${a.location_label || ''}">Start the clock</button></section>` : '');
on('adm-clock-start', (ds) => {
  openModal('Start the processing clock', html`<label class="field"><span>Office we filed with</span><input name="office" maxlength="160" required></label>
    <div class="grid2"><label class="field"><span>Day we filed (complete papers)</span><input type="date" name="filed_on" required max="${todayPH()}" value="${todayPH()}"></label>
      <label class="field"><span>Reference or claim stub no.</span><input name="reference_no" maxlength="120"></label></div>
    <div class="grid2"><label class="field"><span>Processing time</span><select name="kind"><option value="simple">Simple: 3 working days</option><option value="complex">Complex: 7 working days</option>
      <option value="technical">Highly technical: 20 working days</option><option value="charter">Citizen's Charter (enter days)</option></select></label>
      <label class="field"><span>Working days <small>(Citizen's Charter only)</small></span><input type="number" name="days" min="1" max="60"></label></div>`, {
    submitLabel: 'Start the clock',
    onSubmit: async (fd) => {
      const v = Object.fromEntries(fd);
      await db.adminStartFiling(ds.id, { office: v.office.trim(), reference_no: v.reference_no.trim(), filed_on: v.filed_on, kind: v.kind, days: v.kind === 'charter' ? v.days : null });
      toast('Clock started. The customer sees it on the order.'); reload();
    },
  });
});
