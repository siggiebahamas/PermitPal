// Year-round care: a monthly (or yearly) fee per branch or vehicle, and PermitPal does every covered
// renewal itself. The page has one job for someone who hasn't started: show in their own numbers what
// renewing permits costs them in time, and that reminders only tell you while care does it for you.
// Once they have a plan, it shows what we're handling, anything that needs them, and the details
// folded away. Kept honest: prices up front, what's not included, cancelling is one tap.
import { html, raw, fmtDate, peso, toast, toastError, confirmDialog, openModal, formObject, plural, when, todayPH } from '../util.js';
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
// Hours an owner spends doing a renewal themselves: gathering papers, lining up, paying, coming back
// to claim it. Rough, on purpose, and shown as "about". Emission test, inspection and CTPL are done on
// the same LTO trip, so they count as part of the registration.
const DIY_HOURS = { mayors_permit: 6, barangay_clearance: 2, fsic: 3, sanitary_permit: 3, annual_building_inspection: 2, signage_permit: 2, liquor_license: 2, lto_registration: 4 };
const X_ICON = raw('<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7 7 17"/></svg>');
const CLOCK = raw('<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>');
const SHIELD = raw('<svg viewBox="0 0 24 24"><path d="M12 3.5 5 6v5.5c0 4.2 3 7.6 7 9 4-1.4 7-4.8 7-9V6z"/><path d="M9 12l2.2 2.2L15.5 10"/></svg>');
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
  if (!el.querySelector('.care-row, .cx-hero')) el.innerHTML = String(html`<div class="loading">Loading…</div>`);
  try { S.data.care = await db.loadCare(S.org.id); } catch { /* show what we have */ }
  if (!location.hash.startsWith('#/care')) return;
  const c = careOf();
  const plans = c.plans.filter((p) => p.status !== 'cancelled');
  el.innerHTML = String(plans.length ? planPage(c, plans) : introPage());
  const pay = params?.get('pay');
  if (pay) { history.replaceState(null, '', '#/care'); const inv = c.invoices.find((i) => i.id === pay); if (inv) openPay(inv); }
}

// What renewing costs this business in time, from its own permits (or a typical branch if none yet).
function yourYear() {
  const scope = { business: scopeOf('branch'), vehicle: scopeOf('vehicle') };
  const reqs = (S.data.reqs || []).filter((r) => r.expires && DIY_HOURS[r.type_code] && scope[r.subject]?.has(r.type_code));
  const branches = (S.data.businesses || []).reduce((t, b) => t + locationsOf(b.id).length, 0);
  const vehicles = (S.data.vehicles || []).length;
  const hours = reqs.reduce((t, r) => t + DIY_HOURS[r.type_code], 0);
  const b = minPrice('branch'), v = minPrice('vehicle');
  const monthly = (Number.isFinite(b) ? branches * b : 0) + (Number.isFinite(v) ? vehicles * v : 0);
  return { renewals: reqs.length, hours, days: Math.max(1, Math.round(hours / 8)), branches, vehicles, monthly, b, v };
}

const startBtn = (label = 'Let PermitPal handle it') => isOwner()
  ? html`<a class="btn btn-primary btn-lg" href="#/care/start">${label}</a>`
  : html`<p class="muted small">Only ${ownerName()} (the owner) can start this. Share this page with them.</p>`;

