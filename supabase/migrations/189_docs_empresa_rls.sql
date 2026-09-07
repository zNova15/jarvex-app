-- ═══════════════════════════════════════════════════════════════════
-- 189 — Los papeles de la empresa: quién puede verlos (espejo del cliente)
--
-- La tanda 10 agrega a la Ficha de Empresa cuatro documentos que pidió la
-- contadora: FICHA RUC, VIGENCIA DE PODER, TESTIMONIO y RNP (más un "otro").
-- Se guardan como evidencias sin obra (modulo_relacionado='companies',
-- registro_relacionado_id = la empresa).
--
-- La policy «evidencias: ver segun tipo» termina en ELSE true, así que un tipo
-- nuevo lo vería CUALQUIER usuario autenticado — incluidos maestro de obra y
-- personal de campo. Estos papeles traen datos del representante legal y son
-- los que se presentan en licitaciones: van a una lista cerrada de roles.
--
-- ⚠ Regla crítica 5 del repo: esta policy y src/lib/evidencias-visibilidad.js
-- se mantienen en ESPEJO. El cliente ya tiene la misma lista
-- (TIPOS_DOC_EMPRESA_VIS / ROLES_DOC_EMPRESA).
--
-- El INSERT no cambia: la policy vigente ya exige un rol de la allowlist
-- rls033_insert, y la UI solo ofrece el botón de subir a admin, contador,
-- ayudante_contador, gerente y asistente_admin.
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "evidencias: ver segun tipo" ON public.evidencias;

CREATE POLICY "evidencias: ver segun tipo" ON public.evidencias
FOR SELECT USING (
  (subido_por = auth.uid()) OR (created_by = auth.uid()) OR
  CASE
    WHEN (tipo_evidencia = ANY (ARRAY[
      'bancarizacion','comprobante_captura','factura','recibo_honorarios',
      'pago_evidencia','guia_remision','sctr_cotizacion','sctr_pago',
      'sctr_factura','sctr_otro','constancia_detraccion','factura_campo'
    ])) THEN has_role(ARRAY['admin','contador','ayudante_contador'])
    WHEN (tipo_evidencia = ANY (ARRAY['cv_profesional','constancia_experiencia']))
      THEN has_role(ARRAY['admin','gerente','rrhh','licitaciones'])
    -- Papeles societarios de la empresa (tanda 10)
    WHEN (tipo_evidencia = ANY (ARRAY[
      'doc_empresa_ficha_ruc','doc_empresa_vigencia_poder',
      'doc_empresa_testimonio','doc_empresa_rnp','doc_empresa_otro'
    ])) THEN has_role(ARRAY['admin','gerente','contador','ayudante_contador','tesorero','licitaciones','asistente_admin'])
    ELSE true
  END
);
