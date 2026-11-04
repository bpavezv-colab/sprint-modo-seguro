// Asistente de dudas por reglas: responde solo con la información que la página ya muestra a ese rol.
// Sin IA ni conexión externa: busca palabras clave y arma la respuesta con datos filtrados por permisos.
import { evaluarHito, fmt, NOMBRE_HITO } from './rules.js';

const QUIEN = { Personas: 'el Equipo de Personas', TI: 'Soporte TI', Jefatura: 'tu jefatura' };
const ESTADO = { Cumplido: 'listo', Pendiente: 'pendiente', Vencido: 'atrasado', 'Por verificar': 'por verificar' };
const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const tiene = (q, ...p) => p.some(x => q.includes(x));

export const SUGERENCIAS = {
  Colaborador: ['¿A quién le pregunto?', '¿Qué me falta?', '¿Cuál es mi turno?', '¿Cuándo es mi ingreso?', 'No tengo computador', 'Algo no coincide'],
  Jefatura: ['¿Quién tiene atrasos?', '¿Qué acciones tengo?', '¿Quiénes ingresan pronto?'],
  TI: ['¿Qué casos están vencidos?', '¿Qué casos no tienen responsable?'],
  Personas: ['¿Cuántos hitos atrasados hay?', '¿Quién no tiene jefatura?', '¿Qué casos son críticos?'],
};

