// For service providers: liaison firms, accountants, fire-safety and pest-control companies, clinics.
// Plain about how it works and what it costs them, before they apply. No account needed.
import { html, toast, normalizePhone } from '../util.js';
import { PARTNER_CATEGORIES } from './extras.js';
import { has } from '../core.js';
import * as db from 'pp/data';

const HOW = [
  ['Businesses see you where they need you', 'On the permits and checklist steps that match what you do, in the cities you serve.'],
  ['They ask you for a quote', 'We email you their name, business, contact details and what they need, within minutes. You deal with them directly.'],
  ['You pay for what you get', 'A fee per quote request, or a flat monthly listing, agreed before you go live. No setup fee, and you can stop anytime.'],
];
const HOW_CREDIT = [
  HOW[0], HOW[1],
  ['Prepaid, so no bills', 'Buy credit upfront (for example ₱5,000). Each quote request uses its agreed fee, whether or not you get the job. When it runs low we tell you; at zero you pause until you top up.'],
  ['Bad lead? Report it', 'Spam, a duplicate, someone you couldn\'t reach, or not your service: report it within 7 days from the link in the email and, if we agree, the fee goes back on your credit. Or choose a flat monthly listing instead.'],
];

export function partnerApplyPage(el, { signedIn = false } = {}) {
  const wrap = (inner) => (signedIn ? inner : html`<main class="landing apply-page"><header class="lp-top"><a class="brand" href="#/"><img src="img/logo.png" alt=""><span class="wordmark"><span class="w1">Permit</span><span class="w2">Pal</span></span></a>
    <div class="spacer"></div><a class="btn btn-ghost btn-sm" href="#/login">Sign in</a></header>${inner}</main>`);
  el.innerHTML = String(wrap(html`
    <div class="page-head"><div><h1>List your firm on PermitPal</h1>
      <p class="muted">For liaison firms, accountants, fire-safety, pest-control and water-testing providers, clinics and notaries. Get quote requests from businesses whose permits are due.</p></div></div>
    <section class="card promises">${(has('leads') ? HOW_CREDIT : HOW).map(([t, d]) => html`<div class="promise"><div><b>${t}</b><span>${d}</span></div></div>`)}</section>
    <section class="card"><h2>Apply</h2>
      <p class="muted small">We reply within 3 business days.</p>
      <form id="apply-form" novalidate>
        <div class="grid2">
          <label class="field"><span>Firm name</span><input name="name" required maxlength="160" autocomplete="organization"></label>
          <label class="field"><span>What you do</span><select name="category" required><option value="">Choose one</option>
            ${Object.entries(PARTNER_CATEGORIES).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select></label>
          <label class="field"><span>Your name</span><input name="contact_name" required maxlength="120" autocomplete="name"></label>
          <label class="field"><span>Email</span><input name="email" type="email" required maxlength="160" autocomplete="email"></label>
          <label class="field"><span>Mobile <small>(optional)</small></span><input name="phone" maxlength="60" inputmode="tel" autocomplete="tel" placeholder="0917 123 4567"></label>
          <label class="field"><span>Cities you serve</span><input name="cities" maxlength="300" placeholder="e.g. Makati City, Taguig City, Pasig City"></label>
          <label class="field"><span>License or accreditation <small>(optional)</small></span><input name="licence" maxlength="200" placeholder="e.g. CPA, PRC no. 0123456; BFP accredited"></label>
          <label class="field"><span>Website <small>(optional)</small></span><input name="website" maxlength="300" placeholder="https://"></label>
        </div>
        <label class="field"><span>What you handle</span><input name="services" maxlength="600" placeholder="e.g. Mayor's Permit renewals, FSIC filing, extinguisher refills"></label>
        <label class="field"><span>Anything else? <small>(optional)</small></span><textarea name="message" rows="3" maxlength="1500"></textarea></label>
        ${has('property_s') ? html`<label class="check attest"><input type="checkbox" name="attested" required> <span>My business is registered (DTI, SEC or CDA) and holds every license and permit its work needs, and I'll keep them current. I understand PermitPal doesn't check this and customers rely on it.</span></label>` : ''}
        <label class="hp" aria-hidden="true">Leave this empty <input name="trap" tabindex="-1" autocomplete="off"></label>
        <p class="form-error" role="alert" hidden></p>
        <button class="btn btn-primary">Send application</button>
        <p class="muted small">We use these details only to review your application and contact you. <a href="privacy.html" target="_blank" rel="noopener">Privacy</a> · <a href="terms.html#partners" target="_blank" rel="noopener">How listings work</a></p>
      </form>
    </section>`));
  const form = el.querySelector('#apply-form');
  const err = form.querySelector('.form-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    const f = Object.fromEntries([...new FormData(form).entries()].map(([k, v]) => [k, String(v).trim()]));
    const fail = (m, field) => { err.textContent = m; err.hidden = false; if (field) form[field]?.focus(); };
    if (f.name.length < 2) return fail('Enter your firm\'s name.', 'name');
    if (!f.category) return fail('Choose what your firm does.', 'category');
    if (f.contact_name.length < 2) return fail('Enter your name.', 'contact_name');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) return fail('Enter a valid email address.', 'email');
    if (f.phone && !normalizePhone(f.phone)) return fail('Enter a valid mobile number, or leave it empty.', 'phone');
    if (f.website && !/^https:\/\//i.test(f.website)) return fail('The website must start with https://', 'website');
    if (form.attested && !form.attested.checked) return fail('Please confirm your business is registered and licensed.', 'attested');
    const btn = form.querySelector('button');
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      await db.applyAsPartner({ ...f, phone: f.phone ? normalizePhone(f.phone) : '', attested: form.attested ? form.attested.checked : undefined });
      form.closest('section').innerHTML = String(html`<h2>Thanks, we got it</h2><p>We'll reply to <b>${f.email}</b> within 3 business days.</p>
        <p class="muted small">Questions in the meantime? <a href="#/contact">Contact PermitPal</a>.</p>`);
      toast('Application sent.');
    } catch (ex) { btn.disabled = false; btn.textContent = 'Send application'; fail(ex.message || 'Something went wrong. Please try again.'); }
  });
}
