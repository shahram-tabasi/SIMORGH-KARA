import { requirePlatformAdmin } from "@/lib/session";
import { Shell } from "@/components/Shell";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { session } = await requirePlatformAdmin();

  return (
    <Shell
      brand="سیمرغ‌کارا"
      subtitle="پنل مدیریت پلتفرم"
      userName={session.name}
      groups={[
        { items: [{ href: "/admin", label: "داشبورد", icon: "▣" }] },
        {
          title: "شرکت‌ها",
          items: [
            { href: "/admin/companies", label: "شرکت‌ها", icon: "🏢" },
            { href: "/admin/companies/new", label: "افزودن شرکت", icon: "＋" },
          ],
        },
        {
          title: "هولدینگ‌ها",
          items: [
            { href: "/admin/holdings", label: "هولدینگ‌ها", icon: "🏬" },
            { href: "/admin/holdings/new", label: "افزودن هولدینگ", icon: "＋" },
          ],
        },
        {
          title: "حساب کاربری",
          items: [{ href: "/admin/account", label: "حساب من", icon: "👤" }],
        },
      ]}
    >
      {children}
    </Shell>
  );
}
