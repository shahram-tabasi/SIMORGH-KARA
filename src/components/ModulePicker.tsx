import { MODULE_LIST, MODULES, type ModuleKey } from "@/lib/modules";

/**
 * Checkbox grid of panels (پنل‌ها). Used by the platform admin when creating or
 * editing a company/holding, and by a holding admin for its own companies —
 * `allowed` narrows the list to what that admin may hand out.
 */
export function ModulePicker({
  name = "modules",
  selected,
  allowed,
  disabled = false,
}: {
  name?: string;
  selected: readonly string[];
  /** Restrict the offered panels (e.g. a holding's licence). */
  allowed?: readonly string[];
  disabled?: boolean;
}) {
  const list = MODULE_LIST.filter(
    (m) => m.always || !allowed || allowed.includes(m.key)
  );

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {list.map((m) => {
        const checked = m.always || selected.includes(m.key);
        return (
          <label
            key={m.key}
            className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
              checked
                ? "border-brand-200 bg-brand-50 text-brand-700"
                : "border-slate-200 text-slate-600"
            } ${m.always || disabled ? "opacity-70" : "cursor-pointer"}`}
          >
            <input
              type="checkbox"
              name={name}
              value={m.key}
              defaultChecked={checked}
              disabled={m.always || disabled}
              className="mt-1 h-4 w-4"
            />
            {/* always-on panels still need to be submitted */}
            {m.always && <input type="hidden" name={name} value={m.key} />}
            <span>
              <span className="font-medium">
                {m.icon} {m.name}
                {m.always && (
                  <span className="mr-1 text-[10px] text-slate-400">(همیشه فعال)</span>
                )}
              </span>
              <span className="mt-0.5 block text-[11px] leading-5 text-slate-400">
                {m.description}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

/** Compact read-only badges of the panels a company currently has. */
export function ModuleBadges({ modules }: { modules: readonly string[] }) {
  const list = MODULE_LIST.filter((m) => m.always || modules.includes(m.key));
  return (
    <div className="flex flex-wrap gap-1">
      {list.map((m) => (
        <span key={m.key} className="badge bg-slate-100 text-slate-600">
          {m.icon} {MODULES[m.key as ModuleKey].name}
        </span>
      ))}
    </div>
  );
}
