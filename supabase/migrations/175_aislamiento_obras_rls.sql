-- ═══════════════════════════════════════════════════════════════════
-- 175 — AISLAMIENTO POR OBRA EN EL SERVIDOR (tanda 2D)
--
-- EL HALLAZGO (Gabriel, 3-sep-2026, probando staging): entró con la cuenta de
-- un almacenero designado a UNA obra y la app le ofreció las dos del grupo.
-- Al medirlo, el aislamiento tenía tres agujeros y los tres están cerrados en
-- esta tanda; este archivo es el tercero, el único que de verdad aísla:
--
--   1. Cliente: "sin designaciones" devolvía null = VE TODAS
--      → src/lib/obras-asignadas.js (con tests).
--   2. Cliente: `window.__obrasPermitidas` se poblaba async y hasta que
--      resolvía valía undefined, que se leía como "sin restricción"
--      → src/main.jsx + src/hooks/useObraActiva.js.
--   3. SERVIDOR: `obras` tenía DOS policies de SELECT permisivas —
--      `rls033_select USING(true)` y `obras: autenticado ve USING(uid IS NOT
--      NULL)`— que se combinan con OR: cualquier autenticado se bajaba TODAS
--      las obras. El filtro era 100% del navegador. ← ESTA MIGRACIÓN
--
-- ⚠ ALCANCE HONESTO: esta migración cierra `obras` y `obra_usuarios`. Las
--   tablas HIJAS (materiales, personal, movimientos_materiales, evidencias…)
--   siguen con la mig 030 laxa (~40 tablas con USING(true) para cualquier
--   autenticado). O sea: un usuario ya no ve las obras ajenas en ninguna
--   pantalla ni se las baja el sync, pero alguien que llame a la API a mano
--   todavía podría leer filas hijas de otra obra. Cerrar eso es su propia
--   tanda (el 🔴 pendiente de la mig 030) y no se hace de pasada.
--
-- REVERSIBLE: al final del archivo está el SQL exacto para volver atrás.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Quién ve todas las obras por definición ─────────────────────
-- ESPEJO EXACTO de ROLES_GLOBALES en src/lib/obras-asignadas.js y en
-- src/lib/nav-planos.js. Si se agrega un rol en un lado y no en el otro, la
-- pantalla ofrece obras que el servidor niega (o al revés) y el usuario ve
-- listas vacías sin entender por qué. Los tres lugares se cambian juntos.
CREATE OR REPLACE FUNCTION public.es_rol_global()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.current_user_rol() = ANY (ARRAY[
    'admin', 'gerente', 'contador', 'ayudante_contador', 'tesorero', 'licitaciones'
  ])
$$;

COMMENT ON FUNCTION public.es_rol_global() IS
  'Roles cross-obra (tanda 2D). Espejo de ROLES_GLOBALES en src/lib/obras-asignadas.js.';

-- ── 2. ¿Este usuario puede ver esta obra? ──────────────────────────
-- SECURITY DEFINER a propósito: consulta obra_usuarios saltándose el RLS, que
-- es lo que evita la recursión cuando la usa la policy de obra_usuarios.
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
      OR EXISTS (
        SELECT 1 FROM public.obra_usuarios ou
        WHERE ou.obra_id = p_obra_id
          AND ou.usuario_id = auth.uid()
          AND ou.activo = true
      )
    )
$$;

COMMENT ON FUNCTION public.puede_ver_obra(uuid) IS
  'Aislamiento por obra (tanda 2D): rol global, o designado en obra_usuarios.';

-- ── 3. obras: SELECT solo de las designadas ────────────────────────
-- Se BORRAN las dos permisivas: en Postgres las policies PERMISSIVE se
-- combinan con OR, así que dejar cualquiera de las dos anula todo el filtro.
DROP POLICY IF EXISTS "obras: autenticado ve" ON public.obras;
DROP POLICY IF EXISTS "rls033_select" ON public.obras;

CREATE POLICY "obras: ve solo las designadas" ON public.obras
  FOR SELECT TO authenticated
  USING (
    public.puede_ver_obra(id)
    -- Salvavidas: quien creó la obra la sigue viendo aunque nadie lo haya
    -- designado todavía. Sin esto, un residente que crea una obra la pierde
    -- de vista en el mismo instante en que la guarda.
    OR created_by = auth.uid()
  );

-- ── 4. obra_usuarios: quién está designado a qué ───────────────────
-- Hoy `rls033_select USING(true)` deja a cualquier autenticado leer TODAS las
-- designaciones del grupo. Se reemplaza por: las propias, o las de una obra
-- que ya podés ver (el Panel del trabajo muestra el equipo de la obra, y eso
-- tiene que seguir funcionando para quienes están en ella).
DROP POLICY IF EXISTS "rls033_select" ON public.obra_usuarios;

CREATE POLICY "obra_usuarios: propias o de mis obras" ON public.obra_usuarios
  FOR SELECT TO authenticated
  USING (
    usuario_id = auth.uid()
    OR public.puede_ver_obra(obra_id)
  );

-- La policy "obra_usuarios: ver asignaciones propias" (mig 103) queda: es
-- PERMISIVE y dice (usuario_id = auth.uid() OR rol = 'admin'), o sea un
-- subconjunto de la nueva. No molesta y se deja para no tocar la 103.

-- ── 5. Índice que sostiene el EXISTS de la policy ──────────────────
-- La policy corre por FILA en cada SELECT de obras: sin índice por usuario,
-- cada lectura escanea obra_usuarios entera.
CREATE INDEX IF NOT EXISTS idx_obra_usuarios_usuario_activo
  ON public.obra_usuarios (usuario_id, obra_id) WHERE activo = true;

-- ═══════════════════════════════════════════════════════════════════
-- REVERTIR (pegar en el SQL Editor si algo sale mal):
--
--   DROP POLICY IF EXISTS "obras: ve solo las designadas" ON public.obras;
--   CREATE POLICY "rls033_select" ON public.obras
--     FOR SELECT TO authenticated USING (true);
--   DROP POLICY IF EXISTS "obra_usuarios: propias o de mis obras" ON public.obra_usuarios;
--   CREATE POLICY "rls033_select" ON public.obra_usuarios
--     FOR SELECT TO authenticated USING (true);
--
-- Volver atrás deja la app funcionando igual que hoy: el filtro del cliente
-- (obras-asignadas.js) sigue en pie, solo se pierde el respaldo del servidor.
-- ═══════════════════════════════════════════════════════════════════
