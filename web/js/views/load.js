// Pinoy Permit load: prepaid credit for the small extras that each do one job: text reminders, one template
// at a time, a papers check before you queue, and the renewal season pass. Topping it up (GCash, Maya, bank
// or online), inviting other businesses, and the history of every peso. The database checks every price and
// rule again; nothing here decides what anything costs.
import { html, openModal, confirmDialog, toast, toastError, when, fmtDate, fmtDateTime, peso, plural, todayPH } from '../util.js';
import { S, on, go, has, isOrgAdmin, reqById, typeOf, rerender } from '../core.js';
import { ICON } from '../components.js';
import { payDetails, paySettings } from './services.js';
import * as db from 'pp/data';

// ---------------------------------------------------------------- what's loaded for the page
let L = null; // { summary, products, entries, topups, invites }
const price = (code) => Number(L?.products?.find((p) => p.code === code)?.price_php ?? 0);
const onSale = (code) => !!L?.products?.find((p) => p.code === code)?.active;
async function fetchLoad() {
  const admin = isOrgAdmin();
  const [summary, products, entries, topups, invites] = await Promise.all([
    db.loadSummary(S.org.id), db.loadProducts(), db.loadEntries(S.org.id),
    admin ? db.loadTopups(S.org.id) : [], admin ? db.myInvites(S.org.id).catch(() => []) : [],
  ]);
  L = { summary, products, entries, topups, invites, org: S.org.id };
  return L;
}
// The balance and prices, for other pages (papers check, templates, Settings). Fetched once per visit.
export async function loadState(fresh = false) {
  if (!has('load')) return null;
  if (fresh || !L || L.org !== S.org.id) await fetchLoad();
  return L;
}
const refresh = async () => { await fetchLoad(); rerender(); };
// What was last fetched, without asking again (for pages that render synchronously).
export const loadStateNow = () => (L && L.org === S.org?.id ? L : null);

const ENTRY_KIND = { topup: 'Top-up', spend: 'Used', refund: 'Given back', bonus: 'Gift', cashout: 'Paid back to you' };
const TOPUP_STATUS = { due: ['To pay', 'soon'], pending_verification: ['Checking your payment', 'progress'], paid: ['Added', 'ok'], cancelled: ['Cancelled', 'needinfo'] };
const AMOUNTS = [100, 200, 500, 1000];

