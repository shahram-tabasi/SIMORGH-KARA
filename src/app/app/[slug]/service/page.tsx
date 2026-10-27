import { PageHeader } from "@/components/Shell";
import { karaApiEnabled } from "@/lib/kara-api";
import { requireTenant } from "@/lib/session";
import { listServiceOrders } from "./actions";
import { ServiceReports } from "./ServiceReports";

export const dynamic = "force-dynamic";

/** Field service on site: the engineer's own orders first, the report and the customer's signature, then the order is completed in Odoo. */
export default async function ServicePage({ params, searchParams }: { params: { slug: string }; searchParams: { closed?: string } }) {
  const ctx = await requireTenant(params.slug);
  const header = <PageHeader title="گزارش خدمات در محل" description="سفارش‌های خدمات میدانی: شرح کار انجام‌شده و امضای مشتری، ثبت مستقیم در Odoo" />;
  const notice = (t: string) => <>{header}<div className="card text-sm text-slate-600 dark:text-slate-300">{t}</div></>;
  if (!ctx.member.permissions.has("service.report")) return notice("برای این بخش مجوز «گزارش خدمات در محل» لازم است.");
  if (!karaApiEnabled()) return notice("اتصال به Odoo در این نصب پیکربندی نشده است.");

  const closed = searchParams.closed === "1";
  const list = await listServiceOrders(params.slug, closed);
  if (!list.ok) return notice(list.error);
  return (
    <>
      {header}
      <ServiceReports slug={params.slug} initial={list.data.items} mine={list.data.mine} closed={closed} />
    </>
  );
}
