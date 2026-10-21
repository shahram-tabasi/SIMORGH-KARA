"use client";

import { useComms } from "./CallProvider";

/** Voice and video call buttons for one colleague. */
export function CallButtons({ accountId, name, size = "sm" }: { accountId: string; name: string; size?: "sm" | "md" }) {
  const { enabled, startCall, inCall } = useComms();
  if (!enabled) return null;
  const cls = size === "sm" ? "btn-ghost px-2 py-1 text-xs" : "btn-ghost px-3 py-1.5 text-sm";
  return (
    <span className="inline-flex gap-1">
      <button type="button" className={cls} disabled={inCall} onClick={() => startCall([{ accountId, name }], false)}
        title={`تماس صوتی با ${name}`} aria-label={`تماس صوتی با ${name}`}>📞</button>
      <button type="button" className={cls} disabled={inCall} onClick={() => startCall([{ accountId, name }], true)}
        title={`تماس تصویری با ${name}`} aria-label={`تماس تصویری با ${name}`}>🎥</button>
    </span>
  );
}

/** Open a record's meeting room (company, project-12, order-7…). */
export function MeetButton({ topic, title, label = "اتاق جلسه" }: { topic: string; title: string; label?: string }) {
  const { enabled, startMeeting, inCall } = useComms();
  if (!enabled) return null;
  return (
    <button type="button" className="btn-ghost" disabled={inCall} onClick={() => startMeeting(topic, title)}>
      🎦 {label}
    </button>
  );
}
