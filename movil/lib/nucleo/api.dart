import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import 'ajustes.dart';
import 'almacen_local.dart';
import 'conexion.dart';

/// Error con el texto que ya manda el servidor, que está escrito para leerse.
class ErrorApi implements Exception {
  ErrorApi(this.mensaje, {this.estado = 0});

  final String mensaje;
  final int estado;

  /// La sesión ha caducado o la ha cerrado un administrador.
  bool get sesionCaducada => estado == 401;

  /// No se ha llegado al servidor.
  ///
  /// Es la diferencia que lo sostiene todo: «no hay línea» y «tu sesión ya no
  /// vale» se parecen desde fuera y no tienen nada que ver. Confundirlas es lo
  /// que hacía que abrir la app sin cobertura echara a la pantalla de acceso.
  bool get esDeRed => estado == 0;

  @override
  String toString() => mensaje;
}

/// Cliente de la API de incidencias.
///
/// La web se identifica con una cookie, pero la app usa la cabecera
/// `Authorization: Bearer`, que es lo que `POST /api/login` devuelve para esto.
class Api {
  Api({http.Client? cliente}) : _cliente = cliente ?? http.Client();

  final http.Client _cliente;
  String? _token;

  /// Se llama cuando el servidor rechaza la sesión, para que la app vuelva al
  /// acceso sin que cada pantalla tenga que comprobarlo.
  void Function()? alCaducarSesion;

  String? get token => _token;
  set token(String? valor) => _token = valor;

  /// Comprueba que en esa dirección contesta *esta* aplicación, antes de
  /// guardarla.
  ///
  /// Se pregunta por `GET /api/session` sin sesión: el servidor responde 401
  /// con un JSON. Sirve para las dos dudas de golpe —si se llega y si es el
  /// sitio correcto—, y así una dirección mal escrita se ve en el momento y no
  /// más tarde disfrazada de «usuario o contraseña incorrectos».
  static Future<void> comprobarServidor(String direccion) async {
    final url = Ajustes.normalizar(direccion);
    final uri = Uri.tryParse('$url/api/session');
    if (uri == null || uri.host.isEmpty) {
      throw ErrorApi('La dirección no es válida.');
    }

    http.Response res;
    try {
      res = await http
          .get(uri, headers: {'Accept': 'application/json'})
          .timeout(const Duration(seconds: 15));
    } on SocketException {
      throw ErrorApi('No se llega a $url. Comprueba la dirección y la conexión.');
    } on HttpException {
      throw ErrorApi('No se llega a $url. Comprueba la dirección y la conexión.');
    } catch (e) {
      throw ErrorApi('No se ha podido conectar con $url.');
    }

    // 401 es la respuesta buena: hay servidor y pide sesión, que es justo lo
    // que tiene que contestar sin haber entrado todavía.
    if (res.statusCode == 401 || res.statusCode == 200) {
      try {
        jsonDecode(res.body);
        return;
      } catch (_) {
        // Contesta algo, pero no es JSON: será otra cosa, no la aplicación.
      }
    }
    throw ErrorApi(
      'En $url responde algo, pero no es la aplicación de incidencias.',
    );
  }

  Uri _url(String ruta, [Map<String, dynamic>? query]) {
    final limpio = query?..removeWhere((_, v) => v == null || v == '');
    return Uri.parse('${Ajustes.servidor}$ruta').replace(
      queryParameters: (limpio == null || limpio.isEmpty)
          ? null
          : limpio.map((k, v) => MapEntry(k, '$v')),
    );
  }

  Map<String, String> get _cabeceras => {
        'Accept': 'application/json',
        if (_token != null) 'Authorization': 'Bearer $_token',
      };

  /// Una lectura.
  ///
  /// Lo que contesta el servidor se guarda en la copia del teléfono, y si no
  /// hay línea se sirve de ahí: la app enseña lo último que sabía en vez de un
  /// error. Solo cuando no hay ni copia se propaga el fallo.
  ///
  /// `sinCopia` es para lo que no tiene sentido guardar —comprobar si el
  /// servidor contesta— ni servir de ayer.
  Future<dynamic> get(
    String ruta, [
    Map<String, dynamic>? query,
    bool sinCopia = false,
  ]) async {
    final clave = AlmacenLocal.claveDe(ruta, query);
    try {
      final datos = await _pedir(() => _cliente.get(_url(ruta, query), headers: _cabeceras));
      if (!sinCopia) {
        final almacen = await AlmacenLocal.abrir();
        await almacen.guardar(clave, datos);
      }
      return datos;
    } on ErrorApi catch (e) {
      if (!e.esDeRed) rethrow;
      if (sinCopia) rethrow;
      final almacen = await AlmacenLocal.abrir();
      final guardado = await almacen.leer(clave);
      if (guardado != null) return guardado;
      rethrow;
    }
  }

