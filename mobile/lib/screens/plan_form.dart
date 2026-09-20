import 'package:flutter/material.dart';
import '../core/format.dart';
import '../widgets/form_kit.dart';

/// Create or edit a plan — the same model the web panel uses, field for field.
///
/// Two rules are carried over from the panel exactly, because they are not presentation choices
/// but how the scheduler reads a plan:
///
/// 1. A plan is either UNLIMITED or carries exactly ONE quota, and the duration decides which:
///    a month-long plan is metered monthly, a day- or hour-long plan daily. An earlier version of
///    this screen offered both independently, which produces plans the panel cannot represent and
///    the scheduler only half-applies.
///
/// 2. Every one of the plan's twenty-one columns is sent on every save. The server writes them all
///    and turns anything missing into NULL, so a partial body does not leave the rest alone — it
///    erases them. That is what wiped live plans' daily quotas and FUP speeds.
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
  final _quotaGb = TextEditingController();
  final _fupDown = TextEditingController();
  final _fupUp = TextEditingController();
  final _pool = TextEditingController();
  final _expiredPool = TextEditingController();
  final _description = TextEditingController();

  String _type = 'pppoe';
  String _durationUnit = 'days';
  String _fupBehavior = 'throttle';
  bool _limited = false;

  bool get isEdit => widget.row != null;

  /// A month-long plan is metered monthly; anything shorter is metered daily.
  bool get _monthly => _durationUnit == 'months';

  @override
  void initState() {
    super.initState();
    final r = widget.row;
    if (r != null) {
      _name.text = '${r['name'] ?? ''}';
      _price.text = '${numOf(r['price']) ?? 0}';
      _down.text = '${numOf(r['download_mbps'])?.round() ?? 0}';
      _up.text = '${numOf(r['upload_mbps'])?.round() ?? 0}';
      _durationValue.text = '${numOf(r['duration_value'])?.round() ?? 30}';
      _durationUnit = '${r['duration_unit'] ?? 'days'}';
      _type = '${r['type'] ?? 'pppoe'}';
      _fupBehavior = '${r['fup_behavior'] ?? 'throttle'}';
      _description.text = '${r['description'] ?? ''}';
      _pool.text = '${r['mikrotik_pool'] ?? ''}';
      _expiredPool.text = '${r['expired_pool'] ?? ''}';

      // Whichever quota the plan actually carries sets both the mode and the single field shown.
      final dq = numOf(r['daily_quota_mb'])?.toDouble();
      final mq = numOf(r['monthly_quota_mb'])?.toDouble();
      _limited = (dq != null && dq > 0) || (mq != null && mq > 0);
      final held = _monthly ? mq : dq;
      if (held != null && held > 0) {
        // Stored in MB, typed in GB — trailing zeros trimmed so "2" does not read as "2.0".
        final gb = held / 1024;
        _quotaGb.text =
            gb == gb.roundToDouble() ? gb.round().toString() : gb.toStringAsFixed(1);
      }

      final fd = numOf(r['fup_down_kbps']);
      final fu = numOf(r['fup_up_kbps']);
      if (fd != null && fd > 0) _fupDown.text = '${fd.round()}';
      if (fu != null && fu > 0) _fupUp.text = '${fu.round()}';
    }
  }

  @override
  void dispose() {
    for (final c in [
      _name, _price, _down, _up, _durationValue, _quotaGb,
      _fupDown, _fupUp, _pool, _expiredPool, _description
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  int? _quotaMb() {
    final v = double.tryParse(_quotaGb.text.trim());
    if (v == null || v <= 0) return null;
    return (v * 1024).round();
  }

  @override
  Widget build(BuildContext context) {
    return FormPage(
      title: isEdit ? 'تعديل باقة' : 'باقة جديدة',
      subtitle: isEdit ? '${widget.row!['name']}' : null,
      method: isEdit ? 'PUT' : 'POST',
      path: isEdit ? '/plans/${widget.row!['id']}' : '/plans',
      okMessage: isEdit ? 'حُفظت الباقة' : 'أُنشئت الباقة',
      body: () {
        final r = widget.row ?? const <String, dynamic>{};
        final mb = _limited ? _quotaMb() : null;
        final throttling = _limited && _fupBehavior == 'throttle';
        return <String, dynamic>{
          'name': _name.text.trim(),
          'type': _type,
          'price': double.tryParse(_price.text.trim()) ?? 0,
          'download_mbps': int.tryParse(_down.text.trim()) ?? 0,
          'upload_mbps': int.tryParse(_up.text.trim()) ?? 0,
          'duration_value': int.tryParse(_durationValue.text.trim()) ?? 30,
          'duration_unit': _durationUnit,
          // Exactly one of these ever holds a value; the other is an explicit null.
          'daily_quota_mb': _monthly ? null : mb,
          'monthly_quota_mb': _monthly ? mb : null,
          'fup_behavior': _limited ? _fupBehavior : 'throttle',
          'fup_down_kbps': throttling ? int.tryParse(_fupDown.text.trim()) : null,
          'fup_up_kbps': throttling ? int.tryParse(_fupUp.text.trim()) : null,
          'mikrotik_pool': orNull(_pool),
          'expired_pool': orNull(_expiredPool),
          'description': orNull(_description),
          // Not shown on this screen, so carried through untouched rather than nulled.
          'daily_reset_price': numOf(r['daily_reset_price']) ?? 0,
          'free_hours_from': r['free_hours_from'],
          'free_hours_to': r['free_hours_to'],
          'burst_from': r['burst_from'],
          'burst_to': r['burst_to'],
          'allow_burst_monthly': r['allow_burst_monthly'] == true,
        };
      },
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
              label: 'التنزيل (Mbps)',
              ltr: true,
              keyboard: TextInputType.number,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: FormText(
              controller: _up,
              label: 'الرفع (Mbps)',
              ltr: true,
              keyboard: TextInputType.number,
            ),
          ),
        ]),

        const FormSection('المدّة'),
        Row(children: [
          Expanded(
            child: FormSelect<String>(
              value: _durationUnit,
              label: 'الوحدة',
              required: true,
              items: const {'hours': 'ساعات', 'days': 'أيام', 'months': 'أشهر'},
              onChanged: (v) {
                final was = _durationUnit;
                _durationUnit = v ?? 'days';
                // The count follows the unit, or picking "months" leaves 30 in place and quietly
                // creates a thirty-month plan. A number the operator typed is kept.
                const defaults = {'hours': '24', 'days': '30', 'months': '1'};
                if (_durationValue.text.trim() == defaults[was]) {
                  _durationValue.text = defaults[_durationUnit]!;
                }
                rebuild();
              },
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: FormText(
              controller: _durationValue,
              label: _monthly
                  ? 'عدد الأشهر'
                  : _durationUnit == 'hours'
                      ? 'عدد الساعات'
                      : 'عدد الأيام',
              ltr: true,
              keyboard: TextInputType.number,
            ),
          ),
        ]),

        const FormSection('نوع الاستهلاك'),
        // A segmented choice, not a switch: "unlimited" is a plan type an operator sells, not the
        // absence of a setting.
        SegmentedButton<bool>(
          segments: const [
            ButtonSegment(value: false, label: Text('غير محدودة')),
            ButtonSegment(value: true, label: Text('محدودة')),
          ],
          selected: {_limited},
          showSelectedIcon: false,
          onSelectionChanged: (s) {
            _limited = s.first;
            rebuild();
          },
        ),
        const SizedBox(height: 16),

        if (_limited) ...[
          FormText(
            controller: _quotaGb,
            label: _monthly ? 'الحصّة الشهرية (GB)' : 'الحصّة اليومية (GB)',
            required: true,
            ltr: true,
            keyboard: const TextInputType.numberWithOptions(decimal: true),
            icon: Icons.data_usage,
            hint: _monthly ? 'مثال: 50' : 'مثال: 2',
          ),
          FormSelect<String>(
            value: _fupBehavior,
            label: 'عند تجاوز الحصّة',
            required: true,
            items: const {
              'throttle': 'تخفيض السرعة (FUP)',
              'block': 'حظر الدخول',
              'disconnect': 'قطع الاتصال',
            },
            onChanged: (v) {
              _fupBehavior = v ?? 'throttle';
              rebuild();
            },
          ),
          if (_fupBehavior == 'throttle')
            Row(children: [
              Expanded(
                child: FormText(
                  controller: _fupDown,
                  label: 'التنزيل بعد التجاوز (Kbps)',
                  required: true,
                  ltr: true,
                  keyboard: TextInputType.number,
                  hint: 'مثال: 512',
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: FormText(
                  controller: _fupUp,
                  label: 'الرفع بعد التجاوز (Kbps)',
                  required: true,
                  ltr: true,
                  keyboard: TextInputType.number,
                  hint: 'مثال: 512',
                ),
              ),
            ]),
        ],

        const FormSection('بِرَك الراوتر — اتركها فارغة لاستعمال الافتراضية'),
        FormText(
          controller: _pool,
          label: 'Mikrotik pool',
          ltr: true,
          hint: 'main_PPP',
          icon: Icons.lan_outlined,
        ),
        FormText(
          controller: _expiredPool,
          label: 'Expired pool',
          ltr: true,
          hint: 'expired_PPP',
          icon: Icons.lan_outlined,
        ),

        const FormSection('أخرى'),
        FormText(controller: _description, label: 'وصف', maxLines: 3),
      ],
    );
  }
}
