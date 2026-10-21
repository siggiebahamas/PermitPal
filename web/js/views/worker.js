// A worker's own page for sending a renewed license (opened from the reminder email or a link HR sent
// by Viber, SMS or email). No account: the link is the key, works once, and only for that license.
// They add a photo and the new dates; the business checks it before it counts.
import { html, fmtDate, toast } from '../util.js';
import { scanBox, wireScan } from './scan.js';
import * as db from 'pp/data';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function workerPage(el, token, { signedIn = false } = {}) {
  const wrap = (inner) => (signedIn ? inner : html`<main class="landing worker-page"><header class="lp-top"><span class="brand"><img src="img/logo.png" alt=""><span class="wordmark"><span class="w1">Permit</span><span class="w2">Pal</span></span></span>
    <div class="spacer"></div></header>${inner}</main>`);
  el.innerHTML = String(wrap(html`<div class="loading">Loading…</div>`));
  let w = null;
  if (UUID.test(token || '')) w = await db.workerPage(token).catch(() => null);
  const msg = (title, text) => { el.innerHTML = String(wrap(html`<div class="page-head"><div><h1>${title}</h1></div></div><section class="card"><p>${text}</p></section>`)); };
  if (!w || w.state === 'invalid') return msg('Send your renewed license', "This link isn't valid. Ask your employer to send it again.");
  if (w.state === 'sent') return msg('Already sent', `Your ${w.permit} was sent to ${w.org_name}. They'll check it. Thank you!`);
  if (w.state === 'expired') return msg('This link has expired', `Ask ${w.org_name} for a new link to send your ${w.permit}.`);
  el.innerHTML = String(wrap(html`
    <div class="page-head"><div><h1>Hi ${w.first_name}!</h1>
      <p class="muted">${w.org_name} asked for a photo of your renewed <b>${w.permit}</b>${w.expires_on ? html` (the one on file expires ${fmtDate(w.expires_on)})` : ''}.</p></div></div>
    <section class="card"><form id="worker-form" novalidate>
      ${scanBox()}
      <label class="field"><span>Photo of the new license</span><input type="file" name="file" accept="image/*,.pdf" capture="environment" required></label>
      <div class="grid2">
        ${w.expires ? html`<label class="field"><span>New expiry date</span><input type="date" name="expires_on" min="${w.today}" required></label>` : ''}
        <label class="field"><span>Date issued <small>(optional)</small></span><input type="date" name="issued_on" max="${w.today}"></label>
      </div>
      <label class="field"><span>License number <small>(optional)</small></span><input name="reference_no" maxlength="100"></label>
      <label class="field"><span>Message <small>(optional)</small></span><input name="note" maxlength="300" placeholder="e.g. Renewed at the city health office"></label>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-block">Send to ${w.org_name}</button>
      <p class="muted small">Only ${w.org_name} sees it. They check it before it's saved. This link works once.</p>
    </form></section>`));
  const form = el.querySelector('#worker-form');
  wireScan(form, { fields: { expires_on: 'expires', issued_on: 'issued', reference_no: 'reference' }, attach: 'file' });
  const err = form.querySelector('.form-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    const fd = new FormData(form);
    const file = fd.get('file');
    const f = { file, expires_on: fd.get('expires_on') || null, issued_on: fd.get('issued_on') || null, reference_no: String(fd.get('reference_no') || '').trim(), note: String(fd.get('note') || '').trim() };
    const fail = (m) => { err.textContent = m; err.hidden = false; };
    if (!(file && file.size)) return fail('Add a photo of the new license.');
    if (w.expires && !f.expires_on) return fail("Enter the new expiry date (it's printed on the license).");
    if (f.issued_on && f.expires_on && f.issued_on > f.expires_on) return fail('The date issued is after the expiry date. Please check both.');
    if (form.querySelector('[name=scan_ok]') && !form.querySelector('[name=scan_ok]').checked) return fail('Tick the box to say you checked the filled-in details against the license.');
    const btn = form.querySelector('button.btn-primary');
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      await db.workerSend(w, token, f);
      el.innerHTML = String(wrap(html`<div class="page-head"><div><h1>Sent. Thank you, ${w.first_name}!</h1></div></div>
        <section class="card"><p>${w.org_name} will check your ${w.permit} and update their records. You can close this page.</p></section>`));
      toast('Sent.');
    } catch (e2) {
      fail(e2.message || 'Something went wrong. Please try again.');
      btn.disabled = false; btn.textContent = `Send to ${w.org_name}`;
    }
  });
}
