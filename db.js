'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const organizacion = require('./organizacion');

// La base vive en data/, salvo que se indique otra ruta: las pruebas le dan una
// propia a cada archivo para no pisarse entre ellas.
const ARCHIVO = process.env.INCIDENCIAS_DB || path.join(__dirname, 'data', 'incidencias.db');
// Absoluta a propósito: de aquí cuelgan las carpetas de los adjuntos y del
// chat, y `res.sendFile` no acepta una ruta relativa. Arrancar la aplicación
// con `INCIDENCIAS_DB=data/…` es lo normal y bastaba para que ningún archivo se
// pudiera descargar.
const DATA_DIR = path.resolve(path.dirname(ARCHIVO));
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(ARCHIVO);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS grupos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  orden INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS locales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  orden INTEGER NOT NULL DEFAULT 0
);

-- Categoría de la incidencia, aparte del departamento que la atiende: «área»
-- es la zona del local (Cocina, Sala, Barra…), «familia» el equipo o
-- instalación dentro de ella (Climatización, Electricidad…) y «subfamilia» lo
-- concreto dentro de la familia. Se llama «área» por dentro para no chocar
-- con la tabla «grupos» —el departamento que resuelve la incidencia—; en la
-- interfaz se llama «Grupo».
CREATE TABLE IF NOT EXISTS areas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  orden INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS familias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  orden INTEGER NOT NULL DEFAULT 0,
  area_id INTEGER NOT NULL REFERENCES areas(id),
  UNIQUE (area_id, nombre)
);

CREATE TABLE IF NOT EXISTS subfamilias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  orden INTEGER NOT NULL DEFAULT 0,
  familia_id INTEGER NOT NULL REFERENCES familias(id) ON DELETE CASCADE,
  UNIQUE (familia_id, nombre)
);

CREATE INDEX IF NOT EXISTS idx_subfamilias_familia ON subfamilias(familia_id);

-- Inventario: el equipamiento del local (una batidora, un televisor…), para
-- poder enlazarlo desde la incidencia que lo señale. Lo llevan quienes
-- gestionan incidencias —técnico, gestor y administrador—, igual que el
-- programador de tareas.
CREATE TABLE IF NOT EXISTS activos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  estado TEXT NOT NULL DEFAULT 'en_uso' CHECK (estado IN ('en_uso', 'roto', 'almacen')),
  local_id INTEGER NOT NULL REFERENCES locales(id),
  grupo_id INTEGER NOT NULL REFERENCES grupos(id),
  -- Nombre del archivo de la foto dentro de su propia carpeta; nulo si no tiene.
  foto TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_activos_grupo ON activos(grupo_id);
CREATE INDEX IF NOT EXISTS idx_activos_local ON activos(local_id);

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  -- «usuario» es el rol más recortado: solo ve las incidencias que ha abierto
  -- él. «empleado» ve además las de sus compañeros en sus locales.
  rol TEXT NOT NULL DEFAULT 'usuario'
    CHECK (rol IN ('usuario', 'empleado', 'tecnico', 'gestor', 'admin')),
  -- El correo es el nombre de acceso de las cuentas nuevas, y por donde se
  -- mandan los avisos. Puede faltar en las cuentas antiguas.
  email TEXT UNIQUE,
  -- Solo los técnicos pertenecen a un grupo; empleados y administradores no.
  grupo_id INTEGER REFERENCES grupos(id),
  password_hash TEXT NOT NULL,
  -- Quién es esta persona en el tenant de Entra ID, si entra con Office 365.
  entra_oid TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  intentos_fallidos INTEGER NOT NULL DEFAULT 0,
  bloqueado_hasta TEXT,
  bloqueada INTEGER NOT NULL DEFAULT 0
);

-- Locales de cada usuario. Un técnico sin ninguna fila aquí ve todos los
-- locales de su grupo; un empleado siempre tiene al menos uno, y son los
-- únicos para los que puede abrir incidencias.
CREATE TABLE IF NOT EXISTS usuario_local (
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  local_id INTEGER NOT NULL REFERENCES locales(id) ON DELETE CASCADE,
  PRIMARY KEY (usuario_id, local_id)
);

CREATE TABLE IF NOT EXISTS sesiones (
  token TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira_en TEXT NOT NULL
);

