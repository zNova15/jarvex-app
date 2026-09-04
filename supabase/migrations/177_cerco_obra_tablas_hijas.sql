-- ═══════════════════════════════════════════════════════════════════
-- 177 — CERCO DE OBRA EN LAS TABLAS HIJAS
--       (el 🔴 pendiente que la mig 175 dejó escrito y sin cerrar)
--
-- LO QUE LA 175 DEJÓ ABIERTO, medido hoy contra producción con el JWT real
-- de la almacenera (4b31dd32…, designada SOLO a Miraflores):
--
--     obras visibles ............  1   ← la 175 funciona
--     accounting_movements ...... 1359 ← TODOS los del grupo
--
-- O sea: desde la mig 175 nadie ve una obra ajena en ninguna pantalla, pero
-- las FILAS HIJAS seguían abiertas. Cualquiera con la sesión de un almacenero
-- y `curl` se bajaba los movimientos contables, las guías y las evidencias de
-- las obras que no son suyas. El filtro por obra era 100% del navegador.
--
-- CÓMO SE CIERRA: una policy RESTRICTIVE por tabla. RESTRICTIVE se combina con
-- AND (las PERMISSIVE se combinan con OR), así que NO hay que borrar ninguna
-- policy existente ni adivinar qué rol necesita qué: lo de antes sigue igual,
-- y encima se le exige "…y además la fila tiene que ser de una obra tuya".
-- Es el mismo mecanismo del cerco del rol `campo` (migs 155/167), que lleva
-- meses en producción sin un solo incidente.
--
--     USING (obra_id IS NULL OR (SELECT es_rol_global()) OR obra_id IN (mis_obras()))
--
-- LOS DOS ESCAPES, a propósito:
--   · `obra_id IS NULL` — filas del GRUPO, que no son de ninguna obra: 796
--     movimientos contables de empresa, 683 evidencias, 49 guías. Y las 20
--     `factura_campo` del portal de captura, que nacen sin obra: sin este
--     escape la cuenta `campo` dejaba de ver lo que ella misma sube.
--   · `es_rol_global()` — admin, gerente, contador, ayudante_contador,
--     tesorero y licitaciones ven el grupo entero por definición. Espejo
--     EXACTO de ROLES_GLOBALES en src/lib/obras-asignadas.js (mig 175).
--
-- ALCANCE REAL, medido antes de aplicar (2 obras; 12 de los 17 usuarios son
-- de rol no-global y los 12 están designados solo a Miraflores). Lo único que
-- dejan de ver es lo de "Obras San Marcos", que está TERMINADA:
--     accounting_movements  89 filas  ·  evidencias  48  ·  guias_remision 8
--     ubicaciones_obra       4        ·  frentes_obra 1  ·  consorcios     1
-- Las tablas pesadas (partidas 3.449, insumos_partida 6.722, movimientos_
-- materiales 1.958, personal 127) son 100% Miraflores: nadie pierde una fila.
--
-- SE APLICA A SELECT, INSERT, UPDATE Y DELETE: leer una obra ajena era el
-- agujero, pero escribir en una obra ajena también lo era.
--
-- QUEDA FUERA `obra_usuarios`: la 175 ya le puso una policy pensada
-- ("propias o de mis obras") y el cerco le taparía al usuario sus propias
-- designaciones dadas de baja, que no son un secreto para él mismo.
--
-- REVERSIBLE: el SQL exacto para volver atrás está al final del archivo.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. "Mis obras", una sola vez por consulta ──────────────────────
-- Devuelve un SET en vez de un booleano por fila a propósito: el planner la
-- resuelve como un SubPlan hasheado UNA vez por consulta. La versión ingenua
-- (llamar a puede_ver_obra() por fila) son 6.722 llamadas a obra_usuarios en
-- un solo SELECT de insumos_partida.
-- SECURITY DEFINER: lee obra_usuarios salteándose su propio RLS, que es lo
-- que evita la recursión cuando la policy de obra_usuarios la usa.
CREATE OR REPLACE FUNCTION public.mis_obras()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT ou.obra_id
    FROM public.obra_usuarios ou
   WHERE ou.usuario_id = auth.uid()
     AND ou.activo = true
  UNION
  -- Salvavidas del creador, el mismo que ya tiene la policy de `obras`: quien
  -- crea una obra la sigue viendo (y pudiendo trabajar) aunque todavía nadie
  -- lo haya designado en ella.
  SELECT o.id
    FROM public.obras o
   WHERE o.created_by = auth.uid()
$$;

COMMENT ON FUNCTION public.mis_obras() IS
  'Obras que este usuario puede ver: designadas activas + las que creó (mig 177).';

