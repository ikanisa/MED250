import { readFile, writeFile } from "node:fs/promises";

const source = new URL("../public/data/rwanda-fda-products-july-2026.csv", import.meta.url);
const destination = new URL("../data/product-seo-index.json", import.meta.url);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted && char === '"' && text[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') quoted = !quoted;
    else if (!quoted && char === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") cell += char;
  }
  if (cell || row.length) rows.push([...row, cell]);
  const headers = rows.shift() ?? [];
  return rows
    .filter((values) => values.length === headers.length)
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index]])));
}

function clean(value) {
  const text = String(value ?? "").trim();
  return !text || /^(?:—+|-+|n\/?a|null)$/i.test(text) ? "" : text;
}

const rows = parseCsv(await readFile(source, "utf8"));
const products = rows
  .filter((row) => row.regulatory_status !== "expired")
  .map((row, index) => {
    const serial = Number(row.source_serial || index + 1);
    const generic = clean(row.generic_name);
    const brand = clean(row.brand_name) || generic || clean(row.registration_number) || "Registered product";
    return {
      id: `rwanda-fda-hm-${String(serial).padStart(4, "0")}`,
      brand,
      generic,
      strength: clean(row.strength),
      form: clean(row.dosage_form) || "Registered product",
      packSize: clean(row.pack_size),
      manufacturer: clean(row.manufacturer),
      manufacturerCountry: clean(row.manufacturer_country),
      category: clean(row.category) || "Medicines",
      regulatoryStatus: clean(row.regulatory_status) || "valid",
      registrationNumber: clean(row.registration_number),
    };
  });

await writeFile(destination, `${JSON.stringify(products)}\n`, "utf8");
console.log(`Wrote ${products.length} product SEO records.`);
