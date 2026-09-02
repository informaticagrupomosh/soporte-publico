import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../modelos/chat.dart';
import '../nucleo/api.dart';
import '../nucleo/chat_local.dart';

/// El chat de local, visto desde la app.
///
/// Manda una idea por encima de todas: **la copia del teléfono es lo que se
/// pinta, y de la red solo viene lo que falta**. Al abrir la app se piden los
/// canales y, de cada uno, los mensajes posteriores al último que ya está
/// guardado; nunca la conversación entera. Un canal que ya se ha visto se abre
/// sin tocar la red, y solo al subir por él —y solo si a la copia le falta
/// historial— se pide la página anterior.
///
/// Mientras la app está delante hay un flujo de eventos abierto y los mensajes
/// entran solos. Al pasar a segundo plano se corta, que es lo que hay que hacer
/// con una conexión que nadie está mirando, y al volver se reconecta y se pone
/// todo al día de una vez.
class ServicioChat extends ChangeNotifier {
  ServicioChat({required this.api});

  final Api api;

  ChatLocal? _local;
  int _usuarioId = 0;
  String _usuarioNombre = '';

  List<CanalChat> _canales = [];
  List<CanalChat> get canales => List.unmodifiable(_canales);

  /// Cuántos mensajes sin leer hay en total, para el aviso del menú.
  int get sinLeer => _canales.fold(0, (n, c) => n + c.sinLeer);

  bool _conectado = false;
  bool get conectado => _conectado;

  /// Qué canal está abierto en pantalla ahora mismo. Lo que llegue de otro no
  /// se marca como leído, por muy delante que esté la app.
  int? canalEnPantalla;

  http.Client? _clienteFlujo;
  StreamSubscription<String>? _escucha;
  Timer? _reintento;
  int _fallosSeguidos = 0;
  bool _enMarcha = false;
  bool _vaciando = false;
  Timer? _reintentoSalida;

  /// Avisa de un mensaje que acaba de llegar por el flujo, para que la pantalla
  /// del canal lo añada sin volver a preguntar nada.
  final StreamController<MensajeChat> _entrantes = StreamController.broadcast();
  Stream<MensajeChat> get entrantes => _entrantes.stream;

  /// Avisa de un acuse ajeno: es lo que mueve los ticks de los mensajes
  /// propios sin recargar la conversación.
  final StreamController<LecturaAjena> _acuses = StreamController.broadcast();
  Stream<LecturaAjena> get acuses => _acuses.stream;

  /// Quién está escribiendo, por canal.
  final StreamController<({int localId, String nombre})> _escribiendo =
      StreamController.broadcast();
  Stream<({int localId, String nombre})> get escribiendo => _escribiendo.stream;

  // ---------- Arranque y parada ----------

  /// Al entrar: abre la copia de esta cuenta, pinta lo que ya hay guardado y
  /// se pone al día.
  Future<void> arrancar({required int usuarioId, required String nombre}) async {
    if (_enMarcha && _usuarioId == usuarioId) return;
    // Si en este teléfono había entrado otra persona, su flujo se corta antes
    // de abrir el de esta: dos a la vez traerían mensajes cruzados.
    desconectarFlujo();
    _enMarcha = true;
    _usuarioId = usuarioId;
    _usuarioNombre = nombre;
    _local = await ChatLocal.abrir(usuarioId);

    // Lo guardado sale en pantalla antes de hablar con nadie: al abrir la app
    // la conversación ya está ahí, y lo que llegue después la completa.
    _canales = await _local!.canales();
    notifyListeners();

    await sincronizar();
    conectarFlujo();
    unawaited(vaciarSalida());
  }

  /// Al salir: se corta todo y la copia se queda para la próxima vez.
  Future<void> parar({bool borrarCopia = false}) async {
    _enMarcha = false;
    desconectarFlujo();
    _reintentoSalida?.cancel();
    final id = _usuarioId;
    _canales = [];
    _usuarioId = 0;
    _local = null;
    if (borrarCopia && id != 0) {
      await ChatLocal.borrarDe(id);
    } else {
      await ChatLocal.cerrar();
    }
    notifyListeners();
  }

