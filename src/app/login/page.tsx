import { oidcEnabled, passwordLoginEnabled } from "@/lib/oidc";
import { LoginScreen } from "./LoginScreen";

export const dynamic = "force-dynamic";

/** Why a Keycloak sign-in came back without a Kara session (/auth/callback). */
const ERRORS: Record<string, string> = {
  cancelled: "ورود لغو شد.",
  expired: "مهلت ورود به پایان رسید؛ دوباره تلاش کنید.",
  keycloak: "سامانهٔ ورود پاسخ نداد؛ کمی بعد دوباره تلاش کنید.",
  unverified: "ایمیل این حساب هنوز تأیید نشده است.",
  no_account: "برای این ایمیل حسابی در سیمرغ‌کارا تعریف نشده است. با مدیر سامانهٔ شرکت خود تماس بگیرید.",
  disabled: "این حساب غیرفعال است.",
  company: "دسترسی شرکت شما غیرفعال شده یا حساب به شرکتی متصل نیست.",
};

export default function LoginPage({ searchParams }: { searchParams: { error?: string } }) {
  return (
    <LoginScreen
      oidc={oidcEnabled()}
      password={passwordLoginEnabled()}
      error={searchParams.error ? ERRORS[searchParams.error] ?? ERRORS.keycloak : undefined}
    />
  );
}
