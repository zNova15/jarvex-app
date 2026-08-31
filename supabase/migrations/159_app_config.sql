-- 159 — Config GLOBAL de la app (clave→valor) — pedido de Gabriel, 31-ago-2026.
--
-- Primera consumidora: el tiempo de auto-cierre de sesión por inactividad
-- (clave 'sesion_timeout_min'), que hasta hoy era una constante de 30 min en
-- useAuth.js y Gabriel quiere ajustable desde Administración. La tabla es
-- genérica (jsonb) para que futuras configuraciones no necesiten otra migración.
--
-- Patrón de sync del repo (migs 113/154): id uuid PK + columnas de sync, SIN
-- UNIQUE en clave a propósito — dos devices offline podrían crear la misma
-- clave con ids distintos; el cliente resuelve al leer (updated_at más
-- reciente gana). Aislamiento modo prueba: demo.

CREATE TABLE IF NOT EXISTS app_config (
  id uuid PRIMARY KEY,
  clave text NOT NULL,
  valor jsonb,
  demo boolean NOT NULL DEFAULT false,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  idempotency_key text UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_app_config_clave
  ON app_config (clave) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_app_config_updated ON app_config;
CREATE TRIGGER trg_app_config_updated
  BEFORE UPDATE ON app_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;

-- Leen TODOS los autenticados (el valor viaja a cada device por el sync — es
-- configuración de comportamiento de la app, no data sensible). Escribe SOLO
-- el admin (es quien decide la política de sesión).
DROP POLICY IF EXISTS "app_config: autenticado lee" ON app_config;
CREATE POLICY "app_config: autenticado lee" ON app_config
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "app_config: admin inserta" ON app_config;
CREATE POLICY "app_config: admin inserta" ON app_config
  FOR INSERT TO authenticated WITH CHECK (has_role(ARRAY['admin'::text]));
DROP POLICY IF EXISTS "app_config: admin actualiza" ON app_config;
CREATE POLICY "app_config: admin actualiza" ON app_config
  FOR UPDATE TO authenticated
  USING (has_role(ARRAY['admin'::text]))
  WITH CHECK (has_role(ARRAY['admin'::text]));
DROP POLICY IF EXISTS "app_config: admin borra" ON app_config;
CREATE POLICY "app_config: admin borra" ON app_config
  FOR DELETE TO authenticated USING (has_role(ARRAY['admin'::text]));

-- Cerco del rol 'campo' (invariante mig 155: toda tabla nueva lo declara).
-- campo LEE (necesita el timeout como cualquier device) pero JAMÁS escribe.
DROP POLICY IF EXISTS "campo_cerco_insert" ON app_config;
CREATE POLICY "campo_cerco_insert" ON app_config
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (current_user_rol() IS DISTINCT FROM 'campo'::text);
DROP POLICY IF EXISTS "campo_cerco_update" ON app_config;
CREATE POLICY "campo_cerco_update" ON app_config
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (current_user_rol() IS DISTINCT FROM 'campo'::text);
DROP POLICY IF EXISTS "campo_cerco_delete" ON app_config;
CREATE POLICY "campo_cerco_delete" ON app_config
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (current_user_rol() IS DISTINCT FROM 'campo'::text);

-- Refrescar el schema cache de PostgREST (patrón del repo, mig 148).
NOTIFY pgrst, 'reload schema';
