'use strict';

/**
 * Quién despliega esto.
 *
 * El programa no lleva dentro el nombre de ninguna empresa: sale de
 * `data/organizacion.json`, igual que las credenciales del correo o de
 * Firebase. Sin ese archivo la aplicación funciona y se presenta con nombres
 * genéricos, que es lo que hace que se pueda probar recién clonada.
 *
 * ```json
 * {
 *   "nombre": "MI EMPRESA",
 *   "url": "https://soporte.miempresa.com",
 *   "correo": "soporte@miempresa.com",
 *   "privacidad": "privacidad@miempresa.com",
 *   "local_por_defecto": "OFICINA"
 * }
 * ```
 *
 * Vive en `data/` a propósito, fuera del control de versiones: así una
 * actualización del programa no pisa el nombre de nadie, y quien copie la
 * carpeta `data/` para la copia de seguridad se lleva también su
 * personalización.
 */

const fs = require('fs');
const path = require('path');

const RUTA = process.env.ORGANIZACION_CONFIG
  || path.join(__dirname, 'data', 'organizacion.json');

// Con qué se presenta una instalación que no ha dicho quién es. El nombre sale
// en la barra de la web, en el asunto de los correos y en la app.
const POR_DEFECTO = {
  nombre: 'Soporte',
  url: '',
  correo: '',
  privacidad: '',
  local_por_defecto: 'OFICINA'
};

let cargada = null;

function cargar() {
  if (cargada) return cargada;
  try {
    const json = JSON.parse(fs.readFileSync(RUTA, 'utf8'));
    cargada = {
      nombre: texto(json.nombre) || POR_DEFECTO.nombre,
      url: sinBarra(texto(json.url)),
      correo: texto(json.correo),
      privacidad: texto(json.privacidad) || texto(json.correo),
      local_por_defecto: texto(json.local_por_defecto) || POR_DEFECTO.local_por_defecto
    };
  } catch (e) {
    cargada = { ...POR_DEFECTO };
  }
  return cargada;
}

function texto(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function sinBarra(url) {
  let limpia = url;
  while (limpia.endsWith('/')) limpia = limpia.slice(0, -1);
  return limpia;
}

/** El nombre con el que se presenta la instalación. */
function nombre() {
  return cargar().nombre;
}

/**
 * La dirección pública, para los enlaces de los correos.
 *
 * Puede venir de aquí o de `data/correo.json`, que ya la tenía: la de correo
 * manda, para no romper las instalaciones que la pusieran allí.
 */
function url() {
  return cargar().url;
}

/** A quién se escribe para ejercer los derechos de protección de datos. */
function correoPrivacidad() {
  return cargar().privacidad;
}

/** El remitente por defecto de los avisos. */
function remitente() {
  const { nombre: quien, correo } = cargar();
  if (!correo) return '';
  return `${quien} <${correo}>`;
}

/** El local con el que nace una cuenta a la que nadie le marca ninguno. */
function localPorDefecto() {
  return cargar().local_por_defecto;
}

/** Lo que necesita saber la interfaz. Va sin sesión: la pantalla de acceso también lo pinta. */
function paraLaWeb() {
  const { nombre: quien, privacidad } = cargar();
  return { nombre: quien, privacidad };
}

/** Para las pruebas, que cambian el archivo entre casos. */
function olvidar() {
  cargada = null;
}

module.exports = {
  nombre,
  url,
  correoPrivacidad,
  remitente,
  localPorDefecto,
  paraLaWeb,
  olvidar,
  RUTA
};
