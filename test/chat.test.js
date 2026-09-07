'use strict';

/**
 * Pruebas del chat de local, contra un servidor de verdad.
 *
 * Lo que se comprueba aquí es lo que no se puede mirar a ojo: quién entra en
 * cada canal, que reintentar un envío no duplique nada, que el estado de un
 * mensaje pase por sus cuatro escalones y que una desconexión no pierda
 * mensajes.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'pruebas');
process.env.INCIDENCIAS_DB = path.join(DATA_DIR, 'chat.db');
fs.mkdirSync(DATA_DIR, { recursive: true });
for (const sufijo of ['', '-wal', '-shm']) {
  fs.rmSync(`${process.env.INCIDENCIAS_DB}${sufijo}`, { force: true });
}
fs.rmSync(path.join(DATA_DIR, 'chat'), { recursive: true, force: true });

process.env.ENTRA_CONFIG = path.join(DATA_DIR, 'entra-que-no-existe.json');

const app = require('../server');

let servidor;
let base;

before(async () => {
  servidor = app.listen(0);
  await new Promise((listo) => servidor.once('listening', listo));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => servidor && servidor.close());

// ---------- Utilidades ----------

async function pedir(metodo, ruta, { token, cuerpo, crudo, tipo } = {}) {
  const cabeceras = {};
  if (token) cabeceras.Authorization = `Bearer ${token}`;
  if (cuerpo) cabeceras['Content-Type'] = 'application/json';
  if (crudo) cabeceras['Content-Type'] = tipo || 'application/octet-stream';
  const res = await fetch(`${base}${ruta}`, {
    method: metodo,
    headers: cabeceras,
    body: crudo || (cuerpo ? JSON.stringify(cuerpo) : undefined)
  });
  let datos = null;
  try { datos = await res.json(); } catch (e) { /* sin cuerpo */ }
  return { estado: res.status, datos };
}

async function entrar(usuario, password) {
  const { estado, datos } = await pedir('POST', '/api/login', { cuerpo: { usuario, password } });
  assert.strictEqual(estado, 200, `no se pudo entrar como ${usuario}`);
  return datos.token;
}

async function crearUsuario(tokenAdmin, datos) {
  const email = `${datos.usuario}@ejemplo.test`;
  const alta = await pedir('POST', '/api/usuarios', {
    token: tokenAdmin, cuerpo: { ...datos, email }
  });
  assert.strictEqual(alta.estado, 201, JSON.stringify(alta.datos));
  return { id: alta.datos.id, email, token: await entrar(email, datos.password) };
}

function nuevoClienteId() {
  return `p-${Math.random().toString(36).slice(2)}`;
}

async function escribir(token, localId, contenido, adjuntos = []) {
  return pedir('POST', `/api/chat/canales/${localId}/mensajes`, {
    token, cuerpo: { cliente_id: nuevoClienteId(), contenido, adjuntos }
  });
}

/**
 * Abre el flujo de eventos y va devolviendo lo que llega. No usa EventSource
 * —que no existe en Node— sino el propio cuerpo de la respuesta, que es lo
 * mismo que lee el navegador por debajo.
 */
async function abrirFlujo(token) {
  const control = new AbortController();
  const res = await fetch(`${base}/api/chat/flujo`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: control.signal
  });
  assert.strictEqual(res.status, 200);

  const eventos = [];
  const lector = res.body.getReader();
  const decodificador = new TextDecoder();
  let resto = '';

  (async () => {
    try {
      for (;;) {
        const { done, value } = await lector.read();
        if (done) break;
        resto += decodificador.decode(value, { stream: true });
        const bloques = resto.split('\n\n');
        resto = bloques.pop();
        for (const bloque of bloques) {
          const nombre = (bloque.match(/^event: (.+)$/m) || [])[1];
          const datos = (bloque.match(/^data: (.+)$/m) || [])[1];
          if (nombre) eventos.push({ nombre, datos: datos ? JSON.parse(datos) : null });
        }
      }
    } catch (e) { /* cerrado a propósito */ }
  })();

  return {
    eventos,
    cerrar: () => control.abort(),
    // Espera a que llegue un evento que cumpla la condición, o se rinde.
    async esperar(nombre, condicion = () => true, ms = 3000) {
      const hasta = Date.now() + ms;
      for (;;) {
        const hallado = eventos.find((e) => e.nombre === nombre && condicion(e.datos));
        if (hallado) return hallado.datos;
        if (Date.now() > hasta) {
          throw new Error(`no llegó el evento «${nombre}»; llegaron: ${
            eventos.map((e) => e.nombre).join(', ') || 'ninguno'
          }`);
        }
        await new Promise((listo) => setTimeout(listo, 25));
      }
    }
  };
}

// ---------- Escenario ----------

const mundo = {};

