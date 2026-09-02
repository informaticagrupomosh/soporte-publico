'use strict';

/**
 * Programador de tareas: repasa las tareas activas y abre las incidencias que
 * tocan según su plan (ver planificacion.js).
 *
 * Cada tarea guarda en `evaluada_hasta` el último momento ya repasado, así que
 * un reinicio no repite lo hecho ni se salta lo que venció mientras el proceso
 * estaba parado (hasta una semana atrás; ver `planificacion.vencimientos`).
 *
 * El repaso se dispara por dos vías a la vez, a propósito:
 *
 *   1. Un reloj interno, cada minuto, que es la que hace que una tarea salte a
 *      su hora aunque no haya nadie usando la aplicación.
 *   2. Cualquier petición que llegue, si hace más de un minuto del último
 *      repaso. Es la red de seguridad: hay gestores de procesos que cargan la
 *      aplicación de formas en las que un temporizador puede no llegar a
 *      servirse nunca, y con esto las incidencias se abren igual en cuanto
 *      alguien entra, en vez de no abrirse jamás.
 *
 * Que las dos vías puedan solaparse no duplica nada: antes de abrir ninguna
 * incidencia se reserva la ventana de tiempo en la base de datos, y solo la
 * reserva uno. Eso vale igual si el gestor levanta varios procesos.
 */

const db = require('./db');
const planificacion = require('./planificacion');
const notificaciones = require('./notificaciones');

const MINUTO = 60000;

// `evaluada_hasta` se guarda como instante ISO en UTC, igual que el resto de
// marcas de tiempo de la base. El plan, en cambio, se lee en la zona de la
// aplicación; el Date de en medio traduce entre las dos cosas sin ambigüedad.
function comoTexto(fecha) {
  return fecha.toISOString();
}

function desdeTexto(texto) {
  if (!texto) return null;
  const fecha = new Date(texto);
  return Number.isFinite(fecha.getTime()) ? fecha : null;
}

// Locales sobre los que actúa una tarea: el suyo, o todos si no tiene ninguno.
function localesDe(tarea) {
  if (tarea.local_id) {
    return db.prepare('SELECT id, nombre FROM locales WHERE id = ?').all(tarea.local_id);
  }
  return db.prepare('SELECT id, nombre FROM locales ORDER BY orden, nombre').all();
}

const insertarTicket = db.prepare(`
  INSERT INTO tickets
    (titulo, descripcion, estado, prioridad, grupo_id, local_id, empresa_id,
     area_id, familia_id, subfamilia_id, creado_por, tarea_id)
  VALUES (?, ?, 'abierto', ?, ?, ?, ?, ?, ?, ?, NULL, ?)
`);

/**
 * Abre las incidencias de una tarea que ha vencido. Devuelve las incidencias
 * creadas, ya con el nombre del local, para poder avisar a los técnicos.
 */
function abrirIncidencias(tarea) {
  const locales = localesDe(tarea);
  const creadas = [];
  db.transaction(() => {
    for (const local of locales) {
      const info = insertarTicket.run(
        tarea.plantilla_titulo,
        tarea.plantilla_descripcion || null,
        tarea.prioridad,
        tarea.grupo_id,
        local.id,
        tarea.mantenimiento_externo ? tarea.empresa_id : null,
        tarea.area_id || null,
        tarea.familia_id || null,
        tarea.subfamilia_id || null,
        tarea.id
      );
      creadas.push({
        id: info.lastInsertRowid,
        titulo: tarea.plantilla_titulo,
        grupo_id: tarea.grupo_id,
        local_id: local.id,
        local_nombre: local.nombre
      });
    }
  })();
  return creadas;
}

/**
 * Reserva para este repaso la ventana de tiempo de una tarea, avanzando su
 * `evaluada_hasta` solo si nadie lo ha tocado mientras tanto. Devuelve `true`
 * si la reserva es nuestra; `false` si se nos ha adelantado otro repaso, en
 * cuyo caso no hay que abrir nada.
 */
