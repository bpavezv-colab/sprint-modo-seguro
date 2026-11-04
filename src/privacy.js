// Solo campos del kit sintético. No se admiten columnas personales adicionales.
export const ARCHIVOS = {
  'colaboradores.csv': ['colaboradores', ['colaborador_id', 'fecha_ingreso', 'area', 'sede', 'modalidad', 'tipo_turno', 'jefatura_id', 'canal_contacto', 'correo_corporativo_activo', 'dispositivo_principal', 'estado_onboarding']],
  'hitos_onboarding.csv': ['hitos', ['hito_id', 'colaborador_id', 'tipo_hito', 'responsable_tipo', 'responsable_id', 'fecha_limite', 'fecha_cumplimiento', 'estado', 'nivel_criticidad', 'ultima_actualizacion']],
  'usuarios_roles.csv': ['usuarios', ['usuario_id', 'nombre_ficticio', 'rol', 'area', 'equipo_asignado', 'puede_ver_datos_personales', 'puede_editar_hitos', 'puede_asignar_responsables', 'puede_ver_metricas']],
  'catalogo_hitos.csv': ['catalogo', ['tipo_hito', 'responsable_inicial', 'plazo_ficticio', 'criticidad']],
};

// Categorías del flujo existente; no se recopilan relatos ni datos personales nuevos.
export const TIPOS_REPORTE = ['Mis tareas no coinciden con lo ofrecido', 'Mi turno cambió o no lo conozco', 'No tengo equipo o accesos', 'No sé quién es mi jefatura', 'Otro'];
export const ESTADOS_REPORTE = ['Nuevo', 'En gestión', 'Cerrado'];

export function validarCampos(datos) {
  const esquemas = new Map(Object.values(ARCHIVOS));
  for (const [tabla, filas] of Object.entries(datos)) {
    const campos = esquemas.get(tabla);
    if (!campos || !Array.isArray(filas) || !filas.length) return false;
    for (const fila of filas) {
      if (!fila || typeof fila !== 'object' || Array.isArray(fila)) return false;
      if (Object.keys(fila).some(c => !campos.includes(c)) || campos.some(c => !Object.hasOwn(fila, c))) return false;
      if (Object.values(fila).some(v => v !== null && typeof v !== 'string')) return false;
    }
  }
  return Object.keys(datos).length > 0;
}

export function limpiarPersistenciaAnterior() {
  try {
    // Nunca leer ni migrar reportes, motivos o bitácoras guardados anteriormente.
    if (typeof localStorage !== 'undefined') localStorage.removeItem('sprint-modo-seguro-v1');
    return true;
  } catch {
    return false; // La interfaz avisa si el navegador impide limpiar la versión anterior.
  }
}