test('el escenario del chat se monta', async () => {
  mundo.admin = await entrar('admin', 'admin');

  const locales = (await pedir('GET', '/api/locales', { token: mundo.admin })).datos;
  mundo.local1 = locales.find((l) => l.nombre === 'LOCAL 1').id;
  mundo.local3 = locales.find((l) => l.nombre === 'LOCAL 3').id;

  const grupos = (await pedir('GET', '/api/grupos', { token: mundo.admin })).datos;
  mundo.mantenimiento = grupos.find((g) => g.nombre === 'Mantenimiento').id;
  mundo.informatica = grupos.find((g) => g.nombre === 'Informática').id;

  // Dos compañeros en LOCAL 1 y una empleada en otro local.
  mundo.juan = await crearUsuario(mundo.admin, {
    nombre: 'Juan', usuario: 'juan', password: 'incidencias1', rol: 'empleado',
    locales: [mundo.local1]
  });
  mundo.maria = await crearUsuario(mundo.admin, {
    nombre: 'María', usuario: 'maria', password: 'incidencias1', rol: 'empleado',
    locales: [mundo.local1]
  });
  mundo.lucia = await crearUsuario(mundo.admin, {
    nombre: 'Lucía', usuario: 'lucia', password: 'incidencias1', rol: 'empleado',
    locales: [mundo.local3]
  });
  // José atiende Mantenimiento solo en LOCAL 1; Santiago, Informática entera.
  mundo.jose = await crearUsuario(mundo.admin, {
    nombre: 'José', usuario: 'jose', password: 'incidencias1', rol: 'tecnico',
    grupo_id: mundo.mantenimiento, locales: [mundo.local1]
  });
  mundo.santiago = await crearUsuario(mundo.admin, {
    nombre: 'Santiago', usuario: 'santiago', password: 'incidencias1', rol: 'tecnico',
    grupo_id: mundo.informatica, locales: []
  });
});

// ---------- Quién tiene qué canal ----------

test('cada uno ve los canales de sus locales', async () => {
  const deJuan = (await pedir('GET', '/api/chat/canales', { token: mundo.juan.token })).datos;
  assert.deepStrictEqual(deJuan.map((c) => c.local_id), [mundo.local1]);
  assert.strictEqual(deJuan[0].canal, '#local-1');

  const deLucia = (await pedir('GET', '/api/chat/canales', { token: mundo.lucia.token })).datos;
  assert.deepStrictEqual(deLucia.map((c) => c.local_id), [mundo.local3]);

  // José tiene LOCAL 1 marcado; Santiago no tiene ninguno, así que los atiende
  // todos y está en todos los canales, igual que con las incidencias.
  const deJose = (await pedir('GET', '/api/chat/canales', { token: mundo.jose.token })).datos;
  assert.deepStrictEqual(deJose.map((c) => c.local_id), [mundo.local1]);

  const deSantiago = (await pedir('GET', '/api/chat/canales', { token: mundo.santiago.token })).datos;
  assert.ok(deSantiago.length > 1);

  // El administrador supervisa el grupo entero.
  const deAdmin = (await pedir('GET', '/api/chat/canales', { token: mundo.admin })).datos;
  assert.ok(deAdmin.length > 1);
});

test('el canal de un local ajeno no existe para quien no está en él', async () => {
  const leer = await pedir('GET', `/api/chat/canales/${mundo.local1}/mensajes`, {
    token: mundo.lucia.token
  });
  assert.strictEqual(leer.estado, 404);

  const escribirlo = await escribir(mundo.lucia.token, mundo.local1, 'Hola desde fuera');
  assert.strictEqual(escribirlo.estado, 404);
});

test('sin sesión no se llega ni al flujo ni a los canales', async () => {
  assert.strictEqual((await pedir('GET', '/api/chat/canales')).estado, 401);
  assert.strictEqual((await pedir('GET', '/api/chat/flujo')).estado, 401);
});

// ---------- Enviar ----------

test('un mensaje se escribe y lo ven los del canal', async () => {
  const enviado = await escribir(mundo.juan.token, mundo.local1, 'Se ha ido la luz en la cocina');
  assert.strictEqual(enviado.estado, 201, JSON.stringify(enviado.datos));
  assert.strictEqual(enviado.datos.contenido, 'Se ha ido la luz en la cocina');
  assert.strictEqual(enviado.datos.autor_nombre, 'Juan');
  mundo.primerMensaje = enviado.datos.id;

  const visto = await pedir('GET', `/api/chat/canales/${mundo.local1}/mensajes`, {
    token: mundo.maria.token
  });
  assert.strictEqual(visto.estado, 200);
  assert.ok(visto.datos.mensajes.some((m) => m.id === mundo.primerMensaje));
  assert.strictEqual(visto.datos.canal, '#local-1');
});

test('un mensaje vacío no entra', async () => {
  const vacio = await escribir(mundo.juan.token, mundo.local1, '   ');
  assert.strictEqual(vacio.estado, 400);
});

