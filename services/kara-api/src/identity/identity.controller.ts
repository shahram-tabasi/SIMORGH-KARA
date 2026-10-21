import { Body, Controller, ForbiddenException, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { ActorGuard, CurrentActor } from '../auth/actor.guard';
import { Actor, TenantsService } from '../tenants/tenants.service';
import { IdentityService } from './identity.service';

/**
 *   POST /v1/identity/accounts/:id/sync   {invite?: boolean}
 * after kara-web creates or changes an account. Allowed for the platform
 * admin, the holding admin of the account's holding, and a member of the
 * account's tenant with members.manage.
 *   POST /v1/identity/sync-all            {invite?: boolean}   platform admin
 */
@Controller('v1/identity')
@UseGuards(ActorGuard)
export class IdentityController {
  constructor(private readonly identity: IdentityService, private readonly tenants: TenantsService) {}

  @Post('accounts/:id/sync')
  async syncOne(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: { invite?: boolean }) {
    const account = await this.tenants.accountById(id);
    if (!account) throw new NotFoundException('no such account');
    await this.mayManage(actor, account.companyId, account.holdingId);
    return this.identity.sync(account, { invite: body?.invite !== false });
  }

  @Post('sync-all')
  async syncAll(@CurrentActor() actor: Actor, @Body() body: { invite?: boolean }) {
    if (actor.kind !== 'platform') throw new ForbiddenException('platform admin only');
    return this.identity.syncAll({ invite: body?.invite === true });
  }

  private async mayManage(actor: Actor, companyId: string | null, holdingId: string | null) {
    if (actor.kind === 'platform') return;
    const tenant = companyId ? await this.tenants.tenantById(companyId) : undefined;
    if (actor.kind === 'holding') {
      if (actor.holdingId && (holdingId === actor.holdingId || tenant?.holdingId === actor.holdingId)) return;
    } else if (tenant) {
      await this.tenants.require(actor, tenant.slug, 'members.manage');
      return;
    }
    throw new ForbiddenException('not your account to manage');
  }
}
