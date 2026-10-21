-- White-label for accounting firms: price, who can turn it on, the brand settings and logo files, the
-- look on clients' reminder, deadline, nudge and invitation emails, the client's app, the monthly client
-- report, what happens when it lapses or the firm disconnects, and the money views. Rolled back at the end.
begin;
create temp table t_res (n serial primary key, step text, ok boolean, info text);
grant all on t_res to authenticated, anon; grant all on sequence t_res_n_seq to authenticated, anon;
create function pg_temp.res(s text, ok boolean, info text default '') returns void language sql as
  $f$ insert into pg_temp.t_res(step, ok, info) values (s, coalesce(ok, false), coalesce(info, '')) $f$;
grant execute on function pg_temp.res(text, boolean, text) to authenticated, anon;
create temp table t_ids (firm uuid, client uuid, managed uuid, other uuid, biz uuid, mbiz uuid, obiz uuid, link uuid, tok text, inv uuid);
grant all on t_ids to authenticated, anon; insert into t_ids default values;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at) values
 ('e1000000-0000-4000-8000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','faye@firm.ph','{"first_name":"Faye"}', now()),
 ('e1000000-0000-4000-8000-0000000000b2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','carlo@bakery.ph','{"first_name":"Carlo"}', now()),
 ('e1000000-0000-4000-8000-0000000000c3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','junior@firm.ph','{"first_name":"Jun"}', now()),
 ('e1000000-0000-4000-8000-0000000000d4','00000000-0000-0000-0000-000000000000','authenticated','authenticated','olive@other.ph','{"first_name":"Olive"}', now()),
 ('e1000000-0000-4000-8000-0000000000f5','00000000-0000-0000-0000-000000000000','authenticated','authenticated','staff@wl.ph','{"first_name":"Fely"}', now());
update public.profiles set is_platform_admin = true where id = 'e1000000-0000-4000-8000-0000000000f5';
update public.notification_prefs set weekly_digest = true, email_enabled = true, remind_30 = true, remind_7 = true, remind_1 = true, business_alerts = true
  where user_id in ('e1000000-0000-4000-8000-0000000000b2','e1000000-0000-4000-8000-0000000000d4');
create function pg_temp.as_user(u text) returns void language plpgsql as $f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); end $f$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $f$ begin execute p_sql; return 'allowed'; exception when others then return sqlerrm; end $f$;
grant execute on function pg_temp.err(text) to authenticated, anon;

-- ---------------------------------------------------------------- price and helpers
select pg_temp.res('₱1,000 a month or ₱10,000 a year', private.addon_price('brand', null, 'monthly') = 1000 and private.addon_price('brand', null, 'yearly') = 10000
  and private.addon_label('brand', null, 'yearly') = 'White-label (yearly)', private.addon_label('brand', null, 'monthly'));
select pg_temp.res('white text must stay readable on the brand color', private.color_ok('#1B4DB5') and private.color_ok('#000000') and not private.color_ok('#FFD400')
  and not private.color_ok('#FFFFFF') and not private.color_ok('red') and not private.color_ok('#12345'), '');

-- ---------------------------------------------------------------- set-up: a firm, a connected client, a client the firm manages, an outsider
select pg_temp.as_user('e1000000-0000-4000-8000-0000000000a1');
set local role authenticated;
update t_ids set firm = public.create_org('Dela Cruz Accounting');
update public.orgs set kind = 'firm' where id = (select firm from t_ids);
update t_ids set managed = public.create_org('Mila Sari-sari');
update t_ids set mbiz = public.create_business(managed, 'Mila Sari-sari Store', 'Sole Proprietorship', 'retail', 'Pasig City', '3 Ortigas Ave');
update public.orgs set contact_name = 'Mila', contact_email = 'mila@sarisari.ph' where id = (select managed from t_ids);
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
insert into public.org_members (org_id, user_id, role) select firm, 'e1000000-0000-4000-8000-0000000000c3', 'member' from t_ids;
select pg_temp.as_user('e1000000-0000-4000-8000-0000000000b2');
set local role authenticated;
update t_ids set client = public.create_org('Carlo Bakery');
update t_ids set biz = public.create_business(client, 'Carlo Bakery', 'Corporation', 'restaurant', 'Pasig City', '1 Shaw Blvd');
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.as_user('e1000000-0000-4000-8000-0000000000d4');
set local role authenticated;
update t_ids set other = public.create_org('Olive Hardware');
update t_ids set obiz = public.create_business(other, 'Olive Hardware', 'Corporation', 'retail', 'Pasig City', '9 Shaw Blvd');
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
-- a permit due in 5 days for the connected client and the outsider
insert into public.requirement_cycles (org_id, requirement_id, reference_no, expires_on)
  select r.org_id, r.id, 'MP-1', private.today_ph() + 5 from public.requirements r where r.type_code = 'mayors_permit' and r.business_id in ((select biz from t_ids), (select obiz from t_ids), (select mbiz from t_ids));
