import 'package:flutter/material.dart';
import '../core/format.dart';
import '../core/loader.dart';
import '../core/theme.dart';

/// What happened while you were not looking.
///
/// Push and Telegram are fire-and-forget: an operator whose phone was off never learned that a
/// company signed up or a subscriber burned their quota. The server now keeps a copy per recipient,
/// and this is where it is read.
class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});
  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  Key _key = UniqueKey();
  void _reload() => setState(() => _key = UniqueKey());

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(
        title: const Text('الإشعارات'),
        actions: [
          TextButton(
            onPressed: () async {
              // No ids means "all", which is the button people actually press.
              if (await send(context, 'POST', '/notifications/read',
                  body: const <String, dynamic>{}, okMessage: 'قُرئت كلها')) {
                _reload();
              }
            },
            child: const Text('تعليم الكل مقروءاً'),
          ),
        ],
      ),
      body: Loader<Map<String, dynamic>>(
        key: _key,
        path: '/notifications',
        query: const {'limit': 60},
        parse: (b) => Map<String, dynamic>.from(b as Map),
        isEmpty: (d) => ((d['data'] as List?) ?? const []).isEmpty,
        emptyIcon: Icons.notifications_none,
        emptyText: 'لا إشعارات بعد',
        builder: (context, body, reload) {
          final rows = ((body['data'] as List?) ?? const [])
              .map((e) => Map<String, dynamic>.from(e as Map))
              .toList();

          return ListView.separated(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 26),
            itemCount: rows.length,
            separatorBuilder: (_, __) => const SizedBox(height: 8),
            itemBuilder: (_, i) => _Row(
              n: rows[i],
              dark: dark,
              onRead: () async {
                await send(context, 'POST', '/notifications/read',
                    body: {'ids': [rows[i]['id']]}, okMessage: 'تم');
                await reload();
              },
            ),
          );
        },
      ),
    );
  }
}

/// Colour and icon by what the event IS, so a wall of them is scannable without reading.
({IconData icon, Color tone, String label}) _styleOf(String? kind) => switch (kind) {
      'signup' => (icon: Icons.person_add_alt, tone: C.indigo, label: 'تسجيل جديد'),
      'upgrade' => (icon: Icons.upgrade, tone: C.indigo, label: 'طلب ترقية'),
      'expiring' => (icon: Icons.schedule, tone: C.warning, label: 'اشتراك ينتهي'),
      'expired' => (icon: Icons.event_busy_outlined, tone: C.danger, label: 'اشتراك منتهٍ'),
      'charged' => (icon: Icons.payments_outlined, tone: C.success, label: 'تجديد'),
      'subscriber' => (icon: Icons.person_outline, tone: C.electric, label: 'مشترك'),
      _ => (icon: Icons.notifications_none, tone: C.muted, label: 'إشعار'),
    };

class _Row extends StatelessWidget {
  final Map<String, dynamic> n;
  final bool dark;
  final Future<void> Function() onRead;
  const _Row({required this.n, required this.dark, required this.onRead});

  @override
  Widget build(BuildContext context) {
    final unread = n['read_at'] == null;
    final s = _styleOf(n['kind'] as String?);

    return Card(
      child: InkWell(
        onTap: unread ? onRead : null,
        borderRadius: BorderRadius.circular(14),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                height: 34,
                width: 34,
                margin: const EdgeInsetsDirectional.only(end: 12),
                decoration: BoxDecoration(
                  color: s.tone.withValues(alpha: dark ? 0.2 : 0.1),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(s.icon, size: 18, color: s.tone),
              ),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(children: [
                      Expanded(
                        child: Text('${n['title'] ?? s.label}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                                fontSize: 14.5,
                                // Weight carries unread, not a coloured background: a list where
                                // half the rows are tinted stops distinguishing anything.
                                fontWeight: unread ? FontWeight.w800 : FontWeight.w500,
                                color: dark ? C.textD : C.text)),
                      ),
                      if (unread) ...[
                        const SizedBox(width: 8),
                        Container(
                          width: 8,
                          height: 8,
                          decoration: const BoxDecoration(
                              color: C.electric, shape: BoxShape.circle),
                        ),
                      ],
                    ]),
                    if ((n['body'] as String?)?.isNotEmpty ?? false) ...[
                      const SizedBox(height: 3),
                      Text('${n['body']}',
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                              fontSize: 13,
                              height: 1.6,
                              color: dark ? C.mutedD : C.muted)),
                    ],
                    const SizedBox(height: 5),
                    Row(children: [
                      Text(relative(n['created_at'] as String?),
                          style: TextStyle(
                              fontSize: 11.5, color: dark ? C.mutedD : C.muted)),
                      if ((n['subject'] as String?)?.isNotEmpty ?? false) ...[
                        const SizedBox(width: 8),
                        Flexible(
                          child: Text('· ${n['subject']}',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                  fontSize: 11.5, color: dark ? C.mutedD : C.muted)),
                        ),
                      ],
                    ]),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
