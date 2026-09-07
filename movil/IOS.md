# La app de iPhone

Es **la misma app**: todo `lib/` sirve igual en las dos plataformas, y las
diferencias que hay entre Android e iOS están resueltas dentro del código. Lo
que falta no es programar, es la parte de Apple, y esa necesita un **Mac con
Xcode** y una cuenta de **Apple Developer de pago** — los avisos push no
funcionan sin ella.

Para **subir a App Store Connect** hace falta además una versión concreta de
todo: desde el 28 de abril de 2026 Apple solo acepta lo compilado con **Xcode
26** y el **SDK de iOS 26**, y esa cadena pide **Flutter 3.38 o posterior**.
Para probar en un teléfono propio vale cualquier Xcode reciente; es al subir
donde se rechaza. Que el SDK sea el 26 no deja fuera a ningún teléfono: el
mínimo lo sigue marcando `IPHONEOS_DEPLOYMENT_TARGET`, que está en iOS 15.

Con eso delante son unos veinte minutos.

## Los pasos

### 1. Generar la carpeta `ios/`

Desde `movil/`:

```bash
flutter create --platforms=ios .
flutter pub get
```

No toca `lib/`, `android/` ni `pubspec.yaml`: solo añade lo que falta. Lo que
genera es una app de ejemplo con el identificador `com.example.…`, así que
todavía no es la nuestra.

Sí deja una cosa de más: `test/widget_test.dart`, la prueba de ejemplo de
Flutter, que busca una clase `MyApp` que aquí no existe. Bórrala, o `flutter
test` y `flutter analyze` fallarán por ella:

```bash
rm -f test/widget_test.dart
```

### 2. Ponerle lo suyo

```bash
node tools/ios.js
node tools/iconos.js
```

El primero deja en la carpeta recién hecha lo que la distingue: el
identificador `com.ejemplo.soporte`, el nombre bajo el icono, el esquema
por el que vuelve la entrada con Office 365, los textos de los permisos de
cámara, fotos, micrófono y guardado en el carrete, el aviso en segundo plano y
el dominio de los enlaces de los correos, que es `soporte.tu-dominio.com`.

Los textos de los permisos **los pone esa herramienta**, así que es ahí donde
hay que cambiarlos: editar el `Info.plist` a mano funciona hasta que alguien
vuelve a ejecutarla y se lo lleva por delante. Si alguna vez hay que
apuntar a otro —una instalación de pruebas, por ejemplo:

```bash
node tools/ios.js --dominio=otro.dominio.com
```

El segundo rehace los iconos de las dos plataformas; los de iPhone salen sin
canal alfa y sin esquinas redondeadas, que es lo que pide Apple.

Los dos se pueden repetir las veces que haga falta: lo que ya está no se toca.

### 3. Firma y capacidades

En Xcode, abriendo **`ios/Runner.xcworkspace`** (el `.xcodeproj` no, que se
queda sin los Pods), en **Signing & Capabilities** del target *Runner*:

- El **Team** de tu cuenta de Apple Developer. El Bundle Identifier ya lo dejó puesto el
  script.
- **+ Capability › Push Notifications**. Sin esto no llega ningún aviso.
- **+ Capability › Background Modes**, y dentro marca **Remote notifications**:
  es lo que deja que un aviso despierte la app por detrás.
- **+ Capability › Associated Domains**. Al añadirla, Xcode engancha
  `Runner.entitlements` al proyecto. Si la añades **después** de ejecutar el
  script, vuelve a ejecutarlo para que escriba el dominio dentro.

### 4. Firebase

1. En el mismo proyecto de Firebase, añade una aplicación de **iOS** con el
   identificador `com.ejemplo.soporte`.
2. Descarga `GoogleService-Info.plist` y arrástralo a `Runner/` **desde
   Xcode**, no desde el Finder: tiene que quedar dentro del *target*, o Firebase
   no arranca y la app se cierra al abrirse.
3. Ese archivo se queda en tu copia y **no sube al repositorio**, igual que el
   `google-services.json` de Android: no es un secreto —viaja dentro de cada
   IPA— pero identifica tu proyecto de Firebase, y cada instalación tiene el
   suyo. Los dos están en el `.gitignore`.

### 5. La clave de APNs

Es el paso que se olvida y deja de funcionar todo sin decir por qué: Firebase
necesita permiso de Apple para entregar los avisos.

