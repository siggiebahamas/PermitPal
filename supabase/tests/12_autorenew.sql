-- Year-round care without a monthly fee ("Pay per renewal"): it switches on at once with no bill, the
-- daily job still starts renewals early, each renewal is quoted at the service's usual price, nothing is
-- ever billed monthly or paused, and the guarantee stays with the All-in plan. Rolled back at the end.
begin;
create temp table t_res (n serial primary key, step text, ok boolean, info text);
grant all on t_res to authenticated, anon; grant all on sequence t_res_n_seq to authenticated, anon;
create function pg_temp.res(s text, ok boolean, info text default '') returns void language sql as
  $f$ insert into pg_temp.t_res(step, ok, info) values (s, coalesce(ok, false), coalesce(info, '')) $f$;
grant execute on function pg_temp.res(text, boolean, text) to authenticated, anon;
create temp table t_ids (org uuid, biz uuid, loc uuid, veh uuid, mp uuid, lto uuid, emi uuid, plan uuid, vplan uuid, r uuid);
grant all on t_ids to authenticated, anon; insert into t_ids default values;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at) values
 ('c1000000-0000-4000-8000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner@auto.ph','{"first_name":"Lito"}', now()),
 ('c1000000-0000-4000-8000-0000000000f4','00000000-0000-0000-0000-000000000000','authenticated','authenticated','staff@auto.ph','{"first_name":"Fe"}', now());
update public.profiles set is_platform_admin = true where id = 'c1000000-0000-4000-8000-0000000000f4';

select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
update t_ids set org = public.create_org('Lito Trading');
update t_ids set biz = public.create_business(org, 'Lito Hardware', 'Corporation', 'restaurant', 'Pasig City', '');
update t_ids set loc = (select id from public.business_locations where business_id = (select biz from t_ids) and is_main);
update t_ids set veh = (public.create_vehicle(p_org => org, p_make_model => 'Toyota Hiace', p_plate_no => 'NCR 5511', p_vehicle_type => 'Van', p_cr_no => '') ->> 'vehicle_id')::uuid;
update t_ids set mp = (select id from public.requirements where location_id = (select loc from t_ids) and type_code = 'mayors_permit'),
                 lto = (select id from public.requirements where vehicle_id = (select veh from t_ids) and type_code = 'lto_registration');
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
-- the van's emission test is due the same week as its registration
insert into public.requirements (org_id, subject, vehicle_id, type_code, name)
  select org, 'vehicle', veh, 'emission_test', 'Emission Test (CEC)' from t_ids where not exists (select 1 from public.requirements where vehicle_id = t_ids.veh and type_code = 'emission_test');
update t_ids set emi = (select id from public.requirements where vehicle_id = (select veh from t_ids) and type_code = 'emission_test');
insert into public.requirement_cycles (org_id, requirement_id, reference_no, expires_on) select org, mp, 'MP-9', private.today_ph() + 40 from t_ids;
insert into public.requirement_cycles (org_id, requirement_id, reference_no, expires_on) select org, lto, 'OR-9', private.today_ph() + 30 from t_ids;
insert into public.requirement_cycles (org_id, requirement_id, reference_no, expires_on) select org, emi, 'CEC-9', private.today_ph() + 29 from t_ids;
select pg_temp.res('test setup: a branch permit and a van with registration and emission test', (select mp is not null and lto is not null and emi is not null from t_ids), '');

select pg_temp.res('the two ways to pay exist: no monthly fee, and the All-in plan',
  (select monthly_php = 0 and not guarantee from public.care_tiers where code = 'branch_care')
  and (select monthly_php = 1200 and yearly_php = 12000 and not guarantee and guarantee_cap_php = 0 from public.care_tiers where code = 'branch_plus')
  and (select monthly_php = 0 from public.care_tiers where code = 'vehicle_care')
  and (select monthly_php = 250 and yearly_php = 2500 and not guarantee from public.care_tiers where code = 'vehicle_plus'), '');

