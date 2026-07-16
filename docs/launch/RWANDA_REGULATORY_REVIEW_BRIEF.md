# MED+250 Rwanda regulatory review brief

Prepared: 16 July 2026

Decision owner: MED+250 legal and compliance

Release: `med250-production`

Implemented backend contract: `2026-07-16.10`

## Purpose and status

This brief gives the accountable legal and compliance owner the exact operating model, current technical controls, official-source findings, unresolved decisions, and approval conditions needed for `MED250_GATE_REGULATORY_APPROVED`.

It is a review packet, not legal advice and not an approval. The public catalogue and availability-request workflow are reachable at `https://med250.gikundiro.com`, but the protected production evidence gate remains pending. No person may treat this brief, a passing technical test, or a public deployment as Rwanda FDA, RICA, privacy, health-sector, or legal approval.

## Exact marketplace model under review

MED+250 currently implements the following model:

1. MED+250 is an information-first online intermediary connecting customers with pharmacies.
2. Only pharmacies are sellers and fulfilment parties. The platform does not support independent marketplace sellers.
3. One central catalogue contains medicines and consumer health products. The live aggregate currently reports 4,659 active and requestable products: 2,459 medicines and 2,200 consumer products.
4. Products and any public `From RWF` values are centrally maintained. Public pharmacy-specific stock and pharmacy-specific catalogue price lists are not supported.
5. A customer may send a private availability request. This is not a completed sale or a final order.
6. Verified nearby pharmacies are prioritised where approved premises coordinates exist. A stable national responder fallback may include an otherwise eligible pharmacy without approved coordinates; it must not be described as nearby.
7. No more than 20 eligible pharmacies receive an availability request.
8. A responding pharmacy confirms availability item by item. A private pharmacy estimate is optional, indicative, and non-final.
9. The customer chooses one responding pharmacy and continues directly with that pharmacy on WhatsApp to reconfirm the product, final price, prescription requirements, and pickup or delivery.
10. MED+250 currently takes no payment and holds no payment funds. Any later order is optional and occurs after the direct pharmacy interaction.
11. A prescription-classified product requires a private prescription attachment before the request is sent. Recipient pharmacies see only that a prescription exists; only the customer and selected pharmacy may access the file under the implemented time limits.
12. A pharmacy may propose a substitute only when the customer allowed substitutes and the pharmacy applies the applicable professional and dispensing rules.
13. MED+250 does not diagnose, prescribe, recommend treatment, or replace a pharmacist, clinician, or other qualified health professional.

## Current regulated scope

The review must cover the full public catalogue, not medicines alone. Rwanda FDA's promotion regulations define regulated products broadly enough to include pharmaceutical products, food supplements, fortified foods, medicated cosmetics, medical devices, poisonous substances, herbal medicines, tobacco products, and other listed classes.

The consumer catalogue was researched using Amazon.com primarily as a taxonomy and product-reference source. Amazon availability does not establish Rwanda registration, import authorisation, advertising clearance, product safety, image rights, or lawful sale in Rwanda. Amazon prices are excluded from the MED+250 catalogue.

## Official-source findings requiring owner action

### 1. RICA online-intermediary and e-commerce requirements

Law No. 011/2026 of 26 February 2026 relating to competition and consumer protection was published in the Official Gazette on 4 March 2026 and came into force on publication.

The law defines and regulates e-commerce and online intermediaries. The implemented MED+250 model appears to fall within those provisions because it uses an online interface to facilitate, at least in part, a customer-pharmacy transaction. This is a legal classification for the owner and RICA to confirm, not a conclusion that engineering can approve.

Material provisions for review include:

- Article 43 requires an online intermediary to publish specified identifying and contact information, rules of procedure, information about contracted e-commerce operators, personal-data protection procedures, and other prescribed information.
- Article 44 requires an enterprise wishing to engage in e-commerce or provide online-intermediary services to apply in writing to the Regulatory Authority for the corresponding licence.
- Article 45 requires an online intermediary to ensure content on its platform complies with relevant law.
- Article 46 requires prompt removal of information that may give rise to liability after actual knowledge.
- Article 73 gives an existing e-commerce operator no more than six months from publication to bring its operations and activities into conformity.

