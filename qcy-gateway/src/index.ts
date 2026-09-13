/**
 * QCY Smartwatch Gateway
 * دریافت داده‌های سلامت از ساعت‌های هوشمند QCY و ارسال به سیمرغ‌کارا
 * 
 * این سرویس از طریق بلوتوث به ساعت‌ها متصل شده و داده‌ها را دریافت می‌کند
 */

import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import axios from 'axios';
import winston from 'winston';
import dotenv from 'dotenv';

dotenv.config();

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'gateway.log' })
  ]
});

const app = express();
const PORT = process.env.PORT || 3001;
const SIMORGH_KARA_URL = process.env.SIMORGH_KARA_URL || 'http://localhost:3000';
const API_TOKEN = process.env.API_TOKEN || '';

app.use(cors());
app.use(bodyParser.json());

// ذخیره دستگاه‌های متصل
const connectedDevices = new Map<string, DeviceInfo>();

interface DeviceInfo {
  deviceId: string;
  memberId?: string;
  companyId?: string;
  lastSeen: Date;
  batteryLevel: number;
  isConnected: boolean;
}

interface HealthData {
  deviceId: string;
  heartRate?: number;
  bloodOxygen?: number;
  temperature?: number;
  steps?: number;
  calories?: number;
  stressLevel?: number;
  timestamp: string;
  latitude?: number;
  longitude?: number;
  altitude?: number;
}

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    connectedDevices: connectedDevices.size
  });
});

// دریافت لیست دستگاه‌های متصل
app.get('/devices', (req, res) => {
  const devices = Array.from(connectedDevices.values());
  res.json({
    success: true,
    count: devices.length,
    devices
  });
});

// ثبت دستگاه جدید
app.post('/devices/register', async (req, res) => {
  try {
    const { deviceId, memberId, companyId } = req.body;
    
    if (!deviceId) {
      return res.status(400).json({ success: false, error: 'deviceId is required' });
    }

    const deviceInfo: DeviceInfo = {
      deviceId,
      memberId,
      companyId,
      lastSeen: new Date(),
      batteryLevel: 100,
      isConnected: true
    };

    connectedDevices.set(deviceId, deviceInfo);
    
    logger.info(`Device registered: ${deviceId}`, { memberId, companyId });

    res.json({
      success: true,
      message: 'Device registered successfully',
      device: deviceInfo
    });
  } catch (error) {
    logger.error('Error registering device', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// دریافت داده‌های سلامت از اپلیکیشن موبایل یا ساعت
app.post('/health/data', async (req, res) => {
  try {
    const healthData: HealthData = req.body;

    if (!healthData.deviceId) {
      return res.status(400).json({ success: false, error: 'deviceId is required' });
    }

    // به‌روزرسانی اطلاعات دستگاه
    if (connectedDevices.has(healthData.deviceId)) {
      const device = connectedDevices.get(healthData.deviceId)!;
      device.lastSeen = new Date();
      device.isConnected = true;
    }

    logger.info(`Received health data from ${healthData.deviceId}`, healthData);

    // ارسال داده به سیمرغ‌کارا
    await forwardToSimorghKara(healthData);

    res.json({
      success: true,
      message: 'Health data received and forwarded'
    });
  } catch (error) {
    logger.error('Error processing health data', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// دریافت موقعیت مکانی
app.post('/location', async (req, res) => {
  try {
    const { deviceId, latitude, longitude, altitude, timestamp } = req.body;

    if (!deviceId || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ success: false, error: 'deviceId, latitude, and longitude are required' });
    }

    const locationData = {
      deviceId,
      latitude,
      longitude,
      altitude: altitude || 0,
      timestamp: timestamp || new Date().toISOString()
    };

    logger.info(`Received location from ${deviceId}`, locationData);

    // ارسال به سیمرغ‌کارا
    await axios.post(
      `${SIMORGH_KARA_URL}/api/v1/hrc/location`,
      locationData,
      {
        headers: {
          'Authorization': `Bearer ${API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        timeout: 5000
      }
    ).catch(err => {
      logger.warn('Failed to forward location to Simorgh Kara', err.message);
    });

    res.json({
      success: true,
      message: 'Location received'
    });
  } catch (error) {
    logger.error('Error processing location', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// دریافت هشدار SOS
app.post('/sos', async (req, res) => {
  try {
    const { deviceId, latitude, longitude, timestamp, message } = req.body;

    if (!deviceId) {
      return res.status(400).json({ success: false, error: 'deviceId is required' });
    }

    logger.warn(`SOS alert from ${deviceId}`, { latitude, longitude, message });

    // ارسال هشدار به سیمرغ‌کارا
    await axios.post(
      `${SIMORGH_KARA_URL}/api/v1/hrc/sos`,
      {
        deviceId,
        latitude: latitude || 0,
        longitude: longitude || 0,
        timestamp: timestamp || new Date().toISOString(),
        message: message || 'Emergency button pressed'
      },
      {
        headers: {
          'Authorization': `Bearer ${API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        timeout: 5000
      }
    ).catch(err => {
      logger.error('Failed to forward SOS to Simorgh Kara', err.message);
    });

    res.json({
      success: true,
      message: 'SOS alert received and forwarded'
    });
  } catch (error) {
    logger.error('Error processing SOS', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Heartbeat دستگاه
app.post('/heartbeat', async (req, res) => {
  try {
    const { deviceId, batteryLevel, signalStrength } = req.body;

    if (!deviceId) {
      return res.status(400).json({ success: false, error: 'deviceId is required' });
    }

    if (connectedDevices.has(deviceId)) {
      const device = connectedDevices.get(deviceId)!;
      device.lastSeen = new Date();
      device.batteryLevel = batteryLevel || device.batteryLevel;
      device.isConnected = true;
    }

    // ارسال heartbeat به سیمرغ‌کارا
    await axios.post(
      `${SIMORGH_KARA_URL}/api/v1/hrc/devices/heartbeat`,
      { deviceId, batteryLevel, signalStrength },
      {
        headers: {
          'Authorization': `Bearer ${API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        timeout: 5000
      }
    ).catch(err => {
      logger.warn('Failed to forward heartbeat', err.message);
    });

    res.json({ success: true });
  } catch (error) {
    logger.error('Error processing heartbeat', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

async function forwardToSimorghKara(healthData: HealthData) {
  try {
    await axios.post(
      `${SIMORGH_KARA_URL}/api/[slug]/hrc/ingest`,
      healthData,
      {
        headers: {
          'Authorization': `Bearer ${API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        timeout: 5000
      }
    );
    logger.info('Health data forwarded to Simorgh Kara successfully');
  } catch (error: any) {
    logger.error('Failed to forward health data to Simorgh Kara', {
      error: error.message,
      status: error.response?.status
    });
  }
}

app.listen(PORT, () => {
  logger.info(`QCY Gateway started on port ${PORT}`);
  logger.info(`Simorgh Kara URL: ${SIMORGH_KARA_URL}`);
});
