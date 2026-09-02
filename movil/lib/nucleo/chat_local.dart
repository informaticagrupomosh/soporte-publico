import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

import '../modelos/chat.dart';

/// La copia del chat que vive en el teléfono.
///
/// Es lo que hace que abrir un canal sea instantáneo y que la red solo traiga
/// **lo que falta**: los mensajes se guardan aquí según llegan, y la puesta al
/// día pregunta al servidor a partir del último que hay guardado, no desde el
/// principio. Con la copia hecha, entrar en un canal no descarga nada; sin
/// ella, se va pidiendo por páginas a medida que se sube por la conversación.
///
/// Los archivos no se guardan aquí: de eso se ocupa la carpeta temporal, que el
/// sistema puede vaciar cuando le haga falta sitio. Aquí solo está el texto y
/// la ficha de cada archivo —nombre, tipo y duración—, que es lo que hace falta
/// para pintar la conversación sin descargar nada.
class ChatLocal {
  ChatLocal._(this._db);

  final Database _db;

  static ChatLocal? _abierta;
  static int? _deQuien;

  /// Abre la copia de esta cuenta.
  ///
  /// Cada usuario tiene la suya: en un teléfono compartido —los hay, en los
  /// locales— el que entra después no puede encontrarse la conversación del
  /// anterior.
  static Future<ChatLocal> abrir(int usuarioId) async {
    if (_abierta != null && _deQuien == usuarioId) return _abierta!;
    await cerrar();

    final ruta = p.join(await getDatabasesPath(), 'chat-$usuarioId.db');
    final db = await openDatabase(
      ruta,
      version: 1,
      onConfigure: (db) => db.execute('PRAGMA foreign_keys = ON'),
      onCreate: (db, _) async {
        await db.execute('''
          CREATE TABLE canales (
            local_id INTEGER PRIMARY KEY,
            nombre TEXT NOT NULL,
            canal TEXT NOT NULL,
            sin_leer INTEGER NOT NULL DEFAULT 0,
            leido_hasta INTEGER NOT NULL DEFAULT 0,
            recibido_hasta INTEGER NOT NULL DEFAULT 0,
            ultimo_id INTEGER,
            ultimo_resumen TEXT,
            ultimo_autor TEXT,
            ultimo_autor_id INTEGER,
            ultimo_en TEXT,
            orden INTEGER NOT NULL DEFAULT 0,
            -- Si por encima del mensaje más antiguo guardado puede quedar
            -- historial sin traer. En cuanto el servidor dice que no hay más,
            -- se apaga y esta copia deja de preguntar hacia arriba.
            hay_mas_arriba INTEGER NOT NULL DEFAULT 1
          )
        ''');
        await db.execute('''
          CREATE TABLE mensajes (
            id INTEGER PRIMARY KEY,
            local_id INTEGER NOT NULL,
            autor_id INTEGER NOT NULL,
            autor_nombre TEXT NOT NULL DEFAULT '',
            autor_rol TEXT NOT NULL DEFAULT '',
            cliente_id TEXT NOT NULL DEFAULT '',
            contenido TEXT NOT NULL DEFAULT '',
            creado_en TEXT,
            borrado INTEGER NOT NULL DEFAULT 0
          )
        ''');
        await db.execute('CREATE INDEX idx_mensajes_local ON mensajes(local_id, id)');
        await db.execute('''
          CREATE TABLE adjuntos (
            id INTEGER PRIMARY KEY,
            mensaje_id INTEGER NOT NULL,
            nombre TEXT NOT NULL,
            tipo TEXT NOT NULL,
            duracion INTEGER
          )
        ''');
        await db.execute('CREATE INDEX idx_adjuntos_mensaje ON adjuntos(mensaje_id)');
        await db.execute('''
          CREATE TABLE lecturas (
            local_id INTEGER NOT NULL,
            usuario_id INTEGER NOT NULL,
            nombre TEXT,
            recibido_hasta INTEGER NOT NULL DEFAULT 0,
            leido_hasta INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (local_id, usuario_id)
          )
        ''');
        // Lo escrito que todavía no ha salido del teléfono. Está en la copia y
        // no en memoria a propósito: así sobrevive a cerrar la app y sale solo
        // cuando vuelve la cobertura.
        await db.execute('''
          CREATE TABLE salida (
            cliente_id TEXT PRIMARY KEY,
            local_id INTEGER NOT NULL,
            contenido TEXT NOT NULL DEFAULT '',
            adjuntos TEXT NOT NULL DEFAULT '',
            creado_en TEXT NOT NULL,
            intentos INTEGER NOT NULL DEFAULT 0,
            vista TEXT NOT NULL DEFAULT ''
          )
        ''');
      },
    );

    _abierta = ChatLocal._(db);
    _deQuien = usuarioId;
    return _abierta!;
  }

  static Future<void> cerrar() async {
    await _abierta?._db.close();
    _abierta = null;
    _deQuien = null;
  }

