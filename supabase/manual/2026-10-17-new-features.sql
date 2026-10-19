-- PermitPal: every database change from October 16-17, 2026, in order, all or nothing.
-- Paste this whole file into Supabase → SQL Editor → Run, once. If anything fails, nothing is changed.
-- New features appear on the website by themselves once this has run.
begin;

-- ======================================================================== 20261016001500_quote_request_without_fee.sql
-- Fix: asking a professional for a quote failed with a database error when that professional had no
-- "fee per quote request" set (the admin form allows leaving it blank). The commission row now records 0.
create or replace function public.request_referral(p_org uuid, p_partner uuid, p_requirement uuid default null, p_note text default null,
  p_contact_method text default 'email', p_contact_value text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_partner public.partners; v_org text; v_who text; v_req text; v_body text;
begin
  if p_org not in (select private.my_writable_org_ids()) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  select * into v_partner from public.partners where id = p_partner and published;
  if v_partner.id is null then raise exception 'That professional is not available.' using errcode = '23503'; end if;
  if p_requirement is not null then
    select rs.name || ' for ' || coalesce(rs.subject_name, '') || coalesce(', ' || nullif(rs.location_city, ''), '') ||
           case when rs.expires_on is not null then ' (expires ' || private.fmt_date(rs.expires_on) || ')' else '' end
      into v_req from public.requirement_status rs where rs.id = p_requirement and rs.org_id = p_org;
    if v_req is null then raise exception 'That permit was not found.' using errcode = '23503'; end if;
  end if;
  if exists (select 1 from public.referrals where org_id = p_org and partner_id = p_partner and coalesce(requirement_id::text, '') = coalesce(p_requirement::text, '')
             and created_at > now() - interval '7 days') then
    raise exception 'You already sent this request this week. They will contact you soon.' using errcode = 'P0001';
  end if;
  insert into public.referrals (org_id, partner_id, requirement_id, note, contact_method, contact_value)
  values (p_org, p_partner, p_requirement, nullif(btrim(p_note), ''), coalesce(p_contact_method, 'email'), nullif(btrim(p_contact_value), ''))
  returning id into v_id;
  insert into public.referral_commissions (referral_id, amount_php) values (v_id, coalesce(v_partner.lead_fee_php, 0));
  select name into v_org from public.orgs where id = p_org;
  select coalesce(nullif(btrim(first_name || ' ' || last_name), ''), email) into v_who from public.profiles where id = auth.uid();
  v_body := 'New quote request from PermitPal.' || E'\n\n' || 'Business: ' || v_org || E'\n' || 'Name: ' || coalesce(v_who, '-') || E'\n' ||
    'Contact via ' || coalesce(p_contact_method, 'email') || ': ' || coalesce(p_contact_value, '-') || E'\n' ||
    coalesce('Permit: ' || v_req || E'\n', '') || coalesce('Message: ' || nullif(btrim(p_note), '') || E'\n', '') ||
    E'\nPlease contact them directly within 1 business day.';
  if v_partner.contact_email is not null then
    insert into public.message_outbox (org_id, channel, to_address, subject, body_text, body_html, dedupe_key)
    values (null, 'email', v_partner.contact_email, 'New quote request: ' || v_org,
      v_body, private.email_html('New quote request from PermitPal', '<p style="white-space:pre-line">' || private.html_escape(v_body) || '</p>', null, null),
      'lead:' || v_id);
  end if;
  perform private.notify_admins('Lead sent to ' || v_partner.name, v_org || ' - ' || coalesce(v_req, 'general request'), 'ref:' || v_id, false);
  return v_id;
end $$;

-- ======================================================================== 20261017001600_features_and_error_reports.sql
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

-- ======================================================================== 20261017001700_assign_and_escalate.sql
-- "Who's handling it": every permit can be assigned to one teammate.
--   * The person handling it gets the reminders for it; everyone else stops getting routine reminders
--     for that permit (fewer emails, clear responsibility). Unassigned permits remind everyone, as before.
--   * Owners and admins are alerted when a permit someone else is handling is close to its due date and
--     the renewal hasn't been started, and every week once it is overdue ("escalation").
--   * Someone who leaves the team, or becomes a viewer, can't keep permits: theirs go back to
--     "Nobody" and the owners are told, so nothing silently stops being reminded.

-- two new kinds of notification: "you're handling this" and "not started yet" alerts to owners
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('overdue','due_soon','help','team','billing','system','assigned','escalation'));

alter table public.requirements
  add column if not exists assignee_id uuid references auth.users(id) on delete set null,
  add column if not exists assigned_at timestamptz,
  add column if not exists assigned_by uuid references auth.users(id) on delete set null;
create index if not exists requirements_assignee on public.requirements (org_id, assignee_id) where assignee_id is not null and deleted_at is null;

-- How many days before the due date owners/admins are alerted about a permit that isn't started.
-- null = never (they still hear about overdue ones).
alter table public.orgs add column if not exists escalate_days int default 7 check (escalate_days is null or escalate_days between 1 and 60);

-- Only a teammate who can edit (not a viewer) can be assigned.
create or replace function private.check_assignee() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.assignee_id is not null and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) and not exists (
      select 1 from public.org_members m where m.org_id = new.org_id and m.user_id = new.assignee_id and m.role <> 'viewer') then
    raise exception 'That person isn''t on this workspace''s team, or can only view.' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists requirements_assignee_check on public.requirements;
create trigger requirements_assignee_check before insert or update of assignee_id on public.requirements
  for each row execute function private.check_assignee();

