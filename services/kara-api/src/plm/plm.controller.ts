import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, Post, Query, UnauthorizedException } from '@nestjs/common';
import { config } from '../config';
import { ConnectorClient } from '../erp/connector.client';
import { DbService } from '../infra/db.service';
import { ContextService } from '../context/context.service';

interface Change { externalId?: string; [k: string]: unknown }
interface Eco { id: number; number: string; state: string | null; stage: string | null; unmatchedLines: number; revision: number | null; ref: string | null }

/**
 * Design Suite → Odoo's PLM (simorgh-odoo addons/simorgh_plm, docs/PLM.md):
 *   POST /v1/engineering-changes   {changes: [{externalId, title, type, reason, productCode, design, lines, documents}]}
 *   GET  /v1/engineering-changes?project=<name>
 * Authorization: the person's Design Suite token (realm simorgh), as for
 * /v1/context: the company is theirs (its organization claim), its Odoo
 * company is Kara's link, and the erp-connector writes as caller kara. Each
 * change is one engineering change order (ECO) in Odoo; a change sent again
 * with the same externalId returns the same ECO.
 */
@Controller('v1/engineering-changes')
export class PlmController {
  constructor(private readonly ctx: ContextService, private readonly connector: ConnectorClient, private readonly db: DbService) {}

  private async company(auth: string | undefined, wanted?: string) {
    const m = /^Bearer\s+(.+)$/i.exec(auth ?? '');
    if (!m) throw new UnauthorizedException('Bearer token required');
    const who = await this.ctx.resolve(m[1], wanted?.trim() || undefined);
    if (who.app !== 'designSuite') throw new ForbiddenException('engineering changes come from Design Suite');
    const [c] = await this.db.query<{ odoo: number | null; apps: Record<string, boolean> | null; status: string }>(
      `SELECT odoo_company_id AS odoo, apps, status FROM platform.companies WHERE slug = $1`, [who.slug]);
    if (!c || c.status !== 'active') throw new ForbiddenException(`no active company ${who.slug}`);
    if (!c.apps?.erp || !c.odoo) throw new ForbiddenException(`${who.slug} has no Odoo company (Kara › Companies › Odoo)`);
    return { slug: who.slug, odoo: c.odoo };
  }

  private link(id: number) {
    return config.erp.publicUrl ? `${config.erp.publicUrl}/odoo/action-simorgh_plm.action_eco/${id}` : null;
  }

  @Post()
  async create(@Headers('authorization') auth: string | undefined, @Query('company') company: string | undefined, @Body() body: { changes?: Change[] }) {
    const changes = body?.changes;
    if (!Array.isArray(changes) || !changes.length) throw new BadRequestException('changes must be a non-empty list');
    if (changes.length > 100) throw new BadRequestException('at most 100 changes at once');
    const c = await this.company(auth, company);
    const results = [];
    for (const ch of changes) {
      if (!ch || typeof ch !== 'object') throw new BadRequestException('each change must be an object');
      const externalId = typeof ch.externalId === 'string' && ch.externalId ? `${c.slug}:eco:${ch.externalId}`.slice(0, 120) : undefined;
      const eco = await this.connector.call<Eco>('POST', '/v1/engineering-changes', {
        body: { ...ch, externalId, companyId: c.odoo },
      });
      results.push({ externalId: ch.externalId ?? null, id: eco.id, number: eco.number, state: eco.state, stage: eco.stage,
                     unmatchedLines: eco.unmatchedLines, url: this.link(eco.id) });
    }
    return { company: c.slug, results };
  }

  @Get()
  async list(@Headers('authorization') auth: string | undefined, @Query('company') company: string | undefined, @Query('project') project: string | undefined) {
    const c = await this.company(auth, company);
    const q = new URLSearchParams({ companyId: String(c.odoo), externalIdPrefix: `${c.slug}:eco:`, limit: '200', includeArchived: 'true' });
    if (project?.trim()) q.set('q', project.trim());
    const page = await this.connector.call<{ items: Eco[] }>('GET', `/v1/engineering-changes?${q}`);
    return {
      company: c.slug,
      items: page.items.map((e) => ({ id: e.id, number: e.number, state: e.state, stage: e.stage, revision: e.revision,
                                      unmatchedLines: e.unmatchedLines, externalId: e.ref?.replace(/^kara:[^:]+:eco:/, '') ?? null, url: this.link(e.id) })),
    };
  }
}
