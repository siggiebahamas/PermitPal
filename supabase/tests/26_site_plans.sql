-- Plan names for anyone who looks after many sites (database file 17). Rolled back at the end.
begin;
create temp table t_res (n serial primary key, step text, ok boolean, info text);
create function pg_temp.res(s text, ok boolean, info text default '') returns void language sql as
  $f$ insert into pg_temp.t_res(step, ok, info) values (s, coalesce(ok, false), coalesce(info, '')) $f$;

select pg_temp.res('the feature switch is on', exists (select 1 from private.features where name = 'sites'), '');
select pg_temp.res('property_s is now called Multi-Site, same price', (select name = 'Multi-Site' and price_php_monthly = 2990 from public.plans where id = 'property_s'), '');
select pg_temp.res('property is now called Multi-Site Unlimited, same price', (select name = 'Multi-Site Unlimited' and price_php_monthly = 9990 from public.plans where id = 'property'), '');
select pg_temp.res('the plan limits use the new names', (select count(*) = 2 from public.plan_limits where (code, name) in (('property_s', 'Multi-Site'), ('property', 'Multi-Site Unlimited'))), '');
select pg_temp.res('the 20-site cap is unchanged', (select prosrc like '%20%' from pg_proc where proname = 'tenant_cap'), '');
select pg_temp.res('no database message uses the old names', not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and (p.prosrc like '%Small property%' or p.prosrc like '%Mall & property%')), '');
select pg_temp.res('the messages use the new names', exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.prosrc like '%Multi-Site covers up to 20: choose Multi-Site Unlimited%'), '');
select pg_temp.res('functions keep their grants (billing start still callable by signed-in users)',
  exists (select 1 from pg_proc where proname = 'billing_start' and has_function_privilege('authenticated', oid, 'execute')), '');

select n, step, ok, info from t_res order by n;
rollback;
