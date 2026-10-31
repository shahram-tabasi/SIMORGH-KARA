import { Injectable, Logger } from '@nestjs/common';
import { config } from '../config';
import { ProposalInput, ProposalsService } from './proposals.service';
import { Asker, AssistantToolsService, WorkItem } from './tools.service';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

const TOOLS = [
  { type: 'function', function: { name: 'my_work', description: "The asking person's open work: Kara kartabl items, Kara tasks, and Plane issues assigned to them.", parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'project_status', description: 'Status of a Plane project by its key (e.g. ERP): issues by state, overdue issues, open issues per person.', parameters: { type: 'object', properties: { key: { type: 'string', description: 'Project key, e.g. ERP' } }, required: ['key'] } } },
  { type: 'function', function: { name: 'issue', description: 'One Plane issue by its key, e.g. ERP-42: state, dates, assignees, description.', parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] } } },
  { type: 'function', function: { name: 'propose_change', description: "Propose ONE change in Plane for the person to approve. Nothing changes until they press Approve. kind: set_state (issue, state), assign (issue, assignees), set_due_date (issue, date YYYY-MM-DD Gregorian), comment (issue, text), create_issue (project, title, description?, assignees?, date?, priority? urgent|high|medium|low|none).", parameters: { type: 'object', properties: {
    kind: { type: 'string', enum: ['set_state', 'assign', 'set_due_date', 'comment', 'create_issue'] },
    issue: { type: 'string', description: 'Issue key, e.g. ERP-42' }, project: { type: 'string', description: 'Project key for create_issue' },
    state: { type: 'string' }, assignees: { type: 'array', items: { type: 'string' }, description: 'Names, usernames or emails of project members' },
    date: { type: 'string' }, text: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, priority: { type: 'string' },
  }, required: ['kind'] } } },
  { type: 'function', function: { name: 'search_issues', description: 'Find Plane issues whose title contains the text.', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } } },
];

const SYSTEM = `You are «دستیار سیمرغ» (Simorgh Assistant), the team assistant of Simorgh's Kara platform.
Answer in the language of the question (Persian by default), short and concrete, in Markdown.
Use the tools for every fact about work, tasks, projects or issues; never invent issues, dates, people or numbers.
The tools already answer as the asking person and only show what they may see: if a tool says access is denied, say so plainly.
You never change anything yourself. To change Plane (state, assignees, due date, a comment, a new issue) call propose_change once per change: the person then gets Approve / Reject buttons and an approval item in their Kara kartabl, and only their approval runs it. Tell them that. Convert Persian (Jalali) dates to Gregorian YYYY-MM-DD before proposing.
Quote issue keys (ERP-42) and give their links. Dates are Gregorian YYYY-MM-DD from the tools; you may add the Persian (Jalali) date.`;

/** Lists the person's work for /mytasks: grouped, due dates first. Exported for tests. */
export function formatWork(name: string, items: WorkItem[], planeLinked: boolean): string {
  if (!items.length) {
    return `**${name || 'شما'}**: کار باز ندارید. ✅${planeLinked ? '' : '\n_(حساب Plane شما هنوز به کارا وصل نشده؛ پس از اولین ورود به Plane، کارهای Plane هم اینجا می‌آید.)_'}`;
  }
  const line = (i: WorkItem) => {
    const due = i.due ? ` — موعد ${i.due}` : '';
    const pr = i.priority && !['none', 'normal'].includes(i.priority) ? ` · ${i.priority}` : '';
    const title = i.url ? `[${i.key ? `${i.key} ` : ''}${i.title}](${i.url})` : i.title;
    return `- ${title} · ${i.status}${pr}${due}`;
  };
  const part = (label: string, src: WorkItem['source']) => {
    const xs = items.filter((i) => i.source === src);
    return xs.length ? `**${label}** (${xs.length})\n${xs.map(line).join('\n')}` : '';
  };
  return [`#### کارهای باز ${name}`, part('Plane', 'plane'), part('میز کار', 'task'), part('کارتابل', 'kartabl')].filter(Boolean).join('\n\n');
}

@Injectable()
export class AssistantService {
  private readonly log = new Logger(AssistantService.name);

  constructor(readonly tools: AssistantToolsService, private readonly proposals: ProposalsService) {}

  get llmConfigured() { return !!config.team.assistant.llmApiKey; }

