-- Pinoy Permit load: top-ups (by transfer and online), text packs and how texts use them, templates one at a time,
-- papers checks (asking, photos, staff answering, cancelling, refunds, late answers), the renewal season pass,
-- inviting a business, staff gifts and pay-backs, money views and who can see what. Rolled back at the end.
begin;
-- This test checks how load works with the original prices; test 24 checks today's prices.
update public.load_products set price_php = case code when 'template' then 39 when 'papers_check' then 149 else price_php end;
update public.doc_templates set price_php = 99 where code = 'authorization_letter';
create temp table t_res (n serial primary key, step text, ok boolean, info text);
grant all on t_res to authenticated, anon; grant all on sequence t_res_n_seq to authenticated, anon;
create function pg_temp.res(s text, ok boolean, info text default '') returns void language sql as
  $f$ insert into pg_temp.t_res(step, ok, info) values (s, coalesce(ok, false), coalesce(info, '')) $f$;
grant execute on function pg_temp.res(text, boolean, text) to authenticated, anon;
create function pg_temp.err(p_sql text) returns text language plpgsql as $f$ begin execute p_sql; return 'allowed'; exception when others then return sqlerrm; end $f$;
grant execute on function pg_temp.err(text) to authenticated, anon;
create function pg_temp.as_user(u text) returns void language plpgsql as $f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); end $f$;
create temp table t_ids (org uuid, biz uuid, mp uuid, fsic uuid, team uuid, neworg uuid, own2 uuid, top1 uuid, top2 uuid, top3 uuid, chk uuid, chk2 uuid,
  pass uuid, pay uuid, code text, doc text);
grant all on t_ids to authenticated, anon; insert into t_ids default values;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at) values
 ('e9000000-0000-4000-8000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner@load.ph','{"first_name":"Sadie"}', now()),
 ('e9000000-0000-4000-8000-0000000000b2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','member@load.ph','{"first_name":"Mio"}', now()),
 ('e9000000-0000-4000-8000-0000000000c3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','other@load.ph','{"first_name":"Oscar"}', now()),
 ('e9000000-0000-4000-8000-0000000000d4','00000000-0000-0000-0000-000000000000','authenticated','authenticated','new@load.ph','{"first_name":"Nina"}', now()),
 ('e9000000-0000-4000-8000-0000000000f5','00000000-0000-0000-0000-000000000000','authenticated','authenticated','staff@load.ph','{"first_name":"Fely"}', now());
update public.profiles set is_platform_admin = true where id = 'e9000000-0000-4000-8000-0000000000f5';
update private.settings set value = '{}' where key = 'channel_status';
delete from public.message_outbox;

select pg_temp.res('the feature switch is on', exists (select 1 from private.features where name = 'load'), '');
select pg_temp.res('prices: 50 texts ₱49, 200 texts ₱179, a template ₱39, a papers check ₱149, the season pass ₱149',
  (select string_agg(code || '=' || price_php::int, ',' order by sort) from public.load_products) = 'texts_50=49,texts_200=179,template=39,papers_check=149,season_pass=149',
  (select string_agg(code || '=' || price_php::int, ',' order by sort) from public.load_products));
select pg_temp.res('the next business day ends at 6 pm Manila time (Friday afternoon answers Monday)',
  private.next_business_6pm('2026-10-23 15:00+08') = '2026-10-26 18:00+08' and private.next_business_6pm('2026-10-21 23:30+08') = '2026-10-22 18:00+08'
  and private.next_business_6pm('2026-10-24 10:00+08') = '2026-10-26 18:00+08', private.next_business_6pm('2026-10-23 15:00+08')::text);
select pg_temp.res('the season pass sells September to January for the next January',
  private.season_for('2026-09-01') = 2027 and private.season_for('2026-12-31') = 2027 and private.season_for('2027-01-31') = 2027
  and private.season_for('2027-02-01') is null and private.season_for('2026-08-31') is null, '');

-- ---------------------------------------------------------------- set-up: a business, a teammate, someone else, a team workspace
select pg_temp.as_user('e9000000-0000-4000-8000-0000000000a1');
set local role authenticated;
update t_ids set org = public.create_org('Sadie Foods');
update t_ids set biz = public.create_business(org, 'Sadie''s Kitchen', 'Corporation', 'restaurant', 'Pasig City', '12 Shaw Blvd');
update t_ids set mp = (select id from public.requirements where business_id = (select biz from t_ids) and type_code = 'mayors_permit' limit 1),
  fsic = (select id from public.requirements where business_id = (select biz from t_ids) and type_code = 'fsic' limit 1);
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
insert into public.org_members (org_id, user_id, role) select org, 'e9000000-0000-4000-8000-0000000000b2', 'member' from t_ids;
insert into public.requirement_cycles (org_id, requirement_id, reference_no, issued_on, expires_on) select org, mp, 'MP-1', private.today_ph() - 360, private.today_ph() + 5 from t_ids;
insert into public.documents (org_id, requirement_id, cycle_id, storage_path, file_name, mime_type, size_bytes)
  select org, mp, (select cycle_id from public.requirement_status where id = (select mp from t_ids)), org || '/' || mp || '/abcdef12-mp.jpg', 'mp.jpg', 'image/jpeg', 1000 from t_ids;