function introPage() {
  const y = yourYear();
  const plus = tiersFor('branch').find((t) => t.guarantee) || tiersFor('vehicle').find((t) => t.guarantee);
  const own = y.renewals > 0;
  return html`
    <section class="cx-hero">
      <div class="cx-hero-text">
        <p class="cx-eyebrow">Year-round care</p>
        <h1>We renew your permits.<br><span>You run your business.</span></h1>
        <p class="cx-lede">No more lining up at city hall or the LTO. We start every renewal two months early, do the legwork, and put the new permit in your account. You just say yes to the government fee.</p>
        <div class="cx-cta">${startBtn()}
          ${Number.isFinite(y.b) ? html`<span class="cx-price-hint">From <b>${peso(y.b)}</b> a month per branch${Number.isFinite(y.v) ? html` · <b>${peso(y.v)}</b> per vehicle` : ''}</span>` : ''}</div>
      </div>
      <div class="cx-hero-art" aria-hidden="true">
        <div class="cx-pop cx-pop-1"><span class="cx-pop-ico ok">${ICON.check}</span><span><b>Mayor's Permit renewed</b><small>New permit saved to your account</small></span></div>
        <div class="cx-pop cx-pop-2"><span class="cx-pop-ico">${ICON.peso}</span><span><b>FSIC renewal</b><small>Government fee ₱2,450</small></span><span class="cx-pop-btn">Approve</span></div>
        <div class="cx-pop cx-pop-3"><span class="cx-pop-ico">${CLOCK}</span><span><b>LTO registration started</b><small>45 days before it's due</small></span></div>
      </div>
    </section>

    <section class="cx-year card">
      <h2>${own ? 'Your business, every year' : 'A typical branch, every year'}</h2>
      <div class="cx-nums">
        <div><b>${own ? y.renewals : 4}</b><span>renewals to do</span></div>
        <div><b>${own ? `~${y.hours}` : '~14'}</b><span>hours of lining up, paying and coming back to claim</span></div>
        <div><b>${own ? y.days : 2}</b><span>working ${(own ? y.days : 2) === 1 ? 'day' : 'days'} away from your business</span></div>
      </div>
      <p class="cx-risk">Miss one and it costs more: a late business permit is <b>25% extra plus 2% a month</b>. A late car registration is <b>₱200 a week</b>.</p>
    </section>

    <section class="cx-vs" aria-labelledby="cx-vs-h">
      <h2 id="cx-vs-h">Reminders tell you. Year-round care does it.</h2>
      <div class="cx-vs-grid">
        <div class="cx-col">
          <p class="cx-col-tag">What you have now · free</p>
          <h3>A reminder</h3>
          <ul>
            <li class="yes">${ICON.check}<span>We tell you a permit is due</span></li>
            <li class="no">${X_ICON}<span>You gather the papers</span></li>
            <li class="no">${X_ICON}<span>You line up at city hall or the LTO</span></li>
            <li class="no">${X_ICON}<span>You pay, wait, and go back to claim it</span></li>
            <li class="no">${X_ICON}<span>You upload the new permit</span></li>
          </ul>
          <p class="cx-cost">Your time: <b>about a day per permit</b></p>
        </div>
        <div class="cx-col on">
          <p class="cx-col-tag">Year-round care</p>
          <h3>We do it for you</h3>
          <ul>
            <li class="yes">${ICON.check}<span>We start two months before it's due</span></li>
            <li class="yes">${ICON.check}<span>We prepare the papers and line up</span></li>
            <li class="yes">${ICON.check}<span>You approve the government fee on your phone</span></li>
            <li class="yes">${ICON.check}<span>The new permit appears in your account</span></li>
            <li class="yes">${ICON.check}<span>Nothing expires. No penalties.</span></li>
          </ul>
          <p class="cx-cost">Your time: <b>about 5 minutes per permit</b></p>
        </div>
      </div>
    </section>

    <section class="cx-steps card" aria-labelledby="cx-steps-h">
      <h2 id="cx-steps-h">How it works</h2>
      <ol>
        <li><b>Pick your branches and vehicles</b><span>Two minutes. We already know which permits each one needs.</span></li>
        <li><b>We start each renewal early</b><span>About 2 months before it's due, so there's no rush and no line on deadline day.</span></li>
        <li><b>You say yes to the fee</b><span>We send the exact government fee first. You pay it at cost, with official receipts. We do everything else.</span></li>
      </ol>
    </section>

    <section class="cx-price card">
      <div class="cx-price-main">
        <h2>One simple price</h2>
        <div class="cx-price-row">
          ${Number.isFinite(y.b) ? html`<div><b>${peso(y.b)}</b><span>a month per branch</span></div>` : ''}
          ${Number.isFinite(y.v) ? html`<div><b>${peso(y.v)}</b><span>a month per vehicle</span></div>` : ''}
        </div>
        <p class="muted">Our work is included. Government fees are paid at cost. Pay yearly and get 2 months free. Stop anytime.</p>
        ${own && y.monthly ? html`<p class="cx-yours">For your ${[y.branches ? plural(y.branches, 'branch', 'branches') : '', y.vehicles ? plural(y.vehicles, 'vehicle') : ''].filter(Boolean).join(' and ')}: <b>${peso(y.monthly)} a month</b></p>` : ''}
        ${startBtn('Choose what we handle')}
      </div>
      ${plus ? html`<div class="cx-plus">${SHIELD}<div><b>Want zero risk? Care Plus.</b>
        <span>If we're ever late, we pay the penalty (up to ${peso(plus.guarantee_cap_php)} per permit), plus a yearly pre-inspection visit. ${tiersFor('branch').find((t) => t.guarantee) ? peso(tiersFor('branch').find((t) => t.guarantee).monthly_php) + ' a month per branch' : ''}${tiersFor('vehicle').find((t) => t.guarantee) ? ', ' + peso(tiersFor('vehicle').find((t) => t.guarantee).monthly_php) + ' per vehicle' : ''}.</span></div></div>` : ''}
    </section>

    <section class="cx-faq">
      <h2>Questions</h2>
      ${coveredDetails()}
      <details><summary>Do I still pay the government fees?</summary><p>Yes, at cost, with official receipts. We always show you the exact amount before we pay it, and nothing is filed until you say yes.</p></details>
      <details><summary>Can I stop anytime?</summary><p>Yes, with one tap. The plan runs to the end of the month you've paid, then stops. Nothing more is billed.</p></details>
      <details><summary>Why not just pay per renewal?</summary><p>You can. Then you have to remember each one, ask us, and approve a new price every time. With Year-round care we start on our own, two months early, so nothing slips. If you only have one or two permits, paying per renewal may suit you better.</p></details>
      <details><summary>What if you're late?</summary><p>That's what Care Plus is for: if a permit lapses because we missed its deadline, we pay the late penalty, up to ${plus ? peso(plus.guarantee_cap_php) : 'the plan\'s limit'} per permit. <a href="terms.html#guarantee" target="_blank" rel="noopener">How the guarantee works</a></p></details>
    </section>
    ${fineprint()}`;
}

function coveredDetails() {
  const b = tiersFor('branch')[0], v = tiersFor('vehicle')[0];
  return html`<details class="cx-covers"><summary>Which permits are included?</summary>
    ${b ? html`<p><b>For a branch:</b> ${typeNames(b.covers).join(', ')}.</p>` : ''}
    ${v ? html`<p><b>For a vehicle:</b> ${typeNames(v.covers).join(', ')}.</p>` : ''}
    <p class="muted">Not included (we quote these separately): FDA or DOH licences, franchises, contractor licences, staff licences and health certificates, and new permits you don't have yet.</p></details>`;
}

