-- Text-message (SMS) reminders, only to mobile numbers the person has proved are theirs.
-- 1) Verifying a number: we text a 6-digit code (hashed here, 10 minutes, 5 tries, 5 codes a day).
-- 2) Every SMS in the outbox is checked on its way in: it must go to its owner's verified number, at most
--    3 a day per person, and under the monthly cap staff set (texts cost money). Anything else is kept in
--    the log as "skipped" with the reason, never silently dropped.
-- 3) Changing the number un-verifies it. Team plans include text reminders.

alter table public.profiles add column if not exists phone_verified_at timestamptz;

-- Only the verification functions can mark a number verified; changing the number clears it.
create or replace function private.profile_phone_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('pp.phone_rpc', true), 'off') = 'on' then return new; end if;
  if new.phone is distinct from old.phone then new.phone_verified_at := null;
  else new.phone_verified_at := old.phone_verified_at; end if;
  return new;
end $$;
drop trigger if exists profiles_phone_guard on public.profiles;
create trigger profiles_phone_guard before update on public.profiles for each row execute function private.profile_phone_guard();

create table if not exists private.phone_codes (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  phone         text not null,
  code_hash     text not null,
  expires_at    timestamptz not null,
  attempts      int not null default 0,
  sends         int not null default 1,
  first_sent_at timestamptz not null default now(),
  last_sent_at  timestamptz not null default now()
);

-- Philippine mobile numbers only, as +639XXXXXXXXX.
create or replace function private.ph_mobile(p text) returns text
language sql immutable set search_path = '' as $$
  select case
    when d ~ '^09\d{9}$' then '+63' || substr(d, 2)
    when d ~ '^9\d{9}$' then '+63' || d
    when d ~ '^639\d{9}$' then '+' || d
  end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
$$;

