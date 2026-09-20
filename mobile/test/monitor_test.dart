import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:radnas_mobile/core/api.dart';
import 'package:radnas_mobile/screens/monitor_screen.dart';
import 'package:radnas_mobile/screens/device_screen.dart';

/// The monitoring screens, driven with the exact payloads the live server returns.
///
/// Written because the screens could not otherwise be exercised without a password, and because
/// the one class of bug that has repeatedly reached release in this app is invisible to the
/// analyser: Postgres hands back `bigint` and `numeric` as JSON STRINGS, and a screen that assumes
/// numbers renders as a blank grey rectangle in a release build with no error anywhere.
///
/// So every numeric field below is deliberately a string, exactly as the server sends it.

/// Answers canned JSON for the monitor endpoints, so no network and no token are involved.
class _FakeAdapter implements HttpClientAdapter {
  final Map<String, Object> routes;
  final List<String> seen = [];
  _FakeAdapter(this.routes);

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? _, Future<void>? __) async {
    seen.add(options.path);
    final key = routes.keys.firstWhere(
      (k) => options.path.startsWith(k),
      orElse: () => '',
    );
    if (key.isEmpty) {
      return ResponseBody.fromString('{"error":"not_found"}', 404,
          headers: {Headers.contentTypeHeader: [Headers.jsonContentType]});
    }
    return ResponseBody.fromString(jsonEncode(routes[key]), 200,
        headers: {Headers.contentTypeHeader: [Headers.jsonContentType]});
  }

  @override
  void close({bool force = false}) {}
}

/// One healthy router and one that stopped answering — the two states that matter, and the pair
/// most likely to break a layout, because the dead one has nulls where the vitals should be.
const _deviceList = [
    {
      'id': 'aaaaaaaa-0000-0000-0000-000000000001',
      'nasname': '10.10.13.2',
      'shortname': 'Aldobal',
      'company': 'NEZARALDIABAL',
      'status': 'down',
      'last_error': 'لا يستجيب',
      'down_since': '2026-09-18T09:07:47.000Z',
      'last_seen_at': null,
      'identity': null,
      'board': null,
      'os_version': null,
      'cpu_load': null,
      'free_memory': null,
      'total_memory': null,
      'uptime_sec': null,
      'rx_bps': null,
      'tx_bps': null,
    },
    {
      'id': 'aaaaaaaa-0000-0000-0000-000000000002',
      'nasname': '10.10.10.2',
      'shortname': 'RB5009',
      'company': 'teranet',
      'status': 'up',
      'last_error': null,
      'down_since': null,
      'last_seen_at': '2026-09-18T12:00:00.000Z',
      'identity': 'main base',
      'board': 'RB5009UG+S+',
      'os_version': '7.23 (stable)',
      'cpu_load': 13,
      // bigint → string, as node-postgres actually sends it.
      'free_memory': '805306368',
      'total_memory': '1073741824',
      'uptime_sec': '17280',
      'rx_bps': '12500000',
      'tx_bps': '3400000',
    },
];

const _devices = {
  'data': _deviceList,
  'totals': {'devices': 2, 'up': 1, 'down': 1, 'unknown': 0},
};

