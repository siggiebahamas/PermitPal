-- The processing clock (working days, holidays, extensions, late notices, letters, staff filings) and city bills
-- (kept on record, or paid by PermitPal: confirming, paying, receipts on the permit, refunds, reminders, money views,
-- who can see and open what). Rolled back at the end.
begin;
create temp table t_res (n serial primary key, step text, ok boolean, info text);
grant all on t_res to authenticated, anon; grant all on sequence t_res_n_seq to authenticated, anon;
create function pg_temp.res(s text, ok boolean, info text default '') returns void language sql as
  $f$ insert into pg_temp.t_res(step, ok, info) values (s, coalesce(ok, false), coalesce(info, '')) $f$;
grant execute on function pg_temp.res(text, boolean, text) to authenticated, anon;
create function pg_temp.err(p_sql text) returns text language plpgsql as $f$ begin execute p_sql; return 'allowed'; exception when others then return sqlerrm; end $f$;
grant execute on function pg_temp.err(text) to authenticated, anon;
create function pg_temp.as_user(u text) returns void language plpgsql as $f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); end $f$;
create temp table t_ids (org uuid, biz uuid, mp uuid, fsic uuid, brgy uuid, f1 uuid, f2 uuid, f3 uuid, ord uuid, b1 uuid, b2 uuid, b3 uuid, b4 uuid, due0 date, other uuid, hol date);
grant all on t_ids to authenticated, anon; insert into t_ids default values;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at) values
 ('ea000000-0000-4000-8000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner@clock.ph','{"first_name":"Clara"}', now()),
 ('ea000000-0000-4000-8000-0000000000b2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','member@clock.ph','{"first_name":"Mario"}', now()),
 ('ea000000-0000-4000-8000-0000000000c3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','other@clock.ph','{"first_name":"Olga"}', now()),
 ('ea000000-0000-4000-8000-0000000000f5','00000000-0000-0000-0000-000000000000','authenticated','authenticated','staff@clock.ph','{"first_name":"Fe"}', now());
update public.profiles set is_platform_admin = true where id = 'ea000000-0000-4000-8000-0000000000f5';
update private.settings set value = '{}' where key = 'channel_status';
delete from public.message_outbox;

select pg_temp.res('both feature switches are on', exists (select 1 from private.features where name = 'clock') and exists (select 1 from private.features where name = 'billpay'), '');
select pg_temp.res('working days skip the weekend: filed Thursday Jan 7, 2027, 3 working days end Tuesday Jan 12',
  private.add_workdays('2027-01-07', 3) = '2027-01-12', private.add_workdays('2027-01-07', 3)::text);
select pg_temp.res('...and national holidays: filed Dec 23, 2026, 3 working days end Monday Jan 4, 2027',
  private.add_workdays('2026-12-23', 3) = '2027-01-04', private.add_workdays('2026-12-23', 3)::text);
select pg_temp.res('working days late: Jan 12 to Jan 14, 2027 is 2', private.workdays_between('2027-01-12', '2027-01-14') = 2, '');
select pg_temp.res('the 2027 calendar is in (Maundy Thursday, Good Friday; Feb 25 is a working day)',
  not private.is_workday('2027-03-25') and not private.is_workday('2027-03-26') and private.is_workday('2027-02-25'), '');

-- ---------------------------------------------------------------- set-up: a business, a teammate, someone else
select pg_temp.as_user('ea000000-0000-4000-8000-0000000000a1');
set local role authenticated;
update t_ids set org = public.create_org('Clara Bakeshop');
update t_ids set biz = public.create_business(org, 'Clara''s Bakeshop', 'Sole Proprietorship', 'retail', 'Quezon City', '5 Maginhawa St');
update t_ids set mp = (select id from public.requirements where business_id = (select biz from t_ids) and type_code = 'mayors_permit' limit 1),
  fsic = (select id from public.requirements where business_id = (select biz from t_ids) and type_code = 'fsic' limit 1),
  brgy = (select id from public.requirements where business_id = (select biz from t_ids) and type_code = 'barangay_clearance' limit 1);
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
insert into public.org_members (org_id, user_id, role) select org, 'ea000000-0000-4000-8000-0000000000b2', 'member' from t_ids;
select pg_temp.as_user('ea000000-0000-4000-8000-0000000000c3');
set local role authenticated;
update t_ids set other = public.create_org('Olga Shop');
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;

