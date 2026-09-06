import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import '../core/format.dart';
import '../core/api.dart';
import '../core/auth.dart';
import '../core/theme.dart';
import '../widgets/logo.dart';

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});
  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  Map<String, dynamic>? _stats;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      // /dashboard is the prefix, not an endpoint — the stats live one level down. Calling the
      // prefix answers 404, which the app was showing as an empty dashboard rather than an error.
      final res = await Api.instance.dio.get('/dashboard/stats');
      if (!mounted) return;
      if (res.statusCode == 200 && res.data is Map) {
        setState(() {
          _stats = Map<String, dynamic>.from(res.data);
          _loading = false;
        });
      } else {
        setState(() {
          _error = Api.errorOf(res);
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

  int _n(String k) => numOf(_stats?[k])?.round() ?? 0;

  @override
  Widget build(BuildContext context) {
    final u = Auth.instance.user;
    final dark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(
        // The mark rather than the page name: this is the app's first screen, and the name of the
        // company is what an operator opening it wants confirmed — not that they are on a dashboard.
        title: const BrandLogo(height: 30),
        centerTitle: false,
        actions: [
          IconButton(
            onPressed: _load,
            icon: const Icon(Icons.refresh),
            tooltip: 'تحديث',
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : ListView(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 28),
                children: [
                  if (u != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 18),
                      child: Text('أهلاً ${u.display}',
                          style: TextStyle(
                              fontSize: 16.5,
                              fontWeight: FontWeight.w600,
                              color: dark ? C.mutedD : C.muted)),
                    ),
                  if (_error != null) _ErrorBox(message: _error!, onRetry: _load),

                  // The two numbers an ISP checks first: who is online right now, and who is about
                  // to stop paying. Everything else is context for these.
                  Row(children: [
                    Expanded(
                      child: _Tile(
                        label: 'متصل الآن',
                        value: '${_n('online')}',
                        icon: Icons.wifi_tethering,
                        tone: C.success,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: _Tile(
                        label: 'ينتهي خلال 7 أيام',
                        value: '${_n('expiring_7d')}',
                        icon: Icons.schedule,
                        tone: _n('expiring_7d') > 0 ? C.warning : C.muted,
                      ),
                    ),
                  ]),
                  const SizedBox(height: 12),
                  Row(children: [
                    Expanded(
                      child: _Tile(
                        label: 'مشترك مفعّل',
                        value: '${_n('active')}',
                        icon: Icons.verified_user_outlined,
                        tone: C.electric,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: _Tile(
                        label: 'منتهٍ',
                        value: '${_n('expired')}',
                        icon: Icons.event_busy_outlined,
                        tone: C.warning,
                      ),
                    ),
                  ]),
                  const SizedBox(height: 12),
                  Row(children: [
                    Expanded(
                      child: _Tile(
                        label: 'موقوف',
                        value: '${_n('disabled')}',
                        icon: Icons.block_outlined,
                        tone: C.danger,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: _Tile(
                        label: 'الإجمالي',
                        value: '${_n('total_subscribers')}',
                        icon: Icons.groups_outlined,
                        tone: C.indigo,
                      ),
                    ),
                  ]),
                  const SizedBox(height: 20),
                  _Row2(
                    left: _Mini(label: 'الباقات', value: '${_n('plans')}'),
                    right: _Mini(label: 'الموزّعون', value: '${_n('managers')}'),
                  ),
                  const SizedBox(height: 10),
                  _Row2(
                    left: _Mini(label: 'جديد هذا الشهر', value: '${_n('new_this_month')}'),
                    right: _Mini(
                      label: 'النمو',
                      value: '${numOf(_stats?['growth_pct'])?.toStringAsFixed(1) ?? '0'}%',
                    ),
                  ),
                ],
              ),
      ),
    );
  }
}

class _Tile extends StatelessWidget {
  final String label, value;
  final IconData icon;
  final Color tone;
  const _Tile({required this.label, required this.value, required this.icon, required this.tone});

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 14, 14, 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Container(
                height: 32,
                width: 32,
                decoration: BoxDecoration(
                  color: tone.withValues(alpha: dark ? 0.2 : 0.1),
                  borderRadius: BorderRadius.circular(9),
                ),
                child: Icon(icon, size: 18, color: tone),
              ),
              const Spacer(),
            ]),
            const SizedBox(height: 12),
            Text(value,
                style: TextStyle(
                    fontSize: 27,
                    fontWeight: FontWeight.w800,
                    height: 1.1,
                    color: dark ? C.textD : C.text)),
            const SizedBox(height: 3),
            Text(label,
                style: TextStyle(fontSize: 12.5, color: dark ? C.mutedD : C.muted)),
          ],
        ),
      ),
    );
  }
}

class _Mini extends StatelessWidget {
  final String label, value;
  const _Mini({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(label, style: TextStyle(fontSize: 13.5, color: dark ? C.mutedD : C.muted)),
            Text(value,
                style: TextStyle(
                    fontSize: 16, fontWeight: FontWeight.w700, color: dark ? C.textD : C.text)),
          ],
        ),
      ),
    );
  }
}

class _Row2 extends StatelessWidget {
  final Widget left, right;
  const _Row2({required this.left, required this.right});
  @override
  Widget build(BuildContext context) =>
      Row(children: [Expanded(child: left), const SizedBox(width: 10), Expanded(child: right)]);
}

class _ErrorBox extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;
  const _ErrorBox({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: C.danger.withValues(alpha: dark ? 0.16 : 0.08),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(children: [
        const Icon(Icons.error_outline, color: C.danger, size: 20),
        const SizedBox(width: 10),
        Expanded(child: Text(message, style: const TextStyle(color: C.danger, height: 1.6))),
        TextButton(onPressed: onRetry, child: const Text('إعادة')),
      ]),
    );
  }
}
