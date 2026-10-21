import "server-only";
import { sql } from "@/lib/db";
import { createSession } from "@/lib/auth";

export interface AccountRow {
  id: string;
  email: string;
  full_name: string;
  is_platform_admin: boolean;
  is_holding_admin: boolean;
  holding_id: string | null;
  company_id: string | null;
  status: string;
}

export type LoginOutcome = { redirectTo: string } | { error: string };

/**
 * The session for an account whose identity is proven (password or
 * Keycloak), and where it lands: /admin, /holding or the company's app.
 * `onlyCompany` restricts it to one company (the company login page).
 */
export async function startSession(account: AccountRow, onlyCompany?: string): Promise<LoginOutcome> {
  if (account.status !== "active") return { error: "این حساب غیرفعال است." };

  if (!onlyCompany && account.is_platform_admin) {
    await createSession({ sub: account.id, email: account.email, name: account.full_name, kind: "platform" });
    return { redirectTo: "/admin" };
  }
  if (!onlyCompany && account.is_holding_admin && account.holding_id) {
    await createSession({ sub: account.id, email: account.email, name: account.full_name, kind: "holding", holdingId: account.holding_id });
    return { redirectTo: "/holding" };
  }
  if (!account.company_id) return { error: "این حساب به هیچ شرکتی متصل نیست." };

  const [company] = await sql<{ slug: string; schema_name: string; status: string }[]>`
    SELECT slug, schema_name, status FROM platform.companies WHERE id = ${account.company_id}
  `;
  if (!company || company.status === "suspended") {
    return { error: "دسترسی شرکت شما غیرفعال شده است. با پشتیبانی تماس بگیرید." };
  }
  if (onlyCompany && company.slug !== onlyCompany) return { error: "این حساب عضو این شرکت نیست." };

  await createSession({
    sub: account.id,
    email: account.email,
    name: account.full_name,
    kind: "tenant",
    companyId: account.company_id,
    schema: company.schema_name,
    slug: company.slug,
  });
  return { redirectTo: `/app/${company.slug}` };
}

export async function accountByEmail(email: string): Promise<AccountRow | undefined> {
  const [a] = await sql<AccountRow[]>`
    SELECT id, email, full_name, is_platform_admin, is_holding_admin, holding_id, company_id, status
    FROM platform.user_accounts WHERE email = ${email}
  `;
  return a;
}
