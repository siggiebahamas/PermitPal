// Team tools: one board for every branch, client, tenant or vehicle you're responsible for.
//   head_office  company-owned branches + franchisees who connect their own workspace
//   firm         clients who connect their workspace, or workspaces you manage for them
//   property     tenants who connect their workspace (and may share copies of their permits)
//   fleet        every vehicle's registration, CTPL, emission test and inspection
// Single businesses stay free; these tools come with a 30-day trial, then a paid plan.
import { html, fmtDate, toast, toastError, when, plural, timeAgo, openModal, formObject, confirmDialog, download, toCsv } from '../util.js';
import { S, on, go, reload, canEdit, isOrgAdmin, empty } from '../core.js';
import { STATUS, ICON } from '../components.js';
import * as db from 'pp/data';

export const KINDS = {
  business: { title: 'A business', nav: null, blurb: 'Track your own permits and vehicles.' },
  head_office: {
    title: 'Head office or franchisor', nav: 'Branches', plan: 'head_office', relation: 'franchisee', one: 'branch', many: 'branches',
    icon: ICON.building, page: 'Branches', sub: 'Every branch and franchisee, one screen. Spot the store that is about to lapse before the city does.',
    pitch: 'See every branch and franchisee on one screen, remind the ones falling behind, and export it all for audits.',
    cols: ['mayors_permit', 'barangay_clearance', 'fsic', 'sanitary_permit', 'bir_cor'],
  },
  firm: {
    title: 'Accounting or bookkeeping firm', nav: 'Clients', plan: 'firm', relation: 'client', one: 'client', many: 'clients',
    icon: ICON.briefcase, page: 'Clients', sub: "Every client's permits on one screen, and a reminder to the ones who need it in one click.",
    pitch: "Stop tracking clients' renewals in spreadsheets. Every client on one board, with one-click reminders.",
    cols: ['mayors_permit', 'barangay_clearance', 'fsic', 'sanitary_permit', 'bir_cor'],
  },
  property: {
    title: 'Mall or property manager', nav: 'Tenants', plan: 'property', relation: 'tenant', one: 'tenant', many: 'tenants',
    icon: ICON.grid, page: 'Tenants', sub: "Every tenant's permits, always current. No more chasing photocopies every January.",
    pitch: "Tenants keep their own permits current in PermitPal; you see who is compliant and download their shared copies.",
    cols: ['mayors_permit', 'barangay_clearance', 'fsic', 'sanitary_permit'],
  },
  fleet: {
    title: 'Fleet operator', nav: 'Fleet', plan: 'fleet', one: 'vehicle', many: 'vehicles',
    icon: ICON.car, page: 'Fleet', sub: 'Every vehicle, every renewal, one screen. Keep every unit on the road.',
    pitch: "Every vehicle's registration, CTPL, emission test and inspection on one board, with spreadsheet import.",
    cols: ['lto_registration', 'ctpl', 'emission_test', 'mvir'],
  },
};
const TEAM_PLANS = ['head_office', 'firm', 'property', 'fleet'];
export const kindOf = () => S.org?.kind || 'business';
// Is the paid side switched on for this workspace (trial, plan, or PermitPal staff)?
export function teamAccess(org = S.org) {
  if (!org || org.kind === 'business') return { on: false, why: 'business' };
  if (S.profile?.is_platform_admin) return { on: true, why: 'staff' };
  const planOn = TEAM_PLANS.includes(org.plan_id) && (!org.plan_expires_at || org.plan_expires_at > new Date().toISOString());
  if (planOn) return { on: true, why: 'plan' };
  if (org.trial_ends_at && org.trial_ends_at > new Date().toISOString()) {
    const days = Math.max(1, Math.ceil((new Date(org.trial_ends_at) - Date.now()) / 864e5));
    return { on: true, why: 'trial', days };
  }
  return { on: false, why: 'ended' };
}

const SHORT_NAMES = { mayors_permit: "Mayor's Permit", barangay_clearance: 'Barangay Clearance', fsic: 'Fire Safety (FSIC)', sanitary_permit: 'Sanitary Permit',
  bir_cor: 'BIR 2303', lto_registration: 'LTO Registration', ctpl: 'CTPL Insurance', emission_test: 'Emission Test', mvir: 'Inspection (MVIR)' };
const typeName = (code) => SHORT_NAMES[code] || S.data?.types?.find((t) => t.code === code)?.name?.replace(/ \(.*\)$/, '') || code.replace(/_/g, ' ');
const ORDER = (s) => STATUS[s]?.order ?? 9;
// Worst status of a set of permits, plus the soonest date, for one cell of the board.
function cell(items) {
  if (!items.length) return { status: null };
  const worst = [...items].sort((a, b) => ORDER(a.status) - ORDER(b.status) || String(a.expires_on || '9').localeCompare(String(b.expires_on || '9')))[0];
  return { status: worst.status, date: worst.expires_on, count: items.length };
}
const cellHtml = (c) => (c.status
  ? html`<span class="nb-cell ${STATUS[c.status].cls}" title="${STATUS[c.status].label}${c.date ? ' · ' + fmtDate(c.date) : ''}"><b>${STATUS[c.status].label}</b><small>${c.date ? fmtDate(c.date) : c.status === 'needs_information' ? 'add details' : ''}${c.count > 1 ? ` · ${c.count}` : ''}</small></span>`
  : html`<span class="nb-cell none" title="Not tracked"><b>—</b><small>not tracked</small></span>`);
