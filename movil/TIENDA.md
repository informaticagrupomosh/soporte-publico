# Repartir la app

Compilar la app es lo de menos. Lo que cuesta es lo de alrededor: los números
de versión, lo que pide cada tienda y las dos o tres cosas que provocan un
rechazo sin que nadie te avise de que existían.

Esto es para no reconstruirlo de memoria dentro de seis meses.

## Antes de nada: la versión

En `pubspec.yaml`, ahora mismo:

```yaml
version: 1.2.0+3
```

Delante del `+` va lo que lee la gente. Detrás, el número de compilación, y ese
**tiene que subir en cada subida**, aunque no cambie ni una línea. Apple y
Google rechazan una compilación con un número que ya han visto, y el mensaje no
siempre lo dice claro.

La costumbre más simple es subirlo siempre y tocar el de delante solo cuando
haya algo que contar:

```yaml
version: 1.2.0+4   # el mismo 1.2.0, corregido
version: 1.3.0+5   # con algo nuevo que contar
```

Las dos plataformas salen del mismo sitio: no hay que llevar dos cuentas.

## Lo que trae la 1.2.0, y lo que hay que tocar por ello

Esta versión no es un arreglo: trae **chat de local**, **notas de voz**, **modo
sin conexión** y la **moderación** del chat. Eso mueve cosas en las dos fichas, y
son justo las que se olvidan.

| Qué ha cambiado | Dónde hay que tocar |
|---|---|
| Notas de voz (micrófono) | Etiquetas de privacidad de Apple (*Audio Data*), seguridad de los datos de Play (grabaciones de voz), y el texto del permiso, que ya está en el código |
| Mensajes de chat | Etiquetas de Apple (*Messages*) y de Play (mensajes dentro de la app) |
| Guardar en el carrete | Permiso nuevo en las dos: `NSPhotoLibraryAddUsageDescription` y `WRITE_EXTERNAL_STORAGE` hasta Android 9 |
| Copia de datos en el teléfono | La política de privacidad lo declara, apartado 7 |
| El chat es contenido de los usuarios | Directriz 1.2 de Apple y política de contenido de Play. Tiene su apartado más abajo |
| Denuncias de mensajes | La política de privacidad lo declara, apartados 2, 3 y 7 |
| Pantallas nuevas | Capturas: conviene una del chat |

Para compilarla hace falta **Flutter 3.24 o posterior** (Dart 3.5). Lo pide
`record` 6, que es el que graba las notas de voz, y está declarado en el
`environment` del `pubspec.yaml`: con uno anterior, `flutter pub get` lo dice
en vez de fallar a mitad de compilación.

Y para **subirla a App Store Connect**, bastante más que eso: desde el 28 de
abril de 2026 Apple solo acepta lo compilado con **Xcode 26 y el SDK de iOS
26**, y esa cadena pide **Flutter 3.38 o posterior**. No está puesto en el
`environment` a propósito: es un requisito de una de las dos tiendas, no del
código, y ponerlo obligaría a subir de versión también a quien solo compila
para Android. Que el SDK sea el 26 no deja fuera a ningún teléfono: el mínimo
lo marca `IPHONEOS_DEPLOYMENT_TARGET`, que sigue en iOS 15.

Al subir Flutter suben con él los *pods* de Firebase, y son ellos los que
pueden empujar ese mínimo. Cuenta con una tarde de recompilar y volver a
probar, no con un `flutter upgrade` y a subir.

### Contenido generado por los usuarios

Es lo nuevo que puede costar una ronda de revisión. Desde que hay chat, la app
lleva contenido que escriben las personas, y las dos tiendas tienen reglas para
eso: la **directriz 1.2** de Apple y la política de contenido inapropiado de
Play. Piden, en resumen, que haya forma de moderar, de denunciar y de expulsar
a quien se pase.

Apple pide cuatro cosas concretas, y la 1.2.0 tiene las cuatro. Conviene
contestar con estas palabras, porque son las suyas:

