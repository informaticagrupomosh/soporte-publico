'use strict';

/**
 * A quién le llega un aviso.
 *
 * Es la parte de las notificaciones que se puede comprobar sin hablar con
 * Google: el envío en sí depende de credenciales que en las pruebas no hay, y
 * decidir mal el destinatario no da ningún error — simplemente no le llega a
 * nadie, y eso puede estar roto meses sin que nadie lo note. Que es lo que
 * pasó.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'pruebas');
process.env.INCIDENCIAS_DB = path.join(DATA_DIR, 'avisos.db');

// Y sin la configuración de la organización: si las pruebas leyeran el
// `data/organizacion.json` de la instalación, cambiar el nombre de la empresa
// —o el local por defecto— rompería la suite. Apuntando a un archivo que no
// existe, corren siempre con los valores genéricos.
process.env.ORGANIZACION_CONFIG = path.join(DATA_DIR, 'organizacion-que-no-existe.json');
fs.mkdirSync(DATA_DIR, { recursive: true });
for (const sufijo of ['', '-wal', '-shm']) {
  fs.rmSync(`${process.env.INCIDENCIAS_DB}${sufijo}`, { force: true });
}

const db = require('../db');
const notificaciones = require('../notificaciones');

// ---------- El escenario ----------

let siguiente = 0;
const unico = () => `p${Date.now()}${siguiente += 1}`;

function usuario(rol, { grupoId = null, bloqueada = 0, locales = [] } = {}) {
  const nombre = unico();
  const id = db.prepare(`
    INSERT INTO usuarios (usuario, nombre, rol, email, grupo_id, password_hash, bloqueada)
    VALUES (?, ?, ?, ?, ?, 'x', ?)
  `).run(nombre, nombre, rol, `${nombre}@ejemplo.com`, grupoId, bloqueada).lastInsertRowid;
  for (const localId of locales) {
    db.prepare('INSERT INTO usuario_local (usuario_id, local_id) VALUES (?, ?)').run(id, localId);
  }
  return id;
}

const grupoId = db.prepare('SELECT id FROM grupos ORDER BY id LIMIT 1').get().id;
const localId = db.prepare('SELECT id FROM locales ORDER BY id LIMIT 1').get().id;
const otroLocalId = db.prepare('SELECT id FROM locales ORDER BY id LIMIT 1 OFFSET 1').get().id;

function incidencia({ creadoPor, asignadoA = null }) {
  const id = db.prepare(`
    INSERT INTO tickets (titulo, descripcion, grupo_id, local_id, creado_por, asignado_a)
    VALUES ('Se ha roto algo', '', ?, ?, ?, ?)
  `).run(grupoId, localId, creadoPor, asignadoA).lastInsertRowid;
  return db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
}

function escribe(ticket, autorId) {
  db.prepare('INSERT INTO mensajes (ticket_id, autor_id, contenido) VALUES (?, ?, ?)')
    .run(ticket.id, autorId, 'algo');
}

// Los identificadores en un conjunto: el orden de la consulta no es cosa suya.
const conjunto = (ids) => new Set(ids);

// ---------- Las pruebas ----------

test('avisa a quien la abrió y a quien la tiene asignada', () => {
  const creador = usuario('usuario', { locales: [localId] });
  const tecnico = usuario('tecnico', { grupoId });
  const ticket = incidencia({ creadoPor: creador, asignadoA: tecnico });

  assert.deepStrictEqual(
    conjunto(notificaciones.implicadosEn(ticket)),
    conjunto([creador, tecnico])
  );
});

test('avisa también a quien ha escrito en el hilo', () => {
  const creador = usuario('usuario', { locales: [localId] });
  const tecnico = usuario('tecnico', { grupoId });
  const gestor = usuario('gestor');
  const ticket = incidencia({ creadoPor: creador, asignadoA: tecnico });

  // El gestor no es ni el creador ni el asignado: entra por haber hablado.
  escribe(ticket, gestor);

  assert.deepStrictEqual(
    conjunto(notificaciones.implicadosEn(ticket)),
    conjunto([creador, tecnico, gestor])
  );
});

test('sin asignar, la incidencia sigue siendo de los técnicos del grupo', () => {
  const creador = usuario('usuario', { locales: [localId] });
  const suyo = usuario('tecnico', { grupoId, locales: [localId] });
  const todoTerreno = usuario('tecnico', { grupoId });
  const deOtroLocal = usuario('tecnico', { grupoId, locales: [otroLocalId] });
  const ticket = incidencia({ creadoPor: creador });

  const quienes = conjunto(notificaciones.implicadosEn(ticket));
  assert.ok(quienes.has(suyo), 'el técnico de ese local');
  assert.ok(quienes.has(todoTerreno), 'el técnico sin locales atiende todos');
  assert.ok(!quienes.has(deOtroLocal), 'el técnico de otro local no pinta nada aquí');
});

test('con asignado no se molesta al resto del grupo', () => {
  const creador = usuario('usuario', { locales: [localId] });
  const tecnico = usuario('tecnico', { grupoId });
  const companiero = usuario('tecnico', { grupoId });
  const ticket = incidencia({ creadoPor: creador, asignadoA: tecnico });

  assert.ok(!conjunto(notificaciones.implicadosEn(ticket)).has(companiero));
});

test('una cuenta bloqueada no recibe avisos', () => {
  const creador = usuario('usuario', { locales: [localId], bloqueada: 1 });
  const tecnico = usuario('tecnico', { grupoId });
  const ticket = incidencia({ creadoPor: creador, asignadoA: tecnico });

  assert.deepStrictEqual(
    conjunto(notificaciones.implicadosEn(ticket)),
    conjunto([tecnico])
  );
});

// ---------- Los huecos que tenía la regla anterior ----------
//
// Cada una de estas tres devolvía a nadie, o a quien no era, y ninguna daba
// error: el aviso simplemente no salía.

test('el asignado escribe y el creador se entera', () => {
  const creador = usuario('usuario', { locales: [localId] });
  const tecnico = usuario('tecnico', { grupoId });
  const ticket = incidencia({ creadoPor: creador, asignadoA: tecnico });
  escribe(ticket, tecnico);

  // Antes: quien escribe es técnico, así que la lista era [creado_por]. Bien.
  // Pero al revés, escribiendo el creador con la incidencia asignada a él
  // mismo, la lista se quedaba vacía. Ahora la lista es la misma siempre y el
  // autor se descuenta al enviar.
  const quienes = notificaciones.implicadosEn(ticket);
  assert.ok(quienes.includes(creador));
  assert.ok(quienes.includes(tecnico));
});

test('un gestor contesta y el técnico asignado se entera', () => {
  const creador = usuario('usuario', { locales: [localId] });
  const tecnico = usuario('tecnico', { grupoId });
  const gestor = usuario('gestor');
  const ticket = incidencia({ creadoPor: creador, asignadoA: tecnico });
  escribe(ticket, gestor);

  // Antes solo se avisaba al creador: quien estaba haciendo el trabajo no se
  // enteraba de que su jefe había respondido en su incidencia.
  assert.ok(notificaciones.implicadosEn(ticket).includes(tecnico));
});

test('dos técnicos sobre la misma avería se oyen entre ellos', () => {
  const creador = usuario('usuario', { locales: [localId] });
  const uno = usuario('tecnico', { grupoId });
  const otro = usuario('tecnico', { grupoId });
  const ticket = incidencia({ creadoPor: creador, asignadoA: uno });
  escribe(ticket, otro);

  assert.ok(notificaciones.implicadosEn(ticket).includes(otro));
});
