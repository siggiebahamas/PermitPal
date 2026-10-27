-- New template and papers check prices, round numbers only, and the print-and-deliver service. Rolled back at the end.
begin;
create temp table t_res (n serial primary key, step text, ok boolean, info text);
create function pg_temp.res(s text, ok boolean, info text default '') returns void language sql as
  $f$ insert into pg_temp.t_res(step, ok, info) values (s, coalesce(ok, false), coalesce(info, '')) $f$;

select pg_temp.res('the feature switch is on', exists (select 1 from private.features where name = 'prices2'), '');
-- (database file 16 changed the template prices again; test 25 checks today's.)
select pg_temp.res('every template has a price', not exists (select 1 from public.doc_templates where price_php is null or price_php <= 0), '');
select pg_temp.res('every template price ends in 50 or 00', not exists (select 1 from public.doc_templates where price_php::int % 50 <> 0), '');
select pg_temp.res('a papers check is PHP 499', (select price_php from public.load_products where code = 'papers_check') = 499, '');
select pg_temp.res('print and deliver is on the Done for you menu, from PHP 350', exists (select 1 from public.services where code = 'delivery_print' and active and price_from = 350 and category = 'document' and name like '%JoyRide%'), '');

select n, step, ok, info from t_res order by n;
rollback;