const rowScore = (items) => Math.min(9, ...items.map((i) => ORDER(i.status)));

// ================================================================ page
let boardCache = null;
let filter = 'all';
let picked = new Set();

export async function network(el) {
  const kind = kindOf();
  if (kind === 'business') return chooser(el);
  const k = KINDS[kind];
  const acc = teamAccess();
  if (!acc.on) return locked(el, k);
  if (kind === 'fleet') return fleetBoard(el, k, acc);
  el.innerHTML = String(html`<div class="loading">Loading your ${k.many}…</div>`);
  try { boardCache = await db.networkBoard(S.org.id); } catch (e) { toastError(e); boardCache = { members: [] }; }
  if (!location.hash.startsWith('#/network')) return;
  if (boardCache.locked) return locked(el, k);
  orgBoard(el, k, acc);
}

function trialNote(acc) {
  if (acc.why !== 'trial') return '';
  return html`<div class="banner info nb-trial"><div><b>Free trial: ${plural(acc.days, 'day')} left.</b> Everything on this page is included. Choose a plan anytime to keep it after the trial.</div>
    <a class="btn btn-sm btn-soft" href="#/settings/billing">See plans</a></div>`;
}

// Rows for the board: company-owned branches (head office) + connected / managed workspaces.
function rowsFor(k) {
  const rows = [];
  if (k === KINDS.head_office) {
    for (const l of S.data.locations) {
      const b = S.data.businesses.find((x) => x.id === l.business_id);
      const items = S.data.reqs.filter((r) => r.location_id === l.id || (r.business_id === l.business_id && !r.location_id && l.is_main));
      rows.push({ key: 'own:' + l.id, own: true, name: `${b?.name || ''}${l.is_main ? '' : ' · ' + l.name}`, sub: [l.city, 'Company-owned'].filter(Boolean).join(' · '),
        items, href: `#/businesses/${l.business_id}` });
    }
  }
  for (const m of boardCache?.members || []) {
    rows.push({ key: (m.link_id || 'org') + ':' + m.org_id, member: m, pending: m.status === 'pending',
      name: m.name || m.invited_email, sub: [m.label, m.via === 'managed' ? 'Managed by you' : m.status === 'pending' ? 'Invitation sent' : 'Connected'].filter(Boolean).join(' · '),
      items: m.items || [] });
  }
  return rows;
}

