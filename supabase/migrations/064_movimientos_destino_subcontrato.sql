-- 064: Atribuir movimientos de insumos a personal O subcontrato (Fase B)
-- ---------------------------------------------------------------------------
-- Hasta ahora movimientos_materiales / movimientos_herramientas /
-- movimientos_insumos_emergencia solo podían atribuir una salida a un
-- responsable_id (FK a personal) o quedaba en texto libre (frente_zona /
-- observaciones). Eso permitió que se registrara un nombre ficticio
-- ("Frente de Linea de conduccion") en vez de un destino real.
--
-- Replicamos el patrón polimórfico que ya usan movimientos_epp (mig 059) y
-- movimientos_maquinaria (mig 055): destino_tipo + subcontratista_id, para que
-- TODA salida quede atribuida a una persona real o a un subcontrato real.
-- Aditivo y nullable: los movimientos existentes no cambian.

ALTER TABLE movimientos_materiales
  ADD COLUMN IF NOT EXISTS subcontratista_id UUID REFERENCES subcontratistas(id),
  ADD COLUMN IF NOT EXISTS destino_tipo TEXT
    CHECK (destino_tipo IS NULL OR destino_tipo IN ('personal', 'subcontratista'));

ALTER TABLE movimientos_herramientas
  ADD COLUMN IF NOT EXISTS subcontratista_id UUID REFERENCES subcontratistas(id),
  ADD COLUMN IF NOT EXISTS destino_tipo TEXT
    CHECK (destino_tipo IS NULL OR destino_tipo IN ('personal', 'subcontratista'));

ALTER TABLE movimientos_insumos_emergencia
  ADD COLUMN IF NOT EXISTS subcontratista_id UUID REFERENCES subcontratistas(id),
  ADD COLUMN IF NOT EXISTS destino_tipo TEXT
    CHECK (destino_tipo IS NULL OR destino_tipo IN ('personal', 'subcontratista'));

NOTIFY pgrst, 'reload schema';
