import 'package:flutter/material.dart';
import '../widgets/form_kit.dart';

/// Create or edit a router.
///
/// The shared secret is the field that breaks everything silently when it is wrong: FreeRADIUS
/// drops a packet with a bad signature without logging it, and the router reports only
/// `radius timeout`. So it is required on create, and on edit an empty box means "leave it".
class NasForm extends StatefulWidget {
  final Map<String, dynamic>? row;
  const NasForm({super.key, this.row});

  @override
  State<NasForm> createState() => _NasFormState();
}

class _NasFormState extends State<NasForm> {
  final _nasname = TextEditingController();
  final _shortname = TextEditingController();
  final _secret = TextEditingController();
  final _description = TextEditingController();
  final _apiPort = TextEditingController(text: '80');
  final _apiUser = TextEditingController();
  final _apiPassword = TextEditingController();

  bool _apiEnabled = false;

  bool get isEdit => widget.row != null;

  @override
  void initState() {
    super.initState();
    final r = widget.row;
    if (r != null) {
      _nasname.text = '${r['nasname'] ?? ''}';
      _shortname.text = '${r['shortname'] ?? ''}';
      _description.text = '${r['description'] ?? ''}';
      _apiEnabled = r['api_enabled'] == true;
      _apiPort.text = '${r['api_port'] ?? 80}';
      _apiUser.text = '${r['api_user'] ?? ''}';
      // The secret and API password are never returned by the server, so both stay blank.
    }
  }

  @override
  void dispose() {
    for (final c in [
      _nasname, _shortname, _secret, _description, _apiPort, _apiUser, _apiPassword
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FormPage(
      title: isEdit ? 'تعديل راوتر' : 'راوتر جديد',
      subtitle: isEdit ? '${widget.row!['nasname']}' : null,
      method: isEdit ? 'PUT' : 'POST',
      path: isEdit ? '/nas/${widget.row!['id']}' : '/nas',
      okMessage: isEdit ? 'حُفظ الراوتر' : 'أُضيف الراوتر',
      body: () => compact({
        'nasname': _nasname.text.trim(),
        'shortname': orNull(_shortname),
        'type': 'mikrotik',
        'secret': orNull(_secret),
        'description': orNull(_description),
        'api_enabled': _apiEnabled,
        'api_port': int.tryParse(_apiPort.text.trim()),
        'api_user': orNull(_apiUser),
        'api_password': orNull(_apiPassword),
      }),
      fields: (context, rebuild) => [
        FormText(
          controller: _nasname,
          label: 'عنوان الراوتر',
          required: true,
          ltr: true,
          icon: Icons.router_outlined,
          hint: 'العنوان الذي يراسل منه الراوتر خادم RADIUS',
        ),
        FormText(controller: _shortname, label: 'الاسم المختصر', icon: Icons.label_outline),
        FormText(
          controller: _secret,
          label: 'السرّ المشترك',
          required: !isEdit,
          ltr: true,
          icon: Icons.key_outlined,
          hint: isEdit ? 'اتركه فارغاً لإبقائه كما هو' : null,
        ),
        FormText(controller: _description, label: 'وصف', maxLines: 2),
        const FormSection('واجهة القراءة — للسرعات اللحظية والفحص'),
        FormSwitch(
          value: _apiEnabled,
          label: 'تفعيل قراءة الراوتر',
          hint: 'حساب مقروء فقط، تستعمله اللوحة لقراءة الجلسات وتشغيل الفحص',
          onChanged: (v) {
            _apiEnabled = v;
            rebuild();
          },
        ),
        if (_apiEnabled) ...[
          FormText(
            controller: _apiPort,
            label: 'المنفذ',
            ltr: true,
            keyboard: TextInputType.number,
          ),
          FormText(controller: _apiUser, label: 'اسم المستخدم', ltr: true),
          FormText(
            controller: _apiPassword,
            label: 'كلمة المرور',
            ltr: true,
            hint: isEdit ? 'اتركها فارغة لإبقائها كما هي' : null,
          ),
        ],
      ],
    );
  }
}
