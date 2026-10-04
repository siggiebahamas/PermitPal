-- Trust round: refunds, a staff file-access log customers can see, a test email for staff,
-- and the per-consultant "all workspaces" view removed.

revoke execute on function public.my_workspaces() from authenticated;  -- the page is gone

-- ================================================================ refunds
create table public.order_refunds (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.assistance_requests(id) on delete cascade,
  org_id      uuid not null references public.orgs(id) on delete cascade,
  amount_php  numeric(12,2) not null check (amount_php > 0),
  kind        text not null check (kind in ('full','fee_difference','partial')),
  reason      text not null check (length(btrim(reason)) between 1 and 500),
  method      text check (length(method) <= 60),
  reference   text check (length(reference) <= 120),
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index order_refunds_request on public.order_refunds(request_id);
alter table public.order_refunds enable row level security;
create policy order_refunds_read on public.order_refunds for select to authenticated
  using (org_id in (select private.my_org_ids()) or (select private.is_platform_admin()));

-- Staff: record a refund. A full refund also cancels the order.
create function public.admin_refund_order(p_req uuid, p_amount numeric, p_kind text, p_reason text,
  p_method text default null, p_reference text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_a public.assistance_requests;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select * into v_a from public.assistance_requests where id = p_req;
  if v_a.id is null then raise exception 'Order not found.' using errcode = 'P0002'; end if;
  if v_a.payment_status not in ('paid','refunded') then raise exception 'Nothing was paid on this order.' using errcode = 'P0001'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter the amount refunded.' using errcode = '22023'; end if;
  if p_amount + coalesce((select sum(amount_php) from public.order_refunds where request_id = p_req), 0) > coalesce(v_a.quote_php, 0) then
    raise exception 'Refunds can''t be more than what the customer paid.' using errcode = '22023';
  end if;
  insert into public.order_refunds (request_id, org_id, amount_php, kind, reason, method, reference, created_by)
  values (p_req, v_a.org_id, p_amount, p_kind, btrim(p_reason), nullif(btrim(p_method), ''), nullif(btrim(p_reference), ''), auth.uid());
  if p_kind = 'full' then
    update public.assistance_requests set payment_status = 'refunded',
      status = case when status = 'completed' then status else 'cancelled' end where id = p_req;
  end if;
  perform private.order_event(p_req, 'payment', 'Refund sent: ₱' || to_char(p_amount, 'FM999,999,990.00') || '. ' || btrim(p_reason)
    || coalesce(' (ref ' || nullif(btrim(p_reference), '') || ')', ''));
end $$;
revoke execute on function public.admin_refund_order(uuid,numeric,text,text,text,text) from public, anon;
grant execute on function public.admin_refund_order(uuid,numeric,text,text,text,text) to authenticated;

-- ================================================================ staff file access log
-- Staff can no longer read customer files straight from storage. They go through the staff-file
-- function, which calls this check first, so every open is logged and visible to the customer.
create table public.staff_file_access (
  id          bigint generated always as identity primary key,
  org_id      uuid not null references public.orgs(id) on delete cascade,
  staff_id    uuid references auth.users(id) on delete set null,
  staff_name  text not null,
  file_path   text not null,
  file_name   text not null,
  reason      text not null,
  created_at  timestamptz not null default now()
);
create index staff_file_access_org on public.staff_file_access(org_id, created_at desc);
alter table public.staff_file_access enable row level security;
create policy staff_file_access_read on public.staff_file_access for select to authenticated
  using (org_id in (select private.my_org_ids()) or (select private.is_platform_admin()));

create function public.staff_open_file(p_path text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid; v_parts text[]; v_name text; v_reason text; v_staff text;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  v_parts := string_to_array(p_path, '/');
  begin v_org := v_parts[1]::uuid; exception when others then raise exception 'Bad file path.' using errcode = '22023'; end;
  -- Request attachments: <org>/requests/<request id>/<file>
  if v_parts[2] = 'requests' then
    select a.requirement_name || ' — ' || a.subject_label into v_reason
      from public.assistance_requests a where a.org_id = v_org and a.id::text = v_parts[3];
    if v_reason is null then raise exception 'This file is not part of a request.' using errcode = '42501'; end if;
    v_name := v_parts[array_length(v_parts, 1)];
  else
    -- Permit documents: only while the customer has an open request for that permit.
    select d.file_name, a.requirement_name || ' — ' || a.subject_label into v_name, v_reason
      from public.documents d
      join public.assistance_requests a on a.requirement_id = d.requirement_id and a.status not in ('completed','cancelled')
      where d.storage_path = p_path and d.org_id = v_org and d.deleted_at is null
      limit 1;
    if v_name is null then raise exception 'You can only open a customer''s files while they have an open request for that permit.' using errcode = '42501'; end if;
  end if;
  -- Staff opening their own workspace's files is not a customer access.
  if not exists (select 1 from public.org_members m where m.org_id = v_org and m.user_id = auth.uid()) then
    select coalesce(nullif(btrim(p.first_name || ' ' || p.last_name), ''), 'PermitPal staff') into v_staff from public.profiles p where p.id = auth.uid();
    insert into public.staff_file_access (org_id, staff_id, staff_name, file_path, file_name, reason)
    values (v_org, auth.uid(), coalesce(v_staff, 'PermitPal staff'), p_path, regexp_replace(v_name, '^[a-z0-9]{6,}-', ''), 'Request: ' || v_reason);
  end if;
  return v_name;
end $$;
revoke execute on function public.staff_open_file(text) from public, anon;
grant execute on function public.staff_open_file(text) to authenticated;

alter policy "documents: staff read request files" on storage.objects using (false);
alter policy "documents: members can read" on storage.objects
  using (bucket_id = 'documents' and (storage.foldername(name))[1] in (select o::text from private.my_org_ids() o));

-- ================================================================ test email (staff)
create function public.admin_test_email() returns void
language plpgsql security definer set search_path = '' as $$
declare v_email text;
begin
  if not private.is_platform_admin() then raise exception 'Staff only.' using errcode = '42501'; end if;
  select email into v_email from public.profiles where id = auth.uid();
  insert into public.message_outbox (user_id, channel, to_address, subject, body_text, dedupe_key)
  values (auth.uid(), 'email', v_email, 'PermitPal test email',
    'This is a test from PermitPal. If you can read this, email reminders are working.', 'test:' || auth.uid() || ':' || extract(epoch from now())::bigint);
  perform private.flush_outbox();
end $$;
revoke execute on function public.admin_test_email() from public, anon;
grant execute on function public.admin_test_email() to authenticated;

-- Strangers have no business reading these tables at all (their row rules already returned nothing).
revoke all on public.order_refunds, public.staff_file_access from anon;
