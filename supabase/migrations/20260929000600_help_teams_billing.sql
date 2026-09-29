-- Help requests routed to PermitPal staff, team invites and roles, billing (PayMongo),
-- workspace deletion, and the platform-admin console.

-- ================================================================ help requests
create function private.assistance_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_rs record;
begin
  if tg_op = 'INSERT' then
    select rs.name, rs.subject_name, rs.plate_no, rs.location_name, rs.location_is_main, rs.location_city, rs.expires_on
      into v_rs from public.requirement_status rs where rs.id = new.requirement_id and rs.org_id = new.org_id;
    if v_rs.name is null then raise exception 'That requirement was not found.' using errcode = '23503'; end if;
    if exists (select 1 from public.assistance_requests a where a.requirement_id = new.requirement_id
               and a.status not in ('completed','cancelled')) then
      raise exception 'You already have an open help request for this requirement.' using errcode = 'P0001';
    end if;
    -- Snapshot what we know so PermitPal staff never have to ask again.
    new.requirement_name := v_rs.name;
    new.subject_label := coalesce(v_rs.subject_name, '') || case when coalesce(v_rs.plate_no, '') <> '' then ' (' || v_rs.plate_no || ')' else '' end;
    new.location_label := nullif(concat_ws(', ', case when not coalesce(v_rs.location_is_main, true) then v_rs.location_name end, nullif(v_rs.location_city, '')), '');
    new.due_on := v_rs.expires_on;
    new.status := 'submitted';
    new.provider_name := null; new.quote_php := null; new.admin_note := null; new.closed_at := null;
    new.created_by := auth.uid();
    return new;
  end if;

  -- Customers may only cancel a request or edit their own notes; staff fields are theirs.
  if auth.uid() is not null and not private.is_platform_admin() then
    if new.status is distinct from old.status and (new.status <> 'cancelled' or old.status in ('completed','cancelled')) then
      raise exception 'You can only cancel an open request.' using errcode = '42501';
    end if;
    new.provider_name := old.provider_name; new.quote_php := old.quote_php; new.admin_note := old.admin_note;
    new.requirement_id := old.requirement_id; new.requirement_name := old.requirement_name;
    new.subject_label := old.subject_label; new.location_label := old.location_label; new.due_on := old.due_on;
    new.docs_status := old.docs_status; new.created_by := old.created_by;
  end if;
  if new.status in ('completed','cancelled') and old.status not in ('completed','cancelled') then
    new.closed_at := now();
  elsif new.status not in ('completed','cancelled') then
    new.closed_at := null;
  end if;
  return new;
end $$;
create trigger assistance_requests_before before insert or update on public.assistance_requests
  for each row execute function private.assistance_before();

create function private.assistance_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_org_name text;
  v_requester text;
  v_contact text;
  v_admin record;
  v_email text;
  v_body text;
  v_html text;
