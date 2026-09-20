import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'core.dart';
import 'home.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Api.instance.restore();
  runApp(const PortalApp());
}

class PortalApp extends StatefulWidget {
  const PortalApp({super.key});
  @override
  State<PortalApp> createState() => _PortalAppState();
}

class _PortalAppState extends State<PortalApp> with WidgetsBindingObserver {
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

  /// Returning to the foreground is the moment we know the app is in use and the network is
  /// probably up — the right time to push the session out another thirty days.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) Api.instance.renewIfStale();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: Api.instance,
      builder: (context, _) => MaterialApp(
        title: 'حسابي',
        debugShowCheckedModeBanner: false,
        theme: buildTheme(Brightness.light),
        darkTheme: buildTheme(Brightness.dark),
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
        home: Api.instance.restoring
            ? const _Splash()
            : Api.instance.signedIn
                ? const HomeScreen()
                : const LoginScreen(),
      ),
    );
  }
}

/// Shown only while the keystore read completes, so a signed-in subscriber never sees the login
/// screen flash on a cold start.
class _Splash extends StatelessWidget {
  const _Splash();
  @override
  Widget build(BuildContext context) => const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
}

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _user = TextEditingController();
  final _pass = TextEditingController();
  final _form = GlobalKey<FormState>();
  bool _busy = false, _hide = true;
  String? _error;

  @override
  void dispose() {
    _user.dispose();
    _pass.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final err = await Api.instance.login(_user.text, _pass.text);
    if (!mounted) return;
    setState(() {
      _busy = false;
      _error = err;
    });
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final ink = dark ? C.inkD : C.ink;
    final dim = dark ? C.dimD : C.dim;

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 26, vertical: 34),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 400),
              child: Form(
                key: _form,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Container(
                      height: 72,
                      width: 72,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(colors: [C.brand, C.cyan]),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: const Icon(Icons.wifi, color: Colors.white, size: 38),
                    ),
                    const SizedBox(height: 22),
                    Text('حسابي',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                            fontSize: 30, fontWeight: FontWeight.w800, color: ink)),
                    const SizedBox(height: 7),
                    Text(
                      'تابع اشتراكك واستهلاكك',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 14.5, color: dim),
                    ),
                    const SizedBox(height: 32),
                    TextFormField(
                      controller: _user,
                      textInputAction: TextInputAction.next,
                      autocorrect: false,
                      enableSuggestions: false,
                      textDirection: TextDirection.ltr,
                      decoration: const InputDecoration(
                        labelText: 'اسم المستخدم',
                        prefixIcon: Icon(Icons.person_outline),
                      ),
                      validator: (v) =>
                          (v == null || v.trim().isEmpty) ? 'أدخل اسم المستخدم' : null,
                    ),
                    const SizedBox(height: 14),
                    TextFormField(
                      controller: _pass,
                      obscureText: _hide,
                      textDirection: TextDirection.ltr,
                      textInputAction: TextInputAction.done,
                      onFieldSubmitted: (_) => _busy ? null : _submit(),
                      decoration: InputDecoration(
                        labelText: 'كلمة المرور',
                        prefixIcon: const Icon(Icons.lock_outline),
                        suffixIcon: IconButton(
                          onPressed: () => setState(() => _hide = !_hide),
                          icon: Icon(_hide
                              ? Icons.visibility_outlined
                              : Icons.visibility_off_outlined),
                        ),
                      ),
                      validator: (v) =>
                          (v == null || v.isEmpty) ? 'أدخل كلمة المرور' : null,
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: 15),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
                        decoration: BoxDecoration(
                          color: C.bad.withValues(alpha: dark ? 0.16 : 0.08),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Row(children: [
                          const Icon(Icons.error_outline, color: C.bad, size: 20),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(_error!,
                                style: const TextStyle(
                                    color: C.bad, fontSize: 14, height: 1.6)),
                          ),
                        ]),
                      ),
                    ],
                    const SizedBox(height: 24),
                    FilledButton(
                      onPressed: _busy ? null : _submit,
                      child: _busy
                          ? const SizedBox(
                              height: 22,
                              width: 22,
                              child: CircularProgressIndicator(
                                  strokeWidth: 2.4, color: Colors.white))
                          : const Text('دخول'),
                    ),
                    const SizedBox(height: 18),
                    Text(
                      'بياناتك هي نفسها التي تستعملها للاتصال بالإنترنت.\nإن نسيتها، تواصل مع مزوّد خدمتك.',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 12.5, height: 1.8, color: dim),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
