/**
 * HRC — Health, Response & Coordination.
 *
 * کارکنان ساعت هوشمند دریافت می‌کنند؛ ساعت هر چند دقیقه علائم حیاتی (ضربان،
 * اکسیژن خون، دما، حرکت) و موقعیت را می‌فرستد. موقعیت می‌تواند از GPS، شبکهٔ
 * مخابراتی (LBS)، Wi-Fi، بیکن یا LoRa بیاید. سرور مقادیر را با آستانه‌های شرکت
 * می‌سنجد، هشدار می‌سازد و روی نقشهٔ شرکت نشان می‌دهد تا تیم HRC اعزام شود.
 */

export const ALERT_KINDS = {
  sos: "درخواست کمک (SOS)",
  fall: "سقوط / زمین‌خوردن",
  no_motion: "بی‌حرکتی طولانی",
  heart_high: "ضربان قلب بالا",
  heart_low: "ضربان قلب پایین",
  spo2_low: "افت اکسیژن خون",
  temp_high: "تب / دمای بالا",
  temp_low: "افت دمای بدن",
  geofence: "خروج/ورود غیرمجاز به ناحیه",
  offline: "قطع ارتباط دستگاه",
  battery: "باتری ضعیف",
  manual: "ثبت دستی",
} as const;

export type AlertKind = keyof typeof ALERT_KINDS;

export const ALERT_STATUS = {
  open: "باز",
  ack: "در دست بررسی",
  dispatched: "تیم اعزام شد",
  resolved: "رفع شد",
  false_alarm: "هشدار کاذب",
} as const;

export const SEVERITY = {
  info: "اطلاع",
  warn: "هشدار",
  critical: "بحرانی",
} as const;

export const SEVERITY_TONE: Record<string, string> = {
  info: "bg-blue-100 text-blue-700",
  warn: "bg-amber-100 text-amber-700",
  critical: "bg-red-100 text-red-700",
};

export const DEVICE_KINDS = {
  watch: "ساعت هوشمند",
  band: "مچ‌بند",
  tag: "تگ موقعیت",
  phone: "گوشی همراه",
  beacon: "بیکن ثابت",
} as const;

export const POSITION_SOURCES = {
  gps: "GPS ماهواره‌ای",
  lbs: "شبکهٔ مخابراتی (LBS)",
  wifi: "Wi-Fi",
  beacon: "بیکن داخلی",
  lora: "LoRa",
  manual: "ثبت دستی",
} as const;

export const TEAM_KINDS = {
  medical: "امداد پزشکی",
  rescue: "نجات",
  fire: "آتش‌نشانی",
  safety: "HSE / ایمنی",
  security: "حراست",
} as const;

export const DISPATCH_STATUS = {
  dispatched: "اعزام شد",
  enroute: "در مسیر",
  onsite: "در محل",
  done: "پایان‌یافته",
  cancelled: "لغو شد",
} as const;

export const ZONE_KINDS = {
  area: "ناحیهٔ عمومی",
  safe: "ناحیهٔ امن",
  restricted: "ناحیهٔ ممنوعه",
  hazard: "ناحیهٔ پرخطر",
  gate: "دروازه/ورودی",
  muster: "نقطهٔ تجمع اضطراری",
} as const;

export interface Thresholds {
  hr_min: number;
  hr_max: number;
  spo2_min: number;
  temp_min: number;
  temp_max: number;
  no_motion_minutes: number;
  offline_minutes: number;
  battery_low: number;
  fall_alert: boolean;
  geofence_alert: boolean;
  auto_dispatch: boolean;
  auto_dispatch_team: string | null;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  hr_min: 45,
  hr_max: 140,
  spo2_min: 92,
  temp_min: 35,
  temp_max: 38.5,
  no_motion_minutes: 20,
  offline_minutes: 15,
  battery_low: 15,
  fall_alert: true,
  geofence_alert: true,
  auto_dispatch: false,
  auto_dispatch_team: null,
};

export interface Reading {
  heart_rate?: number | null;
  spo2?: number | null;
  body_temp?: number | null;
  battery?: number | null;
  motion?: string | null;
  sos?: boolean;
}

export interface DetectedAlert {
  kind: AlertKind;
  severity: "info" | "warn" | "critical";
  message: string;
}

/**
 * Compare one reading against the company thresholds and return every rule it
 * breaks. Pure function — the ingest route and the UI both use it.
 */
