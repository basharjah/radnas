import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import '../core/api.dart';
import '../core/theme.dart';
import 'common.dart';

/// Ping a subscriber's address, the way the panel does.
///
/// The probe is sent by the SERVER, out the caller's own tunnel — not by the phone. These pools are
/// private to each company's tunnel and unreachable from mobile data, so a ping from here would
/// always fail and prove nothing. It also matters that the server binds the interface: two
/// companies can both hand out 10.0.0.0/24, and an unbound probe would answer from whichever
/// tunnel won the kernel's routing race — the wrong company's network.
Future<void> showPingSheet(
  BuildContext context, {
  required String ip,
  String? username,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    backgroundColor:
        Theme.of(context).brightness == Brightness.dark ? C.surfaceD : C.surface,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
    ),
    builder: (_) => _PingSheet(ip: ip, username: username),
  );
}

class _Probe {
  final int seq;
  final double? ms;
  final bool ok;
  const _Probe(this.seq, this.ms, this.ok);
}

class _PingSheet extends StatefulWidget {
  final String ip;
  final String? username;
  const _PingSheet({required this.ip, this.username});

  @override
  State<_PingSheet> createState() => _PingSheetState();
}

class _PingSheetState extends State<_PingSheet> {
  final _log = <_Probe>[];
  bool _running = false;
  int _seq = 0;
  String? _via, _error;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _start();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  void _start() {
    setState(() {
      _running = true;
      _error = null;
      _log.clear();
      _seq = 0;
    });
    _tick();
  }

  void _stop() {
    _timer?.cancel();
    if (mounted) setState(() => _running = false);
  }

  Future<void> _tick() async {
    if (!_running || !mounted) return;
    final seq = ++_seq;
    final started = DateTime.now();
    try {
      final res = await Api.instance.dio
          .get('/radius/ping', queryParameters: {'ip': widget.ip, 'size': 56});
      if (!mounted) return;
      final d = res.data;
      if (res.statusCode != null && res.statusCode! < 300 && d is Map) {
        final ok = d['reachable'] == true;
        setState(() {
          _via = d['via'] as String?;
          _log.insert(0, _Probe(seq, ok ? (d['ms'] as num?)?.toDouble() : null, ok));
          if (_log.length > 60) _log.removeLast();
        });
      } else {
        // A refusal is permanent — the server found no tunnel to send it out of, and retrying
        // every second would just repeat the same answer.
        setState(() {
          _error = Api.errorOf(res);
          _running = false;
        });
        return;
      }
    } on DioException catch (e) {
      if (!mounted) return;
      setState(() => _log.insert(0, _Probe(seq, null, false)));
      if (e.type == DioExceptionType.connectionError) {
        setState(() {
          _error = Api.errorOf(e.response, e);
          _running = false;
        });
        return;
      }
    }
    if (!_running || !mounted) return;
    // Subtract the round trip so the period IS one second, not one second plus the request.
    final spent = DateTime.now().difference(started).inMilliseconds;
    _timer = Timer(Duration(milliseconds: (1000 - spent).clamp(0, 1000)), _tick);
  }

