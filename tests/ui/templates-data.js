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
 }
];
