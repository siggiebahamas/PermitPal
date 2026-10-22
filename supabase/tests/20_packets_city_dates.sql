-- Renewal packets (answers per permit per year, checked; ready once sales are in) and city deadlines (city
-- spellings, Quezon City's rule, staff announcing an extension, who is told, moving a permit's date, replacing and
-- withdrawing an extension, who can see and do what), plus the PHP 199 bill fee. Rolled back at the end.
begin;
create temp table t_res (n serial primary key, step text, ok boolean, info text);
grant all on t_res to authenticated, anon; grant all on sequence t_res_n_seq to authenticated, anon;
create function pg_temp.res(s text, ok boolean, info text default '') returns void language sql as
  $f$ insert into pg_temp.t_res(step, ok, info) values (s, coalesce(ok, false), coalesce(info, '')) $f$;
grant execute on function pg_temp.res(text, boolean, text) to authenticated, anon;
create function pg_temp.err(p_sql text) returns text language plpgsql as $f$ begin execute p_sql; return 'allowed'; exception when others then return sqlerrm; end $f$;
grant execute on function pg_temp.err(text) to authenticated, anon;
create function pg_temp.as_user(u text) returns void language plpgsql as $f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); end $f$;
create temp table t_ids (org uuid, biz uuid, loc2 uuid, loc3 uuid, mp uuid, mp2 uuid, mp3 uuid, fsic uuid, other uuid, obiz uuid, omp uuid,
  omp_late uuid, pk uuid, d1 uuid, d2 uuid);
grant all on t_ids to authenticated, anon; insert into t_ids default values;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at) values
 ('eb000000-0000-4000-8000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner@city.ph','{"first_name":"Carmen"}', now()),
 ('eb000000-0000-4000-8000-0000000000b2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','member@city.ph','{"first_name":"Mark"}', now()),
 ('eb000000-0000-4000-8000-0000000000c3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','other@city.ph','{"first_name":"Oscar"}', now()),
 ('eb000000-0000-4000-8000-0000000000f5','00000000-0000-0000-0000-000000000000','authenticated','authenticated','staff@city.ph','{"first_name":"Faye"}', now());
update public.profiles set is_platform_admin = true where id = 'eb000000-0000-4000-8000-0000000000f5';
update private.settings set value = '{}' where key = 'channel_status';
delete from public.message_outbox;

select pg_temp.res('both feature switches are on', exists (select 1 from private.features where name = 'packet') and exists (select 1 from private.features where name = 'citydates'), '');
select pg_temp.res('paying a city bill through PermitPal costs ₱199', private.app_setting('billpay_fee') = '199', private.app_setting('billpay_fee'));

-- ---------------------------------------------------------------- set-up: two branches in Manila, one in QC; another business in Manila
select pg_temp.as_user('eb000000-0000-4000-8000-0000000000a1');
set local role authenticated;
update t_ids set org = public.create_org('Carmen Foods');
update t_ids set biz = public.create_business(org, 'Carmen''s Carinderia', 'Sole Proprietorship', 'restaurant', 'Manila City', '12 Taft Ave');
update t_ids set loc2 = public.add_location(biz, 'Ermita branch', 'City of Manila', '3 Mabini St');
update t_ids set loc3 = public.add_location(biz, 'Cubao branch', 'Q.C.', '8 Aurora Blvd');
update t_ids set mp = (select id from public.requirements where business_id = (select biz from t_ids) and type_code = 'mayors_permit' and location_id not in ((select loc2 from t_ids), (select loc3 from t_ids)) limit 1),
  mp2 = (select id from public.requirements where location_id = (select loc2 from t_ids) and type_code = 'mayors_permit'),
  mp3 = (select id from public.requirements where location_id = (select loc3 from t_ids) and type_code = 'mayors_permit'),
  fsic = (select id from public.requirements where business_id = (select biz from t_ids) and type_code = 'fsic' limit 1);
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
insert into public.org_members (org_id, user_id, role) select org, 'eb000000-0000-4000-8000-0000000000b2', 'member' from t_ids;
update public.requirements set assignee_id = 'eb000000-0000-4000-8000-0000000000b2' where id = (select mp2 from t_ids);
insert into public.requirement_cycles (org_id, requirement_id, reference_no, issued_on, expires_on)
  select org, x, 'BP-2026-' || n, '2026-01-15', '2027-01-20' from t_ids, unnest(array[mp, mp2, mp3]) with ordinality u(x, n);
