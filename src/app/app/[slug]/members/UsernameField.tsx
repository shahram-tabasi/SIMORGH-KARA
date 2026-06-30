"use client";

import { useFormState, useFormStatus } from "react-dom";
import { setMemberUsernameAction, type UsernameState } from "../actions";

function SaveBtn() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary !px-3 !py-1.5 text-sm" disabled={pending}>
      {pending ? "…" : "ذخیره"}
    </button>
  );
}

export function UsernameField({
  slug,
  memberId,
  current,
}: {
  slug: string;
  memberId: string;
  current: string | null;
}) {
  const [state, action] = useFormState<UsernameState, FormData>(
    setMemberUsernameAction,
    {}
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="memberId" value={memberId} />
      <input
        name="username"
        defaultValue={current ?? ""}
        dir="ltr"
        placeholder="username"
        className="w-44 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-left text-sm outline-none focus:border-brand-400 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200"
      />
      <SaveBtn />
      {state.error && <span className="text-[11px] text-red-600">{state.error}</span>}
      {state.ok && <span className="text-[11px] text-green-600">{state.ok}</span>}
    </form>
  );
}
