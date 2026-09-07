'use strict';

/**
 * Chat de local: un canal por cada local, al estilo de los canales de IRC.
 *
 * Lo que sostiene esta pantalla es que **la verdad está en el servidor y aquí
 * solo hay una copia**. El flujo de eventos (SSE) avisa de lo que pasa, pero
 * nada depende de que ese flujo esté vivo: al recuperar la conexión se piden
 * los mensajes que falten a partir del último que se tenía, y lo que estaba a
 * medio enviar se reintenta. Por eso un túnel, un ascensor o el wifi del local
 * yéndose no pierden nada ni dejan la pantalla mintiendo.
 */

// ---------- Estado ----------

const chat = {
  sesion: null,
  canales: [],
  // Canal abierto: { local_id, nombre, canal }
  activo: null,
  // Los mensajes del canal abierto, en orden.
  mensajes: [],
  // Hasta dónde ha llegado cada uno de los demás en el canal abierto, que es de
  // donde sale el estado de los mensajes propios.
  ajenas: {},
  conectados: new Set(),
  miembros: [],
  hayMas: false,
  cargandoMas: false,
  // Mensajes escritos que todavía no ha confirmado el servidor.
  salida: [],
  // Quién está escribiendo ahora mismo: id → momento en que se supo.
  escribiendo: new Map(),
  // Si la vista está pegada abajo. Mientras se lee hacia arriba no se arrastra
  // al usuario al final cada vez que entra un mensaje.
  abajo: true,
  // Las claves de lo que hay pintado ahora mismo, para poder añadir en vez de
  // rehacer la lista entera.
  pintado: [],
  enviando: false,
  flujo: null,
  reintentoFlujo: 0,
  reintentoSalida: null
};

// Mensajes seguidos de la misma persona dentro de este rato se agrupan en un
// bloque, sin repetir el nombre.
const AGRUPAR_MS = 5 * 60 * 1000;

const CLAVE_SALIDA = 'incidencias.chat.salida';

const $ = (id) => document.getElementById(id);

// ---------- Arranque ----------

async function iniciarChat() {
  chat.sesion = await initPagina('Chat');
  if (!chat.sesion) return;

  recuperarSalida();
  enlazarControles();

  try {
    chat.canales = await fetchJSON('/api/chat/canales');
  } catch (e) {
    alertaPagina(e.message);
    return;
  }
  pintarCanales();

  const pedido = Number(new URLSearchParams(location.search).get('local'));
  const inicial = chat.canales.find((c) => c.local_id === pedido) || chat.canales[0];
  if (inicial) {
    // En un móvil solo cabe una cosa en la pantalla, así que se entra por la
    // lista de canales, como en cualquier chat; el canal se carga igualmente
    // por detrás. Salvo que se venga con uno pedido en la dirección: entonces
    // se abre, que es a lo que se venía.
    await abrirCanal(inicial.local_id, {
      empujarHistorial: false,
      mostrar: !esMovil() || !!pedido
    });
  } else {
    $('chat-vacio').hidden = false;
  }

  conectarFlujo();
  vaciarSalida();

  // Dos redes de seguridad para lo que el flujo no cuente: volver a la pestaña
  // y recuperar la conexión del sistema.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    sincronizar();
    marcarLeido();
  });
  window.addEventListener('online', () => {
    conectarFlujo();
    sincronizar();
    vaciarSalida();
  });
  window.addEventListener('offline', () => pintarConexion(false));
}

function enlazarControles() {
  $('chat-redactar').addEventListener('submit', (e) => {
    e.preventDefault();
    enviar();
  });

  const texto = $('chat-texto');
  texto.addEventListener('input', () => {
    ajustarAltura(texto);
    avisarEscribiendo();
  });
  // Enter envía y Mayúsculas+Enter hace un salto de línea, como en cualquier
  // chat. En el móvil no: ahí el teclado trae su propia tecla de salto y
  // enviar sin querer es lo normal.
  texto.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !esMovil()) {
      e.preventDefault();
      enviar();
    }
  });

  $('chat-adjuntar').addEventListener('click', () => $('chat-archivo').click());
  $('chat-archivo').addEventListener('change', alElegirArchivo);
  $('chat-microfono').addEventListener('click', alternarGrabacion);
  $('chat-cancelar-audio').addEventListener('click', () => detenerGrabacion(false));
  $('chat-volver').addEventListener('click', volverALista);
  $('chat-nuevos').addEventListener('click', () => {
    irAbajo();
    marcarLeido();
  });

  const caja = $('chat-mensajes');
  caja.addEventListener('scroll', () => {
    chat.abajo = estaAbajo();
    if (chat.abajo) {
      $('chat-nuevos').classList.add('d-none');
      marcarLeido();
    }
    if (caja.scrollTop < 60) cargarAnteriores();
  });

  window.addEventListener('beforeunload', guardarSalida);
}

function esMovil() {
  return window.matchMedia('(max-width: 767.98px)').matches;
}

function conversacionALaVista() {
  return !esMovil() || document.getElementById('chat').classList.contains('chat-en-conversacion');
}

// ---------- Lista de canales ----------

