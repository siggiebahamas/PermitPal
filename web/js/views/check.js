// The automatic permit check (Plus). Pinoy Permit runs it every morning and whenever this page opens:
//   Fix these        facts from your own records (expired, no copy, no expiry date, a role's license missing)
//   Please confirm   things that look off but might be right, asked as questions ("It's right" closes them)
//   Coming up        renewals in the next 60 days
// It never says anything was checked with the government. Without Plus you see how many it found.
import { html, toast, toastError, when, plural, timeAgo, openModal, todayPH } from '../util.js';
import { S, on, reload, canEdit, business, vehicle, person, location_, typeOf } from '../core.js';
import { ICON } from '../components.js';
import { openUpsell, PLUS_PERKS } from './plus.js';
import * as db from 'pp/data';

const DISMISS_LABEL = { missing_common: "Doesn't apply", vehicle_missing: "Doesn't apply", branch_empty: 'None needed', duplicate: "They're different" };
let busy = false;

export async function checkPage(el) {
  el.innerHTML = String(html`${head()}<div class="loading">Checking your records…</div>`);
  // Nothing tracked yet: nothing to check, so show how to start instead of an empty page.
  if (!S.data.reqs.length) { el.innerHTML = String(html`${head()}${emptyCheck()}`); return; }
  let run;
  let list = [];
  try {
    run = await db.runPermitCheck(S.org.id);
    if (run.plus) list = await db.findings(S.org.id);
  } catch (e) {
    toastError(e);
    el.innerHTML = String(html`${head()}<section class="card empty-hero"><div class="empty-art" aria-hidden="true">${ICON.refresh || ICON.check}</div>
      <h2>The check didn't finish</h2><p>Your permits are safe. Try again in a minute.</p>
      <button class="btn btn-primary" data-act="check-run">Check again</button></section>`);
    return;
  }
  const open = list.filter((f) => f.status === 'open');
  const by = (sev) => open.filter((f) => f.severity === sev).sort((a, b) => a.title.localeCompare(b.title));
  const answered = list.filter((f) => f.status === 'dismissed');
  const pct = run.items ? Math.round((run.in_order / run.items) * 100) : 100;
  el.innerHTML = String(html`
    <div class="page-head"><div><h1>Permit check</h1><p class="page-sub">We look over your permits every morning and tell you what needs fixing.</p></div>
      <div class="btn-row"><button class="btn btn-ghost" data-act="check-run">Check again</button></div></div>
    <section class="card check-score">
      <div class="check-ring" style="--p:${pct}" role="img" aria-label="${run.in_order} of ${run.items} in order"><b>${run.in_order}</b><span>of ${run.items}</span></div>
      <div><h2>${run.items ? (run.in_order === run.items ? 'Everything is in order' : `${run.in_order} of ${run.items} in order`) : 'Nothing tracked yet'}</h2>
        <div class="chips">
          ${when(run.fix, html`<span class="chip overdue">${run.fix} to fix</span>`)}
          ${when(run.confirm, html`<span class="chip progress">${run.confirm} to confirm</span>`)}
          ${when(run.soon, html`<span class="chip soon">${run.soon} coming up</span>`)}
          ${when(!run.fix && !run.confirm && !run.soon, html`<span class="chip ok">Nothing to do</span>`)}</div>
        <p class="muted small">Checked ${timeAgo(run.ran_at).replace(/^Just now$/, 'just now')}. ${run.plus ? 'A report goes to the owner on the 1st of each month.' : ''}</p></div>
    </section>
    ${run.plus ? html`
      ${section('Fix these', 'From your own records. Each one closes by itself once it\'s fixed.', by('fix'), 'fix')}
      ${section('Please confirm', 'These look off but might be right. Check, then fix it or tell us it\'s right.', by('confirm'), 'confirm')}
      ${section('Coming up', 'Due in the next 60 days. Starting early avoids the rush.', by('soon'), 'soon')}
      ${when(!open.length, html`<section class="card"><p class="center"><b>All clear.</b> We'll keep checking every morning.</p></section>`)}
      <section class="card read-card" id="read-card"><div class="card-head"><div><h2>Read your photos</h2>
        <p class="card-sub">Pinoy Permit can read the dates on the photos you've uploaded, here on this device, and ask you if one doesn't match what's saved. PDFs aren't read.</p></div></div>
        <div class="read-out"><button class="btn btn-soft" data-act="check-read">Look for photos to read</button></div></section>
      ${when(answered.length, html`<details class="card"><summary><b>You answered</b> <span class="muted small">${plural(answered.length, 'question')}</span></summary>
        ${answered.map((f) => html`<div class="line"><div class="line-main"><b>${f.title}</b><small>${f.note ? `“${f.note}”` : 'Marked as right'}</small></div>
          ${when(canEdit(), html`<button class="btn btn-sm btn-ghost" data-act="finding-reopen" data-id="${f.id}">Undo</button>`)}</div>`)}</details>`)}`
    : html`<section class="card plus-teaser"><h2>See each one, and how to fix it</h2>
        <p>Pinoy Permit Plus lists every item it found with a one-tap fix, checks again every morning, reads the dates on your photos, and emails a report on the 1st.</p>
        <ul class="plus-perks">${PLUS_PERKS.map(([t, d]) => html`<li><b>${t}.</b> ${d}</li>`)}</ul>
        <button class="btn btn-primary" data-act="plus-upsell" data-what="The full permit check">See Plus</button></section>`}
    <p class="fineprint">Pinoy Permit checks your own records automatically. It doesn't issue permits or verify them with the government: anything it isn't sure about is asked, not stated.</p>`);
}

