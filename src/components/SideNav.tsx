"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
}

export interface NavGroup {
  title?: string;
  items: NavItem[];
}

export function SideNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (pathname === href) return true;
    // The first item of each list is usually the "home" of a section; only
    // light it up on exact match, otherwise prefix-match deeper pages.
    const segments = href.split("/").filter(Boolean).length;
    return segments >= 3 && pathname.startsWith(href + "/");
  };

  return (
    <nav className="flex-1 space-y-4 overflow-y-auto p-3">
      {groups.map((g, gi) => (
        <div key={gi}>
          {g.title && (
            <div className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              {g.title}
            </div>
          )}
          <div className="space-y-0.5">
            {g.items.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                    active
                      ? "bg-brand-600 font-medium text-white shadow-sm"
                      : "text-slate-600 hover:bg-brand-50 hover:text-brand-700 dark:text-slate-300 dark:hover:bg-white/[0.06] dark:hover:text-amber-300"
                  }`}
                >
                  <span className="text-base">{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
