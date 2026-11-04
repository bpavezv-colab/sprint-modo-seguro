import { isISO, addDays } from '../rules.js';

export const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
export const slotKey = x => `${x.day}|${x.shiftId}|${x.moduleId}`;
export const assignmentKey = x => `${x.workerId}|${slotKey(x)}`;
export const esLunes = iso => isISO(iso) && new Date(`${iso}T00:00:00Z`).getUTCDay() === 1;
export const fechasSemana = iso => DIAS.map((_, i) => addDays(iso, i));
const cache = new WeakMap();
export function indices(m) {
  if (!cache.has(m)) cache.set(m, {
    workers: new Map(m.workers.map(w => [w.id, w])), modules: new Map(m.modules.map(x => [x.id, x])),
    shifts: new Map(m.shifts.map(x => [x.id, x])), demand: new Map(m.demand.map(x => [slotKey(x), x])),
  });
  return cache.get(m);
}
export const horas = s => (s.end - s.start) / 60;

export function validarModelo(m) {
  const errors = []; const add = t => errors.push(t);
  if (!m || typeof m !== 'object') return { ok: false, errors: ['Falta el escenario de demostración.'] };
  if (!esLunes(m.week)) add('La semana debe comenzar un lunes con fecha válida.');
  if (m.synthetic !== true) add('Este módulo solo admite escenarios marcados como sintéticos.');
  const listas = ['workers', 'modules', 'shifts', 'demand'];
  if (listas.some(k => !Array.isArray(m[k]))) return { ok: false, errors: [...errors, 'Faltan trabajadores, módulos, bloques o demanda.'] };
  if (m.demand.some(d => !d || typeof d !== 'object' || Array.isArray(d))) return { ok: false, errors: [...errors, 'Cada celda de demanda necesita día, módulo, bloque y cantidad explícitos.'] };
  const id = x => typeof x === 'string' && x.length > 0 && x.length <= 80 && !x.includes('|');
  for (const k of ['workers', 'modules', 'shifts']) {
    if (m[k].some(x => !x || !id(x.id)) || new Set(m[k].map(x => x?.id)).size !== m[k].length) add(`Identificadores inválidos o repetidos en ${k}.`);
  }
  if (errors.length) return { ok: false, errors };
  if (!m.modules.length || !m.shifts.length || m.workers.length > 60 || m.modules.length > 8 || m.shifts.length > 3) add('Usa de 1 a 8 módulos, de 1 a 3 bloques y hasta 60 trabajadores.');
  const cfg = m.config;
  if (!cfg || cfg.validated !== true) add('Confirma los parámetros de demostración antes de optimizar.');
  if (!cfg || cfg.maxBlocksPerDay !== 1 || !Number.isFinite(cfg.minRestHours) || cfg.minRestHours < 0
    || !Number.isInteger(cfg.maxConsecutiveDays) || cfg.maxConsecutiveDays < 1 || cfg.maxConsecutiveDays > 7
    || !Number.isFinite(cfg.maxDailyHours) || cfg.maxDailyHours <= 0 || cfg.maxDailyHours > 24) add('Faltan límites de jornada y descanso válidos. Se admite un bloque indivisible por día.');
  for (const s of m.shifts) if (!Number.isInteger(s.start) || !Number.isInteger(s.end) || s.start < 0 || s.end > 1440 || s.end <= s.start) add('Cada bloque necesita inicio y fin válidos dentro del mismo día.');
  const ix = indices(m);
  const disponibilidadValida = a => a && Number.isInteger(a.day) && a.day >= 0 && a.day <= 6 && ix.shifts.has(a.shiftId);
  for (const module of m.modules) if (!id(module.siteId)) add('Falta la sede del módulo.');
  for (const w of m.workers) {
    if (!id(w.siteId) || !Array.isArray(w.modules) || w.modules.some(k => !ix.modules.has(k))) add('Falta sede o habilitación por módulo de un trabajador.');
    if (!Array.isArray(w.availability) || w.availability.some(a => !disponibilidadValida(a))) add('Falta disponibilidad explícita; una lista vacía significa indisponibilidad confirmada.');
    if (w.unavailable !== undefined && (!Array.isArray(w.unavailable) || w.unavailable.some(a => !disponibilidadValida(a)))) add('Las ausencias deben señalar día y bloque válidos, sin motivos personales.');
    if (!Number.isFinite(w.maxHours) || w.maxHours < 0 || !Number.isInteger(w.maxDays) || w.maxDays < 0 || w.maxDays > 7) add('Faltan límites semanales del trabajador.');
    if (w.targetHours !== undefined && w.targetHours !== null && (!Number.isFinite(w.targetHours) || w.targetHours < 0 || w.targetHours > w.maxHours)) add('Las horas objetivo deben estar entre cero y el máximo semanal.');
    const p = w.preferences;
    if (p && ((p.shifts && (!Array.isArray(p.shifts) || p.shifts.some(s => !ix.shifts.has(s))))
      || (p.days && (!Array.isArray(p.days) || p.days.some(d => !Number.isInteger(d) || d < 0 || d > 6)))
      || (p.requests && (!Array.isArray(p.requests) || p.requests.some(a => !disponibilidadValida(a) || typeof a.wanted !== 'boolean'))))) add('Preferencias con días o bloques inválidos.');
  }
  if (m.demand.some(d => !disponibilidadValida(d) || !ix.modules.has(d.moduleId) || !Number.isInteger(d.required) || d.required < 0 || d.required > 99)
    || ix.demand.size !== m.demand.length) add('Demanda inválida o duplicada: usa enteros de 0 a 99 por celda.');
  if (m.baseline !== undefined && (!Array.isArray(m.baseline) || m.baseline.some(a => !disponibilidadValida(a) || !ix.workers.has(a.workerId) || !ix.modules.has(a.moduleId)))) add('El calendario anterior contiene referencias inválidas.');
  return { ok: errors.length === 0, errors };
}
