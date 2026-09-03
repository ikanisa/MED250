import { ingestTwilioImage, MediaIngestError } from "./r2-media.ts";
import { resolveGoogleMapsLocation } from "./google-maps-location.ts";
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
import { WhatsAppConversation, ConversationError } from "./whatsapp-conversation.ts";
import { syncWhatsAppContent } from "./twilio-content-runtime.ts";
import { capturePartnerLocation, enqueuePartnerLocationOutreach } from './partner-location-outreach.ts';

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
  const conversation = new WhatsAppConversation(d1Database(env));
  if (action.kind === "service") {
    await conversation.service(event,inbound.fromE164,action.action);
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
  if (action.kind === "draft") {
    if (action.action === "ready") await conversation.ready(event.actorId,action.requestId,event.eventId);
    else if (action.action === "cancel") await conversation.cancel(event.actorId,event.eventId,action.requestId);
    else if (action.action === "status") await conversation.status(event.actorId,action.requestId,event.eventId);
    else await conversation.send(event.actorId,action.requestId,event.eventId,action.action === "send_save");
    return true;
  }
  if (action.kind === "guidance") {
    if (action.action === "send_image") {
      await withRepository(env, (repository) => repository.queueClientGuidance(event, inbound.fromE164, "send_image"));
    } else {
      await withRepository(env, (repository) => repository.completeInbound(event.eventId, "client_guidance_acknowledged"));
    }
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
    if(await capturePartnerLocation(d1Database(env),event,{e164:inbound.fromE164,latitude:inbound.latitude,
      longitude:inbound.longitude,address:inbound.address,label:inbound.label})) return true;
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

async function handleSharedGoogleMapsLocation(
  env: Env,
  event: InboundReceipt,
  inbound: TwilioInboundMessage,
): Promise<boolean> {
  const resolved = await resolveGoogleMapsLocation(inbound.body);
  if (!resolved.matched) return false;
  if (event.actorType !== "client") {
    await withRepository(env, (repository) => repository.completeInbound(event.eventId, "pharmacy_maps_location_ignored"));
    return true;
  }
  await withRepository(env, async (repository) => {
    const requestId = await repository.activeClientRequest(event.actorId);
    if (!resolved.location) {
      await repository.queueLocationCaptureRetry({
        eventId: event.eventId,
        actorId: event.actorId,
        requestId,
        recipientE164: inbound.fromE164,
      });
      return;
    }
    await repository.saveLocation({
      actorId: event.actorId,
      requestId,
      latitude: resolved.location.latitude,
      longitude: resolved.location.longitude,
      accuracyM: null,
      address: null,
      label: "Google Maps pin",
      source: "whatsapp_native",
      captureKeyHex: await sha256Hex(
        `google-maps-share:${inbound.messageSid}:${resolved.location.latitude}:${resolved.location.longitude}`,
      ),
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
    const conversation = new WhatsAppConversation(d1Database(env));
    try {
      const command = inbound.body.trim().toUpperCase();
      if (["STOP","UNSUBSCRIBE","CANCEL","HELP","PRIVACY","START","RESUME"].includes(command)) {
        await conversation.service(event,inbound.fromE164,command === "UNSUBSCRIBE"?"stop":command === "RESUME"?"start":command.toLowerCase());
        return twiml();
      }
      if (await handleAction(env, event, inbound)) return twiml();
      if (await handleNativeLocation(env, event, inbound)) return twiml();
      if (await handleSharedGoogleMapsLocation(env, event, inbound)) return twiml();
      if (await handleClientImage(env, event, inbound)) return twiml();
      await conversation.service(event,inbound.fromE164,"new");
    } catch(error) {
      if (!(error instanceof ConversationError)) throw error;
      await conversation.queue(inbound.fromE164,error.guidance,`conversation-error:${event.eventId}`,event.requestId);
      await conversation.complete(event.eventId,`conversation_${error.guidance}`);
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

export async function sweepWhatsAppOperationalState(env: Env): Promise<void> {
  const receipt = await withRepository(env, (repository) => repository.reconcileOperationalState());
  await syncWhatsAppContent(env);
  await enqueuePartnerLocationOutreach(d1Database(env));
  console.log(JSON.stringify({ event: "whatsapp_operational_state_reconciled", ...receipt }));
}
