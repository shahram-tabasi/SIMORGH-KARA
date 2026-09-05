import { sql, withTenant } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { route, body, unauthorized, forbidden } from "@/lib/hrc/http";
import { TicketRequest } from "@/lib/hrc/schemas";
import { tenantBySlug, issueTicket } from "@/lib/hrc/device-auth";
import { effectivePermissions } from "@/lib/hrc/members";
import { clientIp, auditIn } from "@/lib/hrc/audit";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/hrc/auth/ticket
 *
 * گام یک از سه: کارمند در اپ، کد شرکت و ایمیل و رمز خودش را می‌زند و یک بلیت
 * ۱۰ دقیقه‌ای یک‌بارمصرف می‌گیرد. رمز عبور هرگز در دستگاه ذخیره نمی‌شود؛ فقط
 * همین بلیت به گام ثبت‌نام می‌رود.
 */
export const POST = route(async (req) => {
  const input = await body(req, TicketRequest);
  const tenant = await tenantBySlug(input.slug);

  const [account] = await sql<
    { id: string; password_hash: string; status: string; company_id: string | null }[]
  >`
    SELECT id, password_hash, status, company_id
    FROM platform.user_accounts WHERE email = ${input.email}
  `;
  // One generic failure for a wrong email and a wrong password alike, so this
  // endpoint cannot be used to discover who works at the company.
  const ok = account && (await verifyPassword(input.password, account.password_hash));
  if (!ok || account.status !== "active" || account.company_id !== tenant.companyId) {
    throw unauthorized("ایمیل یا رمز عبور درست نیست");
  }

  const member = await withTenant(tenant.schema, async (tx) => {
    const [m] = await tx<{ id: string; full_name: string; status: string }[]>`
      SELECT id, full_name, status FROM members WHERE account_id = ${account.id}
    `;
    if (!m || m.status !== "active") return null;
    const perms = await effectivePermissions(tx, m.id, tenant.modules);
    return { ...m, perms };
  });
  if (!member) throw unauthorized("این حساب عضو فعال این شرکت نیست");
  if (!member.perms.has("hrc.device.self")) {
    throw forbidden("اجازهٔ ثبت دستگاه ایمنی به شما داده نشده است");
  }

  const ticket = await issueTicket(tenant, member.id, clientIp(req));
  await withTenant(tenant.schema, (tx) =>
    auditIn(tx, {
      actorMemberId: member.id,
      action: "device.ticket.issued",
      subjectMemberId: member.id,
      ip: clientIp(req),
    })
  );

  return {
    ...ticket,
    company: { slug: tenant.slug, name: tenant.name },
    member: { id: member.id, name: member.full_name },
  };
});
