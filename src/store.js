// Estado de la demo + acciones con verificación de permisos y bitácora.
// Manejo de errores: ninguna acción lanza excepciones hacia la UI; todas devuelven { ok, motivo }.
import { indexData, validar, HOY_DEFAULT, isISO, BLOQUEANTES } from './rules.js';
import { crearAuth } from './permissions.js';

const KEY = 'sprint-modo-seguro-v1';
export const ESTADOS_REPORTE = ['Nuevo', 'En gestión', 'Cerrado'];
const MAX_BITACORA = 2000;

function safeGet() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } }
function safeSet(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); return true; } catch { return false; } }
function safeDel() { try { localStorage.removeItem(KEY); } catch { /* sin almacenamiento */ } }

// El estado guardado puede venir corrupto o de otra versión: se valida campo a campo y lo inválido se descarta.
export function sanearGuardado(saved, base) {
  const out = { hoy: HOY_DEFAULT, overrides: {}, bitacora: [], reportes: [], descartado: false };
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return { ...out, descartado: saved != null };
  if (isISO(saved.hoy)) out.hoy = saved.hoy; else if (saved.hoy !== undefined) out.descartado = true;
  const ids = new Set(base.hitos.map(h => h.hito_id));
  const CAMPOS = ['estado', 'fecha_cumplimiento', 'ultima_actualizacion', 'responsable_id'];
  if (saved.overrides && typeof saved.overrides === 'object' && !Array.isArray(saved.overrides)) {
    for (const [id, o] of Object.entries(saved.overrides)) {
      if (!ids.has(id) || !o || typeof o !== 'object') { out.descartado = true; continue; }
      const limpio = {};
      for (const c of CAMPOS) if (c in o && (o[c] === null || typeof o[c] === 'string')) limpio[c] = o[c];
      out.overrides[id] = limpio;
    }
  }
  if (Array.isArray(saved.bitacora)) out.bitacora = saved.bitacora.filter(b => b && typeof b.accion === 'string' && typeof b.ts === 'string').slice(0, MAX_BITACORA);
  if (Array.isArray(saved.reportes)) out.reportes = saved.reportes.filter(r => r && typeof r.id === 'string' && typeof r.colaborador_id === 'string' && ESTADOS_REPORTE.includes(r.estado));
  return out;
}

