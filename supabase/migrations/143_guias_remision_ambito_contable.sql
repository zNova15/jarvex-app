-- 143: las GUÍAS DE REMISIÓN pasan al ámbito CONTABLE (pedido 20-jul-2026).
--
-- El almacenero (y otros roles operativos) veía en la galería de Evidencias
-- las guías de remisión que sube captura mágica. Gabriel: guías, facturas y
-- comprobantes son material netamente de contabilidad — deben verlos SOLO la
-- contadora jefe, la asistente y el admin (más quien subió la evidencia).
--
-- Espejo client-side: src/lib/evidencias-visibilidad.js (la galería además
-- reparte los tipos operativos por función: almacén ve lo de almacén, cada
-- especialista lo suyo, etc. — eso es filtro de UI; lo sensible es esto).
DROP POLICY IF EXISTS "evidencias: ver segun tipo" ON public.evidencias;
CREATE POLICY "evidencias: ver segun tipo" ON public.evidencias
  FOR SELECT TO authenticated
  USING (
    tipo_evidencia NOT IN ('bancarizacion', 'comprobante_captura', 'factura',
                           'recibo_honorarios', 'pago_evidencia', 'guia_remision')
    OR public.has_role(ARRAY['admin'::text, 'contador'::text, 'ayudante_contador'::text])
    OR subido_por = auth.uid()
    OR created_by = auth.uid()
  );

NOTIFY pgrst, 'reload schema';