test('reenviar el mismo mensaje no lo duplica', async () => {
  const clienteId = nuevoClienteId();
  const cuerpo = { cliente_id: clienteId, contenido: 'Voy para allá' };

  const primero = await pedir('POST', `/api/chat/canales/${mundo.local1}/mensajes`, {
    token: mundo.maria.token, cuerpo
  });
  assert.strictEqual(primero.estado, 201);

  // El mismo envío otra vez: es lo que hace el móvil cuando no llegó a saber si
  // el primero entró.
  const repetido = await pedir('POST', `/api/chat/canales/${mundo.local1}/mensajes`, {
    token: mundo.maria.token, cuerpo
  });
  assert.strictEqual(repetido.estado, 200);
  assert.strictEqual(repetido.datos.id, primero.datos.id);

  const todos = (await pedir('GET', `/api/chat/canales/${mundo.local1}/mensajes`, {
    token: mundo.maria.token
  })).datos.mensajes;
  assert.strictEqual(todos.filter((m) => m.cliente_id === clienteId).length, 1);
});

// ---------- Estado de los mensajes ----------

test('el mensaje pasa de enviado a recibido y a leído', async () => {
  const enviado = await escribir(mundo.juan.token, mundo.local1, '¿Alguien tiene la llave del almacén?');
  const id = enviado.datos.id;

  // Recién enviado nadie lo ha recibido: para Juan está solo «enviado».
  const reciente = (await pedir('GET', `/api/chat/canales/${mundo.local1}/mensajes`, {
    token: mundo.juan.token
  })).datos;
  const mayor = (cual) => reciente.ajenas.reduce((n, a) => Math.max(n, a[cual]), 0);
  assert.ok(mayor('recibido_hasta') < id, 'nadie debería haberlo recibido todavía');

  // A María le llega al aparato, pero no lo mira.
  const acuse = await pedir('POST', `/api/chat/canales/${mundo.local1}/recibido`, {
    token: mundo.maria.token, cuerpo: { hasta: id }
  });
  assert.strictEqual(acuse.estado, 200);

  const recibido = (await pedir('GET', `/api/chat/canales/${mundo.local1}/mensajes`, {
    token: mundo.juan.token
  })).datos;
  const conRecibido = recibido.ajenas.reduce((n, a) => Math.max(n, a.recibido_hasta), 0);
  const conLeido = recibido.ajenas.reduce((n, a) => Math.max(n, a.leido_hasta), 0);
  assert.ok(conRecibido >= id, 'debería constar como recibido');
  assert.ok(conLeido < id, 'todavía no lo ha leído nadie');

  // Ahora sí lo abre.
  await pedir('POST', `/api/chat/canales/${mundo.local1}/leido`, {
    token: mundo.maria.token, cuerpo: { hasta: id }
  });
  const leido = (await pedir('GET', `/api/chat/canales/${mundo.local1}/mensajes`, {
    token: mundo.juan.token
  })).datos;
  assert.ok(leido.ajenas.reduce((n, a) => Math.max(n, a.leido_hasta), 0) >= id);
});

test('los acuses solo van hacia adelante', async () => {
  const ultimo = (await pedir('GET', `/api/chat/canales/${mundo.local1}/mensajes`, {
    token: mundo.maria.token
  })).datos;
  const tope = ultimo.mensajes[ultimo.mensajes.length - 1].id;

  await pedir('POST', `/api/chat/canales/${mundo.local1}/leido`, {
    token: mundo.maria.token, cuerpo: { hasta: tope }
  });
  // Un acuse viejo que llega tarde no puede devolver el canal a «sin leer».
  const atras = await pedir('POST', `/api/chat/canales/${mundo.local1}/leido`, {
    token: mundo.maria.token, cuerpo: { hasta: 1 }
  });
  assert.strictEqual(atras.datos.leido_hasta, tope);

  // Y no se puede dar por leído lo que todavía no existe.
  const futuro = await pedir('POST', `/api/chat/canales/${mundo.local1}/leido`, {
    token: mundo.maria.token, cuerpo: { hasta: tope + 1000 }
  });
  assert.strictEqual(futuro.datos.leido_hasta, tope);
});

test('leer un canal deja su cuenta de mensajes nuevos a cero', async () => {
  await escribir(mundo.juan.token, mundo.local1, 'Recordad cerrar la terraza');

  const antes = (await pedir('GET', '/api/chat/canales', { token: mundo.maria.token })).datos
    .find((c) => c.local_id === mundo.local1);
  assert.ok(antes.sin_leer > 0);

  const resumen = (await pedir('GET', '/api/chat/resumen', { token: mundo.maria.token })).datos;
  assert.ok(resumen.sin_leer > 0);

  await pedir('POST', `/api/chat/canales/${mundo.local1}/leido`, {
    token: mundo.maria.token, cuerpo: { hasta: antes.ultimo.id }
  });

  const despues = (await pedir('GET', '/api/chat/canales', { token: mundo.maria.token })).datos
    .find((c) => c.local_id === mundo.local1);
  assert.strictEqual(despues.sin_leer, 0);
  // Lo que escribe uno mismo nunca cuenta como sin leer.
  const deJuan = (await pedir('GET', '/api/chat/canales', { token: mundo.juan.token })).datos
    .find((c) => c.local_id === mundo.local1);
  assert.strictEqual(deJuan.sin_leer, 0);
});

