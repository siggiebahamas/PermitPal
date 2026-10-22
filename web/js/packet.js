// The renewal packet's arithmetic, kept apart from the screens so it can be tested: which year it is for, what
// carries over from last year, which questions are still open, and the application details in the order of the
// Unified Business Application Form (the form most cities use, from the DTI-DILG-DICT joint circular).

// The year the renewal is for: the year the permit runs out, or this year when it ran out in an earlier one.
export function packetYear(expiresOn, today) {
  if (!expiresOn) return null;
  const y = Number(expiresOn.slice(0, 4));
  return expiresOn < today ? Math.max(y, Number(today.slice(0, 4))) : y;
}

// What stays true from one year to the next. Sales, headcount and "anything changed" are asked fresh.
export const CARRY = ['owner_name', 'owner_title', 'owner_address', 'line', 'area_sqm', 'place', 'lessor', 'rent', 'phone', 'reg_no', 'pay_mode'];
export function startAnswers(prev = {}, cur = {}) {
  const a = {};
  for (const k of CARRY) if (prev[k] != null && prev[k] !== '') a[k] = prev[k];
  return { ...a, ...cur };
}

// The details the city's form asks for that PermitPal can't fill in yet. known: { tin, address, owner_name, line, phone, reg_no }
// from the records (or this year's answers); a: the answers.
export function missingDetails(known, a) {
  const miss = [];
  if (!known.tin) miss.push('tin');
  if (!known.address) miss.push('address');
  if (!known.owner_name) miss.push('owner_name');
  if (!known.line) miss.push('line');
  if (!known.reg_no) miss.push('reg_no');
  if (!known.phone) miss.push('phone');
  if (a.area_sqm == null) miss.push('area_sqm');
  if (!a.place) miss.push('place');
  if (a.place === 'rented' && !a.lessor) miss.push('lessor');
  return miss;
}

// The questions still open, in order. all = going through every one again ("Change answers").
export function openSteps(known, a, all = false) {
  const steps = [];
  if (all || a.sales == null) steps.push('sales');
  if (all || a.employees == null) steps.push('employees');
  if (all || !a.changed) steps.push('changed');
  if (all || missingDetails(known, a).length) steps.push('details');
  return steps;
}

const PAY = { annual: 'Annually', semi: 'Semi-annually', quarterly: 'Quarterly' };
const STRUCTURE = { 'Sole Proprietorship': 'Single (sole proprietorship)', Partnership: 'Partnership', Corporation: 'Corporation', Cooperative: 'Cooperative', Other: 'Other' };
const num = (n) => (n == null || n === '' ? '' : Number(n).toLocaleString('en-PH', { maximumFractionDigits: 2 }));
const money = (n) => (n == null || n === '' ? '' : 'PHP ' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

// The application details, part by part. Each row: [label, value, counts] (counts = the city expects it filled in).
// Rows with an empty value print as a blank line to fill in by hand.
export function appDetails({ year, biz, address, email, known, a, permit }) {
  const rented = a.place === 'rented';
  return [
    { part: 'Basic information', rows: [
      ['Type of application', 'Renewal', false],
      ['Mode of payment', PAY[a.pay_mode || 'annual'], false],
      ['TIN', known.tin, true],
      ['DTI, SEC or CDA registration no.', known.reg_no, true],
      ['Type of business', STRUCTURE[biz.structure] || biz.structure, true],
      ['Name of owner (or president)', known.owner_name, true],
      ['Business name', biz.name, true],
      ['Trade name or franchise', '', false],
    ] },
    { part: 'Other information', rows: [
      ['Business address', address, true],
      ['Phone or mobile', known.phone, true],
      ['Email', email, true],
      ["Owner's address", a.owner_address || '', false],
      ['Business area (sq m)', num(a.area_sqm), true],
      ['Total employees', num(a.employees), true],
      ['Employees living in the city', num(a.employees_local), false],
      ['Place of business', a.place ? (rented ? 'Rented' : 'Owned') : '', true],
      ...(rented ? [["Lessor's name", a.lessor || '', true], ['Monthly rental', money(a.rent), false]] : []),
    ] },
    { part: 'Business activity', rows: [
      ['Line of business', known.line, true],
      [`Gross sales or receipts, ${year - 1}`, money(a.sales), true],
    ] },
    { part: 'Your current permit', rows: [
      ['Permit no.', permit.reference_no || '', false],
      ['Issued on', permit.issued_on || '', false],
      ['Valid until', permit.expires_on || '', false],
    ] },
  ];
}
export function filledCount(parts) {
  const rows = parts.flatMap((p) => p.rows).filter((r) => r[2]);
  return { filled: rows.filter((r) => r[1] != null && String(r[1]).trim() !== '').length, total: rows.length };
}
