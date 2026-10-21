import Link from "next/link";
import { PageHeader } from "@/components/Shell";
import { KaraApiError, karaApi, karaApiEnabled } from "@/lib/kara-api";
import { requireTenant } from "@/lib/session";
import { ErpCreateForm } from "./ErpCreateForm";

export const dynamic = "force-dynamic";

type Rec = Record<string, unknown> & { id: number };
type Ref = { id: number; name: string } | null;

const TABS = [
  { key: "partners", label: "طرف‌حساب‌ها" },
  { key: "products", label: "کالا و خدمات" },
  { key: "employees", label: "کارکنان" },
  { key: "sale-orders", label: "سفارش‌های فروش" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const PAGE = 25;
const name = (r: Ref) => r?.name ?? "—";
const str = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
const money = (v: unknown) => (typeof v === "number" ? v.toLocaleString("fa-IR") : "—");

const COLUMNS: Record<Tab, { head: string; cell: (r: Rec) => string; ltr?: boolean }[]> = {
  partners: [
    { head: "نام", cell: (r) => str(r.name) },
    { head: "ایمیل", cell: (r) => str(r.email), ltr: true },
    { head: "تلفن", cell: (r) => str(r.phone), ltr: true },
    { head: "شناسه مالیاتی", cell: (r) => str(r.vat), ltr: true },
    { head: "شهر", cell: (r) => str((r.address as { city?: string } | undefined)?.city) },
  ],
  products: [
    { head: "نام", cell: (r) => str(r.name) },
    { head: "کد", cell: (r) => str(r.code), ltr: true },
    { head: "نوع", cell: (r) => ({ goods: "کالا", service: "خدمت", combo: "ترکیبی" } as Record<string, string>)[String(r.type)] ?? str(r.type) },
    { head: "قیمت فروش", cell: (r) => money(r.listPrice) },
    { head: "واحد", cell: (r) => name(r.uom as Ref) },
  ],
  employees: [
    { head: "نام", cell: (r) => str(r.name) },
    { head: "سمت", cell: (r) => str(r.jobTitle) },
    { head: "واحد", cell: (r) => name(r.department as Ref) },
    { head: "مدیر", cell: (r) => name(r.manager as Ref) },
    { head: "ایمیل کاری", cell: (r) => str(r.workEmail), ltr: true },
  ],
  "sale-orders": [
    { head: "شماره", cell: (r) => str(r.number), ltr: true },
    { head: "مشتری", cell: (r) => name(r.customer as Ref) },
    { head: "وضعیت", cell: (r) => ({ draft: "پیش‌فاکتور", sent: "ارسال‌شده", sale: "سفارش", cancel: "لغو" } as Record<string, string>)[String(r.state)] ?? str(r.state) },
    { head: "مبلغ کل", cell: (r) => money(r.amountTotal) },
    { head: "تاریخ", cell: (r) => (r.orderDate ? new Date(String(r.orderDate)).toLocaleDateString("fa-IR") : "—") },
  ],
};

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="card text-sm text-slate-600 dark:text-slate-300">{children}</div>;
}

/**
 * The tenant's data from Odoo (its company), read from kara-api's read model:
 * lists and search never wait on Odoo. Creating goes through the connector.
 */
export default async function ErpPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { tab?: string; q?: string; page?: string };
}) {
  const ctx = await requireTenant(params.slug);
  const base = `/app/${params.slug}/erp`;
  const header = <PageHeader title="داده‌های سازمان (Odoo)" description="طرف‌حساب‌ها، کالاها، کارکنان و سفارش‌ها — همان داده‌های Odoo برای شرکت شما" />;

  if (!ctx.member.permissions.has("erp.view")) {
    return <>{header}<Notice>برای دیدن این بخش مجوز «مشاهده داده‌های Odoo» لازم است.</Notice></>;
  }
  if (!karaApiEnabled()) {
    return <>{header}<Notice>اتصال به Odoo در این نصب پیکربندی نشده است.</Notice></>;
  }

  const tab: Tab = (TABS.find((t) => t.key === searchParams.tab)?.key ?? "partners") as Tab;
  const q = (searchParams.q ?? "").trim().slice(0, 100);
  const page = Math.max(1, Number(searchParams.page) || 1);

  let status: { linked: boolean; counts?: Record<string, number> };
  let list: { total: number; items: Rec[] } | undefined;
  try {
    status = await karaApi(ctx.session.sub, "GET", `/v1/tenants/${params.slug}/erp`);
    if (status.linked) {
      const qs = new URLSearchParams({ limit: String(PAGE), offset: String((page - 1) * PAGE), ...(q ? { q } : {}) });
      list = await karaApi(ctx.session.sub, "GET", `/v1/tenants/${params.slug}/erp/${tab}?${qs}`);
    }
  } catch (e) {
    const msg = e instanceof KaraApiError ? e.message : "خطای ناشناخته";
    return <>{header}<Notice>دریافت داده‌ها ممکن نشد: {msg}</Notice></>;
  }

  if (!status.linked) {
    return <>{header}<Notice>این شرکت هنوز به یک شرکت در Odoo متصل نشده است. مدیر سامانهٔ سیمرغ‌کارا این اتصال را در بخش «شرکت‌ها» برقرار می‌کند.</Notice></>;
  }

  const pages = Math.max(1, Math.ceil((list?.total ?? 0) / PAGE));
  const href = (p: Partial<{ tab: string; q: string; page: number }>) => {
    const s = new URLSearchParams();
    s.set("tab", p.tab ?? tab);
    const qq = p.q ?? q;
    if (qq) s.set("q", qq);
    if (p.page && p.page > 1) s.set("page", String(p.page));
    return `${base}?${s}`;
  };
  const canCreate = ctx.member.permissions.has("erp.manage") && (tab === "partners" || tab === "products");

  return (
    <>
      {header}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={href({ tab: t.key, q: "", page: 1 })}
            className={`rounded-lg px-3 py-1.5 text-sm ${t.key === tab ? "bg-brand-600 text-white" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"}`}
          >
            {t.label}
            <span className="mr-1.5 text-xs opacity-70">{(status.counts?.[t.key] ?? 0).toLocaleString("fa-IR")}</span>
          </Link>
        ))}
      </div>

      <form method="get" action={base} className="mb-4 flex gap-2">
        <input type="hidden" name="tab" value={tab} />
        <input name="q" defaultValue={q} placeholder="جستجو در نام، ایمیل، کد…" className="input max-w-sm" />
        <button type="submit" className="btn-ghost">جستجو</button>
      </form>

      {canCreate && <ErpCreateForm slug={params.slug} kind={tab as "partners" | "products"} />}

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <tr>
              {COLUMNS[tab].map((c) => (
                <th key={c.head} className="px-3 py-2 text-right font-medium">{c.head}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list?.items.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 dark:border-slate-700">
                {COLUMNS[tab].map((c) => (
                  <td key={c.head} className="px-3 py-2 text-slate-700 dark:text-slate-200" dir={c.ltr ? "ltr" : undefined}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
            {!list?.items.length && (
              <tr>
                <td colSpan={COLUMNS[tab].length} className="px-3 py-6 text-center text-slate-500">
                  {q ? "موردی با این جستجو پیدا نشد." : "هنوز موردی ثبت نشده است."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="mt-3 flex items-center justify-between text-sm text-slate-600 dark:text-slate-300">
          <span>صفحهٔ {page.toLocaleString("fa-IR")} از {pages.toLocaleString("fa-IR")}</span>
          <div className="flex gap-2">
            {page > 1 && <Link className="btn-ghost" href={href({ page: page - 1 })}>قبلی</Link>}
            {page < pages && <Link className="btn-ghost" href={href({ page: page + 1 })}>بعدی</Link>}
          </div>
        </div>
      )}
    </>
  );
}
