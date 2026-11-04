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

## Avisos a la jefatura
- **Sin tareas asignadas:** cada persona del equipo (en sus primeros 90 días o por ingresar) sin las 3 tareas de su ficha genera un aviso a su jefatura, con plazo y prioridad. Desaparece al asignar las tareas.
- **Próximo ingreso:** alguien del equipo ingresa en 14 días o menos.
- **Nuevo ingreso registrado por RR.HH.:** cuando Personas carga un archivo de RR.HH. con una persona nueva, su jefatura recibe el aviso.
- La jefatura ve el contador en la barra superior y la bandeja "Avisos"; Personas ve el total en Indicadores. Parámetros en `CONFIG` (`src/reglas_onboarding.js`).

**Demo de nuevo ingreso:** entra como `PER-001` → Datos → carga los 3 archivos de `tests/fixtures/nuevo_ingreso/` (kit de prueba sintético con COL-061 en el equipo de JEF-002; se regenera con `node scripts/fixture_nuevo_ingreso.mjs`). Luego entra como `JEF-002`.

## Planificación Inteligente de Turnos

Extensión de demostración para jefaturas, separada del onboarding oficial. La implementación vive en `src/optimization/` y funciona dentro del mismo HTML offline, sin backend ni dependencias de runtime nuevas.

### Probar el flujo completo

1. Abre `dist/index.html` y selecciona **Jefatura · JEF-002**. En la barra lateral elige **Planificación de turnos**.
2. La semana sugerida con el corte 04-11-2026 comienza el **16-11-2026**. Revisa los parámetros, marca la confirmación de supuestos y pulsa **Preparar semana de demostración**.
3. Completa la matriz diaria por módulo y mañana/tarde. Los ceros deben escribirse explícitamente. Pulsa **Guardar borrador de demanda** y luego **Confirmar demanda semanal**.
4. Cambia los selectores de prioridad. Mover una tarjeta desplaza las demás y nunca duplica una prioridad. Puedes restablecer el orden recomendado.
5. Pulsa **Generar planificación optimizada**. Puedes ajustar iteraciones, tiempo, estancamiento y semilla, revisar el progreso o cancelar.
6. Revisa calendario, cobertura por celda, faltantes y métricas. Genera otra propuesta con otras prioridades y usa **Comparar con**. Se conservan hasta seis propuestas de la misma demanda en memoria.
7. Pulsa **Aprobar propuesta como borrador validado** y confirma. Esta acción no escribe en CSV, no cambia `tipo_turno`, no modifica hitos ni publica un calendario oficial.

Para probar la excepción, prepara la semana del **09-11-2026**. La confirmación ordinaria se bloquea por falta de anticipación. Solicita autorización con un motivo operativo; cambia a **PER-001**, autoriza la solicitud y confirma el diálogo. Vuelve a **JEF-002** y usa **Abrir semana guardada** con el 09-11-2026: recupera la demanda y su autorización sin reiniciarlas. Ahora puedes confirmarla y optimizar.

### Datos y restricciones de la demostración

Los CSV no contienen módulos, disponibilidad semanal, contratos, competencias, preferencias ni un calendario publicado. `src/optimization/demo.js` genera esos datos y los marca como **creados por el equipo**. Solo reutiliza los IDs del `equipo_asignado`; nunca deduce capacidades o preferencias desde área, modalidad, dispositivo, atraso o desempeño. Los archivos oficiales no cambian.

El ejemplo tiene dos módulos y una sede ficticia por jefatura. Usa bloques alternativos 08:00–12:00 y 13:00–17:00, disponibilidad de lunes a viernes, una ausencia de ejemplo sin motivo personal y habilitaciones sintéticas. Los parámetros iniciales son 12 horas objetivo, máximo 20 horas semanales, 5 días, 8 horas diarias, 12 horas de descanso y 5 días consecutivos. **Son supuestos demostrativos, no reglas legales ni contratos reales.** La jefatura debe revisarlos y confirmarlos al preparar la semana. Puede configurar un único bloque continuo indicando su inicio y fin.

Cada asignación representa `x[i,d,s,m] = 1`: un trabajador, un día, un bloque completo y un módulo. Las cantidades de la matriz representan `D[d,s,m]`. La ausencia de una celda impide guardar; no se sustituye por cero.

Las restricciones duras verifican disponibilidad y ausencias conocidas, habilitación, sede, demanda máxima, un bloque indivisible por persona y día, límites diarios/semanales, días consecutivos, descanso entre asignaciones y conservación de turnos bloqueados. Una contradicción entre un bloqueo y la demanda impide confirmar; nunca se elimina un bloqueo para mejorar cobertura. La falta de capacidad se devuelve como demanda desatendida.

### Costos y orden lexicográfico

Todos los objetivos se minimizan. El orden recomendado es cobertura, cambios, horas, preferencias y equidad.

