import 'package:flutter_test/flutter_test.dart';
import 'package:incidencias/nucleo/almacen_local.dart';
import 'package:incidencias/nucleo/conexion.dart';

/// Pruebas del modo sin conexión.
///
/// Lo comprobable sin un teléfono: cuándo se da la línea por caída y por
/// recuperada, que al recuperarla se avise una sola vez, y que dos peticiones
/// distintas no se pisen en la copia local. La base en sí y el banner se ven en
/// el móvil.
void main() {
  setUp(() {
    Conexion.parar();
    Conexion.alVolver = null;
  });

  tearDown(Conexion.parar);

  group('el estado de la conexión', () {
    test('empieza dando por buena la línea', () {
      expect(Conexion.hayRed.value, isTrue);
    });

    test('un fallo la baja y un acierto la sube', () {
      Conexion.fallo();
      expect(Conexion.hayRed.value, isFalse);

      Conexion.exito();
      expect(Conexion.hayRed.value, isTrue);
    });

    test('al volver la línea se avisa una sola vez', () async {
      var veces = 0;
      Conexion.alVolver = () async => veces++;

      Conexion.fallo();
      Conexion.exito();
      // Dos aciertos seguidos son lo normal —cada petición que va bien—, y no
      // pueden vaciar la cola dos veces.
      Conexion.exito();
      Conexion.exito();

      await Future<void>.delayed(Duration.zero);
      expect(veces, 1);
    });

    test('estando bien, otro acierto no avisa a nadie', () async {
      var veces = 0;
      Conexion.alVolver = () async => veces++;

      Conexion.exito();
      await Future<void>.delayed(Duration.zero);
      expect(veces, 0);
    });

    test('dos fallos seguidos no cambian nada', () {
      Conexion.fallo();
      Conexion.fallo();
      expect(Conexion.hayRed.value, isFalse);
    });

    test('al cerrar sesión se vuelve al punto de partida', () {
      Conexion.fallo();
      Conexion.enEspera.value = 3;

      Conexion.parar();
      expect(Conexion.hayRed.value, isTrue);
      expect(Conexion.enEspera.value, 0);
    });
  });

  group('la clave de la copia local', () {
    test('una ruta sin filtros es su propia clave', () {
      expect(AlmacenLocal.claveDe('/api/tickets', null), '/api/tickets');
      expect(AlmacenLocal.claveDe('/api/tickets', {}), '/api/tickets');
    });

    test('dos búsquedas distintas no se pisan', () {
      final abiertas = AlmacenLocal.claveDe('/api/tickets', {'estado': 'abierto'});
      final cerradas = AlmacenLocal.claveDe('/api/tickets', {'estado': 'cerrado'});
      expect(abiertas, isNot(cerradas));
    });

    test('el orden de los filtros no cambia la clave', () {
      // Si cambiara, la misma lista se guardaría dos veces y una de las dos
      // quedaría vieja sin que nadie lo notara.
      final unaForma = AlmacenLocal.claveDe('/api/tickets', {'local': 3, 'estado': 'abierto'});
      final otraForma = AlmacenLocal.claveDe('/api/tickets', {'estado': 'abierto', 'local': 3});
      expect(unaForma, otraForma);
    });

    test('los filtros vacíos no cuentan', () {
      // Es lo mismo «sin filtrar» que «con el filtro en blanco», y así lo
      // manda `Api`, que los quita antes de pedir.
      expect(
        AlmacenLocal.claveDe('/api/tickets', {'estado': '', 'local': null}),
        '/api/tickets',
      );
    });
  });

  group('la cola de lo que espera', () {
    test('una fila guardada vuelve a ser la misma operación', () {
      final op = OperacionEnEspera.desdeFila({
        'id': 7,
        'metodo': 'PUT',
        'ruta': '/api/tickets/12',
        'cuerpo': '{"estado":"cerrado","asignado_a":null}',
        'etiqueta': 'Cambios en la incidencia #12',
        'creado_en': '2026-08-28T09:00:00.000Z',
        'intentos': 1,
      });

      expect(op.metodo, 'PUT');
      expect(op.ruta, '/api/tickets/12');
      expect((op.cuerpo as Map)['estado'], 'cerrado');
      // Nulo dentro del cuerpo tiene que sobrevivir: es como se dice «déjalo
      // sin asignar», y perderlo cambiaría lo que hace la operación.
      expect((op.cuerpo as Map).containsKey('asignado_a'), isTrue);
      expect((op.cuerpo as Map)['asignado_a'], isNull);
      expect(op.etiqueta, 'Cambios en la incidencia #12');
      expect(op.intentos, 1);
    });

    test('una operación sin cuerpo también', () {
      final op = OperacionEnEspera.desdeFila({
        'id': 1,
        'metodo': 'DELETE',
        'ruta': '/api/chat/mensajes/3',
        'cuerpo': null,
        'etiqueta': '',
        'creado_en': '2026-08-28T09:00:00.000Z',
        'intentos': 0,
      });
      expect(op.cuerpo, isNull);
      expect(op.metodo, 'DELETE');
    });
  });
}