  /// La app vuelve del segundo plano: se reconecta y se recupera lo que haya
  /// pasado mientras estaba dormida.
  Future<void> alReanudar() async {
    if (!_enMarcha) return;
    conectarFlujo();
    await sincronizar();
    unawaited(vaciarSalida());
  }

  /// La app se va al segundo plano: el flujo se cierra. Una conexión abierta
  /// que nadie mira solo gasta batería; lo que pase mientras tanto llega por
  /// los avisos push y se recupera al volver.
  void alDormirse() => desconectarFlujo();

  // ---------- Ponerse al día ----------

  /// Trae la lista de canales y, de cada uno que ya tenga conversación
  /// guardada, los mensajes nuevos.
  ///
  /// Los canales que nunca se han abierto no traen mensajes: para la lista basta
  /// con el último, que ya viene aquí. Su conversación se descarga la primera
  /// vez que se entra, y desde entonces solo lo que falte.
  Future<void> sincronizar() async {
    final local = _local;
    if (local == null) return;

    try {
      // Sin pasar por la copia general: el chat tiene la suya, mejor hecha
      // —guarda los mensajes uno a uno— y servir aquí una respuesta de ayer
      // solo daría trabajo repetido.
      final datos = await api.get('/api/chat/canales', null, true) as List;
      final frescos = [
        for (final c in datos) CanalChat.desdeJson((c as Map).cast<String, dynamic>()),
      ];
      await local.guardarCanales(frescos);
      _canales = await local.canales();
      notifyListeners();

      for (final c in _canales) {
        // Solo los canales que ya tienen conversación guardada, y solo si al
        // teléfono le falta algo: la lista dice cuál es el último mensaje de
        // cada canal, así que comparando con lo guardado se sabe si hay que
        // preguntar sin gastar una petición en averiguarlo.
        if (await local.cuantosGuardados(c.localId) == 0) continue;
        if (await local.ultimoGuardado(c.localId) >= (c.ultimoId ?? 0)) continue;
        await traerNuevos(c.localId);
      }
    } on ErrorApi {
      // Sin red no pasa nada: lo guardado sigue en pantalla y se reintenta al
      // reconectar o al volver a la app.
    }
  }

  /// Lo que ha entrado en un canal desde el último mensaje guardado.
  ///
  /// Va por páginas y encadena hasta alcanzar el final, que es lo que hace
  /// falta cuando se vuelve después de días. Con un tope: si alguien ha estado
  /// meses fuera no se descargan miles de mensajes de golpe al abrir la app;
  /// lo que quede se traerá al entrar en el canal.
  Future<int> traerNuevos(int localId, {int paginas = 3}) async {
    final local = _local;
    if (local == null) return 0;

    var traidos = 0;
    for (var vuelta = 0; vuelta < paginas; vuelta++) {
      final desde = await local.ultimoGuardado(localId);
      final List<MensajeChat> lote;
      try {
        lote = await _pedirMensajes(localId, desde: desde);
      } on ErrorApi {
        break;
      }
      if (lote.isEmpty) break;
      await local.guardarMensajes(lote);
      traidos += lote.length;
      for (final m in lote) {
        _entrantes.add(m);
      }
      await local.actualizarCanal(localId, ultimo: lote.last);
      if (lote.length < _porPagina) break;
    }
    if (traidos > 0) {
      _canales = await local.canales();
      notifyListeners();
    }
    return traidos;
  }

  static const _porPagina = 40;

  Future<List<MensajeChat>> _pedirMensajes(
    int localId, {
    int? desde,
    int? antes,
  }) async {
    final datos = await api.get(
      '/api/chat/canales/$localId/mensajes',
      {
        if (desde != null && desde > 0) 'desde': desde,
        if (antes != null) 'antes': antes,
        'limite': _porPagina,
      },
      true,
    ) as Map<String, dynamic>;

    // Los acuses de los demás viajan con la página: es de donde salen los ticks.
    final ajenas = [
      for (final a in (datos['ajenas'] as List? ?? const []))
        LecturaAjena.desdeJson((a as Map).cast<String, dynamic>()),
    ];
    await _local?.guardarLecturas(localId, ajenas);

    // Solo tiene sentido al pedir hacia atrás: pidiendo lo nuevo, el servidor
    // no sabe cuánto historial tiene ya el teléfono.
    if (antes != null || desde == null || desde == 0) {
      await _local?.actualizarCanal(localId, hayMasArriba: datos['hay_mas'] == true);
    }

    return [
      for (final m in (datos['mensajes'] as List? ?? const []))
        MensajeChat.desdeJson((m as Map).cast<String, dynamic>()),
    ];
  }

