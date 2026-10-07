// Smaller tools: partners & introductions, costs & yearly budget,
// shareable proof-of-compliance links, the inspection pack (.zip) and calendar export (.ics).
import { html, fmtDate, fmtDateTime, peso, toast, toastError, when, plural, timeAgo, openModal, formObject, normalizePhone, todayPH, download, confirmDialog } from '../util.js';
import { S, on, go, reload, canEdit, business, vehicle, person, reqsOf, empty } from '../core.js';
import { STATUS, byPriority, subjectLabel, dueShort, ICON, counts } from '../components.js';
import * as db from 'pp/data';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ================================================================ licensed professionals
// Firms that file and renew in person (liaison, accounting, fire safety...). Customers deal with
// them directly; PermitPal only checks their licence, lists them, and sends them quote requests.
export const PARTNER_CATEGORIES = {
  liaison: 'Permit & registration filing', bookkeeping: 'Accounting, bookkeeping & BIR', fire_safety: 'Fire safety & extinguishers',
  pest_control: 'Pest control', health_clinic: 'Health cards & medical exams', emission_testing: 'Emission testing',
  vehicle_inspection: 'Vehicle inspection (PMVIC)', insurance: 'Insurance agents', notary: 'Notary public', other: 'Other services',
};
let partnersCache = null;
export const loadPartners = async () => (partnersCache ||= await db.listPartners().catch(() => []));
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
    <div class="page-head"><div><h1>Find a professional</h1><p class="muted">Licensed firms that file and renew permits in person, so you don't have to queue. You deal with them directly.</p></div></div>
    <section class="card promises pro-promises">
      <div class="promise">${ICON.check}<div><b>Licence checked</b><span>Firms marked "Licence checked" showed us their business permit and professional licence.</span></div></div>
      <div class="promise">${ICON.check}<div><b>Straight to them</b><span>Your request goes directly to the firm. They reply within 1 business day.</span></div></div>
      <div class="promise">${ICON.check}<div><b>No obligation</b><span>Compare quotes, ask questions, and only hire who you trust.</span></div></div>
    </section>
    ${list.length ? html`<div class="filters pro-filters">
        <select data-pro-cat aria-label="Service"><option value="all">All services</option>${cats.map((c) => html`<option value="${c}" ${proCat === c ? 'selected' : ''}>${PARTNER_CATEGORIES[c]}</option>`)}</select>
        ${when(cities.length, html`<select data-pro-city aria-label="City"><option value="all">All cities</option>${cities.map((c) => html`<option value="${c}" ${proCity === c ? 'selected' : ''}>${c}${myCities.includes(c) ? ' (yours)' : ''}</option>`)}</select>`)}
      </div>
      ${shown.length ? html`<div class="svc-grid">${shown.map(proCard)}</div>` : html`<p class="muted">No firms match yet. Try "All cities".</p>`}`
      : empty("We're onboarding licensed firms", 'Liaison firms, accountants and fire-safety providers in your area will appear here once their licences are checked.')}
    ${when(mine.length, html`<section class="card"><div class="card-head"><h2>Your quote requests</h2></div>
      ${mine.map((r) => { const p = list.find((x) => x.id === r.partner_id); return html`<div class="line"><span class="line-main"><b>${p?.name || 'Professional'}</b><small>${r.note || ''} · ${timeAgo(r.created_at)}</small></span>
        <span class="chip ${r.status === 'converted' ? 'ok' : r.status === 'not_converted' ? 'needinfo' : 'progress'}">${{ requested: 'Sent', introduced: 'They replied', converted: 'Hired', not_converted: 'Closed' }[r.status] || 'Sent'}</span></div>`; })}</section>`)}
    <p class="fineprint">Listed firms pay PermitPal for the quote requests we send them. It never changes their price, and you're free to choose anyone. PermitPal does not file anything with the government itself.</p>`);
}
document.addEventListener('change', (e) => {
  if (e.target.matches('[data-pro-cat]')) { proCat = e.target.value; partners(document.getElementById('main')); }
  if (e.target.matches('[data-pro-city]')) { proCity = e.target.value; partners(document.getElementById('main')); }
});

function proCard(p) {
  return html`<section class="card svc partner">
    <div class="svc-top"><h2>${p.name}</h2>${when(p.verified, html`<span class="chip ok pro-badge">${ICON.check} Licence checked</span>`)}</div>
    <p class="muted small pro-cat">${PARTNER_CATEGORIES[p.category] || ''}${p.licence ? ' · ' + p.licence : ''}</p>
    <p class="svc-sum">${p.description}</p>
    ${when(p.services, html`<p class="small"><b>Handles:</b> ${p.services}</p>`)}
    ${when((p.cities || []).length || p.coverage, html`<p class="muted small">Serves: ${(p.cities || []).join(', ') || p.coverage}</p>`)}
    <div class="svc-foot">${p.website ? html`<a class="small" href="${p.website}" target="_blank" rel="noopener">Website</a>` : html`<span></span>`}
      ${when(canEdit(), html`<button class="btn btn-primary btn-sm" data-act="partner-intro" data-id="${p.id}">Request a quote</button>`)}</div>
  </section>`;
}

