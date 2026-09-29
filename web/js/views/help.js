// "Get help": a customer asks PermitPal to handle a renewal. The request carries over
// everything PermitPal already knows and is routed to PermitPal staff (email + admin console).
import { html, fmtDate, peso, toast, toastError, confirmDialog, when, normalizePhone, timeAgo } from '../util.js';
import { S, on, go, reload, canEdit, reqById, empty } from '../core.js';
import { byPriority, subjectLabel, dueText, statusChip } from '../components.js';
import * as db from 'pp/data';

const HELP_STATUS = {
  submitted: ['Submitted', 'needinfo', "We've got it and will review it shortly."],
  matching: ['Finding a provider', 'progress', "We're lining up someone to handle this."],
  provider_contacted: ['Provider contacted', 'progress', 'A provider has your details.'],
  awaiting_customer: ['Waiting for you', 'soon', 'We need something from you — check the note below.'],
  in_progress: ['In progress', 'progress', 'Your renewal is being worked on.'],
  completed: ['Completed', 'ok', 'Done. Record the new permit if you haven\'t yet.'],
  cancelled: ['Cancelled', 'overdue', 'This request was cancelled.'],
};
export { HELP_STATUS };

let wiz = null; // { step, reqId, docs, method, value, notes }

export function help(el, reqId) {
  if (reqId && (!wiz || wiz.reqId !== reqId)) {
    const r = reqById(reqId);
    wiz = { step: r ? 2 : 1, reqId: r ? reqId : null, docs: r?.document_count ? 'have' : 'not_sure', method: 'email', value: '', notes: '' };
  }
  if (!wiz) wiz = { step: 1, reqId: null, docs: 'not_sure', method: 'email', value: '', notes: '' };
  const requests = S.data.requests;

  el.innerHTML = String(html`
    <div class="page-head"><div><h1>Get help</h1><p class="muted">Don't want to queue at the city hall or LTO? Ask PermitPal to handle a renewal for you.</p></div></div>
    ${canEdit() ? html`<section class="card wizard">${step()}</section>` : html`<p class="muted">Viewers can't send help requests. Ask an owner or admin.</p>`}
    <section class="card">
      <h2>Your requests</h2>
      ${requests.length ? requests.map(requestCard) : html`<p class="muted">No requests yet.</p>`}
    </section>
    <p class="muted small">PermitPal may earn a fee or commission from partner agencies for renewals we arrange. You'll always see the quote before anything is done.</p>`);
}

function step() {
  const r = wiz.reqId ? reqById(wiz.reqId) : null;
  const dots = html`<div class="dots">${[1, 2, 3].map((n) => html`<span class="${n <= wiz.step ? 'on' : ''}"></span>`)}</div>`;

  if (wiz.step === 1 || !r) {
    const pool = S.data.reqs.filter((x) => x.status !== 'compliant' && !x.open_request_id).sort(byPriority);
    const rest = S.data.reqs.filter((x) => x.status === 'compliant' && !x.open_request_id);
    return html`${dots}<h3>What do you need help with?</h3>
      ${pool.length || rest.length ? html`<div class="pick">${[...pool, ...rest].slice(0, 40).map((x) => html`
        <button class="pick-item" data-act="help-pick" data-id="${x.id}"><div><b>${x.name}</b><div class="muted small">${subjectLabel(x)} · ${dueText(x)}</div></div>${statusChip(x.status)}</button>`)}</div>`
        : empty('Nothing to pick yet', 'Add a business or vehicle first.')}`;
  }

  if (wiz.step === 2) {
    return html`${dots}<h3>Here's what we'll send</h3>
      <dl class="kv">
        <dt>${r.subject === 'vehicle' ? 'Vehicle' : 'Business'}</dt><dd>${subjectLabel(r)}</dd>
        <dt>Requirement</dt><dd>${r.name}</dd>
        ${when(r.location_city, html`<dt>Location</dt><dd>${r.location_city}</dd>`)}
        <dt>Deadline</dt><dd>${dueText(r)}</dd>
        <dt>Current reference no.</dt><dd>${r.reference_no || '—'}</dd>
      </dl>
      <h4>Do you already have the documents?</h4>
      <div class="options">${[['have', 'Yes, they are uploaded in PermitPal'], ['need', 'No, I still need to get them'], ['not_sure', "I'm not sure what's needed"]].map(([v, l]) =>
        html`<label class="option ${wiz.docs === v ? 'on' : ''}"><input type="radio" name="docs" value="${v}" ${wiz.docs === v ? 'checked' : ''} data-wiz="docs"> ${l}</label>`)}</div>
      ${when(wiz.docs === 'have', html`<p class="muted small">While your request is open, PermitPal staff can view this requirement's files so they can process it. Access ends when the request is closed.</p>`)}
      <div class="btn-row between"><button class="btn btn-ghost" data-act="help-back">Back</button><button class="btn btn-primary" data-act="help-next">Continue</button></div>`;
  }

  const methods = [['email', 'Email'], ['phone', 'Phone call / SMS'], ['whatsapp', 'WhatsApp'], ['viber', 'Viber']];
  return html`${dots}<h3>How should we reach you?</h3>
    <div class="options row">${methods.map(([v, l]) => html`<label class="option ${wiz.method === v ? 'on' : ''}"><input type="radio" name="method" value="${v}" ${wiz.method === v ? 'checked' : ''} data-wiz="method"> ${l}</label>`)}</div>
    <label class="field"><span>${wiz.method === 'email' ? 'Email' : 'Mobile number'}</span>
      <input data-wiz="value" value="${wiz.value || (wiz.method === 'email' ? S.profile.email : S.profile.phone || '')}" placeholder="${wiz.method === 'email' ? 'you@company.ph' : '0917 123 4567'}"></label>
    <label class="field"><span>Anything we should know? <small>(optional)</small></span>
      <textarea data-wiz="notes" rows="3" maxlength="2000" placeholder="e.g. Please prioritize — we need the permit for a bank loan.">${wiz.notes}</textarea></label>
    <div class="btn-row between"><button class="btn btn-ghost" data-act="help-back">Back</button><button class="btn btn-primary" data-act="help-submit">Send request</button></div>`;
}

function requestCard(a) {
  const [label, cls, note] = HELP_STATUS[a.status] || [a.status, 'needinfo', ''];
  const open = !['completed', 'cancelled'].includes(a.status);
  return html`<div class="request ${cls}">
    <div class="row-main">
      <div class="row-title">${a.requirement_name} — ${a.subject_label}</div>
      <div class="row-sub"><span class="chip ${cls}">${label}</span> ${note} · sent ${timeAgo(a.created_at)}</div>
      ${when(a.quote_php !== null && a.quote_php !== undefined, html`<div>Quote: <b>${peso(a.quote_php)}</b>${a.provider_name ? ' · ' + a.provider_name : ''}</div>`)}
      ${when(a.admin_note, html`<div class="note">${a.admin_note}</div>`)}
      ${when(a.due_on, html`<div class="muted small">Deadline ${fmtDate(a.due_on)}</div>`)}
    </div>
    ${when(open && canEdit(), html`<button class="btn btn-sm btn-ghost" data-act="help-cancel" data-id="${a.id}">Cancel</button>`)}
  </div>`;
}

// Keep typed values when re-rendering the wizard.
document.addEventListener('input', (e) => {
  const k = e.target?.dataset?.wiz;
  if (!k || !wiz) return;
  wiz[k] = e.target.value;
  if (e.target.type === 'radio') { if (k === 'method') wiz.value = ''; go('#/help' + (wiz.reqId ? '/' + wiz.reqId : '')); }
});

on('help-pick', (ds) => { const r = reqById(ds.id); wiz = { step: 2, reqId: ds.id, docs: r?.document_count ? 'have' : 'not_sure', method: 'email', value: '', notes: '' }; go('#/help/' + ds.id); });
on('help-back', () => { wiz.step = Math.max(1, wiz.step - 1); if (wiz.step === 1) wiz.reqId = null; go(wiz.step === 1 ? '#/help' : '#/help/' + wiz.reqId); });
on('help-next', () => { wiz.step = 3; go('#/help/' + wiz.reqId); });
on('help-submit', async (ds, btn) => {
  let value = (wiz.value || (wiz.method === 'email' ? S.profile.email : S.profile.phone || '')).trim();
  if (wiz.method === 'email') {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return toast('Please enter a valid email address.', 'error');
  } else {
    const p = normalizePhone(value);
    if (!p) return toast('Please enter a valid mobile number, e.g. 0917 123 4567.', 'error');
    value = p;
  }
  btn.disabled = true;
  try {
    const r = reqById(wiz.reqId);
    await db.createHelpRequest({ org_id: r.org_id, requirement_id: r.id, docs_status: wiz.docs, contact_method: wiz.method, contact_value: value, notes: wiz.notes });
    wiz = null;
    await reload();
    go('#/help');
    toast("Request sent. We'll get back to you with next steps and a quote.");
  } catch (e) { btn.disabled = false; toastError(e); }
});
on('help-cancel', async (ds) => {
  if (!(await confirmDialog('Cancel this request?', 'We will stop working on it.', { confirmLabel: 'Cancel request' }))) return;
  try { await db.cancelHelpRequest(ds.id); await reload(); toast('Request cancelled.'); } catch (e) { toastError(e); }
});
