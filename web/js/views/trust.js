// Your public permit page (Plus), managed from Share proof: one page per business (or the whole
// workspace) that shows each permit's status, live. Shared by link, a QR poster for the wall, a badge
// for email signatures and websites, and by email to people who get each renewal. The page says what
// Pinoy Permit does (shows your own records, checked automatically) and never claims a government check.
import { html, raw, openModal, confirmDialog, toast, toastError, when, plural, fmtDate, timeAgo, todayPH, download, esc } from '../util.js';
import { S, on, has, hasPlus, canEdit, business, vehicle } from '../core.js';
import { ICON, STATUS, byPriority, subjectLabel, attestBox } from '../components.js';
import { openUpsell } from './plus.js';
import { makeZip } from '../zip.js';
import { qrSvg, qrPng } from '../qr.js';
import { printSheet } from '../print.js';
import * as db from 'pp/data';

const base = () => `${location.origin}${location.pathname.replace(/[^/]*$/, '')}`;
export const pageUrl = (code, src) => `${base()}p.html?c=${code}${src ? `&s=${src}` : ''}`;
const SOURCES = { qr: 'QR poster', link: 'Link', badge: 'Website badge', sign: 'Email signature', email: 'Update emails', pack: 'Accreditation pack' };
const FILES = {
  off: ['No downloads', 'Visitors see statuses and dates only.'],
  recipients: ['Only people you send updates to', 'They can download the current copies; other visitors see statuses only.'],
  everyone: ['Anyone with the page', 'Every visitor can download the current copies. Turn this off anytime and all downloads stop at once.'],
};
let state = { pages: [], pageId: null, tab: 'share', recipients: null, views: null };
let box = null;

export async function trustSection(el) {
  box = el;
  if (!has('plus')) return;
  if (!hasPlus()) { el.innerHTML = String(teaser()); return; }
  el.innerHTML = String(html`<section class="card"><div class="loading">Loading your public page…</div></section>`);
  try { state.pages = await db.trustPages(S.org.id); } catch (e) { toastError(e); el.innerHTML = ''; return; }
  if (!state.pages.find((p) => p.id === state.pageId)) { state.pageId = state.pages[0]?.id || null; state.recipients = null; state.views = null; }
  paint();
}
const teaser = () => html`<section class="card trust-teaser"><div class="card-head"><div><h2>Your permit page, always on</h2>
    <p class="card-sub">One page that always shows your permits are current. Put its QR code on your wall, its badge in your emails.</p></div></div>
  <button class="btn btn-primary" data-act="plus-upsell" data-what="Your public permit page">See Plus</button></section>`;

function paint() {
  if (!box) return;
  const page = state.pages.find((p) => p.id === state.pageId);
  if (!page) { box.innerHTML = String(createCard()); return; }
  const more = (k, label) => html`<button type="button" class="trust-more-btn ${state.tab === k ? 'on' : ''}" data-act="trust-tab" data-tab="${k}">${label}</button>`;
  const others = S.data.businesses.filter((b) => !state.pages.some((p) => p.business_id === b.id));
  box.innerHTML = String(html`<section class="card trust-card">
    <div class="card-head"><div><h2>Your permit page ${page.live ? html`<span class="chip ok">Live</span>` : html`<span class="chip needinfo">Turned off</span>`}</h2>
      <p class="card-sub">Always up to date. Anyone with the link sees your permits are current: <a href="${pageUrl(page.code)}" target="_blank" rel="noopener">${pageUrl(page.code).replace(/^https?:\/\//, '')}</a></p></div>
      <div class="btn-row"><button class="btn btn-sm btn-primary" data-act="trust-copy" data-src="link">Copy link</button>
        <a class="btn btn-sm btn-soft" href="${pageUrl(page.code)}" target="_blank" rel="noopener">Open</a></div></div>
    ${when(state.pages.length > 1 || (others.length && canEdit()), html`<div class="proof-pick trust-pick"><select id="trust-page" aria-label="Which page">${state.pages.map((p) => html`<option value="${p.id}" ${p.id === page.id ? 'selected' : ''}>${p.title}</option>`)}</select>
      ${when(others.length && canEdit(), html`<button class="btn btn-sm btn-ghost" data-act="trust-new">+ Page for another business</button>`)}</div>`)}
    ${state.tab === 'share' ? '' : html`<button type="button" class="linklike trust-back" data-act="trust-tab" data-tab="share">← Back to sharing</button>`}
    <div id="trust-body">${body(page)}</div>
    <div class="trust-more"><span>More:</span>${more('people', 'Email updates to clients')}${more('views', 'Who looked')}${more('pack', 'Accreditation pack')}${when(canEdit(), more('settings', 'Settings'))}</div></section>`);
  box.querySelector('#trust-page')?.addEventListener('change', (e) => { state.pageId = e.target.value; state.recipients = null; state.views = null; paint(); });
  if (state.tab === 'people' && !state.recipients) loadRecipients(page);
  if (state.tab === 'views' && !state.views) loadViews(page);
}

