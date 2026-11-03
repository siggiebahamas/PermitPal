-- Database file 24: text reminders off; plan payments carry their proof and show "checking", then "confirmed". Rolled back.
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
create temp table t_ids (org uuid, pay uuid, pay2 uuid); grant all on t_ids to authenticated; insert into t_ids default values;

-- 1) no text reminders
select pg_temp.res('the text switch is off', not exists (select 1 from private.features where name = 'sms'), '');
select pg_temp.res('no plan promises text reminders', not exists (select 1 from public.plans where array_to_string(features, '|') ~* 'text message|sms'), '');
select pg_temp.res('text packs are not on sale', not exists (select 1 from public.load_products where code like 'texts\_%' and active), '');

-- 2) proof of payment
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at) values
 ('ec000000-0000-4000-8000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner@pay.ph','{"first_name":"Paz"}', now()),
 ('ec000000-0000-4000-8000-0000000000b2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','staff@pay.ph','{"first_name":"Sam"}', now()),
 ('ec000000-0000-4000-8000-0000000000c3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','boss@pp.ph','{"first_name":"Ops"}', now());
update public.profiles set is_platform_admin = true where id = 'ec000000-0000-4000-8000-0000000000c3';
set local pp.skip_limits = 'on';
select pg_temp.as_user('ec000000-0000-4000-8000-0000000000a1');
set local role authenticated;
update t_ids set org = public.create_org('Paz Hauling');
reset role;
insert into public.org_members (org_id, user_id, role) select org, 'ec000000-0000-4000-8000-0000000000b2', 'member' from t_ids;

select pg_temp.as_user('ec000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select pg_temp.res('a reference or a screenshot is needed', pg_temp.err(format($q$select public.plan_payment_report(%L, 'fleet', 12, 'gcash', '')$q$, (select org from t_ids))) like '%reference number or a screenshot%', '');
select pg_temp.res('a screenshot must be in the workspace''s own folder', pg_temp.err(format($q$select public.plan_payment_report(%L, 'fleet', 12, 'gcash', null, 'someone/else.png')$q$, (select org from t_ids))) like '%Invalid file%', '');
select pg_temp.res('only 1 or 12 months', pg_temp.err(format($q$select public.plan_payment_report(%L, 'fleet', 5, 'gcash', '123')$q$, (select org from t_ids))) like '%1 month or 12%', '');
update t_ids set pay = public.plan_payment_report(org, 'fleet', 12, 'gcash', '1009 234 567890', org || '/payments/x-gcash.png', 'gcash.png');
select pg_temp.res('the owner reports a yearly Fleet payment: pay 10 months, get 12', (select amount_php from public.payments where id = (select pay from t_ids)) = 10 * (select price_php_monthly from public.plans where id = 'fleet'), '');
select pg_temp.res('they see it right away, waiting to be checked, with their proof', (select status = 'pending' and reference = '1009 234 567890' and proof_name = 'gcash.png' from public.payments where id = (select pay from t_ids)), '');
select pg_temp.res('reporting never turns the plan on by itself', (select plan_id is distinct from 'fleet' from public.orgs where id = (select org from t_ids)), '');
reset role;
select pg_temp.res('staff are told', exists (select 1 from public.notifications n join public.profiles p on p.id = n.user_id where p.is_platform_admin and n.title like 'Plan payment to confirm: Fleet%'), '');

select pg_temp.as_user('ec000000-0000-4000-8000-0000000000b2');
set local role authenticated;
select pg_temp.res('a regular member cannot report payments', pg_temp.err(format($q$select public.plan_payment_report(%L, 'fleet', 1, 'gcash', '1')$q$, (select org from t_ids))) like '%owner or an admin%', '');
select pg_temp.res('nor see them', not exists (select 1 from public.payments), '');
reset role;

select pg_temp.as_user('ec000000-0000-4000-8000-0000000000c3');
set local role authenticated;
update t_ids set pay2 = public.admin_record_plan_payment(org, 'fleet', 12, 10 * (select price_php_monthly from public.plans where id = 'fleet'), 'gcash', null, null);
reset role;
select pg_temp.res('staff confirm the same row: no duplicate', (select pay = pay2 from t_ids) and (select count(*) from public.payments where org_id = (select org from t_ids)) = 1, '');
select pg_temp.res('it is now confirmed, with the customer''s reference kept', (select status = 'paid' and paid_at is not null and reference = '1009 234 567890' from public.payments where id = (select pay from t_ids)), '');
select pg_temp.res('and the plan is on for 12 months', (select plan_id = 'fleet' and plan_expires_at > now() + interval '11 months' from public.orgs where id = (select org from t_ids)), '');
select pg_temp.res('the owner hears it is in, pointing to Settings > Plan', exists (select 1 from public.notifications where user_id = 'ec000000-0000-4000-8000-0000000000a1' and title like 'Payment received%' and body like '%Settings > Plan%'), '');
select pg_temp.as_user('ec000000-0000-4000-8000-0000000000c3');
set local role authenticated;
select public.admin_record_plan_payment(org, 'fleet', 1, (select price_php_monthly from public.plans where id = 'fleet'), 'bank_transfer', 'BT-1', null) from t_ids;
reset role;
select pg_temp.res('a payment nobody reported is added as a new row, as before', (select count(*) from public.payments where org_id = (select org from t_ids) and status = 'paid') = 2, '');
select pg_temp.res('the feature switch is on', exists (select 1 from private.features where name = 'payproof'), '');

select n, step, ok, info from t_res order by n;
rollback;
