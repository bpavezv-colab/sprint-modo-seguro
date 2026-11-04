# Tareas para Codex (copiar y pegar, una por vez)

Cada tarea es independiente y cabe en un PR chico. Orden sugerido = prioridad para la demo.
Siempre termina con `npm test && npm run build`.

---

## T1 · Prueba de acceso indebido en vivo (demo "Modo Seguro") — 20 min
> En `src/ui.js`, agrega a la vista de TI y a la de Colaborador un botón discreto "Probar acceso indebido" que intente abrir datos fuera de alcance (TI: `canal_contacto` de COL-002; Colaborador: la ficha de COL-014) usando `store.verColaborador` / `auth.puedeVerCampo`. Debe mostrar un aviso "Acceso denegado: fuera de tu alcance" y quedar en la bitácora como `acceso_denegado`. Agrega un test en `tests/core.test.mjs` que verifique que TI no puede ver `canal_contacto`. No cambies reglas de `AGENTS.md`.

## T2 · Alertas accionables para la jefatura — 30 min
> En la vista de Jefatura, agrega una sección "Alertas" arriba de "Tus acciones" que liste, para su equipo, hitos vencidos de otras áreas (TI/Personas) con texto del tipo "Acceso de Camila Rojas atrasado 58 días · lo gestiona Soporte TI". Solo lectura, sin `responsable_id` ni canal. Ordena por días de atraso y criticidad (`CRIT_PESO`). Agrega test de que una jefatura no ve alertas de personas fuera de su equipo.

## T3 · Escalar un caso desde Personas — 30 min
> En `src/store.js` crea `escalar(hitoId, motivo)` (solo Personas/Admin vía `auth.puedeVerCalidad`) que agregue el hito a `state.escalados` con fecha y motivo, y lo registre en la bitácora. En "Casos críticos" agrega botón "Escalar" por hito vencido con criticidad Alto y un filtro "Solo escalados". Persistir `escalados` junto al resto del estado. Tests incluidos.

## T4 · Comparar cumplimiento por sede y área (agregado) — 25 min
> En la pestaña Resumen de Personas, agrega un selector "Agrupar por: Área | Sede | Modalidad" que recalcule el heatmap de cumplimiento real. Solo porcentajes agregados; si un grupo tiene menos de 3 personas, muestra "n<3" en vez del porcentaje (minimización). Test para la regla n<3.

## T5 · Accesibilidad del colaborador — 20 min
> Revisa `vColaborador` en `src/ui.js`: tamaños táctiles ≥ 44 px, contraste AA en ambos temas (`src/styles.css` tokens), `aria-live` para el toast, y que todo funcione solo con teclado. No cambies la lógica.

## T6 · Export de alertas de calidad — 15 min
> En la pestaña "Calidad de datos" agrega "Copiar alertas (CSV)" con columnas `regla,severidad,entidad,id,detalle,accion` usando `toCSV` de `src/csv.js`. Mismo patrón de copia que la bitácora (clipboard con fallback a textarea).

## T7 · Validación de carga más estricta — 25 min
> En `onSubmit` → `carga` (`src/ui.js`) y/o `rules.validar`: antes de aceptar archivos nuevos, rechaza si hay `colaborador_id` o `hito_id` duplicados o si algún `hitos.colaborador_id` no existe; muestra la lista de errores y no reemplaces los datos. Tests con un CSV de ejemplo malo en `tests/fixtures/`.

---

### Prompt base (pégalo antes de cualquier tarea)
> Trabajas en el repo "Sprint · Onboarding Modo Seguro". Lee AGENTS.md y respeta las reglas no negociables. Haz cambios mínimos y enfocados, agrega o actualiza tests, y corre `npm test && npm run build`. Explica en 3 bullets qué cambiaste y cómo probarlo en la demo.
