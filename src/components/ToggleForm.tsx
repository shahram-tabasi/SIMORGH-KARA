"use client";

import { useRef } from "react";

/**
 * A checkbox that submits a server action on change. Used for assigning roles
 * and groups to a member without a separate "save" button.
 */
export function ToggleForm({
  action,
  hidden,
  checked,
  label,
}: {
  action: (formData: FormData) => void | Promise<void>;
  hidden: Record<string, string>;
  checked: boolean;
  label: string;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const checkRef = useRef<HTMLInputElement>(null);

  return (
    <form ref={ref} action={action} className="inline-flex">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input
        type="hidden"
        name="checked"
        ref={checkRef}
        defaultValue={checked ? "1" : "0"}
      />
      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
        <input
          type="checkbox"
          defaultChecked={checked}
          onChange={(e) => {
            if (checkRef.current) {
              checkRef.current.value = e.target.checked ? "1" : "0";
            }
            ref.current?.requestSubmit();
          }}
          className="h-3.5 w-3.5"
        />
        {label}
      </label>
    </form>
  );
}
