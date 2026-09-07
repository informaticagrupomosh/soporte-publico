'use strict';

/**
 * Deja la instalación con datos de demostración: borra el contenido y lo
 * sustituye por una empresa de hostelería inventada, con sus averías, su plan
 * de mantenimiento y su inventario.
 *
 * **Las cuentas se conservan**, con sus contraseñas, sus sesiones abiertas y
 * sus móviles registrados para los avisos. Lo que se va es todo lo demás.
 *
 *   node tools/demo.js          dice lo que va a borrar y no lo hace
 *   node tools/demo.js --si     lo hace
 *
 * Para qué. Quien revisa la aplicación en Apple o en Google recibe una app que
 * pide la dirección de un servidor y una cuenta, y con la base vacía no puede
 * juzgar nada: una lista sin incidencias no enseña la aplicación. Esto la deja
 * con contenido coherente —incidencias en los tres estados, unas con hilo,
 * otras cerradas hace semanas para que los informes tengan datos, tareas
 * repartidas por el calendario— y con cuentas de demostración documentadas.
 *
 * Sirve igual para enseñársela a alguien sin que tenga que imaginarse nada.
 */

const fs = require('fs');
const path = require('path');

const db = require('../db');
const auth = require('../auth');

const hacerlo = process.argv.includes('--si');

// ---------- Lo que se conserva y lo que se va ----------

// Las cuentas y lo que cuelga de ellas sin depender de los catálogos. Las
// sesiones se quedan para que nadie tenga que volver a entrar, y los
// dispositivos para que los avisos sigan llegando al mismo teléfono.
const SE_QUEDAN = ['usuarios', 'sesiones', 'dispositivos'];

// En este orden: lo que apunta a otras cosas, antes que aquello a lo que
// apunta. No es cosmético — las claves foráneas están activas y el borrado
// falla si se hace al revés.
const SE_VAN = [
  'envio_lavanderia_items', 'envios_lavanderia',
  'chat_denuncias', 'chat_adjuntos', 'chat_borradores', 'chat_lecturas', 'chat_mensajes',
  'adjuntos', 'adjuntos_borrador', 'mensajes', 'tickets',
  'tareas_programadas', 'activos',
  'subfamilias', 'familias', 'areas',
  'empresas', 'usuario_local', 'locales', 'grupos',
  'restablecimientos', 'entra_intentos', 'entra_vales'
];

const cuantas = (tabla) => db.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get().n;

if (!hacerlo) {
  console.log(`
  Esto va a borrar el contenido de ${db.name || 'la base de datos'} y ponerlo de demostración.

  Se conservan las ${cuantas('usuarios')} cuentas, con sus contraseñas, sus sesiones y sus
  móviles registrados. Se borra:
`);
  for (const tabla of SE_VAN) {
    const n = cuantas(tabla);
    if (n) console.log(`    ${String(n).padStart(5)}  ${tabla}`);
  }
  console.log(`
  Y los archivos adjuntos que haya en disco.

  Si es lo que quieres:  node tools/demo.js --si
`);
  return;
}

// ---------- La empresa inventada ----------
//
// Nada de esto nombra a nadie real, y los locales de la instalación tampoco
// pintan aquí: una app que se presenta como cliente genérico no debería
// enseñar la casa de su primer usuario a quien la está revisando.

const LOCALES = ['Restaurante Centro', 'Hotel Playa', 'Cafetería Norte'];
const GRUPOS = ['Mantenimiento', 'Informática'];
const AREAS = ['Cocina', 'Sala', 'Barra'];

const FAMILIAS = {
  Cocina: ['Frío', 'Cocción', 'Lavado'],
  Sala: ['Climatización', 'Mobiliario', 'Iluminación'],
  Barra: ['Cafetería', 'Refrigeración']
};

const SUBFAMILIAS = {
  Frío: ['Cámara frigorífica', 'Arcón congelador'],
  Cocción: ['Horno', 'Freidora'],
  Climatización: ['Split', 'Conducto']
};