function pintarCanales() {
  const lista = $('lista-canales');
  if (!chat.canales.length) {
    lista.innerHTML = `<p class="text-muted small p-3 mb-0">
      No estás dado de alta en ningún local, así que todavía no tienes ningún canal.
    </p>`;
    return;
  }

  lista.innerHTML = chat.canales.map((c) => {
    const activo = chat.activo && chat.activo.local_id === c.local_id;
    const ultimo = c.ultimo;
    const quien = ultimo
      ? (ultimo.autor_id === chat.sesion.id ? 'Tú' : primerNombre(ultimo.autor_nombre))
      : '';
    return `
      <button type="button" class="chat-canal${activo ? ' chat-canal-activo' : ''}"
              data-canal="${c.local_id}">
        <div class="chat-canal-fila">
          <span class="chat-canal-nombre">${esc(c.nombre)}</span>
          <span class="chat-canal-hora">${ultimo ? horaCorta(ultimo.creado_en) : ''}</span>
        </div>
        <div class="chat-canal-fila">
          <span class="chat-canal-ultimo">${
            ultimo ? `${esc(quien)}: ${esc(ultimo.resumen)}` : '<span class="text-muted">Sin mensajes</span>'
          }</span>
          ${c.sin_leer ? `<span class="chat-sin-leer">${c.sin_leer > 99 ? '99+' : c.sin_leer}</span>` : ''}
        </div>
        <div class="chat-canal-etiqueta">${esc(c.canal)}</div>
      </button>`;
  }).join('');

  lista.querySelectorAll('[data-canal]').forEach((b) => {
    b.addEventListener('click', () => abrirCanal(Number(b.dataset.canal)));
  });

  pintarAvisoChat(chat.canales.reduce((n, c) => n + c.sin_leer, 0));
}

function primerNombre(nombre) {
  return String(nombre || '').split(' ')[0];
}

function horaCorta(iso) {
  const f = instante(iso);
  if (!f) return '';
  const hoy = new Date();
  const mismoDia = f.toDateString() === hoy.toDateString();
  if (mismoDia) return `${String(f.getHours()).padStart(2, '0')}:${String(f.getMinutes()).padStart(2, '0')}`;
  return fmtFechaDe(iso);
}

// ---------- Abrir un canal ----------

async function abrirCanal(localId, { empujarHistorial = true, mostrar = true } = {}) {
  const canal = chat.canales.find((c) => c.local_id === localId);
  if (!canal) return;

  chat.activo = canal;
  chat.mensajes = [];
  chat.ajenas = {};
  chat.escribiendo.clear();
  chat.abajo = true;
  chat.pintado = [];

  $('chat-vacio').hidden = true;
  $('chat-conversacion').hidden = false;
  $('chat-nombre').textContent = `${canal.canal} · ${canal.nombre}`;
  $('chat-mensajes').innerHTML = '<p class="text-muted small p-3 mb-0">Cargando…</p>';
  if (mostrar) document.getElementById('chat').classList.add('chat-en-conversacion');
  pintarCanales();

  if (empujarHistorial) {
    history.replaceState(null, '', `/chat.html?local=${localId}`);
  }

  try {
    const datos = await fetchJSON(`/api/chat/canales/${localId}/mensajes`);
    aplicarPagina(datos, { reemplazar: true });
  } catch (e) {
    $('chat-mensajes').innerHTML = `<p class="text-danger small p-3 mb-0">${esc(e.message)}</p>`;
    return;
  }

  pintarMensajes();
  irAbajo();
  if (mostrar) {
    marcarLeido();
    $('chat-texto').focus();
  }
}

function volverALista() {
  document.getElementById('chat').classList.remove('chat-en-conversacion');
}

function aplicarPagina(datos, { reemplazar = false } = {}) {
  chat.miembros = datos.miembros || chat.miembros;
  chat.conectados = new Set(datos.conectados || []);
  chat.ajenas = {};
  for (const a of datos.ajenas || []) chat.ajenas[a.usuario_id] = a;
  if (reemplazar) {
    chat.mensajes = datos.mensajes;
    chat.hayMas = datos.hay_mas;
  }
  pintarGente();
}

function pintarGente() {
  const dentro = chat.conectados.size;
  const total = chat.miembros.length;
  $('chat-gente').textContent = total
    ? `${total} ${total === 1 ? 'persona' : 'personas'} · ${dentro} en línea`
    : '';
}

// ---------- Historial hacia arriba ----------

async function cargarAnteriores() {
  if (!chat.activo || !chat.hayMas || chat.cargandoMas || !chat.mensajes.length) return;
  chat.cargandoMas = true;
  const caja = $('chat-mensajes');
  const altoPrevio = caja.scrollHeight;
  try {
    const datos = await fetchJSON(
      `/api/chat/canales/${chat.activo.local_id}/mensajes?antes=${chat.mensajes[0].id}`
    );
    if (datos.mensajes.length) {
      chat.mensajes = datos.mensajes.concat(chat.mensajes);
      chat.hayMas = datos.hay_mas;
      pintarMensajes();
      // Se mantiene mirando lo mismo que antes de que le crecieran mensajes por
      // arriba, que es lo único que no marea.
      caja.scrollTop = caja.scrollHeight - altoPrevio;
    } else {
      chat.hayMas = false;
    }
  } catch (e) {
    // Sin conexión no hay historial que traer; se reintenta al volver a subir.
  } finally {
    chat.cargandoMas = false;
  }
}

// ---------- Pintado de la conversación ----------

function estadoDe(m) {
  if (m.pendiente) return m.fallo ? 'fallo' : 'enviando';
  let recibido = 0;
  let leido = 0;
  for (const a of Object.values(chat.ajenas)) {
    recibido = Math.max(recibido, a.recibido_hasta || 0);
    leido = Math.max(leido, a.leido_hasta || 0);
  }
  if (m.id <= leido) return 'leido';
  if (m.id <= recibido) return 'recibido';
  return 'enviado';
}

const TICKS = {
  enviando: { texto: '🕓', clase: '', titulo: 'Enviando' },
  fallo: { texto: '↻', clase: 'chat-tick-fallo', titulo: 'No se ha podido enviar. Se reintenta solo.' },
  enviado: { texto: '✓', clase: '', titulo: 'Enviado' },
  recibido: { texto: '✓✓', clase: '', titulo: 'Recibido' },
  leido: { texto: '✓✓', clase: 'chat-tick-leido', titulo: 'Leído' }
};

