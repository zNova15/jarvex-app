-- 155 — MEJORA 2 (sep-2026): portal de captura rápida de facturas de CAMPO.
--
-- Diseño (Gabriel, 29-ago): el personal de campo (con una cuenta compartida
-- campo@ y un PIN que reparte el admin) SOLO puede subir la foto del
-- comprobante; entra a una bandeja que las contadoras revisan y pasan por
-- Captura Mágica (el OCR corre recién ahí, con el JWT de la contadora —
-- una foto falsa cuesta S/0 en créditos de IA).
--
-- PIEZA CLAVE DE SEGURIDAD — EL CERCO: la mig 030 dio SELECT/INSERT/UPDATE
-- USING(true) a TODO autenticado sobre ~40 tablas (y la 033 por roles fue
-- revertida por la 034). Un PIN compartido con ese perímetro leería toda la
-- contabilidad por PostgREST. En vez de re-emitir 40 políticas (el error que
-- ya se pagó una vez), se agregan políticas RESTRICTIVE — se combinan con AND
-- sobre las permisivas existentes, no las tocan, y son reversibles con DROP.
-- El rol campo queda con: SELECT companies+obras (torpedo/selector), su propio
-- profile, y SOLO sus evidencias tipo factura_campo (leer/crear/actualizar).
-- Nada más — ni leer ni escribir. Los demás roles no cambian en absoluto
-- (current_user_rol() IS DISTINCT FROM 'campo' es true para todos ellos).

-- ── 1) Rol nuevo 'campo' (19º rol canónico) ──────────────────────────
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_rol_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_rol_check CHECK (rol = ANY (ARRAY[
  'admin','gerente','ingeniero_residente','ingeniero','supervisor','almacenero',
  'asistente_admin','contador','ayudante_contador','tesorero','jefe_compras','rrhh',
  'prevencionista','maestro_obra','solo_lectura',
  'ing_ambiental','ing_calidad','ing_social',
  'campo'
]));

-- ── 2) Estado de revisión de las capturas de campo ───────────────────
-- 'pendiente' → la contadora la ve en su bandeja; 'registrada' → ya pasó por
-- Captura Mágica y existe el movimiento; 'descartada' → foto inservible.
-- NULL para toda evidencia que no venga del portal de campo.
ALTER TABLE evidencias ADD COLUMN IF NOT EXISTS campo_revision text
  CHECK (campo_revision IS NULL OR campo_revision IN ('pendiente','registrada','descartada'));

-- ── 3) 'factura_campo' es tipo CONTABLE para la visibilidad ──────────
-- Recreación de la política VIVA (la 119 ampliada por 136/143) + el tipo nuevo.
-- Espejo cliente: src/lib/evidencias-visibilidad.js (regla crítica 5).
DROP POLICY IF EXISTS "evidencias: ver segun tipo" ON public.evidencias;
CREATE POLICY "evidencias: ver segun tipo" ON public.evidencias
  FOR SELECT TO authenticated
  USING (
    tipo_evidencia NOT IN ('bancarizacion','comprobante_captura','factura',
      'recibo_honorarios','pago_evidencia','guia_remision',
      'sctr_cotizacion','sctr_pago','sctr_factura','sctr_otro',
      'constancia_detraccion','factura_campo')
    OR public.has_role(ARRAY['admin'::text,'contador'::text,'ayudante_contador'::text])
    OR subido_por = auth.uid()
    OR created_by = auth.uid()
  );

