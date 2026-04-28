-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — RLS relajada para equipos pequeños
-- ═══════════════════════════════════════════════════════════════════
-- Problema: las RLS originales exigían que cada usuario estuviera
-- asignado en `obra_usuarios` para ver/modificar materiales, partidas,
-- herramientas, asistencia, etc. En la práctica esto rompía el flujo
-- básico de equipo: si Gabriel crea una obra y Miguel no está en
-- `obra_usuarios`, Miguel no la ve y sus inserts fallan.
--
-- Esta migración relaja TODAS las policies de master/transactional
-- tables para permitir SELECT/INSERT/UPDATE a cualquier usuario
-- autenticado (auth.uid() IS NOT NULL).
--
-- DELETE sigue siendo restringido al admin (las pocas cosas que se
-- borran realmente requieren consciencia explícita).
-- ═══════════════════════════════════════════════════════════════════

-- ── OBRAS ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "obras: ver asignadas" ON obras;
DROP POLICY IF EXISTS "obras: crear (admin/gerente)" ON obras;
DROP POLICY IF EXISTS "obras: editar (admin/gerente)" ON obras;
DROP POLICY IF EXISTS "obras: admin elimina" ON obras;

CREATE POLICY "obras: autenticado ve" ON obras
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "obras: autenticado crea" ON obras
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "obras: autenticado actualiza" ON obras
  FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "obras: admin elimina" ON obras
  FOR DELETE USING (is_admin());

-- ── PARTIDAS ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "partidas: ver por obra" ON partidas;
DROP POLICY IF EXISTS "partidas: editar (ing.residente+)" ON partidas;

CREATE POLICY "partidas: autenticado ve" ON partidas
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "partidas: autenticado crea" ON partidas
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "partidas: autenticado actualiza" ON partidas
  FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "partidas: admin elimina" ON partidas
  FOR DELETE USING (is_admin());

-- ── INSUMOS_PARTIDA ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "insumos: ver por obra" ON insumos_partida;
DROP POLICY IF EXISTS "insumos: editar (ing.residente+)" ON insumos_partida;

CREATE POLICY "insumos_partida: autenticado ve" ON insumos_partida
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "insumos_partida: autenticado crea" ON insumos_partida
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "insumos_partida: autenticado actualiza" ON insumos_partida
  FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "insumos_partida: admin elimina" ON insumos_partida
  FOR DELETE USING (is_admin());

-- ── MATERIALES ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "materiales: ver por obra" ON materiales;
DROP POLICY IF EXISTS "materiales: gestionar (almacenero+)" ON materiales;

CREATE POLICY "materiales: autenticado ve" ON materiales
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "materiales: autenticado crea" ON materiales
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "materiales: autenticado actualiza" ON materiales
  FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "materiales: admin elimina" ON materiales
  FOR DELETE USING (is_admin());

-- ── HERRAMIENTAS ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "herramientas: ver por obra" ON herramientas;
DROP POLICY IF EXISTS "herramientas: gestionar (supervisor+)" ON herramientas;

CREATE POLICY "herramientas: autenticado ve" ON herramientas
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "herramientas: autenticado crea" ON herramientas
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "herramientas: autenticado actualiza" ON herramientas
  FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "herramientas: admin elimina" ON herramientas
  FOR DELETE USING (is_admin());

-- ── PERSONAL ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "personal: ver por obra" ON personal;
DROP POLICY IF EXISTS "personal: crear (roles con acceso)" ON personal;
DROP POLICY IF EXISTS "personal: editar (roles con acceso)" ON personal;

CREATE POLICY "personal: autenticado ve" ON personal
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "personal: autenticado crea" ON personal
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "personal: autenticado actualiza" ON personal
  FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "personal: admin elimina" ON personal
  FOR DELETE USING (is_admin());

-- ── ASISTENCIA ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "asistencia: ver por obra" ON asistencia;
DROP POLICY IF EXISTS "asistencia: registrar (todos excepto solo_lectura)" ON asistencia;
DROP POLICY IF EXISTS "asistencia: editar propios o supervisor+" ON asistencia;

