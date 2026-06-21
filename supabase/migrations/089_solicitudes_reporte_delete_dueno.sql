-- 089: el ingeniero (solicitante) debe poder CANCELAR/borrar su propia solicitud
-- de reporte de frente ajeno. La política DELETE de la mig 088 era admin-only.
-- (Nota: el SyncEngine pushea el borrado como UPDATE deleted_at, cubierto por la
-- política UPDATE (true)/(true), así que el 42501 del incidente fue muy
-- probablemente sesión expirada/transitorio; igual dejamos la política DELETE
-- correcta para el dueño por robustez ante cualquier hard-delete futuro.)
DROP POLICY IF EXISTS "sol_reporte: admin elimina" ON public.solicitudes_reporte;
CREATE POLICY "sol_reporte: dueno o admin/gerente elimina" ON public.solicitudes_reporte
  FOR DELETE TO authenticated
  USING (
    solicitante_user_id = auth.uid()
    OR (SELECT rol FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'gerente')
  );

NOTIFY pgrst, 'reload schema';
