'use strict';

/**
 * Chat en tiempo real por local.
 *
 * Un canal por cada local, al estilo de los canales de IRC: quien está dado de
 * alta en el local está en su canal y no hay nada que crear ni que mantener.
 * Las reglas de quién entra en cada canal son las mismas con las que la
 * aplicación decide para qué locales se pueden abrir incidencias
 * (`auth.localesPermitidos`), así que no aparece aquí una segunda idea de «los
 * locales de alguien» que se pueda desviar de la primera.
 *
 * Por qué no un servidor de IRC de verdad. Lo que se pide —hablar desde la web
 * y desde el móvil, con fotos, vídeos y notas de voz, y saber si el mensaje ha
 * llegado y si alguien lo ha leído— no cabe en el protocolo: un navegador no
 * abre una conexión de IRC, IRC no guarda lo que se dijo mientras uno no
 * estaba, no transporta archivos ni tiene acuses de lectura, y haría falta un
 * segundo puerto abierto y una segunda forma de identificarse. Lo que se toma
 * de IRC es el modelo: canales permanentes por local, con la gente dentro por
 * pertenecer al local y no por haber sido invitada.
 *
 * Cómo viaja. Los mensajes salen por HTTP corriente (`POST`) y entran por un
 * flujo de eventos del servidor (`GET /api/chat/flujo`, SSE), que es lo que ya
 * habla el navegador sin librerías ni un puerto aparte y lo que atraviesa
 * cualquier proxy. Ese flujo solo avisa: la verdad está en la base y se pide
 * con las rutas normales. Así una desconexión no pierde nada —al volver se
 * piden los mensajes a partir del último que se tenía— y una red lenta como
 * mucho llega tarde.
 */

const path = require('path');
const fs = require('fs');
const express = require('express');
const db = require('./db');
const auth = require('./auth');
const notificaciones = require('./notificaciones');

const router = express.Router();

// ---------- Utilidades ----------

