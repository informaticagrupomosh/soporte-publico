'use strict';

/**
 * Entrar con la cuenta de Office 365 del grupo, contra Microsoft Entra ID.
 *
 * Es OpenID Connect con código de autorización y PKCE, escrito aquí en vez de
 * traerse MSAL: son dos peticiones HTTP y una firma que comprobar, y el resto
 * de la aplicación ya habla igual con Firebase (`notificaciones.js`) y con
 * CloudMailin (`correo.js`).
 *
 *   1. `/api/entra/entrar` manda a la persona a Microsoft con un «state», un
 *      «nonce» y el reto de PKCE, que quedan anotados en `entra_intentos`.
 *   2. Microsoft la devuelve a `/api/entra/vuelta` con un código.
 *   3. El código se canjea hablando directamente con Microsoft, y del
 *      identificador que llega se comprueban la firma, quién lo emite, para
 *      quién es y que responde a esta entrada y no a otra.
 *   4. Con el correo de ese identificador se busca la cuenta. Si no existe se
 *      crea con el rol «usuario» y el local por defecto; a partir de ahí es
 *      una cuenta como las demás y su rol y sus locales se cambian desde
 *      Usuarios como los de cualquiera.
 *
 * Es una puerta más, no un sustituto: quien tiene contraseña sigue entrando
 * con ella.
 *
 * La app móvil hace el mismo recorrido, pero por el navegador del teléfono,
 * que es donde está la sesión de Microsoft y donde se puede resolver un segundo
 * factor. Como el token de sesión no puede volver dentro de una dirección —lo
 * vería el navegador, y con él cualquiera que mirase su historial—, la vuelta
 * termina en un vale de un solo uso que la app canjea por su token hablando
 * ella directamente con el servidor. El vale solo vale con el verificador que
 * se guardó la app al empezar, así que otra aplicación que se colara en el
 * enlace no podría usarlo.
 *
 * La configuración vive fuera del repositorio, igual que las credenciales de
 * Firebase y las del correo: en `data/entra.json` o donde diga la variable de
 * entorno `ENTRA_CONFIG`. Sin ese archivo la aplicación funciona igual, solo
 * que la pantalla de acceso no enseña el botón.
 *
 * ```json
 * {
 *   "tenant": "EL-ID-DEL-TENANT",
 *   "cliente": "EL-ID-DE-LA-APLICACION",
 *   "secreto": "EL-VALOR-DEL-SECRETO",
 *   "url": "https://soporte.tu-dominio.com"
 * }
 * ```
 *
 * También valen los nombres tal cual los llama Azure —`tenant_id`,
 * `client_id`, `client_secret`—, que es como salen del portal.
 *
 * `url` es la dirección pública de la aplicación, de la que sale la dirección
 * de vuelta que hay que registrar en Azure. Sin ella se deduce de la petición,
 * que sirve para probar en local pero se equivoca en cuanto haya un proxy
 * delante.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const auth = require('./auth');

const RUTA = process.env.ENTRA_CONFIG || path.join(__dirname, 'data', 'entra.json');
const AUTORIDAD_POR_DEFECTO = 'https://login.microsoftonline.com';

// Donde Microsoft devuelve a la persona. Tiene que ser idéntica a la
// registrada en Azure y a la que se manda al pedir el código: Microsoft las
// compara letra a letra.
const RUTA_VUELTA = '/api/entra/vuelta';

// Lo que puede tardar alguien entre que pulsa el botón y termina de
// identificarse en Microsoft, contraseña y segundo factor incluidos.
const MINUTOS_INTENTO = 10;

// Los relojes del servidor y de Microsoft no van al segundo. Cinco minutos es
// lo que da por bueno todo el mundo para las fechas del identificador.
const HOLGURA_RELOJ = 300;

// Un tenant compartido dejaría entrar a cualquier cuenta de Microsoft, que es
// justo lo contrario de lo que se quiere.
const TENANTS_COMPARTIDOS = ['common', 'organizations', 'consumers'];

const COOKIE_INTENTO = 'incidencias_entra';

// Lo que tarda la app en canjear el vale: lo que se tarda en volver del
// navegador, y nada más.
const MINUTOS_VALE = 2;

let ajustes = null;
let avisado = false;

function texto(v) {
  return String(v == null ? '' : v).trim();
}

/**
 * Un error con un mensaje que se le puede enseñar a quien está intentando
 * entrar. Los demás se quedan en el registro del servidor: dicen cosas del
 * tenant y de la aplicación que no le sirven de nada a quien mira la pantalla.
 */