function createCard() {
  if (!canEdit()) return html`<section class="card"><h2>Your public permit page</h2><p class="muted">Not set up yet. Ask your workspace owner to make one.</p></section>`;
  const bizs = S.data.businesses;
  return html`<section class="card trust-create"><div class="card-head"><div><h2>Make your public permit page</h2>
      <p class="card-sub">It shows each permit's status and expiry date from your records, updates by itself, and says it's checked automatically by Pinoy Permit. You choose what's on it.</p></div></div>
    <form data-trust-create>
      ${bizs.length > 1 ? html`<label class="field"><span>Which business?</span><select name="business_id">${bizs.map((b) => html`<option value="${b.id}">${b.name}</option>`)}<option value="">All of ${S.org.name}</option></select></label>`
        : html`<input type="hidden" name="business_id" value="${bizs[0]?.id || ''}">`}
      ${attestBox()}
      <button class="btn btn-primary">Make the page</button></form>
    <p class="muted small">Nothing is shown to anyone until you share the link. No copies of your documents are shown unless you allow downloads.</p></section>`;
}
document.addEventListener('submit', async (e) => {
  if (!e.target.matches?.('[data-trust-create]')) return;
  e.preventDefault();
  if (!new FormData(e.target).get('attest')) return toast('Tick the box to confirm these are genuine records.', 'error');
  const bizId = new FormData(e.target).get('business_id') || null;
  const title = bizId ? business(bizId)?.name : S.org.name;
  try {
    const p = await db.trustPageSave(S.org.id, { business_id: bizId, title });
    state.pageId = p.id; state.tab = 'share';
    toast('Your page is ready. Share it, print the poster, or add it to your email signature.');
    await trustSection(box);
  } catch (err) { toastError(err); }
});
on('trust-new', () => {
  const others = S.data.businesses.filter((b) => !state.pages.some((p) => p.business_id === b.id));
  openModal('Page for another business', html`<label class="field"><span>Business</span><select name="business_id">${others.map((b) => html`<option value="${b.id}">${b.name}</option>`)}
    ${when(!state.pages.some((p) => !p.business_id), html`<option value="">All of ${S.org.name}</option>`)}</select></label>${attestBox()}`, {
    submitLabel: 'Make the page',
    onSubmit: async (fd) => {
      if (!fd.get('attest')) throw new Error('Tick the box to confirm these are genuine records.');
      const bizId = fd.get('business_id') || null;
      const p = await db.trustPageSave(S.org.id, { business_id: bizId, title: bizId ? business(bizId)?.name : S.org.name });
      state.pageId = p.id; state.tab = 'share';
      await trustSection(box);
    },
  });
});
on('trust-tab', (ds) => { state.tab = ds.tab; paint(); });

