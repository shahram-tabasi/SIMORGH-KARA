/**
 * شبیه‌ساز داده‌های سلامت ساعت هوشمند QCY
 * این اسکریپت داده‌های مصنوعی تولید کرده و به گیت‌وی ارسال می‌کند
 */

const axios = require('axios');

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3001';
const SIMULATION_INTERVAL = parseInt(process.env.SIMULATION_INTERVAL) || 5000;
const DEVICE_COUNT = parseInt(process.env.DEVICE_COUNT) || 5;

// دستگاه‌های شبیه‌سازی شده
const devices = [];

for (let i = 1; i <= DEVICE_COUNT; i++) {
  devices.push({
    deviceId: `qcy_sim_${String(i).padStart(3, '0')}`,
    memberId: `member_${i}`,
    companyId: 'company_001',
    heartRate: 70 + Math.floor(Math.random() * 30),
    bloodOxygen: 95 + Math.floor(Math.random() * 5),
    temperature: 36.5 + (Math.random() * 1),
    steps: Math.floor(Math.random() * 5000),
    calories: Math.floor(Math.random() * 500),
    stressLevel: Math.floor(Math.random() * 100),
    latitude: 35.6892 + (Math.random() - 0.5) * 0.01,
    longitude: 51.3890 + (Math.random() - 0.5) * 0.01,
  });
}

console.log(`🚀 شروع شبیه‌ساز با ${DEVICE_COUNT} دستگاه`);
console.log(`📡 آدرس گیت‌وی: ${GATEWAY_URL}`);
console.log(`⏱️ فاصله ارسال: ${SIMULATION_INTERVAL} میلی‌ثانیه\n`);

// ثبت دستگاه‌ها
async function registerDevices() {
  for (const device of devices) {
    try {
      await axios.post(`${GATEWAY_URL}/devices/register`, {
        deviceId: device.deviceId,
        memberId: device.memberId,
        companyId: device.companyId,
      });
      console.log(`✅ دستگاه ثبت شد: ${device.deviceId}`);
    } catch (error) {
      console.error(`❌ خطا در ثبت دستگاه ${device.deviceId}:`, error.message);
    }
  }
}

// تولید و ارسال داده سلامت
function simulateHealthData() {
  devices.forEach(async (device) => {
    // تغییر جزئی در داده‌ها برای طبیعی‌تر شدن
    device.heartRate += Math.floor(Math.random() * 5) - 2;
    device.heartRate = Math.max(60, Math.min(120, device.heartRate));
    
    device.bloodOxygen += Math.floor(Math.random() * 3) - 1;
    device.bloodOxygen = Math.max(92, Math.min(100, device.bloodOxygen));
    
    device.temperature += (Math.random() * 0.2) - 0.1;
    device.temperature = Math.max(36.0, Math.min(37.5, device.temperature));
    
    device.steps += Math.floor(Math.random() * 20);
    device.calories += Math.floor(Math.random() * 5);
    device.stressLevel = Math.floor(Math.random() * 100);

    // تغییر موقعیت مکانی جزئی
    device.latitude += (Math.random() - 0.5) * 0.0001;
    device.longitude += (Math.random() - 0.5) * 0.0001;

    const healthData = {
      deviceId: device.deviceId,
      heartRate: device.heartRate,
      bloodOxygen: device.bloodOxygen,
      temperature: parseFloat(device.temperature.toFixed(1)),
      steps: device.steps,
      calories: device.calories,
      stressLevel: device.stressLevel,
      timestamp: new Date().toISOString(),
      latitude: device.latitude,
      longitude: device.longitude,
    };

    try {
      await axios.post(`${GATEWAY_URL}/health/data`, healthData);
      
      const status = getHealthStatus(device);
      console.log(
        `📊 [${new Date().toLocaleTimeString()}] ${device.deviceId}: ` +
        `❤️ ${device.heartRate} bpm | 💨 ${device.bloodOxygen}% | 🌡️ ${device.temperature}°C | ${status}`
      );
    } catch (error) {
      console.error(`❌ خطا در ارسال داده از ${device.deviceId}:`, error.message);
    }
  });
}

// تعیین وضعیت سلامت
function getHealthStatus(device) {
  if (device.heartRate > 110 || device.heartRate < 65) return '⚠️ هشدار ضربان قلب';
  if (device.bloodOxygen < 94) return '⚠️ هشدار اکسیژن';
  if (device.temperature > 37.2) return '⚠️ هشدار دما';
  if (device.stressLevel > 80) return '⚠️ استرس بالا';
  return '✅ نرمال';
}

// ارسال heartbeat
async function sendHeartbeat() {
  devices.forEach(async (device) => {
    try {
      await axios.post(`${GATEWAY_URL}/heartbeat`, {
        deviceId: device.deviceId,
        batteryLevel: 70 + Math.floor(Math.random() * 30),
        signalStrength: -50 - Math.floor(Math.random() * 30),
      });
    } catch (error) {
      // نادیده گرفتن خطاهای heartbeat
    }
  });
}

// اجرای اصلی
async function main() {
  // صبر برای آماده بودن گیت‌وی
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // ثبت دستگاه‌ها
  await registerDevices();
  
  // ارسال heartbeat هر 30 ثانیه
  setInterval(sendHeartbeat, 30000);
  
  // ارسال داده سلامت در بازه مشخص شده
  simulateHealthData(); // اولین ارسال بلافاصله
  setInterval(simulateHealthData, SIMULATION_INTERVAL);
}

main().catch(console.error);
