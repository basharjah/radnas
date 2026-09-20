import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'core/api.dart';
import 'core/auth.dart';
import 'core/theme.dart';
import 'screens/login_screen.dart';
import 'screens/map_screen.dart';
import 'screens/monitor_screen.dart';

/// RadNas Map — network monitoring and topology, on its own.
///
/// The same screens that live inside the RadNas panel app, shipped separately for the person whose
/// whole job is the network rather than the billing: a field technician, a NOC shift, someone who
/// should not have a subscriber list or a renew button a mis-tap away.
///
/// It talks to the same server with the same account, so nothing has to be provisioned twice and
/// an operator's permissions follow them here unchanged. Router credentials never reach the phone;
/// every reading on these screens was collected by the server over the tunnels it already holds.
void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  Api.instance.onUnauthorized = () => Auth.instance.logout();
  await Auth.instance.restore();
  runApp(const RadNasMapApp());
}

class RadNasMapApp extends StatelessWidget {
  const RadNasMapApp({super.key});

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: Auth.instance,
      builder: (context, _) {
        return MaterialApp(
          title: 'RadNas Map',
          debugShowCheckedModeBanner: false,
          theme: lightTheme(),
          darkTheme: darkTheme(),
          themeMode: ThemeMode.system,
          locale: const Locale('ar'),
          supportedLocales: const [Locale('ar'), Locale('en')],
          localizationsDelegates: const [
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          builder: (context, child) => Directionality(
            textDirection: TextDirection.rtl,
            child: child ?? const SizedBox.shrink(),
          ),
          home: Auth.instance.restoring
              ? const _Splash()
              : Auth.instance.signedIn
                  // Keyed by the account, so signing in as someone else rebuilds both screens
                  // instead of leaving the previous company's routers on screen.
                  ? Shell(key: ValueKey(Auth.instance.user!.id))
                  : const LoginScreen(),
        );
      },
    );
  }
}

/// Two screens, because there are only two questions: what is the state of my network, and how is
/// it put together.
class Shell extends StatefulWidget {
  const Shell({super.key});
  @override
  State<Shell> createState() => _ShellState();
}

class _ShellState extends State<Shell> {
  int _i = 0;

  // Kept alive across tab switches: both poll on a timer, and rebuilding them on every tap would
  // restart the polling and lose an expanded sector the operator was reading.
  final _pages = const [MonitorScreen(), MapScreen()];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(index: _i, children: _pages),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _i,
        onDestinationSelected: (v) => setState(() => _i = v),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.speed_outlined),
            selectedIcon: Icon(Icons.speed, color: C.electric),
            label: 'المراقبة',
          ),
          NavigationDestination(
            icon: Icon(Icons.lan_outlined),
            selectedIcon: Icon(Icons.lan, color: C.electric),
            label: 'الخريطة',
          ),
        ],
      ),
    );
  }
}

class _Splash extends StatelessWidget {
  const _Splash();

  @override
  Widget build(BuildContext context) => Scaffold(
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                height: 64,
                width: 64,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  gradient: const LinearGradient(colors: [C.electric, C.cyan]),
                  borderRadius: BorderRadius.circular(18),
                ),
                child: const Icon(Icons.lan_outlined, color: Colors.white, size: 32),
              ),
              const SizedBox(height: 22),
              const SizedBox(
                height: 22,
                width: 22,
                child: CircularProgressIndicator(strokeWidth: 2.4),
              ),
            ],
          ),
        ),
      );
}
