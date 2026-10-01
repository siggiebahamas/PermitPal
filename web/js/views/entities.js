// Businesses (with branches) and vehicles: lists, detail pages, add/edit/delete.
import { html, openModal, confirmDialog, toast, toastError, formObject, when, plural, timeAgo, fmtDate, fileSize, todayPH } from '../util.js';
import {
  S, on, go, reload, rerender, canEdit, isOrgAdmin, business, vehicle, person, location_, locationsOf, reqsOf, typeOf, memberName,
  empty, ACTIVITIES, STRUCTURES, VEHICLE_TYPES,
} from '../core.js';
import { reqRow, statTiles, counts, byPriority, dueShort, shortName, ICON, STATUS } from '../components.js';
import { plateSchedule, suggestDue } from '../rules.js';
import * as db from 'pp/data';

const tabs = { business: 'requirements', vehicle: 'requirements', person: 'requirements' };
const optionList = (items, cur) => items.map(([v, l]) => html`<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`);

// ================================================================ businesses
export function businessList(el, params) {
  const list = S.data.businesses;
  el.innerHTML = String(html`
    <div class="page-head"><div><h1>Businesses</h1><p class="muted">Every business, branch and the permits each one needs.</p></div>
      ${when(canEdit(), html`<button class="btn btn-primary" data-act="biz-add">+ Add business</button>`)}</div>
    ${list.length ? html`${timeline('business', list)}<h3 class="section-label">Your businesses</h3><div class="cards">${list.map(entityCard('business'))}</div>`
      : empty('No businesses yet', "Add one and we'll build its permit checklist for you.",
        when(canEdit(), html`<button class="btn btn-primary" data-act="biz-add">Add a business</button>`))}`);
  if (params.get('add') && canEdit()) { history.replaceState(null, '', '#/businesses'); addBusiness(); }
}

// One report sheet per business / vehicle: every permit on its own ruled line, status on the right.
const entityCard = (subject) => (x) => {
  const reqs = reqsOf(subject, x.id).sort(byPriority);
  const c = counts(reqs);
  const top = reqs.find((r) => r.status !== 'compliant');
  const href = subject === 'business' ? `#/businesses/${x.id}` : subject === 'person' ? `#/people/${x.id}` : `#/vehicles/${x.id}`;
  const locs = subject === 'business' ? locationsOf(x.id) : [];
  const meta = subject === 'business'
    ? `${ACTIVITIES[x.activity] || 'Business'} · ${plural(locs.length, 'branch', 'branches')}${locs[0]?.city ? ' · ' + locs[0].city : ''}`
    : subject === 'person' ? [x.role_title, x.business_id && business(x.business_id)?.name].filter(Boolean).join(' · ') || 'Staff member'
    : `${x.vehicle_type}${x.cr_no ? ' · CR ' + x.cr_no : ''}`;
  return html`<section class="card entity">
    <a class="card-head entity-head" href="${href}"><div>
      <h2>${subject === 'business' ? x.name : subject === 'person' ? x.full_name : x.make_model}${subject === 'vehicle' && x.plate_no ? html` <span class="plate">${x.plate_no}</span>` : ''}</h2>
      <p class="card-sub">${meta}</p>
      <div class="chips">${['action_required', 'renew_soon', 'in_progress', 'needs_information', 'compliant'].map((k) =>
        c[k] ? html`<span class="chip ${STATUS[k].cls}">${c[k]} ${STATUS[k].label.toLowerCase()}</span>` : '')}</div></div></a>
    ${reqs.map((r) => html`<a class="line" href="#/requirement/${r.id}"><span class="line-main"><b>${r.name}</b>${locs.length > 1 && r.location_id ? html`<small>${location_(r.location_id)?.name}</small>` : ''}</span>
      <b class="due ${STATUS[r.status].cls}">${dueShort(r)}</b></a>`)}
    ${when(canEdit(), html`<button class="line add" data-act="req-add" data-subject="${subject}" data-id="${x.id}"><span class="plus">+</span>Add a ${subject === 'person' ? 'licence' : 'permit'}</button>`)}
    <div class="sheet-foot">${c.compliant} of ${c.total} compliant${top ? html` · Next: <b>${top.name}</b> — <b class="due ${STATUS[top.status].cls}">${dueShort(top)}</b>` : ' · all clear'}</div>
  </section>`;
};

