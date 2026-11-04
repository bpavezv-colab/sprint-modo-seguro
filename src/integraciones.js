// Integraciones opcionales de la página: estado del servidor local, asistente, alertas por correo y "Sugerir reparto".
// Sin servidor (doble clic en dist/index.html, o servidor sin .env) todo sigue funcionando en modo simulado:
// el asistente responde con reglas, el correo se simula y el reparto muestra el cálculo simple.
// La página nunca envía claves ni elige el destinatario del correo: solo IDs, la pregunta y la fecha de corte.
import { responder, SUGERENCIAS } from './asistente.js';
import { calcularReparto, textoReparto } from './reparto.js';

export function estadoInicial() {
  return { estado: null, chat: false, mensajes: [], enviando: false, reparto: null, correo: {} };
}

async function llamar(ruta, body, ms = 25000) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const t = ctl ? setTimeout(() => ctl.abort(), ms) : null;
  try {
    const r = await fetch(ruta, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, signal: ctl?.signal, cache: 'no-store' });
    const datos = await r.json().catch(() => null);
    if (!datos || typeof datos !== 'object') return { ok: false, motivo: 'El servidor respondió algo inesperado.' };
    return datos;
  } catch {
    return { ok: false, red: true, motivo: 'No se pudo conectar con el servidor local. ¿Sigue corriendo npm start?' };
  } finally { if (t) clearTimeout(t); }
}

// Se llama una vez al montar. En tests (sin location/fetch) queda "sin servidor" sin intentar nada.
export async function detectarServidor({ ui, render }) {
  const loc = globalThis.location;
  if (!loc || typeof fetch !== 'function') { ui.ia.estado = { servidor: false, motivo: 'sin_servidor' }; return; }
  if (loc.protocol === 'file:') { ui.ia.estado = { servidor: false, motivo: 'archivo' }; render(); return; }
  const r = await llamar('/api/estado', null, 4000);
  ui.ia.estado = r.ok && r.servidor ? { servidor: true, ia: r.ia, modelo: r.modelo, correo: r.correo, destino: r.destino } : { servidor: false, motivo: 'sin_servidor' };
  render();
}

const conServidor = ui => !!ui.ia.estado?.servidor;

export function barraModo(ui, esc) {
  const e = ui.ia.estado;
  if (!e) return '';
  if (!e.servidor) {
    const txt = e.motivo === 'archivo'
      ? 'Abriste el archivo directamente (doble clic). Así no funcionan la IA ni el correo: corre <code>npm start</code> y abre <b>http://localhost:3000</b>. El resto de la app funciona igual.'
      : 'Modo simulado: sin servidor local. El asistente responde con reglas, el correo no se envía y el reparto muestra el cálculo simple.';
    return `<div class="modo modo-sim caption" role="status"><span class="chip chip-warn">Simulado</span><span>${txt}</span></div>`;
  }
  const ia = e.ia === 'activa' ? `<span class="chip chip-ok">IA activa</span>` : `<span class="chip chip-warn">IA sin clave · reglas</span>`;
  const co = e.correo === 'real' ? `<span class="chip chip-ok">Correo real · ${esc(e.destino)}</span>` : `<span class="chip chip-warn">Correo simulado · falta .env</span>`;
  const sim = e.ia !== 'activa' || e.correo !== 'real';
  return `<div class="modo caption" role="status">${ia}${co}${sim ? '<span class="dim">Lo que falta se completa en el archivo .env del servidor (ver README).</span>' : ''}</div>`;
}

// ---------- asistente ----------
export function panelChat(store, ui, esc) {
  const u = store.state.user;
  if (!u || !store.state.auth.cuentaValida(u)) return '';
  if (!ui.ia.chat) return `<button class="btn btn-primary chat-fab" data-act="ia-chat">Asistente</button>`;
  const sugerencias = SUGERENCIAS[u.rol] || SUGERENCIAS.Personas;
  const origen = conServidor(ui) && ui.ia.estado.ia === 'activa' ? 'Responde con IA usando solo lo que tu cuenta puede ver.' : 'Responde con reglas a partir de lo que tu cuenta puede ver.';
  return `<section class="chat" role="dialog" aria-label="Asistente" aria-modal="false">
    <div class="row-between chat-head"><span class="caption">Asistente</span><button class="close caption" data-act="ia-chat">Cerrar</button></div>
    <p class="hint">${origen} No escribas datos personales: la conversación no se guarda.</p>
    <div class="chat-log" aria-live="polite">${ui.ia.mensajes.length ? ui.ia.mensajes.map(m => `<div class="msg msg-${m.de}">${m.de === 'bot' ? `<span class="caption dim">${m.fuente === 'ia' ? 'IA' : 'Reglas'}</span>` : ''}<p>${esc(m.texto).replace(/\n/g, '<br>')}</p>${m.aviso ? `<small class="dim">${esc(m.aviso)}</small>` : ''}</div>`).join('')
      : `<div class="tags caption">${sugerencias.map(q => `<button class="btn btn-ghost btn-sm" data-act="ia-sugerida" data-arg="${esc(q)}">${esc(q)}</button>`).join('')}</div>`}
      ${ui.ia.enviando ? '<p class="caption dim">Escribiendo…</p>' : ''}</div>
    <form data-form="ia-chat" class="form chat-form"><div class="field"><label for="ia-q">Tu pregunta</label><input id="ia-q" name="q" maxlength="500" autocomplete="off" placeholder="Ej. ¿Qué me falta?"></div>
      <button class="btn btn-primary btn-sm" type="submit" ${ui.ia.enviando ? 'disabled' : ''}>Enviar</button></form>
  </section>`;
}

