import { requireTenant } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { ToggleForm } from "@/components/ToggleForm";
import { MemberForm } from "./MemberForm";
import { toggleMemberRoleAction, toggleMemberGroupAction } from "../actions";

interface MemberRow {
  id: string;
  full_name: string;
  title: string | null;
  status: string;
  email: string;
}

async function loadData(schema: string) {
  return withTenant(schema, async (tx) => {
    const members = await tx<MemberRow[]>`
      SELECT m.id, m.full_name, m.title, m.status, ua.email
      FROM members m
      JOIN platform.user_accounts ua ON ua.id = m.account_id
      ORDER BY m.created_at
    `;
    const roles = await tx<{ id: string; name: string }[]>`
      SELECT id, name FROM roles ORDER BY name
    `;
    const groups = await tx<{ id: string; name: string }[]>`
      SELECT id, name FROM groups ORDER BY name
    `;
    const memberRoles = await tx<{ member_id: string; role_id: string }[]>`
      SELECT member_id, role_id FROM member_roles
    `;
    const memberGroups = await tx<{ member_id: string; group_id: string }[]>`
      SELECT member_id, group_id FROM member_groups
    `;
    return { members, roles, groups, memberRoles, memberGroups };
  });
}

export default async function MembersPage({
  params,
}: {
  params: { slug: string };
}) {
  const ctx = await requireTenant(params.slug);
  const canManage = ctx.member.permissions.has("members.manage");
  const { members, roles, groups, memberRoles, memberGroups } = await loadData(
    ctx.company.schema
  );

  const roleSet = new Set(memberRoles.map((r) => `${r.member_id}:${r.role_id}`));
  const groupSet = new Set(
    memberGroups.map((g) => `${g.member_id}:${g.group_id}`)
  );

  return (
    <>
      <PageHeader
        title="اعضا و سطوح دسترسی"
        description="افزودن کاربر، تخصیص نقش‌ها و قرار دادن در زیرگروه‌ها"
      />

      {canManage && (
        <div className="mb-6">
          <MemberForm slug={params.slug} />
        </div>
      )}

      <div className="space-y-4">
        {members.map((m) => (
          <div key={m.id} className="card">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-slate-800">{m.full_name}</div>
                <div className="text-xs text-slate-400" dir="ltr">
                  {m.email}
                  {m.title ? ` · ${m.title}` : ""}
                </div>
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-1.5 text-xs font-medium text-slate-500">
                نقش‌ها
              </div>
              <div className="flex flex-wrap gap-2">
                {roles.map((r) =>
                  canManage ? (
                    <ToggleForm
                      key={r.id}
                      action={toggleMemberRoleAction}
                      hidden={{ slug: params.slug, memberId: m.id, roleId: r.id }}
                      checked={roleSet.has(`${m.id}:${r.id}`)}
                      label={r.name}
                    />
                  ) : (
                    roleSet.has(`${m.id}:${r.id}`) && (
                      <span key={r.id} className="badge bg-brand-50 text-brand-700">
                        {r.name}
                      </span>
                    )
                  )
                )}
              </div>
            </div>

            {groups.length > 0 && (
              <div className="mt-4">
                <div className="mb-1.5 text-xs font-medium text-slate-500">
                  زیرگروه‌ها
                </div>
                <div className="flex flex-wrap gap-2">
                  {groups.map((g) =>
                    canManage ? (
                      <ToggleForm
                        key={g.id}
                        action={toggleMemberGroupAction}
                        hidden={{ slug: params.slug, memberId: m.id, groupId: g.id }}
                        checked={groupSet.has(`${m.id}:${g.id}`)}
                        label={g.name}
                      />
                    ) : (
                      groupSet.has(`${m.id}:${g.id}`) && (
                        <span key={g.id} className="badge bg-slate-100 text-slate-600">
                          {g.name}
                        </span>
                      )
                    )
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
