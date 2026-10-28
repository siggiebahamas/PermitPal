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

// How long each office has, by law, so nobody has to pick. kind: the RA 11032 class (Sec. 9: simple 3, complex 7,
// highly technical 20 working days, counted from a complete application; Sec. 10: no action by then = approved).
// usual: working days most offices actually take (business permits: DTI-DILG-DICT JMC 2016-01 and ARTA JMC 2021-01
// set 1 day for renewals, 2 for new; BFP Citizen's Charter: FSIC renewal 1 day with a valid FSIC, up to 3 without).
export const PROCESS = {
  mayors_permit: ['simple', 2, 'Renewals: 1 day, new: 2 days (business permit rules)'],
  barangay_clearance: ['simple', 1, 'Usually released the same or next day'],
  fsic: ['simple', 3, 'Fire Protection: 1 day with a valid FSIC, up to 3 without'],
  sanitary_permit: ['complex', 3, 'May need a sanitary inspection first'],
  bir_cor: ['simple', 1, 'Usually released within a day'],
  dti_business_name: ['simple', 1, 'Usually released online the same day'],
  sec_registration: ['simple', 1, 'Usually released online within a day'],
  cda_registration: ['complex', 7, 'Reviewed by more than one office'],
  lto_registration: ['simple', 1, 'Usually released the same day'],
  ctpl: ['simple', 1, 'Usually released the same day'],
  emission_test: ['simple', 1, 'Usually released the same day'],
  mvir: ['simple', 1, 'Usually released the same day'],
  drivers_license: ['simple', 1, 'Usually released the same day'],
  health_certificate: ['simple', 1, 'Usually released within a day, after the tests'],
  nbi_clearance: ['simple', 1, 'Usually released the same day, unless there is a "hit"'],
  doh_lto: ['technical', 20, 'A highly technical health review'],
  ecc: ['technical', 20, 'A highly technical environmental review'],
  pcab_license: ['technical', 20, 'A highly technical review'],
  school_permit: ['technical', 20, 'A highly technical review'],
};
export function processFor(code) {
  const [kind, usual, why] = PROCESS[code] || ['simple', 3, 'Most permits and renewals'];
  return { kind, days: LEGAL_DAYS[kind], usual: Math.min(usual, LEGAL_DAYS[kind]), why };
}
