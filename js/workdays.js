// Working days, counted the way the processing clock counts them: weekends and national holidays don't count,
// and neither does the day you filed. The database works out the real deadline (with the same rules); this is
// for showing how far along the office is. holidays: a Set of 'YYYY-MM-DD'.
const dayAfter = (iso) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
export function isWorkday(iso, holidays = new Set()) {
  const wd = new Date(iso + 'T00:00:00Z').getUTCDay();
  return wd !== 0 && wd !== 6 && !holidays.has(iso);
}
// The nth working day after fromIso.
export function addWorkdays(fromIso, n, holidays = new Set()) {
  let d = fromIso;
  for (let k = 0; k < Math.min(Math.max(n, 0), 400);) { d = dayAfter(d); if (isWorkday(d, holidays)) k++; }
  return d;
}
// Working days after fromIso, up to and including toIso (0 when toIso isn't later).
export function workdaysBetween(fromIso, toIso, holidays = new Set()) {
  let n = 0;
  for (let d = dayAfter(fromIso); d <= toIso; d = dayAfter(d)) if (isWorkday(d, holidays)) n++;
  return n;
}
// The legal time for each kind of transaction (RA 11032); the Citizen's Charter can set a shorter one.
export const LEGAL_DAYS = { simple: 3, complex: 7, technical: 20 };
export function filingDays(kind, days, extended = false, closed = 0) {
  return (LEGAL_DAYS[kind] || Number(days) || 3) * (extended ? 2 : 1) + (Number(closed) || 0);
}
