// Who is responsible, at every step of a done-for-you order, said plainly and shown where people look:
// on Home, at the top of Done for you, on the order itself and on the permit.
//   You: send the papers, sign, pay.  Pinoy Permit: prepare and file.  The government office: process and decide.
// From the day it is filed, the office's speed and decision are the office's, by law (RA 11032 sets its time limit).
import { html, fmtDate, todayPH, plural } from '../util.js';
import { S, has, service } from '../core.js';
import { ICON } from '../components.js';
import { workdaysBetween } from '../workdays.js';
import * as db from 'pp/data';

let HOL = null;
async function holidays() {
  if (HOL) return HOL;
  try { const t = todayPH(); const y = (n) => `${Number(t.slice(0, 4)) + n}${t.slice(4)}`; HOL = new Set((await db.holidays(y(-1), y(1))).map((h) => h.day)); }
  catch { HOL = new Set(); }
  return HOL;
}
const short = (ag) => String(ag).split(' (')[0];
export const agencyOf = (a) => a.agency || service(a.service_code)?.agency || 'the government office';
const open = (a) => !['completed', 'cancelled'].includes(a.status);
// Filed: an open order with a filing date (the office has it). The database keeps it 'in progress'.
export const isFiled = (a) => !!a && !!a.filed_on && open(a);
export const filedOrders = () => (S.data?.requests || []).filter(isFiled);

// Where the office is on its legal clock: day n of N, or how many working days late.
export function clockOf(a, hol = HOL || new Set()) {
  const today = todayPH();
  const days = Number(a.agency_days) || 0;
  const used = Math.max(0, workdaysBetween(a.filed_on, today, hol));
  const late = a.agency_due_on && today > a.agency_due_on ? Math.max(1, workdaysBetween(a.agency_due_on, today, hol)) : 0;
  return { days, used: Math.min(used, days || used), late, due: a.agency_due_on };
}

