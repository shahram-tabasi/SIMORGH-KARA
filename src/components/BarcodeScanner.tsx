"use client";

import { useEffect, useRef, useState } from "react";

type Detector = { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> };
type DetectorCtor = new (opts?: { formats?: string[] }) => Detector;

/**
 * The phone's or tablet's camera as a barcode reader (the browser's
 * BarcodeDetector: Chrome and Edge on Android, ChromeOS, Windows, macOS).
 * Elsewhere it says so, and the code is typed in the search box instead.
 */
export function BarcodeScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const Ctor = (globalThis as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
    if (!Ctor) {
      setError("این مرورگر خواندن بارکد با دوربین را پشتیبانی نمی‌کند؛ کد را در کادر جستجو بنویسید.");
      return;
    }
    let stream: MediaStream | undefined;
    let stopped = false;
    const detector = new Ctor({ formats: ["code_128", "code_39", "ean_13", "ean_8", "qr_code", "data_matrix", "upc_a"] });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        while (!stopped) {
          const found = await detector.detect(video.current).catch(() => []);
          if (found[0]?.rawValue) {
            onCode(found[0].rawValue.trim());
            return;
          }
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch {
        setError("دوربین در دسترس نیست (اجازهٔ دوربین را بدهید).");
      }
    })();
    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onCode]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-label="اسکن بارکد">
      <div className="card w-full max-w-md space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">اسکن بارکد</h3>
          <button type="button" className="btn-ghost" onClick={onClose}>بستن</button>
        </div>
        {error ? (
          <p className="text-sm text-amber-700 dark:text-amber-300">{error}</p>
        ) : (
          <video ref={video} className="w-full rounded bg-black" muted playsInline />
        )}
        <p className="text-xs text-slate-500">بارکد سفارش ساخت یا قطعه را جلوی دوربین بگیرید.</p>
      </div>
    </div>
  );
}
