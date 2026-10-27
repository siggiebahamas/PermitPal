-- Database file 16: round prices and the PHP 600 season pass (with a free template), the 17-city register and
-- "pay it online only", to-dos on the Home calendar, the calendar link, and the plans by size with their limits
-- (nothing already tracked is ever removed). Rolled back at the end.
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
create temp table t_ids (org uuid, qc uuid, pasig uuid, qcmp uuid, pgmp uuid, qcfsic uuid, veh uuid, task uuid, tok text, tok2 text, other uuid, fleet uuid, r text);
grant all on t_ids to authenticated, anon; insert into t_ids default values;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at) values
 ('ed000000-0000-4000-8000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner@brief.ph','{"first_name":"Sadie"}', now()),
 ('ed000000-0000-4000-8000-0000000000c3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','other@brief.ph','{"first_name":"Oscar"}', now()),
 ('ed000000-0000-4000-8000-0000000000f5','00000000-0000-0000-0000-000000000000','authenticated','authenticated','staff@brief.ph','{"first_name":"Fely"}', now());
update public.profiles set is_platform_admin = true where id = 'ed000000-0000-4000-8000-0000000000f5';

-- ---------------------------------------------------------------- prices
select pg_temp.res('the feature switch is on', exists (select 1 from private.features where name = 'lgus'), '');
select pg_temp.res('templates priced against doing it yourself: letters 150, sworn statements 250, SPA 350, Secretary''s Certificate 500',
  (select string_agg(code || '=' || price_php::int, ',' order by code) from public.doc_templates) =
  'accreditation_cover_letter=150,affidavit_of_loss=250,authorization_letter=150,certified_copy_request=150,gross_sales_declaration=250,landlord_letter=150,secretary_certificate=500,special_power_of_attorney=350',
  (select string_agg(code || '=' || price_php::int, ',' order by code) from public.doc_templates));
select pg_temp.res('one template on its own is PHP 150; the season pass PHP 600', (select price_php from public.load_products where code = 'template') = 150
  and (select price_php from public.load_products where code = 'season_pass') = 600, '');
select pg_temp.res('Plus is PHP 149 a month or PHP 1,490 a year', private.addon_price('plus', null, 'monthly') = 149 and private.addon_price('plus', null, 'yearly') = 1490, '');
select pg_temp.res('Core 799, Multi-Vehicle 1,499, Fleet 2,999, Fleet Pro 4,999; Enterprise is quoted (not sold)',
  (select string_agg(id || '=' || coalesce(price_php_monthly::int::text, 'quote') || ':' || available, ',' order by sort) from public.plans where id in ('core','multi','fleet','fleet_pro','enterprise'))
  = 'core=799:true,multi=1499:true,fleet=2999:true,fleet_pro=4999:true,enterprise=quote:false',
  (select string_agg(id || '=' || coalesce(price_php_monthly::int::text, 'quote') || ':' || available, ',' order by sort) from public.plans where id in ('core','multi','fleet','fleet_pro','enterprise')));
select pg_temp.res('limits: Free 1+1 (2 records, 1 user, 3 files), Plus 5, Core 15 and 3 users, fleets by vehicles',
  (select record_limit = 2 and vehicle_limit = 1 and business_limit = 1 and seat_limit = 1 and docs_per_record = 3 from public.plan_limits where code = 'free')
  and (select record_limit from public.plan_limits where code = 'plus') = 5 and (select record_limit = 15 and seat_limit = 3 from public.plan_limits where code = 'core')
  and (select string_agg(code || '=' || vehicle_limit, ',' order by vehicle_limit) from public.plan_limits where code in ('multi','fleet','fleet_pro')) = 'multi=30,fleet=75,fleet_pro=150', '');

