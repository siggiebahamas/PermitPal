// Exhaustive UI sweep. Loads the real app (mock data layer) and, for every page, every workspace type,
// desktop and phone, clicks every visible control with a real mouse click, opens every layer it reveals
// (pop-ups, tabs, expanders, confirm dialogs) and clicks everything inside those too, submits every
// form empty and filled in. Reports: JS errors, crashes, covered/unclickable controls, controls that do
// nothing, forms that give no feedback, leaked "undefined/NaN/[object Object]" text, sideways scroll.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const PORT = 4190;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = p.startsWith('/__mock/') ? path.join(root, 'tests/ui', p.slice(8)) : path.join(root, 'web', p);
  let file2 = file; if (fs.existsSync(file2) && fs.statSync(file2).isDirectory()) file2 = path.join(file2, 'index.html');
  if (!fs.existsSync(file2)) { res.writeHead(404); return res.end('404'); }
  let body = fs.readFileSync(file2);
  if (p === '/index.html') {
    body = String(body).replace('"./js/data.js"', '"/__mock/mock-data.js"').replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
      .replace(/<link[^>]+fonts\.(googleapis|gstatic)\.com[^>]*>/g, '');
  }
  res.writeHead(200, { 'Content-Type': types[path.extname(file2)] || 'application/octet-stream' });
  res.end(body);
});
await new Promise((r) => server.listen(PORT, r));
const BASE = `http://localhost:${PORT}/`;

const VIEWPORTS = { desktop: { width: 1280, height: 860 }, phone: { width: 390, height: 844 } };
const ALL = ['#/', '#/businesses', '#/businesses/b1', '#/businesses/b2', '#/vehicles', '#/vehicles/v1', '#/vehicles/v3', '#/people', '#/people/pp1',
  '#/compliance', '#/documents', '#/pros', '#/network', '#/costs', '#/sharing', '#/notifications', '#/history', '#/trash', '#/team',
  '#/settings', '#/settings/billing', '#/settings/workspace', '#/admin', '#/contact', '#/connect/tokdavao', '#/connect/nosuchtoken',
  'REQ:action_required', 'REQ:renew_soon', 'REQ:in_progress', 'REQ:needs_information', 'REQ:compliant'];
const TEAM = ['#/', '#/network', '#/settings/workspace', '#/settings/billing'];
const SCENARIOS = [
  { name: 'business', init: { PP_DEMO: true, PP_KIND: 'business' }, routes: ALL },
  { name: 'head_office', init: { PP_DEMO: true }, routes: [...TEAM, '#/notifications', '#/settings', '#/connect/tokdavao'] },
  { name: 'firm', init: { PP_DEMO: true, PP_KIND: 'firm' }, routes: TEAM },
  { name: 'property', init: { PP_DEMO: true, PP_KIND: 'property' }, routes: TEAM },
  { name: 'fleet', init: { PP_DEMO: true, PP_KIND: 'fleet' }, routes: TEAM },
  { name: 'logged-out', init: { PP_DEMO: true, PP_LOGGED_OUT: true }, routes: ['#/', '#/login', '#/signup', '#/forgot', '#/contact', '#/contact?topic=privacy',
    '#/signup?type=fleet', '#/connect/tokdavao', '#/invite/abc', 'STATIC:privacy.html', 'STATIC:terms.html'] },
];
const ONLY = process.argv[2] ? process.argv[2].split(',') : null;
const MAX_DEPTH = 3;
const WORKERS = 4;

const problems = new Map(); // key -> {count, where:Set}
const notes = new Map();
const OUT = process.env.SWEEP_OUT || 'sweep-findings.jsonl';
fs.writeFileSync(OUT, '');
const add = (map, key, where) => {
  const x = map.get(key) || { count: 0, where: new Set() }; x.count++; if (x.where.size < 4) x.where.add(where); map.set(key, x);
  fs.appendFileSync(OUT, JSON.stringify({ kind: map === problems ? 'problem' : 'note', key, where }) + '\n');
};
const shellTested = new Set();
let clicks = 0, states = 0;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const IGNORE = /ERR_CERT_AUTHORITY_INVALID|fonts\.g|favicon|net::ERR_FILE_NOT_FOUND.*\.woff/;

