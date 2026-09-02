'use strict';

/**
 * Cuándo se repite una tarea programada.
 *
 * El plan se guarda por partes —frecuencia, hora, fecha de inicio y los días
 * que correspondan— en lugar de en una expresión cron, para que el formulario
 * se parezca al programador de tareas de Windows y lo pueda rellenar cualquiera:
 *
 *   { frecuencia, hora: 'HH:MM', desde: 'AAAA-MM-DD', cada, diasSemana, diasMes, meses }
 *
 * - `una_vez`  → salta el día `desde` a la hora `hora`, y no vuelve.
 * - `diaria`   → cada `cada` días contados desde `desde`.
 * - `semanal`  → los días de `diasSemana`, cada `cada` semanas desde `desde`.
 * - `mensual`  → los días de `diasMes`, en los meses de `meses` (vacío = todos).
 *
 * **La hora se interpreta siempre en la zona de la aplicación**, no en la del
 * proceso. Un servidor recién instalado suele ir en UTC, así que una tarea
 * puesta a las 9:00 saltaría a las 11:00 de aquí en verano —o no saltaría ese
 * día, si esa hora ya había pasado—, y desde fuera eso se ve como que el
 * programador no funciona. Fijándola aquí, «las 9:00» son las 9:00 de España
 * esté el servidor como esté. Se puede cambiar con la variable de entorno
 * `ZONA_HORARIA`.
 */

const ZONA = process.env.ZONA_HORARIA || 'Europe/Madrid';

const FRECUENCIAS = ['una_vez', 'diaria', 'semanal', 'mensual'];
const MAX_CADA = 365;
const DIA = 86400000;

// ---------- El reloj de pared de la zona ----------

const RELOJ = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
});

// Qué hora marca la zona en un instante dado.
function enZona(instante) {
  const partes = {};
  for (const parte of RELOJ.formatToParts(instante)) partes[parte.type] = parte.value;
  const anio = Number(partes.year);
  const mes = Number(partes.month);
  const dia = Number(partes.day);
  return {
    anio,
    mes,
    dia,
    // Algunas versiones dan «24» para la medianoche.
    hora: Number(partes.hour) % 24,
    minuto: Number(partes.minute),
    diaSemana: new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay()
  };
}

/**
 * El instante en el que la zona marca esa hora de pared. Se parte de tratarla
 * como si fuera UTC y se corrige por el desfase real, que depende de la propia
 * fecha (horario de verano); dos pasadas bastan para cualquier zona.
 */
function instanteDe(anio, mes, dia, hora, minuto) {
  const objetivo = Date.UTC(anio, mes - 1, dia, hora, minuto);
  let t = objetivo;
  for (let i = 0; i < 2; i += 1) {
    const p = enZona(new Date(t));
    t += objetivo - Date.UTC(p.anio, p.mes - 1, p.dia, p.hora, p.minuto);
  }
  return new Date(t);
}

// Número de día correlativo, para restar fechas sin que el horario de verano
// estorbe: los días de un calendario siempre distan un número entero.
function numeroDeDia(anio, mes, dia) {
  return Date.UTC(anio, mes - 1, dia) / DIA;
}

function fechaDeNumero(n) {
  const d = new Date(n * DIA);
  return { anio: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate() };
}

// Número de día del lunes de esa semana.
function lunesDe(n) {
  return n - ((new Date(n * DIA).getUTCDay() + 6) % 7);
}

// ---------- Lectura ----------

// Los campos de días llegan como «1,3,5», como lista o vacíos. Un texto vacío
// tiene que dar una lista vacía y no un cero: el cero es el domingo.
function lista(valor) {
  const partes = Array.isArray(valor) ? valor : String(valor == null ? '' : valor).split(',');
  return partes
    .map((n) => String(n).trim())
    .filter((n) => n !== '')
    .map(Number)
    .filter((n) => Number.isInteger(n));
}

// Pasa una fila de `tareas_programadas` al plan que entienden estas funciones.
function desdeFila(fila) {
  return {
    frecuencia: fila.frecuencia,
    hora: fila.hora,
    desde: fila.fecha_inicio,
    cada: fila.cada || 1,
    diasSemana: lista(fila.dias_semana),
    diasMes: lista(fila.dias_mes),
    meses: lista(fila.meses)
  };
}

