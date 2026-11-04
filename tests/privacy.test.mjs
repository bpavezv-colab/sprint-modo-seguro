import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCSV } from '../src/csv.js';
import { crearStore } from '../src/store.js';
import { crearAuth } from '../src/permissions.js';
import { mount } from '../src/ui.js';

const load = f => parseCSV(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const base = {
  colaboradores: load('colaboradores.csv'), hitos: load('hitos_onboarding.csv'),
  usuarios: load('usuarios_roles.csv'), catalogo: load('catalogo_hitos.csv'),
};
const fresh = () => structuredClone(base);

test('Privacidad: limpia la versión anterior y no lee ni guarda datos en el navegador', () => {
  const anterior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map([['sprint-modo-seguro-v1', JSON.stringify({ reportes: [{ texto: 'SECRETO ANTIGUO' }] })], ['otra-app', 'conservar']]);
  let lecturas = 0; let escrituras = 0;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem(k) { lecturas++; return values.get(k); },
    setItem(k, v) { escrituras++; values.set(k, v); },
    removeItem(k) { values.delete(k); },
  } });
  try {
    const st = crearStore(fresh(), { persist: true });
    assert.equal(values.has('sprint-modo-seguro-v1'), false);
    assert.equal(values.get('otra-app'), 'conservar');
    st.login('COL-002');
    st.reportar('No tengo equipo o accesos');
    st.login('PER-001');
    st.reasignar('HITO-033', 'TI-003', 'Motivo solo en memoria', { confirmado: true });
    assert.equal(lecturas, 0);
    assert.equal(escrituras, 0);
    const nueva = crearStore(fresh());
    assert.deepEqual(nueva.state.reportes, []);
    assert.deepEqual(nueva.state.bitacora, []);
    assert.deepEqual(nueva.state.overrides, {});
    assert.equal(nueva.state.user, null);
  } finally {
    if (anterior) Object.defineProperty(globalThis, 'localStorage', anterior);
    else delete globalThis.localStorage;
  }
});

test('Privacidad: no acepta texto libre ni categorías arbitrarias en reportes', () => {
  const st = crearStore(fresh()); st.login('COL-002');
  assert.equal(st.reportar('Otro', 'Mi diagnóstico médico es SECRETO').ok, false);
  assert.equal(st.reportar('SECRETO').ok, false);
  assert.equal(st.state.reportes.length, 0);
  assert.equal(JSON.stringify(st.state.bitacora).includes('SECRETO'), false);
  assert.equal(st.reportar('No tengo equipo o accesos').ok, true);
  assert.equal('texto' in st.misReportes()[0], false);
});

test('Privacidad: devuelve fichas con los campos autorizados para cada rol', () => {
  const st = crearStore(fresh()); st.login('TI-004');
  const ti = st.verColaborador('COL-002');
  assert.equal('canal_contacto' in ti, false);
  assert.equal('jefatura_id' in ti, false);
  st.login('JEF-002');
  assert.equal('canal_contacto' in st.verColaborador('COL-002'), false);
  assert.equal(st.verColaborador('COL-006'), null);
  st.login('COL-002');
  assert.equal(st.verColaborador('COL-002').canal_contacto, 'Correo corporativo');
});

test('Privacidad: Personas ve reportes solo de su alcance y no expone referencias editables', () => {
  const data = fresh();
  data.usuarios.find(u => u.usuario_id === 'PER-001').equipo_asignado = 'COL-014';
  const st = crearStore(data); st.login('COL-002'); st.reportar('No tengo equipo o accesos');
  st.login('PER-001');
  assert.deepEqual(st.reportesVisibles(), []);
  assert.equal(st.cambiarEstadoReporte('REP-001', 'Cerrado').ok, false);
  st.login('PER-002');
  const copia = st.reportesVisibles(); copia[0].estado = 'Cerrado';
  assert.equal(st.reportesVisibles()[0].estado, 'Nuevo');
  assert.equal(st.cambiarEstadoReporte('REP-001', 'SECRETO').ok, false);
});

