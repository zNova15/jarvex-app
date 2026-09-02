-- ═══════════════════════════════════════════════════════════════════
-- 169 — search_path FIJO en todas las funciones de public
--
-- El advisor de Supabase marcaba 25 funciones con "role mutable search_path"
-- (WARN crónico). En una función SECURITY DEFINER eso es un vector real de
-- escalada: quien controle su search_path puede anteponer un esquema con
-- objetos falsos y hacer que la función —que corre con privilegios del
-- OWNER— resuelva ahí. Las 4 SECURITY DEFINER del proyecto eran
-- asignar_creador_a_obra, crear_gastos_generales_obra, is_admin y
-- protect_campo_password. Las otras 21 son triggers SECURITY INVOKER: riesgo
-- bajo, pero el linter las cuenta igual y no cuesta nada cerrarlas.
--
-- NO se toca ningún cuerpo: solo se PIN-ea la resolución de nombres. Se fija
-- `public, extensions, pg_temp` (y no `''` como sugiere la guía estricta)
-- porque eso habría exigido reescribir cada cuerpo calificando cada nombre —
-- mucho más riesgo para el mismo resultado.
--
-- Verificado antes de aplicar: la única función que llama algo sin calificar
-- fuera de public es crear_gastos_generales_obra con gen_random_uuid(), que
-- vive en pg_catalog (siempre en scope, se resuelve igual); is_admin ya
-- califica auth.*. `extensions` va incluido igual como red de seguridad.
--
-- Verificado después: 0 funciones sin search_path, y el trigger
-- update_updated_at sigue pisando el valor en un UPDATE de prueba.
--
-- Idempotente (solo toca las que no lo tienen) y reversible
-- (ALTER FUNCTION ... RESET search_path).
-- ═══════════════════════════════════════════════════════════════════
DO $$
DECLARE f record; n int := 0;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
     WHERE ns.nspname = 'public'
       AND p.proconfig IS NULL
       AND l.lanname IN ('plpgsql', 'sql')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, extensions, pg_temp', f.sig);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'search_path fijado en % funciones', n;
END $$;
