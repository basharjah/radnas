// Formatting shared by every screen, so the same number never appears two ways.

/// Read a number out of a JSON value, whatever shape it arrived in.
///
/// Postgres returns `bigint` and `numeric` as STRINGS over the wire — node-postgres does this on
/// purpose, because both can hold values a JavaScript double cannot represent exactly. So
/// `monthly_used_mb`, `price` and the accounting octet counters all arrive as `"1986"`, not `1986`.
///
/// A plain `as num?` cast on those throws at runtime. In a debug build that is a red screen; in a
/// release build Flutter's default error widget is a plain GREY RECTANGLE, so the whole list
/// silently renders as one flat grey block with no message anywhere. That cost an evening.
num? numOf(dynamic v) {
  if (v == null) return null;
  if (v is num) return v;
  if (v is String) return num.tryParse(v.trim());
  return null;
}

String fmtData(num mb) {
  if (mb >= 1024) return '${(mb / 1024).toStringAsFixed(2)} GB';
  if (mb < 10) return '${mb.toStringAsFixed(2)} MB';
  return '${mb.round()} MB';
}

String fmtMoney(num? v) {
  if (v == null) return '—';
  final s = v.toStringAsFixed(v == v.roundToDouble() ? 0 : 2);
  // Thousands separators, applied to the integer part only.
  final parts = s.split('.');
  final buf = StringBuffer();
  final digits = parts[0];
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) buf.write(',');
    buf.write(digits[i]);
  }
  return parts.length > 1 ? '${buf.toString()}.${parts[1]}' : buf.toString();
}

String fmtDate(String? iso) {
  if (iso == null || iso.isEmpty) return '—';
  final d = DateTime.tryParse(iso);
  if (d == null) return '—';
  final l = d.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${l.year}-${two(l.month)}-${two(l.day)}';
}

/// "منذ 3 دقائق" / "بعد 12 يوماً" — the phrasing an operator actually scans for.
///
/// Arabic marks duals and small plurals differently from English, so this is written out rather
/// than run through a generic pluralizer that would produce "منذ 2 ساعة".
String relative(String? iso) {
  if (iso == null || iso.isEmpty) return '—';
  final d = DateTime.tryParse(iso);
  if (d == null) return '—';
  final diff = DateTime.now().difference(d.toLocal());
  final future = diff.isNegative;
  final s = diff.abs();
  final pre = future ? 'بعد' : 'منذ';

  String unit(int n, String one, String two, String few, String many) {
    if (n == 1) return one;
    if (n == 2) return two;
    if (n <= 10) return '$n $few';
    return '$n $many';
  }

  if (s.inMinutes < 1) return 'الآن';
  if (s.inMinutes < 60) {
    return '$pre ${unit(s.inMinutes, 'دقيقة', 'دقيقتين', 'دقائق', 'دقيقة')}';
  }
  if (s.inHours < 24) {
    return '$pre ${unit(s.inHours, 'ساعة', 'ساعتين', 'ساعات', 'ساعة')}';
  }
  if (s.inDays < 30) {
    return '$pre ${unit(s.inDays, 'يوم', 'يومين', 'أيام', 'يوماً')}';
  }
  final months = (s.inDays / 30).floor();
  return '$pre ${unit(months, 'شهر', 'شهرين', 'أشهر', 'شهراً')}';
}

/// Days until expiry — negative once past. Used to colour the row before the text is read.
int? daysLeft(String? expiryIso) {
  if (expiryIso == null || expiryIso.isEmpty) return null;
  final d = DateTime.tryParse(expiryIso);
  if (d == null) return null;
  final now = DateTime.now();
  final target = DateTime(d.toLocal().year, d.toLocal().month, d.toLocal().day);
  final today = DateTime(now.year, now.month, now.day);
  return target.difference(today).inDays;
}

/// "30 يوماً" / "شهران" — a plan's period, read straight from the two columns the panel stores.
String durationLabel(int? value, String? unit) {
  if (value == null) return '—';
  String pick(String one, String two, String few, String many) {
    if (value == 1) return one;
    if (value == 2) return two;
    if (value <= 10) return '$value $few';
    return '$value $many';
  }
  switch (unit) {
    case 'months':
      return pick('شهر', 'شهران', 'أشهر', 'شهراً');
    case 'hours':
      return pick('ساعة', 'ساعتان', 'ساعات', 'ساعة');
    default:
      return pick('يوم', 'يومان', 'أيام', 'يوماً');
  }
}

/// Live throughput, read at a glance rather than converted in the head.
///
/// The router reports bits per second, which is what an ISP's plans are sold in — so the units
/// stay bits here and are never silently divided by eight into bytes.
String fmtSpeed(num? bps) {
  if (bps == null || bps <= 0) return '0';
  final k = bps / 1000;
  if (k < 1000) return '${k.round()} K';
  final m = k / 1000;
  return '${m < 10 ? m.toStringAsFixed(1) : m.round()} M';
}

/// A session's length, from the seconds RADIUS counts.
String fmtDuration(num? seconds) {
  final s = (seconds ?? 0).round();
  if (s <= 0) return '—';
  final d = s ~/ 86400, h = (s % 86400) ~/ 3600, m = (s % 3600) ~/ 60;
  if (d > 0) return '$d ي $h س';
  if (h > 0) return '$h س $m د';
  return '$m د';
}
