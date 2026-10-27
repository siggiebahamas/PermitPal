// Pure-logic tests: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plateSchedule, suggestDue } from '../web/js/rules.js';
import { html, esc, raw, normalizePhone, toCsv, addDays, daysBetween } from '../web/js/util.js';
import { maxPenalty } from '../web/js/penalty.js';

test('LTO plate schedule: last digit = month, 2nd-to-last = week', () => {
  assert.deepEqual(plateSchedule('ABC 1234'), { month: 4, from: 1, to: 7, label: 'April, days 1–7' });
  assert.equal(plateSchedule('NGV 5588').month, 8);
  assert.deepEqual([plateSchedule('NGV 5588').from, plateSchedule('NGV 5588').to], [15, 21]);
  assert.equal(plateSchedule('XYZ 190').month, 10);          // 0 -> October
  assert.equal(plateSchedule('XYZ 190').from, 22);           // 9 -> last week
  assert.equal(plateSchedule('AB'), null);                   // no digits
});

test('Mayor\'s permit suggestion: January 20', () => {
  assert.equal(suggestDue('jan20', { issuedOn: '2026-01-12' }).date, '2027-01-20');
  assert.equal(suggestDue('jan20', { today: '2026-09-29' }).date, '2027-01-20');
  assert.equal(suggestDue('jan20', { today: '2026-01-05' }).date, '2026-01-20');
});

test('annual / 5-year / manual rules', () => {
  assert.equal(suggestDue('annual', { issuedOn: '2026-03-15' }).date, '2027-03-15');
  assert.equal(suggestDue('annual', {}), null);
  assert.equal(suggestDue('years5', { issuedOn: '2024-02-29' }).date, '2029-02-28');
  assert.equal(suggestDue('manual', { issuedOn: '2026-01-01' }), null);
});

test('LTO suggestion picks the next window, and next year right after renewing', () => {
  assert.equal(suggestDue('lto_plate', { plate: 'ABC 1234', today: '2026-09-29' }).date, '2027-04-07');
  assert.equal(suggestDue('lto_plate', { plate: 'ABC 1284', today: '2026-02-01' }).date, '2026-04-21');
  assert.equal(suggestDue('lto_plate', { plate: 'ABC 1284', issuedOn: '2026-04-10', today: '2026-04-10' }).date, '2027-04-21');
});

test('html`` escapes customer text (XSS fix)', () => {
  const name = '<img src=x onerror=alert(1)>';
  assert.equal(String(html`<b>${name}</b>`), '<b>&lt;img src=x onerror=alert(1)&gt;</b>');
  assert.equal(String(html`<a title="${'" onmouseover="x'}">`), '<a title="&quot; onmouseover=&quot;x">');
  assert.equal(String(html`<i>${html`<u>${'<s>'}</u>`}</i>`), '<i><u>&lt;s&gt;</u></i>');
  assert.equal(String(html`${[1, '<2>']}`), '1&lt;2&gt;');
  assert.equal(String(html`${raw('<br>')}`), '<br>');
  assert.equal(esc("O'Neil & Co"), 'O&#39;Neil &amp; Co');
});

test('Philippine mobile numbers', () => {
  assert.equal(normalizePhone('0917 123 4567'), '+639171234567');
  assert.equal(normalizePhone('+63 917-123-4567'), '+639171234567');
  assert.equal(normalizePhone('9171234567'), '+639171234567');
  assert.equal(normalizePhone('12'), null);
  assert.equal(normalizePhone(''), '');
});

test('CSV export quoting and date helpers', () => {
  assert.equal(toCsv([['a', 'b,c', 'say "hi"'], ['x\ny', null, 3]]), 'a,"b,c","say ""hi"""\n"x\ny",,3');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(daysBetween('2026-09-29', '2026-10-29'), 30);
});

