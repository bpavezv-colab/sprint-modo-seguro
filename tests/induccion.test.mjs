// Asistencia a la inducción: citación, entrada y salida, inasistencia, reprogramación, permisos e indicador.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCSV } from '../src/csv.js';
import { crearStore } from '../src/store.js';
import { estadoInduccion } from '../src/induccion.js';

const load = f => parseCSV(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const base = () => ({ colaboradores: load('colaboradores.csv'), hitos: load('hitos_onboarding.csv'), usuarios: load('usuarios_roles.csv'), catalogo: load('catalogo_hitos.csv') });
const HOY = '2026-11-04';
const alerta = (st, id) => st.state.alertasFicha.find(a => a.id === id);
function citado(id = 'COL-002') { const st = crearStore(base()); st.login('PER-001'); assert.equal(st.citarInduccion(id, HOY, '09:00', '13:00').ok, true); return st; }

test('Estado: completa, parcial por llegar tarde o salir antes, y sin suponer asistencia', () => {
  const r = { fecha: HOY, inicio: '09:00', fin: '13:00' };
  assert.equal(estadoInduccion({ ...r, entrada: '09:10', salida: '13:00' }, HOY).estado, 'completa');
  assert.equal(estadoInduccion({ ...r, entrada: '09:40', salida: '13:00' }, HOY).estado, 'parcial');
  assert.equal(estadoInduccion({ ...r, entrada: '09:00', salida: '11:30' }, HOY).estado, 'parcial');
  assert.equal(estadoInduccion(r, '2026-11-05').estado, 'por_registrar');
  assert.equal(estadoInduccion(null, HOY).estado, 'sin_citar');
});

test('Flujo: Personas cita, la persona confirma y Personas registra entrada y salida', () => {
  const st = citado();
  st.login('COL-002');
  assert.equal(st.vistaInduccion('COL-002').estado, 'citada');
  assert.equal(st.confirmarInduccion().ok, true);
  assert.equal(st.vistaInduccion('COL-002').estado, 'confirmada');
  st.login('PER-001');
  assert.equal(st.registrarAsistencia('COL-002', '09:05', '13:00').estado, 'completa');
  const ev = st.state.bitacora.find(e => e.accion === 'registrar_asistencia');
  assert.equal(ev.valor_nuevo, '09:05–13:00');
});

test('Inasistencia o parcial: alerta a Personas y aviso a la jefatura, sin mostrarle las horas', () => {
  const st = citado();
  st.registrarAsistencia('COL-002', '09:40', '13:00');
  assert.match(alerta(st, 'induccion_no_asistio:COL-002').titulo, /llegó 40 min tarde/);
  st.marcarInasistencia('COL-002');
  assert.equal(alerta(st, 'induccion_no_asistio:COL-002').titulo, 'No asistió a la inducción');
  assert.equal(st.alertasFicha().some(a => a.tipo === 'induccion_jefatura'), false);
  st.login('JEF-002');
  assert.ok(st.avisos().some(a => a.tipo === 'induccion_jefatura' && a.colaborador_id === 'COL-002'));
  const v = st.vistaInduccion('COL-002');
  assert.equal(v.estado, 'no_asistio'); assert.equal(v.entrada, undefined); assert.equal(v.motivo, undefined);
});

test('Reprogramación: la persona elige un motivo cerrado; Personas lo ve y la jefatura no', () => {
  const st = citado(); st.login('COL-002');
  assert.equal(st.pedirReprogramacion('').ok, false);
  assert.equal(st.pedirReprogramacion('turno').ok, true);
  st.login('PER-001');
  assert.equal(st.vistaInduccion('COL-002').motivo, 'turno');
  assert.equal(alerta(st, 'induccion_reprogramar:COL-002').titulo, 'Pidió otro horario: Choca con mi turno');
  st.login('JEF-002');
  assert.equal(st.vistaInduccion('COL-002').motivo, undefined);
  st.login('PER-001');
  assert.equal(st.citarInduccion('COL-002', '2026-11-06', '15:00', '19:00').ok, true);
  assert.equal(st.vistaInduccion('COL-002').previas, 1);
  assert.equal(alerta(st, 'induccion_reprogramar:COL-002'), undefined);
});

test('Validaciones: fechas y horas inválidas, sesiones futuras y roles sin permiso', () => {
  const st = crearStore(base()); st.login('PER-001');
  assert.equal(st.citarInduccion('COL-002', '2026-11-01', '09:00', '13:00').ok, false);
  assert.equal(st.citarInduccion('COL-002', HOY, '13:00', '09:00').ok, false);
  assert.equal(st.citarInduccion('COL-002', HOY, '9am', '13:00').ok, false);
  st.citarInduccion('COL-002', '2026-11-10', '09:00', '13:00');
  assert.equal(st.registrarAsistencia('COL-002', '09:00', '13:00').ok, false);
  st.login('JEF-002');
  assert.equal(st.citarInduccion('COL-014', HOY, '09:00', '13:00').ok, false);
  assert.equal(st.registrarAsistencia('COL-002', '09:00', '13:00').ok, false);
  st.login('COL-014');
  assert.equal(st.vistaInduccion('COL-002'), null);
  assert.equal(st.citarInduccion('COL-014', HOY, '09:00', '13:00').ok, false);
  st.login('TI-004');
  assert.equal(st.vistaInduccion('COL-002'), null);
  assert.deepEqual(st.induccionesEquipo(), []);
});

test('Sin registro: si la sesión pasó y nadie registró, queda "por registrar" con alerta', () => {
  const st = citado(); st.setHoy('2026-11-05');
  assert.equal(st.vistaInduccion('COL-002').estado, 'por_registrar');
  assert.ok(alerta(st, 'induccion_por_registrar:COL-002'));
});

test('Indicador: asistencia y sesiones completas vs línea base 91%', () => {
  const st = crearStore(base()); st.login('PER-001');
  assert.equal(st.citarVarios(['COL-002', 'COL-014', 'COL-026', 'COL-038'], HOY, '09:00', '13:00').citadas, 4);
  st.registrarAsistencia('COL-002', '09:00', '13:00');
  st.registrarAsistencia('COL-014', '09:00', '12:00');
  st.marcarInasistencia('COL-026');
  const k = st.indicadorInduccion();
  assert.equal(k.registradas, 3); assert.equal(k.pctAsistencia, 67); assert.equal(k.pctCompleta, 33);
  assert.equal(k.lineaBase, 91); assert.equal(k.citadas, 4);
});
