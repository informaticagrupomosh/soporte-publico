# Incidencias — app móvil

App de **Android y iPhone** para la gestión de incidencias por local, contra
la misma API que ya usa la web (`server.js`). Está escrita en **Flutter**: todo
`lib/` es el mismo para las dos, y lo poco que se comporta distinto está
resuelto dentro. Lo que falta en iOS no es programar, sino la parte de Apple —
firma, capacidades y APNs—, que necesita un Mac: los pasos, en
[IOS.md](IOS.md).

Lo que la app hace es lo que hace la web en un móvil, más lo que la web no puede
hacer: **avisar con la aplicación cerrada**.

## Qué incluye

- **Primer arranque**: la app pregunta la dirección del servidor y comprueba
  que responde antes de guardarla. Se pregunta una sola vez.
- **Acceso** con el correo y la contraseña, igual que la web, con «he olvidado
  la contraseña» para volver a entrar sin molestar a nadie. La sesión dura
  treinta días y el token vive en el almacén cifrado del sistema, así que no hay
  que entrar cada mañana.
- **Entrar con Office 365**, si el servidor lo tiene configurado. El botón sale
  solo cuando lo hay; más abajo está cómo funciona.
- **Los enlaces de los correos abren la app** por la incidencia que toque, tanto
  con la app cerrada como abierta.
- **Lista de incidencias** con los mismos filtros que la web —grupo, local,
  estado, prioridad y asignación— y el buscador por texto. Lo urgente sale
  arriba y **las cerradas se apartan a «Completados», plegado**. Se refresca
  sola cada veinte segundos y también tirando hacia abajo.
- **Detalle** con el hilo de mensajes enfrentado —lo propio a la derecha—, las
  fotos en miniatura que se abren a pantalla completa, los vídeos que se
  reproducen dentro y los documentos que abre la app del sistema. El hilo
  **empieza por lo que contó quien abrió la incidencia**: su descripción y sus
  adjuntos son el primer mensaje. Estado, prioridad y asignación **se guardan al
  pulsar «Guardar»**, no al elegirlos.
- **Abrir una incidencia**, solo en los locales del usuario. Se adjunta haciendo
  una foto, grabando un vídeo, eligiendo cualquiera de las dos cosas de la
  galería, o con un archivo. **La incidencia no se crea hasta que el adjunto ha
  subido entero**, así que no puede quedar una avisando a los técnicos de una
  foto que no llegó.
- **De quién es el turno**, con un distintivo en la lista y en la ficha:
  «Respondido» cuando ha escrito el otro lado y «Esperando respuesta» cuando el
  último en escribir fue el tuyo.
- **Informes** (todos menos el empleado): entradas, resueltas y pendientes del
  rango, el reparto por estado, el desglose por local y las entradas por mes.
  Un técnico solo ve sus propios números, y el filtro le viene fijado.
- **Tareas programadas** (gestor y administrador): la lista con cuándo le toca
  a cada una la próxima vez, el formulario de las cuatro pautas —una vez,
  diaria, semanal y mensual—, «Ejecutar ahora» y parar o eliminar.
- **Administración** (administrador): usuarios con su correo —que es su
  acceso—, su rol, su grupo y sus locales, desbloqueo de cuentas, y los
  catálogos de grupos y locales.
- **Abrir en nombre de otra persona** (técnicos, gestores y administradores),
  para cuando alguien cuenta una avería de palabra y la teclea otro.
- **Eliminar**: la incidencia entera la borra un administrador; un adjunto, quien
  lo subió o un administrador, manteniéndolo pulsado.
- **Chat de local**: un canal por cada local, con fotos, vídeos, documentos y
  notas de voz, el estado de cada mensaje y la conversación guardada en el
  teléfono. Tiene su apartado más abajo.
- **Sin conexión**: la app sigue funcionando con lo último que sabía y lo que
  se haga sale solo al volver la línea, con un aviso permanente mientras tanto.
  Tiene su apartado más abajo.
- **Política de privacidad** a mano, en la pantalla de acceso y al final del
  menú: abre la del servidor configurado en el navegador del teléfono. Las dos
  tiendas piden poder leerla desde dentro de la app.
- **Notificaciones push con la app cerrada**, que es lo que sigue.

**Los permisos los decide el servidor, no la app**: cada usuario ve lo que le
toca por su rol, y una incidencia que no le corresponde responde 404. El menú
lateral esconde lo que este usuario no puede usar, pero eso es cortesía, no
seguridad: quien se saltara la pantalla se encontraría igualmente con un 403.
Las banderas que deciden qué se enseña —`puedeCrear`, `puedeVerInformes`,
`puedeProgramar`, `tecnicoFijado`— vienen resueltas desde `/api/meta`, así que
la regla se escribe una sola vez y en el servidor.

## Notificaciones

Los avisos que manda `notificaciones.js`:

