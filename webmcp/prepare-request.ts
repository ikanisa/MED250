import { defineTool } from "@nekuda/webmcp-sdk";
import { requireMarketplaceRuntime } from "./marketplace-runtime";

type PrepareRequestInput = Record<string, never>;

export const prepareOrderRequest = defineTool<PrepareRequestInput>({
  stableKey: "request.prepare",
  name: "prepare_order_request",
  title: "Prepare MED+250 availability request",
  description: "Prepare the current MED+250 basket for a pharmacy request and open the visible request-details step. Use when the visitor is ready to continue. Returns the basket and required next steps, then stops before location sharing, WhatsApp verification and submission, so no pharmacy is contacted.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, untrustedContentHint: false },
  async execute() {
    const basket = requireMarketplaceRuntime().prepareRequest();
    return {
      basket,
      status: "awaiting_visitor_details",
      nextSteps: [
        "The visitor reviews quantities and substitute choices in the visible UI.",
        "The visitor provides or approves a location inside Rwanda.",
        "The visitor verifies their WhatsApp number in the visible UI.",
        "If required, the visitor chooses a prescription file in the visible UI.",
        "The visitor personally submits the availability request before any pharmacy is contacted.",
      ],
      note: "The tool stopped at the reversible request-details handoff. No OTP, prescription, location, message, or pharmacy request was sent.",
    };
  },
});
