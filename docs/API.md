# درگاه API سیمرغ‌کارا

این سند دو درگاه مستقل را توضیح می‌دهد:

1. **درگاه یکپارچه‌سازی (v1)** — برای اتصال نرم‌افزارهای دیگرِ شرکت (سیستم فروش،
   خرید، BI، اتوماسیون…) با **کلید API**.
2. **درگاه دریافت داده HRC** — برای ساعت‌های هوشمند و دستگاه‌های پایش، با
   **توکن دستگاه**.

هر دو درگاه به یک شرکت (tenant) محدودند: آدرس با `slug` شرکت شروع می‌شود و
داده‌ها فقط از اسکیمای همان شرکت خوانده/نوشته می‌شوند.

---

## ۱) درگاه یکپارچه‌سازی — `/api/<slug>/v1/...`

### پیش‌نیاز
- پنل **«درگاه API و یکپارچه‌سازی»** باید برای شرکت فعال باشد
  (سوپرادمین یا مدیر هولدینگ آن را فعال می‌کند).
- در پنل شرکت: **یکپارچه‌سازی → کلیدهای API → ساخت کلید**.
- هر کلید مجموعه‌ای از **scope**‌هاست و scopeها دقیقاً همان
  permission keyهای سامانه‌اند؛ بنابراین یک کلید هرگز دسترسی بیشتری از
  کاربری با همان مجوزها ندارد و هرگز از پنل‌های فعال شرکت فراتر نمی‌رود.
- فقط **SHA-256** کلید ذخیره می‌شود؛ متن کلید یک بار هنگام ساخت نمایش داده
  می‌شود.

### احراز هویت
```
Authorization: Bearer <api-key>
```
یا
```
x-api-key: <api-key>
```

### قالب پاسخ
```json
{ "ok": true,  "data": [ ... ] }
{ "ok": false, "error": "api key is missing scope 'ledger.view'" }
```

کدهای وضعیت: `401` کلید نامعتبر/منقضی · `403` نبود scope یا غیرفعال بودن پنل ·
`404` شرکت ناموجود · `400` ورودی نامعتبر.

### سرویس‌ها

| متد | مسیر | scope لازم | توضیح |
|-----|------|-----------|-------|
| GET | `/api/<slug>/v1/members` | `members.view` | اعضا با نقش‌هایشان |
| GET | `/api/<slug>/v1/attendance?from=&to=&member=&limit=` | `attendance.manage` | ترددها (پیش‌فرض ۳۰ روز اخیر) |
| GET | `/api/<slug>/v1/finance/accounts` | `ledger.view` | کدینگ حساب‌ها + گردش قطعی |
| GET | `/api/<slug>/v1/finance/entries?status=&from=&to=` | `ledger.view` | اسناد حسابداری با آرتیکل‌ها |
| GET | `/api/<slug>/v1/finance/trial-balance` | `finance.reports.view` | تراز آزمایشی اسناد قطعی |
| GET | `/api/<slug>/v1/inventory/items` | `inventory.view` | کالاها + موجودی کل |
| GET | `/api/<slug>/v1/inventory/stock?warehouse=` | `inventory.view` | موجودی هر کالا در هر انبار |
| GET | `/api/<slug>/v1/inventory/docs?status=&kind=` | `inventory.view` | اسناد انبار با ردیف‌ها |
| POST | `/api/<slug>/v1/inventory/docs` | `api.write` + مجوز نوع سند | ثبت سند انبار (**پیش‌نویس**) |
| GET | `/api/<slug>/v1/hrc/positions` | `hrc.monitor` | آخرین موقعیت و علائم حیاتی نفرات |
| GET | `/api/<slug>/v1/hrc/alerts?status=open` | `hrc.monitor` | هشدارهای HRC |

### نمونه — خواندن موجودی انبار
```bash
curl -s https://<host>/api/acme/v1/inventory/stock \
  -H "Authorization: Bearer sk_ab12cd_..."
```

### نمونه — ثبت رسید ورود از سیستم خرید
سند همیشه **پیش‌نویس** ساخته می‌شود؛ موجودی فقط وقتی تغییر می‌کند که انباردار
آن را در پنل تأیید کند. این عمداً است: نرم‌افزار بیرونی نمی‌تواند موجودی انبار
را بی‌اطلاع انباردار جابه‌جا کند.

