-- ═══════════════════════════════════════════════════════════════════
-- 226 — LA REQUISICIÓN QUE ESCRIBE EL SIMULADOR
--       (tanda 4 de docs/plan-simulador-ordenes.md, 22-set-2026)
--
-- ── POR QUÉ NO HAY TABLA NUEVA ────────────────────────────────────
-- El §7 del plan es explícito: «no crear una tabla nueva de modelos de
-- orden». `requisiciones` + `requisicion_items` ya tienen obra_id,
-- partida_id, fecha_necesidad, prioridad, estado, y el puente a la orden ya
-- construido en los dos sentidos (`requisiciones.oc_id`/`oc_codigo` y
-- `oc_items.requisicion_item_id`). Al 22-set-2026 tienen 4 y 12 filas: están
-- SIN USAR, no mal diseñadas.
--
-- Esta migración agrega TRES cosas y ninguna es una tabla.
--
-- ── 1) `origen` / `origen_ref`: de dónde salió esta requisición ────
-- Una requisición que escribió el simulador no es la misma cosa que una que
-- pidió el residente desde el frente, y la diferencia tiene que sobrevivir a
-- que alguien mire la tabla dentro de un año. `origen` dice quién la escribió
-- ('simulador', 'simulador_sobre', o NULL = a mano, que es todo lo que hay
-- hoy) y `origen_ref` guarda el id de la propuesta del escenario
-- (`2026-10|material`) para poder volver a encontrarla desde la pantalla.
--
-- `origen_ref` es lo que hace que el simulador NO PIDA DOS VECES: la próxima
-- corrida lee las requisiciones vivas de la obra y descuenta sus líneas antes
-- de proponer. Sin esa marca, volver a abrir la pantalla en noviembre
-- propondría de nuevo todo lo que ya se requisó en octubre.
--
-- ── 2) `requisicion_items.insumo_codigo`: contra qué se descuenta ──
-- El descuento del §7 se hace por CÓDIGO DE INSUMO del presupuesto — es la
-- misma llave que ya usa `oc_items.insumo_codigo` (mig anterior) y la que
-- lee `coberturaPrevia()` en `src/lib/simulador-ordenes.js`. `requisicion_items`
-- no la tenía: solo `insumo_id` (uuid del catálogo de la empresa), que es
-- OTRO vocabulario (ver CLAUDE.md § «tres tablas de mapeo»). Guardar el
-- código del expediente al lado del uuid del catálogo no los mezcla: son dos
-- llaves de dos árboles distintos y las dos hacen falta.
--
-- Medido el 22-set-2026, esto es lo que hoy NO se puede descontar: las 14
-- órdenes emitidas de Miraflores tienen `insumo_codigo` NULL en sus 62 líneas
-- (el 100%), porque son retroactivas. El motor ya las cuenta aparte en
-- `resumen.ocSinImputar` en vez de asumir cero. Las requisiciones que escriba
-- el simulador SÍ nacen con código, así que el descuento funciona desde la
-- primera.
--
-- ── 3) El CHECK de `tipo_insumo` no admitía 'servicio' ────────────
-- `requisicion_items_tipo_insumo_check` permite material / herramienta / epp
-- / emergencia / maquinaria. El simulador clasifica en material, herramienta,
-- epp, maquinaria y SERVICIO (§4 del plan: adentro de `equipo` conviven la
-- compresora que se alquila y los zapatos que se compran).
--
-- Cuánto pesa el agujero, medido sobre Miraflores el 22-set-2026:
--   · alquileres por hora-máquina (`hm`)          S/   843.850
--   · servicios cargados como `material` por texto S/  304.365
--   · el resto de `equipo` con texto de servicio   S/     5.000
--   ──────────────────────────────────────────────────────────────
--   ≈ S/ 1,15 M de los ~S/ 4,98 M comprables = el 23% del plan
--
-- Sin este ALTER, ese 23% se guarda bien en Dexie —que no valida CHECKs— y
-- REBOTA en el push con un 23514, dejando el sync en reintento eterno. Es
-- exactamente el modo de falla que la regla 9 de CLAUDE.md describe para
-- `insumo_categoria`, y por eso se arregla en el servidor antes de que la
-- app pueda escribir una sola fila de servicio.
--
-- 'emergencia' se conserva aunque no lo use nadie: sacarlo invalidaría filas
-- existentes y no gana nada.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1) de dónde salió ─────────────────────────────────────────────
ALTER TABLE requisiciones
  ADD COLUMN IF NOT EXISTS origen     text,
  ADD COLUMN IF NOT EXISTS origen_ref text;

COMMENT ON COLUMN requisiciones.origen IS
  'Quién escribió esta requisición: ''simulador'' (plan por presupuesto), ''simulador_sobre'' (descripción libre contra el techo de una partida-sobre) o NULL (cargada a mano).';
COMMENT ON COLUMN requisiciones.origen_ref IS
  'Id de la propuesta del escenario que la originó (ej. ''2026-10|material'' o ''sobre:herramientas manuales|%mo''). Es lo que permite volver a encontrarla y no pedirla dos veces.';

-- Las corridas del simulador filtran por obra + origen. Sin esto, cada
-- apertura de la pantalla barre la tabla entera.
CREATE INDEX IF NOT EXISTS idx_requisiciones_obra_origen
  ON requisiciones (obra_id, origen)
  WHERE deleted_at IS NULL;

-- ── 2) contra qué se descuenta ────────────────────────────────────
ALTER TABLE requisicion_items
  ADD COLUMN IF NOT EXISTS insumo_codigo text;

COMMENT ON COLUMN requisicion_items.insumo_codigo IS
  'Código del insumo en el PRESUPUESTO del expediente (mismo vocabulario que oc_items.insumo_codigo e insumos_partida.insumo_codigo). NO es el catálogo de la empresa: ése es insumo_id.';

CREATE INDEX IF NOT EXISTS idx_requisicion_items_insumo_codigo
  ON requisicion_items (insumo_codigo)
  WHERE deleted_at IS NULL AND insumo_codigo IS NOT NULL;

-- ── 3) los servicios también se requisan ──────────────────────────
ALTER TABLE requisicion_items
  DROP CONSTRAINT IF EXISTS requisicion_items_tipo_insumo_check;

ALTER TABLE requisicion_items
  ADD CONSTRAINT requisicion_items_tipo_insumo_check
  CHECK (tipo_insumo = ANY (ARRAY[
    'material'::text, 'herramienta'::text, 'epp'::text,
    'emergencia'::text, 'maquinaria'::text, 'servicio'::text
  ]));
