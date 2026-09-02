'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const db = require('./db');
const auth = require('./auth');
const planificacion = require('./planificacion');
const programador = require('./programador');
const notificaciones = require('./notificaciones');
const correo = require('./correo');
const entra = require('./entra');
const chat = require('./chat');
const organizacion = require('./organizacion');

const app = express();
const PORT = process.env.PORT || 3004;

auth.seedAdmin();

app.use(express.json());
// Red de seguridad del programador: si su reloj no llegara a servirse, las
// tareas vencidas se abren igualmente en cuanto alguien usa la aplicación.
app.use(programador.middlewareRepaso);
app.use(auth.middlewareSesion);
app.use(auth.middlewareAcceso);
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Lo que Android pide para abrir los enlaces de los correos en la app en lugar
 * de en el navegador.
 *
 * Hace falta la huella SHA-256 del certificado con el que se firma el APK, en
 * `data/assetlinks.json` o en la variable `HUELLA_APP`. Sin ella la ruta
 * responde una lista vacía: los enlaces seguirán funcionando, solo que Android
 * preguntará si abrirlos con la app o con el navegador.
 *
 *   keytool -list -v -keystore mi.jks -alias incidencias | grep SHA256
 */
app.get('/.well-known/assetlinks.json', (req, res) => {
  const huella = texto(process.env.HUELLA_APP);
  let huellas = huella ? [huella] : [];

  if (!huellas.length) {
    try {
      const guardadas = JSON.parse(
        fs.readFileSync(path.join(db.carpetaDatos, 'assetlinks.json'), 'utf8')
      );
      if (Array.isArray(guardadas)) huellas = guardadas.filter(Boolean);
    } catch (e) { /* sin huellas configuradas */ }
  }

  res.json(huellas.length ? [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: PAQUETE_APP,
      sha256_cert_fingerprints: huellas
    }
  }] : []);
});

/**
 * Lo mismo para el iPhone: los «universal links».
 *
 * Aquí no hay huella del certificado, sino el identificador del equipo de la
 * cuenta de Apple Developer —diez letras y números, en la esquina de
 * developer.apple.com—, en `data/equipo-apple.json` o en la variable
 * `EQUIPO_APP`. Sin él la ruta responde una lista vacía: los enlaces de los
 * correos seguirán abriéndose en Safari.
 *
 * A diferencia de Android, iOS **no pregunta**: o el archivo está y la app se
 * abre sola, o no está y no se abre nunca. Y lo lee Apple, no el teléfono, así
 * que un cambio aquí tarda en notarse; en pruebas se usa el modo de desarrollo
 * de los dominios asociados, que va directo contra el servidor.
 */
app.get('/.well-known/apple-app-site-association', (req, res) => {
  let equipo = texto(process.env.EQUIPO_APP);
  if (!equipo) {
    try {
      const guardado = JSON.parse(
        fs.readFileSync(path.join(db.carpetaDatos, 'equipo-apple.json'), 'utf8')
      );
      equipo = texto(typeof guardado === 'string' ? guardado : guardado.equipo);
    } catch (e) { /* sin equipo configurado */ }
  }

  // Apple exige este tipo, y el archivo no lleva extensión: si un proxy lo
  // sirviera como texto plano, iOS lo descartaría sin decir nada.
  res.type('application/json');
  res.json({
    applinks: {
      details: equipo ? [{
        appIDs: [`${equipo}.${PAQUETE_APP}`],
        // `components` es lo de iOS 13 en adelante; `paths`, lo que entienden
        // los anteriores. Los dos dicen lo mismo: la ficha de una incidencia.
        components: [{ '/': '/ticket.html', '?': { id: '?*' } }],
        paths: ['/ticket.html*']
      }] : []
    }
  });
});

// El identificador de la app en las dos tiendas: es el mismo en Android y en
// iOS, y lo piden los dos archivos que enlazan el dominio con la aplicación.
//
// Tiene que coincidir con el de `movil/`: si allí se cambia —y hay que
// cambiarlo antes de publicar nada— se cambia aquí, o los enlaces de los
// correos dejarán de abrir la app. La variable `PAQUETE_APP` lo permite sin
// tocar el código.
const PAQUETE_APP = process.env.PAQUETE_APP || 'com.ejemplo.soporte';

const ESTADOS = ['abierto', 'pendiente', 'cerrado'];
const PRIORIDADES = ['urgente', 'normal', 'cuando_se_pueda'];
const ROLES = ['usuario', 'empleado', 'tecnico', 'gestor', 'admin'];
// Con qué se da de alta a alguien si no se dice otra cosa. Viven en `auth.js`
// porque también los usa el alta que hace sola la entrada con Office 365.
const { ROL_POR_DEFECTO, LOCAL_POR_DEFECTO } = auth;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function texto(v) {
  return String(v == null ? '' : v).trim();
}

function badRequest(res, msg) {
  return res.status(400).json({ error: msg });
}

// SQLite solo ignora las mayúsculas del ASCII, así que el buscador compara
// sobre este texto normalizado: sin acentos y en minúsculas.
function normalizar(v) {
  return String(v == null ? '' : v)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}
db.function('normaliza', { deterministic: true }, normalizar);

// ---------- Sesión ----------

app.post('/api/login', (req, res) => {
  // Se admite el correo —que es el acceso de las cuentas nuevas— y también el
  // nombre de usuario de siempre, para no dejar fuera a las de antes.
  const usuario = texto(req.body.usuario).toLowerCase();
  const password = String(req.body.password || '');
  const fila = auth.buscarCuenta(usuario);
  if (!fila) return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });

  if (fila.bloqueada) {
    return res.status(403).json({ error: auth.MENSAJE_BLOQUEADA, bloqueada: true });
  }
  // Los intentos hechos durante una espera no cuentan: si contaran, insistir
  // sin parar agotaría los diez intentos y bloquearía la cuenta al momento.
  const espera = auth.segundosDeEspera(fila);
  if (espera) {
    return res.status(429).json({ error: auth.mensajeEspera(espera), espera });
  }

  if (!auth.verifyPassword(password, fila.password_hash)) {
    const castigo = auth.registrarFallo(fila);
    if (castigo.bloqueada) {
      return res.status(403).json({ error: auth.MENSAJE_BLOQUEADA, bloqueada: true });
    }
    if (castigo.espera) {
      return res.status(429).json({ error: auth.mensajeEspera(castigo.espera), espera: castigo.espera });
    }
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }

  auth.limpiarIntentos(fila.id);
  const token = auth.crearSesion(fila.id);
  auth.setCookie(res, token);
  // La web usa la cookie y no mira el token; la app móvil se queda con él y lo
  // manda en la cabecera Authorization.
  //
  // `puedeCrear` va aquí igual que en `/api/session`: si faltara, la app
  // recién iniciada la sesión creería que este usuario no puede abrir
  // incidencias y le escondería el botón hasta el siguiente arranque.
  const cuenta = auth.cargarUsuario(fila.id);
  res.json({ ...cuenta, puedeCrear: auth.puedeCrearTickets(cuenta), token });
});

app.post('/api/logout', (req, res) => {
  // Al cerrar sesión desde el móvil, el dispositivo deja de recibir avisos.
  if (req.user && texto(req.body && req.body.token_push)) {
    db.prepare('DELETE FROM dispositivos WHERE usuario_id = ? AND token_push = ?')
      .run(req.user.id, texto(req.body.token_push));
  }
  auth.borrarSesion(req.sessionToken);
  auth.clearCookie(res);
  res.json({ ok: true });
});

// ---------- Entrar con Office 365 ----------

// Los tropiezos de la ida y la vuelta se cuentan en la propia pantalla de
// acceso: es donde está la persona y donde tiene el usuario y la contraseña
// para entrar de todas formas.
function vuelvePorLaPuerta(res, mensaje) {
  res.redirect(`/login.html?error=${encodeURIComponent(mensaje)}`);
}

const NO_SE_PUDO = 'No se ha podido entrar con Office 365. Prueba otra vez o entra con tu contraseña.';

/**
 * Si la pantalla de acceso enseña el botón.
 *
 * `movil` dice que este servidor sabe terminar la entrada de la app, con su
 * vale. Va suelto de `activo` a propósito: una app nueva contra un servidor
 * anterior a esto vería el botón, abriría el navegador y dejaría a esa persona
 * dentro de la web sin que la app llegara a enterarse. Prefiriendo no enseñar
 * el botón, al menos se entiende lo que pasa.
 */
app.get('/api/entra/estado', (req, res) => {
  res.json({ activo: entra.activo(), movil: true });
});

// La app móvil llega aquí con `?app=` y su reto: el resto del recorrido es el
// mismo, y solo cambia por dónde sale al final.
app.get('/api/entra/entrar', async (req, res) => {
  if (!entra.activo()) {
    return vuelvePorLaPuerta(res, 'El acceso con Office 365 no está configurado.');
  }
  const retoApp = texto(req.query.app);
  if (retoApp && !entra.retoValido(retoApp)) {
    return vuelvePorLaPuerta(res, NO_SE_PUDO);
  }
  try {
    const { url, estado } = await entra.comenzar(entra.direccionDeVuelta(req), retoApp);
    entra.marcarIntento(res, estado);
    res.redirect(url);
  } catch (e) {
    console.error('Office 365: no se pudo empezar la entrada.', e);
    vuelvePorLaPuerta(res, NO_SE_PUDO);
  }
});

// Aquí devuelve Microsoft a la persona, con el código o con un motivo por el
// que no lo hay: lo más habitual, que se haya arrepentido o que un
// administrador no haya dado el consentimiento.
app.get('/api/entra/vuelta', async (req, res) => {
  if (!entra.activo()) {
    return vuelvePorLaPuerta(res, 'El acceso con Office 365 no está configurado.');
  }
  if (req.query.error) {
    const detalle = texto(req.query.error_description) || texto(req.query.error);
    console.error(`Office 365: Microsoft no completó la entrada — ${detalle}`);
    return vuelvePorLaPuerta(res, 'Microsoft no ha completado la entrada. Prueba otra vez.');
  }
  try {
    const { datos, app: retoApp } = await entra.completar({
      codigo: req.query.code,
      estado: texto(req.query.state),
      estadoCookie: entra.intentoDe(req),
      direccion: entra.direccionDeVuelta(req)
    });
    const cuenta = entra.cuentaDe(datos);
    // La espera por intentos fallidos es de la contraseña, así que no estorba
    // aquí; el bloqueo de la cuenta sí, y lo mira `cuentaDe`.

    // Esto pasa en el navegador del teléfono, no dentro de la app: la sesión
    // no se le puede dar aquí, así que sale con un vale que ella canjea.
    if (retoApp) {
      const vale = entra.valeParaApp(cuenta.id, retoApp);
      entra.olvidarIntento(res);
      return res.redirect(`/entra-movil.html?vale=${encodeURIComponent(vale)}`);
    }

    const token = auth.crearSesion(cuenta.id);
    // Este orden importa: la cookie de sesión se pone con `setHeader` y
    // borraría la del intento si fuera al revés.
    auth.setCookie(res, token);
    entra.olvidarIntento(res);
    res.redirect('/');
  } catch (e) {
    console.error('Office 365: no se pudo terminar la entrada.', e);
    vuelvePorLaPuerta(res, e.visible ? e.message : NO_SE_PUDO);
  }
});

/**
 * El canje de la app: el vale del enlace, por el token de sesión.
 *
 * Contesta lo mismo que `POST /api/login`, para que la app siga a partir de
 * aquí por donde ya sabe.
 */
app.post('/api/entra/movil', (req, res) => {
  if (!entra.activo()) {
    return res.status(404).json({ error: 'El acceso con Office 365 no está configurado.' });
  }
  let cuenta;
  try {
    cuenta = entra.cuentaDelVale(texto(req.body.vale), texto(req.body.verificador));
  } catch (e) {
    if (!e.visible) console.error('Office 365: no se pudo canjear el vale.', e);
    return res.status(401).json({ error: e.visible ? e.message : NO_SE_PUDO });
  }
  const token = auth.crearSesion(cuenta.id);
  const datos = auth.cargarUsuario(cuenta.id);
  res.json({ ...datos, puedeCrear: auth.puedeCrearTickets(datos), token });
});

// ---------- Restablecer la contraseña ----------

/**
 * Pide un correo para volver a entrar.
 *
 * Responde lo mismo exista la cuenta o no: si dijera «ese correo no está»,
 * cualquiera podría averiguar quién tiene cuenta probando direcciones.
 */
app.post('/api/recuperar', (req, res) => {
  const identificador = texto(req.body.usuario).toLowerCase();
  const cuenta = identificador && auth.buscarCuenta(identificador);

  if (cuenta && cuenta.email) {
    const vale = auth.crearVale(cuenta.id);
    correo.enviarRestablecimiento(cuenta, vale);
  }

  res.json({
    ok: true,
    mensaje: 'Si esa cuenta existe y tiene correo, le llegará un enlace para cambiar la contraseña.'
  });
});

// Comprueba que el vale del correo sigue valiendo, antes de pedir la contraseña.
app.get('/api/restablecer', (req, res) => {
  const vale = texto(req.query.vale);
  res.json({ valido: Boolean(auth.cuentaDelVale(vale)) });
});

app.post('/api/restablecer', (req, res) => {
  const vale = texto(req.body.vale);
  const password = String(req.body.password || '');
  if (password.length < 8) {
    return badRequest(res, 'La contraseña debe tener al menos 8 caracteres.');
  }
  if (!auth.restablecer(vale, password)) {
    return badRequest(res, 'El enlace ya no vale. Pide otro desde la pantalla de acceso.');
  }
  res.json({ ok: true });
});

// Con qué nombre se presenta esta instalación. Va sin sesión porque la
// pantalla de acceso también lo pinta, y de aquí sale además el correo al que
// se escribe para ejercer los derechos de protección de datos.
app.get('/api/organizacion', (req, res) => {
  res.json(organizacion.paraLaWeb());
});

app.get('/api/session', (req, res) => {
  res.json({ ...req.user, puedeCrear: auth.puedeCrearTickets(req.user) });
});

// ---------- Meta ----------

