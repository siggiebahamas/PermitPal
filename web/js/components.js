// Building blocks shared across pages: status chips, requirement rows, stats.
import { html, raw, fmtDate, plural, todayPH } from './util.js';
import { S, canEdit, location_ } from './core.js';
import { whoPill, selectBox } from './views/assign.js';

export const STATUS = {
  action_required: { label: 'Overdue', cls: 'overdue', order: 0 },
  renew_soon: { label: 'Renew soon', cls: 'soon', order: 1 },
  in_progress: { label: 'In progress', cls: 'progress', order: 2 },
  needs_information: { label: 'Needs info', cls: 'needinfo', order: 3 },
  compliant: { label: 'Compliant', cls: 'ok', order: 4 },
};
export const NEXT_ACTION = {
  renew: 'Renew',
  add_details: 'Add details',
  upload: 'Upload document',
  record_renewal: 'Record renewal',
};

export const ICON = {
  home: raw('<svg viewBox="0 0 24 24"><path d="M4 11.5 12 4l8 7.5"/><path d="M6 10v9h4v-5h4v5h4v-9"/></svg>'),
  building: raw('<svg viewBox="0 0 24 24"><rect x="6" y="3" width="12" height="18" rx="1"/><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1M11 21v-3h2v3"/></svg>'),
  person: raw('<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/></svg>'),
  briefcase: raw('<svg viewBox="0 0 24 24"><rect x="3.5" y="7" width="17" height="12.5" rx="2"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3.5 12.5h17"/></svg>'),
  handshake: raw('<svg viewBox="0 0 24 24"><path d="M3 12l4-4 4 3 2-2 4 3 4-4"/><path d="M7 8l5 5c.8.8 2 .8 2.8 0M10 15l2 2c.8.8 2 .8 2.8 0l2-2"/></svg>'),
  share: raw('<svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="2.2"/><circle cx="17.5" cy="6" r="2.2"/><circle cx="17.5" cy="18" r="2.2"/><path d="M8 11l7.5-4M8 13l7.5 4"/></svg>'),
  peso: raw('<svg viewBox="0 0 24 24"><path d="M8 20V4h5a4.5 4.5 0 0 1 0 9H8M5 8h13M5 11h13"/></svg>'),
  grid: raw('<svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>'),
  download: raw('<svg viewBox="0 0 24 24"><path d="M12 4v12M7 11l5 5 5-5"/><path d="M5 20h14"/></svg>'),
  camera: raw('<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>'),
  calendar: raw('<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>'),
  car: raw('<svg viewBox="0 0 24 24"><path d="M4 16v-4l1.7-4.2A2 2 0 0 1 7.5 6.5h9a2 2 0 0 1 1.8 1.3L20 12v4"/><path d="M4 16h16"/><circle cx="7.5" cy="17.5" r="1.4"/><circle cx="16.5" cy="17.5" r="1.4"/></svg>'),
  moto: raw('<svg viewBox="0 0 24 24"><circle cx="5.5" cy="16.5" r="3"/><circle cx="18.5" cy="16.5" r="3"/><path d="M5.5 16.5 9.5 10h4.5l4.5 6.5"/><path d="M14 10l-1.6-3.2H10M15.5 6.8h2.8"/></svg>'),
  check: raw('<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'),
  list: raw('<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>'),
  file: raw('<svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v4h4"/></svg>'),
  help: raw('<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14"/><circle cx="12" cy="17" r=".6"/></svg>'),
  bell: raw('<svg viewBox="0 0 24 24"><path d="M6 9a6 6 0 0 1 12 0c0 3.5 1 5 1.5 5.8H4.5C5 14 6 12.5 6 9z"/><path d="M10 18.5a2 2 0 0 0 4 0"/></svg>'),
  more: raw('<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></svg>'),
  menu: raw('<svg viewBox="0 0 24 24"><path d="M4 6.5h16M4 12h16M4 17.5h16"/></svg>'),
  close: raw('<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>'),
  upload: raw('<svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 20h14"/></svg>'),
  chevron: raw('<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>'),
};

