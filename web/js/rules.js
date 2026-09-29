// Due-date suggestions from the requirement library's rules. These are only ever shown as
// suggestions the customer confirms — never saved silently.
import { parseISO, toISO, todayPH, daysBetween } from './util.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// LTO schedule: last digit of the plate = month (1=Jan ... 9=Sep, 0=Oct);
// second-to-last digit = week (1-3: days 1-7, 4-6: 8-14, 7-8: 15-21, 9/0: 22-end of month).
export function plateSchedule(plate) {
  const digits = String(plate || '').replace(/\D/g, '');
  if (digits.length < 2) return null;
  const last = Number(digits[digits.length - 1]);
  const mid = Number(digits[digits.length - 2]);
  const month = last === 0 ? 10 : last;
  let from, to;
  if (mid >= 1 && mid <= 3) [from, to] = [1, 7];
  else if (mid >= 4 && mid <= 6) [from, to] = [8, 14];
  else if (mid === 7 || mid === 8) [from, to] = [15, 21];
  else [from, to] = [22, 31];
  const label = `${MONTHS[month - 1]}, days ${from}–${to === 31 ? 'end of month' : to}`;
  return { month, from, to, label };
}

function lastDayOfMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function isoOf(y, m, d) {
  return toISO(new Date(Date.UTC(y, m - 1, Math.min(d, lastDayOfMonth(y, m)))));
}
function addYears(iso, n) {
  const d = parseISO(iso);
  const y = d.getUTCFullYear() + n, m = d.getUTCMonth() + 1;
  return isoOf(y, m, d.getUTCDate());
}

// Returns { date, note } or null when there is no reliable rule.
// ctx: { issuedOn, plate, today }
export function suggestDue(rule, ctx = {}) {
  const today = ctx.today || todayPH();
  const issued = ctx.issuedOn || null;
  switch (rule) {
    case 'jan20': {
      if (issued) {
        const y = parseISO(issued).getUTCFullYear() + 1;
        return { date: isoOf(y, 1, 20), note: 'Most LGUs require renewal by January 20. Check your city or municipality.' };
      }
      const y = parseISO(today).getUTCFullYear();
      const thisYear = isoOf(y, 1, 20);
      return { date: thisYear >= today ? thisYear : isoOf(y + 1, 1, 20), note: 'Most LGUs require renewal by January 20. Check your city or municipality.' };
    }
    case 'annual':
      if (!issued) return null;
      return { date: addYears(issued, 1), note: 'Usually valid for one year from the issue date. Check the date printed on the document.' };
    case 'years5':
      if (!issued) return null;
      return { date: addYears(issued, 5), note: 'Valid for 5 years from registration.' };
    case 'lto_plate': {
      const s = plateSchedule(ctx.plate);
      if (!s) return null;
      const base = issued || today;
      const y = parseISO(base).getUTCFullYear();
      let cand = isoOf(y, s.month, s.to);
      // Renewed (issued) shortly before this year's window, or the window already passed: next year.
      if (cand < base || (issued && daysBetween(issued, cand) < 90)) cand = isoOf(y + 1, s.month, s.to);
      return { date: cand, note: `LTO schedule for this plate: ${s.label}. Check the expiry on your OR.` };
    }
    default:
      return null;
  }
}
