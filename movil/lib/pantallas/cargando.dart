import 'package:flutter/material.dart';

import '../nucleo/arranque.dart';
import '../nucleo/tema.dart';

/// Lo que se ve mientras la app arranca.
///
/// El nombre de la aplicación y el paso en el que va. Ese texto no es adorno:
/// el arranque espera a Firebase, al llavero y al servidor, y cuando alguno
/// tarda, saber a cuál se está esperando es la diferencia entre tener
/// paciencia y dar la app por rota.
class PantallaCargando extends StatelessWidget {
  const PantallaCargando({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.warning_amber_rounded, size: 56, color: Tema.azul),
                const SizedBox(height: 12),
                const Text(
                  'Incidencias',
                  style: TextStyle(fontSize: 26, fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 44),
                const SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
                const SizedBox(height: 18),
                ValueListenableBuilder<String>(
                  valueListenable: Arranque.paso,
                  builder: (_, paso, __) => Text(
                    paso,
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 13.5, color: Tema.gris),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