function visible(mensaje) {
  const error = new Error(mensaje);
  error.visible = true;
  return error;
}

function cargar() {
  if (ajustes !== null) return ajustes;
  try {
    const json = JSON.parse(fs.readFileSync(RUTA, 'utf8'));
    const tenant = texto(json.tenant || json.tenant_id);
    const cliente = texto(json.cliente || json.client_id);
    const secreto = texto(json.secreto || json.client_secret);
    if (!tenant || !cliente || !secreto) {
      throw new Error('faltan «tenant», «cliente» o «secreto»');
    }
    if (TENANTS_COMPARTIDOS.includes(tenant.toLowerCase())) {
      throw new Error(
        `«tenant» tiene que ser el del grupo y no «${tenant}»: `
        + 'con ese entraría cualquier cuenta de Microsoft'
      );
    }
    ajustes = {
      tenant,
      cliente,
      secreto,
      autoridad: texto(json.autoridad || AUTORIDAD_POR_DEFECTO).replace(/\/+$/, ''),
      url: texto(json.url).replace(/\/+$/, '')
    };
    console.log('Acceso con Office 365 activo.');
  } catch (e) {
    ajustes = false;
    if (!avisado) {
      avisado = true;
      console.log(`Acceso con Office 365 desactivado: no se pudo leer ${RUTA} (${e.message}).`);
    }
  }
  return ajustes;
}

function activo() {
  return Boolean(cargar());
}

/**
 * Cómo ha quedado la configuración, para poder mirarla sin destripar el
 * archivo. El secreto se enseña recortado: lo justo para reconocerlo y no para
 * usarlo.
 */
function estado() {
  if (!cargar()) return { activo: false, ruta: RUTA };
  return {
    activo: true,
    ruta: RUTA,
    tenant: ajustes.tenant,
    cliente: ajustes.cliente,
    secreto: `${ajustes.secreto.slice(0, 3)}…${ajustes.secreto.slice(-2)}`,
    autoridad: ajustes.autoridad,
    url: ajustes.url || '(sin definir: la dirección de vuelta se deduce de la petición)',
    vuelta: ajustes.url ? `${ajustes.url}${RUTA_VUELTA}` : `(la de la petición)${RUTA_VUELTA}`
  };
}

/**
 * La dirección de vuelta que se manda a Microsoft.
 *
 * Con `url` configurada es siempre la misma, que es lo que hay que registrar
 * en Azure. Sin ella se compone con lo que diga la petición, mirando primero
 * la cabecera del proxy: en local funciona y detrás de un proxy mal puesto se
 * nota enseguida, porque Microsoft rechaza la dirección.
 */
function direccionDeVuelta(req) {
  if (cargar() && ajustes.url) return `${ajustes.url}${RUTA_VUELTA}`;
  const reenviado = texto(req.headers['x-forwarded-proto']).split(',')[0].trim();
  return `${reenviado || req.protocol}://${req.headers.host}${RUTA_VUELTA}`;
}

// ---------- Lo que dice Microsoft de sí mismo ----------

// El documento de descubrimiento trae las direcciones del tenant y quién firma
// sus identificadores. Cambia muy de tarde en tarde: se guarda un día.
let descubierto = { datos: null, expira: 0 };

