import { requireTenant, hasModule, enforcePasswordChange } from "@/lib/session";
import { withTenant } from "@/lib/db";
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
  await enforcePasswordChange(ctx.session.sub);
  const base = `/app/${params.slug}`;
  const avatarUrl = await withTenant(ctx.company.schema, async (tx) => {
    const [m] = await tx<{ avatar_url: string | null }[]>`
      SELECT avatar_url FROM members WHERE id = ${ctx.member.memberId}
    `;
    return m?.avatar_url ?? null;
  });
  const can = (k: string) => ctx.member.permissions.has(k);
  const push = (cond: boolean, item: NavItem) => (cond ? [item] : []);
  // Panels the company has not bought are not just hidden — their permissions
  // were already stripped in requireTenant, so the pages refuse to load too.
  const hr = hasModule(ctx, "hr");
  const finance = hasModule(ctx, "finance");
  const inventory = hasModule(ctx, "inventory");
  const hrc = hasModule(ctx, "hrc");
  const api = hasModule(ctx, "api");

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
      ],
    },
    {
      title: "حضور و غیاب",
      items: hr ? [
        { href: `${base}/attendance`, label: "حضور و غیاب", icon: "🕒" },
        ...push(can("attendance.manage"), { href: `${base}/attendance/team`, label: "حضور تیم", icon: "👫" }),
        ...push(can("attendance.manage"), { href: `${base}/attendance/reports`, label: "گزارش حضور", icon: "📊" }),
        ...push(can("attendance.manage"), { href: `${base}/attendance/rules`, label: "قوانین حضور", icon: "⚙️" }),
        ...push(can("attendance.manage"), { href: `${base}/attendance/devices`, label: "دستگاه‌های تردد", icon: "📟" }),
        ...push(can("attendance.manage"), { href: `${base}/attendance/face`, label: "ثبت چهره", icon: "🙂" }),
        ...push(can("calendar.view") || can("calendar.manage"), { href: `${base}/calendar`, label: "تقویم کاری", icon: "📅" }),
        ...push(can("calendar.manage"), { href: `${base}/calendar/settings`, label: "ساعت کاری و تعطیلات", icon: "⏰" }),
      ] : [],
    },
    {
      title: "مرخصی",
      items: hr ? [
        { href: `${base}/leave`, label: "مرخصی و مأموریت", icon: "🏖️" },
        { href: `${base}/leave/assistant`, label: "دستیار مرخصی", icon: "🤖" },
        ...push(
          can("leave.approve") || can("leave.approve.hr") || can("leave.approve.l3"),
          { href: `${base}/leave/manage`, label: "کارتابل مرخصی", icon: "✅" }
        ),
        ...push(can("leave.types.manage"), { href: `${base}/leave/types`, label: "انواع مرخصی", icon: "🗂️" }),
        ...push(can("leave.ledger.manage"), { href: `${base}/leave/ledger`, label: "مدیریت مانده", icon: "💼" }),
      ] : [],
    },
    {
      title: "مالی — سیمرغ لجر",
      items: finance
        ? [
            ...push(can("ledger.view"), { href: `${base}/finance`, label: "داشبورد مالی", icon: "📒" }),
            ...push(can("ledger.view"), { href: `${base}/finance/entries`, label: "اسناد حسابداری", icon: "🧾" }),
            ...push(can("ledger.view"), { href: `${base}/finance/accounts`, label: "کدینگ حساب‌ها", icon: "📚" }),
            ...push(can("ledger.view"), { href: `${base}/finance/parties`, label: "طرف‌حساب‌ها", icon: "🤝" }),
            ...push(can("finance.reports.view"), { href: `${base}/finance/reports`, label: "گزارش‌های مالی", icon: "📈" }),
            ...push(can("finance.periods.manage"), { href: `${base}/finance/periods`, label: "سال مالی", icon: "🗓️" }),
          ]
        : [],
    },
    {
      title: "انبار",
      items: inventory
        ? [
            ...push(can("inventory.view"), { href: `${base}/inventory`, label: "موجودی انبار", icon: "📦" }),
            ...push(can("inventory.view"), { href: `${base}/inventory/docs`, label: "اسناد انبار", icon: "📄" }),
            ...push(can("inventory.view"), { href: `${base}/inventory/items`, label: "کالاها", icon: "🏷️" }),
            ...push(can("inventory.view"), { href: `${base}/inventory/warehouses`, label: "انبارها", icon: "🏬" }),
            ...push(can("inventory.request") || can("inventory.request.approve"), {
              href: `${base}/inventory/requests`,
              label: "درخواست کالا",
              icon: "📝",
            }),
            ...push(can("inventory.reports.view"), { href: `${base}/inventory/reports`, label: "کاردکس و گزارش‌ها", icon: "📊" }),
          ]
        : [],
    },
    {
      title: "HRC — سلامت و ایمنی",
      items: hrc
        ? [
            ...push(can("hrc.view"), { href: `${base}/hrc`, label: "پایش زنده", icon: "❤️" }),
            ...push(can("hrc.view"), { href: `${base}/hrc/map`, label: "نقشهٔ شرکت", icon: "🗺️" }),
            ...push(can("hrc.view"), { href: `${base}/hrc/alerts`, label: "هشدارها", icon: "🚨" }),
            ...push(can("hrc.monitor") || can("hrc.dispatch") || can("hrc.teams.manage"), {
              href: `${base}/hrc/dispatch`,
              label: "اعزام تیم",
              icon: "🚑",
            }),
            ...push(can("hrc.monitor") || can("hrc.dispatch") || can("hrc.teams.manage"), {
              href: `${base}/hrc/teams`,
              label: "تیم‌های HRC",
              icon: "🧑‍🚒",
            }),
            ...push(can("hrc.devices.manage"), { href: `${base}/hrc/devices`, label: "ساعت‌های هوشمند", icon: "⌚" }),
            ...push(can("hrc.map.manage"), { href: `${base}/hrc/zones`, label: "ناحیه‌بندی نقشه", icon: "📍" }),
            ...push(can("hrc.thresholds.manage"), { href: `${base}/hrc/settings`, label: "تنظیمات HRC", icon: "⚙️" }),
          ]
        : [],
    },
    {
      title: "یکپارچه‌سازی",
      items: api
        ? [...push(can("api.keys.manage"), { href: `${base}/integrations`, label: "کلیدهای API", icon: "🔌" })]
        : [],
    },
    {
      title: "حساب کاربری",
      items: [{ href: `${base}/profile`, label: "پروفایل من", icon: "👤" }],
    },
  ].filter((g) => g.items.length > 0);

  return (
    <Shell
      brand={ctx.company.name}
      subtitle="سامانه مدیریت شرکت"
      userName={ctx.member.fullName}
      groups={groups}
      slug={params.slug}
      avatarUrl={avatarUrl}
      profileHref={`${base}/profile`}
    >
      {children}
      <ReminderWatcher slug={params.slug} />
    </Shell>
  );
}
