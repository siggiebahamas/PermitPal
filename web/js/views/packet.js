// The renewal packet on a business permit's page. Pinoy Permit fills in what it already knows (the business, the branch,
// last year's permit and answers, the files on record) and asks only what's missing or new, one question at a time:
// last year's sales, how many people work there, whether anything changed, and any detail it doesn't have yet.
// Then the packet is ready: a checklist, the application details in the order of the city's form, a sworn declaration
// of sales, an authorization letter and copies of the files, to print, download, or copy into the city's online form.
// Nothing goes to the city from here: the business (or whoever files for it) files and pays.
import { html, fmtDate, toast, toastError, openModal, when, plural, peso, todayPH, download } from '../util.js';
import { S, on, has, canEdit, reload, business, location_, locationsOf, typeOf, reqById } from '../core.js';
import { ICON, STATUS, shortName } from '../components.js';
import { printSheet } from '../print.js';
import { makeZip } from '../zip.js';
import { readSales } from '../ocrparse.js';
import { packetYear, startAnswers, missingDetails, openSteps, appDetails, filledCount } from '../packet.js';
import * as db from 'pp/data';

let onChanged = () => {};
export const watchPacket = (fn) => { onChanged = fn; };
const PK = new Map(); // permit → its packets, as last shown

const ACTIVITY = { restaurant: 'Restaurant', retail: 'Retail', professional_services: 'Professional services', manufacturing: 'Manufacturing',
  construction: 'Construction', healthcare: 'Health services', school: 'School or training center', logistics: 'Logistics', other: '' };
const TITLE = { 'Sole Proprietorship': 'Owner', Partnership: 'Managing partner', Corporation: 'President', Cooperative: 'Chairperson' };
// The files worth bringing along, from the same business (and branch).
const COPY_TYPES = ['mayors_permit', 'barangay_clearance', 'fsic', 'sanitary_permit', 'bir_cor', 'dti_business_name', 'sec_registration', 'cda_registration'];

export const packetApplies = (r) => has('packet') && r?.type_code === 'mayors_permit' && r.expires && !!r.expires_on;
export const loadPackets = (r) => (packetApplies(r) ? db.packets(r.id).catch(() => []) : Promise.resolve([]));

// Everything the packet draws on, for one permit.
function ctxOf(r, packets = []) {
  const year = packetYear(r.expires_on, todayPH());
  const cur = packets.find((p) => p.permit_year === year) || null;
  const prev = packets.find((p) => p.permit_year < year) || null;
  const b = business(r.business_id) || { name: r.subject_name || '', structure: '', activity: 'other', tin: '' };
  const loc = (r.location_id && location_(r.location_id)) || locationsOf(r.business_id).find((l) => l.is_main) || locationsOf(r.business_id)[0] || null;
  const sibs = (S.data?.reqs || []).filter((x) => x.business_id === r.business_id && (!x.location_id || !r.location_id || x.location_id === r.location_id));
  const regReq = sibs.find((x) => ['dti_business_name', 'sec_registration', 'cda_registration'].includes(x.type_code) && x.reference_no);
  const a = startAnswers(prev?.answers, cur?.answers);
  const me = [S.profile?.first_name, S.profile?.last_name].filter(Boolean).join(' ');
  const known = {
    tin: b.tin || '', address: loc?.address || '', owner_name: a.owner_name || me, line: a.line || ACTIVITY[b.activity] || '',
    reg_no: a.reg_no || regReq?.reference_no || '', phone: a.phone || S.profile?.phone || '',
  };
  const city = loc?.city || '';
  return { r, year, cur, prev, b, loc, city, address: [loc?.address, city].filter(Boolean).join(', '), a, known, sibs, me };
}
const partsOf = (c) => appDetails({ year: c.year, biz: c.b, address: c.address, email: S.profile?.email || '', known: c.known, a: c.a,
  permit: { reference_no: c.r.reference_no, issued_on: c.r.issued_on ? fmtDate(c.r.issued_on) : '', expires_on: c.r.expires_on ? fmtDate(c.r.expires_on) : '' } });
const copiesOf = (c) => c.sibs.filter((x) => COPY_TYPES.includes(x.type_code) && x.cycle_id);

