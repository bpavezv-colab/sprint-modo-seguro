// Estado de la demo + acciones con verificación de permisos y bitácora.
import { indexData, validar, HOY_DEFAULT } from './rules.js';
import { crearAuth } from './permissions.js';

const KEY = 'sprint-modo-seguro-v1';

function safeGet() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } }
function safeSet(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* sin almacenamiento: sigue en memoria */ } }
function safeDel() { try { localStorage.removeItem(KEY); } catch { /* noop */ } }

export function crearStore(base, { persist = true, now = () => new Date().toISOString() } = {}) {
  const saved = persist ? safeGet() : null;
  const s = {
    base,
    data: null, idx: null, auth: null, alertas: [],
    hoy: (saved && saved.hoy) || HOY_DEFAULT,
    overrides: (saved && saved.overrides) || {}, // hito_id -> campos modificados
    bitacora: (saved && saved.bitacora) || [],
    reportes: (saved && saved.reportes) || [],
    user: null,
  };

  function rebuild() {
    const hitos = s.base.hitos.map(h => (s.overrides[h.hito_id] ? { ...h, ...s.overrides[h.hito_id] } : h));
    s.data = { ...s.base, hitos };
    s.idx = indexData(s.data);
    s.auth = crearAuth(s.data);
    s.alertas = validar(s.data, s.idx, s.hoy);
  }
  function save() { if (persist) safeSet({ hoy: s.hoy, overrides: s.overrides, bitacora: s.bitacora, reportes: s.reportes }); }
  function log(accion, objetivo, detalle, resultado = 'ok') {
    s.bitacora.unshift({ ts: now(), usuario: s.user ? s.user.usuario_id : '—', rol: s.user ? s.user.rol : '—', accion, objetivo, detalle, resultado });
    save();
  }
  function hito(id) { return s.data.hitos.find(h => h.hito_id === id); }
  function patch(id, campos) { s.overrides[id] = { ...(s.overrides[id] || {}), ...campos }; rebuild(); save(); }

  rebuild();

  const api = {
    get state() { return s; },
    login(usuarioId, via) {
      const u = s.auth.users.get(usuarioId);
      if (!u) return { ok: false, motivo: 'Cuenta no encontrada' };
      s.user = u; log('ingreso', usuarioId, via || 'selector demo');
      return { ok: true };
    },
    logout() { if (s.user) log('salida', s.user.usuario_id, ''); s.user = null; },

    // Consulta con control de alcance: si está fuera, se registra el intento.
    verColaborador(colId) {
      const u = s.user;
      if (!u || !s.auth.puedeVerColaborador(u, colId)) { log('acceso_denegado', colId, 'Fuera de alcance', 'denegado'); return null; }
      return s.idx.colab.get(colId) || null;
    },

    completar(hitoId) {
      const h = hito(hitoId); const u = s.user;
      if (!h) return { ok: false, motivo: 'Hito no existe' };
      const p = s.auth.puedeCompletar(u, h, s.hoy);
      if (!p.ok) { log('completar', hitoId, p.motivo, 'denegado'); return p; }
      const antes = `${h.estado} / ${h.fecha_cumplimiento || 'sin fecha'}`;
      patch(hitoId, { estado: 'Cumplido', fecha_cumplimiento: s.hoy, ultima_actualizacion: s.hoy });
      log('completar', hitoId, `${h.tipo_hito} de ${h.colaborador_id}: ${antes} → Cumplido / ${s.hoy}`);
      return { ok: true };
    },

    reasignar(hitoId, nuevoId, motivo) {
      const h = hito(hitoId); const u = s.user;
      if (!h) return { ok: false, motivo: 'Hito no existe' };
      if (!motivo || motivo.trim().length < 5) return { ok: false, motivo: 'Indica un motivo (mín. 5 caracteres)' };
      const p = s.auth.puedeReasignar(u, h, nuevoId);
      if (!p.ok) { log('reasignar', hitoId, p.motivo, 'denegado'); return p; }
      const antes = h.responsable_id || 'sin responsable';
      patch(hitoId, { responsable_id: nuevoId, ultima_actualizacion: s.hoy });
      log('reasignar', hitoId, `${antes} → ${nuevoId}. Motivo: ${motivo.trim()}`);
      return { ok: true };
    },

    reportar(tipo, texto) {
      const u = s.user;
      if (!u || !s.auth.puedeReportar(u, u.usuario_id)) return { ok: false, motivo: 'Solo el colaborador puede reportar sobre sí mismo' };
      const r = { id: `REP-${String(s.reportes.length + 1).padStart(3, '0')}`, colaborador_id: u.usuario_id, tipo, texto: (texto || '').slice(0, 500), estado: 'Nuevo', fecha: s.hoy };
      s.reportes.unshift(r); log('reporte_creado', r.id, `${tipo} (contenido visible solo para Personas)`);
      return { ok: true, id: r.id };
    },
    reportesVisibles() { return s.user && s.auth.puedeVerReportes(s.user) ? s.reportes : []; },
    misReportes() { return s.user ? s.reportes.filter(r => r.colaborador_id === s.user.usuario_id) : []; },
    cambiarEstadoReporte(id, estado) {
      if (!s.user || !s.auth.puedeVerReportes(s.user)) return { ok: false, motivo: 'Sin permiso' };
      const r = s.reportes.find(x => x.id === id); if (!r) return { ok: false };
      const antes = r.estado; r.estado = estado; log('reporte_estado', id, `${antes} → ${estado}`);
      return { ok: true };
    },

    setHoy(iso) {
      if (!s.user || !s.auth.puedeVerCalidad(s.user)) return { ok: false };
      const antes = s.hoy; s.hoy = iso; rebuild(); log('fecha_corte', '—', `${antes} → ${iso}`); return { ok: true };
    },
    cargarArchivos(nuevo, resumen) {
      if (!s.user || !s.auth.puedeCargarArchivos(s.user)) return { ok: false, motivo: 'Sin permiso' };
      s.base = { ...s.base, ...nuevo }; s.overrides = {}; rebuild(); log('carga_archivos', '—', resumen);
      return { ok: true };
    },
    reiniciar() { s.overrides = {}; s.bitacora = []; s.reportes = []; s.hoy = HOY_DEFAULT; s.user = null; safeDel(); rebuild(); },
  };
  return api;
}
