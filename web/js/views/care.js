// Year-round care: a monthly (or yearly) fee per branch or vehicle, and PermitPal starts every covered
// renewal itself. The page shows what's covered, the bills, the renewals the plan started, and the
// on-time guarantee (Care Plus). Kept honest on purpose: prices up front, what's not included, when
// coverage starts and ends, and cancelling is one tap (it runs to the end of what's paid).
import { html, fmtDate, peso, toast, toastError, confirmDialog, openModal, formObject, plural, when, todayPH } from '../util.js';
import { S, on, go, reload, canEdit, isOrgAdmin, isOwner, has, careOf, planFor, coverOf, tierOf, typeOf, reqById, locationsOf, reqsOf, empty } from '../core.js';
import { ICON, byPriority, subjectLabel, dueShort } from '../components.js';
import { ORDER_STATUS, payDetails, paySettings } from './services.js';
import * as db from 'pp/data';

export const PLAN_STATUS = {
  pending: ['Waiting for payment', 'needinfo'],
  active: ['Active', 'ok'],
  paused: ['Paused: bill not paid', 'overdue'],
  cancelled: ['Ended', 'needinfo'],
};
const BILL_STATUS = { due: ['To pay', 'soon'], pending_verification: ['Payment being checked', 'progress'], paid: ['Paid', 'ok'], void: ['Cancelled', 'needinfo'] };
const LEAD_DAYS = { business: 60, vehicle: 45 };
const ownerName = () => {
  const m = (S.data?.members || []).find((x) => x.role === 'owner');
  return [m?.profile?.first_name, m?.profile?.last_name].filter(Boolean).join(' ') || m?.profile?.email || 'the owner';
};
const billOverdue = (i) => i.status === 'due' && i.due_on < todayPH();
const planEnds = (p) => (p.cancel_at && p.status !== 'cancelled' ? p.cancel_at : null);
const per = (billing) => (billing === 'yearly' ? 'year' : 'month');
const tiersFor = (subject) => careOf().tiers.filter((t) => t.subject === subject);
const minPrice = (subject) => Math.min(...tiersFor(subject).map((t) => Number(t.monthly_php)).filter((n) => n > 0));
const coveredReqs = (p) => careOf().coverage.filter((c) => c.plan_id === p.id).map((c) => reqById(c.requirement_id)).filter(Boolean);
// What a plan renews is a fixed list of permit types; anything else is a one-time job with its own quote.
const scopeOf = (subject) => new Set(tiersFor(subject).flatMap((t) => t.covers || []));
const inScope = (subject, r) => !!r.type_code && scopeOf(subject).has(r.type_code);
const typeNames = (codes) => (codes || []).map((c) => typeOf(c)?.name || c);
// A plan's permits that Care doesn't renew (shown so nobody assumes they're handled).
const outOfScope = (p) => {
  const tier = tierOf(p.tier);
  const reqs = p.vehicle_id ? reqsOf('vehicle', p.vehicle_id)
    : (S.data.reqs || []).filter((r) => r.business_id === p.business_id && r.subject === 'business' && (r.location_id === p.location_id || (!r.location_id && locationsOf(p.business_id).find((l) => l.id === p.location_id)?.is_main)));
  return reqs.filter((r) => r.expires && !(r.type_code && (tier?.covers || []).includes(r.type_code)));
};

