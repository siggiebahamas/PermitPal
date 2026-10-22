-- PermitPal renewal packets and city deadlines: asks only what's missing for the business permit renewal and
-- builds the packet; lets PermitPal staff announce a city's deadline extension so every affected business is
-- told and can move its date in one tap. Also raises the fee for paying a city bill through PermitPal to PHP 199.
-- All or nothing: if anything fails, nothing is changed.
--
-- Order matters: run 2026-10-27-clock-and-bills.sql first, then this file, once.
begin;

do $$ declare v_prev boolean := false; v_done boolean := false; begin
  if to_regclass('private.features') is not null then
    execute $q$select exists (select 1 from private.features where name = 'clock'), exists (select 1 from private.features where name = 'packet')$q$ into v_prev, v_done;
  end if;
  if not v_prev then raise exception 'Run supabase/manual/2026-10-27-clock-and-bills.sql first, then run this file. Nothing was changed.'; end if;
  if v_done then raise exception 'This file was already run. Nothing was changed.'; end if;
end $$;

-- ======================================================================== 20261028001000_packets_city_dates.sql
-- PermitPal: renewal packets, city deadlines, and the PHP 199 bill fee.
-- 1) Renewal packet. The business permit renewal asks for the same things every year. PermitPal fills in what
--    it already knows (the business, the branch, last year's permit, the files on record) and asks only what is
--    missing or new: last year's sales, how many people work there, and whether anything changed. The answers
--    are kept per permit per year, so next year starts from them. The app puts the packet together (checklist,
--    application details in the order of the Unified Business Application Form, sworn declaration of sales,
--    authorization letter, copies of the files) for printing or download.
-- 2) City deadlines. Most cities want the business permit renewed by January 20; Quezon City counts one year
--    from the permit's issue date. Cities often extend the deadline late, by ordinance or a treasurer's notice.
--    PermitPal staff type the extension once (city, new date, the notice or news report), and every workspace
--    with a business permit in that city still due before the new date is told. One tap moves the permit's
--    date. If staff withdraw an extension typed by mistake, the permits moved to it go back to their old date.
-- 3) Paying a city bill through PermitPal now costs PHP 199 (it was PHP 99).

-- ================================================================ renewal packets
create table if not exists public.renewal_packets (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id) on delete cascade,
  requirement_id uuid not null references public.requirements(id) on delete cascade,
  permit_year    int not null check (permit_year between 2020 and 2100),
  answers        jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object' and pg_column_size(answers) <= 16000),
  ready_at       timestamptz,    -- every question answered
  created_by     uuid default auth.uid() references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (requirement_id, permit_year)
);
create index if not exists renewal_packets_org on public.renewal_packets (org_id);
drop trigger if exists renewal_packets_touch on public.renewal_packets;
create trigger renewal_packets_touch before update on public.renewal_packets for each row execute function private.touch_updated_at();
alter table public.renewal_packets enable row level security;
drop policy if exists renewal_packets_read on public.renewal_packets;
create policy renewal_packets_read on public.renewal_packets for select to authenticated using (org_id in (select private.my_org_ids()));
revoke all on public.renewal_packets from anon;
revoke insert, update, delete on public.renewal_packets from authenticated;
grant select on public.renewal_packets to authenticated;

