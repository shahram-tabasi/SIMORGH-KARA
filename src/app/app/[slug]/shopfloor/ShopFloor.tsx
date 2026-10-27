"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { consumeAction, scrapAction, workOrderAction, type WorkOrder, type WorkOrderList } from "./actions";

const STATE: Record<WorkOrder["state"], string> = { blocked: "در انتظار", ready: "آمادهٔ شروع", progress: "در حال انجام", done: "پایان‌یافته", cancel: "لغو" };
const REASONS = ["برش اشتباه", "آسیب در حمل یا جابه‌جایی", "قطعهٔ معیوب", "خطای مونتاژ", "سایر"];
const num = (v: number) => v.toLocaleString("fa-IR", { maximumFractionDigits: 3 });
const minutes = (m: number) => (m >= 60 ? `${num(Math.round((m / 60) * 10) / 10)} ساعت` : `${num(Math.round(m))} دقیقه`);

export function ShopFloor({ slug, initial, workcenterId, query }: { slug: string; initial: WorkOrderList; workcenterId?: number; query: string }) {
  const router = useRouter();
  const [items, setItems] = useState(initial.items);
  const [q, setQ] = useState(query);
  const [scan, setScan] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string }>();

  const go = useCallback((next: { wc?: number; q?: string }) => {
    const qs = new URLSearchParams();
    if (next.wc) qs.set("wc", String(next.wc));
    if (next.q) qs.set("q", next.q);
    router.push(`/app/${slug}/shopfloor${qs.size ? `?${qs}` : ""}`);
  }, [router, slug]);

  const onCode = useCallback((code: string) => {
    setScan(false);
    setQ(code);
    go({ wc: workcenterId, q: code });
  }, [go, workcenterId]);

  const replace = (wo: WorkOrder) => setItems((prev) => prev.map((x) => (x.id === wo.id ? wo : x)).filter((x) => x.state !== "done" && x.state !== "cancel"));

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="label">ایستگاه کاری</span>
          <select className="input" value={workcenterId ?? ""} onChange={(e) => go({ wc: Number(e.target.value) || undefined, q })}>
            <option value="">همهٔ ایستگاه‌ها</option>
            {initial.workcenters.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
        <form className="flex flex-1 items-end gap-2" onSubmit={(e) => { e.preventDefault(); go({ wc: workcenterId, q }); }}>
          <label className="flex flex-1 flex-col gap-1">
            <span className="label">شمارهٔ سفارش ساخت، کد یا بارکد</span>
            <input className="input" dir="ltr" value={q} onChange={(e) => setQ(e.target.value)} placeholder="EKC/MO/00012" />
          </label>
          <button type="submit" className="btn-ghost">جستجو</button>
          <button type="button" className="btn-primary" onClick={() => setScan(true)}>📷 اسکن</button>
        </form>
      </div>

      {message && (
        <p className={`text-sm ${message.tone === "ok" ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`} role="status">{message.text}</p>
      )}
      {items.length === 0 && <div className="card text-sm text-slate-600 dark:text-slate-300">سفارش کار بازی پیدا نشد.</div>}
      {items.map((wo) => <WorkOrderCard key={wo.id} slug={slug} wo={wo} onChange={replace} onMessage={setMessage} />)}
      {scan && <BarcodeScanner onCode={onCode} onClose={() => setScan(false)} />}
    </div>
  );
}