import { parseCsv, parseDate, isAmbiguousDate } from '../web/js/csv.js';
test('CSV: quotes, commas inside quotes, CRLF, semicolons, BOM', () => {
  assert.deepEqual(parseCsv('﻿a,b\r\n"Hilux, 4x4","say ""hi"""\r\n'), [['a', 'b'], ['Hilux, 4x4', 'say "hi"']]);
  assert.deepEqual(parseCsv('a;b\n1;2\n\n'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('a,b\n"line\nbreak",x'), [['a', 'b'], ['line\nbreak', 'x']]);
});
test('dates people type into spreadsheets', () => {
  assert.equal(parseDate('2027-03-10').value, '2027-03-10');
  assert.equal(parseDate('3/10/2027').value, '2027-03-10');      // Excel PH: month first
  assert.equal(parseDate('25/3/2027').value, '2027-03-25');      // first number can only be a day
  assert.equal(parseDate('Mar 10, 2027').value, '2027-03-10');
  assert.equal(parseDate('10 March 2027').value, '2027-03-10');
  assert.equal(parseDate('').value, null);
  assert.ok(parseDate('2/30/2027').error);                        // no Feb 30
  assert.ok(parseDate('next week').error);
});

test('error reports: personal details and codes are removed before sending', async () => {
  const { scrub, routePattern } = await import('../web/js/errors.js');
  assert.equal(scrub('Failed for juan.dela-cruz+1@gmail.com'), 'Failed for [email]');
  assert.equal(scrub('call 0917 123 4567 or +639171234567'), 'call [phone] or [phone]');
  assert.equal(scrub('row 3f2a9c1e-1b2c-4d5e-8f90-123456789abc missing'), 'row :id missing');
  assert.equal(scrub('#/invite/abcDEF123xyz?x=1'), '#/invite/:code?x=1');
  assert.equal(scrub('share.html#/k9Lm2PqR'), 'share.html#/:code');
  assert.equal(scrub('?access_token=eyJabc.def&x=2'), '?access_token=:hidden&x=2');
  assert.equal(scrub('order 12345678 failed at line 42'), 'order # failed at line 42');
  assert.equal(scrub(null), '');
  assert.equal(routePattern('#/vehicles/3f2a9c1e-1b2c-4d5e-8f90-123456789abc?tab=docs'), '#/vehicles/:id');
  assert.equal(routePattern('#/businesses/b12'), '#/businesses/:id');
  assert.equal(routePattern(''), '#/');
});

test('2-year and 6-month rules (month ends are handled)', () => {
  assert.equal(suggestDue('years2', { issuedOn: '2026-03-15' }).date, '2028-03-15');
  assert.equal(suggestDue('years2', { issuedOn: '2024-02-29' }).date, '2026-02-28');
  assert.equal(suggestDue('years2', {}), null);
  assert.equal(suggestDue('months6', { issuedOn: '2026-01-15' }).date, '2026-07-15');
  assert.equal(suggestDue('months6', { issuedOn: '2026-08-31' }).date, '2027-02-28');
  assert.equal(suggestDue('months6', { issuedOn: '2026-12-01' }).date, '2027-06-01');
  assert.equal(suggestDue('months6', {}), null);
});

test('spreadsheet dates: day-first files and ambiguous dates', () => {
  assert.equal(parseDate('03/04/2027').value, '2027-03-04');
  assert.equal(parseDate('03/04/2027', { dayFirst: true }).value, '2027-04-03');
  assert.equal(parseDate('25/04/2027', { dayFirst: false }).value, '2027-04-25'); // 25 can only be a day
  assert.equal(parseDate('04/25/2027', { dayFirst: true }).value, '2027-04-25'); // 25 can only be a day
  assert.equal(parseDate('31/02/2027', { dayFirst: true }).error?.includes('not a real date'), true);
  assert.equal(isAmbiguousDate('03/04/2027'), true);
  assert.equal(isAmbiguousDate('04/04/2027'), false);
  assert.equal(isAmbiguousDate('13/04/2027'), false);
  assert.equal(isAmbiguousDate('2027-03-04'), false);
});

// ---------------------------------------------------------------- spreadsheet import checks
const { checkImport, permitTypeOf } = await import('../web/js/importer.js');
const TYPES = [
  { code: 'mayors_permit', name: "Mayor's / Business Permit", subject: 'business', expires: true, per_location: true },
  { code: 'bir_cor', name: 'BIR Certificate of Registration (Form 2303)', subject: 'business', expires: false, per_location: true },
  { code: 'fsic', name: 'Fire Safety Inspection Certificate (FSIC)', subject: 'business', expires: true, per_location: true },
  { code: 'lto_registration', name: 'LTO Registration (OR/CR)', subject: 'vehicle', expires: true, per_location: false },
  { code: 'ctpl', name: 'CTPL Insurance', subject: 'vehicle', expires: true, per_location: false },
  { code: 'drivers_license', name: "Driver's License", subject: 'person', expires: true, per_location: false },
  { code: 'nbi_clearance', name: 'NBI Clearance', subject: 'person', expires: true, per_location: false },
];
const CTX = {
  today: '2026-10-17', types: TYPES,
  businesses: [{ id: 'b1', name: 'Corner Bakery Corp.' }, { id: 'b2', name: 'Kape Uno' }],
  locations: [{ id: 'l1', business_id: 'b1', name: 'Main branch', city: 'Makati City', is_main: true }, { id: 'l2', business_id: 'b2', name: 'Main branch', city: 'Pasig', is_main: true },
    { id: 'l3', business_id: 'b2', name: 'Ortigas', city: 'Pasig City', is_main: false }],
  vehicles: [{ id: 'v1', make_model: 'Isuzu Elf', plate_no: 'NGV 5588' }],
  people: [{ id: 'p1', full_name: 'Juan dela Cruz' }],
  reqs: [{ id: 'r1', org_id: 'o1', subject: 'business', business_id: 'b1', location_id: 'l1', type_code: 'mayors_permit', name: "Mayor's / Business Permit", cycle_id: 'c1', expires_on: '2027-01-20', reference_no: 'BP-1' },
    { id: 'r2', org_id: 'o1', subject: 'vehicle', vehicle_id: 'v1', type_code: 'lto_registration', name: 'LTO Registration (OR/CR)', cycle_id: null }],
};

test('import: businesses are matched, guessed carefully, and duplicates skipped', () => {
  const res = checkImport('businesses', [['My Pinoy Permit list'], ['Business Name', 'Industry', 'Structure', 'City'],
    ['Lola Nena Bakeshop', 'Bakery', '', 'Quezon City'], ['Mabuhay Trading Inc.', 'Wholesale', '', ''], ['corner bakery corp.', '', 'Corp', ''],
    ['Lola Nena Bakeshop', '', '', ''], ['', 'Retail', '', ''], ['Odd Co', 'Space mining', 'Single', '']], CTX);
  assert.equal(res.headerRow, 2); // found under a title row
  const [a, b, c, d, e, f] = res.rows;
  assert.deepEqual([a.f.activity, a.f.structure, a.problems.length], ['restaurant', 'Sole Proprietorship', 0]);
  assert.ok(a.notes.some((n) => /blank: set to Sole Proprietorship/.test(n)));
  assert.equal(b.f.structure, 'Corporation'); // from "Inc." in the name, with a note saying so
  assert.equal(b.f.activity, 'retail');
  assert.ok(c.problems.includes('Already in Pinoy Permit')); // different capitals, same business
  assert.ok(d.problems.includes('This business appears twice in the file'));
  assert.ok(e.problems.includes('Business name is missing'));
  assert.equal(f.f.activity, 'other'); assert.ok(f.notes.some((n) => /Space mining/.test(n)));
});

test('import: branches need an existing business, and typos get a suggestion', () => {
  const res = checkImport('branches', [['Business name', 'Branch name', 'City'], ['Kape Uno', 'Alabang', 'Muntinlupa'], ['Kape Un0', 'BGC', 'Taguig'], ['Kape Uno', 'ortigas', '']], CTX);
  assert.equal(res.rows[0].problems.length, 0);
  assert.match(res.rows[1].problems[0], /Did you mean "Kape Uno"/);
  assert.ok(res.rows[2].problems.includes('This branch is already in Pinoy Permit'));
});

test('import: vehicles keep the old rules (plates, types, dates)', () => {
  const res = checkImport('vehicles', [['Make and model', 'Plate number', 'Type', 'Registration expires'], ['L300', 'abc-1234', 'mpv', '03/04/2027'], ['Elf', 'NGV5588', 'Truck', ''], ['Beat', 'XYZ 9', 'Spaceship', '31/02/2027']], CTX);
  assert.equal(res.ambiguous, true);
  assert.deepEqual([res.rows[0].f.vehicle_type, res.rows[0].f.registration_expires], ['Van', '2027-03-04']);
  assert.ok(res.rows[1].problems.includes('Already in Pinoy Permit')); // same plate without the space
  assert.equal(res.rows[2].problems.length, 2); // bad type and impossible date
  const dayFirst = checkImport('vehicles', [['Make and model', 'Registration expires'], ['L300', '03/04/2027']], CTX, { dayFirst: true });
  assert.equal(dayFirst.rows[0].f.registration_expires, '2027-04-03');
});

test('import: staff with licenses; existing staff are pointed to permit records', () => {
  const res = checkImport('staff', [['Full name', 'Position', 'Business', "Driver's license number", "Driver's license expires", 'NBI clearance expires'],
    ['Ana Reyes', 'Driver', 'Kape Uno', 'N01-23-456789', '2029-05-14', '2025-01-01'], ['juan  dela cruz', '', '', '', '', ''], ['Ben', '', 'Kape Uno Inc', '', '', '']], CTX);
  const [a, b, c] = res.rows;
  assert.deepEqual(a.f.licences.map((l) => l.type_code), ['drivers_license', 'nbi_clearance']);
  assert.equal(a.f.business_id, 'b2');
  assert.ok(a.notes.some((n) => /already expired/.test(n)));
  assert.match(b.problems[0], /Already in Pinoy Permit/);
  assert.match(c.notes[0], /not found, so not linked/);
});

test('import: permit records find the right thing and never overwrite newer data', () => {
  assert.equal(permitTypeOf('business permit', 'business', TYPES).code, 'mayors_permit');
  assert.equal(permitTypeOf('OR/CR', 'vehicle', TYPES).code, 'lto_registration');
  assert.equal(permitTypeOf('Fire', 'business', TYPES).code, 'fsic');
  const res = checkImport('permits', [['For', 'Branch', 'Permit', 'Reference', 'Issued on', 'Expires on'],
    ['Corner Bakery Corp.', '', 'Business permit', 'BP-2', '2026-10-10', '2028-01-20'],    // newer: a renewal
    ['Corner Bakery Corp.', '', "Mayor's permit", 'BP-0', '', '2026-01-20'],             // older than what we have
    ['NGV 5588', '', 'OR/CR', 'OR-9', '', '2027-04-30'],                                 // first record for a tracked permit
    ['Kape Uno', 'Ortigas', 'FSIC', 'F-1', '2026-11-01', '2026-10-01'],                  // expires before issued, issued in the future
    ['Kape Uno', 'Makati', 'FSIC', 'F-2', '', '2027-02-01'],                             // no such branch
    ['Juan dela Cruz', '', 'NBI', 'N-1', '', '2027-06-30'],                              // a staff license, added
    ['Corner Bakery Corp.', '', 'Pest control certificate', '', '', '2027-03-01'],      // not in the library: own permit
    ['Nobody Inc', '', 'Business permit', 'X', '', '2027-01-20'],
    ['Corner Bakery Corp.', '', "Mayor's / Business Permit", 'BP-1', '', '2027-01-20'],  // same as Pinoy Permit: skip
    ['Corner Bakery Corp.', '', 'BIR', 'COR-1', '2020-01-01', '2030-01-01']], CTX);
  const r = res.rows;
  assert.equal(r[0].f.action, 'renewal'); assert.equal(r[0].problems.length, 0);
  assert.match(r[1].problems[0], /Older than what Pinoy Permit has/);
  assert.equal(r[2].f.action, 'record');
  assert.ok(r[3].problems.includes('Expires before it was issued: check the two dates') && r[3].problems.includes('Issued in the future: check the date'));
  assert.match(r[4].problems[0], /No branch "Makati"/);
  assert.deepEqual([r[5].f.subject, r[5].f.type_code, r[5].f.action], ['person', 'nbi_clearance', 'add']);
  assert.equal(r[6].f.type_code, undefined); assert.ok(r[6].notes.some((n) => /added as your own permit/.test(n)));
  assert.match(r[7].problems[0], /No business, plate or staff member/);
  assert.equal(r[8].f.action, 'skip');
  assert.equal(r[9].f.expires_on, null); assert.ok(r[9].notes.some((n) => /doesn't expire/.test(n)));
});

test('import: clear messages for files that are not usable', () => {
  assert.match(checkImport('businesses', [], CTX).error, /empty/);
  assert.match(checkImport('businesses', [['Name of owner', 'Phone']], CTX).error, /couldn't find the "Business name" column/);
  assert.match(checkImport('branches', [['Business name', 'Branch name']], CTX).error, /no rows/);
  assert.match(checkImport('vehicles', [['Make and model'], ...Array.from({ length: 501 }, () => ['x'])], CTX).error, /up to 500/);
});

// ---------------------------------------------------------------- reading a photo of a permit
const { readDocument, findDates, findPlates, findReferences } = await import('../web/js/ocrparse.js');
test('photo text: dates in every common format, with misread letters', () => {
  const d = findDates('Issued on: January 12, 2O26\nValid until: 20 Jan 2027\nPrinted 2026-01-13\nDate 13/02/2026');
  const by = Object.fromEntries(d.map((x) => [x.value, x.role]));
  assert.equal(by['2026-01-12'], 'issued');
  assert.equal(by['2027-01-20'], 'expires');
  assert.ok('2026-01-13' in by && '2026-02-13' in by); // 13/02 can only be day first
  assert.equal(findDates('Feb 30, 2027 and 31/04/2026').length, 0); // impossible dates are ignored
});
test("photo text: a Mayor's Permit", () => {
  const text = `REPUBLIC OF THE PHILIPPINES\nCITY OF MAKATI\nBUSINESS PERMITS AND LICENSING OFFICE\nMAYOR'S PERMIT\nPermit No.: BP-2026-0442\nCORNER BAKERY CORP.\nDate Issued: January 15, 2026\nThis permit is valid until December 31, 2026`;
  const r = readDocument(text, '2026-03-01');
  assert.equal(r.kind, 'mayors_permit');
  assert.equal(r.expires[0].value, '2026-12-31');
  assert.equal(r.issued[0].value, '2026-01-15');
  assert.equal(r.references[0].value, 'BP-2026-0442');
});
test('photo text: an LTO OR/CR with a plate', () => {
  const text = `LAND TRANSPORTATION OFFICE\nOFFICIAL RECEIPT\nOR No. 1234567890\nPlate No. NGV 5588\nMV File No. 1301-00000123456\nValid Until: 08/21/2027`;
  const r = readDocument(text, '2026-10-17');
  assert.equal(r.plates[0].value, 'NGV 5588');
  assert.equal(r.kind, 'lto_registration');
  assert.equal(r.expires[0].value, '2027-08-21');
  assert.ok(r.references.some((x) => x.value === '1234567890'));
  assert.deepEqual(findPlates('PLATE 123 ABC motorcycle').map((p) => p.value), ['123 ABC']);
  assert.deepEqual(findPlates('TIN 123 and BIR 456').map((p) => p.value), []); // agency names are not plates
});
test('photo text: expiry before issue is treated as a misread', () => {
  const r = readDocument('Date issued: 2026-05-01\nValid until: 2026-04-01', '2026-06-01');
  assert.equal(r.expires.length, 0);
  assert.equal(findReferences('Permit No. 2026').length, 0); // a bare year is not a permit number
});

// ---------------------------------------------------------------- money (Admin > Money)
import { months, monthTotals, byMonth, change, pipeline, missingInvoices, filterLedger, ledgerCsv, niceTicks, aging, prevMonth } from '../web/js/money.js';

const L = [
  { day: '2026-10-03', stream: 'jobs', kind: 'service_fee', state: 'collected', amount: 3500, rush: 1000, label: "Mayor's Permit", who: 'Rosa Foods', ref_kind: 'order', ref_id: 'o1', invoice_no: null },
  { day: '2026-10-03', stream: 'jobs', kind: 'gov_fees_in', state: 'held', amount: 4200, rush: 0, label: "Mayor's Permit", who: 'Rosa Foods', ref_kind: 'order', ref_id: 'o1', invoice_no: null },
  { day: '2026-10-08', stream: 'jobs', kind: 'refund', state: 'collected', amount: -500, rush: 0, label: 'FSIC', who: 'Rosa Foods', ref_kind: 'order', ref_id: 'o2', invoice_no: null },
  { day: '2026-10-09', stream: 'care', kind: 'care_fee', state: 'collected', amount: 2300, rush: 0, label: 'Care bill C-1', who: 'Rosa Foods', ref_kind: 'care', ref_id: 'c1', invoice_no: 'INV-1' },
  { day: '2026-10-10', stream: 'care', kind: 'guarantee', state: 'cost', amount: -2000, rush: 0, label: 'Guarantee', who: 'Rosa Foods', ref_kind: 'claim', ref_id: 'g1', invoice_no: null },
  { day: '2026-09-20', stream: 'partners', kind: 'lead', state: 'collected', amount: 500, rush: 0, label: 'Lead', who: 'Runners', ref_kind: 'statement', ref_id: 's1', invoice_no: null },
  { day: '2026-09-20', stream: 'partners', kind: 'placement', state: 'collected', amount: 1500, rush: 0, label: 'Line', who: 'Runners', ref_kind: 'statement', ref_id: 's1', invoice_no: null },
  { day: '2026-09-01', stream: 'plans', kind: 'team_plan', state: 'collected', amount: 1490, rush: 0, label: 'Fleet', who: 'Fleet Co', ref_kind: 'plan', ref_id: 'p1', invoice_no: 'INV-2' },
  { day: '2026-10-15', stream: 'jobs', kind: 'service_fee', state: 'pipeline', amount: 2500, rush: 0, label: 'Quoted', who: 'Bea', ref_kind: 'order', ref_id: 'o3', invoice_no: null },
  { day: '2026-08-01', stream: 'partners', kind: 'lead', state: 'to_collect', amount: 300, rush: 0, label: 'Billed lead', who: 'Runners', ref_kind: 'statement', ref_id: 's2', invoice_no: null },
  { day: '2026-10-18', stream: 'partners', kind: 'lead', state: 'unbilled', amount: 300, rush: 0, label: 'New lead', who: 'Runners', ref_kind: 'partner', ref_id: 'x', invoice_no: null },
];

test('money: months run oldest first and cross the year', () => {
  assert.deepEqual(months('2026-02-10', 4), ['2025-11', '2025-12', '2026-01', '2026-02']);
  assert.equal(prevMonth('2026-01'), '2025-12');
});
test('money: a month adds collected money by stream, refunds taken off, payouts kept apart', () => {
  const m = monthTotals(L, '2026-10');
  assert.equal(m.by.jobs, 3000); // 3,500 fee - 500 refund (government money held is not revenue)
  assert.equal(m.by.care, 2300);
  assert.equal(m.total, 5300);
  assert.equal(m.costs, -2000);
  assert.equal(m.net, 3300);
  assert.equal(m.rush, 1000);
  assert.equal(monthTotals(L, '2026-09').by.partners, 2000);
  assert.equal(byMonth(L, '2026-10-19', 3).map((r) => r.total).join(','), '0,3490,5300');
  // A month in progress compares with the same days of the month before.
  assert.equal(monthTotals(L, '2026-09', 19).total, 1490);
  assert.equal(monthTotals(L, '2026-09', 20).total, 3490);
});
test('money: change is a whole percentage, or null when there is nothing to compare', () => {
  assert.equal(change(150, 100), 50);
  assert.equal(change(50, 100), -50);
  assert.equal(change(100, 0), null);
  assert.equal(change(0, 0), 0);
});
test('money: the pipeline puts each open peso in one lane, aged', () => {
  const p = pipeline(L, '2026-10-19');
  assert.equal(p.quoted.total, 2500);
  assert.equal(p.billed.total, 300);
  assert.equal(p.billed.ages['31+ days'], 300);
  assert.equal(p.unbilled.total, 300);
  assert.equal(p.unbilled.ages['0–15 days'], 300);
  assert.equal(aging('2026-10-03', '2026-10-19'), '16–30 days');
});
test('money: every payment without a BIR invoice number is listed once, with its full amount', () => {
  const miss = missingInvoices(L);
  const keys = miss.map((p) => `${p.ref_kind}:${p.ref_id}:${p.amount}`).sort();
  assert.deepEqual(keys, ['order:o1:7700', 'statement:s1:2000']); // fee + government fees in one payment; a statement's charges together
});
test('money: the ledger filters and exports with the invoice number column', () => {
  assert.equal(filterLedger(L, { stream: 'care' }).length, 2);
  assert.equal(filterLedger(L, { state: 'collected', month: '2026-09' }).length, 3);
  assert.equal(filterLedger(L, { q: 'inv-2' }).length, 1);
  const csv = ledgerCsv(filterLedger(L, { stream: 'plans' }));
  assert.equal(csv[0][8], 'BIR invoice no.');
  assert.equal(csv[1][8], 'INV-2');
  assert.equal(csv[1][6], '1490.00');
});
test('money: chart ticks are round numbers that cover the top', () => {
  assert.deepEqual(niceTicks(9800, 4), [0, 2500, 5000, 7500, 10000]);
  assert.deepEqual(niceTicks(0), [0]);
  const t = niceTicks(123456, 4);
  assert.ok(t[t.length - 1] >= 123456 && t.length <= 6);
});
test('csv: a name that looks like a formula stays text in Excel; numbers stay numbers', () => {
  assert.equal(toCsv([['=HYPERLINK("x")', '+1', '@cmd', '-2000', '-12.5', 'ok']]), `"'=HYPERLINK(""x"")",'+1,'@cmd,-2000,-12.5,ok`);
});

// Staff licenses and Plus: the same prices as the database (private.staff_monthly / private.addon_price,
// checked in supabase/tests/14_plus.sql), so the price on screen is the price charged.
import { staffMonthly, staffBands, addonPrice, addonLabel, FREE_PEOPLE } from '../web/js/prices.js';
test('prices: 3 people free, ₱100 to the 20th, ₱60 to the 100th, ₱40 after', () => {
  assert.equal(FREE_PEOPLE, 3);
  for (const [n, p] of [[0, 0], [3, 0], [4, 100], [20, 1700], [21, 1760], [25, 2000], [100, 6500], [101, 6540], [200, 10500]]) assert.equal(staffMonthly(n), p, `${n} people`);
  for (let n = 3; n < 600; n++) assert.ok(staffMonthly(n + 1) > staffMonthly(n), `one more than ${n} never costs less`);
  assert.deepEqual(staffBands(25).map((b) => [b.count, b.each, b.amount]), [[17, 100, 1700], [5, 60, 300]]);
});
test('prices: yearly is 10 months; Plus is ₱149 or ₱1,490 (supabase/tests/25_brief.sql checks the same)', () => {
  assert.equal(addonPrice('staff', 25, 'yearly'), 20000);
  assert.equal(addonPrice('plus', null, 'monthly'), 149);
  assert.equal(addonPrice('plus', null, 'yearly'), 1490);
  assert.equal(addonLabel('staff', 25, 'monthly'), 'Staff licenses, up to 25 people (monthly)');
  assert.equal(addonLabel('plus', null, 'yearly'), 'Pinoy Permit Plus (yearly)');
});
test('prices: White-label is ₱1,000 a month or ₱10,000 a year (supabase/tests/15_whitelabel.sql checks the same)', () => {
  assert.equal(addonPrice('brand', null, 'monthly'), 1000);
  assert.equal(addonPrice('brand', null, 'yearly'), 10000);
  assert.equal(addonLabel('brand', null, 'monthly'), 'White-label (monthly)');
});

test('Late Mayor\'s Permit: the most the Local Government Code allows', () => {
  assert.deepEqual(maxPenalty(10000, 3), { surcharge: 2500, interest: 750, total: 3250, months: 3 }); // 25%, then 2% a month on 12,500
  assert.equal(maxPenalty(10000, 0).total, 2500);                    // the surcharge applies from day one
  assert.equal(maxPenalty(10000, 50).months, 36);                    // interest stops after 36 months
  assert.equal(maxPenalty(10000, 2.2).months, 3);                    // part of a month counts as a month
  assert.equal(maxPenalty('', 3).total, 0);                          // nothing typed yet
  assert.equal(maxPenalty(-500, 3).total, 0);
});

test('Working days: weekends and holidays don\'t count, nor the day you filed', async () => {
  const { addWorkdays, workdaysBetween, filingDays } = await import('../web/js/workdays.js');
  assert.equal(addWorkdays('2027-01-07', 3), '2027-01-12');                       // Thursday + 3 = Tuesday
  const hol = new Set(['2026-12-24', '2026-12-25', '2026-12-30', '2026-12-31', '2027-01-01']);
  assert.equal(addWorkdays('2026-12-23', 3, hol), '2027-01-04');                  // the same as the database
  assert.equal(workdaysBetween('2027-01-12', '2027-01-14'), 2);
  assert.equal(workdaysBetween('2027-01-14', '2027-01-12'), 0);
  assert.equal(filingDays('simple'), 3);
  assert.equal(filingDays('complex', null, true, 1), 15);                          // extended once, plus a day closed
  assert.equal(filingDays('charter', 2), 2);
});

test('Reading a city bill: the total, its number and the pay-by date', async () => {
  const { readBill } = await import('../web/js/ocrparse.js');
  const bill = `CITY TREASURER'S OFFICE
STATEMENT OF ACCOUNT  SOA No.: 2027-0145521
Business Tax 2027 ........ 11,820.00
Mayor's Permit Fee ......... 1,500.00
Garbage Fee .................. 910.50
TOTAL AMOUNT DUE   P 14,230.50
Pay on or before: January 20, 2027`;
  const r = readBill(bill, '2027-01-08');
  assert.equal(r.amounts[0], 14230.5);
  assert.equal(r.ref, '2027-0145521');
  assert.equal(r.payBy, '2027-01-20');
  const plain = readBill('Fees: 650.00\nOther 120.00', '2027-01-08');
  assert.equal(plain.amounts[0], 650);                                              // no total: the biggest figure
  assert.equal(plain.ref, null);
  assert.equal(readBill('', '2027-01-08').amounts.length, 0);
});

test('City spellings match the database: QC, Q.C. and Quezon City are one city', async () => {
  const { cityKey } = await import('../web/js/citydates.js');
  assert.equal(cityKey('QC'), 'quezon');
  assert.equal(cityKey('Q.C.'), 'quezon');
  assert.equal(cityKey('Quezon City, Metro Manila'), 'quezon');
  assert.equal(cityKey('City of Manila'), 'manila');
  assert.equal(cityKey('  MANILA CITY '), 'manila');
  assert.equal(cityKey('Las Piñas City'), 'las pinas');
  assert.equal(cityKey('Parañaque'), 'paranaque');
  assert.equal(cityKey('Lapu-Lapu City'), 'lapu lapu');
  assert.equal(cityKey('Municipality of Taytay'), 'taytay');
  assert.equal(cityKey(''), '');
});

test('A city extension applies to its business permits still due earlier that year', async () => {
  const { extensionFor, anniversaryDue } = await import('../web/js/citydates.js');
  const d = { id: 'd1', city_key: 'manila', permit_year: 2027, due_on: '2027-02-13' };
  const mp = { type_code: 'mayors_permit', expires: true, expires_on: '2027-01-20' };
  assert.equal(extensionFor(mp, 'Manila City', [d]), d);
  assert.equal(extensionFor(mp, 'Makati', [d]), null);                                     // another city
  assert.equal(extensionFor({ ...mp, expires_on: '2027-02-13' }, 'Manila', [d]), null);     // already moved
  assert.equal(extensionFor({ ...mp, expires_on: '2026-01-20' }, 'Manila', [d]), null);     // another year
  assert.equal(extensionFor({ ...mp, type_code: 'fsic' }, 'Manila', [d]), null);            // only business permits
  const qc = { rule: 'anniversary' };
  assert.equal(anniversaryDue({ ...mp, issued_on: '2026-03-15' }, qc), '2027-03-15');      // QC: a year from the issue date
  assert.equal(anniversaryDue({ ...mp, issued_on: '2026-01-20' }, qc), null);              // already right
  assert.equal(anniversaryDue({ ...mp, expires_on: '2027-03-01', issued_on: '2026-03-15' }, qc), null); // a date they typed: leave it
  assert.equal(anniversaryDue({ ...mp, issued_on: '2024-02-29' }, qc), '2025-02-28');      // leap day
});

test('Due-date suggestion knows the city: Quezon City\'s rule and announced extensions', () => {
  const qc = { rule: 'anniversary', note: 'QC note' };
  assert.deepEqual(suggestDue('jan20', { issuedOn: '2026-03-15', cityRule: qc }), { date: '2027-03-15', note: 'QC note' });
  assert.equal(suggestDue('jan20', { cityRule: qc }), null);                                // no issue date, no guess
  const ext = [{ city_name: 'Manila', permit_year: 2027, due_on: '2027-02-13' }];
  assert.equal(suggestDue('jan20', { issuedOn: '2026-01-15', cityExtensions: ext }).date, '2027-02-13');
  assert.equal(suggestDue('jan20', { issuedOn: '2025-01-15', cityExtensions: ext }).date, '2026-01-20'); // another year
});

test('Renewal packet: the year, what carries over, and only the questions still open', async () => {
  const { packetYear, startAnswers, openSteps, missingDetails, appDetails, filledCount } = await import('../web/js/packet.js');
  assert.equal(packetYear('2027-01-20', '2026-10-22'), 2027);
  assert.equal(packetYear('2026-01-20', '2026-10-22'), 2026);      // renewing late
  assert.equal(packetYear('2024-01-20', '2026-10-22'), 2026);      // long expired: this year's
  assert.equal(packetYear(null, '2026-10-22'), null);
  const prev = { sales: 1500000, employees: 6, changed: 'no', owner_name: 'Ana', line: 'Bakery', area_sqm: 40, place: 'owned' };
  const a = startAnswers(prev, {});
  assert.equal(a.sales, undefined);                                // sales and headcount are asked fresh
  assert.equal(a.employees, undefined);
  assert.equal(a.line, 'Bakery');
  const known = { tin: '123', address: '5 Rizal St', owner_name: 'Ana', line: 'Bakery', reg_no: 'DTI 1', phone: '0917' };
  assert.deepEqual(openSteps(known, a), ['sales', 'employees', 'changed']);
  assert.deepEqual(openSteps({ ...known, tin: '' }, a), ['sales', 'employees', 'changed', 'details']);
  assert.deepEqual(missingDetails({ ...known, tin: '' }, { ...a, place: 'rented' }), ['tin', 'lessor']);
  assert.deepEqual(openSteps(known, { ...a, sales: 1, employees: 2, changed: 'no' }), []);
  assert.equal(openSteps(known, { ...a, sales: 1, employees: 2, changed: 'no' }, true).length, 4); // changing answers: all of them
  const parts = appDetails({ year: 2027, biz: { name: 'Ana Bakery', structure: 'Sole Proprietorship' }, address: '5 Rizal St, Manila', email: 'a@b.ph', known,
    a: { ...a, sales: 1842600, employees: 7 }, permit: {} });
  const rows = parts.flatMap((p) => p.rows);
  assert.equal(rows.find((r) => r[0] === 'Gross sales or receipts, 2026')[1], 'PHP 1,842,600.00');
  assert.deepEqual(filledCount(parts), { filled: 13, total: 13 });
  assert.equal(filledCount(appDetails({ year: 2027, biz: { name: 'X', structure: 'Corporation' }, address: '', email: '', known: { ...known, tin: '' }, a: {}, permit: {} })).filled < 13, true);
});

test('Reading sales from a tax return photo', async () => {
  const { readSales } = await import('../web/js/ocrparse.js');
  const itr = `BIR Form No. 1701
For the year 2026
Part IV
Sales/Revenues/Receipts/Fees      1,842,600.00
Less: Cost of Sales                 912,300.00
Gross Income                        930,300.00`;
  const r = readSales(itr);
  assert.equal(r.amounts[0], 1842600);
  assert.equal(r.amounts.includes(2026), false);                   // a year is not money
  assert.equal(readSales('Total Gross Sales/Receipts 450,000').amounts[0], 450000);
  assert.equal(readSales('').amounts.length, 0);
});
