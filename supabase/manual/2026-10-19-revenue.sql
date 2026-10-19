-- PermitPal: the three ways PermitPal earns (one-time jobs, Year-round care, fees from other businesses)
-- and the staff Money views. All or nothing: if anything fails, nothing is changed.
--
-- Order matters:
--   1. If you haven't yet, run 2026-10-17-new-features.sql first (it fixes the quote-request bug too).
--   2. Then paste this whole file into Supabase → SQL Editor → Run, once.
-- New features appear on the website by themselves once this has run.
begin;

do $$ declare v_mfa boolean := false; v_done boolean := false; begin
  if to_regclass('private.features') is not null then
    execute $q$select exists (select 1 from private.features where name = 'mfa'), exists (select 1 from private.features where name = 'revenue')$q$ into v_mfa, v_done;
  end if;
  if not v_mfa then raise exception 'Run supabase/manual/2026-10-17-new-features.sql first, then run this file. Nothing was changed.'; end if;
  if v_done then raise exception 'This file was already run. Nothing was changed.'; end if;
end $$;

-- ======================================================================== 20261019002200_revenue.sql
-- PermitPal earns three ways, and staff can track every peso in one place.
-- 1) One-time jobs ("Done for you"): a rush fee shown up front, several permits in one request,
--    "set up my account for me" (with temporary staff access the customer can see and remove),
--    package steps the customer can follow, and pre-inspection walk-throughs.
-- 2) Year-round care: a monthly or yearly fee per branch or vehicle. PermitPal starts every covered
--    renewal itself. Care Plus adds an on-time guarantee (we pay the late penalty if we miss a
--    deadline) and one walk-through a year per branch.
-- 3) Fees from other businesses: per quote request, per sale, a flat monthly listing, or one quiet,
--    labelled line on the matching checklist step. Monthly statements per firm. Firms can apply.
-- 4) Money: one ledger for staff across all of it, including the BIR invoice number of every payment.
-- Insurance: the Insurance Code (Sec. 307) only lets licensed agents and brokers be paid for getting
-- someone insured, so insurers can only pay a flat listing fee until PermitPal's licence is on file.

-- ================================================================ helpers
create sequence if not exists private.money_no;
-- Readable numbers for care bills (C-2026-00001) and partner statements (P-2026-00001).
create or replace function private.next_no(p_prefix text) returns text
language sql volatile security definer set search_path = '' as $$
  select p_prefix || '-' || to_char(private.today_ph(), 'YYYY') || '-' || lpad(nextval('private.money_no')::text, 5, '0')
$$;
create or replace function private.ph_day(p_ts timestamptz) returns date
language sql stable set search_path = '' as $$ select (p_ts at time zone 'Asia/Manila')::date $$;
create or replace function private.peso(p numeric) returns text
language sql immutable set search_path = '' as $$ select '₱' || to_char(coalesce(p, 0), 'FM999,999,990.00') $$;

-- Owners (and admins, where said) of a workspace, for notices.
create or replace function private.notify_owners(p_org uuid, p_title text, p_body text, p_link text, p_key text,
  p_email boolean default true, p_admins boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare v record;
begin
  for v in select user_id from public.org_members where org_id = p_org and (role = 'owner' or (p_admins and role = 'admin')) loop
    perform private.notify(v.user_id, p_org, 'billing', p_title, p_body, p_link, null, p_key || ':' || v.user_id, p_email);
  end loop;
end $$;
revoke all on function private.next_no(text), private.notify_owners(uuid,text,text,text,text,boolean,boolean) from public, anon, authenticated;

-- ================================================================ 2) year-round care: prices
create table if not exists public.care_tiers (
  code          text primary key check (code ~ '^[a-z0-9_]{2,40}$'),
  subject       text not null check (subject in ('branch','vehicle')),
  name          text not null check (length(btrim(name)) between 1 and 60),
  monthly_php   numeric(12,2) not null check (monthly_php >= 0),
  yearly_php    numeric(12,2) not null check (yearly_php >= 0),
  guarantee     boolean not null default false,
  guarantee_cap_php numeric(12,2) not null default 0 check (guarantee_cap_php >= 0),
  walkthroughs  int not null default 0 check (walkthroughs between 0 and 12),
  includes      text[] not null default '{}',
  active        boolean not null default true,
  sort          int not null default 100,
  updated_at    timestamptz not null default now()
);
drop trigger if exists care_tiers_touch on public.care_tiers;
create trigger care_tiers_touch before update on public.care_tiers for each row execute function private.touch_updated_at();
alter table public.care_tiers enable row level security;
drop policy if exists care_tiers_read on public.care_tiers;
create policy care_tiers_read on public.care_tiers for select to anon, authenticated using (active or (select private.is_platform_admin()));
drop policy if exists care_tiers_admin_update on public.care_tiers;
create policy care_tiers_admin_update on public.care_tiers for update to authenticated
  using ((select private.is_platform_admin())) with check ((select private.is_platform_admin()));
revoke insert, delete on public.care_tiers from anon, authenticated;
grant select on public.care_tiers to anon;

insert into public.care_tiers (code, subject, name, monthly_php, yearly_php, guarantee, guarantee_cap_php, walkthroughs, includes, sort) values
  ('branch_care', 'branch', 'Care', 1500, 15000, false, 0, 0,
   array['We start every renewal for this branch before it''s due','Our service fee is included: you only pay government fees, at cost','Official receipts and the new permits saved for you','One person to message about everything'], 10),
  ('branch_plus', 'branch', 'Care Plus', 2000, 20000, true, 10000, 1,
   array['Everything in Care','On-time guarantee: if we miss a deadline, we pay the late penalty (up to ₱10,000 per permit)','One fire or sanitary pre-inspection walk-through a year'], 20),
  ('vehicle_care', 'vehicle', 'Care', 300, 3000, false, 0, 0,
   array['Registration, CTPL, emission test and inspection handled every year','Our service fee is included: you only pay government fees and the premium, at cost','The new OR/CR saved for you'], 30),
  ('vehicle_plus', 'vehicle', 'Care Plus', 400, 4000, true, 3000, 0,
   array['Everything in Care','On-time guarantee: if we miss the deadline, we pay the late penalty (up to ₱3,000)'], 40)
on conflict (code) do nothing;

-- Government fees the customer lets us accept for them on a care renewal, per renewal.
alter table public.orgs add column if not exists care_gov_preapproval_php numeric(12,2) not null default 0
  check (care_gov_preapproval_php between 0 and 200000);

-- ================================================================ care plans, bills, guarantee claims
create table if not exists public.care_plans (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  tier          text not null references public.care_tiers(code),
  location_id   uuid references public.business_locations(id) on delete cascade,
  vehicle_id    uuid references public.vehicles(id) on delete cascade,
  business_id   uuid references public.businesses(id) on delete cascade,
  label         text not null check (length(label) <= 300),
  billing       text not null check (billing in ('monthly','yearly')),
  price_php     numeric(12,2) not null check (price_php >= 0),
  status        text not null default 'pending' check (status in ('pending','active','paused','cancelled')),
  started_on    date,
  paid_through  date,
  cancel_at     date,
  ended_reason  text check (ended_reason is null or length(ended_reason) <= 500),
  consented_at  timestamptz not null,
  created_by    uuid default auth.uid() references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check ((location_id is null) <> (vehicle_id is null))
);
create index if not exists care_plans_org on public.care_plans(org_id);
create unique index if not exists care_plans_live_location on public.care_plans(location_id) where status <> 'cancelled' and location_id is not null;
create unique index if not exists care_plans_live_vehicle on public.care_plans(vehicle_id) where status <> 'cancelled' and vehicle_id is not null;
drop trigger if exists care_plans_touch on public.care_plans;
create trigger care_plans_touch before update on public.care_plans for each row execute function private.touch_updated_at();
alter table public.care_plans enable row level security;
drop policy if exists care_plans_read on public.care_plans;
create policy care_plans_read on public.care_plans for select to authenticated
  using (org_id in (select private.my_org_ids()) or (select private.is_platform_admin()));
revoke insert, update, delete on public.care_plans from anon, authenticated;
revoke all on public.care_plans from anon;

create table if not exists public.care_invoices (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  number        text not null unique,
  first         boolean not null default false,     -- the sign-up bill: coverage starts when it is paid
  period_start  date not null,
  period_end    date not null check (period_end >= period_start),
  lines         jsonb not null check (jsonb_typeof(lines) = 'array'),
  amount_php    numeric(12,2) not null check (amount_php >= 0),
  status        text not null default 'due' check (status in ('due','pending_verification','paid','void')),
  due_on        date not null,
  pay_method    text check (pay_method is null or pay_method in ('gcash','maya','bank_transfer','cash','other')),
  pay_ref       text check (pay_ref is null or length(pay_ref) <= 120),
  proof_path    text,
  proof_name    text check (proof_name is null or length(proof_name) <= 255),
  reported_at   timestamptz,
  paid_at       timestamptz,
  bir_invoice_no text check (bir_invoice_no is null or length(bir_invoice_no) <= 60),
  note          text check (note is null or length(note) <= 500),
  created_at    timestamptz not null default now()
);
create index if not exists care_invoices_org on public.care_invoices(org_id, created_at desc);
alter table public.care_invoices enable row level security;
drop policy if exists care_invoices_read on public.care_invoices;
create policy care_invoices_read on public.care_invoices for select to authenticated
  using (org_id in (select private.my_org_ids()) or (select private.is_platform_admin()));
revoke insert, update, delete on public.care_invoices from anon, authenticated;
revoke all on public.care_invoices from anon;

create table if not exists public.guarantee_claims (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id) on delete cascade,
  plan_id        uuid not null references public.care_plans(id) on delete cascade,
  requirement_id uuid references public.requirements(id) on delete set null,
  requirement_name text not null,
  lapsed_on      date not null,
  penalty_php    numeric(12,2) not null check (penalty_php > 0 and penalty_php <= 1000000),
  note           text check (note is null or length(note) <= 1000),
  receipt_path   text not null,
  receipt_name   text check (receipt_name is null or length(receipt_name) <= 255),
  status         text not null default 'submitted' check (status in ('submitted','approved','declined','paid')),
  approved_php   numeric(12,2) check (approved_php is null or approved_php >= 0),
  decision_note  text check (decision_note is null or length(decision_note) <= 1000),
  decided_at     timestamptz,
  paid_at        timestamptz,
  paid_method    text check (paid_method is null or length(paid_method) <= 60),
  paid_ref       text check (paid_ref is null or length(paid_ref) <= 120),
  created_by     uuid default auth.uid() references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (requirement_id, lapsed_on)
);
create index if not exists guarantee_claims_org on public.guarantee_claims(org_id);
alter table public.guarantee_claims enable row level security;
drop policy if exists guarantee_claims_read on public.guarantee_claims;
create policy guarantee_claims_read on public.guarantee_claims for select to authenticated
  using (org_id in (select private.my_org_ids()) or (select private.is_platform_admin()));
revoke insert, update, delete on public.guarantee_claims from anon, authenticated;
revoke all on public.guarantee_claims from anon;

-- Which permits a plan covers: everything for that vehicle, or everything for that branch
-- (and, for the main branch, the registrations that cover the whole business). Not staff licences.
create or replace function private.care_covered(p_plan uuid) returns table (requirement_id uuid)
language sql stable security definer set search_path = '' as $$
  select r.id from public.care_plans p
  join public.requirements r on r.org_id = p.org_id and r.deleted_at is null and r.subject <> 'person'
  left join public.business_locations l on l.id = p.location_id
  where p.id = p_plan and (
    (p.vehicle_id is not null and r.vehicle_id = p.vehicle_id)
    or (p.location_id is not null and r.business_id = l.business_id
        and (r.location_id = p.location_id or (r.location_id is null and l.is_main))))
$$;
-- For the app: the plan covering each permit in a workspace.
create or replace function public.care_coverage(p_org uuid) returns table (requirement_id uuid, plan_id uuid, tier text, status text, paid_through date)
language sql stable security definer set search_path = '' as $$
  select c.requirement_id, p.id, p.tier, p.status, p.paid_through
  from public.care_plans p cross join lateral private.care_covered(p.id) c
  where p.org_id = p_org and p.status <> 'cancelled' and p_org in (select private.my_org_ids())
$$;
revoke all on function private.care_covered(uuid) from public, anon, authenticated;
revoke all on function public.care_coverage(uuid) from public, anon;
grant execute on function public.care_coverage(uuid) to authenticated;

-- ================================================================ 1) one-time jobs
alter table public.services
  add column if not exists rush_fee numeric(12,2) check (rush_fee is null or rush_fee >= 0),
  add column if not exists steps text[] not null default '{}',
  add column if not exists visit boolean not null default false,
  add column if not exists needs_access boolean not null default false;

insert into public.services (code, name, category, summary, includes, price_from, price_unit, turnaround, applies_to, type_codes, sort, steps, needs_access) values
  ('setup_from_paper', 'Set up my account for me', 'package',
   'Send us photos or scans of your permits, registrations and OR/CRs. We enter everything into PermitPal with the right dates, attach each file, switch on your reminders, and list what''s missing or about to expire.',
   array['Every permit entered with its dates and file','What''s missing or expiring, listed for you','Reminders checked and switched on','Temporary access that ends when we finish'],
   1500, 'up to 20 documents, then ₱50 each', '2-5 working days', 'any', '{}', 200,
   array['Photos or scans received','Businesses, branches and vehicles added','Permits entered with dates and files','What''s missing or expiring, listed for you','Reminders checked and on'], true)