// «AAAA-MM-DD» → sus tres números, o null si no es una fecha que exista.
function diaDe(texto) {
  const m = String(texto || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  const comprobacion = new Date(Date.UTC(anio, mes - 1, dia));
  // Rechaza fechas que no existen: «2026-02-31» se iría al 3 de marzo.
  if (comprobacion.getUTCMonth() !== mes - 1 || comprobacion.getUTCDate() !== dia) return null;
  return { anio, mes, dia };
}

// ---------- Validación ----------

const HORA_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Comprueba un plan que llega del formulario. Devuelve
 * `{ ok: true, plan }` con los campos ya limpios, o `{ ok: false, error }`
 * con el mensaje que se le enseña al administrador.
 */
function validar(entrada) {
  const frecuencia = String(entrada.frecuencia || '').trim();
  if (!FRECUENCIAS.includes(frecuencia)) {
    return { ok: false, error: 'Elige cada cuánto se repite la tarea.' };
  }
  const hora = String(entrada.hora || '').trim();
  if (!HORA_RE.test(hora)) return { ok: false, error: 'La hora no es válida.' };

  const desde = String(entrada.desde || '').trim();
  if (!diaDe(desde)) return { ok: false, error: 'La fecha de inicio no es válida.' };

  const plan = { frecuencia, hora, desde, cada: 1, diasSemana: [], diasMes: [], meses: [] };

  if (frecuencia === 'diaria' || frecuencia === 'semanal') {
    const cada = Number(entrada.cada);
    if (!Number.isInteger(cada) || cada < 1 || cada > MAX_CADA) {
      return {
        ok: false,
        error: frecuencia === 'diaria'
          ? `Repetir cada: escribe un número de días entre 1 y ${MAX_CADA}.`
          : `Repetir cada: escribe un número de semanas entre 1 y ${MAX_CADA}.`
      };
    }
    plan.cada = cada;
  }

  if (frecuencia === 'semanal') {
    const dias = [...new Set(lista(entrada.diasSemana))].sort((a, b) => a - b);
    if (!dias.length) return { ok: false, error: 'Marca al menos un día de la semana.' };
    if (dias.some((d) => d < 0 || d > 6)) return { ok: false, error: 'Alguno de los días de la semana no es válido.' };
    plan.diasSemana = dias;
  }

  if (frecuencia === 'mensual') {
    const dias = [...new Set(lista(entrada.diasMes))].sort((a, b) => a - b);
    if (!dias.length) return { ok: false, error: 'Marca al menos un día del mes.' };
    if (dias.some((d) => d < 1 || d > 31)) return { ok: false, error: 'Alguno de los días del mes no es válido.' };
    plan.diasMes = dias;

    const meses = [...new Set(lista(entrada.meses))].sort((a, b) => a - b);
    if (meses.some((m) => m < 1 || m > 12)) return { ok: false, error: 'Alguno de los meses no es válido.' };
    // Los doce meses es lo mismo que no filtrar por mes: se guarda vacío.
    plan.meses = meses.length === 12 ? [] : meses;
  }

  return { ok: true, plan };
}

// Cómo se guarda el plan en las columnas de la tabla.
function comoFila(plan) {
  return {
    frecuencia: plan.frecuencia,
    hora: plan.hora,
    fecha_inicio: plan.desde,
    cada: plan.cada,
    dias_semana: plan.diasSemana.length ? plan.diasSemana.join(',') : null,
    dias_mes: plan.diasMes.length ? plan.diasMes.join(',') : null,
    meses: plan.meses.length ? plan.meses.join(',') : null
  };
}

// ---------- Vencimientos ----------

// ¿Salta el plan en el minuto de este instante?
function coincide(plan, instante) {
  const hhmm = HORA_RE.exec(plan.hora || '');
  if (!hhmm) return false;
  const ahora = enZona(instante);
  if (ahora.hora !== Number(hhmm[1]) || ahora.minuto !== Number(hhmm[2])) return false;

  const inicio = diaDe(plan.desde);
  if (!inicio) return false;
  const hoy = numeroDeDia(ahora.anio, ahora.mes, ahora.dia);
  const primero = numeroDeDia(inicio.anio, inicio.mes, inicio.dia);
  if (hoy < primero) return false;

  switch (plan.frecuencia) {
    case 'una_vez':
      return hoy === primero;
    case 'diaria':
      return (hoy - primero) % (plan.cada || 1) === 0;
    case 'semanal': {
      if (!plan.diasSemana.includes(ahora.diaSemana)) return false;
      const semanas = (lunesDe(hoy) - lunesDe(primero)) / 7;
      return semanas % (plan.cada || 1) === 0;
    }
    case 'mensual':
      if (plan.meses.length && !plan.meses.includes(ahora.mes)) return false;
      return plan.diasMes.includes(ahora.dia);
    default:
      return false;
  }
}

// El instante en que le toca a un plan el día número `n`.
function instanteDelDia(plan, n) {
  const hhmm = HORA_RE.exec(plan.hora || '');
  if (!hhmm) return null;
  const f = fechaDeNumero(n);
  return instanteDe(f.anio, f.mes, f.dia, Number(hhmm[1]), Number(hhmm[2]));
}

/**
 * Momentos en que el plan saltó dentro de (`desde`, `hasta`], ambos `Date`.
 * Sirve para recuperar lo que venció con el servidor parado. Se mira como
 * mucho `maxDias` hacia atrás: más allá, una tarea diaria acumularía tantas
 * incidencias como días llevara apagado.
 */
function vencimientos(plan, desde, hasta, { maxDias = 7 } = {}) {
  if (!HORA_RE.test(plan.hora || '') || !diaDe(plan.desde)) return [];

  const fin = new Date(Math.floor(hasta.getTime() / 60000) * 60000);
  const inicio = new Date(Math.max(desde.getTime(), fin.getTime() - maxDias * DIA));

  const primero = enZona(inicio);
  const ultimo = enZona(fin);
  // Un día de margen a cada lado: el desfase de la zona puede dejar el momento
  // de un día del calendario fuera del intervalo del otro.
  const desdeN = numeroDeDia(primero.anio, primero.mes, primero.dia) - 1;
  const hastaN = numeroDeDia(ultimo.anio, ultimo.mes, ultimo.dia) + 1;

  const saltos = [];
  for (let n = desdeN; n <= hastaN; n += 1) {
    const cuando = instanteDelDia(plan, n);
    if (cuando > inicio && cuando <= fin && coincide(plan, cuando)) saltos.push(cuando);
  }
  return saltos;
}

/**
 * La próxima vez que le toca al plan después de `desde`, o `null` si ya no le
 * toca nunca más (una tarea de «una vez» que ya pasó). Se enseña en la lista de
 * tareas: sin ella no hay forma de saber si una tarea recién creada va a hacer
 * algo, que es justo lo que hace dudar de si el programador funciona.
 */
function proximo(plan, desde = new Date()) {
  if (!HORA_RE.test(plan.hora || '') || !diaDe(plan.desde)) return null;

  const hoy = enZona(desde);
  let n = numeroDeDia(hoy.anio, hoy.mes, hoy.dia);
  // Dos años por delante bastan: la pauta más rara que se puede escribir es
  // «el 29 de febrero», y con eso se alcanza.
  const limite = n + 800;
  for (; n <= limite; n += 1) {
    const cuando = instanteDelDia(plan, n);
    if (cuando > desde && coincide(plan, cuando)) return cuando;
  }
  return null;
}

/**
 * Los días del mes (`anio`/`mes`, con `mes` de 1 a 12) en los que salta el
 * plan, para pintar un calendario. A diferencia de `vencimientos`, no importa
 * si ya pasó o todavía no: aquí solo interesa el día del mes, no el instante
 * exacto ni si el programador llegó a verlo.
 */
function ocurrenciasEnMes(plan, anio, mes) {
  if (!HORA_RE.test(plan.hora || '') || !diaDe(plan.desde)) return [];
  const dias = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const resultado = [];
  for (let dia = 1; dia <= dias; dia += 1) {
    const cuando = instanteDelDia(plan, numeroDeDia(anio, mes, dia));
    if (cuando && coincide(plan, cuando)) resultado.push(dia);
  }
  return resultado;
}

// «19/08/2026 09:00» en la zona de la aplicación.
function comoTexto(instante) {
  const p = enZona(instante);
  const dos = (n) => String(n).padStart(2, '0');
  return `${dos(p.dia)}/${dos(p.mes)}/${p.anio} ${dos(p.hora)}:${dos(p.minuto)}`;
}

module.exports = {
  ZONA,
  comoTexto,
  FRECUENCIAS,
  MAX_CADA,
  desdeFila,
  validar,
  comoFila,
  coincide,
  vencimientos,
  proximo,
  ocurrenciasEnMes,
  diaDe,
  enZona,
  instanteDe
};