function ticksHtml(m) {
  if (m.autor_id !== chat.sesion.id) return '';
  const t = TICKS[estadoDe(m)];
  return `<span class="chat-tick ${t.clase}" title="${t.titulo}">${t.texto}</span>`;
}

// Un enlace escrito en el chat se puede pulsar. El texto se escapa antes, así
// que lo que se convierte en enlace es texto ya inofensivo.
function conEnlaces(texto) {
  return esc(texto).replace(/(https?:\/\/[^\s<]+)/g, (url) =>
    `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
}

function duracionCorta(segundos) {
  const s = Math.max(0, Math.round(segundos || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function adjuntosHtml(m) {
  if (!m.adjuntos || !m.adjuntos.length) return '';
  return m.adjuntos.map((a) => {
    // Mientras el mensaje va de camino su archivo todavía no tiene dirección en
    // el servidor: la foto se enseña desde el propio navegador y lo demás como
    // una etiqueta con su nombre, para que el globo no salga roto.
    if (!a.id) {
      return a.vistaPrevia
        ? `<img class="chat-foto-previa" src="${a.vistaPrevia}" alt="${esc(a.nombre)}">`
        : `<span class="mono-chip chat-documento">${esc(icono(a.tipo))} ${esc(a.nombre)}</span>`;
    }
    const url = `/api/chat/adjuntos/${a.id}`;
    if (a.tipo === 'imagen') {
      return `<button type="button" class="chat-foto" data-ver-imagen="${a.id}"
                      data-nombre="${esc(a.nombre)}" title="${esc(a.nombre)}">
                <img src="${url}" alt="${esc(a.nombre)}" loading="lazy">
              </button>`;
    }
    if (a.tipo === 'video') {
      return `<video class="chat-video" controls preload="metadata" playsinline
                     src="${url}" aria-label="${esc(a.nombre)}"></video>`;
    }
    if (a.tipo === 'audio') {
      return `<div class="chat-nota-voz">
                <audio controls preload="metadata" src="${url}" aria-label="Nota de voz"></audio>
                <span class="chat-nota-voz-pie text-muted">🎤 Nota de voz${
                  a.duracion ? ` · ${duracionCorta(a.duracion)}` : ''
                }</span>
              </div>`;
    }
    return `<a class="mono-chip chip-enlace chat-documento" href="${url}"
               target="_blank" rel="noopener">${esc(a.nombre)}</a>`;
  }).join('');
}

function mensajeHtml(m, anterior) {
  const propio = m.autor_id === chat.sesion.id;
  const seguido = anterior
    && anterior.autor_id === m.autor_id
    && !anterior.borrado === !m.borrado
    && Math.abs(instante(m.creado_en) - instante(anterior.creado_en)) < AGRUPAR_MS;

  const cabecera = seguido || propio ? '' :
    `<div class="chat-autor">${esc(m.autor_nombre)}</div>`;

  const cuerpo = m.borrado
    ? '<div class="chat-borrado">Mensaje eliminado</div>'
    : `${m.contenido ? `<div class="chat-texto-mensaje">${conEnlaces(m.contenido)}</div>` : ''}
       ${adjuntosHtml(m)}`;

  // El administrador borra cualquier mensaje, no solo el suyo: es lo que hace
  // falta cuando lo que hay que quitar lo ha escrito otro.
  const puedeBorrar = (propio || chat.sesion.rol === 'admin') && !m.borrado && !m.pendiente;
  const borrar = puedeBorrar
    ? `<button type="button" class="chat-borrar" data-borrar="${m.id}"
               title="Eliminar el mensaje" aria-label="Eliminar el mensaje">×</button>`
    : '';

  // Avisar de un mensaje ajeno. Del propio no: para eso está el borrar.
  const denunciar = !propio && !m.borrado && !m.pendiente
    ? `<button type="button" class="chat-denunciar" data-denunciar="${m.id}"
               title="Avisar al administrador" aria-label="Avisar al administrador">⚑</button>`
    : '';

  // Copiar el texto. De cualquiera, también del propio y del que todavía está
  // en la cola: no cambia nada y es lo que más se usa —en un chat de trabajo
  // se pasan referencias de pedido, matrículas y números de serie—.
  const copiar = m.contenido && !m.borrado
    ? `<button type="button" class="chat-copiar" data-copiar="1"
               title="Copiar el texto" aria-label="Copiar el texto">⧉</button>`
    : '';

  return `
    <div class="chat-globo${propio ? ' chat-globo-propio' : ''}${seguido ? ' chat-globo-seguido' : ''}${
      m.pendiente ? ' chat-globo-pendiente' : ''
    }" data-mensaje="${m.id || ''}" data-cliente="${esc(m.cliente_id || '')}">
      <div class="chat-burbuja">
        ${cabecera}
        ${cuerpo}
        <div class="chat-pie">
          <span class="chat-acciones">${copiar}${borrar}${denunciar}</span>
          <span class="chat-hora">${horaDe(m.creado_en)}</span>
          ${ticksHtml(m)}
        </div>
      </div>
    </div>`;
}

function horaDe(iso) {
  const f = instante(iso);
  if (!f) return '';
  return `${String(f.getHours()).padStart(2, '0')}:${String(f.getMinutes()).padStart(2, '0')}`;
}

function diaDe(iso) {
  const f = instante(iso);
  if (!f) return '';
  const hoy = new Date();
  const ayer = new Date(hoy.getTime() - 86400000);
  if (f.toDateString() === hoy.toDateString()) return 'Hoy';
  if (f.toDateString() === ayer.toDateString()) return 'Ayer';
  return fmtFechaDe(iso);
}

// Los pendientes van siempre al final: todavía no tienen número de mensaje.
function paraPintar() {
  const pendientes = chat.activo
    ? chat.salida
      .filter((s) => s.local_id === chat.activo.local_id)
      // El mensaje propio llega por el flujo, y a veces antes que la respuesta
      // al envío. Si ya está en la conversación, su pendiente sobra.
      .filter((s) => !chat.mensajes.some((m) => m.cliente_id === s.cliente_id))
      .map((s) => ({
        id: 0,
        cliente_id: s.cliente_id,
        autor_id: chat.sesion.id,
        autor_nombre: chat.sesion.nombre,
        contenido: s.contenido,
        creado_en: s.creado_en,
        adjuntos: s.vista || [],
        pendiente: true,
        fallo: !!s.fallo
      }))
    : [];
  return chat.mensajes.concat(pendientes);
}

/**
 * Los trozos de la conversación, cada uno con una clave estable: los mensajes
 * por su número —o por su identificador de cliente mientras van de camino— y
 * las cintas con la fecha por su día.
 */
function trozos() {
  const lista = paraPintar();
  const salida = [];
  if (chat.hayMas) {
    salida.push({ clave: 'mas', html: '<div class="chat-mas">Sube para ver lo anterior…</div>' });
  }
  let dia = null;
  lista.forEach((m, i) => {
    const suDia = diaDe(m.creado_en);
    if (suDia !== dia) {
      dia = suDia;
      salida.push({ clave: `dia:${dia}`, html: `<div class="chat-dia"><span>${esc(dia)}</span></div>` });
    }
    const anterior = i > 0 && diaDe(lista[i - 1].creado_en) === dia ? lista[i - 1] : null;
    salida.push({ clave: m.id ? `m:${m.id}` : `c:${m.cliente_id}`, html: mensajeHtml(m, anterior) });
  });
  return salida;
}

/**
 * Pinta la conversación **añadiendo** lo que falta cuando lo que hay es lo
 * mismo de antes con mensajes nuevos al final, que es el caso de siempre.
 *
 * Volver a escribir la lista entera cada vez sería más corto, pero corta la
 * nota de voz que se está escuchando y el vídeo que se está viendo en cuanto
 * alguien escribe algo. Solo se rehace del todo cuando de verdad ha cambiado
 * lo anterior: al cambiar de canal o al traer historial de más arriba.
 */
function pintarMensajes() {
  const caja = $('chat-mensajes');
  const partes = trozos();
  if (!partes.length) {
    caja.innerHTML = `<p class="text-muted small p-3 mb-0">
      Todavía no ha escrito nadie en este canal. Empieza tú.
    </p>`;
    chat.pintado = [];
    return;
  }

  const claves = partes.map((p) => p.clave);
  const previas = chat.pintado || [];
  // Con la lista vacía siempre se rehace: lo que hay puesto es el «Cargando…»
  // o el «todavía no ha escrito nadie», que no son trozos de la conversación.
  const soloAnade = previas.length > 0
    && previas.length <= claves.length
    && previas.every((c, i) => c === claves[i])
    && caja.querySelectorAll('[data-clave]').length === previas.length;

  if (soloAnade) {
    const nuevas = partes.slice(previas.length);
    if (nuevas.length) caja.insertAdjacentHTML('beforeend', envolver(nuevas));
  } else {
    caja.innerHTML = envolver(partes);
  }
  chat.pintado = claves;
  enlazarMensajes(caja);
  actualizarTicks();
}

function envolver(partes) {
  return partes.map((p) => `<div data-clave="${esc(p.clave)}">${p.html}</div>`).join('');
}

/**
 * Repinta solo el estado de los mensajes propios. Un acuse de lectura no puede
 * costar volver a pintar la conversación.
 */
function actualizarTicks() {
  for (const marca of $('chat-mensajes').querySelectorAll('.chat-tick')) {
    const globo = marca.closest('[data-mensaje]');
    if (!globo) continue;
    const id = Number(globo.dataset.mensaje);
    const mensaje = id
      ? chat.mensajes.find((m) => m.id === id)
      : pendienteDe(globo.dataset.cliente);
    if (!mensaje) continue;
    const t = TICKS[estadoDe(mensaje)];
    marca.textContent = t.texto;
    marca.title = t.titulo;
    marca.className = `chat-tick ${t.clase}`;
  }
}

// El mensaje de la cola que corresponde a un globo todavía sin número.
function pendienteDe(clienteId) {
  const s = chat.salida.find((x) => x.cliente_id === clienteId);
  return s && { id: 0, pendiente: true, fallo: !!s.fallo };
}

function enlazarMensajes(caja) {
  caja.querySelectorAll('[data-ver-imagen]:not([data-enlazado])').forEach((b) => {
    b.dataset.enlazado = '1';
    b.addEventListener('click', () => verImagen(b.dataset.verImagen, b.dataset.nombre));
  });
  caja.querySelectorAll('[data-borrar]:not([data-enlazado])').forEach((b) => {
    b.dataset.enlazado = '1';
    b.addEventListener('click', () => borrarMensaje(Number(b.dataset.borrar)));
  });
  caja.querySelectorAll('[data-denunciar]:not([data-enlazado])').forEach((b) => {
    b.dataset.enlazado = '1';
    b.addEventListener('click', () => denunciarMensaje(Number(b.dataset.denunciar)));
  });
  caja.querySelectorAll('[data-copiar]:not([data-enlazado])').forEach((b) => {
    b.dataset.enlazado = '1';
    b.addEventListener('click', () => copiarMensaje(b));
  });
}

let modalImagen = null;

function verImagen(id, nombre) {
  if (!modalImagen) modalImagen = new bootstrap.Modal($('modal-imagen'));
  $('imagen-titulo').textContent = nombre || '';
  $('imagen-grande').src = `/api/chat/adjuntos/${id}`;
  $('imagen-grande').alt = nombre || '';
  const descargar = $('imagen-descargar');
  descargar.href = `/api/chat/adjuntos/${id}`;
  descargar.setAttribute('download', nombre || 'archivo');
  modalImagen.show();
}

function estaAbajo() {
  const caja = $('chat-mensajes');
  return caja.scrollHeight - caja.scrollTop - caja.clientHeight < 80;
}

function irAbajo() {
  const caja = $('chat-mensajes');
  caja.scrollTop = caja.scrollHeight;
  chat.abajo = true;
  $('chat-nuevos').classList.add('d-none');
}

// ---------- Enviar ----------

// Los archivos ya subidos que se mandarán con el próximo mensaje.
let pendientes = [];

function pintarPendientes() {
  const caja = $('chat-pendientes');
  caja.classList.toggle('d-none', !pendientes.length);
  caja.innerHTML = pendientes.map((p) => `
    <span class="chat-pendiente">
      ${esc(icono(p.tipo))} ${esc(p.nombre)}
      <button type="button" class="chat-quitar" data-quitar="${p.id}" aria-label="Quitar">×</button>
    </span>`).join('');
  caja.querySelectorAll('[data-quitar]').forEach((b) => {
    b.addEventListener('click', () => quitarPendiente(Number(b.dataset.quitar)));
  });
}

function icono(tipo) {
  if (tipo === 'imagen') return '📷';
  if (tipo === 'video') return '🎬';
  if (tipo === 'audio') return '🎤';
  return '📎';
}

async function quitarPendiente(id) {
  pendientes = pendientes.filter((p) => p.id !== id);
  pintarPendientes();
  try {
    await fetchJSON(`/api/chat/borradores/${id}`, { method: 'DELETE' });
  } catch (e) { /* se irá solo en 24 h */ }
}

async function alElegirArchivo(e) {
  const archivo = e.target.files[0];
  e.target.value = '';
  if (!archivo) return;
  await subirAlChat(archivo);
}

async function subirAlChat(archivo, { duracion = null } = {}) {
  ocultarAlerta('chat-alert');
  try {
    const borrador = await adjuntarConProgreso(archivo, {
      caja: $('chat-progreso'),
      ruta: '/api/chat/borradores',
      parametros: duracion ? { duracion: String(Math.round(duracion)) } : {}
    });
    // Solo de las fotos: una vista previa de un vídeo de cien megas sería
    // tener el vídeo entero retenido en memoria para verlo dos segundos.
    if (borrador.tipo === 'imagen') borrador.vistaPrevia = URL.createObjectURL(archivo);
    pendientes.push(borrador);
    pintarPendientes();
    return borrador;
  } catch (err) {
    mostrarAlerta('chat-alert', err.message);
    return null;
  }
}

function enviar() {
  if (!chat.activo) return;
  const campo = $('chat-texto');
  const contenido = campo.value.trim();
  if (!contenido && !pendientes.length) return;

  const mensaje = {
    cliente_id: nuevoId(),
    local_id: chat.activo.local_id,
    contenido,
    adjuntos: pendientes.map((p) => p.id),
    // Solo para pintarlo mientras va: lo de verdad llega del servidor.
    vista: pendientes.map((p) => ({ ...p, id: 0 })),
    creado_en: new Date().toISOString(),
    intentos: 0
  };
  chat.salida.push(mensaje);
  guardarSalida();

  campo.value = '';
  ajustarAltura(campo);
  pendientes = [];
  pintarPendientes();
  pintarMensajes();
  irAbajo();
  vaciarSalida();
}

// La imagen que se enseñaba desde el navegador ya no hace falta: la de verdad
// llega del servidor y esta se quedaría ocupando memoria.
function soltarVistasPrevias(mensaje) {
  for (const a of mensaje.vista || []) {
    if (a.vistaPrevia) URL.revokeObjectURL(a.vistaPrevia);
  }
}

function nuevoId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * La cola de salida.
 *
 * Cada mensaje lleva su `cliente_id`, que es lo que hace que reintentar sea
 * gratis: si el envío llegó pero la respuesta no, el servidor devuelve el
 * mensaje que ya tenía en vez de escribirlo otra vez. Por eso se puede
 * reintentar a ciegas sin miedo a duplicar nada.
 */
async function vaciarSalida() {
  if (chat.enviando || !chat.salida.length) return;
  chat.enviando = true;
  clearTimeout(chat.reintentoSalida);

  while (chat.salida.length) {
    const m = chat.salida[0];
    try {
      const guardado = await fetchJSON(`/api/chat/canales/${m.local_id}/mensajes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cliente_id: m.cliente_id, contenido: m.contenido, adjuntos: m.adjuntos
        })
      });
      chat.salida.shift();
      soltarVistasPrevias(m);
      guardarSalida();
      recibirMensaje(guardado);
    } catch (e) {
      // Un rechazo del servidor (un mensaje vacío, un canal que ya no es suyo)
      // no se arregla repitiéndolo: se descarta y se dice por qué. Un fallo de
      // red, en cambio, se reintenta con una espera cada vez más larga.
      if (e.estado && e.estado >= 400 && e.estado < 500) {
        chat.salida.shift();
        soltarVistasPrevias(m);
        guardarSalida();
        mostrarAlerta('chat-alert', e.message);
      } else {
        m.intentos = (m.intentos || 0) + 1;
        m.fallo = true;
        guardarSalida();
        pintarMensajes();
        const espera = Math.min(30000, 1000 * 2 ** Math.min(m.intentos, 5));
        chat.reintentoSalida = setTimeout(() => { chat.enviando = false; vaciarSalida(); }, espera);
        chat.enviando = false;
        return;
      }
    }
  }

  chat.enviando = false;
  pintarMensajes();
}