select pg_temp.res('a firm workspace in its trial can have White-label; a business can''t',
  private.brand_eligible((select firm from t_ids)) and not private.brand_eligible((select client from t_ids)), '');

-- ---------------------------------------------------------------- the brand settings
select pg_temp.as_user('e1000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select pg_temp.res('a color white text can''t be read on is refused',
  pg_temp.err(format('select public.brand_save(%L, %L, null, %L, null, null, null)', firm, 'Dela Cruz', '#FFE066')) = 'Pick a darker color, so white text on it stays easy to read.', '') from t_ids;
select pg_temp.res('a bad reply-to address is refused',
  pg_temp.err(format('select public.brand_save(%L, %L, null, %L, %L, null, null)', firm, 'Dela Cruz', '#0F5132', 'not-an-email')) = 'Enter a valid email address for replies.', '') from t_ids;
select pg_temp.res('a logo from another workspace''s folder is refused',
  pg_temp.err(format('select public.brand_save(%L, %L, %L, %L, null, null, null)', firm, 'Dela Cruz', client || '/logo.png', '#0F5132')) = 'Invalid file location.', '') from t_ids;
select pg_temp.res('a business workspace has no brand',
  pg_temp.err(format('select public.brand_save(%L, %L, null, %L, null, null, null)', managed, 'Mila', '#0F5132')) = 'White-label is for Accounting firm workspaces.', '') from t_ids;
select public.brand_save(firm, '  Dela Cruz & Co. ', firm || '/logo-1.png', '#0f5132', ' Hello@DelaCruz.ph ', '(02) 8123 4567', 'Tax & permits <i>x</i>') from t_ids;
select pg_temp.res('the owner saves the brand (trimmed, color in capitals, email in lower case)',
  b.display_name = 'Dela Cruz & Co.' and b.color = '#0F5132' and b.reply_to = 'hello@delacruz.ph' and b.client_report, b.display_name)
  from public.org_brands b where b.org_id = (select firm from t_ids);
select pg_temp.res('nobody writes the table directly',
  pg_temp.err(format('update public.org_brands set display_name = %L where org_id = %L', 'X', firm)) like 'permission denied%', '') from t_ids;
insert into storage.objects (bucket_id, name) select 'brand', firm || '/logo-1.png' from t_ids;
select pg_temp.res('the owner uploads the logo to the firm''s folder', exists (select 1 from storage.objects where bucket_id = 'brand' and name = (select firm from t_ids) || '/logo-1.png'), '');
select pg_temp.res('...and nowhere else', pg_temp.err(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'brand', managed || '/x.png')) like '%row-level security%', '') from t_ids;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;

select pg_temp.as_user('e1000000-0000-4000-8000-0000000000c3');
set local role authenticated;
select pg_temp.res('a firm member sees the brand but can''t change it', exists (select 1 from public.org_brands)
  and pg_temp.err(format('select public.brand_save(%L, %L, null, %L, null, null, null)', firm, 'X', '#0F5132')) = 'Only the workspace owner or an admin can change the brand.', '') from t_ids;
