-- Core smoke test: accounts, workspaces, starter checklists, the status engine,
-- renewals, plan limits, History, and isolation between customers.
-- Always ends in an exception so nothing is kept; read PASS/FAIL from the message.

create temp table t_results (n serial, step text, ok boolean, detail text) on commit drop;
grant insert, select on t_results to authenticated;
grant usage on sequence t_results_n_seq to authenticated;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
values ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ana@test.local','{"first_name":"Ana","last_name":"Cruz"}', now(), now(), now()),
       ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ben@test.local','{"first_name":"Ben"}', now(), now(), now());

insert into t_results (step, ok, detail) select 'profiles created by sign-up trigger', count(*) = 2, count(*)::text
  from public.profiles where id in ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222');

create temp table t_ids (org_a uuid, biz uuid, veh jsonb, org_b uuid) on commit drop;
grant all on t_ids to authenticated;
insert into t_ids default values;

-- ---------------------------------------------------------------- as Ana
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;

update t_ids set org_a = public.create_org('Aligned Solutions');
insert into t_results (step, ok, detail) select 'create_org', org_a is not null, org_a::text from t_ids;

update t_ids set biz = public.create_business(org_a, 'Corner Bakery', 'Sole Proprietorship', 'restaurant', 'Makati City', '');
insert into t_results (step, ok, detail) select 'starter checklist (restaurant, sole prop) = 6 items', count(*) = 6,
  string_agg(type_code, ',' order by type_code) from public.requirements where business_id = (select biz from t_ids);
insert into t_results (step, ok, detail) select 'new items are needs_information, never compliant (bug #1)', bool_and(status = 'needs_information'),
  string_agg(distinct status, ',') from public.requirement_status where business_id = (select biz from t_ids);

insert into public.requirement_cycles (org_id, requirement_id, reference_no, expires_on)
select r.org_id, r.id, 'MP-1', private.today_ph() + 10 from public.requirements r where r.type_code = 'mayors_permit' and r.business_id = (select biz from t_ids);
insert into t_results (step, ok, detail) select 'due in 10 days = renew_soon', status = 'renew_soon' and next_action = 'renew', status || '/' || next_action
  from public.requirement_status where type_code = 'mayors_permit' and business_id = (select biz from t_ids);

insert into public.requirement_cycles (org_id, requirement_id, reference_no)
select r.org_id, r.id, 'COR-1' from public.requirements r where r.type_code = 'bir_cor' and r.business_id = (select biz from t_ids);
insert into t_results (step, ok, detail) select 'BIR COR (no expiry) without file = upload', status = 'needs_information' and next_action = 'upload',
  status || '/' || coalesce(next_action, '-') from public.requirement_status where type_code = 'bir_cor' and business_id = (select biz from t_ids);
insert into public.documents (org_id, requirement_id, cycle_id, storage_path, file_name)
select rs.org_id, rs.id, rs.cycle_id, rs.org_id || '/' || rs.id || '/x-cor.pdf', 'cor.pdf'
  from public.requirement_status rs where rs.type_code = 'bir_cor' and rs.business_id = (select biz from t_ids);
insert into t_results (step, ok, detail) select 'BIR COR with file = compliant', status = 'compliant', status
  from public.requirement_status where type_code = 'bir_cor' and business_id = (select biz from t_ids);

insert into public.requirement_cycles (org_id, requirement_id, reference_no, expires_on)
select r.org_id, r.id, 'FSIC-1', private.today_ph() + 200 from public.requirements r where r.type_code = 'fsic' and r.business_id = (select biz from t_ids);
insert into public.documents (org_id, requirement_id, cycle_id, storage_path, file_name)
select rs.org_id, rs.id, rs.cycle_id, rs.org_id || '/' || rs.id || '/x-fsic.pdf', 'fsic.pdf'
  from public.requirement_status rs where rs.type_code = 'fsic' and rs.business_id = (select biz from t_ids);
insert into t_results (step, ok, detail) select 'FSIC with file, 200 days out = compliant', status = 'compliant', status
  from public.requirement_status where type_code = 'fsic' and business_id = (select biz from t_ids);
insert into public.requirement_cycles (org_id, requirement_id, reference_no, expires_on)
select r.org_id, r.id, 'FSIC-2', private.today_ph() + 565 from public.requirements r where r.type_code = 'fsic' and r.business_id = (select biz from t_ids);
insert into t_results (step, ok, detail) select 'renewed without new file is NOT compliant (bug #2)', status = 'needs_information' and next_action = 'upload',
  status || '/' || coalesce(next_action, '-') from public.requirement_status where type_code = 'fsic' and business_id = (select biz from t_ids);
insert into t_results (step, ok, detail) select 'old record kept as history', count(*) = 2, count(*)::text
  from public.requirement_cycles c join public.requirements r on r.id = c.requirement_id where r.type_code = 'fsic' and r.business_id = (select biz from t_ids);

update public.requirements set renewal_started_at = now() where type_code = 'mayors_permit' and business_id = (select biz from t_ids);
insert into t_results (step, ok, detail) select 'renewal started = in_progress (bug #3)', status = 'in_progress' and next_action = 'record_renewal', status
  from public.requirement_status where type_code = 'mayors_permit' and business_id = (select biz from t_ids);
insert into public.requirement_cycles (org_id, requirement_id, reference_no, expires_on)
select r.org_id, r.id, 'MP-2', private.today_ph() + 375 from public.requirements r where r.type_code = 'mayors_permit' and r.business_id = (select biz from t_ids);
insert into t_results (step, ok, detail) select 'recording the renewal clears in_progress', status = 'needs_information' and renewal_started_at is null, status
  from public.requirement_status where type_code = 'mayors_permit' and business_id = (select biz from t_ids);