| Lo que pide Apple | Dónde está |
|---|---|
| Filtrar el contenido inadecuado | No hay registro abierto: las cuentas las crea un administrador y los canales son los del centro de trabajo, no públicos. Todo el mundo escribe con su nombre |
| Que se pueda denunciar un mensaje | En cualquier mensaje ajeno: la banderita en la web, «Avisar al administrador» al mantenerlo pulsado en el móvil |
| Que se responda a los avisos | Cola de moderación —en la web y **en la propia app**—, y un aviso de vuelta a quien denunció cuando su caso se resuelve |
| Que se pueda expulsar a quien abusa | Administración › Usuarios › **Suspender**, en las dos, o el mismo botón en la cola de denuncias. Deja de poder entrar y se le cierran las sesiones en el momento |
| Un contacto publicado | El responsable de la instalación, en la política de privacidad, apartado 8 |

El aviso va a **Administración › Moderación**, una cola que solo ve el
administrador, con el mensaje señalado, quién avisó y cuándo. Desde ahí se borra
el mensaje, se suspende al autor o se despacha sin tocar nada. El número de
pendientes sale en la barra, y a los administradores les llega un push.

Esa cola está **en la web y en la app**, y eso importa para la revisión: el
circuito entero —avisar, atender, contestar— se puede ver sin salir de la
aplicación, que es lo que un revisor va a probar. Cuando el aviso se resuelve,
a quien lo dio le llega un push que lo dice.

Apple habla de **veinticuatro horas** para responder a un aviso. Eso no lo
arregla el código: si nadie mira esa cola, el compromiso está incumplido igual.
Antes de publicar conviene decidir quién la mira y que esa persona tenga la app
con los avisos activados.

Lo que **no** hay, por si lo preguntan: no hay bloqueo entre usuarios («que esta
persona no me vea»). En un canal de centro de trabajo no tendría sentido —son
compañeros, no desconocidos— y lo que sustituye a eso es la suspensión, que la
decide el administrador. Si en la revisión insisten, es eso lo que hay que
contestar.

Si en la ficha de Play preguntan por contenido generado por usuarios, se
contesta que sí y se explica lo de arriba. Decir que no sería inexacto, y las
inexactitudes en ese formulario se pagan con la app retirada, no con una ronda.

### Novedades, para copiar en la ficha

Las dos tiendas piden un texto de «qué hay de nuevo». Este vale para las dos:

> Chat por local: habla con los compañeros de tu centro desde la propia app,
> con fotos, vídeos y notas de voz, y con el estado de cada mensaje (enviado,
> recibido y leído).
>
> Modo sin conexión: la app sigue funcionando sin cobertura con lo último que
> sabía, y lo que escribas se envía solo en cuanto vuelve la conexión.
>
> Si algún mensaje no está en su sitio, puedes avisar al administrador
> manteniéndolo pulsado.

Y si hay que rehacer la descripción larga, esto describe lo que la app hace hoy:

> Incidencias es la aplicación de mantenimiento de un grupo de locales. El
> personal abre la avería desde su centro, el técnico la recoge y la cierra, y
> los dos hablan en el hilo de la propia incidencia, con fotos y vídeos.
>
> Incluye un chat por centro de trabajo para el día a día —con moderación: se
> puede avisar al administrador de cualquier mensaje—, informes, calendario,
> tareas programadas, inventario y control de lavandería.
>
> Funciona sin conexión: se puede consultar lo último que se sabía y lo que se
> escriba sale solo al recuperar la cobertura.
>
> La aplicación se conecta al servidor de tu organización, cuya dirección se
> indica la primera vez que se abre. Las cuentas las crea el administrador de
> esa instalación; no hay registro público.

## iPhone

### Por dónde repartirla

Hay tres caminos y no dan lo mismo.

**TestFlight** es lo que sirve hoy mismo, sin revisión de Apple. Hasta 100
personas del equipo de App Store Connect. Cada compilación caduca a los 90
días, así que hay que volver a subirla; para un grupo pequeño eso es una tarde
al trimestre y funciona.

**App Store**, la pública. Es viable porque esta app **no es la app de una sola
empresa**: pide la dirección del servidor al instalarse, así que cualquiera
puede levantar su instalación y usarla. Eso importa más de lo que parece — la
directriz 4.2 de Apple rechaza las apps hechas para un público cerrado y remite
a *Custom Apps*, y el argumento contra esa objeción es justo ese: es un cliente
genérico de un proyecto que cualquiera puede desplegar.

