"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  Bell,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Clock3,
  Cross,
  FileText,
  HeartPulse,
  LocateFixed,
  MapPin,
  Menu,
  MessageCircle,
  Minus,
  PackageCheck,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Store,
  Upload,
  X,
} from "lucide-react";
import BrandLogo from "./brand-logo";
import {
  backendConfigured,
  closeOrder,
  contributePrice,
  createOrder,
  deletePrescription,
  ensureAnonymousCustomer,
  loadCatalogue,
  loadCustomerProfile,
  loadMyActiveOrders,
  loadMyPharmacies,
  loadOffers,
  loadPharmacyDirectory,
  loadPharmacyRequests,
  loadPharmacySelectedOrders,
  loadSelectedContact,
  normalizeDawaNearError,
  requestPharmacyWhatsappOtp,
  selectOffer,
  signOutPharmacy,
  submitOffer,
  subscribeToOffers,
  subscribeToPharmacyNotifications,
  verifyPharmacyWhatsappOtp,
  uploadPrescription,
  type ActiveOrder,
  type DirectoryPharmacy,
  type CreateOrderInput,
  type OrderOffer,
  type PharmacyMembership,
  type PharmacyRequest,
  type PharmacyRequestItem,
  type PharmacySelectedOrder,
  type Product,
} from "../lib/dawanear-client";
import { pharmacySupabase } from "../lib/supabase";

type CartItem = Product & { quantity: number; substitutesAllowed: boolean };
type Coordinates = { latitude: number; longitude: number; accuracy: number };
type SelectedContact = { pharmacyName: string; whatsapp: string | null; momoCode: string | null };
type PortalTab = "requests" | "prices" | "profile";
type MarketplaceProps = {
  initialCategory?: string;
  pageTitle?: string;
  pageDescription?: string;
  pageImage?: string;
  showDepartments?: boolean;
  pharmacyPage?: boolean;
};
type IndexedProduct = {
  product: Product;
  brand: string;
  generic: string;
  details: string;
  tokens: string[];
};
type PendingOrderAttempt = {
  clientRequestId: string;
  prescriptionPath: string | null;
  rpcAttempted: boolean;
  payload: Omit<CreateOrderInput, "clientRequestId" | "prescriptionPath">;
};

const categories = ["All products", "Medicines", "Pain & fever", "Digestive health", "Allergy", "Diabetes care", "Personal care", "Baby & family", "Wellness"];
const departmentNav = [
  { label: "Medicines", href: "/category/medicines" },
  { label: "Personal care", href: "/category/personal-care" },
  { label: "Baby & family", href: "/category/baby-family" },
  { label: "Wellness", href: "/category/wellness" },
];
const medicineCategories = new Set(["Medicines", "Pain & fever", "Digestive health", "Allergy", "Diabetes care"]);
const searchSynonyms: Readonly<Record<string, readonly string[]>> = {
  ache: ["pain", "analgesic", "paracetamol", "ibuprofen"],
  allergy: ["allergic", "antihistamine", "cetirizine", "loratadine"],
  baby: ["infant", "child", "children", "pediatric", "nappy", "diaper"],
  cold: ["cough", "flu", "decongestant"],
  diabetes: ["diabetic", "glucose", "insulin", "metformin"],
  fever: ["temperature", "paracetamol", "ibuprofen"],
  headache: ["pain", "migraine", "paracetamol", "ibuprofen"],
  heartburn: ["reflux", "antacid", "omeprazole", "esomeprazole"],
  hygiene: ["personal care", "oral", "skin", "soap"],
  pain: ["ache", "analgesic", "paracetamol", "ibuprofen", "diclofenac"],
  skin: ["dermatology", "cream", "lotion", "topical", "soap"],
  stomach: ["digestive", "antacid", "omeprazole", "diarrhoea", "nausea"],
  vitamin: ["supplement", "wellness", "mineral"],
};
const accentClasses = ["coral", "blue", "mint", "violet", "amber"];
const productPackImages: Record<string, string> = {
  blue: "/marketplace/product-pack-blue.png",
  coral: "/marketplace/product-pack-coral.png",
  mint: "/marketplace/product-pack-mint.png",
  violet: "/marketplace/product-pack-violet.png",
  amber: "/marketplace/product-pack-amber.png",
};
const rwf = new Intl.NumberFormat("en-RW");
const marketplaceMode = process.env.NEXT_PUBLIC_MARKETPLACE_MODE === "live" ? "live" : "preview";

function normalizeSearchText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9%+./\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueSearchTerms(query: string) {
  const direct = normalizeSearchText(query).split(" ").filter(Boolean);
  return [...new Set(direct.flatMap((term) => [term, ...(searchSynonyms[term] ?? [])].flatMap((value) => normalizeSearchText(value).split(" "))))];
}

function tokenSimilarity(query: string, candidate: string) {
  if (query === candidate) return 1;
  if (candidate.startsWith(query) || query.startsWith(candidate)) return .82;
  if (candidate.includes(query) || query.includes(candidate)) return .68;
  if (query.length < 4 || candidate.length < 4) return 0;
  const queryPairs = new Set(Array.from({ length: query.length - 1 }, (_, index) => query.slice(index, index + 2)));
  const candidatePairs = new Set(Array.from({ length: candidate.length - 1 }, (_, index) => candidate.slice(index, index + 2)));
  let overlap = 0;
  queryPairs.forEach((pair) => { if (candidatePairs.has(pair)) overlap += 1; });
  return (2 * overlap) / (queryPairs.size + candidatePairs.size);
}

function indexProduct(product: Product): IndexedProduct {
  const brand = normalizeSearchText(product.brand);
  const generic = normalizeSearchText(product.generic);
  const details = normalizeSearchText(`${product.strength} ${product.form} ${product.packSize} ${product.category} ${product.prescriptionStatus}`);
  return { product, brand, generic, details, tokens: `${brand} ${generic} ${details}`.split(" ").filter(Boolean) };
}

function productSearchScore(indexed: IndexedProduct, query: string) {
  const normalized = normalizeSearchText(query);
  if (!normalized) return 1;
  const directTerms = new Set(normalized.split(" ").filter(Boolean));
  let score = 0;
  if (indexed.brand === normalized) score += 250;
  else if (indexed.brand.startsWith(normalized)) score += 180;
  else if (indexed.brand.includes(normalized)) score += 140;
  if (indexed.generic === normalized) score += 210;
  else if (indexed.generic.includes(normalized)) score += 125;
  if (indexed.details.includes(normalized)) score += 80;
  for (const term of uniqueSearchTerms(query)) {
    if (indexed.tokens.includes(term)) {
      score += directTerms.has(term) ? 72 : 58;
      continue;
    }
    if (term.length >= 4 && indexed.tokens.some((token) => token.startsWith(term) || (token.length >= 4 && term.startsWith(token)))) {
      score += directTerms.has(term) ? 55 : 42;
      continue;
    }
    if (!directTerms.has(term)) continue;
    let best = 0;
    for (const token of indexed.tokens) best = Math.max(best, tokenSimilarity(term, token));
    if (best >= .72) score += Math.round(best * 48);
  }
  return score;
}

function productMatchesCategory(product: Product, category: string) {
  if (category === "All products") return true;
  if (category === "Medicines") return medicineCategories.has(product.category);
  return product.category === category;
}

function productFormGroup(product: Product) {
  const form = normalizeSearchText(product.form);
  if (/tablet|caplet|capsule/.test(form)) return "tablets";
  if (/syrup|solution|suspension|drops|liquid/.test(form)) return "liquids";
  if (/injection|infusion|vial|ampoule/.test(form)) return "injections";
  if (/cream|ointment|gel|lotion|topical/.test(form)) return "topical";
  if (/device|meter|monitor|thermometer|inhaler/.test(form)) return "devices";
  return "other";
}

function catalogueText(value: string | undefined) {
  const text = value?.trim() ?? "";
  return !text || /^(?:—+|-+|n\/?a|null)$/i.test(text) ? "" : text;
}

