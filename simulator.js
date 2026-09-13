// Health Data Simulator for Docker
// This file is used by docker-compose.yml

const API_URL = process.env.API_URL || 'http://host.docker.internal:3000/api/v1/hrc/health';
const DEVICE_ID = process.env.DEVICE_ID || 'qcy-gateway-01';
const EMPLOYEE_ID = process.env.EMPLOYEE_ID || 'emp-001';

async function sendHealthData() {
  const payload = {
    deviceId: DEVICE_ID,
    employeeId: EMPLOYEE_ID,
    timestamp: new Date().toISOString(),
    metrics: {
      heartRate: Math.floor(Math.random() * (120 - 60) + 60),
      spo2: Math.floor(Math.random() * (100 - 95) + 95),
      temperature: (Math.random() * (37.5 - 36) + 36).toFixed(1),
      steps: Math.floor(Math.random() * 10000)
    },
    location: {
      lat: 35.6892 + (Math.random() * 0.01 - 0.005),
      lng: 51.3890 + (Math.random() * 0.01 - 0.005)
    }
  };

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (response.ok) {
      console.log('✅ Sent:', payload.metrics);
    } else {
      console.error('❌ Error:', response.status);
    }
  } catch (error) {
    console.error('❌ Connection error:', error.message);
  }
}

// ارسال هر 5 ثانیه
setInterval(sendHealthData, 5000);

console.log('🚀 Health simulator started...');
console.log('API URL:', API_URL);
console.log('Device ID:', DEVICE_ID);
console.log('Employee ID:', EMPLOYEE_ID);
