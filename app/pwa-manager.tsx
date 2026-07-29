"use client";

import { useEffect, useRef, useState } from "react";
import { Download, RefreshCw, Share, X } from "lucide-react";
import { marketplaceMessage } from "../lib/marketplace-messages";

const VISIT_COUNT_KEY = "med250-pwa-visit-count-v1";
const VISIT_SESSION_KEY = "med250-pwa-visit-session-v1";
const DISMISSED_UNTIL_KEY = "med250-pwa-dismissed-until-v1";
const DISMISSAL_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches
    || Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
}

function isIosSafari() {
  const userAgent = window.navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(userAgent)
    || (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);
  const webkit = /WebKit/.test(userAgent);
  const otherIosBrowser = /CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent);
  return ios && webkit && !otherIosBrowser;
}

function isPrivateWorkflow() {
  const parameters = new URLSearchParams(window.location.search);
  return parameters.get("pharmacy-portal") === "open" || Boolean(parameters.get("request"));
}

export default function PwaManager() {
  const [repeatVisitor, setRepeatVisitor] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosGuidance, setShowIosGuidance] = useState(false);
  const [updateRegistration, setUpdateRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [installing, setInstalling] = useState(false);
  const reloadingForUpdate = useRef(false);

  useEffect(() => {
    if (isStandalone() || isPrivateWorkflow()) return;
    let cancelled = false;
    try {
      const dismissedUntil = Number(window.localStorage.getItem(DISMISSED_UNTIL_KEY) ?? "0");
      if (dismissedUntil > Date.now()) return;
      let visits = Number(window.localStorage.getItem(VISIT_COUNT_KEY) ?? "0");
      if (!window.sessionStorage.getItem(VISIT_SESSION_KEY)) {
        visits += 1;
        window.localStorage.setItem(VISIT_COUNT_KEY, String(visits));
        window.sessionStorage.setItem(VISIT_SESSION_KEY, "1");
      }
      queueMicrotask(() => { if (!cancelled) setRepeatVisitor(visits >= 2); });
    } catch {
      // Storage can be unavailable in private or restricted browser contexts.
    }
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstallPrompt(null);
      setShowIosGuidance(false);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setShowIosGuidance(repeatVisitor && isIosSafari() && !isStandalone() && !isPrivateWorkflow());
    });
    return () => { cancelled = true; };
  }, [repeatVisitor]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator) || !window.isSecureContext) return undefined;
    let cancelled = false;
    let registrationCleanup: (() => void) | undefined;
    const onControllerChange = () => {
      if (!reloadingForUpdate.current) return;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    const register = () => {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).then((registration) => {
        if (cancelled) return;
        if (registration.waiting && navigator.serviceWorker.controller) setUpdateRegistration(registration);
        const onUpdateFound = () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) setUpdateRegistration(registration);
          });
        };
        registration.addEventListener("updatefound", onUpdateFound);
        registrationCleanup = () => registration.removeEventListener("updatefound", onUpdateFound);
      }).catch(() => {
        // The marketplace remains fully usable when service-worker registration is unavailable.
      });
    };
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    let idleHandle: number | undefined;
    const registrationDelay = window.setTimeout(() => {
      idleHandle = idleWindow.requestIdleCallback
        ? idleWindow.requestIdleCallback(register, { timeout: 2_000 })
        : window.setTimeout(register, 1_000);
    }, 8_000);
    return () => {
      cancelled = true;
      registrationCleanup?.();
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      window.clearTimeout(registrationDelay);
      if (idleHandle == null) return;
      if (idleWindow.cancelIdleCallback && idleWindow.requestIdleCallback) idleWindow.cancelIdleCallback(idleHandle);
      else window.clearTimeout(idleHandle);
    };
  }, []);

  function dismissInstallPrompt() {
    try {
      window.localStorage.setItem(DISMISSED_UNTIL_KEY, String(Date.now() + DISMISSAL_PERIOD_MS));
    } catch {
      // Dismiss for the current render when persistent storage is unavailable.
    }
    setInstallPrompt(null);
    setShowIosGuidance(false);
  }

  async function install() {
    if (!installPrompt) return;
    setInstalling(true);
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstalling(false);
    if (choice.outcome === "accepted") setInstallPrompt(null);
    else dismissInstallPrompt();
  }

  function applyUpdate() {
    const waitingWorker = updateRegistration?.waiting;
    if (!waitingWorker) return;
    reloadingForUpdate.current = true;
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
  }

  if (updateRegistration) return <aside className="pwa-prompt pwa-update" role="status" aria-live="polite">
    <span className="pwa-prompt-icon" aria-hidden="true"><RefreshCw size={20} /></span>
    <div><b>{marketplaceMessage("inventory.f35614ad51ad")}</b><p>{marketplaceMessage("inventory.89d439bc7e4f")}</p></div>
    <button className="pwa-primary" type="button" onClick={applyUpdate}>{marketplaceMessage("inventory.c1c1009d3f37")}</button>
    <button className="pwa-close" type="button" onClick={() => setUpdateRegistration(null)} aria-label={marketplaceMessage("inventory.6a124bc383db")}><X size={18} /></button>
  </aside>;

  if (!repeatVisitor || (!installPrompt && !showIosGuidance)) return null;

  return <aside className="pwa-prompt" aria-labelledby="pwa-install-title">
    <span className="pwa-prompt-icon" aria-hidden="true">{showIosGuidance ? <Share size={20} /> : <Download size={20} />}</span>
    <div><b id="pwa-install-title">{marketplaceMessage("inventory.f0bf2ac92926")}</b><p>{showIosGuidance ? marketplaceMessage("inventory.c0a9658a1655") : marketplaceMessage("inventory.007a864e39ee")}</p></div>
    {installPrompt ? <button className="pwa-primary" type="button" onClick={() => { void install(); }} disabled={installing}>{installing ? marketplaceMessage("inventory.c926c2c50e65") : marketplaceMessage("inventory.569ca49f4aaf")}</button> : null}
    <button className="pwa-close" type="button" onClick={dismissInstallPrompt} aria-label={showIosGuidance ? marketplaceMessage("inventory.4ea93f293319") : marketplaceMessage("inventory.a0e63d7c7125")}><X size={18} /></button>
  </aside>;
}
