// PermitPal Plus and staff licences: the cards under Settings > Plan, bills and paying them, the free
// trial, and the "this comes with Plus" pop-up used wherever a Plus feature is opened without it.
// Every price shown comes from the same rule the database uses; before anything is charged the
// database works the bill out itself (addon_preview), and that's what the confirmation shows.
import { html, openModal, confirmDialog, toast, toastError, when, fmtDate, peso, plural, todayPH, daysBetween } from '../util.js';
import { S, on, reload, isOrgAdmin, has, addonOf, addonActive, plusOf, plusIncluded, hasPlus, peopleAllowed, effectivePlan } from '../core.js';
import { FREE_PEOPLE, PLUS_MONTHLY, YEAR_MONTHS, staffBands, staffMonthly, addonPrice, addonLabel } from '../prices.js';
import { payDetails, paySettings } from './services.js';
import * as db from 'pp/data';

const BILL_STATUS = { due: ['To pay', 'soon'], pending_verification: ['Checking your payment', 'progress'], paid: ['Paid', 'ok'], cancelled: ['Replaced or cancelled', 'needinfo'] };
const label = (i) => addonLabel(i.kind, i.people_max, i.billing);
const openBills = () => plusOf().invoices.filter((i) => ['due', 'pending_verification'].includes(i.status) && i.valid_until >= todayPH());
const activePeople = () => (S.data?.people || []).length;
export const PLUS_PERKS = [
  ['Public permit page', 'One link and a QR poster for your wall: customers, clients and inspectors see each permit\'s status, live. Badges for your email and website.'],
  ['Renewals sent for you', 'Your clients, mall or landlord get an email, with the copy, each time you renew a permit.'],
  ['Automatic permit check', 'Every morning PermitPal looks for expired permits, missing copies and dates that look wrong, and emails you a report on the 1st.'],
  ['Ready-to-use templates', 'Authorization letter, SPA, affidavit of loss and more, filled in with your details.'],
];

