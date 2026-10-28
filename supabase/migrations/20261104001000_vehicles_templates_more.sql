-- Database file 18: vehicles by fuel and use, nine more templates, and one more online service.
-- 1) Vehicles get two details, what they run on (gas, diesel, hybrid, fully electric) and what they are used for
--    (private, company, for hire with passengers, for hire with goods), plus "still in the seller's name". Each one
--    decides which papers the vehicle needs: no emission test for a fully electric car; an LTFRB franchise for any
--    vehicle for hire (a city tricycle franchise instead for tricycles); passenger accident insurance when it carries
--    passengers for hire; an LTO transfer of ownership while it is still in the seller's name. Changing a detail adds
--    what now applies and removes what no longer does, but only if nothing was recorded for it yet.
-- 2) Nine templates people kept asking for: the property owner's consent, the business closure letter and its
--    affidavit, a request to reduce penalties, an affidavit of undertaking, a fire safety inspection request, a deed
--    of sale for a vehicle, a notice of changes to the city, and a sworn statement of capital for new businesses.
-- 3) A new online-only service: SEC General Information Sheet filing through eFAST.

-- ======================================================================== 1) vehicles by fuel and use
alter table public.vehicles
  add column if not exists fuel text not null default 'gas' check (fuel in ('gas', 'diesel', 'hybrid', 'electric')),
  add column if not exists usage text not null default 'private' check (usage in ('private', 'company', 'for_hire_people', 'for_hire_goods')),
  add column if not exists transfer_pending boolean not null default false;

insert into public.requirement_types
  (code, name, subject, agency, expires, due_rule, per_location, activities, structures, confidence, auto_add, help_text, sort,
   category, where_to_file, online_url, online_label, validity_note, depends_on, checklist) values
  ('pa_insurance', 'Passenger Accident Insurance', 'vehicle', 'Insurance company accredited by LTFRB', true, 'lto_plate', false, null, null, 'confirmed', false,
   $t$Required for vehicles that carry passengers for hire (jeepneys, buses, taxis, TNVS, UV Express). Renew it with the registration.$t$, 35,
   'for_hire', $t$Any insurance company accredited by LTFRB for passenger accident insurance.$t$, null, null,
   $t$Usually one year; renew it before the registration.$t$, '{}',
   $j$[{"k":"buy","t":"Buy or renew the policy from an LTFRB-accredited insurer"},{"k":"copy","t":"Keep a copy in the vehicle and upload it here"}]$j$::jsonb),
  ('tricycle_franchise', 'Tricycle Franchise (MTOP)', 'vehicle', 'City or municipal hall (tricycle franchising office)', true, 'annual', false, null, null, 'confirmed', false,
   $t$A tricycle for hire needs the city's or municipality's Motorized Tricycle Operator's Permit (MTOP). Cities set their own rules and renewal dates.$t$, 55,
   'for_hire', $t$Your city or municipal hall's tricycle franchising office (often under the BPLO or a tricycle regulatory unit).$t$, null, null,
   $t$Usually renewed every year. Check your city's deadline.$t$, '{}',
   $j$[{"k":"prev","t":"Last year's MTOP and official receipt"},{"k":"orcr","t":"Current LTO OR/CR of the tricycle"},{"k":"license","t":"Driver's license of the operator or driver"},{"k":"toda","t":"TODA membership certificate, if your city asks"},{"k":"pay","t":"Pay the franchise fee and keep the receipt"}]$j$::jsonb),
  ('transfer_ownership', 'LTO Transfer of Ownership', 'vehicle', 'LTO', false, 'manual', false, null, null, 'confirmed', false,
   $t$The vehicle is still registered in the seller's name. The buyer files the transfer at LTO soon after the sale; LTO charges a penalty for late transfers.$t$, 15,
   'registration', $t$Any LTO district office, usually the one where the vehicle is registered. Some offices take appointments through the LTMS portal.$t$,
   'https://portal.lto.gov.ph/', 'LTO LTMS portal',
   $t$Done once per sale. Record the new CR (in your name) here when it's released.$t$, '{}',
   $j$[{"k":"deed","t":"Notarized Deed of Absolute Sale","d":"A template is under Templates."},{"k":"orcr","t":"The original CR and the latest OR"},{"k":"hpg","t":"PNP-HPG motor vehicle clearance","d":"From the Highway Patrol Group; the vehicle is checked physically."},{"k":"ids","t":"Valid IDs of the seller and the buyer"},{"k":"ins","t":"CTPL insurance in the buyer's name"},{"k":"insp","t":"Inspection (and emission test, unless fully electric)","d":"LTO tells you which apply."},{"k":"pay","t":"Pay the transfer fees and get the new CR"}]$j$::jsonb)