// Todo lo que necesitan los desplegables de una pantalla, en una sola llamada.
app.get('/api/meta', (req, res) => {
  const grupos = db.prepare('SELECT id, nombre FROM grupos ORDER BY orden, nombre').all();
  const locales = db.prepare('SELECT id, nombre FROM locales ORDER BY orden, nombre').all();
  const areas = db.prepare('SELECT id, nombre FROM areas ORDER BY orden, nombre').all();
  // Con su area_id/familia_id, para que los desplegables de familia y
  // subfamilia se filtren según lo elegido sin pedir nada más al servidor.
  const familias = db.prepare('SELECT id, nombre, area_id FROM familias ORDER BY orden, nombre').all();
  const subfamilias = db.prepare('SELECT id, nombre, familia_id FROM subfamilias ORDER BY orden, nombre').all();
  // Para el desplegable de mantenimiento externo del programador de tareas.
  const empresas = db.prepare('SELECT id, nombre FROM empresas ORDER BY orden, nombre').all();
  // Para el formulario de lavandería: qué prendas se pueden contar.
  const prendasLavanderia = db.prepare('SELECT id, nombre FROM prendas_lavanderia ORDER BY orden, nombre').all();
  // Para elegir un activo al abrir una incidencia: con su departamento, para
  // que el desplegable se filtre según lo elegido sin pedir nada más al
  // servidor, igual que familias y subfamilias.
  const activos = db.prepare(`
    SELECT id, nombre, estado, local_id, grupo_id FROM activos ORDER BY nombre
  `).all();
  const permitidos = auth.localesPermitidos(req.user);

  // Técnicos entre los que se reparte el trabajo, para el desplegable de
  // asignación de cada incidencia.
  const tecnicos = db.prepare(`
    SELECT u.id, u.nombre, u.grupo_id FROM usuarios u
    WHERE u.rol = 'tecnico' AND u.bloqueada = 0 ORDER BY u.nombre
  `).all();

  // Quién aparece en el filtro de los informes: los técnicos dados de alta,
  // más cualquiera que tenga incidencias asignadas aunque hoy tenga otro rol.
  // Un técnico solo se ve a sí mismo: los informes de sus compañeros no son
  // cosa suya.
  const propio = auth.tecnicoDeLosInformes(req.user);
  const tecnicosInformes = propio
    ? db.prepare('SELECT id, nombre FROM usuarios WHERE id = ?').all(propio)
    : db.prepare(`
        SELECT id, nombre FROM usuarios WHERE rol = 'tecnico'
        UNION
        SELECT u.id, u.nombre FROM usuarios u
        WHERE EXISTS (SELECT 1 FROM tickets t WHERE t.asignado_a = u.id)
        ORDER BY nombre
      `).all();

  // A nombre de quién se puede abrir una incidencia. Solo lo usan técnicos,
  // gestores y administradores; a los demás ni se les ofrece.
  const enNombreDe = auth.puedeAbrirEnNombreDe(req.user)
    ? db.prepare(`
        SELECT u.id, u.nombre, u.rol FROM usuarios u
        WHERE u.bloqueada = 0 AND u.rol IN ('usuario', 'empleado', 'tecnico', 'gestor', 'admin')
        ORDER BY u.nombre
      `).all()
    : [];

  res.json({
    grupos,
    locales,
    areas,
    familias,
    subfamilias,
    empresas,
    prendasLavanderia,
    activos,
    // Los locales para los que este usuario puede abrir incidencias, y los
    // mismos para los que puede registrar lavandería.
    localesPropios: locales.filter((l) => permitidos.includes(l.id)),
    tecnicos,
    enNombreDe,
    puedeAbrirEnNombreDe: auth.puedeAbrirEnNombreDe(req.user),
    tecnicosInformes,
    puedeProgramar: auth.puedeProgramar(req.user),
    puedeVerCalendario: auth.puedeVerCalendario(req.user),
    puedeVerInformes: auth.puedeVerInformes(req.user),
    puedeUsarLavanderia: auth.puedeUsarLavanderia(req.user),
    puedeUsarInventario: auth.puedeUsarInventario(req.user),
    // El técnico tiene sus informes fijados a sí mismo.
    tecnicoFijado: propio,
    estados: ESTADOS,
    prioridades: PRIORIDADES,
    puedeCrear: auth.puedeCrearTickets(req.user)
  });
});

// ---------- Incidencias ----------

// Los mismos roles que «gestionan» en auth.js, en SQL: quien no está en esta
// lista está en el lado de quien reporta la avería, sea «usuario» o «empleado».
const GESTIONAN_SQL = auth.GESTIONAN.map((r) => `'${r}'`).join(',');

const TICKET_SELECT = `
  SELECT t.*, g.nombre AS grupo_nombre, l.nombre AS local_nombre,
         ar.nombre AS area_nombre, f.nombre AS familia_nombre, sf.nombre AS subfamilia_nombre,
         a.nombre AS asignado_nombre, c.nombre AS creador_nombre,
         ta.nombre AS tarea_nombre, e.nombre AS empresa_nombre, act.nombre AS activo_nombre,
         (SELECT COUNT(*) FROM mensajes m WHERE m.ticket_id = t.id) AS mensajes,
         (SELECT COUNT(*) FROM adjuntos ad WHERE ad.ticket_id = t.id) AS adjuntos,
         (SELECT u.rol FROM mensajes m JOIN usuarios u ON u.id = m.autor_id
           WHERE m.ticket_id = t.id
           ORDER BY m.creado_en DESC, m.id DESC LIMIT 1) AS ultimo_rol,
         (SELECT COUNT(*) FROM mensajes m JOIN usuarios u ON u.id = m.autor_id
           WHERE m.ticket_id = t.id AND u.rol NOT IN (${GESTIONAN_SQL})) AS mensajes_empleado,
         (SELECT COUNT(*) FROM mensajes m JOIN usuarios u ON u.id = m.autor_id
           WHERE m.ticket_id = t.id AND u.rol IN (${GESTIONAN_SQL})) AS mensajes_tecnico
  FROM tickets t
  JOIN grupos g ON g.id = t.grupo_id
  JOIN locales l ON l.id = t.local_id
  LEFT JOIN areas ar ON ar.id = t.area_id
  LEFT JOIN familias f ON f.id = t.familia_id
  LEFT JOIN subfamilias sf ON sf.id = t.subfamilia_id
  LEFT JOIN usuarios a ON a.id = t.asignado_a
  LEFT JOIN usuarios c ON c.id = t.creado_por
  LEFT JOIN tareas_programadas ta ON ta.id = t.tarea_id
  LEFT JOIN empresas e ON e.id = t.empresa_id
  LEFT JOIN activos act ON act.id = t.activo_id
`;

// Texto sobre el que busca el buscador de la lista de incidencias.
const TICKET_BUSCABLE = `normaliza(
  t.titulo || ' ' || COALESCE(t.descripcion, '') || ' ' || l.nombre || ' ' || g.nombre
  || ' ' || COALESCE(ar.nombre, '') || ' ' || COALESCE(f.nombre, '') || ' ' || COALESCE(sf.nombre, '')
  || ' ' || COALESCE(a.nombre, '') || ' ' || COALESCE(c.nombre, '')
)`;

app.get('/api/tickets', (req, res) => {
  const visible = auth.filtroVisibilidad(req.user);
  const where = [visible.sql];
  const params = [...visible.params];

  if (req.query.grupo_id) { where.push('t.grupo_id = ?'); params.push(Number(req.query.grupo_id)); }
  if (req.query.local_id) { where.push('t.local_id = ?'); params.push(Number(req.query.local_id)); }
  if (req.query.area_id) { where.push('t.area_id = ?'); params.push(Number(req.query.area_id)); }
  if (req.query.familia_id) { where.push('t.familia_id = ?'); params.push(Number(req.query.familia_id)); }
  if (req.query.subfamilia_id) { where.push('t.subfamilia_id = ?'); params.push(Number(req.query.subfamilia_id)); }
  if (req.query.estado) { where.push('t.estado = ?'); params.push(texto(req.query.estado)); }
  if (req.query.prioridad) { where.push('t.prioridad = ?'); params.push(texto(req.query.prioridad)); }
  // «mias» son las que tiene asignadas el técnico que mira la lista.
  if (req.query.asignado === 'mias') { where.push('t.asignado_a = ?'); params.push(req.user.id); }
  if (req.query.asignado === 'sin_asignar') where.push('t.asignado_a IS NULL');

  for (const palabra of normalizar(texto(req.query.q)).split(/\s+/).filter(Boolean)) {
    where.push(`${TICKET_BUSCABLE} LIKE ? ESCAPE '\\'`);
    params.push(`%${palabra.replace(/[\\%_]/g, '\\$&')}%`);
  }

  // Lo urgente primero y lo cerrado al final: el orden en que se atiende.
  const sql = `${TICKET_SELECT} WHERE ${where.join(' AND ')}
    ORDER BY CASE t.estado WHEN 'cerrado' THEN 1 ELSE 0 END,
             CASE t.prioridad WHEN 'urgente' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
             t.actualizado_en DESC, t.id DESC`;
  res.json(db.prepare(sql).all(...params).map((t) => paraElUsuario(t, req.user)));
});

/**
 * De qué lado del hilo está una persona. Quien reporta la avería —los roles
 * «usuario» y «empleado»— es un lado; quien la atiende o supervisa —técnico,
 * gestor o administrador, los mismos de `auth.GESTIONAN`— es el otro. Es la
 * misma división que usan los avisos.
 */
function ladoDe(rol) {
  return auth.GESTIONAN.includes(rol) ? 'tecnico' : 'empleado';
}

/**
 * Si a este usuario le toca contestar o está esperando.
 *
 * - `esperando`: lo último lo escribió su propio lado, así que la pelota está
 *   en el tejado del otro.
 * - `nuevo`: el otro lado ha escrito y el suyo todavía no ha dicho nada. Solo
 *   le pasa al técnico, porque el primer mensaje del hilo siempre lo escribe
 *   quien abre la incidencia: es la que pide atención, una incidencia recién
 *   abierta que nadie ha contestado.
 * - `respondido`: ya hubo conversación en los dos sentidos y el otro lado ha
 *   escrito lo último. Solo entonces tiene sentido decir «respondido»: sin
 *   haber escrito antes, nadie te ha respondido a nada.
 *
 * Se calcula por quien mira, no por la incidencia: la misma incidencia está
 * «nuevo» para el técnico y «esperando respuesta» para el empleado que la
 * abrió.
 */
function estadoRespuesta(user, ticket) {
  if (!ticket || !ticket.ultimo_rol) return null;
  // Una incidencia cerrada ya no espera nada de nadie.
  if (ticket.estado === 'cerrado') return null;

  const miLado = ladoDe(user.rol);
  if (ladoDe(ticket.ultimo_rol) === miLado) return 'esperando';

  const mios = miLado === 'empleado' ? ticket.mensajes_empleado : ticket.mensajes_tecnico;
  return mios > 0 ? 'respondido' : 'nuevo';
}

// Añade a la incidencia lo que depende de quién la mira.
function paraElUsuario(ticket, user) {
  if (!ticket) return ticket;
  ticket.respuesta = estadoRespuesta(user, ticket);
  return ticket;
}

function leerTicket(id) {
  return db.prepare(`${TICKET_SELECT} WHERE t.id = ?`).get(id);
}

// Comprueba que la incidencia existe y que este usuario puede verla. Una
// incidencia que no le toca responde 404, no 403: así la lista de incidencias
// ajenas no se puede sondear probando identificadores.
function ticketVisible(req, res) {
  const id = num(req.params.id);
  const ticket = id && leerTicket(id);
  if (!ticket || !auth.puedeVerTicket(req.user, ticket)) {
    res.status(404).json({ error: 'Incidencia no encontrada.' });
    return null;
  }
  return ticket;
}

app.get('/api/tickets/:id', (req, res) => {
  const ticket = ticketVisible(req, res);
  if (!ticket) return;
  ticket.mensajes_hilo = db.prepare(`
    SELECT m.id, m.contenido, m.creado_en, m.autor_id, m.apertura,
           u.nombre AS autor_nombre, u.rol AS autor_rol
    FROM mensajes m JOIN usuarios u ON u.id = m.autor_id
    WHERE m.ticket_id = ? ORDER BY m.creado_en, m.id
  `).all(ticket.id);
  ticket.adjuntos_lista = db.prepare(`
    SELECT ad.id, ad.nombre, ad.tipo, ad.mensaje_id, ad.subido_por, ad.creado_en,
           u.nombre AS autor_nombre
    FROM adjuntos ad LEFT JOIN usuarios u ON u.id = ad.subido_por
    WHERE ad.ticket_id = ? ORDER BY ad.creado_en, ad.id
  `).all(ticket.id);
  ticket.puedeGestionar = auth.puedeGestionarTicket(req.user, ticket);
  res.json(paraElUsuario(ticket, req.user));
});

