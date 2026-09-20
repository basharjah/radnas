import 'package:flutter/material.dart';
import '../core/auth.dart';
import '../core/theme.dart';
import '../screens/login_screen.dart';

/// The accounts an operator holds on one phone, and the way between them.
///
/// An ISP owner signs in as themselves, then as the company account to check something a reseller
/// reported, then back. Doing that through sign-out and sign-in costs two passwords each way, so
/// the sheet keeps every account that has been used on the device and switches with the token it
/// already holds. An account whose token has expired stays in the list as a name: returning to it
/// is one password, not two fields.
Future<void> showAccountSheet(BuildContext context) async {
  await showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    isScrollControlled: true,
    builder: (_) => const _AccountSheet(),
  );
}

class _AccountSheet extends StatefulWidget {
  const _AccountSheet();
  @override
  State<_AccountSheet> createState() => _AccountSheetState();
}

class _AccountSheetState extends State<_AccountSheet> {
  String? _busyId;

  Future<void> _pick(SavedAccount a) async {
    final auth = Auth.instance;
    if (a.id == auth.user?.id) {
      Navigator.pop(context);
      return;
    }

    if (!a.ready) {
      // No live token: the switch is a sign-in, so hand the login screen the username and let it
      // ask only for what is actually missing.
      Navigator.pop(context);
      await Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => LoginScreen(prefill: a.username, asSwitch: true)),
      );
      return;
    }

    setState(() => _busyId = a.id);
    final err = await auth.switchTo(a);
    if (!mounted) return;
    setState(() => _busyId = null);
    if (err == null) {
      Navigator.pop(context);
      return;
    }
    // The stored token was refused; the entry has been demoted to a remembered name, so ask for
    // the password rather than leaving the operator staring at an error.
    Navigator.pop(context);
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => LoginScreen(prefill: a.username, asSwitch: true)),
    );
  }

  Future<void> _forget(SavedAccount a) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('إزالة الحساب'),
        content: Text('سيُزال «${a.display}» من هذا الجهاز. لن يُحذف الحساب نفسه.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('إلغاء')),
          FilledButton(
            onPressed: () => Navigator.pop(c, true),
            style: FilledButton.styleFrom(
                backgroundColor: C.danger, minimumSize: const Size(96, 42)),
            child: const Text('إزالة'),
          ),
        ],
      ),
    );
    if (ok == true) {
      await Auth.instance.forget(a.id);
      if (mounted) setState(() {});
    }
  }

  /// Sign out, and say plainly what each choice costs the next sign-in.
  Future<void> _signOut() async {
    final choice = await showDialog<String>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('تسجيل الخروج'),
        content: const Text(
          'يمكنك الإبقاء على الحساب في هذا الجهاز، فتحتاج إلى كلمة المرور وحدها عند العودة — '
          'أو إزالته كاملاً إن كان الجهاز سيُسلَّم لغيرك.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c), child: const Text('إلغاء')),
          TextButton(
            onPressed: () => Navigator.pop(c, 'forget'),
            child: const Text('خروج وإزالة', style: TextStyle(color: C.danger)),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(c, 'keep'),
            style: FilledButton.styleFrom(minimumSize: const Size(96, 42)),
            child: const Text('خروج'),
          ),
        ],
      ),
    );
    if (choice == null || !mounted) return;
    Navigator.pop(context);
    await Auth.instance.logout(forgetAccount: choice == 'forget');
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final auth = Auth.instance;
    final currentId = auth.user?.id;

    return SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 2, 20, 10),
            child: Row(children: [
              const Icon(Icons.switch_account_outlined, size: 20),
              const SizedBox(width: 10),
              Text('الحسابات',
                  style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      color: dark ? C.textD : C.text)),
            ]),
          ),
          const Divider(height: 1),
          Flexible(
            child: ListView(
              shrinkWrap: true,
              padding: EdgeInsets.zero,
              children: [
                for (final a in auth.accounts)
                  ListTile(
                    onTap: _busyId == null ? () => _pick(a) : null,
                    leading: CircleAvatar(
                      radius: 18,
                      backgroundColor: (a.id == currentId ? C.electric : C.indigo)
                          .withValues(alpha: dark ? 0.24 : 0.12),
                      child: Text(
                        a.display.characters.first,
                        style: TextStyle(
                            fontWeight: FontWeight.w700,
                            color: a.id == currentId ? C.electric : C.indigo),
                      ),
                    ),
                    title: Text(a.display,
                        style: const TextStyle(fontWeight: FontWeight.w600)),
                    subtitle: Text(
                      a.id == currentId
                          ? '${a.roleLabel} · الحساب الحالي'
                          : a.ready
                              ? a.roleLabel
                              : '${a.roleLabel} · يحتاج كلمة المرور',
                      style: TextStyle(
                        fontSize: 12.5,
                        color: a.ready || a.id == currentId
                            ? (dark ? C.mutedD : C.muted)
                            : C.warning,
                      ),
                    ),
                    trailing: _busyId == a.id
                        ? const SizedBox(
                            width: 18, height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2))
                        : a.id == currentId
                            ? const Icon(Icons.check_circle, color: C.success, size: 21)
                            : IconButton(
                                onPressed: () => _forget(a),
                                icon: const Icon(Icons.close, size: 19),
                                tooltip: 'إزالة من الجهاز',
                              ),
                  ),
                const Divider(height: 1),
                ListTile(
                  leading: const Icon(Icons.person_add_alt, color: C.electric),
                  title: const Text('إضافة حساب آخر'),
                  onTap: () {
                    Navigator.pop(context);
                    Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => const LoginScreen(asSwitch: true)),
                    );
                  },
                ),
                ListTile(
                  leading: const Icon(Icons.logout, color: C.danger),
                  title: const Text('تسجيل الخروج',
                      style: TextStyle(color: C.danger, fontWeight: FontWeight.w600)),
                  onTap: _signOut,
                ),
                const SizedBox(height: 8),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
