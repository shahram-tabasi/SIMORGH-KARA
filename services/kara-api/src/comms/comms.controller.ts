import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ActorGuard, CurrentActor } from '../auth/actor.guard';
import { config } from '../config';
import { Actor, TenantsService } from '../tenants/tenants.service';
import { CallsService } from './calls.service';
import { jitsiEnabled, joinInfo, roomName } from './jitsi';
import { LiveService } from './live.service';

function needJitsi() {
  if (!jitsiEnabled()) throw new ServiceUnavailableException('meetings and calls are not configured (JITSI_URL, JITSI_JWT_SECRET)');
}

/**
 * Meetings and calls (VEO §9a), for a member of the tenant:
 *   GET  /v1/me/live                          server-sent events for the signed-in person
 *   GET  /v1/tenants/:slug/comms              what is switched on
 *   POST /v1/tenants/:slug/meet               {topic}  → a Jitsi token for the record's room
 *   GET  /v1/tenants/:slug/calls?limit=       my recent calls
 *   POST /v1/tenants/:slug/calls              {to: accountId[], video?}  → ring them; the caller's token
 *   POST /v1/calls/:id/accept | decline | leave
 */
@Controller('v1')
@UseGuards(ActorGuard)
export class CommsController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly calls: CallsService,
    private readonly live: LiveService,
  ) {}

  @Get('me/live')
  async liveStream(@CurrentActor() actor: Actor, @Res() res: Response) {
    this.live.attach(actor.id, res, await this.calls.ringingFor(actor.id));
  }

  @Get('tenants/:slug/comms')
  async status(@CurrentActor() actor: Actor, @Param('slug') slug: string) {
    await this.tenants.access(actor, slug);
    return { meetings: jitsiEnabled(), calls: jitsiEnabled(), jitsiUrl: jitsiEnabled() ? config.jitsi.url : null };
  }

  @Post('tenants/:slug/meet')
  async meet(@CurrentActor() actor: Actor, @Param('slug') slug: string, @Body() body: { topic?: string }) {
    needJitsi();
    const { tenant } = await this.tenants.access(actor, slug);
    const topic = String(body?.topic ?? 'company').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,60}$/.test(topic)) throw new BadRequestException('topic: letters, digits, - and _, e.g. project-12');
    return joinInfo(roomName('kara', tenant.slug, topic), { id: actor.id, name: actor.fullName, email: actor.email }, true);
  }

  @Get('tenants/:slug/calls')
  async history(@CurrentActor() actor: Actor, @Param('slug') slug: string, @Query('limit') limit = '30') {
    const { tenant } = await this.tenants.access(actor, slug);
    return { items: await this.calls.history(actor, tenant, Number(limit) || 30) };
  }

  @Post('tenants/:slug/calls')
  async start(@CurrentActor() actor: Actor, @Param('slug') slug: string, @Body() body: { to?: unknown; video?: unknown }) {
    needJitsi();
    const { tenant } = await this.tenants.access(actor, slug);
    const to = Array.isArray(body?.to) ? body.to.filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)) : [];
    return this.calls.start(actor, tenant, to, body?.video === true);
  }

  @Post('calls/:id/accept')
  accept(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    needJitsi();
    return this.calls.accept(actor, id);
  }

  @Post('calls/:id/decline')
  decline(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.calls.decline(actor, id);
  }

  @Post('calls/:id/leave')
  leave(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.calls.leave(actor, id);
  }
}
