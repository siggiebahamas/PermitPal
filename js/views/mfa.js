// Two-step login: after the password, a 6-digit code from an authenticator app on the person's phone,
// so a stolen or guessed password isn't enough. Setting it up, the code screen at sign-in, extra devices,
// owners requiring it for a workspace, and what to do about a lost phone, all in plain words.
import { html, toast, toastError, openModal, confirmDialog, fmtDate, when, plural } from '../util.js?v=fd3a394';
import { S, on, rerender, isOwner, has } from '../core.js?v=fd3a394';
import { ICON } from '../components.js?v=fd3a394';
import * as db from 'pp/data';

const codeHelp = "Codes change every 30 seconds: type the newest one. If it still doesn't work, check that your phone's date and time are set automatically.";
const friendly = (e) => (/invalid|totp|code|challenge/i.test(e?.message || '') ? `That code didn't work. ${codeHelp}` : e?.message || 'Something went wrong.');
const grouped = (secret) => String(secret || '').replace(/(.{4})/g, '$1 ').trim();
const cleanCode = (v) => String(v || '').replace(/\D/g, '');

// ---------------------------------------------------------------- the code screen at sign-in
export async function mfaChallenge(app, done) {
  let factors = [];
  try { factors = (await db.mfa.factors()).totp || []; } catch (e) { toastError(e); }
  app.innerHTML = String(html`<main class="auth"><div class="auth-card">
    <h1 class="auth-title">Two-step login</h1>
    <p class="tagline">Open your authenticator app and type the 6-digit code it shows for Pinoy Permit.</p>
    <form id="mfa-form" novalidate>
      ${when(factors.length > 1, html`<label class="field"><span>Which device?</span><select name="factor">${factors.map((f) => html`<option value="${f.id}">${f.friendly_name || 'Authenticator'}</option>`)}</select></label>`)}
      <label class="field"><span>6-digit code</span><input name="code" class="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required placeholder="123456" autofocus></label>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-block">Continue</button>
    </form>
    <details class="lost"><summary>Lost your phone, or no code?</summary>
      <p>${factors.length > 1 ? 'Choose your other device above and use its code. ' : ''}If you can't get a code, contact Pinoy Permit support. After we confirm it's really you, we turn two-step login off so you can sign in with your password and set it up again (usually within 1 business day).</p>
      <button type="button" class="btn btn-soft btn-block" data-act="mfa-lost">Sign out and contact support</button></details>
    <button type="button" class="btn btn-ghost btn-block" data-act="sign-out">Sign out</button>
  </div></main>`);
  const form = app.querySelector('#mfa-form');
  const err = form.querySelector('.form-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = cleanCode(form.code.value);
    err.hidden = true;
    if (code.length !== 6) { err.textContent = 'Type the 6-digit code from your authenticator app.'; err.hidden = false; return; }
    const btn = form.querySelector('button');
    btn.disabled = true; btn.textContent = 'Checking…';
    try {
      await db.mfa.verify(form.factor?.value || factors[0]?.id, code);
      await done();
    } catch (ex) {
      err.textContent = friendly(ex); err.hidden = false;
      btn.disabled = false; btn.textContent = 'Continue';
      form.code.select();
    }
  });
}
on('mfa-lost', async () => { await db.auth.signOut(); location.hash = '#/contact'; location.reload(); });

// ---------------------------------------------------------------- a workspace requires it, and they haven't set it up
export function mfaRequired(app, locked, { onDone, onSkip }) {
  const names = locked.map((o) => o.name).join(', ');
  app.innerHTML = String(html`<main class="auth"><div class="auth-card">
    <h1 class="auth-title">Set up two-step login</h1>
    <p class="tagline"><b>${names}</b> ${locked.length === 1 ? 'requires' : 'require'} two-step login. It takes about 2 minutes: you'll need your phone.</p>
    <button class="btn btn-primary btn-block" data-act="mfa-setup-now">Set it up now</button>
    ${when(onSkip, html`<button class="btn btn-ghost btn-block" data-act="mfa-skip">Not now: open my other workspace</button>`)}
    <button class="btn btn-ghost btn-block" data-act="sign-out">Sign out</button>
  </div></main>`);
  pendingDone = onDone; pendingSkip = onSkip;
}
let pendingDone = null, pendingSkip = null;
on('mfa-setup-now', () => startSetup({ onDone: () => pendingDone?.() }));
on('mfa-skip', () => pendingSkip?.());

