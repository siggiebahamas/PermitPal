-- New template and papers check prices, round numbers only, and the print-and-deliver service. Rolled back at the end.
begin;
create temp table t_res (n serial primary key, step text, ok boolean, info text);
create function pg_temp.res(s text, ok boolean, info text default '') returns void language sql as
  $f$ insert into pg_temp.t_res(step, ok, info) values (s, coalesce(ok, false), coalesce(info, '')) $f$;

select pg_temp.res('the feature switch is on', exists (select 1 from private.features where name = 'prices2'), '');
select pg_temp.res('templates: letters 350, sworn 700, SPA 1,050, Secretary''s Certificate 2,100', (select string_agg(code || '=' || price_php::int, ',' order by code) from public.doc_templates) =
  'accreditation_cover_letter=350,affidavit_of_loss=700,authorization_letter=350,certified_copy_request=350,gross_sales_declaration=700,landlord_letter=350,secretary_certificate=2100,special_power_of_attorney=1050',
  (select string_agg(code || '=' || price_php::int, ',' order by code) from public.doc_templates));
select pg_temp.res('every template price ends in 50 or 00', not exists (select 1 from public.doc_templates where price_php::int % 50 <> 0), '');
select pg_temp.res('one template on its own is PHP 350, a papers check PHP 499', (select price_php from public.load_products where code = 'template') = 350
  and (select price_php from public.load_products where code = 'papers_check') = 499, '');
select pg_temp.res('print and deliver is on the Done for you menu, from PHP 350', exists (select 1 from public.services where code = 'delivery_print' and active and price_from = 350 and category = 'document' and name like '%JoyRide%'), '');

select n, step, ok, info from t_res order by n;
rollback;