async function newPage(scn, vp) {
  const ctx = await browser.newContext({ viewport: VIEWPORTS[vp], acceptDownloads: true });
  await ctx.addInitScript((init) => {
    Object.assign(globalThis, init);
    window.open = () => ({ document: { write() {}, close() {} }, location: {}, close() {}, focus() {}, print() {} });
    window.print = () => {};
    window.__nativeDialogs = 0;
    window.alert = () => { window.__nativeDialogs++; }; window.confirm = () => { window.__nativeDialogs++; return true; }; window.prompt = () => { window.__nativeDialogs++; return 'x'; };
    try { navigator.clipboard.writeText = async () => {}; } catch {}
  }, scn.init);
  const page = await ctx.newPage();
  page.errs = [];
  page.on('pageerror', (e) => page.errs.push('JS error: ' + e.message.split('\n')[0]));
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text() + (m.location()?.url || ''))) page.errs.push('console: ' + m.text().slice(0, 160)); });
  page.downloads = 0; page.on('download', () => { page.downloads++; });
  ctx.on('page', () => { page.popups = (page.popups || 0) + 1; });
  return { ctx, page };
}

let nonce = 0;
async function gotoRoute(page, route) {
  if (route.startsWith('STATIC:')) { await page.goto(BASE + route.slice(7) + '?n=' + (++nonce)); await page.waitForTimeout(250); return; }
  if (route.startsWith('REQ:')) {
    await page.goto(BASE + '?n=' + (++nonce) + '#/compliance');
    await page.waitForSelector('main h1', { timeout: 8000 }).catch(() => {});
    const st = route.slice(4);
    const href = await page.evaluate((st) => {
      const cls = { action_required: 'overdue', renew_soon: 'soon', in_progress: 'progress', needs_information: 'needinfo', compliant: 'ok' }[st];
      return document.querySelector(`.row.${cls}[data-href]`)?.dataset.href;
    }, st);
    if (!href) throw new Error('no requirement with status ' + st);
    await page.evaluate((h) => { location.hash = h; }, href);
    await page.waitForTimeout(450);
    return;
  }
  await page.goto(BASE + '?n=' + (++nonce) + route);
  await page.waitForSelector('main h1, .auth-card, .landing, h1', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(350);
}

// Everything clickable in the top layer (open pop-up > bell drop-down > page), with a stable signature.
const ENUM = () => {
  document.querySelectorAll('input').forEach((e) => { const cs = getComputedStyle(e); if ((cs.opacity === '0' || cs.pointerEvents === 'none') && e.closest('label')) e.closest('label').setAttribute('data-sweep-proxy', ''); });
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !e.closest('[hidden]') && !e.closest('details:not([open]) > :not(summary)') && (!e.checkVisibility || e.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true })); };
  const scope = document.querySelector('#modal-root .modal') || document.querySelector('.bell-drop') || document;
  const sel = 'a[href], button, [data-act], [data-href], select, input, textarea, summary, [role=button], [role=tab], label[data-sweep-proxy]';
  const out = []; const seen = new Map();
  for (const e of scope.querySelectorAll(sel)) {
    if (!vis(e)) continue;
    if (e.closest('[data-sweep-skip]')) continue;
    if (e.tagName === 'INPUT' && e.closest('label[data-sweep-proxy]')) { const cs = getComputedStyle(e); if (cs.opacity === '0' || cs.pointerEvents === 'none') continue; }
    const tag = e.tagName.toLowerCase();
    const type = (e.getAttribute('type') || (e.tagName === 'BUTTON' && e.closest('form') ? 'submit' : '')).toLowerCase();
    if (tag === 'input' && ['hidden'].includes(type)) continue;
    if (tag === 'input' && (getComputedStyle(e).opacity === '0' || getComputedStyle(e).pointerEvents === 'none') && e.closest('label')) { e.closest('label').setAttribute('data-sweep-proxy', ''); }
    let href = e.getAttribute('href') || e.dataset.href || '';
    href = href.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, ':id').replace(/\/(b|v|pp|l|o|n)\d+\b/g, '/:id');
    const text = (e.getAttribute('aria-label') || e.textContent || e.value || e.name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    const sig = [tag, type, e.dataset.act || '', e.dataset.tab || e.dataset.v || e.dataset.f || '', href, tag === 'input' || tag === 'select' || tag === 'textarea' ? (e.name || '') : text].join('|');
    const nth = seen.get(sig) || 0; seen.set(sig, nth + 1);
    const inForm = !!e.closest('form');
    const r = e.getBoundingClientRect();
    out.push({ sig, nth, tag, type, text, href, inForm, disabled: !!e.disabled, act: e.dataset.act || '', external: /^https?:|^mailto:|^tel:/.test(href) || e.target === '_blank',
      clipped: (r.right > innerWidth + 1 || r.left < -1) && !(() => { for (let a = e.parentElement; a; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if ((o === 'auto' || o === 'scroll') && a.scrollWidth > a.clientWidth) return true; } return false; })(), inModal: !!e.closest('#modal-root'), inSidebar: !!e.closest('.sidebar'), inShell: !e.closest('#modal-root') && !!e.closest('.sidebar, .topbar, .tabbar, .bell-drop, #banner') });
  }
  return out;
};
async function mark(page, sig, nth) {
  return page.evaluate(({ sig, nth, ENUMSRC }) => {
    document.querySelectorAll('[data-sweep]').forEach((e) => e.removeAttribute('data-sweep'));
    const list = (0, eval)('(' + ENUMSRC + ')')();
    const want = list.find((x) => x.sig === sig && x.nth === nth);
    if (!want) return false;
    // re-find the element by walking the same selector in the same order
    const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !e.closest('[hidden]') && !e.closest('details:not([open]) > :not(summary)') && (!e.checkVisibility || e.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true })); };
    const scope = document.querySelector('#modal-root .modal') || document.querySelector('.bell-drop') || document;
    const els = [...scope.querySelectorAll('a[href], button, [data-act], [data-href], select, input, textarea, summary, [role=button], [role=tab], label[data-sweep-proxy]')]
      .filter((e) => vis(e) && !e.closest('[data-sweep-skip]') && !(e.tagName === 'INPUT' && (e.getAttribute('type') || '').toLowerCase() === 'hidden')
        && !(e.tagName === 'INPUT' && e.closest('label[data-sweep-proxy]') && (getComputedStyle(e).opacity === '0' || getComputedStyle(e).pointerEvents === 'none')));
    const idx = list.indexOf(want);
    els[idx].setAttribute('data-sweep', 't');
    return true;
  }, { sig, nth, ENUMSRC: ENUM.toString() });
}

