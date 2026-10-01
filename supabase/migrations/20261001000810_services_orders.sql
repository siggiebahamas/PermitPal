-- Done-for-you services: catalog, quote -> accept -> pay -> in progress -> done, with a timeline per order.

-- ================================================================ service catalog
-- Prices here are starting points the founder edits in Admin > Services. Customers never
-- pay a catalog price directly: every request gets an exact quote first.
create table public.services (
  code          text primary key check (code ~ '^[a-z0-9_]{2,60}$'),
  name          text not null check (length(btrim(name)) between 1 and 120),
  category      text not null check (category in ('renewal','plan','package','document','advisory')),
  summary       text not null default '' check (length(summary) <= 600),
  includes      text[] not null default '{}',
  price_from    numeric(12,2) check (price_from is null or price_from >= 0),
  price_unit    text not null default 'per request' check (length(price_unit) <= 60),
  turnaround    text not null default '' check (length(turnaround) <= 80),
  applies_to    text not null default 'any' check (applies_to in ('business','vehicle','person','any')),
  type_codes    text[] not null default '{}',
  active        boolean not null default true,
  sort          int not null default 100,
  updated_at    timestamptz not null default now()
);
create trigger services_touch before update on public.services for each row execute function private.touch_updated_at();
alter table public.services enable row level security;
create policy services_read on public.services for select to anon, authenticated using (active or (select private.is_platform_admin()));
create policy services_admin_insert on public.services for insert to authenticated with check ((select private.is_platform_admin()));
create policy services_admin_update on public.services for update to authenticated
  using ((select private.is_platform_admin())) with check ((select private.is_platform_admin()));
revoke delete on public.services from anon, authenticated;
grant select on public.services to anon;

