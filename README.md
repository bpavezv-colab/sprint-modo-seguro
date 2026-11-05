# Sprint · Onboarding Modo Seguro

MVP para la Prueba 2 del Talent Tech Hack 2026 (Personas y organizaciones). Checklist de ingreso con acceso seguro por rol sobre los 4 CSV sintéticos del caso.

## Inicio rápido (Windows): doble clic en **`Iniciar Sprint.bat`**
1. Instala **Node.js LTS** desde https://nodejs.org (solo la primera vez; si falta, el lanzador abre esa página).
2. **IA con Gemini (opcional):** crea una clave gratis en https://aistudio.google.com/apikey y pégala en el archivo **`.env`** de esta carpeta, en la línea `GEMINI_API_KEY=` (sin espacios ni comillas). Si no hay `.env`, el lanzador lo crea copiando `.env.example`. **No subas `.env` a GitHub**: está en `.gitignore`.
3. Doble clic en **`Iniciar Sprint.bat`**. Instala lo necesario la primera vez, prepara la página, inicia el servidor y abre **http://localhost:3000**. Para apagarlo, cierra la ventana negra.

Arriba de la página se ve el modo: **IA activa** (Gemini responde el asistente y redacta "Sugerir reparto") o **IA sin clave · reglas** (responde con reglas y el cálculo simple). Si un modelo de Gemini está saturado, el servidor prueba otro automáticamente (`gemini-3.5-flash-lite` → `gemini-flash-lite-latest` → `gemini-3.1-flash-lite` → `gemini-3.8-flash`).

## Publicar en un servidor
La app está lista para desplegarse con Docker (`Dockerfile`) o en Render con un clic (`render.yaml`).
- **Render:** render.com → New → Blueprint → este repositorio. En *Environment* pega `GEMINI_API_KEY` (y las del correo si las usas). Queda en `https://sprint-ficha-de-ingreso.onrender.com`; si usas otro nombre, cambia `PUBLIC_HOST`.
- **Cualquier servidor con Docker:**
  ```
  docker build -t sprint .
  docker run -d -p 3000:3000 -e PUBLIC_HOST=midominio.cl -e GEMINI_API_KEY=... sprint
  ```
  y pon delante un proxy con HTTPS (Nginx, Caddy o el de la plataforma).
- Variables: `HOST=0.0.0.0` (escuchar fuera del equipo), `PUBLIC_HOST` (dominios aceptados, separados por coma; el resto se rechaza), `PORT` (lo entrega la plataforma).
- Las claves van en las variables de entorno del servidor, **nunca en el repositorio**.

**Pendiente antes de usar datos reales (fuera del alcance del piloto):** inicio de sesión corporativo en lugar del simulado, base de datos en vez de memoria (hoy todo se borra al reiniciar) y validar con TI la política de seguridad y el proveedor de IA.

## Correr
- **Sin instalar nada:** abre `dist/index.html` con doble clic. Funciona todo, salvo la IA y el correo (la página lo indica arriba).
- **Con IA y correo:** `npm install` → `npm run build` → `npm start` y abre **http://localhost:3000**. Ver "Cómo correr en otro computador".
- **Desarrollo:** `npm install` → `npm test` → `npm run build`.

## Cómo correr en otro computador

1. Instala **Node 22 o superior** (`node -v` debe decir v22 o más; `npm start` usa `--env-file-if-exists`, que no existe en versiones anteriores).
2. Clona el repo y entra a la carpeta:
   ```bash
   git clone https://github.com/bpavezv-colab/sprint-modo-seguro.git
   cd sprint-modo-seguro
   git checkout ia-y-correo
   ```
3. `npm install` (instala `nodemailer` y `@anthropic-ai/sdk`, que usa solo el servidor).
4. Crea **tu propio** `.env` copiando la plantilla: `cp .env.example .env` (Windows: `copy .env.example .env`). Complétalo con tus datos (tabla de abajo). Si lo dejas vacío, o no lo creas, la app funciona completa en modo simulado.
5. `npm run build` → genera `dist/index.html`.
6. `npm start` → abre **http://localhost:3000**. Siempre por esa dirección: con doble clic en `dist/index.html` no funcionan la IA ni el correo, y la página lo dice.

