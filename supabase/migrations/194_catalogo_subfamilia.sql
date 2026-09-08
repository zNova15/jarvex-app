-- ═══════════════════════════════════════════════════════════════════
-- 194 — SUBFAMILIA Y RECOMENDACIONES REVISADAS — tanda 14, entrega 2.1.
--
-- Gabriel, 7-set-2026: «esperaba que agregues recomendaciones incluso del tipo
-- de categorías para movilizar algunos insumos a otros grupos de familia.
-- Actualmente me parece que incluso las familias son muy generales.»
--
-- `subfamilia` es el SEGUNDO NIVEL. Diez familias no alcanzan: medido sobre su
-- archivo, «IMPLEMENTOS DE SEGURIDAD» son 64 cosas en una sola bolsa (cascos,
-- camillas, conos, arneses y un balón de oxígeno) y «EQUIPOS Y HERRAMIENTAS»
-- 66 donde conviven una retroexcavadora y una brocha. Con el segundo nivel son
-- 42 grupos y 422 de 478 insumos caen en uno.
--
-- SE GUARDA SOLO LO DECIDIDO. La subfamilia se PROPONE al leer
-- (`sugerirSubfamilia` en src/lib/catalogo-subfamilias.js); esta columna guarda
-- únicamente lo que una persona aceptó o corrigió. Así, mejorar el vocabulario
-- mejora las propuestas de todo el catálogo sin migrar una sola fila, y lo que
-- alguien decidió no se pisa nunca. Misma disciplina que el factor de
-- conversión (mig 183) y que el mapeo de familias (mig 193).
--
-- `revisado` ES UNA RESPUESTA, NO UN FLAG TÉCNICO. Cuando la app propone mover
-- un insumo de familia y la persona dice «está bien donde está», eso hay que
-- recordarlo: sin esta columna la misma recomendación vuelve en cada visita y
-- la pantalla se abandona — la lección de mig 181 (los 143 avisos que volvían)
-- y de mig 183 (el «no aplica»).
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE catalogo_insumos ADD COLUMN IF NOT EXISTS subfamilia text;
ALTER TABLE catalogo_insumos ADD COLUMN IF NOT EXISTS revisado boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN catalogo_insumos.subfamilia IS
  'Segundo nivel, SOLO cuando lo decidió una persona. Vacío = se propone al leer con sugerirSubfamilia().';
COMMENT ON COLUMN catalogo_insumos.revisado IS
  'La recomendación de moverlo de familia fue mirada y descartada: no se vuelve a proponer.';

CREATE INDEX IF NOT EXISTS idx_catalogo_insumos_subfamilia
  ON catalogo_insumos (subfamilia) WHERE deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';