on conflict (code) do nothing;

-- true: needed; false: doesn't apply; null: the usual rules decide. The app has the same rules (vehicle-rules.js).
create or replace function private.vehicle_rule(p_code text, p_type text, p_fuel text, p_usage text, p_transfer boolean) returns boolean
language sql immutable set search_path = '' as $$
  select case p_code
    when 'emission_test' then p_fuel is distinct from 'electric'
    when 'ltfrb_franchise' then p_usage in ('for_hire_people', 'for_hire_goods') and p_type is distinct from 'Tricycle'
    when 'pa_insurance' then p_usage = 'for_hire_people'
    when 'tricycle_franchise' then p_type = 'Tricycle' and p_usage in ('for_hire_people', 'for_hire_goods')
    when 'transfer_ownership' then coalesce(p_transfer, false)
    else null end
$$;

create or replace function private.sync_vehicle_requirements() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.deleted_at is not null then return new; end if;
  perform set_config('pp.quiet_audit', 'on', true);
  -- what now applies
  insert into public.requirements (org_id, subject, vehicle_id, type_code, name, expires, confidence)
  select new.org_id, 'vehicle', new.id, t.code, t.name, t.expires, 'confirmed'
  from public.requirement_types t
  where t.subject = 'vehicle' and private.vehicle_rule(t.code, new.vehicle_type, new.fuel, new.usage, new.transfer_pending)
    and not exists (select 1 from public.requirements r where r.vehicle_id = new.id and r.type_code = t.code and r.deleted_at is null);
  -- what no longer applies, only while nothing has been recorded for it
  update public.requirements r set deleted_at = now()
  where r.vehicle_id = new.id and r.deleted_at is null
    and private.vehicle_rule(r.type_code, new.vehicle_type, new.fuel, new.usage, new.transfer_pending) = false
    and not exists (select 1 from public.requirement_cycles c where c.requirement_id = r.id and c.deleted_at is null)
    and not exists (select 1 from public.documents d where d.requirement_id = r.id and d.deleted_at is null);
  perform set_config('pp.quiet_audit', 'off', true);
  return new;
end $$;
revoke all on function private.sync_vehicle_requirements() from public;

drop trigger if exists vehicles_rules on public.vehicles;
create trigger vehicles_rules after update of vehicle_type, fuel, usage, transfer_pending on public.vehicles
  for each row when (old.vehicle_type is distinct from new.vehicle_type or old.fuel is distinct from new.fuel
    or old.usage is distinct from new.usage or old.transfer_pending is distinct from new.transfer_pending)
  execute function private.sync_vehicle_requirements();