// ---------------------------------------------------------------- the page
export async function loadPage(el) {
  if (!has('load')) { go('#/'); return; }
  el.innerHTML = String(html`<div class="page-head"><div><h1>Load</h1></div></div><div class="loading">Loading…</div>`);
  try { await fetchLoad(); } catch (e) { toastError(e); return; }
  const s = L.summary;
  const admin = s.can_spend;
  const open = L.topups.filter((t) => ['due', 'pending_verification'].includes(t.status) && t.valid_until >= todayPH());
  el.innerHTML = String(html`
    <div class="page-head"><div><h1>Load</h1>
      <p class="muted">Prepaid credit for small extras: text reminders, a single template, a papers check, the renewal season pass. It never expires.</p></div></div>
    ${s.invites?.invited_by?.status === 'pending' ? html`<div class="banner info"><div><b>You joined by invitation.</b>
      Add 3 permits with their dates (${s.invites.invited_by.permits} of 3 so far) and you both get a month of Pinoy Permit Plus, free.</div>
      <a class="btn btn-sm btn-primary" href="#/compliance">Add dates</a></div>` : ''}
    ${open.map((t) => html`<div class="banner ${t.status === 'due' ? 'info' : 'progress'}"><div>${t.status === 'due'
      ? html`<b>Top-up ${t.number}: ${peso(t.amount_php)} to pay.</b> ${t.note ? html`${t.note} ` : ''}Good until ${fmtDate(t.valid_until)}.`
      : html`<b>Checking your ${peso(t.amount_php)} payment</b> (top-up ${t.number}). It's added within 1 business day.`}</div>
      ${when(t.status === 'due' && admin, html`<div class="banner-actions"><button class="btn btn-sm btn-primary" data-act="load-pay" data-id="${t.id}">Pay</button>
        <button class="btn btn-sm btn-ghost" data-act="load-topup-cancel" data-id="${t.id}" aria-label="Cancel top-up ${t.number}">Cancel</button></div>`)}</div>`)}

    <section class="card load-hero" aria-label="Your load">
      <div class="load-bal"><span class="muted small">Your load</span><b class="load-amt">${peso(s.total)}</b>
        ${when(Number(s.bonus) > 0, html`<span class="small">${peso(s.paid)} paid · ${peso(s.bonus)} bonus <span class="muted">(bonus is used first)</span></span>`)}</div>
      <div class="load-texts">${ICON.bell}<span>${textsLine(s)}</span></div>
      ${admin ? html`<button class="btn btn-primary" data-act="load-topup">Top up</button>`
        : html`<p class="muted small">Your workspace owner or an admin can top up and use the load.</p>`}
    </section>

    <h2 class="section-label">Use your load</h2>
    <div class="load-uses">
      ${textsCard(s, admin)}
      ${papersCardUse(admin)}
      ${templatesCardUse(s)}
      ${seasonCard(s, admin)}
    </div>

    ${admin && s.invites ? inviteSection(s) : ''}

    <h2 class="section-label">History</h2>
    <section class="card">${L.entries.length ? html`<div class="load-hist">${L.entries.map(entryRow)}</div>`
      : html`<p class="muted">Nothing yet. Top up to start: from ${peso(100)}.</p>`}</section>
    ${when(L.topups.length, html`<details class="card bills-all"><summary><b>Top-ups</b> <span class="muted small">${plural(L.topups.length, 'top-up')}</span></summary>
      ${L.topups.map(topupRow)}</details>`)}
    <p class="fineprint">Load is prepaid credit for Pinoy Permit's own services in this workspace. It never expires and can't be sent to anyone. Paid load that's still unused can be paid back to you: ask us from <a href="#/contact">Contact Pinoy Permit</a>. Bonus load (from invitations or gifts) is used first and can't be paid out. Prices include everything. <a href="terms.html#load" target="_blank" rel="noopener">Terms for load</a>.</p>`);
  wireLoad(el);
}

function textsLine(s) {
  if (s.plan_texts) return html`<b>Text reminders are included in your plan.</b>`;
  const pass = s.pass && s.pass.starts_on <= todayPH() && s.text_source === 'season';
  return html`<b>${plural(s.texts, 'text reminder')} left</b>${pass ? html` <span class="muted">· your season pass is covering texts now (${s.pass.texts_used} of ${s.pass.texts_cap} used)</span>` : ''}${s.texts_month ? html` <span class="muted">· ${plural(s.texts_month, 'text')} sent this month</span>` : ''}`;
}

