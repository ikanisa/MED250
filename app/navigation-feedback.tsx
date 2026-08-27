"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { marketplaceMessage } from "../lib/marketplace-messages";

const NAVIGATION_FEEDBACK_TIMEOUT_MS = 12_000;
const CONNECTION_RESTORED_TIMEOUT_MS = 2_800;
const ROUTE_FOCUS_STABILIZATION_MS = 320;
const ROUTE_CONTENT_OBSERVATION_MS = NAVIGATION_FEEDBACK_TIMEOUT_MS;

export default function NavigationFeedback() {
  const pathname = usePathname();
  const [pending, setPending] = useState(false);
  const [online, setOnline] = useState(true);
  const [connectionRestored, setConnectionRestored] = useState(false);
  const [routeAnnouncement, setRouteAnnouncement] = useState("");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoredTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigationStartedRef = useRef(false);
  const onlineRef = useRef(true);

  useEffect(() => {
    let cancelled = false;
    const shouldRestoreFocus = navigationStartedRef.current;
    navigationStartedRef.current = false;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    document.documentElement.removeAttribute("data-navigation");
    document.querySelector("main")?.removeAttribute("aria-busy");

    queueMicrotask(() => {
      if (cancelled) return;
      setPending(false);
      if (shouldRestoreFocus) setRouteAnnouncement("Page ready");
    });
    if (!shouldRestoreFocus) return () => { cancelled = true; };
    const main = document.querySelector("main");
    const isRendered = (element: HTMLElement) => element.isConnected && element.getClientRects().length > 0;
    const initialHeading = Array.from(main?.querySelectorAll<HTMLElement>("h1") ?? []).find(isRendered) ?? null;
    const initialHeadingText = initialHeading?.textContent ?? "";
    const focusNewRoute = (requireContentChange = false) => {
      const currentMain = document.querySelector<HTMLElement>("main");
      const focusTarget = Array.from(currentMain?.querySelectorAll<HTMLElement>("h1, [data-route-focus]") ?? []).find(isRendered) ?? currentMain;
      if (!focusTarget) return;
      if (requireContentChange && focusTarget === initialHeading && focusTarget.textContent === initialHeadingText) return;
      const activeElement = document.activeElement;
      const focusCanMove = activeElement === document.body
        || activeElement === document.documentElement
        || activeElement === main
        || activeElement === currentMain
        || activeElement === initialHeading
        || !activeElement?.isConnected;
      if (!focusCanMove) return;
      const hadTabIndex = focusTarget.hasAttribute("tabindex");
      if (!hadTabIndex) focusTarget.setAttribute("tabindex", "-1");
      focusTarget.focus({ preventScroll: true });
      if (!hadTabIndex) focusTarget.addEventListener("blur", () => focusTarget.removeAttribute("tabindex"), { once: true });
    };
    let settledFrame: number | null = null;
    const frame = window.requestAnimationFrame(() => {
      focusNewRoute();
      settledFrame = window.requestAnimationFrame(() => focusNewRoute());
    });
    const focusStabilizationTimeout = window.setTimeout(focusNewRoute, ROUTE_FOCUS_STABILIZATION_MS);
    let mutationFrame: number | null = null;
    // Route transitions replace <main>. Observe the persistent document body so
    // the final route heading is still discovered after the old main unmounts.
    const contentObserver = new MutationObserver(() => {
      if (mutationFrame !== null) window.cancelAnimationFrame(mutationFrame);
      mutationFrame = window.requestAnimationFrame(() => focusNewRoute(true));
    });
    contentObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    const observerTimeout = window.setTimeout(() => contentObserver.disconnect(), ROUTE_CONTENT_OBSERVATION_MS);
    const announcementTimeout = window.setTimeout(() => setRouteAnnouncement(""), 1_600);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      if (settledFrame !== null) window.cancelAnimationFrame(settledFrame);
      if (mutationFrame !== null) window.cancelAnimationFrame(mutationFrame);
      contentObserver.disconnect();
      window.clearTimeout(focusStabilizationTimeout);
      window.clearTimeout(observerTimeout);
      window.clearTimeout(announcementTimeout);
    };
  }, [pathname]);

  useEffect(() => {
    const startFeedback = () => {
      navigationStartedRef.current = true;
      setPending(true);
      setRouteAnnouncement("Opening page");
      document.documentElement.setAttribute("data-navigation", "pending");
      document.querySelector("main")?.setAttribute("aria-busy", "true");
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        setPending(false);
        document.documentElement.removeAttribute("data-navigation");
        document.querySelector("main")?.removeAttribute("aria-busy");
      }, NAVIGATION_FEEDBACK_TIMEOUT_MS);
    };

    const beginNavigation = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;

      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      const current = new URL(window.location.href);
      // Search/filter changes stay within the current view and already expose local feedback.
      // Reserve the global page-opening state for an actual route transition.
      if (destination.pathname === current.pathname) return;

      startFeedback();
    };

    document.addEventListener("click", beginNavigation, true);
    window.addEventListener("popstate", startFeedback);
    return () => {
      document.removeEventListener("click", beginNavigation, true);
      window.removeEventListener("popstate", startFeedback);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      document.documentElement.removeAttribute("data-navigation");
      document.querySelector("main")?.removeAttribute("aria-busy");
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    onlineRef.current = navigator.onLine;
    queueMicrotask(() => { if (!cancelled) setOnline(navigator.onLine); });
    document.documentElement.toggleAttribute("data-offline", !navigator.onLine);
    const handleOffline = () => {
      onlineRef.current = false;
      setOnline(false);
      setConnectionRestored(false);
      document.documentElement.setAttribute("data-offline", "");
    };
    const handleOnline = () => {
      if (!onlineRef.current) {
        setConnectionRestored(true);
        if (restoredTimeoutRef.current) clearTimeout(restoredTimeoutRef.current);
        restoredTimeoutRef.current = setTimeout(() => setConnectionRestored(false), CONNECTION_RESTORED_TIMEOUT_MS);
      }
      onlineRef.current = true;
      setOnline(true);
      document.documentElement.removeAttribute("data-offline");
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      cancelled = true;
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      if (restoredTimeoutRef.current) clearTimeout(restoredTimeoutRef.current);
      document.documentElement.removeAttribute("data-offline");
    };
  }, []);

  return <>
    {!online ? <div className="connection-banner global-connection-banner" role="alert">{marketplaceMessage("inventory.97f80b6e9ec6")}</div> : null}
    {connectionRestored ? <div className="connection-restored" role="status" aria-live="polite">{marketplaceMessage("inventory.8b6721dc2ac7")}</div> : null}
    <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{routeAnnouncement}</span>
    <div
    className={`navigation-feedback${pending ? " is-visible" : ""}`}
    role="status"
    aria-live="polite"
    aria-atomic="true"
    aria-hidden={!pending}
    data-testid="navigation-feedback"
  >
    <span className="navigation-feedback-track" aria-hidden="true"><i /></span>
    {pending ? <span className="navigation-feedback-message"><i aria-hidden="true" /> {marketplaceMessage("inventory.f53b55a15cf2")}</span> : null}
    </div>
  </>;
}