Based on the 4 March 2026 publication date, the six-month outside date is 4 September 2026. The legal owner must confirm the calculation and obtain written RICA guidance or the applicable licence before that deadline. The release gate cannot be approved merely because the transitional period has not yet ended.

Required legal decisions:

- Confirm whether MED+250 is an `online intermediary`, `e-commerce enterprise`, or both.
- Identify the Regulatory Authority and current application procedure under Article 44.
- Submit or obtain the required licence, or retain written authoritative confirmation that a licence is not required for this exact model.
- Approve the public enterprise identity, Rwanda physical address, contact, complaints, after-sales, seller-disclosure, rules-of-procedure, advertising-identification, consumer-rights, and content-removal disclosures required for this model.
- Define the complaint and unlawful-content removal workflow, named owners, response time, preservation rules, and regulatory escalation path.

### 2. Rwanda FDA promotion, advertising, and marketing controls

Rwanda FDA Regulation No. `CBD/TRG/017 Rev_1` applies to advertising, promotion, and marketing of regulated products manufactured, imported, distributed, stored, sold, or used in Rwanda.

Its definition of advertising expressly includes catalogues, internet and electronic media when aimed or designed to promote supply, sale, or use. Calling the MED+250 pages a neutral catalogue does not by itself remove them from the regulation.

Material provisions for review include:

- Article 5 prohibits advertising, promotion, or marketing of an unregistered regulated product.
- Article 5 also prohibits advertising or promotion without Rwanda FDA clearance and approval.
- Articles 6 to 9 require accurate, balanced, approved-product-consistent information and prohibit misleading, unverifiable, comparative, fear-inducing, or inappropriate claims.
- Article 7 states that medicines must not be promoted beyond determined circumstances.
- Articles 10 to 12 require submission of the final advertisement, written approval with a unique reference, and time-limited approval.
- Article 17 requires regulated products to be marketed by authorised personnel and at authorised establishments, and applies prescription and professional-dispensing conditions.

Required legal and regulatory decisions:

- Obtain a written Rwanda FDA determination on whether the current product list, product pages, search, category pages, indicative prices, availability-request controls, images, metadata, sitemap, and messages constitute promotion or advertising.
- If approval is required, obtain clearance for the exact final public formats before the regulatory gate is signed.
- Confirm which medicine classes may be displayed to the general public, and under what restrictions.
- Confirm that every publicly requestable medicine is currently registered and legally marketable in Rwanda.
- Establish an authoritative review for every consumer product that falls within Rwanda FDA's regulated-product scope. Amazon research is not sufficient evidence.
- Keep unregistered, expired, withdrawn, recalled, prohibited, or otherwise non-marketable products non-requestable and remove them when required.
- Confirm that only properly licensed pharmacy premises and authorised pharmacy personnel market, dispense, sell, transport, or deliver regulated products.
- Approve the exact disclaimer and product-information fields; avoid treatment claims, superiority claims, fabricated benefits, or wording that discourages professional advice.
- Retain the Rwanda FDA approval reference, approved final creative or page format, validity period, and change-control rule. A materially changed approved display may require new written permission.

### 3. Pharmacy licensing, dispensing, and prescription controls

Rwanda FDA's current licensing regulations require medical-product retailers and hospital pharmacies to use systems, facilities, and operations that comply with Good Dispensing Practice, retain supply-chain and dispensing documentation, operate under valid premises licences, and use authorised persons.

The December 2024 Rwanda FDA stakeholder notice also prohibits dispensing specified medicines without a medical prescription. Other product-specific, controlled-drug, recall, safety, restricted-prescriber, and restricted-dispensing conditions may apply.

Required legal and pharmacy-governance decisions:

