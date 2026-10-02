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

import { parseCsv, parseDate } from '../web/js/csv.js';
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
