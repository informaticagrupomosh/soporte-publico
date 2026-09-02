import 'dart:async';
import 'dart:io';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/material.dart';
import 'package:gal/gal.dart';
import 'package:http/http.dart' as http;
import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';
import 'package:video_player/video_player.dart';

import '../modelos/chat.dart';
import '../nucleo/api.dart';
import '../nucleo/tema.dart';

/// Los archivos del chat, descargados **solo cuando hacen falta**.
///
/// La regla es la misma para todos: nada se descarga por estar en la
/// conversación, sino por aparecer en la pantalla —las fotos— o por pulsarlo
/// —vídeos, notas de voz y documentos—. Una conversación con doscientas fotos
/// no gasta nada hasta que se sube a mirarlas, y lo que se pasa de largo
/// deprisa cancela su descarga a medias.
///
/// Y todo va a la **carpeta temporal**, no al carrete: es una copia de trabajo
/// que el sistema puede tirar cuando necesite sitio. En la galería solo entra
/// lo que alguien mande guardar a mano.

/// La carpeta de trabajo del chat y lo que ya está descargado en ella.
class CacheChat {
  static Directory? _carpeta;

  static Future<Directory> carpeta() async {
    final ya = _carpeta;
    if (ya != null) return ya;
    final temporal = await getTemporaryDirectory();
    final propia = Directory('${temporal.path}/chat');
    if (!await propia.exists()) await propia.create(recursive: true);
    _carpeta = propia;
    return propia;
  }

  /// El archivo de un adjunto en la carpeta de trabajo, esté descargado o no.
  ///
  /// Lleva el id delante porque dos archivos pueden llamarse igual, y conserva
  /// la extensión porque de ella dependen el reproductor y la aplicación que
  /// abre un documento.
  static Future<File> archivoDe(AdjuntoChat adjunto) async {
    final dir = await carpeta();
    final punto = adjunto.nombre.lastIndexOf('.');
    final extension = punto > 0 ? adjunto.nombre.substring(punto) : '';
    return File('${dir.path}/${adjunto.id}$extension');
  }

  /// Deja el archivo en la carpeta de trabajo y devuelve dónde está.
  ///
  /// Si ya estaba, no se descarga: es lo que hace que volver a una foto vista
  /// hace un rato sea instantáneo y gratis.
  static Future<File> traer(Api api, AdjuntoChat adjunto, {http.Client? cliente}) async {
    final archivo = await archivoDe(adjunto);
    if (await archivo.exists() && await archivo.length() > 0) return archivo;
    final bytes = await api.descargarAdjuntoChat(adjunto.id, cliente: cliente);
    await archivo.writeAsBytes(bytes, flush: true);
    return archivo;
  }
}

/// Guarda en el carrete una foto o un vídeo del chat, que es lo único que se
/// sale de la carpeta temporal, y solo cuando alguien lo pide.
Future<void> guardarEnGaleria(
  BuildContext context,
  Api api,
  AdjuntoChat adjunto,
) async {
  final mensajero = ScaffoldMessenger.of(context);
  try {
    final archivo = await CacheChat.traer(api, adjunto);
    if (!await Gal.hasAccess(toAlbum: true)) {
      await Gal.requestAccess(toAlbum: true);
    }
    if (adjunto.esVideo) {
      await Gal.putVideo(archivo.path, album: 'Incidencias');
    } else {
      await Gal.putImage(archivo.path, album: 'Incidencias');
    }
    mensajero.showSnackBar(const SnackBar(content: Text('Guardado en la galería.')));
  } on GalException catch (e) {
    mensajero.showSnackBar(SnackBar(
      content: Text(e.type == GalExceptionType.accessDenied
          ? 'Sin permiso para guardar en la galería.'
          : 'No se ha podido guardar en la galería.'),
      backgroundColor: Tema.rojo,
    ));
  } catch (_) {
    mensajero.showSnackBar(const SnackBar(
      content: Text('No se ha podido guardar en la galería.'),
      backgroundColor: Tema.rojo,
    ));
  }
}

/// Una foto del chat.
///
/// Se descarga al aparecer y se cancela al desaparecer. Como la conversación es
/// una lista perezosa, un widget solo se construye cuando está cerca de la
/// pantalla: eso es exactamente «solo se descarga lo que se ve», sin tener que
/// llevar la cuenta de nada.
class FotoChat extends StatefulWidget {
  const FotoChat({super.key, required this.api, required this.adjunto});

  final Api api;
  final AdjuntoChat adjunto;

  @override
  State<FotoChat> createState() => _FotoChatState();
}

class _FotoChatState extends State<FotoChat> {
  http.Client? _cliente;
  File? _archivo;
  bool _fallo = false;

  @override
  void initState() {
    super.initState();
    _traer();
  }