const EMPRESAS = [
  { nombre: 'Fríos del Sur, S.L.', contacto: 'Atención al cliente',
    telefono: '900 000 001', email: 'avisos@ejemplo.test',
    notas: 'Mantenimiento de cámaras y arcones. Contrato anual.' },
  { nombre: 'Clima Ejemplo', contacto: 'Servicio técnico',
    telefono: '900 000 002', email: 'sat@ejemplo.test',
    notas: 'Revisión semestral de los equipos de climatización.' }
];

// La contraseña de las cuentas de demostración, impresa al terminar. Las
// cuentas que ya existían no se tocan: siguen con la suya.
const CLAVE = 'Demo2026!';

const CUENTAS = [
  { usuario: 'demo', nombre: 'Ana Demo', rol: 'admin', grupo: null, locales: [] },
  { usuario: 'demo.gestor', nombre: 'Luis Ortega', rol: 'gestor', grupo: null, locales: [] },
  { usuario: 'demo.tecnico', nombre: 'Marta Ruiz', rol: 'tecnico', grupo: 'Mantenimiento',
    locales: ['Restaurante Centro', 'Hotel Playa'] },
  { usuario: 'demo.tecnico2', nombre: 'Diego Salas', rol: 'tecnico', grupo: 'Mantenimiento',
    locales: [] },
  { usuario: 'demo.informatica', nombre: 'Nuria Peña', rol: 'tecnico', grupo: 'Informática',
    locales: [] },
  { usuario: 'demo.encargado', nombre: 'Carmen Vidal', rol: 'empleado', grupo: null,
    locales: ['Restaurante Centro'] },
  { usuario: 'demo.camarero', nombre: 'Pablo Nieto', rol: 'usuario', grupo: null,
    locales: ['Restaurante Centro'] }
];

// ---------- Fechas ----------

const HOY = new Date();