function orgBoard(el, k, acc) {
  const kind = kindOf();
  const cols = kind === 'property' && S.org.required_types?.length ? S.org.required_types : k.cols;
  const all = rowsFor(k);
  const live = all.filter((r) => !r.pending);
  const pending = all.filter((r) => r.pending);
  const n = (fn) => live.filter(fn).length;
  const overdue = n((r) => r.items.some((i) => i.status === 'action_required'));
  const soon = n((r) => !r.items.some((i) => i.status === 'action_required') && r.items.some((i) => i.status === 'renew_soon'));
  const clear = n((r) => r.items.length && r.items.every((i) => i.status === 'compliant' || i.status === 'in_progress'));
  const shown = live.filter((r) => filter === 'all' || (filter === 'attention' ? rowScore(r.items) <= 1 : filter === 'missing' ? r.items.some((i) => i.status === 'needs_information') : true))
    .sort((a, b) => rowScore(a.items) - rowScore(b.items) || a.name.localeCompare(b.name));
  picked = new Set([...picked].filter((key) => shown.some((r) => r.key === key)));
  el.innerHTML = String(html`
    <div class="page-head"><div><h1>${k.page}</h1><p class="muted">${k.sub}</p></div>
      ${when(isOrgAdmin(), html`<div class="btn-row">
        ${when(kind === 'property', html`<button class="btn btn-ghost btn-sm" data-act="nb-required">Required permits</button>`)}
        <button class="btn btn-ghost btn-sm" data-act="nb-export">Export</button>
        <button class="btn btn-primary" data-act="nb-add">+ Add ${k.one}</button></div>`)}</div>
    ${trialNote(acc)}
    <div class="stats nb-stats">
      <a class="stat" href="#/network" data-act="nb-filter" data-f="all"><div class="stat-n">${live.length}</div><div class="stat-l">${k.many[0].toUpperCase() + k.many.slice(1)}</div></a>
      <a class="stat overdue" href="#/network" data-act="nb-filter" data-f="attention"><div class="stat-n">${overdue}</div><div class="stat-l">With something overdue</div></a>
      <a class="stat soon" href="#/network" data-act="nb-filter" data-f="attention"><div class="stat-n">${soon}</div><div class="stat-l">Due within 30 days</div></a>
      <a class="stat ok" href="#/network" data-act="nb-filter" data-f="all"><div class="stat-n">${live.length ? Math.round((clear / live.length) * 100) : 0}%</div><div class="stat-l">Fully compliant</div></a>
    </div>

    ${live.length ? html`<section class="card nb-card">
      <div class="card-head"><div><h2>${k.page} board</h2><p class="card-sub">Worst status first. Tap a row for details.</p></div>
        <div class="btn-row">
          <select class="nb-filter" data-nb-filter aria-label="Show">
            <option value="all" ${filter === 'all' ? 'selected' : ''}>Show all</option>
            <option value="attention" ${filter === 'attention' ? 'selected' : ''}>Needs attention</option>
            <option value="missing" ${filter === 'missing' ? 'selected' : ''}>Missing details</option></select>
          ${when(isOrgAdmin(), html`<button class="btn btn-sm btn-primary" data-act="nb-nudge" ${picked.size ? '' : 'disabled'}>${ICON.bell} Send reminder${picked.size ? ` (${picked.size})` : ''}</button>`)}</div></div>
      <div class="nb-scroll"><table class="nb-table">
        <thead><tr><th class="nb-pick"></th><th class="nb-name">${k.one[0].toUpperCase() + k.one.slice(1)}</th>${cols.map((c) => html`<th>${typeName(c)}</th>`)}<th>Other</th></tr></thead>
        <tbody>${shown.map((r) => {
          const other = r.items.filter((i) => !cols.includes(i.type_code));
          const canNudge = !r.own && (r.member?.via === 'managed' ? !!r.member.contact_email : true);
          const nudgedToday = r.member?.last_nudged_at && Date.now() - new Date(r.member.last_nudged_at) < 20 * 3600e3;
          return html`<tr class="${picked.has(r.key) ? 'picked' : ''}">
            <td class="nb-pick">${when(isOrgAdmin() && canNudge && !nudgedToday, html`<input type="checkbox" data-nb-pick="${r.key}" ${picked.has(r.key) ? 'checked' : ''} aria-label="Select ${r.name}">`)}</td>
            <td class="nb-name"><button class="linklike" data-act="nb-open" data-key="${r.key}"><b>${r.name}</b></button><small>${r.sub}${nudgedToday ? ' · reminded today' : ''}</small></td>
            ${cols.map((c) => html`<td>${cellHtml(cell(r.items.filter((i) => i.type_code === c)))}</td>`)}
            <td>${other.length ? cellHtml(cell(other)) : html`<span class="nb-cell none"><b>—</b></span>`}</td></tr>`;
        })}</tbody></table></div>
      ${when(!shown.length, html`<p class="muted">Nothing matches this filter.</p>`)}
    </section>` : html`<section class="card nb-empty">${k.icon}<div><h2>Add your first ${k.one}</h2>
      <p>${kind === 'head_office' ? 'Your own branches show up here automatically. Invite franchisees by email: they keep their own permits up to date in PermitPal for free, and you see their status here.'
        : kind === 'firm' ? 'Invite clients to connect their PermitPal, or create a workspace and manage their permits for them.'
        : 'Invite tenants by email. They keep their permits current in PermitPal for free and can share copies with you.'}</p>
      ${when(isOrgAdmin(), html`<button class="btn btn-primary" data-act="nb-add">+ Add ${k.one}</button>`)}</div></section>`}

    ${when(pending.length, html`<section class="card"><div class="card-head"><div><h2>Waiting to connect</h2><p class="card-sub">They got an email with a link. You can copy it and send it yourself too.</p></div></div>
      ${pending.map((r) => html`<div class="line"><span class="line-main"><b>${r.member.invited_email}</b><small>${r.member.label ? r.member.label + ' · ' : ''}invited ${timeAgo(r.member.created_at)}</small></span>
        ${when(isOrgAdmin(), html`<span class="btn-row"><button class="btn btn-sm btn-soft" data-act="nb-copy-invite" data-id="${r.member.link_id}">Copy link</button>
          <button class="btn btn-sm btn-ghost danger" data-act="nb-cancel" data-id="${r.member.link_id}">Cancel</button></span>`)}</div>`)}</section>`)}

    <p class="fineprint">${kind === 'firm' ? "Connected clients choose to share their permit status with you and can stop anytime. You see permit names, status and dates; their files stay private unless they choose to share copies."
      : `Connected ${k.many} choose to share their permit status with you and can stop anytime. You see permit names, status and dates; files stay private unless they choose to share copies.`}</p>`);
}

