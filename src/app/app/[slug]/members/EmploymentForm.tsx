"use client";

import { useState } from "react";
import { JALALI_MONTHS } from "@/lib/jalali";
import { setMemberEmploymentAction } from "../actions";

const SITE_MIN: Record<string, number> = { hq: 510, factory: 440, guard: 510 };

export interface Employment {
  hire_jy: number;
  hire_jm: number;
  hire_jd: number;
  site: string;
  daily_work_minutes: number;
}

export function EmploymentForm({
  slug,
  memberId,
  emp,
}: {
  slug: string;
  memberId: string;
  emp: Employment;
}) {
  const [site, setSite] = useState(emp.site);
  const [minutes, setMinutes] = useState(emp.daily_work_minutes);

  return (
    <form
      action={setMemberEmploymentAction}
      className="flex flex-wrap items-end gap-2"
    >
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="memberId" value={memberId} />
      <div>
        <label className="label">تاریخ استخدام</label>
        <div className="flex gap-1">
          <input name="jy" type="number" defaultValue={emp.hire_jy} className="input w-20" dir="ltr" />
          <select name="jm" defaultValue={emp.hire_jm} className="input w-24">
            {JALALI_MONTHS.map((mn, i) => (
              <option key={i} value={i + 1}>{mn}</option>
            ))}
          </select>
          <select name="jd" defaultValue={emp.hire_jd} className="input w-16">
            {Array.from({ length: 31 }, (_, i) => (
              <option key={i} value={i + 1}>{i + 1}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="label">محل کار</label>
        <select
          name="site"
          value={site}
          onChange={(e) => {
            setSite(e.target.value);
            setMinutes(SITE_MIN[e.target.value]);
          }}
          className="input"
        >
          <option value="hq">دفتر مرکزی</option>
          <option value="factory">کارخانه</option>
          <option value="guard">نگهبانی</option>
        </select>
      </div>
      <div>
        <label className="label">دقیقه موظفی روزانه</label>
        <input
          name="daily_work_minutes"
          type="number"
          value={minutes}
          onChange={(e) => setMinutes(Number(e.target.value))}
          className="input w-28"
          dir="ltr"
        />
      </div>
      <button className="btn-ghost">ذخیره</button>
    </form>
  );
}
