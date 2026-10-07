-- The founder's account (the address in private.settings admin_notify_emails) becomes PermitPal
-- staff as soon as that email address is confirmed. Unconfirmed sign-ups never get staff access.
create or replace function private.grant_staff_on_confirm() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email_confirmed_at is not null
     and lower(new.email) in (select lower(btrim(e)) from unnest(string_to_array(coalesce(private.setting('admin_notify_emails'), ''), ',')) e where btrim(e) <> '') then
    update public.profiles set is_platform_admin = true where id = new.id and not is_platform_admin;
  end if;
  return null;
end $$;
create trigger grant_staff_on_confirm after insert or update of email_confirmed_at on auth.users
  for each row execute function private.grant_staff_on_confirm();

-- Sign-ups that arrive already confirmed (e.g. Google): the profile row is created after the trigger
-- above runs, so also mark staff when the profile itself is created.
create or replace function private.staff_on_profile_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from auth.users u where u.id = new.id and u.email_confirmed_at is not null
             and lower(u.email) in (select lower(btrim(e)) from unnest(string_to_array(coalesce(private.setting('admin_notify_emails'), ''), ',')) e where btrim(e) <> '')) then
    new.is_platform_admin := true;
  end if;
  return new;
end $$;
create trigger profiles_staff_on_insert before insert on public.profiles for each row execute function private.staff_on_profile_insert();