  /// Lo que se marca como encolable y se hace sin conexión: se anota y sale
  /// solo cuando vuelve la línea. Quien lo pide lo reconoce por esta clave.
  static const claveEncolado = 'encolado';

  /// Una escritura.
  ///
  /// Con `encolar` puesto, lo que no se puede mandar ahora se anota y sale al
  /// volver la conexión; la respuesta es entonces `{encolado: true}`. Sin él,
  /// un fallo de red es un fallo y quien llama se entera — que es lo que hace
  /// falta cuando la respuesta importa, como al crear una incidencia y abrirla.
  Future<dynamic> post(
    String ruta, [
    Object? cuerpo,
    bool encolar = false,
    String etiqueta = '',
  ]) =>
      _escribir('POST', ruta, cuerpo, encolar, etiqueta);

  /// Un POST de los de entrar, donde todavía no hay sesión que pueda caducar.
  ///
  /// Ahí un 401 es lo que diga el servidor —la contraseña que no es, el vale de
  /// Office 365 gastado— y no una sesión rechazada, así que se enseña su texto
  /// en vez de «la sesión ha caducado», que no vendría a cuento.
  Future<dynamic> postSinSesion(String ruta, [Object? cuerpo]) => _pedir(
        () => _cliente.post(
          _url(ruta),
          headers: {..._cabeceras, 'Content-Type': 'application/json'},
          body: jsonEncode(cuerpo ?? {}),
        ),
        sesionCaduca: false,
      );

  Future<dynamic> put(
    String ruta, [
    Object? cuerpo,
    bool encolar = false,
    String etiqueta = '',
  ]) =>
      _escribir('PUT', ruta, cuerpo, encolar, etiqueta);

  Future<dynamic> delete(
    String ruta, [
    Object? cuerpo,
    bool encolar = false,
    String etiqueta = '',
  ]) =>
      _escribir('DELETE', ruta, cuerpo, encolar, etiqueta);

  Future<http.Response> _mandar(String metodo, String ruta, Object? cuerpo) {
    final url = _url(ruta);
    final cabeceras = {..._cabeceras, 'Content-Type': 'application/json'};
    final json = jsonEncode(cuerpo ?? {});
    switch (metodo) {
      case 'PUT':
        return _cliente.put(url, headers: cabeceras, body: json);
      case 'DELETE':
        return _cliente.delete(url, headers: cabeceras, body: json);
      default:
        return _cliente.post(url, headers: cabeceras, body: json);
    }
  }

  Future<dynamic> _escribir(
    String metodo,
    String ruta,
    Object? cuerpo,
    bool encolar,
    String etiqueta,
  ) async {
    try {
      final datos = await _pedir(() => _mandar(metodo, ruta, cuerpo));
      return datos;
    } on ErrorApi catch (e) {
      if (!e.esDeRed) rethrow;
      if (!encolar) rethrow;
      final almacen = await AlmacenLocal.abrir();
      await almacen.encolar(
        metodo: metodo,
        ruta: ruta,
        cuerpo: cuerpo,
        etiqueta: etiqueta,
      );
      Conexion.enEspera.value = await almacen.cuantasEnEspera();
      return {claveEncolado: true};
    }
  }

  /// Cuántas veces se le insiste a algo que el servidor no acepta por un fallo
  /// suyo. Un 500 puede ser de un momento; tres seguidos, no.
  static const _intentosMaximos = 3;

