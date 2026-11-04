// Demo sintética: estado solo en memoria. Nunca persistir reportes, motivos ni bitácoras.
import { indexData, validar, HOY_DEFAULT, isISO, BLOQUEANTES } from './rules.js';
import { crearAuth } from './permissions.js';
import { limpiarPersistenciaAnterior, validarCampos, TIPOS_REPORTE, ESTADOS_REPORTE } from './privacy.js';

export function crearStore(base, { now = () => new Date().toISOString() } = {}) {
  if (!validarCampos(base, { permitirVacios: true })) throw new Error('Los datos deben contener únicamente los campos del kit sintético.');
  const original = structuredClone(base);
  const s = {
    base: structuredClone(base), data: null, idx: null, auth: null, alertas: [],
    hoy: HOY_DEFAULT, overrides: {}, bitacora: [], reportes: [], user: null,
    almacenamientoLimpio: limpiarPersistenciaAnterior(),
  };
  function rebuild() {
    const usuarioId = s.user?.usuario_id;
    const hitos = s.base.hitos.map(h => (s.overrides[h.hito_id] ? { ...h, ...s.overrides[h.hito_id] } : h));
    s.data = { ...s.base, hitos }; s.idx = indexData(s.data); s.auth = crearAuth(s.data);
    s.alertas = validar(s.data, s.idx, s.hoy);
    s.user = usuarioId ? s.auth.users.get(usuarioId) || null : null;
  }
  // Los objetivos recibidos se registran solo si existen en el kit, nunca como texto arbitrario.
  function objetivoSeguro(id) {
    return s.idx.colab.has(id) || s.auth.users.has(id) || s.data.hitos.some(h => h.hito_id === id) || s.reportes.some(r => r.id === id) ? id : '—';
  }
  function log(accion, objetivo, detalle, resultado = 'ok') {
    s.bitacora.unshift({ ts: now(), usuario: s.user?.usuario_id || '—', rol: s.user?.rol || '—', accion, objetivo: objetivoSeguro(objetivo), detalle, resultado });
    if (s.bitacora.length > 2000) s.bitacora.length = 2000;
  }
  function denegar(accion, objetivo, motivo) { log(accion, objetivo, motivo, 'denegado'); return { ok: false, motivo }; }
  function hito(id) { return s.data.hitos.find(h => h.hito_id === id); }
  function patch(id, campos) { s.overrides[id] = { ...(s.overrides[id] || {}), ...campos }; rebuild(); }
  rebuild();

  const api = {
    get state() { return s; }, // Estado interno de la demo; no constituye una frontera de seguridad.
    rechazarEntrada(entrada) {
      const accion = entrada === 'ingreso' ? 'ingreso' : 'carga_archivos';
      return denegar(accion, '—', 'Entrada rechazada en el formulario; no se registra su contenido');
    },
    login(usuarioId, via, opciones = {}) {
      const u = s.auth.users.get(usuarioId);
      if (!u || !s.auth.puedeVerColaborador(u, [...s.auth.scope(u)][0])) return denegar('ingreso', '—', 'Cuenta sin acceso autorizado');
      if (opciones?.soloInterno && u.rol === 'Colaborador') return denegar('ingreso', usuarioId, 'Los colaboradores ingresan con su código');
      s.user = u; log('ingreso', usuarioId, 'Selección de cuenta sintética (simulación)'); return { ok: true };
    },
    logout() { if (s.user) log('salida', s.user.usuario_id, ''); s.user = null; },

    verColaborador(colId) {
      const u = s.user;
      if (!s.auth.puedeVerColaborador(u, colId)) { denegar('acceso_denegado', colId, 'Fuera de alcance'); return null; }
      const c = s.idx.colab.get(colId); if (!c) return null;
      return Object.fromEntries(Object.entries(c).filter(([campo]) => s.auth.puedeVerCampo(u, colId, campo)));
    },
    completar(hitoId) {
      const h = hito(hitoId); if (!h) return denegar('completar', hitoId, 'Hito no existe');
      const p = s.auth.puedeCompletar(s.user, h, s.hoy);
      if (!p.ok) return denegar('completar', hitoId, p.motivo);
      const antes = `${h.estado} / ${h.fecha_cumplimiento || 'sin fecha'}`;
      patch(hitoId, { estado: 'Cumplido', fecha_cumplimiento: s.hoy, ultima_actualizacion: s.hoy });
      log('completar', hitoId, `${h.tipo_hito} de ${h.colaborador_id}: ${antes} → Cumplido / ${s.hoy}`); return { ok: true };
    },
    reasignar(hitoId, nuevoId, motivo, { confirmado = false } = {}) {
      const h = hito(hitoId); if (!h) return denegar('reasignar', hitoId, 'Hito no existe');
      const p = s.auth.puedeReasignar(s.user, h, nuevoId);
      if (!p.ok) return denegar('reasignar', hitoId, p.motivo);
      if (typeof motivo !== 'string' || motivo.trim().length < 5 || motivo.length > 200) return denegar('reasignar', hitoId, 'Indica un motivo operativo de 5 a 200 caracteres, sin datos personales');
      if (confirmado !== true) return denegar('reasignar', hitoId, 'Falta confirmar la reasignación');
      const antes = h.responsable_id || 'sin responsable';
      patch(hitoId, { responsable_id: nuevoId, ultima_actualizacion: s.hoy });
      log('reasignar', hitoId, `${antes} → ${nuevoId || 'sin responsable'}. Motivo: ${motivo.trim()}`); return { ok: true };
    },
    reportar(tipo, texto = '') {
      const u = s.user;
      if (!s.auth.puedeReportar(u, u?.usuario_id)) return denegar('reporte_creado', '—', 'Solo el colaborador puede reportar sobre sí mismo');
      if (!TIPOS_REPORTE.includes(tipo) || texto !== '') return denegar('reporte_creado', '—', 'Elige una categoría; esta demo no recopila textos libres ni datos personales adicionales');
      const r = { id: `REP-${String(s.reportes.length + 1).padStart(3, '0')}`, colaborador_id: u.usuario_id, tipo, estado: 'Nuevo', fecha: s.hoy };
      s.reportes.unshift(r); log('reporte_creado', r.id, 'Solicitud de revisión; categoría visible solo para su autor y Personas en su alcance');
      return { ok: true, id: r.id };
    },
    reportesVisibles() {
      if (!s.auth.puedeVerReportes(s.user)) { denegar('acceso_reportes', '—', 'Sin permiso para ver reportes'); return []; }
      return s.reportes.filter(r => s.auth.puedeVerReportes(s.user, r.colaborador_id)).map(r => ({ ...r }));
    },
    misReportes() {
      return s.auth.puedeReportar(s.user, s.user?.usuario_id) ? s.reportes.filter(r => r.colaborador_id === s.user.usuario_id).map(r => ({ ...r })) : [];
    },
    cambiarEstadoReporte(id, estado) {
      const r = s.reportes.find(x => x.id === id);
      if (!r || !s.auth.puedeVerReportes(s.user, r.colaborador_id)) return denegar('reporte_estado', id, 'Sin permiso para gestionar el reporte');
      if (!ESTADOS_REPORTE.includes(estado)) return denegar('reporte_estado', id, 'Estado de reporte no permitido');
      const antes = r.estado; r.estado = estado; log('reporte_estado', id, `${antes} → ${estado}`); return { ok: true };
    },
    setHoy(iso) {
      if (!s.auth.puedeVerCalidad(s.user)) return denegar('fecha_corte', '—', 'Sin permiso');
      if (!isISO(iso)) return denegar('fecha_corte', '—', 'Fecha inválida');
      const antes = s.hoy; s.hoy = iso; rebuild(); log('fecha_corte', '—', `${antes} → ${iso}`); return { ok: true };
    },
    cargarArchivos(nuevo) {
      if (!s.auth.puedeCargarArchivos(s.user)) return denegar('carga_archivos', '—', 'Sin permiso');
      if (!validarCampos(nuevo)) return denegar('carga_archivos', '—', 'Carga rechazada: usa solo las columnas del kit sintético, sin información adicional');
      const candidato = { ...s.base, ...structuredClone(nuevo) };
      const errores = validar(candidato, indexData(candidato), s.hoy).filter(a => BLOQUEANTES.includes(a.regla));
      if (errores.length) {
        const r = denegar('carga_archivos', '—', `Carga rechazada: ${errores.length} errores bloqueantes. Los datos actuales no cambiaron.`);
        return { ...r, errores };
      }
      s.base = candidato; s.overrides = {}; rebuild();
      if (s.user && !s.auth.cuentaValida(s.user)) s.user = null;
      log('carga_archivos', '—', 'Carga del kit sintético validada; datos solo en memoria'); return { ok: true, sesionCerrada: !s.user };
    },
    registrarCorreo(colId, resultado) { log('alerta_correo', colId, `Alerta por correo: ${resultado}`, resultado === 'error' ? 'error' : 'ok'); return { ok: true }; },
    registrarError() { log('error', '—', 'Error inesperado; no se registra el mensaje ni su contenido', 'error'); },
    exportar(tipo) {
      if (!s.auth.puedeVerCalidad(s.user)) return denegar('exportar', '—', 'Sin permiso para exportar');
      if (tipo === 'bitacora' && !s.auth.puedeVerBitacora(s.user)) return denegar('exportar', '—', 'La bitácora completa requiere alcance global');
      if (!['hitos', 'bitacora'].includes(tipo)) return denegar('exportar', '—', 'Exportación no permitida');
      log('exportar', '—', tipo === 'hitos' ? 'Exportación de hitos autorizados' : 'Exportación de bitácora');
      const filas = tipo === 'hitos' ? s.data.hitos.filter(h => s.auth.puedeVerHito(s.user, h)) : s.bitacora;
      return { ok: true, filas: filas.map(r => ({ ...r })) };
    },
    reiniciar() {
      if (!s.auth.puedeCargarArchivos(s.user)) return denegar('reiniciar', '—', 'Sin permiso');
      s.base = structuredClone(original); s.overrides = {}; s.bitacora = []; s.reportes = []; s.hoy = HOY_DEFAULT;
      s.almacenamientoLimpio = limpiarPersistenciaAnterior(); rebuild(); log('reiniciar', '—', 'Datos originales restaurados; reportes y movimientos anteriores eliminados'); s.user = null;
      return { ok: true };
    },
  };
  // Una entrada inválida o un fallo inesperado nunca escapa a los handlers de la UI.
  for (const nombre of Object.keys(api)) {
    if (typeof api[nombre] !== 'function') continue;
    const ejecutar = api[nombre];
    api[nombre] = (...args) => {
      try { return ejecutar(...args); }
      catch {
        log('error', '—', 'No se pudo completar la acción; no se registra su contenido', 'error');
        if (nombre === 'verColaborador') return null;
        if (['reportesVisibles', 'misReportes'].includes(nombre)) return [];
        return { ok: false, motivo: 'No se pudo completar la acción. Revisa los datos e intenta nuevamente.' };
      }
    };
  }
  return api;
}
