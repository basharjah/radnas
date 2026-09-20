import 'package:flutter_test/flutter_test.dart';
import 'package:radnas_portal/core.dart';

void main() {
  test('numbers survive arriving as Postgres strings', () {
    expect(numOf('1986'), 1986);
    expect(numOf('1986.56'), 1986.56);
    expect(numOf(null), isNull);
    expect(fmtData(numOf('1986.56') ?? 0), '1.94 GB');
  });

  test('Arabic days mark the dual', () {
    expect(daysLabel(1), 'يوم واحد');
    expect(daysLabel(2), 'يومان');
    expect(daysLabel(5), '5 أيام');
    expect(daysLabel(21), '21 يوماً');
  });

  test('daysLeft counts calendar days', () {
    expect(daysLeft(DateTime.now().add(const Duration(days: 1)).toIso8601String()), 1);
    expect(daysLeft(DateTime.now().toIso8601String()), 0);
    expect(daysLeft(null), isNull);
  });
}