async function descubrir() {
  if (descubierto.datos && Date.now() < descubierto.expira) return descubierto.datos;
  const url = `${ajustes.autoridad}/${encodeURIComponent(ajustes.tenant)}/v2.0/.well-known/openid-configuration`;
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    // Ni se ha llegado a hablar con Microsoft: lo que hay que revisar es la
    // salida a internet del servidor, no el registro de la aplicación.
    throw new Error(
      `No se pudo conectar con ${url}: ${e.message}. `
      + 'Comprueba que el servidor tiene salida a login.microsoftonline.com por HTTPS.'
    );
  }
  if (!res.ok) {
    throw new Error(`Microsoft respondió ${res.status} al pedir la configuración del tenant (${url}).`);
  }
  const datos = await res.json();
  for (const campo of ['authorization_endpoint', 'token_endpoint', 'jwks_uri', 'issuer']) {
    if (!datos[campo]) throw new Error(`la configuración del tenant no trae «${campo}»`);
  }
  descubierto = { datos, expira: Date.now() + 24 * 3600 * 1000 };
  return datos;
}

// Las claves con las que Microsoft firma, por «kid».
let claves = { porKid: new Map(), pedidas: 0 };

async function clavePublica(kid) {
  if (claves.porKid.has(kid)) return claves.porKid.get(kid);
  // Microsoft rota sus claves, así que una que no conocemos se vuelve a pedir.
  // No más de una vez por minuto: si no, bastaría con inventarse un «kid» para
  // que cada intento se convirtiera en una petición a Microsoft.
  if (Date.now() - claves.pedidas < 60 * 1000) return null;
  const { jwks_uri: jwksUri } = await descubrir();
  const res = await fetch(jwksUri);
  if (!res.ok) throw new Error(`Microsoft respondió ${res.status} al pedir sus claves de firma.`);
  const json = await res.json();
  const porKid = new Map();
  for (const jwk of json.keys || []) {
    if (jwk.kty !== 'RSA' || (jwk.use && jwk.use !== 'sig')) continue;
    try {
      porKid.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' }));
    } catch (e) {
      // Una clave que no sepamos leer no invalida las demás.
    }
  }
  claves = { porKid, pedidas: Date.now() };
  return porKid.get(kid) || null;
}

// ---------- El identificador (id_token) ----------

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function trozoJson(parte) {
  return JSON.parse(Buffer.from(parte, 'base64url').toString('utf8'));
}

/**
 * Comprueba el identificador que manda Microsoft y devuelve sus datos.
 *
 * El identificador llega por una conexión que hemos abierto nosotros contra
 * Microsoft, así que el TLS ya dice de quién viene; aun así se comprueba la
 * firma, que es lo que sostiene todo lo demás. Después van las cuatro
 * preguntas de siempre: quién lo emite, para quién es, si sigue vigente y si
 * responde a esta entrada —el «nonce»— y no a una anterior.
 */
async function comprobarIdentificador(idToken, nonce) {
  const partes = texto(idToken).split('.');
  if (partes.length !== 3) throw new Error('el identificador no tiene la forma de un JWT');

  const cabecera = trozoJson(partes[0]);
  if (cabecera.alg !== 'RS256') {
    throw new Error(`el identificador viene firmado con ${cabecera.alg} y no con RS256`);
  }
  const clave = await clavePublica(cabecera.kid);
  if (!clave) throw new Error('no se reconoce la clave con la que viene firmado el identificador');
  const firmado = crypto.createVerify('RSA-SHA256')
    .update(`${partes[0]}.${partes[1]}`)
    .verify(clave, Buffer.from(partes[2], 'base64url'));
  if (!firmado) throw new Error('la firma del identificador no cuadra');

  const datos = trozoJson(partes[1]);
  const { issuer } = await descubrir();
  if (datos.iss !== issuer) {
    throw new Error(`el identificador lo emite ${datos.iss} y no ${issuer}`);
  }
  const para = Array.isArray(datos.aud) ? datos.aud : [datos.aud];
  if (!para.includes(ajustes.cliente)) {
    throw new Error('el identificador no es para esta aplicación');
  }
  if (!datos.nonce || datos.nonce !== nonce) {
    throw new Error('el identificador no responde a esta entrada');
  }
  const ahora = Math.floor(Date.now() / 1000);
  if (!(Number(datos.exp) > ahora - HOLGURA_RELOJ)) {
    throw new Error('el identificador ha caducado');
  }
  if (datos.nbf && Number(datos.nbf) > ahora + HOLGURA_RELOJ) {
    throw new Error('el identificador todavía no vale');
  }
  return datos;
}

// ---------- La ida y la vuelta ----------

