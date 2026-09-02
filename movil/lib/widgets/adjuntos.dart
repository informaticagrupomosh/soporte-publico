import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';
import 'package:video_player/video_player.dart';

import '../app.dart';
import '../modelos/modelos.dart';
import '../nucleo/api.dart';
import '../nucleo/tema.dart';

/// Formatos que admite el servidor, y sus topes.
const _formatosImagen = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
const _formatosVideo = ['mp4', 'mov', 'webm', 'avi'];
const _formatosDocumento = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'csv'];

const _topeAdjunto = 10 * 1024 * 1024;
const _topeVideo = 120 * 1024 * 1024;

/// Los adjuntos en miniatura. Las fotos se abren a tamaño completo, los vídeos
/// se reproducen y los documentos se abren con la app que toque.
class RejillaAdjuntos extends StatelessWidget {
  const RejillaAdjuntos({super.key, required this.adjuntos, this.alBorrar});

  final List<Adjunto> adjuntos;

  /// Se llama cuando se elimina uno, para recargar la ficha.
  final VoidCallback? alBorrar;

  @override
  Widget build(BuildContext context) {
    if (adjuntos.isEmpty) return const SizedBox.shrink();

    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final a in adjuntos) _Miniatura(adjunto: a, alBorrar: alBorrar),
      ],
    );
  }
}

class _Miniatura extends StatelessWidget {
  const _Miniatura({required this.adjunto, this.alBorrar});

  final Adjunto adjunto;
  final VoidCallback? alBorrar;

  /// Un adjunto lo borra quien lo subió; un administrador, cualquiera. Es la
  /// misma regla que aplica el servidor.
  bool _puedeBorrar(BuildContext context) {
    final usuario = SesionScope.de(context).usuario;
    if (usuario == null) return false;
    return usuario.esAdmin || adjunto.subidoPor == usuario.id;
  }

  Future<void> _borrar(BuildContext context) async {
    final mensajero = ScaffoldMessenger.of(context);
    final api = SesionScope.de(context).api;

    final seguro = await showDialog<bool>(
      context: context,
      builder: (dialogo) => AlertDialog(
        title: const Text('Eliminar adjunto'),
        content: Text('¿Eliminar «${adjunto.nombre}»?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogo, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Tema.rojo),
            onPressed: () => Navigator.pop(dialogo, true),
            child: const Text('Eliminar'),
          ),
        ],
      ),
    );
    if (seguro != true) return;

    try {
      await api.delete('/api/adjuntos/${adjunto.id}');
      alBorrar?.call();
    } on ErrorApi catch (e) {
      mensajero.showSnackBar(
        SnackBar(content: Text(e.mensaje), backgroundColor: Tema.rojo),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final api = SesionScope.de(context).api;
    final url = api.urlAdjunto(adjunto.id);
    final cabeceras = api.cabecerasAdjunto;

    if (adjunto.esImagen) {
      return InkWell(
        onLongPress: _puedeBorrar(context) ? () => _borrar(context) : null,
        onTap: () => Navigator.of(context).push(MaterialPageRoute(
          builder: (_) => _VisorImagen(url: url, cabeceras: cabeceras, nombre: adjunto.nombre),
        )),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: Image.network(
            url.toString(),
            headers: cabeceras,
            width: 96,
            height: 96,
            fit: BoxFit.cover,
            errorBuilder: (_, __, ___) => _caja(Icons.broken_image_outlined, 'No se pudo cargar'),
          ),
        ),
      );
    }

    if (adjunto.esVideo) {
      return InkWell(
        onLongPress: _puedeBorrar(context) ? () => _borrar(context) : null,
        onTap: () => Navigator.of(context).push(MaterialPageRoute(
          builder: (_) => _Reproductor(url: url, cabeceras: cabeceras, nombre: adjunto.nombre),
        )),
        child: _caja(Icons.play_circle_outline, adjunto.nombre),
      );
    }

    return InkWell(
      onLongPress: _puedeBorrar(context) ? () => _borrar(context) : null,
      onTap: () => _abrirDocumento(context),
      child: _caja(Icons.description_outlined, adjunto.nombre),
    );
  }

