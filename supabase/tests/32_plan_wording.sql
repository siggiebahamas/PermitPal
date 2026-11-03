-- Database file 23: plan wording ("Up to N vehicles"), and any plan can be chosen at any fleet size. Rolled back.
begin;
create temp table t_res (n serial primary key, step text, ok boolean, info text);
create function pg_temp.res(s text, ok boolean, info text default '') returns void language sql as
  $f$ insert into pg_temp.t_res(step, ok, info) values (s, coalesce(ok, false), coalesce(info, '')) $f$;
select pg_temp.res('the feature switch is on', exists (select 1 from private.features where name = 'anysize'), '');
select pg_temp.res('Multi-Vehicle says up to 30', (select features from public.plans where id = 'multi') @> array['Up to 30 vehicles'], '');
select pg_temp.res('Fleet says up to 75', (select features from public.plans where id = 'fleet') @> array['Up to 75 vehicles'], '');
select pg_temp.res('Fleet Pro says up to 150', (select features from public.plans where id = 'fleet_pro') @> array['Up to 150 vehicles'], '');
select pg_temp.res('no plan shows a minimum any more', not exists (select 1 from public.plans where array_to_string(features, '|') ~ '\d+ to \d+ vehicles'), '');
select pg_temp.res('no lower bound is kept', not exists (select 1 from public.plan_limits where vehicle_from is not null and code in ('multi','fleet','fleet_pro','enterprise')), '');
select pg_temp.res('only the maximum is enforced (Fleet Pro: 150, no minimum column used)', (select vehicle_limit from public.plan_limits where code = 'fleet_pro') = 150
  and not exists (select 1 from pg_proc where proname = 'check_record_room' and prosrc like '%vehicle_from%'), '');
select n, step, ok, info from t_res order by n;
rollback;
