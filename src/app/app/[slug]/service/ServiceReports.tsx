"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";
import { reportAction, type ServiceOrder } from "./actions";

const when = (s: string | null) => (s ? new Date(`${s.replace(" ", "T")}Z`).toLocaleString("fa-IR", { dateStyle: "medium", timeStyle: "short" }) : "—");

export function ServiceReports({ slug, initial, mine, closed }: { slug: string; initial: ServiceOrder[]; mine: number[]; closed: boolean }) {
  const [items, setItems] = useState(initial);
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Link className="btn-ghost" href={`/app/${slug}/service${closed ? "" : "?closed=1"}`}>{closed ? "فقط سفارش‌های باز" : "نمایش بسته‌شده‌ها هم"}</Link>
      </div>
      {items.length === 0 && <div className="card text-sm text-slate-600 dark:text-slate-300">سفارش خدماتی نیست.</div>}
      {items.map((o) => (
        <OrderCard key={o.id} slug={slug} order={o} mine={mine.includes(o.id)} onDone={(n) => setItems((prev) => prev.map((x) => (x.id === n.id ? n : x)))} />
      ))}
    </div>
  );
}

function OrderCard({ slug, order, mine, onDone }: { slug: string; order: ServiceOrder; mine: boolean; onDone: (o: ServiceOrder) => void }) {
  const [open, setOpen] = useState(false);
  const [resolution, setResolution] = useState("");
  const [signedBy, setSignedBy] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const pad = useRef<SignaturePadHandle>(null);

  const submit = () => start(async () => {
    setError(undefined);
    if (!resolution.trim()) return setError("شرح کار انجام‌شده را بنویسید.");
    const signature = pad.current?.toDataUrl();
    if (signature && !signedBy.trim()) return setError("نام امضاکننده را بنویسید.");
    const r = await reportAction(slug, order.id, { resolution, signature, signedBy });
    if (!r.ok) return setError(r.error);
    onDone(r.data);
    setOpen(false);
  });

  return (
    <article className="card space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs text-slate-500" dir="ltr">{order.name}</p>
          <h3 className="font-semibold">{order.location}</h3>
          <p className="text-sm text-slate-600 dark:text-slate-300">{order.address}{order.phone ? ` · ${order.phone}` : ""}</p>
        </div>
        <div className="text-left text-xs text-slate-500">
          <span className="badge bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200">{order.stage}</span>
          {mine && <p className="mt-1">به شما سپرده شده</p>}
          {!mine && order.assignee && <p className="mt-1">{order.assignee}</p>}
          <p>زمان برنامه: {when(order.scheduledStart)}</p>
        </div>
      </header>
      {order.description && <div className="odoo-html text-sm leading-7" dangerouslySetInnerHTML={{ __html: order.description }} />}
      {order.closed ? (
        <div className="space-y-1 text-sm">
          {order.resolution && <div className="odoo-html text-sm leading-7" dangerouslySetInnerHTML={{ __html: order.resolution }} />}
          {order.signedBy && <p className="text-slate-600 dark:text-slate-300">امضا: {order.signedBy} — {when(order.signedOn)}</p>}
        </div>
      ) : !open ? (
        <button type="button" className="btn-primary" onClick={() => setOpen(true)}>نوشتن گزارش و امضای مشتری</button>
      ) : (
        <div className="space-y-3 border-t border-slate-200 pt-3 dark:border-slate-700">
          {order.todo && <div className="odoo-html text-sm leading-7" dangerouslySetInnerHTML={{ __html: order.todo }} />}
          <label className="flex flex-col gap-1">
            <span className="label">شرح کار انجام‌شده</span>
            <textarea className="input min-h-28" value={resolution} onChange={(e) => setResolution(e.target.value)} maxLength={10000} />
          </label>
          <SignaturePad ref={pad} label="امضای مشتری (اختیاری)" />
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-1 flex-col gap-1">
              <span className="label">نام و سمت امضاکننده</span>
              <input className="input" value={signedBy} onChange={(e) => setSignedBy(e.target.value)} maxLength={120} />
            </label>
            <button type="button" className="btn-ghost" onClick={() => pad.current?.clear()}>پاک کردن امضا</button>
          </div>
          {error && <p className="text-sm text-red-700 dark:text-red-300" role="alert">{error}</p>}
          <div className="flex gap-2">
            <button type="button" className="btn-primary" disabled={pending} onClick={submit}>{pending ? "در حال ثبت…" : "ثبت گزارش و تکمیل سفارش"}</button>
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>انصراف</button>
          </div>
        </div>
      )}
    </article>
  );
}
