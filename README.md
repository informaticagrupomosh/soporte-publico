# Incidencias

Aplicación web y móvil para gestionar las averías de una organización con varios locales,
repartidas entre los departamentos que las resuelven —de partida, **Informática** y
**Mantenimiento**—. El empleado abre la incidencia desde su local, el técnico del departamento
correspondiente la ve, la coge y la cierra, y los dos hablan en el hilo de la propia incidencia.

HTML plano con Bootstrap 5.3 vendorizado, sin build ni framework, y una app de Android y iPhone
en Flutter contra la misma API. En el servidor, Node y SQLite: se despliega copiando archivos.

**Se personaliza sin tocar el código.** El nombre de la organización, su dirección y sus correos
salen de `data/organizacion.json`; sin ese archivo la aplicación funciona igual y se presenta
como «Soporte». Está explicado en «Instalación».

## Qué incluye

- **Acceso** (`/login.html`): correo y contraseña, o la cuenta de **Office 365** de la
  organización si está configurada. Toda la app exige sesión iniciada; duran 30 días. El acceso está protegido contra intentos a ciegas: esperas
  crecientes a los 3, 6 y 9 fallos y bloqueo de la cuenta a los 10, que solo levanta un
  administrador desde Usuarios.
- **Incidencias** (`/`): la lista que ve cada usuario según su rol, con filtros por grupo, local,
  estado, prioridad y asignación, y un buscador por texto que mira título, descripción, local,
  grupo y las personas implicadas. Busca sin distinguir mayúsculas ni acentos («camara» encuentra
  «cámara»). Lo urgente sale arriba y **las cerradas se apartan a «Completados», plegado**, para
  que la tabla de arriba sea solo lo que queda por hacer. La lista **se refresca sola cada veinte
  segundos y avisa con un sonido** cuando entra una incidencia nueva.
- **Detalle** (`/ticket.html?id=N`): la ficha de la incidencia, el hilo de mensajes y los
  adjuntos. Las fotos se ven en miniatura y se abren a tamaño completo sin salir de la página, y
  los vídeos se reproducen ahí mismo. El hilo enfrenta los dos lados: lo que uno escribe va a la
  derecha y lo del otro a la izquierda. Estado, prioridad y asignación **se guardan al pulsar
  «Guardar»**, no al elegirlos, así que se pueden cambiar varias cosas de una vez.
- **Informes** (`/informes.html`): incidencias entradas, resueltas y pendientes por local,
  filtrables por **técnico**, grupo, local y rango de fechas, con tres gráficos: entradas por mes,
  reparto por local y cuántas están abiertas, pendientes y cerradas. El técnico del filtro es
  quien **tiene la incidencia asignada**, que es lo que significa «gestionada por»; al elegir uno,
  el último gráfico responde a cuántas tiene de cada. Un técnico solo ve sus propios números; el
  gestor y el administrador, los de todos.
- **Chat de local** (`/chat.html`): un canal por cada local, al estilo de los de IRC, donde
  hablan los que están dados de alta en él. Con fotos, vídeos y notas de voz, con el estado de
  cada mensaje —enviando, enviado, recibido, leído— y aguantando que se vaya la conexión: lo
  escrito sin cobertura sale solo al volver y no se duplica. Con moderación: se
  avisa de un mensaje, el administrador lo revisa en una cola y puede suspender la cuenta de
  quien se pase.
- **Administración**: Grupos, Locales, Usuarios, Moderación y Tareas programadas.
- **Notificaciones push** para la app móvil, por Firebase Cloud Messaging.
- **App de Android y iPhone** (`movil/`), en Flutter, con avisos que llegan con la app cerrada,
  el chat de local con su copia guardada en el teléfono y **modo sin conexión**: se sigue
  trabajando con lo último que se sabía y lo que se hace sale solo al volver la línea.

## Roles y visibilidad

Es la regla que sostiene la aplicación:

| Rol | Qué ve | Qué puede hacer |
|---|---|---|
| **Usuario** | Solo las incidencias que **ha abierto él**, en sus locales | Abrir incidencias y escribir en su hilo. Es el rol de las cuentas nuevas |
| **Empleado** | Todas las incidencias de **sus locales**, las haya abierto él o un compañero | Abrir incidencias en sus locales y escribir en el hilo |
| **Técnico** | Las de **su grupo** cuyo local esté entre los suyos | Lo mismo, más cambiar estado y prioridad y asignarse la incidencia. En informes, **solo los suyos** |
| **Gestor** | Todas | Supervisar: gestionar cualquier incidencia, ver los informes de **todos** los técnicos y llevar el programador de tareas. No toca cuentas ni catálogos |
| **Administrador** | Todas | Todo, más la gestión de catálogos y de las cuentas |

El **chat de local** sigue esta misma regla, mirada del revés: uno está en el canal de los
locales donde está dado de alta, y un técnico sin locales marcados o un gestor están en todos,
igual que ven todas sus incidencias.

Tres detalles que conviene tener presentes:

- **Un técnico sin ningún local marcado atiende todos los locales de su grupo.** Es el caso de
  Informática, que cubre el grupo entero. Marcar locales es lo que lo *limita*.
- **Un empleado siempre necesita al menos un local.** Sin él no podría abrir incidencias ni ver
  ninguna, así que el alta no lo permite.
- **Los técnicos también abren incidencias**, en los mismos locales que atienden. Pueden dirigirla
  a cualquier grupo: un técnico de Mantenimiento que se encuentra un ordenador averiado la abre
  para Informática, y a partir de ahí deja de verla, porque ya no es de su grupo. Cada grupo
  recibe únicamente lo suyo.

Ejemplo real, tal cual lo comprueban las pruebas: José (Mantenimiento, LOCAL 1) ve solo
Mantenimiento en LOCAL 1; Antonio (Mantenimiento, LOCAL 1 + LOCAL 2) ve esos dos locales; Santiago
(Informática, sin locales) ve toda Informática. Juan y María trabajan los dos en LOCAL 1, así que
cada uno ve las incidencias del otro.

