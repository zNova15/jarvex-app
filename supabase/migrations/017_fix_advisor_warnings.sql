-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migración 017 — Fix Supabase Advisor warnings                    ║
-- ║  1) Security Definer Views → cambiar a security_invoker           ║
-- ║  2) Auth RLS Initialization Plan → envolver auth.uid() en SELECT  ║
-- ║  Idempotente. Se puede correr varias veces sin efecto adverso.    ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────
-- 1) FIX: Security Definer Views
-- ─────────────────────────────────────────────────────────────────────
-- Por defecto las VIEWs en Postgres ejecutan con permisos del propietario
-- (postgres en Supabase) → BYPASEAN RLS. Eso es CRITICAL.
-- security_invoker=true (PG15+) hace que la view respete RLS del usuario
-- que la consulta. Es lo que recomienda el linter de Supabase.

ALTER VIEW IF EXISTS v_obras_avance_ponderado    SET (security_invoker = true);
ALTER VIEW IF EXISTS v_partidas_estado_cronograma SET (security_invoker = true);
ALTER VIEW IF EXISTS v_partidas_avance_consumo   SET (security_invoker = true);
ALTER VIEW IF EXISTS v_dashboard_obra            SET (security_invoker = true);
ALTER VIEW IF EXISTS v_almacen_resumen           SET (security_invoker = true);
ALTER VIEW IF EXISTS v_asistencia_resumen        SET (security_invoker = true);
ALTER VIEW IF EXISTS v_comparativo_partidas      SET (security_invoker = true);

-- ─────────────────────────────────────────────────────────────────────
-- 2) FIX: Auth RLS Initialization Plan
-- ─────────────────────────────────────────────────────────────────────
-- auth.uid() llamado directamente en USING/CHECK se re-evalúa por CADA fila.
-- Wrappeado en (SELECT auth.uid()) Postgres lo ejecuta una sola vez por query.
-- Solo es perf, no cambia la semántica.

-- ── PERSONAL ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "personal: autenticado ve"        ON personal;
DROP POLICY IF EXISTS "personal: autenticado crea"      ON personal;
DROP POLICY IF EXISTS "personal: autenticado actualiza" ON personal;

CREATE POLICY "personal: autenticado ve" ON personal
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "personal: autenticado crea" ON personal
  FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "personal: autenticado actualiza" ON personal
  FOR UPDATE USING ((SELECT auth.uid()) IS NOT NULL);

-- ── ASISTENCIA ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "asistencia: autenticado ve"        ON asistencia;
DROP POLICY IF EXISTS "asistencia: autenticado crea"      ON asistencia;
DROP POLICY IF EXISTS "asistencia: autenticado actualiza" ON asistencia;

CREATE POLICY "asistencia: autenticado ve" ON asistencia
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "asistencia: autenticado crea" ON asistencia
  FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "asistencia: autenticado actualiza" ON asistencia
  FOR UPDATE USING ((SELECT auth.uid()) IS NOT NULL);

-- ── MOVIMIENTOS_MATERIALES ──────────────────────────────────────────
DROP POLICY IF EXISTS "mov_mat: autenticado ve"        ON movimientos_materiales;
DROP POLICY IF EXISTS "mov_mat: autenticado crea"      ON movimientos_materiales;
DROP POLICY IF EXISTS "mov_mat: autenticado actualiza" ON movimientos_materiales;

CREATE POLICY "mov_mat: autenticado ve" ON movimientos_materiales
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "mov_mat: autenticado crea" ON movimientos_materiales
  FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "mov_mat: autenticado actualiza" ON movimientos_materiales
  FOR UPDATE USING ((SELECT auth.uid()) IS NOT NULL);

-- ── MOVIMIENTOS_HERRAMIENTAS ────────────────────────────────────────
DROP POLICY IF EXISTS "mov_herr: autenticado ve"        ON movimientos_herramientas;
DROP POLICY IF EXISTS "mov_herr: autenticado crea"      ON movimientos_herramientas;
DROP POLICY IF EXISTS "mov_herr: autenticado actualiza" ON movimientos_herramientas;

CREATE POLICY "mov_herr: autenticado ve" ON movimientos_herramientas
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "mov_herr: autenticado crea" ON movimientos_herramientas
  FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "mov_herr: autenticado actualiza" ON movimientos_herramientas
  FOR UPDATE USING ((SELECT auth.uid()) IS NOT NULL);

-- ── MATERIALES ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "materiales: autenticado ve"        ON materiales;
DROP POLICY IF EXISTS "materiales: autenticado crea"      ON materiales;
DROP POLICY IF EXISTS "materiales: autenticado actualiza" ON materiales;

CREATE POLICY "materiales: autenticado ve" ON materiales
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "materiales: autenticado crea" ON materiales
  FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "materiales: autenticado actualiza" ON materiales
  FOR UPDATE USING ((SELECT auth.uid()) IS NOT NULL);

-- ── HERRAMIENTAS ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "herramientas: autenticado ve"        ON herramientas;
DROP POLICY IF EXISTS "herramientas: autenticado crea"      ON herramientas;
DROP POLICY IF EXISTS "herramientas: autenticado actualiza" ON herramientas;

CREATE POLICY "herramientas: autenticado ve" ON herramientas
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "herramientas: autenticado crea" ON herramientas
  FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "herramientas: autenticado actualiza" ON herramientas
  FOR UPDATE USING ((SELECT auth.uid()) IS NOT NULL);

-- ── PROVEEDORES ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "proveedores: autenticado ve"        ON proveedores;
DROP POLICY IF EXISTS "proveedores: autenticado crea"      ON proveedores;
DROP POLICY IF EXISTS "proveedores: autenticado actualiza" ON proveedores;

CREATE POLICY "proveedores: autenticado ve" ON proveedores
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "proveedores: autenticado crea" ON proveedores
  FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "proveedores: autenticado actualiza" ON proveedores
  FOR UPDATE USING ((SELECT auth.uid()) IS NOT NULL);

-- ── PARTIDAS ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "partidas: autenticado ve"        ON partidas;
DROP POLICY IF EXISTS "partidas: autenticado crea"      ON partidas;
DROP POLICY IF EXISTS "partidas: autenticado actualiza" ON partidas;

CREATE POLICY "partidas: autenticado ve" ON partidas
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "partidas: autenticado crea" ON partidas
  FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "partidas: autenticado actualiza" ON partidas
  FOR UPDATE USING ((SELECT auth.uid()) IS NOT NULL);

-- ── INSUMOS_PARTIDA ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "insumos_partida: autenticado ve"        ON insumos_partida;
DROP POLICY IF EXISTS "insumos_partida: autenticado crea"      ON insumos_partida;
DROP POLICY IF EXISTS "insumos_partida: autenticado actualiza" ON insumos_partida;

CREATE POLICY "insumos_partida: autenticado ve" ON insumos_partida
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "insumos_partida: autenticado crea" ON insumos_partida
  FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "insumos_partida: autenticado actualiza" ON insumos_partida
  FOR UPDATE USING ((SELECT auth.uid()) IS NOT NULL);

-- ── OBRAS ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "obras: autenticado ve"        ON obras;
DROP POLICY IF EXISTS "obras: autenticado crea"      ON obras;
DROP POLICY IF EXISTS "obras: autenticado actualiza" ON obras;

CREATE POLICY "obras: autenticado ve" ON obras
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "obras: autenticado crea" ON obras
  FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "obras: autenticado actualiza" ON obras
  FOR UPDATE USING ((SELECT auth.uid()) IS NOT NULL);
