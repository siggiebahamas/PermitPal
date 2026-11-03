-- Database file 22 (phone alerts). Run once, in the Supabase SQL Editor, after file 21.
-- Every in-app notification also buzzes the person's phone once they turn reminders on there: grouped into one
-- alert per run, at most 4 a day. The sending keys are made by the send-messages function itself; nothing to paste.
-- All or nothing: if anything fails, nothing is changed.
begin;

do $$ declare v_prev boolean := false; v_done boolean := false; begin
  if to_regclass('private.features') is not null then
    execute $q$select exists (select 1 from private.features where name = 'themes'), exists (select 1 from private.features where name = 'push')$q$ into v_prev, v_done;
  end if;
  if not v_prev then raise exception 'Run supabase/manual/2026-11-07-site-theme.sql first, then run this file. Nothing was changed.'; end if;
  if v_done then raise exception 'This file was already run. Nothing was changed.'; end if;
end $$;

-- ======================================================================== 20261108001000_push.sql
-- Database file 22: phone alerts (web push). Every in-app notification also buzzes the person's phone or computer,
-- once they tap "Turn on reminders" there. Nothing to set up by hand: the send-messages function makes its own
-- sending keys (VAPID) the first time it runs and keeps them here, out of reach of the app.
-- Gentle by design: everything new for a person is grouped into one alert per run, and at most 4 alerts a day
-- (Manila time). Notifications that wait longer are still in the app and in the email.

-- ======================================================================== where each phone can be reached
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null unique check (endpoint ~ '^https://\S{10,}$' and length(endpoint) <= 1000),
  p256dh      text not null check (p256dh ~ '^[A-Za-z0-9_-]{80,100}$'),
  auth        text not null check (auth ~ '^[A-Za-z0-9_-]{16,30}$'),
  device      text check (device is null or length(device) <= 120),
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz,
  fail_count  int not null default 0
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
revoke insert, update, delete on public.push_subscriptions from anon, authenticated;
revoke all on public.push_subscriptions from anon;

-- One row per alert sent, for the daily limit.
create table if not exists public.push_sends (
  id       bigint generated always as identity primary key,
  user_id  uuid not null references auth.users(id) on delete cascade,
  sent_at  timestamptz not null default now()
);
create index if not exists push_sends_user on public.push_sends (user_id, sent_at desc);
alter table public.push_sends enable row level security;
revoke all on public.push_sends from anon, authenticated;

-- Which notifications already went to the phone. Everything that exists today counts as sent, so turning alerts on
-- never floods anyone with old news.
alter table public.notifications add column if not exists pushed_at timestamptz;
update public.notifications set pushed_at = coalesce(pushed_at, now()) where pushed_at is null;

insert into private.settings (key, value) values ('vapid_public', ''), ('vapid_private', '') on conflict (key) do nothing;

-- ======================================================================== what the app calls
create or replace function public.push_public_key() returns text
language sql stable security definer set search_path = '' as $$
  select nullif(private.setting('vapid_public'), '')
$$;

create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_device text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Please sign in first.' using errcode = '42501'; end if;
  if (select count(*) from public.push_subscriptions where user_id = auth.uid()) >= 10 then
    delete from public.push_subscriptions where id = (select id from public.push_subscriptions where user_id = auth.uid() order by created_at limit 1);
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, device)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(nullif(btrim(coalesce(p_device, '')), ''), 120))
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
    device = excluded.device, fail_count = 0;
end $$;

create or replace function public.push_unsubscribe(p_endpoint text) returns void
language sql security definer set search_path = '' as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid()
$$;

-- "Send me a test alert": a notification like any other, so it travels the real way.
create or replace function public.push_test() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Please sign in first.' using errcode = '42501'; end if;
  if not exists (select 1 from public.push_subscriptions where user_id = auth.uid()) then
    raise exception 'Turn on reminders on this phone first.' using errcode = 'P0001';
  end if;
  insert into public.notifications (user_id, kind, title, body, link)
  values (auth.uid(), 'system', 'Reminders are on', 'This is how Pinoy Permit will tell you about a deadline.', '#/notifications');
end $$;

revoke all on function public.push_subscribe(text, text, text, text), public.push_unsubscribe(text), public.push_test() from public, anon;
grant execute on function public.push_subscribe(text, text, text, text), public.push_unsubscribe(text), public.push_test() to authenticated;
grant execute on function public.push_public_key() to anon, authenticated;

-- ======================================================================== what the send-messages function calls
-- The function's own keys, saved once. Never replaced while set, so phones that already subscribed keep working.
create or replace function public.push_set_keys(p_secret text, p_public text, p_private text) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if p_secret is distinct from private.setting('cron_secret') then raise exception 'unauthorized' using errcode = '28000'; end if;
  if coalesce(private.setting('vapid_public'), '') = '' then
    if p_public !~ '^[A-Za-z0-9_-]{80,100}$' or length(coalesce(p_private, '')) < 20 then raise exception 'bad keys' using errcode = '22023'; end if;
    update private.settings set value = p_public where key = 'vapid_public';
    update private.settings set value = p_private where key = 'vapid_private';
  end if;
  return private.setting('vapid_public');