// ---------------------------------------------------------------- fleet board (your own vehicles)
let fleetBiz = 'all';
function fleetBoard(el, k, acc) {
  const cols = k.cols;
  const vehicles = S.data.vehicles.filter((v) => fleetBiz === 'all' || (fleetBiz === 'none' ? !v.business_id : v.business_id === fleetBiz));
  const rows = vehicles.map((v) => ({ v, items: S.data.reqs.filter((r) => r.vehicle_id === v.id) }))
    .sort((a, b) => rowScore(a.items) - rowScore(b.items) || a.v.make_model.localeCompare(b.v.make_model));
  const off = rows.filter((r) => r.items.some((i) => i.status === 'action_required')).length;
  const soon = rows.filter((r) => !r.items.some((i) => i.status === 'action_required') && r.items.some((i) => i.status === 'renew_soon')).length;
  const month = new Date().toISOString().slice(0, 7);
  const thisMonth = S.data.reqs.filter((r) => r.vehicle_id && r.expires_on && r.expires_on.slice(0, 7) === month && r.status !== 'compliant');
  el.innerHTML = String(html`
    <div class="page-head"><div><h1>Fleet</h1><p class="muted">${k.sub}</p></div>
      ${when(canEdit(), html`<div class="btn-row"><button class="btn btn-ghost btn-sm" data-act="nb-export">Export</button>
        <button class="btn btn-ghost" data-act="veh-import">${ICON.upload} Import from spreadsheet</button>
        <a class="btn btn-primary" href="#/vehicles?add=1">+ Add vehicle</a></div>`)}</div>
    ${trialNote(acc)}
    <div class="stats nb-stats">
      <div class="stat"><div class="stat-n">${rows.length}</div><div class="stat-l">Vehicles</div></div>
      <div class="stat overdue"><div class="stat-n">${off}</div><div class="stat-l">Should not be on the road</div></div>
      <div class="stat soon"><div class="stat-n">${soon}</div><div class="stat-l">Due within 30 days</div></div>
      <div class="stat progress"><div class="stat-n">${thisMonth.length}</div><div class="stat-l">Renewals this month</div></div>
    </div>
    ${rows.length ? html`<section class="card nb-card">
      <div class="card-head"><div><h2>Fleet board</h2><p class="card-sub">Worst first. An overdue registration or CTPL means the vehicle can be apprehended.</p></div>
        ${when(S.data.businesses.length, html`<select class="nb-filter" data-fleet-biz aria-label="Used by">
          <option value="all">All vehicles</option>${S.data.businesses.map((b) => html`<option value="${b.id}" ${fleetBiz === b.id ? 'selected' : ''}>${b.name}</option>`)}
          <option value="none" ${fleetBiz === 'none' ? 'selected' : ''}>Not assigned</option></select>`)}</div>
      <div class="nb-scroll"><table class="nb-table">
        <thead><tr><th class="nb-name">Vehicle</th>${cols.map((c) => html`<th>${typeName(c)}</th>`)}</tr></thead>
        <tbody>${rows.map(({ v, items }) => html`<tr>
          <td class="nb-name"><a href="#/vehicles/${v.id}"><b>${v.make_model}</b></a><small>${[v.plate_no, v.vehicle_type].filter(Boolean).join(' · ')}</small></td>
          ${cols.map((c) => html`<td>${cellHtml(cell(items.filter((i) => i.type_code === c)))}</td>`)}</tr>`)}</tbody></table></div>
    </section>` : html`<section class="card nb-empty">${ICON.car}<div><h2>Bring in your fleet</h2>
      <p>Import every vehicle from a spreadsheet in one go, or add them one by one.</p>
      <div class="btn-row"><button class="btn btn-primary" data-act="veh-import">Import from spreadsheet</button><a class="btn btn-ghost" href="#/vehicles?add=1">Add a vehicle</a></div></div></section>`}
    ${when(thisMonth.length, html`<section class="card"><div class="card-head"><div><h2>Renew this month</h2><p class="card-sub">Based on each record's expiry date</p></div></div>
      ${thisMonth.sort((a, b) => a.expires_on.localeCompare(b.expires_on)).map((r) => html`<a class="line" href="#/requirement/${r.id}"><span class="line-main"><b>${r.name}</b>
        <small>${r.subject_name}${r.plate_no ? ' · ' + r.plate_no : ''} · ${fmtDate(r.expires_on)}</small></span><span class="chip ${STATUS[r.status].cls}">${STATUS[r.status].label}</span></a>`)}</section>`)}`);
}

