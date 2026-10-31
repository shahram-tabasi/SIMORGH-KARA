import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../config';
import { DbService } from '../infra/db.service';
import { teamEvents } from '../infra/metrics';
import { MattermostClient, MmAttachment } from '../team/mattermost.client';
import { PlaneClient } from '../team/plane.client';
import { Asker, AssistantToolsService } from './tools.service';

/** What the assistant may propose. Each runs as one Plane API call, after approval. */
export type ProposalInput =
  | { kind: 'set_state'; issue: string; state: string }
  | { kind: 'assign'; issue: string; assignees: string[] }
  | { kind: 'set_due_date'; issue: string; date: string }
  | { kind: 'comment'; issue: string; text: string }
  | { kind: 'create_issue'; project: string; title: string; description?: string; assignees?: string[]; date?: string; priority?: string };

interface Action {
  kind: ProposalInput['kind'];
  projectId: string;
  issueId?: string;
  issueKey?: string;
  patch?: Record<string, unknown>;
  body?: Record<string, unknown>;
  html?: string;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITIES = ['urgent', 'high', 'medium', 'low', 'none'];

/** The button's proof: an HMAC of the proposal id and the decision, so a forged click cannot decide. Exported for tests. */
export function actionSig(proposalId: string, decision: string, key = config.team.assistant.serviceToken): string {
  return createHmac('sha256', `mm-action:${key}`).update(`${proposalId}:${decision}`).digest('hex');
}

export function sigOk(proposalId: string, decision: string, sig: string, key = config.team.assistant.serviceToken): boolean {
  const want = Buffer.from(actionSig(proposalId, decision, key)); const got = Buffer.from(sig ?? '');
  return !!key && want.length === got.length && timingSafeEqual(want, got);
}

/**
 * Phase 5 (docs/TEAM-PLATFORM.md, workflows D and H): the assistant never
 * changes anything itself. It proposes one exact change; Kara writes it down
 * (kara_team.proposals), puts an approval item in the approver's kartabl and
 * sends them Approve / Reject buttons. Only Approve, pressed by the approver,
 * runs it — through Plane's API, with a comment saying who asked and who
 * approved. The approver is the person who asked (they confirm what the
 * model understood); the change is limited to projects they belong to.
 */
@Injectable()
export class ProposalsService {
  private readonly log = new Logger(ProposalsService.name);

  constructor(private readonly db: DbService, private readonly tools: AssistantToolsService, private readonly plane: PlaneClient,
    private readonly mm: MattermostClient) {}

  private async issueByKey(a: Asker, key: string) {
    const m = /^([A-Za-z0-9]+)-(\d+)$/.exec(key.trim());
    if (!m) throw new Error(`کلید کار باید مثل ERP-42 باشد، نه «${key}».`);
    const [i] = await this.db.query<{ id: string; project_id: string; name: string }>(`
      SELECT id::text, project_id::text, name FROM kara_team.plane_issues WHERE upper(project_key) = upper($1) AND sequence_id = $2 AND NOT deleted`,
    [m[1], Number(m[2])]);
    if (!i) throw new Error(`کار ${key} پیدا نشد.`);
    await this.mayChange(a, i.project_id);
    return { ...i, key: `${m[1].toUpperCase()}-${m[2]}` };
  }

  private async mayChange(a: Asker, projectId: string) {
    const pu = await this.tools.planeUser(a.accountId);
    if (!pu || !(await this.tools.canSee(pu, projectId))) throw new Error('شما عضو این پروژه در Plane نیستید؛ پیشنهاد تغییر ممکن نیست.');
  }