// Month-by-month lanes: one row per business / vehicle, a bubble in the month each permit is due.
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function timeline(subject, list) {
  const today = todayPH();
  const [ty, tm] = today.split('-').map(Number);
  const cols = [{ key: 'late', label: 'Overdue' }];
  for (let i = 0; i < 12; i++) {
    const m = ((tm - 1 + i) % 12) + 1, y = ty + Math.floor((tm - 1 + i) / 12);
    cols.push({ key: `${y}-${String(m).padStart(2, '0')}`, label: MON[m - 1] + (m === 1 && i ? ` '${String(y).slice(2)}` : ''), now: i === 0 });
  }
  const colOf = (r) => (!r.expires || !r.expires_on ? null : r.expires_on < today ? 'late' : r.expires_on.slice(0, 7));
  const pin = (r, multi, extra = '') => html`<a class="tpin ${STATUS[r.status].cls}" href="#/requirement/${r.id}" title="${r.name} · ${dueShort(r)}">${shortName(r)}${extra}${multi && r.location_id ? html`<small>${location_(r.location_id)?.name.split(' ')[0]}</small>` : ''}</a>`;
  const row = (x) => {
    const reqs = reqsOf(subject, x.id).sort(byPriority);
    const multi = subject === 'business' && locationsOf(x.id).length > 1;
    const undated = reqs.filter((r) => colOf(r) === null && r.status !== 'compliant');
    return html`<div class="lrow"><div class="lwho"><a href="${subject === 'business' ? '#/businesses/' : subject === 'person' ? '#/people/' : '#/vehicles/'}${x.id}"><b>${subject === 'business' ? x.name : subject === 'person' ? x.full_name : x.make_model}</b></a>
        <span>${subject === 'business' ? plural(locationsOf(x.id).length, 'branch', 'branches') : subject === 'person' ? x.role_title || 'Staff' : [x.plate_no, x.vehicle_type].filter(Boolean).join(' · ')}</span>
        ${when(undated.length, html`<div class="lundated">${undated.map((r) => pin(r, multi, ' · no date'))}</div>`)}</div>
      ${cols.map((col) => html`<div class="lcell ${col.now ? 'now' : ''}">${reqs.filter((r) => colOf(r) === col.key).map((r) => pin(r, multi))}</div>`)}</div>`;
  };
  return html`<section class="card lanes-card">
    <div class="card-head"><div><h2>${subject === 'business' ? 'Business permits' : subject === 'person' ? 'Staff licences' : 'Vehicle renewals'} · month by month</h2>
      <p class="card-sub">Every permit in the month it's due. Tap one to open it${cols.length > 7 ? ' · scroll sideways for later months' : ''}.</p></div>
      <div class="chips">${Object.values(STATUS).map((st) => html`<span class="chip ${st.cls}">${st.label}</span>`)}</div></div>
    <div class="lanes-wrap"><div class="lanes">
      <div class="lrow lhead"><div class="lwho"></div>${cols.map((col) => html`<div class="${col.now ? 'now' : ''} ${col.key === 'late' ? 'late' : ''}">${col.label}</div>`)}</div>
      ${list.map(row)}
    </div></div>
  </section>`;
}

// Permits this business / vehicle doesn't track yet, one tap to add.
function suggestions(subject, id) {
  if (!canEdit()) return '';
  const have = new Set(reqsOf(subject, id).map((r) => r.type_code).filter(Boolean));
  const types = S.data.types.filter((t) => t.subject === subject && !have.has(t.code));
  return html`<section class="card">
    <div class="card-head"><div><h2>Add more ${subject === 'person' ? 'licences' : 'permits'}</h2><p class="card-sub">${subject === 'person' ? 'Licences and clearances staff often need' : `Other permits ${subject === 'business' ? 'businesses' : 'vehicles'} often need`}. Tap one to add it.</p></div></div>
    <div class="suggest-list">
      ${types.map((t) => html`<button class="line add" data-act="req-add" data-subject="${subject}" data-id="${id}" data-type="${t.code}"><span class="plus">+</span>
        <span class="line-main"><b>${t.name}</b>${t.help_text ? html`<small>${t.help_text}</small>` : ''}</span></button>`)}
      <button class="line add" data-act="req-add" data-subject="${subject}" data-id="${id}" data-type="other"><span class="plus">+</span>
        <span class="line-main"><b>Something else</b><small>Any permit, license or certificate not on the list</small></span></button>
    </div>
  </section>`;
}

function businessFields(b = {}, withLocation = true) {
  return html`
    <label class="field"><span>Business name</span><input name="name" required maxlength="160" value="${b.name || ''}" placeholder="e.g. Corner Bakery Corp."></label>
    <div class="grid2">
      <label class="field"><span>What does it do?</span><select name="activity">${optionList(Object.entries(ACTIVITIES), b.activity || 'retail')}</select></label>
      <label class="field"><span>How is it registered?</span><select name="structure">${optionList(STRUCTURES.map((s) => [s, s]), b.structure || 'Sole Proprietorship')}</select></label>
    </div>
    ${when(withLocation, html`<div class="grid2">
      <label class="field"><span>City / municipality</span><input name="city" maxlength="120" placeholder="e.g. Quezon City"></label>
      <label class="field"><span>Address <small>(optional)</small></span><input name="address" maxlength="300"></label>
    </div>`)}
    ${when(!withLocation, html`<label class="field"><span>TIN <small>(optional)</small></span><input name="tin" maxlength="30" value="${b.tin || ''}"></label>`)}`;
}

