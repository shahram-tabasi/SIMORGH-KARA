"use client";

import { useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  changePasswordAction,
  updateAvatarAction,
  type ProfileState,
} from "./actions";

function SaveBtn({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" disabled={pending}>
      {pending ? "…" : label}
    </button>
  );
}

function Msg({ state }: { state: ProfileState }) {
  if (state.error)
    return <div className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{state.error}</div>;
  if (state.ok)
    return <div className="rounded bg-green-50 px-2 py-1 text-xs text-green-700">{state.ok}</div>;
  return null;
}

/** Resize an image file to a small square JPEG data URL (keeps storage tiny). */
function fileToAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const size = 256;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d")!;
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function ProfileForm({
  slug,
  name,
  email,
  username,
  avatarUrl,
}: {
  slug: string;
  name: string;
  email: string;
  username: string | null;
  avatarUrl: string | null;
}) {
  const [pwState, pwAction] = useFormState<ProfileState, FormData>(changePasswordAction, {});
  const [avState, avAction] = useFormState<ProfileState, FormData>(updateAvatarAction, {});
  const [preview, setPreview] = useState<string | null>(avatarUrl);
  const [avatarData, setAvatarData] = useState<string>("");
  const [showPw, setShowPw] = useState(false);
  const avFormRef = useRef<HTMLFormElement>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const data = await fileToAvatar(file);
    setPreview(data);
    setAvatarData(data);
  }

  const initial = name.trim().slice(0, 1);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* Avatar + identity */}
      <div className="card">
        <h3 className="mb-4 text-sm font-semibold text-slate-700 dark:text-slate-200">تصویر و مشخصات</h3>
        <div className="flex items-center gap-4">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-100 text-2xl font-bold text-brand-700 ring-2 ring-brand-200 dark:bg-brand-500/20 dark:text-brand-200 dark:ring-brand-500/30">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="" className="h-full w-full object-cover" />
            ) : (
              initial
            )}
          </div>
          <div className="min-w-0 text-sm">
            <div className="font-bold text-slate-800 dark:text-slate-100">{name}</div>
            <div className="truncate text-xs text-slate-400" dir="ltr">{email}</div>
            {username && (
              <div className="mt-0.5 text-xs text-slate-500">
                نام کاربری: <span dir="ltr" className="font-medium">{username}</span>
              </div>
            )}
          </div>
        </div>

        <form ref={avFormRef} action={avAction} className="mt-4 space-y-3">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="avatar" value={avatarData || preview || ""} />
          <div className="flex items-center gap-2">
            <label className="btn-ghost cursor-pointer text-sm">
              انتخاب تصویر
              <input type="file" accept="image/*" className="hidden" onChange={onPick} />
            </label>
            {preview && (
              <button
                type="button"
                onClick={() => {
                  setPreview(null);
                  setAvatarData("");
                }}
                className="text-xs text-red-600 hover:underline"
              >
                حذف تصویر
              </button>
            )}
            <SaveBtn label="ذخیره تصویر" />
          </div>
          <p className="text-[11px] text-slate-400">تصویر به‌صورت مربع ۲۵۶ پیکسل ذخیره می‌شود.</p>
          <Msg state={avState} />
        </form>
      </div>

      {/* Password change */}
      <div className="card">
        <h3 className="mb-4 text-sm font-semibold text-slate-700 dark:text-slate-200">تغییر رمز عبور</h3>
        <form action={pwAction} className="space-y-3">
          <input type="hidden" name="slug" value={slug} />
          <div>
            <label className="label">رمز عبور فعلی</label>
            <input name="current" type={showPw ? "text" : "password"} required className="input" dir="ltr" autoComplete="current-password" />
          </div>
          <div>
            <label className="label">رمز عبور جدید</label>
            <input name="next" type={showPw ? "text" : "password"} required className="input" dir="ltr" autoComplete="new-password" />
          </div>
          <div>
            <label className="label">تکرار رمز عبور جدید</label>
            <input name="confirm" type={showPw ? "text" : "password"} required className="input" dir="ltr" autoComplete="new-password" />
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <input type="checkbox" checked={showPw} onChange={(e) => setShowPw(e.target.checked)} className="h-4 w-4" />
            نمایش رمزها
          </label>
          <Msg state={pwState} />
          <div className="flex justify-end">
            <SaveBtn label="تغییر رمز" />
          </div>
        </form>
      </div>
    </div>
  );
}
