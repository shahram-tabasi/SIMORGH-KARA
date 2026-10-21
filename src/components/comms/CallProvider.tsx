"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

/**
 * Calls and meetings in Kara (docs/VEO.md §9a). Kara rings, Jitsi carries the
 * call: kara-api sends live events (incoming, accepted, declined, ended,
 * missed) over one stream per tab; answering opens the call's private Jitsi
 * room in a window inside Kara, with a token kara-api signs for the person.
 */

interface JoinInfo { url: string; domain: string; room: string; jwt: string }
interface Person { accountId: string; name: string }
interface Incoming { callId: string; video: boolean; from: Person; others: number }
interface Active {
  callId: string | null;          // null: a meeting room, not a call
  title: string;
  join: JoinInfo;
  video: boolean;
  status: "calling" | "connected";
}
interface Toast { id: number; text: string; tone: "info" | "warn" }

interface CommsApi {
  enabled: boolean;
  startCall: (people: Person[], video: boolean) => Promise<void>;
  startMeeting: (topic: string, title: string) => Promise<void>;
  inCall: boolean;
}

const Ctx = createContext<CommsApi>({ enabled: false, startCall: async () => {}, startMeeting: async () => {}, inCall: false });
export const useComms = () => useContext(Ctx);

// ── Sounds, made with Web Audio (no files): ringtone for the callee, the
// ringback tone (425 Hz, Iran's) for the caller. ─────────────────────────────
let audio: AudioContext | null = null;
function ctx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audio) {
    const A = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!A) return null;
    audio = new A();
  }
  if (audio.state === "suspended") void audio.resume().catch(() => {});
  return audio;
}
function beep(freqs: number[], start: number, length: number, gain = 0.06) {
  const a = ctx();
  if (!a) return;
  const g = a.createGain();
  g.gain.setValueAtTime(0, a.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, a.currentTime + start + 0.02);
  g.gain.setValueAtTime(gain, a.currentTime + start + length - 0.04);
  g.gain.linearRampToValueAtTime(0, a.currentTime + start + length);
  g.connect(a.destination);
  for (const f of freqs) {
    const o = a.createOscillator();
    o.frequency.value = f;
    o.connect(g);
    o.start(a.currentTime + start);
    o.stop(a.currentTime + start + length);
  }
}
function useTone(kind: "ring" | "ringback" | null) {
  useEffect(() => {
    if (!kind) return;
    const play = () => {
      if (kind === "ring") { beep([659, 880], 0, 0.35); beep([659, 880], 0.45, 0.35); }
      else beep([425], 0, 1.0, 0.04);
    };
    play();
    const t = setInterval(play, kind === "ring" ? 2000 : 4000);
    return () => clearInterval(t);
  }, [kind]);
}

// ── Jitsi's IFrame API, loaded once from the Jitsi server itself ──────────────
type JitsiApi = { dispose: () => void; addListener: (e: string, f: () => void) => void; executeCommand: (c: string, ...a: unknown[]) => void };
type JitsiCtor = new (domain: string, opts: Record<string, unknown>) => JitsiApi;
const scripts = new Map<string, Promise<JitsiCtor>>();
function loadJitsi(url: string): Promise<JitsiCtor> {
  let p = scripts.get(url);
  if (!p) {
    p = new Promise<JitsiCtor>((resolve, reject) => {
      const w = window as unknown as { JitsiMeetExternalAPI?: JitsiCtor };
      if (w.JitsiMeetExternalAPI) return resolve(w.JitsiMeetExternalAPI);
      const s = document.createElement("script");
      s.src = `${url}/external_api.js`;
      s.async = true;
      s.onload = () => (w.JitsiMeetExternalAPI ? resolve(w.JitsiMeetExternalAPI) : reject(new Error("no Jitsi API")));
      s.onerror = () => { scripts.delete(url); reject(new Error("Jitsi could not be loaded")); };
      document.head.appendChild(s);
    });
    scripts.set(url, p);
  }
  return p;
}

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: body !== undefined ? { "content-type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
  return data as T;
}

const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("");

