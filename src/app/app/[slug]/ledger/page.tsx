import { redirect } from "next/navigation";

/** «دفتر کل» گذشته اکنون بخشی از پنل مالی (سیمرغ لجر) است. */
export default function LedgerRedirect({
  params,
}: {
  params: { slug: string };
}) {
  redirect(`/app/${params.slug}/finance`);
}
