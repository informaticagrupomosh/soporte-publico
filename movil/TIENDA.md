# Repartir la app

Compilar la app es lo de menos. Lo que cuesta es lo de alrededor: los números
de versión, lo que pide cada tienda y las dos o tres cosas que provocan un
rechazo sin que nadie te avise de que existían.

Esto es para no reconstruirlo de memoria dentro de seis meses.

## Antes de nada: la versión

En `pubspec.yaml`, ahora mismo:

```yaml
version: 1.1.0+2
```

Delante del `+` va lo que lee la gente. Detrás, el número de compilación, y ese
**tiene que subir en cada subida**, aunque no cambie ni una línea. Apple y
Google rechazan una compilación con un número que ya han visto, y el mensaje no
siempre lo dice claro.

La costumbre más simple es subirlo siempre y tocar el de delante solo cuando
haya algo que contar:

```yaml
version: 1.1.0+3   # el mismo 1.1.0, corregido
version: 1.2.0+4   # con algo nuevo que contar
```

Las dos plataformas salen del mismo sitio: no hay que llevar dos cuentas.

## Lo que trae la 1.1.0, y lo que hay que tocar por ello

Esta versión no es un arreglo: trae **chat de local**, **notas de voz** y **modo
sin conexión**. Eso mueve cosas en las dos fichas, y son justo las que se
olvidan.

| Qué ha cambiado | Dónde hay que tocar |
|---|---|
| Notas de voz (micrófono) | Etiquetas de privacidad de Apple (*Audio Data*), seguridad de los datos de Play (grabaciones de voz), y el texto del permiso, que ya está en el código |
| Mensajes de chat | Etiquetas de Apple (*Messages*) y de Play (mensajes dentro de la app) |
| Guardar en el carrete | Permiso nuevo en las dos: `NSPhotoLibraryAddUsageDescription` y `WRITE_EXTERNAL_STORAGE` hasta Android 9 |
| Copia de datos en el teléfono | La política de privacidad lo declara, apartado 7 |
| El chat es contenido de los usuarios | Directriz 1.2 de Apple y política de contenido de Play. Tiene su apartado más abajo |
| Pantallas nuevas | Capturas: conviene una del chat |

Para compilarla hace falta **Flutter 3.24 o posterior** (Dart 3.5). Lo pide
`record` 6, que es el que graba las notas de voz, y está declarado en el
`environment` del `pubspec.yaml`: con uno anterior, `flutter pub get` lo dice
en vez de fallar a mitad de compilación.

### Contenido generado por los usuarios

Es lo nuevo que puede costar una ronda de revisión. Desde que hay chat, la app
lleva contenido que escriben las personas, y las dos tiendas tienen reglas para
eso: la **directriz 1.2** de Apple y la política de contenido inapropiado de
Play. Piden, en resumen, que haya forma de moderar, de denunciar y de expulsar
a quien se pase.

Lo que la app tiene de eso, que es casi todo:

- **No hay registro abierto.** Las cuentas las crea un administrador de la
  organización. Nadie llega de la calle a escribir en un canal.
- **Los canales no son públicos ni son de dos personas**: son los del centro de
  trabajo, y solo entra quien está dado de alta en él. Todo el mundo escribe
  con su nombre.
- **Se modera.** Cada uno borra sus mensajes y el administrador borra
  cualquiera, manteniéndolo pulsado en la propia conversación.
- **Se expulsa.** El administrador bloquea la cuenta desde Usuarios, y con ella
  se cierran sus sesiones abiertas.
- **Hay a quién dirigirse**: el responsable de la instalación, en la política de
  privacidad, apartado 8.

Y lo que **no** tiene, que conviene saber antes de que lo pregunten: **no hay un
botón de denunciar un mensaje**. El argumento es que aquí denunciar es decírselo
al administrador, que está identificado y es quien puede borrar y bloquear —no
es una red social donde el ofendido y el ofensor son desconocidos—. Suele bastar
en una app corporativa sin registro público. Si aun así lo sacan, lo barato es
añadir en el menú del mensaje un «avisar al administrador» que le mande un aviso
con el mensaje señalado; es media tarde, y es mejor eso que discutir dos rondas.

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

Y si hay que rehacer la descripción larga, esto describe lo que la app hace hoy:

> Incidencias es la aplicación de mantenimiento de un grupo de locales. El
> personal abre la avería desde su centro, el técnico la recoge y la cierra, y
> los dos hablan en el hilo de la propia incidencia, con fotos y vídeos.
>
> Incluye un chat por centro de trabajo para el día a día, informes,
> calendario, tareas programadas, inventario y control de lavandería.
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

Para la revisión, la cuenta **`demo.encargado`**: ve las incidencias de su
local, abre nuevas y escribe en los hilos, que es el recorrido completo sin
poder borrar nada. También entra en el chat de sus locales, que la demostración
deja con conversación dentro y un mensaje sin leer, de modo que se ve funcionar
sin tener que escribirle a nadie.

Si el revisor va a probar las notas de voz —y conviene que pueda—, el permiso
de micrófono se pide en ese momento, con la app explicando para qué es.

En las notas para el revisor hay que explicar **qué dirección poner en la
primera pantalla**, porque es lo primero que ve y no hay forma de que lo
adivine:

> La aplicación es un cliente de un servidor propio de cada organización. En la
> primera pantalla, introducir: soporte.tu-dominio.com
> Después, entrar con el usuario y la contraseña indicados arriba.
> Los datos son ficticios, preparados para esta revisión.

Cuando la instalación deje de ser de demostración y pase a llevar datos
reales, hay que acordarse de dos cosas: borrar las cuentas `demo.*` y cambiar
esa dirección por la de un servidor de pruebas, porque la ficha de App Store
Connect sigue viva entre versiones y el revisor volverá a entrar por ahí en la
siguiente.

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

**Las capturas.** La de 6,9 pulgadas es obligatoria. Las de iPad **no**: el
proyecto está declarado como app de teléfono (`TARGETED_DEVICE_FAMILY = "1"`,
lo pone `tools/ios.js`). Si alguien lo cambia a `"1,2"`, Apple pedirá capturas
de iPad y revisará la app en uno, donde la interfaz sale estirada.

Con la 1.1.0 conviene rehacerlas, porque las que hay no enseñan la mitad de lo
que ahora tiene la app. Cuatro llegan: la lista de incidencias, la ficha con su
hilo, **el chat de un local con conversación dentro** y el informe. Salen de la
instalación de demostración, así que no hay que tapar ningún dato de nadie.

### Otra que puede costar una ronda

La primera es la del contenido de los usuarios, que está más arriba y con la
1.1.0 es la que más papeletas tiene. Esta es la de siempre.

La directriz **4.8** obliga a ofrecer «Iniciar sesión con Apple» cuando se usa
un servicio de terceros para identificarse. Aquí hay defensa: Microsoft no es
un inicio de sesión social, sino el directorio corporativo de la propia
organización, y además la app tiene usuario y contraseña propios, que es una
alternativa que no pasa por nadie. Si lo sacan, es eso lo que hay que
contestar, no ponerse a implementar nada.

### Lo que no está automatizado

El alta en App Store Connect, las capturas, el texto de la ficha y las
etiquetas de privacidad. Eso es a mano, con la cuenta de Apple delante.

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
   cambiado lo que se recoge — la 1.1.0 lo cambió.
5. El texto de novedades.
6. Las capturas, si hay pantallas nuevas.
7. `flutter build ipa` y `flutter build appbundle`, y subir las dos.
