# Sprint · Onboarding Modo Seguro

MVP para la Prueba 2 del Talent Tech Hack 2026 (Personas y organizaciones). Checklist de ingreso con acceso seguro por rol sobre los 4 CSV sintéticos del caso.

## Correr
- **Sin instalar nada:** abre `dist/index.html` con doble clic.
- **Desarrollo:** `npm install` → `npm test` → `npm run build`.

## Qué hace cada vista
| Rol | Ve | Puede hacer |
|---|---|---|
| Colaborador (móvil, sin correo corporativo: código de 6 dígitos, demo `123456`) | Sus 5 hitos, quién los gestiona, plazos, a quién pedir ayuda | Reportar "algo no coincide" (solo lo lee Personas) |
| Jefatura | Solo su `equipo_asignado`, próximos ingresos, métricas agregadas del equipo | Marcar Reunión/Plan asignados a su cuenta |
| TI | Solo hitos Equipo/Acceso, por código, sin nombres ni canal | Marcar entregado, tomar casos sin responsable, reasignar entre TI |
| Personas / Admin | Todo el proceso, calidad de datos, reportes, permisos, bitácora | Reasignar con motivo, cambiar fecha de corte, cargar CSV, exportar |

## Lo que detecta en los datos (fecha de corte 04-11-2026)
- 90 hitos atrasados según el catálogo; el archivo marca solo 35 (55 "Pendiente" con fecha límite movida).
- 26 "Cumplido" sin respaldo: 4 sin fecha y 22 con fecha futura.
- 7 hitos sin responsable; COL-019 sin jefatura ni equipo.
- `estado_onboarding` que no coincide con los hitos; vacíos en turno, canal y estado.
- Permisos del archivo que se acotan por mínimo privilegio (TI asignar/métricas).

## Manejo de errores y casos borde
Probado con 24 tests (`tests/core.test.mjs`, `tests/excepciones.test.mjs`) y pruebas en navegador:
- Rol desconocido o inconsistente → acceso denegado (no cae en ninguna vista por defecto).
- Carga de CSV con IDs duplicados, mal formados o con HTML/JS inyectado → rechazada completa, datos intactos.
- Almacenamiento del navegador corrupto o bloqueado → se descarta lo inválido y se avisa.
- Vacíos y fechas inválidas → alerta "dato faltante", nunca un valor inventado; las vistas siguen funcionando.
- Manipular la página para forzar acciones (completar hitos ajenos, entrar como colaborador por el acceso interno) → denegado y registrado.
- Cualquier error inesperado → pantalla de recuperación y registro en la bitácora, sin pantalla en blanco.

## Recorrido de demo (3 minutos)
1. **Camila Rojas (COL-002)** en el teléfono: 1 de 5 listo, 4 atrasos que no dependen de ella; envía "Mis tareas no coinciden".
2. **Felipe Jefatura 02**: ve solo a sus 5 personas; marca la Reunión de Camila; busca COL-006 → "fuera de tu alcance" (queda en la bitácora).
3. **Alex Soporte TI 04**: solo códigos, sin nombres; "Sin responsable" → toma HITO-033.
4. **Hugo Personas 01**: "el registro dice 35, en realidad son 90"; Calidad de datos; el reporte de Camila; la bitácora con todo lo anterior.

Ver `AGENTS.md` (reglas para Codex) y `CODEX_TASKS.md` (tareas listas para pegar).
