import { withTenant } from "@/lib/db";
import { route, body, unauthorized, notFound } from "@/lib/hrc/http";
import { RefreshRequest } from "@/lib/hrc/schemas";
import {
  tenantBySlug,
  redeemChallenge,
  verifySignature,
  signDeviceToken,
} from "@/lib/hrc/device-auth";
import { clientIp, auditIn } from "@/lib/hrc/audit";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/hrc/auth/refresh
 *
 * گام سه‌ب: امضای nonce با کلید Keystore. چون سرور فقط کلید عمومی را دارد، حتی
 * دزدیدن کل دیتابیس هم اجازهٔ جعل دستگاه نمی‌دهد؛ و چون هر nonce یک‌بارمصرف
 * است، امضای شنودشده دوباره کار نمی‌کند.
 */
export const POST = route(async (req) => {
  const input = await body(req, RefreshRequest);
  const tenant = await tenantBySlug(input.slug);

  const result = await withTenant(tenant.schema, async (tx) => {
    const [d] = await tx<
      {
        id: string;
        member_id: string | null;
        status: string;
        public_key: string | null;
        key_algorithm: string | null;
        token_version: number;
      }[]
    >`
      SELECT id, member_id, status, public_key, key_algorithm, token_version
      FROM hrc_devices WHERE device_uid = ${input.deviceUid}
    `;
    if (!d) throw notFound("دستگاه یافت نشد");
    if (d.status !== "ACTIVE") throw unauthorized("این دستگاه غیرفعال شده است");
    if (!d.public_key) throw unauthorized("این دستگاه کلید عمومی ثبت‌شده ندارد");

    // Consume the nonce *before* checking the signature, so a wrong signature
    // still burns the challenge and cannot be brute-forced against it.
    await redeemChallenge(tx, d.id, input.nonce);

    if (!verifySignature(d.public_key, d.key_algorithm, input.nonce, input.signature)) {
      await auditIn(tx, {
        actorMemberId: d.member_id,
        action: "device.refresh.rejected",
        resource: "hrc_devices",
        resourceId: d.id,
        ip: clientIp(req),
      });
      throw unauthorized("امضای دستگاه معتبر نیست");
    }

    const [assignment] = await tx<{ member_id: string }[]>`
      SELECT member_id FROM hrc_device_assignments
      WHERE device_id = ${d.id} AND unassigned_at IS NULL
      ORDER BY assigned_at DESC LIMIT 1
    `;
    const memberId = assignment?.member_id ?? d.member_id;
    if (!memberId) throw unauthorized("این دستگاه به هیچ کارمندی تخصیص ندارد");

    await auditIn(tx, {
      actorMemberId: memberId,
      action: "device.refresh",
      resource: "hrc_devices",
      resourceId: d.id,
      subjectMemberId: memberId,
      ip: clientIp(req),
    });
    return { deviceId: d.id, memberId, version: d.token_version };
  });

  const token = await signDeviceToken({
    sub: result.memberId,
    did: result.deviceId,
    aud: input.deviceUid,
    tenant: tenant.companyId,
    ver: result.version,
  });
  return { token, deviceId: result.deviceId, expiresInDays: 30 };
});
