-- 090: solicitudes de CREACIÓN DE FRENTE desde una partida huérfana (sin frente).
-- Un ingeniero avanzó una partida que no está en ningún frente activo, vinculó sus
-- insumos y pide al admin/gerente que oficialice esa partida como un frente. El
-- admin puede crear un frente normal o "oficializar como frente pequeño" (1 partida,
-- el ingeniero queda como responsable y se le transfieren los insumos vinculados).
CREATE TABLE IF NOT EXISTS public.solicitudes_frente (
  id uuid PRIMARY KEY,
  obra_id uuid NOT NULL,
  partida_id uuid NOT NULL,
  solicitante_user_id uuid,
  nombre_sugerido text,
  motivo text,
  estado text NOT NULL DEFAULT 'solicitado',   -- solicitado | aprobado | rechazado
  frente_creado_id uuid,
  es_pequeno boolean DEFAULT false,
  decidido_por uuid,
  decidido_at timestamptz,
  nota_decision text,
  created_by uuid, updated_by uuid,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  version integer DEFAULT 1, sync_status text, last_synced_at timestamptz,
  idempotency_key text, deleted_at timestamptz, demo boolean DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_solfrente_obra ON public.solicitudes_frente(obra_id);
CREATE INDEX IF NOT EXISTS idx_solfrente_estado ON public.solicitudes_frente(obra_id, estado);

ALTER TABLE public.solicitudes_frente ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sol_frente: select autenticado" ON public.solicitudes_frente;
CREATE POLICY "sol_frente: select autenticado" ON public.solicitudes_frente FOR SELECT TO authenticated USING (deleted_at IS NULL);
DROP POLICY IF EXISTS "sol_frente: insert autenticado" ON public.solicitudes_frente;
CREATE POLICY "sol_frente: insert autenticado" ON public.solicitudes_frente FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "sol_frente: update autenticado" ON public.solicitudes_frente;
CREATE POLICY "sol_frente: update autenticado" ON public.solicitudes_frente FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "sol_frente: dueno o admin/gerente elimina" ON public.solicitudes_frente;
CREATE POLICY "sol_frente: dueno o admin/gerente elimina" ON public.solicitudes_frente FOR DELETE TO authenticated
  USING (solicitante_user_id = auth.uid() OR (SELECT rol FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'gerente'));

NOTIFY pgrst, 'reload schema';