// ---------------------------------------------------------------- the card
export function packetCard(r, packets = []) {
  if (!packetApplies(r)) return '';
  PK.set(r.id, packets);
  const c = ctxOf(r, packets);
  if (!c.cur && r.days_left != null && r.days_left > 120) return '';
  const { filled, total } = filledCount(partsOf(c));
  const steps = openSteps(c.known, c.a);
  const edit = canEdit();
  if (!c.cur?.ready_at) {
    const pct = Math.round((filled / total) * 100);
    return html`<section class="card packet" data-packet>
      <div class="card-head"><div><h2>Your ${c.year} renewal packet</h2>
        <p class="muted small">The papers for renewing this business permit, filled in for you.</p></div>
        <span class="pk-tag">${steps.length ? `${plural(steps.length, 'question')} left` : 'Almost ready'}</span></div>
      <p>Pinoy Permit already has <b>${filled} of ${total}</b> details from your records${c.prev ? " and last year's packet" : ''}.
        ${steps.length ? `Answer ${steps.length === 1 ? 'one quick question' : `${steps.length} quick questions`} and the packet builds itself` : 'Everything is answered. Build it now'}: the application details,
        a sworn declaration of ${c.year - 1} sales, and copies of your files.</p>
      <div class="pk-progress" role="img" aria-label="${filled} of ${total} details filled in"><span style="width:${pct}%"></span></div>
      ${edit ? html`<div class="btn-row"><button class="btn btn-primary" data-act="packet-start" data-id="${r.id}">${steps.length ? `Answer ${plural(steps.length, 'question')}` : 'Build my packet'}</button>
        <span class="muted small">About a minute. Your answers are saved as you go.</span></div>`
        : html`<p class="muted small">Someone who can edit this workspace answers these.</p>`}
    </section>`;
  }
  const copies = copiesOf(c);
  const withFile = copies.filter((x) => x.document_count > 0);
  const brgy = c.sibs.find((x) => x.type_code === 'barangay_clearance');
  const brgyOk = brgy && brgy.status === 'compliant';
  return html`<section class="card packet ready" data-packet>
    <div class="card-head"><div><h2>Your ${c.year} renewal packet</h2>
      <p class="muted small">Filled in from your records and your answers. Check it, sign it, and bring it or upload it.</p></div>
      <span class="pk-tag ok">${ICON.check} Ready</span></div>
    <ul class="pk-list">
      <li><div><b>Application details</b><small>${filled} of ${total} filled in, in the order of the city's form${filled < total ? '. Blanks are yours to fill in by hand' : ''}</small></div>
        <span class="pk-tag ${filled < total ? 'warn' : 'ok'}">${filled < total ? `${total - filled} blank` : 'Filled in'}</span></li>
      <li><div><b>Sworn declaration of ${c.year - 1} sales</b><small>${peso(c.a.sales)}. Sign it in front of a notary</small></div><span class="pk-tag sign">Sign</span></li>
      <li><div><b>Authorization letter</b><small>Only if someone else files for you</small></div><span class="pk-tag">Optional</span></li>
      <li><div><b>Copies from your files</b><small>${withFile.length ? withFile.map((x) => shortName(x)).join(', ') : 'No copies uploaded yet'}</small></div>
        <span class="pk-tag ${withFile.length ? 'ok' : 'warn'}">${withFile.length ? `${withFile.length} attached` : 'None yet'}</span></li>
      <li><div><b>Barangay clearance for ${c.year}</b><small>${brgy ? (brgyOk ? `On file, valid until ${fmtDate(brgy.expires_on)}` : STATUS[brgy.status]?.label || 'Not ready') : 'Not tracked here yet'}. The city asks for it first</small></div>
        ${brgy ? html`<a class="pk-tag ${brgyOk ? 'ok' : 'warn'}" href="#/requirement/${brgy.id}">${brgyOk ? 'Open' : 'Get it'}</a>` : html`<span class="pk-tag warn">Get it</span>`}</li>
    </ul>
    <div class="btn-row wrap">
      <button class="btn btn-primary" data-act="packet-print" data-id="${r.id}">Print or save as PDF</button>
      <button class="btn btn-soft" data-act="packet-zip" data-id="${r.id}">${ICON.download} Download with copies (.zip)</button>
      <button class="btn btn-soft" data-act="packet-copy" data-id="${r.id}">Copy into an online form</button>
      ${when(edit, html`<button class="btn btn-ghost" data-act="packet-edit" data-id="${r.id}">Change answers</button>`)}
    </div>
    <p class="muted small">Renewing online (like QC E-Services)? Use "Copy into an online form", upload the copies from the .zip, then submit and pay on the city's site.</p>
  </section>`;
}