export function statusChip(status, extra = '', size = '') {
  const s = STATUS[status] || STATUS.needs_information;
  return html`<span class="chip ${s.cls} ${size}">${s.label}${extra}</span>`;
}

export function dueText(r) {
  if (!r.expires) return r.document_count ? 'Does not expire' : 'Does not expire · no document on file';
  if (!r.expires_on) return 'No expiry date on file';
  const d = r.days_left;
  if (d < 0) return `${plural(-d, 'day')} overdue (was due ${fmtDate(r.expires_on)})`;
  if (d === 0) return `Expires today (${fmtDate(r.expires_on)})`;
  if (d <= 30) return `Due in ${plural(d, 'day')} · ${fmtDate(r.expires_on)}`;
  return `Valid until ${fmtDate(r.expires_on)}`;
}

export function subjectLabel(r) {
  if (r.subject === 'vehicle') return r.subject_name + (r.plate_no ? ` · ${r.plate_no}` : '');
  if (r.subject === 'person') return r.subject_name + (r.person_role ? ` · ${r.person_role}` : '');
  const branch = r.location_id && !r.location_is_main ? ` · ${r.location_name}` : '';
  return (r.subject_name || '') + branch;
}

export const byPriority = (a, b) =>
  (STATUS[a.status]?.order ?? 9) - (STATUS[b.status]?.order ?? 9)
  || (a.expires_on || '9999').localeCompare(b.expires_on || '9999')
  || a.name.localeCompare(b.name);

export function counts(reqs) {
  const c = { action_required: 0, renew_soon: 0, in_progress: 0, needs_information: 0, compliant: 0, total: reqs.length };
  for (const r of reqs) c[r.status] = (c[r.status] || 0) + 1;
  c.health = reqs.length ? Math.round((100 * c.compliant) / reqs.length) : null;
  return c;
}

// Short label for a permit (timeline bubbles).
const SHORT = { mayors_permit: "Mayor's Permit", barangay_clearance: 'Barangay Clearance', bir_cor: 'BIR 2303', fsic: 'FSIC', sanitary_permit: 'Sanitary Permit',
  dti_business_name: 'DTI Name', sec_registration: 'SEC', cda_registration: 'CDA', ecc: 'ECC', pcab_license: 'PCAB', doh_lto: 'DOH LTO', school_permit: 'School Permit',
  lto_registration: 'LTO Registration', ctpl: 'CTPL Insurance', emission_test: 'Emission Test', mvir: 'MVIR' };
export const shortName = (r) => SHORT[r.type_code] || r.name.replace(/\s*\(.*\)$/, '');

