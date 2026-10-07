// Bring in a whole fleet from a spreadsheet (CSV saved from Excel or Google Sheets).
// Every row is checked and shown before anything is saved, so nothing gets in by accident.
import { html, fmtDate, toast, openModal, download, toCsv, when, plural } from '../util.js';
import { S, on, reload, VEHICLE_TYPES } from '../core.js';
import * as db from 'pp/data';
import { parseCsv, parseDate } from '../csv.js';

const COLS = [
  ['make_model', 'Make and model', 'Toyota Hilux'],
  ['plate_no', 'Plate number', 'NBC 4417'],
  ['vehicle_type', 'Type', 'Pickup'],
  ['cr_no', 'CR number', ''],
  ['or_no', 'OR number', 'OR-5521'],
  ['registration_expires', 'Registration expires', '2027-03-10'],
  ['ctpl_provider', 'CTPL provider', 'Malayan Insurance'],
  ['ctpl_policy_no', 'CTPL policy number', ''],
  ['ctpl_expires', 'CTPL expires', '2027-03-10'],
];
const MAX_ROWS = 500;

const norm = (h) => h.toLowerCase().replace(/[^a-z]/g, '');
// Matches a header to a column even if it's worded a little differently.
const ALIASES = {
  make_model: ['makeandmodel', 'makemodel', 'vehicle', 'model', 'make', 'unit'],
  plate_no: ['platenumber', 'plateno', 'plate', 'platenum'],
  vehicle_type: ['type', 'vehicletype', 'kind'],
  cr_no: ['crnumber', 'crno', 'cr'],
  or_no: ['ornumber', 'orno', 'or'],
  registration_expires: ['registrationexpires', 'registrationexpiry', 'registrationexpiration', 'regexpiry', 'ltoexpiry', 'registrationvaliduntil', 'registration'],
  ctpl_provider: ['ctplprovider', 'insurer', 'insuranceprovider', 'insurancecompany'],
  ctpl_policy_no: ['ctplpolicynumber', 'policynumber', 'policyno', 'cocnumber', 'coc'],
  ctpl_expires: ['ctplexpires', 'ctplexpiry', 'ctplexpiration', 'insuranceexpiry', 'ctpl'],
};

export function checkRows(rows) {
  if (!rows.length) return { error: 'The file is empty.' };
  const header = rows[0].map(norm);
  const idx = {};
  for (const [k] of COLS) {
    const i = header.findIndex((h) => ALIASES[k].includes(h));
    if (i >= 0) idx[k] = i;
  }
  if (idx.make_model == null) return { error: 'We could not find a "Make and model" column. Start from our template.' };
  const body = rows.slice(1);
  if (body.length > MAX_ROWS) return { error: `That's ${body.length} rows. Import up to ${MAX_ROWS} at a time.` };
  const known = new Set(S.data.vehicles.map((v) => (v.plate_no || '').replace(/\s/g, '').toUpperCase()).filter(Boolean));
  const seen = new Set();
  const out = body.map((r, n) => {
    const get = (k) => (idx[k] == null ? '' : String(r[idx[k]] ?? '').trim());
    const f = { make_model: get('make_model').slice(0, 120), plate_no: get('plate_no').toUpperCase().slice(0, 20), cr_no: get('cr_no').slice(0, 40),
      or_no: get('or_no').slice(0, 100), ctpl_provider: get('ctpl_provider').slice(0, 120), ctpl_policy_no: get('ctpl_policy_no').slice(0, 100) };
    const problems = [];
    if (!f.make_model) problems.push('Make and model is missing');
    const t = get('vehicle_type');
    const SYN = { car: 'Sedan', hatchback: 'Sedan', auv: 'SUV', jeep: 'SUV', mpv: 'Van', minivan: 'Van', 'pick-up': 'Pickup', 'pick up': 'Pickup',
      scooter: 'Motorcycle', motorbike: 'Motorcycle', motor: 'Motorcycle', trike: 'Tricycle', 'l300': 'Van', lorry: 'Truck', 'wing van': 'Truck' };
    f.vehicle_type = VEHICLE_TYPES.find((x) => x.toLowerCase() === t.toLowerCase()) || SYN[t.toLowerCase()] || (t ? null : 'Other');
    if (!f.vehicle_type) { problems.push(`Type "${t}" isn't one of: ${VEHICLE_TYPES.join(', ')}`); }
    for (const k of ['registration_expires', 'ctpl_expires']) {
      const d = parseDate(get(k));
      if (d.error) problems.push(d.error); else f[k] = d.value;
    }
    const key = f.plate_no.replace(/\s/g, '');
    if (key && known.has(key)) problems.push('Already in PermitPal');
    else if (key && seen.has(key)) problems.push('Same plate appears twice in the file');
    if (key) seen.add(key);
    return { line: n + 2, f, problems };
  });
  return { rows: out, missing: COLS.filter(([k]) => idx[k] == null).map(([, l]) => l) };
}

