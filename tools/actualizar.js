'use strict';

/**
 * Baja al repositorio de una instalación los cambios del tronco.
 *
 *   npm run actualizar
 *
 * Existe porque hacerlo a mano son cuatro órdenes y una de ellas se equivoca
 * sola: `git pull` a secas va a `origin` —el repositorio de la instalación— y
 * no al tronco, así que quien lo ejecute y luego fusione `publico/main` estará
 * fusionando la copia de la última vez que trajo algo. No falla; simplemente no
 * baja nada, y parece que no había cambios.
 *
 * No empuja nada. Fusionar y publicar son dos decisiones distintas, y la
 * segunda se toma después de ver pasar las pruebas.
 *
 *   node tools/actualizar.js --remoto=otro    si el remoto no se llama «publico»
 *   node tools/actualizar.js --sin-pruebas    para mirar el resultado antes
 */

const { spawnSync } = require('child_process');

const REMOTO_POR_DEFECTO = 'publico';
const RAMA = 'main';

const argumento = (nombre) => {
  const hallado = process.argv.slice(2).find((a) => a.startsWith(`--${nombre}=`));
  return hallado ? hallado.slice(nombre.length + 3).trim() : '';
};
const bandera = (nombre) => process.argv.slice(2).includes(`--${nombre}`);

const remoto = argumento('remoto') || REMOTO_POR_DEFECTO;

/** Ejecuta y devuelve la salida, sin enseñarla. Para preguntarle cosas a git. */
function preguntar(...args) {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** Ejecuta enseñando lo que pasa, y devuelve si salió bien. */
function correr(orden, args) {
  console.log(`\n$ ${orden} ${args.join(' ')}`);
  return spawnSync(orden, args, { stdio: 'inherit', shell: process.platform === 'win32' }).status === 0;
}

function parar(mensaje) {
  console.error(`\n${mensaje}\n`);
  process.exit(1);
}

// ---------- Antes de tocar nada ----------

if (preguntar('rev-parse', '--is-inside-work-tree') !== 'true') {
  parar('Esto hay que ejecutarlo dentro del repositorio.');
}

// Fusionar encima de cambios sin guardar es como se pierde el trabajo de una
// tarde. Mejor negarse que arreglarlo después.
if (preguntar('status', '--porcelain')) {
  parar(
    'Hay cambios sin confirmar. Guárdalos antes:\n'
    + '    git commit -am "…"      o bien      git stash'
  );
}

const remotos = (preguntar('remote') || '').split('\n');
if (!remotos.includes(remoto)) {
  parar(
    `No hay ningún remoto llamado «${remoto}».\n\n`
    + 'Si este es el repositorio público, no hay de dónde bajar: es el tronco.\n'
    + 'Si es el de una instalación, se da de alta una vez:\n\n'
    + `    git remote add ${remoto} https://github.com/informaticagrupomosh/soporte-publico.git`
  );
}

const rama = preguntar('rev-parse', '--abbrev-ref', 'HEAD');
if (rama !== RAMA) {
  parar(`Estás en la rama «${rama}». Esto se hace desde «${RAMA}».`);
}

// ---------- Ponerse al día ----------

// Primero lo propio: si alguien ha subido algo a esta instalación, mejor
// enterarse ahora que al final, con el «push» rechazado y una fusión ya hecha.
console.log('\n=== Lo de esta instalación ===');
if (!correr('git', ['pull', '--ff-only', 'origin', RAMA])) {
  parar(
    'No se ha podido adelantar sin más. Hay algo en origin que no está aquí,\n'
    + 'o al revés. Míralo con «git status» y resuélvelo antes de bajar del tronco.'
  );
}

console.log('\n=== El tronco ===');
const antes = preguntar('rev-parse', 'HEAD');
if (!correr('git', ['pull', '--no-rebase', remoto, RAMA])) {
  const chocan = preguntar('diff', '--name-only', '--diff-filter=U');
  if (chocan) {
    parar(
      `Hay conflictos en:\n\n${chocan.split('\n').map((f) => `    ${f}`).join('\n')}\n\n`
      + 'Arréglalos, «git add» de cada uno y «git commit». El criterio de qué\n'
      + 'versión conservar está en INSTALACION.md. Para dejarlo como estaba:\n'
      + '    git merge --abort'
    );
  }
  parar('La fusión no ha salido bien. Mira lo de arriba.');
}

if (preguntar('rev-parse', 'HEAD') === antes) {
  console.log('\nNo había nada nuevo en el tronco.\n');
  process.exit(0);
}

// ---------- Comprobar ----------

if (bandera('sin-pruebas')) {
  console.log('\nBajado. Las pruebas te las saltas tú; acuérdate de pasarlas.\n');
  process.exit(0);
}

console.log('\n=== Las pruebas ===');
if (!correr('npm', ['test'])) {
  parar(
    'Las pruebas no pasan con lo que acaba de bajar. NO lo subas.\n'
    + 'Para volver atrás:  git reset --hard ORIG_HEAD'
  );
}

console.log(`
=== Listo ===

Bajado y con las pruebas en verde. Falta subirlo:

    git push
`);