-- Empresas con contrato de mantenimiento externo, para asignarlas a una tarea
-- programada que no lleva el propio personal.
CREATE TABLE IF NOT EXISTS empresas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  contacto TEXT,
  telefono TEXT,
  email TEXT,
  notas TEXT,
  orden INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tareas_programadas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  -- Cuándo se repite, por partes en vez de en una expresión cron: ver
  -- planificacion.js. La hora es la del servidor.
  frecuencia TEXT NOT NULL DEFAULT 'diaria'
    CHECK (frecuencia IN ('una_vez', 'diaria', 'semanal', 'mensual')),
  hora TEXT NOT NULL DEFAULT '09:00',
  fecha_inicio TEXT NOT NULL,
  cada INTEGER NOT NULL DEFAULT 1,
  dias_semana TEXT,           -- «1,3,5»; domingo es 0
  dias_mes TEXT,              -- «1,15»
  meses TEXT,                 -- «1,4,7,10»; nulo = todos los meses
  plantilla_titulo TEXT NOT NULL,
  plantilla_descripcion TEXT,
  grupo_id INTEGER NOT NULL REFERENCES grupos(id),
  -- Sin local, la tarea abre una incidencia por cada local existente.
  local_id INTEGER REFERENCES locales(id),
  prioridad TEXT NOT NULL DEFAULT 'normal'
    CHECK (prioridad IN ('urgente', 'normal', 'cuando_se_pueda')),
  activo INTEGER NOT NULL DEFAULT 1,
  -- Si la lleva una empresa externa en vez del propio personal; en ese caso
  -- empresa_id dice cuál.
  mantenimiento_externo INTEGER NOT NULL DEFAULT 0,
  empresa_id INTEGER REFERENCES empresas(id),
  -- El equipo o instalación que mantiene, para el calendario de mantenimiento
  -- preventivo; opcional, como en una tarea que no encaja en el catálogo.
  area_id INTEGER REFERENCES areas(id),
  familia_id INTEGER REFERENCES familias(id),
  subfamilia_id INTEGER REFERENCES subfamilias(id),
  -- Último minuto ya evaluado: al arrancar se recuperan los vencimientos que
  -- cayeron con el servidor parado, sin repetir los ya atendidos.
  evaluada_hasta TEXT
);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo TEXT NOT NULL,
  descripcion TEXT,
  estado TEXT NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'pendiente', 'cerrado')),
  prioridad TEXT NOT NULL DEFAULT 'normal'
    CHECK (prioridad IN ('urgente', 'normal', 'cuando_se_pueda')),
  grupo_id INTEGER NOT NULL REFERENCES grupos(id),
  local_id INTEGER NOT NULL REFERENCES locales(id),
  -- Categoría de la avería: área y familia son obligatorias al abrir una
  -- incidencia (lo exige el servidor, no un CHECK, para no dejar sin efecto
  -- las incidencias antiguas que se abrieron antes de que existiera esto);
  -- la subfamilia sigue siendo opcional.
  area_id INTEGER REFERENCES areas(id),
  familia_id INTEGER REFERENCES familias(id),
  subfamilia_id INTEGER REFERENCES subfamilias(id),
  -- Copiada de la tarea programada que la abrió, cuando es de mantenimiento
  -- externo: qué empresa tiene que atenderla.
  empresa_id INTEGER REFERENCES empresas(id),
  -- Nulo en las incidencias que abre el programador de tareas: no las crea
  -- ninguna persona.
  creado_por INTEGER REFERENCES usuarios(id),
  tarea_id INTEGER REFERENCES tareas_programadas(id) ON DELETE SET NULL,
  asignado_a INTEGER REFERENCES usuarios(id),
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now')),
  -- Momento en que pasó a cerrada, para contar las resueltas en los informes.
  cerrado_en TEXT
);

CREATE INDEX IF NOT EXISTS idx_tickets_grupo ON tickets(grupo_id);
CREATE INDEX IF NOT EXISTS idx_tickets_local ON tickets(local_id);
CREATE INDEX IF NOT EXISTS idx_tickets_estado ON tickets(estado);
CREATE INDEX IF NOT EXISTS idx_tickets_creado ON tickets(creado_en);

CREATE TABLE IF NOT EXISTS mensajes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  autor_id INTEGER NOT NULL REFERENCES usuarios(id),
  contenido TEXT NOT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mensajes_ticket ON mensajes(ticket_id);

CREATE TABLE IF NOT EXISTS adjuntos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  -- Un adjunto puede colgar de un mensaje del hilo o de la incidencia misma.
  mensaje_id INTEGER REFERENCES mensajes(id) ON DELETE CASCADE,
  archivo TEXT NOT NULL,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'documento' CHECK (tipo IN ('imagen', 'video', 'documento')),
  subido_por INTEGER REFERENCES usuarios(id),
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_adjuntos_ticket ON adjuntos(ticket_id);

