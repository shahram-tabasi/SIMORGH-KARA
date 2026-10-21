import { CanActivate, createParamDecorator, ExecutionContext, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { config } from '../config';
import { Account, Actor, TenantsService } from '../tenants/tenants.service';
import { verifyToken } from './keycloak';

type WithActor = Request & { actor?: Actor };

const kindOf = (a: Account): Actor['kind'] => (a.isPlatformAdmin ? 'platform' : a.isHoldingAdmin ? 'holding' : 'tenant');

/**
 * Every /v1 call carries a realm-kara access token:
 *  - a person's token (a mobile app, later): the account is the one with the
 *    token's verified email;
 *  - the service-account token of a trusted client (kara-web, which keeps its
 *    own session for the person) with X-Kara-Account: that account.
 * Either way the account must be active; tenant rights are checked per call.
 */
@Injectable()
export class ActorGuard implements CanActivate {
  private readonly log = new Logger(ActorGuard.name);

  constructor(private readonly tenants: TenantsService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<WithActor>();
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '');
    if (!m) throw new UnauthorizedException('Bearer token required');
    let token;
    try {
      token = await verifyToken(m[1]);
    } catch (e) {
      this.log.warn(`token refused: ${(e as Error).message}`);
      throw new UnauthorizedException('invalid token');
    }
    const via = token.azp ?? 'unknown';
    // Keycloak marks a client-credentials token with client_id (and names its
    // user service-account-<client> when the profile scope is on).
    const serviceAccount = typeof token.client_id === 'string' || !!token.preferred_username?.startsWith('service-account-');
    let account: Account | undefined;
    if (serviceAccount) {
      if (!config.keycloak.trustedClients.includes(via)) throw new ForbiddenException(`client ${via} may not act for accounts`);
      const id = String(req.headers['x-kara-account'] ?? '');
      if (!id) throw new UnauthorizedException('X-Kara-Account required');
      account = await this.tenants.accountById(id);
    } else {
      if (!token.email || token.email_verified !== true) throw new ForbiddenException('token has no verified email');
      account = await this.tenants.accountByEmail(token.email);
    }
    if (!account || account.status !== 'active') throw new ForbiddenException('no active Kara account');
    req.actor = { ...account, kind: kindOf(account), via };
    return true;
  }
}

export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor => {
  const actor = ctx.switchToHttp().getRequest<WithActor>().actor;
  if (!actor) throw new UnauthorizedException();
  return actor;
});
