"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavIcon } from "./navIcons";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
}

export interface NavGroup {
  title?: string;
  items: NavItem[];
}

/** Whether a nav item is the page being shown (or a page under it). */
export function useActive() {
  const pathname = usePathname();
  return (href: string) => {
    if (pathname === href) return true;
    // The first item of each list is usually the "home" of a section; only
    // light it up on exact match, otherwise prefix-match deeper pages.
    const segments = href.split("/").filter(Boolean).length;
    return segments >= 3 && pathname.startsWith(href + "/");
  };
}

export function SideNav({
  groups,
  collapsed = false,
  onNavigate,
}: {
  groups: NavGroup[];
  /** Icons only (the rail); the label shows as a tooltip. */
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const isActive = useActive();

  return (
    <nav className={`flex-1 overflow-y-auto py-3 ${collapsed ? "px-2" : "px-3"}`} aria-label="منوی اصلی">
      {groups.map((g, gi) => (
        <div key={gi} className={gi ? "mt-4" : ""}>
          {g.title &&
            (collapsed ? (
              <div className="mx-2 mb-2 border-t border-slate-200" />
            ) : (
              <div className="mb-1 truncate px-3 text-[11px] font-semibold text-slate-500">{g.title}</div>
            ))}
          <ul className="space-y-0.5">
            {g.items.map((item) => {
              const active = isActive(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    title={collapsed ? item.label : undefined}
                    aria-current={active ? "page" : undefined}
                    className={`nav-item ${collapsed ? "justify-center px-0" : "px-3"} ${active ? "nav-item-active" : ""}`}
                  >
                    <NavIcon code={item.icon} />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
