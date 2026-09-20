import 'package:flutter/foundation.dart';
import 'api.dart';

/// Who is signed in.
///
/// Deliberately thinner than the panel app's version: RadNas Map is a read-only window onto the
/// network, so it carries no saved-account switcher, no notification bell and no role branching.
/// Every screen here shows exactly what the signed-in account is allowed to see, and the server
/// decides that — a reseller opening this app sees their own company's routers and nothing else,
/// without the app having to know what a reseller is.
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

  String get display => (fullName?.trim().isNotEmpty ?? false) ? fullName!.trim() : username;
}

class Auth extends ChangeNotifier {
  Auth._();
  static final Auth instance = Auth._();

  AppUser? user;

  /// A third state, not a bool: without it the login screen flashes on every cold start while the
  /// keystore read completes, which reads to the operator as having been signed out.
  bool restoring = true;

  bool get signedIn => user != null;

  Future<void> restore() async {
    await Api.instance.loadToken();
    if (Api.instance.token != null) {
      try {
        final res = await Api.instance.dio.get('/auth/me');
        if (res.statusCode == 200 && res.data is Map) {
          final d = res.data as Map<String, dynamic>;
          user = AppUser.fromJson((d['user'] as Map<String, dynamic>?) ?? d);
        }
      } catch (_) {
        // Offline start: keep the stored token rather than signing the operator out over a bad
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
