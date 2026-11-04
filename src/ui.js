// Interfaz: una vista por rol. Todo lo que se muestra pasa por el motor de permisos (store.state.auth).
import { evaluarHito, avanceColaborador, agruparAlertas, fmt, diffDays, NOMBRE_HITO, TIPOS_HITO, CRIT_PESO, isISO } from './rules.js';
import { MATRIZ_EFECTIVA, HITOS_TECNICOS } from './permissions.js';
import { parseCSV, toCSV } from './csv.js';

export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ui = {
  loginStep: null,      // { id, canal } durante el ingreso con código
  loginError: '',
  tab: 'resumen',       // pestaña Personas/Admin
  detalle: null,        // colaborador expandido (jefatura / Personas)
  tiFiltro: 'todos',
  reasignando: null,    // hito_id con formulario abierto
  confirm: null,        // { texto, act, arg }
  toast: '',
  busqueda: null,       // { id, ok }
  exportTexto: null,
  alertaAbierta: null,
  cargaErrores: null,
};
let store; let root;

// ---------- utilidades de presentación ----------
const nombreDe = (id) => { const u = store.state.auth.users.get(id); return (u && u.nombre_ficticio) || id; };
const funcion = { Personas: 'Equipo de Personas', TI: 'Soporte TI', Jefatura: 'Jefatura' };

function chip(ev) {
  const m = {
    Cumplido: ['ok', 'Listo'],
    Pendiente: ['neutral', 'Pendiente'],
    Vencido: ['bad', `Atrasado · ${ev.diasVencido} d`],
    'Por verificar': ['warn', 'Por verificar'],
  }[ev.estadoReal];
  return `<span class="chip chip-${m[0]}">${esc(m[1])}</span>`;
}
const dot = s => `<span class="dot dot-${s}" aria-hidden="true"></span>`;
const semTxt = { rojo: 'Atraso crítico', amarillo: 'Con atrasos o por verificar', verde: 'Completo', gris: 'En curso' };
function barra(av) {
  const pct = av.total ? Math.round(av.cumplidos / av.total * 100) : 0;
  return `<div class="bar" role="img" aria-label="${av.cumplidos} de ${av.total} hitos listos"><span style="width:${pct}%"></span></div>`;
}
const toastMsg = t => { ui.toast = t; render(); setTimeout(() => { if (ui.toast === t) { ui.toast = ''; render(); } }, 3200); };

function hitosVisibles(u) {
  const { data, auth, idx, hoy } = store.state;
  return data.hitos.filter(h => auth.puedeVerHito(u, h)).map(h => ({ h, ev: evaluarHito(h, idx, hoy) }));
}

// ---------- shell ----------
function header() {
  const s = store.state; const u = s.user;
  return `<header class="top">
    <div class="top-in">
      <div class="brand"><span class="brand-mark" aria-hidden="true">S</span><div><strong>Sprint</strong><small>Onboarding · Modo Seguro</small></div></div>
      ${u ? `<div class="who">
          <div class="who-txt"><strong>${esc(u.nombre_ficticio || u.usuario_id)}</strong><small><span class="role role-${esc(u.rol)}">${esc(u.rol)}</span> ${esc(u.usuario_id)}</small></div>
          <button class="btn btn-ghost" data-act="logout">Cambiar usuario</button>
        </div>` : ''}
    </div>
    <div class="cut">Fecha de corte <b>${fmt(s.hoy)}</b> · datos 100% sintéticos · todo cambio queda en la bitácora</div>
  </header>`;
}

const VISTAS = { Colaborador: u => vColaborador(u), Jefatura: u => vJefatura(u), TI: u => vTI(u), Personas: u => vPersonas(u), Administrador: u => vPersonas(u) };

function vDenegado() {
  return `<section class="card"><h1>No tienes acceso</h1><p>Tu cuenta no tiene un rol válido para esta herramienta. Contacta al equipo de Personas.</p>
    <div><button class="btn btn-primary" data-act="logout">Volver al inicio</button></div></section>`;
}
function vError() {
  return `<section class="card"><h1>Algo no funcionó en esta vista</h1>
    <p>No se perdió ningún dato y el error quedó en la bitácora. Puedes volver al inicio o, si se repite, reiniciar la demo.</p>
    <div class="row"><button class="btn btn-primary" data-act="logout">Volver al inicio</button><button class="btn btn-ghost" data-act="reset">Reiniciar demo</button></div></section>`;
}
function avisos() {
  const s = store.state; const out = [];
  if (!s.almacenamiento) out.push('Este navegador no permite guardar datos: los cambios se pierden al recargar la página.');
  if (s.estadoDescartado && s.user && s.auth.puedeVerCalidad(s.user)) out.push('Se ignoró información guardada inválida en este navegador. Quedó registrado en la bitácora.');
  return out.map(t => `<p class="notice notice-bad" role="status">${esc(t)}</p>`).join('');
}

function render() {
  const s = store.state; const u = s.user;
  let body;
  try {
    if (!u) body = vLogin();
    else if (!s.auth.cuentaValida(u) || !VISTAS[u.rol]) body = vDenegado(); // denegar por defecto
    else body = VISTAS[u.rol](u);
  } catch (err) {
    console.error(err);
    try { store.registrarError(`vista ${u ? u.rol : 'ingreso'}`, err && err.message); } catch { /* noop */ }
    body = vError();
  }
  root.innerHTML = header() + `<main class="wrap">${avisos()}${body}</main>` + modal() + (ui.toast ? `<div class="toast" role="status" aria-live="polite">${esc(ui.toast)}</div>` : '');
}

function modal() {
  if (!ui.confirm) return '';
  return `<div class="overlay"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-t">
    <h3 id="dlg-t">Confirmar acción</h3><p>${esc(ui.confirm.texto)}</p>
    <div class="row-end"><button class="btn btn-ghost" data-act="cancel">Cancelar</button><button class="btn btn-primary" data-act="confirm-ok">Confirmar</button></div>
  </div></div>`;
}