  /// Tira la copia de una cuenta. Se llama al cerrar sesión: la conversación de
  /// un local no tiene por qué quedarse en el teléfono de quien ya no entra.
  static Future<void> borrarDe(int usuarioId) async {
    if (_deQuien == usuarioId) await cerrar();
    final ruta = p.join(await getDatabasesPath(), 'chat-$usuarioId.db');
    try {
      await deleteDatabase(ruta);
    } catch (_) {
      // Si no se puede, la próxima sesión de esa cuenta la reutiliza.
    }
  }

  // ---------- Canales ----------

  Future<List<CanalChat>> canales() async {
    final filas = await _db.query('canales', orderBy: 'orden, nombre');
    return [for (final f in filas) CanalChat.desdeFila(f)];
  }

  Future<CanalChat?> canal(int localId) async {
    final filas = await _db.query(
      'canales',
      where: 'local_id = ?',
      whereArgs: [localId],
      limit: 1,
    );
    return filas.isEmpty ? null : CanalChat.desdeFila(filas.first);
  }

  /// Guarda la lista que acaba de dar el servidor.
  ///
  /// Lo que decide el servidor —nombre, sin leer, hasta dónde se ha leído— pisa
  /// lo local, que para eso es la fuente de verdad. Lo que solo sabe el
  /// teléfono —si le falta historial por arriba— se conserva.
  Future<void> guardarCanales(List<CanalChat> canales) async {
    final lote = _db.batch();
    for (var i = 0; i < canales.length; i++) {
      final c = canales[i];
      final fila = c.aFila()..['orden'] = i;
      // `hay_mas_arriba` no viene del servidor: se quita para no pisar lo que
      // sepa la copia, y solo se pone al crear la fila.
      fila.remove('hay_mas_arriba');
      lote.rawInsert(
        'INSERT OR IGNORE INTO canales (local_id, nombre, canal) VALUES (?, ?, ?)',
        [c.localId, c.nombre, c.canal],
      );
      lote.update('canales', fila, where: 'local_id = ?', whereArgs: [c.localId]);
    }
    // Un canal del que ya no se forma parte —a alguien le han cambiado los
    // locales— desaparece con su conversación.
    final vivos = canales.map((c) => c.localId).toList();
    if (vivos.isEmpty) {
      lote.delete('mensajes');
      lote.delete('adjuntos');
      lote.delete('lecturas');
      lote.delete('canales');
    } else {
      final marcas = List.filled(vivos.length, '?').join(',');
      lote.rawDelete(
        'DELETE FROM adjuntos WHERE mensaje_id IN '
        '(SELECT id FROM mensajes WHERE local_id NOT IN ($marcas))',
        vivos,
      );
      lote.rawDelete('DELETE FROM mensajes WHERE local_id NOT IN ($marcas)', vivos);
      lote.rawDelete('DELETE FROM lecturas WHERE local_id NOT IN ($marcas)', vivos);
      lote.rawDelete('DELETE FROM canales WHERE local_id NOT IN ($marcas)', vivos);
    }
    await lote.commit(noResult: true);
  }

  Future<void> actualizarCanal(
    int localId, {
    int? sinLeer,
    int? leidoHasta,
    int? recibidoHasta,
    bool? hayMasArriba,
    MensajeChat? ultimo,
  }) async {
    final cambios = <String, Object?>{
      if (sinLeer != null) 'sin_leer': sinLeer,
      if (leidoHasta != null) 'leido_hasta': leidoHasta,
      if (recibidoHasta != null) 'recibido_hasta': recibidoHasta,
      if (hayMasArriba != null) 'hay_mas_arriba': hayMasArriba ? 1 : 0,
      if (ultimo != null) ...{
        'ultimo_id': ultimo.id,
        'ultimo_resumen': ultimo.resumen,
        'ultimo_autor': ultimo.autorNombre,
        'ultimo_autor_id': ultimo.autorId,
        'ultimo_en': ultimo.creadoEn?.toUtc().toIso8601String(),
      },
    };
    if (cambios.isEmpty) return;
    await _db.update('canales', cambios, where: 'local_id = ?', whereArgs: [localId]);
  }

  // ---------- Mensajes ----------

  /// Los últimos [limite] mensajes guardados de un canal, en orden.
  ///
  /// Con [antes] devuelve la página anterior, que es lo que se pide al subir
  /// por la conversación: mientras la copia tenga historial no se toca la red.
  Future<List<MensajeChat>> mensajes(int localId, {int limite = 40, int? antes}) async {
    final filas = await _db.query(
      'mensajes',
      where: antes == null ? 'local_id = ?' : 'local_id = ? AND id < ?',
      whereArgs: antes == null ? [localId] : [localId, antes],
      orderBy: 'id DESC',
      limit: limite,
    );
    return _conAdjuntos(filas.reversed.toList());
  }