Al iniciar, la consola muestra qué está activo:
```
Sprint en http://localhost:3000
IA: activa (claude-haiku-5-5)        ← o "IA: sin clave (reglas)"
Correo: real a casilla@ejemplo.com   ← o "Correo: simulado (falta .env)"
```
La página muestra lo mismo en la franja superior (la casilla aparece enmascarada).

### Variables de `.env` (nombres exactos)
| Variable | Qué es | Dónde se obtiene | Si falta |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Clave de la API de Claude | console.anthropic.com → API Keys. La cuenta necesita **saldo disponible** | El asistente responde con reglas y el reparto muestra el cálculo simple |
| `IA_MODELO` | Modelo de Claude | — | `claude-haiku-5-5` |
| `SMTP_USER` | Cuenta de Gmail que **envía** las alertas | Una cuenta Gmail del equipo | Correo simulado |
| `SMTP_PASS` | **Contraseña de aplicación** de esa cuenta (no la contraseña normal) | Requiere verificación en 2 pasos activa. Cuenta de Google → Seguridad → Contraseñas de aplicaciones | Correo simulado |
| `ALERTA_PARA` | Casilla **única** de demostración que recibe todas las alertas | La define el equipo | Correo simulado |
| `PORT` | Puerto local | — | `3000` |

Reglas: nada de claves, correos ni rutas fijas en el código; todo va en `.env`, que está en `.gitignore`. En el repo solo está `.env.example`. Ninguna clave llega al navegador ni a `dist/` (lo verifica `tests/servidor.test.mjs`). Nunca compartas el `.env` por chat ni lo subas.

Problemas comunes: "El puerto 3000 está ocupado" → cambia `PORT` o cierra la otra app. "No se pudo enviar el correo" → revisa que `SMTP_PASS` sea una contraseña de aplicación. La IA responde "viene de las reglas" → la clave es inválida, no hay saldo o no hay internet; la app sigue funcionando.

## IA y correo: qué está construido y qué no

| Estado | Qué |
|---|---|
| **Construido** (funciona siempre, sin `.env`) | Toda la app por rol; servidor local `server.mjs` (solo escucha en 127.0.0.1); asistente por reglas (`src/asistente.js`); cálculo de "Sugerir reparto" en código (`src/reparto.js`) con aplicación confirmada y registrada en la bitácora; botón "Avisar por correo" en Personas → Casos críticos; franja de estado que indica el modo |
| **Integración opcional** (se activa con `.env`) | Asistente con la API de Claude (`POST /api/chat`); la IA redacta la sugerencia de reparto (`POST /api/sugerencia`); envío real por Gmail a `ALERTA_PARA` (`POST /api/alerta`) |
| **Simulado** (sin `.env` o con doble clic) | El asistente responde con reglas; el correo no se envía (queda "simulado" en la bitácora); el reparto muestra el cálculo simple. La página lo dice arriba |
| **Pendiente** (fuera del MVP) | Autenticación real (hoy la cuenta es una simulación: el servidor confía en el ID de la sesión de demo); datos en una base del servidor (hoy los cambios hechos en la página viven en memoria del navegador, por eso la IA responde sobre los datos oficiales del CSV); destinatarios por persona o jefatura; historial de conversaciones |

