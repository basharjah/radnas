import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'core.dart';

/// One screen: what a subscriber phones their ISP to ask.
///
/// The two questions are always the same — "how long do I have left" and "how much have I used" —
/// so those are the only two things given real size. Everything else is supporting detail.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  Map<String, dynamic>? _a;
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
      final r = await Api.instance.dio.get('/me');
      if (!mounted) return;
      if (r.statusCode == 200 && r.data is Map) {
        setState(() {
          _a = r.data['account'] is Map
              ? Map<String, dynamic>.from(r.data['account'])
              : null;
          _loading = false;
        });
      } else {
        setState(() {
          _error = 'تعذّر تحميل بياناتك';
          _loading = false;
        });
      }
    } on DioException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.type == DioExceptionType.connectionError
            ? 'لا اتصال بالإنترنت'
            : 'تعذّر الوصول إلى الخادم';
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final ink = dark ? C.inkD : C.ink;
    final dim = dark ? C.dimD : C.dim;

    return Scaffold(
      appBar: AppBar(
        backgroundColor: dark ? C.cardD : C.card,
        surfaceTintColor: Colors.transparent,
        title: Text(
          Api.instance.user?['full_name']?.toString().trim().isNotEmpty == true
              ? '${Api.instance.user!['full_name']}'
              : 'حسابي',
          style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: ink),
        ),
        actions: [
          IconButton(onPressed: _load, icon: const Icon(Icons.refresh), tooltip: 'تحديث'),
          IconButton(
            onPressed: () async {
              final ok = await showDialog<bool>(
                context: context,
                builder: (c) => AlertDialog(
                  title: const Text('تسجيل الخروج'),
                  content: const Text('ستحتاج إلى إدخال بياناتك مرّة أخرى.'),
                  actions: [
                    TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('إلغاء')),
                    FilledButton(
                      onPressed: () => Navigator.pop(c, true),
                      style: FilledButton.styleFrom(
                          backgroundColor: C.bad, minimumSize: const Size(96, 42)),
                      child: const Text('خروج'),
                    ),
                  ],
                ),
              );
              if (ok == true) await Api.instance.logout();
            },
            icon: const Icon(Icons.logout, color: C.bad),
            tooltip: 'خروج',
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: _error != null
                  ? ListView(children: [
                      Padding(
                        padding: const EdgeInsets.fromLTRB(28, 80, 28, 28),
                        child: Column(children: [
                          Icon(Icons.cloud_off, size: 52, color: dim),
                          const SizedBox(height: 16),
                          Text(_error!,
                              textAlign: TextAlign.center,
                              style: TextStyle(fontSize: 15.5, height: 1.7, color: dim)),
                          const SizedBox(height: 22),
                          FilledButton(onPressed: _load, child: const Text('إعادة المحاولة')),
                        ]),
                      )
                    ])
                  : _a == null
                      ? ListView(children: [
                          Padding(
                            padding: const EdgeInsets.fromLTRB(28, 80, 28, 28),
                            child: Text('لم نجد بيانات حسابك',
                                textAlign: TextAlign.center,
                                style: TextStyle(color: dim, fontSize: 15.5)),
                          )
                        ])
                      : _body(dark, ink, dim),
            ),
    );
  }

  Widget _body(bool dark, Color ink, Color dim) {
    final a = _a!;
    final online = a['online'] == true;
    final left = daysLeft(a['expiry_at'] as String?);
    final monthly = (numOf(a['monthly_used_mb']) ?? 0).toDouble();
    final daily = (numOf(a['daily_used_mb']) ?? 0).toDouble();
    final quota = (numOf(a['monthly_quota_mb']) ?? 0).toDouble() +
        (numOf(a['bonus_quota_mb']) ?? 0).toDouble();

    // Expiry drives the whole card's colour: it is the one thing that will cut them off.
    final tone = left == null
        ? C.brand
        : left < 0
            ? C.bad
            : left <= 3
                ? C.warn
                : C.ok;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 30),
      children: [
        // ── الحالة ──────────────────────────────────────────────────────────
        Card(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(18, 18, 18, 20),
            child: Column(children: [
              Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                Container(
                  width: 11,
                  height: 11,
                  decoration: BoxDecoration(
                      color: online ? C.ok : (dark ? C.lineD : C.line),
                      shape: BoxShape.circle),
                ),
                const SizedBox(width: 9),
                Text(online ? 'متصل الآن' : 'غير متصل',
                    style: TextStyle(
                        fontSize: 14.5,
                        fontWeight: FontWeight.w700,
                        color: online ? C.ok : dim)),
              ]),
              const SizedBox(height: 18),
              Text(
                left == null
                    ? '—'
                    : left < 0
                        ? 'انتهى'
                        : left == 0
                            ? 'ينتهي اليوم'
                            : daysLabel(left),
                style: TextStyle(
                    fontSize: left != null && left > 0 ? 34 : 28,
                    fontWeight: FontWeight.w800,
                    height: 1.15,
                    color: tone),
              ),
              const SizedBox(height: 4),
              Text(
                left != null && left > 0 ? 'متبقٍّ على اشتراكك' : 'حالة اشتراكك',
                style: TextStyle(fontSize: 13.5, color: dim),
              ),
              const SizedBox(height: 6),
              Text('ينتهي في ${fmtDate(a['expiry_at'] as String?)}',
                  style: TextStyle(fontSize: 12.5, color: dim)),
            ]),
          ),
        ),
        const SizedBox(height: 12),

        // ── الباقة ──────────────────────────────────────────────────────────
        Card(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(18, 16, 18, 16),
            child: Column(children: [
              // The plan's speed is deliberately not shown. A subscriber comparing the number on
              // screen against a speed-test result opens a support call the app cannot settle:
              // the figure is the shaping limit, not what a single test will ever measure.
              _row('الباقة', '${a['plan_name'] ?? '—'}', ink, dim),
              _row('اسم المستخدم', '${a['username'] ?? '—'}', ink, dim, ltr: true),
              if ((a['static_ip'] as String?)?.isNotEmpty ?? false)
                _row('عنوانك الثابت', '${a['static_ip']}', ink, dim, ltr: true),
            ]),
          ),
        ),
        const SizedBox(height: 12),

        // ── الاستهلاك ───────────────────────────────────────────────────────
        Card(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(18, 16, 18, 18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('استهلاكك',
                    style: TextStyle(fontSize: 15.5, fontWeight: FontWeight.w700, color: ink)),
                const SizedBox(height: 16),
                Row(children: [
                  Expanded(child: _tile('اليوم', fmtData(daily), ink, dim, dark)),
                  const SizedBox(width: 11),
                  Expanded(child: _tile('هذا الشهر', fmtData(monthly), ink, dim, dark)),
                ]),
                if (quota > 0) ...[
                  const SizedBox(height: 18),
                  Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                    Text('من حصّتك الشهرية',
                        style: TextStyle(fontSize: 13, color: dim)),
                    Text('${fmtData(monthly)} / ${fmtData(quota)}',
                        textDirection: TextDirection.ltr,
                        style: TextStyle(
                            fontSize: 13, fontWeight: FontWeight.w700, color: ink)),
                  ]),
                  const SizedBox(height: 9),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(7),
                    child: LinearProgressIndicator(
                      value: (monthly / quota).clamp(0, 1).toDouble(),
                      minHeight: 11,
                      backgroundColor: dark ? C.lineD : C.line,
                      valueColor: AlwaysStoppedAnimation(
                        monthly >= quota ? C.bad : (monthly / quota > 0.85 ? C.warn : C.brand),
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    monthly >= quota
                        ? 'استهلكت حصّتك — تواصل مع مزوّدك لشحن بيانات إضافية'
                        : 'متبقٍّ لك ${fmtData(quota - monthly)}',
                    style: TextStyle(
                        fontSize: 12.5,
                        height: 1.6,
                        color: monthly >= quota ? C.bad : dim),
                  ),
                ] else ...[
                  const SizedBox(height: 12),
                  Text('باقتك بلا حدّ استهلاك',
                      style: TextStyle(fontSize: 12.5, color: dim)),
                ],
              ],
            ),
          ),
        ),

        if (left != null && left <= 3) ...[
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(15),
            decoration: BoxDecoration(
              color: (left < 0 ? C.bad : C.warn).withValues(alpha: dark ? 0.16 : 0.09),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Row(children: [
              Icon(left < 0 ? Icons.error_outline : Icons.schedule,
                  color: left < 0 ? C.bad : C.warn, size: 22),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  left < 0
                      ? 'انتهى اشتراكك. تواصل مع مزوّدك للتجديد.'
                      : 'اشتراكك على وشك الانتهاء — جدّده قبل انقطاع الخدمة.',
                  style: TextStyle(
                      fontSize: 13.5,
                      height: 1.7,
                      fontWeight: FontWeight.w600,
                      color: left < 0 ? C.bad : C.warn),
                ),
              ),
            ]),
          ),
        ],
      ],
    );
  }

  Widget _row(String k, String v, Color ink, Color dim, {bool ltr = false}) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 7),
        child: Row(children: [
          Expanded(child: Text(k, style: TextStyle(fontSize: 13.5, color: dim))),
          Text(v,
              textDirection: ltr ? TextDirection.ltr : null,
              style: TextStyle(fontSize: 14.5, fontWeight: FontWeight.w700, color: ink)),
        ]),
      );

  Widget _tile(String k, String v, Color ink, Color dim, bool dark) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        decoration: BoxDecoration(
          color: dark ? C.bgD : C.bg,
          borderRadius: BorderRadius.circular(13),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(k, style: TextStyle(fontSize: 12.5, color: dim)),
          const SizedBox(height: 5),
          Text(v,
              style: TextStyle(fontSize: 19, fontWeight: FontWeight.w800, color: ink)),
        ]),
      );
}
