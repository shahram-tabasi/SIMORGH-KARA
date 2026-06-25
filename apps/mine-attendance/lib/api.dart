import 'dart:convert';
import 'package:http/http.dart' as http;

class AppConfig {
  final String baseUrl; // e.g. https://app.simorgh.ir
  final String slug; // tenant slug, e.g. aahangari-demo
  final String token; // device token (kind = mobile)
  final String email; // the employee's e-mail (identifies the member)

  AppConfig({
    required this.baseUrl,
    required this.slug,
    required this.token,
    required this.email,
  });
}

/// POST a punch to the Simorgh ingest endpoint with optional selfie + GPS.
/// Returns null on success, or an error message.
Future<String?> submitPunch({
  required AppConfig cfg,
  required String kind, // 'in' | 'out'
  String? photoDataUri, // data:image/jpeg;base64,…  (production: upload + URL)
  double? lat,
  double? lng,
}) async {
  final uri = Uri.parse(
    '${cfg.baseUrl}/api/${cfg.slug}/attendance/ingest',
  );
  try {
    final res = await http.post(
      uri,
      headers: {
        'Authorization': 'Bearer ${cfg.token}',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({
        'email': cfg.email,
        'kind': kind,
        if (photoDataUri != null) 'photo_url': photoDataUri,
        if (lat != null) 'lat': lat,
        if (lng != null) 'lng': lng,
      }),
    );
    if (res.statusCode == 200) return null;
    final body = jsonDecode(res.body);
    return body['error']?.toString() ?? 'خطای سرور (${res.statusCode})';
  } catch (e) {
    return 'خطای شبکه: $e';
  }
}
