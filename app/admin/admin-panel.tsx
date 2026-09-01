"use client";

import Link from "next/link";
import {
  Activity,
  Building2,
  CircleAlert,
  Clock3,
  KeyRound,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  MessageCircle,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  Truck,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { jsonRequest, med250ApiJson } from "../../lib/med250-api";
import BrandLogo from "../brand-logo";
import Turnstile from "../turnstile";

type AdminRole = "super_admin" | "operations_admin" | "catalogue_reviewer";

type AdminSession = {
  authenticated: true;
  userId: string;
  displayName: string;
  role: AdminRole;
  permissions: string[];
  whatsappMasked: string;
  lastLoginAt: string | null;
  expiresAt: string;
};

type DashboardData = {
  generatedAt: string;
  catalogue: { active: number; orderable: number; pendingReview: number };
  pharmacies: { total: number; marketplaceApproved: number; dispatchReady: number; pendingContactChanges: number };
  requests: { open: number; created24h: number; selected24h: number };
  delivery: { pending: number; retrying: number; failed24h: number };
  access: { activeAdmins: number; activeSessions: number };
  recentAdminActivity: Array<{ eventType: string; createdAt: string }>;
};

type AdminTab = "overview" | "catalogue" | "pharmacies" | "delivery" | "access";

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function sessionFrom(value: unknown): AdminSession | null {
  const row = object(value);
  if (row?.authenticated !== true
    || typeof row.userId !== "string"
    || typeof row.displayName !== "string"
    || !["super_admin", "operations_admin", "catalogue_reviewer"].includes(String(row.role))
    || !Array.isArray(row.permissions)
    || typeof row.whatsappMasked !== "string"
    || typeof row.expiresAt !== "string") return null;
  return row as AdminSession;
}

function dashboardFrom(value: unknown): { session: AdminSession; dashboard: DashboardData } | null {
  const row = object(value);
  const session = sessionFrom(row?.admin);
  const dashboard = object(row?.dashboard);
  if (!session || !dashboard
    || !object(dashboard.catalogue)
    || !object(dashboard.pharmacies)
    || !object(dashboard.requests)
    || !object(dashboard.delivery)
    || !object(dashboard.access)
    || !Array.isArray(dashboard.recentAdminActivity)) return null;
  return { session, dashboard: dashboard as DashboardData };
}

function formatDate(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not yet";
  return new Intl.DateTimeFormat("en-RW", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Kigali",
  }).format(new Date(value));
}

function roleLabel(role: AdminRole): string {
  if (role === "super_admin") return "Super administrator";
  if (role === "operations_admin") return "Operations administrator";
  return "Catalogue reviewer";
}

