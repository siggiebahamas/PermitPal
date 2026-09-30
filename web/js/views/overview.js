// Dashboard, Compliance (filterable list) and Document vault.
import { html, fmtDate, fileSize, plural, toCsv, download, todayPH, toastError } from '../util.js';
import { S, on, hooks, canEdit, empty } from '../core.js';
import { STATUS, NEXT_ACTION, reqRow, statTiles, counts, byPriority, subjectLabel, dueText, dueShort, dateTile, ICON } from '../components.js';
import * as db from 'pp/data';

// ---------------------------------------------------------------- dashboard
export function dashboard(el) {
  const { reqs, businesses, vehicles } = S.data;
  const first = S.profile.first_name || 'there';
  if (!businesses.length && !vehicles.length) {
    el.innerHTML = String(html`
      <div class="page-head"><div><h1>Welcome, ${first}.</h1><p class="muted">Let's set up what you need to keep compliant.</p></div></div>
      <div class="onboard">
        <a class="onboard-card" href="#/businesses?add=1">${ICON.building}<b>Add a business</b><span>We'll build its permit checklist for you: Mayor's Permit, Barangay Clearance, BIR, FSIC and more, based on what it does.</span></a>
        <a class="onboard-card" href="#/vehicles?add=1">${ICON.car}<b>Add a vehicle</b><span>Track LTO registration, CTPL, emission and inspection. We'll work out the renewal month from the plate.</span></a>
      </div>`);
    return;
  }
  const c = counts(reqs);
  const open = reqs.filter((r) => r.status !== 'compliant').sort(byPriority);
  if (skip >= open.length) skip = 0;

  el.innerHTML = String(html`
    ${brief(first, c, open)}
    ${statTiles(c)}
    <section class="card next">
      <div class="card-head"><div><h2>Next actions</h2><p class="card-sub">Most urgent first</p></div><a class="link" href="#/compliance">See all</a></div>
      ${open.length ? open.slice(0, 8).map((r) => reqRow(r)) : html`<div class="all-good">${ICON.check} Everything is compliant. Nice work.</div>`}
      ${when_(open.length, html`<div class="sheet-foot">${plural(open.length, 'open item')} across your businesses and vehicles</div>`)}
    </section>
  `);
}
const when_ = (c, v) => (c ? v : '');

