// Admin > Money: every peso across the three ways PermitPal earns (plus team plans), five ways to look at it.
//   Today      what needs you now, and payments still missing a BIR invoice number
//   This month what came in, by stream, against last month and your goal
//   Trend      the last 12 months, stacked by stream (with the numbers in a table)
//   Pipeline   money not in yet: quoted, accepted, billed, not billed, and how long it has waited
//   Ledger     every line, filterable, with a CSV for your bookkeeper
import { html, fmtDate, peso, toast, toastError, when, plural, todayPH, download, toCsv } from '../util.js';
import { on, rerender } from '../core.js';
import { STREAMS, STREAM_KEYS, KIND_NAMES, STATE_NAMES, byMonth, monthTotals, months, monthLabel, prevMonth, change, pipeline, missingInvoices,
  filterLedger, ledgerCsv, niceTicks, compact, firstOfRange, AGES, monthOf } from '../money.js';
import * as db from 'pp/data';

export const MONEY_VIEWS = [['today', 'Today'], ['month', 'This month'], ['trend', 'Trend'], ['pipeline', 'Pipeline'], ['ledger', 'Ledger']];
const st = { view: 'today', month: null, ledger: { stream: 'all', state: 'all', month: 'all', q: '' } };
let data = null; // { lines, summary, today }

export async function moneyTab(goTab) {
  const today = todayPH();
  const [lines, summary] = await Promise.all([db.adminMoney(firstOfRange(today, 13), today), db.adminMoneySummary()]);
  data = { lines, summary, today };
  st.month ||= monthOf(today);
  gotoTab = goTab;
  const body = { today: todayView, month: monthView, trend: trendView, pipeline: pipelineView, ledger: ledgerView }[st.view] || todayView;
  return html`<div class="money">
    <div class="seg" role="tablist" aria-label="How to look at the money">${MONEY_VIEWS.map(([k, l]) => html`<button role="tab" aria-selected="${st.view === k}" class="seg-btn ${st.view === k ? 'on' : ''}" data-act="money-view" data-v="${k}">${l}</button>`)}</div>
    ${body()}</div>`;
}
let gotoTab = null;
on('money-view', (ds) => { st.view = ds.v; rerender(); });
on('money-go', (ds) => (ds.view ? (st.view = ds.view, rerender()) : gotoTab?.(ds.tab)));

const streamDot = (k) => html`<span class="dot" style="background:${STREAMS[k].color}" aria-hidden="true"></span>`;
const pct = (n) => (n == null ? 'new' : `${n > 0 ? '+' : ''}${n}%`);

