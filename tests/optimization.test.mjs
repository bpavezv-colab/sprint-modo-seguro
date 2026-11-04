import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarModelo } from '../src/optimization/model.js';
import { validarSolucion } from '../src/optimization/constraints.js';
import { evaluarObjetivos, ORDEN_DEFAULT } from '../src/optimization/objectives.js';
import { optimizar, optimizarALNS } from '../src/optimization/alns.js';

const escenario = () => ({ week: '2026-11-16', ownerId: 'JEF-002', synthetic: true,
  modules: [{ id: 'M1', label: 'Puesto demo', siteId: 'S1' }],
  shifts: [{ id: 'manana', label: 'Mañana', start: 480, end: 720 }, { id: 'tarde', label: 'Tarde', start: 780, end: 1020 }],
  config: { validated: true, maxBlocksPerDay: 1, minRestHours: 12, maxConsecutiveDays: 5, maxDailyHours: 8 },
  workers: ['A', 'B'].map(id => ({ id, siteId: 'S1', modules: ['M1'], targetHours: 8, maxHours: 8, maxDays: 2,
    availability: Array.from({ length: 2 }, (_, day) => ['manana', 'tarde'].map(shiftId => ({ day, shiftId }))).flat() })),
  demand: [0, 1].flatMap(day => ['manana', 'tarde'].map(shiftId => ({ day, shiftId, moduleId: 'M1', required: 1 }))), baseline: [],
});
const opciones = { iterations: 180, maxTimeMs: 60000, maxStall: 60, seed: 123 };
const a = (workerId, day = 0, shiftId = 'manana', moduleId = 'M1') => ({ workerId, day, shiftId, moduleId });

test('Modelo: rechaza datos obligatorios faltantes y parámetros sin validar', () => {
  const m = escenario(); assert.equal(validarModelo(m).ok, true);
  m.workers[0].availability = null; assert.equal(validarModelo(m).ok, false);
  m.workers[0].availability = []; m.config.validated = false;
  assert.equal(validarModelo(m).ok, false);
});

test('Modelo: entradas incompletas se rechazan sin lanzar y no se aceptan bloqueos imposibles', () => {
  const m = escenario(); m.demand = [null];
  assert.doesNotThrow(() => assert.equal(optimizar(m, opciones).ok, false));
  const locked = escenario(); locked.baseline = [{ ...a('A'), locked: true }, { ...a('A', 0, 'tarde'), locked: true }];
  assert.equal(optimizar(locked, opciones).ok, false);
});

test('Bloque continuo: ocupa una sola jornada completa y respeta el máximo diario', () => {
  const m = escenario(); m.shifts = [{ id: 'continua', label: 'Continua demo', start: 480, end: 960 }];
  m.demand = [{ day: 0, shiftId: 'continua', moduleId: 'M1', required: 2 }];
  for (const w of m.workers) w.availability = [{ day: 0, shiftId: 'continua' }];
  const r = optimizar(m, opciones); assert.equal(r.metrics.costs.cobertura, 0);
  assert.equal(r.assignments.length, 2); assert.ok(r.metrics.loads.every(w => w.hours === 8));
});

test('Preferencias: solicitudes individuales se valoran sin convertir una ausencia en preferencia', () => {
  const m = escenario(); m.workers[0].preferences = { requests: [{ day: 0, shiftId: 'manana', wanted: true }] };
  assert.equal(evaluarObjetivos(m, []).costs.preferencias, 1);
  assert.equal(evaluarObjetivos(m, [a('A')]).costs.preferencias, 0);
  m.workers[0].unavailable = [{ day: 0, shiftId: 'manana' }];
  assert.equal(validarSolucion(m, [a('A')]).ok, false);
});

test('ALNS: tolerancias quedan ancladas y el corte por tiempo devuelve una solución factible', () => {
  const m = escenario(); const r = optimizar(m, { ...opciones, tolerances: { cobertura: 1 } });
  let bound = Infinity;
  for (const stage of r.stages) { assert.ok(stage.boundsAfter.cobertura <= bound); bound = stage.boundsAfter.cobertura; }
  const limited = optimizar(escenario(), { ...opciones, maxTimeMs: 0.001 });
  assert.equal(limited.termination, 'tiempo'); assert.equal(validarSolucion(escenario(), limited.assignments).ok, true);
});

test('Restricciones: sin sobreasignación, superposición ni jornadas fragmentadas', () => {
  const m = escenario();
  assert.equal(validarSolucion(m, [a('A'), a('B')]).ok, false);
  assert.equal(validarSolucion(m, [a('A'), a('A', 0, 'tarde')]).ok, false);
  assert.equal(validarSolucion(m, [a('A'), a('A')]).ok, false);
  assert.equal(validarSolucion(m, [a('A'), a('B', 0, 'tarde')]).ok, true);
});

test('Restricciones: disponibilidad, ausencias, habilitación y sede', () => {
  const m = escenario(); m.workers[0].availability = [];
  assert.equal(validarSolucion(m, [a('A')]).ok, false);
  m.workers[0].availability = [{ day: 0, shiftId: 'manana' }];
  m.workers[0].unavailable = [{ day: 0, shiftId: 'manana' }];
  assert.equal(validarSolucion(m, [a('A')]).ok, false);
  delete m.workers[0].unavailable; m.workers[0].modules = [];
  assert.equal(validarSolucion(m, [a('A')]).ok, false);
  m.workers[0].modules = ['M1']; m.workers[0].siteId = 'OTRA';
  assert.equal(validarSolucion(m, [a('A')]).ok, false);
});

