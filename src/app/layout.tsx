import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "سیمرغ لجر — سامانه یکپارچه مدیریت",
  description:
    "پلتفرم SaaS چندمستأجری: مدیریت شرکت‌ها، سطوح دسترسی، کارتابل و دفتر کل",
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