export function CallProvider({ slug, enabled, children }: { slug: string; enabled: boolean; children: React.ReactNode }) {
  const base = `/app/${slug}/comms`;
  const [incoming, setIncoming] = useState<Incoming[]>([]);
  const [active, setActive] = useState<Active | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const activeRef = useRef<Active | null>(null);
  activeRef.current = active;

  const toast = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  useTone(incoming.length > 0 && !active ? "ring" : active?.status === "calling" ? "ringback" : null);

  // Browsers allow sound only after the person has touched the page once.
  useEffect(() => {
    const unlock = () => ctx();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  const close = useCallback((message?: string, tone: Toast["tone"] = "info") => {
    setActive(null);
    setMinimized(false);
    if (message) toast(message, tone);
  }, [toast]);

  // The live stream: EventSource reconnects by itself (retry: 3000).
  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource(`${base}/live`);
    const on = (type: string, f: (d: Record<string, unknown>) => void) =>
      es.addEventListener(type, (e) => f(JSON.parse((e as MessageEvent).data)));
    on("call.incoming", (d) => {
      const call = d as unknown as Incoming;
      setIncoming((list) => (list.some((c) => c.callId === call.callId) ? list : [...list, call]));
      if (document.hidden && "Notification" in window && Notification.permission === "granted") {
        try { new Notification(`📞 تماس از ${call.from.name}`, { body: "برای پاسخ به سیمرغ کارا بروید", tag: call.callId }); } catch { /* ignore */ }
      }
    });
    const drop = (d: Record<string, unknown>) => setIncoming((list) => list.filter((c) => c.callId !== d.callId));
    on("call.handled", drop);
    on("call.cancelled", drop);
    on("call.missed", (d) => {
      drop(d);
      toast(`تماس بی‌پاسخ از ${(d.from as Person)?.name ?? ""}`, "warn");
    });
    on("call.accepted", (d) => {
      if (activeRef.current?.callId === d.callId) {
        setActive((a) => (a ? { ...a, status: "connected" } : a));
        toast(`${(d.by as Person)?.name ?? ""} پاسخ داد`);
      }
    });
    on("call.declined", (d) => {
      if (activeRef.current?.callId === d.callId) toast(`${(d.by as Person)?.name ?? ""} تماس را رد کرد`, "warn");
    });
    on("call.busy", (d) => {
      if (activeRef.current?.callId === d.callId) toast("مخاطب در تماس دیگری است", "warn");
    });
    on("call.ended", (d) => {
      if (activeRef.current?.callId !== d.callId) return;
      const reason = d.reason as string;
      close(reason === "missed" ? "پاسخی داده نشد" : reason === "declined" ? "تماس رد شد" : "تماس پایان یافت",
        reason === "ended" ? "info" : "warn");
    });
    return () => es.close();
  }, [enabled, base, toast, close]);

  const startCall = useCallback(async (people: Person[], video: boolean) => {
    if (activeRef.current) return toast("اول تماس فعلی را تمام کنید", "warn");
    ctx();
    try {
      const r = await post<{ call: { id: string }; join: JoinInfo }>(`${base}/calls`, { to: people.map((p) => p.accountId), video });
      const title = people.length === 1 ? people[0].name : `${people.length} نفر`;
      setActive({ callId: r.call.id, title, join: r.join, video, status: "calling" });
    } catch (e) {
      toast(`تماس برقرار نشد: ${(e as Error).message}`, "warn");
    }
  }, [base, toast]);

  const startMeeting = useCallback(async (topic: string, title: string) => {
    if (activeRef.current) return toast("اول تماس فعلی را تمام کنید", "warn");
    try {
      const join = await post<JoinInfo>(`${base}/meet`, { topic });
      setActive({ callId: null, title, join, video: true, status: "connected" });
    } catch (e) {
      toast(`جلسه باز نشد: ${(e as Error).message}`, "warn");
    }
  }, [base, toast]);

  const answer = async (call: Incoming) => {
    ctx();
    try {
      const r = await post<{ join: JoinInfo }>(`${base}/calls/${call.callId}/accept`);
      setIncoming((list) => list.filter((c) => c.callId !== call.callId));
      setActive({ callId: call.callId, title: call.from.name, join: r.join, video: call.video, status: "connected" });
    } catch (e) {
      setIncoming((list) => list.filter((c) => c.callId !== call.callId));
      toast(`پاسخ ممکن نشد: ${(e as Error).message}`, "warn");
    }
  };

  const decline = async (call: Incoming) => {
    setIncoming((list) => list.filter((c) => c.callId !== call.callId));
    await post(`${base}/calls/${call.callId}/decline`).catch(() => {});
  };

  const hangUp = useCallback(async () => {
    const a = activeRef.current;
    close();
    if (a?.callId) await post(`${base}/calls/${a.callId}/leave`).catch(() => {});
  }, [base, close]);

  const ring = !active ? incoming[0] : undefined;

  return (
    <Ctx.Provider value={{ enabled, startCall, startMeeting, inCall: !!active }}>
      {children}

      {ring && (
        <div role="dialog" aria-label="تماس ورودی"
          className="fixed left-1/2 top-5 z-[90] w-[min(20rem,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl border border-emerald-500/30 bg-[#14101e] p-5 text-slate-100 shadow-2xl shadow-black/60">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 animate-pulse items-center justify-center rounded-full bg-emerald-500/20 text-lg font-bold text-emerald-300">
              {initials(ring.from.name)}
            </div>
            <div className="min-w-0">
              <div className="truncate font-semibold">{ring.from.name}</div>
              <div className="text-xs text-slate-400">
                {ring.video ? "تماس تصویری" : "تماس صوتی"}{ring.others > 1 ? ` · گروهی (${ring.others} نفر)` : ""}
              </div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button onClick={() => decline(ring)} className="btn bg-red-600 text-white hover:bg-red-500">رد</button>
            <button onClick={() => answer(ring)} className="btn bg-emerald-600 text-white hover:bg-emerald-500">پاسخ</button>
          </div>
          {incoming.length > 1 && <div className="mt-2 text-center text-xs text-slate-400">{incoming.length - 1} تماس دیگر در انتظار</div>}
        </div>
      )}

      {active && (
        <CallWindow active={active} minimized={minimized} onMinimize={setMinimized} onHangUp={hangUp} />
      )}

      <div className="pointer-events-none fixed bottom-5 right-5 z-[95] flex flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id}
            className={`rounded-lg border px-4 py-2 text-sm shadow-lg ${t.tone === "warn"
              ? "border-amber-500/30 bg-amber-950/90 text-amber-100" : "border-white/10 bg-[#14101e]/95 text-slate-100"}`}>
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

/** The Jitsi room inside Kara: large, or a small bar while you keep working. */
function CallWindow({ active, minimized, onMinimize, onHangUp }: {
  active: Active; minimized: boolean; onMinimize: (m: boolean) => void; onHangUp: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<JitsiApi | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (active.status !== "connected") return;
    setSeconds(0);
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [active.status]);

  useEffect(() => {
    let disposed = false;
    loadJitsi(active.join.url)
      .then((Jitsi) => {
        if (disposed || !host.current) return;
        api.current = new Jitsi(active.join.domain, {
          roomName: active.join.room,
          jwt: active.join.jwt,
          parentNode: host.current,
          width: "100%",
          height: "100%",
          lang: "fa",
          configOverwrite: {
            prejoinConfig: { enabled: false },
            startWithVideoMuted: !active.video,
            startWithAudioMuted: false,
            disableDeepLinking: true,
            subject: active.title,
          },
          interfaceConfigOverwrite: { MOBILE_APP_PROMO: false, SHOW_JITSI_WATERMARK: false },
        });
        api.current.addListener("readyToClose", onHangUp);
      })
      .catch((e: Error) => setError(e.message));
    return () => {
      disposed = true;
      api.current?.dispose();
      api.current = null;
    };
    // The room is fixed for the window's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.join.room]);

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const status = active.status === "calling" ? "در حال زنگ زدن…" : active.callId ? mmss : "جلسه";

  return (
    <div className={minimized
      ? "fixed bottom-5 left-5 z-[85] w-72"
      : "fixed inset-0 z-[85] flex items-stretch justify-center bg-black/60 p-0 sm:p-6"}>
      <div className={`flex flex-col overflow-hidden rounded-none border border-white/10 bg-[#0a0712] text-slate-100 shadow-2xl sm:rounded-2xl ${minimized ? "rounded-2xl" : "h-full w-full max-w-6xl"}`}>
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2.5">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{active.title}</div>
            <div className="text-xs text-slate-400">{status}</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button onClick={() => onMinimize(!minimized)} className="btn-ghost px-3 py-1.5 text-xs"
              title={minimized ? "بزرگ کردن" : "کوچک کردن و ادامه کار"}>{minimized ? "بزرگ" : "کوچک"}</button>
            <button onClick={onHangUp} className="btn bg-red-600 px-3 py-1.5 text-xs text-white hover:bg-red-500">
              {active.callId ? "قطع تماس" : "خروج از جلسه"}
            </button>
          </div>
        </div>
        {/* Kept mounted while minimized, so the call goes on. */}
        <div ref={host} className={minimized ? "h-0 overflow-hidden" : "min-h-0 flex-1"}>
          {error && <div className="p-6 text-sm text-red-300">ارتباط با سرور جلسه ممکن نشد: {error}</div>}
        </div>
      </div>
    </div>
  );
}
