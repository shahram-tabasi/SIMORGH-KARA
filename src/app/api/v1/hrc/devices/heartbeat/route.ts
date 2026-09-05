import { route, body } from "@/lib/hrc/http";
import { HeartbeatRequest } from "@/lib/hrc/schemas";
import { authenticateDevice } from "@/lib/hrc/device-auth";
import { ingestHeartbeat } from "@/lib/hrc/ingest";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/hrc/devices/heartbeat — سلامت خودِ دستگاه.
 *
 * جدا از سلامت فرد: باتری تمام‌شده یا موقعیت‌یابیِ خاموش، مشکل فنی است نه
 * اورژانس پزشکی، و در مرکز فرماندهی در خط جداگانه‌ای دیده می‌شود.
 */
export const POST = route(async (req) => {
  const ctx = await authenticateDevice(req);
  const hb = await body(req, HeartbeatRequest);
  const { id, events } = await ingestHeartbeat(ctx, hb);
  return { id, eventsRaised: events, serverTime: new Date().toISOString() };
});
