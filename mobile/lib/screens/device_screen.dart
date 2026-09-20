import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/format.dart';
import '../core/theme.dart';
import '../widgets/common.dart';

/// One router, in detail: what it is, how hard it is working, which ports are live, and what the
/// last day looked like.
///
/// The history is the part a phone could never produce on its own — it is only there because the
/// server has been sampling every minute whether or not anyone was looking. "It was slow last
/// night" stops being an argument and becomes a line on a chart.
class DeviceScreen extends StatefulWidget {
  final String id, name;
  const DeviceScreen({super.key, required this.id, required this.name});

  @override
  State<DeviceScreen> createState() => _DeviceScreenState();
}

class _DeviceScreenState extends State<DeviceScreen> {
  Map<String, dynamic>? _device;
  List<Map<String, dynamic>> _ifaces = const [];
  String? _ifaceError;

  List<Map<String, dynamic>> _history = const [];
  double? _uptimePct;
  int _hours = 24;

  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (mounted) setState(() => _error = null);
    try {
      // Two calls in parallel: the device and its history are independent, and the detail screen
      // should not wait for a chart to show the reason a router is down.
      final results = await Future.wait([
        Api.instance.dio.get('/monitor/devices/${widget.id}'),
        Api.instance.dio.get('/monitor/devices/${widget.id}/history',
            queryParameters: {'hours': _hours}),
      ]);
      if (!mounted) return;
      final d = results[0], h = results[1];
      if (d.statusCode == 200 && d.data is Map) {
        setState(() {
          _device = Map<String, dynamic>.from(d.data['device'] as Map);
          _ifaces = ((d.data['interfaces'] as List?) ?? const [])
              .map((e) => Map<String, dynamic>.from(e as Map))
              .toList();
          _ifaceError = d.data['iface_error'] as String?;
          if (h.statusCode == 200 && h.data is Map) {
            _history = ((h.data['data'] as List?) ?? const [])
                .map((e) => Map<String, dynamic>.from(e as Map))
                .toList();
            _uptimePct = numOf(h.data['uptime_pct'])?.toDouble();
          }
          _loading = false;
        });
      } else {
        setState(() {
          _error = Api.errorOf(d);
          _loading = false;
        });
      }
    } on DioException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = Api.errorOf(e.response, e);
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final d = _device;

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.name),
        actions: [
          IconButton(onPressed: _load, icon: const Icon(Icons.refresh), tooltip: 'تحديث'),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? StateView(icon: Icons.error_outline, title: _error!, isError: true, onRetry: _load)
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(14, 12, 14, 28),
                    children: [
                      _identity(d!, dark),
                      const SizedBox(height: 12),
                      _historyCard(dark),
                      const SizedBox(height: 12),
                      _interfacesCard(dark),
                    ],
                  ),
                ),
    );
  }

  Widget _identity(Map<String, dynamic> d, bool dark) {
    final status = '${d['status'] ?? 'unknown'}';
    final up = status == 'up';
    final tone = up ? C.success : (status == 'down' ? C.danger : C.warning);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
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
              Text(up ? 'تعمل' : (status == 'down' ? 'متوقّفة' : 'غير معروفة'),
                  style: TextStyle(fontSize: 14.5, fontWeight: FontWeight.w700, color: tone)),
              const Spacer(),
              if (_uptimePct != null)
                Tag('توفّر ${_uptimePct!.toStringAsFixed(1)}%',
                    tone: _uptimePct! >= 99 ? C.success : (_uptimePct! >= 95 ? C.warning : C.danger)),
            ]),
            if (d['last_error'] != null) ...[
              const SizedBox(height: 10),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
                decoration: BoxDecoration(
                  color: tone.withValues(alpha: dark ? 0.18 : 0.09),
                  borderRadius: BorderRadius.circular(9),
                ),
                child: Text('${d['last_error']}',
                    style: TextStyle(fontSize: 12.5, height: 1.5, color: tone)),
              ),
            ],
            const Divider(height: 26),
            _row('الاسم على الجهاز', '${d['identity'] ?? '—'}', dark),
            _row('العنوان', '${d['nasname']}', dark, ltr: true),
            _row('اللوحة', '${d['board'] ?? '—'}', dark, ltr: true),
            _row('نظام RouterOS', '${d['os_version'] ?? '—'}', dark, ltr: true),
            _row('يعمل منذ', fmtDuration(numOf(d['uptime_sec'])), dark),
            _row('آخر استجابة', relative(d['last_seen_at'] as String?), dark),
          ],
        ),
      ),
    );
  }

  Widget _row(String label, String value, bool dark, {bool ltr = false}) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 5),
        child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          Text(label, style: TextStyle(fontSize: 13, color: dark ? C.mutedD : C.muted)),
          const SizedBox(width: 12),
          Flexible(
            child: Text(value,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textDirection: ltr ? TextDirection.ltr : null,
                style: TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w600,
                    color: dark ? C.textD : C.text)),
          ),
        ]),
      );

  Widget _historyCard(bool dark) {
    final cpu = _history.map((h) => (numOf(h['cpu_load']) ?? 0).toDouble()).toList();
    final rx = _history.map((h) => (numOf(h['rx_bps']) ?? 0).toDouble()).toList();
    final tx = _history.map((h) => (numOf(h['tx_bps']) ?? 0).toDouble()).toList();

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Text('السجلّ',
                  style: TextStyle(
                      fontSize: 15.5,
                      fontWeight: FontWeight.w700,
                      color: dark ? C.textD : C.text)),
              const Spacer(),
              // A day is the default because that is the window an operator is asked about; six
              // hours for "what just happened", a week for "is this getting worse".
              SegmentedButton<int>(
                segments: const [
                  ButtonSegment(value: 6, label: Text('٦س')),
                  ButtonSegment(value: 24, label: Text('يوم')),
                  ButtonSegment(value: 168, label: Text('أسبوع')),
                ],
                selected: {_hours},
                showSelectedIcon: false,
                style: ButtonStyle(
                  visualDensity: VisualDensity.compact,
                  textStyle: WidgetStatePropertyAll(const TextStyle(fontSize: 11.5)),
                ),
                onSelectionChanged: (s) {
                  setState(() {
                    _hours = s.first;
                    _loading = true;
                  });
                  _load();
                },
              ),
            ]),
            const SizedBox(height: 14),
            if (_history.isEmpty)
              Text('لا سجلّ بعد — يُجمَع كل دقيقة',
                  style: TextStyle(fontSize: 13, color: dark ? C.mutedD : C.muted))
            else ...[
              _chartLabel('المعالج', cpu.isEmpty ? '—' : '${cpu.last.round()}%', C.electric, dark),
              const SizedBox(height: 6),
              SizedBox(
                height: 58,
                child: CustomPaint(
                  size: Size.infinite,
                  // CPU is a percentage, so the scale is fixed at 0–100: an idle router must look
                  // idle, not like a full chart drawn against its own tiny maximum.
                  painter: _Spark(values: cpu, tone: C.electric, max: 100, dark: dark),
                ),
              ),
              const SizedBox(height: 16),
              _chartLabel('التنزيل', fmtSpeed(rx.isEmpty ? 0 : rx.last), C.cyan, dark),
              const SizedBox(height: 6),
              SizedBox(
                height: 58,
                child: CustomPaint(
                  size: Size.infinite,
                  painter: _Spark(values: rx, tone: C.cyan, dark: dark),
                ),
              ),
              const SizedBox(height: 16),
              _chartLabel('الرفع', fmtSpeed(tx.isEmpty ? 0 : tx.last), C.indigo, dark),
              const SizedBox(height: 6),
              SizedBox(
                height: 58,
                child: CustomPaint(
                  size: Size.infinite,
                  painter: _Spark(values: tx, tone: C.indigo, dark: dark),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _chartLabel(String label, String value, Color tone, bool dark) =>
      Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
        Row(children: [
          Container(
            width: 9,
            height: 9,
            decoration: BoxDecoration(color: tone, borderRadius: BorderRadius.circular(3)),
          ),
          const SizedBox(width: 7),
          Text(label, style: TextStyle(fontSize: 12.5, color: dark ? C.mutedD : C.muted)),
        ]),
        Text(value,
            textDirection: TextDirection.ltr,
            style: TextStyle(
                fontSize: 12.5, fontWeight: FontWeight.w700, color: dark ? C.textD : C.text)),
      ]);

  Widget _interfacesCard(bool dark) => Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('المنافذ',
                  style: TextStyle(
                      fontSize: 15.5,
                      fontWeight: FontWeight.w700,
                      color: dark ? C.textD : C.text)),
              const SizedBox(height: 4),
              Text('تُقرأ من الراوتر مباشرةً الآن',
                  style: TextStyle(fontSize: 11.5, color: dark ? C.mutedD : C.muted)),
              const SizedBox(height: 12),
              if (_ifaceError != null)
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
                  decoration: BoxDecoration(
                    color: C.warning.withValues(alpha: dark ? 0.18 : 0.09),
                    borderRadius: BorderRadius.circular(9),
                  ),
                  child: Text(_ifaceError!,
                      style: const TextStyle(fontSize: 12.5, height: 1.5, color: C.warning)),
                )
              else
                for (final i in _ifaces)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    child: Row(children: [
                      Container(
                        width: 8,
                        height: 8,
                        margin: const EdgeInsetsDirectional.only(end: 10),
                        decoration: BoxDecoration(
                          color: i['running'] == true ? C.success : (dark ? C.borderD : C.border),
                          shape: BoxShape.circle,
                        ),
                      ),
                      Expanded(
                        child: Text('${i['name']}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            textDirection: TextDirection.ltr,
                            style: TextStyle(
                                fontSize: 13,
                                fontWeight: FontWeight.w600,
                                color: dark ? C.textD : C.text)),
                      ),
                      Text(
                        '↓ ${fmtData((numOf(i['rx_byte']) ?? 0) / 1048576)}   '
                        '↑ ${fmtData((numOf(i['tx_byte']) ?? 0) / 1048576)}',
                        textDirection: TextDirection.ltr,
                        style: TextStyle(fontSize: 11, color: dark ? C.mutedD : C.muted),
                      ),
                    ]),
                  ),
            ],
          ),
        ),
      );
}

