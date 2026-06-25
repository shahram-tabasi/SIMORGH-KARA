import { requireTenant, ensurePermission } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { toFaDigits, toJalali, JALALI_MONTHS } from "@/lib/jalali";
import { DeviceForm } from "./DeviceForm";
import { setDeviceActiveAction, deleteDeviceAction } from "./actions";

interface Device {
  id: string;
  name: string;
  kind: string;
  is_active: boolean;
  last_seen: string | null;
  token_tail: string;
}

const KIND_LABEL: Record<string, string> = {
  terminal: "ترمینال (چهره/اثرانگشت)",
  guard: "اپ نگهبان",
  mobile: "اپ موبایل (معدن)",
};

function faWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const j = toJalali(d);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${toFaDigits(j.jd)} ${JALALI_MONTHS[j.jm - 1]} ${toFaDigits(`${hh}:${mm}`)}`;
}

export default async function DevicesPage({ params }: { params: { slug: string } }) {
  const ctx = await requireTenant(params.slug);
  ensurePermission(ctx, "attendance.manage");

  const devices = await withTenant(ctx.company.schema, async (tx) =>
    tx<Device[]>`
      SELECT id, name, kind, is_active, last_seen::text,
             right(token, 6) AS token_tail
      FROM attendance_devices ORDER BY created_at DESC
    `
  );

  return (
    <>
      <PageHeader
        title="دستگاه‌های تردد"
        description="ساخت توکن برای ترمینال چهره/اثرانگشت، اپ نگهبان و اپ معدن"
      />

      <div className="mb-6 max-w-2xl">
        <DeviceForm slug={params.slug} />
      </div>

      <div className="card max-w-3xl">
        <h3 className="mb-3 text-sm font-semibold text-slate-700">
          دستگاه‌های ثبت‌شده ({toFaDigits(devices.length)})
        </h3>
        {devices.length === 0 ? (
          <div className="text-sm text-slate-400">هنوز دستگاهی ثبت نشده است.</div>
        ) : (
          <ul className="space-y-2">
            {devices.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-800">{d.name}</span>
                    <span className="badge bg-slate-100 text-slate-500">{KIND_LABEL[d.kind] ?? d.kind}</span>
                    <span className={`badge ${d.is_active ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-500"}`}>
                      {d.is_active ? "فعال" : "غیرفعال"}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    توکن: …{d.token_tail} · آخرین فعالیت: {faWhen(d.last_seen)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <form action={setDeviceActiveAction}>
                    <input type="hidden" name="slug" value={params.slug} />
                    <input type="hidden" name="id" value={d.id} />
                    <input type="hidden" name="active" value={d.is_active ? "0" : "1"} />
                    <button className="text-xs text-brand-600 hover:underline">
                      {d.is_active ? "غیرفعال کن" : "فعال کن"}
                    </button>
                  </form>
                  <form action={deleteDeviceAction}>
                    <input type="hidden" name="slug" value={params.slug} />
                    <input type="hidden" name="id" value={d.id} />
                    <button className="text-xs text-red-600 hover:underline">حذف</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 border-t border-slate-100 pt-2 text-[11px] text-slate-400">
          نقطهٔ ارسال تردد: <code dir="ltr">POST /api/{params.slug}/attendance/ingest</code> با
          هدر <code dir="ltr">Authorization: Bearer &lt;token&gt;</code>
        </p>
      </div>
    </>
  );
}