-- Assign (or unassign) one or many permits in one go. Tells the new person, once per call.
create or replace function public.assign_requirements(p_ids uuid[], p_assignee uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_org uuid; v_orgs int; v_n int; v_first uuid; v_who text; v_label text;
begin
  if coalesce(array_length(p_ids, 1), 0) = 0 then return 0; end if;
  if array_length(p_ids, 1) > 1000 then raise exception 'Assign at most 1,000 at a time.' using errcode = 'P0001'; end if;
  select count(distinct org_id), min(org_id::text)::uuid into v_orgs, v_org
  from public.requirements where id = any(p_ids) and deleted_at is null;
  if v_orgs <> 1 or v_org not in (select private.my_writable_org_ids()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  update public.requirements set
    assignee_id = p_assignee,
    assigned_at = case when p_assignee is null then null else now() end,
    assigned_by = case when p_assignee is null then null else v_me end
  where id = any(p_ids) and org_id = v_org and deleted_at is null and assignee_id is distinct from p_assignee;
  get diagnostics v_n = row_count;
  if p_assignee is not null and p_assignee is distinct from v_me and v_n > 0 then
    select coalesce(nullif(btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''), email, 'A teammate') into v_who
    from public.profiles where id = v_me;
    select id into v_first from public.requirements where id = any(p_ids) and assignee_id = p_assignee order by name limit 1;
    v_label := private.requirement_label(v_first);
    perform private.notify(p_assignee, v_org, 'assigned',
      case when v_n = 1 then 'You''re now handling ' || v_label else 'You''re now handling ' || v_n || ' permits' end,
      coalesce(v_who, 'A teammate') || ' asked you to handle ' || case when v_n = 1 then 'it' else 'them' end
        || '. You''ll get the reminders from now on.',
      case when v_n = 1 then '#/requirement/' || v_first else '#/compliance?who=me' end,
      case when v_n = 1 then v_first else null end,
      'asg:' || gen_random_uuid(), true);
  end if;
  return v_n;
end $$;
revoke all on function public.assign_requirements(uuid[], uuid) from public, anon;
grant execute on function public.assign_requirements(uuid[], uuid) to authenticated;

-- Owners/admins choose when they are alerted (or turn it off).
create or replace function public.set_escalation(p_org uuid, p_days int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_org not in (select private.my_admin_org_ids()) then raise exception 'Only owners and admins can change this.' using errcode = '42501'; end if;
  if p_days is not null and (p_days < 1 or p_days > 60) then raise exception 'Choose between 1 and 60 days.' using errcode = 'P0001'; end if;
  update public.orgs set escalate_days = p_days where id = p_org;
end $$;
revoke all on function public.set_escalation(uuid, int) from public, anon;
grant execute on function public.set_escalation(uuid, int) to authenticated;

-- Leaving the team (or becoming a viewer) hands their permits back to "Nobody", and owners are told.
create or replace function private.unassign_departed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_n int; v_who text; v_owner record;
begin
  if tg_op = 'UPDATE' and not (new.role = 'viewer' and old.role <> 'viewer') then return new; end if;
  -- the whole workspace is being deleted (members go with it): nothing to hand back, nobody to tell
  if not exists (select 1 from public.orgs where id = old.org_id) then return coalesce(new, old); end if;
  update public.requirements set assignee_id = null, assigned_at = null, assigned_by = null
  where org_id = old.org_id and assignee_id = old.user_id and deleted_at is null;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    select coalesce(nullif(btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''), email, 'A teammate') into v_who
    from public.profiles where id = old.user_id;
    for v_owner in select user_id from public.org_members where org_id = old.org_id and role in ('owner', 'admin') and user_id <> old.user_id loop
      perform private.notify(v_owner.user_id, old.org_id, 'assigned',
        case when v_n = 1 then '1 permit no longer has anyone handling it' else v_n || ' permits no longer have anyone handling them' end,
        v_who || case when tg_op = 'DELETE' then ' left the team' else ' can now only view' end
          || '. Everyone on the team gets those reminders again until you pick someone new.',
        '#/compliance?who=nobody', null, 'unasg:' || old.org_id || ':' || old.user_id || ':' || now()::text, true);
    end loop;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists org_members_unassign on public.org_members;
create trigger org_members_unassign after delete or update of role on public.org_members
  for each row execute function private.unassign_departed();

-- ---------------------------------------------------------------- status view: who is handling it
create or replace view public.requirement_status with (security_invoker = true) as
select
  r.id, r.org_id, r.subject, r.business_id, r.location_id, r.vehicle_id, r.type_code, r.name,
  r.expires, r.confidence, r.notes, r.renewal_started_at, r.created_at, r.updated_at,
  coalesce(b.name, v.make_model, pe.full_name) as subject_name,
  v.plate_no,
  l.name as location_name, l.city as location_city, l.is_main as location_is_main,
  c.id as cycle_id, c.reference_no, c.issuer, c.issued_on, c.expires_on,
  coalesce(dc.n, 0)::int as document_count,
  ar.id as open_request_id, ar.status as open_request_status,
  (c.expires_on - t.today) as days_left,
  s.base_status,
  case when ar.id is not null or r.renewal_started_at is not null then 'in_progress' else s.base_status end as status,
  coalesce(c.expires_on < t.today, false) as is_overdue,
  case
    when ar.id is not null or r.renewal_started_at is not null then 'record_renewal'
    when s.base_status in ('action_required','renew_soon') then 'renew'
    when s.base_status = 'needs_information' and r.expires and c.expires_on is null then 'add_details'
    when s.base_status = 'needs_information' and c.id is null then 'add_details'
    when s.base_status = 'needs_information' then 'upload'
  end as next_action,
  r.person_id,
  pe.role_title as person_role,
  c.amount_paid,
  r.assignee_id,
  r.assigned_at
from public.requirements r
cross join lateral (select private.today_ph() as today) t
left join public.businesses b on b.id = r.business_id
left join public.business_locations l on l.id = r.location_id
left join public.vehicles v on v.id = r.vehicle_id
left join public.people pe on pe.id = r.person_id
left join lateral (
  select c.* from public.requirement_cycles c
  where c.requirement_id = r.id and c.deleted_at is null
  order by c.seq desc limit 1
) c on true
left join lateral (
  select count(*) as n from public.documents d where d.cycle_id = c.id and d.deleted_at is null
) dc on true
left join lateral (
  select a.id, a.status from public.assistance_requests a
  where a.requirement_id = r.id and a.status not in ('completed','cancelled')
  order by a.created_at desc limit 1
) ar on true
cross join lateral (
  select case
    when c.id is null then 'needs_information'
    when not r.expires then case when coalesce(dc.n, 0) > 0 then 'compliant' else 'needs_information' end
    when c.expires_on is null then 'needs_information'
    when c.expires_on < t.today then 'action_required'
    when c.expires_on <= t.today + 30 then 'renew_soon'
    when coalesce(dc.n, 0) > 0 then 'compliant'
    else 'needs_information'
  end as base_status
) s
where r.deleted_at is null
  and (b.id is null or b.deleted_at is null)
  and (l.id is null or l.deleted_at is null)
  and (v.id is null or v.deleted_at is null)
  and (pe.id is null or pe.deleted_at is null);

-- Escalation alerts: run by the daily reminder job (queue_due_reminders calls this).
create or replace function private.queue_escalations() returns int
language plpgsql security definer set search_path = '' as $$
declare v_n int := 0; v record;
begin
  for v in
    select rs.id, rs.org_id, rs.cycle_id, rs.name, rs.days_left, rs.expires_on, m.user_id,
      coalesce(nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), p.email, 'A teammate') as who,
      coalesce(rs.subject_name, '') || case when rs.plate_no is not null and rs.plate_no <> '' then ' - ' || rs.plate_no else '' end as label,
      case when rs.days_left < 0 then 'over-' || ((-rs.days_left - 1) / 7) else 'soon' end as stage
    from public.requirement_status rs
    join public.orgs o on o.id = rs.org_id and o.deleted_at is null
    join public.org_members m on m.org_id = rs.org_id and m.role in ('owner', 'admin') and m.user_id <> rs.assignee_id
    join public.profiles p on p.id = rs.assignee_id
    where rs.assignee_id is not null and rs.expires and rs.expires_on is not null
      and (rs.days_left < 0 or (o.escalate_days is not null and rs.days_left <= o.escalate_days and rs.status <> 'in_progress'))
  loop
    perform private.notify(v.user_id, v.org_id, 'escalation',
      case when v.days_left < 0 then 'Overdue: ' else 'Not started yet: ' end || v.name || ' (' || v.label || ')',
      v.who || ' is handling it. ' || case when v.days_left < 0 then 'It was due ' else 'It is due ' end || private.fmt_date(v.expires_on)
        || '. Check in with them, or give it to someone else.',
      '#/requirement/' || v.id, v.id, 'esc:' || v.cycle_id || ':' || v.stage || ':' || v.user_id, true);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------- daily reminders: assigned permits go to their handler
create or replace function private.queue_due_reminders()
 returns integer language plpgsql security definer set search_path to '' as $function$
declare
  v_today date := private.today_ph();
  v_app   text := private.setting('app_url');
  v_new   int := 0;
begin
  -- 1. One in-app notification per permit period, reminder stage and person.
  --    Stages: 30 days, 7 days, 1 day before, then weekly while overdue. Missing a day
  --    never skips a reminder: the most urgent stage not yet sent goes out next run.
  --    A permit someone is handling reminds only that person; others remind everyone who can edit.
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
    join public.org_members m on m.org_id = i.org_id and m.role <> 'viewer' and (i.assignee_id is null or m.user_id = i.assignee_id)
    join public.notification_prefs np on np.user_id = m.user_id
    where (i.subject in ('business','person') and np.business_alerts) or (i.subject = 'vehicle' and np.vehicle_alerts)
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

  -- 1b. Escalations to owners/admins for permits someone else is handling.
  perform private.queue_escalations();

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
end $function$;

insert into private.features (name) values ('assign') on conflict do nothing;

-- ======================================================================== 20261017001800_library_checklists_services.sql
-- 1) A fuller permit library: more business, vehicle and staff permits, each with where to file it,
--    the official online portal (only where there is one national portal), how long it is valid,
--    which permits must be done first, and a renewal checklist.
-- 2) Checklist progress per permit. It belongs to the current permit period, so recording the renewal
--    starts a fresh checklist for next time automatically.
-- 3) The done-for-you service is back: customers can have PermitPal renew (or apply for) a permit,
--    with an exact quote first, written authorization, and government fees at cost.
-- Checklists are general guidance: cities and agencies can ask for more or less, and the app says so.

-- ================================================================ library columns
alter table public.requirement_types
  add column if not exists category      text,
  add column if not exists where_to_file text check (where_to_file is null or length(where_to_file) <= 400),
  add column if not exists online_url    text check (online_url is null or online_url ~ '^https://[a-z0-9.-]+\.[a-z]{2,}(/[^\s]*)?$'),
  add column if not exists online_label  text check (online_label is null or length(online_label) <= 80),
  add column if not exists validity_note text check (validity_note is null or length(validity_note) <= 500),
  add column if not exists depends_on    text[] not null default '{}',
  add column if not exists checklist     jsonb not null default '[]'::jsonb check (jsonb_typeof(checklist) = 'array');
alter table public.requirement_types drop constraint if exists requirement_types_due_rule_check;
alter table public.requirement_types add constraint requirement_types_due_rule_check
  check (due_rule in ('manual','jan20','annual','lto_plate','years5','years2','months6'));

-- Checklist items: {"k": stable key, "t": what to do or bring, "d": optional detail, "u": optional https link,
-- "dep": optional permit code that is itself tracked (shown with its live status)}.

-- ---------------------------------------------------------------- existing business permits
update public.requirement_types set category = 'local',
  where_to_file = $t$Your city or municipal hall's Business Permits and Licensing Office (BPLO), or its online portal. Many cities open a one-stop shop in January.$t$,
  validity_note = $t$Valid for the calendar year. Most cities want it renewed by January 20; late renewal can add up to a 25% surcharge plus 2% interest a month.$t$,
  depends_on = array['barangay_clearance'],
  checklist = $j$[
    {"k":"brgy","t":"Barangay Business Clearance for this year","dep":"barangay_clearance"},
    {"k":"prev","t":"Last year's Mayor's Permit and its official receipt"},
    {"k":"sales","t":"Last year's gross sales or receipts","d":"Usually copies of your BIR returns, or a sworn declaration of gross sales."},
    {"k":"ctc","t":"Community Tax Certificate (cedula) for the business","d":"From the city or municipal treasurer."},
    {"k":"lease","t":"Proof of address","d":"Lease contract, or the title or tax declaration if you own the place."},
    {"k":"contrib","t":"SSS, PhilHealth and Pag-IBIG proof of payment, if your city asks","d":"Common for businesses with employees."},
    {"k":"fire","t":"Fire safety inspection (FSIC)","d":"Many cities have the fire inspection done as part of the renewal.","dep":"fsic"},
    {"k":"pay","t":"Pay the assessed taxes and fees","d":"Many cities let you pay by quarter. Keep the official receipt."},
    {"k":"claim","t":"Get the new permit and display it at the business"}
  ]$j$::jsonb
where code = 'mayors_permit';

update public.requirement_types set category = 'local',
  where_to_file = $t$The barangay hall where the business (or branch) is located.$t$,
  validity_note = $t$Valid for the calendar year. Needed before you can renew the Mayor's Permit.$t$,
  checklist = $j$[
    {"k":"prev","t":"Last year's barangay clearance"},
    {"k":"lease","t":"Proof of address","d":"Lease contract, or the title or tax declaration if you own the place."},
    {"k":"ctc","t":"Community Tax Certificate (cedula), if your barangay asks"},
    {"k":"pay","t":"Pay the barangay fee and keep the receipt"}
  ]$j$::jsonb
where code = 'barangay_clearance';

update public.requirement_types set category = 'national',
  where_to_file = $t$Your BIR Revenue District Office (RDO), or online through ORUS.$t$,
  online_url = 'https://orus.bir.gov.ph/', online_label = 'BIR ORUS (online registration and updates)',
  validity_note = $t$Does not expire. The ₱500 yearly registration fee was removed in 2024 (Ease of Paying Taxes Act).$t$,
  checklist = $j$[
    {"k":"display","t":"Display the COR (Form 2303) where customers can see it"},
    {"k":"notice","t":"Display the BIR notice asking customers to get an invoice"},
    {"k":"books","t":"Keep your registered books of accounts up to date"},
    {"k":"update","t":"Moved, changed your name or opened a branch? File the update with BIR (Form 1905)","u":"https://orus.bir.gov.ph/"}
  ]$j$::jsonb
where code = 'bir_cor';

update public.requirement_types set category = 'safety',
  where_to_file = $t$The Bureau of Fire Protection station for your city, often through the city's business one-stop shop.$t$,
  validity_note = $t$Valid for one year from the date issued.$t$,
  checklist = $j$[
    {"k":"app","t":"Application form","d":"Often part of the city's business permit application."},
    {"k":"prev","t":"Last year's FSIC"},
    {"k":"occupancy","t":"Copy of the building permit or certificate of occupancy, if asked"},
    {"k":"fsmr","t":"Fire Safety Maintenance Report, if your building needs one","d":"Usually for larger or higher-risk buildings."},
    {"k":"ready","t":"Fire extinguishers refilled and tagged; exits clear and marked"},
    {"k":"pay","t":"Pay the fire code fee","d":"Often 15% of your city's regulatory fees, at least ₱500. The station's assessment decides."},
    {"k":"inspect","t":"Have someone at the site for the inspection"}
  ]$j$::jsonb
where code = 'fsic';

