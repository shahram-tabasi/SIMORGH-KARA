"use client";

import { useState } from "react";
import { useFormState } from "react-dom";
import {
  editKartablItemAction,
  deleteKartablItemAction,
  type ActionState,
} from "../actions";

export function ItemActions({
  slug,
  itemId,
  title,
  body,
}: {
  slug: string;
  itemId: string;
  title: string;
  body: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useFormState<ActionState, FormData>(
    editKartablItemAction,
    {}
  );

  if (!open) {
    return (
      <div className="flex gap-2">
        <button
          onClick={() => setOpen(true)}
          className="text-xs text-brand-600 hover:underline"
        >
          ویرایش
        </button>
        <form action={deleteKartablItemAction}>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="itemId" value={itemId} />
          <button className="text-xs text-red-600 hover:underline">حذف</button>
        </form>
      </div>
    );
  }

  return (
    <form action={action} className="mt-2 space-y-2 rounded-lg bg-slate-50 p-2">
      {state.error && (
        <div className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">
          {state.error}
        </div>
      )}
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="itemId" value={itemId} />
      <input name="title" defaultValue={title} className="input" />
      <textarea name="body" defaultValue={body ?? ""} rows={2} className="input" />
      <div className="flex gap-2">
        <button className="btn-primary px-3 py-1 text-xs">ذخیره</button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="btn-ghost px-3 py-1 text-xs"
        >
          انصراف
        </button>
      </div>
    </form>
  );
}
