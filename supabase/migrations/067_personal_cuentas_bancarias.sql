-- 067: Cuentas bancarias del PERSONAL (trabajadores) + datos extra de personal.
--
-- `cuentas_bancarias` es de EMPRESAS (company_id, saldo → alimenta flujo de
-- caja en Tesorería). Las cuentas de los trabajadores van en una tabla propia
-- para no contaminar las agregaciones de tesorería: una persona puede tener
-- varias cuentas (sueldo BCP, CTS Banco Nación, etc.). Se muestran en la
-- sección Cuentas Bancarias, pestaña "Personal", separadas por persona.
--
-- Además: columnas de contacto/planilla que faltaban en `personal` para la
-- plantilla completa (email, dirección, contacto de emergencia, régimen).

ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS direccion TEXT;
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS contacto_emergencia TEXT;
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS telefono_emergencia TEXT;
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS regimen_pension TEXT;  -- 'ONP', 'AFP Integra', 'AFP Prima', etc.
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS fecha_nacimiento DATE;

CREATE TABLE IF NOT EXISTS public.personal_cuentas_bancarias (
  id uuid PRIMARY KEY,
  obra_id uuid NOT NULL,
  personal_id uuid NOT NULL REFERENCES public.personal(id) ON DELETE CASCADE,
  banco text NOT NULL,                       -- BCP, BBVA, Interbank, Scotiabank, Banco de la Nación, caja…
  tipo_cuenta text DEFAULT 'ahorros',        -- ahorros | corriente | cts | otra
  numero_cuenta text,
  cci text,                                  -- código interbancario (20 dígitos)
  moneda text DEFAULT 'PEN',                 -- PEN | USD
  principal boolean DEFAULT false,           -- cuenta de abono de sueldo
  observaciones text,
  created_by uuid, updated_by uuid,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  version integer DEFAULT 1, sync_status text, last_synced_at timestamptz,
  idempotency_key text UNIQUE, deleted_at timestamptz, demo boolean DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_pcb_personal ON public.personal_cuentas_bancarias(personal_id);
CREATE INDEX IF NOT EXISTS idx_pcb_obra ON public.personal_cuentas_bancarias(obra_id);

ALTER TABLE public.personal_cuentas_bancarias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pcb: select autenticado" ON public.personal_cuentas_bancarias;
CREATE POLICY "pcb: select autenticado" ON public.personal_cuentas_bancarias FOR SELECT TO authenticated USING (deleted_at IS NULL);
DROP POLICY IF EXISTS "pcb: insert autenticado" ON public.personal_cuentas_bancarias;
CREATE POLICY "pcb: insert autenticado" ON public.personal_cuentas_bancarias FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "pcb: update autenticado" ON public.personal_cuentas_bancarias;
CREATE POLICY "pcb: update autenticado" ON public.personal_cuentas_bancarias FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "pcb: admin elimina" ON public.personal_cuentas_bancarias;
CREATE POLICY "pcb: admin elimina" ON public.personal_cuentas_bancarias FOR DELETE TO authenticated USING ((SELECT rol FROM public.profiles WHERE id = auth.uid()) = 'admin');

NOTIFY pgrst, 'reload schema';
