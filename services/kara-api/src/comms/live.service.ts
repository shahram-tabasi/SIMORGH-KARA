import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Response } from 'express';
import { Client } from 'pg';
import { config } from '../config';
import { DbService } from '../infra/db.service';

const CHANNEL = 'kara_live';

export interface LiveEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * Kara's live channel to the browser: each signed-in tab holds one
 * server-sent-events stream (GET /v1/me/live, through kara-web). Events for an
 * account go through Postgres NOTIFY, so whichever kara-api replica holds that
 * person's stream delivers them: no extra broker.
 */
@Injectable()
export class LiveService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(LiveService.name);
  private readonly streams = new Map<string, Set<Response>>();
  private listener?: Client;
  private heartbeat?: NodeJS.Timeout;
  private stopped = false;

  constructor(private readonly db: DbService) {}

  async onModuleInit() {
    void this.listen();
    // A comment line every 25 s keeps proxies from closing an idle stream.
    this.heartbeat = setInterval(() => {
      for (const set of this.streams.values()) for (const res of set) res.write(': ping\n\n');
    }, 25_000);
  }

  async onModuleDestroy() {
    this.stopped = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const set of this.streams.values()) for (const res of set) res.end();
    await this.listener?.end().catch(() => undefined);
  }

  /** LISTEN on its own connection, reconnecting after a drop. */
  private async listen() {
    while (!this.stopped) {
      const client = new Client({ connectionString: config.databaseUrl });
      try {
        await client.connect();
        client.on('notification', (n) => this.deliver(n.payload));
        await client.query(`LISTEN ${CHANNEL}`);
        this.listener = client;
        this.log.log('live channel listening');
        await new Promise<void>((resolve) => {
          client.on('error', () => resolve());
          client.on('end', () => resolve());
        });
      } catch (e) {
        this.log.warn(`live channel: ${(e as Error).message}`);
      }
      await client.end().catch(() => undefined);
      if (!this.stopped) await new Promise((r) => setTimeout(r, 2000));
    }
  }

  private deliver(payload?: string) {
    if (!payload) return;
    try {
      const { to, event } = JSON.parse(payload) as { to: string[]; event: LiveEvent };
      const line = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
      for (const account of to) for (const res of this.streams.get(account) ?? []) res.write(line);
    } catch (e) {
      this.log.warn(`live channel: bad payload (${(e as Error).message})`);
    }
  }

  /** Send `event` to every open tab of these accounts, on any replica. */
  async publish(to: string[], event: LiveEvent) {
    if (to.length === 0) return;
    await this.db.query('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify({ to, event })]);
  }

  /** Hold `res` open as this account's event stream until the client goes; `first` is sent at once. */
  attach(account: string, res: Response, first: LiveEvent[] = []) {
    res.status(200);
    res.setHeader('content-type', 'text/event-stream; charset=utf-8');
    res.setHeader('cache-control', 'no-cache, no-transform');
    res.setHeader('connection', 'keep-alive');
    res.setHeader('x-accel-buffering', 'no');
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    for (const event of first) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    let set = this.streams.get(account);
    if (!set) this.streams.set(account, (set = new Set()));
    set.add(res);
    res.on('close', () => {
      set!.delete(res);
      if (set!.size === 0) this.streams.delete(account);
    });
  }
}
