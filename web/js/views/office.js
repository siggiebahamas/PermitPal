// Waiting on an office, and its bills, on each permit's page.
// The processing clock: tell us the day you handed in your papers, and Pinoy Permit counts the office's legal processing
// time (Ease of Doing Business law, RA 11032) in working days. When it runs out, you're told, with a polite follow-up
// letter ready, and a complaint to the Anti-Red Tape Authority (ARTA) if that doesn't work.
// City bills: snap the office's bill; get reminded before it's due and keep the receipt with the permit, or let
// Pinoy Permit pay it. The database checks every rule and works out the real deadline; this page shows it.
import { html, openModal, confirmDialog, toast, toastError, when, fmtDate, peso, plural, todayPH, download, esc } from '../util.js';
import { S, on, has, isOrgAdmin, canEdit, reqById, typeOf, business, vehicle, location_, locationsOf } from '../core.js';
import { cityKey } from '../citydates.js';
import { ICON } from '../components.js';
import { payDetails } from './services.js';
import { printSheet } from '../print.js';
import { readBill } from '../ocrparse.js';
import { addWorkdays, workdaysBetween, filingDays, LEGAL_DAYS } from '../workdays.js';
import * as db from 'pp/data';

// ---------------------------------------------------------------- what the page needs
let HOL = null;      // national holidays, as a Set of dates (a year back and ahead)
let SET = null;      // payment details and the bill-paying settings
let LGUS = null;     // the Metro Manila city register: which offices take payment online
export const lgusLoaded = () => LGUS;
export const lguFor = (city) => { const k = cityKey(city || ''); return k ? (LGUS || []).find((g) => g.city_key === k) || null : null; };
export async function loadLgus(fresh = false) {
  if (!has('lgus')) return [];
  if (!LGUS || fresh) LGUS = await db.lgus().catch(() => null);
  return LGUS || [];
}
export async function officeData(reqId) {
  const [filings, bills] = await Promise.all([
    has('clock') ? db.filings(reqId).catch(() => []) : [],
    has('billpay') ? db.bills(reqId).catch(() => []) : [],
    has('clock') && !HOL ? loadHolidays() : null,
    has('billpay') && !SET ? db.appSettings().then((s) => { SET = s; }).catch(() => {}) : null,
    has('lgus') ? loadLgus(true) : null,
  ]);
  return { filings, bills };
}
async function loadHolidays() {
  const shift = (n) => { const d = new Date(todayPH() + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  try { HOL = new Set((await db.holidays(shift(-400), shift(400))).map((h) => h.day)); } catch { HOL = new Set(); }
}
const hol = () => HOL || new Set();
// The permit page listens, to refresh these two cards.
let onChanged = () => {};
export const watchOffice = (fn) => { onChanged = fn; };
const changed = (reqId) => onChanged(reqId);

// ---------------------------------------------------------------- small helpers
const LONG = { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' };
const longDate = (iso) => (iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', LONG) : '');
const dayDate = (iso) => (iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '');
const KIND_LABEL = { simple: 'Simple: 3 working days', complex: 'Complex: 7 working days', technical: 'Highly technical: 20 working days', charter: "The office's Citizen's Charter" };
const FEES = { not_assessed: 'Not assessed yet', assessed: 'Assessed, not paid yet', paid: 'Paid', none: 'No fees' };
// The place the permit is for: its branch, or the business's main one.
function placeOf(r) {
  const b = r.business_id ? business(r.business_id) : null;
  const loc = (r.location_id && location_(r.location_id)) || (b ? locationsOf(b.id).find((l) => l.is_main) || locationsOf(b.id)[0] : null);
  return { name: b?.name || r.subject_name || S.org?.name || '', address: [loc?.address, loc?.city].filter(Boolean).join(', '), city: loc?.city || '' };
}
// A first guess at the office's name, from the kind of permit and the city. Always editable.
function guessOffice(r) {
  const city = placeOf(r).city;
  if (r.type_code === 'mayors_permit') return city ? `${city} Business Permits and Licensing Office` : 'Business Permits and Licensing Office';
  if (r.type_code === 'fsic') return city ? `Bureau of Fire Protection, ${city}` : 'Bureau of Fire Protection';
  if (r.type_code === 'barangay_clearance') return 'Barangay hall';
  if (r.type_code === 'sanitary_permit') return city ? `${city} Health Office` : 'City Health Office';
  return typeOf(r.type_code)?.agency || '';
}
const officeOf = (r) => guessOffice(r);

// ---------------------------------------------------------------- the clock card
export function clockCard(r, filings = []) {
  if (!has('clock') || !r) return '';
  const edit = canEdit();
  const open = filings.find((f) => f.status === 'waiting');
  const last = filings.find((f) => f.status !== 'waiting');
  if (!open) {
    if (!edit || (r.status === 'compliant' && !last)) return last ? html`<p class="muted small clock-last">${lastLine(last)}</p>` : '';
    return html`<section class="card clock-card" id="clock"><div class="card-head"><h2>Waiting on the office?</h2></div>
      <p>Tell us the day you handed in your papers. Pinoy Permit counts the office's legal processing time (3 working days for most permits, by law)
        and tells you the day it runs late, with a letter ready to send.</p>
      <div class="btn-row"><button class="btn btn-soft btn-sm" data-act="clock-start" data-id="${r.id}">${ICON.calendar} I filed it: start the clock</button></div>
      ${last ? html`<p class="muted small">${lastLine(last)}</p>` : ''}</section>`;
  }
  const today = todayPH();
  const total = Math.max(1, workdaysBetween(open.filed_on, open.due_on, hol()));
  const used = Math.min(total, workdaysBetween(open.filed_on, today, hol()));
  const late = today > open.due_on ? workdaysBetween(open.due_on, today, hol()) : 0;
  const chip = late ? html`<span class="chip overdue">Late by ${plural(late, 'working day')}</span>`
    : today === open.due_on ? html`<span class="chip soon">Last day today</span>` : html`<span class="chip progress">${plural(total - used, 'working day')} left</span>`;
  const ours = !!open.request_id;
  return html`<section class="card clock-card ${late ? 'is-late' : ''}" id="clock">
    <div class="card-head"><div><h2>Processing clock</h2><p class="card-sub">${open.office}${open.reference_no ? ` · ref ${open.reference_no}` : ''}</p></div>${chip}</div>
    <div class="clock-meter" aria-hidden="true"><span style="width:${Math.round((late ? 1 : used / total) * 100)}%"></span></div>
    <dl class="clock-facts">
      <div><dt>Filed</dt><dd>${dayDate(open.filed_on)}</dd></div>
      <div><dt>By law, it has until</dt><dd><b>${dayDate(open.due_on)}</b></dd></div>
      <div><dt>Fees</dt><dd>${open.fees === 'paid' ? `Paid ${fmtDate(open.fees_paid_on)}` : FEES[open.fees]}</dd></div>
    </dl>
    ${late ? html`<div class="banner warn clock-late"><div><b>${open.office} is past its deadline.</b>
      ${ours ? ' Pinoy Permit filed this for you and is following up.' : html` Send the follow-up letter today: most offices act on a written, polite reminder.
      ${open.fees === 'paid' ? ' You handed in everything and paid, so the law treats your application as approved; the letter says so.' : ''}`}</div></div>`
      : html`<p class="muted small">${open.extended ? `The office extended it once, in writing: "${open.extension_note}". ` : ''}${ours ? 'Pinoy Permit filed this for you. If the office runs late, we follow up.'
        : `If ${open.office} hasn't acted by then, we'll tell you, with a follow-up letter ready.`}</p>`}
    ${when(open.followup_at || open.complaint_at, html`<p class="small clock-letters">${open.followup_at ? html`Follow-up letter drafted ${fmtDate(open.followup_at.slice(0, 10))}. ` : ''}${open.complaint_at ? html`ARTA complaint drafted ${fmtDate(open.complaint_at.slice(0, 10))}${open.complaint_ref ? `, ARTA reference ${open.complaint_ref}` : ''}.` : ''}</p>`)}
    ${when(edit, html`<div class="btn-row">
      ${when(late && !ours, html`<button class="btn btn-primary btn-sm" data-act="clock-letter" data-id="${open.id}" data-req="${r.id}" data-kind="followup">Follow-up letter</button>
        <button class="btn btn-soft btn-sm" data-act="clock-letter" data-id="${open.id}" data-req="${r.id}" data-kind="complaint">Complain to ARTA</button>`)}
      <button class="btn ${late ? 'btn-ghost' : 'btn-soft'} btn-sm" data-act="clock-close" data-id="${open.id}" data-req="${r.id}">Got it / it's over</button>
      ${when(!ours, html`<button class="btn btn-ghost btn-sm" data-act="clock-edit" data-id="${open.id}" data-req="${r.id}">Edit</button>`)}</div>`)}
  </section>`;
}
function lastLine(f) {
  const when2 = f.closed_on ? fmtDate(f.closed_on) : '';
  if (f.status === 'released') {
    const lateBy = f.closed_on && f.closed_on > f.due_on ? workdaysBetween(f.due_on, f.closed_on, hol()) : 0;
    return `Last filing: ${f.office} released it ${when2}, ${lateBy ? `${plural(lateBy, 'working day')} late` : 'on time'}.`;
  }
  return f.status === 'denied' ? `Last filing: ${f.office} returned it on ${when2}.` : `Last filing with ${f.office} was stopped on ${when2}.`;
}

// ---------------------------------------------------------------- start or edit the clock
async function openFiling(r, f = null) {
  if (!HOL) await loadHolidays();
  const t = todayPH();
  openModal(f ? 'Edit the filing' : `I filed it: ${r.name}`, html`
    <p class="muted small">The day you file doesn't count, and neither do weekends and national holidays. We tell you the morning after the deadline if the office hasn't acted.</p>
    <label class="field"><span>Office you filed with</span><input name="office" maxlength="160" required value="${f?.office || officeOf(r)}" autocomplete="off"></label>
    <div class="grid2">
      <label class="field"><span>Day you handed in complete papers</span><input type="date" name="filed_on" required max="${t}" value="${f?.filed_on || t}"></label>
      <label class="field"><span>Reference or claim stub no. <small>(optional)</small></span><input name="reference_no" maxlength="120" value="${f?.reference_no || ''}" placeholder="e.g. 2027-BPLO-01234"></label>
    </div>
    <fieldset class="clock-kinds"><legend>How long the office has, by law</legend>
      ${[['simple', '3 working days', 'Most permits and renewals'], ['complex', '7 working days', 'Needs an inspection or several offices'], ['technical', '20 working days', 'Highly technical, like health or environmental reviews']]
        .map(([k, a, b]) => html`<label class="check"><input type="radio" name="kind" value="${k}" ${(f?.kind || 'simple') === k ? 'checked' : ''}><span><b>${a}</b> <small class="muted">${b}</small></span></label>`)}
      <label class="check"><input type="radio" name="kind" value="charter" ${f?.kind === 'charter' ? 'checked' : ''}><span><b>What the office's Citizen's Charter says</b> <small class="muted">Often shorter: it's posted at the office and on its website</small></span></label>
      <label class="field" data-charter ${f?.kind === 'charter' ? '' : 'hidden'}><span>Working days in the Citizen's Charter</span><input type="number" name="days" min="1" max="60" step="1" inputmode="numeric" value="${f?.kind === 'charter' ? f.days : ''}"></label>
    </fieldset>
    <div class="grid2">
      <label class="field"><span>Fees</span><select name="fees">${Object.entries(FEES).map(([k, v]) => html`<option value="${k}" ${(f?.fees || 'not_assessed') === k ? 'selected' : ''}>${v}</option>`)}</select></label>
      <label class="field" data-paid ${f?.fees === 'paid' ? '' : 'hidden'}><span>Day you paid</span><input type="date" name="fees_paid_on" max="${t}" value="${f?.fees_paid_on || ''}"></label>
    </div>
    ${when(f, html`<label class="check"><input type="checkbox" name="extended" ${f?.extended ? 'checked' : ''}><span>The office told me <b>in writing</b>, before the deadline, that it needs more time (allowed once, for the same number of days)</span></label>
      <label class="field" data-ext ${f?.extended ? '' : 'hidden'}><span>What it wrote</span><input name="extension_note" maxlength="300" value="${f?.extension_note || ''}" placeholder="e.g. Letter of Jan 11: inspection still to be scheduled"></label>
      <label class="field"><span>Working days the office was closed <small>(local holiday, typhoon, system down)</small></span><input type="number" name="closed_days" min="0" max="60" step="1" value="${f?.closed_days || 0}"></label>`)}
    <p class="clock-preview" aria-live="polite"></p>
    <p class="muted small">A guide to what the law allows, not legal advice. <a href="terms.html#clock" target="_blank" rel="noopener">How the clock works<span class="sr-only"> (opens in a new tab)</span></a></p>`, {
    submitLabel: f ? 'Save' : 'Start the clock',
    onOpen: (form) => {
      const paint = () => {
        const kind = form.kind.value;
        form.querySelector('[data-charter]').hidden = kind !== 'charter';
        form.querySelector('[data-paid]').hidden = form.fees.value !== 'paid';
        const ext = form.querySelector('[data-ext]'); if (ext) ext.hidden = !form.extended.checked;
        const n = filingDays(kind, form.days.value, !!form.extended?.checked, form.closed_days?.value);
        const from = form.filed_on.value;
        form.querySelector('.clock-preview').innerHTML = from && n > 0 && (kind !== 'charter' || Number(form.days.value) > 0)
          ? String(html`By law, the office has until <b>${dayDate(addWorkdays(from, n, hol()))}</b> (${plural(n, 'working day')}).`) : '';
      };
      form.addEventListener('input', paint); form.addEventListener('change', paint); paint();
    },
    onSubmit: async (fd) => {
      const v = Object.fromEntries(fd);
      if (v.kind === 'charter' && !(Number(v.days) >= 1 && Number(v.days) <= 60)) throw new Error("Enter the working days in the office's Citizen's Charter (1 to 60).");
      if (v.fees === 'paid' && !v.fees_paid_on) throw new Error('Enter the day you paid the fees.');
      if (v.extended && !String(v.extension_note || '').trim()) throw new Error('Say what the office wrote about needing more time.');
      await db.filingSave({ id: f?.id, requirement_id: r.id, office: v.office.trim(), reference_no: v.reference_no?.trim(), filed_on: v.filed_on, kind: v.kind,
        days: v.kind === 'charter' ? v.days : LEGAL_DAYS[v.kind], fees: v.fees, fees_paid_on: v.fees === 'paid' ? v.fees_paid_on : null,
        extended: !!v.extended, extension_note: v.extension_note?.trim(), closed_days: v.closed_days || 0 });
      changed(r.id);
      toast(f ? 'Saved.' : "Clock started. We'll tell you if the office runs late.");
    },
  });
}
on('clock-start', (ds) => { const r = reqById(ds.id); if (r) openFiling(r); });
on('clock-edit', async (ds) => {
  const r = reqById(ds.req); if (!r) return;
  const f = (await db.filings(r.id)).find((x) => x.id === ds.id); if (f) openFiling(r, f);
});
on('clock-close', (ds) => {
  const r = reqById(ds.req); if (!r) return;
  openModal('What happened?', html`<fieldset class="clock-kinds"><legend class="sr-only">What happened</legend>
    <label class="check"><input type="radio" name="status" value="released" checked><span><b>I got it</b> <small class="muted">The office released the permit. Record it on this page next.</small></span></label>
    <label class="check"><input type="radio" name="status" value="denied"><span><b>It was returned</b> <small class="muted">The office asked for more or turned it down, in writing</small></span></label>
    <label class="check"><input type="radio" name="status" value="withdrawn"><span><b>Stop the clock</b> <small class="muted">I withdrew it, or added it by mistake</small></span></label></fieldset>
    <label class="field"><span>When</span><input type="date" name="on" max="${todayPH()}" value="${todayPH()}" required></label>`, {
    submitLabel: 'Save',
    onSubmit: async (fd) => {
      await db.filingClose(ds.id, fd.get('status'), fd.get('on'));
      changed(r.id);
      toast(fd.get('status') === 'released' ? 'Great. Now record the new permit: tap Renew.' : 'The clock is stopped.');
    },
  });
});

// ---------------------------------------------------------------- the letters
// c: { kind, today, office, city, permit, isNew, business, address, name, email, phone, filed_on, due_on, ref, fees, fees_paid_on, days, charter,
//      extended, late_days, followup_on }
export function buildLetter(kind, c) {
  const dated = longDate(c.today);
  const permitWord = c.isNew ? `application for a ${c.permit}` : `renewal of our ${c.permit}`;
  const timeLine = `${c.days} working day${c.days === 1 ? '' : 's'}${c.charter ? " under the office's Citizen's Charter" : ''}${c.extended ? `, extended once to ${c.days * 2} working days as your office advised` : ''}`;
  const feesLine = c.fees === 'paid' ? `paid the assessed fees on ${longDate(c.fees_paid_on)}` : c.fees === 'none' ? 'no fees were due' : c.fees === 'assessed' ? 'the fees were assessed' : 'the fees have not yet been assessed';
  const deemed = c.fees === 'paid' || c.fees === 'none';
  const sign = [c.name || '________________', `Owner / authorized representative, ${c.business}`, c.address, [c.email, c.phone].filter(Boolean).join(' · ')].filter(Boolean).join('\n');
  if (kind === 'followup') {
    return `${dated}

The Head
${c.office}${c.city && !c.office.includes(c.city) ? `\n${c.city}` : ''}

Subject: Follow-up on the ${permitWord}${c.ref ? `, reference no. ${c.ref}` : ''}

Dear Sir or Madam:

On ${longDate(c.filed_on)}, ${c.business} submitted to your office the ${permitWord}${c.ref ? ` (reference no. ${c.ref})` : ''}, with complete requirements. ${c.fees === 'paid' ? `We ${feesLine}.` : `As of today, ${feesLine}.`}

Under Republic Act No. 11032, the Ease of Doing Business and Efficient Government Service Delivery Act of 2018, the processing time for this transaction is ${timeLine}. That period ended on ${longDate(c.due_on)}, and we have not yet received the ${c.permit} or a written notice of anything still needed.${deemed ? `

Section 10 of the same law provides that an application submitted with complete requirements and fees paid is deemed approved when it is not acted upon within the prescribed processing time.` : ''}

We respectfully ask that the ${c.permit} be released, or that we be informed in writing of what is still needed, within one (1) working day of this letter.

Thank you for your assistance.

Respectfully,

${sign}`;
  }
  return `${dated}

Anti-Red Tape Authority
complaints@arta.gov.ph

Subject: Complaint: processing time exceeded by ${c.office}

I respectfully file this complaint about a delay in processing, under Republic Act No. 11032.

Complainant: ${c.name || '________________'}, owner / authorized representative of ${c.business}${c.address ? `, ${c.address}` : ''}. ${[c.email && `Email: ${c.email}`, c.phone && `Mobile: ${c.phone}`].filter(Boolean).join('. ')}${c.email || c.phone ? '.' : ''}
Office concerned: ${c.office}${c.city && !c.office.includes(c.city) ? `, ${c.city}` : ''}
Transaction: ${c.isNew ? 'application for' : 'renewal of'} ${c.permit}
Filed with complete requirements on: ${longDate(c.filed_on)}
Reference number: ${c.ref || 'none was given'}
Fees: ${c.fees === 'paid' ? `paid on ${longDate(c.fees_paid_on)}` : FEES[c.fees].toLowerCase()}
Processing time: ${timeLine}, which ended on ${longDate(c.due_on)}

As of today, ${c.late_days} working day${c.late_days === 1 ? '' : 's'} past that period, the office has not released the ${c.permit} or told us in writing what is still needed.${c.followup_on ? ` We wrote to the office on ${longDate(c.followup_on)} and have not received a reply.` : ''}

Attached: the acknowledgment receipt or claim stub${c.fees === 'paid' ? ', the official receipt for the fees' : ''}${c.followup_on ? ', and our follow-up letter' : ''}.

I ask the Authority to look into this delay and to direct the office to act on our application${deemed ? ', which is deemed approved under Section 10 of RA 11032 since complete requirements were submitted and the fees paid' : ''}.

I certify that the information above is true and correct.

${c.name || '________________'}
${dated}`;
}
async function openLetter(r, f, kind) {
  const p = placeOf(r);
  const me = S.profile || {};
  const c = { today: todayPH(), office: f.office, city: p.city, permit: r.name, isNew: !r.cycle_id, business: p.name, address: p.address,
    name: [me.first_name, me.last_name].filter(Boolean).join(' '), email: me.email || S.user?.email || '', phone: me.phone ? String(me.phone).replace(/^\+63(\d{3})(\d{3})(\d{4})$/, '0$1 $2 $3') : '',
    filed_on: f.filed_on, due_on: f.due_on, ref: f.reference_no, fees: f.fees, fees_paid_on: f.fees_paid_on, days: f.days, charter: f.kind === 'charter',
    extended: f.extended, late_days: Math.max(1, workdaysBetween(f.due_on, todayPH(), hol())), followup_on: f.followup_at ? f.followup_at.slice(0, 10) : null };
  const text = buildLetter(kind, c);
  const arta = kind === 'complaint';
  const subject = arta ? `Complaint: processing time exceeded by ${f.office}` : `Follow-up on ${r.name}${f.reference_no ? `, ref. ${f.reference_no}` : ''}`;
  db.filingLetter(f.id, kind).then(() => { if (!(arta ? f.complaint_at : f.followup_at)) changed(r.id); }).catch(() => {});
  openModal(arta ? 'Complaint to ARTA' : `Follow-up letter to ${f.office}`, html`
    <p class="muted small">${arta ? html`Send this only after the follow-up letter didn't work. Check it, then email it to ARTA or file it on ARTA's website. Attach the claim stub${f.fees === 'paid' ? ', the official receipt' : ''} and your follow-up letter.`
      : 'Check it and fill in anything missing. Print and sign it, and hand it to the office (ask for a "received" stamp on your copy), or email it to the office.'}</p>
    <label class="field"><span>The letter <small>(you can edit it here)</small></span><textarea class="letter-text" name="letter" rows="16" spellcheck="true">${text}</textarea></label>
    <div class="btn-row wrap">
      <button type="button" class="btn btn-soft btn-sm" data-letter="copy">Copy</button>
      <button type="button" class="btn btn-soft btn-sm" data-letter="word">Download for Word</button>
      <button type="button" class="btn btn-soft btn-sm" data-letter="print">Print</button>
      ${arta ? html`<a class="btn btn-primary btn-sm" data-letter="mail" href="#">Email it to ARTA</a>
        <a class="btn btn-ghost btn-sm" href="https://ecms.arta.gov.ph/" target="_blank" rel="noopener">File on ARTA's website<span class="sr-only"> (opens in a new tab)</span></a>` : ''}
    </div>
    ${arta ? html`<label class="field"><span>ARTA reference number <small>(when you get one, to keep it with this permit)</small></span><input name="arta_ref" maxlength="120" value="${f.complaint_ref || ''}"></label>` : ''}`, {
    wide: true,
    ...(arta ? { submitLabel: 'Save' } : {}),
    onOpen: (form) => {
      const val = () => form.letter.value;
      form.querySelector('[data-letter=copy]').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(val()); toast('Copied.'); } catch { form.letter.select(); toast('Selected: copy it with your keyboard.'); }
      });
      form.querySelector('[data-letter=word]').addEventListener('click', () => {
        const body = esc(val()).split('\n').map((l) => `<p style="margin:0;min-height:1em">${l || '&nbsp;'}</p>`).join('');
        download(`${arta ? 'ARTA complaint' : 'Follow-up letter'} - ${p.name}.doc`.replace(/[\\/:*?"<>|]+/g, '-'),
          '﻿' + `<html><head><meta charset="utf-8"><title>${esc(subject)}</title></head><body style="font-family:'Times New Roman',serif;font-size:12pt;line-height:1.5">${body}</body></html>`, 'application/msword');
      });
      form.querySelector('[data-letter=print]').addEventListener('click', () => printSheet(String(html`<article class="tpl-print"><pre>${val()}</pre></article>`)));
      form.querySelector('[data-letter=mail]')?.addEventListener('click', (e) => {
        e.preventDefault();
        location.href = `mailto:complaints@arta.gov.ph?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(val())}`;
      });
    },
    onSubmit: arta ? async (fd) => {
      const ref = String(fd.get('arta_ref') || '').trim();
      if (ref !== (f.complaint_ref || '')) { await db.filingLetter(f.id, 'complaint', ref); changed(r.id); toast('Saved.'); }
    } : undefined,
  });
}
on('clock-letter', async (ds) => {
  const r = reqById(ds.req); if (!r) return;
  try {
    if (!HOL) await loadHolidays();
    const f = (await db.filings(r.id)).find((x) => x.id === ds.id);
    if (f) openLetter(r, f, ds.kind);
  } catch (e) { toastError(e); }
});

// ---------------------------------------------------------------- city bills
const BILL_STATUS = { due: ['To pay', 'soon'], pending_verification: ['Checking your payment', 'progress'], processing: ["We're paying it", 'progress'],
  paid: ['Paid', 'ok'], refunded: ['Sent back to you', 'needinfo'], cancelled: ['Removed', 'needinfo'] };
const billFee = () => Number(SET?.billpay_fee ?? 499);
const billMax = () => Number(SET?.billpay_max ?? 50000);
const billOpen = () => (SET?.billpay_open ?? 'on') === 'on';
const dueWhen = (iso) => new Date(iso).toLocaleString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });

export function billsCard(r, bills = []) {
  if (!has('billpay') || !r) return '';
  const edit = canEdit();
  const shown = bills.filter((b) => b.status !== 'cancelled');
  if (!shown.length) {
    if (!edit) return '';
    return html`<section class="card bills-card" id="bills"><div class="card-head"><h2>Got a bill from the office?</h2></div>
      <p>Snap the tax bill, statement of account or order of payment. We remind you before it's due and keep the receipt with this permit.</p>
      ${billOpen() && isOrgAdmin() ? billOffer(r) : ''}
      <div class="btn-row"><button class="btn btn-soft btn-sm" data-act="bill-add" data-id="${r.id}">${ICON.camera} Add a bill I'll pay myself</button></div></section>`;
  }
  return html`<section class="card bills-card" id="bills"><div class="card-head"><div><h2>Bills and receipts</h2><p class="card-sub">From the office, for this permit</p></div>
    ${when(edit, html`<button class="btn btn-soft btn-sm" data-act="bill-add" data-id="${r.id}">${ICON.camera} Add a bill</button>`)}</div>
    ${shown.map((b) => billRow(r, b, edit))}
    ${billOpen() && isOrgAdmin() && !shown.some((b) => b.mode === 'permitpal' && ['due', 'pending_verification', 'processing'].includes(b.status)) ? billOffer(r) : ''}</section>`;
}
// Can Pinoy Permit pay this one? Only where the office takes payment online (confirmed on an official page):
// a Mayor's Permit in such a city. Everything else needs someone at a counter, which is coming later.
const subjectName = (r) => (r.business_id ? business(r.business_id)?.name : r.vehicle_id ? [vehicle(r.vehicle_id)?.plate_no, vehicle(r.vehicle_id)?.make_model].filter(Boolean).join(' · ') : '') || '';
export function billOnline(r) {
  if (!has('lgus')) return { ok: true };
  const city = placeOf(r).city;
  const key = cityKey(city);
  const lgu = (LGUS || []).find((g) => g.city_key === key) || null;
  if (r.type_code !== 'mayors_permit') return { ok: false, lgu, why: r.subject === 'vehicle' ? 'LTO and insurance payments' : `${typeOf(r.type_code)?.agency || 'This office'} payments` };
  if (lgu?.online_payment === 'yes') return { ok: true, lgu };
  return { ok: false, lgu, why: lgu ? `${lgu.name} business tax` : city ? `${city} business tax` : 'This city' };
}
const billable = () => (S.data?.reqs || []).filter((r) => r.subject !== 'person');
// "We pay it for you": pick the bill, see straight away if we can pay it online. The price, what a trip to the office
// really costs, and one flat fee; or, when it needs a counter, a heads-up that in-person runs are coming.
function billOffer(r, compact = false) {
  const list = has('lgus') && !compact ? billable() : [];
  const yes = list.filter((x) => billOnline(x).ok);
  const no = list.filter((x) => !billOnline(x).ok);
  const opt = (x) => html`<option value="${x.id}" ${x.id === r.id ? 'selected' : ''}>${x.name}${subjectName(x) ? ` · ${subjectName(x)}` : ''}</option>`;
  return html`<div class="bill-offer ${compact ? 'compact' : ''}" data-bill-offer>
    ${list.length > 1 ? html`<label class="field bill-pick"><span>Which bill should we pay?</span><select data-bill-pick>
      ${yes.length ? html`<optgroup label="We can pay these online">${yes.map(opt)}</optgroup>` : ''}
      ${no.length ? html`<optgroup label="Coming soon: these need a trip to the counter">${no.map(opt)}</optgroup>` : ''}</select></label>` : ''}
    <div data-bill-body>${billBody(r, compact)}</div>
  </div>`;
}
function billBody(r, compact = false) {
  const can = billOnline(r);
  if (!can.ok) {
    return html`<div class="bill-offer-top"><span class="bill-offer-tag bill-soon-tag">Coming soon</span><b>In-person bill runs are on the way</b></div>
      <p class="bill-soon">${can.why} still need someone at the counter. We're building a team of trusted runners so we can take this off your hands too.
        Until then, add the bill below: we'll remind you before it's due and keep the receipt with your permit.</p>
      ${can.lgu?.payment_note ? html`<p class="muted small"><b>How ${can.lgu.name} takes payment:</b> ${can.lgu.payment_note}</p>` : ''}
      <button class="btn btn-soft ${compact ? 'btn-sm' : ''}" data-act="bill-add" data-id="${r.id}">${ICON.camera} Add a bill I'll pay myself</button>`;
  }
  return html`<div class="bill-offer-top"><span class="bill-offer-tag">Skip the line</span><b>Let Pinoy Permit pay it: ${peso(billFee())} flat</b></div>
    ${compact ? '' : html`<ul class="bill-offer-list">
      <li>${ICON.check}<span><b>No queue, no half-day off.</b> Paying at the treasurer's window often takes a morning, plus transport and parking.</span></li>
      <li>${ICON.check}<span><b>Snap, send once, done.</b> We pay the office online, through its own payment channel, with the bill's reference number. We never ask for your login.</span></li>
      <li>${ICON.check}<span><b>Receipt filed for you.</b> The official receipt lands on this permit, ready for next year.</span></li>
    </ul>
    <p class="bill-offer-math">A morning away from your business usually costs more than ${peso(billFee())}. This is the one bill you won't have to think about.</p>`}
    <button class="btn btn-primary ${compact ? 'btn-sm' : ''}" data-act="bill-add" data-id="${r.id}" data-mode="permitpal">${compact ? `Have Pinoy Permit pay it: ${peso(billFee())}` : `Have Pinoy Permit pay my bill · ${peso(billFee())}`}</button>
    ${compact ? '' : html`<p class="muted small">Send it at least 3 business days before it's due. Bills up to ${peso(billMax())}.</p>`}`;
}
document.addEventListener('change', (e) => {
  const sel = e.target.closest?.('[data-bill-pick]');
  if (!sel) return;
  const r = reqById(sel.value);
  const body = sel.closest('[data-bill-offer]')?.querySelector('[data-bill-body]');
  if (r && body) body.innerHTML = String(billBody(r));
});
function billRow(r, b, edit) {
  const [label, cls] = BILL_STATUS[b.status] || ['', 'needinfo'];
  const pp = b.mode === 'permitpal';
  const late = b.status === 'due' && b.pay_by && b.pay_by < todayPH();
  const admin = isOrgAdmin();
  const line = b.status === 'due' ? (pp ? html`Send Pinoy Permit <b>${peso(Number(b.amount_php) + Number(b.fee_php))}</b> (the bill plus our ${peso(b.fee_php)} fee) and we pay it.${b.note ? html` <span class="bill-note">${b.note}</span>` : ''}`
      : html`You pay the office.${b.pay_by ? ` We remind you 3 days before and on ${fmtDate(b.pay_by)}.` : ''}`)
    : b.status === 'pending_verification' ? 'We confirm your payment within 1 business day, then pay the office.'
    : b.status === 'processing' ? html`We aim to pay ${b.office} by <b>${dueWhen(b.pay_deadline)}</b>. The official receipt will be here.`
    : b.status === 'paid' ? html`${pp ? 'Pinoy Permit paid it' : 'Paid'}${b.or_no ? html`: official receipt <b>${b.or_no}</b>` : ''}${b.or_date ? `, ${fmtDate(b.or_date)}` : ''}.${b.document_id ? " It's with this permit's files." : ''}`
    : b.status === 'refunded' ? html`${b.refund_note || 'We sent your money back.'}` : '';
  return html`<div class="bill-row">
    <div class="bill-main"><div class="bill-top"><b>${b.office}</b> <span class="bill-amt">${peso(b.amount_php)}</span></div>
      <small class="muted">${b.number}${b.bill_ref ? ` · bill no. ${b.bill_ref}` : ''}${b.pay_by ? ` · pay by ${fmtDate(b.pay_by)}` : ''}${pp ? ' · Pinoy Permit pays it' : ''}</small>
      <p class="small bill-line">${line}</p>
      ${when(!pp && b.status === 'due' && edit && admin && billOpen() && billOnline(r).ok, html`<div class="bill-nudge"><span>Rather not queue for this one?</span>
        <button class="btn btn-soft btn-sm" data-act="bill-switch" data-id="${b.id}" data-req="${r.id}">Have Pinoy Permit pay it: ${peso(billFee())}</button></div>`)}</div>
    <div class="bill-side"><span class="chip ${late ? 'overdue' : cls}">${late ? 'Past its pay-by date' : label}</span>
      ${when(edit && b.status === 'due', html`<div class="btn-row">
        ${pp ? (admin ? html`<button class="btn btn-primary btn-sm" data-act="bill-pay" data-id="${b.id}" data-req="${r.id}">Pay ${peso(Number(b.amount_php) + Number(b.fee_php))}</button>` : '')
          : html`<button class="btn btn-soft btn-sm" data-act="bill-paid" data-id="${b.id}" data-req="${r.id}">I paid it</button>`}
        ${when(!pp || admin, html`<button class="btn btn-ghost btn-sm" data-act="bill-cancel" data-id="${b.id}" data-req="${r.id}" aria-label="Remove bill ${b.number}">Remove</button>`)}</div>`)}</div>
  </div>`;
}

function openBill(r, pre = {}) {
  const admin = isOrgAdmin();
  const online = billOnline(r).ok;
  const can = admin && billOpen() && online;
  const want = can && pre.mode === 'permitpal';
  openModal(`Add a bill: ${r.name}`, html`
    <div class="scan-box"><button type="button" class="btn btn-soft btn-sm" data-bill-scan>${ICON.camera} Snap the bill</button>
      <input type="file" accept="image/*" capture="environment" data-bill-cam hidden aria-label="Photo of the bill">
      <small class="muted">We read the amount, the bill number and the due date on this phone. Check them against the paper.</small>
      <div class="scan-status" aria-live="polite"></div></div>
    <label class="field"><span>Photo or PDF of the bill <small data-photo-hint>(optional when you pay it yourself)</small></span><input type="file" name="file" accept="image/*,.pdf"></label>
    <label class="field"><span>Office that sent it</span><input name="office" maxlength="160" required value="${pre.office || (r.type_code === 'mayors_permit' && placeOf(r).city ? `${placeOf(r).city} Treasurer's Office` : officeOf(r))}"></label>
    <div class="grid2">
      <label class="field"><span>Amount to pay (₱)</span><input name="amount" type="number" min="0.01" max="1000000" step="0.01" inputmode="decimal" required value="${pre.amount ?? ''}"></label>
      <label class="field"><span>Pay by <small>(if the bill says)</small></span><input type="date" name="pay_by" value="${pre.pay_by || ''}"></label>
    </div>
    <label class="field"><span>Bill or reference no. <small>(optional)</small></span><input name="bill_ref" maxlength="120" placeholder="e.g. SOA 2027-0145521" value="${pre.bill_ref || ''}"></label>
    <fieldset class="clock-kinds bill-modes"><legend>Who pays it?</legend>
      <label class="check bill-mode-pp ${can ? '' : 'is-off'}"><input type="radio" name="mode" value="permitpal" ${can ? '' : 'disabled'} ${want ? 'checked' : ''}><span>
        <b>Pinoy Permit pays it for me · ${peso(billFee())} flat</b> ${can ? html`<em class="bill-offer-tag">Skip the line</em>` : ''}
        <small class="muted">${!billOpen() ? "Pinoy Permit isn't paying bills right now." : !online ? "This office needs someone at the counter. In-person bill runs are coming soon; for now, pay this one yourself." : !admin ? 'Ask your workspace owner or an admin: they can have Pinoy Permit pay it.'
          : `No queue, no half-day off. Send the bill plus ${peso(billFee())} once (GCash, Maya or bank); we pay the office and put the official receipt here. Bills up to ${peso(billMax())}.`}</small></span></label>
      <label class="check"><input type="radio" name="mode" value="self" ${want ? '' : 'checked'}><span><b>I'll go pay the office myself</b> <small class="muted">We remind you 3 days before it's due and on the day. Add the receipt after.</small></span></label>
    </fieldset>
    <p class="bill-total" aria-live="polite"></p>
    <p class="muted small"><a href="terms.html#bills" target="_blank" rel="noopener">How paying bills works<span class="sr-only"> (opens in a new tab)</span></a></p>`, {
    submitLabel: 'Save the bill',
    onOpen: (form) => {
      const paint = () => {
        const pp = form.mode.value === 'permitpal';
        const amt = Number(form.amount.value) || 0;
        form.querySelector('[data-photo-hint]').textContent = pp ? '(needed, so we pay exactly what it says)' : '(optional when you pay it yourself)';
        const soon = pp && form.pay_by.value && form.pay_by.value <= addWorkdays(todayPH(), 1, hol());
        form.querySelector('.bill-total').innerHTML = pp && amt ? String(html`You send <b>${peso(amt + billFee())}</b>: the bill's ${peso(amt)} plus our ${peso(billFee())} fee.
          ${amt > billMax() ? html`<span class="form-error">Pinoy Permit pays bills up to ${peso(billMax())}. Pay this one at the office.</span>` : ''}
          ${soon ? html`<span class="form-error">It's due very soon. We may not pay it in time, and any surcharge would be yours: pay the office directly if you can.</span>` : ''}`)
          : !pp && amt && can ? String(html`<span class="muted">Going yourself? Remember the line, the travel and the receipt. Switch to Pinoy Permit anytime for ${peso(billFee())}.</span>`) : '';
      };
      form.addEventListener('input', paint); form.addEventListener('change', paint); paint();
      wireBillScan(form, paint);
    },
    onSubmit: async (fd) => {
      const v = Object.fromEntries(fd);
      const file = fd.get('file');
      if (v.mode === 'permitpal' && !(file && file.size)) throw new Error('Add a photo of the bill, so we pay exactly what it says.');
      const amount = Number(v.amount);
      if (!(amount > 0) || Math.round(amount * 100) !== amount * 100) throw new Error('Enter the amount on the bill, in pesos and centavos.');
      const id = await db.billAdd(S.org.id, r.id, { office: v.office.trim(), bill_ref: v.bill_ref?.trim(), amount, pay_by: v.pay_by, mode: v.mode }, file);
      // switching a bill they meant to pay themselves: the old one goes
      if (pre.replaces && v.mode === 'permitpal') await db.billCancel(pre.replaces).catch(() => {});
      changed(r.id);
      if (v.mode === 'permitpal') {
        const b = (await db.bills(r.id)).find((x) => x.id === id);
        if (b) setTimeout(() => openPayBill(b), 30);
      } else toast(v.pay_by ? `Saved. We'll remind you before ${fmtDate(v.pay_by)}.` : 'Saved.');
    },
  });
}
// Snap the bill: read the amount, number and due date (only into empty boxes), and attach the photo.
function wireBillScan(form, paint) {
  const box = form.querySelector('.scan-box');
  const btn = box.querySelector('[data-bill-scan]');
  const cam = box.querySelector('[data-bill-cam]');
  const status = box.querySelector('.scan-status');
  btn.addEventListener('click', () => cam.click());
  cam.addEventListener('change', async () => {
    const file = cam.files[0];
    if (!file) return;
    try { const dt = new DataTransfer(); dt.items.add(file); form.file.files = dt.files; } catch { /* they can pick it below */ }
    btn.disabled = true;
    const say = (pct, msg) => { status.innerHTML = String(html`<div class="scan-progress"><span style="width:${Math.round(pct * 100)}%"></span></div><small>${msg}</small>`); };
    try {
      const { readPhoto } = await import('../ocr.js');
      const got = readBill(await readPhoto(file, say), todayPH());
      if (got.chars < 20) { status.innerHTML = String(html`<p class="banner warn">We couldn't make out the text. Type the amount in, and keep the photo attached.</p>`); return; }
      const filled = [];
      const put = (name, v, label) => { const el = form[name]; if (v != null && el && !el.value) { el.value = v; el.classList.add('from-scan'); filled.push(label); } };
      put('amount', got.amounts[0]?.toFixed(2), 'amount'); put('bill_ref', got.ref, 'bill number'); put('pay_by', got.payBy, 'pay-by date');
      status.innerHTML = String(html`<p class="small">${filled.length ? html`Filled in the ${filled.join(', ')}. <b>Check them against the bill.</b>` : 'Nothing new to fill in.'}
        ${got.amounts.length > 1 ? html` Other amounts on it: ${got.amounts.slice(1).map((a) => html`<button type="button" class="chip-btn small" data-amt="${a.toFixed(2)}">${peso(a)}</button>`)}` : ''}</p>`);
      status.querySelectorAll('[data-amt]').forEach((b) => b.addEventListener('click', () => { form.amount.value = b.dataset.amt; paint(); }));
      paint();
    } catch (e) {
      status.innerHTML = String(html`<p class="form-error" role="alert">${e.message || "We couldn't read that photo."} The photo is still attached.</p>`);
    } finally { btn.disabled = false; cam.value = ''; }
  });
}
async function openPayBill(b) {
  const st = SET || (SET = await db.appSettings());
  const total = Number(b.amount_php) + Number(b.fee_php);
  openModal(`Pay bill ${b.number}`, html`
    <div class="quote-hint"><b>${peso(total)}</b> <span class="muted">${b.office}'s ${peso(b.amount_php)} plus our ${peso(b.fee_php)} fee</span></div>
    <p class="small">Once we confirm your payment, we aim to pay ${b.office} by 6 pm the next business day and put the official receipt on your permit.
      If we can't pay it, everything you sent comes back. The bill's due date and any surcharge stay yours.</p>
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
      await db.billReport(b, { method: fd.get('method'), ref, file });
      changed(b.requirement_id);
      toast(`Thanks! We'll confirm it within 1 business day, then pay ${b.office}.`);
    },
  });
}
on('bill-add', async (ds) => {
  const r = reqById(ds.id); if (!r) return;
  SET = await db.appSettings().catch(() => SET); // the fee and limits as they are now (not the copy cached for the session)
  if (!HOL) await loadHolidays();
  openBill(r, { mode: ds.mode });
});
// A bill they meant to pay themselves, handed to Pinoy Permit instead (the details carry over).
on('bill-switch', async (ds) => {
  const r = reqById(ds.req); if (!r) return;
  const b = (await db.bills(r.id).catch(() => [])).find((x) => x.id === ds.id);
  if (!b) return;
  SET = await db.appSettings().catch(() => SET);
  if (!HOL) await loadHolidays();
  openBill(r, { mode: 'permitpal', office: b.office, amount: b.amount_php, pay_by: b.pay_by, bill_ref: b.bill_ref, replaces: b.id });
});
on('bill-pay', async (ds) => {
  try { const b = (await db.bills(ds.req)).find((x) => x.id === ds.id); if (b) openPayBill(b); } catch (e) { toastError(e); }
});
on('bill-paid', async (ds) => {
  const b = (await db.bills(ds.req).catch(() => [])).find((x) => x.id === ds.id);
  if (!b) return;
  openModal(`Paid: ${b.office} ${peso(b.amount_php)}`, html`
    <p class="muted small">Add the official receipt. A photo goes with this permit's files, so it's there for next year and for any inspection.</p>
    <div class="grid2">
      <label class="field"><span>Official receipt no.</span><input name="or_no" maxlength="60" placeholder="e.g. 7731905"></label>
      <label class="field"><span>Date on the receipt</span><input type="date" name="or_date" required max="${todayPH()}" value="${todayPH()}"></label>
    </div>
    <label class="field"><span>Photo of the receipt <small>(optional if you typed its number)</small></span><input type="file" name="file" accept="image/*,.pdf"></label>`, {
    submitLabel: 'Save',
    onSubmit: async (fd) => {
      const file = fd.get('file');
      const orNo = String(fd.get('or_no') || '').trim();
      if (!orNo && !(file && file.size)) throw new Error('Add the official receipt number or a photo of it.');
      await db.billPaidSelf(b, { or_no: orNo, or_date: fd.get('or_date'), file });
      changed(b.requirement_id);
      toast(billOpen() && isOrgAdmin() ? `Saved, with the receipt. Next time, skip the trip: Pinoy Permit pays bills for ${peso(billFee())}.` : 'Saved, with the receipt.');
    },
  });
});
on('bill-cancel', async (ds) => {
  if (!(await confirmDialog('Remove this bill?', "Only if nobody has paid it. You can add it again anytime.", { confirmLabel: 'Remove' }))) return;
  try { await db.billCancel(ds.id); changed(ds.req); toast('Removed.'); } catch (e) { toastError(e); }
});
