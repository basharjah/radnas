import 'package:flutter/material.dart';
import '../core/format.dart';
import '../widgets/form_kit.dart';

/// Create or edit a plan.
///
/// The speed and quota fields are the ones that reach a live subscriber: the speed becomes the
/// Mikrotik-Rate-Limit in every Access-Accept, and the quota drives the scheduler that throttles
/// or disconnects. So they are grouped and labelled by what they do, not by column name.
class PlanForm extends StatefulWidget {
  final Map<String, dynamic>? row;
  const PlanForm({super.key, this.row});

  @override
  State<PlanForm> createState() => _PlanFormState();
}

class _PlanFormState extends State<PlanForm> {
  final _name = TextEditingController();
  final _price = TextEditingController(text: '0');
  final _down = TextEditingController(text: '0');
  final _up = TextEditingController(text: '0');
  final _durationValue = TextEditingController(text: '30');
  final _dailyQuota = TextEditingController();
  final _monthlyQuota = TextEditingController();
  final _description = TextEditingController();

  String _type = 'pppoe';
  String _durationUnit = 'days';
  String _fupBehavior = 'throttle';

  bool get isEdit => widget.row != null;

  @override
  void initState() {
    super.initState();
    final r = widget.row;
    if (r != null) {
      _name.text = '${r['name'] ?? ''}';
      _price.text = '${r['price'] ?? 0}';
      _down.text = '${r['download_mbps'] ?? 0}';
      _up.text = '${r['upload_mbps'] ?? 0}';
      _durationValue.text = '${r['duration_value'] ?? 30}';
      _durationUnit = '${r['duration_unit'] ?? 'days'}';
      _type = '${r['type'] ?? 'pppoe'}';
      _fupBehavior = '${r['fup_behavior'] ?? 'throttle'}';
      _description.text = '${r['description'] ?? ''}';
      // Quotas are stored in MB but an ISP thinks in GB, so they are shown and typed in GB.
      final dq = numOf(r['daily_quota_mb'])?.toDouble();
      final mq = numOf(r['monthly_quota_mb'])?.toDouble();
      if (dq != null && dq > 0) _dailyQuota.text = (dq / 1024).toStringAsFixed(0);
      if (mq != null && mq > 0) _monthlyQuota.text = (mq / 1024).toStringAsFixed(0);
    }
  }

  @override
  void dispose() {
    for (final c in [
      _name, _price, _down, _up, _durationValue, _dailyQuota, _monthlyQuota, _description
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  int? _gbToMb(TextEditingController c) {
    final v = c.text.trim();
    if (v.isEmpty) return null;
    final n = double.tryParse(v);
    if (n == null || n <= 0) return null;
    return (n * 1024).round();
  }

  @override
  Widget build(BuildContext context) {
    return FormPage(
      title: isEdit ? 'تعديل باقة' : 'باقة جديدة',
      subtitle: isEdit ? '${widget.row!['name']}' : null,
      method: isEdit ? 'PUT' : 'POST',
      path: isEdit ? '/plans/${widget.row!['id']}' : '/plans',
      okMessage: isEdit ? 'حُفظت الباقة' : 'أُنشئت الباقة',
      body: () => compact({
        'name': _name.text.trim(),
        'type': _type,
        'price': double.tryParse(_price.text.trim()) ?? 0,
        'download_mbps': int.tryParse(_down.text.trim()) ?? 0,
        'upload_mbps': int.tryParse(_up.text.trim()) ?? 0,
        'duration_value': int.tryParse(_durationValue.text.trim()) ?? 30,
        'duration_unit': _durationUnit,
        'daily_quota_mb': _gbToMb(_dailyQuota),
        'monthly_quota_mb': _gbToMb(_monthlyQuota),
        'fup_behavior': _fupBehavior,
        'description': orNull(_description),
      }),
      fields: (context, rebuild) => [
        FormText(
          controller: _name,
          label: 'اسم الباقة',
          required: true,
          icon: Icons.local_offer_outlined,
        ),
        FormSelect<String>(
          value: _type,
          label: 'النوع',
          required: true,
          items: const {'pppoe': 'PPPoE', 'hotspot': 'هوت سبوت'},
          onChanged: (v) {
            _type = v ?? 'pppoe';
            rebuild();
          },
        ),
        FormText(
          controller: _price,
          label: 'السعر',
          required: true,
          ltr: true,
          keyboard: const TextInputType.numberWithOptions(decimal: true),
          icon: Icons.payments_outlined,
        ),
        const FormSection('السرعة — تُرسل مع كل مصادقة'),
        Row(children: [
          Expanded(
            child: FormText(
              controller: _down,
              label: 'التنزيل (ميغابت)',
              ltr: true,
              keyboard: TextInputType.number,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: FormText(
              controller: _up,
              label: 'الرفع (ميغابت)',
              ltr: true,
              keyboard: TextInputType.number,
            ),
          ),
        ]),
        const FormSection('المدّة'),
        Row(children: [
          Expanded(
            child: FormText(
              controller: _durationValue,
              label: 'القيمة',
              ltr: true,
              keyboard: TextInputType.number,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: FormSelect<String>(
              value: _durationUnit,
              label: 'الوحدة',
              required: true,
              items: const {'hours': 'ساعات', 'days': 'أيام', 'months': 'أشهر'},
              onChanged: (v) {
                final was = _durationUnit;
                _durationUnit = v ?? 'days';
                // The value has to follow the unit. Leaving 30 in place when the operator picks
                // months silently creates a thirty-month plan — a plausible number in the wrong
                // unit, which is exactly the kind of mistake nothing downstream would question.
                // Only the untouched default is replaced; a number the operator typed is kept.
                const defaults = {'hours': '24', 'days': '30', 'months': '1'};
                if (_durationValue.text.trim() == defaults[was]) {
                  _durationValue.text = defaults[_durationUnit]!;
                }
                rebuild();
              },
            ),
          ),
        ]),
        const FormSection('الحصّة — بالغيغابايت، اتركها فارغة لبلا حدّ'),
        Row(children: [
          Expanded(
            child: FormText(
              controller: _dailyQuota,
              label: 'يومية',
              ltr: true,
              keyboard: const TextInputType.numberWithOptions(decimal: true),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: FormText(
              controller: _monthlyQuota,
              label: 'شهرية',
              ltr: true,
              keyboard: const TextInputType.numberWithOptions(decimal: true),
            ),
          ),
        ]),
        FormSelect<String>(
          value: _fupBehavior,
          label: 'عند تجاوز الحصّة',
          required: true,
          items: const {
            'throttle': 'تخفيض السرعة',
            'disconnect': 'قطع الجلسة',
            'block': 'حظر حتى التجديد',
          },
          onChanged: (v) {
            _fupBehavior = v ?? 'throttle';
            rebuild();
          },
        ),
        const FormSection('أخرى'),
        FormText(controller: _description, label: 'وصف', maxLines: 3),
      ],
    );
  }
}