begin
  select name into v_org_name from public.orgs where id = new.org_id;

  if tg_op = 'INSERT' then
    select coalesce(nullif(btrim(p.first_name || ' ' || p.last_name), ''), p.email), p.email into v_requester, v_contact
      from public.profiles p where p.id = new.created_by;
    v_body := v_org_name || ' - ' || new.requirement_name || ' for ' || new.subject_label ||
              case when new.due_on is not null then ', due ' || private.fmt_date(new.due_on) else '' end;

    -- In-app alert for every PermitPal staff account.
    for v_admin in select id from public.profiles where is_platform_admin loop
      perform private.notify(v_admin.id, null, 'help', 'New help request: ' || new.requirement_name, v_body,
                             '#/admin', null, 'helpnew:' || new.id || ':' || v_admin.id, false);
    end loop;

    -- Email to the addresses configured in private.settings.admin_notify_emails.
    v_html := '<table style="font-size:14px;line-height:1.6">'
      || '<tr><td style="color:#6B7585;padding-right:12px">Workspace</td><td>' || private.html_escape(v_org_name) || '</td></tr>'
      || '<tr><td style="color:#6B7585;padding-right:12px">Requirement</td><td>' || private.html_escape(new.requirement_name) || '</td></tr>'
      || '<tr><td style="color:#6B7585;padding-right:12px">For</td><td>' || private.html_escape(new.subject_label) || '</td></tr>'
      || '<tr><td style="color:#6B7585;padding-right:12px">Location</td><td>' || private.html_escape(coalesce(new.location_label, '-')) || '</td></tr>'
      || '<tr><td style="color:#6B7585;padding-right:12px">Due</td><td>' || private.fmt_date(new.due_on) || '</td></tr>'
      || '<tr><td style="color:#6B7585;padding-right:12px">Documents</td><td>' || case new.docs_status when 'have' then 'Already uploaded to PermitPal' when 'need' then 'Customer needs to obtain them' else 'Not sure' end || '</td></tr>'
      || '<tr><td style="color:#6B7585;padding-right:12px">Requested by</td><td>' || private.html_escape(coalesce(v_requester, '-')) || ' (' || private.html_escape(coalesce(v_contact, '-')) || ')</td></tr>'
      || '<tr><td style="color:#6B7585;padding-right:12px">Contact via</td><td>' || private.html_escape(new.contact_method || coalesce(': ' || new.contact_value, '')) || '</td></tr>'
      || '<tr><td style="color:#6B7585;padding-right:12px;vertical-align:top">Notes</td><td>' || private.html_escape(coalesce(new.notes, '-')) || '</td></tr></table>';
    for v_email in select btrim(e) from unnest(string_to_array(coalesce(private.setting('admin_notify_emails'), ''), ',')) e where btrim(e) <> '' loop
      insert into public.message_outbox (org_id, channel, to_address, subject, body_text, body_html, dedupe_key)
      values (new.org_id, 'email', v_email, 'New help request: ' || new.requirement_name || ' (' || v_org_name || ')',
              v_body || E'\nContact: ' || new.contact_method || coalesce(': ' || new.contact_value, '') || E'\nNotes: ' || coalesce(new.notes, '-'),
              private.email_html('New help request', v_html, 'Open admin console', private.setting('app_url') || '#/admin'),
              'helpmail:' || new.id || ':' || v_email)
      on conflict (dedupe_key) do nothing;
    end loop;

    -- Confirmation for the customer.
    if new.created_by is not null then
      perform private.notify(new.created_by, new.org_id, 'help', 'We received your help request',
        'Request for ' || new.requirement_name || ' (' || new.subject_label || '). We''ll get back to you with next steps and a quote.',
        '#/help', new.requirement_id, 'helpack:' || new.id, true);
    end if;
    return null;
  end if;

  -- Staff updated the request: tell the customer.
  if (new.status is distinct from old.status or new.admin_note is distinct from old.admin_note or new.quote_php is distinct from old.quote_php)
     and new.created_by is not null and (auth.uid() is null or private.is_platform_admin()) then
    perform private.notify(new.created_by, new.org_id, 'help',
      'Help request update: ' || private.help_status_label(new.status),
      new.requirement_name || ' (' || new.subject_label || ')' ||
        case when new.quote_php is not null then '. Quote: PHP ' || to_char(new.quote_php, 'FM999,999,990.00') else '' end ||
        case when new.provider_name is not null then '. Handled by ' || new.provider_name else '' end ||
        case when new.admin_note is not null then '. ' || new.admin_note else '' end,
      '#/help', new.requirement_id, 'helpupd:' || new.id || ':' || extract(epoch from new.updated_at)::bigint, true);
  end if;

  -- Customer cancelled: let staff know.
  if new.status = 'cancelled' and old.status <> 'cancelled' and auth.uid() is not null and not private.is_platform_admin() then
    for v_admin in select id from public.profiles where is_platform_admin loop
      perform private.notify(v_admin.id, null, 'help', 'Help request cancelled: ' || new.requirement_name,
        v_org_name || ' - ' || new.subject_label, '#/admin', null, 'helpcancel:' || new.id || ':' || v_admin.id, false);
    end loop;
  end if;
  return null;
end $$;
create trigger assistance_requests_after after insert or update on public.assistance_requests
  for each row execute function private.assistance_after();

-- ================================================================ teams
create table public.org_invites (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  email        text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role         text not null default 'member' check (role in ('admin','member','viewer')),
  token        text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  invited_by   uuid default auth.uid() references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '14 days',
  accepted_at  timestamptz,
  accepted_by  uuid references auth.users(id) on delete set null,
  revoked_at   timestamptz
);
create unique index org_invites_one_pending on public.org_invites (org_id, lower(email)) where accepted_at is null and revoked_at is null;