1. En [developer.apple.com](https://developer.apple.com), en Certificates,
   Identifiers & Profiles → **Keys**, crea una clave con **Apple Push
   Notifications service (APNs)** marcado y descarga el `.p8`. **Solo se
   descarga una vez.**
2. En Firebase → Configuración del proyecto → **Cloud Messaging** → la app de
   iOS → **APNs Authentication Key**, sube el `.p8` con su *Key ID* y el *Team
   ID*.

El `.p8` no se sube al repositorio: es de la cuenta de Apple entera, no de esta
app.

### 6. El servidor, para los enlaces de los correos

Android se conforma con la huella del APK; iOS quiere el identificador del
equipo de la cuenta de Apple Developer — diez letras y números, en la esquina de
developer.apple.com. En el servidor, `data/equipo-apple.json`:

```json
{ "equipo": "ABCDE12345" }
```

También vale la variable de entorno `EQUIPO_APP`. Reinicia y compruébalo:

```bash
curl https://TU-DOMINIO/.well-known/apple-app-site-association
```

Tiene que nombrar `ABCDE12345.com.ejemplo.soporte`. Si `details` sale
vacío, el archivo no está puesto y los enlaces se abrirán en Safari.

Cuidado con dos cosas que iOS no perdona: ese archivo **no puede ir por una
redirección** y tiene que llegar como `application/json` — el servidor lo hace
bien, pero un proxy delante puede estropearlo. Y **lo lee Apple, no el
teléfono**: un cambio tarda en notarse. Mientras se prueba, en Xcode se puede
usar `applinks:TU-DOMINIO?mode=developer`, que va directo contra el servidor.

### 7. Probar en un iPhone de verdad

Las notificaciones push **no funcionan en el simulador**, así que tarde o
temprano hay que enchufar un teléfono. El camino tiene tres peajes, y ninguno
avisa de que existe hasta que se tropieza con él:

1. **Emparejarlo.** Cable, teléfono desbloqueado, y responder al «¿Confiar en
   este ordenador?» **con el código de desbloqueo** — sin el código no se
   completa aunque se toque «Confiar». Si el diálogo no aparece, suele ser un
   cable de solo carga. Se comprueba con `flutter devices`: si sale
   `is not available because it is unpaired`, ahí sigue el problema.
2. **Modo de desarrollador**, en el teléfono: Ajustes → Privacidad y seguridad
   → Modo de desarrollador. La opción **no existe** hasta que el teléfono se ha
   conectado a Xcode una primera vez.
3. **Registrar el aparato y la app en la cuenta de Apple.** En teoría lo hace
   Xcode solo al pulsar «Try Again»; en la práctica se queda en
   «Communication with Apple failed» con facilidad. A mano no falla, en
   [developer.apple.com](https://developer.apple.com/account) →
   Certificates, Identifiers & Profiles:
   - **Devices → +**, con el UDID que da `flutter devices` (el
     `00008150-0005…`, con el guion).
   - **Identifiers → +**, App ID explícito `com.ejemplo.soporte`, y
     marcando **Push Notifications** y **Associated Domains**. Sin esas dos
     casillas, el perfil que salga no vale para esta app.

   Después, en Xcode: Settings → Accounts → **Download Manual Profiles**, y
   «Try Again» en Signing.

```bash
flutter run -d 00008150-0005181A1A28401C
```

La primera vez la app **no arranca sola**: iOS no ejecuta lo que firma un
desarrollador sin permiso. En el teléfono, Ajustes → General → VPN y gestión de
dispositivos → la cuenta → **Confiar**.

Con el teléfono delante, lo que hay que mirar es que **no** salga en la
terminal `Sin token de APNs`. En el simulador sale siempre, porque allí Apple no
reparte tokens; en un iPhone de verdad significa que los avisos no se están
registrando, y entonces las líneas que empiezan por `APNs:` —las escribe el
`AppDelegate`— dicen si Apple dio el token, si lo negó, o si nadie llegó a
pedírselo.

Otra que sale de vez en cuando es `Los avisos: tardan en prepararse`. Esa es
inofensiva: la app deja de esperar y pinta, pero la preparación sigue por su
cuenta y termina unos segundos después.

El resto se puede ir probando en el simulador, incluida la vuelta de Office
365, que allí se simula sin pasar por Microsoft:

```bash
xcrun simctl openurl booted "com.ejemplo.soporte://entra?vale=loquesea"
```

La app tiene que despertar y decir que ese acceso ya no vale, que es justo lo
que debe contestar a un vale inventado.

### 8. Repartirla

```bash
flutter build ipa
```

El `.ipa` sale en `build/ios/ipa/`. Se sube con **Transporter** o con
`xcrun altool`, y desde TestFlight se reparte al equipo sin pasar por la
revisión de App Store, que para una app interna es lo razonable.

Antes de subir una que vaya a la tienda, una comprobación que no avisa:

```bash
codesign -d --entitlements :- build/ios/ipa/*.ipa 2>/dev/null | grep -A1 aps
```

Tiene que decir **`production`**. En `Runner.entitlements` pone `development`
—es lo que escribe Xcode al añadir la capacidad— y lo normal es que Xcode lo
sustituya solo al exportar para App Store. Si alguna vez no lo hiciera, la app
saldría publicada sin que llegara un solo aviso, y eso no se descubre hasta que
alguien se queja.

Lo que hay que rellenar en App Store Connect —cuenta de revisión, etiquetas de
privacidad, capturas, clasificación por edad— está en `TIENDA.md`.

## Lo que ya está resuelto

Para no volver a mirarlo:

- **El servidor no hay que tocarlo.** `notificaciones.js` manda el bloque `apns`
  en cada aviso, con prioridad 10 y `content-available`, y
  `POST /api/dispositivos` acepta `plataforma: 'ios'`, que la app manda sola
  según dónde se ejecute.
- **Office 365** funciona igual que en Android y **no hay que registrar nada más
  en Azure**: quien se identifica es el navegador del teléfono, y la dirección
  de vuelta sigue siendo la del servidor. Lo único de Apple es el esquema del
  `Info.plist`, que pone `tools/ios.js`.
- `flutter_local_notifications` ya se inicializa con sus opciones de iOS, y el
  permiso se pide con `requestPermission`, que en iOS es el diálogo del sistema.

## Diferencias con Android que conviene conocer

Estas están resueltas en el código, pero explican por qué hay ramas por
plataforma en sitios que si no parecerían arbitrarios:

- **El llavero de iOS sobrevive a desinstalar la app.** Quien la borrara y la
  volviera a instalar se encontraría dentro con la sesión de antes. Por eso
  `Sesion._limpiarSiEsInstalacionNueva` tira el llavero en la primera arrancada
  de cada instalación — solo en iOS: hacerlo en Android cerraría la sesión de
  todo el mundo en cada actualización.
- **A Apple hay que pedirle el token, y nadie lo hacía.** Es lo que costó más
  de encontrar de todo esto: el permiso salía concedido, los entitlements eran
  correctos y Firebase arrancaba, pero el teléfono no recibía nada. Resultó que
  no se llamaba a `registerForRemoteNotifications()` —debería hacerlo
  `firebase_messaging` al conceder el permiso, y con el ciclo de vida del
  `SceneDelegate` no ocurre—, así que Apple ni daba token ni lo negaba. Lo pide
  ahora el `AppDelegate`, que además escribe en el registro las dos respuestas
  de Apple: sin eso, desde Dart no hay forma de distinguir un rechazo de una
  pregunta que nunca se hizo.
- **Firebase no tiene token hasta que Apple le da el suyo.** Pedirlo antes falla,
  y lo que se pierde es justo el primer arranque: el aparato se quedaría sin
  registrar. `Push._apnsListo` espera quince segundos; en el simulador se rinde,
  porque allí no llega nunca.
- **iOS pinta los avisos también con la app delante**, y como la app ya los pinta
  ella, saldrían por duplicado. Se le dice que no con
  `setForegroundNotificationPresentationOptions`.
- **iOS no tiene canales de notificación.** Todo lo del canal
  `incidencias_avisos` es solo de Android; aquí se ignora.
- **Los enlaces son todo o nada.** Android, sin el `assetlinks.json`, pregunta si
  abrir con la app o con el navegador. iOS no pregunta: sin el archivo del paso
  6, el enlace nunca abre la app.
- **iOS convierte en ruta el enlace con el que se abre la app**, y esta no usa
  rutas con nombre: navega con `Navigator.push`. Por eso el `Info.plist` lleva
  `FlutterDeepLinkingEnabled` en falso, que lo puso `tools/ios.js`. Sin esa
  llave, volver de Office 365 revienta con «Could not find a generator for
  route …?vale=…» y de los enlaces se encargaría Flutter en vez de
  `servicios/enlaces.dart`.
- **El contador del icono** (`badge`) llega en el aviso pero la app no lo
  gestiona. Si algún día se quiere, el sitio es `Push._mostrarEnPrimerPlano`.
- **El vídeo no se recomprime** —eso es cosa del navegador, y ya se avisa en el
  README del servidor para Safari—. La app sube el archivo tal cual y el tope
  del servidor son 120 MB.