// ---------------------------------------------------------------- "this comes with Plus"
export function openUpsell(what = 'Plus') {
  const plus = addonOf('plus');
  const canTrial = isOrgAdmin() && !plus?.trial_used_on && !plus?.started_on && !hasPlus();
  openModal(`${what} comes with PermitPal Plus`, html`
    <p><b>₱${PLUS_MONTHLY} a month</b> <span class="muted">(or ₱${(PLUS_MONTHLY * YEAR_MONTHS).toLocaleString()} a year: 2 months free)</span>. Included in every team plan.</p>
    <ul class="plus-perks">${PLUS_PERKS.map(([t, d]) => html`<li><b>${t}.</b> ${d}</li>`)}</ul>
    ${isOrgAdmin() ? '' : html`<p class="muted small">Ask your workspace owner to turn it on under Settings > Plan.</p>`}`, {
    submitLabel: canTrial ? 'Try it free for 14 days' : 'See Plus',
    cancelLabel: 'Not now',
    onSubmit: async () => {
      if (canTrial) { await startTrial(); return; }
      location.hash = '#/settings/billing';
    },
  });
}
async function startTrial() {
  const until = await db.startPlusTrial(S.org.id);
  await reload();
  toast(`Plus is on, free until ${fmtDate(until)}. Your first permit check is ready.`);
}
// A database refusal that means "not on your plan": offer the way in instead of an error. True if handled.
export function handlePlanError(err, what) {
  if (err?.hint === 'plus') { openUpsell(what); return true; }
  if (err?.hint === 'seat_limit') { openSeatLimit(err.message); return true; }
  return false;
}
export function openSeatLimit(message) {
  openModal('Track more people', html`<p>${message || `You've reached the people your plan covers.`}</p>
    ${peopleNote()}`, {
    submitLabel: isOrgAdmin() ? 'Add staff licences' : 'OK',
    onSubmit: () => { if (isOrgAdmin()) location.hash = '#/settings/billing?staff=1'; },
  });
}
const peopleNote = () => html`<p class="muted small">The first ${FREE_PEOPLE} people are free. Each extra person is ₱100 a month, ₱60 from the 21st, ₱40 from the 101st.</p>`;

// ---------------------------------------------------------------- Settings > Plan
export function addonSection(pay) {
  if (!has('plus')) return '';
  const plus = addonOf('plus');
  const staff = addonOf('staff');
  const stopping = plusOf().stopping || {};
  const admin = isOrgAdmin();
  const bills = plusOf().invoices;
  const open = openBills();
  const plusOn = addonActive(plus);
  const included = plusIncluded();
  const n = activePeople();
  const allowed = peopleAllowed();
  const staffOn = addonActive(staff);

  const plusStatus = included ? html`<span class="chip ok">Included in your ${effectivePlan()?.name || 'team'} plan</span>`
    : plusOn && plus.trial ? html`<span class="chip progress">Free trial: ${plural(Math.max(0, daysBetween(todayPH(), plus.paid_through) + 1), 'day')} left</span>`
    : plusOn ? html`<span class="chip ok">On until ${fmtDate(plus.paid_through)}</span>`
    : html`<span class="chip needinfo">Off</span>`;
  const plusActions = included || !admin ? '' : plusOn && !plus.trial ? html`
      ${stopping.plus ? html`<p class="small">Ends on ${fmtDate(stopping.plus)}. <button class="linklike" data-act="addon-resume" data-kind="plus">Keep it</button></p>`
        : html`<div class="btn-row">${when(plus.billing === 'monthly', html`<button class="btn btn-sm btn-soft" data-act="addon-choose" data-kind="plus" data-billing="yearly">Switch to yearly (2 months free)</button>`)}
          <button class="btn btn-sm btn-ghost" data-act="addon-stop" data-kind="plus">Stop at the end of the period</button></div>`}`
    : html`<div class="btn-row">
        ${when(!plus?.trial_used_on && !plus?.started_on && !plusOn, html`<button class="btn btn-primary" data-act="plus-trial">Try free for 14 days</button>`)}
        <button class="btn ${plusOn ? 'btn-primary' : 'btn-soft'}" data-act="addon-choose" data-kind="plus" data-billing="monthly">${plusOn ? 'Keep it' : 'Turn on'}: ₱${PLUS_MONTHLY}/month</button>
        <button class="btn btn-ghost" data-act="addon-choose" data-kind="plus" data-billing="yearly">₱${(PLUS_MONTHLY * YEAR_MONTHS).toLocaleString()}/year</button></div>`;

  const staffStatus = staffOn
    ? html`<span class="chip ok">Up to ${staff.people_max} people until ${fmtDate(staff.paid_through)}</span>`
    : html`<span class="chip ${n >= FREE_PEOPLE ? 'soon' : 'needinfo'}">Free: ${n} of ${FREE_PEOPLE} people</span>`;
  const startAt = Math.max(FREE_PEOPLE + 1, n, staffOn ? staff.people_max + 5 : 0);
  return html`
    <h3 class="section-label" id="addons">Add-ons</h3>
    ${open.length ? html`<section class="card bills-due"><div class="card-head"><h2>To pay</h2></div>${open.map(billRow)}</section>` : ''}
    <div class="svc-grid">
      <section class="card svc plus-card ${plusOn || included ? 'plan-current' : ''}">
        <div class="svc-top"><h2>PermitPal Plus</h2><div class="svc-price"><b>₱${PLUS_MONTHLY}</b><small>per month</small></div></div>
        <p>${plusStatus}</p>
        <ul class="svc-inc">${PLUS_PERKS.map(([t]) => html`<li>${t}</li>`)}</ul>
        ${plusActions}
      </section>
      <section class="card svc staff-card ${staffOn ? 'plan-current' : ''}" id="staff-licences">
        <div class="svc-top"><h2>Staff licences</h2><div class="svc-price"><b>₱100</b><small>per extra person a month</small></div></div>
        <p>${staffStatus}</p>
        <p class="muted small">Track ${FREE_PEOPLE} people free: their licences, reminders to them and to you, and their own upload link. More people: ₱100 each a month up to the 20th, ₱60 each from the 21st, ₱40 each from the 101st. Yearly is 10 months' price.</p>
        ${staffOn && staff.next_people_max ? html`<p class="small">From ${fmtDate(staff.paid_through)}: up to ${staff.next_people_max} people (${peso(addonPrice('staff', staff.next_people_max, staff.next_billing || staff.billing))} a ${staff.next_billing === 'yearly' ? 'year' : 'month'}).</p>` : ''}
        ${stopping.staff ? html`<p class="small">Ends on ${fmtDate(stopping.staff)}: then reminders pause for everyone above the free ${FREE_PEOPLE}. <button class="linklike" data-act="addon-resume" data-kind="staff">Keep it</button></p>` : ''}
        ${admin ? html`<form class="staff-calc" data-staff-calc>
            <label class="field"><span>How many people do you need to track?</span>
              <input type="number" name="people" min="${Math.max(FREE_PEOPLE + 1, n)}" max="5000" step="1" inputmode="numeric" value="${startAt}"></label>
            <div class="paytoggle" role="radiogroup" aria-label="How often to pay">
              <label><input type="radio" name="billing" value="monthly" ${!staffOn || staff.billing === 'monthly' ? 'checked' : ''}><span>Monthly</span></label>
              <label><input type="radio" name="billing" value="yearly" ${staffOn && staff.billing === 'yearly' ? 'checked' : ''}><span>Yearly (2 months free)</span></label></div>
            <div class="calc-out" aria-live="polite"></div>
            <button class="btn btn-primary">${staffOn ? 'Change' : 'Continue'}</button>
            ${when(staffOn && !stopping.staff, html`<button type="button" class="btn btn-ghost" data-act="addon-stop" data-kind="staff">Stop at the end of the period</button>`)}
          </form>` : html`<p class="muted small">Your workspace owner or an admin can add licences.</p>`}
      </section>
    </div>
    ${bills.length ? html`<details class="card bills-all"><summary><b>Your bills</b> <span class="muted small">${plural(bills.length, 'bill')}</span></summary>${bills.map(billRow)}</details>` : ''}
    <p class="fineprint">Prices include everything; there's nothing else to pay. Moving up starts a new period today, less what's unused of the current one. Moving down starts with your next bill. Stopping keeps everything on until the end of what you paid, and nothing is ever deleted.${pay?.online_payments === 'on' ? '' : ' Pay by GCash, Maya or bank transfer; we confirm within 1 business day.'}</p>`;
}

function billRow(i) {
  const [st, cls] = BILL_STATUS[i.status] || ['', 'needinfo'];
  const expired = i.status === 'due' && i.valid_until < todayPH();
  return html`<div class="line bill-line"><div class="line-main"><b>${label(i)}</b>
      <small>Bill ${i.number} · ${fmtDate(i.period_start)} to ${fmtDate(i.period_end)}${i.credit_php > 0 ? ` · ${peso(i.price_php)} less ${peso(i.credit_php)} unused` : ''}${i.note && i.status !== 'paid' ? ` · ${i.note}` : ''}</small></div>
    <b class="bill-amt">${peso(i.amount_php)}</b>
    <span class="chip ${expired ? 'needinfo' : cls}">${expired ? 'Expired' : st}</span>
    ${when(i.status === 'due' && !expired && isOrgAdmin(), html`<div class="btn-row"><button class="btn btn-sm btn-primary" data-act="addon-pay" data-id="${i.id}">Pay</button>
      <button class="btn btn-sm btn-ghost" data-act="addon-cancel-bill" data-id="${i.id}" aria-label="Cancel bill ${i.number}">Cancel</button></div>`)}</div>`;
}

// Live price under the people box (the same rule the database uses).
function paintCalc(form) {
  const n = Math.floor(Number(form.people.value));
  const billing = form.querySelector('[name=billing]:checked')?.value || 'monthly';
  const out = form.querySelector('.calc-out');
  const min = Number(form.people.min);
  if (!(n >= min) || n > 5000) { out.innerHTML = String(html`<p class="small muted">Enter ${min} to 5,000.</p>`); return; }
  const bands = staffBands(n);
  const monthly = staffMonthly(n);
  out.innerHTML = String(html`<div class="calc-lines">
      <div><span>People 1 to ${FREE_PEOPLE}</span><span>Free</span></div>
      ${bands.map((b) => html`<div><span>${b.count} ${b.count === 1 ? 'person' : 'people'} × ₱${b.each} (the ${ordinal(b.from)}${b.count > 1 ? ` to ${ordinal(b.from + b.count - 1)}` : ''})</span><span>${peso(b.amount)}</span></div>`)}
      <div class="calc-total"><span>${billing === 'yearly' ? `A year (10 months' price)` : 'A month'}</span><b>${peso(billing === 'yearly' ? monthly * YEAR_MONTHS : monthly)}</b></div>
      <p class="muted small">That's about ${peso(Math.round((monthly / Math.max(1, n - FREE_PEOPLE)) * 100) / 100)} per paid person a month.</p></div>`);
}
const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
export function wireAddons(root) {
  const form = root.querySelector('[data-staff-calc]');
  if (!form) return;
  paintCalc(form);
  form.addEventListener('input', () => paintCalc(form));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const n = Math.floor(Number(form.people.value));
    if (!(n >= Number(form.people.min)) || n > 5000) return toast(`Enter ${form.people.min} to 5,000 people.`, 'error');
    choose('staff', n, form.querySelector('[name=billing]:checked')?.value || 'monthly');
  });
  if (new URLSearchParams(location.hash.split('?')[1] || '').get('staff')) setTimeout(() => form.people.focus(), 50);
}

