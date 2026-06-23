"use client";

import { useRef } from "react";
import { setMemberScheduleAction } from "../actions";

export function ScheduleSelect({
  slug,
  memberId,
  current,
  schedules,
}: {
  slug: string;
  memberId: string;
  current: string | null;
  schedules: { id: string; name: string; is_default: boolean }[];
}) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form action={setMemberScheduleAction} ref={ref}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="memberId" value={memberId} />
      <select
        name="scheduleId"
        defaultValue={current ?? ""}
        onChange={() => ref.current?.requestSubmit()}
        className="input py-1 text-sm"
      >
        <option value="">
          پیش‌فرض شرکت
          {schedules.find((s) => s.is_default)
            ? ` (${schedules.find((s) => s.is_default)!.name})`
            : ""}
        </option>
        {schedules.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </form>
  );
}
