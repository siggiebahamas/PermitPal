-- Text-message reminders: verifying a mobile number, and the checks every text passes before it is
-- sent. Rolled back at the end; every row should say ok = true.
begin;
create temp table t_res (n serial primary key, step text, ok boolean, info text);
grant all on t_res to authenticated, anon; grant all on sequence t_res_n_seq to authenticated, anon;
create function pg_temp.res(s text, ok boolean, info text default '') returns void language sql as
  $f$ insert into pg_temp.t_res(step, ok, info) values (s, coalesce(ok, false), coalesce(info, '')) $f$;
grant execute on function pg_temp.res(text, boolean, text) to authenticated, anon;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at) values
 ('d0000000-0000-4000-8000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','sms@t.ph','{"first_name":"Sam"}', now()),
 ('d0000000-0000-4000-8000-0000000000b2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','other@t.ph','{"first_name":"Oti"}', now());
update private.settings set value = '{}' where key = 'channel_status';

select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin perform public.start_phone_verification('0917 123 4567');
  perform pg_temp.res('no codes while texting is not switched on', false, 'was allowed');
exception when others then perform pg_temp.res('no codes while texting is not switched on', sqlerrm like '%not switched on%', sqlerrm); end $$;
reset role;
update private.settings set value = '{"email":true,"sms":true}' where key = 'channel_status';
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin perform public.start_phone_verification('12345');
  perform pg_temp.res('a number that is not a PH mobile is refused', false, 'was allowed');
exception when others then perform pg_temp.res('a number that is not a PH mobile is refused', sqlerrm like '%Philippine mobile%', sqlerrm); end $$;
select pg_temp.res('the code is texted to the number, written the usual way', (public.start_phone_verification('0917-123-4567') ->> 'phone') = '+639171234567', '');
do $$ begin perform public.start_phone_verification('09171234567');
  perform pg_temp.res('a second code within a minute is refused', false, 'was allowed');
exception when others then perform pg_temp.res('a second code within a minute is refused', sqlerrm like '%wait a minute%', sqlerrm); end $$;
reset role;
select pg_temp.res('the code goes out even before the number is verified', status = 'queued' and body_text ~ 'Pinoy Permit code: \d{6}', status)
  from public.message_outbox where dedupe_key like 'verify:d0000000-0000-4000-8000-0000000000a1:%';
select pg_temp.res('only a hash of the code is stored', code_hash !~ '^\d{6}$' and length(code_hash) = 64, '') from private.phone_codes where user_id = 'd0000000-0000-4000-8000-0000000000a1';
-- the test can't read the texted code, so it sets a known one
update private.phone_codes set code_hash = encode(extensions.digest('d0000000-0000-4000-8000-0000000000a1:123456', 'sha256'), 'hex')
 where user_id = 'd0000000-0000-4000-8000-0000000000a1';

select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-0000000000b2","role":"authenticated"}', true);
set local role authenticated;
do $$ begin perform public.confirm_phone_code('123456');
  perform pg_temp.res('someone else cannot use your code', false, 'was allowed');
exception when others then perform pg_temp.res('someone else cannot use your code', sqlerrm like '%expired%', sqlerrm); end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin perform public.confirm_phone_code('000000');
  perform pg_temp.res('a wrong code is refused and says how many tries are left', false, 'was allowed');
exception when others then perform pg_temp.res('a wrong code is refused and says how many tries are left', sqlerrm like '%not right%4 tries left%', sqlerrm); end $$;
select pg_temp.res('the right code (spaces are fine) verifies the number', public.confirm_phone_code(' 123 456 ') = '+639171234567', '');
select pg_temp.res('texts are switched on for them', sms_enabled, '') from public.notification_prefs where user_id = auth.uid();
do $$ begin update public.profiles set phone_verified_at = now() - interval '1 year' where id = auth.uid();
  perform pg_temp.res('people cannot fake or change verification by editing their profile',
    (select phone_verified_at > now() - interval '1 minute' from public.profiles where id = auth.uid()), 'update allowed but ignored');
