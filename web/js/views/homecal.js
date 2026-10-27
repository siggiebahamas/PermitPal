// The top of Home: a navy band with the greeting and what needs you, then a month calendar with "Up next" beside it. A day with a deadline opens that permit's renewal;
// an empty day lets you add a to-do of your own (like Google Calendar). Your deadlines and to-dos can also go into
// Google Calendar, through a private link that stays up to date.
import { html, openModal, confirmDialog, toast, toastError, fmtDate, plural, todayPH } from '../util.js';
import { S, on, go, has, canEdit, reload, rerender } from '../core.js';
import { STATUS, subjectLabel, shortName, ICON } from '../components.js';
import * as db from 'pp/data';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
let shown = null; // 'YYYY-MM' of the month on screen (this month until you move)
const ym = (iso) => iso.slice(0, 7);
const addMonths = (m, n) => { const d = new Date(`${m}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };
const longDay = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
const tasks = () => (has('lgus') ? S.data.tasks || [] : []);
// Each permit's next deadline: the expiry date of the ones that expire.
const dueOn = (day) => S.data.reqs.filter((r) => r.expires && r.expires_on === day);
const tasksOn = (day) => tasks().filter((t) => t.due_on === day);
const dotCls = (r) => STATUS[r.status]?.cls || 'needinfo';

function greeting() {
  const h = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', hour12: false })) % 24;
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function homeCal(first, c) {
  const today = todayPH();
  const month = shown || ym(today);
  const [y, m] = month.split('-').map(Number);
  const firstDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Monday first
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const iso = (d) => `${month}-${String(d).padStart(2, '0')}`;
  const todos = tasks().filter((t) => !t.done_at).sort((a, b) => a.due_on.localeCompare(b.due_on));
  const cell = (d) => {
    const day = iso(d);
    const rs = dueOn(day);
    const ts = tasksOn(day);
    const worst = rs.find((r) => r.status === 'action_required') || rs.find((r) => r.status !== 'compliant') || rs[0];
    const label = rs.length ? `${longDay(day)}: ${rs.map((r) => `${r.name} (${subjectLabel(r)})`).join(', ')}${ts.length ? `; ${plural(ts.length, 'to-do')}` : ''}`
      : ts.length ? `${longDay(day)}: ${ts.map((t) => t.title).join(', ')}` : `${longDay(day)}${canEdit() && has('lgus') ? ': add a to-do' : ''}`;
    return html`<button type="button" class="hc-day ${day === today ? 'is-today' : ''} ${day < today ? 'is-past' : ''} ${rs.length ? `has-due ${dotCls(worst)}` : ''} ${ts.length ? 'has-task' : ''}"
      data-act="cal-day" data-day="${day}" aria-label="${label}">
      <b>${d}</b>
      ${rs.slice(0, 2).map((r) => html`<span class="hc-chip ${dotCls(r)}">${shortName(r)}</span>`)}${rs.length > 2 ? html`<span class="hc-more">+${rs.length - 2}</span>` : ''}
      ${ts.length ? html`<span class="hc-todo">${ts.length > 1 ? plural(ts.length, 'to-do') : ts[0].title}</span>` : ''}
    </button>`;
  };
  const upNext = S.data.reqs.filter((r) => r.status !== 'compliant' && r.expires_on).sort((a, b) => a.expires_on.localeCompare(b.expires_on)).slice(0, 4);
  const when = (r) => (r.days_left < 0 ? `${plural(-r.days_left, 'day')} late` : r.days_left === 0 ? 'today' : `in ${plural(r.days_left, 'day')}`);
  // The summary under the greeting: one line per kind of urgency, each with a link to that list.
  const lines = [
    c.action_required && html`<p class="hs-line"><span class="hs-ic overdue">${ICON.bell}</span>${plural(c.action_required, 'permit')} ${c.action_required === 1 ? 'is' : 'are'} past due
      <a href="#/compliance?status=action_required">Review ›</a></p>`,
    c.renew_soon && html`<p class="hs-line"><span class="hs-ic soon">${ICON.calendar}</span>${c.renew_soon === 1 ? '1 permit renews' : `${c.renew_soon} renew`} in the next 30 days
      <a href="#/compliance?status=renew_soon">See dates ›</a></p>`,
  ].filter(Boolean);
  return html`<section class="home-cal" aria-labelledby="hc-hello">
    <div class="hs-band">
      <p class="hc-date">${longDay(today)}</p><h1 id="hc-hello">${greeting()}, ${first}</h1>
      <div class="hs-sum">${lines.length ? lines : html`<p class="hs-line"><span class="hs-ic ok">${ICON.check}</span>Everything is up to date</p>`}
        <p class="hs-line hc-note" data-filings-brief hidden></p></div>
    </div>
    <div class="card hc-body">
      <div class="hc-month">
        <div class="hc-nav">
          <b aria-live="polite">${MONTHS[m - 1]} ${y}</b>
          ${month !== ym(today) ? html`<button type="button" class="btn btn-ghost btn-sm" data-act="cal-month" data-n="0">Today</button>` : ''}
          <button type="button" class="hc-arrow" data-act="cal-month" data-n="-1" aria-label="Previous month">‹</button>
          <button type="button" class="hc-arrow" data-act="cal-month" data-n="1" aria-label="Next month">›</button>
        </div>
        <div class="hc-grid" role="group" aria-label="${MONTHS[m - 1]} ${y}">
          ${DOW.map((d) => html`<span class="hc-dow" aria-hidden="true">${d}</span>`)}
          ${Array.from({ length: firstDow }, () => html`<span class="hc-blank" aria-hidden="true"></span>`)}
          ${Array.from({ length: days }, (_, i) => cell(i + 1))}
        </div>
        <p class="hc-legend"><span><i class="overdue"></i>Late</span><span><i class="soon"></i>Renew soon</span><span><i class="ok"></i>All good</span>${has('lgus') ? html`<span><i class="task"></i>Your to-do</span>` : ''}
          <em>${canEdit() && has('lgus') ? 'Tap a deadline to open it, or an empty day to add a to-do.' : 'Tap a deadline to open it.'}</em></p>
      </div>
      <aside class="hc-side">
        <span class="hc-kick">Up next</span>
        ${upNext.length ? html`<div class="hc-upnext">${upNext.map((r) => html`<a class="hc-up" href="#/requirement/${r.id}?renew=1">
          <span class="hc-up-d">${fmtDate(r.expires_on).replace(/, \d{4}$/, '')}</span>
          <span class="hc-up-m"><b>${shortName(r)}</b><small>${subjectLabel(r)}</small></span>
          <em class="${dotCls(r)}">${when(r)}</em></a>`)}</div>`
          : html`<p class="hc-allgood">${ICON.check} Nothing to renew. You're all caught up.</p>`}
        ${has('lgus') && todos.length ? html`<div class="hc-todos"><b>Your to-dos</b>
          ${todos.slice(0, 3).map((t) => html`<label class="hc-todo-row"><input type="checkbox" data-task-done="${t.id}" ${canEdit() ? '' : 'disabled'}>
            <span>${t.title}<small class="${t.due_on < today ? 'late' : ''}">${t.due_on === today ? 'Today' : fmtDate(t.due_on)}</small></span></label>`)}
          ${todos.length > 3 ? html`<small class="muted">+${todos.length - 3} more on the calendar</small>` : ''}</div>` : ''}
        <div class="hc-btns">
          ${canEdit() && has('lgus') ? html`<button class="btn btn-gold" data-act="cal-day" data-day="${today}" data-new="1">+ New to-do</button>` : ''}
          <button class="btn btn-ghost" data-act="cal-sync">${ICON.calendar} Google Calendar</button>
        </div>
      </aside>
    </div>
  </section>`;
}

on('cal-month', (ds) => { const n = Number(ds.n); shown = n === 0 ? null : addMonths(shown || ym(todayPH()), n); rerender(); });

// A day: one deadline opens its renewal; several (or to-dos) list what's there; an empty day adds a to-do.
on('cal-day', (ds) => {
  const day = ds.day;
  const rs = dueOn(day);
  const ts = tasksOn(day);
  if (!ds.new && rs.length === 1 && !ts.length) { go(`#/requirement/${rs[0].id}?renew=1`); return; }
  if (!ds.new && (rs.length || ts.length)) { openDay(day, rs, ts); return; }
  if (canEdit() && has('lgus')) { openTask({ due_on: day }); return; }
  toast(`Nothing due on ${fmtDate(day)}.`);
});

