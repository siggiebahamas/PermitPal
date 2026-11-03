-- Database file 25 (government office and legal clock on every order; who is responsible at each step). Run once, in the
-- Supabase SQL Editor, after file 24. All or nothing: if anything fails, nothing is changed.
begin;

do $$ declare v_prev boolean := false; v_done boolean := false; begin
  if to_regclass('private.features') is not null then
    execute $q$select exists (select 1 from private.features where name = 'payproof'), exists (select 1 from private.features where name = 'govclock')$q$ into v_prev, v_done;
  end if;
  if not v_prev then raise exception 'Run supabase/manual/2026-11-10-no-texts-plan-proof.sql first, then run this file. Nothing was changed.'; end if;
  if v_done then raise exception 'This file was already run. Nothing was changed.'; end if;
end $$;

-- ======================================================================== 20261111001000_gov_clock.sql
-- ======================================================================== the office behind each service
alter table public.services
  add column if not exists agency text check (agency is null or length(agency) <= 120),
  add column if not exists agency_days int check (agency_days is null or agency_days between 1 and 60);
update public.services set agency = v.agency, agency_days = v.days from (values
  ('renew_dti_business_name', 'DTI (Business Name Registration System)', 3),
  ('filing_sec_gis', 'SEC (eFAST)', 3),
  ('renew_philgeps', 'PhilGEPS (Procurement Service, DBM)', 7),
  ('adv_philgeps', 'PhilGEPS (Procurement Service, DBM)', 7),
  ('apply_dole_registration', 'DOLE regional office', 7),
  ('adv_employer_registration', 'SSS, PhilHealth and Pag-IBIG', 7)
) v(code, agency, days) where services.code = v.code;

-- What each service promises is only OUR part (preparing and filing). The office's own time is shown separately.
update public.services set turnaround = v.t from (values
  ('renew_dti_business_name', 'We file within 1 working day of complete papers and payment'),
  ('filing_sec_gis', 'We file within 2 working days of your signed GIS'),
  ('renew_philgeps', 'We file within 2 working days of complete papers and payment'),
  ('adv_philgeps', 'We file within 2 working days of complete papers and payment'),
  ('apply_dole_registration', 'We file within 2 working days of complete papers and payment'),
  ('adv_employer_registration', 'We file within 3 working days of complete papers and payment')
) v(code, t) where services.code = v.code;

-- ======================================================================== the order: filed, with whom, and the clock
alter table public.assistance_requests
  add column if not exists agency text check (agency is null or length(agency) <= 120),
  add column if not exists agency_days int check (agency_days is null or agency_days between 1 and 60),
  add column if not exists agency_ref text check (agency_ref is null or length(agency_ref) <= 120),
  add column if not exists filed_on date,
  add column if not exists agency_due_on date,
  add column if not exists gov_terms_at timestamptz;
-- A filed order stays 'in_progress' with filed_on set: the office has it. (No new status, so nothing else changes.)
-- Customers can't rewrite the filing details (staff and the order functions can).
create or replace function private.assistance_lock_filed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not private.is_platform_admin() then
    new.agency := old.agency; new.agency_days := old.agency_days; new.agency_ref := old.agency_ref;
    new.filed_on := old.filed_on; new.agency_due_on := old.agency_due_on;
    if coalesce(current_setting('pp.gov_terms', true), '') <> 'on' then new.gov_terms_at := old.gov_terms_at; end if;
  end if;
  return new;
end $$;
create or replace trigger assistance_lock_filed before update on public.assistance_requests for each row execute function private.assistance_lock_filed();

create or replace function private.help_status_label(s text) returns text
language sql immutable set search_path = '' as $$
  select case s
    when 'submitted' then 'Preparing your quote'
    when 'quoted' then 'Quote ready'
    when 'matching' then 'Finding a provider'
    when 'provider_contacted' then 'Provider contacted'
    when 'awaiting_customer' then 'Waiting for you'
    when 'in_progress' then 'Pinoy Permit is preparing and filing'
    when 'completed' then 'Completed'
    when 'cancelled' then 'Cancelled'
    else s end
$$;

