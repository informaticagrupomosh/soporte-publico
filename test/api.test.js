'use strict';

/**
 * Pruebas de la API sobre una base recién creada. Cubren sobre todo la regla
 * que sostiene la aplicación: quién ve qué incidencia.
 *
 * Se levanta el servidor en un puerto libre y se habla con él por HTTP, así que
 * lo que se comprueba es lo mismo que verá la web.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Base de datos propia para las pruebas, borrada antes de empezar.
// Base propia de este archivo de pruebas: los archivos corren a la vez y con
// una compartida se borrarían las filas unos a otros.
const DATA_DIR = path.join(__dirname, '..', 'data', 'pruebas');
process.env.INCIDENCIAS_DB = path.join(DATA_DIR, 'api.db');
fs.mkdirSync(DATA_DIR, { recursive: true });
for (const sufijo of ['', '-wal', '-shm']) {
  fs.rmSync(`${process.env.INCIDENCIAS_DB}${sufijo}`, { force: true });
}
fs.rmSync(path.join(DATA_DIR, 'adjuntos'), { recursive: true, force: true });

// Sin configuración de Office 365: apuntando a un archivo que no existe, las
// pruebas dan igual en una máquina que la tenga puesta y en una que no.
process.env.ENTRA_CONFIG = path.join(DATA_DIR, 'entra-que-no-existe.json');

// Y sin la configuración de la organización: si las pruebas leyeran el
// `data/organizacion.json` de la instalación, cambiar el nombre de la empresa
// —o el local por defecto— rompería la suite. Apuntando a un archivo que no
// existe, corren siempre con los valores genéricos.
process.env.ORGANIZACION_CONFIG = path.join(DATA_DIR, 'organizacion-que-no-existe.json');

const app = require('../server');
const db = require('../db');
const entra = require('../entra');

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

/**
 * Da de alta un usuario y devuelve su token de sesión.
 *
 * El correo es el nombre de acceso, así que se compone a partir del `usuario`
 * que pide cada prueba y se entra con él.
 */
async function crearUsuario(tokenAdmin, datos) {
  const email = datos.email || `${datos.usuario}@ejemplo.test`;
  const alta = await pedir('POST', '/api/usuarios', {
    token: tokenAdmin, cuerpo: { ...datos, email }
  });
  assert.strictEqual(alta.estado, 201, JSON.stringify(alta.datos));
  return { id: alta.datos.id, email, token: await entrar(email, datos.password) };
}

// ---------- Escenario ----------

const mundo = {};

test('el escenario de la especificación se puede montar entero', async () => {
  mundo.admin = await entrar('admin', 'admin');

  const grupos = (await pedir('GET', '/api/grupos', { token: mundo.admin })).datos;
  mundo.informatica = grupos.find((g) => g.nombre === 'Informática').id;
  mundo.mantenimiento = grupos.find((g) => g.nombre === 'Mantenimiento').id;

  const locales = (await pedir('GET', '/api/locales', { token: mundo.admin })).datos;
  mundo.local1 = locales.find((l) => l.nombre === 'LOCAL 1').id;
  mundo.local2 = locales.find((l) => l.nombre === 'LOCAL 2').id;
  mundo.local3 = locales.find((l) => l.nombre === 'LOCAL 3').id;

  // El grupo y la familia son obligatorios para abrir una incidencia; estos
  // son los que usan las pruebas que no comprueban nada relacionado con ellos.
  const areas = (await pedir('GET', '/api/areas', { token: mundo.admin })).datos;
  mundo.areaDefault = areas.find((a) => a.nombre === 'Cocina').id;
  const familia = await pedir('POST', '/api/familias', {
    token: mundo.admin, cuerpo: { nombre: 'General', area_id: mundo.areaDefault }
  });
  mundo.familiaDefault = familia.datos.id;

  // Los tres técnicos del ejemplo de la especificación.
  mundo.jose = await crearUsuario(mundo.admin, {
    nombre: 'José', usuario: 'jose', password: 'incidencias1', rol: 'tecnico',
    grupo_id: mundo.mantenimiento, locales: [mundo.local1]
  });
  mundo.antonio = await crearUsuario(mundo.admin, {
    nombre: 'Antonio', usuario: 'antonio', password: 'incidencias1', rol: 'tecnico',
    grupo_id: mundo.mantenimiento, locales: [mundo.local1, mundo.local2]
  });
  // Santiago no tiene locales: ve toda Informática.
  mundo.santiago = await crearUsuario(mundo.admin, {
    nombre: 'Santiago', usuario: 'santiago', password: 'incidencias1', rol: 'tecnico',
    grupo_id: mundo.informatica, locales: []
  });

  // Dos empleados del mismo local y uno de otro.
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
});

test('un empleado necesita al menos un local', async () => {
  const { estado, datos } = await pedir('POST', '/api/usuarios', {
    token: mundo.admin,
    cuerpo: { nombre: 'Sin sitio', email: 'sinsitio@ejemplo.test', password: 'incidencias1', rol: 'empleado', locales: [] }
  });
  assert.strictEqual(estado, 400);
  assert.match(datos.error, /al menos un local/);
});

test('un técnico necesita un grupo', async () => {
  const { estado, datos } = await pedir('POST', '/api/usuarios', {
    token: mundo.admin,
    cuerpo: { nombre: 'Sin grupo', email: 'singrupo@ejemplo.test', password: 'incidencias1', rol: 'tecnico', locales: [] }
  });
  assert.strictEqual(estado, 400);
  assert.match(datos.error, /departamento/);
});

test('el empleado solo abre incidencias en sus locales', async () => {
  const propio = await pedir('POST', '/api/tickets', {
    token: mundo.juan.token,
    cuerpo: {
      titulo: 'Se ha roto el aire acondicionado', descripcion: 'La sala está a 30 grados.',
      grupo_id: mundo.mantenimiento, local_id: mundo.local1, prioridad: 'urgente',
      area_id: mundo.areaDefault, familia_id: mundo.familiaDefault
    }
  });
  assert.strictEqual(propio.estado, 201);
  mundo.ticketLocal1 = propio.datos.id;

  const ajeno = await pedir('POST', '/api/tickets', {
    token: mundo.juan.token,
    cuerpo: { titulo: 'En otro local', grupo_id: mundo.mantenimiento, local_id: mundo.local3 }
  });
  assert.strictEqual(ajeno.estado, 403);
});

test('un técnico también abre incidencias, en sus locales', async () => {
  const propia = await pedir('POST', '/api/tickets', {
    token: mundo.jose.token,
    cuerpo: {
      titulo: 'Hay que pedir recambios de filtros',
      grupo_id: mundo.mantenimiento, local_id: mundo.local1, area_id: mundo.areaDefault, familia_id: mundo.familiaDefault
    }
  });
  assert.strictEqual(propia.estado, 201, JSON.stringify(propia.datos));
  mundo.ticketDeJose = propia.datos.id;

  // José tiene LOCAL 1 marcado, así que no puede abrirlas en otro local.
  const ajena = await pedir('POST', '/api/tickets', {
    token: mundo.jose.token,
    cuerpo: { titulo: 'En otro local', grupo_id: mundo.mantenimiento, local_id: mundo.local3 }
  });
  assert.strictEqual(ajena.estado, 403);

  // Un técnico puede reportar a otro grupo: se encuentra una avería que no
  // es suya y la abre igual.
  const aOtroGrupo = await pedir('POST', '/api/tickets', {
    token: mundo.jose.token,
    cuerpo: {
      titulo: 'El ordenador de la oficina no arranca', grupo_id: mundo.informatica, local_id: mundo.local1,
      area_id: mundo.areaDefault, familia_id: mundo.familiaDefault
    }
  });
  assert.strictEqual(aOtroGrupo.estado, 201);
  // Y deja de verla, porque ya no es de su grupo.
  const suyas = (await pedir('GET', '/api/tickets', { token: mundo.jose.token })).datos;
  assert.ok(!suyas.some((t) => t.id === aOtroGrupo.datos.id),
    'Mantenimiento no recibe lo que es de Informática, ni aunque lo haya abierto un técnico suyo');
});

test('un técnico sin locales puede abrir en cualquiera', async () => {
  // Santiago no tiene locales marcados: atiende todos los de Informática, así
  // que también puede abrir incidencias en todos.
  const { estado, datos } = await pedir('POST', '/api/tickets', {
    token: mundo.santiago.token,
    cuerpo: {
      titulo: 'Cambiar el router', grupo_id: mundo.informatica, local_id: mundo.local2,
      area_id: mundo.areaDefault, familia_id: mundo.familiaDefault
    }
  });
  assert.strictEqual(estado, 201, JSON.stringify(datos));
});

test('los compañeros de local ven las incidencias del otro', async () => {
  const deMaria = await pedir('GET', '/api/tickets', { token: mundo.maria.token });
  assert.ok(deMaria.datos.some((t) => t.id === mundo.ticketLocal1),
    'María trabaja en LOCAL 1 y tiene que ver la incidencia de Juan');

  // Lucía trabaja en LOCAL 3: no ve nada de LOCAL 1.
  const deLucia = await pedir('GET', '/api/tickets', { token: mundo.lucia.token });
  assert.ok(!deLucia.datos.some((t) => t.id === mundo.ticketLocal1));
  const directa = await pedir('GET', `/api/tickets/${mundo.ticketLocal1}`, { token: mundo.lucia.token });
  assert.strictEqual(directa.estado, 404, 'una incidencia ajena ni siquiera se reconoce');
});

test('el técnico ve las de su grupo y sus locales', async () => {
  // Una de Informática en LOCAL 2, para separar los casos.
  const lucia = await pedir('POST', '/api/tickets', {
    token: mundo.lucia.token,
    cuerpo: {
      titulo: 'El TPV no arranca', grupo_id: mundo.informatica, local_id: mundo.local3,
      area_id: mundo.areaDefault, familia_id: mundo.familiaDefault
    }
  });
  assert.strictEqual(lucia.estado, 201);
  mundo.ticketInformatica = lucia.datos.id;

  const deJose = (await pedir('GET', '/api/tickets', { token: mundo.jose.token })).datos;
  assert.ok(deJose.some((t) => t.id === mundo.ticketLocal1), 'José ve Mantenimiento en LOCAL 1');
  assert.ok(!deJose.some((t) => t.id === mundo.ticketInformatica), 'José no ve Informática');

  const deSantiago = (await pedir('GET', '/api/tickets', { token: mundo.santiago.token })).datos;
  assert.ok(deSantiago.some((t) => t.id === mundo.ticketInformatica),
    'Santiago no tiene locales: ve toda Informática');
  assert.ok(!deSantiago.some((t) => t.id === mundo.ticketLocal1), 'pero no ve Mantenimiento');
});

test('el técnico cambia el estado y se asigna la incidencia', async () => {
  const asignar = await pedir('PUT', `/api/tickets/${mundo.ticketLocal1}`, {
    token: mundo.jose.token,
    cuerpo: { estado: 'pendiente', asignado_a: mundo.jose.id }
  });
  assert.strictEqual(asignar.estado, 200);
  assert.strictEqual(asignar.datos.estado, 'pendiente');
  assert.strictEqual(asignar.datos.asignado_a, mundo.jose.id);
  assert.strictEqual(asignar.datos.cerrado_en, null, 'todavía no está resuelta');
});

test('no se puede asignar a un técnico de otro grupo', async () => {
  const { estado, datos } = await pedir('PUT', `/api/tickets/${mundo.ticketLocal1}`, {
    token: mundo.jose.token,
    cuerpo: { asignado_a: mundo.santiago.id }
  });
  assert.strictEqual(estado, 400);
  assert.match(datos.error, /otro departamento/);
});

test('el empleado no gestiona la incidencia, aunque la vea', async () => {
  const { estado } = await pedir('PUT', `/api/tickets/${mundo.ticketLocal1}`, {
    token: mundo.juan.token, cuerpo: { estado: 'cerrado' }
  });
  assert.strictEqual(estado, 403);
});

test('cerrar deja fecha de cierre y reabrir la quita', async () => {
  const cerrada = await pedir('PUT', `/api/tickets/${mundo.ticketLocal1}`, {
    token: mundo.jose.token, cuerpo: { estado: 'cerrado' }
  });
  assert.strictEqual(cerrada.datos.estado, 'cerrado');
  assert.ok(cerrada.datos.cerrado_en, 'una incidencia cerrada anota cuándo se resolvió');

  const reabierta = await pedir('PUT', `/api/tickets/${mundo.ticketLocal1}`, {
    token: mundo.jose.token, cuerpo: { estado: 'abierto' }
  });
  assert.strictEqual(reabierta.datos.cerrado_en, null);

  // Se deja cerrada para los informes.
  await pedir('PUT', `/api/tickets/${mundo.ticketLocal1}`, {
    token: mundo.jose.token, cuerpo: { estado: 'cerrado' }
  });
});

