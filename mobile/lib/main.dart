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
  Api.instance.onUnauthorized = () => Auth.instance.logout();
  await Auth.instance.restore();
  runApp(const RadNasApp());
}

class RadNasApp extends StatelessWidget {
  const RadNasApp({super.key});

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
              : Auth.instance.signedIn
                  ? const Shell()
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
