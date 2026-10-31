import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { config } from '../config';
import { DbService } from '../infra/db.service';
import { teamEvents } from '../infra/metrics';
import { MattermostClient } from './mattermost.client';
import { IssueRow, PlaneEventsService, PlaneIssueEvent } from './plane-events.service';
import { PlaneClient } from './plane.client';

const SCHEMA_RE = /^tenant_[a-z0-9_]{1,50}$/;

/** Who was newly assigned (in `after`, not in `before`). Exported for tests. */
export function newAssignees(before: IssueRow | null, after: IssueRow): string[] {
  if (after.deleted) return [];
  const had = new Set(before?.assignees ?? []);
  return after.assignees.filter((a) => !had.has(a));
}

/** The Plane user who made the change, if Plane said (activity.actor). */
const actorOf = (e: PlaneIssueEvent): string | null => {
  const a = e.activity as { actor?: { id?: string } | string } | null;
  return typeof a?.actor === 'string' ? a.actor : a?.actor?.id ?? null;
};

/**
 * Phase 4 (docs/TEAM-PLATFORM.md, workflows E–G): what people should hear
 * about, in their direct messages from Simorgh Assistant.
 *  - Plane: a work item assigned to you (not by yourself).
 *  - Kara: a new kartabl item (an approval waiting, a task) or a task from
 *    the work desk, with a link to it in Kara.
 * Each notice once: Plane's deliveries are already de-duplicated; Kara's are
 * found by creation time past a per-company mark.
 */