/// A filled sparkline. No chart library: one series, no axes, no interaction — a dependency for
/// this would be larger than the feature.
class _Spark extends CustomPainter {
  final List<double> values;
  final Color tone;
  final double? max;
  final bool dark;
  _Spark({required this.values, required this.tone, this.max, required this.dark});

  @override
  void paint(Canvas canvas, Size size) {
    final grid = Paint()
      ..color = (dark ? C.borderD : C.border)
      ..strokeWidth = 1;
    canvas.drawLine(Offset(0, size.height), Offset(size.width, size.height), grid);

    if (values.isEmpty) return;
    // A flat line at zero is drawn at the BOTTOM, not smeared across the middle: an idle hour
    // should read as idle.
    final peak = max ?? (values.reduce((a, b) => a > b ? a : b));
    final top = peak <= 0 ? 1.0 : peak;

    final dx = values.length == 1 ? size.width : size.width / (values.length - 1);
    final path = Path();
    final fill = Path();
    for (var i = 0; i < values.length; i++) {
      final x = dx * i;
      final y = size.height - (values[i].clamp(0, top) / top) * size.height;
      if (i == 0) {
        path.moveTo(x, y);
        fill.moveTo(x, size.height);
        fill.lineTo(x, y);
      } else {
        path.lineTo(x, y);
        fill.lineTo(x, y);
      }
    }
    fill.lineTo(dx * (values.length - 1), size.height);
    fill.close();

    canvas.drawPath(fill, Paint()..color = tone.withValues(alpha: dark ? 0.18 : 0.12));
    canvas.drawPath(
      path,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..strokeJoin = StrokeJoin.round
        ..color = tone,
    );
  }

  @override
  bool shouldRepaint(_Spark old) => old.values != values || old.tone != tone;
}