  Future<List<MensajeChat>> _conAdjuntos(List<Map<String, Object?>> filas) async {
    if (filas.isEmpty) return [];
    final ids = [for (final f in filas) f['id'] as int];
    final marcas = List.filled(ids.length, '?').join(',');
    final adjuntos = await _db.query(
      'adjuntos',
      where: 'mensaje_id IN ($marcas)',
      whereArgs: ids,
      orderBy: 'id',
    );
    final por = <int, List<AdjuntoChat>>{};
    for (final a in adjuntos) {
      (por[a['mensaje_id'] as int] ??= []).add(AdjuntoChat.desdeFila(a));
    }
    return [
      for (final f in filas)
        MensajeChat.desdeFila(f, adjuntos: por[f['id'] as int] ?? const []),
    ];
  }

  /// El mensaje más nuevo que hay guardado de un canal. Es el punto desde el
  /// que se le pide al servidor lo que falta.
  Future<int> ultimoGuardado(int localId) async {
    final fila = await _db.rawQuery(
      'SELECT COALESCE(MAX(id), 0) AS n FROM mensajes WHERE local_id = ?',
      [localId],
    );
    return (fila.first['n'] as int?) ?? 0;
  }

  /// El más antiguo, que es hasta dónde llega la copia hacia atrás.
  Future<int> primeroGuardado(int localId) async {
    final fila = await _db.rawQuery(
      'SELECT COALESCE(MIN(id), 0) AS n FROM mensajes WHERE local_id = ?',
      [localId],
    );
    return (fila.first['n'] as int?) ?? 0;
  }

  Future<int> cuantosGuardados(int localId) async {
    final fila = await _db.rawQuery(
      'SELECT COUNT(*) AS n FROM mensajes WHERE local_id = ?',
      [localId],
    );
    return (fila.first['n'] as int?) ?? 0;
  }

  /// Guarda mensajes recién llegados. Los que ya estaban se pisan: es lo que
  /// convierte un mensaje en «eliminado» sin tener que buscarlo.
  Future<void> guardarMensajes(List<MensajeChat> mensajes) async {
    if (mensajes.isEmpty) return;
    final lote = _db.batch();
    for (final m in mensajes) {
      if (m.id == 0) continue;
      lote.insert('mensajes', m.aFila(), conflictAlgorithm: ConflictAlgorithm.replace);
      lote.delete('adjuntos', where: 'mensaje_id = ?', whereArgs: [m.id]);
      for (final a in m.adjuntos) {
        lote.insert('adjuntos', a.aFila(), conflictAlgorithm: ConflictAlgorithm.replace);
      }
    }
    await lote.commit(noResult: true);
  }

  // ---------- Acuses de los demás ----------

  Future<List<LecturaAjena>> lecturas(int localId) async {
    final filas = await _db.query('lecturas', where: 'local_id = ?', whereArgs: [localId]);
    return [for (final f in filas) LecturaAjena.desdeFila(f)];
  }

  /// Guarda hasta dónde han llegado los demás.
  ///
  /// Los dos números solo suben, igual que en el servidor: un acuse que llegue
  /// tarde no puede devolver un mensaje a «sin leer». Y el nombre solo se pisa
  /// si viene: el acuse que llega por el flujo no lo trae, y no es motivo para
  /// olvidar el que ya se sabía.
  Future<void> guardarLecturas(int localId, List<LecturaAjena> lecturas) async {
    final lote = _db.batch();
    for (final l in lecturas) {
      // En dos pasos y no con un UPSERT: la app llega hasta Android 6, cuya
      // SQLite es anterior a `ON CONFLICT … DO UPDATE`. Esto vale en todas.
      lote.rawInsert(
        'INSERT OR IGNORE INTO lecturas (local_id, usuario_id, nombre) VALUES (?, ?, ?)',
        [localId, l.usuarioId, l.nombre],
      );
      lote.rawUpdate(
        '''
        UPDATE lecturas SET
          nombre = CASE WHEN ? = '' THEN nombre ELSE ? END,
          recibido_hasta = MAX(recibido_hasta, ?),
          leido_hasta = MAX(leido_hasta, ?)
        WHERE local_id = ? AND usuario_id = ?
        ''',
        [l.nombre, l.nombre, l.recibidoHasta, l.leidoHasta, localId, l.usuarioId],
      );
    }
    await lote.commit(noResult: true);
  }

  // ---------- La cola de salida ----------

  Future<List<EnvioPendiente>> pendientes({int? localId}) async {
    final filas = await _db.query(
      'salida',
      where: localId == null ? null : 'local_id = ?',
      whereArgs: localId == null ? null : [localId],
      orderBy: 'creado_en',
    );
    return [for (final f in filas) EnvioPendiente.desdeFila(f)];
  }

  Future<void> encolar(EnvioPendiente envio) =>
      _db.insert('salida', envio.aFila(), conflictAlgorithm: ConflictAlgorithm.replace);

  Future<void> desencolar(String clienteId) =>
      _db.delete('salida', where: 'cliente_id = ?', whereArgs: [clienteId]);

  Future<void> anotarIntento(String clienteId, int intentos) => _db.update(
        'salida',
        {'intentos': intentos},
        where: 'cliente_id = ?',
        whereArgs: [clienteId],
      );
}
