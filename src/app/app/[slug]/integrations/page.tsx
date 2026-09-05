import { requireTenant, guardPanel } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { PERMISSIONS, isPermissionKey } from "@/lib/rbac";
import { hasModule } from "@/lib/modules";
import { ApiKeyForm } from "./ApiKeyForm";
import { toggleApiKeyAction, deleteApiKeyAction } from "./actions";

interface KeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  is_active: boolean;
  expires_at: string | null;
  last_used_at: string | null;
  call_count: string;
  creator: string | null;
  created_at: string;
}

async function load(schema: string) {
  return withTenant(schema, async (tx) =>
    tx<KeyRow[]>`
      SELECT k.id, k.name, k.prefix, k.scopes, k.is_active, k.expires_at::text,
             k.last_used_at::text, k.call_count, k.created_at::text,
             m.full_name AS creator
      FROM api_keys k
      LEFT JOIN members m ON m.id = k.created_by
      ORDER BY k.created_at DESC
    `
  );
}

/** The endpoints an external program can call, grouped by the panel they need. */
const ENDPOINTS: { module: string; method: string; path: string; scope: string; note: string }[] = [
  { module: "org", method: "GET", path: "/api/{slug}/v1/members", scope: "members.view", note: "فهرست اعضا و نقش‌ها" },
  { module: "hr", method: "GET", path: "/api/{slug}/v1/attendance?from=&to=", scope: "attendance.manage", note: "ترددهای بازهٔ زمانی" },
  { module: "finance", method: "GET", path: "/api/{slug}/v1/finance/accounts", scope: "ledger.view", note: "کدینگ حساب‌ها" },
  { module: "finance", method: "GET", path: "/api/{slug}/v1/finance/entries?status=posted", scope: "ledger.view", note: "اسناد حسابداری" },
  { module: "finance", method: "GET", path: "/api/{slug}/v1/finance/trial-balance", scope: "finance.reports.view", note: "تراز آزمایشی" },
  { module: "inventory", method: "GET", path: "/api/{slug}/v1/inventory/items", scope: "inventory.view", note: "فهرست کالاها" },
  { module: "inventory", method: "GET", path: "/api/{slug}/v1/inventory/stock", scope: "inventory.view", note: "موجودی هر کالا در هر انبار" },
  { module: "inventory", method: "POST", path: "/api/{slug}/v1/inventory/docs", scope: "inventory.receipt", note: "ثبت رسید/حواله به‌صورت پیش‌نویس" },
  { module: "hrc", method: "GET", path: "/api/{slug}/v1/hrc/positions", scope: "hrc.monitor", note: "آخرین موقعیت و علائم حیاتی نفرات" },
  { module: "hrc", method: "GET", path: "/api/{slug}/v1/hrc/alerts?status=open", scope: "hrc.monitor", note: "هشدارهای HRC" },
  { module: "hrc", method: "POST", path: "/api/{slug}/hrc/ingest", scope: "توکن دستگاه", note: "ارسال داده از ساعت هوشمند (بدون کلید API)" },
];

export default async function IntegrationsPage({
  params,
}: {
  params: { slug: string };
}) {
  const ctx = await requireTenant(params.slug);
  guardPanel(ctx, "api", "api.keys.manage");
  const keys = await load(ctx.company.schema);
  const endpoints = ENDPOINTS.filter((e) =>
    hasModule(ctx.company.modules, e.module as never)
  );

  return (
    <>
      <PageHeader
        title="درگاه API و یکپارچه‌سازی"
        description="اتصال نرم‌افزارهای دیگر شرکت به داده‌های همین پنل — با کلید و دسترسی محدود"
      />

      <div className="mb-6">
        <ApiKeyForm slug={params.slug} modules={ctx.company.modules} />
      </div>

      <div className="card mb-6 overflow-x-auto">
        <h3 className="mb-3 border-b border-slate-100 pb-2 text-sm font-semibold text-slate-700">
          کلیدهای فعلی
        </h3>
        {keys.length === 0 ? (
          <div className="py-4 text-center text-sm text-slate-400">
            هنوز کلیدی ساخته نشده است.
          </div>
        ) : (
          <table className="w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="text-right text-xs text-slate-400">
                <th className="pb-2">نام</th>
                <th className="pb-2">پیشوند</th>
                <th className="pb-2">دسترسی‌ها</th>
                <th className="pb-2">فراخوانی</th>
                <th className="pb-2">آخرین استفاده</th>
                <th className="pb-2">انقضا</th>
                <th className="pb-2">عملیات</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="border-t border-slate-100">
                  <td className="py-2">
                    {k.name}
                    {!k.is_active && (
                      <span className="badge mr-2 bg-red-100 text-red-700">غیرفعال</span>
                    )}
                    <div className="text-[11px] text-slate-400">
                      ساختهٔ {k.creator ?? "—"}
                    </div>
                  </td>
                  <td className="py-2 text-xs" dir="ltr">
                    {k.prefix}…
                  </td>
                  <td className="py-2">
                    <div className="flex max-w-xs flex-wrap gap-1">
                      {k.scopes.map((s) => (
                        <span key={s} className="badge bg-slate-100 text-slate-600">
                          {isPermissionKey(s) ? PERMISSIONS[s] : s}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-2" dir="ltr">
                    {k.call_count}
                  </td>
                  <td className="py-2 text-xs text-slate-500">
                    {k.last_used_at ? k.last_used_at.slice(0, 16).replace("T", " ") : "—"}
                  </td>
                  <td className="py-2 text-xs text-slate-500">
                    {k.expires_at ? k.expires_at.slice(0, 10) : "بدون انقضا"}
                  </td>
                  <td className="py-2">
                    <div className="flex items-center gap-2">
                      <form action={toggleApiKeyAction}>
                        <input type="hidden" name="slug" value={params.slug} />
                        <input type="hidden" name="keyId" value={k.id} />
                        <button className="text-xs text-brand-600 hover:underline">
                          {k.is_active ? "ابطال" : "فعال‌سازی"}
                        </button>
                      </form>
                      <form action={deleteApiKeyAction}>
                        <input type="hidden" name="slug" value={params.slug} />
                        <input type="hidden" name="keyId" value={k.id} />
                        <button className="text-xs text-red-600 hover:underline">حذف</button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card overflow-x-auto">
        <h3 className="mb-1 text-sm font-semibold text-slate-700">
          سرویس‌های در دسترس
        </h3>
        <p className="mb-3 border-b border-slate-100 pb-2 text-xs text-slate-400">
          کلید را در هدر بفرستید: <code dir="ltr">Authorization: Bearer &lt;api-key&gt;</code>{" "}
          یا <code dir="ltr">x-api-key</code>. پاسخ‌ها JSON هستند.
        </p>
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="text-right text-xs text-slate-400">
              <th className="pb-2">متد</th>
              <th className="pb-2">مسیر</th>
              <th className="pb-2">دسترسی لازم</th>
              <th className="pb-2">توضیح</th>
            </tr>
          </thead>
          <tbody>
            {endpoints.map((e) => (
              <tr key={`${e.method}:${e.path}`} className="border-t border-slate-100">
                <td className="py-2 text-xs font-semibold" dir="ltr">
                  {e.method}
                </td>
                <td className="py-2 text-xs" dir="ltr">
                  {e.path.replace("{slug}", params.slug)}
                </td>
                <td className="py-2 text-xs text-slate-500">
                  {isPermissionKey(e.scope) ? PERMISSIONS[e.scope] : e.scope}
                </td>
                <td className="py-2 text-xs text-slate-500">{e.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
