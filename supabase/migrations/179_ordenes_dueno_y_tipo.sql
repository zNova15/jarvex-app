-- ═══════════════════════════════════════════════════════════════════
-- 179 — ÓRDENES CON DUEÑO Y CON TIPO (tanda 5, B1)
--
-- EL PROBLEMA, medido el 4-sep-2026 contra producción:
--
--     ordenes_compra ............................  0 filas
--     oc_items ..................................  0
--     accounting_movements.orden_compra_id lleno .  0 de 1.378
--
-- El circuito de órdenes existe desde la mig 022 y NUNCA se usó ni una vez.
-- Gabriel: «no encuentro las órdenes de compra ni las de servicio». No las
-- encontró porque la tabla tiene tres huecos que la vuelven inservible para
-- lo que él necesita:
--
--   1. NO TIENE DUEÑO. Solo `obra_id`. Una orden no puede decir qué empresa
--      del grupo la emite — y son 8 empresas propias, cada una con su RUC,
--      su logo y su numeración. Sin `company_id` no hay ni plantilla ni
--      correlativo posibles.
--   2. NO EXISTE EL TIPO. La ORDEN DE SERVICIO no existe como concepto.
--      El modelo que dejó Gabriel (Modelos/ordenes.xlsx) son dos hojas con
--      el MISMO cuerpo y distinto título/etiqueta: «Descripción» vs
--      «Descripción del servicio», «IMPORTE TOTAL DE LA COMPRA» vs «…DEL
--      SERVICIO». Es un campo, no una tabla nueva.
--   3. EL DOCUMENTO NO ENTRA. El modelo tiene bloques que hoy no tienen
--      dónde guardarse: el contrato/CUI de la obra, el título de rubro
--      («MATERIAL FERRETERIA»), los datos de pago y despacho (banco, cuenta,
--      CCI, lugar y fecha de entrega) y las notas al proveedor. Se emitían a
--      mano en Excel justamente porque la app no los tiene.
--
-- Y un cuarto, que es el que desbloquea la emisión retroactiva:
--   4. `obra_id` era NOT NULL. Un trabajo de bienes/servicios (mig 174) no
--      es una obra: sus órdenes no tenían dónde vivir.
--
-- QUÉ NO CAMBIA: `accounting_movements.orden_compra_id` ya existe desde la
-- mig 041. No hay que inventar el vínculo factura↔orden, hay que LLENARLO.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Dueño, tipo y destino ───────────────────────────────────────
ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id);
ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'compra';
ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS trabajo_id uuid REFERENCES trabajos(id);

ALTER TABLE ordenes_compra DROP CONSTRAINT IF EXISTS ordenes_compra_tipo_check;
ALTER TABLE ordenes_compra ADD CONSTRAINT ordenes_compra_tipo_check
  CHECK (tipo = ANY (ARRAY['compra','servicio']));

-- Una orden de un trabajo de bienes/servicios no tiene obra. Con NOT NULL,
-- ese caso simplemente no se podía registrar.
ALTER TABLE ordenes_compra ALTER COLUMN obra_id DROP NOT NULL;

-- ── 2. El documento del modelo ─────────────────────────────────────
-- Cabecera y contexto
ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS titulo text;              -- «MATERIAL FERRETERIA»
ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS obra_descripcion text;    -- el nombre largo de la inversión
ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS contrato_ref text;        -- «Contrato N° 35-2025/… | CUI 2302964»
ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS ejecutor_ref text;        -- «CONSORCIO EL INCA (RUC …) | Rep. Legal …»

-- Proveedor: snapshot. Una orden retroactiva nace de un comprobante donde el
-- proveedor es un NOMBRE + RUC, no siempre una fila de `proveedores`.
ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS proveedor_nombre text;
ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS proveedor_ruc text;
ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS proveedor_direccion text;

-- Bloque «DATOS DE PAGO Y DESPACHO» del modelo
ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS banco text;
ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS cuenta_numero text;
ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS cuenta_cci text;
ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS fecha_pago_ref text;      -- «A la entrega de todo el material»
ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS lugar_entrega text;
ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS fecha_entrega_ref text;   -- «Según necesidad en campo»
ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS notas_proveedor text;
ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS igv_pct numeric(5,2) NOT NULL DEFAULT 18;

-- ── 3. Emisión retroactiva ─────────────────────────────────────────
-- De qué comprobante nació esta orden. Es el ESPEJO de
-- accounting_movements.orden_compra_id: la app escribe los dos lados en la
-- misma operación, y este lado es el que permite detectar un doble respaldo
-- (dos órdenes emitidas para la misma factura) sin recorrer los movimientos.
ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS accounting_movement_id uuid REFERENCES accounting_movements(id);
ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS emitida_retroactiva boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_oc_company ON ordenes_compra(company_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_oc_tipo    ON ordenes_compra(tipo)       WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_oc_trabajo ON ordenes_compra(trabajo_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_oc_mov     ON ordenes_compra(accounting_movement_id) WHERE deleted_at IS NULL;

-- Una factura, una orden viva. Sin esto, dos tabs de la emisión masiva o dos
-- devices offline emiten dos órdenes para el mismo comprobante y el respaldo
-- queda duplicado — el mismo tipo de duplicado que ya nos pasó en almacén.
CREATE UNIQUE INDEX IF NOT EXISTS uq_oc_por_movimiento
  ON ordenes_compra(accounting_movement_id)
  WHERE accounting_movement_id IS NOT NULL
    AND deleted_at IS NULL
    AND estado NOT IN ('anulada','cancelada');

-- ── 4. Numeración por empresa, tipo y año ──────────────────────────
-- El correlativo del modelo es `OC-001-2026` / `OS-001-2026` y es POR EMPRESA:
-- CONSORCIO EL INCA va por la 027 mientras JARVEX recién empieza. Guardarlo
-- como número (y no solo dentro del `codigo`) es lo que permite que el
-- siguiente se calcule sin parsear texto.
ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS correlativo integer;
ALTER TABLE ordenes_compra ADD COLUMN IF NOT EXISTS anio integer;

CREATE UNIQUE INDEX IF NOT EXISTS uq_oc_correlativo
  ON ordenes_compra(company_id, tipo, anio, correlativo)
  WHERE company_id IS NOT NULL AND correlativo IS NOT NULL AND deleted_at IS NULL;

-- ── 5. El umbral, configurable (B4) ────────────────────────────────
-- S/ 2.000, el número que propuso Gabriel: con el 17% de los comprobantes de
-- compra se respalda el 97% del monto. Va a app_config (mig 159) para que se
-- pueda mover sin tocar código.
-- `valor` es jsonb y `id` no tiene default (mig 159): los dos se dan a mano.
INSERT INTO app_config (id, clave, valor)
SELECT gen_random_uuid(), 'orden_umbral_monto', to_jsonb(2000)
WHERE NOT EXISTS (SELECT 1 FROM app_config WHERE clave = 'orden_umbral_monto' AND deleted_at IS NULL);

NOTIFY pgrst, 'reload schema';