async function snapshot(page) {
  return page.evaluate(() => {
    window.__mut = 0;
    if (window.__mo) window.__mo.disconnect();
    window.__mo = new MutationObserver((m) => { window.__mut += m.length; });
    window.__mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    window.__y0 = scrollY; document.querySelectorAll('*').forEach((e) => { if (e.scrollTop) e.__st = e.scrollTop; });
    return { hash: location.hash, path: location.pathname, modal: document.querySelector('#modal-root .modal h3')?.textContent || '', modalHtml: document.querySelector('#modal-root .modal')?.innerHTML.length || 0 };
  });
}
async function observe(page, before) {
  await page.waitForTimeout(500);
  return page.evaluate((before) => ({
    hashChanged: location.hash !== before.hash || location.pathname !== before.path,
    hash: location.hash,
    modal: document.querySelector('#modal-root .modal h3')?.textContent || '',
    modalErr: (() => { const e = document.querySelector('#modal-root .modal-error, .form-error'); return e && !e.hidden ? e.textContent.trim() : ''; })(),
    mut: window.__mut + (Math.abs(scrollY - window.__y0) > 2 ? 1 : 0),
    toast: document.getElementById('toast')?.className.includes('show') ? document.getElementById('toast').textContent : (document.getElementById('toast')?.textContent || ''),
    crash: /Something went wrong/.test(document.body.innerText),
    leak: (document.body.innerText.match(/\b(undefined|NaN|\[object Object\]|Invalid Date|null null)\b/) || [])[0] || '',
    native: window.__nativeDialogs,
    overflow: document.documentElement.scrollWidth - innerWidth,
  }), before);
}

