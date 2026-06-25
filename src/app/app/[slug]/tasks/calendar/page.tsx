import { redirect } from "next/navigation";

// The task calendar is now merged into the unified work calendar (تقویم کاری).
export default function TasksCalendarRedirect({
  params,
}: {
  params: { slug: string };
}) {
  redirect(`/app/${params.slug}/calendar`);
}
