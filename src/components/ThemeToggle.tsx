"use client";

import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    const c = document.documentElement.classList;
    if (next) c.add("dark");
    else c.remove("dark");
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {}
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="تغییر تم"
      title={dark ? "حالت روشن" : "حالت تاریک"}
      className="flex h-7 w-7 items-center justify-center rounded-lg text-sm text-slate-500 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10"
    >
      {dark ? "☀" : "☾"}
    </button>
  );
}
