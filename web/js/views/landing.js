// What a visitor sees before signing in. The home page sells the product: "Stay on top of every permit. Easily."
// (with "Permits on autopilot" as its label), everything
// to keep current on one screen, the headaches it takes away, a 5-step tour and the free plan as a receipt.
// Prices have their own page (#/pricing): the free plan, the team plans (prices read live from the plans
// table) and add-ons, monthly or yearly (2 months free). Anything whose database part isn't switched on
// yet stays off both pages.
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
  ${onHome ? html`<a class="btn btn-ghost btn-sm lp-nav" href="#tour" data-scroll-to="tour">How it works</a><a class="btn btn-ghost btn-sm lp-nav" href="#for-you" data-scroll-to="for-you">Who it's for</a>`
    : html`<a class="btn btn-ghost btn-sm lp-nav" href="#/">How it works</a>`}
  <a class="btn btn-ghost btn-sm lp-nav" href="#/pricing" ${onHome ? '' : raw('aria-current="page"')}>Prices</a><a class="btn btn-ghost btn-sm" href="#/login">Sign in</a><a class="btn btn-primary btn-sm" href="#/signup">Start free</a></header>`;
const footer = () => html`<footer class="lp-foot"><span>© Pinoy Permit</span><a href="#/pricing">Prices</a><a href="renew/">Renewal guides</a><a href="privacy.html">Privacy</a><a href="terms.html">Terms</a><a href="#/contact">Contact</a>${has('revenue') ? html`<a href="#/list-your-firm">For service providers</a>` : ''}<a href="#/login">Sign in</a></footer>`;
// In-page links scroll; they must not change the address (the app's pages live there).
const wireScroll = (app) => app.querySelectorAll('[data-scroll-to]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); document.getElementById(a.dataset.scrollTo)?.scrollIntoView({ behavior: 'smooth' }); }));

// ---------------------------------------------------------------- home: the hero, with the app on a phone (example data)
const hero = () => html`<section class="lp-hero2">
  <div class="lp-hero2-copy">
    <p class="lp-tag">Permits on autopilot</p>
    <h1>Stay on top of every permit. <span class="lp-blue">Easily.</span></h1>
    <p class="lp-lead">Add the permits you already have, once. Pinoy Permit tracks every expiry date${has('filings') ? ' and tax deadline' : ''}${has('library2') ? ', reminds you before each one is due, and walks you through each renewal, step by step' : ' and reminds you before each one is due'}.</p>
    <div class="btn-row"><a class="btn btn-primary btn-lg" href="#/signup">Start free</a><a class="btn btn-ghost btn-lg lp-btn-white" href="#tour" data-scroll-to="tour">See how it works</a><a class="btn btn-lg lp-btn-demo" href="demo/">${PLAY}Try the demo</a></div>
    <p class="lp-demo-note">No sign-up needed for the demo. Click around with sample data.</p>
    <p class="lp-scope">Made for businesses that are already registered. Pinoy Permit tracks and guides; it doesn't file new business registrations.</p>
  </div>
  <div class="lp-hero2-art">
    <div class="lp-blob" aria-hidden="true"></div>
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

