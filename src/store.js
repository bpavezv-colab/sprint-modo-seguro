// Capa "servidor" simulada: estado, acciones y trazabilidad.
// Cada acción vuelve a validar permisos aquí (no basta con esconder botones en la interfaz)
// y todo cambio relevante escribe un evento: actor_id, rol, accion, entidad, entidad_id, campo,
// valor_anterior, valor_nuevo, created_at.
import { indexData, validar, HOY_DEFAULT, isISO } from './rules.js';
import { crearAuth } from './permissions.js';
import { ReglasOnboarding, CONFIG, MOTIVOS, ESTADOS_FICHA, POST_ENVIO } from './reglas_onboarding.js';

const KEY = 'ficha-ingreso-v1';
const SKEY = 'ficha-ingreso-sesion';
const ls = () => { try { return globalThis.localStorage || null; } catch { return null; } };
const ss = () => { try { return globalThis.sessionStorage || null; } catch { return null; } };
function safeGet(st, k) { try { return st ? JSON.parse(st.getItem(k) || 'null') : null; } catch { return null; } }
function safeSet(st, k, v) { try { if (st) st.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento: sigue en memoria */ } }
function safeDel(st, k) { try { if (st) st.removeItem(k); } catch { /* noop */ } }
const limpiar = (v, max = 200) => { const t = String(v ?? '').trim().slice(0, max); return t === '' ? null : t; };
const CAMPOS_EDITABLES = ['tarea_1', 'tarea_2', 'tarea_3', 'companero_id', 'reunion_at'];

