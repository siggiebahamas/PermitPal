// Money: turns the staff ledger (one row per peso line, from admin_money) into the five views in
// Admin > Money. Kept free of the page so the sums can be tested on their own.
// States: collected (ours, in the bank), to_collect (billed or accepted, not paid), pipeline (quoted,
// not accepted), unbilled (firms owe it, no statement yet), held (government money we hold for
// customers: never revenue), cost (guarantee payouts), to_pay (approved payouts not sent yet).
export const STREAMS = {
  jobs: { name: 'One-time jobs', color: '#2a78d6', note: 'Renewals, packages, set-ups and walk-throughs: our fee and rush fees' },
  care: { name: 'Year-round care', color: '#eb6834', note: 'Monthly and yearly care bills' },
  partners: { name: 'Fees from firms', color: '#1baf7a', note: 'Quote requests, sales, listings and checklist lines' },
  plans: { name: 'Team plans', color: '#eda100', note: 'Fleet, accounting firm, head office and property plans' },
};
export const STREAM_KEYS = Object.keys(STREAMS);
export const KIND_NAMES = {
  service_fee: 'Service fee', gov_fees_in: 'Government fees received', gov_fees_out: 'Government fees paid', refund: 'Refund',
  care_fee: 'Care bill', guarantee: 'Guarantee payout', lead: 'Quote request fee', sale: 'Sale fee', placement: 'Checklist line',
  listing: 'Monthly listing', other: 'Other charge', team_plan: 'Team plan',
};
export const STATE_NAMES = {
  collected: 'Collected', to_collect: 'To collect', pipeline: 'Quoted', unbilled: 'Not billed yet', held: 'Held for government fees',
  cost: 'Paid out', to_pay: 'To pay out',
};

const num = (v) => Number(v) || 0;
export const monthOf = (day) => String(day || '').slice(0, 7);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthLabel = (m, long = false) => { const [y, mo] = m.split('-').map(Number); return `${MON[mo - 1]}${long ? ' ' + y : ` '${String(y).slice(2)}`}`; };

// The last n months up to and including today's, oldest first: ['2025-11', ..., '2026-10'].
export function months(today, n = 12) {
  const [y, m] = today.split('-').map(Number);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const k = (y * 12 + (m - 1)) - i;
    out.push(`${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, '0')}`);
  }
  return out;
}
export const prevMonth = (m) => months(`${m}-01`, 2)[0];
export const firstOfRange = (today, n = 12) => `${months(today, n)[0]}-01`;

// Money in, per stream, for one month (refunds already negative). Costs are kept apart.
// throughDay (1-31) counts only the first days of the month, to compare a month in progress fairly.
export function monthTotals(lines, month, throughDay = 31) {
  const by = Object.fromEntries(STREAM_KEYS.map((k) => [k, 0]));
  let costs = 0, rush = 0, payments = 0;
  for (const l of lines) {
    if (monthOf(l.day) !== month || Number(String(l.day).slice(8, 10)) > throughDay) continue;
    if (l.state === 'collected') { by[l.stream] = (by[l.stream] || 0) + num(l.amount); rush += num(l.rush); if (num(l.amount) > 0) payments++; }
    else if (l.state === 'cost') costs += num(l.amount); // negative
  }
  const total = STREAM_KEYS.reduce((t, k) => t + by[k], 0);
  return { by, total, costs, net: total + costs, rush, payments };
}

export function byMonth(lines, today, n = 12) {
  return months(today, n).map((m) => ({ month: m, ...monthTotals(lines, m) }));
}

// Percentage change, or null when there's nothing to compare with.
export function change(cur, prev) {
  if (!prev) return cur ? null : 0;
  return Math.round(((cur - prev) / Math.abs(prev)) * 100);
}

export function aging(day, today) {
  const d = Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(String(day).slice(0, 10) + 'T00:00:00Z')) / 864e5);
  return d <= 15 ? '0–15 days' : d <= 30 ? '16–30 days' : '31+ days';
}
export const AGES = ['0–15 days', '16–30 days', '31+ days'];

