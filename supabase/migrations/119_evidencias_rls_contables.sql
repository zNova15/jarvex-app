-- 119: SEGURIDAD — las evidencias CONTABLES (facturas/comprobantes/bancarización)
-- solo las leen el ADMIN y la CONTADORA JEFE (rol 'contador'), más el propio
-- autor de la subida (el ayudante de contabilidad sube bancarizaciones y debe
-- poder ver las suyas). Antes el SELECT era USING(true) para todo autenticado
-- → la almacenera veía TODAS las facturas en la galería de Evidencias (fuga
-- reportada por Gabriel). Las evidencias de obra (fotos, firmas) siguen
-- visibles para el equipo de la obra como siempre.

DROP POLICY IF EXISTS "evidencias: autenticado ve" ON public.evidencias;
DROP POLICY IF EXISTS "rls033_select" ON public.evidencias;
DROP POLICY IF EXISTS "rls033_rollback_select" ON public.evidencias;
DROP POLICY IF EXISTS "evidencias: ver por obra" ON public.evidencias;
DROP POLICY IF EXISTS "evidencias: ver segun tipo" ON public.evidencias;

-- Allowlist = roles que YA ven los movimientos contables completos (montos,
-- RUC, factura adjunta) por su flujo: ocultarles solo el PDF no protege nada y
-- rompía el check "⚠ falta bancarización" (se calcula del Dexie local). La
-- GALERÍA de Evidencias igual muestra lo contable SOLO a admin/contador
-- (filtro de UI) — este RLS es la barrera para almacén/ingenieros/etc.
CREATE POLICY "evidencias: ver segun tipo" ON public.evidencias
  FOR SELECT TO authenticated
  USING (
    tipo_evidencia NOT IN ('bancarizacion', 'comprobante_captura', 'factura')
    OR public.has_role(ARRAY['admin'::text, 'contador'::text, 'ayudante_contador'::text, 'gerente'::text, 'tesorero'::text, 'asistente_admin'::text])
    OR subido_por = auth.uid()
    OR created_by = auth.uid()
  );

NOTIFY pgrst, 'reload schema';