Una incidencia que no le toca a un usuario responde **404**, no 403: así no se puede averiguar qué
hay al otro lado probando números.

## Cuentas y acceso

**El correo es el nombre de acceso.** Se pide al dar de alta y con él se entra;
cambiarlo cambia también con qué entra esa persona. Las cuentas anteriores a
esto no tienen correo y siguen entrando con su nombre de usuario de siempre, así
que nadie se queda fuera — pero sin correo no reciben avisos ni pueden
restablecer la contraseña.

Una cuenta nueva sale con el rol **Usuario** y el **local por defecto** de la instalación si no se
dice otra cosa, de modo que dar de alta a alguien es escribir su nombre y su
correo. Al empleado sí se le exige marcar un local a mano: ve también las
incidencias de sus compañeros, y eso es una decisión.

**Restablecer la contraseña** se pide desde la propia pantalla de acceso. Llega
un enlace que vale una hora y un solo uso. En la base se guarda el resumen del
vale y no el vale, así que quien leyera la base no podría entrar con él; al
cambiarla se cierran las sesiones abiertas, que es justo de lo que uno se quiere
proteger. La respuesta es la misma exista la cuenta o no, para que nadie
averigüe quién tiene cuenta probando direcciones.

## Entrar con Office 365

La pantalla de acceso puede llevar un botón que entra con la cuenta de Microsoft
de la organización, contra su tenant de **Entra ID**. Es una puerta más y no un
sustituto: quien tenga contraseña sigue entrando con ella, y la app móvil
también.

**Quien entra por ahí y no tenía cuenta la estrena** con el rol **Usuario** y el
**local por defecto**, lo mismo que un alta a mano en la que no se marque nada. De
ahí en adelante es una cuenta como las demás: si un administrador la asciende a
técnico o le cambia los locales, volver a entrar por Microsoft no le devuelve el
rol de partida. La cuenta queda atada al identificador de esa persona en el
tenant, que es lo único que no cambia si le cambian la dirección de correo.

Quien ya tenía cuenta con ese mismo correo entra en la suya y no en una nueva,
que es lo que hace que sus incidencias sigan siendo suyas. Una cuenta bloqueada
tampoco entra por aquí.

En **Usuarios**, las cuentas que entran así llevan la etiqueta **Office 365** al
lado de su correo, en la web y en la app. Sirve para saber a quién le sobra la
contraseña y de quién depende el acceso del tenant: si a esa persona la dan de
baja en Microsoft, deja de entrar aquí.

### Registrar la aplicación en Azure

En **Microsoft Entra ID › Registros de aplicaciones › Nuevo registro**:

1. Cuentas de **solo este directorio organizativo**. Con cualquiera de las otras
   opciones entraría cualquier cuenta de Microsoft, que es justo lo contrario de
   lo que se busca.
2. URI de redirección de tipo **Web**:
   `https://LA-DIRECCION-PUBLICA/api/entra/vuelta`. Microsoft la compara letra a
   letra con la que manda la aplicación.
3. De la página del registro salen el **Id. de aplicación (cliente)** y el **Id.
   de directorio (inquilino)**.
4. En **Certificados y secretos**, un secreto de cliente nuevo. Se copia su
   **Valor**, no su «Id.»: el valor solo se enseña una vez, al crearlo.

No hacen falta permisos añadidos: `openid`, `profile` y `email` son los que
cualquier registro trae de serie. Si el directorio tiene prohibido que la gente
consienta por su cuenta, un administrador lo concede una vez desde **Permisos de
API › Conceder consentimiento**.

En el servidor, `data/entra.json`:

```json
{
  "tenant": "EL-ID-DEL-TENANT",
  "cliente": "EL-ID-DE-LA-APLICACION",
  "secreto": "EL-VALOR-DEL-SECRETO",
  "url": "https://soporte.tu-dominio.com"
}
```

También valen los nombres tal cual los llama Azure (`tenant_id`, `client_id`,
`client_secret`), que es como salen del portal. `url` es la dirección pública de
la aplicación: de ella sale la de vuelta. Sin ella se deduce de la petición, lo
que sirve para probar en local y se equivoca en cuanto hay un proxy delante.

```bash
npm run entra
```

Enseña la configuración cargada, la dirección de vuelta que tiene que estar
registrada en Azure y si Microsoft reconoce el secreto, que es lo primero que
caduca — en Azure duran dos años como mucho.

Sin ese archivo el botón no aparece y todo lo demás sigue igual.

### En la app móvil

La app tiene el mismo botón, y **no hace falta registrar nada más en Azure**: no
se identifica ella, sino el navegador del teléfono, que es donde está la sesión
de Microsoft y donde se resuelve el segundo factor. La dirección de vuelta sigue
siendo la del servidor, la misma del paso 2.

Lo único que cambia es el final del recorrido. El token de sesión no puede
volver dentro de una dirección —lo vería el navegador, y con él cualquiera que
mirase el historial—, así que la vuelta termina en `/entra-movil.html` con un
vale de un solo uso que dura dos minutos, la página devuelve ese vale a la app
por su propio enlace (`com.ejemplo.soporte://entra`) y es la app la que lo
canjea por su token hablando directamente con el servidor.

El vale solo vale acompañado del verificador que la app se guardó al empezar,
que nunca sale del teléfono. Otra aplicación que se colara en ese enlace se
quedaría con un vale que no puede canjear.

Si el navegador no salta solo a la app —los hay que no lo hacen sin que alguien
toque—, esa página enseña un botón para volver.

## Abrir una incidencia en nombre de otra persona

Un técnico, un gestor o un administrador pueden atribuir la incidencia a otra
persona al abrirla, para cuando alguien cuenta una avería de palabra y la teclea
otro. La incidencia y su mensaje de apertura quedan a nombre de quien la
reporta, así que los avisos y el hilo le llegan a él. Solo a nombre de alguien
que pueda ver ese local. En blanco, va a nombre de quien la escribe.

