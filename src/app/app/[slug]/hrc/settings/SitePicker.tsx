"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap, Marker, Circle, ImageOverlay } from "leaflet";
import {
  TILE_URL,
  TILE_ATTRIBUTION,
  DEFAULT_CENTER,
  boundsFromCenter,
  centerFromBounds,
} from "@/lib/map-config";

interface Props {
  title: string;
  imageUrl: string | null;
  north: number | null;
  south: number | null;
  east: number | null;
  west: number | null;
}

/** حداکثر عرض تصویر پس از فشرده‌سازی (پیکسل) — تا حجم فرم از حد مجاز رد نشود. */
const MAX_IMAGE_WIDTH = 1600;

/**
 * انتخاب موقعیت شرکت روی نقشهٔ واقعی.
 *
 * به‌جای تایپ‌کردن مختصات چهار گوشه، کاربر روی نقشه کلیک می‌کند (یا دکمهٔ
 * «موقعیت فعلی من» را می‌زند) و شعاع محوطه را با اسلایدر تعیین می‌کند؛ چهار
 * مرز از همین دو مقدار محاسبه و در فیلدهای مخفی همان فرم قبلی گذاشته می‌شود.
 */
export function SitePicker({ title, imageUrl, north, south, east, west }: Props) {
  const start = centerFromBounds({ north, south, east, west });
  const [lat, setLat] = useState(start?.lat ?? DEFAULT_CENTER[0]);
  const [lng, setLng] = useState(start?.lng ?? DEFAULT_CENTER[1]);
  const [radius, setRadius] = useState(start?.radius ?? 300);
  const [image, setImage] = useState<string>(imageUrl ?? "");
  const [imageOnMap, setImageOnMap] = useState(Boolean(imageUrl));
  const [geoState, setGeoState] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const circleRef = useRef<Circle | null>(null);
  const overlayRef = useRef<ImageOverlay | null>(null);
  // keep the newest position available to the (once-only) map handlers
  const posRef = useRef({ lat, lng });
  posRef.current = { lat, lng };

  const bounds = boundsFromCenter(lat, lng, radius);

  /* ------------------------------ build map ----------------------------- */
  useEffect(() => {
    let disposed = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (disposed || !boxRef.current || mapRef.current) return;

      const map = L.map(boxRef.current, { center: [lat, lng], zoom: 16 });
      L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);

      const icon = L.divIcon({
        className: "",
        html: `<div style="width:18px;height:18px;border-radius:50%;background:#4f46e5;
               border:3px solid #fff;box-shadow:0 0 0 1px #4f46e5"></div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });
      const marker = L.marker([lat, lng], { draggable: true, icon }).addTo(map);
      const circle = L.circle([lat, lng], {
        radius,
        color: "#4f46e5",
        weight: 2,
        fillOpacity: 0.08,
        // must not swallow the map clicks that set the centre
        interactive: false,
      }).addTo(map);

      map.on("click", (e) => {
        setLat(e.latlng.lat);
        setLng(e.latlng.lng);
      });
      marker.on("dragend", () => {
        const p = marker.getLatLng();
        setLat(p.lat);
        setLng(p.lng);
      });

      mapRef.current = map;
      markerRef.current = marker;
      circleRef.current = circle;
      setReady(true);
    })();

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // built once; later updates go through the effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* --------------------- keep marker / circle in step -------------------- */
  useEffect(() => {
    if (!ready) return;
    markerRef.current?.setLatLng([lat, lng]);
    circleRef.current?.setLatLng([lat, lng]);
    circleRef.current?.setRadius(radius);
    mapRef.current?.panTo([lat, lng], { animate: false });
  }, [lat, lng, radius, ready]);

  /* ------------------- optional site image on the map ------------------- */
  useEffect(() => {
    if (!ready) return;
    (async () => {
      const L = (await import("leaflet")).default;
      overlayRef.current?.remove();
      overlayRef.current = null;
      if (!image || !imageOnMap || !mapRef.current) return;
      overlayRef.current = L.imageOverlay(
        image,
        [
          [bounds.south, bounds.west],
          [bounds.north, bounds.east],
        ],
        { opacity: 0.75, interactive: false }
      ).addTo(mapRef.current);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, imageOnMap, lat, lng, radius, ready]);

  /* ---------------------------- my location ----------------------------- */
  function useMyLocation() {
    if (!navigator.geolocation) {
      setGeoState("مرورگر شما موقعیت‌یابی را پشتیبانی نمی‌کند.");
      return;
    }
    setGeoState("در حال گرفتن موقعیت…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude);
        setLng(pos.coords.longitude);
        mapRef.current?.setView([pos.coords.latitude, pos.coords.longitude], 17);
        setGeoState(`موقعیت گرفته شد (دقت ${Math.round(pos.coords.accuracy)} متر)`);
      },
      (err) => {
        setGeoState(
          err.code === err.PERMISSION_DENIED
            ? "اجازهٔ دسترسی به موقعیت داده نشد."
            : "گرفتن موقعیت ممکن نشد؛ روی نقشه کلیک کنید."
        );
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  /* ------------------------- image file → data URL ----------------------- */
  async function onPickImage(file: File) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error("read failed"));
      fr.readAsDataURL(file);
    });
    // Downscale so the form body stays small enough for the server action.
    const img = new Image();
    img.src = dataUrl;
    await new Promise((r) => (img.onload = r));
    const scale = Math.min(1, MAX_IMAGE_WIDTH / img.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    setImage(canvas.toDataURL("image/jpeg", 0.82));
    setImageOnMap(true);
  }

  return (
    <div className="space-y-3">
      {/* عنوان نقشه */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">عنوان نقشه</label>
          <input name="title" defaultValue={title} className="input" />
        </div>
        <div>
          <label className="label">شعاع محوطهٔ شرکت (متر)</label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={50}
              max={5000}
              step={10}
              value={radius}
              onChange={(e) => setRadius(Number(e.target.value))}
              className="flex-1"
            />
            <input
              type="number"
              min={20}
              value={radius}
              onChange={(e) => setRadius(Math.max(20, Number(e.target.value) || 20))}
              className="input w-24 text-left"
              dir="ltr"
            />
          </div>
        </div>
      </div>

      {/* ابزارها */}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={useMyLocation} className="btn-ghost">
          📍 موقعیت فعلی من
        </button>
        <span className="text-xs text-slate-500">
          یا روی نقشه کلیک کنید تا مرکز شرکت همان‌جا بنشیند.
        </span>
        {geoState && <span className="text-xs text-brand-600">{geoState}</span>}
      </div>

      {/* نقشه */}
      <div
        ref={boxRef}
        className="w-full overflow-hidden rounded-xl border border-slate-200 dark:border-white/10"
        style={{ height: 380 }}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
        <span dir="ltr">
          مرکز: {lat.toFixed(6)}, {lng.toFixed(6)}
        </span>
        <span dir="ltr">
          مرزها: N {bounds.north.toFixed(5)} · S {bounds.south.toFixed(5)} · E{" "}
          {bounds.east.toFixed(5)} · W {bounds.west.toFixed(5)}
        </span>
      </div>

      {/* تصویر نقشهٔ شرکت (اختیاری) */}
      <div className="rounded-lg border border-slate-200 p-3 dark:border-white/10">
        <div className="mb-2 text-xs font-medium text-slate-600">
          تصویر نقشهٔ شرکت (اختیاری) — پلان یا عکس هوایی محوطه
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onPickImage(f);
            }}
            className="text-xs"
          />
          {image && (
            <>
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={imageOnMap}
                  onChange={(e) => setImageOnMap(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                نمایش روی نقشه
              </label>
              <button
                type="button"
                onClick={() => setImage("")}
                className="text-xs text-red-600 hover:underline"
              >
                حذف تصویر
              </button>
            </>
          )}
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          تصویر دقیقاً روی همان محوطه‌ای که بالا مشخص کردید کشیده می‌شود؛ اگر
          کج افتاد، شعاع یا مرکز را کمی جابه‌جا کنید.
        </p>
      </div>

      {/* فیلدهایی که فرم به سرور می‌فرستد */}
      <input type="hidden" name="imageUrl" value={image} />
      <input type="hidden" name="north" value={bounds.north} />
      <input type="hidden" name="south" value={bounds.south} />
      <input type="hidden" name="east" value={bounds.east} />
      <input type="hidden" name="west" value={bounds.west} />
    </div>
  );
}