/**
 * Lo que está sin mandar sobrevive a cerrar la pestaña.
 *
 * Los archivos ya están subidos —solo se guarda su identificador—, así que un
 * mensaje recuperado se manda entero. Lo que se pierde es un archivo que se
 * quedó subiendo cuando se cerró, y eso ya no estaba en ninguna parte.
 */
function guardarSalida() {
  try {
    localStorage.setItem(CLAVE_SALIDA, JSON.stringify(chat.salida));
  } catch (e) { /* sin almacenamiento local se pierde al recargar, nada más */ }
}

function recuperarSalida() {
  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE_SALIDA) || '[]');
    if (Array.isArray(guardado)) chat.salida = guardado.filter((m) => m && m.cliente_id);
  } catch (e) {
    chat.salida = [];
  }
}

function ajustarAltura(campo) {
  campo.style.height = 'auto';
  campo.style.height = `${Math.min(campo.scrollHeight, 140)}px`;
}

// ---------- Borrar ----------

async function borrarMensaje(id) {
  if (!await confirmar('El mensaje deja de verse para todos.', { titulo: 'Eliminar el mensaje' })) return;
  try {
    const borrado = await fetchJSON(`/api/chat/mensajes/${id}`, { method: 'DELETE' });
    reemplazarMensaje(borrado);
  } catch (e) {
    mostrarAlerta('chat-alert', e.message);
  }
}

