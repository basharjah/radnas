import 'package:flutter/material.dart';
import '../core/auth.dart';
import '../widgets/form_kit.dart';

/// Create or edit a reseller or company account.
///
/// Only an owner may create a company (`admin`); an admin creates resellers under itself. The role
/// choice is therefore built from who is signed in, not offered in full and rejected by the server
/// after the operator has filled the whole form.
class ManagerForm extends StatefulWidget {
  final Map<String, dynamic>? row;
  const ManagerForm({super.key, this.row});

  @override
  State<ManagerForm> createState() => _ManagerFormState();
}

class _ManagerFormState extends State<ManagerForm> {
  final _username = TextEditingController();
  final _password = TextEditingController();
  final _fullName = TextEditingController();
  final _company = TextEditingController();
  final _phone = TextEditingController();
  final _email = TextEditingController();
  final _maxSubscribers = TextEditingController();

  String _role = 'reseller';
  String _status = 'active';

  bool get isEdit => widget.row != null;
  bool get isOwner => Auth.instance.user?.role == 'owner';

  @override
  void initState() {
    super.initState();
    final r = widget.row;
    if (r != null) {
      _username.text = '${r['username'] ?? ''}';
      _fullName.text = '${r['full_name'] ?? ''}';
      _company.text = '${r['company'] ?? ''}';
      _phone.text = '${r['phone'] ?? ''}';
      _email.text = '${r['email'] ?? ''}';
      _role = '${r['role'] ?? 'reseller'}';
      _status = '${r['status'] ?? 'active'}';
      final m = r['max_subscribers'];
      if (m != null) _maxSubscribers.text = '$m';
    }
  }

  @override
  void dispose() {
    for (final c in [
      _username, _password, _fullName, _company, _phone, _email, _maxSubscribers
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FormPage(
      title: isEdit ? 'تعديل حساب' : 'حساب جديد',
      subtitle: isEdit ? '${widget.row!['username']}' : null,
      method: isEdit ? 'PUT' : 'POST',
      path: isEdit ? '/managers/${widget.row!['id']}' : '/managers',
      okMessage: isEdit ? 'حُفظ الحساب' : 'أُنشئ الحساب',
      body: () => isEdit
          // The update schema is deliberately narrower than create: it accepts no username,
          // password or role, so sending them would fail the whole request.
          ? compact({
              'full_name': orNull(_fullName),
              'company': orNull(_company),
              'phone': orNull(_phone),
              'email': orNull(_email),
              'status': _status,
              if (isOwner) 'max_subscribers': int.tryParse(_maxSubscribers.text.trim()),
            })
          : compact({
              'username': _username.text.trim(),
              'password': _password.text,
              'full_name': orNull(_fullName),
              'company': orNull(_company),
              'phone': orNull(_phone),
              // The server demands a valid address or an empty string — never a missing key
              // that some other branch fills in.
              'email': _email.text.trim(),
              'role': _role,
              if (isOwner) 'max_subscribers': int.tryParse(_maxSubscribers.text.trim()),
            }),
      fields: (context, rebuild) => [
        FormText(
          controller: _username,
          label: 'اسم المستخدم',
          required: !isEdit,
          ltr: true,
          icon: Icons.person_outline,
          hint: isEdit ? 'لا يمكن تغييره' : null,
        ),
        if (!isEdit)
          FormText(
            controller: _password,
            label: 'كلمة المرور',
            required: true,
            ltr: true,
            icon: Icons.lock_outline,
            hint: '4 أحرف على الأقل',
          ),
        if (!isEdit && isOwner)
          FormSelect<String>(
            value: _role,
            label: 'الدور',
            required: true,
            items: const {'admin': 'شركة إنترنت', 'reseller': 'موزّع'},
            onChanged: (v) {
              _role = v ?? 'reseller';
              rebuild();
            },
          ),
        const FormSection('البيانات'),
        FormText(controller: _company, label: 'اسم الشركة', icon: Icons.business_outlined),
        FormText(controller: _fullName, label: 'الاسم الكامل', icon: Icons.badge_outlined),
        FormText(
          controller: _phone,
          label: 'الهاتف',
          ltr: true,
          keyboard: TextInputType.phone,
          icon: Icons.phone_outlined,
        ),
        FormText(
          controller: _email,
          label: 'البريد',
          ltr: true,
          keyboard: TextInputType.emailAddress,
          icon: Icons.mail_outline,
        ),
        if (isEdit) ...[
          const FormSection('الحالة'),
          FormSelect<String>(
            value: _status,
            label: 'الحالة',
            required: true,
            items: const {'active': 'مفعّل', 'disabled': 'موقوف'},
            onChanged: (v) {
              _status = v ?? 'active';
              rebuild();
            },
          ),
        ],
        if (isOwner) ...[
          const FormSection('الحدّ'),
          FormText(
            controller: _maxSubscribers,
            label: 'أقصى عدد مشتركين',
            ltr: true,
            keyboard: TextInputType.number,
            hint: 'اتركه فارغاً لبلا حدّ',
          ),
        ],
      ],
    );
  }
}

/// Reset another account's password. Separate from the edit form because the update schema does
/// not accept a password at all — it is its own endpoint with its own rate limit.
class ResetPasswordForm extends StatefulWidget {
  final Map<String, dynamic> row;
  const ResetPasswordForm({super.key, required this.row});

  @override
  State<ResetPasswordForm> createState() => _ResetPasswordFormState();
}

class _ResetPasswordFormState extends State<ResetPasswordForm> {
  final _pw = TextEditingController();

  @override
  void dispose() {
    _pw.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => FormPage(
        title: 'كلمة مرور جديدة',
        subtitle: '${widget.row['username']}',
        method: 'POST',
        path: '/managers/${widget.row['id']}/reset-password',
        submitLabel: 'تعيين',
        okMessage: 'تم تعيين كلمة المرور',
        body: () => {'new_password': _pw.text},
        fields: (context, rebuild) => [
          FormText(
            controller: _pw,
            label: 'كلمة المرور الجديدة',
            required: true,
            ltr: true,
            icon: Icons.lock_reset,
            hint: '4 أحرف على الأقل',
          ),
        ],
      );
}