const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
async function fillModal(page) {
  return page.evaluate(({ past, future }) => {
    const m = document.querySelector('#modal-root .modal') || [...document.querySelectorAll('main form, .auth-card form')].find((f) => f.getClientRects().length);
    if (!m) return 0;
    let n = 0;
    const setVal = (el, v) => { const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); n++; };
    for (const el of m.querySelectorAll('input, select, textarea')) {
      if (el.disabled || !el.getClientRects().length || el.closest('[hidden]')) continue;
      const t = (el.type || '').toLowerCase(); const nm = (el.name || '').toLowerCase();
      if (el.tagName === 'SELECT') { const o = [...el.options].find((o, i) => i > 0 && o.value && !o.disabled) || [...el.options].find((o) => o.value); if (o && !el.value) setVal(el, o.value); continue; }
      if (t === 'checkbox') { if (el.required && !el.checked) { el.click(); n++; } continue; }
      if (t === 'radio' || t === 'file' || t === 'hidden' || t === 'submit' || t === 'button') continue;
      if (el.value && t !== 'date') continue;
      if (t === 'email') setVal(el, 'owner@example.com');
      else if (t === 'date') { if (!el.value) setVal(el, /issued|start|paid|from/.test(nm) ? past : future); }
      else if (t === 'number') setVal(el, el.min && Number(el.min) > 1 ? el.min : '1500');
      else if (t === 'tel' || /phone|mobile/.test(nm)) setVal(el, '09171234567');
      else if (t === 'password') setVal(el, 'Passw0rd!123');
      else if (t === 'url' || /website|url/.test(nm)) setVal(el, 'https://example.com');
      else if (/plate/.test(nm)) setVal(el, 'ABC 1234');
      else if (el.tagName === 'TEXTAREA') setVal(el, 'Test note from the sweep.');
      else setVal(el, 'Test ' + (nm || 'value').replace(/_/g, ' ').slice(0, 20));
    }
    return n;
  }, { past: iso(new Date(today.getTime() - 10 * 864e5)), future: iso(new Date(today.getTime() + 200 * 864e5)) });
}
async function attachFiles(page) {
  const inputs = page.locator('#modal-root input[type=file]:visible, main form input[type=file]:visible');
  const n = await inputs.count();
  for (let i = 0; i < n; i++) {
    const accept = (await inputs.nth(i).getAttribute('accept')) || '';
    const csv = /csv/.test(accept);
    await inputs.nth(i).setInputFiles(csv
      ? { name: 'vehicles.csv', mimeType: 'text/csv', buffer: Buffer.from('Make and model,Plate number,Vehicle type,Registration expires\nToyota Vios,ABC 1234,Sedan,2027-03-01\n') }
      : { name: 'permit.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%sweep\n') }).catch(() => {});
  }
}

// Replay a state: route + list of steps ({k:'click', sig, nth} | {k:'fill'} )
async function replay(page, st) {
  await gotoRoute(page, st.route);
  for (const s of st.steps) {
    if (s.k === 'click') {
      if (!(await mark(page, s.sig, s.nth))) throw new Error('replay: element gone ' + s.sig);
      await page.evaluate(() => document.querySelector('[data-sweep=t]')?.scrollIntoView({ block: 'center', inline: 'nearest' }));
      await page.locator('[data-sweep=t]').click({ timeout: 3000, noWaitAfter: true });
      await page.waitForTimeout(450);
    } else if (s.k === 'fill') {
      await fillModal(page); await attachFiles(page);
      const inModal = await page.locator('#modal-root button[type=submit]').count();
      const sub = inModal ? page.locator('#modal-root button[type=submit]').first() : page.locator('main form button:not([type=button]):visible, .auth-card form button:not([type=button]):visible').first();
      await sub.click({ timeout: 3000 }); await page.waitForTimeout(700);
    }
  }
}

