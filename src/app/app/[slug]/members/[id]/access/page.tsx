import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant, ensurePermission } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { PERMISSIONS, permissionGroups, type PermissionKey } from "@/lib/rbac";
import {
  setMemberPermissionAction,
  clearMemberPermissionsAction,
} from "../../../actions";

interface Data {
  member: { id: string; full_name: string; title: string | null; email: string } | null;
  roles: { id: string; name: string }[];
  rolePerms: Set<string>;
  overrides: Map<string, string>;
}

async function loadData(schema: string, memberId: string): Promise<Data> {
  return withTenant(schema, async (tx) => {
    const [member] = await tx<
      { id: string; full_name: string; title: string | null; email: string }[]
    >`
      SELECT m.id, m.full_name, m.title, ua.email
      FROM members m
      JOIN platform.user_accounts ua ON ua.id = m.account_id
      WHERE m.id = ${memberId}
    `;
    if (!member) {
      return { member: null, roles: [], rolePerms: new Set(), overrides: new Map() };
    }
    const roles = await tx<{ id: string; name: string }[]>`
      SELECT r.id, r.name FROM member_roles mr
      JOIN roles r ON r.id = mr.role_id
      WHERE mr.member_id = ${memberId}
      ORDER BY r.name
    `;
    const perms = await tx<{ permission_key: string }[]>`
      SELECT DISTINCT rp.permission_key
      FROM member_roles mr
      JOIN role_permissions rp ON rp.role_id = mr.role_id
      WHERE mr.member_id = ${memberId}
    `;
    const overrides = await tx<{ permission_key: string; effect: string }[]>`
      SELECT permission_key, effect FROM member_permissions WHERE member_id = ${memberId}
    `;
    return {
      member,
      roles,
      rolePerms: new Set(perms.map((p) => p.permission_key)),
      overrides: new Map(overrides.map((o) => [o.permission_key, o.effect])),
    };
  });
}

/** One permission row: what the roles say, and the person-specific exception. */
function PermRow({
  slug,
  memberId,
  permKey,
  fromRole,
  override,
  editable,
}: {
  slug: string;
  memberId: string;
  permKey: PermissionKey;
  fromRole: boolean;
  override: string | undefined;
  editable: boolean;
}) {
  const effective = override ? override === "grant" : fromRole;
  const current = override ?? "inherit";

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-2 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-slate-700">{PERMISSIONS[permKey]}</div>
        <div className="text-[11px] text-slate-400" dir="ltr">
          {permKey}
        </div>
      </div>

      <span
        className={`badge ${
          effective ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
        }`}
      >
        {effective ? "دارد" : "ندارد"}
      </span>

      {editable ? (
        <form action={setMemberPermissionAction} className="flex items-center gap-1.5">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="memberId" value={memberId} />
          <input type="hidden" name="permissionKey" value={permKey} />
          <select name="effect" defaultValue={current} className="input !w-40 !py-1 text-xs">
            <option value="inherit">
              طبق نقش ({fromRole ? "دارد" : "ندارد"})
            </option>
            <option value="grant">استثنا: بده</option>
            <option value="deny">استثنا: بگیر</option>
          </select>
          <button className="text-xs text-brand-600 hover:underline">ثبت</button>
        </form>
      ) : (
        <span className="text-[11px] text-slate-400">
          {override === "grant"
            ? "استثنای افزوده"
            : override === "deny"
              ? "استثنای سلب‌شده"
              : "طبق نقش"}
        </span>
      )}
    </div>
  );
}

export default async function MemberAccessPage({
  params,
}: {
  params: { slug: string; id: string };
}) {
  const ctx = await requireTenant(params.slug);
  ensurePermission(ctx, "members.view");
  const canManage =
    ctx.member.permissions.has("members.permissions.manage") &&
    params.id !== ctx.member.memberId;

  const { member, roles, rolePerms, overrides } = await loadData(
    ctx.company.schema,
    params.id
  );
  if (!member) notFound();

  const groups = permissionGroups(ctx.company.modules);
  const overrideCount = overrides.size;

  return (
    <>
      <PageHeader
        title={`دسترسی جز‌به‌جز — ${member.full_name}`}
        description="نقش‌ها پایهٔ دسترسی هستند؛ اینجا می‌توانید برای همین شخص، تک‌تک مجوزها را جداگانه بدهید یا بگیرید"
        action={
          <Link href={`/app/${params.slug}/members`} className="btn-ghost">
            ← بازگشت به اعضا
          </Link>
        }
      />

      <div className="card mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-800">
              {member.full_name}
              {member.title ? ` — ${member.title}` : ""}
            </div>
            <div className="text-xs text-slate-400" dir="ltr">
              {member.email}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {roles.length === 0 ? (
                <span className="text-xs text-slate-400">بدون نقش</span>
              ) : (
                roles.map((r) => (
                  <span key={r.id} className="badge bg-brand-50 text-brand-700">
                    {r.name}
                  </span>
                ))
              )}
            </div>
          </div>
          {canManage && overrideCount > 0 && (
            <form action={clearMemberPermissionsAction}>
              <input type="hidden" name="slug" value={params.slug} />
              <input type="hidden" name="memberId" value={member.id} />
              <button className="btn-danger">
                حذف همهٔ استثناها ({overrideCount})
              </button>
            </form>
          )}
        </div>
        {!canManage && (
          <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
            {params.id === ctx.member.memberId
              ? "🔒 دسترسی خودتان قابل تغییر نیست؛ مدیر دیگری باید آن را تنظیم کند."
              : "🔒 برای تغییر، مجوز «تنظیم دسترسی جز‌به‌جز هر عضو» لازم است."}
          </div>
        )}
      </div>

      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.module} className="card">
            <div className="mb-2 border-b border-slate-100 pb-2 text-sm font-semibold text-slate-700">
              {g.icon} {g.title}
            </div>
            {g.keys.map((k) => (
              <PermRow
                key={k}
                slug={params.slug}
                memberId={member.id}
                permKey={k}
                fromRole={rolePerms.has(k)}
                override={overrides.get(k)}
                editable={canManage}
              />
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
