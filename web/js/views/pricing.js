// How PermitPal's prices are shown, on the website and under Settings > Plan: each plan with a plain
// checkmark list, the monthly price with what it comes to a day (and per client, vehicle or tenant), and
// the yearly deal (pay for 10 months, get 12) made easy to see. Every price comes from the plans table or
// prices.js, the same numbers the database charges; nothing here sets a price.
import { html, raw, peso } from '../util.js';
import { ICON } from '../components.js';
import { YEAR_MONTHS, FREE_MONTHS, PLUS_MONTHLY, BRAND_MONTHLY, FREE_PEOPLE, BANDS, staffMonthly } from '../prices.js';

// ---------------------------------------------------------------- monthly or yearly (remembered on this device)
let billing = (() => { try { return localStorage.getItem('pp-billing') === 'yearly' ? 'yearly' : 'monthly'; } catch { return 'monthly'; } })();
export const getBilling = () => billing;
export function setBilling(v) {
  billing = v === 'yearly' ? 'yearly' : 'monthly';
  try { localStorage.setItem('pp-billing', billing); } catch { /* private mode: this visit only */ }
  document.querySelectorAll('.bill-toggle input').forEach((i) => { i.checked = i.value === billing; });
  document.querySelectorAll('[data-price]').forEach(paintPrice);
  document.querySelectorAll('[data-bill-swap]').forEach((b) => { b.textContent = billing === 'yearly' ? b.dataset.y : b.dataset.m; b.dataset.billing = billing; });
  document.dispatchEvent(new CustomEvent('pp-billing', { detail: billing }));
}
let toggles = 0;
export const billToggle = (label = 'How often to pay') => {
  const n = ++toggles;
  return html`<div class="bill-toggle" role="radiogroup" aria-label="${label}">
    <label><input type="radio" name="pp-bill-${n}" value="monthly" ${billing === 'monthly' ? 'checked' : ''}><span>Pay monthly</span></label>
    <label><input type="radio" name="pp-bill-${n}" value="yearly" ${billing === 'yearly' ? 'checked' : ''}><span>Pay yearly <em>2 months FREE</em></span></label></div>`;
};
document.addEventListener('change', (e) => { if (e.target.closest?.('.bill-toggle')) setBilling(e.target.value); });
document.addEventListener('click', (e) => { const b = e.target.closest?.('[data-bill-set]'); if (b) { e.preventDefault(); setBilling(b.dataset.billSet); } });

// ---------------------------------------------------------------- the price, both ways
const under = (n) => `less than ${peso(Math.floor(n) + 1)}`; // always true: ₱65.42 a day is "less than ₱66"
const yearOf = (m) => m * YEAR_MONTHS;
export const perMonthYearly = (m) => Math.round((m * YEAR_MONTHS) / 12);
// 12 little boxes: 10 you pay for, 2 free.
export const yearStrip = () => html`<div class="year-strip" role="img" aria-label="Pay for ${YEAR_MONTHS} months, get 12">
  ${Array.from({ length: YEAR_MONTHS }, (_, i) => html`<span class="ys-paid">${i + 1}</span>`)}<span class="ys-free">${FREE_MONTHS} FREE</span></div>`;

