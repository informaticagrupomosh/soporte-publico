'use strict';

/**
 * La entrada con Office 365, de punta a punta.
 *
 * Microsoft se sustituye por un servidor de mentira que habla su mismo idioma:
 * publica su documento de descubrimiento, sus claves de firma y su canje de
 * códigos, y firma identificadores con una clave recién hecha. Así se puede
 * comprobar lo que de verdad sostiene esto —la firma, el «nonce», el «state» y
 * el verificador de PKCE— sin salir a internet.
 *
 * El recorrido es el del navegador: se piden las direcciones a mano y se
 * llevan las cookies de una a otra.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Base y configuración propias de este archivo: las pruebas corren a la vez.
const DATA_DIR = path.join(__dirname, '..', 'data', 'pruebas');
process.env.INCIDENCIAS_DB = path.join(DATA_DIR, 'entra.db');
process.env.ENTRA_CONFIG = path.join(DATA_DIR, 'entra.json');
fs.mkdirSync(DATA_DIR, { recursive: true });
for (const sufijo of ['', '-wal', '-shm']) {
  fs.rmSync(`${process.env.INCIDENCIAS_DB}${sufijo}`, { force: true });
}

const TENANT = '11111111-2222-3333-4444-555555555555';
const CLIENTE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const SECRETO = 'el-secreto-de-mentira';
const KID = 'clave-de-prueba';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

function base64url(v) {
  return Buffer.from(v).toString('base64url');
}

function firmar(datos, { clave = privateKey, kid = KID } = {}) {
  const cabecera = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
  const cuerpo = base64url(JSON.stringify(datos));
  const firma = crypto.createSign('RSA-SHA256').update(`${cabecera}.${cuerpo}`).sign(clave);
  return `${cabecera}.${cuerpo}.${base64url(firma)}`;
}

// ---------- El Microsoft de mentira ----------

// Los códigos que ha repartido, con lo que hay que devolver al canjearlos.
const codigos = new Map();
let autoridad;
let emisor;

// Lo que contesta el canje del código, para poder torcerlo en una prueba.
let identificadorDe = (pendiente) => firmar({
  iss: emisor,
  aud: CLIENTE,
  sub: 'sub-de-quien-entra',
  oid: 'oid-de-quien-entra',
  tid: TENANT,
  preferred_username: 'Nuria@ejemplo.com',
  name: 'Nuria Prats',
  nonce: pendiente.nonce,
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600
});

function cuerpoDe(req) {
  return new Promise((listo) => {
    let texto = '';
    req.on('data', (trozo) => { texto += trozo; });
    req.on('end', () => listo(new URLSearchParams(texto)));
  });
}

const microsoft = http.createServer(async (req, res) => {
  const url = new URL(req.url, autoridad);
  res.setHeader('Content-Type', 'application/json');

  if (url.pathname === `/${TENANT}/v2.0/.well-known/openid-configuration`) {
    return res.end(JSON.stringify({
      issuer: emisor,
      authorization_endpoint: `${autoridad}/${TENANT}/oauth2/v2.0/authorize`,
      token_endpoint: `${autoridad}/${TENANT}/oauth2/v2.0/token`,
      jwks_uri: `${autoridad}/${TENANT}/discovery/v2.0/keys`
    }));
  }

  if (url.pathname === `/${TENANT}/discovery/v2.0/keys`) {
    const jwk = publicKey.export({ format: 'jwk' });
    return res.end(JSON.stringify({ keys: [{ ...jwk, kid: KID, use: 'sig', alg: 'RS256' }] }));
  }

  if (url.pathname === `/${TENANT}/oauth2/v2.0/token`) {
    const form = await cuerpoDe(req);
    const pendiente = codigos.get(form.get('code'));
    const reto = pendiente && base64url(
      crypto.createHash('sha256').update(form.get('code_verifier') || '').digest()
    );
    if (!pendiente
        || form.get('client_id') !== CLIENTE
        || form.get('client_secret') !== SECRETO
        || form.get('redirect_uri') !== pendiente.direccion
        || reto !== pendiente.reto) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'AADSTS de mentira' }));
    }
    // Los códigos son de un solo uso también aquí.
    codigos.delete(form.get('code'));
    return res.end(JSON.stringify({ token_type: 'Bearer', id_token: identificadorDe(pendiente) }));
  }

  res.statusCode = 404;
  res.end('{}');
});

const app = require('../server');
const db = require('../db');

let servidor;
let base;

before(async () => {
  microsoft.listen(0);
  await new Promise((listo) => microsoft.once('listening', listo));
  autoridad = `http://127.0.0.1:${microsoft.address().port}`;
  emisor = `${autoridad}/${TENANT}/v2.0`;
  fs.writeFileSync(process.env.ENTRA_CONFIG, JSON.stringify({
    tenant: TENANT, cliente: CLIENTE, secreto: SECRETO, autoridad
  }));

  servidor = app.listen(0);
  await new Promise((listo) => servidor.once('listening', listo));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => {
  if (servidor) servidor.close();
  microsoft.close();
  fs.rmSync(process.env.ENTRA_CONFIG, { force: true });
});

// ---------- El recorrido del navegador ----------

function cookie(res, nombre) {
  for (const puesta of res.headers.getSetCookie()) {
    const [par] = puesta.split(';');
    const [clave, ...resto] = par.split('=');
    if (clave === nombre) return resto.join('=');
  }
  return null;
}

/** Pulsa el botón y devuelve a dónde manda Microsoft, con la cookie del intento. */
async function irAMicrosoft({ app = '' } = {}) {
  const res = await fetch(`${base}/api/entra/entrar${app ? `?app=${app}` : ''}`, { redirect: 'manual' });
  assert.strictEqual(res.status, 302);
  const url = new URL(res.headers.get('location'));
  return {
    url,
    intento: cookie(res, 'incidencias_entra'),
    estado: url.searchParams.get('state'),
    nonce: url.searchParams.get('nonce'),
    reto: url.searchParams.get('code_challenge'),
    direccion: url.searchParams.get('redirect_uri')
  };
}