function body(page) {
  if (state.tab === 'settings') return settingsTab(page);
  if (state.tab === 'people') return html`<div class="loading">Loading…</div>`;
  if (state.tab === 'views') return html`<div class="loading">Loading…</div>`;
  if (state.tab === 'pack') return packTab(page);
  return shareTab(page);
}

// ---------------------------------------------------------------- share it: poster, badges, link
function shareTab(page) {
  return html`<div class="trust-share">
    <div class="share-way"><div class="qr-mini">${raw(qrSvg(pageUrl(page.code, 'qr'), { label: `QR code for ${page.title}'s permit page` }))}</div>
      <div><h3>Put it on your wall</h3><p>Customers and inspectors scan it and see your permits, live.</p>
        <div class="btn-row"><button class="btn btn-sm btn-primary" data-act="trust-poster">${ICON.file} Print the poster</button>
          <button class="btn btn-sm btn-ghost" data-act="trust-qr-png">${ICON.download} QR image</button></div></div></div>
    <div class="share-way"><img class="badge-preview" src="img/badge-email.png" width="220" height="44" alt="Badge: Our permits, live on Pinoy Permit">
      <div><h3>Add it to your emails</h3><p>A small badge under your name. Clients click it to see your permits.</p>
        <div class="btn-row"><button class="btn btn-sm btn-primary" data-act="trust-sign">Copy for Gmail or Outlook</button></div></div></div>
    <div class="share-way">${badgePreview(page)}
      <div><h3>Add it to your website</h3><p>Shows your permit status live on your site or online store.</p>
        <div class="btn-row"><button class="btn btn-sm btn-primary" data-act="trust-web">Copy the website code</button></div></div></div>
    <p class="fineprint">Shows your own records, checked by Pinoy Permit every morning. It never says the government checked anything.</p></div>`;
}
// What the website badge shows right now (the real one on their site reads the page live).
function badgePreview(page) {
  const items = pageItems(page, page.show_vehicles).filter((r) => !page.hidden.includes(r.id));
  const n = (st) => items.filter((r) => st.includes(r.status) && !(r.status === 'in_progress' && (r.days_left ?? 0) < 0)).length;
  const expired = items.filter((r) => r.status === 'action_required' || (r.status === 'in_progress' && (r.days_left ?? 0) < 0)).length;
  const due = n(['renew_soon', 'in_progress']);
  const ok = n(['compliant']);
  const pending = items.length - expired - due - ok;
  const [cls, title] = expired ? ['expired', `${expired} permit${expired === 1 ? '' : 's'} expired`] : due ? ['due', `${due} renewal${due === 1 ? '' : 's'} due`]
    : ok && !pending ? ['ok', `All ${ok} permits current`] : [ok ? 'ok' : '', `${ok} permit${ok === 1 ? '' : 's'} current`];
  return html`<span class="pp-badge ${cls}" role="img" aria-label="Website badge preview: ${title}"><span class="pp-mark" aria-hidden="true"></span><span class="pp-text"><b>${title}</b><small>Pinoy Permit · checked daily</small></span></span>`;
}
on('trust-copy', async (ds) => {
  const page = state.pages.find((p) => p.id === state.pageId);
  try { await navigator.clipboard.writeText(pageUrl(page.code, ds.src === 'link' ? '' : ds.src)); toast('Link copied.'); } catch { toast(pageUrl(page.code), 'info'); }
});
on('trust-poster', () => {
  const page = state.pages.find((p) => p.id === state.pageId);
  const url = pageUrl(page.code, 'qr');
  printSheet(String(html`<div class="poster">
    <div class="poster-brand"><img class="brand-wm" src="img/wordmark.png" alt="Pinoy Permit"></div>
    <h1>${page.title}</h1>
    <p class="poster-lead">Our permits, live</p>
    <img src="${qrPng(url, 900)}" alt="QR code">
    <p class="poster-cta">Scan to see each permit's status and expiry date</p>
    <p class="poster-url">${url.replace(/^https?:\/\//, '').replace(/&s=qr$/, '')}</p>
    <p class="poster-fine">Kept up to date from our records and checked automatically by Pinoy Permit every morning. Pinoy Permit doesn't issue permits.</p>
  </div>`), { cls: 'poster-sheet' });
});
on('trust-qr-png', () => {
  const page = state.pages.find((p) => p.id === state.pageId);
  const a = document.createElement('a');
  a.href = qrPng(pageUrl(page.code, 'qr'), 1200);
  a.download = `${page.title.replace(/[\\/:*?"<>|]+/g, '-')} - permits QR.png`;
  document.body.appendChild(a); a.click(); a.remove();
});
on('trust-sign', async () => {
  const page = state.pages.find((p) => p.id === state.pageId);
  const url = pageUrl(page.code, 'sign');
  const img = `${base()}img/badge-email.png`;
  const htmlSig = `<a href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(img)}" width="220" height="44" alt="Our permits, live on Pinoy Permit" style="border:0;display:block"></a>`;
  try {
    if (window.ClipboardItem) await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([htmlSig], { type: 'text/html' }), 'text/plain': new Blob([url], { type: 'text/plain' }) })]);
    else await navigator.clipboard.writeText(htmlSig);
    toast('Copied. In Gmail: Settings > Signature, then paste.');
  } catch {
    openModal('Email signature', html`<p class="muted small">Copy this and paste it into your signature settings.</p><textarea class="copy-box" rows="4" readonly>${htmlSig}</textarea>`);
  }
});
on('trust-web', async () => {
  const page = state.pages.find((p) => p.id === state.pageId);
  const code = `<iframe src="${base()}badge.html#${page.code}" title="Our permits on Pinoy Permit" width="260" height="64" style="border:0;overflow:hidden" loading="lazy"></iframe>`;
  try { await navigator.clipboard.writeText(code); toast('Copied. Paste it into your website (as HTML or an "Embed" block).'); }
  catch { openModal('Website badge', html`<textarea class="copy-box" rows="4" readonly>${code}</textarea>`); }
});

