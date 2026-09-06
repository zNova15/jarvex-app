-- ═══════════════════════════════════════════════════════════════════
-- 181 — DESCARTES DE LA REVISIÓN DE FACTURAS — tanda 7.
--
-- Gabriel, 6-sep-2026: «sería una herramienta ideal para escanear y ver qué
-- facturas tienen incoherencias para que no tengamos problemas con la SUNAT».
--
-- El escáner (src/lib/revision-facturas.js) es DERIVADO: no guarda hallazgos,
-- los recalcula al abrir la pantalla. Igual que el stock sale de los
-- movimientos y el margen de un trabajo sale de sus comprobantes. Un hallazgo
-- guardado envejece: se corrige la factura y el aviso sigue ahí.
--
-- Lo ÚNICO que hay que persistir es la decisión humana: «esto lo miré y está
-- bien». Sin eso, los 143 avisos de nivel REVISAR —facturas con IGV distinto
-- de 18%, que pueden estar perfectamente exoneradas— vuelven cada vez que se
-- abre la pantalla, y a la tercera nadie la abre más. Esta tabla es la memoria
-- de esa decisión, y nada más.
--
-- POR QUÉ LA LLAVE ES (movimiento, regla) Y NO UN id DE HALLAZGO:
-- descartar «el IGV de esta factura está bien» no debe silenciar «a esta
-- factura le falta el código de detracción». Se descarta un motivo sobre un
-- comprobante, no el comprobante entero.
--
-- Y por qué NO hay ON DELETE CASCADE hacia accounting_movements: el borrado
-- en JARVEX es lógico (deleted_at), nunca físico. Un CASCADE aquí sería
-- decorativo y daría una falsa sensación de limpieza.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS revision_descartes (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  movimiento_id     UUID NOT NULL,
  -- El `id` estable de la regla en revision-facturas.js (ej. 'igv-no-es-18').
  -- Texto y no enum: agregar una regla no puede exigir una migración.
  regla             TEXT NOT NULL,
  -- Por qué se descarta. Opcional pero muy recomendable: es lo que va a leer
  -- la próxima persona que se pregunte por qué esta factura no aparece.
  motivo            TEXT,

  -- Columnas estándar del proyecto (espejo de las demás tablas).
  version           INTEGER     NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ,
  created_by        UUID,
  updated_by        UUID,
  idempotency_key   TEXT,
  last_synced_at    TIMESTAMPTZ
);

DO $$ BEGIN
  ALTER TABLE revision_descartes
    ADD CONSTRAINT revision_descartes_movimiento_id_fkey
    FOREIGN KEY (movimiento_id) REFERENCES accounting_movements(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Un motivo descartado UNA vez por comprobante. Parcial sobre deleted_at para
-- que "des-descartar" (borrado lógico) permita volver a descartar después.
CREATE UNIQUE INDEX IF NOT EXISTS uq_revision_descarte_vivo
  ON revision_descartes (movimiento_id, regla) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_revision_descartes_mov
  ON revision_descartes (movimiento_id) WHERE deleted_at IS NULL;

-- ── RLS: las cuatro capas del proyecto ─────────────────────────────
ALTER TABLE revision_descartes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "revision_descartes: ve"        ON revision_descartes;
DROP POLICY IF EXISTS "revision_descartes: crea"      ON revision_descartes;
DROP POLICY IF EXISTS "revision_descartes: actualiza" ON revision_descartes;
DROP POLICY IF EXISTS "revision_descartes: elimina"   ON revision_descartes;

CREATE POLICY "revision_descartes: ve"        ON revision_descartes FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "revision_descartes: crea"      ON revision_descartes FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "revision_descartes: actualiza" ON revision_descartes FOR UPDATE USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "revision_descartes: elimina"   ON revision_descartes FOR DELETE USING (is_admin());

-- Cerco de módulo (mig 178): ESPEJO EXACTO del de accounting_movements, que
-- niega a los cinco roles de campo. Si los descartes fueran más visibles que
-- los movimientos, un rol vería que "algo se revisó" sin poder ver qué.
DROP POLICY IF EXISTS modulo_cerco_select ON revision_descartes;
CREATE POLICY modulo_cerco_select ON revision_descartes AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (COALESCE((SELECT public.current_user_rol()) <> ALL
    ('{ing_ambiental,ing_calidad,ing_social,ingeniero,prevencionista}'::text[]), true));

-- Cerco del rol campo (migs 155/167). «Toda tabla nueva debe nacer con sus
-- campo_cerco_*» — es la lección permanente escrita en la 167.
DROP POLICY IF EXISTS campo_cerco_select ON revision_descartes;
DROP POLICY IF EXISTS campo_cerco_insert ON revision_descartes;
DROP POLICY IF EXISTS campo_cerco_update ON revision_descartes;
DROP POLICY IF EXISTS campo_cerco_delete ON revision_descartes;
CREATE POLICY campo_cerco_select ON revision_descartes AS RESTRICTIVE
  FOR SELECT TO authenticated USING (current_user_rol() IS DISTINCT FROM 'campo'::text);
CREATE POLICY campo_cerco_insert ON revision_descartes AS RESTRICTIVE
  FOR INSERT TO authenticated WITH CHECK (current_user_rol() IS DISTINCT FROM 'campo'::text);
CREATE POLICY campo_cerco_update ON revision_descartes AS RESTRICTIVE
  FOR UPDATE TO authenticated USING (current_user_rol() IS DISTINCT FROM 'campo'::text)
  WITH CHECK (current_user_rol() IS DISTINCT FROM 'campo'::text);
CREATE POLICY campo_cerco_delete ON revision_descartes AS RESTRICTIVE
  FOR DELETE TO authenticated USING (current_user_rol() IS DISTINCT FROM 'campo'::text);

COMMENT ON TABLE revision_descartes IS
  'Memoria de "esto lo revisé y está bien" del escáner de facturas (tanda 7). '
  'Los hallazgos NO se guardan: se recalculan. Solo se persiste el descarte.';
