-- 066: Historial individual del personal (línea de tiempo cara-usuario).
-- Registra cambios de cargo (ascensos), de frente de trabajo, de estado y de
-- subcontrato, además del alta. Tabla dedicada (no audit_log, que es admin-only y
-- no se descarga al cliente). RLS de SELECT abierta a authenticated (como
-- material_precios_historial) para que la timeline cargue en cualquier dispositivo.

CREATE TABLE IF NOT EXISTS public.personal_historial (
  id uuid PRIMARY KEY,
  personal_id uuid REFERENCES public.personal(id) ON DELETE CASCADE,
  obra_id uuid,
  fecha date DEFAULT CURRENT_DATE,
  tipo text CHECK (tipo IN ('alta', 'cargo', 'frente', 'estado', 'subcontrato', 'area')),
  valor_anterior text,
  valor_nuevo text,
  motivo text,
  version integer DEFAULT 1,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz, created_by uuid, updated_by uuid,
  idempotency_key text, last_synced_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_phist_personal ON public.personal_historial(personal_id);
CREATE INDEX IF NOT EXISTS idx_phist_fecha ON public.personal_historial(fecha DESC);

ALTER TABLE public.personal_historial ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "phist: ve" ON public.personal_historial;
CREATE POLICY "phist: ve" ON public.personal_historial FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS "phist: crea" ON public.personal_historial;
CREATE POLICY "phist: crea" ON public.personal_historial FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS "phist: actualiza" ON public.personal_historial;
CREATE POLICY "phist: actualiza" ON public.personal_historial FOR UPDATE USING ((SELECT auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS "phist: elimina" ON public.personal_historial;
CREATE POLICY "phist: elimina" ON public.personal_historial FOR DELETE USING (is_admin());

NOTIFY pgrst, 'reload schema';
