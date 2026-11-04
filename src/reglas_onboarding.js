// Reglas de negocio de la Ficha de Ingreso (equivalente a app/services/reglas_onboarding.rb del brief).
// Todo parámetro vive en CONFIG o en el catálogo (catalogo_hitos.csv): si la condición adicional cambia
// una regla, se cambia aquí o en los datos, nunca en la interfaz.
// Principio: no inventar valores. Un vacío se informa como "Sin dato" y genera una alerta.
import { isISO, addDays, diffDays, NOMBRE_HITO } from './rules.js';

export const CONFIG = {
  // De dónde sale la fecha límite de un hito: 'hito' (fecha del hito y, si falta, ingreso + plazo del catálogo)
  // o 'catalogo' (regla del catálogo primero). El brief pide 'hito'.
  fuentePlazo: 'hito',
  // Traducción del texto de plazo_ficticio del catálogo a días desde la fecha de ingreso.
  plazos: { 'Antes del día 1': -1, 'Día 1': 0, 'Primera semana': 7 },
  estadoCompletado: 'Cumplido',
  niveles: ['Baja', 'Media', 'Alta', 'Urgente'],
  diasSubePrioridad: 2,          // sube un nivel si faltan 2 días o menos para el ingreso
  diasResolverDato: 1,           // plazo para corregir un dato faltante
  diasContactarDiscrepancia: 1,  // plazo para que Personas contacte a quien reportó algo
  diasAvisoFichaSinEnviar: 7,    // se alerta a la jefatura si el ingreso está a 7 días o menos
  diasEnvioAntesIngreso: 2,      // la ficha debe estar enviada 2 días antes del ingreso
  diasVentanaTareas: 90,         // se avisa "sin tareas asignadas" a quienes están en sus primeros 90 días o por ingresar
  diasAsignarTareas: 1,          // plazo para que la jefatura asigne tareas a quien ya ingresó
  diasAvisoIngreso: 14,          // se avisa a la jefatura de un ingreso que llega en 14 días o menos
  diasAtenderNuevo: 1,           // plazo para revisar un ingreso recién registrado por RR.HH.
  camposBloqueantes: { fecha_ingreso: 'fecha de ingreso', jefatura_id: 'jefatura', tipo_turno: 'turno' },
  camposRevisar: { canal_contacto: 'canal de contacto', estado_onboarding: 'estado de onboarding' },
  hitosTecnicos: ['Equipo', 'Acceso'],
  sedePiloto: null, // el kit no define la sede piloto: null = todas (supuesto declarado en DATOS.md)
  accionHito: {
    Contrato: 'Gestionar la firma del contrato',
    Equipo: 'Entregar el equipo de trabajo',
    Acceso: 'Habilitar cuentas y accesos',
    'Reunión': 'Agendar y realizar la reunión con la persona',
    Plan: 'Entregar el plan de primera semana',
  },
};

export const MOTIVOS = { tareas: 'Tareas o cargo', turno: 'Turno', equipo: 'Equipo o accesos', otro: 'Otro' };
// Cada motivo se registra con la categoría cerrada de privacy.js (sin texto libre).
export const MOTIVO_A_REPORTE = {
  tareas: 'Mis tareas no coinciden con lo ofrecido',
  turno: 'Mi turno cambió o no lo conozco',
  equipo: 'No tengo equipo o accesos',
  otro: 'Otro',
};
export const ESTADOS_FICHA = {
  incompleta: 'Incompleta',
  lista: 'Lista para enviar',
  enviada: 'Enviada',
  confirmada: 'Confirmada',
  con_discrepancia: 'Con discrepancia',
  requiere_reconfirmacion: 'Requiere reconfirmación',
};
export const POST_ENVIO = ['enviada', 'confirmada', 'con_discrepancia', 'requiere_reconfirmacion'];
export const CAMPOS_FICHA = [
  ['tarea_1', 'Falta la tarea 1'],
  ['tarea_2', 'Falta la tarea 2'],
  ['tarea_3', 'Falta la tarea 3'],
  ['companero_id', 'Falta el compañero o compañera de apoyo'],
  ['reunion_at', 'Falta la fecha y hora de la reunión con jefatura'],
];
export const TIPOS_ALERTA = {
  sin_dato: 'Sin dato',
  hito_atrasado: 'Hito atrasado',
  sin_plazo: 'Sin plazo',
  sin_responsable: 'Sin responsable',
  discrepancia: 'Algo no coincide',
  ficha_sin_enviar: 'Ficha sin enviar',
  sin_respuesta: 'Sin respuesta',
  reconfirmacion: 'Reconfirmación',
  sin_tareas: 'Sin tareas asignadas',
  proximo_ingreso: 'Próximo ingreso',
  nuevo_ingreso: 'Nuevo ingreso registrado por RR.HH.',
  induccion_sin_citar: 'Inducción sin citar',
  induccion_por_registrar: 'Asistencia por registrar',
  induccion_reprogramar: 'Reprogramar inducción',
  induccion_no_asistio: 'Inasistencia a inducción',
  induccion_jefatura: 'Inducción pendiente',
};
// Avisos que van a la bandeja de la jefatura (además de la bandeja de Personas).
export const AVISOS_JEFATURA = ['nuevo_ingreso', 'proximo_ingreso', 'sin_tareas', 'ficha_sin_enviar', 'induccion_jefatura'];
export const tareasFaltantes = f => [1, 2, 3].filter(i => !f || !String(f[`tarea_${i}`] ?? '').trim()).length;

