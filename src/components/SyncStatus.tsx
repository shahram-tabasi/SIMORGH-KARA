import type { SyncView } from "@/lib/sync";

const TARGET_LABEL: Record<string, string> = {
  "kc:simorgh": "Design Suite",
  "kc:hr": "دستیار منابع انسانی",
  odoo: "Odoo",
};

const fmt = (iso: string) => new Date(iso).toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" });

/**
 * Where a company or person stands in the other systems: each target with
 * ✓ (holds it), — (not there, as intended) or ✗ (failed, with why), and
 * whether a change is still on its way.
 */
export function SyncStatus({ view }: { view?: SyncView }) {
  if (!view || (!view.targets.length && !view.pending && !view.failed)) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {view.targets.map((t) => (
        <span
          key={t.target}
          title={`${t.detail ?? ""} — ${fmt(t.syncedAt)}`}
          className={`badge ${t.status === "ok" ? "bg-green-50 text-green-700" : t.status === "failed" ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-500"}`}
        >
          {t.status === "ok" ? "✓" : t.status === "failed" ? "✗" : "—"} {TARGET_LABEL[t.target] ?? t.target}
        </span>
      ))}
      {view.pending && <span className="badge bg-amber-50 text-amber-700">در حال همگام‌سازی…</span>}
      {view.failed && <span className="badge bg-red-50 text-red-700" title={view.failed}>خطا: {view.failed.slice(0, 80)}</span>}
    </div>
  );
}
