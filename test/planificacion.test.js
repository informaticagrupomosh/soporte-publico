'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const planificacion = require('../planificacion');

// Los instantes se construyen en la zona de la aplicación, no en la del
// proceso: así las pruebas dan lo mismo corran donde corran.
const en = (anio, mes, dia, hora = 9, minuto = 0) =>
  planificacion.instanteDe(anio, mes, dia, hora, minuto);

// Enero de 2026: el 1 es jueves, el 5 lunes y el 4 domingo.
const LUNES = en(2026, 1, 5);

function plan(extra) {
  const { ok, plan: limpio, error } = planificacion.validar({
    frecuencia: 'diaria', hora: '09:00', desde: '2026-01-05', cada: 1, ...extra
  });
  assert.ok(ok, `el plan debería valer: ${error}`);
  return limpio;
}

function salta(extra, fecha) {
  return planificacion.coincide(plan(extra), fecha);
}

// ---------- Validación ----------

test('rechaza los planes mal rellenados y dice por qué', () => {
  const casos = [
    [{ frecuencia: 'cuando sea' }, /cada cuánto/i],
    [{ hora: '25:00' }, /hora/i],
    [{ hora: '9:00' }, /hora/i],
    [{ desde: '2026-02-31' }, /fecha de inicio/i],
    [{ desde: 'mañana' }, /fecha de inicio/i],
    [{ frecuencia: 'diaria', cada: 0 }, /días/i],
    [{ frecuencia: 'diaria', cada: 2.5 }, /días/i],
    [{ frecuencia: 'semanal', cada: 1, diasSemana: '' }, /día de la semana/i],
    [{ frecuencia: 'semanal', cada: 1, diasSemana: '9' }, /días de la semana/i],
    [{ frecuencia: 'mensual', diasMes: '' }, /día del mes/i],
    [{ frecuencia: 'mensual', diasMes: '32' }, /días del mes/i],
    [{ frecuencia: 'mensual', diasMes: '1', meses: '13' }, /meses/i]
  ];
  for (const [extra, esperado] of casos) {
    const r = planificacion.validar({
      frecuencia: 'diaria', hora: '09:00', desde: '2026-01-05', cada: 1, ...extra
    });
    assert.strictEqual(r.ok, false, `no debería valer: ${JSON.stringify(extra)}`);
    assert.match(r.error, esperado);
  }
});

test('los doce meses marcados equivalen a no filtrar por mes', () => {
  const p = plan({ frecuencia: 'mensual', diasMes: '1', meses: '1,2,3,4,5,6,7,8,9,10,11,12' });
  assert.deepStrictEqual(p.meses, [], 'se guarda vacío, que se lee «todos»');
});

test('los días repetidos o desordenados se limpian', () => {
  const p = plan({ frecuencia: 'semanal', cada: 1, diasSemana: '3,1,3' });
  assert.deepStrictEqual(p.diasSemana, [1, 3]);
});

// ---------- Una vez ----------

test('una vez salta solo ese día y a esa hora', () => {
  const p = { frecuencia: 'una_vez', hora: '09:00', desde: '2026-01-05', cada: 1, diasSemana: [], diasMes: [], meses: [] };
  assert.ok(planificacion.coincide(p, LUNES));
  assert.ok(!planificacion.coincide(p, en(2026, 1, 5, 9, 1)));
  assert.ok(!planificacion.coincide(p, en(2026, 1, 6, 9, 0)), 'no se repite al día siguiente');
});

// ---------- Diaria ----------

test('la tarea diaria salta todos los días desde su fecha de inicio', () => {
  assert.ok(salta({}, LUNES));
  assert.ok(salta({}, en(2026, 1, 6, 9, 0)));
  assert.ok(!salta({}, en(2026, 1, 5, 10, 0)), 'solo a su hora');
  assert.ok(!salta({}, en(2026, 1, 4, 9, 0)), 'nada antes de la fecha de inicio');
});

