'use strict';

/**
 * Gráficos del resumen, en SVG y sin librerías.
 *
 * Paleta pastel de seis tonos, comprobada para que los colores se distingan
 * entre sí también con daltonismo: luminosidad dentro de banda, croma
 * suficiente para que cada tono no lea como gris y separación mínima entre
 * tonos contiguos. El orden es fijo — el sector mayor toma siempre el primer
 * tono — y nunca se repite ni se generan tonos nuevos.
 *
 * Al ser colores claros, su contraste sobre el panel blanco queda por debajo de
 * 3:1, así que el dato nunca depende solo del color: la leyenda lleva valor y
 * porcentaje, las barras tienen eje y etiqueta, y la tabla de arriba mantiene
 * el desglose completo.
 */
const PALETA = ['#83b4f3', '#86c387', '#c69ee3', '#d4aa60', '#4fc6c6', '#ec9695'];
const TINTA_BARRA = PALETA[0];
// Un periodo puede quedar en negativo si se registran devoluciones o abonos.
const TINTA_NEGATIVA = PALETA[5];
const REJILLA = '#dee2e6';
const TEXTO_TENUE = '#6c757d';
const SUPERFICIE = '#ffffff';

// Un circular solo se lee de un vistazo con pocos sectores, y la paleta tiene
// seis tonos: cinco categorías más «Otras».
const MAX_SECTORES = 5;

const fmtCorto = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });
const fmtPorcentaje = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });

function svgEl(nombre, atributos) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', nombre);
  for (const [k, v] of Object.entries(atributos || {})) el.setAttribute(k, v);
  return el;
}

function vacio(contenedor, mensaje) {
  contenedor.innerHTML = `<div class="chart-empty">${mensaje}</div>`;
}

// Redondea el tope del eje a una cifra legible (1, 2, 2.5 o 5 × 10^n).
function topeBonito(max) {
  if (max <= 0) return 1;
  const magnitud = Math.pow(10, Math.floor(Math.log10(max)));
  const escala = max / magnitud;
  const paso = escala <= 1 ? 1 : escala <= 2 ? 2 : escala <= 2.5 ? 2.5 : escala <= 5 ? 5 : 10;
  return paso * magnitud;
}

// ---------- Tooltip compartido ----------

function tooltip() {
  return document.getElementById('tooltip-grafico');
}

function conTooltip(elemento, html) {
  elemento.addEventListener('mouseenter', (e) => {
    const t = tooltip();
    if (!t) return;
    t.innerHTML = html;
    t.classList.remove('d-none');
    mover(e);
  });
  elemento.addEventListener('mousemove', mover);
  elemento.addEventListener('mouseleave', () => {
    const t = tooltip();
    if (t) t.classList.add('d-none');
  });
  function mover(e) {
    const t = tooltip();
    if (!t) return;
    t.style.left = `${e.clientX}px`;
    t.style.top = `${e.clientY - 10}px`;
  }
}

// ---------- Barras: un valor por periodo ----------

