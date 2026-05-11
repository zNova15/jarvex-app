-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Agregar columnas reverses_id / reversed_by_id
--
-- Sentry JARVEX-APP-8 (evt 13) + JARVEX-APP-4 (evt 5), release
-- jarvex@1095bb8: PGRST204 al reversar un movimiento.
--
-- jx-movimientos.jsx implementa "Reversar movimiento": crea un mov
-- nuevo con tipo opuesto y lo vincula al original con:
--   - reverses_id     → en el reverso, apunta al mov original.
--   - reversed_by_id  → en el original, apunta al reverso.
--
-- Estas columnas faltan en server. Movimientos son inmutables pero
-- la relación de reverso sí necesita persistirse.
-- ═══════════════════════════════════════════════════════════════════

-- ── movimientos_materiales ──────────────────────────────────────────
ALTER TABLE public.movimientos_materiales
  ADD COLUMN IF NOT EXISTS reverses_id     UUID,
  ADD COLUMN IF NOT EXISTS reversed_by_id  UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE table_schema = 'public'
                   AND table_name = 'movimientos_materiales'
                   AND constraint_name = 'movimientos_materiales_reverses_id_fkey') THEN
    ALTER TABLE public.movimientos_materiales
      ADD CONSTRAINT movimientos_materiales_reverses_id_fkey
      FOREIGN KEY (reverses_id) REFERENCES public.movimientos_materiales(id)
      ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE table_schema = 'public'
                   AND table_name = 'movimientos_materiales'
                   AND constraint_name = 'movimientos_materiales_reversed_by_id_fkey') THEN
    ALTER TABLE public.movimientos_materiales
      ADD CONSTRAINT movimientos_materiales_reversed_by_id_fkey
      FOREIGN KEY (reversed_by_id) REFERENCES public.movimientos_materiales(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- Mismo patrón para movimientos_herramientas (por consistencia, aunque
-- el bug solo apareció en materiales).
ALTER TABLE public.movimientos_herramientas
  ADD COLUMN IF NOT EXISTS reverses_id     UUID,
  ADD COLUMN IF NOT EXISTS reversed_by_id  UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE table_schema = 'public'
                   AND table_name = 'movimientos_herramientas'
                   AND constraint_name = 'movimientos_herramientas_reverses_id_fkey') THEN
    ALTER TABLE public.movimientos_herramientas
      ADD CONSTRAINT movimientos_herramientas_reverses_id_fkey
      FOREIGN KEY (reverses_id) REFERENCES public.movimientos_herramientas(id)
      ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE table_schema = 'public'
                   AND table_name = 'movimientos_herramientas'
                   AND constraint_name = 'movimientos_herramientas_reversed_by_id_fkey') THEN
    ALTER TABLE public.movimientos_herramientas
      ADD CONSTRAINT movimientos_herramientas_reversed_by_id_fkey
      FOREIGN KEY (reversed_by_id) REFERENCES public.movimientos_herramientas(id)
      ON DELETE SET NULL;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
