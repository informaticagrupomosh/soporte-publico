'use strict';

const crypto = require('crypto');
const db = require('./db');
const organizacion = require('./organizacion');

// Lista explícita en vez de «todos menos empleado»: al aparecer el rol
// «usuario» esa forma le habría dado permisos de técnico sin que nadie lo
// notara.
const GESTIONAN = ['tecnico', 'gestor', 'admin'];

const DIAS_SESION = 30;
const COOKIE = 'incidencias_sesion';

// Con qué se da de alta a alguien cuando nadie dice otra cosa: el rol más
// recortado y el local donde está la mayoría. Vale tanto para el alta a mano
// desde Usuarios como para la cuenta que se crea sola al entrar con Office 365.
const ROL_POR_DEFECTO = 'usuario';
// El nombre del local sale de `data/organizacion.json`: en una instalación es
// la sede o la oficina central, y no tiene por qué llamarse igual en dos.
const LOCAL_POR_DEFECTO = organizacion.localPorDefecto();

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password, almacenado) {
  const [saltHex, hashHex] = String(almacenado || '').split(':');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 32);
  const esperado = Buffer.from(hashHex, 'hex');
  return hash.length === esperado.length && crypto.timingSafeEqual(hash, esperado);
}

// ---------- Protección del acceso ----------

// Esperas tras N intentos fallidos consecutivos, en segundos. Al llegar a
// INTENTOS_MAX la cuenta queda bloqueada y solo la reactiva un administrador.
const ESPERAS = [[3, 60], [6, 180], [9, 300]];
const INTENTOS_MAX = 10;
const MENSAJE_BLOQUEADA = 'Contacta con el administrador de la web para reactivar tu acceso.';

function mensajeEspera(segundos) {
  const minutos = Math.ceil(segundos / 60);
  const cuanto = segundos < 60
    ? `${segundos} segundo${segundos === 1 ? '' : 's'}`
    : `${minutos} minuto${minutos === 1 ? '' : 's'}`;
  return `Demasiados intentos fallidos. Vuelve a intentarlo en ${cuanto}.`;
}

// Segundos que faltan para que expire la espera en curso (0 si no hay ninguna).
function segundosDeEspera(fila) {
  if (!fila.bloqueado_hasta) return 0;
  const restante = db.prepare(
    "SELECT CAST(strftime('%s', ?) - strftime('%s', 'now') AS INTEGER) AS s"
  ).get(fila.bloqueado_hasta);
  return restante && restante.s > 0 ? restante.s : 0;
}

/**
 * Anota un intento fallido y devuelve el castigo que toca: `{ bloqueada: true }`
 * al agotar los intentos, `{ espera }` en segundos al alcanzar un escalón, o
 * `{}` si todavía quedan intentos antes del siguiente.
 */
function registrarFallo(fila) {
  const intentos = (fila.intentos_fallidos || 0) + 1;
  if (intentos >= INTENTOS_MAX) {
    db.prepare('UPDATE usuarios SET intentos_fallidos = ?, bloqueada = 1, bloqueado_hasta = NULL WHERE id = ?')
      .run(intentos, fila.id);
    // Una cuenta bloqueada no puede seguir usando las sesiones que ya tenía.
    db.prepare('DELETE FROM sesiones WHERE usuario_id = ?').run(fila.id);
    return { bloqueada: true };
  }
  const escalon = ESPERAS.find(([n]) => n === intentos);
  if (escalon) {
    db.prepare("UPDATE usuarios SET intentos_fallidos = ?, bloqueado_hasta = datetime('now', ?) WHERE id = ?")
      .run(intentos, `+${escalon[1]} seconds`, fila.id);
    return { espera: escalon[1] };
  }
  db.prepare('UPDATE usuarios SET intentos_fallidos = ? WHERE id = ?').run(intentos, fila.id);
  return {};
}

// Deja la cuenta limpia: al entrar bien y al reactivarla un administrador.
function limpiarIntentos(usuarioId) {
  db.prepare('UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL, bloqueada = 0 WHERE id = ?')
    .run(usuarioId);
}

// ---------- Sesiones ----------

function crearSesion(usuarioId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare(`
    INSERT INTO sesiones (token, usuario_id, expira_en)
    VALUES (?, ?, datetime('now', '+${DIAS_SESION} days'))
  `).run(token, usuarioId);
  return token;
}

