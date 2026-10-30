// Bring in businesses, branches, vehicles, staff or permit records from a spreadsheet (Excel .xlsx or
// CSV from Excel or Google Sheets). Every row is checked and shown before anything is saved: what will
// go in, what will be skipped and why, and any guesses we made, so nothing gets in by accident.
import { html, fmtDate, toast, openModal, download, toCsv, when, plural, todayPH } from '../util.js?v=fd3a394';
import { S, on, reload, has, peopleCap } from '../core.js?v=fd3a394';
import * as db from 'pp/data';
import { parseCsv } from '../csv.js?v=fd3a394';
import { openWorkbook, canReadExcel } from '../xlsx.js?v=fd3a394';
import { KINDS, checkImport, templateRows } from '../importer.js?v=fd3a394';

const ctx = () => ({ businesses: S.data.businesses, locations: S.data.locations, vehicles: S.data.vehicles, people: S.data.people || [],
  reqs: S.data.reqs, types: S.data.types, today: todayPH() });

// How each kind is saved, one row at a time, using the same steps as adding by hand.
const SAVE = {
  async businesses(f) {
    const id = await db.createBusiness(S.org.id, f);
    if (f.tin) await db.updateBusiness(id, { tin: f.tin });
  },
  branches: (f) => db.addLocation(f.business_id, f),
  vehicles: (f) => db.createVehicle(S.org.id, f),
  async staff(f) {
    const id = await db.createPerson(S.org.id, { full_name: f.full_name, role_title: f.role_title, business_id: f.business_id || null, types: [] });
    for (const l of f.licences) await db.addRequirement({ subject: 'person', subject_id: id, type_code: l.type_code, reference_no: l.reference_no, expires_on: l.expires_on });
  },
  async permits(f) {
    if (f.action === 'add') {
      return db.addRequirement({ subject: f.subject, subject_id: f.subject_id, location_id: f.location_id || null, type_code: f.type_code || null,
        name: f.type_code ? null : f.name, expires: f.type_code ? null : f.expires, reference_no: f.reference_no, issued_on: f.issued_on, expires_on: f.expires_on });
    }
    if (f.action === 'update') {
      return db.saveCycle({ cycleId: f.cycle_id, orgId: S.org.id, requirementId: f.requirement_id, reference_no: f.reference_no, ...f.keep });
    }
    return db.saveCycle({ cycleId: null, orgId: S.org.id, requirementId: f.requirement_id, reference_no: f.reference_no, issued_on: f.issued_on, expires_on: f.expires_on });
  },
};
const FILE_NAMES = { businesses: 'businesses', branches: 'branches', vehicles: 'vehicles', staff: 'staff', permits: 'permit-records' };

