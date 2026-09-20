import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:radnas_map/core/api.dart';
import 'package:radnas_map/core/format.dart';
import 'package:radnas_map/screens/map_screen.dart';
import 'package:radnas_map/screens/monitor_screen.dart';
import 'package:radnas_map/widgets/topology.dart';

/// The two screens this app exists for, driven with the payloads the live server returns.
///
/// Every numeric field below is a STRING on purpose: Postgres sends `bigint` and `numeric` that
/// way, and a screen that assumes numbers renders as a blank grey rectangle in a release build
/// with no error anywhere. That failure has reached users of the panel app more than once, so it
/// is pinned here before this app ever ships.
class _FakeAdapter implements HttpClientAdapter {
  final Map<String, Object> routes;
  _FakeAdapter(this.routes);

  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? _, Future<void>? __) async {
    final key = routes.keys.firstWhere((k) => o.path.startsWith(k), orElse: () => '');
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

void main() {
  test('numbers survive arriving from Postgres as strings', () {
    expect(numOf('805306368'), 805306368);
    expect(numOf(13), 13);
    expect(numOf(null), isNull);
    expect(numOf('not a number'), isNull);
  });

  testWidgets('the monitor screen shows a healthy router and a dead one', (t) async {
    Api.instance.dio.httpClientAdapter = _FakeAdapter({
      '/monitor/devices': {
        'data': [
          {
            'id': '1', 'nasname': '10.10.13.2', 'shortname': 'Aldobal', 'company': 'aldobal',
            'status': 'down', 'last_error': 'لا يستجيب', 'down_since': '2026-09-18T09:00:00.000Z',
            'cpu_load': null, 'free_memory': null, 'total_memory': null, 'uptime_sec': null,
            'rx_bps': null, 'tx_bps': null, 'board': null, 'os_version': null, 'identity': null,
            'last_seen_at': null,
          },
          {
            'id': '2', 'nasname': '10.10.10.2', 'shortname': 'RB5009', 'company': 'teranet',
            'status': 'up', 'last_error': null, 'down_since': null,
            'last_seen_at': '2026-09-18T12:00:00.000Z', 'identity': 'main base',
            'board': 'RB5009UG+S+', 'os_version': '7.23 (stable)', 'cpu_load': 13,
            'free_memory': '805306368', 'total_memory': '1073741824', 'uptime_sec': '17280',
            'rx_bps': '12500000', 'tx_bps': '3400000',
          },
        ],
        'totals': {'devices': 2, 'up': 1, 'down': 1, 'unknown': 0},
      },
    });

    await t.pumpWidget(const MaterialApp(
      home: Directionality(textDirection: TextDirection.rtl, child: MonitorScreen()),
    ));
    await t.pumpAndSettle();

    expect(find.text('RB5009'), findsOneWidget);
    expect(find.text('Aldobal'), findsOneWidget);
    expect(find.text('13%'), findsOneWidget);            // cpu, read from a string
    expect(find.text('25%'), findsOneWidget);            // memory used
    expect(find.textContaining('لا يستجيب'), findsOneWidget);
  });

  testWidgets('the map nests antennas under the sector they arrived on', (t) async {
    Api.instance.dio.httpClientAdapter = _FakeAdapter({
      '/monitor/map': {
        'sites': [
          {
            'id': '2', 'name': 'RB5009', 'identity': 'main base', 'address': '10.10.10.2',
            'company': 'teranet', 'status': 'up', 'cpu_load': 13, 'board': 'RB5009UG+S+',
            'os_version': '7.23 (stable)', 'uptime_sec': '17280',
            'rx_bps': '12500000', 'tx_bps': '3400000',
            'devices_total': 2, 'devices_stale': 1,
            'ports': [
              {
                'name': 'Sector1-mANTBox',
                'devices': [
                  {
                    'mac': '04:F4:1C:31:4F:CE', 'identity': 'nashat abo assaf',
                    'address': '192.168.55.67', 'board': 'RBSXTsq5nD', 'version': '7.22.1',
                    'uptime_sec': '900', 'last_seen_at': '2026-09-18T12:00:00.000Z',
                    'stale': false,
                  },
                  {
                    'mac': '04:F4:1C:A5:AF:63', 'identity': 'jamal abo assaf',
                    'address': '192.168.55.102', 'board': 'RBSXTsq5nD', 'version': '7.19.5',
                    'uptime_sec': '900', 'last_seen_at': '2026-09-18T06:00:00.000Z',
                    'stale': true,
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    await t.pumpWidget(const MaterialApp(
      home: Directionality(textDirection: TextDirection.rtl, child: MapScreen()),
    ));
    await t.pumpAndSettle();

    // The drawing is the default view now, so these list assertions switch to it first — exactly
    // as an operator does when they want to read names rather than look at the shape.
    await t.tap(find.byTooltip('عرض كقائمة'));
    await t.pumpAndSettle();

    // The router and its port are visible; the antennas are folded away until the port is opened,
    // because a sector with twenty-nine customers must not unroll over the whole screen by default.
    expect(find.text('main base'), findsOneWidget);
    expect(find.text('Sector1-mANTBox'), findsOneWidget);
    expect(find.text('nashat abo assaf'), findsNothing);

    await t.tap(find.text('Sector1-mANTBox'));
    await t.pumpAndSettle();
    expect(find.text('nashat abo assaf'), findsOneWidget);
    expect(find.text('jamal abo assaf'), findsOneWidget);

    // A device that stopped announcing itself stays on the map — that is the one the operator
    // opened the map to find.
    expect(find.textContaining('آخر ظهور'), findsOneWidget);
  });

  testWidgets('the drawn map places every device and survives a crowded sector', (t) async {
    // Twenty-nine antennas on one sector is the real shape of this network, and the layout that
    // looks fine with three is exactly the one that collapses at twenty-nine.
    final crowded = [
      for (var i = 0; i < 29; i++)
        {
          'mac': 'AA:BB:CC:00:00:$i', 'identity': 'زبون $i',
          'address': '192.168.55.${i + 10}', 'board': 'RBSXTsq5nD',
          'last_seen_at': '2026-09-18T12:00:00.000Z', 'stale': i == 3,
        },
    ];
    Api.instance.dio.httpClientAdapter = _FakeAdapter({
      '/monitor/map': {
        'sites': [
          {
            'id': '2', 'name': 'RB5009', 'identity': 'main base', 'address': '10.10.10.2',
            'status': 'up', 'cpu_load': 13, 'board': 'RB5009UG+S+',
            'uptime_sec': '17280', 'devices_total': 30, 'devices_stale': 1,
            'ports': [
              {'name': 'Sector1-mANTBox', 'devices': crowded},
              {'name': 'ether6', 'devices': [
                {'mac': 'DD:EE', 'identity': 'switch', 'address': '192.168.55.2',
                 'last_seen_at': '2026-09-18T12:00:00.000Z', 'stale': false},
              ]},
            ],
          },
        ],
      },
    });

    await t.pumpWidget(const MaterialApp(
      home: Directionality(textDirection: TextDirection.rtl, child: MapScreen()),
    ));
    await t.pumpAndSettle();

    // The drawing is the default view, so the canvas must be up without any interaction.
    expect(find.byType(TopologyMap), findsOneWidget);
    expect(find.byType(InteractiveViewer), findsOneWidget);

    // And the list view is one tap away, with the same data behind it.
    await t.tap(find.byTooltip('عرض كقائمة'));
    await t.pumpAndSettle();
    expect(find.byType(TopologyMap), findsNothing);
    expect(find.text('Sector1-mANTBox'), findsOneWidget);
    expect(find.text('ether6'), findsOneWidget);

    // Counted apart: 29 subscribers on the sector, 1 switch on ether6. A combined "30 devices"
    // answers neither "how big is my business" nor "how big is my backbone".
    expect(find.text('زبائن 29'), findsOneWidget);
    expect(find.text('أساسي 1'), findsOneWidget);

    // The two roles are named and separated, with the backbone first: during a fault the trunk is
    // the first question, and it must not be buried among twenty-nine antennas.
    expect(find.text('البنية الأساسية'), findsOneWidget);
    expect(find.text('قطاعات الزبائن'), findsOneWidget);
    final coreY = t.getTopLeft(find.text('البنية الأساسية')).dy;
    final custY = t.getTopLeft(find.text('قطاعات الزبائن')).dy;
    expect(coreY, lessThan(custY));
  });

  test('wired ports are backbone, sectors are customers', () {
    // The rule both views share. If these ever drift apart the drawing and the list would
    // disagree about the same port, which is worse than either being wrong alone.
    expect(isCorePort('ether1'), isTrue);
    expect(isCorePort('ether6'), isTrue);
    expect(isCorePort('sfp-sfpplus1'), isTrue);
    expect(isCorePort('bridge-Management'), isTrue);
    expect(isCorePort('vlan200'), isTrue);
    expect(isCorePort('Sector1-mANTBox'), isFalse);
    expect(isCorePort('Sector3-Omnitik'), isFalse);
    expect(isCorePort('Sector2'), isFalse);
  });

  testWidgets('searching finds a customer without knowing their sector', (t) async {
    Api.instance.dio.httpClientAdapter = _FakeAdapter({
      '/monitor/map': {
        'sites': [
          {
            'id': '2', 'name': 'RB5009', 'identity': 'main base', 'address': '10.10.10.2',
            'status': 'up', 'cpu_load': 13, 'devices_total': 1, 'devices_stale': 0,
            'ports': [
              {
                'name': 'Sector3-Omnitik',
                'devices': [
                  {
                    'mac': 'AA:BB', 'identity': 'beram sleka', 'address': '192.168.55.105',
                    'board': 'RBSXTsq5nD', 'last_seen_at': '2026-09-18T12:00:00.000Z',
                    'stale': false,
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    await t.pumpWidget(const MaterialApp(
      home: Directionality(textDirection: TextDirection.rtl, child: MapScreen()),
    ));
    await t.pumpAndSettle();

    // The drawing is the default view now, so these list assertions switch to it first — exactly
    // as an operator does when they want to read names rather than look at the shape.
    await t.tap(find.byTooltip('عرض كقائمة'));
    await t.pumpAndSettle();

    await t.enterText(find.byType(TextField), 'beram');
    await t.pumpAndSettle();

    // Found without expanding anything, and told which sector it hangs on.
    expect(find.text('beram sleka'), findsOneWidget);
    expect(find.textContaining('Sector3-Omnitik'), findsOneWidget);
  });
}
