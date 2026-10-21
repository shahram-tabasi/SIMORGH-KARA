import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ServiceToken } from '../auth/keycloak';
import { config } from '../config';
import { connectorCalls } from '../infra/metrics';

/** The erp-connector, as caller `kara` (docs/erp-connector-api.md in simorgh-odoo). */
@Injectable()
export class ConnectorClient {
  private readonly log = new Logger(ConnectorClient.name);
  private readonly token = new ServiceToken(config.erp.tokenUrl, config.erp.clientId, config.erp.clientSecret);

  get configured(): boolean {
    return !!config.erp.url && (this.token.configured || !!config.erp.staticToken);
  }

  async call<T>(method: string, path: string, opts: { body?: unknown; idempotencyKey?: string; requestId?: string } = {}): Promise<T> {
    if (!this.configured) throw new HttpException('the erp-connector is not configured', HttpStatus.SERVICE_UNAVAILABLE);
    const bearer = config.erp.staticToken || (await this.token.get());
    let res: Response;
    try {
      res = await fetch(`${config.erp.url}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${bearer}`,
          ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(opts.idempotencyKey ? { 'idempotency-key': opts.idempotencyKey } : {}),
          ...(opts.requestId ? { 'x-request-id': opts.requestId } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(config.erp.timeoutMs),
      });
    } catch (e) {
      connectorCalls.inc({ method, status: 'unreachable' });
      this.log.error(`${method} ${path}: ${(e as Error).message}`);
      throw new HttpException('Odoo is unreachable right now; try again shortly', HttpStatus.SERVICE_UNAVAILABLE);
    }
    connectorCalls.inc({ method, status: String(res.status) });
    const text = await res.text();
    const body = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      // 4xx: the connector's own message (a field, a right) is for the user.
      if (res.status < 500 && res.status !== 401) throw new HttpException(body ?? { message: `HTTP ${res.status}` }, res.status);
      this.log.error(`${method} ${path}: HTTP ${res.status} ${text.slice(0, 300)}`);
      throw new HttpException('Odoo could not answer right now; try again shortly', HttpStatus.SERVICE_UNAVAILABLE);
    }
    return body as T;
  }
}