function openDay(day, rs, ts) {
  openModal(longDay(day), html`
    ${rs.length ? html`<h3 class="section-label">Due this day</h3><div class="hc-daylist">${rs.map((r) => html`<a class="hc-dayrow" href="#/requirement/${r.id}?renew=1" >
      <span class="hc-chip ${dotCls(r)}">${STATUS[r.status]?.label || ''}</span><span><b>${r.name}</b><small>${subjectLabel(r)}</small></span><em>Open ›</em></a>`)}</div>` : ''}
    ${ts.length ? html`<h3 class="section-label">Your to-dos</h3><div class="hc-daylist">${ts.map((t) => html`<div class="hc-dayrow">
      <label class="hc-todo-row"><input type="checkbox" data-task-done="${t.id}" ${t.done_at ? 'checked' : ''} ${canEdit() ? '' : 'disabled'}><span><b>${t.title}</b>${t.note ? html`<small>${t.note}</small>` : ''}</span></label>
      <span class="btn-row">${googleLink(t)}${canEdit() ? html`<button type="button" class="btn btn-ghost btn-sm" data-task-edit="${t.id}">Edit</button>` : ''}</span></div>`)}</div>` : ''}`, {
    cancelLabel: 'Close',
    ...(canEdit() && has('lgus') ? { submitLabel: '+ Add a to-do', onSubmit: () => { setTimeout(() => openTask({ due_on: day }), 30); } } : {}),
    onOpen: (form) => {
      form.querySelectorAll('[data-task-edit]').forEach((b) => b.addEventListener('click', () => openTask(tasks().find((x) => x.id === b.dataset.taskEdit))));
    },
  });
}

