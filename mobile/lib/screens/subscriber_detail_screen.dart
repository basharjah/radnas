import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/format.dart';
import '../core/open_ip.dart';
import '../core/theme.dart';
import '../widgets/usage_card.dart';
import '../widgets/form_kit.dart';
import '../widgets/topup_sheet.dart';
import 'subscriber_form.dart';

/// One subscriber: who they are, what they have used, and the two actions that matter on a phone —
/// renew, and cut the session so their router redials.
class SubscriberDetailScreen extends StatefulWidget {
  final Map<String, dynamic> row;
  const SubscriberDetailScreen({super.key, required this.row});

  @override
  State<SubscriberDetailScreen> createState() => _SubscriberDetailScreenState();
}

class _SubscriberDetailScreenState extends State<SubscriberDetailScreen> {
  late Map<String, dynamic> row = widget.row;
  Map<String, dynamic>? usage;
  bool _busy = false;
  bool _changed = false;

  @override
  void initState() {
    super.initState();
    _loadUsage();
  }

  Future<void> _loadUsage() async {
    try {
      final res = await Api.instance.dio.get('/subscribers/${row['id']}/usage');
      if (!mounted) return;
      if (res.statusCode == 200 && res.data is Map) {
        setState(() => usage = Map<String, dynamic>.from(res.data));
      }
    } on DioException {
      // Usage is supporting detail; the identity and actions above still work without it.
    }
  }

  /// Re-read this row from the server.
  ///
  /// There is no single-subscriber endpoint, so the list is queried for this exact username. That
  /// beats patching the local map: expiry, status and quota all move together on a renew, and a
  /// hand-patched copy drifts from what was actually stored.
  Future<void> _refreshRow() async {
    try {
      final r = await Api.instance.dio.get('/subscribers',
          queryParameters: {'q': row['username'], 'limit': 1, 'page': 1});
      final list = (r.data is Map ? r.data['data'] as List? : null) ?? const [];
      if (mounted && list.isNotEmpty) {
        setState(() => row = Map<String, dynamic>.from(list.first as Map));
      }
    } on DioException {
      // The screen keeps showing what it had; the list refreshes on the way back regardless.
    }
  }

