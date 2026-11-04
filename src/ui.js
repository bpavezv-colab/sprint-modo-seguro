// Interfaz: una vista por rol. Todo lo que se muestra pasa por el motor de permisos (store.state.auth).
import { evaluarHito, avanceColaborador, agruparAlertas, fmt, diffDays, NOMBRE_HITO, TIPOS_HITO, CRIT_PESO } from './rules.js';
import { MATRIZ_EFECTIVA, HITOS_TECNICOS } from './permissions.js';
import { parseCSV, toCSV } from './csv.js';
import { ARCHIVOS, TIPOS_REPORTE, ESTADOS_REPORTE } from './privacy.js';
import { MOTIVOS, ESTADOS_FICHA, TIPOS_ALERTA } from './reglas_onboarding.js';

export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ui = {
  loginStep: null,      // { id } durante la simulación; no revela canales antes del ingreso
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
  fichaAbierta: null,   // jefatura: colaborador con formulario de ficha abierto
  fichaErrores: null,   // lista de faltantes al enviar
  discrepancia: false,  // colaborador: formulario "Algo no coincide" abierto
  resultado: null,      // colaborador: 'confirmada' | 'con_discrepancia'
  denegado: null,       // pantalla 403
  fichaFiltro: 'accion',
  alertaFiltro: 'abierta',
};
let store; let root;

// ---------- utilidades de presentación ----------
const nombreDe = id => {
  const { auth, user, idx } = store.state;
  if (!user) return id;
  const propio = user.usuario_id === id;
  const colaborador = idx.colab.has(id);
  const visible = colaborador ? auth.puedeVerCampo(user, id, 'nombre')
    : propio || (user.rol !== 'TI' && user.puede_ver_datos_personales === 'Sí');
  return visible ? auth.users.get(id)?.nombre_ficticio || id : id;
};
const colaboradoresVisibles = u => store.state.data.colaboradores
  .filter(c => store.state.auth.puedeVerColaborador(u, c.colaborador_id))
  .map(c => store.verColaborador(c.colaborador_id));
function alertasVisibles(u) {
  const { auth, alertas, data } = store.state;
  if (!auth.puedeVerCalidad(u)) return [];
  const global = auth.scope(u).size === data.colaboradores.length;
  return alertas.filter(a => global || auth.puedeVerColaborador(u, a.id)
    || data.hitos.some(h => h.hito_id === a.id && auth.puedeVerHito(u, h)));
}
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

