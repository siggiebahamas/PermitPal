// Smaller tools: partners & introductions, costs & yearly budget,
// shareable proof-of-compliance links, the inspection pack (.zip) and calendar export (.ics).
import { html, fmtDate, fmtDateTime, peso, toast, toastError, when, plural, timeAgo, openModal, formObject, normalizePhone, todayPH, download, confirmDialog } from '../util.js';
import { S, on, go, reload, canEdit, business, vehicle, person, reqsOf, empty, has, hasPlus } from '../core.js';
import { STATUS, byPriority, subjectLabel, duePill, ICON, counts } from '../components.js';
import * as db from 'pp/data';
import { makeZip } from '../zip.js';
import { trustSection } from './trust.js';
import { maxPenalty } from '../penalty.js';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ================================================================ professionals (independent firms)
// Firms that file and renew in person (liaison, accounting, fire safety...). Customers deal with
// them directly; Pinoy Permit only checks their license, lists them, and sends them quote requests.
export const PARTNER_CATEGORIES = {
  liaison: 'Permit & registration filing', bookkeeping: 'Accounting, bookkeeping & BIR', fire_safety: 'Fire safety & extinguishers',
  pest_control: 'Pest control', health_clinic: 'Health cards & medical exams', emission_testing: 'Emission testing',
  vehicle_inspection: 'Vehicle inspection (PMVIC)', insurance: 'Insurance agents', notary: 'Notary public', other: 'Other services',
};
let partnersCache = null;
export const loadPartners = async () => (partnersCache ||= await db.listPartners().catch(() => []));
// One quiet, labelled line on a matching checklist step (firms pay to be there; people can switch them off).
let placementsCache = null;
export const loadPlacements = async () => (has('revenue') ? (placementsCache ||= await db.listPlacements().catch(() => [])) : []);
export function placementFor(r, itemKey) {
  if (!has('revenue') || S.profile?.show_partner_offers === false || !placementsCache) return null;
  const city = r.location_city || '';
  return placementsCache.find((p) => p.type_code === r.type_code && (p.item_key || null) === (itemKey || null)
    && (!p.cities?.length || (city && p.cities.includes(city)))) || null;
}
export function placementLine(p, r) {
  return html`<div class="ck-partner" data-placement="${p.id}">
    <span class="ck-partner-tag">Partner</span>
    <span class="ck-partner-text"><b>${p.partner_name}</b> · ${p.headline}</span>
    <span class="ck-partner-acts">${canEdit() ? html`<button type="button" class="linklike" data-act="placement-quote" data-id="${p.partner_id}" data-req="${r.id}" data-pl="${p.id}">Request a quote</button> · ` : ''}<button type="button" class="linklike" data-act="placement-why">Why this?</button></span>
  </div>`;
}
// Counted once per person per day (the server enforces it); only lines actually on screen count.
const seenNow = new Set();
export function trackPlacements(root) {
  if (!has('revenue') || !root) return;
  const log = (scope) => {
    const ids = [...scope.querySelectorAll('[data-placement]')].filter((x) => x.getClientRects().length).map((x) => x.dataset.placement).filter((id) => !seenNow.has(id));
    if (!ids.length) return;
    ids.forEach((id) => seenNow.add(id));
    db.logPlacement(ids, 'view').catch(() => {});
  };
  root.querySelectorAll('details.checklist').forEach((d) => { if (d.open) log(d); d.addEventListener('toggle', () => { if (d.open) log(d); }); });
}
on('placement-quote', async (ds) => {
  await loadPartners();
  db.logPlacement([ds.pl], 'click').catch(() => {});
  partnerIntro(ds.id, ds.req || null, ds.pl);
});
on('placement-why', () => openModal('Why am I seeing this?', html`
  <p>Pinoy Permit shows one firm on a checklist step when it matches the step and your city. The firm pays Pinoy Permit to be listed there.</p>
  <ul class="small"><li>It never changes the firm's price, and you don't have to use them.</li>
    <li>Firms tell us they are registered and licensed. Pinoy Permit doesn't check their papers: ask to see them before you hire.</li>
    <li>We only share your details if you press "Request a quote".</li></ul>
  <p class="muted small">Rather not see these? Turn them off in <a href="#/settings">Settings</a>.</p>`));
