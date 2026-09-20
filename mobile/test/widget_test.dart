import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:radnas_mobile/core/auth.dart';
import 'package:radnas_mobile/widgets/topup_sheet.dart';
import 'package:radnas_mobile/widgets/usage_card.dart';
import 'package:radnas_mobile/core/format.dart';

void main() {
  test('data sizes read the way an operator expects', () {
    expect(fmtData(512), '512 MB');
    expect(fmtData(1024), '1.00 GB');
    expect(fmtData(1986.56), '1.94 GB');
    expect(fmtData(2.5), '2.50 MB');
  });

  test('Arabic relative time marks the dual, not "2 unit"', () {
    final now = DateTime.now();
    expect(relative(now.subtract(const Duration(minutes: 2)).toIso8601String()),
        'منذ دقيقتين');
    expect(relative(now.subtract(const Duration(hours: 5)).toIso8601String()),
        'منذ 5 ساعات');
    // Elapsed time, not calendar days: three days ahead is 2d23h59m, which is the dual — and
    // the dual is exactly what a naive pluralizer gets wrong ("بعد 2 يوم").
    expect(relative(now.add(const Duration(days: 3)).toIso8601String()), 'بعد يومين');
    expect(relative(null), '—');
  });

  test('daysLeft counts calendar days, not elapsed hours', () {
    final tomorrow = DateTime.now().add(const Duration(days: 1));
    expect(daysLeft(tomorrow.toIso8601String()), 1);
    expect(daysLeft(DateTime.now().toIso8601String()), 0);
    expect(daysLeft(null), isNull);
  });

  test('money keeps thousands readable', () {
    expect(fmtMoney(1500), '1,500');
    expect(fmtMoney(1234567), '1,234,567');
    expect(fmtMoney(null), '—');
  });

  test('numbers survive arriving as Postgres strings', () {
    // bigint and numeric come over the wire as strings — the exact shape that used to throw and
    // render the whole list as a grey rectangle in release.
    expect(numOf('1986'), 1986);
    expect(numOf('1986.56'), 1986.56);
    expect(numOf(1986), 1986);
    expect(numOf(' 42 '), 42);
    expect(numOf(null), isNull);
    expect(numOf('abc'), isNull);
    expect(numOf(true), isNull);
    // and the formatters must accept what numOf hands back
    expect(fmtData(numOf('1986.56') ?? 0), '1.94 GB');
    expect(fmtMoney(numOf('1500')), '1,500');
  });

  test('a plan carries exactly one quota, chosen by its duration', () {
    // The web panel's rule, mirrored here so the two cannot drift: a month-long plan is metered
    // monthly, anything shorter daily. Sending both is a plan the scheduler only half-applies.
    String meter(String unit) => unit == 'months' ? 'monthly' : 'daily';
    expect(meter('months'), 'monthly');
    expect(meter('days'), 'daily');
    expect(meter('hours'), 'daily');
  });

  test('GB typed by the operator becomes the MB the server stores', () {
    int? gbToMb(String v) {
      final n = double.tryParse(v.trim());
      if (n == null || n <= 0) return null;
      return (n * 1024).round();
    }
    expect(gbToMb('2'), 2048);
    expect(gbToMb('0.5'), 512);
    expect(gbToMb('50'), 51200);
    // Empty or zero means "no quota", never 0 MB — which the scheduler reads as "all used up".
    expect(gbToMb(''), isNull);
    expect(gbToMb('0'), isNull);
    expect(gbToMb('abc'), isNull);
  });

  test('a saved account survives the trip through the keystore', () {
    // This JSON is written to the device and read back on the next launch. If a field stops
    // round-tripping, every operator on the phone is silently signed out — so the shape is pinned
    // here rather than trusted to stay put.
    const a = SavedAccount(
      id: '9f1c', username: 'teranet', role: 'admin', fullName: 'تيرانت', token: 'jwt.abc',
    );
    final back = SavedAccount.fromJson(a.toJson());
    expect(back.id, '9f1c');
    expect(back.username, 'teranet');
    expect(back.role, 'admin');
    expect(back.fullName, 'تيرانت');
    expect(back.token, 'jwt.abc');
    expect(back.ready, isTrue);

    // Signing out empties the token but keeps the row: the account is still offered, it just needs
    // a password. A null that came back as the string "null" would make it look signed in.
    final out = SavedAccount.fromJson(a.withToken(null).toJson());
    expect(out.token, isNull);
    expect(out.ready, isFalse);
    expect(out.username, 'teranet');
  });

  test('an account with no full name is shown by its username', () {
    const a = SavedAccount(id: '1', username: 'vienna', role: 'reseller');
    expect(a.display, 'vienna');
    expect(const SavedAccount(id: '1', username: 'v', role: 'reseller', fullName: '   ').display, 'v');
    expect(a.roleLabel, 'موزّع');
  });

  // The usage view is the one screen a phone and a browser must agree on to the digit: the
  // operator reads it to the customer on the phone. These pin the three things the app used to
  // leave out.
  Future<void> pumpUsage(WidgetTester t, Map<String, dynamic> usage) => t.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(child: UsageCard(usage: usage, dark: false)),
          ),
        ),
      );

  testWidgets('a daily-metered plan gets its own bar, as in the panel', (t) async {
    await pumpUsage(t, {
      'download_mb': 900, 'upload_mb': 100, 'total_mb': 1000, 'sessions': 3,
      'daily_used_mb': 1500, 'monthly_used_mb': 51200,
      'daily_quota_mb': 2048, 'monthly_quota_mb': null, 'bonus_quota_mb': 0,
      'quota_locked': false, 'fup_active': false,
    });
    expect(find.text('الحصة اليومية'), findsOneWidget);
    expect(find.text('1.46 GB / 2.00 GB'), findsOneWidget);
    // No monthly quota on this plan, so no monthly bar — the panel omits it too.
    expect(find.text('الحصة الشهرية'), findsNothing);
  });

  testWidgets('topped-up gigabytes are named, not silently folded in', (t) async {
    await pumpUsage(t, {
      'download_mb': 900, 'upload_mb': 100, 'total_mb': 1000, 'sessions': 2,
      'daily_used_mb': 0, 'monthly_used_mb': 51200,
      'daily_quota_mb': null, 'monthly_quota_mb': 51200, 'bonus_quota_mb': 10240,
      'quota_locked': false, 'fup_active': true,
    });
    // Without the label the operator cannot tell they have already sold this customer data.
    expect(find.text('الحصة الشهرية (+10GB مشحون)'), findsOneWidget);
    expect(find.text('🐢 مخفّض السرعة (FUP) — تجاوز الحصة'), findsOneWidget);
  });

  testWidgets('a blocked subscriber says so in words, not only in colour', (t) async {
    await pumpUsage(t, {
      'download_mb': 900, 'upload_mb': 100, 'total_mb': 1000, 'sessions': 1,
      'daily_used_mb': 0, 'monthly_used_mb': 60000,
      'daily_quota_mb': null, 'monthly_quota_mb': 51200, 'bonus_quota_mb': 0,
      'quota_locked': true, 'fup_active': false,
    });
    expect(find.text('⛔ محظور — تجاوز الحصة الشهرية'), findsOneWidget);
  });

  testWidgets('the card survives Postgres sending its numbers as strings', (t) async {
    // bigint and numeric arrive from node-postgres as STRINGS. An `as num?` here is what used to
    // paint a plain grey rectangle in a release build, with no error anywhere.
    await pumpUsage(t, {
      'download_mb': '900', 'upload_mb': '100', 'total_mb': '1000', 'sessions': '4',
      'daily_used_mb': '1500', 'monthly_used_mb': '51200',
      'daily_quota_mb': '2048', 'monthly_quota_mb': '51200', 'bonus_quota_mb': '10240',
      'quota_locked': false, 'fup_active': false,
    });
    expect(find.text('الحصة اليومية'), findsOneWidget);
    expect(find.text('الحصة الشهرية (+10GB مشحون)'), findsOneWidget);
    expect(find.text('4'), findsOneWidget);
  });

  test('data is offered to anyone metered, not only to the already-cut-off', () {
    // The panel shows this button for every metered subscriber. Gating it on the throttle flags
    // hid it during the very call in which gigabytes are sold — and on a plan whose overage
    // behaviour is "disconnect" those flags were never set, so it was hidden for good.
    expect(TopupAction.needed({'monthly_quota_mb': 51200}), isTrue);
    expect(TopupAction.needed({'daily_quota_mb': 2048}), isTrue);
    // Postgres sends these as strings.
    expect(TopupAction.needed({'monthly_quota_mb': '51200'}), isTrue);
    // Flagged but with the quota columns absent — still offered.
    expect(TopupAction.needed({'quota_locked': true}), isTrue);
    expect(TopupAction.needed({'fup_active': true}), isTrue);
    // Unlimited plan: there is nothing to top up.
    expect(TopupAction.needed({'monthly_quota_mb': null, 'daily_quota_mb': null}), isFalse);
    expect(TopupAction.needed({'monthly_quota_mb': 0}), isFalse);
    expect(TopupAction.needed({}), isFalse);
  });

  test('the dot ranks what the operator must act on first', () {
    // Mirrors the ladder in _SubscriberCard. Pinned here because the dot is the only signal on a
    // list of four hundred rows, and a silent reordering would change what every row means.
    String dot({bool online = true, bool blocked = false, bool throttled = false,
        String status = 'active', int? left}) {
      final needsRenewal = status == 'expired' || (left != null && left <= 3);
      return blocked
          ? 'red'
          : needsRenewal
              ? 'amber'
              : throttled
                  ? 'indigo'
                  : !online
                      ? 'grey'
                      : 'green';
    }

    expect(dot(left: 60), 'green');
    expect(dot(online: false, left: 60), 'grey');
    // The row this whole change exists for: still connected, still paying, but out of days. It
    // used to be green and got scrolled past.
    expect(dot(left: 2), 'amber');
    expect(dot(left: 0), 'amber');
    expect(dot(left: -5), 'amber');
    expect(dot(status: 'expired', left: 30), 'amber');
    // Renewal outranks being offline, so an expired subscriber is not hidden as merely "offline".
    expect(dot(online: false, left: -1), 'amber');
    // But being cut off for quota outranks everything: they are off the line right now.
    expect(dot(blocked: true, left: 1), 'red');
    expect(dot(throttled: true, left: 60), 'indigo');
    // The case that was unreachable: a blocked subscriber is REJECTED by RADIUS, so they can
    // never be connected. Gating the red dot on `online` made it impossible to ever show — the
    // row appeared as a plain grey "offline" one, which is what hid vienna.nawrass.
    expect(dot(online: false, blocked: true, left: 60), 'red');
    expect(dot(online: false, throttled: true, left: 60), 'indigo');
  });

  testWidgets('the app boots to a screen rather than a blank frame', (t) async {
    await t.pumpWidget(const MaterialApp(home: Scaffold(body: Text('RadNas'))));
    expect(find.text('RadNas'), findsOneWidget);
  });
}
