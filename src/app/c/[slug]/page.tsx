import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { CompanyLoginForm } from "./LoginForm";

export default async function CompanyLoginPage({
  params,
}: {
  params: { slug: string };
}) {
  const [company] = await sql<
    { name: string; slug: string; domain: string | null; status: string }[]
  >`
    SELECT name, slug, domain, status FROM platform.companies WHERE slug = ${params.slug}
  `;
  if (!company) notFound();

  return (
    <main
      className="relative min-h-screen overflow-hidden bg-[#0a0712] bg-cover bg-center bg-no-repeat text-white"
      style={{ backgroundImage: "url('/welcome-bg.jpg')" }}
    >
      <div className="absolute inset-0 bg-[#0a0712]/55" />
      <div className="absolute inset-0 bg-gradient-to-t from-[#0a0712]/90 via-[#0a0712]/30 to-[#0a0712]/70" />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center px-6 py-16">
        <div className="mb-6 flex flex-col items-center text-center">
          <img
            src="/logo-clean.png"
            alt=""
            className="mb-3 h-24 w-24 object-contain drop-shadow-[0_0_35px_rgba(245,158,11,0.4)]"
          />
          <h1 className="text-2xl font-extrabold tracking-tight drop-shadow">{company.name}</h1>
          <div className="mt-2 flex items-center gap-2 text-xs text-amber-300/90">
            <span className="h-px w-6 bg-amber-400/40" />
            ورود کارکنان
            <span className="h-px w-6 bg-amber-400/40" />
          </div>
          {company.domain && (
            <div className="mt-1 text-[11px] text-white/45" dir="ltr">{company.domain}</div>
          )}
        </div>

        <div className="w-full rounded-2xl border border-white/10 bg-white/[0.06] p-6 shadow-2xl shadow-black/60 backdrop-blur-xl">
          <div className="mb-5 text-center">
            <h2 className="text-lg font-bold">خوش آمدید</h2>
            <p className="mt-1 text-xs text-white/55">با نام کاربری سازمانی خود وارد شوید.</p>
          </div>
          <CompanyLoginForm slug={company.slug} />
        </div>

        <p className="mt-5 text-center text-[11px] text-white/35">
          🛡 ورود امن — قدرت‌گرفته از سیمرغ‌کارا
        </p>
      </div>
    </main>
  );
}