// Money not in yet, by lane, with how long each item has been waiting.
export function pipeline(lines, today) {
  const lane = (pred) => {
    const items = lines.filter(pred).sort((a, b) => String(a.day).localeCompare(String(b.day)));
    const ages = Object.fromEntries(AGES.map((a) => [a, 0]));
    for (const l of items) ages[aging(l.day, today)] += num(l.amount);
    return { items, total: items.reduce((t, l) => t + num(l.amount), 0), ages };
  };
  return {
    quoted: lane((l) => l.state === 'pipeline'),
    accepted: lane((l) => l.state === 'to_collect' && l.stream === 'jobs'),
    careDue: lane((l) => l.state === 'to_collect' && l.stream === 'care'),
    billed: lane((l) => l.state === 'to_collect' && l.stream === 'partners'),
    unbilled: lane((l) => l.state === 'unbilled'),
    toPay: lane((l) => l.state === 'to_pay'),
  };
}

// Every payment received should have a BIR invoice number. One row per payment (an order, a care bill,
// a partner statement or a team plan payment), newest first.
export function missingInvoices(lines) {
  const pay = new Map();
  for (const l of lines) {
    const counts = (l.state === 'collected' && num(l.amount) > 0 && ['service_fee', 'care_fee', 'team_plan', 'lead', 'sale', 'placement', 'listing', 'other'].includes(l.kind))
      || (l.state === 'held' && l.kind === 'gov_fees_in');
    if (!counts || !['order', 'care', 'statement', 'plan'].includes(l.ref_kind)) continue;
    const key = `${l.ref_kind}:${l.ref_id}`;
    const p = pay.get(key) || { ref_kind: l.ref_kind, ref_id: l.ref_id, day: l.day, who: l.who, label: l.label, amount: 0, invoice_no: null };
    p.amount += num(l.amount);
    if (l.invoice_no) p.invoice_no = l.invoice_no;
    if (String(l.day) > String(p.day)) p.day = l.day;
    if (l.ref_kind === 'statement') p.label = 'Statement to ' + l.who;
    pay.set(key, p);
  }
  return [...pay.values()].filter((p) => !p.invoice_no).sort((a, b) => String(b.day).localeCompare(String(a.day)));
}

// The ledger, filtered the way the page asks.
export function filterLedger(lines, { stream = 'all', state = 'all', month = 'all', q = '' } = {}) {
  const needle = q.trim().toLowerCase();
  return lines.filter((l) => (stream === 'all' || l.stream === stream) && (state === 'all' || l.state === state)
    && (month === 'all' || monthOf(l.day) === month)
    && (!needle || `${l.label} ${l.who} ${l.invoice_no || ''} ${KIND_NAMES[l.kind] || l.kind}`.toLowerCase().includes(needle)));
}

export function ledgerCsv(lines) {
  return [['Date', 'Stream', 'What', 'Status', 'Customer or firm', 'Description', 'Amount (PHP)', 'Rush fee part (PHP)', 'BIR invoice no.'],
    ...lines.map((l) => [l.day, STREAMS[l.stream]?.name || l.stream, KIND_NAMES[l.kind] || l.kind, STATE_NAMES[l.state] || l.state, l.who || '',
      l.label || '', num(l.amount).toFixed(2), num(l.rush) ? num(l.rush).toFixed(2) : '', l.invoice_no || ''])];
}

// Round numbers for chart ticks: 0, 5K, 10K... (at most `count` steps).
export function niceTicks(max, count = 4) {
  if (!(max > 0)) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw);
  const out = [];
  for (let v = 0; v <= max + step * 0.001 || out.length < 2; v += step) out.push(Math.round(v));
  if (out[out.length - 1] < max) out.push(Math.round(out[out.length - 1] + step));
  return out;
}
export const compact = (n) => (Math.abs(n) >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `${+(n / 1e3).toFixed(1)}K` : String(Math.round(n)));
