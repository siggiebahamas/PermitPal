-- White-label for accounting firms: the firm's name, logo and colour on its clients' reminder emails and
-- in their PermitPal app, replies to the firm, and a monthly client report. "Powered by PermitPal" stays on
-- all of it, and clients keep their own accounts. All or nothing: if anything fails, nothing is changed.
--
-- Order matters: run 2026-10-22-plus.sql first, then this file, once.
begin;

do $$ declare v_prev boolean := false; v_done boolean := false; begin
  if to_regclass('private.features') is not null then
    execute $q$select exists (select 1 from private.features where name = 'plus'), exists (select 1 from private.features where name = 'brand')$q$ into v_prev, v_done;
  end if;
  if not v_prev then raise exception 'Run supabase/manual/2026-10-22-plus.sql first, then run this file. Nothing was changed.'; end if;
  if v_done then raise exception 'This file was already run. Nothing was changed.'; end if;
end $$;

-- ======================================================================== 20261023001000_whitelabel.sql
-- ======================================================================== White-label
-- White-label for accounting firms (₱1,000 a month or ₱10,000 a year, on top of the Accounting firm
-- plan; 14-day free trial). The firm's name, logo and colour go on what its clients see: their
-- reminder emails, tax-deadline emails, the firm's invitations and nudges, a monthly client report,
-- and the client's own PermitPal app. Replies go to the firm.
-- What keeps clients on PermitPal: every client keeps their own PermitPal account and data (the firm
-- never owns it), "Powered by PermitPal" stays on every branded email and screen, and when the firm
-- stops paying or disconnects, everything goes back to PermitPal's own look by itself. Clients are
-- told their account stays theirs, free.

-- ---------------------------------------------------------------- 1) the add-on
alter table public.addons drop constraint if exists addons_kind_check;
alter table public.addons add constraint addons_kind_check check (kind in ('plus','staff','brand'));
alter table public.addon_invoices drop constraint if exists addon_invoices_kind_check;
alter table public.addon_invoices add constraint addon_invoices_kind_check check (kind in ('plus','staff','brand'));
alter table private.addon_stops drop constraint if exists addon_stops_kind_check;
alter table private.addon_stops add constraint addon_stops_kind_check check (kind in ('plus','staff','brand'));

create or replace function private.addon_price(p_kind text, p_people int, p_billing text) returns numeric
language sql immutable set search_path = '' as $$
  select (case p_kind when 'plus' then 199 when 'brand' then 1000 else private.staff_monthly(p_people) end) * (case p_billing when 'yearly' then 10 else 1 end)
$$;
create or replace function private.addon_label(p_kind text, p_people int, p_billing text) returns text
language sql immutable set search_path = '' as $$
  select case p_kind when 'plus' then 'PermitPal Plus' when 'brand' then 'White-label' else 'Staff licences, up to ' || p_people || ' people' end
    || case p_billing when 'yearly' then ' (yearly)' else ' (monthly)' end
$$;

-- An accounting firm workspace with its plan on (or in its trial).
create or replace function private.brand_eligible(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.orgs o where o.id = p_org and o.deleted_at is null and o.kind = 'firm'
    and ((o.trial_ends_at is not null and o.trial_ends_at > now()) or private.effective_plan_id(o.id) = 'firm'))
