'use strict';

/**
 * Deja la carpeta `ios/` como tiene que quedar, después de generarla con
 * `flutter create --platforms=ios .`.
 *
 * Lo que genera Flutter es una app de ejemplo: sirve para arrancar y no sabe
 * nada de esta. Lo que falta —el esquema por el que vuelve la entrada con
 * Office 365, los textos de los permisos, el aviso en segundo plano, el
 * identificador del paquete, el dominio de los enlaces de los correos y que
 * esto es una app de teléfono— es siempre lo mismo, así que se pone aquí en
 * vez de en una lista de pasos que alguien tendrá que repetir a mano en cada
 * Mac.
 *
 *   node tools/ios.js
 *   node tools/ios.js --dominio=soporte.tu-dominio.com
 *
 * Se puede volver a ejecutar las veces que haga falta: lo que ya está puesto no
 * se toca. Nada de esto necesita un Mac; lo que sí lo necesita es compilar.
 */

const fs = require('fs');
const path = require('path');

const IOS = path.join(__dirname, '..', 'ios');
const PLIST = path.join(IOS, 'Runner', 'Info.plist');
const ENTITLEMENTS = path.join(IOS, 'Runner', 'Runner.entitlements');
const PBXPROJ = path.join(IOS, 'Runner.xcodeproj', 'project.pbxproj');

// El mismo de Android: una sola app en las dos tiendas.
const PAQUETE = 'com.ejemplo.soporte';

// Lo que se lee bajo el icono. El mismo `android:label` del manifiesto: la app
// se llama igual en los dos sitios.
const NOMBRE = 'Incidencias';

// El dominio desde el que se abren los enlaces de los correos. Igual que
// `manifestPlaceholders.dominio` en `android/app/build.gradle`.
const DOMINIO_POR_DEFECTO = 'soporte.tu-dominio.com';

const argumento = (nombre) => {
  const encontrado = process.argv.slice(2).find((a) => a.startsWith(`--${nombre}=`));
  return encontrado ? encontrado.slice(nombre.length + 3).trim() : '';
};

const dominio = argumento('dominio') || DOMINIO_POR_DEFECTO;

const hechos = [];
const pendientes = [];

// ---------- Info.plist ----------

/**
 * Pone una clave si no está.
 *
 * Lo que ya esté puesto se respeta: puede haberlo cambiado alguien a mano desde
 * Xcode, y no es cosa de este script decidir que se equivocaba.
 */
function ponerEnPlist(plist, clave, valorXml) {
  if (plist.includes(`<key>${clave}</key>`)) {
    hechos.push(`${clave}: ya estaba`);
    return plist;
  }
  const cierre = plist.lastIndexOf('</dict>');
  if (cierre === -1) throw new Error('Info.plist no tiene la forma esperada');
  hechos.push(`${clave}: puesto`);
  return `${plist.slice(0, cierre)}\t<key>${clave}</key>\n${valorXml}${plist.slice(cierre)}`;
}

/**
 * El nombre bajo el icono.
 *
 * Aquí no vale con «si ya está, no lo toco»: las versiones recientes de Flutter
 * lo dejan puestas ellas, con el nombre del proyecto tal cual está en el
 * pubspec —«incidencias», en minúscula—, y eso es lo que se leería en el
 * teléfono. Se cambia solo si sigue siendo lo que genera Flutter; si alguien lo
 * ha puesto a mano, manda lo suyo.
 */
function ponerElNombre(plist) {
  const puesto = plist.match(/<key>CFBundleDisplayName<\/key>\s*<string>([^<]*)<\/string>/);
  if (!puesto) {
    return ponerEnPlist(plist, 'CFBundleDisplayName', `\t<string>${NOMBRE}</string>\n`);
  }
  const valor = puesto[1].trim();
  if (valor === NOMBRE) {
    hechos.push('CFBundleDisplayName: ya estaba');
    return plist;
  }
  // «Runner» es el nombre del target; lo otro, el del proyecto en minúscula.
  const generado = valor.toLowerCase() === NOMBRE.toLowerCase() || valor === 'Runner';
  if (!generado) {
    hechos.push(`CFBundleDisplayName: se respeta «${valor}»`);
    return plist;
  }
  hechos.push(`CFBundleDisplayName: «${valor}» → «${NOMBRE}»`);
  return plist.replace(puesto[0], `<key>CFBundleDisplayName</key>\n\t<string>${NOMBRE}</string>`);
}

