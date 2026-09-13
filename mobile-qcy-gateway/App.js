/**
 * QCY Health Gateway - اپلیکیشن موبایل
 * 
 * این اپلیکیشن داده‌های سلامت را از ساعت هوشمند QCY از طریق بلوتوث دریافت کرده
 * و از طریق WiFi به سرور Simorgh-Kara ارسال می‌کند.
 * 
 * نحوه استفاده:
 * 1. نصب dependencies: npm install
 * 2. ساخت اپلیکیشن با React Native CLI یا Expo
 * 3. تنظیم API_URL به آدرس سرور خود
 * 4. اجرای اپلیکیشن روی گوشی اندروید یا iOS
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Button,
  Alert,
  Platform,
  PermissionsAndroid,
} from 'react-native';
import BleManager from 'react-native-ble-plx';
import axios from 'axios';

// ============================================
// تنظیمات - این مقادیر را تغییر دهید
// ============================================
const CONFIG = {
  // آدرس سرور Simorgh-Kara
  API_URL: 'http://192.168.1.100:3000/api/v1/hrc/health',
  
  // شناسه دستگاه QCY (از دفترچه راهنما یا اپلیکیشن QCY بگیرید)
  QCY_DEVICE_NAME: 'QCY-',
  QCY_SERVICE_UUID: '0000180d-0000-1000-8000-00805f9b34fb', // Heart Rate Service
  QCY_CHARACTERISTIC_UUID: '00002a37-0000-1000-8000-00805f9b34fb', // Heart Rate Measurement
  
  // شناسه کارمند (می‌تواند از تنظیمات اپلیکیشن گرفته شود)
  EMPLOYEE_ID: 'emp-001',
  
  // فاصله ارسال داده‌ها به سرور (میلی‌ثانیه)
  SEND_INTERVAL: 5000,
};

// ============================================
// کامپوننت اصلی
// ============================================
export default function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [heartRate, setHeartRate] = useState(null);
  const [spo2, setSpo2] = useState(null);
  const [temperature, setTemperature] = useState(null);
  const [lastSent, setLastSent] = useState(null);
  const [status, setStatus] = useState('متصل نیست');

  const bleManager = new BleManager();

  // درخواست مجوزهای بلوتوث برای اندروید
  useEffect(() => {
    requestPermissions();
    return () => {
      bleManager.destroy();
    };
  }, []);

  const requestPermissions = async () => {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ]);
        
        if (
          granted['android.permission.BLUETOOTH_SCAN'] === PermissionsAndroid.RESULTS.GRANTED &&
          granted['android.permission.BLUETOOTH_CONNECT'] === PermissionsAndroid.RESULTS.GRANTED
        ) {
          console.log('مجوزهای بلوتوث دریافت شد');
        } else {
          Alert.alert('خطا', 'مجوزهای بلوتوث لازم است');
        }
      } catch (err) {
        console.warn(err);
      }
    }
  };

  // اتصال به ساعت QCY
  const connectToDevice = async () => {
    try {
      setStatus('در حال جستجو...');
      
      const devices = await bleManager.startDeviceScan(null, null, (error, device) => {
        if (error) {
          console.log(error);
          return;
        }

        if (device && device.name && device.name.startsWith(CONFIG.QCY_DEVICE_NAME)) {
          bleManager.stopDeviceScan();
          connectToDeviceDetails(device);
        }
      });

    } catch (error) {
      Alert.alert('خطا در اتصال', error.message);
      setStatus('خطا در اتصال');
    }
  };

  const connectToDeviceDetails = async (device) => {
    try {
      setStatus(`در حال اتصال به ${device.name}...`);
      
      const connectedDevice = await device.connect();
      await connectedDevice.discoverAllServicesAndCharacteristics();
      
      setIsConnected(true);
      setStatus('متصل شد');
      
      // شروع دریافت داده‌ها
      startReadingData(connectedDevice);
      
    } catch (error) {
      Alert.alert('خطا در جزئیات اتصال', error.message);
      setStatus('خطا در اتصال');
    }
  };

  // خواندن داده‌های سلامت از ساعت
  const startReadingData = async (device) => {
    try {
      device.monitorCharacteristicForService(
        CONFIG.QCY_SERVICE_UUID,
        CONFIG.QCY_CHARACTERISTIC_UUID,
        (error, characteristic) => {
          if (error) {
            console.log(error);
            return;
          }
          
          if (characteristic && characteristic.value) {
            const data = Buffer.from(characteristic.value, 'base64');
            parseHealthData(data);
          }
        }
      );
    } catch (error) {
      console.error('خطا در خواندن داده:', error);
    }
  };

  // تجزیه داده‌های سلامت
  const parseHealthData = (data) => {
    // فرمت داده‌ها بستگی به پروتکل QCY دارد
    // این یک نمونه است - باید با مستندات QCY تطبیق داده شود
    
    try {
      // بایت اول: نوع داده
      // بایت‌های بعدی: مقادیر
      
      if (data.length >= 3) {
        const heartRateValue = data[1]; // ضربان قلب
        setHeartRate(heartRateValue);
        
        // اگر داده‌های بیشتری موجود باشد
        if (data.length >= 5) {
          const spo2Value = data[3]; // اکسیژن خون
          setSpo2(spo2Value);
        }
        
        if (data.length >= 7) {
          const tempValue = data[5] / 10; // دما
          setTemperature(tempValue);
        }
      }
    } catch (error) {
      console.error('خطا در تجزیه داده:', error);
    }
  };

  // ارسال داده‌ها به سرور
  const sendToServer = async () => {
    if (!heartRate) return;
    
    try {
      const payload = {
        deviceId: 'qcy-mobile-gateway-' + CONFIG.EMPLOYEE_ID,
        employeeId: CONFIG.EMPLOYEE_ID,
        timestamp: new Date().toISOString(),
        metrics: {
          heartRate: heartRate,
          spo2: spo2 || null,
          temperature: temperature || null,
          steps: null, // در صورت موجود بودن
        },
        location: {
          lat: null, // می‌توان از GPS گوشی گرفت
          lng: null,
        },
      };

      await axios.post(CONFIG.API_URL, payload, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 5000,
      });

      setLastSent(new Date());
      console.log('داده‌ها ارسال شد:', payload);
    } catch (error) {
      console.error('خطا در ارسال به سرور:', error.message);
    }
  };

  // ارسال دوره‌ای داده‌ها
  useEffect(() => {
    if (isConnected && heartRate) {
      const interval = setInterval(sendToServer, CONFIG.SEND_INTERVAL);
      return () => clearInterval(interval);
    }
  }, [isConnected, heartRate]);

  // قطع اتصال
  const disconnect = async () => {
    try {
      await bleManager.cancelDeviceConnection();
      setIsConnected(false);
      setStatus('متصل نیست');
      setHeartRate(null);
      setSpo2(null);
      setTemperature(null);
    } catch (error) {
      console.error('خطا در قطع اتصال:', error);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🔗 درگاه سلامت QCY</Text>
      
      <View style={styles.statusContainer}>
        <Text style={styles.statusText}>وضعیت: {status}</Text>
      </View>

      {!isConnected ? (
        <Button title="اتصال به ساعت QCY" onPress={connectToDevice} />
      ) : (
        <Button title="قطع اتصال" onPress={disconnect} color="#ff4444" />
      )}

      <View style={styles.dataContainer}>
        <Text style={styles.dataLabel}>💓 ضربان قلب:</Text>
        <Text style={styles.dataValue}>
          {heartRate ? `${heartRate} bpm` : '--'}
        </Text>
        
        <Text style={styles.dataLabel}>🩸 اکسیژن خون:</Text>
        <Text style={styles.dataValue}>
          {spo2 ? `${spo2}%` : '--'}
        </Text>
        
        <Text style={styles.dataLabel}>🌡️ دما:</Text>
        <Text style={styles.dataValue}>
          {temperature ? `${temperature}°C` : '--'}
        </Text>
      </View>

      {lastSent && (
        <Text style={styles.lastSent}>
          آخرین ارسال: {lastSent.toLocaleTimeString('fa-IR')}
        </Text>
      )}

      <View style={styles.infoContainer}>
        <Text style={styles.infoText}>
          📱 این اپلیکیشن داده‌ها را از ساعت QCY گرفته و به سرور ارسال می‌کند
        </Text>
        <Text style={styles.infoText}>
          🌐 آدرس سرور: {CONFIG.API_URL}
        </Text>
      </View>
    </View>
  );
}

// ============================================
// استایل‌ها
// ============================================
const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20,
    marginTop: 40,
  },
  statusContainer: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
    alignItems: 'center',
  },
  statusText: {
    fontSize: 16,
    fontWeight: '600',
  },
  dataContainer: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 10,
    marginTop: 20,
  },
  dataLabel: {
    fontSize: 16,
    marginTop: 10,
    color: '#666',
  },
  dataValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  lastSent: {
    textAlign: 'center',
    marginTop: 20,
    color: '#888',
  },
  infoContainer: {
    marginTop: 30,
    padding: 15,
    backgroundColor: '#e3f2fd',
    borderRadius: 10,
  },
  infoText: {
    fontSize: 12,
    color: '#1976d2',
    marginBottom: 5,
  },
});
