// Admin > Money: every peso Pinoy Permit earns, in plain words, four tabs.
//   Home          four big numbers (earned this month, owed to you, comes in every month, not your money),
//                 a to-do list written as sentences, and BIR receipt numbers to add
//   Earnings      one month: where the money came from, the last 12 months as a chart, who paid most
//   Owed to you   who owes what, and how long they've been waiting
//   All payments  every line like a bank statement, with search and a download for the accountant
import { html, raw, fmtDate, peso, toast, toastError, when, plural, todayPH, download, toCsv } from '../util.js?v=fd3a394';
import { on, rerender, has, IN_PERSON } from '../core.js?v=fd3a394';
import { ICON } from '../components.js?v=fd3a394';
import { INVOICE_KINDS, STREAMS, STREAM_KEYS, KIND_NAMES, STATE_NAMES, SHOW_GROUPS, byMonth, monthTotals, months, monthLabel, prevMonth, pipeline, missingInvoices,
  filterLedger, ledgerCsv, niceTicks, compact, firstOfRange, monthOf, daysSince } from '../money.js?v=fd3a394';
import * as db from 'pp/data';

export const MONEY_VIEWS = [['home', 'Home'], ['earnings', 'Earnings'], ['owed', 'Owed to you'], ['payments', 'All payments']];
const st = { view: 'home', month: null, ledger: { stream: 'all', state: 'all', month: 'all', q: '' } };
let data = null; // { lines, summary, today }

const CLOCK = raw('<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>');
const REPEAT = raw('<svg viewBox="0 0 24 24"><path d="M4 11a7 7 0 0 1 12-5l2 2M20 13a7 7 0 0 1-12 5l-2-2"/><path d="M18 3v5h-5M6 21v-5h5"/></svg>');
const BANK = raw('<svg viewBox="0 0 24 24"><path d="M3.5 9 12 4l8.5 5"/><path d="M5 10v7M9.5 10v7M14.5 10v7M19 10v7M3.5 20h17"/></svg>');

