-- ═══════════════════════════════════════════════════════════════════
-- 168 — guia_factura.idempotency_key deja de ser UNIQUE global
--
-- Hallazgo de la inspección del 1-sep (agentes de sync y de guías): el key es
-- determinista por par (`gf_<guia>_<mov>`) y el UNIQUE era GLOBAL, así que el
-- tombstone de un vínculo desvinculado lo retenía para siempre: re-vincular el
-- mismo par creaba una fila nueva → INSERT 23505 → FAILED, y el self-heal la
-- reintentaba cada 10 min eternamente (el vínculo solo existía en el device
-- que lo creó). El cliente ya resucita el tombstone LOCAL (23c86e1), pero los
-- tombstones se purgan de Dexie en el pull — cuando el local ya no está, el
-- choque volvía por el server.
--
-- El dedup REAL de esta tabla es uq_guia_factura_par (UNIQUE parcial del par
-- WHERE deleted_at IS NULL, mig 165): dos vínculos vivos del mismo par siguen
-- siendo imposibles. El key queda como identificador de trazabilidad, con
-- índice simple para las búsquedas del SyncEngine.
-- ═══════════════════════════════════════════════════════════════════

-- El UNIQUE inline se auto-nombra: borrar por búsqueda, no por nombre
-- adivinado (misma lección de la mig 164).
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = rel.relnamespace
     WHERE ns.nspname = 'public' AND rel.relname = 'guia_factura'
       AND con.contype = 'u'
       AND EXISTS (
         SELECT 1 FROM unnest(con.conkey) k
         JOIN pg_attribute a ON a.attrelid = rel.oid AND a.attnum = k
         WHERE a.attname = 'idempotency_key')
  LOOP
    EXECUTE format('ALTER TABLE public.guia_factura DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_guia_factura_idem ON public.guia_factura (idempotency_key);

NOTIFY pgrst, 'reload schema';