function textsCard(s, admin) {
  const packs = L.products.filter((p) => p.code.startsWith('texts_') && p.active);
  const why = !s.sms_ready ? 'Text reminders are being switched on. Nothing to buy yet: email and in-app reminders work meanwhile.'
    : s.plan_texts ? 'Your plan already pays for texts.'
    : !s.phones ? html`Nobody in this workspace has a verified mobile number yet. <a href="#/settings">Add yours in Settings</a> first, so the texts have somewhere to go.` : '';
  return html`<section class="card load-use">
    <div class="load-use-head"><span class="load-ic">${ICON.bell}</span><div><h3>Text reminders</h3><p class="muted small">${packs.length ? `From ${peso(Math.min(...packs.map((p) => Number(p.price_php))))}` : 'Not available right now'}</p></div></div>
    <p>A text on the days your permits and tax deadlines need you, on top of email. One text uses one credit, and credits never expire. A text that can't be delivered gives its credit back.</p>
    ${why ? html`<p class="small muted">${why}</p>` : admin ? html`<div class="btn-row">${packs.map((p) => html`<button class="btn btn-soft" data-act="load-texts" data-pack="${p.code}">${p.texts} texts · ${peso(p.price_php)}</button>`)}</div>
      <p class="muted small">${packs.length > 1 ? `The ${packs[packs.length - 1].texts}-text pack works out to ₱${(Number(packs[packs.length - 1].price_php) / Number(packs[packs.length - 1].texts)).toFixed(2)} a text. ` : ''}Up to 3 texts a person a day, only to verified numbers.</p>` : ''}
  </section>`;
}
function papersCardUse(admin) {
  const soon = (S.data.reqs || []).filter((r) => r.expires && ['action_required', 'renew_soon'].includes(r.status)).sort((a, b) => (a.days_left ?? 999) - (b.days_left ?? 999)).slice(0, 3);
  return html`<section class="card load-use">
    <div class="load-use-head"><span class="load-ic">${ICON.check}</span><div><h3>Papers check</h3><p class="muted small">${onSale('papers_check') ? peso(price('papers_check')) + ' a permit' : 'Not available right now'}</p></div></div>
    <p>Before you queue, our team checks photos of your papers against the permit's checklist and tells you what's missing or needs fixing, usually by 6 pm the next weekday.</p>
    ${when(admin && onSale('papers_check'), soon.length ? html`<div class="load-picks">${soon.map((r) => html`<a class="btn btn-sm btn-ghost" href="#/requirement/${r.id}?check=1">${r.name} · ${r.subject_name || ''}</a>`)}</div>`
      : html`<p class="muted small">Open any permit and tap "Check my papers".</p>`)}
  </section>`;
}
function templatesCardUse(s) {
  return html`<section class="card load-use">
    <div class="load-use-head"><span class="load-ic">${ICON.file}</span><div><h3>One template</h3><p class="muted small">${s.has_plus ? 'All included with your Plus' : peso(price('template')) + ' each, yours to keep'}</p></div></div>
    <p>Authorization letters, a special power of attorney, an affidavit of loss and more, filled in with your business's details. Buy only the one you need.</p>
    <a class="btn btn-sm btn-soft" href="#/templates">See the templates</a>
  </section>`;
}
function seasonCard(s, admin) {
  const p = s.pass;
  const body = p ? html`<p><b>You have the ${p.season} pass</b>, good until ${fmtDate(p.ends_on)}.</p>
      <ul class="load-list">
        <li>${s.plan_texts ? 'Texts: included in your plan anyway' : html`Texts: ${p.texts_used} of ${p.texts_cap} used`}</li>
        <li>Papers check: ${p.check_used ? 'used' : html`<b>one free check waiting</b>: open a permit and tap "Check my papers"`}</li>
        <li>Your renewal plan by email on December 1 and January 5</li></ul>`
    : s.season_on_sale ? html`<p>For the January rush, ${peso(price('season_pass'))} until ${fmtDate(s.season_ends)}:</p>
      <ul class="load-list">
        ${when(!s.plan_texts && s.sms_ready, html`<li>Up to 100 text reminders (no credits used)</li>`)}
        <li>One papers check (worth ${peso(price('papers_check'))})</li>
        <li>Your renewal plan by email: today, on December 1 and on January 5, listing everything due before ${fmtDate(s.season_ends)}</li></ul>
      ${when(admin, html`<button class="btn btn-primary" data-act="load-season">Get the ${s.season_on_sale} pass · ${peso(price('season_pass'))}</button>`)}`
    : html`<p>Texts, a papers check and a renewal plan for the January rush. On sale again from September 1.</p>`;
  return html`<section class="card load-use ${p ? 'is-on' : ''}">
    <div class="load-use-head"><span class="load-ic">${ICON.calendar}</span><div><h3>Renewal season pass</h3><p class="muted small">Most cities want permits renewed by January 20</p></div></div>
    ${body}</section>`;
}

