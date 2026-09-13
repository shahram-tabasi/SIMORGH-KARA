package com.simorghkara.qcybridge

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.*
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.lifecycle.lifecycleScope
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationServices
import com.simorghkara.qcybridge.databinding.ActivityMainBinding
import kotlinx.coroutines.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.*

/**
 * اپلیکیشن QCy Bridge
 * خواندن داده‌های سلامت از ساعت‌های QCY و ارسال به سرور سیمرغ‌کارا
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var bluetoothManager: BluetoothManager
    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private val handler = Handler(Looper.getMainLooper())
    
    // تنظیمات سرور از فایل کانفیگ
    private val baseUrl = "https://your-simorgh-kara-domain.com"
    private val healthEndpoint = "/api/v1/hrc/health"
    private val locationEndpoint = "/api/v1/hrc/location"
    private val deviceToken = "YOUR_DEVICE_TOKEN_HERE"
    
    // داده‌های فعلی
    private var currentHeartRate = 0
    private var currentSpo2 = 0
    private var currentTemperature = 0f
    private var currentSteps = 0
    private var currentBattery = 0
    private var lastLocation: Location? = null
    
    private val TAG = "QCyBridge"
    
    companion object {
        private const val PERMISSION_REQUEST_CODE = 1001
        private const val SYNC_INTERVAL_MS = 30000L // 30 ثانیه
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)
        bluetoothManager = BluetoothManager(this)
        
        setupUI()
        checkPermissions()
    }
    
    private fun setupUI() {
        binding.btnConnect.setOnClickListener {
            if (bluetoothManager.isBluetoothEnabled()) {
                bluetoothManager.scanForDevices()
            } else {
                Toast.makeText(this, "بلوتوث خاموش است", Toast.LENGTH_SHORT).show()
            }
        }
        
        binding.btnSendData.setOnClickListener {
            sendDataToServer()
        }
        
        binding.btnGetLocation.setOnClickListener {
            getCurrentLocation()
        }
    }
    
    private fun checkPermissions() {
        val permissions = mutableListOf<String>()
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                permissions.add(Manifest.permission.BLUETOOTH_CONNECT)
            }
            if (checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) {
                permissions.add(Manifest.permission.BLUETOOTH_SCAN)
            }
        } else {
            if (checkSelfPermission(Manifest.permission.BLUETOOTH) != PackageManager.PERMISSION_GRANTED) {
                permissions.add(Manifest.permission.BLUETOOTH)
            }
            if (checkSelfPermission(Manifest.permission.BLUETOOTH_ADMIN) != PackageManager.PERMISSION_GRANTED) {
                permissions.add(Manifest.permission.BLUETOOTH_ADMIN)
            }
        }
        
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            permissions.add(Manifest.permission.ACCESS_FINE_LOCATION)
        }
        
        if (permissions.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, permissions.toTypedArray(), PERMISSION_REQUEST_CODE)
        }
    }
    
    @SuppressLint("MissingPermission")
    private fun getCurrentLocation() {
        if (ActivityCompat.checkSelfPermission(
                this,
                Manifest.permission.ACCESS_FINE_LOCATION
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        
        fusedLocationClient.lastLocation
            .addOnSuccessListener { location ->
                lastLocation = location
                if (location != null) {
                    binding.tvLocation.text = "مکان: ${location.latitude}, ${location.longitude}"
                    Log.d(TAG, "Location: ${location.latitude}, ${location.longitude}")
                } else {
                    binding.tvLocation.text = "مکان: در حال دریافت..."
                }
            }
    }
    
    private fun sendDataToServer() {
        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val jsonData = createHealthDataJson()
                Log.d(TAG, "Sending data: $jsonData")
                
                val client = OkHttpClient.Builder().build()
                val mediaType = "application/json; charset=utf-8".toMediaType()
                val body = jsonData.toRequestBody(mediaType)
                
                val request = Request.Builder()
                    .url("$baseUrl$healthEndpoint")
                    .post(body)
                    .addHeader("Authorization", "Bearer $deviceToken")
                    .addHeader("Content-Type", "application/json")
                    .build()
                
                val response = client.newCall(request).execute()
                
                withContext(Dispatchers.Main) {
                    if (response.isSuccessful) {
                        binding.tvStatus.text = "وضعیت: داده با موفقیت ارسال شد"
                        Toast.makeText(this@MainActivity, "داده ارسال شد", Toast.LENGTH_SHORT).show()
                    } else {
                        binding.tvStatus.text = "وضعیت: خطا در ارسال - ${response.code}"
                        Toast.makeText(this@MainActivity, "خطا در ارسال", Toast.LENGTH_SHORT).show()
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error sending data", e)
                withContext(Dispatchers.Main) {
                    binding.tvStatus.text = "وضعیت: خطا - ${e.message}"
                }
            }
        }
    }
    
    private fun createHealthDataJson(): String {
        val timestamp = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }.format(Date())
        
        val jsonObject = JSONObject()
        jsonObject.put("device_id", bluetoothManager.connectedDeviceAddress ?: "unknown")
        jsonObject.put("employee_code", binding.etEmployeeCode.text.toString())
        jsonObject.put("timestamp", timestamp)
        
        val metrics = JSONObject()
        metrics.put("heart_rate", currentHeartRate)
        metrics.put("spo2", currentSpo2)
        metrics.put("temperature", currentTemperature)
        metrics.put("steps", currentSteps)
        metrics.put("battery", currentBattery)
        jsonObject.put("metrics", metrics)
        
        val location = JSONObject()
        lastLocation?.let {
            location.put("latitude", it.latitude)
            location.put("longitude", it.longitude)
            location.put("accuracy", it.accuracy)
        }
        jsonObject.put("location", location)
        
        // تعیین وضعیت بر اساس مقادیر
        val status = determineHealthStatus()
        jsonObject.put("status", status)
        
        return jsonObject.toString()
    }
    
    private fun determineHealthStatus(): String {
        return when {
            currentHeartRate > 180 || currentHeartRate < 40 -> "critical"
            currentSpo2 < 90 -> "critical"
            currentHeartRate > 150 || currentHeartRate < 50 -> "warning"
            currentSpo2 < 95 -> "warning"
            else -> "normal"
        }
    }
    
    // مدیریت بلوتوث
    inner class BluetoothManager(private val context: Context) {
        private val bluetoothAdapter: BluetoothAdapter? by lazy {
            val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
            bluetoothManager.adapter
        }
        
        private var bluetoothLeScanner: BluetoothLeScanner? = null
        private var connectedDeviceAddress: String? = null
        private var gatt: BluetoothGatt? = null
        
        val isBluetoothEnabled: Boolean
            get() = bluetoothAdapter?.isEnabled == true
        
        @SuppressLint("MissingPermission")
        fun scanForDevices() {
            if (!isBluetoothEnabled) {
                Log.e(TAG, "Bluetooth not enabled")
                return
            }
            
            bluetoothLeScanner = bluetoothAdapter?.bluetoothLeScanner
            
            val scanCallback = object : ScanCallback() {
                override fun onScanResult(callbackType: Int, result: ScanResult) {
                    val device = result.device
                    val deviceName = device.name ?: ""
                    
                    Log.d(TAG, "Found device: $deviceName (${device.address})")
                    
                    // فیلتر کردن دستگاه‌های QCY
                    if (deviceName.contains("QCY", ignoreCase = true)) {
                        binding.tvDeviceName.text = "دستگاه یافت شد: $deviceName"
                        connectedDeviceAddress = device.address
                        bluetoothLeScanner?.stopScan(this)
                        
                        // اتصال به دستگاه
                        connectToDevice(device)
                    }
                }
                
                override fun onScanFailed(errorCode: Int) {
                    Log.e(TAG, "Scan failed with error: $errorCode")
                }
            }
            
            bluetoothLeScanner?.startScan(scanCallback)
            
            // توقف اسکن بعد از 10 ثانیه
            handler.postDelayed({
                bluetoothLeScanner?.stopScan(scanCallback)
            }, 10000)
        }
        
        @SuppressLint("MissingPermission")
        private fun connectToDevice(device: BluetoothDevice) {
            gatt = device.connectGatt(context, false, object : BluetoothGattCallback() {
                override fun onConnectionStateChange(gatt: BluetoothGatt?, status: Int, newState: Int) {
                    if (newState == BluetoothProfile.STATE_CONNECTED) {
                        Log.d(TAG, "Connected to GATT server")
                        gatt?.discoverServices()
                    } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                        Log.d(TAG, "Disconnected from GATT server")
                    }
                }
                
                override fun onServicesDiscovered(gatt: BluetoothGatt?, status: Int) {
                    if (status == BluetoothGatt.GATT_SUCCESS) {
                        Log.d(TAG, "Services discovered")
                        // اینجا باید سرویس‌ها و کاراکتریستیک‌های خاص QCY را پیدا کنید
                        // هر مدل ساعت QCY کاراکتریستیک‌های متفاوتی دارد
                        setupCharacteristics(gatt)
                    }
                }
                
                override fun onCharacteristicRead(
                    gatt: BluetoothGatt,
                    characteristic: BluetoothGattCharacteristic,
                    value: ByteArray,
                    status: Int
                ) {
                    parseHealthData(value)
                }
                
                override fun onCharacteristicChanged(
                    gatt: BluetoothGatt,
                    characteristic: BluetoothGattCharacteristic,
                    value: ByteArray
                ) {
                    parseHealthData(value)
                }
            })
        }
        
        private fun setupCharacteristics(gatt: BluetoothGatt?) {
            // این بخش بستگی به مدل دقیق ساعت QCY دارد
            // باید UUID سرویس‌ها و کاراکتریستیک‌های سلامت را از مستندات QCY بگیرید
            gatt?.services?.forEach { service ->
                Log.d(TAG, "Service: ${service.uuid}")
                service.characteristics.forEach { char ->
                    Log.d(TAG, "Characteristic: ${char.uuid}")
                    
                    // فعال‌سازی نوتیفیکیشن برای کاراکتریستیک‌های سلامت
                    if (isHealthCharacteristic(char.uuid)) {
                        gatt.setCharacteristicNotification(char, true)
                    }
                }
            }
        }
        
        private fun isHealthCharacteristic(uuid: UUID): Boolean {
            // UUIDهای نمونه برای سنسورهای سلامت
            // باید UUIDهای واقعی QCY را جایگزین کنید
            val healthUUIDs = listOf(
                "00002A37-0000-1000-8000-00805F9B34FB", // Heart Rate Measurement
                "00002A38-0000-1000-8000-00805F9B34FB", // Body Sensor Location
                // اضافه کردن UUIDهای دیگر
            )
            return healthUUIDs.any { it.equals(uuid.toString(), ignoreCase = true) }
        }
        
        private fun parseHealthData(data: ByteArray) {
            // پارس کردن داده‌های باینری دریافتی از ساعت
            // فرمت داده بستگی به مدل ساعت دارد
            try {
                // مثال ساده: فرض می‌کنیم داده‌ها به ترتیب ضربان قلب، اکسیژن، دما هستند
                if (data.size >= 3) {
                    currentHeartRate = data[0].toInt() and 0xFF
                    currentSpo2 = data[1].toInt() and 0xFF
                    currentTemperature = (data[2].toInt() and 0xFF) / 10f
                    
                    withContext(Dispatchers.Main) {
                        binding.tvHeartRate.text = "ضربان قلب: $currentHeartRate bpm"
                        binding.tvSpo2.text = "اکسیژن خون: $currentSpo2%"
                        binding.tvTemperature.text = "دما: $currentTemperature °C"
                    }
                    
                    Log.d(TAG, "Parsed: HR=$currentHeartRate, SpO2=$currentSpo2, Temp=$currentTemperature")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error parsing health data", e)
            }
        }
    }
}