// ---------------------------------------------------------------- chooser & locked states
function chooser(el) {
  el.innerHTML = String(html`
    <div class="page-head"><div><h1>Team tools</h1><p class="muted">For businesses that are responsible for more than their own permits. Free for 30 days, no card needed.</p></div></div>
    <div class="nb-kinds">${['head_office', 'firm', 'property', 'fleet'].map((kind) => {
      const k = KINDS[kind]; const plan = S.plans.find((p) => p.id === k.plan);
      return html`<section class="card nb-kind">${k.icon}<h2>${k.title}</h2><p>${k.pitch}</p>
        <div class="nb-kind-foot"><span class="muted small">${plan?.price_php_monthly ? `₱${Number(plan.price_php_monthly).toLocaleString()}/month after the trial` : ''}</span>
          ${when(isOrgAdmin(), html`<button class="btn btn-primary btn-sm" data-act="nb-set-kind" data-kind="${kind}">Start free trial</button>`)}</div></section>`;
    })}</div>
    ${when(!isOrgAdmin(), html`<p class="muted">Ask your workspace owner to switch this on.</p>`)}
    <p class="fineprint">Your own businesses, vehicles and documents stay exactly as they are. You can switch back anytime in Settings → Workspace.</p>`);
}

function locked(el, k) {
  const plan = S.plans.find((p) => p.id === k.plan);
  el.innerHTML = String(html`
    <div class="page-head"><div><h1>${k.page}</h1><p class="muted">${k.sub}</p></div></div>
    <section class="card nb-empty">${k.icon}<div><h2>Your free trial has ended</h2>
      <p>Your ${k.many} and their data are kept safe. Choose the ${plan?.name || ''} plan${plan?.price_php_monthly ? ` (₱${Number(plan.price_php_monthly).toLocaleString()}/month)` : ''} to open the board again.</p>
      <a class="btn btn-primary" href="#/settings/billing">Choose a plan</a></div></section>`);
}

on('nb-set-kind', async (ds) => {
  const k = KINDS[ds.kind];
  if (!(await confirmDialog(`Set up ${k.title.toLowerCase()} tools?`, `Your 30-day free trial starts now. Nothing changes in your existing data, and you can switch back anytime.`, { confirmLabel: 'Start free trial', danger: false }))) return;
  try { await db.setOrgProfile(S.org.id, { kind: ds.kind }); await reload(); go('#/network'); toast(`${k.nav} is ready. Your trial runs for 30 days.`); } catch (e) { toastError(e); }
});

// ---------------------------------------------------------------- actions
const rowByKey = (key) => rowsFor(KINDS[kindOf()]).find((r) => r.key === key);
const redraw = () => network(document.getElementById('main'));

on('nb-filter', (ds) => { filter = ds.f; redraw(); });
document.addEventListener('change', (e) => {
  if (e.target.matches('[data-nb-pick]')) {
    if (e.target.checked) picked.add(e.target.dataset.nbPick); else picked.delete(e.target.dataset.nbPick);
    orgBoard(document.getElementById('main'), KINDS[kindOf()], teamAccess());
  }
  if (e.target.matches('[data-nb-filter]')) { filter = e.target.value; orgBoard(document.getElementById('main'), KINDS[kindOf()], teamAccess()); }
  if (e.target.matches('[data-fleet-biz]')) { fleetBiz = e.target.value; fleetBoard(document.getElementById('main'), KINDS.fleet, teamAccess()); }
});