insert into public.services (code, name, category, summary, includes, price_from, price_unit, turnaround, applies_to, type_codes, sort) values
  ('renew_mayors_permit', 'Mayor''s / Business Permit renewal', 'renewal',
   'We prepare, file and follow up your renewal at the city or municipal hall, then upload the new permit to PermitPal for you.',
   array['Checklist of what your city needs, sent to you','Filing and follow-up at the BPLO','Government fees paid at cost, official receipts uploaded','New permit saved to your account'],
   2500, 'per permit', '5-15 working days', 'business', array['mayors_permit'], 10),
  ('renew_barangay_clearance', 'Barangay Business Clearance', 'renewal',
   'We get your barangay clearance, usually the first step before the Mayor''s Permit.',
   array['Filing at your barangay hall','Fees at cost, receipt uploaded','Clearance saved to your account'],
   1000, 'per clearance', '1-5 working days', 'business', array['barangay_clearance'], 20),
  ('renew_fsic', 'Fire Safety Inspection Certificate (FSIC)', 'renewal',
   'We file your FSIC application and coordinate the inspection schedule with the Bureau of Fire Protection.',
   array['Application and inspection scheduling','Follow-up until release','Certificate saved to your account'],
   1500, 'per certificate', '5-15 working days', 'business', array['fsic'], 30),
  ('renew_sanitary_permit', 'Sanitary Permit renewal', 'renewal',
   'We handle your sanitary permit with the city or municipal health office.',
   array['Filing and follow-up','Fees at cost, receipt uploaded','Permit saved to your account'],
   1200, 'per permit', '3-10 working days', 'business', array['sanitary_permit'], 40),
  ('renew_lto_registration', 'LTO vehicle registration renewal', 'renewal',
   'We take care of your vehicle''s registration renewal, including the emission test and inspection steps.',
   array['Emission test and inspection coordination','Filing at LTO','Fees at cost, receipts uploaded','New OR/CR saved to your account'],
   800, 'per vehicle', '1-5 working days', 'vehicle', array['lto_registration','emission_test','mvir'], 50),
  ('renew_ctpl', 'CTPL insurance purchase', 'renewal',
   'We buy your compulsory CTPL insurance before registration and upload the certificate.',
   array['Premium at cost from an accredited insurer','Certificate of cover saved to your account'],
   300, 'handling fee per vehicle', '1-2 working days', 'vehicle', array['ctpl'], 60),
  ('renew_other', 'Any other permit or license', 'renewal',
   'Tell us what you need renewed and we''ll send an exact quote before anything starts.',
   array['Exact quote first','Filing and follow-up','Document saved to your account'],
   null, 'quoted per permit', 'Depends on the agency', 'any', '{}', 90),
  ('plan_branch_care', 'Year-round care: business branch', 'plan',
   'We watch every permit of one branch all year and renew each one before it expires. You only pay government fees at cost on top.',
   array['All renewals for the branch handled','Reminders handled for you','Priority turnaround','One monthly fee'],
   1500, 'per branch / month', 'Ongoing', 'business', '{}', 110),
  ('plan_vehicle_care', 'Year-round care: vehicle', 'plan',
   'We handle the vehicle''s registration, CTPL, emission test and inspection every year.',
   array['Registration renewal handled','CTPL bought on time','Emission and inspection coordinated','One monthly fee'],
   300, 'per vehicle / month', 'Ongoing', 'vehicle', '{}', 120),
  ('pkg_new_business', 'New business registration', 'package',
   'From business name to Mayor''s Permit and BIR registration, done for you in the right order.',
   array['DTI, SEC or CDA registration','Barangay clearance','Mayor''s Permit','BIR registration','Everything saved to your account'],
   15000, 'one-time, plus government fees', '3-6 weeks', 'any', '{}', 210),
  ('pkg_new_branch', 'New branch opening', 'package',
   'All the permits a new branch needs before it opens.',
   array['Barangay clearance','Mayor''s Permit','FSIC','BIR branch registration','Saved to your account'],
   8000, 'per branch, plus government fees', '2-5 weeks', 'business', '{}', 220),
  ('pkg_amendment', 'Change of address, name or line of business', 'package',
   'We update your registrations everywhere they need to change.',
   array['Review of what has to change','Filing with each agency','Updated documents saved to your account'],
   5000, 'one-time, plus government fees', '2-6 weeks', 'business', '{}', 230),
  ('pkg_closure', 'Business closure (retirement)', 'package',
   'We close your business registrations properly so penalties don''t keep running.',
   array['Retirement at the city or municipal hall','BIR closure filing','Proof of closure saved to your account'],
   8000, 'one-time, plus government fees', '3-8 weeks', 'business', '{}', 240),
  ('doc_replacement', 'Lost permit replacement or certified copy', 'document',
   'We request a replacement or certified true copy of a permit or registration.',
   array['Request filed with the issuing office','Copy saved to your account'],
   1500, 'per document, plus government fees', '3-10 working days', 'any', '{}', 310),
  ('doc_bir_update', 'BIR registration update', 'document',
   'We file your BIR registration update when your business details change.',
   array['Filing and follow-up at your RDO','Updated COR saved to your account'],
   2500, 'one-time', '1-3 weeks', 'business', array['bir_cor'], 320),
  ('adv_fire_preinspection', 'Fire safety pre-inspection check', 'advisory',
   'A walk-through before the BFP inspection so you know what to fix first.',
   array['On-site checklist review','List of fixes before the inspection'],
   2500, 'per site', 'Scheduled with you', 'business', array['fsic'], 410),
  ('adv_philgeps', 'PhilGEPS document upkeep', 'advisory',
   'We keep the documents you need for government bidding current all year.',
   array['Tracking of every PhilGEPS document','Renewals flagged early','Updates filed on the portal'],
   2000, 'per year', 'Ongoing', 'business', '{}', 420),
  ('adv_employer_registration', 'SSS, PhilHealth and Pag-IBIG employer registration', 'advisory',
   'We register your business as an employer with all three agencies.',
   array['SSS employer registration','PhilHealth employer registration','Pag-IBIG employer registration'],
   3500, 'one-time', '1-3 weeks', 'business', '{}', 430);

-- ================================================================ service orders
-- Help requests become orders: request -> quote -> accept -> pay -> in progress -> done.
alter table public.assistance_requests
  add column service_code text references public.services(code),
  add column business_id uuid references public.businesses(id) on delete set null,
  add column vehicle_id uuid references public.vehicles(id) on delete set null,
  add column person_id uuid references public.people(id) on delete set null,
  add column rush boolean not null default false,
  add column quote_service_fee numeric(12,2) check (quote_service_fee is null or quote_service_fee >= 0),
  add column quote_gov_fees numeric(12,2) check (quote_gov_fees is null or quote_gov_fees >= 0),
  add column quote_note text check (quote_note is null or length(quote_note) <= 2000),
  add column quoted_at timestamptz,
  add column accepted_at timestamptz,
  add column payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid','awaiting_payment','pending_verification','paid','waived','refunded')),
  add column payment_method text check (payment_method is null or payment_method in ('paymongo','gcash','maya','bank_transfer','cash','other')),
  add column payment_ref text check (payment_ref is null or length(payment_ref) <= 120),
  add column paid_at timestamptz,
  add column gov_fees_actual numeric(12,2) check (gov_fees_actual is null or gov_fees_actual >= 0);
