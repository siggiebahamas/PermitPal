// "Contact PermitPal": questions, problems, plan and payment questions, and privacy requests
// (the Data Protection Officer reads these). Works signed in, or signed out for people without an
// account (e.g. staff whose licence details an employer added). The message is emailed to the team.
import { html, when } from '../util.js';
import { S } from '../core.js';
import { friendlyError } from '../util.js';
import * as db from 'pp/data';

const TOPICS = [
  ['question', 'A question about PermitPal'],
  ['problem', 'Something is not working'],
  ['billing', 'Plans & payment'],
  ['privacy', 'Privacy / my data (Data Protection Officer)'],
  ['other', 'Something else'],
];

export function contactPage(el, { signedIn = !!S.user } = {}) {
  const topic = new URLSearchParams(location.hash.split('?')[1] || '').get('topic') || 'question';
  const body = html`
    <form id="contact-form" class="contact-form">
      ${when(!signedIn, html`<div class="grid2">
        <label class="field"><span>Your name</span><input name="name" maxlength="120" autocomplete="name"></label>
        <label class="field"><span>Your email <small>(so we can reply)</small></span><input type="email" name="email" required maxlength="200" autocomplete="email"></label></div>`)}
      <label class="field"><span>What is it about?</span><select name="topic">${TOPICS.map(([k, l]) => html`<option value="${k}" ${k === topic ? 'selected' : ''}>${l}</option>`)}</select></label>
      <label class="field"><span>Message</span><textarea name="message" rows="6" maxlength="4000" required placeholder="Tell us what you need. For a problem, say which page and what you clicked."></textarea></label>
      <div class="form-error" hidden></div>
      <button class="btn btn-primary">Send message</button>
    </form>
    <div class="contact-done" hidden>
      <h2>Message sent</h2>
      <p>Thanks. We reply by email within 1 business day${signedIn ? html`, to <b>${S.user?.email || 'your account email'}</b>` : ''}.</p>
      ${signedIn ? html`<a class="btn btn-ghost" href="#/">Back to dashboard</a>` : html`<a class="btn btn-ghost" href="#/">Back to PermitPal</a>`}
    </div>`;
  el.innerHTML = String(signedIn
    ? html`<div class="page-head"><div><h1>Contact PermitPal</h1><p class="muted">Questions, problems, plans and payment, or a request about your personal data.</p></div></div>
        <section class="card contact-card">${body}</section>`
    : html`<div class="auth"><div class="auth-card contact-public">
        <a href="#/"><img class="auth-logo" src="img/logo.png" alt="PermitPal"></a>
        <h1>Contact PermitPal</h1>
        <p class="tagline">Questions, problems, or a request about your personal data. Our Data Protection Officer reads privacy messages.</p>
        ${body}
        <p class="switch-auth"><a href="#/">Back to PermitPal</a></p></div></div>`);

  const form = el.querySelector('#contact-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const err = form.querySelector('.form-error');
    const btn = form.querySelector('button');
    err.hidden = true; btn.disabled = true; btn.textContent = 'Sending…';
    try {
      await db.contactSupport({ topic: fd.get('topic'), message: String(fd.get('message') || ''), name: fd.get('name'), email: fd.get('email'), orgId: S.org?.id });
      form.hidden = true;
      el.querySelector('.contact-done').hidden = false;
    } catch (ex) {
      err.textContent = friendlyError(ex); err.hidden = false;
    } finally { btn.disabled = false; btn.textContent = 'Send message'; }
  });
}