const reservar = db.prepare(`
  UPDATE tareas_programadas SET evaluada_hasta = ?
  WHERE id = ? AND evaluada_hasta IS ?
`);

// Momento del último repaso, para no repetirlo en cada petición y para poder
// enseñar en la pantalla de tareas que el programador sigue vivo.
let ultimoRepaso = null;

/**
 * Repasa todas las tareas activas hasta `ahora`. Devuelve cuántas incidencias
 * ha abierto, que es lo que comprueban las pruebas.
 */
function repasar(ahora = new Date()) {
  ultimoRepaso = ahora;
  const tareas = db.prepare('SELECT * FROM tareas_programadas WHERE activo = 1').all();
  let abiertas = 0;

  for (const tarea of tareas) {
    // Una tarea sin marca todavía no se ha evaluado nunca: empieza a contar
    // ahora, para no abrir de golpe todo el pasado de su plan.
    const desde = desdeTexto(tarea.evaluada_hasta) || ahora;

    // La ventana se reserva antes de mirar nada: si otro repaso va por la
    // misma tarea, uno de los dos se queda fuera y no se duplican incidencias.
    if (!reservar.run(comoTexto(ahora), tarea.id, tarea.evaluada_hasta).changes) continue;

    let saltos = [];
    try {
      saltos = planificacion.vencimientos(planificacion.desdeFila(tarea), desde, ahora);
    } catch (e) {
      console.error(`Tarea «${tarea.nombre}»: no se pudo leer su planificación (${e.message}).`);
    }

    // Aunque una tarea venza varias veces mientras el servidor está parado, se
    // abre una sola tanda: repetir la misma revisión cinco veces solo estorba.
    if (saltos.length) {
      const creadas = abrirIncidencias(tarea);
      abiertas += creadas.length;
      for (const ticket of creadas) notificaciones.avisarTicketCreado(ticket);
      console.log(`Tarea «${tarea.nombre}»: ${creadas.length} incidencia(s) abierta(s).`);
    }
  }
  return abiertas;
}

function repasarSinFallar(ahora) {
  try {
    return repasar(ahora);
  } catch (e) {
    console.error(`El programador de tareas ha fallado: ${e.message}`);
    return 0;
  }
}

// ¿Hace ya un minuto del último repaso? Es lo que evita que cada petición
// vuelva a mirar las tareas.
function tocaRepasar(ahora = Date.now()) {
  return !ultimoRepaso || ahora - ultimoRepaso.getTime() >= MINUTO;
}

/**
 * Middleware que repasa las tareas si hace más de un minuto del último repaso.
 * No entorpece la petición: es una consulta sobre una tabla diminuta y, casi
 * siempre, ni eso.
 */
function middlewareRepaso(req, res, next) {
  if (tocaRepasar()) repasarSinFallar();
  next();
}

// Qué contar de sí mismo en la pantalla de tareas, para que se vea si el
// programador está funcionando en vez de tener que suponerlo.
function estado() {
  return {
    zona: planificacion.ZONA,
    ultimoRepaso: ultimoRepaso ? ultimoRepaso.toISOString() : null,
    relojActivo: reloj !== null
  };
}

let reloj = null;

function arrancar() {
  if (reloj) return;
  repasarSinFallar();
  reloj = setInterval(() => repasarSinFallar(), MINUTO);

  const activas = db.prepare('SELECT * FROM tareas_programadas WHERE activo = 1').all();
  console.log(`Programador en marcha (${planificacion.ZONA}): ${activas.length} tarea(s) activa(s).`);
  for (const tarea of activas) {
    const proxima = planificacion.proximo(planificacion.desdeFila(tarea));
    console.log(`  «${tarea.nombre}» → ${proxima ? planificacion.comoTexto(proxima) : 'no le vuelve a tocar'}`);
  }
}

function parar() {
  if (reloj) clearInterval(reloj);
  reloj = null;
}

module.exports = {
  repasar,
  arrancar,
  parar,
  estado,
  tocaRepasar,
  middlewareRepaso,
  comoTexto,
  abrirIncidencias
};
