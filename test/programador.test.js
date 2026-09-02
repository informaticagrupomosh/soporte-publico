'use strict';

/**
 * Pruebas del disparador, no solo de la planificación: que el repaso abra la
 * incidencia cuando le toca, que no la abra dos veces y que el reloj interno
 * llegue a dispararse de verdad. Lo que fallaba no era decidir *cuándo* toca,
 * sino que alguien lo mirase.
 */

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Base propia de este archivo de pruebas: los archivos corren a la vez y con
// una compartida se borrarían las filas unos a otros.
const DATA_DIR = path.join(__dirname, '..', 'data', 'pruebas');
process.env.INCIDENCIAS_DB = path.join(DATA_DIR, 'programador.db');
fs.mkdirSync(DATA_DIR, { recursive: true });
for (const sufijo of ['', '-wal', '-shm']) {
  fs.rmSync(`${process.env.INCIDENCIAS_DB}${sufijo}`, { force: true });
}

const db = require('../db');
const programador = require('../programador');
const planificacion = require('../planificacion');

let grupo;
let local;

before(() => {
  grupo = db.prepare('SELECT id FROM grupos ORDER BY orden').get().id;
  local = db.prepare('SELECT id FROM locales ORDER BY orden').get().id;
});

after(() => programador.parar());

beforeEach(() => {
  db.exec('DELETE FROM tickets');
  db.exec('DELETE FROM tareas_programadas');
});

// Una tarea diaria a las 09:00, ya evaluada hasta `evaluadaHasta`.
function tareaDiaria(evaluadaHasta, nombre = 'Prueba') {
  const info = db.prepare(`
    INSERT INTO tareas_programadas
      (nombre, frecuencia, hora, fecha_inicio, cada, plantilla_titulo, grupo_id, local_id, activo, evaluada_hasta)
    VALUES (?, 'diaria', '09:00', '2026-01-01', 1, 'Revisión', ?, ?, 1, ?)
  `).run(nombre, grupo, local, evaluadaHasta ? evaluadaHasta.toISOString() : null);
  return info.lastInsertRowid;
}

function cuantosTickets() {
  return db.prepare('SELECT COUNT(*) AS c FROM tickets').get().c;
}

// Las 09:00 del 15 de enero de 2026 en la zona de la aplicación.
const LAS_NUEVE = planificacion.instanteDe(2026, 1, 15, 9, 0);

test('el repaso abre la incidencia en el minuto que toca', () => {
  tareaDiaria(new Date(LAS_NUEVE.getTime() - MINUTOS(1)));
  assert.strictEqual(programador.repasar(new Date(LAS_NUEVE.getTime() + 30000)), 1);
  assert.strictEqual(cuantosTickets(), 1);
});

test('el repaso no abre nada cuando todavía no toca', () => {
  tareaDiaria(new Date(LAS_NUEVE.getTime() - MINUTOS(10)));
  assert.strictEqual(programador.repasar(new Date(LAS_NUEVE.getTime() - MINUTOS(5))), 0);
  assert.strictEqual(cuantosTickets(), 0);
});

test('repasar cada minuto abre la incidencia una sola vez', () => {
  // Se simula media hora de repasos, uno por minuto, alrededor de las nueve.
  tareaDiaria(new Date(LAS_NUEVE.getTime() - MINUTOS(15)));
  for (let m = -14; m <= 15; m += 1) {
    programador.repasar(new Date(LAS_NUEVE.getTime() + MINUTOS(m)));
  }
  assert.strictEqual(cuantosTickets(), 1, 'una sola incidencia en toda la media hora');
});

test('dos repasos a la vez no duplican la incidencia', () => {
  // Es lo que pasa cuando coinciden el reloj y una petición, o dos procesos.
  const id = tareaDiaria(new Date(LAS_NUEVE.getTime() - MINUTOS(1)));
  const tarea = db.prepare('SELECT * FROM tareas_programadas WHERE id = ?').get(id);
  const cuando = new Date(LAS_NUEVE.getTime() + 30000);

  programador.repasar(cuando);
  // El segundo repaso llega con la foto de antes, como si hubiera leído la
  // tarea al mismo tiempo que el primero.
  db.prepare('UPDATE tareas_programadas SET evaluada_hasta = ? WHERE id = ?')
    .run(tarea.evaluada_hasta, id);
  const primeros = cuantosTickets();
  programador.repasar(cuando);

  assert.strictEqual(cuantosTickets(), primeros + 1,
    'la reserva de la ventana es lo que evita el duplicado; sin ella saldrían dos');
});

