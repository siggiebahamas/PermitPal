// The ready-made templates, exactly as the database has them (exported from the migrations), for the demo and tests.
export const TEMPLATES = [
 {
  "code": "authorization_letter",
  "title": "Authorization letter",
  "category": "Letters",
  "summary": "Lets someone file, pay for and claim a permit for your business.",
  "use_when": "When an employee, liaison or relative goes to the city hall, barangay or another office for you. Bring both IDs.",
  "notarize": false,
  "sort": 10,
  "version": 1,
  "fields": [
   {
    "key": "date",
    "label": "Date",
    "source": "today"
   },
   {
    "key": "office",
    "hint": "e.g. Business Permits and Licensing Office",
    "label": "Office",
    "required": true
   },
   {
    "key": "city",
    "label": "City or municipality",
    "source": "city"
   },
   {
    "key": "owner_name",
    "label": "Your name",
    "source": "me_name",
    "required": true
   },
   {
    "key": "owner_title",
    "hint": "e.g. Owner, President",
    "label": "Your position",
    "source": "me_title"
   },
   {
    "key": "business_name",
    "label": "Business name",
    "source": "business_name",
    "required": true
   },
   {
    "key": "business_address",
    "label": "Business address",
    "source": "business_address"
   },
   {
    "key": "rep_name",
    "label": "Person you authorize",
    "required": true
   },
   {
    "key": "rep_id",
    "hint": "e.g. Driver's License No. N01-23-456789",
    "label": "Their ID"
   },
   {
    "key": "permit_name",
    "label": "Permit or document",
    "source": "permit_name",
    "required": true
   },
   {
    "key": "valid_until",
    "hint": "e.g. 31 March 2027",
    "label": "Valid until"
   }
  ],
  "body": "{{date}}\n\n{{office}}\n{{city}}\n\nTo whom it may concern:\n\nI, {{owner_name}}, {{owner_title}} of {{business_name}}, with business address at {{business_address}}, authorize {{rep_name}}, holder of {{rep_id}}, to process, pay for and claim the {{permit_name}} of {{business_name}} on our behalf.\n\nThis covers filing the application, paying the fees, signing the acknowledgment receipt and claiming the document. This authorization is valid until {{valid_until}}.\n\nAttached are copies of my valid ID and the valid ID of my representative.\n\nThank you.\n\nRespectfully,\n\n\n_____________________________\n{{owner_name}}\n{{owner_title}}, {{business_name}}\n\n\nSpecimen signature of {{rep_name}}:\n\n_____________________________"
 },
 {
  "code": "special_power_of_attorney",
  "title": "Special Power of Attorney (permits)",
  "category": "Sworn and notarized",
  "summary": "Gives someone authority to handle your permits and licenses for a set period.",
  "use_when": "When an office asks for an SPA instead of an authorization letter, or someone will handle many permits for you. Sign in front of a notary.",
  "notarize": true,
  "sort": 20,
  "version": 1,
  "fields": [
   {
    "key": "owner_name",
    "label": "Your full name",
    "source": "me_name",
    "required": true
   },
   {
    "key": "owner_address",
    "label": "Your home address",
    "required": true
   },
   {
    "key": "owner_title",
    "hint": "e.g. Owner, President",
    "label": "Your position",
    "source": "me_title"
   },
   {
    "key": "business_name",
    "label": "Business name",
    "source": "business_name",
    "required": true
   },
   {
    "key": "rep_name",
    "label": "Your attorney-in-fact (the person you appoint)",
    "required": true
   },
   {
    "key": "rep_address",
    "label": "Their address",
    "required": true
   },
   {
    "key": "permits",
    "hint": "e.g. Business Permit, Barangay Clearance, Fire Safety Inspection Certificate",
    "label": "Permits covered",
    "required": true
   },
   {
    "key": "offices",
    "hint": "e.g. the City of Pasig, its barangays and the Bureau of Fire Protection",
    "label": "Offices",
    "required": true
   },
   {
    "key": "valid_until",
    "hint": "e.g. 31 December 2027",
    "label": "Valid until",
    "required": true
   },
   {
    "key": "owner_id",
    "hint": "e.g. Passport No. P1234567A",
    "label": "Your ID for the notary"
   },
   {
    "key": "rep_id",
    "label": "Their ID for the notary"
   }
  ],
  "body": "SPECIAL POWER OF ATTORNEY\n\nKNOW ALL PERSONS BY THESE PRESENTS:\n\nI, {{owner_name}}, of legal age, Filipino, with address at {{owner_address}}, {{owner_title}} of {{business_name}}, name, constitute and appoint {{rep_name}}, of legal age, Filipino, with address at {{rep_address}}, as my true and lawful attorney-in-fact, for me and in my name, place and stead, to do the following:\n\n1. To file, process, follow up and claim the applications for the issuance and renewal of the permits, licenses, clearances and certificates of {{business_name}}, including {{permits}}, with {{offices}};\n\n2. To sign, submit and receive the application forms, sworn declarations, acknowledgment receipts and other documents needed for the above;\n\n3. To pay the fees and charges for the above and receive the official receipts; and\n\n4. To do all other acts needed to carry out the above.\n\nI give my attorney-in-fact full power and authority to do every act necessary for the above as fully as I could if personally present, and I confirm all that my attorney-in-fact lawfully does under this power. This Special Power of Attorney is valid until {{valid_until}}, unless I revoke it earlier in writing.\n\nIN WITNESS WHEREOF, I have signed this on ______________ at ______________, Philippines.\n\n\n_____________________________\n{{owner_name}}\nPrincipal\n\n\n_____________________________\n{{rep_name}}\nAttorney-in-fact\n\n\nSigned in the presence of:\n\n_____________________________          _____________________________\n\n\nACKNOWLEDGMENT\n\nREPUBLIC OF THE PHILIPPINES )\n______________________________ ) S.S.\n\nBefore me, a Notary Public for and in ______________, on ______________, personally appeared:\n\n{{owner_name}}, with {{owner_id}}\n{{rep_name}}, with {{rep_id}}\n\nknown to me to be the same persons who signed the foregoing Special Power of Attorney, consisting of ___ pages including this page, and who acknowledged that it is their free and voluntary act and deed.\n\nWITNESS MY HAND AND SEAL on the date and place first written above.\n\nDoc. No. _____;\nPage No. _____;\nBook No. _____;\nSeries of _____."
 },
 {
  "code": "secretary_certificate",
  "title": "Secretary's Certificate (board authority)",
  "category": "Sworn and notarized",
  "summary": "Shows a corporation's board authorized someone to handle its permits.",
  "use_when": "For corporations, when an office asks proof that the person signing may act for the company. The corporate secretary signs it in front of a notary.",
  "notarize": true,
  "sort": 30,
  "version": 1,
  "fields": [
   {
    "key": "secretary_name",
    "label": "Corporate secretary's name",
    "required": true
   },
   {
    "key": "business_name",
    "label": "Corporation name",
    "source": "business_name",
    "required": true
   },
   {
    "key": "business_address",
    "label": "Principal office",
    "source": "business_address",
    "required": true
   },
   {
    "key": "sec_no",
    "label": "SEC registration no.",
    "required": true
   },
   {
    "key": "meeting_date",
    "hint": "e.g. 15 January 2027",
    "label": "Date of the board meeting",
    "required": true
   },
   {
    "key": "permits",
    "hint": "e.g. Business Permit, Fire Safety Inspection Certificate and Sanitary Permit",
    "label": "Permits covered",
    "required": true
   },
   {
    "key": "rep_name",
    "label": "Person authorized",
    "required": true
   },
   {
    "key": "rep_position",
    "hint": "e.g. Operations Manager",
    "label": "Their position",
    "required": true
   },
   {
    "key": "secretary_id",
    "label": "Secretary's ID for the notary"
   }
  ],
  "body": "SECRETARY'S CERTIFICATE\n\nI, {{secretary_name}}, of legal age, Filipino, with office address at {{business_address}}, after having been sworn in accordance with law, certify that:\n\n1. I am the Corporate Secretary of {{business_name}} (the \"Corporation\"), a corporation organized and existing under Philippine law, with SEC Registration No. {{sec_no}} and principal office at {{business_address}}.\n\n2. At the meeting of the Board of Directors of the Corporation held on {{meeting_date}}, at which a quorum was present and acting throughout, the following resolutions were approved:\n\n\"RESOLVED, that the Corporation apply for, renew and secure its permits, licenses, clearances and certificates with government offices, including {{permits}};\n\nRESOLVED FURTHER, that {{rep_name}}, {{rep_position}}, is authorized to sign, file and receive, for and on behalf of the Corporation, all documents needed for the foregoing, to pay the corresponding fees, and to do all acts necessary to carry out these resolutions.\"\n\n3. These resolutions have not been revoked, amended or modified and remain in full force and effect.\n\nIN WITNESS WHEREOF, I have signed this certificate on ______________ at ______________, Philippines.\n\n\n_____________________________\n{{secretary_name}}\nCorporate Secretary\n\n\nSUBSCRIBED AND SWORN to before me on ______________ at ______________, affiant exhibiting {{secretary_id}} as competent evidence of identity.\n\nDoc. No. _____;\nPage No. _____;\nBook No. _____;\nSeries of _____."
 },
 {
  "code": "affidavit_of_loss",
  "title": "Affidavit of Loss",
  "category": "Sworn and notarized",
  "summary": "For a lost permit, certificate, official receipt or registration paper.",
  "use_when": "When you need a replacement or certified copy of a lost document. Most offices ask for this first. Sign in front of a notary.",
  "notarize": true,
  "sort": 40,
  "version": 1,
  "fields": [
   {
    "key": "owner_name",
    "label": "Your full name",
    "source": "me_name",
    "required": true
   },
   {
    "key": "owner_address",
    "label": "Your home address",
    "required": true
   },
   {
    "key": "owner_title",
    "label": "Your position",
    "source": "me_title"
   },
   {
    "key": "business_name",
    "label": "Business name",
    "source": "business_name",
    "required": true
   },
   {
    "key": "business_address",
    "label": "Business address",
    "source": "business_address"
   },
   {
    "key": "lost_document",
    "label": "Document lost",
    "source": "permit_name",
    "required": true
   },
   {
    "key": "lost_no",
    "hint": "Leave blank if unknown",
    "label": "Its number",
    "source": "permit_no"
   },
   {
    "key": "issuer",
    "hint": "e.g. City of Makati",
    "label": "Issued by",
    "source": "permit_issuer",
    "required": true
   },
   {
    "key": "where_kept",
    "hint": "e.g. the office cabinet at our main branch",
    "label": "Where it was kept",
    "required": true
   },
   {
    "key": "lost_date",
    "hint": "e.g. 3 March 2027",
    "label": "When you found it missing",
    "required": true
   },
   {
    "key": "owner_id",
    "label": "Your ID for the notary"
   }
  ],
  "body": "REPUBLIC OF THE PHILIPPINES )\n______________________________ ) S.S.\n\nAFFIDAVIT OF LOSS\n\nI, {{owner_name}}, of legal age, Filipino, with address at {{owner_address}}, after having been sworn in accordance with law, state that:\n\n1. I am the {{owner_title}} of {{business_name}}, with business address at {{business_address}};\n\n2. {{business_name}} was issued a {{lost_document}}, No. {{lost_no}}, by {{issuer}};\n\n3. The document was kept at {{where_kept}};\n\n4. On or about {{lost_date}}, I discovered that the document was missing. Despite diligent efforts to find it, it could not be found, and it is now considered lost;\n\n5. The document has not been sold, pledged or used as security for any obligation, nor used for any unlawful purpose; and\n\n6. I am signing this affidavit to attest to the truth of the above and to support the request for a replacement or certified true copy of the document, and for whatever lawful purpose it may serve.\n\nIN WITNESS WHEREOF, I have signed this on ______________ at ______________, Philippines.\n\n\n_____________________________\n{{owner_name}}\nAffiant\n\n\nSUBSCRIBED AND SWORN to before me on ______________ at ______________, affiant exhibiting {{owner_id}} as competent evidence of identity.\n\nDoc. No. _____;\nPage No. _____;\nBook No. _____;\nSeries of _____."
 },
 {
  "code": "gross_sales_declaration",
  "title": "Sworn declaration of gross sales",
  "category": "Sworn and notarized",
  "summary": "Your declared sales for the year, for the business permit renewal.",
  "use_when": "For the January business permit renewal. Many cities have their own form: if yours does, use theirs and keep this as your worksheet.",
  "notarize": true,
  "sort": 50,
  "version": 1,
  "fields": [
   {
    "key": "office",
    "hint": "e.g. Business Permits and Licensing Office",
    "label": "Office",
    "required": true
   },
   {
    "key": "city",
    "label": "City or municipality",
    "source": "city",
    "required": true
   },
   {
    "key": "owner_name",
    "label": "Your full name",
    "source": "me_name",
    "required": true
   },
   {
    "key": "owner_title",
    "label": "Your position",
    "source": "me_title"
   },
   {
    "key": "business_name",
    "label": "Business name",
    "source": "business_name",
    "required": true
   },
   {
    "key": "business_address",
    "label": "Business address",
    "source": "business_address",
    "required": true
   },
   {
    "key": "tin",
    "label": "TIN",
    "source": "tin"
   },
   {
    "key": "line_of_business",
    "hint": "e.g. restaurant",
    "label": "Line of business",
    "required": true
   },
   {
    "key": "sales_year",
    "hint": "e.g. 2026",
    "label": "Year of the sales",
    "required": true
   },
   {
    "key": "gross_sales",
    "hint": "e.g. 2,450,000.00",
    "label": "Gross sales or receipts (₱)",
    "required": true
   },
   {
    "key": "permit_year",
    "hint": "e.g. 2027",
    "label": "Permit year",
    "required": true
   },
   {
    "key": "owner_id",
    "label": "Your ID for the notary"
   }
  ],
  "body": "SWORN DECLARATION OF GROSS SALES / RECEIPTS\n\n{{office}}\n{{city}}\n\nI, {{owner_name}}, of legal age, Filipino, {{owner_title}} of {{business_name}}, with business address at {{business_address}} and TIN {{tin}}, after having been sworn in accordance with law, declare that:\n\n1. The gross sales / receipts of {{business_name}} from its {{line_of_business}} business for calendar year {{sales_year}} amounted to PHP {{gross_sales}}, as shown in its books of accounts and in the returns it filed with the Bureau of Internal Revenue; and\n\n2. I am making this declaration to support the renewal of the business permit of {{business_name}} for {{permit_year}}. I understand that a false declaration may lead to penalties, surcharges and the revocation of the permit under the local revenue code.\n\nIN WITNESS WHEREOF, I have signed this on ______________ at ______________, Philippines.\n\n\n_____________________________\n{{owner_name}}\nAffiant\n\n\nSUBSCRIBED AND SWORN to before me on ______________ at ______________, affiant exhibiting {{owner_id}} as competent evidence of identity.\n\nDoc. No. _____;\nPage No. _____;\nBook No. _____;\nSeries of _____."
 },
 {
  "code": "certified_copy_request",
  "title": "Request for a certified true copy",
  "category": "Letters",
  "summary": "Asks an office for a certified copy of a permit or certificate it issued.",
  "use_when": "When a client, bank or another office wants a certified copy, or the original is damaged. If the original was lost, add an Affidavit of Loss.",
  "notarize": false,
  "sort": 60,
  "version": 1,
  "fields": [
   {
    "key": "date",
    "label": "Date",
    "source": "today"
   },
   {
    "key": "office_head",
    "hint": "e.g. The City Treasurer",
    "label": "Addressed to",
    "required": true
   },
   {
    "key": "office",
    "label": "Office",
    "source": "permit_issuer",
    "required": true
   },
   {
    "key": "office_address",
    "label": "Office address"
   },
   {
    "key": "business_name",
    "label": "Business name",
    "source": "business_name",
    "required": true
   },
   {
    "key": "business_address",
    "label": "Business address",
    "source": "business_address"
   },
   {
    "key": "copies",
    "hint": "e.g. two (2)",
    "label": "Number of copies",
    "required": true
   },
   {
    "key": "document_name",
    "label": "Document",
    "source": "permit_name",
    "required": true
   },
   {
    "key": "doc_no",
    "label": "Its number",
    "source": "permit_no"
   },
   {
    "key": "issued_on",
    "label": "Date issued",
    "source": "permit_issued"
   },
   {
    "key": "purpose",
    "hint": "e.g. a supplier accreditation",
    "label": "What it's for",
    "required": true
   },
   {
    "key": "rep_name",
    "label": "Who will receive it",
    "required": true
   },
   {
    "key": "contact",
    "label": "Your phone or email",
    "source": "me_email"
   },
   {
    "key": "owner_name",
    "label": "Your name",
    "source": "me_name",
    "required": true
   },
   {
    "key": "owner_title",
    "label": "Your position",
    "source": "me_title"
   }
  ],
  "body": "{{date}}\n\n{{office_head}}\n{{office}}\n{{office_address}}\n\nDear Sir or Madam:\n\nOn behalf of {{business_name}}, with business address at {{business_address}}, I request {{copies}} certified true copies of our {{document_name}}, No. {{doc_no}}, issued on {{issued_on}}.\n\nWe need the certified copies for {{purpose}}. We will pay the certification fees upon your advice.\n\nOur representative, {{rep_name}}, will receive the documents on our behalf. Attached are a copy of the document, if available, and a valid ID.\n\nYou may reach me at {{contact}}.\n\nThank you very much.\n\nRespectfully,\n\n\n_____________________________\n{{owner_name}}\n{{owner_title}}, {{business_name}}"
 },
 {
  "code": "landlord_letter",
  "title": "Letter to your landlord for permit papers",
  "category": "Letters",
  "summary": "Asks the property owner for the papers the city needs from them.",
  "use_when": "Before a business permit renewal, when the city asks for the lease, the owner's consent or the property's tax receipt.",
  "notarize": false,
  "sort": 70,
  "version": 1,
  "fields": [
   {
    "key": "date",
    "label": "Date",
    "source": "today"
   },
   {
    "key": "landlord_name",
    "label": "Landlord's name",
    "required": true
   },
   {
    "key": "landlord_address",
    "label": "Landlord's address"
   },
   {
    "key": "business_name",
    "label": "Business name",
    "source": "business_name",
    "required": true
   },
   {
    "key": "unit",
    "hint": "e.g. Unit 3, ground floor",
    "label": "What you lease",
    "required": true
   },
   {
    "key": "business_address",
    "label": "Business address",
    "source": "business_address",
    "required": true
   },
   {
    "key": "office",
    "hint": "e.g. the Business Permits and Licensing Office of Quezon City",
    "label": "Which office asks",
    "required": true
   },
   {
    "key": "documents_needed",
    "label": "Papers needed",
    "default": "1. A copy of our lease contract\n2. The property owner's consent to use the space for our business, if required\n3. A copy of the current real property tax receipt, if required",
    "required": true,
    "multiline": true
   },
   {
    "key": "needed_by",
    "hint": "e.g. 10 January 2027",
    "label": "Needed by",
    "required": true
   },
   {
    "key": "contact",
    "label": "Your phone or email",
    "source": "me_email"
   },
   {
    "key": "owner_name",
    "label": "Your name",
    "source": "me_name",
    "required": true
   },
   {
    "key": "owner_title",
    "label": "Your position",
    "source": "me_title"
   }
  ],
  "body": "{{date}}\n\n{{landlord_name}}\n{{landlord_address}}\n\nDear {{landlord_name}}:\n\nWe are renewing the permits of {{business_name}}, which leases {{unit}} at {{business_address}}. {{office}} asks us to submit the following papers from the property owner:\n\n{{documents_needed}}\n\nMay we ask for copies of these by {{needed_by}}? We can pick them up from you, or receive them by email at {{contact}}.\n\nThank you for your help. Please let me know if you need anything from us.\n\nSincerely,\n\n\n_____________________________\n{{owner_name}}\n{{owner_title}}, {{business_name}}"
 },
 {
  "code": "accreditation_cover_letter",
  "title": "Cover letter for vendor accreditation",
  "category": "Letters",
  "summary": "Sends your permits to a client that wants to accredit you as a supplier.",
  "use_when": "When a company, mall or government office asks for your permits before buying from you. Attach the accreditation pack from Share proof.",
  "notarize": false,
  "sort": 80,
  "version": 1,
  "fields": [
   {
    "key": "date",
    "label": "Date",
    "source": "today"
   },
   {
    "key": "client_contact",
    "hint": "e.g. Ms. Ana Reyes, Purchasing",
    "label": "Addressed to",
    "required": true
   },
   {
    "key": "client_company",
    "label": "Company",
    "required": true
   },
   {
    "key": "client_address",
    "label": "Company address"
   },
   {
    "key": "business_name",
    "label": "Your business name",
    "source": "business_name",
    "required": true
   },
   {
    "key": "documents_list",
    "label": "Documents enclosed",
    "source": "permits_list",
    "required": true,
    "multiline": true
   },
   {
    "key": "page_link",
    "label": "Your public permit page",
    "source": "page_link"
   },
   {
    "key": "contact",
    "label": "Your phone or email",
    "source": "me_email"
   },
   {
    "key": "owner_name",
    "label": "Your name",
    "source": "me_name",
    "required": true
   },
   {
    "key": "owner_title",
    "label": "Your position",
    "source": "me_title"
   }
  ],
  "body": "{{date}}\n\n{{client_contact}}\n{{client_company}}\n{{client_address}}\n\nSubject: Accreditation documents of {{business_name}}\n\nDear {{client_contact}}:\n\nThank you for considering {{business_name}} as your supplier. Enclosed are our accreditation documents:\n\n{{documents_list}}\n\nYou can also check the current status of our permits at any time here: {{page_link}}. The page is kept up to date and shows each permit's validity.\n\nPlease let me know if you need anything else. You can reach me at {{contact}}.\n\nSincerely,\n\n\n_____________________________\n{{owner_name}}\n{{owner_title}}, {{business_name}}"
 },
 {
  "code": "owner_consent",
  "title": "Property owner's consent",
  "category": "Sworn and notarized",
  "summary": "The owner of the place lets your business operate there, for the barangay and the city hall.",
  "use_when": "When you don't have a written lease, or the place belongs to a relative or another company. The owner signs in front of a notary.",
  "notarize": true,
  "sort": 90,
  "version": 1,
  "fields": [
   {
    "key": "owner_name",
    "label": "Property owner's full name",
    "required": true
   },
   {
    "key": "owner_address",
    "label": "Owner's address",
    "required": true
   },
   {
    "key": "property_address",
    "label": "Address of the place",
    "source": "business_address",
    "required": true
   },
   {
    "key": "title_no",
    "hint": "e.g. TCT No. 123456 or TD No. 00-0000-0000",
    "label": "Title or tax declaration no."
   },
   {
    "key": "business_owner",
    "label": "Your full name",
    "source": "me_name",
    "required": true
   },
   {
    "key": "business_name",
    "label": "Business name",
    "source": "business_name",
    "required": true
   },
   {
    "key": "business_activity",
    "hint": "e.g. a bakery and coffee shop",
    "label": "What the business does there",
    "required": true
   },
   {
    "key": "term",
    "hint": "e.g. from 1 January 2027 until revoked in writing",
    "label": "For how long",
    "required": true
   },
   {
    "key": "owner_id",
    "label": "Owner's ID for the notary"
   }
  ],
  "body": "CONSENT OF PROPERTY OWNER\n\nI, {{owner_name}}, of legal age, Filipino, with address at {{owner_address}}, state that:\n\n1. I am the registered owner of the property located at {{property_address}}, covered by {{title_no}};\n\n2. I give my consent to {{business_owner}} to use the property for the operation of {{business_name}}, engaged in {{business_activity}}, {{term}};\n\n3. I allow {{business_owner}} to present this consent to the barangay, the city or municipal hall, the Bureau of Fire Protection and any other office for the business's clearances, permits and licenses; and\n\n4. This consent does not transfer ownership or any right over the property other than its use for the business stated above, and I may revoke it in writing.\n\nIN WITNESS WHEREOF, I have signed this on ______________ at ______________, Philippines.\n\n\n_____________________________\n{{owner_name}}\nProperty owner\n\n\nSigned in the presence of:\n\n_____________________________          _____________________________\n\n\nACKNOWLEDGMENT\n\nREPUBLIC OF THE PHILIPPINES )\n______________________________ ) S.S.\n\nBEFORE ME, a Notary Public for and in ______________, this ______________, personally appeared {{owner_name}}, with {{owner_id}} as competent evidence of identity, known to me to be the same person who executed the foregoing instrument, and who acknowledged to me that it is a free and voluntary act and deed.\n\nThis instrument, consisting of ___ page(s) including this page, has been signed on each page by the party and the witnesses.\n\nWITNESS MY HAND AND SEAL on the date and at the place first written above.\n\nDoc. No. _____;\nPage No. _____;\nBook No. _____;\nSeries of _____."
 },
 {
  "code": "closure_letter",
  "title": "Business closure (retirement) letter",
  "category": "Letters",
  "summary": "Tells the city you have stopped operating, so it can retire your business permit.",
  "use_when": "When you close a business or a branch. File it with the BPLO together with the affidavit of closure and your last permit, before the next renewal.",
  "notarize": false,
  "sort": 100,
  "version": 1,
  "fields": [
   {
    "key": "date",
    "label": "Date",
    "source": "today"
   },
   {
    "key": "city",
    "label": "City or municipality",
    "source": "city",
    "required": true
   },
   {
    "key": "owner_name",
    "label": "Your name",
    "source": "me_name",
    "required": true
   },
   {
    "key": "owner_title",
    "hint": "e.g. Owner, President",
    "label": "Your position",
    "source": "me_title"
   },
   {
    "key": "business_name",
    "label": "Business name",
    "source": "business_name",
    "required": true
   },
   {
    "key": "business_address",
    "label": "Business address",
    "source": "business_address",
    "required": true
   },
   {
    "key": "permit_no",
    "label": "Last business permit no.",
    "source": "permit_no"
   },
   {
    "key": "closed_on",
    "hint": "e.g. 31 December 2026",
    "label": "Last day of operation",
    "required": true
   },
   {
    "key": "reason",
    "hint": "e.g. the lease ended and we did not reopen elsewhere",
    "label": "Reason (optional)"
   }
  ],
  "body": "{{date}}\n\nThe Head\nBusiness Permits and Licensing Office\n{{city}}\n\nSubject: Retirement of business, {{business_name}}\n\nDear Sir or Madam:\n\nI am writing to inform your office that {{business_name}}, located at {{business_address}}, with Business Permit No. {{permit_no}}, stopped operating on {{closed_on}}. {{reason}}\n\nI respectfully request that the business be retired from your records as of that date, and that I be advised of any remaining taxes or fees to be settled, together with the requirements for the certificate of retirement.\n\nAttached are the affidavit of closure, the last business permit and its official receipt, and a copy of my valid ID.\n\nThank you.\n\nRespectfully,\n\n\n_____________________________\n{{owner_name}}\n{{owner_title}}, {{business_name}}"
 },
 {
  "code": "closure_affidavit",
  "title": "Affidavit of closure (non-operation)",
  "category": "Sworn and notarized",
  "summary": "Your sworn statement that the business has stopped operating, and its sales up to the last day.",
  "use_when": "With the closure letter, when you retire a business permit with the city. Many offices also ask for it when updating or closing a BIR registration. Sign in front of a notary.",
  "notarize": true,
  "sort": 110,
  "version": 1,
  "fields": [
   {
    "key": "owner_name",
    "label": "Your full name",
    "source": "me_name",
    "required": true
   },
   {
    "key": "owner_address",
    "label": "Your home address",
    "required": true
   },
   {
    "key": "owner_title",
    "label": "Your position",
    "source": "me_title"
   },
   {
    "key": "business_name",
    "label": "Business name",
    "source": "business_name",
    "required": true
   },
   {
    "key": "business_address",
    "label": "Business address",
    "source": "business_address",
    "required": true
   },
   {
    "key": "tin",
    "label": "TIN",
    "source": "tin"
   },
   {
    "key": "closed_on",
    "label": "Last day of operation",
    "required": true
   },
   {
    "key": "period",
    "hint": "e.g. 1 January to 31 December 2026",
    "label": "Sales covered",
    "required": true
   },
   {
    "key": "gross_sales",
    "label": "Gross sales for that period (₱)",
    "required": true
   },
   {
    "key": "owner_id",
    "label": "Your ID for the notary"
   }
  ],
  "body": "REPUBLIC OF THE PHILIPPINES )\n______________________________ ) S.S.\n\nAFFIDAVIT OF CLOSURE OF BUSINESS\n\nI, {{owner_name}}, of legal age, Filipino, with address at {{owner_address}}, after having been sworn in accordance with law, state that:\n\n1. I am the {{owner_title}} of {{business_name}}, with business address at {{business_address}} and TIN {{tin}};\n\n2. {{business_name}} permanently stopped operating at that address on {{closed_on}}, and has not operated there since;\n\n3. The gross sales or receipts of the business from {{period}} amount to PHP {{gross_sales}}, as shown in its books of accounts and tax returns;\n\n4. I am executing this affidavit to support the retirement of the business permit of {{business_name}} and the update of its registrations, and for whatever lawful purpose it may serve; and\n\n5. I understand that a false statement in this affidavit may make me liable under the law.\n\nIN WITNESS WHEREOF, I have signed this on ______________ at ______________, Philippines.\n\n\n_____________________________\n{{owner_name}}\nAffiant\n\n\nSUBSCRIBED AND SWORN to before me on ______________ at ______________, affiant exhibiting {{owner_id}} as competent evidence of identity.\n\nDoc. No. _____;\nPage No. _____;\nBook No. _____;\nSeries of _____."
 },
 {
  "code": "penalty_relief_request",
  "title": "Request to reduce penalties",
  "category": "Letters",
  "summary": "A polite letter asking the city treasurer to reduce or waive surcharges and interest on a late renewal.",
  "use_when": "When you renewed late for a reason outside your control. It is a request only: the treasurer can grant relief only where an ordinance or tax amnesty allows it. Pay what is due on time while you wait.",
  "notarize": false,
  "sort": 120,
  "version": 1,
  "fields": [
   {
    "key": "date",
    "label": "Date",
    "source": "today"
   },
   {
    "key": "city",
    "label": "City or municipality",
    "source": "city",
    "required": true
   },
   {
    "key": "owner_name",
    "label": "Your name",
    "source": "me_name",
    "required": true
   },
   {
    "key": "owner_title",
    "label": "Your position",
    "source": "me_title"
   },
   {
    "key": "business_name",
    "label": "Business name",
    "source": "business_name",
    "required": true
   },
   {
    "key": "business_address",
    "label": "Business address",
    "source": "business_address"
   },
   {
    "key": "permit_no",
    "label": "Business permit or account no.",
    "source": "permit_no"
   },
   {
    "key": "amount",
    "label": "Surcharge and interest assessed (₱)",
    "required": true
   },
   {
    "key": "reason",
    "hint": "e.g. our owner was hospitalized from 5 to 28 January 2027",
    "label": "What happened",
    "required": true
   },
   {
    "key": "proof",
    "hint": "e.g. a medical certificate dated 29 January 2027",
    "label": "Proof you are attaching",
    "required": true
   },
   {
    "key": "ordinance",
    "hint": "Leave blank if you don't know of one",
    "label": "Ordinance or amnesty you are relying on, if any"
   }
  ],
  "body": "{{date}}\n\nThe City or Municipal Treasurer\n{{city}}\n\nSubject: Request for reduction or waiver of surcharges and interest, {{business_name}}\n\nDear Sir or Madam:\n\n{{business_name}}, with business address at {{business_address}} and Business Permit or Account No. {{permit_no}}, was assessed surcharges and interest of PHP {{amount}} for the late renewal of its business permit.\n\nThe renewal was late for a reason outside our control: {{reason}}. Attached is {{proof}}.\n\nWe have always renewed on time and we intend to settle the basic tax and fees in full. We respectfully ask your office to consider reducing or waiving the surcharges and interest, under {{ordinance}} or any ordinance, amnesty or relief that your office may apply.\n\nWe understand that this request does not suspend any payment deadline, and that the decision rests with your office. Thank you for considering it.\n\nRespectfully,\n\n\n_____________________________\n{{owner_name}}\n{{owner_title}}, {{business_name}}"
 },
 {
  "code": "affidavit_of_undertaking",
  "title": "Affidavit of undertaking",
  "category": "Sworn and notarized",
  "summary": "Your sworn promise to complete a missing requirement or fix a deficiency by a set date.",
  "use_when": "When an office (the city hall, the fire station, the barangay) lets you proceed now if you promise in writing to comply by a deadline. Sign in front of a notary.",
  "notarize": true,
  "sort": 130,
  "version": 1,
  "fields": [
   {
    "key": "owner_name",
    "label": "Your full name",
    "source": "me_name",
    "required": true
   },
   {
    "key": "owner_address",
    "label": "Your home address",
    "required": true
   },
   {
    "key": "owner_title",
    "label": "Your position",
    "source": "me_title"
   },
   {
    "key": "business_name",
    "label": "Business name",
    "source": "business_name",
    "required": true
   },
   {
    "key": "business_address",
    "label": "Business address",
    "source": "business_address",
    "required": true
   },
   {
    "key": "office",
    "hint": "e.g. Bureau of Fire Protection, Makati City Fire Station",
    "label": "Office you are promising",
    "required": true
   },
   {
    "key": "application",
    "label": "For which application",
    "source": "permit_name",
    "required": true
   },
   {
    "key": "undertaking",
    "hint": "e.g. install two 10-lb ABC fire extinguishers and an emergency light at the kitchen exit",
    "label": "What you will do",
    "required": true
   },
   {
    "key": "deadline",
    "hint": "e.g. 28 February 2027",
    "label": "By when",
    "required": true
   },
   {
    "key": "owner_id",
    "label": "Your ID for the notary"
   }
  ],
  "body": "REPUBLIC OF THE PHILIPPINES )\n______________________________ ) S.S.\n\nAFFIDAVIT OF UNDERTAKING\n\nI, {{owner_name}}, of legal age, Filipino, with address at {{owner_address}}, after having been sworn in accordance with law, state that:\n\n1. I am the {{owner_title}} of {{business_name}}, with business address at {{business_address}};\n\n2. {{business_name}} has applied with the {{office}} for its {{application}};\n\n3. I undertake to {{undertaking}} on or before {{deadline}}, and to inform the {{office}} once it is done so it may verify;\n\n4. I understand that if this undertaking is not fulfilled by that date, the {{office}} may act on the application in accordance with its rules, including denying, suspending or revoking it; and\n\n5. I am executing this affidavit to support the application above and for no other purpose.\n\nIN WITNESS WHEREOF, I have signed this on ______________ at ______________, Philippines.\n\n\n_____________________________\n{{owner_name}}\nAffiant\n\n\nSUBSCRIBED AND SWORN to before me on ______________ at ______________, affiant exhibiting {{owner_id}} as competent evidence of identity.\n\nDoc. No. _____;\nPage No. _____;\nBook No. _____;\nSeries of _____."
 },
 {
  "code": "fsic_inspection_request",
  "title": "Request for fire safety inspection",
  "category": "Letters",
  "summary": "Asks the fire station to schedule the inspection for your Fire Safety Inspection Certificate.",
  "use_when": "When the fire inspection hasn't been scheduled yet, or after you fixed what the last inspection found. Many stations also take requests online or at the one-stop shop.",
  "notarize": false,
  "sort": 140,
  "version": 1,
  "fields": [
   {
    "key": "date",
    "label": "Date",
    "source": "today"
   },
   {
    "key": "station",
    "hint": "e.g. Makati City Fire Station",
    "label": "Fire station",
    "required": true
   },
   {
    "key": "owner_name",
    "label": "Your name",
    "source": "me_name",
    "required": true
   },
   {
    "key": "owner_title",
    "label": "Your position",
    "source": "me_title"
   },
   {
    "key": "business_name",
    "label": "Business name",
    "source": "business_name",
    "required": true
   },
   {
    "key": "business_address",
    "label": "Business address",
    "source": "business_address",
    "required": true
   },
   {
    "key": "purpose",
    "hint": "e.g. the renewal of our business permit for 2027",
    "label": "For",
    "required": true
   },
   {
    "key": "occupancy",
    "hint": "e.g. a restaurant with a kitchen, ground floor, about 80 sq m",
    "label": "What the place is used for",
    "required": true
   },
   {
    "key": "contact",
    "hint": "e.g. Ana Cruz, 0917 000 0000",
    "label": "Contact person and mobile",
    "required": true
   },
   {
    "key": "times",
    "hint": "e.g. weekdays, 9 am to 4 pm",
    "label": "Best days and times"
   }
  ],
  "body": "{{date}}\n\nThe City or Municipal Fire Marshal\n{{station}}\nBureau of Fire Protection\n\nSubject: Request for fire safety inspection, {{business_name}}\n\nDear Sir or Madam:\n\nWe respectfully request a fire safety inspection of {{business_name}}, located at {{business_address}}, for {{purpose}}.\n\nThe place is used as {{occupancy}}. Our contact person is {{contact}}, and the place is open for inspection {{times}}.\n\nWe will have our fire safety equipment, the last Fire Safety Inspection Certificate and the official receipt of the fire code fees ready for your inspector.\n\nThank you.\n\nRespectfully,\n\n\n_____________________________\n{{owner_name}}\n{{owner_title}}, {{business_name}}"
 },
 {
  "code": "vehicle_deed_of_sale",
  "title": "Deed of Absolute Sale (motor vehicle)",
  "category": "Sworn and notarized",
  "summary": "The sale of a car, motorcycle or truck, for the LTO transfer of ownership and the HPG clearance.",
  "use_when": "When you sell or buy a vehicle. Both of you and two witnesses sign, then it is notarized. LTO and the PNP-HPG ask for it to transfer the registration.",
  "notarize": true,
  "sort": 150,
  "version": 1,
  "fields": [
   {
    "key": "seller_name",
    "label": "Seller's full name",
    "required": true
   },
   {
    "key": "seller_address",
    "label": "Seller's address",
    "required": true
   },
   {
    "key": "buyer_name",
    "label": "Buyer's full name",
    "required": true
   },
   {
    "key": "buyer_address",
    "label": "Buyer's address",
    "required": true
   },
   {
    "key": "make",
    "hint": "e.g. Toyota Vios 1.3 E, 2021",
    "label": "Make, model and year",
    "required": true
   },
   {
    "key": "plate",
    "label": "Plate no.",
    "required": true
   },
   {
    "key": "color",
    "label": "Color"
   },
   {
    "key": "engine_no",
    "label": "Engine no.",
    "required": true
   },
   {
    "key": "chassis_no",
    "label": "Chassis no.",
    "required": true
   },
   {
    "key": "mv_file",
    "label": "MV file no."
   },
   {
    "key": "cr_no",
    "label": "Certificate of Registration (CR) no.",
    "required": true
   },
   {
    "key": "price_words",
    "hint": "e.g. Four Hundred Fifty Thousand Pesos",
    "label": "Price in words",
    "required": true
   },
   {
    "key": "price",
    "label": "Price in figures (₱)",
    "required": true
   },
   {
    "key": "seller_id",
    "label": "Seller's ID for the notary"
   },
   {
    "key": "buyer_id",
    "label": "Buyer's ID for the notary"
   }
  ],
  "body": "DEED OF ABSOLUTE SALE OF MOTOR VEHICLE\n\nKNOW ALL PERSONS BY THESE PRESENTS:\n\nI, {{seller_name}}, of legal age, Filipino, with address at {{seller_address}} (the SELLER), for and in consideration of the sum of {{price_words}} (PHP {{price}}), Philippine currency, received in full from {{buyer_name}}, of legal age, Filipino, with address at {{buyer_address}} (the BUYER), hereby SELL, TRANSFER and CONVEY absolutely to the BUYER, his or her heirs and assigns, the following motor vehicle:\n\nMake, model and year: {{make}}\nPlate No.: {{plate}}\nColor: {{color}}\nEngine No.: {{engine_no}}\nChassis No.: {{chassis_no}}\nMV File No.: {{mv_file}}\nCertificate of Registration No.: {{cr_no}}\n\nThe SELLER warrants that he or she is the lawful owner of the vehicle; that it is free from any lien, mortgage or encumbrance; that it is not the subject of any pending case or claim; and that he or she will defend the BUYER's title against any lawful claim.\n\nThe SELLER delivers to the BUYER the vehicle, its original Certificate of Registration, its latest Official Receipt of registration and its keys, and will sign any other paper needed to transfer the registration to the BUYER. From the signing of this deed, the BUYER is responsible for the vehicle, its use and its registration, and will have it transferred to his or her name with the Land Transportation Office.\n\nIN WITNESS WHEREOF, the parties have signed this on ______________ at ______________, Philippines.\n\n\n_____________________________          _____________________________\n{{seller_name}}                          {{buyer_name}}\nSELLER                                   BUYER\n\n\nSigned in the presence of:\n\n_____________________________          _____________________________\n\n\nACKNOWLEDGMENT\n\nREPUBLIC OF THE PHILIPPINES )\n______________________________ ) S.S.\n\nBEFORE ME, a Notary Public for and in ______________, this ______________, personally appeared:\n\n{{seller_name}}, with {{seller_id}} as competent evidence of identity; and\n{{buyer_name}}, with {{buyer_id}} as competent evidence of identity,\n\nknown to me to be the same persons who executed the foregoing Deed of Absolute Sale, and who acknowledged to me that it is their free and voluntary act and deed.\n\nThis instrument, consisting of ___ page(s) including this page, has been signed on each page by the parties and their witnesses.\n\nWITNESS MY HAND AND SEAL on the date and at the place first written above.\n\nDoc. No. _____;\nPage No. _____;\nBook No. _____;\nSeries of _____."
 },
 {
  "code": "change_notice",
  "title": "Notice of change to the city",
  "category": "Letters",
  "summary": "Asks the city to update your business permit after a change of name, address, owner or line of business.",
  "use_when": "Within the period your city sets after the change, so the permit matches your business. Attach the papers that prove the change (for example the new DTI or SEC certificate, or the new lease).",
  "notarize": false,
  "sort": 160,
  "version": 1,
  "fields": [
   {
    "key": "date",
    "label": "Date",
    "source": "today"
   },
   {
    "key": "city",
    "label": "City or municipality",
    "source": "city",
    "required": true
   },
   {
    "key": "owner_name",
    "label": "Your name",
    "source": "me_name",
    "required": true
   },
   {
    "key": "owner_title",
    "label": "Your position",
    "source": "me_title"
   },
   {
    "key": "business_name",
    "label": "Business name (as on the permit)",
    "source": "business_name",
    "required": true
   },
   {
    "key": "permit_no",
    "label": "Business permit no.",
    "source": "permit_no"
   },
   {
    "key": "change_kind",
    "hint": "e.g. business address, business name, owner, line of business",
    "label": "What changed",
    "required": true
   },
   {
    "key": "from_value",
    "label": "From",
    "required": true
   },
   {
    "key": "to_value",
    "label": "To",
    "required": true
   },
   {
    "key": "effective",
    "hint": "e.g. 1 March 2027",
    "label": "Effective",
    "required": true
   },
   {
    "key": "attachments",
    "hint": "e.g. the new DTI certificate and the new lease contract",
    "label": "Papers attached",
    "required": true
   }
  ],
  "body": "{{date}}\n\nThe Head\nBusiness Permits and Licensing Office\n{{city}}\n\nSubject: Request to update the business permit of {{business_name}}\n\nDear Sir or Madam:\n\nWe respectfully inform your office of a change in the {{change_kind}} of {{business_name}}, Business Permit No. {{permit_no}}, effective {{effective}}:\n\nFrom: {{from_value}}\nTo: {{to_value}}\n\nWe request that your records and our business permit be updated accordingly, and that we be advised of any fees or other requirements for the amendment. Attached are {{attachments}}.\n\nThank you.\n\nRespectfully,\n\n\n_____________________________\n{{owner_name}}\n{{owner_title}}, {{business_name}}"
 },
 {
  "code": "capital_declaration",
  "title": "Sworn statement of capital",
  "category": "Sworn and notarized",
  "summary": "Declares the capital you put into a new business, which most cities use to compute its first business tax.",
  "use_when": "When you apply for your first business permit: new businesses have no sales yet, so the city taxes the capital instead. Sign in front of a notary.",
  "notarize": true,
  "sort": 170,
  "version": 1,
  "fields": [
   {
    "key": "owner_name",
    "label": "Your full name",
    "source": "me_name",
    "required": true
   },
   {
    "key": "owner_address",
    "label": "Your home address",
    "required": true
   },
   {
    "key": "owner_title",
    "label": "Your position",
    "source": "me_title"
   },
   {
    "key": "business_name",
    "label": "Business name",
    "source": "business_name",
    "required": true
   },
   {
    "key": "business_address",
    "label": "Business address",
    "source": "business_address",
    "required": true
   },
   {
    "key": "business_activity",
    "hint": "e.g. retail of baked goods",
    "label": "Line of business",
    "required": true
   },
   {
    "key": "capital_words",
    "hint": "e.g. Two Hundred Thousand Pesos",
    "label": "Capital in words",
    "required": true
   },
   {
    "key": "capital",
    "label": "Capital in figures (₱)",
    "required": true
   },
   {
    "key": "started_on",
    "hint": "e.g. 15 February 2027",
    "label": "Start of operations",
    "required": true
   },
   {
    "key": "owner_id",
    "label": "Your ID for the notary"
   }
  ],
  "body": "REPUBLIC OF THE PHILIPPINES )\n______________________________ ) S.S.\n\nSWORN STATEMENT OF CAPITAL INVESTMENT\n\nI, {{owner_name}}, of legal age, Filipino, with address at {{owner_address}}, after having been sworn in accordance with law, state that:\n\n1. I am the {{owner_title}} of {{business_name}}, a new business engaged in {{business_activity}}, with business address at {{business_address}};\n\n2. The business started, or will start, operating on {{started_on}};\n\n3. The capital invested in the business is {{capital_words}} (PHP {{capital}}), consisting of the cash, equipment, inventory and other assets put into the business;\n\n4. I am executing this statement to support the application for the first business permit of {{business_name}} and the computation of its business tax; and\n\n5. I understand that a false statement in this affidavit may make me liable under the law.\n\nIN WITNESS WHEREOF, I have signed this on ______________ at ______________, Philippines.\n\n\n_____________________________\n{{owner_name}}\nAffiant\n\n\nSUBSCRIBED AND SWORN to before me on ______________ at ______________, affiant exhibiting {{owner_id}} as competent evidence of identity.\n\nDoc. No. _____;\nPage No. _____;\nBook No. _____;\nSeries of _____."
 }
];
