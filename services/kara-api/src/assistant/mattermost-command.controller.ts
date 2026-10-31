import { Body, Controller, ForbiddenException, HttpCode, Logger, Post } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { DbService } from '../infra/db.service';
import { config } from '../config';
import { teamEvents } from '../infra/metrics';
import { MattermostClient } from '../team/mattermost.client';
import { TeamAccessService } from '../team/team-access.service';
import { AssistantService } from './assistant.service';

/** What Mattermost posts for a slash command (form-encoded). */
interface SlashCommand {
  token: string;
  user_id: string;
  user_name?: string;
  channel_id: string;
  command: string;  // "/ask"
  text: string;
  trigger_id?: string;
}

const tokenOk = (t: string) => config.team.mattermost.commandTokens.some((x) => {
  const a = Buffer.from(x); const b = Buffer.from(t ?? '');
  return a.length === b.length && timingSafeEqual(a, b);
});

export const HELP = [
  '#### دستیار سیمرغ',
  '- `/mytasks` — کارهای باز شما: Plane، میز کار و کارتابل کارا',
  '- `/project ERP` — وضعیت یک پروژه Plane',
  '- `/issue ERP-42` — جزئیات یک کار',
  '- `/ask سؤال` — پرسش آزاد (فارسی یا انگلیسی)، پاسخ از روی داده‌های واقعی',
  '',
  'پاسخ‌ها در پیام خصوصی «Simorgh Assistant» می‌آید و فقط چیزهایی را نشان می‌دهد که خودتان اجازه دیدنش را دارید. دستیار چیزی را تغییر نمی‌دهد.',
].join('\n');

/**
 * POST /v1/team/mattermost/command — Mattermost's slash commands /mytasks,
 * /project, /issue, /ask (System Console → Integrations → Slash Commands, one
 * per command, request URL http://kara-api.kara.svc.cluster.local:3001/v1/team/mattermost/command).
 * Mattermost proves itself with each command's token; the person is the
 * Mattermost user Kara made (kara_team.app_identities) — the name typed in
 * the message is never trusted. Answers go to the person's direct messages
 * with the bot, never into a shared channel.
 */
@Controller('v1/team/mattermost')
export class MattermostCommandController {
  private readonly log = new Logger(MattermostCommandController.name);

  constructor(private readonly assistant: AssistantService, private readonly access: TeamAccessService, private readonly mm: MattermostClient,
    private readonly db: DbService) {}

  /** A token Kara made the command with (kara_team.mm_commands), or one set by hand (MATTERMOST_COMMAND_TOKENS). */
  private async known(token: string): Promise<boolean> {
    if (tokenOk(token)) return true;
    const [r] = await this.db.query<{ n: number }>(`SELECT 1 AS n FROM kara_team.mm_commands WHERE token_hash = $1`,
      [createHash('sha256').update(token).digest('hex')]);
    return !!r;
  }

  @Post('command')
  @HttpCode(200)
  async command(@Body() b: SlashCommand) {
    if (!b?.token || !(await this.known(b.token))) {
      teamEvents.inc({ source: 'mattermost_command', outcome: 'bad_token' });
      throw new ForbiddenException('unknown command token');
    }
    const accountId = await this.access.accountOf('mattermost', b.user_id);
    if (!accountId || !(await this.access.byAccount(accountId, 'mattermost'))) {
      teamEvents.inc({ source: 'mattermost_command', outcome: 'unknown_user' });
      return { response_type: 'ephemeral', text: 'حساب Mattermost شما به کارا وصل نیست. از مدیر شرکت بخواهید «گفتگوی تیمی» را در کارا برایتان فعال کند.' };
    }
    const a = { accountId, channel: 'mattermost' };
    const cmd = b.command.replace(/^\//, '').toLowerCase();
    const text = (b.text ?? '').trim();
    teamEvents.inc({ source: 'mattermost_command', outcome: cmd });

    const answer = async (): Promise<string> => {
      switch (cmd) {
        case 'mytasks': return this.assistant.myWorkText(a);
        case 'project': return text ? this.assistant.projectText(a, text.split(/\s+/)[0]) : 'کلید پروژه را بنویسید: `/project ERP`';
        case 'issue': return text ? this.assistant.issueText(a, text.split(/\s+/)[0]) : 'کلید کار را بنویسید: `/issue ERP-42`';
        case 'ask': return text ? this.assistant.ask(a, text) : HELP;
        default: return HELP;
      }
    };
    // Mattermost waits 30 s at most: answer in the background, into the DM.
    void answer()
      .then((msg) => this.mm.dm(b.user_id, cmd === 'ask' && text ? `> ${text.slice(0, 300)}\n\n${msg}` : msg))
      .catch((e) => this.log.warn(`/${cmd} for ${b.user_id}: ${(e as Error).message}`));
    return { response_type: 'ephemeral', text: cmd === 'ask' ? '⏳ در حال بررسی… پاسخ در پیام خصوصی «Simorgh Assistant».' : '📬 پاسخ در پیام خصوصی «Simorgh Assistant».' };
  }
}
