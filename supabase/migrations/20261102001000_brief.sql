-- Prices people can say out loud, a bigger season pass, and the changes from the November brief.
--
-- 1) Templates are priced against doing the paper yourself (a typing shop near city hall, printing and an hour or two
--    of your time), not against a lawyer, and kept in round numbers: letters PHP 150, sworn statements PHP 250,
--    Special Power of Attorney PHP 350, Secretary's Certificate PHP 500.
-- 2) The renewal season pass is PHP 600 and now also includes one template of your choice.

-- ================================================================ 1) template prices
update public.doc_templates set price_php = case code
  when 'authorization_letter' then 150
  when 'certified_copy_request' then 150
  when 'landlord_letter' then 150
  when 'accreditation_cover_letter' then 150
  when 'affidavit_of_loss' then 250
  when 'gross_sales_declaration' then 250
  when 'special_power_of_attorney' then 350
  when 'secretary_certificate' then 500
  else price_php end
where code in ('authorization_letter','certified_copy_request','landlord_letter','accreditation_cover_letter',
               'affidavit_of_loss','gross_sales_declaration','special_power_of_attorney','secretary_certificate');
update public.load_products set price_php = 150 where code = 'template';

-- ================================================================ 2) the season pass: PHP 600, with one template
update public.load_products set price_php = 600 where code = 'season_pass';
alter table public.season_passes add column if not exists template_code text check (template_code is null or length(template_code) <= 80);

create or replace function public.unlock_template(p_org uuid, p_code text) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.doc_templates; v_price numeric; v_pass uuid;
begin
  perform private.load_ready();
  perform private.need_org_admin(p_org);
  if private.has_plus(p_org) then raise exception 'Your workspace has Pinoy Permit Plus, so every template is already yours.' using errcode = 'P0001'; end if;
  select * into t from public.doc_templates where code = p_code;
  if t.code is null then raise exception 'Template not found.' using errcode = 'P0002'; end if;
  if exists (select 1 from public.template_unlocks where org_id = p_org and code = p_code) then return; end if;
  -- A season pass in use comes with one template, free.
  select s.id into v_pass from public.season_passes s
   where s.org_id = p_org and private.today_ph() between s.starts_on and s.ends_on and s.template_code is null
   order by s.starts_on desc limit 1 for update;
  if v_pass is not null then
    update public.season_passes set template_code = t.code where id = v_pass;
    insert into public.template_unlocks (org_id, code, price_php) values (p_org, t.code, 0);
    return;
  end if;
  if not private.load_on_sale('template') then raise exception 'Templates can''t be bought one by one right now.' using errcode = 'P0001'; end if;
  v_price := coalesce(t.price_php, private.load_price('template'));
  perform private.load_spend(p_org, v_price, 'template:' || t.code, 'Template: ' || t.title, null, 0);
  insert into public.template_unlocks (org_id, code, price_php) values (p_org, t.code, v_price);
end $$;

do $$ declare v_def text; begin
  v_def := pg_get_functiondef('public.load_summary(uuid)'::regprocedure);
  if v_def not like '%template_used%' then
    execute replace(v_def, '''check_used'', s.check_id is not null,', '''check_used'', s.check_id is not null, ''template_used'', s.template_code is not null,');
  end if;
end $$;

-- ================================================================ 3) the Metro Manila city register (all 17 LGUs)
-- One row per city or municipality: where its official guide is, whether you can file and pay online, who may file
-- for you, how originals and copies are handled, and how sure we are. Only official sources count; anything we
-- could not confirm says so ("needs confirmation"), and the app never treats it as confirmed. Staff edit it in
-- Admin > Cities, and every change is logged.
create table if not exists public.lgus (
  city_key        text primary key check (city_key ~ '^[a-z0-9 ]{2,60}$'),
  name            text not null check (length(btrim(name)) between 2 and 80),
  kind            text not null default 'city' check (kind in ('city','municipality')),
  region          text not null default 'NCR' check (length(region) <= 40),
  status          text not null default 'needs_confirmation' check (status in ('verified','partial','needs_confirmation')),
  source_title    text check (source_title is null or length(source_title) <= 200),
  source_url      text check (source_url is null or (source_url ~ '^https://\S{4,}$' and length(source_url) <= 500)),
  portal_url      text check (portal_url is null or (portal_url ~ '^https://\S{4,}$' and length(portal_url) <= 500)),
  online_filing   text not null default 'unknown' check (online_filing in ('yes','likely','no','unknown')),
  online_payment  text not null default 'unknown' check (online_payment in ('yes','likely','no','unknown')),
  payment_note    text check (payment_note is null or length(payment_note) <= 500),
  release_note    text check (release_note is null or length(release_note) <= 500),
  representative  text check (representative is null or length(representative) <= 800),
  originals       text check (originals is null or length(originals) <= 800),
  deadline_note   text check (deadline_note is null or length(deadline_note) <= 500),
  notes           text check (notes is null or length(notes) <= 1000),
  checked_on      date,
  updated_by      uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at      timestamptz not null default now()
);
alter table public.lgus enable row level security;
drop policy if exists lgus_read on public.lgus;
create policy lgus_read on public.lgus for select to anon, authenticated using (true);
revoke insert, update, delete on public.lgus from anon, authenticated;
grant select on public.lgus to anon, authenticated;