// ---------------------------------------------------------------- 1. Today
function todayView() {
  const s = data.summary;
  const items = [
    [s.quotes_to_send, 'Quotes to send', s.care_to_quote ? `${s.care_to_quote} of them ${s.care_to_quote === 1 ? 'is a care renewal' : 'are care renewals'} (government fees only). Reply within 1 business day.` : 'Customers are waiting for a price. Reply within 1 business day.', 'orders'],
    [s.order_payments_to_check + s.care_payments_to_check, 'Payments to confirm', `${s.order_payments_to_check} on orders, ${s.care_payments_to_check} on care bills. Find each one in your GCash or bank app first.`, s.order_payments_to_check ? 'orders' : 'care'],
    [s.claims_to_decide, 'Guarantee claims to decide', 'Customers are told to expect an answer within 5 business days.', 'care'],
    [s.claims_to_pay, 'Approved claims to pay out', 'Send the money, then mark each one paid.', 'care'],
    [s.care_overdue, 'Care bills overdue', 'Plans pause 7 days after coverage runs out. A quick message often fixes it.', 'care'],
    [s.partners_to_bill, 'Firms to bill for last month', 'Make each firm\'s statement: it adds up every quote request, sale and listing not billed yet.', 'billing'],
    [s.statements_overdue, 'Statements overdue', 'Firms that haven\'t paid by the due date.', 'billing'],
    [s.applications_new, 'Firms asking to be listed', 'Check their business permit and licence before listing them.', 'partners'],
    [s.covered_missing_dates, 'Covered permits without an expiry date', 'Care can\'t start these renewals until the date is known. Ask the customer, or add it while you have access.', 'care'],
    [s.gov_unrecorded, 'Finished jobs without the government fees paid', 'Record what you actually paid, so the money you hold for customers is right (and refund any difference).', 'orders'],
    [s.missing_invoice, 'Payments without a BIR invoice number', 'Every sale needs an official invoice. Issue it from your registered invoices and type its number below.', null],
  ].filter(([n]) => n > 0);
  const miss = missingInvoices(data.lines);
  const m = monthTotals(data.lines, monthOf(data.today));
  return html`
    <p class="money-line">Collected this month: <b>${peso(m.total)}</b>${s.goal ? html` of your ${peso(s.goal)} goal` : ''} · recurring <b>${peso(Number(s.mrr_care) + Number(s.mrr_plans))}</b>/month
      <button class="linklike" data-act="money-view" data-v="month">Details</button></p>
    <section class="card"><div class="card-head"><div><h2>What needs you</h2><p class="card-sub">Most urgent first. Each one opens the right place.</p></div></div>
      ${items.length ? items.map(([n, t, d, tab]) => html`<div class="row todo"><div class="row-main"><div class="row-title"><span class="todo-n">${n}</span> ${t}</div><div class="row-sub">${d}</div></div>
        <div class="row-side">${tab ? html`<button class="btn btn-sm btn-soft" data-act="money-go" data-tab="${tab}">Open</button>` : html`<a class="btn btn-sm btn-soft" href="#money-invoices">Below</a>`}</div></div>`)
        : html`<div class="all-good">Nothing needs you right now.</div>`}
      ${when(Number(s.staff_access_open), html`<p class="muted small">You still have temporary access to ${plural(Number(s.staff_access_open), 'customer workspace')} for set-up jobs. It ends when each job is marked done.</p>`)}
    </section>
    <section class="card" id="money-invoices"><div class="card-head"><div><h2>Payments without an invoice number</h2>
      <p class="card-sub">The BIR requires an invoice for every sale. After you issue it, type its number here: the ledger and your CSV keep it.</p></div></div>
      ${miss.length ? html`<div class="table-wrap" tabindex="0" role="region" aria-label="Payments without an invoice number"><table class="table"><thead><tr><th>Paid</th><th>From</th><th>For</th><th>Amount</th><th>Invoice no.</th></tr></thead><tbody>
        ${miss.slice(0, 50).map((p) => html`<tr><td>${fmtDate(p.day)}</td><td>${p.who}</td><td>${p.label}</td><td>${peso(p.amount)}</td>
          <td><form class="inline-form inv-form" data-kind="${p.ref_kind}" data-id="${p.ref_id}"><input name="no" maxlength="60" required aria-label="BIR invoice number for ${p.who}" placeholder="e.g. 0001234"><button class="btn btn-sm btn-soft">Save</button></form></td></tr>`)}
      </tbody></table></div>${when(miss.length > 50, html`<p class="muted small">${miss.length - 50} more in the Ledger.</p>`)}`
      : html`<p class="muted">Every payment has its invoice number.</p>`}
    </section>
    <section class="card"><h2>Settings</h2>
      <form class="grid2 money-settings">
        <label class="field"><span>Monthly goal (₱) <small>(only you see it)</small></span><input name="goal" type="number" min="0" step="1000" value="${s.goal ?? ''}"></label>
        <label class="field"><span>Insurance Commission licence no. <small>(if you are licensed)</small></span><input name="ic" maxlength="60" value="${s.ic_licence_no || ''}" placeholder="Leave empty if not licensed"></label>
        <div><button class="btn btn-sm btn-soft">Save</button></div>
      </form>
      <p class="muted small">Without an Insurance Commission licence, insurers can only pay you a flat listing fee, never per quote request or per sale (Insurance Code, Sec. 307). The app enforces this.</p>
    </section>`;
}

