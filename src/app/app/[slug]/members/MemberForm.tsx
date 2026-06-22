"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createMemberAction, type ActionState } from "../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" disabled={pending}>
      {pending ? "در حال افزودن…" : "افزودن عضو"}
    </button>
  );
}

export function MemberForm({ slug }: { slug: string }) {
  const [state, action] = useFormState<ActionState, FormData>(
    createMemberAction,
    {}
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  return (
    <form ref={formRef} action={action} className="card space-y-4">
      <h3 className="text-sm font-semibold text-slate-700">افزودن عضو جدید</h3>
      {state.error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </div>
      )}
      {state.ok && (
        <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
          عضو با موفقیت افزوده شد.
        </div>
      )}
      <input type="hidden" name="slug" value={slug} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">نام و نام خانوادگی</label>
          <input name="fullName" required className="input" />
        </div>
        <div>
          <label className="label">سمت (اختیاری)</label>
          <input name="title" className="input" />
        </div>
        <div>
          <label className="label">ایمیل</label>
          <input name="email" type="email" dir="ltr" required className="input text-left" />
        </div>
        <div>
          <label className="label">رمز عبور اولیه</label>
          <input name="password" type="text" required className="input" placeholder="حداقل ۶ کاراکتر" />
        </div>
      </div>
      <div className="flex justify-end">
        <Submit />
      </div>
    </form>
  );
}