on('nb-add', () => {
  const kind = kindOf(); const k = KINDS[kind];
  const labelPh = kind === 'property' ? 'Unit, e.g. G/F Unit 12' : kind === 'head_office' ? 'Store code or branch, e.g. QC-014' : 'Optional note, e.g. retainer client';
  openModal(`Add a ${k.one}`, html`
    ${when(kind === 'firm', html`<div class="seg" role="tablist">
      <label><input type="radio" name="mode" value="invite" checked> They use PermitPal themselves</label>
      <label><input type="radio" name="mode" value="manage"> I'll manage it for them</label></div>`)}
    <div class="nb-invite">
      <p class="muted small">We'll email them a link. They connect their own PermitPal (free for them) and choose what you see. Until then they show as "Waiting to connect".</p>
      <label class="field"><span>Their email</span><input type="email" name="email" maxlength="160" placeholder="owner@theirbusiness.ph"></label>
      <label class="field"><span>${kind === 'property' ? 'Unit' : kind === 'head_office' ? 'Store code or branch' : 'Note'} <small>(optional, only you see this)</small></span><input name="label" maxlength="120" placeholder="${labelPh}"></label>
    </div>
    ${when(kind === 'firm', html`<div class="nb-manage" hidden>
      <p class="muted small">We'll create a separate workspace for this client that you manage. Add their businesses and permits there, and send reminders to their contact email.</p>
      <label class="field"><span>Client's business name</span><input name="name" maxlength="120" placeholder="e.g. Dela Cruz Trading"></label>
      <div class="grid2"><label class="field"><span>Contact person <small>(optional)</small></span><input name="contact_name" maxlength="120"></label>
        <label class="field"><span>Contact email <small>(for reminders)</small></span><input type="email" name="contact_email" maxlength="160"></label></div>
    </div>`)}`, {
    submitLabel: 'Add',
    onOpen: (form) => {
      form.querySelectorAll('[name=mode]').forEach((r) => r.addEventListener('change', () => {
        const manage = form.querySelector('[name=mode]:checked').value === 'manage';
        form.querySelector('.nb-invite').hidden = manage; form.querySelector('.nb-manage').hidden = !manage;
      }));
    },
    onSubmit: async (fd) => {
      const f = formObject(fd);
      if (f.mode === 'manage') {
        if (!f.name) throw new Error("Please enter the client's business name.");
        if (f.contact_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.contact_email)) throw new Error('Please enter a valid contact email.');
        const id = await db.createOrg(f.name);
        await db.setOrgProfile(id, { contact_name: f.contact_name || null, contact_email: f.contact_email || null });
        await reload(); redraw();
        toast(`${f.name} added. Open it from the board to add their businesses.`);
        return;
      }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email || '')) throw new Error('Please enter a valid email address.');
      await db.linkInvite(S.org.id, k.relation, f.email, f.label);
      redraw();
      toast(`Invitation sent to ${f.email}.`);
    },
  });
});

on('nb-open', async (ds) => {
  const r = rowByKey(ds.key);
  if (!r) return;
  if (r.own) return go(r.href);
  const m = r.member;
  let docs = [];
  if (m.share_files && m.via === 'linked') { try { docs = await db.networkDocuments(S.org.id, m.org_id); } catch { docs = []; } }
  const items = [...r.items].sort((a, b) => ORDER(a.status) - ORDER(b.status));
  openModal(m.name || m.invited_email, html`
    <p class="muted small">${[m.label, m.via === 'managed' ? 'Managed by you' : `Connected ${m.accepted_at ? timeAgo(m.accepted_at) : ''}`, m.via === 'managed' && m.contact_email ? 'Reminders go to ' + m.contact_email : ''].filter(Boolean).join(' · ')}</p>
    ${items.length ? html`<div class="nb-detail">${items.map((i) => html`<div class="line"><span class="line-main"><b>${i.name}</b>
      <small>${[i.subject_name, i.plate_no, i.location, i.city].filter(Boolean).join(' · ')}${i.expires_on ? ' · ' + fmtDate(i.expires_on) : ''}</small></span>
      <span class="chip ${STATUS[i.status].cls}">${STATUS[i.status].label}</span></div>`)}</div>` : html`<p class="muted">No permits added yet.</p>`}
    ${when(docs.length, html`<h4>Shared copies</h4>${docs.map((d) => html`<div class="line"><span class="line-main"><b>${d.requirement}</b><small>${d.subject_name || ''} · ${d.file_name}</small></span>
      <button type="button" class="btn btn-sm btn-soft" data-act="nb-doc" data-path="${d.path}" data-name="${d.file_name}">Open</button></div>`)}`)}
    ${when(m.via === 'linked' && !m.share_files, html`<p class="muted small">They haven't shared copies of their permits. They can turn this on from their Settings.</p>`)}
    <div class="btn-row nb-detail-actions">
      ${when(m.via === 'managed', html`<button type="button" class="btn btn-primary btn-sm" data-act="nb-switch" data-id="${m.org_id}">Open their workspace</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="nb-contact" data-id="${m.org_id}">Edit contact</button>`)}
      ${when(m.via === 'linked' && isOrgAdmin(), html`<button type="button" class="btn btn-ghost btn-sm" data-act="nb-label" data-id="${m.link_id}" data-label="${m.label}">Edit note</button>
        <button type="button" class="btn btn-ghost btn-sm danger" data-act="nb-cancel" data-id="${m.link_id}">Disconnect</button>`)}
    </div>`, { wide: true });
});

on('nb-doc', async (ds) => {
  const w = window.open('about:blank', '_blank');
  try { const url = await db.fileUrl(ds.path, ds.name); if (w) w.location.href = url; else location.href = url; } catch (e) { w?.close(); toastError(e); }
});
on('nb-switch', async (ds) => {
  try { await db.setCurrentOrg(S.user.id, ds.id); location.hash = '#/'; location.reload(); } catch (e) { toastError(e); }
});
on('nb-contact', (ds) => {
  const m = boardCache.members.find((x) => x.org_id === ds.id);
  openModal('Client contact', html`
    <p class="muted small">Reminders you send go to this email.</p>
    <label class="field"><span>Contact person</span><input name="contact_name" maxlength="120" value="${m?.contact_name || ''}"></label>
    <label class="field"><span>Contact email</span><input type="email" name="contact_email" maxlength="160" value="${m?.contact_email || ''}"></label>`, {
    onSubmit: async (fd) => {
      const f = formObject(fd);
      if (f.contact_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.contact_email)) throw new Error('Please enter a valid email address.');
      await db.setOrgProfile(ds.id, { contact_name: f.contact_name || null, contact_email: f.contact_email || null });
      redraw(); toast('Saved.');
    },
  });
});
on('nb-label', (ds) => openModal('Note', html`<label class="field"><span>Store code, unit or note</span><input name="label" maxlength="120" value="${ds.label || ''}"></label>`, {
  onSubmit: async (fd) => { await db.linkSetLabel(ds.id, String(fd.get('label') || '')); redraw(); },
}));
on('nb-cancel', async (ds) => {
  if (!(await confirmDialog('Disconnect?', 'They keep all their own data. You will no longer see their permit status.', { confirmLabel: 'Disconnect' }))) return;
  try { await db.linkEnd(ds.id); document.getElementById('modal-root').innerHTML = ''; redraw(); toast('Disconnected.'); } catch (e) { toastError(e); }
});
on('nb-copy-invite', async (ds) => {
  try {
    const token = await db.linkToken(ds.id);
    const url = `${location.origin}${location.pathname}#/connect/${token}`;
    try { await navigator.clipboard.writeText(url); toast('Invitation link copied.'); } catch { openModal('Invitation link', html`<div class="copy-row"><input readonly value="${url}"></div>`); }
  } catch (e) { toastError(e); }
});

