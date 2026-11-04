import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCSV } from '../src/csv.js';
import { indexData, evaluarHito, validar, agruparAlertas, HOY_DEFAULT } from '../src/rules.js';
import { crearAuth } from '../src/permissions.js';
import { crearStore } from '../src/store.js';
import { ReglasOnboarding, CONFIG } from '../src/reglas_onboarding.js';

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
const nuevo = () => crearStore(base, { persist: false });
const FICHA_OK = { tarea_1: 'Recepción de mercadería', tarea_2: 'Control de inventario', tarea_3: 'Despacho a tiendas', companero_id: 'COL-014', reunion_at: '2026-11-05T09:30' };

// ---------- Pruebas mínimas del brief ----------

test('1. Flujo principal: jefatura envía, persona confirma, queda "confirmada" con evento', () => {
  const st = nuevo();
  st.login('JEF-002');
  assert.equal(st.guardarFicha('COL-002', { tarea_1: 'Recepción de mercadería' }).estado, 'incompleta');
  const r = st.enviarFicha('COL-002', FICHA_OK);
  assert.equal(r.ok, true);
  assert.equal(st.state.fichas['COL-002'].estado, 'enviada');
  st.login('COL-002');
  assert.equal(st.confirmarFicha().ok, true);
  assert.equal(st.state.fichas['COL-002'].estado, 'confirmada');
  const ev = st.state.eventos.find(e => e.accion === 'confirmar_ficha');
  assert.ok(ev);
  assert.equal(ev.actor_id, 'COL-002');
  assert.equal(ev.valor_anterior, 'enviada');
  assert.equal(ev.valor_nuevo, 'confirmada');
  assert.ok(st.state.eventos.some(e => e.accion === 'enviar_ficha' && e.actor_id === 'JEF-002' && e.resultado === 'ok'));
  assert.equal(st.state.fichas['COL-002'].creado_por_equipo, true);
});

test('1b. Envío bloqueado: el mensaje dice exactamente qué falta', () => {
  const st = nuevo();
  st.login('JEF-002');
  const r = st.enviarFicha('COL-002', { ...FICHA_OK, tarea_3: '  ' });
  assert.equal(r.ok, false);
  assert.deepEqual(r.faltan, ['Falta la tarea 3']);
  assert.notEqual(st.state.fichas['COL-002'].estado, 'enviada');
  assert.ok(st.state.eventos.some(e => e.accion === 'enviar_ficha' && e.resultado === 'rechazado'));
});

test('1c. "Algo no coincide" sin motivo se bloquea; el comentario no lo ve la jefatura', () => {
  const st = nuevo();
  st.login('JEF-002'); st.enviarFicha('COL-002', FICHA_OK);
  st.login('COL-002');
  const sin = st.reportarDiscrepancia('', 'algo');
  assert.equal(sin.ok, false);
  assert.match(sin.motivo, /Elige qué no coincide/);
  assert.equal(st.reportarDiscrepancia('turno', 'Me dijeron turno mañana').ok, true);
  st.login('JEF-002');
  const vj = st.vistaFicha('COL-002');
  assert.equal(vj.estadoVisible, 'En revisión por Personas');
  assert.equal(vj.ficha.comentario, undefined);
  assert.equal(vj.ficha.motivo, undefined);
  st.login('PER-001');
  const vp = st.vistaFicha('COL-002');
  assert.equal(vp.ficha.comentario, 'Me dijeron turno mañana');
  assert.ok(st.state.alertas.some(a => a.tipo === 'discrepancia' && a.colaborador_id === 'COL-002'));
});

test('2. Permiso válido: la jefatura solo ve su equipo', () => {
  const st = nuevo();
  st.login('JEF-002');
  const ids = st.ingresos().map(v => v.c.colaborador_id).sort();
  assert.deepEqual(ids, ['COL-002', 'COL-014', 'COL-026', 'COL-038', 'COL-050']);
  assert.equal(st.entrar('/ficha', 'COL-006').status, 403);
  assert.equal(st.guardarFicha('COL-006', { tarea_1: 'x' }).ok, false);
  assert.equal(st.vistaFicha('COL-002').c.canal_contacto, undefined); // la jefatura no ve el canal
});

