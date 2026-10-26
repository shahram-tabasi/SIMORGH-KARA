"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, LayoutGrid, LogOut, Menu, PanelRightClose, PanelRightOpen, Search, UserCircle, X } from "lucide-react";
import { SideNav, type NavGroup } from "./SideNav";
import { CommandPalette } from "./CommandPalette";
import { ThemeToggle } from "./ThemeToggle";

const NAV_KEY = "kara.nav.collapsed";

/**
 * The application frame (after SAP Fiori's shell bar and IBM Carbon's UI
 * shell): a dark bar across the top — product, company, search, alerts,
 * theme, user — and the side navigation under it, which folds to an icon
 * rail on a desk and becomes a drawer on a phone.
 */
export function AppFrame({
  brand,
  subtitle,
  groups,
  userName,
  avatarUrl,
  profileHref,
  bell,
  logout,
  children,
}: {
  brand: string;
  subtitle?: string;
  groups: NavGroup[];
  userName: string;
  avatarUrl?: string | null;
  profileHref?: string;
  bell?: React.ReactNode;
  logout: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);

  useEffect(() => {
    try { setCollapsed(localStorage.getItem(NAV_KEY) === "1"); } catch {}
  }, []);
  useEffect(() => setDrawer(false), [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const fold = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(NAV_KEY, next ? "1" : "0"); } catch {}
  };

  return (
    <div className="min-h-screen bg-slate-100">
      <a href="#main" className="skip-link">رفتن به محتوا</a>

      <header className="shellbar">
        <button type="button" className="shell-icon lg:hidden" onClick={() => setDrawer(true)} aria-label="باز کردن منو">
          <Menu className="h-5 w-5" />
        </button>
        <button
          type="button"
          className="shell-icon hidden lg:flex"
          onClick={fold}
          aria-label={collapsed ? "باز کردن منو" : "جمع کردن منو"}
          title={collapsed ? "باز کردن منو" : "جمع کردن منو"}
        >
          {collapsed ? <PanelRightOpen className="h-5 w-5" /> : <PanelRightClose className="h-5 w-5" />}
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="" className="h-7 w-7 shrink-0 rounded-md object-cover" />
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="hidden text-sm font-semibold text-white sm:inline">سیمرغ کارا</span>
          <span className="hidden h-4 w-px self-center bg-white/25 sm:inline-block" />
          <span className="truncate text-sm text-slate-200" title={subtitle}>{brand}</span>
        </div>

        <button type="button" className="shell-search" onClick={() => setPalette(true)} aria-label="جستجو در صفحه‌ها">
          <Search className="h-4 w-4 shrink-0" />
          <span className="hidden flex-1 truncate text-start md:inline">جستجو در صفحه‌ها…</span>
          <kbd className="hidden rounded border border-white/20 px-1.5 text-[10px] text-slate-300 md:inline">Ctrl K</kbd>
        </button>

        <div className="flex items-center gap-1">
          {bell}
          <ThemeToggle />
          <UserMenu userName={userName} avatarUrl={avatarUrl} profileHref={profileHref} logout={logout} />
        </div>
      </header>

      <div className="flex">
        <aside
          className={`sticky top-12 hidden h-[calc(100vh-3rem)] shrink-0 flex-col border-e border-slate-200 bg-white transition-[width] duration-150 lg:flex ${
            collapsed ? "w-16" : "w-64"
          }`}
        >
          <SideNav groups={groups} collapsed={collapsed} />
          {!collapsed && subtitle && (
            <div className="border-t border-slate-200 px-4 py-2 text-[11px] text-slate-500">{subtitle}</div>
          )}
        </aside>

        {drawer && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="منو">
            <div className="absolute inset-0 bg-slate-900/50" onClick={() => setDrawer(false)} />
            <aside className="absolute inset-y-0 start-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl">
              <div className="flex h-12 items-center justify-between border-b border-slate-200 px-3">
                <span className="truncate text-sm font-semibold text-slate-800">{brand}</span>
                <button type="button" className="tb-icon" onClick={() => setDrawer(false)} aria-label="بستن منو">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <SideNav groups={groups} onNavigate={() => setDrawer(false)} />
            </aside>
          </div>
        )}

        <main id="main" className="min-w-0 flex-1 px-4 py-5 lg:px-8 lg:py-6">
          <div className="mx-auto max-w-[1600px]">{children}</div>
        </main>
      </div>

      <CommandPalette groups={groups} open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}

function UserMenu({
  userName,
  avatarUrl,
  profileHref,
  logout,
}: {
  userName: string;
  avatarUrl?: string | null;
  profileHref?: string;
  logout: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-9 items-center gap-2 rounded-md px-1.5 text-slate-200 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
      >
        <span className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-brand-600 text-xs font-semibold text-white">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            userName.trim().slice(0, 1)
          )}
        </span>
        <span className="hidden max-w-[10rem] truncate text-sm md:inline">{userName}</span>
        <ChevronDown className="hidden h-4 w-4 md:block" />
      </button>
      {open && (
        <div role="menu" className="absolute end-0 top-11 z-50 w-56 rounded-lg border border-slate-200 bg-white p-1 shadow-xl">
          <div className="border-b border-slate-200 px-3 py-2">
            <div className="truncate text-sm font-medium text-slate-800">{userName}</div>
          </div>
          {profileHref && (
            <Link href={profileHref} role="menuitem" onClick={() => setOpen(false)} className="menu-item">
              <UserCircle className="h-4 w-4" /> پروفایل من
            </Link>
          )}
          <div role="none">{logout}</div>
        </div>
      )}
    </div>
  );
}

/** The sign-out button inside the user menu (wrapped in its server-action form by Shell). */
export function LogoutButton() {
  return (
    <button type="submit" role="menuitem" className="menu-item w-full text-red-700">
      <LogOut className="h-4 w-4" /> خروج
    </button>
  );
}

/** Back to the platform panel (a platform administrator inside a company). */
export function PlatformPanelButton() {
  return (
    <button type="submit" role="menuitem" className="menu-item w-full">
      <LayoutGrid className="h-4 w-4" /> پنل مدیریت پلتفرم
    </button>
  );
}