test('el hilo de mensajes lo escriben los dos lados', async () => {
  const delEmpleado = await pedir('POST', `/api/tickets/${mundo.ticketLocal1}/mensajes`, {
    token: mundo.juan.token, cuerpo: { contenido: '¿Se sabe algo?' }
  });
  assert.strictEqual(delEmpleado.estado, 201);

  const delTecnico = await pedir('POST', `/api/tickets/${mundo.ticketLocal1}/mensajes`, {
    token: mundo.jose.token, cuerpo: { contenido: 'Mañana pasa el técnico del aire.' }
  });
  assert.strictEqual(delTecnico.estado, 201);

  const detalle = await pedir('GET', `/api/tickets/${mundo.ticketLocal1}`, { token: mundo.maria.token });
  // Tres: el mensaje que abre la incidencia con su descripción, y los dos de
  // ahora. La descripción es el primer mensaje del hilo, no una ficha aparte.
  assert.strictEqual(detalle.datos.mensajes_hilo.length, 3);
  assert.strictEqual(detalle.datos.mensajes_hilo[0].apertura, 1);
  assert.strictEqual(detalle.datos.mensajes_hilo[0].contenido, 'La sala está a 30 grados.');
  assert.strictEqual(detalle.datos.puedeGestionar, false, 'María es empleada');

  // Quien no ve la incidencia tampoco puede escribir en ella.
  const intruso = await pedir('POST', `/api/tickets/${mundo.ticketLocal1}/mensajes`, {
    token: mundo.lucia.token, cuerpo: { contenido: 'Hola' }
  });
  assert.strictEqual(intruso.estado, 404);

  const vacio = await pedir('POST', `/api/tickets/${mundo.ticketLocal1}/mensajes`, {
    token: mundo.juan.token, cuerpo: { contenido: '   ' }
  });
  assert.strictEqual(vacio.estado, 400);
});

test('los adjuntos se suben, se descargan y se protegen', async () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const subida = await pedir('POST', `/api/tickets/${mundo.ticketLocal1}/adjuntos?nombre=aire.png`, {
    token: mundo.juan.token, crudo: png, tipo: 'image/png'
  });
  assert.strictEqual(subida.estado, 201, JSON.stringify(subida.datos));
  assert.strictEqual(subida.datos.tipo, 'imagen');
  mundo.adjunto = subida.datos.id;

  // Un formato que no se admite.
  const rechazado = await pedir('POST', `/api/tickets/${mundo.ticketLocal1}/adjuntos?nombre=virus.exe`, {
    token: mundo.juan.token, crudo: png
  });
  assert.strictEqual(rechazado.estado, 400);

  // El archivo se descarga si se ve la incidencia, y no si no.
  const res = await fetch(`${base}/api/adjuntos/${mundo.adjunto}`, {
    headers: { Authorization: `Bearer ${mundo.jose.token}` }
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('content-type'), 'image/png');
  assert.strictEqual(Buffer.from(await res.arrayBuffer()).length, png.length);

  const ajeno = await pedir('GET', `/api/adjuntos/${mundo.adjunto}`, { token: mundo.lucia.token });
  assert.strictEqual(ajeno.estado, 404);

  // Solo lo borra quien lo subió (o un administrador).
  const deOtro = await pedir('DELETE', `/api/adjuntos/${mundo.adjunto}`, { token: mundo.jose.token });
  assert.strictEqual(deOtro.estado, 403);
});

test('el vídeo se admite como adjunto y con su propio tope', async () => {
  // Un WEBM mínimo: al servidor le importan la extensión y el tamaño.
  const video = Buffer.alloc(64, 7);
  const subida = await pedir('POST', `/api/tickets/${mundo.ticketLocal1}/adjuntos?nombre=averia.webm`, {
    token: mundo.juan.token, crudo: video, tipo: 'video/webm'
  });
  assert.strictEqual(subida.estado, 201, JSON.stringify(subida.datos));
  assert.strictEqual(subida.datos.tipo, 'video', 'se guarda como vídeo, no como documento');

  // Un documento por encima de su tope se rechaza aunque quepa en el del vídeo.
  const grande = Buffer.alloc(11 * 1024 * 1024, 1);
  const rechazado = await pedir('POST', `/api/tickets/${mundo.ticketLocal1}/adjuntos?nombre=manual.pdf`, {
    token: mundo.juan.token, crudo: grande, tipo: 'application/pdf'
  });
  assert.strictEqual(rechazado.estado, 413);
  assert.match(rechazado.datos.error, /10 MB/);
});

test('los informes cuentan entradas y resueltas del rango', async () => {
  const hoy = new Date().toISOString().slice(0, 10);
  const { estado, datos } = await pedir('GET', `/api/informes?desde=${hoy}&hasta=${hoy}`, {
    token: mundo.admin
  });
  assert.strictEqual(estado, 200);
  // Las cinco de hoy: dos de Juan y Lucía, dos de José y una de Santiago.
  assert.strictEqual(datos.total.entrados, 5);
  assert.strictEqual(datos.total.resueltos, 1, 'solo la de LOCAL 1 se ha cerrado');
  assert.strictEqual(datos.total.pendientes, 4);

  // El técnico solo informa de su grupo, aunque pida otro.
  const deJose = await pedir('GET', `/api/informes?desde=${hoy}&hasta=${hoy}&grupo_id=${mundo.informatica}`, {
    token: mundo.jose.token
  });
  assert.strictEqual(deJose.datos.total.entrados, 0, 'José es de Mantenimiento');

  // El empleado no tiene informes.
  const deJuan = await pedir('GET', `/api/informes?desde=${hoy}&hasta=${hoy}`, { token: mundo.juan.token });
  assert.strictEqual(deJuan.estado, 403);
});

test('los informes cuentan lo gestionado por cada técnico', async () => {
  const hoy = new Date().toISOString().slice(0, 10);
  const { datos } = await pedir('GET', `/api/informes?desde=${hoy}&hasta=${hoy}`, { token: mundo.admin });
  assert.strictEqual(
    datos.estado.abiertas + datos.estado.pendientes + datos.estado.cerradas,
    datos.total.entrados,
    'los tres estados suman todo lo entrado'
  );

  // Filtrar por técnico cuenta lo que tiene asignado, no lo que abrió.
  const deJose = await pedir(
    'GET', `/api/informes?desde=${hoy}&hasta=${hoy}&tecnico_id=${mundo.jose.id}`, { token: mundo.admin }
  );
  assert.strictEqual(deJose.datos.total.entrados, 1, 'José solo tiene la de LOCAL 1 asignada');
  assert.strictEqual(deJose.datos.estado.cerradas, 1);

  // Antonio no tiene ninguna asignada.
  const deAntonio = await pedir(
    'GET', `/api/informes?desde=${hoy}&hasta=${hoy}&tecnico_id=${mundo.antonio.id}`, { token: mundo.admin }
  );
  assert.strictEqual(deAntonio.datos.total.entrados, 0);
});

test('un técnico solo ve sus propios informes', async () => {
  const hoy = new Date().toISOString().slice(0, 10);
  // Aunque pida los de otro, le devuelven los suyos.
  const { datos } = await pedir(
    'GET', `/api/informes?desde=${hoy}&hasta=${hoy}&tecnico_id=${mundo.antonio.id}`,
    { token: mundo.jose.token }
  );
  assert.strictEqual(datos.tecnico, mundo.jose.id, 'el filtro se fija en él mismo');
  assert.strictEqual(datos.total.entrados, 1, 'y son sus números, no los de Antonio');

  // Y en la meta solo se ve a sí mismo.
  const meta = await pedir('GET', '/api/meta', { token: mundo.jose.token });
  assert.deepStrictEqual(meta.datos.tecnicosInformes.map((t) => t.nombre), ['José']);
  assert.strictEqual(meta.datos.tecnicoFijado, mundo.jose.id);
});

test('el filtro de técnicos llega en la meta para quien puede verlo todo', async () => {
  const { datos } = await pedir('GET', '/api/meta', { token: mundo.admin });
  const nombres = datos.tecnicosInformes.map((t) => t.nombre);
  for (const quien of ['José', 'Antonio', 'Santiago']) {
    assert.ok(nombres.includes(quien), `${quien} debería estar en el filtro`);
  }
  assert.ok(!nombres.includes('Juan'), 'los empleados no gestionan incidencias');
  assert.strictEqual(datos.tecnicoFijado, null);
});

test('el buscador ignora acentos y mayúsculas', async () => {
  const conAcento = await pedir('GET', '/api/tickets?q=LUCIA', { token: mundo.admin });
  assert.ok(conAcento.datos.some((t) => t.id === mundo.ticketInformatica),
    '«LUCIA» tiene que encontrar las de «Lucía»');
});

test('una tarea programada sin local abre una incidencia por local', async () => {
  const locales = db.prepare('SELECT COUNT(*) AS c FROM locales').get().c;
  const alta = await pedir('POST', '/api/tareas', {
    token: mundo.admin,
    cuerpo: {
      nombre: 'Revisión de extintores',
      frecuencia: 'mensual',
      hora: '09:00',
      fecha_inicio: '2026-01-01',
      dias_mes: '1',
      plantilla_titulo: 'Revisión mensual de extintores',
      plantilla_descripcion: 'Comprobar presión y fecha de caducidad.',
      grupo_id: mundo.mantenimiento,
      local_id: null,
      prioridad: 'normal'
    }
  });
  assert.strictEqual(alta.estado, 201, JSON.stringify(alta.datos));

  const lanzada = await pedir('POST', `/api/tareas/${alta.datos.id}/ejecutar`, { token: mundo.admin });
  assert.strictEqual(lanzada.datos.creadas, locales, 'una incidencia por cada local');

  // Las abre el programador, no una persona.
  const creada = db.prepare('SELECT * FROM tickets WHERE tarea_id = ? LIMIT 1').get(alta.datos.id);
  assert.strictEqual(creada.creado_por, null);
  assert.strictEqual(creada.estado, 'abierto');
});

test('una planificación incompleta no se guarda', async () => {
  const base = {
    nombre: 'Mal rellenada', frecuencia: 'semanal', hora: '09:00',
    fecha_inicio: '2026-01-01', cada: 1,
    plantilla_titulo: 'Nada', grupo_id: mundo.mantenimiento
  };
  // Semanal sin ningún día marcado.
  const sinDias = await pedir('POST', '/api/tareas', { token: mundo.admin, cuerpo: base });
  assert.strictEqual(sinDias.estado, 400);
  assert.match(sinDias.datos.error, /día de la semana/);

  // Hora imposible.
  const malaHora = await pedir('POST', '/api/tareas', {
    token: mundo.admin, cuerpo: { ...base, dias_semana: '1', hora: '99:99' }
  });
  assert.strictEqual(malaHora.estado, 400);
  assert.match(malaHora.datos.error, /hora/i);
});

test('una tarea semanal guarda y devuelve su planificación', async () => {
  const alta = await pedir('POST', '/api/tareas', {
    token: mundo.admin,
    cuerpo: {
      nombre: 'Copias de seguridad',
      frecuencia: 'semanal', hora: '08:30', fecha_inicio: '2026-01-05', cada: 2,
      dias_semana: '1,4',
      plantilla_titulo: 'Comprobar copias', grupo_id: mundo.informatica,
      local_id: mundo.local1, prioridad: 'normal'
    }
  });
  assert.strictEqual(alta.estado, 201, JSON.stringify(alta.datos));
  assert.strictEqual(alta.datos.frecuencia, 'semanal');
  assert.strictEqual(alta.datos.hora, '08:30');
  assert.strictEqual(alta.datos.cada, 2);
  assert.strictEqual(alta.datos.dias_semana, '1,4');
  assert.ok(alta.datos.proxima, 'la tarea dice cuándo le toca la próxima vez');
  assert.ok(new Date(alta.datos.proxima) > new Date(), 'y es en el futuro');
  mundo.tareaSemanal = alta.datos.id;
});

test('una tarea detenida no anuncia próxima ejecución', async () => {
  const alta = await pedir('POST', '/api/tareas', {
    token: mundo.admin,
    cuerpo: {
      nombre: 'Detenida', frecuencia: 'diaria', hora: '09:00',
      fecha_inicio: '2026-01-01', cada: 1, activo: false,
      plantilla_titulo: 'Nada', grupo_id: mundo.mantenimiento
    }
  });
  assert.strictEqual(alta.estado, 201);
  assert.strictEqual(alta.datos.activo, 0);
  assert.strictEqual(alta.datos.proxima, null);
});