-- Only the answers the packet asks for are kept, each checked. Unknown keys are dropped; empty text is dropped.
create or replace function private.packet_clean(p jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare k text; v jsonb; spec text; label text; v_out jsonb := '{}'::jsonb; s text; n numeric;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'The answers could not be read.' using errcode = '22023'; end if;
  for k, v in select e.key, e.value from jsonb_each(p) e loop
    select x.spec, x.label into spec, label from (values
      ('sales', 'num', 'Sales'), ('employees', 'int', 'People working there'), ('employees_local', 'int', 'People who live in the city'),
      ('area_sqm', 'num', 'Floor area'), ('rent', 'num', 'Monthly rent'),
      ('changed', 'enum:no,yes', 'Anything changed'), ('place', 'enum:owned,rented', 'Owned or rented'),
      ('pay_mode', 'enum:annual,semi,quarterly', 'How you pay the business tax'),
      ('changes', 'text:500', 'What changed'), ('owner_name', 'text:120', 'Owner''s name'), ('owner_title', 'text:80', 'Position'),
      ('owner_address', 'text:300', 'Owner''s address'), ('line', 'text:160', 'Line of business'), ('lessor', 'text:160', 'Landlord'),
      ('phone', 'text:30', 'Phone'), ('reg_no', 'text:60', 'DTI, SEC or CDA number')
    ) x(key, spec, label) where x.key = k;
    if spec is null or v = 'null'::jsonb then continue; end if;
    if spec in ('num', 'int') then
      if jsonb_typeof(v) <> 'number' then raise exception '%: enter a number.', label using errcode = '22023'; end if;
      n := (v #>> '{}')::numeric;
      if n < 0 or n > 999999999999 or (spec = 'int' and (n <> trunc(n) or n > 1000000)) then
        raise exception '%: that number doesn''t look right.', label using errcode = '22023';
      end if;
      v_out := v_out || jsonb_build_object(k, n);
    elsif spec like 'enum:%' then
      if jsonb_typeof(v) <> 'string' or not ((v #>> '{}') = any (string_to_array(substr(spec, 6), ','))) then
        raise exception '%: choose one of the options.', label using errcode = '22023';
      end if;
      v_out := v_out || jsonb_build_object(k, v #>> '{}');
    else
      if jsonb_typeof(v) <> 'string' then raise exception '%: enter text.', label using errcode = '22023'; end if;
      s := btrim(v #>> '{}');
      if length(s) > substr(spec, 6)::int then raise exception '%: keep it under % characters.', label, substr(spec, 6) using errcode = '22023'; end if;
      if s <> '' then v_out := v_out || jsonb_build_object(k, s); end if;
    end if;
  end loop;
  return v_out;
end $$;

-- Saves the answers so far (the whole set each time). p_ready = every question answered.
create or replace function public.packet_save(p_requirement uuid, p_year int, p_answers jsonb, p_ready boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r public.requirements; v jsonb; v_id uuid; v_was timestamptz; v_y int := extract(year from private.today_ph())::int;
begin
  r := private.req_for_edit(p_requirement);
  if r.type_code is distinct from 'mayors_permit' then raise exception 'Renewal packets are for business permits.' using errcode = 'P0001'; end if;
  if p_year is null or p_year not between v_y - 1 and v_y + 2 then raise exception 'Choose the permit year.' using errcode = '22023'; end if;
  v := private.packet_clean(p_answers);
  if coalesce(p_ready, false) and not (v ? 'sales') then raise exception 'Add last year''s sales first.' using errcode = '22023'; end if;
  select id, ready_at into v_id, v_was from public.renewal_packets where requirement_id = r.id and permit_year = p_year for update;
  if v_id is null then
    insert into public.renewal_packets (org_id, requirement_id, permit_year, answers, ready_at)
    values (r.org_id, r.id, p_year, v, case when p_ready then now() end) returning id into v_id;
  else
    update public.renewal_packets set answers = v, ready_at = case when p_ready then coalesce(ready_at, now()) else ready_at end where id = v_id;
  end if;
  if coalesce(p_ready, false) and v_was is null then
    perform private.req_activity(r.id, 'renewal_packet', v_id, 'update', 'Renewal packet for ' || p_year || ' is ready');
  end if;
  return v_id;
end $$;

-- ================================================================ city deadlines
-- One spelling per city: lower case, no accents, no "City of" or "City", first part before a comma.
-- "Quezon City", "QC" and "Q.C." are all 'quezon'; "Las Piñas City" is 'las pinas'.
create or replace function private.city_key(p text) returns text
language sql immutable set search_path = '' as $$
  select case k when 'qc' then 'quezon' when 'q c' then 'quezon' else k end
  from (select btrim(regexp_replace(regexp_replace(btrim(regexp_replace(
      translate(lower(split_part(coalesce(p, ''), ',', 1)), 'ñáàâäéèêëíìîïóòôöúùûü', 'naaaaeeeeiiiioooouuuu'),
      '[^a-z0-9]+', ' ', 'g')), '^(the )?(city|municipality) of ', ''), ' city$', '')) as k) x
$$;

-- How a city sets its renewal date when it isn't January 20. Quezon City: one year from the issue date.
create table if not exists public.city_rules (
  city_key   text primary key,
  city_name  text not null,
  rule       text not null check (rule in ('anniversary')),
  note       text not null check (length(note) <= 300),
  source_url text not null check (source_url ~ '^https://\S{4,}$' and length(source_url) <= 500)
);
alter table public.city_rules enable row level security;
drop policy if exists city_rules_read on public.city_rules;
create policy city_rules_read on public.city_rules for select to authenticated using (true);
revoke all on public.city_rules from anon;
revoke insert, update, delete on public.city_rules from authenticated;
grant select on public.city_rules to authenticated;
insert into public.city_rules (city_key, city_name, rule, note, source_url) values
  ('quezon', 'Quezon City', 'anniversary', 'Quezon City asks you to renew one year from the issue date of your current permit, not by January 20.',
   'https://quezoncity.gov.ph/qcitizen-guides/how-to-renew-business-permit/')
on conflict (city_key) do nothing;

-- Extensions staff announce. One live extension per city per year; a new one replaces it.
create table if not exists public.city_deadlines (
  id           uuid primary key default gen_random_uuid(),
  city_key     text not null check (city_key ~ '^[a-z0-9 ]{2,60}$'),
  city_name    text not null check (length(btrim(city_name)) between 2 and 80),
  permit_year  int not null check (permit_year between 2020 and 2100),
  due_on       date not null,
  was_on       date not null,
  source_url   text not null check (source_url ~ '^https://\S{4,}$' and length(source_url) <= 500),
  note         text check (note is null or length(note) <= 300),
  notified     int not null default 0,      -- workspaces told
  created_by   uuid default auth.uid() references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  withdrawn_at timestamptz,
  check (due_on > was_on)
);
create unique index if not exists city_deadlines_live on public.city_deadlines (city_key, permit_year) where withdrawn_at is null;
alter table public.city_deadlines enable row level security;
drop policy if exists city_deadlines_read on public.city_deadlines;
create policy city_deadlines_read on public.city_deadlines for select to authenticated using (withdrawn_at is null);
revoke all on public.city_deadlines from anon;
revoke insert, update, delete on public.city_deadlines from authenticated;
grant select on public.city_deadlines to authenticated;

-- Which permits took the new date, and the date they had before (so a withdrawal can put it back).
create table if not exists public.city_deadline_uses (
  deadline_id    uuid not null references public.city_deadlines(id) on delete cascade,
  requirement_id uuid not null references public.requirements(id) on delete cascade,
  org_id         uuid not null references public.orgs(id) on delete cascade,
  cycle_id       uuid not null references public.requirement_cycles(id) on delete cascade,
  old_date       date not null,
  used_by        uuid default auth.uid() references auth.users(id) on delete set null,
  used_at        timestamptz not null default now(),
  primary key (deadline_id, requirement_id)
);
create index if not exists city_deadline_uses_org on public.city_deadline_uses (org_id);
alter table public.city_deadline_uses enable row level security;
drop policy if exists city_deadline_uses_read on public.city_deadline_uses;
create policy city_deadline_uses_read on public.city_deadline_uses for select to authenticated using (org_id in (select private.my_org_ids()));
revoke all on public.city_deadline_uses from anon;
revoke insert, update, delete on public.city_deadline_uses from authenticated;
grant select on public.city_deadline_uses to authenticated;

-- Business permits in a city (by the branch's city, or the business's main branch when the permit has no branch),
-- with their current record.
create or replace function private.city_permits(p_key text) returns table (requirement_id uuid, org_id uuid, cycle_id uuid, expires_on date, city text)
language sql stable security definer set search_path = '' as $$
  select r.id, r.org_id, c.id, c.expires_on, coalesce(nullif(l.city, ''), ml.city)
  from public.requirements r
  join public.orgs o on o.id = r.org_id and o.deleted_at is null
  join public.businesses b on b.id = r.business_id and b.deleted_at is null
  left join public.business_locations l on l.id = r.location_id and l.deleted_at is null
  left join lateral (select m.city from public.business_locations m where m.business_id = r.business_id and m.is_main and m.deleted_at is null limit 1) ml on true
  left join lateral (select c.id, c.expires_on from public.requirement_cycles c where c.requirement_id = r.id and c.deleted_at is null order by c.seq desc limit 1) c on true
  where r.deleted_at is null and r.type_code = 'mayors_permit' and r.expires
    and (r.location_id is null or l.id is not null)
    and private.city_key(coalesce(nullif(l.city, ''), ml.city)) = p_key
$$;

-- Tell each workspace once: its owners and admins, and whoever handles an affected permit.
create or replace function private.city_notice(d public.city_deadlines, p_org uuid, p_reqs uuid[], p_tag text, p_title text, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare v record; v_link text;
begin
  v_link := case when cardinality(p_reqs) = 1 then '#/requirement/' || p_reqs[1] || '?city=1' else '#/?city=1' end;
  for v in select distinct m.user_id from public.org_members m
             where m.org_id = p_org and (m.role in ('owner','admin')
               or m.user_id in (select r.assignee_id from public.requirements r where r.id = any (p_reqs))) loop
    perform private.notify(v.user_id, p_org, 'system', p_title, p_body, v_link,
      case when cardinality(p_reqs) = 1 then p_reqs[1] end, 'city' || p_tag || ':' || d.id || ':' || v.user_id, true);
  end loop;
end $$;

-- Staff: business permits per city, for the city list (spelled the way most customers spell it).
create or replace function public.admin_city_counts() returns table (city_key text, city_name text, workspaces int, permits int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  return query
    with p as (
      select r.org_id, coalesce(nullif(l.city, ''), ml.city) as city
      from public.requirements r
      join public.orgs o on o.id = r.org_id and o.deleted_at is null
      join public.businesses b on b.id = r.business_id and b.deleted_at is null
      left join public.business_locations l on l.id = r.location_id and l.deleted_at is null
      left join lateral (select m.city from public.business_locations m where m.business_id = r.business_id and m.is_main and m.deleted_at is null limit 1) ml on true
      where r.deleted_at is null and r.type_code = 'mayors_permit' and (r.location_id is null or l.id is not null)
    ), k as (select private.city_key(p.city) as ck, btrim(p.city) as city, p.org_id from p where btrim(coalesce(p.city, '')) <> '')
    select k.ck, mode() within group (order by k.city), count(distinct k.org_id)::int, count(*)::int
    from k where k.ck <> '' group by k.ck order by count(*) desc, k.ck;
end $$;

-- Staff: announce an extension. Replaces a live one for the same city and year: permits that took the old date
-- move to the new one. Everyone with a permit in that city still due before the new date is told.
create or replace function public.admin_city_deadline(p_city text, p_year int, p_due date, p_source text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_key text := private.city_key(p_city); d public.city_deadlines; old public.city_deadlines; v record;
  v_moved int := 0; v_orgs uuid[] := '{}'; v_permits int := 0; v_today date := private.today_ph(); v_name text := btrim(coalesce(p_city, ''));
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  if v_key !~ '^[a-z0-9 ]{2,60}$' or length(v_name) not between 2 and 80 then raise exception 'Choose the city.' using errcode = '22023'; end if;
  if p_year is null or p_year not between extract(year from v_today)::int - 1 and extract(year from v_today)::int + 1 then
    raise exception 'Choose the permit year.' using errcode = '22023';
  end if;
  if p_due is null or extract(year from p_due)::int <> p_year then raise exception 'The new date must be in %.', p_year using errcode = '22023'; end if;
  if p_due < v_today then raise exception 'The new date has already passed.' using errcode = '22023'; end if;
  if p_due <= make_date(p_year, 1, 20) then raise exception 'An extension comes after January 20.' using errcode = '22023'; end if;
  if coalesce(btrim(p_source), '') !~ '^https://\S{4,}$' or length(btrim(p_source)) > 500 then
    raise exception 'Add the link to the city''s notice or a news report (starting with https://).' using errcode = '22023';
  end if;
  if length(coalesce(p_note, '')) > 300 then raise exception 'Keep the note under 300 characters.' using errcode = '22023'; end if;
  -- the name as staff typed it ("manila city" reads "Manila City")
  if v_name = lower(v_name) then v_name := initcap(v_name); end if;

  select * into old from public.city_deadlines where city_key = v_key and permit_year = p_year and withdrawn_at is null for update;
  if old.id is not null then update public.city_deadlines set withdrawn_at = now() where id = old.id; end if;
  insert into public.city_deadlines (city_key, city_name, permit_year, due_on, was_on, source_url, note)
  values (v_key, v_name, p_year, p_due, make_date(p_year, 1, 20), btrim(p_source), nullif(btrim(coalesce(p_note, '')), ''))
  returning * into d;

  -- permits that took the old extension and still have its date: move them along
  if old.id is not null then
    for v in select u.*, c.expires_on from public.city_deadline_uses u join public.requirement_cycles c on c.id = u.cycle_id
             where u.deadline_id = old.id and c.deleted_at is null and c.expires_on = old.due_on loop
      update public.requirement_cycles set expires_on = d.due_on where id = v.cycle_id;
      insert into public.city_deadline_uses (deadline_id, requirement_id, org_id, cycle_id, old_date, used_by, used_at)
      values (d.id, v.requirement_id, v.org_id, v.cycle_id, v.old_date, v.used_by, now()) on conflict do nothing;
      perform private.req_activity(v.requirement_id, 'city_deadline', d.id, 'update',
        d.city_name || ' changed its business permit extension to ' || to_char(d.due_on, 'FMMonth FMDD, YYYY'));
      v_moved := v_moved + 1;
    end loop;
  end if;

  -- tell each workspace once
  for v in select p.org_id, array_agg(p.requirement_id) as reqs from private.city_permits(v_key) p
           where p.expires_on >= make_date(p_year, 1, 1) and p.expires_on < d.due_on group by p.org_id loop
    perform private.city_notice(d, v.org_id, v.reqs, 'new', d.city_name || ' extended the business permit deadline to ' || to_char(d.due_on, 'FMMonth FMDD'),
      case when cardinality(v.reqs) = 1 then 'Your business permit there is still due earlier in PermitPal. Open it and tap "Use the new date".'
        else cardinality(v.reqs) || ' of your business permits there are still due earlier in PermitPal. Open PermitPal and tap "Use the new date".' end);
    v_orgs := v_orgs || v.org_id; v_permits := v_permits + cardinality(v.reqs);
  end loop;
  -- and the ones whose date was moved for them
  for v in select u.org_id, array_agg(u.requirement_id) as reqs from public.city_deadline_uses u
           where u.deadline_id = d.id group by u.org_id loop
    perform private.city_notice(d, v.org_id, v.reqs, 'moved', d.city_name || ' moved its business permit deadline to ' || to_char(d.due_on, 'FMMonth FMDD'),
      'We updated the date on ' || case when cardinality(v.reqs) = 1 then 'your business permit there.' else cardinality(v.reqs) || ' of your business permits there.' end);
    v_orgs := v_orgs || v.org_id;
  end loop;
  update public.city_deadlines set notified = (select count(distinct o) from unnest(v_orgs) o) where id = d.id returning * into d;
  return jsonb_build_object('id', d.id, 'city', d.city_name, 'workspaces', d.notified, 'permits', v_permits, 'moved', v_moved);
end $$;

-- Staff: take back an extension typed by mistake. Permits moved to it (and not changed since) get their old date back.
create or replace function public.admin_city_deadline_withdraw(p_id uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare d public.city_deadlines; v record; v_n int := 0;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select * into d from public.city_deadlines where id = p_id for update;
  if d.id is null then raise exception 'Extension not found.' using errcode = 'P0002'; end if;
  if d.withdrawn_at is not null then raise exception 'It was already withdrawn.' using errcode = 'P0001'; end if;
  update public.city_deadlines set withdrawn_at = now() where id = d.id;
  for v in select u.* from public.city_deadline_uses u join public.requirement_cycles c on c.id = u.cycle_id
           where u.deadline_id = d.id and c.deleted_at is null and c.expires_on = d.due_on loop
    update public.requirement_cycles set expires_on = v.old_date where id = v.cycle_id;
    perform private.req_activity(v.requirement_id, 'city_deadline', d.id, 'update',
      d.city_name || '''s extension was a mistake and was withdrawn: the expiry date went back');
    v_n := v_n + 1;
  end loop;
  for v in select u.org_id, array_agg(u.requirement_id) as reqs from public.city_deadline_uses u
           join public.requirement_cycles c on c.id = u.cycle_id and c.expires_on = u.old_date
           where u.deadline_id = d.id group by u.org_id loop
    perform private.city_notice(d, v.org_id, v.reqs, 'undo', 'Correction: ' || d.city_name || '''s deadline is not extended',
      'We announced an extension by mistake. Your business permit date is back to ' || to_char(d.was_on, 'FMMonth FMDD') || '.');
  end loop;
  return v_n;
end $$;

-- Staff: every extension, newest first, with how many permits took the new date.
create or replace function public.admin_city_deadlines() returns table (id uuid, city_key text, city_name text, permit_year int, due_on date,
  was_on date, source_url text, note text, notified int, moved int, created_at timestamptz, withdrawn_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  return query select d.id, d.city_key, d.city_name, d.permit_year, d.due_on, d.was_on, d.source_url, d.note, d.notified,
    (select count(*)::int from public.city_deadline_uses u where u.deadline_id = d.id), d.created_at, d.withdrawn_at
  from public.city_deadlines d order by d.created_at desc limit 200;
end $$;

-- Customers: move permits to the city's new date. Only permits in that city, still due earlier that year.
create or replace function public.use_city_deadline(p_deadline uuid, p_requirements uuid[]) returns int
language plpgsql security definer set search_path = '' as $$
declare d public.city_deadlines; r public.requirements; p record; v_req uuid; v_n int := 0;
begin
  select * into d from public.city_deadlines where id = p_deadline and withdrawn_at is null;
  if d.id is null then raise exception 'That extension is no longer listed.' using errcode = 'P0002'; end if;
  if p_requirements is null or cardinality(p_requirements) = 0 or cardinality(p_requirements) > 500 then
    raise exception 'Choose the permits.' using errcode = '22023';
  end if;
  foreach v_req in array p_requirements loop
    r := private.req_for_edit(v_req);
    select * into p from private.city_permits(d.city_key) x where x.requirement_id = r.id;
    if p.requirement_id is null or p.expires_on is null or p.expires_on < make_date(d.permit_year, 1, 1) or p.expires_on >= d.due_on then continue; end if;
    update public.requirement_cycles set expires_on = d.due_on where id = p.cycle_id;
    insert into public.city_deadline_uses (deadline_id, requirement_id, org_id, cycle_id, old_date)
    values (d.id, r.id, r.org_id, p.cycle_id, p.expires_on)
    on conflict (deadline_id, requirement_id) do update set cycle_id = excluded.cycle_id, old_date = excluded.old_date, used_by = auth.uid(), used_at = now();
    perform private.req_activity(r.id, 'city_deadline', d.id, 'update',
      d.city_name || ' extended the business permit deadline to ' || to_char(d.due_on, 'FMMonth FMDD, YYYY'));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ================================================================ paying a city bill through PermitPal: PHP 199
update public.app_settings set value = '199' where key = 'billpay_fee' and value = '99';

-- ================================================================ who may call what
do $$ declare f text; begin
  foreach f in array array['public.packet_save(uuid,integer,jsonb,boolean)', 'public.admin_city_counts()',
    'public.admin_city_deadline(text,integer,date,text,text)', 'public.admin_city_deadline_withdraw(uuid)', 'public.admin_city_deadlines()',
    'public.use_city_deadline(uuid,uuid[])'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array['private.packet_clean(jsonb)', 'private.city_key(text)', 'private.city_permits(text)',
    'private.city_notice(public.city_deadlines,uuid,uuid[],text,text,text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;

insert into private.features (name) values ('packet'), ('citydates') on conflict do nothing;

commit;
