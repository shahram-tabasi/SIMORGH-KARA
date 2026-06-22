import { requireTenant } from "@/lib/session";
import { Shell, type NavItem } from "@/components/Shell";

export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { slug: string };
}) {
  const ctx = await requireTenant(params.slug);
  const base = `/app/${params.slug}`;
  const can = (k: string) => ctx.member.permissions.has(k);

  const nav: NavItem[] = [{ href: base, label: "داشبورد", icon: "▣" }];
  if (can("members.view") || can("members.manage"))
    nav.push({ href: `${base}/members`, label: "اعضا و دسترسی‌ها", icon: "👥" });
  if (can("roles.view") || can("roles.manage"))
    nav.push({ href: `${base}/roles`, label: "نقش‌ها و مجوزها", icon: "🔑" });
  if (can("groups.view") || can("groups.manage"))
    nav.push({ href: `${base}/groups`, label: "زیرگروه‌ها", icon: "🗂" });
  nav.push({ href: `${base}/kartabl`, label: "کارتابل من", icon: "📥" });
  if (can("ledger.view") || can("ledger.manage"))
    nav.push({ href: `${base}/ledger`, label: "دفتر کل", icon: "📒" });

  return (
    <Shell
      brand={ctx.company.name}
      subtitle="سامانه مدیریت شرکت"
      userName={ctx.member.fullName}
      nav={nav}
    >
      {children}
    </Shell>
  );
}