## Avisos por correo

Van por la **API de mensajes de CloudMailin**, y son estos:

| Cuándo | A quién |
|---|---|
| Entra una incidencia en su grupo y local, sin asignar | A los técnicos que la atienden |
| Se le asigna una incidencia | Al técnico |
| Abre una incidencia | A quien la abre, como acuse de recibo |
| Alguien responde en el hilo | A todos los implicados |
| Cambia de estado o se cierra | A todos los implicados |

Los **implicados** son los mismos que en los avisos push, y están explicados en esa sección.

Quien no tiene correo no recibe nada, y a quien provoca el aviso nunca se le
avisa. El correo va en tablas con estilos en línea, que es lo único que respetan
a la vez Gmail, Outlook y el correo de iPhone, en una columna que se adapta al
móvil.

Se habla con la API directamente por HTTP —un POST con la clave en la cabecera—
igual que con Firebase en `notificaciones.js`, así que no hace falta ningún
cliente ni el `axios` que arrastra:

```
POST https://api.cloudmailin.com/api/v0.1/{usuario}/messages
Authorization: Bearer {clave}
{ "to": …, "from": …, "subject": …, "plain": …, "html": … }
```

**La aplicación funciona sin correo configurado**: si no encuentra el archivo,
lo anota al arrancar y no envía nada. Para activarlo, deja en `data/correo.json`:

```json
{
  "usuario": "EL-USUARIO-DE-CLOUDMAILIN",
  "clave": "LA-API-KEY",
  "remitente": "Soporte <soporte@tu-dominio.com>",
  "url": "https://soporte.tu-dominio.com"
}
```

También se admite pegar tal cual la URL SMTP que da CloudMailin en `"smtp"`, de
la que se sacan el usuario y la clave; el envío sigue yendo por la API.
`remitente` puede omitirse: por defecto sale de
lo que diga `data/organizacion.json`, que tiene que estar verificado en
CloudMailin o rechazará los envíos.

`url` es la dirección pública de la aplicación, la que se pone en los enlaces de
los correos; sin ella los avisos salen sin botón. Se puede apuntar a otro
archivo con la variable `CORREO_CONFIG`.

### Si no llega ningún correo

Los avisos se mandan sin esperar respuesta —un correo que falla no puede tumbar
la petición que lo dispara—, así que sus errores acaban en el registro del
servidor y es fácil no verlos. Para verlo de cara:

```bash
npm run correo                          # qué configuración ha cargado
npm run correo -- tu@ejemplo.com      # manda uno de prueba y enseña la respuesta
npm run correo -- tu@… --sin-enviar     # valida credenciales sin enviar nada
```

Dice lo que conteste CloudMailin, tal cual. Lo que suele salir:

| Qué se ve | Qué pasa |
|---|---|
| `Avisos por correo desactivados` | No hay `data/correo.json`, o no se puede leer |
| `No se pudo conectar` | El servidor no llega a `api.cloudmailin.com`: cortafuegos o política de salida del alojamiento |
| `401` o `403` | El usuario o el API token no son los de la cuenta |
| `422` | El remitente no está verificado en CloudMailin |
| `404` | El usuario de la ruta no existe |

Para saber solo si el servidor llega a CloudMailin, vale cualquier respuesta
HTTP: un `curl` a secas contra esa URL devuelve `404` —el endpoint solo acepta
POST— y eso ya demuestra que hay salida. Lo que distingue un problema de
credenciales de uno de red es el `npm run correo`, que sí hace el POST.

Un `403` que hable de *allowlist* o de *egress* no viene de CloudMailin: lo está
parando la red desde la que sale el servidor.

### Si a alguien en concreto no le llega ningún aviso

`npm run correo` y `npm run notificaciones` comprueban el transporte —que el
servidor hable con CloudMailin y con Firebase—, pero no dicen si una persona
en concreto es alcanzable por esos canales. Quien no tiene correo no recibe
avisos por email, y quien no tiene ningún dispositivo registrado —la app
nunca ha iniciado sesión en ese móvil— no recibe push; ninguno de los dos es
un error, se descartan en silencio, así que parece que «no funciona» cuando
en realidad no hay a dónde mandarlo. Para verlo de una incidencia concreta:

```bash
npm run quien-recibe -- 123     # sustituye 123 por el id de la incidencia
```

Enseña, para esa incidencia, quién es el técnico o el empleado que debería
recibir cada aviso y si tiene correo y dispositivo — lo que decide si de
verdad le llega.

**Los enlaces de los correos abren la app de Android** si está instalada. Para
que la abra directamente, sin preguntar, hay que publicar la huella del
certificado con el que se firma el APK:

```bash
keytool -list -v -keystore mi.jks -alias incidencias | grep SHA256
```

y dejarla en `data/assetlinks.json` como `["AA:BB:..."]`, o en la variable
`HUELLA_APP`. Sin ella los enlaces siguen funcionando: Android pregunta si
abrirlos con la app o con el navegador.

## Programador de tareas

El administrador define tareas recurrentes en `/tareas.html` con un formulario parecido al
programador de tareas de Windows: una fecha y una hora de inicio, y una de estas cuatro pautas.

| Frecuencia | Qué se elige |
|---|---|
| **Una vez** | Nada más: se abre ese día a esa hora y no vuelve |
| **Diaria** | Cada cuántos días se repite |
| **Semanal** | Cada cuántas semanas, y en qué días de la semana |
| **Mensual** | Qué días del mes, y en qué meses (los doce marcados = todos) |

Mientras se rellena, debajo del formulario se va escribiendo en castellano lo que se ha elegido
—«Los días 1 y 15 de enero, abril, julio y octubre a las 09:00»—, que es la misma frase que
aparece después en la columna «Cuándo» de la lista.

