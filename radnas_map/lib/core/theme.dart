import 'package:flutter/material.dart';

/// The panel's palette, carried over verbatim.
///
/// An operator moving between the web panel and the phone should not have to relearn what blue
/// means. These are the same tokens as `frontend/src/styles.css`.
class C {
  static const electric = Color(0xFF2563EB);
  static const cyan = Color(0xFF06B6D4);
  static const indigo = Color(0xFF4F46E5);
  static const success = Color(0xFF16A34A);
  static const danger = Color(0xFFDC2626);
  static const warning = Color(0xFFD97706);

  // light
  static const bg = Color(0xFFEEF2F8);
  static const surface = Color(0xFFFFFFFF);
  static const surface2 = Color(0xFFF5F8FC);
  static const text = Color(0xFF0F1B2D);
  static const muted = Color(0xFF64748B);
  static const border = Color(0xFFE3E9F2);

  // dark
  static const bgD = Color(0xFF0D1117);
  static const surfaceD = Color(0xFF161B22);
  static const surface2D = Color(0xFF1C232C);
  static const textD = Color(0xFFE6EDF3);
  static const mutedD = Color(0xFF8B98A9);
  static const borderD = Color(0xFF283040);
}

ThemeData _base(Brightness b) {
  final dark = b == Brightness.dark;
  final surface = dark ? C.surfaceD : C.surface;
  final onSurface = dark ? C.textD : C.text;
  final border = dark ? C.borderD : C.border;
  final muted = dark ? C.mutedD : C.muted;

  return ThemeData(
    useMaterial3: true,
    brightness: b,
    scaffoldBackgroundColor: dark ? C.bgD : C.bg,
    colorScheme: ColorScheme.fromSeed(
      seedColor: C.electric,
      brightness: b,
      primary: C.electric,
      secondary: C.cyan,
      error: C.danger,
      surface: surface,
    ),
    // No bundled Arabic face: both platforms ship one that renders Arabic correctly, and shipping
    // another would add megabytes to gain nothing. Weight and size carry the hierarchy instead.
    fontFamily: null,
    cardTheme: CardThemeData(
      color: surface,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: border),
      ),
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: surface,
      foregroundColor: onSurface,
      elevation: 0,
      scrolledUnderElevation: 0.5,
      centerTitle: false,
      titleTextStyle: TextStyle(color: onSurface, fontSize: 19, fontWeight: FontWeight.w700),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: dark ? C.surface2D : C.surface,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: C.electric, width: 1.6),
      ),
      labelStyle: TextStyle(color: muted),
      hintStyle: TextStyle(color: muted),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: C.electric,
        foregroundColor: Colors.white,
        minimumSize: const Size.fromHeight(50),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: onSurface,
        side: BorderSide(color: border),
        minimumSize: const Size.fromHeight(46),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: surface,
      indicatorColor: C.electric.withValues(alpha: dark ? 0.24 : 0.12),
      elevation: 0,
      height: 66,
      labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
      labelTextStyle: WidgetStatePropertyAll(
        TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: muted),
      ),
    ),
    dividerTheme: DividerThemeData(color: border, space: 1, thickness: 1),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
  );
}

ThemeData lightTheme() => _base(Brightness.light);
ThemeData darkTheme() => _base(Brightness.dark);

/// Colour for a subscriber's status, matching the panel's badges.
Color statusColor(String? s) => switch (s) {
      'active' => C.success,
      'expired' => C.warning,
      'disabled' => C.danger,
      _ => C.muted,
    };

String statusLabel(String? s) => switch (s) {
      'active' => 'مفعّل',
      'expired' => 'منتهٍ',
      'disabled' => 'موقوف',
      _ => '—',
    };
