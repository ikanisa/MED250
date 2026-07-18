import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import {
  adminClient,
  corsHeaders,
  eligiblePharmacies,
  errorResponse,
  generateOtp,
  hashOtp,
  HttpError,
  json,
  normalizeInternationalPhone,
  requestSourceHash,
  sendWhatsappOtp,
} from "../_shared/dawanear-pharmacy-auth.ts";

Deno.serve(async (request: Request) => {
  try {
    // Validate the browser origin before parsing input, rate-limit writes,
    // challenge creation, or WhatsApp delivery. CORS is not only a response
    // decoration here: a rejected origin must have no authentication side
    // effects.
    const responseCors = corsHeaders(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseCors });
    if (request.method !== "POST") throw new HttpError("Method not allowed.", 405);

    const body = await request.json().catch(() => ({}));
    const phone = normalizeInternationalPhone(body?.phone);
    const client = adminClient();
    const sourceHash = await requestSourceHash(request);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60_000).toISOString();
    const code = generateOtp();
    const codeHash = await hashOtp(phone, code);
    const { data: issueRows, error: issueError } = await client.rpc("dawanear_issue_pharmacy_otp", {
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
    if (!issue?.challenge_id) throw new Error("Challenge was not created");
    const challenge = { id: String(issue.challenge_id) };

    const pharmacies = await eligiblePharmacies(client, phone);
    if (!pharmacies.length) {
      await client.from("dawanear_pharmacy_otp_challenges").update({ delivery_status: "suppressed" }).eq("id", challenge.id);
      return json(request, {
        registered: false,
        adminWhatsapp: "250795588248",
        message: "This WhatsApp number is not registered to a pharmacy.",
      });
    } else {
      try {
        await sendWhatsappOtp(phone, code);
        await client.from("dawanear_pharmacy_otp_challenges").update({ delivery_status: "sent" }).eq("id", challenge.id);
      } catch (error) {
        await client.from("dawanear_pharmacy_otp_challenges").update({ delivery_status: "failed", used_at: new Date().toISOString() }).eq("id", challenge.id);
        throw error;
      }
    }

    return json(request, {
      registered: true,
      challengeId: challenge.id,
      expiresAt: issue.challenge_expires_at ?? expiresAt,
      message: "A WhatsApp verification code has been sent.",
    });
  } catch (error) {
    console.error("dawanear-pharmacy-send-otp", error instanceof Error ? error.message : error);
    return errorResponse(request, error);
  }
});
