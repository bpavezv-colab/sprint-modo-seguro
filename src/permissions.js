// Motor de permisos "Modo Seguro".
// Acceso efectivo = rol  ∧  equipo_asignado  ∧  permiso Sí/No  ∧  tipo de responsabilidad.
// Un "Sí" del archivo nunca concede acceso global por sí solo (diccionario, convenciones generales).

export const HITOS_TECNICOS = ['Equipo', 'Acceso'];
export const ROLES_VALIDOS = ['Colaborador', 'Jefatura', 'Personas', 'TI', 'Administrador'];
const PREFIJO_CUENTA = { Colaborador: 'COL-', Jefatura: 'JEF-', Personas: 'PER-', TI: 'TI-', Administrador: 'ADM-' };
// Denegar por defecto: una cuenta con rol desconocido o con un ID que no calza con su rol no tiene alcance.
export function cuentaValida(u) {
  return !!u && ROLES_VALIDOS.includes(u.rol) && typeof u.usuario_id === 'string' && u.usuario_id.startsWith(PREFIJO_CUENTA[u.rol]);
}
const PREFIJO_ROL = { Personas: 'PER-', TI: 'TI-', Jefatura: 'JEF-' };

// "COL-001|COL-013", "COL-001 a COL-060", "COL-001 a COL-060 (solo hitos Equipo y Acceso)", "Todos los usuarios"
export function parseEquipo(texto, todosLosColabs) {
  if (!texto) return new Set();
  const t = texto.trim();
  if (/^todos/i.test(t)) return new Set(todosLosColabs);
  const rango = t.match(/COL-(\d+)\s+a\s+COL-(\d+)/i);
  if (rango) {
    const [a, b] = [Number(rango[1]), Number(rango[2])];
    return new Set(todosLosColabs.filter(id => { const n = Number(id.slice(4)); return n >= a && n <= b; }));
  }
  return new Set(t.split('|').map(s => s.trim()).filter(s => todosLosColabs.includes(s)));
}

