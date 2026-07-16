"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js/min";
import {
  ArrowRight,
  Bell,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock3,
  Cross,
  FileText,
  Grid3X3,
  HeartPulse,
  List,
  LoaderCircle,
  LocateFixed,
  MapPin,
  Menu,
  MessageCircle,
  Minus,
  PackageCheck,
  Pause,
  Play,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  Store,
  Upload,
  WifiOff,
  X,
} from "lucide-react";
import BrandLogo from "./brand-logo";
import {
  backendConfigured,
  closeOrder,
  createOrder,
  deletePrescription,
  ensureAnonymousCustomer,
  hasAnonymousCustomerSession,
  hasPermanentPharmacySession,
  loadCatalogue,
  loadCatalogueTaxonomy,
  loadCustomerProfile,
  loadMyActiveOrders,
  loadMyPharmacies,
  loadMyPharmacyContacts,
  loadOffers,
  loadPharmacyRequests,
  loadPharmacySelectedOrders,
  loadSelectedContact,
  normalizeDawaNearError,
  requestPharmacyWhatsappOtp,
  requestPharmacyContactEdit,
  searchCatalogue,
  selectOffer,
  signOutPharmacy,
  submitOffer,
  subscribeToOffers,
  subscribeToPharmacyNotifications,
  verifyPharmacyWhatsappOtp,
  uploadPrescription,
  type ActiveOrder,
  type CreateOrderInput,
  type OrderOffer,
  type PharmacyMembership,
  type PharmacyContact,
  type PharmacyContactEdit,
  type PharmacyRequest,
  type PharmacyRequestItem,
  type PharmacySelectedOrder,
  type Product,
  type CatalogueTaxonomyRow,
} from "../lib/dawanear-client";
import { getPharmacySupabase } from "../lib/supabase";
import {
  boundedCatalogueQuery,
  catalogueFormGroup,
  indexCatalogueProduct,
  MAX_CATALOGUE_QUERY_LENGTH,
  searchCatalogueProduct,
} from "../lib/catalogue-search";
import { trackMarketplaceEvent } from "../lib/marketplace-observability";
import {
  NON_PRESCRIPTION_TAXONOMY,
  backendCategoryFor,
  isNonPrescriptionTaxonomyFilter,
  nonPrescriptionTaxonomyForProduct,
  taxonomyFilterDepartment,
  taxonomyOptionValue,
} from "../lib/non-prescription-taxonomy";
import Turnstile from "./turnstile";
import GoogleMapLocationPicker, { type MapCoordinates } from "./google-map-location-picker";

type CartItem = Product & { quantity: number; substitutesAllowed: boolean };
type Coordinates = MapCoordinates;
type SelectedContact = { pharmacyName: string; whatsapp: string | null; momoCode: string | null };
type PortalTab = "requests" | "profile";
type CheckoutStep = 1 | 2 | 3;
type MarketplaceProps = {
  initialCategory?: string;
  pageTitle?: string;
  pageDescription?: string;
  pageImage?: string;
  showDepartments?: boolean;
  initialProductId?: string;
  initialProduct?: Product;
  initialProducts?: Product[];
  initialTaxonomy?: CatalogueTaxonomyRow[];
};
type PendingOrderAttempt = {
  clientRequestId: string;
  prescriptionPath: string | null;
  rpcAttempted: boolean;
  payload: Omit<CreateOrderInput, "clientRequestId" | "prescriptionPath">;
};
type FeedbackToast = { id: number; message: string; tone: "success" | "info" };
type CustomerPreferences = {
  whatsappCountry: CountryCode;
  whatsappNational: string;
  deliveryPreference: "pickup" | "delivery" | "either";
  coordinates: Coordinates | null;
  locationLabel: string;
};

const MED250_ADMIN_WHATSAPP = "250795588248";
const CART_STORAGE_KEY = "med250-order-basket-v1";
const CUSTOMER_PREFERENCES_STORAGE_KEY = "med250-customer-preferences-v1";
const INITIAL_PRODUCT_COUNT = 24;
const PRODUCT_BATCH_SIZE = 48;
const CHECKOUT_STEPS: Array<{ id: CheckoutStep; label: string }> = [
  { id: 1, label: "Review" },
  { id: 2, label: "Details" },
  { id: 3, label: "Confirm" },
];

const countryDisplayNames = new Intl.DisplayNames(["en"], { type: "region" });
const whatsappCountries = getCountries()
  .map((country) => ({
    country,
    name: countryDisplayNames.of(country) ?? country,
    callingCode: getCountryCallingCode(country),
  }))
  .toSorted((left, right) => left.name.localeCompare(right.name));

const departmentPresentation = [
  {
    department: "Medicines",
    label: "Medicines",
    href: "/category/medicines",
    title: "Medicines",
    description: "Search the current medicine register by brand, ingredient, strength, dosage form, or pack size.",
    action: "Shop medicines",
    image: "/marketplace/category-medicines.webp",
    imageAlt: "Medicine box and blister pack",
  },
  {
    department: "Beauty & Personal Care",
    label: "Beauty & Personal Care",
    href: "/category/personal-care",
    title: "Beauty & Personal Care",
    description: "Browse the current source-backed beauty and personal care catalogue.",
    action: "Shop beauty & care",
    image: "/marketplace/category-personal-care.webp",
    imageAlt: "Beauty and personal care products",
  },
  {
    department: "Baby",
    label: "Baby",
    href: "/category/baby-family",
    title: "Baby",
    description: "Browse the current source-backed baby product catalogue.",
    action: "Shop baby",
    image: "/marketplace/category-baby-family.webp",
    imageAlt: "Baby care products",
  },
  {
    department: "Health & Household",
    label: "Health & Household",
    href: "/category/wellness",
    title: "Health & Household",
    description: "Browse the current source-backed health and household catalogue.",
    action: "Shop health & household",
    image: "/marketplace/category-wellness-devices.webp",
    imageAlt: "Health and household products",
  },
] as const;
const legacyNonPrescriptionCategories = new Set(NON_PRESCRIPTION_TAXONOMY.map(({ legacyCategory }) => legacyCategory));
const accentClasses = ["coral", "blue", "mint", "violet", "amber"];
const rwf = new Intl.NumberFormat("en-RW");
const configuredMarketplaceMode = process.env.NEXT_PUBLIC_MED250_DEPLOYMENT_MODE || process.env.NEXT_PUBLIC_MARKETPLACE_MODE;
const marketplaceMode = new Set(["preview", "catalog", "live"]).has(configuredMarketplaceMode ?? "")
  ? configuredMarketplaceMode as "preview" | "catalog" | "live"
  : "preview";
const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? "";
const googleMapsBrowserKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY?.trim() ?? "";

function productMatchesCategory(product: Product, category: string) {
  if (category === "All products") return true;
  if (category === "Medicines") return product.category === "Medicines";
  if (category.startsWith("Medicines / ")) {
    return product.category === "Medicines" && product.subcategory === category.slice("Medicines / ".length);
  }
  const taxonomy = nonPrescriptionTaxonomyForProduct(product);
  const filterDepartment = taxonomyFilterDepartment(category);
  if (filterDepartment) {
    if (!taxonomy || taxonomy.department !== filterDepartment.label) return false;
    return category === filterDepartment.label || taxonomy.subcategoryValue === category;
  }
  return product.category === category;
}

function displayCategory(product: Product) {
  return nonPrescriptionTaxonomyForProduct(product)?.subcategory ?? product.category;
}

function CategoryOptions({ taxonomy }: { taxonomy: CatalogueTaxonomyRow[] }) {
  const grouped = new Map<string, CatalogueTaxonomyRow[]>();
  taxonomy.forEach((row) => grouped.set(row.department, [...(grouped.get(row.department) ?? []), row]));
  const medicines = grouped.get("Medicines") ?? [];
  const nonPrescription = NON_PRESCRIPTION_TAXONOMY
    .map((department) => ({ department, rows: grouped.get(department.label) ?? [] }))
    .filter(({ rows }) => rows.length > 0);
  return <>
    <option value="All products">All Categories</option>
    {medicines.length ? <optgroup label="Medicines">
      {medicines.some((row) => !row.subcategory) ? <option value="Medicines">Medicines</option> : null}
      {medicines.filter((row) => row.subcategory).map((row) => <option key={`Medicines-${row.subcategory}`} value={taxonomyOptionValue("Medicines", row.subcategory!)}>{row.subcategory}</option>)}
    </optgroup> : null}
    {nonPrescription.map(({ department, rows }) => <optgroup label={department.label} key={department.label}>
      <option value={department.label}>All {department.label}</option>
      {rows.filter((row) => row.subcategory).map((row) => <option key={`${department.label}-${row.subcategory}`} value={taxonomyOptionValue(department.label, row.subcategory!)}>{row.subcategory}</option>)}
    </optgroup>)}
  </>;
}

function catalogueText(value: string | undefined) {
  const text = value?.trim() ?? "";
  return !text || /^(?:—+|-+|n\/?a|null)$/i.test(text) ? "" : text;
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
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
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const headers = rows.shift() ?? [];
  return rows
    .filter((values) => values.length === headers.length)
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index]])));
}

function fallbackProduct(row: Record<string, string>, index: number): Product {
  const serial = Number(row.source_serial || index + 1);
  const brand = catalogueText(row.brand_name);
  const generic = catalogueText(row.generic_name);
  const strength = catalogueText(row.strength);
  const dosageForm = catalogueText(row.dosage_form);
  const packSize = catalogueText(row.pack_size);
  const category = catalogueText(row.category) || "Medicines";
  return {
    id: `rwanda-fda-hm-${String(serial).padStart(4, "0")}`,
    brand: brand || generic || catalogueText(row.registration_number),
    generic,
    strength,
    form: dosageForm,
    packSize,
    manufacturer: catalogueText(row.manufacturer),
    manufacturerCountry: catalogueText(row.manufacturer_country),
    registrationNumber: catalogueText(row.registration_number),
    category,
    productType: "human_medicine",
    prescriptionStatus: legacyNonPrescriptionCategories.has(category) ? "non_prescription" : "unclassified",
    regulatoryStatus: row.regulatory_status || "valid",
    min: 0,
    max: 0,
    priceContributors: 0,
    indicativePriceRwf: 0,
    priceIsIndicative: false,
    indicativePriceBasis: "",
    indicativePriceSourceUrl: null,
    indicativePriceUpdatedAt: null,
    imageUrl: null,
    isOrderable: ["valid", "active", "expiring_soon"].includes((row.regulatory_status || "valid").toLowerCase()),
    accent: accentClasses[index % accentClasses.length],
  };
}

function ProductVisual({ product, small = false, eager = false, imageUrl }: { product: Product; small?: boolean; eager?: boolean; imageUrl?: string | null }) {
  const resolvedImageUrl = imageUrl ?? product.imageUrl ?? product.imageUrls?.[0] ?? null;
  if (!resolvedImageUrl) return null;
  return (
    <div className={`dosage-art ${product.accent ?? "mint"} ${small ? "small" : ""}`} aria-hidden="true">
      <Image src={resolvedImageUrl} alt="" width={small ? 54 : 170} height={small ? 44 : 128} loading={eager ? "eager" : "lazy"} unoptimized />
      {!small && product.form ? <span>{product.form.split(" · ")[0]}</span> : null}
    </div>
  );
}

const productGallerySlides = [
  { label: "Front view", className: "front" },
  { label: "Left angle", className: "left-angle" },
  { label: "Right angle", className: "right-angle" },
] as const;

function ProductGallery({ product }: { product: Product }) {
  const [activeSlide, setActiveSlide] = useState(0);
  const [autoRotate, setAutoRotate] = useState(true);
  const touchStartX = useRef<number | null>(null);
  const approvedImages = useMemo(() => Array.from(new Set([...(product.imageUrls ?? []), product.imageUrl].filter((url): url is string => Boolean(url)))), [product.imageUrl, product.imageUrls]);

  useEffect(() => {
    if (approvedImages.length !== 3 || !autoRotate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    const timer = window.setInterval(() => setActiveSlide((current) => (current + 1) % approvedImages.length), 4800);
    return () => window.clearInterval(timer);
  }, [approvedImages.length, autoRotate, product.id]);

  function moveSlide(direction: number) {
    setAutoRotate(false);
    setActiveSlide((current) => (current + direction + productGallerySlides.length) % productGallerySlides.length);
  }

  function selectSlide(index: number) {
    setAutoRotate(false);
    setActiveSlide(index);
  }

  if (approvedImages.length !== 3) return null;

  return <section className="product-gallery" aria-label={`${product.brand} image gallery`}>
    <div className="product-gallery-thumbnails" role="group" aria-label="Choose product view">
      {productGallerySlides.map((slide, index) => <button
        type="button"
        className={`product-gallery-thumbnail ${slide.className}`}
        aria-label={`Show ${slide.label.toLowerCase()}`}
        aria-controls="product-gallery-stage"
        aria-pressed={index === activeSlide}
        onClick={() => selectSlide(index)}
        key={slide.label}
      >
        <ProductVisual product={product} small eager={index === 0} imageUrl={approvedImages[index % Math.max(approvedImages.length, 1)]} />
        <span>{slide.label}</span>
      </button>)}
    </div>
    <div className="product-gallery-stage-shell">
      <div
        className="product-gallery-stage"
        id="product-gallery-stage"
        aria-live="polite"
        aria-roledescription="carousel"
        aria-label={`${product.brand} product views`}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") moveSlide(-1);
          if (event.key === "ArrowRight") moveSlide(1);
        }}
        onTouchStart={(event) => { touchStartX.current = event.touches[0]?.clientX ?? null; }}
        onTouchEnd={(event) => {
          if (touchStartX.current == null) return;
          const distance = (event.changedTouches[0]?.clientX ?? touchStartX.current) - touchStartX.current;
          if (Math.abs(distance) > 42) moveSlide(distance > 0 ? -1 : 1);
          touchStartX.current = null;
        }}
      >
        {productGallerySlides.map((slide, index) => <div className={`product-gallery-slide ${slide.className}${index === activeSlide ? " active" : ""}`} aria-hidden={index !== activeSlide} key={slide.label}>
          <ProductVisual product={product} eager={index === 0} imageUrl={approvedImages[index % Math.max(approvedImages.length, 1)]} />
          <span className="sr-only">{slide.label}</span>
        </div>)}
      </div>
      <button type="button" className="product-gallery-arrow previous" onClick={() => moveSlide(-1)} aria-label="Show previous product image"><ChevronLeft size={21} /></button>
      <button type="button" className="product-gallery-arrow next" onClick={() => moveSlide(1)} aria-label="Show next product image"><ChevronRight size={21} /></button>
      <div className="product-gallery-dots" aria-label="Product image position">
        {productGallerySlides.map((slide, index) => <button type="button" aria-label={`Show ${slide.label.toLowerCase()}`} aria-current={index === activeSlide ? "true" : undefined} onClick={() => selectSlide(index)} key={slide.label} />)}
      </div>
    </div>
    <div className="product-gallery-status">
      <span aria-live="polite">{activeSlide + 1} / {productGallerySlides.length}</span>
      <button type="button" aria-pressed={autoRotate} onClick={() => setAutoRotate((current) => !current)} aria-label={autoRotate ? "Pause automatic gallery rotation" : "Resume automatic gallery rotation"}>
        {autoRotate ? <Pause size={14} /> : <Play size={14} />}
        {autoRotate ? "Auto-rotating" : "Rotation paused"}
      </button>
    </div>
  </section>;
}

function ProductDetailsList({ product }: { product: Product }) {
  const rows = [
    product.strength ? { label: "Strength", value: product.strength, icon: HeartPulse } : null,
    product.form ? { label: "Form", value: product.form, icon: Cross } : null,
    product.packSize ? { label: "Pack", value: product.packSize, icon: PackageCheck } : null,
    product.manufacturer || product.manufacturerCountry ? { label: "Manufacturer", value: [product.manufacturer, product.manufacturerCountry].filter(Boolean).join(" · "), icon: Store } : null,
    product.registrationNumber ? { label: "Rwanda FDA registration", value: product.registrationNumber, icon: ShieldCheck } : null,
    prescriptionLabel(product.prescriptionStatus) ? { label: "Prescription", value: prescriptionLabel(product.prescriptionStatus), icon: FileText } : null,
  ].filter((row): row is NonNullable<typeof row> => Boolean(row));

  if (!rows.length) return null;
  return <dl className="product-specification-list">
    {rows.map((row) => {
      const Icon = row.icon;
      return <div key={row.label}><Icon size={19} aria-hidden="true" /><dt>{row.label}</dt><dd>{row.value}</dd></div>;
    })}
  </dl>;
}

