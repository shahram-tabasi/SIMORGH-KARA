import { JALALI_MONTHS, todayJalali } from "@/lib/jalali";

/**
 * Three inputs (روز / ماه / سال) that a server action reads back with the
 * `<prefix>y`, `<prefix>m`, `<prefix>d` names — the same convention the kartabl
 * reminder fields already use.
 */
export function JalaliDateFields({
  prefix,
  label,
  defaultDate,
}: {
  prefix: string;
  label?: string;
  defaultDate?: { jy: number; jm: number; jd: number };
}) {
  const d = defaultDate ?? todayJalali();
  return (
    <div>
      {label && <label className="label">{label}</label>}
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          name={`${prefix}d`}
          defaultValue={d.jd}
          min={1}
          max={31}
          className="input w-16 text-center"
          dir="ltr"
          aria-label="روز"
        />
        <select
          name={`${prefix}m`}
          defaultValue={d.jm}
          className="input w-28"
          aria-label="ماه"
        >
          {JALALI_MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
        <input
          type="number"
          name={`${prefix}y`}
          defaultValue={d.jy}
          min={1300}
          max={1500}
          className="input w-20 text-center"
          dir="ltr"
          aria-label="سال"
        />
      </div>
    </div>
  );
}
