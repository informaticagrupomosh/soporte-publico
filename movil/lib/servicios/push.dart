import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../nucleo/api.dart';

/// Notificaciones push.
///
/// Cómo llega un aviso, según dónde esté la app, que es lo que más confunde de
/// FCM:
///
/// - **Cerrada o en segundo plano**: el servidor manda `notification`, así que
///   el aviso lo pinta el propio Android sin arrancar nada de Flutter. Es lo que
///   hace que funcione con la app cerrada, y por eso no depende de que el
///   sistema quiera despertar la aplicación.
/// - **Abierta**: Android no pinta nada —da por hecho que ya lo estás viendo—,
///   así que lo dibuja la app con `flutter_local_notifications`.
///
/// El canal [canalId] tiene que coincidir con tres sitios a la vez: el
/// `channel_id` que manda `notificaciones.js`, el `meta-data` del manifiesto y
/// el canal que se crea aquí. Si alguno se desvía, Android 8 y posteriores se
/// tragan el aviso sin mostrarlo.
class Push {
  static const canalId = 'incidencias_avisos';
  static const _canalNombre = 'Avisos de incidencias';
  static const _canalDescripcion =
      'Incidencias nuevas, mensajes y cambios de estado de lo que te toca.';

  /// Con esto Android junta todos los avisos de la app en un bloque. Los que
  /// pinta el sistema con la app cerrada ya vienen agrupados por incidencia
  /// desde el servidor, con `android.notification.tag`.
  static const _grupo = 'incidencias';

  static final _locales = FlutterLocalNotificationsPlugin();

  static String? _tokenActual;
  static bool _iniciado = false;
  static StreamSubscription<String>? _suscripcionRefresco;

  /// Token de este aparato en Firebase; el servidor lo guarda en `dispositivos`.
  static String? get tokenActual => _tokenActual;

  /// Avisos pulsados que aún no se han abierto. La pantalla de la lista se
  /// suscribe y navega al detalle.
  static final ValueNotifier<int?> ticketPendiente = ValueNotifier(null);

  /// Lo mismo para los avisos del chat: el local cuyo canal hay que abrir.
  static final ValueNotifier<int?> canalPendiente = ValueNotifier(null);

  /// Y para el aviso de que hay un mensaje denunciado, que lleva a la cola de
  /// moderación. No hace falta decir cuál: se atiende la cola entera, no una
  /// denuncia suelta.
  static final ValueNotifier<bool> moderacionPendiente = ValueNotifier(false);

  /// Se llama desde `main()` antes de pintar nada.
  static Future<void> preparar() async {
    if (_iniciado) return;
    _iniciado = true;

    await Firebase.initializeApp();

    // El manejador de segundo plano corre en un isolate aparte, sin acceso a
    // nada de la app: tiene que ser una función de nivel superior.
    FirebaseMessaging.onBackgroundMessage(_enSegundoPlano);

    await _prepararCanal();

    // Con la app delante, el aviso lo pinta la propia app en las dos
    // plataformas. iOS, por su cuenta, también lo pintaría: hay que decirle que
    // no, o el mismo aviso saldría dos veces.
    if (defaultTargetPlatform == TargetPlatform.iOS) {
      await FirebaseMessaging.instance.setForegroundNotificationPresentationOptions(
        alert: false,
        badge: false,
        sound: false,
      );
    }

    // Con la app abierta el aviso lo pinta la propia app.
    FirebaseMessaging.onMessage.listen(_mostrarEnPrimerPlano);

    // App en segundo plano y el usuario pulsa el aviso.
    FirebaseMessaging.onMessageOpenedApp.listen((m) => _abrirTicketDe(m.data));

    // App cerrada del todo: el aviso que la ha abierto llega por aquí, una sola
    // vez. Sin esto, pulsar la notificación abriría la app en la lista.
    final inicial = await FirebaseMessaging.instance.getInitialMessage();
    if (inicial != null) _abrirTicketDe(inicial.data);
  }

