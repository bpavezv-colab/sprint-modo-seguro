# Sprint · Onboarding Modo Seguro

MVP para la Prueba 2 del Talent Tech Hack 2026 (Personas y organizaciones). Checklist de ingreso con acceso seguro por rol sobre los 4 CSV sintéticos del caso.

## Correr
- **Sin instalar nada:** abre `dist/index.html` con doble clic.
- **Desarrollo:** `npm install` → `npm test` → `npm run build`.

## Qué hace cada vista
| Rol | Ve | Puede hacer |
|---|---|---|
| Colaborador (móvil, ingreso simulado con código `123456`) | Sus 5 hitos, quién los gestiona, plazos, a quién pedir ayuda | Solicitar revisión mediante una categoría (solo su autor y Personas en su alcance) |
| Jefatura | Solo su `equipo_asignado`, próximos ingresos, métricas agregadas del equipo | Marcar Reunión/Plan asignados a su cuenta |
| TI | Solo hitos Equipo/Acceso, por código, sin nombres ni canal | Marcar entregado, tomar casos sin responsable, reasignar entre TI |
| Personas / Admin | Todo el proceso, calidad de datos, reportes, permisos, bitácora | Reasignar con motivo, cambiar fecha de corte, cargar CSV, exportar |

## Privacidad y almacenamiento

Esta versión es una demo offline para los datos **100 % sintéticos** del kit. No tiene backend ni base de datos del sitio. Los CSV oficiales y sus identificadores se conservan para mantener las relaciones del caso; los nombres ficticios no son datos de personas reales.

- Los cambios de hitos, las cargas CSV, los reportes, los motivos de reasignación y la bitácora viven únicamente en memoria. Se eliminan al recargar o cerrar la página. No se usa localStorage, sessionStorage ni IndexedDB para guardarlos.
- Al abrir la nueva versión se elimina la clave antigua `sprint-modo-seguro-v1`, sin leer ni recuperar su contenido. Si el navegador impide borrarla, la interfaz avisa que deben borrarse manualmente los datos del sitio. Esto aplica al navegador y origen donde se abre la versión nueva; no elimina copias o exportaciones anteriores.
- Los reportes aceptan solo las categorías de la demo. Se retiró el relato libre para no recopilar información personal adicional. La bitácora registra que se creó una solicitud, sin copiar su categoría ni contenido. Los motivos de reasignación deben ser operativos, sin datos personales, y no persisten.
- El colaborador accede a su propia ficha; las jefaturas a su equipo; TI a hitos Equipo/Acceso, por código y sin nombres de colaboradores ni canales de contacto. Personas y Administración ven reportes dentro de su alcance. Los permisos Sí/No también limitan nombres, edición y métricas.
- La pantalla de selección no muestra nombres ni canales de contacto. El ingreso con código es una simulación: no envía mensajes, no valida una identidad real y no reemplaza la autenticación corporativa.
- Las cargas y el build rechazan columnas ajenas a los esquemas del kit; los vacíos siguen siendo `null` y generan las alertas existentes. La validación de columnas **no demuestra que un archivo sea sintético**: solo deben usarse los archivos de prueba, nunca datos reales.
- Las exportaciones requieren Personas/Administrador y quedan registradas. Los hitos se filtran por alcance; la bitácora completa y la carga de archivos requieren alcance global. Copiar un CSV al portapapeles es una salida explícita del usuario y puede crear una copia fuera de la demo.
- El HTML no carga fuentes, servicios ni analítica externos. Su política de contenido bloquea conexiones de red, recursos externos y envíos de formularios.

**Límite de seguridad:** todos los datos sintéticos se incluyen en el HTML para funcionar con doble clic. Quien tenga el archivo puede inspeccionarlos o cambiar de cuenta de demo. Ocultar campos por rol y usar IDs no cifra ni anonimiza los datos. Antes de usar datos reales se necesita un servicio con autenticación real, autorización en el servidor y entrega de datos limitada a cada usuario. Ese servicio queda fuera de esta arquitectura sin backend.

La revisión toma como contexto el brief de Prueba 2 (secciones 5–10 y 14–15), el dossier de Prueba 1 y el formato de entregable proporcionados. El diccionario de datos y las tarjetas completas se mencionan en el brief, pero no están incluidos entre esos tres documentos ni en este repositorio; se aplicaron los campos del kit y las reglas de `AGENTS.md`. La validación definitiva contra esos documentos queda pendiente de disponer de ellos.

## Comprobar privacidad

Ejecuta `npm test` y luego `npm run build`. Las pruebas de `tests/privacy.test.mjs` cubren la eliminación del almacenamiento anterior, ausencia de escrituras persistentes, rechazo de relatos y columnas adicionales, alcance de reportes y exportaciones, permisos de nombres y métricas, confirmación de reasignaciones y escape de identificadores.

En `dist/index.html`, entra como COL-002 y crea una solicitud. Cambia a JEF-002 o TI-004: no aparece el reporte. Cambia a PER-001 para gestionarlo. Recarga la página: vuelves al selector sin reportes ni cambios guardados. La bitácora también se elimina al recargar, por lo que la evidencia de la demo se revisa en la misma sesión.

## Lo que detecta en los datos (fecha de corte 04-11-2026)
- 90 hitos atrasados según el catálogo; el archivo marca solo 35 (55 "Pendiente" con fecha límite movida).
- 26 "Cumplido" sin respaldo: 4 sin fecha y 22 con fecha futura.
- 7 hitos sin responsable; COL-019 sin jefatura ni equipo.
- `estado_onboarding` que no coincide con los hitos; vacíos en turno, canal y estado.
- Permisos del archivo que se acotan por mínimo privilegio (TI asignar/métricas).

## Manejo de errores y casos borde
La suite incluye pruebas de reglas, excepciones y privacidad (`tests/core.test.mjs`, `tests/excepciones.test.mjs`, `tests/privacy.test.mjs`):
- Rol desconocido o inconsistente → acceso denegado (no cae en ninguna vista por defecto).
- Carga de CSV con IDs duplicados, mal formados o con HTML/JS inyectado → rechazada completa, datos intactos.
- Estado guardado por la versión anterior → se elimina sin leer ni restaurar su contenido; si el navegador impide borrarlo, se avisa. Esta versión no persiste datos.
- Vacíos y fechas inválidas → alerta "dato faltante", nunca un valor inventado; las vistas siguen funcionando.
- Manipular la página para forzar acciones (completar hitos ajenos, entrar como colaborador por el acceso interno) → denegado y registrado.
- Cualquier error inesperado → pantalla de recuperación y registro en la bitácora, sin pantalla en blanco.

## Recorrido de demo (3 minutos)
1. **Camila Rojas (COL-002)** en el teléfono: 1 de 5 listo, 4 atrasos que no dependen de ella; envía "Mis tareas no coinciden".
2. **Felipe Jefatura 02**: ve solo a sus 5 personas; marca la Reunión de Camila; busca COL-006 → "fuera de tu alcance" (queda en la bitácora).
3. **Alex Soporte TI 04**: solo códigos, sin nombres; "Sin responsable" → toma HITO-033.
4. **Hugo Personas 01**: "el registro dice 35, en realidad son 90"; Calidad de datos; el reporte de Camila; la bitácora con todo lo anterior.

Ver `AGENTS.md` (reglas para Codex) y `CODEX_TASKS.md` (tareas listas para pegar).