// ---------------------------------------------------------------- the questions, one at a time
let FLOW = null;
const STEP_TITLE = { sales: 'Sales', employees: 'People', changed: 'Changes', details: 'Details' };
// Pesos as people type them: 1842600, 1,842,600 or 1,842,600.50 (commas in threes, centavos optional).
const numIn = (v) => {
  const s = String(v ?? '').replace(/[₱\s]/g, '');
  if (s === '') return null;
  return /^(\d{1,3}(,\d{3})*|\d+)(\.\d{1,2})?$/.test(s) ? Number(s.replace(/,/g, '')) : NaN;
};
const money = (n) => (n == null ? '' : Number(n).toLocaleString('en-PH', { maximumFractionDigits: 2 }));

function begin(reqId, all) {
  const r = reqById(reqId);
  if (!r) return;
  const c = ctxOf(r, PK.get(reqId) || []);
  const steps = openSteps(c.known, c.a, all);
  FLOW = { r, c, a: { ...c.a }, all, steps, tin: c.b.tin || '', street: c.loc?.address || '' };
  if (!steps.length) { finish().catch(toastError); return; }
  show(0);
}

function stepBody(step, i) {
  const { c, a, all } = FLOW;
  const prevA = c.prev?.answers || {};
  const back = i > 0 ? html`<button type="button" class="btn btn-ghost btn-sm pk-back" data-pk-back>← Back</button>` : '';
  if (step === 'sales') {
    return html`${back}${i === 0 && !all ? html`<p class="pk-lead">Everything else came from your records${c.prev ? " and last year's packet" : ''}.
        ${FLOW.steps.length === 1 ? 'Just this one.' : `Only ${FLOW.steps.length} things to answer.`}</p>` : ''}
      <label class="field"><span>What were ${c.b.name}'s gross sales in ${c.year - 1}?</span>
        <span class="peso-input"><span aria-hidden="true">₱</span><input name="sales" inputmode="decimal" autocomplete="off" required value="${money(a.sales)}" placeholder="e.g. 1,842,600"></span>
        <small>The city's business tax is based on this: the year's total sales or receipts on your BIR returns (on the annual income tax return,
          "Sales/Revenues/Receipts/Fees"; or your four quarterly returns added up).${prevA.sales != null ? ` Last year you declared ${peso(prevA.sales)}.` : ''}</small></label>
      <div class="scan-box">
        <button type="button" class="btn btn-soft btn-sm" data-pk-scan>${ICON.camera} Read it from a photo of the return</button>
        <input type="file" accept="image/*" data-pk-cam hidden>
        <small class="muted">Read on this device; the photo isn't uploaded.</small>
        <div class="scan-status" aria-live="polite"></div>
      </div>`;
  }
  if (step === 'employees') {
    return html`${back}<label class="field"><span>How many people work there now?</span>
        <input type="number" name="employees" min="0" max="1000000" step="1" required inputmode="numeric" value="${a.employees ?? prevA.employees ?? ''}">
        <small>Everyone, including you and part-timers.${prevA.employees != null ? ` Last year: ${prevA.employees}.` : ''}</small></label>
      <label class="field"><span>How many of them live in ${c.city || 'the city'}? <small>(optional)</small></span>
        <input type="number" name="employees_local" min="0" max="1000000" step="1" inputmode="numeric" value="${a.employees_local ?? ''}"></label>`;
  }
  if (step === 'changed') {
    return html`${back}<fieldset class="field pk-choice"><legend>Has anything changed since your last permit?</legend>
        <label class="check"><input type="radio" name="changed" value="no" ${a.changed === 'no' ? 'checked' : ''}> No, same as last year</label>
        <label class="check"><input type="radio" name="changed" value="yes" ${a.changed === 'yes' ? 'checked' : ''}> Yes</label></fieldset>
      <label class="field" data-pk-changes ${a.changed === 'yes' ? '' : 'hidden'}><span>What changed?</span>
        <textarea name="changes" rows="3" maxlength="500" placeholder="e.g. new address, new owner, a new product line, a bigger space">${a.changes || ''}</textarea>
        <small>A new address, owner or business name can make this an amendment or a new application. Ask the city's business permits office before you file.</small></label>`;
  }
  // details: only what's missing (everything when changing answers)
  const miss = new Set(all ? ['tin', 'address', 'owner_name', 'line', 'reg_no', 'phone', 'area_sqm', 'place', 'lessor'] : missingDetails(c.known, a));
  const ask = (k) => miss.has(k);
  const regLabel = c.b.structure === 'Corporation' || c.b.structure === 'Partnership' ? 'SEC registration no.' : c.b.structure === 'Cooperative' ? 'CDA registration no.' : 'DTI business name no.';
  return html`${back}<p class="pk-lead">${all ? 'Everything the city\'s form asks for. Change what\'s different.' : 'A few details Pinoy Permit doesn\'t have yet. You only type them once.'}</p>
    <div class="grid2">
      ${when(ask('owner_name'), html`<label class="field"><span>Owner's full name${c.b.structure === 'Corporation' ? ' (or president)' : ''}</span><input name="owner_name" maxlength="120" required value="${c.known.owner_name}"></label>`)}
      ${when(all, html`<label class="field"><span>Position</span><input name="owner_title" maxlength="80" value="${a.owner_title || TITLE[c.b.structure] || 'Owner'}"></label>`)}
      ${when(ask('tin'), html`<label class="field"><span>TIN of the business</span><input name="tin" maxlength="30" inputmode="numeric" placeholder="e.g. 123-456-789-000" value="${FLOW.tin}" ${canEdit() ? 'required' : 'disabled'}></label>`)}
      ${when(ask('reg_no'), html`<label class="field"><span>${regLabel} <small>(if you have it)</small></span><input name="reg_no" maxlength="60" value="${c.known.reg_no}"></label>`)}
      ${when(ask('address'), html`<label class="field"><span>Business address (street, barangay)</span><input name="street" maxlength="300" required value="${FLOW.street}"></label>`)}
      ${when(ask('phone'), html`<label class="field"><span>Phone or mobile</span><input name="phone" type="tel" maxlength="30" required value="${c.known.phone}" placeholder="e.g. 0917 123 4567"></label>`)}
      ${when(ask('line'), html`<label class="field"><span>Line of business</span><input name="line" maxlength="160" required value="${c.known.line}" placeholder="e.g. Bakery, retail of baked goods"></label>`)}
      ${when(ask('area_sqm'), html`<label class="field"><span>Floor area in sq m <small>(optional)</small></span><input name="area_sqm" type="number" min="0" step="0.01" inputmode="decimal" value="${a.area_sqm ?? ''}"></label>`)}
      ${when(all, html`<label class="field"><span>Paying the business tax</span><select name="pay_mode">
        ${[['annual', 'Once a year'], ['semi', 'Twice a year'], ['quarterly', 'Every quarter']].map(([v, l]) => html`<option value="${v}" ${(a.pay_mode || 'annual') === v ? 'selected' : ''}>${l}</option>`)}</select></label>`)}
      ${when(all, html`<label class="field"><span>Owner's home address <small>(optional)</small></span><input name="owner_address" maxlength="300" value="${a.owner_address || ''}"></label>`)}
    </div>
    ${when(ask('place') || ask('lessor'), html`<fieldset class="field pk-choice"><legend>Is the place owned or rented?</legend>
      <label class="check"><input type="radio" name="place" value="owned" ${a.place === 'owned' ? 'checked' : ''}> Owned</label>
      <label class="check"><input type="radio" name="place" value="rented" ${a.place === 'rented' ? 'checked' : ''}> Rented</label></fieldset>
      <div class="grid2" data-pk-rent ${a.place === 'rented' ? '' : 'hidden'}>
        <label class="field"><span>Landlord's name</span><input name="lessor" maxlength="160" value="${a.lessor || ''}"></label>
        <label class="field"><span>Monthly rent <small>(₱, optional)</small></span><input name="rent" inputmode="decimal" value="${money(a.rent)}"></label></div>`)}`;
}

function show(i) {
  const step = FLOW.steps[i];
  const last = i === FLOW.steps.length - 1;
  openModal(`${FLOW.c.year} renewal packet · ${i + 1} of ${FLOW.steps.length}`, html`<div class="pk-step" data-step="${step}">
      <ol class="pk-dots" aria-hidden="true">${FLOW.steps.map((s, k) => html`<li class="${k < i ? 'done' : k === i ? 'now' : ''}">${STEP_TITLE[s]}</li>`)}</ol>
      ${stepBody(step, i)}</div>`, {
    submitLabel: last ? 'Build my packet' : 'Next', cancelLabel: 'Later',
    onOpen: (form) => wireStep(form, step, i),
    onSubmit: async (fd) => {
      read(step, fd, true);
      await saveDraft(false);
      if (last) await finish();
      else show(i + 1);
    },
  });
}

// What the step says, into the answers. strict: complain about bad values (Back keeps whatever is valid).
function read(step, fd, strict) {
  const a = FLOW.a;
  const bad = (msg) => { if (strict) throw new Error(msg); };
  if (step === 'sales') {
    const v = numIn(fd.get('sales'));
    if (v == null || !Number.isFinite(v) || v < 0 || v > 99999999999) return bad('Enter the sales in pesos, like 1,842,600.');
    a.sales = Math.round(v * 100) / 100;
  } else if (step === 'employees') {
    const n = numIn(fd.get('employees'));
    if (n == null || !Number.isInteger(n) || n < 0) return bad('Enter how many people work there, as a whole number.');
    a.employees = n;
    const l = numIn(fd.get('employees_local'));
    if (l != null && (!Number.isInteger(l) || l < 0 || l > n)) return bad(`How many live in the city: a whole number up to ${n}.`);
    if (l == null) delete a.employees_local; else a.employees_local = l;
  } else if (step === 'changed') {
    const v = fd.get('changed');
    if (!v) return bad('Choose yes or no.');
    a.changed = v;
    const t = String(fd.get('changes') || '').trim();
    if (v === 'yes' && !t) return bad('Say briefly what changed.');
    if (v === 'yes') a.changes = t; else delete a.changes;
  } else {
    for (const k of ['owner_name', 'owner_title', 'line', 'reg_no', 'phone', 'owner_address', 'lessor']) {
      if (!fd.has(k)) continue;
      const v = String(fd.get(k) || '').trim();
      if (v) a[k] = v; else delete a[k];
    }
    if (fd.has('pay_mode')) a.pay_mode = fd.get('pay_mode');
    if (fd.has('area_sqm')) {
      const v = numIn(fd.get('area_sqm'));
      if (v != null && (!Number.isFinite(v) || v < 0)) return bad('Floor area: a number of square meters.');
      if (v == null) delete a.area_sqm; else a.area_sqm = v;
    }
    if (fd.has('place')) a.place = fd.get('place');
    if (fd.has('rent')) {
      const v = numIn(fd.get('rent'));
      if (v != null && (!Number.isFinite(v) || v < 0)) return bad('Monthly rent: an amount in pesos.');
      if (v == null) delete a.rent; else a.rent = v;
    }
    if (a.place !== 'rented') { delete a.lessor; delete a.rent; }
    if (fd.has('tin')) FLOW.tin = String(fd.get('tin') || '').trim();
    if (fd.has('street')) FLOW.street = String(fd.get('street') || '').trim();
  }
}

function wireStep(form, step, i) {
  form.querySelector('[data-pk-back]')?.addEventListener('click', () => { try { read(step, new FormData(form), false); } catch { /* keep the rest */ } show(i - 1); });
  if (step === 'changed') {
    const box = form.querySelector('[data-pk-changes]');
    form.querySelectorAll('[name=changed]').forEach((el) => el.addEventListener('change', () => { box.hidden = form.changed.value !== 'yes'; }));
  }
  if (step === 'details') {
    const box = form.querySelector('[data-pk-rent]');
    form.querySelectorAll('[name=place]').forEach((el) => el.addEventListener('change', () => { if (box) box.hidden = form.place.value !== 'rented'; }));
  }
  if (step === 'sales') {
    const btn = form.querySelector('[data-pk-scan]');
    const cam = form.querySelector('[data-pk-cam]');
    const status = form.querySelector('.scan-status');
    btn.addEventListener('click', () => cam.click());
    cam.addEventListener('change', async () => {
      const file = cam.files[0];
      if (!file) return;
      btn.disabled = true;
      const say = (pct, msg) => { status.innerHTML = String(html`<div class="scan-progress"><span style="width:${Math.round(pct * 100)}%"></span></div><small>${msg}</small>`); };
      try {
        const { readPhoto } = await import('../ocr.js');
        const got = readSales(await readPhoto(file, say));
        if (got.chars < 20 || !got.amounts.length) { status.innerHTML = String(html`<p class="banner warn">We couldn't find the sales on it. Type the figure in.</p>`); return; }
        status.innerHTML = String(html`<p class="small">Tap the year's total sales <b>(check it against the return)</b>:
          ${got.amounts.map((v) => html`<button type="button" class="chip-btn small" data-amt="${v}">${peso(v)}</button>`)}</p>`);
        status.querySelectorAll('[data-amt]').forEach((b) => b.addEventListener('click', () => { form.sales.value = money(Number(b.dataset.amt)); form.sales.classList.add('from-scan'); }));
      } catch (e) {
        status.innerHTML = String(html`<p class="form-error" role="alert">${e.message || "We couldn't read that photo."}</p>`);
      } finally { btn.disabled = false; cam.value = ''; }
    });
  }
}

