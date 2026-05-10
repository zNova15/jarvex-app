-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Agregar columnas faltantes a obras
--
-- Causa: el formulario de crear/editar obra en jx-obra.jsx setea
-- `ejecutora_tipo`, `ejecutora_company_id`, `consorcio_nombre` y
-- `consorcio_miembros` en el record local. Cuando el SyncEngine
-- pushea al server, PostgREST devuelve:
--   PGRST204 "Could not find the 'consorcio_miembros' column of 'obras'"
-- y el record queda en FAILED tras 5 retries (Sentry JARVEX-APP-8).
-- El otro admin nunca ve la obra creada.
--
-- Estas columnas representan la "ejecutora" de la obra:
--   - ejecutora_tipo='empresa' → ejecutora_company_id apunta a la empresa
--   - ejecutora_tipo='consorcio' → consorcio_nombre + consorcio_miembros
--     (jsonb con [{company_id, participacion_pct}])
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.obras
  ADD COLUMN IF NOT EXISTS ejecutora_tipo TEXT DEFAULT 'empresa',
  ADD COLUMN IF NOT EXISTS ejecutora_company_id UUID,
  ADD COLUMN IF NOT EXISTS consorcio_nombre TEXT,
  ADD COLUMN IF NOT EXISTS consorcio_miembros JSONB;

-- FK opcional a companies (si la tabla existe). NO usamos CASCADE para
-- no perder la obra si se borra una empresa.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'companies')
     AND NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                     WHERE table_schema = 'public'
                       AND table_name = 'obras'
                       AND constraint_name = 'obras_ejecutora_company_id_fkey') THEN
    ALTER TABLE public.obras
      ADD CONSTRAINT obras_ejecutora_company_id_fkey
      FOREIGN KEY (ejecutora_company_id)
      REFERENCES public.companies(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- Índice para queries que filtran por ejecutora (dashboard ejecutivo, etc.)
CREATE INDEX IF NOT EXISTS idx_obras_ejecutora_company_id
  ON public.obras(ejecutora_company_id)
  WHERE ejecutora_company_id IS NOT NULL;

-- Forzar reload del schema cache de PostgREST. Sin esto, las nuevas
-- columnas siguen invisibles para el REST API durante varios minutos.
NOTIFY pgrst, 'reload schema';

-- ✓ Listo. Después de correr este SQL, el cliente puede pushear obras
-- de tipo consorcio sin error PGRST204.
