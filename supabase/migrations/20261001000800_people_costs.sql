-- Staff licences (people), renewal costs, and the status view / reminders updated to include them.

-- ================================================================ people (staff licences)
create table public.people (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  full_name   text not null check (length(btrim(full_name)) between 1 and 160),
  role_title  text not null default '' check (length(role_title) <= 120),
  business_id uuid references public.businesses(id) on delete set null,
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index people_org_idx on public.people(org_id);
create trigger people_touch before update on public.people for each row execute function private.touch_updated_at();

alter table public.people enable row level security;
create policy people_read on public.people for select to authenticated using (org_id in (select private.my_org_ids()));
create policy people_insert on public.people for insert to authenticated with check (org_id in (select private.my_writable_org_ids()));
create policy people_update on public.people for update to authenticated
  using (org_id in (select private.my_writable_org_ids())) with check (org_id in (select private.my_writable_org_ids()));
revoke delete on public.people from anon, authenticated;
revoke all on public.people from anon;

alter table public.requirement_types drop constraint requirement_types_subject_check;
alter table public.requirement_types add constraint requirement_types_subject_check check (subject in ('business','vehicle','person'));

alter table public.requirements add column person_id uuid references public.people(id) on delete cascade;
create index requirements_person_idx on public.requirements(person_id);
alter table public.requirements drop constraint requirements_subject_check;
alter table public.requirements add constraint requirements_subject_check check (subject in ('business','vehicle','person'));
alter table public.requirements drop constraint requirements_check;
alter table public.requirements add constraint requirements_check check (
  (subject = 'business' and business_id is not null and vehicle_id is null and person_id is null)
  or (subject = 'vehicle' and vehicle_id is not null and business_id is null and location_id is null and person_id is null)
  or (subject = 'person' and person_id is not null and business_id is null and vehicle_id is null and location_id is null));
create unique index requirements_unique_person_type on public.requirements (person_id, type_code)
  where deleted_at is null and subject = 'person' and type_code is not null;
drop index public.requirements_unique_custom;
create unique index requirements_unique_custom on public.requirements (coalesce(business_id, vehicle_id, person_id), location_id, lower(btrim(name))) nulls not distinct
  where deleted_at is null and type_code is null;

-- Licences people carry. Nothing is assumed: expiry dates come from the licence itself.
insert into public.requirement_types
  (code, name, subject, agency, expires, due_rule, per_location, activities, structures, confidence, auto_add, help_text, sort) values
  ('drivers_license', 'Driver''s License', 'person', 'LTO', true, 'manual', false, null, null, 'confirmed', false,
     'Enter the expiry date printed on the card. Renewal needs the driver in person at LTO.', 10),
  ('prc_license', 'PRC Professional License', 'person', 'PRC', true, 'manual', false, null, null, 'confirmed', false,
     'Enter the validity date printed on the ID.', 20),
  ('health_certificate', 'Health Certificate / Health Card', 'person', 'City or municipal health office', true, 'manual', false, null, null, 'confirmed', false,
     'Needed for staff who handle food or work in health-related businesses. Enter the expiry date on the card.', 30),
  ('nbi_clearance', 'NBI Clearance', 'person', 'NBI', true, 'manual', false, null, null, 'confirmed', false,
     'Enter the validity date printed on the clearance.', 40),
  ('comprehensive_insurance', 'Comprehensive Car Insurance', 'vehicle', 'Insurance provider', true, 'manual', false, null, null, 'confirmed', false,
     'Optional cover on top of CTPL. Enter the policy end date.', 50);

-- ================================================================ renewal costs
alter table public.requirement_cycles add column amount_paid numeric(12,2) check (amount_paid is null or amount_paid >= 0);

-- ================================================================ status view (people + cost)
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
  c.amount_paid
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

-- ================================================================ people: creation, labels, history
create or replace function private.requirement_label(p_req uuid) returns text
language sql stable security definer set search_path = '' as $$
  select '"' || r.name || '" for ' ||
    coalesce(b.name || case when l.id is not null and not l.is_main then ' (' || l.name || ')' else '' end,
             private.vehicle_label(r.vehicle_id), pe.full_name, 'a deleted record')
  from public.requirements r
  left join public.businesses b on b.id = r.business_id
  left join public.business_locations l on l.id = r.location_id
  left join public.people pe on pe.id = r.person_id
  where r.id = p_req
$$;

create function private.audit_people() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_action text; v_summary text;
begin
  if coalesce(current_setting('pp.quiet_audit', true), 'off') = 'on' then return null; end if;
  if tg_op = 'INSERT' then v_action := 'created';
  elsif old.deleted_at is null and new.deleted_at is not null then v_action := 'deleted';
  elsif old.deleted_at is not null and new.deleted_at is null then v_action := 'restored';
  elsif (to_jsonb(old) - 'updated_at') = (to_jsonb(new) - 'updated_at') then return null;
  else v_action := 'updated';
  end if;
  v_summary := case v_action
    when 'created' then 'Added person "' || new.full_name || '"'
    when 'deleted' then 'Deleted person "' || new.full_name || '"'
    when 'restored' then 'Restored person "' || new.full_name || '"'
    else 'Updated person "' || new.full_name || '"' end;
  insert into public.audit_log (org_id, actor_id, entity, entity_id, action, summary, old_data, new_data)
  values (new.org_id, auth.uid(), 'people', new.id, v_action, v_summary,
          case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new));
  return null;
