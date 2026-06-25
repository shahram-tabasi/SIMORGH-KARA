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
