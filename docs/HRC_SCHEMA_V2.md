# HRC نسخهٔ ۲ — اسکیمای دیتابیس (فاز ۲)

این سند خروجی **فاز ۲** نقشهٔ راه HRC است: ساختِ جدول‌های پلتفرم ایمنیِ
دستگاه‌ناوابسته و انتقال دادهٔ نسخهٔ ۱ به آن‌ها.

> **مهم‌ترین نکته:** در این فاز **هیچ رفتاری از برنامه تغییر نمی‌کند.** جدول‌های
> نسخهٔ ۱ (`hrc_devices`، `hrc_readings`، `hrc_alerts`، `hrc_dispatches`) دست‌نخورده
> می‌مانند و همچنان منبع حقیقت صفحه‌های فعلی HRC هستند. جدول‌های جدید ساخته و از
> روی همان داده‌ها پر می‌شوند؛ در **فاز ۳** کدِ نوشتن و خواندن به آن‌ها منتقل می‌شود.

---

## ۱) فایل‌ها و مسیر اجرا

| فایل | نقش |
|---|---|
| `src/lib/sql-hrc.ts` → `HRC_V2_DDL` | ساخت جدول‌ها و ستون‌های جدید |
| `src/lib/sql-hrc.ts` → `HRC_V2_BACKFILL` | انتقال دادهٔ نسخهٔ ۱ به مدل جدید |
| `src/lib/sql-hrc.ts` → `HRC_V2_SEED` | ردیف سیاست حریم خصوصی + ۱۰ قانون ریسک پیش‌فرض |

دو مسیر اجرا، با نتیجهٔ یکسان:

* **شرکت جدید** — `tenantDDL()` در `src/lib/sql.ts` مقدار `HRC_V2_DDL` را بعد از
  `ERP_DDL` می‌چسباند، و `provisionCompany()` مقدار `HRC_V2_SEED` را اجرا می‌کند.
* **شرکت موجود** — `scripts/migrate.ts` برای هر اسکیمای `tenant_*` ابتدا
  `HRC_V2_DDL` و سپس `HRC_V2_BACKFILL` را در تراکنش جداگانه اجرا می‌کند.

هر دو با `SET LOCAL search_path` به اسکیمای همان شرکت محدود می‌شوند.

---

## ۲) سه قاعده‌ای که کل این مهاجرت بر آن‌ها بنا شده

1. **هیچ چیزی حذف یا تغییرِ نام نمی‌شود.** فقط `CREATE TABLE IF NOT EXISTS` و
   `ADD COLUMN IF NOT EXISTS`. یعنی استقرارِ این فاز روی سرورِ در حال کار، هیچ
   صفحه‌ای را نمی‌شکند.
2. **همه‌چیز idempotent است.** اجرای دوباره و سه‌بارهٔ `npm run db:migrate` نه
   داده‌ای تکرار می‌کند نه خطا می‌دهد (آزموده شد؛ بخش ۶).
3. **هر جدولِ آینه‌دار یک ستون `legacy_*_id` با ایندکس یکتا دارد**
   (`hrc_locations.legacy_reading_id`، `hrc_health_readings.legacy_reading_id`،
   `hrc_events.legacy_alert_id`، `hrc_responder_assignments.legacy_dispatch_id`).
   همین ستون‌ها هستند که backfill را قابل تکرار می‌کنند.

---

## ۳) جدول‌های جدید

