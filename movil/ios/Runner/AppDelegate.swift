import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    let listo = super.application(application, didFinishLaunchingWithOptions: launchOptions)

    // Pedirle a Apple el token de APNs.
    //
    // Esto debería hacerlo `firebase_messaging` al conceder el permiso, y con
    // el ciclo de vida antiguo lo hacía. Con el de ahora —el del
    // `SceneDelegate` que trae Flutter 3.47— no llega a ocurrir: Apple no
    // llamaba a ninguno de los dos métodos de abajo, ni para dar el token ni
    // para negarlo, así que Firebase se quedaba sin ninguno y el teléfono sin
    // avisos. Pedirlo aquí no molesta a nadie: no enseña ningún diálogo —el
    // permiso es cosa aparte, y lo pide `Push.registrarToken`— y si no
    // estuviera concedido, Apple simplemente no contesta.
    application.registerForRemoteNotifications()

    return listo
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
  }

  // Los dos avisos de Apple sobre el registro en APNs, escritos en el registro.
  //
  // De estos dos depende que lleguen los avisos, y cuando no llegan no hay
  // manera de saber por dónde se rompe: Firebase se limita a no tener token, y
  // desde Dart eso se ve igual tanto si Apple lo rechazó como si nunca llegó a
  // preguntar. Aquí sí se distingue, y no cuesta nada tenerlo puesto.
  //
  // El reenvío a `super` es lo que hace llegar el token a los plugins, así que
  // no se puede quitar.
  override func application(
    _ application: UIApplication,
    didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
  ) {
    NSLog("APNs: Apple ha dado un token de %d bytes.", deviceToken.count)
    super.application(application, didRegisterForRemoteNotificationsWithDeviceToken: deviceToken)
  }

  override func application(
    _ application: UIApplication,
    didFailToRegisterForRemoteNotificationsWithError error: Error
  ) {
    NSLog("APNs: Apple ha rechazado el registro — %@", error.localizedDescription)
    super.application(application, didFailToRegisterForRemoteNotificationsWithError: error)
  }
}