update public.requirement_types set category = 'safety',
  where_to_file = $t$The city or municipal health office (sanitation section).$t$,
  validity_note = $t$Usually valid for one year; many cities follow the calendar year.$t$,
  checklist = $j$[
    {"k":"prev","t":"Last year's sanitary permit"},
    {"k":"cards","t":"Health certificates for staff who handle food or serve customers"},
    {"k":"water","t":"Water analysis (potability) result from an accredited laboratory"},
    {"k":"pest","t":"Pest control certificate"},
    {"k":"inspect","t":"Sanitary inspection of the premises"},
    {"k":"pay","t":"Pay the fee and keep the receipt"}
  ]$j$::jsonb
where code = 'sanitary_permit';

update public.requirement_types set category = 'national',
  where_to_file = $t$Online through DTI's Business Name Registration System.$t$,
  online_url = 'https://bnrs.dti.gov.ph/', online_label = 'DTI Business Name Registration System',
  validity_note = $t$Valid for 5 years. You can usually renew online from 90 days before it expires; late renewals can cost more.$t$,
  checklist = $j$[
    {"k":"online","t":"Renew online and pay the fee","u":"https://bnrs.dti.gov.ph/"},
    {"k":"print","t":"Download and keep the new certificate"}
  ]$j$::jsonb
where code = 'dti_business_name';

update public.requirement_types set category = 'national',
  where_to_file = $t$Online through SEC eFAST.$t$,
  online_url = 'https://efast.sec.gov.ph/', online_label = 'SEC eFAST (yearly filings)',
  validity_note = $t$Does not expire, but missing the yearly filings leads to fines and, in the end, revocation.$t$,
  checklist = $j$[
    {"k":"gis","t":"File the General Information Sheet (GIS) every year","d":"Within 30 days after your annual stockholders' or members' meeting."},
    {"k":"afs","t":"File audited financial statements every year","d":"The deadline depends on your fiscal year and your SEC registration number."},
    {"k":"contact","t":"Keep an official email address and phone number on file with the SEC"}
  ]$j$::jsonb
where code = 'sec_registration';

update public.requirement_types set category = 'national',
  where_to_file = $t$The Cooperative Development Authority office for your region.$t$,
  validity_note = $t$Does not expire, as long as the yearly reports are filed.$t$,
  checklist = $j$[
    {"k":"reports","t":"Submit the yearly reports the CDA requires","d":"Such as the Cooperative Annual Progress Report and audited financial statements. Check the CDA's current list."}
  ]$j$::jsonb
where code = 'cda_registration';

update public.requirement_types set category = 'industry',
  where_to_file = $t$DENR Environmental Management Bureau regional office.$t$,
  validity_note = $t$Does not expire, but you must follow its conditions and submit the monitoring reports it lists.$t$,
  checklist = $j$[
    {"k":"conditions","t":"Follow the conditions written on your ECC"},
    {"k":"reports","t":"Submit the monitoring reports it requires, on time"}
  ]$j$::jsonb
where code = 'ecc';

update public.requirement_types set category = 'industry',
  where_to_file = $t$Philippine Contractors Accreditation Board (PCAB).$t$,
  validity_note = $t$Check the validity printed on your license.$t$,
  checklist = $j$[
    {"k":"docs","t":"Updated company documents","d":"Such as financial statements and your list of technical staff. Check PCAB's current list."},
    {"k":"file","t":"File the renewal before the expiry date"}
  ]$j$::jsonb
where code = 'pcab_license';

update public.requirement_types set category = 'industry',
  where_to_file = $t$Department of Health (health facilities licensing).$t$,
  validity_note = $t$Check the validity printed on your licence.$t$,
  checklist = $j$[
    {"k":"check","t":"Get the DOH checklist for your kind of facility"},
    {"k":"file","t":"File the renewal before the expiry date"}
  ]$j$::jsonb
where code = 'doh_lto';

update public.requirement_types set category = 'industry',
  where_to_file = $t$DepEd, CHED or TESDA, depending on what you teach.$t$
where code = 'school_permit';

-- ---------------------------------------------------------------- existing vehicle permits
update public.requirement_types set category = 'registration',
  where_to_file = $t$Any LTO district office, or online in LTMS for plain renewals.$t$,
  online_url = 'https://portal.lto.gov.ph/', online_label = 'LTO LTMS portal',
  validity_note = $t$Renew every year in the week set by your plate number. Brand-new vehicles are first registered for 3 years. As of October 2026, LTO has extended registrations that expired from July 1, 2026 until further notice (MC MVL-2026-5271): check LTO's latest advisory before paying any penalty.$t$,
  depends_on = array['ctpl','emission_test'],
  checklist = $j$[
    {"k":"ctpl","t":"CTPL insurance for the coming year","dep":"ctpl"},
    {"k":"emission","t":"Passed emission test","d":"At an LTO-accredited emission testing center; the result is sent to LTO.","dep":"emission_test"},
    {"k":"inspect","t":"Vehicle inspection, if your vehicle needs it","dep":"mvir"},
    {"k":"orcr","t":"Current OR/CR"},
    {"k":"pay","t":"Pay the registration fee","d":"Online in LTMS works when your last renewal was also done in LTMS.","u":"https://portal.lto.gov.ph/"}
  ]$j$::jsonb
where code = 'lto_registration';

update public.requirement_types set category = 'registration',
  where_to_file = $t$Any insurance company or agent accredited by the Insurance Commission; many sell online.$t$,
  validity_note = $t$Covers one registration year. Buy it shortly before your registration renewal.$t$,
  checklist = $j$[
    {"k":"orcr","t":"Copy of the OR/CR"},
    {"k":"buy","t":"Buy CTPL for the next registration year"},
    {"k":"coc","t":"Check that the certificate of cover is authenticated, so LTO can see it"}
  ]$j$::jsonb
where code = 'ctpl';

update public.requirement_types set category = 'registration',
  where_to_file = $t$An LTO-accredited private emission testing center.$t$,
  validity_note = $t$Done for each registration renewal.$t$,
  checklist = $j$[
    {"k":"orcr","t":"Bring the OR/CR"},
    {"k":"test","t":"Pass the test shortly before your registration renewal"}
  ]$j$::jsonb
where code = 'emission_test';

update public.requirement_types set category = 'registration',
  where_to_file = $t$An LTO-authorized inspection center (PMVIC) or LTO, if your vehicle needs an inspection.$t$,
  checklist = $j$[
    {"k":"orcr","t":"Bring the OR/CR"},
    {"k":"inspect","t":"Pass the inspection before renewing the registration"}
  ]$j$::jsonb
where code = 'mvir';

update public.requirement_types set category = 'registration' where code = 'comprehensive_insurance';

-- ---------------------------------------------------------------- existing staff licences
update public.requirement_types set category = 'licence',
  where_to_file = $t$Any LTO licensing center. The driver must go in person.$t$,
  online_url = 'https://portal.lto.gov.ph/', online_label = 'LTO LTMS portal',
  validity_note = $t$Valid for 5 years, or 10 years for drivers with no traffic violations.$t$,
  checklist = $j$[
    {"k":"medical","t":"Medical certificate from an LTO-accredited clinic"},
    {"k":"cde","t":"Driver's education module and exam in LTMS, if required for the renewal","u":"https://portal.lto.gov.ph/"},
    {"k":"id","t":"Current license and a valid ID"},
    {"k":"pay","t":"Pay the renewal fee"}
  ]$j$::jsonb
where code = 'drivers_license';

update public.requirement_types set category = 'licence',
  where_to_file = $t$Online through PRC LERIS, then at a PRC office on your appointment.$t$,
  online_url = 'https://online.prc.gov.ph/', online_label = 'PRC LERIS',
  validity_note = $t$The PRC ID is valid for 3 years.$t$,
  checklist = $j$[
    {"k":"cpd","t":"CPD units your profession requires"},
    {"k":"apply","t":"Apply and book an appointment online","u":"https://online.prc.gov.ph/"},
    {"k":"pay","t":"Pay the renewal fee"},
    {"k":"claim","t":"Go to the appointment and claim the new ID"}
  ]$j$::jsonb
where code = 'prc_license';

update public.requirement_types set category = 'clearance',
  where_to_file = $t$The city or municipal health office where the person works.$t$,
  validity_note = $t$Usually valid for one year; some cities set a different period. Check the card.$t$,
  checklist = $j$[
    {"k":"labs","t":"Lab tests the health office asks for","d":"Often a chest X-ray and stool and urine tests."},
    {"k":"seminar","t":"Food safety seminar, if your city requires it"},
    {"k":"pay","t":"Pay the fee and claim the card"}
  ]$j$::jsonb
where code = 'health_certificate';

update public.requirement_types set category = 'clearance',
  where_to_file = $t$Online through the NBI clearance website, then an NBI clearance center.$t$,
  online_url = 'https://clearance.nbi.gov.ph/', online_label = 'NBI Clearance online',
  validity_note = $t$Check the validity printed on the clearance; employers often accept it for 6 months to 1 year.$t$,
  checklist = $j$[
    {"k":"apply","t":"Apply and book online","u":"https://clearance.nbi.gov.ph/"},
    {"k":"ids","t":"Two valid IDs"},
    {"k":"pay","t":"Pay the fee"},
    {"k":"appear","t":"Go for photo and fingerprints, if asked"}
  ]$j$::jsonb
where code = 'nbi_clearance';

