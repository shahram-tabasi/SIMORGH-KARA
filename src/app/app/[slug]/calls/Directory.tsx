"use client";

import { useMemo, useState } from "react";
import { CallButtons } from "@/components/comms/CallButtons";
import { useComms } from "@/components/comms/CallProvider";

interface Person { accountId: string; name: string; title: string | null }

/** Colleagues: search, call one, or tick several for a group call. */
export function Directory({ people }: { people: Person[] }) {
  const { enabled, startCall, inCall } = useComms();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const shown = useMemo(() => {
    const s = q.trim();
    return s ? people.filter((p) => p.name.includes(s) || (p.title ?? "").includes(s)) : people;
  }, [q, people]);
  const toggle = (id: string) => setPicked((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const group = people.filter((p) => picked.has(p.accountId));

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-semibold">همکاران</h2>
        {enabled && group.length > 1 && (
          <button className="btn-primary px-3 py-1.5 text-sm" disabled={inCall}
            onClick={() => { void startCall(group, false); setPicked(new Set()); }}>
            تماس گروهی ({group.length} نفر)
          </button>
        )}
      </div>
      <input className="input mb-3" placeholder="جستجوی نام یا سمت…" value={q} onChange={(e) => setQ(e.target.value)} />
      {shown.length === 0 && <p className="text-sm text-slate-500">کسی پیدا نشد.</p>}
      <ul className="divide-y divide-slate-200 dark:divide-white/10">
        {shown.map((p) => (
          <li key={p.accountId} className="flex items-center justify-between gap-3 py-2">
            <label className="flex min-w-0 cursor-pointer items-center gap-3">
              {enabled && (
                <input type="checkbox" checked={picked.has(p.accountId)} onChange={() => toggle(p.accountId)}
                  aria-label={`انتخاب ${p.name} برای تماس گروهی`} />
              )}
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{p.name}</span>
                {p.title && <span className="block truncate text-xs text-slate-500">{p.title}</span>}
              </span>
            </label>
            <CallButtons accountId={p.accountId} name={p.name} />
          </li>
        ))}
      </ul>
    </div>
  );
}