end $$;

-- Everything new for people with alerts on, one alert per person, and the keys to send them. Marks it all as sent.
create or replace function public.push_claim(p_secret text, p_limit int default 100) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_day timestamptz := (date_trunc('day', now() at time zone 'Asia/Manila')) at time zone 'Asia/Manila'; v jsonb;
begin
  if p_secret is distinct from private.setting('cron_secret') then raise exception 'unauthorized' using errcode = '28000'; end if;
  -- Nobody to tell, or too old to be news: mark as done.
  update public.notifications n set pushed_at = now()
   where n.pushed_at is null and (n.created_at < now() - interval '1 day'
     or not exists (select 1 from public.push_subscriptions s where s.user_id = n.user_id));
  with due as (
    select n.user_id, count(*) as n, array_agg(n.id) as ids,
      (array_agg(n.title order by case n.kind when 'overdue' then 0 when 'team' then 1 when 'due_soon' then 2 else 3 end, n.created_at))[1] as first_title,
      (array_agg(coalesce(n.body, '') order by case n.kind when 'overdue' then 0 when 'team' then 1 when 'due_soon' then 2 else 3 end, n.created_at))[1] as first_body,
      (array_agg(coalesce(n.link, '#/notifications') order by case n.kind when 'overdue' then 0 when 'team' then 1 when 'due_soon' then 2 else 3 end, n.created_at))[1] as first_link
    from public.notifications n
    where n.pushed_at is null
    group by n.user_id
    limit greatest(1, least(p_limit, 500))
  ), marked as (
    update public.notifications set pushed_at = now() where id in (select unnest(ids) from due) returning id
  ), allowed as (
    select d.* from due d where (select count(*) from public.push_sends ps where ps.user_id = d.user_id and ps.sent_at >= v_day) < 4
  ), logged as (
    insert into public.push_sends (user_id) select user_id from allowed returning user_id
  )
  select jsonb_build_object(
    'public', nullif(private.setting('vapid_public'), ''), 'private', nullif(private.setting('vapid_private'), ''),
    'subject', coalesce(nullif(private.setting('app_url'), ''), 'https://siggiebahamas.github.io/PermitPal/'),
    'alerts', coalesce(jsonb_agg(jsonb_build_object(
      'title', case when a.n = 1 then a.first_title else a.n || ' things need you' end,
      'body', case when a.n = 1 then a.first_body else a.first_title || ', and ' || (a.n - 1) || ' more' end,
      'url', case when a.n = 1 then a.first_link else '#/notifications' end,
      'subs', (select jsonb_agg(jsonb_build_object('id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
               from public.push_subscriptions s where s.user_id = a.user_id))) filter (where a.user_id is not null), '[]'::jsonb))
  into v
  from (select * from allowed) a
  where (select count(*) from marked) >= 0 and (select count(*) from logged) >= 0;
  return v;
end $$;

-- How each send went: a phone that's gone (uninstalled, alerts turned off) is forgotten; repeated failures too.
create or replace function public.push_result(p_secret text, p_id uuid, p_ok boolean, p_gone boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_secret is distinct from private.setting('cron_secret') then raise exception 'unauthorized' using errcode = '28000'; end if;
  if p_gone then delete from public.push_subscriptions where id = p_id; return; end if;
  update public.push_subscriptions set last_ok_at = case when p_ok then now() else last_ok_at end,
    fail_count = case when p_ok then 0 else fail_count + 1 end where id = p_id;
  delete from public.push_subscriptions where id = p_id and fail_count >= 5;
end $$;

revoke all on function public.push_set_keys(text, text, text), public.push_claim(text, int), public.push_result(text, uuid, boolean, boolean) from public, anon, authenticated;
grant execute on function public.push_set_keys(text, text, text), public.push_claim(text, int), public.push_result(text, uuid, boolean, boolean) to service_role;

-- ======================================================================== waking the sender
-- Right after new notifications for someone with alerts on (and every 5 minutes as a safety net), or when the
-- sending keys don't exist yet.
create or replace function private.flush_push() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(private.setting('vapid_public'), '') = ''
     or exists (select 1 from public.notifications n where n.pushed_at is null and n.created_at > now() - interval '1 day'
                and exists (select 1 from public.push_subscriptions s where s.user_id = n.user_id)) then
    perform net.http_post(
      url := private.setting('functions_url') || '/send-messages',
      body := '{"push":true}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', private.setting('cron_secret')),
      timeout_milliseconds := 60000);
  end if;
end $$;
create or replace function private.on_notification_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.flush_push();
  return null;
end $$;
drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push after insert on public.notifications for each statement execute function private.on_notification_insert();

do $$ begin
  if exists (select 1 from cron.job where jobname = 'pp-flush-push') then perform cron.unschedule('pp-flush-push'); end if;
  perform cron.schedule('pp-flush-push', '*/5 * * * *', $c$select private.flush_push()$c$);
end $$;

insert into private.features (name) values ('push') on conflict do nothing;

commit;