function inviteSection(s) {
  const n = s.invites;
  return html`<h2 class="section-label" id="invite">Invite a business</h2>
  <section class="card invite-card">
    <p><b>Know another business owner who juggles permits?</b> Send them your link. When they've added 3 permits with their dates, you both get a month of Pinoy Permit Plus, free${s.has_plus ? ' (you already have Plus, so yours comes as ₱199 bonus load)' : ''}.</p>
    <div class="invite-row"><div class="invite-link" data-invite-link><span class="muted small">Getting your link…</span></div>
      <button class="btn btn-soft" data-act="invite-copy" disabled>Copy link</button>
      ${when(typeof navigator !== 'undefined' && navigator.share, html`<button class="btn btn-ghost" data-act="invite-share" disabled>Share</button>`)}</div>
    ${when(n.joined, html`<p class="small"><b>${plural(n.joined, 'business has', 'businesses have')} joined with your link.</b> ${n.rewarded} set up${n.pending ? `, ${n.pending} still adding permits` : ''}.</p>
      <div class="load-hist">${L.invites.map((i) => html`<div class="line"><div class="line-main"><b>A business joined ${fmtDate(i.joined_on)}</b>
        <small>${i.status === 'rewarded' ? (i.my_reward === 'capped' ? "Set up. You've had this year's 6 thank-you months." : i.my_reward === 'bonus_load' ? 'Set up: ₱199 bonus load added' : 'Set up: your free month of Plus was added')
          : i.status === 'void' ? "Didn't add permits within 90 days" : `${i.permits_with_dates} of 3 permits with dates so far`}</small></div>
        <span class="chip ${i.status === 'rewarded' ? 'ok' : i.status === 'void' ? 'needinfo' : 'progress'}">${i.status === 'rewarded' ? 'Thanked' : i.status === 'void' ? 'Closed' : 'Waiting'}</span></div>`)}</div>`)}
    <p class="muted small">Up to 6 thank-you months a year. Your link only works for new workspaces, and you can't invite yourself.</p>
  </section>`;
}
const inviteUrl = (code) => new URL(`#/signup?ref=${code}`, location.href.split('#')[0]).href;
// Fill in the link once the page is on screen (the code is made the first time it's asked for).
export async function wireLoad(el) {
  const box = el.querySelector('[data-invite-link]');
  if (!box) return;
  try {
    const code = await db.inviteCode(S.org.id);
    box.innerHTML = String(html`<code>${inviteUrl(code)}</code>`);
    box.dataset.url = inviteUrl(code);
    el.querySelectorAll('[data-act="invite-copy"], [data-act="invite-share"]').forEach((b) => { b.disabled = false; });
  } catch (e) { box.innerHTML = String(html`<span class="muted small">Couldn't get your link. Try again later.</span>`); }
}
on('invite-copy', async () => {
  const url = document.querySelector('[data-invite-link]')?.dataset.url;
  if (!url) return;
  try { await navigator.clipboard.writeText(url); toast('Link copied. Send it to a business owner you know.'); }
  catch { openModal('Your invitation link', html`<label class="field"><span>Copy this link</span><input readonly value="${url}" data-select-all></label>`); }
});
on('invite-share', async () => {
  const url = document.querySelector('[data-invite-link]')?.dataset.url;
  if (!url) return;
  try { await navigator.share({ title: 'Pinoy Permit', text: 'I use Pinoy Permit to keep our permits and tax deadlines on track. Join with my link and we both get a month of Plus free:', url }); } catch { /* closed */ }
});

function entryRow(e) {
  const amt = Number(e.paid_php) + Number(e.bonus_php);
  return html`<div class="line load-line"><div class="line-main"><b>${e.label}</b><small>${ENTRY_KIND[e.kind] || e.kind} · ${fmtDateTime(e.created_at)}${e.texts > 0 ? ` · +${e.texts} texts` : ''}${Number(e.bonus_php) && e.kind === 'spend' && Number(e.paid_php) ? ` · ${peso(-e.bonus_php)} of it bonus` : ''}</small></div>
    <b class="load-delta ${amt > 0 ? 'in' : amt < 0 ? 'out' : ''}">${amt > 0 ? '+' : amt < 0 ? '−' : ''}${amt ? peso(Math.abs(amt)) : e.texts ? `+${e.texts} texts` : ''}</b></div>`;
}
function topupRow(t) {
  const [st, cls] = TOPUP_STATUS[t.status] || ['', 'needinfo'];
  const expired = t.status === 'due' && t.valid_until < todayPH();
  return html`<div class="line bill-line"><div class="line-main"><b>Top-up ${t.number}</b><small>${fmtDate(t.created_at.slice(0, 10))}${t.pay_method ? ` · ${t.pay_method.replace('_', ' ')}` : ''}${t.pay_ref ? ` · ref ${t.pay_ref}` : ''}${t.note && t.status !== 'paid' ? ` · ${t.note}` : ''}</small></div>
    <b class="bill-amt">${peso(t.amount_php)}</b><span class="chip ${expired ? 'needinfo' : cls}">${expired ? 'Expired' : st}</span></div>`;
}

