'use strict';

/**
 * El contenido de partida de una instalación nueva, y sobre todo lo que **no**
 * tiene que volver a hacer en la segunda.
 *
 * Sembrar fila a fila con `INSERT OR IGNORE` parecía inofensivo y no lo era: un
 * local borrado desde Administración reaparecía en el siguiente reinicio, y
 * quien lo borró no tenía forma de relacionar una cosa con la otra. Se vio al
 * montar la base de demostración, donde volvían los locales sembrados después
 * de haberlos quitado.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'pruebas');
process.env.INCIDENCIAS_DB = path.join(DATA_DIR, 'siembra.db');
fs.mkdirSync(DATA_DIR, { recursive: true });
for (const sufijo of ['', '-wal', '-shm']) {
  fs.rmSync(`${process.env.INCIDENCIAS_DB}${sufijo}`, { force: true });
}

// Volver a cargar el módulo vuelve a ejecutar la siembra, que es justo lo que
// pasa al reiniciar el servidor.
const arrancarDeNuevo = () => {
  delete require.cache[require.resolve('../db')];
  return require('../db');
};

const db = require('../db');

const locales = (base) => base.prepare('SELECT nombre FROM locales ORDER BY orden, id').all()
  .map((l) => l.nombre);

test('una base nueva llega con sus catálogos puestos', () => {
  assert.ok(locales(db).length > 0, 'locales');
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM grupos').get().n > 0, 'grupos');
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM areas').get().n > 0, 'áreas');
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM prendas_lavanderia').get().n > 0, 'prendas');
});

test('un local borrado no vuelve al reiniciar', () => {
  const antes = locales(db);
  const victima = antes[antes.length - 1];
  db.prepare('DELETE FROM locales WHERE nombre = ?').run(victima);

  const despues = locales(arrancarDeNuevo());
  assert.ok(!despues.includes(victima), `«${victima}» ha vuelto al reiniciar`);
  assert.strictEqual(despues.length, antes.length - 1);
});

test('una instalación con sus propios catálogos no se mezcla con los de aquí', () => {
  // Es el caso de la base de demostración: se vacía y se llena con lo suyo.
  db.prepare('DELETE FROM locales').run();
  db.prepare("INSERT INTO locales (nombre, orden) VALUES ('Restaurante Ejemplo', 0)").run();

  assert.deepStrictEqual(locales(arrancarDeNuevo()), ['Restaurante Ejemplo']);
});
