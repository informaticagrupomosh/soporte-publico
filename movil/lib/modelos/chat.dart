import 'modelos.dart' show fechaUtc;

/// Los datos del chat de local, tal y como los devuelve `/api/chat/...` y tal y
/// como se guardan en la copia del teléfono.
///
/// Cada modelo sabe convertirse en las dos direcciones —del JSON del servidor y
/// de la fila de SQLite— porque la app lee de los dos sitios: de la copia local
/// para pintar al instante y del servidor para ponerse al día.

int? _entero(dynamic v) {
  if (v == null) return null;
  if (v is int) return v;
  if (v is num) return v.toInt();
  return int.tryParse('$v');
}

/// Un canal: la conversación de un local.
class CanalChat {
  CanalChat({
    required this.localId,
    required this.nombre,
    required this.canal,
    this.sinLeer = 0,
    this.leidoHasta = 0,
    this.recibidoHasta = 0,
    this.ultimoId,
    this.ultimoResumen,
    this.ultimoAutor,
    this.ultimoAutorId,
    this.ultimoEn,
    this.conectados = 0,
    this.orden = 0,
    this.hayMasArriba = true,
  });

  final int localId;
  final String nombre;

  /// El nombre al estilo de IRC: `#local-1`.
  final String canal;

  int sinLeer;
  int leidoHasta;
  int recibidoHasta;

  /// El último mensaje, para la línea de la lista de canales.
  int? ultimoId;
  String? ultimoResumen;
  String? ultimoAutor;
  int? ultimoAutorId;
  DateTime? ultimoEn;

  int conectados;
  int orden;

  /// Si por encima del mensaje más antiguo que hay guardado puede quedar
  /// historial en el servidor. Cuando es falso, la copia local tiene el canal
  /// entero y no hay nada más que pedir hacia arriba.
  bool hayMasArriba;

  factory CanalChat.desdeJson(Map<String, dynamic> j) {
    final ultimo = j['ultimo'] as Map<String, dynamic>?;
    return CanalChat(
      localId: _entero(j['local_id']) ?? 0,
      nombre: '${j['nombre'] ?? ''}',
      canal: '${j['canal'] ?? ''}',
      sinLeer: _entero(j['sin_leer']) ?? 0,
      leidoHasta: _entero(j['leido_hasta']) ?? 0,
      recibidoHasta: _entero(j['recibido_hasta']) ?? 0,
      conectados: _entero(j['conectados']) ?? 0,
      ultimoId: ultimo == null ? null : _entero(ultimo['id']),
      ultimoResumen: ultimo == null ? null : '${ultimo['resumen'] ?? ''}',
      ultimoAutor: ultimo == null ? null : '${ultimo['autor_nombre'] ?? ''}',
      ultimoAutorId: ultimo == null ? null : _entero(ultimo['autor_id']),
      ultimoEn: ultimo == null ? null : fechaUtc(ultimo['creado_en']),
    );
  }

  factory CanalChat.desdeFila(Map<String, Object?> f) => CanalChat(
        localId: f['local_id'] as int,
        nombre: '${f['nombre']}',
        canal: '${f['canal']}',
        sinLeer: (f['sin_leer'] as int?) ?? 0,
        leidoHasta: (f['leido_hasta'] as int?) ?? 0,
        recibidoHasta: (f['recibido_hasta'] as int?) ?? 0,
        ultimoId: f['ultimo_id'] as int?,
        ultimoResumen: f['ultimo_resumen'] as String?,
        ultimoAutor: f['ultimo_autor'] as String?,
        ultimoAutorId: f['ultimo_autor_id'] as int?,
        ultimoEn: fechaUtc(f['ultimo_en']),
        orden: (f['orden'] as int?) ?? 0,
        hayMasArriba: (f['hay_mas_arriba'] as int?) != 0,
      );

