import 'package:flutter/material.dart';
import '../core/auth.dart';
import '../core/format.dart';
import '../core/loader.dart';
import '../core/theme.dart';
import '../widgets/common.dart';
import '../widgets/form_kit.dart';

/// The account's own settings, the notification channel, and the two owner-only ledgers.

// ── إعدادات الحساب ───────────────────────────────────────────────────────────
class AccountSettingsScreen extends StatelessWidget {
  const AccountSettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final u = Auth.instance.user;
    return Scaffold(
      appBar: AppBar(title: const Text('إعدادات الحساب')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(children: [
                Field('اسم المستخدم', u?.username ?? '—', ltr: true),
                Field('الاسم', u?.display ?? '—'),
                Field(
                  'الدور',
                  switch (u?.role) {
                    'owner' => 'مالك المنصّة',
                    'admin' => 'شركة إنترنت',
                    _ => 'موزّع',
                  },
                ),
              ]),
            ),
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: () => openForm(context, const _ProfileForm()),
            icon: const Icon(Icons.edit_outlined),
            label: const Text('تعديل البيانات'),
          ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: () => openForm(context, const _PasswordForm()),
            icon: const Icon(Icons.lock_reset),
            label: const Text('تغيير كلمة المرور'),
          ),
        ],
      ),
    );
  }
}

class _ProfileForm extends StatefulWidget {
  const _ProfileForm();
  @override
  State<_ProfileForm> createState() => _ProfileFormState();
}

class _ProfileFormState extends State<_ProfileForm> {
  final _fullName = TextEditingController(text: Auth.instance.user?.fullName ?? '');
  final _phone = TextEditingController();
  final _email = TextEditingController();

