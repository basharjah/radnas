import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/format.dart';
import '../core/open_ip.dart';
import '../core/theme.dart';
import '../widgets/common.dart';

/// Who is connected right now, and how fast, refreshed on a timer.
///
/// This is the screen an operator opens when a customer phones to say the line is slow: the live
/// rate answers that before anything else is checked, and it is the one figure that cannot be read
/// anywhere else — accounting totals only say how much has moved, never how fast it is moving now.
class OnlineScreen extends StatefulWidget {
  const OnlineScreen({super.key});
  @override
  State<OnlineScreen> createState() => _OnlineScreenState();
}

class _OnlineScreenState extends State<OnlineScreen> {
  List<Map<String, dynamic>> _rows = const [];
  num _downBps = 0, _upBps = 0;
  bool _loading = true;
  String? _error;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _load();
    // Ten seconds is the shortest interval that still feels live without hammering a server that
    // is also carrying every tenant's RADIUS traffic.
    _timer = Timer.periodic(const Duration(seconds: 10), (_) => _load(silent: true));
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent && mounted) setState(() => _error = null);
    try {
      final res = await Api.instance.dio.get('/radius/online');
      if (!mounted) return;
      final body = res.data;
      final data = body is Map ? (body['data'] as List?) : (body as List?);
      if (res.statusCode == 200 && data != null) {
        setState(() {
          _rows = data.map((e) => Map<String, dynamic>.from(e as Map)).toList();
          // The server nests these under `totals` — reading them from the root silently yielded
          // null, so the header showed a confident 0bps while every row underneath had a rate.
          final totals = body is Map && body['totals'] is Map
              ? Map<String, dynamic>.from(body['totals'] as Map)
              : const <String, dynamic>{};
          _downBps = numOf(totals['down_bps']) ?? 0;
          _upBps = numOf(totals['up_bps']) ?? 0;
          _loading = false;
          _error = null;
        });
      } else if (!silent) {
        setState(() {
          _error = Api.errorOf(res);
          _loading = false;
        });
      }
    } on DioException catch (e) {
      if (!mounted || silent) return;
      setState(() {
        _error = Api.errorOf(e.response, e);
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    // The router does not always report a rate. Saying so beats printing a confident zero.
    final reporting = _rows.where((r) => r['live'] == true).length;

    return Scaffold(
      appBar: AppBar(
        title: Text(_rows.isEmpty ? 'المتصلون الآن' : 'المتصلون الآن · ${_rows.length}'),
        actions: [
          IconButton(onPressed: () => _load(), icon: const Icon(Icons.refresh), tooltip: 'تحديث'),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: () => _load(),
              child: _error != null
                  ? StateView(
                      icon: Icons.error_outline,
                      title: _error!,
                      isError: true,
                      onRetry: () => _load(),
                    )
                  : _rows.isEmpty
                      ? const StateView(
                          icon: Icons.wifi_off_outlined,
                          title: 'لا جلسات مفتوحة الآن',
                        )
                      : ListView(
                          padding: const EdgeInsets.fromLTRB(14, 10, 14, 24),
                          children: [
                            Row(children: [
                              Expanded(
                                child: StatTile(
                                  label: 'التنزيل الآن',
                                  value: '${fmtSpeed(_downBps)}bps',
                                  tone: C.electric,
                                ),
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: StatTile(
                                  label: 'الرفع الآن',
                                  value: '${fmtSpeed(_upBps)}bps',
                                  tone: C.cyan,
                                ),
                              ),
                            ]),
                            if (reporting < _rows.length)
                              Padding(
                                padding: const EdgeInsets.only(top: 10),
                                child: Text(
                                  reporting == 0
                                      ? 'لا سرعات لحظية — فعّل واجهة القراءة على الراوتر من صفحة أجهزة NAS'
                                      : '$reporting من ${_rows.length} جلسة تُرسل سرعتها',
                                  style: TextStyle(
                                      fontSize: 12.5,
                                      height: 1.7,
                                      color: dark ? C.mutedD : C.muted),
                                ),
                              ),
                            const SizedBox(height: 12),
                            for (final r in _rows)
                              Padding(
                                padding: const EdgeInsets.only(bottom: 9),
                                child: _SessionCard(row: r, dark: dark),
                              ),
                          ],
                        ),
            ),
    );
  }
}

class _SessionCard extends StatelessWidget {
  final Map<String, dynamic> row;
  final bool dark;
  const _SessionCard({required this.row, required this.dark});

  @override
  Widget build(BuildContext context) {
    final live = row['live'] == true;
    final down = numOf(row['down_bps']);
    final up = numOf(row['up_bps']);

    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Container(
                width: 10,
                height: 10,
                margin: const EdgeInsetsDirectional.only(end: 11),
                decoration: const BoxDecoration(color: C.success, shape: BoxShape.circle),
              ),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('${row['username']}',
                        textDirection: TextDirection.ltr,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w700,
                            color: dark ? C.textD : C.text)),
                    const SizedBox(height: 2),
                    Text(
                      [
                        if ((row['full_name'] as String?)?.trim().isNotEmpty ?? false)
                          '${row['full_name']}',
                        if ((row['plan_name'] as String?)?.isNotEmpty ?? false)
                          '${row['plan_name']}',
                      ].join(' · '),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 12.3, color: dark ? C.mutedD : C.muted),
                    ),
                  ],
                ),
              ),
              if (row['quota_locked'] == true)
                const Tag('محظور', tone: C.danger)
              else if (row['fup_active'] == true)
                const Tag('مخفّض', tone: C.warning),
            ]),
            const SizedBox(height: 10),
            // The live rate is the reason to open this screen, so it gets the most weight on the
            // row — larger than the identity above it.
            Row(children: [
              _Rate(
                icon: Icons.south,
                tone: C.electric,
                value: live ? fmtSpeed(down) : '—',
                dark: dark,
              ),
              const SizedBox(width: 14),
              _Rate(
                icon: Icons.north,
                tone: C.cyan,
                value: live ? fmtSpeed(up) : '—',
                dark: dark,
              ),
              const Spacer(),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(fmtDuration(numOf(row['acctsessiontime'])),
                      style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: dark ? C.mutedD : C.muted)),
                  const SizedBox(height: 2),
                  Text('اليوم ${fmtData((numOf(row['daily_bytes']) ?? 0) / 1048576)}',
                      style: TextStyle(fontSize: 11.5, color: dark ? C.mutedD : C.muted)),
                ],
              ),
            ]),
            const SizedBox(height: 8),
            Row(children: [
              // Tapping the address opens the customer's own device; long-press copies it, for
              // when the operator is on a phone that cannot route to that pool.
              InkWell(
                onTap: () => openDeviceIp(context, row['framed_ip'] as String?,
                    username: '${row['username']}'),
                onLongPress: () => copyIp(context, row['framed_ip'] as String?),
                borderRadius: BorderRadius.circular(6),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 3),
                  child: Row(mainAxisSize: MainAxisSize.min, children: [
                    const Icon(Icons.network_ping, size: 14, color: C.electric),
                    const SizedBox(width: 5),
                    Text('${row['framed_ip'] ?? '—'}',
                        textDirection: TextDirection.ltr,
                        style: const TextStyle(
                            fontSize: 11.5,
                            color: C.electric,
                            fontWeight: FontWeight.w600)),
                  ]),
                ),
              ),
              if ((row['mac'] as String?)?.isNotEmpty ?? false) ...[
                const SizedBox(width: 12),
                Icon(Icons.memory, size: 13, color: dark ? C.mutedD : C.muted),
                const SizedBox(width: 5),
                Flexible(
                  child: Text('${row['mac']}',
                      textDirection: TextDirection.ltr,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 11.5, color: dark ? C.mutedD : C.muted)),
                ),
              ],
            ]),
          ],
        ),
      ),
    );
  }
}

class _Rate extends StatelessWidget {
  final IconData icon;
  final Color tone;
  final String value;
  final bool dark;
  const _Rate({required this.icon, required this.tone, required this.value, required this.dark});

  @override
  Widget build(BuildContext context) => Row(children: [
        Icon(icon, size: 15, color: tone),
        const SizedBox(width: 3),
        Text(value,
            textDirection: TextDirection.ltr,
            style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w800,
                color: value == '—' ? (dark ? C.mutedD : C.muted) : (dark ? C.textD : C.text))),
        const SizedBox(width: 2),
        Text('bps',
            style: TextStyle(fontSize: 10.5, color: dark ? C.mutedD : C.muted)),
      ]);
}
