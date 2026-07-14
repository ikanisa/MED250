"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Banknote,
  Bell,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Clock3,
  Cross,
  FileText,
  Grid3X3,
  HeartPulse,
  List,
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
  hasAnonymousCustomerSession,
  hasPermanentPharmacySession,
  loadCatalogue,
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
import Turnstile from "./turnstile";

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
  initialProductId?: string;
  initialProduct?: Product;
  initialProducts?: Product[];
};
type PendingOrderAttempt = {
  clientRequestId: string;
  prescriptionPath: string | null;
  rpcAttempted: boolean;
  payload: Omit<CreateOrderInput, "clientRequestId" | "prescriptionPath">;
};

const MED250_ADMIN_WHATSAPP = "250795588248";
const CART_STORAGE_KEY = "med250-order-basket-v1";

const categories = ["All products", "Medicines", "Pain & fever", "Digestive health", "Allergy", "Diabetes care", "Personal care", "Baby & family", "Wellness"];
const departmentNav = [
  { label: "Medicines", href: "/category/medicines" },
  { label: "Personal care", href: "/category/personal-care" },
  { label: "Baby & family", href: "/category/baby-family" },
  { label: "Wellness", href: "/category/wellness" },
];
const medicineCategories = new Set(["Medicines", "Pain & fever", "Digestive health", "Allergy", "Diabetes care"]);
const accentClasses = ["coral", "blue", "mint", "violet", "amber"];
const productPackImages: Record<string, string> = {
  blue: "/marketplace/product-pack-blue.webp",
  coral: "/marketplace/product-pack-coral.webp",
  mint: "/marketplace/product-pack-mint.webp",
  violet: "/marketplace/product-pack-violet.webp",
  amber: "/marketplace/product-pack-amber.webp",
};
const rwf = new Intl.NumberFormat("en-RW");
const marketplaceMode = process.env.NEXT_PUBLIC_MARKETPLACE_MODE === "live" ? "live" : "preview";
const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? "";

function productMatchesCategory(product: Product, category: string) {
  if (category === "All products") return true;
  if (category === "Medicines") return medicineCategories.has(product.category);
  return product.category === category;
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
    brand: brand || generic || catalogueText(row.registration_number),
    generic,
    strength,
    form: dosageForm,
    packSize,
    manufacturer: catalogueText(row.manufacturer),
    manufacturerCountry: catalogueText(row.manufacturer_country),
    registrationNumber: catalogueText(row.registration_number),
    category: categoryFor(row),
    productType: "human_medicine",
    prescriptionStatus: "unclassified",
    regulatoryStatus: row.regulatory_status || "valid",
    min: 0,
    max: 0,
    priceContributors: 0,
    imageUrl: null,
    isOrderable: ["valid", "active", "expiring_soon"].includes((row.regulatory_status || "valid").toLowerCase()),
    accent: accentClasses[index % accentClasses.length],
  };
}

function ProductVisual({ product, small = false }: { product: Product; small?: boolean }) {
  const fallbackImage = productPackImages[product.accent ?? "mint"] ?? productPackImages.mint;
  return (
    <div className={`dosage-art ${product.accent ?? "mint"} ${small ? "small" : ""}`} aria-hidden="true">
      <Image src={product.imageUrl ?? fallbackImage} alt="" width={small ? 54 : 170} height={small ? 44 : 128} unoptimized />
      {!small && product.form ? <span>{product.form.split(" · ")[0]}</span> : null}
    </div>
  );
}

function formatDate(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleDateString("en-RW", { day: "numeric", month: "short", year: "numeric" });
}

function hasPriceData(product: Pick<Product, "min" | "max">) {
  return Number.isFinite(product.min) && Number.isFinite(product.max) && product.min > 0 && product.max >= product.min;
}