-- Every change to a city row, kept (old and new values, who and why).
create table if not exists public.lgu_changes (
  id         bigint generated always as identity primary key,
  city_key   text not null references public.lgus(city_key) on delete cascade,
  old_row    jsonb,
  new_row    jsonb not null,
  reason     text check (reason is null or length(reason) <= 500),
  changed_by uuid default auth.uid() references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);
alter table public.lgu_changes enable row level security;
drop policy if exists lgu_changes_staff on public.lgu_changes;
create policy lgu_changes_staff on public.lgu_changes for select to authenticated using (private.is_platform_admin());
revoke all on public.lgu_changes from anon;
revoke insert, update, delete on public.lgu_changes from authenticated;
grant select on public.lgu_changes to authenticated;

insert into public.lgus (city_key, name, kind, status, source_title, source_url, portal_url, online_filing, online_payment, payment_note, release_note, representative, originals, deadline_note, notes, checked_on) values
 ('quezon', 'Quezon City', 'city', 'verified', 'How to Renew Business Permit (QC official guide)', 'https://quezoncity.gov.ph/qcitizen-guides/how-to-renew-business-permit/', 'https://qceservices.quezoncity.gov.ph/',
  'yes', 'yes', 'Business tax assessment and payment through QC E-Services (GCash, Maya or online banking), or over the counter at LandBank or the City Treasurer''s Office.',
  'Claim the permit in person or by courier.', 'A representative uses the QC authorization form signed by the owner, with scanned IDs of the owner and the representative.',
  'Current-year City Treasurer official receipt, barangay clearance if already secured, and the previous permit.', 'Renew one year from the issue date of the current permit (not January 20).', null, '2026-10-24'),
 ('manila', 'City of Manila', 'city', 'partial', 'Bureau of Permits Citizen''s Charter', 'https://www.manila.gov.ph/wp-content/uploads/2020/05/6d-Bureau-of-Permits.pdf', null,
  'unknown', 'likely', 'News reports describe paying business tax in the Go Manila app; not yet confirmed on an official page.', null, null, null,
  'Annual renewal; Manila has extended its deadline in past years.', 'Representative rules and the current online channel still need checking for each transaction.', '2026-10-27'),
 ('makati', 'Makati City', 'city', 'needs_confirmation', 'Makati City official portal', 'https://www.makati.gov.ph/', null,
  'likely', 'likely', 'News reports describe online assessment and payment (MAKA-Connect); not yet confirmed on an official page.', null, null, null, null,
  'Current renewal checklist, representative rule, portal and fees must be confirmed before we show them as fact.', '2026-10-27'),
 ('pasig', 'Pasig City', 'city', 'verified', 'BPLD Citizen''s Charter', 'https://assets.pasigcity.gov.ph/storage/attachments/business_permit_and_licensing_department/6618da7fed76c1712904831ENGLISH.pdf', null,
  'unknown', 'unknown', 'Online payment not confirmed on an official page.', null, 'An authorization letter and a government-issued ID with photo and signature for a representative or non-applicant.',
  null, 'Pasig has extended its deadline in past years (to January 31 in 2025).', 'Uses a unified business application form. Confirm the current checklist and channel.', '2026-10-24'),
 ('taguig', 'Taguig City', 'city', 'verified', 'BPLO renewal requirements', 'https://www.taguig.gov.ph/assets/pdfform/citizens_charter/business_permit_and_licensing_office/RENEWAL.pdf', null,
  'likely', 'likely', 'News reports describe renewing and paying online through the Taguig portal; not yet confirmed on an official page.', null,
  'Depends on the business: SPA or letter of authority (sole proprietor), written resolution (one-person corporation), partnership resolution (partnership), Secretary''s Certificate or board resolution (corporation or cooperative). Photocopies of the IDs of the person represented and the representative.',
  'Only originals or officially certified true copies are accepted for the relevant documents.', null, null, '2026-10-24'),
 ('mandaluyong', 'Mandaluyong City', 'city', 'verified', 'BPLO requirements page', 'https://mandaluyong.gov.ph/business-permits-and-licensing-department/', null,
  'unknown', 'unknown', null, null, 'IDs and an authorization letter.',
  'Notarized application form; originals for checking and photocopies for the office file for several documents; current barangay clearance, previous permit and receipt, community tax certificate, financial or tax documents; FSIC before release.',
  null, 'The source page is older: confirm the current version.', '2026-10-24'),
 ('marikina', 'Marikina City', 'city', 'needs_confirmation', 'Marikina City official portal', 'https://www.marikina.gov.ph/', null, 'unknown', 'unknown', null, null, null, null, null,
  'Renewal checklist, representative rule, portal, fees and original/copy handling must be confirmed.', '2026-10-24'),
 ('pasay', 'Pasay City', 'city', 'verified', 'How do I renew my business permit (Pasay BPLO)', 'https://www.pasay.gov.ph/Resources/BPLO/HOW%20DO%20I%20RENEW%20MY%20BUSINESS%20PERMIT.pdf', null,
  'yes', 'yes', 'Apply online through eODB Business; the statement of account is sent online for payment.', 'Claim the permit at the BPLO or by courier (fees may apply).',
  'Signed authorization letter (scanned), the owner''s government ID (scanned), the previous permit and the CGL insurance (scanned).', null, null, null, '2026-10-24'),
 ('paranaque', 'Parañaque City', 'city', 'needs_confirmation', 'Parañaque City official portal', 'https://paranaquecity.gov.ph/', null, 'unknown', 'unknown', null, null, null, null, null,
  'Renewal checklist, representative rule, portal, fees and original/copy handling must be confirmed.', '2026-10-24'),
 ('las pinas', 'Las Piñas City', 'city', 'partial', 'Frequently asked questions (Las Piñas)', 'https://laspinascity.gov.ph/frequently-asked-questions', null, 'unknown', 'unknown', null, null, null,
  'Gross sales or receipts, financial statements, VAT or non-VAT documents, last year''s receipt and Mayor''s Permit, barangay clearance, homeowners'' clearance; more may apply.', null,
  'Representative rules and online channels still need confirmation.', '2026-10-24'),
 ('caloocan', 'Caloocan City', 'city', 'partial', 'Caloocan web service portal', 'https://online.caloocancity.gov.ph/', 'https://online.caloocancity.gov.ph/', 'yes', 'unknown', null, null,
  'The new-business flow asks for an SPA or Secretary''s Certificate for a representative; renewals still need checking.', null, null, 'Do not apply the new-business rule to renewals without checking.', '2026-10-24'),
 ('malabon', 'Malabon City', 'city', 'verified', 'Business permit (Malabon official)', 'https://malabon.gov.ph/business-permit/', 'https://online.malabon.gov.ph/',
  'yes', 'yes', 'Register at online.malabon.gov.ph, upload requirements, compute the tax, then pay through LandBank online or at the cashier.', 'Print the permit, or claim the original plate and sticker at the BPLO.',
  null, null, null, 'Representative rules and originals/copies still need confirmation.', '2026-10-24'),
 ('navotas', 'Navotas City', 'city', 'partial', 'Downloadable forms (Navotas)', 'https://www.navotas.gov.ph/Home/DownloadableForms', null, 'unknown', 'unknown', null, null,
  'Separate authorization forms for corporations and for sole proprietorships.', null, null, 'Check each current form for ID, original/copy rules, portal and fees.', '2026-10-24'),
 ('valenzuela', 'Valenzuela City', 'city', 'needs_confirmation', 'Valenzuela City official portal', 'https://valenzuela.gov.ph/', null, 'unknown', 'unknown', null, null, null, null, null,
  'Renewal checklist, representative rule, e-services, fees and original/copy handling must be confirmed.', '2026-10-24'),
 ('san juan', 'San Juan City', 'city', 'needs_confirmation', 'San Juan City official portal', 'https://www.sanjuancity.gov.ph/', null, 'unknown', 'unknown', null, null, null, null, null,
  'Renewal checklist, representative rule, online channels, fees and original/copy handling must be confirmed.', '2026-10-24'),
 ('muntinlupa', 'Muntinlupa City', 'city', 'verified', 'Business permit application (Muntinlupa)', 'https://muntinlupacity.gov.ph/business-services/business-permit-application/', null, 'unknown', 'unknown', null, null,
  'Authorization letter with photocopies of the valid IDs of the owner and the representative. Their forms include an "Undertaking - For SPA".',
  'More depends on the area and kind of business: proof of property, zoning or building endorsements, FSIC, sanitary permit, HOA or building administration, franchise.', null,
  'Muntinlupa has extended its deadline in past years.', '2026-10-24'),
 ('pateros', 'Pateros', 'municipality', 'needs_confirmation', null, null, null, 'unknown', 'unknown', null, null, null, null, null,
  'We have not confirmed the official municipal website yet, so no link is shown.', '2026-10-24')
