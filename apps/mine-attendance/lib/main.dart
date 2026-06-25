import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:image_picker/image_picker.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'api.dart';

void main() => runApp(const MineApp());

class MineApp extends StatelessWidget {
  const MineApp({super.key});
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'حضور معدن سیمرغ',
      locale: const Locale('fa'),
      theme: ThemeData(useMaterial3: true, colorSchemeSeed: Colors.indigo),
      home: const Directionality(
        textDirection: TextDirection.rtl,
        child: HomeScreen(),
      ),
    );
  }
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  AppConfig? _cfg;
  String _status = '';
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final p = await SharedPreferences.getInstance();
    final base = p.getString('baseUrl');
    if (base != null) {
      setState(() => _cfg = AppConfig(
            baseUrl: base,
            slug: p.getString('slug') ?? '',
            token: p.getString('token') ?? '',
            email: p.getString('email') ?? '',
          ));
    }
  }

  Future<void> _punch(String kind) async {
    if (_cfg == null) return;
    setState(() {
      _busy = true;
      _status = 'در حال ثبت…';
    });
    try {
      // 1) GPS
      final perm = await Geolocator.requestPermission();
      if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) {
        setState(() => _status = 'دسترسی موقعیت رد شد');
        return;
      }
      final pos = await Geolocator.getCurrentPosition();
      // 2) selfie
      final shot = await ImagePicker().pickImage(
        source: ImageSource.camera,
        preferredCameraDevice: CameraDevice.front,
        imageQuality: 50,
        maxWidth: 640,
      );
      String? photo;
      if (shot != null) {
        final bytes = await shot.readAsBytes();
        photo = 'data:image/jpeg;base64,${base64Encode(bytes)}';
      }
      // 3) send
      final err = await submitPunch(
        cfg: _cfg!,
        kind: kind,
        photoDataUri: photo,
        lat: pos.latitude,
        lng: pos.longitude,
      );
      setState(() => _status = err == null
          ? '✓ ${kind == "in" ? "ورود" : "خروج"} ثبت شد'
          : 'خطا: $err');
    } finally {
      setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_cfg == null) {
      return SettingsScreen(onSaved: _load);
    }
    return Scaffold(
      appBar: AppBar(
        title: const Text('حضور معدن'),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings),
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => SettingsScreen(onSaved: _load)),
            ),
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text('کاربر: ${_cfg!.email}'),
            const SizedBox(height: 24),
            _bigButton('ثبت ورود', Colors.green, () => _punch('in')),
            const SizedBox(height: 16),
            _bigButton('ثبت خروج', Colors.red, () => _punch('out')),
            const SizedBox(height: 24),
            Text(_status, style: const TextStyle(fontSize: 16)),
          ],
        ),
      ),
    );
  }

  Widget _bigButton(String label, Color color, VoidCallback onTap) {
    return SizedBox(
      width: double.infinity,
      height: 72,
      child: ElevatedButton(
        onPressed: _busy ? null : onTap,
        style: ElevatedButton.styleFrom(backgroundColor: color, foregroundColor: Colors.white),
        child: Text(label, style: const TextStyle(fontSize: 20)),
      ),
    );
  }
}

class SettingsScreen extends StatefulWidget {
  final VoidCallback onSaved;
  const SettingsScreen({super.key, required this.onSaved});
  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  final _base = TextEditingController();
  final _slug = TextEditingController();
  final _token = TextEditingController();
  final _email = TextEditingController();

  @override
  void initState() {
    super.initState();
    SharedPreferences.getInstance().then((p) {
      _base.text = p.getString('baseUrl') ?? 'https://';
      _slug.text = p.getString('slug') ?? '';
      _token.text = p.getString('token') ?? '';
      _email.text = p.getString('email') ?? '';
      setState(() {});
    });
  }

  Future<void> _save() async {
    final p = await SharedPreferences.getInstance();
    await p.setString('baseUrl', _base.text.trim());
    await p.setString('slug', _slug.text.trim());
    await p.setString('token', _token.text.trim());
    await p.setString('email', _email.text.trim());
    widget.onSaved();
    if (mounted) Navigator.maybePop(context);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('تنظیمات اتصال')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: ListView(
          children: [
            _field(_base, 'آدرس سرور (مثلاً https://app.simorgh.ir)'),
            _field(_slug, 'شناسهٔ شرکت (slug)'),
            _field(_token, 'توکن دستگاه (نوع: اپ موبایل)'),
            _field(_email, 'ایمیل کارمند'),
            const SizedBox(height: 16),
            ElevatedButton(onPressed: _save, child: const Text('ذخیره')),
          ],
        ),
      ),
    );
  }

  Widget _field(TextEditingController c, String label) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: TextField(
          controller: c,
          decoration: InputDecoration(labelText: label, border: const OutlineInputBorder()),
        ),
      );
}
