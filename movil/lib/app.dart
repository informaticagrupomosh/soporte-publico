import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'nucleo/sesion.dart';
import 'nucleo/tema.dart';
import 'pantallas/acceso.dart';
import 'pantallas/cargando.dart';
import 'pantallas/chat_canal.dart';
import 'pantallas/detalle.dart';
import 'pantallas/lista.dart';
import 'pantallas/servidor.dart';
import 'servicios/enlaces.dart';
import 'widgets/banner_conexion.dart';
import 'servicios/push.dart';

/// Da acceso a la sesión desde cualquier pantalla sin traer un gestor de estado
/// entero: la app tiene un solo objeto compartido.
class SesionScope extends InheritedNotifier<Sesion> {
  const SesionScope({super.key, required Sesion sesion, required super.child})
      : super(notifier: sesion);

  static Sesion de(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<SesionScope>();
    assert(scope != null, 'Falta un SesionScope por encima');
    return scope!.notifier!;
  }
}

class AppIncidencias extends StatelessWidget {
  const AppIncidencias({super.key, required this.sesion});

  final Sesion sesion;

  @override
  Widget build(BuildContext context) {
    return SesionScope(
      sesion: sesion,
      child: MaterialApp(
        title: 'Incidencias',
        debugShowCheckedModeBanner: false,
        // Toda la app va en castellano, también lo que pinta Flutter por su
        // cuenta: el calendario, los menús de copiar y pegar y los diálogos.
        locale: const Locale('es'),
        supportedLocales: const [Locale('es')],
        localizationsDelegates: const [
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        theme: Tema.claro,
        navigatorKey: _navegador,
        // La franja de «sin conexión» envuelve la aplicación entera, así que
        // sale igual en cualquier pantalla, también en las que se abren encima.
        builder: (context, hijo) => ConTiraDeConexion(hijo: hijo ?? const SizedBox()),
        home: _Raiz(sesion: sesion),
      ),
    );
  }
}

final _navegador = GlobalKey<NavigatorState>();

/// Enseña el acceso o la lista según haya sesión, y abre la incidencia cuando
/// se ha pulsado un aviso.
class _Raiz extends StatefulWidget {
  const _Raiz({required this.sesion});

  final Sesion sesion;

  @override
  State<_Raiz> createState() => _RaizState();
}

class _RaizState extends State<_Raiz> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    Push.ticketPendiente.addListener(_abrirPendiente);
    Enlaces.ticketPendiente.addListener(_abrirPendiente);
    Push.canalPendiente.addListener(_abrirCanalPendiente);
    // Un aviso pulsado con la app cerrada ya está esperando aquí.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _abrirPendiente();
      _abrirCanalPendiente();
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    Push.ticketPendiente.removeListener(_abrirPendiente);
    Enlaces.ticketPendiente.removeListener(_abrirPendiente);
    Push.canalPendiente.removeListener(_abrirCanalPendiente);
    super.dispose();
  }

  /// El chat se mantiene al día con la app delante y se calla cuando se va al
  /// fondo. Va aquí y no en la pantalla del chat porque los mensajes tienen que
  /// entrar —y contarse en el menú— se esté donde se esté.
  @override
  void didChangeAppLifecycleState(AppLifecycleState estado) {
    if (!widget.sesion.dentro) return;
    if (estado == AppLifecycleState.resumed) {
      widget.sesion.alReanudar();
      // Puede haber vuelto la cobertura con la app dormida, y el reloj que lo
      // vigila no corre en segundo plano.
      widget.sesion.comprobarConexion();
    } else if (estado == AppLifecycleState.paused) {
      widget.sesion.alDormirse();
    }
  }

  /// Abre el canal de un aviso de chat. Como con las incidencias, si todavía no
  /// hay sesión se queda anotado y se abre en cuanto se entra.
  void _abrirCanalPendiente() {
    final localId = Push.canalPendiente.value;
    if (localId == null) return;
    if (!widget.sesion.dentro) return;
    Push.canalPendiente.value = null;
    _navegador.currentState?.push(
      MaterialPageRoute(builder: (_) => PantallaCanal(localId: localId)),
    );
  }

  /// Abre la incidencia del aviso. Si aún no hay sesión no se pierde: se queda
  /// anotada y se abre en cuanto se entra.
  void _abrirPendiente() {
    // Puede venir de un aviso push o de un enlace de un correo: los dos acaban
    // en lo mismo, abrir esa incidencia.
    final id = Push.ticketPendiente.value ?? Enlaces.ticketPendiente.value;
    if (id == null) return;

    if (!widget.sesion.dentro) return;

    Push.ticketPendiente.value = null;
    Enlaces.ticketPendiente.value = null;
    _navegador.currentState?.push(
      MaterialPageRoute(builder: (_) => DetalleTicket(ticketId: id)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final sesion = SesionScope.de(context);

    if (sesion.arrancando) return const PantallaCargando();

    // Recién instalada no se sabe contra qué servidor va: es lo primero.
    if (!sesion.servidorConfigurado) return const PantallaServidor();

    if (!sesion.dentro) return const PantallaAcceso();

    // Al entrar puede haber quedado un aviso pendiente de la pantalla anterior.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _abrirPendiente();
      _abrirCanalPendiente();
    });
    return const ListaTickets();
  }
}