export function crearStore(base, { persist = true, now, config = CONFIG } = {}) {
  const saved = persist ? safeGet(ls(), KEY) : null;
  const s = {
    base, config,
    data: null, idx: null, auth: null, reglas: null, alertas: [], calidad: [],
    hoy: (saved && saved.hoy) || HOY_DEFAULT,
    overrides: (saved && saved.overrides) || {},       // hito_id -> campos modificados por el equipo
    fichas: (saved && saved.fichas) || {},             // colaborador_id -> ficha (creado_por_equipo: true)
    alertaEstados: (saved && saved.alertaEstados) || {}, // alerta_id -> { estado, por, actualizada_at }
    eventos: (saved && saved.eventos) || [],
    user: null,
  };
  // Reloj simulado: fecha de corte + hora real. Así "antes del día 1" se evalúa contra la fecha de la demo.
  const reloj = now || (() => `${s.hoy}T${new Date().toTimeString().slice(0, 8)}`);
  const nombreDe = id => { const u = s.auth && s.auth.users.get(id); return u ? u.nombre_ficticio : id; };

  function rebuild() {
    const hitos = s.base.hitos.map(h => (s.overrides[h.hito_id] ? { ...h, ...s.overrides[h.hito_id] } : h));
    s.data = { ...s.base, hitos };
    s.idx = indexData(s.data);
    s.auth = crearAuth(s.data);
    s.reglas = new ReglasOnboarding({ idx: s.idx, hoy: s.hoy, config: s.config, nombreDe });
    s.calidad = validar(s.data, s.idx, s.hoy);
    const enPiloto = s.config.sedePiloto ? s.data.colaboradores.filter(c => c.sede === s.config.sedePiloto) : s.data.colaboradores;
    s.alertas = s.reglas.alertas(enPiloto, s.data.hitos.filter(h => enPiloto.some(c => c.colaborador_id === h.colaborador_id)), s.fichas)
      .map(a => ({ ...a, estado: (s.alertaEstados[a.id] && s.alertaEstados[a.id].estado) || 'abierta', gestion: s.alertaEstados[a.id] || null }));
  }
  function save() {
    if (persist) safeSet(ls(), KEY, { hoy: s.hoy, overrides: s.overrides, fichas: s.fichas, alertaEstados: s.alertaEstados, eventos: s.eventos });
  }
  function evento({ accion, entidad = '—', entidad_id = '—', campo = null, valor_anterior = null, valor_nuevo = null, detalle = '', resultado = 'ok' }) {
    s.eventos.unshift({
      id: `EV-${String(s.eventos.length + 1).padStart(4, '0')}`, created_at: reloj(),
      actor_id: s.user ? s.user.usuario_id : '—', rol: s.user ? s.user.rol : '—',
      accion, entidad, entidad_id, campo, valor_anterior: valor_anterior ?? null, valor_nuevo: valor_nuevo ?? null, detalle, resultado,
      creado_por_equipo: true,
    });
    save();
  }
  const hito = id => s.data.hitos.find(h => h.hito_id === id);
  function patch(id, campos) { s.overrides[id] = { ...(s.overrides[id] || {}), ...campos, creado_por_equipo: true }; rebuild(); save(); }
  function denegar(accion, entidad, entidad_id, motivo) { evento({ accion, entidad, entidad_id, detalle: motivo, resultado: 'denegado' }); return { ok: false, motivo }; }
  function canalTexto(c) {
    if (!c || !c.canal_contacto) return null;
    return c.canal_contacto === 'Teléfono' ? 'teléfono (SMS)' : `correo (${c.canal_contacto.toLowerCase()})`;
  }

  rebuild();
  if (persist) {
    const sid = safeGet(ss(), SKEY);
    if (sid && s.auth.users.get(sid)) s.user = s.auth.users.get(sid);
  }

  const api = {
    get state() { return s; },

    // ---------- sesión simulada ----------
    login(usuarioId) {
      const u = s.auth.users.get(usuarioId);
      if (!u) return { ok: false, motivo: 'Cuenta no encontrada' };
      s.user = u; if (persist) safeSet(ss(), SKEY, u.usuario_id);
      evento({ accion: 'ingreso', entidad: 'sesion', entidad_id: u.usuario_id, detalle: 'Inicio de sesión simulado' });
      return { ok: true };
    },
    logout() {
      if (s.user) evento({ accion: 'salida', entidad: 'sesion', entidad_id: s.user.usuario_id });
      s.user = null; if (persist) safeDel(ss(), SKEY);
    },

    // ---------- control de acceso ----------
    entrar(ruta, param) {
      const r = s.auth.puedeEntrar(s.user, ruta, param);
      if (!r.ok && r.status === 403) evento({ accion: 'acceso_denegado', entidad: ruta === '/ficha' ? 'ficha' : 'ruta', entidad_id: param || ruta, detalle: r.motivo, resultado: 'denegado' });
      return r;
    },
    verColaborador(colId) {
      const u = s.user;
      if (!u || !s.auth.puedeVerColaborador(u, colId)) { evento({ accion: 'acceso_denegado', entidad: 'colaborador', entidad_id: colId, detalle: 'Fuera de alcance', resultado: 'denegado' }); return null; }
      return s.idx.colab.get(colId) || null;
    },

    // Vista minimizada de una ficha según quién la pide. Devuelve null si no hay permiso.
    // undefined = campo no permitido (no se muestra); null = Sin dato.
    vistaFicha(colId) {
      const u = s.user;
      if (!u || !s.auth.puedeVerFicha(u, colId)) return null;
      const c = s.idx.colab.get(colId);
      const f = s.fichas[colId] || null;
      const R = s.reglas;
      const est = R.estadoFicha(f);
      const campo = k => (s.auth.puedeVerCampo(u, colId, k) ? c[k] : undefined);
      let ficha = f ? { ...f } : null;
      if (ficha && u.rol === 'Colaborador' && !ficha.enviada_at) ficha = null; // el borrador de la jefatura no se muestra
      if (ficha && !s.auth.puedeVerComentario(u, colId)) { delete ficha.motivo; delete ficha.comentario; delete ficha.respuesta; }
      const estadoVisible = u.rol === 'Jefatura' && est === 'con_discrepancia' ? 'En revisión por Personas' : ESTADOS_FICHA[est];
      const usr = s.auth.users.get(colId);
      const hitos = (s.idx.hitosPorColab.get(colId) || []).filter(h => s.auth.puedeVerHito(u, h)).map(h => ({
        h, estado: R.estadoHito(h), fecha: R.fechaComprometida(h), limite: R.fechaLimite(h), resp: R.responsable(h), prioridad: R.prioridadHito(h),
      }));
      return {
        c: {
          colaborador_id: colId,
          nombre: s.auth.puedeVerCampo(u, colId, 'nombre') && usr ? usr.nombre_ficticio : undefined,
          area: campo('area'), sede: campo('sede'), fecha_ingreso: campo('fecha_ingreso'), tipo_turno: campo('tipo_turno'),
          jefatura_id: campo('jefatura_id'), canal_contacto: campo('canal_contacto'),
        },
        ficha, est, estadoVisible, hitos,
        semaforo: R.semaforo(c, f),
        diasParaIngreso: R.diasParaIngreso(c),
        jefatura: c.jefatura_id ? nombreDe(c.jefatura_id) : null,
        companero: ficha && ficha.companero_id ? nombreDe(ficha.companero_id) : null,
        alertas: s.auth.esPersonas(u) ? s.alertas.filter(a => a.colaborador_id === colId) : [],
      };
    },
    // Personas de la jefatura (o todas para Personas), siempre filtradas por alcance.
    ingresos() {
      const u = s.user; if (!u) return [];
      return [...s.auth.scope(u)].filter(id => s.auth.puedeVerFicha(u, id)).map(id => api.vistaFicha(id)).filter(Boolean)
        .filter(v => !s.config.sedePiloto || !s.auth.esPersonas(u) || v.c.sede === s.config.sedePiloto);
    },
    companerosPara(colId) {
      return s.auth.companerosValidos(s.user, colId).map(id => ({ id, nombre: nombreDe(id), ingreso: (s.idx.colab.get(id) || {}).fecha_ingreso }))
        .sort((a, b) => String(a.ingreso).localeCompare(String(b.ingreso)));
    },

    // ---------- ficha: jefatura ----------
    guardarFicha(colId, campos = {}) {
      const u = s.user;
      const p = s.auth.puedeEditarFicha(u, colId);
      if (!p.ok) return denegar('editar_ficha', 'ficha', colId, p.motivo);
      const f = s.fichas[colId] || {
        colaborador_id: colId, tarea_1: null, tarea_2: null, tarea_3: null, companero_id: null, reunion_at: null,
        estado: 'incompleta', respuesta: null, motivo: null, comentario: null, enviada_at: null, respondida_at: null, creado_por_equipo: true,
      };
      if (POST_ENVIO.includes(f.estado)) return { ok: false, motivo: 'La ficha ya fue enviada. Si hay que corregirla, avisa a Personas.' };
      const limpio = {};
      for (const k of CAMPOS_EDITABLES) if (k in campos) limpio[k] = limpiar(campos[k], k.startsWith('tarea') ? 160 : 40);
      if (limpio.companero_id && !s.auth.companerosValidos(u, colId).includes(limpio.companero_id)) return { ok: false, motivo: 'El compañero o compañera debe ser parte de tu equipo.' };
      if (limpio.reunion_at && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(limpio.reunion_at)) return { ok: false, motivo: 'La fecha y hora de la reunión no es válida.' };
      const nuevo = { ...f };
      for (const [k, v] of Object.entries(limpio)) {
        if ((f[k] ?? null) === v) continue;
        evento({ accion: 'editar_ficha', entidad: 'ficha', entidad_id: colId, campo: k, valor_anterior: f[k], valor_nuevo: v });
        nuevo[k] = v;
      }
      const est = s.reglas.estadoFicha({ ...nuevo, estado: null });
      if (est !== f.estado || !s.fichas[colId]) {
        evento({ accion: 'cambio_estado', entidad: 'ficha', entidad_id: colId, campo: 'estado', valor_anterior: s.fichas[colId] ? f.estado : null, valor_nuevo: est });
      }
      nuevo.estado = est;
      s.fichas[colId] = nuevo; rebuild(); save();
      return { ok: true, estado: est };
    },
    enviarFicha(colId, campos = {}) {
      const g = api.guardarFicha(colId, campos);
      if (!g.ok) return g;
      const f = s.fichas[colId];
      const faltan = s.reglas.faltantes(f);
      if (faltan.length) {
        evento({ accion: 'enviar_ficha', entidad: 'ficha', entidad_id: colId, detalle: faltan.join('; '), resultado: 'rechazado' });
        return { ok: false, faltan, motivo: `No se puede enviar: ${faltan.join('. ')}.` };
      }
      const c = s.idx.colab.get(colId);
      const antes = f.estado;
      Object.assign(f, { estado: 'enviada', enviada_at: reloj(), turno_al_enviar: c.tipo_turno ?? null });
      evento({ accion: 'enviar_ficha', entidad: 'ficha', entidad_id: colId, campo: 'estado', valor_anterior: antes, valor_nuevo: 'enviada' });
      const canal = canalTexto(c);
      evento({ accion: 'notificacion_simulada', entidad: 'colaborador', entidad_id: colId,
        detalle: canal ? `Se notificaría a ${nombreDe(colId)} por ${canal}. No se envió nada.` : `Sin dato: canal de contacto. Personas debe avisar a ${nombreDe(colId)}.` });
      rebuild(); save();
      return { ok: true, aviso: `Se notificaría a ${nombreDe(colId)} por su canal registrado (simulado: no se envía nada).` };
    },

    // ---------- ficha: persona nueva ----------
    responder(colId, respuesta, motivo, comentario, via = 'Ficha web') {
      const u = s.user;
      const p = s.auth.puedeResponderFicha(u, colId);
      if (!p.ok) return denegar('responder_ficha', 'ficha', colId, p.motivo);
      const f = s.fichas[colId];
      if (!f || !['enviada', 'requiere_reconfirmacion'].includes(f.estado)) return { ok: false, motivo: 'Tu ficha todavía no está enviada por tu jefatura.' };
      if (respuesta === 'discrepancia' && !MOTIVOS[motivo]) return { ok: false, motivo: 'Elige qué no coincide para poder enviar el aviso.' };
      const antes = f.estado;
      Object.assign(f, {
        estado: respuesta === 'confirmo' ? 'confirmada' : 'con_discrepancia',
        respuesta, motivo: respuesta === 'discrepancia' ? motivo : null,
        comentario: respuesta === 'discrepancia' ? limpiar(comentario, 500) : null,
        respondida_at: reloj(), respondida_via: via,
      });
      evento({ accion: respuesta === 'confirmo' ? 'confirmar_ficha' : 'reportar_discrepancia', entidad: 'ficha', entidad_id: colId, campo: 'estado',
        valor_anterior: antes, valor_nuevo: f.estado, detalle: respuesta === 'discrepancia' ? `Motivo: ${MOTIVOS[motivo]}. El comentario solo lo ve Personas.` : `Vía: ${via}` });
      if (respuesta === 'discrepancia') evento({ accion: 'notificacion_simulada', entidad: 'ficha', entidad_id: colId, detalle: 'Se notificaría a Personas por correo. No se envió nada.' });
      rebuild(); save();
      return { ok: true, estado: f.estado };
    },
    confirmarFicha() { return api.responder(s.user && s.user.usuario_id, 'confirmo'); },
    reportarDiscrepancia(motivo, comentario) { return api.responder(s.user && s.user.usuario_id, 'discrepancia', motivo, comentario); },

    // ---------- TI ----------
    casosTI() {
      const u = s.user; if (!u) return [];
      const R = s.reglas; const N = s.config.niveles;
      return s.data.hitos.filter(h => s.auth.puedeVerHito(u, h) && s.config.hitosTecnicos.includes(h.tipo_hito) && !R.completado(h))
        .map(h => {
          const c = s.idx.colab.get(h.colaborador_id);
          return { h, c: { colaborador_id: c.colaborador_id, area: c.area, fecha_ingreso: c.fecha_ingreso }, estado: R.estadoHito(h), limite: R.fechaLimite(h),
            fecha: R.fechaComprometida(h), resp: R.responsable(h), prioridad: R.prioridadHito(h), permiso: s.auth.puedeGestionarTecnico(u, h) };
        })
        .sort((a, b) => N.indexOf(b.prioridad) - N.indexOf(a.prioridad) || String(a.limite.fecha || '9999').localeCompare(String(b.limite.fecha || '9999')));
    },
    marcarListo(hitoId) {
      const h = hito(hitoId); if (!h) return { ok: false, motivo: 'El hito no existe' };
      const p = s.auth.puedeGestionarTecnico(s.user, h);
      if (!p.ok) return denegar('marcar_listo', 'hito', hitoId, p.motivo);
      const antes = h.estado;
      patch(hitoId, { estado: 'Cumplido', fecha_cumplimiento: s.hoy, ultima_actualizacion: s.hoy });
      evento({ accion: 'marcar_listo', entidad: 'hito', entidad_id: hitoId, campo: 'estado', valor_anterior: antes, valor_nuevo: 'Cumplido', detalle: `${h.tipo_hito} de ${h.colaborador_id}` });
      return { ok: true };
    },
    marcarPendiente(hitoId, fecha) {
      const h = hito(hitoId); if (!h) return { ok: false, motivo: 'El hito no existe' };
      const p = s.auth.puedeGestionarTecnico(s.user, h);
      if (!p.ok) return denegar('marcar_pendiente', 'hito', hitoId, p.motivo);
      if (!isISO(fecha)) return { ok: false, motivo: 'La fecha comprometida es obligatoria.' };
      if (fecha < s.hoy) return { ok: false, motivo: 'La fecha comprometida no puede ser anterior a hoy.' };
      const antes = h.fecha_comprometida || null;
      patch(hitoId, { fecha_comprometida: fecha, ultima_actualizacion: s.hoy, ...(h.estado === 'Cumplido' ? { estado: 'Pendiente', fecha_cumplimiento: null } : {}) });
      evento({ accion: 'marcar_pendiente', entidad: 'hito', entidad_id: hitoId, campo: 'fecha_comprometida', valor_anterior: antes, valor_nuevo: fecha, detalle: `${h.tipo_hito} de ${h.colaborador_id}` });
      return { ok: true };
    },
    // Compatibilidad con el motor anterior (tests de permisos).
    completar(hitoId) {
      const h = hito(hitoId); const u = s.user;
      if (!h) return { ok: false, motivo: 'Hito no existe' };
      const p = s.auth.puedeCompletar(u, h, s.hoy);
      if (!p.ok) return denegar('completar', 'hito', hitoId, p.motivo);
      const antes = h.estado;
      patch(hitoId, { estado: 'Cumplido', fecha_cumplimiento: s.hoy, ultima_actualizacion: s.hoy });
      evento({ accion: 'completar', entidad: 'hito', entidad_id: hitoId, campo: 'estado', valor_anterior: antes, valor_nuevo: 'Cumplido' });
      return { ok: true };
    },

    // ---------- Personas ----------
    reasignar(hitoId, nuevoId, motivo) {
      const h = hito(hitoId); const u = s.user;
      if (!h) return { ok: false, motivo: 'Hito no existe' };
      if (!motivo || motivo.trim().length < 5) return { ok: false, motivo: 'Indica un motivo (mínimo 5 caracteres).' };
      const p = s.auth.puedeReasignar(u, h, nuevoId);
      if (!p.ok) return denegar('reasignar', 'hito', hitoId, p.motivo);
      const antes = h.responsable_id || null;
      patch(hitoId, { responsable_id: nuevoId, ultima_actualizacion: s.hoy });
      evento({ accion: 'reasignar', entidad: 'hito', entidad_id: hitoId, campo: 'responsable_id', valor_anterior: antes, valor_nuevo: nuevoId, detalle: `Motivo: ${motivo.trim()}` });
      return { ok: true, aviso: `Se notificaría a ${nombreDe(nuevoId)} por correo (simulado).` };
    },
    gestionarAlerta(alertaId, estado) {
      if (!['contactado', 'escalada'].includes(estado)) return { ok: false, motivo: 'Acción no válida' };
      if (!s.auth.puedeGestionarAlertas(s.user)) return denegar('gestionar_alerta', 'alerta', alertaId, 'Sin permiso para gestionar alertas');
      const a = s.alertas.find(x => x.id === alertaId);
      if (!a) return { ok: false, motivo: 'La alerta ya no está activa.' };
      const antes = a.estado;
      s.alertaEstados[alertaId] = { estado, por: s.user.usuario_id, actualizada_at: reloj() };
      evento({ accion: estado === 'contactado' ? 'marcar_contactado' : 'escalar', entidad: 'alerta', entidad_id: alertaId, campo: 'estado', valor_anterior: antes, valor_nuevo: estado, detalle: a.titulo });
      let aviso = null;
      if (estado === 'escalada') {
        aviso = `Se notificaría a ${a.responsable.etiqueta} por correo (simulado).`;
        evento({ accion: 'notificacion_simulada', entidad: 'alerta', entidad_id: alertaId, detalle: aviso });
      }
      rebuild(); save();
      return { ok: true, aviso };
    },
    discrepancias() {
      if (!s.auth.esPersonas(s.user)) return [];
      return Object.values(s.fichas).filter(f => f.motivo).sort((a, b) => String(b.respondida_at).localeCompare(String(a.respondida_at)));
    },
    indicadores() {
      if (!s.auth.esPersonas(s.user)) return null;
      return s.reglas.indicadores(s.data.colaboradores.filter(c => s.auth.enAlcance(s.user, c.colaborador_id)), s.fichas, s.alertas);
    },
    setHoy(iso) {
      if (!s.auth.esPersonas(s.user) || !isISO(iso)) return { ok: false };
      const antes = s.hoy; s.hoy = iso; rebuild();
      evento({ accion: 'fecha_corte', entidad: 'sistema', entidad_id: 'hoy', campo: 'hoy', valor_anterior: antes, valor_nuevo: iso });
      return { ok: true };
    },
    reiniciar() {
      s.overrides = {}; s.fichas = {}; s.alertaEstados = {}; s.eventos = []; s.hoy = HOY_DEFAULT; s.user = null;
      if (persist) { safeDel(ls(), KEY); safeDel(ss(), SKEY); }
      rebuild();
    },
  };
  return api;
}