### Cómo funciona cada integración
- **Correo (`/api/alerta`):** solo Personas/Administrador. El servidor recalcula los atrasos con los datos oficiales y arma el correo con **solo IDs y conteos** (persona, hitos atrasados por tipo, IDs de hitos, sin responsable). Sin nombres, canal de contacto ni texto libre. El destinatario es siempre `ALERTA_PARA`; la página no puede elegirlo.
- **Asistente (`/api/chat`):** la página envía solo su ID de cuenta, la fecha de corte y la pregunta. El servidor arma el contexto con el **mismo motor de permisos** (`src/contexto_ia.js`): el colaborador recibe solo lo suyo, la jefatura solo su equipo, TI solo Equipo/Acceso por código, Personas cifras agregadas e IDs. Sin canal de contacto ni dispositivo. Si no hay clave o la IA falla, responde con reglas. La bitácora registra que hubo una consulta y su fuente, nunca el contenido.
- **Sugerir reparto (jefatura):** asigna compañero/a de apoyo a cada ficha pendiente que no lo tiene. Primero un **cálculo en código**: carga = hitos de ingreso abiertos + 2 por cada persona que ya acompaña; se elige a quien tiene menos carga, prefiriendo a quien ya ingresó y evitando parejas recíprocas. La IA **solo redacta** la explicación con IDs y números. El servidor valida que ambas personas sean del equipo de esa jefatura y que nadie se acompañe a sí mismo. **Aplicar** exige confirmación y queda en la bitácora (`aplicar_sugerencia` y un `editar_ficha` por persona). Sin clave, se muestra el cálculo simple.
- **Protecciones del servidor:** solo acepta `localhost`/`127.0.0.1` como Host y Origin (evita que otra página lo use), exige JSON, limita el tamaño de los mensajes y la cantidad de solicitudes por minuto, y no copia mensajes de error del proveedor en la consola.

### Probar
1. Sin `.env`: `npm run build && npm start` → la franja dice "IA sin clave · reglas" y "Correo simulado".
   - Entra como **COL-002** → botón **Asistente** → "¿Qué me falta?": responde con reglas.
   - Entra como **PER-001** → Casos críticos → **Avisar por correo** en COL-002 → confirma: "Correo simulado". Revísalo en Bitácora.
   - Entra como **JEF-002** → **Sugerir reparto** → revisa el cálculo → **Aplicar sugerencia** → confirma. La ficha de cada persona queda con su compañero/a y la bitácora lo registra.
2. Con `.env` completo: reinicia `npm start` y repite. El asistente marca "IA", el reparto dice "Redactado por IA a partir del cálculo" y el correo llega a `ALERTA_PARA` con asunto `[Sprint] Alerta COL-002: 4 hitos atrasados`.
3. Doble clic en `dist/index.html`: la franja avisa que así no funcionan la IA ni el correo; el resto sigue igual.
4. `npm test`: `tests/servidor.test.mjs` prueba los tres endpoints con clientes falsos (sin red ni claves), el filtrado del contexto, la validación del equipo y que no haya claves en el código ni en `dist/`.

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
- El HTML no carga fuentes, servicios ni analítica externos. Su política de contenido bloquea recursos externos y envíos de formularios, y solo permite conectarse con su propio origen (`connect-src 'self'`): el servidor local de `npm start`. Con doble clic no hay a dónde conectarse.

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

## Asistencia a la inducción (línea base 91%)
El 91% del dossier es la **asistencia a la inducción general**, no asistencia diaria al trabajo. Este módulo gestiona el 9% restante y mide si la persona estuvo la sesión completa:
- **Personas** define una sesión (fecha, inicio, término) y cita a una o varias personas; el día de la sesión registra la **hora de entrada y de salida**, o marca "no asistió".
- **Estado automático:** completa, parcial (llegó tarde o salió antes, con 15 min de tolerancia), no asistió, o "falta registrar" si la sesión pasó sin registro (no se supone la asistencia).
- **Colaborador** ve su citación, confirma o pide otro horario con un motivo cerrado (por ejemplo, choca con su turno).
- **Alertas:** a Personas (reprogramar, registrar, citar) y a la jefatura (inasistencia, para liberar el turno). La jefatura ve solo el estado, nunca las horas ni el motivo.
- **Indicador en vivo** contra la línea base de 91%. Parámetros en `src/induccion.js` (`CONFIG_INDUCCION`).
- No es control de asistencia laboral: ese registro exige un sistema certificado y reemplazaría el sistema de turnos.

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