alter table public.org_invites enable row level security;
create policy org_invites_read on public.org_invites for select to authenticated using (org_id in (select private.my_admin_org_ids()));
create policy org_invites_insert on public.org_invites for insert to authenticated with check (org_id in (select private.my_admin_org_ids()));
create policy org_invites_update on public.org_invites for update to authenticated
  using (org_id in (select private.my_admin_org_ids())) with check (org_id in (select private.my_admin_org_ids()));
revoke delete on public.org_invites from anon, authenticated;
revoke all on public.org_invites from anon;
revoke update on public.org_invites from authenticated;
grant update (revoked_at) on public.org_invites to authenticated;

create function private.seats_left(p_org uuid) returns int
language sql stable security definer set search_path = '' as $$
  select case when pl.max_members is null then 1000000 else pl.max_members
    - (select count(*) from public.org_members m where m.org_id = p_org)::int
    - (select count(*) from public.org_invites i where i.org_id = p_org and i.accepted_at is null and i.revoked_at is null and i.expires_at > now())::int
  end
  from public.plans pl where pl.id = private.effective_plan_id(p_org)
$$;

create function private.org_invites_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_max int;
begin
  new.email := lower(btrim(new.email));
  new.invited_by := auth.uid();
  new.accepted_at := null; new.accepted_by := null; new.revoked_at := null;
  if exists (select 1 from public.org_members m join public.profiles p on p.id = m.user_id
             where m.org_id = new.org_id and lower(p.email) = new.email) then
    raise exception 'That person is already on the team.' using errcode = 'P0001';
  end if;
  if private.seats_left(new.org_id) <= 0 then
    select pl.max_members into v_max from public.plans pl where pl.id = private.effective_plan_id(new.org_id);
    raise exception 'Your plan includes % team member%. Upgrade to invite more people.', v_max, case when v_max = 1 then '' else 's' end
      using errcode = 'P0001', hint = 'plan_limit';
  end if;
  return new;
end $$;
create trigger org_invites_before before insert on public.org_invites for each row execute function private.org_invites_before();

create function private.org_invites_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_org text;
  v_by text;
  v_url text;
begin
  select name into v_org from public.orgs where id = new.org_id;
  select coalesce(nullif(btrim(first_name || ' ' || last_name), ''), email) into v_by from public.profiles where id = new.invited_by;
  v_url := private.setting('app_url') || '#/invite/' || new.token;
  insert into public.message_outbox (org_id, channel, to_address, subject, body_text, body_html, dedupe_key)
  values (new.org_id, 'email', new.email,
          coalesce(v_by, 'Someone') || ' invited you to ' || v_org || ' on PermitPal',
          coalesce(v_by, 'Someone') || ' invited you to help manage permits and registrations for ' || v_org || E' on PermitPal.\n\nAccept: ' || v_url,
          private.email_html('You''re invited to ' || v_org,
            '<p style="margin:0;line-height:1.5">' || private.html_escape(coalesce(v_by, 'Someone')) || ' invited you to help manage permits and registrations for <b>'
            || private.html_escape(v_org) || '</b> on PermitPal. Sign up or log in with this email address (' || private.html_escape(new.email) || ') to join. The link works for 14 days.</p>',
            'Accept invitation', v_url),
          'invite:' || new.id);
  return null;
end $$;
create trigger org_invites_after after insert on public.org_invites for each row execute function private.org_invites_after();

-- What the invitation page shows before the person logs in.
create function public.invite_preview(p_token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'org_name', o.name, 'email', i.email, 'role', i.role,
    'invited_by', coalesce(nullif(btrim(p.first_name || ' ' || p.last_name), ''), p.email),
    'status', case when i.revoked_at is not null then 'revoked' when i.accepted_at is not null then 'accepted'
                   when i.expires_at < now() then 'expired' else 'pending' end)
  from public.org_invites i join public.orgs o on o.id = i.org_id
  left join public.profiles p on p.id = i.invited_by
  where i.token = p_token
$$;

