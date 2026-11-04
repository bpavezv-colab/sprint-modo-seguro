import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCSV } from '../src/csv.js';
import { crearStore } from '../src/store.js';
import { mount } from '../src/ui.js';
import { DEMO_SETTINGS } from '../src/optimization/demo.js';
import { ORDEN_DEFAULT } from '../src/optimization/objectives.js';
const load = f => parseCSV(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const base = { colaboradores: load('colaboradores.csv'), hitos: load('hitos_onboarding.csv'), usuarios: load('usuarios_roles.csv'), catalogo: load('catalogo_hitos.csv') };
const nuevo = () => { const st = crearStore(base); st.login('JEF-002'); return st; };
const week = '2026-11-16';
const settings = { validated: true };
const search = { iterations: 20, maxTimeMs: 5000, maxStall: 4, seed: 10, scheduler: async () => {} };

test('Planificación: escenario sintético separado, alcance por jefatura y sin cambios en CSV', () => {
  const st = nuevo(); assert.equal(st.prepararTurnos(week, settings).ok, true);
  const p = st.planTurnos(week); assert.equal(p.model.synthetic, true);
  assert.ok(p.model.workers.every(w => st.state.auth.enAlcance(st.state.user, w.id)));
  assert.ok(!JSON.stringify(p).includes('nombre_ficticio'));
  assert.deepEqual(st.state.base, base);
  st.login('JEF-001'); assert.equal(st.planTurnos(week), null);
  for (const id of ['COL-002', 'TI-004', 'PER-001']) {
    st.login(id); assert.equal(st.prepararTurnos(week, settings).ok, false); assert.equal(st.planTurnos(week), null);
  }
});

test('Planificación: guardar demanda rechaza módulos ajenos, negativos y celdas duplicadas', () => {
  const st = nuevo(); st.prepararTurnos(week, settings); const p = st.planTurnos(week);
  assert.equal(st.guardarDemandaTurnos(week, [{ ...p.model.demand[0], moduleId: 'AJENO' }]).ok, false);
  assert.equal(st.guardarDemandaTurnos(week, [{ ...p.model.demand[0], required: -1 }]).ok, false);
  assert.equal(st.guardarDemandaTurnos(week, [p.model.demand[0], p.model.demand[0]]).ok, false);
  assert.equal(st.guardarDemandaTurnos(week, p.model.demand).ok, true);
});

test('Planificación: prioridades válidas se guardan por semana y quedan trazadas', () => {
  const st = nuevo(); st.prepararTurnos(week, settings);
  assert.equal(st.ordenarTurnos(week, ['cobertura']).ok, false);
  const order = ['preferencias', 'cobertura', 'equidad', 'horas', 'cambios'];
  assert.equal(st.ordenarTurnos(week, order).ok, true);
  assert.deepEqual(st.planTurnos(week).order, order);
  assert.ok(st.state.bitacora.some(e => e.accion === 'turnos_prioridades' && e.detalle.includes(week)));
});

test('Planificación: anticipación de siete días, excepción con solicitud y autorización de Personas', () => {
  const st = nuevo(); const late = '2026-11-09'; st.prepararTurnos(late, settings);
  assert.equal(st.confirmarDemandaTurnos(late).ok, false);
  assert.equal(st.solicitarExcepcionTurnos(late, 'Ajuste operativo').ok, true);
  assert.equal(st.autorizarExcepcionTurnos('JEF-002', late, { confirmado: true }).ok, false);
  st.login('PER-001'); assert.equal(st.excepcionesTurnos().length, 1);
  assert.equal(st.autorizarExcepcionTurnos('JEF-002', late, { confirmado: true }).ok, true);
  st.login('JEF-002'); assert.equal(st.confirmarDemandaTurnos(late).ok, true);
  assert.ok(st.state.bitacora.some(e => e.accion === 'turnos_excepcion_autorizada'));
  assert.equal(st.prepararTurnos('2026-11-05', settings).ok, false);
});

test('Planificación: generar exige demanda confirmada, aprobar exige confirmación y no altera turnos oficiales', async () => {
  const st = nuevo(); st.prepararTurnos(week, settings);
  assert.equal((await st.generarTurnos(week, undefined, search)).ok, false);
  st.confirmarDemandaTurnos(week);
  const r = await st.generarTurnos(week, undefined, search); assert.equal(r.ok, true);
  assert.equal(st.aprobarTurnos(week, r.id).ok, false);
  assert.equal(st.aprobarTurnos(week, r.id, { confirmado: true }).ok, true);
  assert.equal(st.planTurnos(week).results[0].status, 'borrador_validado');
  assert.deepEqual(st.state.base, base); assert.deepEqual(st.state.overrides, {});
});

test('Planificación: cambiar demanda invalida confirmación, autorización y propuestas anteriores', async () => {
  const st = nuevo(); st.prepararTurnos(week, settings); st.confirmarDemandaTurnos(week);
  const r = await st.generarTurnos(week, undefined, search);
  const p = st.planTurnos(week); const changed = p.model.demand.map(d => ({ ...d, required: 0 }));
  st.guardarDemandaTurnos(week, changed);
  assert.equal(st.aprobarTurnos(week, r.id, { confirmado: true }).ok, false);
  assert.equal(st.planTurnos(week).confirmed, false);
});

test('Planificación: cambio de usuario durante búsqueda descarta el resultado privado', async () => {
  const st = nuevo(); st.prepararTurnos(week, settings); st.confirmarDemandaTurnos(week);
  const r = await st.generarTurnos(week, undefined, { ...search, yieldEvery: 1, onProgress() { st.login('TI-004'); } });
  assert.equal(r.ok, false); st.login('JEF-002'); assert.equal(st.planTurnos(week).results.length, 0);
});

test('Planificación: no persiste resultados y Personas recibe solo solicitudes agregadas', () => {
  const st = nuevo(); st.prepararTurnos('2026-11-09', settings); st.solicitarExcepcionTurnos('2026-11-09', 'Ajuste operativo');
  st.login('PER-001'); const e = st.excepcionesTurnos()[0];
  assert.equal('workers' in e, false); assert.equal('preferences' in e, false);
  const otra = nuevo(); assert.equal(otra.planTurnos('2026-11-09'), null);
});

test('Planificación: no acepta parámetros adicionales ni omite un cambio de sesión transitorio', async () => {
  const st = nuevo();
  assert.equal(st.prepararTurnos(week, { ...settings, dato_personal: 'SECRETO' }).ok, false);
  st.prepararTurnos(week, settings); st.confirmarDemandaTurnos(week);
  const r = await st.generarTurnos(week, undefined, { ...search, yieldEvery: 1, onProgress() { st.login('TI-004'); st.login('JEF-002'); } });
  assert.equal(r.ok, false); assert.equal(st.planTurnos(week).results.length, 0);
  assert.equal(JSON.stringify(st.state.bitacora).includes('SECRETO'), false);
});

test('Interfaz de turnos: preparar, guardar, confirmar, reordenar, generar y aprobar de extremo a extremo', async () => {
  const st = nuevo(); const beforeDoc = globalThis.document; const beforeForm = globalThis.FormData;
  globalThis.document = { addEventListener() {} };
  globalThis.FormData = class { constructor(f) { this.values = f.values; } get(k) { return this.values[k] ?? null; } };
  const handlers = {}; const root = { innerHTML: '', addEventListener(k, fn) { handlers[k] = fn; } };
  const submit = (form, values) => handlers.submit({ preventDefault() {}, target: { closest: () => ({ dataset: { form }, values }) } });
  const click = (act, arg) => handlers.click({ target: { closest: () => ({ dataset: { act, arg } }) } });
  try {
    mount(root, st); assert.match(root.innerHTML, /Planificación Inteligente de Turnos/);
    const values = { ...DEMO_SETTINGS, week, validated: 'on', lockFirst: 'on', morningStart: '08:00', morningEnd: '12:00', afternoonStart: '13:00', afternoonEnd: '17:00' };
    await submit('turnos-preparar', values);
    const p = st.planTurnos(week); assert.ok(p);
    await submit('turnos-demanda', Object.fromEntries(p.model.demand.map((d, i) => [`d-${i}`, String(d.required)])));
    click('turnos-confirmar'); assert.match(root.innerHTML, /role="dialog"/); click('confirm-ok');
    assert.equal(st.planTurnos(week).confirmed, true);
    handlers.change({ target: { closest: () => ({ dataset: { change: 'turnos-prioridad', arg: 'preferencias' }, value: '0' }) } });
    assert.match(root.innerHTML, /Cobertura tiene una prioridad inferior/);
    click('turnos-restablecer');
    await submit('turnos-generar', { iterations: '10', maxTimeMs: '5000', maxStall: '2', seed: '8', ...Object.fromEntries(ORDEN_DEFAULT.map(id => [`tol-${id}`, '0'])) });
    const r = st.planTurnos(week).results[0]; assert.ok(r);
    assert.match(root.innerHTML, /Calendario semanal por trabajador y módulo/);
    click('turnos-aprobar', r.id); click('confirm-ok');
    assert.equal(st.planTurnos(week).results[0].status, 'borrador_validado');
    assert.deepEqual(st.state.base, base);
    const late = '2026-11-09'; st.prepararTurnos(late, settings); st.solicitarExcepcionTurnos(late, 'Ajuste operativo');
    click('logout'); click('quick', 'PER-001');
    click('turnos-autorizar', `JEF-002|${late}`); click('confirm-ok');
    click('logout'); click('quick', 'JEF-002');
    await submit('turnos-abrir', { week: late });
    assert.match(root.innerHTML, /Estado: autorizada/);
    click('turnos-confirmar'); click('confirm-ok');
    assert.equal(st.planTurnos(late).confirmed, true);
    click('logout'); click('quick', 'TI-004');
    assert.equal(root.innerHTML.includes('Planificación Inteligente de Turnos'), false);
    assert.equal(root.innerHTML.includes(r.id), false);
  } finally { globalThis.document = beforeDoc; globalThis.FormData = beforeForm; }
});

test('Interfaz: cerrar un aviso temporal conserva el formulario que se está editando', async () => {
  const st = nuevo(); const doc = globalThis.document; const form = globalThis.FormData; const timeout = globalThis.setTimeout;
  let tick; let removals = 0; const handlers = {};
  globalThis.setTimeout = fn => { tick = fn; return 0; };
  globalThis.document = { addEventListener() {} };
  globalThis.FormData = class { constructor(f) { this.values = f.values; } get(k) { return this.values[k] ?? null; } };
  const root = { innerHTML: '', addEventListener(k, fn) { handlers[k] = fn; }, querySelector() { return { remove() { removals++; } }; } };
  try {
    mount(root, st);
    await handlers.submit({ preventDefault() {}, target: { closest: () => ({ dataset: { form: 'turnos-abrir' }, values: { week: '2026-11-23' } }) } });
    assert.equal(typeof tick, 'function');
    root.innerHTML += '<input value="BORRADOR EN EDICION">'; const draft = root.innerHTML;
    tick(); assert.equal(root.innerHTML, draft); assert.equal(removals, 1);
  } finally { globalThis.document = doc; globalThis.FormData = form; globalThis.setTimeout = timeout; }
});
