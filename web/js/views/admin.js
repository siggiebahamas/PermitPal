// PermitPal staff console: incoming help requests, workspaces & plans, message delivery.
// Only accounts with profiles.is_platform_admin can load any of this (enforced in the database).
import { html, fmtDate, fmtDateTime, timeAgo, toast, toastError, when } from '../util.js';
import { S, on, rerender, empty } from '../core.js';
import { HELP_STATUS } from './help.js';
import * as db from 'pp/data';

let tab = 'requests';

export async function admin(el) {
  if (!S.profile?.is_platform_admin) { el.innerHTML = String(empty('Staff only', 'This page is for the PermitPal team.')); return; }
  el.innerHTML = String(html`<div class="loading">Loading…</div>`);
  const tabBtn = (k, l) => html`<button class="tab ${tab === k ? 'active' : ''}" data-act="admin-tab" data-tab="${k}">${l}</button>`;
  let body = '';
  try {
    if (tab === 'requests') body = requestsTab(await db.adminRequests());
    else if (tab === 'orgs') body = orgsTab(await db.adminOrgs());
    else body = outboxTab(await db.adminOutbox());
  } catch (e) { toastError(e); }
  el.innerHTML = String(html`
    <div class="page-head"><div><h1>PermitPal admin</h1><p class="muted">Staff tools. Customers never see this page.</p></div></div>
    <div class="tabs">${tabBtn('requests', 'Help requests')}${tabBtn('orgs', 'Workspaces & plans')}${tabBtn('outbox', 'Messages')}</div>
    ${body}`);
  wire(el);
}
on('admin-tab', (ds) => { tab = ds.tab; rerender(); });