  @override
  void dispose() {
    _fullName.dispose();
    _phone.dispose();
    _email.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => FormPage(
        title: 'تعديل البيانات',
        method: 'POST',
        path: '/auth/profile',
        okMessage: 'حُفظت البيانات',
        body: () => compact({
          'full_name': orNull(_fullName),
          'phone': orNull(_phone),
          'email': orNull(_email),
        }),
        fields: (context, rebuild) => [
          FormText(controller: _fullName, label: 'الاسم الكامل', icon: Icons.badge_outlined),
          FormText(
            controller: _phone,
            label: 'الهاتف',
            ltr: true,
            keyboard: TextInputType.phone,
            icon: Icons.phone_outlined,
          ),
          FormText(
            controller: _email,
            label: 'البريد',
            ltr: true,
            keyboard: TextInputType.emailAddress,
            icon: Icons.mail_outline,
          ),
        ],
      );
}

class _PasswordForm extends StatefulWidget {
  const _PasswordForm();
  @override
  State<_PasswordForm> createState() => _PasswordFormState();
}

class _PasswordFormState extends State<_PasswordForm> {
  final _current = TextEditingController();
  final _next = TextEditingController();

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => FormPage(
        title: 'تغيير كلمة المرور',
        method: 'POST',
        path: '/auth/change-password',
        submitLabel: 'تغيير',
        okMessage: 'تغيّرت كلمة المرور',
        body: () => {
          'current_password': _current.text,
          'new_password': _next.text,
        },
        fields: (context, rebuild) => [
          FormText(
            controller: _current,
            label: 'كلمة المرور الحالية',
            required: true,
            obscure: true,
            ltr: true,
            icon: Icons.lock_outline,
          ),
          FormText(
            controller: _next,
            label: 'كلمة المرور الجديدة',
            required: true,
            obscure: true,
            ltr: true,
            icon: Icons.lock_reset,
            // The server enforces eight; saying so here avoids a round trip to be told.
            hint: '8 أحرف على الأقل',
          ),
        ],
      );
}

// ── تيليجرام ─────────────────────────────────────────────────────────────────
class TelegramScreen extends StatefulWidget {
  const TelegramScreen({super.key});
  @override
  State<TelegramScreen> createState() => _TelegramScreenState();
}

class _TelegramScreenState extends State<TelegramScreen> {
  Key _key = UniqueKey();

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(title: const Text('تيليجرام')),
      body: Loader<Map<String, dynamic>>(
        key: _key,
        path: '/telegram',
        parse: (b) => Map<String, dynamic>.from(b as Map),
        builder: (context, cfg, reload) {
          final ids = '${cfg['chat_ids'] ?? ''}';
          final ownBot = cfg['has_own_bot'] == true;

          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
            children: [
              Text(
                'تصلك إشعارات المنصّة على تيليجرام: تسجيل جديد، اشتراك ينتهي، مشترك يتجاوز حصّته.',
                style: TextStyle(fontSize: 14, height: 1.8, color: dark ? C.mutedD : C.muted),
              ),
              const SizedBox(height: 16),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(children: [
                    Field('المعرّفات', ids.isEmpty ? '— لم تُضبط —' : ids, ltr: ids.isNotEmpty),
                    Field('البوت', ownBot ? 'بوت خاص بك' : 'بوت المنصّة'),
                  ]),
                ),
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: () async {
                  if (await openForm(context, _TelegramForm(chatIds: ids))) {
                    setState(() => _key = UniqueKey());
                  }
                },
                icon: const Icon(Icons.edit_outlined),
                label: const Text('تعديل الإعداد'),
              ),
              const SizedBox(height: 10),
              OutlinedButton.icon(
                onPressed: () => send(context, 'POST', '/telegram/test',
                    okMessage: 'أُرسلت رسالة تجريبية'),
                icon: const Icon(Icons.send_outlined),
                label: const Text('إرسال رسالة تجريبية'),
              ),
              const SizedBox(height: 10),
              OutlinedButton.icon(
                // Reads the bot's recent updates so the operator does not have to hunt for a
                // numeric chat id in another app.
                onPressed: () => send(context, 'POST', '/telegram/discover',
                    okMessage: 'ابحث في النتيجة عن معرّفك'),
                icon: const Icon(Icons.search),
                label: const Text('اكتشاف المعرّف'),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _TelegramForm extends StatefulWidget {
  final String chatIds;
  const _TelegramForm({required this.chatIds});
  @override
  State<_TelegramForm> createState() => _TelegramFormState();
}

class _TelegramFormState extends State<_TelegramForm> {
  late final _ids = TextEditingController(text: widget.chatIds);
  final _token = TextEditingController();

  @override
  void dispose() {
    _ids.dispose();
    _token.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => FormPage(
        title: 'إعداد تيليجرام',
        method: 'PUT',
        path: '/telegram',
        body: () => compact({
          'chat_ids': _ids.text.trim(),
          'bot_token': orNull(_token),
        }),
        fields: (context, rebuild) => [
          FormText(
            controller: _ids,
            label: 'معرّفات المحادثات',
            ltr: true,
            icon: Icons.tag,
            hint: 'افصل بينها بفاصلة',
          ),
          FormText(
            controller: _token,
            label: 'رمز البوت الخاص (اختياري)',
            ltr: true,
            icon: Icons.smart_toy_outlined,
            hint: 'اتركه فارغاً لاستعمال بوت المنصّة',
          ),
        ],
      );
}

// ── سجلّ التدقيق (للأونر) ────────────────────────────────────────────────────
class AuditScreen extends StatelessWidget {
  const AuditScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(title: const Text('سجلّ التدقيق')),
      body: Loader<List<Map<String, dynamic>>>(
        path: '/audit',
        query: const {'limit': 80},
        parse: (b) => ((b is Map ? b['data'] as List? : b as List?) ?? const [])
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList(),
        isEmpty: (d) => d.isEmpty,
        emptyIcon: Icons.history,
        emptyText: 'لا أحداث مسجّلة',
        builder: (context, rows, reload) => ListView.separated(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 26),
          itemCount: rows.length,
          separatorBuilder: (_, __) => const SizedBox(height: 7),
          itemBuilder: (_, i) {
            final a = rows[i];
            return Card(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(14, 11, 14, 11),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(children: [
                      Expanded(
                        child: Text('${a['action'] ?? '—'}',
                            textDirection: TextDirection.ltr,
                            textAlign: TextAlign.right,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                                fontSize: 13.5,
                                fontWeight: FontWeight.w700,
                                color: dark ? C.textD : C.text)),
                      ),
                      Text(relative(a['created_at'] as String?),
                          style: TextStyle(
                              fontSize: 11.5, color: dark ? C.mutedD : C.muted)),
                    ]),
                    const SizedBox(height: 3),
                    Text(
                      [
                        if (a['performed_by_name'] != null) '${a['performed_by_name']}',
                        if (a['target_id'] != null) '${a['target_id']}',
                      ].join(' ← '),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 12, color: dark ? C.mutedD : C.muted),
                    ),
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

// ── WireGuard (للأونر) ───────────────────────────────────────────────────────
class WireGuardScreen extends StatelessWidget {
  const WireGuardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(title: const Text('WireGuard')),
      body: Loader<List<Map<String, dynamic>>>(
        path: '/wireguard',
        parse: (b) => ((b is Map ? b['data'] as List? : b as List?) ?? const [])
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList(),
        isEmpty: (d) => d.isEmpty,
        emptyIcon: Icons.vpn_key_outlined,
        emptyText: 'لا أنفاق بعد',
        builder: (context, rows, reload) => ListView.separated(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 26),
          itemCount: rows.length,
          separatorBuilder: (_, __) => const SizedBox(height: 9),
          itemBuilder: (_, i) {
            final p = rows[i];
            return Card(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(15, 13, 15, 13),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(children: [
                      Expanded(
                        child: Text('${p['name'] ?? p['iface'] ?? '—'}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.w700,
                                color: dark ? C.textD : C.text)),
                      ),
                      if (p['iface'] != null) Tag('${p['iface']}', tone: C.indigo),
                    ]),
                    const SizedBox(height: 6),
                    Field('عنوان النفق', '${p['tunnel_ip'] ?? '—'}', ltr: true),
                    Field('بركة المشتركين', '${p['pool_cidr'] ?? '—'}', ltr: true),
                    Field('المنفذ', '${p['listen_port'] ?? '—'}', ltr: true),
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

// ── إعدادات المنصّة (للأونر) ─────────────────────────────────────────────────
class PlatformSettingsScreen extends StatelessWidget {
  const PlatformSettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(title: const Text('إعدادات المنصّة')),
      body: Loader<Map<String, dynamic>>(
        path: '/settings',
        parse: (b) => Map<String, dynamic>.from(b as Map),
        builder: (context, cfg, reload) => ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    for (final e in cfg.entries)
                      Field(e.key, '${e.value ?? '—'}',
                          ltr: e.value is num || '${e.value}'.startsWith('http')),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 14),
            Text(
              'تعديل هذه القيم يؤثّر على كل الشركات على المنصّة، فهو متاح من اللوحة على الويب فقط.',
              style: TextStyle(fontSize: 13, height: 1.8, color: dark ? C.mutedD : C.muted),
            ),
          ],
        ),
      ),
    );
  }
}
