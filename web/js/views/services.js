// Done for you: Pinoy Permit renews (or applies for) a permit on the customer's behalf. The catalog,
// asking for a quote, and following an order from quote to payment to the finished permit, which
// staff save straight to the customer's account. Guard rails, because this is money and the law:
// an exact quote before anything starts, written authorization, government fees at cost with
// official receipts, and never paying anyone to speed things up (RA 11032 bans fixers).
import { html, fmtDate, fmtDateTime, peso, toast, toastError, confirmDialog, when, normalizePhone, timeAgo, openModal, formObject, plural, todayPH } from '../util.js';
import { S, on, go, reload, canEdit, has, reqById, service, serviceFor, offered, IN_PERSON, business, vehicle, person, empty, careOf, coverOf, tierOf, location_ } from '../core.js';
import { byPriority, subjectLabel, dueShort, ICON } from '../components.js';
import { serviceStrip } from './pricing.js';
import * as db from 'pp/data';

// Customer-facing names for each stage of an order.
export const ORDER_STATUS = {
  submitted: ['Preparing your quote', 'needinfo'],
  quoted: ['Quote ready', 'soon'],
  matching: ['Finding a provider', 'progress'],
  provider_contacted: ['Provider contacted', 'progress'],
  awaiting_customer: ['Waiting for you', 'soon'],
  in_progress: ['In progress', 'progress'],
  completed: ['Completed', 'ok'],
  cancelled: ['Cancelled', 'overdue'],
};
export const PAYMENT_STATUS = {
  unpaid: 'Not paid', awaiting_payment: 'Waiting for payment', pending_verification: 'Payment being checked',
  paid: 'Paid', waived: 'Nothing to pay', refunded: 'Refunded',
};
export const KIND_LABEL = { renew: 'Renewal', apply: 'New application', other: 'Request' };
// [category, heading, one short line, icon]
const CATEGORIES = IN_PERSON ? [
  ['renewal', 'Renewals', 'We renew it, or get it for the first time.', 'renew'],
  ['plan', 'Year-round care', 'One monthly fee. We renew everything for you.', 'calendar'],
  ['package', 'Big jobs', 'Many steps, done in the right order.', 'briefcase'],
  ['document', 'Registrations and papers', 'One-time sign-ups, copies and updates.', 'file'],
  ['advisory', 'Get ready', 'Before an inspection or a bid.', 'check'],
] : [
  ['package', 'Set up', 'Send photos. We type it all in.', 'upload'],
  ['renewal', 'Online renewals', 'Renewed online, saved to your account.', 'renew'],
  ['document', 'Online registrations', 'Registered online for you.', 'file'],
  ['advisory', 'Online upkeep', 'Your online gov\'t accounts, kept current.', 'check'],
];
// What people can count on, in plain sentences (not badges).
const PROMISES = [
  ['peso', 'You see the price first.', 'Nothing starts, and nothing is charged, until you say yes.'],
  ['file', 'Government fees at cost.', 'Exactly what the office charges, with the official receipt.'],
  ['list', 'You can follow every step.', 'Updates, messages and receipts are all here.'],
  ['check', 'Your new permit is saved for you.', 'And your reminders start again for next time.'],
  ['handshake', "If we can't finish it, you get our fee back.", 'If the government fee is lower than quoted, we refund the difference.'],
];
// How it works, in three steps.
const STEPS = [['Pick a service', 'From the list below.'], ['Get your price', 'Within 1 business day.'], ['We do it', 'You can follow each step here.']];
const FINE_PRINT = 'Pinoy Permit acts as your authorized representative, only with your written authorization, and follows each office\'s standard process. We never pay anyone to speed things up: that is against the law (RA 11032). Processing times are set by the government office.';
let settingsCache = null;
const settings = async () => (settingsCache ||= await db.appSettings().catch(() => ({})));
export const paySettings = settings;
const price = (s) => (s.price_from == null ? 'Quoted per job' : `From ${peso(s.price_from)}`);
const isOpen = (a) => !['completed', 'cancelled'].includes(a.status);
// What "urgent" costs, said before they ask (rush pays for our priority, never the government's).
const rushText = (s) => (has('revenue') && s?.rush_fee != null
  ? (Number(s.rush_fee) > 0 ? `+${peso(s.rush_fee)} rush fee: we file within 1 business day and follow up daily. Government processing times don't change.` : 'No extra charge.')
  : "may cost more; we'll say so in the quote");
// Orders the customer sees: done-for-you jobs and renewals started by Year-round care.
const isOrder = (a) => a.service_code || a.care_plan_id;
// Permits that can be renewed for them right now (no open request, a service exists for it).
// Overdue or due within 30 days: what "Renew several" ticks for you.
const dueNow = (r) => r.status === 'action_required' || (r.days_left != null && r.days_left <= 30);
export const renewable = () => S.data.reqs.filter((r) => r.subject !== 'person' && !r.open_request_id && r.expires && serviceFor(r)).sort(byPriority);
// Payment details shown wherever the customer pays us (orders and care bills).
export function payDetails(st) {
  const gcash = st.gcash_number ? html`<div class="paywith"><b>GCash</b><span>${st.gcash_number}${st.gcash_name ? ' · ' + st.gcash_name : ''}</span></div>` : '';
  const bank = st.bank_account_number ? html`<div class="paywith"><b>${st.bank_name || 'Bank transfer'}</b><span>${st.bank_account_number}${st.bank_account_name ? ' · ' + st.bank_account_name : ''}</span></div>` : '';
  const qr = st.payment_qr ? html`<div class="payqr"><img src="${st.payment_qr}" alt="QR code to pay Pinoy Permit" width="200" height="200"><span><b>Scan to pay</b>Open GCash, Maya or your bank app and scan this code.</span></div>` : '';
  return html`${gcash || bank ? html`<div class="paywiths">${gcash}${bank}</div>` : qr ? '' : html`<p class="muted">Pinoy Permit will send you the payment details. Then enter the reference below.</p>`}${qr}
    ${when(st.payment_note, html`<p class="muted small">${st.payment_note}</p>`)}
    <p class="muted small">Only pay to the accounts shown here. Pinoy Permit staff will never ask you to pay a personal account by text or chat.</p>`;
}

