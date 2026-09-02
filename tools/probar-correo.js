'use strict';

/**
 * Comprueba que el correo sale de verdad, y si no, dice por qué.
 *
 * Los avisos se mandan sin esperar respuesta —un correo que falla no puede
 * tumbar la petición que lo dispara—, así que sus errores acaban en el registro
 * del servidor y es fácil no verlos. Esto hace lo mismo pero de cara: enseña la
 * configuración que ha cargado y lo que contesta CloudMailin, tal cual.
 *
 *   node tools/probar-correo.js                    solo la configuración
 *   node tools/probar-correo.js yo@ejemplo.com   manda un correo de prueba
 *   node tools/probar-correo.js yo@… --sin-enviar  valida sin enviar nada
 */

const correo = require('../correo');

const destino = process.argv.slice(2).find((a) => !a.startsWith('--'));
const modoPrueba = process.argv.includes('--sin-enviar');

function linea(clave, valor) {
  console.log(`  ${clave.padEnd(12)} ${valor}`);
}

async function principal() {
  console.log('\nConfiguración del correo\n');
  const estado = correo.estado();

  if (!estado.activo) {
    linea('archivo', estado.ruta);
    console.log(`
  No se ha podido leer. Sin él la aplicación funciona, pero no manda ningún
  correo. Crea ese archivo con:

  {
    "usuario": "EL-USUARIO-SMTP-DE-CLOUDMAILIN",
    "clave": "EL-API-TOKEN",
    "remitente": "Soporte <soporte@ejemplo.com>",
    "url": "https://LA-DIRECCION-PUBLICA"
  }
`);
    process.exitCode = 1;
    return;
  }

  linea('archivo', estado.ruta);
  linea('usuario', estado.usuario);
  linea('clave', estado.clave);
  linea('remitente', estado.remitente);
  linea('url', estado.url);

  if (!destino) {
    console.log(`
  Para mandar un correo de prueba:
    node tools/probar-correo.js tu-correo@ejemplo.com
`);
    return;
  }

  console.log(`\n${modoPrueba ? 'Validando' : 'Enviando'} a ${destino}…\n`);
  try {
    const res = await correo.probar(destino, { modoPrueba });
    console.log(`  CloudMailin respondió ${res.estado}.`);
    console.log(modoPrueba
      ? '  El mensaje y las credenciales son correctos; no se ha enviado nada.'
      : '  Enviado. Si no llega en unos minutos, mira la carpeta de correo no deseado\n'
        + '  y el registro de la cuenta en CloudMailin.');
    if (res.detalle) console.log(`\n  Respuesta: ${res.detalle.slice(0, 300)}`);
  } catch (e) {
    console.log(`  ${e.message}\n`);
    console.log(`  Lo que suele fallar:

  No se pudo conectar   El servidor no llega a api.cloudmailin.com. Suele ser un
                        cortafuegos o una política de salida del alojamiento;
                        pruébalo con:
                          curl -sS -o /dev/null -w '%{http_code}\\n' \\
                            https://api.cloudmailin.com/api/v0.1/${estado.usuario}/messages

  401 o 403             El usuario o el API token no son los de la cuenta. Están
                        en CloudMailin, en SMTP Accounts; el token es la
                        contraseña SMTP. Ojo: un 403 que hable de «allowlist» o
                        de «egress» no es de CloudMailin, es de tu red.

  422                   El remitente no está verificado en CloudMailin. Tiene
                        que estarlo el dominio de «${estado.remitente}».

  404 a este POST       El usuario del que cuelga la ruta no existe: revisa
                        «usuario». Ojo: un GET a esa misma URL —con el navegador
                        o con «curl» a secas— devuelve 404 aunque esté todo
                        bien, porque el endpoint solo acepta POST. Que conteste
                        cualquier cosa ya demuestra que hay salida a internet.
`);
    process.exitCode = 1;
  }
}

principal();
