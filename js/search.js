// The search box at the top. Tapping it opens a short menu of what you can find: quick filters by status,
// your lists, and every tool by name, so nobody has to learn the sidebar first. Typing shows matching permits,
// businesses, vehicles, people and pages as you go; Enter still opens every matching permit in Compliance.
import { html } from './util.js?v=fd3a394';
import { S } from './core.js?v=fd3a394';
import { STATUS, ICON } from './components.js?v=fd3a394';

const norm = (s) => String(s || '').toLowerCase();
const QUICK = ['action_required', 'renew_soon', 'needs_information', 'in_progress'];

// pages: [[href, label]] for the lists and tools this workspace has.
export function wireSearch(form, pages) {
  if (!form) return;
  const input = form.querySelector('input');
  const box = document.createElement('div');
  box.className = 'sx';
  box.id = 'search-menu';
  box.setAttribute('role', 'listbox');
  box.hidden = true;
  form.appendChild(box);
  input.setAttribute('aria-controls', 'search-menu');
  input.setAttribute('aria-expanded', 'false');

  const open = () => { paint(); box.hidden = false; input.setAttribute('aria-expanded', 'true'); };
  const close = () => { box.hidden = true; input.setAttribute('aria-expanded', 'false'); };
  const counts = () => { const c = {}; for (const r of S.data?.reqs || []) c[r.status] = (c[r.status] || 0) + 1; return c; };

  function empty() {
    const c = counts();
    const lists = pages.filter(([h]) => ['#/businesses', '#/vehicles', '#/people', '#/documents', '#/compliance'].includes(h));
    const tools = pages.filter((p) => !lists.includes(p));
    return html`<div class="sx-sec"><b class="sx-h">Show me permits that are</b>
        <div class="sx-chips">${QUICK.map((k) => html`<a class="sx-chip ${STATUS[k].cls}" href="#/compliance?status=${k}" data-sx>${STATUS[k].label}<span>${c[k] || 0}</span></a>`)}</div></div>
      <div class="sx-sec"><b class="sx-h">Your lists</b>
        <div class="sx-chips">${lists.map(([h, l]) => html`<a class="sx-chip plain" href="${h}" data-sx>${l}</a>`)}</div></div>
      <div class="sx-sec"><b class="sx-h">Tools</b>
        <div class="sx-links">${tools.map(([h, l]) => html`<a href="${h}" data-sx>${l}</a>`)}</div></div>
      <p class="sx-tip">Or type a permit, a plate number, a business or a person.</p>`;
  }

  function results(q) {
    const d = S.data || {};
    const hit = (...xs) => xs.some((x) => norm(x).includes(q));
    const permits = (d.reqs || []).filter((r) => hit(r.name, r.subject_name, r.plate_no)).slice(0, 5);
    const biz = (d.businesses || []).filter((b) => hit(b.name)).slice(0, 3);
    const cars = (d.vehicles || []).filter((v) => hit(v.plate_no, v.make_model)).slice(0, 3);
    const ppl = (d.people || []).filter((p) => hit(p.full_name)).slice(0, 3);
    const pg = pages.filter(([, l]) => norm(l).includes(q)).slice(0, 4);
    const group = (title, rows) => (rows.length ? html`<div class="sx-sec"><b class="sx-h">${title}</b>${rows}</div>` : '');
    const row = (href, main, sub = '', chip = '') => html`<a class="sx-row" href="${href}" data-sx><span><b>${main}</b>${sub ? html`<small>${sub}</small>` : ''}</span>${chip}</a>`;
    const any = permits.length + biz.length + cars.length + ppl.length + pg.length;
    return html`${group('Permits', permits.map((r) => row(`#/requirement/${r.id}`, r.name, [r.subject_name, r.plate_no].filter(Boolean).join(' · '),
        html`<span class="chip ${STATUS[r.status]?.cls || ''}">${STATUS[r.status]?.label || ''}</span>`)))}
      ${group('Businesses', biz.map((b) => row(`#/businesses/${b.id}`, b.name)))}
      ${group('Vehicles', cars.map((v) => row(`#/vehicles/${v.id}`, v.plate_no || v.make_model, v.plate_no ? v.make_model : '')))}
      ${group('People', ppl.map((p) => row(`#/people/${p.id}`, p.full_name)))}
      ${group('Pages', pg.map(([h, l]) => row(h, l)))}
      ${any ? '' : html`<p class="sx-tip">Nothing matches "${q}" yet.</p>`}
      <a class="sx-all" href="#/compliance?q=${encodeURIComponent(q)}" data-sx>${ICON.search} See every permit matching "${q}"</a>`;
  }

  function paint() {
    const q = norm(input.value).trim();
    box.innerHTML = String(q ? results(q) : empty());
  }

  input.addEventListener('focus', open);
  input.addEventListener('input', () => { if (box.hidden) open(); else paint(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); input.blur(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); box.querySelector('[data-sx]')?.focus(); }
  });
  box.addEventListener('keydown', (e) => {
    const all = [...box.querySelectorAll('[data-sx]')];
    const i = all.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); all[Math.min(all.length - 1, i + 1)]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); (i <= 0 ? input : all[i - 1]).focus(); }
    if (e.key === 'Escape') { close(); input.focus(); }
  });
  box.addEventListener('click', (e) => { if (e.target.closest('[data-sx]')) { close(); input.value = ''; input.blur(); } });
  document.addEventListener('pointerdown', (e) => { if (!form.contains(e.target)) close(); });
  form.addEventListener('focusout', () => setTimeout(() => { if (!form.contains(document.activeElement)) close(); }, 0));
  window.addEventListener('hashchange', close);
}
