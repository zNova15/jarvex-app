-- 167 — Cerco del rol campo para guia_factura (hueco de la mig 165)
--
-- Encontrado en la inspección general del 1-sep: el cerco RESTRICTIVE del rol
-- campo cubre 99 tablas… y la ÚNICA con RLS sin cerco era guia_factura,
-- creada el mismo día por la 165 (nació después de la migración del cerco y
-- nadie le agregó las políticas). El rol campo (cuenta compartida del portal
-- de captura) podía leer/escribir vínculos guía↔factura, que son material
-- contable. Mismo patrón exacto que el resto de las tablas.
--
-- LECCIÓN PERMANENTE: toda tabla nueva debe nacer con sus campo_cerco_*.
CREATE POLICY campo_cerco_select ON public.guia_factura AS RESTRICTIVE
  FOR SELECT TO authenticated USING (current_user_rol() IS DISTINCT FROM 'campo'::text);
CREATE POLICY campo_cerco_insert ON public.guia_factura AS RESTRICTIVE
  FOR INSERT TO authenticated WITH CHECK (current_user_rol() IS DISTINCT FROM 'campo'::text);
CREATE POLICY campo_cerco_update ON public.guia_factura AS RESTRICTIVE
  FOR UPDATE TO authenticated USING (current_user_rol() IS DISTINCT FROM 'campo'::text)
  WITH CHECK (current_user_rol() IS DISTINCT FROM 'campo'::text);
CREATE POLICY campo_cerco_delete ON public.guia_factura AS RESTRICTIVE
  FOR DELETE TO authenticated USING (current_user_rol() IS DISTINCT FROM 'campo'::text);

NOTIFY pgrst, 'reload schema';
