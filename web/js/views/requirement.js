// A single requirement: its current record, files, past records and history — plus the
// flows used everywhere else (add details, upload, renew, started renewing).
import { html, fmtDate, fmtDateTime, timeAgo, fileSize, todayPH, openModal, confirmDialog, toast, toastError, formObject, when, peso } from '../util.js';
import { S, on, go, reload, canEdit, reqById, typeOf, vehicle, memberName, empty, subjectHref } from '../core.js';
import { loadPartners, partnerSuggestions, penaltyNote } from './extras.js';
import { STATUS, statusChip, dueText, subjectLabel, ICON } from '../components.js';
import { suggestDue } from '../rules.js';
import * as db from 'pp/data';

let detail = null;       // { id, cycles, documents, activity }
let loadingId = null;

export async function render(el, id) {
  const r = reqById(id);
  if (!r) {
    el.innerHTML = String(empty('Not found', 'This requirement was deleted or you no longer have access to it.',
      html`<a class="btn btn-primary" href="#/">Back to dashboard</a>`));
    return;
  }
  if (!detail || detail.id !== id) {
    el.innerHTML = String(html`<div class="loading">Loading…</div>`);
    if (loadingId === id) return;
    loadingId = id;
    try {
      const [d] = await Promise.all([db.requirementDetail(id), loadPartners()]);
      detail = { id, ...d };
    } catch (e) { toastError(e); }
    loadingId = null;
    if (!location.hash.includes(id)) return; // navigated away while loading
  }
  el.innerHTML = String(page(r));
}

export function forget() { detail = null; }

