import type { Metadata } from "next";
import InfoShell from "../info-shell";

export const metadata: Metadata = { title: "Privacy", description: "How MED+250 handles location, contact, order, and prescription information.", alternates: { canonical: "/privacy" } };

export default function PrivacyPage() {
  return <InfoShell eyebrow="PRIVACY" title="Privacy at MED+250" intro="This notice explains the product behaviour implemented in the current marketplace. It should be reviewed with Rwandan legal and regulatory advisers before public launch.">
    <section><h2>Information used to place an order</h2><p>MED+250 uses your selected products, quantities, fulfilment preference, location, optional WhatsApp number, and any prescription you choose to attach. Anonymous sign-in identifies a browser session; it does not make order or health data anonymous.</p></section>
    <section><h2>Location and pharmacy matching</h2><p>Your browser asks before sharing location. MED+250 uses location to route the order to nearby pharmacies. Pharmacies initially receive only an approximate distance and the order information needed to decide whether they can fulfil it.</p></section>
    <section><h2>Contact and prescription access</h2><p>Your exact contact details and private prescription are withheld until you choose a responding pharmacy. Prescription access uses a short-lived link and is limited to the selected pharmacy&apos;s order workflow.</p></section>
    <section><h2>WhatsApp and MoMo</h2><p>Opening WhatsApp or the phone&apos;s MoMo menu leaves MED+250 and is governed by the relevant service and your mobile operator. MED+250 does not process or hold the payment.</p></section>
    <section><h2>Questions and corrections</h2><p>Pharmacy staff can request a correction to their registered WhatsApp contact from the pharmacy portal. For other privacy requests, contact the MED+250 administrator through the contact channel provided in the marketplace.</p></section>
  </InfoShell>;
}