  /// Crea el canal y engancha el toque sobre los avisos que pinta la app.
  static Future<void> _prepararCanal() async {
    await _locales.initialize(
      const InitializationSettings(
        android: AndroidInitializationSettings('@drawable/ic_notificacion'),
        iOS: DarwinInitializationSettings(
          // Con la app abierta lo pinta la propia app, igual que en Android.
          requestAlertPermission: false,
          requestBadgePermission: false,
          requestSoundPermission: false,
        ),
      ),
      onDidReceiveNotificationResponse: (respuesta) {
        // El aviso de una incidencia lleva su número; el del chat, «chat:» y el
        // del local. Sin prefijo es una incidencia, como ha sido siempre.
        final carga = respuesta.payload ?? '';
        if (carga == 'moderacion') {
          moderacionPendiente.value = true;
          return;
        }
        if (carga.startsWith('chat:')) {
          canalPendiente.value = int.tryParse(carga.substring(5));
          return;
        }
        final id = int.tryParse(carga);
        if (id != null) ticketPendiente.value = id;
      },
    );

    // Crear el canal es idempotente: repetirlo no cambia lo que el usuario haya
    // ajustado a mano.
    await _locales
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(const AndroidNotificationChannel(
          canalId,
          _canalNombre,
          description: _canalDescripcion,
          importance: Importance.high,
        ));
  }

  /// Pide permiso, consigue el token y lo registra. Se llama al iniciar sesión.
  static Future<void> activar(Api api) => registrarToken(api);

  /// Manda el token a `POST /api/dispositivos` y se queda escuchando por si
  /// Firebase lo cambia, que ocurre al restaurar el móvil o limpiar los datos.
  static Future<void> registrarToken(Api api) async {
    try {
      // El permiso se pide siempre, no solo al iniciar sesión.
      //
      // En Android 13+ y en iOS hay que pedirlo; en Android anterior se concede
      // solo. Pero en iOS hace algo más que preguntar: es lo que registra la app
      // en APNs, y sin ese registro Apple no da ningún token. Al arrancar con la
      // sesión ya guardada nadie lo pedía en esa ejecución, así que el aparato
      // se quedaba sin registrar —y sin avisos— hasta el siguiente inicio de
      // sesión. Volver a pedirlo no molesta a nadie: con el permiso ya decidido,
      // iOS contesta lo que hubiera sin enseñar ningún diálogo.
      final permiso = await FirebaseMessaging.instance.requestPermission(
        alert: true,
        badge: true,
        sound: true,
      );
      // Queda en el registro porque es lo primero que hay que mirar cuando
      // alguien dice que no le llegan avisos: si aquí no pone «authorized», el
      // problema no está en el servidor ni en Firebase.
      debugPrint('Avisos: permiso ${permiso.authorizationStatus.name}.');

      if (!await _apnsListo()) {
        debugPrint(
          'Sin token de APNs tras $_esperaApns: este aparato no puede recibir avisos.',
        );
        return;
      }
      final token = await FirebaseMessaging.instance.getToken();
      if (token == null || token.isEmpty) return;
      await _guardar(api, token);

      await _suscripcionRefresco?.cancel();
      _suscripcionRefresco =
          FirebaseMessaging.instance.onTokenRefresh.listen((nuevo) {
        _guardar(api, nuevo);
      });
    } catch (e) {
      // Un móvil sin Google Play, o sin google-services.json, no puede recibir
      // avisos. La app tiene que seguir funcionando igual.
      debugPrint('No se pudo registrar el dispositivo para avisos: $e');
    }
  }

  /// Espera a que Apple le haya dado su token a Firebase.
  ///
  /// En iOS, pedir el token de Firebase antes de eso falla, y lo que se pierde
  /// es justo el primer arranque de una instalación nueva: el aparato se
  /// quedaría sin registrar y no llegaría ningún aviso hasta la siguiente vez
  /// que alguien entrara.
  ///
  /// Se le da bastante margen —la primera vez, con red lenta, Apple puede
  /// tardar—, y sale barato: nadie espera a esto para ver la primera pantalla.
  /// En el simulador no llega nunca, porque allí Apple no reparte tokens, así
  /// que al final se rinde en vez de aguardar sin fin.
  static const _esperaApns = Duration(seconds: 15);

