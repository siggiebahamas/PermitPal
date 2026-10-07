// Reading spreadsheets saved as CSV, and the dates people type into them.
// Plain CSV reader: quotes, commas and line breaks inside quotes, Excel's semicolon variant.
export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0];
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const iso = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
};
// Accepts 2027-03-10, 3/10/2027 (month first, as Excel exports in the Philippines), 10/3/2027 when
// the first number can only be a day, and "Mar 10, 2027". Returns { value } or { error }.
export function parseDate(raw) {
  const s = String(raw || '').trim();
  if (!s) return { value: null };
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return ok(iso(+m[1], +m[2], +m[3]), s);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) {
    let [a, b, y] = [+m[1], +m[2], +m[3]];
    if (y < 100) y += 2000;
    return ok(a > 12 ? iso(y, b, a) : iso(y, a, b), s);
  }
  m = s.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m && MONTHS.includes(m[1].toLowerCase())) return ok(iso(+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2]), s);
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})$/);
  if (m && MONTHS.includes(m[2].toLowerCase())) return ok(iso(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]), s);
  return { error: `"${s}" is not a date we can read. Use 2027-03-10.` };
  function ok(v, orig) { return v ? { value: v } : { error: `"${orig}" is not a real date.` }; }
}

