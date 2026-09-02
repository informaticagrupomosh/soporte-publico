import 'package:flutter/material.dart';

/// Lo que hay que dejar libre al final de una pantalla para que su último
/// elemento no acabe debajo de la barra de botones del sistema.
///
/// Muchos Android no usan gestos sino tres botones en una barra que se come el
/// borde inferior: ahí, un «Guardar» pegado al final queda tapado y no hay
/// forma de pulsarlo. `viewPadding` es lo que ocupa esa barra, y a diferencia
/// de `padding` no se pone a cero al abrirse el teclado, así que en una lista
/// que se desplaza siempre sobra sitio, nunca falta.
///
/// Se suma al margen que ya tuviera la lista:
///
/// ```dart
/// padding: EdgeInsets.fromLTRB(12, 12, 12, 90 + margenSistema(context))
/// ```
double margenSistema(BuildContext context) =>
    MediaQuery.of(context).viewPadding.bottom;

/// Mismo lenguaje visual que el back office del grupo: fondo claro, superficies
/// blancas, gris para lo secundario y el azul de Bootstrap como color de acento.
class Tema {
  static const azul = Color(0xFF0D6EFD);
  static const rojo = Color(0xFFDC3545);
  static const ambar = Color(0xFFFD7E14);
  static const verde = Color(0xFF198754);
  static const gris = Color(0xFF6C757D);
  static const grisClaro = Color(0xFFF1F3F5);
  static const borde = Color(0xFFDEE2E6);

  /// Color con el que se marca cada prioridad. El urgente solo tira de rojo
  /// mientras la incidencia sigue viva: una cerrada ya no corre prisa.
  static Color dePrioridad(String prioridad, {bool cerrado = false}) {
    if (cerrado) return gris;
    switch (prioridad) {
      case 'urgente':
        return rojo;
      case 'cuando_se_pueda':
        return gris;
      default:
        return azul;
    }
  }

  static Color deEstado(String estado) {
    switch (estado) {
      case 'abierto':
        return azul;
      case 'pendiente':
        return ambar;
      default:
        return gris;
    }
  }

  static ThemeData get claro {
    final base = ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(seedColor: azul, brightness: Brightness.light),
    );
    return base.copyWith(
      scaffoldBackgroundColor: const Color(0xFFF8F9FA),
      appBarTheme: const AppBarTheme(
        backgroundColor: Colors.white,
        foregroundColor: Color(0xFF212529),
        elevation: 0,
        scrolledUnderElevation: 1,
        surfaceTintColor: Colors.white,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: Colors.white,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: borde),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: borde),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(48),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        ),
      ),
      dividerTheme: const DividerThemeData(color: borde, space: 1, thickness: 1),
    );
  }
}
