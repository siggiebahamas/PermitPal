-- Yearly team plans: 12 months cost 10 (2 months free); other lengths cost what they say. Rolled back at the end.
begin;
create temp table t_res (n serial primary key, step text, ok boolean, info text);
grant all on t_res to authenticated; grant all on sequence t_res_n_seq to authenticated;
create function pg_temp.res(s text, ok boolean, info text default '') returns void language sql as
  $f$ insert into pg_temp.t_res(step, ok, info) values (s, coalesce(ok, false), coalesce(info, '')) $f$;
grant execute on function pg_temp.res(text, boolean, text) to authenticated;
create temp table t_ids (org uuid); grant all on t_ids to authenticated; insert into t_ids default values;
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at) values
 ('f1000000-0000-4000-8000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner@yearly.ph','{"first_name":"Yna"}', now()),
 ('f1000000-0000-4000-8000-0000000000b2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin@yearly.ph','{"first_name":"Ben"}', now());
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
update t_ids set org = public.create_org('Yna Accounting');
update public.orgs set kind = 'firm' where id = (select org from t_ids);
select pg_temp.res('a year of the firm plan costs 10 months (₱19,900), 2 months free',
  (r ->> 'amount_php')::numeric = 19900 and (r ->> 'months')::int = 12 and (r ->> 'months_free')::int = 2, r::text)
  from (select public.billing_start(org, 'firm', 12) r from t_ids) x;
select pg_temp.res('one month costs one month', (public.billing_start(org, 'firm', 1) ->> 'amount_php')::numeric = 1990, '') from t_ids;
select pg_temp.res('3 months cost 3 months', (public.billing_start(org, 'fleet', 3) ->> 'amount_php')::numeric = 4470, '') from t_ids;
select pg_temp.res('the property plan for a year: ₱99,900', (public.billing_start(org, 'property', 12) ->> 'amount_php')::numeric = 99900, '') from t_ids;
select pg_temp.res('the payment row keeps 12 months for that price', exists (select 1 from public.payments where org_id = (select org from t_ids) and plan_id = 'firm' and months = 12 and amount_php = 19900), '');
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
insert into public.org_members (org_id, user_id, role) select org, 'f1000000-0000-4000-8000-0000000000b2', 'admin' from t_ids;
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
set local role authenticated;
do $$ begin perform public.billing_start((select org from t_ids), 'firm', 12); perform pg_temp.res('only the owner pays for the plan', false, 'was allowed');
exception when others then perform pg_temp.res('only the owner pays for the plan', sqlerrm = 'Only the workspace owner can change the plan.', sqlerrm); end $$;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
-- the payment goes through: the plan runs 12 months
update public.payments set checkout_id = 'cs_test_year' where org_id = (select org from t_ids) and months = 12 and plan_id = 'firm';
select public.billing_mark_paid('cs_test_year', '{}'::jsonb);
select pg_temp.res('paid: the plan runs for 12 months', (select plan_id = 'firm' and (plan_expires_at at time zone 'Asia/Manila')::date between (now() at time zone 'Asia/Manila')::date + 360 and (now() at time zone 'Asia/Manila')::date + 370
  from public.orgs where id = (select org from t_ids)), '');
select pg_temp.res('the feature switch is on', exists (select 1 from private.features where name = 'yearly'), '');
select n, step, ok, left(info, 90) as info from pg_temp.t_res order by n;
rollback;
