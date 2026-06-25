# اپ حضور معدن (Flutter)

اپ اندروید/iOS برای ثبت حضور کارکنان معدن با **سلفی + موقعیت مکانی (GPS)**.
تردد را به API سیمرغ‌کارا می‌فرستد:
`POST /api/<slug>/attendance/ingest`.

## جریان کار
1. کارگزینی در پنل وب یک دستگاه از نوع **«اپ موبایل (معدن)»** می‌سازد و توکن می‌گیرد.
2. کارمند اپ را نصب و در تنظیمات: آدرس سرور، slug، توکن، ایمیل خود را وارد می‌کند.
3. در محل معدن، دکمهٔ **ورود/خروج** → اپ سلفی + GPS می‌گیرد و به سرور می‌فرستد.
4. تردد با `source='mobile'` + عکس + مختصات در کارنامهٔ حضور ثبت می‌شود.

## ساخت و اجرا
نیازمند Flutter SDK (نصب در این محیط نیست — روی دستگاه خودتان):

```bash
cd apps/mine-attendance
flutter pub get
flutter run            # یا: flutter build apk --release
```

### مجوزهای اندروید (`android/app/src/main/AndroidManifest.xml`)
```xml
<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.CAMERA"/>
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>
```

## نکات تولیدی (TODO)
- **ذخیرهٔ عکس**: نسخهٔ فعلی عکس را به‌صورت data-URI در `photo_url` می‌فرستد
  (برای دمو). در تولید، عکس را روی فضای ذخیره‌سازی (S3/MinIO) آپلود و فقط URL
  را بفرستید.
- **Geofence**: بررسی فاصله تا محدودهٔ مجاز معدن در سمت سرور.
- **تشخیص زنده‌بودن چهره (liveness)** برای جلوگیری از تقلب.
- این یک **اسکلت آماده** است؛ روی دستگاه واقعی build/تست شود.
