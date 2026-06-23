"use client";

import { useFormState, useFormStatus } from "react-dom";
import { askAssistantAction, type AssistantState } from "./actions";

const SAMPLES = [
  "چند روز مرخصی استحقاقی دارم؟",
  "برای فوت پدر چه نوع مرخصی بگیرم و چند روز است؟",
  "اگر سه‌شنبه و چهارشنبه مرخصی بگیرم چقدر از مانده‌ام کم می‌شود؟",
  "سقف مرخصی ساعتی در ماه چقدر است؟",
];

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" disabled={pending}>
      {pending ? "در حال پاسخ…" : "بپرس"}
    </button>
  );
}

export function Assistant({ slug, enabled }: { slug: string; enabled: boolean }) {
  const [state, action] = useFormState<AssistantState, FormData>(
    askAssistantAction,
    {}
  );

  return (
    <div className="space-y-4">
      <form action={action} className="card space-y-3">
        <input type="hidden" name="slug" value={slug} />
        <label className="label">سؤال خود را دربارهٔ مرخصی بپرسید</label>
        <textarea
          name="question"
          rows={3}
          defaultValue={state.question ?? ""}
          className="input"
          placeholder="مثلاً: چند روز مرخصی دارم و اگر هفتهٔ بعد دو روز بروم چه می‌شود؟"
        />
        <div className="flex flex-wrap gap-1.5">
          {SAMPLES.map((s) => (
            <span key={s} className="badge bg-slate-100 text-slate-500">
              {s}
            </span>
          ))}
        </div>
        <div className="flex items-center justify-between">
          {!enabled && (
            <span className="text-[11px] text-amber-600">
              برای فعال‌سازی، کلید ANTHROPIC_API_KEY در محیط تنظیم شود.
            </span>
          )}
          <div className="mr-auto">
            <Submit />
          </div>
        </div>
      </form>

      {state.error && (
        <div className="card border-red-100 bg-red-50 text-sm text-red-700">
          {state.error}
        </div>
      )}

      {state.answer && (
        <div className="card">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-lg">🤖</span>
            <span className="text-sm font-semibold text-slate-700">پاسخ دستیار</span>
          </div>
          <div className="whitespace-pre-wrap text-sm leading-7 text-slate-700">
            {state.answer}
          </div>
          <p className="mt-3 border-t border-slate-100 pt-2 text-[11px] text-slate-400">
            این پاسخ راهنمای اولیه است؛ مرجع نهایی، تأیید مدیر و واحد منابع انسانی است.
          </p>
        </div>
      )}
    </div>
  );
}
