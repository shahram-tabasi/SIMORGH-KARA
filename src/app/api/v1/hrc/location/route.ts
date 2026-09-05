import { route, body } from "@/lib/hrc/http";
import { LocationBatch } from "@/lib/hrc/schemas";
import { authenticateDevice } from "@/lib/hrc/device-auth";
import { ingestLocations } from "@/lib/hrc/ingest";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/hrc/location — دستهٔ موقعیت‌ها (حداکثر ۲۰۰ تا).
 *
 * Partially successful by design: each fix reports its own outcome, so a phone
 * that queued fixes across a shift boundary learns exactly which ones policy
 * refused instead of retrying the whole batch forever.
 */
export const POST = route(async (req) => {
  const ctx = await authenticateDevice(req);
  const { fixes } = await body(req, LocationBatch);
  const { results, events } = await ingestLocations(ctx, fixes);
  return {
    accepted: results.filter((r) => r.status === "stored").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    rejected: results.filter((r) => r.status === "rejected").length,
    eventsRaised: events,
    results,
  };
});