function categoryFor(product: { brand_name?: string; generic_name?: string; dosage_form?: string; category?: string }) {
  if (product.category && product.category !== "Medicines") return product.category;
  const text = `${product.brand_name ?? ""} ${product.generic_name ?? ""} ${product.dosage_form ?? ""}`.toLowerCase();
  if (/paracetamol|diclofenac|ibuprofen|analges/.test(text)) return "Pain & fever";
  if (/cetirizine|loratadine|allerg/.test(text)) return "Allergy";
  if (/metformin|insulin|diabet/.test(text)) return "Diabetes care";
  if (/omeprazole|esomeprazole|antacid|digest/.test(text)) return "Digestive health";
  if (/baby|infant|diaper|nappy/.test(text)) return "Baby & family";
  if (/lotion|shampoo|tooth|skin|cosmetic|soap/.test(text)) return "Personal care";
  if (/vitamin|supplement|monitor|device|thermometer/.test(text)) return "Wellness";
  return "Medicines";
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
  return {
    id: `rwanda-fda-hm-${String(serial).padStart(4, "0")}`,
    brand: brand || generic || row.registration_number || "Registered product",
    generic,
    strength,
    form: dosageForm || "Registered product",
    packSize,
    category: categoryFor(row),
    productType: "human_medicine",
    prescriptionStatus: "unclassified",
    regulatoryStatus: row.regulatory_status || "valid",
    min: 0,
    max: 0,
    priceContributors: 0,
    imageUrl: null,
    isOrderable: false,
    accent: accentClasses[index % accentClasses.length],
  };
}

function fallbackPharmacy(row: Record<string, string>, online: boolean): DirectoryPharmacy {
  const serial = Number(row.source_serial || 0);
  return {
    id: `${online ? "online" : "retail"}-2026-05-${serial}`,
    registryEntryKey: `${online ? "online" : "retail"}-2026-05-${serial}`,
    registryType: online ? "online" : "retail",
    name: row.name,
    responsibleProfessional: row.technician || "",
    responsibleProfessionalRegistration: row.council_registration_number || "",
    province: row.province || "",
    district: row.district || "",
    area: row.sector_cell_raw || "",
    licenseExpiresOn: row.license_expiration_date || "",
    onlineLicenseVerified: online,
  };
}

function ProductVisual({ product, small = false }: { product: Product; small?: boolean }) {
  const fallbackImage = productPackImages[product.accent ?? "mint"] ?? productPackImages.mint;
  return (
    <div className={`dosage-art ${product.accent ?? "mint"} ${small ? "small" : ""}`} aria-hidden="true">
      <Image src={product.imageUrl ?? fallbackImage} alt="" width={small ? 54 : 170} height={small ? 44 : 128} unoptimized />
      {!small ? <span>{product.form.split(" · ")[0] || "Registered product"}</span> : null}
    </div>
  );
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not stated";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleDateString("en-RW", { day: "numeric", month: "short", year: "numeric" });
}

function errorMessage(error: unknown) {
  return normalizeDawaNearError(error).message;
}