// ---------- Copiar ----------

/**
 * El texto de un mensaje al portapapeles.
 *
 * Se lee de lo que hay pintado y no del objeto del mensaje: así vale igual
 * para uno confirmado que para uno que sigue en la cola de salida, y lo que se
 * copia es exactamente lo que se está viendo. Solo el texto: ni el nombre de
 * quien escribió ni la hora, que estorban allá donde se vaya a pegar.
 */
async function copiarMensaje(boton) {
  const globo = boton.closest('.chat-burbuja');
  const texto = globo && globo.querySelector('.chat-texto-mensaje');
  if (!texto) return;
  const contenido = texto.textContent.trim();
  if (!contenido) return;

  try {
    await alPortapapeles(contenido);
    mostrarAlerta('chat-alert', 'Texto copiado.', 'success');
  } catch (e) {
    mostrarAlerta('chat-alert', 'No se ha podido copiar.');
  }
}

/**
 * El portapapeles, por las dos vías.
 *
 * `navigator.clipboard` solo existe en un contexto seguro —HTTPS o localhost—.
 * Una instalación a la que se entra por su dirección IP en la red de un local
 * no lo es, y allí el botón no haría nada sin decir por qué; de ahí lo de
 * abajo, que es lo que había antes de que existiera esa API.
 */
