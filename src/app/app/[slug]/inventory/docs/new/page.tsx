import { requireTenant, ensureModule, ensurePermission } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { DOC_PERMISSION, DOC_KINDS } from "@/lib/inventory";
import { hasModule } from "@/lib/session";
import { DocForm } from "../DocForm";

async function load(schema: string, withParties: boolean) {
  return withTenant(schema, async (tx) => {
    const warehouses = await tx<{ id: string; name: string }[]>`
      SELECT id, name FROM warehouses WHERE is_active = true ORDER BY code
    `;
    const items = await tx<
      { id: string; code: string; name: string; unit: string; last_price: string }[]
    >`
      SELECT id, code, name, unit, last_price FROM items
      WHERE is_active = true ORDER BY code
    `;
    const members = await tx<{ id: string; full_name: string }[]>`
      SELECT id, full_name FROM members WHERE status = 'active' ORDER BY full_name
    `;
    const parties = withParties
      ? await tx<{ id: string; name: string }[]>`
          SELECT id, name FROM parties WHERE is_active = true ORDER BY name
        `
      : [];
    return { warehouses, items, members, parties };
  });
}

export default async function NewStockDocPage({
  params,
}: {
  params: { slug: string };
}) {
  const ctx = await requireTenant(params.slug);
  ensureModule(ctx, "inventory");
  ensurePermission(ctx, "inventory.view");

  // Only offer the document kinds this person actually holds the key for.
  const kinds = (Object.keys(DOC_KINDS) as (keyof typeof DOC_KINDS)[]).filter((k) =>
    ctx.member.permissions.has(DOC_PERMISSION[k])
  );

  const { warehouses, items, members, parties } = await load(
    ctx.company.schema,
    hasModule(ctx, "finance")
  );

  return (
    <>
      <PageHeader
        title="سند انبار جدید"
        description="سند ابتدا پیش‌نویس ثبت می‌شود؛ با تأیید، موجودی تغییر می‌کند و در صورت فعال‌بودن پنل مالی، سند حسابداری هم صادر می‌شود"
      />
      {kinds.length === 0 ? (
        <div className="card text-sm text-slate-500">
          شما مجوز ثبت هیچ نوع سند انباری ندارید.
        </div>
      ) : warehouses.length === 0 || items.length === 0 ? (
        <div className="card text-sm text-slate-500">
          ابتدا حداقل یک انبار و یک کالا تعریف کنید.
        </div>
      ) : (
        <DocForm
          slug={params.slug}
          kinds={kinds}
          warehouses={warehouses}
          items={items}
          parties={parties}
          members={members}
        />
      )}
    </>
  );
}
