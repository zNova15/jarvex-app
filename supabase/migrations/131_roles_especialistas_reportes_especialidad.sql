-- ═══════════════════════════════════════════════════════════════════
-- 131 — Roles especialistas + reportes diarios de especialidad.
--
-- Gestiones de obra (pedido de Gabriel, 16 jul 2026): ingenieros encargados de
-- Seguridad (rol prevencionista existente, relabeleado en la app), Ambiental,
-- Calidad y Social. Cada especialista presenta su REPORTE DIARIO por área; el
-- Residente de Obra supervisa el cumplimiento.
--
-- OJO: profiles.rol tiene CHECK — agregar un rol nuevo SIEMPRE requiere
-- actualizarlo acá (trampa conocida: el menú puede mostrar el rol pero el
-- server rechaza el UPDATE del perfil).
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_rol_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_rol_check CHECK (rol = ANY (ARRAY[
  'admin','gerente','ingeniero_residente','ingeniero','supervisor','almacenero',
  'asistente_admin','contador','ayudante_contador','tesorero','jefe_compras','rrhh',
  'prevencionista','maestro_obra','solo_lectura',
  'ing_ambiental','ing_calidad','ing_social'
]));

CREATE TABLE IF NOT EXISTS reportes_especialidad (
  id uuid PRIMARY KEY,
  obra_id uuid REFERENCES obras(id),
  area text NOT NULL,                 -- seguridad | ambiental | calidad | social
  fecha date NOT NULL,
  descripcion text NOT NULL,
  responsable_id uuid,                -- usuario (profiles) que reporta
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  idempotency_key text UNIQUE,
  CONSTRAINT reportes_especialidad_area_check CHECK (area = ANY (ARRAY['seguridad','ambiental','calidad','social']))
);
CREATE INDEX IF NOT EXISTS idx_rep_esp_obra ON reportes_especialidad (obra_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rep_esp_fecha ON reportes_especialidad (fecha) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_rep_esp_updated ON reportes_especialidad;
CREATE TRIGGER trg_rep_esp_updated BEFORE UPDATE ON reportes_especialidad
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE reportes_especialidad ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rep_esp: autenticado lee" ON reportes_especialidad;
CREATE POLICY "rep_esp: autenticado lee" ON reportes_especialidad
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "rep_esp: autenticado inserta" ON reportes_especialidad;
CREATE POLICY "rep_esp: autenticado inserta" ON reportes_especialidad
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "rep_esp: autenticado actualiza" ON reportes_especialidad;
CREATE POLICY "rep_esp: autenticado actualiza" ON reportes_especialidad
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "rep_esp: admin borra" ON reportes_especialidad;
CREATE POLICY "rep_esp: admin borra" ON reportes_especialidad
  FOR DELETE TO authenticated USING (has_role(ARRAY['admin'::text]));

NOTIFY pgrst, 'reload schema';
