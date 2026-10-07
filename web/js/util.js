// Shared helpers: safe HTML templating, dates (Philippine time), formatting, toasts and modals.

// ---------------------------------------------------------------- safe HTML
// Every value interpolated into html`` is escaped unless it is itself html`` output (Raw).
// This is what keeps customer-typed text (business names, file names...) from ever
// running as code in the page.
export class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const raw = (s) => new Raw(String(s ?? ''));

export function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function part(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  if (v === null || v === undefined || v === false) return '';
  return esc(v);
}

export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += part(vals[i]) + strings[i + 1];
  return new Raw(out);
}

export const when = (cond, a, b = '') => (cond ? a : b);

// ---------------------------------------------------------------- dates (Asia/Manila)
export function todayPH() {
  return new Date().toLocaleString('en-CA', { timeZone: 'Asia/Manila' }).slice(0, 10);
}
export function parseISO(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export function toISO(date) {
  return date.toISOString().slice(0, 10);
}
export function addDays(iso, n) {
  const d = parseISO(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
}
export function daysBetween(fromISO, toISO_) {
  return Math.round((parseISO(toISO_) - parseISO(fromISO)) / 86400000);
}
export function fmtDate(iso) {
  const d = parseISO(iso);
  if (!d || isNaN(d)) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
export function fmtDateTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila',
  });
}
export function timeAgo(ts) {
  const s = Math.round((Date.now() - new Date(ts)) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} day${s < 172800 ? '' : 's'} ago`;
  return fmtDateTime(ts);
}

export const plural = (n, word, many = word + 's') => `${n} ${n === 1 ? word : many}`;
export const peso = (n) => '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
export function fileSize(b) {
  if (!b && b !== 0) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

// Philippine mobile numbers -> +639XXXXXXXXX. Returns null when it doesn't look valid.
export function normalizePhone(input) {
  const d = String(input || '').replace(/\D/g, '');
  if (!d) return '';
  let n = d;
  if (n.startsWith('09') && n.length === 11) n = '63' + n.slice(1);
  else if (n.startsWith('9') && n.length === 10) n = '63' + n;
  if (!/^639\d{9}$/.test(n) && !/^\d{8,15}$/.test(n)) return null;
  return '+' + n;
}

// ---------------------------------------------------------------- errors
export function friendlyError(err) {
  const msg = err?.message || String(err || 'Something went wrong.');
  if (/row-level security|permission denied/i.test(msg)) return "You don't have permission to do that. (Viewers can look but not change things.)";
  if (err?.code === '23505' || /duplicate key/i.test(msg)) return 'That already exists here.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return "Can't reach PermitPal right now. Check your internet connection and try again.";
  if (/JWT|refresh token/i.test(msg)) return 'Your session expired. Please log in again.';
  // Database rule violations: say what to fix in plain words instead of showing the raw error.
  if (err?.code === '23514' || /violates check constraint/i.test(msg)) {
    return /email/i.test(msg) ? 'Please enter a valid email address.' : "Some of the details aren't in the right format. Please check what you entered.";
  }
  if (err?.code === '22001' || /value too long/i.test(msg)) return 'One of the entries is too long. Please shorten it.';
  if (err?.code === '22007' || err?.code === '22008' || /invalid input syntax for type date|date\/time field value out of range/i.test(msg)) return 'Please enter a valid date.';
  if (err?.code === '23502' || /null value in column/i.test(msg)) return 'Please fill in all the required details.';
  if (err?.code === '23503' || /violates foreign key/i.test(msg)) return 'That item no longer exists. Refresh the page and try again.';
  return msg;
}

// ---------------------------------------------------------------- toast
let toastTimer;
export function toast(message, kind = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast'), kind === 'error' ? 6000 : 3000);
}
export const toastError = (err) => toast(friendlyError(err), 'error');

// ---------------------------------------------------------------- modals
// openModal(title, bodyRaw, { onSubmit, submitLabel, danger, wide }) — body usually contains form fields.
// onSubmit(formData, formEl) may return false (or throw) to keep the modal open.
export function openModal(title, body, opts = {}) {
  const root = document.getElementById('modal-root');
  const submit = opts.onSubmit
    ? html`<button type="submit" class="btn ${opts.danger ? 'btn-danger' : 'btn-primary'}">${opts.submitLabel || 'Save'}</button>`
    : '';
  root.innerHTML = String(html`
    <div class="modal-overlay" data-modal-overlay>
      <form class="modal ${opts.wide ? 'wide' : ''}" novalidate>
        <div class="modal-head"><h3>${title}</h3><button type="button" class="icon-btn" data-modal-close aria-label="Close">✕</button></div>
        <div class="modal-body">${body}</div>
        <div class="modal-error" hidden></div>
        <div class="modal-foot">
          <button type="button" class="btn btn-ghost" data-modal-close>${opts.cancelLabel || (opts.onSubmit ? 'Cancel' : 'Close')}</button>
          ${submit}
        </div>
      </form>
    </div>`);
  const form = root.querySelector('form');
  const errBox = root.querySelector('.modal-error');
  const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  root.querySelectorAll('[data-modal-close]').forEach((b) => b.addEventListener('click', close));
  root.querySelector('[data-modal-overlay]').addEventListener('mousedown', (e) => {
    if (e.target.hasAttribute('data-modal-overlay')) close();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!opts.onSubmit) return close();
    const btn = form.querySelector('button[type=submit]');
    errBox.hidden = true;
    // The form is novalidate (native bubbles look out of place), so check required fields here.
    const visible = (el) => !el.disabled && !el.closest('[hidden]') && el.getClientRects().length > 0;
    const missing = [...form.querySelectorAll('[required]')].filter((el) => visible(el) && (el.type === 'checkbox' ? !el.checked : !String(el.value || '').trim()));
    const badEmail = [...form.querySelectorAll('input[type=email]')].find((el) => visible(el) && el.value.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(el.value.trim()));
    if (missing.length || badEmail) {
      const labelOf = (el) => (el.closest('label')?.querySelector('span')?.childNodes[0]?.textContent || el.getAttribute('aria-label') || el.name || '').trim();
      errBox.textContent = missing.length
        ? (missing[0].type === 'checkbox' ? `Please tick the box: “${(missing[0].closest('label')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 140)}”` : `Please fill in: ${missing.map(labelOf).filter(Boolean).join(', ')}.`)
        : 'Please enter a valid email address.';
      errBox.hidden = false;
      (missing[0] || badEmail).focus();
      return;
    }
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = 'Saving…';
    try {
      const keep = await opts.onSubmit(new FormData(form), form);
      if (keep === false) { btn.disabled = false; btn.textContent = label; return; }
      close();
    } catch (err) {
      errBox.textContent = friendlyError(err);
      errBox.hidden = false;
      btn.disabled = false;
      btn.textContent = label;
    }
  });
  if (opts.onOpen) opts.onOpen(form);
  const first = form.querySelector('input:not([type=hidden]):not([type=checkbox]),select,textarea');
  if (first && !opts.noAutofocus) setTimeout(() => first.focus(), 30);
  return { close, form };
}

export function confirmDialog(title, message, { confirmLabel = 'Delete', danger = true } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal(title, html`<p class="muted">${message}</p>`, {
      submitLabel: confirmLabel, danger, noAutofocus: true,
      onSubmit: () => { done = true; resolve(true); },
    });
    const obs = new MutationObserver(() => {
      if (!document.body.contains(m.form)) { obs.disconnect(); if (!done) resolve(false); }
    });
    obs.observe(document.getElementById('modal-root'), { childList: true });
  });
}

// ---------------------------------------------------------------- misc
export function download(filename, content, type = 'text/csv') {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function toCsv(rows) {
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\n');
}

export function formObject(fd) {
  const o = {};
  for (const [k, v] of fd.entries()) o[k] = typeof v === 'string' ? v.trim() : v;
  return o;
}
