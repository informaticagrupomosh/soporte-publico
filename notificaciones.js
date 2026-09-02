'use strict';

/**
 * Notificaciones push por Firebase Cloud Messaging (API HTTP v1), sin
 * librerías: el token de acceso se pide firmando un JWT con la clave de la
 * cuenta de servicio, que es lo único que hace el SDK de Google por debajo.
 *
 * Las credenciales son el JSON de la cuenta de servicio de Firebase, en
 * `data/fcm.json` o donde diga la variable de entorno `FCM_CREDENCIALES`. Sin
 * ese archivo la app funciona igual: los envíos no se hacen y se anota una vez
 * en el registro. Así la web no depende de tener Firebase configurado.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const correo = require('./correo');

const RUTA = process.env.FCM_CREDENCIALES || path.join(__dirname, 'data', 'fcm.json');
const AMBITO = 'https://www.googleapis.com/auth/firebase.messaging';

let credenciales = null;
let avisado = false;

function cargarCredenciales() {
  if (credenciales !== null) return credenciales;
  try {
    const json = JSON.parse(fs.readFileSync(RUTA, 'utf8'));
    if (!json.client_email || !json.private_key || !json.project_id) {
      throw new Error('faltan client_email, private_key o project_id');
    }
    credenciales = json;
    console.log(`Notificaciones push activas (proyecto ${json.project_id}).`);
  } catch (e) {
    credenciales = false;
    if (!avisado) {
      avisado = true;
      console.log(`Notificaciones push desactivadas: no se pudo leer ${RUTA} (${e.message}).`);
    }
  }
  return credenciales;
}

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// El token de Google vale una hora; se reutiliza hasta un minuto antes de caducar.
let acceso = { token: null, expira: 0 };

async function tokenDeAcceso() {
  const cuenta = cargarCredenciales();
  if (!cuenta) return null;
  if (acceso.token && Date.now() < acceso.expira) return acceso.token;

  const ahora = Math.floor(Date.now() / 1000);
  const cabecera = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const cuerpo = base64url(JSON.stringify({
    iss: cuenta.client_email,
    scope: AMBITO,
    aud: cuenta.token_uri || 'https://oauth2.googleapis.com/token',
    iat: ahora,
    exp: ahora + 3600
  }));
  const firma = base64url(
    crypto.createSign('RSA-SHA256').update(`${cabecera}.${cuerpo}`).sign(cuenta.private_key)
  );

  let res;
  try {
    res = await fetch(cuenta.token_uri || 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${cabecera}.${cuerpo}.${firma}`
      })
    });
  } catch (e) {
    // Ni se ha llegado a hablar con Google: es salida a internet, DNS o un
    // cortafuegos, no las credenciales — igual que en `correo.js`.
    throw new Error(
      `No se pudo conectar con oauth2.googleapis.com: ${e.message}. `
      + 'Comprueba que el servidor tiene salida a Google por HTTPS.'
    );
  }
  const datos = await res.json().catch(() => ({}));
  if (!res.ok || !datos.access_token) {
    throw new Error(`Firebase rechazó las credenciales: ${datos.error_description || res.status}`);
  }
  acceso = { token: datos.access_token, expira: Date.now() + (datos.expires_in - 60) * 1000 };
  return acceso.token;
}

// Un token que Firebase da por muerto se borra: el móvil volverá a registrarse
// con uno nuevo la próxima vez que se inicie sesión.
const MUERTOS = ['UNREGISTERED', 'INVALID_ARGUMENT', 'NOT_FOUND', 'SENDER_ID_MISMATCH'];

function olvidarDispositivo(token) {
  db.prepare('DELETE FROM dispositivos WHERE token_push = ?').run(token);
}

// Canal de notificaciones de la app móvil. Tiene que ser exactamente el mismo
// que la app crea al arrancar y que declara su manifiesto: desde Android 8 un
// aviso dirigido a un canal que no existe no se muestra, y es la causa más
// habitual de que las notificaciones «no lleguen» con el móvil bloqueado.
const CANAL = 'incidencias_avisos';

/**
 * El mensaje tal y como lo espera FCM (API HTTP v1). Está fuera de `enviarA`
 * para poder comprobarlo en las pruebas sin llamar a Google.
 *
 * Lleva `notification` además de `data` a propósito: con la app cerrada o en
 * segundo plano es el propio Android —o iOS— quien pinta el aviso, sin
 * despertar a la aplicación. Un mensaje de solo datos dependería de que el
 * sistema quisiera arrancarla, que es justo lo que no se puede dar por hecho.
 */
