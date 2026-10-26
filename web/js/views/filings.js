// Taxes & contributions: the recurring BIR returns, SSS, PhilHealth and Pag-IBIG payments and SEC
// filings each business has, when each is due, and a record of what was filed. The owner answers a few
// plain questions per business; the database works out the list and the dates (and sends reminders),
// so this page and the reminders always agree. Everything is explained in everyday words, because a
// missed or misunderstood deadline costs real money.
import { html, fmtDate, toast, toastError, when, plural, peso, todayPH, addDays, daysBetween, openModal, confirmDialog, formObject } from '../util.js';
import { S, on, canEdit, has, empty, business, memberName } from '../core.js';
import { ICON } from '../components.js';
import * as db from 'pp/data';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TAX_TYPES = {
  vat: ['VAT', 'Your COR lists "Value-added tax".'],
  percentage: ['Percentage tax', 'Your COR lists "Percentage tax" (non-VAT).'],
  eight_percent: ['8% income tax rate', 'You chose the 8% rate, so no percentage tax.'],
  unsure: ['Not sure yet', 'Ask your accountant or check your COR. Until then we leave out VAT and percentage tax.'],
};
const GROUPS = { 'A-D': 'A to D (by the 14th)', 'E-L': 'E to L (by the 19th)', 'M-Q': 'M to Q (by the 24th)', 'R-Z': 'R to Z or a number (by the end of the month)' };
const pagibigGroup = (name) => {
  const l = String(name || '').replace(/[^A-Za-z0-9]/g, '').charAt(0).toUpperCase();
  return l >= 'A' && l <= 'D' ? 'A-D' : l >= 'E' && l <= 'L' ? 'E-L' : l >= 'M' && l <= 'Q' ? 'M-Q' : 'R-Z';
};
const isCorp = (b) => ['Corporation', 'Partnership'].includes(b?.structure);

let cache = null; // { types, setups, items, at }
let view = 'todo';
let bizFilter = 'all';

async function load(force = false) {
  if (cache && !force && Date.now() - cache.at < 60000 && cache.org === S.org.id) return cache;
  const today = todayPH();
  const [types, setups, items] = await Promise.all([db.filingTypes(), db.filingSetups(S.org.id), db.filingCalendar(S.org.id, addDays(today, -366), addDays(today, 366))]);
  cache = { types, setups, items, at: Date.now(), org: S.org.id };
  return cache;
}
export const forgetFilings = () => { cache = null; };

// Where an item stands, in words and color.
function stateOf(it, today = todayPH()) {
  if (it.filed_on) return { cls: 'ok', label: 'Filed', key: 'filed' };
  const d = daysBetween(today, it.due_on);
  if (d < 0) return { cls: 'overdue', label: d === -1 ? '1 day late' : `${-d} days late`, key: 'overdue' };
  if (d === 0) return { cls: 'soon', label: 'Due today', key: 'soon' };
  if (d <= 7) return { cls: 'soon', label: d === 1 ? 'Due tomorrow' : `Due in ${d} days`, key: 'soon' };
  return { cls: 'needinfo', label: `Due in ${d} days`, key: 'later' };
}
const tile = (iso, cls) => {
  const [y, m, d] = iso.split('-').map(Number);
  return html`<div class="dtile ${cls}" title="${fmtDate(iso)}"><small>${MON[m - 1]}${todayPH().slice(0, 4) === String(y) ? '' : " '" + String(y).slice(2)}</small><b>${d}</b></div>`;
};