const seenStates = new Set();
const queue = [];
const where = (st, vp, scn) => `${scn.name}/${vp} ${st.route}${st.steps.length ? ' > ' + st.steps.map((s) => s.k === 'fill' ? '[fill+submit]' : (s.label || s.sig)).join(' > ') : ''}`;

async function exploreState(scn, vp, st, page) {
  states++;
  if (states % 10 === 0) fs.writeFileSync(OUT + '.progress', `${new Date().toISOString()} states ${states} queued ${queue.length} clicks ${clicks} problems ${problems.size}\n`);
  try { await replay(page, st); } catch (e) { add(problems, 'Could not reach state: ' + e.message.split('\n')[0], where(st, vp, scn)); return; }
  const base = await observe(page, await snapshot(page));
  const wBase = where(st, vp, scn);
  if (page.errs.length) { for (const e of page.errs) add(problems, e, wBase + ' (on load)'); page.errs.length = 0; }
  if (base.crash) add(problems, 'Page shows "Something went wrong"', wBase);
  if (base.leak) add(problems, `Page shows the text "${base.leak}"`, wBase);
  if (base.overflow > 1) add(problems, `Sideways scroll (${base.overflow}px)`, wBase);
  const items = await page.evaluate(ENUM);
  if (!st.steps.length) {
    const pageForms = await page.evaluate(() => [...document.querySelectorAll('main form, .auth-card form')].filter((f) => f.getClientRects().length && f.querySelector('button:not([type=button])') && f.querySelector('input:not([type=hidden]):not([type=search]), textarea')).length);
    if (pageForms) push(scn, vp, { route: st.route, steps: [{ k: 'fill' }], fill: true });
  }
  // limit repeats: same control signature appears in long lists; test the first two.
  const tasks = [];
  for (const it of items) {
    if (it.nth > 1) continue;
    if (it.clipped) add(problems, `Control cut off at the screen edge: ${it.tag} "${it.text}"`, wBase);
    if (it.disabled) continue;
    if (it.tag === 'a' && it.href && it.href === (base.hash || '#/')) continue; // link to the page you are on
    if (it.act === 'sign-out' || it.act === 'lang') continue;
    if (it.inShell) { const k = scn.name + '|' + vp + '|' + it.sig + '|' + it.nth; if (shellTested.has(k)) continue; shellTested.add(k); }
    if (it.external) { if (!/^https?:\/\/|^mailto:|^tel:/.test(it.href) && it.href && !it.href.startsWith('#')) tasks.push({ it, kind: 'statichref' }); continue; }
    if (it.tag === 'input' && ['text', 'email', 'number', 'tel', 'password', 'date', 'url', ''].includes(it.type)) continue; // plain fields
    if (it.tag === 'textarea') continue;
    if (it.tag === 'input' && it.type === 'file') continue;
    tasks.push({ it, kind: it.tag === 'select' ? 'select' : it.tag === 'input' && it.type === 'search' ? 'search' : 'click' });
  }
  // static links (privacy.html etc.) are checked once
  for (const t of tasks.filter((t) => t.kind === 'statichref')) {
    const target = t.it.href.split('#')[0].split('?')[0];
    if (target && !fs.existsSync(path.join(root, 'web', target))) add(problems, `Link to a missing file: ${t.it.href}`, wBase);
  }
  for (const t of tasks.filter((t) => t.kind !== 'statichref')) {
    const it = t.it;
    const label = `${it.tag}${it.act ? '[' + it.act + ']' : ''} "${it.text}"`;
    const w = wBase + ' :: ' + label;
    try {
      await replay(page, st);
      page.errs.length = 0; page.downloads = 0; page.popups = 0;
      if (!(await mark(page, it.sig, it.nth))) { add(notes, 'Control vanished on reload (dynamic)', w); continue; }
      if (t.kind === 'select') {
        const opts = await page.locator('[data-sweep=t] option').evaluateAll((os) => os.map((o) => o.value));
        for (const v of opts.slice(0, 6)) {
          const before = await snapshot(page);
          await page.locator('[data-sweep=t]').selectOption(v, { timeout: 3000 }).catch((e) => add(problems, 'Could not choose option: ' + e.message.split('\n')[0], w));
          clicks++;
          const ob = await observe(page, before);
          if (ob.crash) add(problems, 'Choosing an option crashed the page', w + ' = ' + v);
          if (!(await mark(page, it.sig, it.nth))) break; // page re-rendered without this control (fine: e.g. filter changed view)
        }
      } else if (t.kind === 'search') {
        const before = await snapshot(page);
        await page.locator('[data-sweep=t]').fill('zzz no match', { timeout: 3000 }); await page.waitForTimeout(500);
        await page.locator('[data-sweep=t]').fill('a').catch(() => {}); clicks++;
        const ob = await observe(page, before);
        if (ob.crash) add(problems, 'Typing in search crashed the page', w);
      } else {
        const before = await snapshot(page);
        await page.evaluate(() => document.querySelector('[data-sweep=t]')?.scrollIntoView({ block: 'center', inline: 'nearest' }));
        try { await page.locator('[data-sweep=t]').click({ timeout: 3000, noWaitAfter: true }); }
        catch (e) {
          const msg = e.message;
          if (/intercepts pointer events/.test(msg)) { const by = (msg.match(/<([a-z]+[^>]{0,80})>.*intercepts pointer events/) || [])[1] || ''; add(problems, `Covered by another element, cannot be tapped: ${label}${by ? ' (covered by <' + by + '>)' : ''}`, wBase); }
          else if (/outside of the viewport/.test(msg)) add(problems, `Off-screen, cannot be tapped: ${label}`, wBase);
          else add(problems, `Click failed: ${label}: ${msg.split('\n')[0].slice(0, 120)}`, wBase);
          continue;
        }
        clicks++;
        const ob = await observe(page, before);
        if (ob.crash) add(problems, 'Clicking crashed the page ("Something went wrong")', w);
        if (ob.leak && !base.leak) add(problems, `After clicking, page shows "${ob.leak}"`, w);
        if (ob.native > 0) add(problems, 'Uses a browser alert/confirm box instead of the site\'s own dialog', w);
        const modalOpened = ob.modal && (ob.modal !== before.modal || (await page.evaluate(() => document.querySelector('#modal-root .modal')?.innerHTML.length || 0)) !== before.modalHtml);
        const nothing = !ob.hashChanged && !ob.modal && ob.mut === 0 && !ob.toast && !page.downloads && !page.popups && !before.modal;
        const isField = it.inForm && (it.tag === 'input' || it.tag === 'select' || it.tag === 'label');
        const nativeInvalid = nothing && it.type === 'submit' && await page.evaluate(() => !!document.querySelector('form :invalid'));
        if (nothing && !nativeInvalid && !isField && it.type !== 'checkbox' && it.type !== 'radio') add(problems, 'Click did nothing visible', w);
        // empty-submit feedback check: a submit that leaves the pop-up open must say why
        if (it.inModal && it.type === 'submit' && ob.modal && ob.modal === before.modal && !ob.modalErr && !ob.hashChanged) {
          const changed = (await page.evaluate(() => document.querySelector('#modal-root .modal')?.innerHTML.length || 0)) !== before.modalHtml;
          if (!changed) add(problems, 'Submitting the pop-up gave no feedback (stayed open, no message)', w);
        }
        // go deeper: new pop-up, or revealed controls (tabs, expanders, drop-downs)
        if (st.steps.length < MAX_DEPTH && !ob.hashChanged) {
          const step = { k: 'click', sig: it.sig, nth: it.nth, label };
          if (modalOpened) {
            push(scn, vp, { route: st.route, steps: [...st.steps, step] }, ob.modal);
            const hasSubmit = await page.locator('#modal-root button[type=submit]').count();
            const fields = await page.locator('#modal-root input:visible, #modal-root select:visible, #modal-root textarea:visible').count();
            if (hasSubmit && fields) push(scn, vp, { route: st.route, steps: [...st.steps, step, { k: 'fill' }], fill: true }, ob.modal);
          } else if (!ob.modal && ob.mut > 0) {
            const now = await page.evaluate(ENUM);
            const oldSigs = new Set(items.map((x) => x.sig)); const nowSigs = new Set(now.map((x) => x.sig));
            const added = now.filter((x) => !oldSigs.has(x.sig) && !x.disabled && !x.inShell).length;
            const gone = items.filter((x) => !nowSigs.has(x.sig) && !x.inShell).length;
            if (added && gone <= 3) push(scn, vp, { route: st.route, steps: [...st.steps, step] });
          }
        }
      }
      for (const e of page.errs) add(problems, e, w);
    } catch (e) { add(problems, `Sweep error on ${label}: ${e.message.split('\n')[0].slice(0, 140)}`, wBase); }
  }
  // a filled-in submit: record the result of the fill step itself
  if (st.fill) {
    const ob = await page.evaluate(() => ({ modal: document.querySelector('#modal-root .modal h3')?.textContent || '', err: (() => { const e = document.querySelector('#modal-root .modal-error, .form-error'); return e && !e.hidden ? e.textContent.trim() : ''; })() }));
    if (ob.err) add(notes, `Filled-in form was refused: "${ob.err}"`, wBase);
  }
}
const perRoute = new Map();
const seenModals = new Set();
function push(scn, vp, st, modalTitle = null) {
  const key = scn.name + '|' + vp + '|' + st.route.replace(/\?.*/, '') + '|' + st.steps.map((s) => s.k === 'fill' ? 'F' : s.sig + '#' + s.nth).join('>');
  if (seenStates.has(key)) return;
  seenStates.add(key);
  if (modalTitle != null) {
    // the same pop-up opened from another row (e.g. "Record renewal — <any permit>") only needs testing once per page
    const mk = scn.name + '|' + vp + '|' + st.route.replace(/\?.*/, '').replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, ':id') + '|' + (st.fill ? 'F|' : '') + modalTitle.split(/ — | - /)[0].trim();
    if (seenModals.has(mk)) return;
    seenModals.add(mk);
  }
  const rk = scn.name + '|' + vp + '|' + st.route;
  const n = perRoute.get(rk) || 0;
  if (st.steps.length && n >= 45) return;
  perRoute.set(rk, n + 1);
  queue.push({ scn, vp, st });
}