on conflict (code) do nothing;

update public.services s set rush_fee = v.fee from (values
  ('renew_mayors_permit', 1000), ('renew_barangay_clearance', 500), ('renew_fsic', 800), ('renew_sanitary_permit', 500),
  ('renew_lto_registration', 500), ('renew_dti_business_name', 300), ('renew_philgeps', 800), ('renew_other', 800),
  ('pkg_new_business', 5000), ('pkg_new_branch', 3000), ('pkg_amendment', 2000), ('doc_replacement', 500), ('doc_bir_update', 1000),
  ('apply_dole_registration', 500), ('setup_from_paper', 1000)) v(code, fee)
where s.code = v.code and s.rush_fee is null;

update public.services s set steps = v.steps from (values
  ('pkg_new_business', array['Business name or company registered (DTI, SEC or CDA)','Barangay clearance','Mayor''s Permit','BIR registration (COR)','Books and invoices registered with BIR','Everything saved to your account']),
  ('pkg_new_branch', array['Barangay clearance','Mayor''s Permit','Fire safety inspection (FSIC)','BIR branch registration','Everything saved to your account']),
  ('pkg_amendment', array['What has to change, listed for you','Filed with each agency','Updated documents saved to your account']),
  ('pkg_closure', array['Retirement filed at the city or municipal hall','BIR closure filed','Proof of closure saved to your account'])) v(code, steps)
where s.code = v.code and s.steps = '{}';

update public.services set name = 'Pre-inspection walk-through (fire or sanitary)', visit = true, price_unit = 'per site visit',
  summary = 'We visit before the fire or sanitary inspector does and give you a written list of what to fix first, so you pass the first time.',
  includes = array['On-site walk-through using the official checklist','Written list of fixes, most important first','Photos of each item','Saved to your account'],
  type_codes = array['fsic','sanitary_permit','annual_building_inspection'], turnaround = 'Scheduled with you, usually within 5 working days'
where code = 'adv_fire_preinspection';

-- Year-round care is now a real plan (below), not a quote request.
update public.services set active = false where code in ('plan_branch_care', 'plan_vehicle_care');

alter table public.assistance_requests
  add column if not exists quote_rush_fee numeric(12,2) not null default 0 check (quote_rush_fee >= 0),
  add column if not exists steps_done int not null default 0 check (steps_done between 0 and 50),
  add column if not exists batch_id uuid,
  add column if not exists care_plan_id uuid references public.care_plans(id) on delete set null,
  add column if not exists staff_access boolean not null default false,
  add column if not exists bir_invoice_no text check (bir_invoice_no is null or length(bir_invoice_no) <= 60);
create index if not exists assistance_requests_batch on public.assistance_requests(batch_id) where batch_id is not null;
create index if not exists assistance_requests_care on public.assistance_requests(care_plan_id) where care_plan_id is not null;

-- Customers can't set or change these; staff, the order functions and the daily job can.
-- A walk-through for a branch on Care Plus is marked as included (once a year per branch).
create or replace function private.assistance_revenue_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_trusted boolean := auth.uid() is null or private.is_platform_admin() or coalesce(current_setting('pp.order_rpc', true), 'off') = 'on';
  v_plan uuid;
begin
  if tg_op = 'INSERT' then
    if not v_trusted then
      new.quote_rush_fee := 0; new.steps_done := 0; new.batch_id := null; new.care_plan_id := null;
      new.staff_access := false; new.bir_invoice_no := null;
    end if;
    if new.care_plan_id is null and new.requirement_id is not null
       and exists (select 1 from public.services s where s.code = new.service_code and s.visit) then
      select p.id into v_plan from public.care_plans p
        join public.care_tiers t on t.code = p.tier
        join public.requirements r on r.id = new.requirement_id and r.location_id = p.location_id
      where p.org_id = new.org_id and p.status = 'active' and t.walkthroughs > 0
        and (select count(*) from public.assistance_requests a join public.services s on s.code = a.service_code and s.visit
             where a.care_plan_id = p.id and a.status <> 'cancelled' and a.created_at > now() - interval '1 year') < t.walkthroughs
      limit 1;
      new.care_plan_id := v_plan;
    end if;
    return new;
  end if;
  if not v_trusted then
    new.quote_rush_fee := old.quote_rush_fee; new.steps_done := old.steps_done; new.batch_id := old.batch_id;
    new.care_plan_id := old.care_plan_id; new.staff_access := old.staff_access; new.bir_invoice_no := old.bir_invoice_no;
  end if;
  return new;
end $$;
drop trigger if exists assistance_revenue_guard on public.assistance_requests;
create trigger assistance_revenue_guard before insert or update on public.assistance_requests
  for each row execute function private.assistance_revenue_guard();

-- The renewal service for a permit type (the first active match, else "any other permit").
create or replace function private.renewal_service_for(p_type text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select s.code from public.services s where s.active and s.category = 'renewal' and p_type = any(s.type_codes) order by s.sort, s.code limit 1),
    (select s.code from public.services s where s.active and s.code = 'renew_other'))
$$;
revoke all on function private.renewal_service_for(text) from public, anon, authenticated;

-- New orders: who gets told. Unchanged for one request; several permits in one request send one note
-- (from the bulk function); renewals started by a care plan tell the owners and admins.
create or replace function private.assistance_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_org_name text;
  v_requester text;
  v_contact text;
  v_body text;
  v_m record;
begin
  select name into v_org_name from public.orgs where id = new.org_id;

  if tg_op = 'INSERT' then
    if new.care_plan_id is not null and new.created_by is null then
      insert into public.request_events (request_id, org_id, actor_id, by_staff, kind, message)
      values (new.id, new.org_id, null, true, 'created', 'Started automatically by your Year-round care plan.');
      for v_m in select user_id from public.org_members where org_id = new.org_id and role in ('owner','admin') loop
        perform private.notify(v_m.user_id, new.org_id, 'help', 'We''ve started your ' || new.requirement_name || ' renewal',
          new.subject_label || '. Covered by your Year-round care plan: we''ll send you the government fees to approve, then take care of the rest.',
          '#/services/orders/' || new.id, new.requirement_id, 'carestart:' || new.id || ':' || v_m.user_id, true);
      end loop;
      perform private.notify_admins('Care renewal to quote: ' || new.requirement_name, v_org_name || ' - ' || new.subject_label ||
        case when new.due_on is not null then ', due ' || private.fmt_date(new.due_on) else '' end, 'carenew:' || new.id, false);
      return null;
    end if;
    insert into public.request_events (request_id, org_id, actor_id, by_staff, kind, message)
    values (new.id, new.org_id, new.created_by, false, 'created', coalesce(nullif(btrim(new.notes), ''), 'Request sent'));
    if coalesce(current_setting('pp.bulk', true), 'off') = 'on' then return null; end if;
    select coalesce(nullif(btrim(p.first_name || ' ' || p.last_name), ''), p.email), p.email into v_requester, v_contact
      from public.profiles p where p.id = new.created_by;
    v_body := v_org_name || ' - ' || new.requirement_name || ' for ' || new.subject_label ||
              case when new.due_on is not null then ', due ' || private.fmt_date(new.due_on) else '' end ||
              case when new.rush then ' - RUSH' else '' end ||
              case when new.care_plan_id is not null then ' - included in Care Plus' else '' end ||
              '. Requested by ' || coalesce(v_requester, '-') || ' (' || coalesce(v_contact, '-') || '), contact via ' ||
              new.contact_method || coalesce(': ' || new.contact_value, '') || '. Notes: ' || coalesce(new.notes, '-');
    perform private.notify_admins('New request: ' || new.requirement_name, v_body, 'ordernew:' || new.id, true);
    if new.created_by is not null then
      perform private.notify(new.created_by, new.org_id, 'help', 'We received your request',
        new.requirement_name || ' for ' || new.subject_label || '. You''ll get an exact quote before anything starts.',
        '#/services/orders/' || new.id, new.requirement_id, 'orderack:' || new.id, true);
    end if;
    return null;
  end if;

  if new.status is distinct from old.status then
    if new.created_by is not null and (auth.uid() is null or private.is_platform_admin()) then
      perform private.notify(new.created_by, new.org_id, 'help',
        new.requirement_name || ': ' || private.help_status_label(new.status),
        new.subject_label || case when new.admin_note is not null then '. ' || new.admin_note else '' end,
        '#/services/orders/' || new.id, new.requirement_id,
        'orderupd:' || new.id || ':' || new.status || ':' || extract(epoch from new.updated_at)::bigint, true);
    elsif new.created_by is null and new.care_plan_id is not null and (auth.uid() is null or private.is_platform_admin()) then
      for v_m in select user_id from public.org_members where org_id = new.org_id and role in ('owner','admin') loop
        perform private.notify(v_m.user_id, new.org_id, 'help', new.requirement_name || ': ' || private.help_status_label(new.status),
          new.subject_label || case when new.admin_note is not null then '. ' || new.admin_note else '' end,
          '#/services/orders/' || new.id, new.requirement_id,
          'orderupd:' || new.id || ':' || new.status || ':' || extract(epoch from new.updated_at)::bigint || ':' || v_m.user_id, true);
      end loop;
    end if;
    if new.status = 'cancelled' and auth.uid() is not null and not private.is_platform_admin() then
      perform private.notify_admins('Request cancelled: ' || new.requirement_name, v_org_name || ' - ' || new.subject_label,
        'ordercancel:' || new.id, false);
      insert into public.request_events (request_id, org_id, by_staff, kind, message)
      values (new.id, new.org_id, false, 'cancelled', 'Cancelled by the customer');
    end if;
  end if;
  return null;
end $$;

-- Customer requests: renewals started by a care plan don't count toward the hourly limit.
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
  if (select count(*) from public.assistance_requests where org_id = p_org and status not in ('completed','cancelled') and care_plan_id is null) >= 25 then
    raise exception 'You have 25 open requests. Wait for some to finish, or cancel ones you no longer need.' using errcode = 'P0001';
  end if;
  if (select count(distinct coalesce(batch_id, id)) from public.assistance_requests
      where org_id = p_org and created_at > now() - interval '1 hour' and (care_plan_id is null or created_by is not null)) >= 10 then
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

