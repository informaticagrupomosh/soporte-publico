import 'package:flutter/material.dart';

import '../nucleo/conexion.dart';
import '../nucleo/tema.dart';

/// La franja de «trabajando sin conexión».
///
/// Va pegada arriba, encima de la barra de cualquier pantalla, y **empuja** el
/// contenido en vez de taparlo: la app entera baja esos pocos píxeles mientras
/// no hay línea. Un aviso que tapase algo sería peor que no avisar, y uno que
/// se pudiera cerrar dejaría a alguien mandando cosas sin saber que no salen.
///
/// Se envuelve la aplicación entera desde `MaterialApp.builder`, así que
/// aparece igual en la lista, en una ficha o en el chat, sin que ninguna
/// pantalla tenga que acordarse de ponerlo.
class ConTiraDeConexion extends StatelessWidget {
  const ConTiraDeConexion({super.key, required this.hijo});

  final Widget hijo;

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Conexion.hayRed,
      builder: (context, hayRed, _) {
        if (hayRed) return hijo;
        return Material(
          color: Tema.rojo,
          child: Column(
            children: [
              // Debajo de la hora y la batería: la franja ocupa el hueco de la
              // barra de estado y el resto de la app ya no tiene que dejarlo.
              const SafeArea(bottom: false, child: _TiraSinConexion()),
              Expanded(
                child: MediaQuery.removePadding(
                  context: context,
                  removeTop: true,
                  child: hijo,
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _TiraSinConexion extends StatelessWidget {
  const _TiraSinConexion();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: Tema.rojo,
      padding: const EdgeInsets.symmetric(vertical: 3, horizontal: 12),
      child: ValueListenableBuilder<int>(
        valueListenable: Conexion.enEspera,
        builder: (context, enEspera, _) {
          return Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.cloud_off, size: 13, color: Colors.white),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  enEspera == 0
                      ? 'Trabajando sin conexión'
                      : 'Trabajando sin conexión · $enEspera '
                          '${enEspera == 1 ? 'cosa' : 'cosas'} por enviar',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

/// El aviso de que algo se ha guardado para mandarlo luego.
///
/// Lo usan las pantallas cuando una acción se queda en la cola, para que quede
/// claro que no se ha perdido: la franja de arriba dice que no hay línea, y
/// esto dice qué ha pasado con lo que se acaba de hacer.
void avisarEncolado(BuildContext context, String que) {
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(
    content: Text('$que se enviará cuando vuelva la conexión.'),
    behavior: SnackBarBehavior.floating,
  ));
}