// ---------------------------------------------------------------- 2. This month
function monthView() {
  const ms = months(data.today, 12);
  const m = st.month;
  // A month in progress is compared with the same days of the month before.
  const upTo = m === monthOf(data.today) ? Number(data.today.slice(8, 10)) : 31;
  const cur = monthTotals(data.lines, m), prev = monthTotals(data.lines, prevMonth(m), upTo);
  const vs = upTo < 31 ? `the same days of ${monthLabel(prevMonth(m), true)} (1–${upTo})` : monthLabel(prevMonth(m), true);
  const s = data.summary;
  const goal = Number(s.goal) || 0;
  const who = new Map();
  for (const l of data.lines) if (l.state === 'collected' && monthOf(l.day) === m) who.set(l.who, (who.get(l.who) || 0) + Number(l.amount));
  const top = [...who.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  return html`
    <div class="filters"><label class="field inline"><span>Month</span><select data-money-month>${ms.slice().reverse().map((x) => html`<option value="${x}" ${x === m ? 'selected' : ''}>${monthLabel(x, true)}</option>`)}</select></label></div>
    <section class="card money-hero">
      <div><div class="muted small">Collected in ${monthLabel(m, true)}</div><div class="hero-n">${peso(cur.total)}</div>
        <div class="muted small">${pct(change(cur.total, prev.total))} vs ${vs}: ${peso(prev.total)} · ${plural(cur.payments, 'payment')}</div></div>
      ${goal ? html`<div class="goal"><div class="goal-bar" role="img" aria-label="${Math.round((cur.total / goal) * 100)}% of the ${peso(goal)} goal"><span style="width:${Math.min(100, Math.round((cur.total / goal) * 100))}%"></span></div>
        <div class="muted small">${Math.round((cur.total / goal) * 100)}% of your ${peso(goal)} goal${cur.total < goal ? ` · ${peso(goal - cur.total)} to go` : ''}</div></div>`
        : html`<p class="muted small">Set a monthly goal under Today → Settings to see progress here.</p>`}
    </section>
    <div class="stats four">${STREAM_KEYS.map((k) => html`<div class="stat money-stat"><div class="stat-l">${streamDot(k)} ${STREAMS[k].name}</div>
      <div class="stat-n">${peso(cur.by[k])}</div><div class="muted small">${pct(change(cur.by[k], prev.by[k]))} vs ${upTo < 31 ? 'same days last month' : 'last month'}</div></div>`)}</div>
    <section class="card"><div class="grid2">
      <div><h2>Every month, before any new work</h2><p class="hero-sm">${peso(Number(s.mrr_care) + Number(s.mrr_plans))}</p>
        <p class="muted small">${peso(s.mrr_care)} from ${plural(Number(s.care_active), 'care plan')} + ${peso(s.mrr_plans)} from ${plural(Number(s.plans_paying), 'team plan')}.
          ${Number(s.care_ending) ? `${s.care_ending} care plan${Number(s.care_ending) === 1 ? ' is' : 's are'} set to end.` : ''} ${Number(s.care_pending) ? `${s.care_pending} waiting for a first payment.` : ''}</p></div>
      <div><h2>Not yours to spend</h2><p class="hero-sm">${peso(s.held_gov)}</p>
        <p class="muted small">Government fees customers paid you that you haven't paid to the agency (or refunded) yet. Keep it apart from your own money.</p></div>
    </div></section>
    <section class="card"><div class="grid2">
      <div><h2>Inside one-time jobs</h2><p class="muted small">Rush fees: <b>${peso(cur.rush)}</b> of ${peso(cur.by.jobs)}.</p></div>
      <div><h2>Guarantee payouts</h2><p class="muted small"><b>${peso(-cur.costs)}</b> paid out this month. After payouts: <b>${peso(cur.net)}</b>.</p></div>
    </div></section>
    ${top.length ? html`<section class="card"><h2>Who paid the most</h2>${top.map(([n, v]) => html`<div class="line"><span class="line-main"><b>${n}</b></span><b>${peso(v)}</b></div>`)}</section>` : ''}`;
}

// ---------------------------------------------------------------- 3. Trend
function trendView() {
  const rows = byMonth(data.lines, data.today, 12);
  const H = 220, W = 640, L = 46, B = 26, T = 12;
  const plotW = W - L - 8, band = plotW / rows.length, bar = Math.min(24, band * 0.55);
  const max = Math.max(...rows.map((r) => STREAM_KEYS.reduce((t, k) => t + Math.max(0, r.by[k]), 0)), 0);
  const ticks = niceTicks(max || 1000, 4);
  const top = ticks[ticks.length - 1];
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const best = rows.reduce((b, r) => (r.total > (b?.total ?? -Infinity) ? r : b), null);
  const cols = rows.map((r, i) => {
    const x = L + band * i + (band - bar) / 2;
    let base = 0;
    const segs = STREAM_KEYS.filter((k) => r.by[k] > 0);
    const rects = segs.map((k, j) => {
      const y0 = y(base);
      base += r.by[k];
      const y1 = y(base);
      const h = Math.max(0, y0 - y1 - (j < segs.length - 1 ? 2 : 0)); // 2px surface gap between segments
      const t = y0 - h;
      if (j < segs.length - 1) return html`<rect x="${x}" y="${t}" width="${bar}" height="${h}" fill="${STREAMS[k].color}"></rect>`;
      const rr = Math.min(4, h, bar / 2); // rounded data end, square at the baseline
      return html`<path d="M${x},${y0} V${t + rr} Q${x},${t} ${x + rr},${t} H${x + bar - rr} Q${x + bar},${t} ${x + bar},${t + rr} V${y0} Z" fill="${STREAMS[k].color}"></path>`;
    });
    const label = `${monthLabel(r.month, true)}: ${peso(r.total)}. ${STREAM_KEYS.map((k) => `${STREAMS[k].name} ${peso(r.by[k])}`).join(', ')}.`;
    const show = r === best && r.total > 0 || i === rows.length - 1;
    return html`<g class="col" tabindex="0" role="img" aria-label="${label}" data-tip="${i}">
      <rect class="hit" x="${L + band * i}" y="${T}" width="${band}" height="${H - T - B}" fill="transparent"></rect>${rects}
      ${show ? html`<text x="${x + bar / 2}" y="${y(Math.max(0, base)) - 6}" text-anchor="middle" class="cap">${compact(r.total)}</text>` : ''}
      <text x="${x + bar / 2}" y="${H - 8}" text-anchor="middle" class="tick">${monthLabel(r.month)}</text></g>`;
  });
  return html`
    <section class="card"><div class="card-head"><div><h2>Collected per month</h2><p class="card-sub">Last 12 months, stacked by where it came from. Refunds are taken off; guarantee payouts are shown in the table.</p></div></div>
      <div class="legend">${STREAM_KEYS.map((k) => html`<span>${streamDot(k)} ${STREAMS[k].name}</span>`)}</div>
      <div class="chart-wrap"><svg class="trend" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-label="Money collected per month, last 12 months">
        ${ticks.map((t) => html`<line x1="${L}" x2="${W - 8}" y1="${y(t)}" y2="${y(t)}" class="grid"></line><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end" class="tick">${compact(t)}</text>`)}
        ${cols}</svg><div class="chart-tip" hidden></div></div>
    </section>
    <section class="card"><h2>The numbers</h2><div class="table-wrap" tabindex="0" role="region" aria-label="Collected per month, as a table"><table class="table num-table"><thead><tr><th>Month</th>${STREAM_KEYS.map((k) => html`<th>${STREAMS[k].name}</th>`)}<th>Total</th><th>Payouts</th></tr></thead><tbody>
      ${rows.slice().reverse().map((r) => html`<tr><td>${monthLabel(r.month, true)}</td>${STREAM_KEYS.map((k) => html`<td>${peso(r.by[k])}</td>`)}<td><b>${peso(r.total)}</b></td><td>${r.costs ? peso(-r.costs) : '—'}</td></tr>`)}
    </tbody></table></div></section>`;
}
// Tooltip for the trend chart (hover, tap or keyboard focus).
function showTip(g) {
  const wrap = g.closest('.chart-wrap'), tip = wrap.querySelector('.chart-tip');
  const r = byMonth(data.lines, data.today, 12)[Number(g.dataset.tip)];
  tip.innerHTML = String(html`<b>${monthLabel(r.month, true)}: ${peso(r.total)}</b>${STREAM_KEYS.map((k) => html`<div>${streamDot(k)} ${STREAMS[k].name} <span>${peso(r.by[k])}</span></div>`)}`);
  tip.hidden = false;
  const box = g.getBoundingClientRect(), w = wrap.getBoundingClientRect();
  tip.style.left = `${Math.max(0, Math.min(w.width - 210, box.left - w.left + box.width / 2 - 105))}px`;
  tip.style.top = '0px';
}
for (const ev of ['mouseover', 'focusin']) document.addEventListener(ev, (e) => { const g = e.target.closest?.('svg.trend .col'); if (g) showTip(g); });
document.addEventListener('mouseout', (e) => { if (e.target.closest?.('svg.trend') && !e.relatedTarget?.closest?.('svg.trend')) e.target.closest('.chart-wrap').querySelector('.chart-tip').hidden = true; });
document.addEventListener('click', (e) => { const g = e.target.closest?.('svg.trend .col'); if (g) showTip(g); });

// ---------------------------------------------------------------- 4. Pipeline
function pipelineView() {
  const p = pipeline(data.lines, data.today);
  const lanes = [
    ['Quoted, not accepted', p.quoted, 'Customers have a quote. A friendly nudge after 3 days helps.', 'orders'],
    ['Accepted, not paid', p.accepted, 'They said yes; work starts when they pay.', 'orders'],
    ['Care bills to collect', p.careDue, 'Sign-up and renewal bills not paid yet.', 'care'],
    ['Billed to firms, not paid', p.billed, 'Statements sent; due 15 days after.', 'billing'],
    ['Firms owe it, not billed yet', p.unbilled, 'Quote requests, sales and listings not on a statement yet.', 'billing'],
  ];
  const coming = lanes.reduce((t, [, l]) => t + l.total, 0);
  return html`
    <p class="money-line">Money on its way: <b>${peso(coming)}</b>${p.toPay.total ? html` · guarantee payouts to send: <b>${peso(-p.toPay.total)}</b>` : ''}</p>
    <div class="money-lanes">${lanes.map(([t, l, d, tab]) => html`<section class="card lane"><div class="card-head"><div><h2>${t}</h2><p class="card-sub">${d}</p></div>
        <button class="btn btn-sm btn-ghost" data-act="money-go" data-tab="${tab}">Open</button></div>
      <div class="lane-total">${peso(l.total)} <small class="muted">${plural(l.items.length, 'item')}</small></div>
      ${l.total ? html`<div class="ages">${AGES.map((a) => html`<div class="${a === '31+ days' && l.ages[a] ? 'late' : ''}"><span>${a}</span><b>${peso(l.ages[a])}</b></div>`)}</div>` : ''}
      ${l.items.slice(0, 5).map((x) => html`<div class="line"><span class="line-main"><b>${x.who}</b><small>${x.label} · since ${fmtDate(x.day)}</small></span><b>${peso(x.amount)}</b></div>`)}
      ${when(l.items.length > 5, html`<div class="sheet-foot">${l.items.length - 5} more in the Ledger</div>`)}</section>`)}</div>`;
}

// ---------------------------------------------------------------- 5. Ledger
function ledgerView() {
  const f = st.ledger;
  const list = filterLedger(data.lines, f);
  const ms = months(data.today, 13).slice().reverse();
  const sum = (state) => list.filter((l) => l.state === state).reduce((t, l) => t + Number(l.amount), 0);
  const opt = (v, l, cur) => html`<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`;
  return html`
    <div class="filters ledger-filters">
      <input type="search" data-ledger="q" placeholder="Search customer, firm, invoice no…" value="${f.q}" aria-label="Search the ledger">
      <select data-ledger="month" aria-label="Month">${opt('all', 'All months', f.month)}${ms.map((m) => opt(m, monthLabel(m, true), f.month))}</select>
      <select data-ledger="stream" aria-label="Stream">${opt('all', 'All streams', f.stream)}${STREAM_KEYS.map((k) => opt(k, STREAMS[k].name, f.stream))}</select>
      <select data-ledger="state" aria-label="Status">${opt('all', 'Any status', f.state)}${Object.entries(STATE_NAMES).map(([k, v]) => opt(k, v, f.state))}</select>
      <button class="btn btn-sm btn-soft" data-act="ledger-csv">Download CSV</button>
    </div>
    <p class="money-line">${plural(list.length, 'line')} · collected <b>${peso(sum('collected'))}</b> · to collect <b>${peso(sum('to_collect') + sum('unbilled'))}</b> · quoted <b>${peso(sum('pipeline'))}</b>${sum('held') ? html` · government money held <b>${peso(sum('held'))}</b>` : ''}</p>
    <section class="card"><div class="table-wrap" tabindex="0" role="region" aria-label="Ledger"><table class="table ledger"><thead><tr><th>Date</th><th>Stream</th><th>What</th><th>Customer or firm</th><th>Status</th><th class="r">Amount</th><th>Invoice no.</th></tr></thead><tbody>
      ${list.slice(0, 400).map((l) => html`<tr class="${l.state}"><td>${fmtDate(l.day)}</td><td>${streamDot(l.stream)} ${STREAMS[l.stream]?.name || l.stream}</td>
        <td>${KIND_NAMES[l.kind] || l.kind}<div class="muted small">${l.label}</div></td><td>${l.who}</td>
        <td><span class="tag">${STATE_NAMES[l.state] || l.state}</span></td><td class="r ${Number(l.amount) < 0 ? 'neg' : ''}">${peso(l.amount)}</td>
        <td>${l.state === 'collected' && ['order', 'care', 'statement', 'plan'].includes(l.ref_kind) && Number(l.amount) > 0
          ? html`<form class="inline-form inv-form" data-kind="${l.ref_kind}" data-id="${l.ref_id}"><input name="no" maxlength="60" value="${l.invoice_no || ''}" aria-label="BIR invoice number" placeholder="Add"><button class="btn btn-sm btn-ghost">Save</button></form>`
          : l.invoice_no || ''}</td></tr>`)}
    </tbody></table></div>${when(list.length > 400, html`<div class="sheet-foot">Showing 400 of ${list.length}. Narrow the filters, or download the CSV for everything.</div>`)}
    ${when(!list.length, html`<p class="muted pad">Nothing matches.</p>`)}</section>`;
}
on('ledger-csv', () => download(`permitpal-ledger-${data.today}.csv`, toCsv(ledgerCsv(filterLedger(data.lines, st.ledger)))));
document.addEventListener('change', (e) => {
  if (e.target.matches?.('[data-money-month]')) { st.month = e.target.value; rerender(); }
  if (e.target.matches?.('select[data-ledger]')) { st.ledger[e.target.dataset.ledger] = e.target.value; rerender(); }
});
let qTimer;
document.addEventListener('input', (e) => {
  if (!e.target.matches?.('input[data-ledger=q]')) return;
  clearTimeout(qTimer);
  qTimer = setTimeout(() => { st.ledger.q = e.target.value; const pos = e.target.selectionStart; rerender(); setTimeout(() => { const q = document.querySelector('input[data-ledger=q]'); q?.focus(); q?.setSelectionRange(pos, pos); }, 60); }, 300);
});
document.addEventListener('submit', async (e) => {
  const f = e.target;
  if (f.matches?.('.inv-form')) {
    e.preventDefault();
    const no = String(new FormData(f).get('no') || '').trim();
    try { await db.adminSetInvoiceNo(f.dataset.kind, f.dataset.id, no); toast(no ? 'Invoice number saved.' : 'Invoice number removed.'); rerender(); } catch (err) { toastError(err); }
  }
  if (f.matches?.('.money-settings')) {
    e.preventDefault();
    const fd = new FormData(f);
    try {
      await db.adminSetMoneySetting('money_goal', String(fd.get('goal') || '').trim());
      await db.adminSetMoneySetting('ic_licence_no', String(fd.get('ic') || '').trim());
      toast('Saved.'); rerender();
    } catch (err) { toastError(err); }
  }
});