// ---------------------------------------------------------------- home: everything on one screen
const forYou = () => {
  const kinds = [[PIC.bag, 't-blue', 'Your business permits', 'Every branch, every permit'], [PIC.truck, 't-teal', 'Your vehicles', 'If you have any'],
    [PIC.team, 't-green', "Your staff's licenses", 'Health cards, NBI and more'], ...(has('filings') ? [[ICON.calendar, 't-lilac', 'Your tax dates', 'BIR, SSS, PhilHealth, Pag-IBIG']] : [])];
  const rows = [['OCT', 26, 'r', 'Health card', 'Staff · Ana Cruz', 'late', '3 days late'], ...(has('filings') ? [['NOV', 3, 'y', 'BIR 2551Q', 'Taxes · Quarterly', 'soon', 'Due in 5 days']] : []),
    ['NOV', 10, 'y', 'Sanitary permit', 'Business · Main store', 'soon', 'Due in 12 days'], ['NOV', 18, 'y', 'CTPL insurance', 'Vehicle · ABC 1234', 'soon', 'Due in 20 days'],
    ['MAY', 16, 'g', 'Fire safety (FSIC)', 'Business · Main store', 'ok', 'All good']];
  return html`<section id="for-you" class="lp-sec" aria-labelledby="for-you-h">
    <h2 class="lp-big" id="for-you-h"><span class="lp-line">Every permit, vehicle and license.</span><span class="lp-line lp-blue">One screen.</span></h2>
    <p class="lp-lead">Whatever you run, it all lands in one list, sorted by what's due first.</p>
    <div class="lp-split">
      <ul class="lp-kinds">${kinds.map(([ic, t, b, s]) => html`<li><span class="lp-sq ${t}">${ic}</span><span><b>${b}</b>${s}</span></li>`)}</ul>
      <div class="lp-split-art">
        <div class="lp-board" role="img" aria-label="One list mixing business permits, vehicles, staff licenses${has('filings') ? ' and tax dates' : ''}, most urgent first">
          <div class="lp-board-head" aria-hidden="true"><b>Next actions</b><small>Most urgent first</small></div>
          ${rows.map(([m, d, c, n, sub, st, txt]) => html`<div class="lp-row" aria-hidden="true"><span class="lp-app-date ${c}"><small>${m}</small><b>${d}</b></span><span class="lp-row-t"><b>${n}</b><small>${sub}</small></span>
            ${pill(st, txt)}${st === 'ok' ? '' : html`<span class="lp-app-renew">Renew</span>`}</div>`)}
        </div>
        <p class="lp-note">Looking after permits for clients, tenants or a fleet? <a href="#/pricing">See team plans.</a></p>
      </div>
    </div>
  </section>`;
};

// ---------------------------------------------------------------- home: the headaches it takes away
const worries = () => {
  const list = [
    [ICON.bell, 't-blue', 'Surprise penalties', 'Reminded before every deadline.'],
    [ICON.file, 't-green', 'Lost papers', 'Every permit and receipt, kept for years.'],
    ...(has('filings') ? [[ICON.calendar, 't-teal', 'Tax due dates', 'BIR, SSS, PhilHealth and Pag-IBIG, worked out.']] : []),
    [ICON.download, 't-lilac', 'Inspector walk-ins', 'Every document in one download.'],
    ...(has('plus') ? [[PIC.team, 't-green', 'Chasing staff', 'They upload. You tap Approve.']] : has('assign') ? [[PIC.team, 't-green', 'Chasing your team', 'Hand it over. You hear if it slips.']] : []),
    [ICON.upload, 't-blue', 'Setting it all up', has('services') ? 'Import a spreadsheet, or let us do it.' : 'Import it all from a spreadsheet.'],
    [PIC.pin, 't-teal', 'Wasted trips', 'Know what to bring, and renew online where your city allows it.'],
    [PIC.lock, 't-lilac', 'Prying eyes', has('vault') ? 'Every file encrypted, with two-step login.' : has('mfa') ? 'Private by default, with two-step login.' : 'Private by default. Only your team sees it.'],
  ];
  return html`<section id="worry" class="lp-band" aria-labelledby="worry-h"><div class="lp-wrap">
    <h2 class="lp-big lp-narrow" id="worry-h">Things you'll never worry about again.</h2>
    <p class="lp-lead">The headaches Pinoy Permit takes off your plate.</p>
    <div class="lp-worries">${list.map(([ic, t, b, d]) => html`<div class="lp-worry"><span class="lp-sq lp-sq-lg ${t}">${ic}</span><h3>${b}</h3><p>${d}</p></div>`)}</div>
  </div></section>`;
};

