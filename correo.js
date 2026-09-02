'use strict';

/**
 * Avisos por correo, por la API de mensajes de CloudMailin.
 *
 * Se habla con ella directamente por HTTP, igual que con Firebase en
 * `notificaciones.js`: es un POST con la clave en la cabecera, así que no
 * compensa traerse un cliente —ni el `axios` que arrastra— para eso.
 *
 *   POST https://api.cloudmailin.com/api/v0.1/{usuario}/messages
 *   Authorization: Bearer {clave}
 *   { "to": …, "from": …, "subject": …, "plain": …, "html": … }
 *
 * La configuración vive fuera del repositorio, igual que las credenciales de
 * Firebase: en `data/correo.json` o donde diga la variable de entorno
 * `CORREO_CONFIG`. Sin ese archivo la aplicación funciona igual, solo que no
 * manda correos y lo anota una vez en el registro.
 *
 * ```json
 * {
 *   "usuario": "EL-USUARIO-DE-CLOUDMAILIN",
 *   "clave": "LA-API-KEY",
 *   "remitente": "Soporte <soporte@tu-dominio.com>",
 *   "url": "https://soporte.tu-dominio.com"
 * }
 * ```
 *
 * También se admite pegar tal cual la URL SMTP que da CloudMailin en
 * `"smtp"`, de la que se sacan el usuario y la clave; el envío sigue yendo por
 * la API.
 *
 * `url` es la dirección pública de la aplicación, la que se pone en los enlaces
 * de los correos. Sin ella los avisos salen sin botón.
 */

const fs = require('fs');
const path = require('path');
const db = require('./db');
const organizacion = require('./organizacion');

const RUTA = process.env.CORREO_CONFIG || path.join(__dirname, 'data', 'correo.json');
const API = 'https://api.cloudmailin.com/api/v0.1';

// Si no se dice otra cosa, los correos salen de aquí.
// Sale de `data/organizacion.json` si está; si no, no hay remitente por
// defecto que valga: una dirección inventada la rechazaría el proveedor de
// correo, así que es mejor decirlo que fingir que se ha enviado.
const REMITENTE_POR_DEFECTO = organizacion.remitente();

let ajustes = null;
let avisado = false;

/** Saca el usuario y la clave de la URL SMTP que da CloudMailin. */
function desdeSmtp(url) {
  const uri = new URL(url);
  if (!uri.username || !uri.password) {
    throw new Error('la URL SMTP no trae usuario y clave');
  }
  return { usuario: decodeURIComponent(uri.username), clave: decodeURIComponent(uri.password) };
}

function cargar() {
  if (ajustes !== null) return ajustes;
  try {
    const json = JSON.parse(fs.readFileSync(RUTA, 'utf8'));
    const credenciales = json.smtp
      ? desdeSmtp(json.smtp)
      : { usuario: json.usuario, clave: json.clave };

    if (!credenciales.usuario || !credenciales.clave) {
      throw new Error('faltan «usuario» y «clave» (o una «smtp» de la que sacarlos)');
    }
    ajustes = {
      ...credenciales,
      remitente: json.remitente || REMITENTE_POR_DEFECTO,
      url: json.url || ''
    };
    console.log('Avisos por correo activos.');
  } catch (e) {
    ajustes = false;
    if (!avisado) {
      avisado = true;
      console.log(`Avisos por correo desactivados: no se pudo leer ${RUTA} (${e.message}).`);
    }
  }
  return ajustes;
}

/**
 * Un correo por la API de CloudMailin.
 *
 * `modoPrueba` usa `test_mode`, que valida el mensaje y las credenciales sin
 * llegar a enviarlo. Lo usa la comprobación de `tools/probar-correo.js`.
 */
