import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '../infra/db.service';
import { teamEvents } from '../infra/metrics';
import { MattermostClient } from '../team/mattermost.client';
import { PlaneClient } from '../team/plane.client';
import { formatWork } from './assistant.service';
import { AssistantToolsService } from './tools.service';

/** ISO week, e.g. 2026-W44. Exported for tests. */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}

/**
 * Phase 4: the morning digest and the weekly report, one direct message per
 * person who has Mattermost in Kara. n8n's schedule calls
 * POST /v1/assistant/digests/daily|weekly; each person gets each one once per
 * day or week (kara_team.digests), however often it is called.
 */
@Injectable()
export class DigestService {
  private readonly log = new Logger(DigestService.name);

  constructor(private readonly db: DbService, private readonly tools: AssistantToolsService, private readonly mm: MattermostClient,
    private readonly plane: PlaneClient) {}

  private async people() {
    return this.db.query<{ account_id: string; mm: string }>(`
      SELECT i.account_id::text, i.external_id AS mm FROM kara_team.app_identities i
      JOIN platform.user_accounts a ON a.id = i.account_id AND a.status = 'active'
      WHERE i.app = 'mattermost' AND i.state = 'active' AND i.external_id IS NOT NULL`);
  }

  private async claim(accountId: string, kind: string, period: string): Promise<boolean> {
    const r = await this.db.query(`INSERT INTO kara_team.digests (account_id, kind, period) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING 1`,
      [accountId, kind, period]);
    return r.length > 0;
  }

  async run(kind: 'daily' | 'weekly'): Promise<{ sent: number; skipped: number; failed: number }> {
    if (!this.mm.botConfigured) return { sent: 0, skipped: 0, failed: 0 };
    const now = new Date();
    const period = kind === 'daily' ? now.toISOString().slice(0, 10) : isoWeek(now);
    let sent = 0; let skipped = 0; let failed = 0;
    for (const p of await this.people()) {
      if (!(await this.claim(p.account_id, kind, period))) { skipped += 1; continue; }
      try {
        const a = { accountId: p.account_id, channel: `digest_${kind}` };
        const text = kind === 'daily' ? await this.daily(a) : await this.weekly(a);
        if (text) { await this.mm.dm(p.mm, text); sent += 1; } else skipped += 1;
      } catch (e) {
        failed += 1;
        // Not sent: let a later call try again.
        await this.db.query(`DELETE FROM kara_team.digests WHERE account_id = $1 AND kind = $2 AND period = $3`, [p.account_id, kind, period]);
        this.log.warn(`${kind} digest for ${p.account_id}: ${(e as Error).message}`);
      }
    }
    teamEvents.inc({ source: `digest_${kind}`, outcome: 'run' });
    this.log.log(`${kind} digest ${period}: ${sent} sent, ${skipped} skipped, ${failed} failed`);
    return { sent, skipped, failed };
  }

  /** Nothing open: no message (a quiet morning is not news). */
  private async daily(a: { accountId: string; channel: string }): Promise<string | null> {
    const w = await this.tools.myWork(a);
    if (!w.items.length) return null;
    const overdue = w.items.filter((i) => i.due && i.due < new Date().toISOString().slice(0, 10)).length;
    const head = `☀️ صبح بخیر ${w.name}!${overdue ? ` **${overdue}** کار از موعدش گذشته.` : ''}`;
    return `${head}\n\n${formatWork(w.name, w.items, !!(await this.tools.planeUser(a.accountId)))}`;
  }

  private async weekly(a: { accountId: string; channel: string }): Promise<string | null> {
    const pu = await this.tools.planeUser(a.accountId);
    const w = await this.tools.myWork(a);
    const done = pu ? await this.db.query<{ key: string; name: string; id: string; project_id: string }>(`
      SELECT project_key || '-' || sequence_id AS key, name, id::text, project_id::text FROM kara_team.plane_issues
      WHERE NOT deleted AND $1::uuid = ANY(assignees) AND state_group = 'completed' AND updated_at > now() - interval '7 days'
      ORDER BY updated_at DESC LIMIT 20`, [pu]) : [];
    if (!done.length && !w.items.length) return null;
    const today = new Date().toISOString().slice(0, 10);
    const overdue = w.items.filter((i) => i.due && i.due < today);
    return [
      `#### 📊 گزارش هفتگی ${w.name}`,
      done.length ? `**انجام‌شده در Plane این هفته (${done.length})**\n${done.map((d) => `- [${d.key} ${d.name}](${this.plane.issueUrl(d.project_id, d.id)})`).join('\n')}` : '',
      `**باز**: ${w.items.length} کار (${w.items.filter((i) => i.source === 'plane').length} در Plane، ${w.items.filter((i) => i.source === 'task').length} در میز کار، ${w.items.filter((i) => i.source === 'kartabl').length} در کارتابل)`,
      overdue.length ? `**عقب‌افتاده (${overdue.length})**\n${overdue.map((i) => `- ${i.url ? `[${i.key ?? ''} ${i.title}](${i.url})` : i.title} — موعد ${i.due}`).join('\n')}` : 'هیچ کاری عقب نیفتاده. 👏',
    ].filter(Boolean).join('\n\n');
  }
}
