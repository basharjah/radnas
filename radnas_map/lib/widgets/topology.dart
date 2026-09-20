import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../core/format.dart';
import '../core/theme.dart';

/// The network drawn, not listed.
///
/// A radial layout: the router at the centre, its ports on a ring around it, and each port's
/// devices on an arc beyond that. Radial rather than the desktop program's free canvas because
/// this shape is what the network IS — one router, a handful of sectors, many antennas on each —
/// and because it needs no layout engine and never tangles.
///
/// Each port is given an angular slice in PROPORTION to how many devices hang off it. A sector
/// carrying twenty-nine antennas therefore gets most of the circle and its labels stay apart,
/// instead of every sector getting an equal quarter and the busy one collapsing into a smear.
class TopologyMap extends StatefulWidget {
  final Map<String, dynamic> site;
  const TopologyMap({super.key, required this.site});

  @override
  State<TopologyMap> createState() => _TopologyMapState();
}

class _Node {
  final String label, sub;
  final Offset at;
  final double r;
  final Color tone;
  final _Kind kind;
  final Map<String, dynamic>? data;
  _Node(this.label, this.sub, this.at, this.r, this.tone, this.kind, [this.data]);
}

enum _Kind { router, port, device }

/// Wired ports carry the network to itself; sectors carry it to customers.
///
/// An ether or SFP run goes to a switch, another tower or an uplink — losing one takes a whole
/// branch down with it. A sector is radio, and what hangs off it is subscribers, one antenna each.
/// The operator reads those two things completely differently during a fault, so the map must not
/// draw them the same.
bool isCorePort(String name) =>
    RegExp(r'^(ether|sfp|combo|bridge|vlan|wlan|bond)', caseSensitive: false).hasMatch(name.trim());

class _Edge {
  final Offset a, b;
  final double width;
  final Color tone;
  _Edge(this.a, this.b, this.width, this.tone);
}

class _TopologyMapState extends State<TopologyMap> {
  final _controller = TransformationController();
  List<_Node> _nodes = const [];
  List<_Edge> _edges = const [];
  Size _canvas = const Size(1600, 1600);
  Size? _fitted;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  /// Build the picture once per data change, not once per frame.
  void _layout(bool dark) {
    final s = widget.site;
    final ports = ((s['ports'] as List?) ?? const [])
        .map((e) => Map<String, dynamic>.from(e as Map))
        .toList();

    // Weight, not raw count. A sector's slice grows with its subscribers, while a wired port gets
    // a small guaranteed slice — one switch on ether6 still has to be findable next to a sector
    // carrying twenty-nine antennas.
    double weightOf(Map<String, dynamic> p) {
      final n = ((p['devices'] as List?) ?? const []).length;
      return isCorePort('${p['name']}') ? 2.0 : n.toDouble();
    }
    final totalWeight = ports.fold<double>(0, (a, p) => a + weightOf(p));
    final total = ports.fold<int>(
        0, (a, p) => a + (((p['devices'] as List?) ?? const []).length));

    // The canvas grows with the network: seventy antennas need more room than seven, and a fixed
    // size would either waste the screen or overlap every label.
    final span = 900.0 + math.min(1400.0, total * 26.0);
    final centre = Offset(span / 2, span / 2);
    final rPort = span * 0.16;
    final rDevice = span * 0.38;

    final nodes = <_Node>[];
    final edges = <_Edge>[];

    final status = '${s['status'] ?? 'unknown'}';
    final routerTone =
        status == 'up' ? C.success : (status == 'down' ? C.danger : C.warning);
    nodes.add(_Node(
      '${s['identity'] ?? s['name']}',
      '${s['address'] ?? ''}',
      centre,
      34,
      routerTone,
      _Kind.router,
      s,
    ));

    // Start at the top and go clockwise, so the picture is stable between refreshes.
    var angle = -math.pi / 2;
    for (final p in ports) {
      final devices = ((p['devices'] as List?) ?? const [])
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList();
      final core = isCorePort('${p['name']}');
      final slice = totalWeight == 0
          ? 2 * math.pi / math.max(1, ports.length)
          : math.max(0.3, (weightOf(p) / totalWeight) * 2 * math.pi);
      final mid = angle + slice / 2;

      final portAt = centre + Offset(math.cos(mid) * rPort, math.sin(mid) * rPort);
      // The backbone is drawn heavier all the way out: a thick line from the router to a wired
      // port reads as a trunk, a thin one to a sector reads as radio.
      edges.add(_Edge(centre, portAt, core ? 5 : 3,
          core ? C.electric.withValues(alpha: 0.55) : (dark ? C.borderD : C.border)));
      nodes.add(_Node('${p['name']}', core ? 'أساسي' : '${devices.length} زبوناً',
          portAt, core ? 22 : 20, core ? C.electric : C.indigo, _Kind.port, p));

      for (var i = 0; i < devices.length; i++) {
        final d = devices[i];
        // Spread within this port's slice, inset from its edges so neighbouring sectors do not
        // touch. A single device sits dead centre of its slice rather than on one lip.
        final t = devices.length == 1 ? 0.5 : i / (devices.length - 1);
        final a = angle + slice * (0.12 + 0.76 * t);
        // Backbone gear sits on an inner ring, close to the router it belongs to. Customers go
        // out on the rim — which also matches how they are reached physically.
        final base = core ? span * 0.26 : rDevice;
        // Two rings when a sector is crowded: thirty labels on one arc overlap no matter how
        // wide the slice, and pushing every other one outward doubles the space each gets.
        final ring = base + (!core && i.isOdd && devices.length > 8 ? span * 0.09 : 0);
        final at = centre + Offset(math.cos(a) * ring, math.sin(a) * ring);
        final stale = d['stale'] == true;
        final tone = stale ? C.warning : (core ? C.electric : C.success);
        edges.add(_Edge(portAt, at, core ? 3 : 1.4,
            stale ? C.warning.withValues(alpha: 0.5)
                  : (core ? C.electric.withValues(alpha: 0.45) : (dark ? C.borderD : C.border))));
        nodes.add(_Node(
          '${(d['identity'] as String?)?.trim().isNotEmpty == true ? d['identity'] : d['mac']}',
          '${d['address'] ?? ''}',
          at,
          core ? 16 : 11,
          tone,
          _Kind.device,
          {...d, '_core': core},
        ));
      }
      angle += slice;
    }

    _canvas = Size(span, span);
    _nodes = nodes;
    _edges = edges;
  }

