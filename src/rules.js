// Reglas de negocio del onboarding: plazos del catálogo, estado real y validaciones del diccionario.
// Principio: nunca corregir en silencio. Toda inconsistencia se informa como alerta.

export const HOY_DEFAULT = '2026-11-04'; // fecha de corte de la Hackathon (editable desde Personas)
export const TIPOS_HITO = ['Contrato', 'Equipo', 'Acceso', 'Reunión', 'Plan'];
export const PLAZO_OFFSET = { 'Antes del día 1': -1, 'Día 1': 0, 'Primera semana': 7 };
export const TOLERANCIA_DIAS = 1; // margen para no alertar por diferencias de un día

export const DOMINIOS = {
  area: ['Personas', 'Operaciones', 'Tecnología', 'Comercial'],
  sede: ['Santiago Centro', 'Providencia', 'Valparaíso', 'Concepción'],
  modalidad: ['Presencial', 'Híbrida', 'Remota'],
  tipo_turno: ['Jornada diurna', 'Jornada parcial', 'Turno mañana', 'Turno tarde'],
  canal_contacto: ['Teléfono', 'Correo personal', 'Correo corporativo'],
  correo_corporativo_activo: ['Sí', 'No'],
  dispositivo_principal: ['Teléfono', 'Computador'],
  estado_onboarding: ['No iniciado', 'En proceso', 'Completado'],
  estado: ['Pendiente', 'Cumplido', 'Atrasado'],
  responsable_tipo: ['Personas', 'TI', 'Jefatura'],
  nivel_criticidad: ['Bajo', 'Medio', 'Alto'],
};

const PREFIJO_ROL = { Personas: 'PER-', TI: 'TI-', Jefatura: 'JEF-' };
const CRIT_NORM = { Alta: 'Alto', Alto: 'Alto', Media: 'Medio', Medio: 'Medio', Bajo: 'Bajo', Baja: 'Bajo' };
export const CRIT_PESO = { Alto: 3, Medio: 2, Bajo: 1 };

export const NOMBRE_HITO = {
  Contrato: 'Firma de contrato',
  Equipo: 'Entrega de equipo',
  Acceso: 'Accesos y cuentas',
  'Reunión': 'Reunión con tu jefatura',
  Plan: 'Plan de primera semana',
};

// ---------- fechas ISO (sin zonas horarias: se opera en días) ----------
export function isISO(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
export function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function diffDays(a, b) { // a - b en días
  return Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);
}
export function fmt(iso) {
  if (!isISO(iso)) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}
export function normCrit(v) { return CRIT_NORM[v] || null; }

// ---------- índices ----------
export function indexData(data) {
  const colab = new Map(data.colaboradores.map(c => [c.colaborador_id, c]));
  const users = new Map(data.usuarios.map(u => [u.usuario_id, u]));
  const catalogo = new Map(data.catalogo.map(k => [k.tipo_hito, k]));
  const hitosPorColab = new Map();
  for (const h of data.hitos) {
    if (!hitosPorColab.has(h.colaborador_id)) hitosPorColab.set(h.colaborador_id, []);
    hitosPorColab.get(h.colaborador_id).push(h);
  }
  for (const list of hitosPorColab.values()) list.sort((a, b) => TIPOS_HITO.indexOf(a.tipo_hito) - TIPOS_HITO.indexOf(b.tipo_hito));
  return { colab, users, catalogo, hitosPorColab };
}

// Plazo efectivo = regla del catálogo aplicada a la fecha de ingreso.
// La fecha_limite registrada se muestra como referencia, pero no se usa para "perdonar" atrasos.
export function plazoRegla(hito, idx) {
  const c = idx.colab.get(hito.colaborador_id);
  const k = idx.catalogo.get(hito.tipo_hito);
  if (!c || !k || !isISO(c.fecha_ingreso) || !(k.plazo_ficticio in PLAZO_OFFSET)) return null;
  return addDays(c.fecha_ingreso, PLAZO_OFFSET[k.plazo_ficticio]);
}

