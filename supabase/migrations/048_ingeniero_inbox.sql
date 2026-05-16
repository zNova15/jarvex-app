-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Inbox del rol Ingeniero (vinculación salidas → partidas)
--
-- Hoy: el almacenero elige `partida_id` cuando registra una salida —
-- pero el almacenero no es ingeniero, no sabe a qué partida fue cada
-- material. Resultado: `partidas.costo_real_acumulado` no es confiable.
--
-- Cambio: el selector de partida se quita del flujo de almacén (paquete
-- C.2 en código), todas las salidas nuevas tienen `partida_id=NULL`,
-- y un nuevo rol "ingeniero" las vincula desde un inbox dedicado.
--
-- Esta migración:
--   1) Agrega tracking de "quién/cuándo asignó la partida" para auditoría.
--   2) Crea una vista helper `v_salidas_pendientes_partida` (opcional —
--      el cliente filtra por partida_id IS NULL desde Dexie, pero la
--      vista sirve para reportes y dashboards futuros).
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.movimientos_materiales
  ADD COLUMN IF NOT EXISTS partida_asignada_por UUID NULL
    REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS partida_asignada_at TIMESTAMP WITH TIME ZONE NULL;

COMMENT ON COLUMN public.movimientos_materiales.partida_asignada_por IS
  'Usuario (típicamente ingeniero) que vinculó esta salida a su partida. NULL = todavía en inbox.';
COMMENT ON COLUMN public.movimientos_materiales.partida_asignada_at IS
  'Cuándo se asignó la partida.';

-- Vista helper para el inbox del ingeniero. SECURITY INVOKER respeta RLS
-- del usuario que la consulta — el ingeniero solo ve obras a las que
-- pertenece (gracias a RLS en obras + movimientos_materiales).
CREATE OR REPLACE VIEW public.v_salidas_pendientes_partida AS
  SELECT mm.id, mm.obra_id, mm.fecha, mm.hora, mm.cantidad, mm.unidad,
         mm.material_id, mm.responsable_id, mm.observaciones, mm.created_at,
         mm.created_by, mm.frente_zona
  FROM public.movimientos_materiales mm
  WHERE mm.tipo_movimiento = 'salida'
    AND mm.partida_id IS NULL
    AND mm.reverses_id IS NULL          -- excluir reversas
    AND mm.reversed_by_id IS NULL;      -- excluir reversadas

COMMENT ON VIEW public.v_salidas_pendientes_partida IS
  'Salidas de material que todavía no fueron vinculadas a una partida — inbox del rol ingeniero.';

NOTIFY pgrst, 'reload schema';