async function alPortapapeles(texto) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(texto);
  }
  const campo = document.createElement('textarea');
  campo.value = texto;
  // Fuera de la vista, pero dentro del documento: seleccionar algo que no está
  // pintado no copia nada.
  campo.style.position = 'fixed';
  campo.style.opacity = '0';
  document.body.appendChild(campo);
  campo.select();
  try {
    if (!document.execCommand('copy')) throw new Error('el navegador no ha copiado');
  } finally {
    campo.remove();
  }
}

// ---------- Denunciar ----------

/**
 * Avisa al administrador de un mensaje ajeno.
 *
 * Se pide un motivo, y se deja mandarlo en blanco: obligar a escribir algo
 * hace que quien tenga prisa no avise. Lo que hace falta es que llegue.
 */
async function denunciarMensaje(id) {
  const motivo = prompt(
    'Se avisa al administrador, que verá el mensaje y decidirá.\n\n'
    + '¿Qué pasa con él? (puedes dejarlo en blanco)'
  );
  // `prompt` devuelve null al cancelar y '' al aceptar en blanco: solo lo
  // primero es «déjalo».
  if (motivo === null) return;
  try {
    await fetchJSON(`/api/chat/mensajes/${id}/denuncia`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ motivo })
    });
    mostrarAlerta('chat-alert', 'Avisado. El administrador lo revisará.', 'success');
  } catch (e) {
    mostrarAlerta('chat-alert', e.message);
  }
}

function reemplazarMensaje(mensaje) {
  const i = chat.mensajes.findIndex((m) => m.id === mensaje.id);
  if (i >= 0) chat.mensajes[i] = mensaje;
  pintarMensajes();
}

// ---------- Acuses ----------

let pendienteLeido = null;

/**
 * Marca como leído hasta el último mensaje, si el canal está abierto, a la
 * vista y por el final. Se agrupa un momento para no mandar un acuse por cada
 * mensaje de una ráfaga.
 */
function marcarLeido() {
  if (!chat.activo || document.hidden || !chat.abajo || !chat.mensajes.length) return;
  // En un móvil el canal puede estar cargado por detrás mientras se mira la
  // lista: eso no es haberlo leído.
  if (!conversacionALaVista()) return;
  const hasta = chat.mensajes[chat.mensajes.length - 1].id;
  clearTimeout(pendienteLeido);
  pendienteLeido = setTimeout(() => acusar(chat.activo.local_id, 'leido', hasta), 400);
}

function marcarRecibido(localId, hasta) {
  acusar(localId, 'recibido', hasta);
}

