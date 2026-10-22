-- PermitPal processing clock and city bills: counts each office's legal processing time and drafts the follow-up
-- letter and ARTA complaint when it runs late; and keeps the city's bills, with PermitPal paying them on request.
-- All or nothing: if anything fails, nothing is changed.
--
-- Order matters: run 2026-10-26-load.sql first, then this file, once.
begin;

do $$ declare v_prev boolean := false; v_done boolean := false; begin
  if to_regclass('private.features') is not null then
    execute $q$select exists (select 1 from private.features where name = 'load'), exists (select 1 from private.features where name = 'clock')$q$ into v_prev, v_done;
  end if;
  if not v_prev then raise exception 'Run supabase/manual/2026-10-26-load.sql first, then run this file. Nothing was changed.'; end if;
  if v_done then raise exception 'This file was already run. Nothing was changed.'; end if;
end $$;

-- ======================================================================== 20261027001000_clock_bills.sql
-- PermitPal: the processing clock and bill-to-paid.
-- 1) Processing clock. When a business hands in an application or renewal, PermitPal counts the office's
--    legal processing time in working days (Ease of Doing Business law, RA 11032: 3 working days for simple
--    transactions, 7 for complex, 20 for highly technical, or the shorter time in the office's Citizen's
--    Charter), skipping weekends and national holidays. The office may extend once, for the same number of
--    days, if it says so in writing before the deadline. When the time runs out, the business is told, and the
--    app drafts a polite follow-up letter to the office and, if that doesn't work, a complaint to the
--    Anti-Red Tape Authority (ARTA). PermitPal staff start the clock on done-for-you orders they file.
-- 2) Bill-to-paid. The business snaps the office's bill (tax bill, statement of account, order of payment).
--    Either it keeps the bill on record and adds the official receipt after paying, or PermitPal pays it: the
--    business sends PermitPal the bill plus a small fee once (GCash, Maya or bank transfer), staff pay the
--    office by 6 pm the next business day after confirming, and the official receipt is filed on the permit.
--    If PermitPal can't pay it, everything is sent back.

-- ================================================================ national holidays (offices are closed)
create table if not exists public.ph_holidays (
  day  date primary key,
  name text not null check (length(name) between 1 and 80),
  kind text not null default 'regular' check (kind in ('regular','special'))
);
alter table public.ph_holidays enable row level security;
drop policy if exists ph_holidays_read on public.ph_holidays;
create policy ph_holidays_read on public.ph_holidays for select to authenticated using (true);
revoke insert, update, delete on public.ph_holidays from anon, authenticated;
revoke all on public.ph_holidays from anon;
grant select on public.ph_holidays to authenticated;
-- Proclamation No. 1006 (2026, from November) and No. 1427 (2027). Eid'l Fitr and Eid'l Adha are declared
-- separately each year: staff add them (and any other day off) in Admin > Bills & clock.
insert into public.ph_holidays (day, name, kind) values
  ('2026-11-01', 'All Saints'' Day', 'special'), ('2026-11-02', 'All Souls'' Day', 'special'),
  ('2026-11-30', 'Bonifacio Day', 'regular'), ('2026-12-08', 'Feast of the Immaculate Conception', 'special'),
  ('2026-12-24', 'Christmas Eve', 'special'), ('2026-12-25', 'Christmas Day', 'regular'),
  ('2026-12-30', 'Rizal Day', 'regular'), ('2026-12-31', 'Last Day of the Year', 'special'),
  ('2027-01-01', 'New Year''s Day', 'regular'), ('2027-02-06', 'Chinese New Year', 'special'),
  ('2027-03-25', 'Maundy Thursday', 'regular'), ('2027-03-26', 'Good Friday', 'regular'), ('2027-03-27', 'Black Saturday', 'special'),
  ('2027-04-09', 'Araw ng Kagitingan', 'regular'), ('2027-05-01', 'Labor Day', 'regular'), ('2027-06-12', 'Independence Day', 'regular'),
  ('2027-08-21', 'Ninoy Aquino Day', 'special'), ('2027-08-30', 'National Heroes Day', 'regular'),
  ('2027-11-01', 'All Saints'' Day', 'special'), ('2027-11-02', 'All Souls'' Day', 'special'), ('2027-11-30', 'Bonifacio Day', 'regular'),
  ('2027-12-08', 'Feast of the Immaculate Conception', 'special'), ('2027-12-24', 'Christmas Eve', 'special'),
  ('2027-12-25', 'Christmas Day', 'regular'), ('2027-12-30', 'Rizal Day', 'regular'), ('2027-12-31', 'Last Day of the Year', 'special')
on conflict (day) do nothing;

create or replace function private.is_workday(p_day date) returns boolean
language sql stable security definer set search_path = '' as $$
  select extract(isodow from p_day) < 6 and not exists (select 1 from public.ph_holidays h where h.day = p_day)
$$;
-- The day the office's time runs out: the nth working day after p_from (the day you filed doesn't count).
create or replace function private.add_workdays(p_from date, p_days int) returns date
language plpgsql stable security definer set search_path = '' as $$
declare d date := p_from; n int := 0;
begin
  if p_from is null then return null; end if;
  while n < least(greatest(coalesce(p_days, 0), 0), 400) loop
    d := d + 1;
    if private.is_workday(d) then n := n + 1; end if;
  end loop;
  return d;
end $$;
-- Working days that have passed after p_from, up to and including p_to.
create or replace function private.workdays_between(p_from date, p_to date) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from generate_series(p_from + 1, p_to, interval '1 day') g(d) where private.is_workday(g.d::date)
$$;

-- ================================================================ the processing clock
create table if not exists public.office_filings (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id) on delete cascade,
  requirement_id  uuid not null references public.requirements(id) on delete cascade,
  request_id      uuid references public.assistance_requests(id) on delete set null,
  office          text not null check (length(btrim(office)) between 2 and 160),
  reference_no    text check (reference_no is null or length(reference_no) <= 120),
  filed_on        date not null,
  kind            text not null default 'simple' check (kind in ('simple','complex','technical','charter')),
  days            int not null default 3 check (days between 1 and 60),
  extended        boolean not null default false,
  extension_note  text check (extension_note is null or length(extension_note) <= 300),
  closed_days     int not null default 0 check (closed_days between 0 and 60),
  fees            text not null default 'not_assessed' check (fees in ('not_assessed','assessed','paid','none')),
  fees_paid_on    date,
  due_on          date not null,
  status          text not null default 'waiting' check (status in ('waiting','released','denied','withdrawn')),
  closed_on       date,
  followup_at     timestamptz,
  complaint_at    timestamptz,
  complaint_ref   text check (complaint_ref is null or length(complaint_ref) <= 120),
  late_noticed_at timestamptz,
  created_by      uuid default auth.uid() references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists office_filings_org on public.office_filings(org_id, status, due_on);
create unique index if not exists office_filings_one_open on public.office_filings(requirement_id) where status = 'waiting';

-- The legal time and the deadline follow from the kind, an extension and days the office was closed.
create or replace function private.filing_before() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.days := case new.kind when 'simple' then 3 when 'complex' then 7 when 'technical' then 20 else new.days end;
  new.due_on := private.add_workdays(new.filed_on, new.days * case when new.extended then 2 else 1 end + new.closed_days);
  if tg_op = 'UPDATE' and new.due_on is distinct from old.due_on then new.late_noticed_at := null; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists office_filings_before on public.office_filings;
create trigger office_filings_before before insert or update on public.office_filings for each row execute function private.filing_before();