// ---------------------------------------------------------------- settings
const pageItems = (page, withVehicles) => S.data.reqs.filter((r) => (r.subject === 'business' && (!page.business_id || r.business_id === page.business_id))
  || (withVehicles && r.subject === 'vehicle' && (!page.business_id || vehicle(r.vehicle_id)?.business_id === page.business_id))).sort(byPriority);
function settingsTab(page) {
  const items = pageItems(page, true);
  return html`<form data-trust-settings>
    <div class="grid2">
      <label class="field"><span>Name on the page</span><input name="title" maxlength="120" required value="${page.title}"></label>
      <label class="field"><span>A line about you <small>(optional)</small></span><input name="intro" maxlength="300" value="${page.intro || ''}" placeholder="e.g. Family restaurant in Pasig since 2009"></label>
    </div>
    <label class="toggle"><div><div>Page is live</div><div class="muted small">Turned off, the page and badges say it's not available.</div></div><input type="checkbox" name="live" ${page.live ? 'checked' : ''}><span class="switch"></span></label>
    <label class="toggle"><div><div>Show vehicles</div><div class="muted small">Registration and insurance of ${page.business_id ? "this business's" : 'your'} vehicles.</div></div><input type="checkbox" name="show_vehicles" ${page.show_vehicles ? 'checked' : ''}><span class="switch"></span></label>
    <label class="toggle"><div><div>Show staff license counts</div><div class="muted small">For example "12 staff licenses: 11 current". Never names.</div></div><input type="checkbox" name="show_staff" ${page.show_staff ? 'checked' : ''}><span class="switch"></span></label>
    <label class="toggle"><div><div>Show the last 4 characters of permit numbers</div><div class="muted small">Like •••• 0042, so clients can match the paper without the full number being public.</div></div><input type="checkbox" name="show_refs" ${page.show_refs ? 'checked' : ''}><span class="switch"></span></label>
    <h3 class="h4">Who can download copies</h3>
    ${Object.entries(FILES).map(([k, [t, d]]) => html`<label class="check"><input type="radio" name="files" value="${k}" ${page.files === k ? 'checked' : ''}> <span><b>${t}</b><br><small class="muted">${d}</small></span></label>`)}
    <h3 class="h4">What's on the page</h3>
    <p class="muted small">Untick anything you'd rather not list. The page says the business chooses what's listed.</p>
    <div class="trust-items">${items.map((r) => html`<label class="check ${r.subject === 'vehicle' ? 'veh' : ''}"><input type="checkbox" name="show" value="${r.id}" ${page.hidden.includes(r.id) ? '' : 'checked'}>
      <span>${r.name} <small class="muted">· ${subjectLabel(r)} · ${STATUS[r.status].label}</small></span></label>`)}</div>
    <div class="btn-row"><button class="btn btn-primary">Save</button></div>
    <div class="danger-zone"><button type="button" class="btn btn-ghost" data-act="trust-recode">New address</button>
      <span class="muted small">The old link, printed QR posters and badges stop working.</span></div>
    <div class="danger-zone"><button type="button" class="btn btn-ghost danger" data-act="trust-delete">Delete this page</button></div>
  </form>`;
}
document.addEventListener('submit', async (e) => {
  if (!e.target.matches?.('[data-trust-settings]')) return;
  e.preventDefault();
  const page = state.pages.find((p) => p.id === state.pageId);
  const fd = new FormData(e.target);
  const shown = new Set(fd.getAll('show'));
  const hidden = pageItems(page, true).filter((r) => !shown.has(r.id)).map((r) => r.id);
  const btn = e.target.querySelector('button.btn-primary');
  btn.disabled = true;
  try {
    const p = await db.trustPageSave(S.org.id, { business_id: page.business_id, title: String(fd.get('title') || '').trim(), intro: String(fd.get('intro') || '').trim(),
      live: fd.get('live') === 'on', show_vehicles: fd.get('show_vehicles') === 'on', show_staff: fd.get('show_staff') === 'on', show_refs: fd.get('show_refs') === 'on',
      files: fd.get('files') || 'off', hidden });
    Object.assign(page, p);
    toast('Saved. The page shows it now.');
    paint();
  } catch (err) { toastError(err); btn.disabled = false; }
});
on('trust-recode', async () => {
  if (!(await confirmDialog('Give the page a new address?', 'The old link stops working, and so do printed QR posters, email badges and website badges. Use this if the link went somewhere it shouldn\'t.', { confirmLabel: 'New address' }))) return;
  try { const code = await db.trustNewCode(state.pageId); state.pages.find((p) => p.id === state.pageId).code = code; paint(); toast('New address ready. Print a new poster and update your badges.'); } catch (e) { toastError(e); }
});
on('trust-delete', async () => {
  if (!(await confirmDialog('Delete this page?', 'The link, QR posters and badges stop working, and the people getting updates stop getting them. Your permits are not affected.', { confirmLabel: 'Delete the page' }))) return;
  try { await db.trustDelete(state.pageId); state.pageId = null; toast('Deleted.'); await trustSection(box); } catch (e) { toastError(e); }
});

