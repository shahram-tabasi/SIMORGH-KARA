"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { setMemberPasswordAction, type ActionState } from "../actions";

function Submit() {
  const { pending } = useFormStatus();
  return <button className="btn-ghost text-xs" disabled={pending}>{pending ? "…" : "تعیین رمز موقت"}</button>;
}

/** A temporary sign-in password for a person (changed at their first sign-in). */
export function PasswordField({ slug, memberId }: { slug: string; memberId: string }) {
  const [state, action] = useFormState<ActionState, FormData>(setMemberPasswordAction, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state.ok) ref.current?.reset(); }, [state.ok]);
  return (
    <form ref={ref} action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="memberId" value={memberId} />
      <input name="password" type="text" dir="ltr" minLength={8} required autoComplete="new-password"
        className="input max-w-xs text-left" placeholder="حداقل ۸ کاراکتر" />
      <Submit />
      {state.ok && <span className="text-xs text-green-700">ثبت شد؛ در نخستین ورود باید عوض شود.</span>}
      {state.error && <span className="text-xs text-red-700">{state.error}</span>}
    </form>
  );
}
