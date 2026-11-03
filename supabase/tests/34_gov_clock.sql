-- Database file 25: the government office and its legal clock on every order; who is responsible at each step. Rolled back.
begin;
create temp table t_res (n serial primary key, step text, ok boolean, info text);
grant all on t_res to authenticated; grant all on sequence t_res_n_seq to authenticated;
create function pg_temp.res(s text, ok boolean, info text default '') returns void language sql as
  $f$ insert into pg_temp.t_res(step, ok, info) values (s, coalesce(ok, false), coalesce(info, '')) $f$;
grant execute on function pg_temp.res(text, boolean, text) to authenticated;
create function pg_temp.err(p_sql text) returns text language plpgsql as $f$ begin execute p_sql; return 'allowed'; exception when others then return sqlerrm; end $f$;
grant execute on function pg_temp.err(text) to authenticated;
create function pg_temp.as_user(u text) returns void language plpgsql as $f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); end $f$;
create temp table t_ids (org uuid, biz uuid, mp uuid, ord uuid, ord2 uuid); grant all on t_ids to authenticated; insert into t_ids default values;

select pg_temp.res('the feature switch is on', exists (select 1 from private.features where name = 'govclock'), '');
select pg_temp.res('each online service names its government office and legal time', (select agency = 'DTI (Business Name Registration System)' and agency_days = 3 from public.services where code = 'renew_dti_business_name')
  and (select agency like 'PhilGEPS%' and agency_days = 7 from public.services where code = 'renew_philgeps'), '');
select pg_temp.res('each service promises only our part: when we file', (select turnaround like 'We file within%' from public.services where code = 'renew_philgeps'), '');
select pg_temp.res('nothing promises that Pinoy Permit follows up with offices', not exists (select 1 from pg_proc where proname in ('clock_daily','admin_start_filing','admin_mark_filed')
  and (prosrc ilike '%following up%' or prosrc ilike '%we follow up%' or prosrc ilike '%follow up today%')), '');

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at) values
 ('ed000000-0000-4000-8000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','gina@gov.ph','{"first_name":"Gina"}', now()),
 ('ed000000-0000-4000-8000-0000000000c3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ops@pp.ph','{"first_name":"Ops"}', now());
update public.profiles set is_platform_admin = true where id = 'ed000000-0000-4000-8000-0000000000c3';
set local pp.skip_limits = 'on';
select pg_temp.as_user('ed000000-0000-4000-8000-0000000000a1');
set local role authenticated;
update t_ids set org = public.create_org('Gina Trading');
update t_ids set biz = public.create_business(org, 'Gina Trading', 'Sole Proprietorship', 'retail', 'Quezon City', '1 Main St');
update t_ids set mp = (select id from public.requirements where business_id = (select biz from t_ids) and type_code = 'mayors_permit' limit 1);
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
insert into public.assistance_requests (org_id, requirement_id, requirement_name, subject_label, status, payment_status, created_by, service_code)
  select org, mp, 'DTI business name', 'Gina Trading', 'quoted', 'unpaid', 'ed000000-0000-4000-8000-0000000000a1', 'renew_dti_business_name' from t_ids;
update t_ids set ord = (select id from public.assistance_requests where org_id = (select org from t_ids) limit 1);
update public.assistance_requests set created_by = 'ed000000-0000-4000-8000-0000000000a1' where id = (select ord from t_ids);

select pg_temp.as_user('ed000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select public.accept_gov_terms(ord) from t_ids;
select pg_temp.res('the customer''s "the office is responsible after filing" is recorded with the time', (select gov_terms_at is not null from public.assistance_requests where id = (select ord from t_ids)), '');
update public.assistance_requests set agency_due_on = '2000-01-01', filed_on = '2000-01-01' where id = (select ord from t_ids);
select pg_temp.res('customers cannot change the filing dates', (select agency_due_on is null and filed_on is null from public.assistance_requests where id = (select ord from t_ids)), '');
select pg_temp.res('only staff mark an order filed', pg_temp.err(format($q$select public.admin_mark_filed(%L, 'DTI', 3, %L)$q$, (select ord from t_ids), private.today_ph())) like '%Staff only%', '');
reset role;

select pg_temp.as_user('ed000000-0000-4000-8000-0000000000c3');
set local role authenticated;
select pg_temp.res('the office is required', pg_temp.err(format($q$select public.admin_mark_filed(%L, ' ', 3, %L)$q$, (select ord from t_ids), private.today_ph())) like '%Which government office%', '');
select pg_temp.res('the day filed cannot be in the future', pg_temp.err(format($q$select public.admin_mark_filed(%L, 'DTI', 3, %L)$q$, (select ord from t_ids), private.today_ph() + 1)) like '%day it was filed%', '');
select public.admin_mark_filed(ord, 'DTI (Business Name Registration System)', 3, private.today_ph() - 1, 'BN-778812') from t_ids;
reset role;
select pg_temp.res('filed: status, office, reference and the legal deadline in working days', (select status = 'in_progress' and filed_on is not null and agency like 'DTI%' and agency_ref = 'BN-778812'
  and agency_due_on = private.add_workdays(private.today_ph() - 1, 3) from public.assistance_requests where id = (select ord from t_ids)), '');
select pg_temp.res('the order''s timeline says plainly who is responsible now', exists (select 1 from public.request_events where request_id = (select ord from t_ids)
  and message like '%Pinoy Permit''s part is done. From here, DTI (Business Name Registration System) is responsible%' and message like '%not responsible for its delays, decisions or responses%' and message not ilike '%follow up%'), '');
select pg_temp.res('the permit''s own clock starts too, naming the office', exists (select 1 from public.office_filings where requirement_id = (select mp from t_ids) and status = 'waiting'
  and office like 'DTI%' and days = 3), '');
select pg_temp.res('the customer is told, by email as well', exists (select 1 from public.notifications where user_id = 'ed000000-0000-4000-8000-0000000000a1' and title like 'Filed with DTI%')
  and exists (select 1 from public.message_outbox where user_id = 'ed000000-0000-4000-8000-0000000000a1'), '');

select n, step, ok, info from t_res order by n;
rollback;