function graficoBarras(contenedor, columnas, valores, {
  etiquetaTotal = 'Total',
  unidad = '',
  sinDatos = 'Sin datos para estos filtros.',
  ariaLabel = 'Valor por periodo'
} = {}) {
  const sufijo = unidad ? ` ${unidad}` : '';
  contenedor.innerHTML = '';
  const total = valores.reduce((a, b) => a + b, 0);
  // El total puede dar cero con datos (un mes en positivo y otro en negativo),
  // así que lo que decide si hay algo que pintar son los valores.
  if (!valores.some((v) => v !== 0)) {
    vacio(contenedor, sinDatos);
    return;
  }

  const ANCHO = 700, ALTO = 240;

  // El SVG se estira hasta el ancho del panel, así que en un móvil el dibujo se
  // reduce a menos de la mitad y las etiquetas quedarían ilegibles. La letra
  // (y los márgenes que dependen de ella) crecen dentro del viewBox lo mismo
  // que se ha encogido el gráfico, de modo que en pantalla siempre mide igual.
  const anchoPanel = contenedor.clientWidth || ANCHO;
  const escala = Math.min(2.2, Math.max(1, ANCHO / anchoPanel));
  const fuente = Math.round(10 * escala);

  const margen = { arriba: 8 + fuente, derecha: 8, abajo: 20 + fuente, izquierda: 14 + fuente * 4.8 };
  const anchoUtil = ANCHO - margen.izquierda - margen.derecha;
  const altoUtil = ALTO - margen.arriba - margen.abajo;

  // Con devoluciones el eje tiene que bajar del cero para que la barra negativa
  // se vea; sin ellas, el gráfico queda exactamente igual que antes.
  const maximo = Math.max(...valores);
  const minimo = Math.min(...valores);
  const tope = maximo > 0 ? topeBonito(maximo) : 0;
  const suelo = minimo < 0 ? -topeBonito(-minimo) : 0;
  const rango = (tope - suelo) || 1;
  const y = (v) => margen.arriba + altoUtil - ((v - suelo) / rango) * altoUtil;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${ANCHO} ${ALTO}`, style: 'width:100%;height:auto;display:block',
    role: 'img', 'aria-label': ariaLabel
  });

  // Rejilla y eje: finos, sólidos y discretos.
  for (let i = 0; i <= 4; i++) {
    const v = suelo + (rango / 4) * i;
    const yy = y(v);
    svg.appendChild(svgEl('line', {
      x1: margen.izquierda, x2: ANCHO - margen.derecha, y1: yy, y2: yy,
      stroke: REJILLA, 'stroke-width': 1
    }));
    const etiqueta = svgEl('text', {
      x: margen.izquierda - 8, y: yy + fuente * 0.35, 'text-anchor': 'end',
      'font-size': fuente, fill: TEXTO_TENUE
    });
    etiqueta.textContent = fmtCorto.format(v);
    svg.appendChild(etiqueta);
  }

  const banda = anchoUtil / columnas.length;
  const ancho = Math.min(24, Math.max(6, banda - 8));

  // Con la letra agrandada las etiquetas del eje se tocarían: cuando no caben
  // todas se rotula un periodo de cada dos (o de cada tres).
  const etiquetas = columnas.map((c) => c.etiqueta.replace('Sem. ', 'S'));
  const anchoEtiqueta = Math.max(...etiquetas.map((e) => e.length)) * fuente * 0.62 + 8;
  const salto = Math.max(1, Math.ceil(anchoEtiqueta / banda));

  columnas.forEach((col, i) => {
    const centro = margen.izquierda + banda * i + banda / 2;
    const v = valores[i];
    const base = y(0);

    if (v !== 0) {
      const arriba = v > 0;
      const altura = Math.max(Math.abs(base - y(v)), 2);
      // Extremo libre redondeado 4px y el que apoya en el cero, recto.
      const r = Math.min(4, ancho / 2, altura);
      const x0 = centro - ancho / 2;
      const x1 = x0 + ancho;
      const y0 = arriba ? base - altura : base + altura;
      const curva = arriba ? r : -r;
      const barra = svgEl('path', {
        d: `M${x0},${base} L${x0},${y0 + curva} Q${x0},${y0} ${x0 + r},${y0}`
          + ` L${x1 - r},${y0} Q${x1},${y0} ${x1},${y0 + curva}`
          + ` L${x1},${base} Z`,
        fill: arriba ? TINTA_BARRA : TINTA_NEGATIVA
      });
      const titulo = svgEl('title');
      titulo.textContent = `${col.etiqueta}: ${fmtCorto.format(v)}${sufijo}`;
      barra.appendChild(titulo);
      conTooltip(barra, `<strong>${col.etiqueta}${col.detalle ? ` (${col.detalle})` : ''}</strong><br>${fmtCorto.format(v)}${sufijo}`);
      svg.appendChild(barra);

      // Etiqueta directa solo en los extremos: el resto lo cuenta el eje. La de
      // una barra negativa va sobre el cero, no bajo la barra, donde chocaría
      // con el nombre del periodo.
      if (v === maximo || (minimo < 0 && v === minimo)) {
        const texto = fmtCorto.format(v);
        // La etiqueta de la última barra se saldría del dibujo: se recoge hacia
        // dentro lo justo para que quepa entera.
        const medio = (texto.length * fuente * 0.58) / 2;
        const x = Math.min(Math.max(centro, margen.izquierda + medio), ANCHO - margen.derecha - medio);
        const valor = svgEl('text', {
          x, y: arriba ? y0 - 6 : base - 5, 'text-anchor': 'middle', 'font-size': fuente,
          'font-weight': 600, fill: '#212529'
        });
        valor.textContent = texto;
        svg.appendChild(valor);
      }
    }

    if (i % salto === 0) {
      const etiqueta = svgEl('text', {
        x: centro, y: ALTO - 4 - fuente * 0.6, 'text-anchor': 'middle', 'font-size': fuente, fill: TEXTO_TENUE
      });
      etiqueta.textContent = etiquetas[i];
      svg.appendChild(etiqueta);
    }
  });

  // Línea base: el cero, que con devoluciones no coincide con el pie del eje.
  svg.appendChild(svgEl('line', {
    x1: margen.izquierda, x2: ANCHO - margen.derecha,
    y1: y(0), y2: y(0),
    stroke: '#ced4da', 'stroke-width': 1
  }));

  contenedor.appendChild(svg);

  const pie = document.createElement('div');
  pie.className = 'text-muted small mt-1';
  pie.textContent = `${etiquetaTotal}: ${fmtCorto.format(total)}${sufijo}`;
  contenedor.appendChild(pie);
}

// ---------- Circular: composición ----------

function sectorPath(cx, cy, r, desde, hasta) {
  const p = (ang) => [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
  const [x1, y1] = p(desde);
  const [x2, y2] = p(hasta);
  const grande = hasta - desde > Math.PI ? 1 : 0;
  return `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${grande} 1 ${x2},${y2} Z`;
}

function graficoCircular(contenedorSvg, contenedorLeyenda, categorias, {
  unidad = '',
  sinDatos = 'Sin datos para estos filtros.',
  ariaLabel = 'Reparto por categoría',
  otras = 'Otras'
} = {}) {
  const sufijo = unidad ? ` ${unidad}` : '';
  contenedorSvg.innerHTML = '';
  contenedorLeyenda.innerHTML = '';

  const conDatos = categorias.filter((c) => c.total > 0).sort((a, b) => b.total - a.total);
  const total = conDatos.reduce((a, c) => a + c.total, 0);
  if (!total) {
    vacio(contenedorSvg, sinDatos);
    return;
  }

  // Las categorías que no caben en la paleta se agrupan en un único sector.
  let sectores = conDatos.map((c) => ({ nombre: c.nombre, valor: c.total }));
  if (sectores.length > MAX_SECTORES + 1) {
    const resto = sectores.slice(MAX_SECTORES);
    sectores = sectores.slice(0, MAX_SECTORES);
    sectores.push({ nombre: otras, valor: resto.reduce((a, s) => a + s.valor, 0) });
  }

  // Orden fijo de la paleta: el sector mayor toma siempre el primer tono.
  const tonos = sectores.map((_, i) => PALETA[i]);

  // Sin ancho fijo: el SVG se estira hasta donde le deje su contenedor. El
  // radio deja 2 puntos de margen, que es lo que se sale el borde blanco de
  // los sectores.
  const TAM = 168, r = 82, c = TAM / 2;
  const svg = svgEl('svg', {
    viewBox: `0 0 ${TAM} ${TAM}`,
    role: 'img', 'aria-label': ariaLabel
  });

  let angulo = -Math.PI / 2;
  sectores.forEach((s, i) => {
    const porcion = s.valor / total;
    const fin = angulo + porcion * Math.PI * 2;
    const color = tonos[i];
    // Un único sector no puede dibujarse como arco: se pinta el círculo entero.
    const forma = sectores.length === 1
      ? svgEl('circle', { cx: c, cy: c, r, fill: color })
      : svgEl('path', { d: sectorPath(c, c, r, angulo, fin), fill: color, stroke: SUPERFICIE, 'stroke-width': 2 });
    const titulo = svgEl('title');
    const texto = `${s.nombre}: ${fmtCorto.format(s.valor)}${sufijo} (${fmtPorcentaje.format(porcion * 100)} %)`;
    titulo.textContent = texto;
    forma.appendChild(titulo);
    conTooltip(forma, `<strong>${s.nombre}</strong><br>${fmtCorto.format(s.valor)}${sufijo} · ${fmtPorcentaje.format(porcion * 100)} %`);
    svg.appendChild(forma);
    angulo = fin;
  });

  contenedorSvg.appendChild(svg);

  // La leyenda es el canal de identidad: nombre, valor y porcentaje.
  const tabla = document.createElement('table');
  tabla.className = 'chart-legend';
  tabla.innerHTML = sectores.map((s, i) => `
    <tr>
      <td><span class="swatch" style="background:${tonos[i]}"></span>${esc(s.nombre)}</td>
      <td class="valor">${fmtCorto.format(s.valor)}${sufijo}</td>
      <td class="porcentaje">${fmtPorcentaje.format((s.valor / total) * 100)} %</td>
    </tr>`).join('');
  contenedorLeyenda.appendChild(tabla);
}
