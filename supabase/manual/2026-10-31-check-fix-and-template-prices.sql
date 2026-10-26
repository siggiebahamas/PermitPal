-- Fixes the blank Permit check page ("DELETE requires a WHERE clause"), gives each template its own price
-- (PHP 99 letters, PHP 149 sworn statements, PHP 199 Special Power of Attorney, PHP 249 Secretary's Certificate),
-- and puts the sticker logo at the top of every email.
-- All or nothing: if anything fails, nothing is changed.
--
-- Order matters: run 2026-10-30-payment-qr.sql first, then this file, once.
begin;

do $$ declare v_prev boolean := false; v_done boolean := false; begin
  if to_regclass('private.features') is not null then
    execute $q$select exists (select 1 from private.features where name = 'payqr'), exists (select 1 from private.features where name = 'tplprice')$q$ into v_prev, v_done;
  end if;
  if not v_prev then raise exception 'Run supabase/manual/2026-10-30-payment-qr.sql first, then run this file. Nothing was changed.'; end if;
  if v_done then raise exception 'This file was already run. Nothing was changed.'; end if;
end $$;

-- ======================================================================== 20261031001000_check_fix_template_prices.sql
-- 1) The permit check works on the live project. Supabase refuses a DELETE without a WHERE clause
--    ("DELETE requires a WHERE clause"), and the check emptied its scratch table that way, so the Permit check
--    page stayed blank. The statement now says "where true"; nothing else about the check changes.
-- 2) Each template has its own price, set from what the same paper costs elsewhere: a short letter less than a
--    sworn statement, a Secretary's Certificate the most. Plus still includes every template.
-- 3) Every email shows the sticker logo (the image on the website) at the top instead of plain text.
do $$ declare v_def text; begin
  v_def := pg_get_functiondef('private.run_audit(uuid,text)'::regprocedure);
  if v_def like '%delete from pp_audit_now;%' then
    execute replace(v_def, 'delete from pp_audit_now;', 'delete from pp_audit_now where true;');
  end if;
end $$;

alter table public.doc_templates add column if not exists price_php numeric(10,2) check (price_php is null or price_php between 0 and 100000);
update public.doc_templates set price_php = case code
  when 'authorization_letter' then 99
  when 'certified_copy_request' then 99
  when 'landlord_letter' then 99
  when 'accreditation_cover_letter' then 99
  when 'affidavit_of_loss' then 149
  when 'gross_sales_declaration' then 149
  when 'special_power_of_attorney' then 199
  when 'secretary_certificate' then 249
  else price_php end;
-- A template without its own price uses the "One template" price, now PHP 99.
update public.load_products set price_php = 99 where code = 'template' and price_php = 39;

do $$ declare v_def text; begin
  v_def := pg_get_functiondef('public.unlock_template(uuid,text)'::regprocedure);
  if v_def like '%v_price := private.load_price(''template'');%' then
    execute replace(v_def, 'v_price := private.load_price(''template'');', 'v_price := coalesce(t.price_php, private.load_price(''template''));');
  end if;
end $$;

do $$ declare v_def text; begin
  v_def := pg_get_functiondef('private.email_html(text,text,text,text)'::regprocedure);
  v_def := replace(v_def,
    '''<div style="font-size:22px;font-weight:800;margin-bottom:16px"><span style="color:#0C2A57">Pinoy</span> <span style="color:#2F6FED">Permit</span></div>''',
    '''<div style="margin-bottom:16px"><img src="'' || private.html_escape(coalesce(private.setting(''app_url''), '''')) || ''img/wordmark.png" alt="Pinoy Permit" height="52" style="height:52px;width:auto;display:block;border:0"></div>''');
  execute v_def;
end $$;

-- The templates page shows each template's price.
create or replace function public.template_prices() returns table (code text, price_php numeric)
language sql stable security definer set search_path = '' as $$
  select t.code, t.price_php from public.doc_templates t
$$;
revoke all on function public.template_prices() from public, anon;
grant execute on function public.template_prices() to authenticated;

insert into private.features (name) values ('tplprice') on conflict do nothing;

commit;