test('las empresas se crean, editan y borran, y una tarea de mantenimiento externo exige una', async () => {
  const alta = await pedir('POST', '/api/empresas', {
    token: mundo.admin,
    cuerpo: { nombre: 'Climatel', contacto: 'Marta', telefono: '900111222', email: 'marta@climatel.example' }
  });
  assert.strictEqual(alta.estado, 201, JSON.stringify(alta.datos));
  const empresaId = alta.datos.id;

  const repetida = await pedir('POST', '/api/empresas', { token: mundo.admin, cuerpo: { nombre: 'Climatel' } });
  assert.strictEqual(repetida.estado, 400);

  const editada = await pedir('PUT', `/api/empresas/${empresaId}`, {
    token: mundo.admin, cuerpo: { nombre: 'Climatel S.L.', telefono: '900111333' }
  });
  assert.strictEqual(editada.estado, 200);
  assert.strictEqual(editada.datos.nombre, 'Climatel S.L.');
  assert.strictEqual(editada.datos.telefono, '900111333');

  // Marcada como externa, la empresa es obligatoria.
  const sinEmpresa = await pedir('POST', '/api/tareas', {
    token: mundo.admin,
    cuerpo: {
      nombre: 'Revisión de climatización', frecuencia: 'mensual', hora: '09:00',
      fecha_inicio: '2026-01-01', dias_mes: '1',
      plantilla_titulo: 'Revisar climatización', grupo_id: mundo.mantenimiento,
      local_id: mundo.local1, mantenimiento_externo: true
    }
  });
  assert.strictEqual(sinEmpresa.estado, 400);
  assert.match(sinEmpresa.datos.error, /empresa/i);

  const alta2 = await pedir('POST', '/api/tareas', {
    token: mundo.admin,
    cuerpo: {
      nombre: 'Revisión de climatización', frecuencia: 'mensual', hora: '09:00',
      fecha_inicio: '2026-01-01', dias_mes: '1',
      plantilla_titulo: 'Revisar climatización', grupo_id: mundo.mantenimiento,
      local_id: mundo.local1, mantenimiento_externo: true, empresa_id: empresaId
    }
  });
  assert.strictEqual(alta2.estado, 201, JSON.stringify(alta2.datos));
  assert.strictEqual(alta2.datos.mantenimiento_externo, 1);
  assert.strictEqual(alta2.datos.empresa_nombre, 'Climatel S.L.');

  // La incidencia que abre hereda la empresa, para que se vea en su ficha.
  const lanzada = await pedir('POST', `/api/tareas/${alta2.datos.id}/ejecutar`, { token: mundo.admin });
  assert.strictEqual(lanzada.estado, 200, JSON.stringify(lanzada.datos));
  const creada = db.prepare('SELECT id FROM tickets WHERE tarea_id = ? LIMIT 1').get(alta2.datos.id);
  const ficha = await pedir('GET', `/api/tickets/${creada.id}`, { token: mundo.admin });
  assert.strictEqual(ficha.datos.empresa_nombre, 'Climatel S.L.');

  // No se puede borrar una empresa con tareas.
  const conTareas = await pedir('DELETE', `/api/empresas/${empresaId}`, { token: mundo.admin });
  assert.strictEqual(conTareas.estado, 400);
  assert.match(conTareas.datos.error, /tareas/);

  // Ni, ya sin la tarea, con la incidencia que le quedó: la empresa se queda
  // en su ficha aunque la tarea que la abrió se elimine.
  await pedir('DELETE', `/api/tareas/${alta2.datos.id}`, { token: mundo.admin });
  const conIncidencias = await pedir('DELETE', `/api/empresas/${empresaId}`, { token: mundo.admin });
  assert.strictEqual(conIncidencias.estado, 400);
  assert.match(conIncidencias.datos.error, /incidencias/);
});

test('el calendario enseña en qué días caen las tareas, por mes y por año', async () => {
  const area = await pedir('POST', '/api/areas', { token: mundo.admin, cuerpo: { nombre: 'Sala de calendario' } });
  const familia = await pedir('POST', '/api/familias', {
    token: mundo.admin, cuerpo: { nombre: 'Extintores', area_id: area.datos.id }
  });
  const empresa = await pedir('POST', '/api/empresas', {
    token: mundo.admin, cuerpo: { nombre: 'Prosegur del calendario' }
  });

  // Diaria desde hace una semana: hoy es, seguro, uno de sus días, sin
  // depender de en qué día del mes caiga la prueba.
  const hace7dias = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const alta = await pedir('POST', '/api/tareas', {
    token: mundo.admin,
    cuerpo: {
      nombre: 'Revisión de extintores del calendario', frecuencia: 'diaria', hora: '09:00',
      fecha_inicio: hace7dias, cada: 1,
      plantilla_titulo: 'Revisar extintores', grupo_id: mundo.mantenimiento, local_id: mundo.local1,
      mantenimiento_externo: true, empresa_id: empresa.datos.id,
      area_id: area.datos.id, familia_id: familia.datos.id
    }
  });
  assert.strictEqual(alta.estado, 201, JSON.stringify(alta.datos));
  assert.strictEqual(alta.datos.area_nombre, 'Sala de calendario');
  assert.strictEqual(alta.datos.familia_nombre, 'Extintores');

  const hoy = new Date();
  const anio = hoy.getFullYear();
  const mes = hoy.getMonth() + 1;
  const dia = String(hoy.getDate());
  // Un día anterior dentro de la misma semana de la tarea, para el que nunca
  // se llegó a abrir incidencia: tiene que salir «atrasada».
  const anteayer = new Date(Date.now() - 2 * 86400000);
  const diaAtrasado = String(anteayer.getDate());
  const mesDelAtrasado = anteayer.getMonth() + 1;
  const anioDelAtrasado = anteayer.getFullYear();

  // Vista de mes: hoy está entre sus días, y todavía no se ha abierto de verdad.
  const antes = await pedir(
    'GET', `/api/calendario?anio=${anio}&mes=${mes}&area_id=${area.datos.id}`, { token: mundo.admin }
  );
  assert.strictEqual(antes.estado, 200);
  assert.strictEqual(antes.datos.anio, anio);
  assert.strictEqual(antes.datos.mes, mes);
  const eventosHoy = antes.datos.dias[dia] || [];
  const eventoAntes = eventosHoy.find((e) => e.id === alta.datos.id);
  assert.ok(eventoAntes, 'la tarea sale hoy en la vista de mes');
  assert.strictEqual(eventoAntes.estado, 'pendiente', 'hoy todavía no ha pasado, así que no está atrasada');
  assert.strictEqual(eventoAntes.empresa_nombre, 'Prosegur del calendario');
  assert.strictEqual(eventoAntes.familia_nombre, 'Extintores');

  // Un día anterior sin incidencia abierta sale como atrasado.
  const vistaAtrasado = await pedir(
    'GET', `/api/calendario?anio=${anioDelAtrasado}&mes=${mesDelAtrasado}&area_id=${area.datos.id}`,
    { token: mundo.admin }
  );
  const eventoAtrasado = (vistaAtrasado.datos.dias[diaAtrasado] || []).find((e) => e.id === alta.datos.id);
  assert.ok(eventoAtrasado, 'la tarea también salía ese día');
  assert.strictEqual(eventoAtrasado.estado, 'atrasada');

  // Vista de año: el mes actual trae el día de hoy y cuenta la tarea.
  const anioAntes = await pedir('GET', `/api/calendario?anio=${anio}&familia_id=${familia.datos.id}`, {
    token: mundo.admin
  });
  const filaMesAntes = anioAntes.datos.meses.find((m) => m.mes === mes);
  assert.ok(filaMesAntes.dias.includes(Number(dia)));
  assert.strictEqual(filaMesAntes.tareas, 1);
  assert.strictEqual(anioAntes.datos.meses.length, 12);

  const ejecutada = await pedir('POST', `/api/tareas/${alta.datos.id}/ejecutar`, { token: mundo.admin });
  assert.strictEqual(ejecutada.estado, 200);
  const ticketId = db.prepare('SELECT id FROM tickets WHERE tarea_id = ? LIMIT 1').get(alta.datos.id).id;

  // Ejecutada pero todavía abierta, hoy sigue pendiente, no cerrada.
  const trasEjecutar = await pedir(
    'GET', `/api/calendario?anio=${anio}&mes=${mes}&familia_id=${familia.datos.id}`, { token: mundo.admin }
  );
  const eventoTrasEjecutar = trasEjecutar.datos.dias[dia].find((e) => e.id === alta.datos.id);
  assert.strictEqual(eventoTrasEjecutar.estado, 'pendiente', 'abrirse no basta: hay que resolverla');

  // Cerrada la incidencia, el evento de hoy pasa a «cerrada».
  await pedir('PUT', `/api/tickets/${ticketId}`, { token: mundo.admin, cuerpo: { estado: 'cerrado' } });
  const despues = await pedir(
    'GET', `/api/calendario?anio=${anio}&mes=${mes}&familia_id=${familia.datos.id}`, { token: mundo.admin }
  );
  const eventoDespues = despues.datos.dias[dia].find((e) => e.id === alta.datos.id);
  assert.strictEqual(eventoDespues.estado, 'cerrada', 'resuelta, el día queda marcado como cerrado');

  // Filtrar por mantenimiento externo o por otra empresa la deja fuera o dentro, según toque.
  const soloExterno = await pedir(
    'GET', `/api/calendario?anio=${anio}&mes=${mes}&area_id=${area.datos.id}&mantenimiento_externo=1`,
    { token: mundo.admin }
  );
  assert.ok((soloExterno.datos.dias[dia] || []).some((e) => e.id === alta.datos.id));
  const soloInterno = await pedir(
    'GET', `/api/calendario?anio=${anio}&mes=${mes}&area_id=${area.datos.id}&mantenimiento_externo=0`,
    { token: mundo.admin }
  );
  assert.ok(!(soloInterno.datos.dias[dia] || []).some((e) => e.id === alta.datos.id));

  // Un mes fuera de rango es un error, no una vista vacía silenciosa.
  assert.strictEqual((await pedir('GET', `/api/calendario?anio=${anio}&mes=13`, { token: mundo.admin })).estado, 400);

  // El calendario es de solo lectura: un técnico también llega, aunque no
  // gestione el programador de tareas.
  assert.strictEqual((await pedir('GET', '/api/calendario', { token: mundo.jose.token })).estado, 200);
  // Pero quien no gestiona incidencias, no.
  assert.strictEqual((await pedir('GET', '/api/calendario', { token: mundo.juan.token })).estado, 403);

  // Un técnico solo ve el mantenimiento de su propio departamento: el de
  // Informática no se entera del de Mantenimiento, y viceversa.
  const tareaInformatica = await pedir('POST', '/api/tareas', {
    token: mundo.admin,
    cuerpo: {
      nombre: 'Revisión de red del calendario', frecuencia: 'diaria', hora: '09:00',
      fecha_inicio: hace7dias, cada: 1,
      plantilla_titulo: 'Revisar red', grupo_id: mundo.informatica, local_id: mundo.local1
    }
  });
  assert.strictEqual(tareaInformatica.estado, 201, JSON.stringify(tareaInformatica.datos));

  const vistaJose = await pedir('GET', `/api/calendario?anio=${anio}&mes=${mes}`, { token: mundo.jose.token });
  assert.ok((vistaJose.datos.dias[dia] || []).some((e) => e.id === alta.datos.id),
    'el técnico de Mantenimiento ve la tarea de su departamento');
  assert.ok(!(vistaJose.datos.dias[dia] || []).some((e) => e.id === tareaInformatica.datos.id),
    'pero no la de Informática');

  const vistaSantiago = await pedir('GET', `/api/calendario?anio=${anio}&mes=${mes}`, { token: mundo.santiago.token });
  assert.ok((vistaSantiago.datos.dias[dia] || []).some((e) => e.id === tareaInformatica.datos.id),
    'el técnico de Informática ve la tarea de su departamento');
  assert.ok(!(vistaSantiago.datos.dias[dia] || []).some((e) => e.id === alta.datos.id),
    'pero no la de Mantenimiento');

  // El administrador no tiene departamento: sigue viendo las dos.
  const vistaAdmin = await pedir('GET', `/api/calendario?anio=${anio}&mes=${mes}`, { token: mundo.admin });
  assert.ok((vistaAdmin.datos.dias[dia] || []).some((e) => e.id === alta.datos.id));
  assert.ok((vistaAdmin.datos.dias[dia] || []).some((e) => e.id === tareaInformatica.datos.id));

  // El propio departamento se impone: un técnico no se cuela en el ajeno
  // aunque pida ese `grupo_id` directamente.
  const intentoColado = await pedir(
    'GET', `/api/calendario?anio=${anio}&mes=${mes}&grupo_id=${mundo.informatica}`, { token: mundo.jose.token }
  );
  assert.ok(!(intentoColado.datos.dias[dia] || []).some((e) => e.id === tareaInformatica.datos.id),
    'un técnico no puede colarse en el departamento de otro cambiando el filtro');
});