exception when others then perform pg_temp.res('people cannot fake or change verification by editing their profile', true, sqlerrm); end $$;
reset role;
select pg_temp.res('the number is saved as verified', phone = '+639171234567' and phone_verified_at is not null, coalesce(phone, 'none'))
  from public.profiles where id = 'd0000000-0000-4000-8000-0000000000a1';

-- ---------------------------------------------------------------- texts on their way out
insert into public.message_outbox (user_id, channel, to_address, body_text, dedupe_key) values
  ('d0000000-0000-4000-8000-0000000000a1', 'sms', '+639171234567', 'Reminder 1', 't:1'),
  ('d0000000-0000-4000-8000-0000000000b2', 'sms', '+639990000000', 'To an unverified number', 't:2'),
  ('d0000000-0000-4000-8000-0000000000a1', 'sms', '+639990000000', 'To a number that is not theirs', 't:3');
select pg_temp.res('a text to a verified number is sent', status = 'queued', status) from public.message_outbox where dedupe_key = 't:1';
select pg_temp.res('a text to an unverified number is kept as skipped, with the reason', status = 'skipped' and last_error = 'Mobile number not verified', status) from public.message_outbox where dedupe_key = 't:2';
select pg_temp.res('a text to some other number is skipped', status = 'skipped', status) from public.message_outbox where dedupe_key = 't:3';
insert into public.message_outbox (user_id, channel, to_address, body_text, dedupe_key) values
  ('d0000000-0000-4000-8000-0000000000a1', 'sms', '+639171234567', 'Reminder 2', 't:4'),
  ('d0000000-0000-4000-8000-0000000000a1', 'sms', '+639171234567', 'Reminder 3', 't:5'),
  ('d0000000-0000-4000-8000-0000000000a1', 'sms', '+639171234567', 'Reminder 4', 't:6');
select pg_temp.res('no more than 3 texts a day per person', (select status from public.message_outbox where dedupe_key = 't:6') = 'skipped'
  and (select last_error from public.message_outbox where dedupe_key = 't:6') like 'Daily text limit%', '');
update public.app_settings set value = '1' where key = 'sms_monthly_cap';
update public.message_outbox set created_at = now() - interval '2 days' where dedupe_key in ('t:1','t:4','t:5');
insert into public.message_outbox (user_id, channel, to_address, body_text, dedupe_key) values ('d0000000-0000-4000-8000-0000000000a1', 'sms', '+639171234567', 'Over the cap', 't:7');
select pg_temp.res('the monthly cap staff set is respected', status = 'skipped' and last_error = 'Monthly text limit reached', coalesce(last_error, status)) from public.message_outbox where dedupe_key = 't:7';
insert into public.message_outbox (user_id, channel, to_address, body_text, dedupe_key) values ('d0000000-0000-4000-8000-0000000000a1', 'email', 'sms@t.ph', 'Email is not limited', 't:8');
select pg_temp.res('emails are not affected', status = 'queued', status) from public.message_outbox where dedupe_key = 't:8';
select pg_temp.res('team plans include texts', bool_and(paid_channels), string_agg(id || '=' || paid_channels, ',')) from public.plans where id in ('fleet','firm','head_office','property');

-- changing or removing the number
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
update public.profiles set phone = '+639188888888' where id = auth.uid();
select pg_temp.res('changing the number means verifying again', phone_verified_at is null, '') from public.profiles where id = auth.uid();
select public.remove_phone();
select pg_temp.res('removing the number stops texts', p.phone is null and not np.sms_enabled, '') from public.profiles p join public.notification_prefs np on np.user_id = p.id where p.id = auth.uid();
reset role;

select n, step, ok, left(info, 90) as info from pg_temp.t_res order by n;
rollback;
