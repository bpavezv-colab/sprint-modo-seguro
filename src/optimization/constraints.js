import { indices, slotKey, assignmentKey, horas } from './model.js';

export function elegible(m, a) {
  const ix = indices(m); const w = ix.workers.get(a.workerId); const mod = ix.modules.get(a.moduleId);
  return !!w && !!mod && ix.shifts.has(a.shiftId) && w.siteId === mod.siteId && w.modules.includes(a.moduleId)
    && w.availability.some(b => b.day === a.day && b.shiftId === a.shiftId)
    && !(w.unavailable || []).some(b => b.day === a.day && b.shiftId === a.shiftId);
}

export function validarSolucion(m, assignments, { checkLocks = true } = {}) {
  const errors = []; const ix = indices(m); const counts = new Map(); const perWorker = new Map(); const seen = new Set();
  for (const a of assignments) {
    const key = assignmentKey(a); const slot = slotKey(a);
    if (seen.has(key)) errors.push('Asignación duplicada.'); seen.add(key);
    if (!elegible(m, a)) { errors.push('Asignación sin disponibilidad, sede o habilitación.'); continue; }
    counts.set(slot, (counts.get(slot) || 0) + 1);
    if (counts.get(slot) > (ix.demand.get(slot)?.required || 0)) errors.push('La asignación supera la demanda del bloque.');
    if (!perWorker.has(a.workerId)) perWorker.set(a.workerId, []);
    perWorker.get(a.workerId).push(a);
  }
  for (const [id, list] of perWorker) {
    const w = ix.workers.get(id); const ordered = list.slice().sort((a, b) => a.day - b.day);
    const days = new Set(list.map(a => a.day));
    if (days.size !== list.length) errors.push('Más de un bloque por día: jornada superpuesta o fragmentada.');
    if (days.size > w.maxDays || list.reduce((n, a) => n + horas(ix.shifts.get(a.shiftId)), 0) > w.maxHours + 1e-8) errors.push('Se supera el máximo semanal.');
    let consecutive = 0; let previousDay = -2; let previousEnd = null;
    for (const a of ordered) {
      const shift = ix.shifts.get(a.shiftId); const start = a.day * 1440 + shift.start; const end = a.day * 1440 + shift.end;
      if (horas(shift) > m.config.maxDailyHours + 1e-8) errors.push('Se supera el máximo diario.');
      if (previousEnd !== null && start - previousEnd < m.config.minRestHours * 60) errors.push('No se respeta el descanso mínimo configurado.');
      consecutive = a.day === previousDay + 1 ? consecutive + 1 : 1;
      if (consecutive > m.config.maxConsecutiveDays) errors.push('Se supera el máximo de días consecutivos.');
      previousDay = a.day; previousEnd = end;
    }
  }
  if (checkLocks && (m.baseline || []).some(a => a.locked && !seen.has(assignmentKey(a)))) errors.push('Falta un turno bloqueado.');
  return { ok: errors.length === 0, errors };
}

export function puedeInsertar(m, assignments, a) {
  return elegible(m, a) && validarSolucion(m, [...assignments, a], { checkLocks: false }).ok;
}