const fineprint = () => html`<p class="muted small fineprint">Care covers our service fee for the yearly permits listed on each plan. Government fees, premiums and penalties are paid at cost with official receipts. Cancel anytime: the plan runs to the end of what you've paid, with no refund for the rest of that period.
  <a href="terms.html#care" target="_blank" rel="noopener">Year-round care terms</a></p>`;

// The next renewal care will start on its own, across all plans.
function nextStart(plans) {
  const live = new Set(plans.filter((p) => p.status === 'active').map((p) => p.id));
  let best = null;
  for (const cv of careOf().coverage) {
    if (!live.has(cv.plan_id)) continue;
    const r = reqById(cv.requirement_id);
    if (!r || !r.expires || !r.expires_on || r.open_request_id) continue;
    const lead = r.subject === 'vehicle' ? LEAD_DAYS.vehicle : LEAD_DAYS.business;
    const on_ = new Date(Date.parse(r.expires_on) - lead * 864e5).toISOString().slice(0, 10);
    if (!best || on_ < best.on) best = { r, on: on_ };
  }
  return best;
}

function planPage(c, plans) {
  const ended = c.plans.filter((p) => p.status === 'cancelled');
  const dueBills = c.invoices.filter((i) => ['due', 'pending_verification'].includes(i.status));
  const careOrders = (S.data.requests || []).filter((a) => a.care_plan_id);
  const open = careOrders.filter((a) => !['completed', 'cancelled'].includes(a.status));
  const asks = open.filter((a) => a.status === 'quoted' || a.payment_status === 'awaiting_payment');
  const done = careOrders.filter((a) => a.status === 'completed').length;
  const handled = new Set(c.coverage.filter((x) => plans.some((p) => p.id === x.plan_id)).map((x) => x.requirement_id)).size;
  const plus = plans.filter((p) => tierOf(p.tier)?.guarantee);
  const next = nextStart(plans);
  const needs = dueBills.length + asks.length;
  return html`
    <section class="cx-status card">
      <div class="cx-status-ico">${ICON.check}</div>
      <div class="cx-status-text">
        <p class="cx-eyebrow">Year-round care</p>
        <h1>We're handling ${plural(handled, 'permit')} for you.</h1>
        <p class="muted">${open.length ? `${plural(open.length, 'renewal')} in progress right now. ` : ''}${next ? `Next up: ${next.r.name} (${subjectLabel(next.r)}). We start ${next.on <= todayPH() ? 'this week' : 'on ' + fmtDate(next.on)}.` : open.length ? '' : 'Nothing is due soon.'}${done ? ` ${plural(done, 'renewal')} done so far.` : ''}</p>
      </div>
      ${when(canEdit(), html`<a class="btn btn-soft" href="#/care/start">+ Add more</a>`)}
    </section>

    ${needs ? html`<section class="card cx-needs"><div class="card-head"><div><h2>Needs you</h2><p class="card-sub">${needs === 1 ? 'One thing' : `${needs} things`} only you can do. Everything else is on us.</p></div></div>
      ${dueBills.map((i) => billBanner(i))}
      ${asks.map(orderLine)}</section>` : ''}

    <section class="card">
      <div class="card-head"><div><h2>What we handle</h2><p class="card-sub">We start each renewal about 2 months before it's due (45 days for vehicles).</p></div></div>
      ${plans.map(planRow)}
    </section>

    ${open.filter((a) => !asks.includes(a)).length ? html`<section class="card"><div class="card-head"><div><h2>In progress</h2><p class="card-sub">Open one to see where it is or message us.</p></div></div>
      ${open.filter((a) => !asks.includes(a)).map(orderLine)}</section>` : ''}

    <section class="cx-faq cx-details">
      <h2>Plan details</h2>
      <details ${Number(S.org.care_gov_preapproval_php || 0) ? '' : 'open'}><summary>Approving government fees</summary>${preapprovalCard()}</details>
      ${when(plus.length, html`<details><summary>On-time guarantee (Care Plus)</summary>${guaranteeCard(plus)}</details>`)}
      ${when(c.invoices.length, html`<details><summary>Bills and receipts</summary>${billsCard(c.invoices)}</details>`)}
      ${coveredDetails()}
      ${when(ended.length, html`<details><summary>${plural(ended.length, 'ended plan')}</summary>${ended.map(planRow)}</details>`)}
    </section>
    ${fineprint()}`;
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
      <div class="row-sub">${plural(reqs.length, 'permit')} handled${soon ? ` · ${soon} coming up` : ''} · ${peso(p.price_php)} a ${per(p.billing)}${missing ? html` · <span class="due needinfo">${missing} missing an expiry date</span>` : ''}</div>
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
  return html`<div class="cx-sub"><p class="muted small">Our fee for care. Government fees are paid on each renewal.</p>
    <div class="table-wrap"><table class="table"><thead><tr><th>Bill</th><th>Covers</th><th>Amount</th><th>Status</th><th><span class="sr-only">Action</span></th></tr></thead><tbody>
    ${list.map((i) => { const [l, cls] = BILL_STATUS[i.status] || [i.status, '']; return html`<tr>
      <td>${i.number}</td><td>${i.status === 'paid' || !i.first ? `${fmtDate(i.period_start)} – ${fmtDate(i.period_end)}` : 'Starts when paid'}</td>
      <td>${peso(i.amount_php)}<div class="muted small">${(i.lines || []).map((x) => x.label).join(', ')}</div></td>
      <td><span class="chip ${billOverdue(i) ? 'overdue' : cls}">${billOverdue(i) ? 'Overdue' : l}</span>${i.paid_at ? html`<div class="muted small">${fmtDate(i.paid_at.slice(0, 10))}</div>` : ''}</td>
      <td>${i.status === 'due' && canEdit() ? html`<button class="btn btn-sm btn-primary" data-act="care-pay" data-id="${i.id}">Pay</button>` : ''}</td></tr>`; })}
    </tbody></table></div></div>`;
}

