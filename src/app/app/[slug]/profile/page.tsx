import { requireTenant } from "@/lib/session";
import { sql, withTenant } from "@/lib/db";
import { PageHeader } from "@/components/Shell";
import { ProfileForm } from "./ProfileForm";

export default async function ProfilePage({
  params,
}: {
  params: { slug: string };
}) {
  const ctx = await requireTenant(params.slug);

  const [account] = await sql<{ email: string; username: string | null }[]>`
    SELECT email, username FROM platform.user_accounts WHERE id = ${ctx.session.sub}
  `;

  const avatarUrl = await withTenant(ctx.company.schema, async (tx) => {
    const [m] = await tx<{ avatar_url: string | null }[]>`
      SELECT avatar_url FROM members WHERE id = ${ctx.member.memberId}
    `;
    return m?.avatar_url ?? null;
  });

  return (
    <>
      <PageHeader
        title="پروفایل من"
        description="تصویر، رمز عبور و مشخصات حساب کاربری شما"
      />
      <ProfileForm
        slug={params.slug}
        name={ctx.member.fullName}
        email={account?.email ?? ""}
        username={account?.username ?? null}
        avatarUrl={avatarUrl}
      />
    </>
  );
}
