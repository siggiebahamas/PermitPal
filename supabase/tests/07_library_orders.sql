-- The fuller permit library, renewal checklists, and the done-for-you order flow from request to
-- refund. Rolled back at the end; every row should say ok = true.
begin;
create temp table t_res (n serial primary key, step text, ok boolean, info text);
grant all on t_res to authenticated, anon; grant all on sequence t_res_n_seq to authenticated, anon;
create function pg_temp.res(s text, ok boolean, info text default '') returns void language sql as
  $f$ insert into pg_temp.t_res(step, ok, info) values (s, coalesce(ok, false), coalesce(info, '')) $f$;
grant execute on function pg_temp.res(text, boolean, text) to authenticated, anon;
create temp table t_ids (org uuid, biz uuid, req uuid, brgy uuid, ord uuid, ord2 uuid, doc_path text, round1 text);
grant all on t_ids to authenticated; insert into t_ids default values;

-- ---------------------------------------------------------------- the library itself is well formed
select pg_temp.res('every checklist item has a key and a text', not exists (
  select 1 from public.requirement_types t, jsonb_array_elements(t.checklist) e
  where coalesce(e ->> 'k', '') !~ '^[a-z0-9_]{1,40}$' or length(coalesce(e ->> 't', '')) < 3), '');
select pg_temp.res('checklist keys are unique within a permit', not exists (
  select 1 from public.requirement_types t, jsonb_array_elements(t.checklist) e group by t.code, e ->> 'k' having count(*) > 1), '');
select pg_temp.res('every link is https', not exists (
  select 1 from public.requirement_types t, jsonb_array_elements(t.checklist) e where e ? 'u' and e ->> 'u' !~ '^https://'), '');
select pg_temp.res('"do this first" points at a real permit of the same kind', not exists (
  select 1 from public.requirement_types t, jsonb_array_elements(t.checklist) e
  where e ? 'dep' and not exists (select 1 from public.requirement_types d where d.code = e ->> 'dep' and d.subject = t.subject))
  and not exists (select 1 from public.requirement_types t, unnest(t.depends_on) d
    where not exists (select 1 from public.requirement_types x where x.code = d and x.subject = t.subject)), '');
select pg_temp.res('every permit has a category', not exists (select 1 from public.requirement_types where category is null),
  (select string_agg(code, ',') from public.requirement_types where category is null));
select pg_temp.res('new permits are only added when chosen', not exists (
  select 1 from public.requirement_types where code in ('fda_lto','dole_registration','bmbe_certificate','police_clearance','ltfrb_franchise') and auto_add), '');

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at) values
 ('b0000000-0000-4000-8000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','bea@t.ph','{"first_name":"Bea"}', now()),
 ('b0000000-0000-4000-8000-0000000000b2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','view@t.ph','{"first_name":"Vi"}', now()),
 ('b0000000-0000-4000-8000-0000000000c3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','out@t.ph','{"first_name":"Out"}', now()),
 ('b0000000-0000-4000-8000-0000000000f4','00000000-0000-0000-0000-000000000000','authenticated','authenticated','staff@t.ph','{"first_name":"Fo"}', now());
update public.profiles set is_platform_admin = true where id = 'b0000000-0000-4000-8000-0000000000f4';

select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
update t_ids set org = public.create_org('Bea Trading');
update t_ids set biz = public.create_business(org, 'Bea Store', 'Sole Proprietorship', 'retail', 'Taguig City', '');
update t_ids set req = (select id from public.requirements where business_id = (select biz from t_ids) and type_code = 'mayors_permit'),
                 brgy = (select id from public.requirements where business_id = (select biz from t_ids) and type_code = 'barangay_clearance');
update t_ids set doc_path = org || '/' || req || '/abc123-permit.pdf';
reset role;
insert into public.org_members (org_id, user_id, role) select org, 'b0000000-0000-4000-8000-0000000000b2', 'viewer' from t_ids;

-- ---------------------------------------------------------------- checklists
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ declare r text; begin
  r := public.set_checklist_item((select req from t_ids), 'prev', true);
  perform pg_temp.res('before any record, ticks belong to the first round', r = 'first', r);
  perform public.set_checklist_item((select req from t_ids), 'prev', true); -- twice is fine
  perform public.set_checklist_item((select req from t_ids), 'ctc', true);
  perform public.set_checklist_item((select req from t_ids), 'ctc', false);
  begin perform public.set_checklist_item((select req from t_ids), 'nonsense', true);
    perform pg_temp.res('an unknown item is refused', false, 'was allowed');
  exception when others then perform pg_temp.res('an unknown item is refused', sqlerrm like '%no longer exists%', sqlerrm); end;
  begin perform public.set_checklist_item((select req from t_ids), 'prev''; drop table x;--', true);
    perform pg_temp.res('odd item names are refused', false, 'was allowed');
  exception when others then perform pg_temp.res('odd item names are refused', true, sqlerrm); end;
  begin insert into public.checklist_progress (requirement_id, org_id, round, item) select req, org, 'first', 'pay' from t_ids;
    perform pg_temp.res('ticks can only be set through the function', false, 'insert allowed');
  exception when others then perform pg_temp.res('ticks can only be set through the function', true, sqlerrm); end;