**También se programa desde el calendario**, pulsando un día: la ficha del día lleva un botón que
abre este mismo formulario ya puesto en esa fecha y como tarea de una sola vez, que es lo que se
suele querer cuando se ha señalado un día concreto. La pauta se puede cambiar antes de guardar.
Es el formulario de siempre, no otro: en la web se llega con `/tareas.html?fecha=2026-08-28` y en
la app se abre la misma `FichaTarea`. El botón solo aparece a quien puede programar, porque el
calendario lo ven también los técnicos y la ruta que guarda tareas se los rechaza.

- **Sin local, la tarea abre una incidencia por cada local.** Con local, solo una.
- Las incidencias que abre el programador no tienen persona que las cree: en la lista se ve el
  nombre de la tarea en la columna «Abierta por».
- Cada tarea recuerda hasta qué minuto se ha evaluado, así que **un reinicio no repite lo hecho ni
  se salta lo que venció con el servidor parado** — hasta una semana atrás; más allá no se
  recupera, para que un apagón largo no abra cientos de incidencias de golpe.
- Un día que no existe en un mes sencillamente no salta: el día 31 no se adelanta al 28 de
  febrero.
- **La hora es siempre la de España**, la tenga el servidor como la tenga. Una máquina recién
  instalada suele ir en UTC, y entonces «las 9:00» acabarían siendo las 11:00 de aquí en verano
  —o no saltarían ese día, si esa hora ya había pasado—, que desde fuera se ve como que el
  programador no funciona. La zona se fija en la aplicación y se puede cambiar con la variable
  `ZONA_HORARIA`.
- **La lista dice cuándo le toca a cada tarea la próxima vez.** Es lo que despeja la duda más
  habitual: una tarea puesta a una hora que ya pasó hoy no salta hasta mañana, y sin ese dato
  parece estropeada.
- «Ejecutar ahora» lanza la tarea al momento para comprobar que hace lo que se espera.

Las tareas que se hubieran guardado con el formato cron de la primera versión se convierten solas
al arrancar, conservando su identificador y las incidencias que ya habían abierto.

## Adjuntos

Se admiten fotos, vídeos y documentos (PDF, Word, Excel y texto). Las fotos y los documentos
llegan hasta 10 MB; los vídeos, hasta 120 MB.

**Los vídeos se comprimen en el propio navegador antes de subirlos**, sin librerías ni nada
instalado en el servidor: el vídeo se reproduce, sus fotogramas se vuelcan a un lienzo de menos
resolución y el resultado se graba a 1280 px de lado mayor. En las pruebas, un vídeo de 8 MB se
queda en 1,8 MB. Detalles que conviene saber:

- **Va en tiempo real**: un vídeo de medio minuto tarda medio minuto en comprimirse. Por eso hay
  barra de progreso, que es lo único de la aplicación que la tiene.
- Por debajo de 8 MB no se toca: la espera no compensa.
- Si la recompresión no gana tamaño, se sube el original.
- **Safari en iPhone no sabe hacerlo** (le falta volcar el vídeo a un flujo). Ahí el vídeo se sube
  tal cual, y por eso el tope del servidor es holgado.

## Chat de local

Un canal de conversación por cada local, en `/chat.html`, para lo que no es una
incidencia: el turno de esta tarde, quién tiene la llave del almacén, la foto de
una avería antes de decidir si abrir el parte. Está separado del hilo de las
incidencias a propósito — ahí se habla de una avería concreta y queda con ella;
aquí se habla del local.

**En el canal de un local está quien está dado de alta en ese local**, y no hay
nada que crear ni a nadie que invitar. Son exactamente las mismas reglas con
las que la aplicación decide en qué locales puede uno abrir incidencias, con
las dos excepciones de siempre: el técnico que no tiene ningún local marcado
atiende todos, así que está en todos los canales, y el gestor y el
administrador ven el grupo entero. Un canal en el que uno no está responde
**404**, como una incidencia ajena.

Los canales se llaman como los de IRC —`#local-1`, `#sede-central`— porque es el
mismo modelo: salas permanentes en las que se entra por pertenecer a un sitio y
no por haber sido invitado.

Cualquier mensaje con texto se puede **copiar**, sea de quien sea: en la web,
con el botón que sale al pasar por encima del globo, junto a la cruz de borrar
y la banderita de avisar; en el móvil, manteniéndolo pulsado. Copia el texto
solo, sin nombre ni hora — se pega en un buscador, en un correo o en el campo
de una incidencia, y ahí la cabecera sobra.

### Qué se puede mandar

Texto, fotos, vídeos, documentos y **notas de voz**. Los formatos y los topes
son los de los adjuntos de una incidencia —los vídeos se comprimen igual en el
navegador antes de subir— más el audio, que llega hasta 20 MB: una nota de voz
en Opus ocupa poco más de un kilobyte por segundo, así que eso son horas.

La nota de voz se graba con el botón del micrófono y **se manda sola al parar**:
nadie graba una nota para luego tener que darle a enviar. Una grabación de menos
de un segundo se descarta, que es un dedo resbalado y no un mensaje. Lo graba el
propio navegador; en Chrome, Firefox y Edge sale en WebM/Opus y en Safari en
MP4/AAC, y el servidor guarda las dos cosas.

Cada uno puede borrar sus mensajes, y el administrador cualquiera. El mensaje
borrado **deja su hueco** («Mensaje eliminado»): si desapareciera del todo, la
conversación de los demás cambiaría por detrás.

### Estado de los mensajes

Los mismos cuatro de cualquier chat, en el propio globo:

| Marca | Qué significa |
|---|---|
| 🕓 | **Enviando**: escrito, todavía no ha llegado al servidor |
| ✓ | **Enviado**: el servidor lo tiene y no se va a perder |
| ✓✓ | **Recibido**: le ha llegado al aparato de alguien más del canal |
| ✓✓ en negro | **Leído**: alguien más lo ha tenido en pantalla |
| ↻ en rojo | No se ha podido mandar. Se reintenta solo |