/**
 * Prepara la entrada y devuelve a dónde hay que mandar al navegador.
 *
 * El «state» vuelve por dos caminos —la redirección y una cookie de este
 * navegador— y luego se comparan. La fila guarda lo que no puede viajar: el
 * «nonce» y el verificador de PKCE.
 */
async function comenzar(direccion, retoApp = null) {
  const { authorization_endpoint: autorizacion } = await descubrir();
  const estadoIntento = crypto.randomBytes(32).toString('hex');
  const nonce = crypto.randomBytes(32).toString('hex');
  const verificador = base64url(crypto.randomBytes(32));
  const reto = base64url(crypto.createHash('sha256').update(verificador).digest());

  db.prepare("DELETE FROM entra_intentos WHERE expira_en < datetime('now')").run();
  db.prepare(`
    INSERT INTO entra_intentos (estado, nonce, verificador, reto_app, expira_en)
    VALUES (?, ?, ?, ?, datetime('now', '+${MINUTOS_INTENTO} minutes'))
  `).run(estadoIntento, nonce, verificador, retoApp || null);

  const url = new URL(autorizacion);
  url.search = new URLSearchParams({
    client_id: ajustes.cliente,
    response_type: 'code',
    response_mode: 'query',
    redirect_uri: direccion,
    scope: 'openid profile email',
    state: estadoIntento,
    nonce,
    code_challenge: reto,
    code_challenge_method: 'S256'
  }).toString();

  return { url: url.toString(), estado: estadoIntento };
}

/** Cambia el código por el identificador, hablando de servidor a servidor. */
async function canjear(codigo, verificador, direccion) {
  const { token_endpoint: canje } = await descubrir();
  const res = await fetch(canje, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: ajustes.cliente,
      client_secret: ajustes.secreto,
      grant_type: 'authorization_code',
      code: codigo,
      redirect_uri: direccion,
      code_verifier: verificador,
      scope: 'openid profile email'
    }).toString()
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.id_token) {
    // El cuerpo trae el código AADSTS, que es lo que dice de verdad qué falla
    // —el secreto caducado, la dirección de vuelta que no cuadra—, así que se
    // arrastra entero hasta el registro.
    const detalle = json.error_description || json.error || `respuesta ${res.status}`;
    throw new Error(`Microsoft no aceptó el código: ${texto(detalle).slice(0, 500)}`);
  }
  return json.id_token;
}

/**
 * Termina la entrada: gasta el intento, canjea el código y devuelve los datos
 * del identificador ya comprobados, junto con el reto de la app si la entrada
 * la empezó ella.
 */
async function completar({ codigo, estado: estadoVuelto, estadoCookie, direccion }) {
  if (!estadoVuelto || estadoVuelto !== estadoCookie) {
    // Sin esta comparación, cualquiera podría empezar una entrada suya y
    // hacerle abrir la vuelta a otra persona, que acabaría dentro con una
    // cuenta que no es la suya.
    throw visible('Esta entrada no es de este navegador. Vuelve a intentarlo.');
  }
  const intento = db.prepare(
    "SELECT * FROM entra_intentos WHERE estado = ? AND expira_en > datetime('now')"
  ).get(estadoVuelto);
  // De un solo uso, salga bien o mal: un código que se canjea dos veces es
  // señal de que alguien lo ha copiado por el camino.
  db.prepare('DELETE FROM entra_intentos WHERE estado = ?').run(estadoVuelto);
  if (!intento) throw visible('La entrada ha caducado. Vuelve a intentarlo.');
  if (!texto(codigo)) throw visible('Microsoft no ha devuelto ningún código.');

  const idToken = await canjear(texto(codigo), intento.verificador, direccion);
  const datos = await comprobarIdentificador(idToken, intento.nonce);
  return { datos, app: intento.reto_app || null };
}

// ---------- La cuenta ----------

/**
 * El correo que trae el identificador.
 *
 * `preferred_username` es lo que la persona escribe para entrar en Office y lo
 * que sale siempre; `email` solo viene si el buzón lo tiene puesto, y `upn` es
 * el de las cuentas antiguas. Vale el primero que parezca una dirección.
 */