// A price slot: <div data-price="1990" data-per="40" data-unit="client">. Painted now and on every switch.
export const priceSlot = (monthly, { per, unit, kind = '' } = {}) => html`<div class="pp-price" data-price="${monthly}" data-per="${per || ''}" data-unit="${unit || ''}" data-kind="${kind}"></div>`;
function paintPrice(el) {
  const m = Number(el.dataset.price);
  if (!(m > 0)) return;
  const per = Number(el.dataset.per);
  const unit = el.dataset.unit;
  if (billing === 'yearly') {
    const y = yearOf(m);
    el.innerHTML = String(html`<span class="pp-ribbon">${FREE_MONTHS} months FREE</span>
      <div class="pp-amount"><b>${peso(perMonthYearly(m))}</b><span>/month</span></div>
      <p class="pp-billed"><s aria-label="was ${peso(m * 12)}">${peso(m * 12)}</s> <b>${peso(y)}</b> once a year</p>
      <p class="pp-save">${ICON.check} You save ${peso(m * FREE_MONTHS)}</p>
      ${yearStrip()}
      <p class="pp-strip-cap">Pay for ${YEAR_MONTHS} months. Get 12.</p>
      ${per && unit ? html`<p class="pp-unit">With ${per} ${unit}s: ${under(y / 12 / per)} a ${unit} a month</p>` : ''}`);
  } else {
    el.innerHTML = String(html`<div class="pp-amount"><b>${peso(m)}</b><span>/month</span></div>
      <p class="pp-day">That's ${under((m * 12) / 365)} a day</p>
      ${per && unit ? html`<p class="pp-unit">With ${per} ${unit}s: ${under(m / per)} a ${unit}</p>` : ''}
      <button type="button" class="pp-nudge" data-bill-set="yearly">Pay yearly and get ${FREE_MONTHS} months FREE: save ${peso(m * FREE_MONTHS)} →</button>`);
  }
}
export const paintPrices = (root = document) => root.querySelectorAll('[data-price]').forEach(paintPrice);
// A button whose words (and data-billing) follow the switch. attrs is fixed markup from our own code.
export const billButton = (attrs, m, y, cls = 'btn btn-primary') => html`<button type="button" class="${cls}" ${raw(attrs)} data-bill-swap data-billing="${billing}" data-m="${m}" data-y="${y}">${billing === 'yearly' ? y : m}</button>`;

// ---------------------------------------------------------------- what each plan gives (plain words)
const tick = (t) => html`<li>${ICON.check}<span>${t}</span></li>`;
export const checks = (list) => html`<ul class="pp-checks">${list.map(tick)}</ul>`;
export const FREE_CHECKS = [
  'Add all your businesses, branches and vehicles',
  'We remind you before anything runs out: 30, 7 and 1 day before',
  'Reminders by email and in the app',
  'A Monday email with what is due',
  'Every permit photo kept safe, forever',
  'Snap a photo: we read the dates for you',
  'Tax, SSS, PhilHealth and Pag-IBIG due dates',
  'Your whole team, at no extra cost',
  "3 staff licences free (health card, NBI, driver's licence)",
  'Send proof to your landlord with one link',
  'All your papers in one download for inspectors',
];
const PLUS_LINE = `PermitPal Plus included (worth ${peso(PLUS_MONTHLY)} a month)`;
export const PLANS = {
  firm: {
    icon: ICON.briefcase, name: 'Accounting firm', who: 'For accountants and bookkeepers with many clients',
    promise: "All your clients' permits on one screen", per: 40, unit: 'client',
    checks: ["See every client's permits on one screen", 'Green means OK. Red means late. No more spreadsheets', 'Remind late clients in one click',
      'Clients join free and update their own permits', "Or look after a client's permits for them", 'Download the copies clients share with you',
      'Text message (SMS) reminders', PLUS_LINE, `Your own logo on client emails, with White-label (add ${peso(BRAND_MONTHLY)})`, 'Everything in Free'],
    why: { title: 'It pays for itself', lines: [(m) => `Charge each client ₱150 a month for permit watching: ${Math.ceil(m / 150)} clients cover it`, 'Never lose a client over a missed permit'] },
  },
  fleet: {
    icon: ICON.car, name: 'Fleet', who: 'For companies with many cars, trucks or motorcycles',
    promise: 'Every vehicle, every renewal, one screen', per: 30, unit: 'vehicle',
    checks: ['Every vehicle on one screen: registration, CTPL, smoke test, inspection', 'See which vehicles should NOT be on the road today',
      'A list of what to renew this month', 'Add your whole fleet from a spreadsheet', 'Sort vehicles by company or branch',
      'Text message (SMS) reminders', PLUS_LINE, 'Download a list for your records', 'Everything in Free'],
    why: { title: 'It pays for itself', lines: ['One unregistered vehicle caught can mean a ₱10,000 LTO fine', 'No surprise renewals: every month starts with a ready list'] },
  },
  property: {
    icon: ICON.grid, name: 'Mall & property', who: 'For malls, buildings and landlords with many tenants',
    promise: "Every tenant's permits, without chasing photocopies", per: 100, unit: 'tenant',
    checks: ["Every tenant's permits on one screen", 'You choose the permits every tenant must keep',
      'Tenants upload their own permits, free. No more chasing paper', "Download any tenant's shared copies in one click",
      'Remind every late tenant in one click', 'Text message (SMS) reminders', PLUS_LINE, 'Download a list for audits and city hall', 'Everything in Free'],
    why: { title: 'Why it costs more', lines: ['It does the work of a full-time admin who chases permits (₱20,000+ a month)',
      'Made for big buildings: 100 tenants × 4 permits = 400 deadlines a year', 'One shop closed for a missing fire permit costs you more in lost rent'] },
  },
};
export const PLAN_ORDER = ['firm', 'fleet', 'property'];

