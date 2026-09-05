"use client";

import { useEffect, useState } from "react";

interface Point {
  memberId: string;
  name: string;
  title: string | null;
  level: "ok" | "warn" | "critical" | "offline";
  label: string;
  heartRate: number | null;
  spo2: number | null;
  bodyTemp: string | null;
  battery: number | null;
  zone: string | null;
  minutes: number | null;
  lat: number | null;
  lng: number | null;
  openAlerts: number;
  x: number | null;
  y: number | null;
}

interface Zone {
  id: string;
  name: string;
  kind: string;
  color: string;
  coordMode: string;
  points: ({ x: number; y: number } | null)[];
}

interface Feed {
  map: {
    title: string;
    image_url: string | null;
    north: number | null;
    south: number | null;
    east: number | null;
    west: number | null;
  };
  zones: Zone[];
  points: Point[];
}

const POLL_MS = 15_000;

const LEVEL_COLOR: Record<string, string> = {
  ok: "#22c55e",
  warn: "#f59e0b",
  critical: "#ef4444",
  offline: "#94a3b8",
};

/**
 * نقشهٔ زندهٔ شرکت: ناحیه‌ها به‌صورت چندضلعی و نفرات به‌صورت نقطه‌های رنگی روی
 * تصویر نقشه. هر ۱۵ ثانیه داده تازه می‌شود.
 */
export function LiveMap({ slug }: { slug: string }) {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [selected, setSelected] = useState<Point | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let stop = false;
    async function poll() {
      try {
        const res = await fetch(`/app/${slug}/hrc/feed`, { cache: "no-store" });
        if (!res.ok) {
          setError(true);
          return;
        }
        const data = (await res.json()) as Feed;
        if (!stop) {
          setFeed(data);
          setError(false);
        }
      } catch {
        setError(true);
      }
    }
    poll();
    const t = setInterval(poll, POLL_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [slug]);

  if (error && !feed) {
    return (
      <div className="card text-sm text-red-600">دریافت داده‌های نقشه ممکن نشد.</div>
    );
  }
  if (!feed) {
    return <div className="card text-sm text-slate-400">در حال دریافت موقعیت‌ها…</div>;
  }

  const positioned = feed.points.filter((p) => p.x !== null && p.y !== null);
  const unpositioned = feed.points.filter((p) => p.x === null || p.y === null);

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-700">{feed.map.title}</h3>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
            {Object.entries({
              ok: "سالم",
              warn: "نیازمند توجه",
              critical: "بحرانی",
              offline: "بدون ارتباط",
            }).map(([k, label]) => (
              <span key={k} className="flex items-center gap-1">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: LEVEL_COLOR[k] }}
                />
                {label}
              </span>
            ))}
            <span>به‌روزرسانی هر ۱۵ ثانیه</span>
          </div>
        </div>

        <div
          className="relative w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50"
          style={{ aspectRatio: "16 / 9" }}
        >
          {feed.map.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={feed.map.image_url}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-400">
              تصویر نقشه تنظیم نشده است — از «تنظیمات HRC» نقشهٔ شرکت را بارگذاری کنید.
            </div>
          )}

          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
          >
            {feed.zones.map((z) => {
              const pts = z.points.filter(Boolean) as { x: number; y: number }[];
              if (pts.length < 3) return null;
              return (
                <polygon
                  key={z.id}
                  points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill={z.color}
                  fillOpacity={0.15}
                  stroke={z.color}
                  strokeWidth={0.3}
                />
              );
            })}
          </svg>

          {positioned.map((p) => (
            <button
              key={p.memberId}
              type="button"
              onClick={() => setSelected(p)}
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white transition hover:scale-125"
              style={{
                left: `${p.x}%`,
                top: `${p.y}%`,
                width: 14,
                height: 14,
                backgroundColor: LEVEL_COLOR[p.level],
              }}
              title={`${p.name} — ${p.label}`}
            >
              <span className="sr-only">{p.name}</span>
            </button>
          ))}
        </div>

        {unpositioned.length > 0 && (
          <div className="mt-2 text-[11px] text-slate-400">
            بدون موقعیت روی نقشه: {unpositioned.map((p) => p.name).join("، ")}
          </div>
        )}
      </div>

      {selected && (
        <div className="card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-800">{selected.name}</span>
                <span
                  className="badge"
                  style={{
                    backgroundColor: `${LEVEL_COLOR[selected.level]}22`,
                    color: LEVEL_COLOR[selected.level],
                  }}
                >
                  {selected.label}
                </span>
                {selected.openAlerts > 0 && (
                  <span className="badge bg-red-100 text-red-700">
                    {selected.openAlerts} هشدار باز
                  </span>
                )}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {selected.title ?? "—"} · ناحیه: {selected.zone ?? "خارج از ناحیه"} ·
                ضربان {selected.heartRate ?? "—"} · اکسیژن {selected.spo2 ?? "—"}٪ ·
                دما {selected.bodyTemp ?? "—"}°C · باتری {selected.battery ?? "—"}٪
              </div>
              {selected.lat !== null && selected.lng !== null && (
                <div className="mt-1 text-[11px] text-slate-400" dir="ltr">
                  {selected.lat.toFixed(6)}, {selected.lng.toFixed(6)}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-xs text-slate-400 hover:text-slate-600"
            >
              بستن
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