-- ---------------------------------------------------------------- sources, and what you send vs what the agency needs
select pg_temp.res('the LTO renewal checklist names its official source and date', (select source_url like 'https://www.ltoncr.com/%' and checked_on = '2026-10-24' and verify = 'partial' from public.requirement_types where code = 'lto_registration'), '');
select pg_temp.res('every LTO document item says what to send us AND what LTO needs, separately',
  (select bool_and(i ? 'send' and i ? 'agency') from public.requirement_types t, jsonb_array_elements(t.checklist) i where t.code = 'lto_registration' and i ->> 'k' <> 'pay')
  and (select i ->> 'agency' from public.requirement_types t, jsonb_array_elements(t.checklist) i where t.code = 'lto_registration' and i ->> 'k' = 'inspect') = 'original_submit'
  and (select i ->> 'agency' from public.requirement_types t, jsonb_array_elements(t.checklist) i where t.code = 'lto_registration' and i ->> 'k' = 'ctpl') = 'issuer', '');
select pg_temp.res('anything not checked against an official source says so', not exists (select 1 from public.requirement_types where verify = 'verified' and source_url is null), '');

-- ---------------------------------------------------------------- the city register
select pg_temp.res('all 17 Metro Manila LGUs, Pateros as a municipality', (select count(*) from public.lgus) = 17 and (select kind from public.lgus where city_key = 'pateros') = 'municipality', '');
select pg_temp.res('online payment only where an official page confirms it (Quezon City, Pasay, Malabon)',
  (select string_agg(city_key, ',' order by city_key) from public.lgus where online_payment = 'yes') = 'malabon,pasay,quezon',
  (select string_agg(city_key, ',' order by city_key) from public.lgus where online_payment = 'yes'));
select pg_temp.res('no made-up link for Pateros; every other link is https', (select source_url is null from public.lgus where city_key = 'pateros')
  and not exists (select 1 from public.lgus where source_url is not null and source_url not like 'https://%'), '');
select pg_temp.res('unconfirmed cities say so', (select count(*) from public.lgus where status = 'needs_confirmation') >= 6, '');

set local role anon;
select pg_temp.res('anyone can read the register', (select count(*) from public.lgus) = 17, '');
reset role;

-- ---------------------------------------------------------------- set-up: a business in Quezon City and one in Pasig (limits off for set-up)
set local pp.skip_limits = 'on';
select pg_temp.as_user('ed000000-0000-4000-8000-0000000000a1');
set local role authenticated;
update t_ids set org = public.create_org('Sadie Foods');
update t_ids set qc = public.create_business(org, 'Sadie''s Kitchen', 'Corporation', 'restaurant', 'Quezon City', '18 Maginhawa St');
update t_ids set pasig = public.create_business(org, 'Sadie''s Bakery', 'Corporation', 'restaurant', 'Pasig City', '12 Shaw Blvd');
update t_ids set qcmp = (select id from public.requirements where business_id = (select qc from t_ids) and type_code = 'mayors_permit' limit 1),
  qcfsic = (select id from public.requirements where business_id = (select qc from t_ids) and type_code = 'fsic' limit 1),
  pgmp = (select id from public.requirements where business_id = (select pasig from t_ids) and type_code = 'mayors_permit' limit 1);
reset role;
set local pp.skip_limits = 'off';

select pg_temp.res('Pinoy Permit can pay a Quezon City business permit bill online', private.bill_online((select qcmp from t_ids)), '');
select pg_temp.res('...but not a Pasig one (not confirmed) or a fire safety bill (needs a counter)', not private.bill_online((select pgmp from t_ids)) and not private.bill_online((select qcfsic from t_ids)), '');

select pg_temp.as_user('ed000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select pg_temp.res('a Pasig bill for Pinoy Permit to pay is refused, with in-person "coming soon"',
  pg_temp.err(format($q$select public.bill_add(%L, %L, 'Pasig Treasurer', 'SOA-1', 1500, null, 'permitpal', %L, 'bill.jpg')$q$, (select org from t_ids), (select pgmp from t_ids), (select org from t_ids) || '/bills/x/bill.jpg'))
  like '%In-person payments are coming soon%', '');