select pg_temp.as_user('eb000000-0000-4000-8000-0000000000c3');
set local role authenticated;
update t_ids set other = public.create_org('Oscar Hardware');
update t_ids set obiz = public.create_business(other, 'Oscar Hardware', 'Sole Proprietorship', 'retail', 'Manila', '9 Recto Ave');
update t_ids set omp = (select id from public.requirements where business_id = (select obiz from t_ids) and type_code = 'mayors_permit' limit 1);
update t_ids set omp_late = public.add_location(obiz, 'Tondo branch', 'manila', '1 Juan Luna St');
update t_ids set omp_late = (select id from public.requirements where location_id = (select omp_late from t_ids) and type_code = 'mayors_permit');
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
insert into public.requirement_cycles (org_id, requirement_id, reference_no, issued_on, expires_on)
  select other, omp, 'MNL-1', '2026-01-10'::date, '2027-01-20'::date from t_ids
  union all select other, omp_late, 'MNL-2', '2026-03-01', '2027-03-01' from t_ids;

-- ---------------------------------------------------------------- renewal packets
select pg_temp.res('answers: unknown keys and empty text are dropped, numbers kept',
  private.packet_clean('{"sales": 1842600.5, "employees": 6, "line": "  Carinderia  ", "changes": " ", "hack": "x"}') = '{"sales": 1842600.5, "employees": 6, "line": "Carinderia"}'::jsonb,
  private.packet_clean('{"sales": 1842600.5, "employees": 6, "line": "  Carinderia  ", "changes": " ", "hack": "x"}')::text);
select pg_temp.as_user('eb000000-0000-4000-8000-0000000000b2');
set local role authenticated;
select pg_temp.res('sales must be a number', pg_temp.err(format('select public.packet_save(%L, 2027, %L)', (select mp from t_ids), '{"sales": "a lot"}')) = 'Sales: enter a number.', '');
select pg_temp.res('people working there: a whole number', pg_temp.err(format('select public.packet_save(%L, 2027, %L)', (select mp from t_ids), '{"employees": 2.5}')) like 'People working there: that number%', '');
select pg_temp.res('owned or rented: one of the options', pg_temp.err(format('select public.packet_save(%L, 2027, %L)', (select mp from t_ids), '{"place": "borrowed"}')) like 'Owned or rented: choose%', '');
select pg_temp.res('text has a limit', pg_temp.err(format('select public.packet_save(%L, 2027, %L)', (select mp from t_ids), jsonb_build_object('changes', repeat('x', 501)))) like 'What changed: keep it under 500%', '');
select pg_temp.res('only for business permits', pg_temp.err(format('select public.packet_save(%L, 2027, %L)', (select fsic from t_ids), '{}')) = 'Renewal packets are for business permits.', '');
select pg_temp.res('the permit year must be near', pg_temp.err(format('select public.packet_save(%L, 2031, %L)', (select mp from t_ids), '{}')) = 'Choose the permit year.', '');
select pg_temp.res('ready needs last year''s sales', pg_temp.err(format('select public.packet_save(%L, 2027, %L, true)', (select mp from t_ids), '{"employees": 6}')) = 'Add last year''s sales first.', '');
update t_ids set pk = public.packet_save(mp, 2027, '{"employees": 6, "changed": "no"}');
select pg_temp.res('a teammate saves the answers so far', ready_at is null and answers = '{"employees": 6, "changed": "no"}'::jsonb, answers::text)
  from public.renewal_packets where id = (select pk from t_ids);