test('la lavandería: se envía, se cuenta la vuelta y la diferencia queda como merma', async () => {
  const prenda = await pedir('POST', '/api/prendas-lavanderia', {
    token: mundo.admin, cuerpo: { nombre: 'Toallas de prueba' }
  });
  assert.strictEqual(prenda.estado, 201, JSON.stringify(prenda.datos));
  const prendaId = prenda.datos.id;

  const repetida = await pedir('POST', '/api/prendas-lavanderia', {
    token: mundo.admin, cuerpo: { nombre: 'Toallas de prueba' }
  });
  assert.strictEqual(repetida.estado, 400);

  const editada = await pedir('PUT', `/api/prendas-lavanderia/${prendaId}`, {
    token: mundo.admin, cuerpo: { nombre: 'Toallas de prueba (grandes)' }
  });
  assert.strictEqual(editada.estado, 200);

  // El rol «usuario» no trabaja de cara al local: se queda fuera.
  const pedro = await crearUsuario(mundo.admin, {
    nombre: 'Pedro de lavandería', usuario: 'pedro_lavanderia', password: 'incidencias1', rol: 'usuario',
    locales: [mundo.local1]
  });
  assert.strictEqual((await pedir('GET', '/api/lavanderia', { token: pedro.token })).estado, 403);
  assert.strictEqual((await pedir('POST', '/api/lavanderia', {
    token: pedro.token, cuerpo: { local_id: mundo.local1, items: [{ prenda_id: prendaId, enviado: 1 }] }
  })).estado, 403);

  // El técnico tampoco: no trabaja de cara al local, es cosa del empleado
  // y de quien lo supervisa. Ningún departamento cambia esto, ni siquiera
  // Informática.
  assert.strictEqual((await pedir('GET', '/api/lavanderia', { token: mundo.jose.token })).estado, 403);
  assert.strictEqual((await pedir('GET', '/api/lavanderia', { token: mundo.santiago.token })).estado, 403);

  // Un empleado sí, pero solo para su propio local.
  const otroLocal = (await pedir('GET', '/api/locales', { token: mundo.admin }))
    .datos.find((l) => l.id !== mundo.local1).id;
  const localAjeno = await pedir('POST', '/api/lavanderia', {
    token: mundo.juan.token,
    cuerpo: { local_id: otroLocal, items: [{ prenda_id: prendaId, enviado: 3 }] }
  });
  assert.strictEqual(localAjeno.estado, 400);

  const sinPrendas = await pedir('POST', '/api/lavanderia', {
    token: mundo.juan.token, cuerpo: { local_id: mundo.local1, items: [] }
  });
  assert.strictEqual(sinPrendas.estado, 400);

  const envio = await pedir('POST', '/api/lavanderia', {
    token: mundo.juan.token,
    cuerpo: {
      local_id: mundo.local1, notas: 'Turno de tarde',
      items: [{ prenda_id: prendaId, enviado: 10 }]
    }
  });
  assert.strictEqual(envio.estado, 201, JSON.stringify(envio.datos));
  assert.strictEqual(envio.datos.local_nombre, 'LOCAL 1');
  assert.strictEqual(envio.datos.recibido_en, null);
  assert.strictEqual(envio.datos.items[0].enviado, 10);
  assert.strictEqual(envio.datos.items[0].recibido, null);

  const pendientes = await pedir('GET', '/api/lavanderia?estado=pendiente', { token: mundo.juan.token });
  assert.ok(pendientes.datos.some((e) => e.id === envio.datos.id));

  // El rango de fechas es opcional, pero si viene tiene que ser válido.
  const hoy = new Date().toISOString().slice(0, 10);
  const enRango = await pedir('GET', `/api/lavanderia?desde=${hoy}&hasta=${hoy}`, { token: mundo.juan.token });
  assert.ok(enRango.datos.some((e) => e.id === envio.datos.id));
  const fueraDeRango = await pedir('GET', '/api/lavanderia?desde=2000-01-01&hasta=2000-01-31', {
    token: mundo.juan.token
  });
  assert.ok(!fueraDeRango.datos.some((e) => e.id === envio.datos.id));
  const rangoAMedias = await pedir('GET', `/api/lavanderia?desde=${hoy}`, { token: mundo.juan.token });
  assert.strictEqual(rangoAMedias.estado, 400);
  const rangoInvertido = await pedir('GET', `/api/lavanderia?desde=${hoy}&hasta=2000-01-01`, {
    token: mundo.juan.token
  });
  assert.strictEqual(rangoInvertido.estado, 400);

  // Faltar una prenda al contar la vuelta no se deja pasar en silencio.
  const recepcionIncompleta = await pedir('PUT', `/api/lavanderia/${envio.datos.id}/recepcion`, {
    token: mundo.juan.token, cuerpo: { items: [] }
  });
  assert.strictEqual(recepcionIncompleta.estado, 400);

  // Vuelven 8 de las 10: 2 de merma.
  const recepcion = await pedir('PUT', `/api/lavanderia/${envio.datos.id}/recepcion`, {
    token: mundo.juan.token,
    cuerpo: { notas_recepcion: 'Faltan dos', items: [{ prenda_id: prendaId, recibido: 8 }] }
  });
  assert.strictEqual(recepcion.estado, 200, JSON.stringify(recepcion.datos));
  assert.ok(recepcion.datos.recibido_en);
  assert.strictEqual(recepcion.datos.items[0].recibido, 8);

  // No se puede contar la vuelta dos veces.
  const otraVez = await pedir('PUT', `/api/lavanderia/${envio.datos.id}/recepcion`, {
    token: mundo.juan.token, cuerpo: { items: [{ prenda_id: prendaId, recibido: 10 }] }
  });
  assert.strictEqual(otraVez.estado, 400);

  // El informe compara lo enviado con lo recibido, y saca la merma.
  const informe = await pedir('GET', `/api/informes?desde=${hoy}&hasta=${hoy}`, { token: mundo.admin });
  const filaPrenda = informe.datos.lavanderia.find((p) => p.id === prendaId);
  assert.ok(filaPrenda, 'la prenda sale en el reparto de lavandería');
  assert.strictEqual(filaPrenda.enviado, 10);
  assert.strictEqual(filaPrenda.recibido, 8);
  assert.strictEqual(filaPrenda.merma, 2);
  assert.strictEqual(filaPrenda.pendiente, 0);

  // La lavandería no es cosa del técnico: su informe no trae ese desglose,
  // aunque el mismo rango sí tenga envíos para quien puede verlos.
  const informeTecnico = await pedir('GET', `/api/informes?desde=${hoy}&hasta=${hoy}`, { token: mundo.jose.token });
  assert.strictEqual(informeTecnico.estado, 200);
  assert.deepStrictEqual(informeTecnico.datos.lavanderia, []);

  // No se puede borrar una prenda con envíos.
  const conEnvios = await pedir('DELETE', `/api/prendas-lavanderia/${prendaId}`, { token: mundo.admin });
  assert.strictEqual(conEnvios.estado, 400);
});

test('editar una tarea puede cambiarle la frecuencia', async () => {
  const cambio = await pedir('PUT', `/api/tareas/${mundo.tareaSemanal}`, {
    token: mundo.admin,
    cuerpo: {
      nombre: 'Copias de seguridad',
      frecuencia: 'diaria', hora: '07:00', fecha_inicio: '2026-01-05', cada: 1,
      plantilla_titulo: 'Comprobar copias', grupo_id: mundo.informatica,
      local_id: mundo.local1, prioridad: 'normal'
    }
  });
  assert.strictEqual(cambio.estado, 200);
  assert.strictEqual(cambio.datos.frecuencia, 'diaria');
  // Al dejar de ser semanal, sus días dejan de aplicar y no se arrastran.
  assert.strictEqual(cambio.datos.dias_semana, null);
});

test('el programador no repite lo ya evaluado ni revive el pasado', async () => {
  const programador = require('../programador');
  const antes = db.prepare('SELECT COUNT(*) AS c FROM tickets').get().c;
  // La tarea se creó con `evaluada_hasta` en el momento del alta, así que un
  // repaso inmediato no tiene nada que abrir.
  programador.repasar();
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM tickets').get().c, antes);
});

test('el gestor supervisa: informes de todos y tareas programadas', async () => {
  const gestor = await crearUsuario(mundo.admin, {
    nombre: 'Ana', usuario: 'ana', password: 'incidencias1', rol: 'gestor', locales: []
  });
  mundo.ana = gestor;
  const hoy = new Date().toISOString().slice(0, 10);

  // Ve los informes de cualquier técnico, no solo los suyos.
  const informe = await pedir(
    'GET', `/api/informes?desde=${hoy}&hasta=${hoy}&tecnico_id=${mundo.jose.id}`, { token: gestor.token }
  );
  assert.strictEqual(informe.estado, 200);
  assert.strictEqual(informe.datos.tecnico, mundo.jose.id, 'no se le fija a sí mismo');

  const meta = await pedir('GET', '/api/meta', { token: gestor.token });
  assert.strictEqual(meta.datos.tecnicoFijado, null);
  assert.ok(meta.datos.tecnicosInformes.length > 1);
  assert.strictEqual(meta.datos.puedeProgramar, true);

  // Y lleva el programador de tareas.
  assert.strictEqual((await pedir('GET', '/api/tareas', { token: gestor.token })).estado, 200);
  const alta = await pedir('POST', '/api/tareas', {
    token: gestor.token,
    cuerpo: {
      nombre: 'Revisión del gestor', frecuencia: 'diaria', hora: '10:00',
      fecha_inicio: '2026-01-01', cada: 1,
      plantilla_titulo: 'Revisión', grupo_id: mundo.mantenimiento
    }
  });
  assert.strictEqual(alta.estado, 201, JSON.stringify(alta.datos));
});

test('el gestor no gestiona cuentas ni catálogos', async () => {
  for (const ruta of ['/api/usuarios']) {
    assert.strictEqual((await pedir('GET', ruta, { token: mundo.ana.token })).estado, 403);
  }
  const local = await pedir('POST', '/api/locales', {
    token: mundo.ana.token, cuerpo: { nombre: 'Local del gestor' }
  });
  assert.strictEqual(local.estado, 403);
});

test('un técnico no toca el programador de tareas', async () => {
  assert.strictEqual((await pedir('GET', '/api/tareas', { token: mundo.jose.token })).estado, 403);
  const alta = await pedir('POST', '/api/tareas', {
    token: mundo.jose.token,
    cuerpo: {
      nombre: 'No', frecuencia: 'diaria', hora: '10:00', fecha_inicio: '2026-01-01', cada: 1,
      plantilla_titulo: 'No', grupo_id: mundo.mantenimiento
    }
  });
  assert.strictEqual(alta.estado, 403);
});

test('las secciones de administración son solo para administradores', async () => {
  for (const token of [mundo.juan.token, mundo.jose.token]) {
    assert.strictEqual((await pedir('GET', '/api/usuarios', { token })).estado, 403);
    assert.strictEqual((await pedir('POST', '/api/locales', { token, cuerpo: { nombre: 'X' } })).estado, 403);
    assert.strictEqual((await pedir('POST', '/api/familias', { token, cuerpo: { nombre: 'X' } })).estado, 403);
  }
});

test('sin sesión no se llega a la API', async () => {
  assert.strictEqual((await pedir('GET', '/api/tickets')).estado, 401);
  assert.strictEqual((await pedir('GET', '/api/session')).estado, 401);
});

test('un catálogo en uso no se puede borrar', async () => {
  const borrar = await pedir('DELETE', `/api/grupos/${mundo.mantenimiento}`, { token: mundo.admin });
  assert.strictEqual(borrar.estado, 400);
  assert.match(borrar.datos.error, /incidencias/);
});

test('las áreas (Grupo) se crean, editan y borran, y cada familia es de un área', async () => {
  const alta = await pedir('POST', '/api/areas', { token: mundo.admin, cuerpo: { nombre: 'Terraza' } });
  assert.strictEqual(alta.estado, 201, JSON.stringify(alta.datos));
  const areaId = alta.datos.id;

  const repetida = await pedir('POST', '/api/areas', { token: mundo.admin, cuerpo: { nombre: 'Terraza' } });
  assert.strictEqual(repetida.estado, 400);

  const editada = await pedir('PUT', `/api/areas/${areaId}`, { token: mundo.admin, cuerpo: { nombre: 'Jardín' } });
  assert.strictEqual(editada.estado, 200);
  assert.strictEqual(editada.datos.nombre, 'Jardín');

  // La familia exige un área que exista.
  const sinArea = await pedir('POST', '/api/familias', { token: mundo.admin, cuerpo: { nombre: 'Riego' } });
  assert.strictEqual(sinArea.estado, 400);
  const areaInventada = await pedir('POST', '/api/familias', {
    token: mundo.admin, cuerpo: { nombre: 'Riego', area_id: 999999 }
  });
  assert.strictEqual(areaInventada.estado, 400);

  const familia = await pedir('POST', '/api/familias', {
    token: mundo.admin, cuerpo: { nombre: 'Riego', area_id: areaId }
  });
  assert.strictEqual(familia.estado, 201, JSON.stringify(familia.datos));
  assert.strictEqual(familia.datos.area_id, areaId);

  // Con familias dentro, el área no se puede borrar.
  const areaConHijas = await pedir('DELETE', `/api/areas/${areaId}`, { token: mundo.admin });
  assert.strictEqual(areaConHijas.estado, 400);
  assert.match(areaConHijas.datos.error, /familias/);

  assert.strictEqual((await pedir('DELETE', `/api/familias/${familia.datos.id}`, { token: mundo.admin })).estado, 200);
  assert.strictEqual((await pedir('DELETE', `/api/areas/${areaId}`, { token: mundo.admin })).estado, 200);
});

