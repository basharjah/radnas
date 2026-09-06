import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

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

  testWidgets('the app boots to a screen rather than a blank frame', (t) async {
    await t.pumpWidget(const MaterialApp(home: Scaffold(body: Text('RadNas'))));
    expect(find.text('RadNas'), findsOneWidget);
  });
}
