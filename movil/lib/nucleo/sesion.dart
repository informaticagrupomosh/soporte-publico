import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../modelos/modelos.dart';
import '../servicios/chat.dart';
import '../servicios/entra.dart';
import '../servicios/push.dart';
import 'ajustes.dart';
import 'almacen_local.dart';
import 'api.dart';
import 'conexion.dart';
import 'arranque.dart';

/// Quién está dentro y con qué token. De aquí cuelga todo lo demás: la app
/// enseña el acceso o la lista según lo que diga [usuario].
class Sesion extends ChangeNotifier {
  Sesion({Api? api}) : api = api ?? Api() {
    this.api.alCaducarSesion = _sesionRechazada;
    chat = ServicioChat(api: this.api);
    // Cómo se comprueba si ha vuelto la línea, y qué hacer cuando vuelve.
    Conexion.vigilarCon(_servidorContesta);
    Conexion.alVolver = _alVolverLaRed;
  }

  final Api api;

  /// El chat de local: sus canales, su copia en el teléfono y su flujo de
  /// eventos. Vive aquí porque tiene que seguir al día esté abierta la pantalla
  /// del chat o no — el aviso del menú lo saca de aquí.
  late final ServicioChat chat;

  static const _almacen = FlutterSecureStorage(
    // Sin esto, en algunos Android el token sobrevive a la desinstalación
    // dentro de la copia de seguridad automática.
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
    // En iOS el token va al llavero: solo de este aparato —nada de iCloud, que
    // lo repartiría por los demás— y legible desde el primer desbloqueo, que es
    // lo que hace falta para que un aviso pueda despertar la app con el
    // teléfono en el bolsillo.
    iOptions: IOSOptions(
      accessibility: KeychainAccessibility.first_unlock_this_device,
      synchronizable: false,
    ),
  );
  static const _claveToken = 'token_sesion';

  // Marca de que esta instalación ya ha arrancado alguna vez. Vive en las
  // preferencias, que sí desaparecen al desinstalar.
  static const _claveInstalada = 'instalacion_estrenada';

  Usuario? _usuario;
  Meta? _meta;
  bool _arrancando = true;

  Usuario? get usuario => _usuario;
  Meta? get meta => _meta;
  bool get arrancando => _arrancando;
  bool get dentro => _usuario != null;

  /// Si ya se sabe contra qué servidor va la app.
  bool get servidorConfigurado => Ajustes.configurado;

  /// Si este usuario puede abrir incidencias.
  ///
  /// Manda lo que diga `/api/meta`, que es lo que la app pide siempre justo
  /// después de entrar. El usuario del acceso se usa solo de reserva, por si
  /// los desplegables no llegaron a cargar.
  bool get puedeCrear => meta?.puedeCrear ?? usuario?.puedeCrear ?? false;

  /// Guarda la dirección y avisa, para que la raíz pase al acceso.
  Future<void> guardarServidor(String direccion) async {
    await Ajustes.guardarServidor(direccion);
    notifyListeners();
  }

  /// Apuntar a otro servidor. Se cierra lo que hubiera abierto: la sesión no
  /// vale en otra máquina.
  Future<void> cambiarDeServidor() async {
    await _limpiar();
    await Ajustes.olvidarServidor();
    notifyListeners();
  }