// ---------------------------------------------------------------- topping up
export function openTopup(suggest = 0) {
  if (!isOrgAdmin()) return toast('Ask your workspace owner or an admin to top up.', 'error');
  const pick = AMOUNTS.find((a) => a >= suggest) || 1000;
  openModal('Top up your load', html`
    ${when(suggest, html`<p class="small">You need ${peso(suggest)} more for that.</p>`)}
    <fieldset class="chips-pick"><legend>How much?</legend>
      ${AMOUNTS.map((a) => html`<label class="pick-chip"><input type="radio" name="amount" value="${a}" ${a === pick ? 'checked' : ''}><span>${peso(a)}</span></label>`)}
      <label class="pick-chip"><input type="radio" name="amount" value="other"><span>Other</span></label></fieldset>
    <label class="field" data-other hidden><span>Amount <small>(₱100 to ₱5,000, in steps of ₱50)</small></span><input type="number" name="other" min="100" max="5000" step="50" inputmode="numeric" placeholder="e.g. 300"></label>
    <p class="muted small">Pay by GCash, Maya or bank transfer. It never expires, and unused paid load can be paid back to you.</p>`, {
    submitLabel: 'Continue',
    onOpen: (form) => form.addEventListener('change', () => { form.querySelector('[data-other]').hidden = form.amount.value !== 'other'; }),
    onSubmit: async (fd) => {
      const v = fd.get('amount') === 'other' ? Number(fd.get('other')) : Number(fd.get('amount'));
      if (!(v >= 100 && v <= 5000 && v % 50 === 0)) throw new Error('Choose an amount from ₱100 to ₱5,000, in steps of ₱50.');
      const t = await db.topupStart(S.org.id, v);
      await fetchLoad().catch(() => {});
      setTimeout(() => openPayTopup(t), 30);
    },
  });
}
async function openPayTopup(t) {
  const st = await paySettings();
  openModal(`Pay top-up ${t.number}`, html`
    <div class="quote-hint"><b>${peso(t.amount_php)}</b> <span class="muted">Pinoy Permit load, good to pay until ${fmtDate(t.valid_until)}</span></div>
    ${payDetails(st)}
    <div class="grid2">
      <label class="field"><span>Paid with</span><select name="method"><option value="gcash">GCash</option><option value="maya">Maya</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option></select></label>
      <label class="field"><span>Reference number</span><input name="ref" maxlength="120" placeholder="e.g. 1009 234 567890"></label>
    </div>
    <label class="field"><span>Screenshot of the payment <small>(optional if you entered the reference)</small></span><input type="file" name="file" accept="image/*,.pdf"></label>`, {
    submitLabel: "I've paid",
    onSubmit: async (fd) => {
      const ref = String(fd.get('ref') || '').trim();
      const file = fd.get('file');
      if (!ref && !(file && file.size)) throw new Error('Add the reference number or a screenshot of the payment, so we can find it.');
      await db.topupReport(t, { method: fd.get('method'), ref, file });
      toast("Thanks! We'll add it within 1 business day. We'll tell you when it's in.");
      await refresh();
    },
  });
}
on('load-topup', () => openTopup());
on('load-pay', (ds) => { const t = L?.topups.find((x) => x.id === ds.id); if (t) openPayTopup(t); });
on('load-topup-cancel', async (ds) => {
  if (!(await confirmDialog('Cancel this top-up?', "Only if you haven't paid it. You can start a new one anytime.", { confirmLabel: 'Cancel it', cancelLabel: 'Keep it' }))) return;
  try { await db.topupCancel(ds.id); await refresh(); toast('Cancelled.'); } catch (e) { toastError(e); }
});

