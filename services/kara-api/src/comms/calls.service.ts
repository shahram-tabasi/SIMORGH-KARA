import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { PoolClient } from 'pg';
import { config } from '../config';
import { DbService } from '../infra/db.service';
import { Actor, Tenant } from '../tenants/tenants.service';
import { JoinInfo, joinInfo, roomName } from './jitsi';
import { LiveService } from './live.service';

type CallStatus = 'ringing' | 'active' | 'ended' | 'missed' | 'declined' | 'cancelled';
type PartyState = 'ringing' | 'joined' | 'declined' | 'missed' | 'busy' | 'left' | 'cancelled';

interface CallRow { id: string; tenant_id: string; room: string; caller: string; video: boolean; status: CallStatus }
interface PartyRow { account_id: string; role: 'caller' | 'callee'; state: PartyState }

export interface CallView {
  id: string;
  video: boolean;
  status: CallStatus;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  direction: 'outgoing' | 'incoming';
  myState: PartyState;
  others: { accountId: string; name: string; state: PartyState }[];
}

/**
 * Calls between Kara users. Kara rings (live channel), Jitsi carries the call:
 * every call is a private Jitsi room `call-<id>`. The caller joins at once and
 * waits there; a callee who accepts joins the same room.
 *
 *   ringing ──accept──► active ──last one leaves──► ended
 *      ├── every callee declines / misses / is busy ──► declined | missed
 *      └── the caller hangs up first ──► cancelled
 */
