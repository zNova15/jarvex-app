# JARVEX — Tanda 1 de 3: modelo de datos (consorcio y bienes/servicios)

## Contexto base (dar por sentado)
JARVEX es un ERP de obra offline-first (PWA React 19 + Dexie/IndexedDB local, Supabase/Postgres con RLS como servidor). ~123 tablas/vistas, 52 apuntan a `obra_id`. `companies` (empresas del grupo) y `obras` ya son entidades independientes hermanas en el bloque "Maestros" — no reconstruir eso. Esta tanda es solo modelo de datos: no tocar navegación ni el consolidado todavía (van en tandas 2 y 3 aparte).

Migración incremental, sin perder ningún dato existente.

## 1. Consorcio como entidad propia (hoy modelado mal, como si fuera empresa)
- Nueva entidad `consorcio`: nace cuando se gana la buena pro de una obra específica, queda inactivo/disuelto al terminar la obra. Es 1:1 con la obra que ejecuta, no una entidad reusable del catálogo del grupo — cuelga de la obra, no vive como hermano de `companies`.
- Lleva contabilidad independiente: RUC propio, y el mismo set de libros que ya existe para una empresa individual (registro de ventas, registro de compras, libro diario, libro caja, EE.FF.), aplicado al consorcio.
- Migración: identificar los registros actuales donde un consorcio está guardado dentro de `companies` y moverlos a la nueva entidad `consorcio`, preservando su historial contable completo.

## 2. Dos relaciones con terceros — mantenerlas separadas (confirmado, no fusionar)
- **Socio de consorcio**: empresa (propia del grupo o tercera) que participa en un consorcio aportando capital o experiencia. Sin manejo de su contabilidad, sin personal de ejecución. Solo entidad de participación con su % dentro del consorcio.
- **Subcontratista**: ya existe en el modelo (`subcontratistas` → `subcontratos`, ligado a `personal`). Aporta mano de obra ejecutora, entra a EPP e inducción, se paga por valorización de subcontrato, no por planilla. No tocar su relación con `personal`, `asistencia`, `epp_entregas`, `subcontrato_valorizaciones`.

## 3. Bienes y servicios como tipo de trabajo
- Nuevo tipo dentro de la taxonomía de "trabajo", junto a obra y supervisión, con flujo corto propio (no las etapas de expediente técnico/ejecución de una obra): cotización → compra → venta (bienes), o prestación directa del servicio por el grupo o vía una empresa específica (servicios).
- Responsable único asignado, sin la disgregación de personal de campo que sí llevan las obras.

## Taxonomía de trabajo resultante (para referencia, no requiere cambio de código aparte)
Ejes: naturaleza (obra ejecutar / obra expediente+ejecución / supervisión expediente+ejecución / supervisión sola / bienes y servicios) × origen (público, mayoría / privado) × etapa (planificación / ejecución / terminada — no aplica a bienes y servicios) × ejecutor (consorcio o empresa directa).

## Condiciones de migración
- Cambios de esquema incrementales (columnas/tablas nuevas primero), con pantalla de revisión antes de aplicar cualquier reclasificación masiva de `companies` → `consorcio`.
- No perder personal, empresas, usuarios ni movimientos contables existentes.