async function acusar(localId, cual, hasta) {
  if (!hasta) return;
  try {
    await fetchJSON(`/api/chat/canales/${localId}/${cual}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hasta })
    });
    if (cual === 'leido') {
      const canal = chat.canales.find((c) => c.local_id === localId);
      if (canal) {
        canal.sin_leer = 0;
        canal.leido_hasta = hasta;
        pintarCanales();
      }
    }
  } catch (e) {
    // Un acuse que no llega se vuelve a mandar en cuanto haya movimiento; no
    // merece molestar a nadie con un error.
  }
}

// ---------- «Está escribiendo…» ----------

let ultimoAviso = 0;

function avisarEscribiendo() {
  if (!chat.activo) return;
  const ahora = Date.now();
  if (ahora - ultimoAviso < 3000) return;
  ultimoAviso = ahora;
  fetch(`/api/chat/canales/${chat.activo.local_id}/escribiendo`, { method: 'POST' })
    .catch(() => {});
}

function pintarEscribiendo() {
  const caja = $('chat-escribiendo');
  const ahora = Date.now();
  const vivos = [];
  for (const [id, dato] of chat.escribiendo) {
    if (ahora - dato.momento > 4000) chat.escribiendo.delete(id);
    else vivos.push(primerNombre(dato.nombre));
  }
  caja.textContent = vivos.length
    ? `${vivos.join(', ')} ${vivos.length === 1 ? 'está escribiendo' : 'están escribiendo'}…`
    : '';
}

setInterval(pintarEscribiendo, 1000);

// ---------- El flujo de eventos ----------

function pintarConexion(conectado) {
  const punto = $('chat-conexion');
  punto.className = `chat-conexion ${conectado ? 'chat-conexion-viva' : 'chat-conexion-muerta'}`;
  punto.title = conectado ? 'Conectado' : 'Sin conexión: reintentando…';
}

/**
 * Abre el flujo de eventos y lo mantiene abierto.
 *
 * `EventSource` ya reconecta solo, pero no siempre —un error de red al abrir lo
 * deja muerto—, así que aquí se vigila y se vuelve a abrir con esperas
 * crecientes. Cada vez que se abre, el servidor manda `sincroniza` y la
 * pantalla se pone al día: la reconexión no depende de haber acertado con lo
 * que se perdió.
 */
function conectarFlujo() {
  if (chat.flujo) {
    chat.flujo.close();
    chat.flujo = null;
  }
  const flujo = new EventSource('/api/chat/flujo');
  chat.flujo = flujo;

  flujo.addEventListener('open', () => {
    chat.reintentoFlujo = 0;
    pintarConexion(true);
  });

  flujo.addEventListener('sincroniza', () => {
    pintarConexion(true);
    sincronizar();
    vaciarSalida();
  });

  flujo.addEventListener('mensaje', (e) => recibirMensaje(JSON.parse(e.data)));
  flujo.addEventListener('borrado', (e) => {
    const m = JSON.parse(e.data);
    if (chat.activo && m.local_id === chat.activo.local_id) reemplazarMensaje(m);
    refrescarCanales();
  });
  flujo.addEventListener('acuses', (e) => {
    const a = JSON.parse(e.data);
    if (!chat.activo || a.local_id !== chat.activo.local_id) return;
    if (a.usuario_id === chat.sesion.id) return;
    chat.ajenas[a.usuario_id] = a;
    actualizarTicks();
  });
  flujo.addEventListener('escribiendo', (e) => {
    const d = JSON.parse(e.data);
    if (!chat.activo || d.local_id !== chat.activo.local_id) return;
    chat.escribiendo.set(d.usuario_id, { nombre: d.nombre, momento: Date.now() });
    pintarEscribiendo();
  });
  flujo.addEventListener('presencia', (e) => {
    const d = JSON.parse(e.data);
    if (!chat.activo || d.local_id !== chat.activo.local_id) return;
    chat.conectados = new Set(d.conectados.map((c) => c.id));
    pintarGente();
  });

  flujo.addEventListener('error', () => {
    pintarConexion(false);
    // EventSource reintenta por su cuenta mientras siga «conectando». Si se ha
    // cerrado del todo, se abre otro con una espera que va creciendo.
    if (flujo.readyState !== EventSource.CLOSED) return;
    chat.reintentoFlujo += 1;
    const espera = Math.min(30000, 1000 * 2 ** Math.min(chat.reintentoFlujo, 5));
    setTimeout(() => { if (chat.flujo === flujo) conectarFlujo(); }, espera);
  });
}

/**
 * Un mensaje que llega, venga del flujo o de la respuesta al propio envío.
 *
 * Se descarta el que ya se tiene: el mismo mensaje llega dos veces —por el
 * flujo y como respuesta al POST— y eso es lo normal, no un fallo.
 */
function recibirMensaje(mensaje) {
  const canal = chat.canales.find((c) => c.local_id === mensaje.local_id);
  if (canal) {
    canal.ultimo = {
      id: mensaje.id,
      autor_id: mensaje.autor_id,
      autor_nombre: mensaje.autor_nombre,
      creado_en: mensaje.creado_en,
      resumen: resumenDeMensaje(mensaje)
    };
  }

  const esMio = mensaje.autor_id === chat.sesion.id;
  const activo = chat.activo && chat.activo.local_id === mensaje.local_id;

  if (activo) {
    if (!chat.mensajes.some((m) => m.id === mensaje.id)) {
      chat.mensajes.push(mensaje);
      chat.mensajes.sort((a, b) => a.id - b.id);
    }
    const pegado = chat.abajo;
    pintarMensajes();
    if (pegado || esMio) irAbajo();
    else $('chat-nuevos').classList.remove('d-none');
    if (!esMio) {
      // Ha llegado: el que lo mandó tiene que verlo, esté esta ventana delante
      // o no. Que además esté leído es otra cosa, y la decide `marcarLeido`.
      marcarRecibido(mensaje.local_id, mensaje.id);
      marcarLeido();
      if (document.hidden) sonarAviso();
    }
  } else if (!esMio) {
    if (canal) canal.sin_leer = (canal.sin_leer || 0) + 1;
    marcarRecibido(mensaje.local_id, mensaje.id);
    sonarAviso();
  }

  pintarCanales();
}

function resumenDeMensaje(m) {
  if (m.borrado) return 'Mensaje eliminado';
  if (m.contenido) return m.contenido.replace(/\s+/g, ' ').slice(0, 120);
  const a = m.adjuntos && m.adjuntos[0];
  if (!a) return '';
  if (a.tipo === 'imagen') return '📷 Foto';
  if (a.tipo === 'video') return '🎬 Vídeo';
  if (a.tipo === 'audio') return '🎤 Nota de voz';
  return `📎 ${a.nombre}`;
}

/**
 * Ponerse al día con el servidor: la lista de canales y, del canal abierto, los
 * mensajes que hayan entrado desde el último que se tenía.
 *
 * Es lo que se hace al conectar, al reconectar y al volver a la pestaña. No
 * hace falta saber qué se perdió: se pide desde donde se llegó.
 */
async function sincronizar() {
  await refrescarCanales();
  if (!chat.activo) return;
  const ultimo = chat.mensajes.length ? chat.mensajes[chat.mensajes.length - 1].id : 0;
  try {
    const datos = await fetchJSON(
      `/api/chat/canales/${chat.activo.local_id}/mensajes${ultimo ? `?desde=${ultimo}` : ''}`
    );
    aplicarPagina(datos, { reemplazar: !ultimo });
    if (ultimo) {
      for (const m of datos.mensajes) {
        if (!chat.mensajes.some((x) => x.id === m.id)) chat.mensajes.push(m);
      }
      chat.mensajes.sort((a, b) => a.id - b.id);
    }
    const pegado = chat.abajo;
    pintarMensajes();
    if (pegado) irAbajo();
    if (datos.mensajes.length) {
      marcarRecibido(chat.activo.local_id, datos.mensajes[datos.mensajes.length - 1].id);
      marcarLeido();
    }
  } catch (e) {
    // Se vuelve a intentar en la próxima ocasión: al reconectar el flujo o al
    // volver a la pestaña.
  }
}

async function refrescarCanales() {
  try {
    const canales = await fetchJSON('/api/chat/canales');
    chat.canales = canales;
    if (chat.activo) {
      chat.activo = canales.find((c) => c.local_id === chat.activo.local_id) || chat.activo;
    }
    pintarCanales();
  } catch (e) { /* se reintenta con la siguiente sincronización */ }
}

// ---------- Notas de voz ----------

let grabacion = null;

// El formato que sepa grabar el navegador. `.weba` es el nombre que le da esta
// aplicación al WebM que solo lleva sonido, para que el servidor no lo confunda
// con un vídeo.
const FORMATOS_AUDIO = [
  { mime: 'audio/webm;codecs=opus', extension: 'weba' },
  { mime: 'audio/webm', extension: 'weba' },
  { mime: 'audio/mp4', extension: 'm4a' },
  { mime: 'audio/ogg;codecs=opus', extension: 'oga' }
];

function formatoAudio() {
  if (typeof MediaRecorder === 'undefined') return null;
  return FORMATOS_AUDIO.find((f) => MediaRecorder.isTypeSupported(f.mime)) || null;
}

function alternarGrabacion() {
  if (grabacion) detenerGrabacion(true);
  else empezarGrabacion();
}

async function empezarGrabacion() {
  const formato = formatoAudio();
  if (!formato || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    mostrarAlerta('chat-alert', 'Este navegador no sabe grabar audio. Adjunta un archivo de sonido.');
    return;
  }

  let flujo;
  try {
    flujo = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    mostrarAlerta('chat-alert',
      'No se ha podido usar el micrófono. Comprueba el permiso del navegador.');
    return;
  }
  ocultarAlerta('chat-alert');

  const grabadora = new MediaRecorder(flujo, { mimeType: formato.mime });
  const trozos = [];
  grabadora.ondataavailable = (e) => { if (e.data.size) trozos.push(e.data); };
  grabacion = { grabadora, trozos, flujo, formato, desde: Date.now(), reloj: null };

  grabadora.start();
  $('chat-grabando').classList.remove('d-none');
  $('chat-microfono').classList.add('chat-icono-activo');
  grabacion.reloj = setInterval(() => {
    $('chat-grabando-tiempo').textContent = duracionCorta((Date.now() - grabacion.desde) / 1000);
  }, 250);
}

function detenerGrabacion(enviarla) {
  if (!grabacion) return;
  const g = grabacion;
  grabacion = null;
  clearInterval(g.reloj);
  $('chat-grabando').classList.add('d-none');
  $('chat-grabando-tiempo').textContent = '0:00';
  $('chat-microfono').classList.remove('chat-icono-activo');

  const segundos = (Date.now() - g.desde) / 1000;
  g.grabadora.onstop = async () => {
    for (const pista of g.flujo.getTracks()) pista.stop();
    // Menos de un segundo es un dedo resbalado, no una nota de voz.
    if (!enviarla || segundos < 1) return;
    const blob = new Blob(g.trozos, { type: g.formato.mime });
    const archivo = new File([blob], `nota-de-voz.${g.formato.extension}`, { type: g.formato.mime });
    const subido = await subirAlChat(archivo, { duracion: segundos });
    // Una nota de voz se manda sola en cuanto está: nadie graba una nota para
    // luego tener que darle a enviar.
    if (subido) enviar();
  };
  g.grabadora.stop();
}

iniciarChat();