// Spend: say what it costs and what's left; not enough load opens a top-up for the difference.
async function spend({ title, what, amount, run, done }) {
  const st = await loadState();
  const have = Number(st?.summary?.total || 0);
  if (amount > have) {
    openModal('Not enough load', html`<p>${what} is <b>${peso(amount)}</b>, and you have <b>${peso(have)}</b>.</p>`, {
      submitLabel: 'Top up', onSubmit: () => { setTimeout(() => openTopup(Math.max(100, Math.ceil((amount - have) / 50) * 50)), 30); },
    });
    return false;
  }
  const yes = await confirmDialog(title, html`${what} for <b>${peso(amount)}</b> from your load. You'll have ${peso(have - amount)} left.`, { confirmLabel: amount ? `Yes, use ${peso(amount)}` : 'Yes', danger: false, cancelLabel: 'Not now' });
  if (!yes) return false;
  try { await run(); await fetchLoad(); toast(done); rerender(); return true; }
  catch (e) {
    if (e?.hint === 'load') { await fetchLoad().catch(() => {}); return spend({ title, what, amount, run, done }); }
    if (e?.hint === 'phone') { toast(e.message, 'error'); return false; }
    toastError(e); return false;
  }
}
on('load-texts', (ds) => {
  const p = L?.products.find((x) => x.code === ds.pack);
  if (!p) return;
  spend({ title: `Get ${p.texts} text reminders?`, what: `${p.texts} text reminders`, amount: Number(p.price_php),
    run: () => db.buyTexts(S.org.id, p.code), done: `${p.texts} texts added. They're used only when a reminder goes out.` });
});
on('load-season', () => {
  const s = L?.summary;
  spend({ title: `Get the ${s?.season_on_sale} renewal season pass?`, what: `The renewal season pass (good until ${fmtDate(s?.season_ends)})`, amount: price('season_pass'),
    run: () => db.buySeasonPass(S.org.id), done: 'Your season pass is on. Your renewal plan is on its way by email.' });
});

// ---------------------------------------------------------------- one template at a time (used by the templates page)
export async function unlockTemplateFlow(t) {
  const st = await loadState();
  if (!st || !onSale('template')) return toast("Templates can't be bought one by one right now.", 'error');
  return spend({ title: `Get "${t.title}"?`, what: `"${t.title}", yours to keep (with future updates)`, amount: price('template'),
    run: () => db.unlockTemplate(S.org.id, t.code), done: `"${t.title}" is yours. Tap Fill in.` });
}

// ---------------------------------------------------------------- papers check (on each permit's page)
const VERDICT = { ready: ['Ready to file', 'ok', 'Your papers look complete.'], almost: ['Almost there', 'soon', 'A few things to fix before you file.'], not_ready: ['Not ready yet', 'overdue', 'Some papers are missing.'] };
const ITEM_STATE = { ok: ['Looks right', 'ok'], fix: ['Needs a fix', 'soon'], missing: ['Missing', 'overdue'], na: ['Not needed / couldn\'t tell', 'needinfo'] };
const dueWhen = (iso) => new Date(iso).toLocaleString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });

