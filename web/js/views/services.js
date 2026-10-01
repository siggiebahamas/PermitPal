// Done-for-you services: the catalog, asking for a service, and following an order from
// quote to payment to the finished permit (saved to the customer's account by PermitPal).
import { html, fmtDate, fmtDateTime, peso, toast, toastError, confirmDialog, when, normalizePhone, timeAgo, openModal, formObject, plural } from '../util.js';
import { S, on, go, reload, canEdit, reqById, service, serviceFor, business, vehicle, person, empty } from '../core.js';
import { byPriority, subjectLabel, dueShort, STATUS, ICON } from '../components.js';
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
const CATEGORIES = [
  ['renewal', 'Renewals', 'We renew it for you and save the new permit to your account.'],
  ['plan', 'Year-round care', 'One monthly fee. We watch and renew everything for you.'],
  ['package', 'Packages', 'Bigger jobs, done in the right order.'],
  ['document', 'Documents', 'Replacements, copies and registration updates.'],
  ['advisory', 'Advisory', 'Get ready before an inspection or a bid.'],
];
const PROMISES = [
  ['Exact quote first', 'Nothing starts and nothing is charged until you accept a written quote.'],
  ['Government fees at cost', 'You pay the agency\'s fees exactly as charged, with official receipts uploaded here.'],
  ['Track every step', 'Every update, message and receipt is in your request timeline.'],
  ['Saved for you', 'When it\'s done, the new permit is saved to your account and your reminders reset.'],
];
let settingsCache = null;
const settings = async () => (settingsCache ||= await db.appSettings().catch(() => ({})));
const price = (s) => (s.price_from == null ? 'Quoted per job' : `From ${peso(s.price_from)}`);

// ---------------------------------------------------------------- catalog + my requests
export function services(el, params) {
  const requests = S.data.requests;
  const open = requests.filter((a) => !['completed', 'cancelled'].includes(a.status));
  const done = requests.filter((a) => ['completed', 'cancelled'].includes(a.status));
  const svc = S.data.services || [];
  el.innerHTML = String(html`
    <div class="page-head"><div><h1>Done-for-you services</h1>
      <p class="muted">Skip the queues. We renew permits, register businesses and keep your papers current, and you can follow every step here.</p></div></div>
    <section class="card promises">${PROMISES.map(([t, d]) => html`<div class="promise">${ICON.check}<div><b>${t}</b><span>${d}</span></div></div>`)}</section>

    ${when(requests.length, html`<section class="card">
      <div class="card-head"><div><h2>Your requests</h2><p class="card-sub">${plural(open.length, 'open request')}</p></div></div>
      ${[...open, ...done.slice(0, 5)].map(orderLine)}
      ${when(done.length > 5, html`<div class="sheet-foot">${done.length - 5} older requests are kept in History.</div>`)}
    </section>`)}

    ${CATEGORIES.map(([cat, title, sub]) => {
      const list = svc.filter((s) => s.category === cat);
      return list.length ? html`<h3 class="section-label">${title}</h3><p class="muted small section-sub">${sub}</p>
        <div class="svc-grid">${list.map(serviceCard)}</div>` : '';
    })}
    <p class="muted small fineprint">Prices are starting points: your quote depends on your city, the permit and how urgent it is. Government fees are passed on at cost.
      PermitPal is a liaison service working with your written authorization; we never pay anyone to speed things up.</p>`);
  const pre = params?.get('req');
  if (pre && canEdit()) { history.replaceState(null, '', '#/services'); const r = reqById(pre); if (r) openRequest(serviceFor(r)?.code, { requirementId: r.id }); }
  const pick = params?.get('service');
  if (pick && canEdit()) { history.replaceState(null, '', '#/services'); openRequest(pick, {}); }
}

