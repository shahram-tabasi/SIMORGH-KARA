"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { JalaliDateFields } from "@/components/JalaliDate";
import { formatAmount } from "@/lib/finance";
import { createEntryAction, type FinanceState } from "../actions";

interface Option {
  id: string;
  code: string;
  name: string;
}

interface Line {
  key: number;
  accountId: string;
  debit: string;
  credit: string;
  description: string;
  partyId: string;
  costCenterId: string;
}

const emptyLine = (key: number): Line => ({
  key,
  accountId: "",
  debit: "",
  credit: "",
  description: "",
  partyId: "",
  costCenterId: "",
});

function Submit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" disabled={pending || disabled}>
      {pending ? "در حال ثبت…" : "ثبت سند (پیش‌نویس)"}
    </button>
  );
}

/**
 * سند حسابداری دوطرفه — the voucher is only submittable when بدهکار = بستانکار,
 * so an unbalanced document can never reach the server.
 */
export function EntryForm({
  slug,
  accounts,
  parties,
  costCenters,
}: {
  slug: string;
  accounts: Option[];
  parties: Option[];
  costCenters: Option[];
}) {
  const [state, action] = useFormState<FinanceState, FormData>(
    createEntryAction,
    {}
  );
  const [lines, setLines] = useState<Line[]>([emptyLine(0), emptyLine(1)]);
  const [seq, setSeq] = useState(2);

  const set = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const diff = totalDebit - totalCredit;
  const filled = lines.filter((l) => l.accountId && (Number(l.debit) || Number(l.credit)));
  const balanced = Math.abs(diff) < 0.009 && filled.length >= 2;

  return (
    <form action={action} className="card space-y-4">
      {state.error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </div>
      )}
      <input type="hidden" name="slug" value={slug} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <JalaliDateFields prefix="date" label="تاریخ سند" />
        <div className="sm:col-span-2">
          <label className="label">شرح سند</label>
          <input name="description" className="input" placeholder="مثلاً بابت خرید مواد اولیه" />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] text-sm">
          <thead>
            <tr className="text-right text-xs text-slate-400">
              <th className="pb-2">حساب</th>
              <th className="pb-2">شرح آرتیکل</th>
              <th className="pb-2">طرف‌حساب</th>
              <th className="pb-2">مرکز هزینه</th>
              <th className="pb-2">بدهکار</th>
              <th className="pb-2">بستانکار</th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.key} className="border-t border-slate-100">
                <td className="py-1.5">
                  <select
                    name={`line-account-${i}`}
                    value={l.accountId}
                    onChange={(e) => set(l.key, { accountId: e.target.value })}
                    className="input !w-52"
                  >
                    <option value="">— انتخاب حساب —</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} — {a.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-1.5">
                  <input
                    name={`line-desc-${i}`}
                    value={l.description}
                    onChange={(e) => set(l.key, { description: e.target.value })}
                    className="input !w-40"
                  />
                </td>
                <td className="py-1.5">
                  <select
                    name={`line-party-${i}`}
                    value={l.partyId}
                    onChange={(e) => set(l.key, { partyId: e.target.value })}
                    className="input !w-36"
                  >
                    <option value="">—</option>
                    {parties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-1.5">
                  <select
                    name={`line-cc-${i}`}
                    value={l.costCenterId}
                    onChange={(e) => set(l.key, { costCenterId: e.target.value })}
                    className="input !w-32"
                  >
                    <option value="">—</option>
                    {costCenters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-1.5">
                  <input
                    name={`line-debit-${i}`}
                    value={l.debit}
                    onChange={(e) => set(l.key, { debit: e.target.value, credit: "" })}
                    type="number"
                    min={0}
                    step="0.01"
                    dir="ltr"
                    className="input !w-28 text-left"
                  />
                </td>
                <td className="py-1.5">
                  <input
                    name={`line-credit-${i}`}
                    value={l.credit}
                    onChange={(e) => set(l.key, { credit: e.target.value, debit: "" })}
                    type="number"
                    min={0}
                    step="0.01"
                    dir="ltr"
                    className="input !w-28 text-left"
                  />
                </td>
                <td className="py-1.5">
                  {lines.length > 2 && (
                    <button
                      type="button"
                      onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                      className="text-xs text-red-600 hover:underline"
                    >
                      حذف
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
        <button
          type="button"
          onClick={() => {
            setLines((ls) => [...ls, emptyLine(seq)]);
            setSeq((s) => s + 1);
          }}
          className="btn-ghost"
        >
          ＋ افزودن آرتیکل
        </button>

        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className="text-slate-500">
            بدهکار: <b className="text-slate-700">{formatAmount(totalDebit)}</b>
          </span>
          <span className="text-slate-500">
            بستانکار: <b className="text-slate-700">{formatAmount(totalCredit)}</b>
          </span>
          <span
            className={`badge ${
              balanced ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
            }`}
          >
            {balanced ? "تراز است" : `اختلاف: ${formatAmount(Math.abs(diff))}`}
          </span>
          <Submit disabled={!balanced} />
        </div>
      </div>
    </form>
  );
}
