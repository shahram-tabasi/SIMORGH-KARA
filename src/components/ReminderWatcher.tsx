"use client";

import { useEffect, useRef, useState } from "react";

interface Reminder {
  id: string;
  title: string;
  body: string | null;
  remind_at: string;
}

const POLL_MS = 60_000;
const DISMISS_KEY = "sk_dismissed_reminders";

function loadDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || "[]"));
  } catch {
    return new Set();
  }
}
function saveDismissed(s: Set<string>) {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify([...s]));
  } catch {
    /* ignore */
  }
}

/**
 * Polls the reminder feed and surfaces due reminders as an on-screen popup and
 * (when permitted) a browser notification — which the OS shows even if this tab
 * is in the background. For reminders while the browser is fully closed, the
 * «افزودن به تقویم» (.ics) export hands off to the OS calendar.
 */
export function ReminderWatcher({ slug }: { slug: string }) {
  const [active, setActive] = useState<Reminder[]>([]);
  const notified = useRef<Set<string>>(new Set());

  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }

    let stop = false;
    async function poll() {
      try {
        const res = await fetch(`/app/${slug}/reminders/feed`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { items: Reminder[] };
        const dismissed = loadDismissed();
        const due = data.items.filter((r) => !dismissed.has(r.id));
        setActive(due);
        for (const r of due) {
          if (!notified.current.has(r.id)) {
            notified.current.add(r.id);
            if ("Notification" in window && Notification.permission === "granted") {
              try {
                new Notification(`⏰ یادآوری: ${r.title}`, {
                  body: r.body ?? "",
                  tag: r.id,
                });
              } catch {
                /* ignore */
              }
            }
          }
        }
      } catch {
        /* ignore network blips */
      }
    }

    poll();
    const t = setInterval(() => {
      if (!stop) poll();
    }, POLL_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [slug]);

  function dismiss(id: string) {
    const d = loadDismissed();
    d.add(id);
    saveDismissed(d);
    setActive((a) => a.filter((r) => r.id !== id));
  }

  if (active.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex w-80 flex-col gap-2">
      {active.map((r) => (
        <div
          key={r.id}
          className="rounded-xl border border-amber-200 bg-white p-3 shadow-lg ring-1 ring-amber-100"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-amber-700">
                <span>⏰</span>
                <span className="truncate">یادآوری: {r.title}</span>
              </div>
              {r.body && (
                <div className="mt-1 text-xs text-slate-500">{r.body}</div>
              )}
            </div>
            <button
              onClick={() => dismiss(r.id)}
              className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label="بستن"
            >
              ✕
            </button>
          </div>
          <div className="mt-2 flex gap-2">
            <a
              href={`/app/${slug}/kartabl/ics/${r.id}`}
              className="text-xs text-brand-600 hover:underline"
            >
              📅 افزودن به تقویم
            </a>
            <button
              onClick={() => dismiss(r.id)}
              className="text-xs text-slate-500 hover:underline"
            >
              متوجه شدم
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