-- ---------------------------------------------------------------- switching it on
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin perform public.start_care((select org from t_ids), jsonb_build_array(jsonb_build_object('kind','location','id',(select loc from t_ids),'tier','branch_plus')), 'per_renewal', true);
  perform pg_temp.res('the All-in plan can''t be put on pay per renewal', false, 'was allowed');
exception when others then perform pg_temp.res('the All-in plan can''t be put on pay per renewal', sqlerrm like '%has a monthly fee%', sqlerrm); end $$;
do $$ begin perform public.start_care((select org from t_ids), jsonb_build_array(jsonb_build_object('kind','location','id',(select loc from t_ids),'tier','branch_care')), 'monthly', true);
  perform pg_temp.res('pay per renewal can''t be billed monthly', false, 'was allowed');
exception when others then perform pg_temp.res('pay per renewal can''t be billed monthly', sqlerrm like '%has no monthly fee%', sqlerrm); end $$;
do $$ begin perform public.start_care((select org from t_ids), jsonb_build_array(jsonb_build_object('kind','location','id',(select loc from t_ids),'tier','branch_care')), 'weekly', true);
  perform pg_temp.res('only the three ways to pay are accepted', false, 'was allowed');
exception when others then perform pg_temp.res('only the three ways to pay are accepted', sqlerrm like 'Choose how you want to pay%', sqlerrm); end $$;
do $$ begin perform public.start_care((select org from t_ids), jsonb_build_array(jsonb_build_object('kind','location','id',(select loc from t_ids),'tier','branch_care')), 'per_renewal', false);
  perform pg_temp.res('pay per renewal still needs the consent tick', false, 'was allowed');
exception when others then perform pg_temp.res('pay per renewal still needs the consent tick', true, sqlerrm); end $$;
select pg_temp.res('switching it on returns no bill', public.start_care(org, jsonb_build_array(
  jsonb_build_object('kind','location','id',loc,'tier','branch_care'),
  jsonb_build_object('kind','vehicle','id',veh,'tier','vehicle_care')), 'per_renewal', true) is null, '') from t_ids;
update t_ids set plan = (select id from public.care_plans where location_id = (select loc from t_ids)),
                 vplan = (select id from public.care_plans where vehicle_id = (select veh from t_ids));
select pg_temp.res('both are on straight away, at ₱0, with nothing to pay',
  count(*) = 2 and bool_and(status = 'active' and started_on = private.today_ph() and price_php = 0 and paid_through is null and billing = 'per_renewal'), string_agg(status, ','))
  from public.care_plans where org_id = (select org from t_ids);
select pg_temp.res('no care bill is made', not exists (select 1 from public.care_invoices where org_id = (select org from t_ids)), '');
select pg_temp.res('the owner sees what each plan covers', (select count(*) from public.care_coverage((select org from t_ids))) >= 3, '');
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.res('the founder is told', count(*) >= 1, count(*)::text)
  from public.notifications where user_id = 'c1000000-0000-4000-8000-0000000000f4' and title like 'Year-round care started (pay per renewal)%';

-- ---------------------------------------------------------------- renewals start by themselves
select private.care_daily();
select pg_temp.res('the Mayor''s Permit and the van''s registration are started early',
  (select count(*) from public.assistance_requests where care_plan_id is not null and created_by is null and requirement_id in ((select mp from t_ids), (select lto from t_ids))) = 2, '');
select pg_temp.res('the emission test isn''t a second job: the LTO renewal includes it',
  not exists (select 1 from public.assistance_requests where requirement_id = (select emi from t_ids)), '');
select pg_temp.res('the owner is told it will be quoted at the usual price', count(*) >= 2 and bool_and(body like '%on pay per renewal: we''ll send you the exact price%'), count(*)::text)
  from public.notifications where user_id = 'c1000000-0000-4000-8000-0000000000a1' and title like 'We''ve started your%';
select pg_temp.res('the job says how it''s paid', notes like '%pay per renewal%', notes)
  from public.assistance_requests where care_plan_id = (select plan from t_ids);
select pg_temp.res('running it again starts nothing twice', private.care_daily() = 0, '');

