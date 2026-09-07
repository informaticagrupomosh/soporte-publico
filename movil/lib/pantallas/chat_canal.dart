import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';

import '../app.dart';
import '../modelos/chat.dart';
import '../nucleo/api.dart';
import '../nucleo/formato.dart';
import '../nucleo/tema.dart';
import '../servicios/chat.dart';
import '../widgets/adjuntos.dart';
import '../widgets/chat_multimedia.dart';

/// La conversación de un canal.
///
/// Se abre con lo que hay guardado en el teléfono —al instante y sin red— y
/// solo pide al servidor lo que falta desde el último mensaje guardado. Al
/// subir se va trayendo el historial por páginas, y únicamente cuando la copia
/// local se queda corta.
class PantallaCanal extends StatefulWidget {
  const PantallaCanal({super.key, required this.localId});

  final int localId;

  @override
  State<PantallaCanal> createState() => _PantallaCanalState();
}

class _PantallaCanalState extends State<PantallaCanal> with WidgetsBindingObserver {
  final _texto = TextEditingController();
  final _desplazamiento = ScrollController();
  final _grabadora = AudioRecorder();

  ServicioChat? _chat;
  StreamSubscription<MensajeChat>? _entrantes;
  StreamSubscription<LecturaAjena>? _acuses;
  StreamSubscription<({int localId, String nombre})>? _escribiendo;

  /// Los mensajes confirmados, del más antiguo al más nuevo.
  List<MensajeChat> _mensajes = [];

  /// Los que todavía están en la cola de salida, siempre al final.
  List<MensajeChat> _pendientes = [];

  final Map<int, LecturaAjena> _lecturas = {};

  /// Archivos ya subidos que irán con el próximo mensaje.
  final List<AdjuntoChat> _adjuntos = [];

  CanalChat? _canal;
  bool _cargando = true;
  bool _trayendoHistorial = false;
  bool _hayMasArriba = true;
  bool _subiendo = false;

  String? _quienEscribe;
  Timer? _relojEscribiendo;

  DateTime? _grabandoDesde;
  Timer? _relojGrabacion;
  Duration _grabado = Duration.zero;

