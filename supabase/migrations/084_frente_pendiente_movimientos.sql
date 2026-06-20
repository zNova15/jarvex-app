-- 084: marcador "frente pendiente" en las 5 tablas de movimiento (S2).
-- El frente es OBLIGATORIO en salidas; si el almacenero no lo sabe al momento,
-- guarda con frente_pendiente=true y frente_id=null, y aparece en un aviso de
-- urgencia para completarlo el mismo día. Aditivo, no indexado en Dexie.

ALTER TABLE public.movimientos_materiales         ADD COLUMN IF NOT EXISTS frente_pendiente boolean DEFAULT false;
ALTER TABLE public.movimientos_herramientas       ADD COLUMN IF NOT EXISTS frente_pendiente boolean DEFAULT false;
ALTER TABLE public.movimientos_epp                ADD COLUMN IF NOT EXISTS frente_pendiente boolean DEFAULT false;
ALTER TABLE public.movimientos_maquinaria         ADD COLUMN IF NOT EXISTS frente_pendiente boolean DEFAULT false;
ALTER TABLE public.movimientos_insumos_emergencia ADD COLUMN IF NOT EXISTS frente_pendiente boolean DEFAULT false;

NOTIFY pgrst, 'reload schema';
