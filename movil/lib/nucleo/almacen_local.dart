import 'dart:convert';

import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

/// Lo que la app se guarda para poder trabajar sin conexión.
///
/// Dos cosas, y las dos en la misma base:
///
/// - **La copia de lo leído.** Cada respuesta buena del servidor se guarda tal
///   cual, y cuando no hay línea se sirve de aquí. Es lo que hace que la app
///   arranque y se pueda mirar entera sin cobertura: se ve lo último que se
///   sabía, no una pantalla vacía ni un error.
/// - **La cola de lo escrito.** Lo que se hace sin conexión —contestar en un
///   hilo, cambiar el estado de una incidencia— se anota aquí y sale solo, en
///   orden, en cuanto vuelve la línea.
///
/// Es una copia de trabajo, no un archivo: se vacía al cerrar sesión, porque
/// los datos que se ven dependen de quién ha entrado.
class AlmacenLocal {
  AlmacenLocal._(this._db);

  final Database _db;

  static AlmacenLocal? _abierto;

  static Future<AlmacenLocal> abrir() async {
    final ya = _abierto;
    if (ya != null) return ya;

    final ruta = p.join(await getDatabasesPath(), 'offline.db');
    final db = await openDatabase(
      ruta,
      version: 1,
      onCreate: (db, _) async {
        await db.execute('''
          CREATE TABLE cache (
            clave TEXT PRIMARY KEY,
            cuerpo TEXT NOT NULL,
            guardado_en TEXT NOT NULL
          )
        ''');
        await db.execute('''
          CREATE TABLE cola (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            metodo TEXT NOT NULL,
            ruta TEXT NOT NULL,
            cuerpo TEXT,
            -- Lo que se le enseña a la persona: «Responder en la incidencia
            -- #12». Sin esto, una cola pendiente sería una lista de rutas.
            etiqueta TEXT NOT NULL DEFAULT '',
            creado_en TEXT NOT NULL,
            intentos INTEGER NOT NULL DEFAULT 0
          )
        ''');
      },
    );
    _abierto = AlmacenLocal._(db);
    return _abierto!;
  }

  /// Tira la copia entera. Al cerrar sesión: lo que se veía era de quien salió.
  static Future<void> vaciar() async {
    final almacen = _abierto ?? await abrir();
    await almacen._db.delete('cache');
    await almacen._db.delete('cola');
  }

  // ---------- La copia de lo leído ----------

  /// La clave de una petición: su ruta con lo que llevara detrás, que es lo
  /// que la distingue de otra igual con otros filtros.
  static String claveDe(String ruta, Map<String, dynamic>? query) {
    if (query == null || query.isEmpty) return ruta;
    final partes = query.entries
        .where((e) => e.value != null && '${e.value}'.isNotEmpty)
        .map((e) => '${e.key}=${e.value}')
        .toList()
      ..sort();
    return partes.isEmpty ? ruta : '$ruta?${partes.join('&')}';
  }

  Future<void> guardar(String clave, dynamic datos) async {
    await _db.insert(
      'cache',
      {
        'clave': clave,
        'cuerpo': jsonEncode(datos),
        'guardado_en': DateTime.now().toUtc().toIso8601String(),
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  /// Lo último que se supo de esa petición, o nulo si nunca se pidió.
  Future<dynamic> leer(String clave) async {
    final filas = await _db.query(
      'cache',
      columns: ['cuerpo'],
      where: 'clave = ?',
      whereArgs: [clave],
      limit: 1,
    );
    if (filas.isEmpty) return null;
    try {
      return jsonDecode('${filas.first['cuerpo']}');
    } catch (_) {
      return null;
    }
  }

  // ---------- La cola de lo escrito ----------

  Future<int> encolar({
    required String metodo,
    required String ruta,
    Object? cuerpo,
    String etiqueta = '',
  }) =>
      _db.insert('cola', {
        'metodo': metodo,
        'ruta': ruta,
        'cuerpo': cuerpo == null ? null : jsonEncode(cuerpo),
        'etiqueta': etiqueta,
        'creado_en': DateTime.now().toUtc().toIso8601String(),
      });

  Future<List<OperacionEnEspera>> pendientes() async {
    final filas = await _db.query('cola', orderBy: 'id');
    return [for (final f in filas) OperacionEnEspera.desdeFila(f)];
  }

  Future<int> cuantasEnEspera() async {
    final fila = await _db.rawQuery('SELECT COUNT(*) AS n FROM cola');
    return (fila.first['n'] as int?) ?? 0;
  }

  Future<void> quitar(int id) => _db.delete('cola', where: 'id = ?', whereArgs: [id]);

  Future<void> anotarIntento(int id, int intentos) => _db.update(
        'cola',
        {'intentos': intentos},
        where: 'id = ?',
        whereArgs: [id],
      );
}

/// Algo que se hizo sin conexión y está esperando para salir.
class OperacionEnEspera {
  const OperacionEnEspera({
    required this.id,
    required this.metodo,
    required this.ruta,
    required this.cuerpo,
    required this.etiqueta,
    required this.creadoEn,
    required this.intentos,
  });

  final int id;
  final String metodo;
  final String ruta;
  final Object? cuerpo;
  final String etiqueta;
  final DateTime? creadoEn;
  final int intentos;

  factory OperacionEnEspera.desdeFila(Map<String, Object?> f) {
    final crudo = f['cuerpo'] as String?;
    return OperacionEnEspera(
      id: f['id'] as int,
      metodo: '${f['metodo']}',
      ruta: '${f['ruta']}',
      cuerpo: crudo == null ? null : jsonDecode(crudo),
      etiqueta: '${f['etiqueta'] ?? ''}',
      creadoEn: DateTime.tryParse('${f['creado_en']}')?.toLocal(),
      intentos: (f['intentos'] as int?) ?? 0,
    );
  }
}
