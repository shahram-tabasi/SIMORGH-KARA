"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { KINDS, UNIT_KINDS, type KnowledgeKind, type UnitOption } from "@/lib/knowledge";
import { saveKnowledgeAction, type KnowledgeState } from "./actions";

export interface KnowledgeValues {
  id?: string;
  kind: KnowledgeKind;
  name: string;
  code: string;
  summary: string;
  body: string;
  features: string;
  address: string;
  impact: string;
  effectiveDate: string;
  sequence: number;
  /** An uploaded document, if any. */
  fileName?: string | null;
  /** Empty: the whole company; else the unit (and those under it) it is for. */
  unitId?: string;
}

const EMPTY: KnowledgeValues = {
  kind: "product", name: "", code: "", summary: "", body: "", features: "", address: "", impact: "", effectiveDate: "", sequence: 10,
};

function Submit({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus();
  return <button className="btn-primary" disabled={pending}>{pending ? "…" : editing ? "ذخیره" : "افزودن"}</button>;
}

/** One piece of knowledge: new (no initial) or an edit. The fields follow the kind. */
export function KnowledgeForm({ slug, initial, defaultKind, units = [], unitOnly = false }: {
  slug: string; initial?: KnowledgeValues; defaultKind?: KnowledgeKind;
  /** The units it may be for. */
  units?: UnitOption[];
  /** A unit manager: only their units, only the kinds a unit has. */
  unitOnly?: boolean;
}) {
  const v = initial ?? { ...EMPTY, kind: defaultKind ?? (unitOnly ? "order" : EMPTY.kind) };
  const [kind, setKind] = useState<KnowledgeKind>(v.kind);
  const [state, action] = useFormState<KnowledgeState, FormData>(saveKnowledgeAction, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && !initial) ref.current?.reset();
  }, [state.ok, initial]);
  const dated = kind === "order" || kind === "hr_rule";
  const scoped = (UNIT_KINDS as readonly string[]).includes(kind);
  const kinds = unitOnly ? KINDS.filter((k) => (UNIT_KINDS as readonly string[]).includes(k.key)) : KINDS;

  return (
    <form ref={ref} action={action} className="space-y-3">
      {state.error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</div>}
      {state.ok && initial && <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">ذخیره شد.</div>}
      <input type="hidden" name="slug" value={slug} />
      {v.id && <input type="hidden" name="id" value={v.id} />}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label className="label">نوع</label>
          <select name="kind" className="input" value={kind} onChange={(e) => setKind(e.target.value as KnowledgeKind)}>
            {kinds.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label">نام</label>
          <input name="name" required defaultValue={v.name} className="input" placeholder={kind === "product" ? "مثلاً SIMOPRIME" : ""} />
        </div>
        <div>
          <label className="label">{kind === "order" ? "شماره" : "کد"} (اختیاری)</label>
          <input name="code" defaultValue={v.code} className="input" dir="ltr" />
        </div>
      </div>
      {scoped && (
        <div>
          <label className="label">برای چه کسانی</label>
          <select name="unitId" defaultValue={v.unitId ?? ""} className="input" required={unitOnly}>
            {!unitOnly && <option value="">کل شرکت</option>}
            {unitOnly && <option value="" disabled>— واحد را انتخاب کنید —</option>}
            {units.map((u) => <option key={u.id} value={u.id}>فقط واحد: {u.path}</option>)}
          </select>
          <p className="mt-1 text-xs text-slate-500">قانون یا دستور یک واحد برای همان واحد و واحدهای زیرمجموعهٔ آن است؛ دستیار هوش مصنوعی آن را فقط به افراد همان واحدها می‌گوید.</p>
        </div>
      )}
      <div>
        <label className="label">خلاصه</label>
        <input name="summary" defaultValue={v.summary} className="input" placeholder="در یک یا دو جمله: چیست" />
      </div>
      {kind === "datasource" && (
        <div>
          <label className="label">نشانی (URL یا host:port/database — بدون رمز عبور)</label>
          <input name="address" defaultValue={v.address} className="input" dir="ltr" placeholder="sqlserver://192.168.1.40:1433/Parts" />
        </div>
      )}
      {dated && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className="label">از تاریخ</label>
            <input type="date" name="effectiveDate" defaultValue={v.effectiveDate} className="input" />
          </div>
          <div className="md:col-span-2">
            <label className="label">اثر (چه چیزی و برای چه کسانی تغییر می‌کند)</label>
            <textarea name="impact" defaultValue={v.impact} rows={2} className="input" />
          </div>
        </div>
      )}
      <div>
        <label className="label">بارگذاری سند (PDF، Word، متن) — متن آن جای «متن کامل» را می‌گیرد</label>
        <input type="file" name="file" accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
          className="input" />
        {initial?.fileName && <p className="mt-1 text-xs text-slate-500">سند فعلی: {initial.fileName} — فایل تازه جای آن را می‌گیرد.</p>}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="label">متن کامل (Markdown)</label>
          <textarea name="body" defaultValue={v.body} rows={6} className="input" />
        </div>
        <div>
          <label className="label">ویژگی‌ها — هر سطر «نام = مقدار»</label>
          <textarea name="features" defaultValue={v.features} rows={6} className="input font-mono text-xs" dir="ltr"
            placeholder={kind === "product" ? "tier = MV\nmaxVoltageKv = 24\nstandard = IEC 62271-200" : ""} />
        </div>
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="w-28">
          <label className="label">ترتیب</label>
          <input type="number" name="sequence" defaultValue={v.sequence} className="input" />
        </div>
        <Submit editing={!!initial} />
      </div>
    </form>
  );
}
