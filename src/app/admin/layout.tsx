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
      brand="سیمرغ لجر"
      subtitle="پنل مدیریت پلتفرم"
      userName={session.name}
      nav={[
        { href: "/admin", label: "داشبورد", icon: "▣" },
        { href: "/admin/companies", label: "شرکت‌ها", icon: "🏢" },
        { href: "/admin/companies/new", label: "افزودن شرکت", icon: "＋" },
      ]}
    >
      {children}
    </Shell>
  );
}