  Future<void> _traer() async {
    final cliente = http.Client();
    _cliente = cliente;
    try {
      final archivo = await CacheChat.traer(widget.api, widget.adjunto, cliente: cliente);
      if (mounted) setState(() => _archivo = archivo);
    } catch (_) {
      if (mounted) setState(() => _fallo = true);
    } finally {
      cliente.close();
      if (identical(_cliente, cliente)) _cliente = null;
    }
  }

  /// Al salir de la pantalla se corta la descarga a medias: pasar de largo por
  /// una conversación con fotos no puede dejar veinte descargas en marcha.
  @override
  void dispose() {
    _cliente?.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final archivo = _archivo;

    if (_fallo) {
      return _marco(const Center(
        child: Icon(Icons.broken_image_outlined, color: Tema.gris),
      ));
    }
    if (archivo == null) {
      return _marco(const Center(
        child: SizedBox(
          width: 22,
          height: 22,
          child: CircularProgressIndicator(strokeWidth: 2),
        ),
      ));
    }

    return GestureDetector(
      onTap: () => Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => _VisorFoto(
          archivo: archivo,
          adjunto: widget.adjunto,
          api: widget.api,
        ),
      )),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(10),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxHeight: 240),
          child: Image.file(archivo, fit: BoxFit.cover),
        ),
      ),
    );
  }

  Widget _marco(Widget hijo) => Container(
        height: 140,
        decoration: BoxDecoration(
          color: Tema.grisClaro,
          borderRadius: BorderRadius.circular(10),
        ),
        child: hijo,
      );
}

class _VisorFoto extends StatelessWidget {
  const _VisorFoto({required this.archivo, required this.adjunto, required this.api});

  final File archivo;
  final AdjuntoChat adjunto;
  final Api api;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text(adjunto.nombre, style: const TextStyle(fontSize: 15)),
        actions: [
          IconButton(
            icon: const Icon(Icons.download_outlined),
            tooltip: 'Guardar en la galería',
            onPressed: () => guardarEnGaleria(context, api, adjunto),
          ),
        ],
      ),
      body: Center(
        child: InteractiveViewer(maxScale: 5, child: Image.file(archivo)),
      ),
    );
  }
}

/// Un vídeo del chat.
///
/// En la conversación es solo una carátula: el vídeo no se descarga hasta que
/// alguien lo pulsa, que es lo que evita que abrir un canal se lleve por
/// delante la tarifa de datos.
class VideoChat extends StatelessWidget {
  const VideoChat({super.key, required this.api, required this.adjunto});

  final Api api;
  final AdjuntoChat adjunto;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => _ReproductorVideo(api: api, adjunto: adjunto),
      )),
      child: Container(
        width: 220,
        height: 124,
        decoration: BoxDecoration(
          color: const Color(0xFF212529),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.play_circle_outline, color: Colors.white70, size: 38),
            const SizedBox(height: 6),
            Text(
              adjunto.duracion != null ? duracionCorta(adjunto.duracion!) : 'Vídeo',
              style: const TextStyle(color: Colors.white70, fontSize: 12),
            ),
          ],
        ),
      ),
    );
  }
}

class _ReproductorVideo extends StatefulWidget {
  const _ReproductorVideo({required this.api, required this.adjunto});

  final Api api;
  final AdjuntoChat adjunto;

  @override
  State<_ReproductorVideo> createState() => _ReproductorVideoState();
}

class _ReproductorVideoState extends State<_ReproductorVideo> {
  VideoPlayerController? _control;
  String? _error;

  @override
  void initState() {
    super.initState();
    _preparar();
  }

  /// Se descarga a la carpeta de trabajo y se reproduce desde el archivo.
  ///
  /// Es mejor que reproducirlo por la red: en el wifi de un local, un vídeo en
  /// directo se corta cada dos por tres, y así además queda guardado para la
  /// segunda vez que se vea.
  Future<void> _preparar() async {
    try {
      final archivo = await CacheChat.traer(widget.api, widget.adjunto);
      final control = VideoPlayerController.file(archivo);
      _control = control;
      await control.initialize();
      if (!mounted) return;
      setState(() => control.play());
    } catch (_) {
      if (mounted) setState(() => _error = 'No se pudo reproducir el vídeo.');
    }
  }

  @override
  void dispose() {
    _control?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final control = _control;
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text(widget.adjunto.nombre, style: const TextStyle(fontSize: 15)),
        actions: [
          IconButton(
            icon: const Icon(Icons.download_outlined),
            tooltip: 'Guardar en la galería',
            onPressed: () => guardarEnGaleria(context, widget.api, widget.adjunto),
          ),
        ],
      ),
      body: Center(
        child: _error != null
            ? Text(_error!, style: const TextStyle(color: Colors.white70))
            : (control == null || !control.value.isInitialized)
                ? const CircularProgressIndicator(color: Colors.white)
                : AspectRatio(
                    aspectRatio: control.value.aspectRatio,
                    child: Stack(
                      alignment: Alignment.bottomCenter,
                      children: [
                        VideoPlayer(control),
                        VideoProgressIndicator(control, allowScrubbing: true),
                      ],
                    ),
                  ),
      ),
      floatingActionButton: (control != null && control.value.isInitialized)
          ? FloatingActionButton(
              onPressed: () => setState(() {
                control.value.isPlaying ? control.pause() : control.play();
              }),
              child: Icon(control.value.isPlaying ? Icons.pause : Icons.play_arrow),
            )
          : null,
    );
  }
}

