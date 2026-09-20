import 'package:flutter/material.dart';
import '../core/theme.dart';

/// Pieces every list screen needs, in one place.
///
/// Ten screens were each about to grow their own error box and empty state. Duplicating them is how
/// two screens end up disagreeing about what a failure looks like, and the operator learns to read
/// each screen separately instead of reading the app.

/// A short coloured label. Carries state as shape and colour, not only as a word.
///
/// Named Tag rather than Badge: Material exports a Badge of its own, and the collision is a
/// compile error in every file that imports both.
class Tag extends StatelessWidget {
  final String text;
  final Color tone;
  const Tag(this.text, {super.key, required this.tone});

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2.5),
      decoration: BoxDecoration(
        color: tone.withValues(alpha: dark ? 0.22 : 0.11),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(text,
          style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: tone)),
    );
  }
}

/// Label on the right, value on the left — the pairing used on every detail card.
class Field extends StatelessWidget {
  final String label, value;
  final bool ltr;
  final Color? tone;
  const Field(this.label, this.value, {super.key, this.ltr = false, this.tone});

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 104,
            child: Text(label, style: TextStyle(fontSize: 13.5, color: dark ? C.mutedD : C.muted)),
          ),
          Expanded(
            child: Text(
              value,
              textDirection: ltr ? TextDirection.ltr : null,
              textAlign: ltr ? TextAlign.right : null,
              style: TextStyle(
                fontSize: 14.5,
                fontWeight: FontWeight.w600,
                color: tone ?? (dark ? C.textD : C.text),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Nothing to show, or nothing could be fetched. Always says which, and offers the way out.
class StateView extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? detail;
  final VoidCallback? onRetry;
  final bool isError;
  const StateView({
    super.key,
    required this.icon,
    required this.title,
    this.detail,
    this.onRetry,
    this.isError = false,
  });

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final tone = isError ? C.danger : (dark ? C.mutedD : C.muted);
    // Wrapped in a scrollable so pull-to-refresh still works on an empty list.
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(32, 60, 32, 32),
          child: Column(
            children: [
              Icon(icon, size: 46, color: tone),
              const SizedBox(height: 15),
              Text(title,
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 15, height: 1.7, color: tone)),
              if (detail != null) ...[
                const SizedBox(height: 6),
                Text(detail!,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                        fontSize: 13, height: 1.7, color: dark ? C.mutedD : C.muted)),
              ],
              if (onRetry != null) ...[
                const SizedBox(height: 20),
                FilledButton(onPressed: onRetry, child: const Text('إعادة المحاولة')),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

/// A number with its name. Used in rows of two or three above a list.
class StatTile extends StatelessWidget {
  final String label, value;
  final Color? tone;
  const StatTile({super.key, required this.label, required this.value, this.tone});

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 13),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 12, color: dark ? C.mutedD : C.muted)),
            const SizedBox(height: 5),
            Text(value,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                    fontSize: 19,
                    fontWeight: FontWeight.w800,
                    color: tone ?? (dark ? C.textD : C.text))),
          ],
        ),
      ),
    );
  }
}

/// Confirms an action that cannot be quietly undone.
Future<bool> confirm(
  BuildContext context, {
  required String title,
  required String body,
  String action = 'تأكيد',
  bool danger = false,
}) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (c) => AlertDialog(
      title: Text(title),
      content: Text(body),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('إلغاء')),
        FilledButton(
          onPressed: () => Navigator.pop(c, true),
          style: FilledButton.styleFrom(
            backgroundColor: danger ? C.danger : null,
            minimumSize: const Size(96, 42),
          ),
          child: Text(action),
        ),
      ],
    ),
  );
  return ok == true;
}

void toast(BuildContext context, String msg, {bool ok = true}) {
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(
    content: Text(msg),
    backgroundColor: ok ? C.success : C.danger,
  ));
}