| Cuándo | A quién |
|---|---|
| Se abre una incidencia | A los técnicos de su grupo con visibilidad sobre ese local |
| El técnico escribe en el hilo | Al empleado que abrió la incidencia |
| El empleado escribe en el hilo | Al técnico asignado; si no hay ninguno, a todos los que la ven |
| Cambia el estado | A quien la abrió y a quien la tiene asignada |

A quien provoca el aviso nunca se le avisa: ya sabe lo que ha hecho.

**Los avisos se agrupan por incidencia.** Todos los de una misma llevan la misma
etiqueta (`tag` en Android, `apns-collapse-id` en iOS), así que el nuevo
sustituye al anterior en lugar de apilarse: tres mensajes seguidos de un hilo
dejan un aviso, no tres. Y todos los de la app se juntan en un bloque de la
barra.

**Cómo llega el aviso según dónde esté la app**, que es lo que más confunde de
Firebase:

- **Cerrada o en segundo plano** — el servidor manda la parte `notification`, y
  entonces el aviso lo pinta **Android**, sin arrancar nada de Flutter. Es lo
  que hace que funcione con la app cerrada. No depende de que el sistema quiera
  despertar la aplicación, que es lo que falla en los mensajes de solo datos.
- **Abierta** — Android no pinta nada, porque da por hecho que ya lo estás
  viendo. Ahí lo dibuja la app con `flutter_local_notifications`.

Pulsar el aviso abre la incidencia en los dos casos: con la app viva por
`onMessageOpenedApp`, y arrancándola de cero por `getInitialMessage`.

### El canal tiene que coincidir en tres sitios

Desde Android 8 un aviso dirigido a un canal que no existe **se descarta sin
mostrarse**, y es la causa más habitual de que «no lleguen las notificaciones».
El identificador `incidencias_avisos` aparece en tres sitios y los tres tienen
que decir lo mismo:

| Dónde | Qué |
|---|---|
| `notificaciones.js` | la constante `CANAL`, que viaja en `android.notification.channel_id` |
| `android/app/src/main/AndroidManifest.xml` | el `meta-data` `default_notification_channel_id` |
| `lib/servicios/push.dart` | `Push.canalId`, el canal que la app crea al arrancar |

Hay una prueba en `test/api.test.js` que comprueba que el servidor manda el
canal, para que no se desvíe sin que nadie se entere.

### Si un móvil no recibe avisos

Por orden, que es como se descarta más rápido:

1. **¿Está `data/fcm.json` en el servidor?** Sin credenciales la app web arranca
   igual y solo deja una línea en el registro: `Notificaciones push
   desactivadas`. No se envía nada a nadie.
2. **¿Aceptó el permiso?** En Android 13 y posteriores hay que concederlo. Se
   pide al iniciar sesión; si se rechazó, se activa en Ajustes → Aplicaciones →
   Incidencias → Notificaciones.
3. **¿Se registró el aparato?** Tiene que haber una fila suya en la tabla
   `dispositivos`. La app la crea al iniciar sesión y cada vez que Firebase le
   cambia el token.
4. **¿Ahorro de batería?** Xiaomi, Huawei, Oppo y Samsung matan las apps en
   segundo plano de forma agresiva. Hay que marcar Incidencias como «sin
   restricciones» en la configuración de batería del teléfono. Es lo que suele
   explicar que un móvil concreto reciba los avisos con horas de retraso.
5. **¿`google-services.json` es el del proyecto correcto?** Si no, Firebase
   responde `SENDER_ID_MISMATCH` y el servidor borra el token por muerto.

## Sin conexión

La app **funciona sin línea**, con lo último que sabía, y lo que se haga mientras
tanto sale solo cuando vuelve. En un local con mala cobertura eso no es un
adorno: es la diferencia entre poder mirar una avería y no poder.

Mientras no hay conexión, una **franja roja fina** cruza la parte de arriba de
la pantalla: «Trabajando sin conexión», y con la cuenta de lo que queda por
mandar si hay algo. No tapa nada —empuja la app hacia abajo esos pocos
píxeles—, no se puede cerrar y está en todas las pantallas, porque enterarse de
que se está trabajando a ciegas no puede depender de en cuál se esté.

**Lo que se ha leído se guarda.** Cada respuesta buena del servidor queda en una
copia local, y sin línea se sirve de ahí: la lista, la ficha de una incidencia,
los informes, el calendario. Se ve lo último que se supo en lugar de un error.

**Lo que se escribe se encola.** Contestar en el hilo de una incidencia y
cambiar su estado, su prioridad o su asignación se anotan y salen solos, en el
mismo orden, en cuanto vuelve la línea. La app lo dice al hacerlo («se enviará
cuando vuelva la conexión») y la franja lleva la cuenta. El chat tiene su propia
cola, que funciona igual.

**Lo que necesita conexión de verdad** —abrir una incidencia, subir un adjunto,
dar de alta a alguien— avisa de que no hay línea en vez de fingir que se ha
hecho. Un adjunto hay que subirlo, y una incidencia nueva no puede avisar a
nadie desde el teléfono.

