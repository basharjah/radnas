import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';
import '../core/api.dart';
import '../core/format.dart';
import '../core/loader.dart';
import '../core/theme.dart';
import '../widgets/common.dart';
import '../widgets/form_kit.dart';
import '../widgets/topup_sheet.dart';
import '../widgets/usage_sheet.dart';
import 'subscriber_detail_screen.dart';
import 'subscriber_form.dart';

/// The screen an operator lives in. Search, filter, scroll, open, renew.
class SubscribersScreen extends StatefulWidget {
  const SubscribersScreen({super.key});
  @override
  State<SubscribersScreen> createState() => _SubscribersScreenState();
}

class _SubscribersScreenState extends State<SubscribersScreen>
    with WidgetsBindingObserver {
  // Ordered the way an operator scans: everyone, then who is up, then who is not, then the two
  // reasons an account stops working. `offline` is a computed filter on radacct, not a status —
  // a subscriber can be perfectly active and simply not dialled in.
  static const _filters = <String, String>{
    'all': 'الكل',
    'online': 'متصل',
    'offline': 'غير متصل',
    'disabled': 'متوقف',
    'expired': 'منته',
  };

  final _rows = <Map<String, dynamic>>[];
  final _scroll = ScrollController();
  final _search = TextEditingController();
  Timer? _debounce;
  Timer? _tick;

  /// Ids the operator has ticked. A Set of ids rather than of rows, so it survives a refresh:
  /// the row maps are replaced on every fetch, the ids are not.
  final _selected = <String>{};
  bool _selecting = false;
  bool _bulkBusy = false;

  String _filter = 'all';
  String _q = '';
  int _page = 1, _total = 0;
  bool _loading = true, _more = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // Re-read the list on a timer so a change made anywhere else shows up on its own: a subscriber
    // re-activated from the browser, one the scheduler just barred for quota, one who dialled in.
    // Fifteen seconds is slow enough to be free on a phone bill and fast enough that an operator
    // who taps "reconnect" and looks up again sees it has taken.
    _tick = Timer.periodic(const Duration(seconds: 15), (_) => _refreshQuietly());
    _scroll.addListener(() {
      // Load the next page a little before the end so the list never visibly stalls.
      if (_scroll.position.pixels > _scroll.position.maxScrollExtent - 400) _loadMore();
    });
    _load(reset: true);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Coming back to the app after a while is exactly when the list is most stale, and the timer
    // does not run while the phone is asleep.
    if (state == AppLifecycleState.resumed) _refreshQuietly();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _tick?.cancel();
    _debounce?.cancel();
    _scroll.dispose();
    _search.dispose();
    super.dispose();
  }

  void _onSearch(String v) {
    _debounce?.cancel();
    // Typing an Arabic name fires a request per keystroke otherwise, and the operator's phone is
    // usually on the same tunnel the subscribers are using.
    _debounce = Timer(const Duration(milliseconds: 380), () {
      _q = v.trim();
      _load(reset: true);
    });
  }

  Future<void> _load({bool reset = false}) async {
    if (reset) {
      setState(() {
        _loading = true;
        _error = null;
        _page = 1;
      });
    }
    try {
      final res = await Api.instance.dio.get('/subscribers', queryParameters: {
        'page': _page,
        'limit': 30,
        if (_q.isNotEmpty) 'q': _q,
        if (_filter != 'all') 'filter': _filter,
      });
      if (!mounted) return;
      if (res.statusCode == 200 && res.data is Map) {
        final data = (res.data['data'] as List?) ?? const [];
        setState(() {
          if (reset) _rows.clear();
          _rows.addAll(data.map((e) => Map<String, dynamic>.from(e as Map)));
          _total = numOf(res.data['total'])?.round() ?? _rows.length;
          _loading = false;
          _more = false;
        });
      } else {
        setState(() {
          _error = Api.errorOf(res);
          _loading = false;
          _more = false;
        });
      }
    } on DioException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = Api.errorOf(e.response, e);
        _loading = false;
        _more = false;
      });
    }
  }

  // -- Multi-select ---------------------------------------------------------

  void _exitSelect() => setState(() {
        _selecting = false;
        _selected.clear();
      });

  void _toggleSel(String id) => setState(() {
        if (!_selected.remove(id)) _selected.add(id);
        // Leaving selection mode on the last untick keeps the operator from being stranded in a
        // mode with nothing selected and no obvious way out.
        if (_selected.isEmpty) _selecting = false;
      });

  void _toggleAll() => setState(() {
        if (_selected.isEmpty) {
          _selected.addAll(_rows.map((r) => '${r['id']}'));
          _selecting = true;
        } else {
          _selected.clear();
          _selecting = false;
        }
      });

  /// Renew everything ticked, in one request.
  ///
  /// Only ids still on screen are sent: the selection can otherwise carry a row a later filter or
  /// search has dropped, and the operator would be renewing someone they can no longer see.
  ///
  /// The result is reported per subscriber, not as a single "done". A batch partly succeeds all the
  /// time - a subscriber with no plan fails while the rest renew - and the usual reason is worth
  /// naming, because it is fixable in one edit.
  Future<void> _bulkRenew() async {
    final ids = _rows.map((r) => '${r['id']}').where(_selected.contains).toList();
    if (ids.isEmpty) return;

    final names = _rows
        .where((r) => ids.contains('${r['id']}'))
        .map((r) => '${r['username']}')
        .toList();
    final preview = names.take(8).join('\u060C ') +
        (names.length > 8 ? ' \u2026 \u0648${names.length - 8} \u063A\u064A\u0631\u0647\u0645' : '');

    final ok = await confirm(
      context,
      title: 'تجديد جماعي',
      body: 'ستُجدَّد ${ids.length} باقة بمقدار مدّة الباقة لكل مشترك. '
          'التجديد المبكّر يحافظ على الوقت المتبقّي ولا يُهدره.\n\n$preview',
      action: 'تجديد',
    );
    if (!ok || !mounted) return;

    setState(() => _bulkBusy = true);
    try {
      final res = await Api.instance.dio.post('/subscribers/bulk-charge', data: {'ids': ids});
      if (!mounted) return;
      if (res.statusCode != null && res.statusCode! < 300 && res.data is Map) {
        final d = res.data as Map;
        final renewed = numOf(d['renewed'])?.round() ?? 0;
        final requested = numOf(d['requested'])?.round() ?? ids.length;
        final fails = ((d['results'] as List?) ?? const [])
            .whereType<Map>()
            .where((r) => r['ok'] != true)
            .toList();
        final noPlan = fails.any((f) => f['error'] == 'no_plan');
        toast(
          context,
          fails.isEmpty
              ? 'تم تجديد $renewed مشترك'
              : 'جُدّد $renewed من $requested \u2014 لم تُجدّد ${fails.length}'
                  '${noPlan ? ' (السبب الأشيع: لا باقة مرتبطة)' : ''}',
          ok: fails.isEmpty,
        );
        _selected.clear();
        _selecting = false;
        await _load(reset: true);
      } else {
        toast(context, Api.errorOf(res), ok: false);
      }
    } on DioException catch (e) {
      if (mounted) toast(context, Api.errorOf(e.response, e), ok: false);
    } finally {
      if (mounted) setState(() => _bulkBusy = false);
    }
  }

  // -- Row actions ----------------------------------------------------------

  /// Renew one subscriber, optionally for several plan periods at once.
  ///
  /// The multiplier counts PLAN DURATIONS, not months: on a daily plan "x3" is three days. The list
  /// row does not carry the plan's unit, so the choices are phrased as multiples of the plan's own
  /// duration rather than naming a unit that might be wrong.
  Future<void> _renewOne(Map<String, dynamic> row) async {
    if (row['plan_id'] == null) {
      toast(context, 'لا باقة مرتبطة بهذا المشترك — عيّن باقة أولاً', ok: false);
      return;
    }
    var times = 1;
    final go = await showDialog<bool>(
      context: context,
      builder: (c) => StatefulBuilder(
        builder: (c, setLocal) => AlertDialog(
          title: const Text('تجديد الاشتراك'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('${row['username']} \u00B7 ${row['plan_name'] ?? 'بلا باقة'}',
                  style: const TextStyle(fontWeight: FontWeight.w700)),
              const SizedBox(height: 14),
              const Text('مدّة التجديد', style: TextStyle(fontSize: 13)),
              const SizedBox(height: 6),
              DropdownButtonFormField<int>(
                initialValue: times,
                items: const [1, 2, 3, 6, 12]
                    .map((n) => DropdownMenuItem(
                          value: n,
                          child: Text(n == 1 ? 'مدّة الباقة' : '$n \u00D7 مدّة الباقة'),
                        ))
                    .toList(),
                onChanged: (v) => setLocal(() => times = v ?? 1),
              ),
              const SizedBox(height: 10),
              const Text('التجديد المبكّر يحافظ على الوقت المتبقّي.',
                  style: TextStyle(fontSize: 12.5)),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('إلغاء')),
            FilledButton(
              onPressed: () => Navigator.pop(c, true),
              style: FilledButton.styleFrom(minimumSize: const Size(96, 42)),
              child: const Text('تجديد الآن'),
            ),
          ],
        ),
      ),
    );
    if (go != true || !mounted) return;
    if (await send(context, 'POST', '/subscribers/${row['id']}/charge',
        body: {'months': times}, okMessage: 'تم التجديد')) {
      await _load(reset: true);
    }
  }

  /// Cut a subscriber off, or put them back on - the panel's disconnect / reconnect.
  ///
  /// This flips the stored status, which is what actually keeps them off the line: RADIUS refuses
  /// the next authentication. It is not the same as ending the open session, which the router lets
  /// them re-establish a second later.
  Future<void> _setStatus(Map<String, dynamic> row, String status) async {
    final cutting = status == 'disabled';
    if (cutting) {
      final ok = await confirm(
        context,
        title: 'قطع الاتصال',
        body: 'سيُقطع اتصال ${row['username']} فوراً ويُمنع من الاتصال '
            'حتى تُعيد تفعيله بزرّ «اتصال».',
        action: 'قطع الاتصال',
        danger: true,
      );
      if (!ok || !mounted) return;
    }
    if (await send(context, 'PUT', '/subscribers/${row['id']}',
        body: {'status': status},
        okMessage: cutting ? 'تم قطع الاتصال' : 'تمت إعادة الاتصال')) {
      await _load(reset: true);
    }
  }

  /// End the open session only. The device redials within seconds - this is how a speed or quota
  /// change is made to take effect now instead of at the next natural reconnect.
  Future<void> _cutSession(Map<String, dynamic> row) async {
    await send(context, 'POST', '/coa/disconnect',
        body: {'username': row['username']},
        okMessage: 'أُرسل أمر القطع — سيُعيد الاتصال خلال ثوانٍ');
  }

  /// Copy the subscriber's own login, ready to paste into a message to them.
  ///
  /// The password is not in the list response - it is read one row at a time from a dedicated
  /// endpoint, so that a screen showing four hundred subscribers is not also showing four hundred
  /// passwords. What lands on the clipboard is the finished message, not two fields the operator
  /// then has to assemble by hand on a phone keyboard.
  /// Fetch the subscriber's own login, ready to hand back to them.
  ///
  /// One request serves both the clipboard and the share sheet, because the sensitive part is the
  /// fetch, not what happens afterwards. The password is not in the list response - it is read a
  /// row at a time from a dedicated endpoint, so a screen showing four hundred subscribers is not
  /// also holding four hundred passwords.
  ///
  /// Returns the finished message, or null if it could not be read - the caller has already been
  /// told why.
  Future<String?> _credentialsText(Map<String, dynamic> row) async {
    try {
      final res = await Api.instance.dio.get('/subscribers/${row['id']}/credentials');
      if (!mounted) return null;
      if (res.statusCode == 200 && res.data is Map) {
        final d = res.data as Map;
        final name = (d['full_name'] as String?)?.trim();
        // Addressed to the customer, not dumped as two fields: this text is pasted into WhatsApp
        // as-is, and the operator should not have to write the sentence around it on a phone.
        return [
          if (name != null && name.isNotEmpty) 'مرحباً $name،',
          'بيانات اشتراكك بالإنترنت:',
          '',
          'اسم المستخدم: ${d['username']}',
          'كلمة المرور: ${d['password']}',
        ].join('\n');
      }
      toast(context, Api.errorOf(res), ok: false);
      return null;
    } on DioException catch (e) {
      if (mounted) {
        // A 404 here is the old backend answering, not a missing subscriber: the row is on screen.
        toast(
          context,
          e.response?.statusCode == 404
              ? 'يحتاج الخادم إلى التحديث لإظهار كلمة المرور'
              : Api.errorOf(e.response, e),
          ok: false,
        );
      }
      return null;
    }
  }

  Future<void> _copyCredentials(Map<String, dynamic> row) async {
    final text = await _credentialsText(row);
    if (text == null || !mounted) return;
    await Clipboard.setData(ClipboardData(text: text));
    if (mounted) toast(context, 'نُسخت بيانات الدخول');
  }

  /// Hand the credentials straight to WhatsApp - or to whatever the operator picks.
  ///
  /// Copying then switching apps then pasting is four steps on a phone, and the operator is
  /// usually standing in front of the customer while doing it. The system sheet lists every app
  /// that can receive text, so no single messenger has to be hard-coded.
  Future<void> _shareCredentials(Map<String, dynamic> row) async {
    final text = await _credentialsText(row);
    if (text == null || !mounted) return;
    await SharePlus.instance.share(
      ShareParams(text: text, subject: 'بيانات اشتراك ${row['username']}'),
    );
  }

  Future<void> _deleteRow(Map<String, dynamic> row) async {
    if (await deleteThing(context,
        path: '/subscribers/${row['id']}',
        what: 'مشترك',
        name: '${row['username']}')) {
      await _load(reset: true);
    }
  }

  /// The row's actions, reached from the row's own menu button. Long press is spoken for by
  /// selection, and these are not things to arrive at by accident: three change a live line and
  /// one is permanent.
  /// The row's actions.
  ///
  /// Opened tall and scrollable on purpose: the list runs to seven entries, and a sheet sized to
  /// its content puts the last of them under the phone's own navigation bar - which is exactly
  /// where "copy the password" had ended up, half-hidden.
  void _rowMenu(Map<String, dynamic> row) {
    final online = row['online'] == true;
    final disabled = row['status'] == 'disabled';
    final dark = Theme.of(context).brightness == Brightness.dark;
    final ink = dark ? C.textD : C.text;
    final dim = dark ? C.mutedD : C.muted;

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: dark ? C.surfaceD : C.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
      ),
      builder: (sheet) => SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.of(context).size.height * 0.85,
          ),
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(12, 4, 12, 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // Identity first, and enough of it to be sure this is the right person before
                // doing something that costs money or cuts a line.
                Padding(
                  padding: const EdgeInsets.fromLTRB(8, 4, 8, 14),
                  child: Row(children: [
                    Container(
                      width: 44,
                      height: 44,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: (online ? C.success : C.indigo)
                            .withValues(alpha: dark ? 0.22 : 0.12),
                        borderRadius: BorderRadius.circular(13),
                      ),
                      child: Icon(online ? Icons.wifi_tethering : Icons.person_outline,
                          size: 21, color: online ? C.success : C.indigo),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(children: [
                            Flexible(
                              child: Text('${row['username']}',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  textDirection: TextDirection.ltr,
                                  style: TextStyle(
                                      fontSize: 16.5,
                                      fontWeight: FontWeight.w800,
                                      color: ink)),
                            ),
                            const SizedBox(width: 8),
                            _Badge(
                                text: statusLabel(row['status'] as String?),
                                tone: statusColor(row['status'] as String?),
                                dark: dark),
                          ]),
                          const SizedBox(height: 3),
                          Text(
                            [
                              if ((row['full_name'] as String?)?.trim().isNotEmpty ?? false)
                                '${row['full_name']}',
                              if ((row['plan_name'] as String?)?.isNotEmpty ?? false)
                                '${row['plan_name']}',
                            ].join(' \u00B7 '),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(fontSize: 12.8, color: dim),
                          ),
                        ],
                      ),
                    ),
                  ]),
                ),

                _SheetGroup(dark: dark, children: [
                  _SheetItem(
                    icon: Icons.autorenew,
                    tone: C.success,
                    title: 'تجديد الاشتراك',
                    subtitle: 'يمدّد الانتهاء ويصفّر الحصّة',
                    dark: dark,
                    onTap: () {
                      Navigator.pop(sheet);
                      _renewOne(row);
                    },
                  ),
                  _SheetItem(
                    icon: Icons.donut_small_outlined,
                    tone: C.electric,
                    title: 'الاستهلاك',
                    subtitle: 'التنزيل والرفع والحصص',
                    dark: dark,
                    onTap: () {
                      Navigator.pop(sheet);
                      showUsageSheet(context,
                          subscriberId: '${row['id']}', username: '${row['username']}');
                    },
                  ),
                ]),
                const SizedBox(height: 10),

                // What the operator does when a customer phones: send them their login.
                if (TopupAction.needed(row))
                  _SheetGroup(dark: dark, children: [
                    _SheetItem(
                      icon: Icons.add_circle_outline,
                      tone: row['quota_locked'] == true
                          ? C.danger
                          : row['fup_active'] == true
                              ? C.warning
                              : C.electric,
                      title: 'شحن بيانات إضافية',
                      subtitle: row['quota_locked'] == true
                          ? 'محظور لتجاوز الحصّة — الشحن يعيده فوراً'
                          : row['fup_active'] == true
                              ? 'مخفّض السرعة — الشحن يرفع التخفيض'
                              : 'يضاف إلى حصّته الشهرية',
                      dark: dark,
                      onTap: () async {
                        Navigator.pop(sheet);
                        if (await showTopupSheet(
                          context,
                          subscriberId: '${row['id']}',
                          username: '${row['username']}',
                          blocked: row['quota_locked'] == true,
                        )) {
                          await _load(reset: true);
                        }
                      },
                    ),
                  ]),
                if (TopupAction.needed(row)) const SizedBox(height: 10),

                _SheetGroup(dark: dark, children: [
                  _SheetItem(
                    icon: Icons.ios_share,
                    tone: C.cyan,
                    title: 'إرسال بيانات الدخول',
                    subtitle: 'واتساب أو أي تطبيق آخر',
                    dark: dark,
                    onTap: () {
                      Navigator.pop(sheet);
                      _shareCredentials(row);
                    },
                  ),
                  _SheetItem(
                    icon: Icons.content_copy_outlined,
                    tone: C.indigo,
                    title: 'نسخ بيانات الدخول',
                    subtitle: 'إلى الحافظة',
                    dark: dark,
                    onTap: () {
                      Navigator.pop(sheet);
                      _copyCredentials(row);
                    },
                  ),
                ]),
                const SizedBox(height: 10),

                _SheetGroup(dark: dark, children: [
                  _SheetItem(
                    icon: disabled ? Icons.power_settings_new : Icons.block,
                    tone: disabled ? C.success : C.danger,
                    title: disabled ? 'إعادة الاتصال' : 'قطع الاتصال',
                    subtitle: disabled
                        ? 'يُسمح له بالاتصال من جديد'
                        : 'يُمنع من الاتصال حتى تُعيد تفعيله',
                    dark: dark,
                    onTap: () {
                      Navigator.pop(sheet);
                      _setStatus(row, disabled ? 'active' : 'disabled');
                    },
                  ),
                  _SheetItem(
                    icon: Icons.link_off,
                    tone: C.warning,
                    title: online ? 'إنهاء الجلسة الحالية' : 'لا جلسة مفتوحة',
                    subtitle: online ? 'يُعيد جهازه الاتصال خلال ثوانٍ' : null,
                    dark: dark,
                    enabled: online,
                    onTap: online
                        ? () {
                            Navigator.pop(sheet);
                            _cutSession(row);
                          }
                        : null,
                  ),
                ]),
                const SizedBox(height: 10),

                // On its own, away from everything else: it is the one action with no undo.
                _SheetGroup(dark: dark, children: [
                  _SheetItem(
                    icon: Icons.delete_outline,
                    tone: C.danger,
                    title: 'حذف المشترك',
                    subtitle: 'نهائي، لا يمكن التراجع',
                    dark: dark,
                    onTap: () {
                      Navigator.pop(sheet);
                      _deleteRow(row);
                    },
                  ),
                ]),
              ],
            ),
          ),
        ),
      ),
    );
  }

  /// Re-read what is already on screen, without a spinner and without moving anything.
  ///
  /// Not `_load(reset: true)`: that empties the list and rebuilds it, which throws the operator
  /// back to the top mid-scroll — on a list of four hundred that is worse than stale data. Here
  /// the rows are replaced in place, so the scroll position, the ticked selection and the open
  /// row all survive.
  ///
  /// It stands aside whenever the screen is already busy: a page being fetched, a bulk renew in
  /// flight, or a search the operator is still typing. Racing any of those would either duplicate
  /// rows or show results for a query that has since changed.
  Future<void> _refreshQuietly() async {
    if (!mounted || _loading || _more || _bulkBusy || _rows.isEmpty) return;
    // The server caps a page at 100. Beyond that the operator has scrolled a long way and is
    // reading rather than watching, so the visible top is refreshed and the tail left alone.
    final n = _rows.length > 100 ? 100 : _rows.length;
    try {
      final res = await Api.instance.dio.get('/subscribers', queryParameters: {
        'page': 1,
        'limit': n,
        if (_q.isNotEmpty) 'q': _q,
        if (_filter != 'all') 'filter': _filter,
      });
      if (!mounted || res.statusCode != 200 || res.data is! Map) return;
      final fresh = ((res.data['data'] as List?) ?? const [])
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList();
      // A changed total means rows were added or removed elsewhere; the list length would no
      // longer line up, so leave it to the next real load rather than splicing mismatched rows.
      final total = numOf(res.data['total'])?.round() ?? _total;
      setState(() {
        _total = total;
        for (var i = 0; i < fresh.length && i < _rows.length; i++) {
          _rows[i] = fresh[i];
        }
      });
    } on DioException {
      // A silent refresh fails silently. The operator did not ask for it, and an error banner for
      // a request they never made is noise — the next tick tries again.
    }
  }

  Future<void> _loadMore() async {
    if (_more || _loading || _rows.length >= _total) return;
    setState(() {
      _more = true;
      _page++;
    });
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;

    final allShown = _rows.isNotEmpty && _rows.every((r) => _selected.contains('${r['id']}'));

    return Scaffold(
      // In selection mode the bar becomes the selection's own toolbar: a count instead of a title,
      // a way out on the left, and the two things the selection is for on the right. Anything else
      // there would be an action the operator did not mean to reach with rows ticked.
      appBar: _selecting
          ? AppBar(
              leading: IconButton(
                onPressed: _exitSelect,
                icon: const Icon(Icons.close),
                tooltip: 'إلغاء التحديد',
              ),
              title: Text('محدَّد: ${_selected.length}'),
              actions: [
                IconButton(
                  onPressed: _rows.isEmpty ? null : _toggleAll,
                  icon: Icon(allShown ? Icons.deselect : Icons.select_all),
                  tooltip: allShown ? 'إلغاء تحديد الكل' : 'تحديد الكل (${_rows.length})',
                ),
              ],
            )
          : AppBar(
              title: Text(_total > 0 ? 'المشتركون · $_total' : 'المشتركون'),
              actions: [
                IconButton(
                  onPressed: _rows.isEmpty ? null : _toggleAll,
                  icon: const Icon(Icons.checklist),
                  tooltip: 'تحديد متعدّد',
                ),
              ],
            ),
      // Hidden while selecting: "new subscriber" sits exactly where the bulk button needs to be,
      // and adding a row mid-selection is not something anyone means to do.
      floatingActionButton: _selecting
          ? null
          : FloatingActionButton(
              onPressed: () async {
                if (await openForm(context, const SubscriberForm())) _load(reset: true);
              },
              tooltip: 'مشترك جديد',
              child: const Icon(Icons.person_add_alt_1),
            ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 4, 14, 8),
            child: TextField(
              controller: _search,
              onChanged: _onSearch,
              textInputAction: TextInputAction.search,
              decoration: InputDecoration(
                hintText: 'ابحث باسم المستخدم أو الاسم أو الهاتف',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: _search.text.isEmpty
                    ? null
                    : IconButton(
                        icon: const Icon(Icons.close),
                        tooltip: 'مسح البحث',
                        onPressed: () {
                          _search.clear();
                          _q = '';
                          _load(reset: true);
                        },
                      ),
              ),
            ),
          ),
          SizedBox(
            height: 42,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 14),
              itemCount: _filters.length,
              separatorBuilder: (_, __) => const SizedBox(width: 8),
              itemBuilder: (_, i) {
                final key = _filters.keys.elementAt(i);
                return ChoiceChip(
                  label: Text(_filters[key]!),
                  selected: _filter == key,
                  onSelected: (_) {
                    setState(() => _filter = key);
                    _load(reset: true);
                  },
                );
              },
            ),
          ),
          if (_selecting && _selected.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 8, 14, 2),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: _bulkBusy ? null : _bulkRenew,
                  icon: _bulkBusy
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                        )
                      : const Icon(Icons.autorenew),
                  label: Text(_bulkBusy
                      ? 'جارٍ التجديد…'
                      : 'تجديد المحدّدين (${_selected.length})'),
                  style: FilledButton.styleFrom(minimumSize: const Size(0, 46)),
                ),
              ),
            ),
          const SizedBox(height: 6),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _error != null
                    ? _Empty(
                        icon: Icons.error_outline,
                        title: _error!,
                        action: FilledButton(
                            onPressed: () => _load(reset: true), child: const Text('إعادة المحاولة')),
                      )
                    : _rows.isEmpty
                        ? _Empty(
                            icon: Icons.person_search_outlined,
                            title: _q.isEmpty
                                ? 'لا مشتركين في هذا التصنيف'
                                : 'لا نتيجة لـ «$_q»',
                          )
                        : RefreshIndicator(
                            onRefresh: () => _load(reset: true),
                            child: ListView.separated(
                              controller: _scroll,
                              padding: const EdgeInsets.fromLTRB(14, 2, 14, 88),
                              itemCount: _rows.length + (_rows.length < _total ? 1 : 0),
                              separatorBuilder: (_, __) => const SizedBox(height: 9),
                              itemBuilder: (context, i) {
                                if (i >= _rows.length) {
                                  return const Padding(
                                    padding: EdgeInsets.symmetric(vertical: 18),
                                    child: Center(child: CircularProgressIndicator()),
                                  );
                                }
                                final row = _rows[i];
                                final id = '${row['id']}';
                                return _SubscriberCard(
                                  row: row,
                                  dark: dark,
                                  selecting: _selecting,
                                  selected: _selected.contains(id),
                                  onUsage: () => showUsageSheet(
                                    context,
                                    subscriberId: id,
                                    username: '${row['username']}',
                                  ),
                                  // While selecting, a tap ticks the row instead of opening it —
                                  // otherwise every attempt to select the fifth of forty rows
                                  // navigates away and loses the four already ticked.
                                  onTap: () async {
                                    if (_selecting) {
                                      _toggleSel(id);
                                      return;
                                    }
                                    final changed = await Navigator.of(context).push<bool>(
                                      MaterialPageRoute(
                                        builder: (_) => SubscriberDetailScreen(row: row),
                                      ),
                                    );
                                    if (changed == true) _load(reset: true);
                                  },
                                  // Long press ticks the row - the gesture people already expect
                                  // from a list that supports selection. The row's own button
                                  // carries the actions.
                                  onLongPress: () => _toggleSel(id),
                                  onMenu: () => _rowMenu(row),
                                );
                              },
                            ),
                          ),
          ),
        ],
      ),
    );
  }
}

