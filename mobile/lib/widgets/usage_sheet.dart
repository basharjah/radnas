import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/format.dart';
import '../core/theme.dart';
import 'common.dart';
import 'topup_sheet.dart';
import 'usage_card.dart';

/// Usage for one subscriber, opened straight from the list — the panel's modal, as a sheet.
///
/// A sheet rather than a page because it is a glance, not a task: the operator is scanning a list,
/// checks one subscriber's consumption, and carries on scanning. Pushing a route would lose their
/// place in a list of four hundred.
Future<void> showUsageSheet(
  BuildContext context, {
  required String subscriberId,
  required String username,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    backgroundColor:
        Theme.of(context).brightness == Brightness.dark ? C.surfaceD : C.surface,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
    ),
    builder: (_) => _UsageSheet(subscriberId: subscriberId, username: username),
  );
}

class _UsageSheet extends StatefulWidget {
  final String subscriberId, username;
  const _UsageSheet({required this.subscriberId, required this.username});

  @override
  State<_UsageSheet> createState() => _UsageSheetState();
}

class _UsageSheetState extends State<_UsageSheet> {
  Map<String, dynamic>? _usage;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (mounted) setState(() => _error = null);
    try {
      final res =
          await Api.instance.dio.get('/subscribers/${widget.subscriberId}/usage');
      if (!mounted) return;
      if (res.statusCode != null && res.statusCode! < 300 && res.data is Map) {
        setState(() {
          _usage = Map<String, dynamic>.from(res.data);
          _loading = false;
        });
      } else {
        setState(() {
          _error = Api.errorOf(res);
          _loading = false;
        });
      }
    } on DioException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = Api.errorOf(e.response, e);
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;

    return Padding(
      // Sized to its content and capped, so a subscriber with no quota bar gets a short sheet
      // rather than a half-empty screen.
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        // The system navigation bar sits under the sheet, and without this the last row of tiles
        // ends up behind it.
        bottom: MediaQuery.of(context).viewInsets.bottom +
            MediaQuery.of(context).viewPadding.bottom + 20,
      ),
      child: ConstrainedBox(
        // Opens tall rather than hugging its content: the ring and the three tiles below it are
        // one reading, and a sheet sized to the ring alone pushes the tiles onto the phone's own
        // navigation bar.
        constraints: BoxConstraints(
          minHeight: MediaQuery.of(context).size.height * 0.62,
          maxHeight: MediaQuery.of(context).size.height * 0.88,
        ),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(children: [
                Expanded(
                  child: Text(
                    'الاستهلاك — ${widget.username}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w700,
                        color: dark ? C.textD : C.text),
                  ),
                ),
                if (!_loading)
                  IconButton(
                    onPressed: _load,
                    icon: const Icon(Icons.refresh),
                    tooltip: 'تحديث',
                  ),
              ]),
              const SizedBox(height: 12),
              if (_loading)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 44),
                  child: Center(child: CircularProgressIndicator()),
                )
              else if (_error != null)
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: C.danger.withValues(alpha: dark ? 0.16 : 0.08),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Row(children: [
                    const Icon(Icons.error_outline, color: C.danger, size: 20),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(_error!,
                          style: const TextStyle(color: C.danger, height: 1.6)),
                    ),
                    TextButton(onPressed: _load, child: const Text('إعادة')),
                  ]),
                )
              else ...[
                UsageCard(usage: _usage!, dark: dark),
                const SizedBox(height: 12),
                Row(children: [
                  Expanded(
                    child: StatTile(
                      label: 'اليوم',
                      value: fmtData(numOf(_usage!['daily_used_mb']) ?? 0),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: StatTile(
                      label: 'هذا الشهر',
                      value: fmtData(numOf(_usage!['monthly_used_mb']) ?? 0),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: StatTile(
                      label: 'الجلسات',
                      value: '${numOf(_usage!['sessions'])?.round() ?? 0}',
                    ),
                  ),
                ]),
                // The quota bar directly above has just shown them running out — this is where the
                // operator is already looking when they decide to sell more.
                if (_usage!['fup_active'] == true || _usage!['quota_locked'] == true) ...[
                  const SizedBox(height: 14),
                  TopupAction(
                    row: {
                      'id': widget.subscriberId,
                      'username': widget.username,
                      'fup_active': _usage!['fup_active'],
                      'quota_locked': _usage!['quota_locked'],
                    },
                    onDone: _load,
                  ),
                ],
              ],
            ],
          ),
        ),
      ),
    );
  }
}