-- ---------------------------------------------------------------- the clock
select pg_temp.as_user('ea000000-0000-4000-8000-0000000000b2');
set local role authenticated;
select pg_temp.res('it needs the office', pg_temp.err(format('select public.filing_save(null, %L, %L, null, %L, %L, null, %L, null)', (select mp from t_ids), ' ', private.today_ph() - 1, 'simple', 'not_assessed')) = 'Which office did you file with?', '');
select pg_temp.res('the day you filed can''t be in the future', pg_temp.err(format('select public.filing_save(null, %L, %L, null, %L, %L, null, %L, null)', (select mp from t_ids), 'QC BPLD', private.today_ph() + 1, 'simple', 'not_assessed')) like 'The day you filed can''t be in the future.', '');
select pg_temp.res('a Citizen''s Charter time needs its days', pg_temp.err(format('select public.filing_save(null, %L, %L, null, %L, %L, null, %L, null)', (select mp from t_ids), 'QC BPLD', private.today_ph() - 1, 'charter', 'not_assessed')) like 'Enter the working days%', '');
select pg_temp.res('fees paid needs the day', pg_temp.err(format('select public.filing_save(null, %L, %L, null, %L, %L, null, %L, null)', (select mp from t_ids), 'QC BPLD', private.today_ph() - 1, 'simple', 'paid')) = 'Enter the day you paid the fees.', '');
update t_ids set f1 = public.filing_save(null, mp, 'Quezon City BPLD', 'APP-2027-0001', private.today_ph() - 1, 'simple', null, 'not_assessed', null);
reset role;
select pg_temp.res('a teammate starts the clock: 3 working days for a simple transaction', f.days = 3 and f.status = 'waiting' and f.due_on = private.add_workdays(f.filed_on, 3), f.due_on::text)
  from public.office_filings f where f.id = (select f1 from t_ids);
set local role authenticated;
select pg_temp.res('one clock at a time per permit', pg_temp.err(format('select public.filing_save(null, %L, %L, null, %L, %L, null, %L, null)', (select mp from t_ids), 'QC BPLD', private.today_ph(), 'simple', 'not_assessed')) like 'The clock is already running%', '');
select pg_temp.res('an extension needs what the office wrote', pg_temp.err(format('select public.filing_save(%L, null, %L, null, %L, %L, null, %L, null, true, null)', (select f1 from t_ids), 'Quezon City BPLD', private.today_ph() - 1, 'simple', 'not_assessed')) like 'Say what the office wrote%', '');
select public.filing_save(f1, null, 'Quezon City BPLD', 'APP-2027-0001', private.today_ph() - 1, 'simple', null, 'paid', private.today_ph() - 1, true, 'Letter dated today: inspection pending', 1) from t_ids;
reset role;
select pg_temp.res('extended once: twice the time, plus a day the office was closed', f.due_on = private.add_workdays(f.filed_on, 7) and f.fees = 'paid' and f.extended, f.due_on::text)
  from public.office_filings f where f.id = (select f1 from t_ids);
set local role authenticated;
select public.filing_save(f1, null, 'Quezon City BPLD', 'APP-2027-0001', private.today_ph() - 1, 'charter', 1, 'none', null, false, null, 0) from t_ids;
reset role;
select pg_temp.res('the office''s own Citizen''s Charter time can be shorter (1 working day)', f.days = 1 and f.due_on = private.add_workdays(f.filed_on, 1), f.due_on::text)
  from public.office_filings f where f.id = (select f1 from t_ids);
reset role;
select pg_temp.as_user('ea000000-0000-4000-8000-0000000000c3');
set local role authenticated;
select pg_temp.res('someone else can''t see or change it', (select count(*) from public.office_filings) = 0
  and pg_temp.err(format('select public.filing_close(%L, %L)', (select f1 from t_ids), 'released')) = 'Filing not found.'
  and pg_temp.err(format('select public.filing_save(null, %L, %L, null, %L, %L, null, %L, null)', (select mp from t_ids), 'X office', private.today_ph(), 'simple', 'none')) = 'Permit not found.', '');
