"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { JalaliDateFields } from "@/components/JalaliDate";
import { createStockRequestAction, type InventoryState } from "../actions";

interface Line {
  key: number;
  itemId: string;
  qty: string;
  note: string;
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" disabled={pending}>
      {pending ? "در حال ارسال…" : "ثبت درخواست"}
    </button>
  );
}

export function RequestForm({
  slug,
  warehouses,
  items,
}: {
  slug: string;
  warehouses: { id: string; name: string }[];
  items: { id: string; code: string; name: string; unit: string }[];
}) {
  const [state, action] = useFormState<InventoryState, FormData>(
    createStockRequestAction,
    {}
  );
  const [lines, setLines] = useState<Line[]>([
    { key: 0, itemId: "", qty: "", note: "" },
  ]);
  const [seq, setSeq] = useState(1);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) {
      ref.current?.reset();
      setLines([{ key: 0, itemId: "", qty: "", note: "" }]);
    }
  }, [state.ok]);

  const set = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <form ref={ref} action={action} className="card space-y-4">
      <h3 className="text-sm font-semibold text-slate-700">درخواست کالا از انبار</h3>
      {state.error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </div>
      )}
      <input type="hidden" name="slug" value={slug} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="label">انبار</label>
          <select name="warehouseId" className="input" defaultValue="">
            <option value="">— انتخاب —</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
        <JalaliDateFields prefix="date" label="تاریخ نیاز" />
        <div>
          <label className="label">توضیح</label>
          <input name="note" className="input" />
        </div>
      </div>

      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={l.key} className="flex flex-wrap items-end gap-2">
            <div>
              <label className="label">کالا</label>
              <select
                name={`line-item-${i}`}
                value={l.itemId}
                onChange={(e) => set(l.key, { itemId: e.target.value })}
                className="input !w-56"
              >
                <option value="">— انتخاب کالا —</option>
                {items.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.code} — {it.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">مقدار</label>
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
            </div>
            <div>
              <label className="label">توضیح ردیف</label>
              <input
                name={`line-note-${i}`}
                value={l.note}
                onChange={(e) => set(l.key, { note: e.target.value })}
                className="input !w-40"
              />
            </div>
            {lines.length > 1 && (
              <button
                type="button"
                onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                className="pb-2 text-xs text-red-600 hover:underline"
              >
                حذف
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between border-t border-slate-100 pt-3">
        <button
          type="button"
          onClick={() => {
            setLines((ls) => [...ls, { key: seq, itemId: "", qty: "", note: "" }]);
            setSeq((s) => s + 1);
          }}
          className="btn-ghost"
        >
          ＋ افزودن ردیف
        </button>
        <Submit />
      </div>
    </form>
  );
}
