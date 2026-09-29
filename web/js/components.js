// Building blocks shared across pages: status chips, requirement rows, stats.
import { html, raw, fmtDate, plural } from './util.js';
import { S, canEdit, location_ } from './core.js';

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
  car: raw('<svg viewBox="0 0 24 24"><path d="M4 16v-4l1.7-4.2A2 2 0 0 1 7.5 6.5h9a2 2 0 0 1 1.8 1.3L20 12v4"/><path d="M4 16h16"/><circle cx="7.5" cy="17.5" r="1.4"/><circle cx="16.5" cy="17.5" r="1.4"/></svg>'),
  check: raw('<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'),
  list: raw('<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>'),
  file: raw('<svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v4h4"/></svg>'),
  help: raw('<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14"/><circle cx="12" cy="17" r=".6"/></svg>'),
  bell: raw('<svg viewBox="0 0 24 24"><path d="M6 9a6 6 0 0 1 12 0c0 3.5 1 5 1.5 5.8H4.5C5 14 6 12.5 6 9z"/><path d="M10 18.5a2 2 0 0 0 4 0"/></svg>'),
  more: raw('<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></svg>'),
  upload: raw('<svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 20h14"/></svg>'),
  chevron: raw('<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>'),
};

export function statusChip(status, extra = '') {
  const s = STATUS[status] || STATUS.needs_information;
  return html`<span class="chip ${s.cls}">${s.label}${extra}</span>`;
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

// One requirement as a row. Clicking the row opens its page; the button does the next step.
export function reqRow(r, { showSubject = true } = {}) {
  const s = STATUS[r.status];
  const sub = [showSubject ? subjectLabel(r) : '', dueText(r)].filter(Boolean).join(' · ');
  const hint = r.confidence !== 'confirmed' ? html`<span class="tag">Please confirm</span>` : '';
  const overdueNote = r.status === 'in_progress' && r.is_overdue ? html`<span class="tag red">Overdue</span>` : '';
  const btn = r.next_action && canEdit()
    ? html`<button class="btn btn-sm ${r.status === 'action_required' ? 'btn-danger' : 'btn-soft'}" data-act="req-next" data-id="${r.id}">${NEXT_ACTION[r.next_action]}</button>`
    : r.status === 'compliant' ? html`<span class="ok-mark">${ICON.check}</span>` : '';
  return html`
    <div class="row ${s.cls}" data-href="#/requirement/${r.id}" tabindex="0">
      <div class="row-main">
        <div class="row-title">${r.name} ${hint}${overdueNote}</div>
        <div class="row-sub">${sub}</div>
      </div>
      <div class="row-side">${statusChip(r.status)}${btn}</div>
    </div>`;
}

export function statTiles(c) {
  const tile = (n, label, cls, filter) =>
    html`<a class="stat ${cls}" href="#/compliance?status=${filter}"><div class="stat-n">${n}</div><div class="stat-l">${label}</div></a>`;
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