alter table public.assistance_requests drop constraint assistance_requests_status_check;
alter table public.assistance_requests add constraint assistance_requests_status_check
  check (status in ('submitted','quoted','matching','provider_contacted','awaiting_customer','in_progress','completed','cancelled'));
create index assistance_requests_business_idx on public.assistance_requests(business_id);
create index assistance_requests_vehicle_idx on public.assistance_requests(vehicle_id);

create or replace function private.help_status_label(s text) returns text
language sql immutable set search_path = '' as $$
  select case s
    when 'submitted' then 'Preparing your quote'
    when 'quoted' then 'Quote ready'
    when 'matching' then 'Finding a provider'
    when 'provider_contacted' then 'Provider contacted'
    when 'awaiting_customer' then 'Waiting for you'
    when 'in_progress' then 'In progress'
    when 'completed' then 'Completed'
    when 'cancelled' then 'Cancelled'
    else s end
$$;

-- Timeline of an order: every status change, quote, payment, message and file.
create table public.request_events (
  id          bigint generated always as identity primary key,
  request_id  uuid not null references public.assistance_requests(id) on delete cascade,
  org_id      uuid not null references public.orgs(id) on delete cascade,
  actor_id    uuid default auth.uid() references auth.users(id) on delete set null,
  by_staff    boolean not null default false,
  kind        text not null check (kind in ('created','status','quote','accepted','payment','message','file','completed','cancelled')),
  message     text check (message is null or length(message) <= 2000),
  file_path   text,
  file_name   text check (file_name is null or length(file_name) <= 255),
  created_at  timestamptz not null default now()
);
create index request_events_req_idx on public.request_events(request_id, id);
alter table public.request_events enable row level security;
create policy request_events_read on public.request_events for select to authenticated
  using (org_id in (select private.my_org_ids()) or (select private.is_platform_admin()));
revoke insert, update, delete on public.request_events from anon, authenticated;
revoke all on public.request_events from anon;

