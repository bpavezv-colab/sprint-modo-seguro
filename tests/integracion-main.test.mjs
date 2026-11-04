import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCSV } from '../src/csv.js';
import { crearStore } from '../src/store.js';
import { mount } from '../src/ui.js';
import { kitNuevoIngreso } from '../scripts/fixture_nuevo_ingreso.mjs';

const load = f => parseCSV(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const base = () => ({ colaboradores: load('colaboradores.csv'), hitos: load('hitos_onboarding.csv'), usuarios: load('usuarios_roles.csv'), catalogo: load('catalogo_hitos.csv') });

test('Integración main: ingreso único, avisos y planificación conviven en la vista de jefatura', async () => {
  const st = crearStore(base()); const handlers = {};
  const beforeDoc = globalThis.document; const beforeForm = globalThis.FormData;
  globalThis.document = { addEventListener() {} };
  globalThis.FormData = class { constructor(f) { this.v = f.values; } get(k) { return this.v[k] ?? null; } };
  const root = { innerHTML: '', addEventListener(k, fn) { handlers[k] = fn; } };
  const submit = (form, values) => handlers.submit({ preventDefault() {}, target: { closest: () => ({ dataset: { form }, values }) } });
  try {
    mount(root, st);
    assert.match(root.innerHTML, /Una sola entrada para todo Nexo/);
    assert.equal(root.innerHTML.includes('data-form="staff"'), false);
    await submit('col-id', { id: 'JEF-002' }); await submit('col-code', { code: '123456' });
    assert.equal(st.state.user.usuario_id, 'JEF-002');
    assert.match(root.innerHTML, /class="tn-avisos on"/);
    assert.match(root.innerHTML, /id="avisos"/);
    assert.match(root.innerHTML, /Planificación Inteligente de Turnos/);
    assert.match(root.innerHTML, /data-act="aviso-ficha"/);
    const aviso = st.avisos().find(a => !a.visto);
    handlers.click({ target: { closest: () => ({ dataset: { act: 'aviso-visto', arg: aviso.id } }) } });
    assert.equal(st.avisos().find(a => a.id === aviso.id).visto, true);
    assert.match(root.innerHTML, /Planificación Inteligente de Turnos/);
  } finally { globalThis.document = beforeDoc; globalThis.FormData = beforeForm; }
});

test('Integración main: la carga de RR.HH. mantiene avisos y elimina escenarios desactualizados', () => {
  const st = crearStore(base()); st.login('JEF-002');
  assert.equal(st.prepararTurnos('2026-11-16', { validated: true }).ok, true);
  st.login('PER-001'); const carga = st.cargarArchivos(kitNuevoIngreso());
  assert.equal(carga.ok, true); assert.equal(carga.nuevos, 1);
  assert.equal(st.avisosDeEquipos().nuevos, 1);
  st.login('JEF-002'); assert.equal(st.planTurnos('2026-11-16'), null);
  assert.ok(st.avisos().some(a => a.colaborador_id === 'COL-061' && a.tipo === 'nuevo_ingreso'));
  st.prepararTurnos('2026-11-16', { validated: true });
  assert.ok(st.planTurnos('2026-11-16').model.workers.some(w => w.id === 'COL-061'));
});
