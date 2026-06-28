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
    <html lang="fa" dir="rtl" className="dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');var d=t?t==='dark':true;var c=document.documentElement.classList;d?c.add('dark'):c.remove('dark');}catch(e){}})();`,
          }}
        />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