test('«cada N días» cuenta desde la fecha de inicio', () => {
  const cada3 = { cada: 3 };
  assert.ok(salta(cada3, LUNES), 'el día 5 es el primero');
  assert.ok(!salta(cada3, en(2026, 1, 6, 9, 0)));
  assert.ok(!salta(cada3, en(2026, 1, 7, 9, 0)));
  assert.ok(salta(cada3, en(2026, 1, 8, 9, 0)), 'tres días después');
});

// ---------- Semanal ----------

test('la tarea semanal salta los días marcados', () => {
  const lunesYMiercoles = { frecuencia: 'semanal', cada: 1, diasSemana: '1,3' };
  assert.ok(salta(lunesYMiercoles, LUNES));
  assert.ok(salta(lunesYMiercoles, en(2026, 1, 7, 9, 0)), 'miércoles');
  assert.ok(!salta(lunesYMiercoles, en(2026, 1, 6, 9, 0)), 'martes no');
});

test('el domingo se marca con el 0', () => {
  const domingos = { frecuencia: 'semanal', cada: 1, diasSemana: '0', desde: '2026-01-01' };
  assert.ok(salta(domingos, en(2026, 1, 4, 9, 0)));
  assert.ok(!salta(domingos, en(2026, 1, 5, 9, 0)));
});

test('«cada N semanas» salta semana sí, semana no', () => {
  const quincenal = { frecuencia: 'semanal', cada: 2, diasSemana: '1' };
  assert.ok(salta(quincenal, LUNES), 'el lunes de la semana de inicio');
  assert.ok(!salta(quincenal, en(2026, 1, 12, 9, 0)), 'la semana siguiente no');
  assert.ok(salta(quincenal, en(2026, 1, 19, 9, 0)), 'dos semanas después sí');
});

// ---------- Mensual ----------

test('la tarea mensual salta los días marcados de cada mes', () => {
  const uno = { frecuencia: 'mensual', diasMes: '1', desde: '2026-01-01' };
  assert.ok(salta(uno, en(2026, 1, 1, 9, 0)));
  assert.ok(salta(uno, en(2026, 2, 1, 9, 0)), 'y en febrero');
  assert.ok(!salta(uno, en(2026, 2, 2, 9, 0)));

  const quincena = { frecuencia: 'mensual', diasMes: '1,15', desde: '2026-01-01' };
  assert.ok(salta(quincena, en(2026, 1, 15, 9, 0)));
});

test('con meses marcados, la tarea mensual solo salta en esos', () => {
  const trimestral = { frecuencia: 'mensual', diasMes: '1', meses: '1,4,7,10', desde: '2026-01-01' };
  assert.ok(salta(trimestral, en(2026, 1, 1, 9, 0)), 'enero');
  assert.ok(!salta(trimestral, en(2026, 2, 1, 9, 0)), 'febrero no');
  assert.ok(salta(trimestral, en(2026, 4, 1, 9, 0)), 'abril');
});

test('un día 31 sencillamente no existe en los meses cortos', () => {
  const finDeMes = { frecuencia: 'mensual', diasMes: '31', desde: '2026-01-01' };
  assert.ok(salta(finDeMes, en(2026, 1, 31, 9, 0)), 'enero tiene 31');
  // Febrero no llega al 31, así que ese mes no salta: no se adelanta al 28.
  assert.ok(!salta(finDeMes, en(2026, 2, 28, 9, 0)));
});

// ---------- Vencimientos ----------

test('vencimientos recupera lo que cayó con el servidor parado', () => {
  const saltos = planificacion.vencimientos(
    plan({ desde: '2026-01-01' }), en(2026, 1, 5, 8, 0), en(2026, 1, 8, 10, 0)
  );
  assert.deepStrictEqual(saltos.map((d) => d.getDate()), [5, 6, 7, 8]);
});

