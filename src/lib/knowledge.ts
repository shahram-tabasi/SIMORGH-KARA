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
