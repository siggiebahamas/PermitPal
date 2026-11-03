-- Database file 23: plans say how many vehicles they hold at most ("Up to 30 vehicles"), not a range. Any workspace
-- can choose any plan, whatever its fleet size: only the maximum was ever enforced (plan_limits.vehicle_limit), so
-- this changes wording only. vehicle_from (the old lower bound, shown nowhere now) is cleared.
update public.plans set features = array_replace(features, '16 to 30 vehicles', 'Up to 30 vehicles') where id = 'multi';
update public.plans set features = array_replace(features, '31 to 75 vehicles', 'Up to 75 vehicles') where id = 'fleet';
update public.plans set features = array_replace(features, '76 to 150 vehicles', 'Up to 150 vehicles') where id = 'fleet_pro';
update public.plans set features = array_replace(features, '151 or more vehicles', 'More than 150 vehicles') where id = 'enterprise';
update public.plan_limits set vehicle_from = null where code in ('multi', 'fleet', 'fleet_pro', 'enterprise');

insert into private.features (name) values ('anysize') on conflict do nothing;
