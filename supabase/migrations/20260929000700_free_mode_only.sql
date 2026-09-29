-- Free mode: PermitPal runs on free tiers only. Everyone is on the Free plan with no
-- limits; paid plans are hidden (kept for later) and paid channels (SMS/WhatsApp) are off.
alter table public.plans add column available boolean not null default true;
update public.plans set available = false where id in ('business', 'business_plus');
update public.plans set
  max_businesses = null, max_vehicles = null, max_members = null, max_locations_per_business = null,
  paid_channels = false,
  features = array['Unlimited businesses, branches and vehicles','Team members with roles','Document vault with full history','Email and in-app reminders','Get Help with renewals']
where id = 'free';
update public.orgs set plan_id = 'free', plan_expires_at = null where plan_id <> 'free';