update t_ids set doc = org || '/' || mp || '/abcdef12-mp.jpg';
select pg_temp.as_user('e9000000-0000-4000-8000-0000000000c3');
set local role authenticated;
update t_ids set team = public.create_org('Oscar Fleet');
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
update public.orgs set kind = 'fleet', plan_id = 'fleet', plan_expires_at = now() + interval '30 days', trial_ends_at = now() - interval '1 day' where id = (select team from t_ids);

-- ---------------------------------------------------------------- topping up
select pg_temp.as_user('e9000000-0000-4000-8000-0000000000b2');
set local role authenticated;
select pg_temp.res('a teammate who isn''t an admin can''t top up', pg_temp.err(format('select public.load_topup_start(%L, 500)', (select org from t_ids))) like 'Only the workspace owner or an admin%', '');
select pg_temp.res('...but sees the balance (₱0)', (select (public.load_summary(org) ->> 'total')::numeric = 0 and not (public.load_summary(org) ->> 'can_spend')::boolean from t_ids), '');
reset role;
select pg_temp.as_user('e9000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select pg_temp.res('amounts are ₱100 to ₱5,000 in steps of ₱50',
  pg_temp.err(format('select public.load_topup_start(%L, 50)', (select org from t_ids))) like 'Choose an amount%'
  and pg_temp.err(format('select public.load_topup_start(%L, 125)', (select org from t_ids))) like 'Choose an amount%'
  and pg_temp.err(format('select public.load_topup_start(%L, 6000)', (select org from t_ids))) like 'Choose an amount%', '');
update t_ids set top1 = public.load_topup_start(org, 200);
update t_ids set top2 = public.load_topup_start(org, 500);
select pg_temp.res('a new top-up replaces one nobody paid', (select status from public.load_topups where id = (select top1 from t_ids)) = 'cancelled'
  and (select status from public.load_topups where id = (select top2 from t_ids)) = 'due', '');
select pg_temp.res('it has a number and is good for 7 days', number ~ '^L-\d{4}-\d{5}$' and valid_until = private.today_ph() + 7, number)
  from public.load_topups where id = (select top2 from t_ids);
select pg_temp.res('reporting needs a reference or a screenshot', pg_temp.err(format('select public.load_topup_report(%L, %L, %L)', (select top2 from t_ids), 'gcash', '')) like 'Add the reference number%', '');
select pg_temp.res('a screenshot must be in the top-up''s folder', pg_temp.err(format('select public.load_topup_report(%L, %L, %L, %L, %L)', (select top2 from t_ids), 'gcash', 'x',
  (select org from t_ids) || '/billing/x/a.jpg', 'a.jpg')) = 'Invalid file location.', '');
select public.load_topup_report(top2, 'gcash', '1234 567 890', org || '/load/' || top2 || '/abcdef12-proof.jpg', 'proof.jpg') from t_ids;
select pg_temp.res('reported: waiting for staff', status = 'pending_verification' and pay_ref = '1234 567 890', status) from public.load_topups where id = (select top2 from t_ids);
select pg_temp.res('a reported top-up can''t be cancelled', pg_temp.err(format('select public.load_topup_cancel(%L)', (select top2 from t_ids))) like 'Only a top-up you haven''t paid%', '');
reset role;
select pg_temp.res('staff are told', exists (select 1 from public.notifications where user_id = 'e9000000-0000-4000-8000-0000000000f5' and title like 'Load top-up to confirm: L-%'), '');
select pg_temp.as_user('e9000000-0000-4000-8000-0000000000c3');
set local role authenticated;
select pg_temp.res('another customer sees none of it', (select count(*) from public.load_topups) = 0 and (select count(*) from public.load_entries) = 0
  and (select count(*) from public.load_wallets) = 0, '');
select pg_temp.res('...and can''t report on it', pg_temp.err(format('select public.load_topup_report(%L, %L, %L)', (select top2 from t_ids), 'gcash', 'x')) = 'Top-up not found.', '');
select pg_temp.res('...or confirm it', pg_temp.err(format('select public.admin_confirm_topup(%L, true)', (select top2 from t_ids))) = 'Staff only.', '');
reset role;
select pg_temp.as_user('e9000000-0000-4000-8000-0000000000f5');
set local role authenticated;
select public.admin_confirm_topup(top2, false, 'No GCash payment with that reference.') from t_ids;
reset role;
select pg_temp.res('staff can''t find it: back to the customer with a note', status = 'due' and note = 'No GCash payment with that reference.', status) from public.load_topups where id = (select top2 from t_ids);
select pg_temp.res('...and the owner is told', exists (select 1 from public.notifications where user_id = 'e9000000-0000-4000-8000-0000000000a1' and title like 'We couldn''t match your payment for top-up%'), '');
select pg_temp.as_user('e9000000-0000-4000-8000-0000000000f5');
set local role authenticated;
select public.admin_confirm_topup(top2, true, null, 'SI-0042') from t_ids;
reset role;
select pg_temp.res('confirmed: ₱500 paid load, with the invoice number', (select paid_php from public.load_wallets where org_id = (select org from t_ids)) = 500
  and (select status = 'paid' and bir_invoice_no = 'SI-0042' from public.load_topups where id = (select top2 from t_ids)), '');
