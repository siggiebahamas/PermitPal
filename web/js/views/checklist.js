// "How to renew": a permit's renewal checklist, where to file it, the official online portal, how long
// it stays valid, and the permits that have to be done first (with their live status). Ticks belong to
// the current permit period, so recording the renewal starts a clean checklist for next time.
// Everything is written as general guidance: the city or agency has the final say.
import { html, fmtDate, toast, toastError, when, plural, peso } from '../util.js';
import { S, canEdit, has, typeOf, memberName, reqById, coverOf, tierOf, offered } from '../core.js';
import { STATUS, statusChip, ICON } from '../components.js';
import { placementFor, placementLine } from './extras.js';
import { lguFor } from './office.js';
import * as db from 'pp/data';

// Permits for the same business branch (or the whole business), vehicle or person, by type.
function sibling(r, code) {
  return (S.data?.reqs || []).find((x) => x.type_code === code && x.subject === r.subject
    && (r.subject === 'business' ? x.business_id === r.business_id && (x.location_id === r.location_id || !x.location_id)
      : r.subject === 'vehicle' ? x.vehicle_id === r.vehicle_id : x.person_id === r.person_id));
}
const round = (r) => (r.cycle_id ? String(r.cycle_id) : 'first');
const external = (url, label) => html`<a class="ext-link" href="${url}" target="_blank" rel="noopener noreferrer">${label} <span aria-hidden="true">↗</span><span class="sr-only"> (opens in a new tab)</span></a>`;

// What you send Pinoy Permit vs what the office itself needs: two separate labels, never merged.
const SEND = { digital: 'Digital copy for pre-check', photocopy: 'Photocopy', na: 'Not needed' };
const AGENCY = { digital: 'Digital copy accepted', photocopy: 'Photocopy required by agency', original_present: 'Original must be presented',
  original_submit: 'Original must be submitted', ctc: 'Certified true copy required', issuer: 'Electronic transmission by issuer required',
  na: 'Not applicable', unverified: 'Unverified: confirm first' };
const agencyName = (r, t) => (r.subject === 'vehicle' ? (t.agency || 'LTO').split(/[\s/]/)[0] : 'The office');
const VERIFY = { verified: ['Verified', 'ok'], partial: ['Partly verified', 'soon'], needs_confirmation: ['Needs official confirmation', 'needinfo'] };
// Where this checklist comes from and how sure we are; for a city permit, the city's entry in the register.
function sourceLine(t) {
  if (!has('lgus') || !t.verify) return '';
  const [label, cls] = VERIFY[t.verify] || VERIFY.needs_confirmation;
  return html`<p class="ck-source"><span class="chip ${cls}">${label}</span> ${t.source_url ? html`Source: ${external(t.source_url, t.source_title || 'official source')}` : t.source_title || 'Source being checked'}${t.checked_on ? html` · checked ${fmtDate(t.checked_on)}` : ''}</p>`;
}
function cityEntry(r) {
  if (!has('lgus') || r.subject !== 'business' || !['mayors_permit', 'barangay_clearance'].includes(r.type_code)) return '';
  const g = lguFor(r.location_city);
  if (!g) return r.location_city ? html`<div class="ck-city"><b>${r.location_city}</b> isn't in our Metro Manila register yet. Check the city's own .gov.ph site or its BPLO before you go.</div>` : '';
  const [label, cls] = VERIFY[g.status] || VERIFY.needs_confirmation;
  const yn = { yes: 'Yes', likely: 'Reported, not yet confirmed', no: 'No', unknown: 'Not confirmed' };
  return html`<div class="ck-city"><div class="ck-city-head"><b>${g.name}</b> <span class="chip ${cls}">${label}</span></div>
    ${g.status === 'needs_confirmation' ? html`<p class="small"><b>Requirements being verified.</b> We haven't confirmed ${g.name}'s current checklist yet, so treat this list as a general guide and check with the office${g.source_url ? html` (${external(g.source_url, 'official site')})` : ''} before you file.</p>` : ''}
    <dl class="ck-facts">
      <dt>File online</dt><dd>${yn[g.online_filing] || 'Not confirmed'}${g.portal_url ? html` · ${external(g.portal_url, 'portal')}` : ''}</dd>
      <dt>Pay online</dt><dd>${yn[g.online_payment] || 'Not confirmed'}${g.payment_note ? html`<small>${g.payment_note}</small>` : ''}</dd>
      ${g.representative ? html`<dt>Someone filing for you</dt><dd>${g.representative}</dd>` : ''}
      ${g.originals ? html`<dt>Originals and copies</dt><dd>${g.originals}</dd>` : ''}
      ${g.deadline_note ? html`<dt>Deadline</dt><dd>${g.deadline_note}</dd>` : ''}
      ${g.release_note ? html`<dt>Getting the permit</dt><dd>${g.release_note}</dd>` : ''}
    </dl>
    <p class="muted small">${g.source_url ? html`Source: ${external(g.source_url, g.source_title || 'official source')}` : 'No official source linked yet'}${g.checked_on ? ` · checked ${fmtDate(g.checked_on)}` : ''}. Pay government fees only through the office's official channels.</p></div>`;
}