export function partnerIntro(partnerId, requirementId = null) {
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
      await db.requestReferral({ org_id: S.org.id, partner_id: p.id, requirement_id: requirementId, note: f.note, contact_method: f.contact_method, contact_value: v });
      toast(`Sent. ${p.name} will contact you within 1 business day.`);
      if (location.hash.startsWith('#/pros')) partners(document.getElementById('main'));
    },
  });
}
on('partner-intro', async (ds) => { await loadPartners(); partnerIntro(ds.id, ds.req || null); });

// Requirement page: firms who can file this permit for you.
export function partnerSuggestions(r) {
  const city = r.location_city;
  const fits = (p) => (p.type_codes?.includes(r.type_code) || (p.category === 'liaison' && r.subject === 'business'))
    && (!city || !p.cities?.length || p.cities.includes(city));
  const fit = (partnersCache || []).filter(fits).slice(0, 3);
  return html`<section class="card pro-help"><div class="card-head"><div><h2>Rather not queue for this?</h2>
      <p class="card-sub">Licensed firms${city ? ' serving ' + city : ''} can file it for you. You deal with them directly.</p></div></div>
    ${fit.length ? fit.map((p) => html`<div class="line"><span class="line-main"><b>${p.name}${p.verified ? html` <span class="chip ok pro-badge">${ICON.check} Licence checked</span>` : ''}</b>
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
    <div class="page-head"><div><h1>Costs & budget</h1><p class="muted">What your permits cost, and what's coming, based on what you paid last time.</p></div></div>
    <div class="stats four">
      <div class="stat ok"><div class="stat-n">${peso(spentTotal)}</div><div class="stat-l">Paid in the last 12 months</div></div>
      <div class="stat soon"><div class="stat-n">${peso(known(all))}</div><div class="stat-l">Expected in the next 12 months</div></div>
      <div class="stat progress"><div class="stat-n">${busiest && known(busiest.items) ? busiest.label.split(' ')[0] : '—'}</div><div class="stat-l">Biggest month</div></div>
      <div class="stat needinfo"><div class="stat-n">${unknown(all)}</div><div class="stat-l">Renewals with no amount yet</div></div>
    </div>
    ${rows.length ? html`<section class="card">
      <div class="card-head"><div><h2>Coming up</h2><p class="card-sub">Estimates use the amount you entered for each permit's current record</p></div></div>
      ${rows.map((m) => html`<div class="band month ${m.key === 'late' ? 'overdue' : ''}"><span>${m.label}</span><span>${peso(known(m.items))}${unknown(m.items) ? ` + ${unknown(m.items)} unknown` : ''}</span></div>
        ${m.items.sort(byPriority).map((r) => html`<a class="line" href="#/requirement/${r.id}"><span class="line-main"><b>${r.name}</b><small>${subjectLabel(r)} · ${dueShort(r)}</small></span>
          ${r.amount_paid != null ? html`<b>${peso(r.amount_paid)}</b>` : html`<span class="chip needinfo">Add amount</span>`}</a>`)}`)}
      <div class="sheet-foot">Add "Amount paid" when you record or renew a permit to make this more accurate.</div>
    </section>` : empty('No dated renewals yet', 'Add expiry dates to your permits and this page fills in by itself.')}`);
}

// Late-renewal warning for the Mayor's Permit. The Local Government Code (RA 7160, Sec. 168) caps the
// surcharge at 25% of the unpaid amount, and interest at 2% a month of the unpaid amount including the
// surcharge, for at most 36 months. Cities may charge less, never more - so this is an upper limit.
export function penaltyNote(r) {
  if (r.type_code !== 'mayors_permit' || !r.expires_on || r.amount_paid == null) return '';
  const today = todayPH();
  const months = r.expires_on < today ? Math.min(36, Math.ceil((Date.parse(today) - Date.parse(r.expires_on)) / (30 * 864e5))) : 0;
  const base = Number(r.amount_paid);
  const max = (m) => base * 0.25 + base * 1.25 * 0.02 * m;
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

const USES = ['Mall or landlord', 'Bank or loan', 'Franchisor', 'Corporate client accreditation', 'Government bidding', 'Insurer', 'Business partner'];
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
    <div class="page-head"><div><h1>Share proof</h1><p class="muted">Someone asking if your permits are up to date? Send them one link instead of photocopies.</p></div></div>

    <section class="card proof-how">
      <div class="card-head"><div><h2>How it works</h2><p class="card-sub">No account needed on their side</p></div></div>
      <ol class="proof-steps">
        <li><span>1</span><div><b>Pick what to share</b><p>Everything, or just one business, vehicle or staff member.</p></div></li>
        <li><span>2</span><div><b>Copy the link</b><p>Send it by Viber, Messenger or email. It works for 7 days up to a year.</p></div></li>
        <li><span>3</span><div><b>They see a live summary</b><p>Each permit, whether it's valid, and its expiry date, always up to date. Turn it off anytime.</p></div></li>
      </ol>
      <div class="proof-see">
        <div class="yes"><b>${ICON.check} What they see</b><p>Permit names, status (valid, renew soon, overdue), expiry dates, and reference numbers if you allow it.</p></div>
        <div class="no"><b>✕ What they never see</b><p>Your files, notes, costs, team, contact details, or anything you didn't pick.</p></div>
      </div>
      <p class="proof-uses"><span class="muted small">Often asked for by:</span> ${USES.map((u) => html`<span class="tag">${u}</span>`)}</p>
    </section>

    ${when(canEdit(), html`<section class="card proof-make">
      <div class="card-head"><div><h2>Create a link</h2></div></div>
      <div class="proof-pick"><select id="proof-what">
        <option value="org:">Everything in ${S.org.name}</option>
        ${when(businesses.length, html`<optgroup label="One business">${businesses.map((b) => html`<option value="business:${b.id}">${b.name}</option>`)}</optgroup>`)}
        ${when(vehicles.length, html`<optgroup label="One vehicle">${vehicles.map((v) => html`<option value="vehicle:${v.id}">${v.make_model}${v.plate_no ? ' · ' + v.plate_no : ''}</option>`)}</optgroup>`)}
        ${when(people.length, html`<optgroup label="One staff member">${people.map((x) => html`<option value="person:${x.id}">${x.full_name}</option>`)}</optgroup>`)}
      </select><button class="btn btn-primary" data-act="share-pick">${ICON.share} Create link</button></div>
    </section>`)}

    <section class="card"><div class="card-head"><div><h2>Your links</h2><p class="card-sub">${plural(active.length, 'link')} working now</p></div></div>
      ${list.length ? html`${active.map(row)}${old.map(row)}` : html`<p class="muted">No links yet. Create one above.</p>`}
    </section>`);
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
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (u8) => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
export function makeZip(files) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const name = enc.encode(f.name), data = f.data, crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, time, 2], [12, date, 2], [14, crc, 4], [18, data.length, 4], [22, data.length, 4], [26, name.length, 2], [28, 0, 2]]
      .forEach(([o, v, n]) => (n === 4 ? h.setUint32(o, v, true) : h.setUint16(o, v, true)));
    const c = new DataView(new ArrayBuffer(46));
    [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, time, 2], [14, date, 2], [16, crc, 4], [20, data.length, 4], [24, data.length, 4],
      [28, name.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, offset, 4]]
      .forEach(([o, v, n]) => (n === 4 ? c.setUint32(o, v, true) : c.setUint16(o, v, true)));
    parts.push(new Uint8Array(h.buffer), name, data);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((t, p) => t + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  [[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, files.length, 2], [10, files.length, 2], [12, cdSize, 4], [16, offset, 4], [20, 0, 2]]
    .forEach(([o, v, n]) => (n === 4 ? end.setUint32(o, v, true) : end.setUint16(o, v, true)));
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

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
      const res = await fetch(await db.fileUrl(d.storage_path));
      if (!res.ok) throw new Error(`Couldn't download ${d.file_name}. Please try again.`);
      files.push({ name, data: new Uint8Array(await res.arrayBuffer()) });
    }
    const summary = String(html`<!doctype html><html><head><meta charset="utf-8"><title>Compliance summary</title>
      <style>body{font-family:system-ui,sans-serif;max-width:860px;margin:32px auto;padding:0 16px;color:#111}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:8px;text-align:left;font-size:14px}</style></head><body>
      <h1>${title}</h1><p>Compliance summary as of ${fmtDate(todayPH())} · prepared with PermitPal</p>
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
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PermitPal//Deadlines//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${esc(S.org.name)} permits`];
  for (const r of items) {
    lines.push('BEGIN:VEVENT', `UID:${r.cycle_id || r.id}@permitpal`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${day(r.expires_on)}`, `DTEND;VALUE=DATE:${next(r.expires_on)}`,
      `SUMMARY:${esc(`Expires: ${r.name} (${subjectLabel(r)})`)}`, `DESCRIPTION:${esc(`${r.reference_no ? 'Ref ' + r.reference_no + '. ' : ''}Open PermitPal to renew.`)}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(r.name + ' expires in 30 days')}`, 'TRIGGER:-P30D', 'END:VALARM',
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(r.name + ' expires in 7 days')}`, 'TRIGGER:-P7D', 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  download(`${S.org.name.replace(/\W+/g, '-').toLowerCase()}-permit-deadlines.ics`, lines.join('\r\n'), 'text/calendar');
  toast(`${plural(items.length, 'deadline')} saved. Open the file to add them to your calendar.`);
});

export { counts };