// ---------------------------------------------------------------- the page
export async function care(el, params) {
  if (!has('revenue')) { el.innerHTML = String(empty('Not available yet', 'Year-round care is coming soon.', html`<a class="btn btn-primary" href="#/services">See Done for you</a>`)); return; }
  // Bills and plans change on PermitPal's side (a payment confirmed, a renewal started): show them as they are now.
  if (!el.querySelector('.care-row, .care-hero')) el.innerHTML = String(html`<div class="loading">Loading…</div>`);
  try { S.data.care = await db.loadCare(S.org.id); } catch { /* show what we have */ }
  if (!location.hash.startsWith('#/care')) return;
  const c = careOf();
  const plans = c.plans.filter((p) => p.status !== 'cancelled');
  const ended = c.plans.filter((p) => p.status === 'cancelled');
  const dueBills = c.invoices.filter((i) => ['due', 'pending_verification'].includes(i.status));
  const careOrders = (S.data.requests || []).filter((a) => a.care_plan_id);
  const monthly = plans.filter((p) => p.status !== 'pending').reduce((t, p) => t + (p.billing === 'yearly' ? Number(p.price_php) / 12 : Number(p.price_php)), 0);
  const plus = plans.filter((p) => tierOf(p.tier)?.guarantee);

  el.innerHTML = String(html`
    <div class="page-head"><div><h1>Year-round care</h1>
      <p class="muted">We start every renewal for you, all year. You pay one ${plans.length ? 'bill' : 'monthly fee'} for our work, and government fees at cost.</p></div>
      ${when(plans.length && canEdit(), html`<a class="btn btn-primary" href="#/care/start">+ Add branches or vehicles</a>`)}</div>

    ${dueBills.map((i) => billBanner(i))}

    ${plans.length ? html`
      <div class="stats four">
        <div class="stat ok"><div class="stat-n">${plans.filter((p) => p.location_id).length}</div><div class="stat-l">Branches covered</div></div>
        <div class="stat ok"><div class="stat-n">${plans.filter((p) => p.vehicle_id).length}</div><div class="stat-l">Vehicles covered</div></div>
        <div class="stat progress"><div class="stat-n">${careOrders.filter((a) => !['completed', 'cancelled'].includes(a.status)).length}</div><div class="stat-l">Renewals we're handling</div></div>
        <div class="stat"><div class="stat-n">${peso(Math.round(monthly))}</div><div class="stat-l">A month, for our work</div></div>
      </div>
      <section class="card">
        <div class="card-head"><div><h2>What we handle</h2><p class="card-sub">Each renewal starts about ${LEAD_DAYS.business} days before it's due (${LEAD_DAYS.vehicle} for vehicles). We send you the government fees to approve, then do the rest.</p></div></div>
        ${plans.map(planRow)}
      </section>
      ${careOrders.length ? html`<section class="card"><div class="card-head"><div><h2>Renewals the plan started</h2><p class="card-sub">Open one to approve fees, pay, or message us</p></div></div>
        ${careOrders.slice(0, 20).map(orderLine)}</section>` : ''}
      ${preapprovalCard()}
      ${when(plus.length, guaranteeCard(plus))}
      ${billsCard(c.invoices)}
      ${when(ended.length, html`<details class="folder card"><summary>${plural(ended.length, 'ended plan')}</summary>${ended.map(planRow)}</details>`)}`
    : intro()}
    <p class="muted small fineprint">Care covers our service fee for the yearly permits listed on each plan, for the branches and vehicles you choose. Special licences (FDA, DOH, franchises, contractor licences), staff licences and new permits you don't have yet are one-time jobs with their own quote.
      Government fees, premiums and penalties are paid at cost with official receipts. Cancel anytime: the plan runs to the end of what you've paid, with no refund for the rest of that period.
      <a href="terms.html#care" target="_blank" rel="noopener">Year-round care terms</a></p>`);

  const pay = params?.get('pay');
  if (pay) { history.replaceState(null, '', '#/care'); const inv = c.invoices.find((i) => i.id === pay); if (inv) openPay(inv); }
}

function intro() {
  const branch = tiersFor('branch'), vehicle = tiersFor('vehicle');
  const can = isOwner();
  return html`
    <section class="card care-hero">
      <ol class="care-how">
        <li><b>Choose branches and vehicles</b><span>The yearly permits are covered: Mayor's Permit, barangay clearance, FSIC, sanitary permit, LTO registration, CTPL and more. Special licences (FDA, DOH, franchises) are quoted separately.</span></li>
        <li><b>Pay one bill a month</b><span>Or yearly and get 2 months free. Our service fee for every renewal is included.</span></li>
        <li><b>We start each renewal for you</b><span>About ${LEAD_DAYS.business} days before it's due. You approve the government fees, we file, and the new permit is saved here.</span></li>
      </ol>
      <div class="btn-row">${can ? html`<a class="btn btn-primary" href="#/care/start">Choose what we handle</a>`
        : html`<span class="muted small">Only ${ownerName()} (the owner) can start a paid plan. Share this page with them.</span>`}</div>
    </section>
    ${branch.length ? html`<h3 class="section-label">For a business branch</h3><div class="svc-grid care-tiers">${branch.map((t) => tierCard(t, 'branch'))}</div>` : ''}
    ${vehicle.length ? html`<h3 class="section-label">For a vehicle</h3><div class="svc-grid care-tiers">${vehicle.map((t) => tierCard(t, 'vehicle'))}</div>` : ''}`;
}