// Texto en UTC, igual que el que escribe `datetime('now')`.
function haceDias(dias, hora = 10) {
  const d = new Date(HOY);
  d.setDate(d.getDate() - dias);
  d.setHours(hora, 0, 0, 0);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

const dosCifras = (n) => String(n).padStart(2, '0');
const comoFecha = (d) => `${d.getFullYear()}-${dosCifras(d.getMonth() + 1)}-${dosCifras(d.getDate())}`;

// ---------- Adelante ----------

const llenar = db.transaction(() => {
  // Las cuentas se quedan y apuntan a un grupo, así que hay que soltarlas antes
  // de borrar los grupos: las claves foráneas están activas y lo impiden. Se
  // les vuelve a poner uno más abajo.
  db.prepare('UPDATE usuarios SET grupo_id = NULL').run();

  for (const tabla of SE_VAN) db.prepare(`DELETE FROM ${tabla}`).run();
  db.prepare(
    `DELETE FROM sqlite_sequence WHERE name NOT IN (${SE_QUEDAN.map(() => '?').join(',')})`
  ).run(...SE_QUEDAN);

  // ----- Catálogos -----

  const grupos = {};
  GRUPOS.forEach((nombre, i) => {
    grupos[nombre] = db.prepare('INSERT INTO grupos (nombre, orden) VALUES (?, ?)')
      .run(nombre, i).lastInsertRowid;
  });

  const locales = {};
  LOCALES.forEach((nombre, i) => {
    locales[nombre] = db.prepare('INSERT INTO locales (nombre, orden) VALUES (?, ?)')
      .run(nombre, i).lastInsertRowid;
  });

  const areas = {};
  AREAS.forEach((nombre, i) => {
    areas[nombre] = db.prepare('INSERT INTO areas (nombre, orden) VALUES (?, ?)')
      .run(nombre, i).lastInsertRowid;
  });

  const familias = {};
  let ordenFamilia = 0;
  for (const [area, lista] of Object.entries(FAMILIAS)) {
    for (const nombre of lista) {
      familias[nombre] = db.prepare(
        'INSERT INTO familias (nombre, orden, area_id) VALUES (?, ?, ?)'
      ).run(nombre, ordenFamilia += 1, areas[area]).lastInsertRowid;
    }
  }

  const subfamilias = {};
  let ordenSub = 0;
  for (const [familia, lista] of Object.entries(SUBFAMILIAS)) {
    for (const nombre of lista) {
      subfamilias[nombre] = db.prepare(
        'INSERT INTO subfamilias (nombre, orden, familia_id) VALUES (?, ?, ?)'
      ).run(nombre, ordenSub += 1, familias[familia]).lastInsertRowid;
    }
  }

  const empresas = {};
  EMPRESAS.forEach((e, i) => {
    empresas[e.nombre] = db.prepare(`
      INSERT INTO empresas (nombre, contacto, telefono, email, notas, orden)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(e.nombre, e.contacto, e.telefono, e.email, e.notas, i).lastInsertRowid;
  });

  // ----- Cuentas -----
  //
  // Las de demostración se crean si no están; si el nombre ya existe se
  // reutiliza esa cuenta, sin tocarle la contraseña.

  const hash = auth.hashPassword(CLAVE);
  const usuarios = {};
  const creadas = [];

  for (const c of CUENTAS) {
    let fila = db.prepare('SELECT id FROM usuarios WHERE usuario = ?').get(c.usuario);
    if (!fila) {
      const id = db.prepare(`
        INSERT INTO usuarios (usuario, nombre, rol, email, grupo_id, password_hash, creado_en)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(c.usuario, c.nombre, c.rol, `${c.usuario}@ejemplo.test`,
             c.grupo ? grupos[c.grupo] : null, hash, haceDias(120)).lastInsertRowid;
      fila = { id };
      creadas.push(c.usuario);
    } else {
      // Existía de una pasada anterior: se le vuelve a poner su grupo, que se
      // ha ido con el borrado de arriba.
      db.prepare('UPDATE usuarios SET rol = ?, grupo_id = ?, bloqueada = 0 WHERE id = ?')
        .run(c.rol, c.grupo ? grupos[c.grupo] : null, fila.id);
    }
    usuarios[c.usuario] = fila.id;
    for (const local of c.locales) {
      db.prepare('INSERT OR IGNORE INTO usuario_local (usuario_id, local_id) VALUES (?, ?)')
        .run(fila.id, locales[local]);
    }
  }

  // Las cuentas que ya había se quedan huérfanas: su grupo y sus locales
  // acaban de desaparecer. Se reenganchan al mundo nuevo, porque una cuenta de
  // técnico sin grupo no ve ninguna incidencia y parecería que la aplicación
  // está rota.
  const reenganchadas = [];
  const otras = db.prepare(`
    SELECT id, usuario, rol FROM usuarios
    WHERE usuario NOT IN (${CUENTAS.map(() => '?').join(',')})
  `).all(...CUENTAS.map((c) => c.usuario));

  for (const u of otras) {
    if (u.rol === 'tecnico') {
      // A Mantenimiento, y sin locales marcados, que en este programa significa
      // «atiende todos».
      db.prepare('UPDATE usuarios SET grupo_id = ? WHERE id = ?')
        .run(grupos.Mantenimiento, u.id);
    } else {
      db.prepare('UPDATE usuarios SET grupo_id = NULL WHERE id = ?').run(u.id);
      // Empleados y usuarios necesitan locales o no ven nada. Todos, para que
      // la demostración se vea entera desde cualquier cuenta.
      for (const id of Object.values(locales)) {
        db.prepare('INSERT OR IGNORE INTO usuario_local (usuario_id, local_id) VALUES (?, ?)')
          .run(u.id, id);
      }
    }
    reenganchadas.push(u.usuario);
  }

  // ----- Inventario -----

  const ACTIVOS = [
    ['Cámara frigorífica 1', 'Cámara de conservación de la cocina principal.', 'en_uso', 'Restaurante Centro', 'Mantenimiento'],
    ['Horno mixto', 'Horno de convección con vapor, seis bandejas.', 'en_uso', 'Restaurante Centro', 'Mantenimiento'],
    ['Freidora doble', 'Fuera de servicio a la espera de repuesto.', 'roto', 'Restaurante Centro', 'Mantenimiento'],
    ['Split sala principal', 'Climatización de la sala de abajo.', 'en_uso', 'Restaurante Centro', 'Mantenimiento'],
    ['Cafetera de dos brazos', 'Barra principal.', 'en_uso', 'Cafetería Norte', 'Mantenimiento'],
    ['Arcón congelador', 'De reserva, guardado en el almacén.', 'almacen', 'Hotel Playa', 'Mantenimiento'],
    ['Terminal de punto de venta', 'Caja de la barra.', 'en_uso', 'Restaurante Centro', 'Informática'],
    ['Impresora de comandas', 'Cocina. Conectada por red.', 'en_uso', 'Restaurante Centro', 'Informática']
  ];
  for (const [nombre, descripcion, estado, local, grupo] of ACTIVOS) {
    db.prepare(`
      INSERT INTO activos (nombre, descripcion, estado, local_id, grupo_id, creado_en, actualizado_en)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(nombre, descripcion, estado, locales[local], grupos[grupo],
           haceDias(90), haceDias(90));
  }

  // ----- Incidencias -----

  const nuevaIncidencia = (t) => {
    const id = db.prepare(`
      INSERT INTO tickets (titulo, descripcion, estado, prioridad, grupo_id, local_id,
        area_id, familia_id, subfamilia_id, empresa_id, creado_por, asignado_a,
        creado_en, actualizado_en, cerrado_en)
      VALUES (@titulo, @descripcion, @estado, @prioridad, @grupo_id, @local_id,
        @area_id, @familia_id, @subfamilia_id, @empresa_id, @creado_por, @asignado_a,
        @creado_en, @actualizado_en, @cerrado_en)
    `).run({
      titulo: t.titulo,
      descripcion: t.descripcion,
      estado: t.estado,
      prioridad: t.prioridad || 'normal',
      grupo_id: grupos[t.grupo],
      local_id: locales[t.local],
      area_id: t.area ? areas[t.area] : null,
      familia_id: t.familia ? familias[t.familia] : null,
      subfamilia_id: t.subfamilia ? subfamilias[t.subfamilia] : null,
      empresa_id: t.empresa ? empresas[t.empresa] : null,
      creado_por: usuarios[t.abre],
      asignado_a: t.asignada ? usuarios[t.asignada] : null,
      creado_en: haceDias(t.hace),
      actualizado_en: haceDias(t.movida ?? t.hace),
      cerrado_en: t.estado === 'cerrado' ? haceDias(t.movida ?? t.hace) : null
    }).lastInsertRowid;

    // La descripción es el primer mensaje del hilo, igual que al abrirla desde
    // la aplicación.
    db.prepare(`
      INSERT INTO mensajes (ticket_id, autor_id, contenido, creado_en, apertura)
      VALUES (?, ?, ?, ?, 1)
    `).run(id, usuarios[t.abre], t.descripcion, haceDias(t.hace));

    let cuando = t.hace;
    for (const [quien, texto] of t.hilo || []) {
      cuando = Math.max(0, cuando - 1);
      db.prepare('INSERT INTO mensajes (ticket_id, autor_id, contenido, creado_en) VALUES (?, ?, ?, ?)')
        .run(id, usuarios[quien], texto, haceDias(cuando, 12));
    }
  };

  const INCIDENCIAS = [
    {
      titulo: 'La cámara frigorífica no enfría',
      descripcion: 'Marca 8 grados desde esta mañana. Hemos sacado el género a la cámara pequeña.',
      estado: 'abierto', prioridad: 'urgente', grupo: 'Mantenimiento', local: 'Restaurante Centro',
      area: 'Cocina', familia: 'Frío', subfamilia: 'Cámara frigorífica',
      abre: 'demo.encargado', asignada: 'demo.tecnico', hace: 1,
      hilo: [
        ['demo.tecnico', 'Voy para allá esta tarde. ¿Habéis mirado si el condensador está sucio?'],
        ['demo.encargado', 'Está bastante lleno de pelusa, sí.']
      ]
    },
    {
      titulo: 'Freidora fuera de servicio',
      descripcion: 'Salta el térmico cada vez que se enciende. La hemos dejado desconectada.',
      estado: 'pendiente', prioridad: 'urgente', grupo: 'Mantenimiento', local: 'Restaurante Centro',
      area: 'Cocina', familia: 'Cocción', subfamilia: 'Freidora',
      abre: 'demo.encargado', asignada: 'demo.tecnico', hace: 9, movida: 4,
      hilo: [
        ['demo.tecnico', 'La resistencia está a masa. Hay que cambiarla, he pedido el repuesto.'],
        ['demo.gestor', '¿Para cuándo lo tienes?'],
        ['demo.tecnico', 'Me dicen que el martes. Mientras tanto no la conectéis.']
      ]
    },
    {
      titulo: 'El aire de la sala no enfría bien',
      descripcion: 'Por la tarde la sala se queda en 26 grados con el equipo al máximo.',
      estado: 'pendiente', prioridad: 'normal', grupo: 'Mantenimiento', local: 'Restaurante Centro',
      area: 'Sala', familia: 'Climatización', subfamilia: 'Split',
      empresa: 'Clima Ejemplo', abre: 'demo.camarero', asignada: 'demo.tecnico2',
      hace: 14, movida: 6,
      hilo: [
        ['demo.tecnico2', 'Le falta gas. Aviso a Clima Ejemplo, que lleva el contrato.'],
        ['demo.tecnico2', 'Vienen el jueves por la mañana.']
      ]
    },
    {
      titulo: 'La impresora de comandas no imprime',
      descripcion: 'La cocina no recibe las comandas desde la caja. Las estamos cantando a voces.',
      estado: 'abierto', prioridad: 'urgente', grupo: 'Informática', local: 'Restaurante Centro',
      abre: 'demo.camarero', hace: 0
    },
    {
      titulo: 'Cambiar las luces del pasillo',
      descripcion: 'Tres fluorescentes fundidos en el pasillo de las habitaciones.',
      estado: 'abierto', prioridad: 'cuando_se_pueda', grupo: 'Mantenimiento', local: 'Hotel Playa',
      area: 'Sala', familia: 'Iluminación', abre: 'demo.gestor', hace: 20
    },
    {
      titulo: 'La cafetera pierde agua por la base',
      descripcion: 'Deja un charco durante el servicio de la mañana.',
      estado: 'cerrado', prioridad: 'normal', grupo: 'Mantenimiento', local: 'Cafetería Norte',
      area: 'Barra', familia: 'Cafetería',
      abre: 'demo.encargado', asignada: 'demo.tecnico', hace: 31, movida: 28,
      hilo: [
        ['demo.tecnico', 'Era la junta del grupo. Cambiada y probada, ya no pierde.'],
        ['demo.encargado', 'Confirmado, esta mañana seca. Gracias.']
      ]
    },
    {
      titulo: 'Revisión del extractor de cocina',
      descripcion: 'Toca la limpieza semestral de los filtros y el conducto.',
      estado: 'cerrado', prioridad: 'normal', grupo: 'Mantenimiento', local: 'Restaurante Centro',
      area: 'Cocina', abre: 'demo.gestor', asignada: 'demo.tecnico2', hace: 45, movida: 41,
      hilo: [['demo.tecnico2', 'Filtros limpios y conducto revisado. Sin incidencias.']]
    },
    {
      titulo: 'El terminal de la barra se reinicia solo',
      descripcion: 'Se apaga y vuelve a arrancar varias veces al día, sobre todo con mucha gente.',
      estado: 'cerrado', prioridad: 'normal', grupo: 'Informática', local: 'Restaurante Centro',
      abre: 'demo.encargado', asignada: 'demo.informatica', hace: 60, movida: 52,
      hilo: [
        ['demo.informatica', 'La fuente de alimentación estaba al límite. Cambiada.'],
        ['demo.encargado', 'Llevamos una semana sin que se caiga.']
      ]
    },
    {
      titulo: 'Puerta de la cámara mal ajustada',
      descripcion: 'No cierra del todo y se forma escarcha en la junta.',
      estado: 'cerrado', prioridad: 'cuando_se_pueda', grupo: 'Mantenimiento', local: 'Hotel Playa',
      area: 'Cocina', familia: 'Frío', empresa: 'Fríos del Sur, S.L.',
      abre: 'demo.gestor', asignada: 'demo.tecnico', hace: 75, movida: 70,
      hilo: [['demo.tecnico', 'Vino Fríos del Sur, ajustaron bisagra y junta.']]
    }
  ];

  for (const t of INCIDENCIAS) nuevaIncidencia(t);

  // ----- Tareas programadas -----
  //
  // Sin ellas el calendario es una rejilla vacía, que es la peor primera
  // impresión posible.

  const inicio = comoFecha(new Date(HOY.getFullYear(), HOY.getMonth(), 1));
  const TAREAS = [
    { nombre: 'Limpieza de filtros de climatización', frecuencia: 'mensual', hora: '08:00',
      dias_mes: '1,15', titulo: 'Limpiar los filtros del aire',
      descripcion: 'Desmontar, lavar y secar los filtros de los equipos de sala.',
      grupo: 'Mantenimiento', local: null, area: 'Sala', familia: 'Climatización' },
    { nombre: 'Revisión de temperaturas de cámaras', frecuencia: 'diaria', hora: '09:00', cada: 1,
      titulo: 'Anotar temperaturas de las cámaras',
      descripcion: 'Registro diario obligatorio de temperaturas.',
      grupo: 'Mantenimiento', local: 'Restaurante Centro', area: 'Cocina', familia: 'Frío' },
    { nombre: 'Mantenimiento de la cafetera', frecuencia: 'semanal', hora: '07:30', cada: 1,
      dias_semana: '1', titulo: 'Descalcificar la cafetera',
      descripcion: 'Ciclo de limpieza y revisión de juntas.',
      grupo: 'Mantenimiento', local: 'Cafetería Norte', area: 'Barra', familia: 'Cafetería' },
    { nombre: 'Revisión semestral de climatización', frecuencia: 'mensual', hora: '10:00',
      dias_mes: '10', meses: '3,9', titulo: 'Revisión de la empresa de clima',
      descripcion: 'Visita de mantenimiento preventivo contratada.',
      grupo: 'Mantenimiento', local: null, area: 'Sala', familia: 'Climatización',
      externo: 1, empresa: 'Clima Ejemplo' },
    { nombre: 'Copia de seguridad del punto de venta', frecuencia: 'semanal', hora: '23:00',
      cada: 1, dias_semana: '5', titulo: 'Comprobar la copia de seguridad',
      descripcion: 'Verificar que la copia de la semana se ha hecho y se puede restaurar.',
      grupo: 'Informática', local: 'Restaurante Centro' }
  ];

  for (const t of TAREAS) {
    db.prepare(`
      INSERT INTO tareas_programadas
        (nombre, frecuencia, hora, fecha_inicio, cada, dias_semana, dias_mes, meses,
         plantilla_titulo, plantilla_descripcion, grupo_id, local_id, prioridad, activo,
         mantenimiento_externo, empresa_id, area_id, familia_id, subfamilia_id, evaluada_hasta)
      VALUES (@nombre, @frecuencia, @hora, @fecha_inicio, @cada, @dias_semana, @dias_mes, @meses,
         @titulo, @descripcion, @grupo_id, @local_id, 'normal', 1,
         @externo, @empresa_id, @area_id, @familia_id, NULL, @evaluada_hasta)
    `).run({
      nombre: t.nombre,
      frecuencia: t.frecuencia,
      hora: t.hora,
      fecha_inicio: inicio,
      cada: t.cada || 1,
      dias_semana: t.dias_semana || null,
      dias_mes: t.dias_mes || null,
      meses: t.meses || null,
      titulo: t.titulo,
      descripcion: t.descripcion,
      grupo_id: grupos[t.grupo],
      local_id: t.local ? locales[t.local] : null,
      externo: t.externo || 0,
      empresa_id: t.empresa ? empresas[t.empresa] : null,
      area_id: t.area ? areas[t.area] : null,
      familia_id: t.familia ? familias[t.familia] : null,
      // Desde hoy: si no, el primer repaso abriría de golpe todos los
      // vencimientos del mes, igual que al crear una tarea desde la web.
      evaluada_hasta: haceDias(0, 0)
    });
  }

  // ----- Lavandería -----

  const prendas = db.prepare('SELECT id FROM prendas_lavanderia ORDER BY orden, id').all();
  if (prendas.length) {
    const envio = db.prepare(`
      INSERT INTO envios_lavanderia (local_id, creado_por, creado_en, notas)
      VALUES (?, ?, ?, ?)
    `).run(locales['Hotel Playa'], usuarios['demo.encargado'], haceDias(2),
           'Recogida del martes.').lastInsertRowid;
    prendas.forEach((p, i) => {
      db.prepare(`
        INSERT INTO envio_lavanderia_items (envio_id, prenda_id, enviado, recibido)
        VALUES (?, ?, ?, ?)
      `).run(envio, p.id, (i + 2) * 6, 0);
    });

    // Uno ya recibido, con una diferencia: es el caso que da sentido a la
    // pantalla, no el que sale bien.
    const cerrado = db.prepare(`
      INSERT INTO envios_lavanderia
        (local_id, creado_por, creado_en, notas, recibido_en, recibido_por, notas_recepcion)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(locales['Hotel Playa'], usuarios['demo.encargado'], haceDias(9),
           'Recogida de la semana pasada.', haceDias(6), usuarios['demo.encargado'],
           'Faltan dos manteles, reclamado.').lastInsertRowid;
    prendas.forEach((p, i) => {
      const enviado = (i + 2) * 6;
      db.prepare(`
        INSERT INTO envio_lavanderia_items (envio_id, prenda_id, enviado, recibido)
        VALUES (?, ?, ?, ?)
      `).run(cerrado, p.id, enviado, i === 2 ? enviado - 2 : enviado);
    });
  }

  // ----- Chat de local -----
  //
  // Un canal vacío no enseña nada, y el chat es justo lo que no se entiende
  // hasta que se ve con conversación dentro.

  const CHARLA = [
    ['Restaurante Centro', [
      ['demo.encargado', 'Buenos días. Hoy entramos con dos reservas grandes a las 14:00.', 6],
      ['demo.camarero', 'Enterado. ¿Monto la sala de arriba?', 5],
      ['demo.encargado', 'Sí, y saca la vajilla nueva.', 5],
      ['demo.tecnico', 'Paso a media mañana a mirar la cámara, que sigue dando guerra.', 3]
    ]],
    ['Hotel Playa', [
      ['demo.encargado', 'La lavandería recoge mañana a primera hora.', 2],
      ['demo.gestor', 'Contad los manteles antes de cerrar, que la última vez faltaron dos.', 2],
      ['demo.encargado', 'Hecho, lo dejo anotado.', 1]
    ]],
    ['Cafetería Norte', [
      ['demo.camarero', 'La cafetera vuelve a gotear por la izquierda.', 1],
      ['demo.tecnico2', 'Es la junta otra vez. Llevo una de repuesto esta tarde.', 0]
    ]]
  ];

  const insertarCharla = db.prepare(`
    INSERT INTO chat_mensajes (local_id, autor_id, cliente_id, contenido, creado_en)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const [local, lineas] of CHARLA) {
    const localId = locales[local];
    let ultimo = 0;
    lineas.forEach(([quien, dice, hace], i) => {
      ultimo = insertarCharla.run(
        localId, usuarios[quien], `demo-${localId}-${i}`, dice, haceDias(hace, 9 + i)
      ).lastInsertRowid;
    });
    // A todos les ha llegado todo, y todos han leído hasta el penúltimo. Así el
    // último mensaje se ve «recibido» y los de antes «leído» —los dos estados
    // que hay que ver para entender los ticks— y el canal entra con un mensaje
    // nuevo, que es como se encuentra un chat de verdad al abrirlo.
    for (const c of CUENTAS) {
      if (!usuarios[c.usuario]) continue;
      db.prepare(`
        INSERT INTO chat_lecturas (local_id, usuario_id, recibido_hasta, leido_hasta)
        VALUES (?, ?, ?, ?)
      `).run(localId, usuarios[c.usuario], ultimo, Math.max(0, ultimo - 1));
    }
  }

  // Una denuncia sin atender, para que la cola de moderación no esté vacía.
  //
  // Es lo que hay que poder enseñar si en la revisión preguntan cómo se
  // atiende un aviso, y una pantalla en blanco no lo enseña. El mensaje
  // señalado es uno de los de arriba, corriente a propósito: lo que se
  // demuestra es el circuito, no una grosería inventada.
  const señalado = db.prepare(`
    SELECT id, autor_id FROM chat_mensajes
    WHERE local_id = ? AND contenido LIKE 'Contad los manteles%'
  `).get(locales['Hotel Playa']);
  if (señalado && usuarios['demo.camarero']) {
    db.prepare(`
      INSERT INTO chat_denuncias (mensaje_id, denunciante_id, motivo, creado_en)
      VALUES (?, ?, ?, ?)
    `).run(
      señalado.id,
      usuarios['demo.camarero'],
      'Creo que esto sobra, ya lo contamos ayer.',
      haceDias(0, 11)
    );
  }

  return { creadas, reenganchadas };
});

const { creadas, reenganchadas } = llenar();

// Los adjuntos de las incidencias borradas: sin sus filas no los alcanza nadie,
// y ocupan. Fuera de la transacción porque el disco no entiende de rollback.
const ADJUNTOS = path.join(db.carpetaDatos, 'adjuntos');
fs.rmSync(ADJUNTOS, { recursive: true, force: true });
// Y lo que se hubiera mandado por el chat de los locales, por lo mismo.
fs.rmSync(path.join(db.carpetaDatos, 'chat'), { recursive: true, force: true });

// ---------- Lo que ha quedado ----------

const cuenta = (tabla) => db.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get().n;

console.log(`
  Listo.

    ${cuenta('locales')} locales · ${cuenta('tickets')} incidencias · ${cuenta('mensajes')} mensajes
    ${cuenta('tareas_programadas')} tareas programadas · ${cuenta('activos')} activos · ${cuenta('empresas')} empresas
    ${cuenta('chat_mensajes')} mensajes de chat en los canales de los locales
    ${cuenta('chat_denuncias')} denuncia sin atender, en Administración › Moderación

  Cuentas: ${cuenta('usuarios')} en total.`);

if (creadas.length) {
  console.log(`
  Creadas ahora, todas con la contraseña ${CLAVE}:

    demo               Ana Demo        administrador
    demo.gestor        Luis Ortega     gestor
    demo.tecnico       Marta Ruiz      técnico de Mantenimiento
    demo.tecnico2      Diego Salas     técnico de Mantenimiento
    demo.informatica   Nuria Peña      técnico de Informática
    demo.encargado     Carmen Vidal    empleado del Restaurante Centro
    demo.camarero      Pablo Nieto     usuario del Restaurante Centro`);
}

if (reenganchadas.length) {
  console.log(`
  Cuentas que ya existían, con su contraseña de siempre. Se les ha puesto el
  mundo nuevo, porque su grupo y sus locales acababan de desaparecer:

    ${reenganchadas.join(', ')}

  Los técnicos han quedado en Mantenimiento y sin locales marcados, que en este
  programa significa que atienden todos.`);
}

console.log(`
  Para la revisión de Apple y de Google, «demo.encargado»: ve las incidencias de
  su local, abre unas nuevas y escribe en los hilos, que es el recorrido
  completo sin permitir borrar nada.
`);
