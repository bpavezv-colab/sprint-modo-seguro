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

const pad2 = n => String(n).padStart(2, '0');
// Lista de cifras: etiqueta a la izquierda, valor a la derecha, separadas por líneas finas.
const stats = rows => `<div class="stats">${rows.map(([l, v, tone]) => `<div><span>${esc(l)}</span><span class="num ${tone ? 'tone-' + tone : ''}">${v}</span></div>`).join('')}</div>`;
const tags = list => `<div class="tags caption">${list.filter(Boolean).map(t => `<span>${esc(t)}</span>`).join('')}</div>`;
// Filtros como fila de pestañas compactas.
const filtros = (grupo, opciones, actual) => `<div class="filters caption" role="group" aria-label="Filtro">${opciones.map(([k, t, n]) => `<button class="${actual === k ? 'on' : ''}" data-act="${grupo}" data-arg="${esc(k)}" aria-pressed="${actual === k}">${esc(t)}${n !== undefined ? ` <span class="num">${n}</span>` : ''}</button>`).join('')}</div>`;

// ---------- utilidades de la ficha ----------
const SIN_DATO = (txt = '') => `<span class="missing">Sin dato${txt ? ` · ${esc(txt)}` : ''}</span>`;
const fmtDT = v => { if (!v) return '—'; const [d, t] = String(v).split('T'); return `${fmt(d)} ${t ? t.slice(0, 5) : ''}`.trim(); };
const TONO_FICHA = { incompleta: 'neutral', lista: 'warn', enviada: 'warn', confirmada: 'ok', con_discrepancia: 'bad', requiere_reconfirmacion: 'bad' };
const chipFicha = (est, texto) => `<span class="chip chip-${TONO_FICHA[est] || 'neutral'}">${esc(texto || ESTADOS_FICHA[est])}</span>`;
const TONO_PRIO = { Urgente: 'bad', Alta: 'bad', Media: 'warn', Baja: 'neutral' };
const chipPrio = p => `<span class="chip chip-${TONO_PRIO[p] || 'neutral'}">${esc(p)}</span>`;
const SEM_COLOR = { rojo: 'rojo', amarillo: 'amarillo', verde: 'verde' };
const semaforoFicha = sm => `${dot(SEM_COLOR[sm.color] || 'gris')} <b>${esc(sm.texto)}</b><br><small class="dim">${esc(sm.motivos.join(' · '))}</small>`;
function v403() {
  return `<section class="blk hero-sm" role="alert"><p class="caption">Error 403</p><h1>No tienes acceso a esta ficha.</h1>
    <p class="lead">Tu cuenta solo puede ver la información de su propio alcance. El intento quedó registrado en la bitácora.</p>
    <div><button class="btn btn-primary" data-act="volver">Volver a mi inicio</button></div></section>`;
}

// ---------- shell ----------
function topbar() {
  const s = store.state; const u = s.user;
  return `<header class="topbar">
    <span class="logo" aria-label="Sprint"><span class="logo-mark" aria-hidden="true"></span><span class="logo-txt">Sprint</span><span class="logo-sub caption">Onboarding · Modo Seguro</span></span>
    <nav class="topnav caption" aria-label="Sesión">
      <span class="tn-cut">Corte ${fmt(s.hoy)}</span>
      ${u ? `<span class="tn-who">${esc(u.rol)} · ${esc(u.usuario_id)}</span><button data-act="logout">Cambiar usuario</button>` : '<span class="tn-who">Datos sintéticos · solo en memoria</span>'}
    </nav>
  </header>`;
}

// nav: [{ label, href } | { label, act, arg }, right, active]
function navItem(i) {
  const right = i.right !== undefined ? `<span class="num">${i.right}</span>` : '';
  const lab = `<span>${i.n ? `<em>${i.n}</em>` : ''}${esc(i.label)}</span>`;
  return i.act
    ? `<button class="${i.active ? 'active' : ''} ${i.sub ? 'sub' : ''}" data-act="${i.act}" data-arg="${esc(i.arg)}" ${i.active ? 'aria-current="page"' : ''}>${lab}${right}</button>`
    : `<a class="${i.sub ? 'sub' : ''}" href="#${esc(i.href)}" data-spy="${esc(i.href)}">${lab}${right}</a>`;
}
function sidebar(v) {
  const s = store.state; const u = s.user;
  return `<aside class="sidebar"><nav class="caption" aria-label="Secciones">${v.nav.map(navItem).join('')}</nav>
    <div class="mark caption">${u ? `<b>${esc(nombreDe(u.usuario_id))}</b><span>${esc(u.rol)} · ${esc(u.usuario_id)}</span>` : ''}
      <span>Fecha de corte ${fmt(s.hoy)}</span><span>Cambios y bitácora solo en memoria</span><span>Se borran al recargar</span></div></aside>`;
}
// En pantallas chicas la barra lateral se oculta: las pestañas y filtros pasan a una fila desplazable.
const mnav = v => { const acts = v.nav.filter(i => i.act); return acts.length ? `<nav class="mnav caption" aria-label="Secciones">${acts.map(navItem).join('')}</nav>` : ''; };

const VISTAS = { Colaborador: u => vColaborador(u), Jefatura: u => vJefatura(u), TI: u => vTI(u), Personas: u => vPersonas(u), Administrador: u => vPersonas(u) };

function vDenegado() {
  return `<section class="blk hero-sm"><p class="caption">Acceso</p><h1>No tienes acceso.</h1><p class="lead">Tu cuenta no tiene un rol válido para esta herramienta. Contacta al equipo de Personas.</p>
    <div><button class="btn btn-primary" data-act="logout">Volver al inicio</button></div></section>`;
}
function vError() {
  return `<section class="blk hero-sm"><p class="caption">Error</p><h1>Algo no funcionó en esta vista.</h1>
    <p class="lead">No se perdió ningún dato y el error quedó en la bitácora. Puedes volver al inicio o, si se repite, reiniciar la demo.</p>
    <div class="row"><button class="btn btn-primary" data-act="logout">Volver al inicio</button><button class="btn btn-ghost" data-act="reset">Reiniciar demo</button></div></section>`;
}
function avisos() {
  return store.state.almacenamientoLimpio ? '' : '<div class="blk blk-tight"><p class="notice notice-bad" role="alert">No pudimos borrar los datos de la versión anterior. Borra los datos de este sitio desde tu navegador. Esta versión no guarda nuevos datos.</p></div>';
}

function render() {
  const s = store.state; const u = s.user;
  let v;
  try {
    if (!u) v = vLogin();
    else if (!s.auth.cuentaValida(u) || !VISTAS[u.rol]) v = vDenegado(); // denegar por defecto
    else if (ui.denegado) v = v403();
    else v = VISTAS[u.rol](u);
  } catch (err) {
    console.error(err);
    try { store.registrarError(`vista ${u ? u.rol : 'ingreso'}`, err && err.message); } catch { /* noop */ }
    v = vError();
  }
  if (typeof v === 'string') v = { nav: [], body: v };
  const cta = u && u.rol === 'Colaborador' && s.auth.cuentaValida(u) ? '<a class="btn btn-primary cta" href="#ayuda">Necesito ayuda</a>' : '';
  root.innerHTML = topbar()
    + `<div class="layout ${v.nav.length ? '' : 'no-side'}">${v.nav.length ? sidebar(v) : ''}<main id="main">${mnav(v)}${avisos()}${v.body}</main></div>`
    + cta + modal() + (ui.toast ? `<div class="toast" role="status" aria-live="polite">${esc(ui.toast)}</div>` : '');
  espiar();
}