export function evaluarHito(h, idx, hoy) {
  const flags = [];
  const regla = plazoRegla(h, idx);
  const limiteReg = isISO(h.fecha_limite) ? h.fecha_limite : null;
  const limite = regla || limiteReg;
  if (!limiteReg) flags.push('fecha_limite_invalida');
  if (regla && limiteReg && diffDays(limiteReg, regla) > TOLERANCIA_DIAS) flags.push('plazo_corrido');
  if (!h.responsable_id) flags.push('responsable_vacio');
  else if (!idx.users.has(h.responsable_id)) flags.push('responsable_inexistente');
  if (h.ultima_actualizacion && isISO(h.ultima_actualizacion) && h.ultima_actualizacion > hoy) flags.push('actualizacion_futura');

  let estadoReal;
  if (!DOMINIOS.estado.includes(h.estado)) { estadoReal = 'Por verificar'; flags.push('estado_invalido'); }
  else if (h.estado === 'Cumplido') {
    if (!h.fecha_cumplimiento) { estadoReal = 'Por verificar'; flags.push('cumplido_sin_fecha'); }
    else if (!isISO(h.fecha_cumplimiento)) { estadoReal = 'Por verificar'; flags.push('fecha_cumplimiento_invalida'); }
    else if (h.fecha_cumplimiento > hoy) { estadoReal = 'Por verificar'; flags.push('cumplido_fecha_futura'); }
    else estadoReal = 'Cumplido';
  } else {
    if (h.fecha_cumplimiento) flags.push('abierto_con_fecha_cumplimiento');
    estadoReal = limite && hoy > limite ? 'Vencido' : 'Pendiente';
    if (h.estado === 'Pendiente' && estadoReal === 'Vencido') flags.push('pendiente_vencido_segun_regla');
  }
  const diasVencido = estadoReal === 'Vencido' ? diffDays(hoy, limite) : 0;
  const k = idx.catalogo.get(h.tipo_hito);
  const crit = normCrit(h.nivel_criticidad) || normCrit(k && k.criticidad) || 'Medio';
  return { estadoReal, limite, limiteRegistrado: limiteReg, regla, diasVencido, crit, flags };
}

export function avanceColaborador(colId, idx, hoy) {
  const hs = idx.hitosPorColab.get(colId) || [];
  const ev = hs.map(h => evaluarHito(h, idx, hoy));
  const cumplidos = ev.filter(e => e.estadoReal === 'Cumplido').length;
  const vencidos = ev.filter(e => e.estadoReal === 'Vencido').length;
  const porVerificar = ev.filter(e => e.estadoReal === 'Por verificar').length;
  const vencidosAltos = ev.filter(e => e.estadoReal === 'Vencido' && e.crit === 'Alto').length;
  const semaforo = vencidosAltos ? 'rojo' : (vencidos || porVerificar) ? 'amarillo' : cumplidos === hs.length && hs.length ? 'verde' : 'gris';
  return { total: hs.length, cumplidos, vencidos, porVerificar, vencidosAltos, semaforo };
}

