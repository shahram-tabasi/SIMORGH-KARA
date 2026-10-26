import Link from "next/link";
import { Bot, BookOpen, Building2, ExternalLink, Languages, MessagesSquare, ShieldCheck, Users } from "lucide-react";
import { requireTenant } from "@/lib/session";
import { sql, withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { handoffConfigured, hrAppUrl } from "@/lib/hr-handoff";

const ERRORS: Record<string, string> = {
  off: "دستیار منابع انسانی برای این شرکت روشن نیست؛ مدیر پلتفرم آن را در «شرکت‌ها» روشن می‌کند.",
  config: "اتصال کارا به دستیار هنوز پیکربندی نشده است (HR_HANDOFF_SECRET).",
};

/**
 * دستیار هوش مصنوعی: what the HR assistant does and the way in. The button
 * opens hr.simorghai.com already signed in as this person (assistant/open):
 * no second login, Kara vouches for them, their position and units.
 */
export default async function AiAssistantPage({ params, searchParams }: { params: { slug: string }; searchParams: { error?: string } }) {
  const ctx = await requireTenant(params.slug);
  const [company] = await sql<{ apps: Record<string, boolean> | null }[]>`SELECT apps FROM platform.companies WHERE id = ${ctx.company.id}`;
  const on = !!company?.apps?.hrChatbot && handoffConfigured();
  const facts = await withTenant(ctx.company.schema, async (tx) => {
    const [m] = await tx<{ title: string | null }[]>`SELECT title FROM members WHERE id = ${ctx.member.memberId}`;
    const units = await tx.unsafe<{ id: string; path: string }[]>(`
      WITH RECURSIVE t AS (
        SELECT id, name::text AS path, ARRAY[id] AS line FROM groups WHERE parent_id IS NULL
        UNION ALL SELECT g.id, t.path || ' / ' || g.name, t.line || g.id FROM groups g JOIN t ON g.parent_id = t.id
      ) SELECT t.id::text, t.path FROM t JOIN member_groups mg ON mg.group_id = t.id WHERE mg.member_id = $1 ORDER BY t.path`, [ctx.member.memberId]);
    const [counts] = await tx.unsafe<{ company: number; mine: number }[]>(`
      WITH RECURSIVE up AS (
        SELECT g.id, g.parent_id FROM groups g JOIN member_groups mg ON mg.group_id = g.id WHERE mg.member_id = $1
        UNION SELECT g.id, g.parent_id FROM groups g JOIN up ON g.id = up.parent_id
      ) SELECT
        (SELECT count(*)::int FROM knowledge WHERE active AND unit_id IS NULL AND kind IN ('hr_rule','order','other')) AS company,
        (SELECT count(*)::int FROM knowledge WHERE active AND unit_id IN (SELECT id FROM up)) AS mine`, [ctx.member.memberId]).catch(() => [{ company: 0, mine: 0 }]);
    return { title: m?.title ?? null, units: units.map((u) => u.path), counts };
  });

  const can = [
    { icon: BookOpen, title: "پاسخ از آیین‌نامه‌های شرکت", text: "مرخصی، حضور و غیاب، اضافه‌کار، مأموریت، استخدام، قطع همکاری و … — با استناد به همان دستورالعمل‌های ثبت‌شده در کارا." },
    { icon: Building2, title: "قوانین ویژهٔ واحد شما", text: "بخشنامه‌ها و دستورهایی که فقط برای واحد شما (و واحدهای بالادستش) ثبت شده، فقط به شما گفته می‌شود." },
    { icon: Users, title: "با شناخت جایگاه شما", text: "دستیار نام، سمت سازمانی و واحد شما را از کارا می‌داند و پاسخ را برای شما می‌نویسد." },
    { icon: Languages, title: "فارسی، انگلیسی و آلمانی", text: "به همان زبانی که می‌پرسید پاسخ می‌دهد." },
    { icon: ShieldCheck, title: "ورود بدون رمز دوباره", text: "ورود و دسترسی شما را کارا تأیید می‌کند؛ با یک کلیک وارد می‌شوید." },
    { icon: MessagesSquare, title: "گفتگوهای ماندگار", text: "گفتگوها ذخیره می‌شوند و بعداً از همان‌جا ادامه می‌دهید." },
  ];

  return (
    <>
      <PageHeader
        title="دستیار هوش مصنوعی"
        description="دستیار منابع انسانی سیمرغ: پرسش‌های شما دربارهٔ قوانین و رویه‌های شرکت را از روی آیین‌نامه‌های ثبت‌شده پاسخ می‌دهد"
        action={on ? (
          <a href={`/app/${params.slug}/assistant/open`} target="_blank" rel="noopener" className="btn-primary">
            <Bot className="h-4 w-4" /> ورود به دستیار <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : undefined}
      />

      {searchParams.error && ERRORS[searchParams.error] && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{ERRORS[searchParams.error]}</div>
      )}
      {!on && !searchParams.error && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {company?.apps?.hrChatbot ? ERRORS.config : ERRORS.off}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="card lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">دستیار چه کاری می‌کند</h2>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {can.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3 rounded-lg border border-slate-200 p-3">
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
                <div>
                  <div className="text-sm font-medium text-slate-800">{title}</div>
                  <div className="mt-0.5 text-xs leading-6 text-slate-600">{text}</div>
                </div>
              </li>
            ))}
          </ul>
          <h2 className="mb-2 mt-5 text-sm font-semibold text-slate-700">نمونهٔ پرسش‌ها</h2>
          <ul className="list-inside list-disc space-y-1 text-sm text-slate-600">
            <li>در ماه چند بار می‌توانم مرخصی ساعتی بگیرم؟</li>
            <li>اگر مأموریتم بعد از ساعت ۲۲ تمام شود، فردا استراحت دارم؟</li>
            <li>برای ماندن بعد از ساعت اداری چه هماهنگی‌ای لازم است؟</li>
            <li>قانون ویژه‌ای برای واحد ما ثبت شده است؟</li>
          </ul>
          <p className="mt-4 text-xs text-slate-500">
            پاسخ‌ها از روی متن آیین‌نامه‌هاست و جای تصمیم واحد سرمایه انسانی را نمی‌گیرد؛ در موارد خاص با کارشناس سرمایه انسانی هماهنگ کنید.
          </p>
        </section>

        <aside className="space-y-4">
          <section className="card">
            <h2 className="mb-2 text-sm font-semibold text-slate-700">دستیار شما را این‌طور می‌شناسد</h2>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between gap-2"><dt className="text-slate-500">نام</dt><dd className="text-slate-800">{ctx.member.fullName}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-slate-500">سمت سازمانی</dt><dd className="text-slate-800">{facts.title ?? "—"}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-slate-500">شرکت</dt><dd className="text-slate-800">{ctx.company.name}</dd></div>
              <div>
                <dt className="text-slate-500">واحد</dt>
                <dd className="mt-0.5 text-slate-800">{facts.units.length ? facts.units.map((u) => <div key={u} className="text-xs">{u}</div>) : "—"}</dd>
              </div>
            </dl>
          </section>
          <section className="card">
            <h2 className="mb-2 text-sm font-semibold text-slate-700">منابع پاسخ</h2>
            <p className="text-sm text-slate-600">
              {facts.counts.company.toLocaleString("fa-IR")} آیین‌نامه، بخشنامه یا دانستهٔ کل شرکت
              {facts.counts.mine > 0 && <> و {facts.counts.mine.toLocaleString("fa-IR")} مورد ویژهٔ واحد شما</>}.
            </p>
            <Link href={`/app/${params.slug}/knowledge`} className="mt-2 inline-block text-xs text-brand-700 underline">دیدن دانش شرکت</Link>
          </section>
          <p className="px-1 text-xs text-slate-500" dir="ltr">{hrAppUrl().replace(/^https?:\/\//, "")}</p>
        </aside>
      </div>
    </>
  );
}