  bool _iniciado = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_iniciado) return;
    _iniciado = true;
    WidgetsBinding.instance.addObserver(this);

    final chat = SesionScope.de(context).chat;
    _chat = chat;
    chat.canalEnPantalla = widget.localId;

    _entrantes = chat.entrantes.listen(_alLlegarMensaje);
    _acuses = chat.acuses.listen(_alLlegarAcuse);
    _escribiendo = chat.escribiendo.listen((quien) {
      if (quien.localId != widget.localId) return;
      setState(() => _quienEscribe = quien.nombre.split(' ').first);
      _relojEscribiendo?.cancel();
      _relojEscribiendo = Timer(const Duration(seconds: 4), () {
        if (mounted) setState(() => _quienEscribe = null);
      });
    });

    _cargar();
    _desplazamiento.addListener(_alDesplazar);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _chat?.canalEnPantalla = null;
    _entrantes?.cancel();
    _acuses?.cancel();
    _escribiendo?.cancel();
    _relojEscribiendo?.cancel();
    _relojGrabacion?.cancel();
    _relojLeido?.cancel();
    _grabadora.dispose();
    _texto.dispose();
    _desplazamiento.dispose();
    super.dispose();
  }

  /// Al volver del segundo plano, quien pide lo que falta es el servicio —lo
  /// hace para todos los canales de una vez, y los mensajes entran por su
  /// flujo—; aquí solo se refresca lo que la pantalla guarda aparte: la cola de
  /// salida y los acuses de los demás.
  @override
  void didChangeAppLifecycleState(AppLifecycleState estado) {
    if (estado != AppLifecycleState.resumed) return;
    _recargarDeLaCopia();
    _marcarLeido();
  }

  // ---------- Cargar ----------

  Future<void> _cargar() async {
    final chat = _chat!;
    final mensajes = await chat.alAbrirCanal(widget.localId);
    final pendientes = await chat.pendientesDe(widget.localId);
    final lecturas = await chat.lecturasDe(widget.localId);
    final canal = _buscarCanal();

    if (!mounted) return;
    setState(() {
      _mensajes = mensajes;
      _pendientes = pendientes;
      _lecturas
        ..clear()
        ..addEntries([for (final l in lecturas) MapEntry(l.usuarioId, l)]);
      _canal = canal;
      _hayMasArriba = canal?.hayMasArriba ?? true;
      _cargando = false;
    });
    _marcarLeido();
  }

  Future<void> _recargarDeLaCopia() async {
    final chat = _chat!;
    final pendientes = await chat.pendientesDe(widget.localId);
    final lecturas = await chat.lecturasDe(widget.localId);
    if (!mounted) return;
    setState(() {
      _pendientes = pendientes;
      _lecturas
        ..clear()
        ..addEntries([for (final l in lecturas) MapEntry(l.usuarioId, l)]);
      _canal = _buscarCanal();
    });
  }

  CanalChat? _buscarCanal() {
    for (final c in _chat!.canales) {
      if (c.localId == widget.localId) return c;
    }
    return null;
  }

  /// Al llegar arriba se trae la página anterior. Primero de la copia local; si
  /// allí se acaba, del servidor.
  void _alDesplazar() {
    if (!_desplazamiento.hasClients || _trayendoHistorial || !_hayMasArriba) return;
    final posicion = _desplazamiento.position;
    // La lista va del revés, así que «arriba del todo» es el final del recorrido.
    if (posicion.pixels < posicion.maxScrollExtent - 300) return;
    _traerHistorial();
  }

  Future<void> _traerHistorial() async {
    if (_mensajes.isEmpty || _trayendoHistorial) return;
    setState(() => _trayendoHistorial = true);
    final anteriores = await _chat!.anteriores(widget.localId, _mensajes.first.id);
    if (!mounted) return;
    setState(() {
      _mensajes = [...anteriores, ..._mensajes];
      _trayendoHistorial = false;
      if (anteriores.isEmpty) _hayMasArriba = false;
    });
  }

  // ---------- Lo que va llegando ----------

  void _alLlegarMensaje(MensajeChat mensaje) {
    if (mensaje.localId != widget.localId) return;
    setState(() {
      final i = _mensajes.indexWhere((m) => m.id == mensaje.id);
      if (i >= 0) {
        _mensajes[i] = mensaje;
      } else {
        _mensajes = [..._mensajes, mensaje]..sort((a, b) => a.id.compareTo(b.id));
      }
      // Si es la confirmación de algo que estaba en la cola, el pendiente sobra.
      _pendientes = [
        for (final p in _pendientes)
          if (p.clienteId != mensaje.clienteId) p,
      ];
    });
    if (_pegadoAbajo) _alFinal();
    _marcarLeido();
  }

  void _alLlegarAcuse(LecturaAjena lectura) {
    setState(() => _lecturas[lectura.usuarioId] = lectura);
  }

  bool get _pegadoAbajo =>
      !_desplazamiento.hasClients || _desplazamiento.position.pixels < 120;

  void _alFinal() {
    if (!_desplazamiento.hasClients) return;
    _desplazamiento.animateTo(
      0,
      duration: const Duration(milliseconds: 200),
      curve: Curves.easeOut,
    );
  }

  Timer? _relojLeido;

  /// Marca el canal como leído hasta el último mensaje.
  ///
  /// Se agrupa un momento: una ráfaga de cinco mensajes seguidos es un acuse,
  /// no cinco peticiones.
  void _marcarLeido() {
    if (_mensajes.isEmpty) return;
    _relojLeido?.cancel();
    _relojLeido = Timer(const Duration(milliseconds: 400), () {
      if (!mounted || _mensajes.isEmpty) return;
      _chat!.marcarLeido(widget.localId, _mensajes.last.id);
    });
  }

  // ---------- Estado de cada mensaje ----------

  int get _maxRecibido =>
      _lecturas.values.fold(0, (n, l) => l.recibidoHasta > n ? l.recibidoHasta : n);

  int get _maxLeido =>
      _lecturas.values.fold(0, (n, l) => l.leidoHasta > n ? l.leidoHasta : n);

  EstadoMensaje _estadoDe(MensajeChat m) {
    if (m.pendiente) return m.fallo ? EstadoMensaje.fallo : EstadoMensaje.enviando;
    if (m.id <= _maxLeido) return EstadoMensaje.leido;
    if (m.id <= _maxRecibido) return EstadoMensaje.recibido;
    return EstadoMensaje.enviado;
  }

  // ---------- Enviar ----------

  Future<void> _enviar() async {
    final texto = _texto.text.trim();
    if (texto.isEmpty && _adjuntos.isEmpty) return;

    final pendiente = await _chat!.enviar(
      widget.localId,
      contenido: texto,
      adjuntos: List.of(_adjuntos),
    );
    if (!mounted) return;
    setState(() {
      _texto.clear();
      _adjuntos.clear();
      _pendientes = [..._pendientes, pendiente];
    });
    _alFinal();
  }

  Future<void> _adjuntar() async {
    final elegido = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (hoja) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: const Text('Hacer una foto'),
              onTap: () => Navigator.pop(hoja, 'camara'),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('Elegir de la galería'),
              subtitle: const Text('Fotos y vídeos'),
              onTap: () => Navigator.pop(hoja, 'galeria'),
            ),
            ListTile(
              leading: const Icon(Icons.insert_drive_file_outlined),
              title: const Text('Adjuntar un archivo'),
              onTap: () => Navigator.pop(hoja, 'archivo'),
            ),
          ],
        ),
      ),
    );
    if (elegido == null || !mounted) return;

    final archivo = await elegirArchivoParaChat(elegido);
    if (archivo == null) return;
    await _subir(archivo.ruta, archivo.nombre);
  }

  /// Sube el archivo como borrador y lo deja esperando al mensaje, igual que en
  /// la web: si la subida se corta, no queda un globo roto en la conversación
  /// de todo el local.
  Future<void> _subir(String ruta, String nombre, {int? duracion}) async {
    final api = SesionScope.de(context).api;
    setState(() => _subiendo = true);
    try {
      final bytes = await File(ruta).readAsBytes();
      final datos = await api.subirBorradorChat(nombre, bytes, duracion: duracion);
      if (!mounted) return;
      setState(() {
        _adjuntos.add(AdjuntoChat(
          id: (datos['id'] as num).toInt(),
          mensajeId: 0,
          nombre: '${datos['nombre'] ?? nombre}',
          tipo: '${datos['tipo'] ?? 'documento'}',
          duracion: (datos['duracion'] as num?)?.toInt(),
        ));
      });
    } on ErrorApi catch (e) {
      _avisar(e.mensaje, error: true);
    } catch (_) {
      _avisar('No se pudo leer el archivo.', error: true);
    } finally {
      if (mounted) setState(() => _subiendo = false);
    }
  }

  // ---------- Notas de voz ----------

  Future<void> _alternarGrabacion() async {
    if (_grabandoDesde != null) {
      await _pararGrabacion(enviar: true);
      return;
    }
    if (!await _grabadora.hasPermission()) {
      _avisar('Hace falta permiso para usar el micrófono.', error: true);
      return;
    }
    final carpeta = await getTemporaryDirectory();
    final destino = '${carpeta.path}/nota-${DateTime.now().millisecondsSinceEpoch}.m4a';
    // AAC en m4a: lo graban y lo reproducen igual Android y iPhone, y el
    // servidor lo admite.
    await _grabadora.start(
      const RecordConfig(encoder: AudioEncoder.aacLc, bitRate: 64000, numChannels: 1),
      path: destino,
    );
    if (!mounted) return;
    setState(() {
      _grabandoDesde = DateTime.now();
      _grabado = Duration.zero;
    });
    _relojGrabacion = Timer.periodic(const Duration(milliseconds: 250), (_) {
      final desde = _grabandoDesde;
      if (desde == null || !mounted) return;
      setState(() => _grabado = DateTime.now().difference(desde));
    });
  }

  Future<void> _pararGrabacion({required bool enviar}) async {
    final desde = _grabandoDesde;
    _relojGrabacion?.cancel();
    final ruta = await _grabadora.stop();
    if (!mounted) return;
    setState(() {
      _grabandoDesde = null;
      _grabado = Duration.zero;
    });
    if (ruta == null || desde == null) return;

    final segundos = DateTime.now().difference(desde).inSeconds;
    // Menos de un segundo es un dedo resbalado, no una nota de voz.
    if (!enviar || segundos < 1) {
      try {
        await File(ruta).delete();
      } catch (_) {}
      return;
    }

    await _subir(ruta, 'nota-de-voz.m4a', duracion: segundos);
    // Una nota de voz se manda sola: nadie graba una para luego darle a enviar.
    if (mounted && _adjuntos.isNotEmpty) await _enviar();
  }

  void _avisar(String texto, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(texto),
      backgroundColor: error ? Tema.rojo : null,
    ));
  }

  // ---------- Pintado ----------

  @override
  Widget build(BuildContext context) {
    final canal = _canal;
    final filas = _filas();

    return Scaffold(
      backgroundColor: const Color(0xFFF8F9FA),
      appBar: AppBar(
        titleSpacing: 0,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(canal?.nombre ?? 'Chat', style: const TextStyle(fontSize: 16)),
            Text(
              _quienEscribe != null
                  ? '$_quienEscribe está escribiendo…'
                  : (canal?.canal ?? ''),
              style: const TextStyle(fontSize: 11.5, color: Tema.gris),
            ),
          ],
        ),
      ),
      body: Column(
        children: [
          Expanded(
            child: _cargando
                ? const Center(child: CircularProgressIndicator())
                : filas.isEmpty
                    ? const Center(
                        child: Padding(
                          padding: EdgeInsets.symmetric(horizontal: 32),
                          child: Text(
                            'Todavía no ha escrito nadie en este canal. Empieza tú.',
                            textAlign: TextAlign.center,
                            style: TextStyle(color: Tema.gris),
                          ),
                        ),
                      )
                    : ListView.builder(
                        controller: _desplazamiento,
                        // Del revés: el último mensaje abajo, que es donde se
                        // mira, y al subir se pide lo anterior.
                        reverse: true,
                        // Con poco margen a propósito: es lo que hace que las
                        // fotos que no están en pantalla no lleguen a pedirse.
                        cacheExtent: 300,
                        padding: const EdgeInsets.fromLTRB(10, 10, 10, 12),
                        itemCount: filas.length + (_trayendoHistorial ? 1 : 0),
                        itemBuilder: (_, i) {
                          if (i >= filas.length) {
                            return const Padding(
                              padding: EdgeInsets.all(12),
                              child: Center(
                                child: SizedBox(
                                  width: 18,
                                  height: 18,
                                  child: CircularProgressIndicator(strokeWidth: 2),
                                ),
                              ),
                            );
                          }
                          return filas[filas.length - 1 - i];
                        },
                      ),
          ),
          _redaccion(),
        ],
      ),
    );
  }

  /// La conversación entera en widgets, del más antiguo al más nuevo: las
  /// cintas con la fecha y los globos.
  List<Widget> _filas() {
    final yo = SesionScope.de(context).usuario?.id ?? 0;
    final api = SesionScope.de(context).api;
    final todos = [..._mensajes, ..._pendientes];
    final filas = <Widget>[];
    String? dia;

    for (var i = 0; i < todos.length; i++) {
      final m = todos[i];
      final suDia = _dia(m.creadoEn);
      if (suDia != dia) {
        dia = suDia;
        filas.add(_CintaFecha(texto: suDia));
      }
      final anterior = i > 0 ? todos[i - 1] : null;
      final seguido = anterior != null &&
          anterior.autorId == m.autorId &&
          _dia(anterior.creadoEn) == suDia &&
          m.creadoEn != null &&
          anterior.creadoEn != null &&
          m.creadoEn!.difference(anterior.creadoEn!).inMinutes.abs() < 5;

      filas.add(_Globo(
        key: ValueKey(m.id != 0 ? 'm${m.id}' : 'c${m.clienteId}'),
        mensaje: m,
        propio: m.autorId == yo,
        seguido: seguido,
        estado: _estadoDe(m),
        api: api,
        // Uno borrado no tiene menú: no queda nada que copiar ni que hacer.
        // Uno todavía en la cola, solo si lleva texto: es lo único que se
        // puede hacer con él, y el resto de opciones necesitan que exista en
        // el servidor.
        alMantenerPulsado: m.borrado || (m.pendiente && m.contenido.trim().isEmpty)
            ? null
            : () => _menuDe(m),
      ));
    }
    return filas;
  }

  String _dia(DateTime? fecha) {
    if (fecha == null) return '';
    final hoy = DateTime.now();
    final ayer = hoy.subtract(const Duration(days: 1));
    bool mismoDia(DateTime a, DateTime b) =>
        a.year == b.year && a.month == b.month && a.day == b.day;
    if (mismoDia(fecha, hoy)) return 'Hoy';
    if (mismoDia(fecha, ayer)) return 'Ayer';
    return DateFormat('d MMM y', 'es').format(fecha);
  }

  /// Lo que se puede hacer con un mensaje, al mantenerlo pulsado.
  ///
  /// Copiar el texto, de cualquiera. Borrar el propio —y cualquiera, si quien
  /// mira es administrador—. Y avisar al administrador de uno ajeno.
  ///
  /// Copiar va la primera porque es la que más se usa y la única que no cambia
  /// nada: en un chat de trabajo se pasan referencias de pedido, matrículas y
  /// números de serie, y hasta ahora había que teclearlos a mano mirando la
  /// pantalla.
  Future<void> _menuDe(MensajeChat mensaje) async {
    final yo = SesionScope.de(context).usuario;
    if (yo == null) return;
    final propio = mensaje.autorId == yo.id;
    final hayTexto = mensaje.contenido.trim().isNotEmpty;
    // Un mensaje que todavía está en la cola no se puede borrar ni denunciar
    // —no tiene número en el servidor—, pero su texto sí se copia. Es
    // justamente cuando más falta hace: algo que no ha salido y no quieres
    // volver a escribir.
    final enviado = !mensaje.pendiente;

    final que = await showModalBottomSheet<String>(
      context: context,
      // Con el móvil de lado, la hoja se queda en poco más de doscientos
      // píxeles de alto y tres opciones no caben: que ruede antes que
      // desbordar.
      builder: (hoja) => SafeArea(
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (hayTexto)
                ListTile(
                  leading: const Icon(Icons.copy_all_outlined, color: Tema.gris),
                  title: const Text('Copiar el texto'),
                  onTap: () => Navigator.pop(hoja, 'copiar'),
                ),
              if (enviado && (propio || yo.esAdmin))
                ListTile(
                  leading: const Icon(Icons.delete_outline, color: Tema.rojo),
                  title: const Text('Eliminar el mensaje'),
                  subtitle: const Text('Deja de verse para todos.'),
                  onTap: () => Navigator.pop(hoja, 'borrar'),
                ),
              if (enviado && !propio)
                ListTile(
                  leading: const Icon(Icons.flag_outlined, color: Tema.rojo),
                  title: const Text('Avisar al administrador'),
                  subtitle: const Text('Lo revisará y decidirá.'),
                  onTap: () => Navigator.pop(hoja, 'denunciar'),
                ),
              ListTile(
                leading: const Icon(Icons.close, color: Tema.gris),
                title: const Text('Cancelar'),
                onTap: () => Navigator.pop(hoja),
              ),
            ],
          ),
        ),
      ),
    );

    if (!mounted || que == null) return;
    if (que == 'copiar') return _copiar(mensaje);
    if (que == 'borrar') return _borrar(mensaje);
    if (que == 'denunciar') return _denunciar(mensaje);
  }

  /// El texto del mensaje al portapapeles.
  ///
  /// Solo el texto: ni el nombre de quien escribió ni la hora. Lo que se copia
  /// casi siempre se va a pegar en otro sitio —un buscador, un correo, el
  /// campo de una incidencia— y ahí la cabecera estorba.
  Future<void> _copiar(MensajeChat mensaje) async {
    await Clipboard.setData(ClipboardData(text: mensaje.contenido.trim()));
    _avisar('Texto copiado.');
  }

  /// Avisa de un mensaje ajeno, con un motivo que se puede dejar en blanco.
  ///
  /// Obligar a escribir algo hace que quien tenga prisa no avise, y lo que
  /// importa es que el aviso llegue: el mensaje señalado ya dice bastante.
  Future<void> _denunciar(MensajeChat mensaje) async {
    // Nulo es «cancelar»; la cadena vacía, «avisar sin decir por qué», que es
    // una respuesta válida.
    final motivo = await showDialog<String>(
      context: context,
      builder: (_) => _DialogoDenuncia(autor: mensaje.autorNombre),
    );
    if (!mounted || motivo == null) return;

    try {
      await _chat!.denunciar(mensaje.id, motivo);
      _avisar('Avisado. El administrador lo revisará.');
    } on ErrorApi catch (e) {
      _avisar(e.mensaje, error: true);
    }
  }

  Future<void> _borrar(MensajeChat mensaje) async {
    final seguro = await showDialog<bool>(
      context: context,
      builder: (dialogo) => AlertDialog(
        title: const Text('Eliminar el mensaje'),
        content: const Text('Deja de verse para todos.'),
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
      await _chat!.borrar(mensaje.id);
    } on ErrorApi catch (e) {
      _avisar(e.mensaje, error: true);
    }
  }

  Widget _redaccion() {
    final grabando = _grabandoDesde != null;

    return Material(
      color: Colors.white,
      elevation: 8,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(6, 6, 6, 6),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (_adjuntos.isNotEmpty) _tiraAdjuntos(),
              if (grabando)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Row(
                    children: [
                      const Icon(Icons.fiber_manual_record, color: Tema.rojo, size: 12),
                      const SizedBox(width: 6),
                      Text(duracionCorta(_grabado.inSeconds),
                          style: const TextStyle(fontSize: 13)),
                      const SizedBox(width: 8),
                      const Text('Grabando una nota de voz…',
                          style: TextStyle(fontSize: 12, color: Tema.gris)),
                      const Spacer(),
                      TextButton(
                        onPressed: () => _pararGrabacion(enviar: false),
                        child: const Text('Cancelar'),
                      ),
                    ],
                  ),
                ),
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  IconButton(
                    onPressed: (_subiendo || grabando) ? null : _adjuntar,
                    icon: _subiendo
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2))
                        : const Icon(Icons.attach_file),
                    tooltip: 'Adjuntar',
                  ),
                  Expanded(
                    child: TextField(
                      controller: _texto,
                      minLines: 1,
                      maxLines: 5,
                      textCapitalization: TextCapitalization.sentences,
                      onChanged: (_) => _chat!.avisarEscribiendo(widget.localId),
                      decoration: const InputDecoration(
                        hintText: 'Escribe un mensaje',
                        border: OutlineInputBorder(),
                        isDense: true,
                        contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: _subiendo ? null : _alternarGrabacion,
                    icon: Icon(grabando ? Icons.stop_circle : Icons.mic_none),
                    color: grabando ? Tema.rojo : null,
                    tooltip: grabando ? 'Parar y enviar' : 'Grabar una nota de voz',
                  ),
                  IconButton.filled(
                    onPressed: grabando ? null : _enviar,
                    icon: const Icon(Icons.send, size: 20),
                    tooltip: 'Enviar',
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _tiraAdjuntos() {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Wrap(
        spacing: 6,
        runSpacing: 6,
        children: [
          for (final a in _adjuntos)
            Chip(
              avatar: Icon(_iconoDe(a.tipo), size: 16),
              label: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 150),
                child: Text(a.nombre,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 12)),
              ),
              onDeleted: () => setState(() => _adjuntos.remove(a)),
              deleteIcon: const Icon(Icons.close, size: 15),
              visualDensity: VisualDensity.compact,
              materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
        ],
      ),
    );
  }
}