export async function filings(el) {
  if (!has('filings')) { el.innerHTML = String(empty('Not available yet', 'Tax and contribution deadlines are coming soon.')); return; }
  const businesses = S.data.businesses || [];
  if (!businesses.length) {
    el.innerHTML = String(html`<div class="page-head"><div><h1>Taxes & contributions</h1></div></div>
      ${empty('Add a business first', 'Tax and contribution deadlines are set up per business.', html`<a class="btn btn-primary" href="#/businesses?add=1">Add a business</a>`)}`);
    return;
  }
  if (!cache) el.innerHTML = String(html`<div class="loading">Loading…</div>`);
  let c;
  try { c = await load(); } catch (e) { toastError(e); el.innerHTML = String(empty("Couldn't load your deadlines", 'Check your connection and try again.', html`<button class="btn btn-primary" data-act="reload">Try again</button>`)); return; }
  if (!location.hash.startsWith('#/filings')) return;
  const today = todayPH();
  const typeOf = (code) => c.types.find((t) => t.code === code) || { agency: '', form: code, name: code };
  const setupOf = (id) => c.setups.find((s) => s.business_id === id);
  if (bizFilter !== 'all' && !businesses.some((b) => b.id === bizFilter)) bizFilter = 'all';
  const items = c.items.filter((it) => (bizFilter === 'all' || it.business_id === bizFilter) && business(it.business_id));
  const notSet = businesses.filter((b) => !setupOf(b.id));
  const overdue = items.filter((it) => !it.filed_on && it.due_on < today);
  const soon = items.filter((it) => !it.filed_on && it.due_on >= today && daysBetween(today, it.due_on) <= 7);
  const filedThisMonth = items.filter((it) => it.filed_on && it.filed_on.slice(0, 7) === today.slice(0, 7));
  const list = view === 'filed' ? items.filter((it) => it.filed_on).sort((a, b) => (a.filed_on < b.filed_on ? 1 : -1))
    : view === 'year' ? items.filter((it) => it.due_on >= today && it.due_on <= addDays(today, 365))
    : items.filter((it) => !it.filed_on && it.due_on <= addDays(today, 45));
  const edit = canEdit();
  const unsure = c.setups.filter((s) => s.tax_type === 'unsure' && business(s.business_id));

  const row = (it) => {
    const t = typeOf(it.code);
    const st = stateOf(it, today);
    const early = !it.filed_on && it.due_on < it.tracking_from_created;
    return html`<div class="row filing-row ${st.cls}">
      ${tile(it.due_on, st.cls)}
      <div class="row-main"><div class="row-title"><span class="agency">${t.agency}</span> ${['BIR', 'SEC'].includes(t.agency) ? `${t.form}: ` : ''}${t.name}</div>
        <div class="row-sub">For ${it.period_label} · ${it.business_name} · due ${fmtDate(it.due_on)}</div>
        ${when(it.filed_on, html`<div class="row-sub filed-line">${ICON.check} Filed ${fmtDate(it.filed_on)}${it.filed_on > it.due_on ? ` (${daysBetween(it.due_on, it.filed_on)} days late)` : ''}${it.reference ? ' · ref ' + it.reference : ''}${it.amount != null ? ' · ' + peso(it.amount) : ''}${it.filed_by ? ' · by ' + (it.filed_by === S.user?.id ? 'you' : memberName(it.filed_by)) : ''}</div>`)}
        ${when(early, html`<div class="row-sub muted">This was due before you started tracking in Pinoy Permit. Mark it filed if it's done.</div>`)}
      </div>
      <div class="row-side"><span class="chip ${st.cls}">${st.label}</span>
        ${when(edit && !it.filed_on, html`<button class="btn btn-sm ${st.key === 'later' ? 'btn-soft' : 'btn-primary'}" data-act="filing-mark" data-key="${it.business_id}|${it.code}|${it.period_start}">Mark filed</button>`)}
        ${when(edit && it.filed_on, html`<button class="btn btn-sm btn-ghost" data-act="filing-mark" data-key="${it.business_id}|${it.code}|${it.period_start}">Edit</button>`)}
        ${when(t.online_url, html`<a class="btn btn-sm btn-ghost" href="${t.online_url}" target="_blank" rel="noopener noreferrer" title="${t.online_label || 'Official website'} (opens in a new tab)">File online ↗</a>`)}</div>
    </div>`;
  };
  const group = (title, rows, sub = '') => (rows.length ? html`<section class="card list"><div class="card-head"><div><h2>${title}</h2>${when(sub, html`<p class="card-sub">${sub}</p>`)}</div><span class="muted small">${rows.length}</span></div>${rows.map(row)}</section>` : '');
  // created date of each setup, for the "due before you started" note
  for (const it of items) it.tracking_from_created = (setupOf(it.business_id)?.created_at || '').slice(0, 10) || today;

  el.innerHTML = String(html`
    <div class="page-head"><div><h1>Taxes & contributions</h1>
      <p class="muted">BIR, SSS, PhilHealth, Pag-IBIG and SEC due dates. We remind you before each one.</p></div></div>
    ${when(notSet.length, html`<section class="card setup-card"><h2>${notSet.length === businesses.length ? 'Set up your deadlines' : 'Not set up yet'}</h2>
      <p class="muted">Answer a few questions per business (about a minute). We work out every return and payment and when each is due.</p>
      ${notSet.map((b) => html`<div class="line"><span class="line-main"><b>${b.name}</b><small>${b.structure}</small></span>
        ${edit ? html`<button class="btn btn-sm btn-primary" data-act="filing-setup" data-id="${b.id}">Set up</button>` : html`<span class="muted small">Ask an owner or admin</span>`}</div>`)}</section>`)}
    ${unsure.length ? html`<div class="banner warn"><div><b>Which business tax?</b> ${unsure.map((s) => business(s.business_id)?.name).join(', ')}: we don't know yet if ${unsure.length === 1 ? 'it pays' : 'they pay'} VAT or percentage tax, so those returns aren't listed.</div>
      ${when(edit, html`<div class="banner-actions"><button class="btn btn-sm btn-primary" data-act="filing-setup" data-id="${unsure[0].business_id}">Answer now</button></div>`)}</div>` : ''}
    ${when(c.setups.length, html`
      <div class="stats">
        <button class="stat overdue" data-act="filing-view" data-v="todo"><div class="stat-n">${overdue.length}</div><div class="stat-l">Late</div></button>
        <button class="stat soon" data-act="filing-view" data-v="todo"><div class="stat-n">${soon.length}</div><div class="stat-l">Due in 7 days</div></button>
        <button class="stat ok" data-act="filing-view" data-v="filed"><div class="stat-n">${filedThisMonth.length}</div><div class="stat-l">Filed this month</div></button>
      </div>
      <div class="filters filing-filters">
        <div class="seg" role="group" aria-label="Show">
          ${[['todo', 'To do'], ['year', 'Next 12 months'], ['filed', 'Filed']].map(([k, l]) => html`<button class="chip-btn ${view === k ? 'on' : ''}" data-act="filing-view" data-v="${k}" aria-pressed="${view === k}">${l}</button>`)}</div>
        ${when(businesses.length > 1, html`<select id="filing-biz" aria-label="Business"><option value="all">All businesses</option>${businesses.filter((b) => setupOf(b.id)).map((b) => html`<option value="${b.id}" ${bizFilter === b.id ? 'selected' : ''}>${b.name}</option>`)}</select>`)}
      </div>
      ${view === 'todo' ? html`${group('Late', list.filter((it) => it.due_on < today), 'File these as soon as you can; penalties usually grow every month.')}
          ${group('Due in the next 7 days', list.filter((it) => it.due_on >= today && daysBetween(today, it.due_on) <= 7))}
          ${group('Coming up', list.filter((it) => daysBetween(today, it.due_on) > 7), 'The next 45 days.')}
          ${when(!list.length, html`<section class="card">${empty('Nothing due right now', 'Nothing late and nothing due in the next 45 days.')}</section>`)}`
        : view === 'filed' ? (list.length ? group('Filed', list, 'Newest first. Tap Edit to fix a date, reference or amount.') : html`<section class="card">${empty('Nothing marked filed yet', 'When you file a return or pay a contribution, tap Mark filed so you have a record.')}</section>`)
        : group('Next 12 months', list) || html`<section class="card">${empty('Nothing in the next 12 months', '')}</section>`}
      <section class="card"><h2>Answers per business</h2>
        ${c.setups.filter((s) => business(s.business_id)).map((s) => { const b = business(s.business_id); return html`<div class="line"><span class="line-main"><b>${b.name}</b>
          <small>${s.has_employees ? 'Has employees' : 'No employees'} · ${TAX_TYPES[s.tax_type][0]} · ${s.withholds ? 'Withholds on rent/suppliers' : 'No withholding on rent/suppliers'}${s.paused_codes?.length ? ` · ${plural(s.paused_codes.length, 'filing')} turned off` : ''}</small></span>
          ${when(edit, html`<button class="btn btn-sm btn-soft" data-act="filing-setup" data-id="${b.id}">Change answers</button>`)}</div>`; })}
      </section>`)}
    <p class="muted small fineprint">Deadlines follow the general rules for businesses whose tax year is January to December. When a deadline falls on a weekend or holiday, offices usually accept it on the next working day, but we still remind you by the date shown. Your accountant or the agency has the final say.</p>`);
  el.querySelector('#filing-biz')?.addEventListener('change', (e) => { bizFilter = e.target.value; filings(el); });
}
on('filing-view', (ds) => { view = ds.v; const el = document.getElementById('main'); if (el) filings(el); });

// ---------------------------------------------------------------- the questions
function applies(t, a, b) {
  return (t.applies === 'employer' && a.has_employees) || (t.applies === 'withholding' && a.withholds)
    || (t.applies === 'vat' && a.tax_type === 'vat') || (t.applies === 'percentage' && a.tax_type === 'percentage')
    || (t.applies === 'individual' && b.structure === 'Sole Proprietorship') || (t.applies === 'corp' && isCorp(b))
    || (t.applies === 'sec_gis' && b.structure === 'Corporation' && !!a.annual_meeting);
}
on('filing-setup', async (ds) => {
  const b = business(ds.id);
  if (!b) return;
  let c;
  try { c = await load(); } catch (e) { return toastError(e); }
  const s = c.setups.find((x) => x.business_id === b.id) || {};
  const yn = (name, val, yes, no) => html`<div class="seg-radio"><label class="check"><input type="radio" name="${name}" value="yes" ${val === true ? 'checked' : ''} required><span>${yes}</span></label>
    <label class="check"><input type="radio" name="${name}" value="no" ${val === false && s.business_id ? 'checked' : ''}><span>${no}</span></label></div>`;
  const taxOpts = Object.entries(TAX_TYPES).filter(([k]) => !(k === 'eight_percent' && b.structure !== 'Sole Proprietorship'));
  const supported = ['Sole Proprietorship', 'Partnership', 'Corporation'].includes(b.structure);
  const off = new Set(s.paused_codes || []); // filings they said don't apply
  openModal(`Tax deadlines for ${b.name}`, html`
    <p class="muted small">Four quick questions. Your answers decide which returns and payments we track. You can change them anytime.</p>
    ${when(!supported, html`<div class="banner info"><div>${b.structure} businesses: we cover employer filings and business tax, but not yearly income tax yet. Ask your accountant about those.</div></div>`)}
    <fieldset class="field q"><legend>1. Does ${b.name} have employees on payroll?</legend>
      ${yn('has_employees', s.has_employees, 'Yes', 'No')}
      <small class="muted">Include yourself if the business pays you a salary. Yes adds BIR 1601-C and 1604-C, SSS, PhilHealth and Pag-IBIG.</small></fieldset>
    <fieldset class="field q"><legend>2. Which business tax is on its BIR Certificate of Registration (Form 2303)?</legend>
      ${taxOpts.map(([k, [label, sub]]) => html`<label class="check"><input type="radio" name="tax_type" value="${k}" ${(s.tax_type || '') === k ? 'checked' : ''} required><span>${label} <small class="muted">${sub}</small></span></label>`)}</fieldset>
    <fieldset class="field q"><legend>3. Does it withhold tax when paying rent, suppliers or contractors?</legend>
      ${yn('withholds', s.withholds, 'Yes', 'No / not sure')}
      <small class="muted">Your COR lists "Withholding tax - expanded" if it does. Yes adds BIR 0619-E, 1601-EQ and 1604-E.</small></fieldset>
    <div class="q-employer" ${s.has_employees ? '' : 'hidden'}>
      <fieldset class="field q"><legend>4. Employer numbers (for exact payment dates)</legend>
        <label class="field"><span>Last digit of the PhilHealth employer number (PEN)</span><select name="philhealth_digit">
          <option value="">I don't know (we use the earlier date, the 15th)</option>${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => html`<option value="${d}" ${s.philhealth_digit === d ? 'selected' : ''}>${d}</option>`)}</select></label>
        <label class="field"><span>First letter of the employer name registered with Pag-IBIG</span><select name="pagibig_group">
          ${Object.entries(GROUPS).map(([k, l]) => html`<option value="${k}" ${(s.pagibig_group || pagibigGroup(b.name)) === k ? 'selected' : ''}>${l}${k === pagibigGroup(b.name) ? ` — matches "${b.name}"` : ''}</option>`)}</select></label></fieldset>
    </div>
    ${when(b.structure === 'Corporation', html`<label class="field"><span>Date of the annual stockholders' meeting <small>(optional, from your by-laws)</small></span>
      <input type="date" name="annual_meeting" value="${s.annual_meeting || ''}"><small class="muted">Only the month and day are used. Leave it blank if you're not sure; we'll leave out the GIS reminder until you add it.</small></label>`)}
    <div class="filing-preview" aria-live="polite"></div>
    ${when(s.business_id, html`<button type="button" class="linklike danger" data-act="filing-remove" data-id="${b.id}">Stop tracking taxes for ${b.name}</button>`)}`, {
    submitLabel: 'Save',
    wide: true,
    onOpen: (form) => {
      const preview = () => {
        const f = formObject(new FormData(form));
        const a = { has_employees: f.has_employees === 'yes', withholds: f.withholds === 'yes', tax_type: f.tax_type || 'unsure', annual_meeting: f.annual_meeting };
        form.querySelector('.q-employer').hidden = !a.has_employees;
        const list = c.types.filter((t) => applies(t, a, b));
        const on = list.filter((t) => !off.has(t.code)).length;
        form.querySelector('.filing-preview').innerHTML = String(list.length
          ? html`<h3 class="h4">We'll track ${plural(on, 'filing')}</h3>
            <p class="muted small">Untick any you're sure don't apply (for example, if they're filed under another business).</p>
            <ul class="preview-list">${list.map((t) => html`<li><label class="check"><input type="checkbox" data-track="${t.code}" ${off.has(t.code) ? '' : 'checked'}>
              <span><b>${t.agency} ${t.form}</b> ${t.name} <small class="muted">· ${t.frequency === 'monthly' ? 'every month' : t.frequency === 'quarterly' ? 'every quarter' : 'every year'}</small></span></label></li>`)}</ul>`
          : html`<p class="muted small">Answer the questions above to see the list.</p>`);
      };
      form.addEventListener('change', (e) => {
        const code = e.target.dataset?.track;
        if (code) { if (e.target.checked) off.delete(code); else off.add(code); }
        preview();
      });
      preview();
    },
    onSubmit: async (fd) => {
      const f = formObject(fd);
      if (!f.has_employees || !f.tax_type || !f.withholds) throw new Error('Please answer questions 1 to 3.');
      const paused = [...off];
      await db.saveFilingSetup(b.id, {
        has_employees: f.has_employees === 'yes', withholds: f.withholds === 'yes', tax_type: f.tax_type,
        philhealth_digit: f.philhealth_digit === '' || f.philhealth_digit == null ? null : Number(f.philhealth_digit),
        pagibig_group: f.has_employees === 'yes' ? f.pagibig_group || null : null, annual_meeting: f.annual_meeting || null, paused,
      });
      forgetFilings();
      const el = document.getElementById('main');
      if (location.hash.startsWith('#/filings') && el) await filings(el);
      toast(s.business_id ? 'Saved. The list is updated.' : `Done. ${b.name}'s deadlines are listed, and we'll remind you before each one.`);
    },
  });
});

on('filing-remove', async (ds) => {
  const b = business(ds.id);
  if (!(await confirmDialog(`Stop tracking taxes for ${b?.name || 'this business'}?`, 'Its filings leave the list and reminders stop. What you already marked filed is kept, and you can set it up again anytime.', { confirmLabel: 'Stop tracking' }))) return;
  try {
    await db.removeFilingSetup(ds.id);
    forgetFilings();
    const el = document.getElementById('main');
    if (location.hash.startsWith('#/filings') && el) await filings(el);
    toast('Stopped. Set it up again anytime.');
  } catch (e) { toastError(e); }
});

// ---------------------------------------------------------------- marking filed
on('filing-mark', async (ds) => {
  const [bizId, code, period] = (ds.key || '').split('|');
  let c;
  try { c = await load(); } catch (e) { return toastError(e); }
  const it = c.items.find((x) => x.business_id === bizId && x.code === code && x.period_start === period);
  const t = c.types.find((x) => x.code === code);
  if (!it || !t) { forgetFilings(); return toast('This list changed. Please try again.', 'error'); }
  const today = todayPH();
  openModal(`${it.filed_on ? 'Filing record' : 'Mark as filed'}: ${['BIR', 'SEC'].includes(t.agency) ? `${t.agency} ${t.form}` : t.name}`, html`
    <p class="muted small">${t.name} for <b>${it.period_label}</b> · ${it.business_name} · due ${fmtDate(it.due_on)}</p>
    <div class="grid2">
      <label class="field"><span>Date filed or paid</span><input type="date" name="filed_on" required value="${it.filed_on || today}" max="${today}" min="${it.period_start}"></label>
      <label class="field"><span>Amount paid <small>(₱, optional)</small></span><input type="number" name="amount" min="0" step="0.01" value="${it.amount ?? ''}" placeholder="e.g. 4250"></label>
    </div>
    <label class="field"><span>Reference or confirmation number <small>(optional)</small></span><input name="reference" maxlength="100" value="${it.reference || ''}"
      placeholder="${t.agency === 'SSS' ? 'e.g. the PRN' : t.agency === 'BIR' ? 'e.g. the eFPS or eBIRForms reference' : 'e.g. the payment reference'}"></label>
    <label class="field"><span>Note <small>(optional)</small></span><input name="note" maxlength="500" value="${it.note || ''}" placeholder="e.g. Paid through the bank"></label>
    <p class="late-note banner warn" hidden></p>
    ${when(it.filed_on, html`<button type="button" class="linklike danger" data-act="filing-unmark" data-id="${it.record_id}">It wasn't filed after all: remove this record</button>`)}`, {
    submitLabel: it.filed_on ? 'Save changes' : 'Mark filed',
    onOpen: (form) => {
      const date = form.querySelector('[name=filed_on]');
      const note = form.querySelector('.late-note');
      const upd = () => {
        const late = date.value && date.value > it.due_on;
        note.hidden = !late;
        if (late) note.textContent = `That's ${plural(daysBetween(it.due_on, date.value), 'day')} after the deadline. Late filings usually carry penalties, so keep the receipt with this record.`;
      };
      date.addEventListener('input', upd); upd();
    },
    onSubmit: async (fd) => {
      const f = formObject(fd);
      if (!f.filed_on) throw new Error('Enter the date it was filed or paid.');
      if (f.filed_on > today) throw new Error("The date can't be in the future.");
      if (f.filed_on < it.period_start) throw new Error(`That date is before ${it.period_label} even started. Check the date.`);
      if (f.amount !== '' && f.amount != null && !(Number(f.amount) >= 0)) throw new Error('The amount must be zero or more.');
      await db.markFiling({ business_id: bizId, code, period_start: period, filed_on: f.filed_on, reference: f.reference, amount: f.amount === '' ? null : Number(f.amount), note: f.note });
      forgetFilings();
      const el = document.getElementById('main');
      if (location.hash.startsWith('#/filings') && el) await filings(el);
      toast(it.filed_on ? 'Saved.' : `Marked filed. No more reminders for ${['BIR', 'SEC'].includes(t.agency) ? t.form : t.name} for ${it.period_label}.`);
    },
  });
});
on('filing-unmark', async (ds) => {
  if (!(await confirmDialog('Remove this filing record?', 'It goes back on the to-do list, and reminders start again if it is due.', { confirmLabel: 'Remove record' }))) return;
  try {
    await db.unmarkFiling(ds.id);
    forgetFilings();
    const el = document.getElementById('main');
    if (location.hash.startsWith('#/filings') && el) await filings(el);
    toast('Removed. It is back on the to-do list.');
  } catch (e) { toastError(e); }
});

// ---------------------------------------------------------------- dashboard line
// "2 filings due this week" under the greeting, once the business is set up. Loaded after the page shows.
export async function filingsBrief(slot) {
  if (!has('filings') || !slot) return;
  try {
    const c = await load();
    if (!c.setups.length || !document.body.contains(slot)) return;
    const today = todayPH();
    const open = c.items.filter((it) => !it.filed_on && business(it.business_id));
    const late = open.filter((it) => it.due_on < today).length;
    const week = open.filter((it) => it.due_on >= today && daysBetween(today, it.due_on) <= 7).length;
    if (!late && !week) return;
    slot.innerHTML = String(html`${ICON.calendar} <a href="#/filings">${late ? html`<b class="due overdue">${plural(late, 'tax filing')} late</b>${week ? ', ' : ''}` : ''}${week ? `${plural(week, 'tax filing')} due this week` : ''}</a>`);
    slot.hidden = false;
  } catch { /* the dashboard works without it */ }
}