test('un repaso tras un parón recupera el vencimiento perdido, una sola vez', () => {
  // El servidor estuvo apagado desde ayer por la tarde.
  tareaDiaria(new Date(LAS_NUEVE.getTime() - MINUTOS(60 * 20)));
  assert.strictEqual(programador.repasar(new Date(LAS_NUEVE.getTime() + MINUTOS(90))), 1);
  assert.strictEqual(programador.repasar(new Date(LAS_NUEVE.getTime() + MINUTOS(91))), 0);
});

test('una tarea detenida no abre nada', () => {
  const id = tareaDiaria(new Date(LAS_NUEVE.getTime() - MINUTOS(1)));
  db.prepare('UPDATE tareas_programadas SET activo = 0 WHERE id = ?').run(id);
  assert.strictEqual(programador.repasar(new Date(LAS_NUEVE.getTime() + 30000)), 0);
});

// ---------- El disparador ----------

test('el reloj interno dispara el repaso de verdad', async () => {
  // Lo que se comprueba aquí es lo que fallaba: no que el plan sepa cuándo
  // toca, sino que algo lo mire sin que nadie se lo pida.
  tareaDiaria(null);
  programador.parar();
  programador.arrancar();
  assert.ok(programador.estado().relojActivo, 'el reloj queda en marcha');

  // La tarea se pone a punto de vencer y se espera a que el reloj lo note.
  // El intervalo es de un minuto, así que se adelanta la marca para que el
  // próximo latido ya la encuentre vencida.
  const id = db.prepare('SELECT id FROM tareas_programadas').get().id;
  const hora = planificacion.enZona(new Date(Date.now() + 2000));
  db.prepare('UPDATE tareas_programadas SET hora = ?, fecha_inicio = ?, evaluada_hasta = ? WHERE id = ?')
    .run(
      `${String(hora.hora).padStart(2, '0')}:${String(hora.minuto).padStart(2, '0')}`,
      `${hora.anio}-${String(hora.mes).padStart(2, '0')}-${String(hora.dia).padStart(2, '0')}`,
      new Date(Date.now() - 90000).toISOString(),
      id
    );

  const antes = programador.estado().ultimoRepaso;
  // El reloj late cada minuto; se espera algo más para no depender del ajuste.
  await new Promise((listo) => setTimeout(listo, 65000));
  programador.parar();

  assert.notStrictEqual(programador.estado().ultimoRepaso, antes, 'el reloj ha vuelto a repasar');
  assert.strictEqual(cuantosTickets(), 1, 'y ha abierto la incidencia sin que nadie se lo pidiera');
});

test('el repaso por petición espera un minuto entre repasos', () => {
  programador.parar();
  programador.repasar(new Date());
  assert.ok(!programador.tocaRepasar(), 'recién repasado, una petición no vuelve a mirar');
  assert.ok(programador.tocaRepasar(Date.now() + MINUTOS(1)), 'un minuto después, sí');
});

test('una petición abre la incidencia aunque el reloj no corra', () => {
  programador.parar();
  db.exec('DELETE FROM tickets');
  db.exec('DELETE FROM tareas_programadas');

  // Una tarea que venció hace un minuto y que nadie ha repasado todavía.
  const id = tareaDiaria(new Date(Date.now() - MINUTOS(5)));
  const hora = planificacion.enZona(new Date(Date.now() - MINUTOS(1)));
  db.prepare('UPDATE tareas_programadas SET hora = ?, fecha_inicio = ? WHERE id = ?')
    .run(
      `${String(hora.hora).padStart(2, '0')}:${String(hora.minuto).padStart(2, '0')}`,
      `${hora.anio}-${String(hora.mes).padStart(2, '0')}-${String(hora.dia).padStart(2, '0')}`,
      id
    );

  // El repaso que haría el middleware al ver que toca. Es la red de seguridad:
  // si el reloj del proceso no llegara a servirse, la incidencia se abre igual
  // en cuanto alguien entra en la aplicación.
  let siguio = false;
  if (programador.tocaRepasar(Date.now() + MINUTOS(2))) programador.repasar();
  programador.middlewareRepaso({}, {}, () => { siguio = true; });

  assert.ok(siguio, 'la petición sigue su camino');
  assert.strictEqual(cuantosTickets(), 1, 'y la incidencia se ha abierto igualmente');
});

function MINUTOS(n) {
  return n * 60000;
}
