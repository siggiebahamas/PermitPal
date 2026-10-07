// What a visitor sees before signing in: free tracking for every business, and the team tools
// (head office, accounting firm, property, fleet) with their prices read live from the plans table.
import { html, when } from '../util.js';
import { ICON } from '../components.js';
import * as db from 'pp/data';

const FEATURES = [
  [ICON.calendar, 'Every deadline in one place', 'Business permits, vehicle registration and staff licences, each with its own month-by-month timeline.'],
  [ICON.bell, 'Reminders before anything expires', 'Email reminders 30, 7 and 1 day before, then weekly while overdue. A weekly summary every Monday.'],
  [ICON.file, 'Your documents, safe for years', 'Every permit and receipt kept with its history. Nothing is ever hard-deleted.'],
  [ICON.share, 'Proof in one link', 'Send a read-only compliance summary to a landlord, mall, franchisor or bank. Turn it off anytime.'],
  [ICON.download, 'Inspection-ready', 'Download every current document in one zip, with a summary page, when an inspector walks in.'],
  [ICON.briefcase, 'Rather not queue?', 'Request quotes from licensed liaison firms and accountants near you, straight from the permit that needs renewing.'],
];

const TEAMS = [
  ['head_office', ICON.building, 'Franchisors & chains', 'Every branch and franchisee on one board. Spot the store about to lapse before the city does, and remind them in one click.'],
  ['firm', ICON.briefcase, 'Accounting & bookkeeping firms', "Stop tracking clients' renewals in spreadsheets. Every client on one board, with one-click reminders."],
  ['property', ICON.grid, 'Malls & property managers', 'Tenants keep their permits current in PermitPal; you see who is compliant and download their shared copies.'],
  ['fleet', ICON.car, 'Fleet operators', "Every vehicle's registration, CTPL, emission test and inspection on one board. Import your whole fleet from a spreadsheet."],
];

export async function landing(app) {
  let plans = [];
  try { plans = await db.listPlans(); } catch { /* the page still works without prices */ }
  const price = (id) => plans.find((p) => p.id === id)?.price_php_monthly;
  app.innerHTML = String(html`
    <div class="landing">
      <header class="lp-top"><a class="brand" href="#/"><img src="img/logo.png" alt=""><span class="wordmark"><span class="w1">Permit</span><span class="w2">Pal</span></span></a>
        <div class="spacer"></div><a class="btn btn-ghost btn-sm" href="#teams" data-scroll>For teams</a><a class="btn btn-ghost btn-sm" href="#/login">Sign in</a><a class="btn btn-primary btn-sm" href="#/signup">Get started</a></header>

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
      <div class="lp-features">${FEATURES.map(([ic, t, d]) => html`<div class="card lp-feature">${ic}<b>${t}</b><p>${d}</p></div>`)}</div>

      <h2 class="lp-h2" id="teams">Responsible for more than one business?</h2>
      <p class="lp-sub">Team tools put everything you're accountable for on one board. 30-day free trial, no card needed.</p>
      <div class="lp-teams">${TEAMS.map(([id, ic, t, d]) => html`<section class="card lp-team">${ic}<h3>${t}</h3><p>${d}</p>
        <div class="lp-team-foot">${when(price(id), html`<span><b>₱${Number(price(id) || 0).toLocaleString()}</b> <small>/ month</small></span>`)}
          <a class="btn btn-primary btn-sm" href="#/signup?type=${id}">Start free trial</a></div></section>`)}</div>

      <section class="card lp-trust">
        <div><b>Private by default</b><p>Only your team sees your workspace. PermitPal staff never open your files.</p></div>
        <div><b>You decide who sees what</b><p>Franchisors, accountants and malls only see your permit status if you connect, and you can stop anytime.</p></div>
        <div><b>Nothing gets lost</b><p>Deleted items go to Trash, every change is logged, and you can export everything anytime.</p></div>
      </section>

      <section class="lp-final"><h2>Start keeping track today</h2><div class="btn-row lp-cta"><a class="btn btn-primary" href="#/signup">Create your free account</a><a class="btn btn-ghost" href="demo/">See the demo</a></div></section>
      <footer class="lp-foot"><span>© PermitPal</span><a href="privacy.html">Privacy</a><a href="terms.html">Terms</a><a href="#/contact">Contact</a><a href="#/login">Sign in</a></footer>
    </div>`);
  app.querySelector('[data-scroll]')?.addEventListener('click', (e) => { e.preventDefault(); document.getElementById('teams')?.scrollIntoView({ behavior: 'smooth' }); });
}