  /// Lo descarga con la sesión puesta, lo deja en la carpeta temporal de la app
  /// y se lo pasa a la aplicación que sepa abrirlo.
  Future<void> _abrirDocumento(BuildContext context) async {
    final mensajero = ScaffoldMessenger.of(context);
    final api = SesionScope.de(context).api;
    try {
      final bytes = await api.descargarAdjunto(adjunto.id);
      final carpeta = await getTemporaryDirectory();
      // El nombre lleva delante el id para que dos adjuntos que se llamen igual
      // no se pisen en la carpeta temporal.
      final archivo = File('${carpeta.path}/${adjunto.id}-${adjunto.nombre}');
      await archivo.writeAsBytes(bytes);

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
    }
  }

  Widget _caja(IconData icono, String texto) {
    return Container(
      width: 96,
      height: 96,
      padding: const EdgeInsets.all(6),
      decoration: BoxDecoration(
        color: Tema.grisClaro,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Tema.borde),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icono, size: 28, color: Tema.gris),
          const SizedBox(height: 4),
          Text(
            texto,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 10, color: Tema.gris),
          ),
        ],
      ),
    );
  }
}

/// La foto a pantalla completa, con zoom.
class _VisorImagen extends StatelessWidget {
  const _VisorImagen({required this.url, required this.cabeceras, required this.nombre});

  final Uri url;
  final Map<String, String> cabeceras;
  final String nombre;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text(nombre, style: const TextStyle(fontSize: 15)),
      ),
      body: Center(
        child: InteractiveViewer(
          maxScale: 5,
          child: Image.network(url.toString(), headers: cabeceras),
        ),
      ),
    );
  }
}

class _Reproductor extends StatefulWidget {
  const _Reproductor({required this.url, required this.cabeceras, required this.nombre});

  final Uri url;
  final Map<String, String> cabeceras;
  final String nombre;

  @override
  State<_Reproductor> createState() => _ReproductorState();
}

class _ReproductorState extends State<_Reproductor> {
  VideoPlayerController? _control;
  String? _error;

  @override
  void initState() {
    super.initState();
    _preparar();
  }

