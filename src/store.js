// Demo sintética: estado solo en memoria. Nunca persistir reportes, motivos ni bitácoras.
import { indexData, validar, HOY_DEFAULT, isISO, BLOQUEANTES } from './rules.js';
import { crearAuth } from './permissions.js';
import { limpiarPersistenciaAnterior, validarCampos, TIPOS_REPORTE, ESTADOS_REPORTE } from './privacy.js';
import { ReglasOnboarding, CONFIG, MOTIVOS, MOTIVO_A_REPORTE, ESTADOS_FICHA, POST_ENVIO, AVISOS_JEFATURA } from './reglas_onboarding.js';
import { estadoInduccion, alertasInduccion, indicadorInduccion, ESTADOS_INDUCCION, MOTIVOS_REPROGRAMAR, esHora, aMin } from './induccion.js';

const limpiar = (v, max = 200) => { const t = String(v ?? '').trim().slice(0, max); return t === '' ? null : t; };
const CAMPOS_FICHA_EDITABLES = ['tarea_1', 'tarea_2', 'tarea_3', 'companero_id', 'reunion_at'];

export function crearStore(base, { now = () => new Date().toISOString(), config = CONFIG } = {}) {
  if (!validarCampos(base, { permitirVacios: true })) throw new Error('Los datos deben contener únicamente los campos del kit sintético.');
  const original = structuredClone(base);
  const s = {
    base: structuredClone(base), data: null, idx: null, auth: null, alertas: [],
    hoy: HOY_DEFAULT, overrides: {}, bitacora: [], reportes: [], user: null,
    config, reglas: null, fichas: {}, alertasFicha: [], alertaEstados: {}, nuevosIngresos: [], avisosVistos: {}, inducciones: {}, // Ficha de Ingreso (solo en memoria)
    almacenamientoLimpio: limpiarPersistenciaAnterior(),
  };
  function rebuild() {
    const usuarioId = s.user?.usuario_id;
    const hitos = s.base.hitos.map(h => (s.overrides[h.hito_id] ? { ...h, ...s.overrides[h.hito_id] } : h));
    s.data = { ...s.base, hitos }; s.idx = indexData(s.data); s.auth = crearAuth(s.data);
    s.alertas = validar(s.data, s.idx, s.hoy);
    s.user = usuarioId ? s.auth.users.get(usuarioId) || null : null;
    const nombre = id => s.auth.users.get(id)?.nombre_ficticio || id;
    s.reglas = new ReglasOnboarding({ idx: s.idx, hoy: s.hoy, config: s.config, nombreDe: nombre });
    s.alertasFicha = [...s.reglas.alertas(s.data.colaboradores, s.data.hitos, s.fichas, s.nuevosIngresos),
      ...alertasInduccion({ colabs: s.data.colaboradores, inducciones: s.inducciones, hoy: s.hoy, nombreDe: nombre })]
      .map(a => ({ ...a, estado: s.alertaEstados[a.id]?.estado || 'abierta', gestion: s.alertaEstados[a.id] || null }));
  }
  // Fecha simulada de la demo + hora real: así "antes del día 1" se evalúa contra la fecha de corte.
  const reloj = () => `${s.hoy}T${new Date().toTimeString().slice(0, 8)}`;
  const nombreDe = id => s.auth.users.get(id)?.nombre_ficticio || id;
  // Los objetivos recibidos se registran solo si existen en el kit, nunca como texto arbitrario.
  function objetivoSeguro(id) {
    return s.idx.colab.has(id) || s.auth.users.has(id) || s.data.hitos.some(h => h.hito_id === id) || s.reportes.some(r => r.id === id) || s.alertasFicha.some(a => a.id === id) ? id : '—';
  }
  // Evento trazable: actor, rol, acción, entidad, campo, valor anterior y nuevo, fecha.
  function log(accion, objetivo, detalle, resultado = 'ok', cambio = {}) {
    s.bitacora.unshift({ ts: now(), usuario: s.user?.usuario_id || '—', rol: s.user?.rol || '—', accion, objetivo: objetivoSeguro(objetivo), detalle, resultado,
      entidad: cambio.entidad || null, campo: cambio.campo || null, valor_anterior: cambio.valor_anterior ?? null, valor_nuevo: cambio.valor_nuevo ?? null });
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
      const antes = new Set(s.base.colaboradores.map(c => c.colaborador_id));
      const nuevos = candidato.colaboradores.filter(c => !antes.has(c.colaborador_id)).map(c => c.colaborador_id);
      s.nuevosIngresos.push(...nuevos.map(id => ({ colaborador_id: id, registrado_at: reloj(), por: s.user.usuario_id })));
      s.base = candidato; s.overrides = {}; rebuild();
      if (s.user && !s.auth.cuentaValida(s.user)) s.user = null;
      log('carga_archivos', '—', `Carga del kit sintético validada; datos solo en memoria${nuevos.length ? `; ${nuevos.length} ${nuevos.length === 1 ? 'ingreso nuevo' : 'ingresos nuevos'}` : ''}`);
      for (const id of nuevos) log('nuevo_ingreso', id, 'Se notificaría a la jefatura asignada (simulado). No se envió nada.', 'ok', { entidad: 'colaborador' });
      // Turno cambiado después de enviar la ficha: la persona debe reconfirmar (el dato viene del archivo, no se edita aquí).
      const cambios = [];
      for (const f of Object.values(s.fichas)) {
        const c = s.idx.colab.get(f.colaborador_id);
        if (!c || !['enviada', 'confirmada'].includes(f.estado) || (f.turno_al_enviar ?? null) === (c.tipo_turno ?? null)) continue;
        const antesEst = f.estado;
        Object.assign(f, { estado: 'requiere_reconfirmacion', turno_anterior: f.turno_al_enviar ?? null });
        cambios.push(f.colaborador_id);
        log('cambio_turno', f.colaborador_id, 'El turno cambió después de enviar la ficha', 'ok', { entidad: 'ficha', campo: 'estado', valor_anterior: antesEst, valor_nuevo: 'requiere_reconfirmacion' });
        log('notificacion_simulada', f.colaborador_id, 'Se notificaría a la persona que su turno cambió y debe reconfirmar su ficha. No se envió nada.');
      }
      if (cambios.length) rebuild();
      return { ok: true, sesionCerrada: !s.user, nuevos: nuevos.length, reconfirmar: cambios.length };
    },

    // ================= Ficha de Ingreso =================
    // Control de acceso por pantalla (equivale al filtro del controlador): 403 si está fuera de alcance.
    entrar(ruta, param) {
      const r = s.auth.puedeEntrar(s.user, ruta, param);
      if (!r.ok && r.status === 403) log('acceso_denegado', param || '—', r.motivo, 'denegado', { entidad: ruta === '/ficha' ? 'ficha' : 'ruta' });
      return r;
    },
    // Vista minimizada según quién la pide. undefined = no permitido (no se muestra); null = Sin dato.
    vistaFicha(colId) {
      const u = s.user;
      if (!s.auth.puedeVerFicha(u, colId)) return null;
      const c = s.idx.colab.get(colId); const f = s.fichas[colId] || null; const R = s.reglas;
      const est = R.estadoFicha(f);
      const campo = k => (s.auth.puedeVerCampo(u, colId, k) ? c[k] : undefined);
      let ficha = f ? { ...f } : null;
      if (ficha && u.rol === 'Colaborador' && !ficha.enviada_at) ficha = null; // el borrador no se muestra a la persona
      if (ficha && !s.auth.puedeVerMotivo(u, colId)) { delete ficha.motivo; delete ficha.respuesta; }
      return {
        c: { colaborador_id: colId, nombre: s.auth.puedeVerCampo(u, colId, 'nombre') ? nombreDe(colId) : undefined,
          area: campo('area'), fecha_ingreso: campo('fecha_ingreso'), tipo_turno: campo('tipo_turno'), jefatura_id: campo('jefatura_id'), canal_contacto: campo('canal_contacto') },
        ficha, est,
        estadoVisible: u.rol === 'Jefatura' && est === 'con_discrepancia' ? 'En revisión por Personas' : ESTADOS_FICHA[est],
        hitos: (s.idx.hitosPorColab.get(colId) || []).filter(h => s.auth.puedeVerHito(u, h)).map(h => ({
          h, estado: R.estadoHito(h), fecha: R.fechaComprometida(h), limite: R.fechaLimite(h), resp: R.responsable(h), prioridad: R.prioridadHito(h) })),
        semaforo: R.semaforo(c, f),
        jefatura: c.jefatura_id ? nombreDe(c.jefatura_id) : null,
        companero: ficha && ficha.companero_id ? nombreDe(ficha.companero_id) : null,
      };
    },
    ingresos() {
      const u = s.user; if (!u) return [];
      return [...s.auth.scope(u)].map(id => api.vistaFicha(id)).filter(Boolean);
    },
    companerosPara(colId) {
      return s.auth.companerosValidos(s.user, colId).map(id => ({ id, nombre: nombreDe(id) }));
    },
    guardarFicha(colId, campos = {}) {
      const u = s.user;
      const p = s.auth.puedeEditarFicha(u, colId);
      if (!p.ok) return denegar('editar_ficha', colId, p.motivo);
      const f = s.fichas[colId] || { colaborador_id: colId, tarea_1: null, tarea_2: null, tarea_3: null, companero_id: null, reunion_at: null,
        estado: null, respuesta: null, motivo: null, enviada_at: null, respondida_at: null, creado_por_equipo: true };
      if (POST_ENVIO.includes(f.estado)) return { ok: false, motivo: 'La ficha ya fue enviada. Si hay que corregirla, avisa a Personas.' };
      const limpio = {};
      for (const k of CAMPOS_FICHA_EDITABLES) if (k in campos) limpio[k] = limpiar(campos[k], k.startsWith('tarea') ? 160 : 20);
      if (limpio.companero_id && !s.auth.companerosValidos(u, colId).includes(limpio.companero_id)) return denegar('editar_ficha', colId, 'El compañero o compañera debe ser parte de tu equipo.');
      if (limpio.reunion_at && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(limpio.reunion_at)) return { ok: false, motivo: 'La fecha y hora de la reunión no es válida.' };
      const nuevo = { ...f };
      for (const [k, v] of Object.entries(limpio)) {
        if ((f[k] ?? null) === v) continue;
        log('editar_ficha', colId, `Campo ${k}`, 'ok', { entidad: 'ficha', campo: k, valor_anterior: f[k], valor_nuevo: v });
        nuevo[k] = v;
      }
      const est = s.reglas.estadoFicha({ ...nuevo, estado: null });
      if (est !== f.estado) log('cambio_estado', colId, `Ficha: ${f.estado || 'nueva'} → ${est}`, 'ok', { entidad: 'ficha', campo: 'estado', valor_anterior: f.estado, valor_nuevo: est });
      nuevo.estado = est; s.fichas[colId] = nuevo; rebuild();
      return { ok: true, estado: est };
    },
    enviarFicha(colId, campos = {}) {
      const g = api.guardarFicha(colId, campos); if (!g.ok) return g;
      const f = s.fichas[colId]; const faltan = s.reglas.faltantes(f);
      if (faltan.length) { log('enviar_ficha', colId, faltan.join('; '), 'rechazado', { entidad: 'ficha' }); return { ok: false, faltan, motivo: `No se puede enviar: ${faltan.join('. ')}.` }; }
      const c = s.idx.colab.get(colId); const antes = f.estado;
      Object.assign(f, { estado: 'enviada', enviada_at: reloj(), turno_al_enviar: c.tipo_turno ?? null });
      log('enviar_ficha', colId, 'Ficha enviada a la persona', 'ok', { entidad: 'ficha', campo: 'estado', valor_anterior: antes, valor_nuevo: 'enviada' });
      log('notificacion_simulada', colId, c.canal_contacto ? 'Se notificaría a la persona por su canal registrado. No se envió nada.' : 'Sin dato: canal de contacto. Personas debe avisar a la persona.');
      rebuild();
      return { ok: true, aviso: 'Se notificaría a la persona por su canal registrado (simulado: no se envía nada).' };
    },
    responderFicha(colId, respuesta, motivo, via = 'Ficha web') {
      const u = s.user;
      const p = s.auth.puedeResponderFicha(u, colId);
      if (!p.ok) return denegar('responder_ficha', colId, p.motivo);
      const f = s.fichas[colId];
      if (!f || !['enviada', 'requiere_reconfirmacion'].includes(f.estado)) return { ok: false, motivo: 'Tu ficha todavía no está enviada por tu jefatura.' };
      if (respuesta === 'discrepancia' && !MOTIVOS[motivo]) return { ok: false, motivo: 'Elige qué no coincide para poder enviar el aviso.' };
      const antes = f.estado;
      if (respuesta === 'discrepancia') { const r = api.reportar(MOTIVO_A_REPORTE[motivo]); if (!r.ok) return r; f.reporte_id = r.id; }
      if (respuesta === 'confirmo') f.turno_al_enviar = s.idx.colab.get(colId)?.tipo_turno ?? null; // confirma el turno vigente
      Object.assign(f, { estado: respuesta === 'confirmo' ? 'confirmada' : 'con_discrepancia', respuesta, motivo: respuesta === 'discrepancia' ? motivo : null, respondida_at: reloj(), respondida_via: via });
      log(respuesta === 'confirmo' ? 'confirmar_ficha' : 'reportar_discrepancia', colId, respuesta === 'confirmo' ? `Vía: ${via}` : 'Motivo visible solo para la persona y Personas', 'ok',
        { entidad: 'ficha', campo: 'estado', valor_anterior: antes, valor_nuevo: f.estado });
      if (respuesta === 'discrepancia') log('notificacion_simulada', colId, 'Se notificaría a Personas por correo. No se envió nada.');
      rebuild();
      return { ok: true, estado: f.estado };
    },
    confirmarFicha() { return api.responderFicha(s.user?.usuario_id, 'confirmo'); },
    reportarDiscrepancia(motivo, texto = '') {
      if (String(texto ?? '').trim() !== '') return denegar('responder_ficha', s.user?.usuario_id, 'Esta demo no recopila texto libre: elige solo el motivo');
      return api.responderFicha(s.user?.usuario_id, 'discrepancia', motivo);
    },
    // TI: casos técnicos con datos mínimos (ID, área, fecha de ingreso), ordenados por prioridad y plazo.
    casosTI() {
      const u = s.user; const R = s.reglas; const N = s.config.niveles;
      return s.data.hitos.filter(h => s.auth.puedeVerHito(u, h) && s.config.hitosTecnicos.includes(h.tipo_hito) && !R.completado(h))
        .map(h => { const c = s.idx.colab.get(h.colaborador_id);
          return { h, c: { colaborador_id: c.colaborador_id, area: c.area, fecha_ingreso: c.fecha_ingreso }, estado: R.estadoHito(h), limite: R.fechaLimite(h),
            fecha: R.fechaComprometida(h), resp: R.responsable(h), prioridad: R.prioridadHito(h), permiso: s.auth.puedeGestionarTecnico(u, h) }; })
        .sort((a, b) => N.indexOf(b.prioridad) - N.indexOf(a.prioridad) || String(a.limite.fecha || '9999').localeCompare(String(b.limite.fecha || '9999')));
    },
    marcarListo(hitoId) {
      const h = hito(hitoId); if (!h) return denegar('marcar_listo', hitoId, 'Hito no existe');
      const p = s.auth.puedeGestionarTecnico(s.user, h); if (!p.ok) return denegar('marcar_listo', hitoId, p.motivo);
      const antes = h.estado;
      patch(hitoId, { estado: 'Cumplido', fecha_cumplimiento: s.hoy, ultima_actualizacion: s.hoy });
      log('marcar_listo', hitoId, `${h.tipo_hito} de ${h.colaborador_id}`, 'ok', { entidad: 'hito', campo: 'estado', valor_anterior: antes, valor_nuevo: 'Cumplido' });
      return { ok: true };
    },
    marcarPendiente(hitoId, fecha) {
      const h = hito(hitoId); if (!h) return denegar('marcar_pendiente', hitoId, 'Hito no existe');
      const p = s.auth.puedeGestionarTecnico(s.user, h); if (!p.ok) return denegar('marcar_pendiente', hitoId, p.motivo);
      if (!isISO(fecha)) return { ok: false, motivo: 'La fecha comprometida es obligatoria.' };
      if (fecha < s.hoy) return { ok: false, motivo: 'La fecha comprometida no puede ser anterior a la fecha de corte.' };
      const antes = h.fecha_comprometida || null;
      patch(hitoId, { fecha_comprometida: fecha, ultima_actualizacion: s.hoy, ...(h.estado === 'Cumplido' ? { estado: 'Pendiente', fecha_cumplimiento: null } : {}) });
      log('marcar_pendiente', hitoId, `${h.tipo_hito} de ${h.colaborador_id}`, 'ok', { entidad: 'hito', campo: 'fecha_comprometida', valor_anterior: antes, valor_nuevo: fecha });
      return { ok: true };
    },
    // Jefatura: avisos de su equipo (nuevos ingresos, próximos ingresos, personas sin tareas, fichas sin enviar).
    avisos() {
      const u = s.user;
      if (!u || u.rol !== 'Jefatura' || !s.auth.cuentaValida(u)) return [];
      const peso = { Urgente: 4, Alta: 3, Media: 2, Baja: 1 };
      return s.alertasFicha
        .filter(a => AVISOS_JEFATURA.includes(a.tipo) && a.responsable.id === u.usuario_id && s.auth.enAlcance(u, a.colaborador_id))
        .map(a => ({ ...a, visto: !!s.avisosVistos[`${u.usuario_id}|${a.id}`] }))
        .sort((a, b) => a.visto - b.visto || peso[b.prioridad] - peso[a.prioridad] || String(a.plazo).localeCompare(String(b.plazo)));
    },
    marcarAvisoVisto(alertaId) {
      const u = s.user;
      const a = api.avisos().find(x => x.id === alertaId);
      if (!a) return denegar('aviso_visto', alertaId, 'El aviso no existe o no es de tu equipo');
      s.avisosVistos[`${u.usuario_id}|${alertaId}`] = reloj();
      log('aviso_visto', alertaId, a.titulo, 'ok', { entidad: 'aviso', campo: 'visto', valor_anterior: false, valor_nuevo: true });
      return { ok: true };
    },
    // ================= Asistencia a la inducción =================
    // Jefatura ve solo el estado; la hora de entrada/salida y el motivo de reprogramación, solo la persona y Personas.
    vistaInduccion(colId) {
      const u = s.user; if (!u || !s.auth.cuentaValida(u) || !s.idx.colab.has(colId)) return null;
      const propio = u.rol === 'Colaborador' && u.usuario_id === colId && s.auth.enAlcance(u, colId);
      const personas = s.auth.esPersonas(u) && s.auth.enAlcance(u, colId);
      const jefatura = u.rol === 'Jefatura' && s.auth.enAlcance(u, colId);
      if (!propio && !personas && !jefatura) return null;
      const r = s.inducciones[colId] || null; const e = estadoInduccion(r, s.hoy); const det = propio || personas;
      return { colaborador_id: colId, estado: e.estado, texto: ESTADOS_INDUCCION[e.estado], fecha: r?.fecha ?? null, inicio: r?.inicio ?? null, fin: r?.fin ?? null,
        confirmada: !!r?.confirmada, entrada: det ? r?.entrada ?? null : undefined, salida: det ? r?.salida ?? null : undefined,
        motivo: det ? r?.reprogramacion ?? null : undefined, atraso: det ? e.atraso : undefined, salidaAntes: det ? e.salidaAntes : undefined,
        minutos: det ? e.minutos : undefined, duracion: det ? e.duracion : undefined, previas: det ? r?.sesiones_previas || 0 : undefined };
    },
    induccionesEquipo() {
      const u = s.user; if (!u || !(s.auth.esPersonas(u) || u.rol === 'Jefatura')) return [];
      return [...s.auth.scope(u)].map(id => api.vistaInduccion(id)).filter(Boolean);
    },
    citarInduccion(colId, fecha, inicio, fin) {
      const u = s.user;
      if (!s.auth.esPersonas(u) || !s.auth.enAlcance(u, colId)) return denegar('citar_induccion', colId, 'Solo Personas cita a la inducción, dentro de su alcance');
      if (!isISO(fecha)) return { ok: false, motivo: 'La fecha de la sesión no es válida.' };
      if (fecha < s.hoy) return { ok: false, motivo: 'La sesión no puede ser anterior a la fecha de corte.' };
      if (!esHora(inicio) || !esHora(fin) || aMin(fin) <= aMin(inicio)) return { ok: false, motivo: 'Indica hora de inicio y de término válidas; el término debe ser después del inicio.' };
      const antes = s.inducciones[colId] || null;
      s.inducciones[colId] = { colaborador_id: colId, fecha, inicio, fin, confirmada: false, reprogramacion: null, entrada: null, salida: null, no_asistio: false,
        citada_por: u.usuario_id, citada_at: reloj(), sesiones_previas: antes ? (antes.sesiones_previas || 0) + 1 : 0 };
      log(antes ? 'reprogramar_induccion' : 'citar_induccion', colId, `Sesión ${fecha} ${inicio}–${fin}`, 'ok', { entidad: 'induccion', campo: 'fecha', valor_anterior: antes?.fecha ?? null, valor_nuevo: fecha });
      log('notificacion_simulada', colId, 'Se notificaría la citación a la persona por su canal registrado. No se envió nada.');
      rebuild(); return { ok: true };
    },
    citarVarios(ids, fecha, inicio, fin) {
      const res = (ids || []).map(id => ({ id, r: api.citarInduccion(id, fecha, inicio, fin) }));
      const ok = res.filter(x => x.r.ok).length;
      return ok ? { ok: true, citadas: ok, errores: res.filter(x => !x.r.ok).length } : (res[0]?.r || { ok: false, motivo: 'No hay personas para citar.' });
    },
    registrarAsistencia(colId, entrada, salida) {
      const u = s.user; const r = s.inducciones[colId];
      if (!s.auth.esPersonas(u) || !s.auth.enAlcance(u, colId)) return denegar('registrar_asistencia', colId, 'Solo Personas registra la asistencia a la inducción');
      if (!r) return { ok: false, motivo: 'La persona no tiene una sesión citada.' };
      if (r.fecha > s.hoy) return { ok: false, motivo: 'Solo puedes registrar asistencia de sesiones de hoy o anteriores.' };
      if (!esHora(entrada)) return { ok: false, motivo: 'Indica la hora de entrada (HH:MM).' };
      const sal = salida ? String(salida) : null;
      if (sal !== null && (!esHora(sal) || aMin(sal) <= aMin(entrada))) return { ok: false, motivo: 'La hora de salida debe ser posterior a la de entrada.' };
      const antes = `${r.entrada || '—'}–${r.salida || '—'}`;
      Object.assign(r, { entrada, salida: sal, no_asistio: false, registrada_por: u.usuario_id, registrada_at: reloj() });
      log('registrar_asistencia', colId, 'Entrada y salida de la inducción', 'ok', { entidad: 'induccion', campo: 'entrada_salida', valor_anterior: antes, valor_nuevo: `${entrada}–${sal || '—'}` });
      rebuild(); return { ok: true, estado: estadoInduccion(r, s.hoy).estado };
    },
    marcarInasistencia(colId) {
      const u = s.user; const r = s.inducciones[colId];
      if (!s.auth.esPersonas(u) || !s.auth.enAlcance(u, colId)) return denegar('marcar_inasistencia', colId, 'Solo Personas registra la asistencia a la inducción');
      if (!r) return { ok: false, motivo: 'La persona no tiene una sesión citada.' };
      if (r.fecha > s.hoy) return { ok: false, motivo: 'La sesión todavía no ocurre.' };
      Object.assign(r, { no_asistio: true, entrada: null, salida: null, registrada_por: u.usuario_id, registrada_at: reloj() });
      log('marcar_inasistencia', colId, `Sesión ${r.fecha}`, 'ok', { entidad: 'induccion', campo: 'estado', valor_anterior: null, valor_nuevo: 'no_asistio' });
      rebuild(); return { ok: true };
    },
    confirmarInduccion() {
      const u = s.user; const id = u?.usuario_id; const r = s.inducciones[id];
      if (!u || u.rol !== 'Colaborador' || !s.auth.enAlcance(u, id)) return denegar('confirmar_induccion', id || '—', 'Solo la persona confirma su propia inducción');
      if (!r || r.fecha < s.hoy || r.entrada || r.no_asistio) return { ok: false, motivo: 'No tienes una sesión de inducción por confirmar.' };
      Object.assign(r, { confirmada: true, reprogramacion: null });
      log('confirmar_induccion', id, `Sesión ${r.fecha}`, 'ok', { entidad: 'induccion', campo: 'confirmada', valor_anterior: false, valor_nuevo: true });
      rebuild(); return { ok: true };
    },
    pedirReprogramacion(motivo) {
      const u = s.user; const id = u?.usuario_id; const r = s.inducciones[id];
      if (!u || u.rol !== 'Colaborador' || !s.auth.enAlcance(u, id)) return denegar('pedir_reprogramacion', id || '—', 'Solo la persona pide cambiar su propia sesión');
      if (!MOTIVOS_REPROGRAMAR[motivo]) return { ok: false, motivo: 'Elige por qué necesitas otro horario.' };
      if (!r || r.fecha < s.hoy || r.entrada || r.no_asistio) return { ok: false, motivo: 'No tienes una sesión de inducción que se pueda cambiar.' };
      Object.assign(r, { reprogramacion: motivo, confirmada: false });
      log('pedir_reprogramacion', id, 'Motivo visible solo para la persona y Personas', 'ok', { entidad: 'induccion', campo: 'reprogramacion', valor_anterior: null, valor_nuevo: 'solicitada' });
      log('notificacion_simulada', id, 'Se notificaría a Personas por correo. No se envió nada.');
      rebuild(); return { ok: true };
    },
    indicadorInduccion() {
      if (!s.auth.esPersonas(s.user)) return null;
      return indicadorInduccion({ colabs: s.data.colaboradores.filter(c => s.auth.enAlcance(s.user, c.colaborador_id)), inducciones: s.inducciones, hoy: s.hoy });
    },
    // Personas: bandeja de alertas accionables.
    // Los avisos operativos de la jefatura (sin tareas, próximos y nuevos ingresos) no inundan la bandeja de Personas: se ven en Indicadores.
    alertasFicha() { return s.auth.esPersonas(s.user) ? s.alertasFicha.filter(a => !['sin_tareas', 'proximo_ingreso', 'nuevo_ingreso', 'induccion_jefatura'].includes(a.tipo) && s.auth.enAlcance(s.user, a.colaborador_id)) : []; },
    avisosDeEquipos() {
      if (!s.auth.esPersonas(s.user)) return null;
      const t = tipo => s.alertasFicha.filter(a => a.tipo === tipo && s.auth.enAlcance(s.user, a.colaborador_id)).length;
      return { sinTareas: t('sin_tareas'), proximos: t('proximo_ingreso'), nuevos: t('nuevo_ingreso') };
    },
    gestionarAlerta(alertaId, estado) {
      if (!['contactado', 'escalada'].includes(estado)) return denegar('gestionar_alerta', alertaId, 'Acción no válida');
      if (!s.auth.puedeGestionarAlertas(s.user)) return denegar('gestionar_alerta', alertaId, 'Sin permiso para gestionar alertas');
      const a = s.alertasFicha.find(x => x.id === alertaId); if (!a) return { ok: false, motivo: 'La alerta ya no está activa.' };
      const antes = a.estado;
      s.alertaEstados[alertaId] = { estado, por: s.user.usuario_id, actualizada_at: reloj() };
      log(estado === 'contactado' ? 'marcar_contactado' : 'escalar', alertaId, a.titulo, 'ok', { entidad: 'alerta', campo: 'estado', valor_anterior: antes, valor_nuevo: estado });
      let aviso = null;
      if (estado === 'escalada') { aviso = `Se notificaría a ${a.responsable.etiqueta} por correo (simulado).`; log('notificacion_simulada', alertaId, aviso); }
      rebuild();
      return { ok: true, aviso };
    },
    discrepancias() {
      if (!s.auth.esPersonas(s.user)) return [];
      return Object.values(s.fichas).filter(f => f.motivo && s.auth.enAlcance(s.user, f.colaborador_id));
    },
    indicadores() {
      if (!s.auth.esPersonas(s.user)) return null;
      return s.reglas.indicadores(s.data.colaboradores.filter(c => s.auth.enAlcance(s.user, c.colaborador_id)), s.fichas, api.alertasFicha());
    },
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
      s.base = structuredClone(original); s.overrides = {}; s.bitacora = []; s.reportes = []; s.hoy = HOY_DEFAULT; s.fichas = {}; s.alertaEstados = {}; s.nuevosIngresos = []; s.avisosVistos = {}; s.inducciones = {};
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
        if (['reportesVisibles', 'misReportes', 'ingresos', 'companerosPara', 'casosTI', 'alertasFicha', 'discrepancias', 'avisos', 'induccionesEquipo'].includes(nombre)) return [];
        if (nombre === 'avisosDeEquipos') return null;
        if (['vistaFicha', 'indicadores', 'vistaInduccion', 'indicadorInduccion'].includes(nombre)) return null;
        return { ok: false, motivo: 'No se pudo completar la acción. Revisa los datos e intenta nuevamente.' };
      }
    };
  }
  return api;
}
