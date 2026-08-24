import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildSourceCopyInventory } from "./extract-localization-inventory.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = path.join(projectRoot, "data/localization/locale-releases.json");
const inventoryPath = path.join(projectRoot, "data/localization/source-copy-inventory.json");

function nextVersion(version) {
  const match = /^(.*\.)(\d+)$/.exec(version);
  if (!match) throw new Error(`Catalog version must end in a numeric revision: ${version}`);
  return `${match[1]}${Number(match[2]) + 1}`;
}

const registry = JSON.parse(await readFile(registryPath, "utf8"));
const catalogPath = path.join(projectRoot, registry.source_catalog);
const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
const inventory = await buildSourceCopyInventory();
const promoted = [];

for (const message of inventory.messages) {
  if (message.catalog_ids.length) continue;
  catalog.messages[message.id] = message.source;
  promoted.push(message.id);
}

if (promoted.length) {
  catalog.version = nextVersion(catalog.version);
  catalog.messages = Object.fromEntries(Object.entries(catalog.messages).toSorted(([left], [right]) => left.localeCompare(right)));
  await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  const refreshedInventory = await buildSourceCopyInventory();
  await writeFile(inventoryPath, `${JSON.stringify(refreshedInventory, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify({ promoted: promoted.length, catalogVersion: catalog.version, catalogMessages: Object.keys(catalog.messages).length }, null, 2));