// ---------- El flujo de eventos ----------

test('el flujo entrega los mensajes del canal en cuanto se escriben', async () => {
  const flujo = await abrirFlujo(mundo.maria.token);
  try {
    await flujo.esperar('sincroniza');

    const enviado = await escribir(mundo.juan.token, mundo.local1, 'Ya está la luz');
    const llegado = await flujo.esperar('mensaje', (m) => m.id === enviado.datos.id);
    assert.strictEqual(llegado.contenido, 'Ya está la luz');
    assert.strictEqual(llegado.local_id, mundo.local1);
  } finally {
    flujo.cerrar();
  }
});

test('el flujo no entrega los mensajes de un canal ajeno', async () => {
  const flujo = await abrirFlujo(mundo.lucia.token);
  try {
    await flujo.esperar('sincroniza');
    await escribir(mundo.juan.token, mundo.local1, 'Esto es de LOCAL 1');
    await new Promise((listo) => setTimeout(listo, 300));
    assert.ok(!flujo.eventos.some((e) => e.nombre === 'mensaje'),
      'a Lucía no le puede llegar nada de un canal en el que no está');
  } finally {
    flujo.cerrar();
  }
});

test('el acuse de otro llega por el flujo a quien escribió', async () => {
  const flujo = await abrirFlujo(mundo.juan.token);
  try {
    await flujo.esperar('sincroniza');
    const enviado = await escribir(mundo.juan.token, mundo.local1, '¿Lo habéis visto?');
    await pedir('POST', `/api/chat/canales/${mundo.local1}/leido`, {
      token: mundo.maria.token, cuerpo: { hasta: enviado.datos.id }
    });
    const acuse = await flujo.esperar('acuses',
      (a) => a.usuario_id === mundo.maria.id && a.leido_hasta >= enviado.datos.id);
    assert.strictEqual(acuse.local_id, mundo.local1);
  } finally {
    flujo.cerrar();
  }
});

test('lo que se perdió mientras no había conexión se recupera desde donde se dejó', async () => {
  const antes = (await pedir('GET', `/api/chat/canales/${mundo.local1}/mensajes`, {
    token: mundo.maria.token
  })).datos;
  const ultimo = antes.mensajes[antes.mensajes.length - 1].id;

  // Tres mensajes con María «desconectada».
  await escribir(mundo.juan.token, mundo.local1, 'Uno');
  await escribir(mundo.juan.token, mundo.local1, 'Dos');
  await escribir(mundo.juan.token, mundo.local1, 'Tres');

  const puestaAlDia = await pedir(
    'GET', `/api/chat/canales/${mundo.local1}/mensajes?desde=${ultimo}`,
    { token: mundo.maria.token }
  );
  assert.deepStrictEqual(
    puestaAlDia.datos.mensajes.map((m) => m.contenido),
    ['Uno', 'Dos', 'Tres']
  );
});

test('el historial se pagina hacia atrás', async () => {
  const pagina = await pedir(
    'GET', `/api/chat/canales/${mundo.local1}/mensajes?limite=2`, { token: mundo.juan.token }
  );
  assert.strictEqual(pagina.datos.mensajes.length, 2);
  assert.strictEqual(pagina.datos.hay_mas, true);

  const anterior = await pedir(
    'GET', `/api/chat/canales/${mundo.local1}/mensajes?limite=2&antes=${pagina.datos.mensajes[0].id}`,
    { token: mundo.juan.token }
  );
  assert.ok(anterior.datos.mensajes.every((m) => m.id < pagina.datos.mensajes[0].id));
});

// ---------- Multimedia y notas de voz ----------

test('una foto se manda con el mensaje y solo la ve el canal', async () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const borrador = await pedir('POST', '/api/chat/borradores?nombre=averia.png', {
    token: mundo.juan.token, crudo: png, tipo: 'image/png'
  });
  assert.strictEqual(borrador.estado, 201, JSON.stringify(borrador.datos));
  assert.strictEqual(borrador.datos.tipo, 'imagen');

  // Un mensaje puede ser solo la foto, sin texto.
  const mensaje = await escribir(mundo.juan.token, mundo.local1, '', [borrador.datos.id]);
  assert.strictEqual(mensaje.estado, 201, JSON.stringify(mensaje.datos));
  assert.strictEqual(mensaje.datos.adjuntos.length, 1);
  const adjuntoId = mensaje.datos.adjuntos[0].id;

  const mia = await fetch(`${base}/api/chat/adjuntos/${adjuntoId}`, {
    headers: { Authorization: `Bearer ${mundo.maria.token}` }
  });
  assert.strictEqual(mia.status, 200);
  assert.strictEqual(mia.headers.get('content-type'), 'image/png');

  const ajena = await fetch(`${base}/api/chat/adjuntos/${adjuntoId}`, {
    headers: { Authorization: `Bearer ${mundo.lucia.token}` }
  });
  assert.strictEqual(ajena.status, 404);
});