function arreglarPlist() {
  let plist = fs.readFileSync(PLIST, 'utf8');

  // Por aquí vuelve la entrada con Office 365. Tiene que decir lo mismo que el
  // enlace de `public/entra-movil.html`, que `Entra.esquema` en la app y que el
  // «intent-filter» de Android.
  plist = ponerEnPlist(plist, 'CFBundleURLTypes',
    '\t<array>\n'
    + '\t\t<dict>\n'
    + '\t\t\t<key>CFBundleTypeRole</key>\n'
    + '\t\t\t<string>Editor</string>\n'
    + `\t\t\t<key>CFBundleURLName</key>\n\t\t\t<string>${PAQUETE}</string>\n`
    + `\t\t\t<key>CFBundleURLSchemes</key>\n\t\t\t<array>\n\t\t\t\t<string>${PAQUETE}</string>\n\t\t\t</array>\n`
    + '\t\t</dict>\n'
    + '\t</array>\n');

  // Sin estos textos Apple rechaza la app, y con el móvil en la mano son lo que
  // se lee en el diálogo del permiso: conviene que expliquen para qué es.
  plist = ponerEnPlist(plist, 'NSCameraUsageDescription',
    '\t<string>Para hacer fotos y vídeos de las averías y adjuntarlos a la incidencia.</string>\n');
  plist = ponerEnPlist(plist, 'NSPhotoLibraryUsageDescription',
    '\t<string>Para adjuntar a la incidencia fotos y vídeos que ya tengas.</string>\n');
  // El micrófono es de dos cosas: el sonido de los vídeos de la cámara —que es
  // otro permiso aparte aunque nadie lo pida por su cuenta— y las notas de voz
  // del chat.
  plist = ponerEnPlist(plist, 'NSMicrophoneUsageDescription',
    '\t<string>Para grabar el sonido de los vídeos de las averías y las notas de voz del chat.</string>\n');
  // Escribir en el carrete es un permiso distinto de leerlo, y solo hace falta
  // si alguien guarda ahí una foto o un vídeo que le han mandado por el chat.
  plist = ponerEnPlist(plist, 'NSPhotoLibraryAddUsageDescription',
    '\t<string>Para guardar en tu carrete una foto o un vídeo del chat, cuando lo pidas.</string>\n');

  // Lo que deja que un aviso con «content-available» despierte la app por
  // detrás, igual que en Android.
  plist = ponerEnPlist(plist, 'UIBackgroundModes',
    '\t<array>\n\t\t<string>remote-notification</string>\n\t</array>\n');

  // Que Flutter no toque los enlaces con los que se abre la app.
  //
  // Por su cuenta, iOS convierte esa dirección en una «ruta» y se la empuja al
  // Navigator. Esta aplicación no usa rutas con nombre —navega con
  // `Navigator.push`—, así que la vuelta de Office 365 la reventaba con un
  // «Could not find a generator for route …?vale=…». De los enlaces se encarga
  // `servicios/enlaces.dart`, que es quien sabe qué hacer con ellos; en Android
  // esto no hace falta porque allí el intent no se convierte en ruta.
  plist = ponerEnPlist(plist, 'FlutterDeepLinkingEnabled', '\t<false/>\n');

  plist = ponerElNombre(plist);

  // La app solo habla HTTPS con su servidor: no usa criptografía de la que haya
  // que declarar nada. Decirlo aquí ahorra la misma pregunta en cada subida a
  // TestFlight.
  plist = ponerEnPlist(plist, 'ITSAppUsesNonExemptEncryption', '\t<false/>\n');

  fs.writeFileSync(PLIST, plist);
}

// ---------- Los enlaces de los correos ----------

/**
 * El dominio asociado, que es lo que hace que `…/ticket.html?id=N` abra la app
 * y no Safari. La otra mitad la sirve el servidor en
 * `/.well-known/apple-app-site-association`.
 *
 * A diferencia de Android, aquí no hay término medio: o está esto y el archivo
 * del servidor, o el enlace nunca abre la app.
 */