const NIVEL_NORM = { Alta: 'Alta', Alto: 'Alta', Media: 'Media', Medio: 'Media', Baja: 'Baja', Bajo: 'Baja', Urgente: 'Urgente' };
export const normNivel = v => NIVEL_NORM[v] || null;
const PERSONAS = { tipo: 'Personas', id: null, origen: 'regla', etiqueta: 'Personas' };

export class ReglasOnboarding {
  constructor({ idx, hoy, config = CONFIG, nombreDe = id => id }) {
    this.idx = idx; this.hoy = hoy; this.cfg = config; this.nombreDe = nombreDe;
  }

  diasParaIngreso(c) { return c && isISO(c.fecha_ingreso) ? diffDays(c.fecha_ingreso, this.hoy) : null; }

  // ---------- hitos ----------
  fechaLimite(h) {
    const c = this.idx.colab.get(h.colaborador_id);
    const k = this.idx.catalogo.get(h.tipo_hito);
    const delHito = isISO(h.fecha_limite) ? h.fecha_limite : null;
    const off = k ? this.cfg.plazos[k.plazo_ficticio] : undefined;
    const porCatalogo = c && isISO(c.fecha_ingreso) && off !== undefined ? addDays(c.fecha_ingreso, off) : null;
    const orden = this.cfg.fuentePlazo === 'catalogo'
      ? [[porCatalogo, 'catalogo'], [delHito, 'hito']]
      : [[delHito, 'hito'], [porCatalogo, 'catalogo']];
    const [fecha, origen] = orden.find(([f]) => f) || [null, null];
    return { fecha, origen, delHito, porCatalogo };
  }
  completado(h) { return h.estado === this.cfg.estadoCompletado; }
  // true = atrasado, false = en plazo o completado, null = no se puede calcular (falta fecha)
  atrasado(h) {
    if (this.completado(h)) return false;
    const { fecha } = this.fechaLimite(h);
    return fecha ? fecha < this.hoy : null;
  }
  estadoHito(h) {
    if (this.completado(h)) return isISO(h.fecha_cumplimiento) && h.fecha_cumplimiento <= this.hoy ? 'Listo' : 'Por verificar';
    const a = this.atrasado(h);
    if (a === null) return 'Sin fecha';
    return a ? 'Atrasado' : 'Pendiente';
  }
  fechaComprometida(h) { return isISO(h.fecha_comprometida) ? h.fecha_comprometida : this.fechaLimite(h).fecha; }

  responsable(h) {
    if (h.responsable_id) return { tipo: h.responsable_tipo, id: h.responsable_id, origen: 'hito', etiqueta: `${this.nombreDe(h.responsable_id)} (${h.responsable_id})` };
    const k = this.idx.catalogo.get(h.tipo_hito);
    if (k && k.responsable_inicial) return { tipo: k.responsable_inicial, id: null, origen: 'regla', etiqueta: `${k.responsable_inicial} · asignado por regla` };
    return { tipo: 'Personas', id: null, origen: 'sin_responsable', etiqueta: 'Personas · sin responsable' };
  }

