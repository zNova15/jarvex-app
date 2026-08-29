-- 154 — Mejora 1c (sep-2026): correlación de insumos SUPERVISADA.
--
-- El sistema PROPONE que dos descripciones de factura son el mismo insumo
-- ("Clavo 8 pulg" ≡ "Clavos de 8''"); el admin/gerente CONFIRMA o CORRIGE en
-- el panel de Análisis de Insumos, y la decisión queda grabada acá para no
-- volver a preguntar jamás (pedido explícito de Gabriel, 29-ago-2026).
--
-- Modelo de PARES (no de alias→canónico): cada fila dice "nombre_a y nombre_b
-- son el MISMO insumo" o "son DISTINTOS" (el rechazo también se guarda — sin
-- eso la sugerencia rechazada reaparecería en cada visita). Los grupos de
-- equivalencia se arman al LEER (union-find en el cliente, lib pura con tests).
-- Nombres NORMALIZADOS (minúsculas, sin tildes, ñ→n, sin puntuación) y
-- ordenados (nombre_a <= nombre_b) para que el par sea canónico.
--
-- SIN UNIQUE a propósito (patrón mig 113): dos devices pueden decidir el mismo
-- par offline con ids distintos; la fila canónica se resuelve al leer
-- (manual > sugerido, luego updated_at desc). Aislamiento modo prueba: demo.

CREATE TABLE IF NOT EXISTS insumo_correlaciones (
  id uuid PRIMARY KEY,
  nombre_a text NOT NULL,
  nombre_b text NOT NULL,
  relacion text NOT NULL CHECK (relacion IN ('mismo','distinto')),
  -- Nombre "bonito" elegido para mostrar el grupo (solo relacion='mismo').
  canonico text,
  fuente text NOT NULL DEFAULT 'manual' CHECK (fuente IN ('manual','sugerido')),
  demo boolean NOT NULL DEFAULT false,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  idempotency_key text UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_insumo_corr_a
  ON insumo_correlaciones (nombre_a) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_insumo_corr_b
  ON insumo_correlaciones (nombre_b) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_insumo_corr_updated ON insumo_correlaciones;
CREATE TRIGGER trg_insumo_corr_updated
  BEFORE UPDATE ON insumo_correlaciones
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE insumo_correlaciones ENABLE ROW LEVEL SECURITY;

-- Patrón RLS del repo (migs 109/113): autenticados leen/escriben (la tabla solo
-- contiene NOMBRES de insumos, sin precios ni montos); DELETE físico solo admin.
DROP POLICY IF EXISTS "insumo_corr: autenticado lee" ON insumo_correlaciones;
CREATE POLICY "insumo_corr: autenticado lee" ON insumo_correlaciones
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "insumo_corr: autenticado inserta" ON insumo_correlaciones;
CREATE POLICY "insumo_corr: autenticado inserta" ON insumo_correlaciones
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "insumo_corr: autenticado actualiza" ON insumo_correlaciones;
CREATE POLICY "insumo_corr: autenticado actualiza" ON insumo_correlaciones
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "insumo_corr: admin borra" ON insumo_correlaciones;
CREATE POLICY "insumo_corr: admin borra" ON insumo_correlaciones
  FOR DELETE TO authenticated USING (has_role(ARRAY['admin'::text]));

-- Refrescar el schema cache de PostgREST (patrón del repo, mig 148): sin esto
-- la tabla nueva no existe para la API hasta el próximo reload del cache.
NOTIFY pgrst, 'reload schema';
