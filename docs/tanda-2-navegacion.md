# JARVEX — Tanda 2 de 3: navegación y flujo (independiente de la tanda 1)

## Contexto base (dar por sentado)
JARVEX es un ERP de obra offline-first. El arranque de sesión fija una "obra activa" en el encabezado para TODO usuario (paso 6 del flujo de login), incluidos roles cuyo trabajo es cross-obra (Admin, Contador Jefe, Ayudante Contab.). `companies` y `obras` ya son entidades hermanas en el modelo de datos — el problema es el punto de entrada, no el esquema. Esta tanda no depende de que exista la entidad `consorcio` (tanda 1); puede ejecutarse antes, después o en paralelo.

## 1. Split de entrada de primer nivel
- Pantalla principal con dos entradas de primer nivel hermanas: **Obras** y **Empresas**. Consorcios no es un tercer bloque hermano — cuelga de cada obra (ver tanda 1 si ya está aplicada; si no, dejar el gancho para cuando exista).
- **Roles obra-scoped** (Ingeniero, Residente, Seguridad, Almacenero y el resto de roles de campo): conservan el selector de "obra activa" en el encabezado tal cual funciona hoy. No tocar este flujo.
- **Roles cross-obra** (Admin, Contador Jefe, Ayudante Contab., y el futuro rol de Desarrollo comercial — mapea al rol "Licitaciones" existente, hoy sin cuentas activas): sacarlos del paso "fijar obra de trabajo" del arranque. Reciben su propio punto de entrada (Empresas / vista de grupo / Obras en modo lectura general) sin obra fija de fondo.

## 2. Atajos de navegación contextuales
- Hoy la barra lateral muestra accesos rápidos a todas las secciones sin importar relación con la pantalla activa. Cambiar a: atajos solo entre secciones relacionadas con la sección actual, más un acceso claro y siempre visible para volver a la pantalla principal.

## Roles (para referencia al ajustar rutas y menús)
- Administrador: control total del grupo.
- Contador Jefe / jefa de contabilidad: mismo nivel de acceso que administrador, pero limitado a su área (contabilidad), con visibilidad global dentro de ella (todas las empresas, todos los consorcios/obras).
- Asistentes contables: ámbito asignado por la jefa (empresas/obras específicas).
- Desarrollo comercial (rol "Licitaciones"): busca obras, consultorías y bienes/servicios.
- Personal de obra: separado en Ejecución y Supervisión — no fusionar.

## Condición no negociable
Cualquier cambio de qué rol ve o no ve qué pantalla debe reflejarse en espejo en RLS de Postgres, no solo en el cliente/menú.
