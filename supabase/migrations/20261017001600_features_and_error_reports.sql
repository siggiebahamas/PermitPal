-- 1) Feature switch. The website asks app_features() which newer features this database supports, so
--    the site can be deployed before (or after) these migrations without anything breaking: a feature
--    only appears once the database part of it exists. Each feature migration adds its own name.
-- 2) Error reports. Errors that happen in people's browsers are sent here (scrubbed of personal details),
--    grouped by kind, counted, and shown to PermitPal staff in Admin > Errors. A brand-new kind of error
--    alerts the founder. Reports are rate-limited so nobody can flood the table.

create table if not exists private.features (name text primary key);

create or replace function public.app_features() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(name, true), '{}'::jsonb) from private.features
$$;
revoke all on function public.app_features() from public;
grant execute on function public.app_features() to anon, authenticated;

-- ---------------------------------------------------------------- error reports
create table public.client_errors (
  id              bigserial primary key,
  fingerprint     text not null,
  message         text not null check (length(message) <= 500),
  stack           text check (length(stack) <= 4000),
  route           text check (length(route) <= 200),
  app_version     text check (length(app_version) <= 40),
  user_agent      text check (length(user_agent) <= 300),
  last_user_id    uuid references auth.users(id) on delete set null,
  last_org_id     uuid references public.orgs(id) on delete set null,
  users_affected  int not null default 1,
  count           int not null default 1,
  first_seen      timestamptz not null default now(),
  last_seen       timestamptz not null default now(),
  resolved_at     timestamptz,
  resolved_by     uuid references auth.users(id) on delete set null,
  note            text check (length(note) <= 500)
);
-- one open row per kind of error; once marked fixed, a recurrence opens a new row (and alerts again)
create unique index client_errors_open on public.client_errors (fingerprint) where resolved_at is null;
create index client_errors_last_seen on public.client_errors (last_seen desc);

create table private.client_error_users (fingerprint text not null, who text not null, primary key (fingerprint, who));
create table private.client_error_rate (who text primary key, n int not null, window_start timestamptz not null);

alter table public.client_errors enable row level security;
create policy client_errors_staff_read on public.client_errors for select to authenticated
  using ((select private.is_platform_admin()));
create policy client_errors_staff_update on public.client_errors for update to authenticated
  using ((select private.is_platform_admin())) with check ((select private.is_platform_admin()));
revoke all on public.client_errors from anon;
revoke insert, delete, truncate on public.client_errors from authenticated;

