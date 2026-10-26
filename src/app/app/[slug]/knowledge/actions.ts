"use server";

import { revalidatePath } from "next/cache";
import { withTenant } from "@/lib/db";
import { requireTenant } from "@/lib/session";
import { enqueueSync } from "@/lib/sync";
import { isKind, looksSecret, managedUnits, parseFeatures, UNIT_KINDS, UNIT_PATHS_SQL, type UnitOption } from "@/lib/knowledge";
import { extractText } from "@/lib/extract";

const MAX_FILE = 20 * 1024 * 1024;
const MAX_IMAGE = 3 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
/** What Odoo's copy and the assistants take of one item's text. */
const MAX_BODY = 200_000;

export interface KnowledgeState { error?: string; ok?: boolean }

type Tenant = Awaited<ReturnType<typeof requireTenant>>;

/**
 * Who may change what: knowledge.manage — anything; the manager of a unit —
 * orders, rules and notes of that unit and the units under it. Returns the
 * units the person may choose (null: any, the whole company included).
 */
async function access(ctx: Tenant): Promise<UnitOption[] | null> {
  if (ctx.member.permissions.has("knowledge.manage")) return null;
  const all = await withTenant(ctx.company.schema, (tx) => tx.unsafe<(UnitOption & { manager: string | null })[]>(UNIT_PATHS_SQL));
  const mine = managedUnits(all, ctx.member.memberId);
  if (!mine.length) throw new Error("شما مجوز ویرایش دانش شرکت را ندارید.");
  return mine;
}

/** An existing item one may change: any for knowledge.manage, else one of one's own units. */
async function mayChange(ctx: Tenant, allowed: UnitOption[] | null, id: string) {
  if (!allowed) return;
  const [row] = await withTenant(ctx.company.schema, (tx) => tx<{ unit_id: string | null }[]>`SELECT unit_id::text FROM knowledge WHERE id = ${id}`);
  if (!row?.unit_id || !allowed.some((u) => u.id === row.unit_id)) throw new Error("این مورد متعلق به واحد شما نیست.");
}

const text = (fd: FormData, key: string, max: number) => {
  const v = String(fd.get(key) ?? "").trim();
  return v ? v.slice(0, max) : null;
};

/**
 * Create (no id) or change (id) one piece of company knowledge. Its copy in
 * Odoo follows through the company's provisioning job (docs/INTEGRATION.md).
 */