function activityLabel(value: string): string {
  return value.replace(/^admin_/, "").replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function Metric({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  detail: string;
}) {
  return <article className="admin-metric">
    <span aria-hidden="true">{icon}</span>
    <p>{label}</p>
    <b>{value.toLocaleString("en-RW")}</b>
    <small>{detail}</small>
  </article>;
}

export default function AdminPanel({ turnstileSiteKey }: { turnstileSiteKey: string }) {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [stage, setStage] = useState<"phone" | "otp">("phone");
  const [nationalNumber, setNationalNumber] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [otp, setOtp] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaVersion, setCaptchaVersion] = useState(0);
  const [captchaError, setCaptchaError] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<AdminTab>("overview");

  const e164 = useMemo(() => nationalNumber.length === 9 ? "250" + nationalNumber : "", [nationalNumber]);

  const loadDashboard = useCallback(async () => {
    const payload = dashboardFrom(await med250ApiJson("/api/admin/dashboard"));
    if (!payload) throw new Error("MED250 returned an invalid admin dashboard.");
    setSession(payload.session);
    setDashboard(payload.dashboard);
  }, []);

  useEffect(() => {
    let active = true;
    const restore = async () => {
      try {
        const restored = sessionFrom(await med250ApiJson("/api/auth/admin/session"));
        if (!active || !restored) return;
        setSession(restored);
        await loadDashboard();
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "The admin session could not be restored.");
      } finally {
        if (active) setLoading(false);
      }
    };
    restore();
    return () => { active = false; };
  }, [loadDashboard]);

  const requestCode = async () => {
    if (!e164 || (turnstileSiteKey && !captchaToken)) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const response = object(await med250ApiJson(
        "/api/auth/admin/otp/request",
        jsonRequest({ phone: e164, captchaToken: captchaToken || null }),
      ));
      if (typeof response?.challengeId !== "string") throw new Error("The sign-in challenge could not be created.");
      setChallengeId(response.challengeId);
      setStage("otp");
      setMessage("If this number has active admin access, a six-digit code has been sent on WhatsApp.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The verification code could not be sent.");
      setCaptchaToken("");
      setCaptchaVersion((value) => value + 1);
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async () => {
    if (!challengeId || otp.length !== 6 || !e164) return;
    setLoading(true);
    setError("");
    try {
      const authenticated = sessionFrom(await med250ApiJson(
        "/api/auth/admin/otp/verify",
        jsonRequest({ phone: e164, challengeId, code: otp }),
      ));
      if (!authenticated) throw new Error("The secure admin session could not be created.");
      setSession(authenticated);
      setOtp("");
      setMessage("");
      await loadDashboard();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The verification code could not be confirmed.");
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    setLoading(true);
    setError("");
    try {
      await med250ApiJson("/api/auth/admin/session", { method: "DELETE" });
      setSession(null);
      setDashboard(null);
      setStage("phone");
      setChallengeId("");
      setOtp("");
      setMessage("");
      setCaptchaToken("");
      setCaptchaVersion((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign out failed.");
    } finally {
      setLoading(false);
    }
  };

  if (!session) {
    return <main className="admin-login-page" id="main-content">
      <a className="skip-link" href="#admin-signin">Skip to secure sign-in</a>
      <header className="admin-login-header">
        <Link className="brand" href="/" aria-label="MED+250 home"><BrandLogo /></Link>
        <span><ShieldCheck size={17} /> Secure administration</span>
      </header>
      <section className="admin-login-card" id="admin-signin" aria-labelledby="admin-signin-title" aria-busy={loading}>
        <span className="admin-security-mark"><KeyRound size={22} /></span>
        <h1 id="admin-signin-title">Admin sign in</h1>
        <p>Use an approved WhatsApp number. Access is role-based, time-limited, and recorded.</p>

        {stage === "phone" ? <>
          <label htmlFor="admin-whatsapp">WhatsApp number</label>
          <div className="admin-phone-input">
            <span>+250</span>
            <input
              id="admin-whatsapp"
              value={nationalNumber}
              onChange={(event) => setNationalNumber(event.target.value.replace(/\D/g, "").replace(/^0/, "").slice(0, 9))}
              inputMode="tel"
              autoComplete="tel-national"
              placeholder="7XX XXX XXX"
              maxLength={9}
              disabled={loading}
            />
          </div>
          {turnstileSiteKey ? <Turnstile
            key={captchaVersion}
            siteKey={turnstileSiteKey}
            action="admin_login"
            expiredMessage="The security check expired. Complete it again before requesting a code."
            errorMessage="The security check could not load. Check your connection and try again."
            onToken={(token) => { setCaptchaToken(token); if (token) setCaptchaError(""); }}
            onError={setCaptchaError}
          /> : null}
          {captchaError ? <p className="admin-alert error" role="alert"><CircleAlert size={16} /> {captchaError}</p> : null}
          <button className="admin-primary" type="button" onClick={requestCode} disabled={loading || !e164 || Boolean(turnstileSiteKey && !captchaToken)}>
            {loading ? <LoaderCircle className="button-spinner" size={18} /> : <MessageCircle size={18} />}
            {loading ? "Requesting code…" : "Send WhatsApp code"}
          </button>
        </> : <>
          <small className="admin-otp-destination">Enter the code sent to +250 ••• ••{nationalNumber.slice(-2)}</small>
          <label htmlFor="admin-otp">Six-digit code</label>
          <input
            className="admin-otp-input"
            id="admin-otp"
            value={otp}
            onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            maxLength={6}
            disabled={loading}
            autoFocus
          />
          <button className="admin-primary" type="button" onClick={verifyCode} disabled={loading || otp.length !== 6}>
            {loading ? <LoaderCircle className="button-spinner" size={18} /> : <ShieldCheck size={18} />}
            {loading ? "Verifying…" : "Open admin workspace"}
          </button>
          <button className="admin-text-action" type="button" onClick={() => {
            setStage("phone");
            setChallengeId("");
            setOtp("");
            setMessage("");
            setError("");
            setCaptchaToken("");
            setCaptchaVersion((value) => value + 1);
          }} disabled={loading}>Use a different number</button>
        </>}

        {message ? <p className="admin-alert success" role="status"><ShieldCheck size={16} /> {message}</p> : null}
        {error ? <p className="admin-alert error" role="alert"><CircleAlert size={16} /> {error}</p> : null}
        <small className="admin-login-footnote">Codes expire after five minutes. Five incorrect attempts close the challenge.</small>
      </section>
    </main>;
  }

  const navigation: Array<{ id: AdminTab; label: string; icon: ReactNode }> = [
    { id: "overview", label: "Overview", icon: <LayoutDashboard size={18} /> },
    { id: "catalogue", label: "Catalogue", icon: <ShoppingBag size={18} /> },
    { id: "pharmacies", label: "Pharmacies", icon: <Building2 size={18} /> },
    { id: "delivery", label: "Delivery", icon: <Truck size={18} /> },
    { id: "access", label: "Access", icon: <Users size={18} /> },
  ];

  return <main className="admin-console" id="main-content">
    <a className="skip-link" href="#admin-workspace">Skip to admin workspace</a>
    <aside className="admin-sidebar">
      <Link className="brand" href="/" aria-label="MED+250 home"><BrandLogo /></Link>
      <small>Administration</small>
      <nav aria-label="Admin sections">
        {navigation.map((item) => <button
          key={item.id}
          type="button"
          className={tab === item.id ? "active" : ""}
          aria-current={tab === item.id ? "page" : undefined}
          onClick={() => setTab(item.id)}
        >{item.icon}{item.label}</button>)}
      </nav>
      <div className="admin-user">
        <span>{session.displayName.slice(0, 2).toUpperCase()}</span>
        <div><b>{session.displayName}</b><small>{roleLabel(session.role)}</small></div>
      </div>
      <button className="admin-signout" type="button" onClick={signOut} disabled={loading}><LogOut size={17} /> Sign out</button>
    </aside>

    <section className="admin-workspace" id="admin-workspace" aria-busy={loading}>
      <header className="admin-topbar">
        <div>
          <h1>{navigation.find((item) => item.id === tab)?.label}</h1>
          <p>Live Worker and D1 operational view</p>
        </div>
        <button type="button" onClick={async () => {
          setLoading(true);
          setError("");
          try { await loadDashboard(); }
          catch (caught) { setError(caught instanceof Error ? caught.message : "The dashboard could not be refreshed."); }
          finally { setLoading(false); }
        }} disabled={loading}>
          {loading ? <LoaderCircle className="button-spinner" size={17} /> : <RefreshCw size={17} />}
          Refresh
        </button>
      </header>

      <nav className="admin-mobile-tabs" aria-label="Admin sections">
        {navigation.map((item) => <button
          key={item.id}
          type="button"
          className={tab === item.id ? "active" : ""}
          onClick={() => setTab(item.id)}
        >{item.icon}<span>{item.label}</span></button>)}
      </nav>

      {error ? <p className="admin-alert error" role="alert"><CircleAlert size={16} /> {error}</p> : null}
      {!dashboard ? <div className="admin-loading" role="status"><LoaderCircle className="button-spinner" size={22} /> Loading governed operational data…</div> : <>
        {tab === "overview" ? <>
          <section className="admin-metrics" aria-label="Operational overview">
            <Metric icon={<PackageCheck size={20} />} label="Orderable products" value={dashboard.catalogue.orderable} detail={dashboard.catalogue.pendingReview.toLocaleString("en-RW") + " awaiting catalogue review"} />
            <Metric icon={<Building2 size={20} />} label="Dispatch-ready pharmacies" value={dashboard.pharmacies.dispatchReady} detail={dashboard.pharmacies.marketplaceApproved.toLocaleString("en-RW") + " marketplace approved"} />
            <Metric icon={<Activity size={20} />} label="Open requests" value={dashboard.requests.open} detail={dashboard.requests.created24h.toLocaleString("en-RW") + " created in the last 24 hours"} />
            <Metric icon={<Truck size={20} />} label="Pending deliveries" value={dashboard.delivery.pending} detail={dashboard.delivery.failed24h.toLocaleString("en-RW") + " failed in the last 24 hours"} />
          </section>
          <div className="admin-overview-grid">
            <section className="admin-panel-section">
              <div className="admin-section-heading"><div><h2>Release health</h2><p>Current governed workload</p></div><ShieldCheck size={21} /></div>
              <dl className="admin-health-list">
                <div><dt>Catalogue coverage</dt><dd>{dashboard.catalogue.active.toLocaleString("en-RW")} active</dd></div>
                <div><dt>Contact reviews</dt><dd>{dashboard.pharmacies.pendingContactChanges.toLocaleString("en-RW")} pending</dd></div>
                <div><dt>Delivery retries</dt><dd>{dashboard.delivery.retrying.toLocaleString("en-RW")}</dd></div>
                <div><dt>Selections today</dt><dd>{dashboard.requests.selected24h.toLocaleString("en-RW")}</dd></div>
              </dl>
            </section>
            <section className="admin-panel-section">
              <div className="admin-section-heading"><div><h2>Admin activity</h2><p>Authentication events only</p></div><Clock3 size={21} /></div>
              {dashboard.recentAdminActivity.length ? <ol className="admin-activity-list">
                {dashboard.recentAdminActivity.map((event, index) => <li key={event.eventType + "-" + event.createdAt + "-" + index}>
                  <span aria-hidden="true" />
                  <div><b>{activityLabel(event.eventType)}</b><small>{formatDate(event.createdAt)}</small></div>
                </li>)}
              </ol> : <p className="admin-empty">No prior admin authentication activity is recorded.</p>}
            </section>
          </div>
        </> : null}

        {tab === "catalogue" ? <section className="admin-detail-view">
          <div className="admin-section-heading"><div><h2>Catalogue control</h2><p>Publication and orderability status</p></div><ShoppingBag size={23} /></div>
          <section className="admin-metrics compact">
            <Metric icon={<PackageCheck size={20} />} label="Active" value={dashboard.catalogue.active} detail="Visible catalogue records" />
            <Metric icon={<ShoppingBag size={20} />} label="Orderable" value={dashboard.catalogue.orderable} detail="Available to marketplace orders" />
            <Metric icon={<Clock3 size={20} />} label="Pending review" value={dashboard.catalogue.pendingReview} detail="Research or catalogue review" />
          </section>
        </section> : null}

        {tab === "pharmacies" ? <section className="admin-detail-view">
          <div className="admin-section-heading"><div><h2>Pharmacy network</h2><p>Approval, dispatch, and contact governance</p></div><Building2 size={23} /></div>
          <section className="admin-metrics compact">
            <Metric icon={<Building2 size={20} />} label="Registered" value={dashboard.pharmacies.total} detail="All governed pharmacy records" />
            <Metric icon={<ShieldCheck size={20} />} label="Marketplace approved" value={dashboard.pharmacies.marketplaceApproved} detail="Approved for marketplace visibility" />
            <Metric icon={<Truck size={20} />} label="Dispatch ready" value={dashboard.pharmacies.dispatchReady} detail="Meets dispatch eligibility" />
            <Metric icon={<Clock3 size={20} />} label="Contact reviews" value={dashboard.pharmacies.pendingContactChanges} detail="Pending governed decisions" />
          </section>
        </section> : null}

        {tab === "delivery" ? <section className="admin-detail-view">
          <div className="admin-section-heading"><div><h2>Delivery operations</h2><p>Request and provider queue status</p></div><Truck size={23} /></div>
          <section className="admin-metrics compact">
            <Metric icon={<Activity size={20} />} label="Open requests" value={dashboard.requests.open} detail="Not cancelled, expired, or completed" />
            <Metric icon={<MessageCircle size={20} />} label="Pending sends" value={dashboard.delivery.pending} detail="Queued, claimed, or sending" />
            <Metric icon={<RefreshCw size={20} />} label="Retrying" value={dashboard.delivery.retrying} detail="Scheduled provider retries" />
            <Metric icon={<CircleAlert size={20} />} label="Failed 24h" value={dashboard.delivery.failed24h} detail="Failed or dead-lettered" />
          </section>
        </section> : null}

        {tab === "access" ? <section className="admin-detail-view">
          <div className="admin-section-heading"><div><h2>Access control</h2><p>Current administrator and session posture</p></div><KeyRound size={23} /></div>
          <section className="admin-metrics compact">
            <Metric icon={<Users size={20} />} label="Active admins" value={dashboard.access.activeAdmins} detail="OTP-enabled active principals" />
            <Metric icon={<ShieldCheck size={20} />} label="Active sessions" value={dashboard.access.activeSessions} detail="Unrevoked, unexpired sessions" />
          </section>
          <dl className="admin-access-details">
            <div><dt>Signed in as</dt><dd>{session.displayName}</dd></div>
            <div><dt>Role</dt><dd>{roleLabel(session.role)}</dd></div>
            <div><dt>WhatsApp</dt><dd>{session.whatsappMasked}</dd></div>
            <div><dt>Session expires</dt><dd>{formatDate(session.expiresAt)}</dd></div>
          </dl>
        </section> : null}

        <p className="admin-generated-at">Last refreshed {formatDate(dashboard.generatedAt)}</p>
      </>}
    </section>
  </main>;
}