  /** People by name, username or email → Plane user ids, among the project's members. */
  private async people(projectId: string, names: string[]): Promise<{ ids: string[]; labels: string[] }> {
    const members = await this.plane.projectMembers(projectId);
    const ids: string[] = []; const labels: string[] = [];
    for (const n of names) {
      const q = n.trim().replace(/^@/, '').toLowerCase();
      const hit = members.filter((u) => [u.email, u.display_name, `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim(), u.first_name, u.last_name]
        .some((v) => (v ?? '').toLowerCase() === q || ((v ?? '').toLowerCase().includes(q) && q.length >= 3)));
      if (hit.length !== 1) throw new Error(hit.length ? `«${n}» چند نفر را نشان می‌دهد؛ دقیق‌تر بنویسید.` : `«${n}» در اعضای این پروژه پیدا نشد.`);
      ids.push(hit[0].id); labels.push(hit[0].display_name || hit[0].email || n);
    }
    return { ids, labels };
  }

  /** Validates the input against Plane and Kara and turns it into the exact action and its plain-language summary. */
  private async build(a: Asker, p: ProposalInput): Promise<{ action: Action; summary: string }> {
    switch (p.kind) {
      case 'set_state': {
        const i = await this.issueByKey(a, p.issue);
        const states = await this.plane.states(i.project_id);
        const q = p.state.trim().toLowerCase();
        const st = states.find((s) => s.name.toLowerCase() === q) ?? states.find((s) => s.group === q)
          ?? (['done', 'close', 'closed', 'انجام', 'بسته'].includes(q) ? states.find((s) => s.group === 'completed') : undefined);
        if (!st) throw new Error(`وضعیت «${p.state}» در این پروژه نیست. وضعیت‌ها: ${states.map((s) => s.name).join('، ')}`);
        return { action: { kind: p.kind, projectId: i.project_id, issueId: i.id, issueKey: i.key, patch: { state: st.id } },
          summary: `وضعیت **${i.key} ${i.name}** → **${st.name}**` };
      }
      case 'assign': {
        const i = await this.issueByKey(a, p.issue);
        const who = await this.people(i.project_id, p.assignees);
        return { action: { kind: p.kind, projectId: i.project_id, issueId: i.id, issueKey: i.key, patch: { assignees: who.ids } },
          summary: `مسئول **${i.key} ${i.name}** → **${who.labels.join('، ')}**` };
      }
      case 'set_due_date': {
        if (!DATE_RE.test(p.date)) throw new Error('تاریخ باید میلادی و به شکل YYYY-MM-DD باشد.');
        const i = await this.issueByKey(a, p.issue);
        return { action: { kind: p.kind, projectId: i.project_id, issueId: i.id, issueKey: i.key, patch: { target_date: p.date } },
          summary: `موعد **${i.key} ${i.name}** → **${p.date}**` };
      }
      case 'comment': {
        const text = p.text.trim().slice(0, 4000);
        if (!text) throw new Error('متن یادداشت خالی است.');
        const i = await this.issueByKey(a, p.issue);
        return { action: { kind: p.kind, projectId: i.project_id, issueId: i.id, issueKey: i.key, html: `<p>${esc(text).replace(/\n/g, '<br>')}</p>` },
          summary: `یادداشت روی **${i.key} ${i.name}**:\n> ${text.slice(0, 500).replace(/\n/g, '\n> ')}` };
      }
      case 'create_issue': {
        const [proj] = await this.db.query<{ id: string; identifier: string; name: string }>(
          `SELECT id::text, identifier, name FROM kara_team.plane_projects WHERE upper(identifier) = upper($1) AND NOT archived`, [p.project.trim()]);
        if (!proj) throw new Error(`پروژه ${p.project} پیدا نشد.`);
        await this.mayChange(a, proj.id);
        const title = p.title.trim().slice(0, 255);
        if (!title) throw new Error('عنوان کار خالی است.');
        if (p.date && !DATE_RE.test(p.date)) throw new Error('تاریخ باید میلادی و به شکل YYYY-MM-DD باشد.');
        const who = p.assignees?.length ? await this.people(proj.id, p.assignees) : { ids: [], labels: [] };
        const priority = p.priority && PRIORITIES.includes(p.priority) ? p.priority : undefined;
        const body: Record<string, unknown> = { name: title, ...(p.description ? { description_html: `<p>${esc(p.description.slice(0, 4000))}</p>` } : {}),
          ...(who.ids.length ? { assignees: who.ids } : {}), ...(p.date ? { target_date: p.date } : {}), ...(priority ? { priority } : {}) };
        return { action: { kind: p.kind, projectId: proj.id, body },
          summary: `کار تازه در **${proj.identifier}**: **${title}**${who.labels.length ? ` · مسئول ${who.labels.join('، ')}` : ''}${p.date ? ` · موعد ${p.date}` : ''}${priority ? ` · اولویت ${priority}` : ''}` };
      }
    }
  }

  /** The assistant's tool: write the proposal down and ask for the approval. Never runs anything. */
  async propose(a: Asker, p: ProposalInput): Promise<{ proposal?: string; summary?: string; error?: string }> {
    let built;
    try { built = await this.build(a, p); } catch (e) {
      await this.tools.audit(a, 'propose', null, p, 'denied', (e as Error).message);
      return { error: (e as Error).message };
    }
    const [row] = await this.db.query<{ id: string }>(`
      INSERT INTO kara_team.proposals (requested_by, approver, action, summary) VALUES ($1, $1, $2, $3) RETURNING id::text`,
    [a.accountId, JSON.stringify(built.action), built.summary]);
    await this.kartabl(a.accountId, row.id, built.summary).catch((e) => this.log.warn(`kartabl item: ${(e as Error).message}`));
    const mmUser = (await this.db.query<{ external_id: string }>(`SELECT external_id FROM kara_team.app_identities
      WHERE account_id = $1 AND app = 'mattermost' AND state = 'active'`, [a.accountId]))[0]?.external_id;
    if (mmUser && this.mm.botConfigured) {
      const post = await this.mm.dm(mmUser, '🔐 **درخواست تغییر — منتظر تأیید شما**', this.buttons(row.id, built.summary));
      await this.db.query(`UPDATE kara_team.proposals SET mm_post_id = $2 WHERE id = $1`, [row.id, post.id]);
    }
    await this.tools.audit(a, 'propose', built.action.issueKey ?? null, p, 'ok', row.id);
    teamEvents.inc({ source: 'proposal', outcome: 'created' });
    return { proposal: row.id, summary: built.summary };
  }

  private buttons(id: string, summary: string): MmAttachment[] {
    const url = config.team.commandUrl.replace(/\/command$/, '/action');
    return [{
      color: '#2563eb', text: `${summary}\n\n_تا وقتی تأیید نکنید، چیزی در Plane عوض نمی‌شود._`,
      actions: [
        { id: 'approve', name: 'تأیید و اجرا', style: 'primary', integration: { url, context: { proposal: id, decision: 'approve', sig: actionSig(id, 'approve') } } },
        { id: 'reject', name: 'رد', style: 'danger', integration: { url, context: { proposal: id, decision: 'reject', sig: actionSig(id, 'reject') } } },
      ],
    }];
  }

  /** An approval item in the approver's first kartabl (made if they have none). */
  private async kartabl(accountId: string, proposalId: string, summary: string) {
    const [c] = await this.db.query<{ schema: string }>(`SELECT c.schema_name AS schema FROM platform.user_accounts a
      JOIN platform.companies c ON c.id = a.company_id WHERE a.id = $1`, [accountId]);
    if (!c || !/^tenant_[a-z0-9_]{1,50}$/.test(c.schema)) return;
    const s = c.schema;
    const [m] = await this.db.query<{ id: string }>(`SELECT id::text FROM "${s}".members WHERE account_id = $1`, [accountId]);
    if (!m) return;
    let [k] = await this.db.query<{ id: string }>(`SELECT id::text FROM "${s}".kartabls WHERE member_id = $1 ORDER BY created_at LIMIT 1`, [m.id]);
    if (!k) [k] = await this.db.query<{ id: string }>(`INSERT INTO "${s}".kartabls (member_id, name) VALUES ($1, 'کارتابل') RETURNING id::text`, [m.id]);
    const [item] = await this.db.query<{ id: string }>(`
      INSERT INTO "${s}".kartabl_items (kartabl_id, title, body, kind, status, ref_kind, ref_id, created_by)
      VALUES ($1, $2, $3, 'approval', 'open', 'team_proposal', $4, $5) RETURNING id::text`,
    [k.id, 'تأیید تغییر پیشنهادی دستیار سیمرغ در Plane', `${summary.replace(/\*\*/g, '')}\n\nتأیید یا رد: پیام «Simorgh Assistant» در Mattermost.`, proposalId, m.id]);
    await this.db.query(`UPDATE kara_team.proposals SET kartabl_ref = $2 WHERE id = $1`, [proposalId, `${s}:${item.id}`]);
  }

  /** A button press from Mattermost. Returns the message to show in place of the buttons. */
  async decide(proposalId: string, decision: string, sig: string, mmUserId: string): Promise<{ text: string; ephemeral?: string }> {
    if (!sigOk(proposalId, decision, sig)) return { text: '', ephemeral: 'این دکمه معتبر نیست.' };
    const [p] = await this.db.query<{ approver: string; requested_by: string; action: Action; summary: string; status: string; kartabl_ref: string | null }>(
      `SELECT approver::text, requested_by::text, action, summary, status, kartabl_ref FROM kara_team.proposals WHERE id = $1`, [proposalId]);
    if (!p) return { text: '', ephemeral: 'این درخواست پیدا نشد.' };
    const [who] = await this.db.query<{ account_id: string }>(`SELECT account_id::text FROM kara_team.app_identities
      WHERE app = 'mattermost' AND external_id = $1 AND state = 'active'`, [mmUserId]);
    if (who?.account_id !== p.approver) return { text: '', ephemeral: 'فقط تأییدکننده این درخواست می‌تواند تصمیم بگیرد.' };
    // One decision only, even if the button is pressed twice.
    const claimed = await this.db.query(`UPDATE kara_team.proposals SET status = $2, decided_at = now(), decided_by = $3
      WHERE id = $1 AND status = 'pending' AND created_at > now() - interval '7 days' RETURNING 1`,
    [proposalId, decision === 'approve' ? 'approved' : 'rejected', p.approver]);
    if (!claimed.length) return { text: `🔐 ${p.summary}\n\n_این درخواست قبلاً بررسی شده یا منقضی شده است (${p.status})._` };
    await this.closeKartabl(p.kartabl_ref);
    const a = { accountId: p.approver, channel: 'mattermost' };
    if (decision !== 'approve') {
      await this.tools.audit(a, 'proposal_rejected', p.action.issueKey ?? null, { proposal: proposalId }, 'ok');
      teamEvents.inc({ source: 'proposal', outcome: 'rejected' });
      return { text: `❌ رد شد: ${p.summary}` };
    }
    try {
      const result = await this.execute(p.action, p.requested_by, p.approver);
      await this.db.query(`UPDATE kara_team.proposals SET status = 'executed', result = $2 WHERE id = $1`, [proposalId, result]);
      await this.tools.audit(a, 'proposal_executed', p.action.issueKey ?? null, { proposal: proposalId }, 'ok', result);
      teamEvents.inc({ source: 'proposal', outcome: 'executed' });
      return { text: `✅ انجام شد: ${p.summary}\n${result}` };
    } catch (e) {
      const msg = (e as Error).message.slice(0, 400);
      await this.db.query(`UPDATE kara_team.proposals SET status = 'failed', result = $2 WHERE id = $1`, [proposalId, msg]);
      await this.tools.audit(a, 'proposal_executed', p.action.issueKey ?? null, { proposal: proposalId }, 'error', msg);
      teamEvents.inc({ source: 'proposal', outcome: 'failed' });
      return { text: `⚠️ تأیید شد ولی Plane نپذیرفت: ${p.summary}\n\`${msg}\`` };
    }
  }

  private async closeKartabl(ref: string | null) {
    const m = /^(tenant_[a-z0-9_]{1,50}):([0-9a-f-]{36})$/.exec(ref ?? '');
    if (m) await this.db.query(`UPDATE "${m[1]}".kartabl_items SET status = 'done' WHERE id = $1`, [m[2]]).catch(() => undefined);
  }

  private async execute(x: Action, requestedBy: string, approver: string): Promise<string> {
    const [names] = await this.db.query<{ r: string; a: string }>(`
      SELECT (SELECT full_name FROM platform.user_accounts WHERE id = $1) AS r, (SELECT full_name FROM platform.user_accounts WHERE id = $2) AS a`,
    [requestedBy, approver]);
    const note = `<p><em>از طریق دستیار سیمرغ — درخواست: ${esc(names?.r ?? '?')}، تأیید: ${esc(names?.a ?? '?')}</em></p>`;
    switch (x.kind) {
      case 'set_state': case 'assign': case 'set_due_date':
        await this.plane.updateIssue(x.projectId, x.issueId!, x.patch!);
        await this.plane.comment(x.projectId, x.issueId!, note).catch(() => undefined);
        return this.plane.issueUrl(x.projectId, x.issueId!);
      case 'comment':
        await this.plane.comment(x.projectId, x.issueId!, `${x.html}${note}`);
        return this.plane.issueUrl(x.projectId, x.issueId!);
      case 'create_issue': {
        const i = await this.plane.createIssue(x.projectId, x.body!);
        await this.plane.comment(x.projectId, i.id, note).catch(() => undefined);
        return this.plane.issueUrl(x.projectId, i.id);
      }
    }
  }
}
