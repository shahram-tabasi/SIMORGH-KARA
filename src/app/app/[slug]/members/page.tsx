import { requireTenant } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { ToggleForm } from "@/components/ToggleForm";
import { MemberForm } from "./MemberForm";
import { ScheduleSelect } from "./ScheduleSelect";
import { EmploymentForm } from "./EmploymentForm";
import { UsernameField } from "./UsernameField";
import { toggleMemberRoleAction, toggleMemberGroupAction } from "../actions";
import { toJalali } from "@/lib/jalali";

interface MemberRow {
  id: string;
  full_name: string;
  title: string | null;
  status: string;
  email: string;
  username: string | null;
  schedule_id: string | null;
}

async function loadData(schema: string) {
  return withTenant(schema, async (tx) => {
    const members = await tx<MemberRow[]>`
      SELECT m.id, m.full_name, m.title, m.status, m.schedule_id, ua.email, ua.username
      FROM members m
      JOIN platform.user_accounts ua ON ua.id = m.account_id
      ORDER BY m.created_at
    `;
    const schedules = await tx<{ id: string; name: string; is_default: boolean }[]>`
      SELECT id, name, is_default FROM work_schedules ORDER BY is_default DESC, name
    `;
    const employment = await tx<
      { member_id: string; hire_date: string; site: string; daily_work_minutes: number }[]
    >`
      SELECT member_id, hire_date::text, site, daily_work_minutes FROM member_employment
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
    return { members, roles, groups, memberRoles, memberGroups, schedules, employment };
  });
}

function parseIso(d: string): Date {
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, day);
}

export default async function MembersPage({
  params,
}: {
  params: { slug: string };
}) {
  const ctx = await requireTenant(params.slug);
  const canManage = ctx.member.permissions.has("members.manage");
  const { members, roles, groups, memberRoles, memberGroups, schedules, employment } =
    await loadData(ctx.company.schema);
  const empByMember = new Map(employment.map((e) => [e.member_id, e]));

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
        {members.map((m) => {
          const isSelf = m.id === ctx.member.memberId;
          return (
          <div key={m.id} className="card">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-800">{m.full_name}</span>
                  {isSelf && (
                    <span className="badge bg-brand-50 text-brand-700">شما</span>
                  )}
                </div>
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
                {/* You can never edit your own roles — shown read-only. */}
                {canManage && !isSelf
                  ? roles.map((r) => (
                      <ToggleForm
                        key={r.id}
                        action={toggleMemberRoleAction}
                        hidden={{ slug: params.slug, memberId: m.id, roleId: r.id }}
                        checked={roleSet.has(`${m.id}:${r.id}`)}
                        label={r.name}
                      />
                    ))
                  : roles.map(
                      (r) =>
                        roleSet.has(`${m.id}:${r.id}`) && (
                          <span
                            key={r.id}
                            className="badge bg-brand-50 text-brand-700"
                          >
                            {r.name}
                          </span>
                        )
                    )}
              </div>
              {isSelf && canManage && (
                <div className="mt-1.5 text-[11px] text-slate-400">
                  🔒 نقش‌های خودتان قابل تغییر نیست؛ برای جلوگیری از قطع تصادفی
                  دسترسی، باید مدیر دیگری آن را تغییر دهد.
                </div>
              )}
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

            {canManage && (
              <div className="mt-4">
                <div className="mb-1.5 text-xs font-medium text-slate-500">
                  نام کاربری ورود (برای آدرس اختصاصی شرکت)
                </div>
                <UsernameField
                  slug={params.slug}
                  memberId={m.id}
                  current={m.username}
                />
              </div>
            )}

            {canManage && (
              <div className="mt-4">
                <div className="mb-1.5 text-xs font-medium text-slate-500">
                  شیفت کاری
                </div>
                <ScheduleSelect
                  slug={params.slug}
                  memberId={m.id}
                  current={m.schedule_id}
                  schedules={schedules}
                />
              </div>
            )}

            {canManage && (() => {
              const e = empByMember.get(m.id);
              const j = e ? toJalali(parseIso(e.hire_date)) : null;
              return (
                <div className="mt-4">
                  <div className="mb-1.5 text-xs font-medium text-slate-500">
                    اطلاعات استخدامی
                  </div>
                  <EmploymentForm
                    slug={params.slug}
                    memberId={m.id}
                    emp={{
                      hire_jy: j?.jy ?? 1404,
                      hire_jm: j?.jm ?? 1,
                      hire_jd: j?.jd ?? 1,
                      site: e?.site ?? "hq",
                      daily_work_minutes: e?.daily_work_minutes ?? 510,
                    }}
                  />
                </div>
              );
            })()}
          </div>
          );
        })}
      </div>
    </>
  );
}
