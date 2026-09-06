import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../widgets/common.dart';
import '../widgets/ping_sheet.dart';

/// Tapping a subscriber's address tests it, the way the panel does.
///
/// It does NOT open a browser. These pools live inside each company's tunnel and are unreachable
/// from a phone on mobile data, so a link would fail every time and teach the operator that the
/// address is dead when it is not. The panel pings instead — from the server, out that company's
/// own tunnel — and that is the answer an operator actually wants: is the line up, and how far.
Future<void> openDeviceIp(BuildContext context, String? ip, {String? username}) async {
  final addr = (ip ?? '').trim();
  if (addr.isEmpty || addr == '—') return;
  await showPingSheet(context, ip: addr, username: username);
}

/// Long-press anywhere an address is shown: copy it.
Future<void> copyIp(BuildContext context, String? ip) async {
  final addr = (ip ?? '').trim();
  if (addr.isEmpty || addr == '—') return;
  await Clipboard.setData(ClipboardData(text: addr));
  if (!context.mounted) return;
  toast(context, 'نُسخ $addr');
}