```bash
curl -s -X POST https://<host>/api/acme/v1/inventory/docs \
  -H "Authorization: Bearer sk_ab12cd_..." \
  -H "content-type: application/json" \
  -d '{
        "kind": "receipt",
        "warehouse_code": "W1",
        "doc_date": "2026-06-25",
        "note": "بابت فاکتور خرید ۱۲۳",
        "lines": [
          { "item_code": "IT-1001", "qty": 10, "unit_price": 250000 }
        ]
      }'
```

پاسخ:
```json
{ "ok": true, "data": { "id": "…", "number": 12, "kind": "receipt", "status": "draft" } }
```

---

## ۲) درگاه دریافت داده HRC — `/api/<slug>/hrc/ingest`

ساعت هوشمند/مچ‌بند/تگ موقعیت با **توکن دستگاه** (نه کلید API) داده می‌فرستد.
توکن هنگام ثبت دستگاه در «HRC → ساعت‌های هوشمند» ساخته و **یک بار** نمایش
داده می‌شود.

```
POST /api/<slug>/hrc/ingest
Authorization: Bearer <device-token>
```

### بدنهٔ درخواست
```jsonc
{
  "at": "2026-06-25T08:01:00Z",   // اختیاری؛ پیش‌فرض: زمان سرور
  "heart_rate": 78,
  "spo2": 97,
  "body_temp": 36.8,
  "steps": 4210,
  "stress": 30,
  "battery": 64,
  "motion": "walking",            // still | walking | running | fall
  "sos": false,                   // فشردن دکمهٔ کمک روی ساعت
  "lat": 35.7219, "lng": 51.3347, // موقعیت جغرافیایی
  "accuracy": 8, "altitude": 1180,
  "x": 42.5, "y": 61.0,           // موقعیت روی تصویر نقشه (درصد) — وقتی GPS نیست
  "source": "gps",                // gps | lbs | wifi | beacon | lora
  "member_id": "<uuid>"           // فقط برای دستگاه‌های مشترک/دستی
}
```

ارسال دسته‌ای هم پذیرفته می‌شود (حداکثر ۲۰۰ قرائت):
```json
{ "readings": [ { ... }, { ... } ] }
```

### آنچه سرور انجام می‌دهد
1. قرائت را در `hrc_readings` ذخیره می‌کند.
2. **ناحیهٔ نقشه** را با محاسبهٔ نقطه-در-چندضلعی تعیین می‌کند (ژئوفنس).
3. مقادیر را با **آستانه‌های شرکت** می‌سنجد و در صورت تخطی **هشدار** می‌سازد:
   `sos` · `fall` · `heart_high` · `heart_low` · `spo2_low` · `temp_high` ·
   `temp_low` · `geofence` · `battery`.
   هشدار تکراری از همان نوع تا ۳۰ دقیقه دوباره ساخته نمی‌شود.
4. اگر «اعزام خودکار» فعال باشد، برای هشدارهای **بحرانی** تیم آماده را اعزام
   می‌کند.
5. `last_seen` و باتری دستگاه را به‌روز می‌کند.

### پاسخ
```json
{ "ok": true, "stored": 1, "alerts": 2 }
```

### موقعیت بدون GPS
- **شبکهٔ مخابراتی (LBS)** یا **Wi-Fi**: دستگاه lat/lng تخمینی را با
  `source: "lbs"` یا `"wifi"` می‌فرستد.
- **بیکن داخل ساختمان / LoRa**: اگر مختصات جغرافیایی در دسترس نیست، مستقیماً
  `x` و `y` (درصدی از تصویر نقشهٔ شرکت) فرستاده می‌شود.
- برای تصویرِ نقشه‌ای که مختصات چهار گوشه‌اش در «تنظیمات HRC» ثبت شده، سرور
  خودش lat/lng را روی تصویر تصویر می‌کند.

---

## ۳) درگاه تردد (موجود از قبل)

`POST /api/<slug>/attendance/ingest` — برای دستگاه‌های حضور و غیاب و اپ‌های
موبایل. جزئیات در [DEVICE_INTEGRATION.md](../DEVICE_INTEGRATION.md).