reset role;
-- it runs late (filed a month ago)
update public.office_filings set filed_on = private.today_ph() - 30, kind = 'simple' where id = (select f1 from t_ids);
select pg_temp.res('moving the dates moves the deadline', due_on = private.add_workdays(private.today_ph() - 30, 3) and due_on < private.today_ph(), due_on::text)
  from public.office_filings where id = (select f1 from t_ids);
select private.clock_daily();
select pg_temp.res('the morning after the deadline, the owner hears about it, with the follow-up letter on offer',
  exists (select 1 from public.notifications n where n.user_id = 'ea000000-0000-4000-8000-0000000000a1' and n.title = 'Quezon City BPLD is past its deadline'
    and n.body like '%follow-up letter%' and n.requirement_id = (select mp from t_ids)), '');
select private.clock_daily();
select pg_temp.res('...once', (select count(*) from public.notifications where title = 'Quezon City BPLD is past its deadline') = 1
  and (select late_noticed_at is not null from public.office_filings where id = (select f1 from t_ids)), '');
select pg_temp.as_user('ea000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select public.filing_letter(f1, 'followup') from t_ids;
select public.filing_letter(f1, 'complaint', 'ARTA-2027-00042') from t_ids;
select pg_temp.res('letters drafted are remembered (and the ARTA reference)', followup_at is not null and complaint_at is not null and complaint_ref = 'ARTA-2027-00042', '')
  from public.office_filings where id = (select f1 from t_ids);
select pg_temp.res('a closing date can''t be before you filed', pg_temp.err(format('select public.filing_close(%L, %L, %L)', (select f1 from t_ids), 'released', private.today_ph() - 40)) like 'Choose a day%', '');
select public.filing_close(f1, 'released') from t_ids;
select pg_temp.res('released: the clock stops', status = 'released' and closed_on = private.today_ph(), status) from public.office_filings where id = (select f1 from t_ids);
select pg_temp.res('...and can''t be closed twice', pg_temp.err(format('select public.filing_close(%L, %L)', (select f1 from t_ids), 'withdrawn')) = 'This filing is already closed.', '');
select pg_temp.res('the permit''s Activity tells the story (filed, updated, letters, released late)',
  (select count(*) from public.audit_log a where a.requirement_id = (select mp from t_ids) and a.entity = 'office_filing') >= 5
  and exists (select 1 from public.audit_log a where a.requirement_id = (select mp from t_ids) and a.action = 'clock_released' and a.summary like '%past its deadline.'), '');
select pg_temp.res('a new filing can start after the last one closed',
  pg_temp.err(format('select public.filing_save(null, %L, %L, null, %L, %L, null, %L, null)', (select mp from t_ids), 'Quezon City BPLD', private.today_ph(), 'complex', 'not_assessed')) = 'allowed', '');
select pg_temp.res('nobody writes filings directly', pg_temp.err(format('update public.office_filings set due_on = %L', private.today_ph() + 99)) like 'permission denied%', '');
select pg_temp.res('only staff start a clock on an order', pg_temp.err(format('select public.admin_start_filing(%L, %L, null, %L, %L)', gen_random_uuid(), 'X', private.today_ph(), 'simple')) = 'Staff only.', '');
reset role;

-- staff file a done-for-you order and start its clock
insert into public.assistance_requests (org_id, requirement_id, requirement_name, subject_label, status, payment_status)
  select org, fsic, 'Fire Safety Inspection Certificate', 'Clara''s Bakeshop', 'in_progress', 'paid' from t_ids;
update t_ids set ord = (select id from public.assistance_requests where requirement_id = (select fsic from t_ids));
select pg_temp.as_user('ea000000-0000-4000-8000-0000000000f5');
set local role authenticated;
update t_ids set f2 = public.admin_start_filing(ord, 'BFP Quezon City', 'FSIC-77', private.today_ph() - 1, 'simple');
select pg_temp.res('staff start the clock on an order they filed; the customer sees it on the order',
  (select request_id = (select ord from t_ids) from public.office_filings where id = (select f2 from t_ids))
  and exists (select 1 from public.request_events e where e.request_id = (select ord from t_ids) and e.kind = 'status' and e.message like 'Filed with BFP Quezon City%'), '');
select pg_temp.res('staff see every filing still waiting', exists (select 1 from public.admin_filings() a where a.id = (select f2 from t_ids) and a.org_name = 'Clara Bakeshop'), '');
reset role;
update t_ids set due0 = (select due_on from public.office_filings where id = (select f2 from t_ids)),
  hol = (select min(d)::date from public.office_filings f, generate_series(f.filed_on + 1, f.filed_on + 10, interval '1 day') d where f.id = (select f2 from t_ids) and private.is_workday(d::date));
set local role authenticated;
select public.admin_set_holiday(hol, 'Typhoon: offices closed', 'special') from t_ids;
select pg_temp.res('a day off added by staff moves running deadlines', (select due_on from public.office_filings where id = (select f2 from t_ids)) > (select due0 from t_ids), '');
select public.admin_set_holiday(h.day, null, null, true) from public.ph_holidays h where h.name = 'Typhoon: offices closed';
select pg_temp.res('...and taking it out moves them back', (select due_on from public.office_filings where id = (select f2 from t_ids)) = (select due0 from t_ids), '');
select pg_temp.res('staff can''t close a customer''s own filing', pg_temp.err(format('select public.filing_close(%L, %L)',
  (select id from public.office_filings where requirement_id = (select mp from t_ids) and status = 'waiting'), 'released')) = 'Filing not found.', '');
select public.filing_close(f2, 'released') from t_ids;
select pg_temp.res('...but closes the ones on orders', (select status from public.office_filings where id = (select f2 from t_ids)) = 'released', '');
reset role;

-- ---------------------------------------------------------------- city bills: kept on record
select pg_temp.as_user('ea000000-0000-4000-8000-0000000000b2');
set local role authenticated;
select pg_temp.res('a bill needs its amount', pg_temp.err(format('select public.bill_add(%L, %L, %L, null, 0, null, %L)', (select org from t_ids), (select brgy from t_ids), 'Barangay Teachers Village', 'self')) = 'Enter the amount on the bill.', '');
select pg_temp.res('...in pesos and centavos', pg_temp.err(format('select public.bill_add(%L, %L, %L, null, 10.555, null, %L)', (select org from t_ids), (select brgy from t_ids), 'Barangay Teachers Village', 'self')) like 'Use pesos and centavos%', '');
update t_ids set b1 = public.bill_add(org, brgy, 'Barangay Teachers Village', 'BC-118', 650, private.today_ph() + 3, 'self');
select pg_temp.res('a teammate keeps a bill on record: no fee, waiting to be paid', number ~ '^G-\d{4}-\d{5}$' and fee_php = 0 and status = 'due' and label like '"Barangay%', number)
  from public.gov_bills where id = (select b1 from t_ids);
select pg_temp.res('the same bill can''t be added twice', pg_temp.err(format('select public.bill_add(%L, %L, %L, %L, 650, null, %L)', (select org from t_ids), (select brgy from t_ids), 'Barangay Teachers Village', 'BC-118', 'self')) = 'This bill is already here.', '');
select pg_temp.res('only an owner or admin can have PermitPal pay one', pg_temp.err(format('select public.bill_add(%L, %L, %L, null, 5000, null, %L, %L, %L)', (select org from t_ids), (select mp from t_ids), 'QC Treasurer', 'permitpal', (select org from t_ids) || '/bills/x/bill.jpg', 'bill.jpg')) like 'Only the workspace owner or an admin%', '');
select pg_temp.res('paying it yourself needs the receipt number or a photo', pg_temp.err(format('select public.bill_paid_self(%L, %L, %L)', (select b1 from t_ids), '', private.today_ph())) like 'Add the official receipt%', '');
select public.bill_paid_self(b1, 'BRGY-00921', private.today_ph(), org || '/bills/abc/or.jpg', 'or.jpg') from t_ids;
select pg_temp.res('paid yourself: the receipt goes on the permit', b.status = 'paid' and d.requirement_id = (select brgy from t_ids) and d.file_name like 'Official receipt BRGY-00921 -%' and d.storage_path = b.or_path, d.file_name)
  from public.gov_bills b join public.documents d on d.id = b.document_id where b.id = (select b1 from t_ids);
select pg_temp.res('a paid bill can''t be removed', pg_temp.err(format('select public.bill_cancel(%L)', (select b1 from t_ids))) like 'Only a bill nobody has paid%', '');
reset role;

-- ---------------------------------------------------------------- city bills: PermitPal pays
select pg_temp.as_user('ea000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select pg_temp.res('PermitPal paying needs a photo of the bill', pg_temp.err(format('select public.bill_add(%L, %L, %L, null, 5000, null, %L)', (select org from t_ids), (select mp from t_ids), 'QC Treasurer', 'permitpal')) like 'Add a photo of the bill%', '');
select pg_temp.res('...in this workspace''s bills folder', pg_temp.err(format('select public.bill_add(%L, %L, %L, null, 5000, null, %L, %L, %L)', (select org from t_ids), (select mp from t_ids), 'QC Treasurer', 'permitpal', (select other from t_ids) || '/bills/x/bill.jpg', 'bill.jpg')) = 'Invalid file location.', '');
select pg_temp.res('...up to ₱50,000', pg_temp.err(format('select public.bill_add(%L, %L, %L, null, 60000, null, %L, %L, %L)', (select org from t_ids), (select mp from t_ids), 'QC Treasurer', 'permitpal', (select org from t_ids) || '/bills/x/bill.jpg', 'bill.jpg')) like 'PermitPal pays bills up to ₱50,000%', '');
reset role;
update public.app_settings set value = 'off' where key = 'billpay_open';
select pg_temp.as_user('ea000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select pg_temp.res('when staff pause it, nobody can ask PermitPal to pay', pg_temp.err(format('select public.bill_add(%L, %L, %L, null, 5000, null, %L, %L, %L)', (select org from t_ids), (select mp from t_ids), 'QC Treasurer', 'permitpal', (select org from t_ids) || '/bills/x/bill.jpg', 'bill.jpg')) like 'PermitPal isn''t paying bills%', '');
reset role;
update public.app_settings set value = 'on' where key = 'billpay_open';
select pg_temp.as_user('ea000000-0000-4000-8000-0000000000a1');
set local role authenticated;
update t_ids set b2 = public.bill_add(org, mp, 'Quezon City Treasurer', 'TB-2027-5531', 14230.50, private.today_ph() + 10, 'permitpal', org || '/bills/abcd1234/bill.jpg', 'bill.jpg');
select pg_temp.res('the owner asks PermitPal to pay: the bill plus the ₱199 fee', fee_php = 199 and amount_php = 14230.50 and status = 'due' and mode = 'permitpal', fee_php::text)
  from public.gov_bills where id = (select b2 from t_ids);
select pg_temp.res('reporting the payment needs a reference or a screenshot', pg_temp.err(format('select public.bill_report(%L, %L, %L)', (select b2 from t_ids), 'gcash', '')) like 'Add the reference number%', '');
select public.bill_report(b2, 'gcash', '7788 1122 3344') from t_ids;
reset role;
select pg_temp.res('staff hear about it', exists (select 1 from public.notifications where user_id = 'ea000000-0000-4000-8000-0000000000f5' and title = 'City bill to confirm: ' || (select number from public.gov_bills where id = (select b2 from t_ids))), '');
select pg_temp.as_user('ea000000-0000-4000-8000-0000000000f5');
set local role authenticated;
select public.admin_bill_received(b2, false, 'No GCash payment with that reference.') from t_ids;
select pg_temp.res('not found: back to the customer, with the reason', status = 'due' and note = 'No GCash payment with that reference.', status) from public.gov_bills where id = (select b2 from t_ids);
reset role;
select pg_temp.as_user('ea000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select public.bill_report(b2, 'gcash', '7788 1122 3345', org || '/bills/abcd1234/proof.jpg', 'proof.jpg') from t_ids;
reset role;
select pg_temp.as_user('ea000000-0000-4000-8000-0000000000f5');
set local role authenticated;
select public.admin_bill_received(b2, true, null, 'INV-500') from t_ids;
select pg_temp.res('confirmed: paying the office by 6 pm the next business day', status = 'processing' and pay_deadline = private.next_business_6pm(received_at) and bir_invoice_no = 'INV-500', pay_deadline::text)
  from public.gov_bills where id = (select b2 from t_ids);
select pg_temp.res('staff open the bill', public.staff_open_file((select bill_path from public.gov_bills where id = (select b2 from t_ids))) = 'bill.jpg', '');
reset role;
select pg_temp.res('...and the customer sees that it was opened, and why', exists (select 1 from public.staff_file_access s where s.org_id = (select org from t_ids) and s.reason like 'City bill G-%'), '');
set local role authenticated;
select pg_temp.res('...but not a bill the customer pays themselves', pg_temp.err(format('select public.staff_open_file(%L)', (select or_path from public.gov_bills where id = (select b1 from t_ids)))) like 'You can only open a bill%', '');
select pg_temp.res('staff may upload the receipt only into the bill they''re paying',
  public.pp_staff_bill_upload((select org from t_ids) || '/bills/' || (select b2 from t_ids) || '/or.jpg')
  and not public.pp_staff_bill_upload((select org from t_ids) || '/bills/' || (select b1 from t_ids) || '/or.jpg')
  and not public.pp_staff_bill_upload((select org from t_ids) || '/' || (select mp from t_ids) || '/x.jpg'), '');
select pg_temp.res('paying needs the receipt number', pg_temp.err(format('select public.admin_bill_paid(%L, %L, %L, %L)', (select b2 from t_ids), '', private.today_ph(), (select org from t_ids) || '/bills/' || (select b2 from t_ids) || '/or.jpg')) = 'Enter the official receipt number.', '');
select pg_temp.res('...and the receipt in the bill''s folder', pg_temp.err(format('select public.admin_bill_paid(%L, %L, %L, %L)', (select b2 from t_ids), 'OR-7731905', private.today_ph(), (select org from t_ids) || '/bills/other/or.jpg')) = 'Upload the official receipt.', '');
select public.admin_bill_paid(b2, 'OR-7731905', private.today_ph(), org || '/bills/' || b2 || '/or.jpg', 'or.jpg') from t_ids;
select pg_temp.res('paid: the official receipt is on the permit', b.status = 'paid' and d.requirement_id = (select mp from t_ids) and d.file_name like 'Official receipt OR-7731905%', d.file_name)
  from public.gov_bills b join public.documents d on d.id = b.document_id where b.id = (select b2 from t_ids);
select pg_temp.res('money: the ₱199 fee is ours; the ₱14,230.50 came in and went to the office',
  exists (select 1 from public.admin_money(private.today_ph() - 1, private.today_ph()) m where m.ref_id = (select b2 from t_ids) and m.kind = 'billpay_fee' and m.state = 'collected' and m.amount = 199 and m.invoice_no = 'INV-500')
  and exists (select 1 from public.admin_money(private.today_ph() - 1, private.today_ph()) m where m.ref_id = (select b2 from t_ids) and m.kind = 'gov_fees_in' and m.state = 'held' and m.amount = 14230.50)
  and exists (select 1 from public.admin_money(private.today_ph() - 1, private.today_ph()) m where m.ref_id = (select b2 from t_ids) and m.kind = 'gov_fees_out' and m.amount = -14230.50), '');
select public.admin_set_invoice_no('gbill', b2, 'INV-501') from t_ids;
select pg_temp.res('the BIR invoice number can be changed later', bir_invoice_no = 'INV-501', '') from public.gov_bills where id = (select b2 from t_ids);
reset role;
select pg_temp.res('the owner is told it''s paid', exists (select 1 from public.notifications where user_id = 'ea000000-0000-4000-8000-0000000000a1' and title = 'Paid: Quezon City Treasurer ₱14,230.50'), '');

-- a bill PermitPal can't pay goes back in full
select pg_temp.as_user('ea000000-0000-4000-8000-0000000000a1');
set local role authenticated;
update t_ids set b3 = public.bill_add(org, fsic, 'BFP Quezon City', 'FSIF-88', 1200, null, 'permitpal', org || '/bills/ef01/bill.jpg', 'bill.jpg');
select public.bill_report(b3, 'bank_transfer', 'BDO-5512') from t_ids;
reset role;
select pg_temp.as_user('ea000000-0000-4000-8000-0000000000f5');
set local role authenticated;
select public.admin_bill_received(b3, true) from t_ids;
select pg_temp.res('a refund needs a reason the customer will read', pg_temp.err(format('select public.admin_bill_refund(%L, %L)', (select b3 from t_ids), '')) like 'Say why%', '');
select public.admin_bill_refund(b3, 'BFP Quezon City only takes payment at its own window.', 'gcash', 'GC-9') from t_ids;
select pg_temp.res('refunded: the office''s part and our fee both go back',
  (select status from public.gov_bills where id = (select b3 from t_ids)) = 'refunded'
  and (select sum(m.amount) from public.admin_money(private.today_ph() - 1, private.today_ph()) m where m.ref_id = (select b3 from t_ids) and m.state = 'held') = 0
  and (select sum(m.amount) from public.admin_money(private.today_ph() - 1, private.today_ph()) m where m.ref_id = (select b3 from t_ids) and m.state = 'collected') = 0, '');
select pg_temp.res('the money summary counts what''s left to do', (public.admin_money_summary() ->> 'bills_to_pay')::int = 0 and (public.admin_money_summary() ->> 'bills_to_check')::int = 0, public.admin_money_summary()::text);
reset role;
select pg_temp.res('the owner is told why, and that the money is coming back', exists (select 1 from public.notifications where user_id = 'ea000000-0000-4000-8000-0000000000a1'
  and title like 'We couldn''t pay bill G-%' and body like 'BFP Quezon City only takes payment at its own window.%'), '');

-- reminders and clean-up
select pg_temp.as_user('ea000000-0000-4000-8000-0000000000a1');
set local role authenticated;
update t_ids set b4 = public.bill_add(org, fsic, 'BFP Quezon City', 'FSIF-90', 300, private.today_ph() + 3, 'self');
update t_ids set b3 = public.bill_add(org, brgy, 'Barangay Teachers Village', 'BC-200', 500, null, 'permitpal', org || '/bills/aa/bill.jpg', 'bill.jpg');
reset role;
update public.gov_bills set created_at = now() - interval '15 days' where id = (select b3 from t_ids);
select private.clock_daily();
select pg_temp.res('3 days before a bill''s pay-by date, the owner is reminded', exists (select 1 from public.notifications where user_id = 'ea000000-0000-4000-8000-0000000000a1'
  and title = 'Pay BFP Quezon City by ' || private.fmt_date(private.today_ph() + 3)), '');
select pg_temp.res('a bill PermitPal was asked to pay but nobody sent money for is closed after 14 days', (select status from public.gov_bills where id = (select b3 from t_ids)) = 'cancelled', '');
select pg_temp.as_user('ea000000-0000-4000-8000-0000000000b2');
set local role authenticated;
select public.bill_cancel(b4) from t_ids;
select pg_temp.res('a teammate removes a bill nobody paid', (select status from public.gov_bills where id = (select b4 from t_ids)) = 'cancelled', '');
select pg_temp.res('nobody writes bills directly', pg_temp.err(format('update public.gov_bills set status = %L', 'paid')) like 'permission denied%'
  and pg_temp.err(format('insert into public.gov_bills (number, org_id, requirement_id, label, office, amount_php, mode) values (%L, %L, %L, %L, %L, 1, %L)', 'G-X', (select org from t_ids), (select mp from t_ids), 'x', 'x office', 'self')) like 'permission denied%', '');
select pg_temp.res('only staff confirm or pay', pg_temp.err(format('select public.admin_bill_received(%L, true)', (select b2 from t_ids))) = 'Staff only.'
  and pg_temp.err(format('select public.admin_bill_paid(%L, %L, %L, %L)', (select b2 from t_ids), 'x', private.today_ph(), 'x')) = 'Staff only.'
  and pg_temp.err('select count(*) from public.admin_filings()') = 'Staff only.' and not public.pp_staff_bill_upload((select org from t_ids) || '/bills/' || (select b2 from t_ids) || '/or.jpg'), '');
reset role;
select pg_temp.as_user('ea000000-0000-4000-8000-0000000000c3');
set local role authenticated;
select pg_temp.res('someone else sees none of these bills', (select count(*) from public.gov_bills) = 0
  and pg_temp.err(format('select public.bill_cancel(%L)', (select b4 from t_ids))) = 'Bill not found.', '');
reset role;
set local role anon;
select pg_temp.res('visitors see no filings, bills or holidays', pg_temp.err('select count(*) from public.gov_bills') like 'permission denied%'
  and pg_temp.err('select count(*) from public.office_filings') like 'permission denied%' and pg_temp.err('select count(*) from public.ph_holidays') like 'permission denied%', '');
reset role;

select n, step, ok, info from t_res order by n;
rollback;
