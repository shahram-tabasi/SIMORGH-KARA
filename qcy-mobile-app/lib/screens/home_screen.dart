import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/bluetooth_provider.dart';
import '../providers/health_provider.dart';

/// صفحه اصلی اپلیکیشن - نمایش وضعیت دستگاه و داده‌های سلامت
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _selectedIndex = 0;

  final List<Widget> _screens = [
    const _DashboardTab(),
    const _DevicesTab(),
    const _HistoryTab(),
    const _ProfileTab(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: _screens[_selectedIndex],
      bottomNavigationBar: NavigationBar(
        selectedIndex: _selectedIndex,
        onDestinationSelected: (index) => setState(() => _selectedIndex = index),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.dashboard_outlined),
            selectedIcon: Icon(Icons.dashboard),
            label: 'داشبورد',
          ),
          NavigationDestination(
            icon: Icon(Icons.watch_outlined),
            selectedIcon: Icon(Icons.watch),
            label: 'دستگاه‌ها',
          ),
          NavigationDestination(
            icon: Icon(Icons.history_outlined),
            selectedIcon: Icon(Icons.history),
            label: 'تاریخچه',
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outline),
            selectedIcon: Icon(Icons.person),
            label: 'پروفایل',
          ),
        ],
      ),
    );
  }
}

/// تب داشبورد - نمایش زنده داده‌های سلامت
class _DashboardTab extends StatelessWidget {
  const _DashboardTab();

  @override
  Widget build(BuildContext context) {
    final healthProvider = Provider.of<HealthProvider>(context);
    final bluetoothProvider = Provider.of<BluetoothProvider>(context);

    return RefreshIndicator(
      onRefresh: () async {
        await healthProvider.refreshData();
      },
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // هدر
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text(
                  'وضعیت سلامت',
                  style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
                ),
                IconButton(
                  icon: const Icon(Icons.settings),
                  onPressed: () => Navigator.pushNamed(context, '/settings'),
                ),
              ],
            ),
            const SizedBox(height: 8),
            
            // وضعیت اتصال
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: bluetoothProvider.isConnected
                    ? Colors.green.shade50
                    : Colors.orange.shade50,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: bluetoothProvider.isConnected
                      ? Colors.green
                      : Colors.orange,
                ),
              ),
              child: Row(
                children: [
                  Icon(
                    bluetooth_provider.isConnected
                        ? Icons.bluetooth_connected
                        : Icons.bluetooth_disabled,
                    color: bluetoothProvider.isConnected
                        ? Colors.green
                        : Colors.orange,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          bluetoothProvider.isConnected
                              ? 'متصل به ساعت'
                              : 'عدم اتصال',
                          style: const TextStyle(fontWeight: FontWeight.bold),
                        ),
                        Text(
                          bluetoothProvider.deviceName ?? 'جستجوی دستگاه...',
                          style: TextStyle(
                            fontSize: 12,
                            color: Colors.grey.shade600,
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (!bluetoothProvider.isConnected)
                    ElevatedButton.icon(
                      onPressed: () => Navigator.pushNamed(context, '/scan'),
                      icon: const Icon(Icons.add),
                      label: const Text('اتصال'),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 24),

            // کارت‌های داده سلامت
            GridView.count(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              crossAxisCount: 2,
              mainAxisSpacing: 12,
              crossAxisSpacing: 12,
              childAspectRatio: 1.5,
              children: [
                _HealthCard(
                  title: 'ضربان قلب',
                  value: '${healthProvider.heartRate}',
                  unit: 'bpm',
                  icon: Icons.favorite,
                  color: Colors.red,
                  status: _getHeartRateStatus(healthProvider.heartRate),
                ),
                _HealthCard(
                  title: 'اکسیژن خون',
                  value: '${healthProvider.bloodOxygen}',
                  unit: '%',
                  icon: Icons.air,
                  color: Colors.blue,
                  status: _getSpo2Status(healthProvider.bloodOxygen),
                ),
                _HealthCard(
                  title: 'قدم‌ها',
                  value: '${healthProvider.steps}',
                  unit: 'قدم',
                  icon: Icons.directions_walk,
                  color: Colors.green,
                ),
                _HealthCard(
                  title: 'کالری',
                  value: '${healthProvider.calories}',
                  unit: 'kcal',
                  icon: Icons.local_fire_department,
                  color: Colors.orange,
                ),
              ],
            ),
            const SizedBox(height: 24),

            // دکمه SOS
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: () => _showSOSDialog(context),
                icon: const Icon(Icons.emergency, size: 28),
                label: const Text(
                  'ارسال هشدار اضطراری (SOS)',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                ),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.red,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _getHeartRateStatus(int heartRate) {
    if (heartRate < 50 || heartRate > 120) return 'خطرناک';
    if (heartRate < 60 || heartRate > 100) return 'هشدار';
    return 'نرمال';
  }

  String _getSpo2Status(int spo2) {
    if (spo2 < 90) return 'خطرناک';
    if (spo2 < 95) return 'هشدار';
    return 'نرمال';
  }

  void _showSOSDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('هشدار اضطراری'),
        content: const Text('آیا می‌خواهید هشدار اضطراری ارسال کنید؟'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('انصراف'),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(context);
              // ارسال SOS
              Provider.of<HealthProvider>(context, listen: false).sendSOS();
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text('هشدار اضطراری ارسال شد'),
                  backgroundColor: Colors.red,
                ),
              );
            },
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
            child: const Text('ارسال', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );
  }
}

/// کارت نمایش داده سلامت
class _HealthCard extends StatelessWidget {
  final String title;
  final String value;
  final String unit;
  final IconData icon;
  final Color color;
  final String? status;

  const _HealthCard({
    required this.title,
    required this.value,
    required this.unit,
    required this.icon,
    required this.color,
    this.status,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 2,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Icon(icon, color: color, size: 28),
                if (status != null)
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 4,
                    ),
                    decoration: BoxDecoration(
                      color: status == 'خطرناک'
                          ? Colors.red.shade100
                          : status == 'هشدار'
                              ? Colors.orange.shade100
                              : Colors.green.shade100,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      status!,
                      style: TextStyle(
                        fontSize: 10,
                        color: status == 'خطرناک'
                            ? Colors.red.shade900
                            : status == 'هشدار'
                                ? Colors.orange.shade900
                                : Colors.green.shade900,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
              ],
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  value,
                  style: TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.bold,
                    color: color,
                  ),
                ),
                Row(
                  children: [
                    Text(
                      title,
                      style: TextStyle(
                        fontSize: 12,
                        color: Colors.grey.shade600,
                      ),
                    ),
                    Text(
                      ' • $unit',
                      style: TextStyle(
                        fontSize: 10,
                        color: Colors.grey.shade400,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

// تب‌های دیگر (Devices, History, Profile) به صورت خلاصه
class _DevicesTab extends StatelessWidget {
  const _DevicesTab();

  @override
  Widget build(BuildContext context) {
    return const Center(child: Text('مدیریت دستگاه‌ها'));
  }
}

class _HistoryTab extends StatelessWidget {
  const _HistoryTab();

  @override
  Widget build(BuildContext context) {
    return const Center(child: Text('تاریخچه داده‌های سلامت'));
  }
}

class _ProfileTab extends StatelessWidget {
  const _ProfileTab();

  @override
  Widget build(BuildContext context) {
    return const Center(child: Text('پروفایل کاربری'));
  }
}