async function mandar({ to, subject, text, html, modoPrueba = false }) {
  let res;
  try {
    res = await fetch(`${API}/${ajustes.usuario}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ajustes.clave}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        to,
        from: ajustes.remitente,
        subject,
        plain: text,
        html,
        ...(modoPrueba ? { test_mode: true } : {})
      })
    });
  } catch (e) {
    // Ni se ha llegado a hablar con CloudMailin: se distingue del rechazo
    // porque lo que hay que revisar es otra cosa —salida a internet, DNS o un
    // cortafuegos— y no las credenciales.
    throw new Error(
      `No se pudo conectar con ${API}: ${e.message}. `
      + 'Comprueba que el servidor tiene salida a api.cloudmailin.com por HTTPS.'
    );
  }

  const detalle = await res.text().catch(() => '');
  if (res.ok) return { estado: res.status, detalle };

  // El cuerpo del error dice qué ha rechazado —lo más habitual, el remitente
  // sin verificar—, así que se arrastra entero hasta quien pueda leerlo.
  throw new Error(`CloudMailin respondió ${res.status}: ${detalle.slice(0, 500)}`);
}

/**
 * Cómo ha quedado la configuración, para poder mirarla sin destripar el
 * archivo. La clave se enseña recortada: lo suficiente para reconocerla y no
 * para usarla.
 */
function estado() {
  const cargado = cargar();
  if (!cargado) return { activo: false, ruta: RUTA };
  return {
    activo: true,
    ruta: RUTA,
    usuario: ajustes.usuario,
    clave: `${ajustes.clave.slice(0, 4)}…${ajustes.clave.slice(-2)}`,
    remitente: ajustes.remitente,
    url: ajustes.url || '(sin definir: los avisos saldrán sin botón)'
  };
}

/**
 * Manda un correo de comprobación y devuelve lo que conteste CloudMailin.
 *
 * A diferencia de los avisos, este sí espera la respuesta y deja que el error
 * suba: la gracia está en poder leerlo.
 */
async function probar(destino, { modoPrueba = false } = {}) {
  if (!cargar()) throw new Error(`No hay configuración de correo en ${RUTA}.`);
  return mandar({
    to: destino,
    subject: 'Prueba de Incidencias',
    text: 'Si lees esto, el correo de Incidencias funciona.',
    html: '<p>Si lees esto, el correo de <strong>Incidencias</strong> funciona.</p>',
    modoPrueba
  });
}

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// El enlace a la incidencia. Sin `url` configurada no hay botón: más vale un
// correo sin enlace que un enlace roto.
function enlaceDe(ticketId) {
  const base = (ajustes && ajustes.url ? String(ajustes.url) : '').replace(/\/+$/, '');
  return base ? `${base}/ticket.html?id=${ticketId}` : null;
}

const ETIQUETAS_ESTADO = {
  abierto: 'Abierta',
  pendiente: 'Pendiente',
  cerrado: 'Cerrada'
};

const AZUL = '#0d6efd';
const GRIS = '#6c757d';
const BORDE = '#dee2e6';

/**
 * La plantilla del correo, pensada para leerse en un móvil.
 *
 * Va con tablas y estilos en línea a propósito: es lo único que respetan a la
 * vez Gmail, Outlook y el correo de iPhone. Una sola columna que se adapta al
 * ancho, tipografía grande y el botón lo bastante alto para pulsarlo con el
 * dedo sin apuntar.
 */
function plantilla({ titulo, saludo, lineas, ticket, enlace, pie }) {
  const datos = [
    ['Incidencia', `#${ticket.id}`],
    ['Local', ticket.local_nombre],
    ['Departamento', ticket.grupo_nombre],
    ['Estado', ETIQUETAS_ESTADO[ticket.estado] || ticket.estado]
  ];

  const filas = datos.map(([clave, valor]) => `
    <tr>
      <td style="padding:6px 0;color:${GRIS};font-size:14px;width:130px;">${esc(clave)}</td>
      <td style="padding:6px 0;font-size:14px;font-weight:600;">${esc(valor)}</td>
    </tr>`).join('');

  const cuerpo = lineas.map((l) =>
    `<p style="margin:0 0 12px;font-size:16px;line-height:1.5;">${l}</p>`).join('');

  const boton = enlace ? `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;">
      <tr>
        <td style="background:${AZUL};border-radius:6px;">
          <a href="${esc(enlace)}"
             style="display:block;padding:14px 28px;color:#ffffff;text-decoration:none;
                    font-size:16px;font-weight:600;">Ver la incidencia</a>
        </td>
      </tr>
    </table>` : '';

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)}</title>
</head>
<body style="margin:0;padding:0;background:#f8f9fa;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fa;">
    <tr>
      <td align="center" style="padding:16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="max-width:560px;background:#ffffff;border:1px solid ${BORDE};
                      border-radius:10px;font-family:-apple-system,BlinkMacSystemFont,
                      'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#212529;">
          <tr>
            <td style="padding:22px 22px 0;">
              <div style="font-size:12px;letter-spacing:1.5px;color:${GRIS};">${esc(organizacion.nombre().toUpperCase())}</div>
              <h1 style="margin:6px 0 18px;font-size:20px;line-height:1.3;">${esc(titulo)}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:0 22px;">
              ${saludo ? `<p style="margin:0 0 12px;font-size:16px;">${esc(saludo)}</p>` : ''}
              ${cuerpo}
            </td>
          </tr>
          <tr>
            <td style="padding:8px 22px 0;">
              <div style="border-top:1px solid ${BORDE};padding-top:12px;">
                <div style="font-size:16px;font-weight:600;margin-bottom:6px;">${esc(ticket.titulo)}</div>
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%">${filas}</table>
              </div>
            </td>
          </tr>
          <tr><td style="padding:0 22px;">${boton}</td></tr>
          <tr>
            <td style="padding:16px 22px 22px;">
              <p style="margin:0;font-size:12px;color:${GRIS};line-height:1.5;">
                ${esc(pie || 'Este aviso es automático; no hace falta contestarlo.')}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// La versión en texto plano, para quien lee el correo sin formato.