  nivelBase(h) {
    const k = this.idx.catalogo.get(h.tipo_hito);
    return normNivel(k && k.criticidad) || normNivel(h.nivel_criticidad);
  }
  subirSiCerca(nivel, c) {
    const n = this.cfg.niveles; let i = n.indexOf(nivel);
    if (i < 0) return null;
    const d = this.diasParaIngreso(c);
    if (d !== null && d <= this.cfg.diasSubePrioridad) i = Math.min(i + 1, n.length - 1);
    return n[i];
  }
  prioridadHito(h) { return this.subirSiCerca(this.nivelBase(h), this.idx.colab.get(h.colaborador_id)); }
  esCritico(h) { return this.nivelBase(h) === 'Alta'; }

  // ---------- ficha ----------
  faltantes(f) { return CAMPOS_FICHA.filter(([k]) => !f || !String(f[k] ?? '').trim()).map(([, m]) => m); }
  estadoFicha(f) {
    if (f && POST_ENVIO.includes(f.estado)) return f.estado;
    return this.faltantes(f).length ? 'incompleta' : 'lista';
  }

  semaforo(c, f) {
    const hs = this.idx.hitosPorColab.get(c.colaborador_id) || [];
    const est = this.estadoFicha(f);
    const rojo = [];
    if (est === 'con_discrepancia') rojo.push('Discrepancia reportada');
    if (est === 'requiere_reconfirmacion') rojo.push('Requiere reconfirmación');
    const crit = hs.filter(h => this.atrasado(h) === true && this.esCritico(h));
    if (crit.length) rojo.push(`${crit.length} ${crit.length === 1 ? 'hito crítico atrasado' : 'hitos críticos atrasados'}`);
    if (hs.some(h => this.atrasado(h) === null)) rojo.push('Falta fecha para calcular un plazo');
    for (const [k, label] of Object.entries(this.cfg.camposBloqueantes)) if (c[k] == null) rojo.push(`Sin dato: ${label}`);
    if (rojo.length) return { color: 'rojo', texto: 'Requiere acción', motivos: rojo };
    const atr = hs.filter(h => this.atrasado(h) === true);
    if (est === 'confirmada' && !atr.length) return { color: 'verde', texto: 'Al día', motivos: ['Ficha confirmada y hitos al día'] };
    const am = [];
    if (est !== 'confirmada') am.push(`Ficha: ${ESTADOS_FICHA[est].toLowerCase()}`);
    if (atr.length) am.push(`${atr.length} ${atr.length === 1 ? 'hito atrasado no crítico' : 'hitos atrasados no críticos'}`);
    return { color: 'amarillo', texto: 'Pendiente', motivos: am };
  }

  // ---------- alertas ----------
  // Toda alerta lleva responsable, acción requerida, plazo y prioridad. Si falta alguno, no se crea.
  crearAlerta(a) {
    if (!a.responsable || !a.responsable.etiqueta || !a.accion_requerida || !a.plazo || !a.prioridad) return null;
    return { ...a, id: `${a.tipo}:${a.clave}` };
  }

