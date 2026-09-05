import { requireTenant, guardPanel } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { ToggleForm } from "@/components/ToggleForm";
import { TEAM_KINDS } from "@/lib/hrc";
import { TeamForm } from "./TeamForm";
import {
  toggleTeamMemberAction,
  toggleTeamActiveAction,
  dispatchTeamAction,
} from "../actions";

async function load(schema: string) {
  return withTenant(schema, async (tx) => {
    const teams = await tx<
      {
        id: string;
        name: string;
        kind: string;
        phone: string | null;
        radio_channel: string | null;
        base_location: string | null;
        is_active: boolean;
        active_dispatches: number;
      }[]
    >`
      SELECT t.id, t.name, t.kind, t.phone, t.radio_channel, t.base_location,
             t.is_active,
             (SELECT count(*)::int FROM hrc_dispatches d
              WHERE d.team_id = t.id AND d.status IN ('dispatched','enroute','onsite'))
               AS active_dispatches
      FROM hrc_teams t ORDER BY t.name
    `;
    const members = await tx<{ id: string; full_name: string }[]>`
      SELECT id, full_name FROM members WHERE status = 'active' ORDER BY full_name
    `;
    const teamMembers = await tx<{ team_id: string; member_id: string }[]>`
      SELECT team_id, member_id FROM hrc_team_members
    `;
    return { teams, members, teamMembers };
  });
}

export default async function TeamsPage({
  params,
}: {
  params: { slug: string };
}) {
  const ctx = await requireTenant(params.slug);
  guardPanel(ctx, "hrc", "hrc.monitor", "hrc.teams.manage", "hrc.dispatch");
  const canManage = ctx.member.permissions.has("hrc.teams.manage");
  const canDispatch = ctx.member.permissions.has("hrc.dispatch");
  const { teams, members, teamMembers } = await load(ctx.company.schema);
  const inTeam = new Set(teamMembers.map((t) => `${t.team_id}:${t.member_id}`));

  return (
    <>
      <PageHeader
        title="تیم‌های HRC"
        description="تیم‌های امداد، نجات، آتش‌نشانی، ایمنی و حراست و اعضای هرکدام"
      />

      {canManage && (
        <div className="mb-6">
          <TeamForm slug={params.slug} />
        </div>
      )}

      <div className="space-y-4">
        {teams.length === 0 ? (
          <div className="card text-sm text-slate-400">هنوز تیمی تعریف نشده است.</div>
        ) : (
          teams.map((t) => (
            <div key={t.id} className="card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-800">{t.name}</span>
                    <span className="badge bg-slate-100 text-slate-600">
                      {TEAM_KINDS[t.kind as keyof typeof TEAM_KINDS] ?? t.kind}
                    </span>
                    {!t.is_active && (
                      <span className="badge bg-red-100 text-red-700">غیرفعال</span>
                    )}
                    {t.active_dispatches > 0 && (
                      <span className="badge bg-blue-100 text-blue-700">
                        {t.active_dispatches} مأموریت جاری
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    {t.base_location ?? "—"}
                    {t.phone ? ` · تلفن ${t.phone}` : ""}
                    {t.radio_channel ? ` · بی‌سیم ${t.radio_channel}` : ""}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {canDispatch && t.is_active && (
                    <form action={dispatchTeamAction} className="flex items-center gap-1.5">
                      <input type="hidden" name="slug" value={params.slug} />
                      <input type="hidden" name="teamId" value={t.id} />
                      <select name="memberId" className="input !w-40 !py-1 text-xs" defaultValue="">
                        <option value="">— بدون فرد هدف —</option>
                        {members.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.full_name}
                          </option>
                        ))}
                      </select>
                      <input
                        name="note"
                        placeholder="شرح مأموریت"
                        className="input !w-36 !py-1 text-xs"
                      />
                      <button className="btn-primary">اعزام</button>
                    </form>
                  )}
                  {canManage && (
                    <form action={toggleTeamActiveAction}>
                      <input type="hidden" name="slug" value={params.slug} />
                      <input type="hidden" name="teamId" value={t.id} />
                      <button className="text-xs text-brand-600 hover:underline">
                        {t.is_active ? "غیرفعال کن" : "فعال کن"}
                      </button>
                    </form>
                  )}
                </div>
              </div>

              <div className="mt-3 border-t border-slate-100 pt-3">
                <div className="mb-1.5 text-xs font-medium text-slate-500">اعضای تیم</div>
                <div className="flex flex-wrap gap-2">
                  {canManage
                    ? members.map((m) => (
                        <ToggleForm
                          key={m.id}
                          action={toggleTeamMemberAction}
                          hidden={{ slug: params.slug, teamId: t.id, memberId: m.id }}
                          checked={inTeam.has(`${t.id}:${m.id}`)}
                          label={m.full_name}
                        />
                      ))
                    : members
                        .filter((m) => inTeam.has(`${t.id}:${m.id}`))
                        .map((m) => (
                          <span key={m.id} className="badge bg-brand-50 text-brand-700">
                            {m.full_name}
                          </span>
                        ))}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
