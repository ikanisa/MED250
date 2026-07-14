import type { Metadata } from "next";
import InfoShell from "../info-shell";

export const metadata: Metadata = { title: "Accessibility", description: "MED+250 accessibility features and current support commitment.", alternates: { canonical: "/accessibility" } };

export default function AccessibilityPage() {
  return <InfoShell eyebrow="ACCESSIBILITY" title="A marketplace people can use" intro="MED+250 is designed for keyboard, touch, and assistive-technology use across desktop and mobile browsers.">
    <section><h2>Implemented support</h2><p>The marketplace includes a skip link, semantic headings and navigation, labelled form controls, visible keyboard focus, keyboard-operable search suggestions, dialog focus management, status announcements, and layouts that reflow for smaller screens.</p></section>
    <section><h2>Browser and device support</h2><p>Use a current version of Chrome, Safari, Firefox, or Edge. Location access depends on browser permission and a secure HTTPS connection. Manual coordinates remain available when native location cannot be used.</p></section>
    <section><h2>Known limits</h2><p>Product names and regulatory source descriptions may contain technical language supplied by the source register. WhatsApp, MoMo USSD, and device permission prompts are controlled by external services or the operating system.</p></section>
    <section><h2>Report a barrier</h2><p>If part of MED+250 prevents you from completing an order, contact the administrator and include the page, device, browser, and a short description of what happened.</p></section>
  </InfoShell>;
}
