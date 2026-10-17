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
