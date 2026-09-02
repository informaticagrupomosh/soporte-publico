'use strict';

/**
 * Comprueba que las notificaciones push salen de verdad, y si no, dice por
 * qué. Igual que `tools/probar-correo.js`, pero contra Firebase: pide un
 * token de acceso a Google —lo que ya demuestra que las credenciales y la
 * salida a internet funcionan— y, si se le da un destino, manda un aviso de
 * prueba de verdad.
 *
 *   node tools/probar-notificaciones.js                        solo la configuración
 *   node tools/probar-notificaciones.js tu@ejemplo.com        avisa a sus dispositivos
 *   node tools/probar-notificaciones.js UN-TOKEN-DE-DISPOSITIVO avisa a ese token
 */

const notificaciones = require('../notificaciones');
const db = require('../db');

const destino = process.argv[2];

function linea(clave, valor) {
  console.log(`  ${clave.padEnd(12)} ${valor}`);
}

/** Los tokens de push a probar: los de una cuenta si el destino es un correo. */
function tokensDe(correoOtoken) {
  if (!correoOtoken.includes('@')) return [correoOtoken];

  const usuario = db.prepare('SELECT id, nombre FROM usuarios WHERE email = ?').get(correoOtoken);
  if (!usuario) throw new Error(`No hay ninguna cuenta con el correo ${correoOtoken}.`);

  const dispositivos = db.prepare('SELECT token_push FROM dispositivos WHERE usuario_id = ?').all(usuario.id);
  if (!dispositivos.length) {
    throw new Error(`${usuario.nombre} no tiene ningún dispositivo registrado (la app aún no ha iniciado sesión ahí).`);
  }
  return dispositivos.map((d) => d.token_push);
}

async function principal() {
  console.log('\nConfiguración de las notificaciones push\n');
  const estado = notificaciones.estado();

  if (!estado.activo) {
    linea('archivo', estado.ruta);
    console.log(`
  No se ha podido leer. Sin él la aplicación funciona, pero no manda ningún
  aviso. Deja ahí el JSON de la cuenta de servicio de Firebase:

  data/fcm.json   (o donde diga la variable FCM_CREDENCIALES)
`);
    process.exitCode = 1;
    return;
  }

  linea('archivo', estado.ruta);
  linea('proyecto', estado.proyecto);
  linea('cuenta', estado.cuenta);

  console.log(`\n${destino ? 'Enviando' : 'Validando'}…\n`);
  try {
    const tokens = destino ? tokensDe(destino) : [];

    if (!tokens.length) {
      await notificaciones.probar(null);
      console.log('  Firebase aceptó las credenciales.');
      console.log(`
  Para mandar un aviso de prueba:
    node tools/probar-notificaciones.js tu-correo@ejemplo.com
    node tools/probar-notificaciones.js UN-TOKEN-DE-DISPOSITIVO
`);
      return;
    }

    for (const token of tokens) {
      const res = await notificaciones.probar(token);
      console.log(res.enviado
        ? `  Enviado a ${token.slice(0, 12)}…`
        : `  Rechazado: ese token está muerto (la app lo desinstaló o caducó) y se ha borrado.`);
    }
    console.log('\n  Si el móvil no lo enseña, mira que Ajustes → Apps → Incidencias tenga las\n'
      + '  notificaciones permitidas y que no le esté restringiendo la batería.');
  } catch (e) {
    console.log(`  ${e.message}\n`);
    console.log(`  Lo que suele fallar:

  No se pudo conectar      El servidor no llega a Google: cortafuegos o política
                           de salida del alojamiento. Pruébalo con:
                             curl -sS -o /dev/null -w '%{http_code}\\n' \\
                               https://fcm.googleapis.com/

  Firebase rechazó...      El JSON de la cuenta de servicio no es válido, ha sido
                           revocado, o el proyecto no tiene Cloud Messaging
                           activado.

  No hay ninguna cuenta    El correo no coincide con ningún usuario, o la cuenta
                           no tiene dispositivo: la app aún no ha iniciado sesión.
`);
    process.exitCode = 1;
  }
}

principal();
