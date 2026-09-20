import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/format.dart';
import '../core/theme.dart';
import '../core/auth.dart';
import '../widgets/common.dart';
import 'device_screen.dart';

/// Network monitoring — the routers themselves, not their subscribers.
///
/// This is the half of The Dude that matters on a phone: which of my sites are up, which is
/// working hard, and which stopped answering. The watching happens on the server around the
/// clock; the phone only reads the result, which is why closing the app does not blind it.
class MonitorScreen extends StatefulWidget {
  const MonitorScreen({super.key});
  @override
  State<MonitorScreen> createState() => _MonitorScreenState();
}

class _MonitorScreenState extends State<MonitorScreen> {
  List<Map<String, dynamic>> _rows = const [];
  Map<String, dynamic> _totals = const {};
  bool _loading = true;
  String? _error;
  Timer? _tick;

  @override
  void initState() {
    super.initState();
    _load();
    // The server samples every minute, so anything faster here would redraw the same numbers.
    _tick = Timer.periodic(const Duration(seconds: 30), (_) => _load(silent: true));
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent && mounted) setState(() => _error = null);
    try {
      final res = await Api.instance.dio.get('/monitor/devices');
      if (!mounted) return;
      if (res.statusCode == 200 && res.data is Map) {
        setState(() {
          _rows = ((res.data['data'] as List?) ?? const [])
              .map((e) => Map<String, dynamic>.from(e as Map))
              .toList();
          _totals = Map<String, dynamic>.from(
              (res.data['totals'] as Map?) ?? const <String, dynamic>{});
          _loading = false;
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
    final down = numOf(_totals['down'])?.round() ?? 0;

    return Scaffold(
      appBar: AppBar(
        title: const Text('مراقبة الشبكة'),
        actions: [
          IconButton(onPressed: _load, icon: const Icon(Icons.refresh), tooltip: 'تحديث'),
          IconButton(
            tooltip: 'تسجيل الخروج',
            icon: const Icon(Icons.logout, color: C.danger),
            onPressed: () async {
              final ok = await confirm(
                context,
                title: 'تسجيل الخروج',
                body: 'ستحتاج إلى إدخال بياناتك مرّة أخرى.',
                action: 'خروج',
                danger: true,
              );
              if (ok) await Auth.instance.logout();
            },
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? StateView(
                  icon: Icons.error_outline,
                  title: _error!,
                  isError: true,
                  onRetry: _load,
                )
              : _rows.isEmpty
                  ? const StateView(
                      icon: Icons.router_outlined,
                      title: 'لا أجهزة مُراقَبة بعد',
                      detail: 'أضف جهاز NAS وفعّل واجهته ليبدأ فحصه كل دقيقة',
                    )
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView(
                        padding: const EdgeInsets.fromLTRB(14, 10, 14, 26),
                        children: [
                          Row(children: [
                            Expanded(
                              child: _Count(
                                label: 'تعمل',
                                value: '${numOf(_totals['up'])?.round() ?? 0}',
                                tone: C.success,
                                dark: dark,
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: _Count(
                                label: 'متوقّفة',
                                value: '$down',
                                tone: down > 0 ? C.danger : C.muted,
                                dark: dark,
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: _Count(
                                label: 'غير معروفة',
                                value: '${numOf(_totals['unknown'])?.round() ?? 0}',
                                tone: C.warning,
                                dark: dark,
                              ),
                            ),
                          ]),
                          const SizedBox(height: 14),
                          for (final d in _rows) ...[
                            _DeviceCard(
                              row: d,
                              dark: dark,
                              onTap: () async {
                                await Navigator.of(context).push(MaterialPageRoute(
                                  builder: (_) => DeviceScreen(
                                    id: '${d['id']}',
                                    name: '${d['shortname'] ?? d['nasname']}',
                                  ),
                                ));
                                _load(silent: true);
                              },
                            ),
                            const SizedBox(height: 10),
                          ],
                        ],
                      ),
                    ),
    );
  }
}

class _Count extends StatelessWidget {
  final String label, value;
  final Color tone;
  final bool dark;
  const _Count({required this.label, required this.value, required this.tone, required this.dark});

  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 13, horizontal: 10),
          child: Column(children: [
            Text(value,
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: tone)),
            const SizedBox(height: 2),
            Text(label,
                style: TextStyle(fontSize: 12, color: dark ? C.mutedD : C.muted)),
          ]),
        ),
      );
}

class _DeviceCard extends StatelessWidget {
  final Map<String, dynamic> row;
  final bool dark;
  final VoidCallback onTap;
  const _DeviceCard({required this.row, required this.dark, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final status = '${row['status'] ?? 'unknown'}';
    final up = status == 'up';
    final isDown = status == 'down';
    final tone = up ? C.success : (isDown ? C.danger : C.warning);
    final cpu = numOf(row['cpu_load'])?.round();
    final free = numOf(row['free_memory'])?.toDouble() ?? 0;
    final total = numOf(row['total_memory'])?.toDouble() ?? 0;
    final memUsedPct = total > 0 ? ((total - free) / total * 100).round() : null;

    return Card(
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 13, 14, 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: [
                Container(
                  width: 11,
                  height: 11,
                  margin: const EdgeInsetsDirectional.only(end: 10),
                  decoration: BoxDecoration(color: tone, shape: BoxShape.circle),
                ),
                Expanded(
                  child: Text(
                    '${row['shortname'] ?? row['nasname']}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                        fontSize: 15.5,
                        fontWeight: FontWeight.w700,
                        color: dark ? C.textD : C.text),
                  ),
                ),
                Tag(up ? 'تعمل' : (isDown ? 'متوقّفة' : 'غير معروفة'), tone: tone),
              ]),
              const SizedBox(height: 4),
              Text(
                [
                  if ((row['company'] as String?)?.isNotEmpty ?? false) '${row['company']}',
                  '${row['nasname']}',
                  if ((row['board'] as String?)?.isNotEmpty ?? false) '${row['board']}',
                ].join('  ·  '),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textDirection: TextDirection.ltr,
                style: TextStyle(fontSize: 12, color: dark ? C.mutedD : C.muted),
              ),

              // A device that is down owes the operator a reason and a time, not a row of blanks
              // where its vitals used to be.
              if (!up) ...[
                const SizedBox(height: 10),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                  decoration: BoxDecoration(
                    color: tone.withValues(alpha: dark ? 0.18 : 0.09),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    [
                      '${row['last_error'] ?? 'لم يُفحص بعد'}',
                      if (row['down_since'] != null) 'منذ ${relative(row['down_since'] as String?)}',
                    ].join(' — '),
                    style: TextStyle(fontSize: 12, height: 1.5, color: tone),
                  ),
                ),
              ] else ...[
                const SizedBox(height: 12),
                Row(children: [
                  Expanded(
                    child: _Vital(
                      label: 'المعالج',
                      value: cpu == null ? '—' : '$cpu%',
                      frac: cpu == null ? null : cpu / 100,
                      tone: (cpu ?? 0) >= 80 ? C.danger : C.electric,
                      dark: dark,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _Vital(
                      label: 'الذاكرة',
                      value: memUsedPct == null ? '—' : '$memUsedPct%',
                      frac: memUsedPct == null ? null : memUsedPct / 100,
                      tone: (memUsedPct ?? 0) >= 85 ? C.danger : C.cyan,
                      dark: dark,
                    ),
                  ),
                ]),
                const SizedBox(height: 10),
                Row(children: [
                  _Chip(
                    icon: Icons.south,
                    text: fmtSpeed(numOf(row['rx_bps'])),
                    tone: C.electric,
                    dark: dark,
                  ),
                  const SizedBox(width: 8),
                  _Chip(
                    icon: Icons.north,
                    text: fmtSpeed(numOf(row['tx_bps'])),
                    tone: C.cyan,
                    dark: dark,
                  ),
                  const Spacer(),
                  Text(
                    'يعمل منذ ${fmtDuration(numOf(row['uptime_sec']))}',
                    style: TextStyle(fontSize: 11.5, color: dark ? C.mutedD : C.muted),
                  ),
                ]),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _Vital extends StatelessWidget {
  final String label, value;
  final double? frac;
  final Color tone;
  final bool dark;
  const _Vital({
    required this.label,
    required this.value,
    required this.frac,
    required this.tone,
    required this.dark,
  });

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
            Text(label, style: TextStyle(fontSize: 11.5, color: dark ? C.mutedD : C.muted)),
            Text(value,
                style: TextStyle(
                    fontSize: 12.5, fontWeight: FontWeight.w700, color: dark ? C.textD : C.text)),
          ]),
          const SizedBox(height: 5),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: (frac ?? 0).clamp(0.0, 1.0),
              minHeight: 6,
              backgroundColor: dark ? C.borderD : C.border,
              valueColor: AlwaysStoppedAnimation(tone),
            ),
          ),
        ],
      );
}

class _Chip extends StatelessWidget {
  final IconData icon;
  final String text;
  final Color tone;
  final bool dark;
  const _Chip({required this.icon, required this.text, required this.tone, required this.dark});

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: tone.withValues(alpha: dark ? 0.2 : 0.1),
          borderRadius: BorderRadius.circular(7),
        ),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 13, color: tone),
          const SizedBox(width: 4),
          Text(text,
              textDirection: TextDirection.ltr,
              style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: tone)),
        ]),
      );
}