  // nuevos: ingresos detectados en una carga de RR.HH. [{ colaborador_id, registrado_at }]
  alertas(colabs, hitos, fichas, nuevos = []) {
    const out = [];
    const add = a => { const v = this.crearAlerta(a); if (v) out.push(v); };
    const plazoDato = addDays(this.hoy, this.cfg.diasResolverDato);
    for (const c of colabs) {
      const id = c.colaborador_id; const f = fichas[id]; const est = this.estadoFicha(f); const d = this.diasParaIngreso(c);
      for (const [k, label] of Object.entries(this.cfg.camposBloqueantes)) {
        if (c[k] != null) continue;
        add({ tipo: 'sin_dato', clave: `${id}:${k}`, colaborador_id: id, campo: k, titulo: `Sin dato: ${label}`, responsable: PERSONAS,
          accion_requerida: `Completar ${label} en el registro de RR.HH. No se inventa el valor.`, plazo: plazoDato, prioridad: this.subirSiCerca('Alta', c) });
      }
      for (const [k, label] of Object.entries(this.cfg.camposRevisar)) {
        if (c[k] != null) continue;
        add({ tipo: 'sin_dato', clave: `${id}:${k}`, colaborador_id: id, campo: k, titulo: `Sin dato: ${label}`, responsable: PERSONAS,
          accion_requerida: `Validar ${label} con la persona y corregir el registro.`, plazo: plazoDato, prioridad: this.subirSiCerca('Media', c) });
      }
      if (est === 'con_discrepancia' && f) {
        add({ tipo: 'discrepancia', clave: id, colaborador_id: id, titulo: `Algo no coincide: ${MOTIVOS[f.motivo] || 'Sin dato'}`, responsable: PERSONAS,
          accion_requerida: 'Contactar a la persona y revisar la discrepancia con la jefatura.',
          plazo: addDays((f.respondida_at || this.hoy).slice(0, 10), this.cfg.diasContactarDiscrepancia), prioridad: this.subirSiCerca('Alta', c) });
      }
      if (est === 'requiere_reconfirmacion' && f) {
        add({ tipo: 'reconfirmacion', clave: id, colaborador_id: id, titulo: 'La ficha cambió y debe reconfirmarse', responsable: PERSONAS,
          accion_requerida: 'Avisar a la persona del cambio y pedir que reconfirme su ficha.', plazo: plazoDato, prioridad: this.subirSiCerca('Alta', c) });
      }
      const jefe = c.jefatura_id ? { tipo: 'Jefatura', id: c.jefatura_id, origen: 'colaborador', etiqueta: `${this.nombreDe(c.jefatura_id)} (${c.jefatura_id})` } : null;
      const sinTareas = tareasFaltantes(f);
      const enVentana = d !== null && d >= -this.cfg.diasVentanaTareas;
      // Sin tareas: la persona no sabe qué hará. Se avisa a su jefatura (y Personas lo ve en su bandeja).
      if (jefe && !POST_ENVIO.includes(est) && sinTareas && enVentana) {
        const yaIngreso = d < 0;
        add({ tipo: 'sin_tareas', clave: id, colaborador_id: id,
          titulo: sinTareas === 3 ? 'Sin tareas asignadas' : `Faltan ${sinTareas} de 3 tareas`, responsable: jefe,
          accion_requerida: yaIngreso
            ? 'Asignar 3 tareas reales en la ficha: la persona ya ingresó y necesita saber qué hacer para aportar al equipo.'
            : 'Asignar 3 tareas reales en la ficha antes de su primer día.',
          plazo: yaIngreso || d <= this.cfg.diasEnvioAntesIngreso ? addDays(this.hoy, this.cfg.diasAsignarTareas) : addDays(c.fecha_ingreso, -this.cfg.diasEnvioAntesIngreso),
          prioridad: yaIngreso ? 'Alta' : this.subirSiCerca('Media', c) });
      }
      // Próximo ingreso: llega alguien al equipo en los próximos días.
      if (jefe && d !== null && d >= 0 && d <= this.cfg.diasAvisoIngreso) {
        add({ tipo: 'proximo_ingreso', clave: id, colaborador_id: id, titulo: d === 0 ? 'Ingresa hoy' : `Ingresa en ${d} ${d === 1 ? 'día' : 'días'}`, responsable: jefe,
          accion_requerida: 'Preparar la llegada: completar y enviar la ficha de ingreso.',
          plazo: d > this.cfg.diasEnvioAntesIngreso ? addDays(c.fecha_ingreso, -this.cfg.diasEnvioAntesIngreso) : this.hoy, prioridad: this.subirSiCerca('Media', c) });
      }
      if ((est === 'incompleta' || est === 'lista') && !sinTareas && c.jefatura_id && d !== null && d >= 0 && d <= this.cfg.diasAvisoFichaSinEnviar) {
        add({ tipo: 'ficha_sin_enviar', clave: id, colaborador_id: id, titulo: 'Ficha de ingreso sin enviar',
          responsable: { tipo: 'Jefatura', id: c.jefatura_id, origen: 'colaborador', etiqueta: `${this.nombreDe(c.jefatura_id)} (${c.jefatura_id})` },
          accion_requerida: 'Completar y enviar la ficha de ingreso.', plazo: addDays(c.fecha_ingreso, -this.cfg.diasEnvioAntesIngreso), prioridad: this.subirSiCerca('Media', c) });
      }
      if (est === 'enviada' && d !== null && d >= 0 && d <= this.cfg.diasSubePrioridad) {
        add({ tipo: 'sin_respuesta', clave: id, colaborador_id: id, titulo: 'Ficha enviada sin respuesta', responsable: PERSONAS,
          accion_requerida: 'Contactar a la persona para que confirme su ficha.', plazo: c.fecha_ingreso, prioridad: this.subirSiCerca('Media', c) });
      }
    }
    // Nuevo ingreso registrado por RR.HH. (carga de archivo): aviso a la jefatura asignada.
    const enLista = new Map(colabs.map(c => [c.colaborador_id, c]));
    for (const n of nuevos) {
      const c = enLista.get(n.colaborador_id); if (!c) continue;
      const jefe = c.jefatura_id ? { tipo: 'Jefatura', id: c.jefatura_id, origen: 'colaborador', etiqueta: `${this.nombreDe(c.jefatura_id)} (${c.jefatura_id})` } : PERSONAS;
      add({ tipo: 'nuevo_ingreso', clave: c.colaborador_id, colaborador_id: c.colaborador_id,
        titulo: `RR.HH. registró un ingreso${isISO(c.fecha_ingreso) ? ` para el ${c.fecha_ingreso.split('-').reverse().join('-')}` : ''}`, responsable: jefe,
        accion_requerida: c.jefatura_id ? 'Revisar el nuevo ingreso y preparar su ficha con 3 tareas.' : 'Asignar una jefatura al nuevo ingreso.',
        plazo: addDays(String(n.registrado_at || this.hoy).slice(0, 10), this.cfg.diasAtenderNuevo), prioridad: this.subirSiCerca('Media', c) });
    }
    for (const h of hitos) {
      const r = this.responsable(h); const a = this.atrasado(h); const fl = this.fechaLimite(h);
      const base = { clave: h.hito_id, colaborador_id: h.colaborador_id, hito_id: h.hito_id, tipo_hito: h.tipo_hito };
      if (a === true) {
        add({ ...base, tipo: 'hito_atrasado', titulo: `${NOMBRE_HITO[h.tipo_hito] || h.tipo_hito}: atrasado`, responsable: r,
          accion_requerida: this.cfg.accionHito[h.tipo_hito] || `Completar ${h.tipo_hito}`, plazo: fl.fecha, prioridad: this.prioridadHito(h) });
      } else if (a === null) {
        add({ ...base, tipo: 'sin_plazo', titulo: 'No se puede calcular plazo: falta fecha', responsable: PERSONAS,
          accion_requerida: 'Registrar la fecha límite del hito o la fecha de ingreso. No se inventa una fecha.', plazo: plazoDato, prioridad: this.prioridadHito(h) });
      }
      if (!h.responsable_id && !this.completado(h) && a !== true) {
        add({ ...base, tipo: 'sin_responsable', clave: `${h.hito_id}:resp`, titulo: `${NOMBRE_HITO[h.tipo_hito] || h.tipo_hito}: sin cuenta responsable`, responsable: r,
          accion_requerida: `Asignar una cuenta de ${r.tipo} a este hito.`, plazo: fl.fecha || plazoDato, prioridad: this.prioridadHito(h) });
      }
    }
    return out;
  }