| جدول | چه چیزی را نگه می‌دارد |
|---|---|
| `hrc_device_assignments` | تخصیص دستگاه به فرد، **تاریخچه‌دار** (به‌جای یک ستون `member_id`)؛ اولویت `PRIMARY/SECONDARY/BACKUP` |
| `hrc_locations` | هر رکورد موقعیت، با منبع (`GPS/CELL/WIFI/BLE_BEACON/…`) و **کیفیت** (`ACTUAL/ESTIMATED/LAST_KNOWN`) و ضریب اطمینان |
| `hrc_last_position` | آخرین موقعیت هر نفر (کلید اصلی = `member_id`) تا نقشهٔ زنده هرگز تاریخچه را اسکن نکند |
| `hrc_heartbeats` | سلامتِ خودِ دستگاه: باتری، شبکه، مجوزها، اتصال ساعت به گوشی |
| `hrc_health_readings` | سنجه‌های سلامت با طبقه‌بندی محافظه‌کارانه (`NORMAL / ABNORMAL_READING / SENSOR_UNAVAILABLE / UNKNOWN`) |
| `hrc_events` | واحد پایهٔ همه‌چیز: ۱۴ نوع رویداد، شدت، چرخهٔ عمر، و **`source_category`** برای جداکردن «اورژانس کارمند» از «مشکل فنی دستگاه» |
| `hrc_event_transitions` | چه کسی، کِی و چرا وضعیت رویداد را عوض کرد |
| `hrc_incidents` | پروندهٔ رسیدگی، با شمارهٔ خوانا (`incident_no`) |
| `hrc_responder_assignments` | اعزام تیم/نفر به حادثه، جانشین `hrc_dispatches` |
| `hrc_rules` | منطق ریسک به‌صورت داده (`conditions`/`actions` در JSON) — سرور تصمیم می‌گیرد، نه اپ اندروید |
| `hrc_policies` | حالت پایش (`SHIFT_ONLY / FACILITY_ONLY / ALWAYS`) و مدت نگهداشت هر نوع داده |
| `hrc_audit_log` | هر دسترسی به موقعیت یا سلامت افراد، قابل حسابرسی |

### ستون‌های افزوده‌شده به جدول‌های موجود

* `hrc_devices` — `device_uid`، `device_type` (۶ نوع: گوشی اندروید، ساعت Wear OS،
  دستگاه پوشیدنی اختصاصی، تگ BLE، دستگاه NFC، سخت‌افزار IoT آینده)، `capabilities`،
  `public_key`، `attestation`، `status`، `gateway_device_id` (ساعتی که از طریق گوشی
  به سرور می‌رسد)، `network`، `last_heartbeat_at`، `is_simulated`.
* `hrc_zones` — `shape` (`CIRCLE`/`POLYGON`)، `zone_type` (۵ نوع مطابق مشخصات)،
  `center_lat`/`center_lng`/`radius_m`، `building`، `floor`، `is_active`.
* `members` — `employee_code` (شمارهٔ پرسنلی خوانا مثل `EMP-1028`). **افزودنی و
  nullable** با ایندکس یکتای جزئی؛ هیچ کد موجودی به آن وابسته نیست. این همان
  «پرسش باز» بخش ۴.۶ سند تحلیل بود و به کم‌ریسک‌ترین شکل ممکن اجرا شد.

---

## ۴) نگاشت دادهٔ نسخهٔ ۱ به نسخهٔ ۲

| از (v1) | به (v2) | نکته |
|---|---|---|
| `hrc_devices.serial` / `kind` / `is_active` / `last_seen` | `device_uid` / `device_type` / `status` / `last_heartbeat_at` | `watch→WEAR_OS_WATCH`، `phone→ANDROID_PHONE`، `tag→BLE_TAG`، `band→DEDICATED_WEARABLE`، `beacon→FUTURE_IOT_DEVICE` |
| `hrc_devices.member_id` | یک ردیف باز در `hrc_device_assignments` | اولویت `PRIMARY` |
| `hrc_readings` (بخش موقعیت) | `hrc_locations` | `gps→GPS/ACTUAL`، بقیه `ESTIMATED` با ضریب اطمینان کمتر (`lbs`=۰٫۳، `wifi`=۰٫۶، `beacon`=۰٫۷) |
| `hrc_readings` (بخش سلامت) | `hrc_health_readings` | ردیف بدون هیچ سنجه‌ای → `SENSOR_UNAVAILABLE` |
| آخرین ردیف هر نفر | `hrc_last_position` | با `DISTINCT ON` و `ON CONFLICT DO UPDATE` |
| `hrc_alerts` | `hrc_events` | `offline`/`battery` → `source_category='DEVICE'`؛ بقیه `EMPLOYEE`. هشدارهای حیاتی (`heart_high`…) به `ABNORMAL_SENSOR_READING` با `payload.metric` تبدیل می‌شوند — **بدون هیچ ادعای تشخیص پزشکی** |
| `hrc_alerts.lat/lng/detail` | `hrc_events.payload` | تا فاز ۳ که `location_id` واقعی ساخته شود، هیچ داده‌ای گم نمی‌شود |
| رویدادهای `CRITICAL` یا اعزام‌شده | یک `hrc_incidents` با `incident_no` | بقیهٔ هشدارها پرونده نمی‌سازند |
| `hrc_dispatches` | `hrc_responder_assignments` | وضعیت و اولویت به حروف بزرگ نگاشت می‌شوند |
| `hrc_zones.kind` | `zone_type` | `hazard→HIGH_RISK_ZONE`، `muster→EMERGENCY_ZONE`، `gate→NO_ACCESS_ZONE`، … |

