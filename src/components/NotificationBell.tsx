"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

interface Feed {
  tasks: { id: string; title: string; priority: string }[];
  approvals: number;
  messages: { id: string; title: string }[];
  count: number;
}

const POLL_MS = 60_000;
const PRIORITY_DOT: Record<string, string> = {
  normal: "bg-slate-400",
  urgent: "bg-amber-500",
  forced: "bg-red-500",
};

/** Bell with a live badge for new (unacknowledged) tasks + pending approvals. */
export function NotificationBell({ slug }: { slug: string }) {
  const [feed, setFeed] = useState<Feed>({ tasks: [], approvals: 0, messages: [], count: 0 });
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stop = false;
    async function poll() {
      try {
        const res = await fetch(`/app/${slug}/notifications/feed`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as Feed;
        if (!stop) setFeed(data);
      } catch {
        /* ignore */
      }
    }
    poll();
    const t = setInterval(poll, POLL_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [slug]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div className="relative" ref={boxRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100"
        aria-label="اعلان‌ها"
      >
        <span className="text-lg">🔔</span>
        {feed.count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {feed.count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-11 z-50 w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
          <div className="px-2 py-1 text-xs font-semibold text-slate-500">اعلان‌ها</div>
          {feed.count === 0 ? (
            <div className="px-2 py-3 text-center text-xs text-slate-400">اعلان جدیدی نیست.</div>
          ) : (
            <div className="max-h-72 space-y-1 overflow-auto">
              {feed.approvals > 0 && (
                <Link
                  href={`/app/${slug}/kartabl`}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50"
                >
                  <span className="text-indigo-500">✅</span>
                  <span className="text-slate-700">
                    {feed.approvals} درخواست در انتظار تأیید شما
                  </span>
                </Link>
              )}
              {feed.tasks.map((t) => (
                <Link
                  key={t.id}
                  href={`/app/${slug}/tasks`}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50"
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[t.priority] ?? PRIORITY_DOT.normal}`} />
                  <span className="truncate text-slate-700">وظیفهٔ جدید: {t.title}</span>
                </Link>
              ))}
              {feed.messages.map((m) => (
                <Link
                  key={m.id}
                  href={`/app/${slug}/kartabl`}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50"
                >
                  <span className="text-sky-500">✉️</span>
                  <span className="truncate text-slate-700">پیام جدید: {m.title}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