// Short, plain status line shown in color next to each item (never greyed out).
export function dueShort(r) {
  const d = r.days_left;
  if (r.status === 'in_progress') return d !== null && d < 0 ? `Renewal started · ${plural(-d, 'day')} overdue` : 'Renewal in progress';
  if (r.status === 'needs_information') {
    if (!r.cycle_id || (r.expires && !r.expires_on)) return 'Add the details';
    return 'Upload the document';
  }
  if (!r.expires) return 'Does not expire';
  if (d < 0) return `${plural(-d, 'day')} overdue`;
  if (d === 0) return 'Due today';
  if (d <= 30) return `Due in ${plural(d, 'day')}`;
  return `Valid until ${fmtDate(r.expires_on)}`;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// The colored date tile at the start of each row: when it's due, colored by status.
export function dateTile(r) {
  const s = STATUS[r.status] || STATUS.needs_information;
  if (!r.expires_on) {
    return html`<div class="dtile ${s.cls}" title="${r.expires ? 'No expiry date on file' : 'Does not expire'}"><small>${r.expires ? 'Date' : 'No exp.'}</small><b>${r.expires ? '?' : '—'}</b></div>`;
  }
  const [y, m, d] = r.expires_on.split('-').map(Number);
  const thisYear = todayPH().slice(0, 4) === String(y); // Philippine year, wherever the phone is
  return html`<div class="dtile ${s.cls}" title="${fmtDate(r.expires_on)}"><small>${MON[m - 1]}${thisYear ? '' : " '" + String(y).slice(2)}</small><b>${d}</b></div>`;
}

// On Home, overdue and renew-soon rows say it in the pill; other states keep their hint ("Add the details").
const homeDays = (r) => ['action_required', 'renew_soon'].includes(r.status) && r.expires_on;
// One requirement as a row. Clicking the row opens its page; the button does the next step.
// home: the Home list. The days left move into the status pill ("Due in 5 days"), so the line under the name is just whose it is.
export function reqRow(r, { showSubject = true, home = false } = {}) {
  const s = STATUS[r.status];
  // Only ask while nothing is on file yet: once a permit has a record, it clearly applies.
  const hint = r.confidence !== 'confirmed' && !r.cycle_id ? html`<span class="tag" title="We think you need this permit. Open it to confirm or remove it.">Does this apply?</span>` : '';
  const btn = r.next_action && canEdit()
    ? html`<button class="btn btn-sm ${r.next_action === 'renew' ? 'btn-primary' : 'btn-soft'}" data-act="req-next" data-id="${r.id}">${NEXT_ACTION[r.next_action]}</button>`
    : r.status === 'compliant' ? html`<span class="ok-mark">${ICON.check}</span>` : '';
  return html`
    <div class="row ${s.cls}" data-href="#/requirement/${r.id}" tabindex="0">
      ${selectBox(r)}${dateTile(r)}
      <div class="row-main">
        <div class="row-title">${r.name} ${hint}</div>
        <div class="row-sub">${home && homeDays(r) ? html`<span>${subjectLabel(r)}</span>`
          : html`${showSubject ? html`<span>${subjectLabel(r)}</span><span class="sep"> · </span>` : ''}<b class="due ${s.cls}">${dueShort(r)}</b>`}${whoPill(r)}</div>
      </div>
      <div class="row-side">${home && r.status === 'renew_soon' && r.days_left != null ? html`<span class="chip soon">${r.days_left === 0 ? 'Due today' : `Due in ${plural(r.days_left, 'day')}`}</span>` : statusChip(r.status)}${btn}</div>
    </div>`;
}

// scope ('business:<id>', 'vehicle:<id>', 'person:<id>'): on a record's own page, each tile opens
// the list for that record only, so the number on the tile matches what you see.
export function statTiles(c, scope = '') {
  const tile = (n, label, cls, filter) =>
    html`<a class="stat ${cls}" href="#/compliance?status=${filter}${scope ? `&entity=${scope}` : ''}"><div class="stat-n">${n}</div><div class="stat-l">${label}</div></a>`;
  return html`<div class="stats">
    ${tile(c.action_required, 'Overdue', 'overdue', 'action_required')}
    ${tile(c.renew_soon, 'Renew soon', 'soon', 'renew_soon')}
    ${tile(c.in_progress, 'In progress', 'progress', 'in_progress')}
    ${tile(c.needs_information, 'Needs info', 'needinfo', 'needs_information')}
    ${tile(c.compliant, 'Compliant', 'ok', 'compliant')}
  </div>`;
}

export function healthBar(c) {
  if (c.health === null) return '';
  return html`<div class="health"><div class="health-bar"><div style="width:${c.health}%"></div></div>
    <span>${c.health}% compliant · ${c.compliant}/${c.total}</span></div>`;
}

export function locationName(id) {
  const l = location_(id);
  return l ? (l.is_main ? `${l.name}${l.city ? ' · ' + l.city : ''}` : `${l.name}${l.city ? ' · ' + l.city : ''}`) : 'Whole business';
}

export function avatar(name, url, size = 32) {
  const initials = (name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return url
    ? html`<img class="avatar" src="${url}" alt="" style="width:${size}px;height:${size}px">`
    : html`<span class="avatar" style="width:${size}px;height:${size}px">${initials}</span>`;
}

export function planLimitNote(err) {
  return /plan|Upgrade/i.test(err?.message || '') ? html`<a href="#/settings/billing">See plans</a>` : '';
}

export const docCount = (r) => (r.document_count ? `${plural(r.document_count, 'file')} on file` : 'No file yet');
export const orgName = () => S.org?.name || '';
