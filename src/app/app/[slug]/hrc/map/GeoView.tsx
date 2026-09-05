"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import { TILE_URL, TILE_ATTRIBUTION, LEVEL_COLOR } from "@/lib/map-config";

export interface GeoPoint {
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
}

export interface GeoZone {
  id: string;
  name: string;
  color: string;
  coordMode: string;
  latlngs: [number, number][];
}

export interface GeoMap {
  title: string;
  image_url: string | null;
  north: number | null;
  south: number | null;
  east: number | null;
  west: number | null;
}

/**
 * نقشهٔ زندهٔ شرکت روی نقشهٔ واقعی: ناحیه‌ها به‌صورت چندضلعی و نفرات به‌صورت
 * نقطه‌های رنگی (رنگ = وضعیت سلامت). با هر تازه‌سازی فقط نشانگرها جابه‌جا
 * می‌شوند، نه کل نقشه.
 */
export function GeoView({
  map,
  zones,
  points,
}: {
  map: GeoMap;
  zones: GeoZone[];
  points: GeoPoint[];
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const zoneLayer = useRef<LayerGroup | null>(null);
  const peopleLayer = useRef<LayerGroup | null>(null);
  const fitted = useRef(false);

  /* ---- create the map once ---- */
  useEffect(() => {
    let disposed = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (disposed || !boxRef.current || mapRef.current) return;

      const lat = ((map.north ?? 0) + (map.south ?? 0)) / 2;
      const lng = ((map.east ?? 0) + (map.west ?? 0)) / 2;
      const m = L.map(boxRef.current, { center: [lat, lng], zoom: 17 });
      L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(m);

      if (map.image_url && map.north != null && map.south != null &&
          map.east != null && map.west != null) {
        L.imageOverlay(map.image_url, [
          [map.south, map.west],
          [map.north, map.east],
        ], { opacity: 0.75 }).addTo(m);
      }

      zoneLayer.current = L.layerGroup().addTo(m);
      peopleLayer.current = L.layerGroup().addTo(m);
      mapRef.current = m;

      if (map.north != null && map.south != null && map.east != null && map.west != null) {
        m.fitBounds([[map.south, map.west], [map.north, map.east]]);
      }
    })();
    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- zones ---- */
  useEffect(() => {
    (async () => {
      const L = (await import("leaflet")).default;
      const layer = zoneLayer.current;
      if (!layer) return;
      layer.clearLayers();
      for (const z of zones) {
        if (!Array.isArray(z.latlngs) || z.latlngs.length < 3) continue;
        L.polygon(z.latlngs, {
          color: z.color,
          weight: 2,
          fillOpacity: 0.12,
        })
          .bindTooltip(z.name, { sticky: true })
          .addTo(layer);
      }
    })();
  }, [zones]);

  /* ---- people ---- */
  useEffect(() => {
    (async () => {
      const L = (await import("leaflet")).default;
      const layer = peopleLayer.current;
      if (!layer) return;
      layer.clearLayers();

      const placed: [number, number][] = [];
      for (const p of points) {
        if (p.lat == null || p.lng == null) continue;
        placed.push([p.lat, p.lng]);
        const color = LEVEL_COLOR[p.level] ?? LEVEL_COLOR.offline;
        L.circleMarker([p.lat, p.lng], {
          radius: 8,
          color: "#fff",
          weight: 2,
          fillColor: color,
          fillOpacity: 1,
        })
          .bindPopup(
            `<div style="font-family:inherit;line-height:1.7">
               <b>${escapeHtml(p.name)}</b> — ${escapeHtml(p.label)}<br/>
               ${escapeHtml(p.title ?? "")}<br/>
               ضربان ${p.heartRate ?? "—"} · اکسیژن ${p.spo2 ?? "—"}٪ ·
               دما ${p.bodyTemp ?? "—"}°C · باتری ${p.battery ?? "—"}٪<br/>
               ناحیه: ${escapeHtml(p.zone ?? "خارج از ناحیه")}
               ${p.openAlerts > 0 ? `<br/><b style="color:#dc2626">${p.openAlerts} هشدار باز</b>` : ""}
             </div>`
          )
          .addTo(layer);
      }

      // first time we actually have people, frame them
      if (!fitted.current && placed.length > 0 && mapRef.current) {
        fitted.current = true;
        mapRef.current.fitBounds(placed, { padding: [40, 40], maxZoom: 18 });
      }
    })();
  }, [points]);

  const noPosition = points.filter((p) => p.lat == null || p.lng == null);

  return (
    <div className="space-y-2">
      <div
        ref={boxRef}
        className="w-full overflow-hidden rounded-xl border border-slate-200 dark:border-white/10"
        style={{ height: 460 }}
      />
      {noPosition.length > 0 && (
        <div className="text-[11px] text-slate-400">
          بدون موقعیت روی نقشه: {noPosition.map((p) => p.name).join("، ")}
        </div>
      )}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