on conflict (city_key) do nothing;

-- Staff update a city row (only the fields they send), with a reason; the old row is kept.
create or replace function public.lgu_update(p_key text, p_patch jsonb, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_old public.lgus; v_new public.lgus;
begin
  if not private.is_platform_admin() then raise exception 'Only Pinoy Permit staff can change the city register.' using errcode = '42501'; end if;
  select * into v_old from public.lgus where city_key = p_key for update;
  if v_old.city_key is null then raise exception 'City not found.' using errcode = 'P0002'; end if;
  v_new := jsonb_populate_record(v_old, p_patch - 'city_key' - 'updated_by' - 'updated_at');
  update public.lgus set name = v_new.name, kind = v_new.kind, status = v_new.status, source_title = nullif(btrim(v_new.source_title), ''),
    source_url = nullif(btrim(v_new.source_url), ''), portal_url = nullif(btrim(v_new.portal_url), ''), online_filing = v_new.online_filing,
    online_payment = v_new.online_payment, payment_note = nullif(btrim(v_new.payment_note), ''), release_note = nullif(btrim(v_new.release_note), ''),
    representative = nullif(btrim(v_new.representative), ''), originals = nullif(btrim(v_new.originals), ''), deadline_note = nullif(btrim(v_new.deadline_note), ''),
    notes = nullif(btrim(v_new.notes), ''), checked_on = v_new.checked_on, updated_by = auth.uid(), updated_at = now()
  where city_key = p_key;
  insert into public.lgu_changes (city_key, old_row, new_row, reason)
  values (p_key, to_jsonb(v_old), (select to_jsonb(l) from public.lgus l where l.city_key = p_key), nullif(btrim(p_reason), ''));
end $$;
revoke all on function public.lgu_update(text, jsonb, text) from public, anon;
grant execute on function public.lgu_update(text, jsonb, text) to authenticated;

-- Can Pinoy Permit pay this permit's bill online? Only a Mayor's Permit in a city whose online payment is confirmed
-- on an official page. Everything else needs someone at a counter, which we don't offer yet.
create or replace function private.bill_online(p_req uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select r.type_code = 'mayors_permit' and exists (select 1 from public.lgus g where g.online_payment = 'yes'
      and g.city_key = private.city_key(coalesce(nullif(l.city, ''), ml.city)))
    from public.requirements r
    left join public.business_locations l on l.id = r.location_id and l.deleted_at is null
    left join lateral (select m.city from public.business_locations m where m.business_id = r.business_id and m.is_main and m.deleted_at is null limit 1) ml on true
    where r.id = p_req), false)
