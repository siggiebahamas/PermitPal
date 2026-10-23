// Admin > Professionals and Admin > Partner billing: firms that pay Pinoy Permit. Who applied, how each firm
// pays (per quote request from prepaid credit, or a flat monthly listing), their checklist lines with
// honest counts, their credit, how often customers hire them, the leads they reported, what each firm
// owes, the statements sent, and the quote requests behind them.
import { html, fmtDate, timeAgo, peso, toast, toastError, openModal, plural, when, todayPH, formObject, confirmDialog } from '../util.js';
import { S, on, actions, rerender, empty, has } from '../core.js';
import { PARTNER_CATEGORIES } from './extras.js';
import * as db from 'pp/data';

// Per-sale fees went with prepaid credit: a sale happens outside Pinoy Permit and can't be proven.
const feeModels = () => (has('leads')
  ? { per_lead: 'Per quote request (prepaid credit)', monthly: 'Flat monthly listing', none: 'No fee' }
  : { per_lead: 'Per quote request', per_sale_flat: 'Per sale (flat ₱)', per_sale_percent: 'Per sale (% of the sale)', monthly: 'Flat monthly listing', none: 'No fee' });
const prepaid = (p) => has('leads') && (p.fee_model || 'per_lead') === 'per_lead' && Number(p.lead_fee_php) > 0;
const leadsLeft = (p) => Math.floor(Number(p.credit_php || 0) / Number(p.lead_fee_php));
const paused = (p) => p.published && prepaid(p) && leadsLeft(p) < 1;
const CREDIT_KIND = { topup: 'Paid in', lead: 'Quote request', refund: 'Credit back', adjust: 'Adjustment' };
const REASON = { spam: 'Spam or a fake business', duplicate: 'A duplicate', unreachable: "Couldn't reach them", not_our_service: 'Not their service or area' };
const feeText = (p) => ({
  per_lead: `${peso(p.lead_fee_php)} per quote request`, per_sale_flat: `${peso(p.sale_fee_php)} per sale`, per_sale_percent: `${Number(p.sale_pct || 0)}% of each sale`,
  monthly: `${peso(p.monthly_fee_php)} a month`, none: 'Listed for free',
}[p.fee_model || 'per_lead']);
let cache = { partners: [], placements: [], stats: [], charges: [], statements: [], referrals: [], apps: [], credits: [], disputes: [] };
const types = () => S.data?.types || [];

// ---------------------------------------------------------------- professionals (listings)
// One short row per firm (search and filter at the top); everything else opens in a pop-up.
// Which permits a firm shows on, to start with, by what it does (staff can change it).
const CATEGORY_TYPES = {
  liaison: ['mayors_permit', 'barangay_clearance', 'fsic', 'sanitary_permit', 'signage_permit', 'dti_business_name', 'sec_registration'],
  bookkeeping: ['bir_cor', 'dti_business_name', 'sss_employer', 'philhealth_employer', 'pagibig_employer', 'bmbe_certificate'],
  fire_safety: ['fsic', 'annual_building_inspection'], pest_control: ['sanitary_permit'], health_clinic: ['health_certificate'],
  emission_testing: ['emission_test'], vehicle_inspection: ['mvir', 'lto_registration'], insurance: ['ctpl', 'comprehensive_insurance'], notary: [], other: [],
};
const stateOf = (p) => (paused(p) ? 'paused' : p.published ? 'live' : 'hidden');
const STATE = { live: ['Live', 'ok'], paused: ['Paused: no credit', 'soon'], hidden: ['Hidden', 'needinfo'] };
let proFilter = 'all';
let proSearch = '';

export async function partnersTab() {
  const from = new Date(Date.parse(todayPH()) - 29 * 864e5).toISOString().slice(0, 10);
  const leads = has('leads');
  const [partners, placements, stats, apps, credits, referrals] = await Promise.all([db.adminPartners(), db.adminPlacements(), db.adminPlacementStats(from, todayPH()), db.adminApplications(),
    leads ? db.adminCredits() : [], leads ? db.adminReferrals() : []]);
  Object.assign(cache, { partners, placements, stats, apps, credits, referrals });
  const fresh = apps.filter((a) => a.status === 'new');
  const count = (st) => partners.filter((p) => stateOf(p) === st).length;
  const filters = [['all', 'All', partners.length], ['live', 'Live', count('live')], ['paused', 'Need credit', count('paused')], ['hidden', 'Hidden', count('hidden')]];
  return html`<div data-partners-tab>
    ${when(fresh.length, html`<section class="card"><div class="card-head"><div><h2>Firms asking to be listed</h2><p class="card-sub">From the "For service providers" page. Each firm confirmed it is registered and licensed; you don't need to check papers.</p></div>
      <span class="chip progress">${fresh.length} new</span></div>
      ${fresh.map((a) => html`<div class="row"><div class="row-main"><div class="row-title">${a.name} · ${PARTNER_CATEGORIES[a.category] || a.category}</div>
        <div class="row-sub">${a.contact_name} · <a href="mailto:${a.email}">${a.email}</a>${a.phone ? ' · ' + a.phone : ''}${a.cities ? ' · ' + a.cities : ''} · ${timeAgo(a.created_at)}</div>
        <div class="row-sub">${[a.licence, a.services, a.message].filter(Boolean).join(' · ')}${a.website ? html` · <a href="${a.website}" target="_blank" rel="noopener noreferrer">website</a>` : ''}</div></div>
        <div class="row-side"><button class="btn btn-sm btn-primary" data-act="app-list" data-id="${a.id}">Make a draft listing</button>
          <button class="btn btn-sm btn-ghost" data-act="app-decline" data-id="${a.id}">Decline</button></div></div>`)}</section>`)}
    <section class="card"><div class="card-head"><div><h2>Professionals</h2>
        <p class="card-sub">${plural(partners.length, 'firm')} · ${count('live')} live${count('paused') ? ` · ${count('paused')} need credit` : ''}</p></div>
        <button class="btn btn-primary" data-act="pro-edit">+ Add a professional</button></div>
      ${partners.length > 1 ? html`<div class="pro-tools">
        <input type="search" data-pro-search placeholder="Search by name, city or what they do" aria-label="Search professionals" value="${proSearch}">
        <div class="pro-filters" role="group" aria-label="Show">${filters.map(([k, l, n]) => html`<button type="button" class="pro-filter" data-pro-filter="${k}" aria-pressed="${proFilter === k}">${l} <b>${n}</b></button>`)}</div></div>` : ''}
      <div class="pro-list">${partners.length ? partners.map(proRow) : html`<p class="muted">No professionals yet. Add one, or turn an application above into a draft listing.</p>`}</div>
      <p class="pro-none muted" ${partners.length && !partners.some(proShown) ? '' : 'hidden'}>No firm matches. Clear the search or pick "All".</p>
    </section></div>`;
}
const proShown = (p) => (proFilter === 'all' || stateOf(p) === proFilter)
  && (!proSearch || [p.name, PARTNER_CATEGORIES[p.category], (p.cities || []).join(' '), p.services].filter(Boolean).join(' ').toLowerCase().includes(proSearch.toLowerCase()));
