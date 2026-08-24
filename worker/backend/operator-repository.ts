import {
  allRows,
  atomicBatch,
  d1Boolean,
  firstRow,
  newId,
  nowIso,
  type D1Row,
} from "../../db/index.ts";

export type OperatorRow = D1Row;

function required(row: D1Row | null, key: string): string {
  const value = row?.[key];
  if (typeof value !== "string" || !value) throw new Error(`Operator database field ${key} is invalid.`);
  return value;
}

function nullable(row: D1Row, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`Operator database field ${key} is invalid.`);
  return value;
}

function changes(result: D1Result<unknown>): number {
  return typeof result.meta?.changes === "number" ? result.meta.changes : 0;
}

function productPublicationState(row: D1Row): Record<string, unknown> {
  return {
    publication_status: row.publication_status,
    compliance_status: row.compliance_status,
    is_active: d1Boolean(row.is_active, "is_active"),
    is_orderable: d1Boolean(row.is_orderable, "is_orderable"),
    compliance_evidence_url: row.compliance_evidence_url,
    updated_at: row.updated_at,
  };
}

function descriptionState(row: D1Row): Record<string, unknown> {
  return {
    id: row.id,
    description: row.description,
    source_name: row.description_source_name,
    source_url: row.description_source_url,
    source_sha256: row.description_source_sha256,
    rights_basis: row.description_rights_basis,
    rights_reference: row.description_rights_reference,
    rights_verified: d1Boolean(row.description_rights_verified, "description_rights_verified"),
    clinical_review_status: row.description_clinical_review_status,
    review_note: row.description_review_note,
    reviewed_by: row.description_reviewed_by,
    reviewed_role: row.description_reviewed_role,
    reviewed_at: row.description_reviewed_at,
    approved: d1Boolean(row.description_approved, "description_approved"),
    updated_at: row.updated_at,
  };
}

export class OperatorRepository {
  constructor(private readonly database: D1Database) {}

  async geocodeCandidates(pharmacyId: string | null, limit: number): Promise<OperatorRow[]> {
    return allRows<OperatorRow>(this.database, `
      SELECT id, name, fda_source_serial, registry_entry_key, sector_cell_raw, district, province,
        geocode_status, geocode_provider, geocode_reference AS google_place_id,
        geocode_formatted_address AS google_formatted_address, google_maps_url,
        geocode_confidence AS confidence, geocode_checked_at AS checked_at, updated_at AS candidate_version
      FROM med250_pharmacies
      WHERE (? IS NOT NULL AND id = ?) OR (? IS NULL AND geocode_status IN ('pending', 'candidate', 'rejected'))
      ORDER BY CASE WHEN fda_source_serial IS NULL THEN 1 ELSE 0 END, fda_source_serial, id LIMIT ?
    `, [pharmacyId, pharmacyId, pharmacyId, limit]);
  }

  async stageGeocode(input: {
    pharmacyId: string; expectedUpdatedAt: string; placeId: string; formattedAddress: string;
    mapsUrl: string; latitude: number; longitude: number; confidence: number;
  }): Promise<unknown> {
    const at = nowIso();
    const result = await this.database.prepare(`
      UPDATE med250_pharmacies SET latitude = ?, longitude = ?, google_maps_url = ?, geocode_status = 'candidate',
        geocode_provider = 'google_places', geocode_reference = ?, geocode_formatted_address = ?, geocode_confidence = ?,
        geocode_checked_at = ?, geocode_reviewed_by = NULL, geocode_reviewed_at = NULL,
        geocode_review_note = NULL, updated_at = ?
      WHERE id = ? AND updated_at = ? AND geocode_status <> 'verified'
    `).bind(input.latitude, input.longitude, input.mapsUrl.trim(), input.placeId.trim(), input.formattedAddress.trim(),
      input.confidence, at, at, input.pharmacyId, input.expectedUpdatedAt).run();
    if (changes(result) !== 1) throw new Error("pharmacy changed after geocode inspection");
    const row = await firstRow<D1Row>(this.database, `
      SELECT id AS pharmacy_id, geocode_status AS status, geocode_reference AS google_place_id,
        geocode_confidence AS confidence, updated_at AS candidate_version FROM med250_pharmacies WHERE id = ?
    `, [input.pharmacyId]);
    return row;
  }