test('una nota de voz se guarda como audio, con su duración', async () => {
  const borrador = await pedir(
    'POST', '/api/chat/borradores?nombre=nota-de-voz.weba&duracion=12',
    { token: mundo.juan.token, crudo: Buffer.from('sonido de mentira'), tipo: 'audio/webm' }
  );
  assert.strictEqual(borrador.estado, 201, JSON.stringify(borrador.datos));
  assert.strictEqual(borrador.datos.tipo, 'audio');
  assert.strictEqual(borrador.datos.duracion, 12);

  const mensaje = await escribir(mundo.juan.token, mundo.local1, '', [borrador.datos.id]);
  assert.strictEqual(mensaje.estado, 201);
  assert.strictEqual(mensaje.datos.adjuntos[0].tipo, 'audio');
  assert.strictEqual(mensaje.datos.adjuntos[0].duracion, 12);

  const archivo = await fetch(`${base}/api/chat/adjuntos/${mensaje.datos.adjuntos[0].id}`, {
    headers: { Authorization: `Bearer ${mundo.maria.token}` }
  });
  assert.strictEqual(archivo.headers.get('content-type'), 'audio/webm');

  // Y en la lista de canales se resume como lo que es.
  const canal = (await pedir('GET', '/api/chat/canales', { token: mundo.maria.token })).datos
    .find((c) => c.local_id === mundo.local1);
  assert.strictEqual(canal.ultimo.resumen, '🎤 Nota de voz');
});

test('un formato que no se admite se rechaza', async () => {
  const malo = await pedir('POST', '/api/chat/borradores?nombre=programa.exe', {
    token: mundo.juan.token, crudo: Buffer.from('MZ')
  });
  assert.strictEqual(malo.estado, 400);
  assert.match(malo.datos.error, /Formato no admitido/);
});

test('el borrador de otro no se puede colar en un mensaje propio', async () => {
  const borrador = await pedir('POST', '/api/chat/borradores?nombre=apunte.txt', {
    token: mundo.maria.token, crudo: Buffer.from('cosas de María'), tipo: 'text/plain'
  });
  assert.strictEqual(borrador.estado, 201);

  const intento = await escribir(mundo.juan.token, mundo.local1, 'Mira esto', [borrador.datos.id]);
  // El adjunto ajeno se ignora; el mensaje entra con su texto y sin él.
  assert.strictEqual(intento.estado, 201);
  assert.strictEqual(intento.datos.adjuntos.length, 0);
});

// ---------- Borrar ----------

test('cada uno borra sus mensajes, y el administrador cualquiera', async () => {
  const mio = await escribir(mundo.juan.token, mundo.local1, 'Esto lo he escrito mal');

  const ajeno = await pedir('DELETE', `/api/chat/mensajes/${mio.datos.id}`, {
    token: mundo.maria.token
  });
  assert.strictEqual(ajeno.estado, 403);

  const propio = await pedir('DELETE', `/api/chat/mensajes/${mio.datos.id}`, {
    token: mundo.juan.token
  });
  assert.strictEqual(propio.estado, 200);
  assert.strictEqual(propio.datos.borrado, true);
  assert.strictEqual(propio.datos.contenido, '');

  // El hueco se queda: la conversación de los demás no cambia por detrás.
  const hilo = (await pedir('GET', `/api/chat/canales/${mundo.local1}/mensajes`, {
    token: mundo.maria.token
  })).datos.mensajes;
  const borrado = hilo.find((m) => m.id === mio.datos.id);
  assert.ok(borrado);
  assert.strictEqual(borrado.borrado, true);

  const deMaria = await escribir(mundo.maria.token, mundo.local1, 'Y esto yo');
  const porAdmin = await pedir('DELETE', `/api/chat/mensajes/${deMaria.datos.id}`, {
    token: mundo.admin
  });
  assert.strictEqual(porAdmin.estado, 200);
});