function tierCard(t, subject) {
  return html`<section class="card svc care-tier ${t.guarantee ? 'plus' : ''}">
    <div class="svc-top"><h2>${t.name}</h2><div class="svc-price"><b>${peso(t.monthly_php)}</b><small>per ${subject} / month</small></div></div>
    <p class="muted small">or ${peso(t.yearly_php)} a year</p>
    <ul class="svc-inc">${(t.includes || []).map((i) => html`<li>${ICON.check}<span>${i}</span></li>`)}</ul>
    ${(t.covers || []).length ? html`<p class="small care-covers"><b>Renews:</b> ${typeNames(t.covers).join(', ')}.</p>` : ''}
  </section>`;
}

function planRow(p) {
  const t = tierOf(p.tier);
  const [label, cls] = PLAN_STATUS[p.status] || [p.status, 'needinfo'];
  const reqs = coveredReqs(p);
  const soon = reqs.filter((r) => r.expires && r.expires_on && r.days_left != null && r.days_left <= (p.vehicle_id ? LEAD_DAYS.vehicle : LEAD_DAYS.business)).length;
  const missing = reqs.filter((r) => r.expires && !r.expires_on).length;
  const ends = planEnds(p);
  const extra = p.status === 'cancelled' ? [] : outOfScope(p);
  const href = p.location_id ? `#/businesses/${p.business_id}` : `#/vehicles/${p.vehicle_id}`;
  return html`<div class="row care-row">
    <div class="row-main"><div class="row-title"><a href="${href}">${p.label}</a> <span class="tag">${t?.name || p.tier}</span></div>
      <div class="row-sub">${peso(p.price_php)} a ${per(p.billing)} · ${plural(reqs.length, 'permit')} covered${soon ? ` · ${soon} due soon` : ''}${missing ? html` · <span class="due needinfo">${missing} missing an expiry date</span>` : ''}</div>
      ${extra.length ? html`<div class="row-sub">Not in Care, quoted per job: ${extra.map((r) => r.name).join(', ')}</div>` : ''}
      <div class="row-sub">${p.status === 'pending' ? 'Starts the day your first bill is paid.'
        : p.status === 'cancelled' ? `Ended ${p.cancel_at ? fmtDate(p.cancel_at) : ''}${p.ended_reason ? ' · ' + p.ended_reason : ''}`
        : ends ? html`<b>Ends ${fmtDate(ends)}</b> (paid until then)` : p.paid_through ? `Paid until ${fmtDate(p.paid_through)}` : ''}</div></div>
    <div class="row-side"><span class="chip ${ends ? 'soon' : cls}">${ends ? 'Ending' : label}</span>
      ${when(isOwner() && p.status !== 'cancelled', ends
        ? html`<button class="btn btn-sm btn-soft" data-act="care-resume" data-id="${p.id}">Keep it</button>`
        : html`<button class="btn btn-sm btn-ghost" data-act="care-cancel" data-id="${p.id}">Cancel</button>`)}</div>
  </div>`;
}

function orderLine(a) {
  const [label, cls] = ORDER_STATUS[a.status] || [a.status, 'needinfo'];
  const act = a.status === 'quoted' ? 'Approve fees' : a.payment_status === 'awaiting_payment' && !['completed', 'cancelled'].includes(a.status) ? 'Pay fees' : 'Open';
  return html`<a class="line" href="#/services/orders/${a.id}"><span class="line-main"><b>${a.requirement_name}</b>
    <small>${a.subject_label}${a.due_on ? ' · due ' + fmtDate(a.due_on) : ''}${a.quote_gov_fees != null ? ' · government fees ' + peso(a.quote_gov_fees) : ''}</small></span>
    <span class="chip ${cls}">${label}</span><span class="btn btn-sm ${act === 'Open' ? 'btn-soft' : 'btn-primary'}">${act}</span></a>`;
}