-- Customer: renew several permits in one go. One order per permit (each tracked on its own),
-- one email to PermitPal and one note to the customer.
create or replace function public.request_services_bulk(p_org uuid, p_reqs uuid[], p_rush boolean default false,
  p_contact_method text default 'email', p_contact_value text default null, p_notes text default null, p_consent boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_batch uuid := gen_random_uuid();
  v_n int := coalesce(cardinality(p_reqs), 0);
  v_r record; v_svc text; v_found int := 0; v_names text[] := '{}'; v_org text; v_who text;
begin
  if p_org is null or p_org not in (select private.my_writable_org_ids()) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if not coalesce(p_consent, false) then
    raise exception 'Please tick the box to confirm PermitPal may act for you on these permits.' using errcode = '22023';
  end if;
  if v_n = 0 then raise exception 'Choose at least one permit.' using errcode = '22023'; end if;
  if v_n > 25 then raise exception 'Choose up to 25 permits at a time.' using errcode = '22023'; end if;
  if (select count(distinct x) from unnest(p_reqs) x) <> v_n then raise exception 'A permit was chosen twice.' using errcode = '22023'; end if;
  if coalesce(p_contact_method, 'email') not in ('email','phone','whatsapp','viber') then raise exception 'Choose how we should reach you.' using errcode = '22023'; end if;
  if (select count(*) from public.assistance_requests where org_id = p_org and status not in ('completed','cancelled') and care_plan_id is null) + v_n > 25 then
    raise exception 'That would make more than 25 open requests. Choose fewer, or wait for some to finish.' using errcode = 'P0001';
  end if;
  if (select count(distinct coalesce(batch_id, id)) from public.assistance_requests
      where org_id = p_org and created_at > now() - interval '1 hour' and (care_plan_id is null or created_by is not null)) >= 10 then
    raise exception 'That''s a lot of requests in one hour. Please try again a little later, or message us.' using errcode = 'P0001';
  end if;
  perform set_config('pp.order_rpc', 'on', true);
  perform set_config('pp.bulk', 'on', true);
  for v_r in select rs.id, rs.name, rs.subject, rs.type_code, rs.open_request_id, rs.cycle_id, rs.subject_name
             from public.requirement_status rs where rs.id = any(p_reqs) and rs.org_id = p_org order by rs.name loop
    if v_r.subject = 'person' then raise exception '% is a staff licence. Ask for it on its own page.', v_r.name using errcode = 'P0001'; end if;
    if v_r.open_request_id is not null then raise exception '% (%) already has an open request.', v_r.name, v_r.subject_name using errcode = 'P0001'; end if;
    v_svc := private.renewal_service_for(v_r.type_code);
    if v_svc is null then raise exception 'We can''t take % right now. Message us instead.', v_r.name using errcode = 'P0001'; end if;
    insert into public.assistance_requests (org_id, service_code, requirement_id, requirement_name, subject_label, notes, rush,
      contact_method, contact_value, docs_status, kind, consented_at, batch_id)
    values (p_org, v_svc, v_r.id, '-', '-', nullif(btrim(p_notes), ''), coalesce(p_rush, false), coalesce(p_contact_method, 'email'),
      nullif(btrim(p_contact_value), ''), 'not_sure', case when v_r.cycle_id is null then 'apply' else 'renew' end, now(), v_batch);
    v_found := v_found + 1;
    v_names := v_names || (v_r.name || ' (' || coalesce(v_r.subject_name, '') || ')');
  end loop;
  perform set_config('pp.bulk', 'off', true);
  perform set_config('pp.order_rpc', 'off', true);
  if v_found <> v_n then raise exception 'One of those permits was not found. Refresh the page and try again.' using errcode = 'P0002'; end if;
  select name into v_org from public.orgs where id = p_org;
  select coalesce(nullif(btrim(first_name || ' ' || last_name), ''), email) || ' (' || email || ')' into v_who from public.profiles where id = auth.uid();
  perform private.notify_admins('New request: ' || v_n || ' permits' || case when p_rush then ' - RUSH' else '' end,
    v_org || ' - ' || array_to_string(v_names, '; ') || '. Requested by ' || coalesce(v_who, '-') || ', contact via ' ||
    coalesce(p_contact_method, 'email') || coalesce(': ' || nullif(btrim(p_contact_value), ''), '') || '. Notes: ' || coalesce(nullif(btrim(p_notes), ''), '-'),
    'orderbatch:' || v_batch, true);
  perform private.notify(auth.uid(), p_org, 'help', 'We received your request for ' || v_n || ' permits',
    'You''ll get an exact quote for each one within 1 business day. Nothing starts until you accept.', '#/services', null, 'orderbatchack:' || v_batch, true);
  return v_batch;
end $$;
revoke all on function public.request_services_bulk(uuid,uuid[],boolean,text,text,text,boolean) from public, anon;
grant execute on function public.request_services_bulk(uuid,uuid[],boolean,text,text,text,boolean) to authenticated;

-- Staff: the quote now has its own rush fee line. A care renewal with no service fee is accepted for
-- the customer when the government fees are within what they pre-approved.
drop function if exists public.admin_quote_request(uuid, numeric, numeric, text);
create or replace function public.admin_quote_request(p_req uuid, p_service_fee numeric, p_gov_fees numeric, p_note text default null, p_rush_fee numeric default 0)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_a public.assistance_requests; v_rush numeric := coalesce(p_rush_fee, 0); v_gov numeric := coalesce(p_gov_fees, 0);
  v_total numeric; v_pre numeric := 0; v_auto boolean := false;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  if p_service_fee is null or p_service_fee < 0 or v_gov < 0 or v_rush < 0 then raise exception 'Enter valid amounts.' using errcode = '22023'; end if;
  select * into v_a from public.assistance_requests where id = p_req;
  if v_a.id is null then raise exception 'Request not found.' using errcode = 'P0002'; end if;
  if v_rush > 0 and not v_a.rush then raise exception 'The customer didn''t ask for this to be rushed. Leave the rush fee at 0.' using errcode = '22023'; end if;
  if v_a.status not in ('submitted','quoted','awaiting_customer') or v_a.payment_status in ('paid','waived','pending_verification') then
    raise exception 'This request can no longer be quoted.' using errcode = 'P0001';
  end if;
  v_total := p_service_fee + v_rush + v_gov;
  if v_a.care_plan_id is not null and v_a.created_by is null and p_service_fee = 0 and v_rush = 0 then
    select coalesce(o.care_gov_preapproval_php, 0) into v_pre from public.orgs o where o.id = v_a.org_id;
    v_auto := v_gov <= v_pre;
  end if;
  update public.assistance_requests set quote_service_fee = p_service_fee, quote_rush_fee = v_rush, quote_gov_fees = v_gov,
    quote_php = v_total, quote_note = nullif(btrim(p_note), ''), quoted_at = now(),
    accepted_at = case when v_auto then now() end,
    payment_status = case when v_auto and v_total = 0 then 'waived' when v_auto then 'awaiting_payment' else 'unpaid' end,
    status = case when v_auto and v_total = 0 then 'in_progress' when v_auto then 'awaiting_customer' else 'quoted' end,
    admin_note = case when v_auto and v_total > 0 then 'Government fees ' || private.peso(v_gov) || ', within the amount you pre-approved. Pay to start.' end
  where id = p_req;
  perform private.order_event(p_req, 'quote', 'Quote: ' || private.peso(v_total) || ' (service fee ' || private.peso(p_service_fee) ||
    case when v_rush > 0 then ', rush fee ' || private.peso(v_rush) else '' end || ', government fees ' || private.peso(v_gov) || ')' ||
    coalesce('. ' || nullif(btrim(p_note), ''), ''));
  if v_auto then
    perform private.order_event(p_req, 'accepted', 'Accepted for you: the government fees are within the ' || private.peso(v_pre) || ' you pre-approved for care renewals.');
  end if;
end $$;
revoke all on function public.admin_quote_request(uuid,numeric,numeric,text,numeric) from public, anon;
grant execute on function public.admin_quote_request(uuid,numeric,numeric,text,numeric) to authenticated;

-- Customer: accept the quote. "Set up my account" also needs the customer's OK for temporary access.
drop function if exists public.accept_quote(uuid);
create or replace function public.accept_quote(p_req uuid, p_access boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare v_a public.assistance_requests; v_needs boolean;
begin
  select * into v_a from public.assistance_requests where id = p_req;
  if v_a.id is null or v_a.org_id not in (select private.my_writable_org_ids()) then raise exception 'Request not found.' using errcode = '42501'; end if;
  if v_a.status <> 'quoted' then raise exception 'There is no quote to accept.' using errcode = 'P0001'; end if;
  select coalesce(s.needs_access, false) into v_needs from public.services s where s.code = v_a.service_code;
  if coalesce(v_needs, false) and not coalesce(p_access, false) then
    raise exception 'Tick the box to give PermitPal temporary access, so we can set things up for you.' using errcode = '22023';
  end if;
  perform set_config('pp.order_rpc', 'on', true);
  update public.assistance_requests set accepted_at = now(), staff_access = coalesce(v_needs, false),
    payment_status = case when coalesce(v_a.quote_php, 0) = 0 then 'waived' else 'awaiting_payment' end,
    status = case when coalesce(v_a.quote_php, 0) = 0 then 'in_progress' else 'awaiting_customer' end
  where id = p_req;
  perform set_config('pp.order_rpc', 'off', true);
  perform private.order_event(p_req, 'accepted', 'Quote accepted' || case when coalesce(v_needs, false) then '. PermitPal may join this workspace until the job is done.' else '' end);
  perform private.notify_admins('Quote accepted: ' || v_a.requirement_name, v_a.subject_label, 'orderacc:' || p_req, true);
end $$;
revoke all on function public.accept_quote(uuid, boolean) from public, anon;
grant execute on function public.accept_quote(uuid, boolean) to authenticated;

-- Staff: tick off a package's steps; the customer sees them on the order.
create or replace function public.admin_order_step(p_req uuid, p_done int) returns void
language plpgsql security definer set search_path = '' as $$
declare v_a public.assistance_requests; v_steps text[]; v_total int;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select * into v_a from public.assistance_requests where id = p_req;
  if v_a.id is null then raise exception 'Order not found.' using errcode = 'P0002'; end if;
  select s.steps into v_steps from public.services s where s.code = v_a.service_code;
  v_total := coalesce(cardinality(v_steps), 0);
  if v_total = 0 then raise exception 'This service has no steps.' using errcode = 'P0001'; end if;
  if p_done is null or p_done < 0 or p_done > v_total then raise exception 'Choose a step between 0 and %.', v_total using errcode = '22023'; end if;
  if v_a.status in ('completed','cancelled') then raise exception 'This order is closed.' using errcode = 'P0001'; end if;
  update public.assistance_requests set steps_done = p_done where id = p_req;
  perform private.order_event(p_req, 'status', case when p_done > v_a.steps_done
    then 'Step ' || p_done || ' of ' || v_total || ' done: ' || v_steps[p_done]
    else 'Progress updated: ' || p_done || ' of ' || v_total || ' steps done' end);
  if v_a.created_by is not null then
    perform private.notify(v_a.created_by, v_a.org_id, 'help', 'Progress on your request: ' || p_done || ' of ' || v_total || ' steps done',
      v_a.requirement_name || case when p_done > 0 then '. Done: ' || v_steps[p_done] else '' end,
      '#/services/orders/' || p_req, null, 'orderstep:' || p_req || ':' || p_done || ':' || extract(epoch from clock_timestamp())::bigint, false);
  end if;
end $$;
revoke all on function public.admin_order_step(uuid, int) from public, anon;
grant execute on function public.admin_order_step(uuid, int) to authenticated;

-- ---------------------------------------------------------------- temporary staff access (set-up jobs)
create table if not exists private.staff_memberships (
  org_id      uuid not null references public.orgs(id) on delete cascade,
  user_id     uuid not null,
  request_id  uuid not null references public.assistance_requests(id) on delete cascade,
  joined_at   timestamptz not null default now(),
  ended_at    timestamptz,
  primary key (org_id, user_id, request_id)
);

create or replace function public.admin_join_workspace(p_req uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_a public.assistance_requests; v_org text;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select * into v_a from public.assistance_requests where id = p_req;
  if v_a.id is null then raise exception 'Order not found.' using errcode = 'P0002'; end if;
  if not v_a.staff_access then raise exception 'The customer hasn''t given PermitPal access for this order.' using errcode = '42501'; end if;
  if v_a.status in ('completed','cancelled') then raise exception 'This order is closed.' using errcode = 'P0001'; end if;
  if v_a.payment_status not in ('paid','waived') then raise exception 'Wait until the order is paid, then join.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.org_members where org_id = v_a.org_id and user_id = auth.uid()) then return v_a.org_id; end if;
  insert into public.org_members (org_id, user_id, role) values (v_a.org_id, auth.uid(), 'member');
  insert into private.staff_memberships (org_id, user_id, request_id) values (v_a.org_id, auth.uid(), p_req) on conflict do nothing;
  select name into v_org from public.orgs where id = v_a.org_id;
  perform private.order_event(p_req, 'status', 'PermitPal joined your workspace to do the set-up. Access ends automatically when this order is done, and you can remove it anytime under Team.');
  perform private.notify_owners(v_a.org_id, 'PermitPal joined ' || v_org || ' to set it up',
    'For your "' || v_a.requirement_name || '" order. Access ends automatically when the job is done. You can remove it anytime under Team.',
    '#/team', 'staffjoin:' || p_req, true, true);
  return v_a.org_id;
end $$;
revoke all on function public.admin_join_workspace(uuid) from public, anon;
grant execute on function public.admin_join_workspace(uuid) to authenticated;

-- Access ends when the order is done or cancelled (or if the customer removes it, or after 30 days).
create or replace function private.end_staff_access() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v record;
begin
  if new.status in ('completed','cancelled') and old.status not in ('completed','cancelled') then
    for v in select * from private.staff_memberships where request_id = new.id and ended_at is null loop
      delete from public.org_members where org_id = v.org_id and user_id = v.user_id and role = 'member';
      update private.staff_memberships set ended_at = now() where org_id = v.org_id and user_id = v.user_id and request_id = v.request_id;
      update public.profiles set current_org_id = null where id = v.user_id and current_org_id = v.org_id;
      insert into public.request_events (request_id, org_id, by_staff, kind, message)
      values (new.id, new.org_id, true, 'status', 'PermitPal''s access to your workspace has ended.');
    end loop;
  end if;
  return null;
end $$;
drop trigger if exists assistance_end_staff_access on public.assistance_requests;
create trigger assistance_end_staff_access after update of status on public.assistance_requests
  for each row execute function private.end_staff_access();

create or replace function private.staff_member_left() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update private.staff_memberships set ended_at = now() where org_id = old.org_id and user_id = old.user_id and ended_at is null;
  return null;
end $$;
drop trigger if exists org_members_staff_left on public.org_members;
create trigger org_members_staff_left after delete on public.org_members for each row execute function private.staff_member_left();

-- Members see who from PermitPal has temporary access, and why.
create or replace function public.my_staff_access(p_org uuid) returns table (user_id uuid, request_id uuid, requirement_name text, joined_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.user_id, s.request_id, a.requirement_name, s.joined_at
  from private.staff_memberships s join public.assistance_requests a on a.id = s.request_id
  where s.org_id = p_org and s.ended_at is null and p_org in (select private.my_org_ids())
$$;
revoke all on function public.my_staff_access(uuid) from public, anon;
grant execute on function public.my_staff_access(uuid) to authenticated;

-- Staff can open care payment screenshots and guarantee receipts too (each open is logged).
create or replace function public.staff_open_file(p_path text) returns text
language plpgsql security definer set search_path = '' as $$
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
    if v_name is null then raise exception 'You can only open a customer''s files while they have an open request for that permit.' using errcode = '42501'; end if;
  end if;
  if not exists (select 1 from public.org_members m where m.org_id = v_org and m.user_id = auth.uid()) then
    select coalesce(nullif(btrim(p.first_name || ' ' || p.last_name), ''), 'PermitPal staff') into v_staff from public.profiles p where p.id = auth.uid();
    insert into public.staff_file_access (org_id, staff_id, staff_name, file_path, file_name, reason)
    values (v_org, auth.uid(), coalesce(v_staff, 'PermitPal staff'), p_path, regexp_replace(v_name, '^[a-z0-9]{6,}-', ''),
      case when v_parts[2] = 'care' then v_reason else 'Request: ' || v_reason end);
  end if;
  return v_name;
end $$;
revoke execute on function public.staff_open_file(text) from public, anon;
grant execute on function public.staff_open_file(text) to authenticated;

-- ================================================================ 2) year-round care: customer actions
-- Start care for branches and vehicles. Coverage starts the day the first bill is paid.
create or replace function public.start_care(p_org uuid, p_items jsonb, p_billing text, p_consent boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_item jsonb; v_tier public.care_tiers; v_plan uuid; v_lines jsonb := '[]'::jsonb; v_total numeric := 0; v_label text;
  v_inv uuid; v_today date := private.today_ph(); v_end date; v_price numeric; v_id uuid; v_l record; v_v record;
  v_org text; v_no text; v_n int := 0;
begin
  if p_org is null or p_org not in (select private.my_owner_org_ids()) then
    raise exception 'Only the workspace owner can start a paid plan.' using errcode = '42501';
  end if;
  if not coalesce(p_consent, false) then raise exception 'Please tick the box to confirm.' using errcode = '22023'; end if;
  if coalesce(p_billing, '') not in ('monthly','yearly') then raise exception 'Choose monthly or yearly.' using errcode = '22023'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Choose at least one branch or vehicle.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 50 then raise exception 'Choose up to 50 at a time.' using errcode = '22023'; end if;
  if (select count(*) from public.care_invoices where org_id = p_org and status = 'due' and first) >= 3 then
    raise exception 'You have 3 sign-up bills waiting for payment. Pay or cancel those first.' using errcode = 'P0001';
  end if;
  v_end := case p_billing when 'monthly' then (v_today + interval '1 month')::date - 1 else (v_today + interval '1 year')::date - 1 end;
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_tier from public.care_tiers where code = v_item ->> 'tier' and active;
    if v_tier.code is null then raise exception 'That care plan is not available.' using errcode = '22023'; end if;
    begin v_id := (v_item ->> 'id')::uuid; exception when others then raise exception 'That branch or vehicle was not found.' using errcode = 'P0002'; end;
    v_price := case p_billing when 'monthly' then v_tier.monthly_php else v_tier.yearly_php end;
    if v_item ->> 'kind' = 'location' and v_tier.subject = 'branch' then
      select l.id, l.business_id, l.name, l.city, b.name as bname into v_l
        from public.business_locations l join public.businesses b on b.id = l.business_id
        where l.id = v_id and l.org_id = p_org and l.deleted_at is null and b.deleted_at is null;
      if v_l.id is null then raise exception 'That branch was not found.' using errcode = 'P0002'; end if;
      v_label := v_l.bname || ' · ' || v_l.name || coalesce(' (' || nullif(v_l.city, '') || ')', '');
      if exists (select 1 from public.care_plans where location_id = v_id and status <> 'cancelled') then
        raise exception '% already has a care plan.', v_label using errcode = 'P0001';
      end if;
      insert into public.care_plans (org_id, tier, location_id, business_id, label, billing, price_php, consented_at)
      values (p_org, v_tier.code, v_id, v_l.business_id, v_label, p_billing, v_price, now()) returning id into v_plan;
    elsif v_item ->> 'kind' = 'vehicle' and v_tier.subject = 'vehicle' then
      select v.id, v.make_model, v.plate_no, v.business_id into v_v from public.vehicles v where v.id = v_id and v.org_id = p_org and v.deleted_at is null;
      if v_v.id is null then raise exception 'That vehicle was not found.' using errcode = 'P0002'; end if;
      v_label := v_v.make_model || case when coalesce(v_v.plate_no, '') <> '' then ' · ' || v_v.plate_no else '' end;
      if exists (select 1 from public.care_plans where vehicle_id = v_id and status <> 'cancelled') then
        raise exception '% already has a care plan.', v_label using errcode = 'P0001';
      end if;
      insert into public.care_plans (org_id, tier, vehicle_id, business_id, label, billing, price_php, consented_at)
      values (p_org, v_tier.code, v_id, v_v.business_id, v_label, p_billing, v_price, now()) returning id into v_plan;
    else
      raise exception 'That plan doesn''t match what you chose.' using errcode = '22023';
    end if;
    v_lines := v_lines || jsonb_build_object('plan_id', v_plan, 'label', v_label, 'tier', v_tier.name, 'amount', v_price);
    v_total := v_total + v_price;
    v_n := v_n + 1;
  end loop;
  v_no := private.next_no('C');
  insert into public.care_invoices (org_id, number, first, period_start, period_end, lines, amount_php, due_on)
  values (p_org, v_no, true, v_today, v_end, v_lines, v_total, v_today + 3) returning id into v_inv;
  select name into v_org from public.orgs where id = p_org;
  perform private.notify_admins('New Year-round care sign-up: ' || v_org,
    v_n || ' branch/vehicle plan(s), ' || private.peso(v_total) || ' per ' || case p_billing when 'monthly' then 'month' else 'year' end ||
    '. Bill ' || v_no || ' is waiting for payment.', 'carenew:' || v_inv, true);
  return v_inv;
end $$;

-- Take a plan off any bill that isn't paid yet; a bill with nothing left on it is cancelled.
create or replace function private.drop_plan_from_unpaid(p_plan uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v record; v_lines jsonb;
begin
  for v in select * from public.care_invoices where status = 'due' and lines @> jsonb_build_array(jsonb_build_object('plan_id', p_plan)) loop
    select coalesce(jsonb_agg(e), '[]'::jsonb) into v_lines from jsonb_array_elements(v.lines) e where e ->> 'plan_id' <> p_plan::text;
    if jsonb_array_length(v_lines) = 0 then
      update public.care_invoices set status = 'void', lines = v_lines, note = 'Cancelled: nothing left on this bill.' where id = v.id;
    else
      update public.care_invoices set lines = v_lines, amount_php = (select coalesce(sum((e ->> 'amount')::numeric), 0) from jsonb_array_elements(v_lines) e)
      where id = v.id;
    end if;
  end loop;
end $$;

-- Cancel: a plan that isn't paid yet ends now; a paid plan runs to the end of what's paid.
create or replace function public.cancel_care(p_plan uuid, p_reason text default null) returns date
language plpgsql security definer set search_path = '' as $$
declare v_p public.care_plans; v_today date := private.today_ph(); v_org text; v_on date;
begin
  select * into v_p from public.care_plans where id = p_plan;
  if v_p.id is null or v_p.org_id not in (select private.my_owner_org_ids()) then raise exception 'Only the workspace owner can cancel a plan.' using errcode = '42501'; end if;
  if v_p.status = 'cancelled' then raise exception 'This plan is already cancelled.' using errcode = 'P0001'; end if;
  if v_p.status = 'pending' or v_p.paid_through is null or v_p.paid_through < v_today then
    update public.care_plans set status = 'cancelled', cancel_at = v_today, ended_reason = coalesce(nullif(btrim(p_reason), ''), 'Cancelled by the owner') where id = p_plan;
    v_on := v_today;
  else
    update public.care_plans set cancel_at = v_p.paid_through, ended_reason = coalesce(nullif(btrim(p_reason), ''), 'Cancelled by the owner') where id = p_plan;
    v_on := v_p.paid_through;
  end if;
  perform private.drop_plan_from_unpaid(p_plan);
  select name into v_org from public.orgs where id = v_p.org_id;
  perform private.notify_admins('Care cancelled: ' || v_org, v_p.label || '. Ends ' || private.fmt_date(v_on) || coalesce('. Reason: ' || nullif(btrim(p_reason), ''), ''),
    'carecancel:' || p_plan, false);
  return v_on;
end $$;

-- Changed their mind before the end date: keep the plan going.
create or replace function public.resume_care(p_plan uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_p public.care_plans;
begin
  select * into v_p from public.care_plans where id = p_plan;
  if v_p.id is null or v_p.org_id not in (select private.my_owner_org_ids()) then raise exception 'Only the workspace owner can change a plan.' using errcode = '42501'; end if;
  if v_p.status not in ('active','paused') or v_p.cancel_at is null then raise exception 'This plan isn''t set to end. Start a new plan instead.' using errcode = 'P0001'; end if;
  update public.care_plans set cancel_at = null, ended_reason = null where id = p_plan;
end $$;

-- Government fees PermitPal may accept for you on each care renewal (0 = always ask).
create or replace function public.set_care_preapproval(p_org uuid, p_amount numeric) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_org is null or p_org not in (select private.my_admin_org_ids()) then raise exception 'Only owners and admins can change this.' using errcode = '42501'; end if;
  if p_amount is null or p_amount < 0 or p_amount > 200000 then raise exception 'Enter an amount from ₱0 to ₱200,000.' using errcode = '22023'; end if;
  update public.orgs set care_gov_preapproval_php = round(p_amount, 2) where id = p_org;
end $$;

-- Paid a care bill by GCash, Maya or bank transfer: send the reference for checking.
create or replace function public.pay_care_invoice(p_invoice uuid, p_method text, p_ref text, p_proof_path text default null, p_proof_name text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_i public.care_invoices; v_org text;
begin
  select * into v_i from public.care_invoices where id = p_invoice;
  if v_i.id is null or v_i.org_id not in (select private.my_writable_org_ids()) then raise exception 'Bill not found.' using errcode = '42501'; end if;
  if v_i.status not in ('due','pending_verification') then raise exception 'This bill is already paid or was cancelled.' using errcode = 'P0001'; end if;
  if coalesce(p_method, '') not in ('gcash','maya','bank_transfer','other') then raise exception 'Choose how you paid.' using errcode = '22023'; end if;
  if coalesce(btrim(p_ref), '') = '' and p_proof_path is null then raise exception 'Add the reference number or a screenshot of the payment.' using errcode = '22023'; end if;
  if p_proof_path is not null and p_proof_path not like v_i.org_id::text || '/care/' || v_i.id::text || '/%' then
    raise exception 'Invalid file location.' using errcode = '42501';
  end if;
  update public.care_invoices set status = 'pending_verification', pay_method = p_method, pay_ref = nullif(btrim(p_ref), ''),
    proof_path = coalesce(p_proof_path, proof_path), proof_name = coalesce(p_proof_name, proof_name), reported_at = now(), note = null
  where id = p_invoice;
  select name into v_org from public.orgs where id = v_i.org_id;
  perform private.notify_admins('Care payment to confirm: ' || v_i.number,
    v_org || ' - ' || private.peso(v_i.amount_php) || ' via ' || replace(p_method, '_', ' ') || coalesce(', ref ' || nullif(btrim(p_ref), ''), ''),
    'carepay:' || p_invoice || ':' || extract(epoch from now())::bigint, true);
end $$;

-- Care Plus: claim the on-time guarantee for a late penalty.
create or replace function public.file_guarantee_claim(p_plan uuid, p_requirement uuid, p_penalty numeric, p_note text,
  p_receipt_path text, p_receipt_name text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_p public.care_plans; v_t public.care_tiers; v_lapse date; v_today date := private.today_ph(); v_name text; v_id uuid; v_org text;
begin
  select * into v_p from public.care_plans where id = p_plan;
  if v_p.id is null or v_p.org_id not in (select private.my_writable_org_ids()) then raise exception 'Plan not found.' using errcode = '42501'; end if;
  select * into v_t from public.care_tiers where code = v_p.tier;
  if not v_t.guarantee then raise exception 'The on-time guarantee comes with Care Plus. This plan is %.', v_t.name using errcode = 'P0001'; end if;
  if v_p.status = 'pending' or v_p.started_on is null then raise exception 'This plan hasn''t started yet.' using errcode = 'P0001'; end if;
  if p_requirement is null or p_requirement not in (select requirement_id from private.care_covered(p_plan)) then
    raise exception 'That permit isn''t covered by this plan.' using errcode = 'P0001';
  end if;
  select max(c.expires_on) into v_lapse from public.requirement_cycles c
    where c.requirement_id = p_requirement and c.deleted_at is null and c.expires_on < v_today;
  if v_lapse is null then raise exception 'This permit hasn''t lapsed: there''s no past expiry date on file for it.' using errcode = 'P0001'; end if;
  if v_lapse < v_today - 90 then raise exception 'Claims must be made within 90 days of the permit''s expiry date (%).', private.fmt_date(v_lapse) using errcode = 'P0001'; end if;
  if v_p.started_on > v_lapse - 30 then
    raise exception 'The guarantee covers permits that were in your plan at least 30 days before they expired. This one expired %, % days after the plan started.',
      private.fmt_date(v_lapse), v_lapse - v_p.started_on using errcode = 'P0001';
  end if;
  if v_p.paid_through is null or v_p.paid_through < v_lapse then
    raise exception 'The plan wasn''t paid up on the expiry date (%), so the guarantee doesn''t apply.', private.fmt_date(v_lapse) using errcode = 'P0001';
  end if;
  if p_penalty is null or p_penalty <= 0 or p_penalty > 1000000 then raise exception 'Enter the penalty you paid, in pesos.' using errcode = '22023'; end if;
  if p_receipt_path is null or p_receipt_path not like v_p.org_id::text || '/care/%' then
    raise exception 'Attach the official receipt that shows the penalty.' using errcode = '22023';
  end if;
  if exists (select 1 from public.guarantee_claims where requirement_id = p_requirement and lapsed_on = v_lapse) then
    raise exception 'You already sent a claim for this permit''s % expiry.', private.fmt_date(v_lapse) using errcode = 'P0001';
  end if;
  select name into v_name from public.requirements where id = p_requirement;
  insert into public.guarantee_claims (org_id, plan_id, requirement_id, requirement_name, lapsed_on, penalty_php, note, receipt_path, receipt_name)
  values (v_p.org_id, p_plan, p_requirement, v_name, v_lapse, round(p_penalty, 2), nullif(btrim(p_note), ''), p_receipt_path, p_receipt_name)
  returning id into v_id;
  select name into v_org from public.orgs where id = v_p.org_id;
  perform private.notify_admins('Guarantee claim: ' || v_org, v_name || ' (' || v_p.label || ') expired ' || private.fmt_date(v_lapse) ||
    '. Penalty ' || private.peso(p_penalty) || '. Decide within 5 business days.', 'claim:' || v_id, true);
  return v_id;
end $$;

do $$ declare f text; begin
  foreach f in array array['public.start_care(uuid,jsonb,text,boolean)', 'public.cancel_care(uuid,text)', 'public.resume_care(uuid)',
    'public.set_care_preapproval(uuid,numeric)', 'public.pay_care_invoice(uuid,text,text,text,text)',
    'public.file_guarantee_claim(uuid,uuid,numeric,text,text,text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function private.drop_plan_from_unpaid(uuid) from public, anon, authenticated;

-- ================================================================ 2) year-round care: staff actions
create or replace function public.admin_confirm_care_payment(p_invoice uuid, p_ok boolean, p_note text default null, p_invoice_no text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_i public.care_invoices; v_today date := private.today_ph(); v_billing text; v_start date; v_end date; v_e jsonb; v_through date;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select * into v_i from public.care_invoices where id = p_invoice for update;
  if v_i.id is null then raise exception 'Bill not found.' using errcode = 'P0002'; end if;
  if not coalesce(p_ok, false) then
    if v_i.status <> 'pending_verification' then raise exception 'Nothing to check on this bill.' using errcode = 'P0001'; end if;
    update public.care_invoices set status = 'due', note = coalesce(nullif(btrim(p_note), ''), 'We could not find this payment. Please check the reference number and send it again.')
    where id = p_invoice;
    perform private.notify_owners(v_i.org_id, 'We couldn''t match your payment for bill ' || v_i.number,
      coalesce(nullif(btrim(p_note), ''), 'Please check the reference number and send it again.'), '#/care', 'carenomatch:' || p_invoice || ':' || extract(epoch from now())::bigint, true, true);
    return;
  end if;
  if v_i.status not in ('due','pending_verification') then raise exception 'This bill is already paid or was cancelled.' using errcode = 'P0001'; end if;
  v_start := v_i.period_start; v_end := v_i.period_end;
  if v_i.first or v_i.period_start < v_today - 7 then
    -- Coverage starts the day the sign-up bill is paid. A bill paid after the plan was paused restarts
    -- coverage from today too: nobody pays for weeks when we weren't working for them.
    select p.billing into v_billing from public.care_plans p where p.id = ((v_i.lines -> 0) ->> 'plan_id')::uuid;
    v_start := v_today;
    v_end := case coalesce(v_billing, 'monthly') when 'monthly' then (v_today + interval '1 month')::date - 1 else (v_today + interval '1 year')::date - 1 end;
  end if;
  update public.care_invoices set status = 'paid', paid_at = now(), period_start = v_start, period_end = v_end,
    bir_invoice_no = coalesce(nullif(btrim(p_invoice_no), ''), bir_invoice_no), note = nullif(btrim(p_note), '')
  where id = p_invoice;
  for v_e in select * from jsonb_array_elements(v_i.lines) loop
    update public.care_plans set status = case when status = 'cancelled' then status else 'active' end,
      started_on = coalesce(started_on, v_start), paid_through = greatest(coalesce(paid_through, v_start - 1), v_end)
    where id = (v_e ->> 'plan_id')::uuid;
  end loop;
  select max(paid_through) into v_through from public.care_plans where id in (select (e ->> 'plan_id')::uuid from jsonb_array_elements(v_i.lines) e);
  perform private.notify_owners(v_i.org_id,
    case when v_i.first then 'Year-round care is on' else 'Payment received: thank you' end,
    'Bill ' || v_i.number || ' (' || private.peso(v_i.amount_php) || ') is paid. Covered until ' || private.fmt_date(v_through) || '.',
    '#/care', 'carepaid:' || p_invoice, true, true);
end $$;

create or replace function public.admin_void_care_invoice(p_invoice uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_i public.care_invoices; v_e jsonb;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select * into v_i from public.care_invoices where id = p_invoice;
  if v_i.id is null or v_i.status not in ('due','pending_verification') then raise exception 'Only unpaid bills can be cancelled.' using errcode = 'P0001'; end if;
  if length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'Say why (the customer sees it).' using errcode = '22023'; end if;
  update public.care_invoices set status = 'void', note = btrim(p_note) where id = p_invoice;
  if v_i.first then
    for v_e in select * from jsonb_array_elements(v_i.lines) loop
      update public.care_plans set status = 'cancelled', cancel_at = private.today_ph(), ended_reason = btrim(p_note)
      where id = (v_e ->> 'plan_id')::uuid and status = 'pending';
    end loop;
  end if;
  perform private.notify_owners(v_i.org_id, 'Bill ' || v_i.number || ' was cancelled', btrim(p_note), '#/care', 'carevoid:' || p_invoice, true, true);
end $$;

create or replace function public.admin_set_care_plan(p_plan uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_p public.care_plans;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select * into v_p from public.care_plans where id = p_plan;
  if v_p.id is null then raise exception 'Plan not found.' using errcode = 'P0002'; end if;
  if p_status not in ('active','paused','cancelled') then raise exception 'Choose active, paused or cancelled.' using errcode = '22023'; end if;
  if v_p.status = 'cancelled' then raise exception 'This plan is already cancelled.' using errcode = 'P0001'; end if;
  if p_status = 'active' and (v_p.paid_through is null or v_p.paid_through < private.today_ph()) then
    raise exception 'Confirm a payment first: the plan isn''t paid up.' using errcode = 'P0001';
  end if;
  if length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'Say why (the customer sees it).' using errcode = '22023'; end if;
  update public.care_plans set status = p_status, ended_reason = case when p_status = 'cancelled' then btrim(p_note) else ended_reason end,
    cancel_at = case when p_status = 'cancelled' then private.today_ph() else cancel_at end where id = p_plan;
  if p_status = 'cancelled' then perform private.drop_plan_from_unpaid(p_plan); end if;
  perform private.notify_owners(v_p.org_id, 'Care plan ' || case p_status when 'active' then 'is active again' when 'paused' then 'paused' else 'ended' end || ': ' || v_p.label,
    btrim(p_note), '#/care', 'careset:' || p_plan || ':' || p_status || ':' || extract(epoch from now())::bigint, true, true);
end $$;

create or replace function public.admin_decide_claim(p_claim uuid, p_approve boolean, p_amount numeric, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_c public.guarantee_claims; v_cap numeric; v_amt numeric;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select * into v_c from public.guarantee_claims where id = p_claim;
  if v_c.id is null or v_c.status <> 'submitted' then raise exception 'This claim was already decided.' using errcode = 'P0001'; end if;
  select t.guarantee_cap_php into v_cap from public.care_plans p join public.care_tiers t on t.code = p.tier where p.id = v_c.plan_id;
  if p_approve then
    v_amt := least(coalesce(p_amount, v_c.penalty_php), v_c.penalty_php, coalesce(v_cap, 0));
    if v_amt <= 0 then raise exception 'Enter the amount to pay back.' using errcode = '22023'; end if;
    update public.guarantee_claims set status = 'approved', approved_php = v_amt, decision_note = nullif(btrim(p_note), ''), decided_at = now() where id = p_claim;
  else
    if length(btrim(coalesce(p_note, ''))) < 10 then raise exception 'Explain why it''s declined (the customer sees it).' using errcode = '22023'; end if;
    update public.guarantee_claims set status = 'declined', decision_note = btrim(p_note), decided_at = now() where id = p_claim;
  end if;
  perform private.notify_owners(v_c.org_id, 'Guarantee claim ' || case when p_approve then 'approved: ' || private.peso(v_amt) else 'declined' end,
    v_c.requirement_name || coalesce('. ' || nullif(btrim(p_note), ''), '') || case when p_approve then '. We''ll send the money within 5 business days.' else '' end,
    '#/care', 'claimdec:' || p_claim, true, true);
end $$;

create or replace function public.admin_claim_paid(p_claim uuid, p_method text, p_ref text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_c public.guarantee_claims;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select * into v_c from public.guarantee_claims where id = p_claim;
  if v_c.id is null or v_c.status <> 'approved' then raise exception 'Approve the claim first.' using errcode = 'P0001'; end if;
  update public.guarantee_claims set status = 'paid', paid_at = now(), paid_method = nullif(btrim(p_method), ''), paid_ref = nullif(btrim(p_ref), '') where id = p_claim;
  perform private.notify_owners(v_c.org_id, 'Guarantee paid: ' || private.peso(v_c.approved_php), v_c.requirement_name ||
    coalesce('. Sent by ' || nullif(btrim(p_method), ''), '') || coalesce(', ref ' || nullif(btrim(p_ref), ''), '') || '.', '#/care', 'claimpaid:' || p_claim, true, true);
end $$;

do $$ declare f text; begin
  foreach f in array array['public.admin_confirm_care_payment(uuid,boolean,text,text)', 'public.admin_void_care_invoice(uuid,text)',
    'public.admin_set_care_plan(uuid,text,text)', 'public.admin_decide_claim(uuid,boolean,numeric,text)', 'public.admin_claim_paid(uuid,text,text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ================================================================ 2) year-round care: the daily job
create or replace function private.care_daily() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := private.today_ph(); v_n int := 0; v record; v_g record; v_lines jsonb; v_total numeric; v_inv uuid; v_no text; v_end date;
begin
  -- 1) Plans set to end, and plans whose branch or vehicle was deleted.
  for v in select p.* from public.care_plans p where p.status in ('active','paused') and p.cancel_at is not null and p.cancel_at <= v_today loop
    update public.care_plans set status = 'cancelled' where id = v.id;
    perform private.drop_plan_from_unpaid(v.id);
    perform private.notify_owners(v.org_id, 'Year-round care ended: ' || v.label, 'As you asked. Your permits stay in PermitPal and reminders keep coming.',
      '#/care', 'careend:' || v.id, true, false);
  end loop;
  for v in select p.* from public.care_plans p
           left join public.business_locations l on l.id = p.location_id left join public.businesses b on b.id = l.business_id
           left join public.vehicles ve on ve.id = p.vehicle_id
           where p.status <> 'cancelled' and (l.deleted_at is not null or b.deleted_at is not null or ve.deleted_at is not null) loop
    update public.care_plans set status = 'cancelled', cancel_at = v_today, ended_reason = 'The branch or vehicle was deleted.' where id = v.id;
    perform private.drop_plan_from_unpaid(v.id);
    perform private.notify_owners(v.org_id, 'Year-round care ended: ' || v.label, 'The branch or vehicle was deleted, so its plan ended. Restore it from Trash and start a new plan if that was a mistake.',
      '#/care', 'caredel:' || v.id, true, false);
  end loop;

  -- 2) Next bills, 7 days before the paid period ends (one bill per workspace per end date).
  for v_g in select p.org_id, p.billing, p.paid_through, jsonb_agg(jsonb_build_object('plan_id', p.id, 'label', p.label, 'tier', t.name, 'amount', p.price_php) order by p.label) as lines,
                    sum(p.price_php) as total
             from public.care_plans p join public.care_tiers t on t.code = p.tier
             where p.status in ('active','paused') and p.cancel_at is null and p.paid_through is not null and p.paid_through - v_today <= 7
               and not exists (select 1 from public.care_invoices i where i.status <> 'void' and i.period_start = p.paid_through + 1
                               and i.lines @> jsonb_build_array(jsonb_build_object('plan_id', p.id)))
             group by p.org_id, p.billing, p.paid_through loop
    v_end := case v_g.billing when 'monthly' then (v_g.paid_through + 1 + interval '1 month')::date - 1 else (v_g.paid_through + 1 + interval '1 year')::date - 1 end;
    v_no := private.next_no('C');
    insert into public.care_invoices (org_id, number, period_start, period_end, lines, amount_php, due_on)
    values (v_g.org_id, v_no, v_g.paid_through + 1, v_end, v_g.lines, v_g.total, greatest(v_g.paid_through, v_today)) returning id into v_inv;
    perform private.notify_owners(v_g.org_id, 'Your Year-round care bill: ' || private.peso(v_g.total),
      'Bill ' || v_no || ' covers ' || private.fmt_date(v_g.paid_through + 1) || ' to ' || private.fmt_date(v_end) || '. Please pay by ' || private.fmt_date(greatest(v_g.paid_through, v_today)) || '.',
      '#/care', 'carebill:' || v_inv, true, true);
    v_n := v_n + 1;
  end loop;

  -- 3) Overdue reminders (the day after, then a week after).
  for v in select * from public.care_invoices where status = 'due' and due_on < v_today and (v_today - due_on) in (1, 7) loop
    perform private.notify_owners(v.org_id, 'Care bill ' || v.number || ' is overdue',
      private.peso(v.amount_php) || ' was due ' || private.fmt_date(v.due_on) || '. After 7 days we pause renewals and the on-time guarantee until it''s paid.',
      '#/care', 'careover:' || v.id || ':' || (v_today - v.due_on), true, true);
  end loop;

  -- 4) Not paid 7 days after coverage ran out: pause (no new renewals, no guarantee) until paid.
  for v in select * from public.care_plans where status = 'active' and paid_through is not null and paid_through < v_today - 7 loop
    update public.care_plans set status = 'paused' where id = v.id;
    perform private.notify_owners(v.org_id, 'Year-round care paused: ' || v.label,
      'The bill isn''t paid yet, so we''ve paused new renewals and the on-time guarantee. Pay the bill and everything starts again the same day.',
      '#/care', 'carepause:' || v.id || ':' || v.paid_through, true, true);
  end loop;

  -- 5) Start covered renewals: 60 days ahead for business permits, 45 for vehicles, and anything already overdue.
  for v in select distinct on (rs.id) rs.id, rs.org_id, rs.type_code, rs.subject, rs.expires_on, p.id as plan_id, p.consented_at,
             (select pr.email from public.org_members m join public.profiles pr on pr.id = m.user_id
              where m.org_id = p.org_id and m.role = 'owner' order by m.created_at limit 1) as owner_email
           from public.care_plans p
           cross join lateral private.care_covered(p.id) c
           join public.requirement_status rs on rs.id = c.requirement_id
           where p.status = 'active' and p.paid_through >= v_today and rs.expires and rs.expires_on is not null
             and rs.expires_on <= v_today + case when rs.subject = 'vehicle' then 45 else 60 end
             and rs.open_request_id is null and rs.renewal_started_at is null
             and private.renewal_service_for(rs.type_code) is not null
             -- once per expiry date: if the customer cancelled the one we started, we don't start it again
             and not exists (select 1 from public.assistance_requests a where a.requirement_id = rs.id and a.care_plan_id is not null
                              and a.created_by is null and a.due_on = rs.expires_on)
           order by rs.id, p.created_at loop
    insert into public.assistance_requests (org_id, service_code, requirement_id, requirement_name, subject_label, notes, rush,
      contact_method, contact_value, docs_status, kind, consented_at, care_plan_id)
    values (v.org_id, private.renewal_service_for(v.type_code), v.id, '-', '-', 'Started by your Year-round care plan.', false,
      'email', v.owner_email, 'not_sure', 'renew', v.consented_at, v.plan_id);
    v_n := v_n + 1;
  end loop;

  -- 6) Temporary staff access never outlives 30 days.
  for v in select * from private.staff_memberships where ended_at is null and joined_at < now() - interval '30 days' loop
    delete from public.org_members where org_id = v.org_id and user_id = v.user_id and role = 'member';
    update private.staff_memberships set ended_at = now() where org_id = v.org_id and user_id = v.user_id and request_id = v.request_id;
  end loop;
  return v_n;
end $$;
revoke all on function private.care_daily() from public, anon, authenticated;

-- ================================================================ 3) fees from other businesses
-- Fix: "Permit & registration filing" firms (liaison) are offered in the admin form but the database refused them.
alter table public.partners drop constraint if exists partners_category_check;
alter table public.partners add constraint partners_category_check check (category in ('liaison','insurance','emission_testing',
  'vehicle_inspection','pest_control','fire_safety','health_clinic','notary','bookkeeping','other'));

-- How each firm pays: per quote request (lead_fee_php), per sale (flat or %), a flat monthly listing, or nothing.
alter table public.partners
  add column if not exists fee_model text not null default 'per_lead'
    check (fee_model in ('per_lead','per_sale_flat','per_sale_percent','monthly','none')),
  add column if not exists sale_fee_php numeric(10,2) check (sale_fee_php is null or sale_fee_php >= 0),
  add column if not exists sale_pct numeric(5,2) check (sale_pct is null or sale_pct between 0 and 50),
  add column if not exists monthly_fee_php numeric(10,2) check (monthly_fee_php is null or monthly_fee_php >= 0),
  add column if not exists billing_email text not null default '' check (length(billing_email) <= 160);
-- Insurers can't pay per lead or per sale without an Insurance Commission licence (see the guard below).
update public.partners set fee_model = 'none' where category = 'insurance' and coalesce(lead_fee_php, 0) > 0;

create or replace function private.partner_fee_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.category = 'insurance' and coalesce(btrim(private.setting('ic_licence_no')), '') = ''
     and ((new.fee_model = 'per_lead' and coalesce(new.lead_fee_php, 0) > 0)
       or (new.fee_model = 'per_sale_flat' and coalesce(new.sale_fee_php, 0) > 0)
       or (new.fee_model = 'per_sale_percent' and coalesce(new.sale_pct, 0) > 0)) then
    raise exception 'Insurance rule: only a licensed insurance agent or broker may be paid per quote request or per sale (Insurance Code, Sec. 307). Choose "Flat monthly listing" or "No fee", or add your Insurance Commission licence number in Admin > Money first.'
      using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists partners_fee_guard on public.partners;
create trigger partners_fee_guard before insert or update of category, fee_model, lead_fee_php, sale_fee_php, sale_pct on public.partners
  for each row execute function private.partner_fee_guard();

alter table public.referrals
  add column if not exists placement_id uuid,
  add column if not exists sale_php numeric(12,2) check (sale_php is null or sale_php >= 0),
  add column if not exists sold_at timestamptz;

-- One quiet, labelled line on the matching checklist step. One firm per step per city at a time.
create table if not exists public.partner_placements (
  id              uuid primary key default gen_random_uuid(),
  partner_id      uuid not null references public.partners(id) on delete cascade,
  type_code       text not null references public.requirement_types(code),
  item_key        text check (item_key is null or item_key ~ '^[a-z0-9_]{1,40}$'),
  cities          text[] not null default '{}',
  headline        text not null check (length(btrim(headline)) between 5 and 90),
  starts_on       date not null,
  ends_on         date not null,
  monthly_fee_php numeric(10,2) not null default 0 check (monthly_fee_php >= 0),
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (ends_on >= starts_on and ends_on <= starts_on + 731)
);
alter table public.referrals drop constraint if exists referrals_placement_fk;
alter table public.referrals add constraint referrals_placement_fk foreign key (placement_id) references public.partner_placements(id) on delete set null;
drop trigger if exists partner_placements_touch on public.partner_placements;
create trigger partner_placements_touch before update on public.partner_placements for each row execute function private.touch_updated_at();
alter table public.partner_placements enable row level security;
drop policy if exists partner_placements_admin on public.partner_placements;
create policy partner_placements_admin on public.partner_placements for all to authenticated
  using ((select private.is_platform_admin())) with check ((select private.is_platform_admin()));
revoke delete on public.partner_placements from anon, authenticated;
revoke all on public.partner_placements from anon;

create or replace function private.placement_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.item_key is not null and not exists (select 1 from public.requirement_types t, jsonb_array_elements(t.checklist) e
                                              where t.code = new.type_code and e ->> 'k' = new.item_key) then
    raise exception 'That checklist step doesn''t exist for this permit.' using errcode = '22023';
  end if;
  if new.active and exists (select 1 from public.partner_placements o where o.id <> new.id and o.active
      and o.type_code = new.type_code and coalesce(o.item_key, '') = coalesce(new.item_key, '')
      and o.starts_on <= new.ends_on and o.ends_on >= new.starts_on
      and (cardinality(o.cities) = 0 or cardinality(new.cities) = 0 or o.cities && new.cities)) then
    raise exception 'Another firm already has this step for these dates and cities. One firm per step keeps it from looking like an ad.' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists partner_placements_guard on public.partner_placements;
create trigger partner_placements_guard before insert or update on public.partner_placements for each row execute function private.placement_guard();

-- What the app shows today (published firms only, no fees or private contacts).
create or replace function public.list_placements() returns table (
  id uuid, partner_id uuid, partner_name text, category text, verified boolean, type_code text, item_key text, cities text[], headline text)
language sql stable security definer set search_path = '' as $$
  select pl.id, p.id, p.name, p.category, p.verified, pl.type_code, pl.item_key, pl.cities, pl.headline
  from public.partner_placements pl join public.partners p on p.id = pl.partner_id
  where pl.active and p.published and private.today_ph() between pl.starts_on and pl.ends_on
  order by pl.created_at
$$;
revoke all on function public.list_placements() from public, anon;
grant execute on function public.list_placements() to authenticated;

-- Honest counts for the firm's monthly report: a view or a click counts once per person per day.
create table if not exists private.placement_stats (
  placement_id uuid not null references public.partner_placements(id) on delete cascade,
  day date not null, views int not null default 0, clicks int not null default 0, leads int not null default 0,
  primary key (placement_id, day)
);
create table if not exists private.placement_seen (
  placement_id uuid not null, user_id uuid not null, day date not null, kind text not null,
  primary key (placement_id, user_id, day, kind)
);
create or replace function public.log_placement(p_ids uuid[], p_kind text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_today date := private.today_ph(); v_n int;
begin
  if auth.uid() is null or p_kind not in ('view','click') or coalesce(cardinality(p_ids), 0) = 0 then return; end if;
  if cardinality(p_ids) > 20 then raise exception 'Too many.' using errcode = '22023'; end if;
  for v_id in select distinct x from unnest(p_ids) x loop
    continue when not exists (select 1 from public.partner_placements where id = v_id);
    insert into private.placement_seen (placement_id, user_id, day, kind) values (v_id, auth.uid(), v_today, p_kind) on conflict do nothing;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      insert into private.placement_stats (placement_id, day, views, clicks) values (v_id, v_today, (p_kind = 'view')::int, (p_kind = 'click')::int)
      on conflict (placement_id, day) do update set views = private.placement_stats.views + excluded.views, clicks = private.placement_stats.clicks + excluded.clicks;
    end if;
  end loop;
end $$;
revoke all on function public.log_placement(uuid[], text) from public, anon;
grant execute on function public.log_placement(uuid[], text) to authenticated;

create or replace function public.admin_placement_stats(p_from date, p_to date) returns table (placement_id uuid, views bigint, clicks bigint, leads bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  return query select s.placement_id, sum(s.views)::bigint, sum(s.clicks)::bigint, sum(s.leads)::bigint
    from private.placement_stats s where s.day between p_from and p_to group by s.placement_id;
end $$;
revoke all on function public.admin_placement_stats(date, date) from public, anon;
grant execute on function public.admin_placement_stats(date, date) to authenticated;

-- ---------------------------------------------------------------- what each firm owes, and statements
create table if not exists public.partner_statements (
  id            uuid primary key default gen_random_uuid(),
  partner_id    uuid not null references public.partners(id) on delete restrict,
  number        text not null unique,
  period_end    date not null,
  total_php     numeric(12,2) not null check (total_php >= 0),
  status        text not null default 'sent' check (status in ('sent','paid','void')),
  sent_at       timestamptz not null default now(),
  due_on        date not null,
  paid_at       timestamptz,
  paid_method   text check (paid_method is null or length(paid_method) <= 60),
  paid_ref      text check (paid_ref is null or length(paid_ref) <= 120),
  bir_invoice_no text check (bir_invoice_no is null or length(bir_invoice_no) <= 60),
  note          text check (note is null or length(note) <= 500),
  created_by    uuid default auth.uid() references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create table if not exists public.partner_charges (
  id            uuid primary key default gen_random_uuid(),
  partner_id    uuid not null references public.partners(id) on delete restrict,
  kind          text not null check (kind in ('lead','sale','placement','listing','other')),
  description   text not null check (length(btrim(description)) between 1 and 300),
  amount_php    numeric(12,2) not null check (amount_php > 0),
  occurred_on   date not null default private.today_ph(),
  referral_id   uuid references public.referrals(id) on delete set null,
  placement_id  uuid references public.partner_placements(id) on delete set null,
  period        date,
  status        text not null default 'unbilled' check (status in ('unbilled','billed','paid','waived')),
  statement_id  uuid references public.partner_statements(id) on delete set null,
  created_by    uuid default auth.uid() references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists partner_charges_partner on public.partner_charges(partner_id, status);
create unique index if not exists partner_charges_placement_month on public.partner_charges(placement_id, period) where kind = 'placement';
create unique index if not exists partner_charges_listing_month on public.partner_charges(partner_id, period) where kind = 'listing';
create unique index if not exists partner_charges_sale on public.partner_charges(referral_id) where kind = 'sale';
create unique index if not exists partner_charges_lead on public.partner_charges(referral_id) where kind = 'lead';
alter table public.partner_statements enable row level security;
alter table public.partner_charges enable row level security;
drop policy if exists partner_statements_admin on public.partner_statements;
create policy partner_statements_admin on public.partner_statements for select to authenticated using ((select private.is_platform_admin()));
drop policy if exists partner_charges_admin on public.partner_charges;
create policy partner_charges_admin on public.partner_charges for select to authenticated using ((select private.is_platform_admin()));
revoke insert, update, delete on public.partner_statements, public.partner_charges from anon, authenticated;
revoke all on public.partner_statements, public.partner_charges from anon;

-- Lead fees recorded so far carry over (they keep their billed / paid state).
insert into public.partner_charges (partner_id, kind, description, amount_php, occurred_on, referral_id, status)
select r.partner_id, 'lead', 'Quote request from ' || coalesce(o.name, 'a customer'), c.amount_php, private.ph_day(r.created_at), r.id,
  case c.status when 'paid' then 'paid' when 'earned' then 'billed' else 'unbilled' end
from public.referral_commissions c join public.referrals r on r.id = c.referral_id left join public.orgs o on o.id = r.org_id
where c.amount_php > 0 and c.status <> 'none'
on conflict do nothing;

-- Quote requests: now remember which checklist line (if any) they came from, and record the fee.
drop function if exists public.request_referral(uuid,uuid,uuid,text,text,text);
create or replace function public.request_referral(p_org uuid, p_partner uuid, p_requirement uuid default null, p_note text default null,
  p_contact_method text default 'email', p_contact_value text default null, p_placement uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_partner public.partners; v_org text; v_who text; v_req text; v_body text; v_fee numeric := 0; v_pl uuid;
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
  select id into v_pl from public.partner_placements where id = p_placement and partner_id = p_partner;
  insert into public.referrals (org_id, partner_id, requirement_id, note, contact_method, contact_value, placement_id)
  values (p_org, p_partner, p_requirement, nullif(btrim(p_note), ''), coalesce(p_contact_method, 'email'), nullif(btrim(p_contact_value), ''), v_pl)
  returning id into v_id;
  if v_partner.fee_model = 'per_lead' then v_fee := coalesce(v_partner.lead_fee_php, 0); end if;
  insert into public.referral_commissions (referral_id, amount_php, status) values (v_id, v_fee, case when v_fee > 0 then 'expected' else 'none' end);
  select name into v_org from public.orgs where id = p_org;
  if v_fee > 0 then
    insert into public.partner_charges (partner_id, kind, description, amount_php, referral_id)
    values (p_partner, 'lead', 'Quote request from ' || v_org || coalesce(' (' || split_part(v_req, ' (expires', 1) || ')', ''), v_fee, v_id);
  end if;
  if v_pl is not null then
    insert into private.placement_stats (placement_id, day, leads) values (v_pl, private.today_ph(), 1)
    on conflict (placement_id, day) do update set leads = private.placement_stats.leads + 1;
  end if;
  select coalesce(nullif(btrim(first_name || ' ' || last_name), ''), email) into v_who from public.profiles where id = auth.uid();
  v_body := 'New quote request from PermitPal.' || E'\n\n' || 'Business: ' || v_org || E'\n' || 'Name: ' || coalesce(v_who, '-') || E'\n' ||
    'Contact via ' || coalesce(p_contact_method, 'email') || ': ' || coalesce(p_contact_value, '-') || E'\n' ||
    coalesce('Permit: ' || v_req || E'\n', '') || coalesce('Message: ' || nullif(btrim(p_note), '') || E'\n', '') ||
    E'\nPlease contact them directly within 1 business day.';
  if coalesce(v_partner.contact_email, '') <> '' then
    insert into public.message_outbox (org_id, channel, to_address, subject, body_text, body_html, dedupe_key)
    values (null, 'email', v_partner.contact_email, 'New quote request: ' || v_org,
      v_body, private.email_html('New quote request from PermitPal', '<p style="white-space:pre-line">' || private.html_escape(v_body) || '</p>', null, null),
      'lead:' || v_id);
  end if;
  perform private.notify_admins('Lead sent to ' || v_partner.name, v_org || ' - ' || coalesce(v_req, 'general request'), 'ref:' || v_id, false);
  return v_id;
end $$;
revoke all on function public.request_referral(uuid,uuid,uuid,text,text,text,uuid) from public, anon;
grant execute on function public.request_referral(uuid,uuid,uuid,text,text,text,uuid) to authenticated;

-- Staff: the firm reports a sale (for per-sale firms the fee is worked out here).
create or replace function public.admin_record_sale(p_referral uuid, p_sale_php numeric, p_note text default null) returns numeric
language plpgsql security definer set search_path = '' as $$
declare v_r public.referrals; v_p public.partners; v_fee numeric := 0; v_org text; v_old public.partner_charges;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select * into v_r from public.referrals where id = p_referral;
  if v_r.id is null then raise exception 'Quote request not found.' using errcode = 'P0002'; end if;
  if p_sale_php is null or p_sale_php < 0 or p_sale_php > 100000000 then raise exception 'Enter the sale amount in pesos.' using errcode = '22023'; end if;
  select * into v_p from public.partners where id = v_r.partner_id;
  v_fee := case v_p.fee_model when 'per_sale_flat' then coalesce(v_p.sale_fee_php, 0)
                              when 'per_sale_percent' then round(p_sale_php * coalesce(v_p.sale_pct, 0) / 100, 2) else 0 end;
  update public.referrals set status = 'converted', sale_php = round(p_sale_php, 2), sold_at = now() where id = p_referral;
  select * into v_old from public.partner_charges where referral_id = p_referral and kind = 'sale';
  if v_old.id is not null then
    if v_old.status <> 'unbilled' then raise exception 'This sale is already on a statement. Void the statement first to change it.' using errcode = 'P0001'; end if;
    if v_fee > 0 then update public.partner_charges set amount_php = v_fee where id = v_old.id;
    else delete from public.partner_charges where id = v_old.id; end if;
  elsif v_fee > 0 then
    select name into v_org from public.orgs where id = v_r.org_id;
    insert into public.partner_charges (partner_id, kind, description, amount_php, referral_id)
    values (v_r.partner_id, 'sale', 'Sale to ' || coalesce(v_org, 'a customer') || ': ' || private.peso(p_sale_php) || coalesce(' - ' || nullif(btrim(p_note), ''), ''), v_fee, p_referral);
  end if;
  return v_fee;
end $$;

create or replace function public.admin_add_partner_charge(p_partner uuid, p_description text, p_amount numeric, p_on date default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  if not exists (select 1 from public.partners where id = p_partner) then raise exception 'Firm not found.' using errcode = 'P0002'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter an amount above ₱0.' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_description, ''))) = 0 then raise exception 'Describe the charge (the firm sees it).' using errcode = '22023'; end if;
  insert into public.partner_charges (partner_id, kind, description, amount_php, occurred_on)
  values (p_partner, 'other', btrim(p_description), round(p_amount, 2), coalesce(p_on, private.today_ph())) returning id into v_id;
  return v_id;
end $$;

create or replace function public.admin_waive_charge(p_charge uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  update public.partner_charges set status = 'waived' where id = p_charge and status = 'unbilled';
  if not found then raise exception 'Only charges that aren''t billed yet can be waived.' using errcode = 'P0001'; end if;
end $$;

-- A statement takes every charge not billed yet, up to a date, and (optionally) emails the firm.
create or replace function public.admin_create_statement(p_partner uuid, p_through date, p_email boolean default true) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_p public.partners; v_total numeric; v_n int; v_id uuid; v_no text; v_due date := private.today_ph() + 15; v_lines text; v_to text;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select * into v_p from public.partners where id = p_partner;
  if v_p.id is null then raise exception 'Firm not found.' using errcode = 'P0002'; end if;
  if p_through is null or p_through > private.today_ph() then raise exception 'Choose a date up to today.' using errcode = '22023'; end if;
  select coalesce(sum(amount_php), 0), count(*) into v_total, v_n from public.partner_charges
    where partner_id = p_partner and status = 'unbilled' and occurred_on <= p_through;
  if v_n = 0 then raise exception 'Nothing to bill for % up to %.', v_p.name, private.fmt_date(p_through) using errcode = 'P0001'; end if;
  v_no := private.next_no('P');
  insert into public.partner_statements (partner_id, number, period_end, total_php, due_on) values (p_partner, v_no, p_through, v_total, v_due) returning id into v_id;
  update public.partner_charges set status = 'billed', statement_id = v_id
    where partner_id = p_partner and status = 'unbilled' and occurred_on <= p_through;
  v_to := coalesce(nullif(btrim(v_p.billing_email), ''), nullif(btrim(v_p.contact_email), ''));
  if p_email and v_to is not null then
    select string_agg(private.fmt_date(c.occurred_on) || '  ' || c.description || '  ' || private.peso(c.amount_php), E'\n' order by c.occurred_on, c.created_at)
      into v_lines from public.partner_charges c where c.statement_id = v_id;
    insert into public.message_outbox (org_id, channel, to_address, subject, body_text, body_html, dedupe_key)
    values (null, 'email', v_to, 'PermitPal statement ' || v_no || ': ' || private.peso(v_total),
      'Statement ' || v_no || ' for ' || v_p.name || E'\n' || 'Up to ' || private.fmt_date(p_through) || E'\n\n' || v_lines || E'\n\n' ||
        'Total: ' || private.peso(v_total) || E'\n' || 'Please pay by ' || private.fmt_date(v_due) || '. Payment details are below. Reply to this email with questions.' || E'\n\n' ||
        coalesce((select string_agg(value, ' · ') from public.app_settings where key in ('gcash_name','gcash_number','bank_name','bank_account_name','bank_account_number') and value <> ''), ''),
      private.email_html('Statement ' || v_no || ': ' || private.peso(v_total),
        '<p>' || private.html_escape(v_p.name) || ' · up to ' || private.fmt_date(p_through) || '</p><p style="white-space:pre-line">' || private.html_escape(v_lines) ||
        '</p><p><b>Total: ' || private.peso(v_total) || '</b><br>Please pay by ' || private.fmt_date(v_due) || '.</p><p>' ||
        private.html_escape(coalesce((select string_agg(value, ' · ') from public.app_settings where key in ('gcash_name','gcash_number','bank_name','bank_account_name','bank_account_number') and value <> ''), '')) || '</p>',
        null, null),
      'stmt:' || v_id);
  end if;
  return v_id;
end $$;

create or replace function public.admin_statement_paid(p_statement uuid, p_method text, p_ref text, p_invoice_no text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  update public.partner_statements set status = 'paid', paid_at = now(), paid_method = nullif(btrim(p_method), ''), paid_ref = nullif(btrim(p_ref), ''),
    bir_invoice_no = coalesce(nullif(btrim(p_invoice_no), ''), bir_invoice_no)
  where id = p_statement and status = 'sent';
  if not found then raise exception 'Only a sent statement can be marked paid.' using errcode = 'P0001'; end if;
  update public.partner_charges set status = 'paid' where statement_id = p_statement;
end $$;

create or replace function public.admin_statement_void(p_statement uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_note, ''))) < 5 then raise exception 'Say why it''s cancelled.' using errcode = '22023'; end if;
  update public.partner_statements set status = 'void', note = btrim(p_note) where id = p_statement and status = 'sent';
  if not found then raise exception 'Only a sent, unpaid statement can be cancelled.' using errcode = 'P0001'; end if;
  update public.partner_charges set status = 'unbilled', statement_id = null where statement_id = p_statement;
end $$;

-- Monthly fees: featured checklist lines and flat listings, charged once per month (safe to run daily).
create or replace function private.partner_monthly_charges() returns int
language plpgsql security definer set search_path = '' as $$
declare v_today date := private.today_ph(); v_month date := date_trunc('month', private.today_ph())::date; v_n int; v_m int;
begin
  insert into public.partner_charges (partner_id, kind, description, amount_php, placement_id, period, occurred_on)
  select pl.partner_id, 'placement', 'Featured on the "' || t.name || '" checklist, ' || to_char(v_month, 'FMMonth YYYY') ||
      case when cardinality(pl.cities) > 0 then ' (' || array_to_string(pl.cities, ', ') || ')' else '' end,
    pl.monthly_fee_php, pl.id, v_month, greatest(v_month, pl.starts_on)
  from public.partner_placements pl join public.requirement_types t on t.code = pl.type_code
  where pl.active and pl.monthly_fee_php > 0 and pl.starts_on <= v_today and pl.ends_on >= v_month
  on conflict (placement_id, period) where kind = 'placement' do nothing;
  get diagnostics v_n = row_count;
  insert into public.partner_charges (partner_id, kind, description, amount_php, period, occurred_on)
  select p.id, 'listing', 'PermitPal listing, ' || to_char(v_month, 'FMMonth YYYY'), p.monthly_fee_php, v_month, v_month
  from public.partners p where p.published and p.fee_model = 'monthly' and coalesce(p.monthly_fee_php, 0) > 0
  on conflict (partner_id, period) where kind = 'listing' do nothing;
  get diagnostics v_m = row_count;
  return v_n + v_m;
end $$;
revoke all on function private.partner_monthly_charges() from public, anon, authenticated;

do $$ declare f text; begin
  foreach f in array array['public.admin_record_sale(uuid,numeric,text)', 'public.admin_add_partner_charge(uuid,text,numeric,date)',
    'public.admin_waive_charge(uuid)', 'public.admin_create_statement(uuid,date,boolean)', 'public.admin_statement_paid(uuid,text,text,text)',
    'public.admin_statement_void(uuid,text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------- firms apply to be listed (no account needed)
create table if not exists public.partner_applications (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(btrim(name)) between 2 and 160),
  category      text not null,
  cities        text not null default '' check (length(cities) <= 300),
  contact_name  text not null check (length(btrim(contact_name)) between 2 and 120),
  email         text not null check (length(email) <= 160),
  phone         text not null default '' check (length(phone) <= 60),
  licence       text not null default '' check (length(licence) <= 200),
  services      text not null default '' check (length(services) <= 600),
  website       text not null default '' check (length(website) <= 300),
  message       text not null default '' check (length(message) <= 1500),
  status        text not null default 'new' check (status in ('new','listed','declined')),
  partner_id    uuid references public.partners(id) on delete set null,
  note          text check (note is null or length(note) <= 500),
  created_at    timestamptz not null default now(),
  decided_at    timestamptz
);
alter table public.partner_applications enable row level security;
drop policy if exists partner_applications_admin_read on public.partner_applications;
create policy partner_applications_admin_read on public.partner_applications for select to authenticated using ((select private.is_platform_admin()));
drop policy if exists partner_applications_admin_update on public.partner_applications;
create policy partner_applications_admin_update on public.partner_applications for update to authenticated
  using ((select private.is_platform_admin())) with check ((select private.is_platform_admin()));
revoke insert, delete on public.partner_applications from anon, authenticated;
revoke all on public.partner_applications from anon;

create or replace function public.apply_as_partner(p_name text, p_category text, p_cities text, p_contact_name text, p_email text,
  p_phone text, p_licence text, p_services text, p_website text, p_message text, p_trap text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if coalesce(p_trap, '') <> '' then return; end if;  -- filled in by bots, never by people (the box is hidden)
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'Enter your firm''s name.' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_contact_name, ''))) < 2 then raise exception 'Enter your name.' using errcode = '22023'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address.' using errcode = '22023'; end if;
  if coalesce(p_category, '') not in ('liaison','bookkeeping','fire_safety','pest_control','health_clinic','emission_testing','vehicle_inspection','insurance','notary','other') then
    raise exception 'Choose what your firm does.' using errcode = '22023';
  end if;
  if coalesce(btrim(p_website), '') <> '' and btrim(p_website) !~ '^https://' then raise exception 'The website must start with https://' using errcode = '22023'; end if;
  if exists (select 1 from public.partner_applications where lower(email) = v_email and created_at > now() - interval '1 day') then
    raise exception 'We already have your application. We''ll reply within 3 business days.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.partner_applications where created_at > now() - interval '1 hour') >= 30 then
    raise exception 'We''re getting a lot of applications right now. Please try again in an hour.' using errcode = 'P0001';
  end if;
  insert into public.partner_applications (name, category, cities, contact_name, email, phone, licence, services, website, message)
  values (btrim(p_name), p_category, left(btrim(coalesce(p_cities, '')), 300), btrim(p_contact_name), v_email, left(btrim(coalesce(p_phone, '')), 60),
    left(btrim(coalesce(p_licence, '')), 200), left(btrim(coalesce(p_services, '')), 600), left(btrim(coalesce(p_website, '')), 300), left(btrim(coalesce(p_message, '')), 1500));
  perform private.notify_admins('Firm wants to be listed: ' || btrim(p_name),
    btrim(p_contact_name) || ' (' || v_email || coalesce(', ' || nullif(btrim(p_phone), ''), '') || ') - ' || p_category ||
    coalesce(' - ' || nullif(btrim(p_cities), ''), '') || '. Check their permit and licence before listing them.', 'apply:' || v_email || ':' || private.today_ph(), true);
end $$;
revoke all on function public.apply_as_partner(text,text,text,text,text,text,text,text,text,text,text) from public;
grant execute on function public.apply_as_partner(text,text,text,text,text,text,text,text,text,text,text) to anon, authenticated;

-- Staff: turn an application into a (hidden) listing to finish and publish.
create or replace function public.admin_application_to_partner(p_app uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_a public.partner_applications; v_id uuid;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select * into v_a from public.partner_applications where id = p_app;
  if v_a.id is null or v_a.status <> 'new' then raise exception 'This application was already handled.' using errcode = 'P0001'; end if;
  insert into public.partners (category, name, description, licence, services, website, contact_name, contact_phone, contact_email, cities, published, verified,
    fee_model, commission_terms)
  values (v_a.category, v_a.name, '', v_a.licence, v_a.services, v_a.website, v_a.contact_name, v_a.phone, v_a.email,
    coalesce((select array_agg(btrim(c)) from unnest(string_to_array(v_a.cities, ',')) c where btrim(c) <> ''), '{}'), false, false,
    case when v_a.category = 'insurance' then 'none' else 'per_lead' end, 'From application ' || to_char(v_a.created_at, 'YYYY-MM-DD'))
  returning id into v_id;
  update public.partner_applications set status = 'listed', partner_id = v_id, decided_at = now() where id = p_app;
  return v_id;
end $$;
revoke all on function public.admin_application_to_partner(uuid) from public, anon;
grant execute on function public.admin_application_to_partner(uuid) to authenticated;

-- People can hide partner lines in checklists.
alter table public.profiles add column if not exists show_partner_offers boolean not null default true;
grant update (show_partner_offers) on public.profiles to authenticated;

-- ================================================================ 4) money: one ledger for staff
alter table public.payments
  add column if not exists method text check (method is null or length(method) <= 60),
  add column if not exists reference text check (reference is null or length(reference) <= 120),
  add column if not exists bir_invoice_no text check (bir_invoice_no is null or length(bir_invoice_no) <= 60);

-- Staff: a team plan paid by GCash or bank transfer. Records the payment and extends the plan.
create or replace function public.admin_record_plan_payment(p_org uuid, p_plan text, p_months int, p_amount numeric,
  p_method text, p_ref text default null, p_invoice_no text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org public.orgs; v_plan public.plans; v_from timestamptz; v_id uuid; v_until timestamptz;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select * into v_org from public.orgs where id = p_org for update;
  if v_org.id is null then raise exception 'Workspace not found.' using errcode = 'P0002'; end if;
  select * into v_plan from public.plans where id = p_plan;
  if v_plan.id is null or coalesce(v_plan.price_php_monthly, 0) <= 0 then raise exception 'Choose a paid plan.' using errcode = '22023'; end if;
  if p_months is null or p_months not between 1 and 12 then raise exception 'Choose 1 to 12 months.' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter the amount received.' using errcode = '22023'; end if;
  insert into public.payments (org_id, plan_id, months, amount_php, provider, status, paid_at, created_by, method, reference, bir_invoice_no)
  values (p_org, p_plan, p_months, round(p_amount, 2), 'manual', 'paid', now(), auth.uid(), nullif(btrim(p_method), ''), nullif(btrim(p_ref), ''), nullif(btrim(p_invoice_no), ''))
  returning id into v_id;
  v_from := case when v_org.plan_id = p_plan and v_org.plan_expires_at > now() then v_org.plan_expires_at else now() end;
  v_until := v_from + make_interval(months => p_months);
  update public.orgs set plan_id = p_plan, plan_expires_at = v_until where id = p_org;
  perform private.notify_owners(p_org, 'Payment received - thank you!',
    'Your ' || v_plan.name || ' plan is active until ' || private.fmt_date(private.ph_day(v_until)) || '.', '#/settings/billing', 'planpaid:' || v_id, true, false);
  return v_id;
end $$;

-- Staff: the BIR invoice number issued for a payment (every sale needs one).
create or replace function public.admin_set_invoice_no(p_kind text, p_id uuid, p_no text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_no text := nullif(btrim(coalesce(p_no, '')), '');
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  if length(coalesce(v_no, '')) > 60 then raise exception 'That invoice number is too long.' using errcode = '22023'; end if;
  if p_kind = 'order' then update public.assistance_requests set bir_invoice_no = v_no where id = p_id;
  elsif p_kind = 'care' then update public.care_invoices set bir_invoice_no = v_no where id = p_id;
  elsif p_kind = 'statement' then update public.partner_statements set bir_invoice_no = v_no where id = p_id;
  elsif p_kind = 'plan' then update public.payments set bir_invoice_no = v_no where id = p_id;
  else raise exception 'Unknown payment.' using errcode = '22023'; end if;
  if not found then raise exception 'Payment not found.' using errcode = 'P0002'; end if;
end $$;

-- Staff settings kept private: the monthly goal and the Insurance Commission licence number.
create or replace function public.admin_set_money_setting(p_key text, p_value text) returns void
language plpgsql security definer set search_path = '' as $$
declare v text := btrim(coalesce(p_value, ''));
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  if p_key = 'money_goal' then
    if v !~ '^\d{0,9}(\.\d{1,2})?$' then raise exception 'Enter the goal in pesos, e.g. 100000.' using errcode = '22023'; end if;
  elsif p_key = 'ic_licence_no' then
    if length(v) > 60 then raise exception 'That licence number is too long.' using errcode = '22023'; end if;
  else raise exception 'Unknown setting.' using errcode = '22023'; end if;
  insert into private.settings (key, value) values (p_key, v) on conflict (key) do update set value = excluded.value;
end $$;

-- Every peso line: collected, waiting to be collected, quoted, not billed yet, government money held
-- for customers, and guarantee payouts. Open items are always included, whatever the dates.
create or replace function public.admin_money(p_from date, p_to date) returns table (
  day date, stream text, kind text, state text, amount numeric, label text, who text, ref_kind text, ref_id uuid, invoice_no text, rush numeric)
language plpgsql stable security definer set search_path = '' as $$
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
    -- team plans (online, or recorded by staff)
    select private.ph_day(pm.paid_at), 'plans', 'team_plan', 'collected', pm.amount_php::numeric, pl.name || ' plan, ' || pm.months || ' month' || case when pm.months > 1 then 's' else '' end,
      o.name, 'plan', pm.id, pm.bir_invoice_no, 0
    from public.payments pm join public.orgs o on o.id = pm.org_id join public.plans pl on pl.id = pm.plan_id
    where pm.status = 'paid' and pm.plan_id is not null and pm.paid_at is not null
  )
  select l.day, l.stream, l.kind, l.state, l.amount, l.label, l.who, l.ref_kind, l.ref_id, l.invoice_no, l.rush from lines l
  where l.day between p_from and p_to or l.state in ('to_collect','pipeline','unbilled','to_pay')
  order by l.day desc, l.stream;
end $$;

-- The numbers that don't fit in a ledger: monthly recurring revenue, money held, and what needs doing.
create or replace function public.admin_money_summary() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_today date := private.today_ph(); v jsonb;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select jsonb_build_object(
    'today', v_today,
    'goal', nullif(private.setting('money_goal'), '')::numeric,
    'ic_licence_no', coalesce(private.setting('ic_licence_no'), ''),
    'mrr_care', coalesce((select sum(case billing when 'monthly' then price_php else round(price_php / 12, 2) end) from public.care_plans
                          where status = 'active' and paid_through >= v_today and cancel_at is null), 0),
    'care_active', (select count(*) from public.care_plans where status = 'active'),
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
                          join public.assistance_requests a on a.id = r.request_id where r.kind = 'full'), 0),
    'gov_unrecorded', (select count(*) from public.assistance_requests where status = 'completed' and paid_at is not null and coalesce(quote_gov_fees, 0) > 0 and gov_fees_actual is null),
    'quotes_to_send', (select count(*) from public.assistance_requests where status = 'submitted' and (service_code is not null or care_plan_id is not null)),
    'care_to_quote', (select count(*) from public.assistance_requests where status = 'submitted' and care_plan_id is not null),
    'order_payments_to_check', (select count(*) from public.assistance_requests where payment_status = 'pending_verification'),
    'care_payments_to_check', (select count(*) from public.care_invoices where status = 'pending_verification'),
    'care_overdue', (select count(*) from public.care_invoices where status = 'due' and due_on < v_today),
    'claims_to_decide', (select count(*) from public.guarantee_claims where status = 'submitted'),
    'claims_to_pay', (select count(*) from public.guarantee_claims where status = 'approved'),
    'partners_to_bill', (select count(distinct partner_id) from public.partner_charges where status = 'unbilled' and occurred_on < date_trunc('month', v_today)::date),
    'statements_overdue', (select count(*) from public.partner_statements where status = 'sent' and due_on < v_today),
    'applications_new', (select count(*) from public.partner_applications where status = 'new'),
    'staff_access_open', (select count(*) from private.staff_memberships where ended_at is null),
    'covered_missing_dates', (select count(distinct c.requirement_id) from public.care_plans p cross join lateral private.care_covered(p.id) c
                              join public.requirement_status rs on rs.id = c.requirement_id
                              where p.status = 'active' and rs.expires and rs.expires_on is null),
    'missing_invoice', (select count(*) from public.assistance_requests where paid_at is not null and payment_status in ('paid','refunded') and coalesce(quote_php, 0) > 0 and bir_invoice_no is null)
                     + (select count(*) from public.care_invoices where status = 'paid' and amount_php > 0 and bir_invoice_no is null)
                     + (select count(*) from public.partner_statements where status = 'paid' and bir_invoice_no is null)
                     + (select count(*) from public.payments where status = 'paid' and plan_id is not null and bir_invoice_no is null)
  ) into v;
  return v;
end $$;

-- Covered permits staff need to chase (no expiry date yet), for the Care tab.
create or replace function public.admin_care_gaps() returns table (plan_id uuid, org_name text, plan_label text, requirement_id uuid, requirement_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  return query select p.id, o.name, p.label, rs.id, rs.name
    from public.care_plans p join public.orgs o on o.id = p.org_id cross join lateral private.care_covered(p.id) c
    join public.requirement_status rs on rs.id = c.requirement_id
    where p.status = 'active' and rs.expires and rs.expires_on is null order by o.name, p.label, rs.name;
end $$;

do $$ declare f text; begin
  foreach f in array array['public.admin_record_plan_payment(uuid,text,int,numeric,text,text,text)', 'public.admin_set_invoice_no(text,uuid,text)',
    'public.admin_set_money_setting(text,text)', 'public.admin_money(date,date)', 'public.admin_money_summary()', 'public.admin_care_gaps()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ================================================================ the daily job (7:15am Manila)
create or replace function private.revenue_daily() returns int
language plpgsql security definer set search_path = '' as $$
declare v_n int := 0;
begin
  v_n := v_n + private.care_daily();
  v_n := v_n + private.partner_monthly_charges();
  delete from private.placement_seen where day < private.today_ph() - 60;
  return v_n;
end $$;
revoke all on function private.revenue_daily() from public, anon, authenticated;
select cron.schedule('pp-revenue-daily', '15 23 * * *', $$select private.revenue_daily()$$);

insert into private.features (name) values ('revenue') on conflict do nothing;

commit;
