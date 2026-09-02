import 'dart:async';

import 'package:flutter/foundation.dart';

/// Si la app está hablando con el servidor o trabajando sin conexión.
///
/// No se pregunta al sistema si hay wifi: eso dice si el teléfono está
/// enganchado a una red, no si el servidor contesta —y en un local es
/// habitual tener wifi con el router sin línea, o estar en una red que exige
/// pasar por un portal—. Lo que manda aquí es lo único que importa: si la
/// última petición llegó o no.
///
/// Mientras está sin conexión se pregunta cada poco, de modo que en cuanto
/// vuelve la línea la app se entera sola sin que nadie tenga que tocar nada.
class Conexion {
  Conexion._();

  /// Lo que mira el aviso de la parte de arriba de la pantalla.
  static final ValueNotifier<bool> hayRed = ValueNotifier(true);

  /// Cuántas cosas hechas sin conexión están esperando a poder mandarse.
  static final ValueNotifier<int> enEspera = ValueNotifier(0);

  /// Se llama cuando vuelve la conexión, para vaciar la cola y ponerlo todo al
  /// día. Lo pone `Sesion`, que es quien sabe qué hay que refrescar.
  static Future<void> Function()? alVolver;

  /// Cada cuánto se comprueba si ha vuelto la línea. Quince segundos es poco
  /// para quien está esperando y nada para la batería: es una petición
  /// diminuta y solo mientras no hay conexión.
  static const _cada = Duration(seconds: 15);

  static Timer? _sonda;
  static Future<bool> Function()? _comprobar;
  static bool _comprobando = false;

  /// Le da a la conexión la forma de preguntar si el servidor contesta.
  static void vigilarCon(Future<bool> Function() comprobar) {
    _comprobar = comprobar;
  }

  /// Una petición no ha llegado al servidor.
  static void fallo() {
    if (!hayRed.value) return;
    hayRed.value = false;
    _arrancarSonda();
  }

  /// Una petición ha ido bien: hay línea.
  static void exito() {
    _sonda?.cancel();
    _sonda = null;
    if (hayRed.value) return;
    hayRed.value = true;
    // Lo que se hizo sin conexión sale ahora, y detrás se refresca todo.
    unawaited(alVolver?.call() ?? Future<void>.value());
  }

  static void _arrancarSonda() {
    _sonda?.cancel();
    _sonda = Timer.periodic(_cada, (_) => _tantear());
  }

  static Future<void> _tantear() async {
    final comprobar = _comprobar;
    if (comprobar == null || _comprobando) return;
    _comprobando = true;
    try {
      if (await comprobar()) exito();
    } catch (_) {
      // Sigue sin haber línea; se vuelve a mirar en el siguiente turno.
    } finally {
      _comprobando = false;
    }
  }

  /// Al cerrar sesión no queda nada que vigilar.
  static void parar() {
    _sonda?.cancel();
    _sonda = null;
    enEspera.value = 0;
    hayRed.value = true;
  }
}
