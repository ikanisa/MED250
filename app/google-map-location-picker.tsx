"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, LoaderCircle, MapPin, Search, X } from "lucide-react";
import { marketplaceMessage } from "../lib/marketplace-messages";

export type MapCoordinates = {
  latitude: number;
  longitude: number;
  accuracy: number;
};

type LatLng = { lat: number; lng: number };
type MapsListener = { remove: () => void };
type MapsLatLng = { lat: () => number; lng: () => number };
type MapsClickEvent = { latLng?: MapsLatLng | null };
type MapsMap = {
  addListener: (eventName: string, handler: (event: MapsClickEvent) => void) => MapsListener;
  setCenter: (position: LatLng) => void;
  setZoom: (zoom: number) => void;
};
type MapsMarker = {
  addListener: (eventName: string, handler: () => void) => MapsListener;
  getPosition: () => MapsLatLng | null | undefined;
  setMap: (map: MapsMap | null) => void;
  setPosition: (position: LatLng) => void;
  setVisible: (visible: boolean) => void;
};
type GeocoderResult = {
  formatted_address: string;
  geometry: { location: MapsLatLng };
};
type MapsGeocoder = {
  geocode: (
    request: { address?: string; location?: LatLng; componentRestrictions?: { country: string } },
    callback: (results: GeocoderResult[] | null, status: string) => void,
  ) => void;
};
type GoogleMapsApi = {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => MapsMap;
  Marker: new (options: Record<string, unknown>) => MapsMarker;
  Geocoder: new () => MapsGeocoder;
};

declare global {
  interface Window {
    google?: { maps: GoogleMapsApi };
  }
}

const KIGALI_CENTER = { lat: -1.9441, lng: 30.0619 };
const GOOGLE_MAPS_SCRIPT_ID = "med250-google-maps";
const GOOGLE_MAPS_CALLBACK = "__med250GoogleMapsReady";
let googleMapsPromise: Promise<GoogleMapsApi> | null = null;