on('nb-nudge', () => {
  const rows = [...picked].map(rowByKey).filter(Boolean);
  if (!rows.length) return toast('Tick the rows to remind first.', 'error');
  const k = KINDS[kindOf()];
  openModal(`Send a reminder to ${plural(rows.length, k.one, k.many)}`, html`
    <p class="muted small">Each one gets an email and an in-app notice listing what is overdue, due soon or missing. One reminder per ${k.one} per day.</p>
    <ul class="small">${rows.map((r) => html`<li>${r.name}</li>`)}</ul>
    <label class="field"><span>Add a message <small>(optional)</small></span><textarea name="message" rows="3" maxlength="600" placeholder="e.g. Please upload your renewed Mayor's Permit before Jan 31 so we can submit it to the mall."></textarea></label>`, {
    submitLabel: 'Send reminder',
    onSubmit: async (fd) => {
      const links = rows.filter((r) => r.member?.link_id).map((r) => r.member.link_id);
      const orgs = rows.filter((r) => r.member?.via === 'managed').map((r) => r.member.org_id);
      const sent = await db.networkNudge(S.org.id, links, orgs, String(fd.get('message') || ''));
      picked.clear(); redraw();
      toast(sent ? `Reminder sent to ${plural(sent, k.one, k.many)}.` : 'Nothing sent: they were already reminded today.');
    },
  });
});

on('nb-required', () => {
  const current = S.org.required_types?.length ? S.org.required_types : KINDS.property.cols;
  const types = S.data.types.filter((t) => t.subject === 'business');
  openModal('Permits every tenant must keep current', html`
    <p class="muted small">These become the columns of your tenant board.</p>
    ${types.map((t) => html`<label class="check"><input type="checkbox" name="types" value="${t.code}" ${current.includes(t.code) ? 'checked' : ''}> ${t.name}</label>`)}`, {
    onSubmit: async (fd) => {
      const list = fd.getAll('types');
      if (!list.length) throw new Error('Choose at least one permit.');
      await db.setOrgProfile(S.org.id, { required_types: list });
      await reload(); redraw();
    },
  });
});

on('nb-export', () => {
  const kind = kindOf(); const k = KINDS[kind];
  if (kind === 'fleet') {
    const rows = [['Vehicle', 'Plate', ...k.cols.map(typeName)]];
    for (const v of S.data.vehicles) {
      const items = S.data.reqs.filter((r) => r.vehicle_id === v.id);
      rows.push([v.make_model, v.plate_no || '', ...k.cols.map((c) => { const x = cell(items.filter((i) => i.type_code === c)); return x.status ? `${STATUS[x.status].label}${x.date ? ' ' + x.date : ''}` : 'Not tracked'; })]);
    }
    return download(`fleet-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows));
  }
  const cols = kind === 'property' && S.org.required_types?.length ? S.org.required_types : k.cols;
  const rows = [[k.one, 'Note', ...cols.map(typeName)]];
  for (const r of rowsFor(k).filter((x) => !x.pending)) {
    rows.push([r.name, r.member?.label || r.sub, ...cols.map((c) => { const x = cell(r.items.filter((i) => i.type_code === c)); return x.status ? `${STATUS[x.status].label}${x.date ? ' ' + x.date : ''}` : 'Not tracked'; })]);
  }
  download(`${k.many}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows));
});