// ---------------------------------------------------------------- home: the tour, one color per step
const STEPS = () => [
  { label: 'Add', tint: 'blue', title: 'Add permits your way.',
    line: `Pick a permit from the list and add its date. Or import a spreadsheet${has('services') ? ', use a photo, or have us set it all up' : ' or use a photo'}.`,
    chips: ['Type it in', 'Import a spreadsheet', 'Photo, if you like'] },
  { label: 'Remind', tint: 'green', title: "Reminded before it's late.", line: '30, 7 and 1 day before, then every week until it is done. A summary every Monday.',
    chips: ['Email', 'In the app', ...(has('sms') ? ['Texts on team plans'] : [])] },
  has('library2')
    ? { label: 'Renew', tint: 'teal', title: 'Know exactly what to bring.', line: 'A checklist for each renewal, with the link to the online portal when there is one.', chips: ['Checklists', 'Online portal links', 'Quotes from firms'] }
    : { label: 'Renew', tint: 'teal', title: 'Renew on time.', line: 'Your list shows what to renew first. Record the renewal and the next date is set for you.', chips: ['What to do first', 'Next date set', 'Quotes from firms'] },
  { label: 'Prove', tint: 'lilac', title: "Show you're legit.", line: `One link shows landlords, malls and banks your permits are current.${has('plus') ? ' Add a QR poster with Plus.' : ''}`,
    chips: ['Proof link', 'Inspection download', ...(has('plus') ? ['QR poster with Plus'] : [])] },
  has('plus')
    ? { label: 'Team', tint: 'brown', title: 'Your team does the chasing.', line: `${has('assign') ? 'Hand a permit to a teammate. ' : ''}Staff send renewed licenses from their phone. You tap Approve.`,
      chips: [...(has('assign') ? ['Assign a teammate'] : []), 'Staff licenses', 'You approve'] }
    : { label: 'Team', tint: 'brown', title: 'Share the load.', line: `Invite your team for free.${has('assign') ? ' Hand a permit to a teammate; the owner hears if it slips.' : ''}`,
      chips: ['Invite your team', ...(has('assign') ? ['Assign a teammate', 'Owner hears if it slips'] : [])] },
];
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
function tourBody(n) {
  const steps = STEPS(), st = steps[n - 1];
  return html`
    <div class="lp-path">
      ${steps.slice(0, -1).map((s, i) => html`<span class="lp-seg t-${s.tint} ${n > i + 1 ? 'on' : ''}" style="left: ${10 + i * 20}%" aria-hidden="true"></span>`)}
      ${steps.map((s, i) => { const k = i + 1, done = k < n, cur = k === n;
        return html`<button type="button" class="lp-dot t-${s.tint} ${done || cur ? 'on' : ''} ${cur ? 'cur' : ''}" data-step="${k}" ${cur ? raw('aria-current="step"') : ''} aria-label="Step ${k}: ${s.label}${done ? ' (seen)' : ''}">
          <span class="lp-circ">${done ? ICON.check : k}</span><span class="lp-dot-l">${s.label}</span></button>`; })}
    </div>
    <p class="lp-hint">Tap any step to jump to it</p>
    <div class="lp-stage t-${st.tint}">
      <div class="lp-stage-copy" aria-live="polite">
        <p class="lp-kick">STEP ${n} · ${st.label.toUpperCase()}</p>
        <h3>${st.title}</h3>
        <p class="lp-stage-line">${st.line}</p>
        <ul class="lp-chips">${st.chips.map((c) => html`<li>${ICON.check}${c}</li>`)}</ul>
        <div class="btn-row"><button type="button" class="btn btn-ghost lp-btn-white" data-step="${n - 1}" ${n === 1 ? 'disabled' : ''}>${PIC.back}Back</button>
          <button type="button" class="btn lp-btn-step" data-step="${n === 5 ? 1 : n + 1}">${n === 5 ? 'Start again' : `Next: ${steps[n].label}`}${PIC.next}</button></div>
      </div>
      <div class="lp-phone lp-phone-sm"><div class="lp-screen"><div class="lp-notch" aria-hidden="true"></div>${SCREENS[n - 1]()}</div></div>
    </div>`;
}
const tour = () => html`<section id="tour" class="lp-sec" aria-labelledby="tour-h">
  <div class="lp-tour">
    <p class="lp-kick lp-kick-blue">HOW IT WORKS · 5 STEPS</p>
    <h2 class="lp-big lp-narrow" id="tour-h">From adding a permit to proving it.</h2>
    <div data-tour>${tourBody(1)}</div>
  </div>
</section>`;

