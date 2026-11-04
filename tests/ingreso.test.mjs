// Una sola entrada: colaboradores y equipo interno ingresan por el mismo formulario y el rol decide la vista.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCSV } from '../src/csv.js';
import { crearStore } from '../src/store.js';
import { mount } from '../src/ui.js';

const load = f => parseCSV(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const base = () => ({ colaboradores: load('colaboradores.csv'), hitos: load('hitos_onboarding.csv'), usuarios: load('usuarios_roles.csv'), catalogo: load('catalogo_hitos.csv') });

function montar() {
  const st = crearStore(base());
  const handlers = {};
  const root = { innerHTML: '', addEventListener(k, fn) { handlers[k] = fn; } };
  globalThis.document = { addEventListener() {} };
  globalThis.FormData = class { constructor(f) { this.v = f.valores; } get(k) { return this.v[k]; } };
  mount(root, st);
  const enviar = (form, valores) => handlers.submit({ preventDefault() {}, target: { closest: () => ({ dataset: { form }, valores }) } });
  const ingresar = async (id, code = '123456') => { await enviar('col-id', { id }); await enviar('col-code', { code }); };
  return { st, root, ingresar, enviar };
}

test('Ingreso único: cada rol entra por el mismo formulario y ve su propia vista', async () => {
  const casos = [['COL-002', 'Colaborador', 'Tu ficha de ingreso'], ['JEF-002', 'Jefatura', 'Fichas de ingreso'], ['TI-004', 'TI', 'Fecha comprometida'], ['PER-001', 'Personas', 'Quién está listo para su primer día']];
  for (const [id, rol, texto] of casos) {
    const { st, root, ingresar } = montar();
    await ingresar(id);
    assert.equal(st.state.user?.usuario_id, id);
    assert.equal(st.state.user.rol, rol);
    assert.ok(root.innerHTML.includes(texto), `${id} debería ver "${texto}"`);
    assert.equal(root.innerHTML.includes('data-form="staff"'), false);
  }
});

test('Ingreso único: código incorrecto o cuenta inexistente no entran y quedan registrados', async () => {
  const a = montar();
  await a.ingresar('JEF-002', '000000');
  assert.equal(a.st.state.user, null);
  assert.equal(a.st.state.bitacora[0].resultado, 'denegado');
  assert.match(a.root.innerHTML, /código no es correcto/i);
  const b = montar();
  await b.ingresar('GER-001');
  assert.equal(b.st.state.user, null);
  assert.match(b.root.innerHTML, /No encontramos una cuenta autorizada/);
});

test('Ingreso único: no revela si la cuenta existe antes de verificar el código', async () => {
  for (const id of ['GER-999', 'JEF-002']) {
    const { root, enviar } = montar();
    await enviar('col-id', { id });
    assert.ok(root.innerHTML.includes('data-form="col-code"'), `${id}: debe pedir el código`);
    assert.equal(root.innerHTML.includes('No encontramos'), false);
  }
});