function addBusiness() {
  openModal('Add a business', html`
    <p class="muted small">We'll create a starter checklist (Mayor's Permit, Barangay Clearance, BIR registration, FSIC and more, depending on the business). Nothing is marked compliant until you add the details and documents.</p>
    ${businessFields()}`, {
    submitLabel: 'Add business',
    onSubmit: async (fd) => {
      const f = formObject(fd);
      if (!f.name) throw new Error('Please enter the business name.');
      const id = await db.createBusiness(S.org.id, f);
      await reload();
      go(`#/businesses/${id}`);
      toast(`${f.name} added with ${plural(reqsOf('business', id).length, 'requirement')} to confirm.`);
    },
  });
}
on('biz-add', addBusiness);

export function businessDetail(el, id) {
  const b = business(id);
  if (!b) { el.innerHTML = String(empty('Not found', 'This business was deleted or you no longer have access.', html`<a class="btn btn-primary" href="#/businesses">Back</a>`)); return; }
  const reqs = reqsOf('business', id);
  const c = counts(reqs);
  const locs = locationsOf(id);
  const tab = tabs.business;
  const tabBtn = (k, label) => html`<button class="tab ${tab === k ? 'active' : ''}" data-act="tab" data-scope="business" data-tab="${k}">${label}</button>`;

  el.innerHTML = String(html`
    <a class="back" href="#/businesses">← Businesses</a>
    <div class="page-head"><div><h1>${b.name}</h1><p class="muted">${ACTIVITIES[b.activity]} · ${b.structure}${b.tin ? ' · TIN ' + b.tin : ''}</p></div>
      <div class="btn-row">${when(canEdit(), html`<button class="btn btn-soft" data-act="req-add" data-subject="business" data-id="${id}">+ Requirement</button>`)}
        <button class="btn btn-ghost" data-act="share-open" data-scope="business" data-id="${id}">${ICON.share} Share proof</button>
        <a class="btn btn-ghost" href="#/services">${ICON.briefcase} Services</a></div></div>
    ${statTiles(c)}
    <div class="tabs">${tabBtn('requirements', 'Requirements')}${tabBtn('branches', `Branches (${locs.length})`)}${tabBtn('documents', 'Documents')}${tabBtn('activity', 'Activity')}${tabBtn('details', 'Details')}</div>
    <div id="tab-body"></div>`);
  const body = el.querySelector('#tab-body');

  if (tab === 'requirements') {
    const wide = reqs.filter((r) => !r.location_id).sort(byPriority);
    body.innerHTML = String(html`
      ${locs.map((l) => {
        const list = reqs.filter((r) => r.location_id === l.id).sort(byPriority);
        const c2 = counts(list);
        return html`<section class="card"><div class="card-head"><h2>${l.name}${l.city ? ' · ' + l.city : ''}</h2><span class="muted small">${plural(list.length, 'item')}</span></div>
          ${list.length ? list.map((r) => reqRow(r, { showSubject: false })) : html`<p class="muted pad">Nothing tracked for this branch yet.</p>`}
          ${when(canEdit(), html`<button class="line add" data-act="req-add" data-subject="business" data-id="${id}" data-loc="${l.id}"><span class="plus">+</span>Add a permit to this branch</button>`)}
          ${when(list.length, html`<div class="sheet-foot">${c2.compliant} of ${c2.total} compliant</div>`)}</section>`;
      })}
      ${when(wide.length, html`<section class="card"><div class="card-head"><h2>Whole business</h2><span class="muted small">Registrations that cover every branch</span></div>
        ${wide.map((r) => reqRow(r, { showSubject: false }))}</section>`)}
      ${suggestions('business', id)}`);
  } else if (tab === 'branches') {
    body.innerHTML = String(html`
      <section class="card"><div class="card-head"><h2>Branches</h2>
        ${when(canEdit(), html`<button class="btn btn-sm btn-primary" data-act="loc-add" data-id="${id}">+ Add branch</button>`)}</div>
        <p class="muted small">Each branch needs its own Mayor's Permit, Barangay Clearance, BIR COR and FSIC. Adding a branch adds those automatically.
</p>
        ${locs.map((l) => html`<div class="row"><div class="row-main"><div class="row-title">${l.name} ${l.is_main ? html`<span class="tag">Main</span>` : ''}</div>
          <div class="row-sub">${[l.city, l.address].filter(Boolean).join(' · ') || 'No address'} · ${plural(reqs.filter((r) => r.location_id === l.id).length, 'requirement')}</div></div>
          ${when(canEdit(), html`<div class="row-side"><button class="btn btn-sm btn-ghost" data-act="loc-edit" data-id="${l.id}">Edit</button>
            ${when(!l.is_main, html`<button class="btn btn-sm btn-ghost danger" data-act="loc-delete" data-id="${l.id}">Delete</button>`)}</div>`)}</div>`)}
      </section>`);
  } else if (tab === 'documents') {
    filesTab(body, reqs, 'business', id);
  } else if (tab === 'activity') {
    activityTab(body, 'business_id', id);
  } else {
    body.innerHTML = String(html`<section class="card"><h2>Business details</h2>
      ${canEdit() ? html`<form data-form="biz-save" data-id="${id}">${businessFields(b, false)}<button class="btn btn-primary">Save changes</button></form>`
        : html`<dl class="kv"><dt>Name</dt><dd>${b.name}</dd><dt>Activity</dt><dd>${ACTIVITIES[b.activity]}</dd><dt>Structure</dt><dd>${b.structure}</dd></dl>`}
      </section>
      ${when(isOrgAdmin(), html`<div class="danger-zone"><button class="btn btn-ghost danger" data-act="biz-delete" data-id="${id}">Delete this business</button>
        <span class="muted small">Its branches, permits and files are kept and can be restored from Trash.</span></div>`)}`);
    const form = body.querySelector('form');
    if (form) form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = formObject(new FormData(form));
      if (!f.name) return toast('Business name cannot be empty.', 'error');
      try { await db.updateBusiness(id, { name: f.name, activity: f.activity, structure: f.structure, tin: f.tin || null }); await reload(); toast('Saved.'); } catch (err) { toastError(err); }
    });
  }
}