-- ======================================================================== 2) nine more templates
-- Field sources the app fills in: business_name, business_address, city, tin, me_name, me_title, me_email, today,
-- permit_name, permit_no, permit_issuer, permit_issued. Everything else is typed. Sworn statements end with a jurat,
-- deeds and consents with an acknowledgment, both in the form the 2004 Rules on Notarial Practice use.
insert into public.doc_templates (code, title, category, summary, use_when, notarize, sort, fields, body, price_php) values
('owner_consent', 'Property owner''s consent', 'Sworn and notarized',
 'The owner of the place lets your business operate there, for the barangay and the city hall.',
 'When you don''t have a written lease, or the place belongs to a relative or another company. The owner signs in front of a notary.',
 true, 90,
 $j$[{"key":"owner_name","label":"Property owner's full name","required":true},
   {"key":"owner_address","label":"Owner's address","required":true},
   {"key":"property_address","label":"Address of the place","source":"business_address","required":true},
   {"key":"title_no","label":"Title or tax declaration no.","hint":"e.g. TCT No. 123456 or TD No. 00-0000-0000"},
   {"key":"business_owner","label":"Your full name","source":"me_name","required":true},
   {"key":"business_name","label":"Business name","source":"business_name","required":true},
   {"key":"business_activity","label":"What the business does there","hint":"e.g. a bakery and coffee shop","required":true},
   {"key":"term","label":"For how long","hint":"e.g. from 1 January 2027 until revoked in writing","required":true},
   {"key":"owner_id","label":"Owner's ID for the notary"}]$j$::jsonb,
$t$CONSENT OF PROPERTY OWNER

I, {{owner_name}}, of legal age, Filipino, with address at {{owner_address}}, state that:

1. I am the registered owner of the property located at {{property_address}}, covered by {{title_no}};

2. I give my consent to {{business_owner}} to use the property for the operation of {{business_name}}, engaged in {{business_activity}}, {{term}};

3. I allow {{business_owner}} to present this consent to the barangay, the city or municipal hall, the Bureau of Fire Protection and any other office for the business's clearances, permits and licenses; and

4. This consent does not transfer ownership or any right over the property other than its use for the business stated above, and I may revoke it in writing.

IN WITNESS WHEREOF, I have signed this on ______________ at ______________, Philippines.


_____________________________
{{owner_name}}
Property owner


Signed in the presence of:

_____________________________          _____________________________


ACKNOWLEDGMENT

REPUBLIC OF THE PHILIPPINES )
______________________________ ) S.S.

BEFORE ME, a Notary Public for and in ______________, this ______________, personally appeared {{owner_name}}, with {{owner_id}} as competent evidence of identity, known to me to be the same person who executed the foregoing instrument, and who acknowledged to me that it is a free and voluntary act and deed.

This instrument, consisting of ___ page(s) including this page, has been signed on each page by the party and the witnesses.

WITNESS MY HAND AND SEAL on the date and at the place first written above.

Doc. No. _____;
Page No. _____;
Book No. _____;
Series of _____.$t$, 250),

('closure_letter', 'Business closure (retirement) letter', 'Letters',
 'Tells the city you have stopped operating, so it can retire your business permit.',
 'When you close a business or a branch. File it with the BPLO together with the affidavit of closure and your last permit, before the next renewal.',
 false, 100,
 $j$[{"key":"date","label":"Date","source":"today"},
   {"key":"city","label":"City or municipality","source":"city","required":true},
   {"key":"owner_name","label":"Your name","source":"me_name","required":true},
   {"key":"owner_title","label":"Your position","source":"me_title","hint":"e.g. Owner, President"},
   {"key":"business_name","label":"Business name","source":"business_name","required":true},
   {"key":"business_address","label":"Business address","source":"business_address","required":true},
   {"key":"permit_no","label":"Last business permit no.","source":"permit_no"},
   {"key":"closed_on","label":"Last day of operation","hint":"e.g. 31 December 2026","required":true},
   {"key":"reason","label":"Reason (optional)","hint":"e.g. the lease ended and we did not reopen elsewhere"}]$j$::jsonb,
$t${{date}}

The Head
Business Permits and Licensing Office
{{city}}

Subject: Retirement of business, {{business_name}}

Dear Sir or Madam:

I am writing to inform your office that {{business_name}}, located at {{business_address}}, with Business Permit No. {{permit_no}}, stopped operating on {{closed_on}}. {{reason}}

I respectfully request that the business be retired from your records as of that date, and that I be advised of any remaining taxes or fees to be settled, together with the requirements for the certificate of retirement.

Attached are the affidavit of closure, the last business permit and its official receipt, and a copy of my valid ID.

Thank you.

Respectfully,


_____________________________
{{owner_name}}
{{owner_title}}, {{business_name}}$t$, 150),

('closure_affidavit', 'Affidavit of closure (non-operation)', 'Sworn and notarized',
 'Your sworn statement that the business has stopped operating, and its sales up to the last day.',
 'With the closure letter, when you retire a business permit with the city. Many offices also ask for it when updating or closing a BIR registration. Sign in front of a notary.',
 true, 110,
 $j$[{"key":"owner_name","label":"Your full name","source":"me_name","required":true},
   {"key":"owner_address","label":"Your home address","required":true},
   {"key":"owner_title","label":"Your position","source":"me_title"},
   {"key":"business_name","label":"Business name","source":"business_name","required":true},
   {"key":"business_address","label":"Business address","source":"business_address","required":true},
   {"key":"tin","label":"TIN","source":"tin"},
   {"key":"closed_on","label":"Last day of operation","required":true},
   {"key":"period","label":"Sales covered","hint":"e.g. 1 January to 31 December 2026","required":true},
   {"key":"gross_sales","label":"Gross sales for that period (₱)","required":true},
   {"key":"owner_id","label":"Your ID for the notary"}]$j$::jsonb,
$t$REPUBLIC OF THE PHILIPPINES )
______________________________ ) S.S.