// ---------- login ----------
const DEMO = [
  ['COL-002', 'Camila Rojas', 'Colaboradora de Operaciones, sin acceso aún'],
  ['COL-019', 'Hugo Soto', 'Colaborador sin jefatura asignada'],
  ['JEF-002', 'Felipe Jefatura 02', 'Jefatura de Operaciones'],
  ['TI-004', 'Alex Soporte TI 04', 'Soporte TI: no ve datos personales'],
  ['PER-001', 'Hugo Personas 01', 'Equipo de Personas: visión completa'],
];
function vLogin() {
  const s = store.state;
  const internos = ['Jefatura', 'Personas', 'TI', 'Administrador'].map(rol =>
    `<optgroup label="${rol}">${s.data.usuarios.filter(x => x.rol === rol).map(x => `<option value="${esc(x.usuario_id)}">${esc(x.usuario_id)} · ${esc(x.nombre_ficticio)}</option>`).join('')}</optgroup>`).join('');
  let paso;
  if (!ui.loginStep) {
    paso = `<form data-form="col-id" class="stack">
      <label for="col-id">Tu código de colaborador</label>
      <input id="col-id" name="id" placeholder="COL-002" autocomplete="off" inputmode="text" required>
      <button class="btn btn-primary" type="submit">Continuar</button>
      <p class="hint">No necesitas correo corporativo.</p></form>`;
  } else {
    const st = ui.loginStep;
    paso = `<form data-form="col-code" class="stack">
      <p>${st.canal ? `Te enviamos un código de 6 dígitos por <b>${esc(st.canal)}</b>.` : 'No tienes un canal de contacto registrado. Pide tu código al equipo de Personas.'}</p>
      <label for="col-code">Código</label>
      <input id="col-code" name="code" inputmode="numeric" maxlength="6" placeholder="123456" required>
      <button class="btn btn-primary" type="submit">Ingresar</button>
      <p class="hint">Demo: el código es 123456. <button type="button" class="link" data-act="login-back">Usar otro código de colaborador</button></p></form>`;
  }
  return `<section class="login">
    <div class="login-intro">
      <p class="eyebrow">Nexo Laboral Group · Piloto</p>
      <h1>Qué falta para tu ingreso, quién lo resuelve y para cuándo.</h1>
      <p class="lead">Cada persona ve solo lo que necesita: el colaborador su checklist, la jefatura su equipo, TI los equipos y accesos, y Personas el proceso completo.</p>
    </div>
    <div class="login-grid">
      <div class="card"><h2>Soy colaborador/a</h2>${ui.loginError ? `<p class="err" role="alert">${esc(ui.loginError)}</p>` : ''}${paso}</div>
      <div class="card"><h2>Equipo interno</h2>
        <form data-form="staff" class="stack">
          <label for="staff-id">Cuenta</label>
          <select id="staff-id" name="id">${internos}</select>
          <button class="btn btn-primary" type="submit">Ingresar</button>
          <p class="hint">En producción entra con el inicio de sesión corporativo.</p>
        </form></div>
    </div>
    <div class="demo"><h2 class="h-sm">Recorrido de demo</h2><div class="demo-list">
      ${DEMO.map(([id, n, d]) => `<button class="demo-item" data-act="quick" data-arg="${id}"><b>${esc(n)}</b><span>${esc(d)}</span><code>${id}</code></button>`).join('')}
    </div></div>
  </section>`;
}

// ---------- colaborador ----------
const GRUPOS = [['Antes de tu día 1', ['Contrato']], ['Tu día 1', ['Equipo', 'Acceso']], ['Tu primera semana', ['Reunión', 'Plan']]];
function vColaborador(u) {
  const s = store.state; const c = store.verColaborador(u.usuario_id);
  if (!c) return `<div class="card"><p>No encontramos tu ficha. Contacta al equipo de Personas.</p></div>`;
  const items = hitosVisibles(u);
  const av = avanceColaborador(c.colaborador_id, s.idx, s.hoy);
  const vencidos = items.filter(x => x.ev.estadoReal === 'Vencido');
  const jef = c.jefatura_id ? s.auth.users.get(c.jefatura_id) : null;
  const misRep = store.misReportes();
  return `<div class="mobile">
    <section class="card hello">
      <p class="eyebrow">${esc(c.area)} · ${esc(c.sede)} · ${esc(c.modalidad)}</p>
      <h1>Hola${u.nombre_ficticio ? `, ${esc(String(u.nombre_ficticio).split(' ')[0])}` : ''}</h1>
      <p>Ingreso: <b>${fmt(c.fecha_ingreso)}</b> · Turno: ${c.tipo_turno ? `<b>${esc(c.tipo_turno)}</b>` : '<span class="missing">por confirmar (Personas lo está validando)</span>'}</p>
      <div class="progress"><span><b>${av.cumplidos}</b> de ${av.total} listos</span>${barra(av)}</div>
      ${vencidos.length ? `<p class="notice notice-bad">${vencidos.length} ${vencidos.length === 1 ? 'tarea está atrasada' : 'tareas están atrasadas'}, y ninguna depende de ti. Los responsables las tienen en su bandeja.</p>` : ''}
      ${c.correo_corporativo_activo === 'No' ? '<p class="notice">Aún no tienes correo corporativo. Puedes usar esta página desde tu teléfono igual.</p>' : ''}
    </section>
    ${GRUPOS.map(([g, tipos]) => `<section class="group"><h2 class="h-sm">${g}</h2><ul class="checklist">
      ${items.filter(x => tipos.includes(x.h.tipo_hito)).map(({ h, ev }) => `<li class="check check-${ev.estadoReal === 'Cumplido' ? 'ok' : ev.estadoReal === 'Vencido' ? 'bad' : ev.estadoReal === 'Por verificar' ? 'warn' : 'neutral'}">
        <div><b>${esc(NOMBRE_HITO[h.tipo_hito])}</b><small>Lo gestiona: ${esc(h.responsable_tipo === 'Jefatura' ? 'tu jefatura' : funcion[h.responsable_tipo])} · Plazo <span class="nw">${fmt(ev.limite)}</span></small>
        ${ev.estadoReal === 'Por verificar' ? '<small class="missing">Figura como listo, pero falta confirmar la fecha.</small>' : ''}</div>${chip(ev)}</li>`).join('')}
    </ul></section>`).join('')}
    <section class="card"><h2 class="h-sm">A quién pedir ayuda</h2><dl class="kv">
      <dt>Tu jefatura</dt><dd>${jef ? esc(jef.nombre_ficticio) : '<span class="missing">Aún no tienes jefatura asignada. Personas ya tiene la alerta.</span>'}</dd>
      <dt>Equipo y accesos</dt><dd>Soporte TI</dd>
      <dt>Contrato y dudas generales</dt><dd>Equipo de Personas</dd>
      <dt>Tu canal registrado</dt><dd>${c.canal_contacto ? esc(c.canal_contacto) : '<span class="missing">Sin canal registrado</span>'}</dd>
    </dl></section>
    <section class="card"><h2 class="h-sm">¿Algo no coincide con lo que te dijeron?</h2>
      <form data-form="reporte" class="stack">
        <label for="rep-tipo">Qué pasó</label>
        <select id="rep-tipo" name="tipo">
          <option>Mis tareas no coinciden con lo ofrecido</option><option>Mi turno cambió o no lo conozco</option>
          <option>No tengo equipo o accesos</option><option>No sé quién es mi jefatura</option><option>Otro</option></select>
        <label for="rep-txt">Cuéntanos más (opcional)</label>
        <textarea id="rep-txt" name="texto" rows="3" maxlength="500"></textarea>
        <p class="hint">Solo lo lee el equipo de Personas. Tu jefatura no lo ve y no se usa para evaluarte.</p>
        <button class="btn btn-primary" type="submit">Enviar a Personas</button>
      </form>
      ${misRep.length ? `<ul class="mini">${misRep.map(r => `<li>${esc(r.tipo)} <span class="chip chip-neutral">${esc(r.estado)}</span></li>`).join('')}</ul>` : ''}
    </section>
  </div>`;
}