  /// La página anterior de un canal.
  ///
  /// Primero mira la copia; solo si allí se acaba el historial —y el servidor
  /// tiene más— sale a la red. Es lo que hace que subir por una conversación ya
  /// vista no gaste nada.
  Future<List<MensajeChat>> anteriores(int localId, int antesDe) async {
    final local = _local;
    if (local == null) return [];

    final guardados = await local.mensajes(localId, antes: antesDe);
    if (guardados.isNotEmpty) return guardados;

    final canal = await local.canal(localId);
    if (canal != null && !canal.hayMasArriba) return [];

    try {
      final lote = await _pedirMensajes(localId, antes: antesDe);
      await local.guardarMensajes(lote);
      return lote;
    } on ErrorApi {
      return [];
    }
  }

  /// Lo que hay que pintar al abrir un canal: lo guardado, y si no hay nada,
  /// la última página del servidor.
  Future<List<MensajeChat>> alAbrirCanal(int localId) async {
    final local = _local;
    if (local == null) return [];

    var mensajes = await local.mensajes(localId);
    if (mensajes.isEmpty) {
      try {
        final lote = await _pedirMensajes(localId);
        await local.guardarMensajes(lote);
        mensajes = lote;
      } on ErrorApi {
        return [];
      }
    } else {
      // Hay copia: solo se pide lo que falta desde el último guardado, y ni
      // eso si la lista de canales ya dice que no falta nada.
      final canal = await local.canal(localId);
      final ultimo = await local.ultimoGuardado(localId);
      if (ultimo < (canal?.ultimoId ?? 0)) {
        await traerNuevos(localId);
        mensajes = await local.mensajes(localId);
      }
    }
    return mensajes;
  }

  Future<List<LecturaAjena>> lecturasDe(int localId) async =>
      await _local?.lecturas(localId) ?? [];

  Future<List<MensajeChat>> pendientesDe(int localId) async {
    final cola = await _local?.pendientes(localId: localId) ?? [];
    return [
      for (final e in cola)
        e.comoMensaje(
          autorId: _usuarioId,
          autorNombre: _usuarioNombre,
          fallo: e.intentos > 0,
        ),
    ];
  }

  // ---------- El flujo de eventos ----------

  void conectarFlujo() {
    if (!_enMarcha || _clienteFlujo != null) return;
    _reintento?.cancel();

    final cliente = http.Client();
    _clienteFlujo = cliente;

    api.abrirFlujoChat(cliente).then((respuesta) {
      if (_clienteFlujo != cliente) {
        cliente.close();
        return;
      }
      if (respuesta.statusCode == 401) {
        // La sesión ya no vale: reintentar no la arregla. La app vuelve al
        // acceso por su cuenta, que es lo que hace este aviso.
        desconectarFlujo();
        _enMarcha = false;
        api.alCaducarSesion?.call();
        return;
      }
      if (respuesta.statusCode != 200) {
        _caidaDelFlujo(cliente);
        return;
      }
      _fallosSeguidos = 0;
      _conectado = true;
      notifyListeners();

      var evento = '';
      final datos = StringBuffer();

      _escucha = respuesta.stream
          .transform(utf8.decoder)
          .transform(const LineSplitter())
          .listen(
        (linea) {
          // Un bloque termina en una línea en blanco; los que empiezan por «:»
          // son latidos y no llevan nada dentro.
          if (linea.isEmpty) {
            if (evento.isNotEmpty && datos.isNotEmpty) {
              _encolar(evento, datos.toString());
            }
            evento = '';
            datos.clear();
            return;
          }
          if (linea.startsWith(':')) return;
          if (linea.startsWith('event:')) evento = linea.substring(6).trim();
          if (linea.startsWith('data:')) datos.write(linea.substring(5).trim());
        },
        onDone: () => _caidaDelFlujo(cliente),
        onError: (_) => _caidaDelFlujo(cliente),
        cancelOnError: true,
      );
    }).catchError((_) => _caidaDelFlujo(cliente));
  }

