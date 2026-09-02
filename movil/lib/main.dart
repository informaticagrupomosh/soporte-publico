import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'app.dart';
import 'nucleo/arranque.dart';
import 'nucleo/sesion.dart';
import 'servicios/enlaces.dart';
import 'servicios/push.dart';

/// Cuánto se le espera a cada preparativo antes de pasar al siguiente.
///
/// Un arranque normal no llega ni al segundo; esto es para cuando algo no
/// contesta nunca.
const _espera = Duration(seconds: 5);

/// Un preparativo del arranque, anunciado en la pantalla de carga.
///
/// Pasado el tope se sigue con el siguiente. El preparativo **no se cancela**
/// —en Dart un `timeout` solo deja de aguardar—, así que termina unos segundos
/// después y deja registrado lo suyo igualmente; lo que trae, el aviso o el
/// enlace con el que se abrió la app, viaja por un `ValueNotifier` y quien lo
/// necesita está escuchando, así que llegar tarde no lo pierde.
///
/// Que se atasque no es hipotético: en iOS, Firebase tarda a veces bastante más
/// de la cuenta, y sin este tope el arranque se quedaba ahí.
Future<void> _preparar(String cual, Future<void> Function() hacer) async {
  // En minúscula dentro de la frase; el registro lo escribe como viene, que
  // allí empieza la línea.
  Arranque.paso.value = 'Preparando ${cual.toLowerCase()}…';
  try {
    await hacer().timeout(_espera);
  } on TimeoutException {
    debugPrint('$cual: tardan en prepararse, se sigue sin esperarlos más.');
  } catch (e) {
    debugPrint('$cual: no disponibles ($e).');
  }
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Se pinta antes de preparar nada, y no al revés como estaba.
  //
  // Así, mientras dura el arranque se ve la pantalla de carga diciendo por
  // dónde va; antes se veía la del sistema, en blanco e igual de quieta tardara
  // un segundo o no contestara nunca. Para pintarla no hace falta nada de lo de
  // abajo, y `Sesion` nace diciendo que está arrancando, de modo que la raíz
  // sabe qué enseñar desde el primer fotograma.
  final sesion = Sesion();
  runApp(AppIncidencias(sesion: sesion));

  // Los meses y los días salen en castellano.
  Arranque.paso.value = 'Preparando el idioma…';
  await initializeDateFormatting('es');

  // Cuanto antes se prepare, antes queda recogido el aviso que se haya pulsado
  // con la app cerrada. Sin Firebase configurado la app funciona igual, solo
  // que sin avisos, que es lo que pasa en un móvil sin servicios de Google.
  await _preparar('Los avisos', Push.preparar);

  // Los enlaces de los correos, para abrir la incidencia que toque.
  await _preparar('Los enlaces', Enlaces.preparar);

  await sesion.arrancar();
}
