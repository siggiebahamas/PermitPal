-- The permit check has no DELETE or UPDATE without a WHERE (Supabase refuses those), templates have their own
-- prices and buying one charges that price, and emails show the logo. Rolled back at the end.
begin;
create temp table t_res (n serial primary key, step text, ok boolean, info text);
grant all on t_res to authenticated, anon; grant all on sequence t_res_n_seq to authenticated, anon;
create function pg_temp.res(s text, ok boolean, info text default '') returns void language sql as
  $f$ insert into pg_temp.t_res(step, ok, info) values (s, coalesce(ok, false), coalesce(info, '')) $f$;
grant execute on function pg_temp.res(text, boolean, text) to authenticated, anon;

select pg_temp.res('the feature switch is on', exists (select 1 from private.features where name = 'tplprice'), '');
select pg_temp.res('no database function deletes or updates without a WHERE', not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace, regexp_matches(p.prosrc, '((delete\s+from|update)\s+(only\s+)?[a-z_.]+[^;]*;)', 'gi') m
  where n.nspname in ('public', 'private') and m[1] !~* '\swhere\s' and m[1] !~* '^update\s+set' and m[1] !~* '^update (of|your|their|on|that)\M'),
  (select string_agg(p.proname, ', ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace, regexp_matches(p.prosrc, '((delete\s+from|update)\s+(only\s+)?[a-z_.]+[^;]*;)', 'gi') m
   where n.nspname in ('public', 'private') and m[1] !~* '\swhere\s' and m[1] !~* '^update\s+set' and m[1] !~* '^update (of|your|their|on|that)\M'));
select pg_temp.res('every template has its own price (test 24 checks the amounts)', not exists (select 1 from public.doc_templates where price_php is null), '');
select pg_temp.res('one template on its own is no longer PHP 39', (select price_php from public.load_products where code = 'template') > 39, '');
select pg_temp.res('buying a template charges its own price', (select prosrc from pg_proc where proname = 'unlock_template') like '%coalesce(t.price_php, private.load_price(''template''))%', '');
select pg_temp.res('emails show the logo from the site', private.email_html('Hi', '<p>x</p>', null, null) like '%<img src="https://%/img/wordmark.png" alt="Pinoy Permit"%', '');

select pg_temp.res('the app can read each template''s price', (select count(*) from public.template_prices() where price_php is not null) = (select count(*) from public.doc_templates), '');
-- Run the permit check for a real workspace (it uses the scratch table that used to be emptied without WHERE).
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at) values
 ('ed000000-0000-4000-8000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner@check.ph','{"first_name":"Lito"}', now());
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'ed000000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
create temp table t_org as select public.create_org('Lito Hardware') id;
reset role;
select pg_temp.res('the permit check runs for a workspace with nothing in it', (select private.run_audit(id, 'manual') from t_org) is not null or true, '');

select n, step, ok, info from t_res order by n;
rollback;
