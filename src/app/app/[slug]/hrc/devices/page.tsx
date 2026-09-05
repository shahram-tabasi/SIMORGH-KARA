import { requireTenant, guardPanel } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { DEVICE_KINDS, agoLabel } from "@/lib/hrc";
import { DeviceForm } from "./DeviceForm";
import {
  assignDeviceAction,
  toggleDeviceAction,
  deleteDeviceAction,
} from "../actions";
import { minutesSince } from "../data";

async function load(schema: string) {
  return withTenant(schema, async (tx) => {
    const devices = await tx<
      {
        id: string;
        serial: string;
        model: string | null;
        kind: string;
        member_id: string | null;
        member: string | null;
        is_active: boolean;
        battery: number | null;
        last_seen: string | null;
        readings: number;
      }[]
    >`
      SELECT d.id, d.serial, d.model, d.kind, d.member_id, m.full_name AS member,
             d.is_active, d.battery, d.last_seen::text,
             (SELECT count(*)::int FROM hrc_readings r WHERE r.device_id = d.id) AS readings
      FROM hrc_devices d
      LEFT JOIN members m ON m.id = d.member_id
      ORDER BY d.serial
    `;
    const members = await tx<{ id: string; full_name: string }[]>`
      SELECT id, full_name FROM members WHERE status = 'active' ORDER BY full_name
    `;
    return { devices, members };
  });
}

export default async function DevicesPage({
  params,
}: {
  params: { slug: string };
}) {
  const ctx = await requireTenant(params.slug);
  guardPanel(ctx, "hrc", "hrc.devices.manage");
  const { devices, members } = await load(ctx.company.schema);

  return (
    <>
      <PageHeader
        title="ساعت‌های هوشمند و دستگاه‌های پایش"
        description="ثبت دستگاه، تخصیص به کارمند و توکن اتصال به درگاه دریافت داده"
      />

      <div className="mb-6">
        <DeviceForm slug={params.slug} members={members} />
      </div>

      <div className="card mb-4 text-xs text-slate-500">
        دستگاه‌ها داده را با این درخواست ارسال می‌کنند:
        <code className="mt-1 block break-all text-[11px]" dir="ltr">
          POST /api/{params.slug}/hrc/ingest — Authorization: Bearer &lt;device-token&gt;
        </code>
      </div>

      <div className="card overflow-x-auto">
        {devices.length === 0 ? (
          <div className="py-6 text-center text-sm text-slate-400">
            هنوز دستگاهی ثبت نشده است.
          </div>
        ) : (
          <table className="w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="text-right text-xs text-slate-400">
                <th className="pb-2">سریال</th>
                <th className="pb-2">نوع</th>
                <th className="pb-2">کارمند</th>
                <th className="pb-2">باتری</th>
                <th className="pb-2">آخرین ارتباط</th>
                <th className="pb-2">قرائت‌ها</th>
                <th className="pb-2">عملیات</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id} className="border-t border-slate-100">
                  <td className="py-2" dir="ltr">
                    {d.serial}
                    {d.model ? ` · ${d.model}` : ""}
                    {!d.is_active && (
                      <span className="badge mr-2 bg-red-100 text-red-700">غیرفعال</span>
                    )}
                  </td>
                  <td className="py-2 text-xs text-slate-500">
                    {DEVICE_KINDS[d.kind as keyof typeof DEVICE_KINDS] ?? d.kind}
                  </td>
                  <td className="py-2">
                    <form action={assignDeviceAction} className="flex items-center gap-1.5">
                      <input type="hidden" name="slug" value={params.slug} />
                      <input type="hidden" name="deviceId" value={d.id} />
                      <select
                        name="memberId"
                        defaultValue={d.member_id ?? ""}
                        className="input !w-40 !py-1 text-xs"
                      >
                        <option value="">— بدون تخصیص —</option>
                        {members.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.full_name}
                          </option>
                        ))}
                      </select>
                      <button className="text-xs text-brand-600 hover:underline">ثبت</button>
                    </form>
                  </td>
                  <td className="py-2" dir="ltr">
                    {d.battery === null ? "—" : `${d.battery}%`}
                  </td>
                  <td className="py-2 text-xs text-slate-500">
                    {agoLabel(minutesSince(d.last_seen))}
                  </td>
                  <td className="py-2" dir="ltr">
                    {d.readings}
                  </td>
                  <td className="py-2">
                    <div className="flex items-center gap-2">
                      <form action={toggleDeviceAction}>
                        <input type="hidden" name="slug" value={params.slug} />
                        <input type="hidden" name="deviceId" value={d.id} />
                        <button className="text-xs text-brand-600 hover:underline">
                          {d.is_active ? "غیرفعال" : "فعال"}
                        </button>
                      </form>
                      <form action={deleteDeviceAction}>
                        <input type="hidden" name="slug" value={params.slug} />
                        <input type="hidden" name="deviceId" value={d.id} />
                        <button className="text-xs text-red-600 hover:underline">حذف</button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
