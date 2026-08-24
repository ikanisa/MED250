import {
  allRows,
  atomicBatch,
  d1Boolean,
  firstRow,
  newId,
  normalizedE164,
  nowIso,
  runStatement,
  type D1Row,
} from "../../db/index.ts";

type PharmacyAuthorization = { pharmacyId: string };
type ClientAuthorization = { actorId: string };

function requiredString(row: D1Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || !value) throw new Error(`Database field ${key} is invalid.`);
  return value;
}

function nullableString(row: D1Row, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`Database field ${key} is invalid.`);
  return value;
}

function numberValue(row: D1Row, key: string): number {
  const value = row[key];
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Database field ${key} is invalid.`);
  return parsed;
}

function integerValue(row: D1Row, key: string): number {
  return Math.round(numberValue(row, key));
}

function timestamp(row: D1Row, key: string): string {
  const value = requiredString(row, key);
  if (!Number.isFinite(Date.parse(value))) throw new Error(`Database field ${key} is invalid.`);
  return value;
}

function optionalNumber(row: D1Row, key: string): number | null {
  return row[key] === null || row[key] === undefined ? null : numberValue(row, key);
}

function optionalBoolean(row: D1Row, key: string): boolean | null {
  return row[key] === null || row[key] === undefined ? null : d1Boolean(row[key], key);
}

function changes(result: D1Result<unknown> | undefined): number {
  const count = result?.meta?.changes;
  return typeof count === "number" ? count : 0;
}

export class MarketplaceRepository {
  constructor(private readonly database: D1Database) {}

  private async clientForPrincipal(principalId: string): Promise<ClientAuthorization> {
    const row = await firstRow<D1Row>(this.database, `
      SELECT actor.id AS actor_id
      FROM med250_web_principals principal
      JOIN med250_actors actor ON actor.id = principal.actor_id
      WHERE principal.id = ? AND principal.subject_type = 'client'
        AND principal.verified_at IS NOT NULL AND actor.actor_type = 'client'
      LIMIT 1
    `, [principalId]);
    if (!row) throw new Error("verified client principal is required");
    return { actorId: requiredString(row, "actor_id") };
  }

  private async pharmacyForPrincipal(principalId: string): Promise<PharmacyAuthorization> {
    const today = nowIso().slice(0, 10);
    const row = await firstRow<D1Row>(this.database, `
      SELECT actor.pharmacy_id
      FROM med250_web_principals principal
      JOIN med250_actors actor ON actor.id = principal.actor_id
      JOIN med250_pharmacies pharmacy ON pharmacy.id = actor.pharmacy_id
      JOIN med250_pharmacy_contacts contact
        ON contact.pharmacy_id = pharmacy.id
       AND contact.channel = 'whatsapp'
       AND contact.e164 = actor.e164
       AND contact.verified_at IS NOT NULL
       AND contact.login_enabled = 1 AND contact.active = 1
      WHERE principal.id = ? AND principal.subject_type = 'pharmacy'
        AND principal.verified_at IS NOT NULL AND actor.actor_type = 'pharmacy'
        AND pharmacy.licence_status = 'current' AND pharmacy.licence_expires_on >= ?
      LIMIT 1
    `, [principalId, today]);
    if (!row) throw new Error("eligible pharmacy principal is required");
    return { pharmacyId: requiredString(row, "pharmacy_id") };
  }

  private async assertPharmacy(principalId: string, pharmacyId: string): Promise<void> {
    const authorization = await this.pharmacyForPrincipal(principalId);
    if (authorization.pharmacyId !== pharmacyId) throw new Error("pharmacy workspace is not authorized");
  }

  async activeOrders(principalId: string): Promise<unknown> {
    const client = await this.clientForPrincipal(principalId);
    const rows = await allRows<D1Row>(this.database, `
      SELECT request.id AS order_id, request.reference, request.status, request.created_at,
        request.expires_at, request.updated_at, request.delivery_preference,
        request.substitutes_allowed, request.selected_offer_id,
        (SELECT count(*) FROM med250_request_recipients recipient WHERE recipient.request_id = request.id) AS recipient_count
      FROM med250_client_requests request
      WHERE request.source = 'web_catalogue' AND request.web_principal_id = ? AND request.actor_id = ?
        AND request.status IN ('dispatched', 'selected')
        AND (request.status = 'selected' OR request.expires_at > ?)
      ORDER BY request.updated_at DESC LIMIT 10
    `, [principalId, client.actorId, nowIso()]);
    return Promise.all(rows.map(async (row) => {
      const orderId = requiredString(row, "order_id");
      const offers = await allRows<D1Row>(this.database, `
        SELECT id, status, complete FROM med250_marketplace_offers
        WHERE request_id = ? AND complete = 1 AND status IN ('submitted', 'selected')
        ORDER BY updated_at DESC
      `, [orderId]);
      return {
        order_id: orderId,
        reference: requiredString(row, "reference"),
        status: requiredString(row, "status"),
        created_at: timestamp(row, "created_at"),
        expires_at: timestamp(row, "expires_at"),
        updated_at: timestamp(row, "updated_at"),
        delivery_preference: nullableString(row, "delivery_preference"),
        substitutes_allowed: optionalBoolean(row, "substitutes_allowed"),
        recipient_count: integerValue(row, "recipient_count"),
        selected_offer_id: nullableString(row, "selected_offer_id"),
        offers: offers.map((offer) => ({
          id: requiredString(offer, "id"),
          status: requiredString(offer, "status"),
          complete: d1Boolean(offer.complete, "complete"),
        })),
      };
    }));
  }

  async confirmedOffers(principalId: string, requestId: string): Promise<unknown> {
    const client = await this.clientForPrincipal(principalId);
    const owned = await firstRow<D1Row>(this.database, `
      SELECT id FROM med250_client_requests
      WHERE id = ? AND source = 'web_catalogue' AND web_principal_id = ? AND actor_id = ?
    `, [requestId, principalId, client.actorId]);
    if (!owned) throw new Error("order not found");
    const today = nowIso().slice(0, 10);
    const offers = await allRows<D1Row>(this.database, `
      SELECT offer.id AS offer_id, offer.request_id AS order_id, offer.pharmacy_id,
        offer.status, offer.complete, offer.total_rwf, offer.fulfilment_method,
        offer.ready_in_minutes, offer.note, coalesce(offer.submitted_at, offer.created_at) AS created_at,
        pharmacy.name AS pharmacy_name, recipient.distance_m
      FROM med250_marketplace_offers offer
      JOIN med250_pharmacies pharmacy ON pharmacy.id = offer.pharmacy_id
      JOIN med250_request_recipients recipient
        ON recipient.request_id = offer.request_id AND recipient.pharmacy_id = offer.pharmacy_id
      WHERE offer.request_id = ? AND offer.complete = 1 AND offer.status IN ('submitted', 'selected')
        AND pharmacy.marketplace_approved = 1 AND pharmacy.licence_status = 'current'
        AND pharmacy.licence_expires_on >= ?
      ORDER BY recipient.distance_m, pharmacy.name
    `, [requestId, today]);
    return Promise.all(offers.map(async (offer) => {
      const offerId = requiredString(offer, "offer_id");
      const items = await allRows<D1Row>(this.database, `
        SELECT item.id, item.order_item_id, item.offered_product_id, item.available,
          item.is_substitute, item.unit_price_rwf, item.quantity, item.note,
          product.brand_name, product.generic_name, product.strength, product.dosage_form,
          product.pack_size, product.registration_number, product.category, product.department,
          product.subcategory, product.product_type, product.prescription_status,
          product.regulatory_status, product.is_orderable
        FROM med250_marketplace_offer_items item
        JOIN med250_web_order_items requested ON requested.id = item.order_item_id
        LEFT JOIN med250_catalogue_products product ON product.id = item.offered_product_id
        WHERE item.offer_id = ? ORDER BY requested.position
      `, [offerId]);
      return {
        offer_id: offerId,
        order_id: requiredString(offer, "order_id"),
        pharmacy_id: requiredString(offer, "pharmacy_id"),
        status: requiredString(offer, "status"),
        complete: d1Boolean(offer.complete, "complete"),
        total_rwf: integerValue(offer, "total_rwf"),
        fulfilment_method: requiredString(offer, "fulfilment_method"),
        ready_in_minutes: optionalNumber(offer, "ready_in_minutes"),
        note: nullableString(offer, "note"),
        created_at: timestamp(offer, "created_at"),
        pharmacy_name: requiredString(offer, "pharmacy_name"),
        distance_m: numberValue(offer, "distance_m"),
        items: items.map((item) => ({
          id: requiredString(item, "id"), order_item_id: requiredString(item, "order_item_id"),
          offered_product_id: nullableString(item, "offered_product_id"),
          available: d1Boolean(item.available, "available"),
          is_substitute: d1Boolean(item.is_substitute, "is_substitute"),
          unit_price_rwf: optionalNumber(item, "unit_price_rwf"), quantity: optionalNumber(item, "quantity"),
          note: nullableString(item, "note"), brand_name: nullableString(item, "brand_name"),
          generic_name: nullableString(item, "generic_name"), strength: nullableString(item, "strength"),
          dosage_form: nullableString(item, "dosage_form"), pack_size: nullableString(item, "pack_size"),
          registration_number: nullableString(item, "registration_number"), category: nullableString(item, "category"),
          department: nullableString(item, "department"), subcategory: nullableString(item, "subcategory"),
          product_type: nullableString(item, "product_type"), prescription_status: nullableString(item, "prescription_status"),
          regulatory_status: nullableString(item, "regulatory_status"),
          is_orderable: item.is_orderable === null ? null : d1Boolean(item.is_orderable, "is_orderable"),
        })),
      };
    }));
  }

  async selectOffer(principalId: string, requestId: string, offerId: string): Promise<void> {
    const client = await this.clientForPrincipal(principalId);
    const today = nowIso().slice(0, 10);
    const offer = await firstRow<D1Row>(this.database, `
      SELECT request.selected_offer_id, offer.pharmacy_id
      FROM med250_client_requests request
      JOIN med250_marketplace_offers offer ON offer.request_id = request.id
      JOIN med250_pharmacies pharmacy ON pharmacy.id = offer.pharmacy_id
      WHERE request.id = ? AND request.source = 'web_catalogue'
        AND request.web_principal_id = ? AND request.actor_id = ?
        AND offer.id = ? AND offer.complete = 1 AND offer.status IN ('submitted', 'selected')
        AND pharmacy.marketplace_approved = 1 AND pharmacy.licence_status = 'current'
        AND pharmacy.licence_expires_on >= ?
    `, [requestId, principalId, client.actorId, offerId, today]);
    if (!offer) throw new Error("eligible offer not found");
    const currentOffer = nullableString(offer, "selected_offer_id");
    if (currentOffer && currentOffer !== offerId) throw new Error("a different offer is already selected");
    if (currentOffer === offerId) return;
    const at = nowIso();
    const pharmacyId = requiredString(offer, "pharmacy_id");
    const results = await atomicBatch(this.database, [
      this.database.prepare(`
        UPDATE med250_client_requests SET status = 'selected', selected_offer_id = ?, selected_at = ?, updated_at = ?
        WHERE id = ? AND status = 'dispatched' AND selected_offer_id IS NULL AND expires_at > ?
      `).bind(offerId, at, at, requestId, at),
      this.database.prepare(`
        UPDATE med250_marketplace_offers
        SET status = CASE WHEN id = ? THEN 'selected' ELSE 'expired' END, updated_at = ?
        WHERE request_id = ? AND status IN ('draft', 'submitted')
          AND EXISTS (SELECT 1 FROM med250_client_requests request WHERE request.id = ? AND request.selected_offer_id = ?)
      `).bind(offerId, at, requestId, requestId, offerId),
      this.database.prepare(`
        INSERT INTO med250_audit_events (event_type, actor_id, request_id, details, created_at)
        SELECT 'marketplace_offer_selected', ?, ?, json_object('offer_id', ?, 'pharmacy_id', ?), ?
        WHERE EXISTS (SELECT 1 FROM med250_client_requests request WHERE request.id = ? AND request.selected_offer_id = ?)
      `).bind(client.actorId, requestId, offerId, pharmacyId, at, requestId, offerId),
    ]);
    if (changes(results[0]) !== 1) throw new Error("order is no longer selectable");
  }

  async selectedContact(principalId: string, requestId: string): Promise<unknown> {
    const client = await this.clientForPrincipal(principalId);
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
    const row = await firstRow<D1Row>(this.database, `
      SELECT request.id AS order_id, offer.id AS offer_id, pharmacy.id AS pharmacy_id,
        pharmacy.name AS pharmacy_name, pharmacy.momo_code,
        (SELECT contact.e164 FROM med250_pharmacy_contacts contact
          WHERE contact.pharmacy_id = pharmacy.id AND contact.channel = 'whatsapp'
            AND contact.active = 1 AND contact.verified_at IS NOT NULL
          ORDER BY contact.is_primary DESC, contact.dispatch_enabled DESC, contact.verified_at DESC, contact.id LIMIT 1
        ) AS whatsapp
      FROM med250_client_requests request
      JOIN med250_marketplace_offers offer ON offer.id = request.selected_offer_id AND offer.request_id = request.id
      JOIN med250_pharmacies pharmacy ON pharmacy.id = offer.pharmacy_id
      WHERE request.id = ? AND request.web_principal_id = ? AND request.actor_id = ?
        AND request.status IN ('selected', 'completed') AND request.selected_at > ? AND offer.status = 'selected'
    `, [requestId, principalId, client.actorId, cutoff]);
    if (!row) throw new Error("selected contact is unavailable");
    return {
      order_id: requiredString(row, "order_id"), offer_id: requiredString(row, "offer_id"),
      pharmacy_id: requiredString(row, "pharmacy_id"), pharmacy_name: requiredString(row, "pharmacy_name"),
      whatsapp: nullableString(row, "whatsapp"), momo_code: nullableString(row, "momo_code"),
    };
  }

  async closeOrder(principalId: string, requestId: string, outcome: "completed" | "cancelled") {
    const client = await this.clientForPrincipal(principalId);
    const at = nowIso();
    const results = await atomicBatch(this.database, [
      this.database.prepare(`
        UPDATE med250_client_requests SET status = ?, closed_at = coalesce(closed_at, ?), updated_at = ?
        WHERE id = ? AND source = 'web_catalogue' AND web_principal_id = ? AND actor_id = ?
          AND status IN ('dispatched', 'selected')
      `).bind(outcome, at, at, requestId, principalId, client.actorId),
      this.database.prepare(`
        UPDATE med250_marketplace_offers SET status = 'expired', updated_at = ?
        WHERE request_id = ? AND status IN ('draft', 'submitted')
          AND EXISTS (SELECT 1 FROM med250_client_requests request WHERE request.id = ? AND request.closed_at = ?)
      `).bind(at, requestId, requestId, at),
      this.database.prepare(`
        INSERT INTO med250_audit_events (event_type, actor_id, request_id, details, created_at)
        SELECT 'web_order_closed', ?, ?, json_object('outcome', ?), ?
        WHERE EXISTS (SELECT 1 FROM med250_client_requests request WHERE request.id = ? AND request.closed_at = ?)
      `).bind(client.actorId, requestId, outcome, at, requestId, at),
    ]);
    if (changes(results[0]) !== 1) throw new Error("active order not found");
    return { orderId: requestId, status: outcome, closedAt: at };
  }

  async pharmacyWorkspace(principalId: string): Promise<unknown> {
    const { pharmacyId } = await this.pharmacyForPrincipal(principalId);
    const row = await firstRow<D1Row>(this.database, `
      SELECT pharmacy.id AS pharmacy_id, pharmacy.name AS pharmacy_name, pharmacy.licence_number,
        pharmacy.momo_code, pharmacy.address, pharmacy.google_maps_url, pharmacy.latitude, pharmacy.longitude,
        pharmacy.licence_status, pharmacy.licence_expires_on,
        (SELECT contact.e164 FROM med250_pharmacy_contacts contact
          WHERE contact.pharmacy_id = pharmacy.id AND contact.channel = 'whatsapp'
            AND contact.active = 1 AND contact.verified_at IS NOT NULL
          ORDER BY contact.is_primary DESC, contact.login_enabled DESC, contact.verified_at DESC, contact.id LIMIT 1
        ) AS whatsapp
      FROM med250_pharmacies pharmacy WHERE pharmacy.id = ?
    `, [pharmacyId]);
    if (!row) return [];
    const today = nowIso().slice(0, 10);
    return [{
      membership_id: principalId, pharmacy_id: pharmacyId,
      pharmacy_name: requiredString(row, "pharmacy_name"), license_number: nullableString(row, "licence_number") ?? "",
      role: "staff", status: "active", whatsapp: nullableString(row, "whatsapp"),
      momo_code: nullableString(row, "momo_code"), address: nullableString(row, "address"),
      google_maps_url: nullableString(row, "google_maps_url"), latitude: optionalNumber(row, "latitude"),
      longitude: optionalNumber(row, "longitude"),
      online_license_verified: requiredString(row, "licence_status") === "current"
        && (nullableString(row, "licence_expires_on") ?? "") >= today,
    }];
  }

  async pharmacyRequests(principalId: string, pharmacyId: string): Promise<unknown> {
    await this.assertPharmacy(principalId, pharmacyId);
    const rows = await allRows<D1Row>(this.database, `
      SELECT request.id AS order_id, request.reference, request.status, recipient.distance_m,
        request.created_at, request.expires_at, request.delivery_preference, request.substitutes_allowed,
        request.location_accuracy_m, CASE WHEN request.prescription_media_id IS NULL THEN 0 ELSE 1 END AS has_prescription,
        (SELECT count(*) FROM med250_web_order_items count_item WHERE count_item.request_id = request.id) AS item_count
      FROM med250_request_recipients recipient
      JOIN med250_client_requests request ON request.id = recipient.request_id
      WHERE recipient.pharmacy_id = ? AND request.source = 'web_catalogue'
        AND request.status = 'dispatched' AND request.expires_at > ?
      ORDER BY request.created_at DESC LIMIT 100
    `, [pharmacyId, nowIso()]);
    return Promise.all(rows.map(async (row) => {
      const orderId = requiredString(row, "order_id");
      const items = await allRows<D1Row>(this.database, `
        SELECT id AS order_item_id, product_id, product_name, product_name AS brand_name,
          generic_name, strength, dosage_form, pack_size, quantity, customer_min_rwf,
          customer_max_rwf, substitutes_allowed
        FROM med250_web_order_items WHERE request_id = ? ORDER BY position
      `, [orderId]);
      return {
        order_id: orderId, reference: requiredString(row, "reference"), status: requiredString(row, "status"),
        distance_m: numberValue(row, "distance_m"), created_at: timestamp(row, "created_at"),
        expires_at: timestamp(row, "expires_at"), delivery_preference: nullableString(row, "delivery_preference"),
        substitutes_allowed: optionalBoolean(row, "substitutes_allowed"),
        location_accuracy_m: optionalNumber(row, "location_accuracy_m"),
        has_prescription: d1Boolean(row.has_prescription, "has_prescription"), item_count: integerValue(row, "item_count"),
        items: items.map((item) => ({
          order_item_id: requiredString(item, "order_item_id"), product_id: requiredString(item, "product_id"),
          product_name: requiredString(item, "product_name"), brand_name: requiredString(item, "brand_name"),
          generic_name: nullableString(item, "generic_name"), strength: nullableString(item, "strength"),
          dosage_form: nullableString(item, "dosage_form"), pack_size: nullableString(item, "pack_size"),
          quantity: integerValue(item, "quantity"), customer_min_rwf: optionalNumber(item, "customer_min_rwf"),
          customer_max_rwf: optionalNumber(item, "customer_max_rwf"),
          substitutes_allowed: d1Boolean(item.substitutes_allowed, "substitutes_allowed"),
        })),
      };
    }));
  }

  async pharmacyContacts(principalId: string, pharmacyId: string): Promise<unknown> {
    await this.assertPharmacy(principalId, pharmacyId);
    const contacts = await allRows<D1Row>(this.database, `
      SELECT id, channel AS contact_type, e164, is_primary, login_enabled, verified_at, created_at
      FROM med250_pharmacy_contacts
      WHERE pharmacy_id = ? AND channel IN ('phone', 'whatsapp') AND active = 1
      ORDER BY is_primary DESC, channel, created_at
    `, [pharmacyId]);
    const pending = await allRows<D1Row>(this.database, `
      SELECT id, contact_id, requested_action, requested_contact_type, requested_e164, note, created_at
      FROM med250_pharmacy_contact_change_requests
      WHERE pharmacy_id = ? AND status = 'pending' ORDER BY created_at DESC
    `, [pharmacyId]);
    return {
      contacts: contacts.map((row) => ({
        id: requiredString(row, "id"), contact_type: requiredString(row, "contact_type"),
        e164: nullableString(row, "e164"), display_number: row.e164 ? `+${requiredString(row, "e164")}` : null,
        is_primary: d1Boolean(row.is_primary, "is_primary"),
        is_login_enabled: d1Boolean(row.login_enabled, "login_enabled"),
        verification_status: row.verified_at ? "admin_verified" : "pending",
      })),
      pending_requests: pending.map((row) => ({
        id: requiredString(row, "id"), contact_id: nullableString(row, "contact_id"),
        requested_action: requiredString(row, "requested_action"),
        requested_contact_type: requiredString(row, "requested_contact_type"),
        requested_e164: nullableString(row, "requested_e164"), note: nullableString(row, "note"),
        created_at: timestamp(row, "created_at"),
      })),
    };
  }

  async requestPharmacyContactChange(input: {
    principalId: string; pharmacyId: string; action: "add" | "update" | "remove";
    contactType: "phone" | "whatsapp"; contactId: string | null; e164: string | null; note: string | null;
  }): Promise<string> {
    await this.assertPharmacy(input.principalId, input.pharmacyId);
    const normalized = input.action === "remove" ? null : normalizedE164(input.e164 ?? "");
    if (input.action === "add" && input.contactId) throw new Error("new contact cannot have an existing id");
    if (input.action !== "add") {
      const contact = await firstRow<D1Row>(this.database, `
        SELECT id FROM med250_pharmacy_contacts
        WHERE id = ? AND pharmacy_id = ? AND channel = ? AND active = 1
      `, [input.contactId, input.pharmacyId, input.contactType]);
      if (!contact) throw new Error("contact is unavailable");
    }
    if (normalized) {
      const duplicate = await firstRow<D1Row>(this.database, `
        SELECT id FROM med250_pharmacy_contacts
        WHERE e164 = ? AND channel IN ('phone', 'whatsapp') AND active = 1 AND verified_at IS NOT NULL
          AND (? IS NULL OR id <> ?) LIMIT 1
      `, [normalized, input.contactId, input.contactId]);
      if (duplicate) throw new Error("number is already registered to a pharmacy");
    }
    const existing = await firstRow<D1Row>(this.database, `
      SELECT id FROM med250_pharmacy_contact_change_requests
      WHERE pharmacy_id = ? AND status = 'pending' AND requested_action = ? AND requested_contact_type = ?
        AND contact_id IS ? AND requested_e164 IS ? LIMIT 1
    `, [input.pharmacyId, input.action, input.contactType, input.contactId, normalized]);
    if (existing) throw new Error("an identical contact request is already pending");
    const id = newId();
    const at = nowIso();
    await atomicBatch(this.database, [
      this.database.prepare(`
        INSERT INTO med250_pharmacy_contact_change_requests (
          id, pharmacy_id, requested_by_principal_id, contact_id, requested_action,
          requested_contact_type, requested_e164, note, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      `).bind(id, input.pharmacyId, input.principalId, input.contactId, input.action, input.contactType, normalized, input.note, at, at),
      this.database.prepare(`
        INSERT INTO med250_audit_events (event_type, details, created_at)
        VALUES ('pharmacy_contact_change_requested', json_object('pharmacy_id', ?, 'request_id', ?, 'action', ?, 'contact_type', ?), ?)
      `).bind(input.pharmacyId, id, input.action, input.contactType, at),
    ]);
    return id;
  }

  async contributePrice(input: { principalId: string; pharmacyId: string; productId: string; priceRwf: number }) {
    await this.assertPharmacy(input.principalId, input.pharmacyId);
    const product = await firstRow<D1Row>(this.database, `
      SELECT indicative_price_rwf FROM med250_catalogue_products
      WHERE id = ? AND is_active = 1 AND is_orderable = 1
    `, [input.productId]);
    if (!product) throw new Error("orderable product not found");
    const previous = optionalNumber(product, "indicative_price_rwf");
    const status = previous === null ? "initialized" : input.priceRwf < previous ? "lowered" : "not_lower";
    const resulting = status === "not_lower" ? previous as number : input.priceRwf;
    const id = newId();
    const at = nowIso();
    const statements: D1PreparedStatement[] = [];
    if (status !== "not_lower") {
      statements.push(this.database.prepare(`
        UPDATE med250_catalogue_products SET indicative_price_rwf = ?,
          indicative_price_basis = 'lowest_current_verified_pharmacy_contribution',
          indicative_price_source_url = NULL, indicative_price_updated_at = ?, updated_at = ?
        WHERE id = ? AND (indicative_price_rwf IS NULL OR indicative_price_rwf > ?)
      `).bind(resulting, at, at, input.productId, input.priceRwf));
    }
    statements.push(
      this.database.prepare(`
        INSERT INTO med250_catalogue_price_contributions (
          id, pharmacy_id, product_id, submitted_price_rwf, previous_price_rwf,
          resulting_price_rwf, contribution_status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(id, input.pharmacyId, input.productId, input.priceRwf, previous, resulting, status, at),
      this.database.prepare(`
        INSERT INTO med250_audit_events (event_type, details, created_at)
        VALUES ('catalogue_price_contributed', json_object('pharmacy_id', ?, 'product_id', ?, 'contribution_id', ?, 'status', ?), ?)
      `).bind(input.pharmacyId, input.productId, id, status, at),
    );
    await atomicBatch(this.database, statements);
    return {
      contributionId: id, productId: input.productId, submittedPriceRwf: input.priceRwf,
      previousPriceRwf: previous, centralPriceRwf: resulting, becameLowest: status !== "not_lower",
      contributionStatus: status,
    };
  }

  async submitClaim(input: {
    principalId: string; pharmacyId: string; contactEmail: string; contactPhone: string | null; note: string | null;
  }) {
    await this.assertPharmacy(input.principalId, input.pharmacyId);
    const email = input.contactEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error("claim email is invalid");
    const phone = input.contactPhone ? normalizedE164(input.contactPhone) : null;
    const pending = await firstRow<D1Row>(this.database, `
      SELECT id FROM med250_pharmacy_claims WHERE pharmacy_id = ? AND status = 'pending'
    `, [input.pharmacyId]);
    if (pending) throw new Error("a pharmacy claim is already pending");
    const id = newId();
    const at = nowIso();
    await atomicBatch(this.database, [
      this.database.prepare(`
        INSERT INTO med250_pharmacy_claims (
          id, pharmacy_id, submitted_by_principal_id, contact_email, contact_phone,
          note, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      `).bind(id, input.pharmacyId, input.principalId, email, phone, input.note, at, at),
      this.database.prepare(`
        INSERT INTO med250_audit_events (event_type, details, created_at)
        VALUES ('pharmacy_claim_submitted', json_object('pharmacy_id', ?, 'claim_id', ?), ?)
      `).bind(input.pharmacyId, id, at),
    ]);
    return { id, pharmacyId: input.pharmacyId, status: "pending", contactEmail: email, contactPhone: phone, note: input.note, createdAt: at };
  }

  async pharmacySelectedOrders(principalId: string, pharmacyId: string): Promise<unknown> {
    await this.assertPharmacy(principalId, pharmacyId);
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
    const rows = await allRows<D1Row>(this.database, `
      SELECT request.id AS order_id, request.reference, request.customer_e164 AS customer_whatsapp,
        request.delivery_preference, request.prescription_media_id, request.selected_at, request.updated_at
      FROM med250_client_requests request
      JOIN med250_marketplace_offers offer ON offer.id = request.selected_offer_id AND offer.request_id = request.id
      WHERE offer.pharmacy_id = ? AND offer.status = 'selected'
        AND request.status IN ('selected', 'completed') AND request.selected_at > ?
      ORDER BY request.selected_at DESC
    `, [pharmacyId, cutoff]);
    const current = Date.now();
    return rows.map((row) => ({
      order_id: requiredString(row, "order_id"), reference: requiredString(row, "reference"),
      customer_whatsapp: requiredString(row, "customer_whatsapp"),
      delivery_preference: nullableString(row, "delivery_preference"),
      prescription_media_id: nullableString(row, "prescription_media_id"),
      selected_at: timestamp(row, "selected_at"), updated_at: timestamp(row, "updated_at"),
      prescription_access_seconds_remaining: Math.max(0, Math.floor((Date.parse(requiredString(row, "selected_at")) + 86_400_000 - current) / 1_000)),
    }));
  }

  async submitOffer(input: {
    principalId: string; pharmacyId: string; requestId: string;
    fulfilmentMethod: "pickup" | "delivery" | "either"; readyInMinutes: number | null; note: string | null; items: unknown[];
  }) {
    await this.assertPharmacy(input.principalId, input.pharmacyId);
    const assigned = await firstRow<D1Row>(this.database, `
      SELECT request.id FROM med250_request_recipients recipient
      JOIN med250_client_requests request ON request.id = recipient.request_id
      WHERE recipient.request_id = ? AND recipient.pharmacy_id = ?
        AND request.source = 'web_catalogue' AND request.status = 'dispatched' AND request.expires_at > ?
    `, [input.requestId, input.pharmacyId, nowIso()]);
    if (!assigned) throw new Error("assigned order is unavailable");
    const requested = await allRows<D1Row>(this.database, `
      SELECT id, product_id, generic_name, strength, dosage_form, pack_size, quantity, substitutes_allowed
      FROM med250_web_order_items WHERE request_id = ? ORDER BY position
    `, [input.requestId]);
    if (input.items.length !== requested.length) throw new Error("every ordered item must be reviewed once");
    const requestedById = new Map(requested.map((row) => [requiredString(row, "id"), row]));
    const parsed = input.items.map((value) => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("offer items are invalid");
      const row = value as Record<string, unknown>;
      const orderItemId = typeof row.order_item_id === "string" ? row.order_item_id : "";
      const requestItem = requestedById.get(orderItemId);
      if (!requestItem) throw new Error("offer contains an item outside the assigned order");
      const available = row.available === true;
      const substitute = available && row.is_substitute === true;
      const offeredProductId = available
        ? typeof row.offered_product_id === "string" && row.offered_product_id.trim()
          ? row.offered_product_id.trim() : requiredString(requestItem, "product_id")
        : null;
      const quantity = available
        ? row.quantity === null || row.quantity === undefined ? integerValue(requestItem, "quantity") : Number(row.quantity)
        : null;
      const unitPrice = available && row.unit_price_rwf !== null && row.unit_price_rwf !== undefined
        ? Number(row.unit_price_rwf) : null;
      const note = typeof row.note === "string" && row.note.trim() ? row.note.trim().slice(0, 500) : null;
      if (available && (!Number.isInteger(quantity) || (quantity as number) < 1 || (quantity as number) > integerValue(requestItem, "quantity"))) {
        throw new Error("offer item quantity is invalid");
      }
      if (unitPrice !== null && (!Number.isInteger(unitPrice) || unitPrice < 1 || unitPrice > 100_000_000)) {
        throw new Error("offer item price is invalid");
      }
      return { orderItemId, requestItem, available, substitute, offeredProductId, quantity, unitPrice, note };
    });
    if (new Set(parsed.map((item) => item.orderItemId)).size !== parsed.length) throw new Error("every ordered item must be reviewed once");
    if (!parsed.some((item) => item.available)) throw new Error("an offer must include at least one available item");
    for (const item of parsed.filter((candidate) => candidate.available)) {
      if (!item.substitute && item.offeredProductId !== requiredString(item.requestItem, "product_id")) {
        throw new Error("offer item or substitute is incompatible with the request");
      }
      if (item.substitute) {
        if (!d1Boolean(item.requestItem.substitutes_allowed, "substitutes_allowed")) throw new Error("offer item or substitute is incompatible with the request");
        const product = await firstRow<D1Row>(this.database, `
          SELECT generic_name, strength, dosage_form, pack_size FROM med250_catalogue_products
          WHERE id = ? AND is_active = 1 AND is_orderable = 1
        `, [item.offeredProductId]);
        if (!product || ["generic_name", "strength", "dosage_form", "pack_size"].some((key) =>
          (nullableString(product, key) ?? "").toLowerCase() !== (nullableString(item.requestItem, key) ?? "").toLowerCase()
        )) throw new Error("offer item or substitute is incompatible with the request");
      }
    }
    const existing = await firstRow<D1Row>(this.database, `
      SELECT id, status FROM med250_marketplace_offers WHERE request_id = ? AND pharmacy_id = ?
    `, [input.requestId, input.pharmacyId]);
    if (existing && !["draft", "submitted", "withdrawn"].includes(requiredString(existing, "status"))) {
      throw new Error("a selected or expired offer cannot be replaced");
    }
    const offerId = existing ? requiredString(existing, "id") : newId();
    const total = parsed.reduce((sum, item) => sum + (item.available ? (item.unitPrice ?? 0) * (item.quantity as number) : 0), 0);
    const at = nowIso();
    const statements: D1PreparedStatement[] = [
      this.database.prepare(`
        INSERT INTO med250_marketplace_offers (
          id, request_id, pharmacy_id, status, complete, total_rwf, fulfilment_method,
          ready_in_minutes, note, submitted_at, created_at, updated_at
        ) SELECT ?, ?, ?, 'submitted', 1, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM med250_client_requests request JOIN med250_request_recipients recipient ON recipient.request_id = request.id
          WHERE request.id = ? AND recipient.pharmacy_id = ? AND request.status = 'dispatched' AND request.expires_at > ?
        )
        ON CONFLICT(request_id, pharmacy_id) DO UPDATE SET status = 'submitted', complete = 1,
          total_rwf = excluded.total_rwf, fulfilment_method = excluded.fulfilment_method,
          ready_in_minutes = excluded.ready_in_minutes, note = excluded.note,
          submitted_at = excluded.submitted_at, updated_at = excluded.updated_at
        WHERE med250_marketplace_offers.status IN ('draft', 'submitted', 'withdrawn')
      `).bind(offerId, input.requestId, input.pharmacyId, total, input.fulfilmentMethod, input.readyInMinutes, input.note, at, at, at,
        input.requestId, input.pharmacyId, at),
      this.database.prepare(`
        DELETE FROM med250_marketplace_offer_items WHERE offer_id = ?
          AND EXISTS (SELECT 1 FROM med250_marketplace_offers offer WHERE offer.id = ? AND offer.status = 'submitted')
      `).bind(offerId, offerId),
    ];
    for (const item of parsed) {
      statements.push(this.database.prepare(`
        INSERT INTO med250_marketplace_offer_items (
          id, offer_id, order_item_id, offered_product_id, available, is_substitute,
          unit_price_rwf, quantity, note, created_at
        ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM med250_marketplace_offers offer WHERE offer.id = ? AND offer.status = 'submitted')
      `).bind(newId(), offerId, item.orderItemId, item.offeredProductId, item.available ? 1 : 0,
        item.substitute ? 1 : 0, item.unitPrice, item.quantity, item.note, at, offerId));
    }
    statements.push(
      this.database.prepare(`
        UPDATE med250_request_recipients SET response_status = 'can_fulfil', responded_at = coalesce(responded_at, ?)
        WHERE request_id = ? AND pharmacy_id = ?
          AND EXISTS (SELECT 1 FROM med250_marketplace_offers offer WHERE offer.id = ? AND offer.status = 'submitted')
      `).bind(at, input.requestId, input.pharmacyId, offerId),
      this.database.prepare(`
        INSERT INTO med250_audit_events (event_type, request_id, details, created_at)
        SELECT 'marketplace_offer_submitted', ?, json_object('pharmacy_id', ?, 'offer_id', ?, 'total_rwf', ?), ?
        WHERE EXISTS (SELECT 1 FROM med250_marketplace_offers offer WHERE offer.id = ? AND offer.status = 'submitted')
      `).bind(input.requestId, input.pharmacyId, offerId, total, at, offerId),
    );
    const results = await atomicBatch(this.database, statements);
    if (changes(results[0]) !== 1) throw new Error("a selected or expired offer cannot be replaced");
    return { offerId, totalRwf: total, complete: true };
  }

  async createPrescriptionGrant(input: { principalId: string; requestId: string; tokenHashHex: string }): Promise<void> {
    if (!/^[0-9a-f]{64}$/.test(input.tokenHashHex)) throw new Error("grant token hash is invalid");
    const { pharmacyId } = await this.pharmacyForPrincipal(input.principalId);
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
    const media = await firstRow<D1Row>(this.database, `
      SELECT media.r2_key FROM med250_client_requests request
      JOIN med250_marketplace_offers offer ON offer.id = request.selected_offer_id AND offer.request_id = request.id
      JOIN med250_web_prescription_media media ON media.id = request.prescription_media_id
      WHERE request.id = ? AND offer.pharmacy_id = ? AND offer.status = 'selected'
        AND request.status IN ('selected', 'completed') AND request.selected_at > ?
        AND media.processing_status = 'ready' AND media.deleted_at IS NULL
    `, [input.requestId, pharmacyId, cutoff]);
    if (!media) throw new Error("selected prescription is unavailable");
    const at = nowIso();
    const expires = new Date(Date.now() + 10 * 60 * 1_000).toISOString();
    await atomicBatch(this.database, [
      this.database.prepare(`
        UPDATE med250_media_access_grants SET revoked_at = coalesce(revoked_at, ?)
        WHERE request_id = ? AND pharmacy_id = ? AND purpose = 'pharmacy_session' AND revoked_at IS NULL
      `).bind(at, input.requestId, pharmacyId),
      this.database.prepare(`
        INSERT INTO med250_media_access_grants (
          id, token_hash, outbox_id, request_id, pharmacy_id, r2_key, purpose,
          allowed_fetches, fetch_count, expires_at, created_at
        ) VALUES (?, ?, NULL, ?, ?, ?, 'pharmacy_session', 3, 0, ?, ?)
      `).bind(newId(), input.tokenHashHex, input.requestId, pharmacyId, requiredString(media, "r2_key"), expires, at),
      this.database.prepare(`
        INSERT INTO med250_audit_events (event_type, request_id, details, created_at)
        VALUES ('pharmacy_prescription_grant_created', ?, json_object('pharmacy_id', ?, 'ttl_seconds', 600), ?)
      `).bind(input.requestId, pharmacyId, at),
    ]);
  }

  async consumePrescriptionGrant(tokenHashHex: string, pharmacyId: string): Promise<string | null> {
    const at = nowIso();
    const grant = await firstRow<D1Row>(this.database, `
      SELECT id, request_id, r2_key, fetch_count FROM med250_media_access_grants
      WHERE token_hash = ? AND pharmacy_id = ? AND purpose = 'pharmacy_session'
        AND revoked_at IS NULL AND expires_at > ? AND fetch_count < allowed_fetches
    `, [tokenHashHex, pharmacyId, at]);
    if (!grant) return null;
    const id = requiredString(grant, "id");
    const currentFetchCount = integerValue(grant, "fetch_count");
    const result = await runStatement(this.database, `
      UPDATE med250_media_access_grants SET fetch_count = fetch_count + 1, last_fetched_at = ?
      WHERE id = ? AND fetch_count = ? AND revoked_at IS NULL AND expires_at > ? AND fetch_count < allowed_fetches
    `, [at, id, currentFetchCount, at]);
    if (changes(result) !== 1) return null;
    await runStatement(this.database, `
      INSERT INTO med250_audit_events (event_type, request_id, details, created_at)
      VALUES ('private_media_grant_consumed', ?, json_object('purpose', 'pharmacy_session', 'fetch_number', ?), ?)
    `, [requiredString(grant, "request_id"), currentFetchCount + 1, at]);
    return requiredString(grant, "r2_key");
  }
}
