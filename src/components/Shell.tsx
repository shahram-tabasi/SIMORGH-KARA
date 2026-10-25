import { AppFrame, LogoutButton } from "./AppFrame";
import { type NavGroup, type NavItem } from "./SideNav";
import { NotificationBell } from "./NotificationBell";
import { logoutAction } from "@/app/logout/actions";

export type { NavItem, NavGroup };

export function Shell({
  brand,
  subtitle,
  groups,
  userName,
  slug,
  avatarUrl,
  profileHref,
  children,
}: {
  brand: string;
  subtitle?: string;
  groups: NavGroup[];
  userName: string;
  slug?: string;
  avatarUrl?: string | null;
  profileHref?: string;
  children: React.ReactNode;
}) {
  return (
    <AppFrame
      brand={brand}
      subtitle={subtitle}
      groups={groups}
      userName={userName}
      avatarUrl={avatarUrl}
      profileHref={profileHref}
      bell={slug ? <NotificationBell slug={slug} /> : null}
      logout={
        <form action={logoutAction}>
          <LogoutButton />
        </form>
      }
    >
      {children}
    </AppFrame>
  );
}

/** A page's title row (a Fiori list-report / object-page header): title, description, its main action at the end. */
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
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 pb-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-slate-600">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}