// Add or change a to-do. The quick form: what, when, an optional note.
function openTask(t = {}) {
  openModal(t.id ? 'Change this to-do' : 'Add a to-do', html`
    <label class="field"><span>What do you want to remember?</span><input name="title" maxlength="160" required value="${t.title || ''}" placeholder="e.g. Pick up the cedula at the barangay"></label>
    <label class="field"><span>Date</span><input type="date" name="due_on" required value="${t.due_on || todayPH()}"></label>
    <label class="field"><span>Note <small>(optional)</small></span><textarea name="note" rows="3" maxlength="1000">${t.note || ''}</textarea></label>
    ${t.id ? html`<p><button type="button" class="btn btn-ghost btn-sm danger-text" data-task-delete="${t.id}">Delete this to-do</button></p>` : ''}`, {
    submitLabel: t.id ? 'Save' : 'Add to my calendar',
    onOpen: (form) => {
      form.querySelector('[name=title]').focus();
      form.querySelector('[data-task-delete]')?.addEventListener('click', async () => {
        if (!(await confirmDialog('Delete this to-do?', 'It comes off your calendar.', { confirmLabel: 'Delete' }))) return;
        try { await db.taskDelete(t.id); toast('Deleted.'); await reload(); } catch (e) { toastError(e); }
      });
    },
    onSubmit: async (fd) => {
      const title = String(fd.get('title') || '').trim();
      if (!title) throw new Error('What do you want to remember?');
      await db.taskSave(S.org.id, { id: t.id, title, due_on: fd.get('due_on'), note: String(fd.get('note') || '').trim() });
      shown = ym(String(fd.get('due_on')));
      toast(t.id ? 'Saved.' : `Added to ${fmtDate(String(fd.get('due_on')))}.`);
      await reload();
    },
  });
}

document.addEventListener('change', async (e) => {
  const box = e.target.closest?.('[data-task-done]');
  if (!box) return;
  try { await db.taskDone(box.dataset.taskDone, box.checked); toast(box.checked ? 'Done. Nice.' : 'Back on your list.'); await reload(); }
  catch (err) { box.checked = !box.checked; toastError(err); }
});

