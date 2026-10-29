// What a visitor sees before signing in. The home page runs top to bottom: the promise with two buttons, three numbers,
// six things it tracks, the core pitch with four tiles, proof numbers, how it works in three steps, four benefits,
// the free plan as a boarding pass, guides and help, the last nudge and the footer.
// Prices have their own page (#/pricing): the free plan, the team plans (prices read live from the plans
// table) and add-ons, monthly or yearly (2 months free). Anything whose database part isn't switched on
// yet stays off both pages.
import { clearTheme } from '../theme.js';
import { html, raw, peso } from '../util.js';
import { ICON } from '../components.js';
import { has } from '../core.js';
import { PLUS_MONTHLY, BRAND_MONTHLY } from '../prices.js';
import { billToggle, freeCard, planCard, plansShown, compareTable, paintPrices, addonCard, checks, PLUS_CHECKS, BRAND_CHECKS, STAFF_CHECKS, staffTracks, staffLadder, staffExamples,
  tierCard, tierPrice, tiersShown, TIER_SMALL, TIER_FLEET, softwareBanner, peaceBand, helpServices, SOFTWARE_ONLY } from './pricing.js';
import { passHeader, passPerks, passList } from './load.js';
import * as db from 'pp/data';

// A few pictures the app itself doesn't need.
const PIC = {
  bag: raw('<svg viewBox="0 0 24 24"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/></svg>'),
  truck: raw('<svg viewBox="0 0 24 24"><rect x="1" y="3" width="15" height="13"/><path d="M16 8h4l3 3v5h-7z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>'),
  team: raw('<svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>'),
  lock: raw('<svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>'),
  pin: raw('<svg viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>'),
  todo: raw('<svg viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>'),
  pen: raw('<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>'),
  back: raw('<svg viewBox="0 0 24 24"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>'),
  next: raw('<svg viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>'),
};
// One color per kind of thing: blue business, teal vehicles, green staff, lilac taxes (brown is the team step).
const PLAY = raw('<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M10 8.5v7l6-3.5z" fill="currentColor" stroke="none"/></svg>');
const pill = (st, t) => html`<span class="pv-pill pv-${st}">${t}</span>`;
const tick = html`<span class="lp-done">${ICON.check}</span>`;

const header = (onHome) => html`<header class="lp-top"><a class="brand" href="#/"><img class="brand-wm" src="img/wordmark.png" alt="Pinoy Permit"></a>
  <div class="spacer"></div>
  ${onHome ? html`<a class="btn btn-ghost btn-sm lp-nav" href="#for-you" data-scroll-to="for-you">What it tracks</a><a class="btn btn-ghost btn-sm lp-nav" href="#tour" data-scroll-to="tour">How it works</a>`
    : html`<a class="btn btn-ghost btn-sm lp-nav" href="#/">How it works</a>`}
  <a class="btn btn-ghost btn-sm lp-nav" href="#/pricing" ${onHome ? '' : raw('aria-current="page"')}>Prices</a><a class="btn btn-ghost btn-sm" href="#/login">Sign in</a><a class="btn btn-primary btn-sm" href="#/signup">Start free</a></header>`;
const footer = () => html`<footer class="lp-foot lp-foot2"><div class="lp-foot-in">
  <div class="lp-foot-brand"><img class="brand-wm" src="img/wordmark.png" alt="Pinoy Permit"><p>Permits on autopilot. Reminders, checklists and proof for the permits you already have.</p></div>
  <nav aria-label="Product"><h3>Product</h3><a href="#/pricing">Prices</a><a href="demo/">Try the demo</a><a href="#/signup">Start free</a><a href="#/login">Sign in</a></nav>
  <nav aria-label="Help"><h3>Help</h3><a href="renew/">Renewal guides</a><a href="#/contact">Contact</a>${has('revenue') ? html`<a href="#/list-your-firm">For service providers</a>` : ''}</nav>
  <nav aria-label="Policies"><h3>Policies</h3><a href="privacy.html">Privacy</a><a href="terms.html">Terms</a></nav>
  </div>
  <p class="lp-foot-fine">Pinoy Permit is tracking and planning software. It isn't a government office and doesn't file new business registrations. Government and third-party fees are always separate.</p>
  <p class="lp-foot-c">© Pinoy Permit</p></footer>`;