create function public.accept_invite(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.org_invites;
  v_email text;
  v_max int;
  v_count int;
begin
  if v_uid is null then raise exception 'Please sign in first.' using errcode = '28000'; end if;
  select * into v_inv from public.org_invites where token = p_token for update;
  if v_inv.id is null or v_inv.revoked_at is not null then raise exception 'This invitation is no longer valid.' using errcode = 'P0001'; end if;
  if v_inv.accepted_at is not null then
    if exists (select 1 from public.org_members where org_id = v_inv.org_id and user_id = v_uid) then return v_inv.org_id; end if;
    raise exception 'This invitation was already used.' using errcode = 'P0001';
  end if;
  if v_inv.expires_at < now() then raise exception 'This invitation has expired. Ask for a new one.' using errcode = 'P0001'; end if;
  select lower(email) into v_email from auth.users where id = v_uid;
  if v_email is distinct from v_inv.email then
    raise exception 'This invitation was sent to %. Log in with that email address to accept it.', v_inv.email using errcode = '42501';
  end if;
  select pl.max_members into v_max from public.plans pl where pl.id = private.effective_plan_id(v_inv.org_id);
  select count(*) into v_count from public.org_members where org_id = v_inv.org_id;
  if v_max is not null and v_count >= v_max then
    raise exception 'This team is full on its current plan. Ask the owner to upgrade.' using errcode = 'P0001', hint = 'plan_limit';
  end if;
  insert into public.org_members (org_id, user_id, role) values (v_inv.org_id, v_uid, v_inv.role) on conflict do nothing;
  update public.org_invites set accepted_at = now(), accepted_by = v_uid where id = v_inv.id;
  update public.profiles set current_org_id = v_inv.org_id where id = v_uid;
  if v_inv.invited_by is not null then
    perform private.notify(v_inv.invited_by, v_inv.org_id, 'team', coalesce(v_email, 'Someone') || ' joined your team',
      'They accepted your invitation as ' || v_inv.role || '.', '#/team', null, 'joined:' || v_inv.id, false);
  end if;
  return v_inv.org_id;
end $$;

create function public.set_member_role(p_org uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me text := private.member_role(p_org);
  v_old text;
begin
  if v_me is null or v_me not in ('owner','admin') then raise exception 'Only owners and admins can change roles.' using errcode = '42501'; end if;
  if p_role not in ('owner','admin','member','viewer') then raise exception 'Unknown role.' using errcode = '22023'; end if;
  select role into v_old from public.org_members where org_id = p_org and user_id = p_user;
  if v_old is null then raise exception 'That person is not on this team.' using errcode = 'P0001'; end if;
  if (v_old = 'owner' or p_role = 'owner') and v_me <> 'owner' then
    raise exception 'Only an owner can give or take away the owner role.' using errcode = '42501';
  end if;
  if v_old = 'owner' and p_role <> 'owner' and (select count(*) from public.org_members where org_id = p_org and role = 'owner') = 1 then
    raise exception 'A workspace needs at least one owner. Make someone else an owner first.' using errcode = 'P0001';
  end if;
  update public.org_members set role = p_role where org_id = p_org and user_id = p_user;
end $$;

create function public.remove_member(p_org uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me text := private.member_role(p_org);
  v_role text;
begin
  select role into v_role from public.org_members where org_id = p_org and user_id = p_user;
  if v_role is null then return; end if;
  if p_user <> auth.uid() and (v_me is null or v_me not in ('owner','admin')) then
    raise exception 'Only owners and admins can remove people.' using errcode = '42501';
  end if;
  if v_role = 'owner' and p_user <> auth.uid() and v_me <> 'owner' then
    raise exception 'Only an owner can remove another owner.' using errcode = '42501';
  end if;
  if v_role = 'owner' and (select count(*) from public.org_members where org_id = p_org and role = 'owner') = 1 then
    raise exception 'A workspace needs at least one owner. Make someone else an owner first.' using errcode = 'P0001';
  end if;
  delete from public.org_members where org_id = p_org and user_id = p_user;
  update public.profiles set current_org_id = null where id = p_user and current_org_id = p_org;
end $$;

revoke execute on function public.accept_invite(text), public.set_member_role(uuid,uuid,text), public.remove_member(uuid,uuid) from public, anon;
grant execute on function public.accept_invite(text), public.set_member_role(uuid,uuid,text), public.remove_member(uuid,uuid) to authenticated;
grant execute on function public.invite_preview(text) to anon, authenticated;

-- ================================================================ billing
create table public.payments (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  plan_id       text not null references public.plans(id),
  months        int not null default 1 check (months between 1 and 12),
  amount_php    numeric(12,2) not null,
  provider      text not null default 'paymongo',
  checkout_id   text unique,
  checkout_url  text,
  status        text not null default 'pending' check (status in ('pending','paid','expired','failed')),
  paid_at       timestamptz,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  raw           jsonb
);
create index payments_org_idx on public.payments(org_id, created_at desc);
alter table public.payments enable row level security;
create policy payments_read on public.payments for select to authenticated
  using (org_id in (select private.my_admin_org_ids()) or (select private.is_platform_admin()));
revoke insert, update, delete on public.payments from anon, authenticated;
revoke all on public.payments from anon;

-- Called by the create-checkout function with the customer's own login.
create function public.billing_start(p_org uuid, p_plan text, p_months int default 1) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.plans;
  v_id uuid;
begin
  if private.member_role(p_org) is distinct from 'owner' then
    raise exception 'Only the workspace owner can change the plan.' using errcode = '42501';
  end if;
  select * into v_plan from public.plans where id = p_plan;
  if v_plan.id is null or coalesce(v_plan.price_php_monthly, 0) <= 0 then
    raise exception 'That plan is not available for online payment yet.' using errcode = 'P0001';
  end if;
  if p_months not between 1 and 12 then raise exception 'Choose between 1 and 12 months.' using errcode = '22023'; end if;
  insert into public.payments (org_id, plan_id, months, amount_php, created_by)
  values (p_org, p_plan, p_months, v_plan.price_php_monthly * p_months, auth.uid()) returning id into v_id;
  return jsonb_build_object('payment_id', v_id, 'amount_php', v_plan.price_php_monthly * p_months,
    'plan_name', v_plan.name, 'months', p_months,
    'org_name', (select name from public.orgs where id = p_org),
    'email', (select email from public.profiles where id = auth.uid()));
end $$;
revoke execute on function public.billing_start(uuid,text,int) from public, anon;
grant execute on function public.billing_start(uuid,text,int) to authenticated;

create function public.billing_attach_checkout(p_payment uuid, p_checkout_id text, p_url text) returns void
language sql security definer set search_path = '' as $$
  update public.payments set checkout_id = p_checkout_id, checkout_url = p_url where id = p_payment and status = 'pending'
$$;

-- Webhook: a checkout was paid. Idempotent - safe if PayMongo retries.
create function public.billing_mark_paid(p_checkout_id text, p_raw jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_pay public.payments;
  v_org public.orgs;
  v_from timestamptz;
  v_owner record;
begin
  select * into v_pay from public.payments where checkout_id = p_checkout_id for update;
  if v_pay.id is null or v_pay.status = 'paid' then return; end if;
  select * into v_org from public.orgs where id = v_pay.org_id for update;
  v_from := case when v_org.plan_id = v_pay.plan_id and v_org.plan_expires_at > now() then v_org.plan_expires_at else now() end;
  update public.payments set status = 'paid', paid_at = now(), raw = p_raw where id = v_pay.id;
  update public.orgs set plan_id = v_pay.plan_id, plan_expires_at = v_from + make_interval(months => v_pay.months) where id = v_org.id;
  for v_owner in select user_id from public.org_members where org_id = v_org.id and role = 'owner' loop
    perform private.notify(v_owner.user_id, v_org.id, 'billing', 'Payment received - thank you!',
      'Your ' || (select name from public.plans where id = v_pay.plan_id) || ' plan is active until ' ||
      private.fmt_date(((v_from + make_interval(months => v_pay.months)) at time zone 'Asia/Manila')::date) || '.',
      '#/settings/billing', null, 'paid:' || v_pay.id, true);
  end loop;
end $$;

revoke execute on function public.billing_attach_checkout(uuid,text,text), public.billing_mark_paid(text,jsonb) from public, anon, authenticated;
grant execute on function public.billing_attach_checkout(uuid,text,text), public.billing_mark_paid(text,jsonb) to service_role;

-- ================================================================ workspace deletion (Data Privacy Act)
create function public.request_org_deletion(p_org uuid) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  v_when timestamptz := now() + interval '30 days';
  v_m record;
  v_name text;
begin
  if private.member_role(p_org) is distinct from 'owner' then
    raise exception 'Only the workspace owner can delete it.' using errcode = '42501';
  end if;
  update public.orgs set deleted_at = now(), purge_after = v_when where id = p_org and deleted_at is null returning name into v_name;
  for v_m in select user_id from public.org_members where org_id = p_org loop
    perform private.notify(v_m.user_id, p_org, 'system', 'Workspace "' || v_name || '" is scheduled for deletion',
      'All of its data will be permanently erased on ' || private.fmt_date((v_when at time zone 'Asia/Manila')::date) ||
      '. An owner can cancel this from Settings until then.', '#/settings', null, 'orgdel:' || p_org || ':' || v_m.user_id, true);
  end loop;
  return v_when;
end $$;

create function public.cancel_org_deletion(p_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if private.member_role(p_org) is distinct from 'owner' then
    raise exception 'Only the workspace owner can do this.' using errcode = '42501';
  end if;
  update public.orgs set deleted_at = null, purge_after = null where id = p_org;
end $$;

-- Used by the maintenance function, which first removes the stored files.
create function public.purge_due_orgs(p_secret text) returns setof uuid
language plpgsql security definer set search_path = '' as $$
begin
  if p_secret is distinct from private.setting('cron_secret') then raise exception 'unauthorized' using errcode = '28000'; end if;
  return query select id from public.orgs where deleted_at is not null and purge_after < now();
end $$;
create function public.purge_org(p_secret text, p_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_secret is distinct from private.setting('cron_secret') then raise exception 'unauthorized' using errcode = '28000'; end if;
  perform set_config('pp.quiet_audit', 'on', true);
  delete from public.orgs where id = p_org and deleted_at is not null and purge_after < now();
end $$;

revoke execute on function public.request_org_deletion(uuid), public.cancel_org_deletion(uuid) from public, anon;
grant execute on function public.request_org_deletion(uuid), public.cancel_org_deletion(uuid) to authenticated;
revoke execute on function public.purge_due_orgs(text), public.purge_org(text,uuid) from public, anon, authenticated;
grant execute on function public.purge_due_orgs(text), public.purge_org(text,uuid) to service_role;

-- ================================================================ platform admin console
create function public.admin_orgs() returns table (
  id uuid, name text, plan_id text, plan_expires_at timestamptz, created_at timestamptz, deleted_at timestamptz,
  owner_email text, members bigint, businesses bigint, vehicles bigint, open_requests bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return query
  select o.id, o.name, o.plan_id, o.plan_expires_at, o.created_at, o.deleted_at,
    (select p.email from public.org_members m join public.profiles p on p.id = m.user_id
      where m.org_id = o.id and m.role = 'owner' order by m.created_at limit 1),
    (select count(*) from public.org_members m where m.org_id = o.id),
    (select count(*) from public.businesses b where b.org_id = o.id and b.deleted_at is null),
    (select count(*) from public.vehicles v where v.org_id = o.id and v.deleted_at is null),
    (select count(*) from public.assistance_requests a where a.org_id = o.id and a.status not in ('completed','cancelled'))
  from public.orgs o order by o.created_at desc;
end $$;

create function public.admin_set_plan(p_org uuid, p_plan text, p_expires timestamptz default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  update public.orgs set plan_id = p_plan, plan_expires_at = p_expires where id = p_org;
end $$;

revoke execute on function public.admin_orgs(), public.admin_set_plan(uuid,text,timestamptz) from public, anon;
grant execute on function public.admin_orgs(), public.admin_set_plan(uuid,text,timestamptz) to authenticated;

-- Tiny public health check (used by the keep-alive workflow and status checks).
create function public.health() returns text language sql stable set search_path = '' as $$ select 'ok'::text $$;
grant execute on function public.health() to anon, authenticated;

-- Daily maintenance: purge workspaces whose 30-day deletion window has passed.
select cron.schedule('pp-maintenance', '20 19 * * *', $$
  select net.http_post(
    url := private.setting('functions_url') || '/maintenance',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', private.setting('cron_secret')),
    timeout_milliseconds := 120000)
$$);