«Recibido» y «leído» son **por alguien**, no por todos: en un canal de ocho
personas esperar a las ocho no diría nada útil. Por debajo no se guarda un acuse
por mensaje y persona, sino **dos números por persona y canal** —hasta dónde ha
recibido y hasta dónde ha leído—, porque una conversación se lee siempre hacia
adelante: «he leído hasta el 120» dice lo mismo que ciento veinte acuses y no
crece con el uso. Los dos números solo suben, así que un acuse que llegue tarde
no puede devolver un canal a «sin leer».

### Qué pasa cuando se va la conexión

Es el caso normal, no la excepción: los locales tienen wifi irregular y la
gente entra y sale de la cámara.

- **Lo que se escribe sin cobertura se manda solo cuando vuelve.** Queda en el
  globo marcado como pendiente y se reintenta con esperas cada vez más largas,
  hasta medio minuto. Sobrevive a cerrar la pestaña: se guarda en el navegador
  y sale al volver a entrar.
- **Reintentar no duplica nada.** Cada mensaje lleva un identificador que pone
  quien escribe, antes de mandarlo; si el envío llegó pero la respuesta no, el
  servidor devuelve el mensaje que ya tenía en vez de escribir otro. Por eso se
  puede reintentar a ciegas.
- **Al recuperar la conexión se piden los mensajes que falten**, a partir del
  último que se tenía. No hace falta acertar con lo que se perdió, ni importa
  cuánto haya durado el corte.
- El archivo se sube **antes** que el mensaje, igual que los adjuntos de una
  incidencia: una subida que se corta no deja un globo roto en la conversación
  de todo el local.
- Un punto junto a «Canales» dice si la conexión está viva. Sin él, «no llega
  nada» y «no ha escrito nadie» se ven exactamente igual.

### Cómo viaja

Los mensajes salen por HTTP corriente y entran por un **flujo de eventos del
servidor** (`GET /api/chat/flujo`, *server-sent events*): una sola conexión por
persona para todos sus canales, que es lo que ya habla el navegador sin
librerías, sin un puerto aparte y atravesando cualquier proxy. Por ahí llegan
los mensajes nuevos, los acuses, el «está escribiendo» y quién está conectado.

Ese flujo **solo avisa**: la verdad está en la base y se pide con las rutas
normales. Es lo que hace que perderlo no pierda nada — al reconectar, el
servidor manda «ponte al día» y la pantalla lo pide desde donde se quedó.

Detrás de un proxy hace falta que no acumule la respuesta en un búfer: la ruta
manda `X-Accel-Buffering: no`, que es lo que entienden Nginx y el proxy de
AApanel, y un latido cada veinte segundos para que nadie dé la conexión por
muerta.

**Por qué no un servidor de IRC de verdad.** Lo que se pide —hablar desde la web
y desde el móvil, con fotos y notas de voz, y saber si el mensaje ha llegado y
si alguien lo ha leído— no cabe en el protocolo: un navegador no abre una
conexión de IRC, IRC no guarda lo que se dijo mientras uno no estaba, no
transporta archivos ni tiene acuses de lectura, y haría falta un segundo puerto
abierto y una segunda forma de identificarse, con las cuentas de esta
aplicación. Lo que se ha tomado de IRC es el modelo de canales, que es lo que
encaja con «un chat por local».

### Avisos

Un mensaje nuevo avisa por **push** a quien no tiene el chat abierto en ese
momento; a quien está conectado no, que ya le ha llegado por el flujo y el
teléfono no tiene por qué sonar dos veces. **Por correo no se avisa nunca**: un
canal de local son muchos mensajes al día y el buzón no es sitio para eso.

El número de mensajes sin leer va en el propio enlace «Chat» de la barra, en
todas las pantallas, y se refresca cada medio minuto. Un chat del que uno no se
entera hasta que entra a mirarlo no sirve de nada.

El aviso de chat **abre el canal** al pulsarlo en la app móvil, igual que uno de
incidencia abre su ficha.

### Moderación

En una conversación escribe gente, y a veces alguien se pasa. Hay tres cosas
para eso, y las tres hacen falta —las dos tiendas las piden para publicar una
app con chat, pero además sin ellas quien lo sufre no tiene a dónde acudir sin
salirse de la aplicación—:

- **Avisar de un mensaje.** En el globo de cualquier mensaje ajeno, la banderita
  en la web y «Avisar al administrador» al mantenerlo pulsado en el móvil. Se
  puede explicar por qué, o mandarlo en blanco. El mensaje **no se borra ni se
  esconde**: lo decide quien lo recibe, que es quien tiene el contexto.
- **La cola de moderación**, en Administración › Moderación, solo para el
  administrador. Sale lo que hay pendiente, lo más viejo arriba, con el mensaje
  señalado y quién avisó. Desde ahí se borra el mensaje, se suspende al autor o
  se despacha el aviso sin tocar nada, que también es una decisión. El número
  de pendientes va en la barra, junto a «Administración».

  **Está también en la app**, con lo mismo dentro. No es un capricho: el plazo
  para atender un aviso se cuenta en horas, el push que dice que hay algo que
  mirar llega al teléfono, y quien lo recibe no está sentado delante de un
  ordenador.
- **A quien avisó se le contesta.** Cuando su aviso se resuelve —se haya
  borrado el mensaje o no— le llega un push que lo dice, y que abre el canal
  para que vea en qué quedó. Avisar de algo y que no conteste nadie es peor que
  no tener el botón: la segunda vez ya no avisas.
- **Suspender la cuenta**, en Administración › Usuarios o desde la propia cola.
  Deja de poder entrar —por contraseña y por Office 365—, se le cierran las
  sesiones abiertas en el momento y sale de los canales y de los desplegables
  de asignación. Lo que ya escribió se queda: es historial.