IconData _iconoDe(String tipo) {
  switch (tipo) {
    case 'imagen':
      return Icons.photo_outlined;
    case 'video':
      return Icons.videocam_outlined;
    case 'audio':
      return Icons.mic_none;
    default:
      return Icons.description_outlined;
  }
}

class _CintaFecha extends StatelessWidget {
  const _CintaFecha({required this.texto});

  final String texto;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 8),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
        decoration: BoxDecoration(
          color: Tema.grisClaro,
          borderRadius: BorderRadius.circular(10),
        ),
        child: Text(texto, style: const TextStyle(fontSize: 11.5, color: Tema.gris)),
      ),
    );
  }
}

/// Un mensaje: lo propio a la derecha y lo de los demás a la izquierda, igual
/// que el hilo de una incidencia y que la web.
/// El diálogo de «avisar al administrador».
///
/// Es un widget aparte, y no un `AlertDialog` construido dentro de una
/// función, por una razón concreta: el controlador del campo de texto tiene
/// que vivir exactamente lo que viva el campo. Soltándolo en cuanto
/// `showDialog` devuelve —que fue como estaba— se suelta demasiado pronto: el
/// diálogo sigue en el árbol mientras se desvanece, se reconstruye una vez más
/// y se encuentra el controlador ya tirado.
class _DialogoDenuncia extends StatefulWidget {
  const _DialogoDenuncia({required this.autor});