test('un mensaje borrado deja de contar como sin leer', async () => {
  // Lucía deja su canal al día y Juan no está en él, así que escribe el admin.
  const canal = mundo.local3;
  const alDia = await escribir(mundo.admin, canal, 'Un aviso que va a durar poco');
  await pedir('POST', `/api/chat/canales/${canal}/leido`, {
    token: mundo.lucia.token, cuerpo: { hasta: alDia.datos.id }
  });

  const nuevo = await escribir(mundo.admin, canal, 'Y este me lo pienso mejor');
  const antes = (await pedir('GET', '/api/chat/resumen', { token: mundo.lucia.token })).datos;
  assert.strictEqual(antes.sin_leer, 1);

  await pedir('DELETE', `/api/chat/mensajes/${nuevo.datos.id}`, { token: mundo.admin });
  const despues = (await pedir('GET', '/api/chat/resumen', { token: mundo.lucia.token })).datos;
  assert.strictEqual(despues.sin_leer, 0,
    'un canal no puede quedarse con un mensaje nuevo que ya no se puede leer');
});

// ---------- El canal y el local ----------

test('no se borra un local que tiene conversación', async () => {
  const intento = await pedir('DELETE', `/api/locales/${mundo.local1}`, { token: mundo.admin });
  assert.strictEqual(intento.estado, 400);
  assert.match(intento.datos.error, /chat/);
});

test('quien deja de estar en un local deja de ver su canal', async () => {
  await pedir('PUT', `/api/usuarios/${mundo.maria.id}`, {
    token: mundo.admin,
    cuerpo: {
      nombre: 'María', email: mundo.maria.email, rol: 'empleado', locales: [mundo.local3]
    }
  });

  const canales = (await pedir('GET', '/api/chat/canales', { token: mundo.maria.token })).datos;
  assert.deepStrictEqual(canales.map((c) => c.local_id), [mundo.local3]);

  const antiguo = await pedir('GET', `/api/chat/canales/${mundo.local1}/mensajes`, {
    token: mundo.maria.token
  });
  assert.strictEqual(antiguo.estado, 404);
});

// ---------- Moderación ----------
//
// Denunciar y suspender no son un adorno de las tiendas: son las dos mitades
// de lo que Apple pide para publicar una app con conversación —avisar de un
// mensaje y poder echar a quien se pasa—, y sin ellas la ficha no pasa. Lo que
// se comprueba aquí es que el aviso llega, que se puede despachar, y sobre
// todo que una cuenta suspendida deja de entrar de verdad.

test('se avisa de un mensaje ajeno, y una sola vez por persona', async () => {
  const mensaje = await escribir(mundo.jose.token, mundo.local1, 'Esto no se dice');
  assert.strictEqual(mensaje.estado, 201);

  const aviso = await pedir('POST', `/api/chat/mensajes/${mensaje.datos.id}/denuncia`, {
    token: mundo.juan.token, cuerpo: { motivo: 'Se ha pasado' }
  });
  assert.strictEqual(aviso.estado, 201);

  // Insistir no multiplica el aviso, y a quien insiste no se le da un error:
  // para él ya está denunciado.
  const otraVez = await pedir('POST', `/api/chat/mensajes/${mensaje.datos.id}/denuncia`, {
    token: mundo.juan.token, cuerpo: { motivo: 'De verdad' }
  });
  assert.strictEqual(otraVez.estado, 201);

  const cola = (await pedir('GET', '/api/chat/denuncias', { token: mundo.admin })).datos;
  const mias = cola.filter((d) => d.mensaje.id === mensaje.datos.id);
  assert.strictEqual(mias.length, 1);
  assert.strictEqual(mias[0].motivo, 'Se ha pasado');
  assert.strictEqual(mias[0].denunciante.nombre, 'Juan');
  assert.strictEqual(mias[0].mensaje.contenido, 'Esto no se dice');
});

test('del mensaje propio no se avisa: se borra', async () => {
  const mensaje = await escribir(mundo.juan.token, mundo.local1, 'Lo mío');
  const aviso = await pedir('POST', `/api/chat/mensajes/${mensaje.datos.id}/denuncia`, {
    token: mundo.juan.token, cuerpo: {}
  });
  assert.strictEqual(aviso.estado, 400);
});

test('no se puede avisar de un mensaje de un canal ajeno', async () => {
  const mensaje = await escribir(mundo.juan.token, mundo.local1, 'Cosas del local');
  // Lucía no está en LOCAL 1: para ella ese mensaje no existe, ni para avisar.
  const aviso = await pedir('POST', `/api/chat/mensajes/${mensaje.datos.id}/denuncia`, {
    token: mundo.lucia.token, cuerpo: {}
  });
  assert.strictEqual(aviso.estado, 404);
});

test('la cola de denuncias es solo del administrador', async () => {
  const intento = await pedir('GET', '/api/chat/denuncias', { token: mundo.juan.token });
  assert.strictEqual(intento.estado, 403);
});

