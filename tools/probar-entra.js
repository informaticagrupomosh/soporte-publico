'use strict';

/**
 * Comprueba que la entrada con Office 365 está bien montada, y si no, dice por
 * dónde falla.
 *
 * Los tropiezos de la ida y la vuelta acaban en el registro del servidor y en
 * un mensaje escueto en la pantalla de acceso, así que es fácil no verlos.
 * Esto hace las mismas llamadas de cara: enseña la configuración cargada, la
 * dirección de vuelta que hay que registrar en Azure y lo que contesta
 * Microsoft.
 *
 *   node tools/probar-entra.js
 */

const entra = require('../entra');

function linea(clave, valor) {
  console.log(`  ${clave.padEnd(14)} ${valor}`);
}

async function principal() {
  console.log('\nAcceso con Office 365\n');
  const estado = entra.estado();

  if (!estado.activo) {
    linea('archivo', estado.ruta);
    console.log(`
  No se ha podido leer. Sin él la aplicación funciona igual, solo que la
  pantalla de acceso no enseña el botón. Crea ese archivo con:

  {
    "tenant": "EL-ID-DEL-TENANT",
    "cliente": "EL-ID-DE-LA-APLICACION",
    "secreto": "EL-VALOR-DEL-SECRETO",
    "url": "https://LA-DIRECCION-PUBLICA"
  }

  Los tres primeros salen del registro de la aplicación en Azure, en Microsoft
  Entra ID › Registros de aplicaciones. Del secreto se copia el «Valor», no el
  «Id.»: el valor solo se enseña una vez, al crearlo.
`);
    process.exitCode = 1;
    return;
  }

  linea('archivo', estado.ruta);
  linea('tenant', estado.tenant);
  linea('aplicación', estado.cliente);
  linea('secreto', estado.secreto);
  linea('autoridad', estado.autoridad);
  linea('url pública', estado.url);
  linea('vuelta', estado.vuelta);
  console.log('\n  Esa «vuelta» es la que tiene que estar registrada en Azure, en\n'
    + '  Autenticación › URI de redirección, como aplicación web y letra a letra.');

  console.log('\nHablando con Microsoft…\n');
  try {
    const res = await entra.probar();
    linea('emisor', res.emisor);
    linea('autorización', res.autorizacion);
    linea('canje', res.canje);
    linea('claves', `${res.claves} de firma`);
    linea('secreto', res.secretoValido
      ? 'lo reconoce'
      : `NO lo reconoce — ${res.detalle}`);
    if (!res.secretoValido) {
      console.log(`
  El secreto no vale. Lo normal es que haya caducado: en Azure duran como mucho
  dos años. Crea otro en Certificados y secretos y copia su «Valor».
`);
      process.exitCode = 1;
      return;
    }
    console.log(`
  Todo lo que se puede comprobar sin mandar a nadie a identificarse está bien.
  Lo que queda es entrar de verdad desde /login.html.
`);
  } catch (e) {
    console.log(`  ${e.message}\n`);
    console.log(`  Lo que suele fallar:

  No se pudo conectar   El servidor no llega a login.microsoftonline.com. Suele
                        ser un cortafuegos o una política de salida del
                        alojamiento; pruébalo con:
                          curl -sS -o /dev/null -w '%{http_code}\\n' \\
                            ${estado.autoridad}/${estado.tenant}/v2.0/.well-known/openid-configuration

  400 al pedir la       El «tenant» no existe. Es el «Id. de directorio
  configuración         (inquilino)» de la página del registro, o el dominio
                        del grupo (algo.onmicrosoft.com).

  AADSTS700016          El «cliente» no es de ese tenant: la aplicación está
                        registrada en otro directorio.
`);
    process.exitCode = 1;
  }
}

principal();
