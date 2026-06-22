import { requireTenant } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";

async function getCounts(schema: string) {
  return withTenant(schema, async (tx) => {
    const [row] = await tx<
      { members: number; groups: number; roles: number; open_items: number }[]
    >`
      SELECT
        (SELECT count(*) FROM members)::int AS members,
        (SELECT count(*) FROM groups)::int AS groups,
        (SELECT count(*) FROM roles)::int AS roles,
        (SELECT count(*) FROM kartabl_items WHERE status IN ('open','in_progress'))::int AS open_items
    `;
    return row;
  });
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="card">
      <div className="text-3xl font-bold text-brand-700">
        {value.toLocaleString("fa-IR")}
      </div>
      <div className="mt-1 text-sm text-slate-500">{label}</div>
    </div>
  );
}

export default async function TenantDashboard({
  params,
}: {
  params: { slug: string };
}) {
  const ctx = await requireTenant(params.slug);
  const c = await getCounts(ctx.company.schema);

  return (
    <>
      <PageHeader
        title={`خوش آمدید، ${ctx.member.fullName}`}
        description={`داشبورد ${ctx.company.name}`}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="اعضا" value={c.members} />
        <Stat label="زیرگروه‌ها" value={c.groups} />
        <Stat label="نقش‌ها" value={c.roles} />
        <Stat label="کارهای باز کارتابل" value={c.open_items} />
      </div>
    </>
  );
}
