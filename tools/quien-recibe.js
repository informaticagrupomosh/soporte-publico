'use strict';

/**
 * Para una incidencia concreta, quién recibiría cada aviso y si de verdad
 * puede llegarle. No manda nada: repite la lógica de destinatarios de
 * `notificaciones.js` (la misma que corre en la aplicación) y dice, de cada
 * uno, si tiene correo y si tiene algún dispositivo registrado — que es lo
 * que decide si el aviso llega o se descarta en silencio, sin que quede
 * ningún error en ningún sitio.
 *
 *   node tools/quien-recibe.js <id-de-la-incidencia>
 */

const db = require('../db');
const notificaciones = require('../notificaciones');

const id = Number(process.argv[2]);
if (!id) {
  console.log('\n  Uso: node tools/quien-recibe.js <id-de-la-incidencia>\n');
  process.exitCode = 1;
  return;
}

const ticket = db.prepare(`
  SELECT t.*, g.nombre AS grupo_nombre, l.nombre AS local_nombre
  FROM tickets t JOIN grupos g ON g.id = t.grupo_id JOIN locales l ON l.id = t.local_id
  WHERE t.id = ?
`).get(id);

if (!ticket) {
  console.log(`\n  No existe la incidencia #${id}.\n`);
  process.exitCode = 1;
  return;
}

function persona(usuarioId) {
  if (!usuarioId) return null;
  const u = db.prepare('SELECT id, nombre, email, bloqueada FROM usuarios WHERE id = ?').get(usuarioId);
  if (!u) return null;
  const dispositivos = db.prepare('SELECT COUNT(*) AS n FROM dispositivos WHERE usuario_id = ?').get(u.id).n;
  return { ...u, dispositivos };
}

function linea(u) {
  if (!u) return '  (nadie)';
  const correo = u.email ? u.email : 'SIN CORREO — no le llega el aviso por email';
  const push = u.dispositivos ? `${u.dispositivos} dispositivo(s)` : 'SIN DISPOSITIVO — no le llega el push';
  const bloqueada = u.bloqueada ? ' · CUENTA BLOQUEADA — no recibe nada' : '';
  return `  ${u.nombre} (#${u.id}) — ${correo} · ${push}${bloqueada}`;
}

console.log(`\nIncidencia #${ticket.id}: ${ticket.titulo}`);
console.log(`  ${ticket.grupo_nombre} · ${ticket.local_nombre} · asignada a ${ticket.asignado_a || '(nadie todavía)'}\n`);

console.log('Técnicos con visibilidad sobre esta incidencia (avisarTicketCreado):');
const tecnicos = notificaciones.tecnicosDe(ticket);
if (!tecnicos.length) {
  console.log('  Ninguno — nadie recibirá el aviso de incidencia creada. Revisa que haya un técnico de ese\n'
    + '  grupo, sin bloquear, sin locales marcados o con este local entre los suyos.');
} else {
  tecnicos.forEach((tid) => console.log(linea(persona(tid))));
}

console.log('\nImplicados (responder en el hilo, cambiar de estado) — menos quien lo provoque:');
const implicados = notificaciones.implicadosEn(ticket);
if (!implicados.length) {
  console.log('  Ninguno. No debería pasar: al menos quien la abrió tendría que estar aquí.');
} else {
  implicados.forEach((uid) => console.log(linea(persona(uid))));
}

console.log('\nQuien abrió la incidencia — creado_por:');
console.log(linea(persona(ticket.creado_por)));

console.log('\nQuien la tiene asignada — asignado_a:');
console.log(linea(persona(ticket.asignado_a)));

console.log(`
Sin correo no llega el aviso por email, y sin ningún dispositivo registrado
—la app nunca ha iniciado sesión en ese móvil— no llega el push. Ninguno de
los dos es un error: se descartan en silencio, tal como está diseñado. Si
alguien de las listas de arriba debería recibir el aviso y no puede, ahí está
el motivo.
`);