function serviceCard(s) {
  return html`<section class="card svc">
    <div class="svc-top"><h2>${s.name}</h2><div class="svc-price"><b>${price(s)}</b><small>${s.price_unit}</small></div></div>
    <p class="svc-sum">${s.summary}</p>
    <ul class="svc-inc">${s.includes.map((i) => html`<li>${ICON.check}<span>${i}</span></li>`)}</ul>
    <div class="svc-foot"><span class="muted small">${s.turnaround ? 'Usually ' + s.turnaround : ''}</span>
      ${canEdit() ? html`<button class="btn btn-primary btn-sm" data-act="svc-request" data-code="${s.code}">Request</button>` : ''}</div>
  </section>`;
}

function orderLine(a) {
  const [label, cls] = ORDER_STATUS[a.status] || [a.status, 'needinfo'];
  const action = a.status === 'quoted' ? 'Review quote' : a.payment_status === 'awaiting_payment' ? 'Pay now' : 'Open';
  return html`<a class="line" href="#/services/orders/${a.id}"><span class="line-main"><b>${a.requirement_name}</b>
    <small>${a.subject_label} · sent ${timeAgo(a.created_at)}${a.quote_php != null ? ' · ' + peso(a.quote_php) : ''}</small></span>
    <span class="chip ${cls}">${label}</span><span class="btn btn-sm ${['Review quote', 'Pay now'].includes(action) ? 'btn-primary' : 'btn-soft'}">${action}</span></a>`;
}

