import 'dart:convert';
import 'package:http/http.dart' as http;

class GuardConfig {
  final String baseUrl;
  final String slug;
  final String token; // device token, kind = guard

  GuardConfig({required this.baseUrl, required this.slug, required this.token});
}

/// Submit a punch the guard recorded for a given person (by email or code).
/// Returns null on success, or an error message.
Future<String?> submitGuardPunch({
  required GuardConfig cfg,
  required String email,
  required String kind, // in | out
  String? photoDataUri,
}) async {
  final uri = Uri.parse('${cfg.baseUrl}/api/${cfg.slug}/attendance/ingest');
  try {
    final res = await http.post(
      uri,
      headers: {
        'Authorization': 'Bearer ${cfg.token}',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({
        'email': email,
        'kind': kind,
        if (photoDataUri != null) 'photo_url': photoDataUri,
      }),
    );
    if (res.statusCode == 200) return null;
    final body = jsonDecode(res.body);
    return body['error']?.toString() ?? 'خطای سرور (${res.statusCode})';
  } catch (e) {
    return 'خطای شبکه: $e';
  }
}

/// Enroll a face embedding for a member (ثبت چهرهٔ اولیه).
Future<String?> enrollFace({
  required GuardConfig cfg,
  required String email,
  required List<double> embedding,
}) async {
  final uri = Uri.parse('${cfg.baseUrl}/api/${cfg.slug}/attendance/face/enroll');
  try {
    final res = await http.post(uri,
        headers: {
          'Authorization': 'Bearer ${cfg.token}',
          'Content-Type': 'application/json',
        },
        body: jsonEncode({'email': email, 'embedding': embedding}));
    if (res.statusCode == 200) return null;
    return (jsonDecode(res.body)['error']?.toString()) ?? 'خطا (${res.statusCode})';
  } catch (e) {
    return 'خطای شبکه: $e';
  }
}

class IdentifyResult {
  final bool matched;
  final String? name;
  final double score;
  IdentifyResult(this.matched, this.name, this.score);
}

/// Identify a member from a face embedding and optionally auto-punch.
Future<IdentifyResult?> identifyFace({
  required GuardConfig cfg,
  required List<double> embedding,
  String? kind, // in|out for auto-punch
}) async {
  final uri = Uri.parse('${cfg.baseUrl}/api/${cfg.slug}/attendance/face/identify');
  try {
    final res = await http.post(uri,
        headers: {
          'Authorization': 'Bearer ${cfg.token}',
          'Content-Type': 'application/json',
        },
        body: jsonEncode({
          'embedding': embedding,
          if (kind != null) 'kind': kind,
          if (kind != null) 'auto_punch': true,
        }));
    if (res.statusCode != 200) return null;
    final b = jsonDecode(res.body);
    return IdentifyResult(
      b['matched'] == true,
      b['member']?['name']?.toString(),
      (b['score'] is num) ? (b['score'] as num).toDouble() : 0,
    );
  } catch (_) {
    return null;
  }
}