  async rejectGeocode(pharmacyId: string, expectedUpdatedAt: string): Promise<boolean> {
    const at = nowIso();
    const result = await this.database.prepare(`
      UPDATE med250_pharmacies SET latitude = NULL, longitude = NULL, google_maps_url = NULL,
        geocode_status = 'rejected', geocode_provider = NULL, geocode_reference = NULL,
        geocode_formatted_address = NULL, geocode_confidence = NULL, geocode_checked_at = ?,
        geocode_reviewed_by = NULL, geocode_reviewed_at = NULL, geocode_review_note = NULL, updated_at = ?
      WHERE id = ? AND updated_at = ? AND geocode_status <> 'verified'
    `).bind(at, at, pharmacyId, expectedUpdatedAt).run();
    return changes(result) === 1;
  }

  async approveGeocode(input: {
    pharmacyId: string; placeId: string; expectedUpdatedAt: string; reviewedBy: string; reviewNote: string;
  }): Promise<unknown> {
    const current = await firstRow<D1Row>(this.database, `
      SELECT geocode_status, geocode_provider, geocode_reference, geocode_confidence
      FROM med250_pharmacies WHERE id = ? AND updated_at = ?
    `, [input.pharmacyId, input.expectedUpdatedAt]);
    if (!current) throw new Error("pharmacy changed after geocode inspection");
    if (required(current, "geocode_status") !== "candidate" || required(current, "geocode_provider") !== "google_places"
      || required(current, "geocode_reference") !== input.placeId || Number(current.geocode_confidence) < 0.8) {
      throw new Error("requested geocode is not the current eligible candidate");
    }
    const at = nowIso();
    const today = at.slice(0, 10);
    const results = await atomicBatch(this.database, [
      this.database.prepare(`
        UPDATE med250_pharmacies SET geocode_status = 'verified', geocode_reviewed_by = ?,
          geocode_reviewed_at = ?, geocode_review_note = ?,
          dispatch_enabled = CASE WHEN marketplace_approved = 1 AND licence_status = 'current'
            AND licence_expires_on >= ? AND EXISTS (
              SELECT 1 FROM med250_pharmacy_contacts contact WHERE contact.pharmacy_id = med250_pharmacies.id
                AND contact.channel = 'whatsapp' AND contact.active = 1 AND contact.dispatch_enabled = 1
                AND contact.verified_at IS NOT NULL
            ) THEN 1 ELSE 0 END, updated_at = ?
        WHERE id = ? AND updated_at = ?
      `).bind(input.reviewedBy.trim(), at, input.reviewNote.trim(), today, at, input.pharmacyId, input.expectedUpdatedAt),
      this.database.prepare(`INSERT INTO med250_audit_events (event_type, details, created_at)
        VALUES ('pharmacy_geocode_verified', json_object('pharmacy_id', ?, 'provider', 'google_places'), ?)`)
        .bind(input.pharmacyId, at),
    ]);
    if (changes(results[0]) !== 1) throw new Error("pharmacy changed after geocode inspection");
    return firstRow<D1Row>(this.database, `
      SELECT id AS pharmacy_id, geocode_status AS status, geocode_reference AS google_place_id,
        geocode_reviewed_at AS reviewed_at, updated_at FROM med250_pharmacies WHERE id = ?
    `, [input.pharmacyId]);
  }