on('biz-delete', async (ds) => {
  const b = business(ds.id);
  if (!(await confirmDialog(`Delete ${b.name}?`, 'It disappears from your dashboard and reminders stop. Everything is kept and can be restored from Trash.'))) return;
  try { await db.softDelete('businesses', b.id); await reload(); go('#/businesses'); toast('Deleted. Restore it from Trash anytime.'); } catch (e) { toastError(e); }
});

function locationForm(l = {}) {
  return html`<label class="field"><span>Branch name</span><input name="name" required maxlength="120" value="${l.name || ''}" placeholder="e.g. Cebu branch"></label>
    <div class="grid2"><label class="field"><span>City / municipality</span><input name="city" maxlength="120" value="${l.city || ''}"></label>
    <label class="field"><span>Address</span><input name="address" maxlength="300" value="${l.address || ''}"></label></div>`;
}
on('loc-add', (ds) => openModal('Add a branch', html`<p class="muted small">We'll add this branch's own Mayor's Permit, Barangay Clearance, BIR COR and other branch-level permits.</p>${locationForm()}`, {
  submitLabel: 'Add branch',
  onSubmit: async (fd) => {
    const f = formObject(fd);
    if (!f.name) throw new Error('Please name the branch.');
    await db.addLocation(ds.id, f);
    await reload();
    toast('Branch added.');
  },
}));
on('loc-edit', (ds) => {
  const l = location_(ds.id);
  openModal('Edit branch', locationForm(l), {
    onSubmit: async (fd) => { const f = formObject(fd); if (!f.name) throw new Error('Please name the branch.'); await db.updateLocation(l.id, { name: f.name, city: f.city, address: f.address }); await reload(); toast('Saved.'); },
  });
});
on('loc-delete', async (ds) => {
  const l = location_(ds.id);
  if (!(await confirmDialog(`Delete ${l.name}?`, "Its permits stop being tracked. Everything is kept and can be restored from Trash."))) return;
  try { await db.softDelete('business_locations', l.id); await reload(); toast('Branch deleted.'); } catch (e) { toastError(e); }
});

// ================================================================ add requirement (business or vehicle)
on('req-add', (ds) => {
  const subject = ds.subject;
  const id = ds.id;
  const existing = reqsOf(subject, id);
  const locs = subject === 'business' ? locationsOf(id) : [];
  const types = S.data.types.filter((t) => t.subject === subject);
  openModal(subject === 'person' ? 'Add a licence' : 'Add a requirement', html`
    <label class="field"><span>Requirement</span><select name="type_code">
      ${types.map((t) => html`<option value="${t.code}">${t.name}</option>`)}<option value="">Other (describe it)</option></select></label>
    <label class="field other-name" hidden><span>What is it?</span><input name="name" maxlength="160" placeholder="${subject === 'vehicle' ? 'e.g. LTFRB franchise' : subject === 'person' ? 'e.g. Security guard license' : 'e.g. Signage permit'}"></label>
    ${when(locs.length, html`<label class="field"><span>For</span><select name="location_id">
      ${locs.map((l) => html`<option value="${l.id}">${l.name}${l.city ? ' · ' + l.city : ''}</option>`)}<option value="">Whole business (all branches)</option></select></label>`)}
    <label class="check other-expires" hidden><input type="checkbox" name="expires" checked> It has an expiry date</label>
    <p class="muted small type-help"></p>`, {
    submitLabel: 'Add',
    onOpen: (form) => {
      const sel = form.querySelector('[name=type_code]');
      const upd = () => {
        const t = typeOf(sel.value);
        form.querySelector('.other-name').hidden = !!sel.value;
        form.querySelector('.other-expires').hidden = !!sel.value;
        form.querySelector('.type-help').textContent = t?.help_text || '';
        const locSel = form.querySelector('[name=location_id]');
        if (locSel && t) locSel.value = t.per_location ? (locs[0]?.id || '') : '';
      };
      sel.addEventListener('change', upd);
      if (ds.type) sel.value = ds.type === 'other' ? '' : ds.type;
      upd();
      const locSel = form.querySelector('[name=location_id]');
      if (locSel && ds.loc) locSel.value = ds.loc;
    },
    onSubmit: async (fd) => {
      const f = formObject(fd);
      if (!f.type_code && !f.name) throw new Error('Please describe the requirement.');
      const dup = existing.find((r) => (f.type_code ? r.type_code === f.type_code : r.name.toLowerCase() === f.name.toLowerCase())
        && (r.location_id || '') === (f.location_id || ''));
      if (dup) throw new Error(`"${dup.name}" is already tracked here.`);
      const res = await db.addRequirement({
        subject, subject_id: id, location_id: f.location_id || null, type_code: f.type_code || null,
        name: f.type_code ? null : f.name, expires: f.type_code ? null : fd.get('expires') === 'on',
      });
      await reload();
      go(`#/requirement/${res.requirement_id}`);
      toast('Added. Now add its details and document.');
    },
  });
});