@Injectable()
export class CallsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(CallsService.name);
  private sweeper?: NodeJS.Timeout;

  constructor(private readonly db: DbService, private readonly live: LiveService) {}

  onModuleInit() {
    // Unanswered calls become missed. UPDATE … RETURNING hands each row to one
    // replica only, so every replica may sweep.
    this.sweeper = setInterval(() => void this.sweep().catch((e) => this.log.warn(`sweep: ${(e as Error).message}`)), 5000);
  }

  onModuleDestroy() {
    if (this.sweeper) clearInterval(this.sweeper);
  }

  private async names(ids: string[]): Promise<Map<string, string>> {
    const rows = await this.db.query<{ id: string; name: string }>(
      'SELECT id, full_name AS name FROM platform.user_accounts WHERE id = ANY($1::uuid[])', [ids]);
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private user(actor: Actor) {
    return { id: actor.id, name: actor.fullName, email: actor.email };
  }

  /** Start a call from `actor` to members of the same tenant. */
  async start(actor: Actor, tenant: Tenant, to: string[], video: boolean): Promise<{ call: CallView; join: JoinInfo }> {
    const wanted = [...new Set(to.filter((id) => id !== actor.id))];
    if (wanted.length === 0) throw new BadRequestException('choose at least one person to call');
    if (wanted.length > 20) throw new BadRequestException('at most 20 people in one call');
    const members = await this.db.query<{ account_id: string }>(
      `SELECT account_id FROM "${tenant.schema}".members WHERE account_id = ANY($1::uuid[]) AND status = 'active'`, [wanted]);
    const callees = members.map((m) => m.account_id);
    if (callees.length !== wanted.length) throw new BadRequestException('everyone called must be an active member of this company');

    const id = randomUUID();
    const room = roomName('call', id);
    const busy = new Set(
      (await this.db.query<{ account_id: string }>(
        `SELECT DISTINCT p.account_id FROM kara_comms.call_parties p JOIN kara_comms.calls c ON c.id = p.call_id
          WHERE p.account_id = ANY($1::uuid[]) AND p.state IN ('ringing', 'joined') AND c.status IN ('ringing', 'active')`,
        [callees])).map((r) => r.account_id),
    );
    await this.db.tx(async (c) => {
      await c.query('INSERT INTO kara_comms.calls (id, tenant_id, room, caller, video, status) VALUES ($1, $2, $3, $4, $5, $6)',
        [id, tenant.id, room, actor.id, video, 'ringing']);
      await c.query(`INSERT INTO kara_comms.call_parties (call_id, account_id, role, state) VALUES ($1, $2, 'caller', 'joined')`, [id, actor.id]);
      for (const a of callees) {
        await c.query(`INSERT INTO kara_comms.call_parties (call_id, account_id, role, state) VALUES ($1, $2, 'callee', $3)`,
          [id, a, busy.has(a) ? 'busy' : 'ringing']);
      }
    });
    const ringing = callees.filter((a) => !busy.has(a));
    await this.live.publish(ringing, {
      type: 'call.incoming', callId: id, video, tenant: tenant.slug,
      from: { accountId: actor.id, name: actor.fullName }, others: callees.length,
    });
    for (const a of busy) await this.live.publish([actor.id], { type: 'call.busy', callId: id, by: a });
    this.log.log(`call ${id}: ${actor.email} → ${callees.length} (${busy.size} busy)`);
    if (ringing.length === 0) await this.finishIfDone(id);
    return { call: await this.view(id, actor.id), join: await joinInfo(room, this.user(actor), true) };
  }

  /** The callee answers: into the room. */
  async accept(actor: Actor, callId: string): Promise<{ call: CallView; join: JoinInfo }> {
    const call = await this.db.tx(async (c) => {
      const call = await this.lock(c, callId);
      const me = await this.party(c, callId, actor.id);
      if (me.state === 'joined') return call;
      if (me.state !== 'ringing' || !['ringing', 'active'].includes(call.status)) {
        throw new BadRequestException('this call is no longer ringing');
      }
      await this.setState(c, callId, actor.id, 'joined');
      await c.query(`UPDATE kara_comms.calls SET status = 'active', answered_at = coalesce(answered_at, now()) WHERE id = $1`, [callId]);
      return call;
    });
    const parties = await this.parties(callId);
    await this.live.publish(parties.filter((p) => p.account_id !== actor.id).map((p) => p.account_id),
      { type: 'call.accepted', callId, by: { accountId: actor.id, name: actor.fullName } });
    // The other tabs of the same person stop ringing.
    await this.live.publish([actor.id], { type: 'call.handled', callId });
    return { call: await this.view(callId, actor.id), join: await joinInfo(call.room, this.user(actor), true) };
  }

  async decline(actor: Actor, callId: string): Promise<CallView> {
    const call = await this.db.tx(async (c) => {
      const call = await this.lock(c, callId);
      const me = await this.party(c, callId, actor.id);
      if (me.state === 'ringing') await this.setState(c, callId, actor.id, 'declined');
      return call;
    });
    await this.live.publish([call.caller], { type: 'call.declined', callId, by: { accountId: actor.id, name: actor.fullName } });
    await this.live.publish([actor.id], { type: 'call.handled', callId });
    await this.finishIfDone(callId);
    return this.view(callId, actor.id);
  }

  /** Hang up: the caller before an answer cancels; anyone else leaves. */
  async leave(actor: Actor, callId: string): Promise<CallView> {
    let cancelled: string[] = [];
    await this.db.tx(async (c) => {
      const call = await this.lock(c, callId);
      const me = await this.party(c, callId, actor.id);
      if (call.status === 'ringing' && me.role === 'caller') {
        const r = await c.query<{ account_id: string }>(
          `UPDATE kara_comms.call_parties SET state = 'cancelled', updated_at = now()
            WHERE call_id = $1 AND state = 'ringing' RETURNING account_id`, [callId]);
        cancelled = r.rows.map((x) => x.account_id);
        await this.setState(c, callId, actor.id, 'left');
        await c.query(`UPDATE kara_comms.calls SET status = 'cancelled', ended_at = now() WHERE id = $1`, [callId]);
      } else if (me.state === 'joined') {
        await this.setState(c, callId, actor.id, 'left');
      }
    });
    if (cancelled.length) await this.live.publish(cancelled, { type: 'call.cancelled', callId });
    await this.finishIfDone(callId);
    return this.view(callId, actor.id);
  }

  /** Calls still ringing for `account`: resent when a tab (re)connects, so a ring is never lost. */
  async ringingFor(account: string) {
    const rows = await this.db.query<{ id: string; video: boolean; caller: string; caller_name: string; slug: string; others: number }>(
      `SELECT c.id, c.video, c.caller, a.full_name AS caller_name, t.slug,
              (SELECT count(*)::int FROM kara_comms.call_parties x WHERE x.call_id = c.id AND x.role = 'callee') AS others
         FROM kara_comms.call_parties p
         JOIN kara_comms.calls c ON c.id = p.call_id
         JOIN platform.user_accounts a ON a.id = c.caller
         JOIN platform.companies t ON t.id = c.tenant_id
        WHERE p.account_id = $1 AND p.state = 'ringing' AND c.status IN ('ringing', 'active')`, [account]);
    return rows.map((r) => ({
      type: 'call.incoming', callId: r.id, video: r.video, tenant: r.slug,
      from: { accountId: r.caller, name: r.caller_name }, others: r.others,
    }));
  }

  async history(actor: Actor, tenant: Tenant, limit: number): Promise<CallView[]> {
    const rows = await this.db.query<{ id: string }>(
      `SELECT c.id FROM kara_comms.calls c JOIN kara_comms.call_parties p ON p.call_id = c.id
        WHERE c.tenant_id = $1 AND p.account_id = $2 ORDER BY c.started_at DESC LIMIT $3`,
      [tenant.id, actor.id, Math.min(Math.max(limit, 1), 100)]);
    return Promise.all(rows.map((r) => this.view(r.id, actor.id)));
  }

  /** Ended when nobody can still answer and at most one person is left in the room. */
  private async finishIfDone(callId: string) {
    let notify: string[] = [];
    let reason: CallStatus | undefined;
    await this.db.tx(async (c) => {
      const call = await this.lock(c, callId);
      if (!['ringing', 'active'].includes(call.status)) return;
      const parties = (await c.query<PartyRow>('SELECT account_id, role, state FROM kara_comms.call_parties WHERE call_id = $1', [callId])).rows;
      const ringing = parties.some((p) => p.state === 'ringing');
      const joined = parties.filter((p) => p.state === 'joined');
      if (ringing) return;
      if (call.status === 'ringing') {
        reason = parties.some((p) => p.state === 'missed') ? 'missed' : parties.some((p) => p.state === 'declined') ? 'declined' : 'ended';
      } else if (joined.length <= 1) {
        reason = 'ended';
      } else return;
      await c.query(`UPDATE kara_comms.call_parties SET state = 'left', updated_at = now() WHERE call_id = $1 AND state = 'joined'`, [callId]);
      await c.query('UPDATE kara_comms.calls SET status = $2, ended_at = now() WHERE id = $1', [callId, reason]);
      notify = joined.map((p) => p.account_id);
    });
    if (reason && notify.length) await this.live.publish(notify, { type: 'call.ended', callId, reason });
  }

  private async sweep() {
    const rows = await this.db.query<{ call_id: string; account_id: string }>(
      `UPDATE kara_comms.call_parties SET state = 'missed', updated_at = now()
        WHERE state = 'ringing' AND updated_at < now() - make_interval(secs => $1) RETURNING call_id, account_id`,
      [config.calls.ringSeconds]);
    for (const r of rows) {
      const [call] = await this.db.query<CallRow>('SELECT * FROM kara_comms.calls WHERE id = $1', [r.call_id]);
      const names = await this.names([call.caller]);
      await this.live.publish([r.account_id], {
        type: 'call.missed', callId: r.call_id, from: { accountId: call.caller, name: names.get(call.caller) ?? '' },
      });
      await this.live.publish([call.caller], { type: 'call.unanswered', callId: r.call_id, by: r.account_id });
      await this.finishIfDone(r.call_id);
    }
  }

  private async lock(c: PoolClient, callId: string): Promise<CallRow> {
    if (!/^[0-9a-f-]{36}$/i.test(callId)) throw new NotFoundException('no such call');
    const r = await c.query<CallRow>('SELECT * FROM kara_comms.calls WHERE id = $1 FOR UPDATE', [callId]);
    if (!r.rows[0]) throw new NotFoundException('no such call');
    return r.rows[0];
  }

  private async party(c: PoolClient, callId: string, account: string): Promise<PartyRow> {
    const r = await c.query<PartyRow>('SELECT account_id, role, state FROM kara_comms.call_parties WHERE call_id = $1 AND account_id = $2', [callId, account]);
    if (!r.rows[0]) throw new ForbiddenException('not in this call');
    return r.rows[0];
  }

  private async setState(c: PoolClient, callId: string, account: string, state: PartyState) {
    await c.query('UPDATE kara_comms.call_parties SET state = $3, updated_at = now() WHERE call_id = $1 AND account_id = $2', [callId, account, state]);
  }

  private parties(callId: string) {
    return this.db.query<PartyRow>('SELECT account_id, role, state FROM kara_comms.call_parties WHERE call_id = $1', [callId]);
  }

  private async view(callId: string, me: string): Promise<CallView> {
    const [call] = await this.db.query<CallRow & { started_at: Date; answered_at: Date | null; ended_at: Date | null }>(
      'SELECT * FROM kara_comms.calls WHERE id = $1', [callId]);
    const parties = await this.parties(callId);
    const names = await this.names(parties.map((p) => p.account_id));
    const mine = parties.find((p) => p.account_id === me);
    return {
      id: call.id, video: call.video, status: call.status,
      startedAt: call.started_at.toISOString(), answeredAt: call.answered_at?.toISOString() ?? null, endedAt: call.ended_at?.toISOString() ?? null,
      direction: call.caller === me ? 'outgoing' : 'incoming',
      myState: mine?.state ?? 'left',
      others: parties.filter((p) => p.account_id !== me).map((p) => ({ accountId: p.account_id, name: names.get(p.account_id) ?? '', state: p.state })),
    };
  }
}
