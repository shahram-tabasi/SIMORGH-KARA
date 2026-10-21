import { Injectable, Logger } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DbService } from '../infra/db.service';
import { readModelSize } from '../infra/metrics';
import { ConnectorClient } from './connector.client';
import { companyOf, ENTITIES, ErpEntity, nameOf } from './entities';

const BACKFILL_LOCK = 0x6b617261; // 'kara'
const PAGE = 500;

export interface ListQuery {
  q?: string;
  limit: number;
  offset: number;
  includeArchived: boolean;
}

/**
 * Odoo's objects in Kara's database, filled from the erp.* events (and once
 * from the connector's lists). Lists and searches never wait on Odoo.
 *
 * Every write keeps the newest: an event older than what is stored changes
 * nothing, and a deletion is final (Odoo never reuses an id). So events may
 * come twice, late or out of order between topics.
 */
@Injectable()
export class ReadModelService {
  private readonly log = new Logger(ReadModelService.name);

  constructor(private readonly db: DbService, private readonly connector: ConnectorClient) {}

  /** Returns false when the stored row was already as new or newer. */
  async upsert(entity: ErpEntity, data: Record<string, unknown>, c?: PoolClient): Promise<boolean> {
    const id = Number(data.id);
    if (!Number.isInteger(id)) throw new Error(`${entity.name} without an id`);
    const sql = `
      INSERT INTO kara_erp.records (entity, odoo_id, company_id, name, active, data, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (entity, odoo_id) DO UPDATE SET
        company_id = EXCLUDED.company_id, name = EXCLUDED.name, active = EXCLUDED.active,
        data = EXCLUDED.data, updated_at = EXCLUDED.updated_at, synced_at = now()
      WHERE NOT kara_erp.records.deleted
        AND (kara_erp.records.updated_at IS NULL OR EXCLUDED.updated_at IS NULL
             OR EXCLUDED.updated_at >= kara_erp.records.updated_at)`;
    const params = [entity.name, id, companyOf(data), nameOf(data), data.active !== false, JSON.stringify(data), data.updatedAt ?? null];
    const res = await (c ?? this.db.pool).query(sql, params);
    return (res.rowCount ?? 0) > 0;
  }

  async markDeleted(entity: ErpEntity, id: number): Promise<void> {
    await this.db.query(
      `INSERT INTO kara_erp.records (entity, odoo_id, deleted) VALUES ($1, $2, true)
       ON CONFLICT (entity, odoo_id) DO UPDATE SET deleted = true, synced_at = now()`,
      [entity.name, id],
    );
  }

  /** The records a tenant (its Odoo company) sees. */
  private visible(entity: ErpEntity) {
    return entity.sharedWithoutCompany ? '(company_id = $2 OR company_id IS NULL)' : 'company_id = $2';
  }

  async list(entity: ErpEntity, companyId: number, q: ListQuery) {
    const where = [`entity = $1`, `NOT deleted`, this.visible(entity)];
    const params: unknown[] = [entity.name, companyId];
    if (!q.includeArchived) where.push('active');
    if (q.q) {
      params.push(`%${q.q.replace(/[\\%_]/g, m => `\\${m}`)}%`);
      const n = params.length;
      where.push(`(name ILIKE $${n} OR ${entity.searchFields.map(f => `data->>'${f}' ILIKE $${n}`).join(' OR ')})`);
    }
    const w = where.join(' AND ');
    const [{ total }] = await this.db.query<{ total: string }>(`SELECT count(*) AS total FROM kara_erp.records WHERE ${w}`, params);
    const rows = await this.db.query<{ data: Record<string, unknown> }>(
      `SELECT data FROM kara_erp.records WHERE ${w} ORDER BY name, odoo_id LIMIT ${q.limit} OFFSET ${q.offset}`,
      params,
    );
    return { total: Number(total), limit: q.limit, offset: q.offset, items: rows.map(r => r.data) };
  }

  async get(entity: ErpEntity, companyId: number, id: number) {
    const [row] = await this.db.query<{ data: Record<string, unknown> }>(
      `SELECT data FROM kara_erp.records WHERE entity = $1 AND NOT deleted AND ${this.visible(entity)} AND odoo_id = $3`,
      [entity.name, companyId, id],
    );
    return row?.data;
  }

  async counts(companyId: number): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const e of ENTITIES) {
      const [{ n }] = await this.db.query<{ n: string }>(
        `SELECT count(*) AS n FROM kara_erp.records WHERE entity = $1 AND NOT deleted AND active AND ${this.visible(e)}`,
        [e.name, companyId],
      );
      out[e.collection] = Number(n);
    }
    return out;
  }

  /**
   * The first time: every record from the connector, page by page, so Kara
   * does not depend on how long Kafka keeps its events. One replica does it
   * (advisory lock); a failure is retried on the next start or call.
   */
  async backfill(): Promise<void> {
    if (!this.connector.configured) return;
    const c = await this.db.pool.connect();
    try {
      if (!(await c.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [BACKFILL_LOCK])).rows[0].ok) return;
      try {
        for (const e of ENTITIES) {
          if ((await c.query('SELECT 1 FROM kara_erp.backfills WHERE entity = $1', [e.name])).rowCount) continue;
          let n = 0;
          for (let offset = 0; ; offset += PAGE) {
            const page = await this.connector.call<{ items: Record<string, unknown>[] }>(
              'GET', `/v1/${e.collection}?updatedSince=1970-01-01T00:00:00Z&limit=${PAGE}&offset=${offset}`,
            );
            for (const item of page.items) await this.upsert(e, item, c);
            n += page.items.length;
            if (page.items.length < PAGE) break;
          }
          await c.query('INSERT INTO kara_erp.backfills (entity) VALUES ($1) ON CONFLICT DO NOTHING', [e.name]);
          this.log.log(`backfill ${e.name}: ${n} records`);
        }
      } finally {
        await c.query('SELECT pg_advisory_unlock($1)', [BACKFILL_LOCK]);
      }
    } finally {
      c.release();
    }
  }

  async gauges(): Promise<void> {
    const rows = await this.db.query<{ entity: string; n: string }>(
      'SELECT entity, count(*) AS n FROM kara_erp.records WHERE NOT deleted GROUP BY entity',
    );
    for (const e of ENTITIES) readModelSize.set({ entity: e.name }, Number(rows.find(r => r.entity === e.name)?.n ?? 0));
  }
}