CREATE POLICY "asistencia: autenticado ve" ON asistencia
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "asistencia: autenticado crea" ON asistencia
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "asistencia: autenticado actualiza" ON asistencia
  FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "asistencia: admin elimina" ON asistencia
  FOR DELETE USING (is_admin());

-- ── MOVIMIENTOS_MATERIALES ───────────────────────────────────────────
DROP POLICY IF EXISTS "mov_materiales: ver por obra" ON movimientos_materiales;
DROP POLICY IF EXISTS "mov_materiales: registrar (supervisor+almacenero)" ON movimientos_materiales;

CREATE POLICY "mov_mat: autenticado ve" ON movimientos_materiales
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "mov_mat: autenticado crea" ON movimientos_materiales
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "mov_mat: autenticado actualiza" ON movimientos_materiales
  FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "mov_mat: admin elimina" ON movimientos_materiales
  FOR DELETE USING (is_admin());

-- ── MOVIMIENTOS_HERRAMIENTAS ─────────────────────────────────────────
DROP POLICY IF EXISTS "mov_herramientas: ver por obra" ON movimientos_herramientas;
DROP POLICY IF EXISTS "mov_herramientas: registrar (supervisor+almacenero)" ON movimientos_herramientas;

CREATE POLICY "mov_her: autenticado ve" ON movimientos_herramientas
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "mov_her: autenticado crea" ON movimientos_herramientas
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "mov_her: autenticado actualiza" ON movimientos_herramientas
  FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "mov_her: admin elimina" ON movimientos_herramientas
  FOR DELETE USING (is_admin());

-- ── AVANCE_OBRA ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "avance: ver por obra" ON avance_obra;
DROP POLICY IF EXISTS "avance: registrar (supervisor+)" ON avance_obra;

CREATE POLICY "avance: autenticado ve" ON avance_obra
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "avance: autenticado crea" ON avance_obra
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "avance: autenticado actualiza" ON avance_obra
  FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "avance: admin elimina" ON avance_obra
  FOR DELETE USING (is_admin());

-- ── INCIDENCIAS ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "incidencias: ver por obra" ON incidencias;
DROP POLICY IF EXISTS "incidencias: crear (todos excepto solo_lectura)" ON incidencias;
DROP POLICY IF EXISTS "incidencias: actualizar estado (supervisor+)" ON incidencias;

CREATE POLICY "incidencias: autenticado ve" ON incidencias
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "incidencias: autenticado crea" ON incidencias
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "incidencias: autenticado actualiza" ON incidencias
  FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "incidencias: admin elimina" ON incidencias
  FOR DELETE USING (is_admin());

-- ── EVIDENCIAS ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "evidencias: ver por obra" ON evidencias;
DROP POLICY IF EXISTS "evidencias: subir (todos excepto solo_lectura)" ON evidencias;

CREATE POLICY "evidencias: autenticado ve" ON evidencias
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "evidencias: autenticado crea" ON evidencias
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "evidencias: autenticado actualiza" ON evidencias
  FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "evidencias: admin elimina" ON evidencias
  FOR DELETE USING (is_admin());

-- ── CRONOGRAMA ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "cronograma: ver por obra" ON cronograma;
DROP POLICY IF EXISTS "cronograma: editar (ing.residente+)" ON cronograma;

CREATE POLICY "cronograma: autenticado ve" ON cronograma
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "cronograma: autenticado crea" ON cronograma
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "cronograma: autenticado actualiza" ON cronograma
  FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "cronograma: admin elimina" ON cronograma
  FOR DELETE USING (is_admin());

-- ── PROVEEDORES (ya estaba abierta, solo aseguramos DELETE) ─────────
DROP POLICY IF EXISTS "proveedores: gestionar (admin+gerente)" ON proveedores;

CREATE POLICY "proveedores: autenticado crea" ON proveedores
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "proveedores: autenticado actualiza" ON proveedores
  FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "proveedores: admin elimina" ON proveedores
  FOR DELETE USING (is_admin());