  /// Manda lo que se hizo sin conexión, en el mismo orden en que se hizo.
  ///
  /// El orden importa —dos cambios de estado seguidos no dan igual del revés—,
  /// así que en cuanto una no puede salir se para y las de detrás esperan.
  ///
  /// Lo que el servidor rechaza por lo que dice la operación (un 4xx: ya no se
  /// ve esa incidencia, el mensaje va vacío) se tira: repetirlo no lo arregla
  /// y atascaría el resto para siempre. Un fallo del servidor (5xx) sí se
  /// reintenta unas cuantas veces, que puede ser cosa de un momento, y lo que
  /// es un fallo de red deja la cola como estaba para la próxima.
  Future<int> vaciarCola() async {
    final almacen = await AlmacenLocal.abrir();
    var hechas = 0;
    for (final op in await almacen.pendientes()) {
      try {
        await _pedir(() => _mandar(op.metodo, op.ruta, op.cuerpo));
        await almacen.quitar(op.id);
        hechas++;
      } on ErrorApi catch (e) {
        if (e.esDeRed) break;
        if (e.estado >= 400 && e.estado < 500) {
          await almacen.quitar(op.id);
          continue;
        }
        if (op.intentos + 1 >= _intentosMaximos) {
          await almacen.quitar(op.id);
          continue;
        }
        await almacen.anotarIntento(op.id, op.intentos + 1);
        break;
      }
    }
    Conexion.enEspera.value = await almacen.cuantasEnEspera();
    return hechas;
  }

  /// Sube un archivo como borrador, antes de que exista la incidencia o el
  /// mensaje del que va a colgar.
  ///
  /// Devuelve `{id, nombre, tipo}`. Ese `id` se manda luego al crear la
  /// incidencia o el mensaje, y es entonces cuando pasa a ser un adjunto de
  /// verdad. Así no llega a existir una incidencia cuya foto se quedó a medias.
  Future<Map<String, dynamic>> subirBorrador(String nombre, List<int> bytes) async {
    final datos = await _pedir(() => _cliente.post(
          _url('/api/adjuntos/borrador', {'nombre': nombre}),
          headers: {..._cabeceras, 'Content-Type': 'application/octet-stream'},
          body: bytes,
        ));
    return (datos as Map).cast<String, dynamic>();
  }

  /// Tira un borrador que al final no se va a mandar.
  Future<void> descartarBorrador(int id) async {
    try {
      await delete('/api/adjuntos/borrador/$id');
    } on ErrorApi {
      // Si no se puede, el servidor lo barre solo a las veinticuatro horas.
    }
  }

  /// Sube unos bytes en crudo, como la foto de un activo del inventario: a
  /// diferencia de un adjunto de incidencia, esta va directa al recurso que ya
  /// existe (el activo), no a un borrador.
  Future<dynamic> subirRaw(String ruta, String nombre, List<int> bytes) =>
      _pedir(() => _cliente.post(
            _url(ruta, {'nombre': nombre}),
            headers: {..._cabeceras, 'Content-Type': 'application/octet-stream'},
            body: bytes,
          ));

  /// Envuelve toda petición: traduce los fallos de red y los errores del
  /// servidor a un `ErrorApi` con un texto presentable.
  Future<dynamic> _pedir(
    Future<http.Response> Function() peticion, {
    bool sesionCaduca = true,
  }) async {
    http.Response res;
    try {
      res = await peticion().timeout(const Duration(seconds: 30));
    } on SocketException {
      Conexion.fallo();
      throw ErrorApi('No se llega al servidor. Comprueba la conexión.');
    } on HttpException {
      Conexion.fallo();
      throw ErrorApi('No se llega al servidor. Comprueba la conexión.');
    } catch (e) {
      Conexion.fallo();
      throw ErrorApi('No se ha podido conectar con el servidor.');
    }
    // Ha contestado, aunque sea para decir que no: hay línea. Da igual con qué
    // código —un 403 también demuestra que se llegó—, y aquí pasan todas las
    // peticiones, también las de los archivos.
    Conexion.exito();

    // El cuerpo puede no ser JSON si delante hay un proxy que devuelve su
    // propia página de error.
    dynamic datos;
    try {
      datos = res.body.isEmpty ? null : jsonDecode(res.body);
    } catch (_) {
      datos = null;
    }

    if (res.statusCode >= 200 && res.statusCode < 300) return datos;

    if (res.statusCode == 401 && sesionCaduca) {
      alCaducarSesion?.call();
      throw ErrorApi('La sesión ha caducado. Vuelve a entrar.', estado: 401);
    }

    final mensaje = (datos is Map && datos['error'] is String)
        ? datos['error'] as String
        : 'El servidor ha respondido ${res.statusCode}.';
    throw ErrorApi(mensaje, estado: res.statusCode);
  }