async function preguntar(texto, { store, ui, render }) {
  const q = String(texto || '').trim().slice(0, 500);
  if (!q || ui.ia.enviando) return;
  const s = store.state;
  ui.ia.mensajes.push({ de: 'yo', texto: q }); ui.ia.enviando = true; render();
  let r;
  if (conServidor(ui)) r = await llamar('/api/chat', { usuario_id: s.user.usuario_id, hoy: s.hoy, pregunta: q });
  if (!r || !r.ok) r = { ok: true, fuente: 'reglas', texto: responder(q, store), aviso: r && !r.ok ? r.motivo : '' };
  ui.ia.enviando = false;
  ui.ia.mensajes.push({ de: 'bot', texto: r.texto, fuente: r.fuente, aviso: r.aviso });
  if (ui.ia.mensajes.length > 30) ui.ia.mensajes.splice(0, ui.ia.mensajes.length - 30);
  store.registrarConsulta('chat', r.fuente);
  render();
}

// ---------- correo ----------
export function botonCorreo(colId, ui, esc) {
  const st = ui.ia.correo[colId];
  if (st === 'enviando') return '<span class="caption dim">Enviando…</span>';
  return `<button class="btn btn-ghost btn-sm" data-act="ia-correo" data-arg="${esc(colId)}">${st ? 'Reenviar aviso' : 'Avisar por correo'}</button>`;
}

async function enviarCorreo(colId, { store, ui, render, toast }) {
  const s = store.state;
  if (!conServidor(ui)) {
    store.registrarCorreo(colId, 'simulado');
    return toast(ui.ia.estado?.motivo === 'archivo' ? 'Correo simulado: con doble clic no se envían correos. Abre la app con npm start.' : 'Correo simulado: no hay servidor local.');
  }
  ui.ia.correo[colId] = 'enviando'; render();
  const r = await llamar('/api/alerta', { usuario_id: s.user.usuario_id, hoy: s.hoy, colaborador_id: colId });
  ui.ia.correo[colId] = r.ok ? (r.simulado ? 'simulado' : 'enviado') : 'error';
  store.registrarCorreo(colId, ui.ia.correo[colId]);
  return toast(!r.ok ? r.motivo : r.simulado ? 'Correo simulado (falta .env). Quedó en la bitácora.' : `Alerta enviada a la casilla de demostración (${r.destino}).`);
}

