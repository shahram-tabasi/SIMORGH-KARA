import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { config } from '../config';

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(DbService.name);
  readonly pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

  async onModuleInit() {
    // The database may come up after the pod: wait up to a minute.
    for (let attempt = 1; ; attempt++) {
      try {
        await this.pool.query(readFileSync(join(__dirname, 'schema.sql'), 'utf8'));
        this.log.log('schema ready');
        return;
      } catch (e) {
        if (attempt >= 30) throw e;
        this.log.warn(`database not ready (${(e as Error).message}); retrying`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  async query<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.pool.query<T>(sql, params)).rows;
  }

  /** One transaction; rolled back if `fn` throws. */
  async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }
}