select public.packet_save(mp, 2027, '{"employees": 7, "changed": "no", "sales": 1842600}', true) from t_ids;
select pg_temp.res('every answer in: the packet is ready, same row', ready_at is not null and (answers->>'sales')::numeric = 1842600 and (answers->>'employees')::int = 7
  and (select count(*) from public.renewal_packets) = 1, answers::text) from public.renewal_packets where id = (select pk from t_ids);
select public.packet_save(mp, 2027, '{"employees": 7, "changed": "yes", "changes": "New oven", "sales": 1842600}') from t_ids;
select pg_temp.res('changing an answer later keeps it ready', ready_at is not null and answers->>'changes' = 'New oven', answers::text)
  from public.renewal_packets where id = (select pk from t_ids);
select pg_temp.res('nobody writes packets directly', pg_temp.err('update public.renewal_packets set ready_at = null') like 'permission denied%', '');
reset role;
select pg_temp.res('the permit''s Activity says it''s ready, once', (select count(*) from public.audit_log where requirement_id = (select mp from t_ids) and summary = 'Renewal packet for 2027 is ready') = 1, '');
select pg_temp.as_user('eb000000-0000-4000-8000-0000000000c3');
set local role authenticated;
select pg_temp.res('someone else sees no packet and can''t write one', (select count(*) from public.renewal_packets) = 0
  and pg_temp.err(format('select public.packet_save(%L, 2027, %L)', (select mp from t_ids), '{}')) = 'Permit not found.', '');
reset role;

-- ---------------------------------------------------------------- city spellings and rules
select pg_temp.res('city spellings: QC, Q.C. and Quezon City are one city; so are Manila City and City of Manila',
  private.city_key('QC') = 'quezon' and private.city_key('Q.C.') = 'quezon' and private.city_key('Quezon City, Metro Manila') = 'quezon'
  and private.city_key('Manila City') = 'manila' and private.city_key('City of Manila') = 'manila' and private.city_key('  MANILA ') = 'manila', '');
select pg_temp.res('accents and dashes: Las Piñas, Parañaque, Lapu-Lapu', private.city_key('Las Piñas City') = 'las pinas'
  and private.city_key('Parañaque') = 'paranaque' and private.city_key('Lapu-Lapu City') = 'lapu lapu' and private.city_key('Municipality of Taytay') = 'taytay', '');
