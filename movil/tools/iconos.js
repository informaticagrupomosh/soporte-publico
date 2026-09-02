'use strict';

/**
 * Genera los iconos del lanzador de las dos plataformas.
 *
 * En Android, los PNG para los anteriores al 8, que no entienden los iconos
 * adaptativos en XML; del 8 en adelante manda `mipmap-anydpi-v26/ic_launcher.xml`,
 * que no necesita ningún mapa de bits.
 *
 * En iOS, el juego entero de `AppIcon.appiconset`, con dos reglas que no son
 * las de Android: **sin canal alfa**, porque App Store Connect rechaza la
 * subida con un error que no dice cuál de los iconos era, y **sin esquinas
 * redondeadas**, porque las recorta el sistema y redondearlas otra vez deja un
 * borde raro.
 *
 * Sin dependencias, como el resto del proyecto: el PNG se arma a mano y se
 * comprime con el `zlib` de Node. Se ejecuta con `node tools/iconos.js` y sirve
 * para rehacer los iconos si cambia el color o la marca.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Mismo azul que `fondo_icono` en colors.xml.
const FONDO = [13, 110, 253];
const TINTA = [255, 255, 255];

// Densidades de Android y el lado en píxeles que le toca al icono en cada una.
const DENSIDADES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };

const crcTabla = (() => {
  const tabla = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabla[n] = c;
  }
  return tabla;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = crcTabla[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function trozo(tipo, datos) {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
}

/**
 * PNG de color verdadero, 8 bits por canal y sin entrelazar. Los píxeles llegan
 * siempre en RGBA; con `alfa: false` se escribe sin ese canal, que es lo que
 * pide Apple.
 */
function png(ancho, alto, pixeles, { alfa = true } = {}) {
  const canales = alfa ? 4 : 3;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8;             // bits por canal
  ihdr[9] = alfa ? 6 : 2;  // RGBA o RGB
  // Cada fila va precedida del byte de filtro, que aquí es siempre «ninguno».
  const crudo = Buffer.alloc(alto * (1 + ancho * canales));
  for (let y = 0; y < alto; y += 1) {
    const fila = y * (1 + ancho * canales);
    crudo[fila] = 0;
    for (let x = 0; x < ancho; x += 1) {
      const origen = (y * ancho + x) * 4;
      const destino = fila + 1 + x * canales;
      crudo[destino] = pixeles[origen];
      crudo[destino + 1] = pixeles[origen + 1];
      crudo[destino + 2] = pixeles[origen + 2];
      if (alfa) crudo[destino + 3] = pixeles[origen + 3];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo('IHDR', ihdr),
    trozo('IDAT', zlib.deflateSync(crudo, { level: 9 })),
    trozo('IEND', Buffer.alloc(0))
  ]);
}

// ---------- La marca ----------

// El triángulo de aviso, en el lienzo de 24×24 de los iconos de Material, que es
// el mismo dibujo que ic_notificacion.xml.
const APICE = [12, 2];
const IZQUIERDA = [1, 21];
const DERECHA = [23, 21];

function signo([px, py], [ax, ay], [bx, by]) {
  return (px - bx) * (ay - by) - (ax - bx) * (py - by);
}

function enTriangulo(p) {
  const a = signo(p, APICE, IZQUIERDA);
  const b = signo(p, IZQUIERDA, DERECHA);
  const c = signo(p, DERECHA, APICE);
  const negativo = a < 0 || b < 0 || c < 0;
  const positivo = a > 0 || b > 0 || c > 0;
  return !(negativo && positivo);
}

// El palo y el punto de la admiración, que se recortan del triángulo.
function enAdmiracion([x, y]) {
  const centrado = x >= 10.9 && x <= 13.1;
  return centrado && ((y >= 9.5 && y <= 14.5) || (y >= 15.8 && y <= 18.2));
}

// Esquinas redondeadas del icono, en proporción del lado.
function enFondo(x, y, lado) {
  const r = lado * 0.22;
  const dx = Math.min(x, lado - x);
  const dy = Math.min(y, lado - y);
  if (dx >= r || dy >= r) return true;
  return (r - dx) ** 2 + (r - dy) ** 2 <= r * r;
}

/** Cuánto de este píxel cae dentro de la forma, muestreando 4×4 para suavizar. */
function cobertura(x, y, lado, dentro) {
  const MUESTRAS = 4;
  let suma = 0;
  for (let sy = 0; sy < MUESTRAS; sy += 1) {
    for (let sx = 0; sx < MUESTRAS; sx += 1) {
      const px = x + (sx + 0.5) / MUESTRAS;
      const py = y + (sy + 0.5) / MUESTRAS;
      if (dentro(px, py)) suma += 1;
    }
  }
  return suma / (MUESTRAS * MUESTRAS);
}