// ---------- jefatura ----------
function vJefatura(u) {
  const s = store.state; const { auth, idx, hoy } = s;
  const equipo = [...auth.scope(u)].map(id => idx.colab.get(id)).filter(Boolean).sort((a, b) => String(b.fecha_ingreso || '').localeCompare(String(a.fecha_ingreso || '')));
  const items = hitosVisibles(u);
  const mias = items.filter(x => x.h.responsable_id === u.usuario_id && x.ev.estadoReal !== 'Cumplido')
    .sort((a, b) => b.ev.diasVencido - a.ev.diasVencido);
  const vencEquipo = items.filter(x => x.ev.estadoReal === 'Vencido');
  const proximos = equipo.filter(c => c.fecha_ingreso > hoy);
  const recientes = equipo.filter(c => c.fecha_ingreso <= hoy && diffDays(hoy, c.fecha_ingreso) <= 30);
  const metr = auth.alcanceMetricas(u) === 'equipo' ? metricasPorTipo(items) : null;
  return `<div class="page-head"><div><p class="eyebrow">${esc(u.area)}</p><h1>Tu equipo de ingreso</h1></div>
      <form data-form="buscar" class="search"><label for="q" class="sr">Buscar colaborador por ID</label><input id="q" name="q" placeholder="Buscar por ID, ej. COL-014"><button class="btn btn-ghost" type="submit">Buscar</button></form></div>
    ${ui.busqueda ? `<p class="notice ${ui.busqueda.ok ? '' : 'notice-bad'}">${ui.busqueda.ok ? `${esc(ui.busqueda.id)} está en tu equipo.` : `${esc(ui.busqueda.id)} está fuera de tu alcance. El intento quedó registrado en la bitácora.`}</p>` : ''}
    <div class="kpis">
      ${kpi(equipo.length, 'personas en tu equipo')}
      ${kpi(mias.length, 'acciones tuyas por hacer', mias.length ? 'warn' : '')}
      ${kpi(vencEquipo.length, 'hitos atrasados del equipo (de cualquier área)', vencEquipo.length ? 'bad' : '')}
    </div>
    <section class="card"><h2 class="h-sm">Tus acciones</h2>
      ${mias.length ? `<ul class="actions">${mias.map(({ h, ev }) => `<li><div><b>${esc(NOMBRE_HITO[h.tipo_hito])}</b> · ${esc(nombreDe(h.colaborador_id))}<small>Plazo ${fmt(ev.limite)}${ev.flags.includes('plazo_corrido') ? ` · registrado para ${fmt(ev.limiteRegistrado)}` : ''}</small></div>
        <div class="row">${chip(ev)}<button class="btn btn-primary btn-sm" data-act="completar" data-arg="${esc(h.hito_id)}">Marcar como cumplido</button></div></li>`).join('')}</ul>`
        : '<p class="empty">No tienes acciones pendientes.</p>'}
    </section>
    <section class="card"><h2 class="h-sm">Próximos ingresos</h2>
      ${proximos.length ? listaIngresos(proximos) : `<p class="empty">No hay ingresos con fecha posterior al ${fmt(hoy)} en tu equipo.</p>`}
      ${recientes.length ? `<h3 class="h-xs">Ingresaron en los últimos 30 días</h3>${listaIngresos(recientes)}` : ''}
    </section>
    <section class="card"><h2 class="h-sm">Personas de tu equipo</h2>
      <div class="table-wrap"><table><thead><tr><th>Persona</th><th>Ingreso</th><th>Turno</th><th>Correo corp.</th><th>Avance</th><th>Estado</th><th></th></tr></thead><tbody>
      ${equipo.map(c => { const av = avanceColaborador(c.colaborador_id, idx, hoy); return `<tr>
        <td><b>${esc(nombreDe(c.colaborador_id))}</b><br><code>${esc(c.colaborador_id)}</code></td><td class="num">${fmt(c.fecha_ingreso)}</td>
        <td>${c.tipo_turno ? esc(c.tipo_turno) : '<span class="missing">Sin dato</span>'}</td><td>${esc(c.correo_corporativo_activo)}</td>
        <td class="num">${av.cumplidos}/${av.total} ${barra(av)}</td><td>${dot(av.semaforo)} ${semTxt[av.semaforo]}</td>
        <td><button class="btn btn-ghost btn-sm" data-act="detalle" data-arg="${esc(c.colaborador_id)}">${ui.detalle === c.colaborador_id ? 'Cerrar' : 'Ver hitos'}</button></td></tr>
        ${ui.detalle === c.colaborador_id ? `<tr class="sub"><td colspan="7">${tablaHitos(u, c.colaborador_id)}</td></tr>` : ''}`; }).join('')}
      </tbody></table></div>
      <p class="hint">No ves canales de contacto ni los reportes que las personas envían a Personas.</p>
    </section>
    ${metr ? `<section class="card"><h2 class="h-sm">Cumplimiento de tu equipo por hito</h2>${metr}<p class="hint">Solo datos agregados de tu equipo.</p></section>` : ''}`;
}
const listaIngresos = l => `<ul class="mini">${l.map(c => `<li><b>${esc(nombreDe(c.colaborador_id))}</b> · ${fmt(c.fecha_ingreso)} · ${esc(c.modalidad)} · ${c.tipo_turno ? esc(c.tipo_turno) : '<span class="missing">turno sin dato</span>'}</li>`).join('')}</ul>`;
const kpi = (n, t, tone = '') => `<div class="kpi ${tone ? 'kpi-' + tone : ''}"><b>${n}</b><span>${esc(t)}</span></div>`;