function num(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function texto(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function badRequest(res, msg) {
  return res.status(400).json({ error: msg });
}

/**
 * El nombre del canal, al estilo de IRC: `#local-1`.
 *
 * Es cosmético —el canal se identifica por el id del local— pero es lo que
 * hace que la pantalla se lea como un chat de canales y no como una lista de
 * fichas.
 */
function nombreCanal(nombreLocal) {
  const limpio = String(nombreLocal || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `#${limpio || 'local'}`;
}

// ---------- Quién está en cada canal ----------

/**
 * Los canales de este usuario: uno por cada local suyo.
 *
 * Es exactamente la lista de locales en los que puede abrir incidencias, con
 * las dos excepciones que ya rigen en toda la aplicación: el técnico que no
 * tiene ningún local marcado atiende todos, y el gestor y el administrador ven
 * el grupo entero.
 */
function canalesDe(user) {
  const permitidos = auth.localesPermitidos(user);
  if (!permitidos.length) return [];
  return db.prepare(`
    SELECT id AS local_id, nombre FROM locales
    WHERE id IN (${permitidos.map(() => '?').join(',')})
    ORDER BY orden, nombre
  `).all(...permitidos).map((l) => ({ ...l, canal: nombreCanal(l.nombre) }));
}

function puedeVer(user, localId) {
  return !!localId && auth.localesPermitidos(user).includes(localId);
}

/**
 * Quién está en el canal de un local. Es `auth.localesPermitidos` del revés:
 * en lugar de «qué locales son de esta persona», «qué personas son de este
 * local». Las cuentas bloqueadas se quedan fuera, que es lo que significa
 * estar bloqueado.
 */
function miembrosDe(localId) {
  return db.prepare(`
    SELECT u.id, u.nombre, u.rol FROM usuarios u
    WHERE u.bloqueada = 0 AND (
      u.rol IN ('admin', 'gestor')
      OR EXISTS (SELECT 1 FROM usuario_local ul
                 WHERE ul.usuario_id = u.id AND ul.local_id = ?)
      OR (u.rol = 'tecnico'
          AND NOT EXISTS (SELECT 1 FROM usuario_local ul WHERE ul.usuario_id = u.id))
    )
    ORDER BY u.nombre
  `).all(localId);
}

// ---------- El flujo de eventos ----------

// Quién tiene abierto el flujo ahora mismo: id de usuario → sus conexiones
// (una persona puede tener la web en dos pestañas y el móvil).
const conexiones = new Map();

// Ping periódico para que ningún proxy dé la conexión por muerta y la corte.
// Un comentario SSE (`:`) no llega a la aplicación: solo mueve bytes.
const LATIDO_MS = 20000;

function emitir(res, evento, datos) {
  try {
    res.write(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`);
  } catch (e) {
    // La conexión ya no está; el `close` la habrá quitado del mapa.
  }
}

function conexionesDe(usuarioIds) {
  const salida = [];
  for (const id of usuarioIds) {
    for (const res of conexiones.get(id) || []) salida.push(res);
  }
  return salida;
}

/**
 * Manda un evento a todo el canal.
 *
 * Los destinatarios se recalculan en cada envío en vez de guardarse al
 * conectar: si un administrador cambia los locales de alguien, el cambio vale
 * desde el mensaje siguiente y no desde la próxima vez que esa persona
 * recargue.
 */
function difundir(localId, evento, datos, { excepto = null } = {}) {
  const ids = miembrosDe(localId).map((m) => m.id).filter((id) => id !== excepto);
  for (const res of conexionesDe(ids)) emitir(res, evento, datos);
}

// Quién de los que están en el canal tiene el flujo abierto ahora mismo. Es el
// NAMES de IRC, y también lo que decide a quién hace falta avisar por push.
function conectadosDe(localId) {
  return miembrosDe(localId).filter((m) => conexiones.has(m.id));
}

function anunciarPresencia(localId) {
  difundir(localId, 'presencia', {
    local_id: localId,
    conectados: conectadosDe(localId).map((m) => ({ id: m.id, nombre: m.nombre }))
  });
}

/**
 * El flujo de eventos de una persona: uno solo para todos sus canales.
 *
 * No lleva el histórico: cuando el navegador vuelve a conectar recibe un
 * `sincroniza` y pide por HTTP lo que le falte desde el último mensaje que
 * tenía. Es lo que hace que da igual cuánto haya durado el corte.
 */
router.get('/flujo', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Nginx —y el proxy de AApanel— guardan la respuesta en un búfer hasta
    // tenerla entera, que con un flujo que no termina nunca significa que no
    // llega nada. Esta cabecera es la forma de decirles que no lo hagan.
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();
  // Un flujo no tiene por qué terminar: sin esto, el tiempo de espera del
  // servidor lo corta a los dos minutos.
  if (req.socket && req.socket.setTimeout) req.socket.setTimeout(0);

  const usuarioId = req.user.id;
  if (!conexiones.has(usuarioId)) conexiones.set(usuarioId, new Set());
  conexiones.get(usuarioId).add(res);

  const canales = canalesDe(req.user);
  // Lo primero que recibe: que se ponga al día. Vale para la primera conexión
  // y para la número cien después de un túnel.
  emitir(res, 'sincroniza', { canales: canales.map((c) => c.local_id) });
  for (const c of canales) anunciarPresencia(c.local_id);

  const latido = setInterval(() => {
    try { res.write(': latido\n\n'); } catch (e) { /* ya no está */ }
  }, LATIDO_MS);
  latido.unref();

  req.on('close', () => {
    clearInterval(latido);
    const suyas = conexiones.get(usuarioId);
    if (suyas) {
      suyas.delete(res);
      if (!suyas.size) conexiones.delete(usuarioId);
    }
    for (const c of canales) anunciarPresencia(c.local_id);
  });
});

// ---------- Mensajes ----------

// Cuántos mensajes trae una página del historial. Suficiente para llenar la
// pantalla y volver a pedir mientras se sube.
const PAGINA = 40;

const MENSAJE_SELECT = `
  SELECT m.id, m.local_id, m.autor_id, m.cliente_id, m.contenido, m.creado_en,
         m.borrado_en, u.nombre AS autor_nombre, u.rol AS autor_rol
  FROM chat_mensajes m JOIN usuarios u ON u.id = m.autor_id
`;

function adjuntosDe(mensajeIds) {
  if (!mensajeIds.length) return new Map();
  const filas = db.prepare(`
    SELECT id, mensaje_id, nombre, tipo, duracion FROM chat_adjuntos
    WHERE mensaje_id IN (${mensajeIds.map(() => '?').join(',')})
    ORDER BY id
  `).all(...mensajeIds);
  const por = new Map();
  for (const a of filas) {
    if (!por.has(a.mensaje_id)) por.set(a.mensaje_id, []);
    por.get(a.mensaje_id).push(a);
  }
  return por;
}

// Un mensaje borrado no enseña ni su texto ni sus adjuntos, pero sigue estando.
function comoSalida(fila, adjuntos) {
  if (fila.borrado_en) {
    return {
      id: fila.id,
      local_id: fila.local_id,
      autor_id: fila.autor_id,
      autor_nombre: fila.autor_nombre,
      autor_rol: fila.autor_rol,
      cliente_id: fila.cliente_id,
      contenido: '',
      creado_en: fila.creado_en,
      borrado: true,
      adjuntos: []
    };
  }
  return {
    id: fila.id,
    local_id: fila.local_id,
    autor_id: fila.autor_id,
    autor_nombre: fila.autor_nombre,
    autor_rol: fila.autor_rol,
    cliente_id: fila.cliente_id,
    contenido: fila.contenido,
    creado_en: fila.creado_en,
    borrado: false,
    adjuntos: adjuntos || []
  };
}

function leerMensaje(id) {
  const fila = db.prepare(`${MENSAJE_SELECT} WHERE m.id = ?`).get(id);
  if (!fila) return null;
  return comoSalida(fila, adjuntosDe([id]).get(id) || []);
}

function conAdjuntos(filas) {
  const adjuntos = adjuntosDe(filas.map((f) => f.id));
  return filas.map((f) => comoSalida(f, adjuntos.get(f.id) || []));
}

/**
 * Lo que se enseña de un mensaje cuando no cabe entero: la última línea de la
 * lista de canales y el cuerpo del aviso push.
 */
function resumenDe(mensaje) {
  if (mensaje.borrado) return 'Mensaje eliminado';
  if (mensaje.contenido) return mensaje.contenido.replace(/\s+/g, ' ').slice(0, 120);
  const adjunto = mensaje.adjuntos[0];
  if (!adjunto) return '';
  if (adjunto.tipo === 'imagen') return '📷 Foto';
  if (adjunto.tipo === 'video') return '🎬 Vídeo';
  if (adjunto.tipo === 'audio') return '🎤 Nota de voz';
  return `📎 ${adjunto.nombre}`;
}

// ---------- Recibido y leído ----------

function lecturaDe(localId, usuarioId) {
  return db.prepare(
    'SELECT recibido_hasta, leido_hasta FROM chat_lecturas WHERE local_id = ? AND usuario_id = ?'
  ).get(localId, usuarioId) || { recibido_hasta: 0, leido_hasta: 0 };
}

/**
 * Adelanta hasta dónde ha recibido o leído alguien en un canal.
 *
 * Los dos números solo pueden crecer: dos acuses que se cruzan por el camino no
 * pueden dejar el canal como «sin leer» otra vez. Leer implica haber recibido,
 * así que marcar lo leído arrastra lo recibido.
 */
function marcar(localId, usuarioId, { recibido = 0, leido = 0 }) {
  const tope = db.prepare(
    'SELECT COALESCE(MAX(id), 0) AS ultimo FROM chat_mensajes WHERE local_id = ?'
  ).get(localId).ultimo;
  const recibidoHasta = Math.min(Math.max(recibido, leido, 0), tope);
  const leidoHasta = Math.min(Math.max(leido, 0), tope);

  db.prepare(`
    INSERT INTO chat_lecturas (local_id, usuario_id, recibido_hasta, leido_hasta)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (local_id, usuario_id) DO UPDATE SET
      recibido_hasta = MAX(recibido_hasta, excluded.recibido_hasta),
      leido_hasta = MAX(leido_hasta, excluded.leido_hasta),
      actualizado_en = datetime('now')
  `).run(localId, usuarioId, recibidoHasta, leidoHasta);

  return lecturaDe(localId, usuarioId);
}

/**
 * Hasta dónde han llegado los demás en este canal.
 *
 * Con esto se pinta el estado de cada mensaje propio sin guardar un acuse por
 * mensaje y persona: el mensaje está recibido si su id no pasa del mayor
 * `recibido_hasta` ajeno, y leído si no pasa del mayor `leido_hasta`.
 */
function ajenas(localId, usuarioId) {
  return db.prepare(`
    SELECT l.usuario_id, u.nombre, l.recibido_hasta, l.leido_hasta
    FROM chat_lecturas l JOIN usuarios u ON u.id = l.usuario_id
    WHERE l.local_id = ? AND l.usuario_id <> ?
      AND (l.recibido_hasta > 0 OR l.leido_hasta > 0)
  `).all(localId, usuarioId);
}

// ---------- Lista de canales ----------

/**
 * Cuántos mensajes tiene sin leer en un canal. Lo de uno mismo no cuenta, y lo
 * borrado tampoco: un canal no puede quedarse en «1 sin leer» por un mensaje
 * que ya no se puede leer.
 */
function sinLeerDe(localId, usuarioId) {
  return db.prepare(`
    SELECT COUNT(*) AS n FROM chat_mensajes
    WHERE local_id = ? AND id > ? AND autor_id <> ? AND borrado_en IS NULL
  `).get(localId, lecturaDe(localId, usuarioId).leido_hasta, usuarioId).n;
}

router.get('/canales', (req, res) => {
  const canales = canalesDe(req.user);
  const ultimo = db.prepare(`${MENSAJE_SELECT} WHERE m.local_id = ? ORDER BY m.id DESC LIMIT 1`);

  res.json(canales.map((c) => {
    const lectura = lecturaDe(c.local_id, req.user.id);
    const fila = ultimo.get(c.local_id);
    const mensaje = fila ? conAdjuntos([fila])[0] : null;
    return {
      ...c,
      sin_leer: sinLeerDe(c.local_id, req.user.id),
      leido_hasta: lectura.leido_hasta,
      recibido_hasta: lectura.recibido_hasta,
      conectados: conectadosDe(c.local_id).length,
      ultimo: mensaje && {
        id: mensaje.id,
        autor_id: mensaje.autor_id,
        autor_nombre: mensaje.autor_nombre,
        creado_en: mensaje.creado_en,
        resumen: resumenDe(mensaje)
      }
    };
  }));
});

/**
 * Cuántos mensajes sin leer tiene en total, para el aviso de la barra de
 * navegación. Es la consulta que hacen todas las páginas cada medio minuto, así
 * que no trae nada más.
 */
router.get('/resumen', (req, res) => {
  let total = 0;
  const detalle = canalesDe(req.user).map((c) => {
    const n = sinLeerDe(c.local_id, req.user.id);
    total += n;
    return { local_id: c.local_id, sin_leer: n };
  });
  res.json({ sin_leer: total, canales: detalle });
});

function canalVisible(req, res) {
  const localId = num(req.params.localId);
  if (!localId || !puedeVer(req.user, localId)) {
    // 404 y no 403, igual que con las incidencias: quien no está en un canal
    // tampoco tiene por qué averiguar que existe.
    res.status(404).json({ error: 'Canal no encontrado.' });
    return null;
  }
  return localId;
}

/**
 * Los mensajes de un canal.
 *
 * - `desde`: lo que falta a partir de un mensaje que ya se tiene. Es lo que se
 *   pide al recuperar la conexión, y devuelve los mensajes en orden.
 * - `antes`: la página anterior, para seguir subiendo por el historial.
 */
router.get('/canales/:localId/mensajes', (req, res) => {
  const localId = canalVisible(req, res);
  if (!localId) return;

  const desde = num(req.query.desde);
  const antes = num(req.query.antes);
  const limite = Math.min(num(req.query.limite) || PAGINA, 200);

  let filas;
  if (desde) {
    filas = db.prepare(
      `${MENSAJE_SELECT} WHERE m.local_id = ? AND m.id > ? ORDER BY m.id LIMIT ?`
    ).all(localId, desde, limite);
  } else {
    filas = db.prepare(
      `${MENSAJE_SELECT} WHERE m.local_id = ?${antes ? ' AND m.id < ?' : ''} ORDER BY m.id DESC LIMIT ?`
    ).all(...(antes ? [localId, antes, limite] : [localId, limite])).reverse();
  }

  const local = db.prepare('SELECT id, nombre FROM locales WHERE id = ?').get(localId);
  const primero = db.prepare(
    'SELECT COALESCE(MIN(id), 0) AS id FROM chat_mensajes WHERE local_id = ?'
  ).get(localId).id;

  res.json({
    local_id: localId,
    nombre: local.nombre,
    canal: nombreCanal(local.nombre),
    mensajes: conAdjuntos(filas),
    // Si el más antiguo de la página es el más antiguo del canal, no hay más
    // historial que pedir hacia arriba. Poniéndose al día con `desde` no
    // significa nada: quien pregunta ya tiene lo anterior.
    hay_mas: !desde && !!(filas.length && filas[0].id > primero),
    miembros: miembrosDe(localId),
    conectados: conectadosDe(localId).map((m) => m.id),
    mia: lecturaDe(localId, req.user.id),
    ajenas: ajenas(localId, req.user.id)
  });
});

/**
 * Envía un mensaje.
 *
 * Es idempotente por `cliente_id`: quien no llegó a saber si su envío entró lo
 * repite tal cual y recibe el mensaje que ya había en vez de escribirlo dos
 * veces. Es lo que permite reintentar sin miedo en una red que va y viene.
 */
router.post('/canales/:localId/mensajes', (req, res) => {
  const localId = canalVisible(req, res);
  if (!localId) return;

  const clienteId = texto(req.body.cliente_id);
  if (!clienteId || clienteId.length > 64) {
    return badRequest(res, 'Falta el identificador del mensaje.');
  }

  const yaEstaba = db.prepare(
    'SELECT id FROM chat_mensajes WHERE autor_id = ? AND cliente_id = ?'
  ).get(req.user.id, clienteId);
  if (yaEstaba) return res.json(leerMensaje(yaEstaba.id));

  const contenido = texto(req.body.contenido).slice(0, 4000);
  const borradores = [...new Set((req.body.adjuntos || []).map(Number).filter(Boolean))];
  if (!contenido && !borradores.length) {
    return badRequest(res, 'El mensaje no puede estar vacío.');
  }

  const info = db.prepare(
    'INSERT INTO chat_mensajes (local_id, autor_id, cliente_id, contenido) VALUES (?, ?, ?, ?)'
  ).run(localId, req.user.id, clienteId, contenido);
  const mensajeId = info.lastInsertRowid;

  const adoptados = adoptarBorradores(borradores, { localId, mensajeId, usuarioId: req.user.id });
  // Un mensaje que era solo un archivo y cuyo archivo se perdió por el camino
  // no se queda como un globo vacío.
  if (!contenido && !adoptados) {
    db.prepare('DELETE FROM chat_mensajes WHERE id = ?').run(mensajeId);
    return badRequest(res, 'El archivo ya no estaba en el servidor. Vuelve a adjuntarlo.');
  }

  // Quien escribe ha leído por definición todo lo que había hasta ahora.
  marcar(localId, req.user.id, { leido: mensajeId });

  const mensaje = leerMensaje(mensajeId);
  difundir(localId, 'mensaje', mensaje);
  avisar(localId, mensaje, req.user);
  res.status(201).json(mensaje);
});

/**
 * Borra un mensaje propio. El administrador puede borrar cualquiera, que es lo
 * que hace falta cuando alguien sube por error algo que no debía.
 */
router.delete('/mensajes/:id', (req, res) => {
  const id = num(req.params.id);
  const fila = id && db.prepare('SELECT * FROM chat_mensajes WHERE id = ?').get(id);
  if (!fila || !puedeVer(req.user, fila.local_id)) {
    return res.status(404).json({ error: 'Mensaje no encontrado.' });
  }
  if (fila.autor_id !== req.user.id && req.user.rol !== 'admin') {
    return res.status(403).json({ error: 'Solo puedes eliminar tus propios mensajes.' });
  }
  if (!fila.borrado_en) {
    for (const a of db.prepare('SELECT * FROM chat_adjuntos WHERE mensaje_id = ?').all(id)) {
      try {
        fs.unlinkSync(path.join(carpetaDe(fila.local_id), a.archivo));
      } catch (e) { /* ya no estaba */ }
    }
    db.prepare('DELETE FROM chat_adjuntos WHERE mensaje_id = ?').run(id);
    db.prepare("UPDATE chat_mensajes SET borrado_en = datetime('now'), contenido = '' WHERE id = ?")
      .run(id);
  }
  const mensaje = leerMensaje(id);
  difundir(fila.local_id, 'borrado', mensaje);
  res.json(mensaje);
});

// Acuse de recibo: el mensaje ha llegado al aparato, aunque nadie lo esté
// mirando. Lo manda el propio navegador en cuanto lo recibe por el flujo.
router.post('/canales/:localId/recibido', (req, res) => {
  const localId = canalVisible(req, res);
  if (!localId) return;
  const hasta = Number(req.body.hasta) || 0;
  const lectura = marcar(localId, req.user.id, { recibido: hasta });
  difundir(localId, 'acuses', { local_id: localId, usuario_id: req.user.id, ...lectura });
  res.json(lectura);
});

// Acuse de lectura: el canal está abierto y en pantalla.
router.post('/canales/:localId/leido', (req, res) => {
  const localId = canalVisible(req, res);
  if (!localId) return;
  const hasta = Number(req.body.hasta) || 0;
  const lectura = marcar(localId, req.user.id, { leido: hasta });
  difundir(localId, 'acuses', { local_id: localId, usuario_id: req.user.id, ...lectura });
  res.json(lectura);
});

/**
 * «Fulano está escribiendo…». No se guarda en ninguna parte: si no hay nadie
 * conectado, no ha pasado nada.
 */
router.post('/canales/:localId/escribiendo', (req, res) => {
  const localId = canalVisible(req, res);
  if (!localId) return;
  difundir(localId, 'escribiendo', {
    local_id: localId,
    usuario_id: req.user.id,
    nombre: req.user.nombre
  }, { excepto: req.user.id });
  res.json({ ok: true });
});

// ---------- Avisos ----------

/**
 * Avisa por push a quien no tiene el chat abierto.
 *
 * A quien está conectado no se le avisa: ya le ha llegado el mensaje por el
 * flujo y el teléfono no tiene por qué sonar dos veces. Los correos se quedan
 * fuera a propósito: un chat de local son muchos mensajes al día y el buzón no
 * es sitio para eso.
 */
function avisar(localId, mensaje, autor) {
  const local = db.prepare('SELECT nombre FROM locales WHERE id = ?').get(localId);
  const destinatarios = miembrosDe(localId)
    .filter((m) => m.id !== autor.id && !conexiones.has(m.id))
    .map((m) => m.id);
  if (!destinatarios.length) return;

  notificaciones.notificar(destinatarios, {
    titulo: `${nombreCanal(local.nombre)} · ${local.nombre}`,
    cuerpo: `${autor.nombre}: ${resumenDe(mensaje)}`,
    datos: { tipo: 'chat', local_id: localId, mensaje_id: mensaje.id }
  }, autor.id);
}

// ---------- Archivos ----------

const CHAT_DIR = path.join(db.carpetaDatos, 'chat');
const BORRADORES_DIR = path.join(CHAT_DIR, 'borrador');

// Los mismos topes que los adjuntos de una incidencia. El audio va aparte: una
// nota de voz en Opus ocupa poco más de un kilobyte por segundo, así que 20 MB
// son horas de grabación y sirven de tope de cordura.
const MAX_ARCHIVO = 10 * 1024 * 1024;
const MAX_VIDEO = 120 * 1024 * 1024;
const MAX_AUDIO = 20 * 1024 * 1024;

/**
 * Formatos admitidos. Son los mismos de los adjuntos de una incidencia más el
 * audio de las notas de voz.
 *
 * `.weba` no es una extensión que exista en ninguna parte: es la que se le pone
 * aquí al WebM que graba el navegador cuando solo lleva sonido, porque `.webm`
 * ya significa vídeo en esta tabla y del nombre del archivo depende con qué
 * tipo se sirve después.
 */
const TIPOS = {
  '.pdf': ['application/pdf', 'documento'],
  '.jpg': ['image/jpeg', 'imagen'],
  '.jpeg': ['image/jpeg', 'imagen'],
  '.png': ['image/png', 'imagen'],
  '.webp': ['image/webp', 'imagen'],
  '.gif': ['image/gif', 'imagen'],
  '.heic': ['image/heic', 'imagen'],
  '.txt': ['text/plain', 'documento'],
  '.doc': ['application/msword', 'documento'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'documento'],
  '.xls': ['application/vnd.ms-excel', 'documento'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'documento'],
  '.webm': ['video/webm', 'video'],
  '.mp4': ['video/mp4', 'video'],
  '.mov': ['video/quicktime', 'video'],
  '.m4v': ['video/x-m4v', 'video'],
  '.3gp': ['video/3gpp', 'video'],
  '.weba': ['audio/webm', 'audio'],
  '.m4a': ['audio/mp4', 'audio'],
  '.mp3': ['audio/mpeg', 'audio'],
  '.ogg': ['audio/ogg', 'audio'],
  '.oga': ['audio/ogg', 'audio'],
  '.wav': ['audio/wav', 'audio']
};

const FORMATOS = 'fotos, vídeos, notas de voz, PDF, Word, Excel y texto';

function topeDe(tipo) {
  if (tipo === 'video') return MAX_VIDEO;
  if (tipo === 'audio') return MAX_AUDIO;
  return MAX_ARCHIVO;
}

function enMegas(bytes) {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function nombreSeguro(s, porDefecto) {
  const limpio = String(s == null ? '' : s)
    .replace(/[\\/]/g, '-')
    .replace(/[:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .trim();
  return limpio.slice(0, 80) || porDefecto;
}

function carpetaDe(localId) {
  return path.join(CHAT_DIR, String(localId));
}

// Un borrador que nadie llegó a mandar —se cerró la pestaña a medias— no puede
// quedarse ocupando disco para siempre.
const HORAS_BORRADOR = 24;

function limpiarBorradores() {
  const viejos = db.prepare(
    `SELECT id, archivo FROM chat_borradores
     WHERE creado_en < datetime('now', '-${HORAS_BORRADOR} hours')`
  ).all();
  for (const b of viejos) {
    try {
      fs.unlinkSync(path.join(BORRADORES_DIR, b.archivo));
    } catch (e) { /* ya no estaba */ }
  }
  if (viejos.length) {
    db.prepare(
      `DELETE FROM chat_borradores WHERE id IN (${viejos.map(() => '?').join(',')})`
    ).run(...viejos.map((b) => b.id));
  }
}

/**
 * Sube un archivo antes de que exista el mensaje que lo lleva.
 *
 * Igual que con los adjuntos de una incidencia: primero sube el archivo y solo
 * después se manda el mensaje con su identificador. Así un envío que se corta a
 * la mitad no deja un globo roto en la conversación de todo el local, y el
 * reintento no vuelve a subir lo que ya estaba.
 */
router.post('/borradores', express.raw({ type: '*/*', limit: MAX_VIDEO }), (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) {
    return badRequest(res, 'No se ha recibido ningún archivo.');
  }
  const original = nombreSeguro(req.query.nombre, 'archivo');
  const extension = path.extname(original).toLowerCase();
  if (!TIPOS[extension]) {
    return badRequest(res, `Formato no admitido: se pueden mandar ${FORMATOS}.`);
  }
  const clase = TIPOS[extension][1];
  if (req.body.length > topeDe(clase)) {
    return res.status(413).json({
      error: `El archivo no puede superar los ${enMegas(topeDe(clase))}.`
    });
  }
  // Los segundos que dura una nota de voz o un vídeo los mide quien graba: el
  // servidor no abre el archivo para averiguarlo.
  const duracion = Math.min(Math.round(Number(req.query.duracion) || 0), 24 * 3600) || null;

  fs.mkdirSync(BORRADORES_DIR, { recursive: true });
  const info = db.prepare(`
    INSERT INTO chat_borradores (usuario_id, archivo, nombre, tipo, duracion)
    VALUES (?, '', ?, ?, ?)
  `).run(req.user.id, original, clase, duracion);

  const archivo = `${info.lastInsertRowid}${extension}`;
  fs.writeFileSync(path.join(BORRADORES_DIR, archivo), req.body);
  db.prepare('UPDATE chat_borradores SET archivo = ? WHERE id = ?')
    .run(archivo, info.lastInsertRowid);

  res.status(201).json({
    id: info.lastInsertRowid, nombre: original, tipo: clase, duracion
  });
});

router.delete('/borradores/:id', (req, res) => {
  const id = num(req.params.id);
  const fila = id && db.prepare(
    'SELECT * FROM chat_borradores WHERE id = ? AND usuario_id = ?'
  ).get(id, req.user.id);
  if (!fila) return res.status(404).json({ error: 'Borrador no encontrado.' });
  try {
    fs.unlinkSync(path.join(BORRADORES_DIR, fila.archivo));
  } catch (e) { /* ya no estaba */ }
  db.prepare('DELETE FROM chat_borradores WHERE id = ?').run(id);
  res.json({ ok: true });
});

/**
 * Cuelga del mensaje los borradores indicados y devuelve cuántos han entrado.
 * Los que no existan o sean de otra persona se ignoran en silencio: son restos
 * de una pantalla que se quedó a medias.
 */
function adoptarBorradores(ids, { localId, mensajeId, usuarioId }) {
  if (!ids.length) return 0;
  const filas = db.prepare(`
    SELECT * FROM chat_borradores
    WHERE usuario_id = ? AND id IN (${ids.map(() => '?').join(',')})
    ORDER BY id
  `).all(usuarioId, ...ids);
  if (!filas.length) return 0;

  const carpeta = carpetaDe(localId);
  fs.mkdirSync(carpeta, { recursive: true });

  let movidos = 0;
  for (const b of filas) {
    const extension = path.extname(b.archivo);
    const info = db.prepare(`
      INSERT INTO chat_adjuntos (mensaje_id, archivo, nombre, tipo, duracion)
      VALUES (?, '', ?, ?, ?)
    `).run(mensajeId, b.nombre, b.tipo, b.duracion);

    const destino = `${info.lastInsertRowid}${extension}`;
    try {
      fs.renameSync(path.join(BORRADORES_DIR, b.archivo), path.join(carpeta, destino));
    } catch (e) {
      db.prepare('DELETE FROM chat_adjuntos WHERE id = ?').run(info.lastInsertRowid);
      continue;
    }
    db.prepare('UPDATE chat_adjuntos SET archivo = ? WHERE id = ?').run(destino, info.lastInsertRowid);
    movidos += 1;
  }

  db.prepare(
    `DELETE FROM chat_borradores WHERE id IN (${filas.map(() => '?').join(',')})`
  ).run(...filas.map((b) => b.id));

  return movidos;
}

// Un archivo del chat se ve si se está en el canal del que cuelga.
router.get('/adjuntos/:id', (req, res) => {
  const id = num(req.params.id);
  const adjunto = id && db.prepare(`
    SELECT a.*, m.local_id FROM chat_adjuntos a
    JOIN chat_mensajes m ON m.id = a.mensaje_id
    WHERE a.id = ?
  `).get(id);
  if (!adjunto || !puedeVer(req.user, adjunto.local_id)) {
    return res.status(404).json({ error: 'Archivo no encontrado.' });
  }
  const absoluto = path.join(carpetaDe(adjunto.local_id), adjunto.archivo);
  if (!fs.existsSync(absoluto)) {
    return res.status(404).json({ error: 'El archivo ya no está en el servidor.' });
  }
  const tipo = TIPOS[path.extname(adjunto.archivo).toLowerCase()];
  res.setHeader('Content-Type', (tipo && tipo[0]) || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(adjunto.nombre)}`);
  res.sendFile(absoluto);
});

// ---------- Arranque ----------

// Los borradores caducados se barren al arrancar y una vez por hora, igual que
// los de las incidencias.
function arrancar() {
  limpiarBorradores();
  setInterval(limpiarBorradores, 60 * 60 * 1000).unref();
}

// Al borrar un local se lleva por delante su carpeta de archivos; sus filas se
// van solas por las claves foráneas.
function borrarCanal(localId) {
  fs.rmSync(carpetaDe(localId), { recursive: true, force: true });
}

module.exports = {
  router,
  arrancar,
  borrarCanal
};
