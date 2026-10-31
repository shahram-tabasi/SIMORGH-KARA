import { BadRequestException, Body, Controller, ForbiddenException, Headers, HttpCode, Logger, Post, Req, ServiceUnavailableException } from '@nestjs/common';
import type { Request } from 'express';
import { config } from '../config';
import { teamEvents } from '../infra/metrics';
import { PlaneDelivery, PlaneEventsService, validSignature } from './plane-events.service';

/**
 * POST /v1/team/plane/webhook — Plane's workspace webhook (Plane → Workspace
 * settings → Webhooks, URL http://kara-api.kara.svc.cluster.local:3001/v1/team/plane/webhook).
 * No Keycloak token: Plane signs each delivery with the webhook's secret
 * (X-Plane-Signature), which Kara checks against the raw body.
 */
@Controller('v1/team/plane')
export class PlaneWebhookController {
  private readonly log = new Logger(PlaneWebhookController.name);

  constructor(private readonly events: PlaneEventsService) {}

  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Body() body: PlaneDelivery,
    @Headers('x-plane-signature') signature?: string,
    @Headers('x-plane-delivery') delivery?: string,
  ) {
    if (!config.team.plane.webhookSecret) throw new ServiceUnavailableException('PLANE_WEBHOOK_SECRET is not set');
    if (!req.rawBody || !validSignature(config.team.plane.webhookSecret, req.rawBody, signature)) {
      teamEvents.inc({ source: 'plane', outcome: 'bad_signature' });
      this.log.warn(`plane webhook refused: bad signature (delivery ${delivery ?? '?'})`);
      throw new ForbiddenException('bad signature');
    }
    if (!delivery || !body?.event) throw new BadRequestException('not a Plane delivery');
    const outcome = await this.events.receive(delivery, body);
    return { ok: true, outcome };
  }
}