async function saveDraft(ready) {
  const { r, c } = FLOW;
  await db.packetSave(r.id, c.year, FLOW.a, ready);
}

async function finish() {
  const { r, c } = FLOW;
  // the TIN and the street address belong to the business and the branch, so every page has them
  let touched = false;
  if (canEdit() && FLOW.tin !== (c.b.tin || '') && c.b.id) { await db.updateBusiness(c.b.id, { tin: FLOW.tin || null }); touched = true; }
  if (canEdit() && FLOW.street !== (c.loc?.address || '') && c.loc?.id) { await db.updateLocation(c.loc.id, { address: FLOW.street }); touched = true; }
  await db.packetSave(r.id, c.year, FLOW.a, true);
  const packets = await db.packets(r.id);
  PK.set(r.id, packets);
  FLOW = null;
  if (touched) await reload();
  onChanged(r.id, packets);
  toast('Your packet is ready. Print it, or download it with copies of your files.');
}

on('packet-start', (ds) => begin(ds.id, false));
on('packet-edit', (ds) => begin(ds.id, true));

// ---------------------------------------------------------------- the packet itself (print, .zip, copy)
const PACKET_CSS = `.pk-doc{font-family:Georgia,'Times New Roman',serif;color:#111;font-size:11.5pt;line-height:1.5}
.pk-doc .pk-page{break-after:page;page-break-after:always;padding:4mm 0}
.pk-doc .pk-page:last-child{break-after:auto;page-break-after:auto}
.pk-doc h1{font-size:18pt;margin:0 0 4pt;font-family:system-ui,sans-serif}
.pk-doc h2{font-size:13pt;margin:14pt 0 6pt;font-family:system-ui,sans-serif}
.pk-doc h3{font-size:12.5pt;text-align:center;margin:0 0 12pt;letter-spacing:.04em}
.pk-doc table{border-collapse:collapse;width:100%;font-family:system-ui,sans-serif;font-size:10pt}
.pk-doc th,.pk-doc td{border:1px solid #bbb;padding:5pt 7pt;text-align:left;vertical-align:top}
.pk-doc th{background:#f1f1f1;width:42%;font-weight:600}
.pk-doc td.blank{color:#333}
.pk-doc .part{background:#e6ebf5;font-weight:700}
.pk-doc ul.pk-checklist{list-style:none;padding:0;display:block}.pk-doc ul.pk-checklist li{display:block;margin:4pt 0}.pk-doc ul.pk-checklist li::before{content:'\\2610  '}
.pk-doc .sig{display:flex;justify-content:space-between;gap:24pt;margin-top:32pt}.pk-doc .sig div{border-top:1px solid #111;padding-top:4pt;min-width:42%}
.pk-doc .note{font-size:9pt;color:#111;font-family:system-ui,sans-serif}
.pk-doc .foot{font-size:8.5pt;color:#111;margin-top:18pt;font-family:system-ui,sans-serif}`;

