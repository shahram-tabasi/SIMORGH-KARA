import { redirect } from "next/navigation";

/** The leave assistant became the AI assistant (the HR chatbot, one click away). */
export default function LeaveAssistantPage({ params }: { params: { slug: string } }) {
  redirect(`/app/${params.slug}/assistant`);
}