function tablaHitos(u, colId) {
  const s = store.state;
  const rows = (s.idx.hitosPorColab.get(colId) || []).filter(h => s.auth.puedeVerHito(u, h));
  return `<div class="table-wrap"><table class="inner"><thead><tr><th>Hito</th><th>Responsable</th><th>Plazo (catálogo)</th><th>Fecha registrada</th><th>Estado</th><th></th></tr></thead><tbody>
  ${rows.map(h => { const ev = evaluarHito(h, s.idx, s.hoy); const pc = s.auth.puedeCompletar(u, h, s.hoy); const pr = s.auth.puedeReasignar(u, h);
    return `<tr><td><b>${esc(h.tipo_hito)}</b><br><code>${esc(h.hito_id)}</code></td>
      <td>${esc(funcion[h.responsable_tipo])}${s.auth.puedeVerResponsableId(u, h) ? `<br><code>${h.responsable_id ? esc(h.responsable_id) : '<span class="missing">sin responsable</span>'}</code>` : ''}</td>
      <td class="num">${fmt(ev.limite)}</td><td class="num">${fmt(ev.limiteRegistrado)}${ev.flags.includes('plazo_corrido') ? ' <span class="chip chip-warn">movida</span>' : ''}</td>
      <td>${chip(ev)}</td>
      <td><div class="row">${pc.ok ? `<button class="btn btn-primary btn-sm" data-act="completar" data-arg="${esc(h.hito_id)}">Cumplido</button>` : ''}
        ${pr.ok ? `<button class="btn btn-ghost btn-sm" data-act="reasignar-open" data-arg="${esc(h.hito_id)}">Reasignar</button>` : ''}
        ${!pc.ok && !pr.ok && ev.estadoReal !== 'Cumplido' ? `<small class="muted">${esc(pc.motivo)}</small>` : ''}</div></td></tr>
      ${ui.reasignando === h.hito_id ? `<tr class="sub"><td colspan="6">${formReasignar(u, h)}</td></tr>` : ''}`; }).join('')}
  </tbody></table></div>`;
}

function formReasignar(u, h) {
  const cands = store.state.auth.candidatos(u, h);
  if (!cands.length) return `<p class="notice notice-bad">No hay cuentas válidas para este hito. ${h.responsable_tipo === 'Jefatura' ? 'Ninguna jefatura tiene a esta persona en su equipo_asignado: hay que corregirlo en el sistema de origen.' : ''}</p>`;
  return `<form data-form="reasignar" data-arg="${esc(h.hito_id)}" class="inline-form">
    <label for="re-${esc(h.hito_id)}">Nuevo responsable</label>
    <select id="re-${esc(h.hito_id)}" name="nuevo">${cands.map(c => `<option value="${esc(c.usuario_id)}">${esc(c.usuario_id)} · ${esc(u.rol === 'TI' ? c.nombre_ficticio : c.nombre_ficticio)}</option>`).join('')}</select>
    <label for="rm-${esc(h.hito_id)}">Motivo (queda en la bitácora)</label>
    <input id="rm-${esc(h.hito_id)}" name="motivo" required minlength="5" placeholder="Ej.: responsable vacío desde la carga">
    <div class="row"><button class="btn btn-primary btn-sm" type="submit">Reasignar</button><button class="btn btn-ghost btn-sm" type="button" data-act="reasignar-close">Cancelar</button></div>
  </form>`;
}

function metricasPorTipo(items) {
  const tipos = [...new Set(items.map(x => x.h.tipo_hito))].sort((a, b) => TIPOS_HITO.indexOf(a) - TIPOS_HITO.indexOf(b));
  return `<div class="metric-rows">${tipos.map(t => {
    const l = items.filter(x => x.h.tipo_hito === t); const ok = l.filter(x => x.ev.estadoReal === 'Cumplido').length;
    const pct = Math.round(ok / l.length * 100);
    return `<div class="metric"><span>${esc(t)}</span><div class="bar bar-lg"><span style="width:${pct}%"></span></div><b class="num">${pct}%</b><small class="num">${ok}/${l.length}</small></div>`;
  }).join('')}</div>`;
}

// ---------- TI ----------
function vTI(u) {
  const s = store.state;
  const abiertos = hitosVisibles(u).filter(x => x.ev.estadoReal !== 'Cumplido')
    .sort((a, b) => b.ev.diasVencido - a.ev.diasVencido || CRIT_PESO[b.ev.crit] - CRIT_PESO[a.ev.crit]);
  const filtros = { todos: abiertos, mios: abiertos.filter(x => x.h.responsable_id === u.usuario_id), sin: abiertos.filter(x => !x.h.responsable_id) };
  const lista = filtros[ui.tiFiltro];
  const btnF = (k, t) => `<button class="seg ${ui.tiFiltro === k ? 'on' : ''}" data-act="ti-filtro" data-arg="${k}" aria-pressed="${ui.tiFiltro === k}">${t} <span class="num">${filtros[k].length}</span></button>`;
  return `<div class="page-head"><div><p class="eyebrow">Soporte TI</p><h1>Equipos y accesos por entregar</h1></div></div>
    <p class="notice">Ves solo los hitos de Equipo y Acceso, identificados por código. Los nombres y canales de contacto no son necesarios para resolverlos.</p>
    <div class="kpis">
      ${kpi(abiertos.length, 'casos técnicos abiertos')}
      ${kpi(abiertos.filter(x => x.ev.estadoReal === 'Vencido').length, 'vencidos según el plazo del catálogo', 'bad')}
      ${kpi(filtros.sin.length, 'sin responsable asignado', filtros.sin.length ? 'warn' : '')}
      ${kpi(filtros.mios.length, 'asignados a ti')}
    </div>
    <div class="segs" role="group" aria-label="Filtro">${btnF('todos', 'Todos')}${btnF('mios', 'Mis casos')}${btnF('sin', 'Sin responsable')}</div>
    <section class="card"><div class="table-wrap"><table><thead><tr><th>Caso</th><th>Necesita</th><th>Contexto</th><th>Debía estar</th><th>Estado</th><th>Responsable</th><th></th></tr></thead><tbody>
    ${lista.map(({ h, ev }) => { const c = s.idx.colab.get(h.colaborador_id); const pc = s.auth.puedeCompletar(u, h, s.hoy); const pr = s.auth.puedeReasignar(u, h);
      return `<tr><td><code>${esc(h.hito_id)}</code><br><small><code>${esc(h.colaborador_id)}</code></small></td><td><b>${esc(h.tipo_hito)}</b><br><small>Criticidad ${esc(ev.crit)}</small></td>
      <td><small>${esc(c.sede)} · ${esc(c.modalidad)}<br>Usa ${esc(c.dispositivo_principal || 'dispositivo sin dato').toLowerCase()} · correo corp. ${esc(c.correo_corporativo_activo)}</small></td>
      <td class="num">${fmt(ev.limite)}</td><td>${chip(ev)}</td>
      <td>${h.responsable_id ? `<code>${esc(h.responsable_id)}</code>` : '<span class="missing">Sin asignar</span>'}</td>
      <td><div class="row">${pc.ok ? `<button class="btn btn-primary btn-sm" data-act="completar" data-arg="${esc(h.hito_id)}">Marcar entregado</button>` : ''}
        ${!h.responsable_id && pr.ok ? `<button class="btn btn-primary btn-sm" data-act="tomar" data-arg="${esc(h.hito_id)}">Tomar caso</button>` : ''}
        ${h.responsable_id && pr.ok ? `<button class="btn btn-ghost btn-sm" data-act="reasignar-open" data-arg="${esc(h.hito_id)}">Reasignar</button>` : ''}</div></td></tr>
      ${ui.reasignando === h.hito_id ? `<tr class="sub"><td colspan="7">${formReasignar(u, h)}</td></tr>` : ''}`; }).join('') || '<tr><td colspan="7" class="empty">Sin casos en este filtro.</td></tr>'}
    </tbody></table></div></section>`;
}