  async contactRequests(requestId: string | null, limit: number): Promise<OperatorRow[]> {
    return allRows<OperatorRow>(this.database, `
      SELECT request.id, request.pharmacy_id, request.contact_id, request.requested_action,
        request.requested_contact_type, request.requested_e164, request.note, request.status,
        request.reviewed_at, request.reviewed_by_label, request.review_note, request.created_at, request.updated_at,
        pharmacy.name AS pharmacy_name, pharmacy.fda_source_serial, pharmacy.district, pharmacy.province,
        contact.channel AS existing_contact_type, contact.e164 AS existing_e164,
        contact.is_primary AS existing_is_primary, contact.login_enabled AS existing_login_enabled,
        contact.dispatch_enabled AS existing_dispatch_enabled, contact.active AS existing_active
      FROM med250_pharmacy_contact_change_requests request
      JOIN med250_pharmacies pharmacy ON pharmacy.id = request.pharmacy_id
      LEFT JOIN med250_pharmacy_contacts contact ON contact.id = request.contact_id
      WHERE (? IS NOT NULL AND request.id = ?) OR (? IS NULL AND request.status = 'pending')
      ORDER BY request.created_at, request.id LIMIT ?
    `, [requestId, requestId, requestId, limit]);
  }

  async reviewContact(input: {
    requestId: string; decision: "approve" | "reject"; reviewedBy: string; reviewNote: string;
  }): Promise<unknown> {
    const request = await firstRow<D1Row>(this.database, `
      SELECT * FROM med250_pharmacy_contact_change_requests WHERE id = ?
    `, [input.requestId]);
    if (!request) throw new Error("contact change request not found");
    if (required(request, "status") !== "pending") throw new Error("contact change request already reviewed");
    const at = nowIso();
    const pharmacyId = required(request, "pharmacy_id");
    if (input.decision === "reject") {
      await atomicBatch(this.database, [
        this.database.prepare(`UPDATE med250_pharmacy_contact_change_requests SET status = 'rejected', reviewed_at = ?,
          reviewed_by_label = ?, review_note = ?, updated_at = ? WHERE id = ? AND status = 'pending'`)
          .bind(at, input.reviewedBy.trim(), input.reviewNote.trim(), at, input.requestId),
        this.database.prepare(`INSERT INTO med250_audit_events (event_type, details, created_at)
          VALUES ('pharmacy_contact_change_rejected', json_object('request_id', ?, 'pharmacy_id', ?), ?)`)
          .bind(input.requestId, pharmacyId, at),
      ]);
      return { request_id: input.requestId, status: "rejected" };
    }

    const action = required(request, "requested_action");
    const contactType = required(request, "requested_contact_type");
    const requestedE164 = nullable(request, "requested_e164");
    const contactId = nullable(request, "contact_id");
    const existing = contactId ? await firstRow<D1Row>(this.database, `
      SELECT * FROM med250_pharmacy_contacts WHERE id = ? AND pharmacy_id = ?
    `, [contactId, pharmacyId]) : null;
    if (contactId && !existing) throw new Error("requested contact no longer belongs to pharmacy");
    if (contactType === "whatsapp" && requestedE164) {
      const conflict = await firstRow<D1Row>(this.database, `
        SELECT resolution_status, pharmacy_id FROM med250_known_pharmacy_numbers WHERE e164 = ?
      `, [requestedE164]);
      if (conflict && (required(conflict, "resolution_status") === "ambiguous"
        || (required(conflict, "resolution_status") === "resolved" && nullable(conflict, "pharmacy_id") !== pharmacyId))) {
        throw new Error("whatsapp number is already governed for another or ambiguous pharmacy");
      }
    }
    const preservePrimary = existing ? d1Boolean(existing.is_primary, "is_primary")
      : !(await firstRow<D1Row>(this.database, `SELECT id FROM med250_pharmacy_contacts
          WHERE pharmacy_id = ? AND channel = ? AND active = 1 AND is_primary = 1`, [pharmacyId, contactType]));
    const resultingContactId = action === "add" ? newId() : action === "update" ? newId() : contactId as string;
    const statements: D1PreparedStatement[] = [];
    if (action === "remove" || action === "update") {
      statements.push(this.database.prepare(`UPDATE med250_pharmacy_contacts SET active = 0, login_enabled = 0,
        dispatch_enabled = 0, is_primary = 0, verified_by_label = ?, verification_note = ?, updated_at = ? WHERE id = ?`)
        .bind(input.reviewedBy.trim(), input.reviewNote.trim(), at, contactId));
      if (existing?.channel === "whatsapp" && existing.e164) statements.push(this.database.prepare(`
        UPDATE med250_known_pharmacy_numbers SET resolution_status = 'retired', pharmacy_id = NULL,
          reviewed_at = ?, updated_at = ? WHERE e164 = ? AND resolution_status = 'resolved' AND pharmacy_id = ?
      `).bind(at, at, existing.e164, pharmacyId));
    }
    let mirroredPhoneId: string | null = null;
    if (action !== "remove") {
      statements.push(this.database.prepare(`
        INSERT INTO med250_pharmacy_contacts (
          id, pharmacy_id, channel, e164, verified_at, source, source_reference, source_observed_at,
          login_enabled, dispatch_enabled, is_primary, active, created_at, updated_at,
          verified_by_label, verification_note, derived_from_contact_id
        ) VALUES (?, ?, ?, ?, ?, 'pharmacy_submission', ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
        ON CONFLICT(pharmacy_id, channel, e164) DO UPDATE SET verified_at = excluded.verified_at,
          source = excluded.source, source_reference = excluded.source_reference,
          source_observed_at = excluded.source_observed_at, login_enabled = excluded.login_enabled,
          dispatch_enabled = excluded.dispatch_enabled, active = 1, is_primary = excluded.is_primary,
          updated_at = excluded.updated_at, verified_by_label = excluded.verified_by_label,
          verification_note = excluded.verification_note, derived_from_contact_id = excluded.derived_from_contact_id
      `).bind(resultingContactId, pharmacyId, contactType, requestedE164, at, input.requestId, at,
        contactType === "whatsapp" ? 1 : 0, contactType === "whatsapp" ? 1 : 0,
        preservePrimary ? 1 : 0, at, at, input.reviewedBy.trim(), input.reviewNote.trim(), action === "update" ? contactId : null));
      if (contactType === "whatsapp" && requestedE164) {
        statements.push(this.database.prepare(`
          INSERT INTO med250_known_pharmacy_numbers (
            e164, resolution_status, pharmacy_id, source, source_evidence, reviewed_at, created_at, updated_at
          ) VALUES (?, 'resolved', ?, 'MED250 approved pharmacy contact correction', ?, ?, ?, ?)
          ON CONFLICT(e164) DO UPDATE SET resolution_status = 'resolved', pharmacy_id = excluded.pharmacy_id,
            source = excluded.source, source_evidence = excluded.source_evidence,
            reviewed_at = excluded.reviewed_at, updated_at = excluded.updated_at
        `).bind(requestedE164, pharmacyId, JSON.stringify({ request_id: input.requestId, reviewed_by: input.reviewedBy.trim() }), at, at, at));
        mirroredPhoneId = newId();
        statements.push(this.database.prepare(`
          INSERT INTO med250_pharmacy_contacts (
            id, pharmacy_id, channel, e164, verified_at, source, source_reference, source_observed_at,
            login_enabled, dispatch_enabled, is_primary, active, created_at, updated_at,
            verified_by_label, verification_note, derived_from_contact_id
          ) VALUES (?, ?, 'phone', ?, ?, 'approved_whatsapp_mirror', ?, ?, 0, 0, 0, 1, ?, ?, ?, ?, ?)
          ON CONFLICT(pharmacy_id, channel, e164) DO UPDATE SET verified_at = excluded.verified_at,
            source = excluded.source, source_reference = excluded.source_reference,
            source_observed_at = excluded.source_observed_at, active = 1, updated_at = excluded.updated_at,
            verified_by_label = excluded.verified_by_label, verification_note = excluded.verification_note,
            derived_from_contact_id = excluded.derived_from_contact_id
        `).bind(mirroredPhoneId, pharmacyId, requestedE164, at, input.requestId, at, at, at,
          input.reviewedBy.trim(), input.reviewNote.trim(), resultingContactId));
      }
    }
    statements.push(
      this.database.prepare(`UPDATE med250_pharmacy_contact_change_requests SET status = 'approved', reviewed_at = ?,
        reviewed_by_label = ?, review_note = ?, updated_at = ? WHERE id = ? AND status = 'pending'`)
        .bind(at, input.reviewedBy.trim(), input.reviewNote.trim(), at, input.requestId),
      this.database.prepare(`
        UPDATE med250_pharmacies SET dispatch_enabled = CASE WHEN geocode_status = 'verified'
          AND marketplace_approved = 1 AND licence_status = 'current' AND licence_expires_on >= ?
          AND EXISTS (SELECT 1 FROM med250_pharmacy_contacts contact WHERE contact.pharmacy_id = med250_pharmacies.id
            AND contact.channel = 'whatsapp' AND contact.active = 1 AND contact.dispatch_enabled = 1
            AND contact.verified_at IS NOT NULL) THEN 1 ELSE 0 END, updated_at = ? WHERE id = ?
      `).bind(at.slice(0, 10), at, pharmacyId),
      this.database.prepare(`INSERT INTO med250_audit_events (event_type, details, created_at)
        VALUES ('pharmacy_contact_change_approved', json_object('request_id', ?, 'pharmacy_id', ?, 'requested_action', ?), ?)`)
        .bind(input.requestId, pharmacyId, action, at),
    );
    await atomicBatch(this.database, statements);
    return { request_id: input.requestId, status: "approved", contact_id: resultingContactId, mirrored_phone_contact_id: mirroredPhoneId };
  }