Suspender no es lo mismo que el **bloqueo por intentos fallidos**, aunque las
dos cosas impidan entrar. Aquella la pone la máquina sola a los diez fallos y
se levanta con «Reactivar acceso»; esta la pone una persona y solo esa persona
la quita. Son dos columnas distintas justamente para que reactivar el acceso de
alguien por despiste no lo devuelva a la conversación.

Eliminar la cuenta casi nunca es la respuesta: una cuenta con incidencias a su
nombre no se borra, porque se llevaría el historial por delante.

### En la app móvil

La misma conversación y las mismas reglas, con lo que un teléfono necesita y un
navegador no. Está contado entero en `movil/README.md`; en resumen:

- **La conversación se guarda en el teléfono**, en una base propia de cada
  cuenta, y es de ahí de donde se pinta: abrir un canal es instantáneo.
- **De la red solo viene lo que falta**, a partir del último mensaje guardado.
  Un canal que nunca se ha abierto no descarga nada hasta que se entra, y el
  historial se trae por páginas al subir por él —solo si a la copia le falta.
- **Los archivos van a la carpeta temporal**: las fotos se descargan al
  aparecer en pantalla y las que se pasan de largo cancelan su descarga; los
  vídeos, las notas de voz y los documentos, al pulsarlos. En la galería solo
  entra lo que se manda guardar a mano.
- **En tiempo real con la app delante**, y al fondo se corta el flujo y avisa el
  push; al volver se reconecta y se pone al día.
- **Lo escrito sin cobertura sale solo** cuando vuelve la red, aunque se haya
  cerrado la app por el camino.

## Notificaciones push

Los tres avisos de la especificación, todos por Firebase Cloud Messaging:

| Cuándo | A quién |
|---|---|
| Se abre una incidencia | A los técnicos de su grupo con visibilidad sobre ese local |
| Alguien escribe en el hilo | A todos los implicados |
| Se asigna la incidencia | A quien se la asignan |
| Cambia de estado | A todos los implicados |

**Implicados** son quien la abrió, quien la tiene asignada y quien haya escrito en el hilo; si no
está asignada, se suman los técnicos que la ven, porque entonces sigue siendo del grupo entero.
Al autor de lo que provoca el aviso no se le avisa, y a las cuentas bloqueadas tampoco.

**El primer técnico que contesta a una incidencia sin asignar se la queda.** Escribir «voy a
mirarlo» es cogerla, y antes había que acordarse de asignársela aparte: quedaban incidencias
atendidas pero sin dueño, que ensucian los informes, y el departamento entero seguía recibiendo
cada mensaje de una avería que ya llevaba otro. Solo se asigna a un técnico de su mismo grupo,
que es lo único que admite la asignación; un gestor o un administrador contestan sin quedársela,
y reasignar a mano sigue funcionando igual.

Antes cada aviso tenía su propia regla, y entre unas y otras quedaban huecos silenciosos: un
gestor contestaba y el técnico asignado no se enteraba, dos técnicos sobre la misma avería no se
oían, y quien escribía siendo el asignado no avisaba a nadie. Nada de eso daba error, así que
duró. Lo cubre `test/avisos.test.js`.

**La app funciona sin Firebase configurado**: si no encuentra las credenciales, anota una línea en
el registro al arrancar y no envía nada. Para activarlas, deja el JSON de la cuenta de servicio de
Firebase en `data/fcm.json` (o apunta a él con la variable `FCM_CREDENCIALES`) y reinicia. Los
tokens que Firebase da por muertos se borran solos.

La app móvil registra su token con `POST /api/dispositivos` al iniciar sesión y cada vez que
Firebase se lo cambie. El aviso lleva `ticket_id` en `data`, para abrir la incidencia al pulsar la
notificación.

El aviso se manda con `notification` además de `data`, que es lo que hace que **el móvil lo enseñe
con la app cerrada**: lo pinta el propio Android, sin tener que despertar la aplicación. Va
dirigido al canal `incidencias_avisos`, y ese identificador tiene que ser el mismo en el servidor,
en el manifiesto de la app y en el canal que la app crea al arrancar — desde Android 8 un aviso a
un canal que no existe se descarta sin mostrarse. El bloque `apns` viaja desde ya para la app de
iPhone.

### Si no llega ninguna notificación

Igual que el correo, los avisos se mandan sin esperar respuesta, así que sus errores acaban en el
registro del servidor y es fácil no verlos. Para verlo de cara:

```bash
npm run notificaciones                          # qué configuración ha cargado
npm run notificaciones -- tu@ejemplo.com      # avisa a todos los dispositivos de esa cuenta
npm run notificaciones -- UN-TOKEN-DE-DISPOSITIVO   # avisa a un token concreto
```

Sin destino, solo pide un token de acceso a Google: ya demuestra que las credenciales y la salida a
internet funcionan, sin gastar ningún envío real. Lo que suele salir:

| Qué se ve | Qué pasa |
|---|---|
| `Notificaciones push desactivadas` | No hay `data/fcm.json`, o no se puede leer |
| `No se pudo conectar` | El servidor no llega a Google: cortafuegos o política de salida del alojamiento |
| `Firebase rechazó las credenciales` | El JSON de la cuenta de servicio no es válido o ha sido revocado |
| `No hay ninguna cuenta con el correo…` | Esa persona no tiene cuenta, o su cuenta no tiene ese correo |
| `no tiene ningún dispositivo registrado` | La app aún no ha iniciado sesión en ese teléfono |

Un `403` que hable de *allowlist* o de *egress* tampoco viene de Google aquí: lo está parando la
red desde la que sale el servidor, igual que con el correo.

## App móvil

En `movil/` está la aplicación de **Android y iPhone**, hecha en Flutter contra esta misma API.
Añade lo que la web no puede dar: **avisos con la aplicación cerrada**. Es el mismo código para las
dos; la de iPhone necesita además un Mac para firmarla y compilarla, y `movil/IOS.md` lleva de la
mano por esa parte.