export function crearAuth(data) {
  const ids = data.colaboradores.map(c => c.colaborador_id);
  const scopes = new Map();
  for (const u of data.usuarios) {
    if (!cuentaValida(u)) { scopes.set(u.usuario_id, new Set()); continue; }
    let s = parseEquipo(u.equipo_asignado, ids);
    if (u.rol === 'Colaborador') s = new Set(s.has(u.usuario_id) ? [u.usuario_id] : []); // solo uno mismo
    scopes.set(u.usuario_id, s);
  }
  const colab = new Map(data.colaboradores.map(c => [c.colaborador_id, c]));
  const users = new Map(data.usuarios.map(u => [u.usuario_id, u]));
  const conocido = u => cuentaValida(u) && users.get(u.usuario_id) === u;
  const si = (u, f) => conocido(u) && u[f] === 'Sí';

  const auth = {
    users,
    cuentaValida,
    scope(u) { return new Set(conocido(u) ? scopes.get(u.usuario_id) : []); },
    enAlcance(u, colId) { return auth.scope(u).has(colId); },

    puedeVerColaborador(u, colId) { return !!u && auth.enAlcance(u, colId); },

    // Campos de colaboradores.csv según la columna "Quién puede visualizarlo" del diccionario
    puedeVerCampo(u, colId, campo) {
      if (!auth.puedeVerColaborador(u, colId)) return false;
      const c = colab.get(colId);
      const propio = u.usuario_id === colId;
      const jefAsignada = u.rol === 'Jefatura' && c && c.jefatura_id === u.usuario_id;
      const PA = u.rol === 'Personas' || u.rol === 'Administrador';
      switch (campo) {
        case 'colaborador_id': case 'area': return true;
        case 'nombre': return u.rol !== 'TI' && si(u, 'puede_ver_datos_personales');
        case 'canal_contacto': return (propio || PA) && si(u, 'puede_ver_datos_personales'); // nunca TI ni jefaturas
        case 'jefatura_id': return propio || jefAsignada || PA;
        case 'fecha_ingreso': return propio || jefAsignada || PA || u.rol === 'TI';
        case 'sede': case 'modalidad': case 'tipo_turno': case 'correo_corporativo_activo':
        case 'dispositivo_principal': case 'estado_onboarding':
          return propio || u.rol === 'Jefatura' || PA || u.rol === 'TI';
        default: return false;
      }
    },

    puedeVerHito(u, h) {
      if (!auth.puedeVerColaborador(u, h.colaborador_id)) return false;
      if (u.rol === 'TI') return HITOS_TECNICOS.includes(h.tipo_hito);
      return true;
    },
    puedeVerResponsableId(u, h) { return auth.puedeVerHito(u, h) && u.rol !== 'Colaborador'; },

    // Completar = marcar cumplido. Solo el responsable de ese hito, dentro de su alcance y su tipo.
    // hoy: un "Cumplido" sin fecha o con fecha futura puede confirmarse de nuevo con la fecha real.
    puedeCompletar(u, h, hoy) {
      if (!auth.puedeVerHito(u, h) || !si(u, 'puede_editar_hitos')) return { ok: false, motivo: 'Sin permiso de edición' };
      if (h.estado === 'Cumplido' && h.fecha_cumplimiento && (!hoy || h.fecha_cumplimiento <= hoy)) return { ok: false, motivo: 'Ya está cumplido' };
      if (u.rol === 'Jefatura') {
        if (!['Reunión', 'Plan'].includes(h.tipo_hito)) return { ok: false, motivo: 'Solo Reunión y Plan' };
        if (h.responsable_tipo !== 'Jefatura') return { ok: false, motivo: `Responsabilidad de ${h.responsable_tipo}` };
        if (h.responsable_id !== u.usuario_id) return { ok: false, motivo: 'Asignado a otra cuenta' };
        return { ok: true };
      }
      if (u.rol === 'TI') {
        if (!HITOS_TECNICOS.includes(h.tipo_hito) || h.responsable_tipo !== 'TI') return { ok: false, motivo: 'Fuera de hitos técnicos' };
        // Sin responsable_id el catálogo lo asigna a TI "por regla": cualquier cuenta TI puede resolverlo y queda en el historial.
        if (h.responsable_id && h.responsable_id !== u.usuario_id) return { ok: false, motivo: `Asignado a ${h.responsable_id}` };
        return { ok: true };
      }
      if (u.rol === 'Personas') {
        if (h.responsable_tipo !== 'Personas') return { ok: false, motivo: `Responsabilidad de ${h.responsable_tipo}` };
        return { ok: true };
      }
      return { ok: false, motivo: 'Separación de funciones: este rol no ejecuta hitos' };
    },

    // Reasignar responsable: explícito, con motivo y trazable.
    puedeReasignar(u, h, nuevoId) {
      if (!auth.puedeVerHito(u, h) || !si(u, 'puede_asignar_responsables')) return { ok: false, motivo: 'Sin permiso para asignar' };
      if (!['TI', 'Personas', 'Administrador'].includes(u.rol)) return { ok: false, motivo: 'Rol sin permiso para asignar' };
      const nuevo = nuevoId ? users.get(nuevoId) : null;
      if (nuevoId && !nuevo) return { ok: false, motivo: 'El responsable no existe' };
      if (nuevo && !nuevo.usuario_id.startsWith(PREFIJO_ROL[h.responsable_tipo] || '?')) return { ok: false, motivo: `Debe ser una cuenta de ${h.responsable_tipo}` };
      if (nuevo && (nuevo.rol !== h.responsable_tipo || !auth.enAlcance(nuevo, h.colaborador_id))) return { ok: false, motivo: 'La cuenta no tiene el rol o alcance necesario' };
      if (u.rol === 'TI') {
        if (!HITOS_TECNICOS.includes(h.tipo_hito)) return { ok: false, motivo: 'TI solo reasigna hitos técnicos' };
        if (nuevo && nuevo.rol !== 'TI') return { ok: false, motivo: 'TI solo reasigna entre cuentas TI' };
        return { ok: true };
      }
      if (u.rol === 'Personas' || u.rol === 'Administrador') return { ok: true };
      return { ok: false, motivo: 'Rol sin permiso para asignar' };
    },
    candidatos(u, h) {
      return [...users.values()].filter(x => auth.puedeReasignar(u, h, x.usuario_id).ok && x.usuario_id !== h.responsable_id);
    },

    puedeVerMetricas(u) { return conocido(u) && u.rol !== 'Colaborador' && si(u, 'puede_ver_metricas'); },
    alcanceMetricas(u) {
      if (!auth.puedeVerMetricas(u)) return 'ninguno';
      if (u.rol === 'TI') return 'tecnico';
      if (u.rol === 'Jefatura') return 'equipo';
      return 'global';
    },
    puedeVerReportes(u, colId) { return conocido(u) && ['Personas', 'Administrador'].includes(u.rol) && si(u, 'puede_ver_datos_personales') && (colId === undefined || auth.enAlcance(u, colId)); },
    puedeReportar(u, colId) { return conocido(u) && u.rol === 'Colaborador' && u.usuario_id === colId && auth.enAlcance(u, colId); },
    puedeVerCalidad(u) { return conocido(u) && ['Personas', 'Administrador'].includes(u.rol); },
    puedeCargarArchivos(u) { return auth.puedeVerCalidad(u) && auth.scope(u).size === ids.length; },
    puedeVerBitacora(u) { return auth.puedeVerCalidad(u) && auth.scope(u).size === ids.length; },

    // ---------- Ficha de Ingreso ----------
    esPersonas(u) { return conocido(u) && (u.rol === 'Personas' || u.rol === 'Administrador'); },
    puedeVerFicha(u, colId) {
      if (!conocido(u) || u.rol === 'TI' || !colab.has(colId)) return false;
      return auth.enAlcance(u, colId);
    },
    puedeEditarFicha(u, colId) {
      if (!conocido(u) || u.rol !== 'Jefatura') return { ok: false, motivo: 'Solo la jefatura completa la ficha' };
      if (!auth.enAlcance(u, colId)) return { ok: false, motivo: 'La persona no está en tu equipo asignado' };
      return { ok: true };
    },
    companerosValidos(u, colId) { return conocido(u) && u.rol === 'Jefatura' ? [...auth.scope(u)].filter(id => id !== colId) : []; },
    puedeResponderFicha(u, colId) {
      return conocido(u) && u.rol === 'Colaborador' && u.usuario_id === colId && auth.enAlcance(u, colId) ? { ok: true } : { ok: false, motivo: 'Solo la persona puede responder su propia ficha' };
    },
    // El motivo de "Algo no coincide" solo lo ven su autor y Personas en su alcance.
    puedeVerMotivo(u, colId) { return (auth.esPersonas(u) && auth.enAlcance(u, colId)) || (conocido(u) && u.rol === 'Colaborador' && u.usuario_id === colId); },
    puedeGestionarAlertas(u) { return auth.esPersonas(u) && si(u, 'puede_asignar_responsables'); },
    // TI marca listo o pendiente solo hitos técnicos suyos o sin cuenta asignada (asignados por regla a TI).
    puedeGestionarTecnico(u, h) {
      if (!conocido(u) || u.rol !== 'TI' || !si(u, 'puede_editar_hitos')) return { ok: false, motivo: 'Solo TI gestiona equipo y accesos' };
      if (!HITOS_TECNICOS.includes(h.tipo_hito) || !auth.puedeVerHito(u, h)) return { ok: false, motivo: 'Fuera de hitos técnicos' };
      if (h.responsable_id && h.responsable_id !== u.usuario_id) return { ok: false, motivo: `Asignado a ${h.responsable_id}` };
      return { ok: true };
    },
    // Control de acceso por ruta (equivale al filtro del controlador). 403 = fuera de alcance.
    puedeEntrar(u, ruta, param) {
      if (!conocido(u)) return { ok: false, status: 401, motivo: 'Sin sesión' };
      const R = { '/mi-ficha': ['Colaborador'], '/equipo': ['Jefatura'], '/ti': ['TI'], '/personas': ['Personas', 'Administrador'] };
      if (ruta === '/ficha') return auth.puedeVerFicha(u, param) ? { ok: true } : { ok: false, status: 403, motivo: `${u.rol} sin alcance sobre la ficha` };
      if (R[ruta]) return R[ruta].includes(u.rol) ? { ok: true } : { ok: false, status: 403, motivo: `La ruta ${ruta} no es para el rol ${u.rol}` };
      return { ok: false, status: 404, motivo: 'Página no encontrada' };
    },
  };
  return auth;
}