test('3. No autorizado: un colaborador que pide la ficha de otro recibe 403', () => {
  const st = nuevo();
  st.login('COL-002');
  const r = st.entrar('/ficha', 'COL-014');
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
  assert.equal(st.vistaFicha('COL-014'), null);
  assert.equal(st.entrar('/personas').status, 403);
  assert.equal(st.entrar('/ficha', 'COL-002').ok, true);
  assert.ok(st.state.eventos.some(e => e.accion === 'acceso_denegado' && e.entidad_id === 'COL-014' && e.resultado === 'denegado'));
  // TI tampoco ve fichas
  st.login('TI-004');
  assert.equal(st.entrar('/ficha', 'COL-002').status, 403);
});

test('4. Dato faltante: sin jefatura o sin fecha genera "Sin dato" y no se inventa nada', () => {
  const st = nuevo();
  const a = st.state.alertas.find(x => x.id === 'sin_dato:COL-019:jefatura_id');
  assert.ok(a, 'alerta de jefatura faltante');
  assert.equal(a.titulo, 'Sin dato: jefatura');
  assert.ok(a.responsable && a.accion_requerida && a.plazo && a.prioridad);
  assert.equal(st.state.idx.colab.get('COL-019').jefatura_id, null);
  assert.ok(st.state.alertas.some(x => x.id === 'sin_dato:COL-048:tipo_turno'));
  // Sin fecha de ingreso ni fecha del hito: "No se puede calcular plazo" y la fecha queda vacía
  const b2 = structuredClone(base);
  b2.colaboradores.find(c => c.colaborador_id === 'COL-003').fecha_ingreso = null;
  b2.hitos.find(h => h.hito_id === 'HITO-013').fecha_limite = null;
  const st2 = crearStore(b2, { persist: false });
  assert.ok(st2.state.alertas.some(x => x.id === 'sin_dato:COL-003:fecha_ingreso'));
  const sp = st2.state.alertas.find(x => x.tipo === 'sin_plazo' && x.hito_id === 'HITO-013');
  assert.ok(sp);
  assert.equal(sp.titulo, 'No se puede calcular plazo: falta fecha');
  assert.equal(st2.state.reglas.fechaLimite(st2.state.data.hitos.find(h => h.hito_id === 'HITO-013')).fecha, null);
});

test('5. Hito atrasado: alerta con responsable, acción, plazo y prioridad', () => {
  const st = nuevo();
  const a = st.state.alertas.find(x => x.id === 'hito_atrasado:HITO-001');
  assert.ok(a);
  assert.equal(a.responsable.id, 'PER-001');
  assert.equal(a.accion_requerida, 'Gestionar la firma del contrato');
  assert.equal(a.plazo, '2026-09-04');
  assert.equal(a.prioridad, 'Urgente'); // Alta del catálogo + ingreso a 2 días o menos (ya ocurrió)
  // Responsable vacío: se toma del catálogo y se marca "asignado por regla"
  const r = st.state.reglas.responsable(H('HITO-033'));
  assert.equal(r.origen, 'regla');
  assert.equal(r.tipo, 'TI');
  assert.ok(st.state.alertas.every(x => x.responsable && x.accion_requerida && x.plazo && x.prioridad));
});

test('6. Reglas parametrizables: cambiar CONFIG cambia el resultado sin tocar la interfaz', () => {
  const R1 = new ReglasOnboarding({ idx, hoy: HOY_DEFAULT });
  const R2 = new ReglasOnboarding({ idx, hoy: HOY_DEFAULT, config: { ...CONFIG, fuentePlazo: 'catalogo' } });
  assert.equal(R1.atrasado(H('HITO-003')), false); // fecha del hito 2026-11-08: en plazo
  assert.equal(R2.atrasado(H('HITO-003')), true);  // regla del catálogo: venció el 2026-09-04
  assert.equal(base.hitos.filter(h => R1.atrasado(h)).length, 35);
  // Prioridad: sube un nivel solo si faltan 2 días o menos
  const R3 = new ReglasOnboarding({ idx, hoy: '2026-08-01' });
  assert.equal(R3.prioridadHito(H('HITO-001')), 'Alta');
});

// ---------- Reglas y permisos heredados ----------

test('CSV: vacíos son null, no "No" ni "Pendiente"', () => {
  assert.equal(base.colaboradores.find(x => x.colaborador_id === 'COL-019').jefatura_id, null);
  assert.equal(base.colaboradores.find(x => x.colaborador_id === 'COL-056').estado_onboarding, null);
  assert.equal(base.hitos.length, 300);
});