let proCat = 'all';
let proCity = 'all';

export async function partners(el, params = new URLSearchParams()) {
  el.innerHTML = String(html`<div class="loading">Loading…</div>`);
  let list = [], mine = [];
  try { [list, mine] = await Promise.all([loadPartners(), db.myReferrals(S.org.id)]); } catch (e) { toastError(e); }
  if (params.get('cat')) proCat = params.get('cat');
  const cats = Object.keys(PARTNER_CATEGORIES).filter((c) => list.some((p) => p.category === c));
  const cities = [...new Set(list.flatMap((p) => p.cities || []))].sort();
  const myCities = [...new Set(S.data.locations.map((l) => l.city).filter(Boolean))];
  const shown = list.filter((p) => (proCat === 'all' || p.category === proCat) && (proCity === 'all' || !p.cities?.length || p.cities.includes(proCity)));
  el.innerHTML = String(html`
    <div class="page-head"><div><h1>Find a professional</h1><p class="page-sub">Licensed firms who handle permits for you. Ask for a quote, free.</p></div></div>
    <section class="card promises pro-promises">
      <div class="promise p-blue">${ICON.briefcase}<div><b>Independent firms</b><span>Each one vouches for its own registration and licenses.</span><em class="pro-note">Pinoy Permit doesn't check their papers, so ask to see them.</em></div></div>
      <div class="promise p-jade">${ICON.share}<div><b>Straight to them</b><span>Your request goes to the firm. Replies within 1 business day.</span></div></div>
      <div class="promise p-gold">${ICON.check}<div><b>No obligation</b><span>Compare quotes. Hire only who you trust.</span></div></div>
    </section>
    ${list.length ? html`<div class="filters pro-filters">
        <select data-pro-cat aria-label="Service"><option value="all">All services</option>${cats.map((c) => html`<option value="${c}" ${proCat === c ? 'selected' : ''}>${PARTNER_CATEGORIES[c]}</option>`)}</select>
        ${when(cities.length, html`<select data-pro-city aria-label="City"><option value="all">All cities</option>${cities.map((c) => html`<option value="${c}" ${proCity === c ? 'selected' : ''}>${c}${myCities.includes(c) ? ' (yours)' : ''}</option>`)}</select>`)}
      </div>
      ${shown.length ? html`<div class="svc-grid">${shown.map(proCard)}</div>` : html`<p class="muted">No firms match yet. Try "All cities".</p>`}`
      : empty("We're onboarding firms", 'Liaison firms, accountants and fire-safety providers in your area will appear here as they join.')}
    ${when(mine.length, html`<section class="card"><div class="card-head"><h2>Your quote requests</h2></div>
      ${mine.map((r) => { const p = list.find((x) => x.id === r.partner_id); return html`<div class="line"><span class="line-main"><b>${p?.name || 'Professional'}</b><small>${r.note || ''} · ${timeAgo(r.created_at)}</small></span>
        ${has('leads') && canEdit() && ['requested', 'introduced'].includes(r.status)
          ? html`<span class="hired-ask"><span class="muted small">Did you hire them?</span><button class="btn btn-sm btn-soft" data-act="ref-hired" data-id="${r.id}" data-hired="1">Yes</button><button class="btn btn-sm btn-ghost" data-act="ref-hired" data-id="${r.id}" data-hired="">No</button></span>`
          : html`<span class="chip ${r.status === 'converted' ? 'ok' : r.status === 'not_converted' ? 'needinfo' : 'progress'}">${{ requested: 'Sent', introduced: 'They replied', converted: 'Hired', not_converted: has('leads') ? "Didn't hire" : 'Closed' }[r.status] || 'Sent'}</span>`}</div>`; })}</section>`)}
    <p class="fineprint">Listed firms pay Pinoy Permit for the quote requests we send them (or a flat monthly fee). It never changes their price, and you're free to choose anyone.${has('revenue') ? '' : ' Pinoy Permit does not file anything with the government itself.'}</p>
    ${when(has('revenue'), html`<p class="fineprint">Run a liaison, accounting or fire-safety firm? <a href="#/list-your-firm">Apply to be listed</a>.</p>`)}`);
}
document.addEventListener('change', (e) => {
  if (e.target.matches('[data-pro-cat]')) { proCat = e.target.value; partners(document.getElementById('main')); }
  if (e.target.matches('[data-pro-city]')) { proCity = e.target.value; partners(document.getElementById('main')); }
});