export async function moneyTab(goTab) {
  const today = todayPH();
  const [lines, summary] = await Promise.all([db.adminMoney(firstOfRange(today, 13), today), db.adminMoneySummary()]);
  data = { lines, summary, today };
  st.month ||= monthOf(today);
  gotoTab = goTab;
  const body = { home: homeView, earnings: earningsView, owed: owedView, payments: paymentsView }[st.view] || homeView;
  return html`<div class="money">
    <div class="seg money-tabs" role="tablist" aria-label="Money">${MONEY_VIEWS.map(([k, l]) => html`<button role="tab" aria-selected="${st.view === k}" class="seg-btn ${st.view === k ? 'on' : ''}" data-act="money-view" data-v="${k}">${l}</button>`)}</div>
    ${body()}</div>`;
}
let gotoTab = null;
on('money-view', (ds) => { st.view = ds.v; rerender(); });
on('money-go', (ds) => (ds.view ? (st.view = ds.view, rerender()) : gotoTab?.(ds.tab)));
on('money-receipts', () => document.getElementById('money-invoices')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
on('money-all-receipts', () => { st.allReceipts = true; rerender(); });

// Year-round care is switched off with the rest of the in-person work, so its stream isn't shown; load
// top-ups only once the load database part is on.
const shownKeys = () => STREAM_KEYS.filter((k) => (IN_PERSON || k !== 'care') && (has('load') || k !== 'load'));
const noteOf = (k) => (k === 'jobs' && !IN_PERSON ? 'Account set-ups, online filings and paying city bills, for customers who asked' : STREAMS[k].note);
const streamDot = (k) => html`<span class="dot" style="background:${STREAMS[k].color}" aria-hidden="true"></span>`;
const monthName = (m) => monthLabel(m, true).replace(/^(\w+)/, (x) => ({ Jan: 'January', Feb: 'February', Mar: 'March', Apr: 'April', May: 'May', Jun: 'June', Jul: 'July', Aug: 'August', Sep: 'September', Oct: 'October', Nov: 'November', Dec: 'December' })[x]);
// "₱1,800 more than the same days last month", in words rather than a percentage.
function compareText(cur, prev, sameDays) {
  if (!prev && !cur) return '';
  const d = cur - prev;
  const when_ = sameDays ? 'the same days last month' : 'the month before';
  return d === 0 ? `Same as ${when_}` : `${peso(Math.abs(d))} ${d > 0 ? 'more' : 'less'} than ${when_}`;
}
const goalBar = (total, goal) => html`<div class="goal"><div class="goal-bar" role="img" aria-label="${Math.round((total / goal) * 100)}% of your ${peso(goal)} goal"><span style="width:${Math.min(100, Math.round((total / goal) * 100))}%"></span></div>
  <div class="muted small">${Math.round((total / goal) * 100)}% of your ${peso(goal)} goal${total < goal ? ` · ${peso(goal - total)} to go` : ' · goal reached'}</div></div>`;

// ---------------------------------------------------------------- Home
function homeView() {
  const s = data.summary;
  const cur = monthOf(data.today), day = Number(data.today.slice(8, 10));
  const m = monthTotals(data.lines, cur), prev = monthTotals(data.lines, prevMonth(cur), day);
  const p = pipeline(data.lines, data.today);
  const owedLanes = [p.accepted, p.careDue, p.billed, p.unbilled];
  const owed = owedLanes.reduce((t, l) => t + l.total, 0);
  const owedWho = new Set(owedLanes.flatMap((l) => l.items.map((x) => x.who))).size;
  const goal = Number(s.goal) || 0;
  const pays = Number(s.order_payments_to_check) + Number(s.care_payments_to_check) + (Number(s.addon_payments_to_check) || 0);
  const n = (x) => Number(x) || 0;
  const todo = [
    [pays, `Check ${plural(pays, 'payment')} in your GCash or bank app, then confirm ${pays === 1 ? 'it' : 'them'}`, 'Confirm', { tab: n(s.order_payments_to_check) ? 'orders' : n(s.care_payments_to_check) ? 'care' : 'plus' }],
    [n(s.quotes_to_send), `Send a price to ${plural(n(s.quotes_to_send), 'customer')} who asked`, 'Send prices', { tab: 'orders' }],
    [n(s.claims_to_pay), `Send money for ${plural(n(s.claims_to_pay), 'approved late-fee claim')}`, 'Pay out', { tab: 'care' }],
    [n(s.claims_to_decide), `Decide on ${plural(n(s.claims_to_decide), 'late-fee claim')} (customers wait up to 5 days)`, 'Review', { tab: 'care' }],
    [n(s.care_overdue), `${plural(n(s.care_overdue), 'customer')} haven't paid their monthly care bill`, 'Follow up', { tab: 'care' }],
    [n(s.partners_to_bill), `Bill ${plural(n(s.partners_to_bill), 'partner firm')} for last month`, 'Make bills', { tab: 'billing' }],
    [n(s.statements_overdue), `${plural(n(s.statements_overdue), 'partner firm')} ${n(s.statements_overdue) === 1 ? 'is' : 'are'} late paying their bill`, 'Follow up', { tab: 'billing' }],
    [n(s.disputes_open), `Decide on ${plural(n(s.disputes_open), 'lead')} a firm reported (they wait for your answer)`, 'Decide', { tab: 'billing' }],
    [n(s.firms_paused), `${plural(n(s.firms_paused), 'firm')} ${n(s.firms_paused) === 1 ? 'is' : 'are'} paused for no credit: add credit when they pay`, 'Open', { tab: 'partners' }],
    [n(s.applications_new), `${plural(n(s.applications_new), 'firm')} ${n(s.applications_new) === 1 ? 'wants' : 'want'} to be listed on Pinoy Permit`, 'Review', { tab: 'partners' }],
    [n(s.covered_missing_dates), `${plural(n(s.covered_missing_dates), 'permit')} on a care plan ${n(s.covered_missing_dates) === 1 ? 'has' : 'have'} no expiry date yet`, 'Fix', { tab: 'care' }],
    [n(s.gov_unrecorded), `Write down the government fee you paid for ${plural(n(s.gov_unrecorded), 'finished job')}`, 'Record', { tab: 'orders' }],
    [n(s.missing_invoice), `Add BIR receipt numbers to ${plural(n(s.missing_invoice), 'payment')}`, 'Add numbers', { receipts: true }],
  ].filter(([k]) => k > 0);
  const miss = missingInvoices(data.lines);
  return html`
    <p class="mh-hello">Here's your money for <b>${monthName(cur)}</b>.</p>
    <div class="mh-cards">
      <section class="mh-card earned">
        <div class="mh-ico">${ICON.peso}</div>
        <h2>You earned this month</h2>
        <p class="mh-big">${peso(m.total)}</p>
        ${goal ? goalBar(m.total, goal) : html`<p class="muted small">Set a monthly goal in Settings below to track it here.</p>`}
        <p class="mh-sub">${compareText(m.total, prev.total, true)}</p>
        <button class="btn btn-sm btn-soft" data-act="money-view" data-v="earnings">See where it came from</button>
      </section>
      <section class="mh-card owed">
        <div class="mh-ico">${CLOCK}</div>
        <h2>Owed to you</h2>
        <p class="mh-big">${peso(owed)}</p>
        <p class="mh-sub">${owed ? `${plural(owedWho, 'customer or firm', 'customers and firms')} haven't paid yet.` : 'Nobody owes you anything right now.'}</p>
        <button class="btn btn-sm btn-soft" data-act="money-view" data-v="owed">See who</button>
      </section>
      <section class="mh-card monthly">
        <div class="mh-ico">${REPEAT}</div>
        <h2>Comes in every month</h2>
        <p class="mh-big">${peso(n(s.mrr_care) + n(s.mrr_plans))}</p>
        <p class="mh-sub">From ${IN_PERSON ? `${plural(n(s.care_active), 'monthly care plan')} and ` : ''}${plural(n(s.plans_paying), 'team subscription')}, even if no new job comes in.${n(s.care_pending) ? ` ${n(s.care_pending)} more waiting for a first payment.` : ''}${n(s.care_autorenew) ? ` ${plural(n(s.care_autorenew), 'branch or vehicle', 'branches and vehicles')} on pay per renewal bring in a fee each time we renew.` : ''}</p>
      </section>
      <section class="mh-card held">
        <div class="mh-ico">${BANK}</div>
        <h2>Not your money</h2>
        <p class="mh-big">${peso(s.held_gov)}</p>
        <p class="mh-sub">Government fees customers gave you for their permits. Pay them to the government office. Don't spend them.</p>
      </section>
    </div>

    <section class="card mh-todo"><div class="card-head"><div><h2>Your to-do list</h2><p class="card-sub">Things waiting for you, most urgent first.</p></div></div>
      ${todo.length ? todo.map(([k, text, btn, go_]) => html`<div class="row todo"><div class="row-main"><div class="row-title"><span class="todo-n">${k}</span> ${text}</div></div>
        <div class="row-side">${go_.receipts ? html`<button class="btn btn-sm btn-primary" data-act="money-receipts">${btn}</button>` : html`<button class="btn btn-sm btn-primary" data-act="money-go" data-tab="${go_.tab}">${btn}</button>`}</div></div>`)
        : html`<div class="all-good">${ICON.check} You're all caught up.</div>`}
      ${when(n(s.staff_access_open), html`<p class="muted small">You can still open ${plural(n(s.staff_access_open), 'customer\'s account', 'customers\' accounts')} for set-up jobs. That ends when each job is marked done.</p>`)}
    </section>

    <section class="card" id="money-invoices"><div class="card-head"><div><h2>Add BIR receipt numbers</h2>
      <p class="card-sub">The BIR needs an official receipt (invoice) for every payment. After you write one, type its number here.</p></div></div>
      ${miss.length ? html`<div class="table-wrap" tabindex="0" role="region" aria-label="Payments without a receipt number"><table class="table"><thead><tr><th>Paid on</th><th>From</th><th>For</th><th>Amount</th><th>Receipt no.</th></tr></thead><tbody>
        ${miss.slice(0, st.allReceipts ? 50 : 5).map((x) => html`<tr><td>${fmtDate(x.day)}</td><td>${x.who}</td><td>${x.label}</td><td>${peso(x.amount)}</td>
          <td><form class="inline-form inv-form" data-kind="${x.ref_kind}" data-id="${x.ref_id}"><input name="no" maxlength="60" required aria-label="BIR receipt number for ${x.who}" placeholder="e.g. 0001234"><button class="btn btn-sm btn-soft">Save</button></form></td></tr>`)}
      </tbody></table></div>
      ${miss.length > 5 && !st.allReceipts ? html`<button class="btn btn-sm btn-ghost" data-act="money-all-receipts">Show all ${miss.length}</button>` : ''}
      ${when(st.allReceipts && miss.length > 50, html`<p class="muted small">${miss.length - 50} more in All payments.</p>`)}`
      : html`<p class="all-good">${ICON.check} Every payment has its receipt number.</p>`}
    </section>

    <details class="card mh-settings"><summary>Settings</summary>
      <form class="grid2 money-settings">
        <label class="field"><span>Monthly goal (₱) <small>(only you see it)</small></span><input name="goal" type="number" min="0" step="1000" value="${s.goal ?? ''}"></label>
        <label class="field"><span>Insurance Commission license no. <small>(only if you have one)</small></span><input name="ic" maxlength="60" value="${s.ic_licence_no || ''}" placeholder="Leave empty if you don't have one"></label>
        <div><button class="btn btn-sm btn-soft">Save</button></div>
      </form>
      <p class="muted small">Without an Insurance Commission license, insurance companies can only pay you a flat listing fee, never per customer (Insurance Code, Sec. 307). The app enforces this.</p>
    </details>`;
}

// ---------------------------------------------------------------- Earnings
function earningsView() {
  const ms = months(data.today, 12);
  const m = st.month;
  // A month in progress is compared with the same days of the month before.
  const upTo = m === monthOf(data.today) ? Number(data.today.slice(8, 10)) : 31;
  const cur = monthTotals(data.lines, m), prev = monthTotals(data.lines, prevMonth(m), upTo);
  const goal = Number(data.summary.goal) || 0;
  const who = new Map();
  for (const l of data.lines) if (l.state === 'collected' && monthOf(l.day) === m) who.set(l.who, (who.get(l.who) || 0) + Number(l.amount));
  const top = [...who.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const most = Math.max(1, ...shownKeys().map((k) => cur.by[k]));
  return html`
    <div class="filters"><label class="field inline"><span>Show</span><select data-money-month>${ms.slice().reverse().map((x) => html`<option value="${x}" ${x === m ? 'selected' : ''}>${monthName(x)}</option>`)}</select></label></div>
    <section class="card money-hero">
      <div><p class="muted">You earned in ${monthName(m)}</p><p class="hero-n">${peso(cur.total)}</p>
        <p class="muted small">${compareText(cur.total, prev.total, upTo < 31)} · ${plural(cur.payments, 'payment')}</p></div>
      ${goal ? goalBar(cur.total, goal) : ''}
    </section>
    <section class="card"><div class="card-head"><div><h2>Where it came from</h2><p class="card-sub">Your money, by the kind of work.</p></div></div>
      <div class="src-list">${shownKeys().map((k) => html`<div class="src money-stat">
        <div class="src-top"><span class="src-name">${streamDot(k)} ${STREAMS[k].name}</span><b>${peso(cur.by[k])}</b></div>
        <div class="src-bar" aria-hidden="true"><span style="width:${Math.round((Math.max(0, cur.by[k]) / most) * 100)}%;background:${STREAMS[k].color}"></span></div>
        <div class="muted small">${noteOf(k)}${k === 'jobs' && cur.rush ? ` · ${peso(cur.rush)} of it from rush fees` : ''}</div></div>`)}</div>
      ${cur.costs ? html`<p class="muted small">You paid out ${peso(-cur.costs)} in late-fee guarantees this month, so you kept ${peso(cur.net)}.</p>` : ''}
    </section>
    ${trendCard()}
    ${top.length ? html`<section class="card"><h2>Who paid you the most</h2>${top.map(([nm, v]) => html`<div class="line"><span class="line-main"><b>${nm}</b></span><b>${peso(v)}</b></div>`)}</section>` : ''}`;
}

function trendCard() {
  const rows = byMonth(data.lines, data.today, 12);
  const H = 220, W = 640, L = 46, B = 26, T = 12;
  const plotW = W - L - 8, band = plotW / rows.length, bar = Math.min(24, band * 0.55);
  const max = Math.max(...rows.map((r) => shownKeys().reduce((t, k) => t + Math.max(0, r.by[k]), 0)), 0);
  const ticks = niceTicks(max || 1000, 4);
  const top = ticks[ticks.length - 1];
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const best = rows.reduce((b, r) => (r.total > (b?.total ?? -Infinity) ? r : b), null);
  const cols = rows.map((r, i) => {
    const x = L + band * i + (band - bar) / 2;
    let base = 0;
    const segs = shownKeys().filter((k) => r.by[k] > 0);
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
    const label = `${monthName(r.month)}: ${peso(r.total)}. ${shownKeys().map((k) => `${STREAMS[k].name} ${peso(r.by[k])}`).join(', ')}.`;
    const show = r === best && r.total > 0 || i === rows.length - 1;
    return html`<g class="col" tabindex="0" role="img" aria-label="${label}" data-tip="${i}">
      <rect class="hit" x="${L + band * i}" y="${T}" width="${band}" height="${H - T - B}" fill="transparent"></rect>${rects}
      ${show ? html`<text x="${x + bar / 2}" y="${y(Math.max(0, base)) - 6}" text-anchor="middle" class="cap">${compact(r.total)}</text>` : ''}
      <text x="${x + bar / 2}" y="${H - 8}" text-anchor="middle" class="tick">${monthLabel(r.month)}</text></g>`;
  });
  return html`<section class="card"><div class="card-head"><div><h2>Money earned each month</h2><p class="card-sub">The last 12 months. Tap a month to see the breakdown.</p></div></div>
      <div class="legend">${shownKeys().map((k) => html`<span>${streamDot(k)} ${STREAMS[k].name}</span>`)}</div>
      <div class="chart-wrap"><svg class="trend" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-label="Money earned each month, last 12 months">
        ${ticks.map((t) => html`<line x1="${L}" x2="${W - 8}" y1="${y(t)}" y2="${y(t)}" class="grid"></line><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end" class="tick">${compact(t)}</text>`)}
        ${cols}</svg><div class="chart-tip" hidden></div></div>
      <details class="mh-numbers"><summary>See the numbers</summary><div class="table-wrap" tabindex="0" role="region" aria-label="Money earned each month, as a table"><table class="table num-table"><thead><tr><th>Month</th>${shownKeys().map((k) => html`<th>${STREAMS[k].name}</th>`)}<th>Total</th><th>Paid out</th></tr></thead><tbody>
        ${rows.slice().reverse().map((r) => html`<tr><td>${monthName(r.month)}</td>${shownKeys().map((k) => html`<td>${peso(r.by[k])}</td>`)}<td><b>${peso(r.total)}</b></td><td>${r.costs ? peso(-r.costs) : '—'}</td></tr>`)}
      </tbody></table></div></details>
    </section>`;
}
// Tooltip for the chart (hover, tap or keyboard focus).
function showTip(g) {
  const wrap = g.closest('.chart-wrap'), tip = wrap.querySelector('.chart-tip');
  const r = byMonth(data.lines, data.today, 12)[Number(g.dataset.tip)];
  tip.innerHTML = String(html`<b>${monthName(r.month)}: ${peso(r.total)}</b>${shownKeys().map((k) => html`<div>${streamDot(k)} ${STREAMS[k].name} <span>${peso(r.by[k])}</span></div>`)}`);
  tip.hidden = false;
  const box = g.getBoundingClientRect(), w = wrap.getBoundingClientRect();
  tip.style.left = `${Math.max(0, Math.min(w.width - 230, box.left - w.left + box.width / 2 - 115))}px`;
  tip.style.top = '0px';
}
for (const ev of ['mouseover', 'focusin']) document.addEventListener(ev, (e) => { const g = e.target.closest?.('svg.trend .col'); if (g) showTip(g); });
document.addEventListener('mouseout', (e) => { if (e.target.closest?.('svg.trend') && !e.relatedTarget?.closest?.('svg.trend')) e.target.closest('.chart-wrap').querySelector('.chart-tip').hidden = true; });
document.addEventListener('click', (e) => { const g = e.target.closest?.('svg.trend .col'); if (g) showTip(g); });

// ---------------------------------------------------------------- Owed to you
function owedView() {
  const p = pipeline(data.lines, data.today);
  const groups = [
    ['Said yes, but hasn\'t paid', p.accepted, 'They accepted your price. The work starts when they pay.', 'orders', 'Open orders'],
    ['Monthly care bills not paid', p.careDue, 'Customers\' Year-round care bills that are still open.', 'care', 'Open care'],
    ['Partner firms you billed', p.billed, 'Bills you sent to firms. They have 15 days to pay.', 'billing', 'Open partner bills'],
    ['Partner firms to bill', p.unbilled, 'Fees firms owe you that aren\'t on a bill yet.', 'billing', 'Make their bill'],
    ['Prices waiting for a yes', p.quoted, 'Customers have your price but haven\'t said yes. A friendly nudge after 3 days helps.', 'orders', 'Open orders'],
  ];
  const owed = groups.slice(0, 4).reduce((t, [, l]) => t + l.total, 0);
  return html`
    <section class="card money-hero owed-hero"><div><p class="muted">People owe you</p><p class="hero-n">${peso(owed)}</p>
      <p class="muted small">Plus ${peso(p.quoted.total)} in prices you sent that are waiting for a yes.</p></div></section>
    ${p.toPay.total ? html`<div class="banner warn"><div><b>You need to pay ${peso(-p.toPay.total)}</b> for approved late-fee claims. Send the money, then mark each one paid.</div>
      <div class="banner-actions"><button class="btn btn-sm btn-primary" data-act="money-go" data-tab="care">Pay out</button></div></div>` : ''}
    <div class="owed-groups">${[...groups].sort((a, b) => (b[1].items.length ? 1 : 0) - (a[1].items.length ? 1 : 0)).map(([t, l, d, tab, btn]) => !l.items.length
      ? html`<section class="card lane empty"><p><b>${t}</b> <span class="muted">· nothing here</span></p></section>`
      : html`<section class="card lane"><div class="card-head"><div><h2>${t} <span class="lane-sum">${peso(l.total)}</span></h2><p class="card-sub">${d}</p></div>
        <button class="btn btn-sm btn-soft" data-act="money-go" data-tab="${tab}">${btn}</button></div>
      ${l.items.slice(0, 6).map((x) => { const w = daysSince(x.day, data.today); return html`<div class="line owed-line"><span class="line-main"><b>${x.who}</b><small>${x.label}</small></span>
        <span class="wait ${w > 30 ? 'late' : ''}">${w === 0 ? 'today' : `waiting ${plural(w, 'day')}`}</span><b>${peso(x.amount)}</b></div>`; })}
      ${when(l.items.length > 6, html`<div class="sheet-foot">${l.items.length - 6} more in All payments</div>`)}</section>`)}</div>`;
}

// ---------------------------------------------------------------- All payments
function paymentsView() {
  const f = st.ledger;
  const list = filterLedger(data.lines, f);
  const ms = months(data.today, 13).slice().reverse();
  const sum = (...states) => list.filter((l) => states.includes(l.state)).reduce((t, l) => t + Number(l.amount), 0);
  const opt = (v, l, cur) => html`<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`;
  return html`
    <div class="filters ledger-filters">
      <input type="search" data-ledger="q" placeholder="Search a name or receipt number" value="${f.q}" aria-label="Search payments">
      <select data-ledger="month" aria-label="Month">${opt('all', 'All months', f.month)}${ms.map((x) => opt(x, monthName(x), f.month))}</select>
      <select data-ledger="state" aria-label="Show">${SHOW_GROUPS.map(([v, l]) => opt(v, l, f.state))}</select>
      <select data-ledger="stream" aria-label="Kind of work">${opt('all', 'All kinds of work', f.stream)}${shownKeys().map((k) => opt(k, STREAMS[k].name, f.stream))}</select>
      <button class="btn btn-sm btn-soft" data-act="ledger-csv">${ICON.download} Download for my accountant</button>
    </div>
    <div class="pay-sums">
      <div><span>Received</span><b>${peso(sum('collected'))}</b></div>
      <div><span>Owed to you</span><b>${peso(sum('to_collect', 'unbilled'))}</b></div>
      <div><span>Waiting for a yes</span><b>${peso(sum('pipeline'))}</b></div>
      ${sum('held') ? html`<div><span>Not your money</span><b>${peso(sum('held'))}</b></div>` : ''}
    </div>
    <section class="card"><div class="table-wrap" tabindex="0" role="region" aria-label="All payments"><table class="table ledger"><thead><tr><th>Date</th><th>What</th><th>Customer or firm</th><th>Status</th><th class="r">Amount</th><th>Receipt no.</th></tr></thead><tbody>
      ${list.slice(0, 400).map((l) => html`<tr class="${l.state}"><td>${fmtDate(l.day)}</td>
        <td><b class="pay-what">${KIND_NAMES[l.kind] || l.kind}</b><div class="muted small">${streamDot(l.stream)} ${STREAMS[l.stream]?.name || l.stream} · ${l.label}</div></td><td>${l.who}</td>
        <td><span class="tag st-${l.state}">${STATE_NAMES[l.state] || l.state}</span></td><td class="r ${Number(l.amount) < 0 ? 'neg' : ''}">${peso(l.amount)}</td>
        <td>${l.state === 'collected' && INVOICE_KINDS.includes(l.ref_kind) && Number(l.amount) > 0
          ? html`<form class="inline-form inv-form" data-kind="${l.ref_kind}" data-id="${l.ref_id}"><input name="no" maxlength="60" value="${l.invoice_no || ''}" aria-label="BIR receipt number" placeholder="Add"><button class="btn btn-sm btn-ghost">Save</button></form>`
          : l.invoice_no || ''}</td></tr>`)}
    </tbody></table></div>${when(list.length > 400, html`<div class="sheet-foot">Showing 400 of ${list.length}. Search or pick a month, or download everything.</div>`)}
    ${when(!list.length, html`<p class="muted pad">Nothing matches.</p>`)}</section>`;
}
on('ledger-csv', () => download(`pinoypermit-payments-${data.today}.csv`, toCsv(ledgerCsv(filterLedger(data.lines, st.ledger)))));
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
    try { await db.adminSetInvoiceNo(f.dataset.kind, f.dataset.id, no); toast(no ? 'Receipt number saved.' : 'Receipt number removed.'); rerender(); } catch (err) { toastError(err); }
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