function billBanner(i) {
  if (i.status === 'pending_verification') {
    return html`<div class="banner info"><div><b>We're checking your payment</b> for bill ${i.number} (${peso(i.amount_php)}). Usually within 1 business day.</div></div>`;
  }
  return html`<div class="banner ${billOverdue(i) ? 'warn' : 'info'}"><div><b>${i.first ? 'Pay your first bill to start' : billOverdue(i) ? `Bill ${i.number} is overdue` : `Bill ${i.number} is ready`}:</b>
    ${peso(i.amount_php)}, ${i.first ? 'coverage starts the day it\'s paid' : `for ${fmtDate(i.period_start)} to ${fmtDate(i.period_end)}`}${billOverdue(i) ? '' : `, due ${fmtDate(i.due_on)}`}.
    ${i.note ? html`<br><span class="small">${i.note}</span>` : ''}</div>
    ${when(canEdit(), html`<div class="banner-actions"><button class="btn btn-sm btn-primary" data-act="care-pay" data-id="${i.id}">Pay ${peso(i.amount_php)}</button></div>`)}</div>`;
}

function billsCard(list) {
  if (!list.length) return '';
  return html`<section class="card"><div class="card-head"><div><h2>Bills</h2><p class="card-sub">Our fee for care. Government fees are paid on each renewal.</p></div></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Bill</th><th>Covers</th><th>Amount</th><th>Status</th><th><span class="sr-only">Action</span></th></tr></thead><tbody>
    ${list.map((i) => { const [l, cls] = BILL_STATUS[i.status] || [i.status, '']; return html`<tr>
      <td>${i.number}</td><td>${i.status === 'paid' || !i.first ? `${fmtDate(i.period_start)} – ${fmtDate(i.period_end)}` : 'Starts when paid'}</td>
      <td>${peso(i.amount_php)}<div class="muted small">${(i.lines || []).map((x) => x.label).join(', ')}</div></td>
      <td><span class="chip ${billOverdue(i) ? 'overdue' : cls}">${billOverdue(i) ? 'Overdue' : l}</span>${i.paid_at ? html`<div class="muted small">${fmtDate(i.paid_at.slice(0, 10))}</div>` : ''}</td>
      <td>${i.status === 'due' && canEdit() ? html`<button class="btn btn-sm btn-primary" data-act="care-pay" data-id="${i.id}">Pay</button>` : ''}</td></tr>`; })}
    </tbody></table></div></section>`;
}

function preapprovalCard() {
  const v = Number(S.org.care_gov_preapproval_php || 0);
  return html`<section class="card"><h2>Government fees</h2>
    <p class="muted small">For each renewal we send you the exact government fees first. To save you a step, we can go ahead when they are within an amount you choose (you still pay before we file).</p>
    ${isOrgAdmin() ? html`<form class="inline-form care-pre"><label class="field"><span>Go ahead without asking me when fees are up to (₱)</span>
        <input name="amount" type="number" min="0" max="200000" step="100" value="${v}" required></label>
        <button class="btn btn-sm btn-soft">Save</button></form>
      <p class="muted small">${v ? `Now: up to ${peso(v)} per renewal. Higher amounts still need your OK.` : 'Now: we always ask you first.'}</p>`
      : html`<p>${v ? `Up to ${peso(v)} per renewal is approved for you.` : 'You approve every renewal\'s fees yourself.'}</p>`}
  </section>`;
}

function guaranteeCard(plus) {
  const claims = careOf().claims;
  const st = { submitted: ['Being reviewed', 'progress'], approved: ['Approved', 'ok'], declined: ['Declined', 'needinfo'], paid: ['Paid to you', 'ok'] };
  return html`<section class="card"><div class="card-head"><div><h2>On-time guarantee</h2>
      <p class="card-sub">Care Plus: if a covered permit lapses because we missed its deadline, we pay the late penalty${plus[0] ? ` (up to ${peso(tierOf(plus[0].tier)?.guarantee_cap_php)} per permit)` : ''}.</p></div>
      ${when(canEdit(), html`<button class="btn btn-sm btn-soft" data-act="care-claim">Claim it</button>`)}</div>
    <p class="muted small">It applies when the plan was paid up on the expiry date, the permit was in your plan at least 30 days before it expired, and you sent what we asked for within 7 days. Send the official receipt that shows the penalty within 90 days.</p>
    ${claims.map((g) => { const [l, cls] = st[g.status]; return html`<div class="line"><span class="line-main"><b>${g.requirement_name}</b>
      <small>Expired ${fmtDate(g.lapsed_on)} · penalty ${peso(g.penalty_php)}${g.approved_php != null ? ' · approved ' + peso(g.approved_php) : ''}${g.decision_note ? ' · ' + g.decision_note : ''}</small></span>
      <span class="chip ${cls}">${l}</span></div>`; })}
  </section>`;
}

