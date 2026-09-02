import 'package:flutter/foundation.dart';

/// Por dónde va el arranque, para que la pantalla de carga lo cuente.
///
/// Arrancar toca cuatro cosas que pueden tardar y que no dependen de nosotros:
/// Firebase, el llavero del sistema, los enlaces y el servidor. Cuando alguna
/// se demora, una pantalla quieta no distingue «espera un momento» de «esto se
/// ha colgado», y eso lo sufre igual quien usa la app que quien la mantiene.
///
/// Es lo más simple que sirve: un texto que se cambia según se va avanzando.
/// Nada de porcentajes, que serían inventados — no hay forma de saber cuánto
/// falta cuando lo que se espera es una respuesta ajena.
class Arranque {
  Arranque._();

  static final paso = ValueNotifier<String>('Abriendo…');
}