-- ---------------------------------------------------------------- new permits (added only when chosen)
insert into public.requirement_types
  (code, name, subject, agency, expires, due_rule, per_location, activities, structures, confidence, auto_add, help_text, sort,
   category, where_to_file, online_url, online_label, validity_note, depends_on, checklist) values
  ('annual_building_inspection', 'Certificate of Annual Inspection (building)', 'business', 'Office of the Building Official', true, 'jan20', true, null, null, 'likely', false,
   $t$Many cities inspect business buildings every year as part of the business permit renewal.$t$, 42,
   'safety', $t$Your city or municipal Office of the Building Official, usually through the business one-stop shop.$t$, null, null,
   $t$Usually valid for the calendar year.$t$, '{}',
   $j$[{"k":"prev","t":"Last year's certificate"},{"k":"inspect","t":"Building inspection"},{"k":"pay","t":"Pay the inspection fee"}]$j$::jsonb),
  ('signage_permit', 'Signage / Signboard Permit', 'business', 'City or municipal hall', true, 'jan20', true, null, null, 'likely', false,
   $t$If you have a business sign. Many cities renew it together with the business permit.$t$, 44,
   'local', $t$Your city or municipal hall, often through the business one-stop shop.$t$, null, null,
   $t$Usually renewed every year with the business permit.$t$, '{}',
   $j$[{"k":"photo","t":"Photo and size of the sign"},{"k":"pay","t":"Pay the signage fee"}]$j$::jsonb),
  ('liquor_license', 'Liquor License', 'business', 'City or municipal hall', true, 'jan20', true, array['restaurant','retail'], null, 'likely', false,
   $t$If you sell or serve alcoholic drinks.$t$, 46,
   'local', $t$Your city or municipal hall (BPLO).$t$, null, null,
   $t$Usually renewed every year with the business permit.$t$, '{}',
   $j$[{"k":"prev","t":"Last year's liquor license"},{"k":"pay","t":"Pay the fee"}]$j$::jsonb),
  ('fda_lto', 'FDA License to Operate', 'business', 'Food and Drug Administration (FDA)', true, 'manual', true, null, null, 'needs_verification', false,
   $t$Needed if you make, import, distribute or sell food products, drugs, cosmetics or medical devices. Restaurants usually need a sanitary permit instead.$t$, 52,
   'industry', $t$Online through the FDA eServices portal.$t$, 'https://www.fda.gov.ph/', 'FDA website and eServices',
   $t$Enter the validity printed on your licence; the FDA sets it per licence.$t$, '{}',
   $j$[{"k":"file","t":"File the renewal online before the expiry date","u":"https://www.fda.gov.ph/"},{"k":"pay","t":"Pay the fee"},{"k":"download","t":"Download and keep the new licence"}]$j$::jsonb),
  ('discharge_permit', 'Wastewater Discharge Permit', 'business', 'DENR-EMB (or LLDA around Laguna Lake)', true, 'manual', true, array['manufacturing'], null, 'needs_verification', false,
   $t$If your business releases wastewater into a river, the sea or the drainage system.$t$, 92,
   'industry', $t$DENR Environmental Management Bureau regional office, or the LLDA around Laguna Lake.$t$, null, null,
   $t$Enter the validity printed on the permit.$t$, '{}',
   $j$[{"k":"lab","t":"Recent wastewater test results"},{"k":"file","t":"File the renewal before the expiry date"}]$j$::jsonb),
  ('dole_registration', 'DOLE Establishment Registration (Rule 1020)', 'business', 'Department of Labor and Employment', false, 'manual', true, null, null, 'confirmed', false,
   $t$One-time registration for every business with at least one employee. Free. Each branch registers.$t$, 130,
   'employer', $t$Online through DOLE's Establishment Report System.$t$, 'https://reports.dole.gov.ph/', 'DOLE Establishment Report System',
   $t$Does not expire. Update it if your address or number of workers changes a lot.$t$, '{}',
   $j$[{"k":"file","t":"Register online","u":"https://reports.dole.gov.ph/"},{"k":"keep","t":"Keep the certificate of registration on file"}]$j$::jsonb),
  ('sss_employer', 'SSS Employer Registration', 'business', 'Social Security System', false, 'manual', false, null, null, 'confirmed', false,
   $t$One-time registration as an employer, before you hire. Monthly contributions are separate.$t$, 132,
   'employer', $t$Online through My.SSS, or any SSS branch.$t$, 'https://www.sss.gov.ph/', 'SSS website (My.SSS)',
   $t$Does not expire.$t$, '{}', '[]'::jsonb),
  ('philhealth_employer', 'PhilHealth Employer Registration', 'business', 'PhilHealth', false, 'manual', false, null, null, 'confirmed', false,
   $t$One-time registration as an employer, before you hire. Monthly contributions are separate.$t$, 134,
   'employer', $t$Any PhilHealth local office, or online where available.$t$, 'https://www.philhealth.gov.ph/', 'PhilHealth website',
   $t$Does not expire.$t$, '{}', '[]'::jsonb),
  ('pagibig_employer', 'Pag-IBIG Employer Registration', 'business', 'Pag-IBIG Fund', false, 'manual', false, null, null, 'confirmed', false,
   $t$One-time registration as an employer, before you hire. Monthly contributions are separate.$t$, 136,
   'employer', $t$Online through Virtual Pag-IBIG, or any Pag-IBIG branch.$t$, 'https://www.pagibigfund.gov.ph/', 'Pag-IBIG Fund website',
   $t$Does not expire.$t$, '{}', '[]'::jsonb),
  ('bmbe_certificate', 'BMBE Certificate of Authority', 'business', 'DTI Negosyo Center', true, 'years2', false, null, null, 'confirmed', false,
   $t$For micro businesses with assets up to ₱3 million (not counting land): no income tax on the business while it is valid.$t$, 140,
   'national', $t$The Negosyo Center or DTI office where the business is located.$t$, null, null,
   $t$Valid for 2 years from the date issued, and renewable every 2 years.$t$, '{}',
   $j$[{"k":"form","t":"BMBE application form"},{"k":"assets","t":"Proof that total assets are still within the limit"},{"k":"file","t":"File before the certificate expires"}]$j$::jsonb),
  ('philgeps_platinum', 'PhilGEPS Platinum Membership', 'business', 'PhilGEPS', true, 'annual', false, null, null, 'confirmed', false,
   $t$Needed to bid for government contracts. Expired documents can get the membership suspended.$t$, 150,
   'national', $t$Online through the PhilGEPS portal.$t$, 'https://www.philgeps.gov.ph/', 'PhilGEPS',
   $t$Valid for one year; renew every year.$t$, '{}',
   $j$[{"k":"docs","t":"Upload your current documents","d":"Such as the Mayor's Permit, tax clearance and registration certificate."},{"k":"pay","t":"Pay the yearly membership fee"},{"k":"cert","t":"Download the new certificate"}]$j$::jsonb),
  ('ltfrb_franchise', 'LTFRB Franchise (CPC)', 'vehicle', 'LTFRB', true, 'manual', false, null, null, 'confirmed', false,
   $t$For vehicles that carry passengers or goods for hire, such as jeepneys, buses, taxis, TNVS and trucks-for-hire. Enter the validity printed on the decision.$t$, 60,
   'for_hire', $t$LTFRB regional office.$t$, null, null,
   $t$Enter the validity printed on the decision; file the extension well before it ends.$t$, '{}',
   $j$[{"k":"file","t":"File for extension of validity before it ends"},{"k":"docs","t":"Current OR/CR and insurance"},{"k":"pay","t":"Pay the fees"}]$j$::jsonb),
  ('police_clearance', 'National Police Clearance', 'person', 'PNP', true, 'months6', false, null, null, 'confirmed', false,
   $t$Often asked of new hires and staff in security or cash-handling work.$t$, 45,
   'clearance', $t$Online through the PNP National Police Clearance System, then a police station for photo and fingerprints.$t$,
   'https://pnpclearance.ph/', 'PNP National Police Clearance System',
   $t$Usually valid for 6 months.$t$, '{}',
   $j$[{"k":"apply","t":"Apply and book online","u":"https://pnpclearance.ph/"},{"k":"ids","t":"Valid IDs"},{"k":"pay","t":"Pay the fee"},{"k":"appear","t":"Go for photo and fingerprints"}]$j$::jsonb),
  ('tesda_nc', 'TESDA National Certificate (NC)', 'person', 'TESDA', true, 'years5', false, null, null, 'confirmed', false,
   $t$Skills certificates such as NC II for cooks, welders, electricians or caregivers.$t$, 50,
   'licence', $t$The TESDA office that issued the certificate.$t$, 'https://www.tesda.gov.ph/', 'TESDA',
   $t$Usually valid for 5 years; check the date printed. If the training rules changed, renewal may need a new assessment.$t$, '{}',
   $j$[{"k":"form","t":"Application form and ID photos"},{"k":"proof","t":"Proof of work in that skill during the last 5 years"},{"k":"file","t":"File at the issuing TESDA office"}]$j$::jsonb),
  ('security_guard_license', 'Security Guard License', 'person', 'PNP Civil Security Group (SOSIA)', true, 'manual', false, null, null, 'confirmed', false,
   $t$Required for every security guard. Enter the validity printed on the license.$t$, 55,
   'licence', $t$PNP Civil Security Group (SOSIA).$t$, null, null,
   $t$Enter the validity printed on the license.$t$, '{}', '[]'::jsonb)
on conflict (code) do nothing;

-- ================================================================ checklist progress
create table public.checklist_progress (
  requirement_id  uuid not null references public.requirements(id) on delete cascade,
  org_id          uuid not null references public.orgs(id) on delete cascade,
  round           text not null check (length(round) <= 40),  -- the permit period it belongs to ('first' before any record)
  item            text not null check (item ~ '^[a-z0-9_]{1,40}$'),
  done_by         uuid default auth.uid() references auth.users(id) on delete set null,
  done_at         timestamptz not null default now(),
  primary key (requirement_id, round, item)
);
create index checklist_progress_org on public.checklist_progress(org_id);
alter table public.checklist_progress enable row level security;
create policy checklist_progress_read on public.checklist_progress for select to authenticated
  using (org_id in (select private.my_org_ids()));
revoke insert, update, delete, truncate on public.checklist_progress from authenticated;
revoke all on public.checklist_progress from anon;

