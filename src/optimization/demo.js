// DATOS CREADOS POR EL EQUIPO. No derivar contratos, preferencias o habilidades del CSV.
import { DIAS } from './model.js';
import { puedeInsertar } from './constraints.js';

export const DEMO_SETTINGS = { mode: 'alternativos', morningStart: 480, morningEnd: 720, afternoonStart: 780, afternoonEnd: 1020,
  targetHours: 12, maxHours: 20, maxDays: 5, maxDailyHours: 8, minRestHours: 12, maxConsecutiveDays: 5, lockFirst: true, validated: false };

export function escenarioDemo(ownerId, workerIds, week, settings = {}) {
  const cfg = { ...DEMO_SETTINGS, ...settings };
  const modules = [1, 2].map(n => ({ id: `${ownerId}-DEMO-${n}`, label: `Módulo demo ${n}`, siteId: `${ownerId}-SEDE-DEMO` }));
  const shifts = cfg.mode === 'continuo'
    ? [{ id: 'continua', label: 'Jornada continua', start: cfg.morningStart, end: cfg.morningEnd }]
    : [{ id: 'manana', label: 'Mañana', start: cfg.morningStart, end: cfg.morningEnd }, { id: 'tarde', label: 'Tarde', start: cfg.afternoonStart, end: cfg.afternoonEnd }];
  const workers = workerIds.slice().sort().map((id, i) => ({ id, siteId: modules[0].siteId,
    modules: i % 3 === 0 ? [modules[0].id] : modules.map(m => m.id),
    targetHours: cfg.targetHours, maxHours: cfg.maxHours, maxDays: cfg.maxDays,
    availability: DIAS.slice(0, 5).flatMap((_, day) => shifts.map(s => ({ day, shiftId: s.id }))),
    unavailable: i === 1 && shifts.length > 1 ? [{ day: 1, shiftId: 'tarde' }] : [],
    preferences: { shifts: [shifts[i % shifts.length].id], days: [0, 1, 2, 3, 4] },
  }));
  const demand = DIAS.flatMap((_, day) => modules.flatMap((m, mi) => shifts.map((s, si) => ({ day, shiftId: s.id, moduleId: m.id,
    required: day < 5 && mi === si ? (mi === 0 ? 2 : 1) : 0 }))));
  const model = { week, ownerId, synthetic: true, modules, shifts, workers, demand,
    config: { validated: cfg.validated === true, maxBlocksPerDay: 1, minRestHours: cfg.minRestHours,
      maxConsecutiveDays: cfg.maxConsecutiveDays, maxDailyHours: cfg.maxDailyHours }, baseline: [] };
  // Calendario previo sintético, deliberadamente simple. Se reconstruye solo al preparar el escenario.
  const baseline = [];
  for (const d of demand) for (let n = 0; n < Math.min(d.required, workers.length); n++) {
    const candidate = workers.map(w => ({ workerId: w.id, day: d.day, shiftId: d.shiftId, moduleId: d.moduleId })).find(a => puedeInsertar(model, baseline, a));
    if (candidate) baseline.push(candidate);
  }
  model.baseline = baseline.map((a, i) => ({ ...a, locked: cfg.lockFirst === true && i === 0 }));
  return { model, settings: cfg, provenance: 'Escenario creado por el equipo; disponibilidades, puestos, sede, contratos, preferencias y calendario previo son supuestos de demostración. No vienen en los CSV oficiales.' };
}
