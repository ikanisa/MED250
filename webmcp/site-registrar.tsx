"use client";

import { useEffect } from "react";
import { registerTools } from "@nekuda/webmcp-sdk";
import { askSite } from "./ask-site";

export function SiteWebMcpRegistrar() {
  useEffect(() => {
    const registration = registerTools([askSite], { telemetry: false });
    return () => registration.unregister();
  }, []);
  return null;
}
