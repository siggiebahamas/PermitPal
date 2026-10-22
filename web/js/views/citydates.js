// City deadlines on the customer's side: when a city extends its business permit deadline (PermitPal staff announce it,
// with the source), every business permit there still showing an earlier date gets a banner with one tap to take the new
// date; the dashboard gathers them. Quezon City's own rule (a year from the issue date) is offered the same way.
// "Keep" only hides the banner on this device.
import { html, fmtDate, toast, toastError, when, plural } from '../util.js';
import { S, on, has, canEdit, reload, rerender, reqById, business, location_, locationsOf } from '../core.js';
import { cityKey, extensionFor, anniversaryDue } from '../citydates.js';
import * as db from 'pp/data';

export const CD = { rules: [], deadlines: [], at: 0 };
// Small public lists, read once when the workspace opens (and again after ten minutes).
export async function loadCityDates(force = false) {
  if (!has('citydates')) return CD;
  if (!force && CD.at && Date.now() - CD.at < 600000) return CD;
  try { Object.assign(CD, await db.cityDates(), { at: Date.now() }); } catch { /* the banners just don't show */ }
  return CD;
}

// Opening a city notice (its link ends in ?city=1): read the list again, so the new date is there.
window.addEventListener('hashchange', () => { if (/[?&]city=1/.test(location.hash) && has('citydates')) loadCityDates(true).then(() => rerender()); });

// The permit's city: its branch, or the business's main branch.
export function cityOf(r) {
  if (!r?.business_id) return '';
  const loc = (r.location_id && location_(r.location_id)) || locationsOf(r.business_id).find((l) => l.is_main) || locationsOf(r.business_id)[0];
  return loc?.city || r.location_city || '';
}
export const cityRule = (city) => (city ? CD.rules.find((x) => x.city_key === cityKey(city)) || null : null);
export const cityExtensions = (city) => (city ? CD.deadlines.filter((d) => d.city_key === cityKey(city)) : []);

const hidden = (key) => { try { return localStorage.getItem('pp-city:' + key) === '1'; } catch { return false; } };
const hide = (key) => { try { localStorage.setItem('pp-city:' + key, '1'); } catch { /* it shows again next time */ } };
const short = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const source = (url) => html`<a href="${url}" target="_blank" rel="noopener noreferrer">Source <span aria-hidden="true">↗</span><span class="sr-only"> (opens in a new tab)</span></a>`;

// On a business permit's page.
export function cityBanner(r) {
  if (!has('citydates') || r.type_code !== 'mayors_permit') return '';
  const city = cityOf(r);
  const d = extensionFor(r, city, CD.deadlines);
  if (d && !hidden(`${d.id}:${r.id}`)) {
    return html`<div class="banner info city-banner" data-city-banner>
      <div><b>${d.city_name} extended the ${d.permit_year} business permit deadline to ${fmtDate(d.due_on)}.</b>
        This permit still shows ${fmtDate(r.expires_on)}.${when(d.note, html` ${d.note}.`)} ${source(d.source_url)}</div>
      ${when(canEdit(), html`<div class="banner-actions">
        <button class="btn btn-sm btn-primary" data-act="city-use" data-id="${d.id}" data-reqs="${r.id}">Use ${short(d.due_on)}</button>
        <button class="btn btn-sm btn-ghost" data-act="city-keep" data-key="${d.id}:${r.id}">Keep ${short(r.expires_on)}</button></div>`)}
    </div>`;
  }
  const rule = cityRule(city);
  const due = anniversaryDue(r, rule);
  if (due && !hidden(`rule:${r.cycle_id}`)) {
    return html`<div class="banner info city-banner" data-city-banner>
      <div><b>${rule.city_name} counts a year from the issue date.</b> This permit was issued ${fmtDate(r.issued_on)}, so it's due
        ${fmtDate(due)}, not ${fmtDate(r.expires_on)}. ${source(rule.source_url)}</div>
      ${when(canEdit(), html`<div class="banner-actions">
        <button class="btn btn-sm btn-primary" data-act="city-rule-use" data-id="${r.id}" data-date="${due}">Use ${short(due)}</button>
        <button class="btn btn-sm btn-ghost" data-act="city-keep" data-key="rule:${r.cycle_id}">Keep ${short(r.expires_on)}</button></div>`)}
    </div>`;
  }
  return '';
}

// On the dashboard: each extension that still applies to some of this workspace's permits, with one tap for all of them.
export function cityDashBanner() {
  if (!has('citydates') || !CD.deadlines.length || !S.data) return '';
  const groups = new Map();
  for (const r of S.data.reqs) {
    const d = extensionFor(r, cityOf(r), CD.deadlines);
    if (!d || hidden(`${d.id}:all`) || hidden(`${d.id}:${r.id}`)) continue;
    if (!groups.has(d.id)) groups.set(d.id, { d, reqs: [] });
    groups.get(d.id).reqs.push(r);
  }
  return [...groups.values()].map(({ d, reqs }) => {
    const names = reqs.map((r) => business(r.business_id)?.name + (r.location_name && !r.location_is_main ? ` (${r.location_name})` : '')).filter(Boolean);
    return html`<div class="banner info city-banner" data-city-banner>
      <div><b>${d.city_name} extended the ${d.permit_year} business permit deadline to ${fmtDate(d.due_on)}.</b>
        ${reqs.length === 1 ? html`${names[0]}'s permit still shows ${fmtDate(reqs[0].expires_on)}.` : html`${plural(reqs.length, 'permit')} here still show an earlier date: ${names.join(', ')}.`}
        ${when(d.note, html`${d.note}.`)} ${source(d.source_url)}</div>
      ${when(canEdit(), html`<div class="banner-actions">
        <button class="btn btn-sm btn-primary" data-act="city-use" data-id="${d.id}" data-reqs="${reqs.map((r) => r.id).join(',')}">Use ${short(d.due_on)}${reqs.length > 1 ? ` for all ${reqs.length}` : ''}</button>
        <button class="btn btn-sm btn-ghost" data-act="city-keep" data-key="${d.id}:all">Not now</button></div>`)}
    </div>`;
  });
}

on('city-use', async (ds, btn) => {
  btn.disabled = true;
  try {
    const n = await db.useCityDeadline(ds.id, ds.reqs.split(','));
    const d = CD.deadlines.find((x) => x.id === ds.id);
    toast(n ? `Done: ${plural(n, 'permit')} now due ${d ? fmtDate(d.due_on) : 'on the new date'}. Reminders follow the new date.` : 'Already up to date.');
    await reload();
  } catch (e) { btn.disabled = false; toastError(e); }
});
on('city-keep', (ds) => { hide(ds.key); rerender(); });
on('city-rule-use', async (ds, btn) => {
  const r = reqById(ds.id);
  if (!r?.cycle_id) return;
  btn.disabled = true;
  try {
    await db.saveCycle({ cycleId: r.cycle_id, orgId: r.org_id, requirementId: r.id, reference_no: r.reference_no, issuer: r.issuer,
      issued_on: r.issued_on, expires_on: ds.date, amount_paid: r.amount_paid });
    toast(`Done: due ${fmtDate(ds.date)}. Reminders follow the new date.`);
    await reload();
  } catch (e) { btn.disabled = false; toastError(e); }
});