test('borrar el mensaje da por atendida su denuncia', async () => {
  const mensaje = await escribir(mundo.jose.token, mundo.local1, 'Otra que sobra');
  await pedir('POST', `/api/chat/mensajes/${mensaje.datos.id}/denuncia`, {
    token: mundo.juan.token, cuerpo: { motivo: 'Fuera' }
  });

  const antes = (await pedir('GET', '/api/chat/resumen', { token: mundo.admin })).datos;
  assert.ok(antes.denuncias_pendientes > 0);

  await pedir('DELETE', `/api/chat/mensajes/${mensaje.datos.id}`, { token: mundo.admin });

  const cola = (await pedir('GET', '/api/chat/denuncias', { token: mundo.admin })).datos;
  assert.ok(!cola.some((d) => d.mensaje.id === mensaje.datos.id),
    'una denuncia cuyo mensaje ya se ha borrado no puede seguir pidiendo que alguien la mire');

  const resueltas = (await pedir('GET', '/api/chat/denuncias?resueltas=1', {
    token: mundo.admin
  })).datos;
  assert.ok(resueltas.some((d) => d.mensaje.id === mensaje.datos.id));
});

test('una denuncia se puede despachar sin borrar nada', async () => {
  const mensaje = await escribir(mundo.jose.token, mundo.local1, 'Una broma de las suyas');
  await pedir('POST', `/api/chat/mensajes/${mensaje.datos.id}/denuncia`, {
    token: mundo.juan.token, cuerpo: {}
  });
  const cola = (await pedir('GET', '/api/chat/denuncias', { token: mundo.admin })).datos;
  const mia = cola.find((d) => d.mensaje.id === mensaje.datos.id);

  const hecho = await pedir('POST', `/api/chat/denuncias/${mia.id}/resolver`, {
    token: mundo.admin
  });
  assert.strictEqual(hecho.estado, 200);

  // El mensaje sigue donde estaba: lo que se ha decidido es que no era para tanto.
  const sigue = (await pedir('GET', `/api/chat/canales/${mundo.local1}/mensajes`, {
    token: mundo.juan.token
  })).datos;
  assert.ok(sigue.mensajes.some((m) => m.id === mensaje.datos.id && !m.borrado));
});

test('una cuenta suspendida deja de entrar y pierde sus sesiones', async () => {
  const antonio = await crearUsuario(mundo.admin, {
    nombre: 'Antonio', usuario: 'antonio', password: 'incidencias1', rol: 'empleado',
    locales: [mundo.local1]
  });

  const suspension = await pedir('POST', `/api/usuarios/${antonio.id}/suspender`, {
    token: mundo.admin
  });
  assert.strictEqual(suspension.estado, 200);

  // La sesión que ya tenía abierta deja de valer en el momento: si no, seguiría
  // escribiendo hasta que se le ocurriera cerrar la app.
  const conLaVieja = await pedir('GET', '/api/chat/canales', { token: antonio.token });
  assert.strictEqual(conLaVieja.estado, 401);

  // Y no puede volver a entrar, aunque la contraseña sea la buena.
  const intento = await pedir('POST', '/api/login', {
    cuerpo: { usuario: antonio.email, password: 'incidencias1' }
  });
  assert.strictEqual(intento.estado, 403);
  assert.match(intento.datos.error, /suspendida/i);

  // Deja de estar en el canal, así que tampoco le llegan avisos de lo que se
  // hable allí.
  const mensaje = await escribir(mundo.juan.token, mundo.local1, 'Sin Antonio');
  assert.strictEqual(mensaje.estado, 201);

  const vuelta = await pedir('POST', `/api/usuarios/${antonio.id}/reactivar`, {
    token: mundo.admin
  });
  assert.strictEqual(vuelta.estado, 200);
  const otraVez = await pedir('POST', '/api/login', {
    cuerpo: { usuario: antonio.email, password: 'incidencias1' }
  });
  assert.strictEqual(otraVez.estado, 200);
});

test('la suspensión no la levanta el «reactivar acceso» de los intentos fallidos', async () => {
  const berta = await crearUsuario(mundo.admin, {
    nombre: 'Berta', usuario: 'berta', password: 'incidencias1', rol: 'empleado',
    locales: [mundo.local1]
  });
  await pedir('POST', `/api/usuarios/${berta.id}/suspender`, { token: mundo.admin });

  // Son dos cosas distintas y por eso son dos columnas: si compartieran una,
  // un «reactivar» hecho por despiste devolvería la cuenta a la conversación.
  await pedir('POST', `/api/usuarios/${berta.id}/desbloquear`, { token: mundo.admin });

  const intento = await pedir('POST', '/api/login', {
    cuerpo: { usuario: berta.email, password: 'incidencias1' }
  });
  assert.strictEqual(intento.estado, 403);
});