// ---------------------------------------------------------------- asking for a service
function targets(s) {
  // What the order is for: a tracked permit (renewals) or a business / vehicle / person.
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

export function openRequest(code, { requirementId } = {}) {
  const s = service(code);
  if (!s) return toast('That service is not available right now.', 'error');
  const t = targets(s);
  const optional = s.applies_to === 'any' && s.category !== 'renewal';
  if (t.kind === 'requirement' && !t.list.length) {
    return toast(s.type_codes.length ? 'You have no permit of this kind to renew yet, or it already has an open request.' : 'Add a business or vehicle first.', 'error');
  }
  const pick = t.kind === 'requirement'
    ? html`<label class="field"><span>Which permit?</span><select name="target" required>
        ${t.list.map((r) => html`<option value="${r.id}" ${r.id === requirementId ? 'selected' : ''}>${r.name} — ${subjectLabel(r)} (${dueShort(r)})</option>`)}</select></label>`
    : t.list.length || optional
      ? html`<label class="field"><span>For</span><select name="target">${optional ? html`<option value="">A new business (not in PermitPal yet)</option>` : ''}
          ${t.list.map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select></label>`
      : html`<p class="form-error">Add a ${s.applies_to} first, then request this service.</p>`;
  openModal(s.name, html`
    <div class="quote-hint"><b>${price(s)}</b> <span class="muted">${s.price_unit}</span>${s.turnaround ? html`<span class="muted"> · usually ${s.turnaround}</span>` : ''}</div>
    <p class="muted small">You'll get an exact quote first. Nothing starts until you accept it.</p>
    ${pick}
    ${when(s.category === 'renewal', html`<label class="field"><span>Do you have the documents?</span><select name="docs_status">
      <option value="have">Yes, they're uploaded in PermitPal</option><option value="need">No, I still need them</option><option value="not_sure" selected>Not sure what's needed</option></select></label>`)}
    <label class="check"><input type="checkbox" name="rush"> Rush: it's urgent <small class="muted">(may cost more; we'll confirm in the quote)</small></label>
    <div class="grid2">
      <label class="field"><span>Best way to reach you</span><select name="contact_method">
        <option value="email">Email</option><option value="phone">Phone call / SMS</option><option value="whatsapp">WhatsApp</option><option value="viber">Viber</option></select></label>
      <label class="field"><span>Email or mobile</span><input name="contact_value" value="${S.profile.email || ''}" maxlength="120"></label>
    </div>
    <label class="field"><span>Anything we should know? <small>(optional)</small></span>
      <textarea name="notes" rows="3" maxlength="2000" placeholder="e.g. Please finish before Jan 20. The barangay clearance is already done."></textarea></label>`, {
    submitLabel: 'Ask for a quote',
    onOpen: (form) => {
      const m = form.querySelector('[name=contact_method]');
      const v = form.querySelector('[name=contact_value]');
      m.addEventListener('change', () => { v.value = m.value === 'email' ? S.profile.email || '' : S.profile.phone || ''; v.placeholder = m.value === 'email' ? 'you@company.ph' : '0917 123 4567'; });
    },
    onSubmit: async (fd) => {
      const f = formObject(fd);
      let contact = f.contact_value;
      if (f.contact_method === 'email') { if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact)) throw new Error('Please enter a valid email address.'); }
      else { contact = normalizePhone(contact); if (!contact) throw new Error('Please enter a valid mobile number, e.g. 0917 123 4567.'); }
      const row = { org_id: S.org.id, service_code: s.code, notes: f.notes, rush: !!f.rush, contact_method: f.contact_method, contact_value: contact, docs_status: f.docs_status };
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
on('svc-request', (ds) => openRequest(ds.code));
on('svc-for-req', (ds) => { const r = reqById(ds.id); if (r) openRequest(serviceFor(r)?.code, { requirementId: r.id }); });

// ---------------------------------------------------------------- one order
let events = null;
export async function order(el, id) {
  let a = S.data.requests.find((x) => x.id === id);
  // The app may have been open for a while: show the order as it is now.
  try {
    const fresh = await db.getRequest(id);
    if (fresh) { if (a) Object.assign(a, fresh); else S.data.requests.unshift(a = fresh); }
  } catch { /* fall back to what we have */ }
  if (!location.hash.includes(id)) return;
  if (!a) { el.innerHTML = String(empty('Request not found', 'It may belong to another workspace.', html`<a class="btn btn-primary" href="#/services">Back to services</a>`)); return; }
  el.innerHTML = String(html`<div class="loading">Loading…</div>`);
  let ev = [], st = {};
  try { [ev, st] = await Promise.all([db.orderEvents(id), settings()]); } catch (e) { toastError(e); }
  if (!location.hash.includes(id)) return;
  events = ev;
  const [label, cls] = ORDER_STATUS[a.status] || [a.status, 'needinfo'];
  const s = service(a.service_code);
  const closed = ['completed', 'cancelled'].includes(a.status);
  const stage = a.status === 'cancelled' ? -1 : a.status === 'completed' ? 4
    : ['paid', 'waived'].includes(a.payment_status) ? 3 : a.accepted_at ? 2 : a.quoted_at ? 1 : 0;
  const steps = ['Request sent', 'Quote', 'Payment', 'In progress', 'Done'];
  const r = a.requirement_id ? reqById(a.requirement_id) : null;

  el.innerHTML = String(html`
    <a class="back" href="#/services">← Services</a>
    <div class="page-head"><div><h1>${a.requirement_name}</h1><p class="muted">${a.subject_label}${a.location_label ? ' · ' + a.location_label : ''}${a.rush ? ' · Rush' : ''}</p></div>
      <div class="head-side"><span class="chip lg ${cls}">${label}</span></div></div>
    ${when(stage >= 0, html`<ol class="stepper">${steps.map((t, i) => html`<li class="${i < stage ? 'done' : i === stage ? 'now' : ''}"><span>${i < stage ? '✓' : i + 1}</span>${t}</li>`)}</ol>`)}

    ${when(a.status === 'submitted', html`<div class="banner info"><div><b>We're preparing your exact quote.</b> You'll get it within 1 business day, by ${a.contact_method === 'email' ? 'email' : a.contact_method} and here.</div></div>`)}
    ${when(a.status === 'quoted', quoteBox(a))}
    ${when(['awaiting_payment', 'pending_verification'].includes(a.payment_status) && !closed, payBox(a, st))}
    ${when(a.status === 'completed', html`<div class="banner ok-banner"><div><b>Done.</b> ${r ? html`The new record is saved to <a href="#/requirement/${r.id}">${r.name}</a>.` : 'Your documents are attached below.'}</div></div>`)}
    ${when(a.admin_note && !closed && a.status !== 'quoted', html`<div class="banner warn"><div><b>From PermitPal:</b> ${a.admin_note}</div></div>`)}

    <section class="card">
      <div class="card-head"><div><h2>Summary</h2></div>
        ${when(r && !closed, html`<button class="btn btn-sm btn-ghost" data-act="auth-letter" data-id="${a.id}">${ICON.file} Authorization letter</button>`)}</div>
      <dl class="kv">
        <dt>Service</dt><dd>${s?.name || a.requirement_name}</dd>
        <dt>For</dt><dd>${a.subject_label}</dd>
        ${when(a.due_on, html`<dt>Permit deadline</dt><dd>${fmtDate(a.due_on)}</dd>`)}
        <dt>Quote</dt><dd>${a.quote_php != null ? html`${peso(a.quote_php)} <span class="muted small">(service ${peso(a.quote_service_fee)} + government fees ${peso(a.quote_gov_fees)})</span>` : 'Being prepared'}</dd>
        <dt>Payment</dt><dd>${PAYMENT_STATUS[a.payment_status] || a.payment_status}${a.paid_at ? ' · ' + fmtDate(a.paid_at.slice(0, 10)) : ''}</dd>
        ${when(a.gov_fees_actual != null, html`<dt>Government fees paid</dt><dd>${peso(a.gov_fees_actual)}</dd>`)}
        <dt>Sent</dt><dd>${fmtDateTime(a.created_at)}</dd>
      </dl>
    </section>

    <section class="card">
      <div class="card-head"><h2>Timeline</h2><span class="muted small">${plural(events.length, 'update')}</span></div>
      <ol class="timeline">${events.map((e) => html`<li class="${e.by_staff ? 'staff' : ''}">
        <div class="tl-dot"></div><div class="tl-body"><div class="tl-head"><b>${e.by_staff ? 'PermitPal' : 'You'}</b><span class="muted small">${fmtDateTime(e.created_at)}</span></div>
        ${when(e.message, html`<div class="pre">${e.message}</div>`)}
        ${when(e.file_path, html`<button class="linklike doc-file" data-act="doc-view" data-path="${e.file_path}" data-name="${e.file_name || 'file'}" data-type="">${ICON.file}${e.file_name || 'Attached file'}</button>`)}
        </div></li>`)}</ol>
      ${when(!closed && canEdit(), html`<form class="msg-form" data-id="${a.id}">
        <label class="field"><span>Message PermitPal</span><textarea name="message" rows="2" maxlength="2000" placeholder="Ask a question or send an update"></textarea></label>
        <div class="btn-row"><input type="file" name="file" accept=".pdf,image/*"><button class="btn btn-soft btn-sm">Send</button></div></form>`)}
    </section>

    ${when(!closed && canEdit() && !['paid', 'waived'].includes(a.payment_status), html`<div class="danger-zone"><button class="btn btn-ghost danger" data-act="order-cancel" data-id="${a.id}">Cancel this request</button>
      <span class="muted small">Nothing has been charged.</span></div>`)}`);

  el.querySelector('.msg-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try { await db.addOrderMessage(a, fd.get('message').trim(), fd.get('file')); toast('Sent.'); order(el, id); } catch (err) { btn.disabled = false; toastError(err); }
  });
  el.querySelector('.pay-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await db.submitPayment(a, { method: fd.get('method'), ref: fd.get('ref').trim(), file: fd.get('file') });
      await reload(); toast("Thanks! We'll confirm your payment within 1 business day.");
    } catch (err) { btn.disabled = false; toastError(err); }
  });
}