// ---------------------------------------------------------------- people who get each renewal
async function loadRecipients(page) {
  try { state.recipients = await db.trustRecipients(page.id); } catch (e) { toastError(e); state.recipients = []; }
  const el = box?.querySelector('#trust-body');
  if (el && state.tab === 'people') el.innerHTML = String(peopleTab(page));
}
function peopleTab(page) {
  const list = state.recipients || [];
  const asked = list.filter((r) => r.status === 'requested');
  const active = list.filter((r) => r.status === 'active');
  return html`<p class="muted small">Each time you renew a permit on this page, they get an email with the new expiry date${page.files === 'off' ? '' : ' and the copy'}. Every email has a link to stop them.${page.files === 'off' ? ' To include copies, allow downloads under Settings.' : ''}</p>
    ${when(asked.length, html`<h3 class="h4">Asked for updates</h3>${asked.map((r) => html`<div class="line"><div class="line-main"><b>${r.name}${r.company ? ` · ${r.company}` : ''}</b>
      <small>${r.email}${r.note ? ` · “${r.note}”` : ''} · ${timeAgo(r.created_at)}</small></div>
      ${when(canEdit(), html`<div class="btn-row"><button class="btn btn-sm btn-primary" data-act="trust-yes" data-id="${r.id}">Send them updates</button>
        <button class="btn btn-sm btn-ghost" data-act="trust-no" data-id="${r.id}">No</button></div>`)}</div>`)}`)}
    <h3 class="h4">Getting updates <span class="muted small">${active.length}</span></h3>
    ${active.length ? active.map((r) => html`<div class="line"><div class="line-main"><b>${r.name}${r.company ? ` · ${r.company}` : ''}</b>
      <small>${r.email} · ${r.last_opened_at ? `opened the page ${timeAgo(r.last_opened_at)}` : 'not opened yet'}${r.last_sent_at ? ` · last update ${timeAgo(r.last_sent_at)}` : ''}</small></div>
      ${when(canEdit(), html`<button class="btn btn-sm btn-ghost" data-act="trust-remove" data-id="${r.id}">Remove</button>`)}</div>`) : html`<p class="muted">Nobody yet. Add a client's vendor desk, your mall or your landlord.</p>`}
    ${when(canEdit(), html`<form data-trust-add class="trust-add"><div class="grid2">
        <label class="field"><span>Name</span><input name="name" maxlength="120" required placeholder="e.g. Ana Reyes"></label>
        <label class="field"><span>Company <small>(optional)</small></span><input name="company" maxlength="120" placeholder="e.g. SM Supermalls, vendor accreditation"></label></div>
      <label class="field"><span>Email</span><input type="email" name="email" maxlength="254" required placeholder="vendors@company.com"></label>
      <button class="btn btn-primary">Add: they get a welcome email</button></form>`)}`;
}
document.addEventListener('submit', async (e) => {
  if (!e.target.matches?.('[data-trust-add]')) return;
  e.preventDefault();
  const fd = new FormData(e.target);
  const f = { name: String(fd.get('name') || '').trim(), company: String(fd.get('company') || '').trim(), email: String(fd.get('email') || '').trim() };
  if (!f.name || !/^[^@\s<>"]+@[^@\s<>"]+\.[a-z]{2,}$/i.test(f.email)) return toast('Enter their name and a valid email address.', 'error');
  try { await db.trustAddRecipient(state.pageId, f); toast(`Added. ${f.name} gets a welcome email with the page.`); state.recipients = null; paint(); } catch (err) { toastError(err); }
});
on('trust-yes', async (ds) => { try { await db.trustDecide(ds.id, true); toast('Done. They get a welcome email.'); state.recipients = null; paint(); } catch (e) { toastError(e); } });
on('trust-no', async (ds) => { try { await db.trustDecide(ds.id, false); state.recipients = null; paint(); } catch (e) { toastError(e); } });
on('trust-remove', async (ds) => {
  if (!(await confirmDialog('Stop sending them updates?', "They won't be told; the emails just stop.", { confirmLabel: 'Stop', danger: false }))) return;
  try { await db.trustRemoveRecipient(ds.id); state.recipients = null; paint(); } catch (e) { toastError(e); }
});

// ---------------------------------------------------------------- who looked
async function loadViews(page) {
  const since = new Date(Date.now() - 90 * 864e5).toISOString();
  try { state.views = await db.trustViews(page.id, since); } catch (e) { toastError(e); state.views = []; }
  if (!state.recipients) { try { state.recipients = await db.trustRecipients(page.id); } catch { state.recipients = []; } }
  const el = box?.querySelector('#trust-body');
  if (el && state.tab === 'views') el.innerHTML = String(viewsTab());
}
function viewsTab() {
  const v = state.views || [];
  const d30 = Date.now() - 30 * 864e5;
  const d7 = Date.now() - 7 * 864e5;
  const last30 = v.filter((x) => Date.parse(x.viewed_at) >= d30);
  const by = Object.keys(SOURCES).map((k) => [k, last30.filter((x) => x.source === k).length]).filter(([, n]) => n);
  const max = Math.max(1, ...by.map(([, n]) => n));
  const opened = (state.recipients || []).filter((r) => r.last_opened_at).sort((a, b) => b.last_opened_at.localeCompare(a.last_opened_at));
  return html`<div class="stats trust-stats">
      <div class="stat"><div class="stat-n">${v.filter((x) => Date.parse(x.viewed_at) >= d7).length}</div><div class="stat-l">Last 7 days</div></div>
      <div class="stat"><div class="stat-n">${last30.length}</div><div class="stat-l">Last 30 days</div></div>
      <div class="stat"><div class="stat-n">${v.length}</div><div class="stat-l">Last 90 days</div></div></div>
    <h3 class="h4">Where they came from <span class="muted small">(last 30 days)</span></h3>
    ${by.length ? html`<div class="src-bars">${by.map(([k, n]) => html`<div class="src-bar"><span>${SOURCES[k]}</span><div><i style="width:${Math.round((n / max) * 100)}%"></i></div><b>${n}</b></div>`)}</div>`
      : html`<p class="muted">No visits yet. Share the link or print the poster.</p>`}
    <h3 class="h4">People you send updates to</h3>
    ${opened.length ? opened.map((r) => html`<div class="line"><div class="line-main"><b>${r.name}${r.company ? ` · ${r.company}` : ''}</b><small>Opened ${plural(r.open_count, 'time')}, last ${timeAgo(r.last_opened_at)}</small></div></div>`)
      : html`<p class="muted small">None have opened it yet.</p>`}
    <p class="fineprint">Visitors aren't identified (no names, no tracking): only where they came from. People you send updates to are shown when they open the page from their email.</p>`;
}

