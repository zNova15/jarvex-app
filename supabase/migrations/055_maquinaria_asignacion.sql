-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Maquinaria: control de custodia (salida/devolución)
--
-- Los equipos pesados con placa "simplemente existen" + mantenimiento, pero
-- faltaba registrar a QUIÉN se le entrega cada equipo (personal o
-- subcontratista), CUÁNDO y con qué PRUEBA FÍSICA (foto). Modelo de custodia:
--   • salida    = asignación: el equipo queda "en uso por X" desde la fecha.
--   • entrada   = devolución: el equipo vuelve a estar disponible.
-- El historial vive en movimientos_maquinaria (reusada); el estado actual de
-- custodia se denormaliza en activos_pesados para mostrarlo en la lista.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.movimientos_maquinaria
  ADD COLUMN IF NOT EXISTS subcontratista_id UUID,   -- destino si es subcontrato
  ADD COLUMN IF NOT EXISTS evidencia_id      UUID,   -- foto / prueba física del movimiento
  ADD COLUMN IF NOT EXISTS destino_tipo      TEXT;   -- 'personal' | 'subcontratista'

-- Una asignación/devolución de un equipo con placa no tiene "cantidad".
ALTER TABLE public.movimientos_maquinaria ALTER COLUMN cantidad DROP NOT NULL;

ALTER TABLE public.activos_pesados
  ADD COLUMN IF NOT EXISTS asignado_a_tipo   TEXT,   -- 'personal' | 'subcontratista' | null (disponible)
  ADD COLUMN IF NOT EXISTS asignado_a_id     UUID,
  ADD COLUMN IF NOT EXISTS asignado_a_nombre TEXT,   -- denormalizado para la lista
  ADD COLUMN IF NOT EXISTS fecha_asignacion  DATE;

COMMENT ON COLUMN public.activos_pesados.asignado_a_id IS
  'Custodia actual: a quién está asignado el equipo (null = disponible). Se setea en salida y se limpia en devolución.';

NOTIFY pgrst, 'reload schema';
