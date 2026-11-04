// Genera un kit de prueba (sintético) donde RR.HH. agrega un ingreso nuevo: COL-061 en el equipo de JEF-002.
// Sirve para demostrar el aviso "Nuevo ingreso registrado por RR.HH." cargándolo en Personas → Datos.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseCSV, toCSV } from '../src/csv.js';
const r = f => parseCSV(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
export function kitNuevoIngreso() {
  const colaboradores = r('colaboradores.csv'); const hitos = r('hitos_onboarding.csv'); const usuarios = r('usuarios_roles.csv');
  colaboradores.push({ colaborador_id: 'COL-061', fecha_ingreso: '2026-11-10', area: 'Operaciones', sede: 'Santiago Centro', modalidad: 'Presencial',
    tipo_turno: 'Turno mañana', jefatura_id: 'JEF-002', canal_contacto: 'Teléfono', correo_corporativo_activo: 'No', dispositivo_principal: 'Teléfono', estado_onboarding: 'No iniciado' });
  const plan = [['Contrato', 'Personas', 'PER-002', '2026-11-09', 'Alto'], ['Equipo', 'TI', 'TI-004', '2026-11-10', 'Alto'], ['Acceso', 'TI', 'TI-004', '2026-11-10', 'Alto'],
    ['Reunión', 'Jefatura', 'JEF-002', '2026-11-17', 'Medio'], ['Plan', 'Jefatura', 'JEF-002', '2026-11-17', 'Medio']];
  plan.forEach(([tipo, rt, rid, lim, crit], i) => hitos.push({ hito_id: `HITO-${301 + i}`, colaborador_id: 'COL-061', tipo_hito: tipo, responsable_tipo: rt, responsable_id: rid,
    fecha_limite: lim, fecha_cumplimiento: null, estado: 'Pendiente', nivel_criticidad: crit, ultima_actualizacion: '2026-11-04' }));
  usuarios.splice(60, 0, { usuario_id: 'COL-061', nombre_ficticio: 'Bruno Nuevo', rol: 'Colaborador', area: 'Operaciones', equipo_asignado: 'COL-061',
    puede_ver_datos_personales: 'Sí', puede_editar_hitos: 'No', puede_asignar_responsables: 'No', puede_ver_metricas: 'No' });
  for (const u of usuarios) {
    if (u.usuario_id === 'JEF-002') u.equipo_asignado += '|COL-061';
    if (/^(PER|TI)-/.test(u.usuario_id)) u.equipo_asignado = u.equipo_asignado.replace('COL-060', 'COL-061');
  }
  return { colaboradores, hitos, usuarios };
}
if (process.argv[1] && process.argv[1].endsWith('fixture_nuevo_ingreso.mjs')) {
  const k = kitNuevoIngreso(); const dir = new URL('../tests/fixtures/nuevo_ingreso/', import.meta.url);
  writeFileSync(new URL('colaboradores.csv', dir), toCSV(k.colaboradores));
  writeFileSync(new URL('hitos_onboarding.csv', dir), toCSV(k.hitos));
  writeFileSync(new URL('usuarios_roles.csv', dir), toCSV(k.usuarios));
  console.log('tests/fixtures/nuevo_ingreso/ listo');
}
