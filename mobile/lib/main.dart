import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'core/api.dart';
import 'core/auth.dart';
import 'core/theme.dart';
import 'screens/login_screen.dart';
import 'screens/shell.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // The 401 handler lives here rather than in a screen: a token can expire during any request, and
  // signing out through the shared Auth object lets whichever screen is open react on its own.
  Api.instance.onUnauthorized = Auth.instance.onTokenRejected;
  await Auth.instance.restore();
  runApp(const RadNasApp());
}

class RadNasApp extends StatefulWidget {
  const RadNasApp({super.key});
  @override
  State<RadNasApp> createState() => _RadNasAppState();
}

class _RadNasAppState extends State<RadNasApp> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  /// A phone that is used daily should never ask for a password again. Coming back to the
  /// foreground is the moment to push the session out, since it is the moment we know the app is
  /// in use and the network is likely up.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) Auth.instance.renewIfStale();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: Auth.instance,
      builder: (context, _) {
        return MaterialApp(
          title: 'RadNas',
          debugShowCheckedModeBanner: false,
          theme: lightTheme(),
          darkTheme: darkTheme(),
          // Follows the phone's own setting, like the web panel follows the browser's.
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
              // Keyed by WHO is signed in. The four tabs are kept alive on purpose so a tab switch
              // does not lose the operator's place in a list of four hundred — but that same
              // longevity meant switching company carried the previous one's subscribers, dashboard
              // and sessions across, until every page was pulled to refresh by hand.
              //
              // Changing the key makes Flutter discard this Shell and every screen beneath it and
              // build them again, so each one fetches under the new token. It is the whole fix:
              // there is no list of screens to remember to reset, and one added tomorrow is covered
              // the day it is written.
              : Auth.instance.signedIn
                  ? Shell(key: ValueKey(Auth.instance.user!.id))
                  : const LoginScreen(),
        );
      },
    );
  }
}

/// Shown only while the keystore read completes — without it the login screen flashes on every
/// cold start for an operator who is in fact signed in.
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
                child: const Icon(Icons.router_outlined, color: Colors.white, size: 32),
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