// ---------------------------------------------------------------- catalog + my requests
export function services(el, params) {
  if (!has('services')) { el.innerHTML = String(empty('Not available yet', 'Done-for-you services are coming soon.', html`<a class="btn btn-primary" href="#/pros">Find a professional instead</a>`)); return; }
  const requests = (S.data.requests || []).filter(isOrder);
  const open = requests.filter(isOpen);
  const done = requests.filter((a) => !isOpen(a));
  const rev = has('revenue');
  const svc = (S.data.services || []).filter((s) => !(rev && s.category === 'plan') && offered(s));
  const due = rev ? careOf().invoices.filter((i) => i.status === 'due') : [];
  const many = rev && IN_PERSON && canEdit() ? renewable().filter(dueNow) : [];
  const setup = rev ? service('setup_from_paper') : null;
  el.innerHTML = String(html`
    <div class="page-head"><div><h1>Done for you</h1>
      <p class="page-sub">${IN_PERSON ? 'Busy? We do the paperwork and the lines. You just say yes.' : 'Busy? We do the paperwork online. You just say yes.'}</p></div>
      ${when(many.length > 1, html`<button class="btn btn-primary" data-act="svc-bulk">Renew ${many.length} for me</button>`)}</div>
    <section class="card dfy-how"><div class="dfy-how-col"><h2>How it works</h2>
        <ol class="dfy-steps">${STEPS.map(([t, d], i) => html`<li><span class="dfy-n">${i + 1}</span><b>${t}</b><span>${d}</span></li>`)}</ol></div>
      <div class="dfy-how-col"><h2>What you can count on</h2>
        <ul class="dfy-promises">${PROMISES.map(([ic, t, d]) => html`<li><span class="dfy-p-ic" aria-hidden="true">${ICON[ic] || ICON.check}</span><span><b>${t}</b> ${d}</span></li>`)}</ul></div></section>
    ${due.map((i) => html`<div class="banner ${i.due_on < todayPH() ? 'warn' : 'info'}"><div><b>Year-round care bill ${i.number}:</b> ${peso(i.amount_php)}${i.first ? ', coverage starts when it\'s paid' : `, due ${fmtDate(i.due_on)}`}.</div>
      <div class="banner-actions"><a class="btn btn-sm btn-primary" href="#/care?pay=${i.id}">Pay</a></div></div>`)}
    ${when(rev && IN_PERSON, careTeaser())}

    ${when(requests.length, html`<section class="card">
      <div class="card-head"><div><h2>Your requests</h2><p class="card-sub">${plural(open.length, 'open request')}</p></div></div>
      ${[...open, ...done.slice(0, 5)].map(orderLine)}
      ${when(done.length > 5, html`<div class="sheet-foot">${done.length - 5} older requests are not shown.</div>`)}
    </section>`)}

    ${when(setup && !S.data.reqs.some((r) => r.cycle_id), html`<section class="card dfy-hero-offer"><div class="dfy-ho-art" aria-hidden="true">${ICON.camera}</div>
      <div><span class="dfy-kicker">New here? Start with this</span><h2>${setup?.name}</h2><p>Send photos of your permits. We type everything in for you.</p>
        <p class="dfy-ho-meta"><b>${price(setup || {})}</b> · ${setup?.turnaround}</p></div>
      ${when(canEdit(), html`<button class="btn btn-primary" data-act="svc-request" data-code="setup_from_paper">Get a price</button>`)}</section>`)}
    <h2 class="dfy-menu-h">What we can do for you</h2>
    ${svc.length <= 8 ? '' : html`<nav class="dfy-jump" aria-label="Jump to a kind of service">${CATEGORIES.filter(([cat]) => svc.some((s) => s.category === cat)).map(([cat, title, , ic]) => html`<a href="#svc-${cat}" data-scroll-to="svc-${cat}">${ICON[ic] || ICON.check}${title}</a>`)}</nav>`}
    ${svc.length <= 8 ? html`<div class="svc-grid">${CATEGORIES.flatMap(([cat, title, , ic]) => svc.filter((s) => s.category === cat).map((s) => serviceCard(s, [title, ic])))}</div>`
      : CATEGORIES.map(([cat, title, sub, ic]) => {
      const list = svc.filter((s) => s.category === cat);
      return list.length ? html`<div class="dfy-cat" id="svc-${cat}"><span class="dfy-cat-ic" aria-hidden="true">${ICON[ic] || ICON.check}</span><div><h3 class="section-label svc-cat">${title}</h3><p class="section-sub svc-cat-sub">${sub}</p></div></div>
        <div class="svc-grid">${list.map(serviceCard)}</div>` : '';
    })}
    <section class="card dfy-rules"><h2>${IN_PERSON ? 'Prices are starting points' : 'Fixed fees, honest work'}</h2>
      <p>${IN_PERSON ? 'Your exact price depends on your city, the permit and how urgent it is.' : 'Our fees are fixed. Government fees are paid at cost.'}
        We only act with your written OK and follow each office's normal process. We never pay "fixers": that's against the law (RA 11032).</p>
      <details><summary>The full rules</summary><p class="small">${FINE_PRINT}</p></details>
      <a href="terms.html#services" target="_blank" rel="noopener">Done-for-you terms</a></section>
    ${serviceStrip()}`);
  el.querySelectorAll('[data-scroll-to]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); document.getElementById(a.dataset.scrollTo)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  // Links from a permit page or a notification open the request form straight away.
  const pre = params?.get('req');
  if (pre && canEdit()) { history.replaceState(null, '', '#/services'); const r = reqById(pre); if (r) openRequest(serviceFor(r)?.code, { requirementId: r.id }); }
  const pick = params?.get('service');
  if (pick && canEdit()) { history.replaceState(null, '', '#/services'); openRequest(pick, {}); }
}

// Year-round care, at the top of the catalog: what it costs and whether you have it.
function careTeaser() {
  const c = careOf();
  const live = c.plans.filter((p) => p.status !== 'cancelled');
  const from = (subject) => Math.min(...c.tiers.filter((t) => t.subject === subject).map((t) => Number(t.monthly_php)));
  if (!c.tiers.length && !live.length) return '';
  return html`<section class="card care-teaser"><div>
      <h2>Year-round care</h2>
      <p class="muted">${live.length ? `We're looking after ${plural(live.filter((p) => p.location_id).length, 'branch', 'branches')} and ${plural(live.filter((p) => p.vehicle_id).length, 'vehicle')} for you.`
        : `One monthly fee and we start every renewal for you, all year. From ${peso(from('branch'))} per branch or ${peso(from('vehicle'))} per vehicle a month.`}</p></div>
    <a class="btn ${live.length ? 'btn-soft' : 'btn-primary'} btn-sm" href="#/care">${live.length ? 'Your plan' : 'See how it works'}</a></section>`;
}

// One service on the menu: name, big price, how long, one button. The details fold open on tap.
function serviceCard(s, tag) {
  return html`<section class="card svc">
    ${tag ? html`<span class="svc-tag">${ICON[tag[1]] || ICON.check}${tag[0]}</span>` : ''}
    <h2>${s.name}</h2>
    <div class="svc-price"><b>${price(s)}</b><small>${s.price_unit}</small></div>
    <div class="svc-chips">${s.turnaround ? html`<span class="svc-chip">${ICON.calendar}${s.turnaround}</span>` : ''}</div>
    <details class="svc-more"><summary>What you get</summary><p class="svc-sum">${s.summary}</p>
      <ul class="svc-inc">${(s.includes || []).map((i) => html`<li>${ICON.check}<span>${i}</span></li>`)}</ul>
      ${when(has('revenue') && Number(s.rush_fee) > 0, html`<p class="svc-rush"><b>In a hurry?</b> Add ${peso(s.rush_fee)} and we file within 1 business day.</p>`)}</details>
    ${canEdit() ? html`<button class="btn btn-primary btn-block" data-act="svc-request" data-code="${s.code}">Get a price</button>` : ''}
  </section>`;
}

function orderLine(a) {
  const [label, cls] = ORDER_STATUS[a.status] || [a.status, 'needinfo'];
  const care = a.care_plan_id && has('revenue');
  const action = a.status === 'quoted' ? 'Review quote' : a.payment_status === 'awaiting_payment' && isOpen(a) ? 'Pay now' : 'Open';
  return html`<a class="line" href="#/services/orders/${a.id}"><span class="line-main"><b>${a.kind === 'apply' ? 'New: ' : ''}${a.requirement_name}</b>
    <small>${a.subject_label} · ${care ? (a.created_by ? 'included in your care plan' : 'started by Year-round care') : 'sent'} ${timeAgo(a.created_at)}${a.quote_php != null ? ' · ' + peso(a.quote_php) : ''}</small></span>
    <span class="chip ${cls}">${label}</span><span class="btn btn-sm ${['Review quote', 'Pay now'].includes(action) ? 'btn-primary' : 'btn-soft'}">${action}</span></a>`;
}

// ---------------------------------------------------------------- asking for a quote
function targets(s) {
  // What the order is for: a tracked permit (renewals, walk-throughs) or a business / vehicle / person.
  if (s.visit && has('revenue')) {
    return { kind: 'requirement', visit: true, list: S.data.reqs.filter((r) => !r.open_request_id && s.type_codes.includes(r.type_code)).sort(byPriority) };
  }
  if (s.category === 'renewal') {
    const reqs = S.data.reqs.filter((r) => !r.open_request_id && (s.type_codes.length ? s.type_codes.includes(r.type_code) : r.subject !== 'person'))
      .sort(byPriority);
    return { kind: 'requirement', list: reqs };
  }
  const subjects = [];
  if (['business', 'any'].includes(s.applies_to)) S.data.businesses.forEach((b) => subjects.push(['business:' + b.id, b.name]));
  if (['vehicle', 'any'].includes(s.applies_to)) S.data.vehicles.forEach((v) => subjects.push(['vehicle:' + v.id, `${v.make_model}${v.plate_no ? ' · ' + v.plate_no : ''}`]));
  if (['person', 'any'].includes(s.applies_to)) (S.data.people || []).forEach((p) => subjects.push(['person:' + p.id, p.full_name]));
  return { kind: 'subject', list: subjects };
}
// Never had it (no record yet) = a first-time application.
const firstTime = (r) => !r?.cycle_id;

export function openRequest(code, { requirementId } = {}) {
  const s = service(code);
  if (!offered(s)) return toast('That service is not available right now.', 'error');
  if (!canEdit()) return toast('Only people who can edit this workspace can ask for a quote.', 'error');
  const t = targets(s);
  const optional = s.applies_to === 'any' && s.category !== 'renewal';
  if (t.kind === 'requirement' && !t.list.length) {
    const handled = requirementId && reqById(requirementId)?.open_request_id;
    return toast(handled ? 'Pinoy Permit is already handling this permit. Open its request to follow it.'
      : s.type_codes.length ? 'You have no permit of this kind yet, or it already has an open request. Add the permit first.' : 'Add a business or vehicle first.', 'error');
  }
  if (t.kind === 'subject' && !t.list.length && !optional) return toast(`Add a ${s.applies_to} first, then ask for this service.`, 'error');
  const start = t.kind === 'requirement' ? (t.list.find((r) => r.id === requirementId) || t.list[0]) : null;
  const loc = start?.location_id ? location_(start.location_id) : null;
  const pick = t.visit
    ? html`<label class="field"><span>For which permit's inspection?</span><select name="target" required>
        ${t.list.map((r) => html`<option value="${r.id}" ${r === start ? 'selected' : ''}>${r.name} — ${subjectLabel(r)}</option>`)}</select></label>
      <div class="grid2"><label class="field"><span>Dates that suit you</span><input name="visit_dates" maxlength="200" required placeholder="e.g. Any weekday morning next week"></label>
        <label class="field"><span>Site address</span><input name="site_address" maxlength="300" required value="${loc ? [loc.address, loc.city].filter(Boolean).join(', ') : ''}"></label></div>
      <p class="muted small" data-included hidden>${ICON.check} Included in your care plan (one walk-through a year per branch): no service fee.</p>`
    : t.kind === 'requirement'
    ? html`<label class="field"><span>Which permit?</span><select name="target" required>
        ${t.list.map((r) => html`<option value="${r.id}" ${r === start ? 'selected' : ''}>${r.name} — ${subjectLabel(r)} (${dueShort(r)})</option>`)}</select></label>
      <fieldset class="field kind-pick"><legend>What do you need?</legend>
        <label class="check"><input type="radio" name="kind" value="renew" ${firstTime(start) ? '' : 'checked'}><span>Renew it <small class="muted">(we have it already)</small></span></label>
        <label class="check"><input type="radio" name="kind" value="apply" ${firstTime(start) ? 'checked' : ''}><span>Get it for the first time <small class="muted">(we don't have it yet)</small></span></label></fieldset>`
    : html`<label class="field"><span>For</span><select name="target">${optional ? html`<option value="">A new business (not in Pinoy Permit yet)</option>` : ''}
        ${t.list.map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select></label>`;
  openModal(s.name, html`
    <div class="quote-hint"><b>${price(s)}</b> <span class="muted">${s.price_unit}</span>${s.turnaround ? html`<span class="muted"> · usually ${s.turnaround}</span>` : ''}</div>
    <p class="muted small">You'll get an exact quote within 1 business day. Nothing starts and nothing is charged until you accept it.</p>
    ${pick}
    ${when(s.category === 'renewal', html`<label class="field"><span>Do you have the documents?</span><select name="docs_status">
      <option value="have">Yes, they're uploaded in Pinoy Permit</option><option value="need">No, I still need them</option><option value="not_sure" selected>Not sure what's needed</option></select></label>`)}
    ${when(s.needs_access && has('revenue'), html`<p class="banner info small"><span>To do this, Pinoy Permit joins your workspace as a team member until the job is done. You'll be asked to OK that with the quote, and you can remove it anytime under Team.</span></p>`)}
    ${when(!(s.visit && has('revenue')), html`<label class="check"><input type="checkbox" name="rush"><span>It's urgent <small class="muted">(${rushText(s)})</small></span></label>`)}
    <div class="grid2">
      <label class="field"><span>Best way to reach you</span><select name="contact_method">
        <option value="email">Email</option><option value="phone">Phone call / SMS</option><option value="viber">Viber</option><option value="whatsapp">WhatsApp</option></select></label>
      <label class="field"><span>Email or mobile</span><input name="contact_value" value="${S.profile.email || ''}" maxlength="120" required></label>
    </div>
    <label class="field"><span>Anything we should know? <small>(optional)</small></span>
      <textarea name="notes" rows="3" maxlength="2000" placeholder="e.g. Please finish before Jan 20. The barangay clearance is already done."></textarea></label>
    <label class="check consent"><input type="checkbox" name="consent" required>
      <span>I authorize Pinoy Permit to process this for ${S.org.name} and will sign an authorization letter. Government fees are paid at cost with official receipts.
        <a href="terms.html#services" target="_blank" rel="noopener">Done-for-you terms</a></span></label>`, {
    submitLabel: 'Ask for a quote',
    onOpen: (form) => {
      const m = form.querySelector('[name=contact_method]');
      const v = form.querySelector('[name=contact_value]');
      m.addEventListener('change', () => { v.value = m.value === 'email' ? S.profile.email || '' : S.profile.phone || ''; v.placeholder = m.value === 'email' ? 'you@company.ph' : '0917 123 4567'; });
      // Choosing a different permit updates "renew" vs "first time" to match it.
      const sel = form.querySelector('select[name=target]');
      if (t.kind === 'requirement' && sel && !t.visit) sel.addEventListener('change', () => {
        const r = reqById(sel.value);
        form.querySelector(`[name=kind][value=${firstTime(r) ? 'apply' : 'renew'}]`).checked = true;
      });
      // Walk-throughs: say when the care plan covers it, and fill the branch address.
      if (t.visit && sel) {
        const sync = () => {
          const r = reqById(sel.value);
          const p = r ? coverOf(r) : null;
          const used = p && (S.data.requests || []).some((a) => a.care_plan_id === p.id && service(a.service_code)?.visit && a.status !== 'cancelled'
            && Date.now() - Date.parse(a.created_at) < 365 * 864e5);
          form.querySelector('[data-included]').hidden = !(p && p.status === 'active' && tierOf(p.tier)?.walkthroughs > 0 && !used);
          const l = r?.location_id ? location_(r.location_id) : null;
          const addr = form.querySelector('[name=site_address]');
          if (l && !addr.dataset.typed) addr.value = [l.address, l.city].filter(Boolean).join(', ');
        };
        form.querySelector('[name=site_address]').addEventListener('input', (e) => { e.target.dataset.typed = '1'; });
        sel.addEventListener('change', sync); sync();
      }
    },
    onSubmit: async (fd) => {
      const f = formObject(fd);
      let contact = (f.contact_value || '').trim();
      if (f.contact_method === 'email') { if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact)) throw new Error('Please enter a valid email address so we can send your quote.'); }
      else { contact = normalizePhone(contact); if (!contact) throw new Error('Please enter a valid mobile number, e.g. 0917 123 4567.'); }
      if (!f.consent) throw new Error('Please tick the box to authorize Pinoy Permit for this request.');
      const notes = t.visit ? [`Preferred dates: ${f.visit_dates}`, `Site address: ${f.site_address}`, f.notes].filter(Boolean).join('\n') : f.notes;
      const row = { org_id: S.org.id, service_code: s.code, notes, rush: !!f.rush, contact_method: f.contact_method, contact_value: contact,
        docs_status: f.docs_status, consent: true, kind: t.visit ? 'other' : t.kind === 'requirement' ? (f.kind === 'apply' ? 'apply' : 'renew') : 'other' };
      if (t.kind === 'requirement') {
        if (!f.target) throw new Error('Choose the permit.');
        row.requirement_id = f.target;
      } else if (f.target) {
        const [kind, id] = f.target.split(':');
        row[kind + '_id'] = id;
      } else if (!optional) throw new Error('Choose what this is for.');
      const id = await db.requestService(row);
      await reload();
      go('#/services/orders/' + id);
      toast("Request sent. We'll send your exact quote within 1 business day.");
    },
  });
}
on('svc-request', (ds) => openRequest(ds.code, { requirementId: ds.req || null }));
on('svc-for-req', (ds) => { const r = reqById(ds.id); if (r) openRequest(serviceFor(r)?.code, { requirementId: r.id }); });

// ---------------------------------------------------------------- one order
export async function order(el, id) {
  let a = (S.data.requests || []).find((x) => x.id === id);
  // The app may have been open for a while: show the order as it is now. If it moved on (quoted, paid,
  // finished) since the app loaded, refresh everything, so the permit page shows the new record too.
  try {
    const fresh = await db.getRequest(id);
    if (fresh && a && (fresh.status !== a.status || fresh.payment_status !== a.payment_status)) { await reload(); return; }
    if (fresh) { if (a) Object.assign(a, fresh); else (S.data.requests ||= []).unshift(a = fresh); }
  } catch { /* fall back to what we have */ }
  if (!location.hash.includes(id)) return;
  if (!a) { el.innerHTML = String(empty('Request not found', 'It may belong to another workspace.', html`<a class="btn btn-primary" href="#/services">Back to Done for you</a>`)); return; }
  el.innerHTML = String(html`<div class="loading">Loading…</div>`);
  let ev = [], st = {}, refunds = [];
  try { [ev, st, refunds] = await Promise.all([db.orderEvents(id), settings(), db.orderRefunds(id).catch(() => [])]); } catch (e) { toastError(e); }
  if (!location.hash.includes(id)) return;
  const [label, cls] = ORDER_STATUS[a.status] || [a.status, 'needinfo'];
  const s = service(a.service_code);
  const closed = !isOpen(a);
  const stage = a.status === 'cancelled' ? -1 : a.status === 'completed' ? 5 // every step ticked
    : ['paid', 'waived'].includes(a.payment_status) ? 3 : a.accepted_at ? 2 : a.quoted_at ? 1 : 0;
  const steps = ['Request sent', 'Quote', 'Payment', 'In progress', 'Done'];
  const r = a.requirement_id ? reqById(a.requirement_id) : null;
  const rev = has('revenue');
  const care = rev && a.care_plan_id;
  const jobSteps = rev ? s?.steps || [] : [];
  const access = rev ? careOf().staff.find((x) => x.request_id === a.id) : null;

  el.innerHTML = String(html`
    <a class="back" href="#/services">← Done for you</a>
    <div class="page-head"><div><h1>${a.requirement_name}</h1><p class="muted">${KIND_LABEL[a.kind] || 'Request'} · ${a.subject_label}${a.location_label ? ' · ' + a.location_label : ''}${a.rush ? ' · Urgent' : ''}${care ? (a.created_by ? ' · Included in your care plan' : ' · Year-round care') : ''}</p></div>
      <div class="head-side"><span class="chip lg ${cls}">${label}</span></div></div>
    ${when(stage >= 0, html`<ol class="stepper" aria-label="Progress">${steps.map((t, i) => html`<li class="${i < stage ? 'done' : i === stage ? 'now' : ''}" ${i === stage ? 'aria-current="step"' : ''}><span>${i < stage ? '✓' : i + 1}</span>${t}</li>`)}</ol>`)}

    ${when(a.status === 'submitted', care && !a.created_by
      ? html`<div class="banner info"><div><b>Your care plan started this renewal.</b> ${careOf().plans.find((p) => p.id === a.care_plan_id)?.billing === 'per_renewal'
        ? 'We\'re checking the government fees and will send you the exact price here within 1 business day: our usual fee plus the government fees. Nothing is filed until you approve it.'
        : 'We\'re checking the exact government fees and will send them here within 1 business day. Our service fee is covered by your plan.'}</div></div>`
      : html`<div class="banner info"><div><b>We're preparing your exact quote.</b> You'll get it within 1 business day, by ${a.contact_method === 'email' ? 'email' : a.contact_method} and here. Nothing is charged until you accept it.</div></div>`)}
    ${when(access && !closed, html`<div class="banner info"><div><b>Pinoy Permit has access to ${S.org.name}</b> to do this set-up. It ends automatically when this order is done. <a href="#/team">Remove it now</a></div></div>`)}
    ${when(a.status === 'quoted', quoteBox(a))}
    ${when(['awaiting_payment', 'pending_verification'].includes(a.payment_status) && !closed, payBox(a, st))}
    ${when(['paid', 'waived'].includes(a.payment_status) && !closed, html`<div class="banner progress"><div><b>We're working on it.</b> Sign and upload the authorization letter below if you haven't yet. We'll post every update here.</div></div>`)}
    ${when(a.status === 'completed', html`<div class="banner ok-banner"><div><b>Done.</b> ${r ? html`The new record is saved to <a href="#/requirement/${r.id}">${r.name}</a>.` : 'Your documents are attached below.'}</div></div>`)}
    ${when(a.admin_note && !closed && a.status !== 'quoted', html`<div class="banner warn"><div><b>From Pinoy Permit:</b> ${a.admin_note}</div></div>`)}

    ${when(jobSteps.length, html`<section class="card"><div class="card-head"><div><h2>Steps</h2><p class="card-sub">${a.steps_done || 0} of ${jobSteps.length} done</p></div></div>
      <ol class="job-steps">${jobSteps.map((t, i) => html`<li class="${i < (a.steps_done || 0) ? 'done' : i === (a.steps_done || 0) && !closed && ['paid', 'waived'].includes(a.payment_status) ? 'now' : ''}">
        <span aria-hidden="true">${i < (a.steps_done || 0) ? '✓' : i + 1}</span>${t}${i < (a.steps_done || 0) ? html`<span class="sr-only"> (done)</span>` : ''}</li>`)}</ol></section>`)}
    <section class="card">
      <div class="card-head"><div><h2>Summary</h2></div>
        ${when(!closed && ['renew', 'apply'].includes(a.kind), html`<button class="btn btn-sm btn-soft" data-act="auth-letter" data-id="${a.id}">${ICON.file} Authorization letter</button>`)}</div>
      <dl class="kv">
        <dt>Service</dt><dd>${s?.name || a.requirement_name}</dd>
        <dt>Type</dt><dd>${KIND_LABEL[a.kind] || 'Request'}</dd>
        <dt>For</dt><dd>${a.subject_label}</dd>
        ${when(a.due_on, html`<dt>Permit deadline</dt><dd>${fmtDate(a.due_on)}</dd>`)}
        <dt>Quote</dt><dd>${a.quote_php != null ? html`${peso(a.quote_php)} <span class="muted small">(service ${peso(a.quote_service_fee)}${Number(a.quote_rush_fee) > 0 ? ' + rush ' + peso(a.quote_rush_fee) : ''} + government fees ${peso(a.quote_gov_fees)})</span>` : 'Being prepared'}</dd>
        <dt>Payment</dt><dd>${PAYMENT_STATUS[a.payment_status] || a.payment_status}${a.paid_at ? ' · ' + fmtDate(a.paid_at.slice(0, 10)) : ''}</dd>
        ${when(a.gov_fees_actual != null, html`<dt>Government fees paid</dt><dd>${peso(a.gov_fees_actual)}</dd>`)}
        ${refunds.map((x) => html`<dt>Refunded</dt><dd><b>${peso(x.amount_php)}</b> <span class="muted small">${fmtDate(x.created_at.slice(0, 10))} · ${x.reason}${x.reference ? ' · ref ' + x.reference : ''}</span></dd>`)}
        <dt>Sent</dt><dd>${fmtDateTime(a.created_at)}</dd>
        ${when(a.consented_at, html`<dt>Authorized</dt><dd>${fmtDateTime(a.consented_at)}</dd>`)}
      </dl>
    </section>

    <section class="card">
      <div class="card-head"><h2>Timeline</h2><span class="muted small">${plural(ev.length, 'update')}</span></div>
      <ol class="timeline">${ev.map((e) => html`<li class="${e.by_staff ? 'staff' : ''}">
        <div class="tl-dot"></div><div class="tl-body"><div class="tl-head"><b>${e.by_staff ? 'Pinoy Permit' : 'You'}</b><span class="muted small">${fmtDateTime(e.created_at)}</span></div>
        ${when(e.message, html`<div class="pre">${e.message}</div>`)}
        ${when(e.file_path, html`<button class="linklike doc-file" data-act="doc-view" data-path="${e.file_path}" data-name="${e.file_name || 'file'}" data-type="">${ICON.file}${e.file_name || 'Attached file'}</button>`)}
        </div></li>`)}</ol>
      ${when(!closed && canEdit(), html`<form class="msg-form" data-id="${a.id}">
        <label class="field"><span>Message Pinoy Permit</span><textarea name="message" rows="2" maxlength="2000" placeholder="Ask a question, or send the signed authorization letter"></textarea></label>
        <div class="btn-row"><label class="file-pick"><span class="sr-only">Attach a file</span><input type="file" name="file" accept=".pdf,image/*"></label><button class="btn btn-soft btn-sm">Send</button></div></form>`)}
    </section>

    ${when(!closed && canEdit() && !['paid', 'waived', 'pending_verification'].includes(a.payment_status), html`<div class="danger-zone"><button class="btn btn-ghost danger" data-act="order-cancel" data-id="${a.id}">Cancel this request</button>
      <span class="muted small">Nothing has been charged.</span></div>`)}
    ${when(!closed && ['paid', 'waived', 'pending_verification'].includes(a.payment_status), html`<p class="fineprint">Need to stop this order? Send us a message above. If we haven't filed anything yet, you get the service fee back. If we can't deliver, you get it back in full.</p>`)}
    <p class="muted small fineprint">${FINE_PRINT}</p>`);

  el.querySelector('.msg-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = e.target.querySelector('button');
    const message = String(fd.get('message') || '').trim();
    const file = fd.get('file');
    if (!message && !(file && file.size)) return toast('Write a message or attach a file first.', 'error');
    btn.disabled = true;
    try { await db.addOrderMessage(a, message, file); toast('Sent.'); order(el, id); } catch (err) { btn.disabled = false; toastError(err); }
  });
  el.querySelector('.pay-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = e.target.querySelector('button[type=submit]');
    const ref = String(fd.get('ref') || '').trim();
    const file = fd.get('file');
    if (!ref && !(file && file.size)) return toast('Add the reference number or a screenshot of the payment, so we can find it.', 'error');
    btn.disabled = true;
    try {
      await db.submitPayment(a, { method: fd.get('method'), ref, file });
      await reload(); toast("Thanks! We'll confirm your payment within 1 business day.");
    } catch (err) { btn.disabled = false; toastError(err); }
  });
}

function quoteBox(a) {
  const s = service(a.service_code);
  const care = has('revenue') && a.care_plan_id;
  const access = has('revenue') && s?.needs_access;
  return html`<section class="card quote">
    <div class="card-head"><div><h2>Your quote</h2><p class="card-sub">Sent ${a.quoted_at ? timeAgo(a.quoted_at) : ''}</p></div></div>
    <div class="qline"><span>Service fee${care && !Number(a.quote_service_fee) ? html` <small class="muted">(covered by your care plan)</small>` : ''}</span><b>${peso(a.quote_service_fee)}</b></div>
    ${when(Number(a.quote_rush_fee) > 0, html`<div class="qline"><span>Rush fee <small class="muted">(we file within 1 business day)</small></span><b>${peso(a.quote_rush_fee)}</b></div>`)}
    <div class="qline"><span>Government fees <small class="muted">(estimate, paid at cost with official receipts)</small></span><b>${peso(a.quote_gov_fees)}</b></div>
    <div class="qline total"><span>Total</span><b>${peso(a.quote_php)}</b></div>
    ${when(a.quote_note, html`<p class="quote-note pre">${a.quote_note}</p>`)}
    ${when(access && canEdit(), html`<label class="check consent"><input type="checkbox" data-access-ok>
      <span>Pinoy Permit may join ${S.org.name} as a team member to set it up. Access ends automatically when the job is done, and I can remove it anytime under Team.</span></label>`)}
    ${when(canEdit(), html`<div class="btn-row qbtns"><button class="btn btn-primary" data-act="quote-accept" data-id="${a.id}">Accept quote</button>
      <button class="btn btn-ghost" data-act="order-cancel" data-id="${a.id}">No thanks</button></div>`)}
    <div class="sheet-foot">If the government fees end up lower, we refund the difference. If they are higher, we ask you before paying. If we can't deliver, the service fee is refunded in full.</div>
  </section>`;
}

function payBox(a, st) {
  if (a.payment_status === 'pending_verification') {
    return html`<div class="banner info"><div><b>We're checking your payment</b> of ${peso(a.quote_php)}${a.payment_ref ? ' (ref ' + a.payment_ref + ')' : ''}. Work starts as soon as it's confirmed, usually within 1 business day.</div></div>`;
  }
  return html`<section class="card pay">
    <div class="card-head"><div><h2>Pay ${peso(a.quote_php)}</h2><p class="card-sub">Pay exactly this amount. Work starts once the payment is confirmed.</p></div></div>
    ${payDetails(st)}
    ${when(canEdit(), html`<form class="pay-form">
      <div class="grid2">
        <label class="field"><span>Paid with</span><select name="method"><option value="gcash">GCash</option><option value="maya">Maya</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option></select></label>
        <label class="field"><span>Reference number</span><input name="ref" maxlength="120" placeholder="e.g. 1009 234 567890"></label>
      </div>
      <label class="field"><span>Screenshot of the payment <small>(optional if you entered the reference)</small></span><input type="file" name="file" accept="image/*,.pdf"></label>
      <button type="submit" class="btn btn-primary">I've paid</button></form>`)}
  </section>`;
}

on('quote-accept', async (ds) => {
  const a = S.data.requests.find((x) => x.id === ds.id);
  if (!a) return;
  const box = document.querySelector('[data-access-ok]');
  if (box && !box.checked) { box.closest('label').classList.add('need'); box.focus(); return toast('Tick the box to let Pinoy Permit join for the set-up first.', 'error'); }
  if (!(await confirmDialog('Accept this quote?', `Total ${peso(a.quote_php)}. Next you'll pay, then we start.`, { confirmLabel: 'Accept quote', danger: false }))) return;
  try { await db.acceptQuote(ds.id, !!box?.checked); await reload(); toast(Number(a.quote_php) ? 'Quote accepted. Pay below to get started.' : 'Accepted. We\'re starting now.'); } catch (e) { toastError(e); }
});
on('order-cancel', async (ds) => {
  if (!(await confirmDialog('Cancel this request?', 'We will stop working on it. Nothing has been charged.', { confirmLabel: 'Cancel request', cancelLabel: 'Keep it' }))) return;
  try { await db.cancelHelpRequest(ds.id); await reload(); toast('Request cancelled.'); } catch (e) { toastError(e); }
});

// ---------------------------------------------------------------- authorization letter
// Shown in a pop-up and printed from the page itself (no new window, so phones and pop-up blockers are fine).
on('auth-letter', (ds) => {
  const a = S.data.requests.find((x) => x.id === ds.id);
  if (!a) return;
  const b = a.business_id ? business(a.business_id) : null;
  const v = a.vehicle_id ? vehicle(a.vehicle_id) : null;
  const p = a.person_id ? person(a.person_id) : null;
  const who = b ? b.name : v ? `${v.make_model}${v.plate_no ? ', plate no. ' + v.plate_no : ''}` : p ? p.full_name : a.subject_label;
  const me = [S.profile.first_name, S.profile.last_name].filter(Boolean).join(' ');
  const today = new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Manila' });
  const what = a.kind === 'apply' ? 'apply for' : 'renew';
  const letter = html`<div class="letter">
    <p>${today}</p>
    <h2 class="letter-title">AUTHORIZATION LETTER</h2>
    <p>To whom it may concern:</p>
    <p>I, <b>${me || '______________________________'}</b>, ${b ? html`owner / authorized officer of <b>${b.name}</b>` : html`owner of <b>${who}</b>`}, hereby authorize
      <b>______________________________</b> of Pinoy Permit to ${what}, follow up, pay the official fees for, and receive on my behalf the
      <b>${a.requirement_name}</b> for <b>${who}</b>${/\.$/.test(who) ? '' : '.'}</p>
    <p>This authorization is valid only for the transaction stated above.</p>
    <div class="letter-sig"><div>Signature over printed name<br>${me}</div><div>Authorized representative<br>Signature over printed name</div></div>
  </div>`;
  openModal('Authorization letter', html`
    <p class="muted small">1) Print it (or save it as PDF), 2) fill in the blanks and sign, 3) send a photo of it in your request's messages. Attach a copy of your valid ID too.
      We fill in our representative's name when we file.</p>
    <div class="letter-preview">${letter}</div>`, {
    submitLabel: 'Print or save as PDF',
    onSubmit: () => {
      const sheet = document.createElement('div');
      sheet.id = 'print-sheet';
      sheet.innerHTML = String(letter);
      document.body.appendChild(sheet);
      document.body.classList.add('printing-sheet');
      const done = () => { document.body.classList.remove('printing-sheet'); sheet.remove(); window.removeEventListener('afterprint', done); };
      window.addEventListener('afterprint', done);
      setTimeout(() => { window.print(); setTimeout(done, 1000); }, 50);
      return false; // keep the pop-up open so they can print again
    },
  });
});

// ---------------------------------------------------------------- the offer on a permit page
export function serviceOffer(r, { compact = false } = {}) {
  if (!has('services')) return '';
  if (r.open_request_id && canEdit()) {
    return html`<div class="offer-inline"><div class="offer-body">${ICON.briefcase}<div><b>Pinoy Permit is handling this</b>
      <span class="muted">Follow the progress in your request.</span></div></div><a class="btn btn-soft btn-sm" href="#/services/orders/${r.open_request_id}">Open request</a></div>`;
  }
  const s = serviceFor(r);
  if (!s || !canEdit() || (r.status === 'compliant' && !r.expires)) return '';
  const apply = !r.cycle_id;
  return html`<div class="offer-inline ${compact ? 'compact' : ''}"><div class="offer-body">${ICON.briefcase}<div>
    <b>${compact ? 'No time for all this?' : ''} Have Pinoy Permit ${apply ? 'get it for you' : 'renew it for you'}</b>
    <span class="muted">${price(s)} ${s.price_unit} plus government fees at cost${s.turnaround ? ' · usually ' + s.turnaround : ''}. Exact quote first; nothing is charged until you accept.</span></div></div>
    <button class="btn btn-primary btn-sm" data-act="svc-for-req" data-id="${r.id}">Get a quote</button></div>`;
}

// ---------------------------------------------------------------- several permits in one request
// Overdue and due-within-30-days are ticked for them; everything else is one tap away.
export function openBulk(preselect = null) {
  if (!has('revenue')) return;
  if (!canEdit()) return toast('Only people who can edit this workspace can ask for a quote.', 'error');
  const list = renewable();
  if (!list.length) return toast('Nothing to renew right now: every permit is either done, being handled, or has no renewal service.', 'info');
  const pre = (r) => (preselect ? preselect.includes(r.id) : dueNow(r));
  const groups = [
    ['Overdue', list.filter((r) => r.status === 'action_required')],
    ['Due within 60 days', list.filter((r) => r.status !== 'action_required' && r.days_left != null && r.days_left <= 60)],
    ['Later', list.filter((r) => r.status !== 'action_required' && !(r.days_left != null && r.days_left <= 60))],
  ].filter(([, l]) => l.length);
  openModal('Renew several for me', html`
    <p class="muted small">Tick the permits we should renew. You get an exact quote for each one within 1 business day, and accept or decline each separately. Nothing is charged until you accept.</p>
    ${groups.map(([title, l]) => html`<fieldset class="bulk-group"><legend>${title} <small class="muted">(${l.length})</small></legend>
      ${title === 'Later' && !l.some(pre) ? html`<details><summary>Show ${plural(l.length, 'permit')}</summary>${l.map((r) => bulkRow(r, pre(r)))}</details>` : l.map((r) => bulkRow(r, pre(r)))}</fieldset>`)}
    <div class="bulk-sum" aria-live="polite" data-bulk-sum></div>
    <label class="check"><input type="checkbox" name="rush"><span>They're urgent <small class="muted">(a rush fee applies to each one; it's shown in each quote)</small></span></label>
    <div class="grid2">
      <label class="field"><span>Best way to reach you</span><select name="contact_method">
        <option value="email">Email</option><option value="phone">Phone call / SMS</option><option value="viber">Viber</option><option value="whatsapp">WhatsApp</option></select></label>
      <label class="field"><span>Email or mobile</span><input name="contact_value" value="${S.profile.email || ''}" maxlength="120" required></label>
    </div>
    <label class="field"><span>Anything we should know? <small>(optional)</small></span><textarea name="notes" rows="2" maxlength="2000"></textarea></label>
    <label class="check consent"><input type="checkbox" name="consent" required>
      <span>I authorize Pinoy Permit to process these for ${S.org.name} and will sign an authorization letter. Government fees are paid at cost with official receipts.
        <a href="terms.html#services" target="_blank" rel="noopener">Done-for-you terms</a></span></label>`, {
    wide: true, submitLabel: 'Ask for quotes',
    onOpen: (form) => {
      const m = form.querySelector('[name=contact_method]');
      const v = form.querySelector('[name=contact_value]');
      m.addEventListener('change', () => { v.value = m.value === 'email' ? S.profile.email || '' : S.profile.phone || ''; });
      const paint = () => {
        const ids = [...form.querySelectorAll('[name=req]:checked')].map((x) => x.value);
        const est = ids.map((id) => serviceFor(reqById(id))).reduce((t, x) => t + Number(x?.price_from || 0), 0);
        const quoted = ids.filter((id) => serviceFor(reqById(id))?.price_from == null).length;
        form.querySelector('[data-bulk-sum]').innerHTML = String(ids.length
          ? html`<b>${plural(ids.length, 'permit')}</b> · our fees from about ${peso(est)}${quoted ? ` plus ${quoted} quoted separately` : ''}, plus government fees at cost.${ids.length > 25 ? html` <span class="due overdue">Choose up to 25 at a time.</span>` : ''}`
          : html`<span class="muted">Tick at least one permit.</span>`);
        form.querySelector('button[type=submit]').textContent = ids.length ? `Ask for ${plural(ids.length, 'quote')}` : 'Ask for quotes';
      };
      form.addEventListener('change', paint); paint();
    },
    onSubmit: async (fd) => {
      const f = formObject(fd);
      const ids = fd.getAll('req');
      if (!ids.length) throw new Error('Tick at least one permit.');
      if (ids.length > 25) throw new Error('Choose up to 25 permits at a time.');
      let contact = (f.contact_value || '').trim();
      if (f.contact_method === 'email') { if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact)) throw new Error('Please enter a valid email address so we can send your quotes.'); }
      else { contact = normalizePhone(contact); if (!contact) throw new Error('Please enter a valid mobile number, e.g. 0917 123 4567.'); }
      if (!f.consent) throw new Error('Please tick the box to authorize Pinoy Permit for these permits.');
      await db.requestServicesBulk({ org_id: S.org.id, requirement_ids: ids, rush: !!f.rush, contact_method: f.contact_method, contact_value: contact, notes: f.notes, consent: true });
      await reload();
      go('#/services');
      toast(`Sent. You'll get ${plural(ids.length, 'quote')} within 1 business day.`);
    },
  });
}
function bulkRow(r, checked) {
  const s = serviceFor(r);
  return html`<label class="check bulk-row"><input type="checkbox" name="req" value="${r.id}" ${checked ? 'checked' : ''}>
    <span><b>${r.name}</b> <small class="muted">${subjectLabel(r)} · ${dueShort(r)}</small><small class="muted">${s ? `${price(s)} ${s.price_unit}` : ''}</small></span></label>`;
}
on('svc-bulk', (ds) => openBulk(ds.ids ? ds.ids.split(',') : null));