/** Lo que hace Microsoft cuando la persona ya se ha identificado: repartir un código. */
function codigoPara(ida) {
  const codigo = crypto.randomBytes(8).toString('hex');
  codigos.set(codigo, { nonce: ida.nonce, reto: ida.reto, direccion: ida.direccion });
  return codigo;
}

function volver(codigo, estado, intento) {
  const cabeceras = intento === null ? {} : { Cookie: `incidencias_entra=${intento}` };
  return fetch(`${base}/api/entra/vuelta?code=${codigo}&state=${estado}`, {
    redirect: 'manual', headers: cabeceras
  });
}

// ---------- Pruebas ----------

test('el botón lleva a Microsoft con el reto de PKCE y la vuelta de esta aplicación', async () => {
  const estado = await (await fetch(`${base}/api/entra/estado`)).json();
  assert.strictEqual(estado.activo, true);
  // Lo que le dice a la app que aquí su recorrido tiene final.
  assert.strictEqual(estado.movil, true);

  const ida = await irAMicrosoft();
  assert.strictEqual(ida.url.origin, autoridad);
  assert.strictEqual(ida.url.searchParams.get('client_id'), CLIENTE);
  assert.strictEqual(ida.url.searchParams.get('response_type'), 'code');
  assert.strictEqual(ida.url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(ida.direccion.endsWith('/api/entra/vuelta'));
  // El «state» viaja por los dos caminos, y luego se comparan.
  assert.strictEqual(ida.intento, ida.estado);
});

test('quien vuelve de Microsoft entra, y la cuenta se crea con rol usuario y OFICINA', async () => {
  const ida = await irAMicrosoft();
  const res = await volver(codigoPara(ida), ida.estado, ida.intento);

  assert.strictEqual(res.status, 302);
  assert.strictEqual(res.headers.get('location'), '/');
  const sesion = cookie(res, 'incidencias_sesion');
  assert.ok(sesion, 'la vuelta tiene que dejar la sesión iniciada');

  const yo = await (await fetch(`${base}/api/session`, {
    headers: { Cookie: `incidencias_sesion=${sesion}` }
  })).json();
  assert.strictEqual(yo.email, 'nuria@ejemplo.com');
  assert.strictEqual(yo.nombre, 'Nuria Prats');
  assert.strictEqual(yo.rol, 'usuario');
  assert.deepStrictEqual(yo.locales.map((l) => l.nombre), ['OFICINA']);

  // La cookie del intento ya no hace falta y se retira.
  assert.strictEqual(cookie(res, 'incidencias_entra'), '');
});

test('la segunda entrada es la misma cuenta', async () => {
  const antes = db.prepare('SELECT COUNT(*) AS c FROM usuarios').get().c;
  const ida = await irAMicrosoft();
  const res = await volver(codigoPara(ida), ida.estado, ida.intento);
  assert.ok(cookie(res, 'incidencias_sesion'));
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM usuarios').get().c, antes);
});

test('la vuelta no vale dos veces', async () => {
  const ida = await irAMicrosoft();
  const codigo = codigoPara(ida);
  assert.ok(cookie(await volver(codigo, ida.estado, ida.intento), 'incidencias_sesion'));

  const repetida = await volver(codigo, ida.estado, ida.intento);
  assert.ok(repetida.headers.get('location').startsWith('/login.html?error='));
  assert.strictEqual(cookie(repetida, 'incidencias_sesion'), null);
});

test('sin la cookie del intento la vuelta no sirve', async () => {
  const ida = await irAMicrosoft();
  const res = await volver(codigoPara(ida), ida.estado, null);
  assert.ok(res.headers.get('location').startsWith('/login.html?error='));
  assert.strictEqual(cookie(res, 'incidencias_sesion'), null);
});

test('un «state» que no es el del intento no sirve', async () => {
  const ida = await irAMicrosoft();
  const res = await volver(codigoPara(ida), 'otro-state', ida.intento);
  assert.ok(res.headers.get('location').startsWith('/login.html?error='));
  assert.strictEqual(cookie(res, 'incidencias_sesion'), null);
});

test('un identificador firmado por otro no entra', async () => {
  const impostor = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const original = identificadorDe;
  identificadorDe = (pendiente) => firmar({
    iss: emisor, aud: CLIENTE, oid: 'oid-del-impostor',
    preferred_username: 'impostor@ejemplo.com', nonce: pendiente.nonce,
    exp: Math.floor(Date.now() / 1000) + 3600
  }, { clave: impostor });
  try {
    const ida = await irAMicrosoft();
    const res = await volver(codigoPara(ida), ida.estado, ida.intento);
    assert.ok(res.headers.get('location').startsWith('/login.html?error='));
    assert.strictEqual(cookie(res, 'incidencias_sesion'), null);
  } finally {
    identificadorDe = original;
  }
  assert.ok(!db.prepare('SELECT 1 FROM usuarios WHERE entra_oid = ?').get('oid-del-impostor'));
});

test('un identificador que responde a otra entrada no entra', async () => {
  const original = identificadorDe;
  // Mismo emisor, misma firma y misma aplicación, pero de otra entrada: es lo
  // que pasaría si alguien reutilizara un identificador que ha visto pasar.
  identificadorDe = () => firmar({
    iss: emisor, aud: CLIENTE, oid: 'oid-de-quien-entra',
    preferred_username: 'nuria@ejemplo.com', nonce: 'el-nonce-de-otra-entrada',
    exp: Math.floor(Date.now() / 1000) + 3600
  });
  try {
    const ida = await irAMicrosoft();
    const res = await volver(codigoPara(ida), ida.estado, ida.intento);
    assert.ok(res.headers.get('location').startsWith('/login.html?error='));
    assert.strictEqual(cookie(res, 'incidencias_sesion'), null);
  } finally {
    identificadorDe = original;
  }
});

test('un identificador caducado no entra', async () => {
  const original = identificadorDe;
  identificadorDe = (pendiente) => firmar({
    iss: emisor, aud: CLIENTE, oid: 'oid-de-quien-entra',
    preferred_username: 'nuria@ejemplo.com', nonce: pendiente.nonce,
    exp: Math.floor(Date.now() / 1000) - 3600
  });
  try {
    const ida = await irAMicrosoft();
    const res = await volver(codigoPara(ida), ida.estado, ida.intento);
    assert.ok(res.headers.get('location').startsWith('/login.html?error='));
    assert.strictEqual(cookie(res, 'incidencias_sesion'), null);
  } finally {
    identificadorDe = original;
  }
});

test('una cuenta bloqueada no entra por Office 365', async () => {
  db.prepare("UPDATE usuarios SET bloqueada = 1 WHERE email = 'nuria@ejemplo.com'").run();
  try {
    const ida = await irAMicrosoft();
    const res = await volver(codigoPara(ida), ida.estado, ida.intento);
    assert.ok(decodeURIComponent(res.headers.get('location')).includes('administrador'));
    assert.strictEqual(cookie(res, 'incidencias_sesion'), null);
  } finally {
    db.prepare("UPDATE usuarios SET bloqueada = 0 WHERE email = 'nuria@ejemplo.com'").run();
  }
});

// ---------- El recorrido de la app móvil ----------

// La app hace lo mismo por el navegador del teléfono, y como allí no se le
// puede dar la sesión, la vuelta acaba en un vale que canjea ella.

function retoDe(verificador) {
  return base64url(crypto.createHash('sha256').update(verificador).digest());
}

async function entrarComoLaApp(verificador) {
  const ida = await irAMicrosoft({ app: retoDe(verificador) });
  const res = await volver(codigoPara(ida), ida.estado, ida.intento);
  return res;
}

function valeDe(res) {
  const destino = res.headers.get('location');
  return new URL(destino, base).searchParams.get('vale');
}

test('la vuelta de la app no deja sesión en el navegador, sino un vale', async () => {
  const res = await entrarComoLaApp('el-verificador-de-la-app');
  assert.strictEqual(res.status, 302);
  assert.ok(res.headers.get('location').startsWith('/entra-movil.html?vale='));
  assert.strictEqual(cookie(res, 'incidencias_sesion'), null,
    'el token no puede quedarse en el navegador del teléfono');
  assert.ok(valeDe(res));
});

test('la app canja el vale por su token y entra', async () => {
  const verificador = 'otro-verificador-de-la-app';
  const vale = valeDe(await entrarComoLaApp(verificador));

  const canje = await fetch(`${base}/api/entra/movil`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vale, verificador })
  });
  assert.strictEqual(canje.status, 200);
  const datos = await canje.json();
  assert.strictEqual(datos.email, 'nuria@ejemplo.com');
  assert.strictEqual(datos.rol, 'usuario');
  assert.strictEqual(datos.puedeCrear, true);
  assert.ok(datos.token);

  // Y ese token vale para el resto de la API, igual que el de `/api/login`.
  const yo = await (await fetch(`${base}/api/session`, {
    headers: { Authorization: `Bearer ${datos.token}` }
  })).json();
  assert.strictEqual(yo.email, 'nuria@ejemplo.com');
});

test('el vale no vale dos veces', async () => {
  const verificador = 'un-verificador-mas';
  const vale = valeDe(await entrarComoLaApp(verificador));
  const cuerpo = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vale, verificador })
  };
  assert.strictEqual((await fetch(`${base}/api/entra/movil`, cuerpo)).status, 200);
  assert.strictEqual((await fetch(`${base}/api/entra/movil`, cuerpo)).status, 401);
});

test('el vale sin el verificador de esa app no sirve', async () => {
  // Es lo que pasaría si otra aplicación se colara en el enlace de vuelta.
  const vale = valeDe(await entrarComoLaApp('el-de-la-app-de-verdad'));
  const canje = await fetch(`${base}/api/entra/movil`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vale, verificador: 'el-de-la-app-impostora' })
  });
  assert.strictEqual(canje.status, 401);
});

test('un reto que no tiene forma de reto ni empieza la entrada', async () => {
  const res = await fetch(`${base}/api/entra/entrar?app=corto`, { redirect: 'manual' });
  assert.ok(res.headers.get('location').startsWith('/login.html?error='));
});