// One to-do into Google Calendar, by hand (no sign-in needed).
function googleLink(t) {
  const d = t.due_on.replace(/-/g, '');
  const n = new Date(`${t.due_on}T00:00:00Z`); n.setUTCDate(n.getUTCDate() + 1);
  const href = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(t.title)}&dates=${d}/${n.toISOString().slice(0, 10).replace(/-/g, '')}&details=${encodeURIComponent(t.note || 'From Pinoy Permit')}`;
  return html`<a class="btn btn-ghost btn-sm" href="${href}" target="_blank" rel="noopener">${ICON.calendar} Google<span class="sr-only"> Calendar (opens in a new tab)</span></a>`;
}

// Google Calendar: one button. It opens Google Calendar with "Add this calendar?" already asked; the private link keeps
// every deadline and to-do in sync from then on. iPhone and Outlook get the same link. Until the feed is switched on
// (the calendar-feed function is deployed), a one-time file instead.
const googleAdd = (url) => `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(url.replace(/^https:/, 'webcal:'))}`;
let feedLive = null; // checked once per visit
on('cal-sync', async (ds, btn) => {
  if (btn) btn.disabled = true;
  try {
    if (feedLive === null) feedLive = has('lgus') ? await db.calendarFeedLive().catch(() => false) : false;
    const live = feedLive && canEdit();
    let url = '';
    if (live) { try { url = db.calendarFeedUrl(await db.calendarFeedToken(S.org.id)); } catch (e) { toastError(e); return; } }
    openModal('Add your deadlines to your phone calendar', live ? html`
      <p class="hc-sync-lead">One tap. Every permit deadline${has('lgus') ? ' and to-do' : ''} shows up in your calendar, with reminders 30 and 7 days before, and it keeps itself up to date.</p>
      <div class="hc-sync-btns">
        <a class="btn btn-primary btn-lg hc-sync-main" href="${googleAdd(url)}" target="_blank" rel="noopener">${ICON.calendar} Add to Google Calendar<span class="sr-only"> (opens in a new tab)</span></a>
        <a class="btn btn-soft" href="${url.replace(/^https:/, 'webcal:')}">iPhone or Mac (Apple Calendar)</a>
      </div>
      <p class="muted small">Google asks "Add this calendar?": tap <b>Add</b>. That's it.</p>
      <details class="hc-sync-more"><summary>Outlook or another calendar</summary>
        <p class="small">Copy this private link and add it as a calendar "from the internet" or "from URL".</p>
        <div class="invite-row"><input class="hc-feed" id="hc-feed" readonly value="${url}" aria-label="Your private calendar link"><button type="button" class="btn btn-soft" data-feed-copy>Copy</button></div>
        <p class="muted small">Anyone with this link can see your dates, so keep it private. <button type="button" class="linklike" data-feed-new>Make a new link</button> (the old one stops working).</p>
      </details>`
      : html`<p>Download your deadlines as a calendar file, then open it to add them to Google Calendar, Apple Calendar or Outlook. Each one comes with reminders 30 and 7 days before.</p>
        <p class="muted small">In Google Calendar on a computer: Settings → Import &amp; export → Import, and pick the file.</p>
        <p><button type="button" class="btn btn-primary" data-act="calendar-export">${ICON.calendar} Download my deadlines</button></p>
        ${S.profile?.is_platform_admin ? html`<p class="muted small">Staff: the one-tap Google Calendar button turns on by itself once the calendar-feed function is deployed (docs/GOOGLE-CALENDAR.md).</p>` : ''}`, {
      cancelLabel: 'Close',
      onOpen: (form) => {
        const input = form.querySelector('.hc-feed');
        form.querySelector('[data-feed-copy]')?.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(input.value); toast('Copied.'); } catch { input.select(); toast('Press Ctrl+C (or long-press) to copy.'); }
        });
        form.querySelector('[data-feed-new]')?.addEventListener('click', async () => {
          if (!(await confirmDialog('Make a new link?', 'The old link stops working. Calendars that use it stop updating until you add the new one.', { confirmLabel: 'Make a new link' }))) return;
          try { input.value = db.calendarFeedUrl(await db.calendarFeedToken(S.org.id, true)); toast('New link ready. Add it to your calendar again.'); } catch (e) { toastError(e); }
        });
      },
    });
  } finally { if (btn) btn.disabled = false; }
});

