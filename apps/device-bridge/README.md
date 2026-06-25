# پل دستگاه تردد (Node.js)

سرویس واسط بین **ترمینال‌های سخت‌افزاری تردد** (ZKTeco، Hikvision، Suprema و…) و
API سیمرغ‌کارا. رویداد تردد دستگاه را می‌گیرد، کد پرسنلی را به کاربر سیمرغ نگاشت
می‌کند و به `POST /api/<slug>/attendance/ingest` می‌فرستد.

## راه‌اندازی
```bash
cd apps/device-bridge
cp config.example.json config.json     # baseUrl, slug, deviceToken, نگاشت کدها
npm install
npm start
```
سپس **URL پوش دستگاه** را روی `http://<bridge-host>:8088/push` تنظیم کنید (یا یک
آداپتور مخصوص مدل دستگاه، payload را به فرمت زیر تبدیل کند):

```json
POST /push
{ "code": "1001", "kind": "in", "at": "2026-06-25T08:01:00Z" }
```

## دو حالت اتصال
- **Push**: دستگاه خودش رویداد را به `/push` می‌فرستد (همین سرویس).
- **Pull/SDK**: برای دستگاه‌هایی که فقط SDK/دیتابیس محلی دارند، بخش نمونهٔ
  `setInterval` در `index.js` را فعال کنید تا لاگ را دوره‌ای بخواند و forward کند.

## نکات
- توکن دستگاه از پنل وب (نوع **ترمینال**) ساخته می‌شود.
- نگاشت کد پرسنلی → ایمیل در `config.json` (یا افزودن `personnel_code` به اعضا
  در فاز بعد برای نگاشت سمت سرور).
- روی شبکهٔ امن/HTTPS اجرا شود.
