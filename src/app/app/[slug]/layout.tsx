import { requireTenant } from "@/lib/session";
import { Shell, type NavGroup, type NavItem } from "@/components/Shell";
import { ReminderWatcher } from "@/components/ReminderWatcher";

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
  const push = (cond: boolean, item: NavItem) => (cond ? [item] : []);

  const groups: NavGroup[] = [
    { items: [{ href: base, label: "داشبورد", icon: "▣" }] },
    {
      title: "سازمان",
      items: [
        ...push(can("members.view") || can("members.manage"), {
          href: `${base}/members`,
          label: "اعضا و دسترسی‌ها",
          icon: "👥",
        }),
        ...push(can("roles.view") || can("roles.manage"), {
          href: `${base}/roles`,
          label: "نقش‌ها و مجوزها",
          icon: "🔑",
        }),
        ...push(can("groups.view") || can("groups.manage"), {
          href: `${base}/groups`,
          label: "زیرگروه‌ها",
          icon: "🗂",
        }),
      ],
    },
    {
      title: "کارتابل و میز کار",
      items: [
        { href: `${base}/kartabl`, label: "کارتابل من", icon: "📥" },
        { href: `${base}/tasks`, label: "میز کار", icon: "🗒️" },
        { href: `${base}/tasks/calendar`, label: "تقویم کارها", icon: "🗓️" },
      ],
    },
    {
      title: "حضور و غیاب",
      items: [
        { href: `${base}/attendance`, label: "حضور و غیاب", icon: "🕒" },
        ...push(can("attendance.manage"), { href: `${base}/attendance/team`, label: "حضور تیم", icon: "👫" }),
        ...push(can("attendance.manage"), { href: `${base}/attendance/reports`, label: "گزارش حضور", icon: "📊" }),
        ...push(can("attendance.manage"), { href: `${base}/attendance/rules`, label: "قوانین حضور", icon: "⚙️" }),
        ...push(can("calendar.view") || can("calendar.manage"), { href: `${base}/calendar`, label: "تقویم کاری", icon: "📅" }),
        ...push(can("calendar.manage"), { href: `${base}/calendar/settings`, label: "ساعت کاری و تعطیلات", icon: "⏰" }),
      ],
    },
    {
      title: "مرخصی",
      items: [
        { href: `${base}/leave`, label: "مرخصی و مأموریت", icon: "🏖️" },
        { href: `${base}/leave/assistant`, label: "دستیار مرخصی", icon: "🤖" },
        ...push(
          can("leave.approve") || can("leave.approve.hr") || can("leave.approve.l3"),
          { href: `${base}/leave/manage`, label: "کارتابل مرخصی", icon: "✅" }
        ),
        ...push(can("leave.types.manage"), { href: `${base}/leave/types`, label: "انواع مرخصی", icon: "🗂️" }),
        ...push(can("leave.ledger.manage"), { href: `${base}/leave/ledger`, label: "مدیریت مانده", icon: "💼" }),
      ],
    },
    {
      title: "مالی",
      items: [
        ...push(can("ledger.view") || can("ledger.manage"), { href: `${base}/ledger`, label: "دفتر کل", icon: "📒" }),
      ],
    },
  ].filter((g) => g.items.length > 0);

  return (
    <Shell
      brand={ctx.company.name}
      subtitle="سامانه مدیریت شرکت"
      userName={ctx.member.fullName}
      groups={groups}
      slug={params.slug}
    >
      {children}
      <ReminderWatcher slug={params.slug} />
    </Shell>
  );
}
