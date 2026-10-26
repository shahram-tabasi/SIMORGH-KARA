import Link from "next/link";
import { ArrowUpLeft, Bot, BookOpen, Building2, CheckCircle2, CircleAlert, ExternalLink, FileText, Lock, MessageSquareText, ScrollText, UserRound } from "lucide-react";
import { requireTenant } from "@/lib/session";
import { sql, withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { handoffConfigured, hrAppUrl } from "@/lib/hr-handoff";

const ERRORS: Record<string, string> = {
  off: "دستیار منابع انسانی برای این شرکت روشن نیست؛ مدیر پلتفرم آن را در «شرکت‌ها» روشن می‌کند.",
  config: "اتصال کارا به دستیار هنوز پیکربندی نشده است (HR_HANDOFF_SECRET).",
};

const KIND_LABEL: Record<string, string> = { hr_rule: "آیین‌نامه", order: "بخشنامه / دستور", other: "سایر" };

/** Questions people ask, by topic; a click opens the assistant with the question already asked. */
const TOPICS: { topic: string; questions: string[] }[] = [
  { topic: "مرخصی", questions: ["در ماه چند ساعت مرخصی ساعتی می‌توانم بگیرم؟", "چند روز از مرخصی سالانه‌ام به سال بعد منتقل می‌شود؟"] },
  { topic: "حضور و غیاب", questions: ["تأخیر ورود تا چند دقیقه بخشیده می‌شود؟", "اگر فراموش کنم کارت بزنم چه کنم؟"] },
  { topic: "اضافه‌کار", questions: ["سقف اضافه‌کار ماهانه چقدر است و چطور تأیید می‌شود؟"] },
  { topic: "مأموریت", questions: ["اگر مأموریتم بعد از ساعت ۲۲ تمام شود، فردا استراحت دارم؟"] },
  { topic: "استخدام و قطع همکاری", questions: ["برای استعفا چند روز پیش‌تر باید اطلاع بدهم؟", "مراحل تسویه‌حساب چیست؟"] },
  { topic: "واحد من", questions: ["قانون یا بخشنامهٔ ویژه‌ای برای واحد ما ثبت شده است؟"] },
];

const faDate = (d: Date | string | null) => (d ? new Date(d).toLocaleDateString("fa-IR-u-ca-persian", { year: "numeric", month: "2-digit", day: "2-digit" }) : "—");
const fa = (n: number) => n.toLocaleString("fa-IR");

interface Source { id: string; kind: string; name: string; code: string | null; effective: Date | null; updated: Date; unit: string | null; file: boolean }

/**
 * دستیار هوش مصنوعی: the way into the HR assistant and what it answers from.
 * Laid out as an object page (SAP Fiori / IBM Carbon): a header with the one
 * primary action, a strip of key facts, then the content. The button opens
 * hr.simorghai.com already signed in as this person (assistant/open); a
 * suggested question opens it with that question asked.
 */
export default async function AiAssistantPage({ params, searchParams }: { params: { slug: string }; searchParams: { error?: string } }) {
  const ctx = await requireTenant(params.slug);
  const [company] = await sql<{ apps: Record<string, boolean> | null }[]>`SELECT apps FROM platform.companies WHERE id = ${ctx.company.id}`;
  const on = !!company?.apps?.hrChatbot && handoffConfigured();
  const open = `/app/${params.slug}/assistant/open`;

  const facts = await withTenant(ctx.company.schema, async (tx) => {
    const [m] = await tx<{ title: string | null }[]>`SELECT title FROM members WHERE id = ${ctx.member.memberId}`;
    const units = await tx.unsafe<{ path: string }[]>(`
      WITH RECURSIVE t AS (
        SELECT id, name::text AS path FROM groups WHERE parent_id IS NULL
        UNION ALL SELECT g.id, t.path || ' / ' || g.name FROM groups g JOIN t ON g.parent_id = t.id
      ) SELECT t.path FROM t JOIN member_groups mg ON mg.group_id = t.id WHERE mg.member_id = $1 ORDER BY t.path`, [ctx.member.memberId]);
    // What the assistant answers this person from: the company's rules,
    // circulars and other knowledge, plus those of their units and the units above.
    const sources = await tx.unsafe<Source[]>(`
      WITH RECURSIVE up AS (
        SELECT g.id, g.parent_id FROM groups g JOIN member_groups mg ON mg.group_id = g.id WHERE mg.member_id = $1
        UNION SELECT g.id, g.parent_id FROM groups g JOIN up ON g.id = up.parent_id
      ), paths AS (
        SELECT id, name::text AS path FROM groups WHERE parent_id IS NULL
        UNION ALL SELECT g.id, p.path || ' / ' || g.name FROM groups g JOIN paths p ON g.parent_id = p.id
      )
      SELECT k.id::text, k.kind, k.name, k.code, k.effective_date AS effective, k.updated_at AS updated,
             p.path AS unit, k.file_size IS NOT NULL AS file
      FROM knowledge k LEFT JOIN paths p ON p.id = k.unit_id
      WHERE k.active AND k.kind IN ('hr_rule','order','other') AND (k.unit_id IS NULL OR k.unit_id IN (SELECT id FROM up))
      ORDER BY (k.unit_id IS NULL), k.kind = 'hr_rule' DESC, k.sequence NULLS LAST, k.code NULLS LAST, k.name`, [ctx.member.memberId])
      .catch(() => [] as Source[]);
    return { title: m?.title ?? null, units: units.map((u) => u.path), sources };
  });

  const rules = facts.sources.filter((s) => s.kind === "hr_rule" && !s.unit).length;
  const orders = facts.sources.filter((s) => s.kind !== "hr_rule" && !s.unit).length;
  const mine = facts.sources.filter((s) => s.unit).length;
  const latest = facts.sources.reduce<Date | null>((a, s) => (!a || new Date(s.updated) > a ? new Date(s.updated) : a), null);
  const unitShort = (p: string) => p.split(" / ").slice(-1)[0];
  const error = searchParams.error && ERRORS[searchParams.error] ? ERRORS[searchParams.error] : !on ? (company?.apps?.hrChatbot ? ERRORS.config : ERRORS.off) : null;

  return (
    <>
      <PageHeader
        title="دستیار هوش مصنوعی"
        description="پرسش‌های منابع انسانی شما را از روی آیین‌نامه‌ها و بخشنامه‌های همین شرکت پاسخ می‌دهد — شبانه‌روزی، به فارسی، انگلیسی یا آلمانی."
        action={on ? (
          <a href={open} target="_blank" rel="noopener" className="btn-primary">
            <Bot className="h-4 w-4" /> باز کردن دستیار <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : undefined}
      />

      {error && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {/* Key facts: what the assistant knows for this person. */}
      <section className="card mb-4 !p-0">
        <div className="grid grid-cols-2 md:grid-cols-4">
          <Fact label="آیین‌نامه‌های منابع انسانی" value={fa(rules)} icon={ScrollText} />
          <Fact label="بخشنامه‌ها و سایر دانسته‌ها" value={fa(orders)} icon={FileText} />
          <Fact label="ویژهٔ واحد شما" value={fa(mine)} icon={Building2} />
          <Fact label="آخرین به‌روزرسانی" value={faDate(latest)} icon={CheckCircle2} />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* Ask: a suggested question opens the assistant with it asked. */}
          <section className="card">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-800">بپرسید</h2>
              <span className="text-xs text-slate-500">با زدن یک پرسش، دستیار با همان پرسش باز می‌شود</span>
            </div>
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              {TOPICS.map((t) => (
                <div key={t.topic}>
                  <div className="mb-1.5 text-xs font-medium text-slate-500">{t.topic}</div>
                  <ul className="space-y-1.5">
                    {t.questions.map((q) => (
                      <li key={q}>
                        {on ? (
                          <a href={`${open}?q=${encodeURIComponent(q)}`} target="_blank" rel="noopener"
                            className="group flex items-start gap-2 rounded-md border border-slate-200 px-2.5 py-2 text-sm text-slate-700 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600">
                            <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-slate-500 group-hover:text-brand-600" />
                            <span className="flex-1">{q}</span>
                            <ArrowUpLeft className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-0 transition group-hover:opacity-100" />
                          </a>
                        ) : (
                          <div className="flex items-start gap-2 rounded-md border border-slate-200 px-2.5 py-2 text-sm text-slate-500">
                            <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0" /> {q}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          {/* Sources: exactly what the assistant answers this person from. */}
          <section className="card !p-0">
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 lg:px-5">
              <div>
                <h2 className="text-sm font-semibold text-slate-800">منابع پاسخ</h2>
                <p className="mt-0.5 text-xs text-slate-500">دستیار فقط از همین‌ها پاسخ می‌دهد؛ دانش شرکت‌های دیگر در دسترس آن نیست.</p>
              </div>
              <Link href={`/app/${params.slug}/knowledge`} className="btn-ghost shrink-0 text-xs">
                <BookOpen className="h-3.5 w-3.5" /> دانش شرکت
              </Link>
            </div>
            {facts.sources.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-slate-600 lg:px-5">
                هنوز آیین‌نامه یا بخشنامه‌ای برای این شرکت ثبت نشده است؛ دستیار تا آن زمان پاسخ روشنی از قوانین شرکت ندارد.
                <div className="mt-1 text-xs text-slate-500">مدیر شرکت آن‌ها را در «دانش شرکت» ثبت یا بارگذاری می‌کند.</div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>عنوان</th>
                      <th className="hidden sm:table-cell">شماره سند</th>
                      <th>برای</th>
                      <th className="hidden md:table-cell">از تاریخ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {facts.sources.map((s) => (
                      <tr key={s.id}>
                        <td>
                          {s.file
                            ? <a href={`/app/${params.slug}/knowledge/file/${s.id}`} className="text-slate-800 hover:text-brand-700 hover:underline" title="دریافت سند">{s.name}</a>
                            : <span>{s.name}</span>}
                          <div className="mt-0.5 text-xs text-slate-500">{KIND_LABEL[s.kind] ?? s.kind}</div>
                        </td>
                        <td className="hidden whitespace-nowrap font-mono text-xs text-slate-600 sm:table-cell" dir="ltr">{s.code ?? "—"}</td>
                        <td>
                          {s.unit
                            ? <span className="badge border border-brand-200 bg-brand-50 text-brand-700" title={s.unit}><Building2 className="h-3 w-3" /> واحد {unitShort(s.unit)}</span>
                            : <span className="badge border border-slate-200 bg-slate-100 text-slate-600">کل شرکت</span>}
                        </td>
                        <td className="hidden whitespace-nowrap text-xs text-slate-600 md:table-cell">{faDate(s.effective)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <section className="card">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <UserRound className="h-4 w-4 text-slate-500" /> شما را این‌طور می‌شناسد
            </h2>
            <dl className="text-sm">
              <Row label="نام" value={ctx.member.fullName} />
              <Row label="سمت سازمانی" value={facts.title ?? "—"} />
              <Row label="شرکت" value={ctx.company.name} />
              <div className="py-2">
                <dt className="text-slate-500">واحد</dt>
                <dd className="mt-1 space-y-1.5">
                  {facts.units.length
                    ? facts.units.map((u) => (
                        <div key={u}>
                          <div className="font-medium text-slate-800">{unitShort(u)}</div>
                          <div className="text-xs text-slate-500">{u}</div>
                        </div>
                      ))
                    : <span className="text-slate-800">—</span>}
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-slate-500">سمت و واحد را مدیر شرکت در «اعضا» و «گروه‌ها» به‌روز می‌کند.</p>
          </section>

          <section className="card">
            <h2 className="mb-3 text-sm font-semibold text-slate-800">چطور کار می‌کند</h2>
            <ol className="space-y-3 text-sm">
              <Step n={1} title="ورود با یک کلیک">کارا هویت، سمت و واحد شما را تأیید می‌کند؛ رمز دوباره لازم نیست.</Step>
              <Step n={2} title="پاسخ از منابع شرکت">دستیار در آیین‌نامه‌ها و بخشنامه‌های همین صفحه جستجو می‌کند و از همان‌ها پاسخ می‌دهد.</Step>
              <Step n={3} title="قوانین واحد شما">اگر واحد شما قانون ویژه‌ای دارد، پاسخ بر اساس آن نوشته می‌شود.</Step>
            </ol>
          </section>

          <section className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs leading-6 text-slate-600">
            <div className="mb-1 flex items-center gap-1.5 font-medium text-slate-700"><Lock className="h-3.5 w-3.5" /> حریم خصوصی و مسئولیت</div>
            گفتگوهای شما فقط برای خودتان ذخیره می‌شود. پاسخ‌ها از متن آیین‌نامه‌هاست و جای تصمیم واحد سرمایه انسانی را نمی‌گیرد؛
            در موارد خاص با کارشناس سرمایه انسانی هماهنگ کنید.
            <div className="mt-2" dir="ltr">{hrAppUrl().replace(/^https?:\/\//, "")}</div>
          </section>
        </aside>
      </div>
    </>
  );
}

function Fact({ label, value, icon: Icon }: { label: string; value: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="flex items-center gap-3 border-slate-100 px-4 py-3 even:border-s md:border-s md:first:border-s-0 lg:px-5">
      <Icon className="h-5 w-5 shrink-0 text-slate-500" />
      <div className="min-w-0">
        <div className="truncate text-xs text-slate-500">{label}</div>
        <div className="text-lg font-semibold text-slate-900">{value}</div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-slate-100 py-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-end text-slate-800">{value}</dd>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-xs font-bold text-slate-600">{fa(n)}</span>
      <div>
        <div className="font-medium text-slate-800">{title}</div>
        <div className="text-xs leading-6 text-slate-600">{children}</div>
      </div>
    </li>
  );
}
