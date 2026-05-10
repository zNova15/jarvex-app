-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Permitir al almacenero crear requisiciones
--
-- Decisión de negocio (2026-05-10): el almacenero detecta faltantes
-- en obra y debe poder pedir compras directamente. La aprobación final
-- la hace el admin/gerente desde su pantalla de Requisiciones.
--
-- Tablas afectadas: requisiciones, requisicion_items.
-- Otras tablas del flujo de compras (cotizaciones, ordenes_compra)
-- siguen siendo read-only para almacenero — esas las maneja el admin
-- o jefe_compras.
--
-- Aplica delta sobre la migration 033 (RLS por roles).
-- ═══════════════════════════════════════════════════════════════════

-- ── Borrar policies viejas de almacenero en requisiciones ───────────
DROP POLICY IF EXISTS rls033_requisiciones_almacenero_insert ON public.requisiciones;
DROP POLICY IF EXISTS rls033_requisiciones_almacenero_update ON public.requisiciones;
DROP POLICY IF EXISTS rls033_requisicion_items_almacenero_insert ON public.requisicion_items;
DROP POLICY IF EXISTS rls033_requisicion_items_almacenero_update ON public.requisicion_items;

-- ── INSERT permitido para almacenero (además de admin/gerente/etc) ──
CREATE POLICY rls033_requisiciones_almacenero_insert
  ON public.requisiciones FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND rol IN ('admin','gerente','ingeniero_residente','jefe_compras','almacenero','asistente_admin')
    )
  );

CREATE POLICY rls033_requisicion_items_almacenero_insert
  ON public.requisicion_items FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND rol IN ('admin','gerente','ingeniero_residente','jefe_compras','almacenero','asistente_admin')
    )
  );

-- ── UPDATE: el almacenero puede editar SUS PROPIAS requisiciones ────
-- (ej: para cambiar cantidades antes de que admin apruebe). Una vez
-- aprobada, el admin las cierra y se vuelve read-only.
CREATE POLICY rls033_requisiciones_almacenero_update
  ON public.requisiciones FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND rol IN ('admin','gerente','ingeniero_residente','jefe_compras','almacenero','asistente_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND rol IN ('admin','gerente','ingeniero_residente','jefe_compras','almacenero','asistente_admin')
    )
  );

CREATE POLICY rls033_requisicion_items_almacenero_update
  ON public.requisicion_items FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND rol IN ('admin','gerente','ingeniero_residente','jefe_compras','almacenero','asistente_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND rol IN ('admin','gerente','ingeniero_residente','jefe_compras','almacenero','asistente_admin')
    )
  );

-- Reload schema cache
NOTIFY pgrst, 'reload schema';
