export const expectedBackendContractVersion = "2026-07-16.7";

export function assessBackendContract(contract) {
  const failures = [];
  const requireInvariant = (value, message) => {
    if (!value) failures.push(message);
  };

  requireInvariant(contract?.contract_version === expectedBackendContractVersion, `Expected backend contract ${expectedBackendContractVersion}.`);
  requireInvariant(contract?.privacy?.aggregate_only === true, "Backend contract is not aggregate-only.");
  requireInvariant(contract?.privacy?.contains_row_identifiers === false, "Backend contract may contain row identifiers.");
  requireInvariant(contract?.privacy?.contains_object_names === false, "Backend contract may expose database object names.");
  requireInvariant(contract?.catalogue_search?.exists === true, "Catalogue-search RPC is missing.");
  requireInvariant(contract?.catalogue_search?.security_invoker === true, "Catalogue-search RPC is not SECURITY INVOKER.");
  requireInvariant(contract?.catalogue_search?.stable === true, "Catalogue-search RPC is not STABLE.");
  requireInvariant(contract?.catalogue_search?.search_path_locked === true, "Catalogue-search RPC search path is mutable.");
  requireInvariant(contract?.catalogue_search?.anon_can_execute === true, "Anonymous catalogue search is unavailable.");
  requireInvariant(contract?.catalogue_search?.authenticated_can_execute === true, "Authenticated catalogue search is unavailable.");
  requireInvariant(contract?.marketplace_catalogue?.table_exists === true, "Marketplace product table is missing.");
  requireInvariant(contract?.marketplace_catalogue?.rls_enabled === true, "Marketplace product table does not have RLS.");
  requireInvariant(contract?.marketplace_catalogue?.product_count >= 2_000, "Marketplace catalogue has fewer than 2,000 consumer products.");
  requireInvariant(contract?.marketplace_catalogue?.distinct_ids === contract?.marketplace_catalogue?.product_count, "Marketplace product IDs are not unique.");
  requireInvariant(contract?.marketplace_catalogue?.distinct_asins === contract?.marketplace_catalogue?.product_count, "Marketplace ASINs are not unique.");
  requireInvariant(contract?.marketplace_catalogue?.taxonomy_pair_count === 25, "Marketplace catalogue does not cover all 25 department/subcategory pairs.");
  requireInvariant(contract?.marketplace_catalogue?.minimum_required_per_pair === 50, "Marketplace taxonomy coverage threshold drifted.");
  requireInvariant(
    contract?.marketplace_catalogue?.minimum_taxonomy_pair_count
      >= contract?.marketplace_catalogue?.minimum_required_per_pair,
    "A marketplace subcategory has fewer than 50 approved products.",
  );
  requireInvariant(contract?.marketplace_catalogue?.candidate_count >= contract?.marketplace_catalogue?.product_count, "Marketplace candidate count is below the approved live-product count.");
  requireInvariant(
    contract?.marketplace_catalogue?.candidate_count
      - contract?.marketplace_catalogue?.rejected_candidate_count
      === contract?.marketplace_catalogue?.product_count,
    "Approved and rejected marketplace candidate counts do not reconcile.",
  );
  requireInvariant(contract?.marketplace_catalogue?.unsafe_publication_count === 0, "An unapproved marketplace candidate is active or orderable.");
  requireInvariant(contract?.marketplace_catalogue?.unsafe_projection_count === 0, "An unapproved marketplace candidate was projected into ordering.");
  requireInvariant(contract?.marketplace_catalogue?.public_policy_exists === true, "Marketplace public catalogue RLS policy is missing.");
  requireInvariant(contract?.marketplace_catalogue?.public_table_select_expected === true, "Marketplace public table exposure is not documented by the contract.");
  requireInvariant(contract?.marketplace_catalogue?.view_exists === true, "Unified marketplace catalogue view is missing.");
  requireInvariant(contract?.marketplace_catalogue?.view_security_invoker === true, "Unified marketplace catalogue view is not SECURITY INVOKER.");
  requireInvariant(contract?.marketplace_catalogue?.search_exists === true, "Unified marketplace search RPC is missing.");
  requireInvariant(contract?.marketplace_catalogue?.search_security_invoker === true, "Unified marketplace search RPC is not SECURITY INVOKER.");
  requireInvariant(contract?.marketplace_catalogue?.search_stable === true, "Unified marketplace search RPC is not STABLE.");
  requireInvariant(contract?.marketplace_catalogue?.search_path_locked === true, "Unified marketplace search RPC search path is mutable.");
  requireInvariant(contract?.marketplace_catalogue?.anon_can_search === true, "Anonymous marketplace search is unavailable.");
  requireInvariant(contract?.marketplace_catalogue?.authenticated_can_search === true, "Authenticated marketplace search is unavailable.");
  requireInvariant(contract?.marketplace_catalogue?.approval_projection_exists === true, "Marketplace approval-to-order projection trigger is missing.");
  requireInvariant(contract?.marketplace_moderation?.review_table_exists === true, "Marketplace review audit table is missing.");
  requireInvariant(contract?.marketplace_moderation?.review_table_rls === true, "Marketplace review audit table does not have RLS.");
  requireInvariant(contract?.marketplace_moderation?.immutable_audit_trigger === true, "Marketplace review audit records are mutable.");
  requireInvariant(contract?.marketplace_moderation?.publication_audit_constraint_trigger === true, "Marketplace publication states are not transactionally bound to immutable audit events.");
  requireInvariant(contract?.marketplace_moderation?.approved_without_review_metadata_count === 0, "An approved marketplace product lacks catalogue review metadata.");
  requireInvariant(contract?.marketplace_moderation?.approved_without_audit_count === 0, "An approved marketplace product lacks an approval audit event.");
  requireInvariant(contract?.marketplace_moderation?.rejected_without_audit_count === 0, "A rejected marketplace product lacks a rejection audit event.");
  requireInvariant(contract?.marketplace_moderation?.audit_reconciliation_complete === true, "Marketplace approval and rejection audit reconciliation is incomplete.");
  requireInvariant(contract?.marketplace_moderation?.product_seller_columns_absent === true, "Product rows still contain seller-specific columns; pharmacies must be the only sellers.");
  requireInvariant(contract?.marketplace_moderation?.review_function_exists === true, "Marketplace review function is missing.");
  requireInvariant(contract?.marketplace_moderation?.review_function_security_definer === true, "Marketplace review function is not a privileged server-only boundary.");
  requireInvariant(contract?.marketplace_moderation?.review_function_search_path_locked === true, "Marketplace review function search path is mutable.");
  requireInvariant(contract?.marketplace_moderation?.service_role_can_review === true, "Service role cannot review marketplace products.");
  requireInvariant(contract?.marketplace_moderation?.anon_can_review === false, "Anonymous users can review marketplace products.");
  requireInvariant(contract?.marketplace_moderation?.authenticated_can_review === false, "Signed-in users can review marketplace products.");
  requireInvariant(contract?.pricing_model?.central_price_count >= 0, "Central indicative price count is unavailable.");
  requireInvariant(contract?.pricing_model?.amazon_reference_price_count === 0, "Amazon-derived catalogue prices still exist.");
  requireInvariant(contract?.pricing_model?.amazon_usd_value_count === 0, "Raw Amazon USD price values still exist.");
  requireInvariant(contract?.pricing_model?.amazon_price_reference_supported === false, "The backend contract still permits Amazon-derived prices.");
  requireInvariant(contract?.pricing_model?.current_pharmacy_price_count === 0, "Current pharmacy-specific catalogue prices still exist.");
  requireInvariant(contract?.pricing_model?.public_view_avoids_pharmacy_prices === true, "A public catalogue view still reads pharmacy-specific prices.");
  requireInvariant(contract?.pricing_model?.confirmation_price_optional === true, "Pharmacy availability confirmation still requires a price.");
  requireInvariant(contract?.pricing_model?.pharmacy_catalogue_price_write_disabled === true, "Pharmacy-specific catalogue price writes are still enabled.");
  requireInvariant(contract?.pricing_model?.public_stock_supported === false, "The backend contract incorrectly claims public pharmacy stock support.");
  requireInvariant(contract?.pricing_model?.final_price_claimed === false, "The backend contract incorrectly claims catalogue prices are final.");
  requireInvariant(contract?.product_images?.table_exists === true, "Product image table is missing.");
  requireInvariant(contract?.product_images?.rls_enabled === true, "Product image table does not have RLS.");
  requireInvariant(contract?.product_images?.public_policy_exists === true, "Product image public-read policy is missing.");
  requireInvariant(contract?.product_images?.public_table_select_expected === true, "Product image public-table exposure is not documented.");
  requireInvariant(contract?.product_images?.bucket_configured === true, "Product image Storage bucket is missing or misconfigured.");
  requireInvariant(contract?.product_images?.publish_function_exists === true, "Product image publication RPC is missing.");
  requireInvariant(contract?.product_images?.publish_function_security_definer === true, "Product image publication RPC is not a privileged server boundary.");
  requireInvariant(contract?.product_images?.publish_function_search_path_locked === true, "Product image publication RPC search path is mutable.");
  requireInvariant(contract?.product_images?.service_role_can_publish === true, "Service role cannot publish product images.");
  requireInvariant(contract?.product_images?.anon_can_publish === false, "Anonymous users can publish product images.");
  requireInvariant(contract?.product_images?.authenticated_can_publish === false, "Authenticated users can publish product images.");
  requireInvariant(contract?.product_images?.live_product_count >= 4_500, "Live catalogue has fewer than 4,500 products for image coverage.");
  requireInvariant(contract?.product_images?.coverage_required === false, "The backend incorrectly requires fabricated image coverage for every product.");
  requireInvariant(contract?.product_images?.missing_images_hidden === true, "Products without verified images are not guaranteed to remain visually blank.");
  requireInvariant(contract?.product_images?.generated_placeholders_allowed === false, "Generated product-image placeholders are incorrectly permitted.");
  requireInvariant(contract?.product_images?.partial_product_count === 0, "At least one published product gallery is incomplete or internally inconsistent.");
  requireInvariant(
    contract?.product_images?.complete_product_count + contract?.product_images?.missing_product_count
      === contract?.product_images?.live_product_count,
    "Product image coverage counts do not reconcile with the live catalogue.",
  );
  requireInvariant(contract?.product_images?.unsafe_image_count === 0, "An unapproved or background-bearing product image is published.");
  requireInvariant(contract?.monitoring?.health_exists === true, "Operational-health RPC is missing.");
  requireInvariant(contract?.monitoring?.health_security_definer === true, "Operational-health RPC is not SECURITY DEFINER.");
  requireInvariant(contract?.monitoring?.health_search_path_locked === true, "Operational-health RPC search path is mutable.");
  requireInvariant(contract?.monitoring?.anon_can_execute_health === false, "Anonymous users can execute operational health.");
  requireInvariant(contract?.monitoring?.authenticated_can_execute_health === false, "Authenticated users can execute operational health.");
  requireInvariant(contract?.monitoring?.service_role_can_execute_health === true, "Service role cannot execute operational health.");
  requireInvariant(contract?.pharmacy_privacy?.anon_can_read_pharmacies === false, "Anonymous users can read the pharmacy base table.");
  requireInvariant(contract?.pharmacy_privacy?.authenticated_can_read_pharmacies === false, "Authenticated users can read the pharmacy base table.");
  requireInvariant(contract?.pharmacy_privacy?.anon_can_read_recipients === false, "Anonymous users can read routing recipients.");
  requireInvariant(contract?.pharmacy_privacy?.authenticated_can_read_recipients === false, "Authenticated users can read routing recipients.");
  requireInvariant(contract?.geocode_governance?.review_column_count === contract?.geocode_governance?.expected_review_column_count, "Pharmacy GPS review columns drifted.");
  requireInvariant(contract?.geocode_governance?.expected_review_column_count === 4, "Pharmacy GPS review-column allowlist drifted.");
  requireInvariant(contract?.geocode_governance?.review_constraint_exists === true, "Pharmacy GPS review constraint is missing.");
  requireInvariant(contract?.geocode_governance?.review_constraint_validated === true, "Pharmacy GPS review constraint is not validated.");
  requireInvariant(contract?.geocode_governance?.unique_verified_place_index === true, "Verified Google Place IDs are not uniquely protected.");
  requireInvariant(contract?.geocode_governance?.verified_without_review_count === 0, "A dispatch-eligible pharmacy lacks durable GPS review evidence.");
  requireInvariant(contract?.contact_governance?.review_function_exists === true, "Pharmacy contact-review function is missing.");
  requireInvariant(contract?.contact_governance?.service_role_can_review === true, "Service role cannot review pharmacy contact changes.");
  requireInvariant(contract?.contact_governance?.anon_can_review === false, "Anonymous users can review pharmacy contact changes.");
  requireInvariant(contract?.contact_governance?.authenticated_can_review === false, "Pharmacy users can approve their own contact changes.");
  requireInvariant(contract?.contact_governance?.reviewed_without_evidence_count === 0, "A reviewed pharmacy contact request lacks operator evidence.");
  requireInvariant(contract?.contact_governance?.admin_verified_without_evidence_count === 0, "An administrator-verified pharmacy contact lacks operator evidence.");
  requireInvariant(contract?.member_contacts?.function_exists === true, "Member-owned pharmacy contact function is missing.");
  requireInvariant(contract?.member_contacts?.security_definer === true, "Member-owned pharmacy contact function does not enforce its privileged membership boundary.");
  requireInvariant(contract?.member_contacts?.search_path_locked === true, "Member-owned pharmacy contact function has a mutable search path.");
  requireInvariant(contract?.member_contacts?.authenticated_can_execute === true, "Pharmacy members cannot load their linked contacts.");
  requireInvariant(contract?.member_contacts?.anon_can_execute === false, "Anonymous users can execute member-owned pharmacy contact access.");
  requireInvariant(contract?.security_hardening?.atomic_otp_function_exists === true, "Atomic OTP issuance is missing.");
  requireInvariant(contract?.security_hardening?.atomic_otp_security_definer === true, "Atomic OTP issuance is not privileged server-side code.");
  requireInvariant(contract?.security_hardening?.atomic_otp_search_path_locked === true, "Atomic OTP issuance has a mutable search path.");
  requireInvariant(contract?.security_hardening?.atomic_otp_service_role_can_execute === true, "Service role cannot issue OTP challenges atomically.");
  requireInvariant(contract?.security_hardening?.atomic_otp_anon_can_execute === false, "Anonymous users can call atomic OTP issuance directly.");
  requireInvariant(contract?.security_hardening?.atomic_otp_authenticated_can_execute === false, "Authenticated users can call atomic OTP issuance directly.");
  requireInvariant(contract?.security_hardening?.geocode_approval_function_exists === true, "Version-bound geocode approval is missing.");
  requireInvariant(contract?.security_hardening?.geocode_approval_security_definer === true, "Version-bound geocode approval is not privileged server-side code.");
  requireInvariant(contract?.security_hardening?.geocode_approval_search_path_locked === true, "Version-bound geocode approval has a mutable search path.");
  requireInvariant(contract?.security_hardening?.geocode_approval_service_role_can_execute === true, "Service role cannot approve an exact geocode candidate version.");
  requireInvariant(contract?.security_hardening?.geocode_approval_anon_can_execute === false, "Anonymous users can approve pharmacy geocodes.");
  requireInvariant(contract?.security_hardening?.geocode_approval_authenticated_can_execute === false, "Pharmacy users can approve their own geocodes.");
  requireInvariant(contract?.security_hardening?.contact_retirement_trigger === true, "Retiring a pharmacy login contact does not revoke its authority atomically.");
  requireInvariant(contract?.security_hardening?.offer_product_write_trigger === true, "Offer items do not revalidate current product state.");
  requireInvariant(contract?.security_hardening?.offer_product_selection_trigger === true, "Offer selection does not revalidate current product state.");
  requireInvariant(contract?.security_hardening?.order_rate_limit_trigger === true, "Customer order churn is not database-rate-limited.");
  requireInvariant(contract?.security_hardening?.active_orders_complete_offer_filter === true, "Active-order reads can expose incomplete pharmacy offers.");
  requireInvariant(contract?.security_hardening?.selected_contact_complete_offer_guard === true, "Selected contact release is not bound to a complete offer.");
  requireInvariant(contract?.prescriptions?.bucket_exists === true, "Prescription Storage bucket is missing.");
  requireInvariant(contract?.prescriptions?.cleanup_claims_rls === true, "Prescription cleanup claims do not have RLS.");
  requireInvariant(contract?.realtime?.orders === true, "Orders are missing from Realtime publication.");
  requireInvariant(contract?.realtime?.offers === true, "Offers are missing from Realtime publication.");
  requireInvariant(contract?.realtime?.notifications === true, "Pharmacy notifications are missing from Realtime publication.");
  requireInvariant(contract?.api_surface?.function_count === contract?.api_surface?.expected_function_count, "MED+250 function count drifted.");
  requireInvariant(contract?.api_surface?.expected_function_count === 29, "MED+250 function allowlist count drifted.");
  requireInvariant(contract?.api_surface?.public_execute_count === 0, "PUBLIC can execute a MED+250 function.");
  requireInvariant(contract?.api_surface?.anonymous_security_definer_count === 0, "Unauthenticated clients can execute a privileged MED+250 function.");
  requireInvariant(contract?.api_surface?.mutable_security_definer_path_count === 0, "A privileged MED+250 function has a mutable search path.");
  requireInvariant(contract?.api_surface?.expected_authenticated_security_definer_count === 13, "Authenticated privileged-function allowlist drifted.");
  requireInvariant(contract?.api_surface?.missing_authenticated_security_definer_count === 0, "An expected authenticated MED+250 workflow function is missing or unavailable.");
  requireInvariant(contract?.api_surface?.unexpected_authenticated_security_definer_count === 0, "An unexpected privileged function is exposed to authenticated clients.");
  requireInvariant(contract?.table_surface?.table_count === contract?.table_surface?.expected_table_count, "MED+250 table count drifted.");
  requireInvariant(contract?.table_surface?.expected_table_count === 22, "MED+250 table allowlist count drifted.");
  requireInvariant(contract?.table_surface?.rls_disabled_count === 0, "A MED+250 table does not have RLS enabled.");
  requireInvariant(contract?.table_surface?.anonymous_select_count === 0, "Unauthenticated clients can select from a MED+250 table.");
  requireInvariant(contract?.table_surface?.expected_deny_by_default_count === 9, "Deny-by-default table allowlist drifted.");
  requireInvariant(contract?.table_surface?.missing_deny_by_default_count === 0, "A service-only MED+250 table is missing its deny-by-default boundary.");
  requireInvariant(contract?.table_surface?.unexpected_deny_by_default_count === 0, "An undocumented MED+250 table has RLS but no policy.");
  requireInvariant(contract?.table_surface?.expected_authenticated_select_count === 9, "Authenticated table allowlist drifted.");
  requireInvariant(contract?.table_surface?.missing_authenticated_select_count === 0, "An expected owner/member RLS table is unavailable.");
  requireInvariant(contract?.table_surface?.unexpected_authenticated_select_count === 0, "An unexpected MED+250 table is directly selectable by authenticated clients.");
  return failures;
}
