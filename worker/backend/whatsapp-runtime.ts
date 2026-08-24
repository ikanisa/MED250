import { ingestTwilioImage, MediaIngestError } from "./r2-media.ts";
import { d1Database, privateMediaBucket, twilioInboundRuntime } from "./runtime-env.ts";
import { sha256Hex } from "./secure-token.ts";
import { parseClientAction } from "./whatsapp-actions.ts";
import {
  parseTwilioInboundMessage,
  parseTwilioStatusCallback,
  TwilioWebhookError,
  type TwilioInboundMessage,
} from "./twilio-webhook.ts";
import { WhatsAppRepository, type InboundReceipt } from "./whatsapp-repository.ts";

const EMPTY_TWIML = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>";

function twiml(status = 200): Response {
  return new Response(EMPTY_TWIML, {
    status,
    headers: { "Content-Type": "text/xml; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function withRepository<T>(env: Env, work: (repository: WhatsAppRepository) => Promise<T>): Promise<T> {
  return work(new WhatsAppRepository(d1Database(env)));
}

async function beginInbound(env: Env, inbound: TwilioInboundMessage): Promise<InboundReceipt> {
  return withRepository(env, (repository) => repository.beginInbound({
    accountSid: inbound.accountSid,
    messageSid: inbound.messageSid,
    fromE164: inbound.fromE164,
    profileName: inbound.profileName,
    mediaCount: inbound.media ? 1 : 0,
    locationProvided: inbound.latitude !== null,
    buttonPayload: inbound.buttonPayload,
  }));
}

async function handleAction(
  env: Env,
  event: InboundReceipt,
  inbound: TwilioInboundMessage,
): Promise<boolean> {
  if (!inbound.buttonPayload) return false;
  const action = parseClientAction(inbound.buttonPayload);
  if (!action) {
    await withRepository(env, (repository) => repository.completeInbound(event.eventId, "unrecognized_button_payload"));
    return true;
  }
  if (action.kind === "pharmacy_response") {
    if (event.actorType !== "pharmacy" || event.pharmacyId !== action.pharmacyId) {
      await withRepository(env, (repository) => repository.completeInbound(event.eventId, "unauthorized_pharmacy_response", "actor_mismatch"));
      return true;
    }
    await withRepository(env, (repository) => repository.recordPharmacyResponse({
      eventId: event.eventId,
      actorId: event.actorId,
      requestId: action.requestId,
      pharmacyId: action.pharmacyId,
      responseStatus: action.response,
      messageSid: inbound.messageSid,
    }));
    return true;
  }
  if (event.actorType !== "client") {
    await withRepository(env, (repository) => repository.completeInbound(event.eventId, "pharmacy_client_action_rejected", "actor_mismatch"));
    return true;
  }
  if (action.kind === "use_saved") {
    await withRepository(env, (repository) => repository.useSavedLocation({
      eventId: event.eventId,
      actorId: event.actorId,
      requestId: action.requestId,
      locationId: action.locationId,
    }));
    return true;
  }
  await withRepository(env, (repository) => repository.requestNewLocation({
    eventId: event.eventId,
    actorId: event.actorId,
    requestId: action.requestId,
  }));
  return true;
}

async function handleNativeLocation(env: Env, event: InboundReceipt, inbound: TwilioInboundMessage): Promise<boolean> {
  if (inbound.latitude === null || inbound.longitude === null) return false;
  if (event.actorType !== "client") {
    await withRepository(env, (repository) => repository.completeInbound(event.eventId, "pharmacy_location_ignored"));
    return true;
  }
  await withRepository(env, async (repository) => {
    const requestId = await repository.activeClientRequest(event.actorId);
    await repository.saveLocation({
      actorId: event.actorId,
      requestId,
      latitude: inbound.latitude as number,
      longitude: inbound.longitude as number,
      accuracyM: null,
      address: inbound.address,
      label: inbound.label,
      source: "whatsapp_native",
      captureKeyHex: await sha256Hex(`whatsapp-native:${inbound.messageSid}`),
      eventId: event.eventId,
    });
  });
  return true;
}

function transientMediaFailure(error: unknown): boolean {
  if (!(error instanceof MediaIngestError)) return error instanceof TypeError || error instanceof DOMException;
  return error.code === "media_download_failed" && /HTTP (?:408|409|429|5\d\d)\b/.test(error.message);
}

async function handleClientImage(env: Env, event: InboundReceipt, inbound: TwilioInboundMessage): Promise<boolean> {
  if (!inbound.media) return false;
  if (event.actorType !== "client") {
    await withRepository(env, (repository) => repository.completeInbound(event.eventId, "pharmacy_image_no_action"));
    return true;
  }
  const receipt = await withRepository(env, (repository) => repository.beginClientImage(event.eventId, inbound.media!.contentType));
  if (receipt.mediaStatus === "ready") return true;
  try {
    const media = await ingestTwilioImage({
      bucket: privateMediaBucket(env),
      accountSid: inbound.accountSid,
      authToken: twilioInboundRuntime(env).authToken,
      mediaUrl: inbound.media.url,
      contentType: inbound.media.contentType,
      requestId: receipt.requestId,
      messageSid: inbound.messageSid,
      mediaIndex: 0,
    });
    await withRepository(env, (repository) => repository.finishClientImage({
      eventId: event.eventId,
      requestId: receipt.requestId,
      mediaId: receipt.mediaId,
      r2Key: media.key,
      byteSize: media.byteSize,
      sha256: media.sha256,
      succeeded: true,
      errorCode: null,
    }));
  } catch (error) {
    if (transientMediaFailure(error)) throw error;
    const errorCode = error instanceof MediaIngestError ? error.code : "media_processing_failed";
    await withRepository(env, (repository) => repository.finishClientImage({
      eventId: event.eventId,
      requestId: receipt.requestId,
      mediaId: receipt.mediaId,
      r2Key: null,
      byteSize: null,
      sha256: null,
      succeeded: false,
      errorCode,
    }));
  }
  return true;
}

export async function twilioInboundResponse(request: Request, env: Env): Promise<Response> {
  try {
    const runtime = twilioInboundRuntime(env);
    const inbound = await parseTwilioInboundMessage(request, {
      authToken: runtime.authToken,
      expectedAccountSid: runtime.accountSid,
      expectedToE164: runtime.fromE164,
      canonicalUrl: runtime.inboundWebhookUrl,
    });
    const event = await beginInbound(env, inbound);
    if (event.alreadyProcessed) return twiml();
    if (await handleAction(env, event, inbound)) return twiml();
    if (await handleNativeLocation(env, event, inbound)) return twiml();
    if (await handleClientImage(env, event, inbound)) return twiml();
    if (event.actorType === "client") {
      await withRepository(env, (repository) => repository.queueClientGuidance(event, inbound.fromE164, "send_image"));
    } else {
      await withRepository(env, (repository) => repository.completeInbound(event.eventId, "pharmacy_message_no_action"));
    }
    return twiml();
  } catch (error) {
    if (error instanceof TwilioWebhookError) {
      return new Response(error.code, {
        status: error.status,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    console.error(JSON.stringify({
      event: "twilio_inbound_failed",
      errorType: error instanceof Error ? error.name : "UnknownError",
    }));
    return new Response("temporarily_unavailable", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "30" },
    });
  }
}

function canonicalParameters(parameters: Record<string, string | string[]>): string {
  return JSON.stringify(Object.keys(parameters).sort().map((key) => [key, parameters[key]]));
}

export async function twilioStatusResponse(request: Request, env: Env): Promise<Response> {
  try {
    const runtime = twilioInboundRuntime(env);
    const callback = await parseTwilioStatusCallback(request, {
      authToken: runtime.authToken,
      expectedAccountSid: runtime.accountSid,
      expectedToE164: runtime.fromE164,
      canonicalUrl: runtime.statusCallbackUrl,
    });
    const eventKey = await sha256Hex(canonicalParameters(callback.allParameters));
    await withRepository(env, (repository) => repository.recordDeliveryEvent({
      eventKey,
      messageSid: callback.messageSid,
      providerStatus: callback.providerStatus,
      errorCode: callback.errorCode,
      occurredAt: new Date(),
    }));
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof TwilioWebhookError) {
      return new Response(error.code, { status: error.status, headers: { "Cache-Control": "no-store" } });
    }
    console.error(JSON.stringify({
      event: "twilio_status_callback_failed",
      errorType: error instanceof Error ? error.name : "UnknownError",
    }));
    return new Response("temporarily_unavailable", { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "30" } });
  }
}
