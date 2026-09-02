import 'package:flutter_test/flutter_test.dart';
import 'package:incidencias/modelos/modelos.dart';
import 'package:incidencias/nucleo/ajustes.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('fechas', () {
    test('una fecha de SQLite se lee como UTC, no como hora local', () {
      // SQLite las guarda «AAAA-MM-DD HH:MM:SS» y sin zona. Si se dieran por
      // locales, un mensaje recién escrito parecería de hace dos horas.
      final fecha = fechaUtc('2026-08-20 09:30:00');
      expect(fecha, isNotNull);
      expect(fecha!.toUtc().hour, 9);
      expect(fecha.toUtc().day, 20);
    });

    test('sin fecha no hay fecha', () {
      expect(fechaUtc(null), isNull);
      expect(fechaUtc(''), isNull);
      expect(fechaUtc('   '), isNull);
    });
  });

  group('dirección del servidor', () {
    test('se le pone el esquema si falta', () {
      expect(Ajustes.normalizar('soporte.ejemplo.com'),
          'https://soporte.ejemplo.com');
    });

    test('se respeta el http de una prueba en la red local', () {
      expect(Ajustes.normalizar('http://192.168.1.40:3004'),
          'http://192.168.1.40:3004');
    });

    test('se quitan los espacios y las barras del final', () {
      expect(Ajustes.normalizar('  https://ejemplo.com//  '), 'https://ejemplo.com');
    });

    test('lo que no es una dirección no vale', () {
      expect(Ajustes.esValido(''), isFalse);
      expect(Ajustes.esValido('   '), isFalse);
      expect(Ajustes.esValido('soporte.ejemplo.com'), isTrue);
    });

    test('recién instalada no hay servidor, y por eso se pregunta', () async {
      SharedPreferences.setMockInitialValues({});
      await Ajustes.cargar();
      expect(Ajustes.configurado, isFalse);
    });

    test('una vez guardado, se recuerda entre arranques', () async {
      SharedPreferences.setMockInitialValues({});
      await Ajustes.cargar();
      await Ajustes.guardarServidor('soporte.ejemplo.com/');

      expect(Ajustes.configurado, isTrue);
      expect(Ajustes.servidor, 'https://soporte.ejemplo.com');

      // Como si se cerrara y se volviera a abrir la app.
      await Ajustes.cargar();
      expect(Ajustes.servidor, 'https://soporte.ejemplo.com');
    });

    test('al olvidarlo se vuelve a preguntar', () async {
      SharedPreferences.setMockInitialValues({});
      await Ajustes.cargar();
      await Ajustes.guardarServidor('ejemplo.com');
      await Ajustes.olvidarServidor();

      expect(Ajustes.configurado, isFalse);
      await Ajustes.cargar();
      expect(Ajustes.configurado, isFalse);
    });

    test('se enseña la máquina, sin la morralla del esquema', () async {
      SharedPreferences.setMockInitialValues({});
      await Ajustes.cargar();

      await Ajustes.guardarServidor('https://soporte.ejemplo.com');
      expect(Ajustes.servidorLegible, 'soporte.ejemplo.com');

      // En pruebas contra un portátil el puerto sí importa.
      await Ajustes.guardarServidor('http://192.168.1.40:3004');
      expect(Ajustes.servidorLegible, '192.168.1.40:3004');
    });
  });

  group('incidencias', () {
    test('se lee lo que manda la API', () {
      final ticket = Ticket.desdeJson({
        'id': 7,
        'titulo': 'No arranca el datáfono',
        'estado': 'abierto',
        'prioridad': 'urgente',
        'grupo_id': 1,
        'grupo_nombre': 'Informática',
        'local_id': 2,
        'local_nombre': 'LOCAL 1',
        'creador_nombre': 'Juan',
        'mensajes': 3,
      });

      expect(ticket.id, 7);
      expect(ticket.urgente, isTrue);
      expect(ticket.cerrado, isFalse);
      expect(ticket.abiertaPor, 'Juan');
      expect(ticket.mensajes, 3);
    });

    test('la que abre el programador enseña el nombre de la tarea', () {
      // `creado_por` va nulo: no la abre ninguna persona.
      final ticket = Ticket.desdeJson({
        'id': 8,
        'titulo': 'Revisión mensual',
        'estado': 'abierto',
        'prioridad': 'normal',
        'grupo_id': 1,
        'grupo_nombre': 'Mantenimiento',
        'local_id': 2,
        'local_nombre': 'LOCAL 1',
        'creado_por': null,
        'creador_nombre': null,
        'tarea_nombre': 'Revisión de extintores',
      });

      expect(ticket.abiertaPor, 'Revisión de extintores');
    });

    test('solo gestionan la incidencia quien atiende o supervisa', () {
      Usuario con(String rol) => Usuario.desdeJson({'id': 1, 'nombre': 'X', 'rol': rol});

      expect(con('empleado').gestiona, isFalse);
      expect(con('tecnico').gestiona, isTrue);
      expect(con('gestor').gestiona, isTrue);
      expect(con('admin').gestiona, isTrue);
    });
  });
}
