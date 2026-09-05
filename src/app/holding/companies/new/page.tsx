import { requireHolding } from "@/lib/session";
import { PageHeader } from "@/components/Shell";
import { CompanyForm } from "./CompanyForm";

export default async function NewSectionPage() {
  const { holding } = await requireHolding();

  return (
    <>
      <PageHeader
        title="افزودن شرکت جدید"
        description="یک شرکت مستقل (با اسکیمای جدا) و مدیر آن ساخته می‌شود؛ مدیر شرکت، گردش‌کار مرخصی و کارکنان خود را اداره می‌کند"
      />
      <CompanyForm allowed={holding.modules} />
    </>
  );
}
