/**
 * تنظیمات نقشه — سرویس کاشی‌های نقشه (tiles) از اینجا خوانده می‌شود.
 *
 * پیش‌فرض OpenStreetMap است. اگر در شبکهٔ شما در دسترس نیست، در فایل `.env`
 * متغیر زیر را به سرویس دلخواه (یا سرور کاشی داخلی خودتان) تغییر دهید:
 *
 *   NEXT_PUBLIC_MAP_TILE_URL="https://{s}.tile.example.ir/{z}/{x}/{y}.png"
 *
 * اگر هیچ سرویسی در دسترس نباشد، نقشه خاکستری می‌ماند ولی کلیک‌کردن و گرفتن
 * مختصات همچنان کار می‌کند — و می‌توانید تصویر نقشهٔ خودتان را روی آن بیندازید.
 */
export const TILE_URL =
  process.env.NEXT_PUBLIC_MAP_TILE_URL ||
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

export const TILE_ATTRIBUTION =
  process.env.NEXT_PUBLIC_MAP_ATTRIBUTION || "© OpenStreetMap";

/** مرکز پیش‌فرض وقتی هنوز چیزی تنظیم نشده (تهران). */
export const DEFAULT_CENTER: [number, number] = [35.6892, 51.389];
export const DEFAULT_ZOOM = 12;

/** متر بر درجه — برای تبدیل شعاع به مرزهای جغرافیایی. */
const METERS_PER_DEG_LAT = 111_320;

/** از مرکز و شعاع (متر)، چهار مرز نقشه را می‌سازد. */
export function boundsFromCenter(
  lat: number,
  lng: number,
  radiusMeters: number
): { north: number; south: number; east: number; west: number } {
  const dLat = radiusMeters / METERS_PER_DEG_LAT;
  const dLng =
    radiusMeters / (METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180) || 1);
  return {
    north: lat + dLat,
    south: lat - dLat,
    east: lng + dLng,
    west: lng - dLng,
  };
}

/** عکس عمل بالا: از مرزها، مرکز و شعاع تقریبی را برمی‌گرداند. */
export function centerFromBounds(b: {
  north: number | null;
  south: number | null;
  east: number | null;
  west: number | null;
}): { lat: number; lng: number; radius: number } | null {
  if (b.north == null || b.south == null || b.east == null || b.west == null) {
    return null;
  }
  const lat = (b.north + b.south) / 2;
  const lng = (b.east + b.west) / 2;
  const radius = ((b.north - b.south) / 2) * METERS_PER_DEG_LAT;
  return { lat, lng, radius: Math.max(20, Math.round(radius)) };
}

/** رنگ وضعیت سلامت روی نقشهٔ زنده. */
export const LEVEL_COLOR: Record<string, string> = {
  ok: "#22c55e",
  warn: "#f59e0b",
  critical: "#ef4444",
  offline: "#94a3b8",
};