AFFIDAVIT OF CLOSURE OF BUSINESS

I, {{owner_name}}, of legal age, Filipino, with address at {{owner_address}}, after having been sworn in accordance with law, state that:

1. I am the {{owner_title}} of {{business_name}}, with business address at {{business_address}} and TIN {{tin}};

2. {{business_name}} permanently stopped operating at that address on {{closed_on}}, and has not operated there since;

3. The gross sales or receipts of the business from {{period}} amount to PHP {{gross_sales}}, as shown in its books of accounts and tax returns;

4. I am executing this affidavit to support the retirement of the business permit of {{business_name}} and the update of its registrations, and for whatever lawful purpose it may serve; and

5. I understand that a false statement in this affidavit may make me liable under the law.

IN WITNESS WHEREOF, I have signed this on ______________ at ______________, Philippines.


_____________________________
{{owner_name}}
Affiant


SUBSCRIBED AND SWORN to before me on ______________ at ______________, affiant exhibiting {{owner_id}} as competent evidence of identity.

Doc. No. _____;
Page No. _____;
Book No. _____;
Series of _____.$t$, 250),

('penalty_relief_request', 'Request to reduce penalties', 'Letters',
 'A polite letter asking the city treasurer to reduce or waive surcharges and interest on a late renewal.',
 'When you renewed late for a reason outside your control. It is a request only: the treasurer can grant relief only where an ordinance or tax amnesty allows it. Pay what is due on time while you wait.',
 false, 120,
 $j$[{"key":"date","label":"Date","source":"today"},
   {"key":"city","label":"City or municipality","source":"city","required":true},
   {"key":"owner_name","label":"Your name","source":"me_name","required":true},
   {"key":"owner_title","label":"Your position","source":"me_title"},
   {"key":"business_name","label":"Business name","source":"business_name","required":true},
   {"key":"business_address","label":"Business address","source":"business_address"},
   {"key":"permit_no","label":"Business permit or account no.","source":"permit_no"},
   {"key":"amount","label":"Surcharge and interest assessed (₱)","required":true},
   {"key":"reason","label":"What happened","hint":"e.g. our owner was hospitalized from 5 to 28 January 2027","required":true},
   {"key":"proof","label":"Proof you are attaching","hint":"e.g. a medical certificate dated 29 January 2027","required":true},
   {"key":"ordinance","label":"Ordinance or amnesty you are relying on, if any","hint":"Leave blank if you don't know of one"}]$j$::jsonb,
$t${{date}}

The City or Municipal Treasurer
{{city}}

Subject: Request for reduction or waiver of surcharges and interest, {{business_name}}

Dear Sir or Madam:

{{business_name}}, with business address at {{business_address}} and Business Permit or Account No. {{permit_no}}, was assessed surcharges and interest of PHP {{amount}} for the late renewal of its business permit.

The renewal was late for a reason outside our control: {{reason}}. Attached is {{proof}}.

We have always renewed on time and we intend to settle the basic tax and fees in full. We respectfully ask your office to consider reducing or waiving the surcharges and interest, under {{ordinance}} or any ordinance, amnesty or relief that your office may apply.

We understand that this request does not suspend any payment deadline, and that the decision rests with your office. Thank you for considering it.

Respectfully,


_____________________________
{{owner_name}}
{{owner_title}}, {{business_name}}$t$, 150),