-- Lavandería: prendas que se mandan a lavar (toallas, trapos, manteles…) y
-- cada envío, con lo que se manda y, cuando vuelve, lo que se recibe. La
-- diferencia entre lo enviado y lo recibido es la merma; no se guarda en una
-- columna aparte, se calcula al vuelo, porque siempre es esa resta.
CREATE TABLE IF NOT EXISTS prendas_lavanderia (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  orden INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS envios_lavanderia (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  local_id INTEGER NOT NULL REFERENCES locales(id),
  creado_por INTEGER NOT NULL REFERENCES usuarios(id),
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  notas TEXT,
  -- Nulos mientras no ha vuelto de la lavandería.
  recibido_en TEXT,
  recibido_por INTEGER REFERENCES usuarios(id),
  notas_recepcion TEXT
);

CREATE INDEX IF NOT EXISTS idx_envios_lavanderia_local ON envios_lavanderia(local_id);
CREATE INDEX IF NOT EXISTS idx_envios_lavanderia_creado ON envios_lavanderia(creado_en);

CREATE TABLE IF NOT EXISTS envio_lavanderia_items (
  envio_id INTEGER NOT NULL REFERENCES envios_lavanderia(id) ON DELETE CASCADE,
  prenda_id INTEGER NOT NULL REFERENCES prendas_lavanderia(id),
  enviado INTEGER NOT NULL DEFAULT 0,
  -- Nulo hasta que se cuenta la vuelta; a partir de ahí, nunca negativo.
  recibido INTEGER,
  PRIMARY KEY (envio_id, prenda_id)
);

-- Adjuntos subidos antes de que exista la incidencia o el mensaje del que van
-- a colgar. Es lo que permite no crear la incidencia hasta que el archivo ha
-- subido entero: si la subida se corta, no queda una incidencia a medias
-- avisando a los técnicos de una foto que no llegó.
-- Vales para restablecer la contraseña. Se guarda el resumen y no el vale, que
-- solo viaja en el correo: quien leyera la base no podría entrar con ellos.
CREATE TABLE IF NOT EXISTS restablecimientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  vale_hash TEXT NOT NULL UNIQUE,
  expira_en TEXT NOT NULL,
  usado INTEGER NOT NULL DEFAULT 0,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS adjuntos_borrador (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  archivo TEXT NOT NULL,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'documento' CHECK (tipo IN ('imagen', 'video', 'documento')),
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dispositivos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token_push TEXT NOT NULL UNIQUE,
  plataforma TEXT NOT NULL DEFAULT 'android' CHECK (plataforma IN ('android', 'ios')),
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// ---------- Migración: mensaje de apertura ----------

// La descripción de la incidencia y sus adjuntos son ahora el primer mensaje
// del hilo. Este indicador lo marca, para que la ficha no repita la
// descripción arriba y en el hilo. Las incidencias antiguas no lo llevan y
// siguen enseñando su descripción como hasta ahora.
function columnas(tabla) {
  return db.prepare(`PRAGMA table_info(${tabla})`).all().map((c) => c.name);
}

if (!columnas('mensajes').includes('apertura')) {
  db.exec('ALTER TABLE mensajes ADD COLUMN apertura INTEGER NOT NULL DEFAULT 0');
}

// ---------- Migración: familia y subfamilia de la incidencia ----------

if (!columnas('tickets').includes('familia_id')) {
  db.exec('ALTER TABLE tickets ADD COLUMN familia_id INTEGER REFERENCES familias(id)');
}
if (!columnas('tickets').includes('subfamilia_id')) {
  db.exec('ALTER TABLE tickets ADD COLUMN subfamilia_id INTEGER REFERENCES subfamilias(id)');
}

// ---------- Migración: área (grupo) de la familia ----------

// El área se añadió después de familia y subfamilia: las instalaciones que ya
// tuvieran familias las conservan, adoptando la primera área que encuentren
// (o una «General» recién creada si no había ninguna) para no dejarlas sin
// una que sea obligatoria en la tabla.
if (!columnas('familias').includes('area_id')) {
  const antiguas = db.prepare('SELECT * FROM familias').all();
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    let areaPorDefecto = db.prepare('SELECT id FROM areas ORDER BY orden, id LIMIT 1').get();
    if (!areaPorDefecto && antiguas.length) {
      const info = db.prepare('INSERT INTO areas (nombre, orden) VALUES (?, 0)').run('General');
      areaPorDefecto = { id: info.lastInsertRowid };
    }
    db.exec(`
      CREATE TABLE familias_nuevas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        orden INTEGER NOT NULL DEFAULT 0,
        area_id INTEGER NOT NULL REFERENCES areas(id),
        UNIQUE (area_id, nombre)
      );
    `);
    const insertar = db.prepare(`
      INSERT INTO familias_nuevas (id, nombre, orden, area_id) VALUES (?, ?, ?, ?)
    `);
    for (const f of antiguas) insertar.run(f.id, f.nombre, f.orden, areaPorDefecto.id);
    db.exec('DROP TABLE familias');
    db.exec('ALTER TABLE familias_nuevas RENAME TO familias');
    db.exec('CREATE INDEX IF NOT EXISTS idx_familias_area ON familias(area_id)');
  })();
  db.pragma('foreign_keys = ON');
  if (antiguas.length) console.log(`Familias migradas con área por defecto: ${antiguas.length}.`);
}
if (!columnas('tickets').includes('area_id')) {
  db.exec('ALTER TABLE tickets ADD COLUMN area_id INTEGER REFERENCES areas(id)');
}
// Al alcance de la mano de la migración de arriba, no del bloque de creación
// inicial: en una base que todavía no tenga `area_id` en `familias`, crear
// este índice antes de que la migración añada la columna fallaría.
db.exec('CREATE INDEX IF NOT EXISTS idx_familias_area ON familias(area_id)');