create or replace function public.log_client_error(p_message text, p_stack text default null, p_route text default null,
  p_version text default null, p_agent text default null, p_org uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_msg text := left(btrim(coalesce(p_message, '')), 500);
  v_route text := left(btrim(coalesce(p_route, '')), 200);
  v_ip text; v_who text; v_n int; v_fp text; v_org uuid; v_new boolean := false; v_alerts int;
begin
  if v_msg = '' then return; end if;
  -- who reported it: the signed-in person, otherwise a one-way hash of the visitor's network address
  v_ip := split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1);
  v_who := coalesce(v_uid::text, 'v:' || md5(coalesce(nullif(btrim(v_ip), ''), 'unknown')));
  -- at most 30 reports per person per hour
  insert into private.client_error_rate as r (who, n, window_start) values (v_who, 1, now())
  on conflict (who) do update set
    n = case when r.window_start < now() - interval '1 hour' then 1 else r.n + 1 end,
    window_start = case when r.window_start < now() - interval '1 hour' then now() else r.window_start end
  returning n into v_n;
  if v_n > 30 then return; end if;
  -- only record the workspace if this person really belongs to it
  if p_org is not null and p_org in (select private.my_org_ids()) then v_org := p_org; end if;
  -- the same bug on different records is one kind of error: drop ids and numbers before grouping
  v_fp := md5(regexp_replace(lower(v_msg), '[0-9a-f]{8}-[0-9a-f-]{27,}|[0-9]+', '#', 'g') || '|' ||
              regexp_replace(v_route, '[0-9a-f]{8}-[0-9a-f-]{27,}|[0-9]+', '#', 'g'));
  update public.client_errors set
    count = count + 1, last_seen = now(),
    stack = coalesce(nullif(left(p_stack, 4000), ''), stack),
    app_version = coalesce(nullif(left(p_version, 40), ''), app_version),
    user_agent = coalesce(nullif(left(p_agent, 300), ''), user_agent),
    last_user_id = coalesce(v_uid, last_user_id), last_org_id = coalesce(v_org, last_org_id)
  where fingerprint = v_fp and resolved_at is null;
  if not found then
    -- never more than 300 brand-new kinds of error in an hour, whatever happens
    if (select count(*) from public.client_errors where first_seen > now() - interval '1 hour') >= 300 then return; end if;
    insert into public.client_errors (fingerprint, message, stack, route, app_version, user_agent, last_user_id, last_org_id)
    values (v_fp, v_msg, nullif(left(p_stack, 4000), ''), nullif(v_route, ''), nullif(left(p_version, 40), ''),
            nullif(left(p_agent, 300), ''), v_uid, v_org)
    on conflict do nothing;
    v_new := found;
  end if;
  insert into private.client_error_users (fingerprint, who) values (v_fp, v_who) on conflict do nothing;
  if found then
    update public.client_errors set users_affected = (select count(*) from private.client_error_users u where u.fingerprint = v_fp)
    where fingerprint = v_fp and resolved_at is null;
  end if;
  if v_new then
    -- in-app alert to staff every time; email for at most 10 new kinds a day
    select count(*) into v_alerts from public.notifications where kind = 'help' and dedupe_key like 'err:%' and created_at > now() - interval '1 day';
    perform private.notify_admins('New app error: ' || left(v_msg, 90),
      coalesce(nullif(v_route, ''), 'unknown page') || ' · ' || coalesce(nullif(left(p_agent, 60), ''), 'unknown browser'),
      'err:' || v_fp || ':' || to_char(now(), 'YYYYMMDDHH24MI'), v_alerts < 10);
  end if;
end $$;
revoke all on function public.log_client_error(text, text, text, text, text, uuid) from public;
grant execute on function public.log_client_error(text, text, text, text, text, uuid) to anon, authenticated;

-- Staff mark an error fixed (or reopen it). A fixed error that happens again shows up as new.
create or replace function public.admin_resolve_error(p_id bigint, p_resolved boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if p_resolved then
    update public.client_errors set resolved_at = now(), resolved_by = auth.uid(), note = nullif(left(btrim(coalesce(p_note, '')), 500), '')
    where id = p_id and resolved_at is null;
  else
    -- reopen only if no newer open row of the same kind exists
    update public.client_errors e set resolved_at = null, resolved_by = null
    where e.id = p_id and not exists (select 1 from public.client_errors o where o.fingerprint = e.fingerprint and o.resolved_at is null);
  end if;
end $$;
revoke all on function public.admin_resolve_error(bigint, boolean, text) from public, anon;
grant execute on function public.admin_resolve_error(bigint, boolean, text) to authenticated;

-- Housekeeping, run nightly with the other maintenance: old fixed errors and stale counters go.
create or replace function private.purge_client_errors() returns void
language sql security definer set search_path = '' as $$
  delete from public.client_errors where (resolved_at is not null and resolved_at < now() - interval '60 days')
    or (resolved_at is null and last_seen < now() - interval '120 days');
  delete from private.client_error_users u where not exists (select 1 from public.client_errors e where e.fingerprint = u.fingerprint);
  delete from private.client_error_rate where window_start < now() - interval '1 day';
$$;
select cron.schedule('pp-purge-client-errors', '40 19 * * *', $$select private.purge_client_errors()$$);

insert into private.features (name) values ('errors') on conflict do nothing;
