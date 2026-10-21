import { redirect } from "next/navigation";
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

/**
 * With Keycloak sign-in only, there is one login page: Keycloak's, in Kara's
 * theme (deploy/keycloak/theme/kara). This page shows itself only to say why
 * a sign-in did not end in Kara, with the button to try again.
 */
export default function LoginPage({ searchParams }: { searchParams: { error?: string } }) {
  if (oidcEnabled() && !passwordLoginEnabled() && !searchParams.error) redirect("/auth/login");
  return (
    <LoginScreen
      oidc={oidcEnabled()}
      password={passwordLoginEnabled()}
      error={searchParams.error ? ERRORS[searchParams.error] ?? ERRORS.keycloak : undefined}
    />
  );
}
