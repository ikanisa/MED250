import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import {
  adminClient,
  authenticatedCustomer,
  corsHeaders,
  errorResponse,
  generateOtp,
  hashCustomerOtp,
  HttpError,
  json,
  normalizeInternationalPhone,
  requestSourceHash,
  sendWhatsappOtp,
} from "../_shared/dawanear-pharmacy-auth.ts";

Deno.serve(async (request: Request) => {
  try {
    const responseCors = corsHeaders(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseCors });
    if (request.method !== "POST") throw new HttpError("Method not allowed.", 405);

    const customer = await authenticatedCustomer(request);
    if (!customer.isAnonymous) throw new HttpError("Use the customer checkout session to verify WhatsApp.", 403);
    const body = await request.json().catch(() => ({}));
    const phone = normalizeInternationalPhone(body?.phone);
    const client = adminClient();
    const sourceHash = await requestSourceHash(request);
    const code = generateOtp();
    const codeHash = await hashCustomerOtp(customer.id, phone, code);
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();

    const { data: issueRows, error: issueError } = await client.rpc("dawanear_issue_customer_otp", {
      p_user_id: customer.id,
      p_phone: phone,
      p_code_hash: codeHash,
      p_source_hash: sourceHash,
      p_expires_at: expiresAt,
    });
    if (issueError) throw issueError;
    const issue = Array.isArray(issueRows) ? issueRows[0] : null;
    if (issue?.rate_limit_reason) {
      throw new HttpError(String(issue.rate_limit_reason), 429, Number(issue.retry_after_seconds || 60));
    }
    if (!issue?.challenge_id) throw new Error("Customer OTP challenge was not created");

    try {
      await sendWhatsappOtp(phone, code, Deno.env.get("WHATSAPP_CUSTOMER_OTP_TEMPLATE_NAME") ?? undefined);
      await client.from("dawanear_customer_otp_challenges")
        .update({ delivery_status: "sent" })
        .eq("id", issue.challenge_id)
        .eq("user_id", customer.id);
    } catch (error) {
      await client.from("dawanear_customer_otp_challenges")
        .update({ delivery_status: "failed", used_at: new Date().toISOString() })
        .eq("id", issue.challenge_id)
        .eq("user_id", customer.id);
      throw error;
    }

    return json(request, {
      challengeId: String(issue.challenge_id),
      expiresAt: String(issue.challenge_expires_at ?? expiresAt),
      message: "A WhatsApp verification code has been sent.",
    });
  } catch (error) {
    console.error("dawanear-customer-send-otp", error instanceof Error ? error.message : error);
    return errorResponse(request, error);
  }
});
