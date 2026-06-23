"use server";

import { withTenant } from "@/lib/db";
import { requireTenant } from "@/lib/session";
import { askClaude, isAIConfigured } from "@/lib/ai";
import { loadBalance } from "@/lib/leave-balance";
import { todayJalali } from "@/lib/jalali";

export interface AssistantState {
  answer?: string;
  error?: string;
  question?: string;
}

export async function askAssistantAction(
  _prev: AssistantState,
  formData: FormData
): Promise<AssistantState> {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  const question = String(formData.get("question") || "").trim();
  if (question.length < 3) return { error: "سؤال خود را کامل‌تر بنویسید." };
  if (!isAIConfigured())
    return {
      error: "دستیار هوشمند هنوز فعال نشده است (کلید API تنظیم نشده).",
      question,
    };

  const today = todayJalali();
  const balance = await loadBalance(ctx.company.schema, ctx.member.memberId, today.jy);

  const { types, policy } = await withTenant(ctx.company.schema, async (tx) => {
    const types = await tx<
      {
        name: string;
        unit: string;
        paid: boolean;
        deducts_entitlement: boolean;
        max_minutes_per_day: number | null;
        max_count_per_month: number | null;
        max_count_per_week: number | null;
        max_days_per_year: string | null;
        description: string | null;
      }[]
    >`
      SELECT name, unit, paid, deducts_entitlement, max_minutes_per_day,
             max_count_per_month, max_count_per_week, max_days_per_year, description
      FROM leave_types WHERE is_active = true ORDER BY sort_order
    `;
    const [policy] = await tx<
      { grace_minutes: number; standard_daily_minutes: number; annual_leave_days: string }[]
    >`
      SELECT grace_minutes, standard_daily_minutes, annual_leave_days
      FROM attendance_policy WHERE id = 1
    `;
    return { types, policy };
  });

  const system = [
    "تو دستیار منابع انسانی یک شرکت ایرانی هستی و به کارمندان دربارهٔ مرخصی کمک می‌کنی.",
    "پاسخ‌ها را فقط به زبان فارسی، کوتاه، دقیق و کاربردی بده.",
    "مبنای پاسخ تو فقط «قوانین شرکت» و «مانده مرخصی کارمند» است که در ادامه می‌آید، به‌علاوهٔ اصول کلی قانون کار ایران.",
    "اگر داده‌ای برای پاسخ نداری، صادقانه بگو و کارمند را به واحد منابع انسانی ارجاع بده؛ قانون یا عدد از خودت نساز.",
    "وقتی مناسب بود، نوع صحیح مرخصی را پیشنهاد بده و دربارهٔ سقف‌ها یا منفی‌شدن مانده هشدار بده.",
    "",
    `تاریخ امروز: ${today.jy}/${today.jm}/${today.jd}`,
    "",
    "== مانده مرخصی کارمند (روز) ==",
    `استحقاق امسال: ${balance.accrued} | ذخیره سال‌های قبل: ${balance.carriedIn} | استفاده‌شده: ${balance.used} | مانده قابل استفاده: ${balance.remaining}`,
    `سقف سالانه: ${balance.annual} روز | دقیقه موظفی روزانه این کارمند: ${balance.dailyMinutes}`,
    "حداکثر مرخصی منفی مجاز: ۳ روز.",
    "",
    "== قوانین حضور شرکت ==",
    `تأخیر مجاز: ${policy?.grace_minutes ?? 0} دقیقه | کارکرد استاندارد روزانه: ${policy?.standard_daily_minutes ?? 480} دقیقه`,
    "",
    "== انواع مرخصی فعال شرکت ==",
    ...types.map(
      (t) =>
        `- ${t.name} (${t.unit === "hour" ? "ساعتی" : "روزانه"}): ` +
        `${t.paid ? "با حقوق" : "بدون حقوق"}، ${t.deducts_entitlement ? "از استحقاقی کسر می‌شود" : "بدون کسر از استحقاقی"}` +
        (t.max_minutes_per_day ? `، سقف ${t.max_minutes_per_day} دقیقه در روز` : "") +
        (t.max_count_per_month ? `، ${t.max_count_per_month} نوبت در ماه` : "") +
        (t.max_count_per_week ? `، ${t.max_count_per_week} نوبت در هفته` : "") +
        (t.max_days_per_year ? `، سقف ${t.max_days_per_year} روز در سال` : "") +
        (t.description ? ` — ${t.description}` : "")
    ),
  ].join("\n");

  try {
    const answer = await askClaude(system, question);
    return { answer, question };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "خطا در ارتباط با دستیار هوشمند.",
      question,
    };
  }
}
