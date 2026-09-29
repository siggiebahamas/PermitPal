-- Reminders: in-app notifications, an outbox of messages (email / SMS / WhatsApp) with a
-- full delivery log, and a daily job that decides what to remind whom about.
--
-- Flow: pg_cron -> private.queue_due_reminders() writes notifications + outbox rows
--       -> private.flush_outbox() pings the send-messages Edge Function
--       -> the function claims rows, sends them, and records sent/failed (with retries).

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- ---------------------------------------------------------------- tables
create table public.notifications (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  org_id          uuid references public.orgs(id) on delete cascade,
  kind            text not null check (kind in ('overdue','due_soon','help','team','billing','system')),
  title           text not null,
  body            text,
  link            text,
  requirement_id  uuid,
  dedupe_key      text unique,
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);

create table public.message_outbox (
  id               bigint generated always as identity primary key,
  org_id           uuid references public.orgs(id) on delete cascade,
  user_id          uuid references auth.users(id) on delete set null,
  channel          text not null check (channel in ('email','sms','whatsapp')),
  to_address       text not null,
  subject          text,
  body_text        text not null,
  body_html        text,
  template         text,
  template_params  jsonb,
  dedupe_key       text unique,
  status           text not null default 'queued' check (status in ('queued','sending','sent','failed','skipped')),
  attempts         int not null default 0,
  last_error       text,
  provider_id      text,
  next_attempt_at  timestamptz not null default now(),
  claimed_at       timestamptz,
  created_at       timestamptz not null default now(),
  sent_at          timestamptz
);
create index message_outbox_pending_idx on public.message_outbox(next_attempt_at) where status = 'queued';
create index message_outbox_user_idx on public.message_outbox(user_id, created_at desc);

alter table public.notifications enable row level security;
create policy notifications_read on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_mark_read on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_dismiss on public.notifications for delete to authenticated using (user_id = (select auth.uid()));
revoke insert, update on public.notifications from anon, authenticated;
grant update (read_at) on public.notifications to authenticated;
revoke all on public.notifications from anon;

alter table public.message_outbox enable row level security;
create policy outbox_read on public.message_outbox for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_platform_admin()));
revoke insert, update, delete on public.message_outbox from anon, authenticated;
revoke all on public.message_outbox from anon;

alter publication supabase_realtime add table public.notifications;

