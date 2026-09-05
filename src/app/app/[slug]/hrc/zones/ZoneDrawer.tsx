"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap, Polygon, LayerGroup } from "leaflet";
import {
  TILE_URL,
  TILE_ATTRIBUTION,
  DEFAULT_CENTER,
  centerFromBounds,
} from "@/lib/map-config";

export interface ExistingZone {
  id: string;
  name: string;
  color: string;
  coord_mode: string;
  polygon: [number, number][];
}

/**
 * رسم ناحیه روی نقشه با کلیک.
 *
 * هر کلیک یک گوشه به چندضلعی اضافه می‌کند؛ خروجی به‌صورت JSON در فیلد مخفی
 * `polygon` قرار می‌گیرد — همان چیزی که اکشن سرور از قبل انتظار دارد.
 */
export function ZoneDrawer({
  bounds,
  existing,
  color,
}: {
  bounds: { north: number | null; south: number | null; east: number | null; west: number | null };
  existing: ExistingZone[];
  color: string;
}) {
  const [points, setPoints] = useState<[number, number][]>([]);
  const [ready, setReady] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const drawRef = useRef<Polygon | null>(null);
  const dotsRef = useRef<LayerGroup | null>(null);

  const site = centerFromBounds(bounds);

  useEffect(() => {
    let disposed = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (disposed || !boxRef.current || mapRef.current) return;

      const center: [number, number] = site ? [site.lat, site.lng] : DEFAULT_CENTER;
      const map = L.map(boxRef.current, { center, zoom: site ? 17 : 12 });
      L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);

      // ناحیه‌های موجود، فقط برای اینکه بدانید کجا قبلاً تعریف شده
      for (const z of existing) {
        if (z.coord_mode !== "geo" || !Array.isArray(z.polygon) || z.polygon.length < 3) {
          continue;
        }
        // non-interactive: every click has to reach the map so it adds a point
        L.polygon(z.polygon, {
          color: z.color,
          weight: 2,
          fillOpacity: 0.12,
          dashArray: "4 4",
          interactive: false,
        }).addTo(map);
      }

      dotsRef.current = L.layerGroup().addTo(map);
      map.on("click", (e) => {
        setPoints((prev) => [...prev, [e.latlng.lat, e.latlng.lng]]);
      });

      mapRef.current = map;
      setReady(true);
    })();

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* رسم دوبارهٔ چندضلعیِ در حال ساخت */
  useEffect(() => {
    if (!ready) return;
    (async () => {
      const L = (await import("leaflet")).default;
      const map = mapRef.current;
      if (!map) return;

      drawRef.current?.remove();
      drawRef.current = null;
      dotsRef.current?.clearLayers();

      for (const [plat, plng] of points) {
        L.circleMarker([plat, plng], {
          radius: 5,
          color: "#fff",
          weight: 2,
          fillColor: color,
          fillOpacity: 1,
          interactive: false,
        }).addTo(dotsRef.current!);
      }
      if (points.length >= 2) {
        drawRef.current = L.polygon(points, {
          color,
          weight: 2,
          fillOpacity: 0.2,
          interactive: false,
        }).addTo(map);
      }
    })();
  }, [points, color, ready]);

  const enough = points.length >= 3;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-500">
          روی نقشه کلیک کنید تا گوشه‌های ناحیه ساخته شود (حداقل ۳ نقطه).
        </span>
        <span
          className={`badge ${
            enough ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
          }`}
        >
          {points.length} نقطه
        </span>
        <button
          type="button"
          onClick={() => setPoints((p) => p.slice(0, -1))}
          disabled={points.length === 0}
          className="btn-ghost !py-1 text-xs disabled:opacity-50"
        >
          ↶ حذف آخرین نقطه
        </button>
        <button
          type="button"
          onClick={() => setPoints([])}
          disabled={points.length === 0}
          className="btn-ghost !py-1 text-xs disabled:opacity-50"
        >
          ✕ پاک‌کردن
        </button>
      </div>

      <div
        ref={boxRef}
        className="w-full overflow-hidden rounded-xl border border-slate-200 dark:border-white/10"
        style={{ height: 340 }}
      />

      {!site && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          هنوز موقعیت شرکت را در «تنظیمات HRC» مشخص نکرده‌اید؛ نقشه روی مرکز
          پیش‌فرض باز شده است.
        </div>
      )}

      <input type="hidden" name="coordMode" value="geo" />
      <input type="hidden" name="polygon" value={JSON.stringify(points)} />
    </div>
  );
}