// Matriz legible para la pestaña "Permisos" (lo que realmente aplica el prototipo).
export const MATRIZ_EFECTIVA = [
  { cap: 'Ver personas', Colaborador: 'Solo a sí mismo', Jefatura: 'Solo su equipo_asignado', TI: 'Todos, solo como ID', Personas: 'Todos' },
  { cap: 'Ver nombre', Colaborador: 'El propio', Jefatura: 'Su equipo', TI: 'No (sin datos personales)', Personas: 'Sí' },
  { cap: 'Ver canal de contacto', Colaborador: 'El propio', Jefatura: 'No', TI: 'No', Personas: 'Sí' },
  { cap: 'Ver hitos', Colaborador: 'Los propios', Jefatura: 'Los de su equipo', TI: 'Solo Equipo y Acceso', Personas: 'Todos' },
  { cap: 'Marcar cumplido', Colaborador: 'No', Jefatura: 'Reunión/Plan asignados a él', TI: 'Equipo/Acceso asignados a él', Personas: 'Contrato' },
  { cap: 'Reasignar responsable', Colaborador: 'No', Jefatura: 'No', TI: 'Entre cuentas TI, solo hitos técnicos', Personas: 'Sí, con motivo' },
  { cap: 'Ver métricas', Colaborador: 'No', Jefatura: 'Agregadas de su equipo', TI: 'Agregadas técnicas', Personas: 'Agregadas globales' },
  { cap: 'Ver reportes sensibles', Colaborador: 'Crea los suyos', Jefatura: 'No', TI: 'No', Personas: 'Sí' },
  { cap: 'Editar fecha límite', Colaborador: 'No', Jefatura: 'No', TI: 'No', Personas: 'No (no se ocultan atrasos)' },
];
