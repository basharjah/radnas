import 'package:flutter/material.dart';
import '../core/auth.dart';
import '../core/theme.dart';

/// Sign in with the same RadNas account the panel uses.
///
/// No separate registration and no second password: this app is another window onto the same
/// network, and an operator who already has an account should not have to hold two.
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
    final err = await Auth.instance.login(_user.text, _pass.text);
    if (!mounted) return;
    setState(() {
      _busy = false;
      _error = err;
    });
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Scaffold(
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
                    Center(
                      child: Container(
                        width: 78,
                        height: 78,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          gradient: const LinearGradient(colors: [C.electric, C.cyan]),
                          borderRadius: BorderRadius.circular(22),
                        ),
                        child: const Icon(Icons.lan_outlined, size: 38, color: Colors.white),
                      ),
                    ),
                    const SizedBox(height: 20),
                    Text('RadNas Map',
                        textAlign: TextAlign.center,
                        textDirection: TextDirection.ltr,
                        style: TextStyle(
                            fontSize: 24,
                            fontWeight: FontWeight.w800,
                            color: dark ? C.textD : C.text)),
                    const SizedBox(height: 6),
                    Text('مراقبة الشبكة وخريطتها',
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
                          icon: Icon(_hide
                              ? Icons.visibility_outlined
                              : Icons.visibility_off_outlined),
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
                                style: const TextStyle(
                                    color: C.danger, fontSize: 14, height: 1.6)),
                          ),
                        ]),
                      ),
                    ],
                    const SizedBox(height: 22),
                    FilledButton(
                      onPressed: _busy ? null : _submit,
                      child: _busy
                          ? const SizedBox(
                              height: 22,
                              width: 22,
                              child: CircularProgressIndicator(
                                  strokeWidth: 2.4, color: Colors.white))
                          : const Text('تسجيل الدخول'),
                    ),
                    const SizedBox(height: 16),
                    Text('بحساب RadNas نفسه',
                        textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 12.5, color: dark ? C.mutedD : C.muted)),
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