  /// Al abrir la app: si hay un token guardado se comprueba contra el servidor.
  /// Así el usuario no vuelve a escribir la contraseña cada mañana — la sesión
  /// dura treinta días.
  Future<void> arrancar() async {
    // Todo va dentro del `try`, hasta lo que parece que no puede fallar: al
    // acabar esto es cuando se quita la pantalla de carga, y una excepción por
    // el camino la dejaría puesta para siempre. Con el `finally`, salga como
    // salga, la app pasa a lo suyo.
    try {
      Arranque.paso.value = 'Buscando los ajustes…';
      await Ajustes.cargar();
      await _limpiarSiEsInstalacionNueva();
      // La primera vez no hay servidor todavía: no hay a quién preguntar.
      if (!Ajustes.configurado) return;

      final token = await _almacen.read(key: _claveToken);
      if (token != null && token.isNotEmpty) {
        api.token = token;
        // Los dos pasos que dependen de la red, y por tanto los que de verdad
        // pueden hacerse esperar: conviene que se vean por separado.
        //
        // Sin cobertura no fallan: `api.get` sirve lo último que se guardó, así
        // que la app entra con la sesión de siempre y enseña los datos de la
        // última vez. Antes, aquí, quedarse sin línea echaba a la pantalla de
        // acceso, que es lo peor que puede pasarle a quien está en un local con
        // mala cobertura y solo quiere mirar sus incidencias.
        Arranque.paso.value = 'Comprobando la sesión…';
        final datos = await api.get('/api/session');
        _usuario = Usuario.desdeJson(datos as Map<String, dynamic>);
        Arranque.paso.value = 'Cargando los datos…';
        await _cargarMeta();
        Conexion.enEspera.value =
            await (await AlmacenLocal.abrir()).cuantasEnEspera();
        // El token de Firebase puede haber cambiado con la app cerrada. No se
        // espera: registrar el aparato para los avisos no tiene nada que ver
        // con pintar la primera pantalla, y en iOS puede tardar lo suyo —hay
        // que aguardar a que Apple conteste—, así que esperarlo era tiempo de
        // pantalla en blanco a cambio de nada.
        unawaited(Push.registrarToken(api));
        // El chat se pone en marcha con la app: pinta lo que tiene guardado y
        // pide al servidor solo lo que le falta desde el ultimo mensaje.
        unawaited(_arrancarChat());
      }
    } on ErrorApi catch (e) {
      // Sin línea y sin copia de la sesión —nunca se llegó a entrar en este
      // teléfono— no queda otra que el acceso, pero el token se conserva: no
      // ha caducado nada, es que no hay red.
      _usuario = null;
      if (!e.esDeRed) api.token = null;
    } finally {
      _arrancando = false;
      notifyListeners();
    }
  }

  /// Tira lo que hubiera quedado en el llavero de una instalación anterior.
  ///
  /// El llavero de iOS **sobrevive a desinstalar la app**, así que sin esto
  /// quien la borrase y la volviera a instalar se encontraría dentro con la
  /// sesión de antes. En Android no pasa —de eso se encarga
  /// `encryptedSharedPreferences`— y por eso ni se mira: hacerlo allí cerraría
  /// la sesión de todo el mundo al actualizar la app, que es justo lo que no
  /// se quiere.
  Future<void> _limpiarSiEsInstalacionNueva() async {
    if (defaultTargetPlatform != TargetPlatform.iOS) return;
    final prefs = await SharedPreferences.getInstance();
    if (prefs.getBool(_claveInstalada) == true) return;
    await _almacen.deleteAll();
    await prefs.setBool(_claveInstalada, true);
  }

  Future<void> entrar(String usuario, String password) async {
    final datos = await api.postSinSesion('/api/login', {
      'usuario': usuario.trim(),
      'password': password,
    }) as Map<String, dynamic>;
    await _abrirSesion(datos);
  }

  /// Entra con el vale que ha traído la vuelta de Office 365.
  ///
  /// El verificador es el que se guardó al abrir el navegador. Sin él el vale
  /// no vale: es lo que le demuestra al servidor que este que canjea es el
  /// mismo que empezó.
  Future<void> entrarConOffice(String vale) async {
    final verificador = await Entra.verificadorGuardado();
    if (verificador == null || verificador.isEmpty) {
      throw ErrorApi('Esa entrada no se empezó en este teléfono. Vuelve a intentarlo.');
    }
    try {
      final datos = await api.postSinSesion('/api/entra/movil', {
        'vale': vale,
        'verificador': verificador,
      }) as Map<String, dynamic>;
      await _abrirSesion(datos);
    } finally {
      // El vale se ha gastado en el servidor, salga bien o mal: el verificador
      // que iba con él ya no sirve para nada.
      await Entra.olvidar();
    }
  }