function mensajeFCM(tokenPush, { titulo, cuerpo, datos }) {
  return {
    token: tokenPush,
    notification: { title: titulo, body: cuerpo },
    // Los datos viajan como cadenas: es lo único que admite FCM. La app los
    // usa para abrir la incidencia al pulsar la notificación.
    data: Object.fromEntries(Object.entries(datos || {}).map(([k, v]) => [k, String(v)])),
    android: {
      // Alta prioridad: el aviso sale al momento aunque el teléfono esté en
      // reposo, que es lo que se espera de una avería.
      priority: 'high',
      notification: {
        channel_id: CANAL,
        sound: 'default',
        notification_priority: 'PRIORITY_HIGH',
        // Todos los avisos de una misma incidencia comparten etiqueta, así que
        // el nuevo sustituye al anterior en vez de apilarse. Tres mensajes
        // seguidos de un hilo dejan un aviso, no tres.
        tag: etiquetaDe(datos),
        click_action: 'FLUTTER_NOTIFICATION_CLICK'
      }
    },
    // Para la app de iPhone. Prioridad 10 es «entrégalo ya»; `content-available`
    // deja que la app se refresque por detrás si está en segundo plano, y
    // `collapse-id` hace lo mismo que la etiqueta de Android.
    apns: {
      headers: { 'apns-priority': '10', 'apns-collapse-id': etiquetaDe(datos) },
      payload: { aps: { sound: 'default', 'content-available': 1 } }
    }
  };
}

// La etiqueta con la que se agrupan los avisos: uno por incidencia.
function etiquetaDe(datos) {
  const id = datos && datos.ticket_id;
  return id ? `ticket-${id}` : 'incidencias';
}