$$;

-- Pinoy Permit pays a bill only where the office takes payment online (confirmed on an official page). Bills that
-- need someone at a counter wait for the in-person team we're building.
do $$ declare v_def text; begin
  v_def := pg_get_functiondef('public.bill_add(uuid,uuid,text,text,numeric,date,text,text,text)'::regprocedure);
  if v_def not like '%bill_online%' then
    v_def := replace(v_def, '  if length(btrim(coalesce(p_office, ''''))) not between 2 and 160 then',
      '  if p_mode = ''permitpal'' and not private.bill_online(r.id) then
    raise exception ''We can only pay this bill where the office takes payment online. In-person payments are coming soon; for now, pay this one at the office.'' using errcode = ''P0001'';
  end if;
  if length(btrim(coalesce(p_office, ''''))) not between 2 and 160 then');
    execute v_def;
  end if;
end $$;

-- ================================================================ 4) your own to-dos on the Home calendar
-- Tap an empty day on the Home calendar to add something you want to keep track of (pick up the CTC, call the
-- landlord, pay the SSS). Anyone who can edit the workspace can add, tick off or remove them.
create table if not exists public.org_tasks (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  title       text not null check (length(btrim(title)) between 1 and 160),
  note        text check (note is null or length(note) <= 1000),
  due_on      date not null,
  done_at     timestamptz,
  done_by     uuid references auth.users(id) on delete set null,
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists org_tasks_org_due on public.org_tasks (org_id, due_on);
alter table public.org_tasks enable row level security;
drop policy if exists org_tasks_read on public.org_tasks;
create policy org_tasks_read on public.org_tasks for select to authenticated using (org_id in (select private.my_org_ids()));
revoke all on public.org_tasks from anon;
revoke insert, update, delete on public.org_tasks from authenticated;
grant select on public.org_tasks to authenticated;

create or replace function public.task_save(p_org uuid, p_id uuid, p_title text, p_due date, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_org is null or p_org not in (select private.my_writable_org_ids()) then raise exception 'Workspace not found.' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_title, ''))) not between 1 and 160 then raise exception 'What do you want to remember? (up to 160 characters)' using errcode = '22023'; end if;
  if p_due is null or p_due < private.today_ph() - 3650 or p_due > private.today_ph() + 3650 then raise exception 'Pick a date.' using errcode = '22023'; end if;
  if length(coalesce(p_note, '')) > 1000 then raise exception 'Please keep the note under 1,000 characters.' using errcode = '22023'; end if;
  if p_id is null then
    if (select count(*) from public.org_tasks where org_id = p_org and done_at is null) >= 500 then
      raise exception 'You have 500 open to-dos. Tick some off first.' using errcode = 'P0001';
    end if;
    insert into public.org_tasks (org_id, title, note, due_on) values (p_org, btrim(p_title), nullif(btrim(p_note), ''), p_due) returning id into v_id;
  else
    update public.org_tasks set title = btrim(p_title), note = nullif(btrim(p_note), ''), due_on = p_due, updated_at = now()
     where id = p_id and org_id = p_org returning id into v_id;
    if v_id is null then raise exception 'To-do not found.' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;