function comoTexto({ titulo, saludo, lineas, ticket, enlace }) {
  const sinEtiquetas = (t) => String(t).replace(/<[^>]*>/g, '');
  return [
    titulo,
    '',
    saludo || '',
    ...lineas.map(sinEtiquetas),
    '',
    `Incidencia #${ticket.id}: ${ticket.titulo}`,
    `Local: ${ticket.local_nombre}`,
    `Departamento: ${ticket.grupo_nombre}`,
    `Estado: ${ETIQUETAS_ESTADO[ticket.estado] || ticket.estado}`,
    enlace ? `\n${enlace}` : ''
  ].filter((l) => l !== null).join('\n');
}

/** Los correos de una lista de usuarios. Quien no tenga, no recibe nada. */
function correosDe(usuarioIds, exceptoId = null) {
  const ids = [...new Set((usuarioIds || []).filter((id) => id && id !== exceptoId))];
  if (!ids.length) return [];
  return db.prepare(`
    SELECT id, nombre, email FROM usuarios
    WHERE id IN (${ids.map(() => '?').join(',')})
      AND email IS NOT NULL AND email != '' AND bloqueada = 0
  `).all(...ids);
}

/**
 * Manda el aviso. No espera a que termine: un correo que falla no puede tumbar
 * la petición que lo ha disparado, así que los errores solo se anotan.
 */
function enviar(destinatarios, aviso) {
  if (!cargar() || !destinatarios.length) return;

  const enlace = enlaceDe(aviso.ticket.id);
  for (const persona of destinatarios) {
    const contenido = { ...aviso, saludo: `Hola, ${persona.nombre}:`, enlace };
    mandar({
      to: persona.email,
      subject: aviso.asunto,
      text: comoTexto(contenido),
      html: plantilla(contenido)
    }).catch((e) => console.error(`No se pudo enviar el correo a ${persona.email}: ${e.message}`));
  }
}

/**
 * El correo para volver a entrar.
 *
 * No usa la plantilla de las incidencias porque aquí no hay ninguna: lo único
 * que lleva es el botón y cuánto dura.
 */
function enviarRestablecimiento(cuenta, vale) {
  if (!cargar() || !cuenta.email) return;

  const base = (ajustes.url ? String(ajustes.url) : '').replace(/\/+$/, '');
  const enlace = base ? `${base}/restablecer.html?vale=${encodeURIComponent(vale)}` : null;
  if (!enlace) {
    console.error('No se pudo mandar el restablecimiento: falta «url» en la configuración del correo.');
    return;
  }

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cambiar la contraseña</title>
</head>
<body style="margin:0;padding:0;background:#f8f9fa;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fa;">
    <tr><td align="center" style="padding:16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:560px;background:#ffffff;border:1px solid ${BORDE};border-radius:10px;
                    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
                    color:#212529;">
        <tr><td style="padding:22px;">
          <div style="font-size:12px;letter-spacing:1.5px;color:${GRIS};">${esc(organizacion.nombre().toUpperCase())}</div>
          <h1 style="margin:6px 0 18px;font-size:20px;">Cambiar la contraseña</h1>
          <p style="margin:0 0 12px;font-size:16px;line-height:1.5;">Hola, ${esc(cuenta.nombre)}:</p>
          <p style="margin:0 0 12px;font-size:16px;line-height:1.5;">
            Has pedido volver a entrar en Incidencias. Pulsa el botón y elige una contraseña nueva.
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;">
            <tr><td style="background:${AZUL};border-radius:6px;">
              <a href="${esc(enlace)}" style="display:block;padding:14px 28px;color:#ffffff;
                 text-decoration:none;font-size:16px;font-weight:600;">Elegir contraseña</a>
            </td></tr>
          </table>
          <p style="margin:16px 0 0;font-size:12px;color:${GRIS};line-height:1.5;">
            El enlace vale una hora y solo se puede usar una vez.
            Si no has pedido nada, no hagas caso de este correo: tu contraseña sigue como estaba.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const texto = [
    `Hola, ${cuenta.nombre}:`,
    '',
    'Has pedido volver a entrar en Incidencias. Abre este enlace para elegir una contraseña nueva:',
    enlace,
    '',
    'El enlace vale una hora y solo se puede usar una vez.',
    'Si no has pedido nada, no hagas caso de este correo.'
  ].join('\n');

  mandar({
    to: cuenta.email,
    subject: 'Cambiar la contraseña de Incidencias',
    text: texto,
    html
  }).catch((e) => console.error(`No se pudo enviar el restablecimiento: ${e.message}`));
}

module.exports = {
  enviar,
  enviarRestablecimiento,
  estado,
  probar,
  correosDe,
  plantilla,
  comoTexto,
  enlaceDe,
  cargar
};