// ---------------------------------------------------------------- choosing: the database prices it, then you confirm
async function choose(kind, people, billing) {
  let q;
  try { q = await db.addonPreview(S.org.id, kind, people ?? null, billing); } catch (e) { return toastError(e); }
  const name = addonLabel(kind, people, billing);
  const when_ = q.mode === 'next_period' ? html`<p>This starts with your next period, on <b>${fmtDate(q.period_start)}</b>. Nothing to pay now; your current plan carries on until then.</p>`
    : q.mode === 'after_trial' ? html`<p>Your free days are kept: this starts on <b>${fmtDate(q.period_start)}</b>, when ${addonOf(kind)?.comped ? 'the time PermitPal gave you' : 'your trial'} ends, and runs to ${fmtDate(q.period_end)}.</p>`
    : q.mode === 'renewal' ? html`<p>Your next period: <b>${fmtDate(q.period_start)}</b> to ${fmtDate(q.period_end)}.</p>`
    : q.mode === 'change' ? html`<p>Starts today and runs to <b>${fmtDate(q.period_end)}</b>. What's unused of your current period comes off the price.</p>`
    : html`<p>Starts the day you pay and runs for ${q.months === 12 ? 'a year' : 'a month'}.</p>`;
  const lines = q.mode === 'next_period' ? '' : html`<div class="calc-lines">
      <div><span>${name}</span><span>${peso(q.price)}</span></div>
      ${when(Number(q.credit) > 0, html`<div><span>Unused days of your current period</span><span>−${peso(q.credit)}</span></div>`)}
      <div class="calc-total"><span>To pay</span><b>${peso(q.amount)}</b></div></div>`;
  openModal(name, html`${when_}${lines}
    ${when(kind === 'staff', html`<p class="muted small">You track ${plural(q.people_now, 'person', 'people')} now. ${people > q.people_now ? `You can add ${people - q.people_now} more.` : ''}</p>`)}`, {
    submitLabel: q.mode === 'next_period' ? 'Confirm' : `Get the bill: ${peso(q.amount)}`,
    danger: false,
    onSubmit: async () => {
      const r = await db.addonCheckout(S.org.id, kind, people ?? null, billing);
      await reload();
      if (r.scheduled) { toast(`Done. From ${fmtDate(r.period_start)}: ${name}.`); return; }
      if (r.status === 'paid') { toast(`${name} is on.`); return; }
      setTimeout(() => openPay(r), 30);
    },
  });
}
on('addon-choose', (ds) => choose(ds.kind, ds.people ? Number(ds.people) : null, ds.billing));
on('plus-trial', async (ds, btn) => { btn.disabled = true; try { await startTrial(); } catch (e) { toastError(e); btn.disabled = false; } });

