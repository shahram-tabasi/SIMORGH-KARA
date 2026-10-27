"use server";

import { KaraApiError, karaApi } from "@/lib/kara-api";
import { ensurePermission, requireTenant } from "@/lib/session";

export interface Component { moveId: number; productId: number; name: string; code: string; barcode: string; planned: number; consumed: number; uom: string }
export interface WorkOrder {
  id: number;
  name: string;
  state: "blocked" | "ready" | "progress" | "done" | "cancel";
  production: { id: number; name: string; origin: string; state: string };
  product: { id: number; name: string; code: string };
  quantity: number;
  uom: string;
  workcenter: { id: number; name: string };
  plannedStart: string | null;
  durationExpected: number;
  duration: number;
  working: boolean;
  instructions: string;
  components: Component[];
}
export interface WorkOrderList { items: WorkOrder[]; workcenters: { id: number; name: string }[] }
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function run<T>(slug: string, fn: (account: string) => Promise<T>): Promise<Result<T>> {
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "shopfloor.use");
  try {
    return { ok: true, data: await fn(ctx.session.sub) };
  } catch (e) {
    if (e instanceof KaraApiError && e.code === "not_linked") return { ok: false, error: "این شرکت هنوز به Odoo وصل نشده است." };
    return { ok: false, error: e instanceof KaraApiError ? e.message : "انجام نشد؛ دوباره تلاش کنید." };
  }
}

/** Open work orders: by work centre, or what a scan or a search finds (MO number, code, barcode). */
export async function listWorkOrders(slug: string, workcenterId?: number, q?: string) {
  const qs = new URLSearchParams();
  if (workcenterId) qs.set("workcenterId", String(workcenterId));
  if (q?.trim()) qs.set("q", q.trim());
  return run(slug, (a) => karaApi<WorkOrderList>(a, "GET", `/v1/tenants/${slug}/shop-floor/work-orders?${qs}`));
}

export async function workOrderAction(slug: string, id: number, action: "start" | "pause" | "finish") {
  return run(slug, (a) => karaApi<WorkOrder>(a, "POST", `/v1/tenants/${slug}/shop-floor/work-orders/${id}/${action}`));
}

export async function consumeAction(slug: string, moId: number, moveId: number, quantity: number) {
  return run(slug, (a) => karaApi<{ moveId: number; consumed: number }>(a, "POST", `/v1/tenants/${slug}/shop-floor/manufacturing-orders/${moId}/consume`, { body: { moveId, quantity } }));
}

export async function scrapAction(slug: string, moId: number, productId: number, quantity: number, reason: string) {
  return run(slug, (a) => karaApi<{ scrap: string; state: string }>(a, "POST", `/v1/tenants/${slug}/shop-floor/manufacturing-orders/${moId}/scrap`, { body: { productId, quantity, reason } }));
}
