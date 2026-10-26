import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ActorGuard, CurrentActor } from '../auth/actor.guard';
import { DbService } from '../infra/db.service';
import type { Actor } from '../tenants/tenants.service';
import { CompanyDeleteService } from './company-delete.service';
import { orgSets, seedOrg } from './seed-org';

/**
 *   DELETE /v1/admin/companies/:slug   {confirm: "<slug>", outside?: boolean}
 * removes a company and all its data (CompanyDeleteService); outside (default
 * true) also clears Keycloak and archives what Kara made in Odoo.
 *
 *   GET  /v1/admin/org-sets                       companies with a prepared organisation
 *   POST /v1/admin/companies/:slug/seed-org       {dryRun?: boolean, prune?: boolean}
 * lays the prepared organisation onto the company (seed-org.ts, as cli.js
 * seed-org) and returns its report line by line; dryRun (default true) only
 * says what it would do.
 *
 * Platform admin only.
 */
@Controller('v1/admin')
@UseGuards(ActorGuard)
export class AdminController {
  constructor(private readonly companies: CompanyDeleteService, private readonly db: DbService) {}

  @Delete('companies/:slug')
  async deleteCompany(@CurrentActor() actor: Actor, @Param('slug') slug: string, @Body() body: { confirm?: string; outside?: boolean }) {
    if (actor.kind !== 'platform') throw new ForbiddenException('platform admin only');
    return this.companies.delete(slug, String(body?.confirm ?? ''), { outside: body?.outside !== false });
  }

  @Get('org-sets')
  sets(@CurrentActor() actor: Actor) {
    if (actor.kind !== 'platform') throw new ForbiddenException('platform admin only');
    return { items: orgSets() };
  }

  @Post('companies/:slug/seed-org')
  async seed(@CurrentActor() actor: Actor, @Param('slug') slug: string, @Body() body: { dryRun?: boolean; prune?: boolean }) {
    if (actor.kind !== 'platform') throw new ForbiddenException('platform admin only');
    const dryRun = body?.dryRun !== false;
    try {
      return { dryRun, report: await seedOrg(this.db, slug, { dryRun, prune: body?.prune === true, place: {} }) };
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }
}
