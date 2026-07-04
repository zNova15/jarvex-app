-- 115: empresas INTERMEDIARIAS (0-2) en la regla de emisión: cadena
-- compradora → [intermediaria 1] → [intermediaria 2] → emisora final →
-- ejecutora (alimenta la Trazabilidad de Cadenas en la Fase 4).
-- Nota: las actividades económicas de las empresas NO necesitaron columna
-- nueva — companies.actividades_economicas (array, con editor + autofill
-- SUNAT en EmpresasPage) ya existía; los asistentes la mantienen (Empresas-w).

ALTER TABLE emision_reglas
  ADD COLUMN IF NOT EXISTS intermediaria1_company_id uuid REFERENCES companies(id),
  ADD COLUMN IF NOT EXISTS intermediaria2_company_id uuid REFERENCES companies(id);
