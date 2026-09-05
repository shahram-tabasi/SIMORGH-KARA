"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { JalaliDateFields } from "@/components/JalaliDate";
import { DOC_KINDS, formatQty, isOutgoing } from "@/lib/inventory";
import { formatAmount } from "@/lib/finance";
import { createStockDocAction, type InventoryState } from "../actions";

interface Item {
  id: string;
  code: string;
  name: string;
  unit: string;
  last_price: string;
}

interface Line {
  key: number;
  itemId: string;
  qty: string;
  price: string;
  note: string;
}

const emptyLine = (key: number): Line => ({
  key,
  itemId: "",
  qty: "",
  price: "",
  note: "",
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
 * فرم سند انبار — یک فرم برای همهٔ انواع سند؛ فیلدهای مربوط به هر نوع
 * (انبار مقصد برای انتقال، طرف‌حساب برای رسید…) با تغییر نوع سند ظاهر می‌شوند.
 */
export function DocForm({
  slug,
  kinds,
  warehouses,
  items,
  parties,
  members,
}: {
  slug: string;
  /** Only the document kinds this person is allowed to create. */
  kinds: string[];
  warehouses: { id: string; name: string }[];
  items: Item[];
  parties: { id: string; name: string }[];
  members: { id: string; full_name: string }[];
}) {
  const [state, action] = useFormState<InventoryState, FormData>(
    createStockDocAction,
    {}
  );
  const [kind, setKind] = useState(kinds[0] ?? "receipt");
  const [lines, setLines] = useState<Line[]>([emptyLine(0)]);
  const [seq, setSeq] = useState(1);

  const set = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const filled = lines.filter((l) => l.itemId && Number(l.qty) > 0);
  const total = filled.reduce(
    (s, l) => s + Number(l.qty) * (Number(l.price) || 0),
    0
  );

  return (
    <form action={action} className="card space-y-4">
      {state.error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </div>
      )}
      <input type="hidden" name="slug" value={slug} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div>
          <label className="label">نوع سند</label>
          <select
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="input"
          >
            {kinds.map((k) => (
              <option key={k} value={k}>
                {DOC_KINDS[k as keyof typeof DOC_KINDS]}
              </option>
            ))}
          </select>
        </div>
        <JalaliDateFields prefix="date" label="تاریخ سند" />
        <div>
          <label className="label">{isOutgoing(kind) ? "از انبار" : "به انبار"}</label>
          <select name="warehouseId" required className="input" defaultValue="">
            <option value="">— انتخاب —</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
        {kind === "transfer" ? (
          <div>
            <label className="label">به انبار (مقصد)</label>
            <select name="toWarehouseId" className="input" defaultValue="">
              <option value="">— انتخاب —</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
        ) : kind === "receipt" ? (
          <div>
            <label className="label">تأمین‌کننده</label>
            <select name="partyId" className="input" defaultValue="">
              <option value="">—</option>
              {parties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div>
            <label className="label">تحویل‌گیرنده</label>
            <select name="memberId" className="input" defaultValue="">
              <option value="">—</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.full_name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="sm:col-span-4">
          <label className="label">شرح سند</label>
          <input name="note" className="input" />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="text-right text-xs text-slate-400">
              <th className="pb-2">کالا</th>
              <th className="pb-2">مقدار</th>
              <th className="pb-2">قیمت واحد</th>
              <th className="pb-2">مبلغ</th>
              <th className="pb-2">توضیح</th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const item = items.find((x) => x.id === l.itemId);
              return (
                <tr key={l.key} className="border-t border-slate-100">
                  <td className="py-1.5">
                    <select
                      name={`line-item-${i}`}
                      value={l.itemId}
                      onChange={(e) => {
                        const it = items.find((x) => x.id === e.target.value);
                        set(l.key, {
                          itemId: e.target.value,
                          price: l.price || (it ? String(Number(it.last_price)) : ""),
                        });
                      }}
                      className="input !w-56"
                    >
                      <option value="">— انتخاب کالا —</option>
                      {items.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.code} — {it.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1.5">
                    <div className="flex items-center gap-1">
                      <input
                        name={`line-qty-${i}`}
                        value={l.qty}
                        onChange={(e) => set(l.key, { qty: e.target.value })}
                        type="number"
                        min={0}
                        step="0.001"
                        dir="ltr"
                        className="input !w-24 text-left"
                      />
                      <span className="text-[11px] text-slate-400">{item?.unit ?? ""}</span>
                    </div>
                  </td>
                  <td className="py-1.5">
                    <input
                      name={`line-price-${i}`}
                      value={l.price}
                      onChange={(e) => set(l.key, { price: e.target.value })}
                      type="number"
                      min={0}
                      step="0.01"
                      dir="ltr"
                      className="input !w-28 text-left"
                    />
                  </td>
                  <td className="py-1.5 text-xs text-slate-500">
                    {formatAmount((Number(l.qty) || 0) * (Number(l.price) || 0))}
                  </td>
                  <td className="py-1.5">
                    <input
                      name={`line-note-${i}`}
                      value={l.note}
                      onChange={(e) => set(l.key, { note: e.target.value })}
                      className="input !w-32"
                    />
                  </td>
                  <td className="py-1.5">
                    {lines.length > 1 && (
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
              );
            })}
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
          ＋ افزودن ردیف
        </button>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className="text-slate-500">
            {filled.length} ردیف · مقدار کل{" "}
            <b className="text-slate-700">
              {formatQty(filled.reduce((s, l) => s + Number(l.qty), 0))}
            </b>
          </span>
          <span className="text-slate-500">
            مبلغ کل: <b className="text-slate-700">{formatAmount(total)}</b>
          </span>
          <Submit disabled={filled.length === 0} />
        </div>
      </div>
    </form>
  );
}
