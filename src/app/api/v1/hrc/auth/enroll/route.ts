import { withTenant } from "@/lib/db";
import { route, body, badRequest } from "@/lib/hrc/http";
import { EnrollRequest } from "@/lib/hrc/schemas";
import {
  tenantBySlug,
  splitTicket,
  redeemTicket,
  signDeviceToken,
} from "@/lib/hrc/device-auth";
import { clientIp, auditIn } from "@/lib/hrc/audit";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/hrc/auth/enroll
 *
 * گام دو: اپ کلید را در Android Keystore می‌سازد و فقط نیمهٔ عمومی را با بلیت
 * می‌فرستد. سرور دستگاه را ثبت و به کارمند تخصیص می‌دهد و توکن ۳۰ روزه می‌دهد.
 *
 * Re-enrolling the same `deviceUid` (app reinstalled, key regenerated) updates
 * the existing row and bumps `token_version`, so the tokens the old install
 * still holds stop working immediately.
 */
export const POST = route(async (req) => {
  const input = await body(req, EnrollRequest);
  const tenant = await tenantBySlug(splitTicket(input.ticket).slug);
  const d = input.device;

  const result = await withTenant(tenant.schema, async (tx) => {
    const { memberId, ticketId } = await redeemTicket(tx, input.ticket);

    let gatewayId: string | null = null;
    if (d.gatewayDeviceUid) {
      const [g] = await tx<{ id: string }[]>`
        SELECT id FROM hrc_devices WHERE device_uid = ${d.gatewayDeviceUid}
      `;
      if (!g) throw badRequest("دستگاه واسط (گوشی) با این شناسه ثبت نشده است");
      gatewayId = g.id;
    }

    // `serial` and `token` are v1 NOT NULL columns still on the table; they are
    // filled with the same uid and an unusable placeholder so the v1 ingest
    // path can never be entered with a v2 device's credentials.
    const [device] = await tx<{ id: string; token_version: number }[]>`
      INSERT INTO hrc_devices
        (serial, token, model, kind, device_uid, device_type, manufacturer,
         os_version, app_version, capabilities, public_key, key_algorithm,
         status, gateway_device_id, network, enrolled_at, is_active)
      VALUES
        (${d.deviceUid}, ${"v2:" + d.deviceUid}, ${d.model ?? null},
         ${d.deviceType === "ANDROID_PHONE" ? "phone" : d.deviceType === "BLE_TAG" ? "tag" : "watch"},
         ${d.deviceUid}, ${d.deviceType}, ${d.manufacturer ?? null},
         ${d.osVersion ?? null}, ${d.appVersion ?? null},
         ${tx.json(d.capabilities as never)}, ${d.publicKey}, ${d.keyAlgorithm},
         'ACTIVE', ${gatewayId}, ${d.network ?? null}, now(), true)
      ON CONFLICT (serial) DO UPDATE SET
        device_uid = EXCLUDED.device_uid,
        device_type = EXCLUDED.device_type,
        manufacturer = EXCLUDED.manufacturer,
        model = EXCLUDED.model,
        os_version = EXCLUDED.os_version,
        app_version = EXCLUDED.app_version,
        capabilities = EXCLUDED.capabilities,
        public_key = EXCLUDED.public_key,
        key_algorithm = EXCLUDED.key_algorithm,
        gateway_device_id = EXCLUDED.gateway_device_id,
        network = EXCLUDED.network,
        status = 'ACTIVE',
        is_active = true,
        enrolled_at = now(),
        token_version = hrc_devices.token_version + 1
      RETURNING id, token_version
    `;

    // v1 kept the assignment in a column; v2 keeps a history. Both are updated
    // so the existing screens keep showing the right person.
    await tx`
      UPDATE hrc_device_assignments SET unassigned_at = now()
      WHERE device_id = ${device.id} AND unassigned_at IS NULL AND member_id <> ${memberId}
    `;
    await tx`
      INSERT INTO hrc_device_assignments (device_id, member_id, priority)
      SELECT ${device.id}, ${memberId}, 'PRIMARY'
      WHERE NOT EXISTS (
        SELECT 1 FROM hrc_device_assignments
        WHERE device_id = ${device.id} AND unassigned_at IS NULL)
    `;
    await tx`UPDATE hrc_devices SET member_id = ${memberId} WHERE id = ${device.id}`;
    await tx`UPDATE hrc_enrolment_tickets SET device_id = ${device.id} WHERE id = ${ticketId}`;

    await auditIn(tx, {
      actorMemberId: memberId,
      action: "device.enrolled",
      resource: "hrc_devices",
      resourceId: device.id,
      subjectMemberId: memberId,
      ip: clientIp(req),
      meta: { deviceUid: d.deviceUid, deviceType: d.deviceType },
    });

    return { deviceId: device.id, memberId, version: device.token_version };
  });

  const token = await signDeviceToken({
    sub: result.memberId,
    did: result.deviceId,
    aud: d.deviceUid,
    tenant: tenant.companyId,
    ver: result.version,
  });

  return {
    token,
    deviceId: result.deviceId,
    expiresInDays: 30,
    company: { slug: tenant.slug, name: tenant.name },
  };
});
