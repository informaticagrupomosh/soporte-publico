import 'package:flutter/material.dart';

import '../nucleo/formato.dart';
import '../nucleo/tema.dart';

/// Distintivo de color con el texto de un estado o una prioridad.
class Distintivo extends StatelessWidget {
  const Distintivo({super.key, required this.texto, required this.color, this.suave = true});

  final String texto;
  final Color color;
  final bool suave;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: suave ? color.withOpacity(0.12) : color,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: suave ? color.withOpacity(0.3) : color),
      ),
      child: Text(
        texto,
        style: TextStyle(
          fontSize: 11.5,
          fontWeight: FontWeight.w600,
          color: suave ? color : Colors.white,
        ),
      ),
    );
  }
}

class DistintivoEstado extends StatelessWidget {
  const DistintivoEstado(this.estado, {super.key});

  final String estado;

  @override
  Widget build(BuildContext context) =>
      Distintivo(texto: etiquetaEstado(estado), color: Tema.deEstado(estado));
}

class DistintivoPrioridad extends StatelessWidget {
  const DistintivoPrioridad(this.prioridad, {super.key, this.cerrado = false});

  final String prioridad;
  final bool cerrado;

  @override
  Widget build(BuildContext context) {
    final color = Tema.dePrioridad(prioridad, cerrado: cerrado);
    return Distintivo(
      texto: etiquetaPrioridad(prioridad),
      color: color,
      // El urgente vivo se ve de lejos: es lo que hay que atender primero.
      suave: !(prioridad == 'urgente' && !cerrado),
    );
  }
}

/// De quién es el turno. Lo calcula el servidor para quien mira, así que la
/// misma incidencia sale «Nuevo» al técnico y «Esperando respuesta» al
/// empleado que la abrió. El texto además depende de quién mira: [esGestion]
/// dice si es alguien que gestiona incidencias (técnico, gestor o
/// administrador) o quien la reportó. Nada si no hay mensajes o está cerrada.
class DistintivoRespuesta extends StatelessWidget {
  const DistintivoRespuesta(this.respuesta, {super.key, this.esGestion = false});

  final String? respuesta;
  final bool esGestion;

  @override
  Widget build(BuildContext context) {
    switch (respuesta) {
      // Nadie del otro lado ha contestado todavía: solo le pasa al técnico,
      // porque el primer mensaje del hilo siempre lo escribe quien la abre.
      case 'nuevo':
        return const Distintivo(texto: 'Nuevo', color: Tema.rojo, suave: false);
      case 'respondido':
        return esGestion
            ? const Distintivo(texto: 'Esperando tu respuesta', color: Tema.rojo, suave: false)
            : const Distintivo(texto: 'Respondido', color: Tema.verde);
      case 'esperando':
        return Distintivo(
          texto: esGestion ? 'Esperando respuesta de usuario' : 'Esperando respuesta',
          color: Tema.ambar,
        );
      default:
        return const SizedBox.shrink();
    }
  }
}

/// Mensaje centrado para una lista vacía o un fallo, con opción de reintentar.
class Aviso extends StatelessWidget {
  const Aviso({super.key, required this.icono, required this.texto, this.accion, this.etiquetaAccion});

  final IconData icono;
  final String texto;
  final VoidCallback? accion;
  final String? etiquetaAccion;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icono, size: 46, color: Tema.gris),
            const SizedBox(height: 12),
            Text(
              texto,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Tema.gris, fontSize: 14.5),
            ),
            if (accion != null) ...[
              const SizedBox(height: 16),
              OutlinedButton(
                onPressed: accion,
                child: Text(etiquetaAccion ?? 'Reintentar'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