// ---------------------------------------------------------------- cards
export function freeCard(cta = '') {
  return html`<section class="card pp-plan pp-free">
    <div class="pp-plan-head"><span class="pp-icon">${ICON.home}</span><div><h3>Free</h3><p class="pp-who">For your own business</p></div></div>
    <p class="pp-promise">Never miss a permit again</p>
    <div class="pp-price"><div class="pp-amount"><b>₱0</b><span>forever</span></div><p class="pp-day">No card. No time limit.</p></div>
    ${checks(FREE_CHECKS)}
    <div class="pp-cta">${cta}</div></section>`;
}
export function planCard(id, monthly, cta = '', { current = false } = {}) {
  const p = PLANS[id];
  if (!p) return '';
  return html`<section class="card pp-plan ${current ? 'pp-current' : ''}" data-plan-card="${id}">
    <div class="pp-plan-head"><span class="pp-icon">${p.icon}</span><div><h3>${p.name}</h3><p class="pp-who">${p.who}</p></div></div>
    <p class="pp-promise">${p.promise}</p>
    ${monthly > 0 ? priceSlot(monthly, { per: p.per, unit: p.unit }) : html`<div class="pp-price"><p class="pp-day">Loading the price…</p></div>`}
    ${checks(p.checks)}
    <div class="pp-why"><b>${p.why.title}</b>${checks(p.why.lines.map((l) => (typeof l === 'function' ? (monthly > 0 ? l(monthly) : null) : l)).filter(Boolean))}</div>
    <div class="pp-cta">${cta}<p class="pp-trial">30 days free · no card needed</p></div></section>`;
}

// Everything side by side.
const Y = true; const N = false;
const COMPARE = [
  ['All your businesses, branches and vehicles', Y, Y, Y, Y],
  ['Reminders before anything runs out (email and app)', Y, Y, Y, Y],
  ['Monday email with what is due', Y, Y, Y, Y],
  ['Permit photos kept safe, forever', Y, Y, Y, Y],
  ['Snap a photo, we read the dates', Y, Y, Y, Y],
  ['Tax, SSS, PhilHealth, Pag-IBIG due dates', Y, Y, Y, Y],
  ['Your whole team', Y, Y, Y, Y],
  ['3 staff licences', Y, Y, Y, Y],
  ['Proof link and inspection download', Y, Y, Y, Y],
  ['Text message (SMS) reminders', N, Y, Y, Y],
  [`PermitPal Plus (worth ${peso(PLUS_MONTHLY)} a month)`, N, Y, Y, Y],
  ['Everyone you look after on one screen', N, Y, Y, Y],
  ['Remind them in one click', N, Y, N, Y],
  ['They join free and keep their own permits current', N, Y, N, Y],
  ['Download the copies they share', N, Y, N, Y],
  ['Choose the permits they must keep', N, N, N, Y],
  ['Vehicles that should not be on the road today', N, N, Y, N],
  ['Renew-this-month list for vehicles', N, N, Y, N],
  ['Your logo on client emails (White-label add-on)', N, Y, N, N],
  ['Download a list for audits', N, Y, Y, Y],
];
export const compareTable = () => html`<details class="card pp-compare"><summary><b>See everything side by side</b></summary>
  <div class="table-wrap" tabindex="0" role="region" aria-label="Plans side by side"><table class="table pp-table">
    <thead><tr><th scope="col">What you get</th><th scope="col">Free</th><th scope="col">Accounting firm</th><th scope="col">Fleet</th><th scope="col">Mall &amp; property</th></tr></thead>
    <tbody>${COMPARE.map(([t, ...cols]) => html`<tr><th scope="row">${t}</th>${cols.map((c) => html`<td>${c ? html`<span class="pp-yes">${ICON.check}<span class="sr-only">Included</span></span>` : html`<span class="pp-no"><span aria-hidden="true">–</span><span class="sr-only">Not included</span></span>`}</td>`)}</tr>`)}</tbody>
  </table></div></details>`;