String duracionCorta(int segundos) {
  final s = segundos < 0 ? 0 : segundos;
  return '${s ~/ 60}:${(s % 60).toString().padLeft(2, '0')}';
}

/// Una nota de voz.
///
/// La duración la manda el servidor, así que el globo la enseña sin descargar
/// nada; el audio solo viaja cuando alguien le da al play.
class NotaDeVoz extends StatefulWidget {
  const NotaDeVoz({super.key, required this.api, required this.adjunto});

  final Api api;
  final AdjuntoChat adjunto;

  @override
  State<NotaDeVoz> createState() => _NotaDeVozState();
}

class _NotaDeVozState extends State<NotaDeVoz> {
  final _reproductor = AudioPlayer();
  StreamSubscription<Duration>? _avance;
  StreamSubscription<void>? _final;
  Duration _posicion = Duration.zero;
  bool _sonando = false;
  bool _cargando = false;

  @override
  void initState() {
    super.initState();
    _avance = _reproductor.onPositionChanged.listen((p) {
      if (mounted) setState(() => _posicion = p);
    });
    _final = _reproductor.onPlayerComplete.listen((_) {
      if (mounted) {
        setState(() {
          _sonando = false;
          _posicion = Duration.zero;
        });
      }
    });
  }

  @override
  void dispose() {
    _avance?.cancel();
    _final?.cancel();
    _reproductor.dispose();
    super.dispose();
  }

  Future<void> _alternar() async {
    if (_sonando) {
      await _reproductor.pause();
      if (mounted) setState(() => _sonando = false);
      return;
    }
    setState(() => _cargando = true);
    try {
      final archivo = await CacheChat.traer(widget.api, widget.adjunto);
      await _reproductor.play(DeviceFileSource(archivo.path));
      if (mounted) setState(() => _sonando = true);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('No se ha podido reproducir la nota de voz.'),
          backgroundColor: Tema.rojo,
        ));
      }
    } finally {
      if (mounted) setState(() => _cargando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final total = widget.adjunto.duracion ?? 0;
    final avance = total == 0
        ? 0.0
        : (_posicion.inSeconds / total).clamp(0.0, 1.0).toDouble();

    return SizedBox(
      width: 210,
      child: Row(
        children: [
          IconButton(
            onPressed: _cargando ? null : _alternar,
            visualDensity: VisualDensity.compact,
            icon: _cargando
                ? const SizedBox(
                    width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                : Icon(_sonando ? Icons.pause_circle : Icons.play_circle, size: 30),
            color: Tema.azul,
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(3),
                  child: LinearProgressIndicator(
                    value: avance,
                    minHeight: 4,
                    backgroundColor: Tema.borde,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  _sonando || _posicion > Duration.zero
                      ? '${duracionCorta(_posicion.inSeconds)} / ${duracionCorta(total)}'
                      : '🎤 Nota de voz · ${duracionCorta(total)}',
                  style: const TextStyle(fontSize: 11, color: Tema.gris),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Un documento: se descarga al pulsarlo, se deja en la carpeta de trabajo y lo
/// abre la aplicación del sistema que sepa.
class DocumentoChat extends StatefulWidget {
  const DocumentoChat({super.key, required this.api, required this.adjunto});

  final Api api;
  final AdjuntoChat adjunto;

  @override
  State<DocumentoChat> createState() => _DocumentoChatState();
}

class _DocumentoChatState extends State<DocumentoChat> {
  bool _abriendo = false;

  Future<void> _abrir() async {
    final mensajero = ScaffoldMessenger.of(context);
    setState(() => _abriendo = true);
    try {
      final archivo = await CacheChat.traer(widget.api, widget.adjunto);
      final resultado = await OpenFilex.open(archivo.path);
      if (resultado.type != ResultType.done) {
        mensajero.showSnackBar(const SnackBar(
          content: Text('No hay ninguna aplicación para abrir este archivo.'),
        ));
      }
    } on ErrorApi catch (e) {
      mensajero.showSnackBar(
        SnackBar(content: Text(e.mensaje), backgroundColor: Tema.rojo),
      );
    } finally {
      if (mounted) setState(() => _abriendo = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: _abriendo ? null : _abrir,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _abriendo
              ? const SizedBox(
                  width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
              : const Icon(Icons.description_outlined, size: 20, color: Tema.gris),
          const SizedBox(width: 6),
          Flexible(
            child: Text(
              widget.adjunto.nombre,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 13, decoration: TextDecoration.underline),
            ),
          ),
        ],
      ),
    );
  }
}
