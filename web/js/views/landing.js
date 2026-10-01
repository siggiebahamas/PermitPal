// What a visitor sees before signing in: what PermitPal does, the done-for-you services with
// starting prices (read live from the catalog), and how to start.
import { html, peso, when } from '../util.js';
import { ICON } from '../components.js';
import * as db from 'pp/data';

const FEATURES = [
  [ICON.calendar, 'Every deadline in one place', "Business permits, vehicle registration and staff licences, each with its own month-by-month timeline."],
  [ICON.bell, 'Reminders before anything expires', 'Email reminders 30, 7 and 1 day before, then weekly while overdue. A weekly summary every Monday.'],
  [ICON.file, 'Your documents, safe for years', 'Every permit and receipt kept with its history. Nothing is ever hard-deleted, and a backup runs every night.'],
  [ICON.briefcase, 'We can renew it for you', 'Ask for a quote in two taps. Track every step, pay by GCash or bank transfer, and the new permit is saved for you.'],
  [ICON.share, 'Proof in one link', 'Send a read-only compliance summary to a landlord, mall, franchisor or bank. Turn it off anytime.'],
  [ICON.download, 'Inspection-ready', 'Download every current document in one zip, with a summary page, when an inspector walks in.'],
  [ICON.peso, 'Know what January will cost', 'Track what each renewal cost and see what is coming month by month.'],
  [ICON.grid, 'For accountants and consultants', 'Run a workspace per client and see all of them at a glance.'],
];

export async function landing(app) {
  let services = [];
  try { services = await db.listServices(); } catch { /* the page still works without prices */ }
  const shown = services.filter((s) => ['renewal', 'plan', 'package'].includes(s.category)).slice(0, 6);
  app.innerHTML = String(html`
    <div class="landing">
      <header class="lp-top"><a class="brand" href="#/"><img src="img/logo.png" alt=""><span class="wordmark"><span class="w1">Permit</span><span class="w2">Pal</span></span></a>
        <div class="spacer"></div><a class="btn btn-ghost btn-sm" href="#/login">Sign in</a><a class="btn btn-primary btn-sm" href="#/signup">Get started</a></header>

      <section class="lp-hero">
        <h1>Never miss a permit renewal again.</h1>
        <p>PermitPal keeps every business permit, vehicle registration and staff licence in one place, reminds you before anything expires, and can renew them for you.</p>
        <div class="btn-row lp-cta"><a class="btn btn-primary" href="#/signup">Start free</a><a class="btn btn-ghost" href="demo/">See the demo</a></div>
        <p class="muted small">Free during launch: unlimited businesses, vehicles and team members.</p>
      </section>

      <section class="lp-steps card">
        ${[['1', 'Add your businesses and vehicles', "We build each one's permit checklist: Mayor's Permit, Barangay Clearance, FSIC, LTO registration and more."],
          ['2', 'Add dates and documents', 'Snap or upload each permit and enter its expiry date. Your dashboard tells you what to do first.'],
          ['3', 'Renew on time, or let us do it', "Get reminders, or ask PermitPal for a quote and we'll handle the queue for you."]]
          .map(([n, t, d]) => html`<div class="lp-step"><span>${n}</span><div><b>${t}</b><p>${d}</p></div></div>`)}
      </section>

      <h2 class="lp-h2">Everything you need to stay compliant</h2>
      <div class="lp-features">${FEATURES.map(([ic, t, d]) => html`<div class="card lp-feature">${ic}<b>${t}</b><p>${d}</p></div>`)}</div>

      ${when(shown.length, html`<h2 class="lp-h2">Done-for-you services</h2>
        <p class="lp-sub">Exact quote first. Government fees at cost, with official receipts. Track every step.</p>
        <div class="svc-grid">${shown.map((s) => html`<section class="card svc"><div class="svc-top"><h2>${s.name}</h2>
          <div class="svc-price"><b>${s.price_from == null ? 'Quoted' : 'From ' + peso(s.price_from)}</b><small>${s.price_unit}</small></div></div>
          <p class="svc-sum">${s.summary}</p></section>`)}</div>`)}

      <section class="card lp-trust">
        <div><b>Private by default</b><p>Only your team can see your workspace. PermitPal staff see a permit's files only while you have an open request for it.</p></div>
        <div><b>Nothing gets lost</b><p>Deleted items go to Trash, every change is logged, and an encrypted backup runs every night.</p></div>
        <div><b>No fixers</b><p>We work with your written authorization and pay only official fees, with receipts. We never pay anyone to speed things up.</p></div>
      </section>

      <section class="lp-final"><h2>Start keeping track today</h2><div class="btn-row lp-cta"><a class="btn btn-primary" href="#/signup">Create your free account</a><a class="btn btn-ghost" href="demo/">See the demo</a></div></section>
      <footer class="lp-foot"><span>© PermitPal</span><a href="privacy.html">Privacy</a><a href="terms.html">Terms</a><a href="#/login">Sign in</a></footer>
    </div>`);
}
