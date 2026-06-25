import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'api.dart';

void main() => runApp(const GuardApp());

class GuardApp extends StatelessWidget {
  const GuardApp({super.key});
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'نگهبانی سیمرغ',
      locale: const Locale('fa'),
      theme: ThemeData(useMaterial3: true, colorSchemeSeed: Colors.teal),
      home: const Directionality(
        textDirection: TextDirection.rtl,
        child: GateScreen(),
      ),
    );
  }
}

class GateScreen extends StatefulWidget {
  const GateScreen({super.key});
  @override
  State<GateScreen> createState() => _GateScreenState();
}

class _GateScreenState extends State<GateScreen> {
  GuardConfig? _cfg;
  final _email = TextEditingController();
  String _status = '';
  bool _busy = false;

  final _faceDetector = FaceDetector(options: FaceDetectorOptions());

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final p = await SharedPreferences.getInstance();
    final base = p.getString('baseUrl');
    if (base != null) {
      setState(() => _cfg = GuardConfig(
            baseUrl: base,
            slug: p.getString('slug') ?? '',
            token: p.getString('token') ?? '',
          ));
    }
  }

  /// Capture a face photo, verify a face is present (ML Kit), and submit.
  /// NOTE: automatic identification (who is this?) needs a face-embedding
  /// enrollment store; here the guard confirms the person (email/code).
  Future<void> _register(String kind) async {
    if (_cfg == null) return;
    final email = _email.text.trim();
    if (email.isEmpty) {
      setState(() => _status = 'ایمیل/کد فرد را وارد کنید');
      return;
    }
    setState(() {
      _busy = true;
      _status = 'در حال گرفتن چهره…';
    });
    try {
      final shot = await ImagePicker().pickImage(
        source: ImageSource.camera,
        imageQuality: 60,
        maxWidth: 720,
      );
      if (shot == null) {
        setState(() => _status = 'تصویری گرفته نشد');
        return;
      }
      final faces = await _faceDetector.processImage(InputImage.fromFilePath(shot.path));
      if (faces.isEmpty) {
        setState(() => _status = 'چهره‌ای تشخیص داده نشد؛ دوباره تلاش کنید');
        return;
      }
      final bytes = await File(shot.path).readAsBytes();
      final photo = 'data:image/jpeg;base64,${base64Encode(bytes)}';
      final err = await submitGuardPunch(cfg: _cfg!, email: email, kind: kind, photoDataUri: photo);
      setState(() {
        if (err == null) {
          _status = '✓ ${kind == "in" ? "ورود" : "خروج"} ثبت شد برای $email';
          _email.clear();
        } else {
          _status = 'خطا: $err';
        }
      });
    } finally {
      setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    _faceDetector.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_cfg == null) return SettingsScreen(onSaved: _load);
    return Scaffold(
      appBar: AppBar(
        title: const Text('نگهبانی — ثبت تردد'),
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
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            TextField(
              controller: _email,
              decoration: const InputDecoration(
                labelText: 'ایمیل/کد فرد',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 20),
            Row(children: [
              Expanded(child: _btn('ورود + چهره', Colors.green, () => _register('in'))),
              const SizedBox(width: 12),
              Expanded(child: _btn('خروج + چهره', Colors.red, () => _register('out'))),
            ]),
            const SizedBox(height: 20),
            Text(_status, style: const TextStyle(fontSize: 16)),
          ],
        ),
      ),
    );
  }

  Widget _btn(String label, Color c, VoidCallback onTap) => SizedBox(
        height: 64,
        child: ElevatedButton(
          onPressed: _busy ? null : onTap,
          style: ElevatedButton.styleFrom(backgroundColor: c, foregroundColor: Colors.white),
          child: Text(label, style: const TextStyle(fontSize: 16)),
        ),
      );
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

  @override
  void initState() {
    super.initState();
    SharedPreferences.getInstance().then((p) {
      _base.text = p.getString('baseUrl') ?? 'https://';
      _slug.text = p.getString('slug') ?? '';
      _token.text = p.getString('token') ?? '';
      setState(() {});
    });
  }

  Future<void> _save() async {
    final p = await SharedPreferences.getInstance();
    await p.setString('baseUrl', _base.text.trim());
    await p.setString('slug', _slug.text.trim());
    await p.setString('token', _token.text.trim());
    widget.onSaved();
    if (mounted) Navigator.maybePop(context);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('تنظیمات اتصال')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: ListView(children: [
          _f(_base, 'آدرس سرور'),
          _f(_slug, 'شناسهٔ شرکت (slug)'),
          _f(_token, 'توکن دستگاه (نوع: اپ نگهبان)'),
          const SizedBox(height: 16),
          ElevatedButton(onPressed: _save, child: const Text('ذخیره')),
        ]),
      ),
    );
  }

  Widget _f(TextEditingController c, String label) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: TextField(
          controller: c,
          decoration: InputDecoration(labelText: label, border: const OutlineInputBorder()),
        ),
      );
}
