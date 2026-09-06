import 'package:flutter/material.dart';
import '../core/format.dart';
import '../core/loader.dart';
import '../core/theme.dart';
import '../widgets/common.dart';
import '../widgets/form_kit.dart';
import 'manager_form.dart';

/// Resellers, and the approvals waiting on them.
///
/// Pending accounts come first and are the reason to open this screen: a company that signed up and
/// was never approved simply never appears, and nothing else in the panel points at it.
class ManagersScreen extends StatefulWidget {
  const ManagersScreen({super.key});
  @override
  State<ManagersScreen> createState() => _ManagersScreenState();
}

class _ManagersScreenState extends State<ManagersScreen> {
  Key _key = UniqueKey();
  void _reload() => setState(() => _key = UniqueKey());

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(title: const Text('الموزّعون')),
      floatingActionButton: FloatingActionButton(
        onPressed: () async {
          if (await openForm(context, const ManagerForm())) _reload();
        },
        tooltip: 'حساب جديد',
        child: const Icon(Icons.person_add_alt),
      ),
      body: Loader<List<Map<String, dynamic>>>(
        key: _key,
        path: '/managers',
        parse: (b) => ((b is Map ? b['data'] as List? : b as List?) ?? const [])
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList(),
        isEmpty: (d) => d.isEmpty,
        emptyIcon: Icons.supervisor_account_outlined,
        emptyText: 'لا موزّعين تحت حسابك',
        builder: (context, rows, reload) {
          // Pending first: they are the only rows that need a decision.
          final pending = rows.where((m) => m['status'] == 'pending').toList();
          final rest = rows.where((m) => m['status'] != 'pending').toList();

          return ListView(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 90),
            children: [
              if (pending.isNotEmpty) ...[
                Padding(
                  padding: const EdgeInsets.only(bottom: 9),
                  child: Row(children: [
                    const Icon(Icons.pending_actions, size: 18, color: C.warning),
                    const SizedBox(width: 7),
                    Text('بانتظار الموافقة · ${pending.length}',
                        style: const TextStyle(
                            fontSize: 14, fontWeight: FontWeight.w700, color: C.warning)),
                  ]),
                ),
                for (final m in pending)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 9),
                    child: _PendingCard(m: m, dark: dark, onDone: () async {
                      await reload();
                      _reload();
                    }),
                  ),
                const SizedBox(height: 12),
              ],
              for (final m in rest)
                Padding(
                  padding: const EdgeInsets.only(bottom: 9),
                  child: _ManagerCard(m: m, dark: dark, onChanged: () async {
                    await reload();
                    _reload();
                  }),
                ),
            ],
          );
        },
      ),
    );
  }
}

class _PendingCard extends StatelessWidget {
  final Map<String, dynamic> m;
  final bool dark;
  final Future<void> Function() onDone;
  const _PendingCard({required this.m, required this.dark, required this.onDone});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(15, 13, 15, 9),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Expanded(
                child: Text('${m['company'] ?? m['full_name'] ?? m['username']}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                        fontSize: 15.5,
                        fontWeight: FontWeight.w700,
                        color: dark ? C.textD : C.text)),
              ),
              const Tag('بانتظار', tone: C.warning),
            ]),
            const SizedBox(height: 3),
            Text('${m['username']} · ${relative(m['created_at'] as String?)}',
                style: TextStyle(fontSize: 12.5, color: dark ? C.mutedD : C.muted)),
            const SizedBox(height: 4),
            Row(children: [
              TextButton.icon(
                onPressed: () async {
                  final ok = await confirm(
                    context,
                    title: 'الموافقة على الحساب',
                    body: 'سيُفعَّل الحساب ويُجهَّز له نفق وراوتر تلقائياً.',
                    action: 'موافقة',
                  );
                  if (!ok || !context.mounted) return;
                  // Provisioning builds a WireGuard tunnel, so this is slower than a normal write.
                  if (await send(context, 'POST', '/managers/${m['id']}/approve',
                      okMessage: 'تمّت الموافقة — جُهِّز النفق')) {
                    await onDone();
                  }
                },
                icon: const Icon(Icons.check_circle_outline, size: 18),
                label: const Text('موافقة'),
                style: TextButton.styleFrom(foregroundColor: C.success),
              ),
              TextButton.icon(
                onPressed: () async {
                  final ok = await confirm(
                    context,
                    title: 'رفض الطلب',
                    body: 'لن يستطيع صاحب الحساب الدخول.',
                    action: 'رفض',
                    danger: true,
                  );
                  if (!ok || !context.mounted) return;
                  if (await send(context, 'POST', '/managers/${m['id']}/reject',
                      okMessage: 'رُفض الطلب')) {
                    await onDone();
                  }
                },
                icon: const Icon(Icons.cancel_outlined, size: 18),
                label: const Text('رفض'),
                style: TextButton.styleFrom(foregroundColor: C.danger),
              ),
            ]),
          ],
        ),
      ),
    );
  }
}

class _ManagerCard extends StatelessWidget {
  final Map<String, dynamic> m;
  final bool dark;
  final Future<void> Function() onChanged;
  const _ManagerCard({required this.m, required this.dark, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    final role = switch (m['role']) {
      'owner' => 'مالك المنصّة',
      'admin' => 'شركة',
      _ => 'موزّع',
    };
    final active = m['status'] == 'active';

    return Card(
      // Tap edits, long-press resets the password: the reset is its own endpoint with its own rate
      // limit, and burying it behind a deliberate gesture keeps it off the accidental path.
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () async {
          if (await openForm(context, ManagerForm(row: m))) await onChanged();
        },
        onLongPress: () async {
          if (await openForm(context, ResetPasswordForm(row: m))) await onChanged();
        },
        child: Padding(
        padding: const EdgeInsets.fromLTRB(15, 13, 15, 13),
        child: Row(children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(children: [
                  Flexible(
                    child: Text('${m['company'] ?? m['full_name'] ?? m['username']}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w700,
                            color: dark ? C.textD : C.text)),
                  ),
                  const SizedBox(width: 8),
                  Tag(role, tone: C.indigo),
                  if (!active) ...[
                    const SizedBox(width: 6),
                    const Tag('موقوف', tone: C.danger),
                  ],
                ]),
                const SizedBox(height: 3),
                Text('${m['username']}',
                    textDirection: TextDirection.ltr,
                    textAlign: TextAlign.right,
                    style: TextStyle(fontSize: 12.5, color: dark ? C.mutedD : C.muted)),
              ],
            ),
          ),
          const SizedBox(width: 10),
          Column(crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(fmtMoney(numOf(m['balance'])),
                  style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w800,
                      color: (numOf(m['balance']) ?? 0) < 0
                          ? C.danger
                          : (dark ? C.textD : C.text))),
              Text('الرصيد',
                  style: TextStyle(fontSize: 11, color: dark ? C.mutedD : C.muted)),
            ],
          ),
        ]),
      ),
      ),
    );
  }
}