-- ── 4) CERCO RESTRICTIVO del rol campo ───────────────────────────────
-- 4a) Denegación total en TODAS las tablas public salvo las 4 con trato fino.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT IN ('companies','obras','evidencias','profiles')
  LOOP
    -- Defensivo: una RESTRICTIVE es inerte si la tabla tiene RLS apagada.
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS campo_cerco_select ON public.%I', t);
    EXECUTE format('CREATE POLICY campo_cerco_select ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (public.current_user_rol() IS DISTINCT FROM ''campo'')', t);
    EXECUTE format('DROP POLICY IF EXISTS campo_cerco_insert ON public.%I', t);
    EXECUTE format('CREATE POLICY campo_cerco_insert ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.current_user_rol() IS DISTINCT FROM ''campo'')', t);
    EXECUTE format('DROP POLICY IF EXISTS campo_cerco_update ON public.%I', t);
    EXECUTE format('CREATE POLICY campo_cerco_update ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.current_user_rol() IS DISTINCT FROM ''campo'') WITH CHECK (public.current_user_rol() IS DISTINCT FROM ''campo'')', t);
    EXECUTE format('DROP POLICY IF EXISTS campo_cerco_delete ON public.%I', t);
    EXECUTE format('CREATE POLICY campo_cerco_delete ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (public.current_user_rol() IS DISTINCT FROM ''campo'')', t);
  END LOOP;
END $$;

-- 4b) evidencias: campo SOLO sus factura_campo. El INSERT y el UPDATE FUERZAN
-- campo_revision='pendiente' — así el que sube NO puede marcar su propia foto
-- como 'registrada' por PostgREST y sacarla de la bandeja de contabilidad sin
-- revisión (hallazgo adversarial). El estado de revisión lo maneja SOLO
-- contabilidad (que no está gateada por este cerco). Borrar: no.
DROP POLICY IF EXISTS campo_cerco_select ON public.evidencias;
CREATE POLICY campo_cerco_select ON public.evidencias AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.current_user_rol() IS DISTINCT FROM 'campo'
         OR (tipo_evidencia = 'factura_campo' AND created_by = auth.uid()));
DROP POLICY IF EXISTS campo_cerco_insert ON public.evidencias;
CREATE POLICY campo_cerco_insert ON public.evidencias AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.current_user_rol() IS DISTINCT FROM 'campo'
              OR (tipo_evidencia = 'factura_campo' AND created_by = auth.uid()
                  AND campo_revision = 'pendiente'));
-- USING exige que la fila YA esté 'pendiente': así campo no puede tocar una
-- factura que contabilidad ya marcó 'registrada'/'descartada' (sin esto podía
-- revertirla a 'pendiente' por PostgREST y reinyectarla a la bandeja → doble
-- registro). El flujo legítimo de EvidenceUploader siempre opera sobre filas
-- 'pendiente', así que no se rompe.
DROP POLICY IF EXISTS campo_cerco_update ON public.evidencias;
CREATE POLICY campo_cerco_update ON public.evidencias AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.current_user_rol() IS DISTINCT FROM 'campo'
         OR (tipo_evidencia = 'factura_campo' AND created_by = auth.uid()
             AND campo_revision = 'pendiente'))
  WITH CHECK (public.current_user_rol() IS DISTINCT FROM 'campo'
              OR (tipo_evidencia = 'factura_campo' AND created_by = auth.uid()
                  AND campo_revision = 'pendiente'));
DROP POLICY IF EXISTS campo_cerco_delete ON public.evidencias;
CREATE POLICY campo_cerco_delete ON public.evidencias AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.current_user_rol() IS DISTINCT FROM 'campo');

-- 4c) profiles: campo SOLO LEE su fila. NO puede escribir NADA.
-- ⚠ CRÍTICO (hallazgo de la revisión adversarial): todo el cerco confía en
-- current_user_rol()='campo'. Si campo pudiera UPDATE su propia fila, se
-- pondría rol='admin' (el CHECK lo acepta; RLS no ve OLD) y en la request
-- siguiente el cerco entero se abre. Por eso campo tiene UPDATE/INSERT/DELETE
-- de profiles NEGADO por completo — no solo restringido a su fila.
DROP POLICY IF EXISTS campo_cerco_select ON public.profiles;
CREATE POLICY campo_cerco_select ON public.profiles AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.current_user_rol() IS DISTINCT FROM 'campo' OR id = auth.uid());
DROP POLICY IF EXISTS campo_cerco_update ON public.profiles;
CREATE POLICY campo_cerco_update ON public.profiles AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.current_user_rol() IS DISTINCT FROM 'campo')
  WITH CHECK (public.current_user_rol() IS DISTINCT FROM 'campo');
