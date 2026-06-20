-- 087: metas de metrado del ingeniero (O3 / plan-vs-real). El ingeniero proyecta
-- cuánto metrado espera avanzar de una partida en una fecha; luego se compara
-- contra el avance real reportado. Espejo de las tablas de obra.

CREATE TABLE IF NOT EXISTS public.avance_metas (
  id uuid PRIMARY KEY,
  obra_id uuid NOT NULL,
  frente_id uuid,
  partida_id uuid NOT NULL,
  fecha date NOT NULL,
  meta_metrado numeric,
  meta_descripcion text,
  created_by uuid, updated_by uuid,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  version integer DEFAULT 1, sync_status text, last_synced_at timestamptz,
  idempotency_key text, deleted_at timestamptz, demo boolean DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_avance_metas_obra ON public.avance_metas(obra_id);
CREATE INDEX IF NOT EXISTS idx_avance_metas_partida ON public.avance_metas(obra_id, partida_id, fecha);

ALTER TABLE public.avance_metas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "avance_metas: select autenticado" ON public.avance_metas;
CREATE POLICY "avance_metas: select autenticado" ON public.avance_metas FOR SELECT TO authenticated USING (deleted_at IS NULL);
DROP POLICY IF EXISTS "avance_metas: insert autenticado" ON public.avance_metas;
CREATE POLICY "avance_metas: insert autenticado" ON public.avance_metas FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "avance_metas: update autenticado" ON public.avance_metas;
CREATE POLICY "avance_metas: update autenticado" ON public.avance_metas FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "avance_metas: admin elimina" ON public.avance_metas;
CREATE POLICY "avance_metas: admin elimina" ON public.avance_metas FOR DELETE TO authenticated USING ((SELECT rol FROM public.profiles WHERE id = auth.uid()) = 'admin');

NOTIFY pgrst, 'reload schema';
