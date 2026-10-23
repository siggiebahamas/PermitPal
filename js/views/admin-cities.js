// Admin > City deadlines: when a city extends its business permit deadline (an ordinance, a treasurer's notice, a
// news report), type it once here: the city, the new date and the link. Every workspace with a business permit in that
// city still due before the new date is told at once (in the app and by email), and each customer moves the date in
// one tap. A second entry for the same city and year replaces the first (permits already moved follow along); taking one
// back puts moved permits on their old date and sends a correction. The database checks every rule.
import { html, fmtDate, fmtDateTime, toast, toastError, when, plural, confirmDialog, todayPH } from '../util.js';
import { on, rerender } from '../core.js';
import { loadCityDates } from './citydates.js';
import * as db from 'pp/data';

let cache = { counts: [], list: [] };
const year = () => Number(todayPH().slice(0, 4));

export async function citiesTab() {
  const [counts, list] = await Promise.all([db.adminCityCounts(), db.adminCityDeadlines()]);
  cache = { counts, list };
  const live = list.filter((d) => !d.withdrawn_at);
  // January: the coming deadline is this year's; the rest of the year, it's next year's.
  const y = year(), m = Number(todayPH().slice(5, 7));
  const years = m === 1 ? [y, y + 1] : [y + 1, y];
  return html`
    <section class="card city-add"><div class="card-head"><div><h2>Announce a deadline extension</h2>
      <p class="card-sub">Everyone with a business permit in that city still due before the new date is told in the app and by email, with one tap to take the new date.
        Only announce what the city published: link its notice, or a news report that quotes it.</p></div></div>
      <form class="adm-city-form" novalidate>
        <div class="grid2">
          <label class="field"><span>City or municipality</span><input name="city" list="adm-city-list" maxlength="80" required autocomplete="off" placeholder="e.g. Manila">
            <datalist id="adm-city-list">${counts.map((c) => html`<option value="${c.city_name}">${c.city_name}: ${plural(c.workspaces, 'workspace')}, ${plural(c.permits, 'business permit')}</option>`)}</datalist>
            <small data-city-hint class="muted">${counts.length ? `${plural(counts.length, 'city', 'cities')} with business permits in Pinoy Permit.` : 'No business permits yet.'}</small></label>
          <label class="field"><span>For the permit year</span><select name="year">${years.map((v) => html`<option value="${v}">${v}</option>`)}</select></label>
          <label class="field"><span>New deadline</span><input type="date" name="due_on" required min="${todayPH()}"></label>
          <label class="field"><span>Link to the notice or news report</span><input type="url" name="source_url" maxlength="500" required placeholder="https://"></label>
        </div>
        <label class="field"><span>Note for customers <small>(optional)</small></span><input name="note" maxlength="300" placeholder="e.g. No surcharge or interest until then, per the City Treasurer"></label>
        <button type="button" class="btn btn-primary" data-act="adm-city-add">Tell everyone affected</button>
      </form>
    </section>
    <section class="card"><div class="card-head"><div><h2>Extensions announced</h2>
      <p class="card-sub">${live.length ? `${plural(live.length, 'live extension')}.` : 'None live.'} Customers see live ones on their permits and dashboard until they take the new date.</p></div></div>
      ${list.length ? list.map((d) => html`<div class="line"><div class="line-main"><b>${d.city_name} ${d.permit_year}: ${fmtDate(d.due_on)}</b>
          <small>from ${fmtDate(d.was_on)} · told ${plural(d.notified, 'workspace')} · ${plural(d.moved, 'permit')} moved · ${fmtDateTime(d.created_at)}${d.note ? ` · ${d.note}` : ''}
            · <a href="${d.source_url}" target="_blank" rel="noopener noreferrer">source</a></small></div>
        <div class="btn-row">${d.withdrawn_at ? html`<span class="chip needinfo">Withdrawn ${fmtDate(String(d.withdrawn_at).slice(0, 10))}</span>`
          : html`<span class="chip ok">Live</span><button class="btn btn-sm btn-ghost" data-act="adm-city-withdraw" data-id="${d.id}">Withdraw</button>`}</div></div>`)
        : html`<p class="muted">Nothing yet. Cities usually announce extensions in mid-January.</p>`}
    </section>
    <section class="card"><div class="card-head"><div><h2>Business permits by city</h2><p class="card-sub">How customers spell the city, grouped ("QC" and "Quezon City" are one).</p></div></div>
      ${counts.length ? html`<div class="city-counts">${counts.slice(0, 40).map((c) => html`<div class="hol-row"><span><b>${c.city_name}</b></span>
        <span class="muted small">${plural(c.workspaces, 'workspace')} · ${plural(c.permits, 'permit')}</span></div>`)}</div>` : html`<p class="muted">No business permits yet.</p>`}
    </section>`;
}

// this browser's own copy of the list too (staff are often customers of their own app)
const reload = async () => { try { await loadCityDates(true); await rerender(); } catch (e) { toastError(e); } };

on('adm-city-add', async (ds, btn) => {
  const f = btn.closest('form');
  const v = { city: f.city.value.trim(), year: f.year.value, due_on: f.due_on.value, source_url: f.source_url.value.trim(), note: f.note.value.trim() };
  if (!v.city) return toast('Choose the city.', 'error');
  if (!v.due_on) return toast('Choose the new deadline.', 'error');
  if (!/^https:\/\/\S{4,}$/.test(v.source_url)) return toast("Add the link to the city's notice or a news report (starting with https://).", 'error');
  const c = cache.counts.find((x) => x.city_name.toLowerCase() === v.city.toLowerCase());
  const replaces = cache.list.find((d) => !d.withdrawn_at && d.permit_year === Number(v.year) && d.city_name.toLowerCase() === v.city.toLowerCase());
  const ok = await confirmDialog(`Announce ${v.city}'s new deadline?`,
    `${fmtDate(v.due_on)} for ${v.year} business permits. ${c ? `Up to ${plural(c.workspaces, 'workspace')} in ${c.city_name} will be told` : 'No workspace has a business permit there yet, so nobody is told now'}` +
    `${replaces ? `. This replaces ${fmtDate(replaces.due_on)}; permits already moved to it follow` : ''}. Emails can't be taken back.`,
    { confirmLabel: 'Tell them', danger: false });
  if (!ok) return;
  btn.disabled = true;
  try {
    const r = await db.adminCityDeadline(v);
    toast(r.workspaces ? `Told ${plural(r.workspaces, 'workspace')} (${plural(r.permits, 'permit')} still due earlier${r.moved ? `, ${r.moved} moved along` : ''}).` : 'Saved. Nobody had a permit due earlier there.');
    reload();
  } catch (e) { btn.disabled = false; toastError(e); }
});

on('adm-city-withdraw', async (ds) => {
  const d = cache.list.find((x) => x.id === ds.id);
  if (!d) return;
  const ok = await confirmDialog(`Withdraw ${d.city_name}'s extension?`,
    `Only if it was a mistake. ${d.moved ? `${plural(d.moved, 'permit')} moved to ${fmtDate(d.due_on)} go back to their old date, and their owners get a correction.` : 'Nobody took the new date yet.'}`,
    { confirmLabel: 'Withdraw' });
  if (!ok) return;
  try { const n = await db.adminCityDeadlineWithdraw(d.id); toast(n ? `Withdrawn. ${plural(n, 'permit')} back on the old date.` : 'Withdrawn.'); reload(); } catch (e) { toastError(e); }
});
