import Link from "next/link";
import { requireTenant, ensurePermission } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { todayJalali, toFaDigits } from "@/lib/jalali";
import { loadAllBalances } from "@/lib/leave-balance";
import {
  addLedgerEntryAction,
  deleteLedgerEntryAction,
  runYearEndAction,
} from "./actions";

const KIND_LABEL: Record<string, string> = {
  carry_in: "انتقال (ذخیره)",
  buyback: "بازخرید",
  forfeit: "سوخت",
  adjust: "تعدیل دستی",
};

interface LedgerRow {
  id: string;
  member_name: string;
  jyear: number;
  kind: string;
  days: string;
  note: string | null;
}

export default async function LedgerPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { y?: string };
}) {
  const ctx = await requireTenant(params.slug);
  ensurePermission(ctx, "leave.ledger.manage");

  const jy = Number(searchParams.y) || todayJalali().jy;
  const balances = await loadAllBalances(ctx.company.schema, jy);

  const entries = await withTenant(ctx.company.schema, async (tx) =>
    tx<LedgerRow[]>`
      SELECT l.id, m.full_name AS member_name, l.jyear, l.kind, l.days, l.note
      FROM leave_ledger l JOIN members m ON m.id = l.member_id
      WHERE l.jyear IN (${jy}, ${jy + 1})
      ORDER BY l.created_at DESC LIMIT 50
    `
  );

  return (
    <>
      <PageHeader
        title="مدیریت مانده مرخصی"
        description="ذخیره و سوخت پایان سال، بازخرید و تعدیل دستی مانده اعضا"
      />

      <div className="card mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Link href={`?y=${jy - 1}`} className="btn-ghost">‹ سال قبل</Link>
            <span className="text-lg font-bold text-slate-800">سال {toFaDigits(jy)}</span>
            <Link href={`?y=${jy + 1}`} className="btn-ghost">سال بعد ›</Link>
          </div>
          <form action={runYearEndAction}>
            <input type="hidden" name="slug" value={params.slug} />
            <input type="hidden" name="jyear" value={jy} />
            <button className="btn-primary">
              اجرای پایان سال {toFaDigits(jy)} (انتقال ۹ روز، سوخت مازاد)
            </button>
          </form>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          با اجرای پایان سال، حداکثر ۹ روز ماندهٔ هر عضو به سال بعد منتقل و مازاد
          سوخت می‌شود (ماده ۶۶ قانون کار). این عملیات برای اعضای بسته‌شده تکرار نمی‌شود.
        </p>
      </div>

      <div className="card mb-6">
        <h3 className="mb-3 text-sm font-semibold text-slate-700">
          مانده اعضا — سال {toFaDigits(jy)}
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-right text-xs text-slate-500">
                <th className="pb-2 font-medium">عضو</th>
                <th className="pb-2 font-medium">استحقاق امسال</th>
                <th className="pb-2 font-medium">ذخیره</th>
                <th className="pb-2 font-medium">استفاده</th>
                <th className="pb-2 font-medium">مانده</th>
              </tr>
            </thead>
            <tbody>
              {balances.map((b) => (
                <tr key={b.memberId} className="border-b border-slate-100">
                  <td className="py-2 font-medium text-slate-700">{b.name}</td>
                  <td className="py-2">{toFaDigits(b.balance.accrued)}</td>
                  <td className="py-2">{toFaDigits(b.balance.carriedIn)}</td>
                  <td className="py-2 text-amber-700">{toFaDigits(b.balance.used)}</td>
                  <td className={`py-2 font-semibold ${b.balance.remaining < 0 ? "text-red-700" : "text-green-700"}`}>
                    {toFaDigits(b.balance.remaining)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">ثبت دستی (بازخرید / تعدیل)</h3>
          <form action={addLedgerEntryAction} className="space-y-3">
            <input type="hidden" name="slug" value={params.slug} />
            <input type="hidden" name="jyear" value={jy} />
            <div>
              <label className="label">عضو</label>
              <select name="memberId" className="input">
                {balances.map((b) => (
                  <option key={b.memberId} value={b.memberId}>{b.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">نوع</label>
                <select name="kind" className="input" defaultValue="buyback">
                  <option value="buyback">بازخرید (کاهش مانده)</option>
                  <option value="carry_in">انتقال/ذخیره (افزایش)</option>
                  <option value="adjust">تعدیل دستی (±)</option>
                </select>
              </div>
              <div>
                <label className="label">تعداد روز</label>
                <input name="days" type="number" step="0.5" className="input" dir="ltr" />
              </div>
            </div>
            <div>
              <label className="label">توضیح</label>
              <input name="note" className="input" placeholder="علت ثبت" />
            </div>
            <p className="text-[11px] text-slate-400">
              برای «تعدیل» مقدار منفی هم مجاز است؛ «بازخرید» همیشه از مانده کم می‌کند.
            </p>
            <div className="flex justify-end">
              <button className="btn-primary">ثبت</button>
            </div>
          </form>
        </div>

        <div className="card">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">رویدادهای اخیر مانده</h3>
          {entries.length === 0 ? (
            <div className="text-sm text-slate-400">رویدادی ثبت نشده است.</div>
          ) : (
            <ul className="space-y-2">
              {entries.map((e) => (
                <li key={e.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <div>
                    <span className="font-medium text-slate-700">{e.member_name}</span>
                    <span className="mr-2 text-xs text-slate-500">
                      {KIND_LABEL[e.kind] ?? e.kind} · {toFaDigits(Number(e.days))} روز · سال {toFaDigits(e.jyear)}
                    </span>
                    {e.note && <div className="text-[11px] text-slate-400">{e.note}</div>}
                  </div>
                  <form action={deleteLedgerEntryAction}>
                    <input type="hidden" name="slug" value={params.slug} />
                    <input type="hidden" name="id" value={e.id} />
                    <button className="text-xs text-red-600 hover:underline">حذف</button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
