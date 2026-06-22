import { requireTenant } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { GroupForm } from "./GroupForm";
import { deleteGroupAction } from "../actions";

interface GroupRow {
  id: string;
  name: string;
  parent_id: string | null;
  member_count: number;
}

async function loadGroups(schema: string): Promise<GroupRow[]> {
  return withTenant(schema, async (tx) =>
    tx<GroupRow[]>`
      SELECT g.id, g.name, g.parent_id,
             (SELECT count(*) FROM member_groups mg WHERE mg.group_id = g.id)::int
               AS member_count
      FROM groups g
      ORDER BY g.name
    `
  );
}

function buildFlatLabels(groups: GroupRow[]): { id: string; label: string }[] {
  const byParent = new Map<string | null, GroupRow[]>();
  for (const g of groups) {
    const arr = byParent.get(g.parent_id) ?? [];
    arr.push(g);
    byParent.set(g.parent_id, arr);
  }
  const out: { id: string; label: string }[] = [];
  const walk = (parent: string | null, prefix: string) => {
    for (const g of byParent.get(parent) ?? []) {
      out.push({ id: g.id, label: prefix + g.name });
      walk(g.id, prefix + "— ");
    }
  };
  walk(null, "");
  return out;
}

function GroupTree({
  groups,
  parent,
  slug,
  canManage,
  depth = 0,
}: {
  groups: GroupRow[];
  parent: string | null;
  slug: string;
  canManage: boolean;
  depth?: number;
}) {
  const children = groups.filter((g) => g.parent_id === parent);
  if (children.length === 0) return null;
  return (
    <ul className={depth === 0 ? "space-y-2" : "mr-5 mt-2 space-y-2 border-r border-slate-200 pr-3"}>
      {children.map((g) => (
        <li key={g.id}>
          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
            <span className="text-sm text-slate-700">
              {g.name}
              <span className="mr-2 text-xs text-slate-400">
                ({g.member_count.toLocaleString("fa-IR")} عضو)
              </span>
            </span>
            {canManage && (
              <form action={deleteGroupAction}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="groupId" value={g.id} />
                <button className="text-xs text-red-600 hover:underline">حذف</button>
              </form>
            )}
          </div>
          <GroupTree
            groups={groups}
            parent={g.id}
            slug={slug}
            canManage={canManage}
            depth={depth + 1}
          />
        </li>
      ))}
    </ul>
  );
}

export default async function GroupsPage({
  params,
}: {
  params: { slug: string };
}) {
  const ctx = await requireTenant(params.slug);
  const canManage = ctx.member.permissions.has("groups.manage");
  const groups = await loadGroups(ctx.company.schema);

  return (
    <>
      <PageHeader
        title="زیرگروه‌ها"
        description="ساختار سازمانی شرکت به‌صورت درختی (واحدها و زیرواحدها)"
      />

      {canManage && (
        <div className="mb-6">
          <GroupForm slug={params.slug} groups={buildFlatLabels(groups)} />
        </div>
      )}

      <div className="card">
        {groups.length === 0 ? (
          <div className="text-center text-sm text-slate-500">
            هنوز زیرگروهی تعریف نشده است.
          </div>
        ) : (
          <GroupTree
            groups={groups}
            parent={null}
            slug={params.slug}
            canManage={canManage}
          />
        )}
      </div>
    </>
  );
}