function CatalogueSkeleton() {
  return <div className="catalogue-skeleton" role="status" aria-live="polite" aria-label="Loading products">
    {Array.from({ length: 8 }, (_, index) => <div className="product-card-skeleton" aria-hidden="true" key={index}><span /><i /><i /><b /></div>)}
    <span className="sr-only">Searching the catalogue and preparing product results.</span>
  </div>;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleDateString("en-RW", { day: "numeric", month: "short", year: "numeric" });
}

function hasPriceData(product: Pick<Product, "indicativePriceRwf" | "priceIsIndicative">) {
  return product.priceIsIndicative && Number.isFinite(product.indicativePriceRwf) && product.indicativePriceRwf > 0;
}

function prescriptionLabel(status: Product["prescriptionStatus"]) {
  if (status === "prescription") return "Prescription required";
  if (status === "non_prescription") return "No prescription required";
  if (status === "pharmacist_only") return "Ask a pharmacist";
  return "";
}

function PrescriptionStatusIcon({ status }: { status: Product["prescriptionStatus"] }) {
  const label = prescriptionLabel(status);
  if (!label) return null;
  const Icon = status === "prescription" ? FileText : status === "pharmacist_only" ? MessageCircle : ShieldCheck;
  return <small
    className={`product-prescription-status status-${status}`}
    aria-label={label}
    title={label}
  >
    <Icon size={15} aria-hidden="true" />
    <span className="sr-only">{label}</span>
  </small>;
}

type ProductCardProps = {
  product: Product;
  index: number;
  catalogueSize: number;
  previewMode: boolean;
  publicCatalogMode: boolean;
  onAdd: (product: Product) => void;
};

function ProductCard({
  product,
  index,
  catalogueSize,
  previewMode,
  publicCatalogMode,
  onAdd,
}: ProductCardProps) {
  const normalizeLabel = (value: string | undefined) => (value ?? "").trim().toLocaleLowerCase();
  const consumerProduct = product.id.startsWith("AMZ-");
  const taxonomyLabels = new Set(
    [product.category, product.department, product.subcategory, product.productType]
      .map(normalizeLabel)
      .filter(Boolean),
  );
  const genericCandidate = product.generic.trim();
  const generic = genericCandidate
    && normalizeLabel(genericCandidate) !== normalizeLabel(product.brand)
    && (!consumerProduct || !taxonomyLabels.has(normalizeLabel(genericCandidate)))
    ? genericCandidate
    : "";
  const seenDetails = new Set<string>();
  const details = [product.strength, product.form, product.packSize]
    .map((value) => value.trim())
    .filter((value) => {
      const normalized = normalizeLabel(value);
      if (!normalized || seenDetails.has(normalized)) return false;
      if (consumerProduct && (taxonomyLabels.has(normalized) || normalized === normalizeLabel(generic))) return false;
      seenDetails.add(normalized);
      return true;
    });
  const priced = hasPriceData(product);
  const cardImageUrl = product.imageUrl ?? product.imageUrls?.[0] ?? null;

  return <article
    className={`product-card product-card-${product.accent ?? "mint"}${cardImageUrl ? "" : " without-image"}`}
    aria-posinset={index + 1}
    aria-setsize={catalogueSize}
    data-product-card={product.id}
  >
    {cardImageUrl ? <Link className="product-image-wrap" href={`/product/${encodeURIComponent(product.id)}`} aria-label={`View ${product.brand}`}>
      <ProductVisual product={product} eager={index < 5} imageUrl={cardImageUrl} />
      <span className="product-image-action">View product</span>
    </Link> : null}
    <div className="product-card-content">
      <div className="product-meta">
        <span>{displayCategory(product)}</span>
        <PrescriptionStatusIcon status={product.prescriptionStatus} />
      </div>
      <h3><Link href={`/product/${encodeURIComponent(product.id)}`}>{product.brand}</Link></h3>
      <p className={`product-card-generic${generic ? "" : " is-empty"}`} aria-hidden={generic ? undefined : true}>{generic || "\u00a0"}</p>
      {details.length ? <div className="product-card-specs" aria-label="Product details">{details.slice(0, 3).join(" · ")}</div> : <div className="product-card-specs is-empty" aria-hidden="true" />}
      <div className={`price-line ${priced ? "has-price" : "no-price"}`}>
        {priced ? <div><small>Price</small><b>From RWF {rwf.format(product.indicativePriceRwf)}</b></div> : null}
        <button className="product-card-cart" onClick={() => onAdd(product)} disabled={publicCatalogMode || (!previewMode && !product.isOrderable)} aria-label={publicCatalogMode ? `Add ${product.brand} to cart unavailable` : `Add ${product.brand} to cart`} title={publicCatalogMode ? "Cart opens after pharmacy connections are activated" : !previewMode && !product.isOrderable ? "Currently unavailable" : "Add to cart"}><ShoppingCart size={19} aria-hidden="true" /><span className="sr-only">{publicCatalogMode ? "Cart unavailable" : "Add to cart"}</span></button>
      </div>
    </div>
  </article>;
}

function errorMessage(error: unknown) {
  return normalizeDawaNearError(error).message;
}

function OrderWizardProgress({ step }: { step: CheckoutStep }) {
  return <ol className="order-wizard-progress" aria-label="Availability request progress">
    {CHECKOUT_STEPS.map((item) => <li className={item.id === step ? "active" : item.id < step ? "complete" : ""} aria-current={item.id === step ? "step" : undefined} key={item.id}>
      <span>{item.id < step ? <Check size={16} /> : item.id}</span>
      <b>{item.label}</b>
    </li>)}
  </ol>;
}

function whatsappUrl(number: string | null | undefined, message: string) {
  const digits = number?.replace(/\D/g, "") ?? "";
  return /^2507[2389]\d{7}$/.test(digits)
    ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
    : null;
}

function parseCustomerWhatsapp(country: CountryCode, nationalNumber: string) {
  const phone = parsePhoneNumberFromString(nationalNumber, country);
  return phone?.isValid() ? phone.number.replace(/^\+/, "") : null;
}

function splitCustomerWhatsapp(value: string | null | undefined) {
  const digits = value?.replace(/\D/g, "") ?? "";
  const phone = digits ? parsePhoneNumberFromString(`+${digits}`) : undefined;
  return phone?.country
    ? { country: phone.country, nationalNumber: phone.nationalNumber }
    : null;
}

