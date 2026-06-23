"use client";

import { useFormStatus } from "react-dom";
import { punchInAction, punchOutAction } from "./actions";
import { formatTime } from "@/lib/attendance";

function Button({ label, tone }: { label: string; tone: string }) {
  const { pending } = useFormStatus();
  return (
    <button className={`${tone} px-6 py-3 text-base`} disabled={pending}>
      {pending ? "…" : label}
    </button>
  );
}

export function PunchWidget({
  slug,
  checkInIso,
  checkOutIso,
}: {
  slug: string;
  checkInIso: string | null;
  checkOutIso: string | null;
}) {
  const checkIn = checkInIso ? new Date(checkInIso) : null;
  const checkOut = checkOutIso ? new Date(checkOutIso) : null;

  const state = !checkIn
    ? "out"
    : !checkOut
      ? "in"
      : "done";

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-sm text-slate-500">وضعیت امروز شما</div>
          <div className="mt-1 flex items-center gap-3">
            <span
              className={`badge ${
                state === "in"
                  ? "bg-green-100 text-green-700"
                  : state === "done"
                    ? "bg-slate-200 text-slate-600"
                    : "bg-amber-100 text-amber-700"
              }`}
            >
              {state === "in" ? "در حال کار" : state === "done" ? "خروج ثبت شد" : "هنوز وارد نشده‌اید"}
            </span>
            <span className="text-sm text-slate-500" dir="ltr">
              ورود: {formatTime(checkIn)} · خروج: {formatTime(checkOut)}
            </span>
          </div>
        </div>

        <div className="flex gap-3">
          <form action={punchInAction}>
            <input type="hidden" name="slug" value={slug} />
            <Button label="ثبت ورود" tone="btn-primary" />
          </form>
          <form action={punchOutAction}>
            <input type="hidden" name="slug" value={slug} />
            <Button label="ثبت خروج" tone="btn-ghost" />
          </form>
        </div>
      </div>
    </div>
  );
}