  Map<String, Object?> aFila() => {
        'local_id': localId,
        'nombre': nombre,
        'canal': canal,
        'sin_leer': sinLeer,
        'leido_hasta': leidoHasta,
        'recibido_hasta': recibidoHasta,
        'ultimo_id': ultimoId,
        'ultimo_resumen': ultimoResumen,
        'ultimo_autor': ultimoAutor,
        'ultimo_autor_id': ultimoAutorId,
        'ultimo_en': ultimoEn?.toUtc().toIso8601String(),
        'orden': orden,
        'hay_mas_arriba': hayMasArriba ? 1 : 0,
      };
}

/// Un archivo que viaja con un mensaje del chat.
class AdjuntoChat {
  const AdjuntoChat({
    required this.id,
    required this.mensajeId,
    required this.nombre,
    required this.tipo,
    this.duracion,
  });

  final int id;
  final int mensajeId;
  final String nombre;

  /// «imagen», «video», «audio» o «documento».
  final String tipo;

  /// Segundos, en las notas de voz y los vídeos. Se enseña sin descargar el
  /// archivo, que es de lo que se trata.
  final int? duracion;

  bool get esImagen => tipo == 'imagen';
  bool get esVideo => tipo == 'video';
  bool get esAudio => tipo == 'audio';

  factory AdjuntoChat.desdeJson(Map<String, dynamic> j, int mensajeId) => AdjuntoChat(
        id: _entero(j['id']) ?? 0,
        mensajeId: mensajeId,
        nombre: '${j['nombre'] ?? ''}',
        tipo: '${j['tipo'] ?? 'documento'}',
        duracion: _entero(j['duracion']),
      );

  factory AdjuntoChat.desdeFila(Map<String, Object?> f) => AdjuntoChat(
        id: f['id'] as int,
        mensajeId: f['mensaje_id'] as int,
        nombre: '${f['nombre']}',
        tipo: '${f['tipo']}',
        duracion: f['duracion'] as int?,
      );

  Map<String, Object?> aFila() => {
        'id': id,
        'mensaje_id': mensajeId,
        'nombre': nombre,
        'tipo': tipo,
        'duracion': duracion,
      };
}

/// En qué punto está un mensaje propio.
///
/// Los cuatro de cualquier chat, más el de un envío que no ha podido salir y se
/// va a reintentar.
enum EstadoMensaje { enviando, fallo, enviado, recibido, leido }

/// Un mensaje del chat.
///
/// Los que todavía no ha confirmado el servidor no tienen `id` —el número lo
/// pone él— y viajan con [pendiente] puesto; se identifican por su
/// [clienteId], que es lo que permite reintentar sin duplicar.
class MensajeChat {
  MensajeChat({
    required this.id,
    required this.localId,
    required this.autorId,
    required this.autorNombre,
    required this.clienteId,
    required this.contenido,
    this.autorRol = '',
    this.creadoEn,
    this.borrado = false,
    this.pendiente = false,
    this.fallo = false,
    this.adjuntos = const [],
  });

  /// 0 mientras está de camino.
  final int id;
  final int localId;
  final int autorId;
  final String autorNombre;
  final String autorRol;
  final String clienteId;
  final String contenido;
  final DateTime? creadoEn;
  final bool borrado;

  /// Escrito aquí y todavía sin confirmar por el servidor.
  final bool pendiente;

  /// Un envío que ha fallado y se está reintentando.
  final bool fallo;

  final List<AdjuntoChat> adjuntos;

  bool get vacio => contenido.isEmpty && adjuntos.isEmpty;