void main() {
  late _FakeAdapter adapter;

  setUp(() {
    adapter = _FakeAdapter({
      '/monitor/devices/aaaaaaaa-0000-0000-0000-000000000002/history': {
        'data': [
          {'t': '2026-09-18T11:00:00.000Z', 'cpu_load': 8, 'rx_bps': '9000000', 'tx_bps': '2000000', 'reachable': true},
          {'t': '2026-09-18T11:05:00.000Z', 'cpu_load': 42, 'rx_bps': '18000000', 'tx_bps': '5000000', 'reachable': true},
          {'t': '2026-09-18T11:10:00.000Z', 'cpu_load': 13, 'rx_bps': '12500000', 'tx_bps': '3400000', 'reachable': true},
        ],
        'hours': 24,
        'bucket_minutes': 5,
        'uptime_pct': 99.4,
        'samples': 288,
      },
      '/monitor/devices/aaaaaaaa-0000-0000-0000-000000000002': {
        'device': _deviceList[1],
        'interfaces': [
          {'name': 'ether1', 'type': 'ether', 'running': true, 'rx_byte': 91234567890, 'tx_byte': 45678901234},
          {'name': 'sfp-sfpplus1', 'type': 'ether', 'running': false, 'rx_byte': 0, 'tx_byte': 0},
        ],
        'iface_error': null,
      },
      '/monitor/devices': _devices,
    });
    Api.instance.dio.httpClientAdapter = adapter;
  });

  testWidgets('the device list shows a healthy router and a dead one together', (t) async {
    await t.pumpWidget(const MaterialApp(
      home: Directionality(textDirection: TextDirection.rtl, child: MonitorScreen()),
    ));
    await t.pumpAndSettle();

    // "تعمل" appears twice by design: once as the counter's label and once as the healthy
    // device's own badge. Asserting "exactly one" was my test being sloppy, not the screen.
    expect(find.text('تعمل'), findsNWidgets(2));
    expect(find.text('متوقّفة'), findsNWidgets(2));

    // Both devices, and the dead one FIRST — the server orders it that way and the screen must
    // not quietly re-sort it below the healthy ones.
    expect(find.text('Aldobal'), findsOneWidget);
    expect(find.text('RB5009'), findsOneWidget);

    // The healthy router's vitals, read out of STRING fields.
    expect(find.text('13%'), findsOneWidget);          // cpu_load
    expect(find.text('25%'), findsOneWidget);          // memory used: (1024-768)/1024

    // The dead one owes a reason, not a row of blanks.
    expect(find.textContaining('لا يستجيب'), findsOneWidget);
  });

  testWidgets('tapping a device opens it with ports and history', (t) async {
    await t.pumpWidget(const MaterialApp(
      home: Directionality(
        textDirection: TextDirection.rtl,
        child: DeviceScreen(id: 'aaaaaaaa-0000-0000-0000-000000000002', name: 'RB5009'),
      ),
    ));
    await t.pumpAndSettle();

    expect(find.text('main base'), findsOneWidget);
    expect(find.text('RB5009UG+S+'), findsOneWidget);
    expect(find.text('7.23 (stable)'), findsOneWidget);
    expect(find.text('توفّر 99.4%'), findsOneWidget);

    // The ports card sits below the fold, and a ListView only builds what is visible — so the
    // test has to scroll to it exactly as a person would.
    await t.drag(find.byType(ListView), const Offset(0, -700));
    await t.pumpAndSettle();

    // Ports, with the down one present rather than hidden.
    expect(find.text('ether1'), findsOneWidget);
    expect(find.text('sfp-sfpplus1'), findsOneWidget);

    // And the history actually arrived, so the charts have something to draw.
    expect(find.text('السجلّ'), findsOneWidget);
    expect(find.text('المعالج'), findsOneWidget);
    expect(adapter.seen.any((p) => p.contains('/history')), isTrue);
  });

  testWidgets('a device with no history yet says so instead of drawing an empty chart', (t) async {
    adapter = _FakeAdapter({
      '/monitor/devices/x/history': {'data': [], 'hours': 24, 'uptime_pct': null, 'samples': 0},
      '/monitor/devices/x': {
        'device': {..._deviceList[0], 'id': 'x'},
        'interfaces': [],
        'iface_error': 'تعذّر الوصول إلى الراوتر',
      },
    });
    Api.instance.dio.httpClientAdapter = adapter;

    await t.pumpWidget(const MaterialApp(
      home: Directionality(
        textDirection: TextDirection.rtl,
        child: DeviceScreen(id: 'x', name: 'Aldobal'),
      ),
    ));
    await t.pumpAndSettle();

    expect(find.textContaining('لا سجلّ بعد'), findsOneWidget);
    await t.drag(find.byType(ListView), const Offset(0, -500));
    await t.pumpAndSettle();
    // A router that cannot be reached must say why on the ports card, not show an empty list that
    // reads as "this device has no ports".
    expect(find.text('تعذّر الوصول إلى الراوتر'), findsOneWidget);
  });
}
