-- Two-step login (an authenticator app code after the password), using Supabase Auth's built-in TOTP.
-- 1) Owners can require it for their workspace. It is enforced in the database, not just the screen:
--    the membership helpers every access rule uses leave out a workspace that requires it until the
--    session has passed the second step (JWT claim aal = aal2).
-- 2) People locked out of such a workspace can see which one and why, so the app can walk them through.
-- 3) Lost phone: PermitPal staff can remove someone's two-step login after confirming who they are.
--    The person is told by email straight away, and every reset is logged.

alter table public.orgs add column if not exists require_mfa boolean not null default false;

create or replace function private.session_aal2() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
$$;

-- The membership helpers, now skipping workspaces that require two-step login when this session hasn't done it.
create or replace function private.my_org_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.org_id from public.org_members m join public.orgs o on o.id = m.org_id
  where m.user_id = (select auth.uid()) and (not o.require_mfa or (select private.session_aal2()))
$$;
create or replace function private.my_writable_org_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.org_id from public.org_members m join public.orgs o on o.id = m.org_id
  where m.user_id = (select auth.uid()) and m.role in ('owner','admin','member') and (not o.require_mfa or (select private.session_aal2()))
$$;
create or replace function private.my_admin_org_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.org_id from public.org_members m join public.orgs o on o.id = m.org_id
  where m.user_id = (select auth.uid()) and m.role in ('owner','admin') and (not o.require_mfa or (select private.session_aal2()))
$$;
create or replace function private.my_owner_org_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.org_id from public.org_members m join public.orgs o on o.id = m.org_id
  where m.user_id = (select auth.uid()) and m.role = 'owner' and (not o.require_mfa or (select private.session_aal2()))
$$;
create or replace function private.member_role(p_org uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.role from public.org_members m join public.orgs o on o.id = m.org_id
  where m.org_id = p_org and m.user_id = (select auth.uid()) and (not o.require_mfa or (select private.session_aal2()))
$$;

-- Which of my workspaces are closed to this session until two-step login is done (name only).
create or replace function public.my_locked_orgs() returns table (id uuid, name text)
language sql stable security definer set search_path = '' as $$
  select o.id, o.name from public.org_members m join public.orgs o on o.id = m.org_id
  where m.user_id = (select auth.uid()) and o.require_mfa and o.deleted_at is null and not (select private.session_aal2())
$$;
revoke all on function public.my_locked_orgs() from public, anon;
grant execute on function public.my_locked_orgs() to authenticated;

-- Owners switch the requirement on or off. To switch it on they must have done it themselves first,
-- so nobody locks themselves out.
create or replace function public.set_require_mfa(p_org uuid, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_name text; v_m record;
begin
  if p_org not in (select private.my_owner_org_ids()) then raise exception 'Only the owner can change this.' using errcode = '42501'; end if;
  if p_on and not private.session_aal2() then
    raise exception 'Turn on two-step login for yourself first (Settings → Two-step login), then try again.' using errcode = 'P0001';
  end if;
  update public.orgs set require_mfa = coalesce(p_on, false) where id = p_org returning name into v_name;
  if p_on then
    for v_m in select user_id from public.org_members where org_id = p_org and user_id <> auth.uid() loop
      perform private.notify(v_m.user_id, p_org, 'team', v_name || ' now requires two-step login',
        'Next time you open it, you will be asked to set up an authenticator app (about 2 minutes).',
        '#/settings', null, 'mfareq:' || p_org || ':' || v_m.user_id || ':' || extract(epoch from now())::bigint, true);
    end loop;
  end if;
end $$;
revoke all on function public.set_require_mfa(uuid, boolean) from public, anon;
grant execute on function public.set_require_mfa(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------- lost phone: staff reset
create table if not exists private.mfa_resets (
  id          bigint generated always as identity primary key,
  user_id     uuid not null,
  email       text not null,
  staff_id    uuid,
  reason      text not null,
  factors     int not null,
  created_at  timestamptz not null default now()
);

create or replace function public.admin_reset_mfa(p_email text, p_reason text) returns int
language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_n int;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'Write how you confirmed who they are (at least a short sentence).' using errcode = '22023'; end if;
  select id into v_user from auth.users where lower(email) = lower(btrim(p_email));
  if v_user is null then raise exception 'No account with that email.' using errcode = 'P0002'; end if;
  if v_user = auth.uid() then raise exception 'Ask another staff member to reset your own two-step login.' using errcode = 'P0001'; end if;
  delete from auth.mfa_factors where user_id = v_user;
  get diagnostics v_n = row_count;
  insert into private.mfa_resets (user_id, email, staff_id, reason, factors) values (v_user, lower(btrim(p_email)), auth.uid(), btrim(p_reason), v_n);
  perform private.notify(v_user, null, 'system', 'Two-step login was turned off for your account',
    'PermitPal support removed your authenticator app after confirming your identity. Sign in with your password and set up two-step login again. If you did not ask for this, contact us right away.',
    '#/settings', null, 'mfareset:' || v_user || ':' || extract(epoch from now())::bigint, true);
  return v_n;
end $$;
revoke all on function public.admin_reset_mfa(text, text) from public, anon;
grant execute on function public.admin_reset_mfa(text, text) to authenticated;

insert into private.features (name) values ('mfa') on conflict do nothing;
