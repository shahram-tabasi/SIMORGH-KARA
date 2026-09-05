import "server-only";
import type { TransactionSql } from "postgres";
import { filterByModules } from "@/lib/rbac";
import type { ModuleKey } from "@/lib/modules";

/**
 * محاسبهٔ دسترسی مؤثر یک عضو — همان فرمول «جز به جز» سامانه:
 *
 *   (اجتماع نقش‌ها + grantها − denyها) ∩ کلیدهای پنل‌های فعال شرکت
 *
 * `requireTenant` همین را برای نشست مرورگر انجام می‌دهد؛ اینجا برای مسیرهایی
 * است که کوکی ندارند (ورود از اپ موبایل) تا دو پیاده‌سازی از هم جدا نیفتند.
 */
export async function effectivePermissions(
  tx: TransactionSql,
  memberId: string,
  modules: readonly ModuleKey[] | readonly string[]
): Promise<Set<string>> {
  const [roles, overrides] = await Promise.all([
    tx<{ permission_key: string }[]>`
      SELECT DISTINCT rp.permission_key
      FROM member_roles mr
      JOIN role_permissions rp ON rp.role_id = mr.role_id
      WHERE mr.member_id = ${memberId}
    `,
    tx<{ permission_key: string; effect: string }[]>`
      SELECT permission_key, effect FROM member_permissions WHERE member_id = ${memberId}
    `,
  ]);
  const granted = new Set(roles.map((r) => r.permission_key));
  for (const o of overrides) {
    if (o.effect === "grant") granted.add(o.permission_key);
    else granted.delete(o.permission_key);
  }
  return filterByModules(granted, modules as readonly string[]);
}