function proCard(p) {
  return html`<section class="card svc partner">
    <div class="svc-top"><h2>${p.name}</h2></div>
    <p class="muted small pro-cat">${PARTNER_CATEGORIES[p.category] || ''}${p.licence ? ' · ' + p.licence : ''}</p>
    <p class="svc-sum">${p.description}</p>
    ${when(p.services, html`<p class="small"><b>Handles:</b> ${p.services}</p>`)}
    ${when((p.cities || []).length || p.coverage, html`<p class="muted small">Serves: ${(p.cities || []).join(', ') || p.coverage}</p>`)}
    <div class="svc-foot"><span></span>
      ${when(canEdit(), html`<button class="btn btn-primary btn-sm" data-act="partner-intro" data-id="${p.id}">Request a quote</button>`)}</div>
  </section>`;
}

export function partnerIntro(partnerId, requirementId = null, placementId = null) {
  const p = (partnersCache || []).find((x) => x.id === partnerId);
  if (!p) return;
  const r = requirementId ? S.data.reqs.find((x) => x.id === requirementId) : null;
  openModal(`Request a quote from ${p.name}`, html`
    ${when(r, html`<div class="quote-hint"><b>${r?.name}</b> <span class="muted">${r?.subject_name || ''}${r?.location_city ? ' · ' + r.location_city : ''}</span></div>`)}
    <label class="field"><span>What do you need?</span><textarea name="note" rows="3" maxlength="1000" placeholder="${r ? 'e.g. Please renew this before the deadline. Documents are ready.' : 'e.g. Mayor\'s Permit renewal for 2 branches in Pasig'}"></textarea></label>
    <div class="grid2">
      <label class="field"><span>Best way to reach you</span><select name="contact_method"><option value="phone">Phone call / SMS</option><option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="viber">Viber</option></select></label>
      <label class="field"><span>Mobile or email</span><input name="contact_value" value="${S.profile.phone || ''}" maxlength="120"></label>
    </div>
    <p class="muted small">We'll send ${p.name} your name, business name, contact details${r ? ', this permit and its expiry date' : ''} and your message, nothing else. They'll contact you directly.</p>`, {
    submitLabel: 'Send request',
    onSubmit: async (fd) => {
      const f = formObject(fd);
      let v = f.contact_value;
      if (f.contact_method === 'email') { if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) throw new Error('Please enter a valid email address.'); }
      else { v = normalizePhone(v); if (!v) throw new Error('Please enter a valid mobile number.'); }
      await db.requestReferral({ org_id: S.org.id, partner_id: p.id, requirement_id: requirementId, note: f.note, contact_method: f.contact_method, contact_value: v, placement_id: placementId });
      toast(`Sent. ${p.name} will contact you within 1 business day.`);
      if (location.hash.startsWith('#/pros')) partners(document.getElementById('main'));
    },
  });
}
on('partner-intro', async (ds) => { await loadPartners(); partnerIntro(ds.id, ds.req || null); });
// "Did you hire them?" One tap. It tells Pinoy Permit which firms do good work.
on('ref-hired', async (ds) => {
  try { await db.answerReferral(ds.id, !!ds.hired); toast(ds.hired ? 'Thanks. Glad it worked out.' : 'Thanks for telling us.'); partners(document.getElementById('main')); } catch (e) { toastError(e); }
});

