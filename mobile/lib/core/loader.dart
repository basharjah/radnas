import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'api.dart';
import '../widgets/common.dart';

/// One fetch, three states, drawn the same way everywhere.
///
/// Every list screen in the panel does the same thing: GET a path, show a spinner, then either a
/// list, an empty state, or the server's own Arabic error with a retry. Writing that ten times is
/// ten chances for the screens to disagree — and the disagreement always shows up as a screen that
/// fails silently while its neighbour explains itself.
class Loader<T> extends StatefulWidget {
  final String path;
  final Map<String, dynamic>? query;

  /// Pulls the payload out of the response body. Some endpoints answer `{data: [...]}`, others
  /// answer the object directly, so each screen says which it expects.
  final T Function(dynamic body) parse;

  final Widget Function(BuildContext context, T data, Future<void> Function() reload) builder;

  /// Shown instead of the list when [isEmpty] says the payload holds nothing.
  final bool Function(T data)? isEmpty;
  final IconData emptyIcon;
  final String emptyText;

  const Loader({
    super.key,
    required this.path,
    required this.parse,
    required this.builder,
    this.query,
    this.isEmpty,
    this.emptyIcon = Icons.inbox_outlined,
    this.emptyText = 'لا شيء هنا بعد',
  });

  @override
  State<Loader<T>> createState() => _LoaderState<T>();
}

class _LoaderState<T> extends State<Loader<T>> {
  T? _data;
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
      final res = await Api.instance.dio.get(widget.path, queryParameters: widget.query);
      if (!mounted) return;
      if (res.statusCode != null && res.statusCode! < 300) {
        setState(() {
          _data = widget.parse(res.data);
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
    } catch (e) {
      if (!mounted) return;
      setState(() {
        // A shape change on the server would otherwise surface as a red screen with a Dart error.
        _error = 'تعذّرت قراءة ردّ الخادم';
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());

    return RefreshIndicator(
      onRefresh: _load,
      child: _error != null
          ? StateView(
              icon: Icons.error_outline,
              title: _error!,
              isError: true,
              onRetry: _load,
            )
          : (widget.isEmpty?.call(_data as T) ?? false)
              ? StateView(icon: widget.emptyIcon, title: widget.emptyText)
              : widget.builder(context, _data as T, _load),
    );
  }
}

/// Send a write and report the outcome in the server's own words.
///
/// Returns true when the server accepted it, so the caller can refresh.
Future<bool> send(
  BuildContext context,
  String method,
  String path, {
  Object? body,
  String? okMessage,
}) async {
  try {
    final res = await Api.instance.dio.request(
      path,
      data: body,
      options: Options(method: method),
    );
    final ok = res.statusCode != null && res.statusCode! < 300;
    if (context.mounted) {
      toast(context, ok ? (okMessage ?? 'تم') : Api.errorOf(res), ok: ok);
    }
    return ok;
  } on DioException catch (e) {
    if (context.mounted) toast(context, Api.errorOf(e.response, e), ok: false);
    return false;
  }
}