export async function saveKnowledgeAction(_prev: KnowledgeState, fd: FormData): Promise<KnowledgeState> {
  const slug = String(fd.get("slug"));
  const ctx = await requireTenant(slug);
  let allowed: UnitOption[] | null;
  try {
    allowed = await access(ctx);
  } catch (e) {
    return { error: (e as Error).message };
  }

  const id = text(fd, "id", 40);
  const kind = String(fd.get("kind") ?? "");
  if (!isKind(kind)) return { error: "نوع را انتخاب کنید." };
  // Whom it is for: the whole company (empty) or one unit and the units under it.
  const unitId = (UNIT_KINDS as readonly string[]).includes(kind) ? text(fd, "unitId", 40) : null;
  if (allowed) {
    if (!unitId || !allowed.some((u) => u.id === unitId)) return { error: "واحد را انتخاب کنید: فقط برای واحدهای زیر مدیریت خود می‌توانید ثبت کنید." };
    if (id) {
      try { await mayChange(ctx, allowed, id); } catch (e) { return { error: (e as Error).message }; }
    }
  }
  const name = text(fd, "name", 200);
  if (!name) return { error: "نام را وارد کنید." };
  const features = parseFeatures(String(fd.get("features") ?? ""));
  if (!features.ok) return { error: features.error };
  const address = kind === "datasource" ? text(fd, "address", 500) : null;
  if (address && looksSecret(address)) return { error: "نشانی منبع داده نباید رمز عبور یا کلید داشته باشد؛ آن را در Secret سامانه نگه دارید." };
  const date = text(fd, "effectiveDate", 10);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "تاریخ اجرا درست نیست." };
  const sequence = Number(fd.get("sequence") || 10);

  // An uploaded document: its text becomes the body (what the assistants read); the file is kept.
  let file: { name: string; mime: string; data: Buffer } | null = null;
  let extracted: string | null = null;
  const upload = fd.get("file");
  if (upload instanceof File && upload.size > 0) {
    if (upload.size > MAX_FILE) return { error: "حجم فایل حداکثر ۲۰ مگابایت است." };
    file = { name: upload.name.slice(0, 200), mime: upload.type || "application/octet-stream", data: Buffer.from(await upload.arrayBuffer()) };
    try {
      extracted = await extractText(file.data, file.name, file.mime);
    } catch (e) {
      return { error: e instanceof Error ? e.message : "متن فایل خوانده نشد." };
    }
    if (!extracted) return { error: "در این فایل متنی پیدا نشد (احتمالاً اسکن‌شده است)؛ نسخهٔ متنی یا Word آن را بارگذاری کنید." };
    if (extracted.length > MAX_BODY) extracted = extracted.slice(0, MAX_BODY) + "\n\n[… ادامهٔ متن به‌خاطر حجم آورده نشد]";
  }

  // A product's picture.
  let image: { mime: string; data: Buffer } | null = null;
  const pic = fd.get("image");
  if (kind === "product" && pic instanceof File && pic.size > 0) {
    if (pic.size > MAX_IMAGE) return { error: "حجم تصویر حداکثر ۳ مگابایت است." };
    if (!IMAGE_TYPES.includes(pic.type)) return { error: "تصویر باید JPEG، PNG یا WebP باشد." };
    image = { mime: pic.type, data: Buffer.from(await pic.arrayBuffer()) };
  }

  const values = {
    kind, name,
    code: text(fd, "code", 100),
    summary: text(fd, "summary", 2000),
    body: extracted ?? text(fd, "body", MAX_BODY),
    address,
    impact: kind === "order" || kind === "hr_rule" ? text(fd, "impact", 20_000) : null,
    effective_date: kind === "order" || kind === "hr_rule" ? date : null,
    sequence: Number.isFinite(sequence) ? Math.round(sequence) : 10,
    unit_id: unitId,
  };

  await withTenant(ctx.company.schema, async (tx) => {
    if (id) {
      const [row] = await tx<{ id: string }[]>`
        UPDATE knowledge SET
          kind = ${values.kind}, name = ${values.name}, code = ${values.code}, summary = ${values.summary},
          body = ${values.body}, attributes = ${tx.json(features.value)}, address = ${values.address},
          impact = ${values.impact}, effective_date = ${values.effective_date}, sequence = ${values.sequence},
          unit_id = ${values.unit_id}, updated_by = ${ctx.member.memberId}, updated_at = now()
        WHERE id = ${id} RETURNING id`;
      if (row && file) {
        await tx`UPDATE knowledge SET file_name = ${file.name}, file_mime = ${file.mime}, file_size = ${file.data.length}, file_data = ${file.data} WHERE id = ${id}`;
      }
      if (row && image) await tx`UPDATE knowledge SET image_mime = ${image.mime}, image_data = ${image.data} WHERE id = ${id}`;
      if (!row) throw new Error("این مورد پیدا نشد.");
    } else {
      await tx`
        INSERT INTO knowledge (kind, name, code, summary, body, attributes, address, impact, effective_date, sequence, unit_id, updated_by,
                               file_name, file_mime, file_size, file_data, image_mime, image_data)
        VALUES (${values.kind}, ${values.name}, ${values.code}, ${values.summary}, ${values.body}, ${tx.json(features.value)},
                ${values.address}, ${values.impact}, ${values.effective_date}, ${values.sequence}, ${values.unit_id}, ${ctx.member.memberId},
                ${file?.name ?? null}, ${file?.mime ?? null}, ${file?.data.length ?? null}, ${file?.data ?? null},
                ${image?.mime ?? null}, ${image?.data ?? null})`;
    }
    await enqueueSync(tx, "company", ctx.company.id, ctx.company.id, `knowledge ${id ? "changed" : "added"}: ${name}`);
  });
  revalidatePath(`/app/${slug}/knowledge`);
  return { ok: true };
}

/** Archive or bring back: an archived item is kept (and archived in Odoo) but the apps no longer see it. */
export async function setKnowledgeActiveAction(fd: FormData) {
  const slug = String(fd.get("slug"));
  const ctx = await requireTenant(slug);
  const id = String(fd.get("id"));
  await mayChange(ctx, await access(ctx), id);
  const active = fd.get("active") === "true";
  await withTenant(ctx.company.schema, async (tx) => {
    await tx`UPDATE knowledge SET active = ${active}, updated_by = ${ctx.member.memberId}, updated_at = now() WHERE id = ${id}`;
    await enqueueSync(tx, "company", ctx.company.id, ctx.company.id, `knowledge ${active ? "restored" : "archived"}`);
  });
  revalidatePath(`/app/${slug}/knowledge`);
}

/** Delete from Kara; its Odoo copy is archived (Odoo keeps its history). */
export async function deleteKnowledgeAction(fd: FormData) {
  const slug = String(fd.get("slug"));
  const ctx = await requireTenant(slug);
  const id = String(fd.get("id"));
  await mayChange(ctx, await access(ctx), id);
  await withTenant(ctx.company.schema, async (tx) => {
    await tx`DELETE FROM knowledge WHERE id = ${id}`;
    await enqueueSync(tx, "company", ctx.company.id, ctx.company.id, "knowledge deleted");
  });
  revalidatePath(`/app/${slug}/knowledge`);
}
