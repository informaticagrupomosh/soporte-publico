'use strict';

// Utilidades compartidas por todas las páginas del back office.

const MESES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

const fmtEntero = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });

function celdaNumero(v) {
  if (!v) return '<td class="num cell-zero">—</td>';
  return `<td class="num">${fmtEntero.format(v)}</td>`;
}

// Una fecha suelta del servidor («2026-08-19»), tal cual.
function fmtFecha(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

// Las marcas de tiempo se guardan en UTC («2026-08-19 09:30:00»). Aquí se
// convierten a la hora del navegador: si no, en verano se verían dos horas
// antes de lo que pasó.
function instante(iso) {
  if (!iso) return null;
  const texto = String(iso).trim().replace(' ', 'T');
  const fecha = new Date(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(texto) ? texto : `${texto}Z`);
  return Number.isFinite(fecha.getTime()) ? fecha : null;
}

const dosCifras = (n) => String(n).padStart(2, '0');

// Solo la fecha de una marca de tiempo, ya en hora local.
function fmtFechaDe(iso) {
  const f = instante(iso);
  if (!f) return '';
  return `${dosCifras(f.getDate())}/${dosCifras(f.getMonth() + 1)}/${f.getFullYear()}`;
}

function fmtFechaHora(iso) {
  const f = instante(iso);
  if (!f) return '';
  return `${fmtFechaDe(iso)} ${dosCifras(f.getHours())}:${dosCifras(f.getMinutes())}`;
}

// Antigüedad en palabras, para la segunda línea de las celdas de fecha.
function haceCuanto(iso) {
  const cuando = instante(iso);
  if (!cuando) return '';
  const minutos = Math.floor((Date.now() - cuando.getTime()) / 60000);
  if (minutos < 1) return 'Ahora mismo';
  if (minutos < 60) return `Hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `Hace ${horas} h`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? 'Hace 1 día' : `Hace ${dias} días`;
}

// Cuánto falta para un momento futuro, en palabras. Es la contraparte de
// haceCuanto(), para la próxima ejecución de una tarea programada.
function dentroDe(iso) {
  const cuando = instante(iso);
  if (!cuando) return '';
  const minutos = Math.round((cuando.getTime() - Date.now()) / 60000);
  if (minutos <= 0) return 'Ahora mismo';
  if (minutos < 60) return `Dentro de ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return horas === 1 ? 'Dentro de 1 h' : `Dentro de ${horas} h`;
  const dias = Math.round(horas / 24);
  return dias === 1 ? 'Mañana' : `Dentro de ${dias} días`;
}

// Cuenta con el sustantivo, en singular o plural: «1 incidencia» / «24 incidencias».
function cuenta(n, singular, plural) {
  return `${fmtEntero.format(n)} ${n === 1 ? singular : plural}`;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function fetchJSON(url, options) {
  const res = await fetch(url, options);
  let data = null;
  try { data = await res.json(); } catch (e) { /* sin cuerpo */ }
  if (res.status === 401 && location.pathname !== '/login.html' && url !== '/api/login') {
    location.href = '/login.html';
    throw new Error('Sesión no iniciada.');
  }
  if (!res.ok) {
    const error = new Error((data && data.error) || 'Error de conexión con el servidor.');
    // El detalle (por ejemplo, los segundos de espera del login) viaja aparte.
    error.datos = data || {};
    error.estado = res.status;
    throw error;
  }
  return data;
}

// `tipo` es el sufijo de Bootstrap: «danger» para los errores, que es lo
// habitual, y «success» cuando lo que hay que decir es que ha salido bien.
function mostrarAlerta(id, mensaje, tipo = 'danger') {
  const el = document.getElementById(id);
  el.className = `alert alert-${tipo}`;
  el.textContent = mensaje;
}

function ocultarAlerta(id) {
  const el = document.getElementById(id);
  el.className = 'alert d-none';
  el.textContent = '';
}

function alertaPagina(mensaje) {
  const area = document.getElementById('alert-area');
  if (!area) return;
  area.innerHTML = `
    <div class="alert alert-danger alert-dismissible" role="alert">
      ${esc(mensaje)}
      <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Cerrar"></button>
    </div>`;
}

// ---------- Vocabulario de las incidencias ----------

const ESTADOS = { abierto: 'Abierto', pendiente: 'Pendiente', cerrado: 'Cerrado' };
const PRIORIDADES = { urgente: 'Urgente', normal: 'Normal', cuando_se_pueda: 'Cuando se pueda' };
const ROLES = {
  usuario: 'Usuario', empleado: 'Empleado', tecnico: 'Técnico',
  gestor: 'Gestor', admin: 'Administrador'
};

// La prioridad urgente se marca en rojo solo mientras la incidencia sigue
// abierta: es un estado del registro que dice que algo va mal ahora mismo. Una
// vez cerrada deja de serlo, y el texto está siempre, así que nada depende del
// color.
function textoPrioridad(ticket) {
  const etiqueta = esc(PRIORIDADES[ticket.prioridad] || ticket.prioridad);
  if (ticket.prioridad === 'urgente' && ticket.estado !== 'cerrado') {
    return `<span class="text-danger fw-medium">${etiqueta}</span>`;
  }
  if (ticket.prioridad === 'cuando_se_pueda') return `<span class="text-muted">${etiqueta}</span>`;
  return etiqueta;
}

function textoEstado(ticket) {
  const etiqueta = esc(ESTADOS[ticket.estado] || ticket.estado);
  return ticket.estado === 'cerrado' ? `<span class="text-muted">${etiqueta}</span>` : etiqueta;
}

// Los mismos roles que «gestionan» en auth.js/server.js: quien no está en esta
// lista está en el lado de quien reporta la avería, sea «usuario» o «empleado».
const GESTIONAN = ['tecnico', 'gestor', 'admin'];

// De quién es el turno, calculado por el servidor para quien mira: la misma
// incidencia está «esperando tu respuesta» para el técnico y «respondido» para
// el empleado. El texto cambia según el lado, así que hace falta saber quién
// mira, no solo el estado.
function distintivoRespuesta(ticket, sesion) {
  const esGestion = GESTIONAN.includes(sesion.rol);
  let r;
  if (ticket.respuesta === 'nuevo') {
    // Nadie ha contestado todavía: solo le pasa al técnico, es la que pide atención.
    r = { texto: 'Nuevo', clase: 'text-bg-danger' };
  } else if (ticket.respuesta === 'esperando') {
    r = esGestion
      ? { texto: 'Esperando respuesta de usuario', clase: 'text-bg-warning' }
      : { texto: 'Esperando respuesta', clase: 'text-bg-warning' };
  } else if (ticket.respuesta === 'respondido') {
    r = esGestion
      ? { texto: 'Esperando tu respuesta', clase: 'text-bg-danger' }
      : { texto: 'Respondido', clase: 'text-bg-success' };
  } else {
    return '';
  }
  return `<span class="badge ${r.clase} fw-normal">${r.texto}</span>`;
}

// ---------- Aviso de incidencia nueva ----------

// El aviso suena poco y bajo: la aplicación se tiene abierta toda la jornada.
let avisoAudio = null;

function sonarAviso() {
  try {
    if (!avisoAudio) {
      avisoAudio = new Audio('/assets/alert.mp3');
      avisoAudio.volume = 0.5;
    }
    avisoAudio.currentTime = 0;
    // Hasta que no se toca la página, el navegador puede negarse a hacer
    // ruido. No es un error que deba molestar a nadie.
    const intento = avisoAudio.play();
    if (intento && intento.catch) intento.catch(() => {});
  } catch (e) { /* sin sonido */ }
}

// ---------- Adjuntos ----------

// Por debajo de este tamaño un vídeo no merece la espera de recomprimirlo.
const VIDEO_SIN_TOCAR = 8 * 1024 * 1024;
// Lado mayor y caudal del vídeo comprimido: suficiente para ver una avería.
const VIDEO_LADO = 1280;
const VIDEO_CAUDAL = 1200000;

function esVideo(archivo) {
  return /^video\//.test(archivo.type || '') || /\.(mp4|webm|mov|m4v|3gp)$/i.test(archivo.name);
}

function pesoLegible(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

// El navegador sabe recomprimir vídeo si puede volcar un lienzo a un flujo y
// grabarlo. Los que no (Safari en iPhone, sobre todo) suben el original.
function puedeComprimirVideo() {
  return typeof MediaRecorder !== 'undefined'
    && typeof HTMLCanvasElement.prototype.captureStream === 'function'
    && MediaRecorder.isTypeSupported('video/webm');
}

/**
 * Recomprime un vídeo dentro del navegador, sin subir nada ni depender de
 * ninguna librería: se reproduce, se van volcando sus fotogramas a un lienzo
 * más pequeño y se graba el resultado.
 *
 * Va en tiempo real —un vídeo de medio minuto tarda medio minuto—, que es el
 * motivo de que haya barra de progreso. Devuelve el archivo comprimido, o el
 * original si no compensa o el navegador no sabe hacerlo.
 */
async function comprimirVideo(archivo, alProgresar = () => {}) {
  if (archivo.size <= VIDEO_SIN_TOCAR || !puedeComprimirVideo()) return archivo;

  const url = URL.createObjectURL(archivo);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;

  try {
    await new Promise((listo, falla) => {
      video.onloadedmetadata = listo;
      video.onerror = () => falla(new Error('No se ha podido leer el vídeo.'));
    });

    const escala = Math.min(1, VIDEO_LADO / Math.max(video.videoWidth, video.videoHeight));
    const lienzo = document.createElement('canvas');
    // Las dimensiones han de ser pares para que el codificador no proteste.
    lienzo.width = Math.max(2, Math.round((video.videoWidth * escala) / 2) * 2);
    lienzo.height = Math.max(2, Math.round((video.videoHeight * escala) / 2) * 2);
    const ctx = lienzo.getContext('2d');

    const flujo = lienzo.captureStream(24);
    // El sonido se conserva si el navegador deja sacarlo del vídeo.
    try {
      const conAudio = video.captureStream ? video.captureStream() : null;
      for (const pista of (conAudio ? conAudio.getAudioTracks() : [])) flujo.addTrack(pista);
    } catch (e) { /* sin audio */ }

    const tipos = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    const mimeType = tipos.find((t) => MediaRecorder.isTypeSupported(t));
    const grabadora = new MediaRecorder(flujo, { mimeType, videoBitsPerSecond: VIDEO_CAUDAL });
    const trozos = [];
    grabadora.ondataavailable = (e) => { if (e.data.size) trozos.push(e.data); };

    const grabado = new Promise((listo) => { grabadora.onstop = listo; });
    grabadora.start(1000);
    // El vídeo suena en el vídeo grabado, no en los altavoces de quien lo sube.
    video.volume = 0;
    await video.play();

    let pintando = true;
    const pintar = () => {
      if (!pintando) return;
      ctx.drawImage(video, 0, 0, lienzo.width, lienzo.height);
      if (video.duration) alProgresar(Math.min(1, video.currentTime / video.duration));
      requestAnimationFrame(pintar);
    };
    pintar();

    await new Promise((listo) => { video.onended = listo; });
    pintando = false;
    grabadora.stop();
    await grabado;

    const comprimido = new Blob(trozos, { type: 'video/webm' });
    alProgresar(1);
    // Si la recompresión no ha ganado nada, se queda el original.
    if (!comprimido.size || comprimido.size >= archivo.size) return archivo;
    const nombre = `${archivo.name.replace(/\.[^.]+$/, '')}.webm`;
    return new File([comprimido], nombre, { type: 'video/webm' });
  } catch (e) {
    // Cualquier tropiezo del navegador: se sube el original y a otra cosa.
    return archivo;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Sube un archivo como borrador, informando del avance. `fetch` no sabe decir
 * cuánto lleva subido, así que aquí se usa XMLHttpRequest.
 *
 * El borrador no cuelga todavía de nada: se manda su identificador al crear la
 * incidencia o el mensaje, y es entonces cuando pasa a ser un adjunto. Así no
 * llega a existir una incidencia cuya foto se quedó a medio subir.
 */
function subirBorrador(archivo, {
  alProgresar = () => {}, ruta = '/api/adjuntos/borrador', parametros = {}
} = {}) {
  // El chat tiene su propia ruta de borradores: admite un formato más —el audio
  // de las notas de voz— y sus archivos viven en otra carpeta.
  const query = new URLSearchParams({ nombre: archivo.name, ...parametros });
  const url = `${ruta}?${query}`;

  return new Promise((listo, falla) => {
    const peticion = new XMLHttpRequest();
    peticion.open('POST', url);
    peticion.setRequestHeader('Content-Type', archivo.type || 'application/octet-stream');
    peticion.upload.onprogress = (e) => {
      if (e.lengthComputable) alProgresar(e.loaded / e.total);
    };
    peticion.onload = () => {
      let datos = null;
      try { datos = JSON.parse(peticion.responseText); } catch (e) { /* sin cuerpo */ }
      if (peticion.status >= 200 && peticion.status < 300) {
        alProgresar(1);
        listo(datos);
        return;
      }
      falla(new Error((datos && datos.error) || 'No se ha podido subir el adjunto.'));
    };
    peticion.onerror = () => falla(new Error('Error de conexión al subir el adjunto.'));
    peticion.send(archivo);
  });
}

/**
 * Comprime si hace falta y sube como borrador, moviendo una barra de progreso.
 * `caja` es el elemento que la contiene; se enseña al empezar y se esconde al
 * terminar. Devuelve el borrador, cuyo `id` hay que pasar después al crear la
 * incidencia o el mensaje.
 */
async function adjuntarConProgreso(archivo, { caja, ruta, parametros } = {}) {
  const barra = caja ? caja.querySelector('.barra-progreso span') : null;
  const texto = caja ? caja.querySelector('.progreso-texto') : null;
  const mostrar = (etiqueta, fraccion) => {
    if (caja) caja.classList.remove('d-none');
    if (barra) barra.style.width = `${Math.round(fraccion * 100)}%`;
    if (texto) texto.textContent = `${etiqueta} ${Math.round(fraccion * 100)} %`;
  };

  try {
    let subir = archivo;
    if (esVideo(archivo)) {
      mostrar('Comprimiendo el vídeo…', 0);
      subir = await comprimirVideo(archivo, (f) => mostrar('Comprimiendo el vídeo…', f));
      if (subir !== archivo && texto) {
        texto.textContent = `Comprimido de ${pesoLegible(archivo.size)} a ${pesoLegible(subir.size)}. Subiendo…`;
      }
    }
    mostrar(subir === archivo ? 'Subiendo…' : texto.textContent, 0);
    return await subirBorrador(subir, {
      ruta, parametros,
      alProgresar: (f) => mostrar('Subiendo…', f)
    });
  } finally {
    if (caja) caja.classList.add('d-none');
  }
}

// El trozo de HTML de la barra, para no repetirlo en cada página.
function cajaProgresoHtml(id) {
  return `<div class="progreso d-none" id="${id}">
      <div class="barra-progreso"><span></span></div>
      <div class="progreso-texto text-muted small"></div>
    </div>`;
}

// ---------- Planificación de las tareas programadas ----------

const FRECUENCIAS = {
  una_vez: 'Una vez', diaria: 'Diaria', semanal: 'Semanal', mensual: 'Mensual'
};

// El domingo es 0, como en JavaScript, pero la semana se enseña empezando en lunes.
const DIAS_SEMANA = [
  { id: 1, nombre: 'lunes', corto: 'Lun' },
  { id: 2, nombre: 'martes', corto: 'Mar' },
  { id: 3, nombre: 'miércoles', corto: 'Mié' },
  { id: 4, nombre: 'jueves', corto: 'Jue' },
  { id: 5, nombre: 'viernes', corto: 'Vie' },
  { id: 6, nombre: 'sábado', corto: 'Sáb' },
  { id: 0, nombre: 'domingo', corto: 'Dom' }
];

// «1,3,5» o vacío. Un texto vacío tiene que dar una lista vacía y no un cero:
// el cero es el domingo, y un mes cero no existe.
function listaDe(texto) {
  return String(texto == null ? '' : texto)
    .split(',')
    .map((n) => String(n).trim())
    .filter((n) => n !== '')
    .map(Number)
    .filter((n) => Number.isInteger(n));
}

// «lunes», «lunes y jueves», «lunes, martes y jueves».
function enumerar(partes) {
  if (partes.length <= 1) return partes.join('');
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
}

/**
 * La planificación de una tarea, en castellano corriente. La misma frase sirve
 * para la lista de tareas y para el aviso que acompaña al formulario mientras
 * se rellena, así que solo se escribe una vez.
 */
function describirPlan(t) {
  const hora = t.hora || '00:00';
  const cada = Number(t.cada) || 1;

  if (t.frecuencia === 'una_vez') {
    return `El ${fmtFecha(t.fecha_inicio)} a las ${hora}`;
  }

  if (t.frecuencia === 'diaria') {
    return cada === 1
      ? `Cada día a las ${hora}`
      : `Cada ${cada} días a las ${hora}`;
  }

  if (t.frecuencia === 'semanal') {
    const marcados = listaDe(t.dias_semana);
    const nombres = DIAS_SEMANA.filter((d) => marcados.includes(d.id)).map((d) => d.nombre);
    if (!nombres.length) return '';
    const dias = enumerar(nombres);
    return cada === 1
      ? `Cada ${dias} a las ${hora}`
      : `Cada ${cada} semanas, los ${dias}, a las ${hora}`;
  }

  if (t.frecuencia === 'mensual') {
    const dias = listaDe(t.dias_mes).sort((a, b) => a - b);
    if (!dias.length) return '';
    const cuales = dias.length === 1 ? `El día ${dias[0]}` : `Los días ${enumerar(dias)}`;
    const meses = listaDe(t.meses).sort((a, b) => a - b);
    const cuando = meses.length && meses.length < 12
      ? `de ${enumerar(meses.map((m) => MESES[m - 1].toLowerCase()))}`
      : 'de cada mes';
    return `${cuales} ${cuando} a las ${hora}`;
  }

  return '';
}

// ---------- Confirmación ----------

// Modal propio, en lugar del confirm() del navegador. Devuelve una promesa que
// se resuelve a true si se acepta y a false si se cancela o se cierra.
function confirmar(mensaje, { titulo = 'Confirmar', aceptar = 'Eliminar', peligro = true } = {}) {
  let caja = document.getElementById('modal-confirmar');
  if (!caja) {
    caja = document.createElement('div');
    caja.id = 'modal-confirmar';
    caja.className = 'modal fade';
    caja.tabIndex = -1;
    caja.setAttribute('aria-hidden', 'true');
    caja.innerHTML = `
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header border-0 pb-0">
            <h5 class="modal-title fw-semibold" id="confirmar-titulo"></h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button>
          </div>
          <div class="modal-body"><p class="mb-0" id="confirmar-mensaje"></p></div>
          <div class="modal-footer border-0 pt-0">
            <button type="button" class="btn btn-light" data-bs-dismiss="modal">Cancelar</button>
            <button type="button" class="btn" id="confirmar-aceptar"></button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(caja);
  }

  document.getElementById('confirmar-titulo').textContent = titulo;
  document.getElementById('confirmar-mensaje').textContent = mensaje;
  const boton = document.getElementById('confirmar-aceptar');
  boton.textContent = aceptar;
  boton.className = `btn ${peligro ? 'btn-danger' : 'btn-dark'}`;

  const modal = bootstrap.Modal.getOrCreateInstance(caja);
  return new Promise((resolve) => {
    let aceptado = false;
    const alAceptar = () => { aceptado = true; modal.hide(); };
    boton.addEventListener('click', alAceptar, { once: true });
    caja.addEventListener('hidden.bs.modal', () => {
      boton.removeEventListener('click', alAceptar);
      resolve(aceptado);
    }, { once: true });
    modal.show();
  });
}

function opciones(select, items, { valor = 'id', texto = 'nombre', placeholder = null, seleccionado = null } = {}) {
  let html = placeholder !== null ? `<option value="">${esc(placeholder)}</option>` : '';
  for (const item of items) {
    const v = typeof item === 'object' ? item[valor] : item;
    const t = typeof item === 'object' ? item[texto] : item;
    const sel = String(seleccionado) === String(v) ? ' selected' : '';
    html += `<option value="${esc(v)}"${sel}>${esc(t)}</option>`;
  }
  select.innerHTML = html;
}

// Convierte un diccionario de códigos («abierto») y etiquetas («Abierto») en la
// lista que espera opciones().
function comoLista(diccionario) {
  return Object.entries(diccionario).map(([id, nombre]) => ({ id, nombre }));
}

// Las subfamilias de una familia, para rellenar su desplegable cuando se
// elige la familia. Sin familia elegida, ninguna: no tiene sentido ofrecer
// subfamilias de otra.
function subfamiliasDe(meta, familiaId) {
  if (!familiaId) return [];
  return (meta.subfamilias || []).filter((s) => s.familia_id === familiaId);
}

// Las familias de un grupo (área), para rellenar su desplegable cuando se
// elige el grupo. Sin grupo elegido, ninguna: no tiene sentido ofrecer
// familias de otro.
function familiasDe(meta, areaId) {
  if (!areaId) return [];
  return (meta.familias || []).filter((f) => f.area_id === areaId);
}

// Los activos del inventario de un departamento y un local, para el
// desplegable opcional al abrir una incidencia: el activo está en un local
// concreto, así que solo tiene sentido ofrecer los del que se está reportando.
// Sin departamento o sin local elegidos, ninguno.
function activosDe(meta, grupoId, localId) {
  if (!grupoId || !localId) return [];
  return (meta.activos || []).filter((a) => a.grupo_id === grupoId && a.local_id === localId);
}

// ---------- Quién despliega esto ----------

/**
 * El nombre de la organización, que sale en la barra y en el título.
 *
 * No está en el código: lo dice el servidor, que lo lee de
 * `data/organizacion.json`. Así el mismo programa vale para cualquiera que lo
 * despliegue, y actualizar no le pisa el nombre a nadie.
 */
let organizacion = { nombre: 'Soporte', privacidad: '' };

function marcaDeLaCasa() {
  return organizacion.nombre || 'Soporte';
}

/**
 * Pide el nombre y lo deja puesto donde toque.
 *
 * Va sin sesión a propósito: la pantalla de acceso también se presenta, y ahí
 * todavía no hay nadie dentro. Si el servidor no contesta, se queda el nombre
 * genérico y no pasa nada más.
 */
async function cargarOrganizacion() {
  try {
    const datos = await fetch('/api/organizacion').then((r) => r.json());
    if (datos && datos.nombre) organizacion = datos;
  } catch (e) { /* se queda el nombre de partida */ }

  // La cabecera de las pantallas que no tienen barra de navegación: el acceso,
  // el cambio de contraseña y la vuelta de la app.
  const marca = document.getElementById('marca');
  if (marca) marca.textContent = marcaDeLaCasa();

  // Y el título de la pestaña, que en el HTML va sin nombre de nadie.
  if (!document.title.includes(marcaDeLaCasa())) {
    document.title = `${document.title} — ${marcaDeLaCasa()}`;
  }
  return organizacion;
}

// ---------- Sesión y navegación ----------

const SECCIONES = [
  { href: '/', etiqueta: 'Incidencias' },
  // El chat de local lo tiene todo el mundo: cada uno ve los canales de los
  // locales donde está dado de alta, y quien no tenga ninguno ve la lista vacía.
  { href: '/chat.html', etiqueta: 'Chat' },
  { href: '/informes.html', etiqueta: 'Informes', roles: ['admin', 'gestor', 'tecnico'] },
  { href: '/calendario.html', etiqueta: 'Calendario', roles: ['admin', 'gestor', 'tecnico'] },
  // El técnico no trabaja de cara al local, y el rol «usuario» —el de las
  // cuentas nuevas— solo reporta lo suyo: los dos se quedan fuera.
  { href: '/lavanderia.html', etiqueta: 'Lavandería', roles: ['empleado', 'gestor', 'admin'] },
  // El inventario lo lleva quien gestiona incidencias.
  { href: '/inventario.html', etiqueta: 'Inventario', roles: ['admin', 'gestor', 'tecnico'] }
];

const SECCIONES_ADMIN = [
  { href: '/grupos.html', etiqueta: 'Departamentos', roles: ['admin'] },
  { href: '/locales.html', etiqueta: 'Locales', roles: ['admin'] },
  { href: '/familias.html', etiqueta: 'Grupos y familias', roles: ['admin'] },
  { href: '/empresas.html', etiqueta: 'Empresas', roles: ['admin'] },
  { href: '/usuarios.html', etiqueta: 'Usuarios', roles: ['admin'] },
  // Los mensajes de los que alguien ha avisado. Va en Administración y no en
  // la barra porque la mayoría de los días está vacía; cuando no lo está, el
  // aviso sale en el propio desplegable.
  { href: '/moderacion.html', etiqueta: 'Moderación', roles: ['admin'] },
  // El programador lo lleva también el gestor.
  { href: '/tareas.html', etiqueta: 'Tareas programadas', roles: ['admin', 'gestor'] }
];

// Pinta la barra superior en #navbar. Solo lleva navegación: el botón de
// acción de cada página (Agregar X, Nuevo Y…) va en el cuerpo, junto al
// título de la sección, no aquí.
function renderNav(sesion, seccion) {
  const nav = document.getElementById('navbar');
  if (!nav) return;
  const rol = sesion ? sesion.rol : null;
  const enlaces = SECCIONES
    .filter((s) => !s.roles || s.roles.includes(rol))
    .map((s) => `<a href="${s.href}" class="btn btn-outline-secondary btn-sm">${esc(s.etiqueta)}${
      s.href === '/chat.html' ? '<span class="aviso-chat d-none" id="aviso-chat"></span>' : ''
    }</a>`)
    .join('');
  const entradasAdmin = SECCIONES_ADMIN.filter((s) => !s.roles || s.roles.includes(rol));
  const admin = entradasAdmin.length ? `
    <div class="dropdown">
      <button class="btn btn-outline-secondary btn-sm dropdown-toggle" data-bs-toggle="dropdown" aria-expanded="false">
        Administración<span class="aviso-chat d-none" id="aviso-admin"></span>
      </button>
      <ul class="dropdown-menu dropdown-menu-end">
        ${entradasAdmin.map((s) => `<li><a class="dropdown-item" href="${s.href}">${esc(s.etiqueta)}${
          s.href === '/moderacion.html' ? '<span class="aviso-chat d-none" id="aviso-moderacion"></span>' : ''
        }</a></li>`).join('')}
      </ul>
    </div>` : '';

  nav.className = 'navbar navbar-expand-xl navbar-light bg-white border-bottom';
  nav.innerHTML = `
    <div class="container-fluid px-3 px-xl-4 gap-2">
      <span class="navbar-brand fw-bold mb-0 me-0">${esc(marcaDeLaCasa())}
        <span class="text-muted fw-normal fs-6 d-none d-sm-inline">/ Incidencias / ${esc(seccion)}</span>
        <span class="text-muted fw-normal fs-6 d-sm-none">/ ${esc(seccion)}</span>
      </span>
      <div class="d-flex align-items-center gap-2 order-xl-last">
        <button class="navbar-toggler border-0 p-1" type="button" data-bs-toggle="collapse"
                data-bs-target="#nav-secciones" aria-controls="nav-secciones"
                aria-expanded="false" aria-label="Abrir el menú">
          <span class="navbar-toggler-icon"></span>
        </button>
      </div>
      <div class="collapse navbar-collapse" id="nav-secciones">
        <div class="d-flex flex-column flex-xl-row align-items-stretch align-items-xl-center
                    gap-2 gap-xl-3 py-3 py-xl-0 ms-xl-auto me-xl-3">
          ${enlaces}${admin}
          <a href="#" id="logout-btn" class="text-muted small text-decoration-none"
             title="${esc(sesion ? sesion.nombre : '')}">Cerrar sesión${
            sesion && sesion.usuario ? ` de «${esc(sesion.usuario)}»` : ''
          }</a>
        </div>
      </div>
    </div>`;

  document.getElementById('logout-btn').addEventListener('click', async (e) => {
    e.preventDefault();
    try { await fetchJSON('/api/logout', { method: 'POST' }); } catch (err) { /* la cookie ya no vale */ }
    location.href = '/login.html';
  });
}

/**
 * En un móvil los filtros ocupan una fila cada uno, y con media docena la tabla
 * se va debajo de la pantalla. Se pliegan tras un botón que dice cuántos hay
 * puestos, y se despliegan al tocarlo. En pantallas anchas no cambia nada.
 */
function plegarFiltrosEnMovil() {
  const barra = document.querySelector('.filtros');
  if (!barra || barra.dataset.plegable) return;
  const campos = barra.querySelectorAll(':scope > div');
  if (campos.length < 3) return;
  barra.dataset.plegable = '1';

  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'plegable filtros-boton d-none mb-2';
  boton.setAttribute('aria-controls', 'filtros');
  barra.id = barra.id || 'filtros';
  barra.parentNode.insertBefore(boton, barra);

  const contar = () => [...barra.querySelectorAll('select, input')]
    .filter((c) => c.value && !c.disabled).length;

  const pintar = () => {
    const abierta = !barra.classList.contains('filtros-plegada');
    const puestos = contar();
    boton.innerHTML = `<span>${abierta ? '▾' : '▸'}</span><span>Filtros${
      puestos ? ` · ${puestos}` : ''
    }</span>`;
    boton.setAttribute('aria-expanded', String(abierta));
  };

  const ajustar = () => {
    const estrecha = window.innerWidth < 520;
    boton.classList.toggle('d-none', !estrecha);
    // Al volver a una pantalla ancha, los filtros reaparecen siempre.
    if (!estrecha) barra.classList.remove('filtros-plegada');
    else if (!barra.dataset.tocada) barra.classList.add('filtros-plegada');
    pintar();
  };

  boton.addEventListener('click', () => {
    barra.dataset.tocada = '1';
    barra.classList.toggle('filtros-plegada');
    pintar();
  });
  barra.addEventListener('change', pintar);
  window.addEventListener('resize', ajustar);
  ajustar();
}

// ---------- Aviso del chat ----------

/**
 * Cuántos mensajes de chat quedan sin leer, en el propio enlace de la barra.
 *
 * Un chat del que uno no se entera hasta que entra a mirarlo no sirve de nada,
 * así que el número viaja con la navegación y se ve desde cualquier pantalla.
 */
function pintarAvisoChat(sinLeer) {
  const aviso = document.getElementById('aviso-chat');
  if (!aviso) return;
  aviso.textContent = sinLeer > 99 ? '99+' : String(sinLeer || '');
  aviso.classList.toggle('d-none', !sinLeer);
}

/**
 * Las denuncias de chat sin atender, para el administrador.
 *
 * Sale en el desplegable y también en el botón que lo abre: dentro de un menú
 * cerrado no lo vería nadie, y lo que se está prometiendo a las tiendas es que
 * a esto se le contesta el mismo día.
 */
function pintarAvisoModeracion(pendientes) {
  for (const id of ['aviso-admin', 'aviso-moderacion']) {
    const aviso = document.getElementById(id);
    if (!aviso) continue;
    aviso.textContent = pendientes > 99 ? '99+' : String(pendientes || '');
    aviso.classList.toggle('d-none', !pendientes);
  }
}

const CHAT_CADA_MS = 30000;

async function mirarChat() {
  if (document.hidden) return;
  try {
    const resumen = await fetchJSON('/api/chat/resumen');
    pintarAvisoChat(resumen.sin_leer);
    pintarAvisoModeracion(resumen.denuncias_pendientes);
  } catch (e) { /* se vuelve a mirar en la siguiente vuelta */ }
}

function vigilarChat(sesion) {
  // En la propia pantalla del chat el número lo lleva ella, al día y sin
  // preguntar cada medio minuto. El administrador es la excepción: el mismo
  // resumen trae las denuncias sin atender, y esa pantalla no las cuenta.
  const esAdmin = !!sesion && sesion.rol === 'admin';
  if (location.pathname === '/chat.html' && !esAdmin) return;
  mirarChat();
  setInterval(mirarChat, CHAT_CADA_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) mirarChat();
  });
}

// Carga la sesión y pinta la navegación. Devuelve la sesión (o null si falló).
async function initPagina(seccion) {
  try {
    await cargarOrganizacion();
    const sesion = await fetchJSON('/api/session');
    renderNav(sesion, seccion);
    plegarFiltrosEnMovil();
    vigilarChat(sesion);
    return sesion;
  } catch (e) {
    return null;
  }
}