  Future<void> _preparar() async {
    final control = VideoPlayerController.networkUrl(widget.url, httpHeaders: widget.cabeceras);
    _control = control;
    try {
      await control.initialize();
      if (!mounted) return;
      setState(() => control.play());
    } catch (e) {
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
        title: Text(widget.nombre, style: const TextStyle(fontSize: 15)),
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

/// El nombre del archivo, asegurándose de que lleva una extensión que el
/// servidor admita.
///
/// La cámara y la galería no siempre dan un nombre con extensión —a veces es un
/// identificador del sistema—, y sin ella el servidor responde «formato no
/// admitido». Se intenta con la de la ruta y, si tampoco, con la de reserva.
String conExtension(XFile archivo, String reserva) {
  const admitidas = [..._formatosImagen, ..._formatosVideo, ..._formatosDocumento];
  bool sirve(String nombre) {
    final partes = nombre.split('.');
    return partes.length > 1 && admitidas.contains(partes.last.toLowerCase());
  }

  if (sirve(archivo.name)) return archivo.name;

  final deLaRuta = archivo.path.split(RegExp(r'[\\/]')).last;
  if (sirve(deLaRuta)) return deLaRuta;

  final base = archivo.name.isEmpty ? 'adjunto' : archivo.name.split('.').first;
  return '$base$reserva';
}

/// Un archivo elegido del teléfono, listo para subir.
typedef ArchivoElegido = ({String ruta, String nombre});

/// Elige un archivo para mandarlo por el chat: la cámara, la galería o los
/// archivos del teléfono.
///
/// Es el mismo selector que el de los adjuntos de una incidencia; lo que cambia
/// es a dónde va después, así que devuelve la ruta en vez de subirla.
Future<ArchivoElegido?> elegirArchivoParaChat(String origen) async {
  if (origen == 'camara') {
    // Una foto de un móvil de ahora pasa de los 10 MB que admite el servidor;
    // esto la deja de sobra para ver una avería.
    final foto = await ImagePicker().pickImage(
      source: ImageSource.camera,
      maxWidth: 1920,
      imageQuality: 80,
    );
    if (foto == null) return null;
    return (ruta: foto.path, nombre: conExtension(foto, '.jpg'));
  }

  if (origen == 'galeria') {
    final medio = await ImagePicker().pickMedia(maxWidth: 1920, imageQuality: 80);
    if (medio == null) return null;
    return (ruta: medio.path, nombre: conExtension(medio, '.jpg'));
  }

  final elegido = await FilePicker.platform.pickFiles(
    type: FileType.custom,
    allowedExtensions: [..._formatosImagen, ..._formatosVideo, ..._formatosDocumento],
  );
  final archivo = elegido?.files.single;
  if (archivo?.path == null) return null;
  return (ruta: archivo!.path!, nombre: archivo.name);
}

/// Un archivo ya subido como borrador, esperando a que se mande el mensaje o se
/// cree la incidencia.
class Borrador {
  const Borrador({required this.id, required this.nombre, required this.tipo});

  final int id;
  final String nombre;
  final String tipo;

  bool get esImagen => tipo == 'imagen';
  bool get esVideo => tipo == 'video';
}

/// El clip de adjuntar: cámara, galería o archivo.
///
/// Sube el archivo en el momento, pero como **borrador**: todavía no cuelga de
/// nada. Quien lo usa se queda con el [Borrador] y manda su `id` al crear la
/// incidencia o el mensaje. Así el archivo está entero en el servidor antes de
/// que exista nada que avise a nadie.
class BotonAdjuntar extends StatefulWidget {
  const BotonAdjuntar({super.key, required this.alSubir});

  /// Se llama con el borrador ya subido.
  final void Function(Borrador) alSubir;

  @override
  State<BotonAdjuntar> createState() => _BotonAdjuntarState();
}

class _BotonAdjuntarState extends State<BotonAdjuntar> {
  bool _subiendo = false;

  @override
  Widget build(BuildContext context) {
    if (_subiendo) {
      return const Padding(
        padding: EdgeInsets.all(12),
        child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)),
      );
    }

    return IconButton(
      icon: const Icon(Icons.attach_file),
      tooltip: 'Adjuntar',
      onPressed: () => showModalBottomSheet<void>(
        context: context,
        showDragHandle: true,
        builder: (hoja) => SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                leading: const Icon(Icons.photo_camera_outlined),
                title: const Text('Hacer una foto'),
                onTap: () {
                  Navigator.pop(hoja);
                  _desdeCamara();
                },
              ),
              ListTile(
                leading: const Icon(Icons.videocam_outlined),
                title: const Text('Grabar un vídeo'),
                subtitle: const Text('Hasta dos minutos'),
                onTap: () {
                  Navigator.pop(hoja);
                  _grabarVideo();
                },
              ),
              ListTile(
                leading: const Icon(Icons.photo_library_outlined),
                title: const Text('Elegir de la galería'),
                subtitle: const Text('Fotos y vídeos'),
                onTap: () {
                  Navigator.pop(hoja);
                  _desdeGaleria();
                },
              ),
              ListTile(
                leading: const Icon(Icons.insert_drive_file_outlined),
                title: const Text('Adjuntar un archivo'),
                onTap: () {
                  Navigator.pop(hoja);
                  _desdeArchivos();
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _desdeCamara() async {
    final foto = await ImagePicker().pickImage(
      source: ImageSource.camera,
      // Una foto de móvil moderno pasa de los 10 MB que admite el servidor;
      // esto la deja en un tamaño de sobra para ver una avería.
      maxWidth: 1920,
      imageQuality: 80,
    );
    if (foto != null) await _subir(foto.path, conExtension(foto, '.jpg'));
  }

  /// Graba un vídeo con la cámara.
  ///
  /// Con tope de duración porque la app no recomprime: dos minutos de un móvil
  /// normal caben de sobra en los 120 MB que admite el servidor, y sin tope una
  /// grabación larga en 4K se pasa y solo se sabría al terminar de subirla.
  Future<void> _grabarVideo() async {
    final video = await ImagePicker().pickVideo(
      source: ImageSource.camera,
      maxDuration: const Duration(minutes: 2),
    );
    if (video != null) await _subir(video.path, conExtension(video, '.mp4'));
  }

  /// De la galería, foto o vídeo: `pickMedia` deja elegir entre las dos cosas
  /// en un solo selector, sin obligar a decidir antes de mirar.
  ///
  /// El recorte de tamaño solo se aplica a las fotos; los vídeos vienen tal
  /// cual, y de ellos se ocupa la comprobación de tamaño.
  Future<void> _desdeGaleria() async {
    final medio = await ImagePicker().pickMedia(
      maxWidth: 1920,
      imageQuality: 80,
    );
    if (medio != null) await _subir(medio.path, conExtension(medio, '.jpg'));
  }

  Future<void> _desdeArchivos() async {
    final elegido = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: [..._formatosImagen, ..._formatosVideo, ..._formatosDocumento],
    );
    final archivo = elegido?.files.single;
    if (archivo?.path != null) await _subir(archivo!.path!, archivo.name);
  }

  Future<void> _subir(String ruta, String nombre) async {
    setState(() => _subiendo = true);
    try {
      final bytes = await File(ruta).readAsBytes();

      // Se comprueba aquí para dar un mensaje claro en vez de un 413 seco
      // después de subir ciento veinte megas por la red del local.
      final esVideo = _formatosVideo.contains(nombre.split('.').last.toLowerCase());
      final tope = esVideo ? _topeVideo : _topeAdjunto;
      if (bytes.length > tope) {
        _avisar(
          esVideo
              ? 'El vídeo no puede superar los 120 MB.'
              : 'El adjunto no puede superar los 10 MB.',
          error: true,
        );
        return;
      }

      final datos = await SesionScope.de(context).api.subirBorrador(nombre, bytes);
      widget.alSubir(Borrador(
        id: (datos['id'] as num).toInt(),
        nombre: '${datos['nombre'] ?? nombre}',
        tipo: '${datos['tipo'] ?? 'documento'}',
      ));
    } on ErrorApi catch (e) {
      _avisar(e.mensaje, error: true);
    } catch (e) {
      _avisar('No se pudo leer el archivo.', error: true);
    } finally {
      if (mounted) setState(() => _subiendo = false);
    }
  }

  void _avisar(String texto, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(texto),
      backgroundColor: error ? Tema.rojo : null,
    ));
  }
}

/// La fila de archivos ya subidos que todavía no se han mandado.
///
/// Se enseña encima de la caja de escribir y debajo del formulario de alta, para
/// que se vea qué va a ir en el mensaje antes de enviarlo, y se pueda quitar.
class TiraBorradores extends StatelessWidget {
  const TiraBorradores({super.key, required this.borradores, required this.alQuitar});

  final List<Borrador> borradores;
  final void Function(Borrador) alQuitar;

  @override
  Widget build(BuildContext context) {
    if (borradores.isEmpty) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Wrap(
        spacing: 6,
        runSpacing: 6,
        children: [
          for (final b in borradores)
            Chip(
              avatar: Icon(
                b.esImagen
                    ? Icons.photo_outlined
                    : b.esVideo
                        ? Icons.videocam_outlined
                        : Icons.description_outlined,
                size: 16,
              ),
              label: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 150),
                child: Text(
                  b.nombre,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 12),
                ),
              ),
              onDeleted: () => alQuitar(b),
              deleteIcon: const Icon(Icons.close, size: 15),
              visualDensity: VisualDensity.compact,
              materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
        ],
      ),
    );
  }
}