// ================================================================ vehicles
export function vehicleList(el, params) {
  const list = S.data.vehicles;
  el.innerHTML = String(html`
    <div class="page-head"><div><h1>Vehicles</h1><p class="muted">LTO registration, CTPL, emission and inspection for every vehicle.</p></div>
      ${when(canEdit(), html`<button class="btn btn-primary" data-act="veh-add">+ Add vehicle</button>`)}</div>
    ${list.length ? html`${timeline('vehicle', list)}<h3 class="section-label">Your vehicles</h3><div class="cards">${list.map(entityCard('vehicle'))}</div>`
      : empty('No vehicles yet', "Add one and we'll track its registration and insurance.", when(canEdit(), html`<button class="btn btn-primary" data-act="veh-add">Add a vehicle</button>`))}`);
  if (params.get('add') && canEdit()) { history.replaceState(null, '', '#/vehicles'); addVehicle(); }
}

function addVehicle() {
  openModal('Add a vehicle', html`
    <label class="field"><span>Make & model</span><input name="make_model" required maxlength="120" placeholder="e.g. Isuzu Elf NHR van"></label>
    <div class="grid2">
      <label class="field"><span>Plate number</span><input name="plate_no" maxlength="20" placeholder="e.g. NGV 5588"><small class="plate-hint"></small></label>
      <label class="field"><span>Type</span><select name="vehicle_type">${optionList(VEHICLE_TYPES.map((t) => [t, t]), 'Sedan')}</select></label>
      <label class="field"><span>CR number <small>(does not expire)</small></span><input name="cr_no" maxlength="40"></label>
      <label class="field"><span>Used by <small>(optional)</small></span><select name="business_id"><option value="">—</option>${S.data.businesses.map((b) => html`<option value="${b.id}">${b.name}</option>`)}</select></label>
    </div>
    <h4>LTO registration</h4>
    <div class="grid2">
      <label class="field"><span>OR number</span><input name="or_no" maxlength="100"></label>
      <label class="field"><span>Registration expires</span><input type="date" name="registration_expires"><small class="reg-suggest"></small></label>
      <label class="field"><span>OR photo or PDF <small>(optional)</small></span><input type="file" name="or_file" accept=".pdf,image/*"></label>
    </div>
    <h4>CTPL insurance</h4>
    <div class="grid2">
      <label class="field"><span>Insurance provider</span><input name="ctpl_provider" maxlength="120" placeholder="e.g. Malayan Insurance"></label>
      <label class="field"><span>Policy / COC number</span><input name="ctpl_policy_no" maxlength="100"></label>
      <label class="field"><span>CTPL expires</span><input type="date" name="ctpl_expires"></label>
      <label class="field"><span>CTPL proof <small>(optional)</small></span><input type="file" name="ctpl_file" accept=".pdf,image/*"></label>
    </div>`, {
    submitLabel: 'Add vehicle', wide: true,
    onOpen: (form) => {
      const plate = form.querySelector('[name=plate_no]');
      const hint = form.querySelector('.plate-hint');
      const sug = form.querySelector('.reg-suggest');
      plate.addEventListener('input', () => {
        const s = plateSchedule(plate.value);
        hint.textContent = s ? `LTO renewal window: ${s.label}` : '';
        const d = suggestDue('lto_plate', { plate: plate.value });
        sug.innerHTML = d ? String(html`Plate schedule suggests ${fmtDate(d.date)}. <button type="button" class="linklike">Use it</button>`) : '';
        const b = sug.querySelector('button');
        if (b) b.onclick = () => { form.querySelector('[name=registration_expires]').value = d.date; };
      });
    },
    onSubmit: async (fd) => {
      const f = formObject(fd);
      if (!f.make_model) throw new Error('Please enter the make and model.');
      for (const k of ['or_file', 'ctpl_file']) {
        const file = fd.get(k);
        if (file && file.size) { const p = db.checkFile(file); if (p) throw new Error(p); }
      }
      const res = await db.createVehicle(S.org.id, f);
      // Upload the optional OR / CTPL files onto the records just created.
      const up = async (file, part) => {
        if (!file || !file.size) return;
        const cycleId = part.cycle_id || await db.saveCycle({ cycleId: null, orgId: S.org.id, requirementId: part.requirement_id });
        await db.uploadDocument({ orgId: S.org.id, requirementId: part.requirement_id, cycleId, file });
      };
      try {
        await up(fd.get('or_file'), res.registration);
        await up(fd.get('ctpl_file'), res.ctpl);
      } catch (e) { toastError(e); }
      await reload();
      go(`#/vehicles/${res.vehicle_id}`);
      toast('Vehicle added.');
    },
  });
}
on('veh-add', addVehicle);

