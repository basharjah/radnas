import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/loader.dart';
import '../core/theme.dart';
import '../widgets/common.dart';
import '../widgets/form_kit.dart';
import 'nas_form.dart';

/// The routers, and the diagnosis that explains why one of them is silent.
///
/// The diagnosis is the reason this screen belongs on a phone: it is run standing next to the
/// router, and every check it reports carries the exact command that fixes it.
class NasScreen extends StatefulWidget {
  const NasScreen({super.key});
  @override
  State<NasScreen> createState() => _NasScreenState();
}

class _NasScreenState extends State<NasScreen> {
  Key _key = UniqueKey();
  void _reload() => setState(() => _key = UniqueKey());

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(title: const Text('أجهزة NAS')),
      floatingActionButton: FloatingActionButton(
        onPressed: () async {
          if (await openForm(context, const NasForm())) _reload();
        },
        tooltip: 'راوتر جديد',
        child: const Icon(Icons.add),
      ),
      body: Loader<List<Map<String, dynamic>>>(
        key: _key,
        path: '/nas',
        parse: (b) => ((b is Map ? b['data'] as List? : b as List?) ?? const [])
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList(),
        isEmpty: (d) => d.isEmpty,
        emptyIcon: Icons.router_outlined,
        emptyText: 'لا راوتر مسجّل بعد',
        builder: (context, rows, reload) => ListView.separated(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 90),
          itemCount: rows.length,
          separatorBuilder: (_, __) => const SizedBox(height: 9),
          itemBuilder: (_, i) {
            final n = rows[i];
            return Card(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(15, 13, 15, 10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(children: [
                      Expanded(
                        child: Text('${n['shortname'] ?? n['nasname']}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                                fontSize: 15.5,
                                fontWeight: FontWeight.w700,
                                color: dark ? C.textD : C.text)),
                      ),
                      if (n['iface'] != null)
                        Tag('${n['iface']}', tone: C.indigo),
                    ]),
                    const SizedBox(height: 4),
                    Text('${n['nasname']}',
                        textDirection: TextDirection.ltr,
                        textAlign: TextAlign.right,
                        style: TextStyle(fontSize: 12.5, color: dark ? C.mutedD : C.muted)),
                    const SizedBox(height: 6),
                    Align(
                      alignment: AlignmentDirectional.centerStart,
                      child: TextButton.icon(
                        onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                          builder: (_) => DiagnoseScreen(
                            nasId: '${n['id']}',
                            title: '${n['shortname'] ?? n['nasname']}',
                          ),
                        )),
                        icon: const Icon(Icons.medical_services_outlined, size: 18),
                        label: const Text('فحص الاتصال'),
                      ),
                    ),
                    Row(children: [
                      // The panel's «واجهة الراوتر» is these credentials plus this button. Testing
                      // from the panel proves the whole path — tunnel, port, account — in one press,
                      // instead of waiting to discover at the next diagnosis that live speeds are
                      // silently absent.
                      TextButton.icon(
                        onPressed: () => send(context, 'POST', '/nas/${n['id']}/test-api',
                            okMessage: 'الاتصال بالراوتر ناجح'),
                        icon: const Icon(Icons.wifi_tethering, size: 17),
                        label: const Text('اختبار'),
                      ),
                      TextButton.icon(
                        onPressed: () async {
                          if (await openForm(context, NasForm(row: n))) await reload();
                        },
                        icon: const Icon(Icons.edit_outlined, size: 17),
                        label: const Text('تعديل'),
                      ),
                      TextButton.icon(
                        onPressed: () async {
                          if (await deleteThing(context,
                              path: '/nas/${n['id']}',
                              what: 'الراوتر',
                              name: '${n['shortname'] ?? n['nasname']}')) {
                            await reload();
                          }
                        },
                        icon: const Icon(Icons.delete_outline, size: 17),
                        label: const Text('حذف'),
                        style: TextButton.styleFrom(foregroundColor: C.danger),
                      ),
                    ]),
                  ],
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}

/// The sixteen checks, failures first, each with the command that fixes it.
class DiagnoseScreen extends StatefulWidget {
  final String nasId, title;
  const DiagnoseScreen({super.key, required this.nasId, required this.title});

  @override
  State<DiagnoseScreen> createState() => _DiagnoseScreenState();
}

class _DiagnoseScreenState extends State<DiagnoseScreen> {
  List<Map<String, dynamic>>? _checks;
  Map<String, dynamic>? _summary;
  bool _running = false;
  String? _error;

