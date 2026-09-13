import 'package:flutter/material.dart';
import 'dart:convert';
import 'package:http/http.dart' as http;

/// ارائه‌دهنده داده‌های سلامت و ارتباط با سرور
class HealthProvider extends ChangeNotifier {
  int _heartRate = 75;
  int _bloodOxygen = 98;
  int _steps = 0;
  int _calories = 0;
  double? _temperature;
  int? _stressLevel;
  DateTime? _lastUpdate;

  // تنظیمات سرور
  String _gatewayUrl = 'http://192.168.1.100:3001';
  String _deviceId = '';

  int get heartRate => _heartRate;
  int get bloodOxygen => _bloodOxygen;
  int get steps => _steps;
  int get calories => _calories;
  double? get temperature => _temperature;
  int? get stressLevel => _stressLevel;
  DateTime? get lastUpdate => _lastUpdate;
  String get gatewayUrl => _gatewayUrl;
  String get deviceId => _deviceId;

  HealthProvider() {
    // شروع دریافت داده‌ها هر 5 ثانیه
    _startHealthMonitoring();
  }

  /// شروع پایش زنده سلامت
  void _startHealthMonitoring() {
    // در نسخه واقعی: دریافت داده از ساعت через بلوتوث
    // اینجا شبیه‌سازی می‌کنیم
    Future.delayed(const Duration(seconds: 5), () {
      _simulateHealthData();
      _startHealthMonitoring();
    });
  }

  /// شبیه‌سازی داده‌های سلامت (در نسخه واقعی از ساعت خوانده می‌شود)
  void _simulateHealthData() {
    final random = DateTime.now().millisecond;
    
    _heartRate = 70 + (random % 30); // 70-100
    _bloodOxygen = 95 + (random % 5); // 95-100
    _steps += (random % 10);
    _calories += (random % 5);
    _temperature = 36.5 + (random % 10) / 10;
    _stressLevel = random % 100;
    _lastUpdate = DateTime.now();

    notifyListeners();

    // ارسال به گیت‌وی
    _sendHealthData();
  }

  /// به‌روزرسانی دستی داده‌ها
  Future<void> refreshData() async {
    _simulateHealthData();
  }

  /// ارسال داده سلامت به گیت‌وی
  Future<void> _sendHealthData() async {
    if (_deviceId.isEmpty) return;

    try {
      final response = await http.post(
        Uri.parse('$_gatewayUrl/health/data'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'deviceId': _deviceId,
          'heartRate': _heartRate,
          'bloodOxygen': _bloodOxygen,
          'steps': _steps,
          'calories': _calories,
          'temperature': _temperature,
          'stressLevel': _stressLevel,
          'timestamp': DateTime.now().toIso8601String(),
        }),
      );

      if (response.statusCode == 200) {
        debugPrint('Health data sent successfully');
      }
    } catch (e) {
      debugPrint('Error sending health data: $e');
    }
  }

  /// ارسال هشدار SOS
  Future<void> sendSOS() async {
    if (_deviceId.isEmpty) return;

    try {
      final response = await http.post(
        Uri.parse('$_gatewayUrl/sos'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'deviceId': _deviceId,
          'timestamp': DateTime.now().toIso8601String(),
          'message': 'Emergency button pressed from mobile app',
        }),
      );

      if (response.statusCode == 200) {
        debugPrint('SOS sent successfully');
      }
    } catch (e) {
      debugPrint('Error sending SOS: $e');
    }
  }

  /// تنظیم آدرس گیت‌وی
  void setGatewayUrl(String url) {
    _gatewayUrl = url;
    notifyListeners();
  }

  /// تنظیم ID دستگاه
  void setDeviceId(String id) {
    _deviceId = id;
    notifyListeners();
  }

  /// پاک کردن داده‌ها
  void clearData() {
    _heartRate = 0;
    _bloodOxygen = 0;
    _steps = 0;
    _calories = 0;
    _temperature = null;
    _stressLevel = null;
    _lastUpdate = null;
    notifyListeners();
  }
}