// ---------------------------------------------------------------- setting it up (also adds a second device)
export async function startSetup({ onDone, second = false } = {}) {
  let enrolled;
  try {
    // Leftovers from a setup that was never finished get in the way: clear them first.
    const all = (await db.mfa.factors()).all || [];
    for (const f of all.filter((x) => x.status !== 'verified')) await db.mfa.unenroll(f.id).catch(() => {});
    const n = all.filter((x) => x.status === 'verified').length;
    enrolled = await db.mfa.enroll(n ? `Device ${n + 1} (${new Date().toLocaleDateString('en-PH')})` : `Phone (${new Date().toLocaleDateString('en-PH')})`);
  } catch (e) { return toastError(e); }
  let finished = false;
  openModal(second ? 'Add another device' : 'Turn on two-step login', html`
    <ol class="mfa-steps">
      <li><b>Get an authenticator app</b> on ${second ? 'the other phone or tablet' : 'your phone'}, if you don't have one: Google Authenticator or Microsoft Authenticator (both free).</li>
      <li><b>In the app, add an account</b> and scan this code:
        <div class="qr"><img src="${enrolled.totp.qr_code}" alt="QR code for your authenticator app" width="200" height="200"></div>
        <small class="muted">Can't scan it? Choose "enter a setup key" in the app and type: <code class="secret">${grouped(enrolled.totp.secret)}</code>
          <button type="button" class="linklike" data-copy="${enrolled.totp.secret}">Copy</button></small></li>
      <li><b>Type the 6-digit code</b> the app now shows for Pinoy Permit:
        <input name="code" class="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required placeholder="123456" aria-label="6-digit code from the app"></li>
    </ol>
    <p class="muted small">Keep the key private: anyone with it can make your codes.</p>`, {
    submitLabel: 'Turn on',
    onOpen: (form) => {
      form.querySelector('[data-copy]').addEventListener('click', async (e) => {
        try { await navigator.clipboard.writeText(e.target.dataset.copy); toast('Key copied.'); } catch { toast('Select the key and copy it.', 'info'); }
      });
      // Closed without finishing: remove the half-made setup so it doesn't block the next try.
      const obs = new MutationObserver(() => {
        if (!document.body.contains(form)) { obs.disconnect(); if (!finished) db.mfa.unenroll(enrolled.id).catch(() => {}); }
      });
      obs.observe(document.getElementById('modal-root'), { childList: true });
    },
    onSubmit: async (fd) => {
      const code = cleanCode(fd.get('code'));
      if (code.length !== 6) throw new Error('Type the 6-digit code from the app.');
      try { await db.mfa.verify(enrolled.id, code); } catch (e) { throw new Error(friendly(e)); }
      finished = true;
      toast(second ? 'Device added. Either one can give you codes now.' : 'Two-step login is on. Next time you sign in, we will ask for a code.');
      await onDone?.();
    },
  });
}

