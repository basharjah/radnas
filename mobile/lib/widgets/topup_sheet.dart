import 'package:flutter/material.dart';
import '../core/loader.dart';
import '../core/theme.dart';

/// Sell a subscriber extra data when they have burned through their bundle.
///
/// Offered only to a subscriber who is actually over quota — throttled or blocked. On anyone else
/// the button would be an invitation to charge for gigabytes they already have, and the server
/// would stack the bonus onto a quota that was never reached.
///
/// The server lifts the throttle and reconnects them at full speed the moment the top-up brings
/// them back under, so this is the whole fix, not the first half of one.
Future<bool> showTopupSheet(
  BuildContext context, {
  required String subscriberId,
  required String username,
  required bool blocked,
}) async {
  final dark = Theme.of(context).brightness == Brightness.dark;
  final saved = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    backgroundColor: dark ? C.surfaceD : C.surface,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
    ),
    builder: (_) => _TopupSheet(
      subscriberId: subscriberId,
      username: username,
      blocked: blocked,
    ),
  );
  return saved == true;
}

class _TopupSheet extends StatefulWidget {
  final String subscriberId, username;
  final bool blocked;
  const _TopupSheet({
    required this.subscriberId,
    required this.username,
    required this.blocked,
  });

  @override
  State<_TopupSheet> createState() => _TopupSheetState();
}

class _TopupSheetState extends State<_TopupSheet> {
  // The amounts an ISP actually sells, so the common case is one tap and no keyboard.
  static const _presets = [1, 2, 5, 10, 20, 50];
  final _custom = TextEditingController();
  num _gb = 5;
  bool _busy = false;

  @override
  void dispose() {
    _custom.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final typed = num.tryParse(_custom.text.trim());
    final gb = typed != null && typed > 0 ? typed : _gb;
    if (gb <= 0) return;

    setState(() => _busy = true);
    final ok = await send(
      context,
      'POST',
      '/subscribers/${widget.subscriberId}/topup',
      body: {'gb': gb},
      okMessage: 'شُحن $gb غيغابايت',
    );
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) Navigator.pop(context, true);
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final typed = num.tryParse(_custom.text.trim());
    final effective = typed != null && typed > 0 ? typed : _gb;

    return Padding(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom +
            MediaQuery.of(context).viewPadding.bottom + 20,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('شحن بيانات — ${widget.username}',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w700,
                  color: dark ? C.textD : C.text)),
          const SizedBox(height: 6),
          Text(
            widget.blocked
                ? 'المشترك محظور لتجاوزه حصّته. الشحن يُعيده فوراً.'
                : 'المشترك مخفَّض السرعة لتجاوزه حصّته. الشحن يُعيده إلى سرعته كاملة فوراً.',
            style: TextStyle(fontSize: 13.5, height: 1.8, color: dark ? C.mutedD : C.muted),
          ),
          const SizedBox(height: 18),
          Wrap(
            spacing: 9,
            runSpacing: 9,
            children: [
              for (final g in _presets)
                ChoiceChip(
                  label: Text('$g GB'),
                  selected: typed == null && _gb == g,
                  onSelected: (_) => setState(() {
                    _gb = g;
                    _custom.clear();
                  }),
                ),
            ],
          ),
          const SizedBox(height: 14),
          TextField(
            controller: _custom,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            textDirection: TextDirection.ltr,
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(
              labelText: 'أو اكتب كمية أخرى',
              suffixText: 'GB',
              prefixIcon: Icon(Icons.data_usage),
            ),
          ),
          const SizedBox(height: 18),
          FilledButton.icon(
            onPressed: _busy ? null : _send,
            icon: _busy
                ? const SizedBox(
                    height: 20,
                    width: 20,
                    child: CircularProgressIndicator(strokeWidth: 2.2, color: Colors.white))
                : const Icon(Icons.add_circle_outline),
            label: Text(_busy ? 'جارٍ الشحن…' : 'اشحن $effective غيغابايت'),
          ),
        ],
      ),
    );
  }
}

/// The badge and button a subscriber over quota gets, and nobody else does.
class TopupAction extends StatelessWidget {
  final Map<String, dynamic> row;
  final Future<void> Function() onDone;
  const TopupAction({super.key, required this.row, required this.onDone});

  /// True when the server says this subscriber is throttled or blocked for quota.
  static bool needed(Map<String, dynamic> row) =>
      row['fup_active'] == true || row['quota_locked'] == true;

  @override
  Widget build(BuildContext context) {
    if (!needed(row)) return const SizedBox.shrink();
    final blocked = row['quota_locked'] == true;

    return OutlinedButton.icon(
      onPressed: () async {
        final done = await showTopupSheet(
          context,
          subscriberId: '${row['id']}',
          username: '${row['username']}',
          blocked: blocked,
        );
        if (done) await onDone();
      },
      icon: const Icon(Icons.add_circle_outline),
      label: Text(blocked ? 'شحن بيانات — محظور' : 'شحن بيانات — مخفّض السرعة'),
      style: OutlinedButton.styleFrom(
        foregroundColor: blocked ? C.danger : C.warning,
        side: BorderSide(color: (blocked ? C.danger : C.warning).withValues(alpha: 0.5)),
      ),
    );
  }
}