// ---------- Migración: adjuntos de vídeo ----------

// El tipo del adjunto vive en un CHECK, igual que el rol. Los adjuntos no los
// referencia nadie, así que basta con rehacer la tabla conservando sus filas.
function sqlDe(tabla) {
  const fila = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(tabla);
  return fila ? fila.sql : '';
}

if (sqlDe('adjuntos') && !sqlDe('adjuntos').includes("'video'")) {
  const antiguos = db.prepare('SELECT * FROM adjuntos').all();
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE adjuntos_nueva (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        mensaje_id INTEGER REFERENCES mensajes(id) ON DELETE CASCADE,
        archivo TEXT NOT NULL,
        nombre TEXT NOT NULL,
        tipo TEXT NOT NULL DEFAULT 'documento' CHECK (tipo IN ('imagen', 'video', 'documento')),
        subido_por INTEGER REFERENCES usuarios(id),
        creado_en TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    const insertar = db.prepare(`
      INSERT INTO adjuntos_nueva
        (id, ticket_id, mensaje_id, archivo, nombre, tipo, subido_por, creado_en)
      VALUES (@id, @ticket_id, @mensaje_id, @archivo, @nombre, @tipo, @subido_por, @creado_en)
    `);
    for (const a of antiguos) insertar.run(a);
    db.exec('DROP TABLE adjuntos');
    db.exec('ALTER TABLE adjuntos_nueva RENAME TO adjuntos');
    db.exec('CREATE INDEX IF NOT EXISTS idx_adjuntos_ticket ON adjuntos(ticket_id)');
  })();
  db.pragma('foreign_keys = ON');
  if (antiguos.length) console.log(`Adjuntos migrados para admitir vídeo: ${antiguos.length}.`);
}

// ---------- Migración: el rol «gestor» ----------

function tieneColumna(tabla, columna) {
  return db.prepare(`PRAGMA table_info(${tabla})`).all().some((c) => c.name === columna);
}

// El rol vive en un CHECK, que no se puede ampliar con ALTER TABLE: la tabla se
// reconstruye. Se conservan los identificadores porque de ellos cuelgan las
// incidencias, los mensajes y las sesiones.
function checkDeUsuarios() {
  const fila = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'usuarios'").get();
  return fila ? fila.sql : '';
}

