import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/foundation.dart';

import 'entra.dart';

/// Los enlaces de los correos.
///
/// Un aviso por correo lleva un botón a `…/ticket.html?id=N`. Si el móvil tiene
/// la app instalada, Android se la ofrece —o la abre directamente, si el
/// dominio está verificado— y aquí se saca el número de la incidencia para
/// llevar a quien lo pulsa a la ficha, en vez de dejarlo en la lista.
///
/// Funciona igual con la app cerrada, con el enlace que la arranca, y con la
/// app ya abierta. Por aquí entra también la vuelta de Office 365, que llega
/// por el mismo sitio aunque no sea un enlace de correo.
class Enlaces {
  static final _enlaces = AppLinks();
  static StreamSubscription<Uri>? _suscripcion;

  /// Incidencia pendiente de abrir, igual que la de los avisos push.
  static final ValueNotifier<int?> ticketPendiente = ValueNotifier(null);

  static Future<void> preparar() async {
    // El que ha arrancado la app, si viene de un enlace.
    try {
      final inicial = await _enlaces.getInitialLink();
      if (inicial != null) _leer(inicial);
    } catch (e) {
      debugPrint('No se pudo leer el enlace de arranque: $e');
    }

    // Y los que lleguen con la app ya abierta.
    await _suscripcion?.cancel();
    _suscripcion = _enlaces.uriLinkStream.listen(_leer, onError: (e) {
      debugPrint('Enlace no válido: $e');
    });
  }

  /// Saca la incidencia de `…/ticket.html?id=N`, o el vale de la vuelta de
  /// Office 365. Cualquier otra cosa se ignora: la app se abre en la lista, que
  /// es lo razonable.
  static void _leer(Uri uri) {
    if (Entra.leerVuelta(uri)) return;
    if (!uri.path.contains('ticket.html')) return;
    final id = int.tryParse(uri.queryParameters['id'] ?? '');
    if (id != null) ticketPendiente.value = id;
  }
}
