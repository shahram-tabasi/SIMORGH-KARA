import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, HttpException, HttpStatus, NotFoundException, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ActorGuard, CurrentActor } from '../auth/actor.guard';
import { Actor, Tenant, TenantsService } from '../tenants/tenants.service';
import { ConnectorClient } from './connector.client';
import { byCollection, ErpEntity } from './entities';
import { ReadModelService } from './read-model.service';

function entityOf(collection: string): ErpEntity {
  const e = byCollection.get(collection);
  if (!e) throw new NotFoundException(`no such collection: ${collection}`);
  return e;
}

/** A tenant not linked to an Odoo company has no ERP data: 409 with a code kara-web shows. */
function linked(t: Tenant): number {
  if (t.odooCompanyId == null) throw new HttpException({ statusCode: 409, code: 'not_linked', message: `${t.slug} is not linked to an Odoo company` }, HttpStatus.CONFLICT);
  return t.odooCompanyId;
}

/**
 * A tenant's Odoo data (erp.view to read, erp.manage to create):
 *   GET  /v1/tenants/:slug/erp                         linked?, counts
 *   GET  /v1/tenants/:slug/erp/:collection?q=&limit=&offset=&includeArchived=
 *   GET  /v1/tenants/:slug/erp/:collection/:id
 *   POST /v1/tenants/:slug/erp/partners|products       {…, externalId?}  Idempotency-Key
 * Platform admin:
 *   GET  /v1/admin/erp/companies                       Odoo's companies
 *   PUT  /v1/admin/tenants/:slug/erp-link              {odooCompanyId: number | null}
 */
@Controller('v1')
@UseGuards(ActorGuard)
export class ErpController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly readModel: ReadModelService,
    private readonly connector: ConnectorClient,
  ) {}

  @Get('tenants/:slug/erp')
  async status(@CurrentActor() actor: Actor, @Param('slug') slug: string) {
    const { tenant } = await this.tenants.require(actor, slug, 'erp.view');
    if (tenant.odooCompanyId == null) return { linked: false };
    return { linked: true, odooCompanyId: tenant.odooCompanyId, counts: await this.readModel.counts(tenant.odooCompanyId) };
  }

  @Get('tenants/:slug/erp/:collection')
  async list(
    @CurrentActor() actor: Actor,
    @Param('slug') slug: string,
    @Param('collection') collection: string,
    @Query('q') q?: string,
    @Query('limit') limit = '50',
    @Query('offset') offset = '0',
    @Query('includeArchived') includeArchived?: string,
  ) {
    const entity = entityOf(collection);
    const { tenant } = await this.tenants.require(actor, slug, 'erp.view');
    return this.readModel.list(entity, linked(tenant), {
      q: q?.trim().slice(0, 100) || undefined,
      limit: Math.min(Math.max(Number(limit) || 50, 1), 200),
      offset: Math.max(Number(offset) || 0, 0),
      includeArchived: includeArchived === 'true',
    });
  }

  @Get('tenants/:slug/erp/:collection/:id')
  async get(@CurrentActor() actor: Actor, @Param('slug') slug: string, @Param('collection') collection: string, @Param('id', ParseIntPipe) id: number) {
    const entity = entityOf(collection);
    const { tenant } = await this.tenants.require(actor, slug, 'erp.view');
    const found = await this.readModel.get(entity, linked(tenant), id);
    if (!found) throw new NotFoundException(`${entity.name} ${id} not found`);
    return found;
  }

  @Post('tenants/:slug/erp/:collection')
  async create(
    @CurrentActor() actor: Actor,
    @Param('slug') slug: string,
    @Param('collection') collection: string,
    @Body() body: Record<string, unknown>,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    const entity = entityOf(collection);
    if (!entity.creatable) throw new BadRequestException(`${collection} cannot be created from Kara`);
    const { tenant } = await this.tenants.require(actor, slug, 'erp.manage');
    const companyId = linked(tenant);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('a JSON object is required');
    const { externalId, companyId: _ignored, ...fields } = body;
    const record = await this.connector.call<Record<string, unknown>>('POST', `/v1/${entity.collection}`, {
      // The tenant's company always; the external id is kept unique per tenant.
      body: { ...fields, companyId, ...(externalId ? { externalId: `${slug}:${String(externalId)}` } : {}) },
      idempotencyKey: idempotencyKey ? `${slug}:${idempotencyKey}` : undefined,
      requestId,
    });
    // Read your own write: the event will say the same a moment later.
    await this.readModel.upsert(entity, record);
    return record;
  }

  @Get('admin/erp/companies')
  async companies(@CurrentActor() actor: Actor) {
    this.platformOnly(actor);
    const [odoo, linkedTenants] = await Promise.all([
      this.connector.call<{ items: { id: number; name: string }[] }>('GET', '/v1/companies'),
      this.tenants.linkedTenants(),
    ]);
    return {
      items: odoo.items.map(c => ({ ...c, tenants: linkedTenants.filter(t => t.odooCompanyId === c.id).map(t => t.slug) })),
    };
  }

  @Put('admin/tenants/:slug/erp-link')
  async link(@CurrentActor() actor: Actor, @Param('slug') slug: string, @Body() body: { odooCompanyId?: number | null }) {
    this.platformOnly(actor);
    const id = body?.odooCompanyId ?? null;
    if (id !== null && !(Number.isInteger(id) && id > 0)) throw new BadRequestException('odooCompanyId must be a positive integer or null');
    if (id !== null) {
      const { items } = await this.connector.call<{ items: { id: number }[] }>('GET', '/v1/companies');
      if (!items.some(c => c.id === id)) throw new BadRequestException(`Odoo has no company ${id}`);
    }
    const t = await this.tenants.setOdooCompany(slug, id);
    return { slug: t.slug, odooCompanyId: t.odooCompanyId };
  }

  private platformOnly(actor: Actor) {
    if (actor.kind !== 'platform') throw new ForbiddenException('platform admin only');
  }
}
