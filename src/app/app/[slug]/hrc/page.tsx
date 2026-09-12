import { requireTenant } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { ReminderWatcher } from "@/components/ReminderWatcher";
import HRCMap from "./HRCMap";

export default async function HRCPage({ params }: { params: { slug: string } }) {
  const ctx = await requireTenant(params.slug);
  const base = `/app/${params.slug}`;
  
  // Fetch some stats
  const stats = await withTenant(ctx.company.schema_name, async (tx) => {
    const incidentsCount = await tx`SELECT COUNT(*) FROM hrc_incidents WHERE occurred_at >= NOW() - INTERVAL '30 days'`;
    const alertsCount = await tx`SELECT COUNT(*) FROM hrc_health_metrics WHERE is_alert = true AND recorded_at >= NOW() - INTERVAL '7 days'`;
    const smartwatchesCount = await tx`SELECT COUNT(*) FROM hrc_smartwatches WHERE is_active = true`;
    return {
      incidents: parseInt(incidentsCount[0]?.count || "0"),
      alerts: parseInt(alertsCount[0]?.count || "0"),
      smartwatches: parseInt(smartwatchesCount[0]?.count || "0"),
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">HRC — سلامت و ایمنی</h1>
          <p className="text-slate-600 mt-1">مدیریت حوادث، بازرسی‌ها، تجهیزات ایمنی و پایش سلامت کارکنان</p>
        </div>
      </div>

      {/* نقشه شرکت */}
      <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">🗺️ نقشه موقعیت‌ها و حوادث</h2>
        <HRCMap slug={params.slug} />
        <p className="text-xs text-slate-500 mt-3">💡 برای ثبت موقعیت جدید شرکت، به بخش تنظیمات مراجعه کنید.</p>
      </section>

      {/* آمار سریع */}
      <section className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <div className="text-3xl font-bold text-red-600">{stats.incidents}</div>
          <div className="text-sm text-slate-600 mt-1">حوادث ماه جاری</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <div className="text-3xl font-bold text-amber-600">{stats.alerts}</div>
          <div className="text-sm text-slate-600 mt-1">هشدارهای سلامت فعال</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <div className="text-3xl font-bold text-blue-600">{stats.smartwatches}</div>
          <div className="text-sm text-slate-600 mt-1">ساعت‌های هوشمند متصل</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <div className="text-3xl font-bold text-green-600">۰</div>
          <div className="text-sm text-slate-600 mt-1">بازرسی‌های انجام‌شده</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <div className="text-3xl font-bold text-purple-600">۰٪</div>
          <div className="text-sm text-slate-600 mt-1">پیشرفت اهداف ایمنی</div>
        </div>
      </section>

      {/* دکمه‌های اقدام سریع */}
      <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <button className="bg-red-50 hover:bg-red-100 text-red-700 rounded-xl p-4 border border-red-200 transition text-right">
          <div className="font-semibold">📋 گزارش حادثه جدید</div>
          <div className="text-sm text-red-600 mt-1">ثبت سریع حادثه یا شبه‌حادثه</div>
        </button>
        <button className="bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-xl p-4 border border-amber-200 transition text-right">
          <div className="font-semibold">✅ بازرسی ایمنی</div>
          <div className="text-sm text-amber-600 mt-1">انجام بازرسی دوره‌ای</div>
        </button>
        <button className="bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl p-4 border border-blue-200 transition text-right">
          <div className="font-semibold">⌚ مدیریت ساعت‌ها</div>
          <div className="text-sm text-blue-600 mt-1">اتصال و پیکربندی ساعت هوشمند</div>
        </button>
        <button className="bg-green-50 hover:bg-green-100 text-green-700 rounded-xl p-4 border border-green-200 transition text-right">
          <div className="font-semibold">❤️ پایش زنده سلامت</div>
          <div className="text-sm text-green-600 mt-1">مشاهده وضعیت لحظه‌ای کارکنان</div>
        </button>
      </section>

      <ReminderWatcher slug={params.slug} />
    </div>
  );
}
