import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCSV } from '../src/csv.js';
import { crearStore, sanearGuardado } from '../src/store.js';
import { indexData, validar, evaluarHito, HOY_DEFAULT } from '../src/rules.js';
import { crearAuth } from '../src/permissions.js';

const load = f => parseCSV(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const base = () => ({ colaboradores: load('colaboradores.csv'), hitos: load('hitos_onboarding.csv'), usuarios: load('usuarios_roles.csv'), catalogo: load('catalogo_hitos.csv') });
const cuenta = (id, rol, equipo = 'Todos los usuarios') => ({ usuario_id: id, nombre_ficticio: 'X', rol, area: 'Personas', equipo_asignado: equipo, puede_ver_datos_personales: 'Sí', puede_editar_hitos: 'Sí', puede_asignar_responsables: 'Sí', puede_ver_metricas: 'Sí' });

test('Rol desconocido: sin alcance y sin ingreso (denegar por defecto)', () => {
  const b = base(); b.usuarios.push(cuenta('GER-001', 'Gerente'));
  const auth = crearAuth(b);
  assert.equal(auth.scope(auth.users.get('GER-001')).size, 0);
  const st = crearStore(b, { persist: false });
  assert.equal(st.login('GER-001').ok, false);
  assert.equal(st.state.bitacora[0].resultado, 'denegado');
});

test('Rol que no calza con el ID (COL con rol Personas) queda bloqueado', () => {
  const b = base(); b.usuarios.find(u => u.usuario_id === 'COL-002').rol = 'Personas';
  const st = crearStore(b, { persist: false });
  assert.equal(st.login('COL-002').ok, false);
  assert.ok(st.state.alertas.some(a => a.regla === 'rol_invalido'));
});

test('Colaborador no entra por el acceso interno', () => {
  const st = crearStore(base(), { persist: false });
  assert.equal(st.login('COL-002', 'x', { soloInterno: true }).ok, false);
});

test('Fecha de corte inválida se rechaza', () => {
  const st = crearStore(base(), { persist: false }); st.login('PER-001');
  assert.equal(st.setHoy('31-12-2026').ok, false);
  assert.equal(st.setHoy('2026-02-30').ok, false);
  assert.equal(st.state.hoy, HOY_DEFAULT);
});

test('Estado de reporte fuera de dominio se rechaza', () => {
  const st = crearStore(base(), { persist: false });
  st.login('COL-002'); st.reportar('x', 'y'); st.login('PER-001');
  assert.equal(st.cambiarEstadoReporte('REP-001', '<b>x</b>').ok, false);
  assert.equal(st.state.reportes[0].estado, 'Nuevo');
});

test('Acciones sin sesión o sobre hitos inexistentes no lanzan excepción', () => {
  const st = crearStore(base(), { persist: false });
  assert.equal(st.completar('HITO-009').ok, false);
  assert.equal(st.reasignar('HITO-009', 'JEF-002', 'motivo válido').ok, false);
  assert.equal(st.reportar('x').ok, false);
  st.login('JEF-002');
  assert.equal(st.completar('HITO-999').ok, false);
});

test('Datos rotos no rompen el motor: vacíos, estados raros, fechas inválidas', () => {
  const b = base();
  b.colaboradores[0].fecha_ingreso = null; b.colaboradores[1].fecha_ingreso = '07/09/2026';
  b.hitos[0].estado = 'Hecho'; b.hitos[2].fecha_limite = null; b.usuarios[0].nombre_ficticio = null;
  const st = crearStore(b, { persist: false });
  const reglas = new Set(st.state.alertas.map(a => a.regla));
  assert.ok(reglas.has('fecha_invalida'));
  assert.ok(reglas.has('valor_fuera_dominio'));
  assert.equal(evaluarHito(b.hitos[0], st.state.idx, HOY_DEFAULT).estadoReal, 'Por verificar');
  assert.ok(st.login('COL-001').ok);
});

test('Carga con errores bloqueantes se rechaza completa y no cambia los datos', () => {
  const st = crearStore(base(), { persist: false }); st.login('PER-001');
  const malos = base().hitos; malos[1].hito_id = '"><img src=x onerror=alert(1)>'; malos[2].hito_id = malos[3].hito_id;
  const r = st.cargarArchivos({ hitos: malos }, 'prueba');
  assert.equal(r.ok, false);
  assert.ok(r.errores.some(e => e.regla === 'formato_id'));
  assert.ok(r.errores.some(e => e.regla === 'id_duplicado'));
  assert.equal(st.state.data.hitos[1].hito_id, 'HITO-002');
});

test('Carga válida que elimina la cuenta en uso cierra la sesión', () => {
  const st = crearStore(base(), { persist: false }); st.login('PER-001');
  const us = base().usuarios.filter(u => u.usuario_id !== 'PER-001');
  const r = st.cargarArchivos({ usuarios: us }, 'sin PER-001');
  assert.equal(r.ok, true); assert.equal(r.sesionCerrada, true); assert.equal(st.state.user, null);
});

test('Estado guardado corrupto se sanea sin romper la app', () => {
  const b = base();
  const s1 = sanearGuardado('no soy un objeto', b); assert.equal(s1.descartado, true);
  const s2 = sanearGuardado({ hoy: 'ayer', overrides: { 'HITO-999': { estado: 'Cumplido' }, 'HITO-001': { estado: 'Cumplido', hack: 1 } }, bitacora: 'x', reportes: [{ id: 1 }] }, b);
  assert.equal(s2.hoy, HOY_DEFAULT);
  assert.deepEqual(Object.keys(s2.overrides), ['HITO-001']);
  assert.equal('hack' in s2.overrides['HITO-001'], false);
  assert.deepEqual(s2.bitacora, []); assert.deepEqual(s2.reportes, []);
});

test('Dataset vacío no lanza excepción', () => {
  const st = crearStore({ colaboradores: [], hitos: [], usuarios: [], catalogo: [] }, { persist: false });
  assert.equal(st.state.alertas.length, 0);
  assert.equal(st.login('PER-001').ok, false);
});

test('Validación de catálogo e identificadores', () => {
  const b = base(); b.catalogo[0].plazo_ficticio = 'Cuando se pueda'; b.colaboradores[0].jefatura_id = 'JEFE-1';
  const al = validar(b, indexData(b), HOY_DEFAULT);
  assert.ok(al.some(a => a.regla === 'catalogo_invalido'));
  assert.ok(al.some(a => a.regla === 'formato_id' && a.id === 'COL-001'));
});
