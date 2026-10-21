// What a visitor sees before signing in: free tracking for every business, then the prices: the free plan,
// the team plans (accounting firm, fleet, property; prices read live from the plans table) and add-ons,
// monthly or yearly (2 months free), with everything side by side.
import { html } from '../util.js';
import { ICON } from '../components.js';
import { has, IN_PERSON } from '../core.js';
import { PLUS_MONTHLY, BRAND_MONTHLY } from '../prices.js';
import { billToggle, freeCard, planCard, PLAN_ORDER, compareTable, paintPrices, addonCard, PLUS_CHECKS, BRAND_CHECKS, staffLadder, staffExamples } from './pricing.js';
import * as db from 'pp/data';

const FEATURES = [
  [ICON.calendar, 'Every deadline in one place', 'Business permits, vehicle registration and staff licences, each with its own month-by-month timeline.'],
  [ICON.bell, 'Reminders before anything expires', 'Email reminders 30, 7 and 1 day before, then weekly while overdue. A weekly summary every Monday.'],
  [ICON.file, 'Your documents, safe for years', 'Every permit and receipt kept with its history. Nothing is ever hard-deleted.'],
  [ICON.share, 'Proof in one link', 'Send a read-only compliance summary to a landlord, mall, franchisor or bank. Turn it off anytime.'],
  [ICON.download, 'Inspection-ready', 'Download every current document in one zip, with a summary page, when an inspector walks in.'],
  [ICON.briefcase, 'Rather not queue?', 'Request quotes from licensed liaison firms and accountants near you, straight from the permit that needs renewing.'],
];

const FAQ = [
  ['Is Free really free?', 'Yes. Your own businesses, vehicles, team and reminders cost nothing, with no time limit and no card.'],
  ['What happens after the 30-day trial?', 'You choose to pay monthly or yearly. Nothing is charged by itself: we send a bill, you pay by GCash, Maya, bank or card.'],
  ['How does yearly work?', 'You pay for 10 months and get 12. That is 2 months free, every year.'],
  ['Can I stop anytime?', 'Yes. Your plan runs to the end of what you paid. Your data is never locked or deleted, and you can download it anytime.'],
];
// The plans and add-ons, with a "start" button for each (sign-up remembers which plan they picked).
function pricingCards(plans) {
  const price = (id) => Number(plans.find((p) => p.id === id)?.price_php_monthly || 0);
  const start = (id) => html`<a class="btn btn-primary btn-block" href="#/signup?type=${id}">Try free for 30 days</a>`;
  return html`<div class="pp-grid four">${freeCard(html`<a class="btn btn-primary btn-block" href="#/signup">Start free</a>`)}${PLAN_ORDER.map((id) => planCard(id, price(id), start(id)))}</div>`;
}
const addons = () => (has('plus') ? html`<h3 class="lp-h3">Add-ons for any workspace</h3>
  <div class="pp-grid">
    ${addonCard({ id: 'lp-plus', icon: ICON.share, name: 'PermitPal Plus', who: 'Show customers you are legit, and let PermitPal check your permits for you', monthly: PLUS_MONTHLY, list: PLUS_CHECKS,
      cta: html`<a class="btn btn-soft btn-block" href="#/signup">Try free for 14 days</a>` })}
    ${addonCard({ id: 'lp-staff', icon: ICON.person, name: 'Staff licences', who: "Track your staff's health cards, NBI clearances and driver's licences",
      body: html`${staffLadder()}${staffExamples()}`, cta: html`<a class="btn btn-soft btn-block" href="#/signup">Start free with 3 people</a>` })}
    ${has('brand') ? addonCard({ id: 'lp-brand', icon: ICON.briefcase, name: 'White-label', who: 'For accounting firms: your brand on everything your clients see', monthly: BRAND_MONTHLY, list: BRAND_CHECKS,
      cta: html`<a class="btn btn-soft btn-block" href="#/signup?type=firm">Try free for 14 days</a>` }) : ''}
  </div>` : '');

export async function landing(app) {
  // Show the page at once; team prices fill in when they arrive (a slow or unreachable server never blocks the page).
  const plansP = db.listPlans().catch(() => []);
  const tiersP = has('revenue') && IN_PERSON ? db.careTiers().catch(() => []) : Promise.resolve([]);
  const features = has('revenue') && IN_PERSON ? [...FEATURES, [ICON.check, 'Or let us do it all', 'Year-round care: one monthly fee per branch or vehicle and we start every renewal for you. You approve the government fees; we do the rest.']] : FEATURES;
  app.innerHTML = String(html`
    <main class="landing">
      <header class="lp-top"><a class="brand" href="#/"><img src="img/logo.png" alt=""><span class="wordmark"><span class="w1">Permit</span><span class="w2">Pal</span></span></a>
        <div class="spacer"></div><a class="btn btn-ghost btn-sm" href="#pricing" data-scroll>Prices</a><a class="btn btn-ghost btn-sm" href="#/login">Sign in</a><a class="btn btn-primary btn-sm" href="#/signup">Get started</a></header>

      <section class="lp-hero">
        <h1>Never miss a permit renewal again.</h1>
        <p>PermitPal keeps every business permit, vehicle registration and staff licence in one place, and reminds you before anything expires.</p>
        <div class="btn-row lp-cta"><a class="btn btn-primary" href="#/signup">Start free</a><a class="btn btn-ghost" href="demo/">See the demo</a></div>
        <p class="muted small">Free for every business: unlimited businesses, vehicles and team members.</p>
      </section>

      <section class="lp-steps card">
        ${[['1', 'Add your businesses and vehicles', "We build each one's permit checklist: Mayor's Permit, Barangay Clearance, FSIC, LTO registration and more."],
          ['2', 'Add dates and documents', 'Snap or upload each permit and enter its expiry date. Your dashboard tells you what to do first.'],
          ['3', 'Renew on time', 'Get reminders well ahead of every deadline. Need someone to file it? Request a quote from a licensed firm.']]
          .map(([n, t, d]) => html`<div class="lp-step"><span>${n}</span><div><b>${t}</b><p>${d}</p></div></div>`)}
      </section>

      <h2 class="lp-h2">Everything you need to stay compliant</h2>
      <div class="lp-features">${features.map(([ic, t, d]) => html`<div class="card lp-feature">${ic}<b>${t}</b><p>${d}</p></div>`)}</div>

      <section class="lp-pricing" id="pricing" aria-labelledby="pricing-h">
        <h2 class="lp-h2" id="pricing-h">Simple prices. Start free.</h2>
        <p class="lp-sub">Free for your own business, forever. Team plans for people who look after many businesses, vehicles or tenants: 30 days free, no card needed.</p>
        ${billToggle()}
        <div data-plans>${pricingCards([])}</div>
        ${compareTable()}
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
  app.querySelector('[data-scroll]')?.addEventListener('click', (e) => { e.preventDefault(); document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' }); });
  paintPrices(app);
  const tiers = await tiersP;
  const from = Math.min(...tiers.filter((t) => t.subject === 'branch').map((t) => Number(t.monthly_php)));
  const card = [...app.querySelectorAll('.lp-feature b')].find((b) => b.textContent === 'Or let us do it all');
  if (card && Number.isFinite(from)) card.parentElement.querySelector('p').textContent += ` From ₱${from.toLocaleString()} a month per branch.`;
  const plans = await plansP;
  const slot = app.querySelector('[data-plans]');
  if (slot && plans.length) { slot.innerHTML = String(pricingCards(plans)); paintPrices(slot); }
}
