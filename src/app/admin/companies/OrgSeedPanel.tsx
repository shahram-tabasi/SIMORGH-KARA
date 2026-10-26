"use client";

import { useFormState, useFormStatus } from "react-dom";
import { seedOrgAction, type SeedOrgState } from "../actions";

const KIND: Record<string, string> = {
  unit: "واحد",
  merge: "ادغام",
  person: "فرد",
  owner: "مالک",
  rule: "آیین‌نامه",
  product: "محصول",
  outside: "خارج از چارت",
  remove: "حذف",
};

function Buttons() {
  const { pending } = useFormStatus();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button name="mode" value="preview" disabled={pending} className="btn-ghost disabled:opacity-50">
        {pending ? "در حال بررسی…" : "پیش‌نمایش تغییرات"}
      </button>
      <button name="mode" value="apply" disabled={pending} className="btn-primary disabled:opacity-50">
        اعمال ساختار
      </button>
    </div>
  );
}

/**
 * A company's prepared organisation (its chart, where its people sit, its
 * owners, HR rules and products): previewed, then applied, with kara-api's
 * report shown line by line.
 */
export function OrgSeedPanel({ slug }: { slug: string }) {
  const [state, action] = useFormState<SeedOrgState, FormData>(seedOrgAction, {});
  const lines = (state.report ?? []).filter((l) => l.trim());
  const summary = lines.length ? lines[lines.length - 1] : null;
  const rows = lines.slice(0, -1).map((l) => {
    const t = l.replace(/^\(dry run\) /, "");
    const notFound = t.startsWith("NOT FOUND");
    const m = /^(\w+)\s+(.*)$/.exec(t);
    return { kind: notFound ? "NOT FOUND" : m?.[1] ?? "", text: notFound ? t.slice(10) : m?.[2] ?? t, notFound };
  });

  return (
    <details className="mt-4 border-t border-slate-100 pt-4" open={!!state.report || !!state.error}>
      <summary className="cursor-pointer text-sm font-medium text-slate-700">ساختار سازمانی آماده (چارت، افراد، آیین‌نامه‌ها)…</summary>
      <form action={action} className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <input type="hidden" name="slug" value={slug} />
        <p className="text-sm text-slate-600">
          چارت سازمانی این شرکت روی واحدهای فعلی‌اش گذاشته می‌شود: واحد هم‌نام نگه داشته و زیر واحد بالادستش منتقل می‌شود، واحدهای چیدمان قبلی
          در واحد متناظر چارت ادغام می‌شوند، افراد در واحد خود قرار می‌گیرند و آیین‌نامه‌ها و محصولات به دانش شرکت اضافه می‌شوند. سپس همه‌چیز
          به Odoo و برنامه‌ها می‌رود. اجرای دوباره چیزی را دوباره جابه‌جا نمی‌کند.
        </p>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="prune" defaultChecked className="h-4 w-4" />
          واحدهای خارج از چارت که خالی مانده‌اند حذف شوند
        </label>
        <Buttons />
      </form>

      {state.error && <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</div>}

      {state.report && (
        <div className={`mt-3 rounded-lg border p-3 ${state.dryRun ? "border-amber-200 bg-amber-50" : "border-green-200 bg-green-50"}`}>
          <div className={`text-sm font-semibold ${state.dryRun ? "text-amber-800" : "text-green-700"}`}>
            {state.dryRun ? "پیش‌نمایش — هنوز چیزی نوشته نشده است" : "اعمال شد"}
          </div>
          {summary && <div className="mt-0.5 text-xs text-slate-600" dir="ltr">{summary.replace(/^\(dry run\) /, "")}</div>}
          {rows.length === 0 ? (
            <div className="mt-2 text-sm text-slate-600">همه‌چیز مطابق چارت است؛ تغییری لازم نیست.</div>
          ) : (
            <div className="mt-2 max-h-96 overflow-auto rounded border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-b border-slate-100 last:border-0">
                      <td className="w-28 whitespace-nowrap px-2 py-1 align-top">
                        <span className={`badge ${r.notFound ? "bg-amber-50 text-amber-800 border border-amber-200" : "bg-slate-100 text-slate-600"}`}>
                          {r.notFound ? "پیدا نشد" : KIND[r.kind] ?? r.kind}
                        </span>
                      </td>
                      <td className="px-2 py-1 text-slate-700">{r.text}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </details>
  );
}