test('las familias y subfamilias se crean, editan y borran, y cada subfamilia es de una familia', async () => {
  const area = await pedir('POST', '/api/areas', { token: mundo.admin, cuerpo: { nombre: 'Almacén' } });
  const areaId = area.datos.id;

  const alta = await pedir('POST', '/api/familias', {
    token: mundo.admin, cuerpo: { nombre: 'Climatización', area_id: areaId }
  });
  assert.strictEqual(alta.estado, 201, JSON.stringify(alta.datos));
  const familiaId = alta.datos.id;

  // El nombre no se repite dentro de la misma área.
  const repetida = await pedir('POST', '/api/familias', {
    token: mundo.admin, cuerpo: { nombre: 'Climatización', area_id: areaId }
  });
  assert.strictEqual(repetida.estado, 400);

  const editada = await pedir('PUT', `/api/familias/${familiaId}`, {
    token: mundo.admin, cuerpo: { nombre: 'Clima' }
  });
  assert.strictEqual(editada.estado, 200);
  assert.strictEqual(editada.datos.nombre, 'Clima');
  assert.strictEqual(editada.datos.area_id, areaId, 'el área no cambia al editar');

  // La subfamilia exige una familia que exista.
  const sinFamilia = await pedir('POST', '/api/subfamilias', {
    token: mundo.admin, cuerpo: { nombre: 'Aire acondicionado' }
  });
  assert.strictEqual(sinFamilia.estado, 400);
  const familiaInventada = await pedir('POST', '/api/subfamilias', {
    token: mundo.admin, cuerpo: { nombre: 'Aire acondicionado', familia_id: 999999 }
  });
  assert.strictEqual(familiaInventada.estado, 400);

  const altaSub = await pedir('POST', '/api/subfamilias', {
    token: mundo.admin, cuerpo: { nombre: 'Aire acondicionado', familia_id: familiaId }
  });
  assert.strictEqual(altaSub.estado, 201, JSON.stringify(altaSub.datos));
  const subfamiliaId = altaSub.datos.id;
  assert.strictEqual(altaSub.datos.familia_id, familiaId);

  // Mismo nombre, pero en otra familia: no choca.
  const otraFamilia = await pedir('POST', '/api/familias', {
    token: mundo.admin, cuerpo: { nombre: 'Fontanería', area_id: areaId }
  });
  const enOtraFamilia = await pedir('POST', '/api/subfamilias', {
    token: mundo.admin, cuerpo: { nombre: 'Aire acondicionado', familia_id: otraFamilia.datos.id }
  });
  assert.strictEqual(enOtraFamilia.estado, 201, 'el nombre solo tiene que ser único dentro de su familia');

  const editadaSub = await pedir('PUT', `/api/subfamilias/${subfamiliaId}`, {
    token: mundo.admin, cuerpo: { nombre: 'Aire acondicionado y calefacción' }
  });
  assert.strictEqual(editadaSub.estado, 200);
  assert.strictEqual(editadaSub.datos.familia_id, familiaId, 'la familia no cambia al editar');

  // Con subfamilias dentro, la familia no se puede borrar.
  const familiaConHijas = await pedir('DELETE', `/api/familias/${familiaId}`, { token: mundo.admin });
  assert.strictEqual(familiaConHijas.estado, 400);
  assert.match(familiaConHijas.datos.error, /subfamilias/);

  assert.strictEqual((await pedir('DELETE', `/api/subfamilias/${subfamiliaId}`, { token: mundo.admin })).estado, 200);
  assert.strictEqual((await pedir('DELETE', `/api/familias/${familiaId}`, { token: mundo.admin })).estado, 200);

  // Se deja limpio para no estorbar a las pruebas que vengan detrás.
  await pedir('DELETE', `/api/subfamilias/${enOtraFamilia.datos.id}`, { token: mundo.admin });
  await pedir('DELETE', `/api/familias/${otraFamilia.datos.id}`, { token: mundo.admin });
  await pedir('DELETE', `/api/areas/${areaId}`, { token: mundo.admin });
});

test('el grupo y la familia son obligatorios para abrir una incidencia, y tienen que corresponderse', async () => {
  const area = await pedir('POST', '/api/areas', { token: mundo.admin, cuerpo: { nombre: 'Cocina de prueba' } });
  const otraArea = await pedir('POST', '/api/areas', { token: mundo.admin, cuerpo: { nombre: 'Barra de prueba' } });
  const familia = await pedir('POST', '/api/familias', {
    token: mundo.admin, cuerpo: { nombre: 'Electricidad', area_id: area.datos.id }
  });
  const otraFamilia = await pedir('POST', '/api/familias', {
    token: mundo.admin, cuerpo: { nombre: 'Cerrajería', area_id: area.datos.id }
  });
  const subfamilia = await pedir('POST', '/api/subfamilias', {
    token: mundo.admin, cuerpo: { nombre: 'Enchufes', familia_id: familia.datos.id }
  });

  // Sin grupo, no se abre.
  const sinArea = await pedir('POST', '/api/tickets', {
    token: mundo.juan.token,
    cuerpo: { titulo: 'Enchufe suelto', grupo_id: mundo.mantenimiento, local_id: mundo.local1 }
  });
  assert.strictEqual(sinArea.estado, 400);
  assert.match(sinArea.datos.error, /grupo/i);

  // Con grupo pero sin familia, tampoco.
  const sinFamilia = await pedir('POST', '/api/tickets', {
    token: mundo.juan.token,
    cuerpo: {
      titulo: 'Enchufe suelto', grupo_id: mundo.mantenimiento, local_id: mundo.local1, area_id: area.datos.id
    }
  });
  assert.strictEqual(sinFamilia.estado, 400);
  assert.match(sinFamilia.datos.error, /familia/i);

  // La familia es de otro grupo: no cuadra.
  const familiaNoCuadra = await pedir('POST', '/api/tickets', {
    token: mundo.juan.token,
    cuerpo: {
      titulo: 'Enchufe suelto', grupo_id: mundo.mantenimiento, local_id: mundo.local1,
      area_id: otraArea.datos.id, familia_id: familia.datos.id
    }
  });
  assert.strictEqual(familiaNoCuadra.estado, 400);
  assert.match(familiaNoCuadra.datos.error, /familia/i);

  // La subfamilia es de otra familia: no cuadra.
  const subNoCuadra = await pedir('POST', '/api/tickets', {
    token: mundo.juan.token,
    cuerpo: {
      titulo: 'Enchufe suelto', grupo_id: mundo.mantenimiento, local_id: mundo.local1,
      area_id: area.datos.id, familia_id: otraFamilia.datos.id, subfamilia_id: subfamilia.datos.id
    }
  });
  assert.strictEqual(subNoCuadra.estado, 400);
  assert.match(subNoCuadra.datos.error, /subfamilia/i);

  const alta = await pedir('POST', '/api/tickets', {
    token: mundo.juan.token,
    cuerpo: {
      titulo: 'Enchufe suelto', grupo_id: mundo.mantenimiento, local_id: mundo.local1,
      area_id: area.datos.id, familia_id: familia.datos.id, subfamilia_id: subfamilia.datos.id
    }
  });
  assert.strictEqual(alta.estado, 201, JSON.stringify(alta.datos));

  const ficha = await pedir('GET', `/api/tickets/${alta.datos.id}`, { token: mundo.juan.token });
  assert.strictEqual(ficha.datos.area_nombre, 'Cocina de prueba');
  assert.strictEqual(ficha.datos.familia_nombre, 'Electricidad');
  assert.strictEqual(ficha.datos.subfamilia_nombre, 'Enchufes');

  // La subfamilia sí es opcional: con área y familia, se abre igual.
  const sinSubfamilia = await pedir('POST', '/api/tickets', {
    token: mundo.juan.token,
    cuerpo: {
      titulo: 'Otra avería', grupo_id: mundo.mantenimiento, local_id: mundo.local1,
      area_id: area.datos.id, familia_id: familia.datos.id
    }
  });
  assert.strictEqual(sinSubfamilia.estado, 201);
  const fichaSinSubfamilia = await pedir('GET', `/api/tickets/${sinSubfamilia.datos.id}`, { token: mundo.juan.token });
  assert.strictEqual(fichaSinSubfamilia.datos.subfamilia_nombre, null);

  // El filtro por grupo, familia y subfamilia recorta la lista.
  const porArea = await pedir('GET', `/api/tickets?area_id=${area.datos.id}`, { token: mundo.admin });
  assert.ok(porArea.datos.some((t) => t.id === alta.datos.id));
  assert.ok(porArea.datos.some((t) => t.id === sinSubfamilia.datos.id));

  const porFamilia = await pedir('GET', `/api/tickets?familia_id=${familia.datos.id}`, { token: mundo.admin });
  assert.ok(porFamilia.datos.some((t) => t.id === alta.datos.id));
  assert.ok(porFamilia.datos.some((t) => t.id === sinSubfamilia.datos.id));

  const porSubfamilia = await pedir('GET', `/api/tickets?subfamilia_id=${subfamilia.datos.id}`, {
    token: mundo.admin
  });
  assert.deepStrictEqual(porSubfamilia.datos.map((t) => t.id), [alta.datos.id]);

  mundo.ticketConFamilia = alta.datos.id;
  mundo.areaCocinaPrueba = area.datos.id;
  mundo.familiaElectricidad = familia.datos.id;
});

test('los informes se pueden filtrar por grupo y por familia, y traen su propio reparto', async () => {
  const hoy = new Date().toISOString().slice(0, 10);
  const general = await pedir('GET', `/api/informes?desde=${hoy}&hasta=${hoy}`, { token: mundo.admin });
  const filaArea = general.datos.areas.find((a) => a.id === mundo.areaCocinaPrueba);
  const filaFamilia = general.datos.familias.find((f) => f.id === mundo.familiaElectricidad);
  assert.ok(filaArea, 'el grupo usado hoy sale en el reparto');
  assert.ok(filaFamilia, 'la familia usada hoy sale en el reparto');
  assert.ok(filaFamilia.entrados >= 1);

  const filtradoPorArea = await pedir(
    'GET', `/api/informes?desde=${hoy}&hasta=${hoy}&area_id=${mundo.areaCocinaPrueba}`,
    { token: mundo.admin }
  );
  assert.strictEqual(filtradoPorArea.datos.total.entrados, filaArea.entrados,
    'filtrar por ese grupo da el mismo número que su fila en el reparto general');

  const filtradoPorFamilia = await pedir(
    'GET', `/api/informes?desde=${hoy}&hasta=${hoy}&familia_id=${mundo.familiaElectricidad}`,
    { token: mundo.admin }
  );
  assert.strictEqual(filtradoPorFamilia.datos.total.entrados, filaFamilia.entrados,
    'filtrar por esa familia da el mismo número que su fila en el reparto general');
});

test('el dispositivo se registra y se reasigna al usuario que entra', async () => {
  const alta = await pedir('POST', '/api/dispositivos', {
    token: mundo.juan.token, cuerpo: { token_push: 'fcm-abc', plataforma: 'android' }
  });
  assert.strictEqual(alta.estado, 201);

  // El mismo aparato, ahora con la sesión de otra persona.
  await pedir('POST', '/api/dispositivos', {
    token: mundo.maria.token, cuerpo: { token_push: 'fcm-abc', plataforma: 'android' }
  });
  const filas = db.prepare('SELECT usuario_id FROM dispositivos WHERE token_push = ?').all('fcm-abc');
  assert.strictEqual(filas.length, 1, 'el token no se duplica');
  assert.strictEqual(filas[0].usuario_id, mundo.maria.id);
});

test('los destinatarios de cada aviso son los que dice la especificación', () => {
  const notificaciones = require('../notificaciones');
  const ticketMantenimiento = { grupo_id: mundo.mantenimiento, local_id: mundo.local1 };
  const tecnicos = notificaciones.tecnicosDe(ticketMantenimiento);
  assert.deepStrictEqual(tecnicos.sort(), [mundo.jose.id, mundo.antonio.id].sort(),
    'José y Antonio cubren LOCAL 1; Santiago es de Informática');

  // Santiago no tiene locales, así que le toca cualquier local de su grupo.
  const ticketInformatica = { grupo_id: mundo.informatica, local_id: mundo.local3 };
  assert.deepStrictEqual(notificaciones.tecnicosDe(ticketInformatica), [mundo.santiago.id]);
});

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

test('la incidencia no se crea hasta que el adjunto ha subido entero', async () => {
  // Primero el archivo, cuando todavía no hay incidencia ninguna.
  const borrador = await pedir('POST', '/api/adjuntos/borrador?nombre=averia.png', {
    token: mundo.juan.token, crudo: PNG, tipo: 'image/png'
  });
  assert.strictEqual(borrador.estado, 201, JSON.stringify(borrador.datos));
  assert.strictEqual(borrador.datos.tipo, 'imagen');

  // Y solo entonces la incidencia, que se queda con él.
  const alta = await pedir('POST', '/api/tickets', {
    token: mundo.juan.token,
    cuerpo: {
      titulo: 'Gotera en el techo',
      descripcion: 'Cae agua sobre la barra.',
      grupo_id: mundo.mantenimiento,
      local_id: mundo.local1,
      area_id: mundo.areaDefault, familia_id: mundo.familiaDefault,
      adjuntos: [borrador.datos.id]
    }
  });
  assert.strictEqual(alta.estado, 201, JSON.stringify(alta.datos));

  const ficha = await pedir('GET', `/api/tickets/${alta.datos.id}`, { token: mundo.juan.token });

  // La descripción y la foto son el primer mensaje del hilo, no una ficha aparte.
  assert.strictEqual(ficha.datos.mensajes_hilo.length, 1);
  const apertura = ficha.datos.mensajes_hilo[0];
  assert.strictEqual(apertura.contenido, 'Cae agua sobre la barra.');
  assert.strictEqual(apertura.apertura, 1, 'queda marcado como el mensaje que la abre');

  assert.strictEqual(ficha.datos.adjuntos_lista.length, 1);
  assert.strictEqual(ficha.datos.adjuntos_lista[0].mensaje_id, apertura.id,
    'la foto cuelga del mensaje, no suelta de la incidencia');

  // El borrador ya no está: se ha movido, no copiado.
  const quedan = db.prepare('SELECT COUNT(*) AS n FROM adjuntos_borrador').get().n;
  assert.strictEqual(quedan, 0);

  mundo.ticketGotera = alta.datos.id;
});

