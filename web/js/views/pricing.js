// How Pinoy Permit's prices are shown, on the website and under Settings > Plan: each plan with a plain
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
      <p class="pp-save pp-quiet">That's <b>${peso(m * FREE_MONTHS)} less</b> than paying month to month.</p>
      ${per && unit ? perBox(perUp(y / 12 / per), unit) : ''}`);
  } else {
    el.innerHTML = String(html`<div class="pp-amount"><b>${peso(m)}</b><span>/month</span></div>
      <p class="pp-day pp-perday">That's ${under((m * 12) / 365)} a day</p>
      ${per && unit ? perBox(perUp(m / per), unit) : ''}
      <button type="button" class="pp-nudge" data-bill-set="yearly">Pay yearly and get ${FREE_MONTHS} months FREE: save ${peso(m * FREE_MONTHS)} →</button>`);
  }
}
// What it comes to for each vehicle or site, in whole pesos: rounded up to the next ₱5 ("under ₱50" for ₱49.97).
const UNIT_ICON = { vehicle: ICON.car, site: ICON.building, client: ICON.briefcase };
export const perUp = (n) => { const c = Math.ceil(n / 5 - 1e-9) * 5; return c - n < 0.005 ? peso(c) : `under ${peso(c)}`; };
export const perBox = (v, unit) => html`<div class="pp-per"><span class="pp-per-ic" aria-hidden="true">${UNIT_ICON[unit] || ICON.grid}</span>
  <span class="pp-per-t"><b>${v}</b> <em>per ${unit} a month</em></span></div>`;
export const paintPrices = (root = document) => root.querySelectorAll('[data-price]').forEach(paintPrice);
// A button whose words (and data-billing) follow the switch. attrs is fixed markup from our own code.
export const billButton = (attrs, m, y, cls = 'btn btn-primary') => html`<button type="button" class="${cls}" ${raw(attrs)} data-bill-swap data-billing="${billing}" data-m="${m}" data-y="${y}">${billing === 'yearly' ? y : m}</button>`;

// ---------------------------------------------------------------- what each plan gives (plain words)
const tick = (t) => html`<li>${ICON.check}<span>${t}</span></li>`;
export const checks = (list) => html`<ul class="pp-checks">${list.map(tick)}</ul>`;
export const FREE_CHECKS = [
  'Track 1 business and 1 vehicle',
  'Your status board and renewal timeline',
  'We remind you 30, 7 and 1 day before anything runs out (email and in the app)',
  'Checklists with links to the official sources',
  'Keep up to 3 files for each business or vehicle',
  'Snap a photo: we read the dates for you',
  'Tax, SSS, PhilHealth and Pag-IBIG due dates',
  "3 staff licenses free (health card, NBI, driver's license)",
  'Tracking and planning software only: hands-on help is a separate service',
];
const FREE_WINS = [[ICON.bell, 'We remind you', '30, 7 and 1 day before anything runs out'], [ICON.camera, "Snap, don't type", 'Take a photo of a permit; we read the dates'],
  [ICON.file, 'All in one place', '1 business and 1 vehicle, with their files']];
const FREE_PREVIEW = { title: 'Your permits', rows: [["Mayor's Permit", 'soon', 'Due in 12 days'], ['Fire safety (FSIC)', 'ok', 'All good'], ['Health card · Ana', 'ok', 'All good']] };
const PLUS_LINE = `Pinoy Permit Plus included (worth ${peso(PLUS_MONTHLY)} a month)`;
const TENANT_PREVIEW = { title: 'Your sites', rows: [['Unit 1 · Bakeshop', 'ok', 'All good'], ['Unit 5 · Salon', 'soon', 'Due in 14 days'], ['Unit 3 · Pharmacy', 'late', '3 days late', 'Remind']] };
const TENANT_WINS = [[ICON.grid, 'Every site, one screen', 'Green is OK. Red is late.'], [ICON.upload, 'They upload their own', 'No more chasing photocopies every January'],
  [ICON.list, 'You set the rules', 'Pick the permits every site must keep']];
const tenantChecks = (cap) => [cap, 'Tenants, franchisees or branches: every one\'s permits on one screen', 'You choose the permits every site must keep',
  'They upload their own permits, free. No more chasing paper', "Download any site's shared copies in one click",
  'Remind every late site in one click', 'Text message (SMS) reminders', PLUS_LINE, 'Download a list for audits and city hall', 'Everything in Free'];
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
    icon: ICON.building, name: 'Multi-Site', who: 'For landlords, franchisors and groups with up to 20 sites',
    promise: "Every site's permits, without chasing photocopies", per: 20, unit: 'site', kind: 'property',
    preview: TENANT_PREVIEW, wins: TENANT_WINS, checks: tenantChecks('Up to 20 sites'),
    why: { title: 'Made for owners of many sites', lines: ['Everything the Unlimited plan has, for up to 20 sites', 'Grow past 20? Move up anytime, nothing to set up again'] },
  },
  property: {
    icon: ICON.grid, name: 'Multi-Site Unlimited', who: 'For malls, franchise networks and big groups, any size',
    promise: "Every site's permits, without chasing photocopies", per: 100, unit: 'site', kind: 'property',
    preview: TENANT_PREVIEW, wins: TENANT_WINS, checks: tenantChecks('Any number of sites'),
    why: { title: 'Why it costs more', lines: ['It does the work of a full-time admin who chases permits (₱20,000+ a month)',
      'Made for big networks: 100 sites × 4 permits = 400 deadlines a year', 'One site closed for a missing fire permit costs you more than a year of this plan'] },
  },
};
export const PLAN_ORDER = ['property_s', 'property'];
// The plans this database sells (Multi-Site only once its file has run). Before the prices load: all.
export const plansShown = (plans) => (plans?.length ? PLAN_ORDER.filter((id) => plans.some((p) => p.id === id)) : PLAN_ORDER);

// ---------------------------------------------------------------- software plans by size (the November lineup)
// Every plan below is tracking and planning software only. Hands-on renewal work is a separate, separately priced
// service (see helpServices). Prices come from the plans table (Plus from prices.js); capacity from plan_limits.
export const SOFTWARE_ONLY = 'All plans below are for tracking and planning software only. They do not include someone physically handling your registration. Optional Renewal Assistance and Full-Service Vehicle Renewal are available for separate fees.';
export const TIERS = {
  plus: { icon: ICON.share, name: 'Plus', who: 'For a few businesses or vehicles', range: 'Up to 5 businesses and vehicles, any mix', users: '1 user', kind: 'business',
    checks: ['Up to 20 files for each business or vehicle', 'Reminders, timelines, checklists and your document vault', 'History of every change',
      'Your own permit page and QR poster', 'Ready letters and forms, filled in for you', 'Everything in Free'] },
  core: { icon: ICON.briefcase, name: 'Core', who: 'For households and small businesses', range: 'Up to 15 businesses and vehicles together', users: 'Up to 3 users (you + 2 staff)', kind: 'business',
    per: 15,
    checks: ['Group by business and branch', 'One dashboard, reminders and renewal tasks for everything', 'Text message reminders', 'Pinoy Permit Plus included', 'Everything in Plus'] },
  multi: { icon: ICON.car, name: 'Multi-Vehicle', who: 'For big households and small fleets', range: '16 to 30 vehicles', users: 'Up to 3 users', kind: 'fleet',
    per: 30,
    checks: ['Up to 20 files for each vehicle', 'Fleet board: who can’t drive today', 'Status and history for every vehicle', 'Includes up to 3 business records', 'Everything in Core'] },
  fleet: { icon: ICON.car, name: 'Fleet', who: 'For companies with many vehicles', range: '31 to 75 vehicles', users: 'Up to 5 users', kind: 'fleet',
    per: 75,
    checks: ['Filter by plate, status, expiry and business', 'Import vehicles from a spreadsheet', 'A renew-this-month list', 'Includes up to 3 business records', 'Everything in Multi-Vehicle'] },
  fleet_pro: { icon: ICON.car, name: 'Fleet Pro', who: 'For large fleets', range: '76 to 150 vehicles', users: 'Up to 10 users', kind: 'fleet',
    per: 150,
    checks: ['Fleet-wide renewal planning', 'Export for your records', 'Includes up to 3 business records', 'Everything in Fleet'] },
  enterprise: { icon: ICON.grid, name: 'Enterprise', who: 'For the biggest fleets', range: '151 or more vehicles', users: 'Users agreed in your quote', kind: 'fleet', quote: true,
    checks: ['A written plan and quote for your fleet', 'We show the cost per vehicle in your quote', 'Tracking and planning software, like every plan'] },
};
export const TIER_SMALL = ['plus', 'core'];
export const TIER_FLEET = ['multi', 'fleet', 'fleet_pro', 'enterprise'];
const two = (n) => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const perVehicle = (monthly, n) => (monthly > 0 && n ? two(Math.round((monthly / n) * 100) / 100) : '');
export const tierPrice = (plans, id) => (id === 'plus' ? PLUS_MONTHLY : Number(plans?.find((p) => p.id === id)?.price_php_monthly || 0));
// Plans the database sells now (Plus is an add-on, always there; Enterprise is quoted).
export const tiersShown = (plans, ids) => (plans?.length ? ids.filter((id) => id === 'plus' || id === 'enterprise' || plans.some((p) => p.id === id && p.available !== false)) : ids);

// "16 to 30 vehicles" → the number part big, the words small, so the size of the plan reads at a glance.
const bigLead = (txt) => { const m = /^((?:Up to )?\d+(?: to \d+| or more)?)\s+(.*)$/.exec(txt); return m ? html`<span><b>${m[1]}</b> ${m[2]}</span>` : html`<span>${txt}</span>`; };
export function tierCard(id, monthly, cta = '', { current = false } = {}) {
  const t = TIERS[id];
  if (!t) return '';
  return html`<section class="card pp-plan pp-tier ${current ? 'pp-current' : ''}" data-plan-card="${id}">
    <div class="pp-plan-head"><span class="pp-icon">${t.icon}</span><div><h3>${t.name}</h3><p class="pp-who">${t.who}</p></div></div>
    <div class="pp-range2">${bigLead(t.range)}${bigLead(t.users)}</div>
    ${t.quote ? html`<div class="pp-price"><div class="pp-amount"><b>Quoted</b></div><p class="pp-day">For your exact fleet size</p></div>`
      : monthly > 0 ? priceSlot(monthly) : html`<div class="pp-price"><p class="pp-day">Loading the price…</p></div>`}
    ${t.per && monthly > 0 ? perBox(perUp(monthly / t.per), 'vehicle') : ''}
    ${checks(t.checks)}
    <p class="pp-swonly">Tracking and planning software only. Hands-on help costs extra.</p>
    <div class="pp-cta">${cta}</div></section>`;
}

// Right above the plans: what a subscription is, and isn't.
export const softwareBanner = () => html`<div class="pp-swbanner" role="note"><b>SOFTWARE SUBSCRIPTIONS = TRACKING &amp; PLANNING ONLY.</b>
  <span>Hands-on renewal services are optional and cost extra.</span></div>`;

// Right below the monthly prices: the plan price divided by the vehicles it holds, with every assumption shown.
export function peaceBand(plans) {
  const rows = ['core', 'multi', 'fleet', 'fleet_pro'].map((id) => ({ id, m: tierPrice(plans, id), n: TIERS[id].per })).filter((r) => r.m > 0 && plans?.some((p) => p.id === r.id && p.available !== false));
  if (!rows.length) return '';
  const low = rows.reduce((a, b) => (a.m / a.n <= b.m / b.n ? a : b));
  const foot = rows.map((r) => (r.id === 'core' ? `Core ${perVehicle(r.m, r.n)}/vehicle at 15 vehicles only when all 15 records are vehicles`
    : `${TIERS[r.id].name} ${perVehicle(r.m, r.n)}/vehicle at ${r.n} vehicles`)).join('; ');
  return html`<section class="pp-peace" aria-labelledby="peace-h">
    <div class="pp-peace-copy"><h3 id="peace-h">A little peace of mind, for less than you might think.</h3>
      <p>Keep registration dates, documents, requirements and renewal tasks organized in one place, so you can plan ahead instead of scrambling at the last minute.</p></div>
    <div class="pp-peace-num"><span>As low as</span><b>${perUp(low.m / low.n).replace(/^under /, '')}*</b><small>per vehicle / month</small>
      <em>${TIERS[low.id].name}: ${peso(low.m)} a month for up to ${low.n} vehicles</em></div>
    <p class="pp-peace-note">That is the subscription equivalent when you use the plan's full vehicle capacity. Your plan is billed at the monthly plan price, not as a separate per-car charge.
      <br>*Illustrative effective monthly cost at maximum vehicle capacity: ${foot}. Actual cost per vehicle is higher if fewer vehicles are tracked. Core allows a mix of vehicle and business records, so its per-vehicle figure does not apply when some records are businesses. Enterprise pricing is quoted individually.
      ${SOFTWARE_ONLY}</p>
  </section>`;
}

// "Need us to handle the renewal?": the separately paid services, each with exactly what it is and isn't.
export const ASSIST_FULL = "Renewal Assistance — ₱499 one-time per vehicle, per renewal case. Get a clear, personalized plan before you spend time or money on a renewal. We review the documents and vehicle details you submit, compare them with the requirements we can verify for your transaction, prepare a tailored checklist, flag missing, unclear, inconsistent, or potentially expired items, explain which documents may need an original, photocopy, certified copy, or issuer-sent electronic record, and provide a written summary of what is ready, what is missing, and what you should do next. The price includes one consolidated round of follow-up questions about our review. This is a defined document-review and guidance service: we do not contact or visit the LTO on your behalf, submit or collect documents, book or perform inspections, arrange courier, or manage the renewal process under this service. It does not include government or third-party costs and does not guarantee agency approval. If you want Pinoy Permit to coordinate the process for you, choose Full-Service Vehicle Renewal instead.";
export const FULL_SERVICE_FULL = "Full-Service Vehicle Renewal — from ₱1,000 Pinoy Permit coordination fee per eligible standard renewal, per vehicle. Prefer not to coordinate the process yourself? After confirming eligibility and coverage, we manage the renewal workflow within a written scope: intake and transaction triage; a tailored checklist and document-gap follow-up; coordination of required insurance or inspection with you and verified providers where applicable; preparation of the case file; arranging authorized submission, agency follow-up, and document/permit pickup where legally permitted and available; status updates at meaningful milestones; and a close-out summary with available receipt/renewal evidence and the next recorded expiry date. Before you pay, you receive a written scope, task owner, itemized quote, exclusions, and any steps you must personally complete. The ₱1,000 is a starting coordination fee, not the total cost of every renewal. LTO/government charges, insurance, inspection/emissions, courier, and third-party/provider fees are separate and itemized. You may still need to sign declarations, present originals, attend in person, or bring the vehicle for inspection. We offer this service only when the case is eligible and verified service coverage is available; otherwise we will explain the limitation or provide a custom quote. Approval and processing times are controlled by the relevant agency and cannot be guaranteed.";
export const COMPLEX_FULL = "Complex / Special Registration Case — custom quote after review. For cases that need additional research, approvals, or a non-standard process—such as new registration, ownership transfer, lost plates/documents, reactivation, for-hire or other special vehicle categories, and record corrections—we first assess the transaction, verify applicable requirements, identify what the owner must personally do, and check whether a suitable verified provider can lawfully support it. Before any paid work starts, you receive a written case-specific scope, milestones, service fee, exclusions, and separate estimates or confirmed amounts for government and third-party costs. We do not price complex work as if it were a routine renewal, and we do not promise approval or bypass official requirements.";
export const CHOOSE_HELP = 'Choose what kind of help you need: Software plan = track vehicles/businesses, documents, deadlines, and renewal tasks yourself. ₱499 Renewal Assistance = a human review of your submitted documents plus a personalized written checklist and next-step plan; no agency handling. Full-Service Vehicle Renewal from ₱1,000 = we coordinate an eligible standard renewal within a written scope, including authorized filing/follow-up/pickup where permitted and available. Complex registration = custom quote after review. Software plans and all service fees are separate from government charges, insurance, inspection, courier, and third-party/provider fees.';
export function helpServices({ assistCta = '', complexCta = '' } = {}) {
  const card = (cls, tag, name, price, lines, full, cta) => html`<section class="card pp-help ${cls}">
    <span class="pp-help-tag">${tag}</span><h3>${name}</h3><p class="pp-help-price">${price}</p>
    ${checks(lines)}
    <details class="pp-all"><summary><span>Exactly what's included</span></summary><p class="small">${full}</p></details>
    <div class="pp-cta">${cta}</div></section>`;
  return html`<section class="pp-helpwrap" aria-labelledby="help-h">
    <h2 class="lp-h3" id="help-h">Need us to handle the renewal?</h2>
    <p class="pp-help-lead">${CHOOSE_HELP}</p>
    <div class="pp-grid three">
      ${card('', 'Available now', 'Renewal Assistance', '₱499 one-time', ['A human review of the papers you send', 'A tailored checklist and a written plan: ready, missing, next steps', 'Which papers need an original, a copy or an issuer-sent record', 'Guidance only: no agency visits or filing'], ASSIST_FULL, assistCta)}
      ${card('pp-help-soon', 'Coming soon', 'Full-Service Vehicle Renewal', 'From ₱1,000 coordination fee', ['We coordinate an eligible standard renewal within a written scope', 'Itemized quote before you pay; government and third-party costs separate', "We're building a team of trusted, verified runners so we can offer this soon"], FULL_SERVICE_FULL,
        html`<p class="pp-soon-note">Not available yet. We'll tell you when it opens.</p>`)}
      ${card('', 'Custom quote', 'Complex / special case', 'Quoted after review', ['New registration, transfer, lost plates or papers, reactivation, special categories', 'A written scope and quote before any paid work starts'], COMPLEX_FULL, complexCta)}
    </div>
    <p class="pp-paynote">We accept GCash or bank transfer to our UnionBank account for Pinoy Permit fees only. Government and third-party charges are always shown as separate line items, and approval is always up to the agency.</p>
  </section>`;
}
// The short version, for Home, each vehicle and Done for you.
export const serviceStrip = () => html`<p class="pp-strip-help">${ICON.check}<span><b>Your plan is tracking and planning software.</b> Want hands-on help? Renewal Assistance ₱499 one-time ·
  Full-Service Vehicle Renewal from ₱1,000 (coming soon) · Complex cases: custom quote. <a href="#/settings/billing">See what each includes</a></span></p>`;

// ---------------------------------------------------------------- cards
const LABEL = { ok: 'OK', soon: 'Soon', late: 'Late' };
// A small picture of the board the plan gives you (example data).
const preview = (pv) => html`<div class="pp-preview" role="img" aria-label="Example: ${pv.title.toLowerCase()} and their status">
  <div class="pv-head"><b>${pv.title}</b><span class="pv-dots" aria-hidden="true"><i></i><i></i><i></i></span></div>
  ${pv.rows.map(([name, st, txt, btn]) => html`<div class="pv-row" aria-hidden="true"><span class="pv-name">${name}</span>
    <span class="pv-pill pv-${st}" title="${LABEL[st]}">${txt}</span>${btn ? html`<span class="pv-btn">${btn}</span>` : ''}</div>`)}</div>`;
const wins = (list) => html`<ul class="pp-wins">${list.map(([ic, t, d]) => html`<li><span class="pw-icon">${ic}</span><span><b>${t}</b><small>${d}</small></span></li>`)}</ul>`;
const everything = (list) => html`<details class="pp-all"><summary><span>Everything included</span> <b>${list.length}</b></summary>${checks(list)}</details>`;

export function freeCard(cta = '') {
  return html`<section class="card pp-plan pp-free">
    <div class="pp-free-a">
      <div class="pp-plan-head"><span class="pp-icon">${ICON.home}</span><div><h3>Free</h3><p class="pp-who">For one business and one vehicle</p></div></div>
      <p class="pp-promise">Never miss a permit again</p>
      <p class="pp-range">1 business + 1 vehicle · 1 user</p>
      <div class="pp-price"><div class="pp-amount"><b>₱0</b><span>forever</span></div><p class="pp-day">No card. No time limit.</p></div>
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
    ${monthly > 0 ? priceSlot(monthly, { per: p.per, unit: p.unit }) : html`<div class="pp-price"><p class="pp-day">Loading the price…</p></div>`}
    ${wins(p.wins)}${everything(p.checks)}
    <div class="pp-cta">${cta}${trialLine ? html`<p class="pp-trial">30 days free · no card needed</p>` : ''}</div></section>`;
}

// Everything side by side (a tick, a dash, or a few words): the software plans by size.
const Y = true; const N = false;
const COMPARE = [
  ['Businesses and vehicles you can track', '1 + 1', 'Up to 5', 'Up to 15', '16–30 vehicles', '31–75 vehicles', '76–150 vehicles'],
  ['Users (owner included)', '1', '1', '3', '3', '5', '10'],
  ['Files for each business or vehicle', '3', '20', '20', '20', '20', '20'],
  ['Reminders 30, 7 and 1 day before (email and app)', Y, Y, Y, Y, Y, Y],
  ['Status board and renewal timeline', Y, Y, Y, Y, Y, Y],
  ['Checklists with official source links', Y, Y, Y, Y, Y, Y],
  ['Snap a photo, we read the dates', Y, Y, Y, Y, Y, Y],
  ['Permit page, QR poster and ready letters (Plus)', N, Y, Y, Y, Y, Y],
  ['Text message (SMS) reminders', N, N, Y, Y, Y, Y],
  ['Fleet board and spreadsheet import', N, N, N, Y, Y, Y],
  ['Business records included', '1', 'Any mix', 'Any mix', 'Up to 3', 'Up to 3', 'Up to 3'],
  ['Someone handling your renewal', 'Separate service', 'Separate service', 'Separate service', 'Separate service', 'Separate service', 'Separate service'],
];
const cellOf = (c) => (c === true ? html`<span class="pp-yes">${ICON.check}<span class="sr-only">Included</span></span>`
  : c === false ? html`<span class="pp-no"><span aria-hidden="true">–</span><span class="sr-only">Not included</span></span>` : html`<span class="pp-word">${c}</span>`);
const COLS = ['Free', 'Plus', 'Core', 'Multi-Vehicle', 'Fleet', 'Fleet Pro'];
export const compareTable = () => html`<details class="card pp-compare"><summary><b>See everything side by side</b></summary>
  <div class="table-wrap" tabindex="0" role="region" aria-label="Plans side by side"><table class="table pp-table">
    <thead><tr><th scope="col">What you get</th>${COLS.map((c) => html`<th scope="col">${c}</th>`)}</tr></thead>
    <tbody>${COMPARE.map(([t, ...cols]) => html`<tr><th scope="row">${t}</th>${cols.map((c) => html`<td>${cellOf(c)}</td>`)}</tr>`)}</tbody>
  </table></div><p class="fineprint">Every plan is tracking and planning software only. Multi-Site and Multi-Site Unlimited are priced by sites; Enterprise is quoted.</p></details>`;

// ---------------------------------------------------------------- add-ons
export const PLUS_CHECKS = [
  'Track up to 5 businesses and vehicles, any mix (Free: 1 + 1)',
  'Up to 20 files for each business or vehicle',
  "Your own permit page and a QR poster: customers see you're legit",
  'Badges for your website and email signature',
  'Your mall or landlord gets each renewal by itself',
  "We check your permits every morning and tell you what's wrong",
  'A report in your inbox on the 1st of every month',
  '8 ready letters and forms, filled in for you (authorization letter, SPA, affidavit of loss…)',
  'Included in Core and every fleet plan',
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
