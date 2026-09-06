import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/format.dart';
import '../core/theme.dart';
import '../widgets/form_kit.dart';
import '../widgets/usage_sheet.dart';
import 'subscriber_detail_screen.dart';
import 'subscriber_form.dart';

/// The screen an operator lives in. Search, filter, scroll, open, renew.
class SubscribersScreen extends StatefulWidget {
  const SubscribersScreen({super.key});
  @override
  State<SubscribersScreen> createState() => _SubscribersScreenState();
}

class _SubscribersScreenState extends State<SubscribersScreen> {
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

  String _filter = 'all';
  String _q = '';
  int _page = 1, _total = 0;
  bool _loading = true, _more = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(() {
      // Load the next page a little before the end so the list never visibly stalls.
      if (_scroll.position.pixels > _scroll.position.maxScrollExtent - 400) _loadMore();
    });
    _load(reset: true);
  }

  @override
  void dispose() {
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

    return Scaffold(
      appBar: AppBar(
        title: Text(_total > 0 ? 'المشتركون · $_total' : 'المشتركون'),
      ),
      floatingActionButton: FloatingActionButton(
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
                                return _SubscriberCard(
                                  row: _rows[i],
                                  dark: dark,
                                  onUsage: () => showUsageSheet(
                                    context,
                                    subscriberId: '${_rows[i]['id']}',
                                    username: '${_rows[i]['username']}',
                                  ),
                                  onTap: () async {
                                    final changed = await Navigator.of(context).push<bool>(
                                      MaterialPageRoute(
                                        builder: (_) => SubscriberDetailScreen(row: _rows[i]),
                                      ),
                                    );
                                    if (changed == true) _load(reset: true);
                                  },
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
  final VoidCallback onTap, onUsage;
  const _SubscriberCard({
    required this.row,
    required this.dark,
    required this.onTap,
    required this.onUsage,
  });

  @override
  Widget build(BuildContext context) {
    final online = row['online'] == true;
    final status = row['status'] as String?;
    final left = daysLeft(row['expiry_at'] as String?);

    return Card(
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
          child: Row(
            children: [
              // Presence is the one thing worth encoding as shape, not text: it is what the
              // operator scans a list of 400 rows for.
              Container(
                width: 10,
                height: 10,
                margin: const EdgeInsetsDirectional.only(end: 12),
                decoration: BoxDecoration(
                  color: online ? C.success : (dark ? C.borderD : C.border),
                  shape: BoxShape.circle,
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
                onPressed: onUsage,
                icon: const Icon(Icons.donut_small_outlined, size: 21),
                color: C.electric,
                tooltip: 'الاستهلاك',
                visualDensity: VisualDensity.compact,
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(minWidth: 34, minHeight: 34),
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
                  Text(fmtData(numOf(row['monthly_used_mb']) ?? 0),
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