  private async callTool(a: Asker, name: string, rawArgs: string): Promise<unknown> {
    let args: Record<string, unknown> = {};
    try { args = rawArgs ? JSON.parse(rawArgs) : {}; } catch { return { error: 'bad arguments' }; }
    switch (name) {
      case 'my_work': return this.tools.myWork(a);
      case 'project_status': return this.tools.projectStatus(a, String(args.key ?? ''));
      case 'issue': return this.tools.issue(a, String(args.key ?? ''));
      case 'search_issues': return this.tools.searchIssues(a, String(args.text ?? ''));
      case 'propose_change': return this.proposals.propose(a, args as unknown as ProposalInput);
      default: return { error: `unknown tool ${name}` };
    }
  }

  private async chat(messages: ChatMessage[]): Promise<ChatMessage> {
    const res = await fetch(`${config.team.assistant.llmUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.team.assistant.llmApiKey}` },
      body: JSON.stringify({ model: config.team.assistant.model, messages, tools: TOOLS, tool_choice: 'auto', temperature: 0.2, max_tokens: 1500 }),
      signal: AbortSignal.timeout(config.team.assistant.timeoutMs),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { choices: { message: ChatMessage }[] };
    return body.choices[0].message;
  }

  /** A question in plain language, answered with the tools (read-only). */
  async ask(a: Asker, question: string): Promise<string> {
    if (!this.llmConfigured) return 'دستیار هوشمند هنوز به مدل زبانی وصل نشده است (LLM_API_KEY). دستورهای /mytasks و /project و /issue کار می‌کنند.';
    const messages: ChatMessage[] = [
      { role: 'system', content: `${SYSTEM}\nToday is ${new Date().toISOString().slice(0, 10)}.` },
      { role: 'user', content: question.slice(0, 4000) },
    ];
    try {
      for (let round = 0; round <= config.team.assistant.maxToolRounds; round++) {
        const msg = await this.chat(messages);
        if (!msg.tool_calls?.length || round === config.team.assistant.maxToolRounds) {
          await this.tools.audit(a, 'ask', null, { question: question.slice(0, 300) }, 'ok', `${round} tool round(s)`);
          return (msg.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim() || '—';
        }
        messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls });
        for (const call of msg.tool_calls) {
          const out = await this.callTool(a, call.function.name, call.function.arguments);
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(out).slice(0, 12_000) });
        }
      }
    } catch (e) {
      this.log.warn(`ask: ${(e as Error).message}`);
      await this.tools.audit(a, 'ask', null, { question: question.slice(0, 300) }, 'error', (e as Error).message);
      return 'متأسفم، الان نتوانستم پاسخ بدهم (مدل زبانی در دسترس نبود). کمی بعد دوباره بپرسید.';
    }
    return '—';
  }

  async myWorkText(a: Asker): Promise<string> {
    const w = await this.tools.myWork(a);
    return formatWork(w.name, w.items, !!(await this.tools.planeUser(a.accountId)));
  }

  async projectText(a: Asker, key: string): Promise<string> {
    const r = await this.tools.projectStatus(a, key);
    if ('error' in r) return String(r.error);
    const st = r.byState as Record<string, number>;
    const total = Object.values(st).reduce((x, y) => x + y, 0);
    const fa: Record<string, string> = { backlog: 'بک‌لاگ', unstarted: 'شروع‌نشده', started: 'در جریان', completed: 'انجام‌شده', cancelled: 'لغوشده', unknown: 'نامشخص' };
    return [
      `#### [${r.project.key} — ${r.project.name}](${r.project.url})`,
      `کل کارها: **${total}** · ${Object.entries(st).map(([k, v]) => `${fa[k] ?? k}: ${v}`).join(' · ')}`,
      `بدون مسئول (باز): **${r.unassignedOpen}**`,
      r.overdue.length ? `**عقب‌افتاده (${r.overdue.length})**\n${r.overdue.map((o) => `- [${o.key} ${o.name}](${o.url}) — موعد ${o.due}`).join('\n')}` : 'کار عقب‌افتاده‌ای نیست. ✅',
      r.openByPerson.length ? `**کارهای باز هر نفر**: ${r.openByPerson.map((p) => `${p.who}: ${p.open}`).join(' · ')}` : '',
    ].filter(Boolean).join('\n\n');
  }

  async issueText(a: Asker, key: string): Promise<string> {
    const r = await this.tools.issue(a, key);
    if ('error' in r) return String(r.error);
    return [
      `#### [${r.key} — ${r.name}](${r.url})`,
      `وضعیت: **${r.state ?? '—'}** · اولویت: ${r.priority ?? '—'} · شروع: ${r.start ?? '—'} · موعد: ${r.due ?? '—'}`,
      `مسئول: ${r.assignees.length ? r.assignees.join('، ') : '—'} · آخرین تغییر: ${r.updated ?? '—'}`,
      r.description ? `> ${r.description.replace(/\n+/g, '\n> ').slice(0, 800)}` : '',
    ].filter(Boolean).join('\n');
  }
}
