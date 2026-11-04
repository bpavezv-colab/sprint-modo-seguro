// Asistencia a la inducción general: citación, registro de entrada y salida, inasistencias y reprogramación.
// Contexto: el dossier informa 91% de asistencia a la inducción general (línea base). Este módulo gestiona
// el 9% restante y mide si la persona estuvo la sesión completa. NO es control de asistencia laboral diario
// (eso exige un sistema certificado y reemplazaría el sistema de turnos, que el caso no permite tocar).
// Datos solo en memoria; la hora de entrada y salida la ven solo la persona y Personas.
import { isISO, addDays, diffDays } from './rules.js';

export const CONFIG_INDUCCION = {
  lineaBase: 91,             // % de asistencia a la inducción general informado en el dossier (Prueba 1)
  toleranciaMin: 15,         // minutos de holgura para llegar tarde o salir antes sin marcar "parcial"
  diasReprogramar: 2,        // plazo para reprogramar a quien no asistió o se retiró antes
  diasCitarAntes: 14,        // se alerta "sin citación" a quienes ingresan en 14 días o menos…
  diasCitarDespues: 7,       // …o ingresaron hace 7 días o menos
};

export const ESTADOS_INDUCCION = {
  sin_citar: 'Sin citación',
  citada: 'Citada',
  confirmada: 'Confirmó asistencia',
  reprogramacion: 'Pidió otro horario',
  por_registrar: 'Falta registrar asistencia',
  completa: 'Asistió completa',
  parcial: 'Asistió parcial',
  no_asistio: 'No asistió',
};
export const MOTIVOS_REPROGRAMAR = { turno: 'Choca con mi turno', horario: 'El horario no me acomoda', aviso: 'Me avisaron con poca anticipación', otro: 'Otro' };
export const TONO_INDUCCION = { sin_citar: 'neutral', citada: 'neutral', confirmada: 'ok', reprogramacion: 'warn', por_registrar: 'warn', completa: 'ok', parcial: 'warn', no_asistio: 'bad' };

export const esHora = v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
export const aMin = v => (esHora(v) ? Number(v.slice(0, 2)) * 60 + Number(v.slice(3)) : null);

// Estado derivado: lo registrado manda; si la sesión ya pasó y no hay registro, queda "por registrar" (no se supone nada).
export function estadoInduccion(r, hoy, cfg = CONFIG_INDUCCION) {
  if (!r || !isISO(r.fecha)) return { estado: 'sin_citar' };
  if (r.no_asistio) return { estado: 'no_asistio' };
  if (esHora(r.entrada)) {
    const atraso = Math.max(0, aMin(r.entrada) - aMin(r.inicio));
    const salidaAntes = esHora(r.salida) ? Math.max(0, aMin(r.fin) - aMin(r.salida)) : null;
    if (salidaAntes === null) return { estado: r.fecha < hoy ? 'por_registrar' : 'citada', atraso, enCurso: true };
    const parcial = atraso > cfg.toleranciaMin || salidaAntes > cfg.toleranciaMin;
    const minutos = aMin(r.salida) - aMin(r.entrada);
    return { estado: parcial ? 'parcial' : 'completa', atraso, salidaAntes, minutos, duracion: aMin(r.fin) - aMin(r.inicio) };
  }
  if (r.fecha < hoy) return { estado: 'por_registrar' };
  if (r.reprogramacion) return { estado: 'reprogramacion' };
  return { estado: r.confirmada ? 'confirmada' : 'citada' };
}