export function vehicleDetail(el, id) {
  const v = vehicle(id);
  if (!v) { el.innerHTML = String(empty('Not found', 'This vehicle was deleted or you no longer have access.', html`<a class="btn btn-primary" href="#/vehicles">Back</a>`)); return; }
  const reqs = reqsOf('vehicle', id).sort(byPriority);
  const c = counts(reqs);
  const s = plateSchedule(v.plate_no);
  const tab = tabs.vehicle;
  const tabBtn = (k, label) => html`<button class="tab ${tab === k ? 'active' : ''}" data-act="tab" data-scope="vehicle" data-tab="${k}">${label}</button>`;
  el.innerHTML = String(html`
    <a class="back" href="#/vehicles">← Vehicles</a>
    <div class="page-head"><div><h1>${v.make_model}</h1>
      <p class="muted">${v.plate_no || 'No plate'} · ${v.vehicle_type}${v.cr_no ? ' · CR ' + v.cr_no : ''}${v.business_id && business(v.business_id) ? ' · ' + business(v.business_id).name : ''}</p>
      ${when(s, html`<p class="small">LTO renewal window for this plate: <b>${s?.label}</b></p>`)}</div>
      <div class="btn-row">${when(canEdit(), html`<button class="btn btn-soft" data-act="req-add" data-subject="vehicle" data-id="${id}">+ Requirement</button>`)}
        <button class="btn btn-ghost" data-act="share-open" data-scope="vehicle" data-id="${id}">${ICON.share} Share proof</button>
        <a class="btn btn-ghost" href="#/services">${ICON.briefcase} Services</a></div></div>
    ${statTiles(c)}
    <div class="tabs">${tabBtn('requirements', 'Requirements')}${tabBtn('documents', 'Documents')}${tabBtn('activity', 'Activity')}${tabBtn('details', 'Details')}</div>
    <div id="tab-body"></div>`);
  const body = el.querySelector('#tab-body');
  if (tab === 'requirements') {
    body.innerHTML = String(html`<section class="card"><div class="card-head"><h2>Requirements</h2><span class="muted small">${plural(reqs.length, 'item')}</span></div>
      ${reqs.map((r) => reqRow(r, { showSubject: false }))}
      ${when(canEdit(), html`<button class="line add" data-act="req-add" data-subject="vehicle" data-id="${id}"><span class="plus">+</span>Add a permit to this vehicle</button>`)}
      <div class="sheet-foot">${c.compliant} of ${c.total} compliant</div></section>
      ${suggestions('vehicle', id)}`);
  }
  else if (tab === 'documents') filesTab(body, reqs, 'vehicle', id);
  else if (tab === 'activity') activityTab(body, 'vehicle_id', id);
  else {
    body.innerHTML = String(html`<section class="card"><h2>Vehicle details</h2>
      ${canEdit() ? html`<form data-id="${id}">
        <label class="field"><span>Make & model</span><input name="make_model" required maxlength="120" value="${v.make_model}"></label>
        <div class="grid2">
          <label class="field"><span>Plate number</span><input name="plate_no" maxlength="20" value="${v.plate_no}"></label>
          <label class="field"><span>Type</span><select name="vehicle_type">${optionList(VEHICLE_TYPES.map((t) => [t, t]), v.vehicle_type)}</select></label>
          <label class="field"><span>CR number</span><input name="cr_no" maxlength="40" value="${v.cr_no}"></label>
          <label class="field"><span>MV file number</span><input name="mv_file_no" maxlength="40" value="${v.mv_file_no}"></label>
          <label class="field"><span>Used by</span><select name="business_id"><option value="">—</option>${S.data.businesses.map((b) => html`<option value="${b.id}" ${b.id === v.business_id ? 'selected' : ''}>${b.name}</option>`)}</select></label>
        </div><button class="btn btn-primary">Save changes</button></form>`
        : html`<dl class="kv"><dt>Plate</dt><dd>${v.plate_no}</dd><dt>CR no.</dt><dd>${v.cr_no || '—'}</dd></dl>`}</section>
      ${when(isOrgAdmin(), html`<div class="danger-zone"><button class="btn btn-ghost danger" data-act="veh-delete" data-id="${id}">Delete this vehicle</button>
        <span class="muted small">Sold or retired? Its records are kept and can be restored from Trash.</span></div>`)}`);
    const form = body.querySelector('form');
    if (form) form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = formObject(new FormData(form));
      if (!f.make_model) return toast('Make and model cannot be empty.', 'error');
      try {
        await db.updateVehicle(id, { make_model: f.make_model, plate_no: f.plate_no.toUpperCase(), vehicle_type: f.vehicle_type, cr_no: f.cr_no, mv_file_no: f.mv_file_no, business_id: f.business_id || null });
        await reload(); toast('Saved.');
      } catch (err) { toastError(err); }
    });
  }
}
on('veh-delete', async (ds) => {
  const v = vehicle(ds.id);
  if (!(await confirmDialog(`Delete ${v.make_model}?`, 'Reminders for it stop. Everything is kept and can be restored from Trash.'))) return;
  try { await db.softDelete('vehicles', v.id); await reload(); go('#/vehicles'); toast('Deleted. Restore it from Trash anytime.'); } catch (e) { toastError(e); }
});

