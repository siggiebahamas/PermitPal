// A firm's page for one quote request, opened from the link in the lead email. No account needed: the
// link is the key. It shows what the request was and what it cost, and lets the firm report a bad lead
// within 7 days (staff decide; an accepted report puts the fee back on their credit).
import { html, fmtDate, peso, toast } from '../util.js';
import * as db from 'pp/data';

const REASONS = [
  ['spam', 'Spam or a fake business', ''],
  ['duplicate', 'A duplicate', 'They already asked us directly, or through PermitPal, for the same thing.'],
  ['unreachable', "We couldn't reach them", 'We tried at least 3 times over 2 days by the contact they gave.'],
  ['not_our_service', "It's not something we do", 'Or it is outside the cities we serve.'],
];
const REASON_NAME = Object.fromEntries(REASONS.map(([k, t]) => [k, t]));
const day = (ts) => fmtDate(String(ts).slice(0, 10));

export async function leadPage(el, token, { signedIn = false } = {}) {
  const wrap = (inner) => (signedIn ? inner : html`<main class="landing lead-page"><header class="lp-top"><a class="brand" href="#/"><img src="img/logo.png" alt=""><span class="wordmark"><span class="w1">Permit</span><span class="w2">Pal</span></span></a>
    <div class="spacer"></div></header>${inner}</main>`);
  el.innerHTML = String(wrap(html`<div class="loading">Loading…</div>`));
  let l = null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token || '')) l = await db.leadForFirm(token).catch(() => null);
  if (!l) {
    el.innerHTML = String(wrap(html`<div class="page-head"><div><h1>Quote request</h1></div></div>
      <section class="card"><p>This link isn't valid. Open the full link from the PermitPal email, or reply to that email and we'll help.</p></section>`));
    return;
  }
  const d = l.dispute;
  const status = d ? html`<section class="card lead-status ${d.status}">
      ${d.status === 'open' ? html`<h2>You reported this request</h2><p>As: <b>${REASON_NAME[d.reason] || d.reason}</b>. We'll email you our decision within 2 business days.</p>`
        : d.status === 'accepted' ? html`<h2>Report accepted</h2><p>${Number(d.credited) > 0 ? html`<b>${peso(d.credited)}</b> is back on your PermitPal credit.` : 'Thank you for telling us.'}</p>`
        : html`<h2>Report not accepted</h2><p>${d.note || ''}</p><p class="muted small">Questions? Reply to the email we sent you.</p>`}</section>`
    : l.can_report ? html`<section class="card"><h2>Not a real lead?</h2>
      <p class="muted">Report it by <b>${day(l.report_until)}</b>${Number(l.fee) > 0 ? ' and, if we agree, the fee goes back on your credit' : ''}. We check every report.</p>
      <form id="lead-report" novalidate>
        <fieldset class="lead-reasons"><legend class="sr-only">Reason</legend>
          ${REASONS.map(([k, t, sub]) => html`<label class="check"><input type="radio" name="reason" value="${k}"><span><b>${t}</b>${sub ? html`<small class="muted">${sub}</small>` : ''}</span></label>`)}
        </fieldset>
        <label class="field"><span>What happened? <small>(optional)</small></span><textarea name="note" rows="3" maxlength="500"></textarea></label>
        <p class="form-error" role="alert" hidden></p>
        <button class="btn btn-primary">Report this lead</button>
      </form></section>`
    : html`<section class="card"><p>The 7-day window to report this request ended on ${day(l.report_until)}.</p></section>`;
  el.innerHTML = String(wrap(html`
    <div class="page-head"><div><p class="cx-eyebrow">${l.firm}</p><h1>Quote request from ${l.business}</h1>
      <p class="muted">${l.permit ? l.permit + ' · ' : ''}Sent ${day(l.sent_at)}${Number(l.fee) > 0 ? ` · ${peso(l.fee)} from your PermitPal credit` : ''}</p></div></div>
    ${status}
    <p class="muted small fineprint">A quote request uses its fee when we send it to you, whether or not you get the job. We only charge for requests sent through PermitPal.</p>`));
  const form = el.querySelector('#lead-report');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const err = form.querySelector('.form-error');
    const btn = form.querySelector('button');
    err.hidden = true;
    if (!fd.get('reason')) { err.textContent = 'Choose a reason.'; err.hidden = false; return; }
    btn.disabled = true;
    try {
      await db.reportLead(token, fd.get('reason'), String(fd.get('note') || '').trim());
      toast("Reported. We'll email you our decision.");
      leadPage(el, token, { signedIn });
    } catch (ex) { err.textContent = ex.message || 'Something went wrong.'; err.hidden = false; btn.disabled = false; }
  });
}
