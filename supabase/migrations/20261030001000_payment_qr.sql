-- A payment QR code (for example a UnionBank QR Ph code, which GCash, Maya and any bank app can scan), shown
-- next to the GCash and bank details wherever a customer pays. Staff upload it in Admin > Payment details. It is
-- stored as a small image in the app settings (a data: URL, at most about 110 KB), so no file storage is needed.
alter table public.app_settings drop constraint app_settings_key_check;
alter table public.app_settings add constraint app_settings_key_check check (key in ('gcash_name','gcash_number','bank_name','bank_account_name',
  'bank_account_number','payment_note','online_payments','support_phone','support_email','sms_monthly_cap','billpay_fee','billpay_max','billpay_open',
  'payment_qr'));
alter table public.app_settings drop constraint app_settings_value_check;
alter table public.app_settings add constraint app_settings_value_check check (
  case when key = 'payment_qr'
    then length(value) <= 150000 and (value = '' or value ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$')
    else length(value) <= 500 end);
insert into public.app_settings (key, value) values ('payment_qr', '') on conflict (key) do nothing;

insert into private.features (name) values ('payqr') on conflict do nothing;