// ---------------------------------------------------------------- daily brief
// Greeting and a one-line summary on the left; "Do this first" on the right, with one button to press.
let skip = 0;
function greeting() {
  const h = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', hour12: false })) % 24;
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}
function brief(first, c, open) {
  const today = new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Manila', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const parts = [];
  if (c.action_required) parts.push(html`<b class="due overdue">${plural(c.action_required, 'overdue permit')}</b>`);
  if (c.renew_soon) parts.push(html`<b class="due soon">${c.renew_soon} due within 30 days</b>`);
  if (c.needs_information) parts.push(html`<b class="due needinfo">${plural(c.needs_information, 'permit')} missing details</b>`);
  const say = !open.length ? html`Everything is compliant. Nothing needs you today.`
    : html`You have ${parts.map((x, i) => html`${i ? (i === parts.length - 1 ? ' and ' : ', ') : ''}${x}`)}.${open.length > 1 ? ' Start with the one under “Do this first”.' : ''}`;
  const r = open[skip];
  const t = r && S.data.types.find((x) => x.code === r.type_code);
  const hint = !r ? '' : r.status === 'action_required' ? 'It is past its expiry date. Late renewals usually pay a surcharge, so renew it as soon as you can.'
    : r.status === 'renew_soon' ? 'Renew before the due date to avoid penalties and long queues.'
    : r.status === 'in_progress' ? 'A renewal is under way. Record the new permit once you have it.'
    : 'Add the missing details or document so PermitPal can remind you on time.';
  return html`
    <section class="brief card">
      <div class="brief-hello">
        <div class="brief-date">${today}</div>
        <h1>${greeting()}, ${first}.</h1>
        <p class="brief-say">${say}</p>
        <p class="brief-note">${c.compliant} of ${c.total} permits compliant${open.length ? html` · <a href="#/compliance">see all ${plural(open.length, 'open item')}</a>` : ''}</p>
      </div>
      <div class="brief-focus">
        ${r ? html`
          <div class="brief-date">Do this first</div>
          <a class="focus-item" href="#/requirement/${r.id}">${dateTile(r)}
            <div><div class="focus-name">${r.name}</div><div class="focus-who">${subjectLabel(r)}</div><b class="due ${STATUS[r.status].cls}">${dueShort(r)}</b></div></a>
          <p class="focus-hint">${t?.help_text ? t.help_text + ' ' : ''}${hint}</p>
          <div class="btn-row">
            ${canEdit() && r.next_action ? html`<button class="btn ${r.next_action === 'renew' ? 'btn-primary' : 'btn-soft'} focus-go" data-act="req-next" data-id="${r.id}">${NEXT_ACTION[r.next_action]}</button>`
              : html`<a class="btn btn-primary focus-go" href="#/requirement/${r.id}">Open it</a>`}
            ${when_(open.length > 1, html`<button class="btn btn-ghost" data-act="brief-skip">Skip for now</button>`)}
          </div>` : html`<div class="brief-date">Do this first</div><div class="all-good">${ICON.check} Nothing to do. You're all caught up.</div>`}
      </div>
    </section>`;
}
on('brief-skip', () => { skip++; hooks.render(); });

// ---------------------------------------------------------------- compliance
const filters = { status: 'all', subject: 'all', entity: 'all', city: 'all', type: 'all', due: 'all', q: '' };

export function compliance(el, params) {
  if (params.get('status')) filters.status = params.get('status');
  const { reqs, businesses, vehicles, locations } = S.data;
  const cities = [...new Set(locations.map((l) => l.city).filter(Boolean))].sort();
  const types = [...new Set(reqs.map((r) => r.name))].sort();
  const today = todayPH();

  const list = reqs.filter((r) => {
    if (filters.status !== 'all' && r.status !== filters.status) return false;
    if (filters.subject !== 'all' && r.subject !== filters.subject) return false;
    if (filters.entity !== 'all' && `${r.subject}:${r.business_id || r.vehicle_id}` !== filters.entity) return false;
    if (filters.city !== 'all' && r.location_city !== filters.city) return false;
    if (filters.type !== 'all' && r.name !== filters.type) return false;
    if (filters.due === 'overdue' && !r.is_overdue) return false;
    if (filters.due === '30' && !(r.expires_on && r.days_left >= 0 && r.days_left <= 30)) return false;
    if (filters.due === '90' && !(r.expires_on && r.days_left >= 0 && r.days_left <= 90)) return false;
    if (filters.due === 'none' && (r.expires_on || !r.expires)) return false;
    if (filters.q) {
      const hay = `${r.name} ${subjectLabel(r)} ${r.reference_no || ''} ${r.location_city || ''}`.toLowerCase();
      if (!hay.includes(filters.q.toLowerCase())) return false;
    }
    return true;
  }).sort(byPriority);

  const opt = (v, label, cur) => html`<option value="${v}" ${v === cur ? 'selected' : ''}>${label}</option>`;
  el.innerHTML = String(html`
    <div class="page-head"><div><h1>Compliance</h1><p class="muted">Every permit and registration across your businesses and vehicles.</p></div>
      <button class="btn btn-ghost" data-act="export-csv">Export CSV</button></div>
    <div class="filters" id="filters">
      <input type="search" name="q" placeholder="Search name, reference no., city…" value="${filters.q}">
      <select name="status">${opt('all', 'All statuses', filters.status)}${Object.entries(STATUS).map(([k, s]) => opt(k, s.label, filters.status))}</select>
      <select name="subject">${opt('all', 'Businesses + vehicles', filters.subject)}${opt('business', 'Businesses', filters.subject)}${opt('vehicle', 'Vehicles', filters.subject)}</select>
      <select name="entity">${opt('all', 'All businesses & vehicles', filters.entity)}
        ${businesses.map((b) => opt('business:' + b.id, b.name, filters.entity))}
        ${vehicles.map((v) => opt('vehicle:' + v.id, `${v.make_model}${v.plate_no ? ' · ' + v.plate_no : ''}`, filters.entity))}</select>
      <select name="city">${opt('all', 'All locations', filters.city)}${cities.map((c) => opt(c, c, filters.city))}</select>
      <select name="type">${opt('all', 'All requirement types', filters.type)}${types.map((t) => opt(t, t, filters.type))}</select>
      <select name="due">${opt('all', 'Any due date', filters.due)}${opt('overdue', 'Overdue', filters.due)}${opt('30', 'Next 30 days', filters.due)}${opt('90', 'Next 90 days', filters.due)}${opt('none', 'No expiry date yet', filters.due)}</select>
      <button class="btn btn-ghost btn-sm" data-act="clear-filters">Clear</button>
    </div>
    <section class="card list">
      <div class="card-head"><div><h2>All requirements</h2><p class="card-sub">${plural(list.length, 'requirement')} · as of ${fmtDate(today)} (Philippine time)</p></div></div>
      ${list.length ? Object.keys(STATUS).map((k) => {
        const group = list.filter((r) => r.status === k);
        return group.length ? html`<div class="band ${STATUS[k].cls}"><span>${STATUS[k].label}</span><span>${group.length}</span></div>${group.map((r) => reqRow(r))}` : '';
      }) : empty('Nothing matches', 'Try clearing a filter.')}
    </section>`);

  const f = el.querySelector('#filters');
  f.addEventListener('change', (e) => { if (e.target.name) { filters[e.target.name] = e.target.value; if (e.target.name === 'subject') filters.entity = 'all'; compliance(el, new URLSearchParams()); } });
  let t;
  f.querySelector('[name=q]').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => { filters.q = e.target.value; compliance(el, new URLSearchParams()); el.querySelector('[name=q]').focus(); }, 250);
  });
}
on('clear-filters', () => { Object.assign(filters, { status: 'all', subject: 'all', entity: 'all', city: 'all', type: 'all', due: 'all', q: '' }); location.hash = '#/compliance'; });

// Everything tracked, with each permit's full record history, as a spreadsheet.
on('export-csv', async () => {
  try {
    const cycles = await db.allCycles(S.org.id);
    const rows = [['Business / vehicle', 'Branch', 'City', 'Plate', 'Requirement', 'Status', 'Current reference no.', 'Issued', 'Expires', 'Files on current record', 'All records (reference - expiry)']];
    for (const r of [...S.data.reqs].sort(byPriority)) {
      const hist = cycles.filter((c) => c.requirement_id === r.id).map((c) => `${c.reference_no || '-'} - ${c.expires_on || 'no expiry'}`).join(' | ');
      rows.push([r.subject_name, r.location_name || '', r.location_city || '', r.plate_no || '', r.name, STATUS[r.status].label,
        r.reference_no || '', r.issued_on || '', r.expires ? (r.expires_on || '') : 'Does not expire', r.document_count, hist]);
    }
    download(`permitpal-${S.org.name.replace(/\W+/g, '-').toLowerCase()}-${todayPH()}.csv`, toCsv(rows));
  } catch (e) { toastError(e); }
});

// ---------------------------------------------------------------- document vault
let docsCache = null;
export async function documents(el) {
  el.innerHTML = String(html`<div class="loading">Loading documents…</div>`);
  try { docsCache = await db.orgDocuments(S.org.id); } catch (e) { toastError(e); docsCache = []; }
  if (!location.hash.startsWith('#/documents')) return;
  const { reqs } = S.data;
  const needDoc = reqs;
  const onFile = needDoc.filter((r) => r.document_count > 0).length;
  const current = new Set(reqs.map((r) => r.cycle_id).filter(Boolean));
  const c = counts(reqs);

  const folder = (subject, id, title, icon, href) => {
    const list = reqs.filter((r) => (subject === 'business' ? r.business_id === id : r.vehicle_id === id)).sort(byPriority);
    if (!list.length) return '';
    return html`<details class="folder" open><summary>${icon}<a href="${href}">${title}</a><span class="muted small">${list.filter((r) => r.document_count).length}/${list.length} on file</span></summary>
      ${list.map((r) => {
        const files = docsCache.filter((d) => d.requirement_id === r.id && current.has(d.cycle_id) && d.cycle_id === r.cycle_id);
        const older = docsCache.filter((d) => d.requirement_id === r.id && d.cycle_id !== r.cycle_id).length;
        return html`<div class="doc-row ${STATUS[r.status].cls}">
          <div class="row-main"><a class="row-title" href="#/requirement/${r.id}">${r.name}</a>
            <div class="row-sub">${r.location_id && !r.location_is_main ? r.location_name + ' · ' : ''}${dueText(r)}${older ? ` · ${plural(older, 'older file')}` : ''}</div>
            ${files.map((d) => html`<div class="doc-file">${ICON.file}<button class="linklike" data-act="doc-view" data-path="${d.storage_path}" data-name="${d.file_name}" data-type="${d.mime_type || ''}">${d.file_name}</button><span class="muted small">${fileSize(d.size_bytes)}</span></div>`)}
          </div>
          <div class="row-side">${files.length ? '' : canEdit() ? html`<button class="btn btn-sm btn-soft" data-act="req-upload" data-id="${r.id}">Upload</button>` : html`<span class="muted small">Missing</span>`}</div>
        </div>`;
      })}
    </details>`;
  };

  el.innerHTML = String(html`
    <div class="page-head"><div><h1>Document vault</h1><p class="muted">Proof of compliance for every business and vehicle, with past years kept on file.</p></div></div>
    <div class="stats four">
      <div class="stat ok"><div class="stat-n">${onFile}<small>/${needDoc.length}</small></div><div class="stat-l">On file</div></div>
      <div class="stat needinfo"><div class="stat-n">${needDoc.length - onFile}</div><div class="stat-l">Missing a file</div></div>
      <div class="stat soon"><div class="stat-n">${c.renew_soon}</div><div class="stat-l">Expiring soon</div></div>
      <div class="stat overdue"><div class="stat-n">${c.action_required}</div><div class="stat-l">Expired</div></div>
    </div>
    <p class="muted small">${plural(docsCache.length, 'file')} stored in total, including past permit periods.</p>
    ${S.data.businesses.map((b) => folder('business', b.id, b.name, ICON.building, `#/businesses/${b.id}`))}
    ${S.data.vehicles.map((v) => folder('vehicle', v.id, `${v.make_model}${v.plate_no ? ' · ' + v.plate_no : ''}`, ICON.car, `#/vehicles/${v.id}`))}
    ${!reqs.length ? empty('No documents yet', 'Add a business or vehicle first.') : ''}`);
}

