import { createOpaqueToken, sha256Hex } from "./secure-token.ts";
import { d1Database, dispatchQueue, twilioSendRuntime } from "./runtime-env.ts";
import { composeOutboxMessage, sendTwilioMessage, TwilioSendError } from "./twilio-send.ts";
import { WhatsAppRepository } from "./whatsapp-repository.ts";
import { ensureServiceContent, ensureBusinessContent, readApproval, verifyPharmacyContent, verifyBusinessDefinition } from "./twilio-content-runtime.ts";
import { businessContentKey } from "./whatsapp-content.ts";
import { partnerLocationEligibility, PARTNER_LOCATION_GUIDANCE } from './partner-location-outreach.ts';

export type DispatchQueueBody = {
  version: 1;
  outboxId: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DISPATCH_DLQ = /^med250-whatsapp-dispatch-dlq-(?:staging|production)$/;

export function isDispatchDeadLetterQueue(queueName: string): boolean {
  return DISPATCH_DLQ.test(queueName);
}

function queueBody(value: unknown): DispatchQueueBody | null {
  if (typeof value !== "object" || value === null) return null;
  const version: unknown = Reflect.get(value, "version");
  const outboxId: unknown = Reflect.get(value, "outboxId");
  return version === 1 && typeof outboxId === "string" && UUID.test(outboxId)
    ? { version: 1, outboxId: outboxId.toLowerCase() }
    : null;
}

async function withRepository<T>(env: Env, work: (repository: WhatsAppRepository) => Promise<T>): Promise<T> {
  return work(new WhatsAppRepository(d1Database(env)));
}

export async function sweepDispatchOutbox(env: Env, limit = 25): Promise<{ claimed: number; enqueued: number }> {
  const queue = dispatchQueue(env);
  const claimToken = crypto.randomUUID();
  const claims = await withRepository(env, async (repository) => {
    await repository.markStaleProviderSendsUnknown(600);
    return repository.claimOutbox(claimToken, limit);
  });
  let enqueued = 0;
  for (const claim of claims) {
    await queue.send(
      { version: 1, outboxId: claim.id } satisfies DispatchQueueBody,
      { contentType: "json" },
    );
    const recorded = await withRepository(env, (repository) => repository.markEnqueued(claim.id, claim.claimToken));
    if (recorded) enqueued += 1;
    else console.error(JSON.stringify({ event: "dispatch_enqueue_receipt_missing", outboxId: claim.id }));
  }
  console.log(JSON.stringify({ event: "dispatch_outbox_swept", claimed: claims.length, enqueued }));
  return { claimed: claims.length, enqueued };
}

async function deliveryPreparation(
  env: Env,
  outboxId: string,
  queueDeliveryId: string,
): Promise<{
  delivery: Awaited<ReturnType<WhatsAppRepository["loadOutboxDelivery"]>>;
  mediaToken: string | null;
} | null> {
  return withRepository(env, async (repository) => {
    const eligible = await partnerLocationEligibility(d1Database(env),outboxId) ?? await repository.checkOutboundEligibility(outboxId);
    if (!eligible) return null;
    const begun = await repository.beginProviderSend(outboxId, queueDeliveryId);
    if (!begun) return null;
    const delivery = await repository.loadOutboxDelivery(outboxId);
    let mediaToken: string | null = null;
    if (delivery.kind === "client_media_request") {
      if (!delivery.pharmacyId || !delivery.r2Key) throw new Error("Client-media outbox is incomplete.");
      mediaToken = createOpaqueToken();
      await repository.createMediaGrant({
        tokenHashHex: await sha256Hex(mediaToken),
        outboxId,
        pharmacyId: delivery.pharmacyId,
        r2Key: delivery.r2Key,
      });
    } else if (delivery.kind === "web_catalogue_order") {
      const leadImageR2Key = delivery.payload.lead_image_r2_key;
      if (typeof leadImageR2Key === "string" && leadImageR2Key) {
        if (!delivery.pharmacyId) throw new Error("Web-order outbox pharmacy is missing.");
        mediaToken = createOpaqueToken();
        await repository.createMediaGrant({
          tokenHashHex: await sha256Hex(mediaToken),
          outboxId,
          pharmacyId: delivery.pharmacyId,
          r2Key: leadImageR2Key,
        });
      }
    }
    return { delivery, mediaToken };
  });
}

async function recordSendFailure(
  env: Env,
  outboxId: string,
  queueDeliveryId: string,
  error: { code: string; retryable: boolean; outcomeUnknown: boolean },
  retryDelaySeconds: number,
): Promise<boolean> {
  return withRepository(env, async (repository) => {
    if (error.outcomeUnknown) {
      await repository.recordProviderUnknown(outboxId, queueDeliveryId, error.code);
      return false;
    }
    await repository.revokeMediaGrants(outboxId);
    return repository.recordProviderFailure({
      outboxId,
      queueDeliveryId,
      errorCode: error.code,
      retryable: error.retryable,
      retryDelaySeconds,
    });
  });
}

export async function processDispatchMessage(message: Message<unknown>, env: Env): Promise<void> {
  const body = queueBody(message.body);
  if (!body) {
    console.error(JSON.stringify({ event: "dispatch_queue_invalid_body", queueDeliveryId: message.id }));
    message.ack();
    return;
  }
  const retryDelaySeconds = Math.min(3_600, Math.max(10, 10 * (2 ** Math.max(0, message.attempts - 1))));
  let prepared: Awaited<ReturnType<typeof deliveryPreparation>>;
  try {
    prepared = await deliveryPreparation(env, body.outboxId, message.id);
  } catch (error) {
    console.error(JSON.stringify({
      event: "dispatch_prepare_failed",
      outboxId: body.outboxId,
      queueDeliveryId: message.id,
      errorType: error instanceof Error ? error.name : "UnknownError",
    }));
    message.retry({ delaySeconds: retryDelaySeconds });
    return;
  }
  if (!prepared) {
    message.ack();
    return;
  }

  let providerAccepted = false;
  try {
    const runtime = twilioSendRuntime(env);
    let outbound = await composeOutboxMessage(prepared.delivery, runtime, prepared.mediaToken);
    if(prepared.delivery.kind==='client_guidance' && prepared.delivery.payload.guidance===PARTNER_LOCATION_GUIDANCE) {
      const contentSid=await ensureBusinessContent(d1Database(env),runtime,'location_initial');
      if(await readApproval(d1Database(env),runtime,contentSid)!=='approved') throw new TwilioSendError('template_not_approved','Location outreach template is not approved.',{retryable:false});
      await verifyBusinessDefinition(runtime,contentSid,'location_initial');
      outbound={kind:'content',toE164:prepared.delivery.recipientE164,contentSid,variables:{}};
    } else if(outbound.kind === "service") {
      const contentSid=await ensureServiceContent(d1Database(env),runtime,outbound.serviceKey);
      outbound={kind:"content",toE164:outbound.toE164,contentSid,variables:outbound.variables};
    } else if(outbound.kind === "content" && ["otp","web_catalogue_order","client_media_request"].includes(prepared.delivery.kind)) {
      const key=businessContentKey(prepared.delivery.kind,prepared.delivery.payload);
      outbound={...outbound,contentSid:await ensureBusinessContent(d1Database(env),runtime,key)};
      if(await readApproval(d1Database(env),runtime,outbound.contentSid)!=="approved") {
        throw new TwilioSendError("template_not_approved","This business-initiated template is not approved.",{retryable:false});
      }
      if(prepared.delivery.kind!=='otp') await verifyPharmacyContent(runtime,outbound.contentSid,prepared.delivery.kind,outbound.variables,fetch,
        prepared.delivery.payload.permission_basis==='owner_attested_initial');
    }
    if(!(await partnerLocationEligibility(d1Database(env),body.outboxId) ?? await withRepository(env,repository=>repository.checkOutboundEligibility(body.outboxId)))) {message.ack();return;}
    const receipt = await sendTwilioMessage(
      outbound,
      runtime,
    );
    providerAccepted = true;
    const recorded = await withRepository(env, (repository) => repository.recordProviderAcceptance(body.outboxId, receipt.sid));
    if (!recorded) throw new Error("Provider acceptance receipt was not persisted.");
    message.ack();
    console.log(JSON.stringify({
      event: "dispatch_provider_accepted",
      outboxId: body.outboxId,
      queueDeliveryId: message.id,
      providerStatus: receipt.status,
    }));
  } catch (error) {
    const classified = error instanceof TwilioSendError
      ? error
      : providerAccepted
        ? new TwilioSendError(
          "provider_acceptance_persistence_unknown",
          "Provider acceptance could not be reconciled with the database.",
          { retryable: false, outcomeUnknown: true },
        )
        : new TwilioSendError("dispatch_pre_send_failed", "Outbound message preparation failed.", { retryable: false });
    console.error(JSON.stringify({
      event: "dispatch_provider_send_failed",
      outboxId: body.outboxId,
      queueDeliveryId: message.id,
      errorCode: classified.code,
      retryable: classified.retryable,
      outcomeUnknown: classified.outcomeUnknown,
    }));
    try {
      const retry = await recordSendFailure(env, body.outboxId, message.id, classified, retryDelaySeconds);
      if (retry) message.retry({ delaySeconds: retryDelaySeconds });
      else message.ack();
    } catch (recordError) {
      console.error(JSON.stringify({
        event: "dispatch_failure_receipt_failed",
        outboxId: body.outboxId,
        queueDeliveryId: message.id,
        errorType: recordError instanceof Error ? recordError.name : "UnknownError",
      }));
      message.retry({ delaySeconds: retryDelaySeconds });
    }
  }
}

export async function processDispatchBatch(batch: MessageBatch<unknown>, env: Env): Promise<void> {
  for (const message of batch.messages) await processDispatchMessage(message, env);
}

export async function processDeadLetterBatch(batch: MessageBatch<unknown>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    const body = queueBody(message.body);
    if (!body) {
      console.error(JSON.stringify({ event: "dispatch_dlq_invalid_body", queueDeliveryId: message.id }));
      message.ack();
      continue;
    }
    try {
      const recorded = await withRepository(env, (repository) => repository.recordDeadLetter({
        outboxId: body.outboxId,
        queueDeliveryId: message.id,
        attempts: Math.max(1, message.attempts),
      }));
      console.log(JSON.stringify({
        event: recorded ? "dispatch_dead_letter_recorded" : "dispatch_dead_letter_ignored",
        outboxId: body.outboxId,
        queueDeliveryId: message.id,
      }));
      message.ack();
    } catch (error) {
      console.error(JSON.stringify({
        event: "dispatch_dead_letter_receipt_failed",
        outboxId: body.outboxId,
        queueDeliveryId: message.id,
        errorType: error instanceof Error ? error.name : "UnknownError",
      }));
      message.retry({ delaySeconds: 60 });
    }
  }
}