// ---------- validaciones del diccionario (sección 3) ----------
export const REGLAS = {
  id_duplicado: { titulo: 'Identificador duplicado', sev: 'alta', accion: 'Rechazar o depurar el registro duplicado en el origen.' },
  relacion_inexistente: { titulo: 'Relación inexistente', sev: 'alta', accion: 'Revisar el identificador en el archivo de origen.' },
  hitos_incompletos: { titulo: 'Colaborador sin sus 5 hitos', sev: 'alta', accion: 'Completar los hitos faltantes según el catálogo.' },
  tipo_fuera_catalogo: { titulo: 'Tipo de hito fuera del catálogo', sev: 'alta', accion: 'No se admiten categorías nuevas.' },
  responsable_vacio: { titulo: 'Hito sin responsable', sev: 'alta', accion: 'Asignar responsable explícitamente (sin asignación automática).' },
  responsable_inexistente: { titulo: 'Responsable no existe en usuarios', sev: 'alta', accion: 'Corregir responsable_id.' },
  responsable_rol_distinto: { titulo: 'Responsable con rol distinto al tipo', sev: 'media', accion: 'Reasignar a una cuenta del área responsable.' },
  responsable_tipo_vs_catalogo: { titulo: 'Área responsable distinta al catálogo', sev: 'media', accion: 'Confirmar con Personas si la excepción es válida.' },
  jefatura_hito_distinta: { titulo: 'Hito de jefatura asignado a otra jefatura', sev: 'media', accion: 'Alinear con la jefatura del colaborador.' },
  cumplido_sin_fecha: { titulo: 'Cumplido sin fecha de cumplimiento', sev: 'alta', accion: 'Pedir evidencia al responsable; queda "Por verificar".' },
  cumplido_fecha_futura: { titulo: 'Cumplido con fecha futura', sev: 'alta', accion: 'No contar como cumplido hasta verificar.' },
  actualizacion_futura: { titulo: 'Última actualización con fecha futura', sev: 'media', accion: 'Revisar trazabilidad del registro.' },
  abierto_con_fecha_cumplimiento: { titulo: 'Hito abierto con fecha de cumplimiento', sev: 'media', accion: 'Aclarar si se cumplió o no.' },
  plazo_corrido: { titulo: 'Fecha límite más tarde que la regla del catálogo', sev: 'alta', accion: 'Se usa el plazo del catálogo; la fecha movida no oculta el atraso.' },
  pendiente_vencido_segun_regla: { titulo: '"Pendiente" que ya está vencido según el catálogo', sev: 'alta', accion: 'Tratar como atrasado y escalar al responsable.' },
  fecha_invalida: { titulo: 'Fecha con formato inválido', sev: 'alta', accion: 'Usar formato ISO AAAA-MM-DD.' },
  valor_fuera_dominio: { titulo: 'Valor fuera de los permitidos', sev: 'media', accion: 'Corregir según el diccionario.' },
  jefatura_vacia: { titulo: 'Colaborador sin jefatura', sev: 'alta', accion: 'Derivar a Personas para asignar jefatura.' },
  fuera_de_equipo: { titulo: 'Colaborador no aparece en el equipo de su jefatura', sev: 'alta', accion: 'Corregir equipo_asignado o jefatura_id.' },
  campo_vacio: { titulo: 'Dato operativo faltante', sev: 'media', accion: 'Validar con el colaborador; no suponer un valor.' },
  estado_onboarding_inconsistente: { titulo: 'Estado general no coincide con los hitos', sev: 'media', accion: 'El avance se calcula desde los hitos.' },
  permiso_acotado: { titulo: 'Permiso del archivo acotado por mínimo privilegio', sev: 'info', accion: 'Se aplica rol + equipo_asignado + tipo de hito.' },
};