export function papersCard(r, checks = [], docsCount = 0) {
  if (!has('load') || !r) return '';
  const last = checks.find((c) => ['waiting', 'answered'].includes(c.status));
  const admin = isOrgAdmin();
  const p = L?.products?.find((x) => x.code === 'papers_check');
  const pass = L?.summary?.pass && !L.summary.pass.check_used && L.summary.pass.starts_on <= todayPH() ? L.summary.pass : null;
  const cta = admin && (p?.active || pass) ? html`<button class="btn btn-primary btn-sm" data-act="papers-open" data-id="${r.id}" data-docs="${docsCount}">${last?.status === 'answered' ? 'Check again' : 'Check my papers'} · ${pass ? 'free with your season pass' : peso(p?.price_php ?? 149)}</button>` : '';
  if (last?.status === 'waiting') {
    return html`<section class="card papers-card" id="papers"><div class="card-head"><h2>Papers check</h2><span class="chip progress">Checking</span></div>
      <p><b>We're checking your papers.</b> We aim to answer by <b>${dueWhen(last.due_by)}</b>.</p>
      ${when(last.note, html`<p class="muted small">Your note: ${last.note}</p>`)}
      ${when(admin, html`<div class="btn-row"><button class="btn btn-sm btn-soft" data-act="papers-add" data-id="${last.id}">${ICON.upload} Add photos</button>
        <button class="btn btn-sm btn-ghost" data-act="papers-cancel" data-id="${last.id}">Cancel and get it back</button></div>`)}</section>`;
  }
  if (last?.status === 'answered') {
    const [vl, vc, vt] = VERDICT[last.verdict] || ['Checked', 'ok', ''];
    return html`<section class="card papers-card" id="papers"><div class="card-head"><h2>Papers check</h2><span class="chip ${vc}">${vl}</span></div>
      <p><b>${vt}</b> <span class="muted small">Checked ${fmtDateTime(last.answered_at)}</span></p>
      ${when(last.items.length, html`<ul class="pc-items">${last.items.map((i) => { const [sl, sc] = ITEM_STATE[i.state] || ['', 'needinfo'];
        return html`<li class="pc-item"><span class="chip ${sc}">${sl}</span><div><b>${i.t}</b>${when(i.note, html`<p class="small">${i.note}</p>`)}</div></li>`; })}</ul>`)}
      <p class="pc-summary">${last.summary}</p>
      <p class="muted small">A check of what you sent us, against what offices usually ask for. Your city or agency has the final say.</p>
      ${cta ? html`<div class="btn-row">${cta}</div>` : ''}</section>`;
  }
  if (!cta && !admin) return '';
  return html`<section class="card papers-card" id="papers"><div class="card-head"><h2>Not sure you have everything?</h2></div>
    <p>Send us photos of your papers. We check them against this permit's checklist and tell you what's missing or needs fixing, so your trip to the office isn't wasted.
      Usually answered by 6 pm the next weekday.</p>
    ${cta ? html`<div class="btn-row">${cta}</div>` : html`<p class="muted small">Papers checks aren't available right now.</p>`}</section>`;
}

