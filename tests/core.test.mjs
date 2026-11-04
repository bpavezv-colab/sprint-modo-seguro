import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCSV } from '../src/csv.js';
import { indexData, evaluarHito, validar, agruparAlertas, HOY_DEFAULT } from '../src/rules.js';
import { crearAuth } from '../src/permissions.js';
import { crearStore } from '../src/store.js';

const load = f => parseCSV(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const base = {
  colaboradores: load('colaboradores.csv'),
  hitos: load('hitos_onboarding.csv'),
  usuarios: load('usuarios_roles.csv'),
  catalogo: load('catalogo_hitos.csv'),
};
const idx = indexData(base);
const auth = crearAuth(base);
const U = id => auth.users.get(id);
const H = id => base.hitos.find(h => h.hito_id === id);

test('CSV: vacíos son null, no "No" ni "Pendiente"', () => {
  const c = base.colaboradores.find(x => x.colaborador_id === 'COL-019');
  assert.equal(c.jefatura_id, null);
  assert.equal(base.colaboradores.find(x => x.colaborador_id === 'COL-056').estado_onboarding, null);
  assert.equal(base.hitos.length, 300);
});

test('Reglas: un "Pendiente" con fecha movida se ve vencido según catálogo', () => {
  const e = evaluarHito(H('HITO-003'), idx, HOY_DEFAULT); // Acceso COL-001, ingreso 2026-09-04
  assert.equal(e.estadoReal, 'Vencido');
  assert.ok(e.flags.includes('plazo_corrido'));
  assert.equal(e.limite, '2026-09-04');
});

test('Reglas: cumplido sin fecha o con fecha futura queda "Por verificar"', () => {
  assert.equal(evaluarHito(H('HITO-050'), idx, HOY_DEFAULT).estadoReal, 'Por verificar');
  assert.equal(evaluarHito(H('HITO-060'), idx, HOY_DEFAULT).estadoReal, 'Por verificar');
});

test('Reglas: 90 hitos abiertos y todos vencidos según catálogo (registro dice 35)', () => {
  const ev = base.hitos.map(h => evaluarHito(h, idx, HOY_DEFAULT));
  assert.equal(base.hitos.filter(h => h.estado === 'Atrasado').length, 35);
  assert.equal(ev.filter(e => e.estadoReal === 'Vencido').length, 90);
});

test('Validación: detecta las trampas del dataset', () => {
  const g = Object.fromEntries(agruparAlertas(validar(base, idx, HOY_DEFAULT)).map(x => [x.regla, x.items.length]));
  assert.equal(g.responsable_vacio, 7);
  assert.equal(g.cumplido_sin_fecha, 4);
  assert.equal(g.cumplido_fecha_futura, 22);
  assert.equal(g.jefatura_vacia, 1);
  assert.equal(g.pendiente_vencido_segun_regla, 55);
  assert.equal(g.id_duplicado, undefined);
});

test('Permisos: colaborador solo se ve a sí mismo', () => {
  assert.ok(auth.puedeVerColaborador(U('COL-002'), 'COL-002'));
  assert.ok(!auth.puedeVerColaborador(U('COL-002'), 'COL-014'));
  assert.ok(!auth.puedeVerMetricas(U('COL-002')));
});

test('Permisos: jefatura ve solo su equipo, no canal de contacto ni reportes', () => {
  const j = U('JEF-002');
  assert.ok(auth.puedeVerColaborador(j, 'COL-014'));
  assert.ok(!auth.puedeVerColaborador(j, 'COL-006'));
  assert.ok(!auth.puedeVerCampo(j, 'COL-014', 'canal_contacto'));
  assert.ok(!auth.puedeVerReportes(j));
});

test('Permisos: jefatura no puede completar hitos de TI ni de Personas', () => {
  const j = U('JEF-002');
  assert.equal(auth.puedeCompletar(j, H('HITO-008')).ok, false); // Acceso COL-002 (TI)
  assert.equal(auth.puedeCompletar(j, H('HITO-006')).ok, false); // Contrato COL-002 (Personas)
  assert.equal(auth.puedeCompletar(j, H('HITO-009')).ok, true);  // Reunión COL-002 asignada a JEF-002
});

test('Permisos: TI ve solo hitos técnicos, sin nombre ni canal', () => {
  const t = U('TI-004');
  assert.ok(auth.puedeVerHito(t, H('HITO-008')));
  assert.ok(!auth.puedeVerHito(t, H('HITO-009')));
  assert.ok(!auth.puedeVerCampo(t, 'COL-002', 'nombre'));
  assert.ok(!auth.puedeVerCampo(t, 'COL-002', 'canal_contacto'));
  assert.ok(!auth.puedeVerCampo(t, 'COL-002', 'jefatura_id'));
  assert.equal(auth.puedeCompletar(t, H('HITO-008')).ok, true);
  assert.equal(auth.puedeCompletar(U('TI-001'), H('HITO-008')).ok, false);
  assert.equal(auth.puedeReasignar(t, H('HITO-009'), 'JEF-002').ok, false);
  assert.equal(auth.puedeReasignar(t, H('HITO-008'), 'PER-001').ok, false);
  assert.equal(auth.puedeReasignar(t, H('HITO-008'), 'TI-001').ok, true);
});

test('Permisos: Personas reasigna con rol correcto y jefatura con alcance', () => {
  const p = U('PER-001');
  assert.equal(auth.puedeReasignar(p, H('HITO-033'), 'TI-003').ok, true);
  assert.equal(auth.puedeReasignar(p, H('HITO-033'), 'JEF-002').ok, false);
  assert.equal(auth.puedeReasignar(p, H('HITO-094'), 'JEF-007').ok, false); // COL-019 no está en ningún equipo
});

test('Store: acciones dejan bitácora y respetan permisos', () => {
  const st = crearStore(base, { persist: false });
  st.login('JEF-002');
  assert.equal(st.completar('HITO-008').ok, false);
  assert.equal(st.completar('HITO-009').ok, true);
  assert.equal(st.verColaborador('COL-006'), null);
  const acc = st.state.bitacora.map(b => `${b.accion}:${b.resultado}`);
  assert.ok(acc.includes('completar:denegado'));
  assert.ok(acc.includes('completar:ok'));
  assert.ok(acc.includes('acceso_denegado:denegado'));
  assert.equal(st.reasignar('HITO-033', 'TI-003', 'x').ok, false);
  st.login('PER-001');
  assert.equal(st.reasignar('HITO-033', 'TI-003', 'Sin responsable desde la carga').ok, true);
  assert.equal(st.state.data.hitos.find(h => h.hito_id === 'HITO-033').responsable_id, 'TI-003');
});

test('Store: reportes sensibles solo para Personas', () => {
  const st = crearStore(base, { persist: false });
  st.login('COL-002');
  assert.equal(st.reportar('Mi turno cambió', 'me cambiaron el turno').ok, true);
  st.login('JEF-002');
  assert.equal(st.reportesVisibles().length, 0);
  st.login('PER-002');
  assert.equal(st.reportesVisibles().length, 1);
});