test('Privacidad: rechaza campos ajenos al diccionario sin incorporarlos ni copiarlos a la bitácora', () => {
  const st = crearStore(fresh()); st.login('PER-001');
  const colaboradores = fresh().colaboradores;
  colaboradores[0].diagnostico = 'SECRETO';
  assert.equal(st.cargarArchivos({ colaboradores }, 'SECRETO').ok, false);
  assert.equal('diagnostico' in st.state.base.colaboradores[0], false);
  assert.equal(JSON.stringify(st.state.bitacora).includes('SECRETO'), false);
});

test('Permisos: un rol desconocido y un colaborador con permiso Sí no obtienen acciones de otros roles', () => {
  const data = fresh(); const c = data.usuarios.find(u => u.usuario_id === 'COL-002');
  c.puede_editar_hitos = 'Sí'; c.puede_asignar_responsables = 'Sí';
  const j = data.usuarios.find(u => u.usuario_id === 'JEF-002');
  const auth = crearAuth(data);
  assert.equal(auth.puedeVerColaborador({ ...j, rol: 'Desconocido' }, 'COL-002'), false);
  assert.equal(auth.puedeReasignar(c, data.hitos[5], 'PER-001').ok, false);
  const manipulado = { ...data.hitos.find(h => h.hito_id === 'HITO-009'), tipo_hito: 'Contrato' };
  assert.equal(auth.puedeCompletar(j, manipulado, '2026-11-04').ok, false);
});

test('Permisos: negar datos personales también oculta el canal a Personas; TI no obtiene nombres con un Sí', () => {
  const data = fresh();
  const p = data.usuarios.find(u => u.usuario_id === 'PER-001'); p.puede_ver_datos_personales = 'No';
  const t = data.usuarios.find(u => u.usuario_id === 'TI-004'); t.puede_ver_datos_personales = 'Sí';
  const auth = crearAuth(data);
  assert.equal(auth.puedeVerCampo(p, 'COL-002', 'canal_contacto'), false);
  assert.equal(auth.puedeVerCampo(t, 'COL-002', 'nombre'), false);
});

test('Privacidad: exportar exige Personas/Admin, filtra alcance y registra los intentos', () => {
  const data = fresh(); data.usuarios.find(u => u.usuario_id === 'PER-001').equipo_asignado = 'COL-014';
  const st = crearStore(data); st.login('TI-004');
  assert.equal(st.exportar('hitos').ok, false);
  st.login('PER-001');
  const r = st.exportar('hitos'); assert.equal(r.ok, true);
  assert.ok(r.filas.length > 0);
  assert.ok(r.filas.every(h => h.colaborador_id === 'COL-014'));
  assert.ok(st.state.bitacora.some(e => e.accion === 'exportar' && e.resultado === 'denegado'));
});

test('Trazabilidad: registra cada acción rechazada sin guardar el contenido enviado', () => {
  const st = crearStore(fresh());
  const intentos = [() => st.login('SECRETO'), () => st.completar('HITO-008'),
    () => st.reportar('SECRETO'), () => st.cambiarEstadoReporte('REP-001', 'SECRETO'),
    () => st.setHoy('2026-11-05'), () => st.cargarArchivos({}, 'SECRETO')];
  for (const intentar of intentos) {
    const antes = st.state.bitacora.length;
    assert.equal(intentar().ok, false);
    assert.equal(st.state.bitacora.length, antes + 1);
    assert.equal(st.state.bitacora[0].resultado, 'denegado');
  }
  assert.equal(JSON.stringify(st.state.bitacora).includes('SECRETO'), false);
});

test('Trazabilidad: registra rechazos de formularios sin códigos ni contenido de archivos', () => {
  const st = crearStore(fresh());
  assert.equal(st.rechazarEntrada('ingreso').ok, false);
  assert.equal(st.rechazarEntrada('carga').ok, false);
  assert.equal(st.state.bitacora.length, 2);
  assert.ok(st.state.bitacora.every(e => e.resultado === 'denegado' && e.objetivo === '—'));
});

test('Reasignación: exige confirmación explícita además del motivo', () => {
  const st = crearStore(fresh()); st.login('PER-001');
  assert.equal(st.reasignar('HITO-033', 'TI-003', 'Caso sin responsable').ok, false);
  assert.equal(st.reasignar('HITO-033', 'TI-003', 'Caso sin responsable', { confirmado: true }).ok, true);
});