function correoDe(datos) {
  for (const candidato of [datos.preferred_username, datos.email, datos.upn]) {
    const valor = texto(candidato).toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor)) return valor;
  }
  return '';
}

/**
 * La cuenta de esta persona, creándola la primera vez.
 *
 * Se busca primero por el identificador del tenant, que no cambia aunque en
 * Microsoft le cambien la dirección, y después por el correo, que es como
 * enlaza con la cuenta que ya tuviera aquí de antes.
 *
 * La cuenta nueva sale con el rol «usuario» y el local por defecto, lo mismo
 * que un alta a mano en la que no se marque nada. Lo que se cambie luego desde
 * Usuarios manda: entrar otra vez con Office 365 no le devuelve el rol de
 * partida a nadie.
 */
function cuentaDe(datos) {
  const email = correoDe(datos);
  if (!email) {
    throw visible('Tu cuenta de Microsoft no trae ninguna dirección de correo con la que identificarte.');
  }
  const oid = texto(datos.oid) || null;
  const nombre = texto(datos.name) || email;

  let fila = oid && db.prepare('SELECT * FROM usuarios WHERE entra_oid = ?').get(oid);
  if (!fila) {
    fila = db.prepare(
      'SELECT * FROM usuarios WHERE lower(email) = ? OR lower(usuario) = ?'
    ).get(email, email);
  }

  if (fila) {
    const cerrada = auth.motivoSinAcceso(fila);
    if (cerrada) throw visible(cerrada);
    // La cuenta que ya existía queda atada al tenant la primera vez que se
    // entra así. El correo se deja como está: aquí es el nombre de acceso, y
    // cambiarlo por lo que diga Microsoft dejaría fuera a quien entre con
    // contraseña.
    if (oid && fila.entra_oid !== oid) {
      db.prepare('UPDATE usuarios SET entra_oid = ? WHERE id = ?').run(oid, fila.id);
    }
    if (!fila.email) {
      db.prepare('UPDATE usuarios SET email = ? WHERE id = ?').run(email, fila.id);
    }
    return db.prepare('SELECT * FROM usuarios WHERE id = ?').get(fila.id);
  }

  const local = db.prepare('SELECT id FROM locales WHERE nombre = ?').get(auth.LOCAL_POR_DEFECTO);
  if (!local) {
    throw new Error(`no existe el local «${auth.LOCAL_POR_DEFECTO}», que es el de las cuentas nuevas`);
  }

  // La contraseña de una cuenta que nace de Office 365 no la sabe nadie, ni
  // hace falta: se entra por Microsoft. Quien luego quiera una la pide desde
  // «He olvidado la contraseña», que va a su correo.
  const passwordHash = auth.hashPassword(crypto.randomBytes(32).toString('hex'));

  const alta = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO usuarios (usuario, email, nombre, rol, password_hash, entra_oid)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(email, email, nombre, auth.ROL_POR_DEFECTO, passwordHash, oid);
    db.prepare('INSERT OR IGNORE INTO usuario_local (usuario_id, local_id) VALUES (?, ?)')
      .run(info.lastInsertRowid, local.id);
    return info.lastInsertRowid;
  })();

  console.log(`Cuenta creada al entrar con Office 365: ${email}.`);
  return db.prepare('SELECT * FROM usuarios WHERE id = ?').get(alta);
}

// ---------- Comprobación ----------

/**
 * Habla con Microsoft y cuenta cómo ha ido, para `tools/probar-entra.js`.
 *
 * Además de las direcciones del tenant y de las claves de firma, prueba el
 * secreto pidiendo un token de la propia aplicación: es la única forma de
 * saber si sigue valiendo sin mandar a nadie a identificarse. Que Microsoft
 * conteste que a la aplicación le faltan permisos ya demuestra lo que
 * interesa, que ha reconocido el secreto.
 */