test('Restricciones: límites semanales, diarios, descanso y días consecutivos', () => {
  const m = escenario(); m.workers[0].maxHours = 4;
  assert.equal(validarSolucion(m, [a('A'), a('A', 1)]).ok, false);
  m.workers[0].maxHours = 8; m.config.minRestHours = 20;
  assert.equal(validarSolucion(m, [a('A', 0, 'tarde'), a('A', 1)]).ok, false);
  m.config.minRestHours = 12; m.config.maxConsecutiveDays = 1;
  assert.equal(validarSolucion(m, [a('A'), a('A', 1)]).ok, false);
  m.config.maxConsecutiveDays = 5; m.config.maxDailyHours = 3;
  assert.equal(validarSolucion(m, [a('A')]).ok, false);
});

test('ALNS: conserva bloqueos y deja demanda imposible explícitamente sin cubrir', () => {
  const m = escenario(); m.baseline = [{ ...a('A'), locked: true }];
  m.workers[1].availability = [];
  const r = optimizar(m, opciones);
  assert.equal(r.ok, true); assert.equal(validarSolucion(m, r.assignments).ok, true);
  assert.ok(r.assignments.some(x => x.workerId === 'A' && x.day === 0 && x.shiftId === 'manana'));
  assert.ok(r.metrics.costs.cobertura > 0); assert.ok(r.metrics.uncovered.length > 0);
});

test('Lexicografía: dos órdenes producen decisiones distintas y verificables', () => {
  const m = escenario(); m.demand = [{ day: 0, shiftId: 'tarde', moduleId: 'M1', required: 1 }];
  m.baseline = [a('A', 0, 'tarde')];
  m.workers[0].preferences = { shifts: ['manana'] };
  m.workers[1].preferences = { shifts: ['tarde'] };
  const cambios = optimizar(m, { ...opciones, order: ['cambios', 'cobertura', 'preferencias', 'horas', 'equidad'] });
  const preferencias = optimizar(m, { ...opciones, order: ['cobertura', 'preferencias', 'cambios', 'horas', 'equidad'] });
  assert.equal(cambios.assignments[0].workerId, 'A');
  assert.equal(preferencias.assignments[0].workerId, 'B');
  assert.equal(cambios.metrics.costs.cambios, 0);
  assert.equal(preferencias.metrics.costs.preferencias, 0);
  for (const r of [cambios, preferencias]) for (const etapa of r.stages) {
    for (const [objetivo, limite] of Object.entries(etapa.lockedBefore)) assert.ok(etapa.costs[objetivo] <= limite + 1e-8);
  }
});

test('ALNS: misma semilla y presupuesto de iteraciones reproducen el resultado', () => {
  const m = escenario(); m.demand = [{ day: 0, shiftId: 'tarde', moduleId: 'M1', required: 1 }];
  m.baseline = [a('A', 0, 'tarde')];
  m.workers[0].preferences = { shifts: ['manana'] }; m.workers[1].preferences = { shifts: ['tarde'] };
  const cfg = { ...opciones, order: ['cobertura', 'preferencias', 'cambios', 'horas', 'equidad'] };
  const r1 = optimizar(m, cfg); const r2 = optimizar(m, cfg);
  assert.deepEqual(r1.assignments, r2.assignments); assert.deepEqual(r1.stages, r2.stages);
  assert.equal(r1.operators.destroy.length, 3); assert.equal(r1.operators.repair.length, 3);
  assert.ok(r1.operators.destroy.some(x => x.weight !== 1));
  assert.equal(r1.order.length, 5);
});

test('Objetivos: equidad proporcional a contrato y disponibilidad; opcionales faltantes se declaran', () => {
  const m = escenario(); m.workers[1].targetHours = 4;
  m.workers[1].availability = [{ day: 0, shiftId: 'tarde' }];
  const proporcional = evaluarObjetivos(m, [a('A'), a('A', 1), a('B', 0, 'tarde')]);
  assert.equal(proporcional.costs.equidad, 0);
  delete m.workers[0].targetHours;
  assert.ok(evaluarObjetivos(m, []).notes.length > 0);
  assert.equal(optimizar(m, opciones).ok, true);
});

test('ALNS: límites, cancelación y progreso asíncrono conservan una solución factible', async () => {
  const m = escenario(); const eventos = [];
  const r = await optimizarALNS(m, { ...opciones, iterations: 30, onProgress: p => eventos.push(p), yieldEvery: 1 });
  assert.equal(r.ok, true); assert.ok(eventos.length > 0); assert.ok(r.iterations <= 30);
  const cancelado = await optimizarALNS(m, { ...opciones, shouldCancel: () => true });
  assert.equal(cancelado.termination, 'cancelado'); assert.equal(validarSolucion(m, cancelado.assignments).ok, true);
  assert.equal(optimizar(m, { ...opciones, order: ['cobertura'] }).ok, false);
  assert.equal(optimizar(m, { ...opciones, tolerances: { cobertura: -1 } }).ok, false);
  assert.deepEqual(ORDEN_DEFAULT, ['cobertura', 'cambios', 'horas', 'preferencias', 'equidad']);
});
