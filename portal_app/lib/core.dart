import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Everything the subscriber app needs that is not a screen.
///
/// It is one file on purpose. The whole app is a login and one account page against two endpoints;
/// splitting that across a folder tree would be structure for its own sake.

// ── الألوان ──────────────────────────────────────────────────────────────────
/// The panel's palette, so a subscriber who has seen their ISP's branding recognises it.
class C {
  static const brand = Color(0xFF2563EB);
  static const cyan = Color(0xFF06B6D4);
  static const ok = Color(0xFF16A34A);
  static const bad = Color(0xFFDC2626);
  static const warn = Color(0xFFD97706);

  static const bg = Color(0xFFEEF2F8);
  static const card = Color(0xFFFFFFFF);
  static const ink = Color(0xFF0F1B2D);
  static const dim = Color(0xFF64748B);
  static const line = Color(0xFFE3E9F2);

  static const bgD = Color(0xFF0D1117);
  static const cardD = Color(0xFF161B22);
  static const inkD = Color(0xFFE6EDF3);
  static const dimD = Color(0xFF8B98A9);
  static const lineD = Color(0xFF283040);
}

ThemeData buildTheme(Brightness b) {
  final dark = b == Brightness.dark;
  return ThemeData(
    useMaterial3: true,
    brightness: b,
    scaffoldBackgroundColor: dark ? C.bgD : C.bg,
    colorScheme: ColorScheme.fromSeed(
      seedColor: C.brand,
      brightness: b,
      primary: C.brand,
      surface: dark ? C.cardD : C.card,
    ),
    cardTheme: CardThemeData(
      color: dark ? C.cardD : C.card,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: dark ? C.lineD : C.line),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: dark ? C.cardD : C.card,
      contentPadding: const EdgeInsets.symmetric(horizontal: 15, vertical: 15),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(13),
        borderSide: BorderSide(color: dark ? C.lineD : C.line),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(13),
        borderSide: BorderSide(color: dark ? C.lineD : C.line),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(13),
        borderSide: const BorderSide(color: C.brand, width: 1.6),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: C.brand,
        foregroundColor: Colors.white,
        minimumSize: const Size.fromHeight(52),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(13)),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
      ),
    ),
  );
}

// ── التنسيق ──────────────────────────────────────────────────────────────────
/// Postgres returns bigint and numeric as strings, so a plain cast throws and — in a release
/// build — paints a grey rectangle with no message. Everything numeric goes through here.
num? numOf(dynamic v) {
  if (v == null) return null;
  if (v is num) return v;
  if (v is String) return num.tryParse(v.trim());
  return null;
}

String fmtData(num mb) {
  if (mb >= 1024) return '${(mb / 1024).toStringAsFixed(2)} GB';
  if (mb < 10) return '${mb.toStringAsFixed(2)} MB';
  return '${mb.round()} MB';
}

String fmtDate(String? iso) {
  final d = DateTime.tryParse(iso ?? '');
  if (d == null) return '—';
  final l = d.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${l.year}-${two(l.month)}-${two(l.day)}';
}

/// Calendar days until expiry — negative once past.
int? daysLeft(String? iso) {
  final d = DateTime.tryParse(iso ?? '');
  if (d == null) return null;
  final n = DateTime.now();
  return DateTime(d.toLocal().year, d.toLocal().month, d.toLocal().day)
      .difference(DateTime(n.year, n.month, n.day))
      .inDays;
}

/// Arabic marks the dual, so "2 أيام" is wrong. Written out rather than pluralised generically.
String daysLabel(int n) {
  if (n == 1) return 'يوم واحد';
  if (n == 2) return 'يومان';
  if (n <= 10) return '$n أيام';
  return '$n يوماً';
}

// ── الاتصال بالخادم ──────────────────────────────────────────────────────────
class Api extends ChangeNotifier {
  Api._();
  static final Api instance = Api._();

  static const String baseUrl =
      String.fromEnvironment('RADNAS_API', defaultValue: 'https://radnas.com/api/portal');

  static const _store = FlutterSecureStorage();
  static const _key = 'radnas_portal_token';

  String? _token;
  Map<String, dynamic>? user;
  bool restoring = true;
  bool get signedIn => _token != null;

  late final Dio dio = Dio(BaseOptions(
    baseUrl: baseUrl,
    connectTimeout: const Duration(seconds: 15),
    receiveTimeout: const Duration(seconds: 25),
    validateStatus: (s) => s != null && s < 500,
  ))
    ..interceptors.add(InterceptorsWrapper(
      onRequest: (o, h) {
        if (_token != null) o.headers['Authorization'] = 'Bearer $_token';
        h.next(o);
      },
      onResponse: (r, h) {
        // Only a genuinely dead token gets here now: the session is renewed on every launch, so
        // reaching this point means the subscriber has been away for a month or was removed.
        if (r.statusCode == 401) logout();
        h.next(r);
      },
    ));

  Future<void> restore() async {
    _token = await _store.read(key: _key);
    if (_token != null) await _renew();
    restoring = false;
    notifyListeners();
  }

  /// Swap the stored token for a fresh one so the subscriber stays signed in.
  ///
  /// A subscriber checks this app when something is wrong with their line — which may be weeks
  /// apart. Being asked for a password at exactly that moment, when they are already annoyed and
  /// the password is one their ISP set for them, is how an app stops being used. Thirty days,
  /// renewed on every launch, means they simply never see it again after the first time.
  ///
  /// Silence on failure is deliberate: the token in hand is still good, so a failed renewal is a
  /// network problem and nothing more.
  Future<void> _renew() async {
    try {
      final r = await dio.post('/refresh', data: {'device': 'mobile'});
      if (r.statusCode == 200 && r.data is Map && r.data['token'] != null) {
        _token = '${r.data['token']}';
        await _store.write(key: _key, value: _token);
        _lastRenew = DateTime.now();
      }
    } catch (_) {
      // Offline, or a backend without /refresh yet. The existing session carries on either way.
    }
  }

  DateTime? _lastRenew;

  /// Called when the app returns to the foreground, throttled so switching apps does not mint a
  /// token each time.
  Future<void> renewIfStale() async {
    if (_token == null) return;
    final last = _lastRenew;
    if (last != null && DateTime.now().difference(last) < const Duration(hours: 6)) return;
    await _renew();
  }

  /// Returns null on success, or a message in the subscriber's language.
  Future<String?> login(String username, String password) async {
    try {
      final r = await dio.post('/login', data: {
        'username': username.trim(),
        'password': password,
        // A phone-length session: thirty days, pushed out again on every launch.
        'device': 'mobile',
      });
      if (r.statusCode == 200 && r.data is Map && r.data['token'] != null) {
        _token = '${r.data['token']}';
        user = r.data['user'] is Map ? Map<String, dynamic>.from(r.data['user']) : null;
        await _store.write(key: _key, value: _token);
        _lastRenew = DateTime.now();
        notifyListeners();
        return null;
      }
      if (r.statusCode == 401) return 'اسم المستخدم أو كلمة المرور غير صحيحة';
      return 'تعذّر تسجيل الدخول — حاول مرّة أخرى';
    } on DioException catch (e) {
      return e.type == DioExceptionType.connectionError
          ? 'لا اتصال بالإنترنت'
          : 'تعذّر الوصول إلى الخادم';
    }
  }

  Future<void> logout() async {
    _token = null;
    user = null;
    await _store.delete(key: _key);
    notifyListeners();
  }
}