// Requirement page: firms who can file this permit for you.
export function partnerSuggestions(r) {
  const city = r.location_city;
  const fits = (p) => (p.type_codes?.includes(r.type_code) || (p.category === 'liaison' && r.subject === 'business'))
    && (!city || !p.cities?.length || p.cities.includes(city));
  const fit = (partnersCache || []).filter(fits).slice(0, 3);
  return html`<section class="card pro-help"><div class="card-head"><div><h2>Rather not queue for this?</h2>
      <p class="card-sub">Independent firms${city ? ' serving ' + city : ''} can file it for you. You deal with them directly.</p></div></div>
    ${fit.length ? fit.map((p) => html`<div class="line"><span class="line-main"><b>${p.name}</b>
      <small>${PARTNER_CATEGORIES[p.category] || ''}${p.cities?.length ? ' · ' + p.cities.slice(0, 3).join(', ') : ''}</small></span>
      ${when(canEdit(), html`<button class="btn btn-sm btn-soft" data-act="partner-intro" data-id="${p.id}" data-req="${r.id}">Request a quote</button>`)}</div>`)
      : html`<p class="muted small">No listed firm for this yet. <a href="#/pros">See all professionals</a>.</p>`}
  </section>`;
}

// ================================================================ costs & budget
export async function costs(el) {
  el.innerHTML = String(html`<div class="loading">Loading…</div>`);
  let cycles = [];
  try { cycles = await db.allCycles(S.org.id); } catch (e) { toastError(e); }
  const today = todayPH();
  const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  const reqs = S.data.reqs;
  const live = new Set(reqs.map((r) => r.id));
  const spent = cycles.filter((c) => live.has(c.requirement_id) && c.amount_paid != null && (c.issued_on || c.created_at.slice(0, 10)) >= yearAgo);
  const spentTotal = spent.reduce((t, c) => t + Number(c.amount_paid), 0);

  // Next 12 months: every dated renewal, valued at what was paid last time.
  const [ty, tm] = today.split('-').map(Number);
  const months = [];
  for (let i = 0; i < 12; i++) {
    const m = ((tm - 1 + i) % 12) + 1, y = ty + Math.floor((tm - 1 + i) / 12);
    months.push({ key: `${y}-${String(m).padStart(2, '0')}`, label: `${MON[m - 1]} ${y}`, items: [] });
  }
  const overdue = { key: 'late', label: 'Overdue now', items: [] };
  for (const r of reqs) {
    if (!r.expires || !r.expires_on) continue;
    if (r.expires_on < today) overdue.items.push(r);
    else months.find((m) => m.key === r.expires_on.slice(0, 7))?.items.push(r);
  }
  const rows = [overdue, ...months].filter((m) => m.items.length);
  const known = (list) => list.filter((r) => r.amount_paid != null).reduce((t, r) => t + Number(r.amount_paid), 0);
  const unknown = (list) => list.filter((r) => r.amount_paid == null).length;
  const all = rows.flatMap((m) => m.items);
  const busiest = months.reduce((b, m) => (known(m.items) > known(b?.items || []) ? m : b), null);

  el.innerHTML = String(html`
    <div class="page-head"><div><h1>Costs & budget</h1><p class="muted">How much your permits cost, and what's coming next.</p></div></div>
    <div class="stats four">
      <div class="stat ok"><div class="stat-n">${peso(spentTotal)}</div><div class="stat-l" title="Paid in the last 12 months">Paid, last 12 mos</div></div>
      <div class="stat soon"><div class="stat-n">${peso(known(all))}</div><div class="stat-l" title="Expected in the next 12 months">Due, next 12 mos</div></div>
      <div class="stat progress"><div class="stat-n">${busiest && known(busiest.items) ? busiest.label.split(' ')[0] : '—'}</div><div class="stat-l">Biggest month</div></div>
      <div class="stat needinfo"><div class="stat-n">${unknown(all)}</div><div class="stat-l" title="Renewals with no amount yet">No amount yet</div></div>
    </div>
    ${rows.length ? html`<section class="card">
      <div class="card-head"><div><h2>Coming up</h2><p class="card-sub">Estimates use the amount you entered for each permit's current record</p></div></div>
      ${rows.map((m) => html`<div class="band month ${m.key === 'late' ? 'overdue' : ''}"><span>${m.label}</span><span>${peso(known(m.items))}</span></div>
        ${m.items.sort(byPriority).map((r) => html`<a class="line cost-line ${STATUS[r.status]?.cls || ''}" href="#/requirement/${r.id}"><span class="line-main"><b>${r.name}</b><small>${subjectLabel(r)}</small></span>
          <span class="cost-side">${duePill(r)}${r.amount_paid != null ? html`<b class="cost-amt">${peso(r.amount_paid)}</b>` : html`<span class="cost-amt none">Add amount</span>`}</span></a>`)}`)}
      <div class="sheet-foot">Add "Amount paid" when you record or renew a permit to make this more accurate.</div>
    </section>` : empty('No dated renewals yet', 'Add expiry dates to your permits and this page fills in by itself.')}`);
}

