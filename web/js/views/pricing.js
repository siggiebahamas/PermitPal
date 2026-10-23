// How Pinoy Permit's prices are shown, on the website and under Settings > Plan: each plan with a plain
// checkmark list, the monthly price with what it comes to a day (and per client, vehicle or tenant), and
// the yearly deal (pay for 10 months, get 12) made easy to see. Every price comes from the plans table or
// prices.js, the same numbers the database charges; nothing here sets a price.
import { html, raw, peso, todayPH } from '../util.js';
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
// Your next 12 months as little calendar pages, starting this month: the last 2 are free.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function yearCalendar() {
  const start = Number(todayPH().slice(5, 7)) - 1;
  const ms = Array.from({ length: 12 }, (_, i) => MONTHS[(start + i) % 12]);
  const free = ms.slice(YEAR_MONTHS);
  return html`<div class="year-cal" role="img" aria-label="You pay ${ms[0]} to ${ms[YEAR_MONTHS - 1]}; ${free.join(' and ')} are free">
    ${ms.map((m, i) => html`<span class="yc ${i >= YEAR_MONTHS ? 'yc-free' : ''}" aria-hidden="true"><i></i><b>${m}</b>${i >= YEAR_MONTHS ? html`<small>FREE</small>` : ''}</span>`)}</div>
    <p class="pp-strip-cap">You pay ${ms[0]} to ${ms[YEAR_MONTHS - 1]}. ${free.join(' and ')} are on us.</p>`;
}

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
      ${yearCalendar()}
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
  "3 staff licenses free (health card, NBI, driver's license)",
  'Send proof to your landlord with one link',
  'All your papers in one download for inspectors',
];
const FREE_WINS = [[ICON.bell, 'We remind you', '30, 7 and 1 day before anything runs out'], [ICON.camera, "Snap, don't type", 'Take a photo of a permit; we read the dates'],
  [ICON.file, 'All in one place', 'Every permit, vehicle and staff license, kept safe forever']];
const FREE_PREVIEW = { title: 'Your permits', rows: [["Mayor's Permit", 'soon', 'Due in 12 days'], ['Fire safety (FSIC)', 'ok', 'All good'], ['Health card · Ana', 'ok', 'All good']] };
const PLUS_LINE = `Pinoy Permit Plus included (worth ${peso(PLUS_MONTHLY)} a month)`;
const TENANT_PREVIEW = { title: 'Your tenants', rows: [['Unit 1 · Bakeshop', 'ok', 'All good'], ['Unit 5 · Salon', 'soon', 'Due in 14 days'], ['Unit 3 · Pharmacy', 'late', '3 days late', 'Remind']] };
const TENANT_WINS = [[ICON.grid, 'Every tenant, one screen', 'Green is OK. Red is late.'], [ICON.upload, 'Tenants upload their own', 'No more chasing photocopies every January'],
  [ICON.list, 'You set the rules', 'Pick the permits every tenant must keep']];
const tenantChecks = (cap) => [cap, "Every tenant's permits on one screen", 'You choose the permits every tenant must keep',
  'Tenants upload their own permits, free. No more chasing paper', "Download any tenant's shared copies in one click",
  'Remind every late tenant in one click', 'Text message (SMS) reminders', PLUS_LINE, 'Download a list for audits and city hall', 'Everything in Free'];