end $$;
create trigger people_audit after insert or update on public.people for each row execute function private.audit_people();

create function public.create_person(p_org uuid, p_full_name text, p_role text default '', p_business uuid default null, p_types text[] default null)
returns uuid
language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.people (org_id, full_name, role_title, business_id)
  values (p_org, btrim(p_full_name), coalesce(btrim(p_role), ''), p_business) returning id into v_id;
  perform set_config('pp.quiet_audit', 'on', true);
  insert into public.requirements (org_id, subject, person_id, type_code, name, expires, confidence)
  select p_org, 'person', v_id, t.code, t.name, t.expires, 'confirmed'
  from public.requirement_types t where t.subject = 'person' and t.code = any(coalesce(p_types, array[]::text[])) order by t.sort;
  perform set_config('pp.quiet_audit', 'off', true);
  return v_id;
end $$;
revoke execute on function public.create_person(uuid,text,text,uuid,text[]) from public, anon;
grant execute on function public.create_person(uuid,text,text,uuid,text[]) to authenticated;

create or replace function public.add_requirement(
  p_subject text, p_subject_id uuid, p_location uuid default null, p_type_code text default null,
  p_name text default null, p_expires boolean default null,
  p_reference_no text default null, p_issuer text default null, p_issued_on date default null, p_expires_on date default null
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_org uuid;
  v_type public.requirement_types;
  v_req uuid;
  v_cycle uuid;
begin
  if p_subject = 'business' then
    select org_id into v_org from public.businesses where id = p_subject_id and deleted_at is null;
  elsif p_subject = 'vehicle' then
    select org_id into v_org from public.vehicles where id = p_subject_id and deleted_at is null;
  elsif p_subject = 'person' then
    select org_id into v_org from public.people where id = p_subject_id and deleted_at is null;
  end if;
  if v_org is null then raise exception 'That business, vehicle or person was not found.' using errcode = '23503'; end if;

  if p_type_code is not null then
    select * into v_type from public.requirement_types where code = p_type_code and subject = p_subject;
    if v_type.code is null then raise exception 'Unknown requirement type.' using errcode = '22023'; end if;
  elsif coalesce(btrim(p_name), '') = '' then
    raise exception 'Please describe the requirement.' using errcode = '22023';
  end if;

  insert into public.requirements (org_id, subject, business_id, location_id, vehicle_id, person_id, type_code, name, expires, confidence)
  values (
    v_org, p_subject,
    case when p_subject = 'business' then p_subject_id end,
    case when p_subject = 'business' then p_location end,
    case when p_subject = 'vehicle' then p_subject_id end,
    case when p_subject = 'person' then p_subject_id end,
    v_type.code,
    coalesce(nullif(btrim(p_name), ''), v_type.name),
    coalesce(p_expires, v_type.expires, true),
    'confirmed')
  returning id into v_req;

  if nullif(btrim(p_reference_no), '') is not null or nullif(btrim(p_issuer), '') is not null
     or p_issued_on is not null or p_expires_on is not null then
    insert into public.requirement_cycles (org_id, requirement_id, reference_no, issuer, issued_on, expires_on)
    values (v_org, v_req, nullif(btrim(p_reference_no), ''), nullif(btrim(p_issuer), ''), p_issued_on, p_expires_on)
    returning id into v_cycle;
  end if;
  return jsonb_build_object('requirement_id', v_req, 'cycle_id', v_cycle);
end $$;

-- ================================================================ consistency checks now cover people
create or replace function private.check_org_consistency() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.org_id is distinct from old.org_id then
    raise exception 'Records cannot be moved between workspaces.' using errcode = '42501';
  end if;

  if tg_table_name = 'business_locations' then
    if not exists (select 1 from public.businesses b where b.id = new.business_id and b.org_id = new.org_id) then
      raise exception 'That business was not found.' using errcode = '23503';
    end if;
  elsif tg_table_name = 'vehicles' then
    if new.business_id is not null and not exists (select 1 from public.businesses b where b.id = new.business_id and b.org_id = new.org_id) then
      raise exception 'That business was not found.' using errcode = '23503';
    end if;
  elsif tg_table_name = 'people' then
    if new.business_id is not null and not exists (select 1 from public.businesses b where b.id = new.business_id and b.org_id = new.org_id) then
      raise exception 'That business was not found.' using errcode = '23503';
    end if;
  elsif tg_table_name = 'requirements' then
    if new.person_id is not null and not exists (select 1 from public.people p where p.id = new.person_id and p.org_id = new.org_id) then
      raise exception 'That person was not found.' using errcode = '23503';
    end if;
    if new.business_id is not null and not exists (select 1 from public.businesses b where b.id = new.business_id and b.org_id = new.org_id) then
      raise exception 'That business was not found.' using errcode = '23503';
    end if;
    if new.location_id is not null and not exists (
         select 1 from public.business_locations l where l.id = new.location_id and l.business_id = new.business_id) then
      raise exception 'That branch does not belong to this business.' using errcode = '23503';
    end if;
    if new.vehicle_id is not null and not exists (select 1 from public.vehicles v where v.id = new.vehicle_id and v.org_id = new.org_id) then
      raise exception 'That vehicle was not found.' using errcode = '23503';
    end if;
  elsif tg_table_name = 'requirement_cycles' then
    if not exists (select 1 from public.requirements r where r.id = new.requirement_id and r.org_id = new.org_id) then
      raise exception 'That requirement was not found.' using errcode = '23503';
    end if;
  elsif tg_table_name = 'documents' then
    if not exists (select 1 from public.requirements r where r.id = new.requirement_id and r.org_id = new.org_id) then
      raise exception 'That requirement was not found.' using errcode = '23503';
    end if;
    if new.cycle_id is not null and not exists (
         select 1 from public.requirement_cycles c where c.id = new.cycle_id and c.requirement_id = new.requirement_id) then
      raise exception 'That record does not belong to this requirement.' using errcode = '23503';
    end if;
    if tg_op = 'INSERT' and split_part(new.storage_path, '/', 1) <> new.org_id::text then
      raise exception 'Invalid file location.' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and new.storage_path is distinct from old.storage_path then
      raise exception 'Files cannot be moved.' using errcode = '42501';
    end if;
  elsif tg_table_name = 'assistance_requests' then
    if new.requirement_id is not null and not exists (select 1 from public.requirements r where r.id = new.requirement_id and r.org_id = new.org_id) then
      raise exception 'That requirement was not found.' using errcode = '23503';
    end if;
    if new.business_id is not null and not exists (select 1 from public.businesses b where b.id = new.business_id and b.org_id = new.org_id) then
      raise exception 'That business was not found.' using errcode = '23503';
    end if;
    if new.vehicle_id is not null and not exists (select 1 from public.vehicles v where v.id = new.vehicle_id and v.org_id = new.org_id) then
      raise exception 'That vehicle was not found.' using errcode = '23503';
    end if;
    if new.person_id is not null and not exists (select 1 from public.people p where p.id = new.person_id and p.org_id = new.org_id) then
      raise exception 'That person was not found.' using errcode = '23503';
    end if;
  elsif tg_table_name in ('referrals', 'compliance_shares') then
    null;
  end if;
  return new;
end $$;

create trigger people_consistency before insert or update on public.people for each row execute function private.check_org_consistency();

-- ================================================================ reminders now include people's licences
create or replace function private.queue_due_reminders() returns int
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