-- ================================================================ city bills
create table if not exists public.gov_bills (
  id             uuid primary key default gen_random_uuid(),
  number         text not null unique,
  org_id         uuid not null references public.orgs(id) on delete cascade,
  requirement_id uuid not null references public.requirements(id) on delete cascade,
  label          text not null check (length(label) <= 300),
  office         text not null check (length(btrim(office)) between 2 and 160),
  bill_ref       text check (bill_ref is null or length(bill_ref) <= 120),
  amount_php     numeric(12,2) not null check (amount_php > 0 and amount_php <= 1000000),
  pay_by         date,
  mode           text not null check (mode in ('self','permitpal')),
  fee_php        numeric(12,2) not null default 0 check (fee_php >= 0),
  bill_path      text check (bill_path is null or length(bill_path) <= 400),
  bill_name      text check (bill_name is null or length(bill_name) <= 255),
  status         text not null default 'due' check (status in ('due','pending_verification','processing','paid','cancelled','refunded')),
  pay_method     text check (pay_method is null or pay_method in ('gcash','maya','bank_transfer','other')),
  pay_ref        text check (pay_ref is null or length(pay_ref) <= 120),
  proof_path     text check (proof_path is null or length(proof_path) <= 400),
  proof_name     text check (proof_name is null or length(proof_name) <= 255),
  reported_at    timestamptz,
  received_at    timestamptz,
  pay_deadline   timestamptz,
  paid_at        timestamptz,
  or_no          text check (or_no is null or length(or_no) <= 60),
  or_date        date,
  or_path        text check (or_path is null or length(or_path) <= 400),
  or_name        text check (or_name is null or length(or_name) <= 255),
  document_id    uuid references public.documents(id) on delete set null,
  refunded_at    timestamptz,
  refund_note    text check (refund_note is null or length(refund_note) <= 500),
  bir_invoice_no text check (bir_invoice_no is null or length(bir_invoice_no) <= 60),
  note           text check (note is null or length(note) <= 500),
  created_by     uuid default auth.uid() references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists gov_bills_org on public.gov_bills(org_id, created_at desc);
create index if not exists gov_bills_req on public.gov_bills(requirement_id, created_at desc);
create index if not exists gov_bills_open on public.gov_bills(status) where status in ('pending_verification','processing');
drop trigger if exists gov_bills_touch on public.gov_bills;
create trigger gov_bills_touch before update on public.gov_bills for each row execute function private.touch_updated_at();

-- What PermitPal charges to pay a bill, the most it pays for one, and whether it's taking bills now.
alter table public.app_settings drop constraint if exists app_settings_key_check;
alter table public.app_settings add constraint app_settings_key_check check (key in ('gcash_name','gcash_number','bank_name','bank_account_name',
  'bank_account_number','payment_note','online_payments','support_phone','support_email','sms_monthly_cap','billpay_fee','billpay_max','billpay_open'));
insert into public.app_settings (key, value) values ('billpay_fee', '99'), ('billpay_max', '50000'), ('billpay_open', 'on') on conflict (key) do nothing;

-- ================================================================ who sees what
alter table public.office_filings enable row level security;
alter table public.gov_bills enable row level security;
drop policy if exists office_filings_read on public.office_filings;
create policy office_filings_read on public.office_filings for select to authenticated
  using (org_id in (select private.my_org_ids()) or (select private.is_platform_admin()));
drop policy if exists gov_bills_read on public.gov_bills;
create policy gov_bills_read on public.gov_bills for select to authenticated
  using (org_id in (select private.my_org_ids()) or (select private.is_platform_admin()));
revoke insert, update, delete on public.office_filings, public.gov_bills from anon, authenticated;
revoke all on public.office_filings, public.gov_bills from anon;
grant select on public.office_filings, public.gov_bills to authenticated;

-- ================================================================ helpers
create or replace function private.clock_ready() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from private.features where name = 'clock') then raise exception 'The processing clock is not switched on yet.' using errcode = 'P0001'; end if;
end $$;
create or replace function private.bills_ready() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from private.features where name = 'billpay') then raise exception 'City bills are not switched on yet.' using errcode = 'P0001'; end if;
end $$;
create or replace function private.app_setting(p_key text) returns text
language sql stable security definer set search_path = '' as $$ select value from public.app_settings where key = p_key $$;
-- A permit the person may change (owner, admin or member of its workspace).
create or replace function private.req_for_edit(p_req uuid) returns public.requirements
language plpgsql stable security definer set search_path = '' as $$
declare r public.requirements;
begin
  select * into r from public.requirements where id = p_req and deleted_at is null;
  if r.id is null or r.org_id not in (select private.my_writable_org_ids()) then raise exception 'Permit not found.' using errcode = '42501'; end if;
  return r;
end $$;
-- One line in the permit's Activity.
create or replace function private.req_activity(p_req uuid, p_entity text, p_entity_id uuid, p_action text, p_summary text) returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_log (org_id, actor_id, entity, entity_id, action, summary, business_id, vehicle_id, requirement_id)
  select r.org_id, auth.uid(), p_entity, p_entity_id, p_action, left(p_summary, 300), r.business_id, r.vehicle_id, r.id
  from public.requirements r where r.id = p_req
