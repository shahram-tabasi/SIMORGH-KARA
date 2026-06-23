import Link from "next/link";
import { SideNav, type NavGroup, type NavItem } from "./SideNav";

export type { NavItem, NavGroup };

export function Shell({
  brand,
  subtitle,
  groups,
  userName,
  children,
}: {
  brand: string;
  subtitle?: string;
  groups: NavGroup[];
  userName: string;
  children: React.ReactNode;
}) {
  const initials = brand.trim().slice(0, 2);

  return (
    <div className="flex min-h-screen bg-slate-100">
      <aside className="flex w-64 shrink-0 flex-col border-l border-slate-200 bg-white">
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-bold text-white">
            {initials}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-slate-800">{brand}</div>
            {subtitle && (
              <div className="truncate text-[11px] text-slate-400">{subtitle}</div>
            )}
          </div>
        </div>

        <SideNav groups={groups} />

        <div className="border-t border-slate-200 p-3">
          <div className="mb-2 flex items-center gap-2 px-1">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-xs text-slate-500">
              {userName.trim().slice(0, 1)}
            </div>
            <div className="truncate text-xs text-slate-600">{userName}</div>
          </div>
          <Link
            href="/logout"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 transition hover:bg-red-50"
          >
            <span>↩</span>
            <span>خروج</span>
          </Link>
        </div>
      </aside>

      <main className="flex-1 overflow-x-hidden p-4 lg:p-6">{children}</main>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
