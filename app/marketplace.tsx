"use client";

import { lazy, Suspense, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js/min";
import {
  ArrowRight,
  Baby,
  Bell,
  Brush,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock3,
  Cross,
  Droplets,
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
  Scissors,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  SlidersHorizontal,
  Smile,
  Sparkles,
  Store,
  Upload,
  X,
} from "lucide-react";
import BrandLogo from "./brand-logo";
import {
  backendConfigured,
  closeOrder,
  contributeCentralPrice,
  createOrder,
  deletePrescription,
  ensureAnonymousCustomer,
  hasAnonymousCustomerSession,
  hasPermanentPharmacySession,
  loadCatalogue,
  loadCatalogueProductsByIds,
  loadCatalogueTaxonomy,
  loadProductImagePresentation,
  loadCustomerProfile,
  loadMyActiveOrders,
  loadMyPharmacies,
  loadMyPharmacyContacts,
  loadOffers,
  loadPharmacyRequests,
  loadPharmacySelectedOrders,
  loadSelectedContact,
  normalizeDawaNearError,
  requestCustomerWhatsappOtp,
  requestPharmacyWhatsappOtp,
  requestPharmacyContactEdit,
  searchCatalogue,
  selectOffer,
  signOutPharmacy,
  submitOffer,
  subscribeToOffers,
  subscribeToPharmacyNotifications,
  verifyCustomerWhatsappOtp,
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
  type ProductImagePresentation,
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
import {
  catalogueFilterStateKey,
  parseCatalogueNavigationState,
  serializeCatalogueNavigationState,
  withCatalogueReturnPosition,
} from "../lib/catalogue-navigation-state";
import { trackMarketplaceEvent } from "../lib/marketplace-observability";
import {
  NON_PRESCRIPTION_TAXONOMY,
  backendCategoryFor,
  catalogueDepartmentForProduct,
  isNonPrescriptionTaxonomyFilter,
  nonPrescriptionTaxonomyForProduct,
  taxonomyFilterDepartment,
  taxonomyOptionValue,
} from "../lib/non-prescription-taxonomy";
import type { MapCoordinates } from "./google-map-location-picker";
import { customerProductTitle } from "../lib/product-display";
import type { PublicTrustMetrics } from "../lib/public-trust-metrics";
import { marketplaceDate, marketplaceNumber, marketplaceRegionName } from "../lib/marketplace-locale";
import { marketplaceFormatMessage, marketplaceMessage } from "../lib/marketplace-messages";

const Turnstile = lazy(() => import("./turnstile"));
const GoogleMapLocationPicker = lazy(() => import("./google-map-location-picker"));

type CartItem = Product & { quantity: number; substitutesAllowed: boolean };
type Coordinates = MapCoordinates;
type SelectedContact = { pharmacyName: string; whatsapp: string | null; momoCode: string | null };
type PortalTab = "requests" | "catalogue" | "profile";
type CheckoutStep = 1 | 2 | 3 | 4;
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
  initialTrustMetrics?: PublicTrustMetrics | null;
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
const PORTAL_PRODUCT_BATCH_SIZE = 20;
const MAX_RESTORED_PRODUCT_COUNT = 5000;
const CHECKOUT_STEPS: Array<{ id: CheckoutStep; label: string }> = [
  { id: 1, label: marketplaceMessage("request.review_step") },
  { id: 2, label: marketplaceMessage("request.details_step") },
  { id: 3, label: marketplaceMessage("request.verify_step") },
  { id: 4, label: marketplaceMessage("request.confirm_step") },
];

const whatsappCountries = getCountries()
  .map((country) => ({
    country,
    name: marketplaceRegionName(country),
    callingCode: getCountryCallingCode(country),
  }))
  .toSorted((left, right) => left.name.localeCompare(right.name));

const departmentPresentation = [
  {
    department: "Medicines",
    label: marketplaceMessage("inventory.42dce2871e48"),
    href: "/category/medicines",
    title: marketplaceMessage("inventory.42dce2871e48"),
    description: marketplaceMessage("inventory.585151bfca9e"),
    action: marketplaceMessage("inventory.34488696b2e4"),
    image: "/marketplace/category-medicines.webp",
    imageAlt: marketplaceMessage("inventory.cfbe366d40d3"),
  },
  {
    department: "Beauty & Personal Care",
    label: marketplaceMessage("inventory.26055d778cc6"),
    href: "/category/personal-care",
    title: marketplaceMessage("inventory.26055d778cc6"),
    description: marketplaceMessage("inventory.1d9351b971a9"),
    action: marketplaceMessage("inventory.39a67cc7cb52"),
    image: "/marketplace/category-personal-care.webp",
    imageAlt: marketplaceMessage("inventory.c17c9018e4bf"),
  },
  {
    department: "Baby",
    label: marketplaceMessage("inventory.8400cebcc5a9"),
    href: "/category/baby-family",
    title: marketplaceMessage("inventory.8400cebcc5a9"),
    description: marketplaceMessage("inventory.566aff8bd1d6"),
    action: marketplaceMessage("inventory.28ba72bca95c"),
    image: "/marketplace/category-baby-family.webp",
    imageAlt: marketplaceMessage("inventory.84987041d6fe"),
  },
  {
    department: "Health & Household",
    label: marketplaceMessage("inventory.9696efda5bdb"),
    href: "/category/wellness",
    title: marketplaceMessage("inventory.9696efda5bdb"),
    description: marketplaceMessage("inventory.fa4de95130d1"),
    action: marketplaceMessage("inventory.4959cee7f428"),
    image: "/marketplace/category-wellness-devices.webp",
    imageAlt: marketplaceMessage("inventory.4ad83fdca3b5"),
  },
] as const;
const legacyNonPrescriptionCategories = new Set(NON_PRESCRIPTION_TAXONOMY.map(({ legacyCategory }) => legacyCategory));
const accentClasses = ["coral", "blue", "mint", "violet", "amber"];
const configuredMarketplaceMode = process.env.NEXT_PUBLIC_MED250_DEPLOYMENT_MODE || process.env.NEXT_PUBLIC_MARKETPLACE_MODE;
const marketplaceMode = new Set(["preview", "catalog", "live"]).has(configuredMarketplaceMode ?? "")
  ? configuredMarketplaceMode as "preview" | "catalog" | "live"
  : "preview";
const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? "";
const googleMapsBrowserKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY?.trim() ?? "";

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timeout);
  }, [delayMs, value]);
  return debounced;
}