on('veh-import', () => {
  let checked = null;
  openModal('Import vehicles from a spreadsheet', html`
    <ol class="import-steps">
      <li><b>Get the template</b> <button type="button" class="btn btn-sm btn-soft" id="imp-template">Download template</button>
        <span class="muted small">Open it in Excel or Google Sheets. One vehicle per row. Dates like 2027-03-10.</span></li>
      <li><b>Save it as CSV</b> <span class="muted small">Excel: File → Save As → CSV. Google Sheets: File → Download → CSV.</span></li>
      <li><b>Choose the file</b> <input type="file" id="imp-file" accept=".csv,text/csv"></li>
    </ol>
    <div id="imp-preview"></div>`, {
    wide: true, submitLabel: 'Import',
    onOpen: (form) => {
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      form.querySelector('#imp-template').addEventListener('click', () =>
        download('permitpal-vehicles-template.csv', toCsv([COLS.map((c) => c[1]), COLS.map((c) => c[2])])));
      form.querySelector('#imp-file').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        const box = form.querySelector('#imp-preview');
        checked = null; btn.disabled = true;
        if (!file) { box.innerHTML = ''; return; }
        if (file.size > 2 * 1024 * 1024) { box.innerHTML = String(html`<p class="form-error">That file is too big. Keep it under 2 MB.</p>`); return; }
        const res = checkRows(parseCsv(await file.text()));
        if (res.error) { box.innerHTML = String(html`<p class="form-error">${res.error}</p>`); return; }
        checked = res;
        const good = res.rows.filter((r) => !r.problems.length);
        btn.disabled = !good.length;
        btn.textContent = good.length ? `Import ${plural(good.length, 'vehicle')}` : 'Import';
        box.innerHTML = String(html`
          <p class="import-sum"><b>${plural(good.length, 'vehicle')} ready.</b> ${when(res.rows.length - good.length, html`<span class="due overdue">${res.rows.length - good.length} will be skipped; fix them and import again.</span>`)}
            ${when(res.missing.length, html`<br><span class="muted small">Not in your file (fine to leave out): ${res.missing.join(', ')}.</span>`)}</p>
          <p class="muted small">Check the dates below read the way you meant before importing.</p>
          <div class="table-wrap"><table class="table"><thead><tr><th>Row</th><th>Vehicle</th><th>Plate</th><th>Registration expires</th><th>CTPL expires</th><th></th></tr></thead><tbody>
          ${res.rows.map((r) => html`<tr class="${r.problems.length ? 'imp-bad' : ''}"><td>${r.line}</td><td>${r.f.make_model || '—'}</td><td>${r.f.plate_no || '—'}</td>
            <td>${r.f.registration_expires ? fmtDate(r.f.registration_expires) : '—'}</td><td>${r.f.ctpl_expires ? fmtDate(r.f.ctpl_expires) : '—'}</td>
            <td>${r.problems.length ? html`<span class="due overdue">${r.problems.join('. ')}</span>` : html`<span class="due ok">OK</span>`}</td></tr>`)}
          </tbody></table></div>`);
      });
    },
    onSubmit: async (fd, form) => {
      const good = checked?.rows.filter((r) => !r.problems.length) || [];
      if (!good.length) throw new Error('Choose a file with at least one good row.');
      const btn = form.querySelector('button[type=submit]');
      const failed = [];
      for (let i = 0; i < good.length; i++) {
        btn.textContent = `Importing ${i + 1} of ${good.length}…`;
        try { await db.createVehicle(S.org.id, good[i].f); } catch (e) { failed.push(`Row ${good[i].line}: ${e.message}`); }
      }
      await reload();
      if (failed.length) {
        form.querySelector('#imp-preview').innerHTML = String(html`<p class="form-error">${good.length - failed.length} imported. These didn't go in:</p><ul class="small">${failed.map((x) => html`<li>${x}</li>`)}</ul>`);
        btn.textContent = 'Done'; btn.disabled = true;
        return false;
      }
      toast(`${plural(good.length, 'vehicle')} imported. Check each card for anything still missing.`);
    },
  });
});
