import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/auth.dart';
import '../widgets/form_kit.dart';

/// Create or edit a subscriber.
///
/// The two operations use different server schemas — create demands a username and password, edit
/// forbids changing the username at all — so the form asks for different things rather than
/// pretending one shape fits both.
class SubscriberForm extends StatefulWidget {
  /// null creates; otherwise the row being edited.
  final Map<String, dynamic>? row;
  const SubscriberForm({super.key, this.row});

  @override
  State<SubscriberForm> createState() => _SubscriberFormState();
}

class _SubscriberFormState extends State<SubscriberForm> {
  final _username = TextEditingController();
  final _password = TextEditingController();
  final _fullName = TextEditingController();
  final _phone = TextEditingController();
  final _address = TextEditingController();
  final _staticIp = TextEditingController();

  String? _planId;
  String? _managerId;
  String _connection = 'pppoe';
  String _status = 'active';

  Map<String, String> _plans = const {};
  Map<String, String> _managers = const {};
  bool _loadingRefs = true;

  bool get isEdit => widget.row != null;

  @override
  void initState() {
    super.initState();
    final r = widget.row;
    if (r != null) {
      _username.text = '${r['username'] ?? ''}';
      _fullName.text = '${r['full_name'] ?? ''}';
      _phone.text = '${r['phone'] ?? ''}';
      _address.text = '${r['address'] ?? ''}';
      _staticIp.text = '${r['static_ip'] ?? ''}';
      _planId = r['plan_id'] as String?;
      _managerId = r['manager_id'] as String?;
      _connection = '${r['connection_type'] ?? 'pppoe'}';
      _status = '${r['status'] ?? 'active'}';
    }
    _loadRefs();
  }

  @override
  void dispose() {
    for (final c in [_username, _password, _fullName, _phone, _address, _staticIp]) {
      c.dispose();
    }
    super.dispose();
  }

  /// Plans and owning accounts, so the operator picks rather than types an id.
  Future<void> _loadRefs() async {
    try {
      final p = await Api.instance.dio.get('/plans');
      final list = (p.data is Map ? p.data['data'] as List? : p.data as List?) ?? const [];
      final plans = <String, String>{
        for (final e in list)
          '${(e as Map)['id']}': '${e['name']}'
              '${e['price'] != null ? ' · ${e['price']}' : ''}',
      };

      // Only owners and admins may assign to another account; a reseller's subscribers are
      // always their own, so the field is not shown to them at all.
      var managers = <String, String>{};
      final role = Auth.instance.user?.role;
      if (role == 'owner' || role == 'admin') {
        final m = await Api.instance.dio.get('/managers');
        final ml = (m.data is Map ? m.data['data'] as List? : m.data as List?) ?? const [];
        managers = {
          for (final e in ml)
            if ((e as Map)['role'] != 'owner')
              '${e['id']}': '${e['company'] ?? e['full_name'] ?? e['username']}',
        };
      }

      if (!mounted) return;
      setState(() {
        _plans = plans;
        _managers = managers;
        _loadingRefs = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loadingRefs = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loadingRefs) {
      return Scaffold(
        appBar: AppBar(title: Text(isEdit ? 'تعديل مشترك' : 'مشترك جديد')),
        body: const Center(child: CircularProgressIndicator()),
      );
    }

    return FormPage(
      title: isEdit ? 'تعديل مشترك' : 'مشترك جديد',
      subtitle: isEdit ? '${widget.row!['username']}' : null,
      method: isEdit ? 'PUT' : 'POST',
      path: isEdit ? '/subscribers/${widget.row!['id']}' : '/subscribers',
      okMessage: isEdit ? 'حُفظت التعديلات' : 'أُنشئ المشترك',
      body: () => isEdit
          ? compact({
              'full_name': orNull(_fullName),
              'phone': orNull(_phone),
              'address': orNull(_address),
              // Left blank means "leave the password alone", not "set it to empty".
              'password': orNull(_password),
              'plan_id': _planId,
              'static_ip': orNull(_staticIp),
              'status': _status,
              if (_managers.isNotEmpty) 'manager_id': _managerId,
            })
          : compact({
              'username': _username.text.trim(),
              'password': _password.text,
              'full_name': orNull(_fullName),
              'phone': orNull(_phone),
              'address': orNull(_address),
              'plan_id': _planId,
              'connection_type': _connection,
              'static_ip': orNull(_staticIp),
              if (_managers.isNotEmpty) 'manager_id': _managerId,
            }),
      fields: (context, rebuild) => [
        FormText(
          controller: _username,
          label: 'اسم المستخدم',
          required: !isEdit,
          ltr: true,
          icon: Icons.person_outline,
          // The username is the RADIUS identity and is written into radcheck, radreply and every
          // accounting row. The server has no rename path, so editing it here would be a lie.
          hint: isEdit ? 'لا يمكن تغييره بعد الإنشاء' : null,
        ),
        if (isEdit)
          const Padding(
            padding: EdgeInsets.only(bottom: 6),
            child: Text('اترك كلمة المرور فارغة لإبقائها كما هي',
                style: TextStyle(fontSize: 12.5)),
          ),
        FormText(
          controller: _password,
          label: 'كلمة المرور',
          required: !isEdit,
          ltr: true,
          icon: Icons.lock_outline,
        ),
        const FormSection('بيانات المشترك'),
        FormText(controller: _fullName, label: 'الاسم الكامل', icon: Icons.badge_outlined),
        FormText(
          controller: _phone,
          label: 'الهاتف',
          ltr: true,
          keyboard: TextInputType.phone,
          icon: Icons.phone_outlined,
        ),
        FormText(controller: _address, label: 'العنوان', maxLines: 2, icon: Icons.place_outlined),
        const FormSection('الاشتراك'),
        FormSelect<String>(
          value: _planId,
          label: 'الباقة',
          items: _plans,
          onChanged: (v) {
            _planId = v;
            rebuild();
          },
          emptyLabel: '— بلا باقة —',
        ),
        if (!isEdit)
          FormSelect<String>(
            value: _connection,
            label: 'نوع الاتصال',
            required: true,
            items: const {'pppoe': 'PPPoE', 'hotspot': 'هوت سبوت'},
            onChanged: (v) {
              _connection = v ?? 'pppoe';
              rebuild();
            },
          ),
        if (isEdit)
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
        FormText(
          controller: _staticIp,
          label: 'عنوان ثابت',
          ltr: true,
          icon: Icons.lan_outlined,
          hint: 'اتركه فارغاً ليأخذ عنواناً من البركة',
        ),
        if (_managers.isNotEmpty) ...[
          const FormSection('الإسناد'),
          FormSelect<String>(
            value: _managerId,
            label: 'الحساب المالك',
            items: _managers,
            onChanged: (v) {
              _managerId = v;
              rebuild();
            },
            emptyLabel: '— حسابي —',
          ),
        ],
      ],
    );
  }
}