  /// Open the device's own web interface, and fall back to the clipboard.
  ///
  /// Stopping the ping first is deliberate: leaving a one-second timer running while the operator
  /// is in another app keeps waking the phone and the server for a screen nobody is watching.
  Future<void> _openInBrowser() async {
    _stop();
    final messenger = ScaffoldMessenger.of(context);
    var opened = false;
    try {
      opened = await launchUrl(Uri.parse('http://${widget.ip}'),
          mode: LaunchMode.externalApplication);
    } catch (_) {
      opened = false;
    }
    if (opened) return;
    await Clipboard.setData(ClipboardData(text: widget.ip));
    if (!mounted) return;
    messenger.showSnackBar(SnackBar(
      content: Text('لا متصفّح يصل ${widget.ip} من هذا الجهاز — نُسخ العنوان'),
      duration: const Duration(seconds: 4),
    ));
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final sent = _log.length;
    final recv = _log.where((p) => p.ok).length;
    final loss = sent == 0 ? 0 : (((sent - recv) / sent) * 100).round();
    final times = _log.where((p) => p.ok && p.ms != null).map((p) => p.ms!).toList();
    final avg = times.isEmpty
        ? 0.0
        : (times.reduce((a, b) => a + b) / times.length * 10).round() / 10;

    return Padding(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        bottom: MediaQuery.of(context).viewPadding.bottom + 20,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('ping — ${widget.ip}',
                      textDirection: TextDirection.ltr,
                      style: TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w700,
                          color: dark ? C.textD : C.text)),
                  if (widget.username != null || _via != null)
                    Text(
                      [
                        if (widget.username != null) widget.username!,
                        if (_via != null) 'عبر $_via',
                      ].join(' · '),
                      style: TextStyle(fontSize: 12.5, color: dark ? C.mutedD : C.muted),
                    ),
                ],
              ),
            ),
            IconButton(
              onPressed: _running ? _stop : _start,
              icon: Icon(_running ? Icons.stop_circle_outlined : Icons.play_circle_outline),
              color: _running ? C.danger : C.success,
              tooltip: _running ? 'إيقاف' : 'إعادة',
            ),
            // Testing and reaching the device are two different jobs. The ping answers "is it
            // up"; this opens its own web interface — which only resolves from a machine on that
            // network, so the address is copied whenever the browser cannot reach it.
            IconButton(
              onPressed: _openInBrowser,
              icon: const Icon(Icons.open_in_browser),
              color: C.electric,
              tooltip: 'فتح في المتصفّح',
            ),
          ]),
          const SizedBox(height: 14),
          if (_error != null)
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: C.danger.withValues(alpha: dark ? 0.16 : 0.08),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(_error!, style: const TextStyle(color: C.danger, height: 1.7)),
            )
          else ...[
            Row(children: [
              Expanded(child: StatTile(label: 'مُرسَل', value: '$sent')),
              const SizedBox(width: 9),
              Expanded(
                child: StatTile(
                  label: 'الفقد',
                  value: '$loss%',
                  tone: loss > 0 ? C.danger : C.success,
                ),
              ),
              const SizedBox(width: 9),
              Expanded(
                child: StatTile(
                  label: 'المتوسّط',
                  value: times.isEmpty ? '—' : '$avg ms',
                ),
              ),
            ]),
            const SizedBox(height: 12),
            SizedBox(
              height: 210,
              child: _log.isEmpty
                  ? Center(
                      child: Text('جارٍ الإرسال…',
                          style: TextStyle(color: dark ? C.mutedD : C.muted)),
                    )
                  : ListView.builder(
                      itemCount: _log.length,
                      itemBuilder: (_, i) {
                        final p = _log[i];
                        return Padding(
                          padding: const EdgeInsets.symmetric(vertical: 4),
                          child: Row(children: [
                            Icon(p.ok ? Icons.check_circle : Icons.cancel,
                                size: 15, color: p.ok ? C.success : C.danger),
                            const SizedBox(width: 9),
                            Text('#${p.seq}',
                                textDirection: TextDirection.ltr,
                                style: TextStyle(
                                    fontSize: 12.5, color: dark ? C.mutedD : C.muted)),
                            const Spacer(),
                            Text(
                              p.ok ? '${p.ms?.toStringAsFixed(1) ?? '—'} ms' : 'لا ردّ',
                              textDirection: TextDirection.ltr,
                              style: TextStyle(
                                  fontSize: 13.5,
                                  fontWeight: FontWeight.w700,
                                  color: p.ok ? (dark ? C.textD : C.text) : C.danger),
                            ),
                          ]),
                        );
                      },
                    ),
            ),
          ],
        ],
      ),
    );
  }
}
