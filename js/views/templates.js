// Ready-to-use templates (Plus): letters and sworn statements businesses keep needing for permits,
// filled in from the workspace's own details. Everyone sees the list and the first lines; the full
// text comes from the database only for Plus workspaces. Printouts carry "Prepared with Pinoy Permit for …".
import { html, openModal, toast, toastError, when, fmtDate, todayPH, download, esc, peso } from '../util.js';
import { S, on, has, hasPlus, isOrgAdmin, rerender, business, locationsOf } from '../core.js';
import { ICON } from '../components.js';
import { openUpsell } from './plus.js';
import { loadState, unlockTemplateFlow } from './load.js';
import { printSheet } from '../print.js';
import * as db from 'pp/data';

let listCache = null;
let unlocked = new Set(); // templates this workspace bought one by one (with load)
const owned = (code) => hasPlus() || unlocked.has(code);
const longDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-PH', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export async function templatesPage(el) {
  el.innerHTML = String(html`<div class="page-head"><div><h1>Templates</h1></div></div><div class="loading">Loading…</div>`);
  const single = has('load') && !hasPlus();
  let one = 0;
  try {
    listCache ||= await db.listTemplates();
    if (single) {
      const [u, st] = await Promise.all([db.templateUnlocks(S.org.id), loadState()]);
      unlocked = new Set(u.map((x) => x.code));
      const p = st?.products?.find((x) => x.code === 'template');
      one = p?.active ? Number(p.price_php) : 0;
    }
  } catch (e) { toastError(e); return; }
  const plus = hasPlus();
  const cats = [...new Set(listCache.map((t) => t.category))];
  el.innerHTML = String(html`
    <div class="page-head"><div><h1>Templates</h1>
      <p class="muted">Letters and sworn statements offices ask for, filled in with your details. Print, sign, done.</p></div></div>
    ${when(!plus && has('plus'), html`<div class="banner info"><div><b>Templates come with Pinoy Permit Plus.</b> ${one ? html`Or get just the one you need for ${peso(one)}, yours to keep.` : 'Preview any of them below.'}</div>
      <button class="btn btn-sm btn-primary" data-act="plus-upsell" data-what="Templates">See Plus</button></div>`)}
    ${cats.map((c) => html`<h2 class="section-label">${c}</h2><div class="svc-grid">${listCache.filter((t) => t.category === c).map((t) => html`
      <section class="card svc tpl-card"><div class="svc-top"><h2>${t.title}</h2>${t.notarize ? html`<span class="tag">Needs a notary</span>` : ''}</div>
        <p>${t.summary}</p><p class="muted small"><b>Use it:</b> ${t.use_when}</p>
        <div class="svc-foot">${owned(t.code) ? html`<button class="btn btn-primary btn-sm" data-act="tpl-fill" data-code="${t.code}">Fill in</button>${when(!plus, html`<span class="chip ok">Yours</span>`)}`
          : html`<button class="btn btn-soft btn-sm" data-act="tpl-preview" data-code="${t.code}">Preview</button>${when(one && isOrgAdmin(), html`<button class="btn btn-primary btn-sm" data-act="tpl-unlock" data-code="${t.code}">Get it · ${peso(one)}</button>`)}`}</div></section>`)}</div>`)}
    <p class="fineprint">General templates for common permit paperwork, not legal advice. Offices sometimes have their own forms: if they do, use theirs. For anything with legal consequences, have a lawyer look it over.</p>`);
}

on('tpl-preview', (ds) => {
  const t = (listCache || []).find((x) => x.code === ds.code);
  if (!t) return;
  openModal(t.title, html`<div class="tpl-preview"><pre class="tpl-doc">${t.preview}</pre><div class="tpl-fade" aria-hidden="true"></div></div>
    <p class="muted small">The rest is filled in with your business's details${has('plus') ? ' when you have Pinoy Permit Plus' : ''}${has('load') && isOrgAdmin() ? ', or when you get just this one with your load' : ''}.</p>`, {
    submitLabel: has('load') && isOrgAdmin() ? 'Get just this one' : 'See Plus',
    onSubmit: () => { setTimeout(() => (has('load') && isOrgAdmin() ? unlockOne(t) : openUpsell('Templates')), 30); },
  });
});

// What the workspace already knows, for the boxes marked with a source.
function sources(bizId, req) {
  const b = business(bizId) || S.data.businesses[0];
  const main = b ? locationsOf(b.id).find((l) => l.is_main) || locationsOf(b.id)[0] : null;
  const me = S.profile || {};
  const current = b ? S.data.reqs.filter((r) => r.business_id === b.id && r.cycle_id && ['compliant', 'renew_soon', 'in_progress'].includes(r.status)) : [];
  return {
    business_name: b?.name || S.org.name,
    business_address: [main?.address, main?.city].filter(Boolean).join(', '),
    city: main?.city || '',
    tin: b?.tin || '',
    me_name: [me.first_name, me.last_name].filter(Boolean).join(' '),
    me_title: me.role_title || '',
    me_email: me.email || '',
    today: longDate(todayPH()),
    permit_name: req?.name || '',
    permit_no: req?.reference_no || '',
    permit_issuer: req?.issuer || '',
    permit_issued: req?.issued_on ? longDate(req.issued_on) : '',
    permits_list: current.map((r, i) => `${i + 1}. ${r.name}${r.reference_no ? `, No. ${r.reference_no}` : ''}${r.expires && r.expires_on ? `, valid until ${fmtDate(r.expires_on)}` : ''}`).join('\n'),
    page_link: '',
  };
}
const fill = (body, v) => body.replace(/\{\{([a-z0-9_]+)\}\}/g, (m, k) => (String(v[k] ?? '').trim() || '__________'));

