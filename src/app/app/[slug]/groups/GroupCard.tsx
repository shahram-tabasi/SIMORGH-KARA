"use client";

import { useEffect, useState } from "react";
import { GroupScheduleSelect, type ScheduleOption } from "./GroupScheduleSelect";
import {
  addGroupMemberAction,
  removeGroupMemberAction,
  setGroupManagerAction,
  deleteGroupAction,
} from "../actions";

export interface MemberLite {
  id: string;
  full_name: string;
}

export function GroupCard({
  slug,
  group,
  members,
  allMembers,
  schedules,
  canManage,
}: {
  slug: string;
  group: {
    id: string;
    name: string;
    member_count: number;
    schedule_id: string | null;
    manager_id: string | null;
  };
  members: MemberLite[]; // members of THIS group
  allMembers: MemberLite[]; // every company member (for the add picker)
  schedules: ScheduleOption[];
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const storeKey = `grp_open_${group.id}`;
  // Keep the panel open across the page reloads that server actions trigger.
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(storeKey) === "1");
    } catch {}
  }, [storeKey]);
  function toggle() {
    setOpen((o) => {
      const n = !o;
      try {
        if (n) localStorage.setItem(storeKey, "1");
        else localStorage.removeItem(storeKey);
      } catch {}
      return n;
    });
  }
  const manager = members.find((m) => m.id === group.manager_id);
  const candidates = allMembers.filter((m) => !members.some((g) => g.id === m.id));

  return (
    <div className="rounded-lg bg-slate-50 dark:bg-white/[0.03]">
      {/* header row — double-click (or the button) opens member/manager management */}
      <div
        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
        onDoubleClick={() => canManage && toggle()}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{group.name}</span>
          <span className="text-xs text-slate-400">
            ({group.member_count.toLocaleString("fa-IR")} عضو)
          </span>
          {manager ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
              مدیر: {manager.full_name}
            </span>
          ) : (
            canManage && (
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] text-slate-500 dark:bg-white/10 dark:text-slate-400">
                بدون مدیر
              </span>
            )
          )}
        </div>

        <div className="flex items-center gap-3">
          {canManage && (
            <GroupScheduleSelect
              slug={slug}
              groupId={group.id}
              current={group.schedule_id}
              schedules={schedules}
            />
          )}
          {canManage && (
            <button
              onClick={toggle}
              className="rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-600 transition hover:bg-white dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
            >
              {open ? "بستن" : "اعضا و مدیر"}
            </button>
          )}
          {canManage && (
            <form action={deleteGroupAction}>
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="groupId" value={group.id} />
              <button className="text-xs text-red-600 hover:underline">حذف</button>
            </form>
          )}
        </div>
      </div>

      {/* expandable members + manager panel */}
      {open && canManage && (
        <div className="border-t border-slate-200 px-3 py-3 dark:border-white/10">
          <div className="mb-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
            اعضای گروه و مدیر
          </div>

          {members.length === 0 ? (
            <div className="mb-3 text-xs text-slate-400">هنوز عضوی در این گروه نیست.</div>
          ) : (
            <ul className="mb-3 space-y-1">
              {members.map((m) => {
                const isManager = m.id === group.manager_id;
                return (
                  <li
                    key={m.id}
                    className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm ${
                      isManager
                        ? "bg-amber-50 dark:bg-amber-500/10"
                        : "bg-white dark:bg-white/[0.04]"
                    }`}
                  >
                    <span className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                      {m.full_name}
                      {isManager && (
                        <span className="rounded bg-amber-100 px-1.5 text-[10px] font-medium text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
                          ★ مدیر
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      <form action={setGroupManagerAction}>
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="groupId" value={group.id} />
                        <input type="hidden" name="memberId" value={isManager ? "" : m.id} />
                        <button
                          className={`rounded px-2 py-0.5 text-[11px] transition ${
                            isManager
                              ? "text-slate-400 hover:text-slate-600"
                              : "text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-500/15"
                          }`}
                        >
                          {isManager ? "برکناری مدیر" : "تعیین مدیر"}
                        </button>
                      </form>
                      <form action={removeGroupMemberAction}>
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="groupId" value={group.id} />
                        <input type="hidden" name="memberId" value={m.id} />
                        <button className="text-[11px] text-red-600 hover:underline">حذف</button>
                      </form>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {/* add member */}
          {candidates.length > 0 ? (
            <form action={addGroupMemberAction} className="flex items-center gap-2">
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="groupId" value={group.id} />
              <select
                name="memberId"
                defaultValue=""
                className="flex-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-600 outline-none focus:border-brand-400 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200"
              >
                <option value="" disabled>— انتخاب عضو برای افزودن —</option>
                {candidates.map((m) => (
                  <option key={m.id} value={m.id}>{m.full_name}</option>
                ))}
              </select>
              <button className="btn-primary !px-3 !py-1.5 text-sm">افزودن</button>
            </form>
          ) : (
            <div className="text-xs text-slate-400">همهٔ کارکنان عضو این گروه هستند.</div>
          )}
        </div>
      )}
    </div>
  );
}
