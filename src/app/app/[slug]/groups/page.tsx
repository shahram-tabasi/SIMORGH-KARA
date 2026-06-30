import { requireTenant } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { GroupForm } from "./GroupForm";
import { type ScheduleOption } from "./GroupScheduleSelect";
import { GroupCard, type MemberLite } from "./GroupCard";

interface GroupRow {
  id: string;
  name: string;
  parent_id: string | null;
  member_count: number;
  schedule_id: string | null;
  manager_id: string | null;
}

interface GroupData {
  groups: GroupRow[];
  schedules: ScheduleOption[];
  allMembers: MemberLite[];
  membersByGroup: Map<string, MemberLite[]>;
}

async function loadGroups(schema: string): Promise<GroupData> {
  return withTenant(schema, async (tx) => {
    const groups = await tx<GroupRow[]>`
      SELECT g.id, g.name, g.parent_id, g.schedule_id, g.manager_id,
             (SELECT count(*) FROM member_groups mg WHERE mg.group_id = g.id)::int
               AS member_count
      FROM groups g
      ORDER BY g.name
    `;
    const schedules = await tx<ScheduleOption[]>`
      SELECT id, name FROM work_schedules ORDER BY is_default DESC, name
    `;
    const allMembers = await tx<MemberLite[]>`
      SELECT id, full_name FROM members WHERE status = 'active' ORDER BY full_name
    `;
    const links = await tx<{ group_id: string; id: string; full_name: string }[]>`
      SELECT mg.group_id, m.id, m.full_name
      FROM member_groups mg JOIN members m ON m.id = mg.member_id
      ORDER BY m.full_name
    `;
    const membersByGroup = new Map<string, MemberLite[]>();
    for (const l of links) {
      const arr = membersByGroup.get(l.group_id) ?? [];
      arr.push({ id: l.id, full_name: l.full_name });
      membersByGroup.set(l.group_id, arr);
    }
    return { groups, schedules, allMembers, membersByGroup };
  });
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
  data,
  parent,
  slug,
  canManage,
  depth = 0,
}: {
  data: GroupData;
  parent: string | null;
  slug: string;
  canManage: boolean;
  depth?: number;
}) {
  const children = data.groups.filter((g) => g.parent_id === parent);
  if (children.length === 0) return null;
  return (
    <ul className={depth === 0 ? "space-y-2" : "mr-5 mt-2 space-y-2 border-r border-slate-200 pr-3 dark:border-white/10"}>
      {children.map((g) => (
        <li key={g.id}>
          <GroupCard
            slug={slug}
            group={g}
            members={data.membersByGroup.get(g.id) ?? []}
            allMembers={data.allMembers}
            schedules={data.schedules}
            canManage={canManage}
          />
          <GroupTree data={data} parent={g.id} slug={slug} canManage={canManage} depth={depth + 1} />
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
  const data = await loadGroups(ctx.company.schema);

  return (
    <>
      <PageHeader
        title="زیرگروه‌ها"
        description="ساختار سازمانی — برای هر گروه می‌توانید عضو، مدیر و ساعت کاری تعیین کنید"
      />

      {canManage && (
        <div className="mb-6">
          <GroupForm slug={params.slug} groups={buildFlatLabels(data.groups)} />
        </div>
      )}

      {canManage && (
        <div className="mb-4 rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-xs text-brand-700 dark:border-brand-500/20 dark:bg-brand-500/10 dark:text-brand-200">
          💡 روی هر گروه دوبار کلیک کنید (یا دکمهٔ «اعضا و مدیر») تا عضو اضافه کنید و مدیر آن را تعیین کنید.
        </div>
      )}

      <div className="card">
        {data.groups.length === 0 ? (
          <div className="text-center text-sm text-slate-500">
            هنوز زیرگروهی تعریف نشده است.
          </div>
        ) : (
          <GroupTree data={data} parent={null} slug={params.slug} canManage={canManage} />
        )}
      </div>
    </>
  );
}
