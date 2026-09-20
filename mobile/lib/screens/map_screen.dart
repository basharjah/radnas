import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/format.dart';
import '../core/theme.dart';
import '../widgets/common.dart';

/// The network map — The Dude's centrepiece, rebuilt for a phone.
///
/// It is drawn from what the routers themselves report: every MikroTik announces its identity to
/// its neighbours, and the router collects those announcements along with the interface each one
/// arrived on. That interface IS the link, so nothing here is drawn by hand or guessed — plug a new
/// antenna into a sector and it appears on the map by itself within the minute.
///
/// Deliberately a tree, not the free-floating canvas the desktop program uses. A WISP's network is
/// a router, its sectors, and the antennas on each sector; that nests naturally and stays readable
/// on a six-inch screen, where a force-directed graph of seventy nodes becomes a hairball that
/// cannot be tapped.
class MapScreen extends StatefulWidget {
  const MapScreen({super.key});
  @override
  State<MapScreen> createState() => _MapScreenState();
}

class _MapScreenState extends State<MapScreen> {
  List<Map<String, dynamic>> _sites = const [];
  bool _loading = true;
  String? _error;
  String _q = '';
  Timer? _tick;

  @override
  void initState() {
    super.initState();
    _load();
    _tick = Timer.periodic(const Duration(seconds: 45), (_) => _load(silent: true));
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent && mounted) setState(() => _error = null);
    try {
      final res = await Api.instance.dio.get('/monitor/map');
      if (!mounted) return;
      if (res.statusCode == 200 && res.data is Map) {
        setState(() {
          _sites = ((res.data['sites'] as List?) ?? const [])
              .map((e) => Map<String, dynamic>.from(e as Map))
              .toList();
          _loading = false;
        });
      } else if (!silent) {
        setState(() {
          _error = Api.errorOf(res);
          _loading = false;
        });
      }
    } on DioException catch (e) {
      if (!mounted || silent) return;
      setState(() {
        _error = Api.errorOf(e.response, e);
        _loading = false;
      });
    }
  }

  int get _totalDevices =>
      _sites.fold(0, (a, s) => a + (numOf(s['devices_total'])?.round() ?? 0));
  int get _totalStale =>
      _sites.fold(0, (a, s) => a + (numOf(s['devices_stale'])?.round() ?? 0));

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(
        title: const Text('خريطة الشبكة'),
        actions: [
          IconButton(onPressed: _load, icon: const Icon(Icons.refresh), tooltip: 'تحديث'),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? StateView(icon: Icons.error_outline, title: _error!, isError: true, onRetry: _load)
              : _sites.isEmpty
                  ? const StateView(
                      icon: Icons.router_outlined,
                      title: 'لا أجهزة مكتشفة بعد',
                      detail: 'تُكتشف تلقائياً من جيران الراوتر خلال دقيقة',
                    )
                  : Column(children: [
                      Padding(
                        padding: const EdgeInsets.fromLTRB(14, 6, 14, 8),
                        child: TextField(
                          onChanged: (v) => setState(() => _q = v.trim()),
                          decoration: const InputDecoration(
                            hintText: 'ابحث باسم الجهاز أو عنوانه',
                            prefixIcon: Icon(Icons.search),
                            isDense: true,
                          ),
                        ),
                      ),
                      if (_q.isEmpty)
                        Padding(
                          padding: const EdgeInsets.fromLTRB(14, 0, 14, 8),
                          child: Row(children: [
                            _Pill(
                              text: 'المواقع ${_sites.length}',
                              tone: C.indigo,
                              dark: dark,
                            ),
                            const SizedBox(width: 8),
                            _Pill(text: 'الأجهزة $_totalDevices', tone: C.electric, dark: dark),
                            if (_totalStale > 0) ...[
                              const SizedBox(width: 8),
                              _Pill(text: 'صامتة $_totalStale', tone: C.warning, dark: dark),
                            ],
                          ]),
                        ),
                      Expanded(
                        child: RefreshIndicator(
                          onRefresh: _load,
                          child: ListView(
                            padding: const EdgeInsets.fromLTRB(12, 2, 12, 26),
                            children: [
                              for (final site in _sites)
                                _SiteTree(site: site, dark: dark, query: _q),
                            ],
                          ),
                        ),
                      ),
                    ]),
    );
  }
}

/// One router and everything hanging off it.
class _SiteTree extends StatefulWidget {
  final Map<String, dynamic> site;
  final bool dark;
  final String query;
  const _SiteTree({required this.site, required this.dark, required this.query});

  @override
  State<_SiteTree> createState() => _SiteTreeState();
}

class _SiteTreeState extends State<_SiteTree> {
  final _open = <String>{};

