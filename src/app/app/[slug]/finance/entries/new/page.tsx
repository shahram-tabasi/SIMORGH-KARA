import { requireTenant, guardPanel } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { EntryForm } from "../EntryForm";

async function load(schema: string) {
  return withTenant(schema, async (tx) => {
    const accounts = await tx<{ id: string; code: string; name: string }[]>`
      SELECT id, code, name FROM ledger_accounts
      WHERE is_active = true AND is_group = false
      ORDER BY code
    `;
    const parties = await tx<{ id: string; code: string; name: string }[]>`
      SELECT id, code, name FROM parties WHERE is_active = true ORDER BY name
    `;
    const costCenters = await tx<{ id: string; code: string; name: string }[]>`
      SELECT id, code, name FROM cost_centers WHERE is_active = true ORDER BY code
    `;
    return { accounts, parties, costCenters };
  });
}

export default async function NewEntryPage({
  params,
}: {
  params: { slug: string };
}) {
  const ctx = await requireTenant(params.slug);
  guardPanel(ctx, "finance", "ledger.manage");
  const { accounts, parties, costCenters } = await load(ctx.company.schema);

  return (
    <>
      <PageHeader
        title="سند حسابداری جدید"
        description="سند به‌صورت پیش‌نویس ثبت می‌شود؛ قطعی‌کردن آن مجوز جداگانه دارد"
      />
      {accounts.length === 0 ? (
        <div className="card text-sm text-slate-500">
          ابتدا در «کدینگ حساب‌ها» حداقل دو حساب قابل ثبت تعریف کنید.
        </div>
      ) : (
        <EntryForm
          slug={params.slug}
          accounts={accounts}
          parties={parties}
          costCenters={costCenters}
        />
      )}
    </>
  );
}