function normalizedSubstitutionField(value: string) {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

function isCompatibleSubstitute(product: Product, requested: PharmacyRequestItem) {
  const requestedGeneric = normalizedSubstitutionField(requested.generic);
  const requestedStrength = normalizedSubstitutionField(requested.strength);
  const requestedForm = normalizedSubstitutionField(requested.form);
  const requestedPackSize = normalizedSubstitutionField(requested.packSize);
  return Boolean(requestedGeneric && requestedStrength && requestedForm && requestedPackSize)
    && normalizedSubstitutionField(product.generic) === requestedGeneric
    && normalizedSubstitutionField(product.strength) === requestedStrength
    && normalizedSubstitutionField(product.form) === requestedForm
    && normalizedSubstitutionField(product.packSize) === requestedPackSize;
}

export default function Marketplace({
  initialCategory = "All products",
  pageTitle,
  pageDescription,
  pageImage,
  showDepartments = false,
  initialProductId,
  initialProduct,
  initialProducts = [],
  initialTaxonomy = [],
}: MarketplaceProps = {}) {
  const previewMode = marketplaceMode !== "live";
  const publicCatalogMode = marketplaceMode === "catalog";
  const orderingEnabled = !previewMode && backendConfigured;
  const [category, setCategory] = useState(initialCategory);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [prescriptionFilter, setPrescriptionFilter] = useState("all");
  const [formFilter, setFormFilter] = useState("all");
  const [availabilityFilter, setAvailabilityFilter] = useState("all");
  const [catalogue, setCatalogue] = useState<Product[]>(() => initialProduct ? [initialProduct] : initialProducts);
  const [taxonomy, setTaxonomy] = useState<CatalogueTaxonomyRow[]>(initialTaxonomy);
  const [portalCatalogue, setPortalCatalogue] = useState<Product[]>([]);
  const [serverCatalogueTotal, setServerCatalogueTotal] = useState(0);
  const [serverExplanations, setServerExplanations] = useState<Map<string, string>>(() => new Map());
  const [serverCatalogueAvailable, setServerCatalogueAvailable] = useState(true);
  const [catalogueInitialising, setCatalogueInitialising] = useState(!initialProduct && !initialProducts.length);
  const [catalogueLoading, setCatalogueLoading] = useState(false);
  const [sort, setSort] = useState("relevance");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [, setDataSource] = useState(initialProduct || initialProducts.length
    ? "Checking verified Rwanda FDA catalogue…"
    : "Loading verified Rwanda FDA catalogue…");
  const [visibleCount, setVisibleCount] = useState(INITIAL_PRODUCT_COUNT);
  const productLoadSentinelRef = useRef<HTMLDivElement>(null);
  const orderWizardBodyRef = useRef<HTMLDivElement>(null);
  const productLoadPendingRef = useRef(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartHydrated, setCartHydrated] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutStep, setCheckoutStep] = useState<CheckoutStep>(1);
  const [showAllCartItems, setShowAllCartItems] = useState(false);
  const [recentlyAddedBrand, setRecentlyAddedBrand] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [feedbackToast, setFeedbackToast] = useState<FeedbackToast | null>(null);
  const [location, setLocation] = useState("Location needed");
  const [locationLoading, setLocationLoading] = useState(false);
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [mapLocationOpen, setMapLocationOpen] = useState(false);
  const [whatsappCountry, setWhatsappCountry] = useState<CountryCode>("RW");
  const [whatsapp, setWhatsapp] = useState("");
  const [whatsappTouched, setWhatsappTouched] = useState(false);
  const [preferencesHydrated, setPreferencesHydrated] = useState(false);
  const [deliveryPreference, setDeliveryPreference] = useState<"pickup" | "delivery" | "either">("either");
  const [prescription, setPrescription] = useState<File | null>(null);
  const [prescriptionError, setPrescriptionError] = useState("");
  const [pendingOrderAttempt, setPendingOrderAttempt] = useState<PendingOrderAttempt | null>(null);
  const [ordering, setOrdering] = useState(false);
  const [closingOrder, setClosingOrder] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [customerMessage, setCustomerMessage] = useState("");
  const [customerSessionAvailable, setCustomerSessionAvailable] = useState<boolean | null>(previewMode ? true : null);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaError, setCaptchaError] = useState("");
  const [captchaVersion, setCaptchaVersion] = useState(0);
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [activeOrderSelected, setActiveOrderSelected] = useState(false);
  const [activeOrderExpiresAt, setActiveOrderExpiresAt] = useState<string | null>(null);
  const [activeRecipientCount, setActiveRecipientCount] = useState<number | null>(null);
  const [orderClock, setOrderClock] = useState(() => Date.now());
  const [restoredActiveOrders, setRestoredActiveOrders] = useState<ActiveOrder[]>([]);
  const [orderSent, setOrderSent] = useState(false);
  const [offers, setOffers] = useState<OrderOffer[]>([]);
  const [offersOpen, setOffersOpen] = useState(false);
  const [selectingOfferId, setSelectingOfferId] = useState<string | null>(null);
  const [selectedContact, setSelectedContact] = useState<SelectedContact | null>(null);

  const [portalOpen, setPortalOpen] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState("");
  const [portalMessage, setPortalMessage] = useState("");
  const [portalStage, setPortalStage] = useState<"signin" | "otp" | "workspace">("signin");
  const [portalTab, setPortalTab] = useState<PortalTab>("requests");
  const [pharmacyWhatsapp, setPharmacyWhatsapp] = useState("");
  const [pharmacyOtp, setPharmacyOtp] = useState("");
  const [pharmacyOtpChallengeId, setPharmacyOtpChallengeId] = useState("");
  const [unregisteredPharmacyWhatsapp, setUnregisteredPharmacyWhatsapp] = useState("");
  const [activeMembership, setActiveMembership] = useState<PharmacyMembership | null>(null);
  const [pharmacyRequests, setPharmacyRequests] = useState<PharmacyRequest[]>([]);
  const [pharmacySelectedOrders, setPharmacySelectedOrders] = useState<PharmacySelectedOrder[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<PharmacyRequest | null>(null);
  const [offerPrices, setOfferPrices] = useState<Record<string, string>>({});
  const [offerAvailability, setOfferAvailability] = useState<Record<string, boolean>>({});
  const [offerSubstitutes, setOfferSubstitutes] = useState<Record<string, boolean>>({});
  const [offerProductIds, setOfferProductIds] = useState<Record<string, string>>({});
  const [offerReadyMinutes, setOfferReadyMinutes] = useState("20");
  const [offerFulfilmentMethod, setOfferFulfilmentMethod] = useState<"pickup" | "delivery" | "either">("either");
  const [offerNote, setOfferNote] = useState("");
  const [contactEditWhatsapp, setContactEditWhatsapp] = useState("");
  const [contactEditNote, setContactEditNote] = useState("");
  const [contactEditType, setContactEditType] = useState<"phone" | "whatsapp">("whatsapp");
  const [contactEditAction, setContactEditAction] = useState<"add" | "update">("add");
  const [contactEditContactId, setContactEditContactId] = useState<string | null>(null);
  const [pharmacyContacts, setPharmacyContacts] = useState<PharmacyContact[]>([]);
  const [pendingContactEdits, setPendingContactEdits] = useState<PharmacyContactEdit[]>([]);
  const activePharmacyId = activeMembership?.pharmacyId ?? null;
  const activeModalKey = unregisteredPharmacyWhatsapp
    ? "unregistered-pharmacy"
    : selectedRequest
      ? "offer-editor"
      : portalOpen
        ? portalStage === "workspace" ? "portal-workspace" : "portal-auth"
        : offersOpen
          ? "order-status"
          : cartOpen
            ? "order-basket"
            : filtersOpen
              ? "catalogue-filters"
              : null;

  function announce(message: string, tone: FeedbackToast["tone"] = "success") {
    setFeedbackToast({ id: Date.now(), message, tone });
  }

  useEffect(() => {
    if (!activeModalKey) return undefined;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    const root = activeModalKey === "offer-editor"
      ? document.querySelector<HTMLElement>(".offer-editor")
      : document.querySelector<HTMLElement>(`[data-modal-root="${activeModalKey}"]`);
    if (activeModalKey === "offer-editor" && root) {
      root.setAttribute("role", "dialog");
      root.setAttribute("aria-modal", "true");
      root.setAttribute("aria-label", "Confirm pharmacy availability request");
    }
    const focusableSelector = "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
    const focusables = () => root ? Array.from(root.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => element.offsetParent !== null) : [];
    const animationFrame = window.requestAnimationFrame(() => (root?.querySelector<HTMLElement>("[data-autofocus]") ?? focusables()[0] ?? root)?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (activeModalKey === "unregistered-pharmacy") setUnregisteredPharmacyWhatsapp("");
        else if (activeModalKey === "offer-editor") setSelectedRequest(null);
        else if (activeModalKey === "portal-auth" || activeModalKey === "portal-workspace") setPortalOpen(false);
        else if (activeModalKey === "order-status") setOffersOpen(false);
        else if (activeModalKey === "order-basket") setCartOpen(false);
        else if (activeModalKey === "catalogue-filters") setFiltersOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) {
        event.preventDefault();
        root?.focus();
        return;
      }
      const first = items[0];
      const last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      previousFocus?.focus();
    };
  }, [activeModalKey]);

  useEffect(() => {
    if (!mobileMenu) return undefined;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileMenu(false); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileMenu]);

  useEffect(() => {
    if (!feedbackToast) return undefined;
    const timeout = window.setTimeout(() => setFeedbackToast((current) => current?.id === feedbackToast.id ? null : current), 4200);
    return () => window.clearTimeout(timeout);
  }, [feedbackToast]);

  useEffect(() => {
    if (!cartOpen) return;
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    const frame = window.requestAnimationFrame(() => orderWizardBodyRef.current?.scrollTo({ top: 0, behavior }));
    return () => window.cancelAnimationFrame(frame);
  }, [cartOpen, checkoutStep]);

  useEffect(() => {
    const initialCheck = window.setTimeout(() => setIsOnline(navigator.onLine), 0);
    const handleOnline = () => {
      setIsOnline(true);
      setFeedbackToast({ id: Date.now(), message: "You are back online.", tone: "info" });
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.clearTimeout(initialCheck);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    const initialSearch = new URLSearchParams(window.location.search).get("search")?.trim();
    const openPharmacyPortal = new URLSearchParams(window.location.search).get("pharmacy-portal") === "open";
    if (initialSearch) queueMicrotask(() => setQuery(initialSearch));
    if (openPharmacyPortal) queueMicrotask(() => { void openPortal(); });
  }, []);

  useEffect(() => {
    let restoredCart: CartItem[] = [];
    try {
      const saved = window.localStorage.getItem(CART_STORAGE_KEY);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          restoredCart = parsed.filter((item): item is CartItem => Boolean(
            item && typeof item === "object" && "id" in item && "quantity" in item
            && typeof item.id === "string" && typeof item.quantity === "number" && item.quantity > 0,
          ));
        }
      }
    } catch {
      window.localStorage.removeItem(CART_STORAGE_KEY);
    }
    queueMicrotask(() => {
      if (restoredCart.length) setCart(restoredCart);
      setCartHydrated(true);
    });
  }, []);

  useEffect(() => {
    if (!cartHydrated) return;
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  }, [cart, cartHydrated]);

  useEffect(() => {
    let savedPreferences: CustomerPreferences | null = null;
    try {
      const saved = window.localStorage.getItem(CUSTOMER_PREFERENCES_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<CustomerPreferences>;
        const country = typeof parsed.whatsappCountry === "string" && getCountries().includes(parsed.whatsappCountry as CountryCode)
          ? parsed.whatsappCountry as CountryCode
          : "RW";
        const delivery = parsed.deliveryPreference;
        const savedCoordinates = parsed.coordinates;
        const savedLocationLabel = typeof parsed.locationLabel === "string" ? parsed.locationLabel : "";
        const isLegacyManualLocation = /manually entered/i.test(savedLocationLabel);
        const coordinatesAreValid = Boolean(
          savedCoordinates
          && !isLegacyManualLocation
          && Number.isFinite(savedCoordinates.latitude)
          && Number.isFinite(savedCoordinates.longitude)
          && Number.isFinite(savedCoordinates.accuracy)
          && savedCoordinates.latitude >= -3
          && savedCoordinates.latitude <= -0.8
          && savedCoordinates.longitude >= 28.7
          && savedCoordinates.longitude <= 30.9,
        );
        savedPreferences = {
          whatsappCountry: country,
          whatsappNational: typeof parsed.whatsappNational === "string" ? parsed.whatsappNational.replace(/\D/g, "") : "",
          deliveryPreference: delivery === "pickup" || delivery === "delivery" ? delivery : "either",
          coordinates: coordinatesAreValid ? savedCoordinates as Coordinates : null,
          locationLabel: coordinatesAreValid ? savedLocationLabel : "",
        };
      }
    } catch {
      window.localStorage.removeItem(CUSTOMER_PREFERENCES_STORAGE_KEY);
    }
    queueMicrotask(() => {
      if (savedPreferences) {
        setWhatsappCountry(savedPreferences.whatsappCountry);
        setWhatsapp(savedPreferences.whatsappNational);
        setDeliveryPreference(savedPreferences.deliveryPreference);
        if (savedPreferences.coordinates) {
          setCoordinates(savedPreferences.coordinates);
          setLocation(savedPreferences.locationLabel || "Saved location ready");
        }
      }
      setPreferencesHydrated(true);
    });
  }, []);

  useEffect(() => {
    if (!preferencesHydrated) return;
    const preferences: CustomerPreferences = {
      whatsappCountry,
      whatsappNational: whatsapp,
      deliveryPreference,
      coordinates,
      locationLabel: coordinates ? location : "",
    };
    window.localStorage.setItem(CUSTOMER_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  }, [coordinates, deliveryPreference, location, preferencesHydrated, whatsapp, whatsappCountry]);

  useEffect(() => {
    let cancelled = false;
    async function initialise() {
      if (!backendConfigured) {
        const productResponse = await fetch("/data/rwanda-fda-products-july-2026.csv");
        if (productResponse.ok) {
          const rows = parseCsv(await productResponse.text()).filter((row) => row.regulatory_status !== "expired");
          if (!cancelled) {
            setCatalogue(rows.map(fallbackProduct));
            setDataSource(`${rows.length.toLocaleString()} verified human-medicine register records`);
          }
        }
      }
      if (!backendConfigured || previewMode) return;
      try {
        const hasCustomerSession = await hasAnonymousCustomerSession();
        if (!cancelled) setCustomerSessionAvailable(hasCustomerSession);
        if (!hasCustomerSession) return;
        const [profile, activeOrders] = await Promise.all([
          loadCustomerProfile(),
          loadMyActiveOrders(),
        ]);
        if (!cancelled && profile?.whatsapp) {
          const savedWhatsapp = splitCustomerWhatsapp(profile.whatsapp);
          if (savedWhatsapp) {
            setWhatsappCountry(savedWhatsapp.country);
            setWhatsapp(savedWhatsapp.nationalNumber);
          }
        }
        if (!cancelled) setRestoredActiveOrders(activeOrders);
        const latestOrder = activeOrders[0];
        if (latestOrder) {
          if (!cancelled) {
            setActiveOrderId(latestOrder.orderId);
            setActiveOrderSelected(Boolean(latestOrder.selectedOfferId));
            setActiveOrderExpiresAt(latestOrder.expiresAt);
            setActiveRecipientCount(latestOrder.recipientCount);
            setOrderSent(true);
            setOffers([]);
            setSelectedContact(null);
          }
          const [offersResult, contactResult] = await Promise.allSettled([
            loadOffers(latestOrder.orderId),
            latestOrder.selectedOfferId ? loadSelectedContact(latestOrder.orderId) : Promise.resolve(null),
          ]);
          if (!cancelled) {
            if (offersResult.status === "fulfilled") setOffers(offersResult.value);
            else setCheckoutError(errorMessage(offersResult.reason));
            if (contactResult.status === "fulfilled") setSelectedContact(contactResult.value);
            else setCheckoutError(`The selected pharmacy contact is unavailable: ${errorMessage(contactResult.reason)} You can still complete or cancel this order.`);
          }
        }
      } catch (error) {
        if (!cancelled) setDataSource(`Verified catalogue fallback · backend unavailable: ${errorMessage(error)}`);
      }
    }
    initialise()
      .catch((error) => { if (!cancelled) setDataSource(errorMessage(error)); })
      .finally(() => { if (!cancelled) setCatalogueInitialising(false); });
    return () => { cancelled = true; };
  }, [previewMode]);

  useEffect(() => {
    if (!backendConfigured) return undefined;
    let cancelled = false;
    void loadCatalogueTaxonomy()
      .then((rows) => { if (!cancelled) setTaxonomy(rows); })
      .catch(() => { /* The catalogue can still browse with the All Categories option. */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!backendConfigured || !serverCatalogueAvailable || initialProductId) return undefined;
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) setCatalogueLoading(true); });

    async function loadRankedCatalogue() {
      const startedAt = performance.now();
      const products: Product[] = [];
      const explanations = new Map<string, string>();
      let total = 0;
      for (let offset = 0; offset < visibleCount; offset += 120) {
        const result = await searchCatalogue({
          query: deferredQuery,
          category: backendCategoryFor(category),
          prescriptionStatus: prescriptionFilter,
          formGroup: formFilter,
          availability: availabilityFilter,
          sort: sort as "relevance" | "az" | "za" | "price",
          limit: Math.min(120, visibleCount - offset),
          offset,
        });
        products.push(...result.products);
        result.explanations.forEach((value, key) => explanations.set(key, value));
        total = result.total;
        if (!result.products.length || products.length >= total) break;
      }
      if (cancelled) return;
      setCatalogue(products);
      setServerCatalogueTotal(total);
      setServerExplanations(explanations);
      setDataSource(`${total.toLocaleString()} live catalogue matches · Supabase ranked search`);
      trackMarketplaceEvent("catalogue_search", {
        source: "supabase",
        queryLength: deferredQuery.trim().length,
        resultCount: total,
        durationMs: performance.now() - startedAt,
      });
    }

    void loadRankedCatalogue().catch(async (error: unknown) => {
      if (cancelled) return;
      const message = errorMessage(error);
      if (/not installed|does not exist|could not find the function/i.test(message)) {
        setServerCatalogueAvailable(false);
        try {
          const products = await loadCatalogue();
          if (!cancelled) {
            setCatalogue(products);
            setDataSource(`${products.length.toLocaleString()} live catalogue records · local ranking fallback`);
          }
        } catch (fallbackError) {
          if (!cancelled) setDataSource(`Live catalogue unavailable: ${errorMessage(fallbackError)}`);
        }
      } else {
        setDataSource(`Live ranked search unavailable: ${message}`);
      }
    }).finally(() => {
      if (!cancelled) setCatalogueLoading(false);
    });

    return () => { cancelled = true; };
  }, [
    availabilityFilter,
    category,
    deferredQuery,
    formFilter,
    initialProductId,
    prescriptionFilter,
    previewMode,
    serverCatalogueAvailable,
    sort,
    visibleCount,
  ]);

  async function refreshOffers(orderId: string) {
    try {
      setOffers(await loadOffers(orderId));
    } catch (error) {
      setCheckoutError(errorMessage(error));
    }
  }

  async function openRestoredOrder(order: ActiveOrder) {
    setOrdering(true);
    setCheckoutError("");
    setActiveOrderId(order.orderId);
    setActiveOrderSelected(Boolean(order.selectedOfferId));
    setActiveOrderExpiresAt(order.expiresAt);
    setActiveRecipientCount(order.recipientCount);
    setOrderSent(true);
    setOffers([]);
    setSelectedContact(null);
    setCartOpen(false);
    setOffersOpen(true);
    try {
      const [offersResult, contactResult] = await Promise.allSettled([
        loadOffers(order.orderId),
        order.selectedOfferId ? loadSelectedContact(order.orderId) : Promise.resolve(null),
      ]);
      if (offersResult.status === "fulfilled") setOffers(offersResult.value);
      else setCheckoutError(errorMessage(offersResult.reason));
      if (contactResult.status === "fulfilled") setSelectedContact(contactResult.value);
      else setCheckoutError(`The selected pharmacy contact is unavailable: ${errorMessage(contactResult.reason)} You can still complete or cancel this order.`);
    } catch (error) {
      setCheckoutError(errorMessage(error));
    } finally {
      setOrdering(false);
    }
  }

  useEffect(() => {
    if (!activeOrderId || !backendConfigured) return undefined;
    const unsubscribe = subscribeToOffers(
      activeOrderId,
      setOffers,
      (error) => setCheckoutError(error.message),
    );
    return () => { unsubscribe(); };
  }, [activeOrderId]);

  useEffect(() => {
    if (!activeOrderId || activeOrderSelected) return undefined;
    const timer = window.setInterval(() => setOrderClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [activeOrderId, activeOrderSelected]);

  useEffect(() => {
    if (!portalOpen || portalStage !== "workspace" || !activePharmacyId || !backendConfigured) return undefined;
    let cancelled = false;
    let refreshSequence = 0;
    const refresh = () => {
      const sequence = ++refreshSequence;
      void Promise.all([
        loadPharmacyRequests(activePharmacyId),
        loadPharmacySelectedOrders(activePharmacyId),
      ]).then(([requests, selectedOrders]) => {
        if (!cancelled && sequence === refreshSequence) {
          setPharmacyRequests(requests);
          setPharmacySelectedOrders(selectedOrders);
        }
      }).catch((error: unknown) => {
        if (!cancelled) setPortalError(errorMessage(error));
      });
    };
    const unsubscribe = subscribeToPharmacyNotifications(
      activePharmacyId,
      refresh,
      (error) => setPortalError(error.message),
    );
    return () => {
      cancelled = true;
      refreshSequence += 1;
      unsubscribe();
    };
  }, [activePharmacyId, portalOpen, portalStage]);

  useEffect(() => {
    if (!portalOpen || portalStage !== "workspace" || !backendConfigured || portalCatalogue.length) return undefined;
    let cancelled = false;
    void loadCatalogue()
      .then((products) => { if (!cancelled) setPortalCatalogue(products); })
      .catch((error: unknown) => { if (!cancelled) setPortalError(errorMessage(error)); });
    return () => { cancelled = true; };
  }, [portalCatalogue.length, portalOpen, portalStage]);

  // A connected preview uses the same aggregate, privacy-safe catalogue RPC as
  // live. Treat its ranked page as authoritative in both modes; re-scoring only
  // a server page locally can hide valid alias matches and make preview UAT
  // diverge from production.
  const serverCatalogueActive = backendConfigured && serverCatalogueAvailable && !initialProductId;
  const fallbackTaxonomy = useMemo<CatalogueTaxonomyRow[]>(() => {
    const counts = new Map<string, number>();
    catalogue.forEach((product) => {
      const department = product.department || product.category;
      if (!department) return;
      const key = `${department}\u0000${product.subcategory ?? ""}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return [...counts.entries()].map(([key, productCount]) => {
      const [department, subcategory] = key.split("\u0000");
      return { department, subcategory: subcategory || null, productCount };
    });
  }, [catalogue]);
  const availableTaxonomy = taxonomy.length ? taxonomy : fallbackTaxonomy;
  const availableDepartments = useMemo(
    () => new Set(availableTaxonomy.filter((row) => row.productCount > 0).map((row) => row.department)),
    [availableTaxonomy],
  );
  const departmentNav = useMemo(
    () => departmentPresentation
      .filter((item) => availableDepartments.has(item.department))
      .map(({ label, href }) => ({ label, href })),
    [availableDepartments],
  );
  const departmentCards = useMemo(
    () => departmentPresentation.filter((item) => availableDepartments.has(item.department)),
    [availableDepartments],
  );
  const indexedCatalogue = useMemo(() => catalogue.map(indexCatalogueProduct), [catalogue]);

  const filteredMatches = useMemo(() => {
    // The live RPC already applies every active filter and returns a stable,
    // paginated relevance order. Re-scoring that page in the browser can undo
    // stronger server intent matches (especially multilingual aliases), so the
    // client scorer is reserved for preview/offline fallback mode.
    if (serverCatalogueActive) {
      const serverProducts = isNonPrescriptionTaxonomyFilter(category)
        ? catalogue.filter((product) => productMatchesCategory(product, category))
        : catalogue;
      return serverProducts.map((product) => ({
        product,
        score: 0,
        explanation: serverExplanations.get(product.id) ?? "Catalogue product",
      }));
    }
    return indexedCatalogue
      .map((indexed) => searchCatalogueProduct(indexed, deferredQuery))
      .filter((match): match is NonNullable<typeof match> => Boolean(match))
      .filter((match) => {
        const product = match.product;
        if (!productMatchesCategory(product, category)) return false;
        if (prescriptionFilter !== "all" && product.prescriptionStatus !== prescriptionFilter) return false;
        if (formFilter !== "all" && catalogueFormGroup(product) !== formFilter) return false;
        if (availabilityFilter === "priced" && !hasPriceData(product)) return false;
        if (availabilityFilter === "orderable" && !product.isOrderable) return false;
        if (availabilityFilter === "registered" && !["valid", "active", "expiring_soon"].includes(product.regulatoryStatus.toLowerCase())) return false;
        return true;
      })
      .toSorted((left, right) => {
        const a = left.product;
        const b = right.product;
        if (sort === "za") return b.brand.localeCompare(a.brand);
        if (sort === "price") return (a.indicativePriceRwf || Number.MAX_SAFE_INTEGER) - (b.indicativePriceRwf || Number.MAX_SAFE_INTEGER) || a.brand.localeCompare(b.brand);
        if (sort === "relevance" && deferredQuery.trim() && right.score !== left.score) return right.score - left.score;
        return a.brand.localeCompare(b.brand);
      });
  }, [
    availabilityFilter,
    catalogue,
    category,
    deferredQuery,
    formFilter,
    indexedCatalogue,
    prescriptionFilter,
    serverCatalogueActive,
    serverExplanations,
    sort,
  ]);

  const filtered = useMemo(() => filteredMatches.map((match) => match.product), [filteredMatches]);
  const taxonomyFiltered = isNonPrescriptionTaxonomyFilter(category);
  const catalogueMatchCount = serverCatalogueActive && !taxonomyFiltered ? serverCatalogueTotal : filtered.length;
  const visibleProducts = serverCatalogueActive ? filtered : filtered.slice(0, visibleCount);
  const accessibleCatalogueSize = Math.max(catalogueMatchCount, visibleProducts.length);
  const catalogueBusy = catalogueInitialising || catalogueLoading;
  const hasMoreProducts = serverCatalogueActive
    ? serverCatalogueTotal > catalogue.length
    : filtered.length > visibleCount;

  useEffect(() => {
    if (!catalogueBusy) productLoadPendingRef.current = false;
  }, [catalogueBusy, visibleCount]);

  useEffect(() => {
    const sentinel = productLoadSentinelRef.current;
    if (!sentinel || !hasMoreProducts || initialProductId || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || catalogueBusy || productLoadPendingRef.current) return;
      productLoadPendingRef.current = true;
      setVisibleCount((count) => count + PRODUCT_BATCH_SIZE);
    }, { rootMargin: "800px 0px", threshold: 0.01 });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [catalogueBusy, hasMoreProducts, initialProductId]);

  const searchSuggestions = useMemo(() => deferredQuery.trim().length >= 2 ? filtered.slice(0, 6) : [], [deferredQuery, filtered]);
  const hasActiveFilters = category !== initialCategory || prescriptionFilter !== "all" || formFilter !== "all" || availabilityFilter !== "all";

  const pharmacyCatalogue = portalCatalogue.length ? portalCatalogue : catalogue;
  const orderableCatalogue = useMemo(() => pharmacyCatalogue.filter((product) => (
    product.isOrderable && ["valid", "active", "expiring_soon"].includes(product.regulatoryStatus.toLowerCase())
  )), [pharmacyCatalogue]);
  const selectedProduct = initialProductId ? catalogue.find((product) => product.id === initialProductId) ?? null : null;
  const selectedProductHasGallery = Boolean(
    selectedProduct
    && Array.from(new Set([...(selectedProduct.imageUrls ?? []), selectedProduct.imageUrl].filter(Boolean))).length === 3,
  );

  const basketCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const basketIndicativeFrom = cart.reduce((sum, item) => sum + item.indicativePriceRwf * item.quantity, 0);
  const displayedCartItems = showAllCartItems ? cart : cart.slice(0, 3);
  const customerWhatsapp = useMemo(
    () => parseCustomerWhatsapp(whatsappCountry, whatsapp),
    [whatsapp, whatsappCountry],
  );
  const cartRequiresPrescription = cart.some((item) => item.prescriptionStatus === "prescription");
  const selectionLocked = activeOrderSelected || selectedContact !== null || offers.some((offer) => offer.status === "selected");
  const requestLocked = pendingOrderAttempt !== null;
  const activeOrderExpired = Boolean(activeOrderExpiresAt && Date.parse(activeOrderExpiresAt) <= orderClock && !activeOrderSelected);
  const activeOrderNoRecipients = activeRecipientCount === 0;
  const activeOrderMinutesRemaining = activeOrderExpiresAt
    ? Math.max(0, Math.ceil((Date.parse(activeOrderExpiresAt) - orderClock) / 60_000))
    : null;

  function showSearchResults() {
    setSuggestionsOpen(false);
    setVisibleCount(INITIAL_PRODUCT_COUNT);
    document.querySelector("#marketplace")?.scrollIntoView({ behavior: "smooth", block: "start" });
    trackMarketplaceEvent("catalogue_search", { source: "client", queryLength: query.trim().length, resultCount: filtered.length });
  }

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") showSearchResults();
    if (event.key === "Escape") setSuggestionsOpen(false);
    if (event.key === "ArrowDown" && searchSuggestions.length) {
      event.preventDefault();
      setSuggestionsOpen(true);
      window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>("#smart-search-suggestions [role='option']")?.focus());
    }
  }

  function handleSuggestionKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Escape") {
      setSuggestionsOpen(false);
      document.querySelector<HTMLInputElement>("#marketplace-search")?.focus();
      return;
    }
    const options = Array.from(document.querySelectorAll<HTMLButtonElement>("#smart-search-suggestions [role='option']"));
    const index = options.indexOf(event.currentTarget);
    const direction = event.key === "ArrowDown" ? 1 : -1;
    options[(index + direction + options.length) % options.length]?.focus();
  }

  function chooseSearchSuggestion(product: Product) {
    setQuery(product.brand);
    setSuggestionsOpen(false);
    setVisibleCount(INITIAL_PRODUCT_COUNT);
    requestAnimationFrame(() => document.querySelector("#marketplace")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function clearCatalogueFilters() {
    setQuery("");
    setCategory(initialCategory);
    setPrescriptionFilter("all");
    setFormFilter("all");
    setAvailabilityFilter("all");
    setSort("relevance");
    setSuggestionsOpen(false);
    setVisibleCount(INITIAL_PRODUCT_COUNT);
    announce("Search and filters reset.");
  }

  function add(product: Product) {
    if (requestLocked) {
      setCheckoutError("Retry or reset the pending request before changing its products.");
      setCheckoutStep(1);
      setCartOpen(true);
      return;
    }
    if (!previewMode && !product.isOrderable) return;
    setCart((current) => {
      const found = current.find((item) => item.id === product.id);
      return found
        ? current.map((item) => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item)
        : [...current, { ...product, quantity: 1, substitutesAllowed: false }];
    });
    setCheckoutStep(1);
    setShowAllCartItems(false);
    setRecentlyAddedBrand(product.brand);
    setCartOpen(true);
    trackMarketplaceEvent("product_added", { category: product.category, hasPrice: product.min > 0 });
  }

  function continueToOrderDetails() {
    setCheckoutError("");
    if (!cart.length) {
      setCheckoutError("Add at least one product to continue.");
      return;
    }
    setCheckoutStep(2);
  }

  function continueToOrderConfirmation() {
    setCheckoutError("");
    setWhatsappTouched(true);
    if (!customerWhatsapp) {
      setCheckoutError("Enter a valid WhatsApp number and select its country code.");
      return;
    }
    if (!coordinates) {
      setCheckoutError("Use your current location or choose a location on the map before continuing.");
      return;
    }
    if (cartRequiresPrescription && !prescription && !pendingOrderAttempt?.prescriptionPath) {
      setCheckoutError("Attach a valid prescription before reviewing this request.");
      return;
    }
    if (prescriptionError) {
      setCheckoutError(prescriptionError);
      return;
    }
    setCheckoutStep(3);
  }

  function adjust(id: string, delta: number) {
    if (requestLocked) return;
    const item = cart.find((product) => product.id === id);
    setCart((current) => current
      .map((item) => item.id === id ? { ...item, quantity: item.quantity + delta } : item)
      .filter((item) => item.quantity > 0));
    if (item) announce(delta < 0 && item.quantity === 1 ? `${item.brand} removed from your request.` : `${item.brand} quantity ${delta > 0 ? "increased" : "decreased"}.`);
  }

  function setSubstituteConsent(id: string, allowed: boolean) {
    if (requestLocked) return;
    setCart((current) => current.map((item) => item.id === id ? { ...item, substitutesAllowed: allowed } : item));
    const item = cart.find((product) => product.id === id);
    if (item) announce(allowed ? `Substitutes allowed for ${item.brand}.` : `Exact product requested for ${item.brand}.`);
  }

  function detectNativeLocation(): Promise<Coordinates> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error(googleMapsBrowserKey
          ? "This browser cannot detect location. Choose an address on the map instead."
          : "This browser cannot detect location. Enable location access on a supported device and try again."));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        }),
        () => reject(new Error(googleMapsBrowserKey
          ? "Location was not available. Allow location access or choose an address on the map."
          : "Location was not available. Allow location access and try again.")),
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 60_000 },
      );
    });
  }

  async function requestNativeLocation(openBasketOnFailure = false) {
    if (locationLoading) return;
    setCheckoutError("");
    setLocation("Detecting your location…");
    setLocationLoading(true);
    try {
      const next = await detectNativeLocation();
      setCoordinates(next);
      setLocation(`${next.latitude.toFixed(4)}, ${next.longitude.toFixed(4)} · ±${Math.round(next.accuracy)} m`);
      announce("Location is ready for nearby pharmacy matching.");
    } catch (error) {
      setLocation("Location needed");
      if (googleMapsBrowserKey) setMapLocationOpen(true);
      setCheckoutError(errorMessage(error));
      if (openBasketOnFailure) {
        setCheckoutStep(2);
        setCartOpen(true);
      }
    } finally {
      setLocationLoading(false);
    }
  }

  function applyMapLocation(next: Coordinates, label: string) {
    setCoordinates(next);
    setLocation(label);
    setMapLocationOpen(false);
    setCheckoutError("");
    announce("Map location saved for nearby pharmacy matching.");
  }

  function handlePrescriptionChange(file: File | undefined) {
    setPrescriptionError("");
    if (!file) {
      setPrescription(null);
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.type)) {
      setPrescription(null);
      setPrescriptionError("Use a JPG, PNG, WEBP, or PDF prescription.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setPrescription(null);
      setPrescriptionError("Prescription files must be 10 MB or smaller.");
      return;
    }
    setPrescription(file);
  }

  function clearRequestState(message = "") {
    if (pendingOrderAttempt?.rpcAttempted) {
      setCheckoutError("This request may already have been saved. Retry the same secure request; local reset is disabled.");
      return false;
    }
    setPendingOrderAttempt(null);
    setActiveOrderId(null);
    setActiveOrderSelected(false);
    setActiveOrderExpiresAt(null);
    setActiveRecipientCount(null);
    setOrderSent(false);
    setOffers([]);
    setOffersOpen(false);
    setSelectedContact(null);
    setCart([]);
    setPrescription(null);
    setPrescriptionError("");
    setMapLocationOpen(false);
    setCheckoutStep(1);
    setShowAllCartItems(false);
    setRecentlyAddedBrand("");
    setCheckoutError("");
    setCustomerMessage(message);
    return true;
  }

  async function resetRequest() {
    if (pendingOrderAttempt?.rpcAttempted) {
      setCheckoutError("This request may already have been saved. Retry the same secure request so MED+250 can recover its receipt; resetting is disabled.");
      return;
    }
    setOrdering(true);
    if (pendingOrderAttempt?.prescriptionPath && !pendingOrderAttempt.rpcAttempted) {
      try {
        await deletePrescription(pendingOrderAttempt.prescriptionPath);
      } catch (error) {
        setCheckoutError(errorMessage(error));
        setOrdering(false);
        return;
      }
    }
    clearRequestState("Request cleared. You can start another request.");
    setOrdering(false);
    setCartOpen(true);
  }

  async function closeAndResetOrder(outcome: "completed" | "cancelled") {
    if (!activeOrderId) return;
    setClosingOrder(true);
    setCheckoutError("");
    try {
      const result = await closeOrder(activeOrderId, outcome);
      setRestoredActiveOrders((current) => current.filter((order) => order.orderId !== result.orderId));
      clearRequestState(result.status === "completed"
        ? "Request finished. You can start another request."
        : "Request cancelled. You can start another request.");
      setCartOpen(true);
    } catch (error) {
      setCheckoutError(errorMessage(error));
    } finally {
      setClosingOrder(false);
    }
  }

  async function submitOrder() {
    setCheckoutError("");
    setCustomerMessage("");
    if (restoredActiveOrders.length > 0) {
      setCheckoutError("Open and close each existing active request before starting another one.");
      return;
    }
    if (!cart.length) {
      setCheckoutError("Add at least one product to your availability request.");
      return;
    }
    setWhatsappTouched(true);
    if (!customerWhatsapp) {
      setCheckoutError("Enter a valid WhatsApp number and select its country code.");
      return;
    }
    if (cartRequiresPrescription && !prescription && !pendingOrderAttempt?.prescriptionPath) {
      setCheckoutError("Attach a valid prescription before requesting a prescription-classified product.");
      return;
    }
    if (prescriptionError) {
      setCheckoutError(prescriptionError);
      return;
    }
    if (!orderingEnabled) {
      setCheckoutError("Availability requests are not enabled in this build.");
      return;
    }
    setOrdering(true);
    trackMarketplaceEvent("order_started", { itemKinds: cart.length, itemCount: basketCount, prescriptionRequired: cartRequiresPrescription });
    let attempt = pendingOrderAttempt;
    try {
      let orderCoordinates = coordinates;
      if (!orderCoordinates) {
        setLocation("Detecting your location…");
        try {
          orderCoordinates = await detectNativeLocation();
          setCoordinates(orderCoordinates);
          setLocation(`${orderCoordinates.latitude.toFixed(4)}, ${orderCoordinates.longitude.toFixed(4)} · ±${Math.round(orderCoordinates.accuracy)} m`);
        } catch (error) {
          if (googleMapsBrowserKey) setMapLocationOpen(true);
          throw error;
        }
      }
      if (orderCoordinates.latitude < -3 || orderCoordinates.latitude > -0.8 || orderCoordinates.longitude < 28.7 || orderCoordinates.longitude > 30.9) {
        throw new Error("MED+250 currently accepts request locations inside Rwanda only.");
      }
      if (!attempt) {
        if (!globalThis.crypto?.randomUUID) {
          throw new Error("Secure request IDs are unavailable in this browser. Update your browser and try again.");
        }
        attempt = {
          clientRequestId: globalThis.crypto.randomUUID(),
          prescriptionPath: null,
          rpcAttempted: false,
          payload: {
            latitude: orderCoordinates.latitude,
            longitude: orderCoordinates.longitude,
            locationAccuracyM: orderCoordinates.accuracy,
            whatsapp: customerWhatsapp,
            deliveryPreference,
            items: cart.map((item) => ({
              productId: item.id,
              quantity: item.quantity,
              substitutesAllowed: item.substitutesAllowed,
              customerMinRwf: item.min || null,
              customerMaxRwf: item.max || null,
            })),
          },
        };
        setPendingOrderAttempt(attempt);
      }
      await ensureAnonymousCustomer(captchaToken || undefined);
      setCustomerSessionAvailable(true);
      setCaptchaToken("");
      setCaptchaError("");
      if (prescription && !attempt.prescriptionPath) {
        const prescriptionPath = await uploadPrescription(prescription);
        attempt = { ...attempt, prescriptionPath };
        setPendingOrderAttempt(attempt);
      }
      attempt = { ...attempt, rpcAttempted: true };
      setPendingOrderAttempt(attempt);
      const result = await createOrder({
        ...attempt.payload,
        clientRequestId: attempt.clientRequestId,
        prescriptionPath: attempt.prescriptionPath,
      });
      let cleanupWarning = "";
      if (result.recipientCount === 0 && attempt.prescriptionPath) {
        try {
          await deletePrescription(attempt.prescriptionPath);
        } catch (error) {
          cleanupWarning = errorMessage(error);
        }
      }
      setPendingOrderAttempt(null);
      setPrescription(null);
      setActiveOrderId(result.orderId);
      setActiveOrderSelected(false);
      setActiveOrderExpiresAt(new Date(Date.now() + (2 * 60 * 60 * 1_000)).toISOString());
      setActiveRecipientCount(result.recipientCount);
      setOrderClock(Date.now());
      setOffers([]);
      setSelectedContact(null);
      setOrderSent(true);
      setCartOpen(false);
      setOffersOpen(true);
      if (cleanupWarning) setCheckoutError(cleanupWarning);
      trackMarketplaceEvent("order_placed", { itemKinds: cart.length, prescriptionAttached: Boolean(attempt.prescriptionPath), dispatchSucceeded: result.recipientCount > 0 });
    } catch (error) {
      if (!attempt?.rpcAttempted && customerSessionAvailable !== true) {
        setCaptchaToken("");
        setCaptchaVersion((version) => version + 1);
      }
      setCheckoutError(attempt
        ? `${errorMessage(error)} The same secure request ID and prescription upload will be reused when you retry.`
        : errorMessage(error));
      trackMarketplaceEvent("order_failed", { stage: attempt?.rpcAttempted ? "dispatch" : "validation" });
    } finally {
      setOrdering(false);
    }
  }

  async function chooseOffer(offer: OrderOffer) {
    if (!activeOrderId || selectingOfferId) return;
    setCheckoutError("");
    setSelectingOfferId(offer.id);
    try {
      const contact = await selectOffer(activeOrderId, offer.id);
      setSelectedContact(contact);
      setActiveOrderSelected(true);
      announce(`${offer.pharmacyName} selected. Pharmacy contact details are now available.`);
      trackMarketplaceEvent("pharmacy_selected", { hasWhatsapp: Boolean(contact.whatsapp), hasMomoCode: Boolean(contact.momoCode) });
      await refreshOffers(activeOrderId);
    } catch (error) {
      setCheckoutError(errorMessage(error));
      announce("The pharmacy could not be selected. Please try again.", "info");
    } finally {
      setSelectingOfferId(null);
    }
  }

  async function openPortal() {
    setPortalOpen(true);
    setPortalError("");
    setPortalMessage("");
    setUnregisteredPharmacyWhatsapp("");
    if (!backendConfigured) {
      setPortalStage("signin");
      setPortalError("The Supabase project is not connected to this deployment yet.");
      return;
    }
    setPortalLoading(true);
    try {
      if (!getPharmacySupabase()) throw new Error("The pharmacy portal backend is not configured.");
      if (!await hasPermanentPharmacySession()) {
        setPortalStage("signin");
        return;
      }
      const rows = await loadMyPharmacies();
      if (!rows.length) {
        await signOutPharmacy();
        setPortalError("This WhatsApp number is not linked to a MED+250 pharmacy.");
        setPortalStage("signin");
        return;
      }
      const membership = rows[0];
      setActiveMembership(membership);
      setPortalStage("workspace");
      const [requests, selectedOrders, contactState] = await Promise.all([
        loadPharmacyRequests(membership.pharmacyId),
        loadPharmacySelectedOrders(membership.pharmacyId),
        loadMyPharmacyContacts(membership.pharmacyId),
      ]);
      setPharmacyRequests(requests);
      setPharmacySelectedOrders(selectedOrders);
      setPharmacyContacts(contactState.contacts);
      setPendingContactEdits(contactState.pendingRequests);
    } catch (error) {
      setPortalError(errorMessage(error));
      setPortalStage("signin");
    } finally {
      setPortalLoading(false);
    }
  }

  async function sendPharmacyCode() {
    setPortalError("");
    setPortalMessage("");
    setUnregisteredPharmacyWhatsapp("");
    if (!/^7[2389]\d{7}$/.test(pharmacyWhatsapp)) {
      setPortalError("Enter a valid Rwanda WhatsApp number.");
      return;
    }
    setPortalLoading(true);
    try {
      const challenge = await requestPharmacyWhatsappOtp(`250${pharmacyWhatsapp}`);
      if (!challenge.registered) {
        setUnregisteredPharmacyWhatsapp(challenge.adminWhatsapp || MED250_ADMIN_WHATSAPP);
        return;
      }
      setPharmacyOtpChallengeId(challenge.challengeId);
      setPharmacyOtp("");
      setPortalStage("otp");
      setPortalMessage("The 6-digit verification code is now in WhatsApp.");
    } catch (error) {
      setPortalError(errorMessage(error));
    } finally {
      setPortalLoading(false);
    }
  }

  async function verifyPharmacyCode() {
    setPortalError("");
    setPortalMessage("");
    if (!/^\d{6}$/.test(pharmacyOtp)) {
      setPortalError("Enter the complete 6-digit WhatsApp code.");
      return;
    }
    setPortalLoading(true);
    try {
      await verifyPharmacyWhatsappOtp(`250${pharmacyWhatsapp}`, pharmacyOtpChallengeId, pharmacyOtp);
      const rows = await loadMyPharmacies();
      if (!rows.length) {
        await signOutPharmacy();
        throw new Error("This WhatsApp number is not linked to a MED+250 pharmacy.");
      }
      const membership = rows[0];
      setActiveMembership(membership);
      setPortalStage("workspace");
      const [requests, selectedOrders, contactState] = await Promise.all([
        loadPharmacyRequests(membership.pharmacyId),
        loadPharmacySelectedOrders(membership.pharmacyId),
        loadMyPharmacyContacts(membership.pharmacyId),
      ]);
      setPharmacyRequests(requests);
      setPharmacySelectedOrders(selectedOrders);
      setPharmacyContacts(contactState.contacts);
      setPendingContactEdits(contactState.pendingRequests);
      setPortalMessage("Pharmacy portal opened.");
    } catch (error) {
      setPortalError(errorMessage(error));
    } finally {
      setPortalLoading(false);
    }
  }

  async function requestContactEdit() {
    if (!activeMembership) return;
    setPortalError("");
    setPortalMessage("");
    if (!/^7[2389]\d{7}$/.test(contactEditWhatsapp)) {
      setPortalError("Enter a valid Rwanda mobile number for the contact update.");
      return;
    }
    setPortalLoading(true);
    try {
      await requestPharmacyContactEdit({
        pharmacyId: activeMembership.pharmacyId,
        action: contactEditAction,
        contactType: contactEditType,
        contactId: contactEditAction === "update" ? contactEditContactId : null,
        e164: `250${contactEditWhatsapp}`,
        note: contactEditNote,
      });
      const contactState = await loadMyPharmacyContacts(activeMembership.pharmacyId);
      setPharmacyContacts(contactState.contacts);
      setPendingContactEdits(contactState.pendingRequests);
      setContactEditWhatsapp("");
      setContactEditNote("");
      setContactEditAction("add");
      setContactEditContactId(null);
      setPortalMessage("Contact change submitted. MED+250 will verify it before changing contact or login access.");
    } catch (error) {
      setPortalError(errorMessage(error));
    } finally {
      setPortalLoading(false);
    }
  }

  function beginContactReplacement(contact: PharmacyContact) {
    setContactEditAction("update");
    setContactEditType(contact.contactType);
    setContactEditContactId(contact.id);
    setContactEditWhatsapp(contact.e164.replace(/^250/, ""));
    setContactEditNote(`Replace ${contact.displayNumber} after direct verification`);
  }

  async function requestContactRemoval(contact: PharmacyContact) {
    if (!activeMembership) return;
    setPortalError("");
    setPortalMessage("");
    setPortalLoading(true);
    try {
      await requestPharmacyContactEdit({
        pharmacyId: activeMembership.pharmacyId,
        action: "remove",
        contactType: contact.contactType,
        contactId: contact.id,
        note: `Remove ${contact.displayNumber}; pharmacy staff requested operator review`,
      });
      const contactState = await loadMyPharmacyContacts(activeMembership.pharmacyId);
      setPharmacyContacts(contactState.contacts);
      setPendingContactEdits(contactState.pendingRequests);
      setPortalMessage("Removal request submitted. The contact remains active until MED+250 reviews it.");
    } catch (error) {
      setPortalError(errorMessage(error));
    } finally {
      setPortalLoading(false);
    }
  }

  async function leavePharmacyPortal() {
    setPortalError("");
    setPortalMessage("");
    setPortalLoading(true);
    try {
      await signOutPharmacy();
      setActiveMembership(null);
      setPharmacyRequests([]);
      setPharmacySelectedOrders([]);
      setPharmacyContacts([]);
      setPendingContactEdits([]);
      setSelectedRequest(null);
      setPortalTab("requests");
      setPortalStage("signin");
      setPharmacyWhatsapp("");
      setPharmacyOtp("");
      setPharmacyOtpChallengeId("");
      setPortalMessage("Signed out of the pharmacy portal. The customer order session remains separate.");
    } catch (error) {
      setPortalError(errorMessage(error));
    } finally {
      setPortalLoading(false);
    }
  }

  async function refreshPharmacyRequests() {
    if (!activeMembership) return;
    try {
      const [requests, selectedOrders] = await Promise.all([
        loadPharmacyRequests(activeMembership.pharmacyId),
        loadPharmacySelectedOrders(activeMembership.pharmacyId),
      ]);
      setPharmacyRequests(requests);
      setPharmacySelectedOrders(selectedOrders);
    } catch (error) {
      setPortalError(errorMessage(error));
    }
  }

  function beginOffer(request: PharmacyRequest) {
    setSelectedRequest(request);
    setOfferPrices(Object.fromEntries(request.items.map((item) => [item.orderItemId, ""])));
    setOfferAvailability(Object.fromEntries(request.items.map((item) => [item.orderItemId, true])));
    setOfferSubstitutes(Object.fromEntries(request.items.map((item) => [item.orderItemId, false])));
    setOfferProductIds(Object.fromEntries(request.items.map((item) => [item.orderItemId, item.productId])));
    setOfferReadyMinutes("20");
    setOfferFulfilmentMethod(request.deliveryPreference);
    setOfferNote("");
  }

  async function sendOffer() {
    if (!activeMembership || !selectedRequest) return;
    setPortalError("");
    const incompleteItem = selectedRequest.items.find((item) => (
      !(offerAvailability[item.orderItemId] ?? false)
      || ((offerSubstitutes[item.orderItemId] ?? false) && !offerProductIds[item.orderItemId])
    ));
    if (incompleteItem) {
      setPortalError("Confirm availability for every product before sending this response.");
      return;
    }
    setPortalLoading(true);
    try {
      await submitOffer({
        pharmacyId: activeMembership.pharmacyId,
        orderId: selectedRequest.orderId,
        fulfilmentMethod: offerFulfilmentMethod,
        readyInMinutes: Number(offerReadyMinutes),
        note: offerNote || null,
        items: selectedRequest.items.map((item) => {
          const available = offerAvailability[item.orderItemId] ?? false;
          const isSubstitute = item.substitutesAllowed && (offerSubstitutes[item.orderItemId] ?? false);
          return {
            orderItemId: item.orderItemId,
            offeredProductId: available
              ? isSubstitute ? offerProductIds[item.orderItemId] || null : item.productId
              : null,
            available,
            isSubstitute,
            unitPriceRwf: offerPrices[item.orderItemId] ? Number(offerPrices[item.orderItemId]) : null,
            quantity: item.quantity,
            note: null,
          };
        }),
      });
      setPortalMessage("Availability confirmation sent. The customer can continue with the pharmacy on WhatsApp.");
      setSelectedRequest(null);
      await refreshPharmacyRequests();
    } catch (error) {
      setPortalError(errorMessage(error));
    } finally {
      setPortalLoading(false);
    }
  }

  return (
    <main id="main-content">
      <a className="skip-link" href="#marketplace-content">Skip to marketplace content</a>
      {!isOnline ? <div className="connection-banner" role="alert"><WifiOff size={17} /><span>You are offline. Browsing may continue, but live search and availability requests need a connection.</span></div> : null}
      <header className="site-header">
        <Link className="brand" href="/" aria-label="med+250 home"><BrandLogo /></Link>
        <button type="button" className={`delivery-location ${coordinates ? "location-ready" : ""}`} onClick={() => requestNativeLocation(true)} disabled={publicCatalogMode || locationLoading} aria-busy={locationLoading} aria-label={publicCatalogMode ? "Location matching will be available when requests open" : locationLoading ? "Detecting location" : "Set location for nearby pharmacy matching"}><MapPin size={18} /><span><small>{publicCatalogMode ? "Public catalogue" : coordinates ? "Current location" : "Near you"}</small><b>{publicCatalogMode ? "Requests coming soon" : locationLoading ? "Detecting location…" : coordinates ? "Location ready" : location === "Location needed" ? "Use location" : location}</b></span>{locationLoading ? <LoaderCircle className="button-spinner" size={14} aria-hidden="true" /> : coordinates ? <Check size={14} /> : <ChevronDown size={13} />}</button>
        <div
          className="header-search-shell"
          onFocusCapture={() => setSuggestionsOpen(true)}
          onBlurCapture={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setSuggestionsOpen(false); }}
        >
          <div className="header-search">
            <select value={category} onChange={(event) => { setCategory(event.target.value); setVisibleCount(INITIAL_PRODUCT_COUNT); }} aria-label="Search category"><CategoryOptions taxonomy={availableTaxonomy} /></select>
            <input id="marketplace-search" value={query} maxLength={MAX_CATALOGUE_QUERY_LENGTH} onChange={(event) => { setQuery(boundedCatalogueQuery(event.target.value)); setSuggestionsOpen(true); setVisibleCount(INITIAL_PRODUCT_COUNT); }} onKeyDown={handleSearchKeyDown} placeholder="Search by product, generic name, symptom or use" role="combobox" aria-label="Search the marketplace" aria-controls="smart-search-suggestions" aria-expanded={suggestionsOpen && query.trim().length >= 2} aria-autocomplete="list" aria-haspopup="listbox" autoComplete="off" />
            <button type="button" aria-label="Search marketplace" onClick={showSearchResults}><Search size={22} /><span>Search</span></button>
          </div>
          {suggestionsOpen && query.trim().length >= 2 ? <div className="search-suggestions" id="smart-search-suggestions" role="listbox" aria-label="Search suggestions">
            <div><Sparkles size={15} /><span>{searchSuggestions.length ? "Intelligent matches" : "No close matches yet"}</span></div>
            {searchSuggestions.map((product) => <button type="button" role="option" aria-selected="false" tabIndex={-1} key={product.id} onKeyDown={handleSuggestionKeyDown} onClick={() => chooseSearchSuggestion(product)}><span><b>{product.brand}</b><small>{[product.generic, product.strength].filter(Boolean).join(" · ")}</small></span><em>{product.category}</em></button>)}
          </div> : null}
        </div>
        <div className="header-actions">
          <button type="button" className="header-utility" onClick={() => setOffersOpen(true)} disabled={publicCatalogMode} aria-label={publicCatalogMode ? "My requests will be available when requests open" : "Open my requests"}><PackageCheck size={19} /><span><small>My</small><b>Requests</b></span></button>
          <button type="button" className="header-utility" onClick={openPortal} aria-label="Open For Pharmacies"><Store size={19} /><span><b>For Pharmacies</b></span></button>
          <button className="bag-button" disabled={publicCatalogMode} onClick={() => { setCheckoutStep(1); setShowAllCartItems(false); setRecentlyAddedBrand(""); setCartOpen(true); }} aria-label={publicCatalogMode ? "Cart will be available when requests open" : `Open cart with ${basketCount} ${basketCount === 1 ? "item" : "items"}`}><ShoppingCart size={22} /><span>{publicCatalogMode ? "Cart soon" : "Cart"}</span><b>{basketCount}</b></button>
          <button className="mobile-toggle" onClick={() => setMobileMenu(!mobileMenu)} aria-label="Toggle navigation" aria-expanded={mobileMenu} aria-controls="mobile-marketplace-menu"><Menu size={22} /></button>
        </div>
      </header>

      {mobileMenu ? <nav className="mobile-menu-panel" id="mobile-marketplace-menu" aria-label="Mobile marketplace navigation"><Link href="/categories">All products</Link>{departmentNav.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}<button onClick={() => { setMobileMenu(false); setOffersOpen(true); }}>My requests</button><button onClick={() => { setMobileMenu(false); void openPortal(); }}>For Pharmacies</button></nav> : null}

      <nav className="commerce-nav" id="top" aria-label="Product categories">
        <a href="/categories"><Menu size={18} /> All Categories</a>
        {departmentNav.map((item) => <a key={item.href} href={item.href}>{item.label}</a>)}
      </nav>

      {publicCatalogMode ? <div className="preview-banner public-catalog-banner" role="status"><ShieldCheck size={16} /><span><b>Public catalogue is live.</b> Browse and search products now. Ordering stays unavailable until verified pharmacies are ready to receive requests.</span></div> : null}

      <div id="marketplace-content">
      {initialProductId ? <section className={`product-detail-page${selectedProductHasGallery ? "" : " without-image"}`} aria-live="polite">
        {selectedProduct ? <>
          <nav className="product-breadcrumbs" aria-label="Breadcrumb"><Link href="/">Home</Link><span aria-hidden="true">/</span><Link href="/categories">Products</Link><span aria-hidden="true">/</span><span aria-current="page">{selectedProduct.brand}</span></nav>
          {selectedProductHasGallery ? <div className="product-detail-visual"><ProductGallery product={selectedProduct} /></div> : null}
          <div className="product-detail-copy">
            {selectedProduct.category ? <small>{displayCategory(selectedProduct)}</small> : null}
            <h1>{selectedProduct.brand}</h1>
            {selectedProduct.generic ? <p className="product-generic">{selectedProduct.generic}</p> : null}
            <ProductDetailsList product={selectedProduct} />
            <div className={`product-detail-buy ${hasPriceData(selectedProduct) ? "has-price" : "no-price"}`}>
              {hasPriceData(selectedProduct) ? <div><span>Central indicative price</span><b>From RWF {rwf.format(selectedProduct.indicativePriceRwf)}</b><small>Reference only. Confirm availability and final price on WhatsApp.</small></div> : null}
              <button onClick={() => add(selectedProduct)} disabled={publicCatalogMode || (!previewMode && !selectedProduct.isOrderable)} aria-label={publicCatalogMode ? `Add ${selectedProduct.brand} to cart unavailable` : `Add ${selectedProduct.brand} to cart`} title={publicCatalogMode ? "Cart opens after pharmacy connections are activated" : undefined}><ShoppingCart size={20} /> {publicCatalogMode ? "Cart coming soon" : "Add to cart"}</button>
            </div>
            <details className="product-information">
              <summary><FileText size={18} /> Product information <ChevronDown size={18} /></summary>
              <div>
                <p>{selectedProduct.generic || selectedProduct.brand}</p>
                <dl>
                  {selectedProduct.productType ? <div><dt>Product type</dt><dd>{selectedProduct.productType.replaceAll("_", " ")}</dd></div> : null}
                  {selectedProduct.regulatoryStatus ? <div><dt>Regulatory status</dt><dd>{selectedProduct.regulatoryStatus.replaceAll("_", " ")}</dd></div> : null}
                  {selectedProduct.subcategory ? <div><dt>Category</dt><dd>{selectedProduct.subcategory}</dd></div> : null}
                </dl>
              </div>
            </details>
          </div>
        </> : <div className="catalogue-empty"><Clock3 size={28} /><h1>Loading product…</h1><p>The catalogue is being checked for this product.</p><Link href="/categories">Return to products</Link></div>}
      </section> : <>
        {pageTitle && !showDepartments ? <section className="category-route-banner">
          <div><h1>{pageTitle}</h1><p>{pageDescription}</p><button onClick={() => requestNativeLocation(true)}><LocateFixed size={18} /> {coordinates ? "Location ready" : "Use my location"}</button></div>
          <Image src={pageImage ?? "/marketplace/hero-pharmacy-still-life.webp"} alt="" width={620} height={330} priority unoptimized />
        </section> : !pageTitle ? <section className="market-banner">
          <div className="market-banner-copy"><h1>Find the product. <em>Connect with a pharmacy that has it.</em></h1><p>{publicCatalogMode ? "Browse central product information and indicative From RWF prices. Availability and final prices are confirmed directly with pharmacies on WhatsApp." : "Search once, send an availability request, and continue on WhatsApp with a pharmacy that confirms it can help."}</p><a className="shop-button" href="#marketplace">Browse products <ArrowRight size={18} /></a></div>
          <div className="market-banner-art"><Image src="/marketplace/hero-pharmacy-still-life.webp" alt="Pharmacy and wellness products arranged in the med+250 brand colours" width={760} height={340} priority unoptimized /></div>
        </section> : null}

        {(!pageTitle || showDepartments) && departmentCards.length ? <section className={`department-cards${pageTitle && showDepartments ? " category-index-departments" : ""}`} aria-label="Shop pharmacy departments">
          {departmentCards.map((item) => <article key={item.department}><div><h2>{item.title}</h2><p>{item.description}</p><a href={item.href}>{item.action} <ArrowRight size={15} /></a></div><Image src={item.image} alt={item.imageAlt} width={210} height={150} unoptimized /></article>)}
        </section> : null}

        <section className="marketplace-section" id="marketplace" aria-busy={catalogueBusy}>
          <div className="section-heading"><div>{pageTitle && showDepartments ? <h1>{pageTitle}</h1> : <h2>{pageTitle ?? "Popular products today"}</h2>}{query.trim() ? <p>Best matches for “{query.trim()}”</p> : <p>Pharmacies confirm availability and final price on WhatsApp</p>}</div><span className="catalogue-progress">{visibleProducts.length.toLocaleString()} shown</span></div>
          <div className="smart-filter-bar" aria-label="Catalogue filters">
            <button className="mobile-filter-button" type="button" onClick={() => setFiltersOpen(true)} aria-haspopup="dialog"><SlidersHorizontal size={17} /> Filters and sort{hasActiveFilters ? <b aria-label="Active filters">!</b> : null}</button>
            <div className="desktop-filter-controls">
              <label>Category<select value={category} onChange={(event) => { setCategory(event.target.value); setVisibleCount(INITIAL_PRODUCT_COUNT); }}><CategoryOptions taxonomy={availableTaxonomy} /></select></label>
              <label>Prescription<select value={prescriptionFilter} onChange={(event) => { setPrescriptionFilter(event.target.value); setVisibleCount(INITIAL_PRODUCT_COUNT); }}><option value="all">Any status</option><option value="non_prescription">OTC</option><option value="prescription">Prescription</option><option value="pharmacist_only">Ask pharmacist</option><option value="unclassified">Not classified</option></select></label>
              <label>Form<select value={formFilter} onChange={(event) => { setFormFilter(event.target.value); setVisibleCount(INITIAL_PRODUCT_COUNT); }}><option value="all">Any form</option><option value="tablets">Tablets & capsules</option><option value="liquids">Liquids & drops</option><option value="injections">Injections</option><option value="topical">Creams & topical</option><option value="devices">Devices & inhalers</option><option value="other">Other forms</option></select></label>
              <label>Information<select value={availabilityFilter} onChange={(event) => { setAvailabilityFilter(event.target.value); setVisibleCount(INITIAL_PRODUCT_COUNT); }}><option value="all">All products</option><option value="priced">Has indicative price</option><option value="orderable">Can request availability</option><option value="registered">In the product catalogue</option></select></label>
              <label>Sort<select value={sort} onChange={(event) => { setSort(event.target.value); setVisibleCount(INITIAL_PRODUCT_COUNT); }}><option value="relevance">Best match</option><option value="az">Name: A–Z</option><option value="za">Name: Z–A</option><option value="price">Lowest indicative price</option></select></label>
            </div>
            <div className="view-toggle" aria-label="Product view"><button type="button" aria-label="Grid view" aria-pressed={viewMode === "grid"} onClick={() => { setViewMode("grid"); trackMarketplaceEvent("catalogue_view_changed", { view: "grid" }); }}><Grid3X3 size={15} /></button><button type="button" aria-label="List view" aria-pressed={viewMode === "list"} onClick={() => { setViewMode("list"); trackMarketplaceEvent("catalogue_view_changed", { view: "list" }); }}><List size={16} /></button></div>
            {query || hasActiveFilters ? <button className="clear-filters" onClick={clearCatalogueFilters}><SlidersHorizontal size={14} /> Reset</button> : null}
          </div>
          {catalogueBusy && visibleProducts.length ? <p className="catalogue-refresh-status" role="status" aria-live="polite"><LoaderCircle className="button-spinner" size={14} aria-hidden="true" /> Updating matches…</p> : null}
          {catalogueBusy && !visibleProducts.length ? <CatalogueSkeleton /> : visibleProducts.length ? <div className={`product-grid ${viewMode === "list" ? "list-view" : ""}`} aria-busy={catalogueBusy} data-testid="product-grid">
            {visibleProducts.map((product, index) => <ProductCard
              product={product}
              index={index}
              catalogueSize={accessibleCatalogueSize}
              previewMode={previewMode && !publicCatalogMode}
              publicCatalogMode={publicCatalogMode}
              onAdd={add}
              key={product.id}
            />)}
          </div> : <div className="catalogue-empty"><Search size={28} /><h3>No close product match</h3><p>Try a brand, generic name, symptom, dosage form, or remove one of the filters.</p><button onClick={clearCatalogueFilters}>Reset search and filters</button></div>}
          {visibleProducts.length ? <div ref={productLoadSentinelRef} className={`infinite-scroll-sentinel${catalogueBusy && hasMoreProducts ? " is-loading" : ""}`} role="status" aria-live="polite" aria-atomic="true" data-testid="product-scroll-sentinel">
            {hasMoreProducts ? <><span className="infinite-scroll-spinner" aria-hidden="true" /><span>{catalogueBusy ? "Loading more products…" : "Keep scrolling for more products"}</span></> : <span>All {catalogueMatchCount.toLocaleString()} matching products are loaded</span>}
          </div> : null}
        </section>
      </>}
      </div>

      <footer><Link className="brand footer-brand" href="/" aria-label="med+250 home"><BrandLogo /></Link><p>MED+250 does not diagnose, prescribe, recommend treatment, or replace a qualified health professional.</p><nav aria-label="Footer"><Link href="/categories">Products</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><button onClick={openPortal}>For Pharmacies</button></nav></footer>

      {filtersOpen ? <div className="filter-overlay" onMouseDown={(event) => event.target === event.currentTarget && setFiltersOpen(false)}>
        <section className="filter-dialog" role="dialog" aria-modal="true" aria-labelledby="catalogue-filter-title" aria-describedby="catalogue-filter-description" data-modal-root="catalogue-filters" tabIndex={-1}>
          <div className="filter-dialog-head"><div><span>REFINE RESULTS</span><h2 id="catalogue-filter-title">Filters and sort</h2><p id="catalogue-filter-description">Narrow the catalogue without losing your search.</p></div><button data-autofocus onClick={() => setFiltersOpen(false)} aria-label="Close filters"><X size={20} /></button></div>
          <div className="filter-dialog-fields">
            <label>Category<select value={category} onChange={(event) => { setCategory(event.target.value); setVisibleCount(INITIAL_PRODUCT_COUNT); }}><CategoryOptions taxonomy={availableTaxonomy} /></select></label>
            <label>Prescription<select value={prescriptionFilter} onChange={(event) => { setPrescriptionFilter(event.target.value); setVisibleCount(INITIAL_PRODUCT_COUNT); }}><option value="all">Any status</option><option value="non_prescription">OTC</option><option value="prescription">Prescription</option><option value="pharmacist_only">Ask pharmacist</option><option value="unclassified">Not classified</option></select></label>
            <label>Form<select value={formFilter} onChange={(event) => { setFormFilter(event.target.value); setVisibleCount(INITIAL_PRODUCT_COUNT); }}><option value="all">Any form</option><option value="tablets">Tablets & capsules</option><option value="liquids">Liquids & drops</option><option value="injections">Injections</option><option value="topical">Creams & topical</option><option value="devices">Devices & inhalers</option><option value="other">Other forms</option></select></label>
            <label>Information<select value={availabilityFilter} onChange={(event) => { setAvailabilityFilter(event.target.value); setVisibleCount(INITIAL_PRODUCT_COUNT); }}><option value="all">All products</option><option value="priced">Has indicative price</option><option value="orderable">Can request availability</option><option value="registered">In the product catalogue</option></select></label>
            <label>Sort<select value={sort} onChange={(event) => { setSort(event.target.value); setVisibleCount(INITIAL_PRODUCT_COUNT); }}><option value="relevance">Best match</option><option value="az">Name: A–Z</option><option value="za">Name: Z–A</option><option value="price">Lowest indicative price</option></select></label>
          </div>
          <div className="filter-dialog-actions"><button className="filter-reset" onClick={clearCatalogueFilters} disabled={!query && !hasActiveFilters}>Reset all</button><button className="primary-wide" onClick={() => { setFiltersOpen(false); announce(`${catalogueMatchCount.toLocaleString()} products ready to browse.`); }}>Show {catalogueMatchCount.toLocaleString()} products</button></div>
        </section>
      </div> : null}

      {cartOpen ? <div className="overlay order-wizard-overlay" onMouseDown={(event) => event.target === event.currentTarget && setCartOpen(false)}>
        <aside className="drawer order-wizard" role="dialog" aria-modal="true" aria-labelledby="order-basket-title" data-modal-root="order-basket" tabIndex={-1}>
          <header className="order-wizard-head"><div><h2 id="order-basket-title">Your cart</h2><p>{basketCount} {basketCount === 1 ? "item" : "items"}</p></div><button data-autofocus onClick={() => { setCartOpen(false); setRecentlyAddedBrand(""); }} aria-label="Close cart"><X size={22} /></button></header>
          {!orderSent ? <OrderWizardProgress step={checkoutStep} /> : null}
          <div className="order-wizard-body" ref={orderWizardBodyRef}>
            {!orderSent && checkoutStep === 1 ? <section className="order-step-panel" aria-labelledby="order-review-heading">
              {recentlyAddedBrand ? <p className="order-added-feedback" role="status"><CircleCheck size={21} /> <b>{recentlyAddedBrand}</b> added to your cart</p> : null}
              <div className="order-step-heading"><h3 id="order-review-heading">Review products</h3>{cart.length ? <span>{cart.length} {cart.length === 1 ? "product" : "products"}</span> : null}</div>
              <div className={`cart-list order-review-list${showAllCartItems ? " show-all" : ""}`}>{displayedCartItems.map((item) => {
                const hasImage = Boolean(item.imageUrl ?? item.imageUrls?.[0]);
                return <div className={`cart-item order-review-item${hasImage ? "" : " without-image"}`} key={item.id}>
                  {hasImage ? <ProductVisual product={item} small /> : null}
                  <div><b>{[item.brand, item.strength].filter(Boolean).join(" ")}</b>{item.generic || item.packSize ? <small>{[item.generic, item.packSize ? `Pack ${item.packSize}` : ""].filter(Boolean).join(" · ")}</small> : null}<label className="substitute-check"><input type="checkbox" checked={item.substitutesAllowed} disabled={requestLocked} onChange={(event) => setSubstituteConsent(item.id, event.target.checked)} /> Allow a pharmacist-proposed substitute</label></div>
                  <div className="quantity"><button onClick={() => adjust(item.id, -1)} disabled={requestLocked} aria-label={`Decrease ${item.brand} quantity`}><Minus size={15} /></button><b>{item.quantity}</b><button onClick={() => adjust(item.id, 1)} disabled={requestLocked} aria-label={`Increase ${item.brand} quantity`}><Plus size={15} /></button></div>
                </div>;
              })}</div>
              {cart.length > 2 ? <button type="button" className="order-list-toggle" onClick={() => setShowAllCartItems((current) => !current)}><List size={18} /> {showAllCartItems ? "Show fewer products" : `View all ${cart.length} products`}</button> : null}
              {!cart.length ? <div className="empty-request"><ShoppingCart size={28} /><b>Your cart is empty</b><p>Add products from the catalogue to continue.</p></div> : null}
              {customerMessage ? <p className="form-success" role="status" aria-live="polite"><CircleCheck size={15} /> {customerMessage}</p> : null}
              {restoredActiveOrders.length ? <div className="sent-timeline compact"><div><b>{restoredActiveOrders.length} active {restoredActiveOrders.length === 1 ? "request" : "requests"}</b><small>Open an existing request before starting another.</small></div>{restoredActiveOrders.map((order) => <button className="text-action" key={order.orderId} onClick={() => openRestoredOrder(order)} disabled={ordering}>Open {order.reference} · {order.offerCount} {order.offerCount === 1 ? "confirmation" : "confirmations"}</button>)}</div> : null}
              {checkoutError ? <p className="form-error" role="alert"><CircleAlert size={15} /> {checkoutError}</p> : null}
            </section> : null}

            {!orderSent && checkoutStep === 2 ? <section className="order-step-panel order-details-panel" aria-labelledby="order-details-heading">
              <div className="order-step-heading"><h3 id="order-details-heading">How should pharmacies reach you?</h3></div>
              <div className="whatsapp-field"><label htmlFor="customer-whatsapp">WhatsApp number <small>required · remembered for your next visit</small></label><div><select value={whatsappCountry} disabled={requestLocked} onChange={(event) => { setWhatsappCountry(event.target.value as CountryCode); setWhatsappTouched(false); }} aria-label="WhatsApp country code">{whatsappCountries.map((item) => <option value={item.country} key={item.country}>{item.name} (+{item.callingCode})</option>)}</select><input id="customer-whatsapp" value={whatsapp} required disabled={requestLocked} onBlur={() => setWhatsappTouched(true)} onChange={(event) => { setWhatsapp(event.target.value.replace(/\D/g, "").slice(0, 15)); setWhatsappTouched(false); }} placeholder="78 000 000" inputMode="tel" autoComplete="tel-national" aria-invalid={whatsappTouched && !customerWhatsapp} aria-describedby={whatsappTouched && !customerWhatsapp ? "customer-whatsapp-error" : undefined} /></div></div>
              {whatsappTouched && !customerWhatsapp ? <p id="customer-whatsapp-error" className="form-error" role="alert"><CircleAlert size={15} /> Enter a valid WhatsApp number for the selected country.</p> : null}
              <fieldset className="fulfilment-choice"><legend>What fulfilment would you discuss if available?</legend><div role="radiogroup" aria-label="Fulfilment preference">
                <button type="button" role="radio" aria-checked={deliveryPreference === "either"} className={deliveryPreference === "either" ? "selected" : ""} onClick={() => setDeliveryPreference("either")} disabled={requestLocked}><PackageCheck size={23} /><span>Pickup or delivery</span>{deliveryPreference === "either" ? <Check size={15} /> : null}</button>
                <button type="button" role="radio" aria-checked={deliveryPreference === "pickup"} className={deliveryPreference === "pickup" ? "selected" : ""} onClick={() => setDeliveryPreference("pickup")} disabled={requestLocked}><ShoppingBag size={23} /><span>Pickup</span>{deliveryPreference === "pickup" ? <Check size={15} /> : null}</button>
                <button type="button" role="radio" aria-checked={deliveryPreference === "delivery"} className={deliveryPreference === "delivery" ? "selected" : ""} onClick={() => setDeliveryPreference("delivery")} disabled={requestLocked}><MapPin size={23} /><span>Delivery</span>{deliveryPreference === "delivery" ? <Check size={15} /> : null}</button>
              </div></fieldset>
              <div className="order-location-heading"><h3>Where should pharmacies search?</h3></div>
              <div className="location-choice-row order-location-options">
                {coordinates ? <button type="button" className="location-panel ready" onClick={() => requestNativeLocation(false)} disabled={requestLocked || locationLoading} aria-busy={locationLoading}><span><LocateFixed size={20} /></span><div><b>{locationLoading ? "Updating location…" : "Location ready"}</b><small>{location}</small></div>{locationLoading ? <LoaderCircle className="button-spinner" size={18} aria-hidden="true" /> : <Check size={18} />}</button> : <button type="button" className="location-panel location-action" onClick={() => requestNativeLocation(false)} disabled={requestLocked || locationLoading} aria-busy={locationLoading}><span>{locationLoading ? <LoaderCircle className="button-spinner" size={20} aria-hidden="true" /> : <LocateFixed size={20} />}</span><div><b>{locationLoading ? "Finding your location…" : "Use current location"}</b><small>Detect from this device</small></div><ChevronRight size={18} /></button>}
                {googleMapsBrowserKey ? <button type="button" className="location-panel map-location-action" onClick={() => { setCheckoutError(""); setMapLocationOpen(true); }} disabled={requestLocked}><span><MapPin size={20} /></span><div><b>Choose on map</b><small>Search address or place pin</small></div><ChevronRight size={18} /></button> : null}
              </div>
              {cartRequiresPrescription || prescription || prescriptionError ? <><label className={`upload order-prescription${prescriptionError ? " has-error" : ""}`}><Upload size={18} /><span><b>{prescription ? prescription.name : "Attach required prescription"}</b><small>Visible only to the pharmacy you choose · max 10 MB</small></span><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={requestLocked} aria-invalid={Boolean(prescriptionError)} aria-describedby={prescriptionError ? "prescription-error" : undefined} onChange={(event) => handlePrescriptionChange(event.target.files?.[0])} /></label>{prescriptionError ? <p id="prescription-error" className="form-error" role="alert"><CircleAlert size={15} /> {prescriptionError}</p> : null}</> : null}
              {mapLocationOpen ? <GoogleMapLocationPicker apiKey={googleMapsBrowserKey} initialCoordinates={coordinates} onCancel={() => setMapLocationOpen(false)} onChoose={applyMapLocation} /> : null}
              {checkoutError ? <p className="form-error" role="alert"><CircleAlert size={15} /> {checkoutError}</p> : null}
            </section> : null}

            {!orderSent && checkoutStep === 3 ? <section className="order-step-panel order-confirm-panel" aria-labelledby="order-confirm-heading">
              <div className="order-step-heading"><h3 id="order-confirm-heading">Review and send your availability request</h3></div>
              <div className="order-confirm-summary"><div><span>Products</span><b>{basketCount} {basketCount === 1 ? "item" : "items"}</b></div><div><span>WhatsApp</span><b>{customerWhatsapp ? `+${customerWhatsapp}` : "Not provided"}</b></div><div><span>Fulfilment</span><b>{deliveryPreference === "either" ? "Pickup or delivery" : deliveryPreference === "pickup" ? "Pickup" : "Delivery"}</b></div><div><span>Location</span><b>{coordinates ? "Location ready" : "Location needed"}</b></div></div>
              <div className="order-confirm-products">{cart.slice(0, 3).map((item) => {
                const hasImage = Boolean(item.imageUrl ?? item.imageUrls?.[0]);
                return <div className={hasImage ? "" : "without-image"} key={item.id}>
                  {hasImage ? <ProductVisual product={item} small /> : null}
                  <span><b>{item.brand}</b><small>{[item.strength, `Qty ${item.quantity}`].filter(Boolean).join(" · ")}</small></span>
                </div>;
              })}{cart.length > 3 ? <p>+ {cart.length - 3} more {cart.length - 3 === 1 ? "product" : "products"}</p> : null}</div>
              {basketIndicativeFrom > 0 ? <div className="estimate"><span>Central indicative total</span><b>From RWF {rwf.format(basketIndicativeFrom)}</b><small>Information only. The pharmacy confirms its final price on WhatsApp.</small></div> : null}
              {!previewMode && customerSessionAvailable !== true ? turnstileSiteKey ? <><Turnstile key={captchaVersion} siteKey={turnstileSiteKey} onToken={(token) => { setCaptchaToken(token); if (token) setCaptchaError(""); }} onError={setCaptchaError} />{captchaError ? <p className="form-error" role="alert"><CircleAlert size={15} /> {captchaError}</p> : null}</> : <p className="privacy-note"><ShieldCheck size={14} /> A private guest session and backend request limits protect this request.</p> : null}
              {checkoutError ? <p className="form-error" role="alert"><CircleAlert size={15} /> {checkoutError}</p> : null}
              {pendingOrderAttempt?.rpcAttempted ? <p className="privacy-note"><ShieldCheck size={14} /> This attempt may already be saved. Retry with the same secure request ID to recover it safely.</p> : null}
              {cart.length || requestLocked ? <button className="text-action" onClick={resetRequest} disabled={ordering}>{requestLocked ? "Reset request" : "Clear request"}</button> : null}
            </section> : null}

            {orderSent ? <div className="sent-state"><span><Check size={35} /></span><h2>Availability request sent</h2><p>{activeOrderNoRecipients ? "No pharmacy could receive this request. You can close it and try again later." : "MED+250 is waiting for pharmacies to confirm that they have every requested product."}</p><div className="sent-timeline"><div><b>Request sent</b><small>{activeOrderId}</small></div><div><b>{activeOrderNoRecipients ? "No pharmacy response possible" : activeOrderExpired ? "Response window ended" : "Waiting for availability confirmations"}</b><small>{activeOrderNoRecipients ? "Nothing was shared with a pharmacy." : activeOrderExpired ? "No pharmacy confirmed before this request expired." : "Only pharmacies that confirm availability will appear. Final price is discussed on WhatsApp."}</small></div></div><button className="primary-wide" onClick={() => { setCartOpen(false); setOffersOpen(true); }}>View request status <ArrowRight size={18} /></button><button className="text-action" onClick={() => closeAndResetOrder("cancelled")} disabled={closingOrder}>{closingOrder ? "Closing request…" : "Cancel request"}</button></div> : null}
            {orderSent && restoredActiveOrders.some((order) => order.orderId !== activeOrderId) ? <div className="sent-timeline"><div><b>Other active requests</b><small>Review or close each request before starting another.</small></div>{restoredActiveOrders.filter((order) => order.orderId !== activeOrderId).map((order) => <button className="text-action" key={order.orderId} onClick={() => openRestoredOrder(order)} disabled={ordering}>Open {order.reference} · {order.offerCount} {order.offerCount === 1 ? "confirmation" : "confirmations"}</button>)}</div> : null}
          </div>
          {!orderSent ? <footer className="order-wizard-actions">
            {checkoutStep === 1 ? <><button type="button" className="order-secondary-action" onClick={() => setCartOpen(false)}>Continue shopping</button><button type="button" className="order-primary-action" onClick={continueToOrderDetails} disabled={!cart.length}>Continue to details <ArrowRight size={18} /></button></> : null}
            {checkoutStep === 2 ? <><button type="button" className="order-secondary-action" onClick={() => setCheckoutStep(1)}><ChevronLeft size={18} /> Back</button><button type="button" className="order-primary-action" onClick={continueToOrderConfirmation}>Review request <ArrowRight size={18} /></button></> : null}
            {checkoutStep === 3 ? <><button type="button" className="order-secondary-action" onClick={() => setCheckoutStep(2)}><ChevronLeft size={18} /> Back</button><button type="button" className="order-primary-action" aria-busy={ordering} disabled={!cart.length || ordering || Boolean(prescriptionError) || (!previewMode && Boolean(turnstileSiteKey) && customerSessionAvailable !== true && !captchaToken)} onClick={submitOrder}>{ordering ? <LoaderCircle className="button-spinner" size={18} aria-hidden="true" /> : null}{ordering ? "Sending request…" : previewMode ? "Requests unavailable" : turnstileSiteKey && customerSessionAvailable === null ? "Checking secure session…" : requestLocked ? "Retry secure request" : "Send availability request"}{!ordering ? <ArrowRight size={18} /> : null}</button></> : null}
          </footer> : null}
        </aside>
      </div> : null}

      {offersOpen ? <section className={`offers-panel${!activeOrderId ? " is-empty" : ""}`} role="dialog" aria-modal="true" aria-labelledby="order-status-title" data-modal-root="order-status" tabIndex={-1}><div className="offers-head"><div><span>{activeOrderId ? `REQUEST STATUS · ${activeOrderId.slice(0, 8).toUpperCase()}` : "MY REQUESTS"}</span><h2 id="order-status-title">{!activeOrderId ? "No active requests" : activeOrderSelected ? "Your pharmacy contact" : activeOrderNoRecipients ? "No response available" : activeOrderExpired ? "Request expired" : "Pharmacies that confirmed availability"}</h2><p aria-live="polite">{!activeOrderId ? "Pharmacies that confirm availability for a request will appear here." : offers.length ? `${offers.length} ${offers.length === 1 ? "pharmacy has" : "pharmacies have"} confirmed availability for all requested products.` : activeOrderNoRecipients ? "No pharmacy received this request. Nothing was shared and you can close it safely." : activeOrderExpired ? "The response window ended before a pharmacy confirmed availability." : `Waiting for a pharmacy to confirm availability.${activeOrderMinutesRemaining != null ? ` About ${activeOrderMinutesRemaining} minutes remain.` : ""} This page updates automatically.`}</p></div><button type="button" data-autofocus onClick={() => setOffersOpen(false)} aria-label="Close request status"><X size={20} /></button></div>
        {checkoutError ? <p className="form-error" role="alert"><CircleAlert size={15} /> {checkoutError}</p> : null}
        {!activeOrderId ? <div className="offers-empty"><PackageCheck size={29} /><b>No active requests</b><p>Add products and send one availability request. Only pharmacies that confirm every requested product will appear here.</p><button type="button" className="primary-wide" onClick={() => { setOffersOpen(false); setCheckoutStep(1); setCartOpen(true); }}>Open request basket</button></div> : !offers.length ? <div className={`offers-empty ${activeOrderExpired || activeOrderNoRecipients ? "terminal" : ""}`}>{activeOrderExpired || activeOrderNoRecipients ? <CircleAlert size={29} /> : <Clock3 size={29} />}<b>{activeOrderNoRecipients ? "No pharmacy could receive this request" : activeOrderExpired ? "No pharmacy confirmed in time" : "Waiting for availability confirmations"}</b><p>{activeOrderNoRecipients ? "Close this request and try again later. Your basket can be rebuilt from the catalogue." : activeOrderExpired ? "Close this expired request to start another one." : "Only pharmacies that confirm every requested product will appear here. MED+250 publishes no pharmacy stock."}</p>{activeOrderExpired || activeOrderNoRecipients ? <button type="button" className="primary-wide" onClick={() => closeAndResetOrder("cancelled")} disabled={closingOrder}>{closingOrder ? "Closing request…" : "Close request"}</button> : null}</div> : <div className="quotes">{offers.map((offer) => <article key={offer.id}><div className="quote-brand"><span><Cross size={18} /></span><div><h3>{offer.pharmacyName}</h3><p>{offer.distanceM >= 0 ? `Approx. ${(offer.distanceM / 1_000).toFixed(1)} km away` : "National service area · confirm arrangements"}</p></div></div><div className="availability complete"><Check size={15} />All requested products confirmed</div><div className="availability fulfilment"><PackageCheck size={15} />{offer.fulfilmentMethod === "pickup" ? "Pickup possible" : offer.fulfilmentMethod === "delivery" ? "Delivery possible" : "Pickup or delivery possible"}</div><div className="offer-items">{offer.items.map((item) => { const itemDetails = [item.product?.brand || item.offeredProductId, item.product?.strength, item.product?.packSize ? `Pack ${item.product.packSize}` : "", item.quantity ? `Qty ${item.quantity}` : "", item.unitPriceRwf ? `Optional estimate RWF ${rwf.format(item.unitPriceRwf)} each` : ""].filter(Boolean); return <div key={item.id}><b>{item.isSubstitute ? "Substitute proposed" : "Requested product"}</b>{itemDetails.length ? <small>{itemDetails.join(" · ")}</small> : null}</div>; })}</div>{offer.totalRwf > 0 ? <div className="quote-price"><span>Optional pharmacy estimate</span><b>RWF {rwf.format(offer.totalRwf)}</b><small>{offer.readyInMinutes ? `Ready in about ${offer.readyInMinutes} minutes · ` : ""}Any price shown here is not final.</small></div> : offer.readyInMinutes ? <div className="quote-price"><small>Ready in about {offer.readyInMinutes} minutes</small></div> : null}<div className="quote-actions"><button type="button" onClick={() => chooseOffer(offer)} disabled={selectionLocked} aria-busy={selectingOfferId === offer.id}>{selectingOfferId === offer.id ? <LoaderCircle className="button-spinner" size={15} aria-hidden="true" /> : null}{offer.status === "selected" ? "Chosen" : selectionLocked ? "Choice closed" : selectingOfferId === offer.id ? "Selecting…" : "Continue with pharmacy"}</button><span className="contact-locked"><ShieldCheck size={15} /> {selectionLocked ? "Pharmacy chosen" : "WhatsApp contact unlocks after choice"}</span></div></article>)}</div>}
        {activeOrderSelected ? <div className="selected-contact">{selectedContact ? <><div><CircleCheck size={23} /><span><b>{selectedContact.pharmacyName} confirmed availability</b><small>Continue on WhatsApp to reconfirm the exact product, final price, pickup or delivery, and whether you want to proceed.</small></span></div><div>{whatsappUrl(selectedContact.whatsapp, `Hello, ${selectedContact.pharmacyName} confirmed availability for my MED+250 request ${activeOrderId}. Please reconfirm the products, final price, and pickup or delivery details.`) ? <a onClick={() => trackMarketplaceEvent("whatsapp_handoff", { configured: true })} href={whatsappUrl(selectedContact.whatsapp, `Hello, ${selectedContact.pharmacyName} confirmed availability for my MED+250 request ${activeOrderId}. Please reconfirm the products, final price, and pickup or delivery details.`) ?? undefined} target="_blank" rel="noreferrer"><MessageCircle size={16} /> Continue on WhatsApp</a> : null}</div></> : <div><CircleAlert size={23} /><span><b>Pharmacy contact unavailable</b><small>You can close this request and try again.</small></span></div>}<div className="quote-actions"><button onClick={() => closeAndResetOrder("completed")} disabled={closingOrder}>{closingOrder ? "Updating request…" : "Finish request"}</button><button onClick={() => closeAndResetOrder("cancelled")} disabled={closingOrder}>Cancel request</button></div></div> : null}
      </section> : null}

      {portalOpen ? <div className="portal-overlay" role="presentation">
        {portalStage !== "workspace" ? <section className="portal-auth" role="dialog" aria-modal="true" aria-labelledby="pharmacy-signin-title" aria-describedby="pharmacy-signin-progress" aria-busy={portalLoading} data-modal-root="portal-auth" tabIndex={-1}><button className="portal-close" data-autofocus onClick={() => setPortalOpen(false)} aria-label="Close pharmacy portal"><X size={20} /></button><Link className="brand" href="/"><BrandLogo /></Link><ol className="wizard-progress" id="pharmacy-signin-progress" aria-label="Pharmacy sign-in progress"><li className="active" aria-current={portalStage === "signin" ? "step" : undefined}><span>1</span> WhatsApp</li><li className={portalStage === "otp" ? "active" : ""} aria-current={portalStage === "otp" ? "step" : undefined}><span>2</span> Verify</li><li><span>3</span> Workspace</li></ol><h2 id="pharmacy-signin-title">{portalStage === "signin" ? "Sign in with registered WhatsApp number" : "Enter your WhatsApp code"}</h2>
          {portalStage === "signin" ? <><label>WhatsApp number<div className="portal-phone-input"><span>+250</span><input value={pharmacyWhatsapp} onChange={(event) => setPharmacyWhatsapp(event.target.value.replace(/\D/g, "").slice(0, 9))} placeholder="78 000 0000" inputMode="tel" autoComplete="tel" /></div></label><button className="primary-wide" onClick={sendPharmacyCode} disabled={portalLoading}><MessageCircle size={17} /> {portalLoading ? "Sending code…" : "Send code on WhatsApp"}</button></> : <><small className="portal-otp-note">Use the 6-digit code sent to +250 {pharmacyWhatsapp}.</small><label>Verification code<input value={pharmacyOtp} onChange={(event) => setPharmacyOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" inputMode="numeric" autoComplete="one-time-code" maxLength={6} /></label><button className="primary-wide" onClick={verifyPharmacyCode} disabled={portalLoading}>{portalLoading ? "Verifying…" : "Verify and open pharmacy portal"} <ArrowRight size={17} /></button><button className="text-action" onClick={() => { setPortalStage("signin"); setPharmacyOtp(""); setPharmacyOtpChallengeId(""); setPortalError(""); setPortalMessage(""); }} disabled={portalLoading}>Use another WhatsApp number</button></>}
          {portalLoading ? <div className="inline-loading" role="status"><LoaderCircle className="button-spinner" size={17} /> Securely checking your pharmacy access…</div> : null}{portalMessage ? <p className="form-success" role="status" aria-live="polite"><CircleCheck size={15} /> {portalMessage}</p> : null}{portalError ? <p className="form-error" role="alert"><CircleAlert size={15} /> {portalError}</p> : null}
          {unregisteredPharmacyWhatsapp ? <div className="portal-exception-backdrop" role="presentation"><div className="portal-exception" role="alertdialog" aria-modal="true" aria-labelledby="unregistered-whatsapp-title" data-modal-root="unregistered-pharmacy" tabIndex={-1}><button data-autofocus onClick={() => setUnregisteredPharmacyWhatsapp("")} aria-label="Close"><X size={18} /></button><span><CircleAlert size={22} /></span><h3 id="unregistered-whatsapp-title">WhatsApp number not registered</h3><p>This number is not linked to a pharmacy in MED+250. Contact the administrator to register the pharmacy or ask for a contact correction.</p><a className="primary-wide" href={`https://wa.me/${unregisteredPharmacyWhatsapp}?text=${encodeURIComponent(`Hello MED+250 admin, please help register or correct pharmacy WhatsApp number +250${pharmacyWhatsapp}.`)}`} target="_blank" rel="noreferrer"><MessageCircle size={17} /> Contact admin on WhatsApp</a><button className="text-action" onClick={() => setUnregisteredPharmacyWhatsapp("")}>Try another number</button></div></div> : null}
        </section> : <section className="portal-shell" role="dialog" aria-modal="true" aria-labelledby="pharmacy-workspace-title" aria-busy={portalLoading} data-modal-root="portal-workspace" tabIndex={-1}>
          <aside className="portal-sidebar"><Link className="brand" href="/"><BrandLogo /></Link><small>PHARMACY DESK</small><nav><button className={portalTab === "requests" ? "active" : ""} onClick={() => setPortalTab("requests")}><Bell size={18} /> Availability requests {pharmacyRequests.length ? <b>{pharmacyRequests.length}</b> : null}</button><button className={portalTab === "profile" ? "active" : ""} onClick={() => setPortalTab("profile")}><HeartPulse size={18} /> Pharmacy profile</button></nav><div className="portal-user"><span>{activeMembership?.pharmacyName.slice(0, 2).toUpperCase()}</span><div><b>{activeMembership?.pharmacyName}</b><small>{activeMembership?.role}</small></div></div><button className="text-action" onClick={leavePharmacyPortal} disabled={portalLoading}>Sign out of pharmacy portal</button></aside>
          <div className="portal-main"><div className="portal-top"><div><span>PHARMACY PORTAL</span><h2 id="pharmacy-workspace-title">{portalTab === "requests" ? "Availability requests" : "Pharmacy profile"}</h2><p>Only private customer requests assigned to this pharmacy are shown. No pharmacy-specific stock or price list is published.</p></div><button data-autofocus onClick={() => setPortalOpen(false)} aria-label="Close pharmacy portal"><X size={20} /></button></div>
            {portalMessage ? <p className="form-success"><CircleCheck size={15} /> {portalMessage}</p> : null}{portalError ? <p className="form-error"><CircleAlert size={15} /> {portalError}</p> : null}
            {portalTab === "requests" ? <>
              <div className="portal-metrics"><div><span><Bell size={18} /></span><p>OPEN REQUESTS</p><b>{pharmacyRequests.length}</b><small>recipient-authorized only</small></div><div><span><Clock3 size={18} /></span><p>LOCATION VIEW</p><b>Approximate</b><small>coarse distance only</small></div><div><span><ShieldCheck size={18} /></span><p>CUSTOMER CONNECTIONS</p><b>{pharmacySelectedOrders.length}</b><small>contact released after choice</small></div></div>
              <div className="request-table-head"><div><h3>Open availability requests</h3><span>Private requests · live updates</span></div><button type="button" onClick={refreshPharmacyRequests} disabled={portalLoading} aria-busy={portalLoading}>{portalLoading ? <LoaderCircle className="button-spinner" size={15} aria-hidden="true" /> : <LocateFixed size={15} />} {portalLoading ? "Refreshing…" : "Refresh"}</button></div>
              {pharmacyRequests.length ? <div className="request-list">{pharmacyRequests.map((request) => <article key={request.orderId}><div className="request-id"><span className="new">OPEN</span><b>{request.orderId.slice(0, 8).toUpperCase()}</b>{formatDate(request.createdAt) ? <small>{formatDate(request.createdAt)}</small> : null}</div><div><b>{request.distanceM >= 0 ? `Approx. ${(request.distanceM / 1_000).toFixed(1)} km away` : "National service request"}</b><small><MapPin size={12} /> Exact customer location remains private</small></div><div><b>{request.items.length} {request.items.length === 1 ? "product" : "products"}</b>{request.hasPrescription ? <small>Prescription unlocks only if the customer chooses you</small> : null}</div><div><b>{request.deliveryPreference}</b><small>Confirm availability; price is optional and not final</small></div><button onClick={() => beginOffer(request)}>Review request <ArrowRight size={15} /></button></article>)}</div> : <div className="portal-empty"><PackageCheck size={29} /><b>No open request is assigned</b><p>New customer availability requests assigned to this pharmacy will appear here.</p></div>}
              <div className="request-table-head"><div><h3>Customers who chose this pharmacy</h3><span>Contact and prescription access follow the customer&apos;s choice</span></div></div>
              {pharmacySelectedOrders.length ? <div className="request-list selected-order-list">{pharmacySelectedOrders.map((order) => <article key={order.orderId}><div className="request-id"><span className="new">SELECTED</span><b>{order.reference}</b>{formatDate(order.selectedAt) ? <small>{formatDate(order.selectedAt)}</small> : null}</div><div><b>{order.deliveryPreference}</b><small>Arrange pickup or delivery directly</small></div>{whatsappUrl(order.customerWhatsapp, `Hello, I’m contacting you from ${activeMembership?.pharmacyName ?? "the pharmacy"} about MED+250 request ${order.reference}. Please confirm availability, final price, and fulfilment details.`) ? <div><a href={whatsappUrl(order.customerWhatsapp, `Hello, I’m contacting you from ${activeMembership?.pharmacyName ?? "the pharmacy"} about MED+250 request ${order.reference}. Please confirm availability, final price, and fulfilment details.`) ?? undefined} target="_blank" rel="noreferrer"><MessageCircle size={14} /> Contact on WhatsApp</a><small>Medication details are not included in the message</small></div> : null}{order.prescriptionUrl ? <div><a href={order.prescriptionUrl} target="_blank" rel="noreferrer"><FileText size={14} /> Open private prescription</a><small>Signed link expires within 10 minutes and never beyond the 24-hour selection window</small></div> : null}</article>)}</div> : <div className="portal-empty"><ShieldCheck size={29} /><b>No customer has chosen this pharmacy yet</b><p>Contact details and prescriptions stay unavailable until a pharmacy confirmation is chosen.</p></div>}
            </> : null}
            {portalTab === "profile" ? <section className="portal-form profile-summary">
              <div><Store size={22} /><span><b>{activeMembership?.pharmacyName}</b><small>Marketplace pharmacy</small></span></div>
              <dl>{activeMembership?.role ? <div><dt>Your role</dt><dd>{activeMembership.role}</dd></div> : null}{activeMembership?.whatsapp ? <div><dt>Primary WhatsApp</dt><dd>+{activeMembership.whatsapp}</dd></div> : null}{activeMembership?.momoCode ? <div><dt>MoMo merchant code</dt><dd>{activeMembership.momoCode}</dd></div> : null}</dl>
              <p>Contact and MoMo details are released only after a customer chooses this pharmacy.</p>
              <div className="contact-edit-panel">
                <h3>Linked phone and WhatsApp contacts</h3>
                <p>Every change is reviewed before contact or login access changes.</p>
                {pharmacyContacts.length ? <div className="pharmacy-contact-list">{pharmacyContacts.map((contact) => <article key={contact.id}><div><b>{contact.displayNumber}</b><small>{contact.contactType === "whatsapp" ? "WhatsApp" : "Phone"}{contact.isPrimary ? " · Primary" : ""}{contact.isLoginEnabled ? " · Login enabled" : ""}</small></div><div><button type="button" onClick={() => beginContactReplacement(contact)} disabled={portalLoading}>Replace</button><button type="button" onClick={() => requestContactRemoval(contact)} disabled={portalLoading}>Request removal</button></div></article>)}</div> : <p>No linked contacts are available yet.</p>}
                {pendingContactEdits.length ? <div className="pending-contact-edits"><b>Pending review</b>{pendingContactEdits.map((request) => <span key={request.id}>{[`${request.action} ${request.contactType}`, request.requestedE164 ? `+${request.requestedE164}` : "", formatDate(request.createdAt)].filter(Boolean).join(" · ")}</span>)}</div> : null}
                <h3>{contactEditAction === "update" ? "Request a contact replacement" : "Request another contact"}</h3>
                <label>Contact type<select value={contactEditType} onChange={(event) => { setContactEditType(event.target.value === "phone" ? "phone" : "whatsapp"); setContactEditAction("add"); setContactEditContactId(null); }}><option value="whatsapp">WhatsApp</option><option value="phone">Phone</option></select></label>
                <label>{contactEditAction === "update" ? "Replacement number" : "New number"}<div className="portal-phone-input"><span>+250</span><input value={contactEditWhatsapp} onChange={(event) => setContactEditWhatsapp(event.target.value.replace(/\D/g, "").slice(0, 9))} placeholder="78 000 0000" inputMode="tel" autoComplete="tel" /></div></label>
                <label>Verification note<textarea value={contactEditNote} onChange={(event) => setContactEditNote(event.target.value)} maxLength={1000} placeholder="Who should MED+250 contact to verify this change?" /></label>
                <button className="primary-wide" onClick={requestContactEdit} disabled={portalLoading}>{portalLoading ? "Submitting…" : contactEditAction === "update" ? "Submit replacement request" : "Submit contact request"}<ArrowRight size={17} /></button>
                {contactEditAction === "update" ? <button className="text-action" type="button" onClick={() => { setContactEditAction("add"); setContactEditContactId(null); setContactEditWhatsapp(""); setContactEditNote(""); }}>Cancel replacement</button> : null}
              </div>
            </section> : null}
          </div>
        </section>}
        {selectedRequest ? <section className="offer-editor"><div className="offers-head"><div><span>CONFIRM PRODUCT AVAILABILITY</span><h2>Request {selectedRequest.orderId.slice(0, 8).toUpperCase()}</h2><p>Confirm every product. Adding a price is optional; any price entered is private, indicative, and must be reconfirmed on WhatsApp.</p></div><button onClick={() => setSelectedRequest(null)} aria-label="Close availability confirmation"><X size={20} /></button></div><div className="offer-items">{selectedRequest.items.map((item) => <article key={item.orderItemId}><div><b>{item.productName}</b><small>{[`Qty ${item.quantity}`, item.packSize ? `Pack ${item.packSize}` : "", item.substitutesAllowed ? "A matching substitute is allowed" : "Exact product only"].filter(Boolean).join(" · ")}</small></div><label><input type="checkbox" checked={offerAvailability[item.orderItemId] ?? false} onChange={(event) => setOfferAvailability((current) => ({ ...current, [item.orderItemId]: event.target.checked }))} /> Available</label>{item.substitutesAllowed ? <label><input type="checkbox" checked={offerSubstitutes[item.orderItemId] ?? false} onChange={(event) => { const checked = event.target.checked; setOfferSubstitutes((current) => ({ ...current, [item.orderItemId]: checked })); setOfferProductIds((current) => ({ ...current, [item.orderItemId]: checked ? "" : item.productId })); }} /> Use substitute</label> : null}{offerSubstitutes[item.orderItemId] ? <label>Substitute product<select value={offerProductIds[item.orderItemId] ?? ""} onChange={(event) => setOfferProductIds((current) => ({ ...current, [item.orderItemId]: event.target.value }))}><option value="">Choose a matching product</option>{orderableCatalogue.filter((product) => product.id !== item.productId && isCompatibleSubstitute(product, item)).map((product) => <option value={product.id} key={product.id}>{[product.brand, product.strength, product.generic, product.packSize ? `Pack ${product.packSize}` : ""].filter(Boolean).join(" · ")}</option>)}</select></label> : null}<label>Optional price estimate<input value={offerPrices[item.orderItemId] ?? ""} onChange={(event) => setOfferPrices((current) => ({ ...current, [item.orderItemId]: event.target.value.replace(/\D/g, "") }))} inputMode="numeric" placeholder="RWF (optional)" disabled={!(offerAvailability[item.orderItemId] ?? false)} /></label></article>)}</div><div className="offer-meta"><label>Possible fulfilment<select value={offerFulfilmentMethod} onChange={(event) => setOfferFulfilmentMethod(event.target.value as "pickup" | "delivery" | "either")} disabled={selectedRequest.deliveryPreference !== "either"}>{selectedRequest.deliveryPreference === "either" ? <><option value="pickup">Pickup</option><option value="delivery">Delivery</option><option value="either">Pickup or delivery</option></> : <option value={selectedRequest.deliveryPreference}>{selectedRequest.deliveryPreference === "pickup" ? "Pickup" : "Delivery"}</option>}</select></label><label>Approximate ready time<input value={offerReadyMinutes} onChange={(event) => setOfferReadyMinutes(event.target.value.replace(/\D/g, ""))} /></label><label>Note<textarea value={offerNote} onChange={(event) => setOfferNote(event.target.value)} placeholder="Optional note for WhatsApp follow-up" /></label></div><button className="primary-wide" onClick={sendOffer} disabled={portalLoading}>Send availability confirmation <ArrowRight size={17} /></button></section> : null}
      </div> : null}
      {feedbackToast ? <div className={`feedback-toast ${feedbackToast.tone === "info" ? "is-info" : ""}`} role="status" aria-live="polite" aria-atomic="true"><CircleCheck size={20} /><span>{feedbackToast.message}</span><button type="button" onClick={() => setFeedbackToast(null)} aria-label="Dismiss notification"><X size={17} /></button></div> : null}
    </main>
  );
}