export function responder(pregunta, store) {
  const s = store.state; const u = s.user;
  if (!u) return 'Primero ingresa con una cuenta.';
  const q = norm(pregunta);
  if (!q.trim()) return 'Escribe tu pregunta o usa una de las sugerencias.';
  const hitos = s.data.hitos.filter(h => s.auth.puedeVerHito(u, h)).map(h => ({ h, ev: evaluarHito(h, s.idx, s.hoy) }));
  const linea = ({ h, ev }) => `${NOMBRE_HITO[h.tipo_hito]}: ${ESTADO[ev.estadoReal] || ev.estadoReal}, plazo ${fmt(ev.limite)}, lo gestiona ${QUIEN[h.responsable_tipo] || h.responsable_tipo}`;
  const lista = (l, vacio) => (l.length ? l.map(x => `• ${x}`).join('\n') : vacio);

  if (u.rol === 'Colaborador') {
    const c = store.verColaborador(u.usuario_id) || {};
    const jef = c.jefatura_id ? s.auth.users.get(c.jefatura_id)?.nombre_ficticio : null;
    const jefTxt = jef ? `${jef} (tu jefatura)` : 'tu jefatura (aún no tienes una asignada: Personas ya tiene la alerta)';
    const de = tipos => hitos.filter(x => tipos.includes(x.h.tipo_hito));
    if (tiene(q, 'no coincide', 'reclamo', 'reportar', 'problema', 'distinto', 'cambio')) return 'Usa "¿Algo no coincide?" al final de tu página y elige la categoría. Lo revisa el Equipo de Personas, no tu jefatura, y no se usa para evaluarte.';
    if (tiene(q, 'computador', 'notebook', 'equipo', 'acceso', 'cuenta', 'clave', 'contrasena', 'correo', 'sistema')) return `Equipos, accesos y cuentas los resuelve Soporte TI.\n${lista(de(['Equipo', 'Acceso']).map(linea), 'No tienes hitos técnicos registrados.')}`;
    if (tiene(q, 'contrato', 'firma', 'sueldo', 'documento')) return `El contrato lo gestiona el Equipo de Personas.\n${lista(de(['Contrato']).map(linea), 'No hay hito de contrato registrado.')}`;
    if (tiene(q, 'reunion', 'plan', 'tareas', 'que hare', 'que voy a hacer', 'funciones')) return `Tu reunión y tu plan de primera semana los coordina ${jefTxt}.\n${lista(de(['Reunión', 'Plan']).map(linea), 'Sin hitos de reunión o plan.')}`;
    if (tiene(q, 'jefe', 'jefa', 'jefatura', 'supervisor')) return `Tu jefatura es ${jefTxt}.`;
    if (tiene(q, 'turno', 'horario', 'jornada', 'hora')) return c.tipo_turno ? `Tu turno registrado es: ${c.tipo_turno}.` : 'Tu turno no está registrado (Sin dato). Personas lo está validando; no te damos un horario inventado.';
    if (tiene(q, 'ingreso', 'empiezo', 'primer dia', 'comienzo', 'fecha')) return c.fecha_ingreso ? `Tu fecha de ingreso es el ${fmt(c.fecha_ingreso)}. Sede: ${c.sede || 'Sin dato'}. Modalidad: ${c.modalidad || 'Sin dato'}.` : 'Tu fecha de ingreso no está registrada (Sin dato). Consulta al Equipo de Personas.';
    if (tiene(q, 'atras', 'venc', 'demora')) return lista(hitos.filter(x => x.ev.estadoReal === 'Vencido').map(linea), 'No tienes tareas atrasadas.') + '\nNinguna depende de ti: el responsable ya la tiene en su bandeja.';
    if (tiene(q, 'falta', 'pendiente', 'que tengo', 'estado', 'avance', 'checklist')) return lista(hitos.filter(x => x.ev.estadoReal !== 'Cumplido').map(linea), '¡Tienes todo listo!');
    if (tiene(q, 'quien', 'pregunt', 'ayuda', 'contacto', 'duda', 'hablar')) return `Según el tema:\n• Equipo, accesos y cuentas: Soporte TI\n• Contrato y dudas generales: Equipo de Personas\n• Tareas, reunión y plan: ${jefTxt}${c.canal_contacto ? `\nTe contactarán por: ${c.canal_contacto}.` : ''}`;
    return 'No encontré esa información en tu página. Puedo responder sobre a quién preguntar, qué te falta, tu turno, tu fecha de ingreso, tu jefatura, equipo y accesos, contrato o reunión.';
  }

  const abiertos = hitos.filter(x => x.ev.estadoReal !== 'Cumplido');
  const venc = hitos.filter(x => x.ev.estadoReal === 'Vencido');
  const porPersona = l => [...new Set(l.map(x => x.h.colaborador_id))];
  if (u.rol === 'Jefatura') {
    if (tiene(q, 'accion', 'mio', 'mias', 'tengo que', 'hacer')) return lista(abiertos.filter(x => x.h.responsable_id === u.usuario_id).map(x => `${x.h.colaborador_id} · ${linea(x)}`), 'No tienes acciones pendientes.');
    if (tiene(q, 'ingres', 'pronto', 'nuev')) return lista([...s.auth.scope(u)].map(id => s.idx.colab.get(id)).filter(c => c && c.fecha_ingreso > s.hoy).map(c => `${c.colaborador_id}: ingresa el ${fmt(c.fecha_ingreso)}`), `No hay ingresos después del ${fmt(s.hoy)} en tu equipo.`);
    if (tiene(q, 'atras', 'venc', 'problema')) return lista(porPersona(venc).map(id => `${id}: ${venc.filter(x => x.h.colaborador_id === id).length} hitos atrasados`), 'Tu equipo no tiene atrasos.');
    return 'Puedo decirte qué acciones tienes, quién de tu equipo tiene atrasos o quiénes ingresan pronto. Solo veo a tu equipo asignado.';
  }
  if (u.rol === 'TI') {
    if (tiene(q, 'sin responsable', 'sin asignar', 'nadie')) return lista(abiertos.filter(x => !x.h.responsable_id).map(x => `${x.h.hito_id} (${x.h.tipo_hito} de ${x.h.colaborador_id})`), 'Todos los casos tienen responsable.');
    if (tiene(q, 'venc', 'atras', 'urgente')) return `${venc.length} casos vencidos.\n${lista(venc.slice(0, 8).map(x => `${x.h.hito_id} (${x.h.tipo_hito} de ${x.h.colaborador_id}), venció el ${fmt(x.ev.limite)}`), '')}`;
    return `Tienes ${abiertos.length} casos técnicos abiertos y ${venc.length} vencidos. Pregunta por vencidos o sin responsable. Solo ves IDs, sin datos personales.`;
  }
  // Personas / Administrador
  if (tiene(q, 'jefatura', 'jefe')) return lista(s.data.colaboradores.filter(c => !c.jefatura_id).map(c => `${c.colaborador_id}: sin jefatura asignada`), 'Todos tienen jefatura.');
  if (tiene(q, 'critic', 'urgente', 'grave')) return lista(porPersona(venc.filter(x => x.ev.crit === 'Alto')).slice(0, 10).map(id => `${id}: atraso crítico`), 'No hay atrasos críticos.');
  if (tiene(q, 'atras', 'venc', 'cuant')) return `${venc.length} hitos atrasados según el catálogo (el registro marca ${hitos.filter(x => x.h.estado === 'Atrasado').length}). Afectan a ${porPersona(venc).length} personas.`;
  return 'Puedo responder cuántos hitos atrasados hay, quién no tiene jefatura o qué casos son críticos.';
}
