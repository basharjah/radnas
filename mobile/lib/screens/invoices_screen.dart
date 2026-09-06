import 'package:flutter/material.dart';
import '../core/format.dart';
import '../core/loader.dart';
import '../core/theme.dart';
import '../widgets/common.dart';

/// Invoices, with the one action a phone is good for: marking a paid one paid.
class InvoicesScreen extends StatefulWidget {
  const InvoicesScreen({super.key});
  @override
  State<InvoicesScreen> createState() => _InvoicesScreenState();
}

class _InvoicesScreenState extends State<InvoicesScreen> {
  String _status = 'all';
  Key _key = UniqueKey();

  void _refilter(String s) => setState(() {
        _status = s;
        _key = UniqueKey(); // remount the loader so it refetches with the new query
      });

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(title: const Text('الفواتير')),
      body: Column(children: [
        SizedBox(
          height: 46,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
            children: [
              for (final e in const {'all': 'الكل', 'unpaid': 'غير مدفوعة', 'paid': 'مدفوعة'}.entries)
                Padding(
                  padding: const EdgeInsetsDirectional.only(end: 8),
                  child: ChoiceChip(
                    label: Text(e.value),
                    selected: _status == e.key,
                    onSelected: (_) => _refilter(e.key),
                  ),
                ),
            ],
          ),
        ),
        Expanded(
          child: Loader<Map<String, dynamic>>(
            key: _key,
            path: '/invoices',
            query: {'limit': 50, if (_status != 'all') 'status': _status},
            parse: (b) => Map<String, dynamic>.from(b as Map),
            isEmpty: (d) => ((d['data'] as List?) ?? const []).isEmpty,
            emptyIcon: Icons.receipt_long_outlined,
            emptyText: 'لا فواتير في هذا التصنيف',
            builder: (context, body, reload) {
              final rows = ((body['data'] as List?) ?? const [])
                  .map((e) => Map<String, dynamic>.from(e as Map))
                  .toList();
              final totals = body['totals'] is Map
                  ? Map<String, dynamic>.from(body['totals'] as Map)
                  : const <String, dynamic>{};

              return ListView(
                padding: const EdgeInsets.fromLTRB(14, 6, 14, 26),
                children: [
                  if (totals.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Row(children: [
                        Expanded(
                          child: StatTile(
                            label: 'الإجمالي',
                            value: fmtMoney(numOf(totals['total'])),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: StatTile(
                            label: 'غير مدفوع',
                            value: fmtMoney(numOf(totals['unpaid'])),
                            tone: (numOf(totals['unpaid']) ?? 0) > 0 ? C.warning : null,
                          ),
                        ),
                      ]),
                    ),
                  for (final inv in rows)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 9),
                      child: _InvoiceCard(inv: inv, dark: dark, onChanged: reload),
                    ),
                ],
              );
            },
          ),
        ),
      ]),
    );
  }
}

class _InvoiceCard extends StatelessWidget {
  final Map<String, dynamic> inv;
  final bool dark;
  final Future<void> Function() onChanged;
  const _InvoiceCard({required this.inv, required this.dark, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    final paid = inv['status'] == 'paid';

    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(15, 13, 15, 11),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Expanded(
                child: Text('${inv['subscriber_username'] ?? inv['description'] ?? '—'}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    textDirection: TextDirection.ltr,
                    textAlign: TextAlign.right,
                    style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: dark ? C.textD : C.text)),
              ),
              const SizedBox(width: 8),
              Tag(paid ? 'مدفوعة' : 'غير مدفوعة', tone: paid ? C.success : C.warning),
            ]),
            const SizedBox(height: 5),
            Row(children: [
              Text('#${inv['number'] ?? '—'}',
                  textDirection: TextDirection.ltr,
                  style: TextStyle(fontSize: 12, color: dark ? C.mutedD : C.muted)),
              const SizedBox(width: 10),
              Text(fmtDate(inv['issued_at'] as String?),
                  style: TextStyle(fontSize: 12, color: dark ? C.mutedD : C.muted)),
              const Spacer(),
              Text(fmtMoney(numOf(inv['amount'])),
                  style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                      color: dark ? C.textD : C.text)),
            ]),
            const SizedBox(height: 4),
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: TextButton.icon(
                onPressed: () async {
                  final ok = await confirm(
                    context,
                    title: paid ? 'إلغاء الدفع' : 'تسجيل الدفع',
                    body: paid
                        ? 'ستعود الفاتورة إلى «غير مدفوعة».'
                        : 'ستُسجَّل الفاتورة مدفوعة بتاريخ اليوم.',
                    action: paid ? 'إلغاء الدفع' : 'تسجيل الدفع',
                    danger: paid,
                  );
                  if (!ok || !context.mounted) return;
                  final done = await send(
                    context,
                    'POST',
                    '/invoices/${inv['id']}/${paid ? 'unpay' : 'pay'}',
                    okMessage: paid ? 'أُلغي الدفع' : 'سُجّل الدفع',
                  );
                  if (done) await onChanged();
                },
                icon: Icon(paid ? Icons.undo : Icons.check_circle_outline, size: 18),
                label: Text(paid ? 'إلغاء الدفع' : 'تسجيل الدفع'),
                style: TextButton.styleFrom(foregroundColor: paid ? C.muted : C.success),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
