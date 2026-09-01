import type { Metadata } from "next";
import AdminPanel from "./admin-panel";

export const metadata: Metadata = {
  title: "Administration",
  description: "Secure MED+250 administration workspace.",
  robots: { index: false, follow: false, noarchive: true },
};

export default function AdminPage() {
  return <AdminPanel turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? ""} />;
}
