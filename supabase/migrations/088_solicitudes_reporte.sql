-- 088: solicitudes de reporte de un frente AJENO. Cuando el ingeniero titular de
-- otro frente está ausente y hay que avanzar, otro ingeniero pide permiso al
-- administrador/gerente para reportar ese frente. Flujo de dos compuertas:
--   solicitado → (admin aprueba) → aprobado → (ingeniero carga y envía) →
--   enviado → (admin acepta) → aceptado  [recién acá se aplican los avances]
-- payload guarda las líneas del reporte {partida_id, descripcion, metrado, pct}.
-- Espejo de las tablas de obra (RLS + columnas de sync).

CREATE TABLE IF NOT EXISTS public.solicitudes_reporte (
  id uuid PRIMARY KEY,
  obra_id uuid NOT NULL,
  frente_id uuid NOT NULL,
  solicitante_user_id uuid,
  fecha date NOT NULL,
  motivo text,
  estado text NOT NULL DEFAULT 'solicitado',
  reporte_payload jsonb,
  decidido_por uuid,
  decidido_at timestamptz,
  nota_decision text,
  created_by uuid, updated_by uuid,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  version integer DEFAULT 1, sync_status text, last_synced_at timestamptz,
  idempotency_key text, deleted_at timestamptz, demo boolean DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_solrep_obra ON public.solicitudes_reporte(obra_id);
CREATE INDEX IF NOT EXISTS idx_solrep_estado ON public.solicitudes_reporte(obra_id, estado);
CREATE INDEX IF NOT EXISTS idx_solrep_frente ON public.solicitudes_reporte(obra_id, frente_id, fecha);

ALTER TABLE public.solicitudes_reporte ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sol_reporte: select autenticado" ON public.solicitudes_reporte;
CREATE POLICY "sol_reporte: select autenticado" ON public.solicitudes_reporte FOR SELECT TO authenticated USING (deleted_at IS NULL);
DROP POLICY IF EXISTS "sol_reporte: insert autenticado" ON public.solicitudes_reporte;
CREATE POLICY "sol_reporte: insert autenticado" ON public.solicitudes_reporte FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "sol_reporte: update autenticado" ON public.solicitudes_reporte;
CREATE POLICY "sol_reporte: update autenticado" ON public.solicitudes_reporte FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "sol_reporte: admin elimina" ON public.solicitudes_reporte;
CREATE POLICY "sol_reporte: admin elimina" ON public.solicitudes_reporte FOR DELETE TO authenticated USING ((SELECT rol FROM public.profiles WHERE id = auth.uid()) = 'admin');

NOTIFY pgrst, 'reload schema';