if (checkDeUsuarios() && !checkDeUsuarios().includes("'usuario'")) {
  const antiguos = db.prepare('SELECT * FROM usuarios').all();
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE usuarios_nueva (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario TEXT NOT NULL UNIQUE,
        nombre TEXT NOT NULL,
        rol TEXT NOT NULL DEFAULT 'usuario'
          CHECK (rol IN ('usuario', 'empleado', 'tecnico', 'gestor', 'admin')),
        email TEXT UNIQUE,
        grupo_id INTEGER REFERENCES grupos(id),
        password_hash TEXT NOT NULL,
        creado_en TEXT NOT NULL DEFAULT (datetime('now')),
        intentos_fallidos INTEGER NOT NULL DEFAULT 0,
        bloqueado_hasta TEXT,
        bloqueada INTEGER NOT NULL DEFAULT 0
      );
    `);
    const insertar = db.prepare(`
      INSERT INTO usuarios_nueva
        (id, usuario, nombre, rol, email, grupo_id, password_hash, creado_en,
         intentos_fallidos, bloqueado_hasta, bloqueada)
      VALUES (@id, @usuario, @nombre, @rol, @email, @grupo_id, @password_hash, @creado_en,
         @intentos_fallidos, @bloqueado_hasta, @bloqueada)
    `);
    // Las cuentas de antes no tenían correo: se quedan sin él y siguen
    // entrando con su nombre de usuario de siempre.
    for (const u of antiguos) insertar.run({ email: null, ...u });
    db.exec('DROP TABLE usuarios');
    db.exec('ALTER TABLE usuarios_nueva RENAME TO usuarios');
  })();
  db.pragma('foreign_keys = ON');
  if (antiguos.length) console.log(`Usuarios migrados para admitir el rol usuario y el correo: ${antiguos.length}.`);
}

// ---------- Migración desde las expresiones cron ----------

// Traduce al plan por partes las expresiones cron que llegó a guardar la
// versión anterior. Solo se generaban las tres pautas que ofrecía aquel
// formulario; cualquier otra cosa se deja como tarea diaria a su hora, que es
// lo más parecido que se puede decir sin inventar.
function planDesdeCron(expresion) {
  const partes = String(expresion || '').trim().split(/\s+/);
  const hoy = new Date();
  const dos = (n) => String(n).padStart(2, '0');
  const plan = {
    frecuencia: 'diaria',
    hora: '09:00',
    fecha_inicio: `${hoy.getFullYear()}-${dos(hoy.getMonth() + 1)}-${dos(hoy.getDate())}`,
    cada: 1,
    dias_semana: null,
    dias_mes: null,
    meses: null
  };
  if (partes.length !== 5) return plan;

  const [minuto, hora, diaMes, mes, diaSemana] = partes;
  if (/^\d{1,2}$/.test(minuto) && /^\d{1,2}$/.test(hora)
      && Number(minuto) < 60 && Number(hora) < 24) {
    plan.hora = `${dos(hora)}:${dos(minuto)}`;
  }
  const listaValida = (campo, min, max) => /^\d{1,2}(,\d{1,2})*$/.test(campo)
    && campo.split(',').every((n) => Number(n) >= min && Number(n) <= max);

  if (diaMes === '*' && listaValida(diaSemana, 0, 7)) {
    plan.frecuencia = 'semanal';
    // El domingo se escribía 0 o 7; aquí siempre 0.
    plan.dias_semana = [...new Set(diaSemana.split(',').map((d) => Number(d) % 7))]
      .sort((a, b) => a - b).join(',');
  } else if (listaValida(diaMes, 1, 31)) {
    plan.frecuencia = 'mensual';
    plan.dias_mes = diaMes;
    if (listaValida(mes, 1, 12)) plan.meses = mes;
  }
  return plan;
}

// La tabla se reconstruye para quitar `cron_expresion` y dejar el mismo
// esquema que en una instalación nueva. Se conservan los identificadores
// porque las incidencias ya abiertas apuntan a ellos.
if (tieneColumna('tareas_programadas', 'cron_expresion')) {
  const antiguas = db.prepare('SELECT * FROM tareas_programadas').all();
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE tareas_nuevas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        frecuencia TEXT NOT NULL DEFAULT 'diaria'
          CHECK (frecuencia IN ('una_vez', 'diaria', 'semanal', 'mensual')),
        hora TEXT NOT NULL DEFAULT '09:00',
        fecha_inicio TEXT NOT NULL,
        cada INTEGER NOT NULL DEFAULT 1,
        dias_semana TEXT,
        dias_mes TEXT,
        meses TEXT,
        plantilla_titulo TEXT NOT NULL,
        plantilla_descripcion TEXT,
        grupo_id INTEGER NOT NULL REFERENCES grupos(id),
        local_id INTEGER REFERENCES locales(id),
        prioridad TEXT NOT NULL DEFAULT 'normal'
          CHECK (prioridad IN ('urgente', 'normal', 'cuando_se_pueda')),
        activo INTEGER NOT NULL DEFAULT 1,
        evaluada_hasta TEXT
      );
    `);
    const insertar = db.prepare(`
      INSERT INTO tareas_nuevas
        (id, nombre, frecuencia, hora, fecha_inicio, cada, dias_semana, dias_mes, meses,
         plantilla_titulo, plantilla_descripcion, grupo_id, local_id, prioridad, activo, evaluada_hasta)
      VALUES
        (@id, @nombre, @frecuencia, @hora, @fecha_inicio, @cada, @dias_semana, @dias_mes, @meses,
         @plantilla_titulo, @plantilla_descripcion, @grupo_id, @local_id, @prioridad, @activo, @evaluada_hasta)
    `);
    for (const t of antiguas) {
      insertar.run({
        id: t.id,
        nombre: t.nombre,
        ...planDesdeCron(t.cron_expresion),
        plantilla_titulo: t.plantilla_titulo,
        plantilla_descripcion: t.plantilla_descripcion,
        grupo_id: t.grupo_id,
        local_id: t.local_id,
        prioridad: t.prioridad,
        activo: t.activo,
        evaluada_hasta: t.evaluada_hasta
      });
    }
    db.exec('DROP TABLE tareas_programadas');
    db.exec('ALTER TABLE tareas_nuevas RENAME TO tareas_programadas');
  })();
  db.pragma('foreign_keys = ON');
  if (antiguas.length) console.log(`Tareas programadas migradas del formato cron: ${antiguas.length}.`);
}

