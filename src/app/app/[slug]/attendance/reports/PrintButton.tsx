"use client";

export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="btn-ghost print:hidden">
      🖨️ چاپ
    </button>
  );
}
