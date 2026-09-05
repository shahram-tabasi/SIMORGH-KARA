"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { UNITS } from "@/lib/inventory";
import { createItemAction, type InventoryState } from "../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" disabled={pending}>
      {pending ? "در حال ذخیره…" : "افزودن کالا"}
    </button>
  );
}

export function ItemForm({
  slug,
  categories,
}: {
  slug: string;
  categories: { id: string; name: string }[];
}) {
  const [state, action] = useFormState<InventoryState, FormData>(
    createItemAction,
    {}
  );
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);

  return (
    <form ref={ref} action={action} className="card space-y-4">
      <h3 className="text-sm font-semibold text-slate-700">افزودن کالا</h3>
      {state.error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </div>
      )}
      <input type="hidden" name="slug" value={slug} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div>
          <label className="label">کد کالا</label>
          <input name="code" required dir="ltr" className="input text-left" placeholder="IT-1001" />
        </div>
        <div className="sm:col-span-2">
          <label className="label">نام کالا</label>
          <input name="name" required className="input" placeholder="بلبرینگ ۶۲۰۴" />
        </div>
        <div>
          <label className="label">واحد</label>
          <select name="unit" className="input" defaultValue="عدد">
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">گروه کالا</label>
          <select name="categoryId" className="input" defaultValue="">
            <option value="">—</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">نقطهٔ سفارش</label>
          <input name="minStock" type="number" min={0} step="0.001" dir="ltr" className="input text-left" defaultValue={0} />
        </div>
        <div>
          <label className="label">حداکثر موجودی</label>
          <input name="maxStock" type="number" min={0} step="0.001" dir="ltr" className="input text-left" />
        </div>
        <div>
          <label className="label">آخرین قیمت واحد</label>
          <input name="lastPrice" type="number" min={0} step="0.01" dir="ltr" className="input text-left" defaultValue={0} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">بارکد</label>
          <input name="barcode" dir="ltr" className="input text-left" />
        </div>
        <div className="sm:col-span-2">
          <label className="label">توضیح</label>
          <input name="description" className="input" />
        </div>
      </div>
      <div className="flex justify-end">
        <Submit />
      </div>
    </form>
  );
}
