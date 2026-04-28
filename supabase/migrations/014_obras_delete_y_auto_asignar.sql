-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — DELETE de obras + auto-asignar al creador en obra_usuarios
-- ═══════════════════════════════════════════════════════════════════

-- Política DELETE: solo admin puede borrar obras (definitivamente).
-- En la app usamos soft delete (deleted_at) que entra por la política
-- UPDATE existente, pero esta política DELETE permite el hard delete
-- desde el SQL Editor o desde flujos de admin que lo requieran.
DROP POLICY IF EXISTS "obras: admin elimina" ON obras;
CREATE POLICY "obras: admin elimina" ON obras
  FOR DELETE
  USING (is_admin());

-- ── Auto-asignar al creador en obra_usuarios ─────────────────────────
-- Cuando un usuario (admin o gerente) crea una obra, automáticamente se
-- inserta una fila en obra_usuarios para que el creator pueda verla
-- via la policy "user_has_access_to_obra" sin necesitar acción extra.
-- Esto resuelve el problema de "Miguel crea obra → otros admin tampoco
-- la ven hasta sincronizar manualmente": como admin pasa por el bypass
-- igual la verá, pero asegura el caso del rol 'gerente' o futuros.
CREATE OR REPLACE FUNCTION asignar_creador_a_obra()
RETURNS TRIGGER AS $$
BEGIN
  -- Solo si tenemos created_by (puede no estar al insertar manualmente)
  IF NEW.created_by IS NOT NULL THEN
    -- Insertar como rol_obra='admin' (equivalente al rol del creador en su obra)
    INSERT INTO obra_usuarios (obra_id, usuario_id, rol_obra, activo)
    VALUES (NEW.id, NEW.created_by, 'admin', true)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_asignar_creador_a_obra ON obras;
CREATE TRIGGER trg_asignar_creador_a_obra
  AFTER INSERT ON obras
  FOR EACH ROW EXECUTE FUNCTION asignar_creador_a_obra();

-- ── Ampliar permisos de INSERT para que más roles puedan importar ───
-- Hoy partidas, materiales, herramientas requieren admin/gerente/
-- ingeniero_residente/almacenero según la tabla. Si quieres que el
-- almacenero TAMBIÉN pueda importar, puedes ampliar las policies
-- aquí. Por seguridad NO lo hago automático — Gabriel tiene que
-- decidir caso por caso.
--
-- Ejemplo (descomentado solo si decides ampliar):
-- DROP POLICY IF EXISTS "partidas: editar (ing.residente+)" ON partidas;
-- CREATE POLICY "partidas: editar (ing.residente+)" ON partidas
--   FOR ALL USING (
--     user_has_access_to_obra(obra_id)
--     AND user_rol_in_obra(obra_id) IN ('admin', 'gerente', 'ingeniero_residente', 'almacenero')
--   );