-- Tick or untick one item. The period is worked out here, not sent by the browser, so two people
-- ticking at the same time on an old page can't put ticks on the wrong renewal.
create or replace function public.set_checklist_item(p_req uuid, p_item text, p_done boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare v_r public.requirements; v_round text;
begin
  select * into v_r from public.requirements where id = p_req and deleted_at is null;
  if v_r.id is null or v_r.org_id not in (select private.my_writable_org_ids()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.requirement_types t, jsonb_array_elements(t.checklist) e
                 where t.code = v_r.type_code and e ->> 'k' = p_item) then
    raise exception 'That checklist item no longer exists. Refresh the page.' using errcode = '22023';
  end if;
  select coalesce(s.cycle_id::text, 'first') into v_round from public.requirement_status s where s.id = p_req;
  if coalesce(p_done, false) then
    insert into public.checklist_progress (requirement_id, org_id, round, item, done_by)
    values (p_req, v_r.org_id, coalesce(v_round, 'first'), p_item, auth.uid())
    on conflict do nothing;
  else
    delete from public.checklist_progress where requirement_id = p_req and round = coalesce(v_round, 'first') and item = p_item;
  end if;
  return coalesce(v_round, 'first');
end $$;
revoke all on function public.set_checklist_item(uuid, text, boolean) from public, anon;
grant execute on function public.set_checklist_item(uuid, text, boolean) to authenticated;

-- ================================================================ done-for-you service, back on
-- What the customer asked for (renew an existing permit, or apply for one they don't have yet) and
-- when they authorized PermitPal to act for them.
alter table public.assistance_requests
  add column if not exists kind text not null default 'renew' check (kind in ('renew','apply','other')),
  add column if not exists consented_at timestamptz;

-- Customers can't rewrite these afterwards (staff and the order functions can).
create or replace function private.assistance_lock_extra() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not private.is_platform_admin() then
    new.kind := old.kind; new.consented_at := old.consented_at;
  end if;
  return new;
end $$;
drop trigger if exists assistance_lock_extra on public.assistance_requests;
create trigger assistance_lock_extra before update on public.assistance_requests
  for each row execute function private.assistance_lock_extra();

drop function if exists public.request_service(uuid,text,uuid,uuid,uuid,uuid,text,boolean,text,text,text);
create or replace function public.request_service(
  p_org uuid, p_service text, p_requirement uuid default null, p_business uuid default null, p_vehicle uuid default null,
  p_person uuid default null, p_notes text default null, p_rush boolean default false,
  p_contact_method text default 'email', p_contact_value text default null, p_docs_status text default 'not_sure',
  p_kind text default 'renew', p_consent boolean default false
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  if not coalesce(p_consent, false) then
    raise exception 'Please tick the box to confirm PermitPal may act for you on this request.' using errcode = '22023';
  end if;
  if coalesce(p_kind, 'renew') not in ('renew','apply','other') then raise exception 'Unknown request type.' using errcode = '22023'; end if;
  -- A workspace can't flood the team with requests (each one emails the founder).
  if (select count(*) from public.assistance_requests where org_id = p_org and status not in ('completed','cancelled')) >= 25 then
    raise exception 'You have 25 open requests. Wait for some to finish, or cancel ones you no longer need.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.assistance_requests where org_id = p_org and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'That''s a lot of requests in one hour. Please try again a little later, or message us.' using errcode = 'P0001';
  end if;
  insert into public.assistance_requests (org_id, service_code, requirement_id, business_id, vehicle_id, person_id,
    requirement_name, subject_label, notes, rush, contact_method, contact_value, docs_status, kind, consented_at)
  values (p_org, p_service, p_requirement, p_business, p_vehicle, p_person, '-', '-',
    nullif(btrim(p_notes), ''), coalesce(p_rush, false), coalesce(p_contact_method, 'email'), nullif(btrim(p_contact_value), ''),
    coalesce(p_docs_status, 'not_sure'), coalesce(p_kind, 'renew'), now())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.request_service(uuid,text,uuid,uuid,uuid,uuid,text,boolean,text,text,text,text,boolean) from public, anon;
grant execute on function public.request_service(uuid,text,uuid,uuid,uuid,uuid,text,boolean,text,text,text,text,boolean) to authenticated;

-- Everything else in the order flow comes back exactly as it was before it was switched off.
do $$ declare f text; begin
  foreach f in array array[
    'public.accept_quote(uuid)', 'public.add_order_message(uuid,text,text,text)', 'public.submit_payment(uuid,text,text,text,text)',
    'public.order_payment_start(uuid)', 'public.admin_quote_request(uuid,numeric,numeric,text)', 'public.admin_confirm_payment(uuid,boolean,text)',
    'public.admin_update_order(uuid,text,text,text,text,numeric,text)', 'public.admin_refund_order(uuid,numeric,text,text,text,text)',
    'public.staff_open_file(text)', 'public.admin_record_renewal(uuid,text,text,date,date,numeric,text,text,text,bigint)'] loop
    if to_regprocedure(f) is not null then execute format('grant execute on function %s to authenticated', f); end if;
  end loop;
end $$;

-- A few more services that match the fuller library.
insert into public.services (code, name, category, summary, includes, price_from, price_unit, turnaround, applies_to, type_codes, sort) values
  ('renew_dti_business_name', 'DTI business name renewal', 'renewal',
   'We renew your business name online and save the new certificate to your account.',
   array['Renewal filed online','Fee at cost, receipt uploaded','New certificate saved to your account'],
   500, 'per business name', '1-3 working days', 'business', array['dti_business_name'], 70),
  ('renew_philgeps', 'PhilGEPS Platinum renewal', 'renewal',
   'We update your PhilGEPS documents and renew your Platinum membership.',
   array['Documents checked and uploaded','Membership fee at cost','New certificate saved to your account'],
   2000, 'per year', '3-10 working days', 'business', array['philgeps_platinum'], 75),
  ('apply_dole_registration', 'DOLE establishment registration', 'document',
   'We register your business (or a branch) with DOLE and save the certificate to your account.',
   array['Online filing','Certificate saved to your account'],
   1500, 'per branch', '3-10 working days', 'business', array['dole_registration'], 330),
  ('apply_bmbe', 'BMBE certificate (income tax exemption)', 'document',
   'We check if your business qualifies and file for (or renew) your BMBE Certificate of Authority.',
   array['Eligibility check','Filing at the Negosyo Center','Certificate saved to your account'],
   1500, 'one-time', '1-3 weeks', 'business', array['bmbe_certificate'], 340)
on conflict (code) do nothing;
-- Renewals can also be first-time applications: say so in the catalog.
update public.services set summary = summary || ' Don''t have it yet? We can apply for it too.'
where category = 'renewal' and code not in ('renew_ctpl', 'renew_other') and summary not like '%apply for it too%';

insert into private.features (name) values ('library2'), ('services') on conflict do nothing;

-- ======================================================================== 20261017001900_filings.sql
-- Government filing deadlines (BIR, SSS, PhilHealth, Pag-IBIG, SEC), per business.
-- The owner answers a few plain questions (employees? VAT or percentage tax? withholding on rent or
-- suppliers?), and PermitPal works out every recurring return and contribution, when each is due,
-- reminds the team, and keeps a record of what was filed (date, reference number, amount).
-- Rules are deliberately conservative: when sources disagree we use the earlier date, and a deadline
-- that falls on a weekend or holiday is still shown on its calendar date. Calendar-year taxpayers only.

-- ================================================================ the list of filings
create table public.filing_types (
  code        text primary key check (code ~ '^[a-z0-9_]{2,40}$'),
  agency      text not null check (agency in ('BIR','SSS','PhilHealth','Pag-IBIG','SEC')),
  form        text not null,
  name        text not null,
  frequency   text not null check (frequency in ('monthly','quarterly','annual')),
  applies     text not null check (applies in ('employer','withholding','vat','percentage','individual','corp','sec_gis')),
  rule        text not null check (rule in ('next10','next10_dec15','q_next_last','q_25','q_1701','q_60','a_apr15','a_jan31','a_mar1','a_apr30','m_sss','m_philhealth','m_pagibig','gis')),
  months      int[],   -- monthly filings only in these months (null = every month)
  quarters    int[],   -- quarterly filings only for these quarters (null = all four)
  help_text   text not null,
  online_url  text check (online_url is null or online_url ~ '^https://'),
  online_label text,
  sort        int not null default 100
);
alter table public.filing_types enable row level security;
create policy filing_types_read on public.filing_types for select to authenticated using (true);
revoke insert, update, delete, truncate on public.filing_types from anon, authenticated;

insert into public.filing_types (code, agency, form, name, frequency, applies, rule, months, quarters, help_text, online_url, online_label, sort) values
  ('bir_1601c', 'BIR', '1601-C', 'Tax withheld from employees'' pay', 'monthly', 'employer', 'next10_dec15', null, null,
   'The income tax you withheld from salaries. Due the 10th of the next month (January 15 for December).', 'https://www.bir.gov.ph/', 'BIR website (eFPS / eBIRForms)', 10),
  ('bir_0619e', 'BIR', '0619-E', 'Tax withheld from rent and suppliers (monthly)', 'monthly', 'withholding', 'next10', array[1,2,4,5,7,8,10,11], null,
   'Expanded withholding tax for the first two months of each quarter. Due the 10th of the next month.', 'https://www.bir.gov.ph/', 'BIR website (eFPS / eBIRForms)', 20),
  ('bir_1601eq', 'BIR', '1601-EQ', 'Tax withheld from rent and suppliers (quarterly return)', 'quarterly', 'withholding', 'q_next_last', null, null,
   'Expanded withholding tax for the whole quarter. Due the last day of the month after the quarter.', 'https://www.bir.gov.ph/', 'BIR website (eFPS / eBIRForms)', 30),
  ('bir_2550q', 'BIR', '2550Q', 'Quarterly VAT return', 'quarterly', 'vat', 'q_25', null, null,
   'For VAT-registered businesses. Due the 25th day after the quarter ends.', 'https://www.bir.gov.ph/', 'BIR website (eFPS / eBIRForms)', 40),
  ('bir_2551q', 'BIR', '2551Q', 'Quarterly percentage tax', 'quarterly', 'percentage', 'q_25', null, null,
   'For non-VAT businesses that pay percentage tax. Due the 25th day after the quarter ends. Not needed if you chose the 8% income tax rate.', 'https://www.bir.gov.ph/', 'BIR website (eFPS / eBIRForms)', 50),
  ('bir_1701q', 'BIR', '1701Q', 'Quarterly income tax (sole proprietor)', 'quarterly', 'individual', 'q_1701', null, array[1,2,3],
   'Due May 15, August 15 and November 15. The fourth quarter goes in the yearly return.', 'https://www.bir.gov.ph/', 'BIR website (eFPS / eBIRForms)', 60),
  ('bir_1701', 'BIR', '1701 / 1701A', 'Yearly income tax (sole proprietor)', 'annual', 'individual', 'a_apr15', null, null,
   'For the year just ended. Due April 15.', 'https://www.bir.gov.ph/', 'BIR website (eFPS / eBIRForms)', 70),
  ('bir_1702q', 'BIR', '1702Q', 'Quarterly income tax (corporation or partnership)', 'quarterly', 'corp', 'q_60', null, array[1,2,3],
   'Due 60 days after each of the first three quarters ends. The fourth quarter goes in the yearly return.', 'https://www.bir.gov.ph/', 'BIR website (eFPS / eBIRForms)', 80),
  ('bir_1702', 'BIR', '1702', 'Yearly income tax (corporation or partnership)', 'annual', 'corp', 'a_apr15', null, null,
   'For the year just ended, with the audited financial statements. Due April 15.', 'https://www.bir.gov.ph/', 'BIR website (eFPS / eBIRForms)', 90),
  ('bir_1604c', 'BIR', '1604-C', 'Yearly summary of tax withheld from employees', 'annual', 'employer', 'a_jan31', null, null,
   'With the list of employees. Due January 31. Give employees their Form 2316 by then too.', 'https://www.bir.gov.ph/', 'BIR website (eFPS / eBIRForms)', 100),
  ('bir_1604e', 'BIR', '1604-E', 'Yearly summary of tax withheld from rent and suppliers', 'annual', 'withholding', 'a_mar1', null, null,
   'With the list of payees. Due March 1.', 'https://www.bir.gov.ph/', 'BIR website (eFPS / eBIRForms)', 110),
  ('sss_contrib', 'SSS', 'Contributions', 'SSS contributions', 'monthly', 'employer', 'm_sss', null, null,
   'Employee and employer shares for the month. Due by the end of the next month. If the payment reference number (PRN) from My.SSS shows an earlier date, go by the PRN.', 'https://www.sss.gov.ph/', 'SSS website (My.SSS)', 200),
  ('philhealth_contrib', 'PhilHealth', 'Premium', 'PhilHealth premium', 'monthly', 'employer', 'm_philhealth', null, null,
   'Due by the 15th of the next month if your PhilHealth employer number (PEN) ends in 0 to 4, or by the 20th if it ends in 5 to 9.', 'https://www.philhealth.gov.ph/', 'PhilHealth website', 210),
  ('pagibig_contrib', 'Pag-IBIG', 'Contributions', 'Pag-IBIG contributions', 'monthly', 'employer', 'm_pagibig', null, null,
   'Due date depends on the first letter of your employer name: A to D by the 14th of the next month, E to L by the 19th, M to Q by the 24th, R to Z and numbers by the end of the month.', 'https://www.pagibigfund.gov.ph/', 'Pag-IBIG Fund website', 220),
  ('sec_afs', 'SEC', 'AFS', 'Audited financial statements', 'annual', 'corp', 'a_apr30', null, null,
   'For companies whose year ends December 31. The SEC sets the exact date each year by the last digit of your SEC registration number; we remind you by April 30 to be safe.', 'https://efast.sec.gov.ph/', 'SEC eFAST', 300),
  ('sec_gis', 'SEC', 'GIS', 'General Information Sheet', 'annual', 'sec_gis', 'gis', null, null,
   'Due within 30 days after your annual stockholders'' or members'' meeting.', 'https://efast.sec.gov.ph/', 'SEC eFAST', 310);

-- ================================================================ each business's answers
create table public.filing_setup (
  business_id      uuid primary key references public.businesses(id) on delete cascade,
  org_id           uuid not null references public.orgs(id) on delete cascade,
  has_employees    boolean not null default false,
  withholds        boolean not null default false,
  tax_type         text not null default 'unsure' check (tax_type in ('vat','percentage','eight_percent','unsure')),
  philhealth_digit smallint check (philhealth_digit between 0 and 9),
  pagibig_group    text check (pagibig_group in ('A-D','E-L','M-Q','R-Z')),
  annual_meeting   date,           -- only the month and day are used
  paused_codes     text[] not null default '{}',  -- filings they told us don't apply to them
  tracking_from    date not null,  -- due dates before this aren't listed (a month before setup, so recent ones can be ticked off)
  updated_by       uuid default auth.uid() references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index filing_setup_org on public.filing_setup(org_id);
alter table public.filing_setup enable row level security;
create policy filing_setup_read on public.filing_setup for select to authenticated using (org_id in (select private.my_org_ids()));
revoke insert, update, delete, truncate on public.filing_setup from anon, authenticated;
revoke all on public.filing_setup from anon;

-- ================================================================ what was filed
create table public.filing_records (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  business_id   uuid not null references public.businesses(id) on delete cascade,
  code          text not null references public.filing_types(code),
  period_start  date not null check (period_start = date_trunc('month', period_start)::date),
  filed_on      date not null,
  reference     text check (reference is null or length(reference) <= 100),
  amount        numeric(14,2) check (amount is null or amount >= 0),
  note          text check (note is null or length(note) <= 500),
  filed_by      uuid default auth.uid() references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (business_id, code, period_start)
);
create index filing_records_org on public.filing_records(org_id, filed_on desc);
alter table public.filing_records enable row level security;
create policy filing_records_read on public.filing_records for select to authenticated using (org_id in (select private.my_org_ids()));
revoke insert, update, delete, truncate on public.filing_records from anon, authenticated;
revoke all on public.filing_records from anon;

-- ================================================================ the rules
-- Pag-IBIG's group from the employer name's first letter or digit.
create or replace function private.pagibig_group(p_name text) returns text
language sql immutable set search_path = '' as $$
  select case
    when l between 'A' and 'D' then 'A-D' when l between 'E' and 'L' then 'E-L' when l between 'M' and 'Q' then 'M-Q' else 'R-Z' end
  from (select upper(left(regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9]', '', 'g'), 1)) as l) x
$$;

-- When a filing for the period starting p_period is due.
create or replace function private.filing_due(p_rule text, p_period date, p_digit smallint, p_group text, p_meeting date) returns date
language sql immutable set search_path = '' as $$
  select case p_rule
    when 'next10' then nm + 9
    when 'next10_dec15' then case when extract(month from p_period) = 12 then make_date(y + 1, 1, 15) else nm + 9 end
    when 'q_next_last' then (ms + interval '4 months')::date - 1
    when 'q_25' then (ms + interval '3 months')::date + 24
    when 'q_1701' then make_date(y, extract(month from ms)::int + 4, 15)
    when 'q_60' then (ms + interval '3 months')::date - 1 + 60
    when 'a_apr15' then make_date(y + 1, 4, 15)
    when 'a_jan31' then make_date(y + 1, 1, 31)
    when 'a_mar1' then make_date(y + 1, 3, 1)
    when 'a_apr30' then make_date(y + 1, 4, 30)
    when 'm_sss' then (ms + interval '2 months')::date - 1
    when 'm_philhealth' then nm + case when p_digit >= 5 then 19 else 14 end  -- unknown digit: the earlier date
    when 'm_pagibig' then case coalesce(p_group, 'A-D') when 'A-D' then nm + 13 when 'E-L' then nm + 18 when 'M-Q' then nm + 23
                                                        else (ms + interval '2 months')::date - 1 end
    when 'gis' then case when p_meeting is null then null else
      make_date(y, extract(month from p_meeting)::int,
        least(extract(day from p_meeting)::int, extract(day from (make_date(y, extract(month from p_meeting)::int, 1) + interval '1 month - 1 day'))::int)) + 30 end
  end
  from (select date_trunc('month', p_period)::date as ms, (date_trunc('month', p_period) + interval '1 month')::date as nm,
               extract(year from p_period)::int as y) x
$$;

create or replace function private.filing_period_label(p_frequency text, p_code text, p_period date) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_code = 'sec_gis' then extract(year from p_period)::int || ' meeting'
    when p_frequency = 'monthly' then to_char(p_period, 'FMMonth YYYY')
    when p_frequency = 'quarterly' then 'Q' || ((extract(month from p_period)::int + 2) / 3) || ' ' || extract(year from p_period)::int
    else extract(year from p_period)::int::text end
$$;

-- Every filing that applies, for every set-up business (or one workspace), due between two dates.
create or replace function private.filing_obligations(p_org uuid, p_from date, p_to date)
returns table (org_id uuid, business_id uuid, business_name text, code text, period_start date, due_on date, tracking_from date)
language sql stable security definer set search_path = '' as $$
  select s.org_id, s.business_id, b.name, t.code, p.ps::date, d.due_on, s.tracking_from
  from public.filing_setup s
  join public.businesses b on b.id = s.business_id and b.deleted_at is null
  join public.orgs o on o.id = s.org_id and o.deleted_at is null
  join public.filing_types t on (
       (t.applies = 'employer' and s.has_employees)
    or (t.applies = 'withholding' and s.withholds)
    or (t.applies = 'vat' and s.tax_type = 'vat')
    or (t.applies = 'percentage' and s.tax_type = 'percentage')
    or (t.applies = 'individual' and b.structure = 'Sole Proprietorship')
    or (t.applies = 'corp' and b.structure in ('Corporation','Partnership'))
    or (t.applies = 'sec_gis' and b.structure = 'Corporation' and s.annual_meeting is not null))
  cross join lateral generate_series(date_trunc('month', p_from - interval '16 months'), date_trunc('month', p_to::timestamp), interval '1 month') as p(ps)
  cross join lateral (select private.filing_due(t.rule, p.ps::date, s.philhealth_digit,
                        coalesce(s.pagibig_group, private.pagibig_group(b.name)), s.annual_meeting) as due_on) d
  where (p_org is null or s.org_id = p_org)
    and not (t.code = any (s.paused_codes))
    and case t.frequency
          when 'monthly' then t.months is null or extract(month from p.ps)::int = any (t.months)
          when 'quarterly' then extract(month from p.ps)::int in (1,4,7,10)
                                and (t.quarters is null or ((extract(month from p.ps)::int + 2) / 3) = any (t.quarters))
          else extract(month from p.ps)::int = 1
        end
    and d.due_on between p_from and p_to
$$;
revoke all on function private.filing_obligations(uuid, date, date) from public, anon, authenticated;

-- The Taxes & contributions page: what is due (and what was filed) between two dates.
create or replace function public.filing_calendar(p_org uuid, p_from date, p_to date)
returns table (business_id uuid, business_name text, code text, period_start date, period_label text, due_on date, tracking_from date,
               record_id uuid, filed_on date, reference text, amount numeric, note text, filed_by uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_org is null or p_org not in (select private.my_org_ids()) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 800 then raise exception 'Choose a shorter date range.' using errcode = '22023'; end if;
  return query
    select o.business_id, o.business_name, o.code, o.period_start, private.filing_period_label(t.frequency, t.code, o.period_start),
      o.due_on, o.tracking_from, r.id, r.filed_on, r.reference, r.amount, r.note, r.filed_by
    from private.filing_obligations(p_org, p_from, p_to) o
    join public.filing_types t on t.code = o.code
    left join public.filing_records r on r.business_id = o.business_id and r.code = o.code and r.period_start = o.period_start
    where o.due_on >= o.tracking_from or r.id is not null
    order by o.due_on, t.sort, o.business_name;
end $$;
revoke all on function public.filing_calendar(uuid, date, date) from public, anon;
grant execute on function public.filing_calendar(uuid, date, date) to authenticated;

-- ================================================================ saving answers and records
create or replace function public.save_filing_setup(p_business uuid, p_has_employees boolean, p_withholds boolean, p_tax_type text,
  p_philhealth_digit smallint default null, p_pagibig_group text default null, p_annual_meeting date default null, p_paused text[] default '{}')
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select org_id into v_org from public.businesses where id = p_business and deleted_at is null;
  if v_org is null or v_org not in (select private.my_writable_org_ids()) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if coalesce(p_tax_type, '') not in ('vat','percentage','eight_percent','unsure') then raise exception 'Choose how the business pays business tax.' using errcode = '22023'; end if;
  if exists (select 1 from unnest(coalesce(p_paused, '{}')) c where c not in (select code from public.filing_types)) then
    raise exception 'Unknown filing.' using errcode = '22023';
  end if;
  insert into public.filing_setup as s (business_id, org_id, has_employees, withholds, tax_type, philhealth_digit, pagibig_group, annual_meeting, paused_codes, tracking_from)
  values (p_business, v_org, coalesce(p_has_employees, false), coalesce(p_withholds, false), p_tax_type, p_philhealth_digit, p_pagibig_group,
          p_annual_meeting, coalesce(p_paused, '{}'), private.today_ph() - 31)
  on conflict (business_id) do update set has_employees = excluded.has_employees, withholds = excluded.withholds, tax_type = excluded.tax_type,
    philhealth_digit = excluded.philhealth_digit, pagibig_group = excluded.pagibig_group, annual_meeting = excluded.annual_meeting,
    paused_codes = excluded.paused_codes, updated_by = auth.uid(), updated_at = now();
end $$;
revoke all on function public.save_filing_setup(uuid, boolean, boolean, text, smallint, text, date, text[]) from public, anon;
grant execute on function public.save_filing_setup(uuid, boolean, boolean, text, smallint, text, date, text[]) to authenticated;

-- Stop tracking taxes for a business. What was already recorded as filed is kept.
create or replace function public.remove_filing_setup(p_business uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.filing_setup where business_id = p_business and org_id in (select private.my_writable_org_ids())) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  delete from public.filing_setup where business_id = p_business;
end $$;
revoke all on function public.remove_filing_setup(uuid) from public, anon;
grant execute on function public.remove_filing_setup(uuid) to authenticated;

-- Record that a return or payment was filed (or correct the record).
create or replace function public.mark_filing(p_business uuid, p_code text, p_period date, p_filed_on date,
  p_reference text default null, p_amount numeric default null, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_bname text; v_t public.filing_types; v_due date; v_id uuid; v_label text;
begin
  select org_id, name into v_org, v_bname from public.businesses where id = p_business and deleted_at is null;
  if v_org is null or v_org not in (select private.my_writable_org_ids()) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  select * into v_t from public.filing_types where code = p_code;
  if v_t.code is null or p_period is null then raise exception 'Unknown filing.' using errcode = '22023'; end if;
  -- It must be one this business actually has for that period.
  select private.filing_due(v_t.rule, p_period, s.philhealth_digit, coalesce(s.pagibig_group, private.pagibig_group(v_bname)), s.annual_meeting)
    into v_due from public.filing_setup s where s.business_id = p_business;
  if v_due is null or not exists (select 1 from private.filing_obligations(v_org, v_due, v_due) o
                                  where o.business_id = p_business and o.code = p_code and o.period_start = p_period) then raise exception 'That filing is not on this business''s list. Refresh the page.' using errcode = '22023'; end if;
  if p_filed_on is null then raise exception 'Enter the date it was filed.' using errcode = '22023'; end if;
  if p_filed_on > private.today_ph() then raise exception 'The filing date can''t be in the future.' using errcode = '22023'; end if;
  if p_filed_on < p_period then raise exception 'The filing date is before the period it covers. Check the date.' using errcode = '22023'; end if;
  if p_amount is not null and p_amount < 0 then raise exception 'The amount can''t be negative.' using errcode = '22023'; end if;
  insert into public.filing_records as r (org_id, business_id, code, period_start, filed_on, reference, amount, note)
  values (v_org, p_business, p_code, p_period, p_filed_on, nullif(btrim(p_reference), ''), p_amount, nullif(btrim(p_note), ''))
  on conflict (business_id, code, period_start) do update set filed_on = excluded.filed_on, reference = excluded.reference,
    amount = excluded.amount, note = excluded.note, filed_by = auth.uid()
  returning id into v_id;
  v_label := private.filing_period_label(v_t.frequency, v_t.code, p_period);
  insert into public.audit_log (org_id, actor_id, entity, entity_id, action, summary, business_id)
  values (v_org, auth.uid(), 'filing_records', v_id, 'recorded',
    'Filed ' || case when v_t.agency in ('BIR','SEC') then v_t.agency || ' ' || v_t.form else v_t.name end || ' for ' || v_label || ' (' || v_bname || ')'
    || case when p_filed_on > v_due then ', ' || (p_filed_on - v_due) || ' days late' else '' end, p_business);
  return v_id;
end $$;
revoke all on function public.mark_filing(uuid, text, date, date, text, numeric, text) from public, anon;
grant execute on function public.mark_filing(uuid, text, date, date, text, numeric, text) to authenticated;

create or replace function public.unmark_filing(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_r public.filing_records; v_t public.filing_types; v_bname text;
begin
  select * into v_r from public.filing_records where id = p_id;
  if v_r.id is null or v_r.org_id not in (select private.my_writable_org_ids()) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  select * into v_t from public.filing_types where code = v_r.code;
  select name into v_bname from public.businesses where id = v_r.business_id;
  delete from public.filing_records where id = p_id;
  insert into public.audit_log (org_id, actor_id, entity, entity_id, action, summary, business_id)
  values (v_r.org_id, auth.uid(), 'filing_records', p_id, 'removed',
    'Marked ' || case when v_t.agency in ('BIR','SEC') then v_t.agency || ' ' || v_t.form else v_t.name end || ' for ' || private.filing_period_label(v_t.frequency, v_t.code, v_r.period_start)
    || ' as not filed (' || coalesce(v_bname, 'business') || ')', v_r.business_id);
end $$;
revoke all on function public.unmark_filing(uuid) from public, anon;
grant execute on function public.unmark_filing(uuid) to authenticated;

-- ================================================================ reminders
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('overdue','due_soon','help','team','billing','system','assigned','escalation','filing'));

-- Daily: a week before, the day before (and the day itself), then weekly for 8 weeks while not filed.
-- In-app for everyone who can edit; email for the week-before, day-before and first overdue notice.
create or replace function private.queue_filing_reminders() returns int
language plpgsql security definer set search_path = '' as $$
declare v_today date := private.today_ph(); v_n int := 0; v record;
begin
  for v in
    select o.*, t.agency, t.form, t.name as fname, t.frequency, m.user_id,
      case when o.due_on < v_today then 'over-' || ((v_today - o.due_on - 1) / 7)
           when o.due_on - v_today <= 1 then 'd1' else 'd7' end as stage
    from private.filing_obligations(null, v_today - 56, v_today + 7) o
    join public.filing_types t on t.code = o.code
    join public.org_members m on m.org_id = o.org_id and m.role <> 'viewer'
    left join public.notification_prefs np on np.user_id = m.user_id
    where o.due_on >= o.tracking_from and coalesce(np.business_alerts, true)
      and not exists (select 1 from public.filing_records r where r.business_id = o.business_id and r.code = o.code and r.period_start = o.period_start)
  loop
    perform private.notify(v.user_id, v.org_id, 'filing',
      case when v.agency in ('BIR','SEC') then v.agency || ' ' || v.form else v.fname end || ' for ' || private.filing_period_label(v.frequency, v.code, v.period_start)
        || case when v.due_on < v_today then ' is overdue' when v.due_on = v_today then ' is due today' else ' is due ' || private.fmt_date(v.due_on) end,
      v.business_name || ' - ' || v.fname || '. Mark it filed in PermitPal once it''s done.',
      '#/filings', null, 'fil:' || v.business_id || ':' || v.code || ':' || v.period_start || ':' || v.stage || ':' || v.user_id,
      v.stage in ('d7', 'd1', 'over-0'));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function private.queue_filing_reminders() from public, anon, authenticated;
select cron.schedule('pp-filing-reminders', '10 23 * * *', $$select private.queue_filing_reminders()$$);  -- 7:10am Manila

insert into private.features (name) values ('filings') on conflict do nothing;

-- ======================================================================== 20261017002000_sms_verified.sql
-- Text-message (SMS) reminders, only to mobile numbers the person has proved are theirs.
-- 1) Verifying a number: we text a 6-digit code (hashed here, 10 minutes, 5 tries, 5 codes a day).
-- 2) Every SMS in the outbox is checked on its way in: it must go to its owner's verified number, at most
--    3 a day per person, and under the monthly cap staff set (texts cost money). Anything else is kept in
--    the log as "skipped" with the reason, never silently dropped.
-- 3) Changing the number un-verifies it. Team plans include text reminders.

alter table public.profiles add column if not exists phone_verified_at timestamptz;

-- Only the verification functions can mark a number verified; changing the number clears it.
create or replace function private.profile_phone_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('pp.phone_rpc', true), 'off') = 'on' then return new; end if;
  if new.phone is distinct from old.phone then new.phone_verified_at := null;
  else new.phone_verified_at := old.phone_verified_at; end if;
  return new;
end $$;
drop trigger if exists profiles_phone_guard on public.profiles;
create trigger profiles_phone_guard before update on public.profiles for each row execute function private.profile_phone_guard();

create table if not exists private.phone_codes (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  phone         text not null,
  code_hash     text not null,
  expires_at    timestamptz not null,
  attempts      int not null default 0,
  sends         int not null default 1,
  first_sent_at timestamptz not null default now(),
  last_sent_at  timestamptz not null default now()
);

-- Philippine mobile numbers only, as +639XXXXXXXXX.
create or replace function private.ph_mobile(p text) returns text
language sql immutable set search_path = '' as $$
  select case
    when d ~ '^09\d{9}$' then '+63' || substr(d, 2)
    when d ~ '^9\d{9}$' then '+63' || d
    when d ~ '^639\d{9}$' then '+' || d
  end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
$$;

create or replace function public.start_phone_verification(p_phone text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_phone text := private.ph_mobile(p_phone); v_row private.phone_codes; v_code text; v_new_day boolean;
begin
  if v_uid is null then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if v_phone is null then raise exception 'Enter a Philippine mobile number, like 0917 123 4567.' using errcode = '22023'; end if;
  if coalesce((nullif(private.setting('channel_status'), '')::jsonb ->> 'sms'), 'false') <> 'true' then
    raise exception 'Text messages are not switched on yet. Please try again later.' using errcode = 'P0001';
  end if;
  select * into v_row from private.phone_codes where user_id = v_uid;
  if v_row.user_id is not null and v_row.last_sent_at > now() - interval '60 seconds' then
    raise exception 'Please wait a minute before asking for another code.' using errcode = 'P0001';
  end if;
  v_new_day := v_row.user_id is null or v_row.first_sent_at < now() - interval '1 day';
  if not v_new_day and v_row.sends >= 5 then
    raise exception 'Too many codes today. Please try again tomorrow.' using errcode = 'P0001';
  end if;
  v_code := lpad((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000)::text, 6, '0');
  insert into private.phone_codes as c (user_id, phone, code_hash, expires_at, attempts, sends, first_sent_at, last_sent_at)
  values (v_uid, v_phone, encode(extensions.digest(v_uid::text || ':' || v_code, 'sha256'), 'hex'), now() + interval '10 minutes', 0, 1, now(), now())
  on conflict (user_id) do update set phone = excluded.phone, code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0,
    sends = case when v_new_day then 1 else c.sends + 1 end, first_sent_at = case when v_new_day then now() else c.first_sent_at end, last_sent_at = now();
  insert into public.message_outbox (user_id, channel, to_address, body_text, dedupe_key)
  values (v_uid, 'sms', v_phone, 'PermitPal code: ' || v_code || '. It expires in 10 minutes. Never share this code with anyone.',
          'verify:' || v_uid || ':' || extract(epoch from clock_timestamp())::bigint);
  return jsonb_build_object('phone', v_phone, 'expires_at', now() + interval '10 minutes');
end $$;
revoke all on function public.start_phone_verification(text) from public, anon;
grant execute on function public.start_phone_verification(text) to authenticated;

create or replace function public.confirm_phone_code(p_code text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_row private.phone_codes;
begin
  if v_uid is null then raise exception 'Not allowed.' using errcode = '42501'; end if;
  select * into v_row from private.phone_codes where user_id = v_uid for update;
  if v_row.user_id is null or v_row.expires_at < now() then raise exception 'That code has expired. Ask for a new one.' using errcode = 'P0001'; end if;
  if v_row.attempts >= 5 then raise exception 'Too many wrong tries. Ask for a new code.' using errcode = 'P0001'; end if;
  if encode(extensions.digest(v_uid::text || ':' || regexp_replace(coalesce(p_code, ''), '\D', '', 'g'), 'sha256'), 'hex') <> v_row.code_hash then
    update private.phone_codes set attempts = attempts + 1 where user_id = v_uid;
    raise exception 'That code is not right. Check the text message and try again (% tries left).', 4 - v_row.attempts using errcode = 'P0001';
  end if;
  perform set_config('pp.phone_rpc', 'on', true);
  update public.profiles set phone = v_row.phone, phone_verified_at = now() where id = v_uid;
  perform set_config('pp.phone_rpc', 'off', true);
  insert into public.notification_prefs (user_id, sms_enabled) values (v_uid, true)
  on conflict (user_id) do update set sms_enabled = true;
  delete from private.phone_codes where user_id = v_uid;
  return v_row.phone;
end $$;
revoke all on function public.confirm_phone_code(text) from public, anon;
grant execute on function public.confirm_phone_code(text) to authenticated;

-- Stop texts and forget the number.
create or replace function public.remove_phone() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not allowed.' using errcode = '42501'; end if;
  perform set_config('pp.phone_rpc', 'on', true);
  update public.profiles set phone = null, phone_verified_at = null where id = auth.uid();
  perform set_config('pp.phone_rpc', 'off', true);
  update public.notification_prefs set sms_enabled = false where user_id = auth.uid();
  delete from private.phone_codes where user_id = auth.uid();
end $$;
revoke all on function public.remove_phone() from public, anon;
grant execute on function public.remove_phone() to authenticated;

-- ================================================================ every text is checked on its way out
alter table public.app_settings drop constraint if exists app_settings_key_check;
alter table public.app_settings add constraint app_settings_key_check check (key in ('gcash_name','gcash_number','bank_name','bank_account_name',
  'bank_account_number','payment_note','online_payments','support_phone','support_email','sms_monthly_cap'));
insert into public.app_settings (key, value) values ('sms_monthly_cap', '1000') on conflict (key) do nothing;

create or replace function private.outbox_sms_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_cap int;
begin
  if new.channel <> 'sms' or new.status <> 'queued' then return new; end if;
  if new.dedupe_key like 'verify:%' then return new; end if;  -- the code itself goes to the number being verified
  if new.user_id is null or not exists (select 1 from public.profiles p where p.id = new.user_id and p.phone = new.to_address and p.phone_verified_at is not null) then
    new.status := 'skipped'; new.last_error := 'Mobile number not verified'; return new;
  end if;
  if (select count(*) from public.message_outbox m where m.channel = 'sms' and m.user_id = new.user_id and m.status <> 'skipped'
        and m.created_at > now() - interval '1 day' and m.dedupe_key not like 'verify:%') >= 3 then
    new.status := 'skipped'; new.last_error := 'Daily text limit reached (3 a day)'; return new;
  end if;
  v_cap := coalesce(nullif((select value from public.app_settings where key = 'sms_monthly_cap'), '')::int, 1000);
  if (select count(*) from public.message_outbox m where m.channel = 'sms' and m.status <> 'skipped'
        and m.created_at >= date_trunc('month', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila') >= v_cap then
    new.status := 'skipped'; new.last_error := 'Monthly text limit reached'; return new;
  end if;
  new.body_text := left(new.body_text, 300);
  return new;
end $$;
drop trigger if exists message_outbox_sms_guard on public.message_outbox;
create trigger message_outbox_sms_guard before insert on public.message_outbox for each row execute function private.outbox_sms_guard();

-- Team plans include text reminders.
update public.plans set paid_channels = true where id in ('fleet', 'firm', 'head_office', 'property');

insert into private.features (name) values ('sms') on conflict do nothing;

-- ======================================================================== 20261017002100_two_step_login.sql
-- Two-step login (an authenticator app code after the password), using Supabase Auth's built-in TOTP.
-- 1) Owners can require it for their workspace. It is enforced in the database, not just the screen:
--    the membership helpers every access rule uses leave out a workspace that requires it until the
--    session has passed the second step (JWT claim aal = aal2).
-- 2) People locked out of such a workspace can see which one and why, so the app can walk them through.
-- 3) Lost phone: PermitPal staff can remove someone's two-step login after confirming who they are.
--    The person is told by email straight away, and every reset is logged.

alter table public.orgs add column if not exists require_mfa boolean not null default false;

create or replace function private.session_aal2() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
$$;

-- The membership helpers, now skipping workspaces that require two-step login when this session hasn't done it.
create or replace function private.my_org_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.org_id from public.org_members m join public.orgs o on o.id = m.org_id
  where m.user_id = (select auth.uid()) and (not o.require_mfa or (select private.session_aal2()))
$$;
create or replace function private.my_writable_org_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.org_id from public.org_members m join public.orgs o on o.id = m.org_id
  where m.user_id = (select auth.uid()) and m.role in ('owner','admin','member') and (not o.require_mfa or (select private.session_aal2()))
$$;
create or replace function private.my_admin_org_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.org_id from public.org_members m join public.orgs o on o.id = m.org_id
  where m.user_id = (select auth.uid()) and m.role in ('owner','admin') and (not o.require_mfa or (select private.session_aal2()))
$$;
create or replace function private.my_owner_org_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.org_id from public.org_members m join public.orgs o on o.id = m.org_id
  where m.user_id = (select auth.uid()) and m.role = 'owner' and (not o.require_mfa or (select private.session_aal2()))
$$;
create or replace function private.member_role(p_org uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.role from public.org_members m join public.orgs o on o.id = m.org_id
  where m.org_id = p_org and m.user_id = (select auth.uid()) and (not o.require_mfa or (select private.session_aal2()))
$$;

-- Which of my workspaces are closed to this session until two-step login is done (name only).
create or replace function public.my_locked_orgs() returns table (id uuid, name text)
language sql stable security definer set search_path = '' as $$
  select o.id, o.name from public.org_members m join public.orgs o on o.id = m.org_id
  where m.user_id = (select auth.uid()) and o.require_mfa and o.deleted_at is null and not (select private.session_aal2())
$$;
revoke all on function public.my_locked_orgs() from public, anon;
grant execute on function public.my_locked_orgs() to authenticated;

-- Owners switch the requirement on or off. To switch it on they must have done it themselves first,
-- so nobody locks themselves out.
create or replace function public.set_require_mfa(p_org uuid, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_name text; v_m record;
begin
  if p_org not in (select private.my_owner_org_ids()) then raise exception 'Only the owner can change this.' using errcode = '42501'; end if;
  if p_on and not private.session_aal2() then
    raise exception 'Turn on two-step login for yourself first (Settings → Two-step login), then try again.' using errcode = 'P0001';
  end if;
  update public.orgs set require_mfa = coalesce(p_on, false) where id = p_org returning name into v_name;
  if p_on then
    for v_m in select user_id from public.org_members where org_id = p_org and user_id <> auth.uid() loop
      perform private.notify(v_m.user_id, p_org, 'team', v_name || ' now requires two-step login',
        'Next time you open it, you will be asked to set up an authenticator app (about 2 minutes).',
        '#/settings', null, 'mfareq:' || p_org || ':' || v_m.user_id || ':' || extract(epoch from now())::bigint, true);
    end loop;
  end if;
end $$;
revoke all on function public.set_require_mfa(uuid, boolean) from public, anon;
grant execute on function public.set_require_mfa(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------- lost phone: staff reset
create table if not exists private.mfa_resets (
  id          bigint generated always as identity primary key,
  user_id     uuid not null,
  email       text not null,
  staff_id    uuid,
  reason      text not null,
  factors     int not null,
  created_at  timestamptz not null default now()
);

create or replace function public.admin_reset_mfa(p_email text, p_reason text) returns int
language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_n int;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'Write how you confirmed who they are (at least a short sentence).' using errcode = '22023'; end if;
  select id into v_user from auth.users where lower(email) = lower(btrim(p_email));
  if v_user is null then raise exception 'No account with that email.' using errcode = 'P0002'; end if;
  if v_user = auth.uid() then raise exception 'Ask another staff member to reset your own two-step login.' using errcode = 'P0001'; end if;
  delete from auth.mfa_factors where user_id = v_user;
  get diagnostics v_n = row_count;
  insert into private.mfa_resets (user_id, email, staff_id, reason, factors) values (v_user, lower(btrim(p_email)), auth.uid(), btrim(p_reason), v_n);
  perform private.notify(v_user, null, 'system', 'Two-step login was turned off for your account',
    'PermitPal support removed your authenticator app after confirming your identity. Sign in with your password and set up two-step login again. If you did not ask for this, contact us right away.',
    '#/settings', null, 'mfareset:' || v_user || ':' || extract(epoch from now())::bigint, true);
  return v_n;
end $$;
revoke all on function public.admin_reset_mfa(text, text) from public, anon;
grant execute on function public.admin_reset_mfa(text, text) to authenticated;

insert into private.features (name) values ('mfa') on conflict do nothing;

commit;
