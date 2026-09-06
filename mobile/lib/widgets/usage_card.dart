import 'package:flutter/material.dart';
import '../core/format.dart';
import '../core/theme.dart';

/// Download and upload as a ring, matching the panel.
///
/// The proportion is what an operator reads first — a subscriber whose upload is a third of the
/// total is seeding or sharing, and that shows in the shape before any number is read. Two bars
/// showed the magnitudes and hid exactly that.
class UsageCard extends StatelessWidget {
  final Map<String, dynamic> usage;
  final bool dark;
  const UsageCard({super.key, required this.usage, required this.dark});

  @override
  Widget build(BuildContext context) {
    final dl = numOf(usage['download_mb'])?.toDouble() ?? 0;
    final ul = numOf(usage['upload_mb'])?.toDouble() ?? 0;
    final total = dl + ul;
    final monthly = numOf(usage['monthly_used_mb'])?.toDouble() ?? 0;
    final quota = (numOf(usage['monthly_quota_mb'])?.toDouble() ?? 0) +
        (numOf(usage['bonus_quota_mb'])?.toDouble() ?? 0);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('الاستهلاك',
                style: TextStyle(
                    fontSize: 15.5, fontWeight: FontWeight.w700, color: dark ? C.textD : C.text)),
            const SizedBox(height: 16),
            if (total <= 0)
              Text('لا استهلاك مُسجّل بعد',
                  style: TextStyle(fontSize: 13.5, color: dark ? C.mutedD : C.muted))
            else
              Row(children: [
                SizedBox(
                  width: 118,
                  height: 118,
                  child: CustomPaint(
                    painter: _RingPainter(
                      dlFraction: dl / total,
                      track: dark ? C.borderD : C.border,
                    ),
                    child: Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(fmtData(total),
                              style: TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.w800,
                                  color: dark ? C.textD : C.text)),
                          Text('الإجمالي',
                              style:
                                  TextStyle(fontSize: 11, color: dark ? C.mutedD : C.muted)),
                        ],
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 18),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _Key(color: C.electric, label: 'التنزيل', value: fmtData(dl),
                          pct: dl / total, dark: dark),
                      const SizedBox(height: 12),
                      _Key(color: C.cyan, label: 'الرفع', value: fmtData(ul),
                          pct: ul / total, dark: dark),
                    ],
                  ),
                ),
              ]),
            if (quota > 0) ...[
              const Divider(height: 26),
              Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                Text('الحصة الشهرية',
                    style: TextStyle(fontSize: 13, color: dark ? C.mutedD : C.muted)),
                Text('${fmtData(monthly)} / ${fmtData(quota)}',
                    textDirection: TextDirection.ltr,
                    style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: dark ? C.textD : C.text)),
              ]),
              const SizedBox(height: 8),
              ClipRRect(
                borderRadius: BorderRadius.circular(6),
                child: LinearProgressIndicator(
                  value: (monthly / quota).clamp(0, 1).toDouble(),
                  minHeight: 9,
                  backgroundColor: dark ? C.borderD : C.border,
                  valueColor: AlwaysStoppedAnimation(
                      usage['quota_locked'] == true ? C.danger : C.electric),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Key extends StatelessWidget {
  final Color color;
  final String label, value;
  final double pct;
  final bool dark;
  const _Key(
      {required this.color,
      required this.label,
      required this.value,
      required this.pct,
      required this.dark});

  @override
  Widget build(BuildContext context) {
    final p = pct * 100;
    return Row(children: [
      Container(
        width: 10,
        height: 10,
        decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(3)),
      ),
      const SizedBox(width: 9),
      Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label,
                style: TextStyle(
                    fontSize: 13, fontWeight: FontWeight.w600, color: dark ? C.mutedD : C.muted)),
            Text('${p < 1 && p > 0 ? '<1' : p.round()}%',
                style: TextStyle(fontSize: 11.5, color: dark ? C.mutedD : C.muted)),
          ],
        ),
      ),
      Text(value,
          style: TextStyle(
              fontSize: 14, fontWeight: FontWeight.w700, color: dark ? C.textD : C.text)),
    ]);
  }
}

class _RingPainter extends CustomPainter {
  final double dlFraction;
  final Color track;
  _RingPainter({required this.dlFraction, required this.track});

  @override
  void paint(Canvas canvas, Size size) {
    const stroke = 15.0;
    final rect = Offset(stroke / 2, stroke / 2) &
        Size(size.width - stroke, size.height - stroke);
    final base = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..color = track;
    canvas.drawArc(rect, 0, 6.2831853, false, base);

    // A gap in the surface colour keeps the two arcs from reading as one when either is small.
    const gap = 0.06;
    const start = -1.5707963;
    final dlSweep = (6.2831853 * dlFraction) - gap;
    final ulSweep = (6.2831853 * (1 - dlFraction)) - gap;

    final dl = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..color = C.electric;
    final ul = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..color = C.cyan;

    if (dlSweep > 0) canvas.drawArc(rect, start + gap / 2, dlSweep, false, dl);
    if (ulSweep > 0) {
      canvas.drawArc(rect, start + 6.2831853 * dlFraction + gap / 2, ulSweep, false, ul);
    }
  }

  @override
  bool shouldRepaint(_RingPainter old) =>
      old.dlFraction != dlFraction || old.track != track;
}
