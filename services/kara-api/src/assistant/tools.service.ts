import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '../infra/db.service';
import { PlaneClient } from '../team/plane.client';
import { TeamAccessService } from '../team/team-access.service';

export interface Asker {
  accountId: string;
  /** Where the question came from, for the audit: mattermost | n8n | kara. */
  channel: string;
}

export interface WorkItem { source: 'kartabl' | 'task' | 'plane'; title: string; status: string; due: string | null; key?: string; url?: string; priority?: string }

const SCHEMA_RE = /^tenant_[a-z0-9_]{1,50}$/;
const today = () => new Date().toISOString().slice(0, 10);

/**
 * What the assistant may read, always as the asking person
 * (docs/TEAM-PLATFORM.md §5.2): their kartabl and tasks in Kara, Plane issues
 * of the projects they belong to. Every call is written to
 * kara_team.assistant_audit. Read-only: changes come in Phase 5, through the
 * kartabl's approvals.
 */
@Injectable()
export class AssistantToolsService {
  private readonly log = new Logger(AssistantToolsService.name);
  private projectMembers = new Map<string, { at: number; ids: Set<string> }>();

  constructor(private readonly db: DbService, private readonly plane: PlaneClient, private readonly access: TeamAccessService) {}

  async audit(a: Asker | null, tool: string, target: string | null, args: unknown, outcome: 'ok' | 'denied' | 'error', detail = '') {
    await this.db.query(`INSERT INTO kara_team.assistant_audit (account_id, channel, tool, target, arguments, outcome, detail)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`, [a?.accountId ?? null, a?.channel ?? 'unknown', tool, target, JSON.stringify(args ?? {}), outcome, detail.slice(0, 500)])
      .catch((e) => this.log.warn(`audit: ${(e as Error).message}`));
  }

  /** The person's company schema and member id (any active membership). */
  private async member(accountId: string) {
    const [a] = await this.db.query<{ schema: string; full_name: string; slug: string }>(`
      SELECT c.schema_name AS schema, a.full_name, c.slug FROM platform.user_accounts a JOIN platform.companies c ON c.id = a.company_id
      WHERE a.id = $1 AND a.status = 'active' AND c.status = 'active'`, [accountId]);
    if (!a || !SCHEMA_RE.test(a.schema)) return null;
    const [m] = await this.db.query<{ id: string }>(`SELECT id::text FROM "${a.schema}".members WHERE account_id = $1 AND status = 'active'`, [accountId]);
    return m ? { schema: a.schema, memberId: m.id, name: a.full_name, slug: a.slug } : null;
  }

  /** The person's Plane user id, when they have joined the workspace. */
  async planeUser(accountId: string): Promise<string | null> {
    const id = await this.access.identity(accountId, 'plane');
    if (id?.state === 'active' && id.external_id) return id.external_id;
    // Invited and maybe joined since the provisioner last looked: ask Plane once.
    if (id?.state !== 'invited' || !this.plane.configured) return null;
    const who = await this.access.byAccount(accountId, 'plane');
    if (!who) return null;
    if (!this.members || Date.now() - this.members.at > 2 * 60_000) {
      this.members = { at: Date.now(), list: await this.plane.members().catch(() => []) };
    }
    const u = this.members.list.find((x) => (x.email ?? '').toLowerCase() === who.email.toLowerCase());
    if (!u) return null;
    await this.access.setIdentity(accountId, 'plane', { externalId: u.id, username: u.display_name ?? null, state: 'active' });
    return u.id;
  }
  private members?: { at: number; list: { id: string; email?: string; display_name?: string }[] };

  private async canSeeProject(planeUserId: string, projectId: string): Promise<boolean> {
    const hit = this.projectMembers.get(projectId);
    if (hit && Date.now() - hit.at < 5 * 60_000) return hit.ids.has(planeUserId);
    if (!this.plane.configured) return false;
    try {
      const list = await this.plane.projectMembers(projectId);
      const ids = new Set(list.map((u) => u.id));
      this.projectMembers.set(projectId, { at: Date.now(), ids });
      return ids.has(planeUserId);
    } catch (e) {
      this.log.warn(`plane project members ${projectId}: ${(e as Error).message}`);
      return false;
    }
  }

  // ── Tools ────────────────────────────────────────────────────────────────

