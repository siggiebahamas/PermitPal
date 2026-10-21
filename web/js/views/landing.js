// What a visitor sees before signing in: what PermitPal does (free for every business), PermitPal Plus,
// then the prices: the free plan, the team plans (accounting firm, fleet, small and big property; prices
// read live from the plans table) and add-ons, monthly or yearly (2 months free), side by side. Anything
// whose database part isn't switched on yet stays off the page.
import { html, peso } from '../util.js';
import { ICON } from '../components.js';
import { has, IN_PERSON } from '../core.js';
import { PLUS_MONTHLY, BRAND_MONTHLY } from '../prices.js';
import { billToggle, freeCard, planCard, plansShown, PLANS, compareTable, paintPrices, addonCard, checks, PLUS_CHECKS, BRAND_CHECKS, STAFF_CHECKS, staffTracks, staffLadder, staffExamples } from './pricing.js';
import * as db from 'pp/data';

// Free for every business. A feature whose database part isn't switched on yet isn't shown.
const FEATURES = () => [
  [ICON.calendar, 'Every deadline in one place', 'Business permits, vehicle registration and staff licenses, each with its own month-by-month timeline.', true],
  [ICON.bell, 'Reminders before anything runs out', `Email and in-app reminders 30, 7 and 1 day before, then weekly while it is late. A summary every Monday.${has('sms') ? ' Text reminders come with team plans.' : ''}`, true],
  [ICON.camera, "Snap, don't type", 'Take a photo of a permit or OR/CR. PermitPal reads the number and the dates; you just check them.', true],
  [ICON.peso, 'Tax and contribution deadlines', 'BIR, SSS, PhilHealth and Pag-IBIG due dates for each business, worked out for you.', has('filings')],
  [ICON.list, 'Step-by-step renewals', "Each permit's checklist: what to bring, where to file, and the link to the online portal.", has('library2')],
  [ICON.person, 'Hand it to a teammate', 'Give a permit to someone on your team. If it slips, the owner hears about it.', has('assign')],
  [ICON.upload, 'Bring it all in at once', 'Import businesses, branches, vehicles and staff from a spreadsheet.', true],
  [ICON.file, 'Papers safe for years', 'Every permit and receipt kept with its history. Nothing is ever hard-deleted.', true],
  [ICON.share, 'Proof in one link', 'Send a read-only summary to a landlord, mall, franchisor or bank. Turn it off anytime.', true],
  [ICON.download, 'Inspection-ready', 'Every current document in one download, with a summary page, when an inspector walks in.', true],
  [ICON.check, 'Two-step login', 'Protect your workspace with an authenticator app on your phone.', has('mfa')],
  [ICON.briefcase, 'Rather not queue?', 'Ask liaison firms and accountants near you for a quote, straight from the permit that is due.', true],
].filter((f) => f[3]).map(([ic, t, d]) => [ic, t, d]);
// What the dashboard looks like (example data).
const heroPreview = () => html`<div class="lp-hero-pv pp-preview" role="img" aria-label="Example: a dashboard listing permits, a vehicle, a staff license and a tax deadline with their status">
  <div class="pv-head"><b>What needs you</b><span class="pv-dots" aria-hidden="true"><i></i><i></i><i></i></span></div>
  ${[["Mayor's Permit · Main branch", 'soon', 'Due in 12 days'], ['LTO registration · ABC 1234', 'ok', 'All good'], ['Health card · Ana Cruz', 'late', '3 days late'],
    ...(has('filings') ? [['BIR 2551Q · quarterly VAT', 'soon', 'Due in 5 days']] : [])].map(([n, st, t]) => html`<div class="pv-row" aria-hidden="true"><span class="pv-name">${n}</span><span class="pv-pill pv-${st}">${t}</span></div>`)}
</div>`;
// PermitPal Plus, shown: the public permit page with its QR code (example data).
const plusShowcase = () => (has('plus') ? html`<section class="lp-show card" aria-labelledby="plus-h">
  <div class="lp-show-copy"><span class="lp-kicker">PermitPal Plus · ${peso(PLUS_MONTHLY)} a month</span>
    <h2 id="plus-h">Look legit. Stay a step ahead.</h2>
    <p class="muted">One link and a QR poster show customers, malls and inspectors that your permits are current. Every morning PermitPal goes through your records and tells you what to fix.</p>
    ${checks(PLUS_CHECKS.slice(0, 6))}
    <div class="btn-row"><a class="btn btn-primary" href="#/signup">Try it free for 14 days</a><a class="btn btn-ghost" href="#pricing" data-scroll-to="pricing">See prices</a></div></div>
  <div class="lp-tp" role="img" aria-label="Example public permit page: three permits, two current and one being renewed, with a QR code">
    <div class="lp-tp-top"><b>Lorna's Kitchen</b><small>Pasig City · from the business's own records, checked automatically by PermitPal today</small></div>
    ${[["Mayor's Permit", 'ok', 'Current'], ['Fire safety (FSIC)', 'ok', 'Current'], ['Sanitary permit', 'soon', 'Being renewed']].map(([n, st, t]) => html`<div class="pv-row" aria-hidden="true"><span class="pv-name">${n}</span><span class="pv-pill pv-${st}">${t}</span></div>`)}
    <div class="lp-tp-qr" aria-hidden="true"><svg viewBox="0 0 21 21" class="lp-qr"><path fill-rule="evenodd" d="M0 0h7v7H0zM2 2v3h3V2zM14 0h7v7h-7zm2 2v3h3V2zM0 14h7v7H0zm2 2v3h3v-3zM9 0h2v2H9zm2 2h2v3h-2zM9 6h2v3H9zm-1 3h3v2H8zm5 0h2v3h-2zm3 1h3v2h-3zm-7 4h2v2H9zm4 0h3v2h-3zm5 0h3v3h-3zm-7 4h3v3h-3zm4 1h2v2h-2zm3 0h3v2h-3z"/></svg>
      <span><b>Scan to check</b><small>Print it, stick it by the counter</small></span></div>
  </div>
</section>` : '');
const FAQ = [
  ['Is Free really free?', 'Yes. Your own businesses, vehicles, team and reminders cost nothing, with no time limit and no card.'],
  ['What happens after the 30-day trial?', 'You choose to pay monthly or yearly. Nothing is charged by itself: we send a bill, you pay by GCash, Maya, bank or card.'],
  ['How does yearly work?', 'You pay for 10 months and get 12. That is 2 months free, every year.'],
  ['Can I stop anytime?', 'Yes. Your plan runs to the end of what you paid. Your data is never locked or deleted, and you can download it anytime.'],
];
// The plans and add-ons, with a "start" button for each (sign-up remembers which plan they picked).
function pricingCards(plans) {
  const price = (id) => Number(plans.find((p) => p.id === id)?.price_php_monthly || 0);
  const start = (id) => html`<a class="btn btn-primary btn-block" href="#/signup?type=${PLANS[id].kind}">Try free for 30 days</a>`;
  return html`<div class="pp-grid four">${freeCard(html`<a class="btn btn-primary btn-block" href="#/signup">Start free</a>`)}${plansShown(plans).map((id) => planCard(id, price(id), start(id)))}</div>
    ${compareTable(plansShown(plans))}`;
}
const addons = () => (has('plus') ? html`<h3 class="lp-h3">Add-ons for any workspace</h3>
  <div class="pp-grid">
    ${addonCard({ id: 'lp-plus', icon: ICON.share, name: 'PermitPal Plus', who: 'Show customers you are legit, and let PermitPal check your permits for you', monthly: PLUS_MONTHLY, list: PLUS_CHECKS,
      cta: html`<a class="btn btn-soft btn-block" href="#/signup">Try free for 14 days</a>` })}
    ${addonCard({ id: 'lp-staff', icon: ICON.person, name: 'Staff licenses', who: 'Every license your team needs, tracked for you. They renew, you approve.',
      body: html`${staffTracks()}${checks(STAFF_CHECKS)}${staffLadder()}${staffExamples()}`, cta: html`<a class="btn btn-soft btn-block" href="#/signup">Start free with 3 people</a>` })}
    ${has('brand') ? addonCard({ id: 'lp-brand', icon: ICON.briefcase, name: 'White-label', who: 'For accounting firms: your brand on everything your clients see', monthly: BRAND_MONTHLY, list: BRAND_CHECKS,
      cta: html`<a class="btn btn-soft btn-block" href="#/signup?type=firm">Try free for 14 days</a>` }) : ''}
  </div>` : '');