  Future<void> _run() async {
    setState(() {
      _running = true;
      _error = null;
    });
    try {
      // The diagnosis talks to the customer's router over the tunnel, so it is slower than a
      // normal read — a short timeout here would report a healthy router as unreachable.
      final res = await Api.instance.dio.get(
        '/nas/${widget.nasId}/diagnose',
        options: Options(receiveTimeout: const Duration(seconds: 90)),
      );
      if (!mounted) return;
      if (res.statusCode != null && res.statusCode! < 300 && res.data is Map) {
        setState(() {
          _checks = ((res.data['checks'] as List?) ?? const [])
              .map((e) => Map<String, dynamic>.from(e as Map))
              .toList();
          _summary = res.data['summary'] is Map
              ? Map<String, dynamic>.from(res.data['summary'] as Map)
              : null;
          _running = false;
        });
      } else {
        setState(() {
          _error = Api.errorOf(res);
          _running = false;
        });
      }
    } on DioException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = Api.errorOf(e.response, e);
        _running = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(title: Text('فحص ${widget.title}')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(14, 14, 14, 30),
        children: [
          Text(
            'فحص حيّ للمسار كاملاً: تسجيل الراوتر، المصادقة، المحاسبة، والسرعات.',
            style: TextStyle(fontSize: 14, height: 1.8, color: dark ? C.mutedD : C.muted),
          ),
          const SizedBox(height: 14),
          FilledButton.icon(
            onPressed: _running ? null : _run,
            icon: _running
                ? const SizedBox(
                    height: 18, width: 18,
                    child: CircularProgressIndicator(strokeWidth: 2.2, color: Colors.white))
                : const Icon(Icons.play_arrow),
            label: Text(_running ? 'جارٍ الفحص…' : 'ابدأ الفحص'),
          ),
          if (_error != null) ...[
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: C.danger.withValues(alpha: dark ? 0.16 : 0.08),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(_error!, style: const TextStyle(color: C.danger, height: 1.7)),
            ),
          ],
          if (_summary != null) ...[
            const SizedBox(height: 16),
            Row(children: [
              Expanded(child: StatTile(
                  label: 'سليم', value: '${_summary!['ok'] ?? 0}', tone: C.success)),
              const SizedBox(width: 9),
              Expanded(child: StatTile(
                  label: 'تحذير', value: '${_summary!['warn'] ?? 0}', tone: C.warning)),
              const SizedBox(width: 9),
              Expanded(child: StatTile(
                  label: 'خلل', value: '${_summary!['fail'] ?? 0}', tone: C.danger)),
            ]),
          ],
          if (_checks != null) ...[
            const SizedBox(height: 16),
            for (final c in _checks!) _CheckRow(check: c, dark: dark),
          ],
        ],
      ),
    );
  }
}

class _CheckRow extends StatelessWidget {
  final Map<String, dynamic> check;
  final bool dark;
  const _CheckRow({required this.check, required this.dark});

  @override
  Widget build(BuildContext context) {
    final status = check['status'] as String?;
    final tone = switch (status) {
      'ok' => C.success,
      'warn' => C.warning,
      _ => C.danger,
    };
    final icon = switch (status) {
      'ok' => Icons.check_circle,
      'warn' => Icons.warning_amber_rounded,
      _ => Icons.cancel,
    };
    final fix = check['fix'] as String?;

    return Container(
      margin: const EdgeInsets.only(bottom: 9),
      padding: const EdgeInsets.fromLTRB(13, 12, 13, 12),
      decoration: BoxDecoration(
        color: dark ? C.surfaceD : C.surface,
        border: BorderDirectional(
          // A coloured rail rather than a coloured card: fifteen tinted boxes in a row stop
          // meaning anything, and the failures are what must jump out.
          start: BorderSide(color: tone, width: 3),
        ),
        borderRadius: const BorderRadius.horizontal(left: Radius.circular(11)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Icon(icon, size: 17, color: tone),
            const SizedBox(width: 8),
            Expanded(
              child: Text('${check['label'] ?? check['key']}',
                  style: TextStyle(
                      fontSize: 14.5,
                      fontWeight: FontWeight.w700,
                      color: dark ? C.textD : C.text)),
            ),
          ]),
          if ((check['detail'] as String?)?.isNotEmpty ?? false) ...[
            const SizedBox(height: 5),
            Text('${check['detail']}',
                style: TextStyle(
                    fontSize: 13, height: 1.75, color: dark ? C.mutedD : C.muted)),
          ],
          if (fix != null && fix.isNotEmpty) ...[
            const SizedBox(height: 9),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
              decoration: BoxDecoration(
                color: dark ? C.bgD : C.surface2,
                borderRadius: BorderRadius.circular(8),
              ),
              child: SelectableText(
                fix,
                textDirection: TextDirection.ltr,
                textAlign: TextAlign.left,
                // Selectable on purpose: the fix is usually a RouterOS command to paste into a
                // terminal, and retyping one by hand next to a live router is how a typo becomes
                // an outage.
                style: TextStyle(
                    fontSize: 12.5,
                    height: 1.7,
                    fontFamily: 'monospace',
                    color: dark ? C.textD : C.text),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