```bash
cd movil
flutter pub get
flutter run
```

Para que lleguen los avisos hace falta dar de alta la app en un proyecto de Firebase y dejar su
`google-services.json` en `movil/android/app/` — no viene en el repositorio, porque es de cada
instalación; está explicado en `movil/README.md`. **Sin él la app compila y funciona igual**, solo
que sin avisos. La de iPhone pide además su `GoogleService-Info.plist` y la carpeta `ios/`, que se genera
en el Mac: `movil/IOS.md`. Los detalles de las dos, en `movil/README.md`.

En la aplicación se entra con el correo y la contraseña, o con **Office 365** si está
configurado; cómo vuelve del navegador está más arriba, en «Entrar con Office 365».

## Instalación

```bash
npm install
npm start           # http://localhost:3003
```

La primera vez se crea el usuario **admin / admin**; cámbiale la contraseña desde Usuarios antes
de nada. También se siembran los dos departamentos y cuatro locales de ejemplo, que se editan
desde Administración y que lo normal es cambiar el primer día.

### Ponerle tu nombre

El programa no lleva dentro el nombre de ninguna empresa. Para que la app deje de presentarse
como «Soporte», `data/organizacion.json`:

```json
{
  "nombre": "MI EMPRESA",
  "url": "https://soporte.mi-empresa.com",
  "correo": "soporte@mi-empresa.com",
  "privacidad": "privacidad@mi-empresa.com",
  "local_por_defecto": "OFICINA"
}
```

De ahí salen la marca de la barra, el título de las pantallas, la cabecera de los correos y el
remitente por defecto de los avisos. `local_por_defecto` es el local con el que nace una cuenta a
la que nadie le marca ninguno, y es también el primero que se siembra en una instalación nueva:
conviene ponerlo **antes** del primer arranque, o habrá que renombrar ese local a mano desde
Administración.

Ninguna clave es obligatoria. Sin el archivo, la aplicación funciona igual y se presenta con
nombres genéricos, que es lo que permite probarla recién clonada.

Falta una cosa más para dejarla del todo tuya, y no es opcional si vas a publicarla: rellenar
`public/privacidad.html`, que viene como plantilla. Está más abajo, en «La política de
privacidad».

### Dónde viven los datos

En `data/`, fuera del control de versiones:

```
data/incidencias.db      base de datos SQLite
data/adjuntos/<id>/      archivos adjuntos de cada incidencia
data/chat/<local_id>/    fotos, vídeos y notas de voz del chat de cada local
data/organizacion.json   con qué nombre se presenta la instalación (opcional)
data/fcm.json            credenciales de Firebase (opcional)
data/correo.json         credenciales de CloudMailin y dirección pública (opcional)
data/entra.json          tenant y credenciales de Office 365 (opcional)
data/assetlinks.json     huella del APK, para los enlaces de los correos en Android (opcional)
data/equipo-apple.json   equipo de Apple, para esos mismos enlaces en iPhone (opcional)

La ruta de la base se puede cambiar con `INCIDENCIAS_DB`; los adjuntos van siempre a su lado.
```

**Copias de seguridad: basta con copiar la carpeta `data/`.**

### Dejarla con datos de demostración

```bash
node tools/demo.js        # dice lo que va a borrar, y no lo hace
node tools/demo.js --si   # lo hace
```

Sustituye el contenido por una empresa de hostelería inventada: tres locales, nueve incidencias
en los tres estados —unas con hilo, otras cerradas hace semanas para que los informes tengan
datos—, cinco tareas repartidas por el calendario, inventario, lavandería y conversación en el
canal de chat de cada local, con un mensaje sin leer esperando, que es como se encuentra un chat
de verdad al abrirlo. Para enseñar la
aplicación, o para que la revisen en las tiendas sin que vean datos de nadie.

**Las cuentas se conservan**, con sus contraseñas, sus sesiones abiertas y sus móviles
registrados para los avisos. Como los grupos y los locales sí se van, las cuentas que había se
reenganchan al mundo nuevo: los técnicos a Mantenimiento y sin locales marcados (que aquí
significa que atienden todos), y los demás a los tres locales. Un técnico con el grupo colgando
no vería ninguna incidencia y parecería que el programa está roto.

Además crea siete cuentas `demo.*` con una contraseña que el propio comando imprime.

**Esto borra datos y no hay vuelta atrás.** Sin `--si` solo enumera lo que se llevaría por
delante, que es la forma de mirarlo antes. Los adjuntos en disco también se van, porque sin sus
filas no los alcanza nadie.

### La política de privacidad

`public/privacidad.html` **es una plantilla y hay que rellenarla** antes de poner esto en
producción, y desde luego antes de publicar la app en las tiendas. El servidor la publica en
`/privacidad.html` sin pedir sesión, porque es lo que exigen las dos, y la app enlaza a ella
desde la pantalla de acceso y desde su menú.

Lo que hay que rellenar está marcado dentro con `[NOMBRE DE LA ORGANIZACIÓN]`,
`[DIRECCIÓN DEL SERVIDOR]`, `[CORREO DE CONTACTO]` y `[FECHA]`, y son los apartados 1 y 7 más
las direcciones de contacto. **No es una formalidad**: quien administra el servidor donde viven
los datos es el responsable del tratamiento, y los derechos del apartado 8 se ejercen contra una
dirección que tiene que estar atendida de verdad.

El resto del documento describe lo que hace el programa y sirve igual en cualquier instalación,
mientras nadie cambie qué datos se recogen.

**Y si se cambia lo que se recoge, hay que pasar por ahí.** El chat de local es el ejemplo de por
qué: trajo grabaciones de voz, acuses de entrega y lectura, una copia de las conversaciones en el
teléfono y avisos que llevan dentro el comienzo del mensaje. Ninguna de esas cinco cosas estaba en
la política y las cinco tuvieron que entrar, además de las etiquetas de privacidad de las dos
tiendas (`movil/TIENDA.md`). Un documento que describe una versión anterior del programa es peor
que no tenerlo.

