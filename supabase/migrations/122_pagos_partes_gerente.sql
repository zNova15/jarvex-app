-- 122: el GERENTE tiene Movs. Contables 'w' y puede bancarizar con monto desde
-- el modal de Movimientos — su INSERT de pagos_partes era rechazado por RLS
-- (42501) y la parte quedaba FAILED eterna en su dispositivo (la evidencia sí
-- subía → divergencia). Se lo agrega a INSERT/UPDATE (ya tenía SELECT en 121).

DROP POLICY IF EXISTS "pagos_partes: escribe contable" ON pagos_partes;
CREATE POLICY "pagos_partes: escribe contable" ON pagos_partes
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(ARRAY['admin'::text, 'contador'::text, 'ayudante_contador'::text, 'gerente'::text]));
DROP POLICY IF EXISTS "pagos_partes: actualiza contable" ON pagos_partes;
CREATE POLICY "pagos_partes: actualiza contable" ON pagos_partes
  FOR UPDATE TO authenticated
  USING (public.has_role(ARRAY['admin'::text, 'contador'::text, 'ayudante_contador'::text, 'gerente'::text]));

NOTIFY pgrst, 'reload schema';