export async function landing(app) {
  // Show the page at once; team prices fill in when they arrive (a slow or unreachable server never blocks the page).
  const plansP = db.listPlans().catch(() => []);
  const tiersP = has('revenue') && IN_PERSON ? db.careTiers().catch(() => []) : Promise.resolve([]);
  const features = [...FEATURES(),
    ...(has('services') ? [[ICON.handshake, 'Or let us set it up', 'Send photos of your papers and we enter every permit, date and reminder for you, for a fixed fee.', 'wide']] : []),
    ...(has('revenue') && IN_PERSON ? [[ICON.check, 'Or let us do it all', 'Year-round care: one monthly fee per branch or vehicle and we start every renewal for you. You approve the government fees; we do the rest.', 'wide']] : [])];
  app.innerHTML = String(html`
    <main class="landing">
      <header class="lp-top"><a class="brand" href="#/"><img src="img/logo.png" alt=""><span class="wordmark"><span class="w1">Permit</span><span class="w2">Pal</span></span></a>
        <div class="spacer"></div><a class="btn btn-ghost btn-sm lp-nav" href="#features" data-scroll-to="features">Features</a><a class="btn btn-ghost btn-sm lp-nav" href="#pricing" data-scroll-to="pricing">Prices</a><a class="btn btn-ghost btn-sm" href="#/login">Sign in</a><a class="btn btn-primary btn-sm" href="#/signup">Get started</a></header>

      <section class="lp-hero">
        <div class="lp-hero-copy">
          <h1>Never miss a permit, license${has('filings') ? ' or tax deadline' : ' renewal'} again.</h1>
          <p>PermitPal keeps every business permit, vehicle registration${has('filings') ? ', staff license and tax deadline' : ' and staff license'} in one place, reads the dates from a photo, and reminds you before anything runs out.</p>
          <div class="btn-row lp-cta"><a class="btn btn-primary" href="#/signup">Start free</a><a class="btn btn-ghost" href="demo/">See the demo</a></div>
          <p class="muted small">Free for every business, forever: unlimited businesses, vehicles and team members. No card.</p>
        </div>
        ${heroPreview()}
      </section>

      <section class="lp-steps card">
        ${[['1', 'Add what you run', "Businesses, branches, vehicles and staff, or import a spreadsheet. We build each one's checklist: Mayor's Permit, FSIC, LTO, health cards and more."],
          ['2', "Snap, don't type", 'Take a photo of each permit. PermitPal reads the dates; you check them. Your dashboard shows what to do first.'],
          ['3', 'Renew on time', `Reminders 30, 7 and 1 day before${has('library2') ? ', with a step-by-step checklist for each renewal' : ''}. Rather not queue? Ask a firm near you for a quote.`]]
          .map(([n, t, d]) => html`<div class="lp-step"><span>${n}</span><div><b>${t}</b><p>${d}</p></div></div>`)}
      </section>

      <section id="features" aria-labelledby="features-h">
        <h2 class="lp-h2" id="features-h">Free for every business</h2>
        <p class="lp-sub">Everything you need to stay compliant, at no cost and with no time limit.</p>
        <div class="lp-features">${features.map(([ic, t, d, wide]) => html`<div class="card lp-feature ${wide ? 'lp-wide' : ''}">${ic}<b>${t}</b><p>${d}</p></div>`)}</div>
      </section>

      ${plusShowcase()}

      <section class="lp-pricing" id="pricing" aria-labelledby="pricing-h">
        <h2 class="lp-h2" id="pricing-h">Simple prices. Start free.</h2>
        <p class="lp-sub">Free for your own business, forever. Team plans for people who look after many businesses, vehicles or tenants: 30 days free, no card needed.</p>
        ${billToggle()}
        <div data-plans>${pricingCards([])}</div>
        ${addons()}
        <div class="lp-faq">${FAQ.map(([q, a]) => html`<details class="card"><summary><b>${q}</b></summary><p>${a}</p></details>`)}</div>
      </section>

      <section class="card lp-trust">
        <div><b>Private by default</b><p>Only your team sees your workspace. PermitPal staff only open a file when you ask us to handle something, and every open is shown to you.</p></div>
        <div><b>You decide who sees what</b><p>Franchisors, accountants and malls only see your permit status if you connect, and you can stop anytime.</p></div>
        <div><b>Nothing gets lost</b><p>Deleted items go to Trash, every change is logged, and you can export everything anytime.</p></div>
      </section>

      <section class="lp-final"><h2>Start keeping track today</h2><div class="btn-row lp-cta"><a class="btn btn-primary" href="#/signup">Create your free account</a><a class="btn btn-ghost" href="demo/">See the demo</a></div></section>
      <footer class="lp-foot"><span>© PermitPal</span><a href="privacy.html">Privacy</a><a href="terms.html">Terms</a><a href="#/contact">Contact</a>${has('revenue') ? html`<a href="#/list-your-firm">For service providers</a>` : ''}<a href="#/login">Sign in</a></footer>
    </main>`);
  // In-page links ("Features", "Prices") scroll; they must not change the address (the app's pages live there).
  app.querySelectorAll('[data-scroll-to]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); document.getElementById(a.dataset.scrollTo)?.scrollIntoView({ behavior: 'smooth' }); }));
  paintPrices(app);
  const tiers = await tiersP;
  const from = Math.min(...tiers.filter((t) => t.subject === 'branch').map((t) => Number(t.monthly_php)));
  const card = [...app.querySelectorAll('.lp-feature b')].find((b) => b.textContent === 'Or let us do it all');
  if (card && Number.isFinite(from)) card.parentElement.querySelector('p').textContent += ` From ₱${from.toLocaleString()} a month per branch.`;
  const plans = await plansP;
  const slot = app.querySelector('[data-plans]');
  if (slot && plans.length) { slot.innerHTML = String(pricingCards(plans)); paintPrices(slot); }
}