create or replace function public.start_phone_verification(p_phone text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_phone text := private.ph_mobile(p_phone); v_row private.phone_codes; v_code text; v_new_day boolean;
begin
  if v_uid is null then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if v_phone is null then raise exception 'Enter a Philippine mobile number, like 0917 123 4567.' using errcode = '22023'; end if;
  if coalesce((nullif(private.setting('channel_status'), '')::jsonb ->> 'sms'), 'false') <> 'true' then
    raise exception 'Text messages are not switched on yet. Please try again later.' using errcode = 'P0001';
  end if;
  select * into v_row from private.phone_codes where user_id = v_uid;
  if v_row.user_id is not null and v_row.last_sent_at > now() - interval '60 seconds' then
    raise exception 'Please wait a minute before asking for another code.' using errcode = 'P0001';
  end if;
  v_new_day := v_row.user_id is null or v_row.first_sent_at < now() - interval '1 day';
  if not v_new_day and v_row.sends >= 5 then
    raise exception 'Too many codes today. Please try again tomorrow.' using errcode = 'P0001';
  end if;
  v_code := lpad((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000)::text, 6, '0');
  insert into private.phone_codes as c (user_id, phone, code_hash, expires_at, attempts, sends, first_sent_at, last_sent_at)
  values (v_uid, v_phone, encode(extensions.digest(v_uid::text || ':' || v_code, 'sha256'), 'hex'), now() + interval '10 minutes', 0, 1, now(), now())
  on conflict (user_id) do update set phone = excluded.phone, code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0,
    sends = case when v_new_day then 1 else c.sends + 1 end, first_sent_at = case when v_new_day then now() else c.first_sent_at end, last_sent_at = now();
  insert into public.message_outbox (user_id, channel, to_address, body_text, dedupe_key)
  values (v_uid, 'sms', v_phone, 'PermitPal code: ' || v_code || '. It expires in 10 minutes. Never share this code with anyone.',
          'verify:' || v_uid || ':' || extract(epoch from clock_timestamp())::bigint);
  return jsonb_build_object('phone', v_phone, 'expires_at', now() + interval '10 minutes');
end $$;
revoke all on function public.start_phone_verification(text) from public, anon;
grant execute on function public.start_phone_verification(text) to authenticated;

create or replace function public.confirm_phone_code(p_code text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_row private.phone_codes;
begin
  if v_uid is null then raise exception 'Not allowed.' using errcode = '42501'; end if;
  select * into v_row from private.phone_codes where user_id = v_uid for update;
  if v_row.user_id is null or v_row.expires_at < now() then raise exception 'That code has expired. Ask for a new one.' using errcode = 'P0001'; end if;
  if v_row.attempts >= 5 then raise exception 'Too many wrong tries. Ask for a new code.' using errcode = 'P0001'; end if;
  if encode(extensions.digest(v_uid::text || ':' || regexp_replace(coalesce(p_code, ''), '\D', '', 'g'), 'sha256'), 'hex') <> v_row.code_hash then
    update private.phone_codes set attempts = attempts + 1 where user_id = v_uid;
    raise exception 'That code is not right. Check the text message and try again (% tries left).', 4 - v_row.attempts using errcode = 'P0001';
  end if;
  perform set_config('pp.phone_rpc', 'on', true);
  update public.profiles set phone = v_row.phone, phone_verified_at = now() where id = v_uid;
  perform set_config('pp.phone_rpc', 'off', true);
  insert into public.notification_prefs (user_id, sms_enabled) values (v_uid, true)
  on conflict (user_id) do update set sms_enabled = true;
  delete from private.phone_codes where user_id = v_uid;
  return v_row.phone;
end $$;
revoke all on function public.confirm_phone_code(text) from public, anon;
grant execute on function public.confirm_phone_code(text) to authenticated;

-- Stop texts and forget the number.
create or replace function public.remove_phone() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not allowed.' using errcode = '42501'; end if;
  perform set_config('pp.phone_rpc', 'on', true);
  update public.profiles set phone = null, phone_verified_at = null where id = auth.uid();
  perform set_config('pp.phone_rpc', 'off', true);
  update public.notification_prefs set sms_enabled = false where user_id = auth.uid();
  delete from private.phone_codes where user_id = auth.uid();
end $$;
revoke all on function public.remove_phone() from public, anon;
grant execute on function public.remove_phone() to authenticated;

-- ================================================================ every text is checked on its way out
alter table public.app_settings drop constraint if exists app_settings_key_check;
alter table public.app_settings add constraint app_settings_key_check check (key in ('gcash_name','gcash_number','bank_name','bank_account_name',
  'bank_account_number','payment_note','online_payments','support_phone','support_email','sms_monthly_cap'));
insert into public.app_settings (key, value) values ('sms_monthly_cap', '1000') on conflict (key) do nothing;

create or replace function private.outbox_sms_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_cap int;
begin
  if new.channel <> 'sms' or new.status <> 'queued' then return new; end if;
  if new.dedupe_key like 'verify:%' then return new; end if;  -- the code itself goes to the number being verified
  if new.user_id is null or not exists (select 1 from public.profiles p where p.id = new.user_id and p.phone = new.to_address and p.phone_verified_at is not null) then
    new.status := 'skipped'; new.last_error := 'Mobile number not verified'; return new;
  end if;
  if (select count(*) from public.message_outbox m where m.channel = 'sms' and m.user_id = new.user_id and m.status <> 'skipped'
        and m.created_at > now() - interval '1 day' and m.dedupe_key not like 'verify:%') >= 3 then
    new.status := 'skipped'; new.last_error := 'Daily text limit reached (3 a day)'; return new;
  end if;
  v_cap := coalesce(nullif((select value from public.app_settings where key = 'sms_monthly_cap'), '')::int, 1000);
  if (select count(*) from public.message_outbox m where m.channel = 'sms' and m.status <> 'skipped'
        and m.created_at >= date_trunc('month', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila') >= v_cap then
    new.status := 'skipped'; new.last_error := 'Monthly text limit reached'; return new;
  end if;
  new.body_text := left(new.body_text, 300);
  return new;
end $$;
drop trigger if exists message_outbox_sms_guard on public.message_outbox;
create trigger message_outbox_sms_guard before insert on public.message_outbox for each row execute function private.outbox_sms_guard();

-- Team plans include text reminders.
update public.plans set paid_channels = true where id in ('fleet', 'firm', 'head_office', 'property');

insert into private.features (name) values ('sms') on conflict do nothing;