end $$;
select pg_temp.res('ticking and unticking leaves exactly what is ticked', count(*) = 1 and min(item) = 'prev', string_agg(item, ','))
  from public.checklist_progress where requirement_id = (select req from t_ids);
-- record the permit: the checklist for next time starts empty
insert into public.requirement_cycles (org_id, requirement_id, reference_no, expires_on) select org, req, 'MP-1', private.today_ph() + 20 from t_ids;
update t_ids set round1 = public.set_checklist_item(req, 'pay', true);
select pg_temp.res('after a record exists, ticks belong to that period', round1 <> 'first' and round1 = (select cycle_id::text from public.requirement_status where id = t_ids.req), round1) from t_ids;
select pg_temp.res('the earlier round''s ticks don''t carry over', count(*) = 1,
  string_agg(item, ',')) from public.checklist_progress p, t_ids t where p.requirement_id = t.req and p.round = t.round1;
reset role;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.res('a viewer can see the ticks', count(*) >= 1, count(*)::text) from public.checklist_progress;
do $$ begin perform public.set_checklist_item((select req from t_ids), 'claim', true);
  perform pg_temp.res('a viewer cannot tick', false, 'was allowed');
exception when others then perform pg_temp.res('a viewer cannot tick', sqlerrm = 'Not allowed.', sqlerrm); end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-0000000000c3","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.res('another workspace sees no ticks', count(*) = 0, count(*)::text) from public.checklist_progress;
do $$ begin perform public.set_checklist_item((select req from t_ids), 'claim', true);
  perform pg_temp.res('another workspace cannot tick', false, 'was allowed');
exception when others then perform pg_temp.res('another workspace cannot tick', sqlerrm = 'Not allowed.', sqlerrm); end $$;
reset role;

-- ---------------------------------------------------------------- ordering the done-for-you service
insert into public.documents (org_id, requirement_id, cycle_id, file_name, storage_path, mime_type, size_bytes)
  select t.org, t.req, c.id, 'permit.pdf', t.doc_path, 'application/pdf', 100 from t_ids t join public.requirement_cycles c on c.requirement_id = t.req;

select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-0000000000f4","role":"authenticated"}', true);
set local role authenticated;
do $$ begin perform public.staff_open_file((select doc_path from t_ids));
  perform pg_temp.res('staff cannot open files before there is a request', false, 'was allowed');
exception when others then perform pg_temp.res('staff cannot open files before there is a request', true, sqlerrm); end $$;
reset role;

select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin perform public.request_service((select org from t_ids), 'renew_mayors_permit', (select req from t_ids), p_consent => false);
  perform pg_temp.res('no request without the authorization tick', false, 'was allowed');
exception when others then perform pg_temp.res('no request without the authorization tick', sqlerrm like '%tick the box%', sqlerrm); end $$;
update t_ids set ord = public.request_service(org, 'renew_mayors_permit', req, null, null, null, 'Please renew', false, 'phone', '09171234567', 'have', 'renew', true);
select pg_temp.res('the request is saved with its type and consent time', status = 'submitted' and kind = 'renew' and consented_at is not null, status || '/' || kind)
  from public.assistance_requests where id = (select ord from t_ids);
select pg_temp.res('the permit shows as being handled', status = 'in_progress' and open_request_id = (select ord from t_ids), status)
  from public.requirement_status where id = (select req from t_ids);
do $$ begin perform public.request_service((select org from t_ids), 'renew_mayors_permit', (select req from t_ids), p_consent => true);
  perform pg_temp.res('only one open request per permit', false, 'was allowed');
exception when others then perform pg_temp.res('only one open request per permit', sqlerrm like '%already have an open request%', sqlerrm); end $$;
update public.assistance_requests set kind = 'apply', consented_at = null where id = (select ord from t_ids);
select pg_temp.res('the customer cannot rewrite the type or consent', kind = 'renew' and consented_at is not null, kind)
  from public.assistance_requests where id = (select ord from t_ids);
-- applying for a permit they don't have yet
update t_ids set ord2 = public.request_service(org, 'renew_barangay_clearance', brgy, p_kind => 'apply', p_consent => true);
select pg_temp.res('a first-time application is marked as such', kind = 'apply', kind) from public.assistance_requests where id = (select ord2 from t_ids);
reset role;
select pg_temp.res('staff are told about new requests', count(*) >= 2, count(*)::text)
  from public.notifications where user_id = 'b0000000-0000-4000-8000-0000000000f4' and title like 'New request:%';