function prescriptionLabel(status: Product["prescriptionStatus"]) {
  if (status === "prescription") return "Prescription required";
  if (status === "non_prescription") return "No prescription required";
  if (status === "pharmacist_only") return "Ask a pharmacist";
  return "";
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

function momoUssdUrl(merchantCode: string | null | undefined) {
  const code = merchantCode?.replace(/[^0-9A-Za-z-]/g, "").trim();
  return code ? "tel:*182%23" : null;
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
  const [catalogue, setCatalogue] = useState<Product[]>(() => initialProduct ? [initialProduct] : initialProducts);
  const [portalCatalogue, setPortalCatalogue] = useState<Product[]>([]);
  const [serverCatalogueTotal, setServerCatalogueTotal] = useState(0);
  const [serverExplanations, setServerExplanations] = useState<Map<string, string>>(() => new Map());
  const [serverCatalogueAvailable, setServerCatalogueAvailable] = useState(true);
  const [catalogueInitialising, setCatalogueInitialising] = useState(!initialProduct && !initialProducts.length);
  const [catalogueLoading, setCatalogueLoading] = useState(false);
  const [sort, setSort] = useState("relevance");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [dataSource, setDataSource] = useState(initialProduct || initialProducts.length
    ? "Source-backed catalogue preview · checking live matches…"
    : "Loading official Rwanda FDA source snapshots…");
  const [visibleCount, setVisibleCount] = useState(24);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartHydrated, setCartHydrated] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [location, setLocation] = useState("Location needed");
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [manualLocation, setManualLocation] = useState(false);
  const [manualLatitude, setManualLatitude] = useState("");
  const [manualLongitude, setManualLongitude] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [deliveryPreference, setDeliveryPreference] = useState<"pickup" | "delivery" | "either">("either");
  const [prescription, setPrescription] = useState<File | null>(null);
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
  const [priceProductId, setPriceProductId] = useState("");
  const [priceValue, setPriceValue] = useState("");
  const [priceSearch, setPriceSearch] = useState("");
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
            : null;

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
      root.setAttribute("aria-label", "Confirm pharmacy order");
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
    let cancelled = false;
    async function initialise() {
      if (!backendConfigured) {
        const productResponse = await fetch("/data/rwanda-fda-products-july-2026.csv");
        if (productResponse.ok) {
          const rows = parseCsv(await productResponse.text()).filter((row) => row.regulatory_status !== "expired");
          if (!cancelled) {
            setCatalogue(rows.map(fallbackProduct));
            setDataSource(`${rows.length.toLocaleString()} current human-medicine register records · private source snapshot`);
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
        if (!cancelled && profile?.whatsapp) setWhatsapp(profile.whatsapp.replace(/^250/, ""));
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
        if (!cancelled) setDataSource(`Official source snapshot · backend unavailable: ${errorMessage(error)}`);
      }
    }
    initialise()
      .catch((error) => { if (!cancelled) setDataSource(errorMessage(error)); })
      .finally(() => { if (!cancelled) setCatalogueInitialising(false); });
    return () => { cancelled = true; };
  }, [previewMode]);

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
          category,
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
  const indexedCatalogue = useMemo(() => catalogue.map(indexCatalogueProduct), [catalogue]);

  const filteredMatches = useMemo(() => {
    // The live RPC already applies every active filter and returns a stable,
    // paginated relevance order. Re-scoring that page in the browser can undo
    // stronger server intent matches (especially multilingual aliases), so the
    // client scorer is reserved for preview/offline fallback mode.
    if (serverCatalogueActive) {
      return catalogue.map((product) => ({
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
        if (availabilityFilter === "priced" && !(product.priceContributors > 0 && product.min > 0)) return false;
        if (availabilityFilter === "orderable" && !product.isOrderable) return false;
        if (availabilityFilter === "registered" && !["valid", "active", "expiring_soon"].includes(product.regulatoryStatus.toLowerCase())) return false;
        return true;
      })
      .toSorted((left, right) => {
        const a = left.product;
        const b = right.product;
        if (sort === "za") return b.brand.localeCompare(a.brand);
        if (sort === "price") return (a.min || Number.MAX_SAFE_INTEGER) - (b.min || Number.MAX_SAFE_INTEGER) || a.brand.localeCompare(b.brand);
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
  const catalogueMatchCount = serverCatalogueActive ? serverCatalogueTotal : filtered.length;
  const visibleProducts = serverCatalogueActive ? filtered : filtered.slice(0, visibleCount);
  const catalogueBusy = catalogueInitialising || catalogueLoading;
  const hasMoreProducts = serverCatalogueActive
    ? serverCatalogueTotal > filtered.length
    : filtered.length > visibleCount;
  const matchExplanations = useMemo(() => {
    const explanations = new Map(filteredMatches.map((match) => [match.product.id, match.explanation]));
    if (!previewMode && serverCatalogueAvailable) {
      serverExplanations.forEach((value, key) => explanations.set(key, value));
    }
    return explanations;
  }, [filteredMatches, previewMode, serverCatalogueAvailable, serverExplanations]);

  const searchSuggestions = useMemo(() => deferredQuery.trim().length >= 2 ? filtered.slice(0, 6) : [], [deferredQuery, filtered]);
  const hasActiveFilters = category !== initialCategory || prescriptionFilter !== "all" || formFilter !== "all" || availabilityFilter !== "all";

  const pharmacyCatalogue = portalCatalogue.length ? portalCatalogue : catalogue;
  const filteredPriceProducts = useMemo(() => {
    const normalized = priceSearch.trim().toLowerCase();
    if (!normalized) return pharmacyCatalogue.slice(0, 30);
    return pharmacyCatalogue.filter((product) => `${product.brand} ${product.generic}`.toLowerCase().includes(normalized)).slice(0, 30);
  }, [pharmacyCatalogue, priceSearch]);

  const orderableCatalogue = useMemo(() => pharmacyCatalogue.filter((product) => (
    product.isOrderable && ["valid", "active", "expiring_soon"].includes(product.regulatoryStatus.toLowerCase())
  )), [pharmacyCatalogue]);
  const selectedProduct = initialProductId ? catalogue.find((product) => product.id === initialProductId) ?? null : null;

  const basketCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const basketMin = cart.reduce((sum, item) => sum + item.min * item.quantity, 0);
  const basketMax = cart.reduce((sum, item) => sum + item.max * item.quantity, 0);
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
    setVisibleCount(24);
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
    setVisibleCount(24);
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
      setCheckoutError("Retry or reset the pending order before changing its products.");
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
    trackMarketplaceEvent("product_added", { category: product.category, hasPrice: product.min > 0 });
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

  function detectNativeLocation(): Promise<Coordinates> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("This browser cannot detect location. Enter coordinates manually."));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        }),
        () => reject(new Error("Location was not available. Allow location access or enter coordinates manually.")),
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 60_000 },
      );
    });
  }

  async function requestNativeLocation(openBasketOnFailure = false) {
    setCheckoutError("");
    setLocation("Detecting your location…");
    try {
      const next = await detectNativeLocation();
      setCoordinates(next);
      setLocation(`${next.latitude.toFixed(4)}, ${next.longitude.toFixed(4)} · ±${Math.round(next.accuracy)} m`);
    } catch (error) {
      setLocation("Location needed");
      setManualLocation(true);
      setCheckoutError(errorMessage(error));
      if (openBasketOnFailure) setCartOpen(true);
    }
  }

  function applyManualLocation() {
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
      setCheckoutError("This order may already have been committed. Retry the same secure order; local reset is disabled.");
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
      setCheckoutError("This order may already have been committed. Retry the same secure order so MED+250 can recover its receipt; resetting is disabled.");
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
    clearRequestState("Order cleared. You can start another order.");
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
        ? "Order marked completed. You can start another order."
        : "Order cancelled. You can start another order.");
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
      setCheckoutError("Open and close each existing active order before starting another one.");
      return;
    }
    if (!cart.length) {
      setCheckoutError("Add at least one product to your order.");
      return;
    }
    if (cartRequiresPrescription && !prescription && !pendingOrderAttempt?.prescriptionPath) {
      setCheckoutError("Attach a valid prescription before ordering a prescription-classified product.");
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
          setManualLocation(true);
          throw error;
        }
      }
      if (orderCoordinates.latitude < -3 || orderCoordinates.latitude > -0.8 || orderCoordinates.longitude < 28.7 || orderCoordinates.longitude > 30.9) {
        throw new Error("MED+250 currently accepts order locations inside Rwanda only.");
      }
      if (!attempt) {
        if (!globalThis.crypto?.randomUUID) {
          throw new Error("Secure order IDs are unavailable in this browser. Update your browser and try again.");
        }
        attempt = {
          clientRequestId: globalThis.crypto.randomUUID(),
          prescriptionPath: null,
          rpcAttempted: false,
          payload: {
            latitude: orderCoordinates.latitude,
            longitude: orderCoordinates.longitude,
            locationAccuracyM: orderCoordinates.accuracy,
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
        ? `${errorMessage(error)} The same order ID and prescription upload will be reused when you retry.`
        : errorMessage(error));
      trackMarketplaceEvent("order_failed", { stage: attempt?.rpcAttempted ? "dispatch" : "validation" });
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
      trackMarketplaceEvent("pharmacy_selected", { hasWhatsapp: Boolean(contact.whatsapp), hasMomoCode: Boolean(contact.momoCode) });
      await refreshOffers(activeOrderId);
    } catch (error) {
      setCheckoutError(errorMessage(error));
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
      || !Number(offerPrices[item.orderItemId])
      || ((offerSubstitutes[item.orderItemId] ?? false) && !offerProductIds[item.orderItemId])
    ));
    if (incompleteItem) {
      setPortalError("Confirm every product and enter every price before confirming this order.");
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
            unitPriceRwf: Number(offerPrices[item.orderItemId] || 0),
            quantity: item.quantity,
            note: null,
          };
        }),
      });
      setPortalMessage("Complete order confirmation sent to the customer.");
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
      setPortalMessage("Price saved. The customer price range has been updated.");
      setPriceValue("");
    } catch (error) {
      setPortalError(errorMessage(error));
    } finally {
      setPortalLoading(false);
    }
  }

  return (
    <main id="main-content">
      <a className="skip-link" href="#marketplace-content">Skip to marketplace content</a>
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
            <input id="marketplace-search" value={query} maxLength={MAX_CATALOGUE_QUERY_LENGTH} onChange={(event) => { setQuery(boundedCatalogueQuery(event.target.value)); setSuggestionsOpen(true); setVisibleCount(24); }} onKeyDown={handleSearchKeyDown} placeholder="Search by product, generic name, symptom or use" role="combobox" aria-label="Search the marketplace" aria-controls="smart-search-suggestions" aria-expanded={suggestionsOpen && query.trim().length >= 2} aria-autocomplete="list" aria-haspopup="listbox" autoComplete="off" />
            <button type="button" aria-label="Search marketplace" onClick={showSearchResults}><Search size={22} /><span>Search</span></button>
          </div>
          {suggestionsOpen && query.trim().length >= 2 ? <div className="search-suggestions" id="smart-search-suggestions" role="listbox" aria-label="Search suggestions">
            <div><Sparkles size={15} /><span>{searchSuggestions.length ? "Intelligent matches" : "No close matches yet"}</span></div>
            {searchSuggestions.map((product) => <button type="button" role="option" aria-selected="false" tabIndex={-1} key={product.id} onKeyDown={handleSuggestionKeyDown} onClick={() => chooseSearchSuggestion(product)}><span><b>{product.brand}</b><small>{[product.generic, product.strength].filter(Boolean).join(" · ")}</small></span><em>{product.category}</em></button>)}
          </div> : null}
        </div>
        <div className="header-actions">
          <button className="header-utility" onClick={() => setOffersOpen(true)}><PackageCheck size={19} /><span><small>My</small><b>Orders</b></span></button>
          <button className="header-utility" onClick={openPortal}><Store size={19} /><span><small>Pharmacy</small><b>portal</b></span></button>
          <button className="bag-button" onClick={() => setCartOpen(true)} aria-label={`Open order with ${basketCount} items`}><ShoppingBag size={22} /><span>Order basket</span><b>{basketCount}</b></button>
          <button className="mobile-toggle" onClick={() => setMobileMenu(!mobileMenu)} aria-label="Toggle navigation" aria-expanded={mobileMenu} aria-controls="mobile-marketplace-menu"><Menu size={22} /></button>
        </div>
      </header>

      {mobileMenu ? <nav className="mobile-menu-panel" id="mobile-marketplace-menu" aria-label="Mobile marketplace navigation"><Link href="/categories">All products</Link>{departmentNav.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}<button onClick={() => { setMobileMenu(false); setOffersOpen(true); }}>My orders</button><button onClick={() => { setMobileMenu(false); void openPortal(); }}>Pharmacy portal</button></nav> : null}

      <nav className="commerce-nav" id="top" aria-label="Product categories">
        <a href="/categories"><Menu size={18} /> All Categories</a>
        {departmentNav.map((item) => <a key={item.href} href={item.href}>{item.label}</a>)}
      </nav>

      <div id="marketplace-content">
      {initialProductId ? <section className="product-detail-page" aria-live="polite">
        {selectedProduct ? <>
          <div className="product-detail-visual"><ProductVisual product={selectedProduct} /></div>
          <div className="product-detail-copy">
            <nav className="product-breadcrumbs" aria-label="Breadcrumb"><Link href="/">Home</Link><span aria-hidden="true">/</span><Link href="/categories">Products</Link><span aria-hidden="true">/</span><span aria-current="page">{selectedProduct.brand}</span></nav>
            {selectedProduct.category ? <small>{selectedProduct.category}</small> : null}
            <h1>{selectedProduct.brand}</h1>
            {selectedProduct.generic ? <p className="product-generic">{selectedProduct.generic}</p> : null}
            <div className={`product-detail-buy ${hasPriceData(selectedProduct) ? "has-price" : "no-price"}`}>
              {hasPriceData(selectedProduct) ? <><span>Current contributed range</span><b>RWF {rwf.format(selectedProduct.min)}–{rwf.format(selectedProduct.max)}</b></> : null}
              <button onClick={() => { add(selectedProduct); setCartOpen(true); }} disabled={!previewMode && !selectedProduct.isOrderable}><Plus size={18} /> Add to order</button>
            </div>
            {selectedProduct.strength || selectedProduct.form || selectedProduct.packSize || selectedProduct.manufacturer || selectedProduct.manufacturerCountry || selectedProduct.registrationNumber || prescriptionLabel(selectedProduct.prescriptionStatus) ? <dl>
              {selectedProduct.strength ? <div><dt>Strength</dt><dd>{selectedProduct.strength}</dd></div> : null}
              {selectedProduct.form ? <div><dt>Form</dt><dd>{selectedProduct.form}</dd></div> : null}
              {selectedProduct.packSize ? <div><dt>Pack</dt><dd>{selectedProduct.packSize}</dd></div> : null}
              {selectedProduct.manufacturer || selectedProduct.manufacturerCountry ? <div><dt>Manufacturer</dt><dd>{[selectedProduct.manufacturer, selectedProduct.manufacturerCountry].filter(Boolean).join(" · ")}</dd></div> : null}
              {selectedProduct.registrationNumber ? <div><dt>Rwanda FDA registration</dt><dd>{selectedProduct.registrationNumber}</dd></div> : null}
              {prescriptionLabel(selectedProduct.prescriptionStatus) ? <div><dt>Prescription</dt><dd>{prescriptionLabel(selectedProduct.prescriptionStatus)}</dd></div> : null}
            </dl> : null}
          </div>
        </> : <div className="catalogue-empty"><Clock3 size={28} /><h1>Loading product…</h1><p>The catalogue is being checked for this product.</p><Link href="/categories">Return to products</Link></div>}
      </section> : <>
        {pageTitle && !showDepartments ? <section className="category-route-banner">
          <div><h1>{pageTitle}</h1><p>{pageDescription}</p><button onClick={() => requestNativeLocation(true)}><LocateFixed size={18} /> {coordinates ? "Location ready" : "Use my location"}</button></div>
          <Image src={pageImage ?? "/marketplace/hero-pharmacy-still-life.webp"} alt="" width={620} height={330} priority unoptimized />
        </section> : !pageTitle ? <section className="market-banner">
          <div className="market-banner-copy"><h1>One order. <em>Nearby pharmacies confirm.</em></h1><p>Find the products you need, place one order, then choose from pharmacies that confirm they can fulfil it.</p><a className="shop-button" href="#marketplace">Browse products <ArrowRight size={18} /></a></div>
          <div className="market-banner-art"><Image src="/marketplace/hero-pharmacy-still-life.webp" alt="Pharmacy and wellness products arranged in the med+250 brand colours" width={760} height={340} priority unoptimized /></div>
        </section> : null}

        {(!pageTitle || showDepartments) ? <section className={`department-cards${pageTitle && showDepartments ? " category-index-departments" : ""}`} aria-label="Shop pharmacy departments">
          <article><div><h2>Medicines &amp;<br />pain relief</h2><p>Find relief from pain, fever, cough, allergies and more.</p><a href="/category/medicines">Shop medicines <ArrowRight size={15} /></a></div><Image src="/marketplace/category-medicines.webp" alt="Medicine box and blister pack" width={210} height={150} unoptimized /></article>
          <article><div><h2>Personal care</h2><p>Everyday essentials for you and your family.</p><a href="/category/personal-care">Shop personal care <ArrowRight size={15} /></a></div><Image src="/marketplace/category-personal-care.webp" alt="Personal care products" width={210} height={150} unoptimized /></article>
          <article><div><h2>Baby &amp; family</h2><p>Trusted care for babies and growing families.</p><a href="/category/baby-family">Shop baby &amp; family <ArrowRight size={15} /></a></div><Image src="/marketplace/category-baby-family.webp" alt="Baby and family care products" width={210} height={150} unoptimized /></article>
          <article><div><h2>Wellness &amp;<br />devices</h2><p>Support your health and monitor with confidence.</p><a href="/category/wellness">Shop wellness <ArrowRight size={15} /></a></div><Image src="/marketplace/category-wellness-devices.webp" alt="Digital health monitoring device" width={210} height={150} unoptimized /></article>
        </section> : null}

        <section className="marketplace-section" id="marketplace">
          <div className="section-heading"><div>{pageTitle && showDepartments ? <h1>{pageTitle}</h1> : <h2>{pageTitle ?? "Popular products today"}</h2>}{query.trim() ? <p>Best matches for “{query.trim()}”</p> : visibleProducts.some(hasPriceData) ? <p>Contributed pharmacy price ranges</p> : null}</div><button className="see-all" onClick={() => setVisibleCount((count) => count + 48)}>See all</button></div>
          <div className="smart-filter-bar" aria-label="Catalogue filters">
            <div className="smart-filter-summary"><span><Sparkles size={16} /></span><div><b>{catalogueBusy ? "Searching catalogue…" : `${catalogueMatchCount.toLocaleString()} intelligent matches`}</b><small title={dataSource}>Brand, generic name, symptom, strength and form</small></div></div>
            <label>Category<select value={category} onChange={(event) => { setCategory(event.target.value); setVisibleCount(24); }}>{categories.map((item) => <option key={item} value={item}>{item === "All products" ? "All Categories" : item}</option>)}</select></label>
            <label>Prescription<select value={prescriptionFilter} onChange={(event) => { setPrescriptionFilter(event.target.value); setVisibleCount(24); }}><option value="all">Any status</option><option value="non_prescription">OTC</option><option value="prescription">Prescription</option><option value="pharmacist_only">Ask pharmacist</option><option value="unclassified">Not classified</option></select></label>
            <label>Form<select value={formFilter} onChange={(event) => { setFormFilter(event.target.value); setVisibleCount(24); }}><option value="all">Any form</option><option value="tablets">Tablets & capsules</option><option value="liquids">Liquids & drops</option><option value="injections">Injections</option><option value="topical">Creams & topical</option><option value="devices">Devices & inhalers</option><option value="other">Other forms</option></select></label>
            <label>Availability<select value={availabilityFilter} onChange={(event) => { setAvailabilityFilter(event.target.value); setVisibleCount(24); }}><option value="all">Any availability</option><option value="priced">Has price range</option><option value="orderable">Can be added to an order</option><option value="registered">In the product catalogue</option></select></label>
            <label>Sort<select value={sort} onChange={(event) => { setSort(event.target.value); setVisibleCount(24); }}><option value="relevance">Best match</option><option value="az">Name: A–Z</option><option value="za">Name: Z–A</option><option value="price">Lowest price</option></select></label>
            <div className="view-toggle" aria-label="Product view"><button type="button" aria-label="Grid view" aria-pressed={viewMode === "grid"} onClick={() => { setViewMode("grid"); trackMarketplaceEvent("catalogue_view_changed", { view: "grid" }); }}><Grid3X3 size={15} /></button><button type="button" aria-label="List view" aria-pressed={viewMode === "list"} onClick={() => { setViewMode("list"); trackMarketplaceEvent("catalogue_view_changed", { view: "list" }); }}><List size={16} /></button></div>
            {query || hasActiveFilters ? <button className="clear-filters" onClick={clearCatalogueFilters}><SlidersHorizontal size={14} /> Reset</button> : null}
          </div>
          {catalogueBusy && !visibleProducts.length ? <div className="catalogue-empty" role="status" aria-live="polite"><Clock3 size={28} /><h3>Searching the catalogue…</h3><p>Checking product names, active ingredients, common uses, strengths and forms.</p></div> : visibleProducts.length ? <div className={`product-grid ${viewMode === "list" ? "list-view" : ""}`} aria-busy={catalogueBusy}>
            {visibleProducts.map((product) => (
              <article className="product-card" key={product.id}>
                <Link className="product-image-wrap" href={`/product/${encodeURIComponent(product.id)}`} aria-label={`View ${product.brand}`}><ProductVisual product={product} /></Link>
                <div className="product-meta"><span>{product.category}</span></div>
                <h3><Link href={`/product/${encodeURIComponent(product.id)}`}>{product.brand} <span>{product.strength}</span></Link></h3>
                <p>{product.generic}</p>
                {query.trim() ? <div className="match-explanation"><Sparkles size={12} /> {matchExplanations.get(product.id) ?? "Related product"}</div> : null}
                <div className="form-label">{product.form}{product.packSize ? ` · ${product.packSize}` : ""}</div>
                <div className={`price-line ${hasPriceData(product) ? "has-price" : "no-price"}`}>{hasPriceData(product) ? <div>{product.priceContributors > 0 ? <small>{product.priceContributors} pharmacy price contribution{product.priceContributors === 1 ? "" : "s"}</small> : null}<b>RWF {rwf.format(product.min)}–{rwf.format(product.max)}</b></div> : null}<button onClick={() => add(product)} disabled={!previewMode && !product.isOrderable} aria-label={`Add to order: ${product.brand}`} title={!previewMode && !product.isOrderable ? "Currently unavailable for ordering" : "Add to order"}><Plus size={16} /> Add to order</button></div>
              </article>
            ))}
          </div> : <div className="catalogue-empty"><Search size={28} /><h3>No close product match</h3><p>Try a brand, generic name, symptom, dosage form, or remove one of the filters.</p><button onClick={clearCatalogueFilters}>Reset search and filters</button></div>}
          {hasMoreProducts ? <button className="view-all" onClick={() => setVisibleCount((count) => count + 48)} disabled={catalogueBusy}>{catalogueBusy ? "Loading products…" : "Show 48 more products"} <ArrowRight size={17} /></button> : null}
        </section>
      </>}
      </div>

      <section className="network-strip" id="pharmacies"><div><span className="network-icon"><Store size={27} /></span><div><b>Represent a pharmacy?</b></div></div><button onClick={openPortal}>Open pharmacy portal <ArrowRight size={17} /></button></section>

      <footer><Link className="brand footer-brand" href="/" aria-label="med+250 home"><BrandLogo /></Link><p>MED+250 does not diagnose, prescribe, advertise prescription medicines, or replace a qualified health professional.</p><nav aria-label="Footer"><Link href="/categories">Products</Link><Link href="/how-it-works">How it works</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/accessibility">Accessibility</Link><button onClick={openPortal}>Pharmacy portal</button></nav></footer>

      {cartOpen ? <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && setCartOpen(false)}>
        <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="order-basket-title" data-modal-root="order-basket" tabIndex={-1}>
          <div className="drawer-head"><div><span>YOUR ORDER</span><h2 id="order-basket-title">{basketCount} {basketCount === 1 ? "item" : "items"}</h2></div><button data-autofocus onClick={() => setCartOpen(false)} aria-label="Close order"><X size={20} /></button></div>
          {!orderSent ? <>
            <div className="cart-list">{cart.map((item) => <div className="cart-item" key={item.id}><ProductVisual product={item} small /><div><b>{[item.brand, item.strength].filter(Boolean).join(" ")}</b>{item.generic || item.packSize ? <small>{[item.generic, item.packSize ? `Pack ${item.packSize}` : ""].filter(Boolean).join(" · ")}</small> : null}{hasPriceData(item) ? <span>RWF {rwf.format(item.min)}–{rwf.format(item.max)}</span> : null}<label className="substitute-check"><input type="checkbox" checked={item.substitutesAllowed} disabled={requestLocked} onChange={(event) => setSubstituteConsent(item.id, event.target.checked)} /> Allow a pharmacist-proposed substitute</label></div><div className="quantity"><button onClick={() => adjust(item.id, -1)} disabled={requestLocked} aria-label={`Decrease ${item.brand} quantity`}><Minus size={13} /></button><b>{item.quantity}</b><button onClick={() => adjust(item.id, 1)} disabled={requestLocked} aria-label={`Increase ${item.brand} quantity`}><Plus size={13} /></button></div></div>)}</div>
            {!cart.length ? <div className="empty-request"><ShoppingBag size={26} /><b>Your order is empty</b><p>Add products from the catalogue. Nothing is sent until you place the order.</p></div> : null}
            {customerMessage ? <p className="form-success" role="status" aria-live="polite"><CircleCheck size={15} /> {customerMessage}</p> : null}
            {restoredActiveOrders.length ? <div className="sent-timeline"><div><b>{restoredActiveOrders.length} active {restoredActiveOrders.length === 1 ? "order" : "orders"}</b><small>Open an existing order before starting another.</small></div>{restoredActiveOrders.map((order) => <button className="text-action" key={order.orderId} onClick={() => openRestoredOrder(order)} disabled={ordering}>Open {order.reference} · {order.offerCount} {order.offerCount === 1 ? "confirmation" : "confirmations"}</button>)}</div> : null}
            <label className="whatsapp-field"><span>WhatsApp number <small>optional · saved to your customer profile</small></span><div><span>+250</span><input value={whatsapp} disabled={requestLocked} onChange={(event) => setWhatsapp(event.target.value.replace(/\D/g, "").slice(0, 9))} placeholder="78 000 0000" inputMode="numeric" /></div></label>
            <label className="select-field"><span>Fulfilment preference</span><select value={deliveryPreference} disabled={requestLocked} onChange={(event) => setDeliveryPreference(event.target.value as typeof deliveryPreference)}><option value="either">Pickup or delivery</option><option value="pickup">Pickup</option><option value="delivery">Delivery</option></select></label>
            {cartRequiresPrescription || prescription ? <label className="upload"><Upload size={18} /><span><b>{prescription ? prescription.name : "Attach required prescription"}</b><small>Required for prescription products · visible only to the pharmacy you choose</small></span><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={requestLocked} onChange={(event) => setPrescription(event.target.files?.[0] ?? null)} /></label> : null}
            {coordinates ? <button className="location-panel ready" onClick={() => requestNativeLocation(false)} disabled={requestLocked}><span><LocateFixed size={20} /></span><div><b>Location ready</b><small>{location}</small></div><Check size={18} /></button> : <p className="order-location-note"><LocateFixed size={16} /> Your browser will ask for location only when you place the order.</p>}
            {!coordinates ? <button className="manual-location-toggle" onClick={() => setManualLocation(!manualLocation)} disabled={requestLocked}>Use coordinates instead</button> : null}
            {manualLocation ? <div className="manual-location"><label><span className="sr-only">Latitude</span><input value={manualLatitude} disabled={requestLocked} onChange={(event) => setManualLatitude(event.target.value)} placeholder="Latitude" inputMode="decimal" /></label><label><span className="sr-only">Longitude</span><input value={manualLongitude} disabled={requestLocked} onChange={(event) => setManualLongitude(event.target.value)} placeholder="Longitude" inputMode="decimal" /></label><button onClick={applyManualLocation} disabled={requestLocked}>Use coordinates</button></div> : null}
            {basketMin > 0 ? <div className="estimate"><span>Current contributed range</span><b>RWF {rwf.format(basketMin)}–{rwf.format(basketMax)}</b><small>Based on current pharmacy contributions</small></div> : null}
            {!previewMode && customerSessionAvailable !== true ? turnstileSiteKey ? <>
              <Turnstile key={captchaVersion} siteKey={turnstileSiteKey} onToken={(token) => { setCaptchaToken(token); if (token) setCaptchaError(""); }} onError={setCaptchaError} />
              {captchaError ? <p className="form-error" role="alert"><CircleAlert size={15} /> {captchaError}</p> : null}
            </> : <p className="form-error" role="alert"><CircleAlert size={15} /> Ordering is unavailable because the security check is not configured.</p> : null}
            {checkoutError ? <p className="form-error" role="alert"><CircleAlert size={15} /> {checkoutError}</p> : null}
            <button className="primary-wide" disabled={!cart.length || ordering || (!previewMode && customerSessionAvailable !== true && (!captchaToken || !turnstileSiteKey))} onClick={submitOrder}>{ordering ? "Placing order…" : previewMode ? "Preview only · no data sent" : customerSessionAvailable === null ? "Checking secure session…" : requestLocked ? "Retry the same secure order" : "Place order"}<ArrowRight size={18} /></button>
            {pendingOrderAttempt?.rpcAttempted ? <p className="privacy-note"><ShieldCheck size={14} /> This attempt may already be saved. Only retrying with the same secure order ID can safely recover it.</p> : cart.length || requestLocked ? <button className="text-action" onClick={resetRequest} disabled={ordering}>{requestLocked ? "Reset before publishing" : "Clear order"}</button> : null}
            <p className="privacy-note"><ShieldCheck size={14} /> Anonymous sign-in is an identity control, not a promise of anonymous health data.</p>
          </> : <div className="sent-state"><span><Check size={35} /></span><h2>Order sent to nearby pharmacies</h2><p>{activeOrderNoRecipients ? "No pharmacy could receive this order. You can close it and try again later." : "MED+250 is waiting for pharmacies that can fulfil your complete order."}</p><div className="sent-timeline"><div><b>Order placed</b><small>{activeOrderId}</small></div><div><b>{activeOrderNoRecipients ? "No pharmacy response possible" : activeOrderExpired ? "Response window ended" : "Waiting for confirmations"}</b><small>{activeOrderNoRecipients ? "Nothing was shared with a pharmacy." : activeOrderExpired ? "No pharmacy confirmed before this order expired." : "You will only see pharmacies that respond to this order."}</small></div></div><button className="primary-wide" onClick={() => { setCartOpen(false); setOffersOpen(true); }}>View order status <ArrowRight size={18} /></button><button className="text-action" onClick={() => closeAndResetOrder("cancelled")} disabled={closingOrder}>{closingOrder ? "Cancelling order…" : "Cancel order"}</button></div>}
          {orderSent && restoredActiveOrders.some((order) => order.orderId !== activeOrderId) ? <div className="sent-timeline"><div><b>Other active orders</b><small>Review or close each order before placing another.</small></div>{restoredActiveOrders.filter((order) => order.orderId !== activeOrderId).map((order) => <button className="text-action" key={order.orderId} onClick={() => openRestoredOrder(order)} disabled={ordering}>Open {order.reference} · {order.offerCount} {order.offerCount === 1 ? "confirmation" : "confirmations"}</button>)}</div> : null}
        </aside>
      </div> : null}

      {offersOpen ? <section className={`offers-panel${!activeOrderId ? " is-empty" : ""}`} role="dialog" aria-modal="true" aria-labelledby="order-status-title" data-modal-root="order-status" tabIndex={-1}><div className="offers-head"><div><span>{activeOrderId ? `ORDER STATUS · ${activeOrderId.slice(0, 8).toUpperCase()}` : "MY ORDERS"}</span><h2 id="order-status-title">{!activeOrderId ? "No active orders" : activeOrderSelected ? "Your pharmacy" : activeOrderNoRecipients ? "No response available" : activeOrderExpired ? "Order expired" : "Pharmacies that confirmed your order"}</h2><p>{!activeOrderId ? "Pharmacies that confirm a placed order will appear here." : offers.length ? `${offers.length} ${offers.length === 1 ? "pharmacy has" : "pharmacies have"} confirmed the complete order.` : activeOrderNoRecipients ? "No pharmacy received this order. Nothing was shared and you can close it safely." : activeOrderExpired ? "The response window ended before a pharmacy confirmed the complete order." : `Waiting for a pharmacy to confirm the complete order.${activeOrderMinutesRemaining != null ? ` About ${activeOrderMinutesRemaining} minutes remain.` : ""} This page updates automatically.`}</p></div><button data-autofocus onClick={() => setOffersOpen(false)} aria-label="Close order status"><X size={20} /></button></div>
        {checkoutError ? <p className="form-error"><CircleAlert size={15} /> {checkoutError}</p> : null}
        {!activeOrderId ? <div className="offers-empty"><PackageCheck size={29} /><b>No active orders</b><p>Add products to your basket and place an order. Only pharmacies that confirm the complete order will appear here.</p><button className="primary-wide" onClick={() => { setOffersOpen(false); setCartOpen(true); }}>Open order basket</button></div> : !offers.length ? <div className={`offers-empty ${activeOrderExpired || activeOrderNoRecipients ? "terminal" : ""}`}>{activeOrderExpired || activeOrderNoRecipients ? <CircleAlert size={29} /> : <Clock3 size={29} />}<b>{activeOrderNoRecipients ? "No pharmacy could receive this order" : activeOrderExpired ? "No pharmacy confirmed in time" : "Waiting for pharmacy confirmations"}</b><p>{activeOrderNoRecipients ? "Close this order and try again later. Your basket can be rebuilt from the catalogue." : activeOrderExpired ? "Close this expired order to start another one." : "Only pharmacies that can fulfil the complete order will appear here."}</p>{activeOrderExpired || activeOrderNoRecipients ? <button className="primary-wide" onClick={() => closeAndResetOrder("cancelled")} disabled={closingOrder}>{closingOrder ? "Closing order…" : "Close order"}</button> : null}</div> : <div className="quotes">{offers.map((offer) => <article key={offer.id}><div className="quote-brand"><span><Cross size={18} /></span><div><h3>{offer.pharmacyName}</h3><p>Approx. {(offer.distanceM / 1_000).toFixed(1)} km away</p></div></div><div className="availability complete"><Check size={15} />Complete order confirmed</div><div className="availability fulfilment"><PackageCheck size={15} />{offer.fulfilmentMethod === "pickup" ? "Pickup confirmed" : offer.fulfilmentMethod === "delivery" ? "Delivery confirmed" : "Pickup or delivery confirmed"}</div><div className="offer-items">{offer.items.map((item) => <div key={item.id}><b>{item.isSubstitute ? "Substitute proposed" : "Ordered product"}</b>{[item.product?.brand || item.offeredProductId, item.product?.strength, item.product?.packSize ? `Pack ${item.product.packSize}` : "", item.quantity ? `Qty ${item.quantity}` : "", item.unitPriceRwf ? `RWF ${rwf.format(item.unitPriceRwf)} each` : ""].filter(Boolean).length ? <small>{[item.product?.brand || item.offeredProductId, item.product?.strength, item.product?.packSize ? `Pack ${item.product.packSize}` : "", item.quantity ? `Qty ${item.quantity}` : "", item.unitPriceRwf ? `RWF ${rwf.format(item.unitPriceRwf)} each` : ""].filter(Boolean).join(" · ")}</small> : null}</div>)}</div><div className="quote-price"><span>Total</span><b>RWF {rwf.format(offer.totalRwf)}</b>{offer.readyInMinutes ? <small>Ready in about {offer.readyInMinutes} minutes</small> : null}</div><div className="quote-actions"><button onClick={() => chooseOffer(offer)} disabled={selectionLocked}>{offer.status === "selected" ? "Chosen" : selectionLocked ? "Choice closed" : "Choose pharmacy"}</button><span className="contact-locked"><ShieldCheck size={15} /> {selectionLocked ? "Pharmacy chosen" : "WhatsApp and MoMo unlock after choice"}</span></div></article>)}</div>}
        {activeOrderSelected ? <div className="selected-contact">{selectedContact ? <><div><CircleCheck size={23} /><span><b>{selectedContact.pharmacyName} chosen</b><small>Use WhatsApp to arrange pickup or delivery. Use the phone&apos;s MoMo menu if you want to pay the pharmacy directly.</small></span></div><div>{selectedContact.momoCode ? <span className="momo-code"><Banknote size={16} /> MoMo code: <b>{selectedContact.momoCode}</b></span> : null}{whatsappUrl(selectedContact.whatsapp, `Hello, I chose ${selectedContact.pharmacyName} for my MED+250 order ${activeOrderId}. Please arrange pickup or delivery.`) ? <a onClick={() => trackMarketplaceEvent("whatsapp_handoff", { configured: true })} href={whatsappUrl(selectedContact.whatsapp, `Hello, I chose ${selectedContact.pharmacyName} for my MED+250 order ${activeOrderId}. Please arrange pickup or delivery.`) ?? undefined} target="_blank" rel="noreferrer"><MessageCircle size={16} /> Chat on WhatsApp</a> : null}{momoUssdUrl(selectedContact.momoCode) ? <a onClick={() => trackMarketplaceEvent("momo_handoff", { configured: true })} href={momoUssdUrl(selectedContact.momoCode) ?? undefined}><Banknote size={16} /> Pay with MoMo (*182#)</a> : null}</div></> : <div><CircleAlert size={23} /><span><b>Pharmacy contact unavailable</b><small>You can cancel this order and place it again.</small></span></div>}<div className="quote-actions"><button onClick={() => closeAndResetOrder("completed")} disabled={closingOrder}>{closingOrder ? "Updating order…" : "Finish order"}</button><button onClick={() => closeAndResetOrder("cancelled")} disabled={closingOrder}>Cancel order</button></div></div> : null}
      </section> : null}

      {portalOpen ? <div className="portal-overlay">
        {portalStage !== "workspace" ? <section className="portal-auth" role="dialog" aria-modal="true" aria-labelledby="pharmacy-signin-title" data-modal-root="portal-auth" tabIndex={-1}><button className="portal-close" data-autofocus onClick={() => setPortalOpen(false)} aria-label="Close pharmacy portal"><X size={20} /></button><Link className="brand" href="/"><BrandLogo /></Link><h2 id="pharmacy-signin-title">{portalStage === "signin" ? "Sign in with registered WhatsApp number" : "Enter your WhatsApp code"}</h2>
          {portalStage === "signin" ? <><label>WhatsApp number<div className="portal-phone-input"><span>+250</span><input value={pharmacyWhatsapp} onChange={(event) => setPharmacyWhatsapp(event.target.value.replace(/\D/g, "").slice(0, 9))} placeholder="78 000 0000" inputMode="tel" autoComplete="tel" /></div></label><button className="primary-wide" onClick={sendPharmacyCode} disabled={portalLoading}><MessageCircle size={17} /> {portalLoading ? "Sending code…" : "Send code on WhatsApp"}</button></> : <><small className="portal-otp-note">Use the 6-digit code sent to +250 {pharmacyWhatsapp}.</small><label>Verification code<input value={pharmacyOtp} onChange={(event) => setPharmacyOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" inputMode="numeric" autoComplete="one-time-code" maxLength={6} /></label><button className="primary-wide" onClick={verifyPharmacyCode} disabled={portalLoading}>{portalLoading ? "Verifying…" : "Verify and open pharmacy portal"} <ArrowRight size={17} /></button><button className="text-action" onClick={() => { setPortalStage("signin"); setPharmacyOtp(""); setPharmacyOtpChallengeId(""); setPortalError(""); setPortalMessage(""); }} disabled={portalLoading}>Use another WhatsApp number</button></>}
          {portalMessage ? <p className="form-success" role="status" aria-live="polite"><CircleCheck size={15} /> {portalMessage}</p> : null}{portalError ? <p className="form-error" role="alert"><CircleAlert size={15} /> {portalError}</p> : null}
          {unregisteredPharmacyWhatsapp ? <div className="portal-exception-backdrop" role="presentation"><div className="portal-exception" role="alertdialog" aria-modal="true" aria-labelledby="unregistered-whatsapp-title" data-modal-root="unregistered-pharmacy" tabIndex={-1}><button data-autofocus onClick={() => setUnregisteredPharmacyWhatsapp("")} aria-label="Close"><X size={18} /></button><span><CircleAlert size={22} /></span><h3 id="unregistered-whatsapp-title">WhatsApp number not registered</h3><p>This number is not linked to a pharmacy in MED+250. Contact the administrator to register the pharmacy or ask for a contact correction.</p><a className="primary-wide" href={`https://wa.me/${unregisteredPharmacyWhatsapp}?text=${encodeURIComponent(`Hello MED+250 admin, please help register or correct pharmacy WhatsApp number +250${pharmacyWhatsapp}.`)}`} target="_blank" rel="noreferrer"><MessageCircle size={17} /> Contact admin on WhatsApp</a><button className="text-action" onClick={() => setUnregisteredPharmacyWhatsapp("")}>Try another number</button></div></div> : null}
        </section> : <section className="portal-shell" role="dialog" aria-modal="true" aria-labelledby="pharmacy-workspace-title" data-modal-root="portal-workspace" tabIndex={-1}>
          <aside className="portal-sidebar"><Link className="brand" href="/"><BrandLogo /></Link><small>PHARMACY DESK</small><nav><button className={portalTab === "requests" ? "active" : ""} onClick={() => setPortalTab("requests")}><Bell size={18} /> Nearby orders {pharmacyRequests.length ? <b>{pharmacyRequests.length}</b> : null}</button><button className={portalTab === "prices" ? "active" : ""} onClick={() => setPortalTab("prices")}><Banknote size={18} /> Product prices</button><button className={portalTab === "profile" ? "active" : ""} onClick={() => setPortalTab("profile")}><HeartPulse size={18} /> Pharmacy profile</button></nav><div className="portal-user"><span>{activeMembership?.pharmacyName.slice(0, 2).toUpperCase()}</span><div><b>{activeMembership?.pharmacyName}</b><small>{activeMembership?.role}</small></div></div><button className="text-action" onClick={leavePharmacyPortal} disabled={portalLoading}>Sign out of pharmacy portal</button></aside>
          <div className="portal-main"><div className="portal-top"><div><span>PHARMACY PORTAL</span><h2 id="pharmacy-workspace-title">{portalTab === "requests" ? "Nearby orders" : portalTab === "prices" ? "Contribute current prices" : "Pharmacy profile"}</h2><p>Only orders privately assigned to this pharmacy are shown.</p></div><button data-autofocus onClick={() => setPortalOpen(false)} aria-label="Close pharmacy portal"><X size={20} /></button></div>
            {portalMessage ? <p className="form-success"><CircleCheck size={15} /> {portalMessage}</p> : null}{portalError ? <p className="form-error"><CircleAlert size={15} /> {portalError}</p> : null}
            {portalTab === "requests" ? <>
              <div className="portal-metrics"><div><span><Bell size={18} /></span><p>OPEN ORDERS</p><b>{pharmacyRequests.length}</b><small>recipient-authorized only</small></div><div><span><Clock3 size={18} /></span><p>LOCATION VIEW</p><b>Approximate</b><small>coarse distance only</small></div><div><span><ShieldCheck size={18} /></span><p>CUSTOMER CHOICES</p><b>{pharmacySelectedOrders.length}</b><small>contact released after choice</small></div></div>
              <div className="request-table-head"><div><h3>Open orders</h3><span>Real database results · live updates</span></div><button onClick={refreshPharmacyRequests}><LocateFixed size={15} /> Refresh</button></div>
              {pharmacyRequests.length ? <div className="request-list">{pharmacyRequests.map((request) => <article key={request.orderId}><div className="request-id"><span className="new">OPEN</span><b>{request.orderId.slice(0, 8).toUpperCase()}</b>{formatDate(request.createdAt) ? <small>{formatDate(request.createdAt)}</small> : null}</div><div><b>Approx. {(request.distanceM / 1_000).toFixed(1)} km away</b><small><MapPin size={12} /> Exact customer location remains private</small></div><div><b>{request.items.length} {request.items.length === 1 ? "product" : "products"}</b>{request.hasPrescription ? <small>Prescription unlocks only if the customer chooses you</small> : null}</div><div><b>{request.deliveryPreference}</b><small>Substitutes are product-specific</small></div><button onClick={() => beginOffer(request)}>Review order <ArrowRight size={15} /></button></article>)}</div> : <div className="portal-empty"><PackageCheck size={29} /><b>No open order is assigned</b><p>New customer orders assigned to this pharmacy will appear here.</p></div>}
              <div className="request-table-head"><div><h3>Customers who chose this pharmacy</h3><span>Contact and prescription access follow the customer&apos;s choice</span></div></div>
              {pharmacySelectedOrders.length ? <div className="request-list selected-order-list">{pharmacySelectedOrders.map((order) => <article key={order.orderId}><div className="request-id"><span className="new">SELECTED</span><b>{order.reference}</b>{formatDate(order.selectedAt) ? <small>{formatDate(order.selectedAt)}</small> : null}</div><div><b>{order.deliveryPreference}</b><small>Arrange pickup or delivery directly</small></div>{whatsappUrl(order.customerWhatsapp, `Hello, I’m contacting you from ${activeMembership?.pharmacyName ?? "the pharmacy"} about MED+250 order ${order.reference}. Please confirm fulfilment details.`) ? <div><a href={whatsappUrl(order.customerWhatsapp, `Hello, I’m contacting you from ${activeMembership?.pharmacyName ?? "the pharmacy"} about MED+250 order ${order.reference}. Please confirm fulfilment details.`) ?? undefined} target="_blank" rel="noreferrer"><MessageCircle size={14} /> Contact on WhatsApp</a><small>Medication details are not included in the message</small></div> : null}{order.prescriptionUrl ? <div><a href={order.prescriptionUrl} target="_blank" rel="noreferrer"><FileText size={14} /> Open private prescription</a><small>Signed link expires within 10 minutes and never beyond the 24-hour selection window</small></div> : null}</article>)}</div> : <div className="portal-empty"><ShieldCheck size={29} /><b>No customer has chosen this pharmacy yet</b><p>Contact details and prescriptions stay unavailable until an offer is selected.</p></div>}
            </> : null}
            {portalTab === "prices" ? <section className="portal-form"><div className="price-policy"><Sparkles size={19} /><p>Current pharmacy price contributions update the customer-facing minimum and maximum range.</p></div><label>Find product<input value={priceSearch} onChange={(event) => setPriceSearch(event.target.value)} placeholder="Brand or generic name" /></label><label>Product<select value={priceProductId} onChange={(event) => setPriceProductId(event.target.value)}><option value="">Choose a product</option>{filteredPriceProducts.map((product) => <option value={product.id} key={product.id}>{product.brand} {product.strength}</option>)}</select></label><label>Selling price (RWF)<input value={priceValue} onChange={(event) => setPriceValue(event.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="e.g. 2500" /></label><button className="primary-wide" onClick={addPriceContribution} disabled={portalLoading}>Save price <ArrowRight size={17} /></button></section> : null}
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
        {selectedRequest ? <section className="offer-editor"><div className="offers-head"><div><span>CONFIRM COMPLETE ORDER</span><h2>Order {selectedRequest.orderId.slice(0, 8).toUpperCase()}</h2><p>Confirm every product and price. Use a substitute only where the customer allowed it.</p></div><button onClick={() => setSelectedRequest(null)} aria-label="Close order confirmation"><X size={20} /></button></div><div className="offer-items">{selectedRequest.items.map((item) => <article key={item.orderItemId}><div><b>{item.productName}</b><small>{[`Qty ${item.quantity}`, item.packSize ? `Pack ${item.packSize}` : "", item.substitutesAllowed ? "A matching substitute is allowed" : "Exact product only"].filter(Boolean).join(" · ")}</small></div><label><input type="checkbox" checked={offerAvailability[item.orderItemId] ?? false} onChange={(event) => setOfferAvailability((current) => ({ ...current, [item.orderItemId]: event.target.checked }))} /> Confirm</label>{item.substitutesAllowed ? <label><input type="checkbox" checked={offerSubstitutes[item.orderItemId] ?? false} onChange={(event) => { const checked = event.target.checked; setOfferSubstitutes((current) => ({ ...current, [item.orderItemId]: checked })); setOfferProductIds((current) => ({ ...current, [item.orderItemId]: checked ? "" : item.productId })); }} /> Use substitute</label> : null}{offerSubstitutes[item.orderItemId] ? <label>Substitute product<select value={offerProductIds[item.orderItemId] ?? ""} onChange={(event) => setOfferProductIds((current) => ({ ...current, [item.orderItemId]: event.target.value }))}><option value="">Choose a matching product</option>{orderableCatalogue.filter((product) => product.id !== item.productId && isCompatibleSubstitute(product, item)).map((product) => <option value={product.id} key={product.id}>{[product.brand, product.strength, product.generic, product.packSize ? `Pack ${product.packSize}` : ""].filter(Boolean).join(" · ")}</option>)}</select></label> : null}<label>Unit price<input value={offerPrices[item.orderItemId] ?? ""} onChange={(event) => setOfferPrices((current) => ({ ...current, [item.orderItemId]: event.target.value.replace(/\D/g, "") }))} inputMode="numeric" placeholder="RWF" disabled={!(offerAvailability[item.orderItemId] ?? false)} /></label></article>)}</div><div className="offer-meta"><label>Fulfilment method<select value={offerFulfilmentMethod} onChange={(event) => setOfferFulfilmentMethod(event.target.value as "pickup" | "delivery" | "either")} disabled={selectedRequest.deliveryPreference !== "either"}>{selectedRequest.deliveryPreference === "either" ? <><option value="pickup">Pickup</option><option value="delivery">Delivery</option><option value="either">Pickup or delivery</option></> : <option value={selectedRequest.deliveryPreference}>{selectedRequest.deliveryPreference === "pickup" ? "Pickup" : "Delivery"}</option>}</select></label><label>Ready in minutes<input value={offerReadyMinutes} onChange={(event) => setOfferReadyMinutes(event.target.value.replace(/\D/g, ""))} /></label><label>Note<textarea value={offerNote} onChange={(event) => setOfferNote(event.target.value)} placeholder="Optional fulfilment note" /></label></div><button className="primary-wide" onClick={sendOffer} disabled={portalLoading}>Confirm complete order <ArrowRight size={17} /></button></section> : null}
      </div> : null}
    </main>
  );
}