Cómo sabe la app si hay línea: **por si el servidor contesta**, no por si el
teléfono tiene wifi. Es lo único que importa y lo otro engaña —en un local es
habitual estar enganchado a un wifi cuyo router no tiene línea—. Cada petición
que llega la da por buena y cada una que no llega la da por caída; mientras está
caída se pregunta cada quince segundos, y al volver a abrir la app también.

Un detalle que conviene tener presente: **la copia local guarda datos de la
aplicación en el teléfono**. Vive en el almacenamiento privado de la app, que
otras aplicaciones no leen, y **se borra entera al cerrar sesión**, junto con lo
que hubiera quedado sin mandar. El token de sesión sigue donde estaba, en el
almacén cifrado del sistema.

### Por qué el arranque sin cobertura echaba al acceso

Estaba mal y es la razón de todo esto: al arrancar, la app comprobaba la sesión
contra el servidor y trataba igual las dos formas de que eso salga mal. «No hay
línea» y «tu sesión ya no vale» se parecen desde fuera y no tienen nada que ver:
la primera se arregla sola y la segunda exige volver a entrar. Ahora se
distinguen (`ErrorApi.esDeRed`), y sin línea la app entra con la sesión de
siempre y los datos guardados.

## Chat de local

Un canal por cada local en el que se está dado de alta, al estilo de los canales
de IRC. Se entra por el menú lateral, que lleva al lado el número de mensajes
sin leer, y el mismo número aparece en cada canal de la lista.

Se puede mandar texto, fotos, vídeos, documentos y **notas de voz**: el botón
del micrófono graba y, al parar, la nota se manda sola. Cada mensaje propio
lleva su estado en la esquina —⏱ enviando, ✓ enviado, ✓✓ recibido, ✓✓ en azul
leído, ↻ no se pudo mandar y se reintenta—.

**Manteniendo pulsado un mensaje** sale lo que se puede hacer con él: **copiar
su texto**, eliminar el propio —y cualquiera, si quien mira es administrador— y
**avisar al administrador** de uno ajeno, con un motivo que se puede dejar en
blanco.

Copiar va la primera y está en todos: en un chat de trabajo se pasan
referencias de pedido, matrículas y números de serie, y hasta ahora había que
teclearlos a mano mirando la pantalla. Se copia solo el texto, sin el nombre ni
la hora, porque lo que se copia se pega en otro sitio y ahí la cabecera
estorba. Funciona también con un mensaje que sigue en la cola de salida, que es
cuando más falta hace: algo que no ha salido y no quieres volver a escribir. El
aviso no borra ni esconde nada; va a la cola de moderación, donde se decide. Si
se avisa sin cobertura, espera en la cola de salida y sale al volver la línea,
como un mensaje más.

Cuando ese aviso se resuelve llega un push —«Tu aviso ha sido revisado»— que
abre el canal, para ver en qué quedó: el mensaje borrado deja su hueco.

**Los administradores tienen la cola en el menú**, en Administración ›
Moderación, con su número de pendientes al lado. Sale lo mismo que en la web
—el mensaje señalado, quién avisó y cuándo— y se puede hacer lo mismo: borrar
el mensaje, suspender a quien lo escribió o dar el aviso por atendido. Está en
la app porque el plazo son horas y el push llega al teléfono: obligar a
encender un ordenador para contestar era pedirle a la cola que se quedara sin
atender.

Lo que la app hace distinto de la web, porque un teléfono no es un navegador:

**Guarda la conversación en el teléfono.** Cada cuenta tiene su propia base
SQLite (`chat-<usuario>.db`), y es de ahí de donde se pinta: abrir un canal es
instantáneo y no gasta red. Al cerrar sesión se borra — la conversación de un
local no tiene por qué quedarse en el móvil de quien ya no entra.

**De la red solo viene lo que falta.** Al abrir la app se piden los canales, y
de cada uno **los mensajes posteriores al último guardado**, nunca la
conversación entera. Y ni eso: la lista de canales ya dice cuál es el último
mensaje de cada uno, así que si coincide con lo guardado no se pregunta nada.
Un canal que nunca se ha abierto no descarga su conversación hasta que se entra.

**El historial se trae subiendo.** Hacia atrás se va por páginas de cuarenta, y
solo cuando la copia local se queda corta: si la conversación ya está guardada,
subir por ella no toca la red.

**Los archivos van a la carpeta temporal, no a la galería.** Se descargan una
vez y se reutilizan, y el sistema puede tirarlos cuando necesite sitio. En el
carrete solo entra lo que se manda guardar a mano, con el botón de descarga del
visor. Y se descargan **solo cuando hacen falta**: las fotos al aparecer en
pantalla —y si se pasa de largo, la descarga se corta a medias—; los vídeos, las
notas de voz y los documentos, al pulsarlos. La duración de una nota de voz la
manda el servidor, así que se ve sin haber descargado nada.