/**
 * El icono en su lado en píxeles.
 *
 * `redondeado` recorta la silueta con esquinas curvas y deja el resto
 * transparente, que es lo de Android. Sin él, el cuadrado se pinta entero y
 * opaco: iOS pone la máscara por su cuenta.
 */
function icono(lado, { redondeado = true } = {}) {
  const pixeles = Buffer.alloc(lado * lado * 4);
  // El dibujo de 24 unidades se centra ocupando el 60 % del icono, que es la
  // proporción que usan los iconos del sistema.
  const escala = (lado * 0.6) / 24;
  const margen = (lado - 24 * escala) / 2;
  const aMarca = (v, desplazamiento) => (v - desplazamiento) / escala;

  for (let y = 0; y < lado; y += 1) {
    for (let x = 0; x < lado; x += 1) {
      const fondo = redondeado ? cobertura(x, y, lado, (px, py) => enFondo(px, py, lado)) : 1;
      const marca = cobertura(x, y, lado, (px, py) => {
        const p = [aMarca(px, margen), aMarca(py, margen)];
        return enTriangulo(p) && !enAdmiracion(p);
      });

      const i = (y * lado + x) * 4;
      // La marca blanca se funde sobre el azul, y el conjunto se recorta con la
      // silueta redondeada.
      for (let canal = 0; canal < 3; canal += 1) {
        pixeles[i + canal] = Math.round(FONDO[canal] * (1 - marca) + TINTA[canal] * marca);
      }
      pixeles[i + 3] = Math.round(255 * fondo);
    }
  }
  return png(lado, lado, pixeles, { alfa: redondeado });
}

// ---------- Android ----------

const res = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');
for (const [densidad, lado] of Object.entries(DENSIDADES)) {
  const carpeta = path.join(res, `mipmap-${densidad}`);
  fs.mkdirSync(carpeta, { recursive: true });
  const archivo = path.join(carpeta, 'ic_launcher.png');
  fs.writeFileSync(archivo, icono(lado));
  console.log(`mipmap-${densidad}/ic_launcher.png  ${lado}×${lado}`);
}

// ---------- iOS ----------

// Los mismos nombres y tamaños que trae el proyecto que genera Flutter, para
// que estos sustituyan a los suyos sin tocar nada más. El de 1024 es el de la
// ficha de App Store.
const IOS = [
  ['20x20', 1, 20], ['20x20', 2, 40], ['20x20', 3, 60],
  ['29x29', 1, 29], ['29x29', 2, 58], ['29x29', 3, 87],
  ['40x40', 1, 40], ['40x40', 2, 80], ['40x40', 3, 120],
  ['60x60', 2, 120], ['60x60', 3, 180],
  ['76x76', 1, 76], ['76x76', 2, 152],
  ['83.5x83.5', 2, 167],
  ['1024x1024', 1, 1024]
];

// Qué tamaños son de iPhone, de iPad y de la tienda, que es lo que Xcode lee de
// «Contents.json» para colocar cada archivo en su hueco.
function destinos(medida, escala) {
  if (medida === '1024x1024') return ['ios-marketing'];
  if (medida === '76x76' || medida === '83.5x83.5') return ['ipad'];
  if (medida === '60x60') return ['iphone'];
  // Los pequeños los usan las dos, con una entrada para cada una.
  return escala === 3 ? ['iphone'] : ['iphone', 'ipad'];
}

const appicon = path.join(
  __dirname, '..', 'ios', 'Runner', 'Assets.xcassets', 'AppIcon.appiconset'
);

if (!fs.existsSync(path.join(__dirname, '..', 'ios'))) {
  console.log('\nSin carpeta ios/: los iconos de iPhone se harán cuando la haya.');
} else {
  fs.mkdirSync(appicon, { recursive: true });
  const imagenes = [];
  for (const [medida, escala, lado] of IOS) {
    const nombre = `Icon-App-${medida}@${escala}x.png`;
    fs.writeFileSync(path.join(appicon, nombre), icono(lado, { redondeado: false }));
    for (const idiom of destinos(medida, escala)) {
      imagenes.push({ size: medida, idiom, filename: nombre, scale: `${escala}x` });
    }
    console.log(`ios/${nombre}  ${lado}×${lado}`);
  }
  fs.writeFileSync(
    path.join(appicon, 'Contents.json'),
    `${JSON.stringify({ images: imagenes, info: { version: 1, author: 'xcode' } }, null, 2)}\n`
  );
  console.log('ios/Contents.json');
}
