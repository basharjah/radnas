import 'package:flutter/material.dart';
import '../core/format.dart';
import '../core/theme.dart';

/// One subscriber's consumption — the panel's usage modal, field for field.
///
/// The order is the panel's and deliberately so: the ring answers "what is this line being used
/// for", the totals answer "how much", and the quota bars answer the only question that ends in an
/// action — is this subscriber about to be cut off, and are they already throttled.
///
/// Three things were missing here and are the reason a phone and a browser disagreed about the
/// same subscriber: the DAILY quota bar (a plan can meter by day, and that subscriber's whole
/// story is in a bar the app never drew), the topped-up gigabytes in the monthly label (the panel
/// shows 50 GB + 10 GB bought, the app showed only the 60 and left the operator unable to see they
/// had already sold them data), and the state line that names the throttle in words.
class UsageCard extends StatelessWidget {
  final Map<String, dynamic> usage;
  final bool dark;
  const UsageCard({super.key, required this.usage, required this.dark});

  /// Bought gigabytes, written the way the panel writes them: one decimal, and no ".0" on a whole
  /// number — "+10GB مشحون", never "+10.0GB مشحون".
  static String _gb(double mb) {
    final v = mb / 1024;
    final s = v.toStringAsFixed(1);
    return s.endsWith('.0') ? s.substring(0, s.length - 2) : s;
  }

  @override
  Widget build(BuildContext context) {
    final ink = dark ? C.textD : C.text;
    final dim = dark ? C.mutedD : C.muted;

    final dl = numOf(usage['download_mb'])?.toDouble() ?? 0;
    final ul = numOf(usage['upload_mb'])?.toDouble() ?? 0;
    // The server already adds these up; using its figure keeps the ring's centre identical to the
    // number the browser shows rather than a re-rounded near-miss.
    final total = numOf(usage['total_mb'])?.toDouble() ?? (dl + ul);

    final dailyUsed = numOf(usage['daily_used_mb'])?.toDouble() ?? 0;
    final monthlyUsed = numOf(usage['monthly_used_mb'])?.toDouble() ?? 0;
    final dailyQuota = numOf(usage['daily_quota_mb'])?.toDouble();
    final monthlyQuota = numOf(usage['monthly_quota_mb'])?.toDouble();
    final bonus = numOf(usage['bonus_quota_mb'])?.toDouble() ?? 0;
    final locked = usage['quota_locked'] == true;
    final fup = usage['fup_active'] == true;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('الاستهلاك',
                style: TextStyle(fontSize: 15.5, fontWeight: FontWeight.w700, color: ink)),
            const SizedBox(height: 16),

            if (total <= 0)
              Text(
                'لا يوجد استهلاك مُسجّل بعد.\n'
                'ستظهر كمية التنزيل والرفع هنا فور مرور بيانات المشترك عبر راوتر حقيقي.',
                style: TextStyle(fontSize: 13, height: 1.75, color: dim),
              )
            else
              Row(children: [
                SizedBox(
                  width: 118,
                  height: 118,
                  child: CustomPaint(
                    painter: _RingPainter(
                      dlFraction: total > 0 ? dl / total : 0,
                      track: dark ? C.borderD : C.border,
                    ),
                    child: Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(fmtData(total),
                              style: TextStyle(
                                  fontSize: 16, fontWeight: FontWeight.w800, color: ink)),
                          Text('الإجمالي', style: TextStyle(fontSize: 11, color: dim)),
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
                          pct: total > 0 ? dl / total : 0, dark: dark),
                      const SizedBox(height: 12),
                      _Key(color: C.cyan, label: 'الرفع', value: fmtData(ul),
                          pct: total > 0 ? ul / total : 0, dark: dark),
                    ],
                  ),
                ),
              ]),

            const SizedBox(height: 16),
            Row(children: [
              Expanded(child: _Cell(label: 'التنزيل (إجمالي)', value: fmtData(dl), dark: dark)),
              const SizedBox(width: 8),
              Expanded(child: _Cell(label: 'الرفع (إجمالي)', value: fmtData(ul), dark: dark)),
              const SizedBox(width: 8),
              Expanded(
                child: _Cell(
                  label: 'الجلسات',
                  value: '${numOf(usage['sessions'])?.round() ?? 0}',
                  dark: dark,
                ),
              ),
            ]),
            const SizedBox(height: 8),
            Row(children: [
              Expanded(
                child: _Cell(
                  label: 'اليوم (منذ 12 منتصف الليل)',
                  value: fmtData(dailyUsed),
                  dark: dark,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(child: _Cell(label: 'هذا الشهر', value: fmtData(monthlyUsed), dark: dark)),
            ]),

            // A daily-metered plan lives or dies by this bar, and the app used to omit it entirely.
            if (dailyQuota != null && dailyQuota > 0)
              _Quota(
                title: 'الحصة اليومية',
                used: dailyUsed,
                limit: dailyQuota,
                tone: C.electric,
                dark: dark,
              ),

            if (monthlyQuota != null && monthlyQuota > 0)
              _Quota(
                title: bonus > 0 ? 'الحصة الشهرية (+${_gb(bonus)}GB مشحون)' : 'الحصة الشهرية',
                used: monthlyUsed,
                limit: monthlyQuota + bonus,
                tone: locked ? C.danger : C.electric,
                dark: dark,
                state: locked
                    ? '⛔ محظور — تجاوز الحصة الشهرية'
                    : fup
                        ? '🐢 مخفّض السرعة (FUP) — تجاوز الحصة'
                        : null,
                stateTone: locked ? C.danger : C.warning,
              ),
          ],
        ),
      ),
    );
  }
}

