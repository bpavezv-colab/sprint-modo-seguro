import { escenarioDemo, DEMO_SETTINGS } from './demo.js';
import { esLunes, validarModelo, slotKey } from './model.js';
import { validarSolucion } from './constraints.js';
import { ORDEN_DEFAULT, ordenValido } from './objectives.js';
import { optimizarALNS } from './alns.js';
import { diffDays } from '../rules.js';

export const MOTIVOS_EXCEPCION = ['Ajuste operativo', 'Corrección de requerimientos', 'Contingencia de cobertura'];

export function crearPlanificador({ state, log, denegar }) {
  const plans = new Map(); let serial = 0; const key = (owner, week) => `${owner}|${week}`;
  const registrar = (accion, p, detalle) => log(accion, '—', `Semana ${p.week} · jefatura ${p.ownerId}: ${detalle}`);
  const permitido = () => state().auth.puedePlanificarTurnos(state().user);
  const planPropio = week => permitido() ? plans.get(key(state().user.usuario_id, week)) : null;
  const alcanceVigente = p => p && p.model.workers.every(w => state().auth.enAlcance(state().user, w.id));
  function invalidar(p) {
    if (p.running) p.running.cancelled = true;
    p.running = null; p.progress = null; p.confirmed = false; p.exception = null; p.results = []; p.approvedId = null; p.revision++;
  }
  function fallo(accion, motivo = 'Solo la jefatura puede planificar su equipo y sus módulos de demostración.') { return denegar(accion, '—', motivo); }
  const api = {
    planTurnos(week) {
      if (!permitido()) { fallo('turnos_acceso'); return null; }
      const p = planPropio(week); if (!p) return null;
      if (!alcanceVigente(p)) { fallo('turnos_acceso'); return null; }
      const { running, ...view } = p;
      return structuredClone({ ...view, running: !!running });
    },
    prepararTurnos(week, settings = {}) {
      if (!permitido()) return fallo('turnos_preparar');
      if (!settings || typeof settings !== 'object' || Array.isArray(settings) || Object.keys(settings).some(k => !Object.hasOwn(DEMO_SETTINGS, k))) return fallo('turnos_preparar', 'Usa únicamente los parámetros operativos de la demostración, sin información adicional.');
      if (!esLunes(week)) return fallo('turnos_preparar', 'Selecciona el lunes de la semana que quieres planificar.');
      if (!['alternativos', 'continuo'].includes(settings.mode || 'alternativos')) return fallo('turnos_preparar', 'Tipo de bloque no válido.');
      const ownerId = state().user.usuario_id; const ids = [...state().auth.scope(state().user)];
      const demo = escenarioDemo(ownerId, ids, week, settings); const valid = validarModelo(demo.model);
      if (!valid.ok) return fallo('turnos_preparar', valid.errors.join(' '));
      const old = planPropio(week); if (old?.running) old.running.cancelled = true;
      plans.set(key(ownerId, week), { ...demo, week, ownerId, order: [...ORDEN_DEFAULT], revision: (old?.revision || 0) + 1, confirmed: false,
        exception: null, results: [], running: null, progress: null });
      registrar('turnos_preparar', { week, ownerId }, 'Escenario sintético del equipo preparado en memoria; sin cambios oficiales'); return { ok: true };
    },
    ordenarTurnos(week, order) {
      const p = planPropio(week); if (!alcanceVigente(p)) return fallo('turnos_prioridades');
      if (!ordenValido(order) || p.running) return fallo('turnos_prioridades', 'Ordena una vez cada objetivo cuando no haya una búsqueda en curso.');
      p.order = [...order]; registrar('turnos_prioridades', p, `Prioridades de búsqueda: ${order.join(' → ')}`); return { ok: true };
    },
    guardarDemandaTurnos(week, demand) {
      const p = planPropio(week); if (!alcanceVigente(p)) return fallo('turnos_demanda');
      if (!Array.isArray(demand)) return fallo('turnos_demanda', 'Completa todas las celdas de demanda; no se presumen ceros.');
      const expected = new Set(p.model.demand.map(slotKey));
      if (demand.length !== expected.size || demand.some(d => !d || !expected.has(slotKey(d)) || Object.keys(d).some(k => !['day', 'shiftId', 'moduleId', 'required'].includes(k)))) return fallo('turnos_demanda', 'Incluye una vez cada celda de los módulos y bloques autorizados.');
      const candidate = { ...structuredClone(p.model), demand: structuredClone(demand) }; const valid = validarModelo(candidate);
      if (!valid.ok) return fallo('turnos_demanda', valid.errors.join(' '));
      invalidar(p); p.model = candidate;
      registrar('turnos_demanda', p, 'Borrador semanal actualizado; confirmación y propuestas anteriores invalidadas'); return { ok: true };
    },
    confirmarDemandaTurnos(week) {
      const p = planPropio(week); if (!alcanceVigente(p)) return fallo('turnos_confirmar');
      if (diffDays(week, state().hoy) < 7 && !(p.exception?.status === 'autorizada' && p.exception.revision === p.revision)) return fallo('turnos_confirmar', 'Faltan menos de siete días: solicita una excepción y autorización de Personas.');
      const locks = (p.model.baseline || []).filter(a => a.locked);
      if (!validarSolucion(p.model, locks).ok) return fallo('turnos_confirmar', 'La demanda contradice un turno bloqueado. Revisa el escenario de demostración antes de confirmarla.');
      p.confirmed = true; p.confirmedOn = state().hoy;
      registrar('turnos_confirmar', p, 'Demanda confirmada con fecha simulada; no equivale a validación de tiempo en producción'); return { ok: true };
    },
    solicitarExcepcionTurnos(week, reason) {
      const p = planPropio(week); if (!alcanceVigente(p)) return fallo('turnos_excepcion');
      if (!MOTIVOS_EXCEPCION.includes(reason)) return fallo('turnos_excepcion', 'Elige un motivo operativo, sin datos personales.');
      p.confirmed = false;
      p.exception = { status: 'pendiente', reason, revision: p.revision };
      registrar('turnos_excepcion_solicitada', p, 'Solicitud excepcional de demanda tardía pendiente de Personas'); return { ok: true };
    },
    excepcionesTurnos() {
      const s = state();
      if (!s.auth.esPersonas(s.user) || s.user.puede_asignar_responsables !== 'Sí') { fallo('turnos_excepciones_acceso'); return []; }
      return [...plans.values()].filter(p => p.exception?.status === 'pendiente' && p.model.workers.every(w => s.auth.enAlcance(s.user, w.id)))
        .map(p => ({ ownerId: p.ownerId, week: p.week, reason: p.exception.reason, status: p.exception.status }));
    },
    autorizarExcepcionTurnos(ownerId, week, { confirmado = false } = {}) {
      const s = state(); const p = plans.get(key(ownerId, week));
      if (!s.auth.esPersonas(s.user) || s.user.puede_asignar_responsables !== 'Sí' || !p
        || !p.model.workers.every(w => s.auth.enAlcance(s.user, w.id))) return fallo('turnos_excepcion_autorizar', 'Solo Personas o Administración con alcance puede autorizar esta excepción.');
      if (confirmado !== true || p.exception?.status !== 'pendiente' || p.exception.revision !== p.revision) return fallo('turnos_excepcion_autorizar', 'Confirma una solicitud vigente.');
      p.exception.status = 'autorizada'; p.exception.authorizedBy = s.user.usuario_id; p.exception.authorizedOn = s.hoy;
      registrar('turnos_excepcion_autorizada', p, 'Excepción operativa autorizada para demanda tardía; autorización de demo'); return { ok: true };
    },
    async generarTurnos(week, order = ORDEN_DEFAULT, options = {}) {
      const p = planPropio(week);
      if (!alcanceVigente(p) || !p.confirmed) return fallo('turnos_generar', 'Guarda y confirma la demanda de tu equipo antes de generar propuestas.');
      if (p.running) return fallo('turnos_generar', 'Ya hay una búsqueda en curso. Espera o cancélala.');
      const ownerId = state().user.usuario_id; const revision = p.revision; const sessionVersion = state().sessionVersion; const token = { cancelled: false }; p.running = token;
      registrar('turnos_generar', p, 'Búsqueda ALNS iniciada para el equipo; solo propuesta de demostración');
      try {
        const changed = () => token.cancelled || state().sessionVersion !== sessionVersion || state().user?.usuario_id !== ownerId || !permitido() || p.revision !== revision || !alcanceVigente(p) || plans.get(key(ownerId, week)) !== p;
        const result = await optimizarALNS(structuredClone(p.model), { ...options, order,
          shouldCancel: () => changed() || options.shouldCancel?.(),
          onProgress: progress => { if (!changed()) { p.progress = progress; options.onProgress?.(progress); } } });
        if (changed() || result.termination === 'cancelado') return fallo('turnos_cancelar', 'La ejecución se canceló o cambió la sesión. No se guardó una propuesta.');
        if (!result.ok) return fallo('turnos_generar', result.motivo);
        const id = `PROP-${++serial}`; p.results.unshift({ ...result, id, revision, status: 'propuesta' }); p.results.length = Math.min(p.results.length, 6);
        registrar('turnos_propuesta', p, `${id}: propuesta factible con ${result.metrics.covered} puestos cubiertos; no es un óptimo global garantizado`);
        return { ok: true, id };
      } catch {
        log('error', '—', 'Falló la planificación; no se registra contenido ni preferencias', 'error');
        return { ok: false, motivo: 'No se pudo generar la propuesta. Revisa los parámetros y vuelve a intentar.' };
      } finally { if (p.running === token) p.running = null; }
    },
    cancelarTurnos(week) {
      const p = planPropio(week); if (!alcanceVigente(p) || !p.running) return fallo('turnos_cancelar', 'No hay una búsqueda propia en curso.');
      p.running.cancelled = true; registrar('turnos_cancelar', p, 'Cancelación de búsqueda solicitada'); return { ok: true };
    },
    aprobarTurnos(week, id, { confirmado = false } = {}) {
      const p = planPropio(week); if (!alcanceVigente(p)) return fallo('turnos_aprobar');
      const result = p.results.find(r => r.id === id);
      if (confirmado !== true || !p.confirmed || !result || result.revision !== p.revision || !validarSolucion(p.model, result.assignments).ok) return fallo('turnos_aprobar', 'Confirma una propuesta vigente y factible.');
      result.status = 'borrador_validado'; p.approvedId = id;
      registrar('turnos_aprobar', p, `${id}: borrador validado en demo; no se publican ni cambian turnos oficiales`); return { ok: true };
    },
  };
  return { api, limpiar() { for (const p of plans.values()) if (p.running) p.running.cancelled = true; plans.clear(); } };
}