function quoteBox(a) {
  return html`<section class="card quote">
    <div class="card-head"><div><h2>Your quote</h2><p class="card-sub">Sent ${a.quoted_at ? timeAgo(a.quoted_at) : ''}</p></div></div>
    <div class="qline"><span>Service fee</span><b>${peso(a.quote_service_fee)}</b></div>
    <div class="qline"><span>Government fees <small class="muted">(estimate, paid at cost with official receipts)</small></span><b>${peso(a.quote_gov_fees)}</b></div>
    <div class="qline total"><span>Total</span><b>${peso(a.quote_php)}</b></div>
    ${when(a.quote_note, html`<p class="quote-note pre">${a.quote_note}</p>`)}
    ${when(canEdit(), html`<div class="btn-row qbtns"><button class="btn btn-primary" data-act="quote-accept" data-id="${a.id}">Accept quote</button>
      <button class="btn btn-ghost" data-act="order-cancel" data-id="${a.id}">No thanks</button></div>`)}
    <div class="sheet-foot">If the government fees end up lower, we refund the difference. If they are higher, we ask you before paying.</div>
  </section>`;
}

function payBox(a, st) {
  if (a.payment_status === 'pending_verification') {
    return html`<div class="banner info"><div><b>We're checking your payment</b> of ${peso(a.quote_php)}${a.payment_ref ? ' (ref ' + a.payment_ref + ')' : ''}. Work starts as soon as it's confirmed.</div></div>`;
  }
  const gcash = st.gcash_number ? html`<div class="paywith"><b>GCash</b><span>${st.gcash_number}${st.gcash_name ? ' · ' + st.gcash_name : ''}</span></div>` : '';
  const bank = st.bank_account_number ? html`<div class="paywith"><b>${st.bank_name || 'Bank transfer'}</b><span>${st.bank_account_number}${st.bank_account_name ? ' · ' + st.bank_account_name : ''}</span></div>` : '';
  return html`<section class="card pay">
    <div class="card-head"><div><h2>Pay ${peso(a.quote_php)}</h2><p class="card-sub">Work starts once payment is confirmed.</p></div></div>
    ${when(st.online_payments === 'on' && canEdit(), html`<button class="btn btn-primary btn-block" data-act="order-pay-online" data-id="${a.id}">Pay online (GCash, Maya, card)</button><div class="divider">or pay directly</div>`)}
    ${gcash || bank ? html`<div class="paywiths">${gcash}${bank}</div>` : html`<p class="muted">Payment details will be sent to you by PermitPal. Then enter the reference below.</p>`}
    ${when(st.payment_note, html`<p class="muted small">${st.payment_note}</p>`)}
    ${when(canEdit(), html`<form class="pay-form">
      <div class="grid2">
        <label class="field"><span>Paid with</span><select name="method"><option value="gcash">GCash</option><option value="maya">Maya</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option></select></label>
        <label class="field"><span>Reference number</span><input name="ref" maxlength="120" placeholder="e.g. 1009 234 567890"></label>
      </div>
      <label class="field"><span>Screenshot of the payment <small>(optional)</small></span><input type="file" name="file" accept="image/*,.pdf"></label>
      <button type="submit" class="btn btn-primary">I've paid</button></form>`)}
  </section>`;
}

on('quote-accept', async (ds) => {
  const a = S.data.requests.find((x) => x.id === ds.id);
  if (!(await confirmDialog('Accept this quote?', `Total ${peso(a.quote_php)}. Next you'll pay, then we start.`, { confirmLabel: 'Accept quote', danger: false }))) return;
  try { await db.acceptQuote(ds.id); await reload(); toast('Quote accepted.'); } catch (e) { toastError(e); }
});
on('order-cancel', async (ds) => {
  if (!(await confirmDialog('Cancel this request?', 'We will stop working on it. Nothing has been charged.', { confirmLabel: 'Cancel request' }))) return;
  try { await db.cancelHelpRequest(ds.id); await reload(); toast('Request cancelled.'); } catch (e) { toastError(e); }
});
on('order-pay-online', async (ds, btn) => {
  btn.disabled = true;
  try { location.href = await db.startOrderCheckout(ds.id); } catch (e) { btn.disabled = false; toastError(e); }
});