test('el borrador de otro no se puede colar en una incidencia propia', async () => {
  const ajeno = await pedir('POST', '/api/adjuntos/borrador?nombre=suyo.png', {
    token: mundo.maria.token, crudo: PNG, tipo: 'image/png'
  });
  assert.strictEqual(ajeno.estado, 201);

  const alta = await pedir('POST', '/api/tickets', {
    token: mundo.juan.token,
    cuerpo: {
      titulo: 'Intento con adjunto ajeno',
      grupo_id: mundo.mantenimiento,
      local_id: mundo.local1,
      area_id: mundo.areaDefault, familia_id: mundo.familiaDefault,
      adjuntos: [ajeno.datos.id]
    }
  });
  assert.strictEqual(alta.estado, 201);

  const ficha = await pedir('GET', `/api/tickets/${alta.datos.id}`, { token: mundo.juan.token });
  assert.strictEqual(ficha.datos.adjuntos_lista.length, 0, 'se ignora en silencio');
});

test('un mensaje puede ser solo una foto, y la foto va dentro del mensaje', async () => {
  const borrador = await pedir('POST', '/api/adjuntos/borrador?nombre=detalle.png', {
    token: mundo.jose.token, crudo: PNG, tipo: 'image/png'
  });
  const enviado = await pedir('POST', `/api/tickets/${mundo.ticketGotera}/mensajes`, {
    token: mundo.jose.token, cuerpo: { contenido: '', adjuntos: [borrador.datos.id] }
  });
  assert.strictEqual(enviado.estado, 201, JSON.stringify(enviado.datos));

  const ficha = await pedir('GET', `/api/tickets/${mundo.ticketGotera}`, { token: mundo.juan.token });
  const suyo = ficha.datos.adjuntos_lista.find((a) => a.nombre === 'detalle.png');
  assert.ok(suyo, 'el adjunto está');
  assert.strictEqual(suyo.mensaje_id, enviado.datos.id, 'y cuelga de ese mensaje');
});

test('cada lado ve si le toca contestar o está esperando', async () => {
  // Lo último lo escribió José, que es técnico.
  const paraJuan = await pedir('GET', `/api/tickets/${mundo.ticketGotera}`, {
    token: mundo.juan.token
  });
  assert.strictEqual(paraJuan.datos.respuesta, 'respondido',
    'para el empleado, el técnico ya ha contestado');
  assert.strictEqual(paraJuan.datos.mensajes_tecnico > 0, true);

  const paraJose = await pedir('GET', `/api/tickets/${mundo.ticketGotera}`, {
    token: mundo.jose.token
  });
  assert.strictEqual(paraJose.datos.respuesta, 'esperando',
    'para el técnico, la pelota está en el otro tejado');

  // Contesta el empleado y se da la vuelta.
  await pedir('POST', `/api/tickets/${mundo.ticketGotera}/mensajes`, {
    token: mundo.juan.token, cuerpo: { contenido: 'Sigue cayendo.' }
  });
  const despues = await pedir('GET', `/api/tickets/${mundo.ticketGotera}`, {
    token: mundo.jose.token
  });
  assert.strictEqual(despues.datos.respuesta, 'respondido');
});

test('lo que nadie ha contestado se marca «nuevo», no «respondido»', async () => {
  // Recién abierta por un empleado, el técnico no ha dicho nada todavía: decir
  // «respondido» ahí sería mentira, porque nadie le ha respondido a nada.
  const alta = await pedir('POST', '/api/tickets', {
    token: mundo.juan.token,
    cuerpo: {
      titulo: 'Sin contestar aún',
      descripcion: 'A ver quién la coge.',
      grupo_id: mundo.mantenimiento,
      local_id: mundo.local1,
      area_id: mundo.areaDefault, familia_id: mundo.familiaDefault
    }
  });

  const paraElTecnico = await pedir('GET', `/api/tickets/${alta.datos.id}`, {
    token: mundo.jose.token
  });
  assert.strictEqual(paraElTecnico.datos.respuesta, 'nuevo');

  const paraQuienLaAbrio = await pedir('GET', `/api/tickets/${alta.datos.id}`, {
    token: mundo.juan.token
  });
  assert.strictEqual(paraQuienLaAbrio.datos.respuesta, 'esperando');

  // En cuanto el técnico escribe, ya sí hay conversación en los dos sentidos.
  await pedir('POST', `/api/tickets/${alta.datos.id}/mensajes`, {
    token: mundo.jose.token, cuerpo: { contenido: 'La cojo yo.' }
  });
  const despues = await pedir('GET', `/api/tickets/${alta.datos.id}`, {
    token: mundo.juan.token
  });
  assert.strictEqual(despues.datos.respuesta, 'respondido');
});

test('el rol «usuario» —el de las cuentas nuevas— cuenta como quien reporta, no como técnico', async () => {
  // «usuario» es el rol por defecto de las cuentas nuevas (ver «el rol usuario
  // solo ve lo que ha abierto él», más abajo), así que casi todo el mundo que
  // abre una incidencia tiene este rol, no «empleado». Antes sus mensajes se
  // contaban como si fueran de un técnico y la incidencia salía «esperando»
  // para el técnico nada más abrirla, en vez de «nuevo»; y al contestar,
  // seguía en «esperando» en vez de pasar a «respondido».
  const pedro = await crearUsuario(mundo.admin, {
    nombre: 'Pedro', usuario: 'pedro', password: 'incidencias1', rol: 'usuario',
    locales: [mundo.local1]
  });

  const alta = await pedir('POST', '/api/tickets', {
    token: pedro.token,
    cuerpo: {
      titulo: 'Enchufe suelto',
      descripcion: 'Se mueve al tocarlo.',
      grupo_id: mundo.mantenimiento,
      local_id: mundo.local1,
      area_id: mundo.areaDefault, familia_id: mundo.familiaDefault
    }
  });
  assert.strictEqual(alta.estado, 201, JSON.stringify(alta.datos));
  const id = alta.datos.id;

  assert.strictEqual(
    (await pedir('GET', `/api/tickets/${id}`, { token: mundo.jose.token })).datos.respuesta,
    'nuevo'
  );
  assert.strictEqual(
    (await pedir('GET', `/api/tickets/${id}`, { token: pedro.token })).datos.respuesta,
    'esperando'
  );

  // Contesta el técnico: para Pedro pasa a «respondido», para el técnico a «esperando».
  await pedir('POST', `/api/tickets/${id}/mensajes`, {
    token: mundo.jose.token, cuerpo: { contenido: 'Voy a revisarlo.' }
  });
  assert.strictEqual(
    (await pedir('GET', `/api/tickets/${id}`, { token: pedro.token })).datos.respuesta,
    'respondido'
  );
  assert.strictEqual(
    (await pedir('GET', `/api/tickets/${id}`, { token: mundo.jose.token })).datos.respuesta,
    'esperando'
  );

  // Pedro vuelve a escribir: la pelota vuelve al tejado del técnico.
  await pedir('POST', `/api/tickets/${id}/mensajes`, {
    token: pedro.token, cuerpo: { contenido: 'Gracias, sigue igual.' }
  });
  assert.strictEqual(
    (await pedir('GET', `/api/tickets/${id}`, { token: mundo.jose.token })).datos.respuesta,
    'respondido'
  );
});

test('una incidencia cerrada no espera respuesta de nadie', async () => {
  await pedir('PUT', `/api/tickets/${mundo.ticketGotera}`, {
    token: mundo.jose.token, cuerpo: { estado: 'cerrado' }
  });
  const ficha = await pedir('GET', `/api/tickets/${mundo.ticketGotera}`, {
    token: mundo.juan.token
  });
  assert.strictEqual(ficha.datos.respuesta, null);

  // Se deja abierta otra vez para no estorbar a las pruebas que vengan detrás.
  await pedir('PUT', `/api/tickets/${mundo.ticketGotera}`, {
    token: mundo.jose.token, cuerpo: { estado: 'abierto' }
  });
});

test('solo un administrador puede eliminar una incidencia, y se lleva el hilo y los adjuntos', async () => {
  const borrador = await pedir('POST', '/api/adjuntos/borrador?nombre=aviso.png', {
    token: mundo.juan.token, crudo: PNG, tipo: 'image/png'
  });
  const alta = await pedir('POST', '/api/tickets', {
    token: mundo.juan.token,
    cuerpo: {
      titulo: 'Para borrar',
      descripcion: 'Esta se elimina en la prueba.',
      grupo_id: mundo.mantenimiento,
      local_id: mundo.local1,
      area_id: mundo.areaDefault, familia_id: mundo.familiaDefault,
      adjuntos: [borrador.datos.id]
    }
  });
  assert.strictEqual(alta.estado, 201, JSON.stringify(alta.datos));
  const id = alta.datos.id;

  await pedir('POST', `/api/tickets/${id}/mensajes`, {
    token: mundo.jose.token, cuerpo: { contenido: 'Me lo apunto.' }
  });

  const carpeta = path.join(db.carpetaDatos, 'adjuntos', String(id));
  assert.strictEqual(fs.existsSync(carpeta), true, 'el adjunto ha quedado en disco');

  // Ni el empleado que la abrió ni el técnico que la gestiona pueden borrarla.
  const negadoEmpleado = await pedir('DELETE', `/api/tickets/${id}`, { token: mundo.juan.token });
  assert.strictEqual(negadoEmpleado.estado, 403);
  const negadoTecnico = await pedir('DELETE', `/api/tickets/${id}`, { token: mundo.jose.token });
  assert.strictEqual(negadoTecnico.estado, 403);

  const borrado = await pedir('DELETE', `/api/tickets/${id}`, { token: mundo.admin });
  assert.strictEqual(borrado.estado, 200);

  const ficha = await pedir('GET', `/api/tickets/${id}`, { token: mundo.admin });
  assert.strictEqual(ficha.estado, 404, 'no queda ni rastro de la incidencia');

  assert.strictEqual(
    db.prepare('SELECT COUNT(*) AS n FROM mensajes WHERE ticket_id = ?').get(id).n, 0,
    'el hilo se borra con ella'
  );
  assert.strictEqual(
    db.prepare('SELECT COUNT(*) AS n FROM adjuntos WHERE ticket_id = ?').get(id).n, 0,
    'los adjuntos también'
  );
  assert.strictEqual(fs.existsSync(carpeta), false, 'y el archivo desaparece del disco');
});

test('el desplegable de los informes solo ofrece a quien cubre ese local', async () => {
  // Santiago es de Informática; José y Antonio, de Mantenimiento.
  const informatica = await pedir('GET',
    `/api/informes?desde=2020-01-01&hasta=2030-12-31&grupo_id=${mundo.informatica}`,
    { token: mundo.admin });
  const idsInformatica = informatica.datos.tecnicos.map((t) => t.id);
  assert.ok(idsInformatica.includes(mundo.santiago.id));
  assert.ok(!idsInformatica.includes(mundo.jose.id),
    'un técnico de Mantenimiento no sale al filtrar por Informática');

  // José solo cubre LOCAL 1; Antonio, LOCAL 1 y LOCAL 2.
  const local2 = await pedir('GET',
    `/api/informes?desde=2020-01-01&hasta=2030-12-31&grupo_id=${mundo.mantenimiento}&local_id=${mundo.local2}`,
    { token: mundo.admin });
  const idsLocal2 = local2.datos.tecnicos.map((t) => t.id);
  assert.ok(idsLocal2.includes(mundo.antonio.id));
  assert.ok(!idsLocal2.includes(mundo.jose.id), 'José no atiende LOCAL 2');
});

test('el rol usuario solo ve lo que ha abierto él', async () => {
  // Por defecto: sin rol ni locales, sale «usuario» en OFICINA.
  const alta = await pedir('POST', '/api/usuarios', {
    token: mundo.admin,
    cuerpo: { nombre: 'Rosa', email: 'rosa@ejemplo.test', password: 'incidencias1' }
  });
  assert.strictEqual(alta.estado, 201, JSON.stringify(alta.datos));
  assert.strictEqual(alta.datos.rol, 'usuario', 'es el rol de las cuentas nuevas');
  assert.deepStrictEqual(alta.datos.locales.map((l) => l.nombre), ['OFICINA']);

  const rosa = { id: alta.datos.id, token: await entrar('rosa@ejemplo.test', 'incidencias1') };
  const localPorDefecto = alta.datos.locales[0].id;

  // Otra persona del mismo local abre una incidencia.
  const otra = await crearUsuario(mundo.admin, {
    nombre: 'Pablo', usuario: 'pablo', password: 'incidencias1', rol: 'empleado',
    locales: [localPorDefecto]
  });
  const dePablo = await pedir('POST', '/api/tickets', {
    token: otra.token,
    cuerpo: { titulo: 'De Pablo', grupo_id: mundo.mantenimiento, local_id: localPorDefecto, area_id: mundo.areaDefault, familia_id: mundo.familiaDefault }
  });
  assert.strictEqual(dePablo.estado, 201);

  const deRosa = await pedir('POST', '/api/tickets', {
    token: rosa.token,
    cuerpo: { titulo: 'De Rosa', grupo_id: mundo.mantenimiento, local_id: localPorDefecto, area_id: mundo.areaDefault, familia_id: mundo.familiaDefault }
  });
  assert.strictEqual(deRosa.estado, 201, 'un usuario puede abrir incidencias');

  const suyas = (await pedir('GET', '/api/tickets', { token: rosa.token })).datos;
  assert.deepStrictEqual(suyas.map((t) => t.id), [deRosa.datos.id],
    'solo la suya, aunque comparta local con Pablo');

  // Y la de su compañero responde 404, no 403.
  const ajena = await pedir('GET', `/api/tickets/${dePablo.datos.id}`, { token: rosa.token });
  assert.strictEqual(ajena.estado, 404);

  // Tampoco gestiona ni ve informes.
  const gestion = await pedir('PUT', `/api/tickets/${deRosa.datos.id}`, {
    token: rosa.token, cuerpo: { estado: 'cerrado' }
  });
  assert.strictEqual(gestion.estado, 403, 'no cambia el estado ni de las suyas');
  const informes = await pedir('GET', '/api/informes?desde=2020-01-01&hasta=2030-12-31', {
    token: rosa.token
  });
  assert.strictEqual(informes.estado, 403);
});