function borrarSesion(token) {
  if (token) db.prepare('DELETE FROM sesiones WHERE token = ?').run(token);
}

function leerCookie(req) {
  const cabecera = req.headers.cookie || '';
  for (const parte of cabecera.split(';')) {
    const [nombre, ...resto] = parte.trim().split('=');
    if (nombre === COOKIE) return resto.join('=');
  }
  return null;
}

// La web manda el token en una cookie; la app móvil, en la cabecera
// Authorization. Es el mismo token y la misma tabla de sesiones.
function leerToken(req) {
  const cabecera = req.headers.authorization || '';
  if (cabecera.startsWith('Bearer ')) return cabecera.slice(7).trim();
  return leerCookie(req);
}

function setCookie(res, token) {
  res.setHeader('Set-Cookie',
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DIAS_SESION * 86400}`);
}

function clearCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// Datos del usuario que acompañan a la sesión: su grupo y sus locales.
function cargarUsuario(id) {
  const fila = db.prepare(`
    SELECT u.id, u.usuario, u.nombre, u.rol, u.email, u.grupo_id, g.nombre AS grupo_nombre
    FROM usuarios u LEFT JOIN grupos g ON g.id = u.grupo_id
    WHERE u.id = ?
  `).get(id);
  if (!fila) return null;
  fila.locales = db.prepare(`
    SELECT l.id, l.nombre FROM usuario_local ul JOIN locales l ON l.id = ul.local_id
    WHERE ul.usuario_id = ? ORDER BY l.orden, l.nombre
  `).all(id);
  return fila;
}

// Adjunta req.user si el token corresponde a una sesión vigente.
function middlewareSesion(req, res, next) {
  db.prepare("DELETE FROM sesiones WHERE expira_en < datetime('now')").run();
  const token = leerToken(req);
  if (token) {
    const sesion = db.prepare(`
      SELECT s.usuario_id FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token = ? AND u.bloqueada = 0
    `).get(token);
    if (sesion) {
      req.user = cargarUsuario(sesion.usuario_id);
      req.sessionToken = token;
    }
  }
  next();
}

// Los catálogos y las cuentas son cosa del administrador.
const PAGINAS_ADMIN = ['/usuarios.html', '/grupos.html', '/locales.html', '/familias.html', '/empresas.html'];
// El programador lo lleva también el gestor.
const PAGINAS_TAREAS = ['/tareas.html'];
// El calendario, en cambio, también lo puede mirar un técnico: es de solo lectura.
const PAGINAS_CALENDARIO = ['/calendario.html'];
// Los informes no son para los empleados. El técnico ve los suyos; el gestor y
// el administrador, los de todos.
const PAGINAS_INFORMES = ['/informes.html'];
// La lavandería la cuenta el personal del local: no el rol «usuario», que solo
// reporta lo suyo y no trabaja en el local.
const PAGINAS_LAVANDERIA = ['/lavanderia.html'];
// El inventario lo lleva quien gestiona incidencias: es de ahí de donde se
// elige el equipo al abrir una.
const PAGINAS_INVENTARIO = ['/inventario.html'];

const PUBLICAS = [
  '/login.html', '/api/login',
  // Con qué nombre se presenta la instalación: lo pinta la propia pantalla de
  // acceso, antes de que nadie haya entrado.
  '/api/organizacion',
  '/restablecer.html', '/api/recuperar', '/api/restablecer',
  // Entrar con Office 365: la pantalla de acceso pregunta si el botón va, la
  // ida lleva a Microsoft y la vuelta es donde Microsoft devuelve a la
  // persona, todavía sin sesión.
  '/api/entra/estado', '/api/entra/entrar', '/api/entra/vuelta',
  // Y la vuelta de la app: la página que la despierta y el canje del vale por
  // el token, los dos sin sesión todavía.
  '/entra-movil.html', '/api/entra/movil',
  // Android y iOS los piden sin sesión para comprobar que los enlaces de los
  // correos puede abrirlos la app. El de Apple lo pide Apple, no el teléfono.
  '/.well-known/assetlinks.json', '/.well-known/apple-app-site-association',
  // La exigen las dos tiendas para publicar la app, y la lee quien todavía no
  // ha entrado — Apple la primera, desde la ficha de App Store Connect.
  '/privacidad.html'
];

// Deja pasar el acceso, el restablecimiento y los assets; el resto exige sesión
// (401 en API, redirección en páginas).
function middlewareAcceso(req, res, next) {
  if (req.user) {
    if (req.path === '/login.html') return res.redirect('/');
    if (PAGINAS_ADMIN.includes(req.path) && req.user.rol !== 'admin') return res.redirect('/');
    if (PAGINAS_TAREAS.includes(req.path) && !puedeProgramar(req.user)) return res.redirect('/');
    if (PAGINAS_CALENDARIO.includes(req.path) && !puedeVerCalendario(req.user)) return res.redirect('/');
    if (PAGINAS_INFORMES.includes(req.path) && !puedeVerInformes(req.user)) return res.redirect('/');
    if (PAGINAS_LAVANDERIA.includes(req.path) && !puedeUsarLavanderia(req.user)) return res.redirect('/');
    if (PAGINAS_INVENTARIO.includes(req.path) && !puedeUsarInventario(req.user)) return res.redirect('/');
    return next();
  }
  // Sin sesión se puede llegar al acceso y a lo de recuperar la contraseña, que
  // justamente sirve para quien no puede entrar.
  if (PUBLICAS.includes(req.path) || req.path.startsWith('/assets/')) {
    return next();
  }
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Sesión no iniciada.' });
  return res.redirect('/login.html');
}

function soloAdmin(req, res, next) {
  if (req.user && req.user.rol === 'admin') return next();
  return res.status(403).json({ error: 'Solo un administrador puede realizar esta acción.' });
}

// ---------- Qué puede hacer cada rol ----------

/**
 * El gestor supervisa el trabajo: ve los informes de todos los técnicos y
 * lleva el programador de tareas, pero no toca cuentas ni catálogos, que
 * siguen siendo del administrador.
 */
function puedeProgramar(user) {
  return user.rol === 'admin' || user.rol === 'gestor';
}

// El calendario es de solo lectura, así que también lo puede mirar un técnico,
// a diferencia del programador de tareas, que sigue siendo cosa del gestor y
// el administrador.
function puedeVerCalendario(user) {
  return GESTIONAN.includes(user.rol);
}

// Los informes no son para los empleados.
function puedeVerInformes(user) {
  return GESTIONAN.includes(user.rol);
}

// La lavandería es cosa del empleado, que es quien hace el recuento al final
// del turno, y de quien lo supervisa (gestor y administrador, que además
// mantiene el catálogo de prendas desde esta misma pantalla). El técnico no
// trabaja de cara al local y se queda fuera, igual que el rol «usuario».
function puedeUsarLavanderia(user) {
  return ['empleado', 'gestor', 'admin'].includes(user.rol);
}

// El inventario es cosa de quien gestiona incidencias: de ahí se elige el
// equipo al abrir una, así que lo llevan los mismos roles que las atienden.
function puedeUsarInventario(user) {
  return GESTIONAN.includes(user.rol);
}

/**
 * ¿De qué técnico puede ver informes? Un técnico solo de sí mismo; el gestor y
 * el administrador, de cualquiera. Devuelve `null` cuando no hay restricción.
 */
function tecnicoDeLosInformes(user) {
  return user.rol === 'tecnico' ? user.id : null;
}

function soloProgramador(req, res, next) {
  if (req.user && puedeProgramar(req.user)) return next();
  return res.status(403).json({
    error: 'Solo un gestor o un administrador puede gestionar las tareas programadas.'
  });
}

function soloCalendario(req, res, next) {
  if (req.user && puedeVerCalendario(req.user)) return next();
  return res.status(403).json({
    error: 'Solo quien gestiona incidencias puede ver el calendario.'
  });
}

function soloLavanderia(req, res, next) {
  if (req.user && puedeUsarLavanderia(req.user)) return next();
  return res.status(403).json({ error: 'La lavandería es cosa del personal del local.' });
}

function soloInventario(req, res, next) {
  if (req.user && puedeUsarInventario(req.user)) return next();
  return res.status(403).json({ error: 'Solo quien gestiona incidencias puede usar el inventario.' });
}

// ---------- Visibilidad de las incidencias ----------

/**
 * Condición SQL que deja ver a `user` solo las incidencias que le tocan, para
 * añadir al WHERE de una consulta sobre la tabla `tickets` con alias `t`.
 * Devuelve `{ sql, params }`.
 *
 * - Administrador: todas.
 * - Técnico: las de su grupo, y de sus locales si tiene alguno asignado. Un
 *   técnico sin locales no tiene restricción de local (es el caso de
 *   Informática, que atiende todos).
 * - Empleado: todas las de sus locales, las haya abierto él u otro compañero.
 *   Sin locales asignados no ve ninguna.
 */
function filtroVisibilidad(user) {
  if (user.rol === 'admin' || user.rol === 'gestor') return { sql: '1 = 1', params: [] };

  const locales = user.locales.map((l) => l.id);
  const marcas = locales.map(() => '?').join(',');

  // El rol «usuario» solo ve lo que ha abierto él, y dentro de sus locales. No
  // llega a lo de sus compañeros, que es lo que lo separa de «empleado».
  if (user.rol === 'usuario') {
    if (!locales.length) return { sql: 't.creado_por = ?', params: [user.id] };
    return {
      sql: `t.creado_por = ? AND t.local_id IN (${marcas})`,
      params: [user.id, ...locales]
    };
  }

  if (user.rol === 'tecnico') {
    if (!user.grupo_id) return { sql: '1 = 0', params: [] };
    if (!locales.length) return { sql: 't.grupo_id = ?', params: [user.grupo_id] };
    return { sql: `t.grupo_id = ? AND t.local_id IN (${marcas})`, params: [user.grupo_id, ...locales] };
  }

  if (!locales.length) return { sql: '1 = 0', params: [] };
  return { sql: `t.local_id IN (${marcas})`, params: locales };
}

function todosLosLocales() {
  return db.prepare('SELECT id FROM locales ORDER BY orden, nombre').all().map((l) => l.id);
}

/**
 * Locales entre los que puede elegir el usuario al abrir una incidencia.
 *
 * El administrador usa cualquiera. El técnico, los suyos, y si no tiene
 * ninguno marcado atiende todos, así que también puede abrirlas en todos: es la
 * misma regla con la que ve las incidencias. El empleado, solo los suyos.
 */
function localesPermitidos(user) {
  if (user.rol === 'admin' || user.rol === 'gestor') return todosLosLocales();
  if (user.rol === 'tecnico' && !user.locales.length) return todosLosLocales();
  return user.locales.map((l) => l.id);
}

// Cualquiera puede abrir una incidencia: el empleado que la reporta, el técnico
// que se encuentra una avería mientras trabaja y el administrador.
function puedeCrearTickets(user) {
  return ['usuario', 'empleado', 'tecnico', 'gestor', 'admin'].includes(user.rol);
}

// Quién puede abrir una incidencia a nombre de otra persona.
function puedeAbrirEnNombreDe(user) {
  return GESTIONAN.includes(user.rol);
}

// ¿Ve este usuario esta incidencia concreta? Misma regla que filtroVisibilidad,
// aplicada a una fila ya leída.
function puedeVerTicket(user, ticket) {
  if (!ticket) return false;
  if (user.rol === 'admin' || user.rol === 'gestor') return true;
  const locales = user.locales.map((l) => l.id);
  if (user.rol === 'tecnico') {
    if (ticket.grupo_id !== user.grupo_id) return false;
    return !locales.length || locales.includes(ticket.local_id);
  }
  // Misma regla que `filtroVisibilidad`, aplicada a una fila ya leída.
  if (user.rol === 'usuario') {
    if (ticket.creado_por !== user.id) return false;
    return !locales.length || locales.includes(ticket.local_id);
  }
  return locales.includes(ticket.local_id);
}

// Quien atiende o supervisa el trabajo cambia el estado y reparte las
// incidencias; el empleado que la reporta, no.
function puedeGestionarTicket(user, ticket) {
  return GESTIONAN.includes(user.rol) && puedeVerTicket(user, ticket);
}

// Usuario inicial para poder entrar la primera vez.
function seedAdmin() {
  const hay = db.prepare('SELECT COUNT(*) AS c FROM usuarios').get().c;
  if (!hay) {
    db.prepare('INSERT INTO usuarios (usuario, nombre, rol, password_hash) VALUES (?, ?, ?, ?)')
      .run('admin', 'Administración', 'admin', hashPassword('admin'));
    console.log('Usuario inicial creado: admin / admin — cambia la contraseña desde Usuarios.');
  }
}

// ---------- Restablecer la contraseña ----------

// El vale vale una hora: suficiente para leer el correo y poco para que ande
// suelto por ahí.
const MINUTOS_VALE = 60;

function resumen(vale) {
  return crypto.createHash('sha256').update(vale).digest('hex');
}

/**
 * Busca la cuenta por correo o por nombre de acceso.
 *
 * Las cuentas nuevas entran con su correo, que es su nombre de acceso; las de
 * antes siguen entrando con el suyo de siempre.
 */
function buscarCuenta(identificador) {
  const id = String(identificador || '').trim().toLowerCase();
  if (!id) return null;
  return db.prepare(
    'SELECT * FROM usuarios WHERE lower(usuario) = ? OR lower(email) = ?'
  ).get(id, id) || null;
}

/**
 * Crea un vale de un solo uso y devuelve el texto que va en el correo.
 *
 * En la base solo queda su resumen: quien leyera la base no podría usarlo para
 * entrar. Los vales anteriores de esa cuenta se invalidan, para que pedirlo dos
 * veces no deje dos puertas abiertas.
 */
function crearVale(usuarioId) {
  db.prepare('UPDATE restablecimientos SET usado = 1 WHERE usuario_id = ? AND usado = 0')
    .run(usuarioId);
  const vale = crypto.randomBytes(32).toString('hex');
  db.prepare(`
    INSERT INTO restablecimientos (usuario_id, vale_hash, expira_en)
    VALUES (?, ?, datetime('now', '+${MINUTOS_VALE} minutes'))
  `).run(usuarioId, resumen(vale));
  return vale;
}

// La cuenta de un vale vigente, o nulo si no vale.
function cuentaDelVale(vale) {
  if (!vale) return null;
  const fila = db.prepare(`
    SELECT r.id, r.usuario_id FROM restablecimientos r
    WHERE r.vale_hash = ? AND r.usado = 0 AND r.expira_en > datetime('now')
  `).get(resumen(String(vale)));
  return fila || null;
}

/**
 * Cambia la contraseña y gasta el vale.
 *
 * Se cierran todas las sesiones de esa cuenta: si alguien había entrado con la
 * contraseña antigua —que es la razón de estar restableciéndola— se queda
 * fuera.
 */
function restablecer(vale, password) {
  const fila = cuentaDelVale(vale);
  if (!fila) return false;
  db.transaction(() => {
    db.prepare('UPDATE usuarios SET password_hash = ?, intentos_fallidos = 0, bloqueado_hasta = NULL, bloqueada = 0 WHERE id = ?')
      .run(hashPassword(password), fila.usuario_id);
    db.prepare('UPDATE restablecimientos SET usado = 1 WHERE id = ?').run(fila.id);
    db.prepare('DELETE FROM sesiones WHERE usuario_id = ?').run(fila.usuario_id);
  })();
  return true;
}

module.exports = {
  GESTIONAN,
  ROL_POR_DEFECTO,
  LOCAL_POR_DEFECTO,
  buscarCuenta,
  crearVale,
  cuentaDelVale,
  restablecer,
  hashPassword,
  verifyPassword,
  MENSAJE_BLOQUEADA,
  mensajeEspera,
  segundosDeEspera,
  registrarFallo,
  limpiarIntentos,
  crearSesion,
  borrarSesion,
  setCookie,
  clearCookie,
  cargarUsuario,
  middlewareSesion,
  middlewareAcceso,
  soloAdmin,
  puedeProgramar,
  puedeVerCalendario,
  puedeVerInformes,
  puedeUsarLavanderia,
  puedeUsarInventario,
  tecnicoDeLosInformes,
  soloProgramador,
  soloCalendario,
  soloLavanderia,
  soloInventario,
  filtroVisibilidad,
  localesPermitidos,
  puedeCrearTickets,
  puedeAbrirEnNombreDe,
  puedeVerTicket,
  puedeGestionarTicket,
  seedAdmin
};
