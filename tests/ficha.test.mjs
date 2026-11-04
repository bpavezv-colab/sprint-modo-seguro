// Pruebas mínimas del brief (sección 15) aplicadas a la Ficha de Ingreso.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCSV } from '../src/csv.js';
import { indexData, HOY_DEFAULT } from '../src/rules.js';
import { crearStore } from '../src/store.js';
import { ReglasOnboarding, CONFIG } from '../src/reglas_onboarding.js';

const load = f => parseCSV(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const base = { colaboradores: load('colaboradores.csv'), hitos: load('hitos_onboarding.csv'), usuarios: load('usuarios_roles.csv'), catalogo: load('catalogo_hitos.csv') };
const idx = indexData(base);
const H = id => base.hitos.find(h => h.hito_id === id);
const nuevo = () => crearStore(base);
const FICHA = { tarea_1: 'Recepción de mercadería', tarea_2: 'Control de inventario', tarea_3: 'Despacho a tiendas', companero_id: 'COL-014', reunion_at: '2026-11-05T09:30' };
const alerta = (st, id) => st.state.alertasFicha.find(a => a.id === id);

test('1. Flujo principal: jefatura envía, persona confirma, queda "confirmada" con evento', () => {
  const st = nuevo();
  st.login('JEF-002');
  assert.equal(st.guardarFicha('COL-002', { tarea_1: 'Recepción' }).estado, 'incompleta');
  assert.equal(st.enviarFicha('COL-002', FICHA).ok, true);
  assert.equal(st.state.fichas['COL-002'].estado, 'enviada');
  st.login('COL-002');
  assert.equal(st.confirmarFicha().ok, true);
  assert.equal(st.state.fichas['COL-002'].estado, 'confirmada');
  const ev = st.state.bitacora.find(e => e.accion === 'confirmar_ficha');
  assert.equal(ev.usuario, 'COL-002');
  assert.equal(ev.valor_anterior, 'enviada');
  assert.equal(ev.valor_nuevo, 'confirmada');
  assert.equal(st.state.fichas['COL-002'].creado_por_equipo, true);
});

test('1b. Envío bloqueado: el mensaje dice exactamente qué falta', () => {
  const st = nuevo(); st.login('JEF-002');
  const r = st.enviarFicha('COL-002', { ...FICHA, tarea_3: '  ' });
  assert.equal(r.ok, false);
  assert.deepEqual(r.faltan, ['Falta la tarea 3']);
  assert.notEqual(st.state.fichas['COL-002'].estado, 'enviada');
});

test('1c. "Algo no coincide": sin motivo se bloquea, sin texto libre, la jefatura solo ve "En revisión"', () => {
  const st = nuevo();
  st.login('JEF-002'); st.enviarFicha('COL-002', FICHA);
  st.login('COL-002');
  assert.match(st.reportarDiscrepancia('').motivo, /Elige qué no coincide/);
  assert.equal(st.reportarDiscrepancia('turno', 'me cambiaron').ok, false);
  assert.equal(st.reportarDiscrepancia('turno').ok, true);
  st.login('JEF-002');
  const vj = st.vistaFicha('COL-002');
  assert.equal(vj.estadoVisible, 'En revisión por Personas');
  assert.equal(vj.ficha.motivo, undefined);
  assert.equal(st.reportesVisibles().length, 0);
  st.login('PER-001');
  assert.equal(st.vistaFicha('COL-002').ficha.motivo, 'turno');
  assert.ok(alerta(st, 'discrepancia:COL-002'));
  assert.equal(st.reportesVisibles()[0].tipo, 'Mi turno cambió o no lo conozco');
});

test('2. Permiso válido: la jefatura solo ve su equipo', () => {
  const st = nuevo(); st.login('JEF-002');
  assert.deepEqual(st.ingresos().map(v => v.c.colaborador_id).sort(), ['COL-002', 'COL-014', 'COL-026', 'COL-038', 'COL-050']);
  assert.equal(st.entrar('/ficha', 'COL-006').status, 403);
  assert.equal(st.guardarFicha('COL-006', { tarea_1: 'x' }).ok, false);
  assert.equal(st.vistaFicha('COL-002').c.canal_contacto, undefined);
});

test('3. No autorizado: un colaborador que pide la ficha de otro recibe 403', () => {
  const st = nuevo(); st.login('COL-002');
  assert.equal(st.entrar('/ficha', 'COL-014').status, 403);
  assert.equal(st.vistaFicha('COL-014'), null);
  assert.equal(st.entrar('/ficha', 'COL-002').ok, true);
  assert.ok(st.state.bitacora.some(e => e.accion === 'acceso_denegado' && e.resultado === 'denegado'));
  st.login('TI-004');
  assert.equal(st.entrar('/ficha', 'COL-002').status, 403);
});

test('4. Dato faltante: "Sin dato" con alerta y sin inventar valores', () => {
  const st = nuevo();
  const a = alerta(st, 'sin_dato:COL-019:jefatura_id');
  assert.equal(a.titulo, 'Sin dato: jefatura');
  assert.ok(a.responsable && a.accion_requerida && a.plazo && a.prioridad);
  assert.equal(st.state.idx.colab.get('COL-019').jefatura_id, null);
  const b2 = structuredClone(base);
  b2.colaboradores.find(c => c.colaborador_id === 'COL-003').fecha_ingreso = null;
  b2.hitos.find(h => h.hito_id === 'HITO-013').fecha_limite = null;
  const st2 = crearStore(b2);
  assert.ok(alerta(st2, 'sin_dato:COL-003:fecha_ingreso'));
  assert.equal(alerta(st2, 'sin_plazo:HITO-013').titulo, 'No se puede calcular plazo: falta fecha');
  assert.equal(st2.state.reglas.fechaLimite(st2.state.data.hitos.find(h => h.hito_id === 'HITO-013')).fecha, null);
});

test('5. Hito atrasado: alerta con responsable, acción, plazo y prioridad', () => {
  const st = nuevo();
  const a = alerta(st, 'hito_atrasado:HITO-001');
  assert.equal(a.responsable.id, 'PER-001');
  assert.equal(a.accion_requerida, 'Gestionar la firma del contrato');
  assert.equal(a.plazo, '2026-09-04');
  assert.equal(a.prioridad, 'Urgente');
  assert.equal(st.state.reglas.responsable(H('HITO-033')).origen, 'regla');
  assert.ok(st.state.alertasFicha.every(x => x.responsable && x.accion_requerida && x.plazo && x.prioridad));
});

test('6. Reglas parametrizables: cambiar CONFIG cambia el resultado sin tocar la interfaz', () => {
  const R1 = new ReglasOnboarding({ idx, hoy: HOY_DEFAULT });
  const R2 = new ReglasOnboarding({ idx, hoy: HOY_DEFAULT, config: { ...CONFIG, fuentePlazo: 'catalogo' } });
  assert.equal(R1.atrasado(H('HITO-003')), false);
  assert.equal(R2.atrasado(H('HITO-003')), true);
  assert.equal(new ReglasOnboarding({ idx, hoy: '2026-08-01' }).prioridadHito(H('HITO-001')), 'Alta');
});

test('TI: pendiente exige fecha comprometida; solo hitos técnicos con datos mínimos', () => {
  const st = nuevo(); st.login('TI-004');
  assert.equal(st.marcarPendiente('HITO-008', '').ok, false);
  assert.equal(st.marcarPendiente('HITO-008', '2026-11-10').ok, true);
  assert.equal(st.marcarListo('HITO-009').ok, false);
  assert.equal(st.marcarListo('HITO-008').ok, true);
  const casos = st.casosTI();
  assert.ok(casos.every(x => ['Equipo', 'Acceso'].includes(x.h.tipo_hito) && !('nombre' in x.c) && !('canal_contacto' in x.c)));
});

test('Personas: escala y marca contactado; otros roles no pueden', () => {
  const st = nuevo(); st.login('PER-001');
  const r = st.gestionarAlerta('hito_atrasado:HITO-001', 'escalada');
  assert.equal(r.ok, true); assert.match(r.aviso, /Se notificaría/);
  assert.equal(alerta(st, 'hito_atrasado:HITO-001').estado, 'escalada');
  st.login('JEF-002');
  assert.equal(st.gestionarAlerta('sin_dato:COL-019:jefatura_id', 'contactado').ok, false);
});

test('Indicadores: % confirmadas antes del día 1 y discrepancias por motivo', () => {
  const st = nuevo();
  st.login('PER-001'); st.setHoy('2026-10-20');
  st.login('JEF-002'); st.enviarFicha('COL-038', { ...FICHA, companero_id: 'COL-002' }); st.enviarFicha('COL-050', { ...FICHA, companero_id: 'COL-002' });
  st.login('COL-038'); st.confirmarFicha();
  st.login('COL-050'); st.reportarDiscrepancia('tareas');
  st.login('PER-001');
  const k = st.indicadores();
  assert.equal(k.enviadas, 2); assert.equal(k.confirmadasAntesDia1, 1); assert.equal(k.pctAntesDia1, 50); assert.equal(k.porMotivo.tareas, 1);
});

test('Turno cambiado: si RR.HH. carga un turno distinto después de enviar la ficha, la persona debe reconfirmar', () => {
  const st = nuevo();
  st.login('JEF-002'); st.enviarFicha('COL-002', FICHA);
  st.login('COL-002'); st.confirmarFicha();
  st.login('PER-001');
  const cols = structuredClone(base.colaboradores); cols.find(c => c.colaborador_id === 'COL-002').tipo_turno = 'Turno tarde';
  const r = st.cargarArchivos({ colaboradores: cols });
  assert.equal(r.ok, true); assert.equal(r.reconfirmar, 1);
  assert.equal(st.state.fichas['COL-002'].estado, 'requiere_reconfirmacion');
  assert.equal(st.state.fichas['COL-002'].turno_anterior, 'Jornada parcial');
  assert.ok(alerta(st, 'reconfirmacion:COL-002'));
  st.login('COL-002');
  assert.equal(st.confirmarFicha().ok, true);
  assert.equal(st.state.fichas['COL-002'].estado, 'confirmada');
  st.login('PER-001');
  assert.equal(st.cargarArchivos({ colaboradores: cols }).reconfirmar, 0);
});