do $$ begin
  perform public.create_business((select org_a from t_ids), 'Second Biz', 'Corporation', 'retail', '', '');
  insert into t_results (step, ok, detail) values ('Free plan blocks a 2nd business', false, 'was allowed');
exception when others then
  insert into t_results (step, ok, detail) values ('Free plan blocks a 2nd business', sqlerrm like 'The Free plan includes 1 business.%', sqlerrm);
end $$;

do $$ begin
  perform public.add_location((select biz from t_ids), 'Cebu branch', 'Cebu City', '');
  insert into t_results (step, ok, detail) values ('Free plan blocks a 2nd branch', false, 'was allowed');
exception when others then
  insert into t_results (step, ok, detail) values ('Free plan blocks a 2nd branch', sqlerrm like '%branch per business%', sqlerrm);
end $$;

update t_ids set veh = public.create_vehicle(org_a, 'Isuzu Elf', 'ngv 5588', 'Van', 'CR-1', null, 'OR-1', private.today_ph() - 3, 'Malayan', 'POL-9', private.today_ph() + 45);
insert into t_results (step, ok, detail) select 'vehicle gets 4 requirements; overdue registration = action_required', count(*) = 4
  and bool_or(type_code = 'lto_registration' and status = 'action_required'),
  string_agg(type_code || ':' || status, ',' order by type_code) from public.requirement_status where vehicle_id = ((select veh from t_ids)->>'vehicle_id')::uuid;
insert into t_results (step, ok, detail) select 'plate stored uppercase', plate_no = 'NGV 5588', plate_no from public.vehicles where id = ((select veh from t_ids)->>'vehicle_id')::uuid;

do $$ begin
  insert into public.requirements (org_id, subject, business_id, location_id, type_code, name)
  select org_id, 'business', business_id, location_id, type_code, name from public.requirements where type_code = 'mayors_permit' and business_id = (select biz from t_ids);
  insert into t_results (step, ok, detail) values ('duplicate requirement blocked', false, 'was allowed');
exception when unique_violation then
  insert into t_results (step, ok, detail) values ('duplicate requirement blocked', true, 'unique_violation');
end $$;

update public.businesses set deleted_at = now() where id = (select biz from t_ids);
insert into t_results (step, ok, detail) select 'deleted business hides its requirements', count(*) = 0, count(*)::text
  from public.requirement_status where business_id = (select biz from t_ids);
update public.businesses set deleted_at = null where id = (select biz from t_ids);
insert into t_results (step, ok, detail) select 'restore brings them back', count(*) = 6, count(*)::text
  from public.requirement_status where business_id = (select biz from t_ids);

insert into t_results (step, ok, detail) select 'History written by triggers', count(*) >= 8, string_agg(summary, ' | ' order by id)
  from public.audit_log where org_id = (select org_a from t_ids);

-- ---------------------------------------------------------------- as Ben (another customer)
reset role;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
set local role authenticated;

insert into t_results (step, ok, detail) select 'Ben sees none of Ana''s businesses', count(*) = 0, count(*)::text from public.businesses;
insert into t_results (step, ok, detail) select 'Ben sees none of Ana''s statuses', count(*) = 0, count(*)::text from public.requirement_status;
insert into t_results (step, ok, detail) select 'Ben sees none of Ana''s history', count(*) = 0, count(*)::text from public.audit_log;
insert into t_results (step, ok, detail) select 'Ben sees only his own profile', count(*) = 1, count(*)::text from public.profiles;
do $$ begin
  insert into public.businesses (org_id, name) values ((select org_a from t_ids), 'Hack');
  insert into t_results (step, ok, detail) values ('Ben cannot write into Ana''s workspace', false, 'was allowed');
exception when others then
  insert into t_results (step, ok, detail) values ('Ben cannot write into Ana''s workspace', true, sqlerrm);
end $$;
do $$ begin
  update public.profiles set is_platform_admin = true where id = '22222222-2222-2222-2222-222222222222';
  insert into t_results (step, ok, detail) values ('Ben cannot make himself admin', false, 'was allowed');
exception when others then
  insert into t_results (step, ok, detail) values ('Ben cannot make himself admin', true, sqlerrm);
end $$;
do $$ begin
  update public.orgs set plan_id = 'business_plus' where id in (select private.my_org_ids());
  insert into t_results (step, ok, detail) values ('Ben cannot upgrade his own plan', false, 'was allowed');
exception when others then
  insert into t_results (step, ok, detail) values ('Ben cannot upgrade his own plan', true, sqlerrm);
end $$;
update t_ids set org_b = public.create_org('Ben Co');
do $$ begin
  insert into public.requirements (org_id, subject, business_id, name) values ((select org_b from t_ids), 'business', (select biz from t_ids), 'x');
  insert into t_results (step, ok, detail) values ('Ben cannot attach records to Ana''s business', false, 'was allowed');
exception when others then
  insert into t_results (step, ok, detail) values ('Ben cannot attach records to Ana''s business', true, sqlerrm);
end $$;

reset role;
do $$
declare v text;
begin
  select string_agg(case when ok then 'PASS ' else 'FAIL ' end || step || case when ok then '' else ' -> ' || coalesce(detail, '') end, E'\n' order by n)
    into v from t_results;
  raise exception E'TEST RESULTS (rolled back)\n%', v;
end $$;
