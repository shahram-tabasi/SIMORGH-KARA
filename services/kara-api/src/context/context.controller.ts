import { Controller, Get, Headers, Query, Res, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { renderMarkdown } from './context';
import { ContextService } from './context.service';

/**
 *   GET /v1/context                    JSON: company, units, knowledge (the app's kinds)
 *   GET /v1/context?format=md          the same as Markdown, for a model's prompt
 *   GET /v1/context?company=<slug>     a person in several companies, or an app's service account
 * Authorization: Bearer <access token from the app's own realm> (docs/INTEGRATION.md §3).
 */
@Controller('v1/context')
export class ContextController {
  constructor(private readonly ctx: ContextService) {}

  @Get()
  async get(
    @Headers('authorization') auth: string | undefined,
    @Query('company') company: string | undefined,
    @Query('format') format: string | undefined,
    @Res() res: Response,
  ) {
    const m = /^Bearer\s+(.+)$/i.exec(auth ?? '');
    if (!m) throw new UnauthorizedException('Bearer token required');
    const who = await this.ctx.resolve(m[1], company?.trim() || undefined);
    const value = await this.ctx.context(who.app, who.slug);
    res.setHeader('cache-control', 'private, max-age=60');
    if (format === 'md') res.type('text/markdown; charset=utf-8').send(renderMarkdown(value));
    else res.json(value);
  }
}