  void desconectarFlujo() {
    _reintento?.cancel();
    _escucha?.cancel();
    _escucha = null;
    _clienteFlujo?.close();
    _clienteFlujo = null;
    if (_conectado) {
      _conectado = false;
      notifyListeners();
    }
  }

  /// El flujo se ha caído: se vuelve a abrir con esperas cada vez más largas.
  ///
  /// Al reconectar, el servidor manda «ponte al día» y de ahí sale la
  /// sincronización, así que un corte largo no pierde nada.
  void _caidaDelFlujo(http.Client cliente) {
    if (_clienteFlujo != cliente) return;
    desconectarFlujo();
    if (!_enMarcha) return;
    _fallosSeguidos++;
    final espera = Duration(seconds: min(60, 1 << min(_fallosSeguidos, 5)));
    _reintento = Timer(espera, conectarFlujo);
  }

  /// Los eventos se atienden de uno en uno.
  ///
  /// Cada uno escribe en la copia local, y dos a la vez podrían pisarse: llegan
  /// seguidos cuando alguien manda tres mensajes de un tirón.
  Future<void> _enCurso = Future.value();

  void _encolar(String evento, String crudo) {
    _enCurso = _enCurso.then((_) => _procesar(evento, crudo)).catchError((_) {});
  }

  Future<void> _procesar(String evento, String crudo) async {
    Map<String, dynamic> datos;
    try {
      datos = (jsonDecode(crudo) as Map).cast<String, dynamic>();
    } catch (_) {
      return;
    }

    switch (evento) {
      case 'sincroniza':
        await sincronizar();
        unawaited(vaciarSalida());
        break;

      case 'mensaje':
      case 'borrado':
        final mensaje = MensajeChat.desdeJson(datos);
        await _local?.guardarMensajes([mensaje]);
        // Al borrar uno antiguo, la linea de la lista no cambia: el ultimo
        // mensaje del canal sigue siendo el que era.
        final canal = _canalDe(mensaje.localId);
        if (canal == null || (canal.ultimoId ?? 0) <= mensaje.id) {
          await _local?.actualizarCanal(mensaje.localId, ultimo: mensaje);
        }
        _entrantes.add(mensaje);

        final propio = mensaje.autorId == _usuarioId;
        if (evento == 'mensaje' && !propio) {
          // Ha llegado al teléfono: quien lo escribió tiene que verlo, esté esta
          // pantalla abierta o no. Que además esté leído lo decide el canal.
          unawaited(marcarRecibido(mensaje.localId, mensaje.id));
          if (canalEnPantalla != mensaje.localId) {
            await _sumarSinLeer(mensaje.localId);
          }
        }
        await _refrescarCanales();
        break;

      case 'acuses':
        final lectura = LecturaAjena.desdeJson(datos);
        if (lectura.usuarioId == _usuarioId) break;
        final localId = (datos['local_id'] as num?)?.toInt() ?? 0;
        await _local?.guardarLecturas(localId, [lectura]);
        _acuses.add(lectura);
        break;

      case 'escribiendo':
        _escribiendo.add((
          localId: (datos['local_id'] as num?)?.toInt() ?? 0,
          nombre: '${datos['nombre'] ?? ''}',
        ));
        break;
    }
  }

  CanalChat? _canalDe(int localId) {
    for (final c in _canales) {
      if (c.localId == localId) return c;
    }
    return null;
  }

  Future<void> _sumarSinLeer(int localId) async {
    final canal = _canalDe(localId);
    if (canal == null) return;
    await _local?.actualizarCanal(localId, sinLeer: canal.sinLeer + 1);
  }

  Future<void> _refrescarCanales() async {
    final local = _local;
    if (local == null) return;
    _canales = await local.canales();
    notifyListeners();
  }

  // ---------- Acuses ----------

  Future<void> marcarRecibido(int localId, int hasta) async {
    if (hasta <= 0) return;
    try {
      await api.post('/api/chat/canales/$localId/recibido', {'hasta': hasta});
      await _local?.actualizarCanal(localId, recibidoHasta: hasta);
    } on ErrorApi {
      // Se vuelve a mandar con el siguiente mensaje o al ponerse al día.
    }
  }

