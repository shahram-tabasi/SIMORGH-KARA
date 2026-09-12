"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

const MapContainer = dynamic(() => import("react-leaflet").then((mod) => mod.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import("react-leaflet").then((mod) => mod.TileLayer), { ssr: false });
const Marker = dynamic(() => import("react-leaflet").then((mod) => mod.Marker), { ssr: false });
const Popup = dynamic(() => import("react-leaflet").then((mod) => mod.Popup), { ssr: false });
const CircleMarker = dynamic(() => import("react-leaflet").then((mod) => mod.CircleMarker), { ssr: false });

import "leaflet/dist/leaflet.css";
import L from "leaflet";

interface CompanyLocation {
  id: string;
  name: string;
  address?: string | null;
  lat: number;
  lng: number;
  radius_meters: number;
  location_type: "office" | "factory" | "mine" | "warehouse" | "other";
  is_active: boolean;
}

interface HRCIncident {
  id: string;
  title: string;
  incident_type: string;
  severity: string;
  occurred_at: string;
  lat: number | null;
  lng: number | null;
  status: string;
}

interface HealthAlert {
  id: string;
  member_name: string;
  heart_rate: number | null;
  spo2: number | null;
  body_temp: number | null;
  alert_reason: string | null;
  recorded_at: string;
  location_lat: number | null;
  location_lng: number | null;
}

export default function HRCMap({ slug }: { slug: string }) {
  const [locations, setLocations] = useState<CompanyLocation[]>([]);
  const [incidents, setIncidents] = useState<HRCIncident[]>([]);
  const [healthAlerts, setHealthAlerts] = useState<HealthAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const [locRes, incRes, alertsRes] = await Promise.all([
          fetch(`/api/${slug}/hrc/locations`),
          fetch(`/api/${slug}/hrc/incidents`),
          fetch(`/api/${slug}/hrc/health-metrics?alerts_only=true&limit=20`),
        ]);

        if (!locRes.ok) throw new Error("دریافت موقعیت‌های شرکت ممکن نشد.");
        if (!incRes.ok) throw new Error("دریافت حوادث ممکن نشد.");

        const locData = await locRes.json();
        const incData = await incRes.json();
        const alertsData = alertsRes.ok ? await alertsRes.json() : [];

        setLocations(locData);
        setIncidents(incData);
        setHealthAlerts(alertsData);
      } catch (err) {
        setError(err instanceof Error ? err.message : "خطای ناشناخته");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [slug]);

  if (loading) return <div className="p-4 text-center text-slate-500">در حال بارگذاری نقشه...</div>;

  if (error) {
    return (
      <div className="p-4 text-center text-red-600 bg-red-50 rounded-lg">
        <p>{error}</p>
        <p className="text-sm mt-2 text-slate-600">لطفاً ابتدا موقعیت شرکت را در تنظیمات ثبت کنید.</p>
      </div>
    );
  }

  const defaultCenter: [number, number] = locations.length > 0 ? [locations[0].lat, locations[0].lng] : [35.6892, 51.3890];
  const alertMarkers = healthAlerts.filter(a => a.location_lat && a.location_lng);

  return (
    <div className="h-[600px] w-full rounded-xl overflow-hidden shadow-lg border border-slate-200 relative">
      <MapContainer center={defaultCenter} zoom={10} style={{ height: "100%", width: "100%" }} scrollWheelZoom={true} className="z-0">
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

        {locations.map((loc) => (
          <CircleMarker key={loc.id} center={[loc.lat, loc.lng]} radius={loc.radius_meters / 20} pathOptions={{
            color: loc.location_type === "mine" ? "#f59e0b" : loc.location_type === "factory" ? "#ef4444" : "#3b82f6",
            fillColor: loc.location_type === "mine" ? "#f59e0b" : loc.location_type === "factory" ? "#ef4444" : "#3b82f6",
            fillOpacity: 0.4,
          }}>
            <Popup>
              <div className="min-w-[200px]">
                <h3 className="font-bold text-slate-800">{loc.name}</h3>
                <p className="text-sm text-slate-600">{loc.address}</p>
                <p className="text-xs text-slate-500 mt-1">نوع: {loc.location_type === "office" ? "دفتر" : loc.location_type === "factory" ? "کارخانه" : loc.location_type === "mine" ? "معدن" : loc.location_type === "warehouse" ? "انبار" : "سایر"}</p>
                <p className={`text-xs mt-1 ${loc.is_active ? "text-green-600" : "text-red-600"}`}>{loc.is_active ? "فعال" : "غیرفعال"}</p>
              </div>
            </Popup>
          </CircleMarker>
        ))}

        {incidents.filter(i => i.lat && i.lng).map((incident) => (
          <Marker key={incident.id} position={[incident.lat!, incident.lng!]} icon={L.divIcon({
            className: "custom-marker",
            html: `<div style="background-color: ${incident.severity === "critical" ? "#dc2626" : incident.severity === "high" ? "#ea580c" : incident.severity === "medium" ? "#f59e0b" : "#22c55e"}; width: 16px; height: 16px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`,
            iconSize: [16, 16],
            iconAnchor: [8, 8],
          })}>
            <Popup>
              <div className="min-w-[220px]">
                <h3 className="font-bold text-slate-800">{incident.title}</h3>
                <p className="text-xs text-slate-600 mt-1">نوع: {incident.incident_type === "near_miss" ? "شبه‌حادثه" : incident.incident_type === "injury" ? "مصدمیت" : incident.incident_type === "equipment_damage" ? "خسارت تجهیز" : incident.incident_type === "fire" ? "حریق" : incident.incident_type === "chemical_spill" ? "نشت مواد شیمیایی" : "سایر"}</p>
                <p className="text-xs text-slate-500 mt-1">شدت: {incident.severity === "critical" ? "بحرانی" : incident.severity === "high" ? "زیاد" : incident.severity === "medium" ? "متوسط" : "کم"}</p>
                <p className="text-xs text-slate-500 mt-1">تاریخ: {new Date(incident.occurred_at).toLocaleDateString("fa-IR")}</p>
                <p className={`text-xs mt-1 font-medium ${incident.status === "resolved" ? "text-green-600" : incident.status === "under_review" ? "text-amber-600" : "text-blue-600"}`}>وضعیت: {incident.status === "reported" ? "گزارش‌شده" : incident.status === "under_review" ? "در دست بررسی" : incident.status === "resolved" ? "حل‌شده" : "بسته‌شده"}</p>
              </div>
            </Popup>
          </Marker>
        ))}

        {alertMarkers.map((alert) => (
          <Marker key={alert.id} position={[alert.location_lat!, alert.location_lng!]} icon={L.divIcon({
            className: "health-alert-marker",
            html: `<div style="background-color: #dc2626; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 8px rgba(220,38,38,0.5); animation: pulse 2s infinite;"></div><style>@keyframes pulse { 0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(220,38,38,0.7); } 70% { transform: scale(1.2); box-shadow: 0 0 0 10px rgba(220,38,38,0); } 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(220,38,38,0); } }</style>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10],
          })}>
            <Popup>
              <div className="min-w-[240px]">
                <h3 className="font-bold text-red-700">🚨 هشدار سلامت</h3>
                <p className="text-sm text-slate-800 mt-1 font-semibold">{alert.member_name}</p>
                {alert.alert_reason && <p className="text-xs text-red-600 mt-1">{alert.alert_reason}</p>}
                <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
                  {alert.heart_rate && <div className="bg-red-50 p-1 rounded text-center"><div className="text-slate-500">ضربان</div><div className="font-bold text-red-700">{alert.heart_rate}</div></div>}
                  {alert.spo2 && <div className="bg-blue-50 p-1 rounded text-center"><div className="text-slate-500">اکسیژن</div><div className="font-bold text-blue-700">{alert.spo2}%</div></div>}
                  {alert.body_temp && <div className="bg-amber-50 p-1 rounded text-center"><div className="text-slate-500">دما</div><div className="font-bold text-amber-700">{alert.body_temp}°C</div></div>}
                </div>
                <p className="text-xs text-slate-500 mt-2">زمان: {new Date(alert.recorded_at).toLocaleString("fa-IR")}</p>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
      
      <div className="absolute bottom-4 right-4 bg-white/95 backdrop-blur rounded-lg shadow-lg p-3 text-xs space-y-1 z-[1000]">
        <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-blue-500"></div><span className="text-slate-700">دفتر</span></div>
        <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-red-500"></div><span className="text-slate-700">کارخانه</span></div>
        <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-amber-500"></div><span className="text-slate-700">معدن</span></div>
        <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-red-600 animate-pulse"></div><span className="text-slate-700">هشدار سلامت</span></div>
      </div>
    </div>
  );
}