  void _tap(Offset local) {
    // Nearest node wins, within a generous radius: these are small targets on a touch screen and
    // an exact hit would make the map feel broken.
    _Node? best;
    var bestD = 44.0;
    for (final n in _nodes) {
      final d = (n.at - local).distance;
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    if (best == null) return;
    final n = best;
    final dark = Theme.of(context).brightness == Brightness.dark;

    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (_) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 22),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: [
                Container(
                  width: 12,
                  height: 12,
                  margin: const EdgeInsetsDirectional.only(end: 10),
                  decoration: BoxDecoration(color: n.tone, shape: BoxShape.circle),
                ),
                Expanded(
                  child: Text(n.label,
                      style: TextStyle(
                          fontSize: 16.5,
                          fontWeight: FontWeight.w800,
                          color: dark ? C.textD : C.text)),
                ),
              ]),
              const SizedBox(height: 12),
              for (final e in _details(n).entries)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                    Text(e.key,
                        style: TextStyle(fontSize: 13, color: dark ? C.mutedD : C.muted)),
                    const SizedBox(width: 14),
                    Flexible(
                      child: Text(e.value,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          textDirection: TextDirection.ltr,
                          style: TextStyle(
                              fontSize: 13.5,
                              fontWeight: FontWeight.w600,
                              color: dark ? C.textD : C.text)),
                    ),
                  ]),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Map<String, String> _details(_Node n) {
    final d = n.data ?? const {};
    switch (n.kind) {
      case _Kind.router:
        return {
          'العنوان': '${d['address'] ?? '—'}',
          'اللوحة': '${d['board'] ?? '—'}',
          'النظام': '${d['os_version'] ?? '—'}',
          'المعالج': numOf(d['cpu_load']) == null ? '—' : '${numOf(d['cpu_load'])!.round()}%',
          'يعمل منذ': fmtDuration(numOf(d['uptime_sec'])),
          'الأجهزة': '${numOf(d['devices_total'])?.round() ?? 0}',
        };
      case _Kind.port:
        return {'الأجهزة': '${((d['devices'] as List?) ?? const []).length}'};
      case _Kind.device:
        return {
          'العنوان': '${d['address'] ?? '—'}',
          'MAC': '${d['mac'] ?? '—'}',
          'اللوحة': '${d['board'] ?? '—'}',
          'النسخة': '${d['version'] ?? '—'}',
          'يعمل منذ': fmtDuration(numOf(d['uptime_sec'])),
          'آخر ظهور': relative(d['last_seen_at'] as String?),
          if (d['stale'] == true) 'الحالة': 'صامت — لم يُعلن عن نفسه مؤخّراً',
        };
    }
  }

  /// Open with the whole network in view and the router in the middle.
  ///
  /// An InteractiveViewer on an unconstrained child starts at the canvas's top-left corner, which
  /// on a 2000-pixel map means the operator opens the screen to an empty patch with the router
  /// half off the bottom edge — as it did on the first build.
  void _fit(Size viewport) {
    if (viewport.isEmpty || _canvas.isEmpty) return;
    final scale = math.min(viewport.width / _canvas.width, viewport.height / _canvas.height) * 0.92;
    _controller.value = Matrix4.identity()
      ..translateByDouble(
        (viewport.width - _canvas.width * scale) / 2,
        (viewport.height - _canvas.height * scale) / 2,
        0,
        1,
      )
      ..scaleByDouble(scale, scale, 1, 1);
    _fitted = _canvas;
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    _layout(dark);

    return LayoutBuilder(builder: (context, box) {
      // Re-fit only when the drawing itself changes size, never on a plain refresh — otherwise
      // every poll would yank the operator back to the centre mid-pan.
      if (_fitted != _canvas) {
        WidgetsBinding.instance.addPostFrameCallback(
            (_) => _fit(Size(box.maxWidth, box.maxHeight)));
      }
      return Stack(children: [
        InteractiveViewer(
          transformationController: _controller,
          minScale: 0.1,
          maxScale: 4,
          boundaryMargin: const EdgeInsets.all(600),
          constrained: false,
          child: GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTapUp: (e) => _tap(e.localPosition),
            child: CustomPaint(
              size: _canvas,
              painter: _MapPainter(nodes: _nodes, edges: _edges, dark: dark),
            ),
          ),
        ),
        // A legend, because the shapes carry meaning now and nothing else on screen explains them.
        Positioned(
          top: 10,
          right: 12,
          child: Row(children: [
            _Key(tone: C.electric, square: true, label: 'أساسي', dark: dark),
            const SizedBox(width: 10),
            _Key(tone: C.success, square: false, label: 'زبون', dark: dark),
            const SizedBox(width: 10),
            _Key(tone: C.warning, square: false, label: 'صامت', dark: dark),
          ]),
        ),
        Positioned(
          bottom: 12,
          right: 12,
          child: FloatingActionButton.small(
            heroTag: 'fit',
            onPressed: () => _fit(Size(box.maxWidth, box.maxHeight)),
            tooltip: 'إعادة التوسيط',
            child: const Icon(Icons.center_focus_strong),
          ),
        ),
      ]);
    });
  }
}