// ---------------------------------------------------------------- choosing what we handle
export function careStart(el, params) {
  if (!has('revenue')) return care(el, params);
  const c = careOf();
  const pre = { loc: params?.get('loc'), veh: params?.get('veh') };
  const subjects = [];
  for (const b of S.data.businesses) for (const l of locationsOf(b.id)) subjects.push({ kind: 'location', id: l.id, name: `${b.name} · ${l.name}`, sub: l.city || '', reqs: S.data.reqs.filter((r) => r.business_id === b.id && (r.location_id === l.id || (!r.location_id && l.is_main))) });
  for (const v of S.data.vehicles) subjects.push({ kind: 'vehicle', id: v.id, name: `${v.make_model}${v.plate_no ? ' · ' + v.plate_no : ''}`, sub: v.vehicle_type || '', reqs: reqsOf('vehicle', v.id) });
  if (!subjects.length) { el.innerHTML = String(empty('Add a business or vehicle first', 'Then choose which ones we should look after.', html`<a class="btn btn-primary" href="#/businesses?add=1">Add a business</a>`)); return; }
  const taken = (s) => planFor(s.kind, s.id);
  const can = isOwner();
  const row = (s) => {
    const p = taken(s);
    const subject = s.kind === 'location' ? 'branch' : 'vehicle';
    const inPlan = s.reqs.filter((r) => r.subject !== 'person' && inScope(subject, r));
    const extra = s.reqs.filter((r) => r.subject !== 'person' && r.expires && !inScope(subject, r)).length;
    const soon = inPlan.filter((r) => r.expires && r.days_left != null && r.days_left <= 60).length;
    const checked = !p && (s.id === pre.loc || s.id === pre.veh);
    return html`<label class="check care-pick ${p ? 'taken' : ''}"><input type="checkbox" name="pick" value="${s.kind}:${s.id}" ${checked ? 'checked' : ''} ${p || !can ? 'disabled' : ''}>
      <span><b>${s.name}</b>${s.sub ? html` <small class="muted">${s.sub}</small>` : ''}<small class="muted">${plural(inPlan.length, 'permit')} covered${soon ? ` · ${soon} due within 60 days` : ''}${extra ? ` · ${extra} quoted separately` : ''}${p ? ' · already covered' : ''}</small></span></label>`;
  };
  const tiers = { branch: tiersFor('branch'), vehicle: tiersFor('vehicle') };
  const levels = [...new Set([...tiers.branch, ...tiers.vehicle].map((t) => (t.guarantee ? 'plus' : 'care')))];
  el.innerHTML = String(html`
    <a class="back" href="#/care">← Year-round care</a>
    <div class="page-head"><div><h1>Choose what we handle</h1><p class="muted">Pick the branches and vehicles, the level, and how often you'd like to pay. You'll see the total before anything is charged.</p></div></div>
    ${when(!can, html`<div class="banner warn"><div>Only ${ownerName()} (the owner) can start a paid plan. You can look, and share this page with them.</div></div>`)}
    <form class="care-form" novalidate>
      <section class="card"><h2>1. Branches and vehicles</h2>
        ${when(subjects.some((s) => s.kind === 'location'), html`<h3 class="section-label">Branches</h3>${subjects.filter((s) => s.kind === 'location').map(row)}`)}
        ${when(subjects.some((s) => s.kind === 'vehicle'), html`<h3 class="section-label">Vehicles</h3>${subjects.filter((s) => s.kind === 'vehicle').map(row)}`)}
        ${when(can, html`<div class="btn-row"><button type="button" class="btn btn-sm btn-ghost" data-pick-all>Choose all</button><button type="button" class="btn btn-sm btn-ghost" data-pick-none>Clear</button></div>`)}
      </section>
      <section class="card"><h2>2. Level</h2>
        ${levels.map((lv) => { const b = tiers.branch.find((t) => !!t.guarantee === (lv === 'plus')); const v = tiers.vehicle.find((t) => !!t.guarantee === (lv === 'plus'));
          return html`<label class="check care-level"><input type="radio" name="level" value="${lv}" ${lv === 'care' ? 'checked' : ''} ${can ? '' : 'disabled'}>
            <span><b>${(b || v)?.name}</b> <small class="muted">${b ? `${peso(b.monthly_php)} per branch` : ''}${b && v ? ' · ' : ''}${v ? `${peso(v.monthly_php)} per vehicle` : ''} a month</small>
            <small>${lv === 'plus' ? 'Everything in Care, plus our on-time guarantee (we pay the late penalty if we miss a deadline) and a yearly pre-inspection walk-through per branch.' : 'We start and handle every renewal. Our service fee is included.'}</small></span></label>`; })}
      </section>
      <section class="card"><h2>3. How often you pay</h2>
        <label class="check"><input type="radio" name="billing" value="monthly" checked ${can ? '' : 'disabled'}><span><b>Monthly</b> <small class="muted">Cancel anytime; it runs to the end of the month you've paid.</small></span></label>
        <label class="check"><input type="radio" name="billing" value="yearly" ${can ? '' : 'disabled'}><span><b>Yearly</b> <small class="muted">2 months free. No refund if you cancel part-way.</small></span></label>
      </section>
      <section class="card care-total" aria-live="polite"><div data-care-total></div>
        <label class="check consent"><input type="checkbox" name="consent" ${can ? '' : 'disabled'}>
          <span>I authorize PermitPal to renew the permits of the chosen branches and vehicles for ${S.org.name} while the plan is active, and I'll sign an authorization letter.
            Government fees are paid at cost with official receipts. <a href="terms.html#care" target="_blank" rel="noopener">Terms</a></span></label>
        <p class="form-error" role="alert" hidden></p>
        <button class="btn btn-primary btn-block" ${can ? '' : 'disabled'}>Start</button>
      </section>
    </form>`);

  const form = el.querySelector('.care-form');
  const err = form.querySelector('.form-error');
  const btn = form.querySelector('button.btn-block');
  const chosen = () => [...form.querySelectorAll('[name=pick]:checked')].map((x) => { const [kind, id] = x.value.split(':'); return { kind, id }; });
  const tierFor = (kind, lv) => tiers[kind === 'location' ? 'branch' : 'vehicle'].find((t) => !!t.guarantee === (lv === 'plus'));
  const total = () => {
    const lv = form.level.value, billing = form.billing.value;
    const items = chosen().map((x) => ({ ...x, tier: tierFor(x.kind, lv) })).filter((x) => x.tier);
    const sum = items.reduce((t, x) => t + Number(billing === 'yearly' ? x.tier.yearly_php : x.tier.monthly_php), 0);
    const nb = items.filter((x) => x.kind === 'location').length, nv = items.length - nb;
    return { items, sum, nb, nv, billing };
  };
  const paint = () => {
    const t = total();
    const b = t.items.find((x) => x.kind === 'location')?.tier, v = t.items.find((x) => x.kind === 'vehicle')?.tier;
    const each = (tier) => Number(t.billing === 'yearly' ? tier.yearly_php : tier.monthly_php);
    form.querySelector('[data-care-total]').innerHTML = String(t.items.length
      ? html`<div class="care-sum">${t.nb ? html`<div><span>${plural(t.nb, 'branch', 'branches')} × ${peso(each(b))}</span><b>${peso(t.nb * each(b))}</b></div>` : ''}
          ${t.nv ? html`<div><span>${plural(t.nv, 'vehicle')} × ${peso(each(v))}</span><b>${peso(t.nv * each(v))}</b></div>` : ''}
          <div class="total"><span>Total per ${per(t.billing)}</span><b>${peso(t.sum)}</b></div></div>
        <p class="muted small">Coverage starts the day your first payment is confirmed${t.billing === 'yearly' ? ' and runs for 12 months' : ', then we bill you monthly'}. Government fees are separate, at cost.</p>`
      : html`<p class="muted">Choose at least one branch or vehicle above.</p>`);
    btn.textContent = t.items.length ? `Start and pay ${peso(t.sum)}` : 'Start';
  };
  form.addEventListener('change', paint);
  form.querySelector('[data-pick-all]')?.addEventListener('click', () => { form.querySelectorAll('[name=pick]:not(:disabled)').forEach((x) => { x.checked = true; }); paint(); });
  form.querySelector('[data-pick-none]')?.addEventListener('click', () => { form.querySelectorAll('[name=pick]').forEach((x) => { x.checked = false; }); paint(); });
  paint();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    const t = total();
    const fail = (m) => { err.textContent = m; err.hidden = false; };
    if (!t.items.length) return fail('Choose at least one branch or vehicle.');
    if (!form.consent.checked) return fail('Please tick the box to authorize PermitPal.');
    btn.disabled = true; btn.textContent = 'Starting…';
    try {
      const inv = await db.startCare(S.org.id, t.items.map((x) => ({ kind: x.kind, id: x.id, tier: x.tier.code })), t.billing);
      await reload();
      go('#/care?pay=' + inv);
      toast('Done. Pay the first bill and coverage starts the day it\'s confirmed.');
    } catch (ex) { btn.disabled = false; paint(); fail(ex.message || 'Something went wrong.'); }
  });
}