async function enviarA(tokenPush, aviso, autorizacion, proyecto) {
  let res;
  try {
    res = await fetch(`https://fcm.googleapis.com/v1/projects/${proyecto}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${autorizacion}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: mensajeFCM(tokenPush, aviso) })
    });
  } catch (e) {
    throw new Error(
      `No se pudo conectar con fcm.googleapis.com: ${e.message}. `
      + 'Comprueba que el servidor tiene salida a Google por HTTPS.'
    );
  }
  if (res.ok) return true;
  const error = await res.json().catch(() => ({}));
  const motivo = error.error && error.error.status;
  if (MUERTOS.includes(motivo)) {
    olvidarDispositivo(tokenPush);
    return false;
  }
  throw new Error(`FCM respondió ${res.status}: ${motivo || 'error desconocido'}`);
}

/**
 * Avisa a una lista de usuarios. No espera a que termine el envío: una
 * notificación que falla no puede tumbar la petición que la ha disparado, así
 * que los errores solo se anotan en el registro.
 */
function notificar(usuarioIds, aviso, exceptoId = null) {
  // A quien provoca el aviso no se le avisa: ya sabe lo que ha hecho.
  const ids = [...new Set((usuarioIds || []).filter((id) => id && id !== exceptoId))];
  if (!ids.length || !cargarCredenciales()) return;

  const dispositivos = db.prepare(`
    SELECT token_push FROM dispositivos WHERE usuario_id IN (${ids.map(() => '?').join(',')})
  `).all(...ids);
  if (!dispositivos.length) return;

  const cuenta = cargarCredenciales();
  tokenDeAcceso()
    .then((autorizacion) => Promise.all(
      dispositivos.map((d) => enviarA(d.token_push, aviso, autorizacion, cuenta.project_id)
        .catch((e) => console.error(`No se pudo notificar a un dispositivo: ${e.message}`)))
    ))
    .catch((e) => console.error(`No se pudieron enviar las notificaciones: ${e.message}`));
}

/**
 * Cómo ha quedado la configuración, para poder mirarla sin destripar el
 * archivo. Igual que `correo.estado()`.
 */
function estado() {
  const cargado = cargarCredenciales();
  if (!cargado) return { activo: false, ruta: RUTA };
  return { activo: true, ruta: RUTA, proyecto: cargado.project_id, cuenta: cargado.client_email };
}

/**
 * Pide un token de acceso a Google —lo que ya demuestra que las credenciales
 * y la salida a internet funcionan— y, si se da un token de dispositivo,
 * manda un aviso de prueba. Lo usa `tools/probar-notificaciones.js`.
 */
async function probar(tokenPush) {
  if (!cargarCredenciales()) throw new Error(`No hay configuración de notificaciones en ${RUTA}.`);
  const autorizacion = await tokenDeAcceso();
  if (!tokenPush) return { enviado: null };
  const enviado = await enviarA(tokenPush, {
    titulo: 'Prueba de Incidencias',
    cuerpo: 'Si ves esto, las notificaciones push de Incidencias funcionan.',
    datos: { tipo: 'prueba' }
  }, autorizacion, credenciales.project_id);
  return { enviado };
}

// ---------- Quién recibe cada aviso ----------

/**
 * Técnicos con visibilidad sobre una incidencia: los de su grupo cuyo local
 * esté entre los suyos, más los que no tienen ningún local asignado, que
 * atienden todos (el caso de Informática).
 */
function tecnicosDe(ticket) {
  return db.prepare(`
    SELECT u.id FROM usuarios u
    WHERE u.rol = 'tecnico' AND u.bloqueada = 0 AND u.grupo_id = ?
      AND (
        NOT EXISTS (SELECT 1 FROM usuario_local WHERE usuario_id = u.id)
        OR EXISTS (SELECT 1 FROM usuario_local WHERE usuario_id = u.id AND local_id = ?)
      )
  `).all(ticket.grupo_id, ticket.local_id).map((u) => u.id);
}

/**
 * Todo el que tiene algo que ver con esta incidencia: quien la abrió, quien la
 * tiene asignada y quien haya escrito en el hilo. Sin asignar se suman los
 * técnicos que la ven, porque entonces sigue siendo del grupo entero.
 *
 * Antes cada aviso elegía su destinatario con una regla propia, y entre unas y
 * otras quedaban huecos: un gestor contestaba y el técnico asignado no se
 * enteraba; dos técnicos sobre la misma avería no se oían; quien escribía
 * siendo el asignado no avisaba a nadie, porque la lista se quedaba con él
 * solo y al autor no se le avisa. Una sola regla y esos casos desaparecen.
 *
 * Las cuentas bloqueadas se caen aquí: no tiene sentido gastar un envío en
 * alguien que no puede entrar.
 */
function implicadosEn(ticket) {
  const candidatos = new Set(
    [ticket.creado_por, ticket.asignado_a].filter(Boolean)
  );

  for (const fila of db.prepare(
    'SELECT DISTINCT autor_id FROM mensajes WHERE ticket_id = ?'
  ).all(ticket.id)) {
    if (fila.autor_id) candidatos.add(fila.autor_id);
  }

  if (!ticket.asignado_a) {
    for (const id of tecnicosDe(ticket)) candidatos.add(id);
  }

  if (!candidatos.size) return [];
  const ids = [...candidatos];
  return db.prepare(`
    SELECT id FROM usuarios WHERE id IN (${ids.map(() => '?').join(',')}) AND bloqueada = 0
  `).all(...ids).map((u) => u.id);
}

function recorte(texto, largo = 120) {
  const limpio = String(texto || '').replace(/\s+/g, ' ').trim();
  return limpio.length > largo ? `${limpio.slice(0, largo - 1)}…` : limpio;
}

// Una incidencia nueva se avisa a los técnicos que la van a atender.
function avisarTicketCreado(ticket) {
  const tecnicos = tecnicosDe(ticket);
  notificar(tecnicos, {
    titulo: `Nueva incidencia en ${ticket.local_nombre}`,
    cuerpo: recorte(ticket.titulo),
    datos: { ticket_id: ticket.id, tipo: 'ticket_creado' }
  });

  // Por correo, a los técnicos de su grupo y local mientras no la tenga nadie
  // asignada: es el aviso de «esto ha entrado y está sin coger».
  if (!ticket.asignado_a) {
    correo.enviar(correo.correosDe(tecnicos, ticket.creado_por), {
      asunto: `Nueva incidencia sin asignar · ${recorte(ticket.titulo, 60)}`,
      titulo: 'Ha entrado una incidencia sin asignar',
      lineas: [
        `Se ha abierto una incidencia en <strong>${ticket.local_nombre}</strong> y todavía no la tiene nadie asignada.`,
        'Puedes asignártela desde la aplicación.'
      ],
      ticket
    });
  }

  // Y a quien la abre, para que le quede constancia de que ha entrado.
  correo.enviar(correo.correosDe([ticket.creado_por]), {
    asunto: `Hemos recibido tu incidencia · ${recorte(ticket.titulo, 60)}`,
    titulo: 'Tu incidencia ha quedado registrada',
    lineas: [
      'La hemos recibido y el equipo correspondiente ya la ve.',
      'Te avisaremos cuando alguien la coja o te responda.'
    ],
    ticket
  });
}

/**
 * A quien acaba de recibir una incidencia asignada.
 *
 * Va aparte del cambio de estado porque son dos cosas distintas: una es «esto
 * ahora es tuyo» y la otra «esto ha cambiado».
 */
function avisarAsignacion(ticket, autor) {
  if (!ticket.asignado_a || ticket.asignado_a === autor.id) return;

  notificar([ticket.asignado_a], {
    titulo: `Te han asignado una incidencia en ${ticket.local_nombre}`,
    cuerpo: recorte(ticket.titulo),
    datos: { ticket_id: ticket.id, tipo: 'asignacion' }
  }, autor.id);

  correo.enviar(correo.correosDe([ticket.asignado_a], autor.id), {
    asunto: `Te han asignado una incidencia · ${recorte(ticket.titulo, 60)}`,
    titulo: 'Te han asignado una incidencia',
    lineas: [
      `<strong>${autor.nombre}</strong> te ha asignado esta incidencia de ${ticket.local_nombre}.`
    ],
    ticket
  });
}

/**
 * Un mensaje nuevo avisa a todos los implicados menos a quien lo escribe.
 *
 * El hilo es una conversación, y de una conversación se entera todo el que
 * está en ella. Quien no quiera seguir recibiéndolos, que no escriba.
 */
function avisarMensaje(ticket, mensaje, autor) {
  const destinatarios = implicadosEn(ticket);

  notificar(destinatarios, {
    titulo: `${autor.nombre} · ${recorte(ticket.titulo, 60)}`,
    cuerpo: recorte(mensaje.contenido),
    datos: { ticket_id: ticket.id, tipo: 'mensaje' }
  }, autor.id);

  correo.enviar(correo.correosDe(destinatarios, autor.id), {
    asunto: `Respuesta en tu incidencia · ${recorte(ticket.titulo, 60)}`,
    titulo: `${autor.nombre} ha respondido`,
    lineas: [
      `<em>«${recorte(mensaje.contenido, 300)}»</em>`,
      'Puedes contestar desde la aplicación.'
    ],
    ticket
  });
}

const ESTADOS_LEGIBLES = {
  abierto: 'Abierta',
  pendiente: 'Pendiente',
  cerrado: 'Cerrada'
};

/**
 * Aviso de que a una incidencia le ha cambiado el estado.
 *
 * Va a quien tiene algo que esperar de ella: quien la abrió y el técnico que la
 * tiene asignada. Nunca a quien acaba de hacer el cambio, que ya lo sabe.
 */
function avisarEstado(ticket, anterior, autor) {
  if (!ticket || ticket.estado === anterior) return;

  const etiqueta = ESTADOS_LEGIBLES[ticket.estado] || ticket.estado;
  const cerrada = ticket.estado === 'cerrado';

  // También a todo el hilo: quien escribió en una avería quiere saber que se
  // ha resuelto, y hasta ahora solo se enteraban quien la abrió y el asignado.
  const destinatarios = implicadosEn(ticket);

  notificar(destinatarios, {
    titulo: `${etiqueta} · ${recorte(ticket.titulo, 60)}`,
    cuerpo: `${autor.nombre} ha pasado la incidencia a «${etiqueta.toLowerCase()}».`,
    datos: { ticket_id: ticket.id, tipo: 'estado' }
  }, autor.id);

  correo.enviar(correo.correosDe(destinatarios, autor.id), {
    asunto: cerrada
      ? `Incidencia resuelta · ${recorte(ticket.titulo, 60)}`
      : `Tu incidencia está ${etiqueta.toLowerCase()} · ${recorte(ticket.titulo, 60)}`,
    titulo: cerrada ? 'Tu incidencia se ha cerrado' : `Tu incidencia está ${etiqueta.toLowerCase()}`,
    lineas: cerrada
      ? [
          `<strong>${autor.nombre}</strong> ha dado por resuelta esta incidencia.`,
          'Si el problema sigue, contesta en el hilo y volvemos a abrirla.'
        ]
      : [`<strong>${autor.nombre}</strong> ha pasado la incidencia a «${etiqueta.toLowerCase()}».`],
    ticket
  });
}

module.exports = {
  implicadosEn,
  notificar,
  tecnicosDe,
  avisarTicketCreado,
  avisarMensaje,
  avisarEstado,
  avisarAsignacion,
  mensajeFCM,
  estado,
  probar,
  CANAL
};