$$;
create or replace function private.brand_active(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.brand_eligible(p_org)
    and exists (select 1 from public.addons a where a.org_id = p_org and a.kind = 'brand' and a.paid_through >= private.today_ph())
$$;

create or replace function public.start_brand_trial(p_org uuid) returns date
language plpgsql security definer set search_path = '' as $$
declare a public.addons; v_until date := private.today_ph() + 13;
begin
  if not private.is_org_admin(p_org) then raise exception 'Only the workspace owner or an admin can start the trial.' using errcode = '42501'; end if;
  if not private.brand_eligible(p_org) then raise exception 'White-label is for Accounting firm workspaces with the firm plan (or its free trial).' using errcode = 'P0001'; end if;
  if private.brand_active(p_org) then raise exception 'White-label is already on.' using errcode = 'P0001'; end if;
  select * into a from public.addons where org_id = p_org and kind = 'brand' for update;
  if a.trial_used_on is not null or a.started_on is not null then raise exception 'This workspace has already had its free trial.' using errcode = 'P0001'; end if;
  insert into public.addons (org_id, kind, billing, paid_through, trial, trial_used_on)
  values (p_org, 'brand', 'monthly', v_until, true, private.today_ph())
  on conflict (org_id, kind) do update set paid_through = v_until, trial = true, trial_used_on = private.today_ph(), updated_at = now();
  return v_until;
end $$;

-- ---------------------------------------------------------------- 2) the firm's brand
create table if not exists public.org_brands (
  org_id        uuid primary key references public.orgs(id) on delete cascade,
  display_name  text not null check (length(btrim(display_name)) between 1 and 80),
  logo_path     text check (logo_path is null or logo_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$'),
  color         text not null default '#1B4DB5' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  reply_to      text check (reply_to is null or (length(reply_to) <= 254 and reply_to ~* '^[^@\s<>"]+@[^@\s<>"]+\.[a-z]{2,}$')),
  phone         text check (phone is null or phone ~ '^[0-9+() -]{7,20}$'),
  tagline       text check (tagline is null or length(tagline) <= 120),
  client_report boolean not null default true,
  updated_at    timestamptz not null default now()
);
alter table public.org_brands enable row level security;
drop policy if exists org_brands_read on public.org_brands;
create policy org_brands_read on public.org_brands for select to authenticated using (org_id in (select private.my_org_ids()));
revoke insert, update, delete on public.org_brands from anon, authenticated;
revoke all on public.org_brands from anon;

-- Logos are public images (email apps must be able to show them), in their own bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('brand', 'brand', true, 524288, array['image/png','image/jpeg'])
on conflict (id) do nothing;
drop policy if exists "brand: firm admins see their logo files" on storage.objects;
create policy "brand: firm admins see their logo files" on storage.objects for select to authenticated
  using (bucket_id = 'brand' and (storage.foldername(name))[1] in (select o::text from private.my_admin_org_ids() o join public.orgs og on og.id = o and og.kind = 'firm'));
drop policy if exists "brand: firm admins upload their logo" on storage.objects;
create policy "brand: firm admins upload their logo" on storage.objects for insert to authenticated
  with check (bucket_id = 'brand' and (storage.foldername(name))[1] in (select o::text from private.my_admin_org_ids() o join public.orgs og on og.id = o and og.kind = 'firm'));
drop policy if exists "brand: firm admins remove their logo" on storage.objects;
create policy "brand: firm admins remove their logo" on storage.objects for delete to authenticated
  using (bucket_id = 'brand' and (storage.foldername(name))[1] in (select o::text from private.my_admin_org_ids() o join public.orgs og on og.id = o and og.kind = 'firm'));

-- White text on the brand colour must stay readable (WCAG AA, 4.5 : 1).
create or replace function private.color_ok(p_hex text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare c float8[]; i int; v float8; l float8;
begin
  if p_hex !~ '^#[0-9A-Fa-f]{6}$' then return false; end if;
  for i in 0..2 loop
    v := ('x' || substr(p_hex, 2 + i * 2, 2))::bit(8)::int / 255.0;
    c[i + 1] := case when v <= 0.03928 then v / 12.92 else power((v + 0.055) / 1.055, 2.4) end;
  end loop;
  l := 0.2126 * c[1] + 0.7152 * c[2] + 0.0722 * c[3];
  return 1.05 / (l + 0.05) >= 4.5;
end $$;

create or replace function public.brand_save(p_org uuid, p_name text, p_logo_path text, p_color text, p_reply_to text, p_phone text,
  p_tagline text, p_client_report boolean default true) returns public.org_brands
language plpgsql security definer set search_path = '' as $$
declare v public.org_brands; v_email text := nullif(lower(btrim(coalesce(p_reply_to, ''))), '');
begin
  if not private.is_org_admin(p_org) then raise exception 'Only the workspace owner or an admin can change the brand.' using errcode = '42501'; end if;
  if not exists (select 1 from public.orgs where id = p_org and kind = 'firm') then raise exception 'White-label is for Accounting firm workspaces.' using errcode = 'P0001'; end if;
  if length(btrim(coalesce(p_name, ''))) not between 1 and 80 then raise exception 'Enter the name your clients know you by (up to 80 characters).' using errcode = '22023'; end if;
  if not private.color_ok(coalesce(p_color, '')) then raise exception 'Pick a darker colour, so white text on it stays easy to read.' using errcode = '22023'; end if;
  if v_email is not null and v_email !~* '^[^@\s<>"]+@[^@\s<>"]+\.[a-z]{2,}$' then raise exception 'Enter a valid email address for replies.' using errcode = '22023'; end if;
  if p_logo_path is not null and split_part(p_logo_path, '/', 1) <> p_org::text then raise exception 'Invalid file location.' using errcode = '42501'; end if;
  insert into public.org_brands (org_id, display_name, logo_path, color, reply_to, phone, tagline, client_report)
  values (p_org, btrim(p_name), p_logo_path, upper(p_color), v_email, nullif(btrim(coalesce(p_phone, '')), ''), nullif(btrim(coalesce(p_tagline, '')), ''), coalesce(p_client_report, true))
  on conflict (org_id) do update set display_name = excluded.display_name, logo_path = excluded.logo_path, color = excluded.color,
    reply_to = excluded.reply_to, phone = excluded.phone, tagline = excluded.tagline, client_report = excluded.client_report, updated_at = now()
  returning * into v;
  return v;
end $$;

-- A firm's brand, for clients to see, only while White-label is on.
create or replace function private.brand_json(p_firm uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object('firm_org', b.org_id, 'name', b.display_name, 'color', b.color, 'reply_to', b.reply_to, 'phone', b.phone,
      'tagline', b.tagline,
      'logo_url', case when b.logo_path is not null then
        regexp_replace(coalesce(private.setting('functions_url'), ''), '/functions/v1/?$', '') || '/storage/v1/object/public/brand/' || b.logo_path end))
  from public.org_brands b where b.org_id = p_firm and private.brand_active(p_firm)
$$;
-- The firm whose brand a client workspace sees: one it connected to (oldest first), else a firm whose
-- owners or admins manage this workspace themselves.
create or replace function private.client_brand_firm(p_org uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select f from (
    select l.owner_org as f, coalesce(l.accepted_at, l.created_at) as t
    from public.org_links l where l.member_org = p_org and l.status = 'active'
    union all
    select m2.org_id, o.created_at
    from public.orgs o
    join public.org_members m1 on m1.org_id = o.id
    join public.org_members m2 on m2.user_id = m1.user_id and m2.role in ('owner','admin') and m2.org_id <> o.id
    where o.id = p_org and o.kind = 'business' and o.deleted_at is null
  ) x where private.brand_active(f) and exists (select 1 from public.org_brands b where b.org_id = f) order by t limit 1
$$;
create or replace function private.client_brand_json(p_org uuid) returns jsonb
language sql stable security definer set search_path = '' as $$ select private.brand_json(private.client_brand_firm(p_org)) $$;

-- For the app: the brand a client workspace shows (null: PermitPal's own look).
create or replace function public.client_brand(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_org not in (select private.my_org_ids()) then return null; end if;
  return private.client_brand_json(p_org);
end $$;
-- For the sign-up page reached from a firm's invitation (no account yet).
create or replace function public.link_brand(p_token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select private.brand_json(l.owner_org) from public.org_links l where l.token = p_token and l.status = 'pending'
$$;

-- ---------------------------------------------------------------- 3) branded emails
alter table public.message_outbox add column if not exists from_name text check (from_name is null or length(from_name) <= 80);
alter table public.message_outbox add column if not exists reply_to text check (reply_to is null or length(reply_to) <= 254);

-- The email with the firm's look. Without a brand it is PermitPal's usual email. "Powered by PermitPal"
-- (a link to PermitPal) is always at the bottom.
create or replace function private.email_html_b(p_brand jsonb, p_title text, p_body_html text, p_cta_label text, p_cta_url text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_c text; v_logo text; v_reply text; v_phone text; v_app text := coalesce(private.setting('app_url'), '');
begin
  if p_brand is null or coalesce(p_brand ->> 'name', '') = '' then return private.email_html(p_title, p_body_html, p_cta_label, p_cta_url); end if;
  v_c := case when p_brand ->> 'color' ~ '^#[0-9A-Fa-f]{6}$' then p_brand ->> 'color' else '#1B4DB5' end;
  v_logo := case when p_brand ->> 'logo_url' ~ '^https://' then '<img src="' || private.html_escape(p_brand ->> 'logo_url')
    || '" alt="" height="40" style="height:40px;max-width:200px;vertical-align:middle;margin-right:10px;border:0">' else '' end;
  v_reply := case when p_brand ->> 'reply_to' is not null then '<a href="mailto:' || private.html_escape(p_brand ->> 'reply_to') || '" style="color:#4A5464">'
    || private.html_escape(p_brand ->> 'reply_to') || '</a>' end;
  v_phone := private.html_escape(p_brand ->> 'phone');
  return '<!doctype html><html><body style="margin:0;background:#F4F6FA;font-family:Arial,Helvetica,sans-serif;color:#28303C">'
    || '<div style="max-width:560px;margin:0 auto;padding:24px">'
    || '<div style="margin-bottom:16px">' || v_logo
    || '<span style="font-size:20px;font-weight:800;vertical-align:middle;color:' || v_c || '">' || private.html_escape(p_brand ->> 'name') || '</span>'
    || coalesce('<div style="font-size:13px;color:#4A5464;margin-top:4px">' || private.html_escape(p_brand ->> 'tagline') || '</div>', '')
    || '</div>'
    || '<div style="background:#fff;border-radius:14px;padding:24px;border:1px solid #E5E9F0;border-top:4px solid ' || v_c || '">'
    || '<h1 style="font-size:18px;margin:0 0 12px;color:#1B2130">' || private.html_escape(p_title) || '</h1>'
    || p_body_html
    || case when p_cta_url is not null then
         '<p style="margin:22px 0 4px"><a href="' || private.html_escape(p_cta_url) || '" style="background:' || v_c || ';color:#fff;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:700;display:inline-block">'
         || private.html_escape(p_cta_label) || '</a></p>' else '' end
    || '</div><p style="font-size:13px;color:#4A5464;margin:16px 0 6px">'
    || case when v_reply is not null and v_phone is not null then 'Questions? Email ' || v_reply || ' or call ' || v_phone || '.'
            when v_reply is not null then 'Questions? Email ' || v_reply || ', or just reply.'
            when v_phone is not null then 'Questions? Call ' || v_phone || '.' else '' end
    || '</p><p style="font-size:12px;color:#6B7585;margin:0">'
    || private.html_escape(coalesce(p_brand ->> 'why', 'You get these because reminders are on in your settings. Change them anytime under Settings → Reminders.'))
    || '<br>Sent for ' || private.html_escape(p_brand ->> 'name') || ' · Powered by '
    || case when v_app ~ '^https://' then '<a href="' || private.html_escape(v_app) || '" style="color:#6B7585">PermitPal</a>' else 'PermitPal' end || '</p>'
    || '</div></body></html>';
end $$;
create or replace function private.queue_email_b(p_user uuid, p_org uuid, p_brand jsonb, p_subject text, p_title text, p_body_html text, p_body_text text,
  p_link text, p_dedupe text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_email text; v_ok boolean; v_url text := private.setting('app_url') || coalesce(p_link, '');
begin
  select p.email, coalesce(np.email_enabled, true) into v_email, v_ok
    from public.profiles p left join public.notification_prefs np on np.user_id = p.id where p.id = p_user;
  if v_email is null or not v_ok then return; end if;
  insert into public.message_outbox (org_id, user_id, channel, to_address, subject, body_text, body_html, dedupe_key, from_name, reply_to)
  values (p_org, p_user, 'email', v_email, p_subject,
    p_body_text || E'\n\n' || v_url || case when p_brand ->> 'name' is not null then E'\n\nSent for ' || (p_brand ->> 'name') || ' by PermitPal.' else '' end,
    private.email_html_b(p_brand, p_title, p_body_html, 'Open your permits', v_url), p_dedupe, p_brand ->> 'name', p_brand ->> 'reply_to')
  on conflict (dedupe_key) do nothing;
end $$;

-- ---------------------------------------------------------------- 4) the monthly client report (on the 1st, under the firm's brand)
create or replace function private.brand_reports() returns int
language plpgsql security definer set search_path = '' as $$
declare v_today date := private.today_ph(); v_n int := 0; c record; v_brand jsonb; v_html text; v_text text; v_sum text; m record;
begin
  if extract(day from v_today) <> 1 then return 0; end if;
  for c in
    select distinct on (cl.org_id) cl.org_id, cl.firm, o.name as org_name, o.contact_name, o.contact_email, cl.via
    from (
      select l.member_org as org_id, l.owner_org as firm, 'linked' as via from public.org_links l where l.status = 'active'
      union all
      select o2.id, fm.org_id, 'managed' from public.orgs o2
      join public.org_members m1 on m1.org_id = o2.id
      join public.org_members fm on fm.user_id = m1.user_id and fm.role in ('owner','admin') and fm.org_id <> o2.id
      where o2.kind = 'business' and o2.deleted_at is null
    ) cl
    join public.orgs o on o.id = cl.org_id and o.deleted_at is null
    join public.org_brands b on b.org_id = cl.firm and b.client_report
    where private.brand_active(cl.firm) and private.client_brand_firm(cl.org_id) = cl.firm
    order by cl.org_id, cl.via
  loop
    v_brand := private.brand_json(c.firm);
    select count(*) filter (where status = 'action_required') || ' overdue · ' || count(*) filter (where status = 'renew_soon') || ' due within 30 days · '
             || count(*) filter (where status = 'needs_information') || ' missing details · ' || count(*) filter (where status in ('compliant','in_progress')) || ' in order or being renewed',
           string_agg(case when status in ('action_required','renew_soon') then '<li style="margin:4px 0">' || private.html_escape(name) || coalesce(' (' || private.html_escape(subject_name) || ')', '')
             || ': ' || case status when 'action_required' then 'expired ' else 'due ' end || private.fmt_date(expires_on) || '</li>' end, '' order by expires_on),
           string_agg(case when status in ('action_required','renew_soon') then '- ' || name || coalesce(' (' || subject_name || ')', '') || ': '
             || case status when 'action_required' then 'expired ' else 'due ' end || private.fmt_date(expires_on) end, E'\n' order by expires_on)
      into v_sum, v_html, v_text
    from public.requirement_status where org_id = c.org_id;
    if c.via = 'managed' and c.contact_email is not null then
      insert into public.message_outbox (org_id, channel, to_address, subject, body_text, body_html, dedupe_key, from_name, reply_to)
      values (c.org_id, 'email', c.contact_email, (v_brand ->> 'name') || ': your permits this month',
        'Hi' || coalesce(' ' || c.contact_name, '') || E',\n\n' || c.org_name || ': ' || v_sum || E'\n' || coalesce(v_text, 'Nothing needs your attention.') || E'\n\nSent for ' || (v_brand ->> 'name') || ' by PermitPal.',
        private.email_html_b(v_brand || jsonb_build_object('why', (v_brand ->> 'name') || ' sends this on the 1st of each month. To stop it, reply and tell them.'), 'Your permits this month', '<p>Hi' || coalesce(' ' || private.html_escape(c.contact_name), '') || ',</p><p><b>' || private.html_escape(c.org_name) || '</b>: '
          || private.html_escape(v_sum) || '</p>' || coalesce('<ul style="padding-left:18px">' || v_html || '</ul>', '<p>Nothing needs your attention this month.</p>'), null, null),
        'brandrep:' || c.firm || ':' || c.org_id || ':' || to_char(v_today, 'YYYY-MM'), v_brand ->> 'name', v_brand ->> 'reply_to')
      on conflict (dedupe_key) do nothing;
      v_n := v_n + 1;
    elsif c.via = 'linked' then
      for m in select user_id from public.org_members where org_id = c.org_id and role in ('owner','admin') loop
        perform private.queue_email_b(m.user_id, c.org_id, v_brand, (v_brand ->> 'name') || ': your permits this month', 'Your permits this month',
          '<p><b>' || private.html_escape(c.org_name) || '</b>: ' || private.html_escape(v_sum) || '</p>'
            || coalesce('<ul style="padding-left:18px">' || v_html || '</ul>', '<p>Nothing needs your attention this month.</p>'),
          c.org_name || ': ' || v_sum || E'\n' || coalesce(v_text, 'Nothing needs your attention.'), '#/',
          'brandrep:' || c.firm || ':' || c.org_id || ':' || m.user_id || ':' || to_char(v_today, 'YYYY-MM'));
        v_n := v_n + 1;
      end loop;
    end if;
  end loop;
  return v_n;
end $$;

-- When a firm that used White-label disconnects a client, the client is told their account stays theirs.
create or replace function private.link_ended_notice() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_firm text; m record;
begin
  if new.status = 'ended' and old.status = 'active' and new.member_org is not null
     and exists (select 1 from public.org_brands where org_id = new.owner_org)
     and not exists (select 1 from public.org_members where org_id = new.member_org and user_id = (select auth.uid())) then
    select coalesce((select display_name from public.org_brands where org_id = new.owner_org), o.name) into v_firm from public.orgs o where o.id = new.owner_org;
    for m in select user_id from public.org_members where org_id = new.member_org and role in ('owner','admin') loop
      perform private.notify(m.user_id, new.member_org, 'system', 'You are no longer connected to ' || coalesce(v_firm, 'your firm'),
        'Your PermitPal account and everything in it stay yours, free. Your reminders keep coming as before.', '#/', null,
        'linkend:' || new.id || ':' || m.user_id, true);
    end loop;
  end if;
  return null;
end $$;
drop trigger if exists org_links_ended_notice on public.org_links;
create trigger org_links_ended_notice after update of status on public.org_links for each row execute function private.link_ended_notice();

-- ---------------------------------------------------------------- 5) changes to earlier functions

-- Bills: White-label is for accounting firms.
CREATE OR REPLACE FUNCTION private.addon_check_args(p_org uuid, p_kind text, p_people integer, p_billing text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_now int;
begin
  if p_kind not in ('plus','staff','brand') then raise exception 'Choose Plus, staff licences or White-label.' using errcode = '22023'; end if;
  if coalesce(p_billing, '') not in ('monthly','yearly') then raise exception 'Choose monthly or yearly.' using errcode = '22023'; end if;
  if p_kind = 'brand' then
    if p_people is not null then raise exception 'White-label has no number of people.' using errcode = '22023'; end if;
    if not private.brand_eligible(p_org) then
      raise exception 'White-label is for Accounting firm workspaces with the firm plan (or its free trial).' using errcode = 'P0001';
    end if;
  elsif p_kind = 'plus' then
    if p_people is not null then raise exception 'Plus has no number of people.' using errcode = '22023'; end if;
    if exists (select 1 from public.orgs o where o.id = p_org and o.kind <> 'business' and private.effective_plan_id(o.id) in ('fleet','firm','head_office','property')) then
      raise exception 'Plus is already included in your team plan.' using errcode = 'P0001';
    end if;
  else
    if p_people is null or p_people < private.free_people() + 1 or p_people > 5000 then
      raise exception 'Choose from % to 5,000 people. The first % are free.', private.free_people() + 1, private.free_people() using errcode = '22023';
    end if;
    v_now := private.active_people(p_org);
    if p_people < v_now then
      raise exception 'You''re tracking % people. Remove people first, or choose at least %.', v_now, v_now using errcode = 'P0001';
    end if;
  end if;
end $function$;

-- Staff can give White-label time too.
CREATE OR REPLACE FUNCTION public.admin_set_addon(p_org uuid, p_kind text, p_people integer, p_until date, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  if p_kind not in ('plus','staff','brand') then raise exception 'Choose Plus, staff licences or White-label.' using errcode = '22023'; end if;
  if p_kind = 'staff' and (p_people is null or p_people < 4 or p_people > 5000) then raise exception 'Choose from 4 to 5,000 people.' using errcode = '22023'; end if;
  if p_kind = 'brand' and not exists (select 1 from public.orgs where id = p_org and kind = 'firm') then
    raise exception 'White-label is for Accounting firm workspaces.' using errcode = 'P0001';
  end if;
  if p_until is null or p_until > private.today_ph() + 800 then raise exception 'Choose an end date within about 2 years.' using errcode = '22023'; end if;
  insert into public.addons (org_id, kind, people_max, billing, paid_through, comped, started_on)
  values (p_org, p_kind, case when p_kind = 'staff' then p_people end, 'monthly', p_until, true, private.today_ph())
  on conflict (org_id, kind) do update set people_max = case when p_kind = 'staff' then p_people end, paid_through = p_until,
    comped = true, trial = false, updated_at = now();
  if p_kind = 'staff' then perform private.sync_people(p_org); end if;
  perform private.notify_owners(p_org, private.addon_label(p_kind, case when p_kind = 'staff' then p_people end, 'monthly') || ' added by PermitPal',
    'On until ' || private.fmt_date(p_until) || '.' || coalesce(' ' || nullif(btrim(p_note), ''), ''), '#/settings/billing',
    'addoncomp:' || p_org || ':' || p_kind || ':' || p_until, true, true);
end $function$;

-- The morning job: White-label bills (only while the firm plan is on), trial and end notices.
CREATE OR REPLACE FUNCTION private.plus_daily()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_today date := private.today_ph(); v_n int := 0; a record; v_inv public.addon_invoices; v_people int; v_paused int; o record;
begin
  -- unpaid bills past their date
  update public.addon_invoices set status = 'cancelled', note = 'Not paid in time. Choose your plan again for a new bill.'
  where status = 'due' and valid_until < v_today;
  -- plans set to stop: forget the stop once the period is over
  delete from private.addon_stops where stop_after < v_today;

  -- the next period's bill, 7 days ahead (not for trials, gifts, plans set to stop, or Plus inside a team plan)
  for a in
    select ad.*, private.addon_label(ad.kind, coalesce(ad.next_people_max, ad.people_max), coalesce(ad.next_billing, ad.billing)) as label
    from public.addons ad join public.orgs og on og.id = ad.org_id and og.deleted_at is null
    where not ad.trial and not ad.comped and ad.paid_through between v_today and v_today + 7
      and not exists (select 1 from private.addon_stops s where s.org_id = ad.org_id and s.kind = ad.kind)
      and not exists (select 1 from public.addon_invoices i where i.org_id = ad.org_id and i.kind = ad.kind
                      and i.status in ('due','pending_verification') and i.period_start > ad.paid_through)
      and not (ad.kind = 'plus' and og.kind <> 'business' and private.effective_plan_id(og.id) in ('fleet','firm','head_office','property'))
      and not (ad.kind = 'brand' and not private.brand_eligible(og.id))
  loop
    insert into public.addon_invoices (number, org_id, kind, people_max, billing, months, price_php, credit_php, amount_php, period_start, period_end, renewal, valid_until, created_by)
    values (private.next_no('PPA'), a.org_id, a.kind, case when a.kind = 'staff' then coalesce(a.next_people_max, a.people_max) end,
      coalesce(a.next_billing, a.billing), case coalesce(a.next_billing, a.billing) when 'yearly' then 12 else 1 end,
      private.addon_price(a.kind, coalesce(a.next_people_max, a.people_max), coalesce(a.next_billing, a.billing)), 0,
      private.addon_price(a.kind, coalesce(a.next_people_max, a.people_max), coalesce(a.next_billing, a.billing)),
      a.paid_through + 1, (a.paid_through + 1 + make_interval(months => case coalesce(a.next_billing, a.billing) when 'yearly' then 12 else 1 end))::date - 1,
      true, a.paid_through + 14, null)
    returning * into v_inv;
    perform private.notify_owners(a.org_id, a.label || ' renews on ' || private.fmt_date(a.paid_through + 1) || ': ' || private.peso(v_inv.amount_php),
      'Bill ' || v_inv.number || '. Pay by ' || private.fmt_date(a.paid_through) || ' to keep it on without a break: GCash, Maya, bank or card, under Settings > Plan.',
      '#/settings/billing', 'addonrenew:' || v_inv.id, true, true);
    v_n := v_n + 1;
  end loop;

  -- the last day of an unpaid period
  for a in select i.*, private.addon_label(i.kind, i.people_max, i.billing) as label from public.addon_invoices i
      where i.status = 'due' and i.renewal and i.period_start = v_today + 1 loop
    perform private.notify_owners(a.org_id, 'Last day: ' || a.label || ' ends today',
      'Pay bill ' || a.number || ' (' || private.peso(a.amount_php) || ') today to keep it on. Your records are safe either way.',
      '#/settings/billing', 'addonlast:' || a.id, true, true);
  end loop;

  -- free trial ending soon / ended
  for a in select ad.* from public.addons ad join public.orgs og on og.id = ad.org_id and og.deleted_at is null
      where ad.kind in ('plus','brand') and ad.trial and ad.paid_through in (v_today + 2, v_today - 1) loop
    perform private.notify_owners(a.org_id,
      case when a.paid_through >= v_today then 'Your ' || case a.kind when 'brand' then 'White-label' else 'Plus' end || ' trial ends on ' || private.fmt_date(a.paid_through)
           else 'Your ' || case a.kind when 'brand' then 'White-label' else 'Plus' end || ' trial has ended' end,
      case when a.kind = 'brand' and a.paid_through >= v_today then 'Keep your name, logo and colour on your clients'' reminders, and the monthly client report, for ₱1,000 a month (or ₱10,000 a year).'
           when a.kind = 'brand' then 'Your clients'' emails and app show PermitPal''s own look again. Your brand settings are saved. Turn White-label on again anytime.'
           when a.paid_through >= v_today then 'Keep your public permit page, monthly permit check and templates for ₱199 a month (or ₱1,990 a year).'
           else 'Your public permit page now shows "paused" and the monthly check has stopped. Your records are safe. Turn Plus on again anytime.' end,
      '#/settings/billing', case a.kind when 'brand' then 'brandtrial:' else 'plustrial:' end || a.org_id || ':' || a.paid_through || ':' || case when a.paid_through >= v_today then 'soon' else 'ended' end, true, true);
  end loop;

  -- paid or given plans that ended yesterday
  for a in select ad.* from public.addons ad join public.orgs og on og.id = ad.org_id and og.deleted_at is null
      where not ad.trial and ad.paid_through = v_today - 1 loop
    v_people := private.active_people(a.org_id);
    perform private.notify_owners(a.org_id,
      case a.kind when 'plus' then 'PermitPal Plus has ended' when 'brand' then 'White-label has ended' else 'Your staff licences have ended' end,
      case when a.kind = 'brand' then 'Your clients'' emails and app show PermitPal''s own look again. Your brand settings are saved. Turn it on again under Settings > Plan.'
           when a.kind = 'plus' then 'Your public permit page now shows "paused" and the monthly check has stopped. Your records are safe. Turn it on again under Settings > Plan.'
           else 'Reminders for ' || greatest(v_people - private.free_people(), 0) || ' of your ' || v_people || ' people are paused (the first ' || private.free_people() ||
                ' stay free). Nothing was deleted. Add licences under Settings > Plan to turn them back on.' end,
      '#/settings/billing', 'addonend:' || a.org_id || ':' || a.kind || ':' || a.paid_through, true, true);
  end loop;

  -- people above what's paid for pause; paid-for people wake up
  for o in select p.org_id from public.people p where p.deleted_at is null or p.paused_at is not null
      group by p.org_id having count(*) filter (where p.deleted_at is null) > private.free_people() or bool_or(p.paused_at is not null) loop
    v_paused := private.sync_people(o.org_id);
  end loop;

  -- the permit check, every morning for Plus; the report on the 1st
  for o in select og.id from public.orgs og where og.deleted_at is null and private.has_plus(og.id) loop
    perform private.run_audit(o.id, 'daily');
    if extract(day from v_today) = 1 then v_n := v_n + private.audit_report(o.id, false); end if;
  end loop;

  v_n := v_n + private.worker_reminders();
  v_n := v_n + private.trust_updates();

  -- keep a little over a year of history
  delete from public.trust_page_views where viewed_at < now() - interval '400 days';
  delete from public.audit_runs r where r.ran_at < now() - interval '400 days';
  delete from public.audit_findings where status in ('fixed','dismissed') and closed_at < now() - interval '400 days';
  delete from private.template_uses where used_at < now() - interval '400 days';
  return v_n;
end $function$;

-- Money: White-label.
CREATE OR REPLACE FUNCTION public.admin_money(p_from date, p_to date)
 RETURNS TABLE(day date, stream text, kind text, state text, amount numeric, label text, who text, ref_kind text, ref_id uuid, invoice_no text, rush numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 800 then raise exception 'Choose a range of up to about 2 years.' using errcode = '22023'; end if;
  return query
  with lines as (
    -- one-time jobs and care renewals: our fee (service + rush), when paid
    select private.ph_day(a.paid_at) as day, 'jobs'::text as stream, 'service_fee'::text as kind, 'collected'::text as state,
      (coalesce(a.quote_service_fee, 0) + a.quote_rush_fee)::numeric as amount, a.requirement_name as label, o.name as who,
      'order'::text as ref_kind, a.id as ref_id, a.bir_invoice_no as invoice_no, a.quote_rush_fee::numeric as rush
    from public.assistance_requests a join public.orgs o on o.id = a.org_id
    where a.paid_at is not null and a.payment_status in ('paid','refunded') and (coalesce(a.quote_service_fee, 0) + a.quote_rush_fee) > 0
    union all
    select private.ph_day(a.paid_at), 'jobs', 'gov_fees_in', 'held', coalesce(a.quote_gov_fees, 0)::numeric, a.requirement_name, o.name, 'order', a.id, a.bir_invoice_no, 0::numeric
    from public.assistance_requests a join public.orgs o on o.id = a.org_id
    where a.paid_at is not null and a.payment_status in ('paid','refunded') and coalesce(a.quote_gov_fees, 0) > 0
    union all
    select private.ph_day(coalesce(a.closed_at, a.updated_at)), 'jobs', 'gov_fees_out', 'held', -a.gov_fees_actual::numeric, a.requirement_name, o.name, 'order', a.id, null, 0
    from public.assistance_requests a join public.orgs o on o.id = a.org_id
    where a.paid_at is not null and a.payment_status in ('paid','refunded') and coalesce(a.gov_fees_actual, 0) > 0
    union all
    -- refunds: a fee difference is government money going back; a full refund returns our fee first, then the rest
    select private.ph_day(r.created_at), 'jobs', 'refund', 'held', -r.amount_php::numeric, a.requirement_name, o.name, 'order', a.id, null, 0
    from public.order_refunds r join public.assistance_requests a on a.id = r.request_id join public.orgs o on o.id = a.org_id where r.kind = 'fee_difference'
    union all
    select private.ph_day(r.created_at), 'jobs', 'refund', 'collected', -r.amount_php::numeric, a.requirement_name, o.name, 'order', a.id, null, 0
    from public.order_refunds r join public.assistance_requests a on a.id = r.request_id join public.orgs o on o.id = a.org_id where r.kind = 'partial'
    union all
    select private.ph_day(r.created_at), 'jobs', 'refund', 'collected', -least(r.amount_php, coalesce(a.quote_service_fee, 0) + a.quote_rush_fee)::numeric,
      a.requirement_name, o.name, 'order', a.id, null, 0
    from public.order_refunds r join public.assistance_requests a on a.id = r.request_id join public.orgs o on o.id = a.org_id
    where r.kind = 'full' and least(r.amount_php, coalesce(a.quote_service_fee, 0) + a.quote_rush_fee) > 0
    union all
    select private.ph_day(r.created_at), 'jobs', 'refund', 'held', -(r.amount_php - least(r.amount_php, coalesce(a.quote_service_fee, 0) + a.quote_rush_fee))::numeric,
      a.requirement_name, o.name, 'order', a.id, null, 0
    from public.order_refunds r join public.assistance_requests a on a.id = r.request_id join public.orgs o on o.id = a.org_id
    where r.kind = 'full' and r.amount_php > coalesce(a.quote_service_fee, 0) + a.quote_rush_fee
    union all
    -- accepted, not paid yet / quoted, not accepted yet
    select private.ph_day(coalesce(a.accepted_at, a.quoted_at, a.created_at)), 'jobs', 'service_fee', 'to_collect',
      (coalesce(a.quote_service_fee, 0) + a.quote_rush_fee)::numeric, a.requirement_name, o.name, 'order', a.id, null, a.quote_rush_fee::numeric
    from public.assistance_requests a join public.orgs o on o.id = a.org_id
    where a.payment_status in ('awaiting_payment','pending_verification') and a.status <> 'cancelled' and (coalesce(a.quote_service_fee, 0) + a.quote_rush_fee) > 0
    union all
    select private.ph_day(a.quoted_at), 'jobs', 'service_fee', 'pipeline', (coalesce(a.quote_service_fee, 0) + a.quote_rush_fee)::numeric, a.requirement_name, o.name,
      'order', a.id, null, a.quote_rush_fee::numeric
    from public.assistance_requests a join public.orgs o on o.id = a.org_id
    where a.status = 'quoted' and a.quoted_at is not null and (coalesce(a.quote_service_fee, 0) + a.quote_rush_fee) > 0
    union all
    -- year-round care bills
    select private.ph_day(i.paid_at), 'care', 'care_fee', 'collected', i.amount_php::numeric, 'Year-round care, bill ' || i.number, o.name, 'care', i.id, i.bir_invoice_no, 0
    from public.care_invoices i join public.orgs o on o.id = i.org_id where i.status = 'paid' and i.amount_php > 0
    union all
    select i.due_on, 'care', 'care_fee', 'to_collect', i.amount_php::numeric, 'Year-round care, bill ' || i.number, o.name, 'care', i.id, null, 0
    from public.care_invoices i join public.orgs o on o.id = i.org_id where i.status in ('due','pending_verification') and i.amount_php > 0
    union all
    select private.ph_day(g.paid_at), 'care', 'guarantee', 'cost', -g.approved_php::numeric, 'On-time guarantee: ' || g.requirement_name, o.name, 'claim', g.id, null, 0
    from public.guarantee_claims g join public.orgs o on o.id = g.org_id where g.status = 'paid'
    union all
    select private.ph_day(g.decided_at), 'care', 'guarantee', 'to_pay', -g.approved_php::numeric, 'On-time guarantee: ' || g.requirement_name, o.name, 'claim', g.id, null, 0
    from public.guarantee_claims g join public.orgs o on o.id = g.org_id where g.status = 'approved'
    union all
    -- fees from firms, charge by charge
    select case when c.status = 'paid' then coalesce(private.ph_day(s.paid_at), c.occurred_on) else c.occurred_on end, 'partners', c.kind,
      case c.status when 'paid' then 'collected' when 'billed' then 'to_collect' else 'unbilled' end,
      c.amount_php::numeric, c.description, p.name, case when s.id is not null then 'statement' else 'partner' end, coalesce(s.id, p.id), s.bir_invoice_no, 0
    from public.partner_charges c join public.partners p on p.id = c.partner_id left join public.partner_statements s on s.id = c.statement_id
    where c.status <> 'waived'
    union all
    -- prepaid credit firms bought (the money is in when they pay; each quote request then uses some of it)
    select private.ph_day(c.created_at), 'partners', 'credit_topup', 'collected', c.amount_php::numeric, 'Prepaid credit for quote requests', p.name, 'credit', c.id, c.bir_invoice_no, 0
    from public.partner_credits c join public.partners p on p.id = c.partner_id where c.kind = 'topup'
    union all
    -- team plans (online, or recorded by staff)
    select private.ph_day(pm.paid_at), 'plans', 'team_plan', 'collected', pm.amount_php::numeric, pl.name || ' plan, ' || pm.months || ' month' || case when pm.months > 1 then 's' else '' end,
      o.name, 'plan', pm.id, pm.bir_invoice_no, 0
    from public.payments pm join public.orgs o on o.id = pm.org_id join public.plans pl on pl.id = pm.plan_id
    where pm.status = 'paid' and pm.plan_id is not null and pm.paid_at is not null
    union all
    -- PermitPal Plus and staff licences
    select private.ph_day(i.paid_at), 'plans', case i.kind when 'plus' then 'plus' when 'brand' then 'white_label' else 'staff_licences' end, 'collected', i.amount_php::numeric,
      private.addon_label(i.kind, i.people_max, i.billing) || ', bill ' || i.number, o.name, 'addon', i.id, i.bir_invoice_no, 0
    from public.addon_invoices i join public.orgs o on o.id = i.org_id where i.status = 'paid' and i.amount_php > 0 and i.paid_at is not null
    union all
    select private.ph_day(i.created_at), 'plans', case i.kind when 'plus' then 'plus' when 'brand' then 'white_label' else 'staff_licences' end, 'to_collect', i.amount_php::numeric,
      private.addon_label(i.kind, i.people_max, i.billing) || ', bill ' || i.number, o.name, 'addon', i.id, null, 0
    from public.addon_invoices i join public.orgs o on o.id = i.org_id where i.status in ('due','pending_verification') and i.amount_php > 0
  )
  select l.day, l.stream, l.kind, l.state, l.amount, l.label, l.who, l.ref_kind, l.ref_id, l.invoice_no, l.rush from lines l
  where l.day between p_from and p_to or l.state in ('to_collect','pipeline','unbilled','to_pay')
  order by l.day desc, l.stream;
end $function$;

-- Money summary: White-label counts.
CREATE OR REPLACE FUNCTION public.admin_money_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_today date := private.today_ph(); v jsonb;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select jsonb_build_object(
    'today', v_today,
    'goal', nullif(private.setting('money_goal'), '')::numeric,
    'ic_licence_no', coalesce(private.setting('ic_licence_no'), ''),
    'mrr_care', coalesce((select sum(case billing when 'monthly' then price_php else round(price_php / 12, 2) end) from public.care_plans
                          where status = 'active' and paid_through >= v_today and cancel_at is null), 0),
    'care_active', (select count(*) from public.care_plans where status = 'active' and billing <> 'per_renewal'),
    'care_autorenew', (select count(*) from public.care_plans where status = 'active' and billing = 'per_renewal'),
    'care_pending', (select count(*) from public.care_plans where status = 'pending'),
    'care_paused', (select count(*) from public.care_plans where status = 'paused'),
    'care_ending', (select count(*) from public.care_plans where status in ('active','paused') and cancel_at is not null),
    'mrr_plans', coalesce((select sum(pl.price_php_monthly) from public.orgs o join public.plans pl on pl.id = o.plan_id
                           where o.deleted_at is null and coalesce(pl.price_php_monthly, 0) > 0 and (o.plan_expires_at is null or o.plan_expires_at > now())), 0),
    'plans_paying', (select count(*) from public.orgs o join public.plans pl on pl.id = o.plan_id
                     where o.deleted_at is null and coalesce(pl.price_php_monthly, 0) > 0 and (o.plan_expires_at is null or o.plan_expires_at > now())),
    'held_gov', coalesce((select sum(coalesce(quote_gov_fees, 0)) from public.assistance_requests where paid_at is not null and payment_status in ('paid','refunded')), 0)
              - coalesce((select sum(gov_fees_actual) from public.assistance_requests where paid_at is not null and payment_status in ('paid','refunded') and gov_fees_actual is not null), 0)
              - coalesce((select sum(r.amount_php) from public.order_refunds r where r.kind = 'fee_difference'), 0)
              - coalesce((select sum(r.amount_php - least(r.amount_php, coalesce(a.quote_service_fee, 0) + a.quote_rush_fee)) from public.order_refunds r
                          join public.assistance_requests a on a.id = r.request_id where r.kind = 'full'), 0),
    'gov_unrecorded', (select count(*) from public.assistance_requests where status = 'completed' and paid_at is not null and coalesce(quote_gov_fees, 0) > 0 and gov_fees_actual is null),
    'quotes_to_send', (select count(*) from public.assistance_requests where status = 'submitted' and (service_code is not null or care_plan_id is not null)),
    'care_to_quote', (select count(*) from public.assistance_requests where status = 'submitted' and care_plan_id is not null),
    'order_payments_to_check', (select count(*) from public.assistance_requests where payment_status = 'pending_verification'),
    'care_payments_to_check', (select count(*) from public.care_invoices where status = 'pending_verification'),
    'addon_payments_to_check', (select count(*) from public.addon_invoices where status = 'pending_verification'),
    'mrr_addons', coalesce((select sum(case a.billing when 'yearly' then round(private.addon_price(a.kind, a.people_max, 'yearly') / 12, 2)
                                    else private.addon_price(a.kind, a.people_max, 'monthly') end)
                           from public.addons a where not a.trial and not a.comped and a.paid_through >= v_today), 0),
    'plus_paying', (select count(*) from public.addons where kind = 'plus' and not trial and not comped and paid_through >= v_today),
    'plus_trials', (select count(*) from public.addons where kind = 'plus' and trial and paid_through >= v_today),
    'staff_paying', (select count(*) from public.addons where kind = 'staff' and not comped and paid_through >= v_today),
    'brand_paying', (select count(*) from public.addons where kind = 'brand' and not trial and not comped and paid_through >= v_today),
    'brand_trials', (select count(*) from public.addons where kind = 'brand' and trial and paid_through >= v_today),
    'care_overdue', (select count(*) from public.care_invoices where status = 'due' and due_on < v_today),
    'claims_to_decide', (select count(*) from public.guarantee_claims where status = 'submitted'),
    'claims_to_pay', (select count(*) from public.guarantee_claims where status = 'approved'),
    'partners_to_bill', (select count(distinct partner_id) from public.partner_charges where status = 'unbilled' and occurred_on < date_trunc('month', v_today)::date),
    'statements_overdue', (select count(*) from public.partner_statements where status = 'sent' and due_on < v_today),
    'applications_new', (select count(*) from public.partner_applications where status = 'new'),
    'disputes_open', (select count(*) from public.lead_disputes where status = 'open'),
    'firms_paused', (select count(*) from public.partners p where p.published and not private.partner_live(p)),
    'credit_held', coalesce((select sum(credit_php) from public.partners), 0),
    'staff_access_open', (select count(*) from private.staff_memberships where ended_at is null),
    'covered_missing_dates', (select count(distinct c.requirement_id) from public.care_plans p cross join lateral private.care_covered(p.id) c
                              join public.requirement_status rs on rs.id = c.requirement_id
                              where p.status = 'active' and rs.expires and rs.expires_on is null),
    'missing_invoice', (select count(*) from public.assistance_requests where paid_at is not null and payment_status in ('paid','refunded') and coalesce(quote_php, 0) > 0 and bir_invoice_no is null)
                     + (select count(*) from public.care_invoices where status = 'paid' and amount_php > 0 and bir_invoice_no is null)
                     + (select count(*) from public.partner_statements where status = 'paid' and bir_invoice_no is null)
                     + (select count(*) from public.payments where status = 'paid' and plan_id is not null and bir_invoice_no is null)
                     + (select count(*) from public.partner_credits where kind = 'topup' and bir_invoice_no is null)
                     + (select count(*) from public.addon_invoices where status = 'paid' and amount_php > 0 and bir_invoice_no is null)
  ) into v;
  return v;
end $function$;

-- Notifications: permit, assignment and tax-deadline emails to a firm's clients carry the firm's look.
CREATE OR REPLACE FUNCTION private.notify(p_user uuid, p_org uuid, p_kind text, p_title text, p_body text, p_link text, p_requirement uuid, p_dedupe text, p_email boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
  v_brand jsonb;
begin
  insert into public.notifications (user_id, org_id, kind, title, body, link, requirement_id, dedupe_key)
  values (p_user, p_org, p_kind, p_title, p_body, p_link, p_requirement, p_dedupe)
  on conflict (dedupe_key) do nothing returning id into v_id;
  if v_id is not null and p_email then
    -- A client of a firm with White-label: their permit and tax-deadline emails carry the firm's look.
    if p_kind in ('overdue','due_soon','filing','escalation','assigned') then v_brand := private.client_brand_json(p_org); end if;
    if v_brand is not null then
      perform private.queue_email_b(p_user, p_org, v_brand, (v_brand ->> 'name') || ': ' || p_title, p_title,
        '<p style="margin:0;line-height:1.5">' || private.html_escape(coalesce(p_body, '')) || '</p>',
        coalesce(p_body, ''), p_link, case when p_dedupe is null then null else p_dedupe || ':email' end);
      return;
    end if;
    perform private.queue_email(p_user, p_org, 'PermitPal: ' || p_title, p_title,
      '<p style="margin:0;line-height:1.5">' || private.html_escape(coalesce(p_body, '')) || '</p>',
      coalesce(p_body, ''), p_link, case when p_dedupe is null then null else p_dedupe || ':email' end);
  end if;
end $function$;

-- Daily reminders and the Monday summary: a firm's clients get them under the firm's name, with replies going to the firm.
CREATE OR REPLACE FUNCTION private.queue_due_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_today date := private.today_ph();
  v_app   text := private.setting('app_url');
  v_new   int := 0;
begin
  -- 1. One in-app notification per permit period, reminder stage and person.
  --    Stages: 30 days, 7 days, 1 day before, then weekly while overdue. Missing a day
  --    never skips a reminder: the most urgent stage not yet sent goes out next run.
  --    A permit someone is handling reminds only that person; others remind everyone who can edit.
  with items as (
    select rs.*,
      coalesce(rs.subject_name, '') ||
        case when rs.location_name is not null and not coalesce(rs.location_is_main, true) then ' (' || rs.location_name || ')' else '' end ||
        case when rs.plate_no is not null and rs.plate_no <> '' then ' - ' || rs.plate_no else '' end as label
    from public.requirement_status rs
    join public.orgs o on o.id = rs.org_id and o.deleted_at is null
    where rs.expires and rs.expires_on is not null and rs.days_left <= 30
      and not exists (select 1 from public.people pp where pp.id = rs.person_id and pp.paused_at is not null)
      and (rs.status <> 'in_progress' or rs.days_left < 0)
  ), targets as (
    select i.*, m.user_id,
      case
        when i.days_left < 0 then 'overdue-' || ((-i.days_left - 1) / 7)
        when i.days_left <= 1 and np.remind_1 then 'd1'
        when i.days_left <= 7 and np.remind_7 then 'd7'
        when i.days_left <= 30 and np.remind_30 then 'd30'
      end as stage
    from items i
    join public.org_members m on m.org_id = i.org_id and m.role <> 'viewer' and (i.assignee_id is null or m.user_id = i.assignee_id)
    join public.notification_prefs np on np.user_id = m.user_id
    where (i.subject in ('business','person') and np.business_alerts) or (i.subject = 'vehicle' and np.vehicle_alerts)
  ), inserted as (
    insert into public.notifications (user_id, org_id, kind, title, body, link, requirement_id, dedupe_key)
    select t.user_id, t.org_id,
      case when t.days_left < 0 then 'overdue' else 'due_soon' end,
      t.name || ' ' || private.due_phrase(t.days_left),
      t.label || ' - due ' || private.fmt_date(t.expires_on),
      '#/requirement/' || t.id, t.id,
      'rem:' || t.cycle_id || ':' || t.stage || ':' || t.user_id
    from targets t where t.stage is not null
    on conflict (dedupe_key) do nothing
    returning user_id, org_id, title, body, link, kind
  ), grouped as (
    -- 2. One message per person per workspace per day, listing everything new.
    select i.user_id, i.org_id, count(*) as n,
      string_agg('<li style="margin:6px 0">' || private.html_escape(i.title) || '<br><span style="color:#6B7585;font-size:13px">'
                 || private.html_escape(i.body) || '</span></li>', '' order by i.kind, i.title) as items_html,
      string_agg('- ' || i.title || ' (' || i.body || ')', E'\n' order by i.kind, i.title) as items_text,
      (array_agg(i.title order by i.kind, i.title))[1] as first_title
    from inserted i group by i.user_id, i.org_id
  ), recipients as (
    select g.*, p.email, p.phone, p.first_name, o.name as org_name, private.client_brand_json(g.org_id) as brand,
      coalesce(np.email_enabled, true) as email_on, coalesce(np.sms_enabled, false) as sms_on,
      coalesce(np.whatsapp_enabled, false) as wa_on,
      coalesce((select pl.paid_channels from public.plans pl where pl.id = private.effective_plan_id(g.org_id)), false) as paid
    from grouped g
    join public.profiles p on p.id = g.user_id
    join public.orgs o on o.id = g.org_id
    left join public.notification_prefs np on np.user_id = g.user_id
  ), msgs as (
    select r.org_id, r.user_id, 'email' as channel, r.email as to_address,
      coalesce(r.brand ->> 'name', 'PermitPal') || ': ' || case when r.n = 1 then r.first_title else r.n || ' items need attention (' || r.org_name || ')' end as subject,
      'These need attention in ' || r.org_name || E':\n' || r.items_text || E'\n\nOpen PermitPal: ' || v_app || coalesce(E'\n\nSent for ' || (r.brand ->> 'name') || ' by PermitPal.', '') as body_text,
      private.email_html_b(r.brand, case when r.n = 1 then r.first_title else r.n || ' items need attention' end,
        '<p style="margin:0 0 8px">In <b>' || private.html_escape(r.org_name) || '</b>:</p><ul style="padding-left:18px;margin:0">' || r.items_html || '</ul>',
        'Open PermitPal', v_app) as body_html,
      null::text as template, null::jsonb as template_params,
      'remmail:' || r.user_id || ':' || r.org_id || ':' || v_today as dedupe_key, r.brand ->> 'name' as from_name, r.brand ->> 'reply_to' as reply_to
    from recipients r where r.email_on and r.email is not null
    union all
    select r.org_id, r.user_id, 'sms', r.phone, null,
      left('PermitPal: ' || r.first_title || case when r.n > 1 then ' +' || (r.n - 1) || ' more' else '' end || '. ' || v_app, 300),
      null, null, null,
      'remsms:' || r.user_id || ':' || r.org_id || ':' || v_today, null, null
    from recipients r where r.sms_on and r.paid and r.phone is not null
    union all
    select r.org_id, r.user_id, 'whatsapp', r.phone, null,
      r.first_title || case when r.n > 1 then ' +' || (r.n - 1) || ' more' else '' end,
      null, 'permit_reminder',
      jsonb_build_array(coalesce(nullif(r.first_name, ''), 'there'), r.n::text, r.first_title, v_app),
      'remwa:' || r.user_id || ':' || r.org_id || ':' || v_today, null, null
    from recipients r where r.wa_on and r.paid and r.phone is not null
  )
  insert into public.message_outbox (org_id, user_id, channel, to_address, subject, body_text, body_html, template, template_params, dedupe_key, from_name, reply_to)
  select * from msgs
  on conflict (dedupe_key) do nothing;
  get diagnostics v_new = row_count;

  -- 1b. Escalations to owners/admins for permits someone else is handling.
  perform private.queue_escalations();

  -- 3. Monday weekly digest (email only): a summary of everything not compliant.
  if extract(isodow from v_today) = 1 then
    insert into public.message_outbox (org_id, user_id, channel, to_address, subject, body_text, body_html, dedupe_key, from_name, reply_to)
    select d.org_id, d.user_id, 'email', d.email,
      coalesce(bj.brand ->> 'name', 'PermitPal') || ' weekly summary: ' || d.org_name,
      d.overdue || ' overdue, ' || d.soon || ' due within 30 days, ' || d.needinfo || ' need information, ' || d.inprog || ' in progress. ' || v_app,
      private.email_html_b(bj.brand, 'Your week in compliance: ' || d.org_name,
        '<table style="width:100%;border-collapse:collapse;font-size:14px">'
        || '<tr><td style="padding:6px 0">Overdue</td><td style="text-align:right;font-weight:700;color:#D8433C">' || d.overdue || '</td></tr>'
        || '<tr><td style="padding:6px 0">Due within 30 days</td><td style="text-align:right;font-weight:700;color:#DF9A1F">' || d.soon || '</td></tr>'
        || '<tr><td style="padding:6px 0">Need information</td><td style="text-align:right;font-weight:700">' || d.needinfo || '</td></tr>'
        || '<tr><td style="padding:6px 0">Renewals in progress</td><td style="text-align:right;font-weight:700;color:#2F6FED">' || d.inprog || '</td></tr>'
        || '<tr><td style="padding:6px 0">Compliant</td><td style="text-align:right;font-weight:700;color:#1D9C57">' || d.ok || '</td></tr></table>',
        'Open PermitPal', v_app),
      'digest:' || d.user_id || ':' || d.org_id || ':' || to_char(v_today, 'IYYY-IW'), bj.brand ->> 'name', bj.brand ->> 'reply_to'
    from (
      select m.user_id, m.org_id, p.email, o.name as org_name,
        count(*) filter (where rs.status = 'action_required') as overdue,
        count(*) filter (where rs.status = 'renew_soon') as soon,
        count(*) filter (where rs.status = 'needs_information') as needinfo,
        count(*) filter (where rs.status = 'in_progress') as inprog,
        count(*) filter (where rs.status = 'compliant') as ok
      from public.org_members m
      join public.orgs o on o.id = m.org_id and o.deleted_at is null
      join public.profiles p on p.id = m.user_id
      join public.notification_prefs np on np.user_id = m.user_id and np.weekly_digest and np.email_enabled
      join public.requirement_status rs on rs.org_id = m.org_id
      group by m.user_id, m.org_id, p.email, o.name
    ) d cross join lateral (select private.client_brand_json(d.org_id) as brand) bj
    where d.email is not null and (d.overdue + d.soon + d.needinfo + d.inprog) > 0
    on conflict (dedupe_key) do nothing;
  end if;

  -- 4. Paid plan about to lapse: tell the owners a week ahead and on the day.
  perform private.notify(m.user_id, o.id, 'billing',
      case when o.plan_expires_at < now() then 'Your ' || pl.name || ' plan has ended'
           else 'Your ' || pl.name || ' plan ends on ' || private.fmt_date((o.plan_expires_at at time zone 'Asia/Manila')::date) end,
      'Renew under Settings > Plan & billing to keep SMS/WhatsApp reminders and your plan limits. Your data stays safe either way.',
      '#/settings/billing', null,
      'plan:' || o.id || ':' || (o.plan_expires_at at time zone 'Asia/Manila')::date || ':' ||
        case when o.plan_expires_at < now() then 'ended' else 'soon' end || ':' || m.user_id)
  from public.orgs o
  join public.plans pl on pl.id = o.plan_id
  join public.org_members m on m.org_id = o.id and m.role = 'owner'
  where o.deleted_at is null and o.plan_expires_at is not null
    and o.plan_expires_at < now() + interval '7 days' and o.plan_expires_at > now() - interval '2 days';

  perform private.flush_outbox();
  return v_new;
end $function$;

-- Reminders a firm sends its clients go out under the firm's brand.
CREATE OR REPLACE FUNCTION public.network_nudge(p_owner uuid, p_links uuid[] DEFAULT '{}'::uuid[], p_orgs uuid[] DEFAULT '{}'::uuid[], p_message text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_brand jsonb; v_name text; v_body text; v_owner public.orgs; v_l record; v_o record; v_m record; v_sent int := 0; v_sum text; v_msg text := nullif(btrim(p_message), '');
begin
  if not private.is_org_admin(p_owner) then raise exception 'Only the workspace owner or an admin can send reminders.' using errcode = '42501'; end if;
  if not private.has_team_tools(p_owner) then raise exception 'Your trial has ended. Choose a plan in Settings → Plan.' using errcode = 'P0001', hint = 'plan_limit'; end if;
  select * into v_owner from public.orgs where id = p_owner;
  v_brand := private.brand_json(p_owner);
  v_name := coalesce(v_brand ->> 'name', v_owner.name);
  for v_l in select * from public.org_links where id = any(coalesce(p_links, '{}')) and owner_org = p_owner and status = 'active'
                and (last_nudged_at is null or last_nudged_at < now() - interval '20 hours') loop
    select string_agg(n || ' ' || w, ', ') into v_sum from (
      select count(*) filter (where status = 'action_required') n, 'overdue' w, 1 s from public.requirement_status where org_id = v_l.member_org
      union all select count(*) filter (where status = 'renew_soon'), 'due soon', 2 from public.requirement_status where org_id = v_l.member_org
      union all select count(*) filter (where status = 'needs_information'), 'missing details', 3 from public.requirement_status where org_id = v_l.member_org
      order by s) x where n > 0;
    for v_m in select user_id from public.org_members where org_id = v_l.member_org and role in ('owner','admin') loop
      v_body := coalesce(v_msg || ' ', '') || coalesce('You have ' || v_sum || '.', 'Please check your permits are up to date.');
      perform private.notify(v_m.user_id, v_l.member_org, 'system', v_name || ' asks you to update your permits',
        v_body, '#/', null, 'nudge:' || v_l.id || ':' || v_m.user_id || ':' || to_char(now(), 'YYYYMMDD'), v_brand is null);
      if v_brand is not null then
        perform private.queue_email_b(v_m.user_id, v_l.member_org, v_brand, v_name || ' asks you to update your permits', v_name || ' asks you to update your permits',
          '<p style="margin:0;line-height:1.5">' || private.html_escape(v_body) || '</p>', v_body, '#/',
          'nudge:' || v_l.id || ':' || v_m.user_id || ':' || to_char(now(), 'YYYYMMDD') || ':email');
      end if;
    end loop;
    update public.org_links set last_nudged_at = now() where id = v_l.id;
    v_sent := v_sent + 1;
  end loop;
  -- Firms: clients they manage themselves get an email at the client contact address.
  for v_o in select o.* from public.orgs o join public.org_members m on m.org_id = o.id and m.user_id = auth.uid()
               where o.id = any(coalesce(p_orgs, '{}')) and o.contact_email is not null and o.deleted_at is null
                 and (o.last_nudged_at is null or o.last_nudged_at < now() - interval '20 hours') loop
    select string_agg(rs.name || coalesce(' (' || rs.subject_name || ')', '') || ': ' ||
             case rs.status when 'action_required' then 'overdue' when 'renew_soon' then 'due ' || private.fmt_date(rs.expires_on) else 'missing details' end, E'\n')
      into v_sum from public.requirement_status rs where rs.org_id = v_o.id and rs.status in ('action_required','renew_soon','needs_information');
    insert into public.message_outbox (org_id, channel, to_address, subject, body_text, body_html, dedupe_key, from_name, reply_to)
    values (v_o.id, 'email', v_o.contact_email, v_name || ': permits that need your attention',
      'Hi' || coalesce(' ' || v_o.contact_name, '') || ',' || E'\n\n' || coalesce(v_msg || E'\n\n', '') || coalesce(v_sum, 'Everything is up to date.') || E'\n\n' || v_name,
      private.email_html_b(v_brand || jsonb_build_object('why', v_name || ' sent you this from PermitPal.'), v_name || ': permits that need your attention',
        '<p>Hi' || coalesce(' ' || private.html_escape(v_o.contact_name), '') || ',</p>' || coalesce('<p>' || private.html_escape(v_msg) || '</p>', '') ||
        '<p style="white-space:pre-line">' || private.html_escape(coalesce(v_sum, 'Everything is up to date.')) || '</p><p>' || private.html_escape(v_name) || '</p>',
        null, null),
      'nudgeorg:' || v_o.id || ':' || to_char(now(), 'YYYYMMDD'), v_brand ->> 'name', v_brand ->> 'reply_to')
    on conflict (dedupe_key) do nothing;
    update public.orgs set last_nudged_at = now() where id = v_o.id;
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end $function$;

-- Invitations from a firm with White-label carry its look.
CREATE OR REPLACE FUNCTION public.link_invite(p_owner uuid, p_relation text, p_email text, p_label text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_brand jsonb; v_org public.orgs; v_id uuid; v_token text; v_email text := lower(btrim(p_email)); v_url text; v_who text;
begin
  if not private.is_org_admin(p_owner) then raise exception 'Only the workspace owner or an admin can invite.' using errcode = '42501'; end if;
  if not private.has_team_tools(p_owner) then raise exception 'Your trial has ended. Choose a plan in Settings → Plan to keep connecting.' using errcode = 'P0001', hint = 'plan_limit'; end if;
  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Please enter a valid email address.' using errcode = '22023'; end if;
  select * into v_org from public.orgs where id = p_owner;
  v_brand := private.brand_json(p_owner);
  v_org.name := coalesce(v_brand ->> 'name', v_org.name);
  select id, token into v_id, v_token from public.org_links where owner_org = p_owner and invited_email = v_email and status = 'pending';
  if v_id is null then
    insert into public.org_links (owner_org, relation, label, invited_email, created_by)
    values (p_owner, p_relation, left(coalesce(btrim(p_label), ''), 120), v_email, auth.uid()) returning id, token into v_id, v_token;
  end if;
  select coalesce(nullif(btrim(first_name || ' ' || last_name), ''), email) into v_who from public.profiles where id = auth.uid();
  v_url := coalesce(private.setting('app_url'), '') || '#/connect/' || v_token;
  insert into public.message_outbox (org_id, channel, to_address, subject, body_text, body_html, dedupe_key, from_name, reply_to)
  values (p_owner, 'email', v_email, v_org.name || ' invites you to connect on PermitPal',
    v_who || ' of ' || v_org.name || ' would like to see the status of your permits (names, status and expiry dates only) as their '
      || private.relation_label(p_relation) || '. PermitPal is free for your business. Open this link to accept or decline: ' || v_url,
    private.email_html_b(v_brand || jsonb_build_object('why', 'You got this because ' || v_org.name || ' invited ' || v_email || '.'), v_org.name || ' invites you to connect',
      '<p>' || private.html_escape(coalesce(v_who, 'Someone')) || ' of <b>' || private.html_escape(v_org.name) || '</b> would like to see the status of your permits as their '
      || private.relation_label(p_relation) || '.</p><p>They will see permit names, status and expiry dates only. You decide whether they may download copies, and you can disconnect anytime. PermitPal is free for your business.</p>',
      'Review the invitation', v_url),
    'linkinv:' || v_id || ':' || to_char(now(), 'YYYYMMDDHH24'), v_brand ->> 'name', v_brand ->> 'reply_to')
  on conflict (dedupe_key) do nothing;
  return v_id;
end $function$;

-- The invitation page shows the firm's logo.
CREATE OR REPLACE FUNCTION public.link_preview(p_token text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object('owner_name', o.name, 'owner_kind', o.kind, 'relation', l.relation, 'label', l.label,
    'invited_email', l.invited_email, 'required_types', o.required_types,
    'status', l.status, 'brand', case when l.status = 'pending' then private.brand_json(l.owner_org) end)
  from public.org_links l join public.orgs o on o.id = l.owner_org where l.token = p_token
$function$;

-- The morning job sends the monthly client reports on the 1st.
CREATE OR REPLACE FUNCTION private.revenue_daily()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_n int := 0;
begin
  v_n := v_n + private.care_daily();
  v_n := v_n + private.partner_monthly_charges();
  v_n := v_n + private.referral_followups();
  v_n := v_n + private.plus_daily();
  v_n := v_n + private.brand_reports();
  delete from private.placement_seen where day < private.today_ph() - 60;
  return v_n;
end $function$;

-- ---------------------------------------------------------------- who may call what
do $$ declare f text; begin
  foreach f in array array['public.start_brand_trial(uuid)', 'public.brand_save(uuid,text,text,text,text,text,text,boolean)', 'public.client_brand(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  -- no account needed: the sign-up page opened from a firm's invitation
  revoke all on function public.link_brand(text) from public;
  grant execute on function public.link_brand(text) to anon, authenticated;
  foreach f in array array['private.brand_eligible(uuid)', 'private.brand_active(uuid)', 'private.brand_json(uuid)', 'private.client_brand_firm(uuid)',
    'private.client_brand_json(uuid)', 'private.email_html_b(jsonb,text,text,text,text)', 'private.queue_email_b(uuid,uuid,jsonb,text,text,text,text,text,text)',
    'private.brand_reports()', 'private.color_ok(text)', 'private.link_ended_notice()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
grant select on public.org_brands to authenticated;

insert into private.features (name) values ('brand') on conflict do nothing;

commit;
