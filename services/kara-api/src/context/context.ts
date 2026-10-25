// What GET /v1/context answers, worked out without I/O (docs/INTEGRATION.md §3).

export type ContextApp = 'designSuite' | 'hrChatbot';
export type Kind = 'product' | 'datasource' | 'order' | 'hr_rule' | 'other';

export interface KnowledgeItem {
  kind: Kind;
  name: string;
  code: string | null;
  summary: string | null;
  body: string | null;
  attributes: Record<string, unknown>;
  address: string | null;
  impact: string | null;
  effectiveDate: string | null;
}

export interface CompanyContext {
  company: { slug: string; name: string };
  app: ContextApp;
  units: string[];
  knowledge: KnowledgeItem[];
  /** Where the knowledge was read: Odoo (with what was entered there too) or Kara's own copy. */
  source: 'odoo' | 'kara';
  generatedAt: string;
}

/**
 * Least privilege: each app sees the kinds it needs. Data-source addresses
 * only to Design Suite; HR rules only to the HR chatbot.
 */
const KINDS: Record<ContextApp, Kind[]> = {
  designSuite: ['product', 'datasource', 'order', 'other'],
  hrChatbot: ['order', 'hr_rule', 'other'],
};
export const kindsFor = (app: ContextApp) => KINDS[app];

/**
 * The companies in a token's `organization` claim (Keycloak 26): a list of
 * aliases, or an object keyed by alias when the mapper adds attributes.
 */
export function orgsOf(claim: unknown): string[] {
  if (Array.isArray(claim)) return claim.filter((x): x is string => typeof x === 'string');
  if (claim && typeof claim === 'object') return Object.keys(claim);
  if (typeof claim === 'string' && claim) return [claim];
  return [];
}

/** The one company a person's token is about; `wanted` chooses when they are in several. */
export function chooseOrg(orgs: string[], wanted?: string): { slug?: string; error?: string } {
  if (!orgs.length) return { error: 'the token names no company (organization claim): ask for scope "organization"' };
  if (wanted) return orgs.includes(wanted) ? { slug: wanted } : { error: `not a member of ${wanted}` };
  if (orgs.length > 1) return { error: `member of several companies (${orgs.join(', ')}): choose one with ?company=` };
  return { slug: orgs[0] };
}

const TITLES: Record<Kind, string> = {
  product: 'Products',
  datasource: 'Data sources',
  order: 'Orders and circulars',
  hr_rule: 'HR rules',
  other: 'Other',
};

/** The context as Markdown, for an LLM's system prompt or a skill file (company.skill.md). */
export function renderMarkdown(c: CompanyContext): string {
  const out: string[] = [
    `# ${c.company.name}`,
    '',
    // No date here: an app that keeps this as a file (company.skill.md) changes it only when the company does.
    `Company \`${c.company.slug}\`, as known to Simorgh Kara for ${c.app === 'designSuite' ? 'Design Suite' : 'the HR assistant'}.` +
      ' Answer for this company only.',
  ];
  if (c.units.length) out.push('', '## Units', '', ...c.units.map((u) => `- ${u}`));
  for (const kind of kindsFor(c.app)) {
    const items = c.knowledge.filter((k) => k.kind === kind);
    if (!items.length) continue;
    out.push('', `## ${TITLES[kind]}`);
    for (const k of items) {
      out.push('', `### ${k.code ? `${k.code} — ` : ''}${k.name}`);
      if (k.summary) out.push('', k.summary);
      if (k.effectiveDate) out.push('', `In force from ${k.effectiveDate}.`);
      if (k.address) out.push('', `Address: \`${k.address}\``);
      const attrs = Object.entries(k.attributes ?? {});
      if (attrs.length) out.push('', ...attrs.map(([key, v]) => `- ${key}: ${String(v)}`));
      if (k.impact) out.push('', `Impact: ${k.impact}`);
      if (k.body) out.push('', k.body);
    }
  }
  return out.join('\n') + '\n';
}