### «کیفیت موقعیت» چرا مهم است

ستون `quality` همان صداقتی است که مشخصات روی آن اصرار دارد: موقعیتی که از
دکل مخابراتی (Cell-ID) آمده با خطای ۹۵۰ متر، `ESTIMATED` ثبت می‌شود و رابط کاربری
باید آن را **دایرهٔ عدم‌قطعیت** بکشد، نه یک سوزنِ دقیق روی نقشه.

---

## ۵) قوانین ریسک پیش‌فرض

ده قانون در `hrc_rules` کاشته می‌شود — `SOS`، `FALL`، `HEART_HIGH`، `HEART_LOW`،
`SPO2_LOW`، `TEMP_HIGH`، `INACTIVITY`، `GEOFENCE`، `OFFLINE`، `BATTERY`.

مقادیر عددی داخل قانون نوشته نشده‌اند؛ به آستانه‌های همان شرکت در
`hrc_thresholds` ارجاع می‌دهند:

```json
{"all":[{"fact":"heart_rate","op":">","value":{"threshold":"hr_max"}}]}
```

پیام‌ها عمداً محافظه‌کارانه‌اند («بررسی دستی توصیه می‌شود»)، چون این سامانه
دستگاه پزشکی نیست و نباید تشخیص بدهد.

---

## ۶) آنچه واقعاً آزموده شد

روی PostgreSQL ۱۶ واقعی، نه شبیه‌سازی:

1. **اسکیمای نسخهٔ ۱ با داده** ساخته شد (۳ دستگاه از ۳ نوع، ۶ رکورد خوانش شامل
   هر پنج منبع + یک رکورد فقط با مختصات پلان، ۴ هشدار شامل یک هشدار دستگاهی و یک
   SOS، ۱ اعزام)، سپس مهاجرت اجرا شد. نتیجه: ۶ موقعیت، ۳ خوانش سلامت،
   ۳ آخرین‌موقعیت، ۴ رویداد، ۲ پرونده، ۱ اعزام، ۳ تخصیص دستگاه، ۱۰ قانون،
   ۱ سیاست — و جدول‌های نسخهٔ ۱ دست‌نخورده.
2. **idempotency** — مهاجرت سه بار پشت سر هم اجرا شد؛ همهٔ شمارش‌ها یکسان ماند.
3. **یکسانیِ شرکت جدید با شرکت مهاجرت‌یافته** — ستون‌ها، ایندکس‌ها و قیدها
   بایت‌به‌بایت مقایسه شدند: یکسان.
4. **بدون تغییر رفتار** — با مرورگر واقعی وارد پنل شد و هر هفت صفحهٔ HRC
   (داشبورد، نقشهٔ زنده، ناحیه‌بندی، تنظیمات، دستگاه‌ها، هشدارها، تیم‌ها) با
   کد ۲۰۰ و بدون هیچ خطای کنسول یا ۵xx رندر شد؛ `hrc/feed` همان دادهٔ نسخهٔ ۱
   را برمی‌گرداند.

---

## ۷) قدم بعد (فاز ۳)

انتقال نوشتن و خواندن به مدل جدید: هویت و ثبت‌نام دستگاه، خط لولهٔ ingest،
موتور ریسک روی `hrc_rules`، چرخهٔ عمر حادثه، کلیدهای RBAC، دروازهٔ حریم خصوصی
بر پایهٔ `hrc_policies`، و ثبت حسابرسی.