export const PLANS = {
  firm: {
    icon: ICON.briefcase, name: 'Accounting firm', who: 'For accountants and bookkeepers with many clients',
    promise: "All your clients' permits on one screen", per: 40, unit: 'client', kind: 'firm',
    preview: { title: 'Your clients', rows: [['Dela Rosa Bakery', 'ok', 'All good'], ['Santos Sari-sari', 'soon', 'Due in 9 days'], ['Lim Hardware', 'late', '5 days late', 'Remind']] },
    wins: [[ICON.grid, 'All clients, one screen', 'Green is OK. Red is late. No spreadsheets.'], [ICON.bell, 'Remind in one tap', 'Late clients get a reminder from you'],
      [ICON.upload, 'Clients do the updating', 'They join free and keep their own permits current']],
    checks: ["See every client's permits on one screen", 'Green means OK. Red means late. No more spreadsheets', 'Remind late clients in one click',
      'Clients join free and update their own permits', "Or look after a client's permits for them", 'Download the copies clients share with you',
      'Text message (SMS) reminders', PLUS_LINE, `Your own logo on client emails, with White-label (add ${peso(BRAND_MONTHLY)})`, 'Everything in Free'],
    why: { title: 'It pays for itself', lines: [(m) => `Charge each client ₱150 a month for permit watching: ${Math.ceil(m / 150)} clients cover it`, 'Never lose a client over a missed permit'] },
  },
  fleet: {
    icon: ICON.car, name: 'Fleet', who: 'For companies with many cars, trucks or motorcycles',
    promise: 'Every vehicle, every renewal, one screen', per: 30, unit: 'vehicle', kind: 'fleet',
    preview: { title: 'Your vehicles', rows: [['ABC 1234 · Van', 'ok', 'Good to go'], ['NBX 5521 · Truck', 'late', 'Off the road'], ['TQS 980 · Car', 'soon', 'Renew in 6 days']] },
    wins: [[ICON.car, 'Every vehicle, one screen', 'Registration, CTPL, smoke test, inspection'], [ICON.check, "Who can't drive today", 'Expired papers show up first'],
      [ICON.calendar, 'Renew-this-month list', 'Ready on the 1st of every month']],
    checks: ['Every vehicle on one screen: registration, CTPL, smoke test, inspection', 'See which vehicles should NOT be on the road today',
      'A list of what to renew this month', 'Add your whole fleet from a spreadsheet', 'Sort vehicles by company or branch',
      'Text message (SMS) reminders', PLUS_LINE, 'Download a list for your records', 'Everything in Free'],
    why: { title: 'It pays for itself', lines: ['One unregistered vehicle caught can mean a ₱10,000 LTO fine', 'No surprise renewals: every month starts with a ready list'] },
  },
  property_s: {
    icon: ICON.building, name: 'Small property', who: 'For landlords and small buildings: up to 20 tenants',
    promise: "Every tenant's permits, without chasing photocopies", per: 20, unit: 'tenant', kind: 'property',
    preview: TENANT_PREVIEW, wins: TENANT_WINS, checks: tenantChecks('Up to 20 tenants'),
    why: { title: 'Made for landlords', lines: ['Everything the big plan has, for up to 20 tenants', 'Grow past 20? Move up anytime, nothing to set up again'] },
  },
  property: {
    icon: ICON.grid, name: 'Mall & property', who: 'For malls and big buildings: any number of tenants',
    promise: "Every tenant's permits, without chasing photocopies", per: 100, unit: 'tenant', kind: 'property',
    preview: TENANT_PREVIEW, wins: TENANT_WINS, checks: tenantChecks('Any number of tenants'),
    why: { title: 'Why it costs more', lines: ['It does the work of a full-time admin who chases permits (₱20,000+ a month)',
      'Made for big buildings: 100 tenants × 4 permits = 400 deadlines a year', 'One shop closed for a missing fire permit costs you more in lost rent'] },
  },
};
export const PLAN_ORDER = ['firm', 'fleet', 'property_s', 'property'];
// The plans this database sells (Small property only once its file has run). Before the prices load: all.
export const plansShown = (plans) => (plans?.length ? PLAN_ORDER.filter((id) => plans.some((p) => p.id === id)) : PLAN_ORDER);

// ---------------------------------------------------------------- cards
const LABEL = { ok: 'OK', soon: 'Soon', late: 'Late' };
// A small picture of the board the plan gives you (example data).
const preview = (pv) => html`<div class="pp-preview" role="img" aria-label="Example: ${pv.title.toLowerCase()} and their status">
  <div class="pv-head"><b>${pv.title}</b><span class="pv-dots" aria-hidden="true"><i></i><i></i><i></i></span></div>
  ${pv.rows.map(([name, st, txt, btn]) => html`<div class="pv-row" aria-hidden="true"><span class="pv-name">${name}</span>
    <span class="pv-pill pv-${st}" title="${LABEL[st]}">${txt}</span>${btn ? html`<span class="pv-btn">${btn}</span>` : ''}</div>`)}</div>`;