function FeatureLoading({ label }: { label: string }) {
  return <div className="inline-loading" role="status" aria-live="polite"><LoaderCircle className="button-spinner" size={16} aria-hidden="true" /> {label}</div>;
}

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
    <option value="All products">{marketplaceMessage("catalogue.all_categories")}</option>
    {medicines.length ? <optgroup label={marketplaceMessage("inventory.42dce2871e48")}>
      {medicines.some((row) => !row.subcategory) ? <option value="Medicines">{marketplaceMessage("inventory.42dce2871e48")}</option> : null}
      {medicines.filter((row) => row.subcategory).map((row) => <option key={`Medicines-${row.subcategory}`} value={taxonomyOptionValue("Medicines", row.subcategory!)}>{row.subcategory}</option>)}
    </optgroup> : null}
    {nonPrescription.map(({ department, rows }) => <optgroup label={department.label} key={department.label}>
      <option value={department.label}>{marketplaceFormatMessage("inventory.c049259c4a15", [department.label])}</option>
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
      {/* Product files already are optimized WebP objects. Keep their public
          object URLs unchanged: the Supabase image-transform endpoint is not
          enabled for this project and returns 403 for every transformed URL. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={resolvedImageUrl} alt="" width={small ? 54 : 170} height={small ? 44 : 128} loading={eager ? "eager" : "lazy"} decoding="async" />
      {!small && product.form ? <span>{product.form.split(" · ")[0]}</span> : null}
    </div>
  );
}

const productGallerySlides = [
  { label: marketplaceMessage("inventory.e119acb00272"), className: "front" },
  { label: marketplaceMessage("inventory.5de0c18617ee"), className: "left-angle" },
  { label: marketplaceMessage("inventory.b22658f3c374"), className: "right-angle" },
] as const;

const heroArtworkSlides = [
  { src: "/marketplace/category-medicines.webp", alt: "Medicines and pharmacy essentials" },
  { src: "/marketplace/category-personal-care.webp", alt: "Beauty and personal care products" },
  { src: "/marketplace/category-baby-family.webp", alt: "Baby and family care products" },
  { src: "/marketplace/category-wellness-devices.webp", alt: "Health, wellness and household care products" },
] as const;

function HeroArtworkCarousel() {
  const [activeSlide, setActiveSlide] = useState(0);
  const [autoRotate, setAutoRotate] = useState(true);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    if (!autoRotate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    const timer = window.setInterval(() => setActiveSlide((current) => (current + 1) % heroArtworkSlides.length), 5200);
    return () => window.clearInterval(timer);
  }, [autoRotate]);

  function moveSlide(direction: number) {
    setAutoRotate(false);
    setActiveSlide((current) => (current + direction + heroArtworkSlides.length) % heroArtworkSlides.length);
  }

  function selectSlide(index: number) {
    setAutoRotate(false);
    setActiveSlide(index);
  }

  return <section
    className="market-banner-art hero-art-carousel"
    aria-label={marketplaceMessage("inventory.b56c00f55b3e")}
    aria-roledescription="carousel"
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
    <div className="hero-art-track" style={{ transform: `translate3d(-${activeSlide * 25}%, 0, 0)` }}>
      {heroArtworkSlides.map((slide, index) => <figure className="hero-art-slide" aria-hidden={index !== activeSlide} key={slide.src}>
        <Image src={slide.src} alt={slide.alt} width={760} height={340} priority={index === 0} unoptimized />
      </figure>)}
    </div>
    <div className="hero-art-controls" role="group" aria-label={marketplaceMessage("inventory.166857765512")}>
      <span aria-live="polite" aria-atomic="true">{activeSlide + 1} / {heroArtworkSlides.length}</span>
      <div>
        {heroArtworkSlides.map((slide, index) => <button type="button" aria-label={marketplaceFormatMessage("inventory.ce26474fba89", [slide.alt.toLowerCase()])} aria-pressed={index === activeSlide} onClick={() => selectSlide(index)} key={slide.src} />)}
      </div>
      <button
        type="button"
        className="hero-art-toggle"
        aria-label={autoRotate ? marketplaceMessage("inventory.e6690f92c82a") : marketplaceMessage("inventory.39085a9d9671")}
        title={autoRotate ? marketplaceMessage("inventory.0134df4b82b0") : marketplaceMessage("inventory.cac58013cda6")}
        onClick={() => setAutoRotate((current) => !current)}
      >{autoRotate ? <Pause size={15} /> : <Play size={15} />}</button>
    </div>
  </section>;
}

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

  return <section className="product-gallery" aria-label={marketplaceFormatMessage("inventory.d14f9ad114b2", [product.brand])}>
    <div className="product-gallery-thumbnails" role="group" aria-label={marketplaceMessage("inventory.56ab23375c9f")}>
      {productGallerySlides.map((slide, index) => <button
        type="button"
        className={`product-gallery-thumbnail ${slide.className}`}
        aria-label={marketplaceFormatMessage("inventory.ce26474fba89", [slide.label.toLowerCase()])}
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
        aria-label={marketplaceFormatMessage("inventory.c5f63f857653", [product.brand])}
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
      <button type="button" className="product-gallery-arrow previous" onClick={() => moveSlide(-1)} aria-label={marketplaceMessage("inventory.a62eceff26be")}><ChevronLeft size={21} /></button>
      <button type="button" className="product-gallery-arrow next" onClick={() => moveSlide(1)} aria-label={marketplaceMessage("inventory.a33d991e228f")}><ChevronRight size={21} /></button>
      <div className="product-gallery-dots" aria-label={marketplaceMessage("inventory.955bcf8ff97a")}>
        {productGallerySlides.map((slide, index) => <button type="button" aria-label={marketplaceFormatMessage("inventory.ce26474fba89", [slide.label.toLowerCase()])} aria-current={index === activeSlide ? "true" : undefined} onClick={() => selectSlide(index)} key={slide.label} />)}
      </div>
    </div>
    <div className="product-gallery-status">
      <span aria-live="polite">{activeSlide + 1} / {productGallerySlides.length}</span>
      <button type="button" aria-pressed={autoRotate} onClick={() => setAutoRotate((current) => !current)} aria-label={autoRotate ? marketplaceMessage("inventory.bd6967f40b86") : marketplaceMessage("inventory.b4d7ceb54bd8")}>
        {autoRotate ? <Pause size={14} /> : <Play size={14} />}
        {autoRotate ? marketplaceMessage("inventory.7c4a34f0f797") : marketplaceMessage("inventory.3faa01720620")}
      </button>
    </div>
  </section>;
}

function ProductDetailsList({ product }: { product: Product }) {
  const rows = [
    product.strength ? { label: marketplaceMessage("inventory.63ee3a1b965a"), value: product.strength, icon: HeartPulse } : null,
    product.form ? { label: marketplaceMessage("inventory.2e0e960ab320"), value: product.form, icon: Cross } : null,
    product.packSize ? { label: marketplaceMessage("inventory.80dc21673e55"), value: product.packSize, icon: PackageCheck } : null,
    product.manufacturer || product.manufacturerCountry ? { label: marketplaceMessage("inventory.1af384c577f2"), value: [product.manufacturer, product.manufacturerCountry].filter(Boolean).join(" · "), icon: Store } : null,
    product.registrationNumber ? { label: marketplaceMessage("inventory.5546bafd5ec8"), value: product.registrationNumber, icon: ShieldCheck } : null,
    prescriptionLabel(product.prescriptionStatus) ? { label: marketplaceMessage("inventory.9bc867e65b8f"), value: prescriptionLabel(product.prescriptionStatus), icon: FileText } : null,
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
  return <div className="catalogue-skeleton" role="status" aria-live="polite" aria-label={marketplaceMessage("inventory.830bd5128d9e")}>
    {Array.from({ length: 8 }, (_, index) => <div className="product-card-skeleton" aria-hidden="true" key={index}><span /><i /><i /><b /></div>)}
    <span className="sr-only">{marketplaceMessage("inventory.91ee6f3b1369")}</span>
  </div>;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "";
  return marketplaceDate(value);
}

function hasPriceData(product: Pick<Product, "indicativePriceRwf" | "priceIsIndicative">) {
  return product.priceIsIndicative && Number.isFinite(product.indicativePriceRwf) && product.indicativePriceRwf > 0;
}

function prescriptionLabel(status: Product["prescriptionStatus"]) {
  if (status === "prescription") return marketplaceMessage("product.prescription_required");
  if (status === "non_prescription") return marketplaceMessage("product.no_prescription_required");
  if (status === "pharmacist_only") return marketplaceMessage("product.ask_pharmacist");
  return "";
}

function productTitleClass(title: string) {
  const length = title.trim().length;
  if (length >= 160) return "product-title product-title-very-long";
  if (length >= 90) return "product-title product-title-long";
  return "product-title";
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
  onOpen?: (product: Product) => void;
};

type CatalogueHierarchyItem = {
  label: string;
  value: string;
  department: string;
  imageUrl?: string | null;
};

type CatalogueProductGroup = {
  label: string;
  value: string;
  products: Product[];
};

function SubcategoryIcon({ label }: { label: string }) {
  const normalized = label.toLocaleLowerCase();
  const Icon = normalized.includes("baby") || normalized.includes("maternity") || normalized.includes("diaper")
    ? Baby
    : normalized.includes("skin") || normalized.includes("fragrance") || normalized.includes("wellness")
      ? Droplets
      : normalized.includes("shave") || normalized.includes("removal") || normalized.includes("nail")
        ? Scissors
        : normalized.includes("oral")
          ? Smile
          : normalized.includes("makeup") || normalized.includes("hair") || normalized.includes("tool")
            ? Brush
            : PackageCheck;
  return <Icon size={18} />;
}

function SubcategoryRail({
  activeCategory,
  contextLabel,
  items,
  onSelectCategory,
}: {
  activeCategory: string;
  contextLabel: string;
  items: CatalogueHierarchyItem[];
  onSelectCategory: (category: string) => void;
}) {
  const railRef = useRef<HTMLElement>(null);
  const pausedRef = useRef(false);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail || items.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    let frame = 0;
    let previousTime = performance.now();
    let direction = 1;

    const animate = (time: number) => {
      const maxScroll = Math.max(0, rail.scrollWidth - rail.clientWidth);
      if (!pausedRef.current && document.visibilityState === "visible" && maxScroll > 0) {
        const elapsed = Math.min(time - previousTime, 48);
        rail.scrollLeft += elapsed * 0.032 * direction;
        if (rail.scrollLeft >= maxScroll - 1) direction = -1;
        if (rail.scrollLeft <= 1) direction = 1;
      }
      previousTime = time;
      frame = window.requestAnimationFrame(animate);
    };

    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [items.length]);

  const setPaused = (paused: boolean) => { pausedRef.current = paused; };
  const renderItem = (item: CatalogueHierarchyItem) => <button
    type="button"
    key={`${item.department}-${item.value}`}
    className={activeCategory === item.value ? "is-active" : ""}
    aria-pressed={activeCategory === item.value}
    onClick={() => onSelectCategory(item.value)}
  >
    <span className="subcategory-rail-media" aria-hidden="true">
      {/* Catalogue product images are already optimized at their public source. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={item.imageUrl ?? "/marketplace/hero-pharmacy-still-life.webp"} alt="" loading="lazy" decoding="async" />
      <i><SubcategoryIcon label={item.label} /></i>
    </span>
    <b>{item.label}</b>
  </button>;

  return <nav
    ref={railRef}
    className="subcategory-rail"
    aria-label={marketplaceFormatMessage("inventory.545b56483487", [contextLabel])}
    onPointerEnter={() => setPaused(true)}
    onPointerLeave={() => setPaused(false)}
    onTouchStart={() => setPaused(true)}
    onTouchEnd={() => setPaused(false)}
    onFocusCapture={() => setPaused(true)}
    onBlurCapture={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false);
    }}
  >
    <div className="subcategory-rail-track">
      <div className="subcategory-rail-sequence">{items.map((item) => renderItem(item))}</div>
    </div>
  </nav>;
}

function productHierarchyValue(product: Product) {
  const taxonomy = nonPrescriptionTaxonomyForProduct(product);
  if (taxonomy) return taxonomy.subcategoryValue;
  const department = (product.department || product.category).trim();
  const subcategory = product.subcategory?.trim();
  return subcategory && department ? taxonomyOptionValue(department, subcategory) : department;
}

function FeaturedProductTile({
  product,
  index,
  previewMode,
  publicCatalogMode,
  onAdd,
  onOpen,
}: Omit<ProductCardProps, "catalogueSize">) {
  const router = useRouter();
  const imageUrl = product.imageUrl ?? product.imageUrls?.[0] ?? null;
  if (!imageUrl) return null;
  const displayTitle = customerProductTitle(product.brand);
  const productHref = `/product/${encodeURIComponent(product.id)}`;
  const preloadProduct = () => router.prefetch(productHref);
  const priced = hasPriceData(product);

  return <article className={`featured-product-tile${index === 0 ? " is-lead" : ""}`} data-featured-product={product.id}>
    <Link href={productHref} aria-label={marketplaceFormatMessage("inventory.a51b44650fe3", [displayTitle])} onClick={() => onOpen?.(product)} onMouseEnter={preloadProduct} onFocus={preloadProduct} onTouchStart={preloadProduct}>
      <span className="featured-product-category">{displayCategory(product)}</span>
      <ProductVisual product={product} imageUrl={imageUrl} />
      <span className="featured-product-copy">
        <b>{displayTitle}</b>
        {product.packSize?.trim() ? <small>{product.packSize.trim()}</small> : null}
        {priced ? <strong>{marketplaceMessage("product.indicative_price_prefix")} {marketplaceNumber(product.indicativePriceRwf)}</strong> : null}
      </span>
    </Link>
    <button type="button" className="featured-product-cart" onClick={() => onAdd(product)} disabled={publicCatalogMode || (!previewMode && !product.isOrderable)} aria-label={marketplaceFormatMessage("inventory.b16ae15256ae", [displayTitle])}>
      <ShoppingCart size={18} aria-hidden="true" />
      <span className="sr-only">{marketplaceMessage("inventory.1bf36d90e261")}</span>
    </button>
  </article>;
}

function CatalogueHierarchy({
  contextLabel,
  activeCategory,
  items,
  featuredProducts,
  groups,
  previewMode,
  publicCatalogMode,
  onAdd,
  onOpen,
  onSelectCategory,
}: {
  contextLabel: string;
  activeCategory: string;
  items: CatalogueHierarchyItem[];
  featuredProducts: Product[];
  groups: CatalogueProductGroup[];
  previewMode: boolean;
  publicCatalogMode: boolean;
  onAdd: (product: Product) => void;
  onOpen: (product: Product) => void;
  onSelectCategory: (category: string) => void;
}) {
  return <div className="catalogue-hierarchy">
    <header className="catalogue-context-heading">
      <div>
        <span>{marketplaceMessage("catalogue.browse_catalogue")}</span>
        <h2>{marketplaceMessage("catalogue.shop_by_collection")}</h2>
      </div>
      <p>{marketplaceFormatMessage("catalogue.collection_description", [contextLabel.toLocaleLowerCase()])}</p>
    </header>

    {items.length ? <SubcategoryRail
      activeCategory={activeCategory}
      contextLabel={contextLabel}
      items={items}
      onSelectCategory={onSelectCategory}
    /> : null}

    {featuredProducts.length >= 3 ? <section className="featured-collection" aria-labelledby="featured-collection-title">
      <div className="catalogue-group-heading">
        <div><h3 id="featured-collection-title">{marketplaceMessage("inventory.a84d7ba447f9")}</h3><p>{marketplaceMessage("inventory.4b2c22133771")}</p></div>
      </div>
      <div className="featured-product-mosaic">
        {featuredProducts.slice(0, 5).map((product, index) => <FeaturedProductTile
          key={product.id}
          product={product}
          index={index}
          previewMode={previewMode}
          publicCatalogMode={publicCatalogMode}
          onAdd={onAdd}
          onOpen={onOpen}
        />)}
      </div>
    </section> : null}

    {groups.slice(0, 3).map((group, groupIndex) => <section className="catalogue-product-group" aria-labelledby={`catalogue-group-${groupIndex}`} key={group.value}>
      <div className="catalogue-group-heading">
        <div><h3 id={`catalogue-group-${groupIndex}`}>{group.label}</h3><p>{marketplaceMessage("inventory.99f8683caef6")}</p></div>
        <button type="button" onClick={() => onSelectCategory(group.value)}>{marketplaceMessage("inventory.30a64216eaea")} <ArrowRight size={16} /></button>
      </div>
      <div className="catalogue-product-rail" role="list">
        {group.products.slice(0, 8).map((product, index) => <ProductCard
          key={product.id}
          product={product}
          index={index}
          catalogueSize={group.products.length}
          previewMode={previewMode}
          publicCatalogMode={publicCatalogMode}
          onAdd={onAdd}
          onOpen={onOpen}
        />)}
      </div>
    </section>)}
  </div>;
}

function ProductCard({
  product,
  index,
  catalogueSize,
  previewMode,
  publicCatalogMode,
  onAdd,
  onOpen,
}: ProductCardProps) {
  const router = useRouter();
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
  const displayTitle = customerProductTitle(product.brand);
  const cardImageUrl = product.imageUrl ?? product.imageUrls?.[0] ?? null;
  const productHref = `/product/${encodeURIComponent(product.id)}`;
  const preloadProduct = () => router.prefetch(productHref);

  return <article
    className={`product-card product-card-${product.accent ?? "mint"}${cardImageUrl ? "" : " without-image"}`}
    aria-posinset={index + 1}
    aria-setsize={catalogueSize}
    data-card-variant={(index % 4) + 1}
    data-product-card={product.id}
  >
    {cardImageUrl ? <Link className="product-image-wrap" href={productHref} aria-label={marketplaceFormatMessage("inventory.a51b44650fe3", [displayTitle])} onClick={() => onOpen?.(product)} onMouseEnter={preloadProduct} onFocus={preloadProduct} onTouchStart={preloadProduct}>
      <span className="product-card-category">{displayCategory(product)}</span>
      <PrescriptionStatusIcon status={product.prescriptionStatus} />
      <ProductVisual product={product} imageUrl={cardImageUrl} />
      <span className="product-image-action" aria-hidden="true"><ArrowRight size={17} /></span>
    </Link> : null}
    <div className="product-card-content">
      {!cardImageUrl ? <div className="product-meta">
        <span>{displayCategory(product)}</span>
        <PrescriptionStatusIcon status={product.prescriptionStatus} />
      </div> : null}
      <h3><Link href={productHref} onClick={() => onOpen?.(product)} onMouseEnter={preloadProduct} onFocus={preloadProduct} onTouchStart={preloadProduct}>{displayTitle}</Link></h3>
      <p className={`product-card-generic${generic ? "" : " is-empty"}`} aria-hidden={generic ? undefined : true}>{generic || "\u00a0"}</p>
      {details.length ? <div className="product-card-specs" aria-label={marketplaceMessage("inventory.fd294f8ad383")}>{details.slice(0, 3).join(" · ")}</div> : <div className="product-card-specs is-empty" aria-hidden="true" />}
      <div className={`price-line ${priced ? "has-price" : "no-price"}`}>
        {priced ? <div><small>{marketplaceMessage("product.price_label")}</small><b>{marketplaceMessage("product.indicative_price_prefix")} {marketplaceNumber(product.indicativePriceRwf)}</b></div> : null}
        <button className="product-card-cart" onClick={() => onAdd(product)} disabled={publicCatalogMode || (!previewMode && !product.isOrderable)} aria-label={publicCatalogMode ? marketplaceFormatMessage("inventory.9161bb4f1d4f", [displayTitle]) : marketplaceFormatMessage("inventory.b16ae15256ae", [displayTitle])} title={publicCatalogMode ? marketplaceMessage("inventory.167285abf102") : !previewMode && !product.isOrderable ? marketplaceMessage("inventory.3848efcfecee") : marketplaceMessage("inventory.1bf36d90e261")}><ShoppingCart size={19} aria-hidden="true" /><span className="sr-only">{publicCatalogMode ? marketplaceMessage("inventory.6e39d7d8300f") : marketplaceMessage("inventory.1bf36d90e261")}</span></button>
      </div>
    </div>
  </article>;
}

type PharmacyCataloguePanelProps = {
  products: Product[];
  catalogueProducts: Product[];
  query: string;
  drafts: Record<string, string>;
  submittingProductId: string | null;
  onQueryChange: (value: string) => void;
  onDraftChange: (productId: string, value: string) => void;
  onSubmit: (product: Product) => void;
};

function portalProductTypeLabel(product: Product) {
  const subcategory = product.subcategory?.trim();
  if (subcategory) return subcategory;
  const department = catalogueDepartmentForProduct(product).label;
  const formGroup = catalogueFormGroup(product);
  if (department === "Medicines") {
    if (formGroup !== "other") return formGroup.charAt(0).toUpperCase() + formGroup.slice(1);
    return product.form.trim() || department;
  }
  if (product.category !== department) return product.category;
  return product.productType.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function PharmacyCataloguePanel({
  products,
  catalogueProducts,
  query,
  drafts,
  submittingProductId,
  onQueryChange,
  onDraftChange,
  onSubmit,
}: PharmacyCataloguePanelProps) {
  const [visibleCount, setVisibleCount] = useState(PORTAL_PRODUCT_BATCH_SIZE);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [productTypeFilter, setProductTypeFilter] = useState("all");
  const [catalogueSort, setCatalogueSort] = useState<"relevance" | "az" | "za" | "category" | "price-low" | "price-high">("relevance");
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const categoryOptions = useMemo(() => Array.from(new Set(catalogueProducts.map((product) => catalogueDepartmentForProduct(product).label).filter(Boolean))).toSorted((left, right) => left.localeCompare(right)), [catalogueProducts]);
  const productsInCategory = useMemo(() => categoryFilter === "all"
    ? catalogueProducts
    : catalogueProducts.filter((product) => catalogueDepartmentForProduct(product).label === categoryFilter), [catalogueProducts, categoryFilter]);
  const productTypeOptions = useMemo(() => Array.from(new Set(productsInCategory.map(portalProductTypeLabel).filter(Boolean))).toSorted((left, right) => left.localeCompare(right)), [productsInCategory]);
  const effectiveProductTypeFilter = productTypeFilter === "all" || productTypeOptions.includes(productTypeFilter) ? productTypeFilter : "all";
  const filteredProducts = useMemo(() => {
    const result = products.filter((product) => {
      if (categoryFilter !== "all" && catalogueDepartmentForProduct(product).label !== categoryFilter) return false;
      if (effectiveProductTypeFilter === "all") return true;
      return portalProductTypeLabel(product) === effectiveProductTypeFilter;
    });
    if (catalogueSort === "relevance") return result;
    return result.toSorted((left, right) => {
      if (catalogueSort === "az" || catalogueSort === "za") {
        const comparison = customerProductTitle(left.brand).localeCompare(customerProductTitle(right.brand));
        return catalogueSort === "az" ? comparison : -comparison;
      }
      if (catalogueSort === "category") {
        return catalogueDepartmentForProduct(left).label.localeCompare(catalogueDepartmentForProduct(right).label)
          || (left.subcategory ?? "").localeCompare(right.subcategory ?? "")
          || customerProductTitle(left.brand).localeCompare(customerProductTitle(right.brand));
      }
      const leftHasPrice = hasPriceData(left);
      const rightHasPrice = hasPriceData(right);
      if (leftHasPrice !== rightHasPrice) return leftHasPrice ? -1 : 1;
      if (!leftHasPrice) return customerProductTitle(left.brand).localeCompare(customerProductTitle(right.brand));
      const comparison = left.indicativePriceRwf - right.indicativePriceRwf;
      return catalogueSort === "price-low" ? comparison : -comparison;
    });
  }, [catalogueSort, categoryFilter, effectiveProductTypeFilter, products]);
  const visibleProducts = filteredProducts.slice(0, visibleCount);
  const hasMoreProducts = visibleCount < filteredProducts.length;

  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel || !hasMoreProducts || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setVisibleCount((count) => Math.min(count + PORTAL_PRODUCT_BATCH_SIZE, filteredProducts.length));
    }, { rootMargin: "700px 0px", threshold: 0.01 });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [filteredProducts.length, hasMoreProducts, visibleCount]);

  function resetCatalogueControls() {
    setCategoryFilter("all");
    setProductTypeFilter("all");
    setCatalogueSort("relevance");
    onQueryChange("");
    setVisibleCount(PORTAL_PRODUCT_BATCH_SIZE);
  }

  return <section className="pharmacy-catalogue-panel" aria-label={marketplaceMessage("inventory.2d3278c26218")}>
    <div className="pharmacy-catalogue-tools">
      <div><p aria-live="polite">{marketplaceFormatMessage("catalogue.product_count", [marketplaceNumber(filteredProducts.length)])}</p></div>
      <label><Search size={17} aria-hidden="true" /><input value={query} onChange={(event) => { onQueryChange(boundedCatalogueQuery(event.target.value)); setVisibleCount(PORTAL_PRODUCT_BATCH_SIZE); }} placeholder={marketplaceMessage("inventory.c44cd62c1bdf")} aria-label={marketplaceMessage("inventory.b6891c685f60")} /></label>
    </div>
    <div className="pharmacy-catalogue-filters" aria-label={marketplaceMessage("inventory.2d3278c26218")}>
      <label><span>{marketplaceMessage("inventory.292c06f0045a")}</span><select value={categoryFilter} onChange={(event) => { setCategoryFilter(event.target.value); setProductTypeFilter("all"); setVisibleCount(PORTAL_PRODUCT_BATCH_SIZE); }}><option value="all">{marketplaceMessage("catalogue.all_categories")}</option>{categoryOptions.map((option) => <option value={option} key={option}>{option}</option>)}</select></label>
      <label><span>{marketplaceMessage("inventory.6fee4ea29a07")}</span><select value={effectiveProductTypeFilter} onChange={(event) => { setProductTypeFilter(event.target.value); setVisibleCount(PORTAL_PRODUCT_BATCH_SIZE); }}><option value="all">{marketplaceMessage("inventory.718622df41f1")}</option>{productTypeOptions.map((option) => <option value={option} key={option}>{option}</option>)}</select></label>
      <label><span>{marketplaceMessage("inventory.bec69036aa27")}</span><select value={catalogueSort} onChange={(event) => { setCatalogueSort(event.target.value as typeof catalogueSort); setVisibleCount(PORTAL_PRODUCT_BATCH_SIZE); }}><option value="relevance">{marketplaceMessage("inventory.d83ab68f7428")}</option><option value="az">{marketplaceMessage("inventory.bb05620585b6")}</option><option value="za">{marketplaceMessage("inventory.ac2bd92e706d")}</option><option value="category">{marketplaceMessage("inventory.292c06f0045a")}</option><option value="price-low">{marketplaceMessage("product.price_label")} ↑</option><option value="price-high">{marketplaceMessage("product.price_label")} ↓</option></select></label>
      <button type="button" onClick={resetCatalogueControls} disabled={!query && categoryFilter === "all" && productTypeFilter === "all" && catalogueSort === "relevance"}><SlidersHorizontal size={15} aria-hidden="true" /> {marketplaceMessage("inventory.daee7606b339")}</button>
    </div>
    {visibleProducts.length ? <div className="pharmacy-catalogue-list">
      {visibleProducts.map((product) => {
        const submitting = submittingProductId === product.id;
        return <article key={product.id}>
          <div className="pharmacy-catalogue-product">{product.imageUrl || product.imageUrls?.[0] ? <ProductVisual product={product} small /> : <span><PackageCheck size={18} /></span>}<div><b>{customerProductTitle(product.brand)}</b><small>{[product.generic, product.strength, product.form, product.packSize].filter(Boolean).join(" · ") || product.category}</small></div></div>
          {hasPriceData(product) ? <div className="pharmacy-central-price"><small>{marketplaceMessage("product.price_label")}</small><b>{marketplaceMessage("product.indicative_price_prefix")} {marketplaceNumber(product.indicativePriceRwf)}</b></div> : <div className="pharmacy-central-price is-empty" aria-hidden="true" />}
          <label className="pharmacy-price-input"><span>{marketplaceMessage("inventory.270b4259d6e1")}</span><div><span>{marketplaceMessage("inventory.97f2cfff0822")}</span><input value={drafts[product.id] ?? ""} onChange={(event) => onDraftChange(product.id, event.target.value.replace(/\D/g, "").slice(0, 9))} inputMode="numeric" placeholder="0" aria-label={marketplaceFormatMessage("inventory.70f5bf838854", [product.brand])} /></div></label>
          <button type="button" onClick={() => onSubmit(product)} disabled={Boolean(submittingProductId) || !drafts[product.id]}>{submitting ? <LoaderCircle className="button-spinner" size={15} /> : <Plus size={15} />} {submitting ? marketplaceMessage("inventory.7ea93caac0f5") : marketplaceMessage("inventory.284b06ff8037")}</button>
        </article>;
      })}
    </div> : <div className="portal-empty"><Search size={29} /><b>{marketplaceMessage("inventory.45b81ea0f398")}</b><p>{marketplaceMessage("inventory.df4395b3cb47")}</p></div>}
    {visibleProducts.length ? <div ref={loadMoreRef} className={`pharmacy-catalogue-sentinel${hasMoreProducts ? " is-loading" : ""}`} role="status" aria-live="polite" aria-atomic="true">
      {hasMoreProducts ? <><span className="infinite-scroll-spinner" aria-hidden="true" /><span>{marketplaceFormatMessage("catalogue.loading_next_products", [PORTAL_PRODUCT_BATCH_SIZE])}</span></> : <span>{marketplaceMessage("catalogue.all_loaded")}</span>}
    </div> : null}
  </section>;
}

function errorMessage(error: unknown) {
  return normalizeDawaNearError(error).message;
}

function OrderWizardProgress({ step }: { step: CheckoutStep }) {
  return <ol className="order-wizard-progress" aria-label={marketplaceMessage("inventory.da96c16d4a7a")}>
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

function InternationalPhoneInput({
  country,
  id,
  nationalNumber,
  onCountryChange,
  onNationalNumberChange,
}: {
  country: CountryCode;
  id: string;
  nationalNumber: string;
  onCountryChange: (country: CountryCode) => void;
  onNationalNumberChange: (nationalNumber: string) => void;
}) {
  return <div className="portal-phone-input">
    <select value={country} onChange={(event) => onCountryChange(event.target.value as CountryCode)} aria-label={marketplaceMessage("inventory.36ca78914773")}>
      {whatsappCountries.map((item) => <option value={item.country} key={item.country}>{item.name} (+{item.callingCode})</option>)}
    </select>
    <input id={id} value={nationalNumber} onChange={(event) => onNationalNumberChange(event.target.value.replace(/\D/g, "").slice(0, 15))} placeholder={marketplaceMessage("inventory.7df127cda4fc")} inputMode="tel" autoComplete="tel-national" />
  </div>;
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
  initialTrustMetrics = null,
}: MarketplaceProps = {}) {
  const previewMode = marketplaceMode !== "live";
  const publicCatalogMode = marketplaceMode === "catalog";
  const orderingEnabled = !previewMode && backendConfigured;
  const [category, setCategory] = useState(initialCategory);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const remoteQuery = useDebouncedValue(deferredQuery, 220);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [prescriptionFilter, setPrescriptionFilter] = useState("all");
  const [formFilter, setFormFilter] = useState("all");
  const [availabilityFilter, setAvailabilityFilter] = useState("all");
  const [catalogue, setCatalogue] = useState<Product[]>(() => initialProduct
    ? [initialProduct, ...initialProducts.filter((product) => product.id !== initialProduct.id)]
    : initialProducts);
  const [taxonomy, setTaxonomy] = useState<CatalogueTaxonomyRow[]>(initialTaxonomy);
  const [portalCatalogue, setPortalCatalogue] = useState<Product[]>([]);
  const [serverCatalogueTotal, setServerCatalogueTotal] = useState(0);
  const [serverExplanations, setServerExplanations] = useState<Map<string, string>>(() => new Map());
  const [serverCatalogueAvailable, setServerCatalogueAvailable] = useState(true);
  const [catalogueInitialising, setCatalogueInitialising] = useState(!initialProduct && !initialProducts.length);
  const [catalogueLoading, setCatalogueLoading] = useState(false);
  const [catalogueError, setCatalogueError] = useState("");
  const [catalogueRetryKey, setCatalogueRetryKey] = useState(0);
  const [featuredImageRanking, setFeaturedImageRanking] = useState<{
    candidateKey: string;
    rows: Map<string, ProductImagePresentation>;
  }>(() => ({ candidateKey: "", rows: new Map() }));
  const [subcategoryRepresentativeImages, setSubcategoryRepresentativeImages] = useState<Map<string, string | null>>(() => new Map());
  const [sort, setSort] = useState("relevance");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [catalogueUrlHydrated, setCatalogueUrlHydrated] = useState(false);
  const [returnPosition, setReturnPosition] = useState<string | null>(null);
  const [, setDataSource] = useState(initialProduct || initialProducts.length
    ? "Checking verified Rwanda FDA catalogue…"
    : "Loading verified Rwanda FDA catalogue…");
  const [visibleCount, setVisibleCount] = useState(INITIAL_PRODUCT_COUNT);
  const productLoadSentinelRef = useRef<HTMLDivElement>(null);
  const orderWizardBodyRef = useRef<HTMLDivElement>(null);
  const productLoadPendingRef = useRef(false);
  const restoredPositionRef = useRef<string | null>(null);
  const previousFilterStateRef = useRef<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartHydrated, setCartHydrated] = useState(false);
  const cartProductIdsKey = useMemo(() => [...new Set(cart.map((item) => item.id))].sort().join("|"), [cart]);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutStep, setCheckoutStep] = useState<CheckoutStep>(1);
  const previousCheckoutStepRef = useRef<CheckoutStep>(checkoutStep);
  const [showAllCartItems, setShowAllCartItems] = useState(false);
  const [recentlyAddedBrand, setRecentlyAddedBrand] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [feedbackToast, setFeedbackToast] = useState<FeedbackToast | null>(null);
  const [location, setLocation] = useState("Location needed");
  const [locationLoading, setLocationLoading] = useState(false);
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [mapLocationOpen, setMapLocationOpen] = useState(false);
  const [whatsappCountry, setWhatsappCountry] = useState<CountryCode>("RW");
  const [whatsapp, setWhatsapp] = useState("");
  const [whatsappTouched, setWhatsappTouched] = useState(false);
  const [verifiedCustomerWhatsapp, setVerifiedCustomerWhatsapp] = useState<string | null>(null);
  const [customerOtp, setCustomerOtp] = useState("");
  const [customerOtpChallengeId, setCustomerOtpChallengeId] = useState("");
  const [customerOtpExpiresAt, setCustomerOtpExpiresAt] = useState<string | null>(null);
  const [customerOtpLoading, setCustomerOtpLoading] = useState(false);
  const [customerOtpMessage, setCustomerOtpMessage] = useState("");
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
  const [requestedOrderDeepLink, setRequestedOrderDeepLink] = useState<string | null>(null);

  const [portalOpen, setPortalOpen] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState("");
  const [portalMessage, setPortalMessage] = useState("");
  const [portalStage, setPortalStage] = useState<"signin" | "otp" | "workspace">("signin");
  const [portalTab, setPortalTab] = useState<PortalTab>("requests");
  const [pharmacyWhatsappCountry, setPharmacyWhatsappCountry] = useState<CountryCode>("RW");
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
  const [contactEditWhatsappCountry, setContactEditWhatsappCountry] = useState<CountryCode>("RW");
  const [contactEditWhatsapp, setContactEditWhatsapp] = useState("");
  const [contactEditType, setContactEditType] = useState<"phone" | "whatsapp">("whatsapp");
  const [contactEditAction, setContactEditAction] = useState<"add" | "update">("add");
  const [contactEditContactId, setContactEditContactId] = useState<string | null>(null);
  const [pharmacyContacts, setPharmacyContacts] = useState<PharmacyContact[]>([]);
  const [pendingContactEdits, setPendingContactEdits] = useState<PharmacyContactEdit[]>([]);
  const [portalCatalogueQuery, setPortalCatalogueQuery] = useState("");
  const deferredPortalCatalogueQuery = useDeferredValue(portalCatalogueQuery);
  const [centralPriceDrafts, setCentralPriceDrafts] = useState<Record<string, string>>({});
  const [submittingPriceProductId, setSubmittingPriceProductId] = useState<string | null>(null);
  const pharmacyWhatsappE164 = parseCustomerWhatsapp(pharmacyWhatsappCountry, pharmacyWhatsapp);
  const contactEditWhatsappE164 = parseCustomerWhatsapp(contactEditWhatsappCountry, contactEditWhatsapp);
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
    if (!cartOpen || orderSent) {
      previousCheckoutStepRef.current = checkoutStep;
      return undefined;
    }
    if (previousCheckoutStepRef.current === checkoutStep) return undefined;
    previousCheckoutStepRef.current = checkoutStep;
    const frame = window.requestAnimationFrame(() => {
      orderWizardBodyRef.current
        ?.querySelector<HTMLElement>("[data-checkout-step-focus]")
        ?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [cartOpen, checkoutStep, orderSent]);

  useEffect(() => {
    if (portalStage !== "workspace" || !requestedOrderDeepLink || selectedRequest) return;
    const linkedRequest = pharmacyRequests.find((request) => request.orderId === requestedOrderDeepLink);
    if (!linkedRequest) return;
    queueMicrotask(() => {
      beginOffer(linkedRequest);
      setRequestedOrderDeepLink(null);
    });
  }, [pharmacyRequests, portalStage, requestedOrderDeepLink, selectedRequest]);

  useEffect(() => {
    if (initialProductId) return undefined;
    const applyCatalogueUrlState = () => {
      const state = parseCatalogueNavigationState(window.location.search, {
        initialCategory,
        initialProductCount: INITIAL_PRODUCT_COUNT,
        maxRestoredProductCount: MAX_RESTORED_PRODUCT_COUNT,
      });
      previousFilterStateRef.current = catalogueFilterStateKey(state);
      queueMicrotask(() => {
        setQuery(state.search);
        setCategory(state.category);
        setPrescriptionFilter(state.prescription);
        setFormFilter(state.form);
        setAvailabilityFilter(state.availability);
        setSort(state.sort);
        setViewMode(state.view);
        setVisibleCount(state.shown);
        setReturnPosition(state.position);
        restoredPositionRef.current = null;
        setCatalogueUrlHydrated(true);
      });
    };
    applyCatalogueUrlState();
    window.addEventListener("popstate", applyCatalogueUrlState);
    return () => window.removeEventListener("popstate", applyCatalogueUrlState);
  }, [initialCategory, initialProductId]);

  useEffect(() => {
    if (!catalogueUrlHydrated || initialProductId) return;
    const search = serializeCatalogueNavigationState(window.location.search, {
      search: query,
      category,
      prescription: prescriptionFilter,
      form: formFilter,
      availability: availabilityFilter,
      sort,
      view: viewMode,
      shown: visibleCount,
      position: returnPosition,
    }, { initialCategory, initialProductCount: INITIAL_PRODUCT_COUNT });
    const nextUrl = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) window.history.replaceState(window.history.state, "", nextUrl);
  }, [
    availabilityFilter,
    catalogueUrlHydrated,
    category,
    formFilter,
    initialCategory,
    initialProductId,
    prescriptionFilter,
    query,
    returnPosition,
    sort,
    visibleCount,
    viewMode,
  ]);

  useEffect(() => {
    if (!catalogueUrlHydrated || initialProductId) return;
    const currentFilterState = catalogueFilterStateKey({
      search: query,
      category,
      prescription: prescriptionFilter,
      form: formFilter,
      availability: availabilityFilter,
      sort,
      view: viewMode,
    });
    if (previousFilterStateRef.current !== null && previousFilterStateRef.current !== currentFilterState) {
      setReturnPosition(null);
      restoredPositionRef.current = null;
    }
    previousFilterStateRef.current = currentFilterState;
  }, [availabilityFilter, catalogueUrlHydrated, category, formFilter, initialProductId, prescriptionFilter, query, sort, viewMode]);

  useEffect(() => {
    const queryParameters = new URLSearchParams(window.location.search);
    const openPharmacyPortal = queryParameters.get("pharmacy-portal") === "open";
    const requestDeepLink = queryParameters.get("request")?.trim() || null;
    if (requestDeepLink) queueMicrotask(() => {
      setRequestedOrderDeepLink(requestDeepLink);
      if (!openPharmacyPortal) setOffersOpen(true);
    });
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
    if (!cartHydrated || !backendConfigured || !cartProductIdsKey) return;
    let active = true;
    const productIds = cartProductIdsKey.split("|");

    void loadCatalogueProductsByIds(productIds)
      .then((products) => {
        if (!active || !products.length) return;
        const refreshedProducts = new Map(products.map((product) => [product.id, product]));
        setCart((current) => current.map((item) => {
          const refreshed = refreshedProducts.get(item.id);
          return refreshed ? {
            ...refreshed,
            quantity: item.quantity,
            substitutesAllowed: Boolean(item.substitutesAllowed),
          } : item;
        }));
      })
      .catch(() => {
        // Keep the safe persisted snapshot when the network is unavailable.
      });

    return () => { active = false; };
  }, [cartHydrated, cartProductIdsKey]);

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
            setDataSource(`${marketplaceNumber(rows.length)} verified human-medicine register records`);
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
            setVerifiedCustomerWhatsapp(profile.whatsappVerifiedAt ? profile.whatsapp : null);
          }
        }
        if (!cancelled) setRestoredActiveOrders(activeOrders);
        const latestOrder = activeOrders.find((order) => order.orderId === requestedOrderDeepLink) ?? activeOrders[0];
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
            else setCheckoutError(marketplaceFormatMessage("inventory.5ffe2003aeab", [errorMessage(contactResult.reason)]));
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
  }, [previewMode, requestedOrderDeepLink]);

  useEffect(() => {
    if (!backendConfigured || initialTaxonomy.length) return undefined;
    let cancelled = false;
    void loadCatalogueTaxonomy()
      .then((rows) => { if (!cancelled) setTaxonomy(rows); })
      .catch(() => { /* The catalogue can still browse with the All Categories option. */ });
    return () => { cancelled = true; };
  }, [initialTaxonomy.length]);

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
          query: remoteQuery,
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
      setCatalogueError("");
      setDataSource(`${marketplaceNumber(total)} live catalogue matches · Supabase ranked search`);
      trackMarketplaceEvent("catalogue_search", {
        source: "supabase",
        queryLength: remoteQuery.trim().length,
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
            setCatalogueError("");
            setDataSource(`${marketplaceNumber(products.length)} live catalogue records · local ranking fallback`);
          }
        } catch (fallbackError) {
          if (!cancelled) {
            setCatalogueError(marketplaceMessage("inventory.3340e9286bd3"));
            setDataSource(`Live catalogue unavailable: ${errorMessage(fallbackError)}`);
          }
        }
      } else {
        setCatalogueError(marketplaceMessage("inventory.71297d72239d"));
        setDataSource(`Live ranked search unavailable: ${message}`);
      }
    }).finally(() => {
      if (!cancelled) setCatalogueLoading(false);
    });

    return () => { cancelled = true; };
  }, [
    availabilityFilter,
    catalogueRetryKey,
    category,
    remoteQuery,
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
      else setCheckoutError(marketplaceFormatMessage("inventory.5ffe2003aeab", [errorMessage(contactResult.reason)]));
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

  useEffect(() => {
    if (!returnPosition || restoredPositionRef.current === returnPosition || catalogueBusy || initialProductId) return undefined;
    const card = Array.from(document.querySelectorAll<HTMLElement>("[data-product-card]"))
      .find((element) => element.dataset.productCard === returnPosition);
    if (!card) return undefined;
    const frame = window.requestAnimationFrame(() => {
      card.scrollIntoView({ block: "center", behavior: "auto" });
      card.querySelector<HTMLAnchorElement>("a[href]")?.focus({ preventScroll: true });
      restoredPositionRef.current = returnPosition;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [catalogueBusy, initialProductId, returnPosition, visibleProducts.length]);

  const searchSuggestions = useMemo(() => deferredQuery.trim().length >= 2 ? filtered.slice(0, 6) : [], [deferredQuery, filtered]);
  const hasActiveFilters = category !== initialCategory || prescriptionFilter !== "all" || formFilter !== "all" || availabilityFilter !== "all";
  const hierarchyDepartment = useMemo(() => {
    const selectedDepartment = taxonomyFilterDepartment(category)?.label;
    if (selectedDepartment) return selectedDepartment;
    if (category === "Medicines" || category.startsWith("Medicines / ")) return "Medicines";
    if (initialCategory !== "All products") return initialCategory;
    return "All products";
  }, [category, initialCategory]);
  const hierarchyItems = useMemo<CatalogueHierarchyItem[]>(() => {
    const rows = availableTaxonomy.filter((row) => row.productCount > 0 && row.subcategory);
    const scopedRows = hierarchyDepartment === "All products"
      ? rows.toSorted((left, right) => right.productCount - left.productCount).slice(0, 11)
      : rows.filter((row) => row.department === hierarchyDepartment);
    const duplicateLabels = new Map<string, number>();
    scopedRows.forEach((row) => duplicateLabels.set(row.subcategory!, (duplicateLabels.get(row.subcategory!) ?? 0) + 1));
    const items = scopedRows.map((row) => ({
      label: hierarchyDepartment === "All products" && (duplicateLabels.get(row.subcategory!) ?? 0) > 1
        ? `${row.subcategory} · ${row.department}`
        : row.subcategory!,
      value: taxonomyOptionValue(row.department, row.subcategory!),
      department: row.department,
    }));
    if (hierarchyDepartment !== "All products") {
      items.unshift({ label: "All products", value: hierarchyDepartment, department: hierarchyDepartment });
    }
    return items;
  }, [availableTaxonomy, hierarchyDepartment]);
  const hierarchyRepresentativeKey = useMemo(
    () => hierarchyItems.map((item) => item.value).join("|"),
    [hierarchyItems],
  );
  const localSubcategoryRepresentativeImages = useMemo(() => {
    const representatives = new Map<string, string>();
    visibleProducts.forEach((product) => {
      const imageUrl = product.imageUrl ?? product.imageUrls?.[0] ?? null;
      const value = productHierarchyValue(product);
      if (imageUrl && value && !representatives.has(value)) representatives.set(value, imageUrl);
    });
    return representatives;
  }, [visibleProducts]);

  useEffect(() => {
    if (!backendConfigured || initialProductId || !hierarchyRepresentativeKey) return undefined;
    const missingItems = hierarchyItems.filter((item) => (
      !localSubcategoryRepresentativeImages.has(item.value)
      && !subcategoryRepresentativeImages.has(item.value)
    ));
    if (!missingItems.length) return undefined;
    let cancelled = false;

    void Promise.allSettled(missingItems.map(async (item) => {
      const result = await searchCatalogue({
        category: backendCategoryFor(item.value),
        limit: 8,
        sort: "relevance",
      });
      const representative = result.products.find((product) => Boolean(product.imageUrl ?? product.imageUrls?.[0]));
      const imageUrl = representative?.imageUrl ?? representative?.imageUrls?.[0] ?? null;
      return [item.value, imageUrl] as const;
    })).then((results) => {
      if (cancelled) return;
      setSubcategoryRepresentativeImages((current) => {
        const next = new Map(current);
        results.forEach((result, index) => {
          next.set(
            missingItems[index].value,
            result.status === "fulfilled" ? result.value[1] : null,
          );
        });
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [hierarchyItems, hierarchyRepresentativeKey, initialProductId, localSubcategoryRepresentativeImages, subcategoryRepresentativeImages]);

  const hierarchyItemsWithImages = useMemo(() => hierarchyItems.map((item) => {
    const departmentImage = departmentPresentation.find((presentation) => presentation.department === item.department)?.image;
    return {
      ...item,
      imageUrl: localSubcategoryRepresentativeImages.get(item.value)
        ?? subcategoryRepresentativeImages.get(item.value)
        ?? departmentImage
        ?? "/marketplace/hero-pharmacy-still-life.webp",
    };
  }), [hierarchyItems, localSubcategoryRepresentativeImages, subcategoryRepresentativeImages]);
  const hierarchyGroups = useMemo<CatalogueProductGroup[]>(() => {
    const groups = new Map<string, CatalogueProductGroup>();
    visibleProducts.forEach((product) => {
      const label = product.subcategory?.trim() || displayCategory(product);
      const value = productHierarchyValue(product);
      if (!label || !value) return;
      const key = `${value}\u0000${label}`;
      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, { label, value, products: [product] });
        return;
      }
      const productSignature = [
        customerProductTitle(product.brand),
        product.packSize,
      ].join("\u0000").toLocaleLowerCase();
      const duplicate = existing.products.some((candidate) => [
        customerProductTitle(candidate.brand),
        candidate.packSize,
      ].join("\u0000").toLocaleLowerCase() === productSignature);
      if (!duplicate) existing.products.push(product);
    });
    return [...groups.values()].toSorted((left, right) => right.products.length - left.products.length || left.label.localeCompare(right.label));
  }, [visibleProducts]);
  const featuredImageCandidates = useMemo(
    () => visibleProducts.filter((product) => Boolean(product.imageUrl ?? product.imageUrls?.[0])).slice(0, 12),
    [visibleProducts],
  );
  const featuredImageCandidateKey = useMemo(
    () => featuredImageCandidates.map((product) => product.id).join("|"),
    [featuredImageCandidates],
  );

  useEffect(() => {
    if (initialProductId || !backendConfigured || !featuredImageCandidateKey) return undefined;
    let cancelled = false;
    const ids = featuredImageCandidateKey.split("|");
    void loadProductImagePresentation(ids)
      .then((rows) => {
        if (cancelled) return;
        setFeaturedImageRanking({
          candidateKey: featuredImageCandidateKey,
          rows: new Map(rows.map((row) => [row.productId, row])),
        });
      })
      .catch(() => {
        if (!cancelled) setFeaturedImageRanking({ candidateKey: featuredImageCandidateKey, rows: new Map() });
      });
    return () => { cancelled = true; };
  }, [featuredImageCandidateKey, initialProductId]);

  const hierarchyFeaturedProducts = useMemo(() => {
    if (featuredImageRanking.candidateKey !== featuredImageCandidateKey) return [];
    return featuredImageCandidates
      .map((product, index) => ({
        product,
        index,
        qualityScore: featuredImageRanking.rows.get(product.id)?.qualityScore ?? -1,
      }))
      .toSorted((left, right) => right.qualityScore - left.qualityScore || left.index - right.index)
      .slice(0, 5)
      .map(({ product }) => product);
  }, [featuredImageCandidateKey, featuredImageCandidates, featuredImageRanking]);
  const showCatalogueHierarchy = !query.trim()
    && prescriptionFilter === "all"
    && formFilter === "all"
    && availabilityFilter === "all"
    && sort === "relevance"
    && viewMode === "grid"
    && visibleProducts.length >= 4;

  const pharmacyCatalogue = portalCatalogue.length ? portalCatalogue : catalogue;
  const portalCatalogueMatches = useMemo(() => {
    const ranked = pharmacyCatalogue
      .map((product) => searchCatalogueProduct(indexCatalogueProduct(product), deferredPortalCatalogueQuery))
      .filter((match): match is NonNullable<typeof match> => Boolean(match))
      .sort((left, right) => right.score - left.score || left.product.brand.localeCompare(right.product.brand));
    return ranked.map((match) => match.product);
  }, [deferredPortalCatalogueQuery, pharmacyCatalogue]);
  const orderableCatalogue = useMemo(() => pharmacyCatalogue.filter((product) => (
    product.isOrderable && ["valid", "active", "expiring_soon"].includes(product.regulatoryStatus.toLowerCase())
  )), [pharmacyCatalogue]);
  const selectedProduct = initialProductId ? catalogue.find((product) => product.id === initialProductId) ?? null : null;
  const selectedProductDisplayTitle = selectedProduct ? customerProductTitle(selectedProduct.brand) : "";
  const selectedProductDepartment = selectedProduct ? catalogueDepartmentForProduct(selectedProduct) : null;
  const relatedProducts = selectedProduct
    ? catalogue.filter((product) => product.id !== selectedProduct.id).slice(0, 8)
    : [];
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
  const customerWhatsappVerified = Boolean(customerWhatsapp && customerWhatsapp === verifiedCustomerWhatsapp);
  const cartRequiresPrescription = cart.some((item) => item.prescriptionStatus === "prescription");
  const selectionLocked = activeOrderSelected || selectedContact !== null || offers.some((offer) => offer.status === "selected");
  const requestLocked = pendingOrderAttempt !== null;
  const activeOrderExpired = Boolean(activeOrderExpiresAt && Date.parse(activeOrderExpiresAt) <= orderClock && !activeOrderSelected);
  const activeOrderNoRecipients = activeRecipientCount === 0;
  const activeOrderMinutesRemaining = activeOrderExpiresAt
    ? Math.max(0, Math.ceil((Date.parse(activeOrderExpiresAt) - orderClock) / 60_000))
    : null;

  function rememberCataloguePosition(product: Product) {
    const search = withCatalogueReturnPosition(window.location.search, product.id, visibleCount);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${search}${window.location.hash}`);
    setReturnPosition(product.id);
  }

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
    announce(marketplaceMessage("inventory.a7f9fff18a05"));
  }

  function selectHierarchyCategory(nextCategory: string) {
    setCategory(nextCategory);
    setVisibleCount(INITIAL_PRODUCT_COUNT);
    setSuggestionsOpen(false);
    trackMarketplaceEvent("catalogue_hierarchy_selected", { category: nextCategory });
    window.requestAnimationFrame(() => document.querySelector("#marketplace")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function add(product: Product) {
    if (requestLocked) {
      setCheckoutError(marketplaceMessage("inventory.e0e9b9391c19"));
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
      setCheckoutError(marketplaceMessage("inventory.d227ea68c416"));
      return;
    }
    setCheckoutStep(2);
  }

  function resetCustomerWhatsappVerification() {
    setCustomerOtp("");
    setCustomerOtpChallengeId("");
    setCustomerOtpExpiresAt(null);
    setCustomerOtpMessage("");
    setCheckoutError("");
  }

  function continueToWhatsappVerification() {
    setCheckoutError("");
    setWhatsappTouched(true);
    if (!customerWhatsapp) {
      setCheckoutError(marketplaceMessage("inventory.94b5cd21062a"));
      return;
    }
    if (cartRequiresPrescription && !prescription && !pendingOrderAttempt?.prescriptionPath) {
      setCheckoutError(marketplaceMessage("inventory.0701629aef82"));
      return;
    }
    if (prescriptionError) {
      setCheckoutError(prescriptionError);
      return;
    }
    setCheckoutStep(3);
  }

  function continueToOrderConfirmation() {
    setCheckoutError("");
    if (!customerWhatsappVerified) {
      setCheckoutError(marketplaceMessage("inventory.8cad0c0771fb"));
      return;
    }
    if (!coordinates) {
      setCheckoutError(marketplaceMessage("inventory.7b820c84e916"));
      setCheckoutStep(2);
      return;
    }
    setCheckoutStep(4);
  }

  async function sendCustomerWhatsappCode() {
    setCheckoutError("");
    setCustomerOtpMessage("");
    setWhatsappTouched(true);
    if (!customerWhatsapp) {
      setCheckoutError(marketplaceMessage("inventory.69678acd5a24"));
      return;
    }
    if (!orderingEnabled) {
      setCheckoutError(marketplaceMessage("inventory.ce386ef928f9"));
      return;
    }
    if (turnstileSiteKey && customerSessionAvailable !== true && !captchaToken) {
      setCheckoutError(marketplaceMessage("inventory.807b2c5968b6"));
      return;
    }
    setCustomerOtpLoading(true);
    try {
      await ensureAnonymousCustomer(captchaToken || undefined);
      setCustomerSessionAvailable(true);
      setCaptchaToken("");
      setCaptchaError("");
      const challenge = await requestCustomerWhatsappOtp(customerWhatsapp);
      setCustomerOtpChallengeId(challenge.challengeId);
      setCustomerOtpExpiresAt(challenge.expiresAt);
      setCustomerOtp("");
      setCustomerOtpMessage(marketplaceMessage("inventory.b348db72c0aa"));
      announce(marketplaceMessage("inventory.917beeea5811"));
    } catch (error) {
      setCheckoutError(errorMessage(error));
      if (customerSessionAvailable !== true) {
        setCaptchaToken("");
        setCaptchaVersion((version) => version + 1);
      }
    } finally {
      setCustomerOtpLoading(false);
    }
  }

  async function verifyCustomerWhatsappCode() {
    setCheckoutError("");
    setCustomerOtpMessage("");
    if (!customerWhatsapp || !customerOtpChallengeId) {
      setCheckoutError(marketplaceMessage("inventory.d74fd6f09b2c"));
      return;
    }
    if (!/^\d{6}$/.test(customerOtp)) {
      setCheckoutError(marketplaceMessage("inventory.3f7f1adb0f31"));
      return;
    }
    setCustomerOtpLoading(true);
    try {
      const result = await verifyCustomerWhatsappOtp(customerWhatsapp, customerOtpChallengeId, customerOtp);
      setVerifiedCustomerWhatsapp(result.phone);
      setCustomerOtpChallengeId("");
      setCustomerOtpExpiresAt(null);
      setCustomerOtp("");
      setCustomerOtpMessage(marketplaceMessage("inventory.2d2998157f40"));
      announce(marketplaceMessage("inventory.6346fd7ca382"));
    } catch (error) {
      setCheckoutError(errorMessage(error));
    } finally {
      setCustomerOtpLoading(false);
    }
  }

  function adjust(id: string, delta: number) {
    if (requestLocked) return;
    const item = cart.find((product) => product.id === id);
    setCart((current) => current
      .map((item) => item.id === id ? { ...item, quantity: item.quantity + delta } : item)
      .filter((item) => item.quantity > 0));
    if (item) announce(delta < 0 && item.quantity === 1 ? marketplaceFormatMessage("inventory.627bcda87700", [item.brand]) : marketplaceFormatMessage("inventory.b87d16e1b9cc", [item.brand, delta > 0 ? "increased" : "decreased"]));
  }

  function setSubstituteConsent(id: string, allowed: boolean) {
    if (requestLocked) return;
    setCart((current) => current.map((item) => item.id === id ? { ...item, substitutesAllowed: allowed } : item));
    const item = cart.find((product) => product.id === id);
    if (item) announce(allowed ? marketplaceFormatMessage("inventory.bf645b2c8957", [item.brand]) : marketplaceFormatMessage("inventory.21f70087f353", [item.brand]));
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
      announce(marketplaceMessage("inventory.31800bf44274"));
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
    announce(marketplaceMessage("inventory.98740bcd8423"));
  }

  function handlePrescriptionChange(file: File | undefined) {
    setPrescriptionError("");
    if (!file) {
      setPrescription(null);
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.type)) {
      setPrescription(null);
      setPrescriptionError(marketplaceMessage("inventory.ad357e3a0fc6"));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setPrescription(null);
      setPrescriptionError(marketplaceMessage("inventory.deb67f08c31e"));
      return;
    }
    setPrescription(file);
  }

  function clearRequestState(message = "") {
    if (pendingOrderAttempt?.rpcAttempted) {
      setCheckoutError(marketplaceMessage("inventory.1287db5ab987"));
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
      setCheckoutError(marketplaceMessage("inventory.9d2a9c58f97e"));
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
      setCheckoutError(marketplaceMessage("inventory.df64193a3aa7"));
      return;
    }
    if (!cart.length) {
      setCheckoutError(marketplaceMessage("inventory.8d9c08f3f5b0"));
      return;
    }
    setWhatsappTouched(true);
    if (!customerWhatsapp) {
      setCheckoutError(marketplaceMessage("inventory.94b5cd21062a"));
      return;
    }
    if (!customerWhatsappVerified) {
      setCheckoutError(marketplaceMessage("inventory.c819aed32b7f"));
      setCheckoutStep(3);
      return;
    }
    if (cartRequiresPrescription && !prescription && !pendingOrderAttempt?.prescriptionPath) {
      setCheckoutError(marketplaceMessage("inventory.41e55c6a03a7"));
      return;
    }
    if (prescriptionError) {
      setCheckoutError(prescriptionError);
      return;
    }
    if (!orderingEnabled) {
      setCheckoutError(marketplaceMessage("inventory.c1d2f987d917"));
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
        ? marketplaceFormatMessage("inventory.5aa49af762ba", [errorMessage(error)])
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
      announce(marketplaceFormatMessage("inventory.36fdd41fc1f6", [offer.pharmacyName]));
      trackMarketplaceEvent("pharmacy_selected", { hasWhatsapp: Boolean(contact.whatsapp), hasMomoCode: Boolean(contact.momoCode) });
      await refreshOffers(activeOrderId);
    } catch (error) {
      setCheckoutError(errorMessage(error));
      announce(marketplaceMessage("inventory.90fae33d9b01"), "info");
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
      setPortalError(marketplaceMessage("inventory.e72ad514f016"));
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
        setPortalError(marketplaceMessage("inventory.4cb535164ee4"));
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
    if (!pharmacyWhatsappE164) {
      setPortalError(marketplaceMessage("inventory.94b5cd21062a"));
      return;
    }
    setPortalLoading(true);
    try {
      const challenge = await requestPharmacyWhatsappOtp(pharmacyWhatsappE164);
      if (!challenge.registered) {
        setUnregisteredPharmacyWhatsapp(challenge.adminWhatsapp || MED250_ADMIN_WHATSAPP);
        return;
      }
      setPharmacyOtpChallengeId(challenge.challengeId);
      setPharmacyOtp("");
      setPortalStage("otp");
      setPortalMessage(marketplaceMessage("inventory.e7df3922d740"));
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
      setPortalError(marketplaceMessage("inventory.3f7f1adb0f31"));
      return;
    }
    setPortalLoading(true);
    try {
      if (!pharmacyWhatsappE164) throw new Error(marketplaceMessage("inventory.94b5cd21062a"));
      await verifyPharmacyWhatsappOtp(pharmacyWhatsappE164, pharmacyOtpChallengeId, pharmacyOtp);
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
      setPortalMessage(marketplaceMessage("inventory.5e31cc13ff26"));
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
    if (!contactEditWhatsappE164) {
      setPortalError(marketplaceMessage("inventory.94b5cd21062a"));
      return;
    }
    setPortalLoading(true);
    try {
      await requestPharmacyContactEdit({
        pharmacyId: activeMembership.pharmacyId,
        action: contactEditAction,
        contactType: contactEditType,
        contactId: contactEditAction === "update" ? contactEditContactId : null,
        e164: contactEditWhatsappE164,
      });
      const contactState = await loadMyPharmacyContacts(activeMembership.pharmacyId);
      setPharmacyContacts(contactState.contacts);
      setPendingContactEdits(contactState.pendingRequests);
      setContactEditWhatsapp("");
      setContactEditWhatsappCountry("RW");
      setContactEditAction("add");
      setContactEditContactId(null);
      setPortalMessage(marketplaceMessage("inventory.0dddd387651d"));
    } catch (error) {
      setPortalError(errorMessage(error));
    } finally {
      setPortalLoading(false);
    }
  }

  function beginContactReplacement(contact: PharmacyContact) {
    const parsedContact = splitCustomerWhatsapp(contact.e164);
    setContactEditAction("update");
    setContactEditType(contact.contactType);
    setContactEditContactId(contact.id);
    setContactEditWhatsappCountry(parsedContact?.country ?? "RW");
    setContactEditWhatsapp(parsedContact?.nationalNumber ?? "");
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
      setPortalMessage(marketplaceMessage("inventory.8c8f0b3620cb"));
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
      setPortalCatalogueQuery("");
      setPortalCataloguePage(0);
      setCentralPriceDrafts({});
      setSubmittingPriceProductId(null);
      setSelectedRequest(null);
      setPortalTab("requests");
      setPortalStage("signin");
      setPharmacyWhatsapp("");
      setPharmacyOtp("");
      setPharmacyOtpChallengeId("");
      setPortalMessage(marketplaceMessage("inventory.ee01a0235e8f"));
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

  async function recordCentralPrice(product: Product) {
    if (!activeMembership || submittingPriceProductId) return;
    setPortalError("");
    setPortalMessage("");
    const rawPrice = centralPriceDrafts[product.id] ?? "";
    const priceRwf = Number(rawPrice);
    if (!Number.isInteger(priceRwf) || priceRwf < 1 || priceRwf > 100_000_000) {
      setPortalError(marketplaceMessage("inventory.ddffb452afd3"));
      return;
    }
    setSubmittingPriceProductId(product.id);
    try {
      const result = await contributeCentralPrice({
        pharmacyId: activeMembership.pharmacyId,
        productId: product.id,
        priceRwf,
      });
      const applyCentralPrice = (items: Product[]) => items.map((item) => item.id === product.id ? {
        ...item,
        min: result.centralPriceRwf,
        max: result.centralPriceRwf,
        indicativePriceRwf: result.centralPriceRwf,
        priceIsIndicative: true,
        indicativePriceBasis: result.becameLowest ? "pharmacy_contributed_lowest" : item.indicativePriceBasis,
        indicativePriceUpdatedAt: result.becameLowest ? new Date().toISOString() : item.indicativePriceUpdatedAt,
      } : item);
      setPortalCatalogue(applyCentralPrice);
      setCatalogue(applyCentralPrice);
      setCentralPriceDrafts((current) => ({ ...current, [product.id]: "" }));
      setPortalMessage(result.becameLowest
        ? marketplaceFormatMessage("inventory.67b2a1e6d7d2", [marketplaceMessage("product.indicative_price_prefix"), marketplaceNumber(result.centralPriceRwf)])
        : marketplaceFormatMessage("inventory.65925c7a87f4", [marketplaceMessage("product.indicative_price_prefix"), marketplaceNumber(result.centralPriceRwf)]));
    } catch (error) {
      setPortalError(errorMessage(error));
    } finally {
      setSubmittingPriceProductId(null);
    }
  }

  async function sendOffer() {
    if (!activeMembership || !selectedRequest) return;
    setPortalError("");
    const incompleteItem = selectedRequest.items.find((item) => (
      !(offerAvailability[item.orderItemId] ?? false)
      || ((offerSubstitutes[item.orderItemId] ?? false) && !offerProductIds[item.orderItemId])
    ));
    if (incompleteItem) {
      setPortalError(marketplaceMessage("inventory.a500ad4af294"));
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
      setPortalMessage(marketplaceMessage("inventory.0cc7cc3556bb"));
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
      <a className="skip-link" href="#marketplace-content">{marketplaceMessage("accessibility.skip_marketplace")}</a>
      <header className="site-header">
        <Link className="brand" href="/" aria-label={marketplaceMessage("inventory.b579c24fb600")}><BrandLogo /></Link>
        <button type="button" className={`delivery-location ${coordinates ? "location-ready" : ""}`} onClick={() => requestNativeLocation(true)} disabled={publicCatalogMode || locationLoading} aria-busy={locationLoading} aria-label={publicCatalogMode ? marketplaceMessage("inventory.4212610a19fc") : locationLoading ? marketplaceMessage("inventory.ed958ab3964c") : marketplaceMessage("inventory.109576c476ff")}><MapPin size={18} /><span><small>{publicCatalogMode ? marketplaceMessage("inventory.da7020dfe2b6") : coordinates ? marketplaceMessage("inventory.cf8c8078d8db") : marketplaceMessage("inventory.ab808511ed53")}</small><b>{publicCatalogMode ? marketplaceMessage("inventory.398c15b85be1") : locationLoading ? marketplaceMessage("inventory.a7ab96ca6fa6") : coordinates ? marketplaceMessage("inventory.9d58f0cdd494") : location === "Location needed" ? marketplaceMessage("inventory.a6ab4552d436") : location}</b></span>{locationLoading ? <LoaderCircle className="button-spinner" size={14} aria-hidden="true" /> : coordinates ? <Check size={14} /> : <ChevronDown size={13} />}</button>
        <div
          className="header-search-shell"
          onFocusCapture={() => setSuggestionsOpen(true)}
          onBlurCapture={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setSuggestionsOpen(false); }}
        >
          <div className="header-search">
            <select value={category} onChange={(event) => { setCategory(event.target.value); setVisibleCount(INITIAL_PRODUCT_COUNT); }} aria-label={marketplaceMessage("inventory.a12bc85e0ac4")}><CategoryOptions taxonomy={availableTaxonomy} /></select>
            <input id="marketplace-search" value={query} maxLength={MAX_CATALOGUE_QUERY_LENGTH} onChange={(event) => { setQuery(boundedCatalogueQuery(event.target.value)); setSuggestionsOpen(true); setVisibleCount(INITIAL_PRODUCT_COUNT); }} onKeyDown={handleSearchKeyDown} placeholder={marketplaceMessage("inventory.d8280b7334a4")} role="combobox" aria-label={marketplaceMessage("inventory.0a6ea1b07058")} aria-controls="smart-search-suggestions" aria-expanded={suggestionsOpen && query.trim().length >= 2} aria-autocomplete="list" aria-haspopup="listbox" autoComplete="off" />
            <button type="button" aria-label={marketplaceMessage("inventory.4d190d1d72fb")} onClick={showSearchResults}><Search size={22} /><span>{marketplaceMessage("inventory.49c266baaaa7")}</span></button>
          </div>
          {suggestionsOpen && query.trim().length >= 2 ? <div className="search-suggestions" id="smart-search-suggestions" role="listbox" aria-label={marketplaceMessage("inventory.a39a69ddff1d")}>
            <div><Sparkles size={15} /><span>{searchSuggestions.length ? marketplaceMessage("inventory.c910635dd910") : marketplaceMessage("inventory.571474911b8c")}</span></div>
            {searchSuggestions.map((product) => <button type="button" role="option" aria-selected="false" tabIndex={-1} key={product.id} onKeyDown={handleSuggestionKeyDown} onClick={() => chooseSearchSuggestion(product)}><span><b>{customerProductTitle(product.brand)}</b><small>{[product.generic, product.strength].filter(Boolean).join(" · ")}</small></span><em>{product.category}</em></button>)}
          </div> : null}
        </div>
        <div className="header-actions">
          <button type="button" className="header-utility" onClick={() => setOffersOpen(true)} disabled={publicCatalogMode} aria-label={publicCatalogMode ? marketplaceMessage("inventory.8671efa83e95") : marketplaceMessage("inventory.4b5289f8b69a")}><PackageCheck size={19} /><span><small>{marketplaceMessage("inventory.8ed6791bdf3d")}</small><b>{marketplaceMessage("inventory.ada27592c957")}</b></span></button>
          <button type="button" className="header-utility" onClick={openPortal} aria-label={marketplaceMessage("inventory.1a816c36d638")}><Store size={19} /><span><b>{marketplaceMessage("navigation.pharmacies")}</b></span></button>
          <button className="bag-button" disabled={publicCatalogMode} onClick={() => { setCheckoutStep(1); setShowAllCartItems(false); setRecentlyAddedBrand(""); setCartOpen(true); }} aria-label={publicCatalogMode ? marketplaceMessage("inventory.48a1691ef7ec") : marketplaceFormatMessage("inventory.1be54895e74f", [basketCount, basketCount === 1 ? "item" : "items"])}><ShoppingCart size={22} /><span>{publicCatalogMode ? marketplaceMessage("inventory.b671001e229a") : marketplaceMessage("request.basket_label")}</span><b>{basketCount}</b></button>
          <button className="mobile-toggle" onClick={() => setMobileMenu(!mobileMenu)} aria-label={marketplaceMessage("inventory.dfc1e6d16ba5")} aria-expanded={mobileMenu} aria-controls="mobile-marketplace-menu"><Menu size={22} /></button>
        </div>
      </header>

      {mobileMenu ? <nav className="mobile-menu-panel" id="mobile-marketplace-menu" aria-label={marketplaceMessage("inventory.4adee617a234")}><Link href="/categories">{marketplaceMessage("inventory.718622df41f1")}</Link>{departmentNav.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}<button onClick={() => { setMobileMenu(false); setOffersOpen(true); }}>{marketplaceMessage("status.my_requests")}</button><button onClick={() => { setMobileMenu(false); void openPortal(); }}>{marketplaceMessage("navigation.pharmacies")}</button></nav> : null}

      <nav className="commerce-nav" id="top" aria-label={marketplaceMessage("inventory.b5c3b33da383")}>
        <Link href="/categories"><Menu size={18} /> {marketplaceMessage("catalogue.all_categories")}</Link>
        {departmentNav.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}
      </nav>

      {publicCatalogMode ? <div className="preview-banner public-catalog-banner" role="status"><ShieldCheck size={16} /><span><b>{marketplaceMessage("inventory.71bda578ec71")}</b> {marketplaceMessage("inventory.02c3d108fd42")}</span></div> : null}

      <div id="marketplace-content">
      {initialProductId ? <section className={`product-detail-page${selectedProductHasGallery ? "" : " without-image"}`} aria-live="polite">
        {selectedProduct ? <>
          <nav className="product-breadcrumbs" aria-label={marketplaceMessage("inventory.2bd873d6c734")}><Link href="/">{marketplaceMessage("navigation.home")}</Link><span aria-hidden="true">/</span><Link href={selectedProductDepartment?.href ?? "/categories"}>{selectedProductDepartment?.label ?? marketplaceMessage("navigation.products")}</Link><span aria-hidden="true">/</span><span aria-current="page">{selectedProductDisplayTitle}</span></nav>
          <div className="product-mobile-heading">
            {selectedProduct.category ? <small>{displayCategory(selectedProduct)}</small> : null}
            <h1 className={productTitleClass(selectedProductDisplayTitle)}>{selectedProductDisplayTitle}</h1>
            {selectedProduct.generic ? <p className="product-generic">{selectedProduct.generic}</p> : null}
          </div>
          {selectedProductHasGallery ? <div className="product-detail-visual"><ProductGallery product={selectedProduct} /></div> : null}
          <div className="product-detail-copy">
            <div className="product-desktop-heading">
              {selectedProduct.category ? <small>{displayCategory(selectedProduct)}</small> : null}
              <h1 className={productTitleClass(selectedProductDisplayTitle)}>{selectedProductDisplayTitle}</h1>
              {selectedProduct.generic ? <p className="product-generic">{selectedProduct.generic}</p> : null}
            </div>
            {selectedProduct.description ? <section className="product-description" aria-labelledby="product-description-title">
              <h2 id="product-description-title">{marketplaceMessage("product.description_heading")}</h2>
              <p>{selectedProduct.description}</p>
              {selectedProduct.descriptionSourceName && selectedProduct.descriptionSourceUrl?.startsWith("https://") ? <a href={selectedProduct.descriptionSourceUrl} target="_blank" rel="noreferrer">{marketplaceFormatMessage("product.description_source", [selectedProduct.descriptionSourceName])}</a> : null}
            </section> : null}
            <ProductDetailsList product={selectedProduct} />
            <div className={`product-detail-buy ${hasPriceData(selectedProduct) ? "has-price" : "no-price"}`}>
              {hasPriceData(selectedProduct) ? <div><span>{marketplaceMessage("product.price_label")}</span><b>{marketplaceMessage("product.indicative_price_prefix")} {marketplaceNumber(selectedProduct.indicativePriceRwf)}</b></div> : null}
              <button onClick={() => add(selectedProduct)} disabled={publicCatalogMode || (!previewMode && !selectedProduct.isOrderable)} aria-label={publicCatalogMode ? marketplaceFormatMessage("inventory.9161bb4f1d4f", [selectedProductDisplayTitle]) : marketplaceFormatMessage("inventory.b16ae15256ae", [selectedProductDisplayTitle])} title={publicCatalogMode ? marketplaceMessage("inventory.167285abf102") : undefined}><ShoppingCart size={20} /> {publicCatalogMode ? marketplaceMessage("inventory.398c15b85be1") : marketplaceMessage("inventory.1bf36d90e261")}</button>
              {!publicCatalogMode ? <small className="request-action-note">{marketplaceMessage("inventory.126834c25aaf")}</small> : null}
            </div>
            <details className="product-information">
              <summary><FileText size={18} /> {marketplaceMessage("inventory.32593214650f")} <ChevronDown size={18} /></summary>
              <div>
                <p>{selectedProduct.generic || selectedProduct.brand}</p>
                <dl>
                  {selectedProductDisplayTitle !== selectedProduct.brand ? <div><dt>{marketplaceMessage("inventory.dec875a808c7")}</dt><dd>{selectedProduct.brand}</dd></div> : null}
                  {selectedProduct.productType ? <div><dt>{marketplaceMessage("inventory.6fee4ea29a07")}</dt><dd>{selectedProduct.productType.replaceAll("_", " ")}</dd></div> : null}
                  {selectedProduct.regulatoryStatus ? <div><dt>{marketplaceMessage("inventory.68b989f871f2")}</dt><dd>{selectedProduct.regulatoryStatus.replaceAll("_", " ")}</dd></div> : null}
                  {selectedProduct.subcategory ? <div><dt>{marketplaceMessage("inventory.292c06f0045a")}</dt><dd>{selectedProduct.subcategory}</dd></div> : null}
                </dl>
              </div>
            </details>
          </div>
          {relatedProducts.length ? <section className="marketplace-section related-products" aria-labelledby="related-products-title">
            <div className="related-products-heading"><div><h2 id="related-products-title">{marketplaceMessage("inventory.ddd8bdb51f77")}</h2><p>{marketplaceMessage("inventory.17978f8ee51a")}</p></div><Link href={selectedProductDepartment?.href ?? "/categories"}>{marketplaceMessage("inventory.437e30a10be2")} <ArrowRight size={16} /></Link></div>
            <div className="product-grid">{relatedProducts.map((product, index) => <ProductCard key={product.id} product={product} onAdd={add} index={index} catalogueSize={relatedProducts.length} publicCatalogMode={publicCatalogMode} previewMode={previewMode} />)}</div>
            <p className="related-products-note"><ShieldCheck size={14} /> {marketplaceMessage("inventory.ec2e25a05e2d")}</p>
          </section> : null}
        </> : <div className="catalogue-empty"><Clock3 size={28} /><h1>{marketplaceMessage("inventory.8420d06d605c")}</h1><p>{marketplaceMessage("inventory.1745fc536368")}</p><Link href="/categories">{marketplaceMessage("inventory.aab5f657216a")}</Link></div>}
      </section> : <>
        {pageTitle && !showDepartments ? <section className="category-route-banner">
          <div><h1>{pageTitle}</h1><p>{pageDescription}</p><button onClick={() => requestNativeLocation(true)}><LocateFixed size={18} /> {coordinates ? marketplaceMessage("inventory.9d58f0cdd494") : marketplaceMessage("inventory.30cbc33ba1a5")}</button></div>
          <Image src={pageImage ?? "/marketplace/hero-pharmacy-still-life.webp"} alt="" width={620} height={330} priority unoptimized />
        </section> : !pageTitle ? <section className="market-banner">
          <div className="market-banner-copy"><h1>{marketplaceMessage("inventory.bada83fd765c")} <em>{marketplaceMessage("inventory.a68745f09fc1")}</em></h1><p>{marketplaceMessage("inventory.f0908d3d760e")}</p><a className="shop-button" href="#marketplace">{marketplaceMessage("inventory.0b01e69b2a20")} <ArrowRight size={18} /></a></div>
          <HeroArtworkCarousel />
        </section> : null}

        {(!pageTitle || showDepartments) && departmentCards.length ? <section className={`department-cards${pageTitle && showDepartments ? " category-index-departments" : ""}`} aria-label={marketplaceMessage("inventory.cd1c7049eb5c")}>
          {departmentCards.map((item) => <article key={item.department}><div><h2>{item.title}</h2><p>{item.description}</p><Link href={item.href}>{item.action} <ArrowRight size={15} /></Link></div><Image src={item.image} alt={item.imageAlt} width={210} height={150} unoptimized /></article>)}
        </section> : null}

        {!pageTitle && (initialTrustMetrics?.readyPharmacyCount || initialTrustMetrics?.typicalResponse) ? <section className="public-trust-signals" aria-label={marketplaceMessage("inventory.1362e2a3afc4")}>
          {initialTrustMetrics.readyPharmacyCount ? <article>
            <span className="public-trust-icon"><ShieldCheck size={20} aria-hidden="true" /></span>
            <div><b>{marketplaceFormatMessage("inventory.1d9a32f87023", [marketplaceNumber(initialTrustMetrics.readyPharmacyCount.value), initialTrustMetrics.readyPharmacyCount.value === 1 ? marketplaceMessage("inventory.20b04a4f018b") : marketplaceMessage("inventory.13ab5da0df2b")])}</b><small>{marketplaceFormatMessage("inventory.b6e45056d7d3", [marketplaceNumber(initialTrustMetrics.readyPharmacyCount.sampleSize), marketplaceDate(initialTrustMetrics.readyPharmacyCount.asOf)])}</small></div>
          </article> : null}
          {initialTrustMetrics.typicalResponse ? <article>
            <span className="public-trust-icon"><Clock3 size={20} aria-hidden="true" /></span>
            <div><b>{marketplaceFormatMessage("inventory.2826eec6f95e", [initialTrustMetrics.typicalResponse.valueMinutes, initialTrustMetrics.typicalResponse.valueMinutes === 1 ? marketplaceMessage("inventory.28cdd20eaf13") : marketplaceMessage("inventory.90e63d85fa1a")])}</b><small>{marketplaceFormatMessage("inventory.a0c2f3048f79", [marketplaceNumber(initialTrustMetrics.typicalResponse.sampleSize), initialTrustMetrics.typicalResponse.windowDays, marketplaceDate(initialTrustMetrics.typicalResponse.latestObservationAt)])}</small></div>
          </article> : null}
        </section> : null}

        <section className="marketplace-section" id="marketplace" aria-busy={catalogueBusy}>
          {catalogueError ? <div className="catalogue-error" role="alert"><CircleAlert size={19} aria-hidden="true" /><span><b>{marketplaceMessage("inventory.aef8e0cc6aa3")}</b><small>{catalogueError}</small></span><button type="button" onClick={() => { setCatalogueError(""); setServerCatalogueAvailable(true); setCatalogueRetryKey((key) => key + 1); }}>{marketplaceMessage("common.try_again")}</button></div> : null}
          {showCatalogueHierarchy ? <CatalogueHierarchy
            contextLabel={hierarchyDepartment}
            activeCategory={category}
            items={hierarchyItemsWithImages}
            featuredProducts={hierarchyFeaturedProducts}
            groups={hierarchyGroups}
            previewMode={previewMode && !publicCatalogMode}
            publicCatalogMode={publicCatalogMode}
            onAdd={add}
            onOpen={rememberCataloguePosition}
            onSelectCategory={selectHierarchyCategory}
          /> : null}
          <div className="section-heading catalogue-grid-heading"><div>{pageTitle && showDepartments ? <h1>{pageTitle}</h1> : <h2>{showCatalogueHierarchy ? marketplaceMessage("inventory.718622df41f1") : pageTitle ?? marketplaceMessage("inventory.dd1860e44be5")}</h2>}{query.trim() ? <p>{marketplaceFormatMessage("inventory.86d3661b8b9f", [query.trim()])}</p> : null}</div><span className="catalogue-progress">{marketplaceFormatMessage("inventory.c67ec9a7a4e9", [marketplaceNumber(visibleProducts.length)])}</span></div>
          <div className="smart-filter-bar" aria-label={marketplaceMessage("inventory.8bc26db75b8c")}>
            <button className="mobile-filter-button" type="button" onClick={() => setFiltersOpen(true)} aria-haspopup="dialog"><SlidersHorizontal size={17} /> {marketplaceMessage("inventory.c8cecf5be79f")}{hasActiveFilters ? <b aria-label={marketplaceMessage("inventory.213a9822c38a")}>!</b> : null}</button>
            <div className="desktop-filter-controls">
              <label>{marketplaceMessage("inventory.292c06f0045a")}<select value={category} onChange={(event) => { setCategory(event.target.value); setVisibleCount(INITIAL_PRODUCT_COUNT); }}><CategoryOptions taxonomy={availableTaxonomy} /></select></label>
              <label>{marketplaceMessage("inventory.9bc867e65b8f")}<select value={prescriptionFilter} onChange={(event) => { setPrescriptionFilter(event.target.value); setVisibleCount(INITIAL_PRODUCT_COUNT); }}><option value="all">{marketplaceMessage("inventory.ac78229d6b82")}</option><option value="non_prescription">{marketplaceMessage("inventory.c7beb665b378")}</option><option value="prescription">{marketplaceMessage("inventory.9bc867e65b8f")}</option><option value="pharmacist_only">{marketplaceMessage("inventory.b873a8a488d6")}</option><option value="unclassified">{marketplaceMessage("inventory.633816da5fae")}</option></select></label>
              <label>{marketplaceMessage("inventory.2e0e960ab320")}<select value={formFilter} onChange={(event) => { setFormFilter(event.target.value); setVisibleCount(INITIAL_PRODUCT_COUNT); }}><option value="all">{marketplaceMessage("inventory.890af17fcc14")}</option><option value="tablets">{marketplaceMessage("inventory.9b5b2ac2af5e")}</option><option value="liquids">{marketplaceMessage("inventory.5a830f8c9966")}</option><option value="injections">{marketplaceMessage("inventory.5fed173ae6ea")}</option><option value="topical">{marketplaceMessage("inventory.f9ae7e49f5b5")}</option><option value="devices">{marketplaceMessage("inventory.664bc690a7c9")}</option><option value="other">{marketplaceMessage("inventory.34e221c7e5db")}</option></select></label>
              <label>{marketplaceMessage("inventory.1cb0ba125f84")}<select value={availabilityFilter} onChange={(event) => { setAvailabilityFilter(event.target.value); setVisibleCount(INITIAL_PRODUCT_COUNT); }}><option value="all">{marketplaceMessage("inventory.718622df41f1")}</option><option value="priced">{marketplaceMessage("inventory.92a2c7590f2f")}</option><option value="orderable">{marketplaceMessage("inventory.ecfa5817871e")}</option><option value="registered">{marketplaceMessage("inventory.036d7bc33742")}</option></select></label>
              <label>{marketplaceMessage("inventory.bec69036aa27")}<select value={sort} onChange={(event) => { setSort(event.target.value); setVisibleCount(INITIAL_PRODUCT_COUNT); }}><option value="relevance">{marketplaceMessage("inventory.d83ab68f7428")}</option><option value="az">{marketplaceMessage("inventory.bb05620585b6")}</option><option value="za">{marketplaceMessage("inventory.ac2bd92e706d")}</option><option value="price">{marketplaceMessage("inventory.c659287eb505")}</option></select></label>
            </div>
            <div className="view-toggle" aria-label={marketplaceMessage("inventory.2101f022781a")}><button type="button" aria-label={marketplaceMessage("inventory.47da4e5507b6")} aria-pressed={viewMode === "grid"} onClick={() => { setViewMode("grid"); trackMarketplaceEvent("catalogue_view_changed", { view: "grid" }); }}><Grid3X3 size={15} /></button><button type="button" aria-label={marketplaceMessage("inventory.5d8c3e1b635e")} aria-pressed={viewMode === "list"} onClick={() => { setViewMode("list"); trackMarketplaceEvent("catalogue_view_changed", { view: "list" }); }}><List size={16} /></button></div>
            {query || hasActiveFilters ? <button className="clear-filters" onClick={clearCatalogueFilters}><SlidersHorizontal size={14} /> {marketplaceMessage("inventory.daee7606b339")}</button> : null}
          </div>
          {catalogueBusy && visibleProducts.length ? <p className="catalogue-refresh-status" role="status" aria-live="polite"><LoaderCircle className="button-spinner" size={14} aria-hidden="true" /> {marketplaceMessage("inventory.fd42ef839d25")}</p> : null}
          {catalogueBusy && !visibleProducts.length ? <CatalogueSkeleton /> : visibleProducts.length ? <div className={`product-grid ${viewMode === "list" ? "list-view" : ""}`} aria-busy={catalogueBusy} data-testid="product-grid">
            {visibleProducts.map((product, index) => <ProductCard
              product={product}
              index={index}
              catalogueSize={accessibleCatalogueSize}
              previewMode={previewMode && !publicCatalogMode}
              publicCatalogMode={publicCatalogMode}
              onAdd={add}
              onOpen={rememberCataloguePosition}
              key={product.id}
            />)}
          </div> : <div className="catalogue-empty"><Search size={28} /><h3>{marketplaceMessage("inventory.ca602ed1950d")}</h3><p>{marketplaceMessage("inventory.1f0d418afe7e")}</p><button onClick={clearCatalogueFilters}>{marketplaceMessage("inventory.fd2b359b4763")}</button></div>}
          {visibleProducts.length ? <div ref={productLoadSentinelRef} className={`infinite-scroll-sentinel${catalogueBusy && hasMoreProducts ? " is-loading" : ""}`} role="status" aria-live="polite" aria-atomic="true" data-testid="product-scroll-sentinel">
            {hasMoreProducts ? <><span className="infinite-scroll-spinner" aria-hidden="true" /><span>{catalogueBusy ? marketplaceMessage("inventory.97b72d67281c") : marketplaceMessage("inventory.6795683ef969")}</span><button type="button" onClick={() => { if (!catalogueBusy) { productLoadPendingRef.current = true; setVisibleCount((count) => count + PRODUCT_BATCH_SIZE); } }} disabled={catalogueBusy}>{catalogueBusy ? marketplaceMessage("inventory.ba3bbbe10d8b") : marketplaceMessage("catalogue.load_more")}</button></> : <span>{marketplaceFormatMessage("inventory.da287b007270", [marketplaceNumber(accessibleCatalogueSize)])}</span>}
          </div> : null}
        </section>
      </>}
      </div>

      <footer><Link className="brand footer-brand" href="/" aria-label={marketplaceMessage("inventory.b579c24fb600")}><BrandLogo /></Link><p>{marketplaceMessage("clinical.marketplace_disclaimer")}</p><nav aria-label={marketplaceMessage("inventory.26c87bb51e69")}><Link href="/categories">{marketplaceMessage("navigation.products")}</Link><Link href="/privacy">{marketplaceMessage("navigation.privacy")}</Link><Link href="/terms">{marketplaceMessage("navigation.terms")}</Link><button onClick={openPortal}>{marketplaceMessage("navigation.pharmacies")}</button></nav></footer>

      {filtersOpen ? <div className="filter-overlay" onMouseDown={(event) => event.target === event.currentTarget && setFiltersOpen(false)}>
        <section className="filter-dialog" role="dialog" aria-modal="true" aria-labelledby="catalogue-filter-title" aria-describedby="catalogue-filter-description" data-modal-root="catalogue-filters" tabIndex={-1}>
          <div className="filter-dialog-head"><div><span>{marketplaceMessage("inventory.57d2490874b1")}</span><h2 id="catalogue-filter-title">{marketplaceMessage("inventory.c8cecf5be79f")}</h2><p id="catalogue-filter-description">{marketplaceMessage("inventory.2a8ccfe1a6c2")}</p></div><button data-autofocus onClick={() => setFiltersOpen(false)} aria-label={marketplaceMessage("inventory.ba87570b99da")}><X size={20} /></button></div>
          <div className="filter-dialog-fields">
            <label>{marketplaceMessage("inventory.292c06f0045a")}<select value={category} onChange={(event) => { setCategory(event.target.value); setVisibleCount(INITIAL_PRODUCT_COUNT); }}><CategoryOptions taxonomy={availableTaxonomy} /></select></label>
            <label>{marketplaceMessage("inventory.9bc867e65b8f")}<select value={prescriptionFilter} onChange={(event) => { setPrescriptionFilter(event.target.value); setVisibleCount(INITIAL_PRODUCT_COUNT); }}><option value="all">{marketplaceMessage("inventory.ac78229d6b82")}</option><option value="non_prescription">{marketplaceMessage("inventory.c7beb665b378")}</option><option value="prescription">{marketplaceMessage("inventory.9bc867e65b8f")}</option><option value="pharmacist_only">{marketplaceMessage("inventory.b873a8a488d6")}</option><option value="unclassified">{marketplaceMessage("inventory.633816da5fae")}</option></select></label>
            <label>{marketplaceMessage("inventory.2e0e960ab320")}<select value={formFilter} onChange={(event) => { setFormFilter(event.target.value); setVisibleCount(INITIAL_PRODUCT_COUNT); }}><option value="all">{marketplaceMessage("inventory.890af17fcc14")}</option><option value="tablets">{marketplaceMessage("inventory.9b5b2ac2af5e")}</option><option value="liquids">{marketplaceMessage("inventory.5a830f8c9966")}</option><option value="injections">{marketplaceMessage("inventory.5fed173ae6ea")}</option><option value="topical">{marketplaceMessage("inventory.f9ae7e49f5b5")}</option><option value="devices">{marketplaceMessage("inventory.664bc690a7c9")}</option><option value="other">{marketplaceMessage("inventory.34e221c7e5db")}</option></select></label>
            <label>{marketplaceMessage("inventory.1cb0ba125f84")}<select value={availabilityFilter} onChange={(event) => { setAvailabilityFilter(event.target.value); setVisibleCount(INITIAL_PRODUCT_COUNT); }}><option value="all">{marketplaceMessage("inventory.718622df41f1")}</option><option value="priced">{marketplaceMessage("inventory.92a2c7590f2f")}</option><option value="orderable">{marketplaceMessage("inventory.ecfa5817871e")}</option><option value="registered">{marketplaceMessage("inventory.036d7bc33742")}</option></select></label>
            <label>{marketplaceMessage("inventory.bec69036aa27")}<select value={sort} onChange={(event) => { setSort(event.target.value); setVisibleCount(INITIAL_PRODUCT_COUNT); }}><option value="relevance">{marketplaceMessage("inventory.d83ab68f7428")}</option><option value="az">{marketplaceMessage("inventory.bb05620585b6")}</option><option value="za">{marketplaceMessage("inventory.ac2bd92e706d")}</option><option value="price">{marketplaceMessage("inventory.c659287eb505")}</option></select></label>
          </div>
          <div className="filter-dialog-actions"><button className="filter-reset" onClick={clearCatalogueFilters} disabled={!query && !hasActiveFilters}>{marketplaceMessage("inventory.645982c52b7c")}</button><button className="primary-wide" onClick={() => { setFiltersOpen(false); announce(marketplaceFormatMessage("inventory.6ab468927179", [marketplaceNumber(accessibleCatalogueSize)])); }}>{marketplaceFormatMessage("inventory.d09117b3a770", [marketplaceNumber(accessibleCatalogueSize)])}</button></div>
        </section>
      </div> : null}

      {cartOpen ? <div className="overlay order-wizard-overlay" onMouseDown={(event) => event.target === event.currentTarget && setCartOpen(false)}>
        <aside className="drawer order-wizard" role="dialog" aria-modal="true" aria-labelledby="order-basket-title" data-modal-root="order-basket" tabIndex={-1}>
          <header className="order-wizard-head"><div><h2 id="order-basket-title">{marketplaceMessage("inventory.e0f65214f68f")}</h2><p>{basketCount} {basketCount === 1 ? marketplaceMessage("inventory.4a33eacd5fa6") : marketplaceMessage("inventory.5f3c4f8580d3")}</p></div><button data-autofocus onClick={() => { setCartOpen(false); setRecentlyAddedBrand(""); }} aria-label={marketplaceMessage("inventory.7e29cdf2c712")}><X size={22} /></button></header>
          {!orderSent ? <OrderWizardProgress step={checkoutStep} /> : null}
          <div className="order-wizard-body" ref={orderWizardBodyRef}>
            {!orderSent && checkoutStep === 1 ? <section className="order-step-panel" aria-labelledby="order-review-heading">
              {recentlyAddedBrand ? <p className="order-added-feedback" role="status"><CircleCheck size={21} /><span><b>{recentlyAddedBrand}</b><small>{marketplaceMessage("inventory.f9c2f1181763")}</small></span></p> : null}
              <div className="order-step-heading"><h3 id="order-review-heading" data-checkout-step-focus tabIndex={-1}>{marketplaceMessage("inventory.2ce4067ce16c")}</h3>{cart.length ? <span>{cart.length} {cart.length === 1 ? marketplaceMessage("inventory.a8792157cb4f") : marketplaceMessage("inventory.0a3e27b8ca81")}</span> : null}</div>
              <div className={`cart-list order-review-list${showAllCartItems ? " show-all" : ""}`}>{displayedCartItems.map((item) => {
                const hasImage = Boolean(item.imageUrl ?? item.imageUrls?.[0]);
                return <div className={`cart-item order-review-item${hasImage ? "" : " without-image"}`} key={item.id}>
                  {hasImage ? <ProductVisual product={item} small /> : null}
                  <div className="cart-item-copy"><b>{[item.brand, item.strength].filter(Boolean).join(" ")}</b>{item.generic || item.packSize ? <small>{[item.generic, item.packSize ? `Pack ${item.packSize}` : ""].filter(Boolean).join(" · ")}</small> : null}<label className="substitute-check"><input type="checkbox" checked={item.substitutesAllowed} disabled={requestLocked} onChange={(event) => setSubstituteConsent(item.id, event.target.checked)} /> {marketplaceMessage("inventory.3feb3b37dc13")}</label></div>
                  <div className="quantity"><button onClick={() => adjust(item.id, -1)} disabled={requestLocked} aria-label={marketplaceFormatMessage("inventory.fab52f694fdb", [item.brand])}><Minus size={15} /></button><b>{item.quantity}</b><button onClick={() => adjust(item.id, 1)} disabled={requestLocked} aria-label={marketplaceFormatMessage("inventory.209e63a7b4c8", [item.brand])}><Plus size={15} /></button></div>
                </div>;
              })}</div>
              {cart.length > 2 ? <button type="button" className="order-list-toggle" onClick={() => setShowAllCartItems((current) => !current)}><List size={18} /> {showAllCartItems ? marketplaceMessage("inventory.2376c4fcdc07") : marketplaceFormatMessage("inventory.95fdb423920d", [cart.length])}</button> : null}
              {!cart.length ? <div className="empty-request"><ShoppingCart size={28} /><b>{marketplaceMessage("inventory.edbe34176351")}</b><p>{marketplaceMessage("inventory.822b4605fd22")}</p></div> : null}
              {customerMessage ? <p className="form-success" role="status" aria-live="polite"><CircleCheck size={15} /> {customerMessage}</p> : null}
              {restoredActiveOrders.length ? <div className="sent-timeline compact"><div><b>{marketplaceFormatMessage("inventory.a5c56c7873d4", [restoredActiveOrders.length, restoredActiveOrders.length === 1 ? marketplaceMessage("inventory.1f58b9145b24") : marketplaceMessage("inventory.ec72420df5df")])}</b><small>{marketplaceMessage("inventory.915e2b1c7306")}</small></div>{restoredActiveOrders.map((order) => <button className="text-action" key={order.orderId} onClick={() => openRestoredOrder(order)} disabled={ordering}>{marketplaceFormatMessage("inventory.653dbcb28b22", [order.reference, order.offerCount, order.offerCount === 1 ? marketplaceMessage("inventory.93cdccc66f8c") : marketplaceMessage("inventory.b73cbb3647cf")])}</button>)}</div> : null}
              {checkoutError ? <p className="form-error" role="alert"><CircleAlert size={15} /> {checkoutError}</p> : null}
            </section> : null}

            {!orderSent && checkoutStep === 2 ? <section className="order-step-panel order-details-panel" aria-labelledby="order-details-heading">
              <div className="order-step-heading"><h3 id="order-details-heading" data-checkout-step-focus tabIndex={-1}>{marketplaceMessage("inventory.67c60c78f48a")}</h3></div>
              <div className="whatsapp-field"><label htmlFor="customer-whatsapp">{marketplaceMessage("inventory.ec21453f9cd8")} <small>{marketplaceMessage("inventory.dd0285bfd9b4")}</small></label><div><select value={whatsappCountry} disabled={requestLocked} onChange={(event) => { setWhatsappCountry(event.target.value as CountryCode); setWhatsappTouched(false); resetCustomerWhatsappVerification(); }} aria-label={marketplaceMessage("inventory.36ca78914773")}>{whatsappCountries.map((item) => <option value={item.country} key={item.country}>{item.name} (+{item.callingCode})</option>)}</select><input id="customer-whatsapp" value={whatsapp} required disabled={requestLocked} onBlur={() => setWhatsappTouched(true)} onChange={(event) => { setWhatsapp(event.target.value.replace(/\D/g, "").slice(0, 15)); setWhatsappTouched(false); resetCustomerWhatsappVerification(); }} placeholder="78 000 000" inputMode="tel" autoComplete="tel-national" aria-invalid={whatsappTouched && !customerWhatsapp} aria-describedby={whatsappTouched && !customerWhatsapp ? "customer-whatsapp-error" : undefined} /></div></div>
              {whatsappTouched && !customerWhatsapp ? <p id="customer-whatsapp-error" className="form-error" role="alert"><CircleAlert size={15} /> {marketplaceMessage("inventory.e9f1e76b48e6")}</p> : null}
              <fieldset className="fulfilment-choice"><legend>{marketplaceMessage("inventory.a150b49c47b7")}</legend><div role="radiogroup" aria-label={marketplaceMessage("inventory.5fbfda7c58b3")}>
                <button type="button" role="radio" aria-checked={deliveryPreference === "either"} className={deliveryPreference === "either" ? "selected" : ""} onClick={() => setDeliveryPreference("either")} disabled={requestLocked}><PackageCheck size={23} /><span>{marketplaceMessage("inventory.0748a7c0654b")}</span>{deliveryPreference === "either" ? <Check size={15} /> : null}</button>
                <button type="button" role="radio" aria-checked={deliveryPreference === "pickup"} className={deliveryPreference === "pickup" ? "selected" : ""} onClick={() => setDeliveryPreference("pickup")} disabled={requestLocked}><ShoppingBag size={23} /><span>{marketplaceMessage("inventory.b685076a6057")}</span>{deliveryPreference === "pickup" ? <Check size={15} /> : null}</button>
                <button type="button" role="radio" aria-checked={deliveryPreference === "delivery"} className={deliveryPreference === "delivery" ? "selected" : ""} onClick={() => setDeliveryPreference("delivery")} disabled={requestLocked}><MapPin size={23} /><span>{marketplaceMessage("inventory.52bfe584a5fc")}</span>{deliveryPreference === "delivery" ? <Check size={15} /> : null}</button>
              </div></fieldset>
              <div className="order-location-heading"><h3>{marketplaceMessage("inventory.754296d08168")}</h3></div>
              <div className="location-choice-row order-location-options">
                {coordinates ? <button type="button" className="location-panel ready" onClick={() => requestNativeLocation(false)} disabled={requestLocked || locationLoading} aria-busy={locationLoading}><span><LocateFixed size={20} /></span><div><b>{locationLoading ? marketplaceMessage("inventory.07ea6364a00a") : marketplaceMessage("inventory.9d58f0cdd494")}</b><small>{location}</small></div>{locationLoading ? <LoaderCircle className="button-spinner" size={18} aria-hidden="true" /> : <Check size={18} />}</button> : <button type="button" className="location-panel location-action" onClick={() => requestNativeLocation(false)} disabled={requestLocked || locationLoading} aria-busy={locationLoading}><span>{locationLoading ? <LoaderCircle className="button-spinner" size={20} aria-hidden="true" /> : <LocateFixed size={20} />}</span><div><b>{locationLoading ? marketplaceMessage("inventory.992f1d90f13f") : marketplaceMessage("inventory.9833e6ac40f6")}</b><small>{marketplaceMessage("inventory.3237bfbffe9c")}</small></div><ChevronRight size={18} /></button>}
                {googleMapsBrowserKey ? <button type="button" className="location-panel map-location-action" onMouseEnter={() => { void import("./google-map-location-picker"); }} onFocus={() => { void import("./google-map-location-picker"); }} onTouchStart={() => { void import("./google-map-location-picker"); }} onClick={() => { setCheckoutError(""); setMapLocationOpen(true); }} disabled={requestLocked}><span><MapPin size={20} /></span><div><b>{marketplaceMessage("inventory.964c5724503c")}</b><small>{marketplaceMessage("inventory.cc7da367c45d")}</small></div><ChevronRight size={18} /></button> : null}
              </div>
              {cartRequiresPrescription || prescription || prescriptionError ? <><label className={`upload order-prescription${prescriptionError ? " has-error" : ""}`}><Upload size={18} /><span><b>{prescription ? prescription.name : marketplaceMessage("inventory.838f15f15126")}</b><small>{marketplaceMessage("inventory.5901e7c5b60b")}</small></span><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={requestLocked} aria-invalid={Boolean(prescriptionError)} aria-describedby={prescriptionError ? "prescription-error" : undefined} onChange={(event) => handlePrescriptionChange(event.target.files?.[0])} /></label>{prescriptionError ? <p id="prescription-error" className="form-error" role="alert"><CircleAlert size={15} /> {prescriptionError}</p> : null}</> : null}
              {mapLocationOpen ? <Suspense fallback={<FeatureLoading label={marketplaceMessage("inventory.4e279b7170a2")} />}><GoogleMapLocationPicker apiKey={googleMapsBrowserKey} initialCoordinates={coordinates} onCancel={() => setMapLocationOpen(false)} onChoose={applyMapLocation} /></Suspense> : null}
              {checkoutError ? <p className="form-error" role="alert"><CircleAlert size={15} /> {checkoutError}</p> : null}
            </section> : null}

            {!orderSent && checkoutStep === 3 ? <section className="order-step-panel order-verification-panel" aria-labelledby="order-verification-heading">
              <div className="order-step-heading"><h3 id="order-verification-heading" data-checkout-step-focus tabIndex={-1}>{marketplaceMessage("inventory.1fae65eb2e71")}</h3>{customerWhatsappVerified ? <span className="verification-badge"><CircleCheck size={14} /> {marketplaceMessage("inventory.4f7838402f37")}</span> : null}</div>
              <p className="verification-intro">{marketplaceMessage("inventory.62ea0a9256ba")}</p>
              <div className={`verification-number-card${customerWhatsappVerified ? " is-verified" : ""}`}>
                <span><MessageCircle size={22} /></span>
                <div><small>{marketplaceMessage("inventory.21b3520828dd")}</small><b>{customerWhatsapp ? `+${customerWhatsapp}` : marketplaceMessage("inventory.a9c7a31d1995")}</b></div>
                {customerWhatsappVerified ? <CircleCheck size={24} /> : <ShieldCheck size={24} />}
              </div>
              {customerWhatsappVerified ? <div className="verified-whatsapp-card"><CircleCheck size={23} /><div><b>{marketplaceMessage("inventory.15b6988f6ea2")}</b><p>{marketplaceMessage("inventory.edc5bd945d65")}</p></div></div> : <div className="customer-otp-card">
                {!customerOtpChallengeId ? <><b>{marketplaceMessage("inventory.25ed9fbdb48e")}</b><p>{marketplaceMessage("inventory.151f9a4a276e")}</p><button type="button" className="customer-otp-action" onClick={sendCustomerWhatsappCode} disabled={customerOtpLoading || !customerWhatsapp || previewMode}>{customerOtpLoading ? <LoaderCircle className="button-spinner" size={17} /> : <MessageCircle size={17} />}{customerOtpLoading ? marketplaceMessage("inventory.e6ddec3d9dee") : marketplaceMessage("whatsapp.send_code")}</button></> : <><label htmlFor="customer-whatsapp-otp">{marketplaceMessage("inventory.ac7622f7aa54")}<input id="customer-whatsapp-otp" value={customerOtp} onChange={(event) => setCustomerOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" maxLength={6} /></label><button type="button" className="customer-otp-action" onClick={verifyCustomerWhatsappCode} disabled={customerOtpLoading || customerOtp.length !== 6}>{customerOtpLoading ? <LoaderCircle className="button-spinner" size={17} /> : <ShieldCheck size={17} />}{customerOtpLoading ? marketplaceMessage("inventory.63bbd08c916b") : marketplaceMessage("whatsapp.verify_number")}</button><div className="customer-otp-meta"><button type="button" onClick={sendCustomerWhatsappCode} disabled={customerOtpLoading}>{marketplaceMessage("inventory.9200fc2f31ae")}</button>{customerOtpExpiresAt ? <small>{marketplaceFormatMessage("inventory.0b3888782faa", [marketplaceDate(customerOtpExpiresAt, undefined, { hour: "numeric", minute: "2-digit" })])}</small> : null}</div></>}
              </div>}
              {!previewMode && customerSessionAvailable !== true ? turnstileSiteKey ? <><Suspense fallback={<FeatureLoading label={marketplaceMessage("inventory.3ff1ca03805e")} />}><Turnstile key={captchaVersion} siteKey={turnstileSiteKey} onToken={(token) => { setCaptchaToken(token); if (token) setCaptchaError(""); }} onError={setCaptchaError} /></Suspense>{captchaError ? <p className="form-error" role="alert"><CircleAlert size={15} /> {captchaError}</p> : null}</> : <p className="privacy-note"><ShieldCheck size={14} /> {marketplaceMessage("inventory.aeef9da4a358")}</p> : null}
              <p className="whatsapp-consent-note"><ShieldCheck size={15} /> {marketplaceMessage("inventory.042afa1ab83e")}</p>
              {customerOtpMessage ? <p className="form-success" role="status" aria-live="polite"><CircleCheck size={15} /> {customerOtpMessage}</p> : null}
              {checkoutError ? <p className="form-error" role="alert"><CircleAlert size={15} /> {checkoutError}</p> : null}
            </section> : null}

            {!orderSent && checkoutStep === 4 ? <section className="order-step-panel order-confirm-panel" aria-labelledby="order-confirm-heading">
              <div className="order-step-heading"><h3 id="order-confirm-heading" data-checkout-step-focus tabIndex={-1}>{marketplaceMessage("inventory.4ed9052cf4be")}</h3></div>
              <div className="order-confirm-summary"><div><span>{marketplaceMessage("navigation.products")}</span><b>{basketCount} {basketCount === 1 ? marketplaceMessage("inventory.4a33eacd5fa6") : marketplaceMessage("inventory.5f3c4f8580d3")}</b></div><div><span>{marketplaceMessage("inventory.ca0afedf47b5")}</span><b>{customerWhatsapp ? `+${customerWhatsapp}` : marketplaceMessage("inventory.d83b9ff3c07a")}</b></div><div><span>{marketplaceMessage("inventory.7a0f5c50390a")}</span><b>{deliveryPreference === "either" ? marketplaceMessage("inventory.0748a7c0654b") : deliveryPreference === "pickup" ? marketplaceMessage("inventory.b685076a6057") : marketplaceMessage("inventory.52bfe584a5fc")}</b></div><div><span>{marketplaceMessage("inventory.811ace97bcf2")}</span><b>{coordinates ? marketplaceMessage("inventory.bcdf0f413028") : marketplaceMessage("inventory.b3ef45521049")}</b></div></div>
              <div className="order-confirm-products">{cart.slice(0, 3).map((item) => {
                const hasImage = Boolean(item.imageUrl ?? item.imageUrls?.[0]);
                return <div className={hasImage ? "" : "without-image"} key={item.id}>
                  {hasImage ? <ProductVisual product={item} small /> : null}
                  <span><b>{item.brand}</b><small>{[item.strength, `Qty ${item.quantity}`].filter(Boolean).join(" · ")}</small></span>
                </div>;
              })}{cart.length > 3 ? <p>{marketplaceFormatMessage("inventory.8ec0f083fb54", [cart.length - 3, cart.length - 3 === 1 ? marketplaceMessage("inventory.a8792157cb4f") : marketplaceMessage("inventory.0a3e27b8ca81")])}</p> : null}</div>
              {basketIndicativeFrom > 0 ? <div className="estimate"><span>{marketplaceMessage("inventory.01220e872896")}</span><b>{marketplaceMessage("product.indicative_price_prefix")} {marketplaceNumber(basketIndicativeFrom)}</b><small>{marketplaceMessage("inventory.10123e3563e7")}</small></div> : null}
              <p className="privacy-note"><MessageCircle size={14} /> {marketplaceMessage("inventory.f50f39df1262")}</p>
              {checkoutError ? <p className="form-error" role="alert"><CircleAlert size={15} /> {checkoutError}</p> : null}
              {pendingOrderAttempt?.rpcAttempted ? <p className="privacy-note"><ShieldCheck size={14} /> {marketplaceMessage("inventory.e408675f5fbc")}</p> : null}
              {cart.length || requestLocked ? <button className="text-action" onClick={resetRequest} disabled={ordering}>{requestLocked ? marketplaceMessage("inventory.190304bb034e") : marketplaceMessage("inventory.594e3c8701b9")}</button> : null}
            </section> : null}

            {orderSent ? <div className="sent-state"><span><Check size={35} /></span><h2>{marketplaceMessage("inventory.59fe2287713c")}</h2><p>{activeOrderNoRecipients ? marketplaceMessage("inventory.311cc1e57793") : marketplaceMessage("inventory.a386d4388388")}</p><div className="sent-timeline"><div><b>{marketplaceMessage("inventory.a73f99f6bfc8")}</b><small>{activeOrderId}</small></div><div><b>{activeOrderNoRecipients ? marketplaceMessage("inventory.a171bb3464b8") : activeOrderExpired ? marketplaceMessage("inventory.69318175e6db") : marketplaceMessage("status.waiting_for_confirmation")}</b><small>{activeOrderNoRecipients ? marketplaceMessage("inventory.b310b0fdec12") : activeOrderExpired ? marketplaceMessage("inventory.e3d9fa5974d7") : marketplaceMessage("inventory.2f44f48efbe9")}</small></div></div><button className="primary-wide" onClick={() => { setCartOpen(false); setOffersOpen(true); }}>{marketplaceMessage("inventory.db5a0ca06305")} <ArrowRight size={18} /></button><button className="text-action" onClick={() => closeAndResetOrder("cancelled")} disabled={closingOrder}>{closingOrder ? marketplaceMessage("inventory.9097a34aa426") : marketplaceMessage("inventory.56196683592d")}</button></div> : null}
            {orderSent && restoredActiveOrders.some((order) => order.orderId !== activeOrderId) ? <div className="sent-timeline"><div><b>{marketplaceMessage("inventory.be96c8c8639a")}</b><small>{marketplaceMessage("inventory.e902cb493ad0")}</small></div>{restoredActiveOrders.filter((order) => order.orderId !== activeOrderId).map((order) => <button className="text-action" key={order.orderId} onClick={() => openRestoredOrder(order)} disabled={ordering}>{marketplaceFormatMessage("inventory.653dbcb28b22", [order.reference, order.offerCount, order.offerCount === 1 ? marketplaceMessage("inventory.93cdccc66f8c") : marketplaceMessage("inventory.b73cbb3647cf")])}</button>)}</div> : null}
          </div>
          {!orderSent ? <footer className="order-wizard-actions">
            {checkoutStep === 1 ? <><button type="button" className="order-secondary-action" onClick={() => setCartOpen(false)}>{marketplaceMessage("inventory.264a224fd18a")}</button><button type="button" className="order-primary-action" onClick={continueToOrderDetails} disabled={!cart.length}>{marketplaceMessage("inventory.acbb998d8243")} <ArrowRight size={18} /></button></> : null}
            {checkoutStep === 2 ? <><button type="button" className="order-secondary-action" onClick={() => setCheckoutStep(1)}><ChevronLeft size={18} /> {marketplaceMessage("inventory.76900f1bfd16")}</button><button type="button" className="order-primary-action" onClick={continueToWhatsappVerification}>{marketplaceMessage("inventory.3b594438c7c5")} <ArrowRight size={18} /></button></> : null}
            {checkoutStep === 3 ? <><button type="button" className="order-secondary-action" onClick={() => setCheckoutStep(2)}><ChevronLeft size={18} /> {marketplaceMessage("inventory.76900f1bfd16")}</button><button type="button" className="order-primary-action" onClick={continueToOrderConfirmation} disabled={!customerWhatsappVerified}>{marketplaceMessage("inventory.dcea8abbdff0")} <ArrowRight size={18} /></button></> : null}
            {checkoutStep === 4 ? <><button type="button" className="order-secondary-action" onClick={() => setCheckoutStep(3)}><ChevronLeft size={18} /> {marketplaceMessage("inventory.76900f1bfd16")}</button><button type="button" className="order-primary-action" aria-busy={ordering} disabled={!cart.length || ordering || Boolean(prescriptionError) || !customerWhatsappVerified} onClick={submitOrder}>{ordering ? <LoaderCircle className="button-spinner" size={18} aria-hidden="true" /> : null}{ordering ? marketplaceMessage("inventory.94b1ce97199d") : previewMode ? marketplaceMessage("inventory.35c070ac7d98") : requestLocked ? marketplaceMessage("inventory.a7ce60b30ee0") : marketplaceMessage("inventory.2db32b4e0ab8")}{!ordering ? <ArrowRight size={18} /> : null}</button></> : null}
          </footer> : null}
        </aside>
      </div> : null}

      {offersOpen ? <section className={`offers-panel${!activeOrderId ? " is-empty" : ""}`} role="dialog" aria-modal="true" aria-labelledby="order-status-title" data-modal-root="order-status" tabIndex={-1}>
        <div className="offers-head"><div>
          <span>{activeOrderId ? marketplaceFormatMessage("inventory.ee32c6b780be", [activeOrderId.slice(0, 8).toUpperCase()]) : marketplaceMessage("status.my_requests")}</span>
          <h2 id="order-status-title">{!activeOrderId ? marketplaceMessage("inventory.a9b90e025a70") : activeOrderSelected ? marketplaceMessage("inventory.b02496ed63f0") : activeOrderNoRecipients ? marketplaceMessage("inventory.1db0e4cd0635") : activeOrderExpired ? marketplaceMessage("inventory.0ff5e16d4eb0") : marketplaceMessage("inventory.e23b5b835d4b")}</h2>
          <p aria-live="polite">{!activeOrderId
            ? marketplaceMessage("inventory.e6a17ad50582")
            : offers.length
              ? marketplaceFormatMessage("inventory.36d6ad3756e0", [offers.length, offers.length === 1 ? "pharmacy has" : "pharmacies have"])
              : activeOrderNoRecipients
                ? marketplaceMessage("inventory.61fc6f2fb44b")
                : activeOrderExpired
                  ? marketplaceMessage("inventory.71df5127e4ea")
                  : marketplaceFormatMessage("inventory.c72abdc4c191", [activeOrderMinutesRemaining != null ? ` About ${activeOrderMinutesRemaining} minutes remain.` : ""])}</p>
        </div><button type="button" data-autofocus onClick={() => setOffersOpen(false)} aria-label={marketplaceMessage("inventory.8b1d2d8a0765")}><X size={20} /></button></div>
        {checkoutError ? <p className="form-error" role="alert"><CircleAlert size={15} /> {checkoutError}</p> : null}
        {!activeOrderId ? <div className="offers-empty"><PackageCheck size={29} /><b>{marketplaceMessage("inventory.a9b90e025a70")}</b><p>{marketplaceMessage("inventory.7c387a6135b6")}</p><button type="button" className="primary-wide" onClick={() => { setOffersOpen(false); setCheckoutStep(1); setCartOpen(true); }}>{marketplaceMessage("inventory.57f437b24477")}</button></div> : !offers.length ? <div className={`offers-empty ${activeOrderExpired || activeOrderNoRecipients ? "terminal" : ""}`}>{activeOrderExpired || activeOrderNoRecipients ? <CircleAlert size={29} /> : <Clock3 size={29} />}<b>{activeOrderNoRecipients ? marketplaceMessage("inventory.bed101fcd6d5") : activeOrderExpired ? marketplaceMessage("inventory.f97506419978") : marketplaceMessage("status.waiting_for_confirmation")}</b><p>{activeOrderNoRecipients ? marketplaceMessage("inventory.657f24041e27") : activeOrderExpired ? marketplaceMessage("inventory.5a00003fe6ba") : marketplaceFormatMessage("inventory.e866672f84cd", [marketplaceMessage("status.no_stock_claim")])}</p>{activeOrderExpired || activeOrderNoRecipients ? <button type="button" className="primary-wide" onClick={() => closeAndResetOrder("cancelled")} disabled={closingOrder}>{closingOrder ? marketplaceMessage("inventory.9097a34aa426") : marketplaceMessage("status.close_request")}</button> : null}</div> : <div className="quotes">{offers.map((offer) => <article key={offer.id}><div className="quote-brand"><span><Cross size={18} /></span><div><h3>{offer.pharmacyName}</h3><p>{offer.distanceM >= 0 ? marketplaceFormatMessage("inventory.ac447e78b32c", [(offer.distanceM / 1_000).toFixed(1)]) : marketplaceMessage("inventory.2b60108eab7f")}</p></div></div><div className="availability complete"><Check size={15} />{marketplaceMessage("inventory.8779806acd36")}</div><div className="availability fulfilment"><PackageCheck size={15} />{offer.fulfilmentMethod === "pickup" ? marketplaceMessage("inventory.3e1a6c2093f4") : offer.fulfilmentMethod === "delivery" ? marketplaceMessage("inventory.84ae33b5cfd4") : marketplaceMessage("inventory.620d1a817aaf")}</div><div className="offer-items">{offer.items.map((item) => { const itemDetails = [item.product?.brand || item.offeredProductId, item.product?.strength, item.product?.packSize ? `Pack ${item.product.packSize}` : "", item.quantity ? `Qty ${item.quantity}` : "", item.unitPriceRwf ? `Optional estimate RWF ${marketplaceNumber(item.unitPriceRwf)} each` : ""].filter(Boolean); return <div key={item.id}><b>{item.isSubstitute ? marketplaceMessage("inventory.2a46ae71822a") : marketplaceMessage("inventory.fcae1310b229")}</b>{itemDetails.length ? <small>{itemDetails.join(" · ")}</small> : null}</div>; })}</div>{offer.totalRwf > 0 ? <div className="quote-price"><span>{marketplaceMessage("inventory.74f6f878d0a8")}</span><b>{marketplaceFormatMessage("inventory.c2a18c29440c", [marketplaceNumber(offer.totalRwf)])}</b><small>{marketplaceFormatMessage("inventory.b73b6ed9772f", [offer.readyInMinutes ? marketplaceFormatMessage("inventory.ae57138898c6", [offer.readyInMinutes]) : ""])}</small></div> : offer.readyInMinutes ? <div className="quote-price"><small>{marketplaceFormatMessage("inventory.b34789b2d655", [offer.readyInMinutes])}</small></div> : null}<div className="quote-actions"><button type="button" onClick={() => chooseOffer(offer)} disabled={selectionLocked} aria-busy={selectingOfferId === offer.id}>{selectingOfferId === offer.id ? <LoaderCircle className="button-spinner" size={15} aria-hidden="true" /> : null}{offer.status === "selected" ? marketplaceMessage("inventory.c6da331eadbe") : selectionLocked ? marketplaceMessage("inventory.8e672bac1fab") : selectingOfferId === offer.id ? marketplaceMessage("inventory.6ceaa117aca7") : marketplaceMessage("inventory.0dbd329b08d2")}</button><span className="contact-locked"><ShieldCheck size={15} /> {selectionLocked ? marketplaceMessage("inventory.ab13096fafe7") : marketplaceMessage("inventory.23de3977c324")}</span></div></article>)}</div>}
        {activeOrderSelected ? <div className="selected-contact">{selectedContact ? <><div><CircleCheck size={23} /><span><b>{marketplaceFormatMessage("inventory.486dc2549235", [selectedContact.pharmacyName])}</b><small>{marketplaceMessage("inventory.8e7e3ce3ad1c")}</small></span></div><div>{whatsappUrl(selectedContact.whatsapp, `Hello, ${selectedContact.pharmacyName} confirmed availability for my MED+250 request ${activeOrderId}. Please reconfirm the products, final price, and pickup or delivery details.`) ? <a onClick={() => trackMarketplaceEvent("whatsapp_handoff", { configured: true })} href={whatsappUrl(selectedContact.whatsapp, `Hello, ${selectedContact.pharmacyName} confirmed availability for my MED+250 request ${activeOrderId}. Please reconfirm the products, final price, and pickup or delivery details.`) ?? undefined} target="_blank" rel="noreferrer"><MessageCircle size={16} /> {marketplaceMessage("whatsapp.continue_with_pharmacy")}</a> : null}</div></> : <div><CircleAlert size={23} /><span><b>{marketplaceMessage("inventory.e3ecf041cb1d")}</b><small>{marketplaceMessage("inventory.13010923c704")}</small></span></div>}<div className="quote-actions"><button onClick={() => closeAndResetOrder("completed")} disabled={closingOrder}>{closingOrder ? marketplaceMessage("inventory.c0e1dcb79abd") : marketplaceMessage("inventory.937f6a721f25")}</button><button onClick={() => closeAndResetOrder("cancelled")} disabled={closingOrder}>{marketplaceMessage("inventory.56196683592d")}</button></div></div> : null}
      </section> : null}

      {portalOpen ? <div className="portal-overlay" role="presentation">
        {portalStage !== "workspace" ? <section className="portal-auth" role="dialog" aria-modal="true" aria-labelledby="pharmacy-signin-title" aria-describedby="pharmacy-signin-progress" aria-busy={portalLoading} data-modal-root="portal-auth" tabIndex={-1}><button className="portal-close" data-autofocus onClick={() => setPortalOpen(false)} aria-label={marketplaceMessage("inventory.ff49c2a5683a")}><X size={20} /></button><Link className="brand" href="/"><BrandLogo /></Link><ol className="wizard-progress" id="pharmacy-signin-progress" aria-label={marketplaceMessage("inventory.b7374f8f7224")}><li className="active" aria-current={portalStage === "signin" ? "step" : undefined}><span>1</span> {marketplaceMessage("inventory.6a40edf1fc87")}</li><li className={portalStage === "otp" ? "active" : ""} aria-current={portalStage === "otp" ? "step" : undefined}><span>2</span> {marketplaceMessage("request.verify_step")}</li><li><span>3</span> {marketplaceMessage("inventory.87bb59ba2f92")}</li></ol><h2 id="pharmacy-signin-title">{portalStage === "signin" ? marketplaceMessage("inventory.3be818907a1b") : marketplaceMessage("inventory.76305e161c53")}</h2>
          {portalStage === "signin" ? <><label htmlFor="pharmacy-whatsapp">{marketplaceMessage("inventory.ec21453f9cd8")}<InternationalPhoneInput id="pharmacy-whatsapp" country={pharmacyWhatsappCountry} nationalNumber={pharmacyWhatsapp} onCountryChange={setPharmacyWhatsappCountry} onNationalNumberChange={setPharmacyWhatsapp} /></label><button className="primary-wide" onClick={sendPharmacyCode} disabled={portalLoading || !pharmacyWhatsappE164}><MessageCircle size={17} /> {portalLoading ? marketplaceMessage("inventory.e6ddec3d9dee") : marketplaceMessage("whatsapp.send_code")}</button></> : <><small className="portal-otp-note">{marketplaceFormatMessage("inventory.5b55f450da05", [pharmacyWhatsappE164 ? `+${pharmacyWhatsappE164}` : pharmacyWhatsapp])}</small><label>{marketplaceMessage("inventory.3ee75029c70e")}<input value={pharmacyOtp} onChange={(event) => setPharmacyOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" inputMode="numeric" autoComplete="one-time-code" maxLength={6} /></label><button className="primary-wide" onClick={verifyPharmacyCode} disabled={portalLoading}>{portalLoading ? marketplaceMessage("inventory.63bbd08c916b") : marketplaceMessage("inventory.b733e7e84f03")} <ArrowRight size={17} /></button><button className="text-action" onClick={() => { setPortalStage("signin"); setPharmacyOtp(""); setPharmacyOtpChallengeId(""); setPortalError(""); setPortalMessage(""); }} disabled={portalLoading}>{marketplaceMessage("inventory.d9a6909304b4")}</button></>}
          {portalLoading ? <div className="inline-loading" role="status"><LoaderCircle className="button-spinner" size={17} /> {marketplaceMessage("inventory.5427e58e229f")}</div> : null}{portalMessage ? <p className="form-success" role="status" aria-live="polite"><CircleCheck size={15} /> {portalMessage}</p> : null}{portalError ? <p className="form-error" role="alert"><CircleAlert size={15} /> {portalError}</p> : null}
          {unregisteredPharmacyWhatsapp ? <div className="portal-exception-backdrop" role="presentation"><div className="portal-exception" role="alertdialog" aria-modal="true" aria-labelledby="unregistered-whatsapp-title" data-modal-root="unregistered-pharmacy" tabIndex={-1}><button data-autofocus onClick={() => setUnregisteredPharmacyWhatsapp("")} aria-label={marketplaceMessage("inventory.7d9eb7acb13e")}><X size={18} /></button><span><CircleAlert size={22} /></span><h3 id="unregistered-whatsapp-title">{marketplaceMessage("inventory.46ea2bdb2842")}</h3><p>{marketplaceMessage("inventory.f3cfa4c022bb")}</p><a className="primary-wide" href={`https://wa.me/${unregisteredPharmacyWhatsapp}?text=${encodeURIComponent(`Hello MED+250 admin, please help register or correct pharmacy WhatsApp number +${pharmacyWhatsappE164 ?? pharmacyWhatsapp}.`)}`} target="_blank" rel="noreferrer"><MessageCircle size={17} /> {marketplaceMessage("inventory.1a0cae1ddbf6")}</a><button className="text-action" onClick={() => setUnregisteredPharmacyWhatsapp("")}>{marketplaceMessage("inventory.bfe883b9dbb7")}</button></div></div> : null}
        </section> : <section className="portal-shell" role="dialog" aria-modal="true" aria-labelledby="pharmacy-workspace-title" aria-busy={portalLoading} data-modal-root="portal-workspace" tabIndex={-1}>
          <aside className="portal-sidebar"><Link className="brand" href="/"><BrandLogo /></Link><small>{marketplaceMessage("inventory.ff540cf154c2")}</small><nav><button className={portalTab === "requests" ? "active" : ""} onClick={() => setPortalTab("requests")}><Bell size={18} /> {marketplaceMessage("inventory.900b67c87ae0")} {pharmacyRequests.length ? <b>{pharmacyRequests.length}</b> : null}</button><button className={portalTab === "catalogue" ? "active" : ""} onClick={() => setPortalTab("catalogue")}><ShoppingBag size={18} /> {marketplaceMessage("inventory.fdb14e852a0c")}</button><button className={portalTab === "profile" ? "active" : ""} onClick={() => setPortalTab("profile")}><HeartPulse size={18} /> {marketplaceMessage("inventory.83e71ff6cc83")}</button></nav><div className="portal-user"><span>{activeMembership?.pharmacyName.slice(0, 2).toUpperCase()}</span><div><b>{activeMembership?.pharmacyName}</b><small>{activeMembership?.role}</small></div></div><button className="text-action" onClick={leavePharmacyPortal} disabled={portalLoading}>{marketplaceMessage("inventory.f20b73d631ff")}</button></aside>
          <div className="portal-main"><div className="portal-top"><div><h2 id="pharmacy-workspace-title">{portalTab === "requests" ? marketplaceMessage("inventory.900b67c87ae0") : portalTab === "catalogue" ? marketplaceMessage("inventory.718622df41f1") : marketplaceMessage("inventory.83e71ff6cc83")}</h2>{portalTab === "catalogue" ? null : <p>{marketplaceMessage("inventory.004ed96e7d9a")}</p>}</div><button data-autofocus onClick={() => setPortalOpen(false)} aria-label={marketplaceMessage("inventory.ff49c2a5683a")}><X size={20} /></button></div>
            <nav className="portal-mobile-tabs" aria-label={marketplaceMessage("inventory.454219d116e2")}><button className={portalTab === "requests" ? "active" : ""} onClick={() => setPortalTab("requests")}><Bell size={16} /> {marketplaceMessage("inventory.ada27592c957")}</button><button className={portalTab === "catalogue" ? "active" : ""} onClick={() => setPortalTab("catalogue")}><ShoppingBag size={16} /> {marketplaceMessage("inventory.5a6e4f56c0a2")}</button><button className={portalTab === "profile" ? "active" : ""} onClick={() => setPortalTab("profile")}><HeartPulse size={16} /> {marketplaceMessage("inventory.d696a35bdd18")}</button></nav>
            {portalMessage ? <p className="form-success"><CircleCheck size={15} /> {portalMessage}</p> : null}{portalError ? <p className="form-error"><CircleAlert size={15} /> {portalError}</p> : null}
            {portalTab === "requests" ? <>
              <div className="portal-metrics"><div><span><Bell size={18} /></span><p>{marketplaceMessage("inventory.d7d4a471c666")}</p><b>{pharmacyRequests.length}</b><small>{marketplaceMessage("inventory.ab3026fc0c02")}</small></div><div><span><Clock3 size={18} /></span><p>{marketplaceMessage("inventory.0bc2fd0e7f8a")}</p><b>{marketplaceMessage("inventory.78b9b22ebb6f")}</b><small>{marketplaceMessage("inventory.76306b737845")}</small></div><div><span><ShieldCheck size={18} /></span><p>{marketplaceMessage("inventory.aa09ffebfd30")}</p><b>{pharmacySelectedOrders.length}</b><small>{marketplaceMessage("inventory.a8f284393031")}</small></div></div>
              <div className="request-table-head"><div><h3>{marketplaceMessage("inventory.33d34b4036a2")}</h3><span>{marketplaceMessage("inventory.2a71d894079f")}</span></div><button type="button" onClick={refreshPharmacyRequests} disabled={portalLoading} aria-busy={portalLoading}>{portalLoading ? <LoaderCircle className="button-spinner" size={15} aria-hidden="true" /> : <LocateFixed size={15} />} {portalLoading ? marketplaceMessage("inventory.1c0def7be060") : marketplaceMessage("inventory.0e9161011702")}</button></div>
              {pharmacyRequests.length ? <div className="request-list">{pharmacyRequests.map((request) => <article key={request.orderId}><div className="request-id"><span className="new">{marketplaceMessage("inventory.6e10953f3e4c")}</span><b>{request.orderId.slice(0, 8).toUpperCase()}</b>{formatDate(request.createdAt) ? <small>{formatDate(request.createdAt)}</small> : null}</div><div><b>{request.distanceM >= 0 ? marketplaceFormatMessage("inventory.ac447e78b32c", [(request.distanceM / 1_000).toFixed(1)]) : marketplaceMessage("inventory.44b0a13234c6")}</b><small><MapPin size={12} /> {marketplaceMessage("inventory.b784abe3b2ce")}</small></div><div className="request-products-cell"><div className="request-product-images">{request.items.slice(0, 3).map((item) => { const product = pharmacyCatalogue.find((candidate) => candidate.id === item.productId); return product && (product.imageUrl || product.imageUrls?.[0]) ? <ProductVisual key={item.orderItemId} product={product} small /> : <span key={item.orderItemId}><PackageCheck size={14} /></span>; })}</div><b>{request.items.length} {request.items.length === 1 ? marketplaceMessage("inventory.a8792157cb4f") : marketplaceMessage("inventory.0a3e27b8ca81")}</b>{request.hasPrescription ? <small>{marketplaceMessage("inventory.60f784eae95d")}</small> : null}</div><div><b>{request.deliveryPreference}</b><small>{marketplaceMessage("inventory.c42df16033ac")}</small></div><button onClick={() => beginOffer(request)}>{marketplaceMessage("inventory.69f5db25bf92")} <ArrowRight size={15} /></button></article>)}</div> : <div className="portal-empty"><PackageCheck size={29} /><b>{marketplaceMessage("inventory.261da4e92eb3")}</b><p>{marketplaceMessage("inventory.2f1e8a059d91")}</p></div>}
              <div className="request-table-head"><div><h3>{marketplaceMessage("inventory.676b68693b41")}</h3><span>{marketplaceMessage("inventory.b3a7eb1621d5")}</span></div></div>
              {pharmacySelectedOrders.length ? <div className="request-list selected-order-list">{pharmacySelectedOrders.map((order) => <article key={order.orderId}><div className="request-id"><span className="new">{marketplaceMessage("inventory.6a6df4a0eec5")}</span><b>{order.reference}</b>{formatDate(order.selectedAt) ? <small>{formatDate(order.selectedAt)}</small> : null}</div><div><b>{order.deliveryPreference}</b><small>{marketplaceMessage("inventory.5279fac93b6e")}</small></div>{whatsappUrl(order.customerWhatsapp, `Hello, I’m contacting you from ${activeMembership?.pharmacyName ?? "the pharmacy"} about MED+250 request ${order.reference}. Please confirm availability, final price, and fulfilment details.`) ? <div><a href={whatsappUrl(order.customerWhatsapp, `Hello, I’m contacting you from ${activeMembership?.pharmacyName ?? "the pharmacy"} about MED+250 request ${order.reference}. Please confirm availability, final price, and fulfilment details.`) ?? undefined} target="_blank" rel="noreferrer"><MessageCircle size={14} /> {marketplaceMessage("inventory.8f110bac8951")}</a><small>{marketplaceMessage("inventory.43c1a5cb912f")}</small></div> : null}{order.prescriptionUrl ? <div><a href={order.prescriptionUrl} target="_blank" rel="noreferrer"><FileText size={14} /> {marketplaceMessage("inventory.976734763508")}</a><small>{marketplaceMessage("inventory.20a9b8ecc18e")}</small></div> : null}</article>)}</div> : <div className="portal-empty"><ShieldCheck size={29} /><b>{marketplaceMessage("inventory.26faa8bd8f43")}</b><p>{marketplaceMessage("inventory.4fb51cf5b034")}</p></div>}
            </> : null}
            {portalTab === "catalogue" ? <PharmacyCataloguePanel products={portalCatalogueMatches} catalogueProducts={pharmacyCatalogue} query={portalCatalogueQuery} drafts={centralPriceDrafts} submittingProductId={submittingPriceProductId} onQueryChange={setPortalCatalogueQuery} onDraftChange={(productId, value) => setCentralPriceDrafts((current) => ({ ...current, [productId]: value }))} onSubmit={(product) => { void recordCentralPrice(product); }} /> : null}
            {portalTab === "profile" ? <section className="portal-form profile-summary">
              <div><Store size={22} /><span><b>{activeMembership?.pharmacyName}</b><small>{marketplaceMessage("inventory.72612ddb720c")}</small></span></div>
              <dl>{activeMembership?.role ? <div><dt>{marketplaceMessage("inventory.09bdccc5fb69")}</dt><dd>{activeMembership.role.charAt(0).toUpperCase() + activeMembership.role.slice(1).toLowerCase()}</dd></div> : null}{activeMembership?.whatsapp ? <div><dt>{marketplaceMessage("inventory.70f74acb1403")}</dt><dd>+{activeMembership.whatsapp}</dd></div> : null}{activeMembership?.momoCode ? <div><dt>{marketplaceMessage("inventory.9300a99b30e3")}</dt><dd>{activeMembership.momoCode}</dd></div> : null}{activeMembership?.address || (activeMembership?.latitude != null && activeMembership.longitude != null) ? <div><dt>{marketplaceMessage("inventory.ef4903cec8c5")}</dt><dd className="pharmacy-profile-location">{activeMembership.address ? activeMembership.googleMapsUrl ? <a href={activeMembership.googleMapsUrl} target="_blank" rel="noreferrer"><MapPin size={14} aria-hidden="true" /> {activeMembership.address}</a> : <span>{activeMembership.address}</span> : null}{activeMembership.latitude != null && activeMembership.longitude != null ? <small>{activeMembership.latitude.toFixed(6)}, {activeMembership.longitude.toFixed(6)}</small> : null}</dd></div> : null}</dl>
              <p>{marketplaceMessage("inventory.e149bc6f0f0d")}</p>
              <div className="contact-edit-panel">
                <h3>{marketplaceMessage("inventory.6ed73037f10e")}</h3>
                <p>{marketplaceMessage("inventory.4dfeb91e939e")}</p>
                {pharmacyContacts.length ? <div className="pharmacy-contact-list">{pharmacyContacts.map((contact) => <article key={contact.id}><div><b>{contact.displayNumber}</b><small>{contact.contactType === "whatsapp" ? marketplaceMessage("inventory.6a40edf1fc87") : marketplaceMessage("inventory.63dceb8800b2")}{contact.isPrimary ? marketplaceMessage("inventory.1e41b9a6ba8b") : ""}{contact.isLoginEnabled ? marketplaceMessage("inventory.2e41f8aa35f2") : ""}</small></div><div><button type="button" onClick={() => beginContactReplacement(contact)} disabled={portalLoading}>{marketplaceMessage("inventory.95e154398a4b")}</button><button type="button" onClick={() => requestContactRemoval(contact)} disabled={portalLoading}>{marketplaceMessage("inventory.6b0bc4eca709")}</button></div></article>)}</div> : <p>{marketplaceMessage("inventory.830f9788e69b")}</p>}
                {pendingContactEdits.length ? <div className="pending-contact-edits"><b>{marketplaceMessage("inventory.f1c45f3f1314")}</b>{pendingContactEdits.map((request) => <span key={request.id}>{[`${request.action} ${request.contactType}`, request.requestedE164 ? `+${request.requestedE164}` : "", formatDate(request.createdAt)].filter(Boolean).join(" · ")}</span>)}</div> : null}
                <h3>{contactEditAction === "update" ? marketplaceMessage("inventory.6679d4e5fc66") : marketplaceMessage("inventory.8f691322f91b")}</h3>
                <label>{marketplaceMessage("inventory.9c37f4ab2257")}<select value={contactEditType} onChange={(event) => { setContactEditType(event.target.value === "phone" ? "phone" : "whatsapp"); setContactEditAction("add"); setContactEditContactId(null); }}><option value="whatsapp">{marketplaceMessage("inventory.6a40edf1fc87")}</option><option value="phone">{marketplaceMessage("inventory.63dceb8800b2")}</option></select></label>
                <label htmlFor="pharmacy-contact-number">{contactEditAction === "update" ? marketplaceMessage("inventory.a21e3d266c8a") : marketplaceMessage("inventory.7df127cda4fc")}<InternationalPhoneInput id="pharmacy-contact-number" country={contactEditWhatsappCountry} nationalNumber={contactEditWhatsapp} onCountryChange={setContactEditWhatsappCountry} onNationalNumberChange={setContactEditWhatsapp} /></label>
                <button className="primary-wide" onClick={requestContactEdit} disabled={portalLoading || !contactEditWhatsappE164}>{portalLoading ? marketplaceMessage("inventory.49195f559e4a") : contactEditAction === "update" ? marketplaceMessage("inventory.af1326d8095e") : marketplaceMessage("inventory.ca06556af647")}<ArrowRight size={17} /></button>
                {contactEditAction === "update" ? <button className="text-action" type="button" onClick={() => { setContactEditAction("add"); setContactEditContactId(null); setContactEditWhatsapp(""); }}>{marketplaceMessage("inventory.694ab4b7524f")}</button> : null}
              </div>
            </section> : null}
          </div>
        </section>}
        {selectedRequest ? <section className="offer-editor"><div className="offers-head"><div><span>{marketplaceMessage("inventory.26a2eeebb1ce")}</span><h2>{marketplaceFormatMessage("inventory.caf522383158", [selectedRequest.orderId.slice(0, 8).toUpperCase()])}</h2><p>{marketplaceMessage("inventory.189eb27de073")}</p></div><button onClick={() => setSelectedRequest(null)} aria-label={marketplaceMessage("inventory.1b1b15b87586")}><X size={20} /></button></div><div className="offer-items">{selectedRequest.items.map((item) => { const product = pharmacyCatalogue.find((candidate) => candidate.id === item.productId); return <article key={item.orderItemId}>{product && (product.imageUrl || product.imageUrls?.[0]) ? <ProductVisual product={product} small /> : null}<div><b>{item.productName}</b><small>{[`Qty ${item.quantity}`, item.packSize ? `Pack ${item.packSize}` : "", item.substitutesAllowed ? "A matching substitute is allowed" : "Exact product only"].filter(Boolean).join(" · ")}</small></div><label><input type="checkbox" checked={offerAvailability[item.orderItemId] ?? false} onChange={(event) => setOfferAvailability((current) => ({ ...current, [item.orderItemId]: event.target.checked }))} /> {marketplaceMessage("inventory.e674447337e8")}</label>{item.substitutesAllowed ? <label><input type="checkbox" checked={offerSubstitutes[item.orderItemId] ?? false} onChange={(event) => { const checked = event.target.checked; setOfferSubstitutes((current) => ({ ...current, [item.orderItemId]: checked })); setOfferProductIds((current) => ({ ...current, [item.orderItemId]: checked ? "" : item.productId })); }} /> {marketplaceMessage("inventory.251b0d28c24c")}</label> : null}{offerSubstitutes[item.orderItemId] ? <label>{marketplaceMessage("inventory.d87cc53b1689")}<select value={offerProductIds[item.orderItemId] ?? ""} onChange={(event) => setOfferProductIds((current) => ({ ...current, [item.orderItemId]: event.target.value }))}><option value="">{marketplaceMessage("inventory.ffacf8240734")}</option>{orderableCatalogue.filter((candidate) => candidate.id !== item.productId && isCompatibleSubstitute(candidate, item)).map((candidate) => <option value={candidate.id} key={candidate.id}>{[candidate.brand, candidate.strength, candidate.generic, candidate.packSize ? `Pack ${candidate.packSize}` : ""].filter(Boolean).join(" · ")}</option>)}</select></label> : null}<label>{marketplaceMessage("inventory.d6b4b13928ec")}<input value={offerPrices[item.orderItemId] ?? ""} onChange={(event) => setOfferPrices((current) => ({ ...current, [item.orderItemId]: event.target.value.replace(/\D/g, "") }))} inputMode="numeric" placeholder={marketplaceMessage("inventory.2d3ae584f5ad")} disabled={!(offerAvailability[item.orderItemId] ?? false)} /></label></article>; })}</div><div className="offer-meta"><label>{marketplaceMessage("inventory.f1d77053a6de")}<select value={offerFulfilmentMethod} onChange={(event) => setOfferFulfilmentMethod(event.target.value as "pickup" | "delivery" | "either")} disabled={selectedRequest.deliveryPreference !== "either"}>{selectedRequest.deliveryPreference === "either" ? <><option value="pickup">{marketplaceMessage("inventory.b685076a6057")}</option><option value="delivery">{marketplaceMessage("inventory.52bfe584a5fc")}</option><option value="either">{marketplaceMessage("inventory.0748a7c0654b")}</option></> : <option value={selectedRequest.deliveryPreference}>{selectedRequest.deliveryPreference === "pickup" ? marketplaceMessage("inventory.b685076a6057") : marketplaceMessage("inventory.52bfe584a5fc")}</option>}</select></label><label>{marketplaceMessage("inventory.9183c45f8c7c")}<input value={offerReadyMinutes} onChange={(event) => setOfferReadyMinutes(event.target.value.replace(/\D/g, ""))} /></label><label>{marketplaceMessage("inventory.d8da2c49df39")}<textarea value={offerNote} onChange={(event) => setOfferNote(event.target.value)} placeholder={marketplaceMessage("inventory.2f268a1df798")} /></label></div><button className="primary-wide" onClick={sendOffer} disabled={portalLoading}>{marketplaceMessage("inventory.b42165aaaa0e")} <ArrowRight size={17} /></button></section> : null}
      </div> : null}
      {feedbackToast ? <div className={`feedback-toast ${feedbackToast.tone === "info" ? "is-info" : ""}`} role="status" aria-live="polite" aria-atomic="true"><CircleCheck size={20} /><span>{feedbackToast.message}</span><button type="button" onClick={() => setFeedbackToast(null)} aria-label={marketplaceMessage("inventory.b7bb3f342402")}><X size={17} /></button></div> : null}
    </main>
  );
}