// ---------- Personas / Administrador ----------
const TABS = [['resumen', 'Resumen'], ['casos', 'Casos críticos'], ['calidad', 'Calidad de datos'], ['reportes', 'Reportes'], ['permisos', 'Permisos'], ['bitacora', 'Bitácora'], ['datos', 'Datos']];
function vPersonas(u) {
  const rep = store.reportesVisibles().filter(r => r.estado !== 'Cerrado').length;
  const body = { resumen: tResumen, casos: tCasos, calidad: tCalidad, reportes: tReportes, permisos: tPermisos, bitacora: tBitacora, datos: tDatos }[ui.tab](u);
  return `<div class="page-head"><div><p class="eyebrow">${u.rol === 'Administrador' ? 'Administración' : 'Equipo de Personas'}</p><h1>Proceso de ingreso completo</h1></div></div>
    <nav class="tabs" role="tablist">${TABS.map(([k, t]) => `<button role="tab" aria-selected="${ui.tab === k}" class="tab ${ui.tab === k ? 'on' : ''}" data-act="tab" data-arg="${k}">${t}${k === 'reportes' && rep ? ` <span class="badge">${rep}</span>` : ''}${k === 'calidad' ? ` <span class="badge badge-soft" title="Reglas con alertas de severidad alta">${new Set(store.state.alertas.filter(a => a.sev === 'alta').map(a => a.regla)).size}</span>` : ''}</button>`).join('')}</nav>
    ${body}`;
}

function tResumen(u) {
  const s = store.state; const items = hitosVisibles(u);
  const abiertos = items.filter(x => x.ev.estadoReal !== 'Cumplido' && x.ev.estadoReal !== 'Por verificar');
  const venc = items.filter(x => x.ev.estadoReal === 'Vencido').length;
  const reg = items.filter(x => x.h.estado === 'Atrasado').length;
  const pv = items.filter(x => x.ev.estadoReal === 'Por verificar').length;
  const personasCrit = s.data.colaboradores.filter(c => avanceColaborador(c.colaborador_id, s.idx, s.hoy).vencidosAltos > 0).length;
  const areas = ['Operaciones', 'Comercial', 'Tecnología', 'Personas'];
  const celda = (l) => { if (!l.length) return '<td>—</td>'; const p = Math.round(l.filter(x => x.ev.estadoReal === 'Cumplido').length / l.length * 100); return `<td class="num heat" style="--p:${p}">${p}%</td>`; };
  return `<div class="kpis">
      ${kpi(abiertos.length, 'hitos abiertos')}
      ${kpi(venc, `atrasados según el catálogo (el registro dice ${reg})`, 'bad')}
      ${kpi(pv, 'marcados "Cumplido" sin respaldo de fecha', 'warn')}
      ${kpi(personasCrit, 'personas con un atraso crítico', 'bad')}
    </div>
    ${venc > reg ? `<p class="notice notice-bad"><b>El registro subestima los atrasos.</b> ${venc - reg} hitos figuran como "Pendiente", pero su fecha límite se movió más allá del plazo del catálogo. Aquí se cuentan como atrasados.</p>` : ''}
    <section class="card"><h2 class="h-sm">Cumplimiento real por hito y área</h2>
      <div class="table-wrap"><table class="heatmap"><thead><tr><th>Hito</th>${areas.map(a => `<th>${a}</th>`).join('')}<th>Total</th></tr></thead><tbody>
      ${TIPOS_HITO.map(t => `<tr><th scope="row">${t}</th>${areas.map(a => celda(items.filter(x => x.h.tipo_hito === t && s.idx.colab.get(x.h.colaborador_id)?.area === a))).join('')}${celda(items.filter(x => x.h.tipo_hito === t))}</tr>`).join('')}
      </tbody></table></div><p class="hint">Porcentaje de hitos cumplidos con fecha válida. Datos agregados, sin identificar personas.</p></section>
    <section class="card"><h2 class="h-sm">Atrasos por sede</h2>${porSede(items)}</section>`;
}
function porSede(items) {
  const s = store.state; const sedes = ['Santiago Centro', 'Providencia', 'Valparaíso', 'Concepción'];
  const max = Math.max(1, ...sedes.map(se => items.filter(x => x.ev.estadoReal === 'Vencido' && s.idx.colab.get(x.h.colaborador_id)?.sede === se).length));
  return `<div class="metric-rows">${sedes.map(se => { const n = items.filter(x => x.ev.estadoReal === 'Vencido' && s.idx.colab.get(x.h.colaborador_id)?.sede === se).length;
    return `<div class="metric"><span>${se}</span><div class="bar bar-lg bar-bad"><span style="width:${Math.round(n / max * 100)}%"></span></div><b class="num">${n}</b><small>atrasados</small></div>`; }).join('')}</div>`;
}