class _MapPainter extends CustomPainter {
  final List<_Node> nodes;
  final List<_Edge> edges;
  final bool dark;
  _MapPainter({required this.nodes, required this.edges, required this.dark});

  @override
  void paint(Canvas canvas, Size size) {
    for (final e in edges) {
      canvas.drawLine(
        e.a,
        e.b,
        Paint()
          ..color = e.tone
          ..strokeWidth = e.width
          ..strokeCap = StrokeCap.round,
      );
    }

    for (final n in nodes) {
      // A soft halo, so a node stays legible where several links converge under it.
      // Backbone gear is drawn as a SQUARE and customers as circles, so the two are told apart
      // at a glance and by anyone who does not separate blue from green.
      final core = n.data?['_core'] == true || (n.kind == _Kind.port && n.tone == C.electric);
      final fill = Paint()..color = n.tone.withValues(alpha: dark ? 0.3 : 0.18);
      final stroke = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = n.kind == _Kind.device && !core ? 2 : 3
        ..color = n.tone;
      final halo = Paint()..color = (dark ? C.bgD : C.bg).withValues(alpha: 0.85);

      if (core && n.kind != _Kind.router) {
        final rect = RRect.fromRectAndRadius(
            Rect.fromCenter(center: n.at, width: n.r * 2, height: n.r * 2),
            Radius.circular(n.r * 0.3));
        canvas.drawRRect(
            RRect.fromRectAndRadius(
                Rect.fromCenter(center: n.at, width: n.r * 2 + 8, height: n.r * 2 + 8),
                Radius.circular(n.r * 0.4)),
            halo);
        canvas.drawRRect(rect, fill);
        canvas.drawRRect(rect, stroke);
      } else {
        canvas.drawCircle(n.at, n.r + 4, halo);
        canvas.drawCircle(n.at, n.r, fill);
        canvas.drawCircle(n.at, n.r, stroke);
      }

      final label = n.label.characters.length > 16
          ? '${n.label.characters.take(15)}…'
          : n.label;
      final tp = TextPainter(
        text: TextSpan(
          text: label,
          style: TextStyle(
            fontSize: n.kind == _Kind.device ? 11 : (n.kind == _Kind.port ? 12.5 : 14),
            fontWeight: n.kind == _Kind.device ? FontWeight.w500 : FontWeight.w800,
            color: dark ? C.textD : C.text,
          ),
        ),
        textDirection: TextDirection.rtl,
        maxLines: 1,
      )..layout(maxWidth: 190);
      // Below the node rather than inside it: an Arabic name does not fit in a 22-pixel circle,
      // and putting it outside keeps the circles all one size however long the name is.
      tp.paint(canvas, n.at + Offset(-tp.width / 2, n.r + 5));
    }
  }

  @override
  bool shouldRepaint(_MapPainter old) =>
      old.nodes.length != nodes.length || old.dark != dark;
}

/// One entry of the legend.
class _Key extends StatelessWidget {
  final Color tone;
  final bool square, dark;
  final String label;
  const _Key({required this.tone, required this.square, required this.label, required this.dark});

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: (dark ? C.surfaceD : C.surface).withValues(alpha: 0.85),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Container(
            width: 10,
            height: 10,
            decoration: BoxDecoration(
              color: tone.withValues(alpha: 0.25),
              border: Border.all(color: tone, width: 2),
              shape: square ? BoxShape.rectangle : BoxShape.circle,
              borderRadius: square ? BorderRadius.circular(3) : null,
            ),
          ),
          const SizedBox(width: 6),
          Text(label,
              style: TextStyle(
                  fontSize: 11, fontWeight: FontWeight.w600, color: dark ? C.textD : C.text)),
        ]),
      );
}
