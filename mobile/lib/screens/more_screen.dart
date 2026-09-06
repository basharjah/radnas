import 'package:flutter/material.dart';
import '../core/auth.dart';
import '../core/theme.dart';
import 'account_screens.dart';
import 'invoices_screen.dart';
import 'managers_screen.dart';
import 'nas_screen.dart';
import 'plans_screen.dart';
import 'shell.dart';
import 'simple_screens.dart';

/// Everything that is not one of the three hourly tabs, gated by role.
///
/// The gate mirrors the web panel's nav exactly — same pages, same roles. Offering an owner-only
/// page to a company admin ends in a 403 they cannot act on; hiding a page an owner needs sends
/// them back to the browser. So the list is built from the signed-in role rather than hard-coded.
class MoreScreen extends StatelessWidget {
  const MoreScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final u = Auth.instance.user;
    final role = u?.role ?? 'reseller';
    final isOwner = role == 'owner';
    final isAdminUp = role == 'owner' || role == 'admin';

    final groups = <String, List<_Item>>{
      'الاشتراكات': [
        _Item('الباقات', Icons.local_offer_outlined, (_) => const PlansScreen()),
        _Item('هوت سبوت', Icons.wifi_password_outlined, (_) => const HotspotScreen()),
      ],
      'المالية': [
        _Item('الفواتير', Icons.receipt_long_outlined, (_) => const InvoicesScreen()),
        _Item('الحركات', Icons.account_balance_wallet_outlined,
            (_) => const TransactionsScreen()),
        _Item('التقارير', Icons.bar_chart_outlined, (_) => const ReportsScreen()),
      ],
      'الشبكة': [
        if (isAdminUp)
          _Item('أجهزة NAS', Icons.router_outlined, (_) => const NasScreen()),
        if (isOwner)
          _Item('WireGuard', Icons.vpn_key_outlined, (_) => const WireGuardScreen()),
      ],
      'النظام': [
        if (isAdminUp)
          _Item('الموزّعون', Icons.supervisor_account_outlined, (_) => const ManagersScreen()),
        _Item('تيليجرام', Icons.send_outlined, (_) => const TelegramScreen()),
        if (isAdminUp)
          _Item('النسخ الاحتياطية', Icons.backup_outlined, (_) => const BackupsScreen()),
        if (isOwner)
          _Item('سجلّ التدقيق', Icons.history, (_) => const AuditScreen()),
        if (isOwner)
          _Item('إعدادات المنصّة', Icons.settings_outlined,
              (_) => const PlatformSettingsScreen()),
        _Item('إعدادات الحساب', Icons.manage_accounts_outlined,
            (_) => const AccountSettingsScreen()),
      ],
    };

    return Scaffold(
      appBar: AppBar(title: const Text('المزيد')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(14, 10, 14, 28),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(children: [
                Container(
                  height: 46,
                  width: 46,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(colors: [C.electric, C.cyan]),
                    borderRadius: BorderRadius.circular(13),
                  ),
                  child: Text(
                    (u?.display.trim().isNotEmpty ?? false)
                        ? u!.display.trim().characters.first
                        : '؟',
                    style: const TextStyle(
                        color: Colors.white, fontSize: 20, fontWeight: FontWeight.w800),
                  ),
                ),
                const SizedBox(width: 13),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(u?.display ?? '—',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w700,
                              color: dark ? C.textD : C.text)),
                      const SizedBox(height: 3),
                      Row(children: [
                        Flexible(
                          child: Text(u?.username ?? '',
                              textDirection: TextDirection.ltr,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                  fontSize: 12.5, color: dark ? C.mutedD : C.muted)),
                        ),
                        const SizedBox(width: 8),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                          decoration: BoxDecoration(
                            color: C.indigo.withValues(alpha: dark ? 0.22 : 0.11),
                            borderRadius: BorderRadius.circular(5),
                          ),
                          child: Text(
                            switch (role) {
                              'owner' => 'مالك المنصّة',
                              'admin' => 'شركة',
                              _ => 'موزّع',
                            },
                            style: const TextStyle(
                                fontSize: 10.5, fontWeight: FontWeight.w700, color: C.indigo),
                          ),
                        ),
                      ]),
                    ],
                  ),
                ),
                IconButton(
                  onPressed: () => confirmLogout(context),
                  icon: const Icon(Icons.logout, color: C.danger),
                  tooltip: 'تسجيل الخروج',
                ),
              ]),
            ),
          ),
          for (final g in groups.entries)
            if (g.value.isNotEmpty) ...[
              Padding(
                padding: const EdgeInsets.fromLTRB(2, 20, 2, 10),
                child: Text(g.key,
                    style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: dark ? C.mutedD : C.muted)),
              ),
              GridView.count(
                crossAxisCount: 2,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                crossAxisSpacing: 11,
                mainAxisSpacing: 11,
                childAspectRatio: 1.7,
                children: [
                  for (final it in g.value)
                    _Card(
                      item: it,
                      dark: dark,
                      onTap: () => Navigator.of(context)
                          .push(MaterialPageRoute(builder: it.build)),
                    ),
                ],
              ),
            ],
        ],
      ),
    );
  }
}

class _Item {
  final String label;
  final IconData icon;
  final Widget Function(BuildContext) build;
  const _Item(this.label, this.icon, this.build);
}

class _Card extends StatelessWidget {
  final _Item item;
  final bool dark;
  final VoidCallback onTap;
  const _Card({required this.item, required this.dark, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(item.icon, size: 23, color: C.electric),
              const Spacer(),
              Text(item.label,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      height: 1.35,
                      color: dark ? C.textD : C.text)),
            ],
          ),
        ),
      ),
    );
  }
}