  /// URL de un adjunto, para el visor de imágenes y el reproductor de vídeo:
  /// los dos saben mandar cabeceras, así que van directos.
  Uri urlAdjunto(int id) => Uri.parse('${Ajustes.servidor}/api/adjuntos/$id');

  /// La foto de un activo del inventario, con las mismas cabeceras que un
  /// adjunto.
  Uri urlFotoActivo(int id) => Uri.parse('${Ajustes.servidor}/api/activos/$id/foto');

  Map<String, String> get cabecerasAdjunto =>
      {if (_token != null) 'Authorization': 'Bearer $_token'};

  // ---------- Chat de local ----------

  /// Sube un archivo del chat como borrador, antes de que exista el mensaje que
  /// lo lleva.
  ///
  /// `duracion` son los segundos de una nota de voz o un vídeo: los mide quien
  /// graba, y con ellos el globo puede decir cuánto dura sin que nadie haya
  /// descargado el archivo.
  Future<Map<String, dynamic>> subirBorradorChat(
    String nombre,
    List<int> bytes, {
    int? duracion,
  }) async {
    final datos = await _pedir(() => _cliente.post(
          _url('/api/chat/borradores', {'nombre': nombre, 'duracion': duracion}),
          headers: {..._cabeceras, 'Content-Type': 'application/octet-stream'},
          body: bytes,
        ));
    return (datos as Map).cast<String, dynamic>();
  }

  Uri urlAdjuntoChat(int id) => Uri.parse('${Ajustes.servidor}/api/chat/adjuntos/$id');

  /// Abre el flujo de eventos del chat.
  ///
  /// Se devuelve la respuesta sin consumir para que quien la pide vaya leyendo
  /// el cuerpo según llega: es una respuesta que no termina nunca. El cliente
  /// es propio y no el compartido, porque cerrarlo es la única forma de cortar
  /// el flujo cuando la app pasa a segundo plano.
  Future<http.StreamedResponse> abrirFlujoChat(http.Client cliente) {
    final peticion = http.Request('GET', Uri.parse('${Ajustes.servidor}/api/chat/flujo'));
    peticion.headers.addAll({..._cabeceras, 'Accept': 'text/event-stream'});
    return cliente.send(peticion);
  }

  /// Los bytes de un archivo del chat.
  ///
  /// Con su propio cliente para poder cortar la descarga: en una conversación
  /// se pasa por delante de muchas fotos, y las que ya no están en pantalla no
  /// tienen por qué seguir gastando la red del local.
  Future<List<int>> descargarAdjuntoChat(int id, {http.Client? cliente}) async {
    final suyo = cliente ?? _cliente;
    final res = await suyo.get(urlAdjuntoChat(id), headers: cabecerasAdjunto);
    if (res.statusCode == 401) {
      alCaducarSesion?.call();
      throw ErrorApi('La sesión ha caducado. Vuelve a entrar.', estado: 401);
    }
    if (res.statusCode != 200) {
      throw ErrorApi('El archivo ya no está disponible.', estado: res.statusCode);
    }
    return res.bodyBytes;
  }

  /// Los bytes de un adjunto.
  ///
  /// Los documentos los abre otra aplicación, y esa no tiene la sesión: hay que
  /// traérselos por aquí y dejarlos en un archivo, o el visor recibiría un 401.
  Future<List<int>> descargarAdjunto(int id) async {
    http.Response res;
    try {
      res = await _cliente
          .get(urlAdjunto(id), headers: cabecerasAdjunto)
          .timeout(const Duration(seconds: 60));
    } catch (e) {
      throw ErrorApi('No se ha podido descargar el adjunto.');
    }
    if (res.statusCode == 401) {
      alCaducarSesion?.call();
      throw ErrorApi('La sesión ha caducado. Vuelve a entrar.', estado: 401);
    }
    if (res.statusCode != 200) {
      throw ErrorApi('El adjunto ya no está disponible.', estado: res.statusCode);
    }
    return res.bodyBytes;
  }
}