('affidavit_of_undertaking', 'Affidavit of undertaking', 'Sworn and notarized',
 'Your sworn promise to complete a missing requirement or fix a deficiency by a set date.',
 'When an office (the city hall, the fire station, the barangay) lets you proceed now if you promise in writing to comply by a deadline. Sign in front of a notary.',
 true, 130,
 $j$[{"key":"owner_name","label":"Your full name","source":"me_name","required":true},
   {"key":"owner_address","label":"Your home address","required":true},
   {"key":"owner_title","label":"Your position","source":"me_title"},
   {"key":"business_name","label":"Business name","source":"business_name","required":true},
   {"key":"business_address","label":"Business address","source":"business_address","required":true},
   {"key":"office","label":"Office you are promising","hint":"e.g. Bureau of Fire Protection, Makati City Fire Station","required":true},
   {"key":"application","label":"For which application","source":"permit_name","required":true},
   {"key":"undertaking","label":"What you will do","hint":"e.g. install two 10-lb ABC fire extinguishers and an emergency light at the kitchen exit","required":true},
   {"key":"deadline","label":"By when","hint":"e.g. 28 February 2027","required":true},
   {"key":"owner_id","label":"Your ID for the notary"}]$j$::jsonb,
$t$REPUBLIC OF THE PHILIPPINES )
______________________________ ) S.S.

AFFIDAVIT OF UNDERTAKING

I, {{owner_name}}, of legal age, Filipino, with address at {{owner_address}}, after having been sworn in accordance with law, state that:

1. I am the {{owner_title}} of {{business_name}}, with business address at {{business_address}};

2. {{business_name}} has applied with the {{office}} for its {{application}};

3. I undertake to {{undertaking}} on or before {{deadline}}, and to inform the {{office}} once it is done so it may verify;

4. I understand that if this undertaking is not fulfilled by that date, the {{office}} may act on the application in accordance with its rules, including denying, suspending or revoking it; and

5. I am executing this affidavit to support the application above and for no other purpose.

IN WITNESS WHEREOF, I have signed this on ______________ at ______________, Philippines.


_____________________________
{{owner_name}}
Affiant


SUBSCRIBED AND SWORN to before me on ______________ at ______________, affiant exhibiting {{owner_id}} as competent evidence of identity.

Doc. No. _____;
Page No. _____;
Book No. _____;
Series of _____.$t$, 250),

('fsic_inspection_request', 'Request for fire safety inspection', 'Letters',
 'Asks the fire station to schedule the inspection for your Fire Safety Inspection Certificate.',
 'When the fire inspection hasn''t been scheduled yet, or after you fixed what the last inspection found. Many stations also take requests online or at the one-stop shop.',
 false, 140,
 $j$[{"key":"date","label":"Date","source":"today"},
   {"key":"station","label":"Fire station","hint":"e.g. Makati City Fire Station","required":true},
   {"key":"owner_name","label":"Your name","source":"me_name","required":true},
   {"key":"owner_title","label":"Your position","source":"me_title"},
   {"key":"business_name","label":"Business name","source":"business_name","required":true},
   {"key":"business_address","label":"Business address","source":"business_address","required":true},
   {"key":"purpose","label":"For","hint":"e.g. the renewal of our business permit for 2027","required":true},
   {"key":"occupancy","label":"What the place is used for","hint":"e.g. a restaurant with a kitchen, ground floor, about 80 sq m","required":true},
   {"key":"contact","label":"Contact person and mobile","hint":"e.g. Ana Cruz, 0917 000 0000","required":true},
   {"key":"times","label":"Best days and times","hint":"e.g. weekdays, 9 am to 4 pm"}]$j$::jsonb,
$t${{date}}

The City or Municipal Fire Marshal
{{station}}
Bureau of Fire Protection

Subject: Request for fire safety inspection, {{business_name}}

Dear Sir or Madam:

We respectfully request a fire safety inspection of {{business_name}}, located at {{business_address}}, for {{purpose}}.

The place is used as {{occupancy}}. Our contact person is {{contact}}, and the place is open for inspection {{times}}.

We will have our fire safety equipment, the last Fire Safety Inspection Certificate and the official receipt of the fire code fees ready for your inspector.

Thank you.

Respectfully,


_____________________________
{{owner_name}}
{{owner_title}}, {{business_name}}$t$, 150),