async function unlockOne(t) {
  if (await unlockTemplateFlow(t)) { unlocked.add(t.code); rerender(); }
}
on('tpl-unlock', (ds) => { const t = (listCache || []).find((x) => x.code === ds.code); if (t) unlockOne(t); });

on('tpl-fill', async (ds) => {
  if (!owned(ds.code)) return has('load') ? unlockOne((listCache || []).find((x) => x.code === ds.code)) : openUpsell('Templates');
  let t;
  try { t = await db.getTemplate(S.org.id, ds.code); } catch (e) { if (e?.hint === 'plus') return openUpsell('Templates'); return toastError(e); }
  const usesPermit = t.fields.some((f) => String(f.source || '').startsWith('permit_'));
  const bizs = S.data.businesses;
  let pageLink = '';
  if (t.fields.some((f) => f.source === 'page_link') && has('plus')) {
    try {
      const pages = await db.trustPages(S.org.id);
      const p = pages.find((x) => x.live) || pages[0];
      if (p) pageLink = new URL(`p.html?c=${p.code}`, location.href.split('#')[0]).href;
    } catch { /* left for them to type */ }
  }
  const reqsFor = (bizId) => S.data.reqs.filter((r) => r.subject === 'business' && (!bizId || r.business_id === bizId));
  const field = (f, v) => html`<label class="field"><span>${f.label}${f.required ? '' : html` <small>(optional)</small>`}</span>
    ${f.multiline ? html`<textarea name="f_${f.key}" rows="4" maxlength="2000">${v}</textarea>` : html`<input name="f_${f.key}" maxlength="300" value="${v}" placeholder="${f.hint || ''}">`}</label>`;
  const initial = (bizId, reqId) => {
    const src = { ...sources(bizId, S.data.reqs.find((r) => r.id === reqId)), page_link: pageLink };
    return Object.fromEntries(t.fields.map((f) => [f.key, f.source ? src[f.source] ?? '' : (f.default || '')]));
  };
  const biz0 = bizs[0]?.id || '';
  const req0 = usesPermit ? reqsFor(biz0)[0]?.id || '' : '';
  const v0 = initial(biz0, req0);
  const m = openModal(t.title, html`
    <div class="tpl-grid">
      <div class="tpl-form">
        ${when(bizs.length > 1, html`<label class="field"><span>Business</span><select name="biz">${bizs.map((b) => html`<option value="${b.id}">${b.name}</option>`)}</select></label>`)}
        ${when(usesPermit, html`<label class="field"><span>Which permit?</span><select name="req"><option value="">Type it in below</option>
          ${reqsFor(biz0).map((r) => html`<option value="${r.id}" ${r.id === req0 ? 'selected' : ''}>${r.name}</option>`)}</select></label>`)}
        ${t.fields.map((f) => field(f, v0[f.key]))}
        ${when(t.notarize, html`<p class="banner warn small"><span>Sign this in front of a notary public, with a valid ID. Leave the notary's part blank.</span></p>`)}
      </div>
      <div class="tpl-side"><div class="tpl-actions btn-row">
          <button type="button" class="btn btn-primary btn-sm" data-tpl-print>${ICON.file} Print or save as PDF</button>
          <button type="button" class="btn btn-soft btn-sm" data-tpl-doc>${ICON.download} Word (.doc)</button>
          <button type="button" class="btn btn-ghost btn-sm" data-tpl-copy>Copy text</button></div>
        <pre class="tpl-doc" aria-live="polite"></pre></div>
    </div>`, {
    wide: true, cancelLabel: 'Close',
    onOpen: (form) => {
      const doc = form.querySelector('.tpl-doc');
      const values = () => Object.fromEntries(t.fields.map((f) => [f.key, form.querySelector(`[name="f_${f.key}"]`)?.value || '']));
      const text = () => fill(t.body, values());
      const bizName = () => values().business_name || S.org.name;
      const paint = () => { doc.textContent = text(); };
      paint();
      form.addEventListener('input', paint);
      const reset = () => {
        const v = initial(form.biz?.value || biz0, form.req?.value || '');
        for (const f of t.fields) if (f.source) { const el = form.querySelector(`[name="f_${f.key}"]`); if (el) el.value = v[f.key]; }
        paint();
      };
      form.biz?.addEventListener('change', () => {
        if (form.req) form.req.innerHTML = String(html`<option value="">Type it in below</option>${reqsFor(form.biz.value).map((r) => html`<option value="${r.id}">${r.name}</option>`)}`);
        reset();
      });
      form.req?.addEventListener('change', reset);
      const footer = () => `Prepared with Pinoy Permit for ${bizName()} · ${fmtDate(todayPH())}`;
      form.querySelector('[data-tpl-print]').addEventListener('click', () => printSheet(String(html`<article class="tpl-print"><pre>${text()}</pre><footer>${footer()}</footer></article>`)));
      form.querySelector('[data-tpl-copy]').addEventListener('click', async () => { try { await navigator.clipboard.writeText(text()); toast('Copied.'); } catch { toast("Couldn't copy here. Use Word or Print instead.", 'error'); } });
      form.querySelector('[data-tpl-doc]').addEventListener('click', () => {
        const body = esc(text()).split('\n').map((l) => `<p style="margin:0 0 0;min-height:1em">${l || '&nbsp;'}</p>`).join('');
        const docHtml = `<html><head><meta charset="utf-8"><title>${esc(t.title)}</title></head><body style="font-family:'Times New Roman',serif;font-size:12pt;line-height:1.5">${body}<p style="margin-top:28pt;font-size:8pt;color:#666">${esc(footer())}</p></body></html>`;
        download(`${t.title} - ${bizName()}.doc`.replace(/[\\/:*?"<>|]+/g, '-'), '﻿' + docHtml, 'application/msword');
      });
    },
  });
  return m;
});
