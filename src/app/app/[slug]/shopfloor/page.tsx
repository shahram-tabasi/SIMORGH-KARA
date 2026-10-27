import { PageHeader } from "@/components/Shell";
import { karaApiEnabled } from "@/lib/kara-api";
import { requireTenant } from "@/lib/session";
import { listWorkOrders } from "./actions";
import { ShopFloor } from "./ShopFloor";

export const dynamic = "force-dynamic";

/**
 * The shop floor on a phone or tablet: open work orders of the company's
 * Odoo, by work centre or by a scanned barcode; start, pause and finish,
 * the actual quantity of a component, scrap with its reason. Odoo records
 * who did it (the Kara person).
 */
export default async function ShopFloorPage({ params, searchParams }: { params: { slug: string }; searchParams: { wc?: string; q?: string } }) {
  const ctx = await requireTenant(params.slug);
  const header = <PageHeader title="کارگاه" description="سفارش‌های کار باز: شروع، توقف و پایان کار، ثبت مصرف واقعی و ضایعات — مستقیم در Odoo" />;
  const notice = (t: string) => <>{header}<div className="card text-sm text-slate-600 dark:text-slate-300">{t}</div></>;
  if (!ctx.member.permissions.has("shopfloor.use")) return notice("برای این بخش مجوز «کار در کارگاه» لازم است.");
  if (!karaApiEnabled()) return notice("اتصال به Odoo در این نصب پیکربندی نشده است.");

  const wc = Number(searchParams.wc) || undefined;
  const first = await listWorkOrders(params.slug, wc, searchParams.q);
  if (!first.ok) return notice(first.error);
  return (
    <>
      {header}
      <ShopFloor slug={params.slug} initial={first.data} workcenterId={wc} query={searchParams.q ?? ""} />
    </>
  );
}