create or replace function public.task_done(p_id uuid, p_done boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.org_tasks set done_at = case when p_done then now() end, done_by = case when p_done then auth.uid() end, updated_at = now()
   where id = p_id and org_id in (select private.my_writable_org_ids());
  if not found then raise exception 'To-do not found.' using errcode = 'P0002'; end if;
end $$;
create or replace function public.task_delete(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.org_tasks where id = p_id and org_id in (select private.my_writable_org_ids());
  if not found then raise exception 'To-do not found.' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.task_save(uuid, uuid, text, date, text), public.task_done(uuid, boolean), public.task_delete(uuid) from public, anon;
grant execute on function public.task_save(uuid, uuid, text, date, text), public.task_done(uuid, boolean), public.task_delete(uuid) to authenticated;

-- ================================================================ 5) a calendar link for Google Calendar (or any calendar app)
-- A private address per workspace. Paste it into Google Calendar ("From URL") and every permit deadline and to-do
-- shows up there and stays up to date. The calendar-feed function reads it; anyone with the link can see the
-- dates, so it can be replaced (the old link stops working) at any time.
create table if not exists public.calendar_feeds (
  org_id     uuid primary key references public.orgs(id) on delete cascade,
  token      text not null unique check (token ~ '^[A-Za-z0-9_-]{32,64}$'),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.calendar_feeds enable row level security;
revoke all on public.calendar_feeds from anon, authenticated;

create or replace function public.calendar_feed_token(p_org uuid, p_new boolean default false) returns text
language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  if p_org is null or p_org not in (select private.my_writable_org_ids()) then raise exception 'Workspace not found.' using errcode = '42501'; end if;
  select token into v from public.calendar_feeds where org_id = p_org;
  if v is null or p_new then
    v := translate(encode(extensions.gen_random_bytes(30), 'base64'), '+/=', '-_');
    insert into public.calendar_feeds (org_id, token) values (p_org, v)
    on conflict (org_id) do update set token = excluded.token, created_by = auth.uid(), created_at = now();
  end if;
  return v;
end $$;
revoke all on function public.calendar_feed_token(uuid, boolean) from public, anon;
grant execute on function public.calendar_feed_token(uuid, boolean) to authenticated;

-- What the calendar-feed function serves (it calls this with the service key; nobody else can).
create or replace function public.calendar_feed_events(p_token text) returns table (uid text, day date, title text, detail text)
language sql stable security definer set search_path = '' as $$
  with f as (select org_id from public.calendar_feeds where token = p_token and length(p_token) >= 32)
  select coalesce(c.id, r.id)::text || '@permitpal', c.expires_on, 'Expires: ' || coalesce(private.requirement_label(r.id), r.name),
         coalesce('Ref ' || nullif(c.reference_no, '') || '. ', '') || 'Open Pinoy Permit to renew.'
  from f join public.requirements r on r.org_id = f.org_id and r.deleted_at is null and r.expires
  join lateral (select x.id, x.expires_on, x.reference_no from public.requirement_cycles x where x.requirement_id = r.id and x.deleted_at is null order by x.seq desc limit 1) c on c.expires_on is not null
  union all
  select t.id::text || '@permitpal-task', t.due_on, case when t.done_at is null then 'To-do: ' else 'Done: ' end || t.title, coalesce(t.note, '')
  from f join public.org_tasks t on t.org_id = f.org_id
$$;
revoke all on function public.calendar_feed_events(text) from public, anon, authenticated;

-- ================================================================ 6) plans: tracking and planning software, by how much you track
-- Software plans are for tracking and planning only; hands-on help is a separate, separately priced service.
--   Free        PHP 0      1 business + 1 vehicle (2 records), 1 user, 3 files per record
--   Plus        PHP 149/mo up to 5 records, any mix, 1 user, 20 files per record (the Plus add-on, now also more room)
--   Core        PHP 799/mo up to 15 records, 3 users
--   Multi-Vehicle PHP 1,499/mo up to 30 vehicles (+3 business records), 3 users
--   Fleet       PHP 2,999/mo up to 75 vehicles (+3 business records), 5 users
--   Fleet Pro   PHP 4,999/mo up to 150 vehicles (+3 business records), 10 users
--   Enterprise  151+ vehicles, quoted
-- Small property and Mall & property stay as they are. The Accounting firm plan is no longer sold (Core covers
-- it); workspaces already on it keep it. Nothing is ever deleted or hidden when a limit is reached: what you
-- already track stays, you just can't add more until you move up.
create table if not exists public.plan_limits (
  code             text primary key check (code ~ '^[a-z_]{2,30}$'),
  name             text not null check (length(name) <= 60),
  record_limit     int check (record_limit is null or record_limit >= 0),    -- businesses + vehicles together; null = no limit
  vehicle_limit    int check (vehicle_limit is null or vehicle_limit >= 0),
  business_limit   int check (business_limit is null or business_limit >= 0),
  seat_limit       int check (seat_limit is null or seat_limit >= 1),        -- people who can sign in, owner included
  docs_per_record  int check (docs_per_record is null or docs_per_record >= 0),
  vehicle_from     int check (vehicle_from is null or vehicle_from >= 0),    -- the plan's range, for showing it
  updated_at       timestamptz not null default now()
);
alter table public.plan_limits enable row level security;
drop policy if exists plan_limits_read on public.plan_limits;
create policy plan_limits_read on public.plan_limits for select to anon, authenticated using (true);
revoke insert, update, delete on public.plan_limits from anon, authenticated;
grant select on public.plan_limits to anon, authenticated;
insert into public.plan_limits (code, name, record_limit, vehicle_limit, business_limit, seat_limit, docs_per_record, vehicle_from) values
  ('free', 'Free', 2, 1, 1, 1, 3, null),
  ('plus', 'Plus', 5, null, null, 1, 20, null),
  ('core', 'Core', 15, null, null, 3, 20, null),
  ('multi', 'Multi-Vehicle', null, 30, 3, 3, 20, 16),
  ('fleet', 'Fleet', null, 75, 3, 5, 20, 31),
  ('fleet_pro', 'Fleet Pro', null, 150, 3, 10, 20, 76),
  ('enterprise', 'Enterprise', null, null, null, null, null, 151),
  ('property_s', 'Small property', null, null, null, null, null, null),
  ('property', 'Mall & property', null, null, null, null, null, null),
  ('firm', 'Accounting firm', null, null, null, null, null, null),
  ('head_office', 'Head office', null, null, null, null, null, null)
on conflict (code) do nothing;

insert into public.plans (id, name, price_php_monthly, max_members, max_locations_per_business, paid_channels, features, sort, available) values
  ('core', 'Core', 799, 3, null, true, array['Up to 15 businesses and vehicles together', 'Up to 3 users', 'Pinoy Permit Plus included', 'Text message reminders', 'Everything in Free'], 5, true),
  ('multi', 'Multi-Vehicle', 1499, 3, null, true, array['16 to 30 vehicles', 'Up to 3 users', 'Fleet board', 'Everything in Core'], 6, true),
  ('fleet_pro', 'Fleet Pro', 4999, 10, null, true, array['76 to 150 vehicles', 'Up to 10 users', 'Fleet-wide reports and renewal planning', 'Everything in Fleet'], 8, true),
  ('enterprise', 'Enterprise', null, null, null, true, array['151 or more vehicles', 'Quoted for your fleet'], 9, false)
on conflict (id) do nothing;
update public.plans set price_php_monthly = 2999, paid_channels = true, sort = 7,
  features = array['31 to 75 vehicles', 'Up to 5 users', 'Fleet board, filters and spreadsheet import', 'Everything in Multi-Vehicle']
where id = 'fleet';
-- The Accounting firm plan stays on sale only for firm workspaces that already have it (the website doesn't list it).

-- Plus is PHP 149 a month (PHP 1,490 a year).
create or replace function private.addon_price(p_kind text, p_people int, p_billing text) returns numeric
language sql immutable set search_path = '' as $$
  select (case p_kind when 'plus' then 149 when 'brand' then 1000 else private.staff_monthly(p_people) end) * (case p_billing when 'yearly' then 10 else 1 end)
$$;

-- Which plans come with Plus and team tools.
create or replace function private.plan_includes_plus(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.orgs o where o.id = p_org and o.deleted_at is null and (
    private.effective_plan_id(o.id) in ('core','multi','fleet','fleet_pro','enterprise')
    or (o.kind <> 'business' and private.effective_plan_id(o.id) in ('firm','head_office','property','property_s'))))
$$;
create or replace function private.has_plus(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.orgs o where o.id = p_org and o.deleted_at is null and (
      exists (select 1 from public.addons a where a.org_id = o.id and a.kind = 'plus' and a.paid_through >= private.today_ph())
      or (o.kind <> 'business' and o.trial_ends_at is not null and o.trial_ends_at > now())
      or private.plan_includes_plus(o.id)))
$$;
create or replace function private.has_team_tools(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.is_platform_admin(), false) or exists (
    select 1 from public.orgs o where o.id = p_org and o.deleted_at is null and o.kind <> 'business' and (
      (o.trial_ends_at is not null and o.trial_ends_at > now())
      or private.effective_plan_id(o.id) in ('fleet','multi','fleet_pro','enterprise','firm','head_office','property','property_s')))
$$;
do $$ declare f text; v_def text; begin
  foreach f in array array['private.addon_check_args(uuid,text,integer,text)', 'private.plus_daily()'] loop
    v_def := pg_get_functiondef(f::regprocedure);
    v_def := replace(v_def, 'o.kind <> ''business'' and private.effective_plan_id(o.id) in (''fleet'',''firm'',''head_office'',''property'',''property_s'')', 'private.plan_includes_plus(o.id)');
    v_def := replace(v_def, 'og.kind <> ''business'' and private.effective_plan_id(og.id) in (''fleet'',''firm'',''head_office'',''property'',''property_s'')', 'private.plan_includes_plus(og.id)');
    execute v_def;
  end loop;
end $$;

-- The limits that apply to a workspace now: its paid plan; a team trial gets the biggest plan of its kind;
-- otherwise Plus (if it has the add-on) or Free.
create or replace function private.limits_code(p_org uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when private.effective_plan_id(o.id) in ('core','multi','fleet','fleet_pro','enterprise','property_s','property','firm','head_office') then private.effective_plan_id(o.id)
    when o.kind <> 'business' and o.trial_ends_at is not null and o.trial_ends_at > now() then
      case o.kind when 'fleet' then 'fleet_pro' when 'property' then 'property' when 'firm' then 'firm' else 'core' end
    when exists (select 1 from public.addons a where a.org_id = o.id and a.kind = 'plus' and a.paid_through >= private.today_ph()) then 'plus'
    else 'free' end
  from public.orgs o where o.id = p_org
$$;

-- What the workspace uses against its plan (for "14 of 15 used" and the upgrade prompts).
create or replace function public.plan_usage(p_org uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when p_org in (select private.my_org_ids()) then jsonb_build_object(
    'code', l.code, 'name', l.name,
    'businesses', (select count(*) from public.businesses b where b.org_id = p_org and b.deleted_at is null),
    'vehicles', (select count(*) from public.vehicles v where v.org_id = p_org and v.deleted_at is null),
    'seats', (select count(*) from public.org_members m where m.org_id = p_org)
           + (select count(*) from public.org_invites i where i.org_id = p_org and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()),
    'record_limit', l.record_limit, 'vehicle_limit', l.vehicle_limit, 'business_limit', l.business_limit,
    'seat_limit', l.seat_limit, 'docs_per_record', l.docs_per_record) end
  from public.plan_limits l where l.code = private.limits_code(p_org)
$$;
revoke all on function public.plan_usage(uuid) from public, anon;
grant execute on function public.plan_usage(uuid) to authenticated;

-- Adding (or bringing back) a business or vehicle past the plan's room is refused, with what to do instead.
create or replace function private.check_record_room() returns trigger
language plpgsql security definer set search_path = '' as $$
declare l public.plan_limits; v_b int; v_v int; v_what text := case tg_table_name when 'vehicles' then 'vehicle' else 'business' end;
begin
  if new.deleted_at is not null then return new; end if;
  if tg_op = 'UPDATE' and old.deleted_at is null then return new; end if;  -- an edit, not a new record
  if coalesce(current_setting('pp.skip_limits', true), 'off') = 'on' then return new; end if;
  select * into l from public.plan_limits where code = private.limits_code(new.org_id);
  if l.code is null then return new; end if;
  select count(*) into v_b from public.businesses where org_id = new.org_id and deleted_at is null and id <> new.id;
  select count(*) into v_v from public.vehicles where org_id = new.org_id and deleted_at is null and id <> new.id;
  if v_what = 'business' and l.business_limit is not null and v_b >= l.business_limit then
    raise exception 'Your % plan tracks up to % %. To add another, move up to a bigger plan in Settings > Plan.', l.name, l.business_limit,
      case when l.business_limit = 1 then 'business' else 'businesses' end using errcode = 'P0001', hint = 'plan_limit';
  end if;
  if v_what = 'vehicle' and l.vehicle_limit is not null and v_v >= l.vehicle_limit then
    raise exception 'Your % plan tracks up to % %. To add another, move up to a bigger plan in Settings > Plan.', l.name, l.vehicle_limit,
      case when l.vehicle_limit = 1 then 'vehicle' else 'vehicles' end using errcode = 'P0001', hint = 'plan_limit';
  end if;
  if l.record_limit is not null and v_b + v_v >= l.record_limit then
    raise exception 'Your % plan tracks up to % businesses and vehicles together, and you have %. To add another, move up to a bigger plan in Settings > Plan.',
      l.name, l.record_limit, v_b + v_v using errcode = 'P0001', hint = 'plan_limit';
  end if;
  return new;
end $$;
drop trigger if exists businesses_room on public.businesses;
create trigger businesses_room before insert or update of deleted_at on public.businesses for each row execute function private.check_record_room();
drop trigger if exists vehicles_room on public.vehicles;
create trigger vehicles_room before insert or update of deleted_at on public.vehicles for each row execute function private.check_record_room();

-- Inviting someone past the plan's number of users is refused (people already in the workspace stay).
create or replace function private.check_seat_room() returns trigger
language plpgsql security definer set search_path = '' as $$
declare l public.plan_limits; v_n int;
begin
  if coalesce(current_setting('pp.skip_limits', true), 'off') = 'on' then return new; end if;
  select * into l from public.plan_limits where code = private.limits_code(new.org_id);
  if l.seat_limit is null then return new; end if;
  -- people in the workspace plus invitations still open
  select (select count(*) from public.org_members m where m.org_id = new.org_id)
       + (select count(*) from public.org_invites i where i.org_id = new.org_id and i.accepted_at is null and i.revoked_at is null and i.expires_at > now())
    into v_n;
  if v_n >= l.seat_limit then
    raise exception 'Your % plan is for % %. To add someone, move up to a bigger plan in Settings > Plan.', l.name, l.seat_limit,
      case when l.seat_limit = 1 then 'person (just you)' else 'people' end using errcode = 'P0001', hint = 'plan_limit';
  end if;
  return new;
end $$;
drop trigger if exists org_invites_room on public.org_invites;
create trigger org_invites_room before insert on public.org_invites for each row execute function private.check_seat_room();

-- Files per business or vehicle (Free: 3; paid plans: 20). Files already uploaded stay.
create or replace function private.check_doc_room() returns trigger
language plpgsql security definer set search_path = '' as $$
declare l public.plan_limits; r public.requirements; v_n int;
begin
  if coalesce(current_setting('pp.skip_limits', true), 'off') = 'on' then return new; end if;
  select * into l from public.plan_limits where code = private.limits_code(new.org_id);
  if l.docs_per_record is null then return new; end if;
  select * into r from public.requirements where id = new.requirement_id;
  if r.subject not in ('business','vehicle') then return new; end if;
  select count(*) into v_n from public.documents d join public.requirements q on q.id = d.requirement_id
   where d.org_id = new.org_id and d.deleted_at is null
     and ((r.subject = 'business' and q.business_id = r.business_id) or (r.subject = 'vehicle' and q.vehicle_id = r.vehicle_id));
  if v_n >= l.docs_per_record then
    raise exception 'Your % plan keeps up to % files for each business or vehicle. Delete an old file, or move up to a bigger plan in Settings > Plan.',
      l.name, l.docs_per_record using errcode = 'P0001', hint = 'plan_limit';
  end if;
  return new;
end $$;
drop trigger if exists documents_room on public.documents;
create trigger documents_room before insert on public.documents for each row execute function private.check_doc_room();

-- Staff change a plan's limits (Admin > Plans), without a code change.
create or replace function public.admin_plan_limit(p_code text, p_patch jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.plan_limits;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select * into v from public.plan_limits where code = p_code for update;
  if v.code is null then raise exception 'Plan not found.' using errcode = 'P0002'; end if;
  v := jsonb_populate_record(v, p_patch - 'code' - 'updated_at');
  update public.plan_limits set name = v.name, record_limit = v.record_limit, vehicle_limit = v.vehicle_limit, business_limit = v.business_limit,
    seat_limit = v.seat_limit, docs_per_record = v.docs_per_record, vehicle_from = v.vehicle_from, updated_at = now() where code = p_code;
end $$;
revoke all on function public.admin_plan_limit(text, jsonb) from public, anon;
grant execute on function public.admin_plan_limit(text, jsonb) to authenticated;

-- ================================================================ 7) where each checklist comes from, and copies vs originals
-- Every permit type shows its official source, when it was checked and how sure we are. LTO renewal items say two
-- separate things: what you send Pinoy Permit (a scan or photo, for checking only) and what the agency itself needs
-- (an original, a copy, or an electronic record sent by the issuer). An upload is never treated as the original.
alter table public.requirement_types
  add column if not exists source_url   text check (source_url is null or (source_url ~ '^https://\S{4,}$' and length(source_url) <= 500)),
  add column if not exists source_title text check (source_title is null or length(source_title) <= 200),
  add column if not exists checked_on   date,
  add column if not exists verify       text not null default 'needs_confirmation' check (verify in ('verified','partial','needs_confirmation'));

-- Item labels (in the checklist JSON): "send" = what to send Pinoy Permit; "agency" = what the office needs.
--   digital: a digital copy for pre-check · photocopy · original_present · original_submit · ctc (certified true copy)
--   issuer: sent electronically by the issuer · na: not applicable · unverified: confirm first
update public.requirement_types set
  source_url = 'https://www.ltoncr.com/renewal-of-motor-vehicle-mv-registration/', source_title = 'LTO NCR: Renewal of Motor Vehicle Registration',
  checked_on = '2026-10-24', verify = 'partial',
  checklist = $j$[
    {"k":"ctpl","t":"CTPL insurance for the coming year","d":"The insurer sends the certificate of cover to LTO electronically. A scan you send us is only for checking.","dep":"ctpl","send":"digital","agency":"issuer"},
    {"k":"emission","t":"Passed emission test (Certificate of Emission Compliance)","d":"At an LTO-accredited emission testing center. The LTO NCR list asks for the original certificate, where it applies to your vehicle.","dep":"emission_test","send":"digital","agency":"original_submit"},
    {"k":"inspect","t":"Motor Vehicle Inspection Report (MVIR), if your vehicle needs it","d":"The LTO NCR list asks for the original, duly accomplished MVIR.","dep":"mvir","send":"digital","agency":"original_submit"},
    {"k":"orcr","t":"Current OR/CR","d":"Whether the office needs to see the original depends on the office and the transaction. Never mail your original to anyone unverified.","send":"digital","agency":"unverified"},
    {"k":"id","t":"Owner's ID, and an authorization if someone else files","d":"The kind of authorization depends on the transaction and the office: check before you go.","send":"digital","agency":"unverified"},
    {"k":"pay","t":"Pay the registration fee","d":"Online in LTMS works when your last renewal was also done in LTMS. Pay LTO only through its official channels.","u":"https://portal.lto.gov.ph/"}
  ]$j$::jsonb
where code = 'lto_registration';
update public.requirement_types set verify = 'partial', source_title = 'Depends on your city: see its entry in the Metro Manila register'
where code in ('mayors_permit', 'barangay_clearance');
update public.requirement_types set source_url = 'https://lto.gov.ph/', source_title = 'LTO official website', checked_on = '2026-10-24', verify = 'needs_confirmation'
where code in ('ctpl', 'emission_test', 'mvir') and source_url is null;

insert into private.features (name) values ('lgus') on conflict do nothing;
