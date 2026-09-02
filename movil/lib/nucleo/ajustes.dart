import 'package:shared_preferences/shared_preferences.dart';

/// Dónde vive el servidor.
///
/// No se puede fijar en el código: cada instalación tiene su dominio, y en
/// pruebas se apunta a un portátil de la red local. La primera vez que se abre
/// la app no hay ninguno, y lo primero que se ve es la pantalla que lo pide.
class Ajustes {
  static const _clave = 'servidor';

  static String? _servidor;

  /// La dirección guardada, sin barra final y con esquema. Cadena vacía
  /// mientras no se haya configurado.
  static String get servidor => _servidor ?? '';

  /// Si ya hay servidor. Es lo que decide si la app empieza por la pantalla del
  /// servidor o por la de acceso.
  static bool get configurado => (_servidor ?? '').isNotEmpty;

  /// Solo el nombre de la máquina, para enseñarlo debajo del acceso sin la
  /// morralla del esquema.
  static String get servidorLegible {
    final uri = Uri.tryParse(servidor);
    if (uri == null || uri.host.isEmpty) return servidor;
    return uri.hasPort ? '${uri.host}:${uri.port}' : uri.host;
  }

  static Future<void> cargar() async {
    final prefs = await SharedPreferences.getInstance();
    final guardado = prefs.getString(_clave);
    _servidor = (guardado ?? '').isEmpty ? null : guardado;
  }

  static Future<void> guardarServidor(String valor) async {
    _servidor = normalizar(valor);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_clave, _servidor!);
  }

  /// Vuelve al punto de partida, para cuando hay que apuntar a otro servidor.
  static Future<void> olvidarServidor() async {
    _servidor = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_clave);
  }

  /// Acepta lo que escriba el usuario con prisa: sin esquema, con espacios o
  /// con una barra al final.
  static String normalizar(String valor) {
    var url = valor.trim();
    if (url.isEmpty) return url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://$url';
    }
    while (url.endsWith('/')) {
      url = url.substring(0, url.length - 1);
    }
    return url;
  }

  static bool esValido(String valor) {
    final url = normalizar(valor);
    if (url.isEmpty) return false;
    final uri = Uri.tryParse(url);
    return uri != null && uri.host.isNotEmpty;
  }
}
