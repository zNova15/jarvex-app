-- 146: documentos del PAQUETE SCTR — cotización, pago y factura son CONTABLES
-- (pedido 21-jul-2026 — PENDIENTE DE APLICAR cuando vuelva el conector MCP).
--
-- La contadora jefe sube el trámite del SCTR como un solo PDF y la app lo
-- separa en: cotización (sctr_cotizacion), certificado/constancia ('sctr'),
-- evidencia de pago (sctr_pago) y factura (sctr_factura). La ing. de
-- seguridad SOLO debe ver el CERTIFICADO ('sctr' queda fuera de la lista
-- contable); el resto es material del área contable + admin (+ autor).
-- Espejo client-side: src/lib/evidencias-visibilidad.js.
DROP POLICY IF EXISTS "evidencias: ver segun tipo" ON public.evidencias;
CREATE POLICY "evidencias: ver segun tipo" ON public.evidencias
  FOR SELECT TO authenticated
  USING (
    tipo_evidencia NOT IN ('bancarizacion', 'comprobante_captura', 'factura',
                           'recibo_honorarios', 'pago_evidencia', 'guia_remision',
                           'sctr_cotizacion', 'sctr_pago', 'sctr_factura', 'sctr_otro')
    OR public.has_role(ARRAY['admin'::text, 'contador'::text, 'ayudante_contador'::text])
    OR subido_por = auth.uid()
    OR created_by = auth.uid()
  );

NOTIFY pgrst, 'reload schema';