select pg_temp.res('the history says so', exists (select 1 from public.load_entries where org_id = (select org from t_ids) and kind = 'topup' and paid_php = 500 and label like 'Top-up L-%'), '');
select pg_temp.res('the owner gets a thank-you with the new balance', exists (select 1 from public.notifications where user_id = 'e9000000-0000-4000-8000-0000000000a1'
  and title = '₱500.00 load added: thank you' and body like '%Your load is now ₱500.00.'), '');
select pg_temp.as_user('e9000000-0000-4000-8000-0000000000f5');
set local role authenticated;
select pg_temp.res('confirming twice does nothing', pg_temp.err(format('select public.admin_confirm_topup(%L, true)', (select top2 from t_ids))) = 'This top-up is already paid.', '');
reset role;

-- online checkout
select pg_temp.as_user('e9000000-0000-4000-8000-0000000000a1');
set local role authenticated;
update t_ids set top3 = public.load_topup_start(org, 100);
update t_ids set pay = (public.billing_start(org, 'load:' || top3) ->> 'payment_id')::uuid;
reset role;
select pg_temp.res('online checkout makes a payment for the top-up', exists (select 1 from public.payments where id = (select pay from t_ids) and load_topup_id = (select top3 from t_ids) and amount_php = 100), '');
update public.payments set checkout_id = 'cs_test_load' where id = (select pay from t_ids);
select public.billing_mark_paid('cs_test_load', '{}'::jsonb);
select public.billing_mark_paid('cs_test_load', '{}'::jsonb);
select pg_temp.res('paid online: ₱100 more, counted once', (select paid_php from public.load_wallets where org_id = (select org from t_ids)) = 600
  and (select status = 'paid' and pay_method = 'online' from public.load_topups where id = (select top3 from t_ids)), '');