  async catalogueProducts(input: { productId: string | null; status: string; category: string | null; limit: number }): Promise<OperatorRow[]> {
    return allRows<OperatorRow>(this.database, `
      SELECT id, brand_name, generic_name, strength, dosage_form, pack_size, product_type,
        category, department, subcategory, publication_status, compliance_status,
        compliance_evidence_url, reviewed_by_label, publication_review_note AS review_note,
        publication_reviewed_at AS reviewed_at, publication_approved_at AS approved_at,
        is_active, is_orderable, source_url, updated_at
      FROM med250_catalogue_products
      WHERE (? IS NOT NULL AND id = ?) OR (? IS NULL AND publication_status = ? AND (? IS NULL OR department = ?))
      ORDER BY id LIMIT ?
    `, [input.productId, input.productId, input.productId, input.status, input.category, input.category, input.limit]);
  }

  async catalogueReviews(productId: string): Promise<OperatorRow[]> {
    return allRows<OperatorRow>(this.database, `
      SELECT id, decision, reviewed_by, evidence_note, compliance_evidence_url,
        expected_product_updated_at, previous_state, resulting_state, created_at
      FROM med250_catalogue_product_reviews WHERE product_id = ? ORDER BY created_at DESC, id DESC LIMIT 20
    `, [productId]);
  }

