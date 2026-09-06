import 'package:flutter/foundation.dart';
import 'api.dart';

class AppUser {
  final String id, username, role;
  final String? fullName;
  const AppUser({required this.id, required this.username, required this.role, this.fullName});

  factory AppUser.fromJson(Map<String, dynamic> j) => AppUser(
        id: '${j['id']}',
        username: '${j['username']}',
        role: '${j['role']}',
        fullName: j['full_name'] as String?,
      );

  bool get isOwner => role == 'owner';
  bool get isReseller => role == 'reseller';
  String get display => (fullName?.trim().isNotEmpty ?? false) ? fullName!.trim() : username;
}

/// Who is signed in, and whether we have checked yet.
///
/// `restoring` is a third state on purpose: without it the app flashes the login screen for a
/// moment on every cold start while the keystore read completes, which reads as being signed out.
class Auth extends ChangeNotifier {
  Auth._();
  static final Auth instance = Auth._();

  AppUser? user;
  bool restoring = true;

  bool get signedIn => user != null;

  Future<void> restore() async {
    await Api.instance.loadToken();
    if (Api.instance.token != null) {
      try {
        final res = await Api.instance.dio.get('/auth/me');
        if (res.statusCode == 200 && res.data is Map) {
          final d = res.data as Map<String, dynamic>;
          // /auth/me returns the manager row directly, not wrapped in `user`.
          user = AppUser.fromJson((d['user'] as Map<String, dynamic>?) ?? d);
        }
      } catch (_) {
        // Offline start: keep the stored token rather than signing the operator out for a bad
        // network. A genuinely dead token is caught by the 401 interceptor on the first real call.
      }
    }
    restoring = false;
    notifyListeners();
  }

  /// Returns null on success, or the server's own Arabic message.
  Future<String?> login(String username, String password) async {
    try {
      final res = await Api.instance.dio.post('/auth/login', data: {
        'username': username.trim(),
        'password': password,
      });
      if (res.statusCode == 200 && res.data is Map && res.data['token'] != null) {
        await Api.instance.saveToken('${res.data['token']}');
        user = AppUser.fromJson(Map<String, dynamic>.from(res.data['user']));
        notifyListeners();
        return null;
      }
      return Api.errorOf(res);
    } catch (e) {
      return Api.errorOf(null, e);
    }
  }

  Future<void> logout() async {
    await Api.instance.clearToken();
    user = null;
    notifyListeners();
  }
}