// ---------- sugerir reparto (jefatura) ----------
export function seccionReparto(store, ui, esc) {
  const r = ui.ia.reparto;
  const cab = `<section class="blk" id="reparto"><div class="row-between"><p class="caption">Sugerir reparto</p>
    <button class="btn btn-primary btn-sm" data-act="ia-reparto" ${r?.cargando ? 'disabled' : ''}>${r ? 'Recalcular' : 'Sugerir reparto'}</button></div>
    <p class="lead">Propone quién acompaña a cada persona que aún no tiene compañero/a de apoyo, eligiendo a quien tiene menos carga. Tú decides: nada cambia hasta que confirmes.</p>`;
  if (!r) return `${cab}</section>`;
  const c = r.calc;
  return `${cab}
    <div class="table-wrap"><table><thead><tr><th>Persona del equipo</th><th>Hitos abiertos</th><th>Personas que ya acompaña</th><th>Carga</th></tr></thead><tbody>
      ${c.cargas.map(x => `<tr><td><code>${esc(x.persona)}</code></td><td class="num">${x.hitos_abiertos}</td><td class="num">${x.ya_acompana}</td><td class="num">${x.carga}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="notice"><p class="caption dim">${r.cargando ? 'Redactando…' : r.fuente === 'ia' ? 'Redactado por IA a partir del cálculo' : 'Cálculo simple (sin IA)'}</p><p>${esc(r.texto).replace(/\n/g, '<br>')}</p>${r.aviso ? `<small class="dim">${esc(r.aviso)}</small>` : ''}</div>
    ${r.propuestas.length ? `<p class="caption">Lo que se aplicará</p><ul class="rows">${r.propuestas.map(p => `<li class="hrow"><span class="rb-main"><b><code>${esc(p.companero_id)}</code> acompaña a <code>${esc(p.colaborador_id)}</code></b><span class="dim">Carga actual de ${esc(p.companero_id)}: ${Number(p.carga_companero) || 0}</span></span></li>`).join('')}</ul>` : ''}
    ${r.propuestas.length ? `<div class="row"><button class="btn btn-primary" data-act="ia-aplicar" ${r.cargando ? 'disabled' : ''}>Aplicar sugerencia</button><button class="btn btn-ghost" data-act="ia-reparto-cerrar">Descartar</button></div>` : ''}
    <p class="hint">Carga = hitos de ingreso abiertos + ${c.pesoApoyo} por cada persona que ya acompaña. No mide desempeño. Aplicar deja el cambio en la bitácora.</p>
  </section>`;
}

async function sugerirReparto({ store, ui, render, toast }) {
  const s = store.state;
  const calc = calcularReparto(store);
  if (!calc) return toast('Solo una jefatura puede pedir un reparto.');
  ui.ia.reparto = { calc, propuestas: calc.propuestas, texto: textoReparto(calc), fuente: 'calculo', cargando: conServidor(ui) && calc.propuestas.length > 0 };
  render();
  if (!ui.ia.reparto.cargando) { store.registrarConsulta('sugerencia', 'calculo'); return undefined; }
  const r = await llamar('/api/sugerencia', { usuario_id: s.user.usuario_id, hoy: s.hoy, propuestas: calc.propuestas });
  const actual = ui.ia.reparto; if (!actual || actual.calc !== calc) return undefined; // se recalculó o descartó mientras tanto
  if (r.ok) Object.assign(actual, { texto: r.texto, fuente: r.fuente, aviso: r.aviso, propuestas: r.propuestas });
  else Object.assign(actual, { aviso: r.motivo });
  actual.cargando = false;
  store.registrarConsulta('sugerencia', actual.fuente);
  return render();
}

// ---------- eventos ----------
export function clickIntegraciones(act, arg, ctx) {
  const { ui, render } = ctx;
  switch (act) {
    case 'ia-chat': ui.ia.chat = !ui.ia.chat; render(); if (ui.ia.chat) ctx.root?.querySelector?.('#ia-q')?.focus?.(); return undefined;
    case 'ia-sugerida': return preguntar(arg, ctx);
    case 'ia-correo': {
      const real = conServidor(ui) && ui.ia.estado.correo === 'real';
      ui.confirm = { texto: real ? `Enviar una alerta sobre ${arg} a la casilla de demostración. El correo lleva solo IDs y conteos.` : `Simular la alerta sobre ${arg}. No se envía ningún correo porque falta configurar .env.`, act: 'ia-correo', arg };
      return render();
    }
    case 'ia-reparto': return sugerirReparto(ctx);
    case 'ia-reparto-cerrar': ui.ia.reparto = null; return render();
    case 'ia-aplicar': {
      const n = ui.ia.reparto?.propuestas.length || 0; if (!n) return undefined;
      ui.confirm = { texto: `Asignar ${n} ${n === 1 ? 'compañero/a de apoyo' : 'compañeros/as de apoyo'} según la sugerencia. Queda registrado en la bitácora con tu usuario.`, act: 'ia-aplicar' };
      return render();
    }
    default: return undefined;
  }
}

export function confirmarIntegraciones(c, ctx) {
  const { store, ui, toast } = ctx;
  if (c.act === 'ia-correo') return enviarCorreo(c.arg, ctx);
  if (c.act === 'ia-aplicar') {
    const r = store.aplicarReparto(ui.ia.reparto?.propuestas || [], { confirmado: true });
    if (r.ok) ui.ia.reparto = null;
    return toast(r.ok ? `Reparto aplicado: ${r.aplicadas} ${r.aplicadas === 1 ? 'asignación' : 'asignaciones'}${r.rechazadas ? `, ${r.rechazadas} rechazadas` : ''}.` : r.motivo);
  }
  return ctx.render();
}

export function submitIntegraciones(form, ctx) {
  if (form.dataset.form !== 'ia-chat') return false;
  const input = form.querySelector('[name="q"]'); const q = input?.value || '';
  if (input) input.value = '';
  return preguntar(q, ctx).then(() => { ctx.root?.querySelector?.('#ia-q')?.focus?.(); return true; });
}