const wins = (list) => html`<ul class="pp-wins">${list.map(([ic, t, d]) => html`<li><span class="pw-icon">${ic}</span><span><b>${t}</b><small>${d}</small></span></li>`)}</ul>`;
const everything = (list) => html`<details class="pp-all"><summary><span>Everything included</span> <b>${list.length}</b></summary>${checks(list)}</details>`;
const bonus = () => html`<div class="pp-bonus"><span>${ICON.check} Pinoy Permit Plus included <s>${peso(PLUS_MONTHLY)}/mo</s></span><span>${ICON.check} Text reminders</span></div>`;

export function freeCard(cta = '') {
  return html`<section class="card pp-plan pp-free">
    <div class="pp-free-a">
      <div class="pp-plan-head"><span class="pp-icon">${ICON.home}</span><div><h3>Free</h3><p class="pp-who">For your own business</p></div></div>
      <p class="pp-promise">Never miss a permit again</p>
      <div class="pp-price"><div class="pp-amount"><b>₱0</b><span>forever</span></div><p class="pp-day">No card. No time limit. No catch.</p></div>
      <div class="pp-cta">${cta}</div>
    </div>
    <div class="pp-free-b">${preview(FREE_PREVIEW)}${wins(FREE_WINS)}${everything(FREE_CHECKS)}</div></section>`;
}
export function planCard(id, monthly, cta = '', { current = false, trialLine = true } = {}) {
  const p = PLANS[id];
  if (!p) return '';
  return html`<section class="card pp-plan ${current ? 'pp-current' : ''}" data-plan-card="${id}">
    <div class="pp-plan-head"><span class="pp-icon">${p.icon}</span><div><h3>${p.name}</h3><p class="pp-who">${p.who}</p></div></div>
    <p class="pp-promise">${p.promise}</p>
    ${preview(p.preview)}
    ${monthly > 0 ? priceSlot(monthly, { per: p.per, unit: p.unit }) : html`<div class="pp-price"><p class="pp-day">Loading the price…</p></div>`}
    ${wins(p.wins)}${bonus()}${everything(p.checks)}
    <div class="pp-why"><b>${p.why.title}</b>${checks(p.why.lines.map((l) => (typeof l === 'function' ? (monthly > 0 ? l(monthly) : null) : l)).filter(Boolean))}</div>
    <div class="pp-cta">${cta}${trialLine ? html`<p class="pp-trial">30 days free · no card needed</p>` : ''}</div></section>`;
}

// Everything side by side (a tick, a dash, or a few words).
const Y = true; const N = false;
const COMPARE = [
  ['All your businesses, branches and vehicles', Y, Y, Y, Y, Y],
  ['Reminders before anything runs out (email and app)', Y, Y, Y, Y, Y],
  ['Monday email with what is due', Y, Y, Y, Y, Y],
  ['Permit photos kept safe, forever', Y, Y, Y, Y, Y],
  ['Snap a photo, we read the dates', Y, Y, Y, Y, Y],
  ['Tax, SSS, PhilHealth, Pag-IBIG due dates', Y, Y, Y, Y, Y],
  ['Your whole team', Y, Y, Y, Y, Y],
  ['3 staff licenses', Y, Y, Y, Y, Y],
  ['Proof link and inspection download', Y, Y, Y, Y, Y],
  ['Text message (SMS) reminders', N, Y, Y, Y, Y],
  [`Pinoy Permit Plus (worth ${peso(PLUS_MONTHLY)} a month)`, N, Y, Y, Y, Y],
  ['Everyone you look after on one screen', N, 'Clients', 'Vehicles', 'Up to 20 tenants', 'Any number of tenants'],
  ['Remind them in one click', N, Y, N, Y, Y],
  ['They join free and keep their own permits current', N, Y, N, Y, Y],
  ['Download the copies they share', N, Y, N, Y, Y],
  ['Choose the permits they must keep', N, N, N, Y, Y],
  ['Vehicles that should not be on the road today', N, N, Y, N, N],
  ['Renew-this-month list for vehicles', N, N, Y, N, N],
  ['Your logo on client emails (White-label add-on)', N, Y, N, N, N],
  ['Download a list for audits', N, Y, Y, Y, Y],
];
const cellOf = (c) => (c === true ? html`<span class="pp-yes">${ICON.check}<span class="sr-only">Included</span></span>`
  : c === false ? html`<span class="pp-no"><span aria-hidden="true">–</span><span class="sr-only">Not included</span></span>` : html`<span class="pp-word">${c}</span>`);