select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
set local role authenticated;
do $$ begin perform public.request_service((select org from t_ids), 'renew_fsic', null, (select biz from t_ids), p_consent => true);
  perform pg_temp.res('a viewer cannot order', false, 'was allowed');
exception when others then perform pg_temp.res('a viewer cannot order', true, sqlerrm); end $$;
reset role;

select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-0000000000f4","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.res('staff can open the permit file while the request is open', public.staff_open_file(doc_path) = 'permit.pdf', 'ok') from t_ids;
do $$ begin perform public.admin_refund_order((select ord from t_ids), 100, 'partial', 'test');
  perform pg_temp.res('no refund before payment', false, 'was allowed');
exception when others then perform pg_temp.res('no refund before payment', true, sqlerrm); end $$;
select public.admin_quote_request(ord, 2500, 4200, 'Includes filing at Taguig BPLO') from t_ids;
reset role;

select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.res('the customer sees who opened their file', count(*) = 1 and bool_and(file_name = 'permit.pdf' and reason like 'Request: %'), count(*)::text)
  from public.staff_file_access;
select pg_temp.res('the quote adds up', quote_php = 6700 and status = 'quoted', quote_php::text) from public.assistance_requests where id = (select ord from t_ids);
select public.accept_quote(ord) from t_ids;
do $$ begin perform public.submit_payment((select ord from t_ids), 'gcash', '   ');
  perform pg_temp.res('a payment needs a reference or a screenshot', false, 'was allowed');
exception when others then perform pg_temp.res('a payment needs a reference or a screenshot', true, sqlerrm); end $$;
select public.submit_payment(ord, 'gcash', 'REF1') from t_ids;
reset role;

select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-0000000000f4","role":"authenticated"}', true);
set local role authenticated;
select public.admin_confirm_payment(ord, true) from t_ids;
select pg_temp.res('a confirmed payment starts the work', status = 'in_progress' and payment_status = 'paid', status || '/' || payment_status)
  from public.assistance_requests where id = (select ord from t_ids);
select public.admin_refund_order(ord, 700, 'fee_difference', 'City fee was lower than estimated', 'gcash', 'R-1') from t_ids;
select pg_temp.res('a fee-difference refund keeps the order going', status = 'in_progress' and payment_status = 'paid', status || '/' || payment_status)
  from public.assistance_requests where id = (select ord from t_ids);
do $$ begin perform public.admin_refund_order((select ord from t_ids), 7000, 'full', 'too much');
  perform pg_temp.res('refunds are capped at what was paid', false, 'was allowed');
exception when others then perform pg_temp.res('refunds are capped at what was paid', true, sqlerrm); end $$;
select public.admin_record_renewal(ord, 'MP-2027-1', 'Taguig City', private.today_ph(), (private.today_ph() + 365), 3500) from t_ids;
reset role;
select pg_temp.res('finishing saves the new permit and closes the order',
  (select status from public.assistance_requests where id = t.ord) = 'completed'
  and (select reference_no from public.requirement_status where id = t.req) = 'MP-2027-1', '') from t_ids t;
select pg_temp.res('the new permit period starts a fresh checklist',
  not exists (select 1 from public.checklist_progress p join public.requirement_status s on s.id = p.requirement_id and p.round = s.cycle_id::text where p.requirement_id = t.req), '') from t_ids t;

select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.res('the customer sees the refund and the timeline', (select count(*) from public.order_refunds) = 1
  and (select count(*) from public.request_events where request_id = (select ord from t_ids)) >= 6,
  (select count(*) from public.request_events where request_id = (select ord from t_ids))::text);
reset role;
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-0000000000c3","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.res('another workspace sees none of it', (select count(*) from public.assistance_requests) = 0
  and (select count(*) from public.request_events) = 0 and (select count(*) from public.order_refunds) = 0, '');
do $$ begin perform public.accept_quote((select ord2 from t_ids));
  perform pg_temp.res('another workspace cannot act on the order', false, 'was allowed');
exception when others then perform pg_temp.res('another workspace cannot act on the order', true, sqlerrm); end $$;
reset role;

-- flood protection
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ declare i int; n int := 0; begin
  for i in 1..12 loop
    begin perform public.request_service((select org from t_ids), 'pkg_amendment', null, (select biz from t_ids), p_consent => true); n := n + 1;
    exception when others then exit; end;
  end loop;
  perform pg_temp.res('no more than 10 new requests an hour', n = 8, n::text || ' more allowed after 2'); -- 2 were sent above
end $$;
reset role;

select n, step, ok, left(info, 90) as info from pg_temp.t_res order by n;
rollback;
