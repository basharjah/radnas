import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'api.dart';
import '../widgets/bell.dart';

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

/// An account the operator has signed into before, kept so they do not retype it.
///
/// The token is stored with it, which is what makes switching instant — and is also why the whole
/// list lives in the platform keystore, never in shared preferences. A null token means the entry
/// is only a remembered name: signing out empties the token but keeps the row, so coming back is
/// one password instead of a username plus a password.
class SavedAccount {
  final String id, username, role;
  final String? fullName, token;
  const SavedAccount({
    required this.id,
    required this.username,
    required this.role,
    this.fullName,
    this.token,
  });

  String get display => (fullName?.trim().isNotEmpty ?? false) ? fullName!.trim() : username;
  bool get ready => token != null;

  String get roleLabel => switch (role) {
        'owner' => 'مالك المنصّة',
        'admin' => 'شركة',
        _ => 'موزّع',
      };

  Map<String, dynamic> toJson() => {
        'id': id,
        'username': username,
        'role': role,
        'full_name': fullName,
        'token': token,
      };

  factory SavedAccount.fromJson(Map<String, dynamic> j) => SavedAccount(
        id: '${j['id']}',
        username: '${j['username']}',
        role: '${j['role']}',
        fullName: j['full_name'] as String?,
        token: j['token'] as String?,
      );

  SavedAccount withToken(String? t) => SavedAccount(
        id: id, username: username, role: role, fullName: fullName, token: t,
      );
}

/// Who is signed in, and whether we have checked yet.
///
/// `restoring` is a third state on purpose: without it the app flashes the login screen for a
/// moment on every cold start while the keystore read completes, which reads as being signed out.
class Auth extends ChangeNotifier {
  Auth._();
  static final Auth instance = Auth._();

  static const _accountsKey = 'radnas_accounts';

  AppUser? user;
  bool restoring = true;

  /// Every account signed into on this device, most recently used first.
  List<SavedAccount> accounts = const [];

  /// While a switch is being probed, a 401 is an answer about the account being tried — not a
  /// reason to sign the operator out of the one they are still using.
  bool _switching = false;

  bool get signedIn => user != null;

  Future<void> _readAccounts() async {
    try {
      final raw = await Api.instance.readRaw(_accountsKey);
      if (raw == null || raw.isEmpty) return;
      accounts = (jsonDecode(raw) as List)
          .whereType<Map>()
          .map((e) => SavedAccount.fromJson(Map<String, dynamic>.from(e)))
          .toList();
    } catch (_) {
      // A list written by an older build, or a keystore that came back corrupt. Losing the
      // convenience is acceptable; failing to start the app over it is not.
      accounts = const [];
    }
  }

  Future<void> _writeAccounts() async {
    await Api.instance
        .writeRaw(_accountsKey, jsonEncode(accounts.map((a) => a.toJson()).toList()));
  }

  /// Record (or refresh) the signed-in account at the head of the list.
  Future<void> _remember(AppUser u, String? token) async {
    final entry = SavedAccount(
      id: u.id, username: u.username, role: u.role, fullName: u.fullName, token: token,
    );
    accounts = [entry, ...accounts.where((a) => a.id != u.id)];
    await _writeAccounts();
  }

  /// Drop a remembered account entirely. Signing out of the active one is a separate thing.
  Future<void> forget(String id) async {
    accounts = accounts.where((a) => a.id != id).toList();
    await _writeAccounts();
    notifyListeners();
  }

  /// Move to another saved account without a password, when its token is still good.
  ///
  /// Returns null on success, or a message. A stored token that the server has since rejected is
  /// cleared from that entry rather than left to fail again, and the operator is sent back to the
  /// account they were already in — a failed switch must not cost them the session they had.
  Future<String?> switchTo(SavedAccount a) async {
    if (a.token == null) return 'انتهت جلسة هذا الحساب — أدخل كلمة المرور';
    final previous = Api.instance.token;
    _switching = true;
    try {
      await Api.instance.saveToken(a.token!);
      final res = await Api.instance.dio.get('/auth/me');
      if (res.statusCode == 200 && res.data is Map) {
        final d = res.data as Map<String, dynamic>;
        Unread.instance.stop();
        user = AppUser.fromJson((d['user'] as Map<String, dynamic>?) ?? d);
        await _remember(user!, a.token);
        // The account being switched into may have sat unused for weeks; renewing now means it
        // does not expire the moment the operator starts working in it.
        await _renew();
        Unread.instance.start();
        notifyListeners();
        return null;
      }
      accounts = accounts.map((x) => x.id == a.id ? x.withToken(null) : x).toList();
      await _writeAccounts();
      if (previous != null) await Api.instance.saveToken(previous);
      notifyListeners();
      return 'انتهت جلسة هذا الحساب — أدخل كلمة المرور';
    } catch (e) {
      if (previous != null) await Api.instance.saveToken(previous);
      return Api.errorOf(null, e);
    } finally {
      _switching = false;
    }
  }