const COLS = ['free', ...PLAN_ORDER];
export const compareTable = (ids = PLAN_ORDER) => {
  const keep = COLS.map((c) => c === 'free' || ids.includes(c));
  return html`<details class="card pp-compare"><summary><b>See everything side by side</b></summary>
  <div class="table-wrap" tabindex="0" role="region" aria-label="Plans side by side"><table class="table pp-table">
    <thead><tr><th scope="col">What you get</th>${COLS.filter((c, i) => keep[i]).map((c) => html`<th scope="col">${c === 'free' ? 'Free' : PLANS[c].name}</th>`)}</tr></thead>
    <tbody>${COMPARE.filter(([, ...cols]) => cols.some((c, i) => keep[i] && c !== false)).map(([t, ...cols]) => html`<tr><th scope="row">${t}</th>${cols.filter((c, i) => keep[i]).map((c) => html`<td>${cellOf(c)}</td>`)}</tr>`)}</tbody>
  </table></div></details>`;
};

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
  "Your logo and color in your clients' app",
  'A report to every client on the 1st, from you',
  '"Powered by Pinoy Permit" stays small at the bottom',
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

// Staff licenses: every kind of staff license is tracked, and the people do the chasing for you.
export const STAFF_TRACKS = ['Health cards', 'NBI clearances', 'Police clearances', "Driver's licenses", 'PRC licenses', 'TESDA certificates', 'Security guard licenses', 'Any other you add'];
export const STAFF_CHECKS = [
  'We remind each person by email before theirs runs out',
  'They send a photo of the new one from their phone. You just tap Approve',
  'See who is not cleared to work today',
  "Set licenses by role once (every driver: driver's license + NBI)",
  "Everyone's licenses in one download for inspectors",
];
export const staffTracks = () => html`<div class="staff-tracks"><b>Every license your team needs</b>
  <ul>${STAFF_TRACKS.map((t, i) => html`<li class="${i === STAFF_TRACKS.length - 1 ? 'more' : ''}">${t}</li>`)}</ul></div>`;
// The price per person drops as the team grows. Every bar stands on the same line; its height is the price.
export function staffLadder() {
  const rungs = [{ from: 1, to: FREE_PEOPLE, each: 0 }, ...BANDS];
  const top = BANDS[0].each;
  return html`<p class="ladder-head">Price per person, each month</p>
  <div class="ladder" role="list" aria-label="Price per person, per month">
    ${rungs.map((r) => html`<div class="rung ${r.each ? '' : 'free'}" role="listitem">
      <span class="rung-off-slot">${r.each && r.each < top ? html`<em class="rung-off">${Math.round((1 - r.each / top) * 100)}% off</em>` : ''}</span>
      <b class="rung-price">${r.each ? peso(r.each) : 'FREE'}</b>
      <span class="rung-track" aria-hidden="true"><span class="rung-bar" style="height:${r.each ? Math.round((r.each / top) * 100) : 6}%"></span></span>
      <span class="rung-who">${r.to === Infinity ? `${r.from}+` : `${r.from} to ${r.to}`}</span>
      <small>people</small></div>`)}
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