function preapprovalCard() {
  const v = Number(S.org.care_gov_preapproval_php || 0);
  return html`<div class="cx-sub">
    <p class="muted small">For each renewal we send you the exact government fee first. To save you a step, we can go ahead when it's within an amount you choose (you still pay before we file).</p>
    ${isOrgAdmin() ? html`<form class="inline-form care-pre"><label class="field"><span>Go ahead without asking me when fees are up to (₱)</span>
        <input name="amount" type="number" min="0" max="200000" step="100" value="${v}" required></label>
        <button class="btn btn-sm btn-soft">Save</button></form>
      <p class="muted small">${v ? `Now: up to ${peso(v)} per renewal. Higher amounts still need your OK.` : 'Now: we always ask you first.'}</p>`
      : html`<p>${v ? `Up to ${peso(v)} per renewal is approved for you.` : 'You approve every renewal\'s fees yourself.'}</p>`}
  </div>`;
}

function guaranteeCard(plus) {
  const claims = careOf().claims;
  const st = { submitted: ['Being reviewed', 'progress'], approved: ['Approved', 'ok'], declined: ['Declined', 'needinfo'], paid: ['Paid to you', 'ok'] };
  return html`<div class="cx-sub"><div class="card-head"><div>
      <p class="card-sub">If a covered permit lapses because we missed its deadline, we pay the late penalty${plus[0] ? ` (up to ${peso(tierOf(plus[0].tier)?.guarantee_cap_php)} per permit)` : ''}.</p></div>
      ${when(canEdit(), html`<button class="btn btn-sm btn-soft" data-act="care-claim">Claim it</button>`)}</div>
    <p class="muted small">It applies when the plan was paid up on the expiry date, the permit was in your plan at least 30 days before it expired, and you sent what we asked for within 7 days. Send the official receipt that shows the penalty within 90 days.</p>
    ${claims.map((g) => { const [l, cls] = st[g.status]; return html`<div class="line"><span class="line-main"><b>${g.requirement_name}</b>
      <small>Expired ${fmtDate(g.lapsed_on)} · penalty ${peso(g.penalty_php)}${g.approved_php != null ? ' · approved ' + peso(g.approved_php) : ''}${g.decision_note ? ' · ' + g.decision_note : ''}</small></span>
      <span class="chip ${cls}">${l}</span></div>`; })}
  </div>`;
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
    <div class="page-head"><div><h1>Let PermitPal handle your renewals</h1><p class="muted">Pick what we should look after. You'll see the total before you pay anything, and you can stop anytime.</p></div></div>
    ${when(!can, html`<div class="banner warn"><div>Only ${ownerName()} (the owner) can start a paid plan. You can look, and share this page with them.</div></div>`)}
    <form class="care-form" novalidate>
      <section class="card"><h2>1. What should we handle?</h2>
        ${when(subjects.some((s) => s.kind === 'location'), html`<h3 class="section-label">Branches</h3>${subjects.filter((s) => s.kind === 'location').map(row)}`)}
        ${when(subjects.some((s) => s.kind === 'vehicle'), html`<h3 class="section-label">Vehicles</h3>${subjects.filter((s) => s.kind === 'vehicle').map(row)}`)}
        ${when(can, html`<div class="btn-row"><button type="button" class="btn btn-sm btn-ghost" data-pick-all>Choose all</button><button type="button" class="btn btn-sm btn-ghost" data-pick-none>Clear</button></div>`)}
      </section>
      <section class="card"><h2>2. Choose your plan</h2>
        ${levels.map((lv) => { const b = tiers.branch.find((t) => !!t.guarantee === (lv === 'plus')); const v = tiers.vehicle.find((t) => !!t.guarantee === (lv === 'plus'));
          return html`<label class="check care-level"><input type="radio" name="level" value="${lv}" ${lv === 'care' ? 'checked' : ''} ${can ? '' : 'disabled'}>
            <span><b>${(b || v)?.name}</b> <small class="muted">${b ? `${peso(b.monthly_php)} per branch` : ''}${b && v ? ' · ' : ''}${v ? `${peso(v.monthly_php)} per vehicle` : ''} a month</small>
            <small>${lv === 'plus' ? 'Same as Care, and if we\'re ever late, we pay the penalty. Includes a yearly pre-inspection visit per branch.' : 'We renew everything on time. Our work is included.'}</small></span></label>`; })}
      </section>
      <section class="card"><h2>3. Pay monthly or yearly</h2>
        <label class="check"><input type="radio" name="billing" value="monthly" checked ${can ? '' : 'disabled'}><span><b>Monthly</b> <small class="muted">Stop anytime. It runs to the end of the month you've paid.</small></span></label>
        <label class="check"><input type="radio" name="billing" value="yearly" ${can ? '' : 'disabled'}><span><b>Yearly</b> <small class="muted">2 months free. No refund if you stop part-way.</small></span></label>
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