// ---------- utilidades de la ficha ----------
const SIN_DATO = (txt = '') => `<span class="missing">Sin dato${txt ? ` · ${esc(txt)}` : ''}</span>`;
const fmtDT = v => { if (!v) return '—'; const [d, t] = String(v).split('T'); return `${fmt(d)} ${t ? t.slice(0, 5) : ''}`.trim(); };
const TONO_FICHA = { incompleta: 'neutral', lista: 'warn', enviada: 'warn', confirmada: 'ok', con_discrepancia: 'bad', requiere_reconfirmacion: 'bad' };
const chipFicha = (est, texto) => `<span class="chip chip-${TONO_FICHA[est] || 'neutral'}">${esc(texto || ESTADOS_FICHA[est])}</span>`;
const TONO_HITO = { Listo: 'ok', Pendiente: 'neutral', Atrasado: 'bad', 'Por verificar': 'warn', 'Sin fecha': 'bad' };
const chipHito = e => `<span class="chip chip-${TONO_HITO[e] || 'neutral'}">${esc(e)}</span>`;
const TONO_PRIO = { Urgente: 'bad', Alta: 'bad', Media: 'warn', Baja: 'neutral' };
const chipPrio = p => `<span class="chip chip-${TONO_PRIO[p] || 'neutral'}">${esc(p)}</span>`;
const semaforo = sm => `${dot(sm.color)} <b>${esc(sm.texto)}</b><br><small class="muted">${esc(sm.motivos.join(' · '))}</small>`;
function v403() {
  return `<section class="card" role="alert"><p class="eyebrow">Error 403</p><h1>No tienes acceso a esta ficha</h1>
    <p>Tu cuenta solo puede ver la información de su propio alcance. El intento quedó registrado en la bitácora.</p>
    <div><button class="btn btn-primary" data-act="volver">Volver a mi inicio</button></div></section>`;
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
    <div class="cut">Fecha de corte <b>${fmt(s.hoy)}</b> · datos 100% sintéticos · cambios y bitácora solo en memoria; se borran al recargar</div>
    ${!s.almacenamientoLimpio ? '<p class="notice notice-bad" role="alert">No pudimos borrar los datos de la versión anterior. Borra los datos de este sitio desde tu navegador. Esta versión no guarda nuevos datos.</p>' : ''}
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
function render() {
  const s = store.state; const u = s.user;
  let body;
  try {
    if (!u) body = vLogin();
    else if (!s.auth.cuentaValida(u) || !VISTAS[u.rol]) body = vDenegado(); // denegar por defecto
    else if (ui.denegado) body = v403();
    else body = VISTAS[u.rol](u);
  } catch (err) {
    console.error(err);
    try { store.registrarError(`vista ${u ? u.rol : 'ingreso'}`, err && err.message); } catch { /* noop */ }
    body = vError();
  }
  root.innerHTML = header() + `<main class="wrap">${body}</main>` + modal() + (ui.toast ? `<div class="toast" role="status" aria-live="polite">${esc(ui.toast)}</div>` : '');
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
  ['COL-002', 'Colaborador/a', 'Checklist propio y solicitud de revisión'],
  ['COL-019', 'Colaborador/a', 'Ejemplo de datos faltantes'],
  ['JEF-002', 'Jefatura', 'Acciones de su equipo asignado'],
  ['TI-004', 'Soporte TI', 'Equipos y accesos por código'],
  ['PER-001', 'Equipo de Personas', 'Supervisión del proceso de ingreso'],
];
function vLogin() {
  const s = store.state;
  const internos = ['Jefatura', 'Personas', 'TI', 'Administrador'].map(rol =>
    `<optgroup label="${rol}">${s.data.usuarios.filter(x => x.rol === rol).map(x => `<option value="${esc(x.usuario_id)}">${esc(x.usuario_id)}</option>`).join('')}</optgroup>`).join('');
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
      <p>Simulación de ingreso para una cuenta sintética. No enviamos mensajes ni mostramos canales de contacto antes del ingreso.</p>
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
      <p class="notice"><b>Inicio de sesión simulado.</b> Simulación con cuentas sintéticas. No ingreses datos reales. Los cambios y las solicitudes se borran al recargar la página.</p>
    </div>
    <div class="login-grid">
      <div class="card"><h2>Soy colaborador/a</h2>${ui.loginError ? `<p class="err" role="alert">${esc(ui.loginError)}</p>` : ''}${paso}</div>
      <div class="card"><h2>Equipo interno</h2>
        <form data-form="staff" class="stack">
          <label for="staff-id">Cuenta</label>
          <select id="staff-id" name="id">${internos}</select>
          <button class="btn btn-primary" type="submit">Ingresar</button>
          <p class="hint">Selector de cuentas sintéticas. El inicio de sesión corporativo está pendiente.</p>
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
      <h1>Hola, ${esc(nombreDe(u.usuario_id).split(' ')[0])}</h1>
      <p>Ingreso: <b>${fmt(c.fecha_ingreso)}</b> · Turno: ${c.tipo_turno ? `<b>${esc(c.tipo_turno)}</b>` : '<span class="missing">por confirmar (Personas lo está validando)</span>'}</p>
      <div class="progress"><span><b>${av.cumplidos}</b> de ${av.total} listos</span>${barra(av)}</div>
      ${vencidos.length ? `<p class="notice notice-bad">${vencidos.length} ${vencidos.length === 1 ? 'tarea está atrasada' : 'tareas están atrasadas'}, y ninguna depende de ti. Los responsables las tienen en su bandeja.</p>` : ''}
      ${c.correo_corporativo_activo === 'No' ? '<p class="notice">Aún no tienes correo corporativo. Puedes usar esta página desde tu teléfono igual.</p>' : ''}
    </section>
    ${fichaColaborador(u)}
    ${GRUPOS.map(([g, tipos]) => `<section class="group"><h2 class="h-sm">${g}</h2><ul class="checklist">
      ${items.filter(x => tipos.includes(x.h.tipo_hito)).map(({ h, ev }) => `<li class="check check-${ev.estadoReal === 'Cumplido' ? 'ok' : ev.estadoReal === 'Vencido' ? 'bad' : ev.estadoReal === 'Por verificar' ? 'warn' : 'neutral'}">
        <div><b>${esc(NOMBRE_HITO[h.tipo_hito])}</b><small>Lo gestiona: ${esc(h.responsable_tipo === 'Jefatura' ? 'tu jefatura' : funcion[h.responsable_tipo])} · Plazo <span class="nw">${fmt(ev.limite)}</span></small>
        ${ev.estadoReal === 'Por verificar' ? '<small class="missing">Figura como listo, pero falta confirmar la fecha.</small>' : ''}</div>${chip(ev)}</li>`).join('')}
    </ul></section>`).join('')}
    <section class="card"><h2 class="h-sm">A quién pedir ayuda</h2><dl class="kv">
      <dt>Tu jefatura</dt><dd>${jef ? esc(nombreDe(jef.usuario_id)) : '<span class="missing">Aún no tienes jefatura asignada. Personas ya tiene la alerta.</span>'}</dd>
      <dt>Equipo y accesos</dt><dd>Soporte TI</dd>
      <dt>Contrato y dudas generales</dt><dd>Equipo de Personas</dd>
      <dt>Tu canal registrado</dt><dd>${c.canal_contacto ? esc(c.canal_contacto) : '<span class="missing">Sin canal registrado</span>'}</dd>
    </dl></section>
    ${['enviada', 'confirmada', 'con_discrepancia', 'requiere_reconfirmacion'].includes(store.vistaFicha(u.usuario_id)?.est) ? '' : `<section class="card"><h2 class="h-sm">¿Algo no coincide con lo que te dijeron?</h2>
      <form data-form="reporte" class="stack">
        <label for="rep-tipo">Qué pasó</label>
        <select id="rep-tipo" name="tipo">
          ${TIPOS_REPORTE.map(t => `<option>${esc(t)}</option>`).join('')}</select>
        <p class="hint">Registramos solo esta categoría para que Personas revise el caso. No recopilamos relatos ni datos personales adicionales. Tu jefatura no lo ve y no se usa para evaluarte. En esta demo queda solo en memoria.</p>
        <button class="btn btn-primary" type="submit">Enviar a Personas</button>
      </form>
      ${misRep.length ? `<ul class="mini">${misRep.map(r => `<li>${esc(r.tipo)} <span class="chip chip-neutral">${esc(r.estado)}</span></li>`).join('')}</ul>` : ''}
    </section>`}
    <p class="hint">Prueba de permisos: <button class="link" data-act="probar-403" data-arg="COL-014">intentar abrir la ficha de COL-014</button></p>
  </div>`;
}

function fichaColaborador(u) {
  const v = store.vistaFicha(u.usuario_id);
  if (!v) return '';
  const { c, ficha: f, est } = v;
  const fijo = '<p class="fixed"><b>Lo revisa Personas, no tu jefatura. No se usa para evaluarte.</b></p>';
  if (ui.resultado) {
    const ok = ui.resultado === 'confirmada';
    return `<section class="card result" role="status"><p class="eyebrow">Tu respuesta quedó registrada</p>
      <h2>${ok ? 'Confirmaste tu ficha' : 'Recibimos tu aviso'}</h2>
      <p><b>Próximo paso:</b> ${ok ? `reunión con ${esc(v.jefatura || 'tu jefatura')} el <span class="mono">${esc(fmtDT(f?.reunion_at))}</span>.`
        : `Personas revisará lo que no coincide y te contactará ${c.canal_contacto ? 'por tu canal registrado' : '(no tienes canal registrado: Personas ya tiene la alerta)'}. Se notificaría a Personas por correo (simulado).`}</p>
      ${fijo}<div><button class="btn btn-ghost" data-act="ver-ficha">Ver mi ficha</button></div></section>`;
  }
  const enviada = !!f;
  const tareas = enviada ? `<ol class="tareas">${[f.tarea_1, f.tarea_2, f.tarea_3].map(t => `<li>${esc(t)}</li>`).join('')}</ol>` : '<p class="muted">Tu jefatura aún no completa esta sección.</p>';
  const respondible = ['enviada', 'requiere_reconfirmacion'].includes(est);
  const acciones = respondible ? `<div class="row"><button class="btn btn-primary" data-act="ficha-confirmar">Todo claro, confirmo</button>
      <button class="btn btn-ghost" data-act="ficha-disc">Algo no coincide</button></div>
      ${ui.discrepancia ? `<form data-form="discrepancia" class="stack"><fieldset class="stack"><legend>¿Qué no coincide?</legend>
        ${Object.entries(MOTIVOS).map(([k, t]) => `<label class="radio"><input type="radio" name="motivo" value="${esc(k)}"> ${esc(t)}</label>`).join('')}</fieldset>
        <p class="hint">Solo eliges el motivo: no pedimos relatos ni datos personales adicionales.</p>
        <div class="row"><button class="btn btn-primary" type="submit">Enviar a Personas</button><button class="btn btn-ghost" type="button" data-act="ficha-disc-cerrar">Cancelar</button></div></form>` : ''}`
    : est === 'confirmada' ? `<p>${chipFicha(est)} Confirmaste tu ficha el <span class="mono">${esc(fmtDT(f.respondida_at))}</span>.</p>`
    : est === 'con_discrepancia' ? `<p>${chipFicha(est)} Avisaste que algo no coincide (${esc(MOTIVOS[f.motivo] || '')}). Personas lo está revisando.</p>`
    : '<p class="muted">Podrás confirmar cuando tu jefatura envíe la ficha.</p>';
  return `<section class="card ficha"><div class="row-between"><h2 class="h-sm">Tu ficha de ingreso</h2>${chipFicha(est)}</div>
    ${!enviada ? '<p class="notice">Tu jefatura todavía no envía tu ficha. Cuando lo haga, aquí verás tus tareas, tu compañero o compañera de apoyo y la reunión.</p>' : ''}
    <dl class="kv">
      <dt>Ingreso</dt><dd>${c.fecha_ingreso ? `<span class="mono">${fmt(c.fecha_ingreso)}</span> · hora: ${SIN_DATO('no viene en el registro')}` : SIN_DATO()}</dd>
      <dt>Cuándo</dt><dd>${c.tipo_turno ? `${esc(c.tipo_turno)} <span class="chip chip-ok">Turno inicial validado por RR.LL.</span>` : SIN_DATO('Personas lo está revisando')}</dd>
      <dt>Jefatura</dt><dd>${v.jefatura ? esc(v.jefatura) : SIN_DATO('Personas está asignando tu jefatura')}</dd>
      <dt>Compañero/a de apoyo</dt><dd>${v.companero ? esc(v.companero) : '<span class="muted">Pendiente de tu jefatura</span>'}</dd>
      <dt>Reunión con jefatura</dt><dd>${enviada ? `<span class="mono">${esc(fmtDT(f.reunion_at))}</span>` : '<span class="muted">Pendiente de tu jefatura</span>'}</dd>
    </dl>
    <h3 class="h-xs">Qué harás</h3>${tareas}
    <h3 class="h-xs">Antes de empezar</h3>
    <ul class="mini">${v.hitos.map(x => `<li>${esc(NOMBRE_HITO[x.h.tipo_hito])} · ${chipHito(x.estado)} · fecha comprometida <span class="mono">${x.fecha ? fmt(x.fecha) : 'Sin dato'}</span></li>`).join('')}</ul>
    ${acciones}${fijo}</section>`;
}

// ---------- jefatura ----------
function vJefatura(u) {
  const s = store.state; const { auth, idx, hoy } = s;
  const equipo = colaboradoresVisibles(u).sort((a, b) => (b.fecha_ingreso || '').localeCompare(a.fecha_ingreso || ''));
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
    ${auth.puedeVerMetricas(u) ? `<div class="kpis">
      ${kpi(equipo.length, 'personas en tu equipo')}
      ${kpi(mias.length, 'acciones tuyas por hacer', mias.length ? 'warn' : '')}
      ${kpi(vencEquipo.length, 'hitos atrasados del equipo (de cualquier área)', vencEquipo.length ? 'bad' : '')}
    </div>` : ''}
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
      <div class="table-wrap"><table><thead><tr><th>Persona</th><th>Ingreso</th><th>Turno</th><th>Correo corp.</th><th>Avance</th><th>Estado</th><th>Ficha</th><th></th></tr></thead><tbody>
      ${equipo.map(c => { const av = avanceColaborador(c.colaborador_id, idx, hoy); return `<tr>
        <td><b>${esc(nombreDe(c.colaborador_id))}</b><br><code>${esc(c.colaborador_id)}</code></td><td class="num">${fmt(c.fecha_ingreso)}</td>
        <td>${c.tipo_turno ? esc(c.tipo_turno) : '<span class="missing">Sin dato</span>'}</td><td>${esc(c.correo_corporativo_activo)}</td>
        <td class="num">${av.cumplidos}/${av.total} ${barra(av)}</td><td>${dot(av.semaforo)} ${semTxt[av.semaforo]}</td>${celdaFicha(c.colaborador_id)}
        <td><button class="btn btn-ghost btn-sm" data-act="detalle" data-arg="${esc(c.colaborador_id)}">${ui.detalle === c.colaborador_id ? 'Cerrar' : 'Ver hitos'}</button></td></tr>
        ${ui.detalle === c.colaborador_id ? `<tr class="sub"><td colspan="8">${tablaHitos(u, c.colaborador_id)}</td></tr>` : ''}
        ${ui.fichaAbierta === c.colaborador_id ? `<tr class="sub"><td colspan="8">${formFicha(u, c.colaborador_id)}</td></tr>` : ''}`; }).join('')}
      </tbody></table></div>
      <p class="hint">No ves canales de contacto ni los reportes que las personas envían a Personas.</p>
    </section>
    ${metr ? `<section class="card"><h2 class="h-sm">Cumplimiento de tu equipo por hito</h2>${metr}<p class="hint">Solo datos agregados de tu equipo.</p></section>` : ''}`;
}
function celdaFicha(colId) {
  const v = store.vistaFicha(colId);
  if (!v) return '<td>—</td>';
  return `<td>${chipFicha(v.est, v.estadoVisible)}<br><button class="btn btn-primary btn-sm" data-act="ficha-abrir" data-arg="${esc(colId)}">${ui.fichaAbierta === colId ? 'Cerrar ficha' : ['incompleta', 'lista'].includes(v.est) ? 'Completar ficha' : 'Ver ficha'}</button></td>`;
}
function formFicha(u, colId) {
  const v = store.vistaFicha(colId); if (!v) return v403();
  const f = v.ficha || {}; const id = esc(colId);
  const tec = v.hitos.filter(x => HITOS_TECNICOS.includes(x.h.tipo_hito)).map(x => `${esc(x.h.tipo_hito)} ${chipHito(x.estado)}`).join(' · ');
  const solo = `<dl class="kv"><dt>Turno (solo lectura)</dt><dd>${v.c.tipo_turno ? `${esc(v.c.tipo_turno)} · Turno inicial validado por RR.LL.` : SIN_DATO('lo corrige Personas')}</dd>
    <dt>Equipo y accesos (solo lectura)</dt><dd>${tec || '—'} · lo gestiona TI</dd></dl>`;
  if (!['incompleta', 'lista'].includes(v.est)) {
    return `<div class="stack">${solo}<p>${chipFicha(v.est, v.estadoVisible)} ${f.enviada_at ? `Enviada el <span class="mono">${esc(fmtDT(f.enviada_at))}</span>.` : ''}</p>
      <ol class="tareas">${[f.tarea_1, f.tarea_2, f.tarea_3].map(t => `<li>${esc(t)}</li>`).join('')}</ol>
      <p>Compañero/a de apoyo: <b>${esc(v.companero || '—')}</b> · Reunión: <span class="mono">${esc(fmtDT(f.reunion_at))}</span></p>
      ${v.est === 'con_discrepancia' ? '<p class="notice">La persona avisó que algo no coincide. Está en revisión por Personas; aquí no se muestra el motivo.</p>' : ''}</div>`;
  }
  const comps = store.companerosPara(colId);
  return `<form data-form="ficha" data-arg="${id}" class="stack ficha-form">${solo}
    ${[1, 2, 3].map(i => `<label for="t${i}-${id}">Tarea ${i}</label><input id="t${i}-${id}" name="tarea_${i}" maxlength="160" value="${esc(f[`tarea_${i}`] || '')}" placeholder="Qué hará la persona su primera semana">`).join('')}
    <label for="cp-${id}">Compañero o compañera de apoyo</label>
    <select id="cp-${id}" name="companero_id"><option value="">Elige una persona de tu equipo</option>${comps.map(x => `<option value="${esc(x.id)}" ${x.id === f.companero_id ? 'selected' : ''}>${esc(x.nombre)} (${esc(x.id)})</option>`).join('')}</select>
    <label for="rn-${id}">Reunión con la persona (fecha y hora)</label>
    <input id="rn-${id}" type="datetime-local" name="reunion_at" value="${esc(f.reunion_at || '')}">
    ${ui.fichaErrores ? `<div class="notice notice-bad" role="alert"><b>No se puede enviar todavía.</b><ul class="mini">${ui.fichaErrores.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
    <div class="row"><button class="btn btn-ghost" type="submit" name="op" value="guardar">Guardar borrador</button><button class="btn btn-primary" type="submit" name="op" value="enviar">Enviar ficha</button></div>
    <p class="hint">Al enviar, se notificaría a la persona por su canal registrado (simulado: no se envía nada). No ves su canal ni lo que reporte a Personas.</p></form>`;
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
    <select id="re-${esc(h.hito_id)}" name="nuevo">${cands.map(c => `<option value="${esc(c.usuario_id)}">${esc(c.usuario_id)}</option>`).join('')}</select>
    <label for="rm-${esc(h.hito_id)}">Motivo (queda en la bitácora)</label>
    <input id="rm-${esc(h.hito_id)}" name="motivo" required minlength="5" maxlength="200" placeholder="Ej.: responsable vacío desde la carga">
    <p class="hint">Escribe solo el motivo operativo, sin datos personales. Queda en la bitácora de esta demo hasta recargar.</p>
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
    ${s.auth.puedeVerMetricas(u) ? `<div class="kpis">
      ${kpi(abiertos.length, 'casos técnicos abiertos')}
      ${kpi(abiertos.filter(x => x.ev.estadoReal === 'Vencido').length, 'vencidos según el plazo del catálogo', 'bad')}
      ${kpi(filtros.sin.length, 'sin responsable asignado', filtros.sin.length ? 'warn' : '')}
      ${kpi(filtros.mios.length, 'asignados a ti')}
    </div>` : ''}
    <div class="segs" role="group" aria-label="Filtro">${btnF('todos', 'Todos')}${btnF('mios', 'Mis casos')}${btnF('sin', 'Sin responsable')}</div>
    <section class="card"><div class="table-wrap"><table><thead><tr><th>Caso</th><th>Necesita</th><th>Contexto</th><th>Debía estar</th><th>Estado</th><th>Responsable</th><th>Fecha comprometida</th><th></th></tr></thead><tbody>
    ${lista.map(({ h, ev }) => { const c = store.verColaborador(h.colaborador_id); const pc = s.auth.puedeCompletar(u, h, s.hoy); const pr = s.auth.puedeReasignar(u, h);
      return `<tr><td><code>${esc(h.hito_id)}</code><br><small><code>${esc(h.colaborador_id)}</code></small></td><td><b>${esc(h.tipo_hito)}</b><br><small>Criticidad ${esc(ev.crit)}</small></td>
      <td><small>${esc(c.sede)} · ${esc(c.modalidad)}<br>Usa ${esc(c.dispositivo_principal).toLowerCase()} · correo corp. ${esc(c.correo_corporativo_activo)}</small></td>
      <td class="num">${fmt(ev.limite)}</td><td>${chip(ev)}</td>
      <td>${h.responsable_id ? `<code>${esc(h.responsable_id)}</code>` : '<span class="missing">Sin asignar · TI por regla</span>'}</td><td>${tiPendiente(u, h)}</td>
      <td><div class="row">${pc.ok ? `<button class="btn btn-primary btn-sm" data-act="completar" data-arg="${esc(h.hito_id)}">Marcar entregado</button>` : ''}
        ${!h.responsable_id && pr.ok ? `<button class="btn btn-primary btn-sm" data-act="tomar" data-arg="${esc(h.hito_id)}">Tomar caso</button>` : ''}
        ${h.responsable_id && pr.ok ? `<button class="btn btn-ghost btn-sm" data-act="reasignar-open" data-arg="${esc(h.hito_id)}">Reasignar</button>` : ''}</div></td></tr>
      ${ui.reasignando === h.hito_id ? `<tr class="sub"><td colspan="8">${formReasignar(u, h)}</td></tr>` : ''}`; }).join('') || '<tr><td colspan="8" class="empty">Sin casos en este filtro.</td></tr>'}
    </tbody></table></div></section>`;
}

function tiPendiente(u, h) {
  const p = store.state.auth.puedeGestionarTecnico(u, h);
  if (!p.ok) return `<small class="muted">${esc(p.motivo)}</small>`;
  const id = esc(h.hito_id);
  return `<form data-form="ti-pendiente" data-arg="${id}" class="inline-form"><label for="fc-${id}" class="sr">Fecha comprometida para ${id}</label>
    <input type="date" id="fc-${id}" name="fecha" value="${esc(h.fecha_comprometida || '')}"><button class="btn btn-ghost btn-sm" type="submit">Pendiente con fecha</button></form>`;
}

// ---------- Personas / Administrador ----------
const TABS = [['fichas', 'Fichas de ingreso'], ['alertas', 'Alertas'], ['indicadores', 'Indicadores'], ['resumen', 'Resumen'], ['casos', 'Casos críticos'], ['calidad', 'Calidad de datos'], ['reportes', 'Reportes'], ['permisos', 'Permisos'], ['bitacora', 'Bitácora'], ['datos', 'Datos']];
function vPersonas(u) {
  const { auth } = store.state;
  const disponibles = TABS.filter(([k]) => (k !== 'resumen' || auth.puedeVerMetricas(u))
    && (k !== 'reportes' || auth.puedeVerReportes(u)) && (k !== 'bitacora' || auth.puedeVerBitacora(u))
    && (k !== 'datos' || auth.puedeCargarArchivos(u)));
  if (!disponibles.some(([k]) => k === ui.tab)) ui.tab = disponibles[0][0];
  const rep = auth.puedeVerReportes(u) ? store.reportesVisibles().filter(r => r.estado !== 'Cerrado').length : 0;
  const body = { fichas: tFichas, alertas: tAlertas, indicadores: tIndicadores, resumen: tResumen, casos: tCasos, calidad: tCalidad, reportes: tReportes, permisos: tPermisos, bitacora: tBitacora, datos: tDatos }[ui.tab](u);
  return `<div class="page-head"><div><p class="eyebrow">${u.rol === 'Administrador' ? 'Administración' : 'Equipo de Personas'}</p><h1>Proceso de ingreso completo</h1></div></div>
    <nav class="tabs" role="tablist">${disponibles.map(([k, t]) => `<button role="tab" aria-selected="${ui.tab === k}" class="tab ${ui.tab === k ? 'on' : ''}" data-act="tab" data-arg="${k}">${t}${k === 'reportes' && rep ? ` <span class="badge">${rep}</span>` : ''}${k === 'calidad' ? ` <span class="badge badge-soft" title="Reglas con alertas de severidad alta">${new Set(alertasVisibles(u).filter(a => a.sev === 'alta').map(a => a.regla)).size}</span>` : ''}</button>`).join('')}</nav>
    ${body}`;
}

function tFichas(u) {
  const todas = store.ingresos();
  const F = {
    accion: ['Requieren acción', todas.filter(v => v.semaforo.color === 'rojo')],
    atrasados: ['Atrasados', todas.filter(v => v.hitos.some(x => x.estado === 'Atrasado'))],
    confirmados: ['Confirmados', todas.filter(v => v.est === 'confirmada')],
    todos: ['Todos', todas],
  };
  const lista = F[ui.fichaFiltro][1];
  return `<p class="hint">Sede piloto: el kit no la define, se muestran todos los ingresos de tu alcance (supuesto declarado). Datos minimizados.</p>
  <div class="segs" role="group" aria-label="Filtro de fichas">${Object.entries(F).map(([k, [t, l]]) => `<button class="seg ${ui.fichaFiltro === k ? 'on' : ''}" data-act="ficha-filtro" data-arg="${k}" aria-pressed="${ui.fichaFiltro === k}">${t} <span class="num">${l.length}</span></button>`).join('')}</div>
  <section class="card"><div class="table-wrap"><table><thead><tr><th>Semáforo</th><th>Persona</th><th>Área</th><th>Ingreso</th><th>Jefatura</th><th>Ficha</th><th>Motivo</th></tr></thead><tbody>
  ${lista.map(v => `<tr><td>${semaforo(v.semaforo)}</td><td><b>${esc(v.c.nombre || v.c.colaborador_id)}</b><br><code>${esc(v.c.colaborador_id)}</code></td><td>${esc(v.c.area)}</td>
    <td class="num">${v.c.fecha_ingreso ? fmt(v.c.fecha_ingreso) : SIN_DATO()}</td><td>${v.c.jefatura_id ? `<code>${esc(v.c.jefatura_id)}</code>` : SIN_DATO()}</td>
    <td>${chipFicha(v.est)}</td><td>${v.ficha?.motivo ? esc(MOTIVOS[v.ficha.motivo]) : '—'}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Sin personas en este filtro.</td></tr>'}
  </tbody></table></div></section>`;
}
const PESO_PRIO = { Urgente: 4, Alta: 3, Media: 2, Baja: 1 };
function tAlertas(u) {
  const todas = store.alertasFicha().sort((a, b) => PESO_PRIO[b.prioridad] - PESO_PRIO[a.prioridad] || String(a.plazo).localeCompare(String(b.plazo)));
  const F = { abierta: 'Abiertas', contactado: 'Contactadas', escalada: 'Escaladas', todas: 'Todas' };
  const lista = ui.alertaFiltro === 'todas' ? todas : todas.filter(a => a.estado === ui.alertaFiltro);
  const s = store.state;
  return `<p class="hint">Cada alerta indica responsable, acción requerida, plazo y prioridad. Las notificaciones son simuladas: no se envía nada.</p>
  <div class="segs" role="group" aria-label="Filtro de alertas">${Object.entries(F).map(([k, t]) => `<button class="seg ${ui.alertaFiltro === k ? 'on' : ''}" data-act="alerta-filtro" data-arg="${k}" aria-pressed="${ui.alertaFiltro === k}">${t} <span class="num">${k === 'todas' ? todas.length : todas.filter(a => a.estado === k).length}</span></button>`).join('')}</div>
  <section class="card"><div class="table-wrap"><table><thead><tr><th>Prioridad</th><th>Alerta</th><th>Persona</th><th>Responsable</th><th>Acción requerida</th><th>Plazo</th><th>Estado</th><th></th></tr></thead><tbody>
  ${lista.slice(0, 150).map(a => { const h = a.hito_id ? s.data.hitos.find(x => x.hito_id === a.hito_id) : null;
    return `<tr><td>${chipPrio(a.prioridad)}</td><td><b>${esc(a.titulo)}</b><br><small class="muted">${esc(TIPOS_ALERTA[a.tipo] || a.tipo)}${a.hito_id ? ` · <code>${esc(a.hito_id)}</code>` : ''}</small></td>
    <td><code>${esc(a.colaborador_id)}</code></td><td>${esc(a.responsable.etiqueta)}</td><td>${esc(a.accion_requerida)}</td>
    <td class="num">${a.plazo < s.hoy ? `<span class="chip chip-bad">Venció ${fmt(a.plazo)}</span>` : fmt(a.plazo)}</td><td>${esc(a.estado)}</td>
    <td><div class="row">${a.estado !== 'contactado' ? `<button class="btn btn-ghost btn-sm" data-act="alerta" data-estado="contactado" data-arg="${esc(a.id)}">Marcar contactado</button>` : ''}
      ${a.estado !== 'escalada' ? `<button class="btn btn-ghost btn-sm" data-act="alerta" data-estado="escalada" data-arg="${esc(a.id)}">Escalar</button>` : ''}
      ${h && s.auth.puedeReasignar(u, h).ok ? `<button class="btn btn-ghost btn-sm" data-act="reasignar-open" data-arg="${esc(h.hito_id)}">Reasignar</button>` : ''}</div></td></tr>
    ${h && ui.reasignando === h.hito_id ? `<tr class="sub"><td colspan="8">${formReasignar(u, h)}</td></tr>` : ''}`; }).join('') || '<tr><td colspan="8" class="empty">Sin alertas en este filtro.</td></tr>'}
  </tbody></table></div>${lista.length > 150 ? `<p class="hint">Se muestran 150 de ${lista.length}.</p>` : ''}</section>`;
}
function tIndicadores() {
  const k = store.indicadores(); if (!k) return '';
  return `<div class="kpis">
    ${kpi(k.pctAntesDia1 === null ? '—' : `${k.pctAntesDia1}%`, `fichas confirmadas antes del día 1 (${k.confirmadasAntesDia1} de ${k.enviadas} enviadas)`)}
    ${kpi(k.confirmadas, 'fichas confirmadas')}
    ${kpi(Object.values(k.porMotivo).reduce((a, b) => a + b, 0), 'discrepancias reportadas', 'warn')}
  </div>
  <section class="card"><h2 class="h-sm">Discrepancias por motivo</h2><div class="table-wrap"><table><thead><tr><th>Motivo</th><th>Cantidad</th></tr></thead><tbody>
    ${Object.entries(k.porMotivo).map(([m, n]) => `<tr><td>${esc(MOTIVOS[m])}</td><td class="num">${n}</td></tr>`).join('')}</tbody></table></div></section>
  <section class="card"><h2 class="h-sm">Hitos atrasados por responsable</h2><div class="table-wrap"><table><thead><tr><th>Responsable</th><th>Hitos atrasados</th></tr></thead><tbody>
    ${k.atrasadosPorResponsable.map(([r, n]) => `<tr><td>${esc(r)}</td><td class="num">${n}</td></tr>`).join('') || '<tr><td colspan="2" class="empty">Sin hitos atrasados.</td></tr>'}</tbody></table></div>
    <p class="hint">Indicadores calculados en vivo desde las fichas y los hitos. No se usan para evaluar personas.</p></section>`;
}

function tResumen(u) {
  if (!store.state.auth.puedeVerMetricas(u)) return '';
  const s = store.state; const items = hitosVisibles(u);
  const abiertos = items.filter(x => x.ev.estadoReal !== 'Cumplido' && x.ev.estadoReal !== 'Por verificar');
  const venc = items.filter(x => x.ev.estadoReal === 'Vencido').length;
  const reg = items.filter(x => x.h.estado === 'Atrasado').length;
  const pv = items.filter(x => x.ev.estadoReal === 'Por verificar').length;
  const personasCrit = colaboradoresVisibles(u).filter(c => avanceColaborador(c.colaborador_id, s.idx, s.hoy).vencidosAltos > 0).length;
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
  const lista = colaboradoresVisibles(u).map(c => ({ c, av: avanceColaborador(c.colaborador_id, s.idx, s.hoy) }))
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
  const grupos = agruparAlertas(alertasVisibles(u));
  return `<p class="hint">Reglas del diccionario de datos aplicadas a los 4 archivos. Nada se corrige automáticamente: cada alerta indica qué hacer.</p>
  <div class="alerts">${grupos.map(g => `<details class="alert alert-${esc(g.sev)}" ${ui.alertaAbierta === g.regla ? 'open' : ''} data-regla="${esc(g.regla)}">
    <summary><span class="sev">${g.sev === 'alta' ? 'Alta' : g.sev === 'media' ? 'Media' : 'Info'}</span><b>${esc(g.titulo)}</b><span class="num count">${g.items.length}</span></summary>
    <p class="accion">${esc(g.accion)}</p>
    <ul class="mini">${g.items.slice(0, 60).map(a => `<li><code>${esc(a.id)}</code> ${esc(a.detalle)}</li>`).join('')}${g.items.length > 60 ? `<li>… y ${g.items.length - 60} más</li>` : ''}</ul>
  </details>`).join('')}</div>`;
}

function tReportes() {
  const reps = store.reportesVisibles();
  if (!reps.length) return `<section class="card"><p class="empty">Aún no hay reportes en tu alcance. Para probarlos, entra como COL-002 y usa "¿Algo no coincide?".</p></section>`;
  return `<section class="card"><p class="hint">Solo categorías de revisión, sin relatos libres. Personas gestiona los casos de su alcance. No se comparten con jefaturas ni TI y no se usan para evaluar ni seleccionar. Se borran al recargar.</p>
  <ul class="actions">${reps.map(r => `<li><div><b>${esc(r.tipo)}</b> · ${esc(nombreDe(r.colaborador_id))} <code>${esc(r.colaborador_id)}</code><small>${fmt(r.fecha)} · ${esc(r.id)}</small></div>
    <div class="row"><label for="st-${esc(r.id)}" class="sr">Estado</label><select id="st-${esc(r.id)}" data-change="rep-estado" data-arg="${esc(r.id)}">${ESTADOS_REPORTE.map(e => `<option ${e === r.estado ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select></div></li>`).join('')}</ul></section>`;
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
  if (!store.state.auth.puedeVerBitacora(store.state.user)) return '';
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
    <form data-form="hoy" class="inline-form"><label for="hoy">Calcular atrasos al</label><input type="date" id="hoy" name="hoy" value="${esc(s.hoy)}" required><button class="btn btn-primary btn-sm" type="submit">Aplicar</button></form></section>
  <section class="card"><h2 class="h-sm">Cargar archivos nuevos</h2>
    <p class="hint">Usa exclusivamente los CSV sintéticos del kit con su nombre original. No cargues datos reales, credenciales ni columnas adicionales. Se rechazan campos ajenos al diccionario y la carga queda solo en memoria.</p>
    <form data-form="carga" class="stack"><label for="files">Archivos CSV (máximo 2 MB por archivo)</label><input type="file" id="files" name="files" accept=".csv,text/csv" multiple><button class="btn btn-primary btn-sm" type="submit">Validar y cargar</button></form>
    ${ui.cargaErrores ? `<div class="notice notice-bad" role="alert"><b>No se cargó nada.</b> Corrige esto y vuelve a intentar:<ul class="mini">${ui.cargaErrores.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}</section>
  <section class="card"><h2 class="h-sm">Reiniciar la demo</h2><p class="hint">Vuelve a los datos originales y borra los reportes y movimientos de esta sesión. También se borran al recargar.</p>
    <button class="btn btn-ghost btn-sm" data-act="reset">Reiniciar demo</button></section>`;
}

// ---------- eventos ----------
const MAX_ARCHIVO = 2 * 1024 * 1024;
async function onSubmit(e) {
  const f = e.target.closest('form[data-form]'); if (!f) return;
  e.preventDefault();
  const fd = new FormData(f); const kind = f.dataset.form; const s = store.state;
  if (kind === 'col-id') {
    const id = String(fd.get('id') || '').trim().toUpperCase();
    ui.loginStep = { id }; ui.loginError = ''; return render();
  }
  if (kind === 'col-code') {
    if (String(fd.get('code')).trim() !== '123456') { store.rechazarEntrada('ingreso'); ui.loginError = 'El código no es correcto. En la demo es 123456.'; return render(); }
    const r = store.login(ui.loginStep?.id);
    if (!r.ok || s.user.rol !== 'Colaborador') { store.logout(); ui.loginError = 'No encontramos una cuenta de colaborador autorizada.'; return render(); }
    ui.loginStep = null; ui.loginError = ''; resetUi(); return render();
  }
  if (kind === 'staff') { const r = store.login(String(fd.get('id')), 'acceso interno', { soloInterno: true }); resetUi(); if (!r.ok) ui.loginError = r.motivo; return render(); }
  if (kind === 'discrepancia') {
    const r = store.reportarDiscrepancia(String(fd.get('motivo') || ''));
    if (r.ok) { ui.resultado = 'con_discrepancia'; ui.discrepancia = false; return render(); }
    return toastMsg(r.motivo);
  }
  if (kind === 'ficha') {
    const op = e.submitter?.value === 'enviar' ? 'enviar' : 'guardar';
    const campos = Object.fromEntries(['tarea_1', 'tarea_2', 'tarea_3', 'companero_id', 'reunion_at'].map(k => [k, String(fd.get(k) || '')]));
    const r = op === 'enviar' ? store.enviarFicha(f.dataset.arg, campos) : store.guardarFicha(f.dataset.arg, campos);
    if (!r.ok) { ui.fichaErrores = r.faltan || [r.motivo]; render(); return toastMsg(r.motivo); }
    ui.fichaErrores = null;
    return toastMsg(op === 'enviar' ? `Ficha enviada. ${r.aviso}` : `Borrador guardado: ${ESTADOS_FICHA[r.estado]}.`);
  }
  if (kind === 'ti-pendiente') { const r = store.marcarPendiente(f.dataset.arg, String(fd.get('fecha') || '')); return toastMsg(r.ok ? 'Fecha comprometida guardada.' : r.motivo); }
  if (kind === 'reporte') { const r = store.reportar(String(fd.get('tipo'))); return toastMsg(r.ok ? 'Solicitud creada en esta demo para revisión de Personas. Se borra al recargar.' : r.motivo); }
  if (kind === 'buscar') {
    const id = String(fd.get('q') || '').trim().toUpperCase(); if (!id) return;
    const c = store.verColaborador(id); ui.busqueda = { id, ok: !!c }; if (c) ui.detalle = id; return render();
  }
  if (kind === 'reasignar') {
    ui.confirm = { texto: `Reasignar el hito ${f.dataset.arg} a ${String(fd.get('nuevo'))}. El motivo operativo quedará en la bitácora de esta sesión.`, act: 'reasignar', arg: f.dataset.arg, nuevo: String(fd.get('nuevo')), motivo: String(fd.get('motivo') || '') };
    return render();
  }
  if (kind === 'hoy') { const v = String(fd.get('hoy')); const r = store.setHoy(v); return toastMsg(r.ok ? `Atrasos recalculados al ${fmt(v)}.` : r.motivo); }
  if (kind === 'carga') {
    const files = [...(f.querySelector('input[type=file]').files || [])];
    ui.cargaErrores = null;
    if (!files.length) { store.rechazarEntrada('carga'); return toastMsg('Elige al menos un archivo CSV.'); }
    const nuevo = {}; const errores = [];
    for (const file of files) {
      const def = ARCHIVOS[file.name.toLowerCase()];
      if (!def) { errores.push('Archivo no reconocido; usa los nombres del kit sintético'); continue; }
      if (file.size > MAX_ARCHIVO) { errores.push(`${file.name}: pesa más de 2 MB.`); continue; }
      let rows;
      try { rows = parseCSV(await file.text()); }
      catch { errores.push(`${file.name}: no se pudo leer como texto UTF-8.`); continue; }
      const faltan = def[1].filter(c => !(rows[0] && c in rows[0]));
      if (!rows.length) { errores.push(`${file.name}: no tiene filas.`); continue; }
      if (faltan.length) { errores.push(`${file.name}: faltan columnas ${faltan.join(', ')}.`); continue; }
      nuevo[def[0]] = rows;
    }
    if (errores.length) { store.rechazarEntrada('carga'); ui.cargaErrores = errores; return toastMsg('Carga rechazada. Los datos actuales no cambiaron.'); }
    const r = store.cargarArchivos(nuevo);
    if (!r.ok) { ui.cargaErrores = (r.errores || []).slice(0, 30).map(a => `${a.titulo}: ${a.id} · ${a.detalle}`); return toastMsg(r.motivo); }
    if (r.sesionCerrada) { resetUi(); return toastMsg('Archivos cargados solo en memoria. Tu cuenta ya no existe: ingresa de nuevo.'); }
    ui.tab = 'calidad'; return toastMsg('Archivos sintéticos cargados solo en memoria. Revisa las alertas de calidad.');
  }
}

function resetUi() { Object.assign(ui, { fichaAbierta: null, fichaErrores: null, discrepancia: false, resultado: null, denegado: null, tab: 'fichas', detalle: null, tiFiltro: 'todos', reasignando: null, confirm: null, busqueda: null, exportTexto: null, cargaErrores: null }); }

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
    case 'ficha-filtro': ui.fichaFiltro = arg; return render();
    case 'alerta-filtro': ui.alertaFiltro = arg; return render();
    case 'volver': ui.denegado = null; return render();
    case 'probar-403': { const r = store.entrar('/ficha', arg); ui.denegado = r.ok ? null : arg; return render(); }
    case 'ficha-abrir': {
      if (ui.fichaAbierta === arg) { ui.fichaAbierta = null; return render(); }
      const r = store.entrar('/ficha', arg); if (!r.ok) { ui.denegado = arg; return render(); }
      ui.fichaAbierta = arg; ui.fichaErrores = null; ui.detalle = null; return render();
    }
    case 'ficha-confirmar': { const r = store.confirmarFicha(); if (r.ok) { ui.resultado = 'confirmada'; return render(); } return toastMsg(r.motivo); }
    case 'ficha-disc': ui.discrepancia = true; return render();
    case 'ficha-disc-cerrar': ui.discrepancia = false; return render();
    case 'ver-ficha': ui.resultado = null; return render();
    case 'alerta': { const r = store.gestionarAlerta(arg, b.dataset.estado); return toastMsg(r.ok ? (r.aviso || 'Alerta marcada como contactada.') : r.motivo); }
    case 'reasignar-open': ui.reasignando = arg; return render();
    case 'reasignar-close': ui.reasignando = null; return render();
    case 'completar': ui.confirm = { texto: `Marcar "${NOMBRE_HITO[h.tipo_hito]}" de ${esc(h.colaborador_id)} como cumplido con fecha ${fmt(s.hoy)}. Queda registrado con tu usuario.`, act: 'completar', arg }; return render();
    case 'tomar': ui.confirm = { texto: `Asignarte el caso ${arg} (${h.tipo_hito} de ${esc(h.colaborador_id)}). La asignación queda en la bitácora.`, act: 'tomar', arg }; return render();
    case 'reset': ui.confirm = { texto: 'Volver a los datos originales y borrar la bitácora y los reportes de este navegador.', act: 'reset' }; return render();
    case 'cancel': ui.confirm = null; return render();
    case 'confirm-ok': {
      const c = ui.confirm; ui.confirm = null; if (!c) return;
      if (c.act === 'completar') { const r = store.completar(c.arg); return toastMsg(r.ok ? 'Hito marcado como cumplido.' : r.motivo); }
      if (c.act === 'tomar') { const r = store.reasignar(c.arg, s.user.usuario_id, `Caso tomado por ${s.user.usuario_id}`, { confirmado: true }); return toastMsg(r.ok ? 'Caso asignado a ti.' : r.motivo); }
      if (c.act === 'reasignar') { const r = store.reasignar(c.arg, c.nuevo, c.motivo, { confirmado: true }); if (r.ok) ui.reasignando = null; return toastMsg(r.ok ? 'Responsable reasignado y registrado en la bitácora.' : r.motivo); }
      if (c.act === 'reset') { store.reiniciar(); resetUi(); return toastMsg('Demo reiniciada.'); }
      return render();
    }
    case 'export': {
      const r = store.exportar(arg); if (!r.ok) return toastMsg(r.motivo);
      ui.exportTexto = arg === 'bitacora' ? toCSV(r.filas, ['ts', 'usuario', 'rol', 'accion', 'objetivo', 'detalle', 'resultado']) : toCSV(r.filas);
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
const seguro = (nombre, fn) => (e) => { try { const r = fn(e); return r && typeof r.catch === 'function' ? r.catch(err => fallo(nombre, err)) : r; } catch (err) { fallo(nombre, err); } };

export function mount(el, st) {
  root = el; store = st;
  root.addEventListener('click', seguro('clic', onClick));
  root.addEventListener('submit', seguro('formulario', onSubmit));
  root.addEventListener('change', seguro('cambio', onChange));
  root.addEventListener('toggle', seguro('detalle', onToggle), true);
  globalThis.window?.addEventListener('error', e => fallo('global', e.error || new Error(e.message)));
  globalThis.window?.addEventListener('unhandledrejection', e => fallo('promesa', e.reason instanceof Error ? e.reason : new Error(String(e.reason))));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && ui.confirm) { ui.confirm = null; render(); } });
  render();
}
export { HITOS_TECNICOS };