select pg_temp.res('...or upload a logo', pg_temp.err(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'brand', firm || '/y.png')) like '%row-level security%', '') from t_ids;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.as_user('e1000000-0000-4000-8000-0000000000d4');
set local role authenticated;
select pg_temp.res('other workspaces can''t read the brand settings', not exists (select 1 from public.org_brands), '');
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;

-- ---------------------------------------------------------------- turning it on
select pg_temp.res('saved but not on yet: nothing changes for clients', private.brand_json((select firm from t_ids)) is null, '');
select pg_temp.as_user('e1000000-0000-4000-8000-0000000000d4');
set local role authenticated;
select pg_temp.res('a business can''t start the trial', pg_temp.err(format('select public.start_brand_trial(%L)', other))
  = 'White-label is for Accounting firm workspaces with the firm plan (or its free trial).', '') from t_ids;
select pg_temp.res('...or buy it', pg_temp.err(format('select public.addon_checkout(%L, %L, null, %L)', other, 'brand', 'monthly'))
  = 'White-label is for Accounting firm workspaces with the firm plan (or its free trial).', '') from t_ids;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.as_user('e1000000-0000-4000-8000-0000000000c3');
set local role authenticated;
select pg_temp.res('a firm member can''t start the trial', pg_temp.err(format('select public.start_brand_trial(%L)', firm)) like 'Only the workspace owner or an admin%', '') from t_ids;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.as_user('e1000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select pg_temp.res('the 14-day trial starts', public.start_brand_trial(firm) = private.today_ph() + 13, '') from t_ids;
select pg_temp.res('...once', pg_temp.err(format('select public.start_brand_trial(%L)', firm)) = 'White-label is already on.', '') from t_ids;
select pg_temp.res('the price shown for the firm', (public.addon_preview(firm, 'brand', null, 'monthly') ->> 'price')::numeric = 1000, public.addon_preview(firm, 'brand', null, 'monthly')::text) from t_ids;
select pg_temp.res('White-label has no number of people', pg_temp.err(format('select public.addon_preview(%L, %L, 5, %L)', firm, 'brand', 'monthly')) = 'White-label has no number of people.', '') from t_ids;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.res('the brand is on, with the logo''s public address', b ->> 'name' = 'Dela Cruz & Co.'
  and b ->> 'logo_url' like '%/storage/v1/object/public/brand/' || (select firm from t_ids) || '/logo-1.png' and b ->> 'logo_url' not like '%functions%', b ->> 'logo_url')
  from (select private.brand_json(firm) b from t_ids) x;

-- ---------------------------------------------------------------- inviting a client
select pg_temp.as_user('e1000000-0000-4000-8000-0000000000a1');
set local role authenticated;
update t_ids set link = public.link_invite(firm, 'client', 'carlo@bakery.ph', 'Carlo');
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
update t_ids set tok = (select token from public.org_links where id = (select link from t_ids));
select pg_temp.res('the invitation goes out under the firm''s name, replies to the firm', o.subject = 'Dela Cruz & Co. invites you to connect on PermitPal'
  and o.from_name = 'Dela Cruz & Co.' and o.reply_to = 'hello@delacruz.ph' and o.body_html like '%#0F5132%' and o.body_html like '%Powered by%PermitPal%'
  and o.body_html like '%Dela Cruz &amp; Co.%' and o.body_html like '%Tax &amp; permits &lt;i&gt;x&lt;/i&gt;%' and o.body_html not like '%<i>x</i>%', o.subject)
  from public.message_outbox o where o.to_address = 'carlo@bakery.ph' and o.dedupe_key like 'linkinv:%';
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select pg_temp.res('the sign-up page from the invitation shows the firm''s logo, with no account', public.link_brand(tok) ->> 'name' = 'Dela Cruz & Co.', '') from t_ids;
select pg_temp.res('a made-up link shows nothing', public.link_brand('nope') is null, '');
select pg_temp.res('visitors can''t read a workspace''s brand', pg_temp.err(format('select public.client_brand(%L)', client)) like 'permission denied%', '') from t_ids;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.as_user('e1000000-0000-4000-8000-0000000000b2');
set local role authenticated;
select pg_temp.res('the invitation page shows the brand', (public.link_preview(tok) -> 'brand' ->> 'color') = '#0F5132', '') from t_ids;
select pg_temp.res('before connecting, the client''s app looks like PermitPal', public.client_brand(client) is null, '') from t_ids;
select public.link_accept(tok, client, false) from t_ids;
select pg_temp.res('once connected, the client''s app shows the firm (Powered by PermitPal)', public.client_brand(client) ->> 'name' = 'Dela Cruz & Co.'
  and public.client_brand(client) ->> 'phone' = '(02) 8123 4567', '') from t_ids;
select pg_temp.res('the client can''t read another workspace''s brand', public.client_brand(other) is null, '') from t_ids;
select pg_temp.res('the client can''t read the firm''s settings table', not exists (select 1 from public.org_brands), '');
select pg_temp.res('the invitation link no longer shows the brand', public.link_brand(tok) is null, '') from t_ids;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.res('a client the firm manages itself gets the brand too', private.client_brand_firm((select managed from t_ids)) = (select firm from t_ids), '');
select pg_temp.res('an outsider doesn''t', private.client_brand_json((select other from t_ids)) is null and private.client_brand_json((select firm from t_ids)) is null, '');

-- ---------------------------------------------------------------- emails to clients
delete from public.message_outbox;
select private.queue_due_reminders();
select pg_temp.res('the client''s permit reminder comes under the firm''s name, replies to the firm',
  o.subject like 'Dela Cruz & Co.: %' and o.from_name = 'Dela Cruz & Co.' and o.reply_to = 'hello@delacruz.ph' and o.body_html like '%#0F5132%'
  and o.body_html like '%Questions? Email%hello@delacruz.ph%(02) 8123 4567%' and o.body_html like '%Sent for Dela Cruz &amp; Co. · Powered by%PermitPal%'
  and o.body_text like '%Sent for Dela Cruz & Co. by PermitPal.%', o.subject)
  from public.message_outbox o where o.to_address = 'carlo@bakery.ph' and o.dedupe_key like 'remmail:%';
select pg_temp.res('everyone else gets PermitPal''s usual email', o.subject like 'PermitPal: %' and o.from_name is null and o.reply_to is null
  and o.body_html like '%<span style="color:#0C2A57">Permit</span>%', o.subject)
  from public.message_outbox o where o.to_address = 'olive@other.ph' and o.dedupe_key like 'remmail:%';
select private.notify('e1000000-0000-4000-8000-0000000000b2', client, 'filing', 'BIR 2551Q due in 3 days', 'File and pay by the 25th.', '#/filings', null, 'tfil:1', true) from t_ids;
select private.notify('e1000000-0000-4000-8000-0000000000b2', client, 'billing', 'Your plan ends soon', 'Renew anytime.', '#/settings/billing', null, 'tbill:1', true) from t_ids;
select pg_temp.res('tax-deadline emails carry the firm''s look', (select subject = 'Dela Cruz & Co.: BIR 2551Q due in 3 days' and from_name = 'Dela Cruz & Co.'
  from public.message_outbox where dedupe_key = 'tfil:1:email'), '');
select pg_temp.res('PermitPal''s own account emails don''t', (select subject = 'PermitPal: Your plan ends soon' and from_name is null
  from public.message_outbox where dedupe_key = 'tbill:1:email'), '');

-- Monday summary (pretend today is a Monday)
create or replace function private.today_ph() returns date language sql stable set search_path = '' as
  $f$ select ((now() at time zone 'Asia/Manila')::date - extract(isodow from (now() at time zone 'Asia/Manila')::date)::int + 8) $f$;
delete from public.message_outbox;
select private.queue_due_reminders();
select pg_temp.res('the Monday summary comes under the firm''s name', o.subject = 'Dela Cruz & Co. weekly summary: Carlo Bakery' and o.from_name = 'Dela Cruz & Co.'
  and o.body_html like '%Powered by%', o.subject) from public.message_outbox o where o.to_address = 'carlo@bakery.ph' and o.dedupe_key like 'digest:%';
select pg_temp.res('...and the outsider''s is PermitPal''s', exists (select 1 from public.message_outbox where to_address = 'olive@other.ph' and dedupe_key like 'digest:%'
  and subject = 'PermitPal weekly summary: Olive Hardware' and from_name is null), '');

-- Reminders the firm sends
delete from public.message_outbox;
select pg_temp.as_user('e1000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select pg_temp.res('the firm reminds both clients', public.network_nudge(firm, array[link], array[managed], 'Please renew this week.') = 2, '') from t_ids;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.res('the connected client gets one email, under the firm''s name', count(*) = 1 and bool_and(subject = 'Dela Cruz & Co. asks you to update your permits'
  and from_name = 'Dela Cruz & Co.' and body_html like '%Please renew this week.%'), count(*)::text)
  from public.message_outbox where to_address = 'carlo@bakery.ph';