  final String autor;

  @override
  State<_DialogoDenuncia> createState() => _DialogoDenunciaState();
}

class _DialogoDenunciaState extends State<_DialogoDenuncia> {
  final _motivo = TextEditingController();

  @override
  void dispose() {
    _motivo.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      // Con el teclado abierto, a un diálogo con un campo de tres líneas y su
      // contador no le queda alto: sin esto desborda por abajo.
      scrollable: true,
      title: const Text('Avisar al administrador'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Verá este mensaje de ${widget.autor} y decidirá qué hacer. '
            'El mensaje no se borra ahora.',
            style: const TextStyle(fontSize: 13.5, color: Tema.gris),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _motivo,
            autofocus: true,
            maxLines: 3,
            maxLength: 500,
            decoration: const InputDecoration(
              hintText: '¿Qué pasa con él? (opcional)',
              border: OutlineInputBorder(),
            ),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancelar'),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(context, _motivo.text.trim()),
          child: const Text('Avisar'),
        ),
      ],
    );
  }
}

class _Globo extends StatelessWidget {
  const _Globo({
    super.key,
    required this.mensaje,
    required this.propio,
    required this.seguido,
    required this.estado,
    required this.api,
    this.alMantenerPulsado,
  });

  final MensajeChat mensaje;
  final bool propio;
  final bool seguido;
  final EstadoMensaje estado;
  final Api api;
  final VoidCallback? alMantenerPulsado;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: propio ? Alignment.centerRight : Alignment.centerLeft,
      child: GestureDetector(
        onLongPress: alMantenerPulsado,
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxWidth: MediaQuery.of(context).size.width * 0.82,
          ),
          child: Container(
            margin: EdgeInsets.only(bottom: 4, top: seguido ? 0 : 4),
            padding: const EdgeInsets.fromLTRB(10, 7, 10, 5),
            decoration: BoxDecoration(
              color: propio ? Tema.azul.withOpacity(0.09) : Colors.white,
              border: Border.all(
                color: propio ? Tema.azul.withOpacity(0.25) : Tema.borde,
              ),
              borderRadius: BorderRadius.only(
                topLeft: const Radius.circular(12),
                topRight: const Radius.circular(12),
                bottomLeft: Radius.circular(propio ? 12 : 3),
                bottomRight: Radius.circular(propio ? 3 : 12),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (!propio && !seguido)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 3),
                    child: Text(
                      mensaje.autorNombre,
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: Tema.azul,
                      ),
                    ),
                  ),
                if (mensaje.borrado)
                  const Text(
                    'Mensaje eliminado',
                    style: TextStyle(
                      fontSize: 13.5,
                      fontStyle: FontStyle.italic,
                      color: Tema.gris,
                    ),
                  )
                else ...[
                  if (mensaje.contenido.isNotEmpty)
                    Text(
                      mensaje.contenido,
                      style: const TextStyle(fontSize: 14.5, height: 1.35),
                    ),
                  for (final a in mensaje.adjuntos)
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: _adjunto(a),
                    ),
                ],
                const SizedBox(height: 3),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    Text(
                      horaCorta(mensaje.creadoEn),
                      style: const TextStyle(fontSize: 10.5, color: Tema.gris),
                    ),
                    if (propio) ...[
                      const SizedBox(width: 4),
                      _Ticks(estado: estado),
                    ],
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _adjunto(AdjuntoChat a) {
    // Los de un mensaje que todavía va de camino no existen en el servidor: se
    // enseña su nombre y ya se pintarán cuando el mensaje esté confirmado.
    if (a.id == 0) {
      return Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(_iconoDe(a.tipo), size: 16, color: Tema.gris),
          const SizedBox(width: 4),
          Flexible(
            child: Text(
              a.nombre,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 12, color: Tema.gris),
            ),
          ),
        ],
      );
    }
    if (a.esImagen) return FotoChat(api: api, adjunto: a);
    if (a.esVideo) return VideoChat(api: api, adjunto: a);
    if (a.esAudio) return NotaDeVoz(api: api, adjunto: a);
    return DocumentoChat(api: api, adjunto: a);
  }
}

/// Los cuatro estados de un mensaje propio, en la esquina del globo.
class _Ticks extends StatelessWidget {
  const _Ticks({required this.estado});

  final EstadoMensaje estado;

  @override
  Widget build(BuildContext context) {
    switch (estado) {
      case EstadoMensaje.enviando:
        return const Icon(Icons.schedule, size: 12, color: Tema.gris);
      case EstadoMensaje.fallo:
        return const Tooltip(
          message: 'No se ha podido enviar. Se reintenta solo.',
          child: Icon(Icons.refresh, size: 13, color: Tema.rojo),
        );
      case EstadoMensaje.enviado:
        return const Icon(Icons.check, size: 13, color: Tema.gris);
      case EstadoMensaje.recibido:
        return const Icon(Icons.done_all, size: 13, color: Tema.gris);
      case EstadoMensaje.leido:
        return const Icon(Icons.done_all, size: 13, color: Tema.azul);
    }
  }
}