  @override
  Widget build(BuildContext context) {
    final s = widget.site;
    final dark = widget.dark;
    final q = widget.query.toLowerCase();
    final status = '${s['status'] ?? 'unknown'}';
    final tone = status == 'up' ? C.success : (status == 'down' ? C.danger : C.warning);

    final ports = ((s['ports'] as List?) ?? const [])
        .map((e) => Map<String, dynamic>.from(e as Map))
        .toList();

    // Searching flattens the tree on purpose: when you are hunting one customer's antenna you do
    // not want to remember which sector it hangs on — that is the thing you are trying to find.
    final matching = q.isEmpty
        ? null
        : [
            for (final p in ports)
              for (final d in ((p['devices'] as List?) ?? const [])
                  .map((e) => Map<String, dynamic>.from(e as Map)))
                if ('${d['identity'] ?? ''} ${d['address'] ?? ''} ${d['board'] ?? ''}'
                    .toLowerCase()
                    .contains(q))
                  {...d, '_port': p['name']},
          ];

    if (matching != null && matching.isEmpty) return const SizedBox.shrink();

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // ── the router itself ──────────────────────────────────────────
            Row(children: [
              Container(
                width: 40,
                height: 40,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: tone.withValues(alpha: dark ? 0.22 : 0.12),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(Icons.router_outlined, size: 21, color: tone),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('${s['identity'] ?? s['name']}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                            fontSize: 15.5,
                            fontWeight: FontWeight.w800,
                            color: dark ? C.textD : C.text)),
                    const SizedBox(height: 2),
                    Text(
                      [
                        '${s['address']}',
                        if ((s['board'] as String?)?.isNotEmpty ?? false) '${s['board']}',
                        '${numOf(s['devices_total'])?.round() ?? 0} جهاز',
                      ].join('  ·  '),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 12, color: dark ? C.mutedD : C.muted),
                    ),
                  ],
                ),
              ),
              if (numOf(s['cpu_load']) != null)
                _Pill(text: '${numOf(s['cpu_load'])!.round()}%', tone: C.electric, dark: dark),
            ]),
            const SizedBox(height: 6),

            if (matching != null)
              for (final d in matching) _Leaf(device: d, dark: dark, port: '${d['_port']}')
            else
              for (final p in ports) ...[
                _PortRow(
                  port: p,
                  dark: dark,
                  open: _open.contains('${p['name']}'),
                  onTap: () => setState(() {
                    final k = '${p['name']}';
                    if (!_open.remove(k)) _open.add(k);
                  }),
                ),
                if (_open.contains('${p['name']}'))
                  for (final d in ((p['devices'] as List?) ?? const [])
                      .map((e) => Map<String, dynamic>.from(e as Map)))
                    _Leaf(device: d, dark: dark),
              ],
          ],
        ),
      ),
    );
  }
}

/// A port on the router — a sector, an uplink, a plain ethernet run.
class _PortRow extends StatelessWidget {
  final Map<String, dynamic> port;
  final bool dark;
  final bool open;
  final VoidCallback onTap;
  const _PortRow({required this.port, required this.dark, required this.open, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final devices = (port['devices'] as List?) ?? const [];
    final stale = devices
        .map((e) => Map<String, dynamic>.from(e as Map))
        .where((d) => d['stale'] == true)
        .length;

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(9),
      child: Padding(
        padding: const EdgeInsetsDirectional.only(start: 14, top: 7, bottom: 7),
        child: Row(children: [
          // The branch line, so a port reads as hanging off the router above it.
          Container(width: 2, height: 22, color: dark ? C.borderD : C.border),
          const SizedBox(width: 10),
          // One glyph, rotated — the open state is the closed chevron turned a quarter turn. Adding
          // a second icon would add a glyph to the font, and that alone turns a 200 KB code patch
          // into a 60 MB reinstall for every phone.
          Transform.rotate(
            angle: open ? -1.5707963 : 0,
            child: Icon(Icons.chevron_left, size: 18, color: dark ? C.mutedD : C.muted),
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Text('${port['name']}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textDirection: TextDirection.ltr,
                style: TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w600,
                    color: dark ? C.textD : C.text)),
          ),
          if (stale > 0) ...[
            _Pill(text: 'صامت $stale', tone: C.warning, dark: dark),
            const SizedBox(width: 6),
          ],
          _Pill(text: '${devices.length}', tone: C.indigo, dark: dark),
        ]),
      ),
    );
  }
}

/// One discovered device: a customer's antenna, a switch, anything that announced itself.
class _Leaf extends StatelessWidget {
  final Map<String, dynamic> device;
  final bool dark;
  final String? port;
  const _Leaf({required this.device, required this.dark, this.port});

  @override
  Widget build(BuildContext context) {
    final stale = device['stale'] == true;
    final tone = stale ? C.warning : C.success;

    return Padding(
      padding: EdgeInsetsDirectional.only(start: port == null ? 42 : 14, top: 4, bottom: 4),
      child: Row(children: [
        Container(
          width: 8,
          height: 8,
          margin: const EdgeInsetsDirectional.only(end: 10),
          decoration: BoxDecoration(color: tone, shape: BoxShape.circle),
        ),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '${(device['identity'] as String?)?.trim().isNotEmpty == true ? device['identity'] : device['mac']}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: dark ? C.textD : C.text),
              ),
              Text(
                [
                  if (port != null) port!,
                  '${device['address'] ?? device['mac']}',
                  if ((device['board'] as String?)?.isNotEmpty ?? false) '${device['board']}',
                  // A silent device is the whole reason to open the map during a fault, so it
                  // says when it was last heard rather than just going grey.
                  if (stale) 'آخر ظهور ${relative(device['last_seen_at'] as String?)}',
                ].join('  ·  '),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textDirection: TextDirection.ltr,
                style: TextStyle(
                    fontSize: 11,
                    color: stale ? C.warning : (dark ? C.mutedD : C.muted)),
              ),
            ],
          ),
        ),
      ]),
    );
  }
}

class _Pill extends StatelessWidget {
  final String text;
  final Color tone;
  final bool dark;
  const _Pill({required this.text, required this.tone, required this.dark});

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: tone.withValues(alpha: dark ? 0.2 : 0.1),
          borderRadius: BorderRadius.circular(7),
        ),
        child: Text(text,
            style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: tone)),
      );
}
