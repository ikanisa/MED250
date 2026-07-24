const HELD_PUBLIC_MEDIA_PRODUCT_IDS = new Set([
  // A regulated suppository record was observed with oral-suspension bottles.
  // Keep the storefront fail-closed until product-specific media is approved.
  "rwanda-fda-hm-1594",
]);

export function isPublicProductMediaHeld(productId: string): boolean {
  return HELD_PUBLIC_MEDIA_PRODUCT_IDS.has(productId.trim().toLowerCase());
}

export function governPublicProductMedia(
  productId: string,
  imageUrl: string | null,
  imageUrls: string[],
): { imageUrl: string | null; imageUrls: string[] } {
  if (isPublicProductMediaHeld(productId)) {
    return { imageUrl: null, imageUrls: [] };
  }

  return { imageUrl, imageUrls };
}