// ================================================================ shared tabs
on('tab', (ds) => { tabs[ds.scope] = ds.tab; rerender(); });

async function filesTab(body, reqs, scope, id) {
  body.innerHTML = String(html`<div class="loading">Loading…</div>`);
  try {
    const docs = (await db.orgDocuments(S.org.id)).filter((d) => reqs.some((r) => r.id === d.requirement_id));
    const name = (d) => reqs.find((r) => r.id === d.requirement_id)?.name || '';
    const isCurrent = (d) => reqs.some((r) => r.cycle_id === d.cycle_id);
    body.innerHTML = String(html`<section class="card"><div class="card-head"><div><h2>Documents</h2><p class="card-sub">${plural(docs.length, 'file')}</p></div>
      ${when(docs.length, html`<button class="btn btn-sm btn-soft" data-act="inspection-pack" data-scope="${scope}" data-id="${id}">${ICON.download} Inspection pack (.zip)</button>`)}</div>
      ${docs.length ? docs.map((d) => html`
      <div class="file"><span class="file-ic">${ICON.file}</span><div class="file-main"><div class="file-name">${d.file_name}</div>
        <div class="muted small">${name(d)} · ${isCurrent(d) ? 'current' : 'past record'} · ${fileSize(d.size_bytes)} · ${fmtDate(d.created_at)}</div></div>
        <div class="btn-row"><button class="btn btn-sm btn-soft" data-act="doc-view" data-path="${d.storage_path}" data-name="${d.file_name}" data-type="${d.mime_type || ''}">View</button>
        <button class="btn btn-sm btn-ghost" data-act="doc-download" data-path="${d.storage_path}" data-name="${d.file_name}">Download</button></div></div>`)
      : html`<p class="muted pad">No documents uploaded yet.</p>`}</section>`);
  } catch (e) { toastError(e); }
}

async function activityTab(body, column, id) {
  body.innerHTML = String(html`<div class="loading">Loading…</div>`);
  try {
    const items = await db.entityHistory(column, id);
    body.innerHTML = String(html`<section class="card">${items.length ? items.map((a) => html`
      <div class="hist"><div>${a.summary}</div><div class="muted small">${memberName(a.actor_id)} · ${timeAgo(a.created_at)}</div></div>`)
      : html`<p class="muted">No activity yet.</p>`}</section>`);
  } catch (e) { toastError(e); }
}

// ================================================================ people (staff licences)
export function personList(el, params) {
  const list = S.data.people || [];
  el.innerHTML = String(html`
    <div class="page-head"><div><h1>People</h1><p class="muted">Driver's licenses, PRC licenses, health cards and clearances your staff need.</p></div>
      ${when(canEdit(), html`<button class="btn btn-primary" data-act="person-add">+ Add person</button>`)}</div>
    ${list.length ? html`${timeline('person', list)}<h3 class="section-label">Your people</h3><div class="cards">${list.map(entityCard('person'))}</div>`
      : empty('No people yet', 'Add drivers, cooks, pharmacists and other staff whose licences must stay valid.',
        when(canEdit(), html`<button class="btn btn-primary" data-act="person-add">Add a person</button>`))}`);
  if (params.get('add') && canEdit()) { history.replaceState(null, '', '#/people'); addPerson(); }
}

