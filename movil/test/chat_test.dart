import 'package:flutter_test/flutter_test.dart';
import 'package:incidencias/modelos/chat.dart';

/// Pruebas de los modelos del chat.
///
/// Lo que se comprueba aquí es la traducción en las dos direcciones —del JSON
/// del servidor y de la fila de SQLite—, que es de lo que depende que la copia
/// del teléfono diga lo mismo que el servidor. Lo que necesita un aparato de
/// verdad (la base local, el micrófono, la galería) se prueba en el móvil.
void main() {
  group('mensajes', () {
    test('un mensaje del servidor se lee entero, con sus archivos', () {
      final m = MensajeChat.desdeJson({
        'id': 42,
        'local_id': 3,
        'autor_id': 7,
        'autor_nombre': 'Carmen Vidal',
        'autor_rol': 'empleado',
        'cliente_id': 'abc-123',
        'contenido': 'Se ha ido la luz',
        'creado_en': '2026-08-20 09:30:00',
        'borrado': false,
        'adjuntos': [
          {'id': 5, 'nombre': 'nota-de-voz.m4a', 'tipo': 'audio', 'duracion': 12},
        ],
      });

      expect(m.id, 42);
      expect(m.localId, 3);
      expect(m.contenido, 'Se ha ido la luz');
      expect(m.adjuntos.single.esAudio, isTrue);
      expect(m.adjuntos.single.duracion, 12);
      // El adjunto se queda con el número de su mensaje, que en el JSON no
      // viene: es lo que lo ata al globo donde se pinta.
      expect(m.adjuntos.single.mensajeId, 42);
      expect(m.creadoEn!.toUtc().hour, 9);
    });

    test('un mensaje borrado no enseña ni su texto ni sus archivos', () {
      final m = MensajeChat.desdeJson({
        'id': 9,
        'local_id': 1,
        'autor_id': 2,
        'contenido': '',
        'borrado': true,
        'adjuntos': [],
      });
      expect(m.borrado, isTrue);
      expect(m.resumen, 'Mensaje eliminado');
    });

    test('el resumen dice qué es cuando el mensaje no tiene texto', () {
      MensajeChat conAdjunto(String tipo, String nombre) => MensajeChat(
            id: 1,
            localId: 1,
            autorId: 1,
            autorNombre: 'X',
            clienteId: 'c',
            contenido: '',
            adjuntos: [AdjuntoChat(id: 1, mensajeId: 1, nombre: nombre, tipo: tipo)],
          );

      expect(conAdjunto('imagen', 'foto.jpg').resumen, '📷 Foto');
      expect(conAdjunto('video', 'v.mp4').resumen, '🎬 Vídeo');
      expect(conAdjunto('audio', 'n.m4a').resumen, '🎤 Nota de voz');
      expect(conAdjunto('documento', 'parte.pdf').resumen, '📎 parte.pdf');
    });

    test('el resumen de un mensaje largo cabe en una línea', () {
      final m = MensajeChat(
        id: 1,
        localId: 1,
        autorId: 1,
        autorNombre: 'X',
        clienteId: 'c',
        contenido: 'Primera línea\n  y   segunda',
      );
      expect(m.resumen, 'Primera línea y segunda');
    });

    test('una fila de la copia local vuelve a ser el mismo mensaje', () {
      final original = MensajeChat(
        id: 11,
        localId: 2,
        autorId: 4,
        autorNombre: 'Pablo Nieto',
        autorRol: 'usuario',
        clienteId: 'cli-1',
        contenido: 'Voy para allá',
        creadoEn: DateTime.utc(2026, 8, 20, 9, 30).toLocal(),
      );

      final vuelta = MensajeChat.desdeFila(original.aFila());
      expect(vuelta.id, original.id);
      expect(vuelta.autorNombre, original.autorNombre);
      expect(vuelta.contenido, original.contenido);
      expect(vuelta.clienteId, original.clienteId);
      expect(vuelta.creadoEn!.toUtc(), original.creadoEn!.toUtc());
    });
  });

  group('canales', () {
    test('el canal del servidor trae su último mensaje para la lista', () {
      final c = CanalChat.desdeJson({
        'local_id': 3,
        'nombre': 'LOCAL 2',
        'canal': '#local-2',
        'sin_leer': 4,
        'leido_hasta': 10,
        'recibido_hasta': 12,
        'ultimo': {
          'id': 14,
          'autor_id': 8,
          'autor_nombre': 'Marta Ruiz',
          'creado_en': '2026-08-20 11:00:00',
          'resumen': 'Paso a mirarlo',
        },
      });

      expect(c.canal, '#local-2');
      expect(c.sinLeer, 4);
      expect(c.ultimoId, 14);
      expect(c.ultimoResumen, 'Paso a mirarlo');
    });

    test('un canal sin conversación no trae último mensaje', () {
      final c = CanalChat.desdeJson({
        'local_id': 1,
        'nombre': 'LOCAL 1',
        'canal': '#local-1',
        'ultimo': null,
      });
      expect(c.ultimoId, isNull);
      expect(c.sinLeer, 0);
    });

    test('la fila de la copia local conserva si falta historial por arriba', () {
      final c = CanalChat(
        localId: 5,
        nombre: 'LOCAL 7',
        canal: '#nido',
        hayMasArriba: false,
      );
      final vuelta = CanalChat.desdeFila(c.aFila());
      expect(vuelta.hayMasArriba, isFalse);
      expect(vuelta.nombre, 'LOCAL 7');
    });
  });

  group('la cola de salida', () {
    test('un envío guardado se recupera igual, con sus archivos', () {
      final envio = EnvioPendiente(
        clienteId: 'cli-9',
        localId: 2,
        contenido: 'Mira esto',
        adjuntos: const [4, 5],
        creadoEn: DateTime.utc(2026, 8, 20, 12).toLocal(),
        intentos: 2,
        vista: const [
          AdjuntoChat(id: 4, mensajeId: 0, nombre: 'foto.jpg', tipo: 'imagen'),
          AdjuntoChat(id: 5, mensajeId: 0, nombre: 'nota.m4a', tipo: 'audio', duracion: 8),
        ],
      );

      final vuelta = EnvioPendiente.desdeFila(envio.aFila());
      expect(vuelta.clienteId, 'cli-9');
      expect(vuelta.localId, 2);
      expect(vuelta.contenido, 'Mira esto');
      expect(vuelta.adjuntos, [4, 5]);
      expect(vuelta.intentos, 2);
      expect(vuelta.vista.length, 2);
      expect(vuelta.vista.first.tipo, 'imagen');
      expect(vuelta.vista.first.nombre, 'foto.jpg');
      expect(vuelta.vista.last.duracion, 8);
    });

    test('un envío sin archivos también', () {
      final envio = EnvioPendiente(
        clienteId: 'cli-0',
        localId: 1,
        contenido: 'Solo texto',
        adjuntos: const [],
        creadoEn: DateTime.now(),
      );
      final vuelta = EnvioPendiente.desdeFila(envio.aFila());
      expect(vuelta.adjuntos, isEmpty);
      expect(vuelta.vista, isEmpty);
      expect(vuelta.contenido, 'Solo texto');
    });

    test('un nombre con una barra vertical no rompe la fila', () {
      // Los archivos se guardan en una sola columna, separados; un nombre con
      // el mismo carácter que separa sus campos no puede partirlo.
      final envio = EnvioPendiente(
        clienteId: 'cli-1',
        localId: 1,
        contenido: '',
        adjuntos: const [7],
        creadoEn: DateTime.now(),
        vista: const [
          AdjuntoChat(id: 7, mensajeId: 0, nombre: 'parte|agosto.pdf', tipo: 'documento'),
        ],
      );
      final vuelta = EnvioPendiente.desdeFila(envio.aFila());
      expect(vuelta.vista.single.nombre, 'parte|agosto.pdf');
      expect(vuelta.vista.single.tipo, 'documento');
    });

    test('mientras va de camino se pinta como un mensaje propio', () {
      final envio = EnvioPendiente(
        clienteId: 'cli-2',
        localId: 3,
        contenido: 'Hola',
        adjuntos: const [],
        creadoEn: DateTime.now(),
      );
      final m = envio.comoMensaje(autorId: 9, autorNombre: 'Yo', fallo: true);
      expect(m.pendiente, isTrue);
      expect(m.fallo, isTrue);
      expect(m.id, 0);
      expect(m.autorId, 9);
      expect(m.clienteId, 'cli-2');
    });
  });

  group('acuses', () {
    test('el acuse de otro dice hasta dónde ha llegado', () {
      final l = LecturaAjena.desdeJson({
        'usuario_id': 6,
        'nombre': 'Luis Ortega',
        'recibido_hasta': 20,
        'leido_hasta': 18,
      });
      expect(l.usuarioId, 6);
      expect(l.recibidoHasta, 20);
      expect(l.leidoHasta, 18);

      final vuelta = LecturaAjena.desdeFila(l.aFila(3));
      expect(vuelta.leidoHasta, 18);
      expect(vuelta.nombre, 'Luis Ortega');
    });
  });
}
