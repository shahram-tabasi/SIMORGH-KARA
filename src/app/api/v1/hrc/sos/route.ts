import { route, body } from "@/lib/hrc/http";
import { SosRequest } from "@/lib/hrc/schemas";
import { authenticateDevice } from "@/lib/hrc/device-auth";
import { ingestEvents } from "@/lib/hrc/ingest";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/hrc/sos — مسیر اختصاصی و کوتاه درخواست کمک.
 *
 * Same pipeline as `/events`, but a single item and nothing else in the way:
 * the phone does not have to assemble a batch, and the request body stays
 * small enough to go through on a bad connection. A repeat press with the same
 * `clientEventId` is idempotent, so hammering the button raises one emergency.
 */
export const POST = route(async (req) => {
  const ctx = await authenticateDevice(req);
  const s = await body(req, SosRequest);

  const { results } = await ingestEvents(ctx, [
    {
      clientEventId: s.clientEventId,
      eventType: "SOS",
      occurredAt: s.occurredAt ?? new Date().toISOString(),
      severity: "CRITICAL",
      message: s.message ?? "دکمهٔ SOS فشرده شد",
      latitude: s.latitude,
      longitude: s.longitude,
      accuracyM: s.accuracyM,
      confidence: null,
      payload: s.payload,
    },
  ]);

  const r = results[0];
  return {
    status: r.status,
    eventId: r.id ?? null,
    acknowledgedByServer: true,
    serverTime: new Date().toISOString(),
  };
});
