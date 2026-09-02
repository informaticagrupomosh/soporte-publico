import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:url_launcher/url_launcher.dart';

import '../nucleo/ajustes.dart';
import '../nucleo/api.dart';

/// Entrar con la cuenta de Office 365 del grupo.
///
/// La identificación no puede hacerse dentro de la app: la sesión de Microsoft
/// y el segundo factor viven en el navegador del teléfono, así que allí se
/// manda a la persona y allí vuelve. Como el token de sesión no puede regresar
/// dentro de una dirección —lo vería el navegador, y con él cualquiera que
/// mirase su historial—, lo que vuelve es un vale de un solo uso que la app
/// canjea hablando ella con el servidor.
///
/// Lo que ata las dos mitades es el verificador: se genera aquí, solo su
/// resumen sale de viaje, y el servidor no acepta el vale sin él. Otra
/// aplicación que se colara en el enlace de vuelta se quedaría con un vale que
/// no puede usar.
class Entra {
  /// El esquema con el que Android devuelve el vale a esta app. Es el mismo
  /// identificador del paquete, para no chocar con el de nadie, y tiene que
  /// coincidir con el enlace de `public/entra-movil.html` y con el
  /// `intent-filter` del manifiesto.
  static const esquema = 'com.ejemplo.soporte';

  // Mismo trato que el token de sesión: cifrado en Android y en el llavero de
  // este aparato en iOS, sin iCloud de por medio.
  static const _almacen = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
    iOptions: IOSOptions(
      accessibility: KeychainAccessibility.first_unlock_this_device,
      synchronizable: false,
    ),
  );
  static const _claveVerificador = 'entra_verificador';

  /// El vale que ha traído el enlace de vuelta, esperando a canjearse. La
  /// pantalla de acceso lo mira al montarse y se queda escuchando: la vuelta
  /// puede llegar con la app abierta o arrancándola.
  static final ValueNotifier<String?> valePendiente = ValueNotifier(null);

  /// Treinta y dos bytes de azar en base64url, sin el relleno: es lo que espera
  /// el servidor y lo que cabe en una dirección sin escapar nada.
  static String _sinRelleno(List<int> bytes) =>
      base64UrlEncode(bytes).replaceAll('=', '');

  static String _verificadorNuevo() {
    final azar = Random.secure();
    return _sinRelleno(List<int>.generate(32, (_) => azar.nextInt(256)));
  }

  static String _reto(String verificador) =>
      _sinRelleno(sha256.convert(utf8.encode(verificador)).bytes);

  /// Si este servidor tiene configurado el acceso con Office 365 **y** sabe
  /// terminar el recorrido de la app.
  ///
  /// Las dos cosas, no solo la primera: contra un servidor anterior a esto, el
  /// botón abriría el navegador, la persona entraría en la web y la app se
  /// quedaría esperando un vale que nadie va a mandar. Sin botón se entiende
  /// mejor lo que falta.
  static Future<bool> disponible(Api api) async {
    try {
      final datos = await api.get('/api/entra/estado');
      return datos is Map && datos['activo'] == true && datos['movil'] == true;
    } on ErrorApi {
      // Un servidor más antiguo todavía no conoce la ruta: sin botón y ya está.
      return false;
    }
  }

  /// Abre el navegador en la entrada de Microsoft.
  ///
  /// El verificador se guarda en el almacén cifrado y no en memoria: mientras
  /// la persona se identifica, Android puede haber matado la app para hacer
  /// sitio, y al volver hay que seguir teniéndolo.
  static Future<void> comenzar() async {
    final verificador = _verificadorNuevo();
    await _almacen.write(key: _claveVerificador, value: verificador);

    final uri = Uri.parse('${Ajustes.servidor}/api/entra/entrar')
        .replace(queryParameters: {'app': _reto(verificador)});
    final abierto = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!abierto) {
      throw ErrorApi('No se ha podido abrir el navegador para entrar con la cuenta corporativa.');
    }
  }

  static Future<String?> verificadorGuardado() =>
      _almacen.read(key: _claveVerificador);

  /// El verificador se gasta con el vale: ni sirve ni tiene por qué quedarse.
  static Future<void> olvidar() => _almacen.delete(key: _claveVerificador);

  /// Reconoce la vuelta y se queda con el vale. Devuelve si el enlace era suyo.
  static bool leerVuelta(Uri uri) {
    if (uri.scheme != esquema || uri.host != 'entra') return false;
    final vale = uri.queryParameters['vale'] ?? '';
    if (vale.isNotEmpty) valePendiente.value = vale;
    return true;
  }
}