// In-page links scroll; they must not change the address (the app's pages live there).
const wireScroll = (app) => app.querySelectorAll('[data-scroll-to]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); document.getElementById(a.dataset.scrollTo)?.scrollIntoView({ behavior: 'smooth' }); }));

// Small app screens (example data), shown in "How it works".
const QR = raw('<svg viewBox="0 0 21 21" class="lp-qr"><path fill-rule="evenodd" d="M0 0h7v7H0zM2 2v3h3V2zM14 0h7v7h-7zm2 2v3h3V2zM0 14h7v7H0zm2 2v3h3v-3zM9 0h2v2H9zm2 2h2v3h-2zM9 6h2v3H9zm-1 3h3v2H8zm5 0h2v3h-2zm3 1h3v2h-3zm-7 4h2v2H9zm4 0h3v2h-3zm5 0h3v3h-3zm-7 4h3v3h-3zm4 1h2v2h-2zm3 0h3v2h-3z"/></svg>');
// What the phone shows at each step (example data).
const SCREENS = [
  () => html`<div class="lp-scr" role="img" aria-label="Add a permit: type it in, import a spreadsheet, fill from a photo${has('services') ? ', or let us set it up' : ''}">
    <b class="lp-scr-h">Add a permit</b>
    <div class="lp-opt lp-opt-on"><span class="lp-sq lp-sq-sm t-blue">${PIC.pen}</span><b>Type it in</b></div>
    <div class="lp-opt"><span class="lp-sq lp-sq-sm t-blue">${ICON.upload}</span><b>Import a spreadsheet</b></div>
    <div class="lp-opt"><span class="lp-sq lp-sq-sm t-blue">${ICON.camera}</span><b>Fill from a photo</b><small>optional</small></div>
    ${has('services') ? html`<div class="lp-opt"><span class="lp-sq lp-sq-sm t-blue">${PIC.team}</span><b>Let us set it up</b></div>` : ''}
    <div class="lp-saved"><b>Mayor's Permit saved</b>Expires Dec 31. We'll remind you.</div></div>`,
  () => html`<div class="lp-scr" role="img" aria-label="Reminders 30 days, 7 days and 1 day before the Mayor's Permit is due">
    <div class="lp-clock"><b>7:00</b>Monday</div>
    <div class="lp-msg"><b>Pinoy Permit</b>Mayor's Permit is due in <b>30 days</b>.${has('library2') ? " Here's the checklist." : ''}</div>
    <div class="lp-msg"><b>Pinoy Permit</b>Still to do: Mayor's Permit, due in <b>7 days</b>.</div>
    <div class="lp-msg"><b>Pinoy Permit</b>Mayor's Permit is due <b>tomorrow</b>.</div>
    <div class="lp-msg lp-msg-sum"><b>Your Monday summary</b>2 things this week. The rest is current.</div></div>`,
  () => (has('library2') ? html`<div class="lp-scr" role="img" aria-label="How to renew the Mayor's Permit, step by step: do this first, get the papers ready, where to file, how to pay">
    <b class="lp-scr-h">How to renew: step by step</b>
    ${[['Do this first', 'Barangay clearance ✓'], ['Get these papers ready', '3 of 5 ready'], ['Where to file', "City hall's BPLO, or online"], ['How to pay', 'Cashier or online. Keep the receipt.']]
      .map(([t, d], i) => html`<div class="lp-guide"><span class="lp-guide-n ${i ? '' : 'first'}">${i + 1}</span><span><b>${t}</b><small>${d}</small></span></div>`)}
    <div class="lp-fake-btn">Need help? We can do it online</div></div>`
    : html`<div class="lp-scr" role="img" aria-label="The Mayor's Permit, renewed, with next year's date set">
    <b class="lp-scr-h">Mayor's Permit</b>
    <div class="lp-ck">${tick}Renewal recorded</div><div class="lp-ck">${tick}Receipt saved</div>
    <div class="lp-saved"><b>Next renewal set</b>We'll remind you again before it's due.</div></div>`),
  () => html`<div class="lp-scr" role="img" aria-label="A proof page showing three current permits${has('plus') ? ' and a QR code' : ''}">
    <div class="lp-scr-c"><b class="lp-scr-h">Sadie's Kitchen</b>${pill('ok', 'All permits current')}</div>
    ${["Mayor's Permit", 'Fire safety (FSIC)', 'Sanitary permit'].map((t) => html`<div class="lp-ck lp-ck-sp"><b>${t}</b><span class="lp-cur">Current</span></div>`)}
    <div class="lp-qrbox">${has('plus') ? html`${QR}<span><b>Scan to check</b>Print it, stick it by the counter</span>` : html`<span><b>Read-only link</b>Send it to anyone. Turn it off anytime.</span>`}</div></div>`,
  () => (has('plus') ? html`<div class="lp-scr" role="img" aria-label="Ana sent her new health card for approval; Ben is cleared; Carlo's driver's license is 3 days late">
    <b class="lp-scr-h">Your team</b>
    <div class="lp-approve"><b>Ana sent her new health card</b><div class="lp-photo">Photo of health card</div><div class="lp-fake-btn">Approve</div></div>
    <div class="lp-mini"><b>Ben · NBI clearance</b>${pill('ok', 'Cleared')}</div>
    <div class="lp-mini"><b>Carlo · Driver's license</b>${pill('late', '3 days late')}</div></div>`
    : html`<div class="lp-scr" role="img" aria-label="Permits handed to teammates: Ana has the Mayor's Permit and the sanitary permit, Ben has fire safety">
    <b class="lp-scr-h">Your team</b>
    <div class="lp-mini"><b>Mayor's Permit · Ana</b>${pill('soon', 'Due in 12 days')}</div>
    <div class="lp-mini"><b>Fire safety · Ben</b>${pill('ok', 'All good')}</div>
    <div class="lp-mini"><b>Sanitary permit · Ana</b>${pill('ok', 'All good')}</div>
    <div class="lp-msg lp-msg-sum"><b>Invite your team</b>Everyone sees the same list.</div></div>`),
];

// ---------------------------------------------------------------- 1. hero: the promise, two buttons, the app on a phone (example data)
// The arches behind the phone echo a doorway: walk in calm, walk out renewed.
const ARCH = raw(`<svg class="lp-arch" viewBox="0 0 600 420" aria-hidden="true" preserveAspectRatio="xMidYMax meet"><defs><linearGradient id="lp-arch-g" x1="0" x2="1"><stop offset="0" stop-color="#E9B949"/><stop offset="1" stop-color="#1B4DB5"/></linearGradient></defs>
  <path d="M60 420V300a240 240 0 0 1 480 0v120" fill="none" stroke="url(#lp-arch-g)" stroke-width="3"/>
  <path d="M120 420V300a180 180 0 0 1 360 0v120" fill="none" stroke="#C9D5EE" stroke-width="2"/>
  <path d="M180 420V300a120 120 0 0 1 240 0v120" fill="none" stroke="#DCE3F0" stroke-width="2"/></svg>`);
const hero = () => html`<section class="lp-hero2">
  <div class="lp-hero2-copy">
    <p class="lp-tag">Permits on autopilot</p>
    <h1>Stay on top of every permit. <span class="lp-blue">Easily.</span></h1>
    <p class="lp-lead">Every expiry date, reminder and renewal step for the permits you already have. All in one place.</p>
    <div class="btn-row"><a class="btn btn-primary btn-lg lp-pill-btn" href="#/signup">Start free${PIC.next}</a><a class="btn btn-lg lp-btn-demo lp-pill-btn" href="demo/">${PLAY}Try the demo</a></div>
    <p class="lp-demo-note">No sign-up needed for the demo. Click around with sample data.</p>
    <p class="lp-scope">Made for businesses that are already registered. Pinoy Permit tracks and guides; it doesn't file new business registrations.</p>
  </div>
  <div class="lp-hero2-art">
    ${ARCH}
    <div class="lp-phone" role="img" aria-label="Pinoy Permit on a phone: 1 overdue, 2 to renew soon, 9 compliant, with what is due next">
      <div class="lp-screen lp-screen-app" aria-hidden="true"><div class="lp-notch"></div>
        <div class="lp-app-band"><small>THURSDAY, OCTOBER 29</small><b>Good morning, Sadie</b><span class="lp-app-alert"><i class="r"></i>1 permit is past due</span></div>
        <div class="lp-app-tiles">${[['r', 'Overdue', 1], ['y', 'Renew soon', 2], ['g', 'Compliant', 9]].map(([c, t, n]) => html`<div class="lp-app-tile"><span><i class="${c}"></i>${t}</span><b>${n}</b></div>`)}</div>
        <div class="lp-caps">UP NEXT</div>
        ${[['OCT', 24, 'r', "Mayor's Permit", 'Sadie\'s Kitchen', 'renew'], ...(has('filings') ? [['NOV', 3, 'y', 'BIR 2551Q', 'Taxes · Quarterly', 'Due in 5 days']] : []), ['NOV', 10, 'y', 'Health card', 'Staff · Ana Cruz', 'Due in 12 days'], ['NOV', 18, 'y', 'CTPL insurance', 'Vehicle · ABC 1234', 'Due in 20 days'], ['MAY', 16, 'g', 'Fire safety (FSIC)', 'All papers on file', 'ok']]
          .map(([m, d, c, n, sub, act]) => html`<div class="lp-app-row"><span class="lp-app-date ${c}"><small>${m}</small><b>${d}</b></span><span class="lp-app-t"><b>${n}</b><small>${sub}</small></span>
            ${act === 'renew' ? html`<span class="lp-app-renew">Renew</span>` : act === 'ok' ? pill('ok', 'All good') : pill('soon', act)}</div>`)}
      </div>
    </div>
    <div class="lp-float lp-f1" aria-hidden="true"><span class="lp-fi t-solid-blue">${ICON.bell}</span><span><b>Mayor's Permit</b>Due in 30 days.${has('library2') ? " Here's what to bring." : ''}</span></div>
    <div class="lp-float lp-f2" aria-hidden="true"><span class="lp-fi t-solid-green">${ICON.check}</span><span><b>FSIC renewed</b>${has('vault') ? 'Saved and encrypted' : 'Saved to your files'}</span></div>
  </div>
</section>`;

// ---------------------------------------------------------------- 2. three big numbers (only ones that are true today)
const stats = () => html`<section class="lp-stats" aria-label="Pinoy Permit in numbers"><div class="lp-wrap lp-stats-in">
  <h2>Para sa negosyo mo, big or small.</h2>
  ${[['20+', 'Permit and license types'], ['16', 'Cities with free renewal guides'], ['1', 'List for permits, vehicles, and staff']].map(([n, l]) => html`<div class="lp-stat"><b>${n}</b><span>${l}</span></div>`)}
</div></section>`;

// ---------------------------------------------------------------- 3. what it tracks: six cards, each with a picture (drawn here, so it stays sharp)
const SEAL = raw('<svg viewBox="0 0 40 40" class="lp-seal" aria-hidden="true"><circle cx="20" cy="20" r="18" fill="#E9B949"/><circle cx="20" cy="20" r="13" fill="none" stroke="#fff" stroke-width="1.6" stroke-dasharray="2 2.4"/><path d="M14 20.5l4 4 8-9" fill="none" stroke="#0B1B3A" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>');
const FLAME = raw('<svg viewBox="0 0 24 24" class="lp-flame" aria-hidden="true"><path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-3 2-4 2-7 2 1 3 3 3 5 1-1 1-3 0-9z" fill="#E5484D"/></svg>');
const doc = (kick, title, name, foot, badge) => html`<div class="lp-doc"><span class="lp-doc-k">${kick}</span><b class="lp-doc-t">${title}</b><span class="lp-doc-n">${name}</span>
  <i class="lp-doc-l"></i><i class="lp-doc-l s"></i><span class="lp-doc-f">${foot}</span>${badge}</div>`;
const OFFERS = () => [
  ['Business permits', 'blue', 'A business permit valid until December 31, due in 30 days', html`${doc('CITY OF PASIG', "Mayor's Permit", "Sadie's Kitchen", 'Valid until Dec 31', SEAL)}${pill('soon', 'Due in 30 days')}`],
  ['Fire safety', 'red', 'A fire safety certificate, all good', html`${doc('FIRE SAFETY', 'Inspection certificate', 'Main store', 'Valid until May 16', FLAME)}${pill('ok', 'All good')}`],
  ['Vehicles', 'teal', 'A vehicle registration card for plate ABC 1234, due in 20 days', html`<div class="lp-orcr"><span class="lp-doc-k">REGISTRATION · OR/CR</span><b class="lp-doc-t">Isuzu Elf</b>
    <span class="lp-plate">ABC 1234</span><span class="lp-orcr-car">${PIC.truck}</span></div>${pill('soon', 'Due in 20 days')}`],
  ["Staff licenses", 'green', "A staff member's health card, all good", html`<div class="lp-idc"><span class="lp-idc-face"></span><span><span class="lp-doc-k">HEALTH CARD</span><b class="lp-doc-t">Ana Cruz</b><span class="lp-doc-n">Kitchen staff</span>
    <i class="lp-doc-l s"></i></span></div>${pill('ok', 'All good')}`],
  has('filings')
    ? ['Tax and contribution dates', 'lilac', 'A calendar page: BIR 2551Q due October 25', html`<div class="lp-cal"><span class="lp-cal-m">OCTOBER</span><b>25</b><span class="lp-doc-n">BIR 2551Q</span></div>${pill('soon', 'Due in 5 days')}`]
    : ['Health and sanitary permits', 'lilac', 'A sanitary permit, all good', html`${doc('CITY HEALTH OFFICE', 'Sanitary permit', "Sadie's Kitchen", 'Valid until Jul 31', SEAL)}${pill('ok', 'All good')}`],
  ['Proof in one link', 'gold', 'A phone showing all permits current, with a QR code', html`<div class="lp-mphone"><b>Sadie's Kitchen</b>${pill('ok', 'All permits current')}
    ${["Mayor's Permit", 'Fire safety', 'Sanitary permit'].map((t) => html`<span class="lp-mphone-r">${t}<i>Current</i></span>`)}${QR}</div>`],
];
const offers = () => html`<section id="for-you" class="lp-sec" aria-labelledby="offer-h">
  <h2 class="lp-big lp-center" id="offer-h">Everything you renew, in one place.</h2>
  <p class="lp-lead lp-center lp-mx">Business, vehicles, staff and more. Each with its date, papers and next step.</p>
  <div class="lp-offers">${OFFERS().map(([t, tint, label, art]) => html`<article class="lp-offer"><div class="lp-offer-art lp-art-${tint}" role="img" aria-label="${label}"><div aria-hidden="true" class="lp-offer-in">${art}</div></div><h3>${t}</h3></article>`)}</div>
</section>`;

// ---------------------------------------------------------------- 4. the core pitch, with four feature tiles
const TILES = () => [
  [ICON.upload, 'Quick setup', html`<b>Type it in, import a spreadsheet,</b> or fill it from a photo${has('services') ? ', or let us set it up' : ''}.`],
  [PIC.bag, 'Pay your way', html`<b>GCash, Maya or bank transfer.</b> No card needed, and the free plan costs nothing.`],
  [ICON.bell, 'Reminders that stick', html`<b>30, 7 and 1 day before,</b> then every week until it's done.`],
  [ICON.check, 'Done the right way', html`<b>Checklists from each city's own rules,</b> with where we got them.`],
];
const pitch = () => html`<section class="lp-sec lp-pitch" aria-labelledby="pitch-h">
  <div class="lp-pitch-copy"><h2 class="lp-big" id="pitch-h"><span class="lp-line">We do the remembering.</span><span class="lp-line lp-blue">You run the business.</span></h2>
    <p class="lp-lead">Pinoy Permit keeps every date, paper and renewal step for the permits you already have. You get a nudge before anything is due, and you stay in charge.</p>
    <a class="btn btn-ghost btn-lg lp-btn-white lp-pill-btn" href="#tour" data-scroll-to="tour">See how it works${PIC.next}</a></div>
  <div class="lp-tiles">${TILES().map(([ic, t, d]) => html`<div class="lp-tile"><span class="lp-tile-ic">${ic}</span><h3>${t}</h3><p>${d}</p></div>`)}</div>
</section>`;

// ---------------------------------------------------------------- 5. proof in numbers
const proof = () => html`<section class="lp-proof" aria-label="What you get"><div class="lp-wrap lp-proof-in">
  ${[['₱0', 'to start, no card'], ['3', 'reminders before every deadline'], ['1', "link to show you're current"], ['0', 'apps to install']].map(([n, l]) => html`<div><b>${n}</b><span>${l}</span></div>`)}
</div></section>`;

// ---------------------------------------------------------------- 6. how it works, in three steps (each with the screen you'd see)
const STEPS3 = () => [
  ['Sign up free', 'No card and no contract. Your free plan is ready in a minute.'],
  ['Add your permits', `Pick each permit from the list and add its date. Or import a spreadsheet${has('services') ? ', or let us set it up' : ''}.`],
  [has('library2') ? 'Get reminded, then renew' : 'Get reminded, then renew', has('library2') ? 'Reminders before every deadline, with a checklist of what to bring.' : 'Reminders before every deadline. Record the renewal and the next date is set.'],
];
const howItWorks = () => html`<section id="tour" class="lp-sec lp-how" aria-labelledby="tour-h">
  <p class="lp-kick lp-kick-blue">HOW IT WORKS</p>
  <h2 class="lp-big lp-center" id="tour-h">Set up once. Get reminded every time.</h2>
  <ol class="lp-steps3">${STEPS3().map(([t, d], i) => html`<li class="lp-step3"><span class="lp-step3-n">${i + 1}</span><h3>${t}</h3><p>${d}</p>
    <div class="lp-step3-scr">${i === 0 ? html`<div class="lp-scr" role="img" aria-label="Your free plan is ready: 1 business and 1 vehicle">
      <b class="lp-scr-h">Welcome, Sadie</b><div class="lp-saved"><b>Free plan is ready</b>1 business + 1 vehicle</div>
      <div class="lp-ck">${tick}No card needed</div><div class="lp-ck">${tick}Invite your team anytime</div></div>` : SCREENS[i - 1]()}</div></li>`)}</ol>
  <div class="btn-row lp-center-row"><a class="btn btn-primary btn-lg lp-pill-btn" href="#/signup">Start free${PIC.next}</a><a class="btn btn-ghost btn-lg lp-btn-white lp-pill-btn" href="demo/">Try the demo</a></div>
</section>`;

// ---------------------------------------------------------------- 7. four benefits, next to the one list
const benefits = () => {
  const rows = [['OCT', 26, 'r', 'Health card', 'Staff · Ana Cruz', 'late', '3 days late'], ...(has('filings') ? [['NOV', 3, 'y', 'BIR 2551Q', 'Taxes · Quarterly', 'soon', 'Due in 5 days']] : []),
    ['NOV', 10, 'y', 'Sanitary permit', 'Business · Main store', 'soon', 'Due in 12 days'], ['NOV', 18, 'y', 'CTPL insurance', 'Vehicle · ABC 1234', 'soon', 'Due in 20 days'],
    ['MAY', 16, 'g', 'Fire safety (FSIC)', 'Business · Main store', 'ok', 'All good']];
  const lines = ['Every deadline in one list, most urgent first', has('library2') ? 'Know what to bring before you queue' : 'Every permit and receipt kept for years',
    "Show landlords and banks you're current, with one link", 'Your whole team sees the same list'];
  return html`<section class="lp-sec lp-split lp-benefits" aria-labelledby="for-you-h">
    <div class="lp-benefits-copy">
      <h2 class="lp-big" id="for-you-h"><span class="lp-line">Every permit, vehicle, and license.</span><span class="lp-line lp-blue">One screen.</span></h2>
      <ul class="lp-checks">${lines.map((t) => html`<li>${tick}${t}</li>`)}</ul>
      <a class="btn btn-primary btn-lg lp-pill-btn" href="#/signup">Start free${PIC.next}</a>
    </div>
    <div class="lp-split-art">
      <div class="lp-board" role="img" aria-label="One list mixing business permits, vehicles, staff licenses${has('filings') ? ' and tax dates' : ''}, most urgent first">
        <div class="lp-board-head" aria-hidden="true"><b>Next actions</b><small>Most urgent first</small></div>
        ${rows.map(([m, d, c, n, sub, st, txt]) => html`<div class="lp-row" aria-hidden="true"><span class="lp-app-date ${c}"><small>${m}</small><b>${d}</b></span><span class="lp-row-t"><b>${n}</b><small>${sub}</small></span>
          ${pill(st, txt)}${st === 'ok' ? '' : html`<span class="lp-app-renew">Renew</span>`}</div>`)}
      </div>
      <p class="lp-note">Looking after permits for clients, tenants or a fleet? <a href="#/pricing">See team plans.</a></p>
    </div>
  </section>`;
};

// ---------------------------------------------------------------- the free plan, as a boarding pass
// It must never read as "everything is free": the pass says Free plan everywhere, and the note under it says what's paid.
const STAMP = raw(`<svg viewBox="0 0 160 160" class="lp-bp-stamp" role="img" aria-label="Certified stress-free"><defs><path id="lp-stamp-c" d="M80 80m-58 0a58 58 0 1 1 116 0a58 58 0 1 1-116 0"/></defs>
  <circle cx="80" cy="80" r="76" fill="#E9B949"/><circle cx="80" cy="80" r="70" fill="none" stroke="#0B1B3A" stroke-width="1.5" stroke-dasharray="3 3"/>
  <text font-family="Plus Jakarta Sans, sans-serif" font-size="12.5" font-weight="800" fill="#0B1B3A"><textPath href="#lp-stamp-c" textLength="356" lengthAdjust="spacing">CERTIFIED · STRESS-FREE · FREE PLAN ·</textPath></text>
  <circle cx="80" cy="80" r="40" fill="#0B1B3A"/><path d="M62 81l12 12 25-27" fill="none" stroke="#E9B949" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
const PLANE = raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z" fill="currentColor"/></svg>');
const BARS = raw(`<span class="lp-bp-bars" aria-hidden="true">${Array.from({ length: 34 }, (_, i) => `<i style="width:${[2, 4, 1, 3, 2, 1, 4][i % 7]}px"></i>`).join('')}</span>`);
const pass = () => {
  const lines = ['Every permit, one list', 'Reminders 30, 7 and 1 day before', ...(has('library2') ? ['Step-by-step renewal guides'] : []), ...(has('filings') ? ['Tax and contribution dates'] : []),
    ...(has('clock') ? ['Know when an office runs late'] : []), has('vault') ? 'Files kept private and encrypted' : 'Files kept private, for years', 'Proof in one link', ...(has('mfa') ? ['Two-step login'] : [])];
  return html`<section id="free" class="lp-sec lp-free3" aria-labelledby="free-h">
    <div class="lp-free3-copy">
      <span class="lp-chip-free">Free plan</span>
      <h2 class="lp-big" id="free-h">Certified <span class="lp-blue">stress-free.</span></h2>
      <p class="lp-lead"><b>1 business and 1 vehicle, ₱0 a month.</b> No card needed to start.</p>
      <p class="lp-free3-more">Need more businesses, vehicles or team tools? That's on a paid plan. <a href="#/pricing">Compare plans</a></p>
      <a class="btn btn-primary btn-lg lp-pill-btn" href="#/signup">Start on the free plan${PIC.next}</a>
    </div>
    <div class="lp-free3-art">
      <div class="lp-bp">
        <div class="lp-bp-main">
          <div class="lp-bp-top"><img class="brand-wm" src="img/wordmark.png" alt="Pinoy Permit"><span class="lp-bp-kind">Boarding pass<b>Free plan</b></span></div>
          <div class="lp-bp-route" aria-label="From stress to on time">
            <span><small>FROM</small><b>STRESS</b></span><span class="lp-bp-path" aria-hidden="true"><i></i>${PLANE}<i></i></span><span class="lp-bp-to"><small>TO</small><b>ON TIME</b></span>
          </div>
          <div class="lp-bp-inc"><p class="lp-bp-inc-h">Included on the free plan</p>
            <ul>${lines.map((t) => html`<li>${tick}${t}</li>`)}</ul></div>
        </div>
        <div class="lp-bp-stub">
          <small>FARE · FREE PLAN</small><b class="lp-bp-fare">₱0<span>/month</span></b>
          <small>COVERS</small><b>1 business + 1 vehicle</b>
          <small>TO START</small><b>No card needed</b>
          ${BARS}
          <span class="lp-bp-up">More on paid plans</span>
        </div>
        ${STAMP}
      </div>
      <p class="lp-bp-note">The free plan covers 1 business and 1 vehicle. More businesses, vehicles, teammates' tools and texts come with <a href="#/pricing">paid plans</a>.</p>
    </div>
  </section>`;
};

// ---------------------------------------------------------------- 8. learn and get help
const community = () => html`<section class="lp-sec lp-learn" aria-labelledby="learn-h">
  <p class="lp-kick lp-kick-blue">LEARN AND GET HELP</p>
  <h2 class="lp-big lp-center" id="learn-h">You're not doing this alone.</h2>
  <p class="lp-lead lp-center lp-mx">Free guides, city by city, and real people when you're stuck.</p>
  <div class="lp-bento">
    <a class="lp-bt lp-bt-guides" href="renew/"><span><h3>Learn from the guides</h3><p>Free, step-by-step renewal guides for 16 cities. What to bring, where to go, and when it's due.</p>
      <span class="lp-bt-go">Read the guides${PIC.next}</span></span>
      <span class="lp-bt-cards" aria-hidden="true">${['Quezon City', 'Makati', 'Cebu City', 'Davao City'].map((c) => html`<span class="lp-gcard"><i></i><b>Business permit renewal</b><small>${c}</small></span>`)}</span></a>
    <div class="lp-bt lp-bt-date"><b class="lp-bt-big">Jan 20</b><h3>The renewal rush</h3><p>Most cities want business permits renewed by January 20. Your reminders start 30 days before.</p></div>
    <a class="lp-bt lp-bt-help" href="#/contact"><span class="lp-tile-ic">${ICON.person || PIC.team}</span><h3>Ask us anything</h3><p>Stuck on a permit? Send us a message and a real person answers.</p><span class="lp-bt-go">Contact us${PIC.next}</span></a>
    <div class="lp-bt lp-bt-cities"><span class="lp-tile-ic">${PIC.pin}</span><h3>16 cities, one place</h3><p>Metro Manila, Cebu and Davao, each with its own deadlines and papers.</p></div>
    <a class="lp-bt lp-bt-start" href="#/signup"><h3>Start in minutes</h3><p>No card. No contract. Bring the permits you already have.</p><span class="lp-bt-go">Start free${PIC.next}</span></a>
  </div>
</section>`;

// ---------------------------------------------------------------- 9. the last nudge, then the footer
const finalCta = () => html`<section class="lp-sec"><div class="lp-final2">
  <div><p class="lp-kick">PERMITS ON AUTOPILOT</p><h2 class="lp-big">Start free. Grow when you're ready.</h2>
    <p class="lp-lead">Track one business and one vehicle on the free plan. Add ${has('plus') ? 'Plus, more staff or ' : ''}a bigger plan only when you track more. Fleet plans start with 30 days free.</p>
    <div class="btn-row"><a class="btn btn-primary btn-lg lp-pill-btn" href="#/signup">Start free${PIC.next}</a><a class="btn btn-lg lp-btn-demo lp-pill-btn" href="demo/">${PLAY}Try the demo first</a><a class="btn btn-ghost btn-lg lp-btn-white lp-pill-btn" href="#/pricing">See plans and prices</a></div></div>
  <div class="lp-final-art" aria-hidden="true">
    <div class="lp-fc lp-fc-1"><span class="lp-fi t-solid-green">${ICON.check}</span><span><small>This week</small><b>All permits current</b></span></div>
    <div class="lp-fc lp-fc-2"><small>Next renewal</small><b>Mayor's Permit</b>${pill('soon', 'Due in 30 days')}<span class="lp-fc-bar"><i></i></span><small>Papers ready: 4 of 5</small></div>
  </div>
</div></section>`;

export function landing(app) {
  clearTheme();
  app.innerHTML = String(html`
    <main class="landing lp-home">
      <div class="lp-hero-bg"><div class="lp-wrap">${header(true)}${hero()}</div></div>
      ${stats()}
      <div class="lp-wrap">${offers()}${pitch()}</div>
      ${proof()}
      <div class="lp-wrap">${howItWorks()}${benefits()}${pass()}${community()}${finalCta()}</div>
      ${footer()}
    </main>`);
  window.scrollTo(0, 0);
  wireScroll(app);
}

// ---------------------------------------------------------------- the prices page
// Pinoy Permit Plus, shown: the public permit page with its QR code (example data).
const plusShowcase = () => (has('plus') ? html`<section class="lp-show card" aria-labelledby="plus-h">
  <div class="lp-show-copy"><span class="lp-kicker">Pinoy Permit Plus · ${peso(PLUS_MONTHLY)} a month</span>
    <h2 id="plus-h">Look legit. Stay a step ahead.</h2>
    <p class="muted">One link and a QR poster show customers, malls and inspectors that your permits are current. Every morning Pinoy Permit goes through your records and tells you what to fix.</p>
    ${checks(PLUS_CHECKS.slice(0, 6))}
    <div class="btn-row"><a class="btn btn-primary" href="#/signup">Try it free for 14 days</a></div></div>
  <div class="lp-tp" role="img" aria-label="Example public permit page: three permits, two current and one being renewed, with a QR code">
    <div class="lp-tp-top"><b>Sadie's Kitchen</b><small>Pasig City · from the business's own records, checked automatically by Pinoy Permit today</small></div>
    ${[["Mayor's Permit", 'ok', 'Current'], ['Fire safety (FSIC)', 'ok', 'Current'], ['Sanitary permit', 'soon', 'Being renewed']].map(([n, st, t]) => html`<div class="pv-row" aria-hidden="true"><span class="pv-name">${n}</span><span class="pv-pill pv-${st}">${t}</span></div>`)}
    <div class="lp-tp-qr" aria-hidden="true">${QR}<span><b>Scan to check</b><small>Print it, stick it by the counter</small></span></div>
  </div>
</section>` : '');
// What load buys (prices come from the database once they arrive; these are only shown until then).
const LOAD_FALLBACK = [{ code: 'texts_50', name: '50 text reminders', price_php: 49, active: true }, { code: 'texts_200', name: '200 text reminders', price_php: 179, active: true },
  { code: 'template', name: 'One template, yours to keep', price_php: 150, active: true }, { code: 'papers_check', name: 'Papers check', price_php: 499, active: true },
  { code: 'season_pass', name: 'Renewal season pass', price_php: 600, active: true }];
const LOAD_WHY = {
  texts_50: 'A text on the days your permits and tax deadlines need you. Credits never expire.',
  texts_200: 'The same texts, for bigger teams: works out cheaper per text.',
  template: 'An authorization letter, SPA or affidavit of loss, filled in with your details. Buy only the one you need.',
  papers_check: 'Before you queue, we check photos of your papers against the checklist. Usually answered by 6 pm the next weekday.',
  season_pass: 'For the January rush: up to 100 texts, one papers check, one template of your choice and your renewal plan by email. September to February.',
};
const loadCards = (list) => {
  const priceOf = (code) => Number(list.find((x) => x.code === code)?.price_php ?? 0);
  const pass = list.find((p) => p.code === 'season_pass' && p.active);
  return html`${list.filter((p) => p.active && p.code !== 'season_pass').map((p) => html`<div class="card lp-load-card"><b>${p.name}</b><span class="lp-load-price">${peso(p.price_php)}</span><p>${LOAD_WHY[p.code] || ''}</p></div>`)}
    ${pass ? html`<div class="card pass-card lp-pass">${passHeader(Number(pass.price_php), passPerks({}, priceOf), 'Most cities want renewals by January 20')}${passList(passPerks({}, priceOf))}</div>` : ''}`;
};
const FAQ = [
  ['Is the free plan really free?', 'Yes. One business and one vehicle, with reminders and checklists, cost nothing, with no time limit and no card. Track more with Plus (up to 5), Core (up to 15) or a fleet plan.'],
  ['Do you register new businesses or get new permits?', "No. Pinoy Permit is built for the permits you already have: it tracks them, reminds you and walks you through each renewal. Registering a brand-new business takes many offices and often months, so it isn't something we file. Your accountant or a licensed liaison can help with that; once you're registered, add your permits here."],
  ['Does a plan include someone renewing for me?', 'No. Every plan is tracking and planning software only. Renewal Assistance (₱499, a review of your papers and a written plan) is a separate service. Full-Service Vehicle Renewal (from ₱1,000) is coming soon. Government and third-party fees are always separate.'],
  ['What happens if I reach my plan\'s limit?', 'Everything you already track stays, and you can still edit it. You just can\'t add another business or vehicle until you move up. If a paid plan ends, nothing is deleted either.'],
  ['What happens after the 30-day trial?', 'You choose to pay monthly or yearly. Nothing is charged by itself: we send a bill, you pay by GCash, Maya or bank transfer.'],
  ['How does yearly work?', 'You pay for 10 months and get 12. That is 2 months free, every year.'],
  ['Can I stop anytime?', 'Yes. Your plan runs to the end of what you paid. Your data is never locked or deleted, and you can download it anytime.'],
];
const faq = () => [...FAQ, ...(has('load') ? [['What is the Pinoy Permit wallet?', "Prepaid credit for the small extras: text reminders, one template at a time, a papers check, the renewal season pass. Top up from ₱100. It never expires, and unused paid load can be paid back to you if you ask."]] : [])];
// The plans: software by size (small, then fleets), the per-vehicle band, landlords, then the separate services.
const TIER_CTA = { plus: ['#/signup', 'Try free for 14 days'], core: ['#/signup', 'Start with Core'], multi: ['#/signup?type=fleet', 'Try free for 30 days'],
  fleet: ['#/signup?type=fleet', 'Try free for 30 days'], fleet_pro: ['#/signup?type=fleet', 'Try free for 30 days'], enterprise: ['#/signup?type=fleet', 'Start a trial, then ask for a quote'] };
function pricingCards(plans) {
  const price = (id) => Number(plans.find((p) => p.id === id)?.price_php_monthly || 0);
  const cta = (id) => html`<a class="btn ${id === 'core' ? 'btn-primary' : 'btn-soft'} btn-block" href="${TIER_CTA[id][0]}">${TIER_CTA[id][1]}</a>`;
  const props = plansShown(plans);
  return html`${softwareBanner()}
    <h3 class="pp-group-h">For you and your small business</h3>
    <div class="pp-grid three">${freeCard(html`<a class="btn btn-primary btn-block" href="#/signup">Start free</a>`)}${tiersShown(plans, TIER_SMALL).map((id) => tierCard(id, tierPrice(plans, id), cta(id)))}</div>
    <h3 class="pp-group-h">For big households and fleets</h3>
    <div class="pp-grid four">${tiersShown(plans, TIER_FLEET).map((id) => tierCard(id, tierPrice(plans, id), cta(id)))}</div>
    ${peaceBand(plans)}
    ${props.length ? html`<h3 class="pp-group-h">For landlords and malls</h3>
      <div class="pp-grid">${props.map((id) => planCard(id, price(id), html`<a class="btn btn-primary btn-block" href="#/signup?type=property">Try free for 30 days</a>`))}</div>` : ''}
    ${helpServices({ assistCta: html`<a class="btn btn-soft btn-block" href="#/signup">Sign up, then open a permit</a>`, complexCta: html`<a class="btn btn-soft btn-block" href="#/signup">Sign up and tell us your case</a>` })}
    ${compareTable()}`;
}
const addons = () => (has('plus') ? html`<h2 class="lp-h3">Add-ons for any workspace</h2>
  <div class="pp-grid">
    ${addonCard({ id: 'lp-staff', icon: ICON.person, name: 'Staff licenses', who: 'Every license your team needs, tracked for you. They renew, you approve.',
      body: html`${staffTracks()}${checks(STAFF_CHECKS)}${staffLadder()}${staffExamples()}`, cta: html`<a class="btn btn-soft btn-block" href="#/signup">Start free with 3 people</a>` })}
    ${has('brand') ? addonCard({ id: 'lp-brand', icon: ICON.briefcase, name: 'White-label', who: 'For accounting firms: your brand on everything your clients see', monthly: BRAND_MONTHLY, list: BRAND_CHECKS,
      cta: html`<a class="btn btn-soft btn-block" href="#/signup?type=firm">Try free for 14 days</a>` }) : ''}
  </div>` : '');

export async function pricingPage(app) {
  clearTheme();
  // Show the page at once; team prices fill in when they arrive (a slow or unreachable server never blocks the page).
  const plansP = db.listPlans().catch(() => []);
  app.innerHTML = String(html`
    <main class="landing lp-prices">
      ${header(false)}
      <section class="lp-pricing" id="pricing" aria-labelledby="pricing-h">
        <h1 class="lp-title" id="pricing-h">Peace of mind for every vehicle you manage.</h1>
        <p class="lp-sub">Keep registration dates, documents, requirements, and renewal tasks organized in one place, so you can plan ahead instead of scrambling at the last minute.</p>
        <p class="lp-sub lp-sub-strong">${SOFTWARE_ONLY}</p>
        <p class="lp-trust">Clear prices. Clear deliverables. No hidden government or third-party charges. We show the scope and costs before you pay.</p>
        <h2 class="sr-only">Plans</h2>
        ${billToggle()}
        <div data-plans>${pricingCards([])}</div>
        ${addons()}
      </section>
      ${has('load') ? html`<section class="lp-load" aria-labelledby="load-h"><h2 class="lp-h3" id="load-h">Pay as you go, with your Pinoy Permit wallet</h2>
        <p class="lp-sub">Top up from ₱100 by GCash, Maya or bank. Use it only on what you need. It never expires.</p>
        <div class="lp-load-grid" data-load-products>${loadCards(LOAD_FALLBACK)}</div></section>` : ''}
      ${plusShowcase()}
      <section class="lp-faq" aria-label="Questions about prices">${faq().map(([q, a]) => html`<details class="card"><summary><b>${q}</b></summary><p>${a}</p></details>`)}</section>
      <section class="lp-final2 lp-final-sm"><div><h2 class="lp-big">Not sure yet?</h2><p class="lp-lead">Start on the free plan. Move up only if you need to.</p></div>
        <div class="btn-row"><a class="btn btn-primary btn-lg" href="#/signup">Start free</a><a class="btn btn-ghost btn-lg lp-btn-white" href="#/">See how it works</a></div></section>
      ${footer()}
    </main>`);
  window.scrollTo(0, 0);
  paintPrices(app);
  if (has('load')) db.loadProducts().then((list) => { const box = app.querySelector('[data-load-products]'); if (box && list?.length) box.innerHTML = String(loadCards(list)); }).catch(() => {});
  const plans = await plansP;
  const slot = app.querySelector('[data-plans]');
  if (slot && plans.length) { slot.innerHTML = String(pricingCards(plans)); paintPrices(slot); }
}
