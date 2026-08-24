import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = path.join(projectRoot, "data/localization/locale-releases.json");
const inventoryPath = path.join(projectRoot, "data/localization/source-copy-inventory.json");

const translatableAttributes = new Set([
  "alt",
  "aria-label",
  "eyebrow",
  "imageAlt",
  "intro",
  "label",
  "pageDescription",
  "pageTitle",
  "placeholder",
  "title",
]);
const presentationProperties = new Set(["action", "description", "imageAlt", "label", "title"]);
const userMessageCalls = new Set([
  "announce",
  "setCaptchaError",
  "setCatalogueError",
  "setCheckoutError",
  "setCustomerMessage",
  "setCustomerOtpMessage",
  "setPortalError",
  "setPortalMessage",
  "setPrescriptionError",
]);
const highRiskPattern = /\b(?:availability|clinical|confirm|contact|customer|delivery|diagnos|dispens|doctor|final price|fulfil|health|location|medicine|momo|order|otp|payment|pharmac|prescri|privacy|product|request|stock|substitut|treatment|verify|whatsapp)\b/i;

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function decodeEntities(value) {
  return value
    .replaceAll("&apos;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function normalize(value) {
  return decodeEntities(value).replace(/\s+/g, " ").trim();
}

function localizable(value) {
  if (!value || !/\p{L}/u.test(value)) return false;
  if (/^(?:https?:\/\/|\/|#|\.|[a-z0-9_-]+\.[a-z0-9_-]+$)/i.test(value)) return false;
  if (/^(?:true|false|null|undefined|button|dialog|alert|status|polite|assertive|presentation|none)$/i.test(value)) return false;
  return true;
}

function templateText(node) {
  if (ts.isStringLiteralLike(node)) return normalize(node.text);
  if (ts.isTemplateExpression(node)) {
    let value = node.head.text;
    node.templateSpans.forEach((span, index) => { value += `{${index}}${span.literal.text}`; });
    return normalize(value);
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const pieces = [];
    const append = (part) => {
      if (ts.isStringLiteralLike(part)) pieces.push(part.text);
      else if (ts.isBinaryExpression(part) && part.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        append(part.left);
        append(part.right);
      } else pieces.push(`{${pieces.filter((piece) => /^\{\d+\}$/.test(piece)).length}}`);
    };
    append(node);
    return normalize(pieces.join(""));
  }
  return "";
}

function nearestFunctionName(node) {
  let current = node.parent;
  while (current) {
    if (ts.isFunctionDeclaration(current) && current.name) return current.name.text;
    if ((ts.isArrowFunction(current) || ts.isFunctionExpression(current)) && ts.isVariableDeclaration(current.parent) && ts.isIdentifier(current.parent.name)) {
      return current.parent.name.text;
    }
    current = current.parent;
  }
  return "module";
}

function classContext(node) {
  let current = node.parent;
  while (current) {
    if (ts.isJsxElement(current)) {
      const classAttribute = current.openingElement.attributes.properties.find(
        (attribute) => ts.isJsxAttribute(attribute) && attribute.name.text === "className" && attribute.initializer && ts.isStringLiteral(attribute.initializer),
      );
      if (classAttribute && ts.isJsxAttribute(classAttribute) && classAttribute.initializer && ts.isStringLiteral(classAttribute.initializer)) {
        return classAttribute.initializer.text;
      }
    }
    current = current.parent;
  }
  return "";
}

function surfaceFor(relativePath, node, value) {
  if (relativePath.includes("privacy") || relativePath.includes("terms") || /privacy|legal|payment boundary/i.test(value)) return "legal";
  if (relativePath.includes("error") || relativePath.includes("not-found") || relativePath.includes("loading")) return "system";
  if (relativePath.includes("pwa-manager")) return "pwa";
  if (relativePath.includes("google-map")) return "location";
  const context = `${nearestFunctionName(node)} ${classContext(node)} ${value}`;
  if (/portal|pharmacy desk|pharmacy portal|registered whatsapp/i.test(context)) return "pharmacy_portal";
  if (/offer|quote|my requests|confirmation/i.test(context)) return "status";
  if (/checkout|basket|order wizard|send availability/i.test(context)) return "request";
  if (/product detail|product card|prescription/i.test(context)) return "product";
  if (/catalog|search|filter|department|market-banner/i.test(context)) return "browse";
  return "shared";
}

function occurrenceKey(occurrence) {
  return `${occurrence.file}:${occurrence.line}:${occurrence.kind}:${occurrence.context}`;
}

function serializeLeafChildren(children) {
  const placeholders = [];
  let output = "";
  for (const child of children) {
    if (ts.isJsxText(child)) output += child.text;
    else if (ts.isJsxExpression(child) && child.expression) {
      const literal = templateText(child.expression);
      if (literal) output += literal;
      else {
        output += `{${placeholders.length}}`;
        placeholders.push(child.expression.getText());
      }
    }
  }
  return { text: normalize(output), placeholders };
}

function containsNestedJsx(children) {
  return children.some((child) => ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child));
}

function visibleChildSegments(children) {
  const segments = [];
  let current = [];
  const containsJsxDescendant = (node) => {
    let found = false;
    const visit = (child) => {
      if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) {
        found = true;
        return;
      }
      if (!found) ts.forEachChild(child, visit);
    };
    visit(node);
    return found;
  };
  const flush = () => {
    if (current.length) segments.push(current);
    current = [];
  };
  for (const child of children) {
    if (
      ts.isJsxElement(child)
      || ts.isJsxSelfClosingElement(child)
      || ts.isJsxFragment(child)
      || (ts.isJsxExpression(child) && child.expression && containsJsxDescendant(child.expression))
    ) flush();
    else current.push(child);
  }
  flush();
  return segments;
}

function collectExpressionVariants(expression, add, kind) {
  if (ts.isConditionalExpression(expression)) {
    collectExpressionVariants(expression.whenTrue, add, kind);
    collectExpressionVariants(expression.whenFalse, add, kind);
    return;
  }
  const text = templateText(expression);
  if (text) add(expression, kind, text, []);
}

function isCallArgumentProperty(node) {
  let current = node.parent;
  while (current && (ts.isObjectLiteralExpression(current) || ts.isArrayLiteralExpression(current) || ts.isParenthesizedExpression(current))) {
    current = current.parent;
  }
  return Boolean(current && ts.isCallExpression(current));
}

async function extractFile(relativePath, catalogById) {
  const absolutePath = path.join(projectRoot, relativePath);
  const source = await readFile(absolutePath, "utf8");
  const sourceFile = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const occurrences = [];

  const add = (node, kind, rawText, placeholders = []) => {
    const text = normalize(rawText);
    if (!localizable(text)) return;
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    occurrences.push({
      text,
      occurrence: {
        file: relativePath,
        line: line + 1,
        kind,
        context: nearestFunctionName(node),
        surface: surfaceFor(relativePath, node, text),
        placeholders,
      },
    });
  };

  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if ((node.expression.text === "marketplaceMessage" || node.expression.text === "marketplaceFormatMessage") && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        const id = node.arguments[0].text;
        const text = catalogById.get(id);
        if (text) add(node, "catalog_reference", text, []);
      } else if (userMessageCalls.has(node.expression.text) && node.arguments[0]) {
        collectExpressionVariants(node.arguments[0], add, "user_message_call");
      }
    }

    if (ts.isJsxAttribute(node) && translatableAttributes.has(String(node.name.text)) && node.initializer) {
      if (ts.isStringLiteral(node.initializer)) add(node, "jsx_attribute", node.initializer.text, []);
      else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        collectExpressionVariants(node.initializer.expression, add, "jsx_attribute");
      }
    }

    if (ts.isJsxElement(node)) {
      if (!containsNestedJsx(node.children)) {
        const serialized = serializeLeafChildren(node.children);
        add(node, "jsx_leaf", serialized.text, serialized.placeholders);
      } else {
        for (const segment of visibleChildSegments(node.children)) {
          const serialized = serializeLeafChildren(segment);
          add(segment[0] ?? node, "jsx_segment", serialized.text, serialized.placeholders);
        }
      }
      for (const child of node.children) {
        if (ts.isJsxExpression(child) && child.expression && ts.isConditionalExpression(child.expression)) {
          collectExpressionVariants(child.expression, add, "jsx_variant");
        }
      }
    }

    if (ts.isPropertyAssignment(node)) {
      const name = ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : "";
      if (presentationProperties.has(name) && !isCallArgumentProperty(node)) {
        const text = templateText(node.initializer);
        if (text) add(node, "presentation_property", text, []);
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { source, occurrences };
}

export async function buildSourceCopyInventory() {
  const registry = JSON.parse(await readFile(registryPath, "utf8"));
  const sourceCatalog = JSON.parse(await readFile(path.join(projectRoot, registry.source_catalog), "utf8"));
  const catalogById = new Map(Object.entries(sourceCatalog.messages));
  const catalogIdsByText = new Map();
  for (const [id, text] of catalogById) {
    const normalized = normalize(text);
    catalogIdsByText.set(normalized, [...(catalogIdsByText.get(normalized) ?? []), id]);
  }

  const grouped = new Map();
  const sourceFiles = [];
  for (const relativePath of registry.extraction_scope ?? []) {
    const { source, occurrences } = await extractFile(relativePath, catalogById);
    sourceFiles.push({ file: relativePath, sha256: digest(source) });
    for (const { text, occurrence } of occurrences) {
      const entry = grouped.get(text) ?? { text, occurrences: [] };
      if (!entry.occurrences.some((existing) => occurrenceKey(existing) === occurrenceKey(occurrence))) entry.occurrences.push(occurrence);
      grouped.set(text, entry);
    }
  }

  for (const text of catalogById.values()) {
    const normalized = normalize(text);
    if (!grouped.has(normalized)) grouped.set(normalized, { text: normalized, occurrences: [] });
  }

  const messages = [...grouped.values()].map((entry) => {
    const catalogIds = (catalogIdsByText.get(entry.text) ?? []).toSorted();
    const hardcodedOccurrences = entry.occurrences.filter(({ kind }) => kind !== "catalog_reference");
    const referencedCatalogIds = new Set(
      entry.occurrences
        .filter(({ kind }) => kind === "catalog_reference")
        .flatMap(() => catalogIds),
    );
    const risk = highRiskPattern.test(entry.text) ? "high" : "standard";
    return {
      id: catalogIds[0] ?? `inventory.${digest(entry.text).slice(0, 12)}`,
      source: entry.text,
      risk,
      catalog_ids: catalogIds,
      runtime_catalogued: referencedCatalogIds.size > 0,
      hardcoded: hardcodedOccurrences.length > 0,
      surfaces: [...new Set(entry.occurrences.map(({ surface }) => surface))].toSorted(),
      occurrences: entry.occurrences.toSorted((left, right) => occurrenceKey(left).localeCompare(occurrenceKey(right))),
    };
  }).toSorted((left, right) => left.id.localeCompare(right.id) || left.source.localeCompare(right.source));

  return {
    schema_version: 1,
    source_locale: registry.default_locale,
    catalog_version: sourceCatalog.version,
    source_files: sourceFiles.toSorted((left, right) => left.file.localeCompare(right.file)),
    summary: {
      source_file_count: sourceFiles.length,
      message_count: messages.length,
      catalog_message_count: catalogById.size,
      runtime_catalogued_message_count: messages.filter(({ runtime_catalogued }) => runtime_catalogued).length,
      hardcoded_message_count: messages.filter(({ hardcoded }) => hardcoded).length,
      high_risk_hardcoded_message_count: messages.filter(({ hardcoded, risk }) => hardcoded && risk === "high").length,
      inventory_only_message_count: messages.filter(({ catalog_ids }) => catalog_ids.length === 0).length,
    },
    messages,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inventory = await buildSourceCopyInventory();
  if (process.argv.includes("--write")) {
    await writeFile(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify(inventory.summary, null, 2));
}