select pg_temp.res('...and the in-app note says who asked', exists (select 1 from public.notifications where user_id = 'e1000000-0000-4000-8000-0000000000b2'
  and title = 'Dela Cruz & Co. asks you to update your permits'), '');
select pg_temp.res('the managed client''s contact gets it under the firm''s name', o.subject = 'Dela Cruz & Co.: permits that need your attention' and o.from_name = 'Dela Cruz & Co.'
  and o.reply_to = 'hello@delacruz.ph' and o.body_html like '%Dela Cruz &amp; Co. sent you this from PermitPal.%', o.subject)
  from public.message_outbox o where o.to_address = 'mila@sarisari.ph';

-- ---------------------------------------------------------------- the monthly client report (pretend today is the 1st)
create or replace function private.today_ph() returns date language sql stable set search_path = '' as
  $f$ select (date_trunc('month', now() at time zone 'Asia/Manila') + interval '1 month')::date $f$;
delete from public.message_outbox;
select pg_temp.res('on the 1st, a report for each client', private.brand_reports() = 2, '');
select pg_temp.res('...the connected client''s owner gets it', o.subject = 'Dela Cruz & Co.: your permits this month' and o.from_name = 'Dela Cruz & Co.'
  and o.body_html like '%Carlo Bakery%' and o.body_html like '%Powered by%', o.subject)
  from public.message_outbox o where o.to_address = 'carlo@bakery.ph' and o.dedupe_key like 'brandrep:%';
