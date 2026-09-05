import { route, body } from "@/lib/hrc/http";
import { HealthBatch } from "@/lib/hrc/schemas";
import { authenticateDevice } from "@/lib/hrc/device-auth";
import { ingestHealth } from "@/lib/hrc/ingest";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/hrc/health — سنجه‌های سلامت از ساعت.
 *
 * The rules engine runs here, so an abnormal reading becomes an event on the
 * server, not on the watch. Readings are never interpreted as a diagnosis.
 */
export const POST = route(async (req) => {
  const ctx = await authenticateDevice(req);
  const { readings } = await body(req, HealthBatch);
  const { results, events } = await ingestHealth(ctx, readings);
  return {
    accepted: results.filter((r) => r.status === "stored").length,
    eventsRaised: events,
    results,
  };
});