class _SubscriberCard extends StatelessWidget {
  final Map<String, dynamic> row;
  final bool dark;
  final bool selecting, selected;
  final VoidCallback onTap, onUsage, onLongPress, onMenu;
  const _SubscriberCard({
    required this.row,
    required this.dark,
    required this.selecting,
    required this.selected,
    required this.onTap,
    required this.onUsage,
    required this.onLongPress,
    required this.onMenu,
  });

  @override
  Widget build(BuildContext context) {
    final online = row['online'] == true;
    final status = row['status'] as String?;
    final left = daysLeft(row['expiry_at'] as String?);
    // Connected, but not at the speed they pay for. An amber dot says that at a glance, which is
    // what the operator needs when the customer's complaint is "the line is slow", not "it is
    // down": green would send them hunting for a fault that is really a quota doing its job.
    // Blocked by quota outranks it - they are connected and getting nothing.
    // NOT gated on being online, and that was a real defect: a quota-blocked subscriber is
    // rejected by RADIUS, so they can never be connected — which made `online && quota_locked`
    // impossible to satisfy. The red dot and the «محظور حصّة» badge could not appear at all.
    //
    // Both flags describe the ACCOUNT, not the session. A throttled subscriber who is offline is
    // still throttled; the operator needs to know that before the customer rings to ask why.
    final throttled = row['fup_active'] == true;
    final blocked = row['quota_locked'] == true;
    // Needs renewing: already finished, or close enough that the operator should be collecting
    // money now rather than fielding a complaint in three days.
    final needsRenewal =
        row['status'] == 'expired' || (left != null && left <= 3);

    // The dot answers one question at a glance, so the states are ranked by which one the operator
    // must act on first - not by which is technically most recent.
    //
    // Renewal outranks being online. A subscriber whose month ends tonight is still connected and
    // still green under the old rule, which is exactly the row that gets scrolled past; the whole
    // point of the third colour is that it stops being invisible while there is still time to
    // renew them.
    final dotColor = blocked
        ? C.danger                              // محظور: مقطوع فعلاً، والهاتف سيرنّ
        : needsRenewal
            ? C.warning                         // يحتاج تجديد: منتهٍ أو باقٍ له ثلاثة أيام
            : throttled
                ? C.indigo                      // مخفّض FUP - ومعه شارة نصّية أيضاً
                : !online
                    ? (dark ? C.borderD : C.border)
                    : C.success;

    return Card(
      // A ticked row is tinted as well as checked: on a list of forty, a checkbox alone at the far
      // edge is not what the eye counts.
      color: selected ? C.electric.withValues(alpha: dark ? 0.22 : 0.10) : null,
      child: InkWell(
        onTap: onTap,
        onLongPress: onLongPress,
        borderRadius: BorderRadius.circular(14),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
          child: Row(
            children: [
              // Presence is the one thing worth encoding as shape, not text: it is what the
              // operator scans a list of 400 rows for. While selecting, the tick takes its place
              // rather than crowding beside it.
              if (selecting)
                Padding(
                  padding: const EdgeInsetsDirectional.only(end: 6),
                  child: Icon(
                    selected ? Icons.check_box : Icons.check_box_outline_blank,
                    size: 22,
                    color: selected ? C.electric : (dark ? C.mutedD : C.muted),
                  ),
                )
              else
                Tooltip(
                  // Same ladder as the colour above, in words. If the two ever disagree the dot
                  // is worse than useless — it teaches a meaning the tooltip then denies.
                  message: blocked
                      ? 'محظور — تجاوز الحصّة'
                      : needsRenewal
                          ? (left != null && left < 0
                              ? 'منتهٍ — يحتاج تجديداً'
                              : 'يحتاج تجديداً قريباً')
                          : throttled
                              ? 'مخفَّض السرعة (FUP)'
                              : !online
                                  ? 'غير متصل'
                                  : 'متصل',
                  child: Container(
                    width: 10,
                    height: 10,
                    margin: const EdgeInsetsDirectional.only(end: 12),
                    decoration: BoxDecoration(color: dotColor, shape: BoxShape.circle),
                  ),
                ),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(children: [
                      Flexible(
                        child: Text(
                          '${row['username']}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          textDirection: TextDirection.ltr,
                          style: TextStyle(
                              fontSize: 15.5,
                              fontWeight: FontWeight.w700,
                              color: dark ? C.textD : C.text),
                        ),
                      ),
                      const SizedBox(width: 8),
                      _Badge(text: statusLabel(status), tone: statusColor(status), dark: dark),
                      // Colour alone is not enough: an operator glancing at a phone in daylight,
                      // or one who does not separate green from amber, still has to be told.
                      if (blocked) ...[
                        const SizedBox(width: 5),
                        _Badge(text: 'محظور حصّة', tone: C.danger, dark: dark),
                      ] else if (throttled) ...[
                        const SizedBox(width: 5),
                        _Badge(text: 'FUP', tone: C.warning, dark: dark),
                      ],
                    ]),
                    const SizedBox(height: 3),
                    Text(
                      [
                        if ((row['full_name'] as String?)?.trim().isNotEmpty ?? false)
                          '${row['full_name']}',
                        if ((row['plan_name'] as String?)?.isNotEmpty ?? false) '${row['plan_name']}',
                      ].join(' · '),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 12.8, color: dark ? C.mutedD : C.muted),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              // Usage sits next to the consumption figure it explains, and is reachable without
              // opening the subscriber — the same one-tap glance the panel's modal gives.
              IconButton(
                onPressed: selecting ? null : onUsage,
                icon: const Icon(Icons.donut_small_outlined, size: 21),
                color: C.electric,
                tooltip: 'الاستهلاك',
                visualDensity: VisualDensity.compact,
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(minWidth: 34, minHeight: 34),
              ),
              // Renew, cut, reconnect, copy, delete - one button rather than five squeezed onto a
              // phone-width row, and it is where the eye already looks for a row's actions.
              IconButton(
                onPressed: selecting ? null : onMenu,
                icon: const Icon(Icons.more_vert, size: 21),
                tooltip: 'إجراءات',
                visualDensity: VisualDensity.compact,
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(minWidth: 30, minHeight: 34),
              ),
              const SizedBox(width: 2),
              Column(crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    left == null
                        ? '—'
                        : left < 0
                            ? 'انتهى'
                            : left == 0
                                ? 'ينتهي اليوم'
                                : '$left يوماً',
                    style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w600,
                      color: left == null
                          ? (dark ? C.mutedD : C.muted)
                          : left < 0
                              ? C.danger
                              : left <= 7
                                  ? C.warning
                                  : (dark ? C.mutedD : C.muted),
                    ),
                  ),
                  const SizedBox(height: 3),
                  // Daily and monthly together, always — not only once a quota trips. The daily
                  // figure is what an operator checks when a customer says "the line died today":
                  // a subscriber at 40 GB this month but 0 today is a fault, not heavy use, and
                  // the monthly number alone hides exactly that.
                  Text('اليوم ${fmtData(numOf(row['daily_used_mb']) ?? 0)}',
                      style: TextStyle(fontSize: 11.5, color: dark ? C.mutedD : C.muted)),
                  Text('الشهر ${fmtData(numOf(row['monthly_used_mb']) ?? 0)}',
                      style: TextStyle(fontSize: 11.5, color: dark ? C.mutedD : C.muted)),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A rounded block of related actions, the way a phone's own settings group them.
class _SheetGroup extends StatelessWidget {
  final List<Widget> children;
  final bool dark;
  const _SheetGroup({required this.children, required this.dark});

  @override
  Widget build(BuildContext context) => Container(
        decoration: BoxDecoration(
          color: dark ? C.surface2D : C.surface2,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: dark ? C.borderD : C.border),
        ),
        child: Column(
          children: [
            for (var i = 0; i < children.length; i++) ...[
              if (i > 0)
                Divider(height: 1, indent: 62, color: dark ? C.borderD : C.border),
              children[i],
            ],
          ],
        ),
      );
}

/// One action: a tinted icon, what it does, and what it will cost.
///
/// The subtitle is not decoration. Four of these change a live line and one deletes a customer,
/// and the difference between "cut the connection" and "end the current session" is not something
/// a title alone conveys to someone tapping quickly.
class _SheetItem extends StatelessWidget {
  final IconData icon;
  final Color tone;
  final String title;
  final String? subtitle;
  final bool dark, enabled;
  final VoidCallback? onTap;
  const _SheetItem({
    required this.icon,
    required this.tone,
    required this.title,
    required this.dark,
    this.subtitle,
    this.enabled = true,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final on = enabled && onTap != null;
    final ink = on ? (dark ? C.textD : C.text) : (dark ? C.mutedD : C.muted);
    return InkWell(
      onTap: on ? onTap : null,
      borderRadius: BorderRadius.circular(16),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
        child: Row(children: [
          Container(
            width: 34,
            height: 34,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: tone.withValues(alpha: on ? (dark ? 0.22 : 0.12) : 0.07),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon,
                size: 19, color: on ? tone : (dark ? C.mutedD : C.muted)),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title,
                    style: TextStyle(
                        fontSize: 14.5, fontWeight: FontWeight.w600, color: ink)),
                if (subtitle != null) ...[
                  const SizedBox(height: 2),
                  Text(subtitle!,
                      style: TextStyle(
                          fontSize: 11.8,
                          height: 1.4,
                          color: dark ? C.mutedD : C.muted)),
                ],
              ],
            ),
          ),
          if (on)
            Icon(Icons.chevron_left, size: 19, color: dark ? C.mutedD : C.muted),
        ]),
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  final String text;
  final Color tone;
  final bool dark;
  const _Badge({required this.text, required this.tone, required this.dark});

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2.5),
        decoration: BoxDecoration(
          color: tone.withValues(alpha: dark ? 0.22 : 0.11),
          borderRadius: BorderRadius.circular(6),
        ),
        child: Text(text,
            style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: tone)),
      );
}

class _Empty extends StatelessWidget {
  final IconData icon;
  final String title;
  final Widget? action;
  const _Empty({required this.icon, required this.title, this.action});

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 46, color: dark ? C.mutedD : C.muted),
            const SizedBox(height: 14),
            Text(title,
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 15, height: 1.7, color: dark ? C.mutedD : C.muted)),
            if (action != null) ...[const SizedBox(height: 18), action!],
          ],
        ),
      ),
    );
  }
}
