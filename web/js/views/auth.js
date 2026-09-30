// Log in, sign up, password reset, invitation landing page, and first-time workspace setup.
import { html, toast, toastError, formObject, friendlyError, when } from '../util.js';
import { GOOGLE_SIGN_IN } from '../config.js';
import * as db from 'pp/data';

const shell = (inner) => html`<div class="auth"><div class="auth-card">
  <img class="auth-logo" src="img/logo.png" alt="">
  <div class="wordmark"><span class="w1">Permit</span><span class="w2">Pal</span></div>
  ${inner}</div></div>`;

export function authPage(el, mode, ctx = {}) {
  const invite = ctx.invite;
  const inviteNote = invite ? html`<div class="banner info"><div><b>${invite.invited_by || 'Someone'}</b> invited you to <b>${invite.org_name}</b>.
    ${mode === 'signup' ? 'Create your account' : 'Log in'} with <b>${invite.email}</b> to join.</div></div>` : '';

  if (mode === 'signup') {
    el.innerHTML = String(shell(html`
      <p class="tagline">Every permit and registration you're responsible for, in one place — with reminders before anything expires.</p>
      ${inviteNote}
      <form id="auth-form">
        <div class="grid2"><label class="field"><span>First name</span><input name="first_name" required maxlength="80" autocomplete="given-name"></label>
        <label class="field"><span>Last name</span><input name="last_name" maxlength="80" autocomplete="family-name"></label></div>
        <label class="field"><span>Email</span><input type="email" name="email" required autocomplete="email" value="${invite?.email || ''}"></label>
        <label class="field"><span>Password <small>(at least 8 characters)</small></span><input type="password" name="password" required minlength="8" autocomplete="new-password"></label>
        <label class="check"><input type="checkbox" name="consent" required> I agree to the <a href="terms.html" target="_blank">Terms</a> and <a href="privacy.html" target="_blank">Privacy Policy</a>, and consent to PermitPal storing my business and vehicle documents.</label>
        <div class="form-error" hidden></div>
        <button class="btn btn-primary btn-block">Create account</button>
      </form>
      ${google()}
      <p class="switch-auth">Already have an account? <a href="#/login">Log in</a></p>`));
  } else if (mode === 'forgot') {
    el.innerHTML = String(shell(html`
      <p class="tagline">Enter your email and we'll send a link to set a new password.</p>
      <form id="auth-form"><label class="field"><span>Email</span><input type="email" name="email" required autocomplete="email"></label>
        <div class="form-error" hidden></div><button class="btn btn-primary btn-block">Send reset link</button></form>
      <p class="switch-auth"><a href="#/login">Back to log in</a></p>`));
  } else if (mode === 'reset') {
    el.innerHTML = String(shell(html`
      <p class="tagline">Choose a new password.</p>
      <form id="auth-form"><label class="field"><span>New password</span><input type="password" name="password" required minlength="8" autocomplete="new-password"></label>
        <div class="form-error" hidden></div><button class="btn btn-primary btn-block">Save password</button></form>`));
  } else if (mode === 'check-email') {
    el.innerHTML = String(shell(html`<h2>Check your email</h2>
      <p class="tagline">We sent a confirmation link to <b>${ctx.email}</b>. Open it on this device to finish signing up. It can take a minute — check spam too.</p>
      <p class="switch-auth"><a href="#/login">Back to log in</a></p>`));
    return;
  } else {
    el.innerHTML = String(shell(html`
      <p class="tagline">One place for every permit and registration you're responsible for.</p>
      ${inviteNote}
      <form id="auth-form">
        <label class="field"><span>Email</span><input type="email" name="email" required autocomplete="email" value="${invite?.email || ''}"></label>
        <label class="field"><span>Password</span><input type="password" name="password" required autocomplete="current-password"></label>
        <a class="forgot" href="#/forgot">Forgot password?</a>
        <div class="form-error" hidden></div>
        <button class="btn btn-primary btn-block">Log in</button>
      </form>
      ${google()}
      <p class="switch-auth">New to PermitPal? <a href="#/signup">Create an account</a></p>
      <p class="switch-auth"><a href="demo/">Look around the demo first</a> · sample data, no sign-up</p>`));
  }

  const form = el.querySelector('#auth-form');
  const err = el.querySelector('.form-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    const btn = form.querySelector('button');
    btn.disabled = true;
    const f = formObject(new FormData(form));
    try {
      if (mode === 'signup') {
        const res = await db.auth.signUp(f.email.toLowerCase(), f.password, f.first_name, f.last_name);
        if (!res.session) { authPage(el, 'check-email', { email: f.email }); return; }
      } else if (mode === 'forgot') {
        await db.auth.sendReset(f.email.toLowerCase());
        toast('If that email has an account, a reset link is on its way.');
        location.hash = '#/login';
      } else if (mode === 'reset') {
        await db.auth.setPassword(f.password);
        window.dispatchEvent(new Event('pp-password-updated'));
        toast('Password updated.');
        location.hash = '#/';
      } else {
        await db.auth.signIn(f.email.toLowerCase(), f.password);
      }
    } catch (ex) {
      err.textContent = /Invalid login/i.test(ex.message) ? 'Wrong email or password.'
        : /Email not confirmed/i.test(ex.message) ? 'Please confirm your email first — check your inbox for the link.'
        : /already registered/i.test(ex.message) ? 'That email already has an account. Log in instead.'
        : friendlyError(ex);
      err.hidden = false;
    }
    btn.disabled = false;
  });
  el.querySelector('[data-google]')?.addEventListener('click', async () => { try { await db.auth.google(); } catch (e) { toastError(e); } });
}

