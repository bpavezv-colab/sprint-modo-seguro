import { DIAS, fechasSemana, esLunes, slotKey, assignmentKey } from './model.js';
import { DEMO_SETTINGS } from './demo.js';
import { ORDEN_DEFAULT, OBJETIVOS, evaluarObjetivos } from './objectives.js';
import { SEARCH_DEFAULT } from './alns.js';
import { MOTIVOS_EXCEPCION } from './planning.js';
import { addDays, diffDays } from '../rules.js';

export function reiniciarTurnosUI(ui) { ui.turnos = null; }
function estadoUI(store, ui) {
  const ownerId = store.state.user?.usuario_id;
  if (!ui.turnos || ui.turnos.ownerId !== ownerId) {
    let week = addDays(store.state.hoy, 7); while (!esLunes(week)) week = addDays(week, 1);
    ui.turnos = { ownerId, week, order: [...ORDEN_DEFAULT], selected: null, compare: 'original', search: { ...SEARCH_DEFAULT }, tolerances: {} };
  }
  return ui.turnos;
}
const hhmm = n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const minutos = text => /^\d{2}:\d{2}$/.test(text || '') ? Number(text.slice(0, 2)) * 60 + Number(text.slice(3)) : NaN;
const nfmt = n => Number(n).toLocaleString('es-CL', { maximumFractionDigits: 3 });

function formularioEscenario(p, st, esc) {
  const settings = p?.settings || DEMO_SETTINGS;
  const input = (label, name, type = 'number', min = 0, max = 24) => `<div class="field"><label for="tp-${esc(name)}">${esc(label)}</label><input id="tp-${esc(name)}" name="${esc(name)}" type="${type}" ${type === 'number' ? `min="${min}" max="${max}" step="0.5"` : ''} value="${esc(type === 'time' ? hhmm(settings[name]) : settings[name])}" required></div>`;
  return `<form data-form="turnos-preparar" class="form turnos-wide"><fieldset ${p?.running ? 'disabled' : ''}>
    <div class="turnos-grid">
      <div class="field"><label for="tp-week">Semana que comienza el lunes</label><input id="tp-week" name="week" type="date" value="${esc(st.week)}" required></div>
      <div class="field"><label for="tp-mode">Bloques de trabajo</label><select id="tp-mode" name="mode"><option value="alternativos" ${settings.mode === 'alternativos' ? 'selected' : ''}>Mañana o tarde, un bloque por día</option><option value="continuo" ${settings.mode === 'continuo' ? 'selected' : ''}>Un bloque continuo por día</option></select></div>
      ${input('Inicio de mañana o bloque continuo', 'morningStart', 'time')}${input('Fin de mañana o bloque continuo', 'morningEnd', 'time')}
      ${input('Inicio de tarde (solo bloques alternativos)', 'afternoonStart', 'time')}${input('Fin de tarde (solo bloques alternativos)', 'afternoonEnd', 'time')}
      ${input('Horas objetivo semanales demo por persona', 'targetHours', 'number', 0, 168)}${input('Máximo de horas semanales demo', 'maxHours', 'number', 0, 168)}
      ${input('Máximo de días por semana demo', 'maxDays', 'number', 0, 7)}${input('Máximo de horas por día demo', 'maxDailyHours')}
      ${input('Descanso mínimo entre bloques (horas demo)', 'minRestHours', 'number', 0, 72)}${input('Máximo de días consecutivos demo', 'maxConsecutiveDays', 'number', 1, 7)}
    </div>
    <label class="turnos-check"><input name="lockFirst" type="checkbox" ${settings.lockFirst ? 'checked' : ''}> Bloquear la primera asignación del calendario previo sintético</label>
    <label class="turnos-check"><input name="validated" type="checkbox" required> Confirmo que son supuestos de demostración, sin valor contractual ni validación legal</label>
    <p class="hint">Preparar de nuevo esta semana reemplaza su demanda y sus propuestas. El bloque continuo usa el inicio y fin del primer bloque; nunca combina dos jornadas separadas.</p>
    <button class="btn btn-primary" type="submit">${p ? 'Preparar o reiniciar escenario' : 'Preparar semana de demostración'}</button>
  </fieldset></form>`;
}