export function evaluateReading(
  r: Reading,
  t: Thresholds
): DetectedAlert[] {
  const out: DetectedAlert[] = [];
  const hr = num(r.heart_rate);
  const spo2 = num(r.spo2);
  const temp = num(r.body_temp);
  const battery = num(r.battery);

  if (r.sos) {
    out.push({
      kind: "sos",
      severity: "critical",
      message: "دکمهٔ SOS توسط کارمند فشرده شد.",
    });
  }
  if (t.fall_alert && r.motion === "fall") {
    out.push({
      kind: "fall",
      severity: "critical",
      message: "سنسور ساعت سقوط را تشخیص داد.",
    });
  }
  if (hr !== null && hr > t.hr_max) {
    out.push({
      kind: "heart_high",
      severity: hr > t.hr_max + 25 ? "critical" : "warn",
      message: `ضربان قلب ${hr} بالاتر از حد مجاز (${t.hr_max}) است.`,
    });
  }
  if (hr !== null && hr > 0 && hr < t.hr_min) {
    out.push({
      kind: "heart_low",
      severity: hr < t.hr_min - 10 ? "critical" : "warn",
      message: `ضربان قلب ${hr} پایین‌تر از حد مجاز (${t.hr_min}) است.`,
    });
  }
  if (spo2 !== null && spo2 > 0 && spo2 < t.spo2_min) {
    out.push({
      kind: "spo2_low",
      severity: spo2 < t.spo2_min - 4 ? "critical" : "warn",
      message: `اکسیژن خون ${spo2}٪ زیر حد مجاز (${t.spo2_min}٪) است.`,
    });
  }
  if (temp !== null && temp > t.temp_max) {
    out.push({
      kind: "temp_high",
      severity: temp > t.temp_max + 1 ? "critical" : "warn",
      message: `دمای بدن ${temp} بالاتر از حد مجاز (${t.temp_max}) است.`,
    });
  }
  if (temp !== null && temp > 0 && temp < t.temp_min) {
    out.push({
      kind: "temp_low",
      severity: "warn",
      message: `دمای بدن ${temp} پایین‌تر از حد مجاز (${t.temp_min}) است.`,
    });
  }
  if (battery !== null && battery <= t.battery_low) {
    out.push({
      kind: "battery",
      severity: "info",
      message: `باتری دستگاه ${battery}٪ است.`,
    });
  }
  return out;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Overall health badge for a person's latest reading. */
export function healthStatus(
  r: Reading | null,
  t: Thresholds,
  lastSeenMinutes: number | null
): { label: string; tone: string; level: "ok" | "warn" | "critical" | "offline" } {
  if (!r || lastSeenMinutes === null || lastSeenMinutes > t.offline_minutes) {
    return { label: "بدون ارتباط", tone: "bg-slate-100 text-slate-500", level: "offline" };
  }
  const alerts = evaluateReading(r, t);
  if (alerts.some((a) => a.severity === "critical")) {
    return { label: "بحرانی", tone: "bg-red-100 text-red-700", level: "critical" };
  }
  if (alerts.length > 0) {
    return { label: "نیازمند توجه", tone: "bg-amber-100 text-amber-700", level: "warn" };
  }
  return { label: "سالم", tone: "bg-green-100 text-green-700", level: "ok" };
}

/* ------------------------------ geometry -------------------------------- */

export interface MapBounds {
  north: number | null;
  south: number | null;
  east: number | null;
  west: number | null;
}

/**
 * Project a lat/lng onto the company map image, returning percentages from the
 * top-left corner. Returns null when the map is not georeferenced or the point
 * falls outside it.
 */
export function projectToMap(
  lat: number | null | undefined,
  lng: number | null | undefined,
  b: MapBounds
): { x: number; y: number } | null {
  if (lat == null || lng == null) return null;
  const { north, south, east, west } = b;
  if (north == null || south == null || east == null || west == null) return null;
  if (north === south || east === west) return null;
  const x = ((lng - west) / (east - west)) * 100;
  const y = ((north - lat) / (north - south)) * 100;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: clamp(x), y: clamp(y) };
}

function clamp(v: number): number {
  return Math.max(0, Math.min(100, v));
}

/** Ray-casting point-in-polygon. Polygon points are [x, y] or [lat, lng]. */
export function pointInPolygon(
  point: [number, number],
  polygon: [number, number][]
): boolean {
  if (polygon.length < 3) return false;
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi || 1e-12) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Great-circle distance in metres — used to pick the nearest response team. */
export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** "۳ دقیقه پیش" style relative time for the live monitor. */
export function agoLabel(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 1) return "همین حالا";
  if (minutes < 60) return `${Math.round(minutes)} دقیقه پیش`;
  const h = Math.floor(minutes / 60);
  if (h < 24) return `${h} ساعت پیش`;
  return `${Math.floor(h / 24)} روز پیش`;
}