// A ready-to-sign authorization letter, so the customer can let PermitPal act for them at the agency.
on('auth-letter', (ds) => {
  const a = S.data.requests.find((x) => x.id === ds.id);
  const b = a.business_id ? business(a.business_id) : null;
  const v = a.vehicle_id ? vehicle(a.vehicle_id) : null;
  const p = a.person_id ? person(a.person_id) : null;
  const who = b ? b.name : v ? `${v.make_model}${v.plate_no ? ', plate no. ' + v.plate_no : ''}` : p ? p.full_name : a.subject_label;
  const me = [S.profile.first_name, S.profile.last_name].filter(Boolean).join(' ');
  const today = new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
  const letter = String(html`<!doctype html><html><head><meta charset="utf-8"><title>Authorization letter</title>
    <style>body{font-family:Georgia,serif;max-width:680px;margin:48px auto;padding:0 24px;line-height:1.7;color:#111}h1{font-size:20px;text-align:center;letter-spacing:.1em}
    .sig{margin-top:56px;display:flex;justify-content:space-between;gap:24px}.sig div{flex:1;border-top:1px solid #111;padding-top:6px;font-size:14px}
    .hint{font-family:system-ui,sans-serif;font-size:12px;color:#555;border:1px dashed #aaa;padding:8px 12px;margin-bottom:24px}@media print{.hint{display:none}}</style></head><body>
    <p class="hint">Fill in the blanks, sign, and upload a photo of it in your PermitPal request. Attach a copy of your valid ID and the representative's ID when filing.</p>
    <p>${today}</p>
    <h1>AUTHORIZATION LETTER</h1>
    <p>To whom it may concern:</p>
    <p>I, <b>${me || '____________________'}</b>, ${b ? html`owner / authorized officer of <b>${b.name}</b>` : html`owner of <b>${who}</b>`}, hereby authorize
      <b>______________________________</b> of PermitPal to process, follow up, pay the required fees for, and receive on my behalf the
      <b>${a.requirement_name}</b> for <b>${who}</b>.</p>
    <p>This authorization is valid only for the transaction stated above.</p>
    <div class="sig"><div>Signature over printed name<br>${me}</div><div>Authorized representative<br>Signature over printed name</div></div>
    <script>setTimeout(() => window.print(), 300);</script></body></html>`);
  const w = window.open('', '_blank');
  if (!w) return toast('Allow pop-ups to open the letter.', 'error');
  w.document.write(letter); w.document.close();
});

// Requirement page helper: "Have PermitPal renew it" block.
export function serviceOffer(r) {
  const s = serviceFor(r);
  if (!s || !canEdit() || r.status === 'compliant' && !r.expires) return '';
  if (r.open_request_id) {
    return html`<section class="card offer"><div class="offer-body">${ICON.briefcase}<div><b>PermitPal is handling this</b>
      <span class="muted">Follow the progress in your request.</span></div></div><a class="btn btn-soft btn-sm" href="#/services/orders/${r.open_request_id}">Open request</a></section>`;
  }
  return html`<section class="card offer"><div class="offer-body">${ICON.briefcase}<div><b>Have PermitPal ${s.category === 'renewal' && s.code !== 'renew_other' ? 'renew it' : 'handle it'} for you</b>
    <span class="muted">${price(s)} · ${s.price_unit}${s.turnaround ? ' · usually ' + s.turnaround : ''}. Exact quote first.</span></div></div>
    <button class="btn btn-primary btn-sm" data-act="svc-for-req" data-id="${r.id}">Get a quote</button></section>`;
}
export { STATUS };