export function vistaTurnos(store, ui, esc, fmt) {
  if (!store.state.auth.puedePlanificarTurnos(store.state.user)) return '';
  const st = estadoUI(store, ui); const p = store.planTurnos(st.week);
  if (p?.order) st.order = [...p.order];
  const intro = `<section class="blk" id="turnos"><p class="caption">Extensión de demostración · solo tu equipo</p><h2 class="h-lg">Planificación Inteligente de Turnos</h2>
    <p class="lead">Define la cobertura, ordena tus prioridades y compara propuestas semanales sin cambiar los turnos oficiales.</p>
    <p class="notice">Los puestos, las habilitaciones, la disponibilidad, las horas, las preferencias y el calendario previo de esta sección son <b>datos sintéticos creados por el equipo</b>. No se infieren del área, modalidad, dispositivo ni atrasos de onboarding. Se borran al recargar.</p>
    <ol class="turnos-steps"><li>1. Demanda semanal</li><li>2. Prioridades</li><li>3. Generar propuesta</li><li>4. Comparar y aprobar</li></ol>
    <form data-form="turnos-abrir" class="form form-inline"><div class="field"><label for="turnos-open-week">Abrir una semana ya preparada en esta sesión</label><input id="turnos-open-week" name="week" type="date" value="${esc(st.week)}" required></div><button type="submit" class="btn btn-ghost">Abrir semana guardada</button></form>
    ${p ? `<details class="turnos-config"><summary>Preparar otra semana o cambiar parámetros demo</summary>${formularioEscenario(p, st, esc)}</details>` : formularioEscenario(null, st, esc)}
  </section>`;
  if (!p) return intro;
  const m = p.model; const dates = fechasSemana(st.week); const columns = m.modules.flatMap(mod => m.shifts.map(shift => ({ mod, shift })));
  const late = diffDays(st.week, store.state.hoy) < 7;
  const priorityName = id => OBJETIVOS.find(o => o.id === id)?.label || id;
  const current = p.results.find(r => r.id === st.selected) || p.results[0];
  const metricas = store.state.auth.puedeVerMetricas(store.state.user);
  const demand = `<section class="blk" id="turnos-demanda"><p class="caption">1 · Demanda semanal · ${fmt(st.week)} al ${fmt(dates[6])}</p>
    <p class="hint">Sede demo de tu equipo. Un trabajador ocupa un bloque completo por día. Disponibilidad demo: lunes a viernes, con una ausencia técnica de ejemplo sin motivo personal. Sábado y domingo sin disponibilidad.</p>
    <details><summary>Ver capacidad y habilitaciones de demostración</summary><div class="table-wrap"><table><thead><tr><th>Código</th><th>Módulos habilitados demo</th><th>Objetivo / máximo semanal</th><th>Días disponibles</th></tr></thead><tbody>
      ${m.workers.map(w => `<tr><td><code>${esc(w.id)}</code></td><td>${esc(w.modules.map(id => m.modules.find(x => x.id === id)?.label).join(', '))}</td><td>${esc(w.targetHours)} / ${esc(w.maxHours)} h</td><td>${esc(new Set(w.availability.map(a => a.day)).size)}</td></tr>`).join('')}
    </tbody></table></div><p class="hint">Las preferencias se evalúan como indicadores agregados; no se muestran solicitudes individuales ni motivos de ausencia.</p></details>
    <form data-form="turnos-demanda" class="form turnos-wide"><fieldset ${p.running ? 'disabled' : ''}><div class="table-wrap"><table class="turnos-demand"><thead><tr><th>Día</th>${columns.map(({ mod, shift }) => `<th>${esc(mod.label)}<br><small>${esc(shift.label)} · ${esc(hhmm(shift.start))}–${esc(hhmm(shift.end))}</small></th>`).join('')}</tr></thead><tbody>
      ${DIAS.map((day, i) => `<tr><th scope="row">${esc(day)}<br><small>${fmt(dates[i])}</small></th>${columns.map(({ mod, shift }) => {
        const index = m.demand.findIndex(d => d.day === i && d.moduleId === mod.id && d.shiftId === shift.id);
        return `<td><input aria-label="${esc(`${day}, ${mod.label}, ${shift.label}`)}" name="d-${index}" type="number" min="0" max="99" step="1" value="${esc(m.demand[index].required)}" required></td>`;
      }).join('')}</tr>`).join('')}
    </tbody></table></div><p class="hint">Cada celda exige un entero explícito, incluido cero. Guardar cambios invalida la confirmación y las propuestas previas.</p><button class="btn btn-primary" type="submit">Guardar borrador de demanda</button></fieldset></form>
    <div class="turnos-toolbar"><span class="chip chip-${p.confirmed ? 'ok' : 'warn'}">${p.confirmed ? 'Demanda confirmada' : 'Borrador sin confirmar'}</span><button class="btn btn-ghost" data-act="turnos-confirmar" ${p.running ? 'disabled' : ''}>Confirmar demanda semanal</button></div>
    <p class="hint">Anticipación ordinaria: siete días antes del lunes planificado. Se comprueba contra la fecha de corte simulada ${fmt(store.state.hoy)}. El navegador offline no acredita identidad ni tiempo confiables para producción.</p>
    ${late ? `<div class="notice notice-bad"><b>Demanda tardía.</b> Requiere motivo operativo y autorización de Personas antes de confirmar. Estado: ${esc(p.exception?.status || 'sin solicitud')}.</div>
      <form data-form="turnos-excepcion" class="form form-inline"><div class="field"><label for="t-excepcion">Motivo operativo</label><select name="reason" id="t-excepcion">${MOTIVOS_EXCEPCION.map(x => `<option>${esc(x)}</option>`).join('')}</select></div><button class="btn btn-ghost" type="submit">Solicitar autorización a Personas</button></form>` : ''}
  </section>`;
  const priorities = `<section class="blk" id="turnos-prioridades"><p class="caption">2 · Prioridades de optimización</p>
    <p class="lead">Primero se busca el mejor valor de la prioridad 1. Después se mejoran las siguientes conservando los valores ya fijados.</p><p class="hint">Los objetivos son costos de minimización. Se resuelven por etapas, sin una suma ponderada. Las restricciones obligatorias siempre se mantienen.</p>
    ${st.order[0] !== 'cobertura' ? '<p class="notice notice-bad">Cobertura tiene una prioridad inferior: otras prioridades pueden dejar puestos sin cubrir. Revisa los faltantes antes de aprobar.</p>' : ''}
    <div class="turnos-priorities">${st.order.map((id, index) => { const o = OBJETIVOS.find(x => x.id === id); return `<article class="turnos-priority"><span class="turnos-rank">${index + 1}</span><div><h3>${esc(o.label)}</h3><p class="hint">${esc(o.description)} Unidad: ${esc(o.unit)}.</p></div><div class="field"><label for="prio-${esc(id)}">Prioridad</label><select id="prio-${esc(id)}" data-change="turnos-prioridad" data-arg="${esc(id)}" ${p.running ? 'disabled' : ''}>${ORDEN_DEFAULT.map((_, n) => `<option value="${n}" ${n === index ? 'selected' : ''}>${n + 1}</option>`).join('')}</select></div></article>`; }).join('')}</div>
    <button class="btn btn-ghost" data-act="turnos-restablecer" ${p.running ? 'disabled' : ''}>Restablecer prioridades recomendadas</button>
  </section>`;
  const run = `<section class="blk" id="turnos-generar"><p class="caption">3 · Ejecutar optimización</p>
    <form data-form="turnos-generar" class="form turnos-wide"><fieldset ${p.running ? 'disabled' : ''}><div class="turnos-grid">
      ${[['iterations', 'Máximo de iteraciones', 5, 5000], ['maxTimeMs', 'Tiempo máximo (milisegundos)', 1, 60000], ['maxStall', 'Iteraciones sin mejora por etapa', 1, 5000], ['seed', 'Semilla reproducible', 0, 4294967295]].map(([key, label, min, max]) => `<div class="field"><label for="search-${key}">${esc(label)}</label><input id="search-${key}" type="number" name="${key}" min="${min}" max="${max}" step="1" value="${esc(st.search[key])}" required></div>`).join('')}
    </div><details class="turnos-config"><summary>Tolerancias explícitas (cero por defecto)</summary><p class="hint">Cero impide deteriorar objetivos anteriores. Un valor positivo permite hasta esa cantidad de la unidad de ese objetivo; no modifica ninguna restricción obligatoria.</p><div class="turnos-grid">${OBJETIVOS.map(o => `<div class="field"><label for="tol-${o.id}">${esc(o.label)}</label><input id="tol-${o.id}" name="tol-${o.id}" type="number" min="0" step="0.01" value="${esc(st.tolerances[o.id] || 0)}" required></div>`).join('')}</div></details>
    <button class="btn btn-primary" type="submit" ${!p.confirmed ? 'disabled' : ''}>Generar planificación optimizada</button></fieldset></form>
    ${!p.confirmed ? '<p class="hint">Guarda y confirma la demanda para habilitar la búsqueda.</p>' : ''}
    ${p.running ? `<div class="turnos-progress" role="status" aria-live="polite"><progress max="100" value="${esc(p.progress?.progress || 0)}"></progress><p>Etapa ${esc(p.progress?.stage || 1)} de 5 · ${esc(priorityName(p.progress?.active || st.order[0]))} · ${esc(p.progress?.iterations || 0)} iteraciones</p><button class="btn btn-ghost" data-act="turnos-cancelar">Cancelar búsqueda</button></div>` : ''}
    <p class="hint">ALNS es una búsqueda heurística: devuelve la mejor propuesta factible encontrada dentro del presupuesto, sin garantía de óptimo global. Con tiempo suficiente, la misma semilla y el mismo número de iteraciones reproducen la búsqueda; un corte por tiempo puede variar entre equipos.</p>
  </section>`;
  return intro + demand + priorities + run + (current ? resultados(p, current, st, esc, fmt, metricas) : '<section class="blk" id="turnos-resultados"><p class="caption">4 · Resultados</p><p class="empty">Todavía no hay propuestas. Confirma tu demanda y genera la primera.</p></section>');
}