select pg_temp.res('...the managed client''s contact too, told how to stop it', o.body_html like '%Hi Mila%' and o.body_html like '%To stop it, reply and tell them.%'
  and o.body_text like '%Mila Sari-sari%overdue%', left(o.body_text, 80))
  from public.message_outbox o where o.to_address = 'mila@sarisari.ph' and o.dedupe_key like 'brandrep:%';
select private.brand_reports();
select pg_temp.res('never twice in a month', (select count(*) from public.message_outbox where dedupe_key like 'brandrep:%') = 2, '');
update public.org_brands set client_report = false;
delete from public.message_outbox;
select pg_temp.res('the firm can switch the report off', private.brand_reports() = 0, '');
update public.org_brands set client_report = true;
create or replace function private.today_ph() returns date language sql stable set search_path = '' as $f$ select (now() at time zone 'Asia/Manila')::date $f$;
select pg_temp.res('not on other days', private.brand_reports() = 0 or extract(day from private.today_ph()) = 1, '');

-- ---------------------------------------------------------------- renewals, trial notices, lapsing
delete from public.notifications where kind = 'billing';
update public.addons set paid_through = private.today_ph() + 2 where kind = 'brand';
select private.plus_daily();
select pg_temp.res('the firm hears 2 days before the trial ends', exists (select 1 from public.notifications where org_id = (select firm from t_ids)
  and title = 'Your White-label trial ends on ' || private.fmt_date(private.today_ph() + 2)), '');
select pg_temp.res('no bill for a trial', not exists (select 1 from public.addon_invoices where kind = 'brand'), '');
update public.addons set trial = false, started_on = private.today_ph() - 30, paid_through = private.today_ph() + 5 where kind = 'brand';
select private.plus_daily();
select pg_temp.res('a paid White-label gets its next bill a week ahead', exists (select 1 from public.addon_invoices where kind = 'brand' and renewal
  and amount_php = 1000 and status = 'due' and period_start = private.today_ph() + 6), '');