**En tiempo real mientras la app está delante.** Hay un flujo de eventos abierto
(SSE) por el que entran los mensajes, los acuses y el «está escribiendo». Al
pasar la app al fondo se corta —una conexión que nadie mira solo gasta batería—
y lo que pase mientras tanto avisa por push. Al volver, se reconecta y se pone
al día de una vez.

**Lo escrito sin cobertura no se pierde.** Va a una cola que vive en la copia
local, así que sobrevive a cerrar la app, y sale sola cuando vuelve la red, con
esperas cada vez más largas. Cada mensaje lleva un identificador puesto por el
teléfono: reintentar un envío del que no se supo la respuesta devuelve el que ya
había en vez de duplicarlo.

**El aviso push lleva al canal.** Un aviso de chat abre su conversación al
pulsarlo, igual que uno de incidencia abre su ficha, y se agrupa por canal para
no apilar diez líneas del mismo sitio.

### Permisos que hacen falta

| Para qué | Android | iPhone |
|---|---|---|
| Notas de voz | `RECORD_AUDIO` | `NSMicrophoneUsageDescription` |
| Guardar en la galería | `WRITE_EXTERNAL_STORAGE` hasta Android 9 | `NSPhotoLibraryAddUsageDescription` |

Los dos están ya en el manifiesto y en el `Info.plist`, y se piden en el momento
en que se usan: la primera nota de voz y la primera descarga al carrete.

## Montarlo

### 1. Lo que hace falta instalar

| Qué | Para qué | Cómo se comprueba |
|---|---|---|
| **Flutter 3.38** | compilar la app | `flutter --version` |
| **Android Studio** | el SDK de Android, el emulador y los drivers | |
| **JDK 21** | lo que entienden Gradle 8 y el plugin de Android | ver más abajo |

La versión de Flutter está **fijada en `movil/.fvmrc`**, y no es por capricho:

- Por abajo, la 3.24 es el mínimo que compila (lo pide `record` 6, el que graba
  las notas de voz) y **para subir a la App Store hace falta la 3.38**, que es
  la primera que trae Xcode 26 y el SDK de iOS 26 — obligatorios desde abril de
  2026.
- Por arriba, la 3.47 saca **Material y Cupertino del SDK**, a paquetes
  aparte. No rompe todavía, pero es tocar los imports de todo `lib/` para
  ganar nada que esta app necesite. Cuando toque, se hace a propósito y en su
  propio cambio, no de rebote al preparar una subida.

