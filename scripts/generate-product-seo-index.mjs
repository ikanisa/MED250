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

function categoryFor(row) {
  const text = `${row.brand_name ?? ""} ${row.generic_name ?? ""} ${row.dosage_form ?? ""}`.toLowerCase();
  if (/paracetamol|diclofenac|ibuprofen|analges/.test(text)) return "Pain & fever";
  if (/cetirizine|loratadine|allerg/.test(text)) return "Allergy";
  if (/metformin|insulin|diabet/.test(text)) return "Diabetes care";
  if (/omeprazole|esomeprazole|antacid|digest/.test(text)) return "Digestive health";
  if (/baby|infant|diaper|nappy/.test(text)) return "Baby & family";
  if (/lotion|shampoo|tooth|skin|cosmetic|soap/.test(text)) return "Personal care";
  if (/vitamin|supplement|monitor|device|thermometer/.test(text)) return "Wellness";
  return "Medicines";
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
      category: categoryFor(row),
      regulatoryStatus: clean(row.regulatory_status) || "valid",
      registrationNumber: clean(row.registration_number),
    };
  });

await writeFile(destination, `${JSON.stringify(products)}\n`, "utf8");
console.log(`Wrote ${products.length} product SEO records.`);