app.post('/api/tickets', (req, res) => {
  if (!auth.puedeCrearTickets(req.user)) {
    return res.status(403).json({ error: 'No puedes abrir incidencias.' });
  }
  const titulo = texto(req.body.titulo);
  const grupoId = num(req.body.grupo_id);
  const localId = num(req.body.local_id);
  const prioridad = texto(req.body.prioridad) || 'normal';

  if (!titulo) return badRequest(res, 'El título es obligatorio.');
  if (!grupoId || !db.prepare('SELECT 1 FROM grupos WHERE id = ?').get(grupoId)) {
    return badRequest(res, 'El departamento es obligatorio.');
  }
  if (!localId) return badRequest(res, 'El local es obligatorio.');
  if (!auth.localesPermitidos(req.user).includes(localId)) {
    return res.status(403).json({ error: 'No puedes abrir incidencias en este local.' });
  }
  if (!PRIORIDADES.includes(prioridad)) return badRequest(res, 'La prioridad no es válida.');

  // El grupo y la familia son obligatorios, y la familia tiene que ser de ese
  // grupo; la subfamilia no es obligatoria, pero si viene tiene que ser de
  // esa familia.
  const areaId = num(req.body.area_id);
  if (!areaId || !db.prepare('SELECT 1 FROM areas WHERE id = ?').get(areaId)) {
    return badRequest(res, 'El grupo es obligatorio.');
  }
  const familiaId = num(req.body.familia_id);
  const familia = familiaId && db.prepare('SELECT area_id FROM familias WHERE id = ?').get(familiaId);
  if (!familia) return badRequest(res, 'La familia es obligatoria.');
  if (familia.area_id !== areaId) {
    return badRequest(res, 'La familia no pertenece a ese grupo.');
  }
  const subfamiliaId = num(req.body.subfamilia_id);
  if (subfamiliaId) {
    const subfamilia = db.prepare('SELECT familia_id FROM subfamilias WHERE id = ?').get(subfamiliaId);
    if (!subfamilia) return badRequest(res, 'La subfamilia no existe.');
    if (subfamilia.familia_id !== familiaId) {
      return badRequest(res, 'La subfamilia no pertenece a esa familia.');
    }
  }

  // El activo del inventario que señala la incidencia, si la trae: tiene que
  // ser del mismo departamento y del mismo local en el que se abre.
  const activoId = num(req.body.activo_id);
  if (activoId) {
    const activo = db.prepare('SELECT grupo_id, local_id FROM activos WHERE id = ?').get(activoId);
    if (!activo) return badRequest(res, 'El activo no existe.');
    if (activo.grupo_id !== grupoId) {
      return badRequest(res, 'El activo no pertenece a ese departamento.');
    }
    if (activo.local_id !== localId) {
      return badRequest(res, 'El activo no pertenece a ese local.');
    }
  }

  // «En nombre de»: un técnico recoge una avería que le cuenta alguien de pie en
  // el local y la abre por él, para que los avisos y el hilo le lleguen a quien
  // la ha reportado y no a quien la ha tecleado.
  let creador = req.user.id;
  const enNombreDe = num(req.body.en_nombre_de);
  if (enNombreDe && enNombreDe !== req.user.id) {
    if (!auth.puedeAbrirEnNombreDe(req.user)) {
      return res.status(403).json({ error: 'No puedes abrir incidencias en nombre de otra persona.' });
    }
    const persona = auth.cargarUsuario(enNombreDe);
    if (!persona) return badRequest(res, 'Esa persona no existe.');
    // Solo alguien que pueda ver ese local: si no, se quedaría con una
    // incidencia suya que no puede abrir.
    if (!auth.localesPermitidos(persona).includes(localId)) {
      return badRequest(res, `${persona.nombre} no tiene acceso a ese local.`);
    }
    creador = persona.id;
  }

  const descripcion = texto(req.body.descripcion) || null;
  const info = db.prepare(`
    INSERT INTO tickets
      (titulo, descripcion, prioridad, grupo_id, local_id, area_id, familia_id, subfamilia_id, activo_id, creado_por)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    titulo, descripcion, prioridad, grupoId, localId, areaId, familiaId, subfamiliaId || null,
    activoId || null, creador
  );
  const ticketId = info.lastInsertRowid;

  // La descripción y los adjuntos son el primer mensaje del hilo, no una ficha
  // aparte: así la incidencia se lee de arriba abajo como una conversación,
  // empezando por lo que contó quien la abrió.
  //
  // Los adjuntos vienen ya subidos como borradores, así que a estas alturas
  // están enteros en el servidor. Solo después se avisa a los técnicos.
  const borradores = Array.isArray(req.body.adjuntos) ? req.body.adjuntos : [];
  if (descripcion || borradores.length) {
    const apertura = db.prepare(
      'INSERT INTO mensajes (ticket_id, autor_id, contenido, apertura) VALUES (?, ?, ?, 1)'
    ).run(ticketId, creador, descripcion || '');
    adoptarBorradores(borradores, {
      ticketId,
      mensajeId: apertura.lastInsertRowid,
      usuarioId: req.user.id
    });
  }

  const ticket = leerTicket(ticketId);
  notificaciones.avisarTicketCreado(ticket);
  res.status(201).json(ticket);
});

// Cambio de estado, prioridad y asignación: lo hacen los técnicos que ven la
// incidencia, y los administradores.
app.put('/api/tickets/:id', (req, res) => {
  const ticket = ticketVisible(req, res);
  if (!ticket) return;
  if (!auth.puedeGestionarTicket(req.user, ticket)) {
    return res.status(403).json({ error: 'Solo un técnico del departamento puede gestionar esta incidencia.' });
  }

  const estado = texto(req.body.estado) || ticket.estado;
  if (!ESTADOS.includes(estado)) return badRequest(res, 'El estado no es válido.');

  const prioridad = texto(req.body.prioridad) || ticket.prioridad;
  if (!PRIORIDADES.includes(prioridad)) return badRequest(res, 'La prioridad no es válida.');

  // `asignado_a` distingue entre «no lo toques» (la clave no viene) y «déjalo
  // sin asignar» (viene en nulo).
  let asignado = ticket.asignado_a;
  if ('asignado_a' in req.body) {
    asignado = num(req.body.asignado_a);
    if (asignado) {
      const tecnico = db.prepare('SELECT grupo_id, rol FROM usuarios WHERE id = ?').get(asignado);
      if (!tecnico || tecnico.rol !== 'tecnico') return badRequest(res, 'Solo se puede asignar a un técnico.');
      if (tecnico.grupo_id !== ticket.grupo_id) {
        return badRequest(res, 'El técnico pertenece a otro departamento.');
      }
    } else {
      asignado = null;
    }
  }

  // La fecha de cierre marca cuándo se resolvió, que es lo que cuentan los
  // informes. Reabrir una incidencia la borra.
  const cerrar = estado === 'cerrado' && ticket.estado !== 'cerrado';
  const reabrir = estado !== 'cerrado' && ticket.estado === 'cerrado';
  db.prepare(`
    UPDATE tickets SET estado = ?, prioridad = ?, asignado_a = ?,
      actualizado_en = datetime('now'),
      cerrado_en = CASE WHEN ? THEN datetime('now') WHEN ? THEN NULL ELSE cerrado_en END
    WHERE id = ?
  `).run(estado, prioridad, asignado, cerrar ? 1 : 0, reabrir ? 1 : 0, ticket.id);

  const actualizado = leerTicket(ticket.id);
  // Un cambio de estado se avisa igual que un mensaje: quien abrió la
  // incidencia quiere enterarse de que la han cogido o cerrado sin tener que
  // entrar a mirarlo.
  notificaciones.avisarEstado(actualizado, ticket.estado, req.user);
  // Y a quien acaba de recibirla, que es una cosa distinta del estado.
  if (asignado && asignado !== ticket.asignado_a) {
    notificaciones.avisarAsignacion(actualizado, req.user);
  }
  res.json(paraElUsuario(actualizado, req.user));
});

app.delete('/api/tickets/:id', auth.soloAdmin, (req, res) => {
  const id = num(req.params.id);
  const ticket = id && leerTicket(id);
  if (!ticket) return res.status(404).json({ error: 'Incidencia no encontrada.' });
  borrarAdjuntosDe(id);
  db.prepare('DELETE FROM tickets WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ---------- Hilo de mensajes ----------

app.post('/api/tickets/:id/mensajes', (req, res) => {
  const ticket = ticketVisible(req, res);
  if (!ticket) return;
  const contenido = texto(req.body.contenido);
  // Un mensaje puede ser solo una foto, sin texto.
  const traeAdjuntos = Array.isArray(req.body.adjuntos) && req.body.adjuntos.length > 0;
  if (!contenido && !traeAdjuntos) {
    return badRequest(res, 'El mensaje no puede estar vacío.');
  }

  const info = db.prepare('INSERT INTO mensajes (ticket_id, autor_id, contenido) VALUES (?, ?, ?)')
    .run(ticket.id, req.user.id, contenido);
  // Un mensaje nuevo mueve la incidencia al principio de la lista.
  db.prepare("UPDATE tickets SET actualizado_en = datetime('now') WHERE id = ?").run(ticket.id);

  // Las fotos que se mandan con el mensaje van dentro de él, no sueltas en la
  // incidencia: en el hilo se ven junto a lo que se escribió al enviarlas.
  adoptarBorradores(req.body.adjuntos, {
    ticketId: ticket.id,
    mensajeId: info.lastInsertRowid,
    usuarioId: req.user.id
  });

  // El primer técnico que contesta a una incidencia sin dueño se la queda.
  //
  // Es lo que ya ocurre de hecho: quien escribe «voy a mirarlo» la está
  // cogiendo, y hasta ahora había que acordarse de asignársela aparte. Sin eso
  // quedaban incidencias atendidas pero sin dueño, que ensucian los informes,
  // y el resto del departamento seguía recibiendo cada mensaje de una avería
  // que ya llevaba otro.
  //
  // Solo un técnico de su mismo grupo, que es lo único que admite la ruta de
  // asignación: un gestor o un administrador pueden contestar sin quedársela.
  if (!ticket.asignado_a && req.user.rol === 'tecnico'
      && req.user.grupo_id === ticket.grupo_id) {
    db.prepare('UPDATE tickets SET asignado_a = ? WHERE id = ?').run(req.user.id, ticket.id);
    ticket.asignado_a = req.user.id;
  }

  const mensaje = db.prepare(`
    SELECT m.id, m.contenido, m.creado_en, m.autor_id, m.apertura,
           u.nombre AS autor_nombre, u.rol AS autor_rol
    FROM mensajes m JOIN usuarios u ON u.id = m.autor_id WHERE m.id = ?
  `).get(info.lastInsertRowid);

  // Con el `ticket` ya actualizado: si acaba de coger la incidencia, el aviso
  // va a él y a quien la abrió, no a todo el departamento.
  notificaciones.avisarMensaje(ticket, mensaje, req.user);
  res.status(201).json(mensaje);
});

// ---------- Adjuntos ----------

const ADJUNTOS_DIR = path.join(db.carpetaDatos, 'adjuntos');
// Un vídeo, aunque venga comprimido por el navegador, pesa mucho más que una
// foto: cada clase de adjunto tiene su propio tope.
const MAX_ADJUNTO = 10 * 1024 * 1024;
const MAX_VIDEO = 120 * 1024 * 1024;
const TIPOS_ADJUNTO = {
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
  '.3gp': ['video/3gpp', 'video']
};
const FORMATOS = 'PDF, imagen (JPG, PNG, WEBP, GIF o HEIC), vídeo (MP4, WEBM, MOV o 3GP), '
  + 'Word, Excel o texto';

function topeDe(tipo) {
  return tipo === 'video' ? MAX_VIDEO : MAX_ADJUNTO;
}

function enMegas(bytes) {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

// Texto utilizable como nombre de archivo.
function nombreSeguro(s, porDefecto) {
  const limpio = String(s == null ? '' : s)
    .replace(/[\\/]/g, '-')
    .replace(/[:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .trim();
  return limpio.slice(0, 80) || porDefecto;
}

function carpetaDe(ticketId) {
  return path.join(ADJUNTOS_DIR, String(ticketId));
}

function borrarAdjuntosDe(ticketId) {
  fs.rmSync(carpetaDe(ticketId), { recursive: true, force: true });
}

// ---------- Adjuntos en borrador ----------

// Los borradores viven aparte hasta que se sabe de qué incidencia cuelgan.
const BORRADORES_DIR = path.join(ADJUNTOS_DIR, 'borrador');

// Un borrador que nadie llegó a usar —se cerró la pantalla a medias— no puede
// quedarse ocupando disco para siempre.
const HORAS_BORRADOR = 24;

function limpiarBorradores() {
  const viejos = db.prepare(
    `SELECT id, archivo FROM adjuntos_borrador
     WHERE creado_en < datetime('now', '-${HORAS_BORRADOR} hours')`
  ).all();
  for (const b of viejos) {
    try {
      fs.unlinkSync(path.join(BORRADORES_DIR, b.archivo));
    } catch (e) { /* ya no estaba */ }
  }
  if (viejos.length) {
    db.prepare(
      `DELETE FROM adjuntos_borrador WHERE id IN (${viejos.map(() => '?').join(',')})`
    ).run(...viejos.map((b) => b.id));
  }
}
limpiarBorradores();
setInterval(limpiarBorradores, 60 * 60 * 1000).unref();

/**
 * Sube un archivo antes de que exista la incidencia o el mensaje.
 *
 * Es lo que permite no crear la incidencia hasta que el adjunto está entero en
 * el servidor: primero sube esto, y solo si responde bien se manda el POST de
 * la incidencia con los identificadores devueltos. Si la subida se corta no
 * queda una incidencia a medias avisando a los técnicos de una foto que no
 * llegó nunca.
 */
app.post('/api/adjuntos/borrador', express.raw({ type: '*/*', limit: MAX_VIDEO }), (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) {
    return badRequest(res, 'No se ha recibido ningún archivo.');
  }
  const original = nombreSeguro(req.query.nombre, 'adjunto');
  const extension = path.extname(original).toLowerCase();
  if (!TIPOS_ADJUNTO[extension]) {
    return badRequest(res, `Formato no admitido: adjunta un ${FORMATOS}.`);
  }
  const clase = TIPOS_ADJUNTO[extension][1];
  if (req.body.length > topeDe(clase)) {
    return res.status(413).json({
      error: clase === 'video'
        ? `El vídeo no puede superar los ${enMegas(MAX_VIDEO)}.`
        : `El adjunto no puede superar los ${enMegas(MAX_ADJUNTO)}.`
    });
  }

  fs.mkdirSync(BORRADORES_DIR, { recursive: true });
  const info = db.prepare(`
    INSERT INTO adjuntos_borrador (usuario_id, archivo, nombre, tipo)
    VALUES (?, '', ?, ?)
  `).run(req.user.id, original, clase);

  const archivo = `${info.lastInsertRowid}${extension}`;
  fs.writeFileSync(path.join(BORRADORES_DIR, archivo), req.body);
  db.prepare('UPDATE adjuntos_borrador SET archivo = ? WHERE id = ?')
    .run(archivo, info.lastInsertRowid);

  res.status(201).json({ id: info.lastInsertRowid, nombre: original, tipo: clase });
});

app.delete('/api/adjuntos/borrador/:id', (req, res) => {
  const id = num(req.params.id);
  // Solo se puede tirar el borrador de uno mismo.
  const fila = id && db.prepare(
    'SELECT * FROM adjuntos_borrador WHERE id = ? AND usuario_id = ?'
  ).get(id, req.user.id);
  if (!fila) return res.status(404).json({ error: 'Borrador no encontrado.' });
  try {
    fs.unlinkSync(path.join(BORRADORES_DIR, fila.archivo));
  } catch (e) { /* ya no estaba */ }
  db.prepare('DELETE FROM adjuntos_borrador WHERE id = ?').run(id);
  res.json({ ok: true });
});

/**
 * Mueve los borradores indicados a la incidencia, colgándolos de un mensaje.
 *
 * Devuelve cuántos se han movido. Los que no existan o sean de otro usuario se
 * ignoran en silencio: son restos de una pantalla que se quedó a medias.
 */
function adoptarBorradores(ids, { ticketId, mensajeId, usuarioId }) {
  const limpios = [...new Set((ids || []).map(Number).filter(Boolean))];
  if (!limpios.length) return 0;

  const filas = db.prepare(`
    SELECT * FROM adjuntos_borrador
    WHERE usuario_id = ? AND id IN (${limpios.map(() => '?').join(',')})
  `).all(usuarioId, ...limpios);
  if (!filas.length) return 0;

  const carpeta = carpetaDe(ticketId);
  fs.mkdirSync(carpeta, { recursive: true });

  let movidos = 0;
  for (const b of filas) {
    const extension = path.extname(b.archivo);
    const info = db.prepare(`
      INSERT INTO adjuntos (ticket_id, mensaje_id, archivo, nombre, tipo, subido_por)
      VALUES (?, ?, '', ?, ?, ?)
    `).run(ticketId, mensajeId, b.nombre, b.tipo, usuarioId);

    const destino = `${info.lastInsertRowid}${extension}`;
    try {
      fs.renameSync(path.join(BORRADORES_DIR, b.archivo), path.join(carpeta, destino));
    } catch (e) {
      // El archivo ya no está: se deshace la fila para no dejar un adjunto roto.
      db.prepare('DELETE FROM adjuntos WHERE id = ?').run(info.lastInsertRowid);
      continue;
    }
    db.prepare('UPDATE adjuntos SET archivo = ? WHERE id = ?').run(destino, info.lastInsertRowid);
    movidos += 1;
  }

  db.prepare(
    `DELETE FROM adjuntos_borrador WHERE id IN (${filas.map(() => '?').join(',')})`
  ).run(...filas.map((b) => b.id));

  return movidos;
}

// El archivo llega como cuerpo binario; el nombre original, en la query.
app.post('/api/tickets/:id/adjuntos', express.raw({ type: '*/*', limit: MAX_VIDEO }), (req, res) => {
  const ticket = ticketVisible(req, res);
  if (!ticket) return;
  if (!Buffer.isBuffer(req.body) || !req.body.length) {
    return badRequest(res, 'No se ha recibido ningún archivo.');
  }
  const original = nombreSeguro(req.query.nombre, `adjunto-${ticket.id}`);
  const extension = path.extname(original).toLowerCase();
  if (!TIPOS_ADJUNTO[extension]) {
    return badRequest(res, `Formato no admitido: adjunta un ${FORMATOS}.`);
  }
  const clase = TIPOS_ADJUNTO[extension][1];
  if (req.body.length > topeDe(clase)) {
    return res.status(413).json({
      error: clase === 'video'
        ? `El vídeo no puede superar los ${enMegas(MAX_VIDEO)}.`
        : `El adjunto no puede superar los ${enMegas(MAX_ADJUNTO)}.`
    });
  }

  // Un mensaje del hilo puede llevar sus propios adjuntos.
  const mensajeId = num(req.query.mensaje_id) || null;
  if (mensajeId) {
    const mensaje = db.prepare('SELECT ticket_id FROM mensajes WHERE id = ?').get(mensajeId);
    if (!mensaje || mensaje.ticket_id !== ticket.id) {
      return badRequest(res, 'El mensaje no pertenece a esta incidencia.');
    }
  }

  // Dos adjuntos pueden llamarse igual: el archivo se guarda con el id de su
  // fila, y el nombre original solo se usa para enseñarlo y descargarlo.
  const carpeta = carpetaDe(ticket.id);
  fs.mkdirSync(carpeta, { recursive: true });
  const info = db.prepare(`
    INSERT INTO adjuntos (ticket_id, mensaje_id, archivo, nombre, tipo, subido_por)
    VALUES (?, ?, '', ?, ?, ?)
  `).run(ticket.id, mensajeId, original, clase, req.user.id);

  const archivo = `${info.lastInsertRowid}${extension}`;
  fs.writeFileSync(path.join(carpeta, archivo), req.body);
  db.prepare('UPDATE adjuntos SET archivo = ? WHERE id = ?').run(archivo, info.lastInsertRowid);
  db.prepare("UPDATE tickets SET actualizado_en = datetime('now') WHERE id = ?").run(ticket.id);

  res.status(201).json(
    db.prepare('SELECT id, nombre, tipo, mensaje_id, subido_por, creado_en FROM adjuntos WHERE id = ?')
      .get(info.lastInsertRowid)
  );
});

app.get('/api/adjuntos/:id', (req, res) => {
  const id = num(req.params.id);
  const adjunto = id && db.prepare('SELECT * FROM adjuntos WHERE id = ?').get(id);
  // El adjunto se ve si se ve la incidencia de la que cuelga.
  if (!adjunto || !auth.puedeVerTicket(req.user, leerTicket(adjunto.ticket_id))) {
    return res.status(404).json({ error: 'Adjunto no encontrado.' });
  }
  const absoluto = path.join(carpetaDe(adjunto.ticket_id), adjunto.archivo);
  if (!fs.existsSync(absoluto)) {
    return res.status(404).json({ error: 'El archivo ya no está en el servidor.' });
  }
  const tipo = TIPOS_ADJUNTO[path.extname(adjunto.archivo).toLowerCase()];
  res.setHeader('Content-Type', (tipo && tipo[0]) || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(adjunto.nombre)}`);
  res.sendFile(absoluto);
});