  async reviewCatalogueProduct(input: {
    productId: string; decision: string; reviewedBy: string; evidenceNote: string;
    expectedUpdatedAt: string; complianceEvidenceUrl: string | null;
  }): Promise<unknown> {
    const product = await firstRow<D1Row>(this.database, "SELECT * FROM med250_catalogue_products WHERE id = ?", [input.productId]);
    if (!product) throw new Error("catalogue product not found");
    if (required(product, "updated_at") !== input.expectedUpdatedAt) throw new Error("catalogue product changed after inspection");
    const previous = productPublicationState(product);
    const currentStatus = required(product, "publication_status");
    let publicationStatus: string;
    let complianceStatus: string;
    let active: number;
    let orderable: number;
    let approvedAt: string | null = null;
    const at = nowIso();
    if (["start_review", "compliance_review"].includes(input.decision)) {
      if (!["research_candidate", "catalogue_review", "rejected"].includes(currentStatus)) throw new Error("only unpublished products can enter catalogue review");
      publicationStatus = "catalogue_review"; complianceStatus = "catalogue_review"; active = 0; orderable = 0;
    } else if (input.decision === "approve") {
      if (!["research_candidate", "catalogue_review"].includes(currentStatus)) throw new Error("product must be unpublished or in catalogue review before approval");
      publicationStatus = "approved"; complianceStatus = "central_catalogue_pharmacy_fulfilment"; active = 1; orderable = 1; approvedAt = at;
    } else if (input.decision === "reject") {
      if (currentStatus === "rejected") throw new Error("product is already rejected");
      publicationStatus = "rejected"; complianceStatus = "rejected"; active = 0; orderable = 0;
    } else {
      if (currentStatus !== "approved") throw new Error("only approved products can be unpublished");
      publicationStatus = "catalogue_review"; complianceStatus = "catalogue_review_after_unpublish"; active = 0; orderable = 0;
    }
    const evidenceUrl = input.complianceEvidenceUrl ?? nullable(product, "compliance_evidence_url");
    const resulting = {
      id: input.productId, publication_status: publicationStatus, compliance_status: complianceStatus,
      is_active: Boolean(active), is_orderable: Boolean(orderable), compliance_evidence_url: evidenceUrl,
      reviewed_by_label: input.reviewedBy.trim(), reviewed_at: at, approved_at: approvedAt, updated_at: at,
    };
    const results = await atomicBatch(this.database, [
      this.database.prepare(`
        UPDATE med250_catalogue_products SET publication_status = ?, compliance_status = ?, is_active = ?, is_orderable = ?,
          compliance_evidence_url = ?, reviewed_by_label = ?, publication_review_note = ?,
          publication_reviewed_at = ?, publication_approved_at = ?, updated_at = ?
        WHERE id = ? AND updated_at = ?
      `).bind(publicationStatus, complianceStatus, active, orderable, evidenceUrl, input.reviewedBy.trim(),
        input.evidenceNote.trim(), at, approvedAt, at, input.productId, input.expectedUpdatedAt),
      this.database.prepare(`
        INSERT INTO med250_catalogue_product_reviews (
          id, product_id, decision, reviewed_by, evidence_note, compliance_evidence_url,
          expected_product_updated_at, previous_state, resulting_state, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(newId(), input.productId, input.decision, input.reviewedBy.trim(), input.evidenceNote.trim(),
        evidenceUrl, input.expectedUpdatedAt, JSON.stringify(previous), JSON.stringify(resulting), at),
    ]);
    if (changes(results[0]) !== 1) throw new Error("catalogue product changed after inspection");
    return resulting;
  }

  async descriptionProduct(productId: string): Promise<OperatorRow | null> {
    return firstRow<OperatorRow>(this.database, `
      SELECT id, brand_name, generic_name, strength, dosage_form, pack_size, product_type,
        category, source_name, source_url, description, description_source_name,
        description_source_url, description_source_sha256, description_rights_basis,
        description_rights_reference, description_rights_verified,
        description_clinical_review_status, description_review_note,
        description_reviewed_by, description_reviewed_role, description_reviewed_at,
        description_approved, updated_at FROM med250_catalogue_products WHERE id = ?
    `, [productId]);
  }

  async descriptionReviews(productId: string): Promise<OperatorRow[]> {
    return allRows<OperatorRow>(this.database, `
      SELECT id, decision, source_name, source_url, source_sha256, rights_reference,
        rights_verified, clinical_review_status, review_note, reviewed_by, reviewed_role,
        reviewed_at, expected_product_updated_at, previous_state, resulting_state, created_at
      FROM med250_product_description_reviews WHERE product_id = ? ORDER BY created_at DESC, id DESC LIMIT 20
    `, [productId]);
  }

  async reviewDescription(input: {
    productId: string; decision: "approve" | "withdraw"; expectedUpdatedAt: string;
    reviewedBy: string; reviewedRole: string; reviewedAt: string; reviewNote: string;
    description: string | null; sourceName: string | null; sourceUrl: string | null;
    sourceSha256: string | null; rightsBasis: string | null; rightsReference: string | null;
    rightsVerified: boolean; clinicalReviewStatus: string;
  }): Promise<unknown> {
    const product = await firstRow<D1Row>(this.database, "SELECT * FROM med250_catalogue_products WHERE id = ?", [input.productId]);
    if (!product) throw new Error("catalogue product not found");
    if (required(product, "updated_at") !== input.expectedUpdatedAt) throw new Error("catalogue product changed after inspection");
    if (product.description_reviewed_at && input.reviewedAt <= required(product, "description_reviewed_at")) {
      throw new Error("review timestamp must be newer than current review");
    }
    if (input.decision === "withdraw" && !d1Boolean(product.description_approved, "description_approved")) {
      throw new Error("only an approved description can be withdrawn");
    }
    const previous = descriptionState(product);
    const description = input.decision === "approve" ? input.description as string : required(product, "description");
    const sourceName = input.decision === "approve" ? input.sourceName as string : required(product, "description_source_name");
    const sourceUrl = input.decision === "approve" ? input.sourceUrl as string : required(product, "description_source_url");
    const sourceSha = input.decision === "approve" ? input.sourceSha256 as string : required(product, "description_source_sha256");
    const rightsBasis = input.decision === "approve" ? input.rightsBasis as string : required(product, "description_rights_basis");
    const rightsReference = input.decision === "approve" ? input.rightsReference as string : required(product, "description_rights_reference");
    const clinical = input.decision === "approve" ? input.clinicalReviewStatus : required(product, "description_clinical_review_status");
    const at = nowIso();
    const approved = input.decision === "approve";
    const resulting = {
      id: input.productId, description, source_name: sourceName, source_url: sourceUrl,
      source_sha256: sourceSha, rights_basis: rightsBasis, rights_reference: rightsReference,
      rights_verified: true, clinical_review_status: clinical, review_note: input.reviewNote.trim(),
      reviewed_by: input.reviewedBy.trim(), reviewed_role: input.reviewedRole.trim(),
      reviewed_at: input.reviewedAt, approved, updated_at: at,
    };
    const results = await atomicBatch(this.database, [
      this.database.prepare(`
        UPDATE med250_catalogue_products SET description = ?, description_source_name = ?,
          description_source_url = ?, description_source_sha256 = ?, description_rights_basis = ?,
          description_rights_reference = ?, description_rights_verified = 1,
          description_clinical_review_status = ?, description_review_note = ?,
          description_reviewed_by = ?, description_reviewed_role = ?, description_reviewed_at = ?,
          description_approved = ?, updated_at = ? WHERE id = ? AND updated_at = ?
      `).bind(description, sourceName, sourceUrl, sourceSha, rightsBasis, rightsReference, clinical,
        input.reviewNote.trim(), input.reviewedBy.trim(), input.reviewedRole.trim(), input.reviewedAt,
        approved ? 1 : 0, at, input.productId, input.expectedUpdatedAt),
      this.database.prepare(`
        INSERT INTO med250_product_description_reviews (
          id, product_id, decision, reviewed_description, source_name, source_url,
          source_sha256, rights_basis, rights_reference, rights_verified,
          clinical_review_status, review_note, reviewed_by, reviewed_role, reviewed_at,
          expected_product_updated_at, previous_state, resulting_state, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(newId(), input.productId, input.decision, description, sourceName, sourceUrl, sourceSha,
        rightsBasis, rightsReference, clinical, input.reviewNote.trim(), input.reviewedBy.trim(),
        input.reviewedRole.trim(), input.reviewedAt, input.expectedUpdatedAt,
        JSON.stringify(previous), JSON.stringify(resulting), at),
    ]);
    if (changes(results[0]) !== 1) throw new Error("catalogue product changed after inspection");
    return resulting;
  }
}
