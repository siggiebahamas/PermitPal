// Dashboard, Compliance (filterable list) and Document vault.
import { html, raw, fmtDate, fileSize, plural, toCsv, download, todayPH, toastError } from '../util.js';
import { S, on, canEdit, empty } from '../core.js';
import { STATUS, reqRow, statTiles, counts, byPriority, subjectLabel, dueText, ICON } from '../components.js';
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

  el.innerHTML = String(html`
    ${yearStrip(reqs, first, c)}
    ${statTiles(c)}
    <section class="card next">
      <div class="card-head"><h2>Next actions</h2><a class="link" href="#/compliance">See all</a></div>
      ${open.length ? open.slice(0, 8).map((r) => reqRow(r)) : html`<div class="all-good">${ICON.check} Everything is compliant. Nice work.</div>`}
    </section>
  `);
}

// ---------------------------------------------------------------- year-at-a-glance strip
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SHORT = { mayors_permit: "Mayor's", barangay_clearance: 'Barangay', bir_cor: 'BIR', fsic: 'FSIC', sanitary_permit: 'Sanitary', dti_business_name: 'DTI',
  sec_registration: 'SEC', cda_registration: 'CDA', ecc: 'ECC', pcab_license: 'PCAB', doh_lto: 'DOH', school_permit: 'School', lto_registration: 'LTO',
  ctpl: 'CTPL', emission_test: 'Emission', mvir: 'MVIR' };
// Colour family of a pin: business permits, vehicle registration, or insurance & others.
const family = (r) => (r.subject === 'business' ? 'biz' : /ctpl|insur/i.test(r.type_code || r.name) ? 'ins' : 'veh');
const shortName = (r) => SHORT[r.type_code] || r.name.split(/[\s(/]/)[0];
const shortSubject = (r) => (r.subject === 'vehicle' ? r.subject_name.split(' ').slice(0, 2).join(' ')
  : (r.location_id && !r.location_is_main ? r.location_name : r.subject_name).split(/\s+/)[0]);

function pins(list) {
  // Three or more of the same permit in one month collapse into one "Mayor's ×3" pin.
  const byName = new Map();
  for (const r of list) { const k = family(r) + shortName(r); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(r); }
  const out = [];
  for (const group of byName.values()) {
    if (group.length >= 3) out.push(html`<a class="pin ${family(group[0])}" href="#/compliance" title="${group.map((r) => r.name + ' · ' + subjectLabel(r)).join('\n')}">${shortName(group[0])} ×${group.length}</a>`);
    else group.forEach((r) => out.push(html`<a class="pin ${family(r)}" href="#/requirement/${r.id}" title="${r.name} · ${subjectLabel(r)}">${shortName(r)} · ${shortSubject(r)}</a>`));
  }
  return out;
}

function yearStrip(reqs, first, c) {
  const today = todayPH();
  const [ty, tm] = today.split('-').map(Number);
  const dated = reqs.filter((r) => r.expires && r.expires_on);
  const overdue = dated.filter((r) => r.expires_on < today);
  const cols = [];
  for (let i = 0; i < 12; i++) {
    const m = ((tm - 1 + i) % 12) + 1, y = ty + Math.floor((tm - 1 + i) / 12);
    const key = `${y}-${String(m).padStart(2, '0')}`;
    const items = dated.filter((r) => r.expires_on >= today && r.expires_on.slice(0, 7) === key);
    cols.push({ label: MONTHS[m - 1], year: m === 1 && i > 0 ? y : null, items, now: i === 0 });
  }
  const busiest = cols.slice(1).reduce((b, x) => (x.items.length > (b?.items.length || 0) ? x : b), null);
  const note = overdue.length ? html`<span class="strip-note overdue">${plural(overdue.length, 'permit')} already overdue — renew these first</span>`
    : busiest && busiest.items.length >= 3 ? html`<span class="strip-note">${busiest.label}: ${busiest.items.length} renewals — start early</span>` : '';
  return html`
    <section class="year">
      <div class="year-head">
        <div><h1>Your compliance year, ${first}</h1>
          <p class="year-sub">${S.org.name} · ${plural(S.data.businesses.length, 'business', 'businesses')} · ${plural(S.data.vehicles.length, 'vehicle')} · ${plural(c.total, 'permit')} tracked</p></div>
        ${c.health === null ? '' : html`<a class="score" href="#/compliance?status=compliant" title="${c.compliant} of ${c.total} compliant">${ring(c.health)}<span><b>${c.health}%</b><small>compliant</small></span></a>`}
      </div>
      <div class="months">
        ${overdue.length ? html`<div class="mo late"><small>Overdue</small>${pins(overdue)}</div>` : ''}
        ${cols.map((x) => html`<div class="mo ${x.now ? 'now' : ''} ${x.items.length ? '' : 'none'}"><small>${x.label}${x.year ? html` <i>${x.year}</i>` : ''}</small>${pins(x.items)}</div>`)}
      </div>
      <div class="legend"><span><i class="biz"></i>Business permits</span><span><i class="veh"></i>Vehicle registration</span><span><i class="ins"></i>Insurance & others</span>${note}</div>
    </section>`;
}

function ring(pct) {
  const r = 26, len = 2 * Math.PI * r;
  return raw(`<svg class="ring" viewBox="0 0 64 64"><circle cx="32" cy="32" r="${r}" class="ring-track"/><circle cx="32" cy="32" r="${r}" class="ring-fill" stroke-dasharray="${(len * pct) / 100} ${len}" transform="rotate(-90 32 32)"/></svg>`);
}

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
    <p class="muted small">${plural(list.length, 'requirement')} · as of ${fmtDate(today)} (Philippine time)</p>
    <div class="list">${list.length ? list.map((r) => reqRow(r)) : empty('Nothing matches', 'Try clearing a filter.')}</div>`);

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