  factory MensajeChat.desdeJson(Map<String, dynamic> j) {
    final id = _entero(j['id']) ?? 0;
    final lista = (j['adjuntos'] as List?) ?? const [];
    return MensajeChat(
      id: id,
      localId: _entero(j['local_id']) ?? 0,
      autorId: _entero(j['autor_id']) ?? 0,
      autorNombre: '${j['autor_nombre'] ?? ''}',
      autorRol: '${j['autor_rol'] ?? ''}',
      clienteId: '${j['cliente_id'] ?? ''}',
      contenido: '${j['contenido'] ?? ''}',
      creadoEn: fechaUtc(j['creado_en']),
      borrado: j['borrado'] == true || j['borrado'] == 1,
      adjuntos: [
        for (final a in lista) AdjuntoChat.desdeJson((a as Map).cast<String, dynamic>(), id),
      ],
    );
  }

  factory MensajeChat.desdeFila(
    Map<String, Object?> f, {
    List<AdjuntoChat> adjuntos = const [],
  }) =>
      MensajeChat(
        id: (f['id'] as int?) ?? 0,
        localId: f['local_id'] as int,
        autorId: (f['autor_id'] as int?) ?? 0,
        autorNombre: '${f['autor_nombre'] ?? ''}',
        autorRol: '${f['autor_rol'] ?? ''}',
        clienteId: '${f['cliente_id'] ?? ''}',
        contenido: '${f['contenido'] ?? ''}',
        creadoEn: fechaUtc(f['creado_en']),
        borrado: (f['borrado'] as int?) == 1,
        adjuntos: adjuntos,
      );

  Map<String, Object?> aFila() => {
        'id': id,
        'local_id': localId,
        'autor_id': autorId,
        'autor_nombre': autorNombre,
        'autor_rol': autorRol,
        'cliente_id': clienteId,
        'contenido': contenido,
        'creado_en': creadoEn?.toUtc().toIso8601String(),
        'borrado': borrado ? 1 : 0,
      };

  MensajeChat copiaCon({bool? fallo}) => MensajeChat(
        id: id,
        localId: localId,
        autorId: autorId,
        autorNombre: autorNombre,
        autorRol: autorRol,
        clienteId: clienteId,
        contenido: contenido,
        creadoEn: creadoEn,
        borrado: borrado,
        pendiente: pendiente,
        fallo: fallo ?? this.fallo,
        adjuntos: adjuntos,
      );

  /// Lo que se enseña de este mensaje cuando no cabe entero: la línea de la
  /// lista de canales. Es el mismo criterio que usa el servidor.
  String get resumen {
    if (borrado) return 'Mensaje eliminado';
    if (contenido.isNotEmpty) return contenido.replaceAll(RegExp(r'\s+'), ' ');
    if (adjuntos.isEmpty) return '';
    switch (adjuntos.first.tipo) {
      case 'imagen':
        return '📷 Foto';
      case 'video':
        return '🎬 Vídeo';
      case 'audio':
        return '🎤 Nota de voz';
      default:
        return '📎 ${adjuntos.first.nombre}';
    }
  }
}

/// Hasta dónde ha llegado otra persona en un canal.
///
/// De aquí sale el estado de los mensajes propios: recibido si alguien lo tiene
/// recibido, leído si alguien lo ha leído.
class LecturaAjena {
  const LecturaAjena({
    required this.usuarioId,
    required this.nombre,
    required this.recibidoHasta,
    required this.leidoHasta,
  });

  final int usuarioId;
  final String nombre;
  final int recibidoHasta;
  final int leidoHasta;

  factory LecturaAjena.desdeJson(Map<String, dynamic> j) => LecturaAjena(
        usuarioId: _entero(j['usuario_id']) ?? 0,
        nombre: '${j['nombre'] ?? ''}',
        recibidoHasta: _entero(j['recibido_hasta']) ?? 0,
        leidoHasta: _entero(j['leido_hasta']) ?? 0,
      );

  factory LecturaAjena.desdeFila(Map<String, Object?> f) => LecturaAjena(
        usuarioId: f['usuario_id'] as int,
        nombre: '${f['nombre'] ?? ''}',
        recibidoHasta: (f['recibido_hasta'] as int?) ?? 0,
        leidoHasta: (f['leido_hasta'] as int?) ?? 0,
      );