test('nadie se suspende a sí mismo', async () => {
  // Es lo único que hace falta prohibir para que la instalación no se quede
  // sin administrador: quien suspende sigue dentro, y él puede levantarlo.
  const sesion = (await pedir('GET', '/api/session', { token: mundo.admin })).datos;
  const propia = await pedir('POST', `/api/usuarios/${sesion.id}/suspender`, {
    token: mundo.admin
  });
  assert.strictEqual(propia.estado, 400);

  // A otro administrador sí, y suspender dos veces al mismo no es un error:
  // desde la lista de usuarios y desde la de denuncias se puede pulsar dos
  // veces, y lo segundo tiene que ser un no-hacer-nada.
  const otroAdmin = await crearUsuario(mundo.admin, {
    nombre: 'Otra admin', usuario: 'otraadmin', password: 'incidencias1', rol: 'admin'
  });
  assert.strictEqual(
    (await pedir('POST', `/api/usuarios/${otroAdmin.id}/suspender`, { token: mundo.admin })).estado,
    200);
  assert.strictEqual(
    (await pedir('POST', `/api/usuarios/${otroAdmin.id}/suspender`, { token: mundo.admin })).estado,
    200);
});

test('suspender saca a la persona de los desplegables de asignación', async () => {
  const tecnico = await crearUsuario(mundo.admin, {
    nombre: 'Tomás', usuario: 'tomas', password: 'incidencias1', rol: 'tecnico',
    grupo_id: mundo.mantenimiento, locales: [mundo.local1]
  });

  const antes = (await pedir('GET', '/api/meta', { token: mundo.admin })).datos;
  assert.ok(antes.tecnicos.some((t) => t.id === tecnico.id));

  await pedir('POST', `/api/usuarios/${tecnico.id}/suspender`, { token: mundo.admin });

  const despues = (await pedir('GET', '/api/meta', { token: mundo.admin })).datos;
  assert.ok(!despues.tecnicos.some((t) => t.id === tecnico.id),
    'a quien no puede entrar no se le pueden seguir asignando incidencias');
});

test('resolver una denuncia no cierra las demás del mismo mensaje', async () => {
  // Dos personas avisan del mismo mensaje. Atender a una no es atender a la
  // otra: a cada una se le contesta por separado, y del cierre depende el
  // aviso que se le manda de vuelta.
  const mensaje = await escribir(mundo.jose.token, mundo.local1, 'Dos avisos para esto');
  for (const quien of [mundo.juan, mundo.santiago]) {
    const puesta = await pedir('POST', `/api/chat/mensajes/${mensaje.datos.id}/denuncia`, {
      token: quien.token, cuerpo: {}
    });
    assert.strictEqual(puesta.estado, 201);
  }

  const cola = (await pedir('GET', '/api/chat/denuncias', { token: mundo.admin })).datos;
  const suyas = cola.filter((d) => d.mensaje.id === mensaje.datos.id);
  assert.strictEqual(suyas.length, 2);

  await pedir('POST', `/api/chat/denuncias/${suyas[0].id}/resolver`, { token: mundo.admin });

  const despues = (await pedir('GET', '/api/chat/denuncias', { token: mundo.admin })).datos
    .filter((d) => d.mensaje.id === mensaje.datos.id);
  assert.strictEqual(despues.length, 1);
  assert.strictEqual(despues[0].id, suyas[1].id);

  // Y borrar el mensaje cierra la que quedaba.
  await pedir('DELETE', `/api/chat/mensajes/${mensaje.datos.id}`, { token: mundo.admin });
  const alFinal = (await pedir('GET', '/api/chat/denuncias', { token: mundo.admin })).datos;
  assert.ok(!alFinal.some((d) => d.mensaje.id === mensaje.datos.id));
});

test('resolver dos veces no vuelve a avisar a nadie', async () => {
  // El aviso de vuelta sale de las filas que estaban pendientes, así que la
  // segunda vez no hay ninguna y no se manda nada. Se comprueba por lo que se
  // puede ver: la denuncia no cambia de manos ni de fecha.
  const mensaje = await escribir(mundo.jose.token, mundo.local1, 'Para resolver dos veces');
  await pedir('POST', `/api/chat/mensajes/${mensaje.datos.id}/denuncia`, {
    token: mundo.juan.token, cuerpo: {}
  });
  const cola = (await pedir('GET', '/api/chat/denuncias', { token: mundo.admin })).datos;
  const mia = cola.find((d) => d.mensaje.id === mensaje.datos.id);

  await pedir('POST', `/api/chat/denuncias/${mia.id}/resolver`, { token: mundo.admin });
  const primera = (await pedir('GET', '/api/chat/denuncias?resueltas=1', { token: mundo.admin }))
    .datos.find((d) => d.id === mia.id);

  const otraVez = await pedir('POST', `/api/chat/denuncias/${mia.id}/resolver`, {
    token: mundo.admin
  });
  assert.strictEqual(otraVez.estado, 200);

  const segunda = (await pedir('GET', '/api/chat/denuncias?resueltas=1', { token: mundo.admin }))
    .datos.find((d) => d.id === mia.id);
  assert.strictEqual(segunda.resuelto_en, primera.resuelto_en);
});
