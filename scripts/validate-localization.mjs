import { access, readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { buildSourceCopyInventory } from "./extract-localization-inventory.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = path.join(projectRoot, "data/localization/locale-releases.json");
const allowedStatuses = new Set(["approved_source", "approved_translation", "awaiting_qualified_translation", "deferred"]);
const allowedRouteModes = new Set(["default_unprefixed", "localized_prefix", "blocked_until_approved"]);
const requiredReviewFields = ["translation_provider", "glossary_version", "clinical_reviewer", "legal_reviewer", "reviewed_at"];

async function loadJson(relativePath) {
  const absolutePath = path.join(projectRoot, relativePath);
  const content = await readFile(absolutePath, "utf8");
  return JSON.parse(content);
}

export async function validateLocalizationRegistry(registry) {
  const errors = [];
  const releases = Array.isArray(registry?.releases) ? registry.releases : [];
  const requiredJourneys = registry?.required_journeys && typeof registry.required_journeys === "object"
    ? registry.required_journeys
    : {};
  const requiredIds = new Set(Object.values(requiredJourneys).flat());
  const highRiskJourneys = new Set(registry?.high_risk_journeys ?? []);
  const highRiskIds = new Set(
    Object.entries(requiredJourneys)
      .filter(([journey]) => highRiskJourneys.has(journey))
      .flatMap(([, ids]) => ids),
  );

  if (registry?.schema_version !== 1) errors.push("schema_version must be 1");
  if (!releases.length) errors.push("at least one locale release is required");
  if (!requiredIds.size) errors.push("required_journeys must contain message ids");

  const locales = new Set();
  const segments = new Set();
  let defaultRelease = null;
  let sourceMessageCount = 0;
  let publicLocaleCount = 0;

  for (const release of releases) {
    if (!release?.locale || typeof release.locale !== "string") {
      errors.push("every release must have a locale");
      continue;
    }
    if (locales.has(release.locale)) errors.push(`duplicate locale: ${release.locale}`);
    locales.add(release.locale);
    if (!/^[a-z]{2,3}-[A-Z]{2}$/.test(release.locale)) errors.push(`${release.locale}: locale must be BCP 47 language-region form`);
    if (!/^[a-z]{2,3}$/.test(release.segment ?? "")) errors.push(`${release.locale}: invalid URL segment`);
    if (segments.has(release.segment)) errors.push(`duplicate locale segment: ${release.segment}`);
    segments.add(release.segment);
    if (!allowedStatuses.has(release.status)) errors.push(`${release.locale}: unsupported status ${release.status}`);
    if (!allowedRouteModes.has(release.route_mode)) errors.push(`${release.locale}: unsupported route_mode ${release.route_mode}`);

    if (release.locale === registry.default_locale) defaultRelease = release;
    if (release.public) publicLocaleCount += 1;

    if (!release.public) {
      if (release.route_mode !== "blocked_until_approved") errors.push(`${release.locale}: non-public locale must fail closed`);
      if (release.runtime_ready) errors.push(`${release.locale}: non-public locale cannot be runtime-ready`);
      if (release.catalog) errors.push(`${release.locale}: non-public locale catalog must not be runtime-loadable`);
      continue;
    }

    if (!release.runtime_ready) errors.push(`${release.locale}: public locale must be runtime-ready`);
    if (release.locale !== registry.default_locale && !registry.localized_renderer_enabled) {
      errors.push(`${release.locale}: localized renderer must be enabled before publication`);
    }

    if (!release.catalog) {
      errors.push(`${release.locale}: public locale requires a catalog`);
      continue;
    }
    if (!new Set(["approved_source", "approved_translation"]).has(release.status)) {
      errors.push(`${release.locale}: public locale must be approved`);
    }

    let catalog;
    try {
      catalog = await loadJson(release.catalog);
    } catch (error) {
      errors.push(`${release.locale}: catalog cannot be read (${error.message})`);
      continue;
    }
    if (catalog.locale !== release.locale) errors.push(`${release.locale}: catalog locale mismatch`);
    const catalogIds = new Set(Object.keys(catalog.messages ?? {}));
    if (release.locale === registry.default_locale) sourceMessageCount = catalogIds.size;
    for (const id of requiredIds) {
      if (!catalogIds.has(id) || !String(catalog.messages[id] ?? "").trim()) errors.push(`${release.locale}: missing required message ${id}`);
    }

    if (release.status === "approved_translation") {
      for (const field of requiredReviewFields) {
        if (!String(release[field] ?? "").trim()) errors.push(`${release.locale}: approved translation requires ${field}`);
      }
      for (const id of highRiskIds) {
        if (!catalogIds.has(id)) errors.push(`${release.locale}: missing reviewed high-risk message ${id}`);
      }
    }
  }

  if (!defaultRelease) errors.push(`default locale ${registry.default_locale} is missing`);
  else {
    if (!defaultRelease.public) errors.push("default locale must be public");
    if (defaultRelease.route_mode !== "default_unprefixed") errors.push("default locale must use the unprefixed canonical route");
    if (defaultRelease.catalog !== registry.source_catalog) errors.push("default locale catalog must equal source_catalog");
  }

  return {
    valid: errors.length === 0,
    localeCount: releases.length,
    publicLocaleCount,
    requiredMessageCount: requiredIds.size,
    highRiskMessageCount: highRiskIds.size,
    sourceMessageCount,
    errors,
  };
}

export async function validateLocalizationFiles() {
  const registry = JSON.parse(await readFile(registryPath, "utf8"));
  await access(path.join(projectRoot, registry.source_catalog));
  await access(path.join(projectRoot, registry.runtime_catalog));
  const result = await validateLocalizationRegistry(registry);
  const sourceCatalog = await loadJson(registry.source_catalog);
  const runtimeCatalog = await loadJson(registry.runtime_catalog);
  const committedInventory = JSON.parse(await readFile(path.join(projectRoot, registry.source_copy_inventory), "utf8"));
  const generatedInventory = await buildSourceCopyInventory();
  const errors = [...result.errors];

  if (runtimeCatalog.locale !== registry.default_locale) {
    errors.push("runtime catalog locale must equal the default locale");
  }
  if (runtimeCatalog.version !== sourceCatalog.version) {
    errors.push("runtime and source catalog versions must match");
  }
  for (const [id, message] of Object.entries(runtimeCatalog.messages ?? {})) {
    if (sourceCatalog.messages?.[id] !== message) {
      errors.push(`runtime message ${id} must exactly match the governed source catalog`);
    }
  }

  if (!isDeepStrictEqual(committedInventory, generatedInventory)) {
    errors.push("source-copy inventory is stale; run npm run localization:inventory");
  }
  if (committedInventory.summary?.inventory_only_message_count !== 0) {
    errors.push("every inventoried source message must be present in the source catalog");
  }
  const extractionBudget = registry.runtime_extraction ?? {};
  const hardcodedCount = committedInventory.summary?.hardcoded_message_count ?? Number.POSITIVE_INFINITY;
  const highRiskHardcodedCount = committedInventory.summary?.high_risk_hardcoded_message_count ?? Number.POSITIVE_INFINITY;
  if (!Number.isInteger(extractionBudget.max_hardcoded_messages) || extractionBudget.max_hardcoded_messages < 0) {
    errors.push("runtime_extraction.max_hardcoded_messages must be a non-negative integer");
  } else if (hardcodedCount > extractionBudget.max_hardcoded_messages) {
    errors.push(`hardcoded source-copy count ${hardcodedCount} exceeds the regression budget ${extractionBudget.max_hardcoded_messages}`);
  }
  if (!Number.isInteger(extractionBudget.max_high_risk_hardcoded_messages) || extractionBudget.max_high_risk_hardcoded_messages < 0) {
    errors.push("runtime_extraction.max_high_risk_hardcoded_messages must be a non-negative integer");
  } else if (highRiskHardcodedCount > extractionBudget.max_high_risk_hardcoded_messages) {
    errors.push(`high-risk hardcoded source-copy count ${highRiskHardcodedCount} exceeds the regression budget ${extractionBudget.max_high_risk_hardcoded_messages}`);
  }
  const highRiskHardcodedBySurface = {};
  for (const message of committedInventory.messages ?? []) {
    if (message.risk !== "high" || !message.hardcoded) continue;
    for (const occurrence of message.occurrences ?? []) {
      if (occurrence.kind === "catalog_reference") continue;
      highRiskHardcodedBySurface[occurrence.surface] ??= new Set();
      highRiskHardcodedBySurface[occurrence.surface].add(message.id);
    }
  }
  for (const [surface, budget] of Object.entries(extractionBudget.max_high_risk_hardcoded_by_surface ?? {})) {
    if (!Number.isInteger(budget) || budget < 0) {
      errors.push(`runtime_extraction.max_high_risk_hardcoded_by_surface.${surface} must be a non-negative integer`);
      continue;
    }
    const count = highRiskHardcodedBySurface[surface]?.size ?? 0;
    if (count > budget) errors.push(`${surface} high-risk hardcoded source-copy count ${count} exceeds the regression budget ${budget}`);
  }
  const hasPublicTranslation = registry.releases.some((release) => release.public && release.locale !== registry.default_locale);
  if (hasPublicTranslation && committedInventory.summary?.hardcoded_message_count !== 0) {
    errors.push("all runtime copy must use catalog references before a translated locale can be public");
  }

  return {
    ...result,
    valid: errors.length === 0,
    inventoryMessageCount: committedInventory.summary?.message_count ?? 0,
    runtimeCatalogMessageCount: Object.keys(runtimeCatalog.messages ?? {}).length,
    runtimeCataloguedMessageCount: committedInventory.summary?.runtime_catalogued_message_count ?? 0,
    hardcodedMessageCount: committedInventory.summary?.hardcoded_message_count ?? 0,
    highRiskHardcodedMessageCount: committedInventory.summary?.high_risk_hardcoded_message_count ?? 0,
    highRiskHardcodedBySurface: Object.fromEntries(
      Object.entries(highRiskHardcodedBySurface).map(([surface, ids]) => [surface, ids.size]),
    ),
    errors,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await validateLocalizationFiles();
  console.log(JSON.stringify(result, null, 2));
  if (!result.valid) process.exitCode = 1;
}
