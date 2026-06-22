import { requireTenant } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { PERMISSIONS } from "@/lib/rbac";
import { RoleForm } from "./RoleForm";
import { updateRolePermissionsAction, deleteRoleAction } from "../actions";

async function loadRoles(schema: string) {
  return withTenant(schema, async (tx) => {
    const roles = await tx<
      { id: string; name: string; description: string | null; is_system: boolean }[]
    >`SELECT id, name, description, is_system FROM roles ORDER BY is_system DESC, name`;
    const perms = await tx<{ role_id: string; permission_key: string }[]>`
      SELECT role_id, permission_key FROM role_permissions
    `;
    return { roles, perms };
  });
}

export default async function RolesPage({
  params,
}: {
  params: { slug: string };
}) {
  const ctx = await requireTenant(params.slug);
  const canManage = ctx.member.permissions.has("roles.manage");
  const { roles, perms } = await loadRoles(ctx.company.schema);
  const permSet = new Set(perms.map((p) => `${p.role_id}:${p.permission_key}`));

  return (
    <>
      <PageHeader
        title="نقش‌ها و مجوزها"
        description="تعریف سطوح دسترسی و تخصیص مجوزها به هر نقش"
      />

      {canManage && (
        <div className="mb-6">
          <RoleForm slug={params.slug} />
        </div>
      )}

      <div className="space-y-4">
        {roles.map((role) => (
          <div key={role.id} className="card">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-800">{role.name}</span>
                  {role.is_system && (
                    <span className="badge bg-slate-100 text-slate-500">سیستمی</span>
                  )}
                </div>
                {role.description && (
                  <div className="text-xs text-slate-400">{role.description}</div>
                )}
              </div>
              {canManage && !role.is_system && (
                <form action={deleteRoleAction}>
                  <input type="hidden" name="slug" value={params.slug} />
                  <input type="hidden" name="roleId" value={role.id} />
                  <button className="btn-danger">حذف</button>
                </form>
              )}
            </div>

            <form action={updateRolePermissionsAction} className="mt-4">
              <input type="hidden" name="slug" value={params.slug} />
              <input type="hidden" name="roleId" value={role.id} />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {Object.entries(PERMISSIONS).map(([key, label]) => (
                  <label
                    key={key}
                    className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600"
                  >
                    <input
                      type="checkbox"
                      name="permissions"
                      value={key}
                      defaultChecked={permSet.has(`${role.id}:${key}`)}
                      disabled={!canManage}
                    />
                    {label}
                  </label>
                ))}
              </div>
              {canManage && (
                <div className="mt-3 flex justify-end">
                  <button className="btn-ghost">ذخیره مجوزها</button>
                </div>
              )}
            </form>
          </div>
        ))}
      </div>
    </>
  );
}
