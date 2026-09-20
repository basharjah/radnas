import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/format.dart';
import '../core/theme.dart';
import '../screens/notifications_screen.dart';

/// The unread count, shared by every screen that shows the bell.
///
/// One poller for the whole app rather than one per screen: three tabs each asking every thirty
/// seconds is three times the load for the same answer, and they would disagree with each other
/// while they drifted apart.
class Unread extends ChangeNotifier {
  Unread._();
  static final Unread instance = Unread._();

  int count = 0;
  Timer? _timer;

  void start() {
    if (_timer != null) return;
    _poll();
    // Thirty seconds is slow enough to be invisible on a phone bill and fast enough that a signup
    // does not sit unseen while the operator is looking at the app.
    _timer = Timer.periodic(const Duration(seconds: 30), (_) => _poll());
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
    count = 0;
    notifyListeners();
  }

  Future<void> _poll() async {
    try {
      final r = await Api.instance.dio.get('/notifications/count');
      final n = numOf(r.data is Map ? r.data['unread'] : null)?.toInt() ?? 0;
      if (n != count) {
        count = n;
        notifyListeners();
      }
    } on DioException {
      // A missed poll is not worth telling anyone about; the next one is thirty seconds away.
    }
  }

  /// Called when the inbox is opened, so the badge clears without waiting for the next poll.
  Future<void> refresh() => _poll();
}

/// Bell with its unread badge. Drop into any AppBar's actions.
class BellButton extends StatelessWidget {
  const BellButton({super.key});

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: Unread.instance,
      builder: (context, _) {
        final n = Unread.instance.count;
        return IconButton(
          tooltip: n > 0 ? '$n إشعاراً غير مقروء' : 'الإشعارات',
          onPressed: () async {
            await Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const NotificationsScreen()),
            );
            await Unread.instance.refresh();
          },
          icon: Stack(
            clipBehavior: Clip.none,
            children: [
              Icon(n > 0 ? Icons.notifications : Icons.notifications_none),
              if (n > 0)
                PositionedDirectional(
                  top: -3,
                  end: -4,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                    constraints: const BoxConstraints(minWidth: 17),
                    decoration: BoxDecoration(
                      color: C.danger,
                      borderRadius: BorderRadius.circular(9),
                    ),
                    child: Text(
                      // Past ninety-nine the exact number stops meaning anything, and a
                      // three-digit badge no longer fits over the icon.
                      n > 99 ? '99+' : '$n',
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                          color: Colors.white,
                          fontSize: 10.5,
                          fontWeight: FontWeight.w800,
                          height: 1.4),
                    ),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}