// Late-renewal warning for the Mayor's Permit: the most the Local Government Code lets a city add (penalty.js).
export function penaltyNote(r) {
  if (r.type_code !== 'mayors_permit' || !r.expires_on || r.amount_paid == null) return '';
  const today = todayPH();
  const months = r.expires_on < today ? Math.min(36, Math.ceil((Date.parse(today) - Date.parse(r.expires_on)) / (30 * 864e5))) : 0;
  const base = Number(r.amount_paid);
  const max = (m) => maxPenalty(base, m).total;
  return html`<div class="banner warn"><div><b>${months ? `Late by about ${plural(months, 'month')}` : 'If you renew late'}:</b>
    the law lets your city add up to ${peso(max(Math.max(months, 1)))}${months ? '' : ' in the first month'} on top of the regular fees
    (a 25% surcharge plus 2% interest a month, figured on the ${peso(base)} you paid last time). This is the most the Local Government Code allows; many cities charge less.</div></div>`;
}

// ================================================================ share links
const shareUrl = (token) => `${location.origin}${location.pathname.replace(/[^/]*$/, '')}share.html#${token}`;
on('share-open', (ds) => openShare(ds));
function openShare(ds) {
  const scope = ds.scope || 'org';
  const name = scope === 'business' ? business(ds.id)?.name : scope === 'vehicle' ? vehicle(ds.id)?.make_model : scope === 'person' ? person(ds.id)?.full_name : S.org.name;
  if (!canEdit()) return toast('Ask an owner or admin to create a share link.', 'error');
  openModal('Share proof of compliance', html`
    <p class="muted small">Anyone with the link sees a read-only summary of <b>${name}</b>: each permit, its status and expiry. No files, no notes. You can turn the link off anytime.</p>
    <label class="field"><span>Who is it for? <small>(optional)</small></span><input name="label" maxlength="160" placeholder="e.g. Mall leasing office, bank loan"></label>
    <div class="grid2"><label class="field"><span>Link works for</span><select name="days"><option value="7">7 days</option><option value="30" selected>30 days</option><option value="90">90 days</option><option value="365">1 year</option></select></label></div>
    <label class="check"><input type="checkbox" name="show_refs" checked> Show reference numbers</label>`, {
    submitLabel: 'Create link',
    onSubmit: async (fd) => {
      const f = formObject(fd);
      const row = await db.createShare({ org_id: S.org.id, scope, subject_id: scope === 'org' ? null : ds.id, label: f.label, days: f.days, show_refs: !!f.show_refs });
      if (location.hash.startsWith('#/sharing')) shares(document.getElementById('main'));
      setTimeout(() => showLink(row.token), 0);
    },
  });
}
function showLink(token) {
  const url = shareUrl(token);
  openModal('Your link is ready', html`<p class="muted small">Send this link. It stops working when it expires or when you turn it off under Share proof.</p>
    <div class="copy-row"><input readonly value="${url}" id="share-url"><button type="button" class="btn btn-primary btn-sm" id="share-copy">Copy</button></div>
    <p><a href="${url}" target="_blank" rel="noopener">Open it to check</a></p>`, {
    onOpen: (form) => form.querySelector('#share-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(url); toast('Copied.'); } catch { form.querySelector('#share-url').select(); }
    }),
  });
}