select pg_temp.res('a Quezon City bill is accepted', pg_temp.err(format($q$select public.bill_add(%L, %L, 'QC Treasurer', 'SOA-2', 1500, null, 'permitpal', %L, 'bill.jpg')$q$,
  (select org from t_ids), (select qcmp from t_ids), (select org from t_ids) || '/bills/x/bill2.jpg')) = 'allowed', '');
select pg_temp.res('a bill you pay yourself is fine anywhere', pg_temp.err(format($q$select public.bill_add(%L, %L, 'Pasig Treasurer', 'SOA-3', 900, null, 'self')$q$,
  (select org from t_ids), (select pgmp from t_ids))) = 'allowed', '');
select pg_temp.res('a customer cannot change the register', pg_temp.err($q$select public.lgu_update('pasig', '{"online_payment":"yes"}')$q$) like '%Only Pinoy Permit staff%', '');
reset role;

select pg_temp.as_user('ed000000-0000-4000-8000-0000000000f5');
set local role authenticated;
update t_ids set r = pg_temp.err($q$select public.lgu_update('pasig', '{"online_payment":"yes","checked_on":"2026-11-02"}', 'Confirmed on the BPLD page')$q$);
select pg_temp.res('staff confirm Pasig''s online payment, with a reason', (select r from t_ids) = 'allowed' and (select online_payment from public.lgus where city_key = 'pasig') = 'yes', (select r from t_ids));
select pg_temp.res('...and the old row is kept', exists (select 1 from public.lgu_changes where city_key = 'pasig' and old_row ->> 'online_payment' = 'unknown' and new_row ->> 'online_payment' = 'yes' and reason like 'Confirmed%'), '');
reset role;
select pg_temp.res('now Pinoy Permit can pay the Pasig bill', private.bill_online((select pgmp from t_ids)), '');

-- ---------------------------------------------------------------- to-dos and the calendar link
select pg_temp.as_user('ed000000-0000-4000-8000-0000000000a1');
set local role authenticated;
update t_ids set task = public.task_save(org, null, 'Pick up the cedula', private.today_ph() + 3, 'Barangay hall');
select pg_temp.res('a to-do is added to the calendar', (select title || '|' || due_on from public.org_tasks where id = (select task from t_ids)) = 'Pick up the cedula|' || (private.today_ph() + 3), '');
select pg_temp.res('an empty title is refused', pg_temp.err(format($q$select public.task_save(%L, null, '  ', current_date)$q$, (select org from t_ids))) like 'What do you want to remember%', '');
select public.task_done((select task from t_ids), true);
select pg_temp.res('ticked off', (select done_at is not null from public.org_tasks where id = (select task from t_ids)), '');
update t_ids set tok = public.calendar_feed_token(org);
update t_ids set tok2 = public.calendar_feed_token(org);
select pg_temp.res('a private calendar link, the same one each time', length((select tok from t_ids)) >= 32 and (select tok from t_ids) = (select tok2 from t_ids), '');
update t_ids set tok2 = public.calendar_feed_token(org, true);
select pg_temp.res('"Make a new link" replaces it', (select tok from t_ids) <> (select tok2 from t_ids), '');
select pg_temp.res('customers cannot read the feed directly', pg_temp.err(format($q$select * from public.calendar_feed_events(%L)$q$, (select tok2 from t_ids))) like 'permission denied%', '');
reset role;
insert into public.requirement_cycles (org_id, requirement_id, reference_no, issued_on, expires_on) select org, qcmp, 'MP-9', private.today_ph() - 300, private.today_ph() + 60 from t_ids;
select pg_temp.res('the feed has the permit deadlines and the to-dos', (select count(*) from public.calendar_feed_events((select tok2 from t_ids)) where title like 'Expires:%') >= 1
  and exists (select 1 from public.calendar_feed_events((select tok2 from t_ids)) where title = 'Done: Pick up the cedula'), '');