test('el correo es el nombre de acceso', async () => {
  const alta = await pedir('POST', '/api/usuarios', {
    token: mundo.admin,
    cuerpo: { nombre: 'Nuria', email: 'Nuria@Ejemplo.TEST', password: 'incidencias1' }
  });
  assert.strictEqual(alta.estado, 201);
  assert.strictEqual(alta.datos.usuario, 'nuria@ejemplo.test', 'en minúsculas y como acceso');

  // Y con él se entra.
  await entrar('nuria@ejemplo.test', 'incidencias1');

  // Dos cuentas con el mismo correo, no.
  const repetido = await pedir('POST', '/api/usuarios', {
    token: mundo.admin,
    cuerpo: { nombre: 'Otra', email: 'nuria@ejemplo.test', password: 'incidencias1' }
  });
  assert.strictEqual(repetido.estado, 400);
  assert.match(repetido.datos.error, /correo/);

  // Un correo mal escrito tampoco.
  const malo = await pedir('POST', '/api/usuarios', {
    token: mundo.admin,
    cuerpo: { nombre: 'Mala', email: 'esto no es un correo', password: 'incidencias1' }
  });
  assert.strictEqual(malo.estado, 400);
});

test('un técnico abre una incidencia en nombre de otra persona', async () => {
  const alta = await pedir('POST', '/api/tickets', {
    token: mundo.jose.token,
    cuerpo: {
      titulo: 'Me lo ha dicho Juan de palabra',
      descripcion: 'La cámara del pasillo no enfría.',
      grupo_id: mundo.mantenimiento,
      local_id: mundo.local1,
      area_id: mundo.areaDefault, familia_id: mundo.familiaDefault,
      en_nombre_de: mundo.juan.id
    }
  });
  assert.strictEqual(alta.estado, 201, JSON.stringify(alta.datos));
  assert.strictEqual(alta.datos.creado_por, mundo.juan.id, 'la incidencia es de Juan');

  // Y el mensaje de apertura también, para que el hilo tenga sentido.
  const ficha = await pedir('GET', `/api/tickets/${alta.datos.id}`, { token: mundo.juan.token });
  assert.strictEqual(ficha.datos.mensajes_hilo[0].autor_id, mundo.juan.id);

  // A nombre de alguien que no puede ver ese local, no.
  const imposible = await pedir('POST', '/api/tickets', {
    token: mundo.jose.token,
    cuerpo: {
      titulo: 'A nombre de quien no toca',
      grupo_id: mundo.mantenimiento, local_id: mundo.local1, area_id: mundo.areaDefault, familia_id: mundo.familiaDefault,
      en_nombre_de: mundo.lucia.id
    }
  });
  assert.strictEqual(imposible.estado, 400);
  assert.match(imposible.datos.error, /acceso a ese local/);

  // Y un empleado no puede abrir a nombre de nadie.
  const sinPermiso = await pedir('POST', '/api/tickets', {
    token: mundo.juan.token,
    cuerpo: {
      titulo: 'Intento', grupo_id: mundo.mantenimiento, local_id: mundo.local1, area_id: mundo.areaDefault, familia_id: mundo.familiaDefault,
      en_nombre_de: mundo.maria.id
    }
  });
  assert.strictEqual(sinPermiso.estado, 403);
});

test('restablecer la contraseña con el vale del correo', async () => {
  const auth = require('../auth');

  // No se filtra si la cuenta existe o no: la respuesta es la misma.
  const inventada = await pedir('POST', '/api/recuperar', {
    cuerpo: { usuario: 'nadie@ejemplo.test' }
  });
  assert.strictEqual(inventada.estado, 200);
  const real = await pedir('POST', '/api/recuperar', { cuerpo: { usuario: mundo.maria.email } });
  assert.deepStrictEqual(real.datos, inventada.datos);

  // El vale no se guarda en claro: en la base solo está su resumen.
  const vale = auth.crearVale(mundo.maria.id);
  const enClaro = db.prepare('SELECT 1 FROM restablecimientos WHERE vale_hash = ?').get(vale);
  assert.strictEqual(enClaro, undefined, 'lo guardado no es el vale');

  assert.strictEqual((await pedir('GET', `/api/restablecer?vale=${vale}`)).datos.valido, true);

  // Contraseña corta, no.
  const corta = await pedir('POST', '/api/restablecer', {
    cuerpo: { vale, password: 'corta' }
  });
  assert.strictEqual(corta.estado, 400);

  const cambio = await pedir('POST', '/api/restablecer', {
    cuerpo: { vale, password: 'incidencias2' }
  });
  assert.strictEqual(cambio.estado, 200);

  // Ya no vale una segunda vez.
  const repetido = await pedir('POST', '/api/restablecer', {
    cuerpo: { vale, password: 'incidencias3' }
  });
  assert.strictEqual(repetido.estado, 400);

  // Se entra con la nueva, y las sesiones anteriores se han cerrado.
  mundo.maria.token = await entrar(mundo.maria.email, 'incidencias2');
});

test('el login dice ya si el usuario puede abrir incidencias', async () => {
  // La app se queda con lo que devuelve el login y de ahí decide si enseña el
  // botón de nueva incidencia. Si esto faltara, el botón no saldría hasta el
  // siguiente arranque, que es cuando se pregunta por /api/session.
  const entrada = await pedir('POST', '/api/login', {
    cuerpo: { usuario: mundo.juan.email, password: 'incidencias1' }
  });
  assert.strictEqual(entrada.estado, 200);
  assert.strictEqual(entrada.datos.puedeCrear, true);
  assert.ok(entrada.datos.token, 'y el token para la cabecera Authorization');

  // Lo mismo que responde /api/session con esa sesión ya iniciada.
  const sesion = await pedir('GET', '/api/session', { token: entrada.datos.token });
  assert.strictEqual(sesion.datos.puedeCrear, entrada.datos.puedeCrear);
});

test('el aviso que se manda a Firebase lleva lo que necesita un móvil apagado', () => {
  const notificaciones = require('../notificaciones');
  const mensaje = notificaciones.mensajeFCM('fcm-abc', {
    titulo: 'Nueva incidencia en LOCAL 1',
    cuerpo: 'No arranca el datáfono',
    datos: { ticket_id: 7, tipo: 'ticket_creado' }
  });

  // Con `notification` el aviso lo pinta el sistema aunque la app esté cerrada:
  // sin esta parte solo llegaría con la aplicación viva.
  assert.strictEqual(mensaje.notification.title, 'Nueva incidencia en LOCAL 1');
  assert.strictEqual(mensaje.android.priority, 'high');

  // El canal tiene que coincidir con el que crea la app; si no, Android 8 y
  // posteriores se tragan la notificación sin mostrarla.
  assert.strictEqual(mensaje.android.notification.channel_id, notificaciones.CANAL);

  // FCM solo admite cadenas en `data`, y de ahí saca la app la incidencia que
  // debe abrir al pulsar el aviso.
  assert.deepStrictEqual(mensaje.data, { ticket_id: '7', tipo: 'ticket_creado' });

  // La parte de iPhone viaja desde ya, para que la app de iOS no obligue a
  // tocar el servidor.
  assert.strictEqual(mensaje.apns.headers['apns-priority'], '10');
});

test('el inventario: activos con foto y su historial de incidencias', async () => {
  // El técnico da de alta un activo de su departamento.
  const activo = await pedir('POST', '/api/activos', {
    token: mundo.jose.token,
    cuerpo: {
      nombre: 'Horno industrial', descripcion: 'Horno de la cocina',
      estado: 'en_uso', local_id: mundo.local1, grupo_id: mundo.mantenimiento
    }
  });
  assert.strictEqual(activo.estado, 201, JSON.stringify(activo.datos));
  const activoId = activo.datos.id;
  assert.strictEqual(activo.datos.local_nombre, 'LOCAL 1');
  assert.strictEqual(activo.datos.grupo_nombre, 'Mantenimiento');

  // Solo quien gestiona incidencias tiene acceso: el empleado, no.
  assert.strictEqual((await pedir('GET', '/api/activos', { token: mundo.juan.token })).estado, 403);
  assert.strictEqual((await pedir('POST', '/api/activos', {
    token: mundo.juan.token,
    cuerpo: { nombre: 'x', local_id: mundo.local1, grupo_id: mundo.mantenimiento }
  })).estado, 403);

  const sinNombre = await pedir('POST', '/api/activos', {
    token: mundo.admin, cuerpo: { local_id: mundo.local1, grupo_id: mundo.mantenimiento }
  });
  assert.strictEqual(sinNombre.estado, 400);

  const estadoInvalido = await pedir('POST', '/api/activos', {
    token: mundo.admin,
    cuerpo: { nombre: 'x', estado: 'perdido', local_id: mundo.local1, grupo_id: mundo.mantenimiento }
  });
  assert.strictEqual(estadoInvalido.estado, 400);

  // Filtros de la lista.
  const porGrupo = await pedir('GET', `/api/activos?grupo_id=${mundo.mantenimiento}`, { token: mundo.admin });
  assert.ok(porGrupo.datos.some((a) => a.id === activoId));
  const porOtroGrupo = await pedir('GET', `/api/activos?grupo_id=${mundo.informatica}`, { token: mundo.admin });
  assert.ok(!porOtroGrupo.datos.some((a) => a.id === activoId));
  const porTexto = await pedir('GET', '/api/activos?q=horno', { token: mundo.admin });
  assert.ok(porTexto.datos.some((a) => a.id === activoId));

  // Sin incidencias todavía: el historial se calcula al vuelo, no se guarda.
  const fichaVacia = await pedir('GET', `/api/activos/${activoId}`, { token: mundo.admin });
  assert.strictEqual(fichaVacia.datos.incidencias.length, 0);

  // El desplegable de abrir incidencia lo ofrece a cualquiera, aunque el
  // inventario en sí sea cosa de quien gestiona.
  const metaJuan = await pedir('GET', '/api/meta', { token: mundo.juan.token });
  assert.ok(metaJuan.datos.activos.some((a) => a.id === activoId));
  assert.strictEqual(metaJuan.datos.puedeUsarInventario, false);
  const metaJose = await pedir('GET', '/api/meta', { token: mundo.jose.token });
  assert.strictEqual(metaJose.datos.puedeUsarInventario, true);

  // Abrir una incidencia señalando el activo, en su propio departamento.
  const ticket = await pedir('POST', '/api/tickets', {
    token: mundo.juan.token,
    cuerpo: {
      titulo: 'El horno no calienta', grupo_id: mundo.mantenimiento, local_id: mundo.local1,
      area_id: mundo.areaDefault, familia_id: mundo.familiaDefault, activo_id: activoId
    }
  });
  assert.strictEqual(ticket.estado, 201, JSON.stringify(ticket.datos));
  assert.strictEqual(ticket.datos.activo_nombre, 'Horno industrial');

  const activoInexistente = await pedir('POST', '/api/tickets', {
    token: mundo.juan.token,
    cuerpo: {
      titulo: 'x', grupo_id: mundo.mantenimiento, local_id: mundo.local1,
      area_id: mundo.areaDefault, familia_id: mundo.familiaDefault, activo_id: 999999
    }
  });
  assert.strictEqual(activoInexistente.estado, 400);

  // El activo es de otro departamento: no se puede señalar en esta incidencia.
  const otroActivo = await pedir('POST', '/api/activos', {
    token: mundo.admin,
    cuerpo: { nombre: 'Router', local_id: mundo.local1, grupo_id: mundo.informatica }
  });
  const departamentoEquivocado = await pedir('POST', '/api/tickets', {
    token: mundo.juan.token,
    cuerpo: {
      titulo: 'y', grupo_id: mundo.mantenimiento, local_id: mundo.local1,
      area_id: mundo.areaDefault, familia_id: mundo.familiaDefault, activo_id: otroActivo.datos.id
    }
  });
  assert.strictEqual(departamentoEquivocado.estado, 400);

  // El activo es del departamento correcto pero de otro local: tampoco vale.
  const activoDeOtroLocal = await pedir('POST', '/api/activos', {
    token: mundo.admin,
    cuerpo: { nombre: 'Horno del LOCAL 2', local_id: mundo.local2, grupo_id: mundo.mantenimiento }
  });
  const localEquivocado = await pedir('POST', '/api/tickets', {
    token: mundo.juan.token,
    cuerpo: {
      titulo: 'z', grupo_id: mundo.mantenimiento, local_id: mundo.local1,
      area_id: mundo.areaDefault, familia_id: mundo.familiaDefault, activo_id: activoDeOtroLocal.datos.id
    }
  });
  assert.strictEqual(localEquivocado.estado, 400);

  // El historial recoge la incidencia sola con solo señalarla: no hace falta
  // guardar nada aparte.
  const fichaConIncidencia = await pedir('GET', `/api/activos/${activoId}`, { token: mundo.admin });
  assert.strictEqual(fichaConIncidencia.datos.incidencias.length, 1);
  assert.strictEqual(fichaConIncidencia.datos.incidencias[0].id, ticket.datos.id);
  assert.strictEqual(fichaConIncidencia.datos.incidencias[0].titulo, 'El horno no calienta');

  // No se puede eliminar mientras tenga incidencias.
  const conIncidencias = await pedir('DELETE', `/api/activos/${activoId}`, { token: mundo.admin });
  assert.strictEqual(conIncidencias.estado, 400);

  // La foto: formato no admitido primero, luego una subida buena.
  const fotoMala = await pedir('POST', `/api/activos/${activoId}/foto?nombre=doc.pdf`, {
    token: mundo.admin, crudo: PNG, tipo: 'application/pdf'
  });
  assert.strictEqual(fotoMala.estado, 400);

  const fotoSubida = await pedir('POST', `/api/activos/${activoId}/foto?nombre=foto.png`, {
    token: mundo.admin, crudo: PNG, tipo: 'image/png'
  });
  assert.strictEqual(fotoSubida.estado, 201, JSON.stringify(fotoSubida.datos));
  assert.ok(fotoSubida.datos.foto);

  const descarga = await fetch(`${base}/api/activos/${activoId}/foto`, {
    headers: { Authorization: `Bearer ${mundo.admin}` }
  });
  assert.strictEqual(descarga.status, 200);
  assert.strictEqual(descarga.headers.get('content-type'), 'image/png');

  // El empleado no gestiona el inventario, así que tampoco ve su foto.
  const descargaEmpleado = await fetch(`${base}/api/activos/${activoId}/foto`, {
    headers: { Authorization: `Bearer ${mundo.juan.token}` }
  });
  assert.strictEqual(descargaEmpleado.status, 403);

  const sinFoto = await pedir('DELETE', `/api/activos/${activoId}/foto`, { token: mundo.admin });
  assert.strictEqual(sinFoto.estado, 200);
  assert.strictEqual(sinFoto.datos.foto, null);

  const editado = await pedir('PUT', `/api/activos/${activoId}`, {
    token: mundo.admin,
    cuerpo: { nombre: 'Horno industrial', estado: 'roto', local_id: mundo.local1, grupo_id: mundo.mantenimiento }
  });
  assert.strictEqual(editado.estado, 200);
  assert.strictEqual(editado.datos.estado, 'roto');

  assert.strictEqual((await pedir('GET', '/api/activos/999999', { token: mundo.admin })).estado, 404);
});

