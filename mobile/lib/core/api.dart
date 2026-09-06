import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// The one place that talks to the RadNas backend.
///
/// The panel's 92 REST endpoints are already token-authenticated, so the app needs no server-side
/// work of its own — only the same three conventions the web client follows, kept here so no screen
/// has to remember them.
class Api {
  Api._();
  static final Api instance = Api._();

  /// Overridable at build time so a staging server needs no code change:
  ///   flutter run --dart-define=RADNAS_API=https://staging.example.com/api
  static const String baseUrl =
      String.fromEnvironment('RADNAS_API', defaultValue: 'https://radnas.com/api');

  // The token is a 7-day admin credential for a live ISP, so it goes to the platform keystore
  // (Android Keystore / iOS Keychain) rather than shared preferences, where a device backup or a
  // rooted dump would carry it away. The plugin's defaults already do this.
  static const _storage = FlutterSecureStorage();
  static const _tokenKey = 'radnas_token';

  String? _token;
  String? get token => _token;

  /// Called when the server rejects the token, so the app can return to the login screen from
  /// wherever the failed request happened to be.
  void Function()? onUnauthorized;

  late final Dio dio = Dio(BaseOptions(
    baseUrl: baseUrl,
    connectTimeout: const Duration(seconds: 15),
    receiveTimeout: const Duration(seconds: 30),
    // Let every status through to the interceptor; throwing on 4xx would hide the server's
    // Arabic `message`, which is the only text worth showing the operator.
    validateStatus: (s) => s != null && s < 500,
  ))
    ..interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) {
        if (_token != null) options.headers['Authorization'] = 'Bearer $_token';

        // The managed host's Apache answers DELETE with 405, so the web client tunnels deletes
        // through `POST <path>/delete` and the backend registers matching aliases. The app has to
        // do the same or every delete fails in production while working perfectly against a local
        // server — the kind of difference that only shows up after release.
        if (options.method.toUpperCase() == 'DELETE') {
          options.method = 'POST';
          options.path = '${options.path.replaceAll(RegExp(r'/+$'), '')}/delete';
          options.data ??= <String, dynamic>{};
        }
        handler.next(options);
      },
      onResponse: (res, handler) {
        if (res.statusCode == 401) {
          clearToken();
          onUnauthorized?.call();
        }
        handler.next(res);
      },
    ));

  Future<void> loadToken() async {
    _token = await _storage.read(key: _tokenKey);
  }

  Future<void> saveToken(String t) async {
    _token = t;
    await _storage.write(key: _tokenKey, value: t);
  }

  Future<void> clearToken() async {
    _token = null;
    await _storage.delete(key: _tokenKey);
  }

  /// Pull the server's own Arabic message out of a failed response.
  ///
  /// The backend already writes these for the operator ("لا يمكنك الإسناد لهذا الحساب"), so
  /// replacing them with a generic failure would throw away the most useful sentence available.
  static String errorOf(Response? res, [Object? fallbackError]) {
    final d = res?.data;
    if (d is Map) {
      final m = d['message'] ?? d['error'];
      if (m is String && m.isNotEmpty) return m;
    }
    if (fallbackError is DioException) {
      switch (fallbackError.type) {
        case DioExceptionType.connectionTimeout:
        case DioExceptionType.receiveTimeout:
        case DioExceptionType.sendTimeout:
          return 'انتهت مهلة الاتصال بالخادم';
        case DioExceptionType.connectionError:
          return 'تعذّر الوصول إلى الخادم — تحقّق من اتصالك';
        default:
          break;
      }
    }
    if (res?.statusCode != null) return 'الخادم أجاب ${res!.statusCode}';
    return 'حدث خطأ غير متوقّع';
  }
}