DROP POLICY IF EXISTS campo_cerco_insert ON public.profiles;
CREATE POLICY campo_cerco_insert ON public.profiles AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.current_user_rol() IS DISTINCT FROM 'campo');
DROP POLICY IF EXISTS campo_cerco_delete ON public.profiles;
CREATE POLICY campo_cerco_delete ON public.profiles AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.current_user_rol() IS DISTINCT FROM 'campo');

-- 4d) companies / obras: campo LEE (torpedo de RUCs, selector de obra) pero
-- jamás escribe.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['companies','obras']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS campo_cerco_insert ON public.%I', t);
    EXECUTE format('CREATE POLICY campo_cerco_insert ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.current_user_rol() IS DISTINCT FROM ''campo'')', t);
    EXECUTE format('DROP POLICY IF EXISTS campo_cerco_update ON public.%I', t);
    EXECUTE format('CREATE POLICY campo_cerco_update ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.current_user_rol() IS DISTINCT FROM ''campo'') WITH CHECK (public.current_user_rol() IS DISTINCT FROM ''campo'')', t);
    EXECUTE format('DROP POLICY IF EXISTS campo_cerco_delete ON public.%I', t);
    EXECUTE format('CREATE POLICY campo_cerco_delete ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (public.current_user_rol() IS DISTINCT FROM ''campo'')', t);
  END LOOP;
END $$;

-- ── 4e) CERRAR VISTAS con fuga ───────────────────────────────────────
-- El cerco de 4a itera pg_tables → NO cubre VISTAS. Una vista SECURITY DEFINER
-- corre con los derechos de su dueño (bypassrls) → devuelve datos cross-obra a
-- CUALQUIER autenticado, incluido campo, saltando la RLS de las tablas base
-- (hallazgo adversarial: v_salidas_pendientes_partida filtraba movimientos de
-- todas las obras). security_invoker=true hace que la vista respete la RLS del
-- que consulta. Inocuo para los demás roles (tienen USING(true) en las bases);
-- para campo, el cerco de 4a ahora también aplica a través de la vista.
DO $$
DECLARE v text;
BEGIN
  FOR v IN
    SELECT c.relname FROM pg_class c
    WHERE c.relkind = 'v' AND c.relnamespace = 'public'::regnamespace
      AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(c.reloptions,'{}')) o WHERE o LIKE 'security_invoker=%')
  LOOP
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v);
  END LOOP;
END $$;

-- ── 4f) CERRAR FUNCIONES RPC con fuga ────────────────────────────────
-- El cerco RLS (4a/4e) cubre tablas y vistas, pero NO las funciones SECURITY
-- DEFINER que PostgREST expone como RPC a authenticated: corren como su dueño
-- (bypassrls) → devuelven/escriben datos de cualquier obra saltando el cerco
-- (hallazgo adversarial: campo leía la curva-S financiera de todas las obras
-- por POST /rest/v1/rpc/fn_curva_s). Mismo criterio que 4e: pasarlas a
-- SECURITY INVOKER → respetan la RLS del que llama (campo: cerco lo bloquea;
-- los demás con USING(true) ven/escriben igual que antes). Auditado: las demás
-- SECURITY DEFINER son triggers, helpers de la propia RLS (solo devuelven info
-- del que llama) o admin_wipe_data (valida rol admin internamente) — no se tocan.
ALTER FUNCTION public.fn_curva_s(uuid) SECURITY INVOKER;
ALTER FUNCTION public.recalcular_stock_obra(uuid) SECURITY INVOKER;

-- ── 5) Storage: el rol campo puede SUBIR al bucket evidencias ────────
-- (la política de la 104 exige admin o membresía de obra; campo no es
-- miembro de nada — permisiva nueva, OR con las existentes).
DROP POLICY IF EXISTS "evidencias storage: campo sube" ON storage.objects;
CREATE POLICY "evidencias storage: campo sube" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'evidencias' AND public.current_user_rol() = 'campo');

NOTIFY pgrst, 'reload schema';
