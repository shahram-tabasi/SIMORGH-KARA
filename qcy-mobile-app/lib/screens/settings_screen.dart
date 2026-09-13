import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/health_provider.dart';

/// صفحه تنظیمات اپلیکیشن
class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  final _formKey = GlobalKey<FormState>();
  late TextEditingController _gatewayController;
  late TextEditingController _deviceIdController;

  @override
  void initState() {
    super.initState();
    final healthProvider = Provider.of<HealthProvider>(context, listen: false);
    _gatewayController = TextEditingController(text: healthProvider.gatewayUrl);
    _deviceIdController = TextEditingController(text: healthProvider.deviceId);
  }

  @override
  void dispose() {
    _gatewayController.dispose();
    _deviceIdController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('تنظیمات'),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // بخش تنظیمات سرور
              const Text(
                'تنظیمات سرور',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 16),
              
              TextFormField(
                controller: _gatewayController,
                decoration: const InputDecoration(
                  labelText: 'آدرس گیت‌وی',
                  hintText: 'http://192.168.1.100:3001',
                  prefixIcon: Icon(Icons.server),
                  border: OutlineInputBorder(),
                ),
                validator: (value) {
                  if (value == null || value.isEmpty) {
                    return 'لطفاً آدرس گیت‌وی را وارد کنید';
                  }
                  if (!value.startsWith('http')) {
                    return 'آدرس باید با http یا https شروع شود';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 24),

              // بخش تنظیمات دستگاه
              const Text(
                'تنظیمات دستگاه',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 16),
              
              TextFormField(
                controller: _deviceIdController,
                decoration: const InputDecoration(
                  labelText: 'شناسه دستگاه (Device ID)',
                  hintText: 'qcy_001',
                  prefixIcon: Icon(Icons.watch),
                  border: OutlineInputBorder(),
                ),
                validator: (value) {
                  if (value == null || value.isEmpty) {
                    return 'لطفاً شناسه دستگاه را وارد کنید';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 32),

              // دکمه ذخیره
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: _saveSettings,
                  icon: const Icon(Icons.save),
                  label: const Text('ذخیره تنظیمات'),
                  style: ElevatedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                  ),
                ),
              ),
              const SizedBox(height: 24),

              // اطلاعات درباره
              const Divider(),
              const SizedBox(height: 16),
              
              const Center(
                child: Column(
                  children: [
                    Text(
                      'QCY Health Gateway',
                      style: TextStyle(fontWeight: FontWeight.bold),
                    ),
                    SizedBox(height: 4),
                    Text(
                      'نسخه 1.0.0',
                      style: TextStyle(color: Colors.grey, fontSize: 12),
                    ),
                    SizedBox(height: 16),
                    Text(
                      'اپلیکیشن دریافت داده از ساعت‌های هوشمند QCY\nو ارسال به سامانه سیمرغ‌کارا',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: Colors.grey, fontSize: 12),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _saveSettings() {
    if (_formKey.currentState!.validate()) {
      final healthProvider = Provider.of<HealthProvider>(context, listen: false);
      
      healthProvider.setGatewayUrl(_gatewayController.text);
      healthProvider.setDeviceId(_deviceIdController.text);

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('تنظیمات با موفقیت ذخیره شد'),
          backgroundColor: Colors.green,
        ),
      );

      Navigator.pop(context);
    }
  }
}