- Confirm the production pharmacy population against current Rwanda FDA licence records.
- Define what happens immediately when a premises licence expires, is suspended, is withdrawn, or no longer matches the operating premises.
- Confirm the prescription classification and requestability of each medicine through an authorised review. Unclassified medicines must not be treated as over-the-counter by default.
- Confirm whether any remote sale, delivery, online-pharmacy, controlled-drug, narcotic, cold-chain, or restricted-product rules require additional authorisation or exclusion.
- Confirm that the private availability workflow and WhatsApp handoff preserve the pharmacist's legal responsibility for final dispensing.
- Define recall, safety-alert, withdrawal, falsified-product, and prohibited-product removal procedures.

### 4. Personal data, health data, location, and international processing

Law No. 058/2021 of 13 October 2021 applies to electronic processing of personal data of people in Rwanda. It treats location data as personal data and health status and medical records as sensitive personal data.

The implemented workflow processes a customer WhatsApp number, approximate or exact location, requested products, fulfilment preference, pharmacy interactions, and potentially a prescription. Even anonymous Supabase authentication does not make the request or health information anonymous.

Material duties for review include:

- Registration as a data controller or processor with the Data Protection and Privacy Office.
- A valid legal basis and enhanced safeguards for sensitive personal data.
- Written controller-processor contracts.
- Processing records, access and disclosure logs, data minimisation, accuracy, retention limits, data-subject rights, and privacy notices.
- A data protection officer where the statutory conditions apply.
- A data protection impact assessment where processing is likely to create high risk, including large-scale sensitive-data processing.
- Forty-eight-hour supervisory notification of a personal-data breach and the required follow-up report.
- Authorisation and safeguards for storage or transfer outside Rwanda.

Required privacy and legal decisions:

- Record MED+250's controller role and the controller/processor roles of Supabase, Cloudflare, WhatsApp/Meta, Google Maps, and any other service.
- Obtain and retain the required controller/processor registration certificate.
- Complete and approve a DPIA for the location, prescription, pharmacy-dispatch, authentication, messaging, monitoring, retention, and cross-border processing.
- Record the lawful basis for each processing purpose, including sensitive prescription and medicine-request data.
- Identify every storage and transfer country and obtain any required outside-Rwanda authorisation.
- Approve processor contracts and security safeguards.
- Confirm the 24-hour orphan rule, 24-hour selected-pharmacy access, 30-day completed-request deletion rule, and six-hour cleanup schedule.
- Publish complete controller identity, DPO or privacy contact, purposes, recipients, retention, rights, complaint route, transfer notice, and breach procedure.
- Establish a lawful and usable process for access, correction, restriction, erasure, objection, consent withdrawal where applicable, and complaints.

### 5. Consumer information, central indicative prices, and off-platform completion

The public wording must make the parties and transaction state unmistakable:

- MED+250 is the intermediary and catalogue operator.
- The pharmacy is the seller and dispensing party.
- `From RWF` is central, indicative information and is not a final pharmacy quote.
- MED+250 does not publish pharmacy-specific stock or pharmacy-specific catalogue prices.
- A pharmacy response is an availability confirmation, not a completed purchase.
- A private response estimate is optional and non-final.
- The customer and pharmacy reconfirm the exact product, prescription, final price, and fulfilment directly.
- MED+250 currently does not collect payment or hold funds.

The legal owner must determine whether the implemented flow nevertheless constitutes a distance contract, e-commerce transaction, invitation to treat, advertising, or another regulated commercial communication. The decision must also cover consumer complaints, cancellation, correction, unsafe goods, refunds where applicable, delivery responsibility, after-sales contact, and evidence retention.

### 6. Source reuse, intellectual property, and product images

Regulatory approval does not replace data-reuse or intellectual-property approval. The separate data-reuse gate currently remains pending.

Required decisions:

- Obtain written permission or a documented lawful basis for republishing Rwanda FDA register data and every other active source.
- Approve the limited Amazon use as category/taxonomy and product-reference research only.
- Do not use Amazon prices.
- Do not publish copied Amazon text, product claims, ratings, reviews, or images without a verified right.
- Publish only product images with recorded rights verification and current product linkage.
- Maintain a takedown and correction route for rights holders, regulators, pharmacies, and consumers.

## Minimum conditions before regulatory approval

