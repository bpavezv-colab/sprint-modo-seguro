import { validarModelo } from './model.js';
import { validarSolucion } from './constraints.js';
import { evaluarObjetivos, ORDEN_DEFAULT, ordenValido, vector, comparar } from './objectives.js';
import { construirInicial } from './initialSolution.js';
import { DESTROY, REPAIR, randomSeed, elegir, destruir, reparar } from './operators.js';

const clock = () => globalThis.performance?.now() ?? Date.now();
export const SEARCH_DEFAULT = { iterations: 400, maxTimeMs: 5000, maxStall: 60, seed: 2026 };
const stats = names => names.map(name => ({ name, weight: 1, uses: 0, improvements: 0, accepted: 0 }));

function* buscar(m, options = {}) {
  const validation = validarModelo(m); if (!validation.ok) return { ok: false, motivo: validation.errors.join(' '), errors: validation.errors };
  const order = options.order || ORDEN_DEFAULT; const cfg = { ...SEARCH_DEFAULT, ...options };
  if (!ordenValido(order)) return { ok: false, motivo: 'Ordena una vez cada uno de los cinco objetivos.' };
  if (!Number.isInteger(cfg.iterations) || cfg.iterations < 5 || cfg.iterations > 5000 || !Number.isFinite(cfg.maxTimeMs) || cfg.maxTimeMs <= 0 || cfg.maxTimeMs > 60000
    || !Number.isInteger(cfg.maxStall) || cfg.maxStall < 1 || !Number.isInteger(cfg.seed) || cfg.seed < 0 || cfg.seed > 4294967295) return { ok: false, motivo: 'Presupuesto o semilla inválidos.' };
  const tolerances = Object.fromEntries(order.map(k => [k, options.tolerances?.[k] ?? 0]));
  if (Object.entries(options.tolerances || {}).some(([k, v]) => !order.includes(k) || !Number.isFinite(v) || v < 0)) return { ok: false, motivo: 'Las tolerancias deben ser explícitas, finitas y no negativas.' };
  const rng = randomSeed(cfg.seed); const start = clock(); const initial = construirInicial(m, order, rng);
  if (!initial.ok) return { ...initial, motivo: initial.errors.join(' ') };
  let best = initial.assignments; let metrics = evaluarObjetivos(m, best); let iterations = 0; let termination = 'iteraciones';
  const stages = []; const locks = {}; const destroyStats = stats(DESTROY); const repairStats = stats(REPAIR);
  let stopped = false;
  for (let stage = 0; stage < order.length; stage++) {
    const active = order[stage]; const lockedBefore = { ...locks };
    let current = best.slice(); let currentMetrics = metrics; let stall = 0; let used = 0;
    const budget = Math.floor(cfg.iterations / 5) + (stage < cfg.iterations % 5 ? 1 : 0);
    let temperature = Math.max(1, Math.abs(metrics.costs[active]) * 0.15);
    while (used < budget && stall < cfg.maxStall && !stopped) {
      if (options.shouldCancel?.()) { termination = 'cancelado'; stopped = true; break; }
      if (clock() - start >= cfg.maxTimeMs) { termination = 'tiempo'; stopped = true; break; }
      const di = elegir(destroyStats, rng); const ri = elegir(repairStats, rng);
      const ds = destroyStats[di]; const rs = repairStats[ri]; ds.uses++; rs.uses++;
      const partial = destruir(ds.name, m, current, active, rng, 0.2 + rng() * 0.5);
      const candidate = reparar(rs.name, m, partial, order, stage, locks, rng);
      const candidateMetrics = evaluarObjetivos(m, candidate);
      const feasible = validarSolucion(m, candidate).ok && order.slice(0, stage).every(k => candidateMetrics.costs[k] <= locks[k] + 1e-8);
      let reward = 0; stall++; used++; iterations++;
      if (feasible) {
        const delta = candidateMetrics.costs[active] - currentMetrics.costs[active];
        const improves = candidateMetrics.costs[active] < metrics.costs[active] - 1e-8;
        const tieBetter = Math.abs(candidateMetrics.costs[active] - metrics.costs[active]) <= 1e-8 && comparar(vector(candidateMetrics.costs, order), vector(metrics.costs, order)) < 0;
        if (improves || tieBetter) { best = candidate; metrics = candidateMetrics; stall = 0; reward = 8; ds.improvements++; rs.improvements++; }
        // El annealing solo relaja el objetivo activo; jamás los límites ya fijados.
        if (delta <= 0 || rng() < Math.exp(-delta / Math.max(0.01, temperature))) {
          current = candidate; currentMetrics = candidateMetrics; reward = Math.max(reward, delta < 0 ? 4 : 1); ds.accepted++; rs.accepted++;
        }
      }
      // Reacción exponencial por desempeño, con probabilidad positiva para explorar todos los operadores.
      for (const op of [ds, rs]) op.weight = Math.max(0.1, 0.8 * op.weight + 0.2 * reward);
      temperature *= 0.97;
      if (iterations % (options.yieldEvery || 3) === 0) yield { stage: stage + 1, active, iterations, maxIterations: cfg.iterations, costs: { ...metrics.costs }, progress: Math.round(iterations / cfg.iterations * 100) };
    }
    for (const k of order.slice(0, stage + 1)) locks[k] = Math.min(locks[k] ?? Infinity, metrics.costs[k] + tolerances[k]);
    stages.push({ objective: active, iterations: used, lockedBefore, costs: { ...metrics.costs }, boundsAfter: { ...locks }, skipped: stopped && used === 0 });
    if (!stopped && used < budget && stage === 4) termination = 'sin_mejora';
  }
  return { ok: true, assignments: best.slice().sort((a, b) => a.day - b.day || a.shiftId.localeCompare(b.shiftId) || a.moduleId.localeCompare(b.moduleId) || a.workerId.localeCompare(b.workerId)),
    metrics, stages, order: [...order], tolerances, seed: cfg.seed, iterations, elapsedMs: Math.round(clock() - start), termination,
    operators: { destroy: destroyStats, repair: repairStats }, heuristic: true };
}

export function optimizar(model, options) {
  const search = buscar(model, options); let step;
  do { step = search.next(); } while (!step.done);
  return step.value;
}

export async function optimizarALNS(model, options = {}) {
  const search = buscar(model, options); const pause = options.scheduler || (() => new Promise(resolve => setTimeout(resolve, 0)));
  let step = search.next();
  while (!step.done) { options.onProgress?.(step.value); await pause(); step = search.next(); }
  options.onProgress?.({ progress: 100, stage: 5, iterations: step.value.iterations || 0, done: true });
  return step.value;
}