-- The customer, before paying: "once filed, the office's speed and decision are the office's".
create or replace function public.accept_gov_terms(p_req uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('pp.gov_terms', 'on', true);
  update public.assistance_requests set gov_terms_at = coalesce(gov_terms_at, now())
   where id = p_req and org_id in (select private.my_writable_org_ids());
  if not found then raise exception 'Request not found.' using errcode = '42501'; end if;
  perform set_config('pp.gov_terms', '', true);
end $$;
revoke all on function public.accept_gov_terms(uuid) from public, anon;
grant execute on function public.accept_gov_terms(uuid) to authenticated;

-- Staff: "Filed". Our part ends here; the office's legal clock starts. Saves the agency receipt on the order,
-- starts the clock on the permit too (if the order is for one permit), and tells the customer, by email as well.
create or replace function public.admin_mark_filed(p_req uuid, p_agency text, p_days int, p_filed_on date, p_ref text default null,
  p_file_path text default null, p_file_name text default null) returns date
language plpgsql security definer set search_path = '' as $$
declare a public.assistance_requests; v_due date; v_today date := private.today_ph(); v_msg text;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select * into a from public.assistance_requests where id = p_req for update;
  if a.id is null then raise exception 'Request not found.' using errcode = 'P0002'; end if;
  if a.status in ('completed','cancelled') then raise exception 'This order is closed.' using errcode = 'P0001'; end if;
  if length(btrim(coalesce(p_agency, ''))) not between 2 and 120 then raise exception 'Which government office did you file with?' using errcode = '22023'; end if;
  if p_days is null or p_days not between 1 and 60 then raise exception 'Enter the office''s processing time in working days (1 to 60).' using errcode = '22023'; end if;
  if p_filed_on is null or p_filed_on > v_today or p_filed_on < v_today - 60 then raise exception 'Enter the day it was filed (in the last 60 days).' using errcode = '22023'; end if;
  if length(coalesce(p_ref, '')) > 120 then raise exception 'That reference number is too long.' using errcode = '22023'; end if;
  if p_file_path is not null and split_part(p_file_path, '/', 1) <> a.org_id::text then raise exception 'Invalid file location.' using errcode = '42501'; end if;
  v_due := private.add_workdays(p_filed_on, p_days);
  update public.assistance_requests set status = 'in_progress', agency = btrim(p_agency), agency_days = p_days, filed_on = p_filed_on,
    agency_ref = nullif(btrim(p_ref), ''), agency_due_on = v_due where id = a.id;
  v_msg := 'Filed with ' || btrim(p_agency) || ' on ' || private.fmt_date(p_filed_on) || coalesce(' (reference ' || nullif(btrim(p_ref), '') || ')', '') || '. '
    || 'Pinoy Permit''s part is done. From here, ' || btrim(p_agency) || ' is responsible for processing and for its decision. '
    || 'By law it should act within ' || p_days || ' working days, by ' || private.fmt_date(v_due) || '. Pinoy Permit cannot speed up or decide for a government office, '
    || 'and is not responsible for its delays, decisions or responses.';
  perform private.order_event(a.id, 'status', v_msg, p_file_path, p_file_name);
  if a.requirement_id is not null and exists (select 1 from public.requirements r where r.id = a.requirement_id and r.deleted_at is null)
     and not exists (select 1 from public.office_filings where requirement_id = a.requirement_id and status = 'waiting') then
    insert into public.office_filings (org_id, requirement_id, request_id, office, reference_no, filed_on, kind, days)
    values (a.org_id, a.requirement_id, a.id, btrim(p_agency), nullif(btrim(p_ref), ''), p_filed_on, 'charter', p_days);
  end if;
  if a.created_by is not null then
    perform private.notify(a.created_by, a.org_id, 'help', 'Filed with ' || btrim(p_agency) || ': now with the government office', v_msg,
      '#/services/orders/' || a.id, a.requirement_id, 'orderfiled:' || a.id, true);
  end if;
  return v_due;
end $$;
revoke all on function public.admin_mark_filed(uuid, text, int, date, text, text, text) from public, anon;
grant execute on function public.admin_mark_filed(uuid, text, int, date, text, text, text) to authenticated;

-- ======================================================================== no promises about what offices do
-- Pinoy Permit does not follow up with offices on anyone's behalf: the messages say whose responsibility it is, nothing more.
create or replace function public.admin_start_filing(p_request uuid, p_office text, p_reference text, p_filed_on date, p_kind text, p_days int default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare a public.assistance_requests; f public.office_filings; v_today date := private.today_ph();
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  perform private.clock_ready();
  select * into a from public.assistance_requests where id = p_request;
  if a.id is null then raise exception 'Request not found.' using errcode = 'P0002'; end if;
  if a.status in ('completed','cancelled') then raise exception 'This request is closed.' using errcode = 'P0001'; end if;
  if a.requirement_id is null or not exists (select 1 from public.requirements r where r.id = a.requirement_id and r.deleted_at is null) then
    raise exception 'This request isn''t for one permit, so there''s no clock to start.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.office_filings where requirement_id = a.requirement_id and status = 'waiting') then
    raise exception 'The clock is already running for this permit.' using errcode = 'P0001';
  end if;
  if length(btrim(coalesce(p_office, ''))) not between 2 and 160 then raise exception 'Which office did you file with?' using errcode = '22023'; end if;
  if length(coalesce(p_reference, '')) > 120 then raise exception 'That reference number is too long.' using errcode = '22023'; end if;
  if p_filed_on is null or p_filed_on > v_today or p_filed_on < v_today - 60 then raise exception 'Enter the day you filed (in the last 60 days).' using errcode = '22023'; end if;
  if coalesce(p_kind, '') not in ('simple','complex','technical','charter') then raise exception 'Choose the processing time.' using errcode = '22023'; end if;
  if p_kind = 'charter' and (p_days is null or p_days not between 1 and 60) then raise exception 'Enter the working days in the Citizen''s Charter (1 to 60).' using errcode = '22023'; end if;
  insert into public.office_filings (org_id, requirement_id, request_id, office, reference_no, filed_on, kind, days)
  values (a.org_id, a.requirement_id, a.id, btrim(p_office), nullif(btrim(p_reference), ''), p_filed_on, p_kind, coalesce(p_days, 3))
  returning * into f;
  perform private.order_event(a.id, 'status', 'Filed with ' || f.office || coalesce(' (reference ' || f.reference_no || ')', '') || ' on '
    || private.fmt_date(f.filed_on) || '. By law the office has until ' || private.fmt_date(f.due_on) || ' to act. Pinoy Permit''s part is done: from here the office is responsible for processing and for its decision.');
  perform private.req_activity(a.requirement_id, 'office_filing', f.id, 'clock_start',
    'Pinoy Permit filed with ' || f.office || ' on ' || private.fmt_date(f.filed_on) || '. By law it has until ' || private.fmt_date(f.due_on) || '.');
  return f.id;
end $$;

-- ================================================================ every morning, 7:30 am Manila
create or replace function private.clock_daily() returns int
language plpgsql security definer set search_path = '' as $$
declare v_today date := private.today_ph(); v_n int := 0; f record; b record;
begin
  if exists (select 1 from private.features where name = 'clock') then
    -- an office ran past its legal deadline: tell the business once (and staff, for orders they filed)
    for f in select x.* from public.office_filings x join public.orgs o on o.id = x.org_id and o.deleted_at is null
             where x.status = 'waiting' and x.due_on < v_today and x.late_noticed_at is null for update of x loop
      perform private.notify_req(f.requirement_id, 'system', f.office || ' is past its deadline',
        'By law it had until ' || private.fmt_date(f.due_on) || ' to act on ' || coalesce(private.requirement_label(f.requirement_id), 'your permit')
          || ' (filed ' || private.fmt_date(f.filed_on) || coalesce(', ref ' || f.reference_no, '') || ').'
          || ' The delay is the office''s responsibility. If you wish, open the permit for a follow-up letter you can send yourself.',
        '#/requirement/' || f.requirement_id, 'clocklate:' || f.id || ':' || f.due_on);
      if f.request_id is not null then
        perform private.notify_admins('Office late on an order: ' || f.office, coalesce(private.requirement_label(f.requirement_id), '') || ', due '
          || private.fmt_date(f.due_on) || '.', 'clocklate:' || f.id || ':' || f.due_on, true);
      end if;
      update public.office_filings set late_noticed_at = now() where id = f.id;
      v_n := v_n + 1;
    end loop;
  end if;
  if exists (select 1 from private.features where name = 'billpay') then
    -- bills to pay soon: 3 days before and on the day
    for b in select x.* from public.gov_bills x join public.orgs o on o.id = x.org_id and o.deleted_at is null
             where x.status = 'due' and x.pay_by is not null and x.pay_by - v_today in (3, 0) loop
      perform private.notify_req(b.requirement_id, 'billing',
        case when b.pay_by = v_today then 'Pay ' || b.office || ' today' else 'Pay ' || b.office || ' by ' || private.fmt_date(b.pay_by) end,
        'Bill ' || b.number || coalesce(' (' || b.bill_ref || ')', '') || ': ' || private.peso(b.amount_php) || '.'
          || case when b.mode = 'permitpal' then ' Send Pinoy Permit ' || private.peso(b.amount_php + b.fee_php) || ' and we pay it for you.'
                  else ' Late payments can add a surcharge and interest.' end,
        '#/requirement/' || b.requirement_id, 'billdue:' || b.id || ':' || (b.pay_by - v_today));
      v_n := v_n + 1;
    end loop;
    -- bills Pinoy Permit was asked to pay, never sent: closed after 14 days
    update public.gov_bills set status = 'cancelled', note = 'Not paid within 14 days, so we closed it. Add the bill again anytime.'
    where mode = 'permitpal' and status = 'due' and created_at < now() - interval '14 days';
    -- a bill we hold the money for and haven't paid by our deadline: remind staff every morning
    for b in select x.* from public.gov_bills x where x.status = 'processing' and x.pay_deadline < now() loop
      perform private.notify_admins('Late: pay city bill ' || b.number, b.office || ' ' || private.peso(b.amount_php) || coalesce(', the office''s due date is '
        || private.fmt_date(b.pay_by), '') || '. We promised to pay by ' || to_char(b.pay_deadline at time zone 'Asia/Manila', 'Mon FMDD, FMHH12 pm') || '.',
        'billlate:' || b.id || ':' || v_today, true);
    end loop;
  end if;
  return v_n;
end $$;

insert into private.features (name) values ('govclock') on conflict do nothing;

commit;
