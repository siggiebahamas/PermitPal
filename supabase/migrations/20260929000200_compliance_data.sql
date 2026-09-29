-- Businesses, branches, vehicles, the requirement library, tracked requirements,
-- renewal records (cycles), documents, file storage, and the status engine.
--
-- Nothing here is ever hard-deleted by a customer: rows get deleted_at set and can be
-- restored from Trash. Renewing a permit adds a new cycle row; the old one (and its
-- document) stays on file as history.

create function private.today_ph() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Manila')::date
$$;
grant execute on function private.today_ph() to authenticated;

-- ---------------------------------------------------------------- businesses & branches
create table public.businesses (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 160),
  structure   text not null default 'Sole Proprietorship'
              check (structure in ('Sole Proprietorship','Partnership','Corporation','Cooperative','Other')),
  activity    text not null default 'other'
              check (activity in ('restaurant','retail','professional_services','manufacturing','construction','healthcare','school','logistics','other')),
  tin         text check (tin is null or length(tin) <= 30),
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index businesses_org_idx on public.businesses(org_id);
create trigger businesses_touch before update on public.businesses for each row execute function private.touch_updated_at();

create table public.business_locations (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  business_id  uuid not null references public.businesses(id) on delete cascade,
  name         text not null default 'Main branch' check (length(btrim(name)) between 1 and 120),
  city         text not null default '' check (length(city) <= 120),
  address      text not null default '' check (length(address) <= 300),
  is_main      boolean not null default false,
  created_by   uuid default auth.uid() references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index business_locations_business_idx on public.business_locations(business_id);
create index business_locations_org_idx on public.business_locations(org_id);
create unique index business_locations_one_main on public.business_locations(business_id) where is_main and deleted_at is null;
create trigger business_locations_touch before update on public.business_locations for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------- vehicles
create table public.vehicles (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  make_model    text not null check (length(btrim(make_model)) between 1 and 120),
  plate_no      text not null default '' check (length(plate_no) <= 20),
  vehicle_type  text not null default 'Sedan' check (length(vehicle_type) <= 40),
  cr_no         text not null default '' check (length(cr_no) <= 40),
  mv_file_no    text not null default '' check (length(mv_file_no) <= 40),
  business_id   uuid references public.businesses(id) on delete set null,
  created_by    uuid default auth.uid() references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index vehicles_org_idx on public.vehicles(org_id);
create unique index vehicles_unique_plate on public.vehicles (org_id, upper(regexp_replace(plate_no, '[^A-Za-z0-9]', '', 'g')))
  where plate_no <> '' and deleted_at is null;
create trigger vehicles_touch before update on public.vehicles for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------- requirement library
-- The rules engine seed. due_rule tells the app how to suggest the next due date:
--   jan20     - most LGUs require business permit renewal by January 20
--   annual    - one year after the issue date
--   lto_plate - LTO schedule from the plate number (last digit = month, 2nd-to-last = week)
--   years5    - five years after the issue date (DTI business name)
--   manual    - no reliable rule; the customer enters the date
create table public.requirement_types (
  code          text primary key,
  name          text not null,
  subject       text not null check (subject in ('business','vehicle')),
  agency        text,
  expires       boolean not null,
  due_rule      text not null default 'manual' check (due_rule in ('manual','jan20','annual','lto_plate','years5')),
  per_location  boolean not null default true,
  activities    text[],       -- null = applies to every activity
  structures    text[],       -- null = applies to every structure
  confidence    text not null default 'likely' check (confidence in ('confirmed','likely','needs_verification')),
  auto_add      boolean not null default true,
  help_text     text,
  sort          int not null default 100
);

insert into public.requirement_types
  (code, name, subject, agency, expires, due_rule, per_location, activities, structures, confidence, auto_add, help_text, sort) values
  ('mayors_permit', 'Mayor''s / Business Permit', 'business', 'City or municipal hall (BPLO)', true, 'jan20', true, null, null, 'confirmed', true,
     'Renewed every year. Most cities and municipalities require renewal by January 20 - check your LGU, some extend it.', 10),
  ('barangay_clearance', 'Barangay Business Clearance', 'business', 'Barangay hall', true, 'jan20', true, null, null, 'confirmed', true,
     'Needed before your Mayor''s Permit renewal each year, so it follows the same January deadline.', 20),
  ('bir_cor', 'BIR Certificate of Registration (Form 2303)', 'business', 'BIR', false, 'manual', true, null, null, 'confirmed', true,
     'Does not expire. The P500 annual registration fee was removed in 2024 (Ease of Paying Taxes Act). Update it only when your business details change. Each branch has its own COR.', 30),
  ('fsic', 'Fire Safety Inspection Certificate (FSIC)', 'business', 'Bureau of Fire Protection', true, 'annual', true, null, null, 'likely', true,
     'Usually renewed yearly together with your business permit.', 40),
  ('sanitary_permit', 'Sanitary Permit', 'business', 'City or municipal health office', true, 'annual', true,
     array['restaurant','healthcare','school','manufacturing'], null, 'likely', true,
     'Required for businesses that handle food, health services, or have many people on site. Renewed yearly.', 50),
  ('dti_business_name', 'DTI Business Name Registration', 'business', 'DTI', true, 'years5', false, null, array['Sole Proprietorship'], 'confirmed', true,
     'Valid for 5 years for sole proprietorships.', 60),
  ('sec_registration', 'SEC Certificate of Registration', 'business', 'SEC', false, 'manual', false, null, array['Corporation','Partnership'], 'confirmed', true,
     'Does not expire, but the SEC requires yearly filings (GIS and financial statements).', 70),
  ('cda_registration', 'CDA Certificate of Registration', 'business', 'Cooperative Development Authority', false, 'manual', false, null, array['Cooperative'], 'confirmed', true,
     'Does not expire. Cooperatives also file yearly reports with the CDA.', 80),
  ('ecc', 'Environmental Compliance Certificate (ECC)', 'business', 'DENR-EMB', false, 'manual', true, array['manufacturing'], null, 'needs_verification', true,
     'Needed for projects or operations the DENR considers environmentally critical. Check if yours is covered.', 90),
  ('pcab_license', 'PCAB Contractor''s License', 'business', 'PCAB', true, 'manual', false, array['construction'], null, 'needs_verification', true,
     'Required for contractors. Check the validity printed on your license.', 100),
  ('doh_lto', 'DOH License to Operate', 'business', 'Department of Health', true, 'manual', true, array['healthcare'], null, 'needs_verification', true,
     'Required for many health facilities. Check the validity printed on your license.', 110),
  ('school_permit', 'DepEd / CHED / TESDA Permit to Operate', 'business', 'DepEd, CHED or TESDA', false, 'manual', true, array['school'], null, 'needs_verification', true,
     'Depends on the kind of school or training center. Mark it as expiring if yours has an end date.', 120),
  ('lto_registration', 'LTO Registration (OR/CR)', 'vehicle', 'LTO', true, 'lto_plate', false, null, null, 'confirmed', true,
     'Renew every year. The month follows the last digit of your plate; the week follows the second-to-last digit. Brand-new vehicles are first registered for 3 years.', 10),
  ('ctpl', 'CTPL Insurance', 'vehicle', 'Insurance provider', true, 'lto_plate', false, null, null, 'confirmed', true,
     'Compulsory insurance you need before renewing your registration. Usually renewed on the same schedule.', 20),
  ('emission_test', 'Emission Test (CEC)', 'vehicle', 'LTO-accredited emission center', true, 'lto_plate', false, null, null, 'confirmed', true,
     'Needed for each registration renewal, so it follows your registration schedule.', 30),
  ('mvir', 'Motor Vehicle Inspection Report (MVIR)', 'vehicle', 'LTO / PMVIC', true, 'lto_plate', false, null, null, 'likely', true,
     'Inspection done as part of registration renewal.', 40);

-- ---------------------------------------------------------------- tracked requirements
create table public.requirements (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.orgs(id) on delete cascade,
  subject             text not null check (subject in ('business','vehicle')),
  business_id         uuid references public.businesses(id) on delete cascade,
  location_id         uuid references public.business_locations(id) on delete cascade,
  vehicle_id          uuid references public.vehicles(id) on delete cascade,
  type_code           text references public.requirement_types(code),
  name                text not null check (length(btrim(name)) between 1 and 160),
  expires             boolean not null default true,
  confidence          text not null default 'confirmed' check (confidence in ('confirmed','likely','needs_verification')),
  notes               text check (notes is null or length(notes) <= 2000),
  renewal_started_at  timestamptz,
  created_by          uuid default auth.uid() references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  check (
    (subject = 'business' and business_id is not null and vehicle_id is null)
    or (subject = 'vehicle' and vehicle_id is not null and business_id is null and location_id is null)
  )
);
create index requirements_org_idx on public.requirements(org_id);
create index requirements_business_idx on public.requirements(business_id);
create index requirements_vehicle_idx on public.requirements(vehicle_id);
create index requirements_location_idx on public.requirements(location_id);
create unique index requirements_unique_business_type on public.requirements (business_id, location_id, type_code) nulls not distinct
  where deleted_at is null and subject = 'business' and type_code is not null;
create unique index requirements_unique_vehicle_type on public.requirements (vehicle_id, type_code)
  where deleted_at is null and subject = 'vehicle' and type_code is not null;
create unique index requirements_unique_custom on public.requirements (coalesce(business_id, vehicle_id), location_id, lower(btrim(name))) nulls not distinct
  where deleted_at is null and type_code is null;
create trigger requirements_touch before update on public.requirements for each row execute function private.touch_updated_at();

-- One row per permit period. Renewal = a new row; older rows are the permit's history.
create table public.requirement_cycles (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id) on delete cascade,
  requirement_id  uuid not null references public.requirements(id) on delete cascade,
  reference_no    text check (reference_no is null or length(reference_no) <= 100),
  issuer          text check (issuer is null or length(issuer) <= 120),
  issued_on       date,
  expires_on      date,
  created_by      uuid default auth.uid() references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  check (issued_on is null or expires_on is null or expires_on >= issued_on)
);
create index requirement_cycles_req_idx on public.requirement_cycles(requirement_id, created_at desc);
create index requirement_cycles_org_idx on public.requirement_cycles(org_id);
create trigger requirement_cycles_touch before update on public.requirement_cycles for each row execute function private.touch_updated_at();

create table public.documents (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id) on delete cascade,
  requirement_id  uuid not null references public.requirements(id) on delete cascade,
  cycle_id        uuid references public.requirement_cycles(id) on delete set null,
  storage_path    text not null unique,
  file_name       text not null check (length(file_name) between 1 and 255),
  mime_type       text,
  size_bytes      bigint,
  uploaded_by     uuid default auth.uid() references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index documents_req_idx on public.documents(requirement_id);
create index documents_cycle_idx on public.documents(cycle_id);
create index documents_org_idx on public.documents(org_id);

-- Help requests ("Get Help"). Routing and notifications are added in a later migration.
create table public.assistance_requests (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.orgs(id) on delete cascade,
  requirement_id    uuid references public.requirements(id) on delete set null,
  requirement_name  text not null,
  subject_label     text not null,
  location_label    text,
  due_on            date,
  docs_status       text not null default 'not_sure' check (docs_status in ('have','need','not_sure')),
  contact_method    text not null default 'email' check (contact_method in ('email','phone','whatsapp','viber')),
  contact_value     text check (contact_value is null or length(contact_value) <= 120),
  notes             text check (notes is null or length(notes) <= 2000),
  status            text not null default 'submitted'
                    check (status in ('submitted','matching','provider_contacted','awaiting_customer','in_progress','completed','cancelled')),
  provider_name     text check (provider_name is null or length(provider_name) <= 160),
  quote_php         numeric(12,2),
  admin_note        text check (admin_note is null or length(admin_note) <= 2000),
  created_by        uuid default auth.uid() references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  closed_at         timestamptz
);
create index assistance_requests_org_idx on public.assistance_requests(org_id);
create index assistance_requests_req_idx on public.assistance_requests(requirement_id);
create index assistance_requests_open_idx on public.assistance_requests(status) where status not in ('completed','cancelled');
create trigger assistance_requests_touch before update on public.assistance_requests for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------- integrity
-- RLS checks the org you write to; this makes sure the parent rows you point at
-- belong to that same org (so nobody can attach data to someone else's business).
create function private.check_org_consistency() returns trigger
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
  elsif tg_table_name = 'requirements' then
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
  end if;
  return new;
end $$;

create trigger business_locations_consistency before insert or update on public.business_locations for each row execute function private.check_org_consistency();
create trigger vehicles_consistency before insert or update on public.vehicles for each row execute function private.check_org_consistency();
create trigger requirements_consistency before insert or update on public.requirements for each row execute function private.check_org_consistency();
create trigger requirement_cycles_consistency before insert or update on public.requirement_cycles for each row execute function private.check_org_consistency();
create trigger documents_consistency before insert or update on public.documents for each row execute function private.check_org_consistency();
create trigger assistance_requests_consistency before insert or update on public.assistance_requests for each row execute function private.check_org_consistency();

-- Recording a new permit period confirms the requirement applies and ends any
-- "renewal started" flag, since the renewal is now done.
create function private.on_cycle_recorded() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.requirements
     set renewal_started_at = null, confidence = 'confirmed'
   where id = new.requirement_id and (renewal_started_at is not null or confidence <> 'confirmed');
  return new;
end $$;
create trigger requirement_cycles_recorded after insert on public.requirement_cycles for each row execute function private.on_cycle_recorded();

-- ---------------------------------------------------------------- plan limits
create function private.enforce_plan_limits() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_plan  public.plans;
  v_count int;
begin
  -- Only new rows and rows coming back from Trash count against the plan.
  if tg_op = 'UPDATE' and not (old.deleted_at is not null and new.deleted_at is null) then return new; end if;
  if tg_op = 'INSERT' and new.deleted_at is not null then return new; end if;

  select p.* into v_plan from public.plans p where p.id = private.effective_plan_id(new.org_id);

  if tg_table_name = 'businesses' and v_plan.max_businesses is not null then
    select count(*) into v_count from public.businesses where org_id = new.org_id and deleted_at is null and id <> new.id;
    if v_count >= v_plan.max_businesses then
      raise exception 'The % plan includes % business%. Upgrade your plan to add more.',
        v_plan.name, v_plan.max_businesses, case when v_plan.max_businesses = 1 then '' else 'es' end
        using errcode = 'P0001', hint = 'plan_limit';
    end if;
  elsif tg_table_name = 'vehicles' and v_plan.max_vehicles is not null then
    select count(*) into v_count from public.vehicles where org_id = new.org_id and deleted_at is null and id <> new.id;
    if v_count >= v_plan.max_vehicles then
      raise exception 'The % plan includes % vehicle%. Upgrade your plan to add more.',
        v_plan.name, v_plan.max_vehicles, case when v_plan.max_vehicles = 1 then '' else 's' end
        using errcode = 'P0001', hint = 'plan_limit';
    end if;
  elsif tg_table_name = 'business_locations' and v_plan.max_locations_per_business is not null then
    select count(*) into v_count from public.business_locations where business_id = new.business_id and deleted_at is null and id <> new.id;
    if v_count >= v_plan.max_locations_per_business then
      raise exception 'The % plan includes % branch per business. Upgrade to Business Plus to track more branches.',
        v_plan.name, v_plan.max_locations_per_business
        using errcode = 'P0001', hint = 'plan_limit';
    end if;
  end if;
  return new;
end $$;
create trigger businesses_plan_limit before insert or update of deleted_at on public.businesses for each row execute function private.enforce_plan_limits();
create trigger vehicles_plan_limit before insert or update of deleted_at on public.vehicles for each row execute function private.enforce_plan_limits();
create trigger business_locations_plan_limit before insert or update of deleted_at on public.business_locations for each row execute function private.enforce_plan_limits();

-- ---------------------------------------------------------------- row level security
alter table public.requirement_types enable row level security;
create policy requirement_types_read on public.requirement_types for select to authenticated using (true);
revoke insert, update, delete on public.requirement_types from anon, authenticated;

-- A platform admin (PermitPal staff) can see a customer's requirement, its records and
-- files only while that customer has an open help request for it.
create function private.admin_can_see_requirement(p_req uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_platform_admin() and exists (
    select 1 from public.assistance_requests a
    where a.requirement_id = p_req and a.status not in ('completed','cancelled'))
$$;
grant execute on function private.admin_can_see_requirement(uuid) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['businesses','business_locations','vehicles','requirements','requirement_cycles','documents'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (org_id in (select private.my_writable_org_ids()))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (org_id in (select private.my_writable_org_ids())) with check (org_id in (select private.my_writable_org_ids()))', t || '_update', t);
    execute format('revoke delete on public.%I from anon, authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

create policy businesses_read on public.businesses for select to authenticated
  using (org_id in (select private.my_org_ids()));
create policy business_locations_read on public.business_locations for select to authenticated
  using (org_id in (select private.my_org_ids()));
create policy vehicles_read on public.vehicles for select to authenticated
  using (org_id in (select private.my_org_ids()));
create policy requirements_read on public.requirements for select to authenticated
  using (org_id in (select private.my_org_ids()) or ((select private.is_platform_admin()) and private.admin_can_see_requirement(id)));
create policy requirement_cycles_read on public.requirement_cycles for select to authenticated
  using (org_id in (select private.my_org_ids()) or ((select private.is_platform_admin()) and private.admin_can_see_requirement(requirement_id)));
create policy documents_read on public.documents for select to authenticated
  using (org_id in (select private.my_org_ids()) or ((select private.is_platform_admin()) and private.admin_can_see_requirement(requirement_id)));

alter table public.assistance_requests enable row level security;
create policy assistance_requests_read on public.assistance_requests for select to authenticated
  using (org_id in (select private.my_org_ids()) or (select private.is_platform_admin()));
create policy assistance_requests_insert on public.assistance_requests for insert to authenticated
  with check (org_id in (select private.my_writable_org_ids()) and status = 'submitted');
create policy assistance_requests_update on public.assistance_requests for update to authenticated
  using (org_id in (select private.my_writable_org_ids()) or (select private.is_platform_admin()))
  with check (org_id in (select private.my_writable_org_ids()) or (select private.is_platform_admin()));
revoke delete on public.assistance_requests from anon, authenticated;
revoke all on public.assistance_requests from anon;

-- ---------------------------------------------------------------- the status engine
-- The single place compliance status is decided. The dashboard, compliance page,
-- document vault, reminders and emails all read from here, in Philippine time.
--
--   needs_information - never recorded, no expiry date on something that expires,
--                       or no document on file yet
--   action_required   - past its expiry date
--   renew_soon        - expires within 30 days
--   compliant         - document on file and not expiring within 30 days
--                       (for things that never expire: document on file)
--   in_progress       - a renewal is underway (customer said so, or a help request is open)
create view public.requirement_status with (security_invoker = true) as
select
  r.id, r.org_id, r.subject, r.business_id, r.location_id, r.vehicle_id, r.type_code, r.name,
  r.expires, r.confidence, r.notes, r.renewal_started_at, r.created_at, r.updated_at,
  coalesce(b.name, v.make_model) as subject_name,
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
  end as next_action
from public.requirements r
cross join lateral (select private.today_ph() as today) t
left join public.businesses b on b.id = r.business_id
left join public.business_locations l on l.id = r.location_id
left join public.vehicles v on v.id = r.vehicle_id
left join lateral (
  select c.* from public.requirement_cycles c
  where c.requirement_id = r.id and c.deleted_at is null
  order by c.created_at desc, c.id desc limit 1
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
  and (v.id is null or v.deleted_at is null);

revoke all on public.requirement_status from anon;
grant select on public.requirement_status to authenticated;

-- ---------------------------------------------------------------- one-step creation (atomic)
-- Adding a business creates its main branch and a starter checklist from the library,
-- based on what the business does and how it is registered.
create function public.create_business(
  p_org uuid, p_name text, p_structure text, p_activity text,
  p_city text default '', p_address text default ''
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_biz uuid;
  v_loc uuid;
begin
  insert into public.businesses (org_id, name, structure, activity)
  values (p_org, btrim(p_name), p_structure, p_activity) returning id into v_biz;

  insert into public.business_locations (org_id, business_id, name, city, address, is_main)
  values (p_org, v_biz, 'Main branch', coalesce(btrim(p_city), ''), coalesce(btrim(p_address), ''), true)
  returning id into v_loc;

  perform set_config('pp.quiet_audit', 'on', true);
  insert into public.requirements (org_id, subject, business_id, location_id, type_code, name, expires, confidence)
  select p_org, 'business', v_biz, case when t.per_location then v_loc end, t.code, t.name, t.expires, t.confidence
  from public.requirement_types t
  where t.subject = 'business' and t.auto_add
    and (t.activities is null or p_activity = any(t.activities))
    and (t.structures is null or p_structure = any(t.structures))
  order by t.sort;
  perform set_config('pp.quiet_audit', 'off', true);
  return v_biz;
end $$;

-- A new branch gets its own copy of every per-branch requirement (each branch needs its
-- own Mayor's Permit, Barangay Clearance, BIR COR, FSIC...).
create function public.add_location(p_business uuid, p_name text, p_city text default '', p_address text default '')
returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_biz public.businesses;
  v_loc uuid;
begin
  select * into v_biz from public.businesses where id = p_business and deleted_at is null;
  if v_biz.id is null then raise exception 'That business was not found.' using errcode = '23503'; end if;

  insert into public.business_locations (org_id, business_id, name, city, address, is_main)
  values (v_biz.org_id, v_biz.id, btrim(p_name), coalesce(btrim(p_city), ''), coalesce(btrim(p_address), ''), false)
  returning id into v_loc;

  perform set_config('pp.quiet_audit', 'on', true);
  insert into public.requirements (org_id, subject, business_id, location_id, type_code, name, expires, confidence)
  select v_biz.org_id, 'business', v_biz.id, v_loc, t.code, t.name, t.expires, t.confidence
  from public.requirement_types t
  where t.subject = 'business' and t.auto_add and t.per_location
    and (t.activities is null or v_biz.activity = any(t.activities))
    and (t.structures is null or v_biz.structure = any(t.structures))
  order by t.sort;
  perform set_config('pp.quiet_audit', 'off', true);
  return v_loc;
end $$;

-- Adding a vehicle creates its standard requirements, and records the registration and
-- CTPL details straight away if the customer already has them.
create function public.create_vehicle(
  p_org uuid, p_make_model text, p_plate_no text, p_vehicle_type text, p_cr_no text default '',
  p_business uuid default null,
  p_or_no text default null, p_registration_expires date default null,
  p_ctpl_provider text default null, p_ctpl_policy_no text default null, p_ctpl_expires date default null
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_vehicle uuid;
  v_reg_req uuid;
  v_ctpl_req uuid;
  v_reg_cycle uuid;
  v_ctpl_cycle uuid;
begin
  insert into public.vehicles (org_id, make_model, plate_no, vehicle_type, cr_no, business_id)
  values (p_org, btrim(p_make_model), upper(btrim(coalesce(p_plate_no, ''))), coalesce(nullif(btrim(p_vehicle_type), ''), 'Sedan'),
          btrim(coalesce(p_cr_no, '')), p_business)
  returning id into v_vehicle;

  perform set_config('pp.quiet_audit', 'on', true);
  insert into public.requirements (org_id, subject, vehicle_id, type_code, name, expires, confidence)
  select p_org, 'vehicle', v_vehicle, t.code, t.name, t.expires, t.confidence
  from public.requirement_types t
  where t.subject = 'vehicle' and t.auto_add
  order by t.sort;

  select id into v_reg_req from public.requirements where vehicle_id = v_vehicle and type_code = 'lto_registration' and deleted_at is null;
  select id into v_ctpl_req from public.requirements where vehicle_id = v_vehicle and type_code = 'ctpl' and deleted_at is null;

  if nullif(btrim(p_or_no), '') is not null or p_registration_expires is not null then
    insert into public.requirement_cycles (org_id, requirement_id, reference_no, expires_on)
    values (p_org, v_reg_req, nullif(btrim(p_or_no), ''), p_registration_expires) returning id into v_reg_cycle;
  end if;
  if nullif(btrim(p_ctpl_provider), '') is not null or nullif(btrim(p_ctpl_policy_no), '') is not null or p_ctpl_expires is not null then
    insert into public.requirement_cycles (org_id, requirement_id, reference_no, issuer, expires_on)
    values (p_org, v_ctpl_req, nullif(btrim(p_ctpl_policy_no), ''), nullif(btrim(p_ctpl_provider), ''), p_ctpl_expires)
    returning id into v_ctpl_cycle;
  end if;
  perform set_config('pp.quiet_audit', 'off', true);

  return jsonb_build_object(
    'vehicle_id', v_vehicle,
    'registration', jsonb_build_object('requirement_id', v_reg_req, 'cycle_id', v_reg_cycle),
    'ctpl', jsonb_build_object('requirement_id', v_ctpl_req, 'cycle_id', v_ctpl_cycle));
end $$;

-- Add one requirement (from the library or a custom one), optionally with its current record.
create function public.add_requirement(
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
  end if;
  if v_org is null then raise exception 'That business or vehicle was not found.' using errcode = '23503'; end if;

  if p_type_code is not null then
    select * into v_type from public.requirement_types where code = p_type_code and subject = p_subject;
    if v_type.code is null then raise exception 'Unknown requirement type.' using errcode = '22023'; end if;
  elsif coalesce(btrim(p_name), '') = '' then
    raise exception 'Please describe the requirement.' using errcode = '22023';
  end if;

  insert into public.requirements (org_id, subject, business_id, location_id, vehicle_id, type_code, name, expires, confidence)
  values (
    v_org, p_subject,
    case when p_subject = 'business' then p_subject_id end,
    case when p_subject = 'business' then p_location end,
    case when p_subject = 'vehicle' then p_subject_id end,
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

revoke execute on function public.create_business(uuid,text,text,text,text,text), public.add_location(uuid,text,text,text),
  public.create_vehicle(uuid,text,text,text,text,uuid,text,date,text,text,date),
  public.add_requirement(text,uuid,uuid,text,text,boolean,text,text,date,date) from public, anon;
grant execute on function public.create_business(uuid,text,text,text,text,text), public.add_location(uuid,text,text,text),
  public.create_vehicle(uuid,text,text,text,text,uuid,text,date,text,text,date),
  public.add_requirement(text,uuid,uuid,text,text,boolean,text,text,date,date) to authenticated;

-- ---------------------------------------------------------------- file storage
-- Private buckets. Files live at documents/<org id>/<requirement id>/<random>-<name>.
-- Customers can upload and read their workspace's files but cannot delete or overwrite
-- them: "delete" in the app only hides the document row, so the file is always recoverable.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('documents', 'documents', false, 10485760,
    array['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif']),
  ('avatars', 'avatars', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy "documents: members can read" on storage.objects for select to authenticated
  using (
    bucket_id = 'documents' and (
      (storage.foldername(name))[1] in (select o::text from private.my_org_ids() o)
      or ((select private.is_platform_admin()) and exists (
            select 1 from public.documents d
            where d.storage_path = storage.objects.name and private.admin_can_see_requirement(d.requirement_id)))
    )
  );
create policy "documents: members can upload" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] in (select o::text from private.my_writable_org_ids() o)
  );

create policy "avatars: signed-in users can read" on storage.objects for select to authenticated
  using (bucket_id = 'avatars');
create policy "avatars: owner can upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: owner can replace" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: owner can remove" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
