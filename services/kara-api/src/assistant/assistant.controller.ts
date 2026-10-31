import { BadRequestException, Body, CanActivate, Controller, ExecutionContext, ForbiddenException, Get, Injectable, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { timingSafeEqual } from 'crypto';
import { config } from '../config';
import { TeamAccessService } from '../team/team-access.service';
import { AssistantService } from './assistant.service';

type WithAsker = Request & { asker?: { accountId: string; channel: string } };

/**
 * n8n (and other Kara-side workflows) call the assistant with the service
 * token (Secret kara-team assistantServiceToken; n8n's copy n8n/n8n-kara) and
 * name the person by their Mattermost user id (X-Mattermost-User), resolved
 * through kara_team.app_identities — or by Kara account (X-Kara-Account).
 * The person must still have Mattermost in Kara.
 */
@Injectable()
export class AssistantTokenGuard implements CanActivate {
  constructor(private readonly access: TeamAccessService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<WithAsker>();
    const want = config.team.assistant.serviceToken;
    const got = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1] ?? '';
    if (!want || Buffer.from(got).length !== Buffer.from(want).length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) {
      throw new ForbiddenException('bad service token');
    }
    const mmUser = String(req.headers['x-mattermost-user'] ?? '');
    const account = mmUser ? await this.access.accountOf('mattermost', mmUser) : String(req.headers['x-kara-account'] ?? '');
    if (!account || !(await this.access.byAccount(account, 'mattermost'))) throw new ForbiddenException('no such person with team access');
    req.asker = { accountId: account, channel: 'n8n' };
    return true;
  }
}

@Controller('v1/assistant')
@UseGuards(AssistantTokenGuard)
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Get('my-work')
  myWork(@Req() req: WithAsker) { return this.assistant.tools.myWork(req.asker!); }

  @Get('project/:key')
  project(@Req() req: WithAsker, @Param('key') key: string) { return this.assistant.tools.projectStatus(req.asker!, key); }

  @Get('issue/:key')
  issue(@Req() req: WithAsker, @Param('key') key: string) { return this.assistant.tools.issue(req.asker!, key); }

  @Post('ask')
  async ask(@Req() req: WithAsker, @Body() b: { question?: string }) {
    if (!b?.question?.trim()) throw new BadRequestException('question required');
    return { answer: await this.assistant.ask(req.asker!, b.question) };
  }
}