delete from public.addon_invoices where kind = 'brand';
update public.orgs set trial_ends_at = now() - interval '1 day' where id = (select firm from t_ids);
select private.plus_daily();
select pg_temp.res('no bill once the firm plan itself has ended', not exists (select 1 from public.addon_invoices where kind = 'brand'), '');
select pg_temp.res('...and clients see PermitPal''s own look again', private.client_brand_json((select client from t_ids)) is null, '');
update public.orgs set trial_ends_at = now() + interval '5 days' where id = (select firm from t_ids);
select pg_temp.res('back on when the firm plan is', private.client_brand_json((select client from t_ids)) ->> 'name' = 'Dela Cruz & Co.', '');
update public.addons set paid_through = private.today_ph() - 1 where kind = 'brand';
select pg_temp.res('when White-label lapses, clients see PermitPal''s look; the settings stay', private.client_brand_json((select client from t_ids)) is null
  and exists (select 1 from public.org_brands where org_id = (select firm from t_ids)), '');
delete from public.notifications where kind = 'billing';
select private.plus_daily();
select pg_temp.res('...and the firm is told', exists (select 1 from public.notifications where org_id = (select firm from t_ids) and title = 'White-label has ended'), '');
update public.addons set paid_through = private.today_ph() + 20 where kind = 'brand';

-- ---------------------------------------------------------------- disconnecting
select pg_temp.as_user('e1000000-0000-4000-8000-0000000000a1');
set local role authenticated;
select public.link_end(link) from t_ids;
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.res('when the firm disconnects, the client is told their account stays theirs', exists (select 1 from public.notifications
  where user_id = 'e1000000-0000-4000-8000-0000000000b2' and title = 'You are no longer connected to Dela Cruz & Co.' and body like 'Your PermitPal account and everything in it stay yours, free.%'), '');
select pg_temp.res('...and their app goes back to PermitPal''s look', private.client_brand_json((select client from t_ids)) is null, '');

-- ---------------------------------------------------------------- staff and money
select pg_temp.as_user('e1000000-0000-4000-8000-0000000000f5');
set local role authenticated;
select pg_temp.res('staff can''t give White-label to a business', pg_temp.err(format('select public.admin_set_addon(%L, %L, null, %L)', other, 'brand', private.today_ph() + 30))
  = 'White-label is for Accounting firm workspaces.', '') from t_ids;
select public.admin_set_addon(firm, 'brand', null, private.today_ph() + 60, 'Pilot') from t_ids;
select pg_temp.res('staff can give a firm time', (select comped and paid_through = private.today_ph() + 60 from public.addons where org_id = (select firm from t_ids) and kind = 'brand'), '');
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
insert into public.addon_invoices (number, org_id, kind, billing, months, price_php, credit_php, amount_php, period_start, period_end, renewal, status, valid_until, paid_at)
  select 'PPA-T-1', firm, 'brand', 'yearly', 12, 10000, 0, 10000, private.today_ph(), private.today_ph() + 364, false, 'paid', private.today_ph() + 7, now() from t_ids;
update public.addons set comped = false where kind = 'brand';
select pg_temp.as_user('e1000000-0000-4000-8000-0000000000f5');
set local role authenticated;
select pg_temp.res('Money lists White-label payments', exists (select 1 from public.admin_money(private.today_ph() - 1, private.today_ph()) m where m.kind = 'white_label' and m.amount = 10000), '');
select pg_temp.res('the summary counts paying firms', (public.admin_money_summary() ->> 'brand_paying')::int = 1, '');
reset role; do $$ begin perform set_config('request.jwt.claims', '{}', true); end $$;
select pg_temp.res('the feature switch is on', exists (select 1 from private.features where name = 'brand'), '');

select n, step, ok, left(info, 90) as info from pg_temp.t_res order by n;
rollback;
