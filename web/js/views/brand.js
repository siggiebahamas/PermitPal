// White-label for accounting firms (₱1,000 a month on top of the firm plan): the firm's name, logo and
// colour on its clients' emails and in their app, replies to the firm, and a report to each client on
// the 1st. Clients keep their own free accounts and always see "Powered by PermitPal"; when the add-on
// or the firm plan lapses, or the firm disconnects, everything goes back to PermitPal's look by itself
// (the database works the look out each time, so nothing here has to switch it off).
import { html, when, toast, toastError, fmtDate, plural, todayPH, daysBetween, peso } from '../util.js';
import { ICON } from '../components.js';
import { addonCard, billButton, BRAND_CHECKS } from './pricing.js';
import { S, on, reload, has, isOrgAdmin, addonOf, addonActive, plusOf, brandEligible } from '../core.js';
import { BRAND_MONTHLY, YEAR_MONTHS } from '../prices.js';
import * as db from 'pp/data';

const DEFAULT_COLOR = '#1B4DB5';

// ---------------------------------------------------------------- colours
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function luminance(h) {
  const [r, g, b] = rgb(h).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const onWhite = (h) => 1.05 / (luminance(h) + 0.05);
// White text on the colour stays readable (the database checks the same).
export const colorOk = (h) => /^#[0-9a-f]{6}$/i.test(h || '') && onWhite(h) >= 4.5;
const mix = (h, to, t) => '#' + rgb(h).map((v, i) => Math.round(v + (to[i] - v) * t).toString(16).padStart(2, '0')).join('').toUpperCase();
// The app's colours from the firm's: buttons in its colour; text and links a shade darker when needed, so
// they stay readable on the pale tint too.
export function brandVars(color) {
  if (!colorOk(color)) return null;
  let ink = color.toUpperCase();
  for (let k = 1; onWhite(ink) < 7 && k <= 10; k++) ink = mix(color, [0, 0, 0], k * 0.08);
  const soft = mix(color, [255, 255, 255], 0.9);
  return { '--brand': color, '--accent': color, '--ring-fill': color, '--accent-ink': ink, '--link': ink, '--accent-soft': soft, '--ring-track': soft };
}
const VARS = ['--brand', '--accent', '--ring-fill', '--accent-ink', '--link', '--accent-soft', '--ring-track'];
export function applyBrand(b) {
  const st = document.documentElement.style;
  VARS.forEach((v) => st.removeProperty(v));
  const vars = b ? brandVars(b.color) : null;
  if (vars) Object.entries(vars).forEach(([k, v]) => st.setProperty(k, v));
}

// ---------------------------------------------------------------- what a firm's client sees
const wordmark = html`<span class="wordmark"><span class="w1">Permit</span><span class="w2">Pal</span></span>`;
export const sideBrand = (b, extra = '') => html`<a class="brand co-brand ${extra}" href="#/">${b.logo_url ? html`<img src="${b.logo_url}" alt="">` : ''}<span class="cb-name">${b.name}</span></a>`;
export const poweredBy = () => html`<div class="powered-by">Powered by ${wordmark}</div>`;
const tel = (p) => String(p || '').replace(/[^0-9+]/g, '');
export function accountantCard() {
  const b = S.brand;
  if (!b) return '';
  return html`<section class="card firm-card" aria-label="Your accountant">
    <div class="firm-top">${b.logo_url ? html`<img class="firm-logo" src="${b.logo_url}" alt="">` : ''}
      <div><div class="muted small">Your accountant</div><b>${b.name}</b>${b.tagline ? html`<div class="muted small">${b.tagline}</div>` : ''}</div></div>
    ${b.reply_to || b.phone ? html`<div class="btn-row">${b.reply_to ? html`<a class="btn btn-sm btn-soft" href="mailto:${b.reply_to}">Email ${b.reply_to}</a>` : ''}
      ${b.phone ? html`<a class="btn btn-sm btn-ghost" href="tel:${tel(b.phone)}">Call ${b.phone}</a>` : ''}</div>` : ''}
    <p class="muted small">${b.name} sees your permits' status here. Your PermitPal account stays yours, free, whoever you work with.</p></section>`;
}

// The sign-up page opened from a firm's invitation: the firm's logo and name (no account needed to see them).
export async function connectBrand(token) {
  const b = await db.linkBrand(token).catch(() => null);
  const banner = document.querySelector('.auth-card .banner.info');
  if (!b || !banner) return;
  applyBrand(b);
  banner.insertAdjacentHTML('beforebegin', String(html`<div class="auth-firm">${b.logo_url ? html`<img src="${b.logo_url}" alt="">` : ''}<b>${b.name}</b></div>`));
  const lead = banner.querySelector('b');
  if (lead) lead.textContent = `${b.name} invited you to connect on PermitPal.`;
}

// ---------------------------------------------------------------- Settings > Plan: the White-label card
export function brandCard() {
  const a = addonOf('brand');
  const live = addonActive(a);
  const eligible = brandEligible();
  const admin = isOrgAdmin();
  const stopping = plusOf().stopping || {};
  const status = !eligible ? html`<span class="chip needinfo">Needs the Accounting firm plan</span>`
    : live && a.trial ? html`<span class="chip progress">Free trial: ${plural(Math.max(0, daysBetween(todayPH(), a.paid_through) + 1), 'day')} left</span>`
    : live ? html`<span class="chip ok">On until ${fmtDate(a.paid_through)}</span>` : '';
  const setup = html`<a class="btn btn-sm btn-ghost" href="#/settings/brand">Your brand</a>`;
  let actions = '';
  if (admin && eligible && live && !a.trial) {
    actions = stopping.brand
      ? html`<p class="small">Ends on ${fmtDate(stopping.brand)}. <button class="linklike" data-act="addon-resume" data-kind="brand">Keep it</button></p>`
      : html`<div class="btn-row">${setup}${a.billing === 'monthly' ? html`<button class="btn btn-sm btn-soft" data-act="addon-choose" data-kind="brand" data-billing="yearly">Switch to yearly: 2 months free</button>` : ''}
          <button class="btn btn-sm btn-ghost" data-act="addon-stop" data-kind="brand">Stop at the end of the period</button></div>`;
  } else if (admin && eligible) {
    actions = html`<div class="btn-row">
      ${!a?.trial_used_on && !a?.started_on && !live ? html`<button class="btn btn-primary" data-act="brand-trial">Try free for 14 days</button>` : ''}
      ${billButton('data-act="addon-choose" data-kind="brand"', `${live ? 'Keep it' : 'Turn on'}: ${peso(BRAND_MONTHLY)} a month`,
        `${live ? 'Keep it' : 'Turn on'}: ${peso(BRAND_MONTHLY * YEAR_MONTHS)} a year (2 months free)`, live ? 'btn btn-primary' : 'btn btn-soft')}${live ? setup : ''}</div>`;
  } else if (!eligible) {
    actions = html`<p class="muted small">Choose the Accounting firm plan above (or start its free trial) to add White-label.</p>`;
  } else {
    actions = html`<p class="muted small">Your workspace owner or an admin can turn it on.</p>`;
  }
  return addonCard({ id: 'white-label', icon: ICON.briefcase, name: 'White-label', who: 'For accounting firms: your brand on everything your clients see',
    monthly: BRAND_MONTHLY, list: BRAND_CHECKS, status, cta: actions, current: live && eligible,
    note: 'Your clients keep their own free PermitPal accounts and see "Powered by PermitPal".' });
}
on('brand-trial', async (ds, btn) => {
  btn.disabled = true;
  try {
    const until = await db.startBrandTrial(S.org.id);
    await reload();
    toast(`White-label is on, free until ${fmtDate(until)}. Now add your logo and colour.`);
    location.hash = '#/settings/brand';
  } catch (e) { toastError(e); btn.disabled = false; }
});

// ---------------------------------------------------------------- Settings > Your brand
export async function brandPage(el, subnav) {
  el.innerHTML = String(html`<div class="page-head"><div><h1>Settings</h1></div></div>${subnav}<div class="loading">Loading…</div>`);
  let saved = null;
  try { saved = await db.brandSettings(S.org.id); } catch (e) { toastError(e); }
  const a = addonOf('brand');
  const live = addonActive(a) && brandEligible();
  const admin = isOrgAdmin();
  const v = {
    display_name: saved?.display_name || S.org.name, color: saved?.color || DEFAULT_COLOR, reply_to: saved?.reply_to || '', phone: saved?.phone || '',
    tagline: saved?.tagline || '', client_report: saved ? saved.client_report : true, logo_path: saved?.logo_path || null,
  };
  const logoUrl = db.brandLogoUrl(v.logo_path);
  const dis = admin ? '' : 'disabled';
  el.innerHTML = String(html`
    <div class="page-head"><div><h1>Settings</h1></div></div>${subnav}
    ${live ? html`<div class="banner ok"><div><b>Your clients see your brand.</b> ${a.trial ? `Free trial until ${fmtDate(a.paid_through)}.` : `White-label is on until ${fmtDate(a.paid_through)}.`}</div></div>`
      : html`<div class="banner info"><div><b>Your clients see this once White-label is on.</b> ₱${BRAND_MONTHLY.toLocaleString()} a month, 14 days free. Set it up first if you like: nothing shows until then.</div>
        <a class="btn btn-sm btn-primary" href="#/settings/billing?brand=1">${brandEligible() ? 'Turn it on' : 'See plans'}</a></div>`}
    <div class="brand-grid">
      <section class="card"><h2>Your brand</h2>
        <form id="brand-form" novalidate>
          <label class="field"><span>Name your clients know you by</span><input name="display_name" maxlength="80" required value="${v.display_name}" ${dis}></label>
          <div class="field"><span id="logo-lbl">Logo <small>(optional)</small></span>
            <div class="logo-row"><div class="logo-box" data-logo-box>${logoUrl ? html`<img src="${logoUrl}" alt="Your current logo">` : html`<span class="muted small">No logo</span>`}</div>
              <div><input type="file" name="logo" accept="image/png,image/jpeg" aria-labelledby="logo-lbl" ${dis}>
                <p class="muted small">PNG or JPG, up to 512 KB. A wide logo on a white or see-through background works best.</p>
                ${logoUrl && admin ? html`<button type="button" class="linklike small" data-logo-remove>Remove the logo</button>` : ''}</div></div></div>
          <div class="field"><span id="color-lbl">Colour</span>
            <div class="color-row"><input type="color" name="color_pick" value="${v.color.toLowerCase()}" aria-label="Pick a colour" ${dis}>
              <input name="color" value="${v.color}" maxlength="7" aria-labelledby="color-lbl" aria-describedby="color-msg" spellcheck="false" ${dis}></div>
            <p class="small" id="color-msg" aria-live="polite"></p></div>
          <div class="grid2">
            <label class="field"><span>Replies go to <small>(optional)</small></span><input type="email" name="reply_to" maxlength="254" value="${v.reply_to}" placeholder="hello@yourfirm.ph" ${dis}></label>
            <label class="field"><span>Phone <small>(optional)</small></span><input name="phone" maxlength="20" value="${v.phone}" placeholder="(02) 8123 4567" ${dis}></label>
          </div>
          <label class="field"><span>One line under your name <small>(optional)</small></span><input name="tagline" maxlength="120" value="${v.tagline}" placeholder="Tax, books and permits for small businesses" ${dis}></label>
          <label class="toggle"><div><div>Send each client a report on the 1st</div><div class="muted small">Overdue, due within 30 days and missing details, under your name.</div></div>
            <input type="checkbox" name="client_report" ${v.client_report ? 'checked' : ''} ${dis}><span class="switch"></span></label>
          ${admin ? html`<div class="btn-row"><button class="btn btn-primary">Save</button></div>` : html`<p class="muted small">Only the workspace owner or an admin can change the brand.</p>`}
        </form>
      </section>
      <div class="brand-side">
        <section class="card"><h2>What your clients see</h2>
          <p class="muted small">An email</p>
          <div class="mail-prev" data-mail-prev></div>
          <p class="muted small">Their app</p>
          <div class="side-prev" data-side-prev></div>
        </section>
        <section class="card"><h2>Where it shows</h2>
          <ul class="plain-list small">
            <li>Permit reminders, tax and contribution deadlines, the Monday summary and your nudges, to every client you're connected to or manage.</li>
            <li>Your invitations to connect, and the sign-up page they open.</li>
            <li>Your clients' PermitPal app: your logo, colour and contact details.</li>
          </ul>
          <p class="muted small">Your clients keep their own PermitPal accounts, free, and always see "Powered by PermitPal". If White-label ends or you disconnect a client, their emails and app go back to PermitPal's look by themselves, and we tell them their account stays theirs.</p>
        </section>
      </div>
    </div>`);

  el.querySelector('.subnav a[href="#/settings/brand"]')?.classList.add('active');
  const form = el.querySelector('#brand-form');
  let removeLogo = false;
  let blobUrl = null;
  const paint = () => {
    const color = form.color.value.trim();
    const ok = colorOk(color);
    const c = ok ? color : DEFAULT_COLOR;
    const msg = el.querySelector('#color-msg');
    msg.textContent = ok ? 'White text is easy to read on it.' : /^#[0-9a-f]{6}$/i.test(color) ? 'Too light: white text on it would be hard to read. Pick a darker shade.' : 'Use a colour code like #0F5132.';
    msg.className = `small ${ok ? 'ok-text' : 'warn-text'}`;
    const name = form.display_name.value.trim() || S.org.name;
    const reply = form.reply_to.value.trim();
    const phone = form.phone.value.trim();
    const tag = form.tagline.value.trim();
    const img = removeLogo ? null : blobUrl || logoUrl;
    el.querySelector('[data-mail-prev]').innerHTML = String(html`
      <div class="mp-from"><b>${name} via PermitPal</b>${reply ? html` <span class="muted">· replies to ${reply}</span>` : ''}</div>
      <div class="mp-head">${img ? html`<img src="${img}" alt="">` : ''}<b style="color:${c}">${name}</b>${tag ? html`<small>${tag}</small>` : ''}</div>
      <div class="mp-card" style="border-top-color:${c}"><b>Mayor's Permit expires in 7 days</b><p class="small">Sample Client Store · due ${fmtDate(todayPH())}</p>
        <span class="mp-btn" style="background:${c}">Open PermitPal</span></div>
      <p class="mp-foot">${reply || phone ? `Questions? ${reply ? `Email ${reply}` : ''}${reply && phone ? ' or call ' : phone ? 'Call ' : ''}${phone}.` : ''}
        <br>Sent for ${name} · Powered by PermitPal</p>`);
    el.querySelector('[data-side-prev]').innerHTML = String(html`<div class="sp-top">${img ? html`<img src="${img}" alt="">` : ''}<b>${name}</b></div>${poweredBy()}
      <div class="sp-nav"><span style="background:${brandVars(c)['--accent-soft']};color:${brandVars(c)['--accent-ink']}">Dashboard</span><span>Businesses</span><span>Compliance</span></div>`);
  };
  paint();
  form.addEventListener('input', (e) => {
    if (e.target.name === 'color_pick') form.color.value = e.target.value.toUpperCase();
    if (e.target.name === 'color' && /^#[0-9a-f]{6}$/i.test(e.target.value.trim())) form.color_pick.value = e.target.value.trim().toLowerCase();
    paint();
  });
  form.logo?.addEventListener('change', () => {
    const f = form.logo.files[0];
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = null;
    if (f && !db.LOGO_TYPES[f.type]) { toast('Use a PNG or JPG image for the logo.', 'error'); form.logo.value = ''; }
    else if (f && f.size > db.LOGO_MAX_BYTES) { toast('That logo is over 512 KB. Save it smaller (about 400 pixels wide is plenty) and try again.', 'error'); form.logo.value = ''; }
    else if (f) { blobUrl = URL.createObjectURL(f); removeLogo = false; }
    const box = el.querySelector('[data-logo-box]');
    const img = removeLogo ? null : blobUrl || logoUrl;
    box.innerHTML = String(img ? html`<img src="${img}" alt="Your logo">` : html`<span class="muted small">No logo</span>`);
    paint();
  });
  el.querySelector('[data-logo-remove]')?.addEventListener('click', (e) => {
    removeLogo = true;
    form.logo.value = '';
    if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
    el.querySelector('[data-logo-box]').innerHTML = String(html`<span class="muted small">No logo (saves when you press Save)</span>`);
    e.target.hidden = true;
    paint();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!admin) return;
    const btn = form.querySelector('button.btn-primary');
    const f = Object.fromEntries(new FormData(form));
    const color = String(f.color || '').trim().toUpperCase();
    if (!String(f.display_name || '').trim()) { toast('Enter the name your clients know you by.', 'error'); form.display_name.focus(); return; }
    if (!colorOk(color)) { toast('Pick a darker colour, so white text on it stays easy to read.', 'error'); form.color.focus(); return; }
    btn.disabled = true;
    let uploaded = null;
    try {
      const file = form.logo.files[0];
      if (file) uploaded = await db.uploadBrandLogo(S.org.id, file);
      const path = uploaded || (removeLogo ? null : v.logo_path);
      await db.brandSave(S.org.id, { display_name: String(f.display_name).trim(), logo_path: path, color, reply_to: String(f.reply_to || '').trim(),
        phone: String(f.phone || '').trim(), tagline: String(f.tagline || '').trim(), client_report: !!form.client_report.checked });
      if (v.logo_path && v.logo_path !== path) db.removeBrandLogo(v.logo_path).catch(() => {});
      toast(live ? 'Saved. Your clients see it from now on.' : 'Saved. Your clients see it once White-label is on.');
      await brandPage(el, subnav);
    } catch (err) {
      if (uploaded) db.removeBrandLogo(uploaded).catch(() => {});
      toastError(err);
      btn.disabled = false;
    }
  });
}
export const brandTabShown = () => has('brand') && S.org?.kind === 'firm';