export async function shares(el) {
  el.innerHTML = String(html`<div class="loading">Loading…</div>`);
  let list = [];
  try { list = await db.listShares(S.org.id); } catch (e) { toastError(e); }
  const now = new Date().toISOString();
  const what = (s) => (s.scope === 'org' ? `Everything in ${S.org.name}` : s.scope === 'business' ? business(s.subject_id)?.name : s.scope === 'vehicle' ? vehicle(s.subject_id)?.make_model : person(s.subject_id)?.full_name) || 'Deleted item';
  const { businesses, vehicles, people } = S.data;
  const active = list.filter((x) => !x.revoked_at && x.expires_at > now);
  const old = list.filter((x) => !active.includes(x));
  const row = (x) => {
    const on_ = active.includes(x);
    return html`<div class="line"><span class="line-main"><b>${what(x)}${x.label ? html` <span class="muted">· for ${x.label}</span>` : ''}</b>
      <small>${on_ ? `Works until ${fmtDate(x.expires_at.slice(0, 10))}` : x.revoked_at ? 'Turned off' : 'Expired'} · opened ${plural(x.view_count, 'time')}${x.last_viewed_at ? ', last ' + timeAgo(x.last_viewed_at) : ''}</small></span>
      ${on_ ? html`<span class="btn-row"><button class="btn btn-sm btn-primary" data-act="share-copy" data-token="${x.token}">Copy link</button>
        <a class="btn btn-sm btn-soft" href="${shareUrl(x.token)}" target="_blank" rel="noopener">Open</a>
        ${when(canEdit(), html`<button class="btn btn-sm btn-ghost danger" data-act="share-revoke" data-id="${x.id}">Turn off</button>`)}</span>` : html`<span class="chip needinfo">Off</span>`}</div>`;
  };
  el.innerHTML = String(html`
    <div class="page-head"><div><h1>Share proof</h1><p class="page-sub">Show anyone your permits are valid. Send a link, or put a QR code on your wall.</p></div></div>

    ${when(canEdit(), html`<section class="card proof-make">
      <div class="card-head"><div><h2>Send proof to someone</h2><p class="card-sub">For a mall, landlord, bank or client. They see each permit and when it expires. Never your files or costs.</p></div></div>
      <div class="proof-pick"><select id="proof-what" aria-label="What to share">
        <option value="org:">Everything in ${S.org.name}</option>
        ${when(businesses.length, html`<optgroup label="One business">${businesses.map((b) => html`<option value="business:${b.id}">${b.name}</option>`)}</optgroup>`)}
        ${when(vehicles.length, html`<optgroup label="One vehicle">${vehicles.map((v) => html`<option value="vehicle:${v.id}">${v.make_model}${v.plate_no ? ' · ' + v.plate_no : ''}</option>`)}</optgroup>`)}
        ${when(people.length, html`<optgroup label="One staff member">${people.map((x) => html`<option value="person:${x.id}">${x.full_name}</option>`)}</optgroup>`)}
      </select><button class="btn btn-primary" data-act="share-pick">${ICON.share} Create link</button></div>
    </section>`)}

    ${when(list.length, html`<section class="card"><div class="card-head"><div><h2>Links you've sent</h2><p class="card-sub">${plural(active.length, 'link')} working now</p></div></div>
      ${active.map(row)}${old.map(row)}</section>`)}

    ${when(has('plus'), html`<div id="trust-root"></div>`)}`);
  const tr = el.querySelector('#trust-root');
  if (tr) trustSection(tr);
}
on('share-pick', () => {
  const [scope, id] = document.getElementById('proof-what').value.split(':');
  openShare({ scope, id });
});
on('share-copy', async (ds) => { try { await navigator.clipboard.writeText(shareUrl(ds.token)); toast('Copied.'); } catch { showLink(ds.token); } });
on('share-revoke', async (ds) => {
  if (!(await confirmDialog('Turn off this link?', 'Anyone who has it will no longer be able to open it.', { confirmLabel: 'Turn off' }))) return;
  try { await db.revokeShare(ds.id); toast('Link turned off.'); shares(document.getElementById('main')); } catch (e) { toastError(e); }
});

