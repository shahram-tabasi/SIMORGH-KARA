import { BadRequestException, Body, Controller, Get, HttpException, HttpStatus, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ActorGuard, CurrentActor } from '../auth/actor.guard';
import { ConnectorClient } from '../erp/connector.client';
import { Actor, TenantsService } from '../tenants/tenants.service';

type Json = Record<string, unknown>;

const ACTIONS = ['start', 'pause', 'finish'];

/**
 * The shop floor and the field service of a tenant's Odoo company, live
 * through the erp-connector (/v1/shop-floor, simorgh_shopfloor in Odoo):
 *   GET  /v1/tenants/:slug/shop-floor/work-orders?workcenterId=&q=          shopfloor.use
 *   POST /v1/tenants/:slug/shop-floor/work-orders/:id/start|pause|finish    shopfloor.use
 *   POST /v1/tenants/:slug/shop-floor/manufacturing-orders/:id/consume      shopfloor.use  {moveId, quantity}
 *   POST /v1/tenants/:slug/shop-floor/manufacturing-orders/:id/scrap        shopfloor.use  {productId, quantity, reason}
 *   GET  /v1/tenants/:slug/shop-floor/service-orders?includeClosed=         service.report
 *   POST /v1/tenants/:slug/shop-floor/service-orders/:id/report             service.report {resolution, signature?, signedBy?, complete?}
 * The person is the operator Odoo records: their email and name, never taken from the body.
 */
@Controller('v1/tenants/:slug/shop-floor')
@UseGuards(ActorGuard)
export class ShopFloorController {
  constructor(private readonly tenants: TenantsService, private readonly connector: ConnectorClient) {}

  private async company(actor: Actor, slug: string, permission: string): Promise<number> {
    const { tenant } = await this.tenants.require(actor, slug, permission);
    if (tenant.odooCompanyId == null) {
      throw new HttpException({ statusCode: 409, code: 'not_linked', message: `${slug} is not linked to an Odoo company` }, HttpStatus.CONFLICT);
    }
    return tenant.odooCompanyId;
  }

  private operator(actor: Actor) {
    return { email: actor.email, name: actor.fullName || actor.email };
  }

  @Get('work-orders')
  async workOrders(@CurrentActor() actor: Actor, @Param('slug') slug: string, @Query('workcenterId') workcenterId?: string, @Query('q') q?: string) {
    const companyId = await this.company(actor, slug, 'shopfloor.use');
    const qs = new URLSearchParams({ companyId: String(companyId) });
    if (workcenterId && /^\d+$/.test(workcenterId)) qs.set('workcenterId', workcenterId);
    if (q?.trim()) qs.set('q', q.trim().slice(0, 100));
    return this.connector.call('GET', `/v1/shop-floor/work-orders?${qs}`);
  }

  @Post('work-orders/:id/:action')
  async workOrderAction(@CurrentActor() actor: Actor, @Param('slug') slug: string, @Param('id', ParseIntPipe) id: number, @Param('action') action: string) {
    if (!ACTIONS.includes(action)) throw new BadRequestException(`action must be one of ${ACTIONS.join(', ')}`);
    const companyId = await this.company(actor, slug, 'shopfloor.use');
    return this.connector.call('POST', `/v1/shop-floor/work-orders/${id}/${action}`, { body: { companyId, operator: this.operator(actor) } });
  }

  @Post('manufacturing-orders/:id/consume')
  async consume(@CurrentActor() actor: Actor, @Param('slug') slug: string, @Param('id', ParseIntPipe) id: number, @Body() b: Json) {
    const companyId = await this.company(actor, slug, 'shopfloor.use');
    return this.connector.call('POST', `/v1/shop-floor/manufacturing-orders/${id}/consume`, {
      body: { companyId, operator: this.operator(actor), moveId: b?.moveId, quantity: b?.quantity },
    });
  }

  @Post('manufacturing-orders/:id/scrap')
  async scrap(@CurrentActor() actor: Actor, @Param('slug') slug: string, @Param('id', ParseIntPipe) id: number, @Body() b: Json) {
    const companyId = await this.company(actor, slug, 'shopfloor.use');
    return this.connector.call('POST', `/v1/shop-floor/manufacturing-orders/${id}/scrap`, {
      body: { companyId, operator: this.operator(actor), productId: b?.productId, quantity: b?.quantity, reason: b?.reason },
    });
  }

  @Get('service-orders')
  async serviceOrders(@CurrentActor() actor: Actor, @Param('slug') slug: string, @Query('includeClosed') includeClosed?: string) {
    const companyId = await this.company(actor, slug, 'service.report');
    const qs = new URLSearchParams({ companyId: String(companyId), operatorEmail: actor.email, includeClosed: includeClosed === 'true' ? 'true' : 'false' });
    return this.connector.call('GET', `/v1/shop-floor/service-orders?${qs}`);
  }

  @Post('service-orders/:id/report')
  async report(@CurrentActor() actor: Actor, @Param('slug') slug: string, @Param('id', ParseIntPipe) id: number, @Body() b: Json) {
    const companyId = await this.company(actor, slug, 'service.report');
    return this.connector.call('POST', `/v1/shop-floor/service-orders/${id}/report`, {
      body: { companyId, operator: this.operator(actor), resolution: b?.resolution, signature: b?.signature, signedBy: b?.signedBy, complete: b?.complete },
    });
  }
}