// ================================================================ the invited business's side
// #/connect/<token>: review an invitation and choose which workspace to connect.
export async function connectPage(el, token) {
  el.innerHTML = String(html`<div class="loading">Loading the invitation…</div>`);
  let inv = null;
  try { inv = await db.linkPreview(token); } catch (e) { toastError(e); }
  if (!inv || inv.status !== 'pending') {
    el.innerHTML = String(empty('This invitation is no longer open', inv?.status === 'active' ? 'It has already been accepted.' : 'Ask the person who invited you to send a new one.', html`<a class="btn btn-primary" href="#/">Go to your dashboard</a>`));
    return;
  }
  const mine = S.orgs.filter((o) => ['owner', 'admin'].includes(o.role) && o.kind === 'business');
  const what = { franchisee: 'a branch or franchisee', client: 'a client', tenant: 'a tenant' }[inv.relation];
  const req = (inv.required_types || []).map(typeName);
  el.innerHTML = String(html`
    <div class="page-head"><div><h1>Connect with ${inv.owner_name}</h1><p class="muted">${inv.owner_name} would like to see your permit status as ${what}${inv.label ? ` (${inv.label})` : ''}.</p></div></div>
    <section class="card proof-how">
      <div class="proof-see">
        <div class="yes"><b>${ICON.check} What they will see</b><p>The names, status and expiry dates of the permits in the workspace you choose${req.length ? `, including ${req.join(', ')}` : ''}.</p></div>
        <div class="no"><b>✕ What they never see</b><p>Your costs, notes, team, other workspaces, and your files, unless you tick the box below.</p></div>
      </div>
      <p class="muted small">You can stop sharing anytime from Settings → Workspace. PermitPal stays free for your business.</p>
    </section>
    ${mine.length ? html`<section class="card"><form id="connect-form">
      <label class="field"><span>Which workspace?</span><select name="org">${mine.map((o) => html`<option value="${o.id}" ${o.id === S.org.id ? 'selected' : ''}>${o.name}</option>`)}</select></label>
      <label class="check"><input type="checkbox" name="share" ${inv.relation === 'tenant' ? 'checked' : ''}> Also let ${inv.owner_name} download copies of my current permits${inv.relation === 'tenant' ? ' (malls usually require these)' : ''}</label>
      <div class="btn-row between"><button type="button" class="btn btn-ghost" data-act="connect-decline" data-token="${token}">Decline</button>
        <button class="btn btn-primary">Connect</button></div></form></section>`
      : html`<section class="card"><p>You need a business workspace that you own to connect. Create one first, then open the link again.</p></section>`}`);
  el.querySelector('#connect-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = e.target.querySelector('button.btn-primary'); btn.disabled = true;
    try {
      await db.linkAccept(token, fd.get('org'), !!fd.get('share'));
      toast(`Connected. ${inv.owner_name} now sees your permit status.`);
      if (fd.get('org') !== S.org.id) { await db.setCurrentOrg(S.user.id, fd.get('org')); location.hash = '#/'; location.reload(); return; }
      await reload(); go('#/');
    } catch (err) { btn.disabled = false; toastError(err); }
  });
}
on('connect-decline', async (ds) => {
  if (!(await confirmDialog('Decline this invitation?', 'They will see that you declined. You can still connect later if they invite you again.', { confirmLabel: 'Decline' }))) return;
  try { await db.linkDecline(ds.token); toast('Declined.'); go('#/'); } catch (e) { toastError(e); }
});

// Settings card for the invited side: who can see this workspace's status.
export async function connectionsCard() {
  let list = [];
  try { list = await db.myConnections(S.org.id); } catch { list = []; }
  if (!list.length) return '';
  return html`<section class="card" id="connections"><div class="card-head"><div><h2>Who can see your permit status</h2>
    <p class="card-sub">Companies you connected with, like your franchisor, accountant or mall</p></div></div>
    ${list.map((c) => html`<div class="line"><span class="line-main"><b>${c.owner_name}</b>
      <small>${{ franchisee: 'You are their branch or franchisee', client: 'You are their client', tenant: 'You are their tenant' }[c.relation]}${c.label ? ' · ' + c.label : ''} · since ${fmtDate(String(c.accepted_at).slice(0, 10))}</small></span>
      ${when(isOrgAdmin(), html`<span class="btn-row"><label class="check small"><input type="checkbox" data-conn-share="${c.id}" ${c.share_files ? 'checked' : ''}> Share copies</label>
        <button class="btn btn-sm btn-ghost danger" data-act="conn-end" data-id="${c.id}" data-name="${c.owner_name}">Stop sharing</button></span>`)}</div>`)}
  </section>`;
}
document.addEventListener('change', async (e) => {
  if (!e.target.matches('[data-conn-share]')) return;
  try { await db.linkSetSharing(e.target.dataset.connShare, e.target.checked); toast(e.target.checked ? 'They can now download copies of your current permits.' : 'Copies are private again.'); }
  catch (err) { e.target.checked = !e.target.checked; toastError(err); }
});
on('conn-end', async (ds) => {
  if (!(await confirmDialog(`Stop sharing with ${ds.name}?`, 'They will no longer see your permit status or copies. Your data stays with you.', { confirmLabel: 'Stop sharing' }))) return;
  try { await db.linkEnd(ds.id); toast('Stopped sharing.'); location.reload(); } catch (e) { toastError(e); }
});
