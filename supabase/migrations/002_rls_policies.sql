-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Row Level Security (RLS)
-- ═══════════════════════════════════════════════════════════════════

-- Función helper: ¿el usuario tiene acceso a la obra?
CREATE OR REPLACE FUNCTION user_has_access_to_obra(p_obra_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  -- Admin ve todo
  IF EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND rol = 'admin'
  ) THEN RETURN true; END IF;

  -- Usuarios asignados a la obra
  RETURN EXISTS (
    SELECT 1 FROM obra_usuarios
    WHERE obra_id = p_obra_id
      AND usuario_id = auth.uid()
      AND activo = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Función helper: rol del usuario en una obra
CREATE OR REPLACE FUNCTION user_rol_in_obra(p_obra_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_rol TEXT;
BEGIN
  SELECT rol INTO v_rol FROM profiles WHERE id = auth.uid();
  IF v_rol = 'admin' THEN RETURN 'admin'; END IF;

  SELECT rol_obra INTO v_rol FROM obra_usuarios
  WHERE obra_id = p_obra_id AND usuario_id = auth.uid() AND activo = true;

  RETURN COALESCE(v_rol, 'sin_acceso');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── PROFILES ────────────────────────────────────────────────────────
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles: ver propio" ON profiles
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "profiles: admin ve todos" ON profiles
  FOR SELECT USING (
    (SELECT rol FROM profiles WHERE id = auth.uid()) = 'admin'
  );

CREATE POLICY "profiles: actualizar propio" ON profiles
  FOR UPDATE USING (id = auth.uid());

-- ── OBRAS ───────────────────────────────────────────────────────────
ALTER TABLE obras ENABLE ROW LEVEL SECURITY;

CREATE POLICY "obras: ver asignadas" ON obras
  FOR SELECT USING (user_has_access_to_obra(id));

CREATE POLICY "obras: crear (admin/gerente)" ON obras
  FOR INSERT WITH CHECK (
    (SELECT rol FROM profiles WHERE id = auth.uid()) IN ('admin', 'gerente')
  );

CREATE POLICY "obras: editar (admin/gerente)" ON obras
  FOR UPDATE USING (
    (SELECT rol FROM profiles WHERE id = auth.uid()) IN ('admin', 'gerente')
  );

-- ── OBRA_USUARIOS ────────────────────────────────────────────────────
ALTER TABLE obra_usuarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "obra_usuarios: ver asignaciones propias" ON obra_usuarios
  FOR SELECT USING (
    usuario_id = auth.uid()
    OR (SELECT rol FROM profiles WHERE id = auth.uid()) = 'admin'
  );

CREATE POLICY "obra_usuarios: admin gestiona" ON obra_usuarios
  FOR ALL USING (
    (SELECT rol FROM profiles WHERE id = auth.uid()) = 'admin'
  );

-- ── PERSONAL ─────────────────────────────────────────────────────────
ALTER TABLE personal ENABLE ROW LEVEL SECURITY;

CREATE POLICY "personal: ver por obra" ON personal
  FOR SELECT USING (user_has_access_to_obra(obra_id));

CREATE POLICY "personal: crear (roles con acceso)" ON personal
  FOR INSERT WITH CHECK (
    user_has_access_to_obra(obra_id)
    AND user_rol_in_obra(obra_id) IN ('admin', 'gerente', 'ingeniero_residente', 'asistente_admin')
  );

CREATE POLICY "personal: editar (roles con acceso)" ON personal
  FOR UPDATE USING (
    user_has_access_to_obra(obra_id)
    AND user_rol_in_obra(obra_id) IN ('admin', 'gerente', 'ingeniero_residente', 'asistente_admin')
  );

-- ── MATERIALES ───────────────────────────────────────────────────────
ALTER TABLE materiales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "materiales: ver por obra" ON materiales
  FOR SELECT USING (user_has_access_to_obra(obra_id));

CREATE POLICY "materiales: gestionar (almacenero+)" ON materiales
  FOR ALL USING (
    user_has_access_to_obra(obra_id)
    AND user_rol_in_obra(obra_id) IN ('admin', 'gerente', 'ingeniero_residente', 'almacenero')
  );

-- ── HERRAMIENTAS ─────────────────────────────────────────────────────
ALTER TABLE herramientas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "herramientas: ver por obra" ON herramientas
  FOR SELECT USING (user_has_access_to_obra(obra_id));

CREATE POLICY "herramientas: gestionar (supervisor+)" ON herramientas
  FOR ALL USING (
    user_has_access_to_obra(obra_id)
    AND user_rol_in_obra(obra_id) IN ('admin', 'gerente', 'ingeniero_residente', 'supervisor', 'almacenero')
  );

-- ── MOVIMIENTOS_MATERIALES ────────────────────────────────────────────
ALTER TABLE movimientos_materiales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mov_materiales: ver por obra" ON movimientos_materiales
  FOR SELECT USING (user_has_access_to_obra(obra_id));

CREATE POLICY "mov_materiales: registrar (supervisor+almacenero)" ON movimientos_materiales
  FOR INSERT WITH CHECK (
    user_has_access_to_obra(obra_id)
    AND user_rol_in_obra(obra_id) IN ('admin', 'supervisor', 'almacenero', 'ingeniero_residente')
  );

-- ── MOVIMIENTOS_HERRAMIENTAS ──────────────────────────────────────────
ALTER TABLE movimientos_herramientas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mov_herramientas: ver por obra" ON movimientos_herramientas
  FOR SELECT USING (user_has_access_to_obra(obra_id));

CREATE POLICY "mov_herramientas: registrar (supervisor+almacenero)" ON movimientos_herramientas
  FOR INSERT WITH CHECK (
    user_has_access_to_obra(obra_id)
    AND user_rol_in_obra(obra_id) IN ('admin', 'supervisor', 'almacenero', 'ingeniero_residente')
  );

-- ── ASISTENCIA ────────────────────────────────────────────────────────
ALTER TABLE asistencia ENABLE ROW LEVEL SECURITY;

CREATE POLICY "asistencia: ver por obra" ON asistencia
  FOR SELECT USING (user_has_access_to_obra(obra_id));

CREATE POLICY "asistencia: registrar (todos excepto solo_lectura)" ON asistencia
  FOR INSERT WITH CHECK (
    user_has_access_to_obra(obra_id)
    AND user_rol_in_obra(obra_id) != 'solo_lectura'
    AND user_rol_in_obra(obra_id) != 'sin_acceso'
  );

CREATE POLICY "asistencia: editar propios o supervisor+" ON asistencia
  FOR UPDATE USING (
    user_has_access_to_obra(obra_id)
    AND (
      created_by = auth.uid()
      OR user_rol_in_obra(obra_id) IN ('admin', 'gerente', 'ingeniero_residente', 'supervisor', 'asistente_admin')
    )
  );

-- ── PARTIDAS ──────────────────────────────────────────────────────────
ALTER TABLE partidas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "partidas: ver por obra" ON partidas
  FOR SELECT USING (user_has_access_to_obra(obra_id));

CREATE POLICY "partidas: editar (ing.residente+)" ON partidas
  FOR ALL USING (
    user_has_access_to_obra(obra_id)
    AND user_rol_in_obra(obra_id) IN ('admin', 'gerente', 'ingeniero_residente')
  );

-- ── AVANCE_OBRA ───────────────────────────────────────────────────────
ALTER TABLE avance_obra ENABLE ROW LEVEL SECURITY;

CREATE POLICY "avance: ver por obra" ON avance_obra
  FOR SELECT USING (user_has_access_to_obra(obra_id));

CREATE POLICY "avance: registrar (supervisor+)" ON avance_obra
  FOR INSERT WITH CHECK (
    user_has_access_to_obra(obra_id)
    AND user_rol_in_obra(obra_id) IN ('admin', 'gerente', 'ingeniero_residente', 'supervisor')
  );

-- ── INSUMOS_PARTIDA, CRONOGRAMA (solo lectura para no-admin) ─────────
ALTER TABLE insumos_partida ENABLE ROW LEVEL SECURITY;
CREATE POLICY "insumos: ver por obra" ON insumos_partida
  FOR SELECT USING (user_has_access_to_obra(obra_id));
CREATE POLICY "insumos: editar (ing.residente+)" ON insumos_partida
  FOR ALL USING (
    user_has_access_to_obra(obra_id)
    AND user_rol_in_obra(obra_id) IN ('admin', 'gerente', 'ingeniero_residente')
  );

ALTER TABLE cronograma ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cronograma: ver por obra" ON cronograma
  FOR SELECT USING (user_has_access_to_obra(obra_id));
CREATE POLICY "cronograma: editar (ing.residente+)" ON cronograma
  FOR ALL USING (
    user_has_access_to_obra(obra_id)
    AND user_rol_in_obra(obra_id) IN ('admin', 'gerente', 'ingeniero_residente')
  );

-- ── EVIDENCIAS ────────────────────────────────────────────────────────
ALTER TABLE evidencias ENABLE ROW LEVEL SECURITY;
CREATE POLICY "evidencias: ver por obra" ON evidencias
  FOR SELECT USING (user_has_access_to_obra(obra_id));
CREATE POLICY "evidencias: subir (todos excepto solo_lectura)" ON evidencias
  FOR INSERT WITH CHECK (
    user_has_access_to_obra(obra_id)
    AND user_rol_in_obra(obra_id) != 'solo_lectura'
  );

-- ── INCIDENCIAS ───────────────────────────────────────────────────────
ALTER TABLE incidencias ENABLE ROW LEVEL SECURITY;
CREATE POLICY "incidencias: ver por obra" ON incidencias
  FOR SELECT USING (user_has_access_to_obra(obra_id));
CREATE POLICY "incidencias: crear (todos excepto solo_lectura)" ON incidencias
  FOR INSERT WITH CHECK (
    user_has_access_to_obra(obra_id)
    AND user_rol_in_obra(obra_id) != 'solo_lectura'
  );
CREATE POLICY "incidencias: actualizar estado (supervisor+)" ON incidencias
  FOR UPDATE USING (
    user_has_access_to_obra(obra_id)
    AND user_rol_in_obra(obra_id) IN ('admin', 'gerente', 'ingeniero_residente', 'supervisor')
  );

-- ── PROVEEDORES (global, cualquier usuario autenticado) ──────────────
ALTER TABLE proveedores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "proveedores: ver todos" ON proveedores
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "proveedores: gestionar (admin+gerente)" ON proveedores
  FOR ALL USING (
    (SELECT rol FROM profiles WHERE id = auth.uid()) IN ('admin', 'gerente', 'asistente_admin')
  );

-- ── SYNC_LOG (solo admins) ────────────────────────────────────────────
ALTER TABLE sync_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sync_log: solo admin" ON sync_log
  FOR ALL USING (
    (SELECT rol FROM profiles WHERE id = auth.uid()) = 'admin'
  );
