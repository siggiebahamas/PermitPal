// Pure-logic tests: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plateSchedule, suggestDue } from '../web/js/rules.js';
import { html, esc, raw, normalizePhone, toCsv, addDays, daysBetween } from '../web/js/util.js';

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
  const res = checkImport('businesses', [['My PermitPal list'], ['Business Name', 'Industry', 'Structure', 'City'],
    ['Lola Nena Bakeshop', 'Bakery', '', 'Quezon City'], ['Mabuhay Trading Inc.', 'Wholesale', '', ''], ['corner bakery corp.', '', 'Corp', ''],
    ['Lola Nena Bakeshop', '', '', ''], ['', 'Retail', '', ''], ['Odd Co', 'Space mining', 'Single', '']], CTX);
  assert.equal(res.headerRow, 2); // found under a title row
  const [a, b, c, d, e, f] = res.rows;
  assert.deepEqual([a.f.activity, a.f.structure, a.problems.length], ['restaurant', 'Sole Proprietorship', 0]);
  assert.ok(a.notes.some((n) => /blank: set to Sole Proprietorship/.test(n)));
  assert.equal(b.f.structure, 'Corporation'); // from "Inc." in the name, with a note saying so
  assert.equal(b.f.activity, 'retail');
  assert.ok(c.problems.includes('Already in PermitPal')); // different capitals, same business
  assert.ok(d.problems.includes('This business appears twice in the file'));
  assert.ok(e.problems.includes('Business name is missing'));
  assert.equal(f.f.activity, 'other'); assert.ok(f.notes.some((n) => /Space mining/.test(n)));
});

test('import: branches need an existing business, and typos get a suggestion', () => {
  const res = checkImport('branches', [['Business name', 'Branch name', 'City'], ['Kape Uno', 'Alabang', 'Muntinlupa'], ['Kape Un0', 'BGC', 'Taguig'], ['Kape Uno', 'ortigas', '']], CTX);
  assert.equal(res.rows[0].problems.length, 0);
  assert.match(res.rows[1].problems[0], /Did you mean "Kape Uno"/);
  assert.ok(res.rows[2].problems.includes('This branch is already in PermitPal'));
});

test('import: vehicles keep the old rules (plates, types, dates)', () => {
  const res = checkImport('vehicles', [['Make and model', 'Plate number', 'Type', 'Registration expires'], ['L300', 'abc-1234', 'mpv', '03/04/2027'], ['Elf', 'NGV5588', 'Truck', ''], ['Beat', 'XYZ 9', 'Spaceship', '31/02/2027']], CTX);
  assert.equal(res.ambiguous, true);
  assert.deepEqual([res.rows[0].f.vehicle_type, res.rows[0].f.registration_expires], ['Van', '2027-03-04']);
  assert.ok(res.rows[1].problems.includes('Already in PermitPal')); // same plate without the space
  assert.equal(res.rows[2].problems.length, 2); // bad type and impossible date
  const dayFirst = checkImport('vehicles', [['Make and model', 'Registration expires'], ['L300', '03/04/2027']], CTX, { dayFirst: true });
  assert.equal(dayFirst.rows[0].f.registration_expires, '2027-04-03');
});

test('import: staff with licences; existing staff are pointed to permit records', () => {
  const res = checkImport('staff', [['Full name', 'Position', 'Business', "Driver's license number", "Driver's license expires", 'NBI clearance expires'],
    ['Ana Reyes', 'Driver', 'Kape Uno', 'N01-23-456789', '2029-05-14', '2025-01-01'], ['juan  dela cruz', '', '', '', '', ''], ['Ben', '', 'Kape Uno Inc', '', '', '']], CTX);
  const [a, b, c] = res.rows;
  assert.deepEqual(a.f.licences.map((l) => l.type_code), ['drivers_license', 'nbi_clearance']);
  assert.equal(a.f.business_id, 'b2');
  assert.ok(a.notes.some((n) => /already expired/.test(n)));
  assert.match(b.problems[0], /Already in PermitPal/);
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
    ['Juan dela Cruz', '', 'NBI', 'N-1', '', '2027-06-30'],                              // a staff licence, added
    ['Corner Bakery Corp.', '', 'Pest control certificate', '', '', '2027-03-01'],      // not in the library: own permit
    ['Nobody Inc', '', 'Business permit', 'X', '', '2027-01-20'],
    ['Corner Bakery Corp.', '', "Mayor's / Business Permit", 'BP-1', '', '2027-01-20'],  // same as PermitPal: skip
    ['Corner Bakery Corp.', '', 'BIR', 'COR-1', '2020-01-01', '2030-01-01']], CTX);
  const r = res.rows;
  assert.equal(r[0].f.action, 'renewal'); assert.equal(r[0].problems.length, 0);
  assert.match(r[1].problems[0], /Older than what PermitPal has/);
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
