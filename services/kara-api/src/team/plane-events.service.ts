import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { Kafka, Producer } from 'kafkajs';
import { config } from '../config';
import { DbService } from '../infra/db.service';
import { teamEvents } from '../infra/metrics';
import { PlaneClient, PlaneIssue, PlaneProject, PlaneState } from './plane.client';

/** A Plane webhook delivery's body (bgtasks/webhook_task.py). */
export interface PlaneDelivery {
  event: string;           // issue | project | cycle | module | issue_comment | …
  action: string;          // create | update | delete
  webhook_id?: string;
  workspace_id?: string;
  workspace_slug?: string;
  data: Record<string, unknown> | null;
  activity?: Record<string, unknown> | null;
}

/** The Kafka event Kara publishes for each issue change (topic plane.issue.v1). */
export interface PlaneIssueEvent {
  id: string;               // the delivery id: consumers de-duplicate on it
  type: 'plane.issue.created' | 'plane.issue.updated' | 'plane.issue.deleted';
  time: string;
  workspace: string;
  data: IssueRow;
  /** Who changed what, as Plane reported it (field, old, new, actor). */
  activity: Record<string, unknown> | null;
}

export interface IssueRow {
  id: string;
  workspace: string;
  projectId: string;
  projectKey: string | null;
  sequenceId: number | null;
  name: string;
  stateName: string | null;
  stateGroup: string | null;
  priority: string | null;
  assignees: string[];
  startDate: string | null;
  targetDate: string | null;
  updatedAt: string | null;
  deleted: boolean;
}

/** Plane's own signature: hex HMAC-SHA256 of the body with the webhook's secret. */
export function validSignature(secret: string, body: Buffer, signature: string | undefined): boolean {
  if (!secret || !signature) return false;
  const want = Buffer.from(createHmac('sha256', secret).update(body).digest('hex'), 'utf8');
  const got = Buffer.from(signature.trim().toLowerCase(), 'utf8');
  return want.length === got.length && timingSafeEqual(want, got);
}

const idOf = (x: unknown): string | null =>
  typeof x === 'string' ? x : x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string' ? (x as { id: string }).id : null;

/** An issue as Plane sends it (webhook or API) → the row Kara keeps. Pure. */
export function issueRow(i: PlaneIssue, workspace: string, projectKey: string | null, deleted = false): IssueRow {
  const state = i.state && typeof i.state === 'object' ? (i.state as PlaneState) : null;
  return {
    id: i.id,
    workspace,
    projectId: idOf(i.project) ?? '',
    projectKey,
    sequenceId: typeof i.sequence_id === 'number' ? i.sequence_id : null,
    name: String(i.name ?? ''),
    stateName: state?.name ?? null,
    stateGroup: state?.group ?? null,
    priority: i.priority ?? null,
    assignees: (i.assignees ?? []).map(idOf).filter((x): x is string => !!x),
    startDate: i.start_date ?? null,
    targetDate: i.target_date ?? null,
    updatedAt: i.updated_at ?? null,
    deleted: deleted || !!i.deleted_at,
  };
}

/**
 * Plane → Kara. Webhooks (signed, each delivery once) keep kara_team's read
 * model current and are published to Kafka plane.issue.v1; a periodic
 * backfill from Plane's API repairs anything a lost delivery missed.
 */
