import { Body, Controller, Delete, ForbiddenException, Param, UseGuards } from '@nestjs/common';
import { ActorGuard, CurrentActor } from '../auth/actor.guard';
import type { Actor } from '../tenants/tenants.service';
import { CompanyDeleteService } from './company-delete.service';

/**
 *   DELETE /v1/admin/companies/:slug   {confirm: "<slug>", outside?: boolean}
 * removes a company and all its data (CompanyDeleteService); outside (default
 * true) also clears Keycloak and archives what Kara made in Odoo. Platform
 * admin only; returns what was done, step by step.
 */
@Controller('v1/admin')
@UseGuards(ActorGuard)
export class AdminController {
  constructor(private readonly companies: CompanyDeleteService) {}

  @Delete('companies/:slug')
  async deleteCompany(@CurrentActor() actor: Actor, @Param('slug') slug: string, @Body() body: { confirm?: string; outside?: boolean }) {
    if (actor.kind !== 'platform') throw new ForbiddenException('platform admin only');
    return this.companies.delete(slug, String(body?.confirm ?? ''), { outside: body?.outside !== false });
  }
}
