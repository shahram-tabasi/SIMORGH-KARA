"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { NavIcon } from "./navIcons";
import type { NavGroup } from "./SideNav";

/** Persian and Arabic letter forms read as one, so «ی» finds «ي». */
const fold = (s: string) => s.toLowerCase().replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/‌/g, " ").trim();

/** Ctrl+K (or ⌘K): go to any page of the menu by typing part of its name. */
export function CommandPalette({ groups, open, onClose }: { groups: NavGroup[]; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const all = useMemo(
    () => groups.flatMap((g) => g.items.map((i) => ({ ...i, group: g.title ?? "" }))),
    [groups],
  );
  const hits = useMemo(() => {
    const t = fold(q);
    return t ? all.filter((i) => fold(`${i.label} ${i.group}`).includes(t)) : all;
  }, [all, q]);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setSel(0);
    setTimeout(() => input.current?.focus(), 0);
  }, [open]);
  useEffect(() => setSel(0), [q]);

  if (!open) return null;

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-slate-900/40 px-4 pt-[12vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="جستجو در صفحه‌ها"
        className="w-full max-w-lg overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-slate-200 px-3">
          <Search className="h-4 w-4 text-slate-500" aria-hidden />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, hits.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              else if (e.key === "Enter" && hits[sel]) go(hits[sel].href);
            }}
            placeholder="نام صفحه را بنویسید…"
            className="h-11 flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-500"
          />
          <kbd className="kbd">Esc</kbd>
        </div>
        <ul className="max-h-80 overflow-y-auto p-1" role="listbox">
          {hits.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">صفحه‌ای با این نام نیست.</li>}
          {hits.map((h, i) => (
            <li key={h.href} role="option" aria-selected={i === sel}>
              <button
                type="button"
                onMouseEnter={() => setSel(i)}
                onClick={() => go(h.href)}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-start text-sm ${
                  i === sel ? "bg-brand-50 text-brand-700" : "text-slate-700"
                }`}
              >
                <NavIcon code={h.icon} className="h-4 w-4 shrink-0" />
                <span className="flex-1 truncate">{h.label}</span>
                {h.group && <span className="truncate text-xs text-slate-500">{h.group}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