@Injectable()
export class PlaneEventsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(PlaneEventsService.name);
  private producer?: Producer;
  private producerReady?: Promise<void>;
  private timer?: NodeJS.Timeout;
  private projectKeys = new Map<string, string>();
  /** Called after an issue change is applied (Phase 4: notices in Mattermost). */
  readonly listeners: ((e: PlaneIssueEvent, before: IssueRow | null) => Promise<void>)[] = [];

  constructor(private readonly db: DbService, private readonly plane: PlaneClient) {}

  onApplicationBootstrap() {
    if (process.env.KARA_API_CLI) return;
    if (config.kafka.brokers.length) {
      const kafka = new Kafka({ clientId: `${config.kafka.clientId}-team`, brokers: config.kafka.brokers, ssl: config.kafka.ssl });
      this.producer = kafka.producer({ allowAutoTopicCreation: false, idempotent: true, maxInFlightRequests: 1 });
    }
    if (!this.plane.configured) {
      this.log.log('Plane off (PLANE_API_KEY empty)');
      return;
    }
    const run = () => this.backfill().catch((e) => this.log.error(`plane backfill: ${(e as Error).message}`));
    setTimeout(run, 15_000);
    if (config.team.plane.backfillHours > 0) this.timer = setInterval(run, config.team.plane.backfillHours * 3600_000);
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.producer?.disconnect().catch(() => undefined);
  }

  // ── Webhooks ─────────────────────────────────────────────────────────────

  /** Returns what happened, for the response and the logs. */
  async receive(deliveryId: string, d: PlaneDelivery): Promise<'applied' | 'duplicate' | 'ignored'> {
    const fresh = await this.db.query<{ delivery_id: string }>(
      `INSERT INTO kara_team.plane_deliveries (delivery_id, event, action) VALUES ($1, $2, $3)
       ON CONFLICT (delivery_id) DO NOTHING RETURNING delivery_id`, [deliveryId, d.event, d.action]);
    if (!fresh.length) { teamEvents.inc({ source: 'plane', outcome: 'duplicate' }); return 'duplicate'; }
    const workspace = d.workspace_slug ?? config.team.plane.workspace;
    if (d.event === 'project' && d.data) {
      const p = d.data as unknown as PlaneProject;
      if (d.action === 'delete') await this.db.query(`UPDATE kara_team.plane_projects SET archived = true, synced_at = now() WHERE id = $1`, [p.id]);
      else await this.upsertProject(p, workspace);
      teamEvents.inc({ source: 'plane', outcome: 'applied' });
      return 'applied';
    }
    if (d.event !== 'issue' || !d.data || typeof d.data.id !== 'string') {
      teamEvents.inc({ source: 'plane', outcome: 'ignored' });
      return 'ignored';
    }
    let issue = d.data as unknown as PlaneIssue;
    const deleted = d.action === 'delete';
    // The webhook may carry the state as an id only: ask Plane for the whole issue.
    if (!deleted && this.plane.configured && (typeof issue.state === 'string' || issue.state == null)) {
      try { issue = await this.plane.issue(idOf(issue.project) ?? '', issue.id); } catch (e) {
        this.log.warn(`plane issue ${issue.id}: ${(e as Error).message}; keeping the webhook's copy`);
      }
    }
    const projectKey = await this.projectKey(idOf(issue.project) ?? '');
    const row = issueRow(issue, workspace, projectKey, deleted);
    const before = await this.current(row.id);
    await this.upsert(row, issue);
    const event: PlaneIssueEvent = {
      id: deliveryId,
      type: deleted ? 'plane.issue.deleted' : d.action === 'create' ? 'plane.issue.created' : 'plane.issue.updated',
      time: new Date().toISOString(),
      workspace,
      data: row,
      activity: d.activity ?? null,
    };
    await this.publish(event);
    for (const l of this.listeners) {
      try { await l(event, before); } catch (e) { this.log.warn(`issue listener: ${(e as Error).message}`); }
    }
    teamEvents.inc({ source: 'plane', outcome: 'applied' });
    return 'applied';
  }

  private async publish(e: PlaneIssueEvent) {
    if (!this.producer) return;
    try {
      this.producerReady ??= this.producer.connect();
      await this.producerReady;
      await this.producer.send({ topic: config.team.planeTopic, messages: [{ key: e.data.id, value: JSON.stringify(e) }] });
    } catch (err) {
      this.producerReady = undefined;
      // The read model has it already; Kafka's copy is for other consumers.
      this.log.warn(`kafka ${config.team.planeTopic}: ${(err as Error).message}`);
    }
  }

  // ── The read model ───────────────────────────────────────────────────────

  async current(id: string): Promise<IssueRow | null> {
    const [r] = await this.db.query<IssueRow>(`
      SELECT id::text, workspace, project_id::text AS "projectId", project_key AS "projectKey", sequence_id AS "sequenceId", name,
             state_name AS "stateName", state_group AS "stateGroup", priority, assignees::text[] AS assignees,
             to_char(start_date, 'YYYY-MM-DD') AS "startDate", to_char(target_date, 'YYYY-MM-DD') AS "targetDate",
             updated_at::text AS "updatedAt", deleted
      FROM kara_team.plane_issues WHERE id = $1`, [id]);
    return r ?? null;
  }

  /** Newest wins: an older copy (a backfill page fetched before a webhook) never overwrites a newer one. */
  private async upsert(r: IssueRow, raw: unknown) {
    await this.db.query(`
      INSERT INTO kara_team.plane_issues (id, workspace, project_id, project_key, sequence_id, name, state_name, state_group,
        priority, assignees, start_date, target_date, deleted, updated_at, data, synced_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::uuid[], $11, $12, $13, $14, $15, now())
      ON CONFLICT (id) DO UPDATE SET workspace = EXCLUDED.workspace, project_id = EXCLUDED.project_id,
        project_key = coalesce(EXCLUDED.project_key, kara_team.plane_issues.project_key), sequence_id = EXCLUDED.sequence_id,
        name = EXCLUDED.name, state_name = coalesce(EXCLUDED.state_name, kara_team.plane_issues.state_name),
        state_group = coalesce(EXCLUDED.state_group, kara_team.plane_issues.state_group), priority = EXCLUDED.priority,
        assignees = EXCLUDED.assignees, start_date = EXCLUDED.start_date, target_date = EXCLUDED.target_date,
        deleted = EXCLUDED.deleted, updated_at = EXCLUDED.updated_at, data = EXCLUDED.data, synced_at = now()
      WHERE EXCLUDED.deleted OR kara_team.plane_issues.updated_at IS NULL OR EXCLUDED.updated_at IS NULL
         OR EXCLUDED.updated_at >= kara_team.plane_issues.updated_at`,
    [r.id, r.workspace, r.projectId, r.projectKey, r.sequenceId, r.name, r.stateName, r.stateGroup, r.priority, r.assignees,
      r.startDate, r.targetDate, r.deleted, r.updatedAt, JSON.stringify(raw ?? {})]);
  }

  private async upsertProject(p: PlaneProject, workspace: string) {
    if (!p.id || !p.identifier) return;
    this.projectKeys.set(p.id, p.identifier);
    await this.db.query(`
      INSERT INTO kara_team.plane_projects (id, workspace, identifier, name, archived) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (id) DO UPDATE SET identifier = $3, name = $4, archived = $5, synced_at = now()`,
    [p.id, workspace, p.identifier, p.name, !!p.archived_at]);
  }

  private async projectKey(projectId: string): Promise<string | null> {
    if (!projectId) return null;
    const cached = this.projectKeys.get(projectId);
    if (cached) return cached;
    const [r] = await this.db.query<{ identifier: string }>(`SELECT identifier FROM kara_team.plane_projects WHERE id = $1`, [projectId]);
    if (r) { this.projectKeys.set(projectId, r.identifier); return r.identifier; }
    return null;
  }

  /** Every project and issue from Plane's API. Issues gone from Plane are marked deleted. */
  async backfill(): Promise<{ projects: number; issues: number; gone: number }> {
    const workspace = config.team.plane.workspace;
    const projects = await this.plane.projects();
    for (const p of projects) await this.upsertProject(p, workspace);
    let issues = 0;
    const seen: string[] = [];
    for (const p of projects) {
      if (p.archived_at) continue;
      for (const i of await this.plane.issues(p.id)) {
        await this.upsert(issueRow({ ...i, project: i.project ?? p.id }, workspace, p.identifier), i);
        seen.push(i.id);
        issues += 1;
      }
    }
    const gone = await this.db.query<{ id: string }>(`
      UPDATE kara_team.plane_issues SET deleted = true, synced_at = now()
      WHERE workspace = $1 AND NOT deleted AND NOT (id = ANY($2::uuid[]))
        AND project_id = ANY($3::uuid[]) RETURNING id::text`,
    [workspace, seen, projects.filter((p) => !p.archived_at).map((p) => p.id)]);
    this.log.log(`plane backfill: ${projects.length} projects, ${issues} issues, ${gone.length} gone`);
    return { projects: projects.length, issues, gone: gone.length };
  }
}