export function openImport(kind = 'vehicles') {
  let rows = null;      // raw rows from the file
  let checked = null;   // result of checkImport
  let book = null;      // the open Excel workbook, if any
  let dayFirst = false;
  openModal('Import from a spreadsheet', html`
    <label class="field"><span>What are you importing?</span><select name="kind" id="imp-kind">
      ${Object.entries(KINDS).map(([k, K]) => html`<option value="${k}" ${k === kind ? 'selected' : ''}>${K.label}</option>`)}</select>
      <small class="muted" id="imp-unit">${KINDS[kind].unit}</small></label>
    <ol class="import-steps">
      <li><b>Get the template</b> <button type="button" class="btn btn-sm btn-soft" id="imp-template">Download template</button>
        <span class="muted small">Open it in Excel or Google Sheets and fill in one row each. Your own sheet works too if its headings are similar.</span></li>
      <li><b>Choose the file</b> <input type="file" id="imp-file" aria-label="Spreadsheet file (Excel or CSV)" accept=".xlsx,.csv,.txt,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
        <span class="muted small">Excel (.xlsx) or CSV.${canReadExcel() ? '' : ' This browser can only read CSV: in Excel use File → Save As → CSV.'}</span></li>
    </ol>
    ${S.features?.revenue && (S.data.services || []).some((x) => x.code === 'setup_from_paper') ? html`<p class="muted small">Rather not do this yourself? <button type="button" class="linklike" data-act="svc-request" data-code="setup_from_paper">Have Pinoy Permit set it up for you</button>.</p>` : ''}
    <div id="imp-sheet"></div>
    <div id="imp-dates"></div>
    <div id="imp-preview"></div>`, {
    wide: true, submitLabel: 'Import',
    onOpen: (form) => {
      const btn = form.querySelector('button[type=submit]');
      const box = form.querySelector('#imp-preview');
      const kindSel = form.querySelector('#imp-kind');
      const cur = () => kindSel.value;
      btn.disabled = true;
      const showError = (msg) => { checked = null; btn.disabled = true; btn.textContent = 'Import'; box.innerHTML = String(html`<p class="form-error" role="alert">${msg}</p>`); };

      const render = () => {
        if (!rows) { box.innerHTML = ''; btn.disabled = true; btn.textContent = 'Import'; form.querySelector('#imp-dates').innerHTML = ''; return; }
        const K = KINDS[cur()];
        const res = checkImport(cur(), rows, ctx(), { dayFirst });
        if (res.error) return showError(res.error);
        checked = res;
        // Dates like 03/04/2027 can be read two ways: say how we read them, and let them flip it.
        form.querySelector('#imp-dates').innerHTML = res.ambiguous ? String(html`<fieldset class="banner warn date-choice"><legend><b>Your file has dates like 03/04/2027.</b> Which does it mean?</legend>
          <label class="check"><input type="radio" name="dayfirst" value="0" ${dayFirst ? '' : 'checked'}><span>Month first: 03/04/2027 is <b>March 4</b></span></label>
          <label class="check"><input type="radio" name="dayfirst" value="1" ${dayFirst ? 'checked' : ''}><span>Day first: 03/04/2027 is <b>3 April</b></span></label></fieldset>`) : '';
        const good = res.rows.filter((r) => !r.problems.length && r.f.action !== 'skip');
        const same = res.rows.filter((r) => !r.problems.length && r.f.action === 'skip');
        const bad = res.rows.filter((r) => r.problems.length);
        const noted = good.filter((r) => r.notes.length);
        btn.disabled = !good.length;
        btn.textContent = good.length ? `Import ${plural(good.length, K.one, K.many)}` : 'Import';
        const cell = (v, i) => ((K.dates || []).includes(i) ? (v ? fmtDate(v) : '—') : v);
        box.innerHTML = String(html`
          <p class="import-sum" role="status"><b>${plural(good.length, K.one, K.many)} ready.</b>
            ${when(bad.length, html` <span class="due overdue">${bad.length} will be skipped; fix ${bad.length === 1 ? 'it' : 'them'} in your file and import again (rows already in are skipped automatically).</span>`)}
            ${when(same.length, html` <span class="muted">${same.length} already up to date.</span>`)}
            ${when(noted.length, html` <span class="due soon">${plural(noted.length, 'row')} with a note: read ${noted.length === 1 ? 'it' : 'them'} before importing.</span>`)}
            ${when(res.missing.length, html`<br><span class="muted small">Not in your file (fine to leave out): ${res.missing.join(', ')}.</span>`)}</p>
          ${when(cur() === 'staff' && has('plus') && good.length > peopleCap() - (S.data.people || []).length, html`<p class="banner warn"><span>Your plan covers ${peopleCap()} people and you track ${(S.data.people || []).length}, so only the first ${Math.max(0, peopleCap() - (S.data.people || []).length)} of these will go in.
            <a href="#/settings/billing?staff=1">Add staff licenses</a> first to bring everyone in.</span></p>`)}
          ${when(K.dates, html`<p class="muted small">Check the dates below read the way you meant before importing.</p>`)}
          <div class="table-wrap"><table class="table import-table"><thead><tr><th>Row</th>${K.head.map((h) => html`<th>${h}</th>`)}<th>Result</th></tr></thead><tbody>
          ${res.rows.map((r) => html`<tr class="${r.problems.length ? 'imp-bad' : r.f.action === 'skip' ? 'imp-same' : r.notes.length ? 'imp-note' : ''}"><td>${r.line}</td>
            ${r.show.map((v, i) => html`<td>${cell(v, i)}</td>`)}
            <td>${r.problems.length ? html`<span class="due overdue">${r.problems.join('. ')}</span>`
              : html`<span class="due ${r.f.action === 'skip' ? 'needinfo' : 'ok'}">${r.f.action === 'skip' ? 'Skip' : 'OK'}</span>${r.notes.length ? html`<small class="imp-notes">${r.notes.join(' ')}</small>` : ''}`}</td></tr>`)}
          </tbody></table></div>`);
      };

      const loadSheet = async (i) => {
        try { rows = await book.read(i); render(); } catch (e) { rows = null; showError(e.message); }
      };
      kindSel.addEventListener('change', () => { form.querySelector('#imp-unit').textContent = KINDS[cur()].unit; render(); });
      form.addEventListener('change', (e) => {
        if (e.target.name === 'dayfirst') { dayFirst = e.target.value === '1'; render(); }
        if (e.target.id === 'imp-sheet-pick') loadSheet(Number(e.target.value));
      });
      form.querySelector('#imp-template').addEventListener('click', () =>
        download(`pinoypermit-${FILE_NAMES[cur()]}-template.csv`, toCsv(templateRows(cur(), S.data.types))));
      form.querySelector('#imp-file').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        rows = null; book = null; checked = null; dayFirst = false;
        form.querySelector('#imp-sheet').innerHTML = '';
        if (!file) return render();
        if (file.size > 5 * 1024 * 1024) return showError('That file is too big. Keep it under 5 MB (split it into smaller files).');
        const name = file.name.toLowerCase();
        box.innerHTML = String(html`<p class="muted">Reading ${file.name}…</p>`);
        try {
          if (name.endsWith('.xls')) return showError('That is an old Excel file (.xls). Open it in Excel and save it as .xlsx or CSV, then choose it again.');
          if (name.endsWith('.xlsx') || file.type.includes('spreadsheetml')) {
            book = await openWorkbook(file);
            // Start on the first sheet that has the right columns (a notes or cover sheet often comes first).
            let start = 0;
            for (let i = 0; i < Math.min(book.sheets.length, 10); i++) {
              const res = checkImport(cur(), await book.read(i), ctx());
              if (!res.error || !/couldn't find/.test(res.error)) { start = i; break; }
            }
            if (book.sheets.length > 1) {
              form.querySelector('#imp-sheet').innerHTML = String(html`<label class="field"><span>Which sheet?</span><select id="imp-sheet-pick">
                ${book.sheets.map((s, i) => html`<option value="${i}" ${i === start ? 'selected' : ''}>${s}</option>`)}</select></label>`);
            }
            return loadSheet(start);
          }
          const text = await file.text();
          if (/^PK/.test(text)) return showError('This looks like an Excel file with the wrong name. Rename it to end in .xlsx, or save it as CSV.');
          rows = parseCsv(text);
          render();
        } catch (err) { showError(err.message || 'We could not read that file.'); }
      });
    },
    onSubmit: async (fd, form) => {
      const kindNow = form.querySelector('#imp-kind').value;
      const K = KINDS[kindNow];
      const good = checked?.rows.filter((r) => !r.problems.length && r.f.action !== 'skip') || [];
      if (!good.length) throw new Error('Choose a file with at least one row that is ready.');
      const btn = form.querySelector('button[type=submit]');
      form.querySelectorAll('input, select').forEach((x) => { x.disabled = true; }); // no changes halfway through
      const failed = [];
      for (let i = 0; i < good.length; i++) {
        btn.textContent = `Importing ${i + 1} of ${good.length}…`;
        try { await SAVE[kindNow](good[i].f); } catch (e) { failed.push(`Row ${good[i].line}: ${e.message}`); }
      }
      await reload();
      if (failed.length) {
        form.querySelector('#imp-preview').innerHTML = String(html`<p class="form-error" role="alert">${plural(good.length - failed.length, K.one, K.many)} imported. These didn't go in:</p>
          <ul class="small">${failed.map((x) => html`<li>${x}</li>`)}</ul><p class="muted small">Fix those rows and import the file again: rows already in Pinoy Permit are skipped.</p>`);
        btn.textContent = 'Done'; btn.disabled = true;
        return false;
      }
      toast(`${plural(good.length, K.one, K.many)} imported.${kindNow === 'businesses' || kindNow === 'vehicles' ? ' Each one has its permit list; check them for anything still missing.' : ''}`);
    },
  });
}
on('veh-import', () => openImport('vehicles'));
on('imp-open', (ds) => openImport(ds.kind || 'vehicles'));
