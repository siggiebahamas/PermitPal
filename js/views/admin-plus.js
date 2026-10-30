// Admin > Plus & staff: Pinoy Permit Plus, staff license and White-label bills. Payments by GCash/bank to confirm (the
// only thing that needs a person, and only while online checkout is off), open bills, every workspace's
// plan, and giving time (a launch partner, a goodwill month).
import { html, fmtDate, toast, toastError, when, peso, plural, todayPH, openModal, confirmDialog } from '../util.js?v=fd3a394';
import { on, rerender, has } from '../core.js?v=fd3a394';
import { addonLabel } from '../prices.js?v=fd3a394';
import * as db from 'pp/data';

const label = (i) => addonLabel(i.kind, i.people_max, i.billing);
let orgsCache = null;

export async function plusTab() {
  const [bills, addons] = await Promise.all([db.adminAddonInvoices(), db.adminAddons()]);
  const check = bills.filter((i) => i.status === 'pending_verification');
  const due = bills.filter((i) => i.status === 'due' && i.valid_until >= todayPH());
  const paid = bills.filter((i) => i.status === 'paid').slice(0, 30);
  const today = todayPH();
  const on_ = addons.filter((a) => a.paid_through >= today);
  return html`
    <section class="card"><div class="card-head"><div><h2>Payments to confirm</h2>
      <p class="card-sub">Find each one in your GCash or bank app, then confirm. It switches on for the customer straight away.</p></div></div>
      ${check.length ? check.map((i) => html`<div class="line"><div class="line-main"><b>${i.orgs?.name || 'Workspace'}: ${peso(i.amount_php)}</b>
          <small>${label(i)} · bill ${i.number} · ${String(i.pay_method || '').replace('_', ' ')}${i.pay_ref ? ` · ref ${i.pay_ref}` : ''}</small></div>
        <div class="btn-row">${when(i.proof_path, html`<button class="btn btn-sm btn-ghost" data-act="staff-file" data-path="${i.proof_path}" data-name="${i.proof_name || 'proof'}">Screenshot</button>`)}
          <button class="btn btn-sm btn-primary" data-act="addon-confirm" data-id="${i.id}">Found it</button>
          <button class="btn btn-sm btn-ghost" data-act="addon-notfound" data-id="${i.id}">Not found</button></div></div>`)
        : html`<p class="muted">Nothing to confirm.</p>`}
    </section>
    <section class="card"><div class="card-head"><div><h2>Open bills</h2><p class="card-sub">Made by the customer or 7 days before a renewal. They expire if unpaid.</p></div></div>
      ${due.length ? due.map((i) => html`<div class="line"><div class="line-main"><b>${i.orgs?.name || 'Workspace'}: ${peso(i.amount_php)}</b>
          <small>${label(i)} · bill ${i.number} · from ${fmtDate(i.period_start)} · pay by ${fmtDate(i.valid_until)}</small></div>
        <button class="btn btn-sm btn-ghost" data-act="addon-void" data-id="${i.id}">Cancel bill</button></div>`) : html`<p class="muted">None.</p>`}
    </section>
    <section class="card"><div class="card-head"><div><h2>Plans on now</h2><p class="card-sub">${plural(on_.filter((a) => a.kind === 'plus').length, 'workspace')} with Plus, ${plural(on_.filter((a) => a.kind === 'staff').length, 'workspace')} with staff licenses${has('brand') ? `, ${plural(on_.filter((a) => a.kind === 'brand').length, 'firm')} with White-label` : ''}.</p></div>
        <button class="btn btn-sm btn-primary" data-act="addon-give">Give time</button></div>
      ${on_.length ? html`<div class="table-wrap" tabindex="0" role="region" aria-label="Plans on now"><table class="table"><thead><tr><th>Workspace</th><th>Plan</th><th>Until</th><th>How</th></tr></thead><tbody>
        ${on_.map((a) => html`<tr><td>${a.orgs?.name || ''}</td><td>${a.kind === 'plus' ? 'Plus' : a.kind === 'brand' ? 'White-label' : `Staff, up to ${a.people_max}`}${a.next_people_max ? ` (then ${a.next_people_max})` : ''}</td>
          <td>${fmtDate(a.paid_through)}</td><td>${a.trial ? 'Free trial' : a.comped ? 'Given by Pinoy Permit' : a.billing === 'yearly' ? 'Paid yearly' : 'Paid monthly'}</td></tr>`)}</tbody></table></div>` : html`<p class="muted">None yet.</p>`}
    </section>
    ${paid.length ? html`<details class="card"><summary><b>Paid bills</b> <span class="muted small">latest ${paid.length}</span></summary>
      ${paid.map((i) => html`<div class="line"><div class="line-main"><b>${i.orgs?.name || ''}: ${peso(i.amount_php)}</b><small>${label(i)} · bill ${i.number} · ${fmtDate(String(i.paid_at || '').slice(0, 10))}${i.bir_invoice_no ? ` · BIR ${i.bir_invoice_no}` : ''}</small></div></div>`)}</details>` : ''}`;
}

