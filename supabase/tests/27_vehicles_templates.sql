-- Database file 18: vehicles by fuel and use, nine more templates, SEC GIS filing. Rolled back at the end.
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
create temp table t_ids (org uuid, car uuid, trike uuid, ev uuid);
grant all on t_ids to authenticated, anon; insert into t_ids default values;
create function pg_temp.has(v uuid, code text) returns boolean language sql as
  $f$ select exists (select 1 from public.requirements where vehicle_id = v and type_code = code and deleted_at is null) $f$;
grant execute on function pg_temp.has(uuid, text) to authenticated, anon;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at) values
 ('ee000000-0000-4000-8000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner@veh.ph','{"first_name":"Vida"}', now());

select pg_temp.res('the feature switch is on', exists (select 1 from private.features where name = 'vehicles2'), '');

-- ---------------------------------------------------------------- vehicles
set local pp.skip_limits = 'on';
select pg_temp.as_user('ee000000-0000-4000-8000-0000000000a1');
set local role authenticated;
update t_ids set org = public.create_org('Vida Transport');
update t_ids set car = (public.create_vehicle(org, 'Toyota Vios', 'NAB 1234', 'Sedan') ->> 'vehicle_id')::uuid;
update t_ids set trike = (public.create_vehicle(org, 'Honda TMX', '123 ABC', 'Tricycle') ->> 'vehicle_id')::uuid;
update t_ids set ev = (public.create_vehicle(org, 'BYD Dolphin', 'EVA 1001', 'Sedan') ->> 'vehicle_id')::uuid;

select pg_temp.res('a new private gas car keeps the usual papers (registration, CTPL, emission test), nothing for hire',
  pg_temp.has((select car from t_ids), 'lto_registration') and pg_temp.has((select car from t_ids), 'emission_test')
  and not pg_temp.has((select car from t_ids), 'ltfrb_franchise') and not pg_temp.has((select car from t_ids), 'pa_insurance'), '');
update public.vehicles set fuel = 'electric' where id = (select ev from t_ids);
select pg_temp.res('fully electric: the emission test goes away (nothing was recorded for it)', not pg_temp.has((select ev from t_ids), 'emission_test'), '');
update public.vehicles set fuel = 'hybrid' where id = (select ev from t_ids);
select pg_temp.res('a hybrid needs it again', pg_temp.has((select ev from t_ids), 'emission_test'), '');
update public.vehicles set usage = 'for_hire_people' where id = (select car from t_ids);
select pg_temp.res('a taxi or TNVS car: LTFRB franchise and passenger accident insurance are added',
  pg_temp.has((select car from t_ids), 'ltfrb_franchise') and pg_temp.has((select car from t_ids), 'pa_insurance'), '');
update public.vehicles set usage = 'for_hire_goods' where id = (select car from t_ids);
select pg_temp.res('carrying goods for hire: the franchise stays, the passenger insurance goes',
  pg_temp.has((select car from t_ids), 'ltfrb_franchise') and not pg_temp.has((select car from t_ids), 'pa_insurance'), '');
update public.vehicles set usage = 'for_hire_people' where id = (select trike from t_ids);
select pg_temp.res('a tricycle for hire: the city''s tricycle franchise (MTOP), not an LTFRB franchise',
  pg_temp.has((select trike from t_ids), 'tricycle_franchise') and not pg_temp.has((select trike from t_ids), 'ltfrb_franchise') and pg_temp.has((select trike from t_ids), 'pa_insurance'), '');
update public.vehicles set transfer_pending = true where id = (select ev from t_ids);
select pg_temp.res('bought second-hand, still in the seller''s name: an LTO transfer of ownership is added',
  pg_temp.has((select ev from t_ids), 'transfer_ownership'), '');
-- something recorded is never removed
insert into public.requirement_cycles (org_id, requirement_id, reference_no)
  select org_id, id, 'PA-77' from public.requirements where vehicle_id = (select car from t_ids) and type_code = 'ltfrb_franchise' and deleted_at is null;
update public.vehicles set usage = 'private' where id = (select car from t_ids);
select pg_temp.res('back to private use: a franchise with a record is kept; the rest that no longer applies goes',
  pg_temp.has((select car from t_ids), 'ltfrb_franchise') and not pg_temp.has((select car from t_ids), 'pa_insurance'), '');
select pg_temp.res('details are checked', pg_temp.err(format($q$update public.vehicles set fuel = 'coal' where id = %L$q$, (select car from t_ids))) like '%check%', '');
select pg_temp.res('a renamed vehicle doesn''t touch its papers', pg_temp.err(format($q$update public.vehicles set make_model = 'Toyota Vios XLE' where id = %L$q$, (select car from t_ids))) = 'allowed'
  and pg_temp.has((select car from t_ids), 'emission_test'), '');
reset role;
set local pp.skip_limits = 'off';

-- ---------------------------------------------------------------- templates and the new service
select pg_temp.res('nine new templates, 17 in all', (select count(*) from public.doc_templates) = 17, (select count(*)::text from public.doc_templates));
select pg_temp.res('new templates priced like the others: letters 150, sworn 250, the deed of sale 350',
  (select string_agg(code || '=' || price_php::int, ',' order by code) from public.doc_templates where sort > 80) =
  'affidavit_of_undertaking=250,capital_declaration=250,change_notice=150,closure_affidavit=250,closure_letter=150,fsic_inspection_request=150,owner_consent=250,penalty_relief_request=150,vehicle_deed_of_sale=350',
  (select string_agg(code || '=' || price_php::int, ',' order by code) from public.doc_templates where sort > 80));
select pg_temp.res('every field in every template body is defined, and every defined field is used', not exists (
  select 1 from public.doc_templates t, regexp_matches(t.body, '\{\{([a-z0-9_]+)\}\}', 'g') m
  where not exists (select 1 from jsonb_array_elements(t.fields) f where f ->> 'key' = m[1])) and not exists (
  select 1 from public.doc_templates t, jsonb_array_elements(t.fields) f where t.sort > 80 and position('{{' || (f ->> 'key') || '}}' in t.body) = 0), '');
select pg_temp.res('sworn ones end with a jurat, deeds and consents with an acknowledgment', not exists (
  select 1 from public.doc_templates where sort > 80 and notarize and body not like '%SUBSCRIBED AND SWORN%' and body not like '%ACKNOWLEDGMENT%')
  and (select body like '%ACKNOWLEDGMENT%' from public.doc_templates where code = 'vehicle_deed_of_sale'), '');
select pg_temp.res('the penalty letter is a request, never a promise', (select body like '%decision rests with your office%' and use_when like '%request only%' from public.doc_templates where code = 'penalty_relief_request'), '');
select pg_temp.res('templates say "licenses", not "licences"', not exists (select 1 from public.doc_templates where body ~* 'licence' or summary ~* 'licence'), '');
select pg_temp.res('SEC GIS filing is on the Done for you menu, from PHP 2,500', exists (select 1 from public.services where code = 'filing_sec_gis' and active and price_from = 2500), '');
select pg_temp.res('the three new vehicle papers are in the library, none added to every vehicle', (select count(*) from public.requirement_types
  where code in ('pa_insurance', 'tricycle_franchise', 'transfer_ownership') and subject = 'vehicle' and not auto_add) = 3, '');

select n, step, ok, info from t_res order by n;
rollback;
