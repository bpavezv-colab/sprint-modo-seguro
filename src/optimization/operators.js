import { indices, slotKey, assignmentKey } from './model.js';
import { elegible, puedeInsertar } from './constraints.js';
import { evaluarObjetivos, comparar, vector } from './objectives.js';

export const DESTROY = ['random', 'worst', 'related'];
export const REPAIR = ['greedy', 'regret2', 'active'];
export function randomSeed(seed) {
  let state = seed >>> 0;
  return () => { state += 0x6D2B79F5; let t = Math.imul(state ^ state >>> 15, 1 | state); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function elegir(weights, rng) {
  let n = rng() * weights.reduce((sum, w) => sum + w.weight, 0);
  return weights.findIndex(w => (n -= w.weight) <= 0);
}
export function destruir(kind, m, solution, active, rng, fraction = 0.35) {
  const locked = new Set((m.baseline || []).filter(a => a.locked).map(assignmentKey));
  let movable = solution.filter(a => !locked.has(assignmentKey(a)));
  const count = Math.max(1, Math.ceil(movable.length * fraction));
  if (kind === 'random') movable = movable.map(a => ({ a, score: rng() })).sort((a, b) => a.score - b.score).map(x => x.a);
  if (kind === 'worst') {
    const original = evaluarObjetivos(m, solution).costs[active];
    movable = movable.map(a => ({ a, tie: rng(), benefit: evaluarObjetivos(m, solution.filter(x => x !== a)).costs[active] - original }))
      .sort((a, b) => a.benefit - b.benefit || a.tie - b.tie).map(x => x.a);
  }
  if (kind === 'related' && movable.length) {
    const seed = movable[Math.floor(rng() * movable.length)];
    movable = movable.map(a => ({ a, tie: rng(), relation: Number(a.day === seed.day) + Number(a.moduleId === seed.moduleId) + Number(a.workerId === seed.workerId) }))
      .sort((a, b) => b.relation - a.relation || a.tie - b.tie).map(x => x.a);
  }
  const removed = new Set(movable.slice(0, count).map(assignmentKey));
  return solution.filter(a => !removed.has(assignmentKey(a)));
}

function rank(costs, order, stage, locks, activeMode) {
  if (!activeMode) return vector(costs, order);
  // Primero restaurar los valores bloqueados; luego el objetivo de esta etapa.
  return [...order.slice(0, stage).map(k => Math.max(0, costs[k] - locks[k])), costs[order[stage]], ...vector(costs, order)];
}

export function reparar(kind, m, partial, order, stage, locks, rng) {
  const result = partial.slice(); const ix = indices(m); const activeMode = kind === 'active';
  const ranking = costs => rank(costs, order, stage, locks, activeMode);
  for (let step = 0; step < m.workers.length * 7; step++) {
    const current = ranking(evaluarObjetivos(m, result).costs);
    const counts = new Map(); for (const a of result) counts.set(slotKey(a), (counts.get(slotKey(a)) || 0) + 1);
    const options = [];
    for (const d of m.demand) {
      if ((counts.get(slotKey(d)) || 0) >= d.required) continue;
      const slotOptions = [];
      for (const w of m.workers) {
        const a = { workerId: w.id, day: d.day, shiftId: d.shiftId, moduleId: d.moduleId };
        if (!puedeInsertar(m, result, a)) continue;
        const score = ranking(evaluarObjetivos(m, [...result, a]).costs);
        if (comparar(score, current) >= 0) continue;
        slotOptions.push({ a, score, tie: rng() });
      }
      slotOptions.sort((a, b) => comparar(a.score, b.score) || a.tie - b.tie);
      if (kind === 'regret2' && slotOptions.length) {
        const first = slotOptions[0]; const second = slotOptions[1];
        // Regret vectorial: no convertir objetivos distintos en una suma ponderada.
        const regret = second ? second.score.map((v, i) => v - first.score[i]) : current.map(() => Infinity);
        options.push({ ...first, regret });
      } else options.push(...slotOptions);
    }
    if (!options.length) break;
    options.sort((a, b) => (kind === 'regret2' ? comparar(b.regret, a.regret) : 0) || comparar(a.score, b.score) || a.tie - b.tie);
    result.push(options[0].a);
  }
  return result;
}

export function dificultad(m, d) {
  const eligible = m.workers.filter(w => elegible(m, { workerId: w.id, ...d })).length;
  return eligible / Math.max(1, d.required);
}
