-- 065: Frentes de trabajo por obra (catálogo per-obra, espejo de ubicaciones_obra)
-- + personal.frente_id (el frente actual del trabajador).
-- Un frente es una zona/sub-obra de trabajo (Alcantarillado, Captación, Línea de
-- Conducción, etc.). Cada trabajador (directo o subcontratado) puede pertenecer a
-- un frente; los frentes de un subcontrato se derivan de los frentes de su personal.

CREATE TABLE IF NOT EXISTS public.frentes_obra (
  id uuid PRIMARY KEY,
  obra_id uuid NOT NULL,
  nombre text NOT NULL,
  descripcion text,
  ingeniero_id uuid,                 -- ingeniero a cargo del frente (opcional, sin FK estricta)
  orden integer DEFAULT 0,
  activo boolean DEFAULT true,
  created_by uuid, updated_by uuid,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  version integer DEFAULT 1, sync_status text, last_synced_at timestamptz,
  idempotency_key text, deleted_at timestamptz, demo boolean DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_frentes_obra_obra ON public.frentes_obra(obra_id);
CREATE INDEX IF NOT EXISTS idx_frentes_obra_activo ON public.frentes_obra(activo);

ALTER TABLE public.frentes_obra ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "frentes_obra: select autenticado" ON public.frentes_obra;
CREATE POLICY "frentes_obra: select autenticado" ON public.frentes_obra FOR SELECT TO authenticated USING (deleted_at IS NULL);
DROP POLICY IF EXISTS "frentes_obra: insert autenticado" ON public.frentes_obra;
CREATE POLICY "frentes_obra: insert autenticado" ON public.frentes_obra FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "frentes_obra: update autenticado" ON public.frentes_obra;
CREATE POLICY "frentes_obra: update autenticado" ON public.frentes_obra FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "frentes_obra: admin elimina" ON public.frentes_obra;
CREATE POLICY "frentes_obra: admin elimina" ON public.frentes_obra FOR DELETE TO authenticated USING ((SELECT rol FROM public.profiles WHERE id = auth.uid()) = 'admin');

ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS frente_id UUID REFERENCES public.frentes_obra(id);
CREATE INDEX IF NOT EXISTS idx_personal_frente ON public.personal(frente_id) WHERE frente_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