  /// Lo que hay que hacer con la respuesta de cualquiera de las dos entradas.
  Future<void> _abrirSesion(Map<String, dynamic> datos) async {
    final token = '${datos['token'] ?? ''}';
    if (token.isEmpty) {
      throw ErrorApi('El servidor no ha devuelto la sesión.');
    }
    api.token = token;
    await _almacen.write(key: _claveToken, value: token);
    _usuario = Usuario.desdeJson(datos);
    await _cargarMeta();
    notifyListeners();

    // Los avisos se piden al entrar, que es cuando se entiende para qué son.
    // No se espera: que el permiso tarde no puede retener la pantalla.
    unawaited(Push.activar(api));
    unawaited(_arrancarChat());
  }

  /// Una petición mínima para saber si el servidor contesta otra vez. No se
  /// guarda en la copia ni se sirve de ella: aquí lo que interesa es
  /// justamente si hay línea, no el dato.
  Future<bool> _servidorContesta() async {
    if (!Ajustes.configurado || api.token == null) return false;
    try {
      await api.get('/api/session', null, true);
      return true;
    } on ErrorApi catch (e) {
      // Un 401 significa que se llegó al servidor: hay línea, aunque la sesión
      // ya no valga. De eso se ocupa `alCaducarSesion`.
      return !e.esDeRed;
    }
  }

  /// Mira si ha vuelto la línea, sin esperar al reloj. Se llama al volver a la
  /// app: la cobertura puede haber vuelto con el teléfono en el bolsillo.
  Future<void> comprobarConexion() async {
    if (_usuario == null) return;
    if (await _servidorContesta()) Conexion.exito();
  }

  /// Ha vuelto la conexión: sale lo que se hizo sin ella y se refresca todo.
  Future<void> _alVolverLaRed() async {
    if (_usuario == null) return;
    try {
      await api.vaciarCola();
      await _cargarMeta();
      notifyListeners();
      await chat.alReanudar();
    } on ErrorApi {
      // Se ha vuelto a caer por el camino; se reintenta en la siguiente.
    }
  }

  Future<void> _arrancarChat() async {
    final quien = _usuario;
    if (quien == null) return;
    try {
      await chat.arrancar(usuarioId: quien.id, nombre: quien.nombre);
    } catch (_) {
      // El chat es una parte más: si no arranca, el resto de la app sigue.
    }
  }

  /// La app vuelve a primer plano. El chat se reconecta y recupera lo que haya
  /// pasado mientras estaba dormida.
  void alReanudar() => unawaited(chat.alReanudar());

  /// La app se va al fondo: el flujo de eventos se corta y lo que llegue
  /// mientras tanto avisa por push.
  void alDormirse() => chat.alDormirse();

  Future<void> salir() async {
    final tokenPush = Push.tokenActual;
    try {
      // El servidor borra el dispositivo, así que este móvil deja de recibir
      // avisos de un usuario que ya no lo usa.
      await api.post('/api/logout', {if (tokenPush != null) 'token_push': tokenPush});
    } on ErrorApi {
      // Aunque falle hay que soltar la sesión de este lado.
    }
    await _limpiar();
  }

  Future<void> _cargarMeta() async {
    final datos = await api.get('/api/meta');
    _meta = Meta.desdeJson(datos as Map<String, dynamic>);
  }

  /// Refresca los desplegables sin tocar la sesión: los catálogos cambian
  /// cuando un administrador da de alta un local.
  Future<void> refrescarMeta() async {
    try {
      await _cargarMeta();
      notifyListeners();
    } on ErrorApi {
      // Los desplegables anteriores siguen sirviendo.
    }
  }

  /// El servidor ha contestado 401: la sesión ya no vale.
  void _sesionRechazada() {
    if (_usuario != null) unawaited(_limpiar());
  }

  Future<void> _limpiar() async {
    await chat.parar(borrarCopia: true);
    // La copia de trabajo es de quien había entrado, y con ella lo que dejara
    // sin mandar: no puede quedarse para el siguiente.
    Conexion.parar();
    await AlmacenLocal.vaciar();
    await _almacen.delete(key: _claveToken);
    api.token = null;
    _usuario = null;
    _meta = null;
    notifyListeners();
  }
}