async function probar() {
  if (!cargar()) throw new Error(`No hay configuración de Office 365 en ${RUTA}.`);
  const config = await descubrir();
  const res = await fetch(config.jwks_uri);
  if (!res.ok) throw new Error(`Microsoft respondió ${res.status} al pedir sus claves de firma.`);
  const jwks = await res.json();

  const credenciales = await fetch(config.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: ajustes.cliente,
      client_secret: ajustes.secreto,
      grant_type: 'client_credentials',
      scope: 'https://graph.microsoft.com/.default'
    }).toString()
  });
  const json = await credenciales.json().catch(() => ({}));

  return {
    emisor: config.issuer,
    autorizacion: config.authorization_endpoint,
    canje: config.token_endpoint,
    claves: (jwks.keys || []).length,
    // `invalid_client` es el secreto; cualquier otra queja es de los permisos
    // de la aplicación y no estorba para entrar.
    secretoValido: credenciales.ok || json.error !== 'invalid_client',
    detalle: texto(json.error_description || json.error).slice(0, 300)
  };
}

// ---------- El vale de la app móvil ----------

// El reto es el resumen SHA-256 de lo que se guarda la app, en base64url: 43
// caracteres. Se comprueba antes de guardarlo porque viene de fuera.
function retoValido(v) {
  return /^[A-Za-z0-9_-]{43}$/.test(texto(v));
}

function resumen(v) {
  return crypto.createHash('sha256').update(String(v)).digest('hex');
}

/**
 * Crea el vale con el que la app cambia esta entrada por su token.
 *
 * En la base queda el resumen y no el vale, igual que con los enlaces para
 * restablecer la contraseña: quien leyera la base no podría canjearlo. Y va
 * atado al reto de la app, que es lo que impide que sirva en otras manos.
 */
function valeParaApp(usuarioId, reto) {
  db.prepare("DELETE FROM entra_vales WHERE expira_en < datetime('now')").run();
  const vale = crypto.randomBytes(32).toString('hex');
  db.prepare(`
    INSERT INTO entra_vales (vale_hash, usuario_id, reto, expira_en)
    VALUES (?, ?, ?, datetime('now', '+${MINUTOS_VALE} minutes'))
  `).run(resumen(vale), usuarioId, reto);
  return vale;
}

/**
 * Canjea el vale por la cuenta, si el verificador cuadra con el reto.
 *
 * El vale se gasta se acierte o no: es de un solo uso, y así probar
 * verificadores no sale gratis.
 */
function cuentaDelVale(vale, verificador) {
  const fila = db.prepare(
    "SELECT * FROM entra_vales WHERE vale_hash = ? AND expira_en > datetime('now')"
  ).get(resumen(texto(vale)));
  if (!fila) throw visible('Ese acceso ya no vale. Vuelve a intentarlo.');
  db.prepare('DELETE FROM entra_vales WHERE vale_hash = ?').run(fila.vale_hash);

  const esperado = base64url(crypto.createHash('sha256').update(texto(verificador)).digest());
  if (!texto(verificador) || esperado !== fila.reto) {
    throw visible('Ese acceso no es de esta aplicación.');
  }
  const cuenta = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(fila.usuario_id);
  if (!cuenta) throw visible('La cuenta ya no existe.');
  const cerrada = auth.motivoSinAcceso(cuenta);
  if (cerrada) throw visible(cerrada);
  return cuenta;
}

// ---------- La cookie del intento ----------

// Vale lo que dure el intento y solo se manda de vuelta a estas rutas.
function marcarIntento(res, estadoIntento) {
  res.append('Set-Cookie',
    `${COOKIE_INTENTO}=${estadoIntento}; Path=/api/entra; HttpOnly; SameSite=Lax; Max-Age=${MINUTOS_INTENTO * 60}`);
}

function olvidarIntento(res) {
  res.append('Set-Cookie', `${COOKIE_INTENTO}=; Path=/api/entra; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function intentoDe(req) {
  const cabecera = req.headers.cookie || '';
  for (const parte of cabecera.split(';')) {
    const [nombre, ...resto] = parte.trim().split('=');
    if (nombre === COOKIE_INTENTO) return resto.join('=');
  }
  return null;
}

module.exports = {
  RUTA_VUELTA,
  retoValido,
  valeParaApp,
  cuentaDelVale,
  activo,
  estado,
  direccionDeVuelta,
  comenzar,
  completar,
  cuentaDe,
  correoDe,
  probar,
  marcarIntento,
  olvidarIntento,
  intentoDe
};
