import 'package:flutter/material.dart';

import '../nucleo/tema.dart';

/// Superficie blanca con borde gris, como las tarjetas del back office.
///
/// No usa `Card` a propósito: el tipo de `ThemeData.cardTheme` cambió entre
/// versiones de Flutter, y así el aspecto no depende de con cuál se compile.
///
/// Sí es un `Material`, y no el `Container` que parecería más simple: lo que
/// va dentro muchas veces se pulsa, y la onda del toque se pinta sobre el
/// `Material` más cercano. Con un `Container` de por medio esa onda quedaba
/// tapada por el fondo blanco de la tarjeta —Flutter llega a avisarlo con una
/// excepción— y pulsar no daba ninguna señal.
class Tarjeta extends StatelessWidget {
  const Tarjeta({super.key, required this.child, this.recortar = false});

  final Widget child;

  /// Para lo que se sale de las esquinas, como una lista plegable.
  final bool recortar;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      clipBehavior: recortar ? Clip.antiAlias : Clip.none,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: const BorderSide(color: Tema.borde),
      ),
      child: child,
    );
  }
}