  Future<void> marcarLeido(int localId, int hasta) async {
    if (hasta <= 0) return;
    try {
      await api.post('/api/chat/canales/$localId/leido', {'hasta': hasta});
    } on ErrorApi {
      return;
    }
    await _local?.actualizarCanal(
      localId,
      leidoHasta: hasta,
      recibidoHasta: hasta,
      sinLeer: 0,
    );
    await _refrescarCanales();
  }

  DateTime _ultimoEscribiendo = DateTime.fromMillisecondsSinceEpoch(0);

  /// Avisa de que se está escribiendo, como mucho una vez cada tres segundos:
  /// no es información que merezca una petición por tecla.
  void avisarEscribiendo(int localId) {
    final ahora = DateTime.now();
    if (ahora.difference(_ultimoEscribiendo).inSeconds < 3) return;
    _ultimoEscribiendo = ahora;
    api.post('/api/chat/canales/$localId/escribiendo').catchError((_) => null);
  }

  // ---------- Enviar ----------

  /// Pone un mensaje en la cola y lo intenta mandar.
  ///
  /// Devuelve cómo se pinta mientras va de camino. Nada se pierde si falla: la
  /// cola vive en la copia del teléfono y se reintenta sola.
  Future<MensajeChat> enviar(
    int localId, {
    String contenido = '',
    List<AdjuntoChat> adjuntos = const [],
  }) async {
    final envio = EnvioPendiente(
      clienteId: _nuevoClienteId(),
      localId: localId,
      contenido: contenido,
      adjuntos: [for (final a in adjuntos) a.id],
      creadoEn: DateTime.now(),
      vista: adjuntos,
    );
    await _local?.encolar(envio);
    unawaited(vaciarSalida());
    return envio.comoMensaje(autorId: _usuarioId, autorNombre: _usuarioNombre);
  }

  static final _azar = Random();

  String _nuevoClienteId() =>
      '${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}'
      '-${_azar.nextInt(1 << 32).toRadixString(36)}';

  /// Vacía la cola de salida.
  ///
  /// El `cliente_id` de cada mensaje es lo que hace que reintentar sea gratis:
  /// si el envío llegó pero la respuesta no, el servidor devuelve el mensaje que
  /// ya tenía en lugar de escribirlo otra vez.
  Future<void> vaciarSalida() async {
    final local = _local;
    if (local == null || _vaciando) return;
    _vaciando = true;
    _reintentoSalida?.cancel();

    try {
      for (final envio in await local.pendientes()) {
        try {
          final datos = await api.post('/api/chat/canales/${envio.localId}/mensajes', {
            'cliente_id': envio.clienteId,
            'contenido': envio.contenido,
            'adjuntos': envio.adjuntos,
          }) as Map<String, dynamic>;

          final mensaje = MensajeChat.desdeJson(datos);
          await local.desencolar(envio.clienteId);
          await local.guardarMensajes([mensaje]);
          await local.actualizarCanal(envio.localId, ultimo: mensaje);
          _entrantes.add(mensaje);
        } on ErrorApi catch (e) {
          // Un rechazo del servidor no se arregla repitiéndolo: se descarta. Un
          // fallo de red sí, con una espera cada vez más larga.
          if (e.estado >= 400 && e.estado < 500 && e.estado != 429) {
            await local.desencolar(envio.clienteId);
            continue;
          }
          await local.anotarIntento(envio.clienteId, envio.intentos + 1);
          final espera = Duration(seconds: min(60, 1 << min(envio.intentos + 1, 5)));
          _reintentoSalida = Timer(espera, () => unawaited(vaciarSalida()));
          break;
        }
      }
    } finally {
      _vaciando = false;
      await _refrescarCanales();
    }
  }

  /// Borra un mensaje propio. El hueco se queda, como en la web.
  Future<void> borrar(int mensajeId) async {
    final datos = await api.delete('/api/chat/mensajes/$mensajeId') as Map<String, dynamic>;
    final mensaje = MensajeChat.desdeJson(datos);
    await _local?.guardarMensajes([mensaje]);
    _entrantes.add(mensaje);
    await _refrescarCanales();
  }

  @override
  void dispose() {
    desconectarFlujo();
    _reintentoSalida?.cancel();
    _entrantes.close();
    _acuses.close();
    _escribiendo.close();
    super.dispose();
  }
}