// ---------- Migración: mantenimiento externo ----------

if (!columnas('tareas_programadas').includes('mantenimiento_externo')) {
  db.exec('ALTER TABLE tareas_programadas ADD COLUMN mantenimiento_externo INTEGER NOT NULL DEFAULT 0');
}
if (!columnas('tareas_programadas').includes('empresa_id')) {
  db.exec('ALTER TABLE tareas_programadas ADD COLUMN empresa_id INTEGER REFERENCES empresas(id)');
}
if (!columnas('tickets').includes('empresa_id')) {
  db.exec('ALTER TABLE tickets ADD COLUMN empresa_id INTEGER REFERENCES empresas(id)');
}

// ---------- Migración: categoría de la tarea programada ----------

// Para el calendario de mantenimiento preventivo: qué equipo mantiene cada
// tarea, igual que en una incidencia, pero puesto una sola vez en la tarea en
// vez de en cada incidencia que abre.
if (!columnas('tareas_programadas').includes('area_id')) {
  db.exec('ALTER TABLE tareas_programadas ADD COLUMN area_id INTEGER REFERENCES areas(id)');
}
if (!columnas('tareas_programadas').includes('familia_id')) {
  db.exec('ALTER TABLE tareas_programadas ADD COLUMN familia_id INTEGER REFERENCES familias(id)');
}
if (!columnas('tareas_programadas').includes('subfamilia_id')) {
  db.exec('ALTER TABLE tareas_programadas ADD COLUMN subfamilia_id INTEGER REFERENCES subfamilias(id)');
}

// ---------- Migración: activo (inventario) de la incidencia ----------

// Opcional: qué equipo del inventario señala la incidencia, para que quede
// como historial bajo su ficha.
if (!columnas('tickets').includes('activo_id')) {
  db.exec('ALTER TABLE tickets ADD COLUMN activo_id INTEGER REFERENCES activos(id)');
}

// ---------- Migración: entrar con Office 365 ----------

