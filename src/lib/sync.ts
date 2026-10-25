import "server-only";
import type postgres from "postgres";
import { sql as db } from "./db";

/**
 * Kara is the system of record; its copies in Keycloak and Odoo follow
 * (docs/INTEGRATION.md). Call this inside the same transaction as the change
 * it carries, so the change and its job commit together (transactional
 * outbox); kara-api's provisioner runs the job. A second change before the
 * job runs joins it (one waiting job per thing).
 *
 *   company  the company itself, its apps, its unit tree (groups)
 *   member   a person: account, units, app access (entity id = account id)
 */
export async function enqueueSync(
  tx: postgres.Sql | postgres.TransactionSql,
  entity: "company" | "member",
  entityId: string,
  companyId: string | null,
  reason: string,
): Promise<void> {
  await tx`
    INSERT INTO platform.provisioning_jobs (entity, entity_id, company_id, reason)
    VALUES (${entity}, ${entityId}, ${companyId}, ${reason.slice(0, 200)})
    ON CONFLICT (entity, entity_id) WHERE status = 'pending'
    DO UPDATE SET reason = left(platform.provisioning_jobs.reason || '; ' || EXCLUDED.reason, 500), next_at = now()
  `;
}

/** Every person of a company, after a change that touches them all (apps, status, the unit tree). */
export async function enqueueCompanyMembers(
  tx: postgres.Sql | postgres.TransactionSql,
  companyId: string,
  reason: string,
): Promise<void> {
  await tx`
    INSERT INTO platform.provisioning_jobs (entity, entity_id, company_id, reason)
    SELECT 'member', a.id, ${companyId}, ${reason.slice(0, 200)}
    FROM platform.user_accounts a WHERE a.company_id = ${companyId}
    ON CONFLICT (entity, entity_id) WHERE status = 'pending'
    DO UPDATE SET next_at = now()
  `;
}

export interface SyncState { target: string; status: string; detail: string | null; syncedAt: string }
export interface SyncView { pending: boolean; failed: string | null; targets: SyncState[] }

/** What Keycloak and Odoo hold for a company or a person, and whether a job waits. */
export async function syncViews(entity: "company" | "member", ids: string[]): Promise<Record<string, SyncView>> {
  if (!ids.length) return {};
  const [states, jobs] = await Promise.all([
    db<{ entity_id: string; target: string; status: string; detail: string | null; synced_at: Date }[]>`
      SELECT entity_id, target, status, detail, synced_at FROM platform.provisioning_state
      WHERE entity = ${entity} AND entity_id = ANY(${ids}::uuid[])`,
    db<{ entity_id: string; status: string; last_error: string | null }[]>`
      SELECT DISTINCT ON (entity_id) entity_id, status, last_error FROM platform.provisioning_jobs
      WHERE entity = ${entity} AND entity_id = ANY(${ids}::uuid[]) ORDER BY entity_id, id DESC`,
  ]);
  const out: Record<string, SyncView> = {};
  for (const id of ids) out[id] = { pending: false, failed: null, targets: [] };
  for (const s of states) out[s.entity_id].targets.push({ target: s.target, status: s.status, detail: s.detail, syncedAt: s.synced_at.toISOString() });
  for (const j of jobs) {
    out[j.entity_id].pending = j.status === "pending" || j.status === "running";
    if (j.status === "failed" || (j.status === "pending" && j.last_error)) out[j.entity_id].failed = j.last_error;
  }
  return out;
}