function requestsTab(list) {
  const open = list.filter((a) => !['completed', 'cancelled'].includes(a.status));
  const closed = list.filter((a) => ['completed', 'cancelled'].includes(a.status));
  const card = (a) => html`<section class="card admin-req">
    <div class="card-head"><h2>${a.requirement_name} — ${a.subject_label}</h2><span class="chip ${HELP_STATUS[a.status]?.[1]}">${HELP_STATUS[a.status]?.[0]}</span></div>
    <dl class="kv">
      <dt>Workspace</dt><dd>${a.orgs?.name || '—'}</dd>
      <dt>Location</dt><dd>${a.location_label || '—'}</dd>
      <dt>Deadline</dt><dd>${a.due_on ? fmtDate(a.due_on) : '—'}</dd>
      <dt>Documents</dt><dd>${{ have: 'Uploaded in PermitPal', need: 'Customer needs to get them', not_sure: 'Not sure' }[a.docs_status]}</dd>
      <dt>Contact</dt><dd>${a.contact_method}${a.contact_value ? ': ' + a.contact_value : ''}</dd>
      <dt>Notes</dt><dd class="pre">${a.notes || '—'}</dd>
      <dt>Received</dt><dd>${fmtDateTime(a.created_at)} (${timeAgo(a.created_at)})</dd>
    </dl>
    ${when(!['completed', 'cancelled'].includes(a.status) && a.requirement_id, html`<button class="btn btn-sm btn-ghost" data-act="admin-docs" data-id="${a.requirement_id}">Show customer's files</button><div class="admin-docs" data-for="${a.requirement_id}"></div>`)}
    <form class="admin-form" data-id="${a.id}">
      <div class="grid2">
        <label class="field"><span>Status</span><select name="status">${Object.entries(HELP_STATUS).map(([k, v]) => html`<option value="${k}" ${k === a.status ? 'selected' : ''}>${v[0]}</option>`)}</select></label>
        <label class="field"><span>Provider / agent</span><input name="provider_name" value="${a.provider_name || ''}" maxlength="160"></label>
        <label class="field"><span>Quote (PHP)</span><input name="quote_php" type="number" min="0" step="0.01" value="${a.quote_php ?? ''}"></label>
      </div>
      <label class="field"><span>Message to the customer</span><textarea name="admin_note" rows="2" maxlength="2000">${a.admin_note || ''}</textarea></label>
      <button class="btn btn-primary btn-sm">Save & notify customer</button>
    </form>
  </section>`;
  return html`${open.length ? open.map(card) : empty('No open requests', 'New requests also arrive by email.')}
    ${when(closed.length, html`<details><summary>${closed.length} closed</summary>${closed.map(card)}</details>`)}`;
}

function orgsTab(list) {
  return html`<section class="card"><p class="muted small">Give pilot customers a plan here (leave "until" blank for no end date).</p>
    <div class="table-wrap"><table class="table"><thead><tr><th>Workspace</th><th>Owner</th><th>Size</th><th>Created</th><th>Plan</th></tr></thead><tbody>
    ${list.map((o) => html`<tr class="${o.deleted_at ? 'muted' : ''}"><td>${o.name}${o.deleted_at ? ' (deleting)' : ''}${o.open_requests ? html` <span class="tag red">${o.open_requests} open</span>` : ''}</td>
      <td>${o.owner_email || '—'}</td><td>${o.businesses} biz · ${o.vehicles} veh · ${o.members} ppl</td><td>${fmtDate(o.created_at.slice(0, 10))}</td>
      <td><form class="inline-form plan-form" data-id="${o.id}"><select name="plan">${S.plans.map((p) => html`<option value="${p.id}" ${p.id === o.plan_id ? 'selected' : ''}>${p.name}</option>`)}</select>
        <input type="date" name="until" value="${o.plan_expires_at ? o.plan_expires_at.slice(0, 10) : ''}" title="Until"><button class="btn btn-sm btn-soft">Set</button></form></td></tr>`)}
    </tbody></table></div></section>`;
}

function outboxTab(list) {
  return html`<section class="card"><p class="muted small">Latest 100 messages. "Skipped" means that channel isn't connected yet.</p>
    <div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Channel</th><th>To</th><th>Subject</th><th>Status</th><th>Error</th></tr></thead><tbody>
    ${list.map((m) => html`<tr><td>${fmtDateTime(m.created_at)}</td><td>${m.channel}</td><td>${m.to_address}</td><td>${m.subject || ''}</td>
      <td><span class="tag ${m.status === 'sent' ? 'green' : m.status === 'failed' ? 'red' : ''}">${m.status}${m.attempts > 1 ? ` ×${m.attempts}` : ''}</span></td><td class="small">${m.last_error || ''}</td></tr>`)}
    </tbody></table></div></section>`;
}

function wire(el) {
  el.querySelectorAll('.admin-form').forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const q = fd.get('quote_php');
    try {
      await db.adminUpdateRequest(f.dataset.id, {
        status: fd.get('status'), provider_name: fd.get('provider_name').trim() || null,
        quote_php: q === '' ? null : Number(q), admin_note: fd.get('admin_note').trim() || null,
      });
      toast('Saved. The customer was notified.');
      rerender();
    } catch (err) { toastError(err); }
  }));
  el.querySelectorAll('.plan-form').forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const until = fd.get('until');
    try { await db.adminSetPlan(f.dataset.id, fd.get('plan'), until ? new Date(until + 'T23:59:59+08:00').toISOString() : null); toast('Plan updated.'); } catch (err) { toastError(err); }
  }));
}

on('admin-docs', async (ds) => {
  const box = document.querySelector(`.admin-docs[data-for="${ds.id}"]`);
  try {
    const docs = await db.adminRequestDocs(ds.id);
    box.innerHTML = String(docs.length ? html`<div class="files">${docs.map((d) => html`<div class="file"><div class="file-main">${d.file_name}</div>
      <button class="btn btn-sm btn-soft" data-act="doc-download" data-path="${d.storage_path}" data-name="${d.file_name}">Download</button></div>`)}</div>`
      : html`<p class="muted small">No files uploaded for this requirement.</p>`);
  } catch (e) { toastError(e); }
});

