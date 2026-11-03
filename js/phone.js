// Reminders on the phone, made as simple as possible: put Pinoy Permit on the home screen (one tap on Android, three
// pictured taps on iPhone), then one big button to turn on alerts. It knows the phone, so it only ever shows the
// steps for that phone. Database file 22 does the sending (feature "push").
import { html, raw, toast, toastError, openModal, closeModal } from './util.js?v=199b984';
import { on, has, rerender } from './core.js?v=199b984';
import * as db from 'pp/data';

const ua = () => navigator.userAgent || '';
export const isIOS = () => /iPhone|iPad|iPod/.test(ua()) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isAndroid = () => /Android/.test(ua());
export const isPhone = () => isIOS() || isAndroid();
const iosSafari = () => isIOS() && !/CriOS|FxiOS|EdgiOS|GSA\//.test(ua());
export const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
// Tests swap the browser's push service for a stand-in (globalThis.__ppPush); everyone else gets the real one.
const api = () => globalThis.__ppPush || realPush;
const realPush = {
  supported: () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
  permission: () => (window.Notification ? Notification.permission : 'denied'),
  ask: () => Notification.requestPermission(),
  async current() { const r = await navigator.serviceWorker?.getRegistration(); return r ? r.pushManager.getSubscription() : null; },
  async subscribe(key) {
    const r = await navigator.serviceWorker.register('sw.js'); await navigator.serviceWorker.ready;
    return r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(key) });
  },
};
const b64uToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

// Android's own "Install app" prompt, kept for our big button.
let installPrompt = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });
addEventListener('appinstalled', () => { installPrompt = null; try { localStorage.setItem('pp-installed', '1'); } catch { /* fine */ } });