// Alertas con el mismo formato que la Ficha de Ingreso: responsable, acción, plazo y prioridad.
export function alertasInduccion({ colabs, inducciones, hoy, nombreDe = id => id, cfg = CONFIG_INDUCCION }) {
  const out = [];
  const personas = { tipo: 'Personas', id: null, origen: 'regla', etiqueta: 'Personas' };
  const jefe = c => (c.jefatura_id ? { tipo: 'Jefatura', id: c.jefatura_id, origen: 'colaborador', etiqueta: `${nombreDe(c.jefatura_id)} (${c.jefatura_id})` } : null);
  const add = a => out.push({ ...a, id: `${a.tipo}:${a.clave}` });
  for (const c of colabs) {
    const id = c.colaborador_id; const r = inducciones[id]; const e = estadoInduccion(r, hoy, cfg);
    const d = isISO(c.fecha_ingreso) ? diffDays(c.fecha_ingreso, hoy) : null;
    if (e.estado === 'sin_citar' && d !== null && d <= cfg.diasCitarAntes && d >= -cfg.diasCitarDespues) {
      add({ tipo: 'induccion_sin_citar', clave: id, colaborador_id: id, titulo: 'Sin citación a la inducción', responsable: personas,
        accion_requerida: 'Citar a la persona a una sesión de inducción general.', plazo: d > 0 ? addDays(c.fecha_ingreso, -1) : hoy, prioridad: d <= 2 ? 'Alta' : 'Media' });
    }
    if (e.estado === 'por_registrar') {
      add({ tipo: 'induccion_por_registrar', clave: id, colaborador_id: id, titulo: 'Inducción sin registro de asistencia', responsable: personas,
        accion_requerida: 'Registrar la hora de entrada y salida, o marcar que no asistió. No se supone la asistencia.', plazo: addDays(r.fecha, 1), prioridad: 'Media' });
    }
    if (e.estado === 'reprogramacion') {
      add({ tipo: 'induccion_reprogramar', clave: id, colaborador_id: id, titulo: `Pidió otro horario: ${MOTIVOS_REPROGRAMAR[r.reprogramacion] || 'Otro'}`, responsable: personas,
        accion_requerida: 'Ofrecer otra sesión de inducción y coordinar con la jefatura para liberar su turno.', plazo: addDays(hoy, 1), prioridad: 'Alta' });
    }
    if (e.estado === 'no_asistio' || e.estado === 'parcial') {
      const titulo = e.estado === 'no_asistio' ? 'No asistió a la inducción' : `Inducción incompleta${e.atraso > cfg.toleranciaMin ? ` · llegó ${e.atraso} min tarde` : ''}${e.salidaAntes > cfg.toleranciaMin ? ` · salió ${e.salidaAntes} min antes` : ''}`;
      add({ tipo: 'induccion_no_asistio', clave: id, colaborador_id: id, titulo, responsable: personas,
        accion_requerida: e.estado === 'no_asistio' ? 'Contactar a la persona y reprogramar la inducción.' : 'Reprogramar la parte pendiente de la inducción.',
        plazo: addDays(r.fecha, cfg.diasReprogramar), prioridad: 'Alta' });
      const j = jefe(c);
      if (j) add({ tipo: 'induccion_jefatura', clave: id, colaborador_id: id, titulo: e.estado === 'no_asistio' ? 'No asistió a la inducción' : 'Inducción incompleta', responsable: j,
        accion_requerida: 'Personas reprograma la sesión. Coordina que su turno le permita asistir completa.', plazo: addDays(r.fecha, cfg.diasReprogramar), prioridad: 'Media' });
    }
  }
  return out;
}

// Indicador en vivo. Solo cuenta sesiones ya ocurridas y con registro; "por registrar" se informa aparte.
export function indicadorInduccion({ colabs, inducciones, hoy, cfg = CONFIG_INDUCCION }) {
  const est = colabs.map(c => ({ c, e: estadoInduccion(inducciones[c.colaborador_id], hoy, cfg) }));
  const cuenta = k => est.filter(x => x.e.estado === k).length;
  const registradas = cuenta('completa') + cuenta('parcial') + cuenta('no_asistio');
  const asistieron = cuenta('completa') + cuenta('parcial');
  return {
    citadas: est.filter(x => x.e.estado !== 'sin_citar').length,
    sinCitar: cuenta('sin_citar'), porRegistrar: cuenta('por_registrar'), reprogramacion: cuenta('reprogramacion'),
    completas: cuenta('completa'), parciales: cuenta('parcial'), noAsistio: cuenta('no_asistio'), registradas,
    pctAsistencia: registradas ? Math.round(asistieron / registradas * 100) : null,
    pctCompleta: registradas ? Math.round(cuenta('completa') / registradas * 100) : null,
    lineaBase: cfg.lineaBase,
  };
}