// ---------------------------------------------------------------- home: what the free plan gives, as a receipt
const receipt = () => {
  const lines = [[ICON.building, 't-blue', '1 business + 1 vehicle'], [ICON.list, 't-blue', 'Every permit, one list'], [ICON.bell, 't-green', "Reminders before it's late"],
    ...(has('filings') ? [[ICON.calendar, 't-teal', 'Tax and contribution dates']] : []), ...(has('library2') ? [[PIC.todo, 't-lilac', 'Step-by-step renewals']] : []),
    [ICON.file, 't-green', 'Papers safe for years'], [ICON.share, 't-blue', 'Proof in one link'], [ICON.download, 't-lilac', 'Inspection-ready download'],
    ...(has('mfa') ? [[PIC.lock, 't-teal', 'Two-step login']] : [])];
  return html`<section id="free" class="lp-sec lp-free2" aria-labelledby="free-h">
    <div class="lp-free2-copy">
      <span class="lp-chip-free">Free plan</span>
      <h2 class="lp-big" id="free-h">Yours on the free plan.</h2>
      <p class="lp-lead">One business and one vehicle, with everything on the receipt, every month, for nothing. Move up only when you track more.</p>
    </div>
    <div class="lp-receipt">
      <div class="lp-rc-top"><img class="brand-wm" src="img/wordmark.png" alt="Pinoy Permit"><span class="lp-rc-plan">Free plan</span><span class="lp-rc-every">Every month</span></div>
      <hr class="lp-rc-dash">
      <ul class="lp-rc-lines">${lines.map(([ic, t, n]) => html`<li><span class="lp-sq lp-sq-round ${t}">${ic}</span><span class="lp-rc-n">${tick}${n}</span><span class="lp-rc-inc">Included</span></li>`)}</ul>
      <hr class="lp-rc-dash">
      <div class="lp-rc-total"><b>Total each month</b><b class="lp-rc-amt">₱0.00</b></div>
      <p class="lp-rc-foot">No card. No time limit.</p>
      <a class="btn btn-primary btn-block btn-lg" href="#/signup">Start free</a>
      <div class="lp-scallop" aria-hidden="true">${Array.from({ length: 15 }, () => raw('<i></i>'))}</div>
    </div>
  </section>`;
};

const finalCta = () => html`<section class="lp-sec"><div class="lp-final2">
  <div><h2 class="lp-big">Start free. Grow when you're ready.</h2>
    <p class="lp-lead">Track one business and one vehicle on the free plan. Add ${has('plus') ? 'Plus, more staff or ' : ''}a bigger plan only when you track more. Fleet plans start with 30 days free.</p></div>
  <div class="btn-row"><a class="btn btn-primary btn-lg" href="#/signup">Start free</a><a class="btn btn-lg lp-btn-demo" href="demo/">${PLAY}Try the demo first</a><a class="btn btn-ghost btn-lg lp-btn-white" href="#/pricing">See plans and prices</a></div>
</div></section>`;

export function landing(app) {
  app.innerHTML = String(html`
    <main class="landing lp-home">
      <div class="lp-wrap">${header(true)}${hero()}${forYou()}</div>
      ${worries()}
      <div class="lp-wrap">${tour()}${receipt()}${finalCta()}${footer()}</div>
    </main>`);
  window.scrollTo(0, 0);
  wireScroll(app);
  const box = app.querySelector('[data-tour]');
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-step]');
    if (!b || b.disabled) return;
    const n = Number(b.dataset.step);
    box.innerHTML = String(tourBody(n));
    box.querySelector(`.lp-dot[data-step="${n}"]`)?.focus({ preventScroll: true });
  });
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