@Injectable()
export class TeamNoticesService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(TeamNoticesService.name);
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(private readonly db: DbService, private readonly mm: MattermostClient, private readonly plane: PlaneClient, events: PlaneEventsService) {
    events.listeners.push((e, before) => this.onIssue(e, before));
  }

  onApplicationBootstrap() {
    if (process.env.KARA_API_CLI || !this.mm.botConfigured || !config.team.noticePollSeconds) return;
    this.timer = setInterval(() => void this.poll(), config.team.noticePollSeconds * 1000);
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private async mattermostUser(app: 'plane', externalId: string): Promise<string | null>;
  private async mattermostUser(app: 'account', accountId: string): Promise<string | null>;
  private async mattermostUser(app: 'plane' | 'account', id: string): Promise<string | null> {
    const [r] = await this.db.query<{ external_id: string }>(app === 'plane' ? `
      SELECT m.external_id FROM kara_team.app_identities p JOIN kara_team.app_identities m ON m.account_id = p.account_id AND m.app = 'mattermost'
      WHERE p.app = 'plane' AND p.external_id = $1 AND m.state = 'active' AND m.external_id IS NOT NULL` : `
      SELECT external_id FROM kara_team.app_identities WHERE account_id = $1 AND app = 'mattermost' AND state = 'active' AND external_id IS NOT NULL`, [id]);
    return r?.external_id ?? null;
  }

  private async onIssue(e: PlaneIssueEvent, before: IssueRow | null) {
    if (!this.mm.botConfigured) return;
    const actor = actorOf(e);
    for (const planeUser of newAssignees(before, e.data)) {
      if (planeUser === actor) continue;
      const mmUser = await this.mattermostUser('plane', planeUser);
      if (!mmUser) continue;
      const key = e.data.projectKey && e.data.sequenceId ? `${e.data.projectKey}-${e.data.sequenceId} ` : '';
      const due = e.data.targetDate ? ` · موعد ${e.data.targetDate}` : '';
      await this.mm.dm(mmUser, `📌 کاری در Plane به شما سپرده شد: [${key}${e.data.name}](${this.plane.issueUrl(e.data.projectId, e.data.id)})${due}`);
      teamEvents.inc({ source: 'notice', outcome: 'plane_assigned' });
    }
  }

  /** New kartabl items and tasks in companies with Mattermost → the recipient's DM. */
  async poll() {
    if (this.busy) return;
    this.busy = true;
    try {
      const companies = await this.db.query<{ slug: string; schema: string }>(
        `SELECT slug, schema_name AS schema FROM platform.companies WHERE status = 'active' AND coalesce((apps->>'mattermost')::boolean, false)`);
      for (const c of companies) {
        if (!SCHEMA_RE.test(c.schema)) continue;
        try { await this.company(c.slug, c.schema); } catch (e) { this.log.warn(`notices ${c.slug}: ${(e as Error).message}`); }
      }
    } finally {
      this.busy = false;
    }
  }

  private async mark(schema: string, source: string): Promise<string> {
    const [r] = await this.db.query<{ last_at: string }>(`
      INSERT INTO kara_team.notice_marks (schema_name, source, last_at) VALUES ($1, $2, now())
      ON CONFLICT (schema_name, source) DO UPDATE SET schema_name = EXCLUDED.schema_name
      RETURNING last_at::text`, [schema, source]);
    return r.last_at;
  }

  private async company(slug: string, s: string) {
    const kara = `https://${new URL(config.team.sso.publicBase).host}/app/${encodeURIComponent(slug)}`;
    // Kartabl: approvals and tasks put in someone's kartabl by someone else.
    const since = await this.mark(s, 'kartabl');
    const items = await this.db.query<{ account_id: string; title: string; kind: string; created_at: string }>(`
      SELECT m.account_id::text, i.title, i.kind, i.created_at::text
      FROM "${s}".kartabl_items i JOIN "${s}".kartabls k ON k.id = i.kartabl_id JOIN "${s}".members m ON m.id = k.member_id
      WHERE i.created_at > $1::timestamptz AND i.kind IN ('approval', 'task') AND i.created_by IS DISTINCT FROM k.member_id
      ORDER BY i.created_at LIMIT 200`, [since]);
    for (const i of items) {
      const mmUser = await this.mattermostUser('account', i.account_id);
      if (mmUser) {
        const what = i.kind === 'approval' ? '✅ منتظر تأیید شما در کارتابل' : '📥 کار تازه در کارتابل شما';
        await this.mm.dm(mmUser, `${what}: **${i.title}** — [باز کردن در کارا](${kara}/kartabl)`).catch((e) => this.log.warn(`dm: ${(e as Error).message}`));
        teamEvents.inc({ source: 'notice', outcome: `kara_${i.kind}` });
      }
      await this.db.query(`UPDATE kara_team.notice_marks SET last_at = GREATEST(last_at, $3::timestamptz) WHERE schema_name = $1 AND source = $2`, [s, 'kartabl', i.created_at]);
    }
    // Work desk: tasks sent to a person.
    const sinceT = await this.mark(s, 'task');
    const tasks = await this.db.query<{ account_id: string; title: string; code: string | null; due: string | null; priority: string; at: string }>(`
      SELECT m.account_id::text, t.title, t.code, to_char(t.due_date, 'YYYY-MM-DD') AS due, t.priority, a.updated_at::text AS at
      FROM "${s}".work_task_assignees a JOIN "${s}".work_tasks t ON t.id = a.task_id JOIN "${s}".members m ON m.id = a.member_id
      WHERE a.updated_at > $1::timestamptz AND a.status = 'open' AND a.acknowledged_at IS NULL AND t.created_by IS DISTINCT FROM a.member_id
      ORDER BY a.updated_at LIMIT 200`, [sinceT]);
    for (const t of tasks) {
      const mmUser = await this.mattermostUser('account', t.account_id);
      if (mmUser) {
        const pr = t.priority === 'urgent' ? ' 🔴 فوری' : t.priority === 'forced' ? ' ⛔ اجباری' : '';
        await this.mm.dm(mmUser, `🗒️ کار تازه در میز کار${pr}: **${t.code ? `${t.code} — ` : ''}${t.title}**${t.due ? ` · موعد ${t.due}` : ''} — [باز کردن در کارا](${kara}/tasks)`)
          .catch((e) => this.log.warn(`dm: ${(e as Error).message}`));
        teamEvents.inc({ source: 'notice', outcome: 'kara_task' });
      }
      await this.db.query(`UPDATE kara_team.notice_marks SET last_at = GREATEST(last_at, $3::timestamptz) WHERE schema_name = $1 AND source = $2`, [s, 'task', t.at]);
    }
  }
}
