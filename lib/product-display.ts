const PRESERVED_CATALOGUE_ACRONYMS = new Map([
  "aids",
  "bp",
  "ep",
  "hiv",
  "im",
  "inn",
  "iv",
  "ors",
  "sp",
  "usp",
].map((value) => [value, value.toUpperCase()]));

const PROHIBITED_MARKETPLACE_REFERENCE = /\bamazon(?:\.com|as)?\b/giu;

export function removeProhibitedMarketplaceReference(value: string) {
  return value
    .normalize("NFKC")
    .replace(/\uFFFD/gu, " ")
    .replace(PROHIBITED_MARKETPLACE_REFERENCE, " ")
    .replace(/\s+([,;:.])/gu, "$1")
    .replace(/\s+/g, " ")
    .replace(/^[\s|,;:–—-]+|[\s|,;:–—-]+$/gu, "")
    .trim();
}

function clipAtWordBoundary(value: string, maximumLength: number) {
  if (value.length <= maximumLength) return value;
  const prefix = value.slice(0, maximumLength + 1);
  const lastWordBoundary = prefix.lastIndexOf(" ");
  return prefix.slice(0, lastWordBoundary >= Math.floor(maximumLength * .6) ? lastWordBoundary : maximumLength).trimEnd();
}

export function officialCatalogueTitle(value: string) {
  return removeProhibitedMarketplaceReference(value);
}

/**
 * Keeps mixed-case source names untouched. Source rows that are entirely in
 * capitals receive a restrained sentence-case presentation, while the exact
 * official value remains available separately on the product detail page.
 */
export function customerProductTitle(value: string) {
  const official = officialCatalogueTitle(value);
  if (!official) return official;
  const letters = official.match(/\p{L}/gu) ?? [];
  const uppercaseLetters = letters.filter((letter) => /\p{Lu}/u.test(letter)).length;
  const predominantlyUppercase = uppercaseLetters >= 4 && uppercaseLetters / Math.max(letters.length, 1) >= 0.75;
  const cased = /^[A-Z0-9]{2,4}$/.test(official)
    ? official
    : predominantlyUppercase
      ? official
        .toLocaleLowerCase("en")
        .replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase("en"))
        .replace(/\b[a-z]+\b/gi, (word) => PRESERVED_CATALOGUE_ACRONYMS.get(word.toLocaleLowerCase("en")) ?? word)
      : official;
  if (cased.length <= 120) return cased;
  const firstClause = cased.split(/[,;]|\s[-–—]\s/, 1)[0].trim();
  if (firstClause.length >= 28 && firstClause.length <= 120) return firstClause;
  return clipAtWordBoundary(cased, 120);
}