  void _toast(String msg, {bool ok = true}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg),
      backgroundColor: ok ? C.success : C.danger,
    ));
  }

  Future<void> _renew() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('تجديد الاشتراك'),
        content: Text('سيُمدَّد اشتراك ${row['username']} بمقدار مدّة الباقة، '
            'ويُفعَّل إن كان موقوفاً. التجديد المبكّر يحافظ على الوقت المتبقّي.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('إلغاء')),
          FilledButton(
            onPressed: () => Navigator.pop(c, true),
            style: FilledButton.styleFrom(minimumSize: const Size(96, 42)),
            child: const Text('تجديد'),
          ),
        ],
      ),
    );
    if (confirm != true) return;

    setState(() => _busy = true);
    try {
      final res = await Api.instance.dio.post('/subscribers/${row['id']}/charge');
      if (!mounted) return;
      if (res.statusCode != null && res.statusCode! < 300) {
        _changed = true;
        _toast('تم التجديد');
        await _refreshRow();
        _loadUsage();
      } else {
        _toast(Api.errorOf(res), ok: false);
      }
    } on DioException catch (e) {
      _toast(Api.errorOf(e.response, e), ok: false);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Bar the subscriber, or let them back in - the panel's cut / reconnect.
  ///
  /// RADIUS refuses the next authentication once the status is 'disabled', which is what actually
  /// keeps them off the line. Ending the session alone does not: the router redials.
  Future<void> _setStatus(String status) async {
    final cutting = status == 'disabled';
    if (cutting) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (c) => AlertDialog(
          title: const Text('قطع الاتصال'),
          content: Text('سيُقطع اتصال ${row['username']} فوراً ويُمنع من الاتصال '
              'حتى تُعيد تفعيله بزرّ «اتصال».'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('إلغاء')),
            FilledButton(
              onPressed: () => Navigator.pop(c, true),
              style: FilledButton.styleFrom(
                  backgroundColor: C.danger, minimumSize: const Size(96, 42)),
              child: const Text('قطع الاتصال'),
            ),
          ],
        ),
      );
      if (ok != true || !mounted) return;
    }

    setState(() => _busy = true);
    try {
      final res = await Api.instance.dio
          .put('/subscribers/${row['id']}', data: {'status': status});
      if (!mounted) return;
      final ok = res.statusCode != null && res.statusCode! < 300;
      if (ok) {
        _changed = true;
        await _refreshRow();
      }
      _toast(
        ok ? (cutting ? 'تم قطع الاتصال' : 'تمت إعادة الاتصال') : Api.errorOf(res),
        ok: ok,
      );
    } on DioException catch (e) {
      _toast(Api.errorOf(e.response, e), ok: false);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _disconnect() async {
    setState(() => _busy = true);
    try {
      final res = await Api.instance.dio.post('/coa/disconnect', data: {
        'username': row['username'],
      });
      if (!mounted) return;
      _toast(
        res.statusCode != null && res.statusCode! < 300
            ? 'أُرسل أمر القطع — سيُعيد الاتصال خلال ثوانٍ'
            : Api.errorOf(res),
        ok: res.statusCode != null && res.statusCode! < 300,
      );
    } on DioException catch (e) {
      _toast(Api.errorOf(e.response, e), ok: false);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final online = row['online'] == true;
    final status = row['status'] as String?;
    final left = daysLeft(row['expiry_at'] as String?);

    return PopScope(
      canPop: true,
      onPopInvokedWithResult: (_, __) {},
      child: Scaffold(
        appBar: AppBar(
          title: Text('${row['username']}', textDirection: TextDirection.ltr),
          leading: IconButton(
            icon: const Icon(Icons.arrow_forward),
            tooltip: 'رجوع',
            onPressed: () => Navigator.pop(context, _changed),
          ),
          actions: [
            IconButton(
              tooltip: 'تعديل',
              icon: const Icon(Icons.edit_outlined),
              onPressed: () async {
                if (await openForm(context, SubscriberForm(row: row))) {
                  _changed = true;
                  await _refreshRow();
                }
              },
            ),
            IconButton(
              tooltip: 'حذف',
              icon: const Icon(Icons.delete_outline, color: C.danger),
              onPressed: () async {
                final gone = await deleteThing(context,
                    path: '/subscribers/${row['id']}',
                    what: 'المشترك',
                    name: '${row['username']}');
                if (gone && context.mounted) Navigator.pop(context, true);
              },
            ),
          ],
        ),
        body: ListView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(children: [
                      Container(
                        width: 11,
                        height: 11,
                        decoration: BoxDecoration(
                          color: online ? C.success : (dark ? C.borderD : C.border),
                          shape: BoxShape.circle,
                        ),
                      ),
                      const SizedBox(width: 9),
                      Text(online ? 'متصل الآن' : 'غير متصل',
                          style: TextStyle(
                              fontSize: 13.5,
                              fontWeight: FontWeight.w700,
                              color: online ? C.success : (dark ? C.mutedD : C.muted))),
                      const Spacer(),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(
                          color: statusColor(status).withValues(alpha: dark ? 0.22 : 0.11),
                          borderRadius: BorderRadius.circular(7),
                        ),
                        child: Text(statusLabel(status),
                            style: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w700,
                                color: statusColor(status))),
                      ),
                    ]),
                    const Divider(height: 26),
                    _Field(label: 'الاسم', value: '${row['full_name'] ?? '—'}'),
                    _Field(label: 'الهاتف', value: '${row['phone'] ?? '—'}', ltr: true),
                    _Field(label: 'الباقة', value: '${row['plan_name'] ?? '—'}'),
                    _Field(label: 'السعر', value: fmtMoney(numOf(row['plan_price']))),
                    _Field(
                      label: 'ينتهي',
                      value: left == null
                          ? '—'
                          : '${fmtDate(row['expiry_at'] as String?)}  ·  ${left < 0 ? 'انتهى' : left == 0 ? 'اليوم' : 'بعد $left يوماً'}',
                      tone: left == null
                          ? null
                          : left < 0
                              ? C.danger
                              : left <= 7
                                  ? C.warning
                                  : null,
                    ),
                    if ((row['live_ip'] as String?)?.isNotEmpty ?? false)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 6),
                        child: Row(children: [
                          SizedBox(
                            width: 104,
                            child: Text('العنوان الحالي',
                                style: TextStyle(
                                    fontSize: 13.5, color: dark ? C.mutedD : C.muted)),
                          ),
                          Expanded(
                            child: InkWell(
                              onTap: () => openDeviceIp(context, row['live_ip'] as String?,
                                  username: '${row['username']}'),
                              onLongPress: () => copyIp(context, row['live_ip'] as String?),
                              borderRadius: BorderRadius.circular(6),
                              child: Padding(
                                padding: const EdgeInsets.symmetric(vertical: 2),
                                child: Row(children: [
                                  Text('${row['live_ip']}',
                                      textDirection: TextDirection.ltr,
                                      style: const TextStyle(
                                          fontSize: 14.5,
                                          fontWeight: FontWeight.w700,
                                          color: C.electric)),
                                  const SizedBox(width: 6),
                                  const Icon(Icons.network_ping, size: 16, color: C.electric),
                                ]),
                              ),
                            ),
                          ),
                        ]),
                      ),
                    _Field(label: 'آخر اتصال', value: relative(row['last_online_at'] as String?)),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 14),
            if (usage != null) UsageCard(usage: usage!, dark: dark),
            const SizedBox(height: 18),
            // Above renewing on purpose: a subscriber who is throttled mid-period does not need a
            // new period, they need the gigabytes they ran out of — and renewing would charge them
            // for a month they already have.
            if (TopupAction.needed(row)) ...[
              TopupAction(row: row, onDone: () async {
                _changed = true;
                await _refreshRow();
                await _loadUsage();
              }),
              const SizedBox(height: 10),
            ],
            FilledButton.icon(
              onPressed: _busy ? null : _renew,
              icon: const Icon(Icons.autorenew),
              label: const Text('تجديد الاشتراك'),
            ),
            const SizedBox(height: 10),
            // The one that keeps them off: it survives the redial.
            OutlinedButton.icon(
              onPressed: _busy
                  ? null
                  : () => _setStatus(status == 'disabled' ? 'active' : 'disabled'),
              icon: Icon(status == 'disabled' ? Icons.power_settings_new : Icons.block),
              label: Text(status == 'disabled' ? 'إعادة الاتصال' : 'قطع الاتصال'),
              style: OutlinedButton.styleFrom(
                foregroundColor: status == 'disabled' ? C.success : C.danger,
              ),
            ),
            const SizedBox(height: 10),
            // And the one that only ends the open session, so a changed speed or quota applies now
            // instead of at the next natural reconnect.
            OutlinedButton.icon(
              onPressed: _busy || !online ? null : _disconnect,
              icon: const Icon(Icons.link_off),
              label: Text(online ? 'إنهاء الجلسة الحالية' : 'لا جلسة لقطعها'),
            ),
          ],
        ),
      ),
    );
  }
}

class _Field extends StatelessWidget {
  final String label, value;
  final bool ltr;
  final Color? tone;
  const _Field({required this.label, required this.value, this.ltr = false, this.tone});

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 104,
            child: Text(label,
                style: TextStyle(fontSize: 13.5, color: dark ? C.mutedD : C.muted)),
          ),
          Expanded(
            child: Text(
              value,
              textDirection: ltr ? TextDirection.ltr : null,
              textAlign: ltr ? TextAlign.right : null,
              style: TextStyle(
                fontSize: 14.5,
                fontWeight: FontWeight.w600,
                color: tone ?? (dark ? C.textD : C.text),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