-- `puede_ver_obra` pasa a apoyarse en la misma lista, así "mis obras" tiene
-- UNA sola definición en toda la base. De paso gana el salvavidas del creador,
-- que hasta ahora vivía suelto dentro de la policy de `obras`.
CREATE OR REPLACE FUNCTION public.puede_ver_obra(p_obra_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND (
      public.es_rol_global()
      OR p_obra_id IN (SELECT public.mis_obras())
    )
$$;

-- ── 2. El cerco, tabla por tabla ───────────────────────────────────
DO $$
DECLARE
  t text;
  n int := 0;
  -- Se descubren solas: TODA tabla base de `public` con una columna obra_id.
  -- Así una tabla nueva que nazca con obra_id queda cercada con solo volver a
  -- correr este archivo (es idempotente), sin tener que acordarse de una lista.
  --
  -- Las dos subconsultas escalares NO son adorno: son la diferencia entre un
  -- InitPlan que corre UNA vez por consulta y 6.722 llamadas a profiles por
  -- SELECT. Medido hoy sobre insumos_partida con el JWT de un ingeniero:
  --   es_rol_global() suelto ......... 1.019 ms
  --   (SELECT es_rol_global()) ......... 158 ms   ← incluso menos que hoy (359)
  -- Es el mismo truco que ya usan las policies viejas con (SELECT auth.uid()).
  cerco text := 'obra_id IS NULL OR (SELECT public.es_rol_global()) OR obra_id IN (SELECT public.mis_obras())';
  excepciones text[] := ARRAY['obra_usuarios'];
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n2 ON n2.oid = c.relnamespace
     WHERE n2.nspname = 'public'
       AND c.relkind = 'r'
       AND NOT (c.relname = ANY (excepciones))
       AND EXISTS (
         SELECT 1 FROM information_schema.columns ic
          WHERE ic.table_schema = 'public'
            AND ic.table_name = c.relname
            AND ic.column_name = 'obra_id'
       )
     ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS obra_cerco_select ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY obra_cerco_select ON public.%I AS RESTRICTIVE
         FOR SELECT TO authenticated USING (%s)', t, cerco);

    EXECUTE format('DROP POLICY IF EXISTS obra_cerco_insert ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY obra_cerco_insert ON public.%I AS RESTRICTIVE
         FOR INSERT TO authenticated WITH CHECK (%s)', t, cerco);

    EXECUTE format('DROP POLICY IF EXISTS obra_cerco_update ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY obra_cerco_update ON public.%I AS RESTRICTIVE
         FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', t, cerco, cerco);

    EXECUTE format('DROP POLICY IF EXISTS obra_cerco_delete ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY obra_cerco_delete ON public.%I AS RESTRICTIVE
         FOR DELETE TO authenticated USING (%s)', t, cerco);

    n := n + 1;
  END LOOP;
  RAISE NOTICE 'Cerco de obra aplicado a % tablas', n;
END $$;

-- Las 20 vistas `v_*` con obra_id NO necesitan nada: todas son
-- security_invoker=true (verificado hoy), o sea que heredan el RLS de quien
-- consulta. El cerco las alcanza solo.

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════
-- VERIFICACIÓN (con el JWT real de la almacenera de Miraflores):
--   BEGIN;
--   SET LOCAL ROLE authenticated;
--   SET LOCAL request.jwt.claims = '{"sub":"4b31dd32-6a12-491c-a799-6b4a811894be","role":"authenticated"}';
--   SELECT (SELECT count(*) FROM public.obras)                AS obras,
--          (SELECT count(*) FROM public.accounting_movements) AS movs;
--   ROLLBACK;
--   -- antes: 1 obra / 1359 movs   ·   después: 1 obra / 1270 movs
--
-- REVERTIR (pegar en el SQL Editor si algo sale mal):
--   DO $$ DECLARE t text; BEGIN
--     FOR t IN SELECT DISTINCT tablename FROM pg_policies
--               WHERE schemaname='public' AND policyname LIKE 'obra_cerco_%' LOOP
--       EXECUTE format('DROP POLICY IF EXISTS obra_cerco_select ON public.%I', t);
--       EXECUTE format('DROP POLICY IF EXISTS obra_cerco_insert ON public.%I', t);
--       EXECUTE format('DROP POLICY IF EXISTS obra_cerco_update ON public.%I', t);
--       EXECUTE format('DROP POLICY IF EXISTS obra_cerco_delete ON public.%I', t);
--     END LOOP;
--   END $$;
--   NOTIFY pgrst, 'reload schema';
--
-- Volver atrás deja la app funcionando igual que hoy: el filtro del cliente
-- sigue en pie, solo se pierde el respaldo del servidor.
-- ═══════════════════════════════════════════════════════════════════