### Despliegue en AApanel

Es una aplicación Node sin build, sin Docker y sin proxy inverso: se añade como proyecto Node en
AApanel apuntando a `server.js`, con `npm install` hecho y el puerto que se quiera en la variable
`PORT` (por defecto 3004). El programador de tareas va dentro del propio proceso, así que no hace
falta un cron del sistema, y sus horas no dependen de cómo esté configurada la máquina.

## Pruebas

```bash
npm test
```

Cubren la planificación de las tareas y la API entera contra un servidor de verdad: el escenario
de roles de la especificación, quién ve qué, el hilo, los adjuntos, los informes, el programador y
la protección del acceso. Las del chat abren el flujo de eventos igual que lo abre el navegador y
comprueban lo que no se puede mirar a ojo: que un canal ajeno no exista, que reintentar un envío
no duplique el mensaje, que el estado pase por sus cuatro escalones y que lo que se perdió sin
conexión se recupere desde donde se dejó. La entrada con Office 365 se prueba de punta a punta contra un Microsoft
de mentira que firma sus propios identificadores, así que la firma, el «nonce», el «state» y el
verificador de PKCE se comprueban sin salir a internet; también el recorrido de la app, con su
vale de un solo uso.

La app móvil tiene las suyas, que se ejecutan aparte:

```bash
cd movil && flutter test
```

Cubren lo que no necesita un teléfono delante: la traducción de lo que manda la API a lo que se
guarda en el teléfono y de vuelta, la cola de mensajes del chat que sobrevive a cerrar la app, y
cuándo se da la línea por caída y por recuperada. Lo demás —la base local, el micrófono, la
galería y la franja de «sin conexión»— se prueba en el móvil.

## Decisiones respecto a la especificación

Estas son las decisiones que explican por qué el proyecto tiene la forma que tiene. Todas van en
la misma dirección: que esto se despliegue copiando archivos en un alojamiento corriente, sin
Docker ni servicios aparte.

- **SQLite en vez de PostgreSQL.** La base es un archivo dentro de `data/` y la copia de seguridad
  es copiar esa carpeta. El volumen de una organización con unas cuantas decenas de locales le
  sobra de largo. El acceso a datos está en `db.js`, así que migrar más adelante es acotado.
- **Sesiones con token en tabla, en vez de JWT.** La web lo lleva en una cookie `HttpOnly` y la
  app móvil en la cabecera `Authorization: Bearer` — `POST /api/login` devuelve el token para eso.
  A cambio de un JWT se gana poder cerrar sesiones desde el servidor, que es lo que hace falta al
  cambiar una contraseña o bloquear una cuenta.
- **HTML plano en vez de React o Vue.** Sin build, sin framework, desplegable copiando archivos.
  La app móvil, en cambio, es Flutter: ahí no hay alternativa razonable si se quieren avisos con
  la aplicación cerrada.
- **Sin dependencias más allá de Express y SQLite.** La planificación de las tareas
  (`planificacion.js`), el envío a Firebase (`notificaciones.js`, que firma el JWT de la cuenta
  de servicio con `crypto`), el correo por CloudMailin (`correo.js`, un POST con la clave en la
  cabecera) y la entrada con Office 365 (`entra.js`, que comprueba la firma del identificador con
  las claves del tenant en vez de traerse MSAL) están escritos aquí en lugar de traer librerías.
- **La planificación se guarda por partes, no como expresión cron.** El cron es compacto pero no
  hay quien lo lea sin práctica, y además no sabe decir «una sola vez» ni «cada dos semanas».
  Guardar frecuencia, hora, fecha de inicio y días sueltos permite el formulario de Windows y
  cubre esas dos pautas.

- **El chat de local va por eventos del servidor, no por IRC ni por WebSocket.** El motivo
  está entero en su apartado: IRC no llega a lo que se pide y un WebSocket obligaría a traer
  una librería y a que el proxy del alojamiento admita la actualización de protocolo, cuando lo
  que hace falta es un aviso en un solo sentido —del servidor al navegador— que cualquier proxy
  deja pasar. Lo que va del navegador al servidor son peticiones normales, que es lo que permite
  reintentarlas.

Añadidos pequeños sobre el modelo de datos de la especificación, todos por necesidad de las
pantallas pedidas:

- `tickets.cerrado_en` — sin la fecha de cierre no se puede contar cuántas se **resolvieron** en un
  rango, que es lo que pide el panel de informes.
- `tickets.tarea_id` — para saber qué tarea abrió una incidencia y poder decirlo en la lista.
- `tareas_programadas.prioridad` y `evaluada_hasta` — la prioridad porque toda incidencia tiene
  una, y la marca de evaluación para no repetir ni perder vencimientos entre reinicios.
- `tareas_programadas.frecuencia`, `hora`, `fecha_inicio`, `cada`, `dias_semana`, `dias_mes` y
  `meses` — sustituyen a `cron_expresion` para poder ofrecer el formulario de arriba.
- `adjuntos.mensaje_id` — un adjunto puede colgar de la incidencia o de un mensaje concreto del
  hilo, que es lo que pide «adjuntar al crearlo o en mensajes posteriores».
- `chat_mensajes`, `chat_adjuntos`, `chat_borradores` y `chat_lecturas` — el chat de local.
  Aparte de `mensajes` porque no cuelgan de ninguna incidencia, y con su propia tabla de
  borradores porque admiten un formato más, el audio de las notas de voz.
- `chat_denuncias` y `usuarios.suspendida` — la moderación del chat. La denuncia se guarda en
  vez de mandarse solo por push porque un aviso que se lee una vez y desaparece no es una cola
  de trabajo, y lo que las tiendas preguntan es si a esto se le contesta.

## Fuera de esta versión

- Canal de correo o WhatsApp, base de conocimientos, SLA y escalado automático, tal como decía la
  especificación.
