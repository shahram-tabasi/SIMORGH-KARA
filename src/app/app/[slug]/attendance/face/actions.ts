"use server";

import { revalidatePath } from "next/cache";
import { withTenant } from "@/lib/db";
import { requireTenant, ensurePermission } from "@/lib/session";

/** Remove all enrolled face samples for a member (HR). */
export async function deleteEnrollmentAction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "attendance.manage");
  const memberId = String(formData.get("memberId"));
  await withTenant(ctx.company.schema, async (tx) => {
    await tx`DELETE FROM face_embeddings WHERE member_id = ${memberId}`;
  });
  revalidatePath(`/app/${slug}/attendance/face`);
}