export function registerWorker() {
  if (globalThis.PP_DEMO || !('serviceWorker' in navigator) || !/^https:|^http:\/\/localhost/.test(location.href)) return;
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Is this phone getting alerts? (checked once per visit, then remembered)
let state = null; // 'on' | 'off' | 'blocked' | 'unsupported'
export async function alertState(force = false) {
  if (state && !force) return state;
  const p = api();
  if (!p.supported()) state = 'unsupported';
  else if (p.permission() === 'denied') state = 'blocked';
  else state = (await p.current().catch(() => null)) && p.permission() === 'granted' ? 'on' : 'off';
  return state;
}

// ---------------------------------------------------------------- pictures
const I = {
  share: raw('<svg viewBox="0 0 24 24" class="ph-ic"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>'),
  plus: raw('<svg viewBox="0 0 24 24" class="ph-ic"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/></svg>'),
  dots: raw('<svg viewBox="0 0 24 24" class="ph-ic"><circle cx="12" cy="5" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="19" r="1.6" fill="currentColor"/></svg>'),
  phone: raw('<svg viewBox="0 0 24 24" class="ph-ic"><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/></svg>'),
  bell: raw('<svg viewBox="0 0 24 24" class="ph-ic"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>'),
  check: raw('<svg viewBox="0 0 24 24" class="ph-ic"><path d="M5 12.5l4.5 4.5L19 7"/></svg>'),
  lock: raw('<svg viewBox="0 0 24 24" class="ph-ic"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'),
};
const step = (n, pic, text, extra = '') => html`<li class="ph-step"><span class="ph-n">${n}</span><span class="ph-pic">${pic}</span><span class="ph-t">${raw(text)}${extra}</span></li>`;
const mockAlert = () => html`<div class="ph-mock" aria-hidden="true"><img src="img/icon-192.png" alt=""><span><b>Pinoy Permit</b>Mayor's Permit is due in 7 days. Here's what to bring.</span><small>now</small></div>`;

// ---------------------------------------------------------------- the guide
// Which screen this phone needs right now.
async function screen() {
  const s = await alertState(true);
  if (isIOS() && !isInstalled()) return 'ios-install';
  if (s === 'on') return isAndroid() && !isInstalled() ? 'android-install' : 'done';
  if (s === 'blocked') return 'blocked';
  if (s === 'unsupported') return 'unsupported';
  return 'turn-on';
}

const SCREENS = {
  'ios-install': () => html`<div class="ph-guide ${iosSafari() ? 'ph-has-arrow' : ''}">
    <p class="ph-kick">Step 1 of 2</p><h3 class="ph-h">Put Pinoy Permit on your home screen</h3>
    ${iosSafari() ? html`<ol class="ph-steps">
      ${step(1, I.share, 'Tap the <b>Share</b> button at the <b>bottom</b> of your screen.')}
      ${step(2, I.plus, 'Scroll down a little. Tap <b>Add to Home Screen</b>.')}
      ${step(3, html`<span class="ph-word">Add</span>`, 'Tap <b>Add</b> at the top right.')}
      ${step(4, I.phone, 'Open <b>Pinoy Permit</b> from your home screen. Then tap <b>Turn on reminders</b>.')}
    </ol><div class="ph-arrow" aria-hidden="true">${I.share}<span>The Share button is down here</span></div>`
    : html`<p class="ph-lead">First, open this page in <b>Safari</b> (the blue compass app). iPhones only allow reminders from Safari.</p>
      <button type="button" class="btn btn-primary btn-lg ph-big" data-act="phone-copy">Copy the link for Safari</button>
      <p class="ph-small">Then open Safari, tap the address bar, and paste.</p>`}
  </div>`,
  'android-install': () => html`<div class="ph-guide">
    <p class="ph-kick">Last step</p><h3 class="ph-h">Put Pinoy Permit on your home screen</h3>
    <p class="ph-lead">So it opens like an app, with one tap.</p>
    ${installPrompt ? html`<button type="button" class="btn btn-primary btn-lg ph-big" data-act="phone-install">${I.plus}Add to my home screen</button>`
      : html`<ol class="ph-steps">
        ${step(1, I.dots, 'Tap the <b>⋮</b> button at the <b>top right</b> of Chrome.')}
        ${step(2, I.plus, 'Tap <b>Add to Home screen</b> (or <b>Install app</b>).')}
        ${step(3, html`<span class="ph-word">Add</span>`, 'Tap <b>Add</b> or <b>Install</b>.')}
      </ol>`}
    <button type="button" class="btn btn-ghost ph-skip" data-modal-close>I'll do this later</button>
  </div>`,
  'turn-on': () => html`<div class="ph-guide">
    <p class="ph-kick">${isIOS() ? 'Step 2 of 2' : isPhone() ? 'Step 1 of 2' : 'One tap'}</p>
    <h3 class="ph-h">Turn on reminders</h3>
    <p class="ph-lead">We'll buzz your ${isPhone() ? 'phone' : 'computer'} like this, before anything expires:</p>
    ${mockAlert()}
    <button type="button" class="btn btn-primary btn-lg ph-big" data-act="phone-on">${I.bell}Turn on reminders</button>
    <p class="ph-small">Next, your ${isPhone() ? 'phone' : 'browser'} asks to allow notifications. Tap <b>Allow</b>.</p>
  </div>`,
  done: () => html`<div class="ph-guide ph-done">
    <span class="ph-ok">${I.check}</span><h3 class="ph-h">You're all set</h3>
    <p class="ph-lead">We'll remind you 30, 7 and 1 day before each deadline. At most 4 alerts a day.</p>
    <button type="button" class="btn btn-primary btn-lg ph-big" data-act="phone-test">${I.bell}Send me a test alert</button>
  </div>`,
  blocked: () => html`<div class="ph-guide">
    <h3 class="ph-h">Alerts are blocked on this ${isPhone() ? 'phone' : 'browser'}</h3>
    <p class="ph-lead">Someone tapped "Block" before. Here's how to undo it:</p>
    ${isIOS() ? html`<ol class="ph-steps">
        ${step(1, I.phone, 'Open your iPhone\'s <b>Settings</b> app.')}
        ${step(2, I.bell, 'Tap <b>Notifications</b>, then <b>Pinoy Permit</b>.')}
        ${step(3, I.check, 'Switch <b>Allow Notifications</b> on. Then come back here.')}</ol>`
      : html`<ol class="ph-steps">
        ${step(1, I.lock, 'Tap the <b>lock</b> or <b>settings</b> icon next to the web address.')}
        ${step(2, I.bell, 'Tap <b>Notifications</b> (or <b>Permissions</b>).')}
        ${step(3, I.check, 'Choose <b>Allow</b>. Then come back here.')}</ol>`}
    <button type="button" class="btn btn-primary btn-lg ph-big" data-act="phone-recheck">I did it, check again</button>
  </div>`,
  unsupported: () => html`<div class="ph-guide">
    <h3 class="ph-h">This ${isPhone() ? 'phone' : 'browser'} can't show alerts</h3>
    <p class="ph-lead">${isIOS() ? 'iPhones need iOS 16.4 or newer. Update your iPhone in Settings, then try again.' : 'Try Google Chrome instead.'}
      Don't worry: you still get every reminder by email and here in the app.</p>
  </div>`,
};

export async function openPhoneGuide() {
  const name = await screen();
  openModal(isPhone() ? 'Reminders on your phone' : 'Reminders on this computer', SCREENS[name](), { cancelLabel: name === 'done' ? 'Close' : 'Not now' });
  document.querySelector('.modal')?.classList.add('ph-modal');
}
const refresh = async () => { await openPhoneGuide(); rerender(); };

on('phone-guide', () => openPhoneGuide());
on('phone-later', (ds, btn) => {
  try { localStorage.setItem('pp-phone-later', String(Date.now())); } catch { /* fine */ }
  btn.closest('.ph-card')?.remove();
});
on('phone-on', async (ds, btn) => {
  btn.disabled = true;
  try {
    const p = api();
    if (p.permission() !== 'granted' && (await p.ask()) !== 'granted') { state = null; return refresh(); }
    const key = await db.pushPublicKey();
    if (!key) throw new Error('Reminders are almost ready on our side. Please try again in 5 minutes.');
    const sub = (await p.subscribe(key)).toJSON();
    await db.pushSubscribe(sub.endpoint, sub.keys.p256dh, sub.keys.auth, isIOS() ? 'iPhone' : isAndroid() ? 'Android phone' : 'Computer');
    state = 'on';
    toast("Reminders are on. You're all set!");
    await refresh();
  } catch (e) { btn.disabled = false; toastError(e); }
});
on('phone-install', async () => {
  if (!installPrompt) return refresh();
  installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice.catch(() => ({ outcome: 'dismissed' }));
  installPrompt = null;
  if (outcome === 'accepted') { closeModal(); toast('Done! Pinoy Permit is on your home screen.'); rerender(); } else refresh();
});
on('phone-test', async (ds, btn) => {
  btn.disabled = true;
  try { await db.pushTest(); toast('Test sent. It arrives within a minute.'); } catch (e) { toastError(e); } finally { btn.disabled = false; }
});
on('phone-off', async () => {
  try { const s = await api().current(); if (s) { await db.pushUnsubscribe(s.endpoint); await s.unsubscribe(); } state = 'off'; toast('Reminders are off on this device.'); rerender(); } catch (e) { toastError(e); }
});
on('phone-recheck', () => { state = null; refresh(); });
on('phone-copy', async () => {
  try { await navigator.clipboard.writeText(location.href.split('#')[0]); toast('Link copied. Now open Safari and paste it.'); } catch { toast(location.href.split('#')[0]); }
});

// ---------------------------------------------------------------- where people see it
// Home: a big friendly card until this phone gets alerts (hidden for a week after "Later").
export function phoneCard() {
  if (!has('push') || globalThis.PP_DEMO) return '';
  try { if (Date.now() - Number(localStorage.getItem('pp-phone-later') || 0) < 7 * 864e5) return ''; } catch { /* show it */ }
  return html`<section class="card ph-card" data-phone-card hidden>
    <span class="ph-card-ic">${I.bell}</span>
    <div class="ph-card-t"><h2>Get reminders on your ${isPhone() ? 'phone' : 'computer'}</h2>
      <p>We'll buzz you before anything expires. Takes 30 seconds.</p></div>
    <div class="ph-card-btns"><button type="button" class="btn btn-primary btn-lg" data-act="phone-guide">Set it up</button>
      <button type="button" class="btn btn-ghost" data-act="phone-later">Later</button></div>
  </section>`;
}
// The card shows only when there's something to do here (checked after the page is drawn).
export async function revealPhoneCard(root) {
  const card = root.querySelector('[data-phone-card]');
  if (!card) return;
  const s = await alertState();
  if (s === 'unsupported' && !isIOS()) return;
  if (s !== 'on' || (isPhone() && !isInstalled())) card.hidden = false;
}

// Settings: the same, with the state spelled out and a test button.
export function phoneSettings() {
  if (!has('push')) return '';
  return html`<section class="card ph-settings" id="install"><div class="card-head"><div><h2>Reminders on your phone</h2>
      <p class="card-sub">Alerts on your lock screen, 30, 7 and 1 day before each deadline. At most 4 a day.</p></div></div>
    <div data-phone-state><p class="muted">Checking this ${isPhone() ? 'phone' : 'device'}…</p></div></section>`;
}
export async function fillPhoneSettings(root) {
  const box = root.querySelector('[data-phone-state]');
  if (!box) return;
  const s = await alertState();
  box.innerHTML = String(s === 'on' ? html`<p class="ph-status on">${I.check}<b>On for this ${isPhone() ? 'phone' : 'device'}</b></p>
      <div class="btn-row"><button type="button" class="btn btn-primary" data-act="phone-test">${I.bell}Send me a test alert</button>
        <button type="button" class="btn btn-ghost" data-act="phone-off">Turn off here</button></div>`
    : html`<p class="ph-status off">${I.bell}<b>${s === 'blocked' ? 'Blocked on this device' : s === 'unsupported' && !isIOS() ? "This browser can't show alerts" : 'Not on yet'}</b></p>
      <button type="button" class="btn btn-primary btn-lg" data-act="phone-guide">Set it up</button>`);
}