/// One label/value pair from the panel's stats grid.
class _Cell extends StatelessWidget {
  final String label, value;
  final bool dark;
  const _Cell({required this.label, required this.value, required this.dark});

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
        decoration: BoxDecoration(
          color: (dark ? C.borderD : C.border).withValues(alpha: dark ? 0.35 : 0.35),
          borderRadius: BorderRadius.circular(9),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label,
                maxLines: 2,
                style: TextStyle(fontSize: 10.5, height: 1.35, color: dark ? C.mutedD : C.muted)),
            const SizedBox(height: 3),
            Text(value,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w700,
                    color: dark ? C.textD : C.text)),
          ],
        ),
      );
}

/// A quota bar with its heading, and — when it matters — what the overage has already done.
class _Quota extends StatelessWidget {
  final String title;
  final double used, limit;
  final Color tone;
  final bool dark;
  final String? state;
  final Color? stateTone;
  const _Quota({
    required this.title,
    required this.used,
    required this.limit,
    required this.tone,
    required this.dark,
    this.state,
    this.stateTone,
  });

  @override
  Widget build(BuildContext context) {
    final frac = limit > 0 ? (used / limit).clamp(0.0, 1.0).toDouble() : 0.0;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Divider(height: 26),
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          Flexible(
            child: Text(title,
                style: TextStyle(fontSize: 13, color: dark ? C.mutedD : C.muted)),
          ),
          const SizedBox(width: 8),
          Text('${fmtData(used)} / ${fmtData(limit)}',
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
            value: frac,
            minHeight: 9,
            backgroundColor: dark ? C.borderD : C.border,
            valueColor: AlwaysStoppedAnimation(tone),
          ),
        ),
        if (state != null) ...[
          const SizedBox(height: 9),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 8),
            decoration: BoxDecoration(
              color: (stateTone ?? C.warning).withValues(alpha: dark ? 0.18 : 0.10),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(state!,
                style: TextStyle(
                    fontSize: 12.5, fontWeight: FontWeight.w600, color: stateTone ?? C.warning)),
          ),
        ],
      ],
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
