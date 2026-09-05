import { withTenant } from "@/lib/db";
import { route, body, notFound } from "@/lib/hrc/http";
import { ChallengeRequest } from "@/lib/hrc/schemas";
import { tenantBySlug, issueChallenge } from "@/lib/hrc/device-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/hrc/auth/challenge
 *
 * گام سه‌الف از تازه‌سازی: سرور یک nonce تصادفی یک‌بارمصرف می‌دهد. چیزی محرمانه
 * برنمی‌گردد، پس این مسیر احراز هویت لازم ندارد — امنیت در گام بعد است، جایی
 * که فقط دارندهٔ کلید خصوصیِ داخل Keystore می‌تواند nonce را امضا کند.
 */
export const POST = route(async (req) => {
  const input = await body(req, ChallengeRequest);
  const tenant = await tenantBySlug(input.slug);

  const device = await withTenant(tenant.schema, async (tx) => {
    const [d] = await tx<{ id: string; status: string }[]>`
      SELECT id, status FROM hrc_devices WHERE device_uid = ${input.deviceUid}
    `;
    return d ?? null;
  });
  if (!device || device.status !== "ACTIVE") throw notFound("دستگاه فعال یافت نشد");

  return issueChallenge(tenant, device.id);
});
