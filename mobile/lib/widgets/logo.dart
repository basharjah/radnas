import 'package:flutter/material.dart';

/// The company mark, in the one place that knows which file suits the theme.
///
/// The panel ships a blue lockup and a white one. Drawing the blue one on a dark ground makes it
/// disappear, and the white one on a light ground does the same — so the choice belongs here rather
/// than in each screen that happens to show it.
class BrandLogo extends StatelessWidget {
  final double height;

  /// Forces the white lockup regardless of theme — for use on the brand gradient, which is dark
  /// in both themes.
  final bool onColor;

  const BrandLogo({super.key, this.height = 34, this.onColor = false});

  @override
  Widget build(BuildContext context) {
    final white = onColor || Theme.of(context).brightness == Brightness.dark;
    return Image.asset(
      white ? 'assets/brand/logo-white.png' : 'assets/brand/logo-blue.png',
      height: height,
      fit: BoxFit.contain,
      // Named for screen readers, which would otherwise announce a bare image with no label.
      semanticLabel: 'RadNas',
      // A missing asset would otherwise render as a red error box across the header.
      errorBuilder: (_, __, ___) => Text(
        'RadNas',
        style: TextStyle(
          fontSize: height * 0.62,
          fontWeight: FontWeight.w800,
          color: white ? Colors.white : const Color(0xFF2563EB),
        ),
      ),
    );
  }
}