export function crearStore(base, { persist = true, now = () => new Date().toISOString() } = {}) {
  const saved = sanearGuardado(persist ? safeGet() : null, base);
  const s = {
    base,
    data: null, idx: null, auth: null, alertas: [],
    hoy: saved.hoy, overrides: saved.overrides, bitacora: saved.bitacora, reportes: saved.reportes,
    user: null,
    almacenamiento: true,          // false si el navegador no deja guardar
    estadoDescartado: saved.descartado,
  };

  function rebuild() {
    const hitos = s.base.hitos.map(h => (s.overrides[h.hito_id] ? { ...h, ...s.overrides[h.hito_id] } : h));
    s.data = { ...s.base, hitos };
    s.idx = indexData(s.data);
    s.auth = crearAuth(s.data);
    s.alertas = validar(s.data, s.idx, s.hoy);
    if (s.user) s.user = s.auth.users.get(s.user.usuario_id) || null; // permisos siempre desde el archivo vigente
  }
  function save() {
    if (!persist) return;
    s.almacenamiento = safeSet({ hoy: s.hoy, overrides: s.overrides, bitacora: s.bitacora, reportes: s.reportes });
  }
  function log(accion, objetivo, detalle, resultado = 'ok') {
    s.bitacora.unshift({ ts: now(), usuario: s.user ? s.user.usuario_id : '—', rol: s.user ? s.user.rol : '—', accion, objetivo: String(objetivo ?? '—'), detalle: String(detalle ?? ''), resultado });
    if (s.bitacora.length > MAX_BITACORA) s.bitacora.length = MAX_BITACORA;
    save();
  }
  function hito(id) { return s.data.hitos.find(h => h.hito_id === id); }
  function patch(id, campos) { s.overrides[id] = { ...(s.overrides[id] || {}), ...campos }; rebuild(); save(); }
  const sinSesion = { ok: false, motivo: 'Tu sesión terminó. Vuelve a ingresar.' };

  rebuild();
  if (s.estadoDescartado) log('estado_descartado', '—', 'Se ignoró información guardada inválida en este navegador', 'error');

  const api = {
    get state() { return s; },

    // opciones.soloInterno: el formulario de equipo interno no permite entrar como colaborador sin código.
    login(usuarioId, via, opciones = {}) {
      const u = s.auth.users.get(usuarioId);
      if (!u) { log('ingreso', usuarioId, 'Cuenta no encontrada', 'denegado'); return { ok: false, motivo: 'No encontramos esa cuenta.' }; }
      if (!s.auth.cuentaValida(u)) { log('ingreso', usuarioId, `Rol inválido: ${u.rol}`, 'denegado'); return { ok: false, motivo: 'Esta cuenta tiene un rol no válido y está bloqueada. Contacta al equipo de Personas.' }; }
      if (opciones.soloInterno && u.rol === 'Colaborador') { log('ingreso', usuarioId, 'Colaborador por acceso interno', 'denegado'); return { ok: false, motivo: 'Los colaboradores ingresan con su código.' }; }
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
      if (!u) return sinSesion;
      if (!h) return { ok: false, motivo: 'Ese hito ya no existe. Recarga la vista.' };
      const p = s.auth.puedeCompletar(u, h, s.hoy);
      if (!p.ok) { log('completar', hitoId, p.motivo, 'denegado'); return p; }
      const antes = `${h.estado} / ${h.fecha_cumplimiento || 'sin fecha'}`;
      patch(hitoId, { estado: 'Cumplido', fecha_cumplimiento: s.hoy, ultima_actualizacion: s.hoy });
      log('completar', hitoId, `${h.tipo_hito} de ${h.colaborador_id}: ${antes} → Cumplido / ${s.hoy}`);
      return { ok: true };
    },

    reasignar(hitoId, nuevoId, motivo) {
      const h = hito(hitoId); const u = s.user;
      if (!u) return sinSesion;
      if (!h) return { ok: false, motivo: 'Ese hito ya no existe. Recarga la vista.' };
      if (!motivo || String(motivo).trim().length < 5) return { ok: false, motivo: 'Indica un motivo (mínimo 5 caracteres).' };
      const p = s.auth.puedeReasignar(u, h, nuevoId);
      if (!p.ok) { log('reasignar', hitoId, p.motivo, 'denegado'); return p; }
      const antes = h.responsable_id || 'sin responsable';
      patch(hitoId, { responsable_id: nuevoId, ultima_actualizacion: s.hoy });
      log('reasignar', hitoId, `${antes} → ${nuevoId}. Motivo: ${String(motivo).trim().slice(0, 200)}`);
      return { ok: true };
    },

    reportar(tipo, texto) {
      const u = s.user;
      if (!u) return sinSesion;
      if (!s.auth.puedeReportar(u, u.usuario_id)) return { ok: false, motivo: 'Solo el colaborador puede reportar sobre sí mismo.' };
      const n = s.reportes.reduce((m, r) => Math.max(m, Number(String(r.id).slice(4)) || 0), 0) + 1;
      const r = { id: `REP-${String(n).padStart(3, '0')}`, colaborador_id: u.usuario_id, tipo: String(tipo || 'Otro').slice(0, 80), texto: String(texto || '').slice(0, 500), estado: 'Nuevo', fecha: s.hoy };
      s.reportes.unshift(r); log('reporte_creado', r.id, `${r.tipo} (contenido visible solo para Personas)`);
      return { ok: true, id: r.id };
    },
    reportesVisibles() { return s.user && s.auth.puedeVerReportes(s.user) ? s.reportes : []; },
    misReportes() { return s.user ? s.reportes.filter(r => r.colaborador_id === s.user.usuario_id) : []; },
    cambiarEstadoReporte(id, estado) {
      if (!s.user || !s.auth.puedeVerReportes(s.user)) return { ok: false, motivo: 'Sin permiso.' };
      if (!ESTADOS_REPORTE.includes(estado)) return { ok: false, motivo: 'Estado no válido.' };
      const r = s.reportes.find(x => x.id === id); if (!r) return { ok: false, motivo: 'El reporte no existe.' };
      const antes = r.estado; r.estado = estado; log('reporte_estado', id, `${antes} → ${estado}`);
      return { ok: true };
    },

    setHoy(iso) {
      if (!s.user || !s.auth.puedeVerCalidad(s.user)) return { ok: false, motivo: 'Sin permiso.' };
      if (!isISO(iso)) return { ok: false, motivo: 'La fecha debe tener formato AAAA-MM-DD.' };
      const antes = s.hoy; s.hoy = iso; rebuild(); log('fecha_corte', '—', `${antes} → ${iso}`); return { ok: true };
    },

    // Carga atómica: se valida el conjunto completo y, si hay errores bloqueantes, no se reemplaza nada.
    cargarArchivos(nuevo, resumen) {
      if (!s.user || !s.auth.puedeCargarArchivos(s.user)) return { ok: false, motivo: 'Sin permiso.' };
      const candidato = { ...s.base, ...nuevo };
      let alertas;
      try { alertas = validar(candidato, indexData(candidato), s.hoy); } catch (e) {
        log('carga_archivos', '—', `Archivo ilegible: ${e.message}`, 'denegado');
        return { ok: false, motivo: 'No pudimos leer los archivos. Revisa que sean CSV válidos.', errores: [] };
      }
      const bloq = alertas.filter(a => BLOQUEANTES.includes(a.regla));
      if (bloq.length) {
        log('carga_archivos', '—', `${resumen}: rechazada por ${bloq.length} errores bloqueantes`, 'denegado');
        return { ok: false, motivo: `Carga rechazada: ${bloq.length} errores bloqueantes. Los datos actuales no cambiaron.`, errores: bloq };
      }
      const yo = s.user.usuario_id;
      s.base = candidato; s.overrides = {}; rebuild();
      log('carga_archivos', '—', resumen);
      if (!s.user) { s.bitacora[0].detalle += ` · la cuenta ${yo} ya no existe en los datos nuevos: sesión cerrada`; save(); }
      return { ok: true, sesionCerrada: !s.user };
    },

    registrarError(contexto, mensaje) { log('error', contexto, String(mensaje).slice(0, 300), 'error'); },
    reiniciar() { s.overrides = {}; s.bitacora = []; s.reportes = []; s.hoy = HOY_DEFAULT; s.user = null; s.estadoDescartado = false; safeDel(); rebuild(); },
  };
  return api;
}