// Identificador de la persona en el tenant de Entra ID. Es lo único que no
// cambia cuando en Microsoft le cambian el correo, así que la cuenta se
// reconoce por él antes que por la dirección. Va después de la migración del
// rol a propósito: aquella rehace la tabla y se llevaría por delante la
// columna.
//
// El índice es aparte porque SQLite no admite añadir una columna UNIQUE con
// ALTER TABLE. Con un índice único los nulos no molestan: las cuentas que solo
// entran con contraseña son todas «sin oid» y no chocan entre ellas.
if (!columnas('usuarios').includes('entra_oid')) {
  db.exec('ALTER TABLE usuarios ADD COLUMN entra_oid TEXT');
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_entra ON usuarios(entra_oid)');

// Cuentas suspendidas por un administrador.
//
// No es lo mismo que `bloqueada`, que la pone sola la máquina tras diez
// intentos fallidos y se limpia al reactivar el acceso: esto lo decide una
// persona, y tiene que sobrevivir a un «reactivar acceso» hecho por
// despiste. Es lo que permite echar de la conversación a quien se pasa sin
// borrar la cuenta —borrarla no se puede, porque se llevaría por delante el
// historial de incidencias que tenga a su nombre—.
if (!columnas('usuarios').includes('suspendida')) {
  db.exec('ALTER TABLE usuarios ADD COLUMN suspendida INTEGER NOT NULL DEFAULT 0');
}

// Las entradas con Office 365 a medio hacer: lo que hay que recordar entre que
// mandamos a alguien a Microsoft y Microsoft lo devuelve. El «estado» ata la
// vuelta con la ida, el «nonce» ata el identificador con esta entrada concreta
// y el verificador es el secreto de PKCE, que demuestra que quien canjea el
// código es quien lo pidió. Cada fila se gasta al usarla y caduca sola.
db.exec(`
CREATE TABLE IF NOT EXISTS entra_intentos (
  estado TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  verificador TEXT NOT NULL,
  -- Puesto solo si la entrada la empezó la app móvil: es el reto con el que
  -- luego demuestra que el vale que le llega por el enlace es suyo.
  reto_app TEXT,
  expira_en TEXT NOT NULL
);
`);
if (!columnas('entra_intentos').includes('reto_app')) {
  db.exec('ALTER TABLE entra_intentos ADD COLUMN reto_app TEXT');
}

// El vale con el que la app cambia la entrada ya hecha en el navegador por su
// token de sesión. Vive un par de minutos y se gasta al usarlo; en la base solo
// queda su resumen, como en los restablecimientos de contraseña.
db.exec(`
CREATE TABLE IF NOT EXISTS entra_vales (
  vale_hash TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  reto TEXT NOT NULL,
  expira_en TEXT NOT NULL
);
`);

// ---------- Chat de local ----------

// Un canal de conversación por local, al estilo de los canales de IRC: quien
// está dado de alta en el local está en su canal, y no hay que crear ni
// mantener nada. Los mensajes no son los del hilo de una incidencia —esos
// siguen en `mensajes`—: aquí se habla del día a día del local.
db.exec(`
CREATE TABLE IF NOT EXISTS chat_mensajes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  local_id INTEGER NOT NULL REFERENCES locales(id) ON DELETE CASCADE,
  autor_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  -- Identificador que pone quien envía, antes de mandarlo. Es lo que permite
  -- reintentar un envío del que no se supo la respuesta sin duplicar el
  -- mensaje: el servidor devuelve el que ya tenía en lugar de crear otro.
  cliente_id TEXT NOT NULL,
  -- Puede estar vacío: un mensaje puede ser solo una foto o una nota de voz.
  contenido TEXT NOT NULL DEFAULT '',
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  -- Un mensaje borrado deja su hueco («Mensaje eliminado»), como en cualquier
  -- chat: si desapareciera del todo, la conversación de los demás cambiaría
  -- por detrás y los números de mensaje dejarían de cuadrar.
  borrado_en TEXT,
  UNIQUE (autor_id, cliente_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_mensajes_local ON chat_mensajes(local_id, id);

CREATE TABLE IF NOT EXISTS chat_adjuntos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mensaje_id INTEGER NOT NULL REFERENCES chat_mensajes(id) ON DELETE CASCADE,
  archivo TEXT NOT NULL,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'documento'
    CHECK (tipo IN ('imagen', 'video', 'audio', 'documento')),
  -- Segundos que dura una nota de voz o un vídeo, para poder enseñarlo en el
  -- globo sin descargar el archivo entero solo para medirlo.
  duracion INTEGER,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_adjuntos_mensaje ON chat_adjuntos(mensaje_id);

-- Archivos subidos antes de que exista el mensaje del que van a colgar, igual
-- que los borradores de los adjuntos de una incidencia. El chat tiene los
-- suyos porque admite un formato más —el audio de las notas de voz— y porque
-- sus archivos viven en otra carpeta.
CREATE TABLE IF NOT EXISTS chat_borradores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  archivo TEXT NOT NULL,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'documento'
    CHECK (tipo IN ('imagen', 'video', 'audio', 'documento')),
  duracion INTEGER,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Hasta dónde ha llegado cada persona en cada canal: el último mensaje que le
-- ha llegado al aparato y el último que ha visto en pantalla.
--
-- Dos números por persona y canal, en vez de una fila por mensaje y persona:
-- una conversación se lee siempre hacia adelante, así que «he leído hasta el
-- 120» dice lo mismo que ciento veinte acuses y no crece con el uso. El estado
-- de un mensaje sale de comparar su id con el mayor de los números de los
-- demás: recibido si alguien lo tiene recibido, leído si alguien lo ha leído.
-- Los mensajes que alguien ha denunciado.
--
-- Existe porque las dos tiendas lo exigen —la directriz 1.2 de Apple pide que
-- se pueda avisar de un mensaje y que a ese aviso se le conteste—, pero
-- también porque sin una lista el aviso se pierde: un push a los
-- administradores se lee una vez y ya no está. Aquí queda hasta que alguien lo
-- resuelve, y con la hora en que llegó, que es lo que se mira para saber si se
-- está contestando a tiempo.
--
-- Una denuncia por persona y mensaje: quien insista no multiplica el aviso.
CREATE TABLE IF NOT EXISTS chat_denuncias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mensaje_id INTEGER NOT NULL REFERENCES chat_mensajes(id) ON DELETE CASCADE,
  denunciante_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  motivo TEXT NOT NULL DEFAULT '',
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  -- Puestas las dos a la vez cuando un administrador la despacha, haya
  -- borrado el mensaje o haya decidido que no era para tanto.
  resuelto_en TEXT,
  resuelto_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  UNIQUE (mensaje_id, denunciante_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_denuncias_pendientes
  ON chat_denuncias(resuelto_en, id);

CREATE TABLE IF NOT EXISTS chat_lecturas (
  local_id INTEGER NOT NULL REFERENCES locales(id) ON DELETE CASCADE,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  recibido_hasta INTEGER NOT NULL DEFAULT 0,
  leido_hasta INTEGER NOT NULL DEFAULT 0,
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (local_id, usuario_id)
);
`);

// ---------- Datos maestros ----------

const GRUPOS = ['Informática', 'Mantenimiento'];

// Locales de partida, para que una instalación recién hecha no empiece con la
// pantalla vacía. Se editan desde Administración, y lo normal es cambiarlos
// todos el primer día por los de verdad.
//
// El primero es el local por defecto de las cuentas nuevas: si en
// `data/organizacion.json` se le da otro nombre, se siembra ese.
const LOCALES = [
  organizacion.localPorDefecto(),
  'LOCAL 1',
  'LOCAL 2',
  'LOCAL 3'
];

// Las áreas («Grupo» en la interfaz) del plan de mantenimiento preventivo.
const AREAS = ['Cocina', 'Sala', 'Barra'];

// Las prendas más habituales de un hotel o restaurante, de salida.
const PRENDAS_LAVANDERIA = ['Toallas', 'Sábanas', 'Manteles', 'Servilletas', 'Trapos'];

/**
 * El contenido de partida de una instalación nueva.
 *
 * Cada catálogo se siembra **solo si está vacío**, y no fila a fila. La
 * diferencia importa: sembrando por nombre, un local que alguien borrara desde
 * Administración reaparecía en el siguiente reinicio sin que nadie entendiera
 * de dónde salía. Y una instalación que trae sus propios catálogos —la de
 * demostración, por ejemplo— se encontraba mezclados los de aquí.
 *
 * Vaciar un catálogo entero y reiniciar sí lo vuelve a sembrar. Es el precio de
 * no llevar una marca aparte de «esto ya se sembró una vez», y ese caso es
 * mucho más raro que el de borrar una fila suelta.
 */
const seed = db.transaction(() => {
  const vacia = (tabla) => !db.prepare(`SELECT 1 FROM ${tabla} LIMIT 1`).get();

  if (vacia('grupos')) {
    const ins = db.prepare('INSERT INTO grupos (nombre, orden) VALUES (?, ?)');
    GRUPOS.forEach((nombre, i) => ins.run(nombre, i));
  }
  if (vacia('locales')) {
    const ins = db.prepare('INSERT INTO locales (nombre, orden) VALUES (?, ?)');
    LOCALES.forEach((nombre, i) => ins.run(nombre, i));
  }
  if (vacia('areas')) {
    const ins = db.prepare('INSERT INTO areas (nombre, orden) VALUES (?, ?)');
    AREAS.forEach((nombre, i) => ins.run(nombre, i));
  }
  if (vacia('prendas_lavanderia')) {
    const ins = db.prepare('INSERT INTO prendas_lavanderia (nombre, orden) VALUES (?, ?)');
    PRENDAS_LAVANDERIA.forEach((nombre, i) => ins.run(nombre, i));
  }
});
seed();

// Dónde vive la base, para que los adjuntos se guarden a su lado.
db.carpetaDatos = DATA_DIR;

module.exports = db;