// Resalta en la barra lateral la sección visible (solo navegación por anclas).
let spy;
function espiar() {
  if (spy) { spy.disconnect(); spy = null; }
  if (typeof root.querySelectorAll !== 'function' || typeof IntersectionObserver === 'undefined') return; // entornos sin DOM (tests)
  const links = new Map([...root.querySelectorAll('[data-spy]')].map(a => [a.dataset.spy, a]));
  if (!links.size) return;
  spy = new IntersectionObserver(es => es.forEach(en => {
    if (!en.isIntersecting) return;
    links.forEach(a => a.classList.remove('active'));
    const a = links.get(en.target.id); if (a) a.classList.add('active');
  }), { rootMargin: '-40% 0px -55% 0px' });
  links.forEach((_, id) => { const el = root.querySelector(`[id="${String(id).replace(/[^a-z0-9-]/gi, '')}"]`); if (el) spy.observe(el); });
}

function modal() {
  if (!ui.confirm) return '';
  return `<div class="overlay"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-t">
    <button class="close caption" data-act="cancel">Cerrar</button>
    <h2 id="dlg-t">Confirmar acción</h2><p>${esc(ui.confirm.texto)}</p>
    <div class="row-end"><button class="btn btn-ghost btn-inv" data-act="cancel">Cancelar</button><button class="btn btn-primary btn-light" data-act="confirm-ok">Confirmar</button></div>
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
  let paso;
  if (!ui.loginStep) {
    paso = `<form data-form="col-id" class="form">
      <div class="field"><label for="col-id">Tu código de persona*</label><input id="col-id" name="id" placeholder="Ej. COL-002, JEF-002, TI-004 o PER-001" autocomplete="off" autocapitalize="characters" required></div>
      <p class="hint">No necesitas correo corporativo. En producción el código de verificación llegaría por tu canal registrado o se usaría el inicio de sesión corporativo.</p>
      <div><button class="btn btn-primary" type="submit">Continuar</button></div></form>`;
  } else {
    paso = `<form data-form="col-code" class="form">
      <p>Simulación de ingreso para una cuenta sintética. No enviamos mensajes ni mostramos canales de contacto antes del ingreso.</p>
      <div class="field"><label for="col-code">Código*</label><input id="col-code" name="code" inputmode="numeric" maxlength="6" placeholder="123456" required></div>
      <p class="hint">Demo: el código es 123456. <button type="button" class="link" data-act="login-back">Usar otro código</button></p>
      <div><button class="btn btn-primary" type="submit">Ingresar</button></div></form>`;
  }
  const body = `<section class="blk hero">
      ${tags(['Nexo Laboral Group', 'Piloto de onboarding', 'Datos sintéticos'])}
      <h1>Qué falta para cada ingreso, quién lo resuelve y para cuándo.</h1>
      <p class="lead">Cada persona ve solo lo que necesita: el colaborador su checklist, la jefatura su equipo, TI los equipos y accesos, y Personas el proceso completo.</p>
      <p class="notice"><b>Inicio de sesión simulado.</b> Simulación con cuentas sintéticas. No ingreses datos reales. Los cambios y las solicitudes se borran al recargar la página.</p>
    </section>
    <section class="blk" id="ingreso">
      <p class="caption">Ingresar</p>
      <div class="detail">
        <div class="stack"><h2 class="h-lg">Una sola entrada para todo Nexo.</h2>
          <p class="lead">Colaboradores, jefaturas, Soporte TI y Personas entran igual, con su código de persona. Según tu rol, Sprint te muestra tu checklist de ingreso o tu bandeja de trabajo.</p>
          ${stats([
            ['COL-###', 'Colaborador/a · tu checklist y tu ficha'],
            ['JEF-###', 'Jefatura · fichas y acciones de tu equipo'],
            ['TI-###', 'Soporte TI · equipos y accesos'],
            ['PER-### · ADM-###', 'Personas · proceso completo'],
          ])}
        </div>
        <div class="stack">${ui.loginError ? `<p class="err" role="alert">${esc(ui.loginError)}</p>` : ''}${paso}</div>
      </div>
    </section>
    <section class="blk" id="demo">
      <p class="caption">Recorrido de demo</p>
      <h2 class="h-lg">Cinco cuentas, un mismo proceso.</h2>
      <p class="hint">Atajos para la presentación: entran directo, sin el código de verificación.</p>
      <ul class="rows">${DEMO.map(([id, n, d], i) => `<li><button class="row-btn" data-act="quick" data-arg="${esc(id)}">
        <span class="caption idx">${pad2(i + 1)}</span><span class="rb-main"><b>${esc(n)}</b><span class="dim">${esc(d)}</span></span><code>${esc(id)}</code><span class="plus-ico" aria-hidden="true"></span></button></li>`).join('')}</ul>
    </section>`;
  return { nav: [{ label: 'Inicio', href: 'top' }, { label: 'Ingresar', href: 'ingreso' }, { label: 'Recorrido de demo', href: 'demo' }].slice(1), body };
}

// ---------- colaborador ----------
const GRUPOS = [['Antes de tu día 1', ['Contrato']], ['Tu día 1', ['Equipo', 'Acceso']], ['Tu primera semana', ['Reunión', 'Plan']]];
function vColaborador(u) {
  const s = store.state; const c = store.verColaborador(u.usuario_id);
  if (!c) return `<section class="blk hero-sm"><h1>No encontramos tu ficha.</h1><p class="lead">Contacta al equipo de Personas.</p></section>`;
  const items = hitosVisibles(u);
  const av = avanceColaborador(c.colaborador_id, s.idx, s.hoy);
  const vencidos = items.filter(x => x.ev.estadoReal === 'Vencido');
  const faltan = av.total - av.cumplidos;
  const jef = c.jefatura_id ? s.auth.users.get(c.jefatura_id) : null;
  const misRep = store.misReportes();
  const nombre = String(nombreDe(u.usuario_id)).split(' ')[0];
  const grupo = (tipos) => items.filter(x => tipos.includes(x.h.tipo_hito));
  const vf = store.vistaFicha(u.usuario_id);
  const fichaRecibida = vf && ['enviada', 'confirmada', 'con_discrepancia', 'requiere_reconfirmacion'].includes(vf.est);
  const porResponder = vf && ['enviada', 'requiere_reconfirmacion'].includes(vf.est);
  const body = `<section class="blk hero" id="inicio">
      ${tags([c.area, c.sede, c.modalidad])}
      <h1>Hola${nombre ? `, ${esc(nombre)}` : ''}. ${faltan ? `Te ${faltan === 1 ? 'falta 1 paso' : `faltan ${faltan} pasos`} para completar tu ingreso.` : 'Tu ingreso está completo.'}</h1>
      <div class="detail">
        <div class="stack">
          ${vencidos.length ? `<p class="lead">${vencidos.length} ${vencidos.length === 1 ? 'paso está atrasado' : 'pasos están atrasados'} y ninguno depende de ti. Los responsables los tienen en su bandeja.</p>` : '<p class="lead">Aquí ves qué debe ocurrir, quién lo gestiona y para cuándo.</p>'}
          ${porResponder ? '<p class="notice"><b>Tu jefatura envió tu ficha de ingreso.</b> Revísala y confírmala, o avísanos si algo no coincide.</p><div><a class="btn btn-primary" href="#ficha">Revisar mi ficha</a></div>' : ''}
          ${c.correo_corporativo_activo === 'No' ? '<p class="hint">Aún no tienes correo corporativo. Puedes usar esta página desde tu teléfono igual.</p>' : ''}
        </div>
        ${stats([
          ['Ingreso', fmt(c.fecha_ingreso)],
          ['Turno', c.tipo_turno ? esc(c.tipo_turno) : '<span class="missing">Por confirmar</span>'],
          ['Avance', `${av.cumplidos} de ${av.total} ${barra(av)}`],
          ['Atrasados', String(vencidos.length), vencidos.length ? 'bad' : ''],
        ])}
      </div>
    </section>
    ${fichaColaborador(u, vf)}
    ${GRUPOS.map(([g, tipos], i) => `<section class="blk" id="g${i}"><p class="caption">${pad2(i + 1)} · ${g}</p>
      <ul class="rows">${grupo(tipos).map(({ h, ev }) => `<li class="hrow hrow-${ev.estadoReal === 'Cumplido' ? 'ok' : ev.estadoReal === 'Vencido' ? 'bad' : ev.estadoReal === 'Por verificar' ? 'warn' : 'neutral'}">
        <span class="rb-main"><b>${esc(NOMBRE_HITO[h.tipo_hito])}</b><span class="dim">Lo gestiona ${esc(h.responsable_tipo === 'Jefatura' ? 'tu jefatura' : funcion[h.responsable_tipo])} · plazo <span class="nw">${fmt(ev.limite)}</span></span>
        ${ev.estadoReal === 'Por verificar' ? '<span class="missing">Figura como listo, pero falta confirmar la fecha.</span>' : ''}
        ${h.fecha_comprometida && ev.estadoReal !== 'Cumplido' ? `<span class="dim">Soporte TI comprometió el <span class="nw">${fmt(h.fecha_comprometida)}</span></span>` : ''}</span>${chip(ev)}</li>`).join('')}</ul></section>`).join('')}
    <section class="blk" id="contactos"><p class="caption">A quién pedir ayuda</p>
      ${stats([
        ['Tu jefatura', jef ? esc(nombreDe(jef.usuario_id)) : '<span class="missing">Sin asignar. Personas ya tiene la alerta.</span>'],
        ['Equipo y accesos', 'Soporte TI'],
        ['Contrato y dudas generales', 'Equipo de Personas'],
        ['Tu canal registrado', c.canal_contacto ? esc(c.canal_contacto) : '<span class="missing">Sin canal registrado</span>'],
      ])}</section>
    ${fichaRecibida ? '' : `<section class="blk" id="ayuda"><p class="caption">¿Algo no coincide?</p>
      <h2 class="h-lg">Avísanos si algo no es como te dijeron.</h2>
      <form data-form="reporte" class="form">
        <div class="field"><label for="rep-tipo">Qué pasó*</label>
        <select id="rep-tipo" name="tipo">${TIPOS_REPORTE.map(t => `<option>${esc(t)}</option>`).join('')}</select></div>
        <p class="hint">Registramos solo esta categoría para que Personas revise el caso. No recopilamos relatos ni datos personales adicionales. Tu jefatura no lo ve y no se usa para evaluarte. En esta demo queda solo en memoria.</p>
        <div><button class="btn btn-primary" type="submit">Enviar a Personas</button></div>
      </form>
      ${misRep.length ? `<div class="stack"><p class="caption">Tus reportes</p>${stats(misRep.map(r => [r.tipo, `<span class="chip chip-neutral">${esc(r.estado)}</span>`]))}</div>` : ''}
    </section>`}
    <section class="blk blk-tight"><p class="hint">Prueba de permisos: <button class="link" data-act="probar-403" data-arg="COL-014">intentar abrir la ficha de COL-014</button></p></section>`;
  const nav = [
    { label: 'Resumen', href: 'inicio' },
    ...(vf ? [{ label: 'Tu ficha de ingreso', href: 'ficha', right: porResponder ? '1' : undefined }] : []),
    ...GRUPOS.map(([g, tipos], i) => { const l = grupo(tipos); return { label: g, href: `g${i}`, n: pad2(i + 1), sub: true, right: `${l.filter(x => x.ev.estadoReal === 'Cumplido').length}/${l.length}` }; }),
    { label: 'A quién pedir ayuda', href: 'contactos' },
    ...(fichaRecibida ? [] : [{ label: '¿Algo no coincide?', href: 'ayuda' }]),
  ];
  return { nav, body };
}

function fichaColaborador(u, v) {
  if (!v) return '';
  const { c, ficha: f, est } = v;
  const fijo = '<p class="hint">Lo revisa Personas, no tu jefatura. No se usa para evaluarte.</p>';
  if (ui.resultado) {
    const ok = ui.resultado === 'confirmada';
    return `<section class="blk" id="ficha" role="status"><p class="caption">Tu respuesta quedó registrada</p>
      <h2 class="h-lg">${ok ? 'Confirmaste tu ficha.' : 'Recibimos tu aviso.'}</h2>
      <p class="lead"><b>Próximo paso:</b> ${ok ? `reunión con ${esc(v.jefatura || 'tu jefatura')} el <span class="nw">${esc(fmtDT(f?.reunion_at))}</span>.`
        : `Personas revisará lo que no coincide y te contactará ${c.canal_contacto ? 'por tu canal registrado' : '(no tienes canal registrado: Personas ya tiene la alerta)'}. Se notificaría a Personas por correo (simulado).`}</p>
      ${fijo}<div><button class="btn btn-ghost" data-act="ver-ficha">Ver mi ficha</button></div></section>`;
  }
  const enviada = !!f;
  const respondible = ['enviada', 'requiere_reconfirmacion'].includes(est);
  const acciones = respondible ? `<div class="row"><button class="btn btn-primary" data-act="ficha-confirmar">Todo claro, confirmo</button>
      <button class="btn btn-ghost" data-act="ficha-disc">Algo no coincide</button></div>
      ${ui.discrepancia ? `<form data-form="discrepancia" class="form"><fieldset class="choice"><legend class="caption">¿Qué no coincide?*</legend>
        ${Object.entries(MOTIVOS).map(([k, t]) => `<label class="radio"><input type="radio" name="motivo" value="${esc(k)}"> ${esc(t)}</label>`).join('')}</fieldset>
        <p class="hint">Solo eliges el motivo: no pedimos relatos ni datos personales adicionales.</p>
        <div class="row"><button class="btn btn-primary" type="submit">Enviar a Personas</button><button class="btn btn-ghost" type="button" data-act="ficha-disc-cerrar">Cancelar</button></div></form>` : ''}`
    : est === 'confirmada' ? `<p>${chipFicha(est)} Confirmaste tu ficha el <span class="nw">${esc(fmtDT(f.respondida_at))}</span>.</p>`
    : est === 'con_discrepancia' ? `<p>${chipFicha(est)} Avisaste que algo no coincide (${esc(MOTIVOS[f.motivo] || '')}). Personas lo está revisando.</p>`
    : '<p class="dim">Podrás confirmar cuando tu jefatura envíe la ficha.</p>';
  return `<section class="blk" id="ficha"><div class="row-between"><p class="caption">Tu ficha de ingreso</p>${chipFicha(est)}</div>
    ${!enviada ? '<p class="lead">Tu jefatura todavía no envía tu ficha. Cuando lo haga, aquí verás tus tareas, tu compañero o compañera de apoyo y la reunión.</p>' : ''}
    <div class="detail">
      <div class="stack"><p class="caption">Qué harás tu primera semana</p>
        ${enviada ? `<ol class="rows tareas">${[f.tarea_1, f.tarea_2, f.tarea_3].map((t, i) => `<li class="hrow"><span class="caption idx">${pad2(i + 1)}</span><span class="rb-main"><b>${esc(t)}</b></span></li>`).join('')}</ol>` : '<p class="dim">Tu jefatura aún no completa esta sección.</p>'}
      </div>
      ${stats([
        ['Ingreso', c.fecha_ingreso ? `${fmt(c.fecha_ingreso)} · hora ${SIN_DATO('no viene en el registro')}` : SIN_DATO()],
        ['Cuándo trabajas', c.tipo_turno ? `${esc(c.tipo_turno)} <span class="chip chip-ok">Validado por RR.LL.</span>` : SIN_DATO('Personas lo está revisando')],
        ['Jefatura', v.jefatura ? esc(v.jefatura) : SIN_DATO('Personas está asignando tu jefatura')],
        ['Compañero/a de apoyo', v.companero ? esc(v.companero) : '<span class="dim">Pendiente de tu jefatura</span>'],
        ['Reunión con jefatura', enviada ? esc(fmtDT(f.reunion_at)) : '<span class="dim">Pendiente de tu jefatura</span>'],
      ])}
    </div>
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
  const fichas = equipo.map(c => store.vistaFicha(c.colaborador_id)).filter(Boolean);
  const porEnviar = fichas.filter(v => ['incompleta', 'lista'].includes(v.est)).length;
  const body = `<section class="blk hero" id="inicio">
      ${tags([u.area, `Equipo de ${equipo.length}`, 'Jefatura'])}
      <h1>${porEnviar ? `Tienes ${porEnviar} ${porEnviar === 1 ? 'ficha de ingreso por enviar' : 'fichas de ingreso por enviar'}${mias.length ? ` y ${mias.length} ${mias.length === 1 ? 'acción pendiente' : 'acciones pendientes'}` : ''}.` : mias.length ? `Tienes ${mias.length} ${mias.length === 1 ? 'acción pendiente' : 'acciones pendientes'} con tu equipo de ingreso.` : 'Tu equipo de ingreso está al día contigo.'}</h1>
      <div class="detail">
        <form data-form="buscar" class="form"><div class="field"><label for="q">Buscar colaborador por ID</label><input id="q" name="q" placeholder="Ej. COL-014"></div><div><button class="btn btn-ghost" type="submit">Buscar</button></div>
          ${ui.busqueda ? `<p class="notice ${ui.busqueda.ok ? '' : 'notice-bad'}">${ui.busqueda.ok ? `${esc(ui.busqueda.id)} está en tu equipo.` : `${esc(ui.busqueda.id)} está fuera de tu alcance. El intento quedó registrado en la bitácora.`}</p>` : ''}</form>
        ${auth.puedeVerMetricas(u) ? stats([['Personas en tu equipo', String(equipo.length)], ['Fichas por enviar', String(porEnviar), porEnviar ? 'warn' : ''], ['Acciones tuyas por hacer', String(mias.length), mias.length ? 'warn' : ''], ['Hitos atrasados del equipo, de cualquier área', String(vencEquipo.length), vencEquipo.length ? 'bad' : '']]) : stats([['Fichas por enviar', String(porEnviar), porEnviar ? 'warn' : ''], ['Acciones tuyas por hacer', String(mias.length), mias.length ? 'warn' : '']])}
      </div>
    </section>
    <section class="blk" id="fichas"><p class="caption">Fichas de ingreso</p>
      <p class="lead">Completa 3 tareas reales, una persona de apoyo de tu equipo y la reunión. Al enviarla, la persona la confirma o avisa si algo no coincide.</p>
      <ul class="rows">${fichas.map(v => `<li><div class="hrow"><span class="rb-main"><b>${esc(nombreDe(v.c.colaborador_id))}</b><span class="dim"><code>${esc(v.c.colaborador_id)}</code> · ingreso ${v.c.fecha_ingreso ? fmt(v.c.fecha_ingreso) : 'sin dato'}</span></span>
        <span class="row">${chipFicha(v.est, v.estadoVisible)}<button class="btn ${['incompleta', 'lista'].includes(v.est) ? 'btn-primary' : 'btn-ghost'} btn-sm" data-act="ficha-abrir" data-arg="${esc(v.c.colaborador_id)}">${ui.fichaAbierta === v.c.colaborador_id ? 'Cerrar' : ['incompleta', 'lista'].includes(v.est) ? 'Completar ficha' : 'Ver ficha'}</button></span></div>
        ${ui.fichaAbierta === v.c.colaborador_id ? `<div class="sub-panel">${formFicha(u, v.c.colaborador_id)}</div>` : ''}</li>`).join('')}</ul>
    </section>
    <section class="blk" id="acciones"><p class="caption">Tus acciones</p>
      ${mias.length ? `<ul class="rows">${mias.map(({ h, ev }) => `<li class="hrow"><span class="rb-main"><b>${esc(NOMBRE_HITO[h.tipo_hito])} · ${esc(nombreDe(h.colaborador_id))}</b><span class="dim">Plazo ${fmt(ev.limite)}${ev.flags.includes('plazo_corrido') ? ` · registrado para ${fmt(ev.limiteRegistrado)}` : ''}</span></span>
        <span class="row">${chip(ev)}<button class="btn btn-primary btn-sm" data-act="completar" data-arg="${esc(h.hito_id)}">Marcar cumplido</button></span></li>`).join('')}</ul>`
        : '<p class="empty">No tienes acciones pendientes.</p>'}
    </section>
    <section class="blk" id="ingresos"><p class="caption">Próximos ingresos</p>
      ${proximos.length ? listaIngresos(proximos) : `<p class="empty">No hay ingresos con fecha posterior al ${fmt(hoy)} en tu equipo.</p>`}
      ${recientes.length ? `<p class="caption">Ingresaron en los últimos 30 días</p>${listaIngresos(recientes)}` : ''}
    </section>
    <section class="blk" id="equipo"><p class="caption">Personas de tu equipo</p>
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
    ${metr ? `<section class="blk" id="cumplimiento"><p class="caption">Cumplimiento de tu equipo por hito</p>${metr}<p class="hint">Solo datos agregados de tu equipo.</p></section>` : ''}`;
  const nav = [
    { label: 'Resumen', href: 'inicio' },
    { label: 'Fichas de ingreso', href: 'fichas', right: porEnviar },
    { label: 'Tus acciones', href: 'acciones', right: mias.length },
    { label: 'Próximos ingresos', href: 'ingresos', right: proximos.length },
    { label: 'Personas de tu equipo', href: 'equipo', right: equipo.length },
    ...(metr ? [{ label: 'Cumplimiento', href: 'cumplimiento' }] : []),
  ];
  return { nav, body };
}
function formFicha(u, colId) {
  const v = store.vistaFicha(colId); if (!v) return v403();
  const f = v.ficha || {}; const id = esc(colId);
  const tec = v.hitos.filter(x => HITOS_TECNICOS.includes(x.h.tipo_hito)).map(x => `${esc(x.h.tipo_hito)}: ${esc(x.estado)}`).join(' · ');
  const solo = stats([
    ['Turno (solo lectura)', v.c.tipo_turno ? `${esc(v.c.tipo_turno)} · validado por RR.LL.` : SIN_DATO('lo corrige Personas')],
    ['Equipo y accesos (solo lectura)', `${tec || '—'} · lo gestiona TI`],
  ]);
  if (!['incompleta', 'lista'].includes(v.est)) {
    return `<div class="stack">${solo}<p>${chipFicha(v.est, v.estadoVisible)} ${f.enviada_at ? `Enviada el <span class="nw">${esc(fmtDT(f.enviada_at))}</span>.` : ''}</p>
      <ol class="mini">${[f.tarea_1, f.tarea_2, f.tarea_3].map(t => `<li>${esc(t)}</li>`).join('')}</ol>
      <p>Compañero/a de apoyo: <b>${esc(v.companero || '—')}</b> · Reunión: <span class="nw">${esc(fmtDT(f.reunion_at))}</span></p>
      ${v.est === 'con_discrepancia' ? '<p class="notice">La persona avisó que algo no coincide. Está en revisión por Personas; aquí no se muestra el motivo.</p>' : ''}</div>`;
  }
  const comps = store.companerosPara(colId);
  return `<form data-form="ficha" data-arg="${id}" class="form ficha-form">${solo}
    ${[1, 2, 3].map(i => `<div class="field"><label for="t${i}-${id}">Tarea ${i}*</label><input id="t${i}-${id}" name="tarea_${i}" maxlength="160" value="${esc(f[`tarea_${i}`] || '')}" placeholder="Qué hará la persona su primera semana"></div>`).join('')}
    <div class="field"><label for="cp-${id}">Compañero o compañera de apoyo*</label>
    <select id="cp-${id}" name="companero_id"><option value="">Elige una persona de tu equipo</option>${comps.map(x => `<option value="${esc(x.id)}" ${x.id === f.companero_id ? 'selected' : ''}>${esc(x.nombre)} (${esc(x.id)})</option>`).join('')}</select></div>
    <div class="field"><label for="rn-${id}">Reunión con la persona (fecha y hora)*</label>
    <input id="rn-${id}" type="datetime-local" name="reunion_at" value="${esc(f.reunion_at || '')}"></div>
    ${ui.fichaErrores ? `<div class="notice notice-bad" role="alert"><b>No se puede enviar todavía.</b><ul class="mini">${ui.fichaErrores.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
    <div class="row"><button class="btn btn-ghost" type="submit" name="op" value="guardar">Guardar borrador</button><button class="btn btn-primary" type="submit" name="op" value="enviar">Enviar ficha</button></div>
    <p class="hint">Al enviar, se notificaría a la persona por su canal registrado (simulado: no se envía nada). No ves su canal ni lo que reporte a Personas.</p></form>`;
}
const listaIngresos = l => stats(l.map(c => [nombreDe(c.colaborador_id), `${fmt(c.fecha_ingreso)} · ${esc(c.modalidad)} · ${c.tipo_turno ? esc(c.tipo_turno) : '<span class="missing">turno sin dato</span>'}`]));

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
        ${!pc.ok && !pr.ok && ev.estadoReal !== 'Cumplido' ? `<small class="dim">${esc(pc.motivo)}</small>` : ''}</div></td></tr>
      ${ui.reasignando === h.hito_id ? `<tr class="sub"><td colspan="6">${formReasignar(u, h)}</td></tr>` : ''}`; }).join('')}
  </tbody></table></div>`;
}

function formReasignar(u, h) {
  const cands = store.state.auth.candidatos(u, h);
  if (!cands.length) return `<p class="notice notice-bad">No hay cuentas válidas para este hito. ${h.responsable_tipo === 'Jefatura' ? 'Ninguna jefatura tiene a esta persona en su equipo_asignado: hay que corregirlo en el sistema de origen.' : ''}</p>`;
  return `<form data-form="reasignar" data-arg="${esc(h.hito_id)}" class="form form-inline">
    <div class="field"><label for="re-${esc(h.hito_id)}">Nuevo responsable*</label>
    <select id="re-${esc(h.hito_id)}" name="nuevo">${cands.map(c => `<option value="${esc(c.usuario_id)}">${esc(c.usuario_id)}</option>`).join('')}</select></div>
    <div class="field"><label for="rm-${esc(h.hito_id)}">Motivo* (queda en la bitácora)</label>
    <input id="rm-${esc(h.hito_id)}" name="motivo" required minlength="5" maxlength="200" placeholder="Ej.: responsable vacío desde la carga"></div>
    <p class="hint">Escribe solo el motivo operativo, sin datos personales. Queda en la bitácora de esta demo hasta recargar.</p>
    <div class="row"><button class="btn btn-primary btn-sm" type="submit">Reasignar</button><button class="btn btn-ghost btn-sm" type="button" data-act="reasignar-close">Cancelar</button></div>
  </form>`;
}

function metricasPorTipo(items) {
  const tipos = [...new Set(items.map(x => x.h.tipo_hito))].sort((a, b) => TIPOS_HITO.indexOf(a) - TIPOS_HITO.indexOf(b));
  return `<div class="metric-rows">${tipos.map(t => {
    const l = items.filter(x => x.h.tipo_hito === t); const ok = l.filter(x => x.ev.estadoReal === 'Cumplido').length;
    const pct = Math.round(ok / l.length * 100);
    return `<div class="metric"><span>${esc(t)}</span><div class="bar bar-lg"><span style="width:${pct}%"></span></div><b class="num">${pct}%</b><small class="num dim">${ok}/${l.length}</small></div>`;
  }).join('')}</div>`;
}

// ---------- TI ----------
function vTI(u) {
  const s = store.state;
  const abiertos = hitosVisibles(u).filter(x => x.ev.estadoReal !== 'Cumplido')
    .sort((a, b) => b.ev.diasVencido - a.ev.diasVencido || CRIT_PESO[b.ev.crit] - CRIT_PESO[a.ev.crit]);
  const filtros = { todos: abiertos, mios: abiertos.filter(x => x.h.responsable_id === u.usuario_id), sin: abiertos.filter(x => !x.h.responsable_id) };
  const lista = filtros[ui.tiFiltro];
  const titulo = { todos: 'Todos los casos', mios: 'Mis casos', sin: 'Sin responsable' };
  const body = `<section class="blk hero" id="inicio">
      ${tags(['Soporte TI', 'Equipo y Acceso', 'Sin datos personales'])}
      <h1>${abiertos.filter(x => x.ev.estadoReal === 'Vencido').length} equipos y accesos están atrasados según el plazo del catálogo.</h1>
      <div class="detail">
        <p class="lead">Ves solo los hitos de Equipo y Acceso, identificados por código. Los nombres y canales de contacto no son necesarios para resolverlos.</p>
        ${s.auth.puedeVerMetricas(u) ? stats([['Casos técnicos abiertos', String(abiertos.length)], ['Vencidos', String(abiertos.filter(x => x.ev.estadoReal === 'Vencido').length), 'bad'], ['Sin responsable asignado', String(filtros.sin.length), filtros.sin.length ? 'warn' : ''], ['Asignados a ti', String(filtros.mios.length)]]) : ''}
      </div>
    </section>
    <section class="blk" id="casos"><p class="caption">${esc(titulo[ui.tiFiltro])} · ${lista.length}</p>
    <div class="table-wrap"><table><thead><tr><th>Caso</th><th>Necesita</th><th>Contexto</th><th>Debía estar</th><th>Estado</th><th>Responsable</th><th>Fecha comprometida</th><th></th></tr></thead><tbody>
    ${lista.map(({ h, ev }) => { const c = store.verColaborador(h.colaborador_id); const pc = s.auth.puedeCompletar(u, h, s.hoy); const pr = s.auth.puedeReasignar(u, h);
      return `<tr><td><code>${esc(h.hito_id)}</code><br><small><code>${esc(h.colaborador_id)}</code></small></td><td><b>${esc(h.tipo_hito)}</b><br><small class="dim">Criticidad ${esc(ev.crit)}</small></td>
      <td><small>${esc(c.sede)} · ${esc(c.modalidad)}<br>Usa ${esc(c.dispositivo_principal || 'dispositivo sin dato').toLowerCase()} · correo corp. ${esc(c.correo_corporativo_activo)}</small></td>
      <td class="num">${fmt(ev.limite)}</td><td>${chip(ev)}</td>
      <td>${h.responsable_id ? `<code>${esc(h.responsable_id)}</code>` : '<span class="missing">Sin asignar · TI por regla</span>'}</td><td>${tiPendiente(u, h)}</td>
      <td><div class="row">${pc.ok ? `<button class="btn btn-primary btn-sm" data-act="completar" data-arg="${esc(h.hito_id)}">Marcar entregado</button>` : ''}
        ${!h.responsable_id && pr.ok ? `<button class="btn btn-primary btn-sm" data-act="tomar" data-arg="${esc(h.hito_id)}">Tomar caso</button>` : ''}
        ${h.responsable_id && pr.ok ? `<button class="btn btn-ghost btn-sm" data-act="reasignar-open" data-arg="${esc(h.hito_id)}">Reasignar</button>` : ''}</div></td></tr>
      ${ui.reasignando === h.hito_id ? `<tr class="sub"><td colspan="8">${formReasignar(u, h)}</td></tr>` : ''}`; }).join('') || '<tr><td colspan="8" class="empty">Sin casos en este filtro.</td></tr>'}
    </tbody></table></div></section>`;
  const nav = [['todos', 'Todos'], ['mios', 'Mis casos'], ['sin', 'Sin responsable']].map(([k, t], i) => ({ label: t, act: 'ti-filtro', arg: k, n: pad2(i + 1), right: filtros[k].length, active: ui.tiFiltro === k }));
  return { nav, body };
}

function tiPendiente(u, h) {
  const p = store.state.auth.puedeGestionarTecnico(u, h);
  if (!p.ok) return `<small class="dim">${esc(p.motivo)}</small>`;
  const id = esc(h.hito_id);
  return `<form data-form="ti-pendiente" data-arg="${id}" class="ti-fecha"><label for="fc-${id}" class="sr">Fecha comprometida para ${id}</label>
    <span class="field field-sm"><input type="date" id="fc-${id}" name="fecha" value="${esc(h.fecha_comprometida || '')}"></span><button class="btn btn-ghost btn-sm" type="submit">Guardar fecha</button></form>`;
}

// ---------- Personas / Administrador ----------
const TABS = [['fichas', 'Fichas de ingreso', 'Quién está listo para su primer día.'], ['alertas', 'Alertas', 'Qué hay que resolver, quién y para cuándo.'], ['indicadores', 'Indicadores', 'Si la ficha está cambiando el ingreso.'],
  ['resumen', 'Resumen', 'Proceso de ingreso completo.'], ['casos', 'Casos críticos', 'Personas que necesitan una acción hoy.'], ['calidad', 'Calidad de datos', 'Lo que los archivos no dicen bien.'],
  ['reportes', 'Reportes', 'Lo que dicen los colaboradores.'], ['permisos', 'Permisos', 'Quién puede ver y hacer qué.'], ['bitacora', 'Bitácora', 'Cada cambio y cada acceso, con su autor.'], ['datos', 'Datos', 'Fecha de corte y carga de archivos.']];
function vPersonas(u) {
  const { auth } = store.state;
  const disponibles = TABS.filter(([k]) => (k !== 'resumen' || auth.puedeVerMetricas(u))
    && (k !== 'reportes' || auth.puedeVerReportes(u)) && (k !== 'bitacora' || auth.puedeVerBitacora(u))
    && (k !== 'datos' || auth.puedeCargarArchivos(u)));
  if (!disponibles.some(([k]) => k === ui.tab)) ui.tab = disponibles[0][0];
  const rep = auth.puedeVerReportes(u) ? store.reportesVisibles().filter(r => r.estado !== 'Cerrado').length : 0;
  const reglasAltas = new Set(alertasVisibles(u).filter(a => a.sev === 'alta').map(a => a.regla)).size;
  const [, nombreTab, titulo] = TABS.find(t => t[0] === ui.tab);
  const i = TABS.findIndex(t => t[0] === ui.tab);
  const contenido = { fichas: tFichas, alertas: tAlertas, indicadores: tIndicadores, resumen: tResumen, casos: tCasos, calidad: tCalidad, reportes: tReportes, permisos: tPermisos, bitacora: tBitacora, datos: tDatos }[ui.tab](u);
  const body = `<section class="blk hero hero-sm" id="inicio">${tags([u.rol === 'Administrador' ? 'Administración' : 'Equipo de Personas', `${pad2(i + 1)} · ${nombreTab}`])}<h1>${esc(titulo)}</h1></section>${contenido}`;
  const nav = disponibles.map(([k, t], j) => ({ label: t, act: 'tab', arg: k, n: pad2(j + 1), active: ui.tab === k,
    right: k === 'reportes' ? (rep || undefined) : k === 'calidad' ? reglasAltas : k === 'alertas' ? (store.alertasFicha().filter(a => a.estado === 'abierta').length || undefined) : undefined }));
  return { nav, body };
}

function tFichas() {
  const todas = store.ingresos();
  const F = {
    accion: ['Requieren acción', todas.filter(v => v.semaforo.color === 'rojo')],
    atrasados: ['Atrasados', todas.filter(v => v.hitos.some(x => x.estado === 'Atrasado'))],
    confirmados: ['Confirmados', todas.filter(v => v.est === 'confirmada')],
    todos: ['Todos', todas],
  };
  const lista = F[ui.fichaFiltro][1];
  return `<section class="blk"><p class="hint">Sede piloto: el kit no la define, se muestran todos los ingresos de tu alcance (supuesto declarado). Datos minimizados.</p>
  ${filtros('ficha-filtro', Object.entries(F).map(([k, [t, l]]) => [k, t, l.length]), ui.fichaFiltro)}
  <div class="table-wrap"><table><thead><tr><th>Semáforo</th><th>Persona</th><th>Área</th><th>Ingreso</th><th>Jefatura</th><th>Ficha</th><th>Motivo</th></tr></thead><tbody>
  ${lista.map(v => `<tr><td>${semaforoFicha(v.semaforo)}</td><td><b>${esc(v.c.nombre || v.c.colaborador_id)}</b><br><code>${esc(v.c.colaborador_id)}</code></td><td>${esc(v.c.area)}</td>
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
  return `<section class="blk"><p class="hint">Cada alerta indica responsable, acción requerida, plazo y prioridad. Plazos según ${store.state.config.fuentePlazo === 'hito' ? 'la fecha registrada en el hito (y el catálogo si falta)' : 'el plazo del catálogo'}. Las notificaciones son simuladas: no se envía nada.</p>
  ${filtros('alerta-filtro', Object.entries(F).map(([k, t]) => [k, t, k === 'todas' ? todas.length : todas.filter(a => a.estado === k).length]), ui.alertaFiltro)}
  <div class="table-wrap"><table><thead><tr><th>Prioridad</th><th>Alerta</th><th>Persona</th><th>Responsable</th><th>Acción requerida</th><th>Plazo</th><th>Estado</th><th></th></tr></thead><tbody>
  ${lista.slice(0, 150).map(a => { const h = a.hito_id ? s.data.hitos.find(x => x.hito_id === a.hito_id) : null;
    return `<tr><td>${chipPrio(a.prioridad)}</td><td><b>${esc(a.titulo)}</b><br><small class="dim">${esc(TIPOS_ALERTA[a.tipo] || a.tipo)}${a.hito_id ? ` · <code>${esc(a.hito_id)}</code>` : ''}</small></td>
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
  const disc = Object.values(k.porMotivo).reduce((a, b) => a + b, 0);
  return `<section class="blk"><div class="detail">
      <div class="stack"><p class="big-num num">${k.pctAntesDia1 === null ? '—' : `${k.pctAntesDia1}%`}</p>
        <p class="lead">de las fichas enviadas se confirmaron antes del día 1 (${k.confirmadasAntesDia1} de ${k.enviadas}).</p>
        ${k.enviadas ? '' : '<p class="hint">Aún no hay fichas enviadas. El indicador aparece cuando una jefatura envía la primera.</p>'}</div>
      ${stats([['Ingresos en tu alcance', String(k.ingresos)], ['Fichas enviadas', String(k.enviadas)], ['Fichas confirmadas', String(k.confirmadas), k.confirmadas ? 'ok' : ''], ['Discrepancias reportadas', String(disc), disc ? 'warn' : '']])}
    </div></section>
  <section class="blk"><p class="caption">Discrepancias por motivo</p>${stats(Object.entries(k.porMotivo).map(([m, n]) => [MOTIVOS[m], String(n)]))}</section>
  <section class="blk"><p class="caption">Hitos atrasados por responsable</p>
    ${k.atrasadosPorResponsable.length ? stats(k.atrasadosPorResponsable.map(([r, n]) => [r, String(n), 'bad'])) : '<p class="empty">Sin hitos atrasados.</p>'}
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
  return `<section class="blk"><div class="detail">
      <div class="stack"><p class="big-num tone-bad num">${venc}</p><p class="lead">hitos atrasados según el plazo del catálogo. El registro marca solo ${reg}.</p>
        ${venc > reg ? `<p class="hint">${venc - reg} hitos figuran como "Pendiente", pero su fecha límite se movió más allá del plazo del catálogo. Aquí se cuentan como atrasados.</p>` : ''}</div>
      ${stats([['Hitos abiertos', String(abiertos.length)], ['Atrasados según el catálogo', String(venc), 'bad'], ['Atrasados según el registro', String(reg)], ['"Cumplido" sin respaldo de fecha', String(pv), 'warn'], ['Personas con un atraso crítico', String(personasCrit), 'bad']])}
    </div></section>
    <section class="blk"><p class="caption">Cumplimiento real por hito y área</p>
      <div class="table-wrap"><table class="heatmap"><thead><tr><th>Hito</th>${areas.map(a => `<th>${a}</th>`).join('')}<th>Total</th></tr></thead><tbody>
      ${TIPOS_HITO.map(t => `<tr><th scope="row">${t}</th>${areas.map(a => celda(items.filter(x => x.h.tipo_hito === t && s.idx.colab.get(x.h.colaborador_id)?.area === a))).join('')}${celda(items.filter(x => x.h.tipo_hito === t))}</tr>`).join('')}
      </tbody></table></div><p class="hint">Porcentaje de hitos cumplidos con fecha válida. Datos agregados, sin identificar personas.</p></section>
    <section class="blk"><p class="caption">Atrasos por sede</p>${porSede(items)}</section>`;
}
function porSede(items) {
  const s = store.state; const sedes = ['Santiago Centro', 'Providencia', 'Valparaíso', 'Concepción'];
  const max = Math.max(1, ...sedes.map(se => items.filter(x => x.ev.estadoReal === 'Vencido' && s.idx.colab.get(x.h.colaborador_id)?.sede === se).length));
  return `<div class="metric-rows">${sedes.map(se => { const n = items.filter(x => x.ev.estadoReal === 'Vencido' && s.idx.colab.get(x.h.colaborador_id)?.sede === se).length;
    return `<div class="metric"><span>${se}</span><div class="bar bar-lg bar-bad"><span style="width:${Math.round(n / max * 100)}%"></span></div><b class="num">${n}</b><small class="dim">atrasados</small></div>`; }).join('')}</div>`;
}

function tCasos(u) {
  const s = store.state;
  const lista = colaboradoresVisibles(u).map(c => ({ c, av: avanceColaborador(c.colaborador_id, s.idx, s.hoy) }))
    .filter(x => x.av.vencidos || x.av.porVerificar || !x.c.jefatura_id)
    .sort((a, b) => (!b.c.jefatura_id) - (!a.c.jefatura_id) || b.av.vencidosAltos - a.av.vencidosAltos || b.av.vencidos - a.av.vencidos);
  return `<section class="blk"><p class="caption">${lista.length} personas con atrasos, hitos por verificar o sin jefatura</p>
  <div class="table-wrap"><table><thead><tr><th>Persona</th><th>Área · sede</th><th>Jefatura</th><th>Canal</th><th>Avance</th><th>Atrasos</th><th></th></tr></thead><tbody>
  ${lista.map(({ c, av }) => `<tr><td>${dot(av.semaforo)} <b>${esc(nombreDe(c.colaborador_id))}</b><br><code>${esc(c.colaborador_id)}</code></td>
    <td>${esc(c.area)}<br><small class="dim">${esc(c.sede)}</small></td>
    <td>${c.jefatura_id ? `<code>${esc(c.jefatura_id)}</code>` : '<span class="chip chip-bad">Sin jefatura</span>'}</td>
    <td>${c.canal_contacto ? esc(c.canal_contacto) : '<span class="missing">Sin dato</span>'}</td>
    <td class="num">${av.cumplidos}/${av.total}</td><td class="num">${av.vencidos}${av.vencidosAltos ? ` <small class="dim">(${av.vencidosAltos} críticos)</small>` : ''}${av.porVerificar ? `<br><small class="dim">${av.porVerificar} por verificar</small>` : ''}</td>
    <td><button class="btn btn-ghost btn-sm" data-act="detalle" data-arg="${esc(c.colaborador_id)}">${ui.detalle === c.colaborador_id ? 'Cerrar' : 'Abrir'}</button></td></tr>
    ${ui.detalle === c.colaborador_id ? `<tr class="sub"><td colspan="7">${tablaHitos(u, c.colaborador_id)}</td></tr>` : ''}`).join('')}
  </tbody></table></div></section>`;
}

function tCalidad(u) {
  if (!store.state.auth.puedeVerCalidad(u)) return vDenegado();
  const grupos = agruparAlertas(alertasVisibles(u));
  return `<section class="blk"><p class="lead">Reglas del diccionario de datos aplicadas a los 4 archivos. Nada se corrige automáticamente: cada alerta indica qué hacer.</p>
  <div class="acc">${grupos.map(g => `<details class="alert alert-${esc(g.sev)}" ${ui.alertaAbierta === g.regla ? 'open' : ''} data-regla="${esc(g.regla)}">
    <summary><span class="caption sev">${g.sev === 'alta' ? 'Alta' : g.sev === 'media' ? 'Media' : 'Info'}</span><span class="acc-t">${esc(g.titulo)}</span><span class="num count">${g.items.length}</span></summary>
    <div class="acc-body"><p class="dim">${esc(g.accion)}</p>
    <ul class="mini">${g.items.slice(0, 60).map(a => `<li><code>${esc(a.id)}</code> ${esc(a.detalle)}</li>`).join('')}${g.items.length > 60 ? `<li>… y ${g.items.length - 60} más</li>` : ''}</ul></div>
  </details>`).join('')}</div></section>`;
}

function tReportes() {
  const reps = store.reportesVisibles();
  if (!reps.length) return `<section class="blk"><p class="empty">Aún no hay reportes en tu alcance. Para probarlos, entra como COL-002 y usa "¿Algo no coincide?".</p></section>`;
  return `<section class="blk"><p class="hint">Solo categorías de revisión, sin relatos libres. Personas gestiona los casos de su alcance. No se comparten con jefaturas ni TI y no se usan para evaluar ni seleccionar. Se borran al recargar.</p>
  <ul class="rows">${reps.map(r => `<li class="hrow"><span class="rb-main"><b>${esc(r.tipo)} · ${esc(nombreDe(r.colaborador_id))}</b><span class="dim"><code>${esc(r.colaborador_id)}</code> · ${fmt(r.fecha)} · ${esc(r.id)}</span></span>
    <span class="field field-sm"><label for="st-${esc(r.id)}" class="sr">Estado</label><select id="st-${esc(r.id)}" data-change="rep-estado" data-arg="${esc(r.id)}">${ESTADOS_REPORTE.map(e => `<option ${e === r.estado ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select></span></li>`).join('')}</ul></section>`;
}

function tPermisos() {
  const roles = ['Colaborador', 'Jefatura', 'TI', 'Personas'];
  return `<section class="blk"><p class="caption">Lo que cada rol puede hacer en Sprint</p>
  <div class="table-wrap"><table><thead><tr><th>Capacidad</th>${roles.map(r => `<th>${r}</th>`).join('')}</tr></thead><tbody>
  ${MATRIZ_EFECTIVA.map(m => `<tr><th scope="row">${esc(m.cap)}</th>${roles.map(r => `<td>${esc(m[r])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
  <p class="hint">Acceso efectivo = rol + equipo_asignado + permiso Sí/No + tipo de responsabilidad. Un "Sí" del archivo nunca da acceso global por sí solo.</p></section>
  <section class="blk"><p class="caption">Permisos del archivo que se acotaron</p>${stats([
    ['TI · puede_asignar_responsables = Sí', 'Solo entre cuentas TI, solo Equipo y Acceso'],
    ['TI · puede_ver_metricas = Sí', 'Solo cifras agregadas de hitos técnicos'],
    ['Jefatura · puede_ver_datos_personales = Sí', 'Solo su equipo, nunca el canal de contacto'],
    ['Colaborador · puede_ver_datos_personales = Sí', 'Solo sus propios datos'],
  ])}</section>`;
}

function tBitacora() {
  if (!store.state.auth.puedeVerBitacora(store.state.user)) return '';
  const b = store.state.bitacora;
  return `<section class="blk"><div class="row-between"><p class="caption">${b.length} movimientos</p>
    <div class="row"><button class="btn btn-ghost btn-sm" data-act="export" data-arg="bitacora">Copiar bitácora (CSV)</button><button class="btn btn-ghost btn-sm" data-act="export" data-arg="hitos">Copiar hitos actualizados (CSV)</button></div></div>
    ${ui.exportTexto ? `<label for="exp" class="sr">CSV</label><textarea id="exp" class="export" rows="6" readonly>${esc(ui.exportTexto)}</textarea>` : ''}
    ${b.length ? `<div class="table-wrap"><table><thead><tr><th>Cuándo</th><th>Usuario</th><th>Acción</th><th>Objetivo</th><th>Detalle</th><th>Resultado</th></tr></thead><tbody>
    ${b.slice(0, 200).map(x => `<tr><td class="num"><small>${esc(new Date(x.ts).toLocaleString('es-CL'))}</small></td><td><code>${esc(x.usuario)}</code><br><small class="dim">${esc(x.rol)}</small></td><td>${esc(x.accion)}</td><td><code>${esc(x.objetivo)}</code></td><td>${esc(x.detalle)}</td><td>${x.resultado === 'ok' ? '<span class="chip chip-ok">ok</span>' : `<span class="chip chip-bad">${esc(x.resultado)}</span>`}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="empty">Sin movimientos todavía.</p>'}</section>`;
}

function tDatos() {
  const s = store.state;
  return `<section class="blk"><p class="caption">Fecha de corte</p>
    <form data-form="hoy" class="form form-inline"><div class="field"><label for="hoy">Calcular atrasos al*</label><input type="date" id="hoy" name="hoy" value="${esc(s.hoy)}" required></div><div><button class="btn btn-primary btn-sm" type="submit">Aplicar</button></div></form></section>
  <section class="blk"><p class="caption">Cargar archivos nuevos</p>
    <p class="lead">Usa exclusivamente los CSV sintéticos del kit con su nombre original. No cargues datos reales, credenciales ni columnas adicionales. Se rechazan campos ajenos al diccionario y la carga queda solo en memoria.</p>
    <form data-form="carga" class="form"><div class="field"><label for="files">Archivos CSV* (máximo 2 MB por archivo)</label><input type="file" id="files" name="files" accept=".csv,text/csv" multiple></div><div><button class="btn btn-primary btn-sm" type="submit">Validar y cargar</button></div></form>
    ${ui.cargaErrores ? `<div class="notice notice-bad" role="alert"><b>No se cargó nada.</b> Corrige esto y vuelve a intentar:<ul class="mini">${ui.cargaErrores.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}</section>
  <section class="blk"><p class="caption">Reiniciar la demo</p><p class="lead">Vuelve a los datos originales y borra los reportes y movimientos de esta sesión. También se borran al recargar.</p>
    <div><button class="btn btn-ghost btn-sm" data-act="reset">Reiniciar demo</button></div></section>`;
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
    // Misma entrada para todos: el rol de la cuenta decide la vista (colaborador, jefatura, TI o Personas).
    const r = store.login(ui.loginStep?.id, 'código de verificación');
    if (!r.ok) { store.logout(); ui.loginError = 'No encontramos una cuenta autorizada con ese código. Revísalo o pide ayuda al equipo de Personas.'; return render(); }
    ui.loginStep = null; ui.loginError = ''; resetUi(); return render();
  }
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
    case 'tab': ui.tab = arg; ui.detalle = null; ui.reasignando = null; ui.exportTexto = null; render(); return window.scrollTo(0, 0);
    case 'detalle': ui.detalle = ui.detalle === arg ? null : arg; ui.reasignando = null; return render();
    case 'ti-filtro': ui.tiFiltro = arg; ui.reasignando = null; return render();
    case 'ficha-filtro': ui.fichaFiltro = arg; return render();
    case 'alerta-filtro': ui.alertaFiltro = arg; ui.reasignando = null; return render();
    case 'volver': ui.denegado = null; return render();
    case 'probar-403': { const r = store.entrar('/ficha', arg); ui.denegado = r.ok ? null : arg; render(); return window.scrollTo(0, 0); }
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
