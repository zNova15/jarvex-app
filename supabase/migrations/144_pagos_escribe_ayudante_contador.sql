-- 144: el AYUDANTE de contabilidad también escribe PAGOS (pedido 20-jul-2026).
--
-- Las asistentes de contabilidad registran los pagos al personal (planilla /
-- recibos por honorarios) y suben sus constancias. Hasta ahora solo podían
-- LEER pagos (y sí escribir pagos_partes); el INSERT/UPDATE de `pagos` era
-- exclusivo de admin + contadora jefe → sus registros habrían rebotado.
-- El DELETE sigue siendo solo del admin.
--
-- Cliente: jx-pagos.jsx (canGestionar + ayudante), __AYUDANTE_CONTADOR_ITEMS
-- ('pagos' visible en Inicio/sidebar) y SyncEngine (pagos gateado por
-- 'Movs. Contables' como pagos_partes, para que su push no se bloquee).
DROP POLICY IF EXISTS "pagos: escribe contable" ON public.pagos;
CREATE POLICY "pagos: escribe contable" ON public.pagos
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(ARRAY['admin'::text, 'contador'::text, 'ayudante_contador'::text]));

DROP POLICY IF EXISTS "pagos: actualiza contable" ON public.pagos;
CREATE POLICY "pagos: actualiza contable" ON public.pagos
  FOR UPDATE TO authenticated
  USING (public.has_role(ARRAY['admin'::text, 'contador'::text, 'ayudante_contador'::text]))
  WITH CHECK (public.has_role(ARRAY['admin'::text, 'contador'::text, 'ayudante_contador'::text]));

NOTIFY pgrst, 'reload schema';