function tCasos(u) {
  const s = store.state;
  const lista = s.data.colaboradores.filter(c => s.auth.puedeVerColaborador(u, c.colaborador_id)).map(c => ({ c, av: avanceColaborador(c.colaborador_id, s.idx, s.hoy) }))
    .filter(x => x.av.vencidos || x.av.porVerificar || !x.c.jefatura_id)
    .sort((a, b) => (!b.c.jefatura_id) - (!a.c.jefatura_id) || b.av.vencidosAltos - a.av.vencidosAltos || b.av.vencidos - a.av.vencidos);
  return `<p class="hint">${lista.length} personas con atrasos, hitos por verificar o sin jefatura. Abre un caso para reasignar responsables.</p>
  <section class="card"><div class="table-wrap"><table><thead><tr><th>Persona</th><th>Área · sede</th><th>Jefatura</th><th>Canal</th><th>Avance</th><th>Atrasos</th><th></th></tr></thead><tbody>
  ${lista.map(({ c, av }) => `<tr><td>${dot(av.semaforo)} <b>${esc(nombreDe(c.colaborador_id))}</b><br><code>${esc(c.colaborador_id)}</code></td>
    <td>${esc(c.area)}<br><small>${esc(c.sede)}</small></td>
    <td>${c.jefatura_id ? `<code>${esc(c.jefatura_id)}</code>` : '<span class="chip chip-bad">Sin jefatura</span>'}</td>
    <td>${c.canal_contacto ? esc(c.canal_contacto) : '<span class="missing">Sin dato</span>'}</td>
    <td class="num">${av.cumplidos}/${av.total}</td><td class="num">${av.vencidos}${av.vencidosAltos ? ` <small>(${av.vencidosAltos} críticos)</small>` : ''}${av.porVerificar ? `<br><small>${av.porVerificar} por verificar</small>` : ''}</td>
    <td><button class="btn btn-ghost btn-sm" data-act="detalle" data-arg="${esc(c.colaborador_id)}">${ui.detalle === c.colaborador_id ? 'Cerrar' : 'Abrir'}</button></td></tr>
    ${ui.detalle === c.colaborador_id ? `<tr class="sub"><td colspan="7">${tablaHitos(u, c.colaborador_id)}</td></tr>` : ''}`).join('')}
  </tbody></table></div></section>`;
}

function tCalidad(u) {
  if (!store.state.auth.puedeVerCalidad(u)) return vDenegado();
  const grupos = agruparAlertas(store.state.alertas);
  return `<p class="hint">Reglas del diccionario de datos aplicadas a los 4 archivos. Nada se corrige automáticamente: cada alerta indica qué hacer.</p>
  <div class="alerts">${grupos.map(g => `<details class="alert alert-${esc(g.sev)}" ${ui.alertaAbierta === g.regla ? 'open' : ''} data-regla="${esc(g.regla)}">
    <summary><span class="sev">${g.sev === 'alta' ? 'Alta' : g.sev === 'media' ? 'Media' : 'Info'}</span><b>${esc(g.titulo)}</b><span class="num count">${g.items.length}</span></summary>
    <p class="accion">${esc(g.accion)}</p>
    <ul class="mini">${g.items.slice(0, 60).map(a => `<li><code>${esc(a.id)}</code> ${esc(a.detalle)}</li>`).join('')}${g.items.length > 60 ? `<li>… y ${g.items.length - 60} más</li>` : ''}</ul>
  </details>`).join('')}</div>`;
}

function tReportes() {
  const reps = store.reportesVisibles();
  if (!reps.length) return `<section class="card"><p class="empty">Aún no hay reportes. Para verlos en la demo, entra como un colaborador (por ejemplo Camila Rojas) y usa "¿Algo no coincide?".</p></section>`;
  return `<section class="card"><p class="hint">Contenido sensible: lo ve solo Personas. No se comparte con la jefatura y no se usa para evaluar ni seleccionar.</p>
  <ul class="actions">${reps.map(r => `<li><div><b>${esc(r.tipo)}</b> · ${esc(nombreDe(r.colaborador_id))} <code>${esc(r.colaborador_id)}</code><small>${fmt(r.fecha)} · ${esc(r.id)}${r.texto ? ` · “${esc(r.texto)}”` : ''}</small></div>
    <div class="row"><label for="st-${esc(r.id)}" class="sr">Estado</label><select id="st-${esc(r.id)}" data-change="rep-estado" data-arg="${esc(r.id)}">${['Nuevo', 'En gestión', 'Cerrado'].map(e => `<option ${e === r.estado ? 'selected' : ''}>${e}</option>`).join('')}</select></div></li>`).join('')}</ul></section>`;
}