test('el acceso se frena tras varios intentos fallidos', async () => {
  for (let i = 0; i < 2; i += 1) {
    const fallo = await pedir('POST', '/api/login', { cuerpo: { usuario: mundo.juan.email, password: 'mal' } });
    assert.strictEqual(fallo.estado, 401);
  }
  const tercero = await pedir('POST', '/api/login', { cuerpo: { usuario: mundo.juan.email, password: 'mal' } });
  assert.strictEqual(tercero.estado, 429, 'al tercer intento toca esperar');
  assert.ok(tercero.datos.espera > 0);
});

// ---------- Entrar con Office 365 ----------

// La ida y la vuelta contra Microsoft no se pueden probar desde aquí; sí todo
// lo demás: que sin configurar no estorba, y qué cuenta sale de un
// identificador ya comprobado, que es donde se decide el rol y el local.

test('sin configurar, la pantalla de acceso no enseña el botón de Office 365', async () => {
  const estado = await pedir('GET', '/api/entra/estado');
  assert.strictEqual(estado.estado, 200);
  assert.strictEqual(estado.datos.activo, false);
});

test('sin configurar, la entrada con Office 365 devuelve a la pantalla de acceso', async () => {
  const res = await fetch(`${base}/api/entra/entrar`, { redirect: 'manual' });
  assert.strictEqual(res.status, 302);
  assert.ok(res.headers.get('location').startsWith('/login.html?error='));
});

test('una vuelta inventada no crea sesión', async () => {
  const res = await fetch(`${base}/api/entra/vuelta?code=x&state=inventado`, { redirect: 'manual' });
  assert.strictEqual(res.status, 302);
  assert.ok(res.headers.get('location').startsWith('/login.html?error='));
  assert.ok(!(res.headers.get('set-cookie') || '').includes('incidencias_sesion='));
});

test('quien entra con Office 365 por primera vez sale con rol usuario y OFICINA', () => {
  const cuenta = entra.cuentaDe({
    oid: 'oid-de-lucia',
    preferred_username: 'Lucia@ejemplo.com',
    name: 'Lucía Ramos'
  });
  assert.strictEqual(cuenta.rol, 'usuario');
  assert.strictEqual(cuenta.email, 'lucia@ejemplo.com');
  // El correo es el nombre de acceso, aquí también.
  assert.strictEqual(cuenta.usuario, 'lucia@ejemplo.com');
  assert.strictEqual(cuenta.nombre, 'Lucía Ramos');
  assert.strictEqual(cuenta.grupo_id, null);

  const locales = db.prepare(`
    SELECT l.nombre FROM usuario_local ul JOIN locales l ON l.id = ul.local_id
    WHERE ul.usuario_id = ?
  `).all(cuenta.id).map((l) => l.nombre);
  assert.deepStrictEqual(locales, ['OFICINA']);

  // La segunda vez es la misma cuenta, no otra.
  const otraVez = entra.cuentaDe({ oid: 'oid-de-lucia', preferred_username: 'lucia@ejemplo.com' });
  assert.strictEqual(otraVez.id, cuenta.id);
});

test('lo que cambie el administrador manda sobre lo que traiga Microsoft', async () => {
  const cuenta = entra.cuentaDe({ oid: 'oid-de-mario', preferred_username: 'mario@ejemplo.com' });
  const ascendido = await pedir('PUT', `/api/usuarios/${cuenta.id}`, {
    token: mundo.admin,
    cuerpo: {
      nombre: 'Mario', rol: 'tecnico', email: 'mario@ejemplo.com',
      grupo_id: mundo.informatica, locales: [mundo.local1]
    }
  });
  assert.strictEqual(ascendido.estado, 200, JSON.stringify(ascendido.datos));

  const vuelve = entra.cuentaDe({ oid: 'oid-de-mario', preferred_username: 'mario@ejemplo.com' });
  assert.strictEqual(vuelve.rol, 'tecnico', 'entrar otra vez no le devuelve el rol de partida');
});

test('Office 365 entra en la cuenta que ya existía con ese correo', async () => {
  const antes = await crearUsuario(mundo.admin, {
    usuario: 'sonia', nombre: 'Sonia', rol: 'empleado',
    password: 'sonia1234', locales: [mundo.local1]
  });
  const cuenta = entra.cuentaDe({ oid: 'oid-de-sonia', preferred_username: antes.email });
  assert.strictEqual(cuenta.id, antes.id, 'no se duplica la cuenta');
  assert.strictEqual(cuenta.rol, 'empleado');
  assert.strictEqual(cuenta.entra_oid, 'oid-de-sonia');
});

test('una cuenta bloqueada tampoco entra por Office 365', () => {
  const cuenta = entra.cuentaDe({ oid: 'oid-de-hugo', preferred_username: 'hugo@ejemplo.com' });
  db.prepare('UPDATE usuarios SET bloqueada = 1 WHERE id = ?').run(cuenta.id);
  assert.throws(
    () => entra.cuentaDe({ oid: 'oid-de-hugo', preferred_username: 'hugo@ejemplo.com' }),
    /administrador/
  );
});

test('sin dirección de correo no hay cuenta que abrir', () => {
  assert.throws(() => entra.cuentaDe({ oid: 'oid-sin-correo', name: 'Sin Correo' }), /correo/);
});

// ---------- Los enlaces que abren la app ----------

// Los dos archivos que enlazan el dominio con la aplicación. Se piden sin
// sesión: Android los lee al instalar el APK y el de Apple lo lee Apple.

test('Android puede leer sus enlaces de aplicación sin sesión', async () => {
  const res = await pedir('GET', '/.well-known/assetlinks.json');
  assert.strictEqual(res.estado, 200);
  assert.ok(Array.isArray(res.datos));
});

test('iOS puede leer los suyos, y sin equipo de Apple no promete nada', async () => {
  const res = await fetch(`${base}/.well-known/apple-app-site-association`);
  assert.strictEqual(res.status, 200);
  // Apple descarta el archivo si no llega como JSON, y no avisa de por qué.
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.deepStrictEqual((await res.json()).applinks.details, []);
});

test('con equipo de Apple, el archivo nombra la app y la ficha de la incidencia', async () => {
  process.env.EQUIPO_APP = 'ABCDE12345';
  try {
    const datos = await (await fetch(`${base}/.well-known/apple-app-site-association`)).json();
    const [detalle] = datos.applinks.details;
    assert.deepStrictEqual(detalle.appIDs, ['ABCDE12345.com.ejemplo.soporte']);
    assert.deepStrictEqual(detalle.paths, ['/ticket.html*']);
    assert.strictEqual(detalle.components[0]['/'], '/ticket.html');
  } finally {
    delete process.env.EQUIPO_APP;
  }
});

test('la política de privacidad se lee sin sesión', async () => {
  // La exigen las dos tiendas y la abre Apple desde la ficha, sin cuenta
  // ninguna. Si alguien la sacara de PUBLICAS, el servidor devolvería una
  // redirección a la entrada y el rechazo llegaría semanas después, sin decir
  // que es por esto.
  const res = await fetch(`${base}/privacidad.html`, { redirect: 'manual' });
  assert.strictEqual(res.status, 200);
  assert.match(await res.text(), /Política de privacidad/);
});

// ---------- Coger la incidencia al contestar ----------

async function abrirIncidencia(titulo) {
  const { datos } = await pedir('POST', '/api/tickets', {
    token: mundo.juan.token,
    cuerpo: {
      titulo, grupo_id: mundo.mantenimiento, local_id: mundo.local1,
      area_id: mundo.areaDefault, familia_id: mundo.familiaDefault
    }
  });
  return datos.id;
}

const asignadoDe = (id) =>
  db.prepare('SELECT asignado_a FROM tickets WHERE id = ?').get(id).asignado_a;

test('el primer técnico que contesta se queda la incidencia', async () => {
  const id = await abrirIncidencia('Nadie la ha cogido todavía');
  assert.strictEqual(asignadoDe(id), null, 'nace sin dueño');

  const res = await pedir('POST', `/api/tickets/${id}/mensajes`, {
    token: mundo.jose.token, cuerpo: { contenido: 'Voy a mirarlo.' }
  });
  assert.strictEqual(res.estado, 201);
  assert.strictEqual(asignadoDe(id), mundo.jose.id);
});

test('el segundo técnico que contesta no se la quita al primero', async () => {
  const id = await abrirIncidencia('Ya la lleva José');
  await pedir('POST', `/api/tickets/${id}/mensajes`, {
    token: mundo.jose.token, cuerpo: { contenido: 'Voy yo.' }
  });
  await pedir('POST', `/api/tickets/${id}/mensajes`, {
    token: mundo.antonio.token, cuerpo: { contenido: 'Yo también lo he visto.' }
  });
  assert.strictEqual(asignadoDe(id), mundo.jose.id);
});

test('quien la abre no se la asigna al escribir en su propio hilo', async () => {
  const id = await abrirIncidencia('La escribe quien la reporta');
  await pedir('POST', `/api/tickets/${id}/mensajes`, {
    token: mundo.juan.token, cuerpo: { contenido: 'Sigue igual.' }
  });
  assert.strictEqual(asignadoDe(id), null, 'un empleado no puede ser el asignado');
});

test('un gestor contesta sin quedarse la incidencia', async () => {
  const id = await abrirIncidencia('Contesta quien supervisa');
  const gestor = await crearUsuario(mundo.admin, {
    nombre: 'Rosa', usuario: 'rosa2', password: 'incidencias1', rol: 'gestor', locales: []
  });
  await pedir('POST', `/api/tickets/${id}/mensajes`, {
    token: gestor.token, cuerpo: { contenido: '¿Cómo va esto?' }
  });
  // La ruta de asignación solo admite técnicos: si esto asignara al gestor,
  // quedaría una incidencia en un estado que la propia API rechaza.
  assert.strictEqual(asignadoDe(id), null);
});

test('un técnico de otro departamento contesta sin quedársela', async () => {
  const id = await abrirIncidencia('Es de Mantenimiento');
  // Santiago es de Informática y no tiene locales, así que ve la incidencia,
  // pero asignársela dejaría un técnico de un grupo en un ticket de otro.
  await pedir('POST', `/api/tickets/${id}/mensajes`, {
    token: mundo.santiago.token, cuerpo: { contenido: 'Paso por aquí.' }
  });
  assert.strictEqual(asignadoDe(id), null);
});