The accountable owner must not sign the regulatory gate until all of the following are passed or are covered by explicit, lawful written conditions:

1. RICA classification is documented and the required licence or written exemption/determination is retained.
2. The Article 73 compliance plan is completed before the confirmed legal deadline.
3. Rwanda FDA has provided the required written determination or clearance for the exact public catalogue and promotional formats.
4. Every public regulated product has evidence of Rwanda registration or lawful market status and approved presentation.
5. Only currently licensed pharmacies and authorised personnel participate in sale and dispensing.
6. Prescription, controlled-product, delivery, recall, safety-alert, and withdrawal procedures are approved.
7. The DPO registration, controller/processor roles, DPIA, legal bases, contracts, transfers, retention, data-subject rights, and breach procedures are approved.
8. Public enterprise, intermediary, seller, complaints, after-sales, privacy, advertising, price, and transaction-state disclosures are complete.
9. Data-reuse and image-rights conditions are reconciled with the separate source-data approval gate.
10. Named legal, privacy, regulatory, operations, security, and complaints owners are recorded in the controlled staff register.

## Owner decision record

The final decision must be one of:

- `approved`: every condition above is satisfied and evidenced;
- `approved_with_conditions`: only if counsel confirms the conditions permit the exact currently public operation, each condition has a named owner and deadline, and the evidence gate's acceptance criterion remains fully satisfied; or
- `rejected`: the model must be changed or public operation restricted.

The signed launch artifact itself uses `decision: approved` only after every recorded check is passed. If the legal conclusion is conditional in a way that means the production gate is not yet fully satisfied, keep the artifact and registry status `pending`.

The signed decision must identify:

- approver name and accountable role;
- timezone-qualified approval timestamp;
- legal entity and registration details reviewed;
- RICA licence or determination reference;
- Rwanda FDA determination or advertisement-clearance references and validity;
- DPO registration and applicable transfer-authorisation references;
- approved pharmacy and product scope;
- conditions, exclusions, expiry dates, and change-control triggers;
- required public-copy changes;
- incident, complaint, takedown, recall, and regulator-contact owners.

## Official sources reviewed

Captured 16 July 2026:

1. RICA, Law No. 011/2026 of 26 February 2026 relating to competition and consumer protection, Official Gazette special of 4 March 2026:

   `https://www.rica.gov.rw/fileadmin/user_upload/RICA/Publications/Laws/OG_n___Special_of_04.03.2026__Ihiganwa_mu_bucuruzi_no_kurengera_umuguzi__1___1___1_.pdf`
2. Rwanda FDA, Regulations Governing Promotion, Advertisement and Marketing of Regulated Products, `CBD/TRG/017 Rev_1`:

   `https://rwandafda.gov.rw/wp-content/uploads/2022/11/REGULA1-1.pdf`
3. Rwanda FDA, Regulations Governing the Licensing of Public and Private Manufacturers, Distributors, Wholesalers and Retailers of Medical Products, `DD/PIL/TRG/001 Rev_5`:

   `https://rwandafda.gov.rw/wp-content/uploads/2024/05/Regulations%20Governing%20Licensing%20of%20public%20and%20private%20manufacturers%2C%20of%20medical%20products_23.04.2024.pdf`
4. Rwanda FDA, stakeholder notice on dispensing specified medicines only with a medical prescription:

   `https://rwandafda.gov.rw/monitoring-tool/documents-management/uploads/30/Stakeholder-Notice/1767709458_Prohibition-of-dispensing-specified-medicines-without-medical-prescription.pdf`
5. Rwanda Data Protection and Privacy Office, Law No. 058/2021 official law pages:

   `https://dpo.gov.rw/dpp-law/general-provisions`

   `https://dpo.gov.rw/dpp-law/processing-and-quality-of-personal-data`

   `https://dpo.gov.rw/dpp-law/registration-of-a-data-controller-and-a-data-processor`

   `https://dpo.gov.rw/dpp-law/obligations-of-the-data-controller-and-the-data-processor`

The legal owner must check for amendments, replacement regulations, current application forms, regulator guidance, product-specific controls, and authoritative interpretations before signing.