for (const scn of SCENARIOS) {
  if (ONLY && !ONLY.includes(scn.name)) continue;
  for (const vp of Object.keys(VIEWPORTS)) for (const route of scn.routes) push(scn, vp, { route, steps: [] });
}
const started = Date.now();
async function worker() {
  let cur = null;
  while (queue.length) {
    const job = queue.shift();
    if (!cur || cur.key !== job.scn.name + job.vp) {
      if (cur) await cur.ctx.close();
      const { ctx, page } = await newPage(job.scn, job.vp);
      cur = { key: job.scn.name + job.vp, ctx, page };
    }
    await exploreState(job.scn, job.vp, job.st, cur.page);
  }
  if (cur) await cur.ctx.close();
}
// keep workers alive while others may still enqueue
async function run() {
  const active = new Set();
  while (queue.length || active.size) {
    while (queue.length && active.size < WORKERS) {
      const job = queue.shift();
      const p = (async () => { const { ctx, page } = await newPage(job.scn, job.vp); try { await exploreState(job.scn, job.vp, job.st, page); } finally { await ctx.close(); } })();
      active.add(p); p.finally(() => active.delete(p));
    }
    if (active.size) await Promise.race(active);
  }
}
await run();
const print = (title, map) => {
  console.log(`\n=== ${title} (${map.size}) ===`);
  for (const [k, v] of [...map.entries()].sort((a, b) => b[1].count - a[1].count)) console.log(`- ${k}  [x${v.count}]\n    ${[...v.where].join('\n    ')}`);
};
console.log(`states: ${states}, interactions: ${clicks}, time: ${Math.round((Date.now() - started) / 1000)}s`);
print('PROBLEMS', problems);
print('NOTES (review)', notes);
await browser.close(); server.close();