on('addon-confirm', (ds) => {
  openModal('Payment found', html`<p class="muted small">It switches on for the customer now, and they get a receipt notification.</p>
    <label class="field"><span>BIR invoice / receipt number <small>(optional, add later under Money)</small></span><input name="no" maxlength="60"></label>`, {
    submitLabel: 'Confirm', danger: false,
    onSubmit: async (fd) => { await db.adminConfirmAddonPayment(ds.id, true, null, String(fd.get('no') || '').trim()); toast('Confirmed. It is on.'); rerender(); },
  });
});
on('addon-notfound', (ds) => {
  openModal("Couldn't find the payment", html`<label class="field"><span>What to tell the customer</span><input name="note" maxlength="300" value="We could not find this payment. Please check the reference number and send it again."></label>`, {
    submitLabel: 'Send', danger: false,
    onSubmit: async (fd) => { await db.adminConfirmAddonPayment(ds.id, false, String(fd.get('note') || '').trim()); toast('Sent back to the customer.'); rerender(); },
  });
});
on('addon-void', async (ds) => {
  if (!(await confirmDialog('Cancel this bill?', 'The customer can make a new one anytime.', { confirmLabel: 'Cancel bill' }))) return;
  try { await db.adminVoidAddonInvoice(ds.id, 'Cancelled by Pinoy Permit.'); rerender(); } catch (e) { toastError(e); }
});
on('addon-give', async () => {
  try { orgsCache ||= await db.adminOrgs(); } catch (e) { return toastError(e); }
  const until = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  openModal('Give time (no bill)', html`
    <label class="field"><span>Workspace</span><select name="org">${orgsCache.map((o) => html`<option value="${o.id}">${o.name}</option>`)}</select></label>
    <div class="grid2"><label class="field"><span>Plan</span><select name="kind"><option value="plus">Pinoy Permit Plus</option><option value="staff">Staff licenses</option>${has('brand') ? html`<option value="brand">White-label (accounting firms)</option>` : ''}</select></label>
      <label class="field"><span>People <small>(staff licenses)</small></span><input type="number" name="people" min="4" max="5000" value="10"></label></div>
    <label class="field"><span>Until</span><input type="date" name="until" value="${until}" required></label>
    <label class="field"><span>Note to the customer <small>(optional)</small></span><input name="note" maxlength="200" placeholder="e.g. Thanks for being an early customer"></label>`, {
    submitLabel: 'Give it', danger: false,
    onSubmit: async (fd) => {
      const kind = fd.get('kind');
      await db.adminSetAddon(fd.get('org'), kind, kind === 'staff' ? Number(fd.get('people')) : null, fd.get('until'), String(fd.get('note') || '').trim());
      toast('Done. The owner was told.');
      rerender();
    },
  });
});