select pg_temp.res('the old link shows nothing', not exists (select 1 from public.calendar_feed_events((select tok from t_ids))), '');

select pg_temp.as_user('ed000000-0000-4000-8000-0000000000c3');
set local role authenticated;
update t_ids set other = public.create_org('Oscar Co');
select pg_temp.res('someone else cannot see or tick your to-dos', not exists (select 1 from public.org_tasks where id = (select task from t_ids))
  and pg_temp.err(format($q$select public.task_done(%L, false)$q$, (select task from t_ids))) like 'To-do not found%', '');
select pg_temp.res('...or get your calendar link', pg_temp.err(format($q$select public.calendar_feed_token(%L)$q$, (select org from t_ids))) like 'Workspace not found%', '');
reset role;

-- ---------------------------------------------------------------- plan limits (Sadie Foods already has 2 businesses: kept, not removed)
select pg_temp.as_user('ed000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select pg_temp.res('usage: Free, 2 businesses (over the 1 allowed, kept)', (select public.plan_usage(org) ->> 'code' from t_ids) = 'free' and (select (public.plan_usage(org) ->> 'businesses')::int from t_ids) = 2, '');
select pg_temp.res('a third business is refused on Free, saying what to do', pg_temp.err(format($q$select public.create_business(%L, 'Third', 'Corporation', 'retail', 'Makati City', '')$q$, (select org from t_ids)))
  like 'Your Free plan tracks up to 1 business.%Settings > Plan%', '');
select pg_temp.res('the businesses already there can still be edited', pg_temp.err(format($q$update public.businesses set name = 'Sadie''s Bakeshop' where id = %L$q$, (select pasig from t_ids))) = 'allowed', '');
select pg_temp.res('no vehicle either: 2 records is the Free limit', pg_temp.err(format($q$select public.create_vehicle(%L, 'Honda Click', '123 ABC', 'Motorcycle')$q$, (select org from t_ids))) like 'Your Free plan%', '');
update t_ids set r = pg_temp.err(format($q$insert into public.org_invites (org_id, email, role) values (%L, 'mio@brief.ph', 'member')$q$, (select org from t_ids)));
select pg_temp.res('inviting a teammate is refused on Free (1 user)', (select r from t_ids) like 'Your Free plan is for 1 person%', (select r from t_ids));
reset role;

-- Plus: up to 5 records
insert into public.addons (org_id, kind, billing, paid_through, started_on) select org, 'plus', 'monthly', private.today_ph() + 20, private.today_ph() from t_ids;
select pg_temp.as_user('ed000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select pg_temp.res('with Plus: up to 5, so a vehicle and a third business fit', pg_temp.err(format($q$select public.create_vehicle(%L, 'Honda Click', '123 ABC', 'Motorcycle')$q$, (select org from t_ids))) = 'allowed'
  and pg_temp.err(format($q$select public.create_business(%L, 'Third', 'Corporation', 'retail', 'Makati City', '')$q$, (select org from t_ids))) = 'allowed', '');
select pg_temp.err(format($q$select public.create_vehicle(%L, 'Isuzu Elf', 'NGV 5588', 'Truck')$q$, (select org from t_ids)));
select pg_temp.res('the sixth is refused', pg_temp.err(format($q$select public.create_vehicle(%L, 'Toyota Vios', 'NAB 2210', 'Sedan')$q$, (select org from t_ids)))
  like 'Your Plus plan tracks up to 5 businesses and vehicles together, and you have 5.%', '');
reset role;

-- Core: 15 records, 3 users
update public.orgs set plan_id = 'core', plan_expires_at = now() + interval '30 days' where id = (select org from t_ids);
select pg_temp.as_user('ed000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select pg_temp.res('Core comes with Plus', private.has_plus((select org from t_ids)), '');
select pg_temp.res('on Core the sixth fits, and 2 teammates can be invited, not 3',
  pg_temp.err(format($q$select public.create_vehicle(%L, 'Toyota Vios', 'NAB 2210', 'Sedan')$q$, (select org from t_ids))) = 'allowed'
  and pg_temp.err(format($q$insert into public.org_invites (org_id, email, role) values (%L, 'mio@brief.ph', 'member')$q$, (select org from t_ids))) = 'allowed'
  and pg_temp.err(format($q$insert into public.org_invites (org_id, email, role) values (%L, 'ana@brief.ph', 'member')$q$, (select org from t_ids))) = 'allowed'
  and pg_temp.err(format($q$insert into public.org_invites (org_id, email, role) values (%L, 'ben@brief.ph', 'member')$q$, (select org from t_ids))) ~ '^Your (Core )?plan (is for|includes) 3 ', '');
reset role;

-- When a paid plan ends: back to Free limits, nothing removed
update public.orgs set plan_expires_at = now() - interval '1 day' where id = (select org from t_ids);
delete from public.addons where org_id = (select org from t_ids);
select pg_temp.res('a lapsed plan falls back to Free; all 6 records stay', private.limits_code((select org from t_ids)) = 'free'
  and (select count(*) from public.businesses where org_id = (select org from t_ids) and deleted_at is null) + (select count(*) from public.vehicles where org_id = (select org from t_ids) and deleted_at is null) = 6, '');

-- Files: Free keeps 3 per business or vehicle
select pg_temp.as_user('ed000000-0000-4000-8000-0000000000a1');
set local role authenticated;
update t_ids set r = (select string_agg(pg_temp.err(format($q$insert into public.documents (org_id, requirement_id, storage_path, file_name) values (%L, %L, %L, 'f.jpg')$q$,
  (select org from t_ids), (select qcfsic from t_ids), (select org from t_ids) || '/' || (select qcfsic from t_ids) || '/' || g || '.jpg')), '|' order by g) from generate_series(1, 4) g);
select pg_temp.res('Free: 3 files for a business, the 4th is refused', (select r from t_ids) like 'allowed|allowed|allowed|Your Free plan keeps up to 3 files%', (select r from t_ids));
reset role;

-- A fleet trial gets the biggest fleet plan's room
select pg_temp.as_user('ed000000-0000-4000-8000-0000000000c3');
set local role authenticated;
update t_ids set fleet = public.create_org('Oscar Fleet');
reset role;
update public.orgs set kind = 'fleet', trial_ends_at = now() + interval '20 days' where id = (select fleet from t_ids);
select pg_temp.res('a fleet in its free trial has Fleet Pro room', private.limits_code((select fleet from t_ids)) = 'fleet_pro', private.limits_code((select fleet from t_ids)));

-- ---------------------------------------------------------------- the season pass now comes with one template
insert into public.season_passes (org_id, season, starts_on, ends_on, price_php) select org, 2099, private.today_ph() - 1, private.today_ph() + 30, 600 from t_ids;
select pg_temp.as_user('ed000000-0000-4000-8000-0000000000a1');
set local role authenticated;
update t_ids set r = pg_temp.err(format($q$select public.unlock_template(%L, 'secretary_certificate')$q$, (select org from t_ids)));
select pg_temp.res('with the pass, the first template is free', (select r from t_ids) = 'allowed'
  and (select price_php from public.template_unlocks where org_id = (select org from t_ids) and code = 'secretary_certificate') = 0, (select r from t_ids));
select pg_temp.res('...and the pass shows it as used', (select public.load_summary(org) -> 'pass' ->> 'template_used' from t_ids) = 'true', '');
select pg_temp.res('the second one costs load (none here)', pg_temp.err(format($q$select public.unlock_template(%L, 'affidavit_of_loss')$q$, (select org from t_ids))) <> 'allowed', '');
reset role;

select n, step, ok, info from t_res order by n;
rollback;