function resultados(p, result, st, esc, fmt, metricas) {
  const m = p.model; const dates = fechasSemana(p.week); const metrics = result.metrics;
  const compare = p.results.find(r => r.id === st.compare);
  const reference = compare ? compare.metrics : evaluarObjetivos(m, m.baseline || []);
  const known = result.revision === p.revision;
  const modName = id => m.modules.find(x => x.id === id)?.label || id;
  const shiftName = id => m.shifts.find(x => x.id === id)?.label || id;
  const locked = new Set((m.baseline || []).filter(a => a.locked).map(assignmentKey));
  return `<section class="blk" id="turnos-resultados"><p class="caption">4 · Comparar y aprobar</p>
    <div class="turnos-grid"><div class="field"><label for="turnos-selected">Propuesta que quieres revisar</label><select id="turnos-selected" data-change="turnos-seleccionar">${p.results.map(r => `<option value="${esc(r.id)}" ${r.id === result.id ? 'selected' : ''}>${esc(r.id)} · ${r.status === 'borrador_validado' ? 'borrador validado' : 'propuesta'}${r.revision !== p.revision ? ' · demanda anterior' : ''}</option>`).join('')}</select></div>
      <div class="field"><label for="turnos-compare">Comparar con</label><select id="turnos-compare" data-change="turnos-comparar"><option value="original">Calendario anterior sintético</option>${p.results.filter(r => r.revision === result.revision).map(r => `<option value="${esc(r.id)}" ${r.id === st.compare ? 'selected' : ''}>${esc(r.id)}</option>`).join('')}</select></div></div>
    ${!known ? '<p class="notice notice-bad">Esta propuesta corresponde a una demanda anterior. No puede aprobarse: genera una nueva para la demanda vigente.</p>' : ''}
    <p class="notice">${metrics.costs.cobertura ? `<b>${metrics.costs.cobertura === 1 ? 'Queda 1 puesto' : `Quedan ${esc(metrics.costs.cobertura)} puestos`} sin cubrir.</b> Revisa capacidad o demanda; la búsqueda no rompe restricciones para cubrirlos.` : '<b>Demanda cubierta en esta propuesta.</b> Verifica los supuestos antes de validar el borrador.'} El resultado no publica turnos oficiales.</p>
    <p class="hint">Prioridades usadas: ${result.order.map(id => esc(OBJETIVOS.find(o => o.id === id).label)).join(' → ')}. Semilla ${esc(result.seed)} · ${esc(result.iterations)} iteraciones · ${esc(result.elapsedMs)} ms · término: ${esc({ iteraciones: 'límite de iteraciones', sin_mejora: 'sin mejoras recientes', tiempo: 'límite de tiempo', cancelado: 'cancelación' }[result.termination] || result.termination)}.</p>
    ${metricas ? `<div class="table-wrap"><table><thead><tr><th>Indicador (menor es mejor)</th><th>Referencia</th><th>${esc(result.id)}</th><th>Unidad</th></tr></thead><tbody>${OBJETIVOS.map(o => `<tr><th scope="row">${esc(o.label)}</th><td class="num">${esc(nfmt(reference.costs[o.id]))}</td><td class="num">${esc(nfmt(metrics.costs[o.id]))}</td><td>${esc(o.unit)}</td></tr>`).join('')}</tbody></table></div>
      <p class="hint">Preferencias satisfechas: ${metrics.satisfaction === null ? 'Sin dato: no hay preferencias evaluables' : `${esc(nfmt(metrics.satisfaction))}% (${esc(metrics.preferenceSatisfied)} de ${esc(metrics.preferenceChecks)} comprobaciones)`}. ${metrics.notes.map(esc).join(' ')}</p>` : ''}
    <h3>Calendario semanal por trabajador y módulo</h3><div class="table-wrap"><table class="turnos-calendar"><thead><tr><th>Código</th>${DIAS.map((d, i) => `<th>${esc(d)}<br><small>${fmt(dates[i])}</small></th>`).join('')}</tr></thead><tbody>
      ${m.workers.map(w => `<tr><th scope="row"><code>${esc(w.id)}</code></th>${DIAS.map((_, day) => { const a = result.assignments.find(x => x.workerId === w.id && x.day === day); const shift = a && m.shifts.find(x => x.id === a.shiftId); return `<td>${a ? `<b>${esc(modName(a.moduleId))}</b><br>${esc(shiftName(a.shiftId))}<br><small>${esc(hhmm(shift.start))}–${esc(hhmm(shift.end))}${locked.has(assignmentKey(a)) ? ' · bloqueado' : ''}</small>` : '<span class="dim">Sin asignación</span>'}</td>`; }).join('')}</tr>`).join('')}
    </tbody></table></div>
    <h3>Cobertura por día, módulo y jornada</h3><div class="table-wrap"><table><thead><tr><th>Día</th><th>Módulo</th><th>Jornada</th><th>Requeridos</th><th>Cubiertos</th><th>Sin cubrir</th></tr></thead><tbody>${m.demand.filter(d => d.required > 0).map(d => { const covered = result.assignments.filter(a => slotKey(a) === slotKey(d)).length; const missing = Math.max(0, d.required - covered); return `<tr><td>${esc(DIAS[d.day])}</td><td>${esc(modName(d.moduleId))}</td><td>${esc(shiftName(d.shiftId))}</td><td>${esc(d.required)}</td><td>${esc(covered)}</td><td class="${missing ? 'tone-bad' : ''}">${esc(missing)}</td></tr>`; }).join('') || '<tr><td colspan="6">Demanda explícita en cero.</td></tr>'}</tbody></table></div>
    ${metricas ? `<h3>Distribución proporcional y horas objetivo de demostración</h3><div class="table-wrap"><table><thead><tr><th>Código</th><th>Bloques</th><th>Horas</th><th>Objetivo</th><th>Desviación</th><th>Capacidad proporcional</th><th>Uso de capacidad</th></tr></thead><tbody>${metrics.loads.map(w => `<tr><td><code>${esc(w.workerId)}</code></td><td>${esc(w.blocks)}</td><td>${esc(nfmt(w.hours))}</td><td>${w.target === null ? 'Sin dato' : esc(nfmt(w.target))}</td><td>${w.deviation === null ? 'No evaluada' : esc(nfmt(w.deviation))}</td><td>${esc(nfmt(w.capacity))} h</td><td>${w.ratio === null ? 'No disponible' : `${esc(nfmt(w.ratio * 100))}%`}</td></tr>`).join('')}</tbody></table></div>
      <details><summary>Resultados de las etapas y valores conservados</summary><div class="table-wrap"><table><thead><tr><th>Etapa</th><th>Objetivo</th><th>Mejor costo encontrado</th><th>Iteraciones</th><th>Objetivos anteriores conservados</th></tr></thead><tbody>${result.stages.map((s, i) => `<tr><td>${i + 1}</td><td>${esc(s.objective)}${s.skipped ? ' · sin búsqueda por límite' : ''}</td><td>${esc(nfmt(s.costs[s.objective]))}</td><td>${esc(s.iterations)}</td><td>${Object.entries(s.lockedBefore).map(([k, v]) => `${esc(k)} ≤ ${esc(nfmt(v))}`).join('; ') || 'Primera etapa'}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
    <div class="turnos-toolbar"><span class="chip chip-${result.status === 'borrador_validado' ? 'ok' : 'neutral'}">${esc(result.status === 'borrador_validado' ? 'Borrador validado, sin publicación oficial' : 'Propuesta de demostración')}</span><button class="btn btn-primary" data-act="turnos-aprobar" data-arg="${esc(result.id)}" ${!known || !p.confirmed || p.running ? 'disabled' : ''}>Aprobar propuesta como borrador validado</button></div>
  </section>`;
}

export function vistaExcepcionesTurnos(store, esc, fmt) {
  if (!store.state.auth.puedeGestionarAlertas(store.state.user)) return '';
  const pending = store.excepcionesTurnos(); if (!pending.length) return '';
  return `<section class="blk" id="turnos-excepciones"><p class="caption">Autorizaciones de demanda tardía</p><h2 class="h-md">Solicitudes excepcionales de jefaturas</h2><p class="hint">Solo datos operativos. Autorizar permite confirmar una demanda fuera del plazo ordinario en esta demo; no valida reglas legales ni publica turnos.</p><ul class="rows">${pending.map(p => `<li class="hrow"><span class="rb-main"><b>${esc(p.ownerId)} · semana del ${fmt(p.week)}</b><span>${esc(p.reason)}</span></span><button class="btn btn-primary btn-sm" data-act="turnos-autorizar" data-arg="${esc(`${p.ownerId}|${p.week}`)}">Autorizar excepción</button></li>`).join('')}</ul></section>`;
}

export async function submitTurnos(kind, fd, { store, ui, render, toast }) {
  const st = estadoUI(store, ui);
  if (kind === 'turnos-abrir') {
    const week = String(fd.get('week') || ''); const p = store.planTurnos(week);
    if (!p) return toast('No hay una semana preparada con esa fecha en tu sesión. Prepara primero el escenario.');
    st.week = week; st.selected = null; st.compare = 'original'; return render();
  }
  if (kind === 'turnos-preparar') {
    const settings = { mode: String(fd.get('mode')), morningStart: minutos(fd.get('morningStart')), morningEnd: minutos(fd.get('morningEnd')),
      afternoonStart: minutos(fd.get('afternoonStart')), afternoonEnd: minutos(fd.get('afternoonEnd')), lockFirst: fd.get('lockFirst') === 'on', validated: fd.get('validated') === 'on' };
    for (const k of ['targetHours', 'maxHours', 'maxDays', 'maxDailyHours', 'minRestHours', 'maxConsecutiveDays']) settings[k] = fd.get(k) === '' || fd.get(k) === null ? NaN : Number(fd.get(k));
    const week = String(fd.get('week') || '');
    if (store.planTurnos(week)) { ui.confirm = { act: 'turnos-preparar', week, settings, texto: 'Reemplazar el escenario de esta semana, incluidos demanda y propuestas de demostración. Los turnos oficiales no cambian.' }; return render(); }
    const r = store.prepararTurnos(week, settings); if (r.ok) { st.week = week; st.selected = null; } return toast(r.ok ? 'Semana de demostración preparada. Revisa y guarda la demanda.' : r.motivo);
  }
  const p = store.planTurnos(st.week);
  if (!p) return toast('Prepara una semana autorizada antes de continuar.');
  if (kind === 'turnos-demanda') {
    const demand = p.model.demand.map((d, i) => ({ ...d, required: fd.get(`d-${i}`) === '' || fd.get(`d-${i}`) === null ? NaN : Number(fd.get(`d-${i}`)) }));
    const r = store.guardarDemandaTurnos(st.week, demand); return toast(r.ok ? 'Borrador guardado en memoria. Confirma la demanda antes de optimizar.' : r.motivo);
  }
  if (kind === 'turnos-excepcion') { const r = store.solicitarExcepcionTurnos(st.week, String(fd.get('reason'))); return toast(r.ok ? 'Solicitud registrada. Personas debe autorizarla desde su vista.' : r.motivo); }
  if (kind === 'turnos-generar') {
    for (const k of Object.keys(SEARCH_DEFAULT)) st.search[k] = fd.get(k) === '' || fd.get(k) === null ? NaN : Number(fd.get(k));
    for (const k of ORDEN_DEFAULT) st.tolerances[k] = fd.get(`tol-${k}`) === '' || fd.get(`tol-${k}`) === null ? NaN : Number(fd.get(`tol-${k}`));
    const owner = store.state.user.usuario_id;
    const work = store.generarTurnos(st.week, st.order, { ...st.search, tolerances: st.tolerances, onProgress: () => render() }); render();
    const r = await work;
    if (store.state.user?.usuario_id !== owner) return render();
    if (r.ok) { st.selected = r.id; st.compare = 'original'; }
    return toast(r.ok ? 'Propuesta factible generada. Revisa los faltantes y compárala antes de aprobar.' : r.motivo);
  }
}

export function clickTurnos(act, arg, { store, ui, render, toast }) {
  const st = estadoUI(store, ui);
  if (act === 'turnos-restablecer') { const r = store.ordenarTurnos(st.week, ORDEN_DEFAULT); if (r.ok) st.order = [...ORDEN_DEFAULT]; return r.ok ? render() : toast(r.motivo); }
  if (act === 'turnos-cancelar') { const r = store.cancelarTurnos(st.week); return toast(r.ok ? 'Cancelación solicitada.' : r.motivo); }
  if (act === 'turnos-confirmar') ui.confirm = { act, week: st.week, texto: 'Confirmar la demanda semanal guardada con la fecha simulada de esta demo. Los cambios posteriores exigirán una nueva confirmación.' };
  if (act === 'turnos-aprobar') ui.confirm = { act, week: st.week, id: arg, texto: 'Validar esta propuesta como borrador de planificación. Revisa los puestos sin cubrir. Esta acción no modifica ni publica turnos oficiales.' };
  if (act === 'turnos-autorizar') { const [owner, week] = String(arg).split('|'); ui.confirm = { act, owner, week, texto: 'Autorizar excepcionalmente la confirmación de esta demanda tardía en la demostración. La acción queda en la bitácora.' }; }
  return render();
}
export function confirmarTurnos(c, { store, ui, render, toast }) {
  const st = estadoUI(store, ui); let r;
  if (c.act === 'turnos-confirmar') r = store.confirmarDemandaTurnos(c.week);
  if (c.act === 'turnos-aprobar') r = store.aprobarTurnos(c.week, c.id, { confirmado: true });
  if (c.act === 'turnos-autorizar') r = store.autorizarExcepcionTurnos(c.owner, c.week, { confirmado: true });
  if (c.act === 'turnos-preparar') { r = store.prepararTurnos(c.week, c.settings); if (r.ok) { st.week = c.week; st.selected = null; } }
  return r ? toast(r.ok ? 'Acción registrada en esta demo, sin cambios oficiales.' : r.motivo) : render();
}
export function changeTurnos(el, { store, ui, render }) {
  const st = estadoUI(store, ui);
  if (el.dataset.change === 'turnos-prioridad') {
    const index = st.order.indexOf(el.dataset.arg); const position = Number(el.value);
    if (index >= 0 && Number.isInteger(position) && position >= 0 && position < 5) {
      const order = [...st.order]; order.splice(position, 0, ...order.splice(index, 1));
      if (store.ordenarTurnos(st.week, order).ok) st.order = order;
    }
  }
  if (el.dataset.change === 'turnos-seleccionar') st.selected = el.value;
  if (el.dataset.change === 'turnos-comparar') st.compare = el.value;
  return render();
}
