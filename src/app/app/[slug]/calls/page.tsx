import { requireTenant } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { karaApi, karaApiEnabled } from "@/lib/kara-api";
import { toFaDigits, toJalali, JALALI_MONTHS } from "@/lib/jalali";
import { Directory } from "./Directory";
import { MeetButton } from "@/components/comms/CallButtons";

export const dynamic = "force-dynamic";

interface CallView {
  id: string;
  video: boolean;
  status: string;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  direction: "outgoing" | "incoming";
  myState: string;
  others: { accountId: string; name: string; state: string }[];
}

function when(iso: string) {
  const d = new Date(iso);
  const j = toJalali(d);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${toFaDigits(j.jd)} ${JALALI_MONTHS[j.jm - 1]} ${toFaDigits(hm)}`;
}

function length(c: CallView) {
  if (!c.answeredAt || !c.endedAt) return "";
  const s = Math.max(0, Math.round((Date.parse(c.endedAt) - Date.parse(c.answeredAt)) / 1000));
  return toFaDigits(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
}

function outcome(c: CallView): { text: string; tone: string } {
  if (c.direction === "incoming" && c.myState === "missed") return { text: "بی‌پاسخ", tone: "bg-red-500/15 text-red-300" };
  if (c.status === "missed") return { text: "پاسخ داده نشد", tone: "bg-amber-500/15 text-amber-300" };
  if (c.status === "declined" || c.myState === "declined") return { text: "رد شد", tone: "bg-amber-500/15 text-amber-300" };
  if (c.status === "cancelled") return { text: "لغو شد", tone: "bg-slate-500/15 text-slate-300" };
  if (c.status === "active" || c.status === "ringing") return { text: "در جریان", tone: "bg-emerald-500/15 text-emerald-300" };
  return { text: "انجام شد", tone: "bg-emerald-500/15 text-emerald-300" };
}

export default async function CallsPage({ params }: { params: { slug: string } }) {
  const ctx = await requireTenant(params.slug);
  const me = ctx.session.sub;
  const people = await withTenant(ctx.company.schema, (tx) => tx<{ account_id: string; full_name: string; title: string | null }[]>`
    SELECT account_id, full_name, title FROM members
    WHERE status = 'active' AND account_id <> ${me}
    ORDER BY full_name
  `);
  let calls: CallView[] = [];
  let error: string | null = null;
  if (karaApiEnabled()) {
    try {
      calls = (await karaApi<{ items: CallView[] }>(me, "GET", `/v1/tenants/${encodeURIComponent(params.slug)}/calls?limit=30`)).items;
    } catch (e) {
      error = (e as Error).message;
    }
  }

  return (
    <div>
      <PageHeader
        title="تماس و جلسه"
        description="تماس صوتی و تصویری با همکاران، و اتاق جلسه شرکت؛ همه داخل سیمرغ کارا."
        action={<MeetButton topic="company" title={`جلسه ${ctx.company.name}`} label="اتاق جلسه شرکت" />}
      />
      {!karaApiEnabled() && (
        <div className="card mb-4 text-sm text-amber-700 dark:text-amber-300">تماس و جلسه روی این نصب فعال نیست.</div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Directory people={people.map((p) => ({ accountId: p.account_id, name: p.full_name, title: p.title }))} />
        <div className="card">
          <h2 className="mb-3 font-semibold">تماس‌های اخیر</h2>
          {error && <p className="text-sm text-red-500">{error}</p>}
          {!error && calls.length === 0 && <p className="text-sm text-slate-500">هنوز تماسی نبوده است.</p>}
          <ul className="divide-y divide-slate-200 dark:divide-white/10">
            {calls.map((c) => {
              const o = outcome(c);
              return (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      <span className="me-1 text-slate-400">{c.direction === "outgoing" ? "↗" : "↙"}</span>
                      {c.others.map((p) => p.name).join("، ")}
                      <span className="ms-2 text-xs text-slate-400">{c.video ? "تصویری" : "صوتی"}</span>
                    </div>
                    <div className="text-xs text-slate-500">{when(c.startedAt)}{length(c) && ` · ${length(c)}`}</div>
                  </div>
                  <span className={`badge ${o.tone}`}>{o.text}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