function google() {
  return when(GOOGLE_SIGN_IN, html`<div class="divider">or</div><button type="button" class="btn btn-ghost btn-block" data-google>Continue with Google</button>`);
}

export async function invitePage(el, token, loggedIn) {
  let inv = null;
  try { inv = await db.invitePreview(token); } catch (e) { toastError(e); }
  if (!inv || inv.status !== 'pending') {
    el.innerHTML = String(shell(html`<h2>Invitation ${inv ? inv.status : 'not found'}</h2>
      <p class="tagline">${inv?.status === 'accepted' ? 'This invitation was already used.' : 'Ask the person who invited you for a new link.'}</p>
      <a class="btn btn-primary btn-block" href="#/">Go to PermitPal</a>`));
    return null;
  }
  sessionStorageSet('pp-invite', token);
  if (!loggedIn) { authPage(el, 'signup', { invite: inv }); return inv; }
  return inv;
}

export function onboarding(el, profile, onDone) {
  el.innerHTML = String(shell(html`
    <h2>Set up your workspace</h2>
    <p class="tagline">A workspace holds your businesses, vehicles and team. Use your company name — you can add more businesses inside it.</p>
    <form id="ob-form">
      ${when(!profile.first_name, html`<label class="field"><span>Your first name</span><input name="first_name" required maxlength="80"></label>`)}
      <label class="field"><span>Workspace name</span><input name="name" required maxlength="120" placeholder="e.g. Aligned Solutions Inc."></label>
      <div class="form-error" hidden></div>
      <button class="btn btn-primary btn-block">Continue</button>
    </form>
    <p class="switch-auth"><a href="#" data-act="sign-out">Sign out</a></p>`));
  const form = el.querySelector('#ob-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = formObject(new FormData(form));
    try {
      if (f.first_name) await db.updateProfile(profile.id, { first_name: f.first_name });
      await db.createOrg(f.name);
      onDone();
    } catch (ex) { const er = el.querySelector('.form-error'); er.textContent = friendlyError(ex); er.hidden = false; }
  });
}

export function sessionStorageSet(k, v) { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } }
export function sessionStorageTake(k) { try { const v = sessionStorage.getItem(k); sessionStorage.removeItem(k); return v; } catch { return null; } }