test('vencimientos no repite el minuto ya evaluado', () => {
  const saltos = planificacion.vencimientos(
    plan({ desde: '2026-01-01' }), en(2026, 1, 5, 9, 0), en(2026, 1, 5, 9, 30)
  );
  assert.strictEqual(saltos.length, 0, '«desde» es exclusivo');
});

test('vencimientos no acumula más de una semana de atraso', () => {
  const saltos = planificacion.vencimientos(
    plan({ desde: '2025-01-01' }), en(2025, 1, 1), en(2026, 1, 8, 10, 0)
  );
  assert.strictEqual(saltos.length, 7, 'un año parado no genera un año de incidencias');
});

test('vencimientos respeta la fecha de inicio', () => {
  const saltos = planificacion.vencimientos(
    plan({ desde: '2026-01-07' }), en(2026, 1, 5, 0, 0), en(2026, 1, 8, 10, 0)
  );
  assert.deepStrictEqual(saltos.map((d) => d.getDate()), [7, 8]);
});

// ---------- La zona de la aplicación ----------

test('la hora es la de España, no la del servidor', () => {
  // Una tarea diaria a las 09:00 tiene que saltar cuando en España son las
  // 09:00, que en agosto es a las 07:00 UTC. Si se leyera la hora del proceso,
  // un servidor en UTC la dispararía dos horas tarde.
  const p = plan({ desde: '2026-08-01' });
  assert.ok(planificacion.coincide(p, new Date('2026-08-19T07:00:00Z')), 'las 09:00 de España');
  assert.ok(!planificacion.coincide(p, new Date('2026-08-19T09:00:00Z')), 'las 09:00 UTC no');

  // En invierno España va a UTC+1, así que el mismo plan salta a las 08:00 UTC.
  const invierno = plan({ desde: '2026-01-01' });
  assert.ok(planificacion.coincide(invierno, new Date('2026-01-15T08:00:00Z')));
  assert.ok(!planificacion.coincide(invierno, new Date('2026-01-15T07:00:00Z')));
});

test('el cambio de hora no descuadra una tarea diaria', () => {
  // El último domingo de marzo de 2026 (día 29) España adelanta el reloj.
  const p = plan({ desde: '2026-03-27' });
  for (const dia of [27, 28, 29, 30, 31]) {
    assert.strictEqual(
      planificacion.vencimientos(p, en(2026, 3, dia, 0, 0), en(2026, 3, dia, 23, 59)).length,
      1,
      `el ${dia} de marzo tiene que saltar una vez`
    );
  }
});

// ---------- Próxima ejecución ----------

test('proximo dice cuándo le toca la próxima vez', () => {
  const diaria = plan({ desde: '2026-01-01' });
  assert.deepStrictEqual(
    planificacion.proximo(diaria, en(2026, 1, 5, 8, 0)).getTime(),
    en(2026, 1, 5, 9, 0).getTime(),
    'hoy mismo, si la hora aún no ha pasado'
  );
  assert.deepStrictEqual(
    planificacion.proximo(diaria, en(2026, 1, 5, 10, 0)).getTime(),
    en(2026, 1, 6, 9, 0).getTime(),
    'mañana, si ya pasó'
  );

  const semanal = plan({ frecuencia: 'semanal', cada: 1, diasSemana: '1', desde: '2026-01-01' });
  assert.strictEqual(
    planificacion.proximo(semanal, en(2026, 1, 6, 10, 0)).getTime(),
    en(2026, 1, 12, 9, 0).getTime(),
    'el lunes siguiente'
  );
});

test('proximo no promete nada de una tarea de una vez ya pasada', () => {
  const unaVez = plan({ frecuencia: 'una_vez', desde: '2026-01-05' });
  assert.ok(planificacion.proximo(unaVez, en(2026, 1, 1, 0, 0)), 'antes, sí tiene fecha');
  assert.strictEqual(planificacion.proximo(unaVez, en(2026, 1, 6, 0, 0)), null, 'después, ya no');
});
