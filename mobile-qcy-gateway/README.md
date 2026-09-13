# 📱 اپلیکیشن موبایل QCY Health Gateway

این اپلیکیشن داده‌های سلامت را از ساعت هوشمند QCY از طریق بلوتوث دریافت کرده و از طریق WiFi به سرور Simorgh-Kara ارسال می‌کند.

## 🔧 پیش‌نیازها

- Node.js 18+
- React Native CLI یا Expo
- گوشی اندروید (نسخه 12+) یا iOS (نسخه 15+)
- ساعت هوشمند QCY با پشتیبانی از بلوتوث BLE

## 📦 نصب

### روش ۱: با React Native CLI

```bash
# کپی کردن پروژه
cd /workspace/mobile-qcy-gateway

# نصب وابستگی‌ها
npm install

# برای اندروید
npx react-native run-android

# برای iOS (فقط مک)
cd ios && pod install && cd ..
npx react-native run-ios
```

### روش ۲: با Expo (ساده‌تر)

```bash
# نصب Expo CLI
npm install -g expo-cli

# ایجاد پروژه جدید با Expo
npx create-expo-app qcy-gateway
cd qcy-gateway

# کپی کردن فایل App.js به پروژه
cp ../mobile-qcy-gateway/App.js ./App.js

# نصب وابستگی‌ها
npm install react-native-ble-plx axios @react-native-async-storage/async-storage

# اجرای پروژه
npx expo start
```

## ⚙️ تنظیمات

فایل `App.js` را باز کنید و مقادیر زیر را تنظیم کنید:

```javascript
const CONFIG = {
  // آدرس سرور Simorgh-Kara (آدرس IP سرور خود را وارد کنید)
  API_URL: 'http://192.168.1.100:3000/api/v1/hrc/health',
  
  // شناسه دستگاه QCY (معمولاً با QCY- شروع می‌شود)
  QCY_DEVICE_NAME: 'QCY-',
  
  // شناسه کارمند
  EMPLOYEE_ID: 'emp-001',
  
  // فاصله ارسال داده‌ها (میلی‌ثانیه)
  SEND_INTERVAL: 5000,
};
```

## 🔑 مجوزهای لازم

### اندروید
در فایل `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.BLUETOOTH" />
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" />
<uses-permission android:name="android.permission.BLUETOOTH_SCAN" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.INTERNET" />
```

برای اندروید 12+ باید targetSdkVersion >= 31 باشد.

### iOS
در فایل `ios/YourApp/Info.plist`:

```xml
<key>NSBluetoothAlwaysUsageDescription</key>
<string>برای اتصال به ساعت هوشمند نیاز به بلوتوث داریم</string>
<key>NSBluetoothPeripheralUsageDescription</key>
<string>برای دریافت داده‌های سلامت به بلوتوث نیاز داریم</string>
<key>NSLocationWhenInUseUsageDescription</key>
<string>برای اسکن دستگاه‌های بلوتوثی نیاز به موقعیت مکانی داریم</string>
```

## 🚀 اجرا

1. اپلیکیشن را روی گوشی نصب کنید
2. بلوتوث گوشی را روشن کنید
3. ساعت QCY را در حالت جفت‌سازی قرار دهید
4. دکمه "اتصال به ساعت QCY" را بزنید
5. پس از اتصال، داده‌ها هر 5 ثانیه به سرور ارسال می‌شوند

## 📊 مشاهده داده‌ها در سرور

پس از ارسال داده‌ها، می‌توانید در داشبورد Simorgh-Kara:

1. به بخش HRC → نقشه شرکت بروید
2. وضعیت سلامت کارکنان را مشاهده کنید
3. هشدارهای سلامت را ببینید

## 🔍 عیب‌یابی

### مشکل در اتصال بلوتوث
- مطمئن شوید بلوتوث گوشی روشن است
- ساعت QCY را از دستگاه‌های جفت‌شده حذف و دوباره جفت کنید
- مجوزهای موقعیت مکانی را بررسی کنید

### مشکل در ارسال به سرور
- مطمئن شوید گوشی و سرور در یک شبکه WiFi هستند
- آدرس IP سرور را در CONFIG بررسی کنید
- فایروال سرور را بررسی کنید

### داده‌ها نمایش داده نمی‌شوند
- لاگ‌های اپلیکیشن را بررسی کنید
- API سرور را تست کنید: `POST /api/v1/hrc/health`
- فرمت داده‌های QCY را با مستندات تطبیق دهید

## 📝 نکات مهم

1. **پروتکل QCY**: فرمت داده‌های ارسالی از ساعت QCY بستگی به مدل دارد. ممکن است نیاز باشد تابع `parseHealthData` را با مستندات دستگاه تطبیق دهید.

2. **امنیت**: در محیط تولید، از HTTPS استفاده کنید و احراز هویت اضافه کنید.

3. **مصرف باتری**: ارسال مکرر داده‌ها مصرف باتری را افزایش می‌دهد. می‌توانید `SEND_INTERVAL` را افزایش دهید.

4. **چندین کارمند**: برای پشتیبانی از چندین کارمند، می‌توانید یک صفحه ورود اضافه کنید تا هر کارمند ID خود را وارد کند.

## 🔄 آپدیت سرور

اگر سرور روی localhost اجرا می‌شود، از آدرس IP واقعی سرور استفاده کنید، نه localhost.

برای پیدا کردن IP سرور:
```bash
# لینوکس/مک
ip addr show

# ویندوز
ipconfig
```

## 📞 پشتیبانی

برای مشکلات فنی با تیم توسعه Simorgh-KARA تماس بگیرید.
