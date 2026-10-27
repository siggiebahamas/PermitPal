-- New prices and a delivery service.
-- 1) Templates cost about 70% of having the same paper drafted elsewhere (a lawyer charges roughly PHP 500 for a
--    simple letter, PHP 500-2,000 for an affidavit, more for an SPA or a Secretary's Certificate), in round numbers:
--    letters PHP 350, sworn statements PHP 700, Special Power of Attorney PHP 1,050, Secretary's Certificate PHP 2,100.
-- 2) A papers check is PHP 499.
-- 3) "Print and deliver": we print papers (a template, a permit copy, a receipt) and send them by JoyRide or a
--    similar motorbike courier. Quoted per job like every done-for-you service, from PHP 350 in Metro Manila.
update public.doc_templates set price_php = case code
  when 'authorization_letter' then 350
  when 'certified_copy_request' then 350
  when 'landlord_letter' then 350
  when 'accreditation_cover_letter' then 350
  when 'affidavit_of_loss' then 700
  when 'gross_sales_declaration' then 700
  when 'special_power_of_attorney' then 1050
  when 'secretary_certificate' then 2100
  else price_php end;
update public.load_products set price_php = 350 where code = 'template';
update public.load_products set price_php = 499 where code = 'papers_check';

insert into public.services (code, name, category, summary, includes, price_from, price_unit, turnaround, applies_to, sort, active)
values ('delivery_print', 'Print and deliver (JoyRide)', 'document',
  'We print your papers (a template, a permit copy, a receipt) and send them to your door by JoyRide or a similar motorbike courier. Tell us the address; you get the exact price first.',
  array['Printed on clean paper, in the right number of copies', 'Sent by motorbike courier, with the rider''s details', 'Same or next business day in Metro Manila'],
  350, 'per delivery in Metro Manila; farther is quoted', 'Same or next business day', 'any', 320, true)
on conflict (code) do nothing;

insert into private.features (name) values ('prices2') on conflict do nothing;