('vehicle_deed_of_sale', 'Deed of Absolute Sale (motor vehicle)', 'Sworn and notarized',
 'The sale of a car, motorcycle or truck, for the LTO transfer of ownership and the HPG clearance.',
 'When you sell or buy a vehicle. Both of you and two witnesses sign, then it is notarized. LTO and the PNP-HPG ask for it to transfer the registration.',
 true, 150,
 $j$[{"key":"seller_name","label":"Seller's full name","required":true},
   {"key":"seller_address","label":"Seller's address","required":true},
   {"key":"buyer_name","label":"Buyer's full name","required":true},
   {"key":"buyer_address","label":"Buyer's address","required":true},
   {"key":"make","label":"Make, model and year","hint":"e.g. Toyota Vios 1.3 E, 2021","required":true},
   {"key":"plate","label":"Plate no.","required":true},
   {"key":"color","label":"Color"},
   {"key":"engine_no","label":"Engine no.","required":true},
   {"key":"chassis_no","label":"Chassis no.","required":true},
   {"key":"mv_file","label":"MV file no."},
   {"key":"cr_no","label":"Certificate of Registration (CR) no.","required":true},
   {"key":"price_words","label":"Price in words","hint":"e.g. Four Hundred Fifty Thousand Pesos","required":true},
   {"key":"price","label":"Price in figures (₱)","required":true},
   {"key":"seller_id","label":"Seller's ID for the notary"},
   {"key":"buyer_id","label":"Buyer's ID for the notary"}]$j$::jsonb,
$t$DEED OF ABSOLUTE SALE OF MOTOR VEHICLE

KNOW ALL PERSONS BY THESE PRESENTS:

I, {{seller_name}}, of legal age, Filipino, with address at {{seller_address}} (the SELLER), for and in consideration of the sum of {{price_words}} (PHP {{price}}), Philippine currency, received in full from {{buyer_name}}, of legal age, Filipino, with address at {{buyer_address}} (the BUYER), hereby SELL, TRANSFER and CONVEY absolutely to the BUYER, his or her heirs and assigns, the following motor vehicle:

Make, model and year: {{make}}
Plate No.: {{plate}}
Color: {{color}}
Engine No.: {{engine_no}}
Chassis No.: {{chassis_no}}
MV File No.: {{mv_file}}
Certificate of Registration No.: {{cr_no}}

The SELLER warrants that he or she is the lawful owner of the vehicle; that it is free from any lien, mortgage or encumbrance; that it is not the subject of any pending case or claim; and that he or she will defend the BUYER's title against any lawful claim.

The SELLER delivers to the BUYER the vehicle, its original Certificate of Registration, its latest Official Receipt of registration and its keys, and will sign any other paper needed to transfer the registration to the BUYER. From the signing of this deed, the BUYER is responsible for the vehicle, its use and its registration, and will have it transferred to his or her name with the Land Transportation Office.

IN WITNESS WHEREOF, the parties have signed this on ______________ at ______________, Philippines.


_____________________________          _____________________________
{{seller_name}}                          {{buyer_name}}
SELLER                                   BUYER


Signed in the presence of:

_____________________________          _____________________________


ACKNOWLEDGMENT

REPUBLIC OF THE PHILIPPINES )
______________________________ ) S.S.

BEFORE ME, a Notary Public for and in ______________, this ______________, personally appeared:

{{seller_name}}, with {{seller_id}} as competent evidence of identity; and
{{buyer_name}}, with {{buyer_id}} as competent evidence of identity,

known to me to be the same persons who executed the foregoing Deed of Absolute Sale, and who acknowledged to me that it is their free and voluntary act and deed.

This instrument, consisting of ___ page(s) including this page, has been signed on each page by the parties and their witnesses.

WITNESS MY HAND AND SEAL on the date and at the place first written above.

Doc. No. _____;
Page No. _____;
Book No. _____;
Series of _____.$t$, 350),

