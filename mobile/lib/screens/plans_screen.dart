import 'package:flutter/material.dart';
import '../core/format.dart';
import '../core/loader.dart';
import '../core/theme.dart';
import '../widgets/form_kit.dart';
import 'plan_form.dart';

/// The tariffs everything else prices against.
class PlansScreen extends StatefulWidget {
  const PlansScreen({super.key});
  @override
  State<PlansScreen> createState() => _PlansScreenState();
}

class _PlansScreenState extends State<PlansScreen> {
  Key _key = UniqueKey();
  void _reload() => setState(() => _key = UniqueKey());

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(title: const Text('الباقات')),
      floatingActionButton: FloatingActionButton(
        onPressed: () async {
          if (await openForm(context, const PlanForm())) _reload();
        },
        tooltip: 'باقة جديدة',
        child: const Icon(Icons.add),
      ),
      body: Loader<List<Map<String, dynamic>>>(
        key: _key,
        path: '/plans',
        parse: (b) => ((b is Map ? b['data'] as List? : b as List?) ?? const [])
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList(),
        isEmpty: (d) => d.isEmpty,
        emptyIcon: Icons.local_offer_outlined,
        emptyText: 'لا باقات بعد — أنشئها من اللوحة على الويب',
        builder: (context, rows, reload) => ListView.separated(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 90),
          itemCount: rows.length,
          separatorBuilder: (_, __) => const SizedBox(height: 9),
          itemBuilder: (_, i) {
            final p = rows[i];
            final down = p['download_speed'];
            final up = p['upload_speed'];
            final quota = numOf(p['monthly_quota_mb']) ?? 0;

            return Card(
              child: InkWell(
                borderRadius: BorderRadius.circular(14),
                onTap: () async {
                  if (await openForm(context, PlanForm(row: p))) reload();
                },
                onLongPress: () async {
                  if (await deleteThing(context,
                      path: '/plans/${p['id']}', what: 'الباقة', name: '${p['name']}')) {
                    await reload();
                  }
                },
                child: Padding(
                padding: const EdgeInsets.fromLTRB(15, 13, 15, 14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(children: [
                      Expanded(
                        child: Text('${p['name']}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w700,
                                color: dark ? C.textD : C.text)),
                      ),
                      Text(fmtMoney(numOf(p['price'])),
                          style: const TextStyle(
                              fontSize: 16, fontWeight: FontWeight.w800, color: C.electric)),
                    ]),
                    const SizedBox(height: 8),
                    Wrap(spacing: 8,
                      runSpacing: 6,
                      children: [
                        if (down != null || up != null)
                          _Chip(
                            icon: Icons.speed,
                            // Order matters and is easy to invert: RADIUS sends rx/tx from the
                            // router's side, so download is what the subscriber pulls.
                            text: '$down↓ / $up↑',
                            dark: dark,
                          ),
                        _Chip(
                          icon: Icons.calendar_today_outlined,
                          text: durationLabel(
                              (p['duration_value'])?.toInt(), p['duration_unit'] as String?),
                          dark: dark,
                        ),
                        _Chip(
                          icon: Icons.data_usage,
                          text: quota > 0 ? fmtData(quota) : 'بلا حصّة',
                          dark: dark,
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              ),
            );
          },
        ),
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  final IconData icon;
  final String text;
  final bool dark;
  const _Chip({required this.icon, required this.text, required this.dark});

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
        decoration: BoxDecoration(
          color: dark ? C.surface2D : C.surface2,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 14, color: dark ? C.mutedD : C.muted),
          const SizedBox(width: 5),
          Text(text,
              textDirection: TextDirection.ltr,
              style: TextStyle(fontSize: 12, color: dark ? C.mutedD : C.muted)),
        ]),
      );
}
