// Avisos a la jefatura: personas sin tareas asignadas, próximos ingresos y nuevos ingresos registrados por RR.HH.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCSV } from '../src/csv.js';
import { crearStore } from '../src/store.js';
import { kitNuevoIngreso } from '../scripts/fixture_nuevo_ingreso.mjs';

const load = f => parseCSV(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const base = () => ({ colaboradores: load('colaboradores.csv'), hitos: load('hitos_onboarding.csv'), usuarios: load('usuarios_roles.csv'), catalogo: load('catalogo_hitos.csv') });
const FICHA = { tarea_1: 'Recepción', tarea_2: 'Inventario', tarea_3: 'Despacho' };

test('Sin tareas: la jefatura recibe un aviso por cada persona de su equipo sin tareas', () => {
  const st = crearStore(base()); st.login('JEF-002');
  const av = st.avisos().filter(a => a.tipo === 'sin_tareas');
  assert.deepEqual(av.map(a => a.colaborador_id).sort(), ['COL-002', 'COL-014', 'COL-026', 'COL-038', 'COL-050']);
  assert.ok(av.every(a => a.responsable.id === 'JEF-002' && a.accion_requerida && a.plazo && a.prioridad));
});

test('Sin tareas: el aviso desaparece al asignar las 3 tareas y cuenta las que faltan', () => {
  const st = crearStore(base()); st.login('JEF-002');
  st.guardarFicha('COL-002', { tarea_1: 'Recepción' });
  assert.equal(st.avisos().find(a => a.colaborador_id === 'COL-002' && a.tipo === 'sin_tareas').titulo, 'Faltan 2 de 3 tareas');
  st.guardarFicha('COL-002', FICHA);
  assert.equal(st.avisos().some(a => a.colaborador_id === 'COL-002' && a.tipo === 'sin_tareas'), false);
});

test('Avisos: cada jefatura ve solo su equipo y no puede marcar avisos ajenos', () => {
  const st = crearStore(base()); st.login('JEF-006');
  assert.equal(st.avisos().some(a => a.colaborador_id === 'COL-002'), false);
  assert.equal(st.marcarAvisoVisto('sin_tareas:COL-002').ok, false);
  st.login('JEF-002');
  assert.equal(st.marcarAvisoVisto('sin_tareas:COL-002').ok, true);
  assert.equal(st.avisos().find(a => a.id === 'sin_tareas:COL-002').visto, true);
  st.login('COL-002');
  assert.deepEqual(st.avisos(), []);
});

test('Próximo ingreso: con una fecha de corte anterior, la jefatura sabe quién llega', () => {
  const st = crearStore(base()); st.login('PER-001'); st.setHoy('2026-10-20');
  st.login('JEF-002');
  const p = st.avisos().find(a => a.tipo === 'proximo_ingreso' && a.colaborador_id === 'COL-038');
  assert.ok(p); assert.equal(p.titulo, 'Ingresa en 5 días');
});

test('Nuevo ingreso: una carga de RR.HH. con una persona nueva avisa a su jefatura', () => {
  const st = crearStore(base()); st.login('PER-001');
  const r = st.cargarArchivos(kitNuevoIngreso());
  assert.equal(r.ok, true); assert.equal(r.nuevos, 1);
  assert.ok(st.state.bitacora.some(e => e.accion === 'nuevo_ingreso' && e.objetivo === 'COL-061'));
  assert.equal(st.alertasFicha().some(a => a.tipo === 'nuevo_ingreso'), false); // no inunda la bandeja de Personas
  assert.equal(st.avisosDeEquipos().nuevos, 1);
  st.login('JEF-002');
  const tipos = st.avisos().filter(a => a.colaborador_id === 'COL-061').map(a => a.tipo).sort();
  assert.deepEqual(tipos, ['nuevo_ingreso', 'proximo_ingreso', 'sin_tareas']);
  st.login('JEF-006');
  assert.equal(st.avisos().some(a => a.colaborador_id === 'COL-061'), false);
});
