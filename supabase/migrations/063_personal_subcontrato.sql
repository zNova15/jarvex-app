-- 063: Personal agrupado bajo subcontratista + jefe de subcontrato + seguro a cargo
-- ---------------------------------------------------------------------------
-- Fase A del rediseño de subcontratos. Permite:
--   1. Agrupar trabajadores bajo un subcontratista (cuadrilla).        personal.subcontratista_id
--   2. Marcar 1-2 "jefes de subcontrato" por grupo.                    personal.es_jefe_subcontrato
--   3. Registrar quién asume el seguro/SCTR de cada trabajador.        personal.seguro_a_cargo
--      (la empresa ejecutora suele comprar el seguro incluso del
--       personal subcontratado; depende del trato con cada subcontrato)
--   4. Default del seguro a nivel del trato con el subcontratista.     subcontratistas.seguro_a_cargo
--
-- Todo es ADITIVO y nullable: el personal existente queda como "directo de la
-- empresa" (subcontratista_id NULL) sin cambios. No hay pérdida de datos.
-- subcontrato_id NO se usa: agrupamos por subcontratista (el tercero), que es
-- como ya referencian los movimientos (movimientos_epp/maquinaria, mig 055/059).

ALTER TABLE personal ADD COLUMN IF NOT EXISTS subcontratista_id UUID REFERENCES subcontratistas(id);
ALTER TABLE personal ADD COLUMN IF NOT EXISTS es_jefe_subcontrato BOOLEAN DEFAULT false;
ALTER TABLE personal ADD COLUMN IF NOT EXISTS seguro_a_cargo TEXT
  CHECK (seguro_a_cargo IS NULL OR seguro_a_cargo IN ('empresa', 'subcontrato'));

CREATE INDEX IF NOT EXISTS idx_personal_subcontratista
  ON personal(subcontratista_id) WHERE subcontratista_id IS NOT NULL;

-- Default del seguro según el trato pactado con el subcontratista. Se usa para
-- pre-rellenar el seguro de los trabajadores que se agreguen a su cuadrilla.
-- DEFAULT 'empresa' porque hoy los subcontratos existentes NO se hacen cargo
-- del seguro (lo asume la empresa ejecutora).
ALTER TABLE subcontratistas ADD COLUMN IF NOT EXISTS seguro_a_cargo TEXT
  DEFAULT 'empresa'
  CHECK (seguro_a_cargo IS NULL OR seguro_a_cargo IN ('empresa', 'subcontrato'));

NOTIFY pgrst, 'reload schema';
