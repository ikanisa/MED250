// Every public product-image query uses the same fail-closed D1 predicate.
// Keep the image alias stable so catalogue, media and order reads cannot drift.
export const ACTIVE_PUBLIC_PRODUCT_IMAGE_SQL = `
  image.approved = 1
  and image.rights_verified = 1
  and exists (
    select 1
    from med250_media_rights_policies policy
    where policy.id = image.rights_policy_id
      and policy.status = 'active'
      and policy.effective_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      and (policy.expires_at is null or policy.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`;
