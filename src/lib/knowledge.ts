// Company knowledge (docs/INTEGRATION.md §2.4): what each kind means and how
// its fields are read from a form. Shared by the screen and its actions.

export type KnowledgeKind = "product" | "datasource" | "order" | "hr_rule" | "other";

export const KINDS: { key: KnowledgeKind; label: string; note: string; apps: string }[] = [
  { key: "product", label: "محصولات", note: "محصولات شرکت و ویژگی‌هایشان، مثلاً SIMOPRIME — تابلو فشار متوسط تا ۲۴ کیلوولت", apps: "Design Suite" },
  { key: "datasource", label: "منابع داده", note: "نشانی پایگاه‌داده‌ها و سرویس‌ها (هرگز رمز عبور ننویسید)", apps: "Design Suite" },
  { key: "order", label: "بخشنامه‌ها و دستورها", note: "دستورهای شرکت، از چه تاریخی و چه اثری دارند", apps: "Design Suite و دستیار منابع انسانی" },
  { key: "hr_rule", label: "آیین‌نامه‌های منابع انسانی", note: "قوانین مرخصی، حضور، رفاهی و …", apps: "دستیار منابع انسانی" },
  { key: "other", label: "سایر", note: "هر دانستهٔ دیگری که سامانه‌ها باید بدانند", apps: "هر دو" },
];

export const isKind = (k: string): k is KnowledgeKind => KINDS.some((x) => x.key === k);

/**
 * Features as the person types them, one per line: "tier = MV",
 * "maxVoltageKv = 24". Numbers and true/false become numbers and booleans.
 */
export function parseFeatures(text: string): { ok: true; value: Record<string, string | number | boolean> } | { ok: false; error: string } {
  const out: Record<string, string | number | boolean> = {};
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    const at = line.search(/[=:]/);
    if (at < 1) return { ok: false, error: `سطر ${i + 1} ویژگی: به شکل «نام = مقدار» بنویسید.` };
    const key = line.slice(0, at).trim();
    const v = line.slice(at + 1).trim();
    if (!/^[\p{L}\p{N}_.\- ]{1,60}$/u.test(key)) return { ok: false, error: `سطر ${i + 1} ویژگی: نام «${key}» مجاز نیست.` };
    out[key] = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v === "true" ? true : v === "false" ? false : v;
  }
  if (Object.keys(out).length > 50) return { ok: false, error: "حداکثر ۵۰ ویژگی." };
  return { ok: true, value: out };
}

export const featuresText = (a: Record<string, unknown> | null | undefined) =>
  Object.entries(a ?? {}).map(([k, v]) => `${k} = ${v}`).join("\n");

/** A data source's address must not carry a secret: user:password@ or password=. */
export function looksSecret(address: string): boolean {
  return /:\/\/[^/@\s]+:[^/@\s]+@/.test(address) || /(password|passwd|pwd|secret|token|apikey|api_key)\s*=/i.test(address);
}

/** Words of a question, for picking passages (Persian and Latin, 2+ letters). */
const words = (s: string) => new Set((s.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).filter((w) => w.length > 1));

/**
 * The passages of a company's rules and circulars closest to a question, by
 * shared words: for an assistant's prompt, at most `budget` characters.
 * Simple and dependable; the HR chatbot does the semantic search.
 */
export function relevantPassages(question: string, items: { name: string; body: string | null; summary: string | null }[], budget = 9000): string[] {
  const q = words(question);
  const chunks: { title: string; text: string; score: number }[] = [];
  for (const it of items) {
    const text = [it.summary, it.body].filter(Boolean).join("\n\n");
    for (const part of text.split(/\n\s*\n/).reduce<string[]>((acc, p) => {
      const last = acc[acc.length - 1];
      if (last !== undefined && last.length + p.length < 1500) acc[acc.length - 1] = `${last}\n\n${p}`; else acc.push(p);
      return acc;
    }, [])) {
      const w = words(part);
      let score = 0;
      for (const x of q) if (w.has(x)) score += 1;
      if (score) chunks.push({ title: it.name, text: part.slice(0, 2000), score });
    }
  }
  const out: string[] = [];
  let used = 0;
  for (const c of chunks.sort((a, b) => b.score - a.score)) {
    if (used + c.text.length > budget) break;
    out.push(`[${c.title}]\n${c.text}`);
    used += c.text.length;
  }
  return out;
}
