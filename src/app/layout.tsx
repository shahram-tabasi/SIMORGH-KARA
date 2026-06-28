import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "سیمرغ‌کارا — سامانه هوشمند حضور و غیاب و مدیریت سازمان",
  description:
    "پلتفرم SaaS چندمستأجری حضور و غیاب، منابع انسانی، کارتابل و میز کار",
  icons: { icon: "/logo.png" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fa" dir="rtl">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