const head = () => html`<div class="page-head"><div><h1>Permit check</h1><p class="page-sub">We look over your permits every morning and tell you what needs fixing.</p></div></div>`;
// Shown when the workspace has no permits yet.
function emptyCheck() {
  return html`<section class="card empty-hero">
    <div class="empty-art" aria-hidden="true">${ICON.check}</div>
    <h2>Nothing to check yet</h2>
    <p>Add your first permit and we'll start checking it every morning: what's expired, what's missing, what's coming up.</p>
    <div class="btn-row center">${canEdit() ? html`<a class="btn btn-primary" href="${S.data.businesses.length ? '#/compliance' : '#/businesses?add=1'}">${S.data.businesses.length ? 'See my permits' : 'Add my business'}</a>` : ''}<a class="btn btn-ghost" href="#/">Go home</a></div>
  </section>`;
}

function section(title, sub, items, sev) {
  if (!items.length) return '';
  return html`<section class="card check-sec ${sev}"><div class="card-head"><div><h2>${title}</h2><p class="card-sub">${sub}</p></div>
    <b class="check-count" aria-label="${plural(items.length, 'item')}">${items.length}</b></div>
    ${items.slice(0, 3).map(row)}
    ${when(items.length > 3, html`<details class="check-more"><summary>Show ${plural(items.length - 3, 'more item')}</summary>${items.slice(3).map(row)}</details>`)}</section>`;
}
function where(f) {
  if (f.person_id) return person(f.person_id)?.full_name;
  if (f.vehicle_id) return vehicle(f.vehicle_id)?.plate_no || vehicle(f.vehicle_id)?.make_model;
  if (f.business_id) return business(f.business_id)?.name + (f.location_id && !location_(f.location_id)?.is_main ? ` (${location_(f.location_id)?.name})` : '');
  return '';
}
function row(f) {
  const open = f.requirement_id && S.data.reqs.some((r) => r.id === f.requirement_id);
  const add = ['add_permit', 'add_licence'].includes(f.action) && f.type_code && canEdit();
  const subjectHref = f.person_id ? `#/people/${f.person_id}` : f.vehicle_id ? `#/vehicles/${f.vehicle_id}` : f.business_id ? `#/businesses/${f.business_id}` : null;
  return html`<div class="line finding ${f.severity}"><div class="line-main"><b>${f.title}</b><small>${f.detail}</small></div>
    <div class="btn-row">
      ${open ? html`<a class="btn btn-sm ${f.severity === 'soon' ? 'btn-ghost' : 'btn-primary'}" href="#/requirement/${f.requirement_id}">${f.action === 'upload' ? 'Upload' : f.action === 'renew' ? 'Open' : f.action === 'add_details' ? 'Add details' : 'Check it'}</a>` : ''}
      ${add ? html`<button class="btn btn-sm btn-primary" data-act="finding-add" data-id="${f.id}">Add it</button>` : ''}
      ${!open && !add && subjectHref ? html`<a class="btn btn-sm btn-ghost" href="${subjectHref}">Open ${where(f) || ''}</a>` : ''}
      ${f.severity === 'confirm' && canEdit() ? html`<button class="btn btn-sm btn-ghost" data-act="finding-dismiss" data-id="${f.id}">${DISMISS_LABEL[f.kind] || "It's right"}</button>` : ''}
    </div></div>`;
}

