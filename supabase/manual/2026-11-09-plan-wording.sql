-- Database file 23 (plan wording). Run once, in the Supabase SQL Editor, after file 22.
-- Plans now read "Up to 30 vehicles" instead of "16 to 30 vehicles". Any workspace can pick any plan; only the
-- maximum is enforced, as before. Wording only. All or nothing: if anything fails, nothing is changed.
begin;

do $$ declare v_prev boolean := false; v_done boolean := false; begin
  if to_regclass('private.features') is not null then
    execute $q$select exists (select 1 from private.features where name = 'push'), exists (select 1 from private.features where name = 'anysize')$q$ into v_prev, v_done;
  end if;
  if not v_prev then raise exception 'Run supabase/manual/2026-11-08-phone-alerts.sql first, then run this file. Nothing was changed.'; end if;
  if v_done then raise exception 'This file was already run. Nothing was changed.'; end if;
end $$;

-- ======================================================================== 20261109001000_plan_wording.sql
-- Database file 23: plans say how many vehicles they hold at most ("Up to 30 vehicles"), not a range. Any workspace
-- can choose any plan, whatever its fleet size: only the maximum was ever enforced (plan_limits.vehicle_limit), so
-- this changes wording only. vehicle_from (the old lower bound, shown nowhere now) is cleared.
update public.plans set features = array_replace(features, '16 to 30 vehicles', 'Up to 30 vehicles') where id = 'multi';
update public.plans set features = array_replace(features, '31 to 75 vehicles', 'Up to 75 vehicles') where id = 'fleet';
update public.plans set features = array_replace(features, '76 to 150 vehicles', 'Up to 150 vehicles') where id = 'fleet_pro';
update public.plans set features = array_replace(features, '151 or more vehicles', 'More than 150 vehicles') where id = 'enterprise';
update public.plan_limits set vehicle_from = null where code in ('multi', 'fleet', 'fleet_pro', 'enterprise');

insert into private.features (name) values ('anysize') on conflict do nothing;

commit;
