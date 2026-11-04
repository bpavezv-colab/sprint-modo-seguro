# AGENTS.md — Sprint · Onboarding Modo Seguro

Instrucciones para agentes de código (Codex u otros). Léelas completas antes de tocar el código.

## Contexto
- Hackathon Talent Tech Hack 2026, Prueba 2 "Operación MVP – Modo Seguro", temática Personas y organizaciones.
- Producto: checklist de ingreso con acceso seguro por rol. 4 usuarios (tarjetas oficiales): Colaborador, Jefatura, Equipo de Personas, TI. Administrador usa la vista de Personas.
- Datos: `data/*.csv` son 100 % sintéticos y la **fuente oficial** es el diccionario de datos. No inventes campos, categorías ni datos externos.
- Fecha de corte por defecto: `2026-11-04` (`HOY_DEFAULT` en `src/rules.js`).

## Arquitectura (vanilla JS, sin framework, sin backend)
| Archivo | Responsabilidad |
|---|---|
| `src/csv.js` | Parser CSV. Celda vacía → `null` (nunca `''`, `0`, `No`, `Pendiente`). |
| `src/rules.js` | Plazos del catálogo, `evaluarHito` (estado real), `avanceColaborador`, `validar` (reglas del diccionario). |
| `src/permissions.js` | Motor de permisos `crearAuth`: rol ∧ equipo_asignado ∧ permiso Sí/No ∧ tipo de responsabilidad. |
| `src/store.js` | Estado, acciones (`completar`, `reasignar`, `reportar`…), bitácora, persistencia en localStorage con try/catch. |
| `src/ui.js` | Render por rol (strings HTML + delegación de eventos). **Toda** visualización pasa por `auth`. |
| `src/styles.css` | Tokens de color en `:root` + modo oscuro. Usa siempre tokens. |
| `scripts/build.mjs` | CSV → `src/data.generated.js` → bundle esbuild → `dist/index.html` y `dist/artifact.html`. |
| `tests/core.test.mjs` | Tests con `node:test`. |

Comandos: `npm install` · `npm test` · `npm run build` (luego abre `dist/index.html` con doble clic).

## Reglas NO negociables (si un cambio las rompe, no lo hagas)
1. **Sin supuestos silenciosos.** Un vacío se muestra como "dato faltante" y genera alerta. No rellenes valores.
2. **Plazo efectivo = regla del catálogo** aplicada a `fecha_ingreso` (Antes del día 1 = −1, Día 1 = 0, Primera semana = +7). La `fecha_limite` registrada se muestra como referencia y nunca "perdona" un atraso.
3. **Cumplido sin fecha o con fecha futura = "Por verificar"**, no cuenta como cumplido.
4. **Acceso efectivo** = rol + `equipo_asignado` + permiso Sí/No + tipo de hito. Un "Sí" nunca da acceso global.
5. `canal_contacto`: solo el propio colaborador, Personas y Administrador. Nunca TI ni jefaturas.
6. TI: solo hitos `Equipo` y `Acceso`, sin nombre (`puede_ver_datos_personales = No`) ni canal. Reasigna solo entre cuentas TI.
7. Jefatura: solo su `equipo_asignado`; completa solo `Reunión`/`Plan` asignados a su cuenta; no ve reportes sensibles.
8. Colaborador: solo se ve a sí mismo; no edita hitos; no ve métricas.
9. **Toda acción y todo acceso denegado se registran** en la bitácora (`store.log`). No se puede editar `fecha_limite` desde la UI.
10. Reasignar exige motivo y confirmación explícita. Un responsable vacío **no** se asigna automáticamente.
11. Métricas agregadas cuando no se necesita identificar personas.
12. No usar `area`, `modalidad`, `dispositivo_principal` ni el atraso para evaluar desempeño o inferir atributos.

## Cómo trabajar
- Cambios de lógica → primero un test en `tests/` que falle, luego el código, luego `npm test`.
- No agregues dependencias de runtime (el HTML final debe funcionar offline con doble clic). Dev deps OK.
- No uses `alert()`, `confirm()` ni `prompt()`: usa `ui.confirm` (diálogo propio).
- Escapa todo texto dinámico con `esc()` en `ui.js`.
- Textos de la interfaz en español de Chile, claros, en voz activa. Sin jerga técnica para el colaborador.
- Antes de terminar: `npm test && npm run build` sin errores.
