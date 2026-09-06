import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../core/loader.dart';
import '../core/theme.dart';
import 'common.dart';

/// The pieces every create/edit sheet needs.
///
/// Eleven forms were about to each invent their own field spacing, their own way of turning an
/// empty box into a null, and their own submit button. The one that matters most is the null
/// handling: a blank optional field must be omitted, not sent as "", or the server's zod schema
/// rejects the whole request over a field the operator never touched.

/// A labelled text field with the app's spacing already applied.
class FormText extends StatelessWidget {
  final TextEditingController controller;
  final String label;
  final String? hint;
  final bool required, obscure, ltr;
  final TextInputType? keyboard;
  final int maxLines;
  final IconData? icon;
  final List<TextInputFormatter>? formatters;

  const FormText({
    super.key,
    required this.controller,
    required this.label,
    this.hint,
    this.required = false,
    this.obscure = false,
    this.ltr = false,
    this.keyboard,
    this.maxLines = 1,
    this.icon,
    this.formatters,
  });

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 14),
        child: TextFormField(
          controller: controller,
          obscureText: obscure,
          keyboardType: keyboard,
          maxLines: obscure ? 1 : maxLines,
          inputFormatters: formatters,
          textDirection: ltr ? TextDirection.ltr : null,
          decoration: InputDecoration(
            labelText: required ? '$label *' : label,
            hintText: hint,
            prefixIcon: icon == null ? null : Icon(icon),
          ),
          validator: required
              ? (v) => (v == null || v.trim().isEmpty) ? 'هذا الحقل مطلوب' : null
              : null,
        ),
      );
}

/// A labelled dropdown. [items] maps the value sent to the server to the label shown.
class FormSelect<T> extends StatelessWidget {
  final T? value;
  final String label;
  final Map<T, String> items;
  final ValueChanged<T?> onChanged;
  final bool required;
  final String? emptyLabel;

  const FormSelect({
    super.key,
    required this.value,
    required this.label,
    required this.items,
    required this.onChanged,
    this.required = false,
    this.emptyLabel,
  });

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 14),
        child: DropdownButtonFormField<T>(
          initialValue: items.containsKey(value) ? value : null,
          isExpanded: true,
          decoration: InputDecoration(labelText: required ? '$label *' : label),
          items: [
            if (!required)
              DropdownMenuItem<T>(value: null, child: Text(emptyLabel ?? '— بلا —')),
            for (final e in items.entries)
              DropdownMenuItem<T>(
                value: e.key,
                child: Text(e.value, maxLines: 1, overflow: TextOverflow.ellipsis),
              ),
          ],
          onChanged: onChanged,
          validator: required ? (v) => v == null ? 'اختر قيمة' : null : null,
        ),
      );
}

/// A labelled on/off row.
class FormSwitch extends StatelessWidget {
  final bool value;
  final String label;
  final String? hint;
  final ValueChanged<bool> onChanged;
  const FormSwitch({
    super.key,
    required this.value,
    required this.label,
    required this.onChanged,
    this.hint,
  });

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: SwitchListTile(
        value: value,
        onChanged: onChanged,
        contentPadding: EdgeInsets.zero,
        title: Text(label, style: const TextStyle(fontSize: 15)),
        subtitle: hint == null
            ? null
            : Text(hint!, style: TextStyle(fontSize: 12.5, color: dark ? C.mutedD : C.muted)),
      ),
    );
  }
}

/// Section heading inside a long form.
class FormSection extends StatelessWidget {
  final String title;
  const FormSection(this.title, {super.key});

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Padding(
      padding: const EdgeInsets.only(top: 6, bottom: 12),
      child: Row(children: [
        Text(title,
            style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: dark ? C.mutedD : C.muted)),
        const SizedBox(width: 10),
        Expanded(child: Divider(color: dark ? C.borderD : C.border)),
      ]),
    );
  }
}

/// Trims a field and returns null when it is empty.
///
/// The server's schemas mark optional fields `.optional()`, not `.or(z.literal(''))`, so sending an
/// empty string fails validation for the whole request. Every optional field goes through this.
String? orNull(TextEditingController c) {
  final v = c.text.trim();
  return v.isEmpty ? null : v;
}

/// Drops null entries from a request body.
Map<String, dynamic> compact(Map<String, dynamic> m) =>
    {for (final e in m.entries) if (e.value != null) e.key: e.value};

/// A full-screen create/edit form with one submit button.
class FormPage extends StatefulWidget {
  final String title;
  final String submitLabel;

  /// Builds the fields. Rebuilt whenever the caller calls [setState] through [rebuild].
  final List<Widget> Function(BuildContext context, VoidCallback rebuild) fields;

  /// Returns the request body. Called after validation passes.
  final Map<String, dynamic> Function() body;

  final String method;
  final String path;
  final String okMessage;

  /// Shown under the title — used to name what is being edited.
  final String? subtitle;

  const FormPage({
    super.key,
    required this.title,
    required this.fields,
    required this.body,
    required this.method,
    required this.path,
    this.submitLabel = 'حفظ',
    this.okMessage = 'تم الحفظ',
    this.subtitle,
  });

  @override
  State<FormPage> createState() => _FormPageState();
}

class _FormPageState extends State<FormPage> {
  final _form = GlobalKey<FormState>();
  bool _busy = false;

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _busy = true);
    final ok = await send(context, widget.method, widget.path,
        body: widget.body(), okMessage: widget.okMessage);
    if (!mounted) return;
    setState(() => _busy = false);
    // true tells the list that opened this form to reload.
    if (ok) Navigator.pop(context, true);
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(widget.title),
            if (widget.subtitle != null)
              Text(widget.subtitle!,
                  style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w400,
                      color: dark ? C.mutedD : C.muted)),
          ],
        ),
        leading: IconButton(
          icon: const Icon(Icons.close),
          tooltip: 'إغلاق',
          onPressed: () => Navigator.pop(context, false),
        ),
      ),
      body: Form(
        key: _form,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 110),
          children: widget.fields(context, () => setState(() {})),
        ),
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 14),
          child: FilledButton(
            onPressed: _busy ? null : _submit,
            child: _busy
                ? const SizedBox(
                    height: 22,
                    width: 22,
                    child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white))
                : Text(widget.submitLabel),
          ),
        ),
      ),
    );
  }
}

/// Opens a form and reports whether it saved.
Future<bool> openForm(BuildContext context, Widget page) async {
  final saved = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => page));
  return saved == true;
}

/// Delete confirmed by name, then sent through the panel's POST-tunnelled delete.
Future<bool> deleteThing(
  BuildContext context, {
  required String path,
  required String what,
  required String name,
}) async {
  final ok = await confirm(
    context,
    title: 'حذف $what',
    body: 'سيُحذف «$name» نهائياً. لا يمكن التراجع.',
    action: 'حذف',
    danger: true,
  );
  if (!ok || !context.mounted) return false;
  // DELETE is rewritten to POST <path>/delete by the Dio interceptor, matching the web client.
  return send(context, 'DELETE', path, okMessage: 'حُذف');
}
