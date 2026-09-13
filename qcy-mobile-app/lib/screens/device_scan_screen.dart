import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/bluetooth_provider.dart';

/// صفحه اسکن و اتصال به دستگاه‌های بلوتوثی
class DeviceScanScreen extends StatefulWidget {
  const DeviceScanScreen({super.key});

  @override
  State<DeviceScanScreen> createState() => _DeviceScanScreenState();
}

class _DeviceScanScreenState extends State<DeviceScanScreen> {
  bool _isScanning = false;

  @override
  Widget build(BuildContext context) {
    final bluetoothProvider = Provider.of<BluetoothProvider>(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('اتصال به ساعت هوشمند'),
        actions: [
          IconButton(
            icon: Icon(_isScanning ? Icons.stop : Icons.refresh),
            onPressed: () async {
              if (_isScanning) {
                bluetoothProvider.stopScan();
                setState(() => _isScanning = false);
              } else {
                setState(() => _isScanning = true);
                await bluetoothProvider.startScan();
                // توقف خودکار بعد از 10 ثانیه
                Future.delayed(const Duration(seconds: 10), () {
                  if (mounted && _isScanning) {
                    bluetoothProvider.stopScan();
                    setState(() => _isScanning = false);
                  }
                });
              }
            },
          ),
        ],
      ),
      body: Column(
        children: [
          // راهنما
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(16),
            color: Colors.blue.shade50,
            child: const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'دستگاه‌های nearby',
                  style: TextStyle(fontWeight: FontWeight.bold),
                ),
                SizedBox(height: 4),
                Text(
                  'مطمئن شوید ساعت هوشمند شما روشن است و در حالت جفت‌سازی قرار دارد.',
                  style: TextStyle(fontSize: 12, color: Colors.grey),
                ),
              ],
            ),
          ),

          // لیست دستگاه‌ها
          Expanded(
            child: _isScanning && bluetoothProvider.availableDevices.isEmpty
                ? const Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        CircularProgressIndicator(),
                        SizedBox(height: 16),
                        Text('در حال جستجوی دستگاه‌ها...'),
                      ],
                    ),
                  )
                : bluetoothProvider.availableDevices.isEmpty
                    ? Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(
                              Icons.bluetooth_searching,
                              size: 64,
                              color: Colors.grey.shade300,
                            ),
                            const SizedBox(height: 16),
                            Text(
                              'دستگاهی یافت نشد',
                              style: TextStyle(color: Colors.grey.shade600),
                            ),
                            const SizedBox(height: 8),
                            ElevatedButton.icon(
                              onPressed: () async {
                                setState(() => _isScanning = true);
                                await bluetoothProvider.startScan();
                              },
                              icon: const Icon(Icons.refresh),
                              label: const Text('جستجوی مجدد'),
                            ),
                          ],
                        ),
                      )
                    : ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: bluetoothProvider.availableDevices.length,
                        itemBuilder: (context, index) {
                          final device = bluetoothProvider.availableDevices[index];
                          return Card(
                            margin: const EdgeInsets.only(bottom: 12),
                            child: ListTile(
                              leading: const Icon(Icons.watch, size: 40),
                              title: Text(device['name']),
                              subtitle: Text(
                                'ID: ${device['id']} • Signal: ${device['rssi']} dBm',
                              ),
                              trailing: ElevatedButton(
                                onPressed: () async {
                                  final success = await bluetoothProvider.connectToDevice(
                                    device['id'],
                                    device['name'],
                                  );
                                  
                                  if (success && mounted) {
                                    Navigator.pop(context);
                                    ScaffoldMessenger.of(context).showSnackBar(
                                      const SnackBar(
                                        content: Text('اتصال با موفقیت انجام شد'),
                                        backgroundColor: Colors.green,
                                      ),
                                    );
                                  } else if (mounted) {
                                    ScaffoldMessenger.of(context).showSnackBar(
                                      const SnackBar(
                                        content: Text('اتصال ناموفق بود'),
                                        backgroundColor: Colors.red,
                                      ),
                                    );
                                  }
                                },
                                child: const Text('اتصال'),
                              ),
                            ),
                          );
                        },
                      ),
          ),
        ],
      ),
    );
  }
}