function addPerson() {
  const types = S.data.types.filter((t) => t.subject === 'person');
  openModal('Add a person', html`
    <label class="field"><span>Full name</span><input name="full_name" required maxlength="160" placeholder="e.g. Juan dela Cruz"></label>
    <div class="grid2">
      <label class="field"><span>Role <small>(optional)</small></span><input name="role_title" maxlength="120" placeholder="e.g. Driver, Cook, Pharmacist"></label>
      <label class="field"><span>Works at <small>(optional)</small></span><select name="business_id"><option value="">—</option>${S.data.businesses.map((b) => html`<option value="${b.id}">${b.name}</option>`)}</select></label>
    </div>
    <h4>Which licences should we track?</h4>
    ${types.map((t) => html`<label class="check"><input type="checkbox" name="types" value="${t.code}"> ${t.name} <small class="muted">· ${t.agency}</small></label>`)}
    <p class="muted small">You'll enter each expiry date from the card itself. You can add more later.</p>`, {
    submitLabel: 'Add person',
    onSubmit: async (fd) => {
      const f = formObject(fd);
      if (!f.full_name) throw new Error('Please enter the name.');
      const id = await db.createPerson(S.org.id, { ...f, types: fd.getAll('types') });
      await reload();
      go(`#/people/${id}`);
      toast(`${f.full_name} added. Now add each licence's expiry date.`);
    },
  });
}
on('person-add', addPerson);

export function personDetail(el, id) {
  const p = person(id);
  if (!p) { el.innerHTML = String(empty('Not found', 'This person was deleted or you no longer have access.', html`<a class="btn btn-primary" href="#/people">Back</a>`)); return; }
  const reqs = reqsOf('person', id).sort(byPriority);
  const c = counts(reqs);
  const tab = tabs.person;
  const tabBtn = (k, label) => html`<button class="tab ${tab === k ? 'active' : ''}" data-act="tab" data-scope="person" data-tab="${k}">${label}</button>`;
  el.innerHTML = String(html`
    <a class="back" href="#/people">← People</a>
    <div class="page-head"><div><h1>${p.full_name}</h1>
      <p class="muted">${[p.role_title, p.business_id && business(p.business_id)?.name].filter(Boolean).join(' · ') || 'Staff member'}</p></div>
      <div class="btn-row">${when(canEdit(), html`<button class="btn btn-soft" data-act="req-add" data-subject="person" data-id="${id}">+ Licence</button>`)}
        <button class="btn btn-ghost" data-act="share-open" data-scope="person" data-id="${id}">${ICON.share} Share proof</button></div></div>
    ${statTiles(c)}
    <div class="tabs">${tabBtn('requirements', 'Licences')}${tabBtn('documents', 'Documents')}${tabBtn('details', 'Details')}</div>
    <div id="tab-body"></div>`);
  const body = el.querySelector('#tab-body');
  if (tab === 'requirements') {
    body.innerHTML = String(html`<section class="card"><div class="card-head"><h2>Licences</h2><span class="muted small">${plural(reqs.length, 'item')}</span></div>
      ${reqs.length ? reqs.map((r) => reqRow(r, { showSubject: false })) : html`<p class="muted pad">No licences tracked yet.</p>`}
      ${when(canEdit(), html`<button class="line add" data-act="req-add" data-subject="person" data-id="${id}"><span class="plus">+</span>Add a licence</button>`)}
      ${when(reqs.length, html`<div class="sheet-foot">${c.compliant} of ${c.total} valid</div>`)}</section>
      ${suggestions('person', id)}`);
  } else if (tab === 'documents') filesTab(body, reqs, 'person', id);
  else {
    body.innerHTML = String(html`<section class="card"><h2>Details</h2>
      ${canEdit() ? html`<form>
        <label class="field"><span>Full name</span><input name="full_name" required maxlength="160" value="${p.full_name}"></label>
        <div class="grid2">
          <label class="field"><span>Role</span><input name="role_title" maxlength="120" value="${p.role_title}"></label>
          <label class="field"><span>Works at</span><select name="business_id"><option value="">—</option>${S.data.businesses.map((b) => html`<option value="${b.id}" ${b.id === p.business_id ? 'selected' : ''}>${b.name}</option>`)}</select></label>
        </div><button class="btn btn-primary">Save changes</button></form>`
        : html`<dl class="kv"><dt>Name</dt><dd>${p.full_name}</dd><dt>Role</dt><dd>${p.role_title || '—'}</dd></dl>`}</section>
      ${when(isOrgAdmin(), html`<div class="danger-zone"><button class="btn btn-ghost danger" data-act="person-delete" data-id="${id}">Remove this person</button>
        <span class="muted small">Left the company? Their records are kept and can be restored from Trash.</span></div>`)}`);
    const form = body.querySelector('form');
    if (form) form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = formObject(new FormData(form));
      if (!f.full_name) return toast('Name cannot be empty.', 'error');
      try { await db.updatePerson(id, { full_name: f.full_name, role_title: f.role_title, business_id: f.business_id || null }); await reload(); toast('Saved.'); } catch (err) { toastError(err); }
    });
  }
}
on('person-delete', async (ds) => {
  const p = person(ds.id);
  if (!(await confirmDialog(`Remove ${p.full_name}?`, 'Reminders for their licences stop. Everything is kept and can be restored from Trash.'))) return;
  try { await db.softDelete('people', p.id); await reload(); go('#/people'); toast('Removed. Restore from Trash anytime.'); } catch (e) { toastError(e); }
});