function arreglarEntitlements() {
  const linea = `applinks:${dominio}`;

  if (!fs.existsSync(ENTITLEMENTS)) {
    fs.writeFileSync(ENTITLEMENTS,
      '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
      + '<plist version="1.0">\n<dict>\n'
      + '\t<key>com.apple.developer.associated-domains</key>\n'
      + `\t<array>\n\t\t<string>${linea}</string>\n\t</array>\n`
      + '</dict>\n</plist>\n');
    hechos.push(`Runner.entitlements: creado con ${linea}`);
    pendientes.push(
      'En Xcode, Signing & Capabilities: añade «Push Notifications» y\n'
      + '    «Associated Domains». Al hacerlo, Xcode engancha este archivo al\n'
      + '    proyecto; el dominio ya está escrito dentro.'
    );
    return;
  }

  let texto = fs.readFileSync(ENTITLEMENTS, 'utf8');
  if (texto.includes(linea)) {
    hechos.push(`Runner.entitlements: ${linea} ya estaba`);
    return;
  }
  if (texto.includes('com.apple.developer.associated-domains')) {
    // Xcode deja la capacidad con la lista vacía, y según la versión la escribe
    // abierta o cerrada sobre sí misma: los dos casos, de una vez, para no
    // arriesgarse a meter el dominio dos veces.
    texto = texto.replace(
      /(<key>com\.apple\.developer\.associated-domains<\/key>\s*)(<array\/>|<array>)/,
      (todo, clave, apertura) => (apertura === '<array/>'
        ? `${clave}<array>\n\t\t<string>${linea}</string>\n\t</array>`
        : `${clave}<array>\n\t\t<string>${linea}</string>`)
    );
  } else {
    const cierre = texto.lastIndexOf('</dict>');
    texto = `${texto.slice(0, cierre)}\t<key>com.apple.developer.associated-domains</key>\n`
      + `\t<array>\n\t\t<string>${linea}</string>\n\t</array>\n${texto.slice(cierre)}`;
  }

  // Si el archivo tuviera una forma que no reconocemos, más vale decirlo que
  // dar por puesto un dominio que no está: sin él los enlaces no abren la app y
  // no hay ningún error que lo cuente.
  if (!texto.includes(linea)) {
    pendientes.push(
      `No he sabido escribir «${linea}» en Runner.entitlements.\n`
      + '    Añádelo a mano en Associated Domains, desde Xcode.'
    );
    return;
  }
  fs.writeFileSync(ENTITLEMENTS, texto);
  hechos.push(`Runner.entitlements: añadido ${linea}`);
}

// ---------- El identificador de la app ----------

/**
 * Flutter deja `com.example.…` en las tres configuraciones (Debug, Release y
 * Profile). Se cambia por el nuestro sin tocar el sufijo de las pruebas, que
 * tiene que seguir colgando del identificador principal.
 */
function arreglarPaquete() {
  const antes = fs.readFileSync(PBXPROJ, 'utf8');
  const despues = antes.replace(
    /PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g,
    (entero, valor) => {
      const sufijo = valor.trim().match(/\.(RunnerTests|RunnerUITests)$/);
      return `PRODUCT_BUNDLE_IDENTIFIER = ${PAQUETE}${sufijo ? sufijo[0] : ''};`;
    }
  );
  if (antes === despues) {
    hechos.push(`identificador: ya era ${PAQUETE}`);
    return;
  }
  fs.writeFileSync(PBXPROJ, despues);
  hechos.push(`identificador: ${PAQUETE}`);
}

// ---------- Solo iPhone ----------

/**
 * Flutter marca las dos familias, iPhone y iPad, y esta app nunca se ha
 * probado en una tableta: es una lista pensada para el ancho de un teléfono.
 *
 * Eso no es un detalle estético. Declarar iPad significa que App Store Connect
 * exige capturas de iPad y que quien revise la app en Apple la va a abrir en
 * uno, donde la interfaz sale estirada — y ese es motivo de rechazo. Se declara
 * lo que se sostiene.
 *
 * Si algún día se adapta de verdad, aquí se vuelve a poner «1,2».
 */
function arreglarFamilia() {
  const antes = fs.readFileSync(PBXPROJ, 'utf8');
  const despues = antes.replace(/TARGETED_DEVICE_FAMILY = "?[^;"]+"?;/g,
    'TARGETED_DEVICE_FAMILY = "1";');
  if (antes === despues) {
    hechos.push('familia de aparatos: ya era solo iPhone');
    return;
  }
  fs.writeFileSync(PBXPROJ, despues);
  hechos.push('familia de aparatos: solo iPhone');
}

// ---------- Adelante ----------

if (!fs.existsSync(PLIST) || !fs.existsSync(PBXPROJ)) {
  console.log(`
No hay carpeta «ios/» que arreglar. Se genera desde «movil/», en un Mac con
Xcode instalado:

  flutter create --platforms=ios .

No toca «lib/», «android/» ni «pubspec.yaml»: solo añade lo que falta. Después,
vuelve a ejecutar esto.
`);
  process.exitCode = 1;
} else {
  arreglarPlist();
  arreglarEntitlements();
  arreglarPaquete();
  arreglarFamilia();

  console.log('\nLa carpeta ios/ queda así:\n');
  for (const hecho of hechos) console.log(`  ${hecho}`);
  console.log(`\n  enlaces de los correos: applinks:${dominio}`);
  if (pendientes.length) {
    console.log('\nLo que hay que hacer en Xcode, que es donde vive la firma:\n');
    for (const pendiente of pendientes) console.log(`  - ${pendiente}`);
  }
  console.log('\nEl resto está en IOS.md.\n');
}
