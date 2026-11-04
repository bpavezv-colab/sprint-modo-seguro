import { indices, horas, slotKey, assignmentKey } from './model.js';

export const OBJETIVOS = [
  { id: 'cobertura', label: 'Minimizar demanda desatendida', unit: 'puestos sin cubrir', description: 'Suma de faltantes por día, bloque y módulo.' },
  { id: 'cambios', label: 'Minimizar cambios del calendario previo', unit: 'altas y bajas de asignaciones', description: 'Diferencia simétrica con el calendario sintético anterior; cambiar un turno cuenta una baja y un alta.' },
  { id: 'horas', label: 'Minimizar desviación de horas objetivo', unit: 'horas de desviación absoluta', description: 'Suma de diferencias absolutas con las horas objetivo conocidas.' },
  { id: 'preferencias', label: 'Mejorar satisfacción de preferencias', unit: 'preferencias incumplidas', description: 'Bloques y días no preferidos, más solicitudes individuales incumplidas. Una ausencia siempre es obligatoria.' },
  { id: 'equidad', label: 'Minimizar inequidad proporcional', unit: 'dispersión normalizada', description: 'Dispersión de horas y horas no deseadas respecto de la capacidad contractual y disponible de cada trabajador.' },
];
export const ORDEN_DEFAULT = OBJETIVOS.map(o => o.id);
export const ordenValido = order => Array.isArray(order) && order.length === 5 && new Set(order).size === 5 && order.every(k => ORDEN_DEFAULT.includes(k));
export const comparar = (a, b) => { for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-8) return a[i] < b[i] ? -1 : 1; return 0; };
export const vector = (costs, order) => order.map(k => costs[k]);
const round = n => Math.round(n * 1e8) / 1e8;

export function evaluarObjetivos(m, assignments) {
  const ix = indices(m); const counts = new Map(); const notes = [];
  for (const a of assignments) counts.set(slotKey(a), (counts.get(slotKey(a)) || 0) + 1);
  const uncovered = m.demand.map(d => ({ ...d, covered: counts.get(slotKey(d)) || 0, missing: Math.max(0, d.required - (counts.get(slotKey(d)) || 0)) })).filter(d => d.missing > 0);
  const actual = new Set(assignments.map(assignmentKey)); const prior = new Set((m.baseline || []).map(assignmentKey));
  const cambios = Array.isArray(m.baseline) ? [...actual].filter(k => !prior.has(k)).length + [...prior].filter(k => !actual.has(k)).length : 0;
  if (!Array.isArray(m.baseline)) notes.push('Sin calendario previo: cambios no evaluados.');
  let prefCost = 0; let prefChecks = 0; let hourDeviation = 0;
  const loads = m.workers.map(w => {
    const list = assignments.filter(a => a.workerId === w.id); const p = w.preferences || {};
    let unwantedHours = 0;
    for (const a of list) {
      const badShift = p.shifts?.length ? !p.shifts.includes(a.shiftId) : false;
      const badDay = p.days?.length ? !p.days.includes(a.day) : false;
      prefChecks += (p.shifts?.length ? 1 : 0) + (p.days?.length ? 1 : 0);
      prefCost += Number(badShift) + Number(badDay);
      if (badShift || badDay) unwantedHours += horas(ix.shifts.get(a.shiftId));
    }
    for (const r of p.requests || []) {
      prefChecks++; const assigned = list.some(a => a.day === r.day && a.shiftId === r.shiftId);
      if (assigned !== r.wanted) prefCost++;
    }
    const hours = list.reduce((n, a) => n + horas(ix.shifts.get(a.shiftId)), 0);
    const target = Number.isFinite(w.targetHours) ? w.targetHours : null;
    if (target !== null) hourDeviation += Math.abs(hours - target);
    else notes.push('Horas objetivo faltantes: se excluyen de la desviación contractual.');
    if (!w.preferences) notes.push('Preferencias faltantes: no se presume una preferencia personal.');
    const availableDaily = Array.from({ length: 7 }, (_, day) => Math.max(0, ...w.availability
      .filter(a => a.day === day && !(w.unavailable || []).some(b => b.day === a.day && b.shiftId === a.shiftId))
      .map(a => Math.min(horas(ix.shifts.get(a.shiftId)), m.config.maxDailyHours)))).sort((a, b) => b - a);
    const availableHours = availableDaily.slice(0, w.maxDays).reduce((n, h) => n + h, 0);
    const capacity = Math.min(w.maxHours, target ?? w.maxHours, availableHours);
    return { workerId: w.id, blocks: list.length, hours, target, deviation: target === null ? null : round(hours - target), capacity,
      ratio: capacity > 0 ? hours / capacity : null, unwantedRatio: capacity > 0 ? unwantedHours / capacity : null };
  });
  const capacities = loads.filter(w => w.capacity > 0);
  const dispersion = field => {
    const mean = capacities.reduce((n, w) => n + w[field], 0) / (capacities.length || 1);
    return capacities.reduce((n, w) => n + Math.abs(w[field] - mean), 0);
  };
  return { costs: { cobertura: uncovered.reduce((n, d) => n + d.missing, 0), cambios, preferencias: prefCost,
    equidad: round(dispersion('ratio') + dispersion('unwantedRatio')), horas: round(hourDeviation) },
    required: m.demand.reduce((n, d) => n + d.required, 0), covered: assignments.length, uncovered, loads,
    preferenceChecks: prefChecks, preferenceSatisfied: prefChecks - prefCost,
    satisfaction: prefChecks ? round((prefChecks - prefCost) / prefChecks * 100) : null, notes: [...new Set(notes)] };
}
