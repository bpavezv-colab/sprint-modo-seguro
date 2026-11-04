import { indices, assignmentKey } from './model.js';
import { validarSolucion, puedeInsertar } from './constraints.js';
import { evaluarObjetivos, comparar, vector } from './objectives.js';
import { dificultad } from './operators.js';

export function construirInicial(m, order, rng) {
  const result = (m.baseline || []).filter(a => a.locked).map(a => ({ workerId: a.workerId, day: a.day, shiftId: a.shiftId, moduleId: a.moduleId }));
  if (!validarSolucion(m, result).ok) return { ok: false, errors: ['Los turnos bloqueados son incompatibles con la demanda o las restricciones. Revisa los datos.'] };
  const present = new Set(result.map(assignmentKey));
  for (const a of m.baseline || []) if (!present.has(assignmentKey(a)) && puedeInsertar(m, result, a)) {
    result.push({ workerId: a.workerId, day: a.day, shiftId: a.shiftId, moduleId: a.moduleId }); present.add(assignmentKey(a));
  }
  // Los bloques con menos personas elegibles por puesto requerido se construyen primero.
  const slots = m.demand.filter(d => d.required > 0).slice().sort((a, b) => dificultad(m, a) - dificultad(m, b));
  for (const d of slots) {
    for (let n = 0; n < Math.min(d.required, m.workers.length); n++) {
      const current = vector(evaluarObjetivos(m, result).costs, order); const choices = [];
      for (const w of m.workers) {
        const a = { workerId: w.id, day: d.day, shiftId: d.shiftId, moduleId: d.moduleId };
        if (puedeInsertar(m, result, a)) choices.push({ a, score: vector(evaluarObjetivos(m, [...result, a]).costs, order), tie: rng() });
      }
      choices.sort((a, b) => comparar(a.score, b.score) || a.tie - b.tie);
      if (!choices.length || comparar(choices[0].score, current) >= 0) break;
      result.push(choices[0].a);
    }
  }
  return { ok: true, assignments: result };
}