Con [FVM](https://fvm.app) esa versión la usan las dos máquinas —la de Android
y el Mac— sin que nadie tenga que acordarse:

```bash
dart pub global activate fvm     # o: brew tap leoafarias/fvm && brew install fvm
cd movil
fvm install                      # lee .fvmrc
fvm flutter --version
```

A partir de ahí, `fvm flutter …` en lugar de `flutter …`. Sin FVM también se
puede, teniendo instalada esa versión a mano; lo que no vale es dar por buena
«la que hubiera».

Ojo con el JDK: **el que trae Android Studio puede ser demasiado nuevo** y
entonces no sirve. Está explicado en [La versión de Java](#la-versión-de-java),
que es donde más tiempo se pierde si se pasa por alto.

Lo que sí hay que hacer una vez, desde el propio Android Studio en **Settings →
Languages & Frameworks → Android SDK**:

- marcar **Android SDK Platform 36** (es el `compileSdk` del proyecto),
- en la pestaña **SDK Tools**, marcar **Android SDK Command-line Tools**.

Después, aceptar las licencias, que si no la compilación se para sin explicar
mucho:

```bash
flutter doctor --android-licenses
flutter doctor            # todo con ✓ menos lo de iOS, que necesita un Mac
```

### 2. Las dependencias

```bash
cd movil
flutter pub get
```

Si alguna versión da guerra, `flutter pub upgrade --major-versions` las pone al
día; el código no depende de nada exótico de ninguna de ellas.

#### Las versiones de la parte de Android

Flutter comprueba al compilar que Gradle, el plugin de Android y Kotlin llegan a
unos mínimos, y **los sube con cada versión de Flutter**. Lo que hay puesto:

| Qué | Versión | Dónde |
|---|---|---|
| Gradle | 8.14.3 | `android/gradle/wrapper/gradle-wrapper.properties` |
| Plugin de Android (AGP) | 8.11.1 | `android/settings.gradle` |
| Kotlin | 2.2.20 | `android/settings.gradle` |
| Java | **21** | no es del proyecto: `flutter config --jdk-dir=…` |
| compileSdk | 36 | `android/app/build.gradle` |

Si un Flutter más nuevo se queja de que alguna se queda corta, el propio error
dice cuál y qué versión mínima quiere: se sube ahí y ya está. El envoltorio de
Gradle se cambia mejor con el comando, que ajusta los cuatro archivos a la vez:

```bash
cd movil/android
./gradlew wrapper --gradle-version 8.14.3 --distribution-type all
```

Para salir del paso y comprobar otra cosa, `flutter run
--android-skip-build-dependency-validation` se salta esa comprobación. No lo
dejes así: la comprobación existe porque después falla de formas peores.

`compileSdk` no lo pide Flutter sino las librerías: cuando una de AndroidX
empieza a exigir una API más alta, la compilación se para con una lista de
«requires ... to compile against version N or later». Se sube ahí y ya está.
Subirlo no cambia cómo se comporta la app —eso es `targetSdk`— ni en qué
móviles se instala, que es `minSdk` y sigue en 23.

Dos techos que **no** hay que cruzar por mucho que los avisos insistan:

- **AGP 9 no.** A partir de ahí Gradle solo lee la DSL nueva y el propio plugin
  de Flutter deja de aplicarse. Hasta que Flutter lo soporte, este proyecto se
  queda en la rama 8.
- **Gradle 9 tampoco**, porque AGP 8 no funciona sobre él. Flutter avisa de que
  dejará de admitir Gradle 8 «pronto»; cuando llegue el momento habrá que subir
  las dos cosas a la vez, no una suelta.

#### La versión de Java

**Java no se configura en el proyecto**, sino en Flutter, y por máquina. Tiene
que ser **JDK 21**: Gradle 8 no entiende Java 25, y el error que da no lo dice
—«Unsupported class file major version 69»—, así que conviene reconocerlo.

Cuidado con lo que trae Android Studio: **su JDK incorporado puede ser
demasiado nuevo**, de modo que apuntar ahí no siempre arregla nada. Lo seguro es
instalar un JDK 21 aparte y apuntar a él:

```powershell
winget install EclipseAdoptium.Temurin.21.JDK
flutter config --jdk-dir="C:\Program Files\Eclipse Adoptium\jdk-21.0.12.8-hotspot"
```

Y comprobarlo antes de volver a compilar, que es el paso que más se salta:

```bash
flutter doctor -v      # la línea «Java version» tiene que decir 21
```

#### Los vídeos no se recomprimen en el móvil

La web recomprime el vídeo en el navegador antes de subirlo; la app lo manda tal
cual, porque hacerlo en el teléfono pediría una librería nativa que no compensa
para lo que se usa.

De ahí dos decisiones:

- **Grabar desde la app tiene un tope de dos minutos.** Un móvil normal cabe de
  sobra en los 120 MB que admite el servidor; sin tope, una grabación larga en
  4K se pasa y solo se sabría al terminar de subirla.
- **De la galería se puede elegir cualquier vídeo**, y si se pasa de tamaño se
  dice antes de subir nada, no después de un 413 del servidor.

Las fotos sí se recortan a 1920 px de lado y calidad 80 al elegirlas, que es de
sobra para ver una avería y las deja muy por debajo del tope de 10 MB.

#### Los enlaces de los correos

Los avisos por correo llevan un botón a la incidencia. Para que lo abra la app y
no el navegador, el manifiesto declara el dominio, que se pone al compilar:

```bash
flutter build apk --release -Pdominio=soporte.tu-dominio.com
```

De fábrica es `soporte.tu-dominio.com`, en `android/app/build.gradle`.

Android abre la app **sin preguntar** solo si el servidor publica la huella del
certificado con el que se ha firmado el APK, en
`https://TU-DOMINIO/.well-known/assetlinks.json`. Eso se configura en el
servidor; está explicado en el README de la raíz. Sin ello los enlaces funcionan
igual, solo que Android pregunta con qué abrirlos.

#### La barra de botones del sistema

Muchos Android no van por gestos sino con **tres botones en una barra** que se
come el borde inferior de la pantalla. Lo que quede pegado abajo —un «Guardar»
al final de un formulario, la última fila de una lista— aparece **debajo de esa
barra y no se puede pulsar**, y en el emulador no se nota porque suele ir por
gestos.

Por eso toda lista o formulario que llegue al fondo suma `margenSistema(context)`
(en `lib/nucleo/tema.dart`) a su margen inferior. Al añadir una pantalla nueva,
hay que acordarse:

```dart
padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + margenSistema(context)),
```

Usa `viewPadding` y no `padding` a propósito: `padding` se pone a cero cuando
sale el teclado, y en algo que se desplaza es mejor que sobre sitio a que falte.

#### Si la compilación falla en Windows sin venir a cuento

Dos tropiezos que no son del proyecto y cuestan un rato reconocer:

- **«Could not delete ... caches-jvm»** o cualquier otro error de borrado bajo
  `build/`. No es un fallo de compilación: es que el demonio de Gradle sigue
  agarrando los archivos, o el antivirus los está mirando justo entonces.
  Se resuelve parando los demonios antes de limpiar:

  ```powershell
  cd movil\android
  .\gradlew --stop
  cd ..
  flutter clean
  flutter run
  ```

  Si pasa a menudo, lo que lo quita de en medio es excluir la carpeta del
  repositorio en Seguridad de Windows → Protección antivirus → Exclusiones.

- **«An Application Control policy has blocked this file»** al ejecutar
  `impellerc.exe` u otra herramienta de Flutter. Es Windows, no Flutter:
  **Smart App Control** bloquea ejecutables que no reconoce. Se mira en
  Seguridad de Windows → Control de aplicaciones y navegador. Antes de apagarlo,
  conviene saber que **no se puede volver a encender sin reinstalar Windows**.
  En un portátil de empresa suele ser una directiva de sistemas, y entonces hay
  que pedirles que permitan `…\flutter\bin\cache\artifacts\`.

### 3. Firebase

Sin esto la app compila y funciona, pero **no recibe avisos**. Está explicado
entero más abajo, en [Firebase, paso a paso](#firebase-paso-a-paso). El
resultado es un archivo `google-services.json` en `movil/android/app/`.

### 4. Probarla

Con un móvil conectado por USB y la **depuración USB** activada (en Ajustes →
Opciones de desarrollador; las opciones de desarrollador se activan pulsando
siete veces sobre «Número de compilación»):

```bash
flutter devices           # que aparezca el móvil
flutter run
```

Con la app corriendo, `r` recarga los cambios al momento y `R` la reinicia
entera.

> Las notificaciones push **no llegan a un emulador** salvo que tenga los
> servicios de Google Play (las imágenes que ponen «Google Play» en el nombre).
> Para probar los avisos, un móvil de verdad y sin cable.

### 5. Generar el APK

```bash
flutter build apk --release
```

Sale en `build/app/outputs/flutter-apk/app-release.apk`, y se reparte copiándolo
o poniéndolo a descargar; en el móvil hay que permitir la instalación de
orígenes desconocidos.

Para que ocupe menos, un APK por arquitectura:

```bash
flutter build apk --release --split-per-abi
```

Y si algún día va a Google Play, lo que se sube es el paquete:

```bash
flutter build appbundle --release
```

### 6. Firmar la versión que se reparte

Sin `android/key.properties` se firma con la clave de depuración: sirve para
probar, pero **las actualizaciones no se instalarán encima** si un día se firma
de otra manera. Para una app que se va a repartir por el grupo conviene hacerlo
bien desde el principio.

Crear el almacén de claves una sola vez y guardarlo donde no se pierda —si se
pierde, no se puede actualizar la app instalada:

```bash
keytool -genkey -v -keystore ~/incidencias.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias incidencias
```

Y un `movil/android/key.properties` (que **no va al repositorio**):

```properties
storePassword=la contraseña del almacén
keyPassword=la contraseña de la clave
keyAlias=incidencias
storeFile=/ruta/absoluta/a/incidencias.jks
```

A partir de ahí `flutter build apk --release` ya firma con esa clave.

## Firebase, paso a paso

Lo que hay que hacer es **una sola cosa**: dar de alta la app de Android en el
mismo proyecto de Firebase que use el servidor, y bajarse su
`google-services.json`. Lo demás —el complemento de Gradle, el canal de avisos,
el icono— ya está hecho en el repositorio.

El archivo **no viene incluido**: es de cada instalación, y en un repositorio
compartido solo serviría para apuntar al proyecto de otro. Sin él la app
compila y funciona; lo único que no hace es recibir avisos.

### Antes de empezar: ¿qué proyecto es?

El servidor ya envía avisos con las credenciales que hay en `data/fcm.json`. La
app **tiene que estar en ese mismo proyecto**, o Firebase responderá
`SENDER_ID_MISMATCH` y el servidor dará los tokens por muertos y los borrará.

El nombre del proyecto está dentro de ese archivo:

```bash
grep project_id data/fcm.json
```

Si no existe `data/fcm.json`, es que las notificaciones nunca se activaron; hay
que empezar por [crear el proyecto y la cuenta de servicio](#si-no-hay-proyecto-todavía).

### Los pasos

1. Entra en la [consola de Firebase](https://console.firebase.google.com) y
   abre **el proyecto cuyo `project_id` acabas de mirar**.
2. En la portada, pulsa el icono de **Android** (o **Añadir app → Android** si
   ya hay alguna).
3. Rellena el alta:
   - **Nombre del paquete**: `com.ejemplo.soporte` — tiene que ser
     exactamente este, es el `applicationId` de `android/app/build.gradle`.
   - **Alias**: lo que quieras, por ejemplo «Incidencias Android».
   - **Certificado SHA-1**: *déjalo vacío*. Solo hace falta para el acceso con
     cuenta de Google y para App Check, y aquí no se usa ninguno de los dos.
4. Pulsa **Registrar app** y **descarga `google-services.json`**.
5. Deja el archivo en `movil/android/app/google-services.json` — al lado de
   `build.gradle`, no en otro sitio.
6. Los pasos 3 y 4 que enseña la consola (añadir plugins a Gradle) **ya están
   hechos** en el repositorio: `com.google.gms.google-services` está en
   `android/settings.gradle` y aplicado en `android/app/build.gradle`. Pulsa
   **Siguiente** hasta salir.
7. Vuelve a compilar (`flutter run`). El plugin de Gradle lee el JSON al
   compilar; **no basta con reiniciar la app**.

Y ya está. **No hay que tocar «Cloud Messaging» en la consola**, ni crear
ninguna clave más: el servidor ya se autentica con la cuenta de servicio de
`data/fcm.json`.

Hecho esto una vez, no hay que repetirlo salvo que se cambie de proyecto de
Firebase o de identificador de aplicación.

> El `google-services.json` **no es un secreto**: va dentro de cada APK y
> cualquiera puede sacarlo de ahí. Aun así está en el `.gitignore`, porque
> identifica el proyecto de Firebase de quien despliega esto y cada instalación
> tiene el suyo. El que **sí** es secreto es el `data/fcm.json` del servidor: es
> la cuenta de servicio, y con ella se pueden enviar avisos en nombre de la
> organización. Ese no sube nunca a ninguna parte.

### Comprobar que funciona

Sin tocar la app, desde la consola: **Interacción → Messaging → Nueva campaña →
Notificaciones**, y en «Enviar mensaje de prueba» pega el token del aparato. El
token de un móvil que ya haya iniciado sesión está en la base:

```bash
sqlite3 data/incidencias.db "SELECT usuario_id, plataforma, token_push FROM dispositivos;"
```

Si el aviso de prueba llega **con la app cerrada**, la parte de Firebase está
bien y cualquier problema que quede es del servidor. Si no llega, repasa la
lista de [Si un móvil no recibe avisos](#si-un-móvil-no-recibe-avisos).

### Si no hay proyecto todavía

Solo la primera vez, y es cosa del servidor más que de la app:

1. En la consola, **Crear un proyecto**. Google Analytics no hace falta.
2. **Configuración del proyecto** (la rueda dentada) → **Cuentas de servicio** →
   **Generar nueva clave privada**. Se descarga un JSON.
3. Ese JSON es el que va al servidor como `data/fcm.json`, y hay que
   **reiniciar** el servidor. Al arrancar tiene que decir en el registro
   `Notificaciones push activas (proyecto ...)`; si dice `desactivadas`, no ha
   sabido leerlo.
4. Ahora sí, [los pasos de arriba](#los-pasos) para dar de alta la app.

### Si cambias el identificador de la aplicación

`com.ejemplo.soporte` aparece en tres sitios, y los tres tienen que decir
lo mismo que el paquete dado de alta en Firebase:

- `applicationId` y `namespace` en `android/app/build.gradle`,
- el `package` de `android/app/src/main/kotlin/.../MainActivity.kt` y su ruta
  de carpetas.

## La dirección del servidor

**No está en el código.** La primera vez que se abre la app, lo primero que
pide es la dirección del servidor; se guarda y no se vuelve a preguntar. Así el
mismo APK vale para producción y para pruebas, y no hay que recompilar para
apuntar a otro sitio.

Antes de darla por buena, la app **llama al servidor** (`GET /api/session`, que
sin sesión responde 401 con un JSON). Con eso se resuelven las dos dudas de
golpe: si se llega y si lo que hay ahí es esta aplicación. Una dirección mal
escrita se ve en el momento, en vez de reaparecer luego disfrazada de «usuario o
contraseña incorrectos».

Para cambiarla después, en la pantalla de acceso está la dirección puesta y un
**Cambiar** al lado. Cambiar de servidor cierra la sesión, porque el token no
vale en otra máquina.

> El servidor tiene que ir por **HTTPS**. Android bloquea el tráfico en claro
> desde la versión 9 y iOS lo bloquea desde siempre, así que un `http://` solo
> funcionará en pruebas y con una excepción explícita: en el manifiesto de
> Android, y con `NSAppTransportSecurity` en el `Info.plist` de iOS.

## Entrar con Office 365

El botón aparece si `GET /api/entra/estado` contesta `activo` **y** `movil`. Lo
segundo es que el servidor sepa terminar el recorrido de la app: contra uno
anterior a esto, el botón abriría el navegador, la persona entraría en la web y
la app se quedaría esperando un vale que nadie iba a mandar. Sin botón se
entiende mejor lo que falta — actualiza el servidor. Lo que hay que registrar en
Azure está en el README de arriba; **desde la app no hay que registrar nada
más**.

La identificación no ocurre dentro de la app, sino en el **navegador del
teléfono**: es donde está la sesión de Microsoft y donde se resuelve el segundo
factor. El recorrido es este:

1. La app genera un verificador al azar, lo guarda en el almacén cifrado y abre
   el navegador en `…/api/entra/entrar?app=<resumen del verificador>`.
2. La persona se identifica en Microsoft, que devuelve el navegador al servidor.
3. El servidor no puede darle la sesión a la app por ahí, así que termina en
   `…/entra-movil.html` con un **vale de un solo uso** que dura dos minutos.
4. Esa página salta a `com.ejemplo.soporte://entra?vale=…`, que es el
   esquema que declara el manifiesto, y Android trae la app al frente. Si el
   navegador no salta solo, la página enseña un botón.
5. La app canjea el vale por su token en `POST /api/entra/movil`, mandando el
   verificador que guardó. A partir de ahí es una sesión como cualquier otra.

El verificador es lo que ata las dos mitades: **nunca sale del teléfono**, y sin
él el vale no sirve. Una aplicación que registrara el mismo esquema y se colara
en el enlace de vuelta se quedaría con un vale que no puede canjear.

Tres sitios tienen que decir lo mismo, y si uno se cambia hay que cambiar los
tres: el enlace de `public/entra-movil.html`, `Entra.esquema` en
`lib/servicios/entra.dart` y el `intent-filter` del manifiesto.

## Los iconos

Los del lanzador se generan para las dos plataformas, sin depender de ningún
programa de imagen:

```bash
node tools/iconos.js
```

De Android 8 en adelante manda el icono adaptativo en XML; los PNG que crea el
script son para los anteriores. Los de iPhone son el juego entero de
`AppIcon.appiconset`, y salen **sin canal alfa y sin esquinas redondeadas**: la
transparencia hace que App Store Connect rechace la subida —con un error que no
dice cuál de los quince iconos era— y las esquinas las recorta el sistema. Esos
solo se escriben si ya existe la carpeta `ios/`.

El icono pequeño de la barra de estado es `res/drawable/ic_notificacion.xml`,
que tiene que ser una **silueta blanca**: Android descarta el color y pintaría
un cuadrado blanco si se le da otra cosa. En iOS no hay equivalente: usa el de
la app.

## Cómo está organizado

```
lib/
  main.dart              arranque: Firebase, sesión guardada y a pintar
  app.dart               enseña acceso o lista, y abre la incidencia del aviso
  nucleo/
    api.dart             cliente HTTP con el token en Authorization
    sesion.dart          quién está dentro; entrar, salir y token push
    ajustes.dart         la dirección del servidor, que se pregunta al instalar
    tema.dart            el aspecto del back office
    formato.dart         etiquetas en castellano y fechas
    chat_local.dart      la copia del chat en el teléfono (SQLite)
    conexion.dart        si hay línea, y qué hacer cuando vuelve
    almacen_local.dart   la copia de lo leído y la cola de lo escrito
  modelos/modelos.dart   lo que devuelve la API
  modelos/chat.dart      los del chat, que además se guardan en la copia local
  servicios/chat.dart    canales, flujo de eventos, cola de salida y puesta al día
  servicios/push.dart    todo lo de las notificaciones
  servicios/privacidad.dart  el camino a la política, que vive en el servidor
  servicios/entra.dart   entrar con Office 365 por el navegador
  servicios/enlaces.dart los enlaces que abren la app: correos y esa vuelta
tools/
  iconos.js              los iconos de las dos plataformas
  ios.js                 deja la carpeta ios/ con lo que la distingue
  pantallas/             servidor, acceso, lista, detalle, nueva,
                         informes, tareas, usuarios, catalogos,
                         chat (canales) y chat_canal (la conversación)
  widgets/               distintivos, tarjetas, adjuntos, el multimedia del
                         chat y la franja de «sin conexión»
```

Lo que conviene saber antes de tocar nada:

- **Las fechas llegan en UTC sin marcar.** SQLite las guarda como
  `AAAA-MM-DD HH:MM:SS`, sin zona. `fechaUtc()` las marca como UTC al leerlas;
  sin eso, un mensaje de hace un minuto parecería de hace dos horas.
- **La sesión va por cabecera, no por cookie.** `POST /api/login` devuelve el
  token justo para esto.
- **`asignado_a` distingue entre no tocar y dejar sin asignar.** Por eso la
  clave se manda siempre, aunque vaya nula.
- **«Sin línea» y «sesión caducada» no son lo mismo.** `ErrorApi.esDeRed` los
  separa, y de esa distinción depende que la app no eche al acceso a quien se
  queda sin cobertura. Al tocar el manejo de errores, no volver a juntarlos.
- **El chat se pinta de la copia local, no de la red.** La red solo trae lo
  posterior al último mensaje guardado. Si algún día se toca la
  sincronización, esa es la regla que no puede romperse: es lo que hace que la
  app abra al instante y no descargue conversaciones enteras.
- **El refresco automático no pisa los cambios sin guardar.** Mientras el
  técnico tiene elegido un estado nuevo, el reloj de los veinte segundos no
  recarga la ficha.