('change_notice', 'Notice of change to the city', 'Letters',
 'Asks the city to update your business permit after a change of name, address, owner or line of business.',
 'Within the period your city sets after the change, so the permit matches your business. Attach the papers that prove the change (for example the new DTI or SEC certificate, or the new lease).',
 false, 160,
 $j$[{"key":"date","label":"Date","source":"today"},
   {"key":"city","label":"City or municipality","source":"city","required":true},
   {"key":"owner_name","label":"Your name","source":"me_name","required":true},
   {"key":"owner_title","label":"Your position","source":"me_title"},
   {"key":"business_name","label":"Business name (as on the permit)","source":"business_name","required":true},
   {"key":"permit_no","label":"Business permit no.","source":"permit_no"},
   {"key":"change_kind","label":"What changed","hint":"e.g. business address, business name, owner, line of business","required":true},
   {"key":"from_value","label":"From","required":true},
   {"key":"to_value","label":"To","required":true},
   {"key":"effective","label":"Effective","hint":"e.g. 1 March 2027","required":true},
   {"key":"attachments","label":"Papers attached","hint":"e.g. the new DTI certificate and the new lease contract","required":true}]$j$::jsonb,
$t${{date}}

The Head
Business Permits and Licensing Office
{{city}}

Subject: Request to update the business permit of {{business_name}}

Dear Sir or Madam:

We respectfully inform your office of a change in the {{change_kind}} of {{business_name}}, Business Permit No. {{permit_no}}, effective {{effective}}:

From: {{from_value}}
To: {{to_value}}

We request that your records and our business permit be updated accordingly, and that we be advised of any fees or other requirements for the amendment. Attached are {{attachments}}.

Thank you.

Respectfully,


_____________________________
{{owner_name}}
{{owner_title}}, {{business_name}}$t$, 150),

('capital_declaration', 'Sworn statement of capital', 'Sworn and notarized',
 'Declares the capital you put into a new business, which most cities use to compute its first business tax.',
 'When you apply for your first business permit: new businesses have no sales yet, so the city taxes the capital instead. Sign in front of a notary.',
 true, 170,
 $j$[{"key":"owner_name","label":"Your full name","source":"me_name","required":true},
   {"key":"owner_address","label":"Your home address","required":true},
   {"key":"owner_title","label":"Your position","source":"me_title"},
   {"key":"business_name","label":"Business name","source":"business_name","required":true},
   {"key":"business_address","label":"Business address","source":"business_address","required":true},
   {"key":"business_activity","label":"Line of business","hint":"e.g. retail of baked goods","required":true},
   {"key":"capital_words","label":"Capital in words","hint":"e.g. Two Hundred Thousand Pesos","required":true},
   {"key":"capital","label":"Capital in figures (₱)","required":true},
   {"key":"started_on","label":"Start of operations","hint":"e.g. 15 February 2027","required":true},
   {"key":"owner_id","label":"Your ID for the notary"}]$j$::jsonb,
$t$REPUBLIC OF THE PHILIPPINES )
______________________________ ) S.S.

SWORN STATEMENT OF CAPITAL INVESTMENT

I, {{owner_name}}, of legal age, Filipino, with address at {{owner_address}}, after having been sworn in accordance with law, state that:

1. I am the {{owner_title}} of {{business_name}}, a new business engaged in {{business_activity}}, with business address at {{business_address}};

2. The business started, or will start, operating on {{started_on}};

3. The capital invested in the business is {{capital_words}} (PHP {{capital}}), consisting of the cash, equipment, inventory and other assets put into the business;

4. I am executing this statement to support the application for the first business permit of {{business_name}} and the computation of its business tax; and

5. I understand that a false statement in this affidavit may make me liable under the law.

IN WITNESS WHEREOF, I have signed this on ______________ at ______________, Philippines.


_____________________________
{{owner_name}}
Affiant


SUBSCRIBED AND SWORN to before me on ______________ at ______________, affiant exhibiting {{owner_id}} as competent evidence of identity.

Doc. No. _____;
Page No. _____;
Book No. _____;
Series of _____.$t$, 250)
on conflict (code) do nothing;

-- ======================================================================== 3) one more online-only service
insert into public.services (code, name, category, summary, includes, price_from, price_unit, turnaround, applies_to, sort, active)
values ('filing_sec_gis', 'SEC General Information Sheet (GIS) filing', 'document',
  'Corporations file a GIS with the SEC every year, within 30 days of the annual meeting. We prepare it from your details, you sign it, and we file it online through SEC eFAST and save the filing receipt to your account.',
  array['GIS prepared from your records, for you to check and sign', 'Filed online through SEC eFAST', 'Filing receipt saved to your account'],
  2500, 'per filing', '3-5 working days, once we have your signed GIS', 'business', 335, true)
on conflict (code) do nothing;

insert into private.features (name) values ('vehicles2') on conflict do nothing;
