import { apiRoute, limitOf } from "../_helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/<slug>/v1/members — اعضای شرکت با نقش‌هایشان. */
export async function GET(req: Request, { params }: { params: { slug: string } }) {
  return apiRoute(req, params.slug, "org", "members.view", async (tx) => {
    const limit = limitOf(req);
    return tx`
      SELECT m.id, m.full_name, m.title, m.status, ua.email, ua.username,
             ARRAY(
               SELECT r.name FROM member_roles mr
               JOIN roles r ON r.id = mr.role_id
               WHERE mr.member_id = m.id
             ) AS roles
      FROM members m
      JOIN platform.user_accounts ua ON ua.id = m.account_id
      ORDER BY m.full_name
      LIMIT ${limit}
    `;
  });
}