function page(r) {
  const t = typeOf(r.type_code);
  const current = detail.cycles.find((c) => c.id === r.cycle_id);
  const past = detail.cycles.filter((c) => c.id !== r.cycle_id);
  const docsOf = (cycleId) => detail.documents.filter((d) => d.cycle_id === cycleId);
  const parentHref = subjectHref(r);
  const edit = canEdit();

  return html`
    <a class="back" href="${parentHref}">← ${subjectLabel(r)}</a>
    <div class="page-head">
      <div>
        <h1>${r.name}</h1>
        <p class="due-line due ${STATUS[r.status].cls}">${dueText(r)}</p>
        ${when(t?.agency, html`<p class="agency">${t?.agency}</p>`)}
      </div>
      <div class="head-side">${statusChip(r.status, '', 'lg')}</div>
    </div>

    ${when(r.confidence !== 'confirmed', html`
      <div class="banner info">
        <div><b>Does this apply to you?</b> PermitPal added this because businesses like yours usually need it
        (${r.confidence === 'likely' ? 'likely required' : 'needs checking'}). Confirm it or remove it.</div>
        ${when(edit, html`<div class="banner-actions">
          <button class="btn btn-sm btn-primary" data-act="req-confirm" data-id="${r.id}">Yes, it applies</button>
          <button class="btn btn-sm btn-ghost" data-act="req-delete" data-id="${r.id}">Doesn't apply</button></div>`)}
      </div>`)}

    ${when(r.status === 'in_progress', html`
      <div class="banner progress">
        <div>${r.open_request_id ? 'PermitPal is helping with this renewal.' : 'You marked this renewal as started.'}
        ${r.is_overdue ? ' It is past its expiry date, so finish it soon.' : ''} When you have the new permit, record it here.</div>
        ${when(edit, html`<div class="banner-actions">
          <button class="btn btn-sm btn-primary" data-act="req-renew" data-id="${r.id}">Record renewal</button>
          ${when(!r.open_request_id, html`<button class="btn btn-sm btn-ghost" data-act="req-stop-renewal" data-id="${r.id}">Not renewing yet</button>`)}
        </div>`)}
      </div>`)}

    ${when(t?.help_text, html`<p class="help-text">${t?.help_text}</p>`)}
    ${['action_required', 'renew_soon'].includes(r.status) ? penaltyNote(r) : ''}

    <section class="card">
      <div class="card-head"><h2>Current record</h2>
        ${when(edit, html`<div class="btn-row">
          <button class="btn btn-sm btn-soft" data-act="req-edit" data-id="${r.id}">${current ? 'Edit details' : 'Add details'}</button>
          <button class="btn btn-sm btn-soft" data-act="req-upload" data-id="${r.id}">${ICON.upload} Upload</button>
          ${when(r.expires && current, html`<button class="btn btn-sm btn-primary" data-act="req-renew" data-id="${r.id}">Renew</button>`)}
        </div>`)}
      </div>
      ${current ? recordBody(current, r) : html`<p class="muted">Nothing recorded yet. Add the reference number${r.expires ? ', expiry date' : ''} and upload a copy of the document.</p>`}
      ${current ? filesList(docsOf(current.id)) : ''}
    </section>

    <div class="btn-row wrap">
      ${when(edit && r.expires && r.status !== 'in_progress' && r.status !== 'compliant', html`
        <button class="btn btn-ghost" data-act="req-start-renewal" data-id="${r.id}">I've started the renewal</button>`)}
    </div>
    ${partnerSuggestions(r)}

    ${when(past.length, html`
      <section class="card">
        <h2>Past records</h2>
        <p class="muted small">Every earlier permit period stays on file, with its documents.</p>
        ${past.map((c) => html`<div class="past">${recordBody(c, r, true)}${filesList(docsOf(c.id), true)}</div>`)}
      </section>`)}

    ${when(detail.documents.some((d) => !d.cycle_id), html`
      <section class="card"><h2>Other files</h2>${filesList(detail.documents.filter((d) => !d.cycle_id))}</section>`)}

    <section class="card">
      <div class="card-head"><h2>Notes</h2>${when(edit, html`<button class="btn btn-sm btn-ghost" data-act="req-notes" data-id="${r.id}">Edit</button>`)}</div>
      <p class="lined ${r.notes ? '' : 'muted'} pre">${r.notes || 'No notes. Add the office address, contact person, fees paid, or anything worth remembering next year.'}</p>
    </section>

    <section class="card">
      <h2>Activity</h2>
      ${detail.activity.length ? detail.activity.map((a) => html`
        <div class="hist"><div>${a.summary}</div><div class="muted small">${memberName(a.actor_id)} · ${timeAgo(a.created_at)}</div></div>`)
        : html`<p class="muted">No activity yet.</p>`}
    </section>

    ${when(edit, html`<div class="danger-zone"><button class="btn btn-ghost danger" data-act="req-delete" data-id="${r.id}">Delete this requirement</button>
      <span class="muted small">You can restore it from Trash.</span></div>`)}
  `;
}

function recordBody(c, r, compact = false) {
  const rows = [
    ['Reference no.', c.reference_no || '—'],
    ['Issued by', c.issuer || '—'],
    ['Issued on', c.issued_on ? fmtDate(c.issued_on) : '—'],
    ['Expires', r.expires ? (c.expires_on ? fmtDate(c.expires_on) : 'Not entered') : 'Does not expire'],
    ['Amount paid', c.amount_paid != null ? peso(c.amount_paid) : '—'],
  ];
  return html`<dl class="${compact ? 'kv compact' : 'kv'}">${rows.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>
    ${when(compact, html`<div class="muted small">Recorded ${fmtDateTime(c.created_at)}</div>`)}`;
}

function filesList(docs, compact = false) {
  if (!docs.length) return compact ? '' : html`<p class="record-note due needinfo">No document uploaded for this record yet.</p>`;
  return html`<div class="files">${docs.map((d) => html`
    <div class="file">
      <span class="file-ic">${ICON.file}</span>
      <div class="file-main"><div class="file-name">${d.file_name}</div><div class="muted small">${fileSize(d.size_bytes)} · uploaded ${fmtDate(d.created_at)}</div></div>
      <div class="btn-row">
        <button class="btn btn-sm btn-soft" data-act="doc-view" data-path="${d.storage_path}" data-name="${d.file_name}" data-type="${d.mime_type || ''}">View</button>
        <button class="btn btn-sm btn-ghost" data-act="doc-download" data-path="${d.storage_path}" data-name="${d.file_name}">Download</button>
        ${when(canEdit(), html`<button class="btn btn-sm btn-ghost danger" data-act="doc-remove" data-id="${d.id}" data-name="${d.file_name}">Remove</button>`)}
      </div>
    </div>`)}</div>`;
}

// ---------------------------------------------------------------- shared flows

const fileField = (label = 'Document (PDF or photo, up to 10 MB)', note = '') => html`
  <label class="field"><span>${label}</span><input type="file" name="file" accept=".pdf,image/*">${when(note, html`<small>${note}</small>`)}</label>`;

function dueFields(r, values = {}) {
  const t = typeOf(r.type_code);
  return html`
    <div class="grid2">
      <label class="field"><span>Reference / permit no.</span><input name="reference_no" value="${values.reference_no || ''}" maxlength="100" placeholder="e.g. BP-2026-0442"></label>
      <label class="field"><span>Issued by <small>(optional)</small></span><input name="issuer" value="${values.issuer || ''}" maxlength="120" placeholder="${r.subject === 'vehicle' && r.type_code === 'ctpl' ? 'Insurance company' : 'Office or agency'}"></label>
      <label class="field"><span>Issued on</span><input type="date" name="issued_on" value="${values.issued_on || ''}" max="${todayPH()}"></label>
      <label class="field expiry-field" ${r.expires ? '' : 'hidden'}><span>Expires on</span><input type="date" name="expires_on" value="${values.expires_on || ''}"></label>
      <label class="field"><span>Amount paid <small>(₱, optional — for your budget)</small></span><input type="number" name="amount_paid" min="0" step="0.01" value="${values.amount_paid ?? ''}" placeholder="e.g. 4500"></label>
    </div>
    <div class="suggest" data-rule="${t?.due_rule || 'manual'}" hidden></div>
    <label class="check"><input type="checkbox" name="no_expiry" ${r.expires ? '' : 'checked'}> This document does not expire</label>`;
}

// Live due-date suggestion from the library rule (shown, never applied silently).
function wireSuggestion(form, r) {
  const box = form.querySelector('.suggest');
  const rule = box?.dataset.rule;
  const issued = form.querySelector('[name=issued_on]');
  const expires = form.querySelector('[name=expires_on]');
  const noExp = form.querySelector('[name=no_expiry]');
  const plate = r.subject === 'vehicle' ? vehicle(r.vehicle_id)?.plate_no : null;
  const update = () => {
    form.querySelector('.expiry-field').hidden = noExp.checked;
    const s = !noExp.checked && suggestDue(rule, { issuedOn: issued.value || null, plate });
    if (!s || s.date === expires.value) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = String(html`<span>Suggested expiry: <b>${fmtDate(s.date)}</b>. ${s.note}</span>
      <button type="button" class="btn btn-sm btn-soft">Use this date</button>`);
    box.querySelector('button').onclick = () => { expires.value = s.date; update(); };
  };
  [issued, expires, noExp].forEach((i) => i.addEventListener('input', update));
  noExp.addEventListener('change', update);
  update();
}

async function saveRecord(r, f, { cycleId, file }) {
  const noExpiry = !!f.no_expiry;
  if (!noExpiry && f.expires_on && f.issued_on && f.expires_on < f.issued_on) throw new Error('The expiry date is before the issue date.');
  if (noExpiry === r.expires) await db.updateRequirement(r.id, { expires: !noExpiry });
  const id = await db.saveCycle({
    cycleId, orgId: r.org_id, requirementId: r.id,
    reference_no: f.reference_no, issuer: f.issuer, issued_on: f.issued_on, expires_on: noExpiry ? null : f.expires_on, amount_paid: f.amount_paid,
  });
  if (file && file.size) await db.uploadDocument({ orgId: r.org_id, requirementId: r.id, cycleId: id, file });
  return id;
}

async function afterChange(message) {
  detail = null;
  await reload();
  toast(message);
}

export function openEdit(r) {
  const current = r.cycle_id ? {
    reference_no: r.reference_no, issuer: r.issuer, issued_on: r.issued_on, expires_on: r.expires_on, amount_paid: r.amount_paid,
  } : {};
  openModal(r.cycle_id ? `Edit details — ${r.name}` : `Add details — ${r.name}`, html`
    <p class="muted small">${subjectLabel(r)}. ${r.cycle_id ? 'Use this to correct the current record. To record a new permit period, use Renew instead.' : ''}</p>
    ${dueFields(r, current)}
    ${when(!r.cycle_id, fileField())}`, {
    submitLabel: 'Save',
    onOpen: (form) => wireSuggestion(form, r),
    onSubmit: async (fd) => {
      const f = formObject(fd);
      const problem = fd.get('file')?.size ? db.checkFile(fd.get('file')) : null;
      if (problem) throw new Error(problem);
      await saveRecord(r, f, { cycleId: r.cycle_id, file: r.cycle_id ? null : fd.get('file') });
      await afterChange('Saved.');
    },
  });
}

export function openRenew(r) {
  openModal(`Record renewal — ${r.name}`, html`
    <p class="muted small">${subjectLabel(r)}. This adds the new permit period and keeps the old one (and its document) as history.</p>
    ${dueFields(r, { issued_on: todayPH(), issuer: r.issuer })}
    ${fileField('Copy of the NEW document', "Until you upload the new document, this stays marked 'Needs info' instead of Compliant.")}`, {
    submitLabel: 'Save renewal',
    onOpen: (form) => wireSuggestion(form, r),
    onSubmit: async (fd) => {
      const f = formObject(fd);
      if (!f.no_expiry && !f.expires_on) throw new Error('Please enter the new expiry date.');
      const problem = fd.get('file')?.size ? db.checkFile(fd.get('file')) : null;
      if (problem) throw new Error(problem);
      await saveRecord(r, f, { cycleId: null, file: fd.get('file') });
      await afterChange(fd.get('file')?.size ? 'Renewal recorded.' : 'Renewal recorded. Upload the new document to mark it compliant.');
    },
  });
}

export function openUpload(r) {
  openModal(`Upload — ${r.name}`, html`
    <p class="muted small">${subjectLabel(r)}. ${r.cycle_id ? 'The file is attached to the current record.' : 'A record is created for it; add the reference number and dates next.'}</p>
    ${fileField()}`, {
    submitLabel: 'Upload',
    onSubmit: async (fd) => {
      const file = fd.get('file');
      const problem = db.checkFile(file);
      if (problem) throw new Error(problem);
      const cycleId = r.cycle_id || await db.saveCycle({ cycleId: null, orgId: r.org_id, requirementId: r.id });
      await db.uploadDocument({ orgId: r.org_id, requirementId: r.id, cycleId, file });
      await afterChange('File uploaded.');
    },
  });
}

export function nextAction(r) {
  if (r.next_action === 'renew' || r.next_action === 'record_renewal') return openRenew(r);
  if (r.next_action === 'upload') return openUpload(r);
  return openEdit(r);
}

// ---------------------------------------------------------------- click handlers
const withReq = (fn) => (ds) => { const r = reqById(ds.id); if (r) fn(r, ds); };

on('req-next', withReq(nextAction));
on('req-edit', withReq(openEdit));
on('req-renew', withReq(openRenew));
on('req-upload', withReq(openUpload));

on('req-confirm', withReq(async (r) => {
  try { await db.updateRequirement(r.id, { confidence: 'confirmed' }); await afterChange('Confirmed.'); } catch (e) { toastError(e); }
}));
on('req-start-renewal', withReq(async (r) => {
  try { await db.updateRequirement(r.id, { renewal_started_at: new Date().toISOString() }); await afterChange('Marked as in progress. We\'ll hold off on reminders unless it goes overdue.'); } catch (e) { toastError(e); }
}));
on('req-stop-renewal', withReq(async (r) => {
  try { await db.updateRequirement(r.id, { renewal_started_at: null }); await afterChange('Updated.'); } catch (e) { toastError(e); }
}));
on('req-notes', withReq((r) => {
  openModal('Notes', html`<label class="field"><textarea name="notes" rows="6" maxlength="2000">${r.notes || ''}</textarea></label>`, {
    onSubmit: async (fd) => { await db.updateRequirement(r.id, { notes: fd.get('notes').trim() || null }); await afterChange('Notes saved.'); },
  });
}));
on('req-delete', withReq(async (r) => {
  if (!(await confirmDialog(`Delete "${r.name}"?`, 'It stops being tracked and reminded. Its records and files are kept, and you can restore it from Trash.'))) return;
  try {
    await db.softDelete('requirements', r.id);
    const back = r.subject === 'business' ? `#/businesses/${r.business_id}` : `#/vehicles/${r.vehicle_id}`;
    detail = null;
    await reload();
    go(back);
    toast('Deleted. Restore it anytime from Trash.');
  } catch (e) { toastError(e); }
}));

on('doc-view', async (ds) => {
  try {
    const url = await db.fileUrl(ds.path);
    const isImg = /^image\/(jpeg|png|webp)/.test(ds.type) || /\.(jpe?g|png|webp)$/i.test(ds.name);
    const isPdf = ds.type === 'application/pdf' || /\.pdf$/i.test(ds.name);
    openModal(ds.name, isImg ? html`<img class="preview" src="${url}" alt="">`
      : isPdf ? html`<iframe class="preview" src="${url}" title="Document preview"></iframe>`
      : html`<p class="muted">This file type can't be previewed in the browser. Use Download.</p>`, { wide: true });
  } catch (e) { toastError(e); }
});
on('doc-download', async (ds) => {
  try { window.location.href = await db.fileUrl(ds.path, ds.name); } catch (e) { toastError(e); }
});
on('doc-remove', async (ds) => {
  if (!(await confirmDialog(`Remove "${ds.name}"?`, 'The file is hidden from this record. It is kept safely and can be restored from Trash.', { confirmLabel: 'Remove' }))) return;
  try { await db.softDelete('documents', ds.id); await afterChange('File removed. Restore it from Trash if needed.'); } catch (e) { toastError(e); }
});