// ---------------------------------------------------------------- paying a bill
async function openPay(inv) {
  const st = await paySettings();
  const online = st.online_payments === 'on' && Number(inv.amount_php) >= 20;
  openModal(`Pay bill ${inv.number}`, html`
    <div class="quote-hint"><b>${peso(inv.amount_php)}</b> <span class="muted">${label(inv)}, ${fmtDate(inv.period_start)} to ${fmtDate(inv.period_end)}</span></div>
    ${when(online, html`<p><button type="button" class="btn btn-primary" data-act="addon-online" data-id="${inv.id}">Pay online now (GCash, Maya, card)</button></p>
      <p class="muted small">It switches on as soon as the payment goes through. Or pay by transfer:</p>`)}
    ${payDetails(st)}
    <div class="grid2">
      <label class="field"><span>Paid with</span><select name="method"><option value="gcash">GCash</option><option value="maya">Maya</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option></select></label>
      <label class="field"><span>Reference number</span><input name="ref" maxlength="120" placeholder="e.g. 1009 234 567890"></label>
    </div>
    <label class="field"><span>Screenshot of the payment <small>(optional if you entered the reference)</small></span><input type="file" name="file" accept="image/*,.pdf"></label>`, {
    submitLabel: "I've paid",
    onSubmit: async (fd) => {
      const ref = String(fd.get('ref') || '').trim();
      const file = fd.get('file');
      if (!ref && !(file && file.size)) throw new Error('Add the reference number or a screenshot of the payment, so we can find it.');
      await db.addonReportPayment(inv, { method: fd.get('method'), ref, file });
      await reload();
      toast("Thanks! We'll confirm your payment within 1 business day. Everything stays on meanwhile.");
    },
  });
}
on('addon-pay', (ds) => { const i = plusOf().invoices.find((x) => x.id === ds.id); if (i) openPay(i); });
on('addon-online', async (ds, btn) => {
  const i = plusOf().invoices.find((x) => x.id === ds.id);
  btn.disabled = true;
  try { location.href = await db.startAddonCheckout(i); } catch (e) { toastError(e); btn.disabled = false; }
});
on('addon-cancel-bill', async (ds) => {
  if (!(await confirmDialog('Cancel this bill?', 'Nothing changes on your plan. You can choose again anytime.', { confirmLabel: 'Cancel the bill', cancelLabel: 'Keep it' }))) return;
  try { await db.addonCancelInvoice(ds.id); await reload(); toast('Cancelled.'); } catch (e) { toastError(e); }
});
on('addon-stop', async (ds) => {
  const a = addonOf(ds.kind);
  const msg = ds.kind === 'plus'
    ? `Plus stays on until ${fmtDate(a.paid_through)}. Then your public page shows "paused" and the monthly check stops. Nothing is deleted, and you can turn it on again anytime.`
    : `Your licences stay on until ${fmtDate(a.paid_through)}. Then reminders pause for everyone above the free ${FREE_PEOPLE}. Nothing is deleted.`;
  if (!(await confirmDialog('Stop at the end of the period?', msg, { confirmLabel: 'Stop it then', cancelLabel: 'Keep it' }))) return;
  try { const d = await db.addonStop(S.org.id, ds.kind); await reload(); toast(`It ends on ${fmtDate(d)}.`); } catch (e) { toastError(e); }
});
on('addon-resume', async (ds) => { try { await db.addonResume(S.org.id, ds.kind); await reload(); toast("Kept. We'll send the next bill a week before."); } catch (e) { toastError(e); } });

