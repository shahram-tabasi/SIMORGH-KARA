"use client";

import { useRef } from "react";
import { setGroupScheduleAction } from "../actions";

export interface ScheduleOption {
  id: string;
  name: string;
}

/** Inline schedule picker for a group — submits on change. */
export function GroupScheduleSelect({
  slug,
  groupId,
  current,
  schedules,
}: {
  slug: string;
  groupId: string;
  current: string | null;
  schedules: ScheduleOption[];
}) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} action={setGroupScheduleAction} className="flex items-center gap-1">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="groupId" value={groupId} />
      <span className="text-[11px] text-slate-400">ساعت کاری:</span>
      <select
        name="scheduleId"
        defaultValue={current ?? ""}
        onChange={() => ref.current?.requestSubmit()}
        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 outline-none focus:border-brand-400 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200"
      >
        <option value="">— پیش‌فرض شرکت —</option>
        {schedules.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
    </form>
  );
}