function whatsappUrl(number: string | null | undefined, message: string) {
  const digits = number?.replace(/\D/g, "") ?? "";
  return /^2507[2389]\d{7}$/.test(digits)
    ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
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
  pharmacyPage = false,
}: MarketplaceProps = {}) {
  const previewMode = marketplaceMode !== "live";
  const orderingEnabled = !previewMode && backendConfigured;
  const [category, setCategory] = useState(initialCategory);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [prescriptionFilter, setPrescriptionFilter] = useState("all");
  const [formFilter, setFormFilter] = useState("all");
  const [availabilityFilter, setAvailabilityFilter] = useState("all");
  const [catalogue, setCatalogue] = useState<Product[]>([]);
  const [, setPharmacies] = useState<DirectoryPharmacy[]>([]);
  const [sort, setSort] = useState("relevance");
  const [dataSource, setDataSource] = useState("Loading official Rwanda FDA source snapshots…");
  const [visibleCount, setVisibleCount] = useState(24);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [location, setLocation] = useState("Location needed");
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [manualLocation, setManualLocation] = useState(false);
  const [manualLatitude, setManualLatitude] = useState("");
  const [manualLongitude, setManualLongitude] = useState("");
  const [locationConsent, setLocationConsent] = useState(false);
  const [broadcastConsent, setBroadcastConsent] = useState(false);
  const [whatsapp, setWhatsapp] = useState("");
  const [deliveryPreference, setDeliveryPreference] = useState<"pickup" | "delivery" | "either">("either");
  const [prescription, setPrescription] = useState<File | null>(null);
  const [pendingOrderAttempt, setPendingOrderAttempt] = useState<PendingOrderAttempt | null>(null);
  const [ordering, setOrdering] = useState(false);
  const [closingOrder, setClosingOrder] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [customerMessage, setCustomerMessage] = useState("");
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [activeOrderSelected, setActiveOrderSelected] = useState(false);
  const [restoredActiveOrders, setRestoredActiveOrders] = useState<ActiveOrder[]>([]);
  const [recipientCount, setRecipientCount] = useState(0);
  const [orderSent, setOrderSent] = useState(false);
  const [offers, setOffers] = useState<OrderOffer[]>([]);
  const [offersOpen, setOffersOpen] = useState(false);
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
  const [activeMembership, setActiveMembership] = useState<PharmacyMembership | null>(null);
  const [pharmacyRequests, setPharmacyRequests] = useState<PharmacyRequest[]>([]);
  const [pharmacySelectedOrders, setPharmacySelectedOrders] = useState<PharmacySelectedOrder[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<PharmacyRequest | null>(null);
  const [offerPrices, setOfferPrices] = useState<Record<string, string>>({});
  const [offerAvailability, setOfferAvailability] = useState<Record<string, boolean>>({});
  const [offerSubstitutes, setOfferSubstitutes] = useState<Record<string, boolean>>({});
  const [offerProductIds, setOfferProductIds] = useState<Record<string, string>>({});
  const [offerReadyMinutes, setOfferReadyMinutes] = useState("20");
  const [offerNote, setOfferNote] = useState("");
  const [priceProductId, setPriceProductId] = useState("");
  const [priceValue, setPriceValue] = useState("");
  const [priceSearch, setPriceSearch] = useState("");
  const activePharmacyId = activeMembership?.pharmacyId ?? null;

  useEffect(() => {
    const initialSearch = new URLSearchParams(window.location.search).get("search")?.trim();
    if (!initialSearch) return;
    queueMicrotask(() => setQuery(initialSearch));
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function initialise() {
      const [productResponse, retailResponse, onlineResponse] = await Promise.all([
        fetch("/data/rwanda-fda-products-july-2026.csv"),
        fetch("/data/rwanda-fda-pharmacies-may-2026.csv"),
        fetch("/data/rwanda-fda-online-pharmacies-may-2026.csv"),
      ]);
      if (productResponse.ok) {
        const rows = parseCsv(await productResponse.text()).filter((row) => !["grace_period", "expired"].includes(row.regulatory_status));
        if (!cancelled) {
          setCatalogue(rows.map(fallbackProduct));
          setDataSource(`${rows.length.toLocaleString()} current human-medicine register records · private source snapshot`);
        }
      }
      const directory: DirectoryPharmacy[] = [];
      if (retailResponse.ok) directory.push(...parseCsv(await retailResponse.text()).map((row) => fallbackPharmacy(row, false)));
      if (onlineResponse.ok) directory.push(...parseCsv(await onlineResponse.text()).map((row) => fallbackPharmacy(row, true)));
      if (!cancelled && directory.length) setPharmacies(directory);

      if (!backendConfigured) return;
      if (previewMode) {
        try {
          const [remoteProducts, remotePharmacies] = await Promise.all([
            loadCatalogue(),
            loadPharmacyDirectory(),
          ]);
          if (!cancelled && remoteProducts.length) {
            setCatalogue(remoteProducts);
            setDataSource(`${remoteProducts.length.toLocaleString()} live catalogue records · Supabase`);
          }
          if (!cancelled && remotePharmacies.length) setPharmacies(remotePharmacies);
        } catch (error) {
          if (!cancelled) setDataSource(`Official source snapshot · live catalogue unavailable: ${errorMessage(error)}`);
        }
        return;
      }
      try {
        await ensureAnonymousCustomer();
        const [profile, remoteProducts, remotePharmacies, activeOrders] = await Promise.all([
          loadCustomerProfile(),
          loadCatalogue(),
          loadPharmacyDirectory(),
          loadMyActiveOrders(),
        ]);
        if (!cancelled && profile?.whatsapp) setWhatsapp(profile.whatsapp.replace(/^250/, ""));
        if (!cancelled && remoteProducts.length) {
          setCatalogue(remoteProducts);
          setDataSource(`${remoteProducts.length.toLocaleString()} live catalogue records · Supabase`);
        }
        if (!cancelled && remotePharmacies.length) setPharmacies(remotePharmacies);
        if (!cancelled) setRestoredActiveOrders(activeOrders);
        const latestOrder = activeOrders[0];
        if (latestOrder) {
          if (!cancelled) {
            setActiveOrderId(latestOrder.orderId);
            setActiveOrderSelected(Boolean(latestOrder.selectedOfferId));
            setRecipientCount(latestOrder.recipientCount);
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
        if (!cancelled) setDataSource(`Official source snapshot · backend unavailable: ${errorMessage(error)}`);
      }
    }
    initialise().catch((error) => setDataSource(errorMessage(error)));
    return () => { cancelled = true; };
  }, [previewMode]);

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
    setRecipientCount(order.recipientCount);
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

  const indexedCatalogue = useMemo(() => catalogue.map(indexProduct), [catalogue]);

  const filtered = useMemo(() => indexedCatalogue
    .map((indexed) => ({ indexed, score: productSearchScore(indexed, deferredQuery) }))
    .filter(({ indexed, score }) => {
      const product = indexed.product;
      if (deferredQuery.trim() && score <= 0) return false;
      if (!productMatchesCategory(product, category)) return false;
      if (prescriptionFilter !== "all" && product.prescriptionStatus !== prescriptionFilter) return false;
      if (formFilter !== "all" && productFormGroup(product) !== formFilter) return false;
      if (availabilityFilter === "priced" && !(product.priceContributors > 0 && product.min > 0)) return false;
      if (availabilityFilter === "orderable" && !product.isOrderable) return false;
      if (availabilityFilter === "registered" && !["valid", "active", "expiring_soon"].includes(product.regulatoryStatus.toLowerCase())) return false;
      return true;
    })
    .toSorted((left, right) => {
      const a = left.indexed.product;
      const b = right.indexed.product;
      if (sort === "za") return b.brand.localeCompare(a.brand);
      if (sort === "price") return (a.min || Number.MAX_SAFE_INTEGER) - (b.min || Number.MAX_SAFE_INTEGER) || a.brand.localeCompare(b.brand);
      if (sort === "relevance" && deferredQuery.trim() && right.score !== left.score) return right.score - left.score;
      return a.brand.localeCompare(b.brand);
    })
    .map(({ indexed }) => indexed.product), [indexedCatalogue, deferredQuery, category, prescriptionFilter, formFilter, availabilityFilter, sort]);

  const searchSuggestions = useMemo(() => deferredQuery.trim().length >= 2 ? filtered.slice(0, 6) : [], [deferredQuery, filtered]);
  const hasActiveFilters = category !== initialCategory || prescriptionFilter !== "all" || formFilter !== "all" || availabilityFilter !== "all";

  const filteredPriceProducts = useMemo(() => {
    const normalized = priceSearch.trim().toLowerCase();
    if (!normalized) return catalogue.slice(0, 30);
    return catalogue.filter((product) => `${product.brand} ${product.generic}`.toLowerCase().includes(normalized)).slice(0, 30);
  }, [catalogue, priceSearch]);

  const orderableCatalogue = useMemo(() => catalogue.filter((product) => (
    product.isOrderable && ["valid", "active", "expiring_soon"].includes(product.regulatoryStatus.toLowerCase())
  )), [catalogue]);

  const basketCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const basketMin = cart.reduce((sum, item) => sum + item.min * item.quantity, 0);
  const basketMax = cart.reduce((sum, item) => sum + item.max * item.quantity, 0);
  const cartRequiresPrescription = cart.some((item) => item.prescriptionStatus === "prescription");
  const selectionLocked = activeOrderSelected || selectedContact !== null || offers.some((offer) => offer.status === "selected");
  const requestLocked = pendingOrderAttempt !== null;

  function showSearchResults() {
    setSuggestionsOpen(false);
    setVisibleCount(24);
    if (pharmacyPage) {
      window.location.assign(`/categories?search=${encodeURIComponent(query.trim())}#marketplace`);
      return;
    }
    document.querySelector("#marketplace")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function chooseSearchSuggestion(product: Product) {
    setQuery(product.brand);
    setSuggestionsOpen(false);
    setVisibleCount(24);
    if (pharmacyPage) {
      window.location.assign(`/categories?search=${encodeURIComponent(product.brand)}#marketplace`);
      return;
    }
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
    setVisibleCount(24);
  }

  function add(product: Product) {
    if (requestLocked) {
      setCheckoutError("Retry or reset the pending request before changing its products.");
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
  }

  function adjust(id: string, delta: number) {
    if (requestLocked) return;
    setCart((current) => current
      .map((item) => item.id === id ? { ...item, quantity: item.quantity + delta } : item)
      .filter((item) => item.quantity > 0));
  }

  function setSubstituteConsent(id: string, allowed: boolean) {
    if (requestLocked) return;
    setCart((current) => current.map((item) => item.id === id ? { ...item, substitutesAllowed: allowed } : item));
  }

  function updateLocationConsent(allowed: boolean) {
    setLocationConsent(allowed);
    if (!allowed) {
      setCoordinates(null);
      setLocation("Location needed");
      setManualLatitude("");
      setManualLongitude("");
      setManualLocation(false);
    }
  }

  function requestNativeLocation(grantConsent = false) {
    setCheckoutError("");
    if (!locationConsent && !grantConsent) {
      setCheckoutError("Please consent before requesting precise location access.");
      return;
    }
    if (grantConsent) setLocationConsent(true);
    if (!navigator.geolocation) {
      setManualLocation(true);
      setCheckoutError("This browser cannot detect location. Enter coordinates manually.");
      if (grantConsent) setCartOpen(true);
      return;
    }
    setLocation("Detecting your location…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy };
        setCoordinates(next);
        setLocation(`${next.latitude.toFixed(4)}, ${next.longitude.toFixed(4)} · ±${Math.round(next.accuracy)} m`);
      },
      () => {
        setLocation("Location permission not granted");
        setManualLocation(true);
        setCheckoutError("Location was not available. You can enter latitude and longitude manually.");
        if (grantConsent) setCartOpen(true);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60_000 },
    );
  }

  function detectLocation() {
    requestNativeLocation(false);
  }

  function applyManualLocation() {
    if (!locationConsent) {
      setCheckoutError("Consent to location use before entering manual coordinates.");
      return;
    }
    const latitude = Number(manualLatitude);
    const longitude = Number(manualLongitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      setCheckoutError("Enter valid latitude and longitude coordinates.");
      return;
    }
    setCoordinates({ latitude, longitude, accuracy: 500 });
    setLocation(`${latitude.toFixed(4)}, ${longitude.toFixed(4)} · manually entered`);
    setCheckoutError("");
  }

  function clearRequestState(message = "") {
    if (pendingOrderAttempt?.rpcAttempted) {
      setCheckoutError("This request may already have been committed. Retry the same secure request; local reset is disabled.");
      return false;
    }
    setPendingOrderAttempt(null);
    setActiveOrderId(null);
    setActiveOrderSelected(false);
    setRecipientCount(0);
    setOrderSent(false);
    setOffers([]);
    setOffersOpen(false);
    setSelectedContact(null);
    setCart([]);
    setPrescription(null);
    setBroadcastConsent(false);
    setLocationConsent(false);
    setCoordinates(null);
    setLocation("Location needed");
    setManualLocation(false);
    setManualLatitude("");
    setManualLongitude("");
    setCheckoutError("");
    setCustomerMessage(message);
    return true;
  }

  async function resetRequest() {
    if (pendingOrderAttempt?.rpcAttempted) {
      setCheckoutError("This request may already have been committed. Retry the same secure request so MED+250 can recover its receipt; resetting is disabled.");
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
        ? "Order marked completed. You can start another request."
        : "Order cancelled. You can start another request.");
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
    if (!orderingEnabled) {
      setCheckoutError("This is a private launch preview. No customer or health data has been sent.");
      return;
    }
    if (restoredActiveOrders.length > 0) {
      setCheckoutError("Open and close each existing active request before starting another one.");
      return;
    }
    if (!cart.length) {
      setCheckoutError("Add at least one product to your request.");
      return;
    }
    if (!locationConsent) {
      setCheckoutError("Consent to location use before sending the request.");
      return;
    }
    if (!coordinates) {
      setCheckoutError("Share or enter a location so we can find eligible pharmacies within 10 km.");
      return;
    }
    if (!broadcastConsent) {
      setCheckoutError("Please consent to sending the minimum request details to eligible pharmacies.");
      return;
    }
    if (cartRequiresPrescription && !prescription && !pendingOrderAttempt?.prescriptionPath) {
      setCheckoutError("Attach a valid prescription before requesting a prescription-classified product.");
      return;
    }
    if (coordinates.latitude < -3 || coordinates.latitude > -0.8 || coordinates.longitude < 28.7 || coordinates.longitude > 30.9) {
      setCheckoutError("MED+250 currently accepts request locations inside Rwanda only.");
      return;
    }
    setOrdering(true);
    let attempt = pendingOrderAttempt;
    try {
      if (!attempt) {
        if (!globalThis.crypto?.randomUUID) {
          throw new Error("Secure request IDs are unavailable in this browser. Update your browser and try again.");
        }
        attempt = {
          clientRequestId: globalThis.crypto.randomUUID(),
          prescriptionPath: null,
          rpcAttempted: false,
          payload: {
            latitude: coordinates.latitude,
            longitude: coordinates.longitude,
            locationAccuracyM: coordinates.accuracy,
            whatsapp: whatsapp ? `250${whatsapp}` : null,
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
      await ensureAnonymousCustomer();
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
      setRecipientCount(result.recipientCount);
      setOffers([]);
      setSelectedContact(null);
      setOrderSent(true);
      if (cleanupWarning) setCheckoutError(cleanupWarning);
    } catch (error) {
      setCheckoutError(attempt
        ? `${errorMessage(error)} The same request ID and prescription upload will be reused when you retry.`
        : errorMessage(error));
    } finally {
      setOrdering(false);
    }
  }

  async function chooseOffer(offer: OrderOffer) {
    if (!activeOrderId) return;
    setCheckoutError("");
    try {
      const contact = await selectOffer(activeOrderId, offer.id);
      setSelectedContact(contact);
      setActiveOrderSelected(true);
      await refreshOffers(activeOrderId);
    } catch (error) {
      setCheckoutError(errorMessage(error));
    }
  }

  async function openPortal() {
    setPortalOpen(true);
    setPortalError("");
    setPortalMessage("");
    if (!backendConfigured) {
      setPortalStage("signin");
      setPortalError("The Supabase project is not connected to this deployment yet.");
      return;
    }
    setPortalLoading(true);
    try {
      const { data, error } = await pharmacySupabase!.auth.getSession();
      if (error) throw error;
      if (!data.session || data.session.user.is_anonymous) {
        setPortalStage("signin");
        return;
      }
      const rows = await loadMyPharmacies();
      if (!rows.length) {
        await signOutPharmacy();
        setPortalError("This WhatsApp number is not linked to an approved pharmacy.");
        setPortalStage("signin");
        return;
      }
      const membership = rows[0];
      setActiveMembership(membership);
      setPortalStage("workspace");
      const [requests, selectedOrders] = await Promise.all([
        loadPharmacyRequests(membership.pharmacyId),
        loadPharmacySelectedOrders(membership.pharmacyId),
      ]);
      setPharmacyRequests(requests);
      setPharmacySelectedOrders(selectedOrders);
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
    if (!/^7[2389]\d{7}$/.test(pharmacyWhatsapp)) {
      setPortalError("Enter a valid Rwanda WhatsApp number.");
      return;
    }
    setPortalLoading(true);
    try {
      const challenge = await requestPharmacyWhatsappOtp(`250${pharmacyWhatsapp}`);
      setPharmacyOtpChallengeId(challenge.challengeId);
      setPharmacyOtp("");
      setPortalStage("otp");
      setPortalMessage("If this number is linked to an approved pharmacy, the 6-digit code is now in WhatsApp.");
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
        throw new Error("This WhatsApp number is not linked to an approved pharmacy.");
      }
      const membership = rows[0];
      setActiveMembership(membership);
      setPortalStage("workspace");
      const [requests, selectedOrders] = await Promise.all([
        loadPharmacyRequests(membership.pharmacyId),
        loadPharmacySelectedOrders(membership.pharmacyId),
      ]);
      setPharmacyRequests(requests);
      setPharmacySelectedOrders(selectedOrders);
      setPortalMessage("Pharmacy access verified.");
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
      setSelectedRequest(null);
      setPortalTab("requests");
      setPortalStage("signin");
      setPharmacyWhatsapp("");
      setPharmacyOtp("");
      setPharmacyOtpChallengeId("");
      setPortalMessage("Signed out of the pharmacy portal. The customer request session remains separate.");
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
    setOfferNote("");
  }

  async function sendOffer() {
    if (!activeMembership || !selectedRequest) return;
    setPortalError("");
    setPortalLoading(true);
    try {
      await submitOffer({
        pharmacyId: activeMembership.pharmacyId,
        orderId: selectedRequest.orderId,
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
            unitPriceRwf: Number(offerPrices[item.orderItemId] || 0),
            quantity: item.quantity,
            note: null,
          };
        }),
      });
      setPortalMessage("Offer sent to the customer.");
      setSelectedRequest(null);
      await refreshPharmacyRequests();
    } catch (error) {
      setPortalError(errorMessage(error));
    } finally {
      setPortalLoading(false);
    }
  }

  async function addPriceContribution() {
    if (!activeMembership || !priceProductId || !Number(priceValue)) {
      setPortalError("Choose a product and enter a valid RWF price.");
      return;
    }
    setPortalLoading(true);
    setPortalError("");
    try {
      await contributePrice(activeMembership.pharmacyId, priceProductId, Number(priceValue));
      setPortalMessage("Price contribution saved. The public range now reflects eligible current contributions.");
      setPriceValue("");
    } catch (error) {
      setPortalError(errorMessage(error));
    } finally {
      setPortalLoading(false);
    }
  }

  return (
    <main>
      <header className="site-header">
        <Link className="brand" href="/" aria-label="med+250 home"><BrandLogo /></Link>
        <button className={`delivery-location ${coordinates ? "location-ready" : ""}`} onClick={() => requestNativeLocation(true)}><MapPin size={18} /><span><small>{coordinates ? "Current location" : "Deliver to"}</small><b>{coordinates ? "Location ready" : location === "Location needed" ? "Use location" : location}</b></span>{coordinates ? <Check size={14} /> : <ChevronDown size={13} />}</button>
        <div
          className="header-search-shell"
          onFocusCapture={() => setSuggestionsOpen(true)}
          onBlurCapture={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setSuggestionsOpen(false); }}
        >
          <div className="header-search">
            <select value={category} onChange={(event) => { setCategory(event.target.value); setVisibleCount(24); }} aria-label="Search category">{categories.map((item) => <option key={item} value={item}>{item === "All products" ? "All Categories" : item}</option>)}</select>
            <input value={query} onChange={(event) => { setQuery(event.target.value); setSuggestionsOpen(true); setVisibleCount(24); }} onKeyDown={(event) => { if (event.key === "Enter") showSearchResults(); if (event.key === "Escape") setSuggestionsOpen(false); }} placeholder="Search by product, generic name, symptom or use" aria-label="Search the marketplace" aria-controls="smart-search-suggestions" autoComplete="off" />
            <button type="button" onClick={showSearchResults}><Search size={22} /><span>Search</span></button>
          </div>
          {suggestionsOpen && query.trim().length >= 2 ? <div className="search-suggestions" id="smart-search-suggestions" role="listbox" aria-label="Search suggestions">
            <div><Sparkles size={15} /><span>{searchSuggestions.length ? "Intelligent matches" : "No close matches yet"}</span></div>
            {searchSuggestions.map((product) => <button type="button" role="option" aria-selected="false" key={product.id} onClick={() => chooseSearchSuggestion(product)}><span><b>{product.brand}</b><small>{[product.generic, product.strength].filter(Boolean).join(" · ")}</small></span><em>{product.category}</em></button>)}
          </div> : null}
        </div>
        <div className="header-actions">
          <button className="header-utility" onClick={() => setCartOpen(true)}><PackageCheck size={19} /><span><small>My</small><b>Orders</b></span></button>
          <button className="header-utility" onClick={openPortal}><Store size={19} /><span><small>Pharmacy</small><b>portal</b></span></button>
          <button className="bag-button" onClick={() => setCartOpen(true)} aria-label={`Open request with ${basketCount} items`}><ShoppingBag size={22} /><span>Request basket</span><b>{basketCount}</b></button>
          <button className="mobile-toggle" onClick={() => setMobileMenu(!mobileMenu)} aria-label="Toggle navigation"><Menu size={22} /></button>
        </div>
      </header>

      <div className="commerce-nav" id="top">
        <a href="/categories"><Menu size={18} /> All Categories</a>
        {departmentNav.map((item) => <a key={item.href} href={item.href}>{item.label}</a>)}
        <a href="/pharmacies">Pharmacies</a>
      </div>

      {pharmacyPage ? <section className="pharmacy-route-hero">
        <div><h1>One pharmacy portal for nearby marketplace demand.</h1><p>Verified pharmacy teams can review eligible requests, submit itemised offers, contribute current product prices, and continue fulfilment with the customer after selection.</p><button onClick={openPortal}>Open pharmacy portal <ArrowRight size={18} /></button></div>
        <div className="pharmacy-route-panel"><Store size={34} /><h2>Permanent staff identity</h2><p>Access requires email sign-in and an operator-approved membership linked to a listed pharmacy.</p><span><ShieldCheck size={16} /> Customer contact remains locked until selection</span><span><LocateFixed size={16} /> Nearby requests use the customer&apos;s consented location</span></div>
      </section> : <>
        {pageTitle ? <section className="category-route-banner">
          <div><h1>{pageTitle}</h1><p>{pageDescription}</p><button onClick={() => requestNativeLocation(true)}><LocateFixed size={18} /> {coordinates ? "Location ready" : "Use my location"}</button></div>
          <Image src={pageImage ?? "/marketplace/hero-pharmacy-still-life.png"} alt="" width={620} height={330} priority unoptimized />
        </section> : <section className="market-banner">
          <div className="market-banner-copy"><h1>One request. <em>Nearby pharmacy offers.</em></h1><p>Build a request from regulator-derived source data, compare offers from licensed pharmacies near you, and choose with confidence.</p><a className="shop-button" href="#marketplace">Browse registered products <ArrowRight size={18} /></a></div>
          <div className="market-banner-art"><Image src="/marketplace/hero-pharmacy-still-life.png" alt="Pharmacy and wellness products arranged in the med+250 brand colours" width={760} height={340} priority unoptimized /></div>
        </section>}

        {(!pageTitle || showDepartments) ? <section className="department-cards" aria-label="Shop pharmacy departments">
          <article><div><h2>Medicines &amp;<br />pain relief</h2><p>Find relief from pain, fever, cough, allergies and more.</p><a href="/category/medicines">Shop medicines <ArrowRight size={15} /></a></div><Image src="/marketplace/category-medicines.png" alt="Medicine box and blister pack" width={210} height={150} unoptimized /></article>
          <article><div><h2>Personal care</h2><p>Everyday essentials for you and your family.</p><a href="/category/personal-care">Shop personal care <ArrowRight size={15} /></a></div><Image src="/marketplace/category-personal-care.png" alt="Personal care products" width={210} height={150} unoptimized /></article>
          <article><div><h2>Baby &amp; family</h2><p>Trusted care for babies and growing families.</p><a href="/category/baby-family">Shop baby &amp; family <ArrowRight size={15} /></a></div><Image src="/marketplace/category-baby-family.png" alt="Baby and family care products" width={210} height={150} unoptimized /></article>
          <article><div><h2>Wellness &amp;<br />devices</h2><p>Support your health and monitor with confidence.</p><a href="/category/wellness">Shop wellness <ArrowRight size={15} /></a></div><Image src="/marketplace/category-wellness-devices.png" alt="Digital health monitoring device" width={210} height={150} unoptimized /></article>
        </section> : null}

        <section className="marketplace-section" id="marketplace">
          <div className="section-heading"><div><h2>{pageTitle ?? "Frequently requested today"}</h2><p>{query.trim() ? `Best matches for “${query.trim()}”` : "Price ranges from nearby pharmacies"}</p></div><button className="see-all" onClick={() => setVisibleCount((count) => count + 48)}>See all</button></div>
          <div className="smart-filter-bar" aria-label="Catalogue filters">
            <div className="smart-filter-summary"><span><Sparkles size={16} /></span><div><b>{filtered.length.toLocaleString()} intelligent matches</b><small title={dataSource}>Brand, generic name, symptom, strength and form</small></div></div>
            <label>Category<select value={category} onChange={(event) => { setCategory(event.target.value); setVisibleCount(24); }}>{categories.map((item) => <option key={item} value={item}>{item === "All products" ? "All Categories" : item}</option>)}</select></label>
            <label>Prescription<select value={prescriptionFilter} onChange={(event) => { setPrescriptionFilter(event.target.value); setVisibleCount(24); }}><option value="all">Any status</option><option value="non_prescription">OTC</option><option value="prescription">Prescription</option><option value="pharmacist_only">Ask pharmacist</option><option value="unclassified">Needs verification</option></select></label>
            <label>Form<select value={formFilter} onChange={(event) => { setFormFilter(event.target.value); setVisibleCount(24); }}><option value="all">Any form</option><option value="tablets">Tablets & capsules</option><option value="liquids">Liquids & drops</option><option value="injections">Injections</option><option value="topical">Creams & topical</option><option value="devices">Devices & inhalers</option><option value="other">Other forms</option></select></label>
            <label>Availability<select value={availabilityFilter} onChange={(event) => { setAvailabilityFilter(event.target.value); setVisibleCount(24); }}><option value="all">Any availability</option><option value="priced">Verified price</option><option value="orderable">Orderable online</option><option value="registered">Current registration</option></select></label>
            <label>Sort<select value={sort} onChange={(event) => { setSort(event.target.value); setVisibleCount(24); }}><option value="relevance">Best match</option><option value="az">Name: A–Z</option><option value="za">Name: Z–A</option><option value="price">Lowest verified price</option></select></label>
            {query || hasActiveFilters ? <button className="clear-filters" onClick={clearCatalogueFilters}><SlidersHorizontal size={14} /> Reset</button> : null}
          </div>
          {filtered.length ? <div className="product-grid">
            {filtered.slice(0, visibleCount).map((product) => (
              <article className="product-card" key={product.id}>
                <div className="product-image-wrap"><ProductVisual product={product} /><span className={`rx-badge ${product.prescriptionStatus === "unclassified" ? "verify" : ""}`}>{product.prescriptionStatus === "prescription" ? "Rx" : product.prescriptionStatus === "non_prescription" ? "OTC" : product.prescriptionStatus === "pharmacist_only" ? "ASK" : "VERIFY"}</span></div>
                <div className="product-meta"><span>{product.category}</span><small>{product.regulatoryStatus === "expiring_soon" ? "EXPIRING SOON" : "REGISTERED"}</small></div>
                <h3>{product.brand} <span>{product.strength}</span></h3>
                <p>{product.generic}</p>
                <div className="form-label">{product.form}{product.packSize ? ` · ${product.packSize}` : ""}</div>
                <div className="price-line"><div><small>{product.priceContributors ? `${product.priceContributors} pharmacy price contribution${product.priceContributors === 1 ? "" : "s"}` : "Price range from pharmacies"}</small><b>{product.min > 0 ? `RWF ${rwf.format(product.min)}–${rwf.format(product.max)}` : "Awaiting verified prices"}</b></div><button onClick={() => add(product)} disabled={!previewMode && !product.isOrderable} aria-label={`Add ${product.brand} to request`} title={!previewMode && !product.isOrderable ? "Not approved for online ordering" : "Add to request"}><Plus size={16} /> Add to request</button></div>
              </article>
            ))}
          </div> : <div className="catalogue-empty"><Search size={28} /><h3>No close product match</h3><p>Try a brand, generic name, symptom, dosage form, or remove one of the filters.</p><button onClick={clearCatalogueFilters}>Reset search and filters</button></div>}
          {filtered.length > visibleCount ? <button className="view-all" onClick={() => setVisibleCount((count) => count + 48)}>Show 48 more products <ArrowRight size={17} /></button> : null}
        </section>
      </>}

      <section className="network-strip" id="pharmacies"><div><span className="network-icon"><Store size={27} /></span><div><b>Represent an eligible pharmacy?</b><p>Permanent staff sign-in and operator approval are required before any request is visible.</p></div></div><button onClick={openPortal}>Open pharmacy portal <ArrowRight size={17} /></button></section>

      <footer><Link className="brand footer-brand" href="/" aria-label="med+250 home"><BrandLogo /></Link><p>MED+250 does not diagnose, prescribe, advertise prescription medicines, or replace a qualified health professional.</p><div><a href="/categories">Catalogue</a><a href="/pharmacies">Pharmacies</a><button onClick={openPortal}>Pharmacy portal</button></div></footer>

      {cartOpen ? <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && setCartOpen(false)}>
        <aside className="drawer" aria-label="Your product request">
          <div className="drawer-head"><div><span>YOUR REQUEST</span><h2>{basketCount} {basketCount === 1 ? "product" : "products"}</h2></div><button onClick={() => setCartOpen(false)} aria-label="Close request"><X size={20} /></button></div>
          {!orderSent ? <>
            <div className="cart-list">{cart.map((item) => <div className="cart-item" key={item.id}><ProductVisual product={item} small /><div><b>{item.brand} {item.strength}</b><small>{item.generic}{item.packSize ? ` · Pack ${item.packSize}` : ""}</small><span>{item.min ? `RWF ${rwf.format(item.min)}–${rwf.format(item.max)}` : "Final price comes from offers"}</span><label className="substitute-check"><input type="checkbox" checked={item.substitutesAllowed} disabled={requestLocked} onChange={(event) => setSubstituteConsent(item.id, event.target.checked)} /> Allow pharmacist-proposed substitute</label></div><div className="quantity"><button onClick={() => adjust(item.id, -1)} disabled={requestLocked} aria-label={`Decrease ${item.brand} quantity`}><Minus size={13} /></button><b>{item.quantity}</b><button onClick={() => adjust(item.id, 1)} disabled={requestLocked} aria-label={`Increase ${item.brand} quantity`}><Plus size={13} /></button></div></div>)}</div>
            {!cart.length ? <div className="empty-request"><ShoppingBag size={26} /><b>Your request is empty</b><p>Add products from the catalogue. Nothing is sent until you consent and submit.</p></div> : null}
            {customerMessage ? <p className="form-success"><CircleCheck size={15} /> {customerMessage}</p> : null}
            {restoredActiveOrders.length ? <div className="sent-timeline"><div><b>{restoredActiveOrders.length} active {restoredActiveOrders.length === 1 ? "request" : "requests"}</b><small>Open an existing request before starting another.</small></div>{restoredActiveOrders.map((order) => <button className="text-action" key={order.orderId} onClick={() => openRestoredOrder(order)} disabled={ordering}>Open {order.reference} · {order.offerCount} {order.offerCount === 1 ? "offer" : "offers"}</button>)}</div> : null}
            <label className="whatsapp-field"><span>WhatsApp number <small>optional · saved to your customer profile</small></span><div><span>+250</span><input value={whatsapp} disabled={requestLocked} onChange={(event) => setWhatsapp(event.target.value.replace(/\D/g, "").slice(0, 9))} placeholder="78 000 0000" inputMode="numeric" /></div></label>
            <label className="select-field"><span>Fulfilment preference</span><select value={deliveryPreference} disabled={requestLocked} onChange={(event) => setDeliveryPreference(event.target.value as typeof deliveryPreference)}><option value="either">Pickup or delivery</option><option value="pickup">Pickup</option><option value="delivery">Delivery</option></select></label>
            <label className="upload"><Upload size={18} /><span><b>{prescription ? prescription.name : cartRequiresPrescription ? "Attach required prescription" : "Attach prescription"}</b><small>{cartRequiresPrescription ? "Required for prescription-classified products · visible only to the selected pharmacy" : "Optional when no selected product is classified as prescription-only · visible only to the selected pharmacy"}</small></span><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={requestLocked} onChange={(event) => setPrescription(event.target.files?.[0] ?? null)} /></label>
            <label className="consent-check"><input type="checkbox" checked={locationConsent} disabled={requestLocked} onChange={(event) => updateLocationConsent(event.target.checked)} /><span>I consent to using my precise location to find eligible pharmacies within 10 km.</span></label>
            <button className={`location-panel ${coordinates ? "ready" : ""}`} onClick={detectLocation} disabled={requestLocked || !locationConsent}><span><LocateFixed size={20} /></span><div><b>{coordinates ? "Location ready" : "Detect my location"}</b><small>{coordinates ? location : locationConsent ? "Your browser will ask permission" : "Consent above to enable location"}</small></div>{coordinates ? <Check size={18} /> : <ArrowRight size={18} />}</button>
            <button className="manual-location-toggle" onClick={() => setManualLocation(!manualLocation)} disabled={requestLocked || !locationConsent}>Can&apos;t detect location? Enter coordinates</button>
            {manualLocation ? <div className="manual-location"><input value={manualLatitude} disabled={requestLocked || !locationConsent} onChange={(event) => setManualLatitude(event.target.value)} placeholder="Latitude" inputMode="decimal" /><input value={manualLongitude} disabled={requestLocked || !locationConsent} onChange={(event) => setManualLongitude(event.target.value)} placeholder="Longitude" inputMode="decimal" /><button onClick={applyManualLocation} disabled={requestLocked || !locationConsent}>Use</button></div> : null}
            <label className="consent-check"><input type="checkbox" checked={broadcastConsent} disabled={requestLocked} onChange={(event) => setBroadcastConsent(event.target.checked)} /><span>I consent to sharing the minimum request summary with eligible pharmacies. Exact contact, prescription, and coordinates remain private until I select one.</span></label>
            <div className="estimate"><span>Current contributed range</span><b>{basketMin ? `RWF ${rwf.format(basketMin)}–${rwf.format(basketMax)}` : "No verified range yet"}</b><small>Final itemised prices come from responding pharmacies</small></div>
            {checkoutError ? <p className="form-error"><CircleAlert size={15} /> {checkoutError}</p> : null}
            <button className="primary-wide" disabled={!cart.length || ordering} onClick={submitOrder}>{ordering ? "Publishing secure request…" : previewMode ? "Preview only · no data sent" : requestLocked ? "Retry the same secure request" : "Send to eligible nearby pharmacies"}<ArrowRight size={18} /></button>
            {pendingOrderAttempt?.rpcAttempted ? <p className="privacy-note"><ShieldCheck size={14} /> This attempt may already be saved. Only retrying with the same secure request ID can safely recover it.</p> : cart.length || requestLocked ? <button className="text-action" onClick={resetRequest} disabled={ordering}>{requestLocked ? "Reset before publishing" : "Clear request"}</button> : null}
            <p className="privacy-note"><ShieldCheck size={14} /> Anonymous sign-in is an identity control, not a promise of anonymous health data.</p>
          </> : <div className="sent-state"><span><Check size={35} /></span><h2>{recipientCount ? "Your request is live" : "No eligible pharmacy matched"}</h2><p>{recipientCount ? `Shared with ${recipientCount} approved online ${recipientCount === 1 ? "pharmacy" : "pharmacies"} within 10 km.` : "The request was saved, but no approved online pharmacy with a verified location matched the 10 km radius."}</p><div className="sent-timeline"><div><b>Request created</b><small>{activeOrderId}</small></div><div><b>{recipientCount ? "Waiting for itemised offers" : "No recipients"}</b><small>We never claim 20 when fewer pharmacies qualify.</small></div></div>{recipientCount ? <><button className="primary-wide" onClick={() => { setCartOpen(false); setOffersOpen(true); }}>View live offers <ArrowRight size={18} /></button><button className="text-action" onClick={() => closeAndResetOrder("cancelled")} disabled={closingOrder}>{closingOrder ? "Cancelling request…" : "Cancel request and start another"}</button></> : <button className="primary-wide" onClick={resetRequest}>Start another request <ArrowRight size={18} /></button>}</div>}
          {orderSent && restoredActiveOrders.some((order) => order.orderId !== activeOrderId) ? <div className="sent-timeline"><div><b>Other active requests</b><small>These requests are not hidden. Review and close each one safely.</small></div>{restoredActiveOrders.filter((order) => order.orderId !== activeOrderId).map((order) => <button className="text-action" key={order.orderId} onClick={() => openRestoredOrder(order)} disabled={ordering}>Open {order.reference} · {order.offerCount} {order.offerCount === 1 ? "offer" : "offers"}</button>)}</div> : null}
        </aside>
      </div> : null}

      {offersOpen && activeOrderId ? <section className="offers-panel"><div className="offers-head"><div><span>LIVE OFFERS · {activeOrderId.slice(0, 8).toUpperCase()}</span><h2>Choose your pharmacy</h2><p>{offers.length ? `${offers.length} ${offers.length === 1 ? "pharmacy has" : "pharmacies have"} responded.` : "No offers yet. This page updates when eligible pharmacies respond."}</p></div><button onClick={() => setOffersOpen(false)} aria-label="Close offers"><X size={20} /></button></div>
        {checkoutError ? <p className="form-error"><CircleAlert size={15} /> {checkoutError}</p> : null}
        {!offers.length ? <div className="offers-empty"><Clock3 size={29} /><b>Waiting for itemised offers</b><p>You are not committed to any pharmacy. Contact details remain private.</p></div> : <div className="quotes">{offers.map((offer) => <article key={offer.id}><div className="quote-brand"><span><Cross size={18} /></span><div><h3>{offer.pharmacyName} <BadgeCheck size={15} /></h3><p>Approx. {(offer.distanceM / 1_000).toFixed(1)} km away · register-verified partner</p></div></div><div className={`availability ${offer.complete ? "complete" : "partial"}`}>{offer.complete ? <Check size={15} /> : <Clock3 size={15} />}{offer.complete ? "All requested items offered" : "Partial offer · cannot be selected"}</div><div className="offer-items">{offer.items.map((item) => <div key={item.id}><b>{item.available ? item.isSubstitute ? "Substitute offered" : "Requested product offered" : "Unavailable"}</b><small>{item.available ? [item.product?.brand || item.offeredProductId || "Registered product", item.product?.strength, item.product?.packSize ? `Pack ${item.product.packSize}` : ""].filter(Boolean).join(" · ") : "This line is not included in the offer"}{item.available && item.quantity ? ` · Qty ${item.quantity}` : ""}{item.available && item.unitPriceRwf ? ` · RWF ${rwf.format(item.unitPriceRwf)} each` : ""}</small></div>)}</div><div className="quote-price"><span>Total offer</span><b>RWF {rwf.format(offer.totalRwf)}</b><small>{offer.readyInMinutes ? `Ready in about ${offer.readyInMinutes} minutes` : "Preparation time not stated"}</small></div><div className="quote-actions"><button onClick={() => chooseOffer(offer)} disabled={!offer.complete || selectionLocked}>{offer.status === "selected" ? "Selected" : selectionLocked ? "Selection closed" : offer.complete ? "Choose offer" : "Partial offer"}</button><span className="contact-locked"><ShieldCheck size={15} /> {selectionLocked ? "All offer actions are closed" : "Contact unlocks after selection"}</span></div></article>)}</div>}
        {activeOrderSelected ? <div className="selected-contact">{selectedContact ? <><div><CircleCheck size={23} /><span><b>{selectedContact.pharmacyName} selected</b><small>Confirm seller identity, final total, fees, delivery, cancellation and refund terms before paying.</small></span></div><div>{selectedContact.momoCode ? <span className="momo-code"><Banknote size={16} /> MoMo merchant code: <b>{selectedContact.momoCode}</b></span> : null}{whatsappUrl(selectedContact.whatsapp, `Hello, I selected your MED+250 offer for request ${activeOrderId}. Please confirm fulfilment details.`) ? <a href={whatsappUrl(selectedContact.whatsapp, `Hello, I selected your MED+250 offer for request ${activeOrderId}. Please confirm fulfilment details.`) ?? undefined} target="_blank" rel="noreferrer"><MessageCircle size={16} /> Continue on WhatsApp</a> : <span>WhatsApp is not configured for this pharmacy.</span>}</div></> : <div><CircleAlert size={23} /><span><b>Selected pharmacy contact unavailable</b><small>The pharmacy may no longer be eligible. No contact detail has been exposed, but you can still complete or cancel this order.</small></span></div>}<div className="quote-actions"><button onClick={() => closeAndResetOrder("completed")} disabled={closingOrder}>{closingOrder ? "Updating order…" : "Mark completed and start another"}</button><button onClick={() => closeAndResetOrder("cancelled")} disabled={closingOrder}>Cancel order</button></div></div> : null}
      </section> : null}

      {portalOpen ? <div className="portal-overlay">
        {portalStage !== "workspace" ? <section className="portal-auth"><button className="portal-close" onClick={() => setPortalOpen(false)} aria-label="Close pharmacy portal"><X size={20} /></button><Link className="brand" href="/"><BrandLogo /></Link><span className="portal-kicker">SECURE PHARMACY ACCESS</span><h2>{portalStage === "signin" ? "Sign in as verified pharmacy staff" : "Enter your WhatsApp code"}</h2>
          {portalStage === "signin" ? <><label>WhatsApp number<div className="portal-phone-input"><span>+250</span><input value={pharmacyWhatsapp} onChange={(event) => setPharmacyWhatsapp(event.target.value.replace(/\D/g, "").slice(0, 9))} placeholder="78 000 0000" inputMode="tel" autoComplete="tel" /></div></label><button className="primary-wide" onClick={sendPharmacyCode} disabled={portalLoading}><MessageCircle size={17} /> {portalLoading ? "Sending code…" : "Send code on WhatsApp"}</button></> : <><small className="portal-otp-note">Use the 6-digit code sent to +250 {pharmacyWhatsapp}.</small><label>Verification code<input value={pharmacyOtp} onChange={(event) => setPharmacyOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" inputMode="numeric" autoComplete="one-time-code" maxLength={6} /></label><button className="primary-wide" onClick={verifyPharmacyCode} disabled={portalLoading}>{portalLoading ? "Verifying…" : "Verify and open pharmacy portal"} <ArrowRight size={17} /></button><button className="text-action" onClick={() => { setPortalStage("signin"); setPharmacyOtp(""); setPharmacyOtpChallengeId(""); setPortalError(""); setPortalMessage(""); }} disabled={portalLoading}>Use another WhatsApp number</button></>}
          {portalMessage ? <p className="form-success"><CircleCheck size={15} /> {portalMessage}</p> : null}{portalError ? <p className="form-error"><CircleAlert size={15} /> {portalError}</p> : null}
        </section> : <section className="portal-shell">
          <aside className="portal-sidebar"><Link className="brand" href="/"><BrandLogo /></Link><small>PHARMACY DESK</small><nav><button className={portalTab === "requests" ? "active" : ""} onClick={() => setPortalTab("requests")}><Bell size={18} /> Nearby requests {pharmacyRequests.length ? <b>{pharmacyRequests.length}</b> : null}</button><button className={portalTab === "prices" ? "active" : ""} onClick={() => setPortalTab("prices")}><Banknote size={18} /> Product prices</button><button className={portalTab === "profile" ? "active" : ""} onClick={() => setPortalTab("profile")}><HeartPulse size={18} /> Pharmacy profile</button></nav><div className="portal-user"><span>{activeMembership?.pharmacyName.slice(0, 2).toUpperCase()}</span><div><b>{activeMembership?.pharmacyName}</b><small>{activeMembership?.role} · verified membership</small></div></div><button className="text-action" onClick={leavePharmacyPortal} disabled={portalLoading}>Sign out of pharmacy portal</button></aside>
          <div className="portal-main"><div className="portal-top"><div><span>PHARMACY PORTAL</span><h2>{portalTab === "requests" ? "Nearby requests" : portalTab === "prices" ? "Contribute current prices" : "Verified pharmacy profile"}</h2><p>Only data allowed by pharmacy membership and request-recipient policies is shown.</p></div><button onClick={() => setPortalOpen(false)} aria-label="Close pharmacy portal"><X size={20} /></button></div>
            {portalMessage ? <p className="form-success"><CircleCheck size={15} /> {portalMessage}</p> : null}{portalError ? <p className="form-error"><CircleAlert size={15} /> {portalError}</p> : null}
            {portalTab === "requests" ? <>
              <div className="portal-metrics"><div><span><Bell size={18} /></span><p>OPEN REQUESTS</p><b>{pharmacyRequests.length}</b><small>recipient-authorized only</small></div><div><span><Clock3 size={18} /></span><p>LOCATION VIEW</p><b>Approximate</b><small>coarse distance only</small></div><div><span><ShieldCheck size={18} /></span><p>CUSTOMER CHOICES</p><b>{pharmacySelectedOrders.length}</b><small>contact released after choice</small></div></div>
              <div className="request-table-head"><div><h3>Open requests</h3><span>Real database results · live updates</span></div><button onClick={refreshPharmacyRequests}><LocateFixed size={15} /> Refresh</button></div>
              {pharmacyRequests.length ? <div className="request-list">{pharmacyRequests.map((request) => <article key={request.orderId}><div className="request-id"><span className="new">OPEN</span><b>{request.orderId.slice(0, 8).toUpperCase()}</b><small>{formatDate(request.createdAt)}</small></div><div><b>Approx. {(request.distanceM / 1_000).toFixed(1)} km away</b><small><MapPin size={12} /> Coarse distance band · exact location withheld</small></div><div><b>{request.items.length} {request.items.length === 1 ? "product" : "products"}</b><small>{request.hasPrescription ? "Prescription exists but remains locked" : "No prescription attached"}</small></div><div><b>{request.deliveryPreference}</b><small>Substitutes item-specific</small></div><button onClick={() => beginOffer(request)}>Review <ArrowRight size={15} /></button></article>)}</div> : <div className="portal-empty"><PackageCheck size={29} /><b>No open request is assigned</b><p>Only approved online pharmacies with verified GPS coordinates can receive nearby requests.</p></div>}
              <div className="request-table-head"><div><h3>Customers who chose this pharmacy</h3><span>Contact and prescription access follow the customer&apos;s choice</span></div></div>
              {pharmacySelectedOrders.length ? <div className="request-list selected-order-list">{pharmacySelectedOrders.map((order) => <article key={order.orderId}><div className="request-id"><span className="new">SELECTED</span><b>{order.reference}</b><small>{formatDate(order.selectedAt)}</small></div><div><b>{order.deliveryPreference}</b><small>Arrange pickup or delivery directly</small></div><div>{whatsappUrl(order.customerWhatsapp, `Hello, I’m contacting you from ${activeMembership?.pharmacyName ?? "the pharmacy"} about MED+250 request ${order.reference}. Please confirm fulfilment details.`) ? <a href={whatsappUrl(order.customerWhatsapp, `Hello, I’m contacting you from ${activeMembership?.pharmacyName ?? "the pharmacy"} about MED+250 request ${order.reference}. Please confirm fulfilment details.`) ?? undefined} target="_blank" rel="noreferrer"><MessageCircle size={14} /> Contact on WhatsApp</a> : <b>WhatsApp not provided</b>}<small>Medication details are not included in the message</small></div><div>{order.prescriptionUrl ? <a href={order.prescriptionUrl} target="_blank" rel="noreferrer"><FileText size={14} /> Open private prescription</a> : <b>No prescription attached or access window ended</b>}<small>{order.prescriptionUrl ? "Signed link expires within 10 minutes and never beyond the 24-hour selection window" : "No private file is available to review"}</small></div></article>)}</div> : <div className="portal-empty"><ShieldCheck size={29} /><b>No customer has chosen this pharmacy yet</b><p>Contact details and prescriptions stay unavailable until an offer is selected.</p></div>}
            </> : null}
            {portalTab === "prices" ? <section className="portal-form"><div className="price-policy"><Sparkles size={19} /><p>Every price is tied to a verified pharmacy and observation time. A contribution is rejected if it would make the range wider than its minimum price.</p></div><label>Find product<input value={priceSearch} onChange={(event) => setPriceSearch(event.target.value)} placeholder="Brand or generic name" /></label><label>Product<select value={priceProductId} onChange={(event) => setPriceProductId(event.target.value)}><option value="">Choose a product</option>{filteredPriceProducts.map((product) => <option value={product.id} key={product.id}>{product.brand} {product.strength}</option>)}</select></label><label>Selling price (RWF)<input value={priceValue} onChange={(event) => setPriceValue(event.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="e.g. 2500" /></label><button className="primary-wide" onClick={addPriceContribution} disabled={portalLoading}>Save verified price <ArrowRight size={17} /></button></section> : null}
            {portalTab === "profile" ? <section className="portal-form profile-summary"><div><BadgeCheck size={22} /><span><b>{activeMembership?.pharmacyName}</b><small>{activeMembership?.onlineLicenseVerified ? "Online licence verified" : "Online licence verification required"}</small></span></div><dl><div><dt>Your role</dt><dd>{activeMembership?.role}</dd></div><div><dt>WhatsApp</dt><dd>{activeMembership?.whatsapp || "Not configured"}</dd></div><div><dt>MoMo merchant code</dt><dd>{activeMembership?.momoCode || "Not configured"}</dd></div></dl><p>Contact and merchant details are released only after a customer selects the pharmacy. Automated payment remains off until a licensed PSP integration is configured.</p></section> : null}
          </div>
        </section>}
        {selectedRequest ? <section className="offer-editor"><div className="offers-head"><div><span>ITEMISED OFFER</span><h2>Respond to {selectedRequest.orderId.slice(0, 8).toUpperCase()}</h2><p>Use requested products unless a substitute is explicitly allowed and clearly identified.</p></div><button onClick={() => setSelectedRequest(null)} aria-label="Close offer editor"><X size={20} /></button></div><div className="offer-items">{selectedRequest.items.map((item) => <article key={item.orderItemId}><div><b>{item.productName}</b><small>Qty {item.quantity}{item.packSize ? ` · Pack ${item.packSize}` : " · Pack size unavailable"} · {item.substitutesAllowed ? "Customer permits an explicit substitute proposal" : "Exact product only"}</small></div><label><input type="checkbox" checked={offerAvailability[item.orderItemId] ?? false} onChange={(event) => setOfferAvailability((current) => ({ ...current, [item.orderItemId]: event.target.checked }))} /> Available</label>{item.substitutesAllowed ? <label><input type="checkbox" checked={offerSubstitutes[item.orderItemId] ?? false} onChange={(event) => { const checked = event.target.checked; setOfferSubstitutes((current) => ({ ...current, [item.orderItemId]: checked })); setOfferProductIds((current) => ({ ...current, [item.orderItemId]: checked ? "" : item.productId })); }} /> Offer a substitute</label> : null}{offerSubstitutes[item.orderItemId] ? <label>Substitute product<select value={offerProductIds[item.orderItemId] ?? ""} onChange={(event) => setOfferProductIds((current) => ({ ...current, [item.orderItemId]: event.target.value }))}><option value="">Choose a matching active, orderable product</option>{orderableCatalogue.filter((product) => product.id !== item.productId && isCompatibleSubstitute(product, item)).map((product) => <option value={product.id} key={product.id}>{product.brand} {product.strength} · {product.generic} · Pack {product.packSize}</option>)}</select></label> : null}<label>Unit price<input value={offerPrices[item.orderItemId] ?? ""} onChange={(event) => setOfferPrices((current) => ({ ...current, [item.orderItemId]: event.target.value.replace(/\D/g, "") }))} inputMode="numeric" placeholder="RWF" disabled={!(offerAvailability[item.orderItemId] ?? false)} /></label></article>)}</div><div className="offer-meta"><label>Ready in minutes<input value={offerReadyMinutes} onChange={(event) => setOfferReadyMinutes(event.target.value.replace(/\D/g, ""))} /></label><label>Note<textarea value={offerNote} onChange={(event) => setOfferNote(event.target.value)} placeholder="Optional fulfilment note" /></label></div><button className="primary-wide" onClick={sendOffer} disabled={portalLoading}>Send itemised offer <ArrowRight size={17} /></button></section> : null}
      </div> : null}
    </main>
  );
}