test('Calidad: cumplido sin fecha o con fecha futura queda "Por verificar"', () => {
  assert.equal(evaluarHito(H('HITO-050'), idx, HOY_DEFAULT).estadoReal, 'Por verificar');
  const g = Object.fromEntries(agruparAlertas(validar(base, idx, HOY_DEFAULT)).map(x => [x.regla, x.items.length]));
  assert.equal(g.responsable_vacio, 7);
  assert.equal(g.jefatura_vacia, 1);
});

test('Permisos: TI ve solo hitos técnicos, sin nombre ni canal', () => {
  const t = U('TI-004');
  assert.ok(auth.puedeVerHito(t, H('HITO-008')));
  assert.ok(!auth.puedeVerHito(t, H('HITO-009')));
  assert.ok(!auth.puedeVerCampo(t, 'COL-002', 'nombre'));
  assert.ok(!auth.puedeVerCampo(t, 'COL-002', 'canal_contacto'));
  assert.equal(auth.puedeGestionarTecnico(t, H('HITO-008')).ok, true);
  assert.equal(auth.puedeGestionarTecnico(U('TI-001'), H('HITO-008')).ok, false);
  assert.equal(auth.puedeGestionarTecnico(U('TI-001'), H('HITO-033')).ok, true); // sin cuenta: asignado por regla a TI
});

test('TI: pendiente exige fecha comprometida; listo registra evento', () => {
  const st = nuevo();
  st.login('TI-004');
  assert.equal(st.marcarPendiente('HITO-008', '').ok, false);
  assert.equal(st.marcarPendiente('HITO-008', '2026-11-10').ok, true);
  assert.equal(st.state.data.hitos.find(h => h.hito_id === 'HITO-008').fecha_comprometida, '2026-11-10');
  assert.equal(st.marcarListo('HITO-008').ok, true);
  assert.equal(st.marcarListo('HITO-009').ok, false); // Reunión: no es técnico
  assert.ok(st.state.eventos.some(e => e.accion === 'marcar_listo' && e.entidad_id === 'HITO-008'));
  const casos = st.casosTI();
  assert.ok(casos.every(x => ['Equipo', 'Acceso'].includes(x.h.tipo_hito)));
  assert.ok(casos.every(x => !('nombre' in x.c) && !('canal_contacto' in x.c)));
});

test('Personas: reasigna con motivo, escala y marca contactado con evento', () => {
  const st = nuevo();
  st.login('JEF-002');
  assert.equal(st.reasignar('HITO-033', 'TI-003', 'Sin responsable desde la carga').ok, false);
  st.login('PER-001');
  assert.equal(st.reasignar('HITO-033', 'TI-003', 'x').ok, false);
  assert.equal(st.reasignar('HITO-033', 'TI-003', 'Sin responsable desde la carga').ok, true);
  assert.equal(st.state.data.hitos.find(h => h.hito_id === 'HITO-033').responsable_id, 'TI-003');
  const r = st.gestionarAlerta('hito_atrasado:HITO-001', 'escalada');
  assert.equal(r.ok, true);
  assert.match(r.aviso, /Se notificaría/);
  assert.equal(st.state.alertas.find(a => a.id === 'hito_atrasado:HITO-001').estado, 'escalada');
  assert.equal(st.gestionarAlerta('sin_dato:COL-019:jefatura_id', 'contactado').ok, true);
  st.login('COL-002');
  assert.equal(st.gestionarAlerta('sin_dato:COL-019:jefatura_id', 'escalada').ok, false);
});

test('Indicadores: % confirmadas antes del día 1 y discrepancias por motivo', () => {
  const st = nuevo();
  st.login('PER-001'); st.setHoy('2026-10-20'); // simula ingresos próximos
  st.login('JEF-002'); st.enviarFicha('COL-050', { ...FICHA_OK, companero_id: 'COL-002' }); // COL-050 ya ingresó (2026-10-01); COL-038 ingresa el 2026-10-25
  st.enviarFicha('COL-038', { ...FICHA_OK, companero_id: 'COL-002' });
  st.login('COL-038'); st.confirmarFicha();
  st.login('COL-050'); st.reportarDiscrepancia('tareas', '');
  st.login('PER-001');
  const k = st.indicadores();
  assert.equal(k.enviadas, 2);
  assert.equal(k.confirmadasAntesDia1, 1);
  assert.equal(k.pctAntesDia1, 50);
  assert.equal(k.porMotivo.tareas, 1);
  assert.ok(k.atrasadosPorResponsable.length > 0);
});