const rerun = async () => { const main = document.getElementById('main'); if (main && location.hash.startsWith('#/check')) await checkPage(main); };
on('check-run', async (ds, btn) => { btn.disabled = true; await rerun(); });
on('plus-upsell', (ds) => openUpsell(ds.what || 'This'));
on('finding-dismiss', async (ds) => {
  const f = await findOne(ds.id);
  if (!f) return;
  openModal(DISMISS_LABEL[f.kind] || "It's right", html`<p><b>${f.title}</b></p><p class="muted small">${f.detail}</p>
    <label class="field"><span>Note for your team <small>(optional)</small></span><input name="note" maxlength="300" placeholder="e.g. Our building has one for all tenants"></label>
    <p class="muted small">We won't ask again unless this record changes.</p>`, {
    submitLabel: 'Save', danger: false,
    onSubmit: async (fd) => { await db.dismissFinding(f.id, String(fd.get('note') || '').trim()); toast('Saved.'); setTimeout(rerun, 30); },
  });
});
on('finding-reopen', async (ds) => { try { await db.reopenFinding(ds.id); await rerun(); } catch (e) { toastError(e); } });
on('finding-add', async (ds, btn) => {
  const f = await findOne(ds.id);
  if (!f) return;
  btn.disabled = true;
  try {
    const subject = f.person_id ? 'person' : f.vehicle_id ? 'vehicle' : 'business';
    const res = await db.addRequirement({ subject, subject_id: f.person_id || f.vehicle_id || f.business_id, location_id: f.location_id || null, type_code: f.type_code });
    await reload();
    toast(`${typeOf(f.type_code)?.name || 'It'} added. Now add its details.`);
    if (res?.requirement_id) location.hash = `#/requirement/${res.requirement_id}`;
    else await rerun();
  } catch (e) { toastError(e); btn.disabled = false; }
});
async function findOne(id) { try { return (await db.findings(S.org.id)).find((x) => x.id === id); } catch (e) { toastError(e); return null; } }

// Reading photos already uploaded, on this device (the same reader as "Fill from a photo"), so the
// check can ask about a date that doesn't match. Only images; one at a time; nothing leaves the device
// except what was found (up to 4 dates and the kind of document).
on('check-read', async (ds, btn) => {
  if (busy) return;
  const out = btn.closest('.read-out');
  let photos;
  try { photos = (await db.unreadPhotos(S.org.id)).filter((d) => S.data.reqs.some((r) => r.cycle_id === d.cycle_id)); } catch (e) { return toastError(e); }
  if (!photos.length) { out.innerHTML = String(html`<p class="muted">${ICON.check} Every current photo has been read.</p>`); return; }
  busy = true;
  out.innerHTML = String(html`<p class="small"><b>Reading ${plural(photos.length, 'photo')}…</b> Keep this page open. The reader loads the first time (about 7 MB).</p>
    <div class="scan-progress"><span style="width:0%"></span></div><small class="read-msg"></small>`);
  const bar = out.querySelector('.scan-progress span');
  const msg = out.querySelector('.read-msg');
  let done = 0;
  let found = 0;
  try {
    const [{ readPhoto }, { readDocument }] = await Promise.all([import('../ocr.js'), import('../ocrparse.js')]);
    for (const d of photos) {
      msg.textContent = `${done + 1} of ${photos.length}: ${d.file_name}`;
      try {
        const blob = await db.fileBlob(d.storage_path);
        const file = new File([blob], d.file_name, { type: d.mime_type || blob.type || 'image/jpeg' });
        const text = await readPhoto(file, (p) => { bar.style.width = `${Math.round(((done + p) / photos.length) * 100)}%`; });
        const r = readDocument(text, todayPH());
        await db.saveDocumentReading(d.id, { expires: r.expires.map((x) => x.value).slice(0, 4), kind: r.kind, chars: r.chars });
        if (r.expires.length) found++;
      } catch { await db.saveDocumentReading(d.id, { expires: [], chars: 0 }).catch(() => {}); }
      done++;
      bar.style.width = `${Math.round((done / photos.length) * 100)}%`;
    }
    toast(`Read ${plural(done, 'photo')}${found ? `; dates found on ${found}` : ''}.`);
  } catch (e) { toastError(e); }
  busy = false;
  await rerun();
});
