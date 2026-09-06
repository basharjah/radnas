import 'package:flutter/material.dart';
import '../core/format.dart';
import '../core/loader.dart';
import '../core/theme.dart';
import '../widgets/common.dart';

/// The read-mostly admin pages, which share one shape: fetch, summarise, list.
///
/// They live together because splitting four near-identical files apart buys nothing and makes the
/// next change happen four times.

// ── الحركات المالية ──────────────────────────────────────────────────────────
class TransactionsScreen extends StatelessWidget {
  const TransactionsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(title: const Text('الحركات المالية')),
      body: Loader<List<Map<String, dynamic>>>(
        path: '/transactions',
        query: const {'limit': 60},
        parse: (b) => ((b is Map ? b['data'] as List? : b as List?) ?? const [])
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList(),
        isEmpty: (d) => d.isEmpty,
        emptyIcon: Icons.account_balance_wallet_outlined,
        emptyText: 'لا حركات مسجّلة',
        builder: (context, rows, reload) => ListView.separated(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 26),
          itemCount: rows.length,
          separatorBuilder: (_, __) => const SizedBox(height: 8),
          itemBuilder: (_, i) {
            final t = rows[i];
            final amount = numOf(t['amount']) ?? 0;
            // Sign carries the meaning here, so it drives the colour rather than the label.
            final credit = amount >= 0;
            return Card(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(15, 12, 15, 12),
                child: Row(children: [
                  Icon(credit ? Icons.south_west : Icons.north_east,
                      size: 18, color: credit ? C.success : C.danger),
                  const SizedBox(width: 11),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('${t['description'] ?? t['kind'] ?? '—'}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                                fontSize: 14.5,
                                fontWeight: FontWeight.w600,
                                color: dark ? C.textD : C.text)),
                        const SizedBox(height: 2),
                        Text(relative(t['created_at'] as String?),
                            style: TextStyle(
                                fontSize: 12, color: dark ? C.mutedD : C.muted)),
                      ],
                    ),
                  ),
                  Text(
                    '${credit ? '+' : '−'}${fmtMoney(amount.abs())}',
                    textDirection: TextDirection.ltr,
                    style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w800,
                        color: credit ? C.success : C.danger),
                  ),
                ]),
              ),
            );
          },
        ),
      ),
    );
  }
}

// ── التقارير ─────────────────────────────────────────────────────────────────
class ReportsScreen extends StatelessWidget {
  const ReportsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('التقارير')),
      body: Loader<Map<String, dynamic>>(
        path: '/reports/summary',
        parse: (b) => Map<String, dynamic>.from(b as Map),
        builder: (context, r, reload) => ListView(
          padding: const EdgeInsets.fromLTRB(14, 14, 14, 28),
          children: [
            Row(children: [
              Expanded(child: StatTile(
                  label: 'دخل هذا الشهر',
                  value: fmtMoney(numOf(r['income_this_month'])),
                  tone: C.success)),
              const SizedBox(width: 10),
              Expanded(child: StatTile(
                  label: 'دخل 12 شهراً', value: fmtMoney(numOf(r['income_12mo'])))),
            ]),
            const SizedBox(height: 10),
            Row(children: [
              Expanded(child: StatTile(label: 'مفعّل', value: '${r['active'] ?? 0}')),
              const SizedBox(width: 10),
              Expanded(child: StatTile(
                  label: 'منتهٍ', value: '${r['expired'] ?? 0}', tone: C.warning)),
            ]),
            const SizedBox(height: 10),
            Row(children: [
              Expanded(child: StatTile(
                  label: 'ينتهي خلال 7 أيام',
                  value: '${r['expiring7d'] ?? 0}',
                  tone: (numOf(r['expiring7d']) ?? 0) > 0 ? C.warning : null)),
              const SizedBox(width: 10),
              Expanded(child: StatTile(
                  label: 'فواتير مدفوعة', value: '${r['paid_invoices_12mo'] ?? 0}')),
            ]),
            const SizedBox(height: 18),
            _MonthlyBars(monthly: (r['monthly'] as List?) ?? const []),
          ],
        ),
      ),
    );
  }
}

/// Twelve months of income, drawn rather than tabulated — the shape is the point.
class _MonthlyBars extends StatelessWidget {
  final List<dynamic> monthly;
  const _MonthlyBars({required this.monthly});

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    if (monthly.isEmpty) return const SizedBox.shrink();