function WorkOrderCard({ slug, wo, onChange, onMessage }: {
  slug: string; wo: WorkOrder; onChange: (wo: WorkOrder) => void; onMessage: (m: { tone: "ok" | "error"; text: string }) => void;
}) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [used, setUsed] = useState<Record<number, string>>({});
  const [scrap, setScrap] = useState({ productId: wo.components[0]?.productId ?? 0, quantity: "", reason: REASONS[0], other: "" });

  const act = (action: "start" | "pause" | "finish") => start(async () => {
    const r = await workOrderAction(slug, wo.id, action);
    if (!r.ok) return onMessage({ tone: "error", text: r.error });
    onChange(r.data);
    onMessage({ tone: "ok", text: `${wo.name}: ${action === "start" ? "شروع شد" : action === "pause" ? "متوقف شد" : "پایان یافت"}.` });
  });

  const consume = (moveId: number, name: string) => start(async () => {
    const qty = Number(used[moveId]);
    if (!Number.isFinite(qty) || qty < 0) return onMessage({ tone: "error", text: "مقدار را درست وارد کنید." });
    const r = await consumeAction(slug, wo.production.id, moveId, qty);
    if (!r.ok) return onMessage({ tone: "error", text: r.error });
    onChange({ ...wo, components: wo.components.map((c) => (c.moveId === moveId ? { ...c, consumed: r.data.consumed } : c)) });
    onMessage({ tone: "ok", text: `مصرف ${name} ثبت شد.` });
  });

  const sendScrap = () => start(async () => {
    const qty = Number(scrap.quantity);
    const reason = scrap.reason === "سایر" ? scrap.other.trim() : scrap.reason;
    if (!(qty > 0)) return onMessage({ tone: "error", text: "مقدار ضایعات را وارد کنید." });
    if (!reason) return onMessage({ tone: "error", text: "علت ضایعات را بنویسید." });
    const r = await scrapAction(slug, wo.production.id, scrap.productId, qty, reason);
    if (!r.ok) return onMessage({ tone: "error", text: r.error });
    setScrap((s) => ({ ...s, quantity: "", other: "" }));
    onMessage({ tone: "ok", text: `ضایعات ثبت شد (${r.data.scrap}).` });
  });

  return (
    <article className="card space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs text-slate-500" dir="ltr">{wo.production.name}{wo.production.origin ? ` · ${wo.production.origin}` : ""}</p>
          <h3 className="font-semibold">{wo.name}</h3>
          <p className="text-sm text-slate-600 dark:text-slate-300"><bdi>{wo.product.name}</bdi> — {num(wo.quantity)} {wo.uom}</p>
        </div>
        <div className="text-left text-xs text-slate-500">
          <span className="badge bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200">{wo.working ? "در حال کار" : STATE[wo.state]}</span>
          <p className="mt-1">{wo.workcenter.name}</p>
          <p>زمان: {minutes(wo.duration)} از {minutes(wo.durationExpected)}</p>
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        {!wo.working && <button type="button" className="btn-primary" disabled={pending} onClick={() => act("start")}>{wo.state === "progress" ? "ادامهٔ کار" : "شروع کار"}</button>}
        {wo.working && <button type="button" className="btn-ghost" disabled={pending} onClick={() => act("pause")}>توقف</button>}
        {wo.state === "progress" && <button type="button" className="btn-ghost" disabled={pending} onClick={() => act("finish")}>پایان کار</button>}
        <button type="button" className="btn-ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>{open ? "بستن جزئیات" : "دستورالعمل، قطعات و ضایعات"}</button>
      </div>

      {open && (
        <div className="space-y-4 border-t border-slate-200 pt-3 dark:border-slate-700">
          {wo.instructions && (
            <section>
              <h4 className="label">دستورالعمل کار</h4>
              {/* Odoo's own HTML field, sanitised by Odoo. */}
              <div className="odoo-html text-sm leading-7" dangerouslySetInnerHTML={{ __html: wo.instructions }} />
            </section>
          )}
          {wo.components.length > 0 && (
            <section className="overflow-x-auto">
              <h4 className="label">قطعات این کار — مصرف واقعی</h4>
              <table className="w-full text-sm">
                <thead><tr className="text-right text-xs text-slate-500"><th>قطعه</th><th>برنامه</th><th>ثبت‌شده</th><th>مصرف واقعی</th><th /></tr></thead>
                <tbody>
                  {wo.components.map((c) => (
                    <tr key={c.moveId} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="py-1"><bdi>{c.name}</bdi></td>
                      <td>{num(c.planned)} {c.uom}</td>
                      <td>{c.consumed ? num(c.consumed) : "—"}</td>
                      <td><input className="input w-24" inputMode="decimal" dir="ltr" value={used[c.moveId] ?? ""} placeholder={String(c.planned)} onChange={(e) => setUsed((u) => ({ ...u, [c.moveId]: e.target.value }))} /></td>
                      <td><button type="button" className="btn-ghost" disabled={pending || !used[c.moveId]} onClick={() => consume(c.moveId, c.name)}>ثبت</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          {wo.components.length > 0 && (
            <section className="flex flex-wrap items-end gap-2">
              <h4 className="label w-full">ضایعات</h4>
              <select className="input w-auto max-w-full" value={scrap.productId} onChange={(e) => setScrap((s) => ({ ...s, productId: Number(e.target.value) }))}>
                {wo.components.map((c) => <option key={c.moveId} value={c.productId}>{c.name}</option>)}
              </select>
              <input className="input w-24" inputMode="decimal" dir="ltr" placeholder="مقدار" value={scrap.quantity} onChange={(e) => setScrap((s) => ({ ...s, quantity: e.target.value }))} />
              <select className="input w-auto" value={scrap.reason} onChange={(e) => setScrap((s) => ({ ...s, reason: e.target.value }))}>
                {REASONS.map((r) => <option key={r}>{r}</option>)}
              </select>
              {scrap.reason === "سایر" && <input className="input w-48" placeholder="علت" value={scrap.other} maxLength={80} onChange={(e) => setScrap((s) => ({ ...s, other: e.target.value }))} />}
              <button type="button" className="btn-danger" disabled={pending} onClick={sendScrap}>ثبت ضایعات</button>
            </section>
          )}
        </div>
      )}
    </article>
  );
}
