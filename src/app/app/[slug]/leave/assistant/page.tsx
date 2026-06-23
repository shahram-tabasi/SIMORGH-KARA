import { requireTenant } from "@/lib/session";
import { PageHeader } from "@/components/Shell";
import { isAIConfigured } from "@/lib/ai";
import { Assistant } from "./Assistant";

export default async function AssistantPage({
  params,
}: {
  params: { slug: string };
}) {
  await requireTenant(params.slug);
  const enabled = isAIConfigured();

  return (
    <>
      <PageHeader
        title="دستیار هوشمند مرخصی"
        description="پرسش‌وپاسخ دربارهٔ مرخصی بر اساس مانده شما و قوانین شرکت"
      />
      <Assistant slug={params.slug} enabled={enabled} />
    </>
  );
}