export function validar(data, idx, hoy) {
  const out = [];
  const add = (regla, entidad, id, detalle) => out.push({ regla, entidad, id, detalle, ...REGLAS[regla] });

  const dup = (rows, key, ent) => {
    const seen = new Set();
    for (const r of rows) { if (seen.has(r[key])) add('id_duplicado', ent, r[key], `${key} repetido`); seen.add(r[key]); }
  };
  dup(data.colaboradores, 'colaborador_id', 'colaborador');
  dup(data.hitos, 'hito_id', 'hito');
  dup(data.usuarios, 'usuario_id', 'usuario');

  // colaboradores
  const camposDom = ['area', 'sede', 'modalidad', 'tipo_turno', 'canal_contacto', 'correo_corporativo_activo', 'dispositivo_principal', 'estado_onboarding'];
  const vaciosOperativos = { tipo_turno: 'Turno', canal_contacto: 'Canal de contacto', estado_onboarding: 'Estado de onboarding' };
  const equipoDe = new Map(); // colId -> [jefIds]
  for (const u of data.usuarios.filter(u => u.rol === 'Jefatura')) {
    for (const id of (u.equipo_asignado || '').split('|').map(s => s.trim()).filter(Boolean)) {
      if (!equipoDe.has(id)) equipoDe.set(id, []);
      equipoDe.get(id).push(u.usuario_id);
    }
  }
  for (const c of data.colaboradores) {
    if (!isISO(c.fecha_ingreso)) add('fecha_invalida', 'colaborador', c.colaborador_id, 'fecha_ingreso');
    for (const f of camposDom) if (c[f] !== null && !DOMINIOS[f].includes(c[f])) add('valor_fuera_dominio', 'colaborador', c.colaborador_id, `${f} = "${c[f]}"`);
    for (const [f, label] of Object.entries(vaciosOperativos)) if (c[f] === null) add('campo_vacio', 'colaborador', c.colaborador_id, `${label} vacío`);
    if (!c.jefatura_id) add('jefatura_vacia', 'colaborador', c.colaborador_id, 'Sin jefatura_id y sin equipo asignado');
    else if (!idx.users.has(c.jefatura_id)) add('relacion_inexistente', 'colaborador', c.colaborador_id, `jefatura ${c.jefatura_id} no existe`);
    else if (!(equipoDe.get(c.colaborador_id) || []).includes(c.jefatura_id)) add('fuera_de_equipo', 'colaborador', c.colaborador_id, `${c.jefatura_id} no lo tiene en equipo_asignado`);
    const hs = idx.hitosPorColab.get(c.colaborador_id) || [];
    const tipos = new Set(hs.map(h => h.tipo_hito));
    if (hs.length !== 5 || TIPOS_HITO.some(t => !tipos.has(t))) add('hitos_incompletos', 'colaborador', c.colaborador_id, `${hs.length} hitos`);
    if (c.estado_onboarding) {
      const av = avanceColaborador(c.colaborador_id, idx, hoy);
      if ((c.estado_onboarding === 'Completado' && av.cumplidos < av.total) || (c.estado_onboarding === 'No iniciado' && av.cumplidos > 0)) {
        add('estado_onboarding_inconsistente', 'colaborador', c.colaborador_id, `Registrado "${c.estado_onboarding}" con ${av.cumplidos}/${av.total} hitos cumplidos`);
      }
    }
  }

  // hitos
  for (const h of data.hitos) {
    if (!idx.colab.has(h.colaborador_id)) add('relacion_inexistente', 'hito', h.hito_id, `colaborador ${h.colaborador_id} no existe`);
    const k = idx.catalogo.get(h.tipo_hito);
    if (!k) { add('tipo_fuera_catalogo', 'hito', h.hito_id, `tipo "${h.tipo_hito}"`); continue; }
    if (h.responsable_tipo !== k.responsable_inicial) add('responsable_tipo_vs_catalogo', 'hito', h.hito_id, `${h.responsable_tipo} vs catálogo ${k.responsable_inicial}`);
    for (const f of ['fecha_limite', 'fecha_cumplimiento', 'ultima_actualizacion']) if (h[f] !== null && !isISO(h[f])) add('fecha_invalida', 'hito', h.hito_id, f);
    for (const f of ['estado', 'responsable_tipo', 'nivel_criticidad']) if (h[f] !== null && !DOMINIOS[f].includes(h[f])) add('valor_fuera_dominio', 'hito', h.hito_id, `${f} = "${h[f]}"`);
    if (h.responsable_id && idx.users.has(h.responsable_id) && !h.responsable_id.startsWith(PREFIJO_ROL[h.responsable_tipo] || '?')) add('responsable_rol_distinto', 'hito', h.hito_id, `${h.responsable_id} para ${h.responsable_tipo}`);
    if (h.responsable_tipo === 'Jefatura' && h.responsable_id) {
      const c = idx.colab.get(h.colaborador_id);
      if (c && c.jefatura_id && c.jefatura_id !== h.responsable_id) add('jefatura_hito_distinta', 'hito', h.hito_id, `${h.responsable_id} vs jefatura ${c.jefatura_id}`);
    }
    const ev = evaluarHito(h, idx, hoy);
    for (const f of ev.flags) {
      if (!REGLAS[f]) continue;
      let det = `${h.tipo_hito} de ${h.colaborador_id}`;
      if (f === 'plazo_corrido') det += `: registrada ${fmt(ev.limiteRegistrado)}, regla ${fmt(ev.regla)}`;
      if (f === 'cumplido_fecha_futura') det += `: cumplimiento ${fmt(h.fecha_cumplimiento)}`;
      if (f === 'pendiente_vencido_segun_regla') det += `: vencido hace ${ev.diasVencido} días`;
      add(f, 'hito', h.hito_id, det);
    }
  }

  // permisos del archivo que la política acota
  for (const u of data.usuarios) {
    if (u.rol === 'TI' && u.puede_asignar_responsables === 'Sí') add('permiso_acotado', 'usuario', u.usuario_id, 'Asignar: solo entre cuentas TI y solo hitos Equipo/Acceso');
    if (u.rol === 'TI' && u.puede_ver_metricas === 'Sí') add('permiso_acotado', 'usuario', u.usuario_id, 'Métricas: solo agregadas de hitos técnicos');
  }
  return out;
}

export function agruparAlertas(alertas) {
  const g = new Map();
  for (const a of alertas) {
    if (!g.has(a.regla)) g.set(a.regla, { regla: a.regla, titulo: a.titulo, sev: a.sev, accion: a.accion, items: [] });
    g.get(a.regla).items.push(a);
  }
  const orden = { alta: 0, media: 1, info: 2 };
  return [...g.values()].sort((a, b) => orden[a.sev] - orden[b.sev] || b.items.length - a.items.length);
}