function proRow(p) {
  const st = stateOf(p);
  const [label, cls] = STATE[st];
  const lines = cache.placements.filter((x) => x.partner_id === p.id && x.active).length;
  const since = new Date(Date.now() - 90 * 864e5).toISOString();
  const refs = cache.referrals.filter((r) => r.partner_id === p.id && r.created_at >= since);
  const hired = refs.filter((r) => r.status === 'converted').length;
  const find = [p.name, PARTNER_CATEGORIES[p.category], (p.cities || []).join(' '), p.services].filter(Boolean).join(' ').toLowerCase();
  return html`<div class="pro-row" data-pro-row data-state="${st}" data-find="${find}" ${proShown(p) ? '' : 'hidden'}>
    <div class="pro-main"><b>${p.name}</b>
      <small>${PARTNER_CATEGORIES[p.category] || 'Other'}${p.cities?.length ? ' · ' + p.cities.join(', ') : ' · all cities'}</small>
      ${refs.length ? html`<small>Last 90 days: ${plural(refs.length, 'quote request')} · ${hired} hired</small>` : ''}</div>
    <div class="pro-money">${prepaid(p) ? html`<b>${peso(p.credit_php || 0)}</b><small>${plural(leadsLeft(p), 'request')} left at ${peso(p.lead_fee_php)}</small>` : html`<b>${feeText(p)}</b>`}</div>
    <span class="chip ${cls}">${label}</span>
    <div class="btn-row pro-acts">
      ${prepaid(p) ? html`<button class="btn btn-sm ${st === 'paused' ? 'btn-primary' : 'btn-soft'}" data-act="credit-add" data-id="${p.id}">Add credit</button>` : ''}
      <button class="btn btn-sm btn-ghost" data-act="pro-edit" data-id="${p.id}" aria-label="Edit ${p.name}">Edit</button>
      <button class="btn btn-sm btn-ghost" data-act="pro-details" data-id="${p.id}" aria-label="History and checklist lines for ${p.name}">${lines ? `Lines (${lines})` : 'More'}</button></div>
  </div>`;
}
function applyProFilter(root) {
  let shown = 0;
  root.querySelectorAll('[data-pro-row]').forEach((r) => {
    const ok = (proFilter === 'all' || r.dataset.state === proFilter) && (!proSearch || r.dataset.find.includes(proSearch.toLowerCase()));
    r.hidden = !ok; if (ok) shown++;
  });
  const none = root.querySelector('.pro-none');
  if (none) none.hidden = shown > 0 || !root.querySelector('[data-pro-row]');
  root.querySelectorAll('[data-pro-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.proFilter === proFilter)));
}
document.addEventListener('input', (e) => { if (e.target.matches?.('[data-pro-search]')) { proSearch = e.target.value.trim(); applyProFilter(e.target.closest('[data-partners-tab]')); } });
document.addEventListener('click', (e) => {
  const b = e.target.closest?.('[data-pro-filter]');
  if (b) { proFilter = b.dataset.proFilter; applyProFilter(b.closest('[data-partners-tab]')); }
});

// ---- add or edit a firm: what customers see, how to reach them, how they pay; the rest under "More"
function permitPicker(selected) {
  const groups = [['business', 'Business permits'], ['person', 'Staff licenses'], ['vehicle', 'Vehicles']];
  const names = types().filter((t) => selected.includes(t.code)).map((t) => t.name.replace(/ \(.*\)$/, ''));
  return html`<details class="pro-permits"><summary><span>Shows on: <b data-permits-sum>${names.length ? names.join(', ') : 'business permits (filing firms only)'}</b></span> <span class="linklike">Change</span></summary>
    ${groups.map(([subj, label]) => html`<fieldset><legend>${label}</legend><div class="pro-permit-grid">
      ${types().filter((t) => t.subject === subj).map((t) => html`<label class="check"><input type="checkbox" name="types" value="${t.code}" ${selected.includes(t.code) ? 'checked' : ''}> ${t.name.replace(/ \(.*\)$/, '')}</label>`)}</div></fieldset>`)}</details>`;
}
function editPro(p = {}) {
  const fm = p.fee_model || 'per_lead';
  const isNew = !p.id;
  const selected = p.type_codes?.length ? p.type_codes : (isNew ? CATEGORY_TYPES.liaison : []);
  openModal(isNew ? 'Add a professional' : `Edit ${p.name}`, html`
    <h4 class="pro-h">What customers see</h4>
    <div class="grid2">
      <label class="field"><span>Business name</span><input name="name" required maxlength="160" value="${p.name || ''}"></label>
      <label class="field"><span>What they do</span><select name="category">${Object.entries(PARTNER_CATEGORIES).map(([k, v]) => html`<option value="${k}" ${k === (p.category || 'liaison') ? 'selected' : ''}>${v}</option>`)}</select></label>
      <label class="field"><span>What they handle</span><input name="services" maxlength="600" value="${p.services || ''}" placeholder="Mayor's Permit renewal, FSIC filing"></label>
      <label class="field"><span>Cities they serve <small>(empty = everywhere)</small></span><input name="cities" value="${(p.cities || []).join(', ')}" placeholder="Makati City, Taguig City"></label>
    </div>
    ${permitPicker(selected)}
    <h4 class="pro-h">How to reach them</h4>
    <div class="grid2">
      <label class="field"><span>Contact person</span><input name="contact_name" maxlength="120" value="${p.contact_name || ''}"></label>
      <label class="field"><span>Email <small>(quote requests and statements go here)</small></span><input type="email" name="contact_email" maxlength="160" value="${p.contact_email || ''}"></label>
      <label class="field"><span>Phone</span><input name="contact_phone" maxlength="60" value="${p.contact_phone || ''}"></label>
    </div>
    <h4 class="pro-h">How they pay you</h4>
    <div class="grid2">
      <label class="field"><span>Fee</span><select name="fee_model" data-fee-model>${Object.entries(feeModels()).map(([k, v]) => html`<option value="${k}" ${k === fm ? 'selected' : ''}>${v}</option>`)}</select></label>
      <label class="field" data-fee="per_lead" ${fm === 'per_lead' ? '' : 'hidden'}><span>₱ per quote request${has('leads') ? html` <small>(taken from their credit)</small>` : ''}</span><input name="lead_fee_php" type="number" min="0" step="1" value="${p.lead_fee_php ?? ''}"></label>
      <label class="field" data-fee="per_sale_flat" ${fm === 'per_sale_flat' ? '' : 'hidden'}><span>₱ per sale</span><input name="sale_fee_php" type="number" min="0" step="1" value="${p.sale_fee_php ?? ''}"></label>
      <label class="field" data-fee="per_sale_percent" ${fm === 'per_sale_percent' ? '' : 'hidden'}><span>Share of each sale (%)</span><input name="sale_pct" type="number" min="0" max="50" step="0.5" value="${p.sale_pct ?? ''}"></label>
      <label class="field" data-fee="monthly" ${fm === 'monthly' ? '' : 'hidden'}><span>₱ a month</span><input name="monthly_fee_php" type="number" min="0" step="1" value="${p.monthly_fee_php ?? ''}"></label>
    </div>
    <p class="muted small" data-ins-note ${p.category === 'insurance' ? '' : 'hidden'}>Insurers: without your Insurance Commission license on file (Money → Today → Settings), only "Flat monthly listing" or "No fee" is allowed.</p>
    <label class="check"><input type="checkbox" name="verified" ${p.verified ? 'checked' : ''}> <span>The firm confirmed it is registered and licensed <small class="muted">(in its application, or to you in writing). You don't check papers, and customers are told Pinoy Permit doesn't.</small></span></label>
    <label class="check"><input type="checkbox" name="published" ${p.published ? 'checked' : ''}> <span>Show to customers</span></label>
    <details class="pro-more"><summary><b>More</b> <span class="muted small">license shown to customers, description, website, a separate email for statements, notes</span></summary>
      <div class="grid2">
        <label class="field"><span>License or accreditation <small>(optional, shown)</small></span><input name="licence" maxlength="200" value="${p.licence || ''}" placeholder="e.g. CPA, PRC no. 0123456"></label>
        <label class="field"><span>Website <small>(only you see it)</small></span><input name="website" maxlength="300" value="${p.website || ''}" placeholder="https://"></label>
        <label class="field"><span>Send statements to <small>(only if not the email above)</small></span><input type="email" name="billing_email" maxlength="160" value="${p.billing_email || ''}"></label>
        <label class="field"><span>Agreement notes <small>(only you see it)</small></span><input name="commission_terms" maxlength="500" value="${p.commission_terms || ''}" placeholder="e.g. Signed 1 Nov 2026"></label>
      </div>
      <label class="field"><span>Short description <small>(optional, shown)</small></span><textarea name="description" rows="2" maxlength="600">${p.description || ''}</textarea></label>
    </details>`, {
    wide: true, submitLabel: isNew ? 'Add professional' : 'Save', danger: false,
    onOpen: (form) => {
      let touched = !isNew;
      const sum = form.querySelector('[data-permits-sum]');
      const paintSum = () => {
        const names = [...form.querySelectorAll('[name=types]:checked')].map((i) => i.parentElement.textContent.trim());
        sum.textContent = names.length ? names.join(', ') : 'business permits (filing firms only)';
      };
      form.querySelectorAll('[name=types]').forEach((i) => i.addEventListener('change', () => { touched = true; paintSum(); }));
      form.category.addEventListener('change', () => {
        form.querySelector('[data-ins-note]').hidden = form.category.value !== 'insurance';
        if (touched) return; // a new firm's permits follow what it does, until staff pick them by hand
        const want = CATEGORY_TYPES[form.category.value] || [];
        form.querySelectorAll('[name=types]').forEach((i) => { i.checked = want.includes(i.value); });
        paintSum();
      });
    },
    onSubmit: async (fd) => {
      const row = Object.fromEntries(['name', 'category', 'licence', 'website', 'contact_name', 'contact_phone', 'contact_email', 'billing_email', 'commission_terms', 'description', 'services', 'fee_model'].map((k) => [k, String(fd.get(k) || '').trim()]));
      if (!row.name) throw new Error('Enter the firm name.');
      if (row.website && !/^https:\/\//.test(row.website)) throw new Error('The website must start with https://');
      row.type_codes = fd.getAll('types').map(String);
      row.cities = String(fd.get('cities') || '').split(',').map((x) => x.trim()).filter(Boolean);
      const n = (k) => { const v = fd.get(k); return v === '' || v == null ? null : Number(v); };
      row.lead_fee_php = n('lead_fee_php') ?? 0; // blank = no fee
      row.sale_fee_php = n('sale_fee_php'); row.sale_pct = n('sale_pct'); row.monthly_fee_php = n('monthly_fee_php');
      if (row.fee_model === 'monthly' && !(row.monthly_fee_php > 0)) throw new Error('Enter the monthly listing fee, or choose "No fee".');
      if (row.fee_model === 'per_sale_flat' && !(row.sale_fee_php > 0)) throw new Error('Enter the fee per sale.');
      if (row.fee_model === 'per_sale_percent' && !(row.sale_pct > 0)) throw new Error('Enter the share of each sale.');
      row.published = fd.get('published') === 'on';
      row.verified = fd.get('verified') === 'on';
      if (row.published && !row.contact_email) throw new Error('Add their email before showing the firm to customers: quote requests go there.');
      await db.adminSavePartner(p.id || null, row);
      toast(isNew ? 'Added.' : 'Saved.'); rerender();
    },
  });
}
on('pro-edit', (ds) => editPro(ds.id ? cache.partners.find((x) => x.id === ds.id) : {}));

// ---- a firm's history: how customers did with them, credit, and their checklist lines
on('pro-details', (ds) => {
  const p = cache.partners.find((x) => x.id === ds.id);
  if (!p) return;
  const mine = cache.placements.filter((x) => x.partner_id === p.id);
  openModal(p.name, html`<div data-partners-tab data-pro-detail="${p.id}">
    <p class="muted small">${PARTNER_CATEGORIES[p.category] || ''} · ${feeText(p)}${p.contact_email ? ` · ${p.contact_email}` : ''}</p>
    ${when(has('leads'), outcomes(p))}
    ${when(prepaid(p), creditBox(p))}
    <h4 class="pro-h">Checklist lines</h4>
    <p class="muted small">One quiet line, labelled "Partner", on a matching checklist step. One firm per step per city. People can switch these off.</p>
    ${mine.length ? mine.map((x) => placementRow(x)) : html`<p class="muted small">None yet.</p>`}
    <button type="button" class="btn btn-sm btn-soft" data-act="pl-new" data-id="${p.id}">+ Add a checklist line</button></div>`, { wide: true });
});

// How customers did with this firm in the last 90 days: the honest number to show them at renewal time.
function outcomes(p) {
  const since = new Date(Date.now() - 90 * 864e5).toISOString();
  const mine = cache.referrals.filter((r) => r.partner_id === p.id && r.created_at >= since);
  if (!mine.length) return '';
  const n = (st) => mine.filter((r) => r.status === st).length;
  return html`<p class="muted small firm-outcomes">Last 90 days: <b>${plural(mine.length, 'quote request')}</b> · <b>${n('converted')}</b> hired · ${n('not_converted')} didn't hire · ${mine.length - n('converted') - n('not_converted')} no answer yet</p>`;
}

function creditBox(p) {
  const hist = cache.credits.filter((c) => c.partner_id === p.id);
  return html`<div class="credit-box">
    <div class="credit-top"><div><b class="credit-amt">${peso(p.credit_php || 0)}</b> <span class="muted">credit · ${plural(leadsLeft(p), 'quote request')} left at ${peso(p.lead_fee_php)} each</span></div>
      <div class="btn-row"><button type="button" class="btn btn-sm btn-primary" data-act="credit-add" data-id="${p.id}">Add credit</button>
        <button type="button" class="btn btn-sm btn-ghost" data-act="credit-adjust" data-id="${p.id}">Adjust</button></div></div>
    ${leadsLeft(p) < 1 ? html`<p class="small credit-warn">Customers can't see or contact them until they top up. They were emailed when it ran out.</p>` : leadsLeft(p) < 2 ? html`<p class="small credit-warn">One request left. They were emailed to top up.</p>` : ''}
    ${hist.length ? html`<details class="credit-hist"><summary>Credit history (${hist.length})</summary><div class="table-wrap" tabindex="0" role="region" aria-label="Credit history for ${p.name}"><table class="table">
      <thead><tr><th>Date</th><th>What</th><th>Amount</th><th>Balance</th></tr></thead><tbody>
      ${hist.slice(0, 30).map((c) => html`<tr><td>${fmtDate(c.created_at.slice(0, 10))}</td><td>${c.kind === 'lead' ? c.note || CREDIT_KIND.lead : CREDIT_KIND[c.kind] || c.kind}${c.note && ['refund', 'adjust'].includes(c.kind) ? html`<div class="muted small">${c.note}</div>` : ''}${c.paid_method ? html`<div class="muted small">${c.paid_method}${c.paid_ref ? ', ref ' + c.paid_ref : ''}</div>` : ''}</td>
        <td>${Number(c.amount_php) > 0 ? '+' + peso(c.amount_php) : '−' + peso(-c.amount_php)}</td><td>${peso(c.balance_php)}</td></tr>`)}</tbody></table></div></details>` : ''}
  </div>`;
}

function placementRow(x) {
  const t = types().find((y) => y.code === x.type_code);
  const step = (t?.checklist || []).find((i) => i.k === x.item_key);
  const s = cache.stats.find((y) => y.placement_id === x.id) || { views: 0, clicks: 0, leads: 0 };
  const live = x.active && x.starts_on <= todayPH() && x.ends_on >= todayPH();
  return html`<div class="row"><div class="row-main"><div class="row-title">"${x.headline}"</div>
    <div class="row-sub">${t?.name || x.type_code}${step ? ' → ' + step.t : ' (whole checklist)'} · ${x.cities?.length ? x.cities.join(', ') : 'all cities'} · ${fmtDate(x.starts_on)} to ${fmtDate(x.ends_on)} · ${peso(x.monthly_fee_php)}/month</div>
    <div class="row-sub">Last 30 days: <b>${s.views}</b> ${Number(s.views) === 1 ? 'person' : 'people'} saw it · <b>${s.clicks}</b> opened it · <b>${s.leads}</b> sent a quote request</div></div>
    <div class="row-side"><span class="chip ${live ? 'ok' : 'needinfo'}">${live ? 'Showing' : x.active ? 'Scheduled or ended' : 'Off'}</span>
      <button class="btn btn-sm btn-ghost" data-act="pl-toggle" data-id="${x.id}" data-on="${x.active ? '' : '1'}">${x.active ? 'Turn off' : 'Turn on'}</button></div></div>`;
}
// A new checklist line for a firm (its own pop-up).
on('pl-new', (ds) => {
  const withSteps = types().filter((t) => (t.checklist || []).length);
  openModal('Add a checklist line', html`<div class="grid2">
    <label class="field"><span>Permit</span><select name="type_code" data-pl-type required>${withSteps.map((t) => html`<option value="${t.code}">${t.name}</option>`)}</select></label>
    <label class="field"><span>Checklist step</span><select name="item_key" data-pl-step>${stepOptions(withSteps[0])}</select></label>
    <label class="field"><span>Line shown <small>(5–90 characters, plain, no hype)</small></span><input name="headline" required minlength="5" maxlength="90" placeholder="Extinguishers refilled and tagged within the week"></label>
    <label class="field"><span>Cities <small>(empty = everywhere)</small></span><input name="cities" placeholder="Makati City, Pasig City"></label>
    <label class="field"><span>From</span><input name="starts_on" type="date" required value="${todayPH()}"></label>
    <label class="field"><span>To</span><input name="ends_on" type="date" required></label>
    <label class="field"><span>Monthly fee (₱)</span><input name="monthly_fee_php" type="number" min="0" step="1" required></label></div>`, {
    submitLabel: 'Add line', danger: false,
    onSubmit: async (fd) => {
      const v = formObject(fd);
      if (!v.ends_on || v.ends_on < v.starts_on) throw new Error('The end date must be on or after the start date.');
      if (String(v.headline || '').trim().length < 5) throw new Error('Write a line of at least 5 characters.');
      await db.adminSavePlacement(null, { partner_id: ds.id, type_code: v.type_code, item_key: v.item_key || null, headline: v.headline,
        cities: String(v.cities || '').split(',').map((x) => x.trim()).filter(Boolean), starts_on: v.starts_on, ends_on: v.ends_on, monthly_fee_php: Number(v.monthly_fee_php) || 0 });
      toast('Line added. It is charged once a month while it shows.'); rerender();
    },
  });
});
const stepOptions = (t) => html`<option value="">Whole checklist (at the bottom)</option>${(t?.checklist || []).map((i) => html`<option value="${i.k}">${i.t}</option>`)}`;
document.addEventListener('change', (e) => {
  if (e.target.matches?.('[data-pl-type]')) e.target.form.querySelector('[data-pl-step]').innerHTML = String(stepOptions(types().find((t) => t.code === e.target.value)));
  if (e.target.matches?.('[data-fee-model]')) e.target.form.querySelectorAll('[data-fee]').forEach((x) => { x.hidden = x.dataset.fee !== e.target.value; });
});
on('credit-add', (ds) => {
  const p = cache.partners.find((x) => x.id === ds.id);
  openModal(`Add credit for ${p?.name}`, html`<p class="muted small">Record what they paid you. They get an email receipt with their new balance, and they show again straight away if they were paused.</p>
    <div class="grid2"><label class="field"><span>Amount paid (₱)</span><input name="amount" type="number" min="1" step="1" required value="${Number(p?.lead_fee_php || 0) * 10 || ''}"></label>
    <label class="field"><span>Paid by</span><input name="method" maxlength="60" placeholder="GCash / bank transfer" required></label>
    <label class="field"><span>Reference no.</span><input name="ref" maxlength="120"></label>
    <label class="field"><span>BIR invoice number <small>(or add it later in Money)</small></span><input name="no" maxlength="60"></label></div>`, {
    submitLabel: 'Add credit',
    onSubmit: async (fd) => {
      const f = formObject(fd);
      const bal = await db.adminAddCredit(ds.id, Number(f.amount), f.method, f.ref, f.no);
      toast(`Added. ${p?.name} has ${peso(bal)} (${plural(Math.floor(bal / Number(p.lead_fee_php)), 'quote request')}).`); rerender();
    },
  });
});
on('credit-adjust', (ds) => {
  const p = cache.partners.find((x) => x.id === ds.id);
  openModal(`Adjust ${p?.name}'s credit`, html`<p class="muted small">For a correction, a goodwill credit, or money you refunded to a firm that left. Use a minus sign to take credit off.</p>
    <div class="grid2"><label class="field"><span>Change (₱)</span><input name="amount" type="number" step="1" required placeholder="e.g. 500 or -500"></label>
    <label class="field"><span>Why <small>(kept in their history)</small></span><input name="note" required minlength="5" maxlength="300"></label></div>`, {
    submitLabel: 'Save',
    onSubmit: async (fd) => { const f = formObject(fd); const bal = await db.adminAdjustCredit(ds.id, Number(f.amount), f.note); toast(`Saved. Balance: ${peso(bal)}.`); rerender(); },
  });
});
on('pl-toggle', async (ds) => {
  const partner = cache.placements.find((x) => x.id === ds.id)?.partner_id;
  try {
    await db.adminSavePlacement(ds.id, { active: !!ds.on });
    toast(ds.on ? 'Turned on.' : 'Turned off.');
    await rerender();
    if (partner && document.querySelector('[data-pro-detail]')) actions['pro-details']({ id: partner }); // show the line's new state
  } catch (e) { toastError(e); }
});
on('app-list', async (ds) => {
  try { await db.adminApplicationToPartner(ds.id); toast('Draft listing made (hidden). Press Edit to check the details and the fee, then tick "Show to customers".'); rerender(); } catch (e) { toastError(e); }
});
on('app-decline', (ds) => openModal('Decline this application?', html`<label class="field"><span>Note <small>(internal)</small></span><input name="note" maxlength="500" placeholder="e.g. No business permit"></label>
  <p class="muted small">Reply to them by email yourself; nothing is sent automatically.</p>`, {
  submitLabel: 'Decline',
  onSubmit: async (fd) => { await db.adminSetApplication(ds.id, { status: 'declined', note: String(fd.get('note') || '').trim() || null, decided_at: new Date().toISOString() }); toast('Declined.'); rerender(); },
}));


// ---------------------------------------------------------------- partner billing
export async function billingTab() {
  const leads = has('leads');
  const [partners, charges, statements, referrals, disputes] = await Promise.all([db.adminPartners(), db.adminCharges(), db.adminStatements(), db.adminReferrals(), leads ? db.adminDisputes() : []]);
  Object.assign(cache, { partners, charges, statements, referrals, disputes });
  const openDisputes = disputes.filter((d) => d.status === 'open');
  const disputeOf = (refId) => disputes.find((d) => d.referral_id === refId);
  const today = todayPH();
  const lastMonthEnd = new Date(Date.parse(today.slice(0, 8) + '01') - 864e5).toISOString().slice(0, 10);
  const name = (id) => partners.find((p) => p.id === id)?.name || 'Firm';
  const rows = partners.map((p) => {
    const mine = charges.filter((c) => c.partner_id === p.id);
    const unbilled = mine.filter((c) => c.status === 'unbilled');
    return { p, unbilled: unbilled.reduce((t, c) => t + Number(c.amount_php), 0), n: unbilled.length,
      older: unbilled.filter((c) => c.occurred_on <= lastMonthEnd).length,
      open: statements.filter((s) => s.partner_id === p.id && s.status === 'sent').reduce((t, s) => t + Number(s.total_php), 0),
      paid: statements.filter((s) => s.partner_id === p.id && s.status === 'paid' && s.paid_at?.slice(0, 4) === today.slice(0, 4)).reduce((t, s) => t + Number(s.total_php), 0) };
  }).filter((r) => r.n || r.open || r.paid || r.p.published);
  const sum = (k) => rows.reduce((t, r) => t + r[k], 0);
  const sold = (r) => (Array.isArray(r.referral_commissions) ? r.referral_commissions[0] : r.referral_commissions) || {};
  return html`<div data-billing-tab>
    <div class="stats four">
      <div class="stat"><div class="stat-n">${peso(sum('unbilled'))}</div><div class="stat-l">Not billed yet</div></div>
      <div class="stat progress"><div class="stat-n">${peso(sum('open'))}</div><div class="stat-l">Billed, not paid</div></div>
      <div class="stat ok"><div class="stat-n">${peso(sum('paid'))}</div><div class="stat-l">Paid this year</div></div>
      <div class="stat"><div class="stat-n">${referrals.filter((r) => r.created_at.slice(0, 7) === today.slice(0, 7)).length}</div><div class="stat-l">Quote requests this month</div></div></div>
    ${when(leads && disputes.length, html`<section class="card ${openDisputes.length ? 'cx-needs' : ''}"><div class="card-head"><div><h2>Reported leads</h2>
        <p class="card-sub">Firms can report a request within 7 days from the link in the lead email. Accept and the fee goes back on their credit; decline with a reason they'll read.</p></div>
        ${openDisputes.length ? html`<span class="chip soon">${openDisputes.length} to decide</span>` : ''}</div>
      ${disputes.slice(0, 30).map(disputeRow)}</section>`)}
    <section class="card"><div class="card-head"><div><h2>What each firm owes</h2><p class="card-sub">Make a statement at the start of each month: it adds up everything not billed yet, emails the firm, and is due in 15 days.</p></div></div>
      ${rows.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Firm</th><th>How they pay</th><th>Not billed</th><th>Billed, unpaid</th><th>Paid this year</th><th><span class="sr-only">Action</span></th></tr></thead><tbody>
        ${rows.map((r) => html`<tr><td>${r.p.name}</td><td class="small">${feeText(r.p)}</td><td>${peso(r.unbilled)}${r.n ? html`<div class="muted small">${plural(r.n, 'charge')}</div>` : ''}</td>
          <td>${peso(r.open)}</td><td>${peso(r.paid)}</td>
          <td><div class="btn-row">${r.n ? html`<button class="btn btn-sm ${r.older ? 'btn-primary' : 'btn-soft'}" data-act="stmt-new" data-id="${r.p.id}" data-through="${r.older ? lastMonthEnd : today}">Make statement</button>` : ''}
            <button class="btn btn-sm btn-ghost" data-act="charge-add" data-id="${r.p.id}">Add charge</button></div></td></tr>`)}
      </tbody></table></div>` : empty('No firms yet', 'Add professionals first.')}</section>
    <section class="card"><div class="card-head"><h2>Statements</h2></div>
      ${statements.length ? statements.map((s) => html`<div class="row"><div class="row-main"><div class="row-title">${s.number} · ${name(s.partner_id)} · ${peso(s.total_php)}</div>
        <div class="row-sub">Up to ${fmtDate(s.period_end)} · sent ${fmtDate(s.sent_at.slice(0, 10))}${s.status === 'sent' ? html` · <span class="${s.due_on < today ? 'due overdue' : ''}">due ${fmtDate(s.due_on)}</span>` : ''}${s.paid_at ? ` · paid ${fmtDate(s.paid_at.slice(0, 10))}${s.paid_ref ? ', ref ' + s.paid_ref : ''}` : ''}${s.bir_invoice_no ? ' · invoice ' + s.bir_invoice_no : ''}${s.note ? ' · ' + s.note : ''}</div></div>
        <div class="row-side"><span class="chip ${s.status === 'paid' ? 'ok' : s.status === 'void' ? 'needinfo' : s.due_on < today ? 'overdue' : 'progress'}">${{ sent: 'Sent', paid: 'Paid', void: 'Cancelled' }[s.status]}</span>
          <button class="btn btn-sm btn-ghost" data-act="stmt-print" data-id="${s.id}">Print</button>
          ${s.status === 'sent' ? html`<button class="btn btn-sm btn-primary" data-act="stmt-paid" data-id="${s.id}">Mark paid</button><button class="btn btn-sm btn-ghost danger" data-act="stmt-void" data-id="${s.id}">Cancel</button>` : ''}</div></div>`)
        : html`<p class="muted">No statements yet.</p>`}</section>
    <section class="card"><div class="card-head"><div><h2>Quote requests</h2><p class="card-sub">Each one is emailed straight to the firm. Update the status when they tell you; record a sale for firms paid per sale.</p></div></div>
      ${referrals.length ? referrals.map((r) => { const p = partners.find((x) => x.id === r.partner_id) || {}; const perSale = ['per_sale_flat', 'per_sale_percent'].includes(p.fee_model);
        return html`<form class="admin-ref2 line-form" data-id="${r.id}">
          <div class="line-main"><b>${r.partners?.name} ← ${r.orgs?.name}${disputeOf(r.id) ? html` <span class="chip ${disputeOf(r.id).status === 'accepted' ? 'ok' : disputeOf(r.id).status === 'open' ? 'soon' : 'needinfo'}">Reported: ${{ open: 'to decide', accepted: 'credited back', declined: 'declined' }[disputeOf(r.id).status]}</span>` : ''}</b><small>${r.contact_method}${r.contact_value ? ': ' + r.contact_value : ''} · ${timeAgo(r.created_at)}${r.placement_id ? ' · from a checklist line' : ''}${r.note ? ' · ' + r.note : ''}${r.sale_php != null ? ' · sale ' + peso(r.sale_php) : ''}</small></div>
          <select name="status" aria-label="Status">${['requested', 'introduced', 'converted', 'not_converted'].map((k) => html`<option value="${k}" ${k === r.status ? 'selected' : ''}>${{ requested: 'Sent', introduced: 'Firm replied', converted: 'Hired', not_converted: 'Closed' }[k]}</option>`)}</select>
          ${perSale ? html`<button type="button" class="btn btn-sm btn-soft" data-act="sale-record" data-id="${r.id}">${r.sale_php != null ? 'Change sale' : 'Record sale'}</button>` : html`<span class="muted small">${Number(sold(r).amount_php) ? peso(sold(r).amount_php) + ' fee' : ''}</span>`}
          <button class="btn btn-sm btn-ghost">Save</button></form>`; }) : empty('No quote requests yet', 'Requests customers send to listed professionals appear here.')}</section></div>`;
}
function disputeRow(d) {
  const st = { open: ['To decide', 'soon'], accepted: ['Accepted', 'ok'], declined: ['Declined', 'needinfo'] }[d.status];
  return html`<div class="row"><div class="row-main"><div class="row-title">${d.partners?.name || 'Firm'} ← ${d.referrals?.orgs?.name || 'customer'}</div>
      <div class="row-sub">Request sent ${d.referrals?.created_at ? fmtDate(d.referrals.created_at.slice(0, 10)) : ''} · reported ${timeAgo(d.created_at)} as <b>${REASON[d.reason] || d.reason}</b>${d.note ? html` · "${d.note}"` : ''}</div>
      ${d.referrals?.note ? html`<div class="row-sub">Customer wrote: "${d.referrals.note}"</div>` : ''}
      ${d.status !== 'open' ? html`<div class="row-sub">${d.status === 'accepted' && Number(d.credited_php) > 0 ? `${peso(d.credited_php)} credited back` : ''}${d.decision_note ? ' · ' + d.decision_note : ''}</div>` : ''}</div>
    <div class="row-side"><span class="chip ${st[1]}">${st[0]}</span>
      ${d.status === 'open' ? html`<button class="btn btn-sm btn-primary" data-act="dispute-accept" data-id="${d.id}">Accept</button><button class="btn btn-sm btn-ghost" data-act="dispute-decline" data-id="${d.id}">Decline</button>` : ''}</div></div>`;
}
on('dispute-accept', async (ds) => {
  const d = cache.disputes.find((x) => x.id === ds.id);
  if (!(await confirmDialog('Accept this report?', `${d?.partners?.name || 'The firm'} gets the request's fee back on their credit and an email saying so.`, { confirmLabel: 'Accept', danger: false }))) return;
  try { await db.adminDecideDispute(ds.id, true, null); toast('Accepted. The fee is back on their credit.'); rerender(); } catch (e) { toastError(e); }
});
on('dispute-decline', (ds) => openModal('Decline this report?', html`<label class="field"><span>Why <small>(the firm reads this)</small></span>
    <textarea name="note" rows="3" required minlength="5" maxlength="500" placeholder="e.g. The customer confirmed you called them and sent a quote."></textarea></label>`, {
  submitLabel: 'Decline',
  onSubmit: async (fd) => { await db.adminDecideDispute(ds.id, false, String(fd.get('note') || '').trim()); toast('Declined. The firm was emailed your reason.'); rerender(); },
}));
on('stmt-new', (ds) => {
  const p = cache.partners.find((x) => x.id === ds.id);
  const to = p?.billing_email || p?.contact_email;
  openModal(`Statement for ${p?.name}`, html`<label class="field"><span>Include charges up to</span><input type="date" name="through" required value="${ds.through}" max="${todayPH()}"></label>
    <label class="check"><input type="checkbox" name="email" ${to ? 'checked' : 'disabled'}><span>Email it to ${to || '(no email on file)'}</span></label>
    <p class="muted small">Due in 15 days. You can print it too.</p>`, {
    submitLabel: 'Make statement',
    onSubmit: async (fd) => { await db.adminCreateStatement(ds.id, fd.get('through'), fd.get('email') === 'on'); toast('Statement made.'); rerender(); },
  });
});
on('charge-add', (ds) => openModal('Add a charge', html`<label class="field"><span>What for <small>(the firm sees it)</small></span><input name="desc" required maxlength="300"></label>
  <div class="grid2"><label class="field"><span>Amount (₱)</span><input name="amount" type="number" min="1" step="0.01" required></label>
  <label class="field"><span>Date</span><input name="on" type="date" value="${todayPH()}" max="${todayPH()}"></label></div>`, {
  submitLabel: 'Add',
  onSubmit: async (fd) => { const f = formObject(fd); await db.adminAddCharge(ds.id, f.desc, Number(f.amount), f.on); toast('Added. It goes on the next statement.'); rerender(); },
}));
on('stmt-paid', (ds) => openModal('Statement paid', html`<div class="grid2">
  <label class="field"><span>Paid by</span><input name="method" maxlength="60" placeholder="GCash / BPI" required></label>
  <label class="field"><span>Reference no.</span><input name="ref" maxlength="120"></label>
  <label class="field"><span>BIR invoice number <small>(or add it later in Money)</small></span><input name="no" maxlength="60"></label></div>`, {
  submitLabel: 'Mark paid',
  onSubmit: async (fd) => { const f = formObject(fd); await db.adminStatementPaid(ds.id, f.method, f.ref, f.no); toast('Marked paid.'); rerender(); },
}));
on('stmt-void', (ds) => openModal('Cancel this statement?', html`<p class="muted small">Its charges go back to "not billed", so you can make a corrected one.</p>
  <label class="field"><span>Reason</span><input name="note" required minlength="5" maxlength="500"></label>`, {
  submitLabel: 'Cancel statement', danger: true,
  onSubmit: async (fd) => { await db.adminStatementVoid(ds.id, String(fd.get('note')).trim()); toast('Cancelled. Charges are back to not billed.'); rerender(); },
}));
on('sale-record', (ds) => {
  const r = cache.referrals.find((x) => x.id === ds.id);
  const p = cache.partners.find((x) => x.id === r?.partner_id);
  openModal('Record the sale', html`<p class="muted small">${p?.name} reported a sale to ${r?.orgs?.name}. Your fee: ${feeText(p || {})}.</p>
    <label class="field"><span>Sale amount (₱)</span><input name="sale" type="number" min="0" step="0.01" required value="${r?.sale_php ?? ''}"></label>
    <label class="field"><span>Note <small>(optional, on the statement)</small></span><input name="note" maxlength="120"></label>`, {
    submitLabel: 'Save',
    onSubmit: async (fd) => { const fee = await db.adminRecordSale(ds.id, Number(fd.get('sale')), String(fd.get('note') || '').trim()); toast(`Saved. Your fee: ${peso(fee)}.`); rerender(); },
  });
});
on('stmt-print', (ds) => {
  const s = cache.statements.find((x) => x.id === ds.id);
  const p = cache.partners.find((x) => x.id === s?.partner_id);
  const lines = cache.charges.filter((c) => c.statement_id === s.id).sort((a, b) => a.occurred_on.localeCompare(b.occurred_on));
  const sheet = html`<div class="letter"><h2 class="letter-title">STATEMENT OF ACCOUNT</h2>
    <p><b>Pinoy Permit</b><br>Statement ${s.number} · ${fmtDate(s.sent_at.slice(0, 10))}</p>
    <p>To: <b>${p?.name}</b>${p?.contact_name ? html`<br>Attention: ${p.contact_name}` : ''}</p>
    <table class="table"><thead><tr><th>Date</th><th>Description</th><th>Amount</th></tr></thead><tbody>
      ${lines.map((c) => html`<tr><td>${fmtDate(c.occurred_on)}</td><td>${c.description}</td><td>${peso(c.amount_php)}</td></tr>`)}
      <tr><td></td><td><b>Total</b></td><td><b>${peso(s.total_php)}</b></td></tr></tbody></table>
    <p>Please pay by <b>${fmtDate(s.due_on)}</b>. This is a statement, not an official receipt: your BIR invoice is issued when payment is received.</p></div>`;
  openModal(`Statement ${s.number}`, html`<div class="letter-preview">${sheet}</div>`, {
    submitLabel: 'Print or save as PDF',
    onSubmit: () => {
      const el = document.createElement('div'); el.id = 'print-sheet'; el.innerHTML = String(sheet); document.body.appendChild(el);
      document.body.classList.add('printing-sheet');
      const done = () => { document.body.classList.remove('printing-sheet'); el.remove(); window.removeEventListener('afterprint', done); };
      window.addEventListener('afterprint', done);
      setTimeout(() => { window.print(); setTimeout(done, 1000); }, 50);
      return false;
    },
  });
});
document.addEventListener('submit', async (e) => {
  const f = e.target;
  if (!f.matches?.('.admin-ref2')) return;
  e.preventDefault();
  try { await db.adminSaveReferral(f.dataset.id, new FormData(f).get('status')); toast('Saved.'); } catch (err) { toastError(err); }
});