// A short line for anywhere that shows the people limit.
export function seatLine() {
  if (!has('plus')) return '';
  const n = activePeople();
  const allowed = peopleAllowed();
  const paused = (S.data.people || []).filter((p) => p.paused_at).length;
  return html`<div class="seat-line ${n >= allowed ? 'full' : ''}"><div class="seat-meter" role="img" aria-label="${n} of ${allowed} people"><span style="width:${Math.min(100, Math.round((n / Math.max(1, allowed)) * 100))}%"></span></div>
    <span class="small"><b>${n} of ${allowed}</b> people ${allowed === FREE_PEOPLE ? '(free)' : `(licences until ${fmtDate(addonOf('staff')?.paid_through)})`}</span>
    ${when(isOrgAdmin(), html`<a class="btn btn-sm btn-soft" href="#/settings/billing?staff=1">${n >= allowed ? 'Add licences' : 'Licences'}</a>`)}</div>
    ${when(paused, html`<div class="banner warn"><div><b>${plural(paused, 'person is', 'people are')} paused.</b> Their reminders are off because your staff licences ended or don't cover them. Nothing was deleted.</div>
      ${when(isOrgAdmin(), html`<a class="btn btn-sm btn-primary" href="#/settings/billing?staff=1">Add licences</a>`)}</div>`)}`;
}