function pantalla(st) {
  const anterior = globalThis.document;
  globalThis.document = { addEventListener() {} };
  const root = { innerHTML: '', addEventListener() {} };
  try { mount(root, st); return root.innerHTML; } finally { globalThis.document = anterior; }
}

test('Interfaz: no publica nombres en el selector ni recoge relatos libres', () => {
  const st = crearStore(fresh());
  const login = pantalla(st);
  assert.equal(login.includes('Camila Rojas'), false);
  assert.equal(login.includes('Hugo Personas 01'), false);
  assert.match(login, /simulaci[oó]n/i);
  st.login('COL-002');
  assert.equal(pantalla(st).includes('name="texto"'), false);
  assert.match(pantalla(st), /solo en memoria/i);
});

test('Interfaz: respeta permiso de nombres, métricas y alcance reducido de Personas', () => {
  const data = fresh();
  const j = data.usuarios.find(u => u.usuario_id === 'JEF-002');
  j.puede_ver_datos_personales = 'No'; j.puede_ver_metricas = 'No';
  const p = data.usuarios.find(u => u.usuario_id === 'PER-001');
  p.equipo_asignado = 'COL-014'; p.puede_ver_metricas = 'No';
  const st = crearStore(data); st.login('JEF-002');
  const jefatura = pantalla(st);
  assert.equal(jefatura.includes('Camila Rojas'), false);
  assert.equal(jefatura.includes('class="kpis"'), false);
  st.login('PER-001');
  assert.equal(pantalla(st).includes('class="kpis"'), false);
});

test('Privacidad: un navegador que bloquea el borrado no impide funcionar y se informa', () => {
  const anterior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('bloqueado'); } });
  try {
    const st = crearStore(fresh());
    assert.equal(st.state.almacenamientoLimpio, false);
    assert.match(pantalla(st), /no pudimos borrar/i);
  } finally {
    if (anterior) Object.defineProperty(globalThis, 'localStorage', anterior);
    else delete globalThis.localStorage;
  }
});

test('Interfaz: no aplica una reasignación hasta confirmar y permite cancelarla', async () => {
  const st = crearStore(fresh()); st.login('PER-001');
  const anteriorDoc = globalThis.document; const anteriorForm = globalThis.FormData;
  globalThis.document = { addEventListener() {} };
  globalThis.FormData = class { constructor(f) { this.valores = f.valores; } get(k) { return this.valores[k]; } };
  const handlers = {};
  const root = { innerHTML: '', addEventListener(k, fn) { handlers[k] = fn; } };
  const enviar = async () => {
    const form = { dataset: { form: 'reasignar', arg: 'HITO-033' }, valores: { nuevo: 'TI-003', motivo: 'Responsable no asignado' } };
    await handlers.submit({ target: { closest: () => form }, preventDefault() {} });
  };
  const clic = act => handlers.click({ target: { closest: () => ({ dataset: { act } }) } });
  try {
    mount(root, st); await enviar();
    assert.equal(st.state.idx.hitosPorColab.get('COL-007')[2].responsable_id, null);
    assert.match(root.innerHTML, /role="dialog"/);
    clic('cancel'); assert.equal(st.state.overrides['HITO-033'], undefined);
    await enviar(); clic('confirm-ok');
    assert.equal(st.state.overrides['HITO-033'].responsable_id, 'TI-003');
  } finally { globalThis.document = anteriorDoc; globalThis.FormData = anteriorForm; }
});

test('Interfaz: los identificadores cargados no pueden inyectar HTML', () => {
  const data = fresh(); const id = '<img src=x onerror=SECRETO>';
  data.colaboradores[0].colaborador_id = id;
  data.colaboradores[0].jefatura_id = null;
  data.usuarios.find(u => u.usuario_id === 'PER-001').equipo_asignado = 'Todos los usuarios';
  const st = crearStore(data); st.login('PER-001');
  // Sin métricas, Personas entra directamente a Casos críticos.
  st.state.user.puede_ver_metricas = 'No';
  const html = pantalla(st);
  assert.equal(html.includes(id), false);
  assert.ok(html.includes('&lt;img'));
});