-- ---------------------------------------------------------------- helpers
create function private.html_escape(t text) returns text
language sql immutable set search_path = '' as $$
  select replace(replace(replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;')
$$;

-- Simple branded email wrapper. body_html must already be escaped.
create function private.email_html(p_title text, p_body_html text, p_cta_label text, p_cta_url text) returns text
language sql stable set search_path = '' as $$
  select '<!doctype html><html><body style="margin:0;background:#F4F6FA;font-family:Arial,Helvetica,sans-serif;color:#28303C">'
    || '<div style="max-width:560px;margin:0 auto;padding:24px">'
    || '<div style="font-size:22px;font-weight:800;margin-bottom:16px"><span style="color:#0C2A57">Permit</span><span style="color:#2F6FED">Pal</span></div>'
    || '<div style="background:#fff;border-radius:14px;padding:24px;border:1px solid #E5E9F0">'
    || '<h1 style="font-size:18px;margin:0 0 12px;color:#1B2130">' || private.html_escape(p_title) || '</h1>'
    || p_body_html
    || case when p_cta_url is not null then
         '<p style="margin:22px 0 4px"><a href="' || private.html_escape(p_cta_url) || '" style="background:#2F6FED;color:#fff;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:700;display:inline-block">'
         || private.html_escape(p_cta_label) || '</a></p>' else '' end
    || '</div><p style="font-size:12px;color:#6B7585;margin-top:16px">You get these because reminders are on in your PermitPal settings. '
    || 'Change them anytime under Settings &rarr; Reminders.</p></div></body></html>'
$$;

create function private.due_phrase(p_days int) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_days is null then 'has no expiry date on file'
    when p_days < -1 then 'is ' || (-p_days) || ' days overdue'
    when p_days = -1 then 'is 1 day overdue'
    when p_days = 0 then 'expires today'
    when p_days = 1 then 'expires tomorrow'
    else 'expires in ' || p_days || ' days' end
$$;

-- Queue one email (respects the person's email preference).
create function private.queue_email(p_user uuid, p_org uuid, p_subject text, p_title text, p_body_html text, p_body_text text,
                                    p_link text, p_dedupe text, p_force boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
  v_ok boolean;
  v_url text := private.setting('app_url') || coalesce(p_link, '');
begin
  select p.email, coalesce(np.email_enabled, true) into v_email, v_ok
    from public.profiles p left join public.notification_prefs np on np.user_id = p.id where p.id = p_user;
  if v_email is null or (not v_ok and not p_force) then return; end if;
  insert into public.message_outbox (org_id, user_id, channel, to_address, subject, body_text, body_html, dedupe_key)
  values (p_org, p_user, 'email', v_email, p_subject, p_body_text || E'\n\n' || v_url,
          private.email_html(p_title, p_body_html, 'Open PermitPal', v_url), p_dedupe)
  on conflict (dedupe_key) do nothing;
end $$;

-- In-app notification + (optionally) the same thing by email.
create function private.notify(p_user uuid, p_org uuid, p_kind text, p_title text, p_body text, p_link text,
                               p_requirement uuid, p_dedupe text, p_email boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  insert into public.notifications (user_id, org_id, kind, title, body, link, requirement_id, dedupe_key)
  values (p_user, p_org, p_kind, p_title, p_body, p_link, p_requirement, p_dedupe)
  on conflict (dedupe_key) do nothing returning id into v_id;
  if v_id is not null and p_email then
    perform private.queue_email(p_user, p_org, 'PermitPal: ' || p_title, p_title,
      '<p style="margin:0;line-height:1.5">' || private.html_escape(coalesce(p_body, '')) || '</p>',
      coalesce(p_body, ''), p_link, case when p_dedupe is null then null else p_dedupe || ':email' end);
  end if;
end $$;

-- Ask the send-messages function to deliver whatever is queued. pg_net sends after commit.
create function private.flush_outbox() returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.message_outbox set status = 'queued', claimed_at = null
   where status = 'sending' and claimed_at < now() - interval '10 minutes';
  if exists (select 1 from public.message_outbox where status = 'queued' and next_attempt_at <= now()) then
    perform net.http_post(
      url := private.setting('functions_url') || '/send-messages',
      body := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', private.setting('cron_secret')),
      timeout_milliseconds := 60000);
  end if;
end $$;

create function private.on_outbox_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.flush_outbox();
  return null;
end $$;
create trigger message_outbox_flush after insert on public.message_outbox
  for each statement execute function private.on_outbox_insert();

-- ---------------------------------------------------------------- the daily reminder job
create function private.queue_due_reminders() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := private.today_ph();
  v_app   text := private.setting('app_url');
  v_new   int := 0;
begin
  -- 1. One in-app notification per permit period, reminder stage and person.
  --    Stages: 30 days, 7 days, 1 day before, then weekly while overdue. Missing a day
  --    never skips a reminder: the most urgent stage not yet sent goes out next run.
  with items as (
    select rs.*,
      coalesce(rs.subject_name, '') ||
        case when rs.location_name is not null and not coalesce(rs.location_is_main, true) then ' (' || rs.location_name || ')' else '' end ||
        case when rs.plate_no is not null and rs.plate_no <> '' then ' - ' || rs.plate_no else '' end as label
    from public.requirement_status rs
    join public.orgs o on o.id = rs.org_id and o.deleted_at is null
    where rs.expires and rs.expires_on is not null and rs.days_left <= 30
      and (rs.status <> 'in_progress' or rs.days_left < 0)
  ), targets as (
    select i.*, m.user_id,
      case
        when i.days_left < 0 then 'overdue-' || ((-i.days_left - 1) / 7)
        when i.days_left <= 1 and np.remind_1 then 'd1'
        when i.days_left <= 7 and np.remind_7 then 'd7'
        when i.days_left <= 30 and np.remind_30 then 'd30'
      end as stage
    from items i
    join public.org_members m on m.org_id = i.org_id and m.role <> 'viewer'
    join public.notification_prefs np on np.user_id = m.user_id
    where (i.subject = 'business' and np.business_alerts) or (i.subject = 'vehicle' and np.vehicle_alerts)
  ), inserted as (
    insert into public.notifications (user_id, org_id, kind, title, body, link, requirement_id, dedupe_key)
    select t.user_id, t.org_id,
      case when t.days_left < 0 then 'overdue' else 'due_soon' end,
      t.name || ' ' || private.due_phrase(t.days_left),
      t.label || ' - due ' || private.fmt_date(t.expires_on),
      '#/requirement/' || t.id, t.id,
      'rem:' || t.cycle_id || ':' || t.stage || ':' || t.user_id
    from targets t where t.stage is not null
    on conflict (dedupe_key) do nothing
    returning user_id, org_id, title, body, link, kind
  ), grouped as (
    -- 2. One message per person per workspace per day, listing everything new.
    select i.user_id, i.org_id, count(*) as n,
      string_agg('<li style="margin:6px 0">' || private.html_escape(i.title) || '<br><span style="color:#6B7585;font-size:13px">'
                 || private.html_escape(i.body) || '</span></li>', '' order by i.kind, i.title) as items_html,
      string_agg('- ' || i.title || ' (' || i.body || ')', E'\n' order by i.kind, i.title) as items_text,
      (array_agg(i.title order by i.kind, i.title))[1] as first_title
    from inserted i group by i.user_id, i.org_id
  ), recipients as (
    select g.*, p.email, p.phone, p.first_name, o.name as org_name,
      coalesce(np.email_enabled, true) as email_on, coalesce(np.sms_enabled, false) as sms_on,
      coalesce(np.whatsapp_enabled, false) as wa_on,
      coalesce((select pl.paid_channels from public.plans pl where pl.id = private.effective_plan_id(g.org_id)), false) as paid
    from grouped g
    join public.profiles p on p.id = g.user_id
    join public.orgs o on o.id = g.org_id
    left join public.notification_prefs np on np.user_id = g.user_id
  ), msgs as (
    select r.org_id, r.user_id, 'email' as channel, r.email as to_address,
      case when r.n = 1 then 'PermitPal: ' || r.first_title else 'PermitPal: ' || r.n || ' items need attention (' || r.org_name || ')' end as subject,
      'These need attention in ' || r.org_name || E':\n' || r.items_text || E'\n\nOpen PermitPal: ' || v_app as body_text,
      private.email_html(case when r.n = 1 then r.first_title else r.n || ' items need attention' end,
        '<p style="margin:0 0 8px">In <b>' || private.html_escape(r.org_name) || '</b>:</p><ul style="padding-left:18px;margin:0">' || r.items_html || '</ul>',
        'Open PermitPal', v_app) as body_html,
      null::text as template, null::jsonb as template_params,
      'remmail:' || r.user_id || ':' || r.org_id || ':' || v_today as dedupe_key
    from recipients r where r.email_on and r.email is not null
    union all
    select r.org_id, r.user_id, 'sms', r.phone, null,
      left('PermitPal: ' || r.first_title || case when r.n > 1 then ' +' || (r.n - 1) || ' more' else '' end || '. ' || v_app, 300),
      null, null, null,
      'remsms:' || r.user_id || ':' || r.org_id || ':' || v_today
    from recipients r where r.sms_on and r.paid and r.phone is not null
    union all
    select r.org_id, r.user_id, 'whatsapp', r.phone, null,
      r.first_title || case when r.n > 1 then ' +' || (r.n - 1) || ' more' else '' end,
      null, 'permit_reminder',
      jsonb_build_array(coalesce(nullif(r.first_name, ''), 'there'), r.n::text, r.first_title, v_app),
      'remwa:' || r.user_id || ':' || r.org_id || ':' || v_today
    from recipients r where r.wa_on and r.paid and r.phone is not null
  )
  insert into public.message_outbox (org_id, user_id, channel, to_address, subject, body_text, body_html, template, template_params, dedupe_key)
  select * from msgs
  on conflict (dedupe_key) do nothing;
  get diagnostics v_new = row_count;

  -- 3. Monday weekly digest (email only): a summary of everything not compliant.
  if extract(isodow from v_today) = 1 then
    insert into public.message_outbox (org_id, user_id, channel, to_address, subject, body_text, body_html, dedupe_key)
    select d.org_id, d.user_id, 'email', d.email,
      'PermitPal weekly summary: ' || d.org_name,
      d.overdue || ' overdue, ' || d.soon || ' due within 30 days, ' || d.needinfo || ' need information, ' || d.inprog || ' in progress. ' || v_app,
      private.email_html('Your week in compliance: ' || d.org_name,
        '<table style="width:100%;border-collapse:collapse;font-size:14px">'
        || '<tr><td style="padding:6px 0">Overdue</td><td style="text-align:right;font-weight:700;color:#D8433C">' || d.overdue || '</td></tr>'
        || '<tr><td style="padding:6px 0">Due within 30 days</td><td style="text-align:right;font-weight:700;color:#DF9A1F">' || d.soon || '</td></tr>'
        || '<tr><td style="padding:6px 0">Need information</td><td style="text-align:right;font-weight:700">' || d.needinfo || '</td></tr>'
        || '<tr><td style="padding:6px 0">Renewals in progress</td><td style="text-align:right;font-weight:700;color:#2F6FED">' || d.inprog || '</td></tr>'
        || '<tr><td style="padding:6px 0">Compliant</td><td style="text-align:right;font-weight:700;color:#1D9C57">' || d.ok || '</td></tr></table>',
        'Open PermitPal', v_app),
      'digest:' || d.user_id || ':' || d.org_id || ':' || to_char(v_today, 'IYYY-IW')
    from (
      select m.user_id, m.org_id, p.email, o.name as org_name,
        count(*) filter (where rs.status = 'action_required') as overdue,
        count(*) filter (where rs.status = 'renew_soon') as soon,
        count(*) filter (where rs.status = 'needs_information') as needinfo,
        count(*) filter (where rs.status = 'in_progress') as inprog,
        count(*) filter (where rs.status = 'compliant') as ok
      from public.org_members m
      join public.orgs o on o.id = m.org_id and o.deleted_at is null
      join public.profiles p on p.id = m.user_id
      join public.notification_prefs np on np.user_id = m.user_id and np.weekly_digest and np.email_enabled
      join public.requirement_status rs on rs.org_id = m.org_id
      group by m.user_id, m.org_id, p.email, o.name
    ) d
    where d.email is not null and (d.overdue + d.soon + d.needinfo + d.inprog) > 0
    on conflict (dedupe_key) do nothing;
  end if;

  -- 4. Paid plan about to lapse: tell the owners a week ahead and on the day.
  perform private.notify(m.user_id, o.id, 'billing',
      case when o.plan_expires_at < now() then 'Your ' || pl.name || ' plan has ended'
           else 'Your ' || pl.name || ' plan ends on ' || private.fmt_date((o.plan_expires_at at time zone 'Asia/Manila')::date) end,
      'Renew under Settings > Plan & billing to keep SMS/WhatsApp reminders and your plan limits. Your data stays safe either way.',
      '#/settings/billing', null,
      'plan:' || o.id || ':' || (o.plan_expires_at at time zone 'Asia/Manila')::date || ':' ||
        case when o.plan_expires_at < now() then 'ended' else 'soon' end || ':' || m.user_id)
  from public.orgs o
  join public.plans pl on pl.id = o.plan_id
  join public.org_members m on m.org_id = o.id and m.role = 'owner'
  where o.deleted_at is null and o.plan_expires_at is not null
    and o.plan_expires_at < now() + interval '7 days' and o.plan_expires_at > now() - interval '2 days';

  perform private.flush_outbox();
  return v_new;
end $$;

-- ---------------------------------------------------------------- used by the send-messages function
-- Only the service role (the Edge Function) may call these; the shared secret proves the
-- call came from our own scheduler setup.
create function public.outbox_claim(p_secret text, p_limit int default 50, p_channels jsonb default null)
returns setof public.message_outbox
language plpgsql security definer set search_path = '' as $$
begin
  if p_secret is distinct from private.setting('cron_secret') then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  if p_channels is not null then
    update private.settings set value = p_channels::text where key = 'channel_status';
  end if;
  return query
  update public.message_outbox o set status = 'sending', attempts = o.attempts + 1, claimed_at = now()
   where o.id in (select id from public.message_outbox
                  where status = 'queued' and next_attempt_at <= now()
                  order by id limit greatest(1, least(p_limit, 200))
                  for update skip locked)
  returning o.*;
end $$;

create function public.outbox_finish(p_secret text, p_id bigint, p_result text, p_provider_id text default null, p_error text default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_secret is distinct from private.setting('cron_secret') then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  update public.message_outbox set
    status = case
      when p_result = 'sent' then 'sent'
      when p_result = 'skipped' then 'skipped'
      when attempts >= 5 then 'failed'
      else 'queued' end,
    sent_at = case when p_result = 'sent' then now() end,
    provider_id = coalesce(p_provider_id, provider_id),
    last_error = left(p_error, 1000),
    next_attempt_at = case when p_result = 'error' then now() + make_interval(mins => (power(2, attempts))::int) else next_attempt_at end,
    claimed_at = null
  where id = p_id and status = 'sending';
end $$;

revoke execute on function public.outbox_claim(text,int,jsonb), public.outbox_finish(text,bigint,text,text,text) from public, anon, authenticated;
grant execute on function public.outbox_claim(text,int,jsonb), public.outbox_finish(text,bigint,text,text,text) to service_role;

-- Which delivery channels are connected (for the Settings page).
create function public.channel_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(private.setting('channel_status'), '{}')::jsonb
$$;
revoke execute on function public.channel_status() from public, anon;
grant execute on function public.channel_status() to authenticated;

-- ---------------------------------------------------------------- schedules (times in UTC)
select cron.schedule('pp-daily-reminders', '5 23 * * *', $$select private.queue_due_reminders()$$);  -- 7:05am Manila
select cron.schedule('pp-flush-outbox', '*/5 * * * *', $$select private.flush_outbox()$$);          -- retries every 5 min