  /// Called by the 401 interceptor. Ignored mid-switch, for the reason above.
  void onTokenRejected() {
    if (_switching) return;
    logout();
  }

  /// Trade the current token for a fresh one, restarting its clock.
  ///
  /// This is what makes the app stay signed in until the operator actually signs out: a token is
  /// good for thirty days, and every launch (and every return from the background, at most once
  /// every six hours) pushes that thirty days out again. A phone in weekly use never expires.
  ///
  /// Failure is deliberately silent. The token in hand is still valid — it had to be, to reach the
  /// endpoint — so a refresh that could not go through is a network problem, not a session ending.
  Future<void> _renew() async {
    if (Api.instance.token == null) return;
    try {
      final res = await Api.instance.dio.post('/auth/refresh', data: {'device': 'mobile'});
      if (res.statusCode == 200 && res.data is Map && res.data['token'] != null) {
        await Api.instance.saveToken('${res.data['token']}');
        _lastRenew = DateTime.now();
        if (user != null) await _remember(user!, Api.instance.token);
      }
    } catch (_) {
      // Offline, or an older backend without /auth/refresh. Either way the session is unaffected.
    }
  }

  DateTime? _lastRenew;

  /// Called when the app comes back to the foreground. Throttled, because an operator who switches
  /// away and back twenty times an hour does not need twenty tokens.
  Future<void> renewIfStale() async {
    if (!signedIn) return;
    final last = _lastRenew;
    if (last != null && DateTime.now().difference(last) < const Duration(hours: 6)) return;
    await _renew();
  }

  Future<void> restore() async {
    await _readAccounts();
    await Api.instance.loadToken();
    if (Api.instance.token != null) {
      try {
        final res = await Api.instance.dio.get('/auth/me');
        if (res.statusCode == 200 && res.data is Map) {
          final d = res.data as Map<String, dynamic>;
          // /auth/me returns the manager row directly, not wrapped in `user`.
          user = AppUser.fromJson((d['user'] as Map<String, dynamic>?) ?? d);
          // Keeps the list honest across a reinstall or an upgrade from a build that had no list.
          await _remember(user!, Api.instance.token);
          await _renew();
          Unread.instance.start();
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
        // Asks for a phone-length session: thirty days, renewed on every launch. The web client
        // does not send this, so the panel's own session length is untouched.
        'device': 'mobile',
      });
      if (res.statusCode == 200 && res.data is Map && res.data['token'] != null) {
        await Api.instance.saveToken('${res.data['token']}');
        // Zeroed before the new user is set: signing in as a second company while the first one's
        // poller is still running leaves ITS unread count on the bell for up to thirty seconds.
        Unread.instance.stop();
        user = AppUser.fromJson(Map<String, dynamic>.from(res.data['user']));
        _lastRenew = DateTime.now();
        await _remember(user!, Api.instance.token);
        Unread.instance.start();
        notifyListeners();
        return null;
      }
      return Api.errorOf(res);
    } catch (e) {
      return Api.errorOf(null, e);
    }
  }

  /// Sign out of the current account.
  ///
  /// By default the account stays in the list with its token dropped, so the operator returns with
  /// one password instead of a username and a password. `forgetAccount` removes the row too, for
  /// a device that is being handed on.
  Future<void> logout({bool forgetAccount = false}) async {
    // Stopped before the token goes, or the next poll fires with no credential and trips the 401
    // handler into a second logout.
    Unread.instance.stop();
    final id = user?.id;
    await Api.instance.clearToken();
    if (id != null) {
      accounts = forgetAccount
          ? accounts.where((a) => a.id != id).toList()
          : accounts.map((a) => a.id == id ? a.withToken(null) : a).toList();
      await _writeAccounts();
    }
    user = null;
    notifyListeners();
  }
}