create function private.order_event(p_req uuid, p_kind text, p_message text, p_file_path text default null, p_file_name text default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.request_events (request_id, org_id, by_staff, kind, message, file_path, file_name)
  select a.id, a.org_id, coalesce(private.is_platform_admin(), false), p_kind, p_message, p_file_path, p_file_name
  from public.assistance_requests a where a.id = p_req
$$;

create function private.notify_admins(p_title text, p_body text, p_key text, p_email boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare v_admin record; v_email text;
begin
  for v_admin in select id from public.profiles where is_platform_admin loop
    perform private.notify(v_admin.id, null, 'help', p_title, p_body, '#/admin', null, p_key || ':' || v_admin.id, false);
  end loop;
  if p_email then
    for v_email in select btrim(e) from unnest(string_to_array(coalesce(private.setting('admin_notify_emails'), ''), ',')) e where btrim(e) <> '' loop
      insert into public.message_outbox (channel, to_address, subject, body_text, body_html, dedupe_key)
      values ('email', v_email, p_title, p_body || E'\n' || coalesce(private.setting('app_url'), '') || '#/admin',
              private.email_html(p_title, '<p>' || private.html_escape(p_body) || '</p>', 'Open admin console', coalesce(private.setting('app_url'), '') || '#/admin'),
              p_key || ':mail:' || v_email)
      on conflict (dedupe_key) do nothing;
    end loop;
  end if;
end $$;

create or replace function private.assistance_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_rs record;
  v_svc public.services;
begin
  if tg_op = 'INSERT' then
    if new.service_code is not null then
      select * into v_svc from public.services where code = new.service_code and active;
      if v_svc.code is null then raise exception 'That service is not available.' using errcode = '22023'; end if;
    end if;
    if new.requirement_id is not null then
      select rs.name, rs.subject, rs.subject_name, rs.plate_no, rs.location_name, rs.location_is_main, rs.location_city, rs.expires_on,
             rs.business_id, rs.vehicle_id, rs.person_id
        into v_rs from public.requirement_status rs where rs.id = new.requirement_id and rs.org_id = new.org_id;
      if v_rs.name is null then raise exception 'That requirement was not found.' using errcode = '23503'; end if;
      if exists (select 1 from public.assistance_requests a where a.requirement_id = new.requirement_id
                 and a.status not in ('completed','cancelled')) then
        raise exception 'You already have an open request for this requirement.' using errcode = 'P0001';
      end if;
      new.requirement_name := v_rs.name;
      new.subject_label := coalesce(v_rs.subject_name, '') || case when coalesce(v_rs.plate_no, '') <> '' then ' (' || v_rs.plate_no || ')' else '' end;
      new.location_label := nullif(concat_ws(', ', case when not coalesce(v_rs.location_is_main, true) then v_rs.location_name end, nullif(v_rs.location_city, '')), '');
      new.due_on := v_rs.expires_on;
      new.business_id := v_rs.business_id; new.vehicle_id := v_rs.vehicle_id; new.person_id := v_rs.person_id;
    else
      if v_svc.code is null then raise exception 'Choose a service or a permit.' using errcode = '22023'; end if;
      new.requirement_name := v_svc.name;
      new.subject_label := coalesce(
        (select b.name from public.businesses b where b.id = new.business_id and b.org_id = new.org_id and b.deleted_at is null),
        (select v.make_model || case when v.plate_no <> '' then ' (' || v.plate_no || ')' else '' end
           from public.vehicles v where v.id = new.vehicle_id and v.org_id = new.org_id and v.deleted_at is null),
        (select p.full_name from public.people p where p.id = new.person_id and p.org_id = new.org_id and p.deleted_at is null),
        (select o.name from public.orgs o where o.id = new.org_id));
      new.location_label := null;
      new.due_on := null;
    end if;
    new.status := 'submitted';
    new.provider_name := null; new.quote_php := null; new.admin_note := null; new.closed_at := null;
    new.quote_service_fee := null; new.quote_gov_fees := null; new.quote_note := null; new.quoted_at := null;
    new.accepted_at := null; new.payment_status := 'unpaid'; new.payment_method := null; new.payment_ref := null;
    new.paid_at := null; new.gov_fees_actual := null;
    new.created_by := auth.uid();
    return new;
  end if;

  -- Customers may only cancel; everything else goes through the order functions below.
  if auth.uid() is not null and not private.is_platform_admin()
     and coalesce(current_setting('pp.order_rpc', true), 'off') <> 'on' then
    if new.status is distinct from old.status and (new.status <> 'cancelled' or old.status in ('completed','cancelled')) then
      raise exception 'You can only cancel an open request.' using errcode = '42501';
    end if;
    new.provider_name := old.provider_name; new.quote_php := old.quote_php; new.admin_note := old.admin_note;
    new.requirement_id := old.requirement_id; new.requirement_name := old.requirement_name;
    new.subject_label := old.subject_label; new.location_label := old.location_label; new.due_on := old.due_on;
    new.docs_status := old.docs_status; new.created_by := old.created_by;
    new.service_code := old.service_code; new.business_id := old.business_id; new.vehicle_id := old.vehicle_id; new.person_id := old.person_id;
    new.rush := old.rush; new.quote_service_fee := old.quote_service_fee; new.quote_gov_fees := old.quote_gov_fees;
    new.quote_note := old.quote_note; new.quoted_at := old.quoted_at; new.accepted_at := old.accepted_at;
    new.payment_status := old.payment_status; new.payment_method := old.payment_method; new.payment_ref := old.payment_ref;
    new.paid_at := old.paid_at; new.gov_fees_actual := old.gov_fees_actual;
  end if;
  if new.status in ('completed','cancelled') and old.status not in ('completed','cancelled') then
    new.closed_at := now();
  elsif new.status not in ('completed','cancelled') then
    new.closed_at := null;
  end if;
  return new;
end $$;

create or replace function private.assistance_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_org_name text;
  v_requester text;
  v_contact text;
  v_body text;
begin
  select name into v_org_name from public.orgs where id = new.org_id;

  if tg_op = 'INSERT' then
    select coalesce(nullif(btrim(p.first_name || ' ' || p.last_name), ''), p.email), p.email into v_requester, v_contact
      from public.profiles p where p.id = new.created_by;
    v_body := v_org_name || ' - ' || new.requirement_name || ' for ' || new.subject_label ||
              case when new.due_on is not null then ', due ' || private.fmt_date(new.due_on) else '' end ||
              case when new.rush then ' - RUSH' else '' end ||
              '. Requested by ' || coalesce(v_requester, '-') || ' (' || coalesce(v_contact, '-') || '), contact via ' ||
              new.contact_method || coalesce(': ' || new.contact_value, '') || '. Notes: ' || coalesce(new.notes, '-');
    perform private.notify_admins('New request: ' || new.requirement_name, v_body, 'ordernew:' || new.id, true);
    insert into public.request_events (request_id, org_id, actor_id, by_staff, kind, message)
    values (new.id, new.org_id, new.created_by, false, 'created', coalesce(nullif(btrim(new.notes), ''), 'Request sent'));
    if new.created_by is not null then
      perform private.notify(new.created_by, new.org_id, 'help', 'We received your request',
        new.requirement_name || ' for ' || new.subject_label || '. You''ll get an exact quote before anything starts.',
        '#/services/orders/' || new.id, new.requirement_id, 'orderack:' || new.id, true);
    end if;
    return null;
  end if;

  -- Status changed: tell the customer (staff changes) or staff (customer cancelled).
  if new.status is distinct from old.status then
    if new.created_by is not null and (auth.uid() is null or private.is_platform_admin()) then
      perform private.notify(new.created_by, new.org_id, 'help',
        new.requirement_name || ': ' || private.help_status_label(new.status),
        new.subject_label || case when new.admin_note is not null then '. ' || new.admin_note else '' end,
        '#/services/orders/' || new.id, new.requirement_id,
        'orderupd:' || new.id || ':' || new.status || ':' || extract(epoch from new.updated_at)::bigint, true);
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

-- Customer: ask for a service (with or without a specific permit).
create function public.request_service(
  p_org uuid, p_service text, p_requirement uuid default null, p_business uuid default null, p_vehicle uuid default null,
  p_person uuid default null, p_notes text default null, p_rush boolean default false,
  p_contact_method text default 'email', p_contact_value text default null, p_docs_status text default 'not_sure'
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.assistance_requests (org_id, service_code, requirement_id, business_id, vehicle_id, person_id,
    requirement_name, subject_label, notes, rush, contact_method, contact_value, docs_status)
  values (p_org, p_service, p_requirement, p_business, p_vehicle, p_person, '-', '-',
    nullif(btrim(p_notes), ''), coalesce(p_rush, false), coalesce(p_contact_method, 'email'), nullif(btrim(p_contact_value), ''),
    coalesce(p_docs_status, 'not_sure'))
  returning id into v_id;
  return v_id;
end $$;

-- Staff: send the exact quote.
create function public.admin_quote_request(p_req uuid, p_service_fee numeric, p_gov_fees numeric, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_total numeric;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  if p_service_fee is null or p_service_fee < 0 or coalesce(p_gov_fees, 0) < 0 then raise exception 'Enter valid amounts.' using errcode = '22023'; end if;
  v_total := p_service_fee + coalesce(p_gov_fees, 0);
  update public.assistance_requests set quote_service_fee = p_service_fee, quote_gov_fees = coalesce(p_gov_fees, 0),
    quote_php = v_total, quote_note = nullif(btrim(p_note), ''), quoted_at = now(), accepted_at = null,
    payment_status = 'unpaid', status = 'quoted', admin_note = null
  where id = p_req and status in ('submitted','quoted','awaiting_customer');
  if not found then raise exception 'This request can no longer be quoted.' using errcode = 'P0001'; end if;
  perform private.order_event(p_req, 'quote', 'Quote: PHP ' || to_char(v_total, 'FM999,999,990.00') ||
    ' (service fee ' || to_char(p_service_fee, 'FM999,999,990.00') || ', government fees ' || to_char(coalesce(p_gov_fees, 0), 'FM999,999,990.00') || ')' ||
    coalesce('. ' || nullif(btrim(p_note), ''), ''));
end $$;

-- Customer: accept the quote. A free job (nothing to pay) starts right away.
create function public.accept_quote(p_req uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_a public.assistance_requests;
begin
  select * into v_a from public.assistance_requests where id = p_req;
  if v_a.id is null or v_a.org_id not in (select private.my_writable_org_ids()) then raise exception 'Request not found.' using errcode = '42501'; end if;
  if v_a.status <> 'quoted' then raise exception 'There is no quote to accept.' using errcode = 'P0001'; end if;
  perform set_config('pp.order_rpc', 'on', true);
  update public.assistance_requests set accepted_at = now(),
    payment_status = case when coalesce(v_a.quote_php, 0) = 0 then 'waived' else 'awaiting_payment' end,
    status = case when coalesce(v_a.quote_php, 0) = 0 then 'in_progress' else 'awaiting_customer' end
  where id = p_req;
  perform set_config('pp.order_rpc', 'off', true);
  perform private.order_event(p_req, 'accepted', 'Quote accepted');
  perform private.notify_admins('Quote accepted: ' || v_a.requirement_name, v_a.subject_label, 'orderacc:' || p_req, true);
end $$;

-- Customer: paid by GCash / bank transfer outside PermitPal - send the reference for checking.
create function public.submit_payment(p_req uuid, p_method text, p_ref text, p_proof_path text default null, p_proof_name text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_a public.assistance_requests;
begin
  select * into v_a from public.assistance_requests where id = p_req;
  if v_a.id is null or v_a.org_id not in (select private.my_writable_org_ids()) then raise exception 'Request not found.' using errcode = '42501'; end if;
  if v_a.payment_status not in ('awaiting_payment','pending_verification') then raise exception 'Nothing to pay on this request.' using errcode = 'P0001'; end if;
  if coalesce(btrim(p_ref), '') = '' and p_proof_path is null then raise exception 'Add the reference number or a screenshot of the payment.' using errcode = '22023'; end if;
  if p_proof_path is not null and split_part(p_proof_path, '/', 1) <> v_a.org_id::text then raise exception 'Invalid file location.' using errcode = '42501'; end if;
  perform set_config('pp.order_rpc', 'on', true);
  update public.assistance_requests set payment_status = 'pending_verification', payment_method = p_method, payment_ref = nullif(btrim(p_ref), '')
  where id = p_req;
  perform set_config('pp.order_rpc', 'off', true);
  perform private.order_event(p_req, 'payment', 'Payment sent by ' || replace(p_method, '_', ' ') || coalesce(' - ref ' || nullif(btrim(p_ref), ''), '') || '. Waiting for PermitPal to confirm.',
    p_proof_path, p_proof_name);
  perform private.notify_admins('Payment to confirm: ' || v_a.requirement_name,
    v_a.subject_label || ' - PHP ' || to_char(v_a.quote_php, 'FM999,999,990.00') || ' via ' || p_method || coalesce(', ref ' || p_ref, ''),
    'orderpay:' || p_req || ':' || extract(epoch from now())::bigint, true);
end $$;

-- Staff: confirm (or reject) a payment.
create function public.admin_confirm_payment(p_req uuid, p_ok boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  if p_ok then
    update public.assistance_requests set payment_status = 'paid', paid_at = now(),
      status = case when status in ('quoted','awaiting_customer','submitted') then 'in_progress' else status end, admin_note = nullif(btrim(p_note), '')
    where id = p_req and payment_status in ('awaiting_payment','pending_verification');
    if not found then raise exception 'Nothing to confirm.' using errcode = 'P0001'; end if;
    perform private.order_event(p_req, 'payment', 'Payment confirmed. Work has started.' || coalesce(' ' || nullif(btrim(p_note), ''), ''));
  else
    update public.assistance_requests set payment_status = 'awaiting_payment', admin_note = nullif(btrim(p_note), ''), status = 'awaiting_customer'
    where id = p_req and payment_status = 'pending_verification';
    if not found then raise exception 'Nothing to check.' using errcode = 'P0001'; end if;
    perform private.order_event(p_req, 'payment', 'We could not match this payment. ' || coalesce(nullif(btrim(p_note), ''), 'Please check the reference and send it again.'));
  end if;
end $$;

-- Staff: move the job along, with an optional message and file (e.g. official receipt).
create function public.admin_update_order(p_req uuid, p_status text, p_message text default null,
  p_file_path text default null, p_file_name text default null, p_gov_fees_actual numeric default null, p_provider text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old text;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select status into v_old from public.assistance_requests where id = p_req;
  if v_old is null then raise exception 'Request not found.' using errcode = '23503'; end if;
  update public.assistance_requests set status = coalesce(p_status, status), admin_note = coalesce(nullif(btrim(p_message), ''), admin_note),
    gov_fees_actual = coalesce(p_gov_fees_actual, gov_fees_actual), provider_name = coalesce(nullif(btrim(p_provider), ''), provider_name)
  where id = p_req;
  if p_status is not null and p_status is distinct from v_old then
    perform private.order_event(p_req, case p_status when 'completed' then 'completed' when 'cancelled' then 'cancelled' else 'status' end,
      private.help_status_label(p_status) || coalesce('. ' || nullif(btrim(p_message), ''), ''), p_file_path, p_file_name);
  elsif nullif(btrim(p_message), '') is not null or p_file_path is not null then
    perform private.order_event(p_req, case when p_file_path is not null then 'file' else 'message' end, nullif(btrim(p_message), ''), p_file_path, p_file_name);
    if (select created_by from public.assistance_requests where id = p_req) is not null then
      perform private.notify((select created_by from public.assistance_requests where id = p_req), (select org_id from public.assistance_requests where id = p_req),
        'help', 'Update on your request', coalesce(nullif(btrim(p_message), ''), 'A new file was added'),
        '#/services/orders/' || p_req, null, 'ordermsg:' || p_req || ':' || extract(epoch from clock_timestamp())::bigint, true);
    end if;
  end if;
end $$;

-- Either side: a message or file on the order.
create function public.add_order_message(p_req uuid, p_message text, p_file_path text default null, p_file_name text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_a public.assistance_requests;
begin
  select * into v_a from public.assistance_requests where id = p_req;
  if v_a.id is null or not (v_a.org_id in (select private.my_writable_org_ids()) or private.is_platform_admin()) then
    raise exception 'Request not found.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_message), '') = '' and p_file_path is null then raise exception 'Write a message or attach a file.' using errcode = '22023'; end if;
  if p_file_path is not null and split_part(p_file_path, '/', 1) <> v_a.org_id::text then raise exception 'Invalid file location.' using errcode = '42501'; end if;
  perform private.order_event(p_req, case when p_file_path is not null then 'file' else 'message' end, nullif(btrim(p_message), ''), p_file_path, p_file_name);
  if private.is_platform_admin() then
    if v_a.created_by is not null then
      perform private.notify(v_a.created_by, v_a.org_id, 'help', 'New message about your request', coalesce(nullif(btrim(p_message), ''), 'A new file was added'),
        '#/services/orders/' || p_req, null, 'ordermsg:' || p_req || ':' || extract(epoch from clock_timestamp())::bigint, true);
    end if;
  else
    perform private.notify_admins('Customer message: ' || v_a.requirement_name, v_a.subject_label || ' - ' || coalesce(p_message, 'file attached'),
      'ordercmsg:' || p_req || ':' || extract(epoch from clock_timestamp())::bigint, false);
  end if;
end $$;

-- Staff: the renewal is done. Save the new permit to the customer's requirement and close the job.
create function public.admin_record_renewal(p_req uuid, p_reference text, p_issuer text, p_issued date, p_expires date,
  p_amount numeric, p_file_path text default null, p_file_name text default null, p_mime text default null, p_size bigint default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_a public.assistance_requests; v_cycle uuid;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select * into v_a from public.assistance_requests where id = p_req;
  if v_a.requirement_id is null then raise exception 'This request is not linked to a permit. Attach the file as a message instead.' using errcode = 'P0001'; end if;
  insert into public.requirement_cycles (org_id, requirement_id, reference_no, issuer, issued_on, expires_on, amount_paid)
  values (v_a.org_id, v_a.requirement_id, nullif(btrim(p_reference), ''), nullif(btrim(p_issuer), ''), p_issued, p_expires, p_amount)
  returning id into v_cycle;
  if p_file_path is not null then
    insert into public.documents (org_id, requirement_id, cycle_id, storage_path, file_name, mime_type, size_bytes)
    values (v_a.org_id, v_a.requirement_id, v_cycle, p_file_path, coalesce(p_file_name, 'permit'), p_mime, p_size);
  end if;
  update public.assistance_requests set status = 'completed', gov_fees_actual = coalesce(p_amount, gov_fees_actual) where id = p_req;
  perform private.order_event(p_req, 'completed', 'Done. The new permit is saved to your account' ||
    case when p_expires is not null then ' (valid until ' || private.fmt_date(p_expires) || ')' else '' end || '.', p_file_path, p_file_name);
  return v_cycle;
end $$;

-- Online payment (PayMongo): the create-checkout function calls this as the customer.
alter table public.payments alter column plan_id drop not null;
alter table public.payments add column request_id uuid references public.assistance_requests(id) on delete set null;
create function public.order_payment_start(p_req uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_a public.assistance_requests; v_id uuid;
begin
  select * into v_a from public.assistance_requests where id = p_req;
  if v_a.id is null or v_a.org_id not in (select private.my_writable_org_ids()) then raise exception 'Request not found.' using errcode = '42501'; end if;
  if v_a.payment_status <> 'awaiting_payment' or coalesce(v_a.quote_php, 0) <= 0 then raise exception 'Nothing to pay on this request.' using errcode = 'P0001'; end if;
  insert into public.payments (org_id, request_id, amount_php, created_by) values (v_a.org_id, p_req, v_a.quote_php, auth.uid()) returning id into v_id;
  return jsonb_build_object('payment_id', v_id, 'amount_php', v_a.quote_php, 'name', v_a.requirement_name, 'description', v_a.subject_label,
    'email', (select email from public.profiles where id = auth.uid()));
end $$;

create or replace function public.billing_mark_paid(p_checkout_id text, p_raw jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_pay public.payments;
  v_org public.orgs;
  v_from timestamptz;
  v_owner record;
begin
  select * into v_pay from public.payments where checkout_id = p_checkout_id for update;
  if v_pay.id is null or v_pay.status = 'paid' then return; end if;
  update public.payments set status = 'paid', paid_at = now(), raw = p_raw where id = v_pay.id;
  if v_pay.request_id is not null then
    update public.assistance_requests set payment_status = 'paid', payment_method = 'paymongo', payment_ref = p_checkout_id, paid_at = now(),
      status = case when status in ('quoted','awaiting_customer','submitted') then 'in_progress' else status end
    where id = v_pay.request_id;
    perform private.order_event(v_pay.request_id, 'payment', 'Paid online - PHP ' || to_char(v_pay.amount_php, 'FM999,999,990.00') || '. Work has started.');
    perform private.notify_admins('Paid online: request', 'PHP ' || to_char(v_pay.amount_php, 'FM999,999,990.00'), 'orderpaid:' || v_pay.id, true);
    return;
  end if;
  select * into v_org from public.orgs where id = v_pay.org_id for update;
  v_from := case when v_org.plan_id = v_pay.plan_id and v_org.plan_expires_at > now() then v_org.plan_expires_at else now() end;
  update public.orgs set plan_id = v_pay.plan_id, plan_expires_at = v_from + make_interval(months => v_pay.months) where id = v_org.id;
  for v_owner in select user_id from public.org_members where org_id = v_org.id and role = 'owner' loop
    perform private.notify(v_owner.user_id, v_org.id, 'billing', 'Payment received - thank you!',
      'Your ' || (select name from public.plans where id = v_pay.plan_id) || ' plan is active until ' ||
      private.fmt_date(((v_from + make_interval(months => v_pay.months)) at time zone 'Asia/Manila')::date) || '.',
      '#/settings/billing', null, 'paid:' || v_pay.id, true);
  end loop;
end $$;

revoke execute on function public.request_service(uuid,text,uuid,uuid,uuid,uuid,text,boolean,text,text,text),
  public.admin_quote_request(uuid,numeric,numeric,text), public.accept_quote(uuid), public.submit_payment(uuid,text,text,text,text),
  public.admin_confirm_payment(uuid,boolean,text), public.admin_update_order(uuid,text,text,text,text,numeric,text),
  public.add_order_message(uuid,text,text,text),
  public.admin_record_renewal(uuid,text,text,date,date,numeric,text,text,text,bigint), public.order_payment_start(uuid) from public, anon;
grant execute on function public.request_service(uuid,text,uuid,uuid,uuid,uuid,text,boolean,text,text,text),
  public.admin_quote_request(uuid,numeric,numeric,text), public.accept_quote(uuid), public.submit_payment(uuid,text,text,text,text),
  public.admin_confirm_payment(uuid,boolean,text), public.admin_update_order(uuid,text,text,text,text,numeric,text),
  public.add_order_message(uuid,text,text,text),
  public.admin_record_renewal(uuid,text,text,date,date,numeric,text,text,text,bigint), public.order_payment_start(uuid) to authenticated;
revoke execute on function private.order_event(uuid,text,text,text,text), private.notify_admins(text,text,text,boolean) from public, anon, authenticated;

-- Staff can put files (receipts, the new permit) into a customer's folder while a request is open,
-- and read files attached to requests.
create policy "documents: staff upload for open requests" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documents' and (select private.is_platform_admin()) and exists (
      select 1 from public.assistance_requests a
      where a.org_id::text = (storage.foldername(name))[1] and a.status not in ('completed','cancelled')));
create policy "documents: staff read request files" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (select private.is_platform_admin()) and (storage.foldername(name))[2] = 'requests');