// The four steps, each with who owns it. The step happening now is marked "Responsible now".
export function whoPanel(a, { compact = false } = {}) {
  if (!has('govclock')) return '';
  const ag = agencyOf(a);
  const paid = ['paid', 'waived'].includes(a.payment_status);
  const now = a.status === 'completed' ? 4 : isFiled(a) ? 2 : paid ? 1 : 0;
  const days = a.agency_days || service(a.service_code)?.agency_days;
  const steps = [
    ['you', 'You', 'Send complete papers, sign the authorization letter and pay.'],
    ['us', 'Pinoy Permit', `Prepare everything and file it with ${ag}.${service(a.service_code)?.turnaround ? ' ' + service(a.service_code).turnaround + '.' : ''}`],
    ['gov', `${short(ag)} (government)`, `Processes and decides: approves, asks for more, or denies.${days ? ` By law, within ${plural(days, 'working day')} after filing.` : ''} Its speed and its decision are ${short(ag)}'s responsibility, not Pinoy Permit's.`],
    ['gov', `${short(ag)} (government)`, 'Releases the permit or certificate. We save it to your account and set your next reminder.'],
  ];
  const c = isFiled(a) ? clockOf(a) : null;
  return html`<section class="card resp ${compact ? 'compact' : ''}" aria-labelledby="who-${a.id}">
    <div class="card-head"><div><h2 id="who-${a.id}">Who is responsible right now</h2>
      <p class="card-sub">${now >= 2 && a.status !== 'completed' ? html`<b>${ag}</b>, a government office. Pinoy Permit's part is done.` : now === 1 ? 'Pinoy Permit: we are preparing and filing.' : now === 0 ? 'You: send your papers and pay to start.' : 'Done.'}</p></div></div>
    ${c ? govClock(a, c) : ''}
    <ol class="who-steps">${steps.map(([who, name, what], i) => html`<li class="who-${who} ${i < now || a.status === 'completed' ? 'done' : i === now ? 'now' : ''}">
      <span class="who-n" aria-hidden="true">${i < now || a.status === 'completed' ? '✓' : i + 1}</span>
      <div><span class="who-tag">${name}</span>${i === now && a.status !== 'completed' ? html`<em class="who-now">Responsible now</em>` : ''}<p>${what}</p></div></li>`)}</ol>
    ${compact ? '' : liability(ag)}
  </section>`;
}

// The office's clock, big: filed on, the legal deadline, day n of N, or late.
export function govClock(a, c = clockOf(a)) {
  const ag = agencyOf(a);
  return html`<div class="gclock ${c.late ? 'late' : ''}">
    <div class="gclock-top"><span class="gclock-ag">${ICON.building}<b>${ag}</b></span>
      <span class="gclock-state">${c.late ? `${plural(c.late, 'working day')} late` : `Day ${Math.max(c.used, 0)} of ${c.days}`}</span></div>
    <div class="gclock-bar" aria-hidden="true"><i style="width:${c.late ? 100 : Math.min(100, Math.round((100 * c.used) / Math.max(1, c.days)))}%"></i></div>
    <p class="gclock-line">Filed ${fmtDate(a.filed_on)}${a.agency_ref ? ` · Reference ${a.agency_ref}` : ''} · By law ${short(ag)} must act by <b>${fmtDate(c.due)}</b> (${plural(c.days, 'working day')}, RA 11032).</p>
    ${c.late ? html`<p class="gclock-blame"><b>This delay is ${short(ag)}'s, not Pinoy Permit's.</b> Pinoy Permit filed on time; what the office does next is up to the office.${a.requirement_id ? html` If you wish, you can send your own follow-up letter or an ARTA complaint from <a href="#/requirement/${a.requirement_id}">the permit</a>.` : ''}</p>`
      : html`<p class="gclock-note">Waiting on ${short(ag)}. Pinoy Permit cannot speed up a government office or decide for it.</p>`}
  </div>`;
}

// Plain list of who answers for what.
export const liability = (ag = 'the government office') => html`<div class="liab">
  <div class="liab-col us"><h3>Pinoy Permit is responsible for</h3><ul>
    <li>Preparing your papers correctly and filing them on time</li><li>Showing you every update here, as it happens</li>
    <li>Refunding our service fee in full if we can't file</li><li>Government fees at cost, with official receipts</li></ul></div>
  <div class="liab-col gov"><h3>${short(ag)} is responsible for</h3><ul>
    <li>How long processing takes after filing</li><li>Approving, asking for more papers, or denying</li>
    <li>Its own website, system outages and queues</li><li>Its fees, penalties and any rule changes</li></ul></div>
  <p class="liab-foot"><b>Pinoy Permit does not control government offices and is not liable for their delays, decisions, outages, added requirements, fees or penalties.</b> We never pay anyone to speed things up: that is illegal (RA 11032).</p>
</div>`;

// Home and the top of Done for you: everything currently waiting on a government office.
export function waitingCard({ title = 'Waiting on government offices' } = {}) {
  if (!has('govclock')) return '';
  const list = filedOrders();
  if (!list.length) return '';
  return html`<section class="card gov-wait" data-gov-wait aria-labelledby="gw-h">
    <div class="card-head"><div><h2 id="gw-h">${ICON.building} ${title}</h2>
      <p class="card-sub">We filed these. Each office now has its legal time to act. <b>Delays from here are the office's, not Pinoy Permit's.</b></p></div></div>
    <ul class="gw-list">${list.map((a) => { const c = clockOf(a); return html`<li><a href="#/services/orders/${a.id}" class="gw-row ${c.late ? 'late' : ''}">
      <span class="gw-main"><b>${a.requirement_name}</b><small>With <b>${agencyOf(a)}</b> since ${fmtDate(a.filed_on)} · must act by ${fmtDate(c.due)}</small></span>
      <span class="chip ${c.late ? 'overdue' : 'progress'}">${c.late ? `${agencyOf(a).split(' (')[0]} is ${plural(c.late, 'working day')} late` : `Day ${c.used} of ${c.days}`}</span></a></li>`; })}</ul>
  </section>`;
}
// The clock needs the holiday list; once loaded, repaint the day counts.
export async function paintWaiting(root) {
  if (!has('govclock') || !filedOrders().length || HOL) return;
  await holidays();
  const slot = root?.querySelector('[data-gov-wait]');
  if (slot && document.body.contains(slot)) slot.outerHTML = String(waitingCard());
}
export { holidays as loadHolidays };