  /** Open kartabl items, open tasks, and Plane issues assigned to the person. */
  async myWork(a: Asker): Promise<{ name: string; items: WorkItem[] }> {
    const m = await this.member(a.accountId);
    if (!m) { await this.audit(a, 'my_work', null, {}, 'denied', 'no active membership'); return { name: '', items: [] }; }
    const s = m.schema;
    const kartabl = await this.db.query<{ title: string; status: string; kind: string; remind_at: string | null }>(`
      SELECT i.title, i.status, i.kind, to_char(i.remind_at, 'YYYY-MM-DD') AS remind_at
      FROM "${s}".kartabl_items i JOIN "${s}".kartabls k ON k.id = i.kartabl_id
      WHERE k.member_id = $1 AND i.status IN ('open', 'in_progress') ORDER BY i.created_at DESC LIMIT 30`, [m.memberId]);
    const tasks = await this.db.query<{ title: string; status: string; due: string | null; priority: string; code: string | null }>(`
      SELECT t.title, a.status, to_char(t.due_date, 'YYYY-MM-DD') AS due, t.priority, t.code
      FROM "${s}".work_task_assignees a JOIN "${s}".work_tasks t ON t.id = a.task_id
      WHERE a.member_id = $1 AND a.status <> 'done' ORDER BY t.due_date NULLS LAST LIMIT 30`, [m.memberId]);
    const pu = await this.planeUser(a.accountId);
    const issues = pu ? await this.db.query<{ id: string; project_id: string; key: string | null; name: string; state: string | null; group: string | null; due: string | null; priority: string | null }>(`
      SELECT id::text, project_id::text, CASE WHEN project_key IS NOT NULL THEN project_key || '-' || sequence_id END AS key, name,
             state_name AS state, state_group AS "group", to_char(target_date, 'YYYY-MM-DD') AS due, priority
      FROM kara_team.plane_issues WHERE NOT deleted AND $1::uuid = ANY(assignees) AND coalesce(state_group, '') NOT IN ('completed', 'cancelled')
      ORDER BY target_date NULLS LAST, updated_at DESC LIMIT 40`, [pu]) : [];
    const items: WorkItem[] = [
      ...kartabl.map((k) => ({ source: 'kartabl' as const, title: k.title, status: `${k.kind}/${k.status}`, due: k.remind_at })),
      ...tasks.map((t) => ({ source: 'task' as const, title: t.code ? `${t.code} — ${t.title}` : t.title, status: t.status, due: t.due, priority: t.priority })),
      ...issues.map((i) => ({ source: 'plane' as const, title: i.name, key: i.key ?? undefined, status: i.state ?? i.group ?? '', due: i.due,
        priority: i.priority ?? undefined, url: this.plane.issueUrl(i.project_id, i.id) })),
    ];
    await this.audit(a, 'my_work', null, {}, 'ok', `${items.length} items`);
    return { name: m.name, items };
  }

  /** A Plane project's state: counts by state group, overdue, unassigned, per assignee. */
  async projectStatus(a: Asker, key: string) {
    const pu = await this.planeUser(a.accountId);
    const [p] = await this.db.query<{ id: string; identifier: string; name: string }>(
      `SELECT id::text, identifier, name FROM kara_team.plane_projects WHERE upper(identifier) = upper($1) AND NOT archived`, [key.trim()]);
    if (!p) { await this.audit(a, 'project_status', key, { key }, 'error', 'no such project'); return { error: `پروژه‌ای با کلید ${key} پیدا نشد.` }; }
    if (!pu || !(await this.canSeeProject(pu, p.id))) {
      await this.audit(a, 'project_status', p.identifier, { key }, 'denied', 'not a project member');
      return { error: `شما عضو پروژه ${p.identifier} در Plane نیستید.` };
    }
    const groups = await this.db.query<{ group: string; n: string }>(`
      SELECT coalesce(state_group, 'unknown') AS "group", count(*)::text AS n FROM kara_team.plane_issues
      WHERE project_id = $1 AND NOT deleted GROUP BY 1 ORDER BY 1`, [p.id]);
    const overdue = await this.db.query<{ key: string; name: string; due: string; id: string }>(`
      SELECT project_key || '-' || sequence_id AS key, name, to_char(target_date, 'YYYY-MM-DD') AS due, id::text
      FROM kara_team.plane_issues WHERE project_id = $1 AND NOT deleted AND target_date < $2::date
        AND coalesce(state_group, '') NOT IN ('completed', 'cancelled') ORDER BY target_date LIMIT 15`, [p.id, today()]);
    const [unassigned] = await this.db.query<{ n: string }>(`
      SELECT count(*)::text AS n FROM kara_team.plane_issues WHERE project_id = $1 AND NOT deleted AND cardinality(assignees) = 0
        AND coalesce(state_group, '') NOT IN ('completed', 'cancelled')`, [p.id]);
    const people = await this.db.query<{ who: string | null; open: string }>(`
      SELECT coalesce(i.username, a.uid::text) AS who, count(*)::text AS open
      FROM kara_team.plane_issues pi CROSS JOIN LATERAL unnest(pi.assignees) AS a(uid)
      LEFT JOIN kara_team.app_identities i ON i.app = 'plane' AND i.external_id = a.uid::text
      WHERE pi.project_id = $1 AND NOT pi.deleted AND coalesce(pi.state_group, '') NOT IN ('completed', 'cancelled')
      GROUP BY 1 ORDER BY count(*) DESC LIMIT 10`, [p.id]);
    await this.audit(a, 'project_status', p.identifier, { key }, 'ok');
    return {
      project: { key: p.identifier, name: p.name, url: `${this.plane.projectUrl(p.id)}` },
      byState: Object.fromEntries(groups.map((g) => [g.group, Number(g.n)])),
      overdue: overdue.map((o) => ({ key: o.key, name: o.name, due: o.due, url: this.plane.issueUrl(p.id, o.id) })),
      unassignedOpen: Number(unassigned?.n ?? 0),
      openByPerson: people.map((x) => ({ who: x.who, open: Number(x.open) })),
    };
  }