  Map<String, Object?> aFila(int localId) => {
        'local_id': localId,
        'usuario_id': usuarioId,
        'nombre': nombre,
        'recibido_hasta': recibidoHasta,
        'leido_hasta': leidoHasta,
      };
}

/// Un mensaje escrito que todavía no ha salido del teléfono.
///
/// Vive en la copia local, así que sobrevive a cerrar la app: al volver a
/// abrirla se reintenta. Los archivos ya están subidos —solo se guarda su
/// identificador de borrador—, de modo que el reintento no vuelve a subirlos.
/// Con que se separan, dentro de una sola columna, los archivos de un envio
/// que todavia no ha salido. Un caracter de control: no aparece en el nombre
/// de ningun archivo, que es lo unico que se le pide a un separador.
const _separador = '\u0001';

class EnvioPendiente {
  EnvioPendiente({
    required this.clienteId,
    required this.localId,
    required this.contenido,
    required this.adjuntos,
    required this.creadoEn,
    this.intentos = 0,
    this.vista = const [],
  });

  final String clienteId;
  final int localId;
  final String contenido;

  /// Identificadores de los borradores ya subidos.
  final List<int> adjuntos;
  final DateTime creadoEn;
  int intentos;

  /// Solo para pintarlo mientras va de camino: nombre y tipo de cada archivo,
  /// que el servidor todavía no ha devuelto.
  final List<AdjuntoChat> vista;

  Map<String, Object?> aFila() => {
        'cliente_id': clienteId,
        'local_id': localId,
        'contenido': contenido,
        'adjuntos': adjuntos.join(','),
        'creado_en': creadoEn.toUtc().toIso8601String(),
        'intentos': intentos,
        // El identificador del borrador no hace falta aquí: ya va en
        // `adjuntos`. Esto es solo lo que se enseña mientras el mensaje viaja.
        'vista': [
          for (final a in vista) '${a.tipo}|${a.duracion ?? 0}|${a.nombre}',
        ].join(_separador),
      };

  factory EnvioPendiente.desdeFila(Map<String, Object?> f) {
    final crudo = '${f['vista'] ?? ''}';
    return EnvioPendiente(
      clienteId: '${f['cliente_id']}',
      localId: f['local_id'] as int,
      contenido: '${f['contenido'] ?? ''}',
      adjuntos: '${f['adjuntos'] ?? ''}'
          .split(',')
          .where((t) => t.isNotEmpty)
          .map(int.parse)
          .toList(),
      creadoEn: fechaUtc(f['creado_en']) ?? DateTime.now(),
      intentos: (f['intentos'] as int?) ?? 0,
      vista: crudo.isEmpty
          ? const []
          : [
              for (final trozo in crudo.split(_separador))
                if (trozo.split('|').length >= 3)
                  AdjuntoChat(
                    // Id 0: todavía no es un adjunto del servidor sino un
                    // borrador, y aquí solo sirve para pintar el globo.
                    id: 0,
                    mensajeId: 0,
                    tipo: trozo.split('|')[0],
                    duracion: int.tryParse(trozo.split('|')[1]) == 0
                        ? null
                        : int.tryParse(trozo.split('|')[1]),
                    // El nombre puede llevar la misma barra que separa los
                    // campos, así que es todo lo que queda detrás.
                    nombre: trozo.split('|').sublist(2).join('|'),
                  ),
            ],
    );
  }

  /// Cómo se pinta mientras está en la cola.
  MensajeChat comoMensaje({required int autorId, required String autorNombre, bool fallo = false}) =>
      MensajeChat(
        id: 0,
        localId: localId,
        autorId: autorId,
        autorNombre: autorNombre,
        clienteId: clienteId,
        contenido: contenido,
        creadoEn: creadoEn,
        pendiente: true,
        fallo: fallo,
        adjuntos: vista,
      );
}
