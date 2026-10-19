// "How to renew": a permit's renewal checklist, where to file it, the official online portal, how long
// it stays valid, and the permits that have to be done first (with their live status). Ticks belong to
// the current permit period, so recording the renewal starts a clean checklist for next time.
// Everything is written as general guidance: the city or agency has the final say.
import { html, fmtDate, toast, toastError, when, plural, peso } from '../util.js';
import { S, canEdit, has, typeOf, memberName, reqById, coverOf, tierOf, offered } from '../core.js';
import { STATUS, statusChip } from '../components.js';
import { placementFor, placementLine } from './extras.js';
import * as db from 'pp/data';

// Permits for the same business branch (or the whole business), vehicle or person, by type.
function sibling(r, code) {
  return (S.data?.reqs || []).find((x) => x.type_code === code && x.subject === r.subject
    && (r.subject === 'business' ? x.business_id === r.business_id && (x.location_id === r.location_id || !x.location_id)
      : r.subject === 'vehicle' ? x.vehicle_id === r.vehicle_id : x.person_id === r.person_id));
}
const round = (r) => (r.cycle_id ? String(r.cycle_id) : 'first');
const external = (url, label) => html`<a class="ext-link" href="${url}" target="_blank" rel="noopener noreferrer">${label} <span aria-hidden="true">↗</span><span class="sr-only"> (opens in a new tab)</span></a>`;

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
  const urgent = ['action_required', 'renew_soon', 'in_progress', 'needs_information'].includes(r.status);
  const city = r.location_city || '';
  const cityLink = !t.online_url && t.category === 'local' && city
    ? `https://www.google.com/search?q=${encodeURIComponent(`${city} ${t.name.replace(/\s*\/.*$/, '')} renewal online`)}` : null;

  return html`<details class="card checklist" ${urgent ? 'open' : ''} data-req="${r.id}">
    <summary><span class="ck-title">${heading(r)}</span>
      ${when(items.length, html`<span class="ck-count" aria-live="polite"><b data-ck-done>${doneCount}</b> of ${items.length} ready</span>`)}</summary>
    <p class="muted small">A general guide. Your ${r.subject === 'business' ? 'city, barangay or agency' : 'agency'} may ask for more or less, so check with them before you go.</p>
    <dl class="ck-facts">
      ${when(t.where_to_file, html`<dt>Where</dt><dd>${t.where_to_file}</dd>`)}
      ${when(t.online_url, html`<dt>Online</dt><dd>${external(t.online_url, t.online_label || 'Official website')}</dd>`)}
      ${when(cityLink, html`<dt>Online</dt><dd>${external(cityLink, `Find ${city}'s online renewal`)} <small class="muted">(a web search; use the city's own .gov.ph site)</small></dd>`)}
      ${when(t.validity_note, html`<dt>Valid for</dt><dd>${t.validity_note}</dd>`)}
    </dl>
    ${when(deps.length, html`<div class="ck-deps"><b>Do these first</b>
      ${deps.map((d) => d.req
        ? html`<a class="ck-dep" href="#/requirement/${d.req.id}"><span>${d.req.name}</span>${statusChip(d.req.status)}</a>`
        : html`<div class="ck-dep missing"><span>${d.type.name} <small class="muted">· not tracked here yet</small></span>
            ${when(edit, html`<button class="btn btn-sm btn-soft" data-act="req-add" data-subject="${r.subject}" data-id="${r.business_id || r.vehicle_id || r.person_id}"
              data-type="${d.code}" ${r.location_id ? html`data-loc="${r.location_id}"` : ''}>Add it</button>`)}</div>`)}</div>`)}
    ${when(items.length, html`<div class="ck-progress" aria-hidden="true"><span style="width:${Math.round((doneCount / items.length) * 100)}%"></span></div>
      <ul class="ck-list">${items.map((i) => {
        const tick = done.get(i.k);
        const dep = i.dep ? sibling(r, i.dep) : null;
        return html`<li class="${tick ? 'done' : ''}"><label class="ck-item">
          <input type="checkbox" data-ck="${i.k}" ${tick ? 'checked' : ''} ${edit ? '' : 'disabled'}>
          <span class="ck-text"><span class="ck-t">${i.t}</span>
            ${when(i.d, html`<small>${i.d}</small>`)}
            ${dep ? html`<small class="ck-dep-status">In PermitPal: ${STATUS[dep.status]?.label || dep.status}${dep.status === 'compliant' && dep.expires_on ? ` until ${fmtDate(dep.expires_on)}` : ''}</small>` : ''}
            ${tick ? html`<small class="ck-who">Ticked by ${tick.done_by === S.user?.id ? 'you' : memberName(tick.done_by)}, ${fmtDate(String(tick.done_at).slice(0, 10))}</small>` : ''}
          </span></label>
          ${when(i.u, html`<span class="ck-link">${external(i.u, 'Open')}</span>`)}
          ${i.k === 'inspect' ? walkthroughLine(r) : ''}
          ${(() => { const p = placementFor(r, i.k); return p ? placementLine(p, r) : ''; })()}</li>`;
      })}</ul>`)}
    ${(() => { const p = placementFor(r, null); return p ? placementLine(p, r) : ''; })()}
    ${when(edit && r.expires && !['in_progress', 'compliant'].includes(r.status), html`<p class="ck-hint" data-ck-hint ${doneCount ? '' : 'hidden'}>
      Filed it already? Tap <b>I've started the renewal</b> above, so your team isn't alerted that it hasn't started.</p>`)}
    ${when(!edit, html`<p class="muted small">You can view this checklist. Only people who can edit can tick items.</p>`)}
    ${offer}
  </details>`;
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
