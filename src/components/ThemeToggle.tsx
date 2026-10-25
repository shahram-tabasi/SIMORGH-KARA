"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

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
      aria-label={dark ? "حالت روشن" : "حالت تاریک"}
      title={dark ? "حالت روشن" : "حالت تاریک"}
      className="shell-icon"
    >
      {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}