// ---------------------------------------------------------------- Settings section
export async function mfaSection(slot) {
  if (!has('mfa') || !slot) return;
  let factors = [];
  try { factors = ((await db.mfa.factors()).totp || []).filter((f) => f.status === 'verified'); } catch { /* shown as off */ }
  if (!document.body.contains(slot)) return;
  slot.innerHTML = String(html`<h2>Two-step login</h2>
    ${factors.length
      ? html`<p class="mfa-on">${ICON.check} <b>On.</b> After your password, we ask for a code from ${factors.length === 1 ? 'this device' : 'one of these devices'}:</p>
        ${factors.map((f) => html`<div class="line"><span class="line-main"><b>${f.friendly_name || 'Authenticator'}</b><small>Added ${fmtDate(String(f.created_at).slice(0, 10))}</small></span>
          <button class="btn btn-sm btn-ghost danger" data-act="mfa-remove" data-id="${f.id}" data-last="${factors.length === 1 ? '1' : ''}">Remove</button></div>`)}
        ${when(factors.length === 1, html`<p class="banner info"><span><b>Add a second device</b> (another phone or a tablet) so losing one phone doesn't lock you out.</span></p>`)}
        <div class="btn-row"><button class="btn btn-soft btn-sm" data-act="mfa-add">${factors.length === 1 ? 'Add a second device' : 'Add another device'}</button></div>`
      : html`<p class="muted">Off. Turn it on and, after your password, we'll also ask for a 6-digit code from an app on your phone. Then a stolen or guessed password isn't enough to get in.</p>
        <button class="btn btn-primary btn-sm" data-act="mfa-on">Turn on two-step login</button>`}`);
}
const refresh = () => mfaSection(document.getElementById('mfa-section'));
on('mfa-on', () => startSetup({ onDone: refresh }));
on('mfa-add', () => startSetup({ second: true, onDone: refresh }));
on('mfa-remove', async (ds) => {
  const last = !!ds.last;
  const required = (S.orgs || []).filter((o) => o.require_mfa).map((o) => o.name);
  const msg = last
    ? `Two-step login turns off: your password alone will get you in.${required.length ? ` ${required.join(', ')} ${required.length === 1 ? 'requires' : 'require'} it, so you'll be asked to set it up again to open ${required.length === 1 ? 'it' : 'them'}.` : ''}`
    : 'That device will no longer give you codes. Your other device still works.';
  if (!(await confirmDialog(last ? 'Turn off two-step login?' : 'Remove this device?', msg, { confirmLabel: last ? 'Turn off' : 'Remove' }))) return;
  try { await db.mfa.unenroll(ds.id); toast(last ? 'Two-step login is off.' : 'Device removed.'); refresh(); } catch (e) { toastError(e); }
});

// ---------------------------------------------------------------- owners: require it for the workspace
export function requireCard() {
  if (!has('mfa') || !isOwner()) return '';
  const on_ = !!S.org.require_mfa;
  return html`<section class="card"><h2>Require two-step login</h2>
    <p class="muted small">${on_ ? `Everyone needs an authenticator code to open ${S.org.name}.` : `When this is on, everyone on the team needs a code from an authenticator app (not just a password) to open ${S.org.name}.`}</p>
    <label class="toggle"><div><div>Require two-step login for everyone</div><div class="muted small">People without it are asked to set it up the next time they open the workspace.</div></div>
      <input type="checkbox" data-act-change="require-mfa" ${on_ ? 'checked' : ''}></label></section>`;
}
document.addEventListener('change', async (e) => {
  if (e.target?.dataset?.actChange !== 'require-mfa') return;
  const box = e.target;
  const want = box.checked;
  box.checked = !want; // only flips once it's saved
  if (want) {
    const mine = ((await db.mfa.factors().catch(() => ({}))).totp || []).filter((f) => f.status === 'verified');
    if (!mine.length) {
      if (await confirmDialog('Set it up for yourself first', 'So you are never locked out of your own workspace, turn on two-step login for yourself first. It takes about 2 minutes.', { confirmLabel: 'Set it up now', danger: false })) {
        startSetup({ onDone: refresh });
      }
      return;
    }
    if (!(await confirmDialog(`Require two-step login in ${S.org.name}?`, `Everyone on the team (${plural((S.data?.members || []).length, 'person', 'people')}) will need an authenticator app to open it. We'll tell them now.`, { confirmLabel: 'Require it', danger: false }))) return;
  }
  try {
    await db.setRequireMfa(S.org.id, want);
    S.org.require_mfa = want;
    box.checked = want;
    toast(want ? 'Done. Everyone now needs two-step login to open this workspace.' : 'Two-step login is no longer required here.');
  } catch (err) { toastError(err); }
});
