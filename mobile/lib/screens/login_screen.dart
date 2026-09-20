import 'package:flutter/material.dart';
import '../core/auth.dart';
import '../core/theme.dart';
import '../widgets/logo.dart';

/// The sign-in screen, in two roles.
///
/// As the app's front door it stands alone. Reached from the account sheet (`asSwitch`) it is a
/// page on top of a running app instead: it gets a back button, and it closes itself once the new
/// account is in — the widget tree behind it already rebuilds around whoever is signed in.
class LoginScreen extends StatefulWidget {
  final String? prefill;
  final bool asSwitch;
  const LoginScreen({super.key, this.prefill, this.asSwitch = false});
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
  void initState() {
    super.initState();
    // A remembered account arrives with its username already known, so the only thing asked for is
    // the thing that is actually missing.
    if (widget.prefill != null) _user.text = widget.prefill!;
  }

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
    final err = await Auth.instance.login(_user.text, _pass.text);
    if (!mounted) return;
    setState(() {
      _busy = false;
      _error = err;
    });
    if (err == null && widget.asSwitch && Navigator.of(context).canPop()) {
      Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    // Accounts already on the device, minus the one being signed into and the one already active:
    // offering either would be a row that does nothing.
    final others = widget.asSwitch
        ? const <SavedAccount>[]
        : Auth.instance.accounts
            .where((a) => a.username != _user.text.trim())
            .take(4)
            .toList();

    return Scaffold(
      appBar: widget.asSwitch
          ? AppBar(
              backgroundColor: Colors.transparent,
              surfaceTintColor: Colors.transparent,
              title: Text(widget.prefill != null ? 'تسجيل الدخول' : 'إضافة حساب'),
            )
          : null,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _form,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // The logo carries the wordmark already, so repeating "RadNas" underneath it
                    // would be the same word twice.
                    const Center(child: BrandLogo(height: 58)),
                    const SizedBox(height: 18),
                    Text('لوحة إدارة المشتركين',
                        textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 14.5, color: dark ? C.mutedD : C.muted)),
                    const SizedBox(height: 30),
                    TextFormField(
                      controller: _user,
                      textInputAction: TextInputAction.next,
                      autocorrect: false,
                      enableSuggestions: false,
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
                      textInputAction: TextInputAction.done,
                      onFieldSubmitted: (_) => _busy ? null : _submit(),
                      decoration: InputDecoration(
                        labelText: 'كلمة المرور',
                        prefixIcon: const Icon(Icons.lock_outline),
                        suffixIcon: IconButton(
                          onPressed: () => setState(() => _hide = !_hide),
                          icon: Icon(_hide ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                          tooltip: _hide ? 'إظهار كلمة المرور' : 'إخفاء كلمة المرور',
                        ),
                      ),
                      validator: (v) => (v == null || v.isEmpty) ? 'أدخل كلمة المرور' : null,
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: 14),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                        decoration: BoxDecoration(
                          color: C.danger.withValues(alpha: dark ? 0.16 : 0.08),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Row(children: [
                          const Icon(Icons.error_outline, color: C.danger, size: 20),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(_error!,
                                style: const TextStyle(color: C.danger, fontSize: 14, height: 1.6)),
                          ),
                        ]),
                      ),
                    ],
                    // The names this phone has signed in with before. One tap fills the username;
                    // it never fills a password, so nothing is signed into by accident.
                    if (others.isNotEmpty) ...[
                      const SizedBox(height: 18),
                      Align(
                        alignment: AlignmentDirectional.centerStart,
                        child: Text('حسابات على هذا الجهاز',
                            style: TextStyle(
                                fontSize: 12.5, color: dark ? C.mutedD : C.muted)),
                      ),
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          for (final a in others)
                            ActionChip(
                              avatar: Icon(
                                a.ready ? Icons.check_circle_outline : Icons.person_outline,
                                size: 17,
                                color: a.ready ? C.success : (dark ? C.mutedD : C.muted),
                              ),
                              label: Text(a.display),
                              onPressed: () async {
                                if (a.ready) {
                                  // Its token is still good — no password needed at all.
                                  setState(() => _busy = true);
                                  final err = await Auth.instance.switchTo(a);
                                  if (!mounted) return;
                                  setState(() {
                                    _busy = false;
                                    _error = err;
                                  });
                                  if (err != null) {
                                    setState(() => _user.text = a.username);
                                  }
                                } else {
                                  setState(() => _user.text = a.username);
                                }
                              },
                            ),
                        ],
                      ),
                    ],
                    const SizedBox(height: 22),
                    FilledButton(
                      onPressed: _busy ? null : _submit,
                      child: _busy
                          ? const SizedBox(
                              height: 22,
                              width: 22,
                              child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white))
                          : const Text('تسجيل الدخول'),
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