| Objetivo | Definición | Unidad |
|---|---|---|
| Cobertura | `Σ max(0, demanda - asignaciones)` por día, módulo y bloque | Puestos sin cubrir |
| Cambios | Diferencia simétrica entre asignaciones propuestas y calendario previo; un traslado cuenta una baja y un alta | Altas y bajas de asignaciones |
| Horas | `Σ abs(horas asignadas - horas objetivo conocidas)` | Horas |
| Preferencias | Bloques/días no preferidos y solicitudes individuales incumplidas; una ausencia sigue siendo una restricción dura | Incumplimientos |
| Equidad | Suma de desviaciones absolutas respecto de la media de `horas/capacidad` y `horas no deseadas/capacidad` | Dispersión normalizada |

La capacidad proporcional de cada trabajador es el mínimo de horas objetivo conocidas (o su máximo si falta el objetivo), máximo semanal y horas disponibles considerando bloques completos y máximo de días. Quienes tienen capacidad cero se excluyen del denominador. Esta medida no compara únicamente el número bruto de turnos y es una referencia de reparto, no una evaluación de desempeño. Los descansos y la habilitación siguen verificándose como restricciones, independientemente de ese denominador de referencia.

Si faltan preferencias u horas objetivo opcionales, se informa y se excluyen los términos desconocidos. Si no hay calendario previo, cambios se informa como no evaluado; un calendario explícitamente vacío sí permite medir nuevas asignaciones. La interfaz muestra preferencias solo de forma agregada.

La búsqueda tiene cinco etapas. Cada una optimiza su objetivo activo y acepta únicamente soluciones factibles que respetan los valores bloqueados de etapas anteriores. Las tolerancias valen **cero por defecto**. Si se configuran tolerancias positivas, se expresan en las unidades de cada objetivo y sus límites nunca se acumulan ni se amplían entre etapas. Mover cobertura a una prioridad inferior muestra una advertencia; ninguna prioridad relaja las restricciones duras.

### ALNS implementado

- Inicialización greedy: conserva bloqueos, incorpora asignaciones previas factibles y procesa primero los bloques con menos trabajadores elegibles por puesto requerido.
- Destroy: **Random Removal**, **Worst Removal** según contribución marginal al objetivo activo y **Related Removal** por día, módulo o trabajador. Ninguno retira bloqueos.
- Repair: **Greedy Insertion**, **Regret-2** con arrepentimiento vectorial y reparación orientada al objetivo activo que primero restaura los límites anteriores. No se suman objetivos con pesos.
- Dos ruletas independientes seleccionan operadores. Sus pesos positivos se actualizan por desempeño con reacción exponencial; se registran usos, mejoras y aceptaciones. Estos pesos eligen operadores, no combinan los objetivos.
- Simulated annealing permite explorar valores temporalmente peores del objetivo activo. La mejor incumbente se conserva y los límites lexicográficos anteriores siempre se verifican antes de aceptar.
- Presupuestos configurables de iteraciones totales, tiempo y estancamiento por etapa. PRNG con semilla; el mismo escenario y presupuesto de iteraciones reproducen la búsqueda si no intervienen cancelación o corte por tiempo. La ejecución asíncrona cede el control entre grupos de iteraciones para actualizar la pantalla.

La referencia conceptual de la selección adaptativa de operadores es [Ropke y Pisinger, 2006, publicación original de ALNS](https://pubsonline.informs.org/doi/10.1287/trsc.1050.0135). El algoritmo de este repositorio se implementó para el modelo de turnos de esta demo; no usa datos externos ni una biblioteca de optimización.

### Acceso, trazabilidad y límites

Solo una cuenta de jefatura válida con permiso de edición y equipo asignado prepara, genera o aprueba su propia planificación. Los módulos están ligados al escenario de esa cuenta. Otras jefaturas, colaboradores, TI y Personas no reciben sus calendarios, disponibilidad ni preferencias. Personas/Administración con permiso de asignación y alcance sobre todo el equipo recibe únicamente la solicitud operativa necesaria para autorizar una demanda tardía.

Preparación, demanda, prioridades, confirmación, excepciones, búsqueda y aprobación dejan bitácora con actor, semana y jefatura. Ningún registro de error copia preferencias, mensajes arbitrarios ni contenido personal. Guardar otra demanda elimina sus propuestas e invalida confirmación y autorización. Un cambio de cuenta, incluso si se vuelve inmediatamente a la anterior, descarta una búsqueda en curso. Una carga CSV o reinicio elimina los escenarios. Todo vive solo en memoria y desaparece al recargar.

La fecha de corte y la selección de cuentas son simuladas: el plazo de siete días y la separación de roles no quedan garantizados en producción. No se valida legislación laboral. El horizonte de descanso comprende la semana planificada; faltan compromisos de semanas contiguas para validar sus fronteras. El tiempo máximo se comprueba durante la búsqueda y puede excederse durante una operación indivisible; para grandes instancias sería necesario un Worker y más datos de capacidad. ALNS no certifica factibilidad operacional con datos desconocidos ni garantiza óptimo global. La aprobación requiere revisión humana y se mantiene como borrador.

Las pruebas de `tests/optimization.test.mjs` y `tests/planning.test.mjs` cubren restricciones, lexicografía, reproducibilidad, equidad proporcional, datos opcionales, presupuesto/cancelación, alcance, demanda tardía, cambio de cuenta y flujo de interfaz. El caso pequeño con dos trabajadores verifica que priorizar cambios conserva a A y priorizar preferencias asigna a B, conservando los valores anteriores de cada etapa.