select pg_temp.as_user('eb000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select pg_temp.res('Quezon City''s rule is there for everyone: a year from the issue date', exists (select 1 from public.city_rules where city_key = 'quezon' and rule = 'anniversary'), '');
select pg_temp.res('customers can''t announce extensions or see the staff lists', pg_temp.err('select public.admin_city_deadline(''Manila'', 2027, ''2027-02-13'', ''https://mb.com.ph/x'')') = 'Staff only.'
  and pg_temp.err('select * from public.admin_city_counts()') = 'Staff only.' and pg_temp.err('select * from public.admin_city_deadlines()') = 'Staff only.', '');
reset role;

-- ---------------------------------------------------------------- staff announce an extension
select pg_temp.as_user('eb000000-0000-4000-8000-0000000000f5');
set local role authenticated;
select pg_temp.res('the city list: Manila has 2 workspaces and 4 business permits, spelled the common way',
  exists (select 1 from public.admin_city_counts() where city_key = 'manila' and workspaces = 2 and permits = 4)
  and exists (select 1 from public.admin_city_counts() where city_key = 'quezon' and permits = 1), (select string_agg(city_key || '/' || city_name || '/' || workspaces || '/' || permits, ', ') from public.admin_city_counts()));
select pg_temp.res('it needs a link to the notice', pg_temp.err('select public.admin_city_deadline(''Manila'', 2027, ''2027-02-13'', ''mb.com.ph/x'')') like 'Add the link%', '');
select pg_temp.res('the new date must be in the permit year', pg_temp.err('select public.admin_city_deadline(''Manila'', 2027, ''2028-02-13'', ''https://mb.com.ph/x'')') = 'The new date must be in 2027.', '');
select pg_temp.res('an extension comes after January 20', pg_temp.err('select public.admin_city_deadline(''Manila'', 2027, ''2027-01-20'', ''https://mb.com.ph/x'')') = 'An extension comes after January 20.', '');
select pg_temp.res('a city is needed', pg_temp.err('select public.admin_city_deadline('' '', 2027, ''2027-02-13'', ''https://mb.com.ph/x'')') = 'Choose the city.', '');
update t_ids set d1 = (public.admin_city_deadline('manila city', 2027, '2027-02-13', 'https://mb.com.ph/2027/01/manila-extends', 'Treasurer''s notice')->>'id')::uuid;
reset role;
select pg_temp.res('announced for Manila: 2 workspaces told, from January 20', d.notified = 2 and d.was_on = '2027-01-20' and d.city_key = 'manila', d.city_name || ' ' || d.notified)
  from public.city_deadlines d where d.id = (select d1 from t_ids);
select pg_temp.res('the owner gets one notice for both Manila branches, pointing to the dashboard',
  (select count(*) from public.notifications where user_id = 'eb000000-0000-4000-8000-0000000000a1' and dedupe_key like 'citynew:%') = 1
  and exists (select 1 from public.notifications where user_id = 'eb000000-0000-4000-8000-0000000000a1' and link = '#/?city=1' and title like 'Manila City extended the business permit deadline to February 13%' and body like '2 of your business permits%'),
  (select string_agg(title || ' | ' || body || ' | ' || link, '; ') from public.notifications where user_id = 'eb000000-0000-4000-8000-0000000000a1'));
select pg_temp.res('the teammate handling the Ermita permit is told too; the QC branch isn''t part of it',
  exists (select 1 from public.notifications where user_id = 'eb000000-0000-4000-8000-0000000000b2' and dedupe_key like 'citynew:%'), '');
select pg_temp.res('the other business''s owner: one permit, linked to it (the March one isn''t due earlier)',
  exists (select 1 from public.notifications n, t_ids where n.user_id = 'eb000000-0000-4000-8000-0000000000c3' and n.link = '#/requirement/' || t_ids.omp || '?city=1' and n.requirement_id = t_ids.omp), '');
select pg_temp.res('the notices go out by email too', (select count(*) from public.message_outbox where dedupe_key like 'citynew:%') = 3, (select count(*) from public.message_outbox)::text);

-- ---------------------------------------------------------------- customers move their date
select pg_temp.as_user('eb000000-0000-4000-8000-0000000000b2');
set local role authenticated;
select pg_temp.res('customers see the live extension', exists (select 1 from public.city_deadlines where city_key = 'manila' and due_on = '2027-02-13'), '');
select pg_temp.res('one tap moves the Manila permit; the QC one isn''t moved', public.use_city_deadline(d1, array[mp, mp3]) = 1, '') from t_ids;
select pg_temp.res('tapping again changes nothing', public.use_city_deadline(d1, array[mp]) = 0, '') from t_ids;
reset role;
select pg_temp.res('the permit now expires February 13, 2027, and the old date is kept', c.expires_on = '2027-02-13'
  and exists (select 1 from public.city_deadline_uses u, t_ids where u.requirement_id = t_ids.mp and u.old_date = '2027-01-20'), c.expires_on::text)
  from public.requirement_cycles c, t_ids where c.requirement_id = t_ids.mp;
select pg_temp.res('...and its Activity says why', exists (select 1 from public.audit_log a, t_ids where a.requirement_id = t_ids.mp and a.summary = 'Manila City extended the business permit deadline to February 13, 2027'), '');
select pg_temp.res('the QC permit still expires January 20', (select expires_on from public.requirement_cycles c, t_ids where c.requirement_id = t_ids.mp3) = '2027-01-20', '');
select pg_temp.as_user('eb000000-0000-4000-8000-0000000000c3');
set local role authenticated;
select pg_temp.res('someone else can''t move our permit', pg_temp.err(format('select public.use_city_deadline(%L, array[%L]::uuid[])', (select d1 from t_ids), (select mp2 from t_ids))) = 'Permit not found.', '');
select pg_temp.res('nobody writes the extension list directly', pg_temp.err('delete from public.city_deadlines') like 'permission denied%', '');
reset role;

-- ---------------------------------------------------------------- staff correct it, then withdraw it
select pg_temp.as_user('eb000000-0000-4000-8000-0000000000f5');
set local role authenticated;
update t_ids set d2 = (public.admin_city_deadline('Manila', 2027, '2027-02-27', 'https://mb.com.ph/2027/01/manila-extends-again')->>'id')::uuid;
reset role;
select pg_temp.res('a new date replaces the old one: the old is withdrawn', (select withdrawn_at from public.city_deadlines where id = (select d1 from t_ids)) is not null
  and (select count(*) from public.city_deadlines where city_key = 'manila' and withdrawn_at is null) = 1, '');
select pg_temp.res('the permit that took the old date moves along to February 27', (select expires_on from public.requirement_cycles c, t_ids where c.requirement_id = t_ids.mp) = '2027-02-27', '');
select pg_temp.res('...and the owner is told it moved', exists (select 1 from public.notifications where user_id = 'eb000000-0000-4000-8000-0000000000a1' and dedupe_key like 'citymoved:%' and body = 'We updated the date on your business permit there.'), '');
select pg_temp.as_user('eb000000-0000-4000-8000-0000000000f5');
set local role authenticated;
select pg_temp.res('staff see both, with how many took the date', exists (select 1 from public.admin_city_deadlines() where id = (select d2 from t_ids) and moved = 1 and withdrawn_at is null)
  and exists (select 1 from public.admin_city_deadlines() where id = (select d1 from t_ids) and moved = 1 and withdrawn_at is not null), '');
select pg_temp.res('withdrawing puts the moved permit back', public.admin_city_deadline_withdraw(d2) = 1, '') from t_ids;
select pg_temp.res('withdrawing twice is refused', pg_temp.err(format('select public.admin_city_deadline_withdraw(%L)', (select d2 from t_ids))) = 'It was already withdrawn.', '');
reset role;
select pg_temp.res('the permit expires January 20 again, and the owner gets a correction', (select expires_on from public.requirement_cycles c, t_ids where c.requirement_id = t_ids.mp) = '2027-01-20'
  and exists (select 1 from public.notifications where user_id = 'eb000000-0000-4000-8000-0000000000a1' and dedupe_key like 'cityundo:%' and title = 'Correction: Manila''s deadline is not extended'), '');
select pg_temp.as_user('eb000000-0000-4000-8000-0000000000b2');
set local role authenticated;
select pg_temp.res('customers no longer see a withdrawn extension', (select count(*) from public.city_deadlines where city_key = 'manila') = 0, '');
select pg_temp.res('a withdrawn extension can''t be used', pg_temp.err(format('select public.use_city_deadline(%L, array[%L]::uuid[])', (select d2 from t_ids), (select mp from t_ids))) = 'That extension is no longer listed.', '');
reset role;
set local role anon;
select pg_temp.res('visitors see no packets, extensions or rules', pg_temp.err('select count(*) from public.renewal_packets') like 'permission denied%'
  and pg_temp.err('select count(*) from public.city_deadlines') like 'permission denied%' and pg_temp.err('select count(*) from public.city_rules') like 'permission denied%', '');
reset role;

select n, step, ok, info from t_res order by n;
rollback;