function packetPages(c) {
  const parts = partsOf(c);
  const t = typeOf('mayors_permit');
  const office = c.city ? `${c.city} Business Permits and Licensing Office` : 'Business Permits and Licensing Office';
  const checklist = Array.isArray(t?.checklist) && t.checklist.length ? t.checklist.map((i) => i.t) : [
    `Barangay business clearance for ${c.year}`, "Your current Mayor's Permit and its official receipt",
    `Sworn declaration of ${c.year - 1} sales (in this packet), or your BIR returns for ${c.year - 1}`,
    'Lease contract, or proof that you own the place', `Community tax certificate (cedula) for ${c.year}`,
    'A valid ID. If someone else files: the authorization letter (in this packet) and their ID'];
  const copies = copiesOf(c);
  const today = new Date(`${todayPH()}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const blank = '____________________';
  const name = c.known.owner_name || blank;
  const title = c.a.owner_title || TITLE[c.b.structure] || 'Owner';
  return html`<div class="pk-doc">
    <section class="pk-page">
      <h1>Business permit renewal, ${c.year}</h1>
      <p><b>${c.b.name}</b>${c.loc && !c.loc.is_main ? ` (${c.loc.name})` : ''}<br>${c.address || blank}<br>File with: ${office}</p>
      <h2>Bring or upload</h2>
      <ul class="pk-checklist">${checklist.map((x) => html`<li>${x}</li>`)}</ul>
      <h2>In this packet</h2>
      <ol><li>Application details, in the order of the city's form. Copy them onto the city's form or its online portal.</li>
        <li>Sworn declaration of ${c.year - 1} sales. Sign it in front of a notary.</li>
        <li>Authorization letter, only if someone else files for you.</li>
        <li>The list of copies from your files.</li></ol>
      ${when(c.a.changed === 'yes', html`<p class="note"><b>You said something changed:</b> ${c.a.changes || ''}. Ask the office if it needs an amendment before you file.</p>`)}
      <p class="foot">Prepared with Pinoy Permit on ${today}. A general guide: the city may ask for more or less, and its own forms come first.</p>
    </section>
    <section class="pk-page">
      <h1>Application details</h1>
      <p class="note">Renewal for ${c.year}. Blank lines: fill in by hand.</p>
      <table>${parts.map((p) => html`<tr><td class="part" colspan="2">${p.part}</td></tr>
        ${p.rows.map(([k, v]) => html`<tr><th>${k}</th>${String(v ?? '').trim() ? html`<td>${v}</td>` : html`<td class="blank">${blank}</td>`}</tr>`)}`)}</table>
    </section>
    <section class="pk-page">
      <p class="note">If the city has its own declaration form, use it and copy the figure from here.</p>
      <h3>SWORN DECLARATION OF GROSS SALES / RECEIPTS</h3>
      <p>${office}<br>${c.city || blank}</p>
      <p>I, <b>${name}</b>, of legal age, Filipino, ${title} of <b>${c.b.name}</b>, with business address at ${c.address || blank} and TIN ${c.known.tin || blank},
        after having been sworn in accordance with law, declare that:</p>
      <p>1. The gross sales / receipts of ${c.b.name} from its business (${c.known.line || blank}) for calendar year ${c.year - 1} amounted to
        <b>PHP ${Number(c.a.sales || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>, as shown in its books of accounts and in the returns it filed with the Bureau of Internal Revenue; and</p>
      <p>2. I am making this declaration to support the renewal of the business permit of ${c.b.name} for ${c.year}. I understand that a false declaration may lead to
        penalties, surcharges and the revocation of the permit under the local revenue code.</p>
      <p>IN WITNESS WHEREOF, I have signed this on ______________ at ______________, Philippines.</p>
      <div class="sig"><div>${name}<br>Affiant</div><div style="border:0"></div></div>
      <p style="margin-top:20pt">SUBSCRIBED AND SWORN to before me on ______________ at ______________, affiant exhibiting ______________________ as competent evidence of identity.</p>
      <p>Doc. No. _____;<br>Page No. _____;<br>Book No. _____;<br>Series of _____.</p>
    </section>
    <section class="pk-page">
      <p>${today}</p><p>${office}<br>${c.city || ''}</p>
      <h3>AUTHORIZATION LETTER</h3>
      <p>To whom it may concern:</p>
      <p>I, <b>${name}</b>, ${title} of <b>${c.b.name}</b>, with business address at ${c.address || blank}, authorize <b>______________________________</b>,
        holder of ______________________, to file, pay for and claim the ${c.year} business permit renewal of ${c.b.name} on our behalf.</p>
      <p>This covers filing the application, paying the fees, signing the acknowledgment receipt and claiming the permit. Attached are copies of my valid ID and of my representative's.</p>
      <div class="sig"><div>${name}<br>${title}, ${c.b.name}</div><div>Representative<br>Signature over printed name</div></div>
    </section>
    <section class="pk-page">
      <h1>Copies from your files</h1>
      ${copies.length ? html`<table><tr><th>Document</th><td><b>On file in Pinoy Permit</b></td></tr>${copies.map((x) => html`<tr><th>${shortName(x)}${x.reference_no ? ` (${x.reference_no})` : ''}</th>
        <td>${x.document_count ? `${plural(x.document_count, 'copy', 'copies')}${x.expires_on ? `, valid until ${fmtDate(x.expires_on)}` : ''}` : 'No copy uploaded yet'}</td></tr>`)}</table>`
        : html`<p>No permits with copies yet. Upload them in Pinoy Permit and download the packet again.</p>`}
      <p class="note">The .zip download has these copies next to this packet. Print the ones the city asks for.</p>
    </section>
  </div>`;
}

const clean = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Business';
function ctxFor(id) {
  const r = reqById(id);
  return r ? ctxOf(r, PK.get(id) || []) : null;
}

on('packet-print', (ds) => {
  const c = ctxFor(ds.id);
  if (c) printSheet(`<style>${PACKET_CSS}</style>${packetPages(c)}`, { cls: 'packet-print' });
});

on('packet-zip', async (ds, btn) => {
  const c = ctxFor(ds.id);
  if (!c) return;
  btn.disabled = true;
  const label = btn.innerHTML;
  btn.textContent = 'Putting it together…';
  try {
    const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Renewal packet ${c.year}</title>
      <style>body{max-width:760px;margin:24px auto;padding:0 16px}${PACKET_CSS}@media screen{.pk-doc .pk-page{border-bottom:2px dashed #ccc;margin-bottom:24px}}</style></head><body>${packetPages(c)}</body></html>`;
    const files = [{ name: `00 Renewal packet ${c.year}.html`, data: new TextEncoder().encode(page) }];
    const copies = copiesOf(c).filter((x) => x.document_count > 0);
    if (copies.length) {
      const docs = await db.orgDocuments(S.org.id);
      const used = new Set();
      let n = 0;
      for (const x of copies) {
        for (const d of docs.filter((d) => d.cycle_id === x.cycle_id)) {
          let fname = `${String(++n).padStart(2, '0')} ${clean(shortName(x))} - ${clean(d.file_name)}`;
          while (used.has(fname)) fname = fname.replace(/(\.[^.]*)?$/, '-2$1');
          used.add(fname);
          let blob;
          try { blob = await db.fileBlob(d.storage_path); } catch { throw new Error(`Couldn't download ${d.file_name}. Please try again.`); }
          files.push({ name: fname, data: new Uint8Array(await blob.arrayBuffer()) });
        }
      }
    }
    download(`${clean(c.b.name)} - renewal packet ${c.year}.zip`, makeZip(files), 'application/zip');
    toast(files.length > 1 ? `Downloaded: the packet and ${plural(files.length - 1, 'copy', 'copies')}.` : 'Downloaded the packet. Upload copies of your permits to include them next time.');
  } catch (e) { toastError(e); }
  btn.disabled = false; btn.innerHTML = label;
});

on('packet-copy', (ds) => {
  const c = ctxFor(ds.id);
  if (!c) return;
  const parts = partsOf(c);
  openModal('Copy into the city\'s online form', html`
    <p class="muted small">Tap Copy, then paste it into the matching box on the city's site (for example QC E-Services). You submit and pay on the city's site yourself;
      Pinoy Permit can't sign in or pay there for you.</p>
    ${parts.map((p) => html`<h4 class="copy-part">${p.part}</h4><div class="copy-list">
      ${p.rows.filter((row) => String(row[1] ?? '').trim()).map(([k, v]) => html`<div class="copy-row"><div><small>${k}</small><b>${v}</b></div>
        <button type="button" class="btn btn-sm btn-soft" data-copy="${v}" aria-label="Copy ${k}">Copy</button></div>`)}</div>`)}`, {
    wide: true,
    onOpen: (form) => form.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1500); } catch { toast("Copying didn't work here. Press and hold the text to copy it.", 'error'); }
    })),
  });
});