**Custom Apps de Apple Business Manager** reparte en privado a una
organización, sin salir en la tienda. Si algún día se decide que esto es solo
para el grupo, este es el sitio; requiere alta en
[business.apple.com](https://business.apple.com), que es gratis.

### Construir y subir

```bash
flutter build ipa
```

El `.ipa` sale en `build/ios/ipa/`. Se sube con **Transporter** (gratis en la
Mac App Store): se arrastra el archivo y ya. Tarda unos minutos en aparecer en
App Store Connect, y llega un correo si algo no le gusta.

### Lo que hay que rellenar en App Store Connect

Lo técnico está hecho. Lo que falta es papeleo, y estas cuatro cosas rechazan:

**Un servidor de demostración con su cuenta.** En *App Review Information*, una
dirección y unas credenciales que funcionen. Sin eso el revisor ve una pantalla
de acceso y no pasa de ahí, que es el motivo de rechazo más común en cualquier
app con login.

Con la base vacía tampoco sirve: una lista sin incidencias no enseña nada y
deja al revisor sin saber qué está mirando. El servidor se deja con datos
inventados:

```bash
node tools/demo.js --si
```

Crea una empresa de hostelería que no existe, con tres locales, incidencias en
los tres estados —unas con hilo, otras cerradas hace semanas para que los
informes tengan datos—, tareas repartidas por el calendario, inventario,
lavandería y conversación en el chat de cada local. Conserva las cuentas que ya hubiera y añade siete `demo.*` con una
contraseña que imprime al terminar. Está explicado en el README, en
«Instalación».

Para la revisión, en los campos de usuario y contraseña, la cuenta
**`demo.encargado`**: ve las incidencias de su local, abre nuevas y escribe en
los hilos, que es el recorrido completo sin poder borrar nada. En las notas hay
que dar además la de administrador, **`demo`**, con la misma contraseña, porque
el formulario solo tiene un hueco y la moderación hay que verla con ella. También entra en el chat de sus locales, que la demostración
deja con conversación dentro y un mensaje sin leer, de modo que se ve funcionar
sin tener que escribirle a nadie.

Si el revisor va a probar las notas de voz —y conviene que pueda—, el permiso
de micrófono se pide en ese momento, con la app explicando para qué es.

**Que no sea el servidor de producción.** Para TestFlight daba igual; para una
ficha pública, no: esa dirección se queda escrita en App Store Connect y el
revisor volverá a entrar por ahí en cada actualización, un año después
incluida. Levanta una instalación aparte —`soporte-demo.tu-dominio.com`, con su
propia carpeta `data/`— y llénala con `node tools/demo.js --si`. En producción,
además, las cuentas `demo.*` no pintan nada.

En las notas para el revisor hay que explicar **qué dirección poner en la
primera pantalla**, porque es lo primero que ve y no hay forma de que lo
adivine. Esto vale tal cual, cambiando la dirección:

> La aplicación es un cliente de un servidor propio de cada organización, como
> lo es un cliente de correo. En la primera pantalla hay que introducir la
> dirección del servidor:
>
>     soporte-demo.EL-DOMINIO.com
>
> Después, entrar con el usuario y la contraseña indicados arriba. Los datos
> son ficticios, preparados para esta revisión.
>
> Sobre el chat (directriz 1.2): no hay registro público —las cuentas las crea
> un administrador— y los canales son los de cada centro de trabajo, no
> públicos ni entre desconocidos. El circuito completo se puede probar dentro
> de la aplicación:
>
>     1. Con demo.encargado, mantener pulsado un mensaje de otra persona y
>        elegir «Avisar al administrador».
>     2. Cerrar sesión y entrar con la cuenta de administrador «demo»
>        (misma contraseña).
>     3. Menú lateral › Administración › Moderación: ahí está el aviso, con el
>        mensaje señalado. Desde esa pantalla se elimina el mensaje o se
>        suspende la cuenta de quien lo escribió.
>
> Al resolverlo, la persona que avisó recibe una notificación.
>
> No hay «Iniciar sesión con Apple» (4.8) porque el acceso con Microsoft no es
> un inicio de sesión social, sino el directorio corporativo de la propia
> organización, y además existe el acceso con usuario y contraseña propios.
>
> La aplicación no permite crear cuentas (5.1.1(v)): las da de alta el
> administrador de cada instalación, y la supresión se solicita a través del
> contacto de la política de privacidad.

**La política de privacidad.** Es obligatoria, y está en
`https://TU-DOMINIO/privacidad.html` (la sirve el servidor; el archivo es
`public/privacidad.html`). Está escrita sobre lo que el código hace de verdad,
así que si algún día la app recoge algo nuevo, hay que pasar por ahí.

Las dos tiendas quieren además que se pueda leer **desde dentro de la app**, y
se puede, en dos sitios: debajo de la dirección del servidor en la pantalla de
acceso —antes de escribir nada— y al final del menú lateral. Los dos abren la
del servidor que la app tenga configurado, en el navegador del teléfono. Si el
revisor pregunta dónde está, es eso lo que hay que contestar.

**Las etiquetas de privacidad**, que se rellenan a mano en la ficha. Según lo
que la app recoge hoy:

| Categoría | Qué | Para qué | ¿Enlazado a la persona? | ¿Seguimiento? |
|---|---|---|---|---|
| Contacto | Nombre, correo | Funcionamiento de la app | Sí | No |
| Contenido | Fotos, vídeos, textos | Funcionamiento de la app | Sí | No |
| Contenido | **Datos de audio** (notas de voz del chat) | Funcionamiento de la app | Sí | No |
| Contenido | **Mensajes** (el chat de cada local) | Funcionamiento de la app | Sí | No |
| Identificadores | Id. de dispositivo | Funcionamiento de la app | Sí | No |

Las dos filas en negrita son del chat de local y hay que marcarlas: Apple tiene
casilla propia para *Audio Data* y para *Messages*, y no declararlas es de las
cosas que se detectan después y obligan a corregir la ficha. En el formulario
de **seguridad de los datos de Google Play** son «Mensajes → otros mensajes
dentro de la app», «Archivos y documentos» y «Grabaciones de voz o sonido»,
todas con el mismo motivo (funcionamiento de la app) y ninguna compartida con
terceros.

En Play hay además dos preguntas que conviene contestar bien:

- **¿Se cifran los datos en tránsito?** Sí, va todo por HTTPS.
- **¿Puede el usuario pedir que se borren sus datos?** Sí, dirigiéndose al
  responsable de la instalación; está en la política, apartado 8.

A todo lo demás, no. No hay analítica, ni publicidad, ni terceros: la app habla
con un servidor y con nadie más. El identificador de dispositivo es el de los
avisos, y no se usa para seguir a nadie.

**Ojo con una que sí cambió**: los avisos del chat llevan en el cuerpo el
nombre de quien escribe y el comienzo del mensaje, así que ese texto pasa por
Apple y por Google. Está declarado en la política, en «Destinatarios». Si
alguna vez se decide que no salga de ahí, hay que recortar el aviso en
`chat.js` del servidor, no solo cambiar el papel.

**Las capturas.** Basta con el juego de **6,9 pulgadas** (1320 × 2868); Apple
escala solo para los tamaños menores, así que ya no hay que preparar cuatro
juegos. Las de iPad **no**: el
proyecto está declarado como app de teléfono (`TARGETED_DEVICE_FAMILY = "1"`,
lo pone `tools/ios.js`). Si alguien lo cambia a `"1,2"`, Apple pedirá capturas
de iPad y revisará la app en uno, donde la interfaz sale estirada.

Con la 1.2.0 conviene rehacerlas, porque las que hay no enseñan la mitad de lo
que ahora tiene la app. Cuatro llegan: la lista de incidencias, la ficha con su
hilo, **el chat de un local con conversación dentro** y el informe. Salen de la
instalación de demostración, así que no hay que tapar ningún dato de nadie.

### Las tres que pueden costar una ronda

La del contenido de los usuarios está más arriba y es la que más papeletas
tiene. Estas dos son las de siempre, y las dos se contestan sin tocar código.

**4.8 — «Iniciar sesión con Apple».** Es obligatorio ofrecerlo cuando se usa un
servicio de terceros para identificarse. Aquí hay defensa: Microsoft no es un
inicio de sesión social, sino el directorio corporativo de la propia
organización, y además la app tiene usuario y contraseña propios, que es una
alternativa que no pasa por nadie.

**5.1.1(v) — borrar la cuenta desde la app.** Se exige a las apps en las que el
usuario puede crearse una cuenta. Aquí no puede: las crea un administrador de
la organización, y la app no tiene registro. La supresión se pide al
responsable de la instalación, y eso está en la política, apartado 8. Que no
aplique no impide que un revisor lo saque, así que conviene tenerlo escrito en
las notas antes de que pregunte.

### La clasificación por edad

Desde 2026 el cuestionario es otro y pregunta expresamente por el chat y por el
contenido que escriben los usuarios. Se contesta lo que hay: hay mensajería
dentro de la app, entre personas de la misma organización, con moderación por
parte de un administrador y sin registro público. Con eso lo normal es no
quedarse en 4+; no pasa nada, pero conviene saberlo antes de prometer una
clasificación a nadie.

### Lo que no está automatizado

El alta en App Store Connect, las capturas, el texto de la ficha y las
etiquetas de privacidad. Eso es a mano, con la cuenta de Apple delante.

### El recorrido de la primera publicación, en orden

Todo lo de arriba, puesto en la secuencia en la que hay que hacerlo. Lo de
antes son las explicaciones; esto es la lista.

**En el Mac, una vez:**

1. Xcode 26 desde la App Store. Después:
   ```bash
   sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
   sudo xcodebuild -runFirstLaunch
   ```
2. La versión de Flutter que fija `movil/.fvmrc`:
   ```bash
   cd movil && fvm install && fvm flutter --version
   ```
3. Si la carpeta `ios/` no está, generarla y ponerle lo suyo — pasos 1 y 2 de
   `IOS.md`. Si está, `node tools/ios.js` no estorba: lo que ya está puesto no
   se toca.
4. En Xcode (`ios/Runner.xcworkspace`), *Signing & Capabilities* del target
   *Runner*: el Team, y las capacidades **Push Notifications**, **Background
   Modes › Remote notifications** y **Associated Domains**.
5. `GoogleService-Info.plist` de la app de iOS, arrastrado a `Runner/` **desde
   Xcode**. Y la clave APNs `.p8` subida a Firebase.

**En el servidor:**

6. `data/equipo-apple.json` con `{ "equipo": "TU-TEAM-ID" }`, para que los
   enlaces de los correos abran la app. Se comprueba con
   `curl https://TU-DOMINIO/.well-known/apple-app-site-association`: tiene que
   nombrar `TEAMID.com.ejemplo.soporte`.
7. La instalación de demostración, aparte de producción, con
   `node tools/demo.js --si`. Anota la contraseña que imprime.
8. La política de privacidad, en los dos sitios y no es lo mismo: la **URL de
   la ficha** es la de producción (`https://soporte.tu-dominio.com/privacidad.html`),
   que es la que va a durar; y el servidor de demostración tiene que servir la
   suya, porque el enlace de dentro de la app abre la del servidor que la app
   tenga configurado, y ahí el revisor tendrá el de demostración. Las dos salen
   del mismo `public/privacidad.html`, así que basta con que la instalación de
   demostración esté al día.

**En App Store Connect:**

9. El App ID `com.ejemplo.soporte` registrado en developer.apple.com con
   Push Notifications y Associated Domains marcados, y la app creada en App
   Store Connect con ese identificador.
10. La ficha: nombre, subtítulo, categoría, descripción, novedades, URL de
    soporte y URL de la política. Los textos están más arriba.
11. Las capturas de 6,9 pulgadas (1320 × 2868). Cuatro llegan.
12. Las **etiquetas de privacidad**, con la tabla de más arriba. Las filas de
    *Audio Data* y *Messages* son las que se olvidan.
13. La **clasificación por edad**, contestando lo que hay: mensajería dentro de
    la app, moderada, sin registro público.
14. **App Review Information**: la cuenta `demo.encargado` con su contraseña en
    los campos, y en las notas el texto de más arriba —que incluye la cuenta de
    administrador `demo`, para la cola de moderación—. Sin esto el revisor ve
    una pantalla de acceso y se acabó la revisión.

**La subida:**

15. Subir el número de compilación en `pubspec.yaml` si ya se había subido algo
    con el actual.
16. `fvm flutter test` y `fvm flutter analyze`.
17. `fvm flutter build ipa`, y comprobar el `aps-environment` del `.ipa` (lo de
    la lista de más abajo).
18. Transporter, arrastrar el `.ipa`. Tarda unos minutos en aparecer.
19. Probarla en **TestFlight** antes de enviar a revisión. Es la misma
    compilación que va a mirar Apple, y es la última oportunidad de ver que los
    avisos llegan de verdad con la firma de distribución.
20. Enviar a revisión.

Y una decisión que no es técnica y conviene tomar antes del paso 20: **quién
mira la cola de moderación**. Apple cuenta veinticuatro horas para responder a
un aviso sobre un mensaje, y eso no lo cumple el código.

## Android

```bash
flutter build appbundle
```

El `.aab` sale en `build/app/outputs/bundle/release/`. Google Play pide lo
mismo en lo esencial —política de privacidad, cuenta de prueba, formulario de
seguridad de los datos— y añade una cosa que Apple no tiene: **la firma**. El
`.aab` va firmado con un almacén de claves que hay que guardar como oro; si se
pierde, no se puede volver a publicar esa app nunca más, solo una nueva con
otro identificador. Play App Signing lo resuelve dejando la clave en manos de
Google, y es lo recomendable salvo que haya un motivo para no hacerlo.

Para repartir a mano sin pasar por Play, `flutter build apk` sigue valiendo.

### Los permisos que se ven en la ficha

Play los lista solo, sacándolos del manifiesto, y son estos:

| Permiso | Para qué | ¿Formulario aparte? |
|---|---|---|
| `INTERNET` | Hablar con el servidor | No |
| `POST_NOTIFICATIONS` | Los avisos, desde Android 13 | No |
| `RECEIVE_BOOT_COMPLETED`, `VIBRATE` | Que el aviso siga disponible tras reiniciar | No |
| `RECORD_AUDIO` | Las notas de voz del chat | No, pero se ve en la ficha |
| `WRITE_EXTERNAL_STORAGE` (hasta Android 9) | Guardar en el carrete una foto del chat | No |

Ninguno de ellos entra en la lista de permisos que Play obliga a justificar con
un formulario y un vídeo —esos son los de SMS, registro de llamadas,
ubicación en segundo plano y acceso a todos los archivos, y la app no usa
ninguno—. `RECORD_AUDIO` no exige papeleo, pero sí sale escrito en la ficha, así
que la descripción debería contar que hay notas de voz; si no, alguien se
preguntará para qué quiere el micrófono una app de averías.

### El formulario de seguridad de los datos

Es el equivalente a las etiquetas de Apple y hay que rehacerlo con la 1.1.0.
Los tipos que se recogen: **información personal** (nombre y correo),
**mensajes** dentro de la app, **fotos y vídeos**, **archivos y documentos**,
**grabaciones de voz o sonido** e **identificadores** del dispositivo. Todos
con el mismo par de respuestas: se recogen para el funcionamiento de la app, y
no se comparten con terceros.

Las dos preguntas que se contestan mal por prisa:

- **¿Se cifran los datos en tránsito?** Sí: todo va por HTTPS.
- **¿Puede el usuario pedir que se borren sus datos?** Sí, dirigiéndose al
  responsable de la instalación. Está en la política, apartado 8.

Y una que es nueva: **contenido generado por los usuarios**. Se contesta que sí,
con lo que está explicado más arriba.

## Y esto, cada vez

Las dos apps salen de `lib/`. Un arreglo que se hace pensando en una llega a la
otra en cuanto se recompila — y **solo** en cuanto se recompila. Si se publica
una y no la otra, se separan sin que nadie lo note hasta que alguien dice que
en su móvil no pasa lo que en el del compañero.

Cuando se suba una versión, súbelas las dos.

## Antes de darle a publicar

Lo que se olvida, en orden:

1. Subir el número de compilación en `pubspec.yaml`. Siempre.
2. `flutter test` y, con el servidor de demostración delante, abrir la app y
   mirar que entra, que el chat va y que sin cobertura sale la franja roja.
3. Que la instalación de demostración esté con datos (`node tools/demo.js --si`)
   y que la cuenta del revisor entre.
4. Las etiquetas de privacidad y el formulario de seguridad, si la versión ha
   cambiado lo que se recoge — la 1.1.0 y la 1.2.0 lo cambiaron.
5. El texto de novedades.
6. Las capturas, si hay pantallas nuevas.
7. `flutter build ipa` y `flutter build appbundle`, y subir las dos.
8. Y en la de iPhone, una que no avisa: comprobar que en el `.ipa` el
   `aps-environment` es **`production`**. En `Runner.entitlements` pone
   `development`, y Xcode lo sustituye solo al exportar para App Store — pero si
   alguna vez no lo hiciera, la app se publicaría sin que llegara un solo aviso
   y nadie se enteraría hasta que alguien se quejara.

   ```bash
   codesign -d --entitlements :- build/ios/ipa/*.ipa 2>/dev/null | grep -A1 aps
   ```