  // ---------- indicadores ----------
  indicadores(colabs, fichas, alertas) {
    const ids = new Set(colabs.map(c => c.colaborador_id));
    const fs = Object.values(fichas).filter(f => ids.has(f.colaborador_id));
    const enviadas = fs.filter(f => f.enviada_at);
    const confirmadas = fs.filter(f => f.estado === 'confirmada');
    const antesDia1 = confirmadas.filter(f => {
      const c = this.idx.colab.get(f.colaborador_id);
      return c && isISO(c.fecha_ingreso) && f.respondida_at && f.respondida_at.slice(0, 10) < c.fecha_ingreso;
    });
    const porMotivo = Object.fromEntries(Object.keys(MOTIVOS).map(k => [k, fs.filter(f => f.motivo === k).length]));
    const porResp = new Map();
    for (const a of alertas.filter(x => x.tipo === 'hito_atrasado')) porResp.set(a.responsable.etiqueta, (porResp.get(a.responsable.etiqueta) || 0) + 1);
    return {
      ingresos: colabs.length,
      enviadas: enviadas.length,
      confirmadas: confirmadas.length,
      confirmadasAntesDia1: antesDia1.length,
      pctAntesDia1: enviadas.length ? Math.round(antesDia1.length / enviadas.length * 100) : null,
      porMotivo,
      atrasadosPorResponsable: [...porResp.entries()].sort((a, b) => b[1] - a[1]),
    };
  }
}
