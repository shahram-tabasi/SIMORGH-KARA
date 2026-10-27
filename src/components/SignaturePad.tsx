"use client";

import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";

export interface SignaturePadHandle {
  /** The signature as a PNG data URL, or undefined when nothing was drawn. */
  toDataUrl(): string | undefined;
  clear(): void;
}

/** A signature drawn with a finger or a pen (pointer events), on a transparent PNG. */
export const SignaturePad = forwardRef<SignaturePadHandle, { label?: string }>(function SignaturePad({ label }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.clientWidth * ratio;
    c.height = c.clientHeight * ratio;
    const g = c.getContext("2d");
    if (!g) return;
    g.scale(ratio, ratio);
    g.lineWidth = 2.2;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = "#111827";
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };

  useImperativeHandle(ref, () => ({
    toDataUrl: () => (empty ? undefined : canvas.current?.toDataURL("image/png")),
    clear: () => {
      const c = canvas.current;
      c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
      setEmpty(true);
    },
  }), [empty]);

  return (
    <div className="space-y-1">
      {label && <span className="label">{label}</span>}
      <canvas
        ref={canvas}
        className="h-40 w-full touch-none rounded border border-dashed border-slate-400 bg-white"
        onPointerDown={(e) => {
          drawing.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          const g = e.currentTarget.getContext("2d");
          const [x, y] = point(e);
          g?.beginPath();
          g?.moveTo(x, y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const g = e.currentTarget.getContext("2d");
          const [x, y] = point(e);
          g?.lineTo(x, y);
          g?.stroke();
          if (empty) setEmpty(false);
        }}
        onPointerUp={() => { drawing.current = false; }}
        onPointerCancel={() => { drawing.current = false; }}
        aria-label="محل امضا"
      />
    </div>
  );
});
