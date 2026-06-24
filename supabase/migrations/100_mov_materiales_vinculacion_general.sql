-- 100: vinculación GENERAL al frente para salidas de material.
--
-- El ingeniero, en "Vinculación de insumos", vincula cada salida a una partida.
-- Pero hay insumos usados en el frente que NO corresponden a ninguna partida del
-- presupuesto (ej. un bidón de agua). Para esos, se marca vinculacion_general=true
-- (con partida_id=null): "usado en el frente, fuera de presupuesto". Distingue ese
-- caso intencional de una salida simplemente "sin vincular".
ALTER TABLE public.movimientos_materiales
  ADD COLUMN IF NOT EXISTS vinculacion_general boolean DEFAULT false;