// ---------------------------------------------------------------- paying a bill
async function openPay(inv) {
  const st = await paySettings();
  openModal(`Pay bill ${inv.number}`, html`
    <div class="quote-hint"><b>${peso(inv.amount_php)}</b> <span class="muted">${(inv.lines || []).map((x) => `${x.label} (${x.tier})`).join(', ')}</span></div>
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
      await db.payCareInvoice(inv, { method: fd.get('method'), ref, file });
      await reload();
      toast("Thanks! We'll confirm your payment within 1 business day.");
    },
  });
}
on('care-pay', (ds) => { const inv = careOf().invoices.find((i) => i.id === ds.id); if (inv) openPay(inv); });

on('care-cancel', async (ds) => {
  const p = careOf().plans.find((x) => x.id === ds.id);
  if (!p) return;
  const now = p.status === 'pending' || !p.paid_through || p.paid_through < todayPH();
  const msg = now ? 'It ends today. Nothing more is billed.'
    : `It keeps running until ${fmtDate(p.paid_through)} (what you've paid for), then ends. Renewals already started are finished as agreed. You can change your mind before then.`;
  if (!(await confirmDialog(`Cancel care for ${p.label}?`, msg, { confirmLabel: 'Cancel the plan', cancelLabel: 'Keep it' }))) return;
  try { const on_ = await db.cancelCare(p.id, null); await reload(); toast(now ? 'Cancelled.' : `It ends ${fmtDate(on_)}.`); } catch (e) { toastError(e); }
});
on('care-resume', async (ds) => {
  try { await db.resumeCare(ds.id); await reload(); toast('Kept. It carries on as before.'); } catch (e) { toastError(e); }
});
document.addEventListener('submit', async (e) => {
  if (!e.target.matches?.('.care-pre')) return;
  e.preventDefault();
  const amount = Number(new FormData(e.target).get('amount'));
  if (!(amount >= 0 && amount <= 200000)) return toast('Enter an amount from ₱0 to ₱200,000.', 'error');
  try { await db.setCarePreapproval(S.org.id, amount); await reload(); toast(amount ? `Saved. We'll go ahead when fees are up to ${peso(amount)}.` : 'Saved. We\'ll always ask you first.'); } catch (err) { toastError(err); }
});

// ---------------------------------------------------------------- claiming the guarantee
on('care-claim', () => {
  const plus = careOf().plans.filter((p) => p.status !== 'pending' && tierOf(p.tier)?.guarantee);
  if (!plus.length) return toast('The on-time guarantee comes with Care Plus.', 'error');
  const options = plus.flatMap((p) => coveredReqs(p).filter((r) => r.expires).sort(byPriority).map((r) => [p.id, r]));
  if (!options.length) return toast('None of the permits on Care Plus has an expiry date yet.', 'error');
  openModal('Claim the on-time guarantee', html`
    <p class="muted small">Tell us which permit lapsed and what penalty you paid. We reply within 5 business days, and pay approved claims by GCash or bank transfer.</p>
    <label class="field"><span>Which permit?</span><select name="pick" required>${options.map(([pid, r]) => html`<option value="${pid}:${r.id}">${r.name} — ${subjectLabel(r)} (${dueShort(r)})</option>`)}</select></label>
    <label class="field"><span>Penalty you paid (₱)</span><input name="penalty" type="number" min="1" step="0.01" required></label>
    <label class="field"><span>Official receipt showing the penalty</span><input type="file" name="file" accept="image/*,.pdf" required></label>
    <label class="field"><span>What happened? <small>(optional)</small></span><textarea name="note" rows="2" maxlength="1000"></textarea></label>`, {
    submitLabel: 'Send claim',
    onSubmit: async (fd) => {
      const f = formObject(fd);
      const [plan_id, requirement_id] = String(f.pick).split(':');
      if (!(Number(f.penalty) > 0)) throw new Error('Enter the penalty you paid.');
      if (!(f.file && f.file.size)) throw new Error('Attach the official receipt that shows the penalty.');
      await db.fileGuaranteeClaim(S.org.id, { plan_id, requirement_id, penalty: Number(f.penalty), note: f.note, file: f.file });
      await reload();
      toast('Claim sent. We reply within 5 business days.');
    },
  });
});

// ---------------------------------------------------------------- small offers elsewhere in the app
// A branch card or vehicle page: "covered" when it is, otherwise one quiet line.
export function careLine(kind, id) {
  if (!has('revenue')) return '';
  const p = planFor(kind, id);
  if (p) {
    const [label, cls] = PLAN_STATUS[p.status] || [p.status, ''];
    return html`<a class="care-line on" href="#/care">${ICON.check}<span><b>Year-round care</b> · ${tierOf(p.tier)?.name || ''}</span><span class="chip ${planEnds(p) ? 'soon' : cls}">${planEnds(p) ? 'Ends ' + fmtDate(planEnds(p)) : label}</span></a>`;
  }
  if (!canEdit() || !careOf().tiers.length) return '';
  const from = minPrice(kind === 'location' ? 'branch' : 'vehicle');
  return html`<a class="care-line" href="#/care/start?${kind === 'location' ? 'loc' : 'veh'}=${id}">${ICON.briefcase}<span>Rather not deal with renewals? <b>We'll handle this ${kind === 'location' ? 'branch' : 'vehicle'} all year</b>${Number.isFinite(from) ? ` from ${peso(from)}/month` : ''}.</span></a>`;
}

// A permit page: what care is doing for this permit.
export function careNote(r) {
  if (!has('revenue')) return '';
  const p = coverOf(r);
  if (!p) return '';
  const lead = r.subject === 'vehicle' ? LEAD_DAYS.vehicle : LEAD_DAYS.business;
  const text = p.status === 'pending' ? 'Covered by Year-round care once your first bill is paid.'
    : p.status === 'paused' ? 'Year-round care is paused because a bill isn\'t paid. Pay it and we start again the same day.'
    : r.open_request_id ? 'Covered by Year-round care: we\'re handling this renewal.'
    : !r.expires ? 'Covered by Year-round care.'
    : !r.expires_on ? 'Covered by Year-round care. Add its expiry date so we know when to start.'
    : `Covered by Year-round care: we start this renewal about ${lead} days before it's due${r.days_left != null && r.days_left > lead ? ` (around ${fmtDate(new Date(Date.parse(r.expires_on) - lead * 864e5).toISOString().slice(0, 10))})` : ''}.`;
  return html`<div class="offer-inline care-note"><div class="offer-body">${ICON.check}<div><b>${text}</b>
    <span class="muted">${tierOf(p.tier)?.name || ''} · ${p.label}</span></div></div>
    ${r.open_request_id ? html`<a class="btn btn-soft btn-sm" href="#/services/orders/${r.open_request_id}">Open request</a>` : html`<a class="btn btn-ghost btn-sm" href="#/care">Your plan</a>`}</div>`;
}