export async function openPapersCheck(r, docsCount = 0) {
  const st = await loadState(true);
  if (!st) return;
  const t = typeOf(r.type_code);
  const items = Array.isArray(t?.checklist) ? t.checklist : [];
  const pass = st.summary.pass && !st.summary.pass.check_used && st.summary.pass.starts_on <= todayPH();
  const cost = pass ? 0 : price('papers_check');
  const have = Number(st.summary.total);
  openModal(`Check my papers: ${r.name}`, html`
    <p>Our team checks photos of your papers ${items.length ? 'against this checklist' : 'against what offices usually ask for this permit'} and answers by <b>${dueWhen(nextWeekday6pm())}</b>.
      Not answered by then? It's free, automatically.</p>
    ${when(items.length, html`<ul class="pc-list">${items.map((i) => html`<li>${i.t}</li>`)}</ul>`)}
    <label class="field"><span>Photos of your papers <small>(up to 15: one per paper, flat, all four corners showing)</small></span>
      <input type="file" name="files" accept="image/*,.pdf" multiple ${docsCount ? '' : 'required'}></label>
    ${when(docsCount, html`<p class="muted small">We'll also look at the ${plural(docsCount, 'file')} already on this permit.</p>`)}
    <label class="field"><span>Anything we should know? <small>(optional)</small></span><textarea name="note" maxlength="1000" rows="2" placeholder="e.g. We moved to a new unit in March."></textarea></label>
    <div class="calc-lines"><div class="calc-total"><span>${pass ? 'Your season pass covers this one' : 'From your load'}</span><b>${pass ? 'Free' : peso(cost)}</b></div></div>
    ${when(!pass && cost > have, html`<p class="small"><b>You have ${peso(have)}.</b> Top up first, then come back.</p>`)}
    <p class="muted small">Only Pinoy Permit staff see these photos, and each time they open one it's listed under Settings. Photos sent here never count as the permit's own document.</p>`, {
    submitLabel: !pass && cost > have ? 'Top up' : pass ? 'Send for checking' : `Send for checking · ${peso(cost)}`,
    onSubmit: async (fd) => {
      if (!pass && cost > have) { setTimeout(() => openTopup(Math.max(100, Math.ceil((cost - have) / 50) * 50)), 30); return; }
      const files = fd.getAll('files').filter((f) => f && f.size);
      if (files.length > 15) throw new Error('Up to 15 photos, please.');
      if (!files.length && !docsCount) throw new Error('Add at least one photo of your papers.');
      const id = await db.requestPapersCheck(S.org.id, r.id, String(fd.get('note') || '').trim());
      let failed = 0;
      for (const f of files) { try { await db.addPapersCheckFile({ id, org_id: S.org.id }, f); } catch { failed++; } }
      await fetchLoad().catch(() => {});
      papersChanged(r.id);
      toast(failed ? `Sent. ${plural(failed, 'photo')} didn't upload: tap "Add photos" to try again.` : `Sent. We'll answer by ${dueWhen(nextWeekday6pm())}.`, failed ? 'error' : 'ok');
    },
  });
}
// The same rule as the database: 6 pm Manila time on the next weekday.
function nextWeekday6pm() {
  const d = new Date(`${todayPH()}T00:00:00Z`);
  do { d.setUTCDate(d.getUTCDate() + 1); } while ([0, 6].includes(d.getUTCDay()));
  return new Date(`${d.toISOString().slice(0, 10)}T18:00:00+08:00`).toISOString();
}
// The permit page listens, to refresh its card.
let onPapersChanged = () => {};
export const watchPapers = (fn) => { onPapersChanged = fn; };
const papersChanged = (reqId) => onPapersChanged(reqId);
on('papers-open', (ds) => { const r = reqById(ds.id); if (r) openPapersCheck(r, Number(ds.docs || 0)); });
on('papers-add', (ds) => {
  openModal('Add photos to your papers check', html`<label class="field"><span>Photos <small>(up to 15 in all)</small></span><input type="file" name="files" accept="image/*,.pdf" multiple required></label>`, {
    submitLabel: 'Add',
    onSubmit: async (fd) => {
      const files = fd.getAll('files').filter((f) => f && f.size);
      for (const f of files) await db.addPapersCheckFile({ id: ds.id, org_id: S.org.id }, f);
      toast(`${plural(files.length, 'photo')} added.`);
      const r = (S.data.reqs || []).find((x) => location.hash.includes(x.id));
      if (r) papersChanged(r.id);
    },
  });
});
on('papers-cancel', async (ds) => {
  if (!(await confirmDialog('Cancel the papers check?', 'It hasn\'t been answered yet, so what you paid goes back in full.', { confirmLabel: 'Cancel it', cancelLabel: 'Keep it' }))) return;
  try {
    await db.cancelPapersCheck(ds.id);
    await fetchLoad().catch(() => {});
    const r = (S.data.reqs || []).find((x) => location.hash.includes(x.id));
    if (r) papersChanged(r.id);
    toast('Cancelled. It\'s back in your load.');
  } catch (e) { toastError(e); }
});

// ---------------------------------------------------------------- Settings > Plan: a short card
export async function loadSettingsCard() {
  if (!has('load')) return '';
  let s;
  try { s = (await loadState(true)).summary; } catch { return ''; }
  return html`<section class="card load-mini"><div class="card-head"><h2>Pinoy Permit load</h2><a class="btn btn-sm btn-soft" href="#/load">Open</a></div>
    <p><b class="load-amt-sm">${peso(s.total)}</b> <span class="muted">· ${s.plan_texts ? 'texts included in your plan' : plural(s.texts, 'text reminder') + ' left'}${s.pass ? ` · season pass until ${fmtDate(s.pass.ends_on)}` : ''}</span></p>
    <p class="muted small">Prepaid credit for text reminders, single templates, papers checks and the renewal season pass. It never expires.</p></section>`;
}
