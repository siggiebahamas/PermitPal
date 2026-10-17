// Error reporting: when something breaks in someone's browser, PermitPal staff find out (Admin > Errors)
// instead of the customer quietly giving up. Nothing personal leaves the browser: emails, phone numbers,
// long numbers, record ids and invite/share codes are removed before sending. Network drop-outs and
// the customer's own validation messages are not errors and are never sent.
import { APP_VERSION } from './config.js';

let send = null;          // (report) => Promise, set by init once the database supports it
let context = () => ({}); // () => ({ orgId })
const seen = new Set();   // one report per kind of error per page load
let sentCount = 0;
const MAX_PER_LOAD = 10;

// Never worth reporting: browser noise, extensions, lost connections, our own deliberate stops.
const IGNORE = [
  /ResizeObserver loop/i, /^Script error\.?$/i, /Failed to fetch|NetworkError|Load failed|network connection was lost|The Internet connection appears to be offline/i,
  /AbortError|The operation was aborted|signal is aborted/i, /cannot be shown inside another website/i, /Non-Error promise rejection captured/i,
  /extension:\/\//i, /^Request failed$/i,
];

// Strip anything that could identify a person or a record.
export function scrub(text) {
  return String(text || '')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/(\+?63|0)9\d{2}[\s-]?\d{3}[\s-]?\d{4}/g, '[phone]')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/(#\/(?:connect|invite|reset)\/)[^\s/?#'"]+/gi, '$1:code')
    .replace(/(share\.html#\/?)[^\s'"]+/gi, '$1:code')
    .replace(/([?&](?:token|code|access_token|refresh_token|key)=)[^&\s'"]+/gi, '$1:hidden')
    .replace(/\b\d{6,}\b/g, '#');
}

// The page someone was on, as a pattern (no ids or codes).
export function routePattern(hash = location.hash) {
  return scrub(String(hash || '#/').split('?')[0]).replace(/\/(b|v|l|pp|o|n)\d+\b/g, '/:id').slice(0, 200);
}

function report(message, stack) {
  if (!send || sentCount >= MAX_PER_LOAD) return;
  const msg = scrub(message).trim().slice(0, 500);
  if (!msg || IGNORE.some((re) => re.test(msg))) return;
  const key = msg.replace(/\d+/g, '#');
  if (seen.has(key)) return;
  seen.add(key); sentCount++;
  const ctx = (() => { try { return context() || {}; } catch { return {}; } })();
  send({
    message: msg,
    stack: scrub(stack).slice(0, 4000),
    route: routePattern(),
    version: APP_VERSION,
    agent: navigator.userAgent.slice(0, 300),
    orgId: ctx.orgId || null,
  }).catch(() => {}); // reporting must never cause a second error
}

// Called by the app for errors it caught but did not expect (a bug, not a typing mistake).
export function reportError(err) {
  if (!err) return;
  const message = err.message || String(err);
  report(err.name && err.name !== 'Error' && !message.startsWith(err.name) ? `${err.name}: ${message}` : message, err.stack || '');
}

// An error the customer saw in a toast: report it only if it is a programming error or an unexpected
// database error, not one of our own "Please fill in…" messages.
const UNEXPECTED_DB = /^(PGRST\d+|42\d{3}|XX\d{3}|P0\d{3}|0A\d{3}|25\d{3}|40\d{3}|53\d{3}|57\d{3})$/;
export function maybeReportShownError(err) {
  if (!err) return;
  const programming = err instanceof TypeError || err instanceof ReferenceError || err instanceof RangeError || err instanceof SyntaxError;
  const dbCode = typeof err.code === 'string' && UNEXPECTED_DB.test(err.code) && err.code !== 'P0001' && err.code !== '42501';
  if (programming || dbCode) reportError(err);
}

export function initErrorReporting(sender, getContext) {
  send = sender; if (getContext) context = getContext;
  if (initErrorReporting.done) return;
  initErrorReporting.done = true;
  window.addEventListener('error', (e) => {
    if (!e.error && !e.message) return; // a picture or font that failed to load is not a bug
    if (e.filename && !e.filename.startsWith(location.origin)) return; // scripts from other sites or browser add-ons
    // the browser adds "Uncaught" in front; leave it off so the same bug groups the same way however it surfaced
    if (e.error instanceof Error) reportError(e.error);
    else report(String(e.message || '').replace(/^Uncaught\s+/, ''), `${e.filename || ''}:${e.lineno || ''}:${e.colno || ''}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    // nothing caught this promise, so it is a bug whatever the message says
    if (r && typeof r === 'object' && 'message' in r) reportError(r);
    else if (typeof r === 'string') report(r, '');
  });
}
