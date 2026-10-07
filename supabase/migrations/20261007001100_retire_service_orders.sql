-- Done-for-you service orders were retired (PermitPal no longer files with government offices;
-- customers request quotes from licensed professionals instead). Tables are kept for history;
-- nobody can call the order functions anymore.
do $$ declare f text; begin
  foreach f in array array[
    'public.accept_quote(uuid)', 'public.add_order_message(uuid,text,text,text)', 'public.submit_payment(uuid,text,text,text,text)',
    'public.order_payment_start(uuid)', 'public.admin_quote_request(uuid,numeric,numeric,text)', 'public.admin_confirm_payment(uuid,boolean,text)',
    'public.admin_update_order(uuid,text,text,text,text,numeric,text)', 'public.admin_refund_order(uuid,numeric,text,text,text,text)',
    'public.staff_open_file(text)', 'public.list_partners()',
    'public.admin_record_renewal(uuid,text,text,date,date,numeric,text,text,text,bigint)'] loop
    if to_regprocedure(f) is not null then execute format('revoke execute on function %s from public, anon, authenticated', f); end if;
  end loop;
  if to_regproc('public.request_service') is not null then
    execute (select string_agg(format('revoke execute on function %s from public, anon, authenticated', p.oid::regprocedure), '; ')
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'request_service');
  end if;
end $$;
