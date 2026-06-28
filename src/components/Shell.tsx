import Link from "next/link";
import { SideNav, type NavGroup, type NavItem } from "./SideNav";
import { NotificationBell } from "./NotificationBell";
import { ThemeToggle } from "./ThemeToggle";

export type { NavItem, NavGroup };

export function Shell({
  brand,
  subtitle,
  groups,
  userName,
  slug,
  children,
}: {
  brand: string;
  subtitle?: string;
  groups: NavGroup[];
  userName: string;
  slug?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-slate-100 dark:bg-[#0a0712]">
      <aside className="flex w-52 shrink-0 flex-col border-l border-slate-200 bg-white dark:border-white/10 dark:bg-[#0f0b18]">
        <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-3.5 dark:border-white/10">
          <img
            src="/logo.png"
            alt=""
            className="h-9 w-9 shrink-0 rounded-xl object-cover ring-1 ring-slate-200 dark:ring-white/10"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">{brand}</div>
            {subtitle && (
              <div className="truncate text-[11px] text-slate-400 dark:text-slate-500">{subtitle}</div>
            )}
          </div>
          {slug && <NotificationBell slug={slug} />}
        </div>

        <SideNav groups={groups} />

        <div className="border-t border-slate-200 p-3 dark:border-white/10">
          <div className="mb-2 flex items-center gap-2 px-1">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-xs text-slate-500 dark:bg-white/10 dark:text-slate-300">
              {userName.trim().slice(0, 1)}
            </div>
            <div className="truncate text-xs text-slate-600 dark:text-slate-300">{userName}</div>
            <div className="ms-auto">
              <ThemeToggle />
            </div>
          </div>
          <Link
            href="/logout"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
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
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