// ---------------------------------------------------------------- accreditation pack (.zip)
function packTab(page) {
  return html`<p class="muted small">For a client, mall or government office accrediting you as a supplier: a cover letter, a one-page summary with the QR code to your live page, and copies of your current permits, in one .zip.</p>
    <form data-trust-pack><div class="grid2">
      <label class="field"><span>Company</span><input name="company" maxlength="120" required placeholder="e.g. Robinsons Supermarket"></label>
      <label class="field"><span>Addressed to <small>(optional)</small></span><input name="contact" maxlength="120" placeholder="e.g. Ms. Ana Reyes, Purchasing"></label></div>
      <button class="btn btn-primary">${ICON.download} Make the pack</button></form>`;
}
document.addEventListener('submit', async (e) => {
  if (!e.target.matches?.('[data-trust-pack]')) return;
  e.preventDefault();
  const page = state.pages.find((p) => p.id === state.pageId);
  const fd = new FormData(e.target);
  const company = String(fd.get('company') || '').trim();
  const contact = String(fd.get('contact') || '').trim();
  if (!company) return toast('Enter the company.', 'error');
  const btn = e.target.querySelector('button');
  btn.disabled = true; btn.textContent = 'Preparing…';
  const clean = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80).trim();
  try {
    const items = pageItems(page, page.show_vehicles).filter((r) => !page.hidden.includes(r.id));
    const docs = (await db.orgDocuments(S.org.id)).filter((d) => items.some((r) => r.id === d.requirement_id && r.cycle_id === d.cycle_id));
    const url = pageUrl(page.code, 'pack');
    const me = [S.profile.first_name, S.profile.last_name].filter(Boolean).join(' ');
    const longDate = new Date(`${todayPH()}T00:00:00Z`).toLocaleDateString('en-PH', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    const style = '<style>body{font-family:Georgia,serif;max-width:760px;margin:40px auto;padding:0 20px;color:#111;line-height:1.55}table{border-collapse:collapse;width:100%;font-family:system-ui,sans-serif}td,th{border-bottom:1px solid #ddd;padding:7px;text-align:left;font-size:13px}small{color:#666}</style>';
    const letter = String(html`<!doctype html><html><head><meta charset="utf-8"><title>Cover letter</title>${raw(style)}</head><body>
      <p>${longDate}</p><p>${contact ? html`${contact}<br>` : ''}${company}</p>
      <p><b>Subject: Accreditation documents of ${page.title}</b></p>
      <p>Dear ${contact || 'Sir or Madam'}:</p>
      <p>Thank you for considering ${page.title} as your supplier. Enclosed are our current permits and registrations, listed in the summary.</p>
      <p>You can also check their status at any time on our live permit page: <a href="${url}">${url}</a>. It is kept up to date from our records.</p>
      <p>Please let me know if you need anything else${S.profile.email ? html`. You can reach me at ${S.profile.email}` : ''}.</p>
      <p>Sincerely,<br><br><br>${me || '______________________'}<br>${page.title}</p></body></html>`);
    const summary = String(html`<!doctype html><html><head><meta charset="utf-8"><title>Permit summary</title>${raw(style)}</head><body>
      <h1 style="font-family:system-ui,sans-serif">${page.title}</h1><p>Permits as of ${fmtDate(todayPH())}, for ${company}</p>
      <table><tr><th>Permit</th><th>For</th><th>No.</th><th>Valid until</th><th>Copy</th></tr>
      ${items.map((r) => html`<tr><td>${r.name}</td><td>${subjectLabel(r)}</td><td>${r.reference_no || '—'}</td><td>${r.expires ? (r.expires_on ? fmtDate(r.expires_on) : '—') : 'Does not expire'}</td>
        <td>${docs.some((d) => d.requirement_id === r.id) ? 'Included' : '—'}</td></tr>`)}</table>
      <p style="margin-top:24px"><img src="${qrPng(url, 360)}" width="160" height="160" alt="QR code to the live permit page" style="float:left;margin:0 16px 8px 0">
      <b>See these live.</b><br>Scan the code or open <a href="${url}">${url}</a>.<br><small>The page shows the business's own records, checked automatically by Pinoy Permit. Pinoy Permit doesn't issue permits or verify them with the government.</small></p></body></html>`);
    const files = [{ name: '00 Cover letter.html', data: new TextEncoder().encode(letter) }, { name: '01 Permit summary.html', data: new TextEncoder().encode(summary) }];
    const used = new Set();
    for (const d of docs) {
      const r = items.find((x) => x.id === d.requirement_id);
      let name = `${clean(r.name)} - ${clean(d.file_name)}`;
      while (used.has(name)) name = name.replace(/(\.[^.]*)?$/, '-2$1');
      used.add(name);
      let blob;
      try { blob = await db.fileBlob(d.storage_path); } catch { throw new Error(`Couldn't download ${d.file_name}. Please try again.`); }
      files.push({ name, data: new Uint8Array(await blob.arrayBuffer()) });
    }
    download(`${clean(page.title)} - accreditation pack for ${clean(company)}.zip`, makeZip(files), 'application/zip');
    toast(`Pack ready: ${plural(docs.length, 'copy', 'copies')} and the summary.`);
  } catch (err) { toastError(err); }
  btn.disabled = false; btn.innerHTML = String(html`${ICON.download} Make the pack`);
});
