/**
 * پل دستگاه تردد سیمرغ‌کارا
 * ---------------------------------------------------------------------------
 * ترمینال‌های سخت‌افزاری (ZKTeco/Hikvision/Suprema و…) رویداد تردد را یا «push»
 * می‌کنند یا با SDK خوانده می‌شوند. این سرویس آن رویداد را به فرمت سیمرغ ترجمه و
 * به API دریافت تردد می‌فرستد:  POST /api/<slug>/attendance/ingest
 *
 * اجرا:
 *   cp config.example.json config.json   # و مقادیر را پر کنید
 *   npm install && npm start
 */
import express from "express";
import { readFileSync } from "node:fs";

const cfg = JSON.parse(readFileSync(new URL("./config.json", import.meta.url)));
const app = express();
app.use(express.json({ limit: "2mb" }));

const ingestUrl = `${cfg.baseUrl}/api/${cfg.slug}/attendance/ingest`;

async function forward({ code, email, kind, at, photoUrl }) {
  const target = email || cfg.codeToEmail?.[String(code)];
  if (!target) throw new Error(`no mapping for code ${code}`);
  const res = await fetch(ingestUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.deviceToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: target,
      kind,
      ...(at ? { at } : {}),
      ...(photoUrl ? { photo_url: photoUrl } : {}),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

/**
 * Push webhook — point your terminal's push URL here, or have a vendor adapter
 * normalise the device payload to: { code, kind: 'in'|'out', at?, photoUrl? }.
 */
app.post("/push", async (req, res) => {
  try {
    const { code, email, kind, at, photoUrl } = req.body || {};
    if (kind !== "in" && kind !== "out") {
      return res.status(400).json({ error: "kind must be in|out" });
    }
    const out = await forward({ code, email, kind, at, photoUrl });
    console.log(`[bridge] ${code || email} ${kind} → ok`, out.punch_id || "");
    res.json({ ok: true });
  } catch (e) {
    console.error("[bridge] error:", e.message);
    res.status(502).json({ error: e.message });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true, ingestUrl }));

app.listen(cfg.listenPort, () => {
  console.log(`پل دستگاه روی پورت ${cfg.listenPort} — مقصد: ${ingestUrl}`);
});

/* ---------------------------------------------------------------------------
 * حالت Pull/SDK (نمونه — بسته به مدل دستگاه):
 *   هر N ثانیه لاگ تردد جدید را از SDK/دیتابیس دستگاه بخوانید و forward() کنید.
 *
 *   setInterval(async () => {
 *     const events = await readNewEventsFromDeviceSDK();
 *     for (const ev of events) {
 *       await forward({ code: ev.userId, kind: ev.inOut, at: ev.time });
 *     }
 *   }, 5000);
 * ------------------------------------------------------------------------- */