-- ---------------------------------------------------------------- quoting
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select public.set_care_preapproval(org, 5000) from t_ids;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-0000000000f4","role":"authenticated"}', true);
set local role authenticated;
-- above the listed ₱6,000: the customer decides
select public.admin_quote_request(id, 7000, 4200, 'City assessment') from public.assistance_requests where care_plan_id = (select plan from t_ids);
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.res('a fee above the listed price waits for the customer', status = 'quoted' and accepted_at is null, status)
  from public.assistance_requests where care_plan_id = (select plan from t_ids);
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-0000000000f4","role":"authenticated"}', true);
set local role authenticated;
update public.assistance_requests set status = 'submitted' where care_plan_id = (select plan from t_ids);
select public.admin_quote_request(id, 6000, 4200, 'City assessment') from public.assistance_requests where care_plan_id = (select plan from t_ids);
select public.admin_quote_request(id, 2000, 6800, 'LTO + CTPL') from public.assistance_requests where care_plan_id = (select vplan from t_ids);
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.res('usual price and government fees within the pre-approval: accepted, waiting for payment',
  status = 'awaiting_customer' and payment_status = 'awaiting_payment' and accepted_at is not null and quote_php = 10200
  and admin_note like 'Our usual fixed fee%', status || ' ' || quote_php)
  from public.assistance_requests where care_plan_id = (select plan from t_ids);
select pg_temp.res('government fees above the pre-approval: the customer approves it', status = 'quoted' and accepted_at is null, status)
  from public.assistance_requests where care_plan_id = (select vplan from t_ids);
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-0000000000f4","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.res('the job''s fee is ours to collect, like any one-time job',
  exists (select 1 from public.admin_money(private.today_ph() - 5, private.today_ph() + 5) m
          where m.ref_id = (select id from public.assistance_requests where care_plan_id = (select plan from t_ids)) and m.kind = 'service_fee' and m.amount = 6000), '');
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;

-- ---------------------------------------------------------------- never billed, never paused
update public.care_plans set started_on = private.today_ph() - 400 where org_id = (select org from t_ids);
select private.care_daily();
select pg_temp.res('a year on: still no bill and still on', not exists (select 1 from public.care_invoices where org_id = (select org from t_ids))
  and (select bool_and(status = 'active') from public.care_plans where org_id = (select org from t_ids)), '');

-- ---------------------------------------------------------------- the guarantee stays with the All-in plan
update public.requirement_cycles set expires_on = private.today_ph() - 5 where requirement_id = (select mp from t_ids);
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin perform public.file_guarantee_claim((select plan from t_ids), (select mp from t_ids), 500, null, (select org from t_ids) || '/care/claims/r.pdf');
  perform pg_temp.res('no guarantee on pay per renewal', false, 'was allowed');
exception when others then perform pg_temp.res('no guarantee on pay per renewal', sqlerrm = 'PermitPal doesn''t pay late penalties or surcharges.', sqlerrm); end $$;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;

-- ---------------------------------------------------------------- the founder's numbers
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-0000000000f4","role":"authenticated"}', true);
set local role authenticated;
do $$ declare s jsonb := public.admin_money_summary(); begin
  perform pg_temp.res('pay-per-renewal plans are counted apart from monthly ones', (s ->> 'care_autorenew')::int >= 2
    and not exists (select 1 from public.care_plans where billing = 'per_renewal' and price_php <> 0), s ->> 'care_autorenew');
end $$;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;

-- ---------------------------------------------------------------- turning it off
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.res('turning it off ends it today (nothing prepaid to run out)', public.cancel_care(vplan, null) = private.today_ph(), '') from t_ids;
select pg_temp.res('...and it''s off', status = 'cancelled', status) from public.care_plans where id = (select vplan from t_ids);
select public.start_care(org, jsonb_build_array(jsonb_build_object('kind','vehicle','id',veh,'tier','vehicle_care')), 'per_renewal', true) from t_ids;
select pg_temp.res('it can be switched on again', count(*) = 1, count(*)::text) from public.care_plans where vehicle_id = (select veh from t_ids) and status = 'active';
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;

select n, step, ok, left(info, 90) as info from pg_temp.t_res order by n;
rollback;