$$;
-- The people to tell about a permit: its owners and admins, and whoever handles it.
create or replace function private.notify_req(p_req uuid, p_kind text, p_title text, p_body text, p_link text, p_key text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.requirements; v record;
begin
  select * into r from public.requirements where id = p_req;
  if r.id is null then return; end if;
  for v in select m.user_id from public.org_members m where m.org_id = r.org_id
             and (m.role in ('owner','admin') or m.user_id = r.assignee_id) loop
    perform private.notify(v.user_id, r.org_id, p_kind, p_title, p_body, p_link, r.id, p_key || ':' || v.user_id, true);
  end loop;
end $$;

-- ================================================================ the clock: customers
create or replace function public.filing_save(p_id uuid, p_requirement uuid, p_office text, p_reference text, p_filed_on date, p_kind text,
  p_days int, p_fees text, p_fees_paid_on date, p_extended boolean default false, p_extension_note text default null, p_closed_days int default 0)
returns uuid language plpgsql security definer set search_path = '' as $$
declare f public.office_filings; r public.requirements; v_today date := private.today_ph();
begin
  perform private.clock_ready();
  if p_id is not null then
    select * into f from public.office_filings where id = p_id for update;
    if f.id is null or f.org_id not in (select private.my_writable_org_ids()) then raise exception 'Filing not found.' using errcode = '42501'; end if;
    if f.status <> 'waiting' then raise exception 'This filing is closed. If you filed again, start the clock again.' using errcode = 'P0001'; end if;
    r := private.req_for_edit(f.requirement_id);
  else
    r := private.req_for_edit(p_requirement);
    if exists (select 1 from public.office_filings where requirement_id = r.id and status = 'waiting') then
      raise exception 'The clock is already running for this permit. Update that filing instead.' using errcode = 'P0001';
    end if;
  end if;
  if length(btrim(coalesce(p_office, ''))) < 2 then raise exception 'Which office did you file with?' using errcode = '22023'; end if;
  if length(btrim(p_office)) > 160 then raise exception 'That office name is too long.' using errcode = '22023'; end if;
  if length(coalesce(p_reference, '')) > 120 then raise exception 'That reference number is too long.' using errcode = '22023'; end if;
  if p_filed_on is null then raise exception 'When did you hand in your papers?' using errcode = '22023'; end if;
  if p_filed_on > v_today then raise exception 'The day you filed can''t be in the future.' using errcode = '22023'; end if;
  if p_filed_on < v_today - 365 then raise exception 'That''s more than a year ago. Start the clock when you file again.' using errcode = '22023'; end if;
  if coalesce(p_kind, '') not in ('simple','complex','technical','charter') then raise exception 'Choose the processing time.' using errcode = '22023'; end if;
  if p_kind = 'charter' and (p_days is null or p_days not between 1 and 60) then
    raise exception 'Enter the working days in the office''s Citizen''s Charter (1 to 60).' using errcode = '22023';
  end if;
  if coalesce(p_fees, '') not in ('not_assessed','assessed','paid','none') then raise exception 'Say where you are with the fees.' using errcode = '22023'; end if;
  if p_fees = 'paid' and (p_fees_paid_on is null or p_fees_paid_on > v_today or p_fees_paid_on < p_filed_on - 60) then
    raise exception 'Enter the day you paid the fees.' using errcode = '22023';
  end if;
  if coalesce(p_extended, false) and length(btrim(coalesce(p_extension_note, ''))) < 3 then
    raise exception 'Say what the office wrote about needing more time.' using errcode = '22023';
  end if;
  if length(coalesce(p_extension_note, '')) > 300 then raise exception 'Keep the note under 300 characters.' using errcode = '22023'; end if;
  if coalesce(p_closed_days, 0) not between 0 and 60 then raise exception 'Days the office was closed: 0 to 60.' using errcode = '22023'; end if;
  if p_id is null then
    insert into public.office_filings (org_id, requirement_id, office, reference_no, filed_on, kind, days, fees, fees_paid_on, extended, extension_note, closed_days)
    values (r.org_id, r.id, btrim(p_office), nullif(btrim(p_reference), ''), p_filed_on, p_kind, coalesce(p_days, 3), p_fees,
      case when p_fees = 'paid' then p_fees_paid_on end, coalesce(p_extended, false), nullif(btrim(p_extension_note), ''), coalesce(p_closed_days, 0))
    returning * into f;
    perform private.req_activity(r.id, 'office_filing', f.id, 'clock_start',
      'Filed with ' || f.office || ' on ' || private.fmt_date(f.filed_on) || '. By law it has until ' || private.fmt_date(f.due_on) || '.');
  else
    update public.office_filings set office = btrim(p_office), reference_no = nullif(btrim(p_reference), ''), filed_on = p_filed_on, kind = p_kind,
      days = coalesce(p_days, days), fees = p_fees, fees_paid_on = case when p_fees = 'paid' then p_fees_paid_on end,
      extended = coalesce(p_extended, false), extension_note = case when coalesce(p_extended, false) then nullif(btrim(p_extension_note), '') end,
      closed_days = coalesce(p_closed_days, 0)
    where id = f.id returning * into f;
    perform private.req_activity(r.id, 'office_filing', f.id, 'clock_update',
      'Updated the filing with ' || f.office || '. The office now has until ' || private.fmt_date(f.due_on) || '.');
  end if;
  return f.id;
end $$;

-- Got it, denied (with reasons) or withdrawn: the clock stops.
create or replace function public.filing_close(p_id uuid, p_status text, p_on date default null) returns void
language plpgsql security definer set search_path = '' as $$
declare f public.office_filings; v_on date := coalesce(p_on, private.today_ph());
begin
  perform private.clock_ready();
  select * into f from public.office_filings where id = p_id for update;
  if f.id is null or not (f.org_id in (select private.my_writable_org_ids()) or (f.request_id is not null and private.is_platform_admin())) then
    raise exception 'Filing not found.' using errcode = '42501';
  end if;
  if f.status <> 'waiting' then raise exception 'This filing is already closed.' using errcode = 'P0001'; end if;
  if coalesce(p_status, '') not in ('released','denied','withdrawn') then raise exception 'Say what happened.' using errcode = '22023'; end if;
  if v_on > private.today_ph() or v_on < f.filed_on then raise exception 'Choose a day between the day you filed and today.' using errcode = '22023'; end if;
  update public.office_filings set status = p_status, closed_on = v_on where id = f.id;
  perform private.req_activity(f.requirement_id, 'office_filing', f.id, 'clock_' || p_status,
    case p_status when 'released' then f.office || ' released it on ' || private.fmt_date(v_on)
      || case when v_on > f.due_on then ', ' || private.workdays_between(f.due_on, v_on) || ' working day(s) past its deadline.' else ', on time.' end
      when 'denied' then f.office || ' turned it down or asked for more on ' || private.fmt_date(v_on) || '. The clock stopped.'
      else 'Stopped the clock for the filing with ' || f.office || '.' end);
end $$;

-- A letter was drafted: a follow-up to the office, or a complaint to ARTA (with its reference, once there is one).
create or replace function public.filing_letter(p_id uuid, p_kind text, p_ref text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare f public.office_filings;
begin
  perform private.clock_ready();
  select * into f from public.office_filings where id = p_id for update;
  if f.id is null or f.org_id not in (select private.my_writable_org_ids()) then raise exception 'Filing not found.' using errcode = '42501'; end if;
  if coalesce(p_kind, '') not in ('followup','complaint') then raise exception 'Unknown letter.' using errcode = '22023'; end if;
  if length(coalesce(p_ref, '')) > 120 then raise exception 'That reference number is too long.' using errcode = '22023'; end if;
  if p_kind = 'followup' then
    update public.office_filings set followup_at = now() where id = f.id;
    if f.followup_at is null then
      perform private.req_activity(f.requirement_id, 'office_filing', f.id, 'clock_followup', 'Drafted a follow-up letter to ' || f.office || '.');
    end if;
  else
    update public.office_filings set complaint_at = coalesce(complaint_at, now()), complaint_ref = coalesce(nullif(btrim(p_ref), ''), complaint_ref) where id = f.id;
    if f.complaint_at is null then
      perform private.req_activity(f.requirement_id, 'office_filing', f.id, 'clock_complaint', 'Drafted a complaint to ARTA about ' || f.office || '.');
    end if;
  end if;
end $$;

-- ================================================================ the clock: staff (done-for-you orders)
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
    || private.fmt_date(f.filed_on) || '. By law the office has until ' || private.fmt_date(f.due_on) || ' to act. We follow up if it doesn''t.');
  perform private.req_activity(a.requirement_id, 'office_filing', f.id, 'clock_start',
    'PermitPal filed with ' || f.office || ' on ' || private.fmt_date(f.filed_on) || '. By law it has until ' || private.fmt_date(f.due_on) || '.');
  return f.id;
end $$;

-- Every filing still waiting, latest deadline last, for Admin > Bills & clock.
create or replace function public.admin_filings() returns table (id uuid, org_id uuid, org_name text, requirement_id uuid, label text, request_id uuid,
  office text, reference_no text, filed_on date, due_on date, days int, kind text, fees text, followup_at timestamptz, complaint_at timestamptz, workdays_late int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  return query
  select f.id, f.org_id, o.name, f.requirement_id, private.requirement_label(f.requirement_id), f.request_id, f.office, f.reference_no, f.filed_on, f.due_on,
    f.days, f.kind, f.fees, f.followup_at, f.complaint_at,
    case when f.due_on < private.today_ph() then private.workdays_between(f.due_on, private.today_ph()) else 0 end
  from public.office_filings f join public.orgs o on o.id = f.org_id
  where f.status = 'waiting' and o.deleted_at is null
  order by f.due_on, f.filed_on
  limit 500;
end $$;

create or replace function public.admin_set_holiday(p_day date, p_name text, p_kind text default 'special', p_remove boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  if p_day is null then raise exception 'Choose the day.' using errcode = '22023'; end if;
  if coalesce(p_remove, false) then
    delete from public.ph_holidays where day = p_day;
  else
    if length(btrim(coalesce(p_name, ''))) not between 1 and 80 then raise exception 'Name the holiday (up to 80 characters).' using errcode = '22023'; end if;
    if coalesce(p_kind, '') not in ('regular','special') then raise exception 'Regular or special?' using errcode = '22023'; end if;
    insert into public.ph_holidays (day, name, kind) values (p_day, btrim(p_name), p_kind)
    on conflict (day) do update set name = excluded.name, kind = excluded.kind;
  end if;
  -- deadlines still running move with the calendar
  update public.office_filings set filed_on = filed_on where status = 'waiting' and due_on >= p_day and filed_on < p_day;
end $$;

-- ================================================================ bills: customers
create or replace function public.bill_add(p_org uuid, p_requirement uuid, p_office text, p_ref text, p_amount numeric, p_pay_by date, p_mode text,
  p_bill_path text default null, p_bill_name text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r public.requirements; v_id uuid; v_today date := private.today_ph(); v_max numeric := coalesce(nullif(private.app_setting('billpay_max'), '')::numeric, 50000);
begin
  perform private.bills_ready();
  r := private.req_for_edit(p_requirement);
  if r.org_id is distinct from p_org then raise exception 'Permit not found.' using errcode = '42501'; end if;
  if coalesce(p_mode, '') not in ('self','permitpal') then raise exception 'Who pays it?' using errcode = '22023'; end if;
  if p_mode = 'permitpal' and not private.is_org_admin(p_org) then
    raise exception 'Only the workspace owner or an admin can have PermitPal pay a bill.' using errcode = '42501';
  end if;
  if p_mode = 'permitpal' and coalesce(private.app_setting('billpay_open'), 'on') <> 'on' then
    raise exception 'PermitPal isn''t paying bills for customers right now. Keep the bill here and pay it yourself.' using errcode = 'P0001';
  end if;
  if length(btrim(coalesce(p_office, ''))) not between 2 and 160 then raise exception 'Which office sent the bill?' using errcode = '22023'; end if;
  if length(coalesce(p_ref, '')) > 120 then raise exception 'That bill number is too long.' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter the amount on the bill.' using errcode = '22023'; end if;
  if p_amount > 1000000 then raise exception 'That amount looks too big. Check it against the bill.' using errcode = '22023'; end if;
  if round(p_amount, 2) <> p_amount then raise exception 'Use pesos and centavos only (two decimals).' using errcode = '22023'; end if;
  if p_mode = 'permitpal' and p_amount > v_max then
    raise exception 'PermitPal pays bills up to %. For this one, pay the office directly and keep the receipt here.', private.peso(v_max) using errcode = 'P0001';
  end if;
  if p_pay_by is not null and (p_pay_by < v_today - 366 or p_pay_by > v_today + 400) then raise exception 'Check the pay-by date.' using errcode = '22023'; end if;
  if p_mode = 'permitpal' and p_bill_path is null then raise exception 'Add a photo of the bill, so we pay exactly what it says.' using errcode = '22023'; end if;
  if p_bill_path is not null and p_bill_path not like p_org::text || '/bills/%' then raise exception 'Invalid file location.' using errcode = '42501'; end if;
  if exists (select 1 from public.gov_bills b where b.requirement_id = r.id and b.amount_php = p_amount and b.status in ('due','pending_verification','processing')
               and coalesce(b.bill_ref, '') = coalesce(nullif(btrim(p_ref), ''), '')) then
    raise exception 'This bill is already here.' using errcode = 'P0001';
  end if;
  insert into public.gov_bills (number, org_id, requirement_id, label, office, bill_ref, amount_php, pay_by, mode, fee_php, bill_path, bill_name)
  values (private.next_no('G'), r.org_id, r.id, coalesce(private.requirement_label(r.id), r.name), btrim(p_office), nullif(btrim(p_ref), ''), p_amount, p_pay_by, p_mode,
    case when p_mode = 'permitpal' then coalesce(nullif(private.app_setting('billpay_fee'), '')::numeric, 99) else 0 end, p_bill_path, left(p_bill_name, 255))
  returning id into v_id;
  perform private.req_activity(r.id, 'gov_bill', v_id, 'bill_add', 'Added a bill from ' || btrim(p_office) || ' for ' || private.peso(p_amount)
    || case when p_mode = 'permitpal' then ', for PermitPal to pay.' else '.' end);
  return v_id;
end $$;

create or replace function public.bill_report(p_bill uuid, p_method text, p_ref text, p_proof_path text default null, p_proof_name text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.gov_bills;
begin
  perform private.bills_ready();
  select * into b from public.gov_bills where id = p_bill for update;
  if b.id is null or not private.is_org_admin(b.org_id) then raise exception 'Bill not found.' using errcode = '42501'; end if;
  if b.mode <> 'permitpal' then raise exception 'You pay this bill to the office yourself.' using errcode = 'P0001'; end if;
  if b.status not in ('due','pending_verification') then raise exception 'This bill is already paid or closed.' using errcode = 'P0001'; end if;
  if coalesce(p_method, '') not in ('gcash','maya','bank_transfer','other') then raise exception 'Choose how you paid.' using errcode = '22023'; end if;
  if coalesce(btrim(p_ref), '') = '' and p_proof_path is null then raise exception 'Add the reference number or a screenshot of the payment.' using errcode = '22023'; end if;
  if length(coalesce(p_ref, '')) > 120 then raise exception 'That reference number is too long.' using errcode = '22023'; end if;
  if p_proof_path is not null and p_proof_path not like b.org_id::text || '/bills/%' then raise exception 'Invalid file location.' using errcode = '42501'; end if;
  update public.gov_bills set status = 'pending_verification', pay_method = p_method, pay_ref = nullif(btrim(p_ref), ''),
    proof_path = coalesce(p_proof_path, proof_path), proof_name = coalesce(left(p_proof_name, 255), proof_name), reported_at = now(), note = null
  where id = b.id;
  perform private.notify_admins('City bill to confirm: ' || b.number,
    (select name from public.orgs where id = b.org_id) || ' - ' || private.peso(b.amount_php + b.fee_php) || ' via ' || replace(p_method, '_', ' ')
      || coalesce(', ref ' || nullif(btrim(p_ref), ''), '') || '. Pay ' || b.office || coalesce(' by ' || private.fmt_date(b.pay_by), '') || '.',
    'billpay:' || b.id || ':' || extract(epoch from now())::bigint, true);
end $$;

create or replace function public.bill_cancel(p_bill uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.gov_bills;
begin
  perform private.bills_ready();
  select * into b from public.gov_bills where id = p_bill for update;
  if b.id is null or not (b.org_id in (select private.my_writable_org_ids()) and (b.mode = 'self' or private.is_org_admin(b.org_id))) then
    raise exception 'Bill not found.' using errcode = '42501';
  end if;
  if b.status <> 'due' then raise exception 'Only a bill nobody has paid yet can be removed.' using errcode = 'P0001'; end if;
  update public.gov_bills set status = 'cancelled', note = 'Removed.' where id = b.id;
end $$;

-- The official receipt goes on the permit: with the record it pays for, if that was already added, otherwise with its other files.
create or replace function private.bill_file_receipt(p_bill uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.gov_bills; v_cycle uuid; v_doc uuid;
begin
  select * into b from public.gov_bills where id = p_bill;
  if b.or_path is null or b.document_id is not null then return; end if;
  select c.id into v_cycle from public.requirement_cycles c
  where c.requirement_id = b.requirement_id and c.deleted_at is null and c.created_at >= b.created_at - interval '1 day'
  order by c.created_at desc limit 1;
  insert into public.documents (org_id, requirement_id, cycle_id, storage_path, file_name, mime_type, uploaded_by)
  values (b.org_id, b.requirement_id, v_cycle, b.or_path,
    left('Official receipt ' || coalesce(b.or_no || ' ', '') || '- ' || coalesce(b.or_name, 'receipt'), 255),
    case when b.or_name ~* '\.pdf$' then 'application/pdf' else 'image/jpeg' end, auth.uid())
  returning id into v_doc;
  update public.gov_bills set document_id = v_doc where id = b.id;
end $$;

-- Paid it yourself: add the official receipt (number, date, and a photo if you have one).
create or replace function public.bill_paid_self(p_bill uuid, p_or_no text, p_or_date date, p_or_path text default null, p_or_name text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.gov_bills;
begin
  perform private.bills_ready();
  select * into b from public.gov_bills where id = p_bill for update;
  if b.id is null or b.org_id not in (select private.my_writable_org_ids()) then raise exception 'Bill not found.' using errcode = '42501'; end if;
  if b.mode <> 'self' then raise exception 'PermitPal is paying this one, and adds the receipt itself.' using errcode = 'P0001'; end if;
  if b.status <> 'due' then raise exception 'This bill is already marked paid.' using errcode = 'P0001'; end if;
  if coalesce(btrim(p_or_no), '') = '' and p_or_path is null then raise exception 'Add the official receipt number or a photo of it.' using errcode = '22023'; end if;
  if length(coalesce(p_or_no, '')) > 60 then raise exception 'That receipt number is too long.' using errcode = '22023'; end if;
  if p_or_date is null or p_or_date > private.today_ph() or p_or_date < (b.created_at at time zone 'Asia/Manila')::date - 120 then
    raise exception 'Enter the date on the receipt.' using errcode = '22023';
  end if;
  if p_or_path is not null and p_or_path not like b.org_id::text || '/bills/%' then raise exception 'Invalid file location.' using errcode = '42501'; end if;
  update public.gov_bills set status = 'paid', paid_at = now(), or_no = nullif(btrim(p_or_no), ''), or_date = p_or_date, or_path = p_or_path,
    or_name = left(p_or_name, 255) where id = b.id;
  perform private.bill_file_receipt(b.id);
  perform private.req_activity(b.requirement_id, 'gov_bill', b.id, 'bill_paid',
    'Paid ' || b.office || ' ' || private.peso(b.amount_php) || coalesce(' (official receipt ' || nullif(btrim(p_or_no), '') || ')', '') || '.');
end $$;

-- ================================================================ bills: staff
-- The customer's money arrived (or didn't). Once it's in, the office is paid by 6 pm the next business day.
create or replace function public.admin_bill_received(p_bill uuid, p_ok boolean, p_note text default null, p_invoice_no text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.gov_bills; v_deadline timestamptz;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select * into b from public.gov_bills where id = p_bill for update;
  if b.id is null or b.mode <> 'permitpal' then raise exception 'Bill not found.' using errcode = 'P0002'; end if;
  if b.status <> 'pending_verification' then raise exception 'Nothing to confirm on this bill.' using errcode = 'P0001'; end if;
  if not coalesce(p_ok, false) then
    update public.gov_bills set status = 'due',
      note = coalesce(nullif(btrim(p_note), ''), 'We could not find this payment. Please check the reference number and send it again.') where id = b.id;
    perform private.notify_owners(b.org_id, 'We couldn''t match your payment for bill ' || b.number,
      coalesce(nullif(btrim(p_note), ''), 'Please check the reference number and send it again.'), '#/requirement/' || b.requirement_id,
      'billnomatch:' || b.id || ':' || extract(epoch from now())::bigint, true, true);
    return;
  end if;
  if length(btrim(coalesce(p_invoice_no, ''))) > 60 then raise exception 'That invoice number is too long.' using errcode = '22023'; end if;
  v_deadline := private.next_business_6pm(now());
  update public.gov_bills set status = 'processing', received_at = now(), pay_deadline = v_deadline, note = null,
    bir_invoice_no = coalesce(nullif(btrim(p_invoice_no), ''), bir_invoice_no) where id = b.id;
  perform private.notify_owners(b.org_id, 'Got it: we''re paying ' || b.office,
    'Your ' || private.peso(b.amount_php + b.fee_php) || ' for bill ' || b.number || ' is in. We pay ' || b.office || ' by '
      || to_char(v_deadline at time zone 'Asia/Manila', 'Dy, Mon FMDD, FMHH12 pm') || ' and put the official receipt on your permit.',
    '#/requirement/' || b.requirement_id, 'billin:' || b.id, true, true);
end $$;

-- Paid the office: the official receipt goes on the permit.
create or replace function public.admin_bill_paid(p_bill uuid, p_or_no text, p_or_date date, p_or_path text, p_or_name text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.gov_bills;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select * into b from public.gov_bills where id = p_bill for update;
  if b.id is null or b.mode <> 'permitpal' then raise exception 'Bill not found.' using errcode = 'P0002'; end if;
  if b.status <> 'processing' then raise exception 'Confirm the customer''s payment first.' using errcode = 'P0001'; end if;
  if length(btrim(coalesce(p_or_no, ''))) not between 1 and 60 then raise exception 'Enter the official receipt number.' using errcode = '22023'; end if;
  if p_or_date is null or p_or_date > private.today_ph() or p_or_date < (b.created_at at time zone 'Asia/Manila')::date - 1 then
    raise exception 'Enter the date on the receipt.' using errcode = '22023';
  end if;
  if p_or_path is null or p_or_path not like b.org_id::text || '/bills/' || b.id::text || '/%' then raise exception 'Upload the official receipt.' using errcode = '22023'; end if;
  update public.gov_bills set status = 'paid', paid_at = now(), or_no = btrim(p_or_no), or_date = p_or_date, or_path = p_or_path, or_name = left(p_or_name, 255) where id = b.id;
  perform private.bill_file_receipt(b.id);
  perform private.req_activity(b.requirement_id, 'gov_bill', b.id, 'bill_paid',
    'PermitPal paid ' || b.office || ' ' || private.peso(b.amount_php) || ' (official receipt ' || btrim(p_or_no) || ').');
  perform private.notify_owners(b.org_id, 'Paid: ' || b.office || ' ' || private.peso(b.amount_php),
    'We paid bill ' || b.number || '. Official receipt ' || btrim(p_or_no) || ' is on your permit.', '#/requirement/' || b.requirement_id, 'billpaid:' || b.id, true, true);
end $$;

-- Couldn't pay it: everything the customer sent goes back.
create or replace function public.admin_bill_refund(p_bill uuid, p_note text, p_method text default null, p_ref text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.gov_bills;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select * into b from public.gov_bills where id = p_bill for update;
  if b.id is null or b.mode <> 'permitpal' then raise exception 'Bill not found.' using errcode = 'P0002'; end if;
  if b.status not in ('processing','pending_verification') then raise exception 'Only a bill we have the money for can be refunded.' using errcode = 'P0001'; end if;
  if length(btrim(coalesce(p_note, ''))) not between 3 and 500 then raise exception 'Say why, in a sentence the customer will read.' using errcode = '22023'; end if;
  if length(coalesce(p_ref, '')) > 120 then raise exception 'That reference number is too long.' using errcode = '22023'; end if;
  update public.gov_bills set status = 'refunded', refunded_at = now(), received_at = coalesce(received_at, now()),
    refund_note = btrim(p_note) || coalesce(' Sent back by ' || replace(nullif(p_method, ''), '_', ' '), '') || coalesce(', ref ' || nullif(btrim(p_ref), ''), '') || '.'
  where id = b.id;
  perform private.notify_owners(b.org_id, 'We couldn''t pay bill ' || b.number || ': your money is coming back',
    btrim(p_note) || ' The full ' || private.peso(b.amount_php + b.fee_php) || ' is sent back to you.', '#/requirement/' || b.requirement_id,
    'billrefund:' || b.id, true, true);
end $$;

-- Storage rules run as the visitor, who can't reach the private schema: staff may upload a receipt only into a bill they're paying.
create or replace function public.pp_staff_bill_upload(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.is_platform_admin(), false) and exists (select 1 from public.gov_bills b
    where b.status = 'processing' and p_name like b.org_id::text || '/bills/' || b.id::text || '/%')
$$;
drop policy if exists "documents: staff upload bill receipts" on storage.objects;
create policy "documents: staff upload bill receipts" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and public.pp_staff_bill_upload(name));

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
          || case when f.request_id is not null then ' PermitPal is following up.' else ' Open the permit for a follow-up letter you can send today.' end,
        '#/requirement/' || f.requirement_id, 'clocklate:' || f.id || ':' || f.due_on);
      if f.request_id is not null then
        perform private.notify_admins('Office late on an order: ' || f.office, coalesce(private.requirement_label(f.requirement_id), '') || ', due '
          || private.fmt_date(f.due_on) || '. Follow up today.', 'clocklate:' || f.id || ':' || f.due_on, true);
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
          || case when b.mode = 'permitpal' then ' Send PermitPal ' || private.peso(b.amount_php + b.fee_php) || ' and we pay it for you.'
                  else ' Late payments can add a surcharge and interest.' end,
        '#/requirement/' || b.requirement_id, 'billdue:' || b.id || ':' || (b.pay_by - v_today));
      v_n := v_n + 1;
    end loop;
    -- bills PermitPal was asked to pay, never sent: closed after 14 days
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

-- ================================================================ money: city bills in the ledger
CREATE OR REPLACE FUNCTION public.admin_money(p_from date, p_to date)
 RETURNS TABLE(day date, stream text, kind text, state text, amount numeric, label text, who text, ref_kind text, ref_id uuid, invoice_no text, rush numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 800 then raise exception 'Choose a range of up to about 2 years.' using errcode = '22023'; end if;
  return query
  with lines as (
    -- one-time jobs and care renewals: our fee (service + rush), when paid
    select private.ph_day(a.paid_at) as day, 'jobs'::text as stream, 'service_fee'::text as kind, 'collected'::text as state,
      (coalesce(a.quote_service_fee, 0) + a.quote_rush_fee)::numeric as amount, a.requirement_name as label, o.name as who,
      'order'::text as ref_kind, a.id as ref_id, a.bir_invoice_no as invoice_no, a.quote_rush_fee::numeric as rush
    from public.assistance_requests a join public.orgs o on o.id = a.org_id
    where a.paid_at is not null and a.payment_status in ('paid','refunded') and (coalesce(a.quote_service_fee, 0) + a.quote_rush_fee) > 0
    union all
    select private.ph_day(a.paid_at), 'jobs', 'gov_fees_in', 'held', coalesce(a.quote_gov_fees, 0)::numeric, a.requirement_name, o.name, 'order', a.id, a.bir_invoice_no, 0::numeric
    from public.assistance_requests a join public.orgs o on o.id = a.org_id
    where a.paid_at is not null and a.payment_status in ('paid','refunded') and coalesce(a.quote_gov_fees, 0) > 0
    union all
    select private.ph_day(coalesce(a.closed_at, a.updated_at)), 'jobs', 'gov_fees_out', 'held', -a.gov_fees_actual::numeric, a.requirement_name, o.name, 'order', a.id, null, 0
    from public.assistance_requests a join public.orgs o on o.id = a.org_id
    where a.paid_at is not null and a.payment_status in ('paid','refunded') and coalesce(a.gov_fees_actual, 0) > 0
    union all
    -- refunds: a fee difference is government money going back; a full refund returns our fee first, then the rest
    select private.ph_day(r.created_at), 'jobs', 'refund', 'held', -r.amount_php::numeric, a.requirement_name, o.name, 'order', a.id, null, 0
    from public.order_refunds r join public.assistance_requests a on a.id = r.request_id join public.orgs o on o.id = a.org_id where r.kind = 'fee_difference'
    union all
    select private.ph_day(r.created_at), 'jobs', 'refund', 'collected', -r.amount_php::numeric, a.requirement_name, o.name, 'order', a.id, null, 0
    from public.order_refunds r join public.assistance_requests a on a.id = r.request_id join public.orgs o on o.id = a.org_id where r.kind = 'partial'
    union all
    select private.ph_day(r.created_at), 'jobs', 'refund', 'collected', -least(r.amount_php, coalesce(a.quote_service_fee, 0) + a.quote_rush_fee)::numeric,
      a.requirement_name, o.name, 'order', a.id, null, 0
    from public.order_refunds r join public.assistance_requests a on a.id = r.request_id join public.orgs o on o.id = a.org_id
    where r.kind = 'full' and least(r.amount_php, coalesce(a.quote_service_fee, 0) + a.quote_rush_fee) > 0
    union all
    select private.ph_day(r.created_at), 'jobs', 'refund', 'held', -(r.amount_php - least(r.amount_php, coalesce(a.quote_service_fee, 0) + a.quote_rush_fee))::numeric,
      a.requirement_name, o.name, 'order', a.id, null, 0
    from public.order_refunds r join public.assistance_requests a on a.id = r.request_id join public.orgs o on o.id = a.org_id
    where r.kind = 'full' and r.amount_php > coalesce(a.quote_service_fee, 0) + a.quote_rush_fee
    union all
    -- accepted, not paid yet / quoted, not accepted yet
    select private.ph_day(coalesce(a.accepted_at, a.quoted_at, a.created_at)), 'jobs', 'service_fee', 'to_collect',
      (coalesce(a.quote_service_fee, 0) + a.quote_rush_fee)::numeric, a.requirement_name, o.name, 'order', a.id, null, a.quote_rush_fee::numeric
    from public.assistance_requests a join public.orgs o on o.id = a.org_id
    where a.payment_status in ('awaiting_payment','pending_verification') and a.status <> 'cancelled' and (coalesce(a.quote_service_fee, 0) + a.quote_rush_fee) > 0
    union all
    select private.ph_day(a.quoted_at), 'jobs', 'service_fee', 'pipeline', (coalesce(a.quote_service_fee, 0) + a.quote_rush_fee)::numeric, a.requirement_name, o.name,
      'order', a.id, null, a.quote_rush_fee::numeric
    from public.assistance_requests a join public.orgs o on o.id = a.org_id
    where a.status = 'quoted' and a.quoted_at is not null and (coalesce(a.quote_service_fee, 0) + a.quote_rush_fee) > 0
    union all
    -- year-round care bills
    select private.ph_day(i.paid_at), 'care', 'care_fee', 'collected', i.amount_php::numeric, 'Year-round care, bill ' || i.number, o.name, 'care', i.id, i.bir_invoice_no, 0
    from public.care_invoices i join public.orgs o on o.id = i.org_id where i.status = 'paid' and i.amount_php > 0
    union all
    select i.due_on, 'care', 'care_fee', 'to_collect', i.amount_php::numeric, 'Year-round care, bill ' || i.number, o.name, 'care', i.id, null, 0
    from public.care_invoices i join public.orgs o on o.id = i.org_id where i.status in ('due','pending_verification') and i.amount_php > 0
    union all
    select private.ph_day(g.paid_at), 'care', 'guarantee', 'cost', -g.approved_php::numeric, 'On-time guarantee: ' || g.requirement_name, o.name, 'claim', g.id, null, 0
    from public.guarantee_claims g join public.orgs o on o.id = g.org_id where g.status = 'paid'
    union all
    select private.ph_day(g.decided_at), 'care', 'guarantee', 'to_pay', -g.approved_php::numeric, 'On-time guarantee: ' || g.requirement_name, o.name, 'claim', g.id, null, 0
    from public.guarantee_claims g join public.orgs o on o.id = g.org_id where g.status = 'approved'
    union all
    -- fees from firms, charge by charge
    select case when c.status = 'paid' then coalesce(private.ph_day(s.paid_at), c.occurred_on) else c.occurred_on end, 'partners', c.kind,
      case c.status when 'paid' then 'collected' when 'billed' then 'to_collect' else 'unbilled' end,
      c.amount_php::numeric, c.description, p.name, case when s.id is not null then 'statement' else 'partner' end, coalesce(s.id, p.id), s.bir_invoice_no, 0
    from public.partner_charges c join public.partners p on p.id = c.partner_id left join public.partner_statements s on s.id = c.statement_id
    where c.status <> 'waived'
    union all
    -- prepaid credit firms bought (the money is in when they pay; each quote request then uses some of it)
    select private.ph_day(c.created_at), 'partners', 'credit_topup', 'collected', c.amount_php::numeric, 'Prepaid credit for quote requests', p.name, 'credit', c.id, c.bir_invoice_no, 0
    from public.partner_credits c join public.partners p on p.id = c.partner_id where c.kind = 'topup'
    union all
    -- team plans (online, or recorded by staff)
    select private.ph_day(pm.paid_at), 'plans', 'team_plan', 'collected', pm.amount_php::numeric, pl.name || ' plan, ' || pm.months || ' month' || case when pm.months > 1 then 's' else '' end,
      o.name, 'plan', pm.id, pm.bir_invoice_no, 0
    from public.payments pm join public.orgs o on o.id = pm.org_id join public.plans pl on pl.id = pm.plan_id
    where pm.status = 'paid' and pm.plan_id is not null and pm.paid_at is not null
    union all
    -- PermitPal Plus and staff licenses
    select private.ph_day(i.paid_at), 'plans', case i.kind when 'plus' then 'plus' when 'brand' then 'white_label' else 'staff_licences' end, 'collected', i.amount_php::numeric,
      private.addon_label(i.kind, i.people_max, i.billing) || ', bill ' || i.number, o.name, 'addon', i.id, i.bir_invoice_no, 0
    from public.addon_invoices i join public.orgs o on o.id = i.org_id where i.status = 'paid' and i.amount_php > 0 and i.paid_at is not null
    union all
    select private.ph_day(i.created_at), 'plans', case i.kind when 'plus' then 'plus' when 'brand' then 'white_label' else 'staff_licences' end, 'to_collect', i.amount_php::numeric,
      private.addon_label(i.kind, i.people_max, i.billing) || ', bill ' || i.number, o.name, 'addon', i.id, null, 0
    from public.addon_invoices i join public.orgs o on o.id = i.org_id where i.status in ('due','pending_verification') and i.amount_php > 0
    union all
    -- PermitPal load: top-ups are money in (spending it later isn't new money); paying it back is money out
    select private.ph_day(t.paid_at), 'load', 'load_topup', 'collected', t.amount_php::numeric, 'Load top-up ' || t.number, o.name, 'load', t.id, t.bir_invoice_no, 0
    from public.load_topups t join public.orgs o on o.id = t.org_id where t.status = 'paid' and t.paid_at is not null
    union all
    select private.ph_day(t.created_at), 'load', 'load_topup', 'to_collect', t.amount_php::numeric, 'Load top-up ' || t.number, o.name, 'load', t.id, null, 0
    from public.load_topups t join public.orgs o on o.id = t.org_id where t.status in ('due','pending_verification')
    union all
    select private.ph_day(e.created_at), 'load', 'refund', 'collected', e.paid_php::numeric, e.label, o.name, 'loadorg', e.org_id, null, 0
    from public.load_entries e join public.orgs o on o.id = e.org_id where e.kind = 'cashout'
    union all
    -- paying city bills for customers: the fee is ours; the bill itself is their money passing through
    select private.ph_day(b.received_at), 'jobs', 'billpay_fee', 'collected', b.fee_php::numeric, 'Paying a city bill, ' || b.number, o.name, 'gbill', b.id, b.bir_invoice_no, 0
    from public.gov_bills b join public.orgs o on o.id = b.org_id where b.mode = 'permitpal' and b.received_at is not null and b.fee_php > 0
    union all
    select private.ph_day(b.received_at), 'jobs', 'gov_fees_in', 'held', b.amount_php::numeric, 'City bill ' || b.number, o.name, 'gbill', b.id, null, 0
    from public.gov_bills b join public.orgs o on o.id = b.org_id where b.mode = 'permitpal' and b.received_at is not null
    union all
    select private.ph_day(b.paid_at), 'jobs', 'gov_fees_out', 'held', -b.amount_php::numeric, 'City bill ' || b.number || ' paid to ' || b.office, o.name, 'gbill', b.id, null, 0
    from public.gov_bills b join public.orgs o on o.id = b.org_id where b.mode = 'permitpal' and b.status = 'paid'
    union all
    select private.ph_day(b.refunded_at), 'jobs', 'refund', 'held', -b.amount_php::numeric, 'City bill ' || b.number || ' sent back', o.name, 'gbill', b.id, null, 0
    from public.gov_bills b join public.orgs o on o.id = b.org_id where b.mode = 'permitpal' and b.status = 'refunded'
    union all
    select private.ph_day(b.refunded_at), 'jobs', 'refund', 'collected', -b.fee_php::numeric, 'Fee for city bill ' || b.number || ' sent back', o.name, 'gbill', b.id, null, 0
    from public.gov_bills b join public.orgs o on o.id = b.org_id where b.mode = 'permitpal' and b.status = 'refunded' and b.fee_php > 0
    union all
    select private.ph_day(b.created_at), 'jobs', 'billpay_fee', 'to_collect', b.fee_php::numeric, 'Paying a city bill, ' || b.number, o.name, 'gbill', b.id, null, 0
    from public.gov_bills b join public.orgs o on o.id = b.org_id where b.mode = 'permitpal' and b.status in ('due','pending_verification') and b.fee_php > 0
  )
  select l.day, l.stream, l.kind, l.state, l.amount, l.label, l.who, l.ref_kind, l.ref_id, l.invoice_no, l.rush from lines l
  where l.day between p_from and p_to or l.state in ('to_collect','pipeline','unbilled','to_pay')
  order by l.day desc, l.stream;
end $function$;
CREATE OR REPLACE FUNCTION public.admin_money_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_today date := private.today_ph(); v jsonb;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select jsonb_build_object(
    'today', v_today,
    'goal', nullif(private.setting('money_goal'), '')::numeric,
    'ic_licence_no', coalesce(private.setting('ic_licence_no'), ''),
    'mrr_care', coalesce((select sum(case billing when 'monthly' then price_php else round(price_php / 12, 2) end) from public.care_plans
                          where status = 'active' and paid_through >= v_today and cancel_at is null), 0),
    'care_active', (select count(*) from public.care_plans where status = 'active' and billing <> 'per_renewal'),
    'care_autorenew', (select count(*) from public.care_plans where status = 'active' and billing = 'per_renewal'),
    'care_pending', (select count(*) from public.care_plans where status = 'pending'),
    'care_paused', (select count(*) from public.care_plans where status = 'paused'),
    'care_ending', (select count(*) from public.care_plans where status in ('active','paused') and cancel_at is not null),
    'mrr_plans', coalesce((select sum(pl.price_php_monthly) from public.orgs o join public.plans pl on pl.id = o.plan_id
                           where o.deleted_at is null and coalesce(pl.price_php_monthly, 0) > 0 and (o.plan_expires_at is null or o.plan_expires_at > now())), 0),
    'plans_paying', (select count(*) from public.orgs o join public.plans pl on pl.id = o.plan_id
                     where o.deleted_at is null and coalesce(pl.price_php_monthly, 0) > 0 and (o.plan_expires_at is null or o.plan_expires_at > now())),
    'held_gov', coalesce((select sum(coalesce(quote_gov_fees, 0)) from public.assistance_requests where paid_at is not null and payment_status in ('paid','refunded')), 0)
              - coalesce((select sum(gov_fees_actual) from public.assistance_requests where paid_at is not null and payment_status in ('paid','refunded') and gov_fees_actual is not null), 0)
              - coalesce((select sum(r.amount_php) from public.order_refunds r where r.kind = 'fee_difference'), 0)
              - coalesce((select sum(r.amount_php - least(r.amount_php, coalesce(a.quote_service_fee, 0) + a.quote_rush_fee)) from public.order_refunds r
                          join public.assistance_requests a on a.id = r.request_id where r.kind = 'full'), 0)
              + coalesce((select sum(amount_php) from public.gov_bills where mode = 'permitpal' and status = 'processing'), 0),
    'gov_unrecorded', (select count(*) from public.assistance_requests where status = 'completed' and paid_at is not null and coalesce(quote_gov_fees, 0) > 0 and gov_fees_actual is null),
    'quotes_to_send', (select count(*) from public.assistance_requests where status = 'submitted' and (service_code is not null or care_plan_id is not null)),
    'care_to_quote', (select count(*) from public.assistance_requests where status = 'submitted' and care_plan_id is not null),
    'order_payments_to_check', (select count(*) from public.assistance_requests where payment_status = 'pending_verification'),
    'care_payments_to_check', (select count(*) from public.care_invoices where status = 'pending_verification'),
    'addon_payments_to_check', (select count(*) from public.addon_invoices where status = 'pending_verification'),
    'mrr_addons', coalesce((select sum(case a.billing when 'yearly' then round(private.addon_price(a.kind, a.people_max, 'yearly') / 12, 2)
                                    else private.addon_price(a.kind, a.people_max, 'monthly') end)
                           from public.addons a where not a.trial and not a.comped and a.paid_through >= v_today), 0),
    'plus_paying', (select count(*) from public.addons where kind = 'plus' and not trial and not comped and paid_through >= v_today),
    'plus_trials', (select count(*) from public.addons where kind = 'plus' and trial and paid_through >= v_today),
    'staff_paying', (select count(*) from public.addons where kind = 'staff' and not comped and paid_through >= v_today),
    'brand_paying', (select count(*) from public.addons where kind = 'brand' and not trial and not comped and paid_through >= v_today),
    'brand_trials', (select count(*) from public.addons where kind = 'brand' and trial and paid_through >= v_today),
    'care_overdue', (select count(*) from public.care_invoices where status = 'due' and due_on < v_today),
    'claims_to_decide', (select count(*) from public.guarantee_claims where status = 'submitted'),
    'claims_to_pay', (select count(*) from public.guarantee_claims where status = 'approved'),
    'partners_to_bill', (select count(distinct partner_id) from public.partner_charges where status = 'unbilled' and occurred_on < date_trunc('month', v_today)::date),
    'statements_overdue', (select count(*) from public.partner_statements where status = 'sent' and due_on < v_today),
    'applications_new', (select count(*) from public.partner_applications where status = 'new'),
    'disputes_open', (select count(*) from public.lead_disputes where status = 'open'),
    'firms_paused', (select count(*) from public.partners p where p.published and not private.partner_live(p)),
    'credit_held', coalesce((select sum(credit_php) from public.partners), 0),
    'staff_access_open', (select count(*) from private.staff_memberships where ended_at is null),
    'covered_missing_dates', (select count(distinct c.requirement_id) from public.care_plans p cross join lateral private.care_covered(p.id) c
                              join public.requirement_status rs on rs.id = c.requirement_id
                              where p.status = 'active' and rs.expires and rs.expires_on is null),
    'load_topups_to_check', (select count(*) from public.load_topups where status = 'pending_verification'),
    'load_held', coalesce((select sum(paid_php) from public.load_wallets), 0),
    'load_bonus', coalesce((select sum(bonus_php) from public.load_wallets), 0),
    'load_used_month', coalesce((select -sum(paid_php) from public.load_entries where kind in ('spend','refund')
                          and created_at >= date_trunc('month', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila'), 0),
    'papers_waiting', (select count(*) from public.papers_checks where status = 'waiting'),
    'papers_due_today', (select count(*) from public.papers_checks where status = 'waiting' and private.ph_day(due_by) <= v_today),
    'bills_to_check', (select count(*) from public.gov_bills where status = 'pending_verification'),
    'bills_to_pay', (select count(*) from public.gov_bills where status = 'processing'),
    'bills_late', (select count(*) from public.gov_bills where status = 'processing' and pay_deadline < now()),
    'filings_late', (select count(*) from public.office_filings where status = 'waiting' and request_id is not null and due_on < v_today),
    'missing_invoice', (select count(*) from public.assistance_requests where paid_at is not null and payment_status in ('paid','refunded') and coalesce(quote_php, 0) > 0 and bir_invoice_no is null)
                     + (select count(*) from public.care_invoices where status = 'paid' and amount_php > 0 and bir_invoice_no is null)
                     + (select count(*) from public.partner_statements where status = 'paid' and bir_invoice_no is null)
                     + (select count(*) from public.payments where status = 'paid' and plan_id is not null and bir_invoice_no is null)
                     + (select count(*) from public.partner_credits where kind = 'topup' and bir_invoice_no is null)
                     + (select count(*) from public.addon_invoices where status = 'paid' and amount_php > 0 and bir_invoice_no is null)
                     + (select count(*) from public.load_topups where status = 'paid' and bir_invoice_no is null)
                     + (select count(*) from public.gov_bills where mode = 'permitpal' and status in ('processing','paid') and fee_php > 0 and bir_invoice_no is null)
  ) into v;
  return v;
end $function$;
CREATE OR REPLACE FUNCTION public.admin_set_invoice_no(p_kind text, p_id uuid, p_no text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_no text := nullif(btrim(coalesce(p_no, '')), '');
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  if length(coalesce(v_no, '')) > 60 then raise exception 'That invoice number is too long.' using errcode = '22023'; end if;
  if p_kind = 'order' then update public.assistance_requests set bir_invoice_no = v_no where id = p_id;
  elsif p_kind = 'care' then update public.care_invoices set bir_invoice_no = v_no where id = p_id;
  elsif p_kind = 'statement' then update public.partner_statements set bir_invoice_no = v_no where id = p_id;
  elsif p_kind = 'plan' then update public.payments set bir_invoice_no = v_no where id = p_id;
  elsif p_kind = 'addon' then update public.addon_invoices set bir_invoice_no = v_no where id = p_id and status = 'paid';
  elsif p_kind = 'load' then update public.load_topups set bir_invoice_no = v_no where id = p_id and status = 'paid';
  elsif p_kind = 'gbill' then update public.gov_bills set bir_invoice_no = v_no where id = p_id and status in ('processing','paid');
  elsif p_kind = 'credit' then update public.partner_credits set bir_invoice_no = v_no where id = p_id and kind = 'topup';
  else raise exception 'Unknown payment.' using errcode = '22023'; end if;
  if not found then raise exception 'Payment not found.' using errcode = 'P0002'; end if;
end $function$;

-- Staff may open a city bill's files while they pay it (every open is logged, as before).
CREATE OR REPLACE FUNCTION public.staff_open_file(p_path text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid; v_parts text[]; v_name text; v_reason text; v_staff text;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  v_parts := string_to_array(p_path, '/');
  begin v_org := v_parts[1]::uuid; exception when others then raise exception 'Bad file path.' using errcode = '22023'; end;
  if v_parts[2] = 'requests' then
    select a.requirement_name || ' — ' || a.subject_label into v_reason
      from public.assistance_requests a where a.org_id = v_org and a.id::text = v_parts[3];
    if v_reason is null then raise exception 'This file is not part of a request.' using errcode = '42501'; end if;
    v_name := v_parts[array_length(v_parts, 1)];
  elsif v_parts[2] = 'billing' then
    select 'Payment proof, bill ' || i.number into v_reason from public.addon_invoices i where i.org_id = v_org and i.id::text = v_parts[3] and i.proof_path = p_path;
    if v_reason is null then raise exception 'This file is not part of a bill.' using errcode = '42501'; end if;
    v_name := v_parts[array_length(v_parts, 1)];
  elsif v_parts[2] = 'load' then
    select 'Payment proof, load top-up ' || t.number into v_reason from public.load_topups t where t.org_id = v_org and t.id::text = v_parts[3] and t.proof_path = p_path;
    if v_reason is null then raise exception 'This file is not part of a top-up.' using errcode = '42501'; end if;
    v_name := v_parts[array_length(v_parts, 1)];
  elsif v_parts[2] = 'papers' then
    select 'Papers check: ' || c.requirement_name, f.file_name into v_reason, v_name
      from public.papers_check_files f join public.papers_checks c on c.id = f.check_id
      where f.storage_path = p_path and c.org_id = v_org and c.id::text = v_parts[3]
        and (c.status = 'waiting' or (c.status = 'answered' and c.answered_at > now() - interval '7 days'));
    if v_reason is null then raise exception 'You can only open papers while their check is open (or for 7 days after answering).' using errcode = '42501'; end if;
  elsif v_parts[2] = 'bills' then
    -- a city bill PermitPal is paying: the bill, the customer's payment proof and the receipt, while it's open (and 30 days after)
    select 'City bill ' || b.number || ': ' || b.label into v_reason from public.gov_bills b
      where b.org_id = v_org and p_path in (b.bill_path, b.proof_path, b.or_path) and b.mode = 'permitpal'
        and (b.status in ('pending_verification','processing') or coalesce(b.paid_at, b.refunded_at) > now() - interval '30 days');
    if v_reason is null then raise exception 'You can only open a bill''s files while we''re paying it (or for 30 days after).' using errcode = '42501'; end if;
    v_name := v_parts[array_length(v_parts, 1)];
  elsif v_parts[2] = 'care' then
    select coalesce((select 'Care bill ' || i.number from public.care_invoices i where i.org_id = v_org and i.id::text = v_parts[3] and i.proof_path = p_path),
                    (select 'Guarantee claim: ' || g.requirement_name from public.guarantee_claims g where g.org_id = v_org and g.id::text = v_parts[3] and g.receipt_path = p_path),
                    (select 'Guarantee claim: ' || g.requirement_name from public.guarantee_claims g where g.org_id = v_org and g.receipt_path = p_path))
      into v_reason;
    if v_reason is null then raise exception 'This file is not part of a care bill or claim.' using errcode = '42501'; end if;
    v_name := v_parts[array_length(v_parts, 1)];
  else
    select d.file_name, a.requirement_name || ' — ' || a.subject_label into v_name, v_reason
      from public.documents d
      join public.assistance_requests a on a.requirement_id = d.requirement_id and a.status not in ('completed','cancelled')
      where d.storage_path = p_path and d.org_id = v_org and d.deleted_at is null
      limit 1;
    if v_name is null then
      -- the permit's own documents, while a papers check for it is open
      select d.file_name, 'Papers check: ' || c.requirement_name into v_name, v_reason
        from public.documents d
        join public.papers_checks c on c.requirement_id = d.requirement_id
          and (c.status = 'waiting' or (c.status = 'answered' and c.answered_at > now() - interval '7 days'))
        where d.storage_path = p_path and d.org_id = v_org and d.deleted_at is null
        limit 1;
    end if;
    if v_name is null then raise exception 'You can only open a customer''s files while they have an open request for that permit.' using errcode = '42501'; end if;
  end if;
  if not exists (select 1 from public.org_members m where m.org_id = v_org and m.user_id = auth.uid()) then
    select coalesce(nullif(btrim(p.first_name || ' ' || p.last_name), ''), 'PermitPal staff') into v_staff from public.profiles p where p.id = auth.uid();
    insert into public.staff_file_access (org_id, staff_id, staff_name, file_path, file_name, reason)
    values (v_org, auth.uid(), coalesce(v_staff, 'PermitPal staff'), p_path, regexp_replace(v_name, '^[a-z0-9]{6,}-', ''),
      case when v_parts[2] in ('care','billing','load','bills') or v_reason like 'Papers check: %' then v_reason else 'Request: ' || v_reason end);
  end if;
  return v_name;
end $function$;

-- ================================================================ who may call what
do $$ declare f text; begin
  foreach f in array array['public.filing_save(uuid,uuid,text,text,date,text,integer,text,date,boolean,text,integer)', 'public.filing_close(uuid,text,date)',
    'public.filing_letter(uuid,text,text)', 'public.admin_start_filing(uuid,text,text,date,text,integer)', 'public.admin_filings()',
    'public.admin_set_holiday(date,text,text,boolean)', 'public.bill_add(uuid,uuid,text,text,numeric,date,text,text,text)',
    'public.bill_report(uuid,text,text,text,text)', 'public.bill_cancel(uuid)', 'public.bill_paid_self(uuid,text,date,text,text)',
    'public.admin_bill_received(uuid,boolean,text,text)', 'public.admin_bill_paid(uuid,text,date,text,text)', 'public.admin_bill_refund(uuid,text,text,text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  execute 'revoke all on function public.pp_staff_bill_upload(text) from public, anon';
  execute 'grant execute on function public.pp_staff_bill_upload(text) to authenticated';
  foreach f in array array['private.is_workday(date)', 'private.add_workdays(date,integer)', 'private.workdays_between(date,date)',
    'private.clock_ready()', 'private.bills_ready()', 'private.app_setting(text)', 'private.req_for_edit(uuid)', 'private.req_activity(uuid,text,uuid,text,text)',
    'private.notify_req(uuid,text,text,text,text,text)', 'private.bill_file_receipt(uuid)', 'private.clock_daily()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- ================================================================ every morning, 7:30 am Manila
select cron.schedule('pp-clock-daily', '30 23 * * *', $$select private.clock_daily()$$);

insert into private.features (name) values ('clock'), ('billpay') on conflict do nothing;

commit;
