"use server";

import { KaraApiError, karaApi } from "@/lib/kara-api";
import { ensurePermission, requireTenant } from "@/lib/session";

export interface ServiceOrder {
  id: number;
  name: string;
  stage: string;
  closed: boolean;
  location: string;
  address: string;
  phone: string;
  scheduledStart: string | null;
  assignee: string;
  assigneeEmail: string;
  description: string;
  todo: string;
  resolution: string;
  signedBy: string;
  signedOn: string | null;
}
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function run<T>(slug: string, fn: (account: string) => Promise<T>): Promise<Result<T>> {
  const ctx = await requireTenant(slug);
  ensurePermission(ctx, "service.report");
  try {
    return { ok: true, data: await fn(ctx.session.sub) };
  } catch (e) {
    if (e instanceof KaraApiError && e.code === "not_linked") return { ok: false, error: "این شرکت هنوز به Odoo وصل نشده است." };
    return { ok: false, error: e instanceof KaraApiError ? e.message : "انجام نشد؛ دوباره تلاش کنید." };
  }
}

export async function listServiceOrders(slug: string, includeClosed = false) {
  return run(slug, (a) => karaApi<{ items: ServiceOrder[]; mine: number[] }>(a, "GET", `/v1/tenants/${slug}/shop-floor/service-orders?includeClosed=${includeClosed}`));
}

/** The report from site; the signature is a PNG data URL from the pad. */
export async function reportAction(slug: string, id: number, report: { resolution: string; signature?: string; signedBy?: string }) {
  const signature = report.signature?.replace(/^data:image\/png;base64,/, "");
  if (signature && signature.length > 600_000) return { ok: false, error: "امضا بیش از اندازه بزرگ است؛ دوباره امضا کنید." } as const;
  return run(slug, (a) => karaApi<ServiceOrder>(a, "POST", `/v1/tenants/${slug}/shop-floor/service-orders/${id}/report`, {
    body: { resolution: report.resolution, signature: signature || undefined, signedBy: report.signedBy || undefined },
  }));
}