// ---------------------------------------------------------------- add-ons
export const PLUS_CHECKS = [
  "Your own permit page and a QR poster: customers see you're legit",
  'Badges for your website and email signature',
  'Your mall or landlord gets each renewal by itself',
  "We check your permits every morning and tell you what's wrong",
  'A report in your inbox on the 1st of every month',
  '8 ready letters and forms, filled in for you (authorization letter, SPA, affidavit of loss…)',
  'Free inside every team plan',
];
export const BRAND_CHECKS = [
  'Your name and logo on every email your clients get',
  'Replies go straight to you',
  "Your logo and colour in your clients' app",
  'A report to every client on the 1st, from you',
  '"Powered by PermitPal" stays small at the bottom',
];
export function addonCard({ id, icon, name, who, monthly, list, status = '', body = '', cta = '', current = false, note = '' }) {
  return html`<section class="card pp-plan pp-addon ${current ? 'pp-current' : ''}" id="${id}">
    <div class="pp-plan-head"><span class="pp-icon">${icon}</span><div><h3>${name}</h3><p class="pp-who">${who}</p></div></div>
    ${status ? html`<p class="pp-status">${status}</p>` : ''}
    ${monthly ? priceSlot(monthly) : ''}
    ${list ? checks(list) : ''}${body}
    ${note ? html`<p class="pp-note">${note}</p>` : ''}
    <div class="pp-cta">${cta}</div></section>`;
}

// Staff licences: the price per person drops as the team grows. Bars show each step's price.
export function staffLadder() {
  const rungs = [{ from: 1, to: FREE_PEOPLE, each: 0 }, ...BANDS];
  const top = BANDS[0].each;
  return html`<div class="ladder" role="list" aria-label="Price per person, per month">
    ${rungs.map((r) => html`<div class="rung ${r.each ? '' : 'free'}" role="listitem">
      ${r.each && r.each < top ? html`<em class="rung-off">${Math.round((1 - r.each / top) * 100)}% off</em>` : html`<em class="rung-off rung-blank" aria-hidden="true"></em>`}
      <b class="rung-price">${r.each ? peso(r.each) : 'FREE'}</b>
      <div class="rung-bar" style="height:${r.each ? Math.round((r.each / top) * 64) + 8 : 8}px" aria-hidden="true"></div>
      <span class="rung-who">${r.from === 1 ? `First ${r.to} people` : r.to === Infinity ? `People ${r.from}+` : `People ${r.from} to ${r.to}`}</span>
      <small>${r.each ? 'each a month' : 'always'}</small></div>`)}
  </div>
  <p class="ladder-cap">The bigger your team, the less each person costs.</p>`;
}
export function staffExamples() {
  return html`<div class="staff-ex">${[10, 50, 200].map((n) => {
    const t = staffMonthly(n);
    const save = (n - FREE_PEOPLE) * BANDS[0].each - t;
    return html`<div><b>${n} people</b><span>${peso(t)} a month</span>${save > 0 ? html`<em>save ${peso(save)}</em>` : html`<em class="plain">3 free + 7 × ${peso(BANDS[0].each)}</em>`}</div>`;
  })}</div>`;
}