function loadGoogleMaps(apiKey: string) {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (!apiKey) return Promise.reject(new Error("Google Maps address selection is not configured."));
  if (googleMapsPromise) return googleMapsPromise;

  googleMapsPromise = new Promise<GoogleMapsApi>((resolve, reject) => {
    const callbackWindow = window as Window & Record<string, unknown>;
    callbackWindow[GOOGLE_MAPS_CALLBACK] = () => {
      if (window.google?.maps) resolve(window.google.maps);
      else reject(new Error("Google Maps did not finish loading."));
      delete callbackWindow[GOOGLE_MAPS_CALLBACK];
    };

    const existing = document.getElementById(GOOGLE_MAPS_SCRIPT_ID);
    if (existing) return;
    const script = document.createElement("script");
    script.id = GOOGLE_MAPS_SCRIPT_ID;
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async&callback=${GOOGLE_MAPS_CALLBACK}`;
    script.onerror = () => {
      googleMapsPromise = null;
      delete callbackWindow[GOOGLE_MAPS_CALLBACK];
      reject(new Error("Google Maps could not load. Check your connection and try again."));
    };
    document.head.appendChild(script);
  });

  return googleMapsPromise;
}

function literal(position: MapsLatLng): LatLng {
  return { lat: position.lat(), lng: position.lng() };
}

function coordinateLabel(position: LatLng) {
  return `Pinned location · ${position.lat.toFixed(4)}, ${position.lng.toFixed(4)}`;
}

type GoogleMapLocationPickerProps = {
  apiKey: string;
  initialCoordinates: MapCoordinates | null;
  onCancel: () => void;
  onChoose: (coordinates: MapCoordinates, label: string) => void;
};

export default function GoogleMapLocationPicker({
  apiKey,
  initialCoordinates,
  onCancel,
  onChoose,
}: GoogleMapLocationPickerProps) {
  const mapElementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapsMap | null>(null);
  const markerRef = useRef<MapsMarker | null>(null);
  const geocoderRef = useRef<MapsGeocoder | null>(null);
  const setPinRef = useRef<(position: LatLng, resolveAddress?: boolean) => void>(() => undefined);
  const [selected, setSelected] = useState<LatLng | null>(() => initialCoordinates
    ? { lat: initialCoordinates.latitude, lng: initialCoordinates.longitude }
    : null);
  const [address, setAddress] = useState(initialCoordinates ? coordinateLabel({
    lat: initialCoordinates.latitude,
    lng: initialCoordinates.longitude,
  }) : "");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const listeners: MapsListener[] = [];

    loadGoogleMaps(apiKey).then((maps) => {
      if (cancelled || !mapElementRef.current) return;
      const initialPosition = initialCoordinates
        ? { lat: initialCoordinates.latitude, lng: initialCoordinates.longitude }
        : KIGALI_CENTER;
      const map = new maps.Map(mapElementRef.current, {
        center: initialPosition,
        zoom: initialCoordinates ? 16 : 13,
        clickableIcons: false,
        fullscreenControl: false,
        mapTypeControl: false,
        streetViewControl: false,
      });
      const marker = new maps.Marker({
        map,
        position: initialPosition,
        draggable: true,
        visible: Boolean(initialCoordinates),
        title: marketplaceMessage("inventory.3fc2c8746879"),
      });
      const geocoder = new maps.Geocoder();
      mapRef.current = map;
      markerRef.current = marker;
      geocoderRef.current = geocoder;
      setMapReady(true);

      const setPin = (position: LatLng, resolveAddress = true) => {
        marker.setPosition(position);
        marker.setMap(map);
        marker.setVisible(true);
        map.setCenter(position);
        setSelected(position);
        setAddress(coordinateLabel(position));
        setError("");
        if (!resolveAddress) return;
        geocoder.geocode({ location: position }, (results, status) => {
          if (!cancelled && status === "OK" && results?.[0]?.formatted_address) {
            setAddress(results[0].formatted_address);
          }
        });
      };
      setPinRef.current = setPin;
      listeners.push(map.addListener("click", (event) => {
        if (event.latLng) setPin(literal(event.latLng));
      }));
      listeners.push(marker.addListener("dragend", () => {
        const position = marker.getPosition();
        if (position) setPin(literal(position));
      }));
      setLoading(false);
    }).catch((loadError: unknown) => {
      if (!cancelled) {
        setMapReady(false);
        setError(loadError instanceof Error ? loadError.message : "Google Maps could not load.");
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      listeners.forEach((listener) => listener.remove());
      markerRef.current?.setMap(null);
      setPinRef.current = () => undefined;
    };
  }, [apiKey, initialCoordinates]);

  function searchAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = query.trim();
    if (!normalized || !geocoderRef.current) return;
    setSearching(true);
    setError("");
    geocoderRef.current.geocode({
      address: normalized,
      componentRestrictions: { country: "RW" },
    }, (results, status) => {
      setSearching(false);
      const result = results?.[0];
      if (status !== "OK" || !result) {
        setError("We could not find that address in Rwanda. Try a nearby landmark or place the pin on the map.");
        return;
      }
      const position = literal(result.geometry.location);
      mapRef.current?.setZoom(16);
      setPinRef.current(position, false);
      setAddress(result.formatted_address);
    });
  }

  function confirmLocation() {
    if (!selected) return;
    onChoose({ latitude: selected.lat, longitude: selected.lng, accuracy: 50 }, address || coordinateLabel(selected));
  }

  return <section className="map-location-picker" aria-label={marketplaceMessage("inventory.32831948b425")}>
    <div className="map-location-head">
      <div><b>{marketplaceMessage("inventory.66f3ff01304b")}</b><small>{marketplaceMessage("inventory.e504cae5caa7")}</small></div>
      <button type="button" onClick={onCancel} aria-label={marketplaceMessage("inventory.f3e7c90d7604")}><X size={17} /></button>
    </div>
    <form className="map-location-search" onSubmit={searchAddress}>
      <label><span className="sr-only">{marketplaceMessage("inventory.0ffb50d74cd4")}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={marketplaceMessage("inventory.65c0a6f040fa")} autoComplete="street-address" /></label>
      <button type="submit" disabled={loading || searching || !query.trim()}>{searching ? <LoaderCircle className="button-spinner" size={16} /> : <Search size={16} />}<span>{marketplaceMessage("inventory.49c266baaaa7")}</span></button>
    </form>
    <div className="map-location-canvas" ref={mapElementRef} aria-label={marketplaceMessage("inventory.ddba599d9b70")}>
      {loading ? <div className="map-location-loading" role="status"><LoaderCircle className="button-spinner" size={20} /> {marketplaceMessage("inventory.42b3b8d97b43")}</div> : null}
      {!loading && error && !mapReady ? <div className="map-location-unavailable" role="alert"><MapPin size={22} /><b>{marketplaceMessage("inventory.c8ceec5c1183")}</b><span>{error}</span></div> : null}
    </div>
    {error && mapReady ? <p className="form-error" role="alert">{error}</p> : null}
    <div className={`map-location-selection${selected ? " ready" : ""}`} aria-live="polite">
      <MapPin size={18} />
      <div><b>{selected ? address : marketplaceMessage("inventory.e8fde7a2057b")}</b><small>{selected ? marketplaceMessage("inventory.d3f7f00538de") : marketplaceMessage("inventory.4e2858d5c45c")}</small></div>
    </div>
    <button type="button" className="primary-wide" onClick={confirmLocation} disabled={!selected || loading}>{marketplaceMessage("inventory.69d62e1893a1")} <ArrowRight size={17} /></button>
  </section>;
}
