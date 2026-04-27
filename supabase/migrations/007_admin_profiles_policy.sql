-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Permitir que el admin gestione todos los perfiles
-- Fix: el rol nunca se actualizaba al crear/editar usuarios porque la
--      única policy de UPDATE era "actualizar propio".
-- ═══════════════════════════════════════════════════════════════════

-- Helper SECURITY DEFINER para evitar recursión de RLS al consultar
-- profiles dentro de las propias policies de profiles.
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND rol = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Admin puede actualizar cualquier perfil (rol, activo, nombres, etc.)
DROP POLICY IF EXISTS "profiles: admin actualiza todos" ON profiles;
CREATE POLICY "profiles: admin actualiza todos" ON profiles
  FOR UPDATE
  USING (is_admin())
  WITH CHECK (is_admin());

-- Admin puede insertar perfiles manualmente si hace falta
DROP POLICY IF EXISTS "profiles: admin inserta" ON profiles;
CREATE POLICY "profiles: admin inserta" ON profiles
  FOR INSERT
  WITH CHECK (is_admin());

-- Admin puede borrar perfiles (soft o hard delete)
DROP POLICY IF EXISTS "profiles: admin elimina" ON profiles;
CREATE POLICY "profiles: admin elimina" ON profiles
  FOR DELETE
  USING (is_admin());