// ================================================================ inspection pack (.zip)
// Every current document, named by permit, plus a one-page summary - ready for an inspector or auditor.
on('inspection-pack', async (ds, btn) => {
  const scope = ds.scope || 'org';
  const reqs = scope === 'org' ? S.data.reqs : reqsOf(scope, ds.id);
  const title = scope === 'business' ? business(ds.id)?.name : scope === 'vehicle' ? vehicle(ds.id)?.make_model : scope === 'person' ? person(ds.id)?.full_name : S.org.name;
  const clean = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80).trim();
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Preparing…';
  try {
    const docs = (await db.orgDocuments(S.org.id)).filter((d) => reqs.some((r) => r.id === d.requirement_id && r.cycle_id === d.cycle_id));
    if (!docs.length) throw new Error('No current documents to include yet.');
    const files = [];
    const used = new Set();
    for (const d of docs) {
      const r = reqs.find((x) => x.id === d.requirement_id);
      let name = `${clean(subjectLabel(r))}/${clean(r.name)} - ${clean(d.file_name)}`;
      while (used.has(name)) name = name.replace(/(\.[^.]*)?$/, '-2$1');
      used.add(name);
      let blob;
      try { blob = await db.fileBlob(d.storage_path); } catch { throw new Error(`Couldn't download ${d.file_name}. Please try again.`); }
      files.push({ name, data: new Uint8Array(await blob.arrayBuffer()) });
    }
    const summary = String(html`<!doctype html><html><head><meta charset="utf-8"><title>Compliance summary</title>
      <style>body{font-family:system-ui,sans-serif;max-width:860px;margin:32px auto;padding:0 16px;color:#111}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:8px;text-align:left;font-size:14px}</style></head><body>
      <h1>${title}</h1><p>Compliance summary as of ${fmtDate(todayPH())} · prepared with Pinoy Permit</p>
      <table><tr><th>Permit</th><th>For</th><th>Status</th><th>Reference no.</th><th>Expires</th><th>File</th></tr>
      ${[...reqs].sort(byPriority).map((r) => html`<tr><td>${r.name}</td><td>${subjectLabel(r)}</td><td>${STATUS[r.status].label}</td><td>${r.reference_no || '—'}</td>
        <td>${r.expires ? (r.expires_on ? fmtDate(r.expires_on) : '—') : 'Does not expire'}</td><td>${r.document_count ? 'Included' : 'Missing'}</td></tr>`)}</table></body></html>`);
    files.unshift({ name: '00 Summary.html', data: new TextEncoder().encode(summary) });
    download(`${clean(title)} - inspection pack ${todayPH()}.zip`, makeZip(files), 'application/zip');
    toast(`Inspection pack ready: ${plural(docs.length, 'file')}.`);
  } catch (e) { toastError(e); }
  btn.disabled = false;
  btn.textContent = label;
});

// ================================================================ calendar (.ics)
on('calendar-export', () => {
  const items = S.data.reqs.filter((r) => r.expires && r.expires_on);
  if (!items.length) return toast('Add expiry dates first.', 'error');
  const esc = (s) => String(s).replace(/[\\,;]/g, (m) => '\\' + m).replace(/\n/g, '\\n');
  const day = (iso) => iso.replace(/-/g, '');
  const next = (iso) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10).replace(/-/g, ''); };
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pinoy Permit//Deadlines//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${esc(S.org.name)} permits`];
  for (const r of items) {
    lines.push('BEGIN:VEVENT', `UID:${r.cycle_id || r.id}@permitpal`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${day(r.expires_on)}`, `DTEND;VALUE=DATE:${next(r.expires_on)}`,
      `SUMMARY:${esc(`Expires: ${r.name} (${subjectLabel(r)})`)}`, `DESCRIPTION:${esc(`${r.reference_no ? 'Ref ' + r.reference_no + '. ' : ''}Open Pinoy Permit to renew.`)}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(r.name + ' expires in 30 days')}`, 'TRIGGER:-P30D', 'END:VALARM',
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(r.name + ' expires in 7 days')}`, 'TRIGGER:-P7D', 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  download(`${S.org.name.replace(/\W+/g, '-').toLowerCase()}-permit-deadlines.ics`, lines.join('\r\n'), 'text/calendar');
  toast(`${plural(items.length, 'deadline')} saved. Open the file to add them to your calendar.`);
});

export { counts, makeZip };
