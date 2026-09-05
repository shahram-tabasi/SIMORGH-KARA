import { route, body } from "@/lib/hrc/http";
import { EventBatch } from "@/lib/hrc/schemas";
import { authenticateDevice } from "@/lib/hrc/device-auth";
import { ingestEvents } from "@/lib/hrc/ingest";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/hrc/events — دستهٔ رویدادها، بدون تکرار.
 *
 * Idempotent through `clientEventId`: an offline phone can retry the same
 * queue as often as it likes and the command centre still sees one event.
 * SOS and falls are processed first within the batch.
 */
export const POST = route(async (req) => {
  const ctx = await authenticateDevice(req);
  const { events } = await body(req, EventBatch);
  const { results } = await ingestEvents(ctx, events);
  return {
    accepted: results.filter((r) => r.status === "stored").length,
    duplicates: results.filter((r) => r.status === "duplicate").length,
    results,
  };
});