app.delete('/api/adjuntos/:id', (req, res) => {
  const id = num(req.params.id);
  const adjunto = id && db.prepare('SELECT * FROM adjuntos WHERE id = ?').get(id);
  if (!adjunto || !auth.puedeVerTicket(req.user, leerTicket(adjunto.ticket_id))) {
    return res.status(404).json({ error: 'Adjunto no encontrado.' });
  }
  // Lo borra quien lo subió; un administrador, cualquiera.
  if (req.user.rol !== 'admin' && adjunto.subido_por !== req.user.id) {
    return res.status(403).json({ error: 'Solo puedes eliminar los adjuntos que has subido tú.' });
  }
  try {
    fs.unlinkSync(path.join(carpetaDe(adjunto.ticket_id), adjunto.archivo));
  } catch (e) { /* ya no estaba */ }
  db.prepare('DELETE FROM adjuntos WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ---------- Dispositivos (notificaciones push) ----------

// La app móvil registra aquí su token de Firebase al iniciar sesión y cada vez
// que Firebase se lo cambia.
app.post('/api/dispositivos', (req, res) => {
  const token = texto(req.body.token_push);
  const plataforma = texto(req.body.plataforma) || 'android';
  if (!token) return badRequest(res, 'El token del dispositivo es obligatorio.');
  if (plataforma !== 'android' && plataforma !== 'ios') {
    return badRequest(res, 'La plataforma no es válida.');
  }
  // Un mismo aparato puede cambiar de manos: el token pasa al usuario que
  // acaba de iniciar sesión.
  db.prepare(`
    INSERT INTO dispositivos (usuario_id, token_push, plataforma) VALUES (?, ?, ?)
    ON CONFLICT (token_push) DO UPDATE
      SET usuario_id = excluded.usuario_id, plataforma = excluded.plataforma,
          actualizado_en = datetime('now')
  `).run(req.user.id, token, plataforma);
  res.status(201).json({ ok: true });
});

app.delete('/api/dispositivos', (req, res) => {
  const token = texto(req.body && req.body.token_push);
  if (!token) return badRequest(res, 'El token del dispositivo es obligatorio.');
  db.prepare('DELETE FROM dispositivos WHERE usuario_id = ? AND token_push = ?').run(req.user.id, token);
  res.json({ ok: true });
});

// ---------- Chat de local ----------

// Todo el chat vive en `chat.js`: los canales por local, el flujo de eventos
// que los mantiene al día y los archivos que se mandan por ahí.
app.use('/api/chat', chat.router);

// ---------- Informes ----------

function totalVacio() {
  return { entrados: 0, resueltos: 0, pendientes: 0 };
}

// «AAAA-MM-DD» + hora local de la aplicación → la marca UTC con la que se
// comparan las columnas de fecha, que SQLite guarda en UTC.
function comoMarcaUTC(dia, hora, minuto, segundo) {
  const partes = planificacion.diaDe(dia);
  const instante = planificacion.instanteDe(partes.anio, partes.mes, partes.dia, hora, minuto);
  return new Date(instante.getTime() + segundo * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Lo enviado, lo recibido y la merma por prenda en un rango, para el informe
 * de lavandería. `localId` nulo cuenta todos los locales.
 *
 * Lo recibido y la merma solo cuentan envíos ya contados a la vuelta: lo que
 * todavía está en la lavandería no es una merma, solo está pendiente.
 */
function desgloseLavanderia(localId, inicio, fin) {
  const local = localId ? [localId] : [];
  const filtro = localId ? 'AND e.local_id = ?' : '';
  return db.prepare(`
    SELECT p.id, p.nombre,
      (SELECT COALESCE(SUM(i.enviado), 0) FROM envio_lavanderia_items i
         JOIN envios_lavanderia e ON e.id = i.envio_id
         WHERE i.prenda_id = p.id AND e.creado_en BETWEEN ? AND ? ${filtro}) AS enviado,
      (SELECT COALESCE(SUM(i.recibido), 0) FROM envio_lavanderia_items i
         JOIN envios_lavanderia e ON e.id = i.envio_id
         WHERE i.prenda_id = p.id AND e.recibido_en IS NOT NULL
           AND e.creado_en BETWEEN ? AND ? ${filtro}) AS recibido,
      (SELECT COALESCE(SUM(i.enviado - i.recibido), 0) FROM envio_lavanderia_items i
         JOIN envios_lavanderia e ON e.id = i.envio_id
         WHERE i.prenda_id = p.id AND e.recibido_en IS NOT NULL
           AND e.creado_en BETWEEN ? AND ? ${filtro}) AS merma,
      (SELECT COALESCE(SUM(i.enviado), 0) FROM envio_lavanderia_items i
         JOIN envios_lavanderia e ON e.id = i.envio_id
         WHERE i.prenda_id = p.id AND e.recibido_en IS NULL
           AND e.creado_en BETWEEN ? AND ? ${filtro}) AS pendiente
    FROM prendas_lavanderia p ORDER BY p.orden, p.nombre
  `).all(
    inicio, fin, ...local,
    inicio, fin, ...local,
    inicio, fin, ...local,
    inicio, fin, ...local
  );
}

/**
 * Incidencias entradas y resueltas en un rango, desglosadas por local.
 *
 * - Entradas: las abiertas dentro del rango (por `creado_en`).
 * - Resueltas: las cerradas dentro del rango (por `cerrado_en`), aunque se
 *   abrieran antes.
 * - Pendientes: de las entradas en el rango, las que siguen sin cerrar.
 *
 * Además del desglose por local van el reparto por empleado y el recuento de
 * abiertas y cerradas, que son los dos gráficos de la pantalla.
 */
app.get('/api/informes', (req, res) => {
  if (!auth.puedeVerInformes(req.user)) {
    return res.status(403).json({ error: 'Los informes no son para los empleados.' });
  }

  const desde = texto(req.query.desde);
  const hasta = texto(req.query.hasta);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
    return badRequest(res, 'El rango de fechas es obligatorio.');
  }
  if (desde > hasta) return badRequest(res, 'La fecha de inicio no puede ser posterior a la de fin.');

  const where = [];
  const params = [];
  // El técnico informa solo de su propio grupo, filtre lo que filtre.
  if (req.user.rol === 'tecnico') {
    if (!req.user.grupo_id) {
      return res.json({
        locales: [], areas: [], familias: [], meses: [], lavanderia: [],
        estado: { abiertas: 0, pendientes: 0, cerradas: 0 }, total: totalVacio()
      });
    }
    where.push('t.grupo_id = ?');
    params.push(req.user.grupo_id);
  }
  if (req.query.grupo_id) { where.push('t.grupo_id = ?'); params.push(Number(req.query.grupo_id)); }
  if (req.query.local_id) { where.push('t.local_id = ?'); params.push(Number(req.query.local_id)); }
  if (req.query.area_id) { where.push('t.area_id = ?'); params.push(Number(req.query.area_id)); }
  if (req.query.familia_id) { where.push('t.familia_id = ?'); params.push(Number(req.query.familia_id)); }
  if (req.query.subfamilia_id) { where.push('t.subfamilia_id = ?'); params.push(Number(req.query.subfamilia_id)); }
  // El técnico del filtro es quien tiene la incidencia asignada, que es lo que
  // significa «gestionada por». Un técnico solo puede pedir las suyas: los
  // números de sus compañeros no le corresponden.
  const propio = auth.tecnicoDeLosInformes(req.user);
  const tecnicoPedido = propio || (req.query.tecnico_id ? Number(req.query.tecnico_id) : null);
  if (tecnicoPedido) { where.push('t.asignado_a = ?'); params.push(tecnicoPedido); }
  const filtro = where.length ? `AND ${where.join(' AND ')}` : '';

  // El rango llega en días de calendario y las marcas de tiempo se guardan en
  // UTC, así que los extremos se convierten desde la zona de la aplicación: si
  // no, las incidencias de primera hora de la mañana caerían en el día anterior.
  const inicio = comoMarcaUTC(desde, 0, 0, 0);
  const fin = comoMarcaUTC(hasta, 23, 59, 59);

  const locales = db.prepare(`
    SELECT l.id, l.nombre,
      (SELECT COUNT(*) FROM tickets t WHERE t.local_id = l.id
         AND t.creado_en BETWEEN ? AND ? ${filtro}) AS entrados,
      (SELECT COUNT(*) FROM tickets t WHERE t.local_id = l.id
         AND t.cerrado_en BETWEEN ? AND ? ${filtro}) AS resueltos,
      (SELECT COUNT(*) FROM tickets t WHERE t.local_id = l.id
         AND t.creado_en BETWEEN ? AND ? AND t.estado != 'cerrado' ${filtro}) AS pendientes
    FROM locales l ORDER BY l.orden, l.nombre
  `).all(inicio, fin, ...params, inicio, fin, ...params, inicio, fin, ...params);

  // Mismo desglose, por grupo (área) y por familia: solo cuenta lo que tiene
  // una asignada, así que las incidencias sin categorizar no salen en ningún
  // reparto. Las incidencias antiguas, de antes de que el grupo y la familia
  // fueran obligatorios, son las únicas que pueden faltar aquí.
  const areas = db.prepare(`
    SELECT ar.id, ar.nombre,
      (SELECT COUNT(*) FROM tickets t WHERE t.area_id = ar.id
         AND t.creado_en BETWEEN ? AND ? ${filtro}) AS entrados,
      (SELECT COUNT(*) FROM tickets t WHERE t.area_id = ar.id
         AND t.cerrado_en BETWEEN ? AND ? ${filtro}) AS resueltos,
      (SELECT COUNT(*) FROM tickets t WHERE t.area_id = ar.id
         AND t.creado_en BETWEEN ? AND ? AND t.estado != 'cerrado' ${filtro}) AS pendientes
    FROM areas ar ORDER BY ar.orden, ar.nombre
  `).all(inicio, fin, ...params, inicio, fin, ...params, inicio, fin, ...params);

  const familias = db.prepare(`
    SELECT f.id, f.nombre,
      (SELECT COUNT(*) FROM tickets t WHERE t.familia_id = f.id
         AND t.creado_en BETWEEN ? AND ? ${filtro}) AS entrados,
      (SELECT COUNT(*) FROM tickets t WHERE t.familia_id = f.id
         AND t.cerrado_en BETWEEN ? AND ? ${filtro}) AS resueltos,
      (SELECT COUNT(*) FROM tickets t WHERE t.familia_id = f.id
         AND t.creado_en BETWEEN ? AND ? AND t.estado != 'cerrado' ${filtro}) AS pendientes
    FROM familias f ORDER BY f.orden, f.nombre
  `).all(inicio, fin, ...params, inicio, fin, ...params, inicio, fin, ...params);

  // Entradas por mes, para el gráfico de barras.
  const meses = db.prepare(`
    SELECT strftime('%Y-%m', t.creado_en) AS mes, COUNT(*) AS entrados
    FROM tickets t
    WHERE t.creado_en BETWEEN ? AND ? ${filtro}
    GROUP BY mes ORDER BY mes
  `).all(inicio, fin, ...params);

  // De las entradas del rango, en qué estado están ahora mismo.
  const estado = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN t.estado = 'abierto' THEN 1 ELSE 0 END), 0) AS abiertas,
      COALESCE(SUM(CASE WHEN t.estado = 'pendiente' THEN 1 ELSE 0 END), 0) AS pendientes,
      COALESCE(SUM(CASE WHEN t.estado = 'cerrado' THEN 1 ELSE 0 END), 0) AS cerradas
    FROM tickets t WHERE t.creado_en BETWEEN ? AND ? ${filtro}
  `).get(inicio, fin, ...params);

  const total = locales.reduce((acc, f) => ({
    entrados: acc.entrados + f.entrados,
    resueltos: acc.resueltos + f.resueltos,
    pendientes: acc.pendientes + f.pendientes
  }), totalVacio());

  // Quién puede salir en el desplegable de «gestionada por», ya recortado por
  // el grupo y el local que se estén mirando: no tiene sentido ofrecer a un
  // técnico de Informática cuando se está filtrando por Mantenimiento.
  //
  // Entran los que hoy cubren ese grupo y ese local —un técnico sin locales
  // atiende todos los de su grupo— y además cualquiera que tenga incidencias
  // asignadas dentro del filtro, aunque ya no lo cubra: si no, sus números
  // aparecerían en los totales sin poder consultarlos por separado.
  const grupoFiltro = req.user.rol === 'tecnico'
    ? req.user.grupo_id
    : (req.query.grupo_id ? Number(req.query.grupo_id) : null);
  const localFiltro = req.query.local_id ? Number(req.query.local_id) : null;

  const tecnicos = propio
    ? db.prepare('SELECT id, nombre FROM usuarios WHERE id = ?').all(propio)
    : db.prepare(`
        SELECT DISTINCT u.id, u.nombre FROM usuarios u
        WHERE (
          u.rol = 'tecnico' AND u.bloqueada = 0
          AND (? IS NULL OR u.grupo_id = ?)
          AND (
            ? IS NULL
            OR NOT EXISTS (SELECT 1 FROM usuario_local WHERE usuario_id = u.id)
            OR EXISTS (SELECT 1 FROM usuario_local WHERE usuario_id = u.id AND local_id = ?)
          )
        )
        OR EXISTS (
          SELECT 1 FROM tickets t WHERE t.asignado_a = u.id
            AND (? IS NULL OR t.grupo_id = ?)
            AND (? IS NULL OR t.local_id = ?)
        )
        ORDER BY u.nombre
      `).all(
        grupoFiltro, grupoFiltro, localFiltro, localFiltro,
        grupoFiltro, grupoFiltro, localFiltro, localFiltro
      );

  // Lavandería: enviado y recibido por prenda en el mismo rango de fechas, con
  // su propio filtro de local (grupo, familia y técnico no pintan nada aquí).
  // La lavandería no es cosa del técnico, de ningún departamento: su desglose
  // no viaja en el informe de quien no puede usarla, así que la pestaña que lo
  // enseñaría se queda sin datos y sin motivo para existir.
  const lavanderia = auth.puedeUsarLavanderia(req.user)
    ? desgloseLavanderia(num(req.query.local_id), inicio, fin)
    : [];

  res.json({ locales, areas, familias, meses, lavanderia, estado, total, tecnico: tecnicoPedido, tecnicos });
});

// ---------- Administración: grupos ----------

app.get('/api/grupos', (req, res) => {
  res.json(db.prepare(`
    SELECT g.id, g.nombre, g.orden,
      (SELECT COUNT(*) FROM usuarios u WHERE u.grupo_id = g.id) AS tecnicos,
      (SELECT COUNT(*) FROM tickets t WHERE t.grupo_id = g.id) AS tickets
    FROM grupos g ORDER BY g.orden, g.nombre
  `).all());
});

app.post('/api/grupos', auth.soloAdmin, (req, res) => {
  const nombre = texto(req.body.nombre);
  if (!nombre) return badRequest(res, 'El nombre es obligatorio.');
  if (db.prepare('SELECT 1 FROM grupos WHERE nombre = ?').get(nombre)) {
    return badRequest(res, 'Ya existe un departamento con ese nombre.');
  }
  const orden = db.prepare('SELECT COALESCE(MAX(orden), -1) + 1 AS o FROM grupos').get().o;
  const info = db.prepare('INSERT INTO grupos (nombre, orden) VALUES (?, ?)').run(nombre, orden);
  res.status(201).json(db.prepare('SELECT * FROM grupos WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/grupos/:id', auth.soloAdmin, (req, res) => {
  const id = num(req.params.id);
  if (!id || !db.prepare('SELECT 1 FROM grupos WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'Departamento no encontrado.' });
  }
  const nombre = texto(req.body.nombre);
  if (!nombre) return badRequest(res, 'El nombre es obligatorio.');
  if (db.prepare('SELECT 1 FROM grupos WHERE nombre = ? AND id != ?').get(nombre, id)) {
    return badRequest(res, 'Ya existe un departamento con ese nombre.');
  }
  db.prepare('UPDATE grupos SET nombre = ? WHERE id = ?').run(nombre, id);
  res.json(db.prepare('SELECT * FROM grupos WHERE id = ?').get(id));
});

app.delete('/api/grupos/:id', auth.soloAdmin, (req, res) => {
  const id = num(req.params.id);
  if (!id || !db.prepare('SELECT 1 FROM grupos WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'Departamento no encontrado.' });
  }
  if (db.prepare('SELECT 1 FROM tickets WHERE grupo_id = ?').get(id)) {
    return badRequest(res, 'No se puede eliminar: hay incidencias de este departamento.');
  }
  if (db.prepare('SELECT 1 FROM usuarios WHERE grupo_id = ?').get(id)) {
    return badRequest(res, 'No se puede eliminar: hay técnicos en este departamento.');
  }
  if (db.prepare('SELECT 1 FROM tareas_programadas WHERE grupo_id = ?').get(id)) {
    return badRequest(res, 'No se puede eliminar: hay tareas programadas de este departamento.');
  }
  db.prepare('DELETE FROM grupos WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ---------- Administración: locales ----------

app.get('/api/locales', (req, res) => {
  res.json(db.prepare(`
    SELECT l.id, l.nombre, l.orden,
      (SELECT COUNT(*) FROM usuario_local ul WHERE ul.local_id = l.id) AS usuarios,
      (SELECT COUNT(*) FROM tickets t WHERE t.local_id = l.id) AS tickets
    FROM locales l ORDER BY l.orden, l.nombre
  `).all());
});

app.post('/api/locales', auth.soloAdmin, (req, res) => {
  const nombre = texto(req.body.nombre);
  if (!nombre) return badRequest(res, 'El nombre es obligatorio.');
  if (db.prepare('SELECT 1 FROM locales WHERE nombre = ?').get(nombre)) {
    return badRequest(res, 'Ya existe un local con ese nombre.');
  }
  const orden = db.prepare('SELECT COALESCE(MAX(orden), -1) + 1 AS o FROM locales').get().o;
  const info = db.prepare('INSERT INTO locales (nombre, orden) VALUES (?, ?)').run(nombre, orden);
  res.status(201).json(db.prepare('SELECT * FROM locales WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/locales/:id', auth.soloAdmin, (req, res) => {
  const id = num(req.params.id);
  if (!id || !db.prepare('SELECT 1 FROM locales WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'Local no encontrado.' });
  }
  const nombre = texto(req.body.nombre);
  if (!nombre) return badRequest(res, 'El nombre es obligatorio.');
  if (db.prepare('SELECT 1 FROM locales WHERE nombre = ? AND id != ?').get(nombre, id)) {
    return badRequest(res, 'Ya existe un local con ese nombre.');
  }
  db.prepare('UPDATE locales SET nombre = ? WHERE id = ?').run(nombre, id);
  res.json(db.prepare('SELECT * FROM locales WHERE id = ?').get(id));
});

app.delete('/api/locales/:id', auth.soloAdmin, (req, res) => {
  const id = num(req.params.id);
  if (!id || !db.prepare('SELECT 1 FROM locales WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'Local no encontrado.' });
  }
  if (db.prepare('SELECT 1 FROM tickets WHERE local_id = ?').get(id)) {
    return badRequest(res, 'No se puede eliminar: hay incidencias en este local.');
  }
  if (db.prepare('SELECT 1 FROM tareas_programadas WHERE local_id = ?').get(id)) {
    return badRequest(res, 'No se puede eliminar: hay tareas programadas en este local.');
  }
  // El canal de chat del local se iría en silencio con las claves foráneas, y
  // una conversación de meses no es algo que deba desaparecer sin avisar.
  if (db.prepare('SELECT 1 FROM chat_mensajes WHERE local_id = ?').get(id)) {
    return badRequest(res, 'No se puede eliminar: hay conversación en el chat de este local.');
  }
  db.prepare('DELETE FROM locales WHERE id = ?').run(id);
  chat.borrarCanal(id);
  res.json({ ok: true });
});

// ---------- Administración: áreas (Grupo), familias y subfamilias ----------

// «Área» por dentro, «Grupo» en la interfaz: ver el comentario de la tabla en
// db.js. Es la cabecera de la categoría de la avería; familia cuelga de ella.
app.get('/api/areas', (req, res) => {
  res.json(db.prepare(`
    SELECT a.id, a.nombre, a.orden,
      (SELECT COUNT(*) FROM familias f WHERE f.area_id = a.id) AS familias,
      (SELECT COUNT(*) FROM tickets t WHERE t.area_id = a.id) AS tickets
    FROM areas a ORDER BY a.orden, a.nombre
  `).all());
});

app.post('/api/areas', auth.soloAdmin, (req, res) => {
  const nombre = texto(req.body.nombre);
  if (!nombre) return badRequest(res, 'El nombre es obligatorio.');
  if (db.prepare('SELECT 1 FROM areas WHERE nombre = ?').get(nombre)) {
    return badRequest(res, 'Ya existe un grupo con ese nombre.');
  }
  const orden = db.prepare('SELECT COALESCE(MAX(orden), -1) + 1 AS o FROM areas').get().o;
  const info = db.prepare('INSERT INTO areas (nombre, orden) VALUES (?, ?)').run(nombre, orden);
  res.status(201).json(db.prepare('SELECT * FROM areas WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/areas/:id', auth.soloAdmin, (req, res) => {
  const id = num(req.params.id);
  if (!id || !db.prepare('SELECT 1 FROM areas WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'Grupo no encontrado.' });
  }
  const nombre = texto(req.body.nombre);
  if (!nombre) return badRequest(res, 'El nombre es obligatorio.');
  if (db.prepare('SELECT 1 FROM areas WHERE nombre = ? AND id != ?').get(nombre, id)) {
    return badRequest(res, 'Ya existe un grupo con ese nombre.');
  }
  db.prepare('UPDATE areas SET nombre = ? WHERE id = ?').run(nombre, id);
  res.json(db.prepare('SELECT * FROM areas WHERE id = ?').get(id));
});

app.delete('/api/areas/:id', auth.soloAdmin, (req, res) => {
  const id = num(req.params.id);
  if (!id || !db.prepare('SELECT 1 FROM areas WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'Grupo no encontrado.' });
  }
  if (db.prepare('SELECT 1 FROM tickets WHERE area_id = ?').get(id)) {
    return badRequest(res, 'No se puede eliminar: hay incidencias de este grupo.');
  }
  if (db.prepare('SELECT 1 FROM familias WHERE area_id = ?').get(id)) {
    return badRequest(res, 'No se puede eliminar: tiene familias.');
  }
  db.prepare('DELETE FROM areas WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.get('/api/familias', (req, res) => {
  res.json(db.prepare(`
    SELECT f.id, f.nombre, f.orden, f.area_id,
      (SELECT COUNT(*) FROM subfamilias sf WHERE sf.familia_id = f.id) AS subfamilias,
      (SELECT COUNT(*) FROM tickets t WHERE t.familia_id = f.id) AS tickets
    FROM familias f ORDER BY f.orden, f.nombre
  `).all());
});

app.post('/api/familias', auth.soloAdmin, (req, res) => {
  const nombre = texto(req.body.nombre);
  const areaId = num(req.body.area_id);
  if (!nombre) return badRequest(res, 'El nombre es obligatorio.');
  if (!areaId || !db.prepare('SELECT 1 FROM areas WHERE id = ?').get(areaId)) {
    return badRequest(res, 'El grupo es obligatorio.');
  }
  if (db.prepare('SELECT 1 FROM familias WHERE area_id = ? AND nombre = ?').get(areaId, nombre)) {
    return badRequest(res, 'Ya existe una familia con ese nombre en ese grupo.');
  }
  const orden = db.prepare('SELECT COALESCE(MAX(orden), -1) + 1 AS o FROM familias WHERE area_id = ?')
    .get(areaId).o;
  const info = db.prepare('INSERT INTO familias (nombre, orden, area_id) VALUES (?, ?, ?)')
    .run(nombre, orden, areaId);
  res.status(201).json(db.prepare('SELECT * FROM familias WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/familias/:id', auth.soloAdmin, (req, res) => {
  const id = num(req.params.id);
  const fila = id && db.prepare('SELECT * FROM familias WHERE id = ?').get(id);
  if (!fila) return res.status(404).json({ error: 'Familia no encontrada.' });
  const nombre = texto(req.body.nombre);
  if (!nombre) return badRequest(res, 'El nombre es obligatorio.');
  // El grupo no se toca desde aquí, igual que la familia de una subfamilia:
  // moverla dejaría sin sentido lo que ya cuentan las incidencias que la usan.
  if (db.prepare('SELECT 1 FROM familias WHERE area_id = ? AND nombre = ? AND id != ?')
        .get(fila.area_id, nombre, id)) {
    return badRequest(res, 'Ya existe una familia con ese nombre en ese grupo.');
  }
  db.prepare('UPDATE familias SET nombre = ? WHERE id = ?').run(nombre, id);
  res.json(db.prepare('SELECT * FROM familias WHERE id = ?').get(id));
});

app.delete('/api/familias/:id', auth.soloAdmin, (req, res) => {
  const id = num(req.params.id);
  if (!id || !db.prepare('SELECT 1 FROM familias WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'Familia no encontrada.' });
  }
  if (db.prepare('SELECT 1 FROM tickets WHERE familia_id = ?').get(id)) {
    return badRequest(res, 'No se puede eliminar: hay incidencias de esta familia.');
  }
  if (db.prepare('SELECT 1 FROM subfamilias WHERE familia_id = ?').get(id)) {
    return badRequest(res, 'No se puede eliminar: tiene subfamilias.');
  }
  db.prepare('DELETE FROM familias WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.get('/api/subfamilias', (req, res) => {
  res.json(db.prepare(`
    SELECT sf.id, sf.nombre, sf.orden, sf.familia_id,
      (SELECT COUNT(*) FROM tickets t WHERE t.subfamilia_id = sf.id) AS tickets
    FROM subfamilias sf ORDER BY sf.orden, sf.nombre
  `).all());
});

app.post('/api/subfamilias', auth.soloAdmin, (req, res) => {
  const nombre = texto(req.body.nombre);
  const familiaId = num(req.body.familia_id);
  if (!nombre) return badRequest(res, 'El nombre es obligatorio.');
  if (!familiaId || !db.prepare('SELECT 1 FROM familias WHERE id = ?').get(familiaId)) {
    return badRequest(res, 'La familia es obligatoria.');
  }
  if (db.prepare('SELECT 1 FROM subfamilias WHERE familia_id = ? AND nombre = ?').get(familiaId, nombre)) {
    return badRequest(res, 'Ya existe una subfamilia con ese nombre en esa familia.');
  }
  const orden = db.prepare('SELECT COALESCE(MAX(orden), -1) + 1 AS o FROM subfamilias WHERE familia_id = ?')
    .get(familiaId).o;
  const info = db.prepare('INSERT INTO subfamilias (nombre, orden, familia_id) VALUES (?, ?, ?)')
    .run(nombre, orden, familiaId);
  res.status(201).json(db.prepare('SELECT * FROM subfamilias WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/subfamilias/:id', auth.soloAdmin, (req, res) => {
  const id = num(req.params.id);
  const fila = id && db.prepare('SELECT * FROM subfamilias WHERE id = ?').get(id);
  if (!fila) return res.status(404).json({ error: 'Subfamilia no encontrada.' });
  const nombre = texto(req.body.nombre);
  if (!nombre) return badRequest(res, 'El nombre es obligatorio.');
  // La familia no se toca desde aquí: mover una subfamilia a otra familia
  // dejaría sin sentido lo que ya cuentan las incidencias que la usan.
  if (db.prepare('SELECT 1 FROM subfamilias WHERE familia_id = ? AND nombre = ? AND id != ?')
        .get(fila.familia_id, nombre, id)) {
    return badRequest(res, 'Ya existe una subfamilia con ese nombre en esa familia.');
  }
  db.prepare('UPDATE subfamilias SET nombre = ? WHERE id = ?').run(nombre, id);
  res.json(db.prepare('SELECT * FROM subfamilias WHERE id = ?').get(id));
});

app.delete('/api/subfamilias/:id', auth.soloAdmin, (req, res) => {
  const id = num(req.params.id);
  if (!id || !db.prepare('SELECT 1 FROM subfamilias WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'Subfamilia no encontrada.' });
  }
  if (db.prepare('SELECT 1 FROM tickets WHERE subfamilia_id = ?').get(id)) {
    return badRequest(res, 'No se puede eliminar: hay incidencias de esta subfamilia.');
  }
  db.prepare('DELETE FROM subfamilias WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ---------- Administración: empresas de mantenimiento externo ----------

app.get('/api/empresas', (req, res) => {
  res.json(db.prepare(`
    SELECT e.id, e.nombre, e.contacto, e.telefono, e.email, e.notas, e.orden,
      (SELECT COUNT(*) FROM tareas_programadas t WHERE t.empresa_id = e.id) AS tareas
    FROM empresas e ORDER BY e.orden, e.nombre
  `).all());
});

app.post('/api/empresas', auth.soloAdmin, (req, res) => {
  const nombre = texto(req.body.nombre);
  if (!nombre) return badRequest(res, 'El nombre es obligatorio.');
  if (db.prepare('SELECT 1 FROM empresas WHERE nombre = ?').get(nombre)) {
    return badRequest(res, 'Ya existe una empresa con ese nombre.');
  }
  const orden = db.prepare('SELECT COALESCE(MAX(orden), -1) + 1 AS o FROM empresas').get().o;
  const info = db.prepare(`
    INSERT INTO empresas (nombre, contacto, telefono, email, notas, orden) VALUES (?, ?, ?, ?, ?, ?)
  `).run(nombre, texto(req.body.contacto) || null, texto(req.body.telefono) || null,
    texto(req.body.email) || null, texto(req.body.notas) || null, orden);
  res.status(201).json(db.prepare('SELECT * FROM empresas WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/empresas/:id', auth.soloAdmin, (req, res) => {
  const id = num(req.params.id);
  if (!id || !db.prepare('SELECT 1 FROM empresas WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'Empresa no encontrada.' });
  }
  const nombre = texto(req.body.nombre);
  if (!nombre) return badRequest(res, 'El nombre es obligatorio.');
  if (db.prepare('SELECT 1 FROM empresas WHERE nombre = ? AND id != ?').get(nombre, id)) {
    return badRequest(res, 'Ya existe una empresa con ese nombre.');
  }
  db.prepare(`
    UPDATE empresas SET nombre = ?, contacto = ?, telefono = ?, email = ?, notas = ? WHERE id = ?
  `).run(nombre, texto(req.body.contacto) || null, texto(req.body.telefono) || null,
    texto(req.body.email) || null, texto(req.body.notas) || null, id);
  res.json(db.prepare('SELECT * FROM empresas WHERE id = ?').get(id));
});

app.delete('/api/empresas/:id', auth.soloAdmin, (req, res) => {
  const id = num(req.params.id);
  if (!id || !db.prepare('SELECT 1 FROM empresas WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'Empresa no encontrada.' });
  }
  if (db.prepare('SELECT 1 FROM tareas_programadas WHERE empresa_id = ?').get(id)) {
    return badRequest(res, 'No se puede eliminar: hay tareas programadas de esta empresa.');
  }
  if (db.prepare('SELECT 1 FROM tickets WHERE empresa_id = ?').get(id)) {
    return badRequest(res, 'No se puede eliminar: hay incidencias de esta empresa.');
  }
  db.prepare('DELETE FROM empresas WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ---------- Administración: usuarios ----------


function usuarioConLocales(id) {
  const u = db.prepare(`
    SELECT u.id, u.usuario, u.nombre, u.rol, u.email, u.grupo_id, g.nombre AS grupo_nombre,
           u.creado_en, u.bloqueada,
           -- Si esta cuenta entra con Office 365, para distinguirla en la
           -- lista: su contraseña, si la tiene, no es por donde entra.
           CASE WHEN u.entra_oid IS NULL THEN 0 ELSE 1 END AS entra
    FROM usuarios u LEFT JOIN grupos g ON g.id = u.grupo_id
    WHERE u.id = ?
  `).get(id);
  if (!u) return null;
  u.locales = db.prepare(`
    SELECT l.id, l.nombre FROM usuario_local ul JOIN locales l ON l.id = ul.local_id
    WHERE ul.usuario_id = ? ORDER BY l.orden, l.nombre
  `).all(id);
  return u;
}

// Un correo con la forma mínima: algo, arroba, algo, punto, algo.
function correoValido(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function validarUsuario(body, res, { esAlta }) {
  const nombre = texto(body.nombre);
  const rol = texto(body.rol) || ROL_POR_DEFECTO;
  const password = String(body.password || '');
  const email = texto(body.email).toLowerCase();
  if (!nombre) { badRequest(res, 'El nombre es obligatorio.'); return null; }
  if (!ROLES.includes(rol)) { badRequest(res, 'El rol no es válido.'); return null; }
  // El correo es el acceso de las cuentas nuevas, así que en el alta es
  // obligatorio. En la edición se puede dejar como estaba.
  if (esAlta && !email) { badRequest(res, 'El correo es obligatorio.'); return null; }
  if (email && !correoValido(email)) { badRequest(res, 'El correo no es válido.'); return null; }
  if ((esAlta || password) && password.length < 8) {
    badRequest(res, 'La contraseña debe tener al menos 8 caracteres.'); return null;
  }

  let grupoId = num(body.grupo_id) || null;
  if (rol === 'tecnico') {
    if (!grupoId || !db.prepare('SELECT 1 FROM grupos WHERE id = ?').get(grupoId)) {
      badRequest(res, 'Un técnico tiene que pertenecer a un departamento.'); return null;
    }
  } else {
    // Empleados y administradores no pertenecen a ningún grupo.
    grupoId = null;
  }

  const locales = Array.isArray(body.locales)
    ? [...new Set(body.locales.map(Number).filter(Boolean))]
    : [];
  for (const localId of locales) {
    if (!db.prepare('SELECT 1 FROM locales WHERE id = ?').get(localId)) {
      badRequest(res, 'Alguno de los locales no existe.'); return null;
    }
  }
  // Quien reporta averías necesita al menos un local: es lo que decide dónde
  // puede abrirlas y cuáles ve. Un técnico sin locales atiende todos los de su
  // grupo, así que ahí no hace falta.
  //
  // Sin ninguno marcado se queda con el local por defecto de la instalación,
  // que es donde está la mayoría: así dar de alta a alguien es escribir su
  // nombre y su correo y poco más.
  if (rol === ROL_POR_DEFECTO && !locales.length) {
    const porDefecto = db.prepare('SELECT id FROM locales WHERE nombre = ?').get(LOCAL_POR_DEFECTO);
    if (!porDefecto) {
      badRequest(res, `Asigna al menos un local: no existe «${LOCAL_POR_DEFECTO}».`); return null;
    }
    locales.push(porDefecto.id);
  }

  // El empleado sí necesita uno marcado a mano: ve las incidencias de sus
  // compañeros, así que dónde trabaja es una decisión, no un valor por defecto.
  if (rol === 'empleado' && !locales.length) {
    badRequest(res, 'Asigna al menos un local al empleado.'); return null;
  }

  return { nombre, rol, password, grupoId, locales, email: email || null };
}

function guardarLocales(usuarioId, locales) {
  db.prepare('DELETE FROM usuario_local WHERE usuario_id = ?').run(usuarioId);
  const ins = db.prepare('INSERT OR IGNORE INTO usuario_local (usuario_id, local_id) VALUES (?, ?)');
  for (const id of locales) ins.run(usuarioId, id);
}

app.get('/api/usuarios', auth.soloAdmin, (req, res) => {
  const ids = db.prepare('SELECT id FROM usuarios ORDER BY usuario').all().map((u) => u.id);
  res.json(ids.map(usuarioConLocales));
});

app.post('/api/usuarios', auth.soloAdmin, (req, res) => {
  const datos = validarUsuario(req.body, res, { esAlta: true });
  if (!datos) return;
  // El correo es el nombre de acceso: no hay dos campos que cuadrar ni un
  // usuario que inventarse y luego nadie recuerda.
  const usuario = datos.email;
  if (db.prepare('SELECT 1 FROM usuarios WHERE lower(usuario) = ? OR lower(email) = ?')
        .get(usuario, usuario)) {
    return badRequest(res, 'Ya hay una cuenta con ese correo.');
  }
  const info = db.prepare(`
    INSERT INTO usuarios (usuario, email, nombre, rol, grupo_id, password_hash)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(usuario, datos.email, datos.nombre, datos.rol, datos.grupoId,
         auth.hashPassword(datos.password));
  guardarLocales(info.lastInsertRowid, datos.locales);
  res.status(201).json(usuarioConLocales(info.lastInsertRowid));
});

app.put('/api/usuarios/:id', auth.soloAdmin, (req, res) => {
  const id = num(req.params.id);
  const fila = id && db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
  if (!fila) return res.status(404).json({ error: 'Usuario no encontrado.' });
  const datos = validarUsuario(req.body, res, { esAlta: false });
  if (!datos) return;
  if (fila.rol === 'admin' && datos.rol !== 'admin') {
    const admins = db.prepare("SELECT COUNT(*) AS c FROM usuarios WHERE rol = 'admin'").get().c;
    if (admins <= 1) return badRequest(res, 'No se puede quitar el rol al único administrador.');
  }
  // Un técnico que cambia de grupo deja de ver lo que tenía asignado, así que
  // esas incidencias vuelven a quedar libres.
  if (datos.grupoId !== fila.grupo_id) {
    db.prepare('UPDATE tickets SET asignado_a = NULL WHERE asignado_a = ?').run(id);
  }
  // Cambiar el correo cambia también con qué se entra, porque son lo mismo.
  if (datos.email && datos.email !== fila.email) {
    const ocupado = db.prepare(
      'SELECT 1 FROM usuarios WHERE id != ? AND (lower(usuario) = ? OR lower(email) = ?)'
    ).get(id, datos.email, datos.email);
    if (ocupado) return badRequest(res, 'Ya hay otra cuenta con ese correo.');
    db.prepare('UPDATE usuarios SET email = ?, usuario = ? WHERE id = ?')
      .run(datos.email, datos.email, id);
  }
  db.prepare('UPDATE usuarios SET nombre = ?, rol = ?, grupo_id = ? WHERE id = ?')
    .run(datos.nombre, datos.rol, datos.grupoId, id);
  guardarLocales(id, datos.locales);
  if (datos.password) {
    db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(auth.hashPassword(datos.password), id);
    // Con una contraseña nueva no tiene sentido arrastrar los fallos anteriores.
    auth.limpiarIntentos(id);
    // Al cambiar la contraseña se cierran las demás sesiones de ese usuario.
    db.prepare('DELETE FROM sesiones WHERE usuario_id = ? AND token != ?').run(id, req.sessionToken || '');
  }
  res.json(usuarioConLocales(id));
});

// Reactiva una cuenta bloqueada por intentos fallidos.
app.post('/api/usuarios/:id/desbloquear', auth.soloAdmin, (req, res) => {
  const id = num(req.params.id);
  if (!id || !db.prepare('SELECT 1 FROM usuarios WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'Usuario no encontrado.' });
  }
  auth.limpiarIntentos(id);
  res.json(usuarioConLocales(id));
});

app.delete('/api/usuarios/:id', auth.soloAdmin, (req, res) => {
  const id = num(req.params.id);
  const fila = id && db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
  if (!fila) return res.status(404).json({ error: 'Usuario no encontrado.' });
  if (id === req.user.id) return badRequest(res, 'No puedes eliminar tu propio usuario.');
  if (fila.rol === 'admin') {
    const admins = db.prepare("SELECT COUNT(*) AS c FROM usuarios WHERE rol = 'admin'").get().c;
    if (admins <= 1) return badRequest(res, 'No se puede eliminar el único administrador.');
  }
  // El historial de incidencias no se borra con la persona: si tiene algo a su
  // nombre, la cuenta se queda y se le quitan los locales.
  if (db.prepare('SELECT 1 FROM tickets WHERE creado_por = ? OR asignado_a = ?').get(id, id)) {
    return badRequest(res, 'No se puede eliminar: tiene incidencias a su nombre.');
  }
  if (db.prepare('SELECT 1 FROM mensajes WHERE autor_id = ?').get(id)) {
    return badRequest(res, 'No se puede eliminar: ha escrito en el hilo de alguna incidencia.');
  }
  db.prepare('DELETE FROM usuarios WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ---------- Administración: tareas programadas ----------

function tareaConNombres(id) {
  const tarea = db.prepare(`
    SELECT t.*, g.nombre AS grupo_nombre, l.nombre AS local_nombre, e.nombre AS empresa_nombre,
      ar.nombre AS area_nombre, f.nombre AS familia_nombre, sf.nombre AS subfamilia_nombre,
      (SELECT COUNT(*) FROM tickets ti WHERE ti.tarea_id = t.id) AS tickets
    FROM tareas_programadas t
    JOIN grupos g ON g.id = t.grupo_id
    LEFT JOIN locales l ON l.id = t.local_id
    LEFT JOIN empresas e ON e.id = t.empresa_id
    LEFT JOIN areas ar ON ar.id = t.area_id
    LEFT JOIN familias f ON f.id = t.familia_id
    LEFT JOIN subfamilias sf ON sf.id = t.subfamilia_id
    WHERE t.id = ?
  `).get(id);
  if (!tarea) return null;
  // Cuándo le toca la próxima vez. Sin esto no hay forma de saber si una tarea
  // recién creada va a hacer algo, y una tarea puesta a una hora que ya pasó
  // parece averiada hasta el día siguiente.
  const proxima = tarea.activo ? planificacion.proximo(planificacion.desdeFila(tarea)) : null;
  tarea.proxima = proxima ? proxima.toISOString() : null;
  // La hora va escrita desde aquí, en la zona de la aplicación, que es la que
  // se usó para programarla. Si la pusiera el navegador, un portátil con otra
  // zona enseñaría una hora distinta de la que dice la columna «Cuándo».
  tarea.proxima_texto = proxima ? planificacion.comoTexto(proxima) : null;
  return tarea;
}

app.get('/api/tareas', auth.soloProgramador, (req, res) => {
  const ids = db.prepare('SELECT id FROM tareas_programadas ORDER BY nombre').all().map((t) => t.id);
  res.json(ids.map(tareaConNombres));
});

function validarTarea(body, res) {
  const nombre = texto(body.nombre);
  const titulo = texto(body.plantilla_titulo);
  const grupoId = num(body.grupo_id);
  const localId = num(body.local_id) || null;
  const prioridad = texto(body.prioridad) || 'normal';

  if (!nombre) { badRequest(res, 'El nombre es obligatorio.'); return null; }

  // Cuándo se repite: lo comprueba planificacion.js, que devuelve el mensaje
  // ya redactado para el administrador.
  const plan = planificacion.validar({
    frecuencia: body.frecuencia,
    hora: body.hora,
    desde: body.fecha_inicio,
    cada: body.cada,
    diasSemana: body.dias_semana,
    diasMes: body.dias_mes,
    meses: body.meses
  });
  if (!plan.ok) { badRequest(res, plan.error); return null; }

  if (!titulo) { badRequest(res, 'El título de la incidencia es obligatorio.'); return null; }
  if (!grupoId || !db.prepare('SELECT 1 FROM grupos WHERE id = ?').get(grupoId)) {
    badRequest(res, 'El departamento es obligatorio.'); return null;
  }
  if (localId && !db.prepare('SELECT 1 FROM locales WHERE id = ?').get(localId)) {
    badRequest(res, 'El local no existe.'); return null;
  }
  if (!PRIORIDADES.includes(prioridad)) { badRequest(res, 'La prioridad no es válida.'); return null; }

  // Cuando la lleva una empresa externa, hay que decir cuál: de la lista de
  // las que tienen contrato, no cualquier nombre suelto.
  const mantenimientoExterno = body.mantenimiento_externo === true;
  let empresaId = null;
  if (mantenimientoExterno) {
    empresaId = num(body.empresa_id);
    if (!empresaId || !db.prepare('SELECT 1 FROM empresas WHERE id = ?').get(empresaId)) {
      badRequest(res, 'La empresa es obligatoria en el mantenimiento externo.'); return null;
    }
  }

  // El grupo, la familia y la subfamilia del equipo que mantiene son
  // opcionales aquí (a diferencia de una incidencia manual), pero si vienen
  // tienen que corresponderse, para que el calendario no enseñe disparates.
  const areaId = num(body.area_id) || null;
  if (areaId && !db.prepare('SELECT 1 FROM areas WHERE id = ?').get(areaId)) {
    badRequest(res, 'El grupo no existe.'); return null;
  }
  const familiaId = num(body.familia_id) || null;
  let familia = null;
  if (familiaId) {
    familia = db.prepare('SELECT area_id FROM familias WHERE id = ?').get(familiaId);
    if (!familia) { badRequest(res, 'La familia no existe.'); return null; }
    if (areaId && familia.area_id !== areaId) {
      badRequest(res, 'La familia no pertenece a ese grupo.'); return null;
    }
  }
  const subfamiliaId = num(body.subfamilia_id) || null;
  if (subfamiliaId) {
    const subfamilia = db.prepare('SELECT familia_id FROM subfamilias WHERE id = ?').get(subfamiliaId);
    if (!subfamilia) { badRequest(res, 'La subfamilia no existe.'); return null; }
    if (!familiaId || subfamilia.familia_id !== familiaId) {
      badRequest(res, 'La subfamilia no pertenece a esa familia.'); return null;
    }
  }

  return {
    nombre,
    ...planificacion.comoFila(plan.plan),
    plantilla_titulo: titulo,
    plantilla_descripcion: texto(body.plantilla_descripcion) || null,
    grupo_id: grupoId,
    local_id: localId,
    prioridad,
    activo: body.activo === false ? 0 : 1,
    mantenimiento_externo: mantenimientoExterno ? 1 : 0,
    empresa_id: empresaId,
    area_id: areaId || (familia ? familia.area_id : null),
    familia_id: familiaId,
    subfamilia_id: subfamiliaId
  };
}

app.post('/api/tareas', auth.soloProgramador, (req, res) => {
  const t = validarTarea(req.body, res);
  if (!t) return;
  // La tarea empieza a contar desde ahora: si no, su primer repaso abriría de
  // golpe todos los vencimientos de la última semana.
  const info = db.prepare(`
    INSERT INTO tareas_programadas
      (nombre, frecuencia, hora, fecha_inicio, cada, dias_semana, dias_mes, meses,
       plantilla_titulo, plantilla_descripcion, grupo_id, local_id, prioridad, activo,
       mantenimiento_externo, empresa_id, area_id, familia_id, subfamilia_id, evaluada_hasta)
    VALUES (@nombre, @frecuencia, @hora, @fecha_inicio, @cada, @dias_semana, @dias_mes, @meses,
       @plantilla_titulo, @plantilla_descripcion, @grupo_id, @local_id, @prioridad, @activo,
       @mantenimiento_externo, @empresa_id, @area_id, @familia_id, @subfamilia_id, @evaluada_hasta)
  `).run({ ...t, evaluada_hasta: programador.comoTexto(new Date()) });
  res.status(201).json(tareaConNombres(info.lastInsertRowid));
});

app.put('/api/tareas/:id', auth.soloProgramador, (req, res) => {
  const id = num(req.params.id);
  if (!id || !db.prepare('SELECT 1 FROM tareas_programadas WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'Tarea no encontrada.' });
  }
  const t = validarTarea(req.body, res);
  if (!t) return;
  db.prepare(`
    UPDATE tareas_programadas SET nombre = @nombre, frecuencia = @frecuencia, hora = @hora,
      fecha_inicio = @fecha_inicio, cada = @cada, dias_semana = @dias_semana,
      dias_mes = @dias_mes, meses = @meses,
      plantilla_titulo = @plantilla_titulo, plantilla_descripcion = @plantilla_descripcion,
      grupo_id = @grupo_id, local_id = @local_id, prioridad = @prioridad, activo = @activo,
      mantenimiento_externo = @mantenimiento_externo, empresa_id = @empresa_id,
      area_id = @area_id, familia_id = @familia_id, subfamilia_id = @subfamilia_id
    WHERE id = @id
  `).run({ ...t, id });
  res.json(tareaConNombres(id));
});

app.delete('/api/tareas/:id', auth.soloProgramador, (req, res) => {
  const id = num(req.params.id);
  if (!id || !db.prepare('SELECT 1 FROM tareas_programadas WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'Tarea no encontrada.' });
  }
  // Las incidencias que abrió se quedan; solo pierden el rastro de la tarea.
  db.prepare('DELETE FROM tareas_programadas WHERE id = ?').run(id);
  res.json({ ok: true });
});

// Cómo va el programador. Se enseña en la pantalla de tareas: si el último
// repaso se queda parado, el problema se ve en vez de suponerse.
app.get('/api/programador', auth.soloProgramador, (req, res) => {
  res.json(programador.estado());
});

// Lanza la tarea al momento, para comprobar que hace lo que se espera sin
// tener que esperar a que le toque.
app.post('/api/tareas/:id/ejecutar', auth.soloProgramador, (req, res) => {
  const id = num(req.params.id);
  const tarea = id && db.prepare('SELECT * FROM tareas_programadas WHERE id = ?').get(id);
  if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada.' });
  const creadas = programador.abrirIncidencias(tarea);
  for (const ticket of creadas) notificaciones.avisarTicketCreado(ticket);
  res.json({ creadas: creadas.length });
});

// ---------- Calendario de mantenimiento preventivo ----------

// Las tareas activas que cumplen los filtros, con su plan ya listo para
// `planificacion.ocurrenciasEnMes`.
//
// Un técnico solo ve el mantenimiento de su propio departamento: el de
// Informática no tiene por qué enterarse del de Mantenimiento, y viceversa.
// Se impone aquí, no como un filtro más que se pudiera pedir de otra manera,
// para que no se pueda sortear cambiando lo que se manda en la consulta.
function tareasParaCalendario(query, user) {
  const where = ['t.activo = 1'];
  const params = [];
  if (user.rol === 'tecnico') {
    where.push('t.grupo_id = ?');
    params.push(user.grupo_id);
  } else if (query.grupo_id) {
    where.push('t.grupo_id = ?');
    params.push(Number(query.grupo_id));
  }
  if (query.area_id) { where.push('t.area_id = ?'); params.push(Number(query.area_id)); }
  if (query.familia_id) { where.push('t.familia_id = ?'); params.push(Number(query.familia_id)); }
  if (query.empresa_id) { where.push('t.empresa_id = ?'); params.push(Number(query.empresa_id)); }
  if (query.mantenimiento_externo) {
    where.push('t.mantenimiento_externo = ?');
    params.push(query.mantenimiento_externo === '1' ? 1 : 0);
  }

  return db.prepare(`
    SELECT t.id, t.nombre, t.frecuencia, t.hora, t.fecha_inicio, t.cada,
      t.dias_semana, t.dias_mes, t.meses, t.plantilla_titulo, t.mantenimiento_externo,
      g.nombre AS grupo_nombre, l.nombre AS local_nombre, e.nombre AS empresa_nombre,
      ar.nombre AS area_nombre, f.nombre AS familia_nombre, sf.nombre AS subfamilia_nombre
    FROM tareas_programadas t
    JOIN grupos g ON g.id = t.grupo_id
    LEFT JOIN locales l ON l.id = t.local_id
    LEFT JOIN empresas e ON e.id = t.empresa_id
    LEFT JOIN areas ar ON ar.id = t.area_id
    LEFT JOIN familias f ON f.id = t.familia_id
    LEFT JOIN subfamilias sf ON sf.id = t.subfamilia_id
    WHERE ${where.join(' AND ')}
    ORDER BY t.hora, t.nombre
  `).all(...params);
}

// Qué incidencias abrió cada tarea, día a día, en el mes pedido: un repaso
// vale para varios días a la vez, así que se trae de una sola consulta en vez
// de una por tarea. Cuenta cuántas hay en total y cuántas están cerradas, que
// es lo que hace falta para decidir el estado de cada evento del calendario.
function ticketsPorDia(idsTareas, anio, mes) {
  const mapa = new Map();
  if (!idsTareas.length) return mapa;
  const marcador = idsTareas.map(() => '?').join(',');
  const filas = db.prepare(`
    SELECT tarea_id, CAST(strftime('%d', creado_en) AS INTEGER) AS dia, estado
    FROM tickets
    WHERE tarea_id IN (${marcador}) AND strftime('%Y-%m', creado_en) = ?
  `).all(...idsTareas, `${anio}-${String(mes).padStart(2, '0')}`);
  for (const f of filas) {
    const clave = `${f.tarea_id}:${f.dia}`;
    const fila = mapa.get(clave) || { total: 0, cerrados: 0 };
    fila.total += 1;
    if (f.estado === 'cerrado') fila.cerrados += 1;
    mapa.set(clave, fila);
  }
  return mapa;
}

// El estado de un evento del calendario, para pintarlo: «cerrada» si todas
// las incidencias que abrió ese día ya están resueltas, «atrasada» si el día
// ya pasó y no es así (naranja de aviso, aunque hoy no cuenta como atrasado
// todavía: puede resolverse a lo largo del día), «pendiente» si es hoy, y
// «programada» si todavía no ha llegado.
function estadoEvento(info, anio, mes, dia, hoy) {
  if (info && info.total > 0 && info.cerrados === info.total) return 'cerrada';
  const numero = anio * 10000 + mes * 100 + Number(dia);
  const numeroHoy = hoy.anio * 10000 + hoy.mes * 100 + hoy.dia;
  if (numero < numeroHoy) return 'atrasada';
  if (numero === numeroHoy) return 'pendiente';
  return 'programada';
}

// Sin `mes`, un resumen del año entero (qué días de cada mes tienen alguna
// tarea, para las minirrejillas); con `mes`, el detalle día a día de ese mes,
// como una agenda.
app.get('/api/calendario', auth.soloCalendario, (req, res) => {
  const anio = num(req.query.anio) || new Date().getFullYear();
  const mes = num(req.query.mes);
  const tareas = tareasParaCalendario(req.query, req.user);

  if (mes && (mes < 1 || mes > 12)) return badRequest(res, 'El mes no es válido.');

  if (mes) {
    const porDia = {};
    for (const t of tareas) {
      const plan = planificacion.desdeFila(t);
      for (const dia of planificacion.ocurrenciasEnMes(plan, anio, mes)) {
        (porDia[dia] = porDia[dia] || []).push(t);
      }
    }
    const tickets = ticketsPorDia(tareas.map((t) => t.id), anio, mes);
    const hoy = planificacion.enZona(new Date());
    const dias = {};
    for (const [dia, lista] of Object.entries(porDia)) {
      dias[dia] = lista.map((t) => ({
        id: t.id,
        nombre: t.nombre,
        plantilla_titulo: t.plantilla_titulo,
        hora: t.hora,
        grupo_nombre: t.grupo_nombre,
        local_nombre: t.local_nombre,
        area_nombre: t.area_nombre,
        familia_nombre: t.familia_nombre,
        empresa_nombre: t.empresa_nombre,
        mantenimiento_externo: t.mantenimiento_externo,
        estado: estadoEvento(tickets.get(`${t.id}:${dia}`), anio, mes, dia, hoy)
      }));
    }
    return res.json({ anio, mes, dias });
  }

  const meses = [];
  for (let m = 1; m <= 12; m += 1) {
    const diasDelMes = new Set();
    let tareasDelMes = 0;
    for (const t of tareas) {
      const ocurrencias = planificacion.ocurrenciasEnMes(planificacion.desdeFila(t), anio, m);
      if (ocurrencias.length) tareasDelMes += 1;
      ocurrencias.forEach((d) => diasDelMes.add(d));
    }
    meses.push({ mes: m, dias: [...diasDelMes].sort((a, b) => a - b), tareas: tareasDelMes });
  }
  res.json({ anio, meses });
});

// ---------- Lavandería ----------

// El catálogo de prendas que se mandan a lavar. Lo mantiene el administrador;
// lo usa cualquiera que registre un envío.
app.get('/api/prendas-lavanderia', (req, res) => {
  res.json(db.prepare(`
    SELECT p.id, p.nombre, p.orden,
      (SELECT COUNT(*) FROM envio_lavanderia_items i WHERE i.prenda_id = p.id) AS usos
    FROM prendas_lavanderia p ORDER BY p.orden, p.nombre
  `).all());
});

app.post('/api/prendas-lavanderia', auth.soloAdmin, (req, res) => {
  const nombre = texto(req.body.nombre);
  if (!nombre) return badRequest(res, 'El nombre es obligatorio.');
  if (db.prepare('SELECT 1 FROM prendas_lavanderia WHERE nombre = ?').get(nombre)) {
    return badRequest(res, 'Ya existe una prenda con ese nombre.');
  }
  const orden = db.prepare('SELECT COALESCE(MAX(orden), -1) + 1 AS o FROM prendas_lavanderia').get().o;
  const info = db.prepare('INSERT INTO prendas_lavanderia (nombre, orden) VALUES (?, ?)').run(nombre, orden);
  res.status(201).json(db.prepare('SELECT * FROM prendas_lavanderia WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/prendas-lavanderia/:id', auth.soloAdmin, (req, res) => {
  const id = num(req.params.id);
  if (!id || !db.prepare('SELECT 1 FROM prendas_lavanderia WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'Prenda no encontrada.' });
  }
  const nombre = texto(req.body.nombre);
  if (!nombre) return badRequest(res, 'El nombre es obligatorio.');
  if (db.prepare('SELECT 1 FROM prendas_lavanderia WHERE nombre = ? AND id != ?').get(nombre, id)) {
    return badRequest(res, 'Ya existe una prenda con ese nombre.');
  }
  db.prepare('UPDATE prendas_lavanderia SET nombre = ? WHERE id = ?').run(nombre, id);
  res.json(db.prepare('SELECT * FROM prendas_lavanderia WHERE id = ?').get(id));
});

app.delete('/api/prendas-lavanderia/:id', auth.soloAdmin, (req, res) => {
  const id = num(req.params.id);
  if (!id || !db.prepare('SELECT 1 FROM prendas_lavanderia WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'Prenda no encontrada.' });
  }
  if (db.prepare('SELECT 1 FROM envio_lavanderia_items WHERE prenda_id = ?').get(id)) {
    return badRequest(res, 'No se puede eliminar: hay envíos con esta prenda.');
  }
  db.prepare('DELETE FROM prendas_lavanderia WHERE id = ?').run(id);
  res.json({ ok: true });
});

// Un envío con sus prendas, ya con los nombres puestos.
function envioConDetalle(id) {
  const envio = db.prepare(`
    SELECT e.*, l.nombre AS local_nombre, c.nombre AS creado_por_nombre, r.nombre AS recibido_por_nombre
    FROM envios_lavanderia e
    JOIN locales l ON l.id = e.local_id
    JOIN usuarios c ON c.id = e.creado_por
    LEFT JOIN usuarios r ON r.id = e.recibido_por
    WHERE e.id = ?
  `).get(id);
  if (!envio) return null;
  envio.items = db.prepare(`
    SELECT i.prenda_id, p.nombre AS prenda_nombre, i.enviado, i.recibido
    FROM envio_lavanderia_items i JOIN prendas_lavanderia p ON p.id = i.prenda_id
    WHERE i.envio_id = ? ORDER BY p.orden, p.nombre
  `).all(id);
  return envio;
}

// Qué se manda a lavar al final del turno, para poder contarlo cuando vuelve.
// Ve y registra envíos quien trabaja en el local: el rol «usuario» —que solo
// reporta lo suyo— queda fuera, todos los demás dentro.
app.get('/api/lavanderia', auth.soloLavanderia, (req, res) => {
  const permitidos = auth.localesPermitidos(req.user);
  const where = ['e.local_id IN (' + (permitidos.length ? permitidos.map(() => '?').join(',') : 'NULL') + ')'];
  const params = [...permitidos];
  if (req.query.local_id) { where.push('e.local_id = ?'); params.push(Number(req.query.local_id)); }
  if (req.query.estado === 'pendiente') where.push('e.recibido_en IS NULL');
  if (req.query.estado === 'recibido') where.push('e.recibido_en IS NOT NULL');
  // El rango es opcional: sin fechas se enseñan los últimos envíos, sin más.
  const desde = texto(req.query.desde);
  const hasta = texto(req.query.hasta);
  if (desde || hasta) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
      return badRequest(res, 'El rango de fechas no es válido.');
    }
    if (desde > hasta) return badRequest(res, 'La fecha de inicio no puede ser posterior a la de fin.');
    where.push('e.creado_en BETWEEN ? AND ?');
    params.push(comoMarcaUTC(desde, 0, 0, 0), comoMarcaUTC(hasta, 23, 59, 59));
  }

  const ids = db.prepare(`
    SELECT e.id FROM envios_lavanderia e
    WHERE ${where.join(' AND ')}
    ORDER BY e.creado_en DESC LIMIT 200
  `).all(...params).map((f) => f.id);
  res.json(ids.map(envioConDetalle));
});

app.post('/api/lavanderia', auth.soloLavanderia, (req, res) => {
  const localId = num(req.body.local_id);
  if (!localId || !auth.localesPermitidos(req.user).includes(localId)) {
    return badRequest(res, 'El local es obligatorio.');
  }
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  const limpios = items
    .map((i) => ({ prenda_id: num(i.prenda_id), enviado: num(i.enviado) }))
    .filter((i) => i.prenda_id && i.enviado > 0);
  if (!limpios.length) return badRequest(res, 'Indica al menos una prenda con cantidad enviada.');
  for (const i of limpios) {
    if (!db.prepare('SELECT 1 FROM prendas_lavanderia WHERE id = ?').get(i.prenda_id)) {
      return badRequest(res, 'Alguna de las prendas no existe.');
    }
  }

  const info = db.transaction(() => {
    const alta = db.prepare(`
      INSERT INTO envios_lavanderia (local_id, creado_por, notas) VALUES (?, ?, ?)
    `).run(localId, req.user.id, texto(req.body.notas) || null);
    const insItem = db.prepare(`
      INSERT INTO envio_lavanderia_items (envio_id, prenda_id, enviado) VALUES (?, ?, ?)
    `);
    for (const i of limpios) insItem.run(alta.lastInsertRowid, i.prenda_id, i.enviado);
    return alta;
  })();
  res.status(201).json(envioConDetalle(info.lastInsertRowid));
});

app.put('/api/lavanderia/:id/recepcion', auth.soloLavanderia, (req, res) => {
  const id = num(req.params.id);
  const envio = id && db.prepare('SELECT * FROM envios_lavanderia WHERE id = ?').get(id);
  if (!envio) return res.status(404).json({ error: 'Envío no encontrado.' });
  if (!auth.localesPermitidos(req.user).includes(envio.local_id)) {
    return res.status(403).json({ error: 'No gestionas ese local.' });
  }
  if (envio.recibido_en) return badRequest(res, 'Este envío ya se ha contado a la vuelta.');

  const originales = db.prepare('SELECT prenda_id FROM envio_lavanderia_items WHERE envio_id = ?').all(id)
    .map((f) => f.prenda_id);
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  const limpios = items
    .map((i) => ({ prenda_id: num(i.prenda_id), recibido: num(i.recibido) ?? 0 }))
    .filter((i) => i.prenda_id);
  const idsRecibidos = limpios.map((i) => i.prenda_id).sort((a, b) => a - b);
  if (JSON.stringify(idsRecibidos) !== JSON.stringify([...originales].sort((a, b) => a - b))) {
    return badRequest(res, 'Faltan prendas por contar, o hay alguna que no se envió.');
  }
  if (limpios.some((i) => i.recibido < 0)) {
    return badRequest(res, 'La cantidad recibida no puede ser negativa.');
  }

  db.transaction(() => {
    db.prepare(`
      UPDATE envios_lavanderia SET recibido_en = datetime('now'), recibido_por = ?, notas_recepcion = ?
      WHERE id = ?
    `).run(req.user.id, texto(req.body.notas_recepcion) || null, id);
    const actualizar = db.prepare(`
      UPDATE envio_lavanderia_items SET recibido = ? WHERE envio_id = ? AND prenda_id = ?
    `);
    for (const i of limpios) actualizar.run(i.recibido, id, i.prenda_id);
  })();
  res.json(envioConDetalle(id));
});

app.delete('/api/lavanderia/:id', auth.soloAdmin, (req, res) => {
  const id = num(req.params.id);
  if (!id || !db.prepare('SELECT 1 FROM envios_lavanderia WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'Envío no encontrado.' });
  }
  db.prepare('DELETE FROM envios_lavanderia WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ---------- Inventario ----------

const ESTADOS_ACTIVO = ['en_uso', 'roto', 'almacen'];
const ACTIVOS_DIR = path.join(db.carpetaDatos, 'activos');

const ACTIVO_SELECT = `
  SELECT a.*, l.nombre AS local_nombre, g.nombre AS grupo_nombre
  FROM activos a
  JOIN locales l ON l.id = a.local_id
  JOIN grupos g ON g.id = a.grupo_id
`;

function leerActivo(id) {
  return db.prepare(`${ACTIVO_SELECT} WHERE a.id = ?`).get(id);
}

function borrarFotoDe(activo) {
  if (!activo.foto) return;
  try {
    fs.unlinkSync(path.join(ACTIVOS_DIR, activo.foto));
  } catch (e) { /* ya no estaba */ }
}

app.get('/api/activos', auth.soloInventario, (req, res) => {
  const where = [];
  const params = [];
  if (req.query.grupo_id) { where.push('a.grupo_id = ?'); params.push(Number(req.query.grupo_id)); }
  if (req.query.local_id) { where.push('a.local_id = ?'); params.push(Number(req.query.local_id)); }
  if (req.query.estado) { where.push('a.estado = ?'); params.push(texto(req.query.estado)); }
  for (const palabra of normalizar(texto(req.query.q)).split(/\s+/).filter(Boolean)) {
    where.push("normaliza(a.nombre || ' ' || COALESCE(a.descripcion, '')) LIKE ? ESCAPE '\\'");
    params.push(`%${palabra.replace(/[\\%_]/g, '\\$&')}%`);
  }
  const sql = `${ACTIVO_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY a.nombre`;
  res.json(db.prepare(sql).all(...params));
});

app.get('/api/activos/:id', auth.soloInventario, (req, res) => {
  const id = num(req.params.id);
  const activo = id && leerActivo(id);
  if (!activo) return res.status(404).json({ error: 'Activo no encontrado.' });
  // El registro de incidencias no se guarda aparte: se saca al vuelo de las
  // incidencias que lo señalan, igual que la merma de lavandería se calcula en
  // vez de guardarse.
  activo.incidencias = db.prepare(`
    SELECT t.id, t.titulo, t.descripcion, t.estado, t.creado_en, t.cerrado_en
    FROM tickets t WHERE t.activo_id = ? ORDER BY t.creado_en DESC
  `).all(id);
  res.json(activo);
});

app.post('/api/activos', auth.soloInventario, (req, res) => {
  const nombre = texto(req.body.nombre);
  const descripcion = texto(req.body.descripcion) || null;
  const estado = texto(req.body.estado) || 'en_uso';
  const localId = num(req.body.local_id);
  const grupoId = num(req.body.grupo_id);

  if (!nombre) return badRequest(res, 'El nombre es obligatorio.');
  if (!ESTADOS_ACTIVO.includes(estado)) return badRequest(res, 'El estado no es válido.');
  if (!localId || !db.prepare('SELECT 1 FROM locales WHERE id = ?').get(localId)) {
    return badRequest(res, 'El local es obligatorio.');
  }
  if (!grupoId || !db.prepare('SELECT 1 FROM grupos WHERE id = ?').get(grupoId)) {
    return badRequest(res, 'El departamento es obligatorio.');
  }

  const info = db.prepare(`
    INSERT INTO activos (nombre, descripcion, estado, local_id, grupo_id) VALUES (?, ?, ?, ?, ?)
  `).run(nombre, descripcion, estado, localId, grupoId);
  res.status(201).json(leerActivo(info.lastInsertRowid));
});

app.put('/api/activos/:id', auth.soloInventario, (req, res) => {
  const id = num(req.params.id);
  const activo = id && leerActivo(id);
  if (!activo) return res.status(404).json({ error: 'Activo no encontrado.' });

  const nombre = texto(req.body.nombre);
  const descripcion = texto(req.body.descripcion) || null;
  const estado = texto(req.body.estado) || activo.estado;
  const localId = num(req.body.local_id) || activo.local_id;
  const grupoId = num(req.body.grupo_id) || activo.grupo_id;

  if (!nombre) return badRequest(res, 'El nombre es obligatorio.');
  if (!ESTADOS_ACTIVO.includes(estado)) return badRequest(res, 'El estado no es válido.');
  if (!db.prepare('SELECT 1 FROM locales WHERE id = ?').get(localId)) {
    return badRequest(res, 'El local es obligatorio.');
  }
  if (!db.prepare('SELECT 1 FROM grupos WHERE id = ?').get(grupoId)) {
    return badRequest(res, 'El departamento es obligatorio.');
  }

  db.prepare(`
    UPDATE activos SET nombre = ?, descripcion = ?, estado = ?, local_id = ?, grupo_id = ?,
      actualizado_en = datetime('now')
    WHERE id = ?
  `).run(nombre, descripcion, estado, localId, grupoId, id);
  res.json(leerActivo(id));
});

app.delete('/api/activos/:id', auth.soloInventario, (req, res) => {
  const id = num(req.params.id);
  const activo = id && leerActivo(id);
  if (!activo) return res.status(404).json({ error: 'Activo no encontrado.' });
  if (db.prepare('SELECT 1 FROM tickets WHERE activo_id = ?').get(id)) {
    return badRequest(res, 'No se puede eliminar: tiene incidencias registradas.');
  }
  borrarFotoDe(activo);
  db.prepare('DELETE FROM activos WHERE id = ?').run(id);
  res.json({ ok: true });
});

// La foto llega como cuerpo binario, igual que un adjunto de incidencia; solo
// que aquí no hace falta un directorio por activo, porque cada uno tiene como
// mucho una.
app.post('/api/activos/:id/foto', auth.soloInventario, express.raw({ type: '*/*', limit: MAX_ADJUNTO }), (req, res) => {
  const id = num(req.params.id);
  const activo = id && leerActivo(id);
  if (!activo) return res.status(404).json({ error: 'Activo no encontrado.' });
  if (!Buffer.isBuffer(req.body) || !req.body.length) {
    return badRequest(res, 'No se ha recibido ningún archivo.');
  }
  const extension = path.extname(nombreSeguro(req.query.nombre, 'foto')).toLowerCase();
  const tipo = TIPOS_ADJUNTO[extension];
  if (!tipo || tipo[1] !== 'imagen') {
    return badRequest(res, 'Formato no admitido: adjunta una imagen (JPG, PNG, WEBP, GIF o HEIC).');
  }
  if (req.body.length > MAX_ADJUNTO) {
    return res.status(413).json({ error: `La foto no puede superar los ${enMegas(MAX_ADJUNTO)}.` });
  }

  fs.mkdirSync(ACTIVOS_DIR, { recursive: true });
  borrarFotoDe(activo);
  const archivo = `${id}${extension}`;
  fs.writeFileSync(path.join(ACTIVOS_DIR, archivo), req.body);
  db.prepare("UPDATE activos SET foto = ?, actualizado_en = datetime('now') WHERE id = ?").run(archivo, id);
  res.status(201).json(leerActivo(id));
});

app.get('/api/activos/:id/foto', auth.soloInventario, (req, res) => {
  const id = num(req.params.id);
  const activo = id && leerActivo(id);
  if (!activo || !activo.foto) return res.status(404).json({ error: 'Sin foto.' });
  const absoluto = path.join(ACTIVOS_DIR, activo.foto);
  if (!fs.existsSync(absoluto)) return res.status(404).json({ error: 'El archivo ya no está en el servidor.' });
  const tipo = TIPOS_ADJUNTO[path.extname(activo.foto).toLowerCase()];
  res.setHeader('Content-Type', (tipo && tipo[0]) || 'application/octet-stream');
  res.sendFile(absoluto);
});

app.delete('/api/activos/:id/foto', auth.soloInventario, (req, res) => {
  const id = num(req.params.id);
  const activo = id && leerActivo(id);
  if (!activo) return res.status(404).json({ error: 'Activo no encontrado.' });
  borrarFotoDe(activo);
  db.prepare("UPDATE activos SET foto = NULL, actualizado_en = datetime('now') WHERE id = ?").run(id);
  res.json(leerActivo(id));
});

// Los errores del propio Express (un adjunto demasiado grande, un JSON roto)
// deben llegar al navegador con el mismo formato que el resto de la API.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: `El adjunto no puede superar los ${enMegas(MAX_VIDEO)}.` });
  }
  console.error(err);
  res.status(500).json({ error: 'Error inesperado en el servidor.' });
});

if (require.main === module) {
  programador.arrancar();
  chat.arrancar();
  // Deja dicho en el registro del arranque si el botón de Office 365 va a salir,
  // igual que el programador anuncia sus tareas.
  entra.activo();
  app.listen(PORT, () => {
    console.log(`${organizacion.nombre()} · Incidencias, en http://localhost:${PORT}`);
  });
}

module.exports = app;
