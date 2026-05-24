-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Estructura de costos del presupuesto (modelo Delphin/S10)
--
-- En el presupuesto de obra peruano el monto se arma en capas:
--   Costo Directo (CD)        = suma de los totales de todas las partidas
--   + Utilidades              = % del CD (típico 15%)
--   + Gastos Generales        = % del CD (típico 15%)
--   = Sub Total
--   + IGV                     = % del Sub Total (18%)
--   = Valor Referencial
--   + Otros gastos            = supervisión, gestión, control concurrente…
--   = Costo Total del Proyecto
--
-- Antes JARVEX solo guardaba `presupuesto_total` (un número suelto), lo
-- que hacía que la "coherencia presupuestal" comparara el CD (suma de
-- partidas) contra el Costo Total — dando diferencias engañosas de -34%.
--
-- Esta migración guarda la estructura para poder:
--   1) Configurar los % al crear la obra.
--   2) Calcular automáticamente el Costo Total al importar el APU.
--   3) Comparar la EJECUCIÓN real contra el Costo Directo (no el total).
--
-- Convención: `presupuesto_total` pasa a representar el Costo Total del
-- Proyecto (el número contractual grande). `costo_directo` es la base
-- de ejecución (contra la que se mide consumo/margen real).
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.obras
  ADD COLUMN IF NOT EXISTS costo_directo NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS utilidad_pct NUMERIC NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS gastos_generales_pct NUMERIC NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS igv_pct NUMERIC NOT NULL DEFAULT 18,
  ADD COLUMN IF NOT EXISTS otros_gastos JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.obras.costo_directo IS
  'Costo Directo = suma de los totales de las partidas. Base de ejecución contra la que se mide el consumo real.';
COMMENT ON COLUMN public.obras.utilidad_pct IS
  'Porcentaje de utilidad aplicado sobre el Costo Directo (típico 15).';
COMMENT ON COLUMN public.obras.gastos_generales_pct IS
  'Porcentaje de gastos generales/administrativos sobre el Costo Directo (típico 15).';
COMMENT ON COLUMN public.obras.igv_pct IS
  'Porcentaje de IGV sobre el Sub Total (18 en Perú).';
COMMENT ON COLUMN public.obras.otros_gastos IS
  'Array JSON de gastos extra que se suman al Valor Referencial: [{concepto, monto}]. Ej: supervisión, gestión, control concurrente.';

NOTIFY pgrst, 'reload schema';