    final rows = monthly.map((e) => Map<String, dynamic>.from(e as Map)).toList();
    final max = rows.fold<double>(
        0.0001, (m, e) => (numOf(e['income'])?.toDouble() ?? 0) > m
            ? numOf(e['income'])!.toDouble()
            : m);

    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('الدخل الشهري',
                style: TextStyle(
                    fontSize: 15, fontWeight: FontWeight.w700, color: dark ? C.textD : C.text)),
            const SizedBox(height: 16),
            SizedBox(
              height: 130,
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  for (final m in rows)
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 2.5),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.end,
                          children: [
                            Container(
                              height: ((numOf(m['income'])?.toDouble() ?? 0) / max) * 100 + 3,
                              decoration: BoxDecoration(
                                color: C.electric,
                                borderRadius: const BorderRadius.vertical(
                                    top: Radius.circular(4)),
                              ),
                            ),
                            const SizedBox(height: 6),
                            Text(
                              '${m['month'] ?? ''}'.split('-').last,
                              style: TextStyle(
                                  fontSize: 10, color: dark ? C.mutedD : C.muted),
                            ),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── هوت سبوت ─────────────────────────────────────────────────────────────────
class HotspotScreen extends StatelessWidget {
  const HotspotScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(title: const Text('هوت سبوت')),
      body: Loader<List<Map<String, dynamic>>>(
        path: '/hotspot/batches',
        parse: (b) => ((b is Map ? b['data'] as List? : b as List?) ?? const [])
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList(),
        isEmpty: (d) => d.isEmpty,
        emptyIcon: Icons.wifi_password_outlined,
        emptyText: 'لا دفعات كروت — أنشئها من اللوحة على الويب',
        builder: (context, rows, reload) => ListView.separated(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 26),
          itemCount: rows.length,
          separatorBuilder: (_, __) => const SizedBox(height: 9),
          itemBuilder: (_, i) {
            final b = rows[i];
            final used = numOf(b['used'])?.toInt() ?? 0;
            final count = numOf(b['count'])?.toInt() ?? 0;
            return Card(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(15, 13, 15, 14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(children: [
                      Expanded(
                        child: Text('${b['name'] ?? b['prefix'] ?? 'دفعة'}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.w700,
                                color: dark ? C.textD : C.text)),
                      ),
                      Text('$used / $count',
                          textDirection: TextDirection.ltr,
                          style: TextStyle(
                              fontSize: 13.5,
                              fontWeight: FontWeight.w700,
                              color: dark ? C.mutedD : C.muted)),
                    ]),
                    const SizedBox(height: 9),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(5),
                      child: LinearProgressIndicator(
                        value: count == 0 ? 0 : (used / count).clamp(0, 1).toDouble(),
                        minHeight: 7,
                        backgroundColor: dark ? C.borderD : C.border,
                        valueColor: const AlwaysStoppedAnimation(C.cyan),
                      ),
                    ),
                    const SizedBox(height: 7),
                    Text(relative(b['created_at'] as String?),
                        style: TextStyle(fontSize: 11.5, color: dark ? C.mutedD : C.muted)),
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

// ── النسخ الاحتياطية ─────────────────────────────────────────────────────────
class BackupsScreen extends StatefulWidget {
  const BackupsScreen({super.key});
  @override
  State<BackupsScreen> createState() => _BackupsScreenState();
}

class _BackupsScreenState extends State<BackupsScreen> {
  Key _key = UniqueKey();

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(title: const Text('النسخ الاحتياطية')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          final ok = await confirm(
            context,
            title: 'إنشاء نسخة الآن',
            body: 'ستُؤخذ نسخة كاملة من قاعدة البيانات. قد تستغرق دقيقة.',
            action: 'إنشاء',
          );
          if (!ok || !context.mounted) return;
          if (await send(context, 'POST', '/backups', okMessage: 'أُنشئت النسخة')) {
            setState(() => _key = UniqueKey());
          }
        },
        icon: const Icon(Icons.add),
        label: const Text('نسخة الآن'),
      ),
      body: Loader<List<Map<String, dynamic>>>(
        key: _key,
        path: '/backups',
        parse: (b) => ((b is Map ? b['data'] as List? : b as List?) ?? const [])
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList(),
        isEmpty: (d) => d.isEmpty,
        emptyIcon: Icons.backup_outlined,
        emptyText: 'لا نسخ بعد',
        builder: (context, rows, reload) => ListView.separated(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 90),
          itemCount: rows.length,
          separatorBuilder: (_, __) => const SizedBox(height: 8),
          itemBuilder: (_, i) {
            final b = rows[i];
            final bytes = numOf(b['size'])?.toDouble() ?? 0;
            return Card(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(15, 12, 15, 12),
                child: Row(children: [
                  const Icon(Icons.description_outlined, size: 19, color: C.indigo),
                  const SizedBox(width: 11),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('${b['name']}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            textDirection: TextDirection.ltr,
                            textAlign: TextAlign.right,
                            style: TextStyle(
                                fontSize: 13.5,
                                fontWeight: FontWeight.w600,
                                color: dark ? C.textD : C.text)),
                        const SizedBox(height: 2),
                        Text(relative(b['created_at'] as String? ?? b['mtime'] as String?),
                            style: TextStyle(
                                fontSize: 11.5, color: dark ? C.mutedD : C.muted)),
                      ],
                    ),
                  ),
                  Text(fmtData(bytes / 1048576),
                      style: TextStyle(fontSize: 12.5, color: dark ? C.mutedD : C.muted)),
                ]),
              ),
            );
          },
        ),
      ),
    );
  }
}