  static Future<bool> _apnsListo() async {
    if (defaultTargetPlatform != TargetPlatform.iOS) return true;
    for (var intento = 0; intento < _esperaApns.inSeconds; intento += 1) {
      if (await FirebaseMessaging.instance.getAPNSToken() != null) return true;
      await Future<void>.delayed(const Duration(seconds: 1));
    }
    return false;
  }

  static Future<void> _guardar(Api api, String token) async {
    try {
      await api.post('/api/dispositivos', {
        'token_push': token,
        'plataforma': defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android',
      });
      _tokenActual = token;
    } on ErrorApi catch (e) {
      debugPrint('El servidor no aceptó el token del dispositivo: ${e.mensaje}');
    }
  }

  /// Dibuja el aviso cuando la app está delante.
  static Future<void> _mostrarEnPrimerPlano(RemoteMessage mensaje) async {
    final aviso = mensaje.notification;
    if (aviso == null) return;

    final ticketId = int.tryParse('${mensaje.data['ticket_id'] ?? ''}');
    final tipo = '${mensaje.data['tipo'] ?? ''}';
    final esChat = tipo == 'chat';
    final localId = int.tryParse('${mensaje.data['local_id'] ?? ''}');
    // Un mensaje denunciado lleva a la cola; la respuesta a un aviso propio,
    // al canal, que es donde se ve en qué quedó.
    final esModeracion = tipo == 'denuncia';
    final alCanal = tipo == 'denuncia_resuelta' && localId != null;

    await _locales.show(
      // Un aviso por incidencia y otro por canal: los mensajes seguidos del
      // mismo sitio se reemplazan en lugar de apilar diez líneas iguales. Los
      // del chat van en negativo para no chocar con los de las incidencias.
      esChat && localId != null
          ? -localId
          : ticketId ?? DateTime.now().millisecondsSinceEpoch.remainder(100000),
      aviso.title,
      aviso.body,
      NotificationDetails(
        android: AndroidNotificationDetails(
          canalId,
          _canalNombre,
          channelDescription: _canalDescripcion,
          importance: Importance.high,
          priority: Priority.high,
          icon: '@drawable/ic_notificacion',
          // Todos los avisos de la app se agrupan en un solo bloque de la
          // barra, igual que hace el sistema con los que pinta él.
          groupKey: _grupo,
          // El texto largo de un mensaje se lee entero al desplegar el aviso.
          styleInformation: BigTextStyleInformation(aviso.body ?? ''),
        ),
        iOS: const DarwinNotificationDetails(),
      ),
      payload: esModeracion
          ? 'moderacion'
          : (esChat || alCanal) && localId != null
              ? 'chat:$localId'
              : ticketId?.toString(),
    );
  }

  /// A dónde lleva un aviso pulsado: al canal, si es del chat, y a la
  /// incidencia en los demás casos.
  static void _abrirTicketDe(Map<String, dynamic> datos) {
    final tipo = '${datos['tipo'] ?? ''}';
    if (tipo == 'denuncia') {
      moderacionPendiente.value = true;
      return;
    }
    if (tipo == 'chat' || tipo == 'denuncia_resuelta') {
      final localId = int.tryParse('${datos['local_id'] ?? ''}');
      if (localId != null) canalPendiente.value = localId;
      return;
    }
    final id = int.tryParse('${datos['ticket_id'] ?? ''}');
    if (id != null) ticketPendiente.value = id;
  }
}

/// Aviso recibido con la app en segundo plano o cerrada.
///
/// Android ya ha pintado la notificación por su cuenta antes de llegar aquí
/// —el mensaje trae `notification`—, así que no hay que mostrar nada: esto solo
/// existe para que Firebase pueda entregar el mensaje, y es donde iría el
/// trabajo de fondo si algún día hace falta.
@pragma('vm:entry-point')
Future<void> _enSegundoPlano(RemoteMessage mensaje) async {
  await Firebase.initializeApp();
}