// What the card is about, in plain words.
function heading(r) {
  if (!r.expires) return 'Keeping it in good standing';
  if (!r.cycle_id) return 'How to get it';
  return 'How to renew';
}

export function checklistCard(r, ticks = [], { offer = '' } = {}) {
  if (!has('library2')) return '';
  const t = typeOf(r.type_code);
  if (!t) return '';
  const items = Array.isArray(t.checklist) ? t.checklist : [];
  const deps = (t.depends_on || []).map((code) => ({ code, type: typeOf(code), req: sibling(r, code) })).filter((d) => d.type);
  if (!items.length && !t.where_to_file && !t.online_url && !t.validity_note && !deps.length) return '';
  const now = round(r);
  const done = new Map(ticks.filter((x) => x.round === now).map((x) => [x.item, x]));
  const doneCount = items.filter((i) => done.has(i.k)).length;
  const edit = canEdit();
  const city = r.location_city || '';
  const cityLink = !t.online_url && t.category === 'local' && city
    ? `https://www.google.com/search?q=${encodeURIComponent(`${city} ${t.name.replace(/\s*\/.*$/, '')} renewal online`)}` : null;

  const g = r.subject === 'business' ? lguFor(r.location_city) : null;
  const official = t.online_url || g?.source_url || t.source_url || null;
  const step = (n, title, body, cls = '') => html`<li class="st ${cls}"><span class="st-n" aria-hidden="true">${n}</span><div class="st-body"><h3>${title}</h3>${body}</div></li>`;
  let n = 0;
  return html`<details class="card checklist steps" open data-req="${r.id}">
    <summary><span class="ck-title">${heading(r)}: step by step</span>
      ${when(items.length, html`<span class="ck-count" aria-live="polite"><b data-ck-done>${doneCount}</b> of ${items.length} ready</span>`)}</summary>
    <ol class="st-list">
    ${when(deps.length, step(++n, 'Do this first', html`<div class="ck-deps">
      ${deps.map((d) => d.req
        ? html`<a class="ck-dep" href="#/requirement/${d.req.id}"><span>${d.req.name}</span>${statusChip(d.req.status)}</a>`
        : html`<div class="ck-dep missing"><span>${d.type.name} <small class="muted">· not tracked here yet</small></span>
            ${when(edit, html`<button class="btn btn-sm btn-soft" data-act="req-add" data-subject="${r.subject}" data-id="${r.business_id || r.vehicle_id || r.person_id}"
              data-type="${d.code}" ${r.location_id ? html`data-loc="${r.location_id}"` : ''}>Add it</button>`)}</div>`)}</div>`, 'st-first'))}
    ${when(items.length, step(++n, 'Get these papers ready', html`<p class="st-sub">Tick each one when you have it.</p>
      <div class="ck-progress" aria-hidden="true"><span style="width:${Math.round((doneCount / items.length) * 100)}%"></span></div>
      <ul class="ck-list">${items.map((i) => {
        const tick = done.get(i.k);
        const dep = i.dep ? sibling(r, i.dep) : null;
        return html`<li class="${tick ? 'done' : ''}"><label class="ck-item">
          <input type="checkbox" data-ck="${i.k}" ${tick ? 'checked' : ''} ${edit ? '' : 'disabled'}>
          <span class="ck-text"><span class="ck-t">${i.t}</span>
            ${when(i.d, html`<small>${i.d}</small>`)}
            ${i.send || i.agency ? html`<span class="ck-copy">${i.send ? html`<span class="ck-send">Send us: <b>${SEND[i.send] || i.send}</b></span>` : ''}${i.agency ? html`<span class="ck-agency ${i.agency === 'unverified' ? 'unv' : ''}">${agencyName(r, t)} needs: <b>${AGENCY[i.agency] || i.agency}</b></span>` : ''}</span>` : ''}
            ${dep ? html`<small class="ck-dep-status">In Pinoy Permit: ${STATUS[dep.status]?.label || dep.status}${dep.status === 'compliant' && dep.expires_on ? ` until ${fmtDate(dep.expires_on)}` : ''}</small>` : ''}
            ${tick ? html`<small class="ck-who">Ticked by ${tick.done_by === S.user?.id ? 'you' : memberName(tick.done_by)}, ${fmtDate(String(tick.done_at).slice(0, 10))}</small>` : ''}
          </span></label>
          ${when(i.u, html`<span class="ck-link">${external(i.u, 'Open')}</span>`)}
          ${i.k === 'inspect' ? walkthroughLine(r) : ''}
          ${(() => { const p = placementFor(r, i.k); return p ? placementLine(p, r) : ''; })()}</li>`;
      })}</ul>
      ${items.some((i) => i.agency && i.agency.startsWith('original')) ? html`<p class="ck-orig"><b class="ck-orig-ic" aria-hidden="true">!</b><span>Bring the originals the office asks for. A scan or photo you send us is only for checking. It doesn't replace an original the office asks for.</span></p>` : ''}
      ${when(edit && r.expires && !['in_progress', 'compliant'].includes(r.status), html`<p class="ck-hint" data-ck-hint ${doneCount ? '' : 'hidden'}>
        Filed it already? Tap <b>I've started the renewal</b>, so your team isn't alerted that it hasn't started.</p>`)}`))}
    ${when(t.where_to_file || t.online_url || cityLink || t.validity_note, step(++n, 'Where to file', html`<dl class="ck-facts">
      ${when(t.where_to_file, html`<dt>Where</dt><dd>${t.where_to_file}</dd>`)}
      ${when(t.online_url, html`<dt>Online</dt><dd>${external(t.online_url, t.online_label || 'Official website')}</dd>`)}
      ${when(cityLink, html`<dt>Online</dt><dd>${external(cityLink, `Find ${city}'s online renewal`)} <small class="muted">(a web search; use the city's own .gov.ph site)</small></dd>`)}
      ${when(g?.portal_url, html`<dt>City portal</dt><dd>${external(g?.portal_url, `${g?.name} online portal`)}</dd>`)}
      ${when(t.validity_note, html`<dt>Valid for</dt><dd>${t.validity_note}</dd>`)}
    </dl>`))}
    ${step(++n, 'How to pay', payBody(r, t, g, edit))}
    ${step(++n, 'Need help?', html`<ul class="st-help">
      ${when(official, html`<li>${external(official, 'Official website')} <small>for the latest rules and forms</small></li>`)}
      ${when(g?.source_url && g.source_url !== official, html`<li>${external(g?.source_url, `${g?.name} official site`)}</li>`)}
      <li><a href="#/pros">Ask a professional</a> <small>accountants and liaison firms near you</small></li></ul>
      ${offer}`, 'st-help-step')}
    </ol>
    <details class="st-about"><summary>Where this guide comes from</summary>
      <p class="muted small">A general guide. Your ${r.subject === 'business' ? 'city, barangay or agency' : 'agency'} may ask for more or less, so check with them before you go.</p>
      ${sourceLine(t)}
      ${cityEntry(r)}
    </details>
    ${(() => { const p = placementFor(r, null); return p ? placementLine(p, r) : ''; })()}
    ${when(!edit, html`<p class="muted small">You can view this checklist. Only people who can edit can tick items.</p>`)}
  </details>`;
}

// Step "How to pay": in plain words, from what we know about the office.
function payBody(r, t, g, edit) {
  const where = r.subject === 'vehicle' ? "Pay at the LTO cashier, or online through the LTO portal when it offers it."
    : g?.online_payment === 'yes' ? html`Pay online through ${g.portal_url ? external(g.portal_url, `${g.name}'s portal`) : `${g.name}'s official portal`}, or at the city hall cashier.`
    : t.category === 'local' ? "After the office checks your papers, it gives you a bill (an order of payment or tax bill). Pay it at the city hall cashier (the Treasurer's Office)."
    : 'Pay the fees at the office cashier or on its official website.';
  return html`<p>${where}</p>
    <p class="st-sub">Keep the official receipt. Pay government fees only through the office's own cashier or website.</p>
    ${when(edit && has('billpay'), html`<div class="btn-row"><button class="btn btn-soft btn-sm" data-act="bill-add" data-id="${r.id}">${ICON.camera} Got the bill? Add it</button></div>`)}`;
}
// Our own walk-through, on the "inspection" step: one line, and free when the care plan includes it.
function walkthroughLine(r) {
  if (!has('revenue') || !canEdit() || r.open_request_id) return '';
  const s = (S.data?.services || []).find((x) => x.visit && x.type_codes.includes(r.type_code));
  if (!offered(s)) return '';
  const p = coverOf(r);
  const incl = p && p.status === 'active' && tierOf(p.tier)?.walkthroughs > 0;
  return html`<div class="ck-offer">${incl ? 'Included in your care plan:' : 'Want to pass the first time?'}
    <button type="button" class="linklike" data-act="svc-request" data-code="${s.code}" data-req="${r.id}">Book a pre-inspection walk-through</button>
    ${incl ? '' : html`<small class="muted">${s.price_from != null ? 'from ' + peso(s.price_from) : ''}</small>`}</div>`;
}

// Ticking: saved straight away, the box is locked while it saves, and it flips back if saving fails.
document.addEventListener('change', async (e) => {
  const box = e.target;
  const key = box?.dataset?.ck;
  if (!key) return;
  const card = box.closest('.checklist');
  const r = reqById(card?.dataset.req);
  if (!r) return;
  const want = box.checked;
  box.disabled = true;
  try {
    const savedRound = await db.setChecklistItem(r.id, key, want);
    if (savedRound !== round(r)) {
      // The permit was renewed in another tab or by a teammate: show the fresh checklist.
      toast('This permit was just updated, so the checklist was refreshed.', 'info');
      onChanged?.();
      return;
    }
    const li = box.closest('li');
    li.classList.toggle('done', want);
    li.querySelector('.ck-who')?.remove();
    if (want) li.querySelector('.ck-text').insertAdjacentHTML('beforeend', String(html`<small class="ck-who">Ticked by you, ${fmtDate(new Date().toISOString().slice(0, 10))}</small>`));
    const total = card.querySelectorAll('[data-ck]').length;
    const n = card.querySelectorAll('[data-ck]:checked').length;
    const counter = card.querySelector('[data-ck-done]');
    if (counter) counter.textContent = n;
    const bar = card.querySelector('.ck-progress span');
    if (bar) bar.style.width = `${Math.round((n / total) * 100)}%`;
    const hint = card.querySelector('[data-ck-hint]');
    if (hint) hint.hidden = !n;
    onTicked?.(r.id, key, want);
    if (n === total && want) toast(`All ${plural(total, 'item')} ready. When you have the new ${r.expires ? 'permit' : 'document'}, record it here.`);
  } catch (err) {
    box.checked = !want;
    toastError(err);
  } finally {
    box.disabled = !canEdit();
  }
});

// The permit page keeps its own copy of the ticks; it registers these so the copy stays current.
let onTicked = null;
let onChanged = null;
export function watchChecklist({ ticked, changed }) { onTicked = ticked; onChanged = changed; }