  /** One issue by its key (ERP-42), if the person may see its project. */
  async issue(a: Asker, key: string) {
    const m = /^([A-Za-z0-9]+)-(\d+)$/.exec(key.trim());
    if (!m) return { error: `کلید کار باید مثل ERP-42 باشد.` };
    const [i] = await this.db.query<{ id: string; project_id: string; name: string; state: string | null; grp: string | null; priority: string | null;
      due: string | null; start: string | null; assignees: string[]; updated: string | null; description: string | null }>(`
      SELECT id::text, project_id::text, name, state_name AS state, state_group AS grp, priority, to_char(target_date, 'YYYY-MM-DD') AS due,
             to_char(start_date, 'YYYY-MM-DD') AS start, assignees::text[] AS assignees, to_char(updated_at, 'YYYY-MM-DD HH24:MI') AS updated,
             left(data->>'description_stripped', 1500) AS description
      FROM kara_team.plane_issues WHERE upper(project_key) = upper($1) AND sequence_id = $2 AND NOT deleted`, [m[1], Number(m[2])]);
    if (!i) { await this.audit(a, 'issue', key, { key }, 'error', 'not found'); return { error: `کار ${key} پیدا نشد.` }; }
    const pu = await this.planeUser(a.accountId);
    if (!pu || !(await this.canSeeProject(pu, i.project_id))) {
      await this.audit(a, 'issue', key, { key }, 'denied', 'not a project member');
      return { error: `به پروژه این کار دسترسی ندارید.` };
    }
    const names = await this.db.query<{ external_id: string; username: string | null }>(
      `SELECT external_id, username FROM kara_team.app_identities WHERE app = 'plane' AND external_id = ANY($1)`, [i.assignees]);
    await this.audit(a, 'issue', key.toUpperCase(), { key }, 'ok');
    return {
      key: key.toUpperCase(), name: i.name, state: i.state ?? i.grp, priority: i.priority, start: i.start, due: i.due, updated: i.updated,
      assignees: i.assignees.map((x) => names.find((n) => n.external_id === x)?.username ?? x),
      description: i.description, url: this.plane.issueUrl(i.project_id, i.id),
    };
  }

  /** Issues whose title matches, in projects the person belongs to. */
  async searchIssues(a: Asker, text: string) {
    const pu = await this.planeUser(a.accountId);
    if (!pu) { await this.audit(a, 'search_issues', null, { text }, 'denied', 'no Plane account'); return { error: 'حساب Plane شما هنوز فعال نشده است.' }; }
    const rows = await this.db.query<{ id: string; project_id: string; key: string; name: string; state: string | null }>(`
      SELECT id::text, project_id::text, project_key || '-' || sequence_id AS key, name, state_name AS state
      FROM kara_team.plane_issues WHERE NOT deleted AND name ILIKE '%' || $1 || '%' ORDER BY updated_at DESC NULLS LAST LIMIT 40`, [text.trim().slice(0, 100)]);
    const out = [];
    for (const r of rows) if (await this.canSeeProject(pu, r.project_id)) out.push({ key: r.key, name: r.name, state: r.state, url: this.plane.issueUrl(r.project_id, r.id) });
    await this.audit(a, 'search_issues', null, { text }, 'ok', `${out.length} found`);
    return { results: out.slice(0, 15) };
  }
}
