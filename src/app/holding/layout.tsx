import { requireHolding } from "@/lib/session";
import { Shell } from "@/components/Shell";

export default async function HoldingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { session, holding } = await requireHolding();

  return (
    <Shell
      brand={holding.name}
      subtitle="پنل مدیریت هولدینگ"
      userName={session.name}
      groups={[
        {
          items: [
            { href: "/holding", label: "شرکت‌ها", icon: "🏭" },
            { href: "/holding/companies/new", label: "افزودن شرکت", icon: "＋" },
            { href: "/holding/account", label: "حساب من", icon: "👤" },
          ],
        },
      ]}
    >
      {children}
    </Shell>
  );
}