-- ---------------------------------------------------------------- text packs
select pg_temp.as_user('e9000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select pg_temp.res('no text packs while texting isn''t connected', pg_temp.err(format('select public.buy_texts(%L, %L)', (select org from t_ids), 'texts_50')) like 'Text reminders aren''t available yet%', '');
reset role;
update private.settings set value = '{"email":true,"sms":true}' where key = 'channel_status';
select pg_temp.as_user('e9000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select pg_temp.res('no text packs until someone has a verified mobile number', pg_temp.err(format('select public.buy_texts(%L, %L)', (select org from t_ids), 'texts_50')) like 'Add and verify a mobile number first%', '');
reset role;
do $$ begin perform set_config('pp.phone_rpc', 'on', true);
  update public.profiles set phone = '+639171230001', phone_verified_at = now() where id = 'e9000000-0000-4000-8000-0000000000a1';
  update public.profiles set phone = '+639171230003', phone_verified_at = now() where id = 'e9000000-0000-4000-8000-0000000000c3';
  perform set_config('pp.phone_rpc', 'off', true); end $$;
update public.notification_prefs set sms_enabled = true where user_id in ('e9000000-0000-4000-8000-0000000000a1', 'e9000000-0000-4000-8000-0000000000c3');
select pg_temp.as_user('e9000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select pg_temp.res('50 texts for ₱49', public.buy_texts(org, 'texts_50') = 50, '') from t_ids;
select pg_temp.res('...from the load: ₱551 left', (select paid_php from public.load_wallets where org_id = (select org from t_ids)) = 551, '');
select pg_temp.res('the summary shows the texts and that credits pay for them', (s ->> 'texts')::int = 50 and s ->> 'text_source' = 'credit' and (s ->> 'phones')::int = 1, s::text)
  from (select public.load_summary(org) as s from t_ids) x;
reset role;

-- a reminder text uses one credit; one that can't be delivered gives it back
select private.queue_due_reminders();
select pg_temp.res('the Mayor''s Permit reminder goes out as a text paid by a credit', exists (select 1 from public.message_outbox where channel = 'sms'
  and user_id = 'e9000000-0000-4000-8000-0000000000a1' and status = 'queued' and text_source = 'credit'), '');
select pg_temp.res('...using one of the 50', (select texts from public.load_wallets where org_id = (select org from t_ids)) = 49, '');
update public.message_outbox set status = 'failed' where channel = 'sms' and user_id = 'e9000000-0000-4000-8000-0000000000a1' and text_source = 'credit';
select pg_temp.res('a text that couldn''t be delivered gives its credit back', (select texts from public.load_wallets where org_id = (select org from t_ids)) = 50, '');
update public.load_wallets set texts = 6 where org_id = (select org from t_ids);
insert into public.message_outbox (org_id, user_id, channel, to_address, body_text, dedupe_key)
  select org, 'e9000000-0000-4000-8000-0000000000a1', 'sms', '+639171230001', 'test', 'test-low' from t_ids;
select pg_temp.res('at 5 left, the owner is told', (select texts from public.load_wallets where org_id = (select org from t_ids)) = 5
  and exists (select 1 from public.notifications where user_id = 'e9000000-0000-4000-8000-0000000000a1' and title = 'Only 5 text reminders left'), '');
update public.load_wallets set texts = 0 where org_id = (select org from t_ids);
delete from public.message_outbox where channel = 'sms';
insert into public.message_outbox (org_id, user_id, channel, to_address, body_text, dedupe_key)
  select org, 'e9000000-0000-4000-8000-0000000000a1', 'sms', '+639171230001', 'test', 'test-none' from t_ids;
select pg_temp.res('with no credits (and no plan texts), the text is skipped and logged', status = 'skipped' and last_error = 'No texts left for this workspace', coalesce(last_error, status))
  from public.message_outbox where dedupe_key = 'test-none';
-- a team plan pays for its texts: no credit used, and only these count toward the monthly cap
insert into public.message_outbox (org_id, user_id, channel, to_address, body_text, dedupe_key)
  select team, 'e9000000-0000-4000-8000-0000000000c3', 'sms', '+639171230003', 'test', 'test-plan' from t_ids;
select pg_temp.res('a team plan''s texts are paid by the plan', text_source = 'plan' and status = 'queued', coalesce(text_source, status)) from public.message_outbox where dedupe_key = 'test-plan';
update public.app_settings set value = '1' where key = 'sms_monthly_cap';
update public.load_wallets set texts = 3 where org_id = (select org from t_ids);
insert into public.message_outbox (org_id, user_id, channel, to_address, body_text, dedupe_key)
  select org, 'e9000000-0000-4000-8000-0000000000a1', 'sms', '+639171230001', 'test', 'test-paid' from t_ids;
select pg_temp.res('the monthly cap (for texts Pinoy Permit pays) doesn''t stop paid-for texts', text_source = 'credit' and status = 'queued', coalesce(last_error, status))
  from public.message_outbox where dedupe_key = 'test-paid';
insert into public.message_outbox (org_id, user_id, channel, to_address, body_text, dedupe_key)
  select team, 'e9000000-0000-4000-8000-0000000000c3', 'sms', '+639171230003', 'test', 'test-plan2' from t_ids;
select pg_temp.res('...but still stops plan texts', status = 'skipped' and last_error = 'Monthly text limit reached', coalesce(last_error, status)) from public.message_outbox where dedupe_key = 'test-plan2';
update public.app_settings set value = '1000' where key = 'sms_monthly_cap';
-- tax deadlines are texted too
delete from public.message_outbox where channel = 'sms';
update public.load_wallets set texts = 10 where org_id = (select org from t_ids);
select public.save_filing_setup(biz, true, true, 'percentage', 7::smallint, null, null, '{}') from t_ids;
select private.queue_filing_reminders();
select pg_temp.res('tax deadlines emailed today are texted too (when something is due within 7 days)',
  not exists (select 1 from public.notifications where kind = 'filing' and user_id = 'e9000000-0000-4000-8000-0000000000a1' and dedupe_key ~ ':(d7|d1|over-0):')
  or exists (select 1 from public.message_outbox where dedupe_key like 'filsms:e9000000-0000-4000-8000-0000000000a1:%' and text_source = 'credit'),
  (select count(*)::text from public.notifications where kind = 'filing'));
delete from public.message_outbox where channel = 'sms';
update public.load_wallets set texts = 0 where org_id = (select org from t_ids);

-- ---------------------------------------------------------------- one template, yours to keep
select pg_temp.as_user('e9000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select pg_temp.res('without Plus, a template''s full text is locked', pg_temp.err(format('select public.get_template(%L, %L)', (select org from t_ids), 'authorization_letter')) like 'Ready-to-use templates come with Pinoy Permit Plus, or one at a time%', '');
select public.unlock_template(org, 'authorization_letter') from t_ids;
select pg_temp.res('bought for ₱99 (its own price): it opens', (public.get_template(org, 'authorization_letter') ->> 'title') = 'Authorization letter'
  and (select paid_php from public.load_wallets where org_id = (select org from t_ids)) = 452, '') from t_ids;
select public.unlock_template(org, 'authorization_letter') from t_ids;
select pg_temp.res('buying it again costs nothing', (select paid_php from public.load_wallets where org_id = (select org from t_ids)) = 452
  and (select count(*) from public.template_unlocks where org_id = (select org from t_ids)) = 1, '');
select pg_temp.res('other templates stay locked', pg_temp.err(format('select public.get_template(%L, %L)', (select org from t_ids), 'sworn_declaration_gross_sales')) like 'Ready-to-use%'
  or pg_temp.err(format('select public.get_template(%L, %L)', (select org from t_ids), 'sworn_declaration_gross_sales')) = 'Template not found.', '');
reset role;
select pg_temp.as_user('e9000000-0000-4000-8000-0000000000c3');
set local role authenticated;
select pg_temp.res('a workspace with Plus doesn''t pay for templates', pg_temp.err(format('select public.unlock_template(%L, %L)', (select team from t_ids), 'authorization_letter')) like 'Your workspace has Pinoy Permit Plus%', '');
select pg_temp.res('...and can''t spend someone else''s load', pg_temp.err(format('select public.unlock_template(%L, %L)', (select org from t_ids), 'authorization_letter')) like 'Only the workspace owner%', '');
reset role;

-- ---------------------------------------------------------------- papers check
select pg_temp.as_user('e9000000-0000-4000-8000-0000000000b2');
set local role authenticated;
select pg_temp.res('a teammate who isn''t an admin can''t spend load on a check', pg_temp.err(format('select public.request_papers_check(%L, %L)', (select org from t_ids), (select mp from t_ids))) like 'Only the workspace owner%', '');
reset role;
select pg_temp.as_user('e9000000-0000-4000-8000-0000000000a1');
set local role authenticated;
update t_ids set chk = public.request_papers_check(org, mp, 'Is my lease enough?');
select pg_temp.res('asked: ₱149 from the load, answered by 6 pm on a weekday', c.status = 'waiting' and c.paid_with = 'load' and c.price_php = 149
  and extract(isodow from c.due_by at time zone 'Asia/Manila') < 6 and to_char(c.due_by at time zone 'Asia/Manila', 'HH24:MI') = '18:00' and c.due_by > now()
  and (select paid_php from public.load_wallets where org_id = c.org_id) = 303, c.due_by::text)
  from public.papers_checks c where c.id = (select chk from t_ids);
select pg_temp.res('it keeps the permit''s and business''s names', requirement_name = 'Mayor''s / Business Permit' and subject_label = 'Sadie''s Kitchen' and note = 'Is my lease enough?', subject_label)
  from public.papers_checks where id = (select chk from t_ids);
select pg_temp.res('one open check per permit', pg_temp.err(format('select public.request_papers_check(%L, %L)', (select org from t_ids), (select mp from t_ids))) like 'A papers check for this permit is already waiting%', '');
select pg_temp.res('photos go in the check''s own folder', pg_temp.err(format('select public.add_papers_check_file(%L, %L, %L)', (select chk from t_ids), (select org from t_ids) || '/x/a.jpg', 'a.jpg')) = 'Invalid file location.', '');
select public.add_papers_check_file(chk, org || '/papers/' || chk || '/abcdef12-lease.jpg', 'lease.jpg', 'image/jpeg') from t_ids;
select pg_temp.res('a photo was added', (select count(*) from public.papers_check_files where check_id = (select chk from t_ids)) = 1, '');
reset role;
select pg_temp.res('staff are told, with the deadline', exists (select 1 from public.notifications where user_id = 'e9000000-0000-4000-8000-0000000000f5' and title = 'Papers check to answer: Mayor''s / Business Permit' and body like '%Answer by%'), '');
select pg_temp.as_user('e9000000-0000-4000-8000-0000000000f5');
set local role authenticated;
select pg_temp.res('staff can open the photo', public.staff_open_file(org || '/papers/' || chk || '/abcdef12-lease.jpg') = 'lease.jpg', '') from t_ids;
select pg_temp.res('...and the permit''s own documents while the check is open', public.staff_open_file(doc) = 'mp.jpg', '') from t_ids;
select pg_temp.res('...and can list the permit''s files and record', (select count(*) from public.documents where requirement_id = (select mp from t_ids)) = 1
  and (select count(*) from public.requirements where id = (select mp from t_ids)) = 1, '');
reset role;
select pg_temp.res('every open is logged for the customer to see', (select count(*) from public.staff_file_access where org_id = (select org from t_ids)
  and reason = 'Papers check: Mayor''s / Business Permit') = 2, '');
select pg_temp.as_user('e9000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select public.cancel_papers_check(chk) from t_ids;
select pg_temp.res('cancelled before an answer: the ₱149 comes back', (select status from public.papers_checks where id = (select chk from t_ids)) = 'cancelled'
  and (select paid_php from public.load_wallets where org_id = (select org from t_ids)) = 452, '');
update t_ids set chk = public.request_papers_check(org, mp, null);
reset role;
select pg_temp.as_user('e9000000-0000-4000-8000-0000000000f5');
set local role authenticated;
select pg_temp.res('staff must answer every line', pg_temp.err(format('select public.admin_answer_papers_check(%L, %L, %L::jsonb, %L)', (select chk from t_ids), 'almost',
  '[{"k":"lease","t":"Proof of address","state":"maybe"}]', 'Looks fine')) like 'Every checklist line needs an answer%', '');
select pg_temp.res('...and write a summary', pg_temp.err(format('select public.admin_answer_papers_check(%L, %L, %L::jsonb, %L)', (select chk from t_ids), 'almost',
  '[]', '')) like 'Write a short summary%', '');
select public.admin_answer_papers_check(chk, 'almost', '[{"k":"brgy","t":"Barangay Business Clearance for this year","state":"ok"},{"k":"lease","t":"Proof of address","state":"fix","note":"The lease ended in June: bring the renewed one."},{"k":"ctc","t":"Community Tax Certificate","state":"missing"}]'::jsonb,
  'Two things before you go: the renewed lease and this year''s cedula.') from t_ids;
reset role;
select pg_temp.res('answered: each line and the summary are kept', status = 'answered' and verdict = 'almost' and jsonb_array_length(items) = 3 and items -> 1 ->> 'note' like 'The lease ended%', status)
  from public.papers_checks where id = (select chk from t_ids);
select pg_temp.res('the owner is told it''s done', exists (select 1 from public.notifications where user_id = 'e9000000-0000-4000-8000-0000000000a1' and title = 'Papers check done: Mayor''s / Business Permit'
  and body like 'Almost there%'), '');
select pg_temp.as_user('e9000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select pg_temp.res('an answered check can''t be cancelled', pg_temp.err(format('select public.cancel_papers_check(%L)', (select chk from t_ids))) like 'Only a check that hasn''t been answered%', '');
reset role;
select pg_temp.as_user('e9000000-0000-4000-8000-0000000000f5');
set local role authenticated;
select public.admin_refund_papers_check(chk, 'We read the wrong permit year. Sorry!') from t_ids;
reset role;
select pg_temp.res('staff can give it back: ₱149 returns, the customer is told why', (select status from public.papers_checks where id = (select chk from t_ids)) = 'refunded'
  and (select paid_php from public.load_wallets where org_id = (select org from t_ids)) = 452
  and exists (select 1 from public.notifications where user_id = 'e9000000-0000-4000-8000-0000000000a1' and title = 'Papers check refunded: Mayor''s / Business Permit' and body like 'We read the wrong permit year.%'), '');
-- past its target time: no refund; staff get a nudge to answer it
select pg_temp.as_user('e9000000-0000-4000-8000-0000000000a1');
set local role authenticated;
update t_ids set chk2 = public.request_papers_check(org, fsic, null);
reset role;
update public.papers_checks set due_by = now() - interval '1 hour' where id = (select chk2 from t_ids);
select private.load_daily();
select pg_temp.res('past its target time: still waiting (no refund), staff are nudged to answer', (select status from public.papers_checks where id = (select chk2 from t_ids)) = 'waiting'
  and (select paid_php from public.load_wallets where org_id = (select org from t_ids)) = 452 - 149
  and exists (select 1 from public.notifications where title like 'Papers check waiting: %'), (select paid_php from public.load_wallets where org_id = (select org from t_ids))::text);
select pg_temp.as_user('e9000000-0000-4000-8000-0000000000f5');
set local role authenticated;
select pg_temp.res('staff can''t open the papers of a check that was given back', pg_temp.err(format('select public.staff_open_file(%L)', (select doc from t_ids))) like 'You can only open%', '');
reset role;

-- not enough load
update public.load_wallets set paid_php = 100, bonus_php = 0 where org_id = (select org from t_ids);
select pg_temp.as_user('e9000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select pg_temp.res('not enough load: refused, nothing taken', pg_temp.err(format('select public.request_papers_check(%L, %L)', (select org from t_ids), (select mp from t_ids))) like 'Not enough load: this is ₱149.00, and you have ₱100.00.%'
  and (select paid_php from public.load_wallets where org_id = (select org from t_ids)) = 100
  and not exists (select 1 from public.papers_checks where requirement_id = (select mp from t_ids) and status = 'waiting'), '');
reset role;

-- ---------------------------------------------------------------- the renewal season pass
update public.load_wallets set paid_php = 400 where org_id = (select org from t_ids);
select pg_temp.as_user('e9000000-0000-4000-8000-0000000000a1');
set local role authenticated;
do $$ begin
  if private.season_for(private.today_ph()) is null then
    perform pg_temp.res('out of season, the pass isn''t sold', pg_temp.err(format('select public.buy_season_pass(%L)', (select org from t_ids))) like 'The renewal season pass is on sale from September%', '');
  else
    update t_ids set pass = public.buy_season_pass(org);
    perform pg_temp.res('in season: ₱149, good until the end of February', (select ends_on = make_date(season, 3, 1) - 1 and starts_on = private.today_ph() and price_php = 149
      from public.season_passes where id = (select pass from t_ids)) and (select paid_php from public.load_wallets where org_id = (select org from t_ids)) = 251, '');
    perform pg_temp.res('one pass a season', pg_temp.err(format('select public.buy_season_pass(%L)', (select org from t_ids))) like 'This workspace already has the % season pass.', '');
  end if;
end $$;
reset role;
do $$ begin
  if (select pass from t_ids) is not null then
    perform pg_temp.res('the renewal plan is emailed at once, listing what''s due', exists (select 1 from public.message_outbox where dedupe_key like 'seasonplan:' || (select pass from t_ids) || ':start:%'
      and body_text like '%Mayor''s / Business Permit%'), '');
    perform pg_temp.res('with no credits, texts now come from the pass', private.text_source((select org from t_ids)) = 'season', '');
    insert into public.message_outbox (org_id, user_id, channel, to_address, body_text, dedupe_key)
      select org, 'e9000000-0000-4000-8000-0000000000a1', 'sms', '+639171230001', 'test', 'test-season' from t_ids;
    perform pg_temp.res('...and a text uses the pass, not credits', (select text_source from public.message_outbox where dedupe_key = 'test-season') = 'season'
      and (select texts from public.load_wallets where org_id = (select org from t_ids)) = 0, '');
    perform pg_temp.as_user('e9000000-0000-4000-8000-0000000000a1');
    execute 'set local role authenticated';
    update t_ids set chk = public.request_papers_check(org, mp, null);
    execute 'reset role';
    perform pg_temp.res('the pass''s papers check is used first: no load taken', (select paid_with = 'pass' and price_php = 0 from public.papers_checks where id = (select chk from t_ids))
      and (select paid_php from public.load_wallets where org_id = (select org from t_ids)) = 251
      and (select check_id = (select chk from t_ids) from public.season_passes where id = (select pass from t_ids)), '');
    perform private.papers_refund((select chk from t_ids), 'cancelled', 'test');
    perform pg_temp.res('giving it back frees the pass''s check again', (select check_id is null from public.season_passes where id = (select pass from t_ids)), '');
  end if;
end $$;

-- ---------------------------------------------------------------- inviting a business
select pg_temp.as_user('e9000000-0000-4000-8000-0000000000a1');
set local role authenticated;
update t_ids set code = public.invite_code(org);
select pg_temp.res('an 8-letter code, the same each time', length(code) = 8 and public.invite_code(org) = code, code) from t_ids;
update t_ids set own2 = public.create_org('Sadie Second');
select pg_temp.res('a code from your own workspace doesn''t count', pg_temp.err(format('select public.claim_invite(%L, %L)', (select own2 from t_ids), (select code from t_ids))) like 'You can''t use an invitation from your own workspace%', '');
reset role;
select pg_temp.as_user('e9000000-0000-4000-8000-0000000000d4');
set local role authenticated;
update t_ids set neworg = public.create_org('Nina''s Bakery');
select pg_temp.res('a wrong code says so', pg_temp.err(format('select public.claim_invite(%L, %L)', (select neworg from t_ids), 'ZZZZZZZZ')) = 'That invitation code isn''t valid.', '');
select pg_temp.res('the right code is accepted once', public.claim_invite(neworg, lower(code)) and not public.claim_invite(neworg, code), '') from t_ids;
select pg_temp.res('the new business sees it''s waiting for 3 permits', (public.load_summary(neworg) -> 'invites' -> 'invited_by' ->> 'status') = 'pending', '') from t_ids;
reset role;
select pg_temp.res('the inviter hears a business joined', exists (select 1 from public.notifications where user_id = 'e9000000-0000-4000-8000-0000000000a1' and title = 'A business you invited joined Pinoy Permit'), '');
select pg_temp.as_user('e9000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select pg_temp.res('the inviter sees it (no name), waiting', (select count(*) = 1 and bool_and(status = 'pending' and permits_with_dates = 0) from public.my_invites((select org from t_ids))), '');
reset role;
select private.load_daily();
select pg_temp.res('no gift until they''ve added 3 permits with dates', (select status from public.invite_signups where invited_org = (select neworg from t_ids)) = 'pending', '');
-- they set up three permits (a day ago)
do $$ declare b uuid; r record; begin
  perform pg_temp.as_user('e9000000-0000-4000-8000-0000000000d4');
  execute 'set local role authenticated';
  b := public.create_business((select neworg from t_ids), 'Nina''s Bakery', 'Sole Proprietorship', 'retail', 'Quezon City', '1 Main St');
  execute 'reset role';
  for r in select id from public.requirements where business_id = b and expires order by type_code limit 3 loop
    insert into public.requirement_cycles (org_id, requirement_id, reference_no, expires_on) values ((select neworg from t_ids), r.id, 'X', private.today_ph() + 200);
  end loop;
end $$;
update public.invite_signups set created_at = now() - interval '2 days' where invited_org = (select neworg from t_ids);
select private.load_daily();
select pg_temp.res('3 permits in: both get a month of Plus', (select status = 'rewarded' and inviter_reward = 'plus_month' and invited_reward = 'plus_month' from public.invite_signups where invited_org = (select neworg from t_ids))
  and private.has_plus((select org from t_ids)) and private.has_plus((select neworg from t_ids)), '');
select pg_temp.res('the month is a gift (no bill follows)', (select comped and not trial and paid_through = (private.today_ph() + interval '1 month')::date - 1 from public.addons where org_id = (select neworg from t_ids) and kind = 'plus'), '');
select pg_temp.res('both are told', exists (select 1 from public.notifications where user_id = 'e9000000-0000-4000-8000-0000000000d4' and title = 'Your welcome gift is here')
  and exists (select 1 from public.notifications where user_id = 'e9000000-0000-4000-8000-0000000000a1' and title = 'Thank you for inviting a business'), '');
-- someone who already pays for Plus gets the value as bonus load instead
select pg_temp.res('a workspace whose plan includes Plus gets ₱199 bonus load instead', (select private.give_plus_month((select team from t_ids), 'test')) = 'bonus_load', '');
select pg_temp.res('...in its load', (select bonus_php from public.load_wallets where org_id = (select team from t_ids)) = 199, '');
-- six thank-you months a year at most; the invited business still gets its gift
do $$ declare i int; v uuid; b uuid; r record; begin
  for i in 1..6 loop
    insert into public.orgs (name, created_by) values ('Cap ' || i, 'e9000000-0000-4000-8000-0000000000d4') returning id into v;
    insert into public.invite_signups (inviter_org, invited_org, status, inviter_reward, invited_reward, rewarded_at)
    values ((select org from t_ids), v, 'rewarded', 'plus_month', 'plus_month', now());
  end loop;
  insert into public.orgs (name, created_by) values ('Cap 7', 'e9000000-0000-4000-8000-0000000000d4') returning id into v;
  insert into public.org_members (org_id, user_id, role) values (v, 'e9000000-0000-4000-8000-0000000000d4', 'owner');
  perform pg_temp.as_user('e9000000-0000-4000-8000-0000000000d4');
  execute 'set local role authenticated';
  b := public.create_business(v, 'Cap Seven', 'Sole Proprietorship', 'retail', 'Quezon City', '7 Main St');
  execute 'reset role';
  for r in select id from public.requirements where business_id = b and expires order by type_code limit 3 loop
    insert into public.requirement_cycles (org_id, requirement_id, reference_no, expires_on) values (v, r.id, 'X', private.today_ph() + 200);
  end loop;
  insert into public.invite_signups (inviter_org, invited_org, invited_user, created_at) values ((select org from t_ids), v, 'e9000000-0000-4000-8000-0000000000d4', now() - interval '2 days');
  insert into public.orgs (name, created_by) values ('Old one', 'e9000000-0000-4000-8000-0000000000d4') returning id into v;
  insert into public.invite_signups (inviter_org, invited_org, invited_user, created_at) values ((select org from t_ids), v, 'e9000000-0000-4000-8000-0000000000d4', now() - interval '91 days');
end $$;
select private.load_daily();
select pg_temp.res('after 6 thank-you months this year, the inviter gets no more (the invited business still does)',
  (select inviter_reward = 'capped' and invited_reward = 'plus_month' and status = 'rewarded' from public.invite_signups s join public.orgs o on o.id = s.invited_org where o.name = 'Cap 7'), '');
select pg_temp.res('invitations that never got going are closed after 90 days',
  (select status = 'void' from public.invite_signups s join public.orgs o on o.id = s.invited_org where o.name = 'Old one'), '');

-- ---------------------------------------------------------------- staff gifts and paying load back
select pg_temp.as_user('e9000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select pg_temp.res('customers can''t give themselves load', pg_temp.err(format('select public.admin_load_gift(%L, 100, 0, %L)', (select org from t_ids), 'free')) = 'Staff only.', '');
reset role;
select pg_temp.as_user('e9000000-0000-4000-8000-0000000000f5');
set local role authenticated;
select pg_temp.res('a gift needs a reason', pg_temp.err(format('select public.admin_load_gift(%L, 100, 0, %L)', (select org from t_ids), '')) like 'Say why%', '');
select public.admin_load_gift(org, 50, 20, 'Sorry for the late answer.') from t_ids;
reset role;
select pg_temp.res('a gift is bonus load (not refundable) and texts', bonus_php = 50 and texts = 20, bonus_php::text || ' ' || texts) from public.load_wallets where org_id = (select org from t_ids);
select pg_temp.as_user('e9000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select public.buy_texts(org, 'texts_50') from t_ids;
reset role;
select pg_temp.res('bonus load is used first', (select bonus_php = 1 and texts = 70 from public.load_wallets where org_id = (select org from t_ids)), (select bonus_php::text from public.load_wallets where org_id = (select org from t_ids)));
select pg_temp.as_user('e9000000-0000-4000-8000-0000000000f5');
set local role authenticated;
select pg_temp.res('only paid load can be paid back', pg_temp.err(format('select public.admin_load_cashout(%L, 5000, %L, %L)', (select org from t_ids), 'gcash', 'R1')) like 'You can give back up to the paid load%', '');
select public.admin_load_cashout(org, 100, 'gcash', 'R-77', 'Closing the account') from t_ids;
reset role;
select pg_temp.res('paid back: the balance drops and the history says how', (select paid_php from public.load_wallets where org_id = (select org from t_ids)) = (select 151 + case when (select pass from t_ids) is null then 149 else 0 end)
  and exists (select 1 from public.load_entries where org_id = (select org from t_ids) and kind = 'cashout' and paid_php = -100 and label like 'Paid back to you by gcash (ref R-77)%'),
  (select paid_php::text from public.load_wallets where org_id = (select org from t_ids)));

-- ---------------------------------------------------------------- money views
select pg_temp.as_user('e9000000-0000-4000-8000-0000000000f5');
set local role authenticated;
select pg_temp.res('Money lists top-ups as money in, with the invoice number', exists (select 1 from public.admin_money(private.today_ph() - 1, private.today_ph())
  where stream = 'load' and kind = 'load_topup' and state = 'collected' and amount = 500 and invoice_no = 'SI-0042'), '');
select pg_temp.res('...and paying load back as money out', exists (select 1 from public.admin_money(private.today_ph() - 1, private.today_ph())
  where stream = 'load' and kind = 'refund' and amount = -100), '');
select pg_temp.res('the summary shows load held for customers and checks waiting', (s ->> 'load_held')::numeric > 0 and (s ? 'papers_waiting') and (s ? 'load_topups_to_check')
  and (s ->> 'load_bonus')::numeric >= 199, s::text) from (select public.admin_money_summary() as s) x;
select public.admin_set_invoice_no('load', top3, 'SI-0043') from t_ids;
select pg_temp.res('an invoice number can be added later', (select bir_invoice_no from public.load_topups where id = (select top3 from t_ids)) = 'SI-0043', '');
select public.admin_save_load_product('template', 45, true);
select pg_temp.res('staff can change a price', (select price_php from public.load_products where code = 'template') = 45, '');
select public.admin_save_load_product('template', 39, true);
select public.admin_save_load_product('texts_200', 179, false);
reset role;
select pg_temp.as_user('e9000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select pg_temp.res('a product switched off can''t be bought', pg_temp.err(format('select public.buy_texts(%L, %L)', (select org from t_ids), 'texts_200')) = 'That text pack isn''t available.', '');
select pg_temp.res('nobody writes balances directly', pg_temp.err(format('update public.load_wallets set paid_php = 99999 where org_id = %L', (select org from t_ids))) like 'permission denied%'
  and pg_temp.err(format('insert into public.load_entries (org_id, kind, label) values (%L, %L, %L)', (select org from t_ids), 'bonus', 'x')) like 'permission denied%', '');
reset role;
set local role anon;
select pg_temp.res('visitors can see the prices (for the prices page) but no balances', (select count(*) from public.load_products) = 5
  and pg_temp.err('select count(*) from public.load_wallets') like 'permission denied%', '');
reset role;

select n, step, ok, info from t_res order by n;
rollback;
