import 'package:flutter/material.dart';
import '../core/auth.dart';
import '../core/theme.dart';
import 'dashboard_screen.dart';
import 'online_screen.dart';
import 'more_screen.dart';
import 'subscribers_screen.dart';

/// Four destinations, not fourteen.
///
/// The panel has fourteen admin pages, but a phone's bottom bar holds four before the labels start
/// truncating. The three an operator opens hourly get a tab; the rest live behind "المزيد", which
/// is a real screen rather than a drawer — a drawer on a right-to-left phone opens under the thumb
/// that is holding the device.
class Shell extends StatefulWidget {
  const Shell({super.key});
  @override
  State<Shell> createState() => _ShellState();
}

class _ShellState extends State<Shell> {
  int _i = 0;

  // Kept alive across tab switches: rebuilding the subscriber list on every tab tap would refetch
  // and lose the operator's scroll position mid-task.
  final _pages = const [
    DashboardScreen(),
    SubscribersScreen(),
    OnlineScreen(),
    MoreScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(index: _i, children: _pages),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _i,
        onDestinationSelected: (v) => setState(() => _i = v),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.dashboard_outlined),
            selectedIcon: Icon(Icons.dashboard, color: C.electric),
            label: 'الرئيسية',
          ),
          NavigationDestination(
            icon: Icon(Icons.people_outline),
            selectedIcon: Icon(Icons.people, color: C.electric),
            label: 'المشتركون',
          ),
          NavigationDestination(
            icon: Icon(Icons.wifi_tethering_outlined),
            selectedIcon: Icon(Icons.wifi_tethering, color: C.electric),
            label: 'المتصلون',
          ),
          NavigationDestination(
            icon: Icon(Icons.grid_view_outlined),
            selectedIcon: Icon(Icons.grid_view, color: C.electric),
            label: 'المزيد',
          ),
        ],
      ),
    );
  }
}

/// Signs out after confirming — a mis-tap here means retyping credentials in the field.
Future<void> confirmLogout(BuildContext context) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (c) => AlertDialog(
      title: const Text('تسجيل الخروج'),
      content: const Text('ستحتاج إلى إدخال اسم المستخدم وكلمة المرور مرّة أخرى.'),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('إلغاء')),
        FilledButton(
          onPressed: () => Navigator.pop(c, true),
          style: FilledButton.styleFrom(backgroundColor: C.danger, minimumSize: const Size(96, 42)),
          child: const Text('خروج'),
        ),
      ],
    ),
  );
  if (ok == true) await Auth.instance.logout();
}