function tPermisos() {
  const roles = ['Colaborador', 'Jefatura', 'TI', 'Personas'];
  return `<section class="card"><h2 class="h-sm">Lo que cada rol puede hacer en Sprint</h2>
  <div class="table-wrap"><table><thead><tr><th>Capacidad</th>${roles.map(r => `<th>${r}</th>`).join('')}</tr></thead><tbody>
  ${MATRIZ_EFECTIVA.map(m => `<tr><th scope="row">${esc(m.cap)}</th>${roles.map(r => `<td>${esc(m[r])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
  <p class="hint">Acceso efectivo = rol + equipo_asignado + permiso Sí/No + tipo de responsabilidad. Un "Sí" del archivo nunca da acceso global por sí solo.</p></section>
  <section class="card"><h2 class="h-sm">Permisos del archivo que se acotaron</h2><ul class="mini">
    <li><b>TI</b> tiene "puede_asignar_responsables = Sí". Sprint solo le deja reasignar entre cuentas TI y solo en hitos de Equipo y Acceso.</li>
    <li><b>TI</b> tiene "puede_ver_metricas = Sí". Ve solo cifras agregadas de hitos técnicos, sin nombres.</li>
    <li><b>Jefatura</b> tiene "puede_ver_datos_personales = Sí". Solo aplica a su equipo_asignado y nunca incluye el canal de contacto.</li>
    <li><b>Colaborador</b> tiene "puede_ver_datos_personales = Sí". Solo ve sus propios datos.</li>
  </ul></section>`;
}

function tBitacora() {
  const b = store.state.bitacora;
  return `<section class="card"><div class="row-between"><h2 class="h-sm">Bitácora de cambios y accesos</h2>
    <div class="row"><button class="btn btn-ghost btn-sm" data-act="export" data-arg="bitacora">Copiar bitácora (CSV)</button><button class="btn btn-ghost btn-sm" data-act="export" data-arg="hitos">Copiar hitos actualizados (CSV)</button></div></div>
    ${ui.exportTexto ? `<label for="exp" class="sr">CSV</label><textarea id="exp" class="export" rows="6" readonly>${esc(ui.exportTexto)}</textarea>` : ''}
    ${b.length ? `<div class="table-wrap"><table><thead><tr><th>Cuándo</th><th>Usuario</th><th>Acción</th><th>Objetivo</th><th>Detalle</th><th>Resultado</th></tr></thead><tbody>
    ${b.slice(0, 200).map(x => `<tr><td class="num"><small>${esc(new Date(x.ts).toLocaleString('es-CL'))}</small></td><td><code>${esc(x.usuario)}</code><br><small>${esc(x.rol)}</small></td><td>${esc(x.accion)}</td><td><code>${esc(x.objetivo)}</code></td><td>${esc(x.detalle)}</td><td>${x.resultado === 'ok' ? '<span class="chip chip-ok">ok</span>' : '<span class="chip chip-bad">denegado</span>'}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="empty">Sin movimientos todavía.</p>'}</section>`;
}

function tDatos() {
  const s = store.state;
  return `<section class="card"><h2 class="h-sm">Fecha de corte</h2>
    <form data-form="hoy" class="inline-form"><label for="hoy">Calcular atrasos al</label><input type="date" id="hoy" name="hoy" value="${s.hoy}" required><button class="btn btn-primary btn-sm" type="submit">Aplicar</button></form></section>
  <section class="card"><h2 class="h-sm">Cargar archivos nuevos</h2>
    <p class="hint">Sube uno o más CSV con el nombre original (colaboradores.csv, hitos_onboarding.csv, usuarios_roles.csv, catalogo_hitos.csv). Se validan antes de usarse.</p>
    <form data-form="carga" class="stack"><label for="files">Archivos CSV</label><input type="file" id="files" name="files" accept=".csv,text/csv" multiple><button class="btn btn-primary btn-sm" type="submit">Validar y cargar</button></form>
    ${ui.cargaErrores ? `<div class="notice notice-bad" role="alert"><b>No se cargó nada.</b> Corrige esto y vuelve a intentar:<ul class="mini">${ui.cargaErrores.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}</section>
  <section class="card"><h2 class="h-sm">Reiniciar la demo</h2><p class="hint">Vuelve a los datos originales y borra la bitácora y los reportes de este navegador.</p>
    <button class="btn btn-ghost btn-sm" data-act="reset">Reiniciar demo</button></section>`;
}

// ---------- eventos ----------
const MAX_ARCHIVO = 2 * 1024 * 1024;
const ARCHIVOS = {
  'colaboradores.csv': ['colaboradores', ['colaborador_id', 'fecha_ingreso', 'area', 'sede', 'modalidad', 'tipo_turno', 'jefatura_id', 'canal_contacto', 'correo_corporativo_activo', 'dispositivo_principal', 'estado_onboarding']],
  'hitos_onboarding.csv': ['hitos', ['hito_id', 'colaborador_id', 'tipo_hito', 'responsable_tipo', 'responsable_id', 'fecha_limite', 'fecha_cumplimiento', 'estado', 'nivel_criticidad', 'ultima_actualizacion']],
  'usuarios_roles.csv': ['usuarios', ['usuario_id', 'nombre_ficticio', 'rol', 'area', 'equipo_asignado', 'puede_ver_datos_personales', 'puede_editar_hitos', 'puede_asignar_responsables', 'puede_ver_metricas']],
  'catalogo_hitos.csv': ['catalogo', ['tipo_hito', 'responsable_inicial', 'plazo_ficticio', 'criticidad']],
};

async function onSubmit(e) {
  const f = e.target.closest('form[data-form]'); if (!f) return;
  e.preventDefault();
  const fd = new FormData(f); const kind = f.dataset.form; const s = store.state;
  if (kind === 'col-id') {
    const id = String(fd.get('id') || '').trim().toUpperCase();
    const u = s.auth.users.get(id); const c = s.idx.colab.get(id);
    if (!u || u.rol !== 'Colaborador' || !c) { ui.loginError = 'No encontramos ese código. Revisa que tenga la forma COL-### o pide ayuda a Personas.'; return render(); }
    const canal = c.canal_contacto || (c.correo_corporativo_activo === 'Sí' ? 'Correo corporativo' : null);
    ui.loginStep = { id, canal }; ui.loginError = ''; return render();
  }
  if (kind === 'col-code') {
    if (String(fd.get('code')).trim() !== '123456') { ui.loginError = 'El código no es correcto. En la demo es 123456.'; return render(); }
    const r = store.login(ui.loginStep.id, `código por ${ui.loginStep.canal || 'Personas'}`); if (!r.ok) { ui.loginError = r.motivo; return render(); } ui.loginStep = null; ui.loginError = ''; return render();
  }
  if (kind === 'staff') { const r = store.login(String(fd.get('id')), 'acceso interno', { soloInterno: true }); if (!r.ok) return toastMsg(r.motivo); resetUi(); return render(); }
  if (kind === 'reporte') { const r = store.reportar(String(fd.get('tipo')), String(fd.get('texto') || '')); return toastMsg(r.ok ? 'Enviado a Personas. Lo verás aquí con su estado.' : r.motivo); }
  if (kind === 'buscar') {
    const id = String(fd.get('q') || '').trim().toUpperCase(); if (!id) return;
    const c = store.verColaborador(id); ui.busqueda = { id, ok: !!c }; if (c) ui.detalle = id; return render();
  }
  if (kind === 'reasignar') {
    const r = store.reasignar(f.dataset.arg, String(fd.get('nuevo')), String(fd.get('motivo') || ''));
    if (r.ok) ui.reasignando = null; return toastMsg(r.ok ? 'Responsable reasignado y registrado en la bitácora.' : r.motivo);
  }
  if (kind === 'hoy') { const v = String(fd.get('hoy')); const r = store.setHoy(v); return toastMsg(r.ok ? `Atrasos recalculados al ${fmt(v)}.` : r.motivo); }
  if (kind === 'carga') {
    const files = [...(f.querySelector('input[type=file]').files || [])];
    ui.cargaErrores = null;
    if (!files.length) return toastMsg('Elige al menos un archivo CSV.');
    const nuevo = {}; const errores = [];
    for (const file of files) {
      const def = ARCHIVOS[file.name.toLowerCase()];
      if (!def) { errores.push(`${file.name}: nombre no reconocido. Usa el nombre original del archivo.`); continue; }
      if (file.size > MAX_ARCHIVO) { errores.push(`${file.name}: pesa más de 2 MB.`); continue; }
      let rows;
      try { rows = parseCSV(await file.text()); } catch { errores.push(`${file.name}: no se pudo leer como texto UTF-8.`); continue; }
      const faltan = def[1].filter(c => !(rows[0] && c in rows[0]));
      if (!rows.length) { errores.push(`${file.name}: no tiene filas.`); continue; }
      if (faltan.length) { errores.push(`${file.name}: faltan columnas ${faltan.join(', ')}.`); continue; }
      nuevo[def[0]] = rows;
    }
    if (errores.length) { ui.cargaErrores = errores; render(); return toastMsg('Carga rechazada. Los datos actuales no cambiaron.'); }
    const r = store.cargarArchivos(nuevo, `Archivos: ${files.map(x => x.name).join(', ')}`);
    if (!r.ok) { ui.cargaErrores = (r.errores || []).slice(0, 30).map(a => `${a.titulo}: ${a.id} · ${a.detalle}`); render(); return toastMsg(r.motivo); }
    if (r.sesionCerrada) { resetUi(); render(); return toastMsg('Archivos cargados. Tu cuenta ya no existe en los datos nuevos: ingresa de nuevo.'); }
    ui.tab = 'calidad'; return toastMsg('Archivos cargados. Revisa las alertas de calidad.');
  }
}

function resetUi() { Object.assign(ui, { tab: 'resumen', detalle: null, tiFiltro: 'todos', reasignando: null, confirm: null, busqueda: null, exportTexto: null }); }

function onClick(e) {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act; const arg = b.dataset.arg; const s = store.state;
  const h = arg ? s.data.hitos.find(x => x.hito_id === arg) : null;
  if (['completar', 'tomar', 'reasignar-open'].includes(act) && !h) { toastMsg('Ese hito ya no existe. La vista se actualizó.'); return; }
  switch (act) {
    case 'quick': { const r = store.login(arg, 'recorrido de demo'); if (!r.ok) return toastMsg(r.motivo); resetUi(); return render(); }
    case 'logout': store.logout(); resetUi(); ui.loginStep = null; return render();
    case 'login-back': ui.loginStep = null; ui.loginError = ''; return render();
    case 'tab': ui.tab = arg; ui.detalle = null; ui.reasignando = null; ui.exportTexto = null; return render();
    case 'detalle': ui.detalle = ui.detalle === arg ? null : arg; ui.reasignando = null; return render();
    case 'ti-filtro': ui.tiFiltro = arg; return render();
    case 'reasignar-open': ui.reasignando = arg; return render();
    case 'reasignar-close': ui.reasignando = null; return render();
    case 'completar': ui.confirm = { texto: `Marcar "${NOMBRE_HITO[h.tipo_hito]}" de ${esc(h.colaborador_id)} como cumplido con fecha ${fmt(s.hoy)}. Queda registrado con tu usuario.`, act: 'completar', arg }; return render();
    case 'tomar': ui.confirm = { texto: `Asignarte el caso ${arg} (${h.tipo_hito} de ${esc(h.colaborador_id)}). La asignación queda en la bitácora.`, act: 'tomar', arg }; return render();
    case 'reset': ui.confirm = { texto: 'Volver a los datos originales y borrar la bitácora y los reportes de este navegador.', act: 'reset' }; return render();
    case 'cancel': ui.confirm = null; return render();
    case 'confirm-ok': {
      const c = ui.confirm; ui.confirm = null;
      if (c.act === 'completar') { const r = store.completar(c.arg); return toastMsg(r.ok ? 'Hito marcado como cumplido.' : r.motivo); }
      if (c.act === 'tomar') { const r = store.reasignar(c.arg, s.user.usuario_id, `Caso tomado por ${s.user.usuario_id}`); return toastMsg(r.ok ? 'Caso asignado a ti.' : r.motivo); }
      if (c.act === 'reset') { store.reiniciar(); resetUi(); return toastMsg('Demo reiniciada.'); }
      return render();
    }
    case 'export': {
      ui.exportTexto = arg === 'bitacora' ? toCSV(s.bitacora, ['ts', 'usuario', 'rol', 'accion', 'objetivo', 'detalle', 'resultado']) : toCSV(s.data.hitos);
      render();
      const t = ui.exportTexto;
      try { navigator.clipboard.writeText(t).then(() => toastMsg('CSV copiado al portapapeles.'), () => selExport()); } catch { selExport(); }
      return undefined;
    }
    default: return undefined;
  }
}
function selExport() { const t = root.querySelector('#exp'); if (t) { t.focus(); t.select(); } toastMsg('Selecciona y copia el CSV del recuadro.'); }

function onChange(e) {
  const el = e.target.closest('[data-change]'); if (!el) return;
  if (el.dataset.change === 'rep-estado') { const r = store.cambiarEstadoReporte(el.dataset.arg, el.value); toastMsg(r.ok ? 'Estado actualizado.' : r.motivo); }
}
function onToggle(e) { const d = e.target; if (d.matches && d.matches('details[data-regla]')) ui.alertaAbierta = d.open ? d.dataset.regla : (ui.alertaAbierta === d.dataset.regla ? null : ui.alertaAbierta); }

// Ningún error de un botón o formulario deja la pantalla rota: se informa, se registra y se vuelve a dibujar.
function fallo(contexto, err) {
  console.error(err);
  try { store.registrarError(contexto, err && err.message); } catch { /* noop */ }
  ui.confirm = null; ui.toast = 'No se pudo completar la acción. Quedó registrado en la bitácora.';
  try { render(); } catch { root.textContent = 'Error al dibujar la página. Recarga para continuar.'; }
}
const seguro = (nombre, fn) => (e) => { try { const r = fn(e); if (r && typeof r.catch === 'function') r.catch(err => fallo(nombre, err)); } catch (err) { fallo(nombre, err); } };

export function mount(el, st) {
  root = el; store = st;
  root.addEventListener('click', seguro('clic', onClick));
  root.addEventListener('submit', seguro('formulario', onSubmit));
  root.addEventListener('change', seguro('cambio', onChange));
  root.addEventListener('toggle', seguro('detalle', onToggle), true);
  window.addEventListener('error', e => fallo('global', e.error || new Error(e.message)));
  window.addEventListener('unhandledrejection', e => fallo('promesa', e.reason instanceof Error ? e.reason : new Error(String(e.reason))));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && ui.confirm) { ui.confirm = null; render(); } });
  render();
}
export { HITOS_TECNICOS };
